/**
 * Transiciones naturales de las manos entre una seña y la siguiente.
 *
 * El cross-fade del mixer de Three.js mezcla cada hueso por separado con slerp
 * (el giro más corto de cada articulación). Cuando la mano cambia mucho de
 * orientación (por ejemplo MUCHO → TRANCÓN: dedos arriba y palma atrás a dedos
 * adelante y palma abajo) ese atajo hace que los dedos barran de lado y la
 * muñeca se doble de una forma que una persona no puede hacer.
 *
 * Este sistema corre después del mixer y, solo mientras hay una mezcla, rehace
 * la mano y el hueso de giro del antebrazo:
 *   - los dedos van en línea recta (sobre un círculo máximo) de la dirección
 *     inicial a la final;
 *   - la palma gira alrededor de los dedos en el sentido que sigue el
 *     antebrazo (pronación o supinación), sin pasar por el lado imposible;
 *   - el giro del antebrazo se interpola como ángulo, no como cuaternión.
 * Hombro, brazo, codo y dedos siguen como los deja el mixer.
 */
import * as THREE from 'three';

const EJE = new THREE.Vector3(0, 1, 0); // eje del hueso (hacia los dedos)
// Ángulo del giro del antebrazo por donde nunca pasa una seña (casi media vuelta).
// La derecha usa (corte - 360°, corte]; la izquierda, el reflejo.
const CORTE = { Right: THREE.MathUtils.degToRad(172), Left: -THREE.MathUtils.degToRad(172) };
const MIN_PESO = 1e-3;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Giro de qRel alrededor del eje Y, en (corte - 2π, corte] o su reflejo. */
function anguloGiro(qRel, corte) {
  let a = 2 * Math.atan2(qRel.y, qRel.w);
  a = ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  if (corte > 0 && a > corte) a -= 2 * Math.PI;
  if (corte < 0 && a < corte) a += 2 * Math.PI;
  return a;
}

export class TransicionNatural {
  /** @param {{mixer: THREE.AnimationMixer, actions: Map, bones: Map}} viewer */
  constructor(viewer) {
    this.viewer = viewer;
    this.activa = true;
    this.lados = null;
    this.pistas = new WeakMap(); // clip → Map(hueso → interpolante)
    // Hay que crearlo justo después de cargar el modelo, antes de que suene
    // cualquier clip: aquí se guarda la pose de reposo.
    this.#preparar();
  }

  /** Busca los huesos de cada brazo y guarda la pose de reposo. */
  #preparar() {
    const bones = this.viewer.bones;
    if (!bones?.size) return false;
    this.lados = [];
    for (const lado of ['Right', 'Left']) {
      const mano = [...bones.values()].find((b) => b.name.endsWith(`${lado}Hand`));
      if (!mano) continue;
      const giro = [...bones.values()].find((b) => b.name.endsWith(`${lado}ForeArmTwist`)) ?? null;
      const cadena = []; // de la mano hacia arriba, solo huesos
      for (let n = mano; n?.isBone; n = n.parent) cadena.push(n);
      this.lados.push({ lado, mano, giro, cadena });
    }
    this.reposo = new Map();
    for (const { cadena, giro } of this.lados) {
      for (const b of [...cadena, giro].filter(Boolean)) this.reposo.set(b, b.quaternion.clone());
    }
    return this.lados.length > 0;
  }

  /** Valor del hueso en una acción, o el reposo si su clip no lo anima. */
  #valor(contrib, hueso) {
    if (!contrib.accion) return this.reposo.get(hueso);
    const clip = contrib.accion.getClip();
    let mapa = this.pistas.get(clip);
    if (!mapa) {
      mapa = new Map();
      for (const pista of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(pista.name);
        if (propertyName === 'quaternion') mapa.set(nodeName, pista.createInterpolant());
      }
      this.pistas.set(clip, mapa);
    }
    const interp = mapa.get(hueso.name);
    if (!interp) return this.reposo.get(hueso);
    const t = Math.min(contrib.accion.time, clip.duration);
    return new THREE.Quaternion().fromArray(interp.evaluate(t)).normalize();
  }

  /** Orientación de la mano respecto a lo que está por encima de la cadena. */
  #orientacion(cadena, valorDe) {
    const q = new THREE.Quaternion();
    for (let i = cadena.length - 1; i >= 0; i--) q.multiply(valorDe(cadena[i]));
    return q;
  }

  afterMixer() {
    const { mixer, actions } = this.viewer;
    if (!this.activa || !mixer || !actions) return;
    if (!this.lados?.length) return;

    // Qué suena ahora y con cuánto peso, igual que lo suma el mixer.
    const contribs = [];
    let suma = 0;
    for (const accion of [...actions.values()].flat()) {
      if (!accion.isRunning() && !accion.isScheduled()) continue;
      const peso = accion.getEffectiveWeight();
      if (peso > MIN_PESO && accion.enabled) {
        contribs.push({ accion, peso });
        suma += peso;
      }
    }
    if (suma < 1 - MIN_PESO) contribs.push({ accion: null, peso: 1 - suma }); // el mixer completa con el reposo
    if (contribs.length < 2) return;

    for (const ladoInfo of this.lados) this.#mezclarLado(ladoInfo, contribs);
  }

  #mezclarLado({ lado, mano, giro, cadena }, contribs) {
    const corte = CORTE[lado];
    const reposoMano = this.reposo.get(mano);
    const invReposoMano = reposoMano.clone().invert();
    const invReposoGiro = giro ? this.reposo.get(giro).clone().invert() : null;

    // Primera contribución: punto de partida de la mezcla.
    const estado = (c) => {
      const local = this.#valor(c, mano);
      const rel = invReposoMano.clone().multiply(local);
      const e = {
        Q: this.#orientacion(cadena, (b) => (b === mano ? local : this.#valor(c, b))),
        giroMano: anguloGiro(rel, corte),
      };
      if (giro) {
        const relG = invReposoGiro.clone().multiply(this.#valor(c, giro));
        e.giroAnt = anguloGiro(relG, corte);
        e.columpioAnt = new THREE.Quaternion().setFromAxisAngle(EJE, e.giroAnt).invert().multiply(relG);
      }
      return e;
    };

    let acc = estado(contribs[0]);
    let pesoAcc = contribs[0].peso;
    for (let i = 1; i < contribs.length; i++) {
      const sig = estado(contribs[i]);
      const t = contribs[i].peso / (pesoAcc + contribs[i].peso);
      pesoAcc += contribs[i].peso;

      // Dedos en línea recta de una dirección a la otra.
      const da = _v.copy(EJE).applyQuaternion(acc.Q);
      const db = _w.copy(EJE).applyQuaternion(sig.Q);
      const columpio = new THREE.Quaternion().setFromUnitVectors(da, db);
      // Lo que falta es un giro alrededor de los dedos.
      const resto = columpio.clone().multiply(acc.Q).invert().multiply(sig.Q);
      let th = 2 * Math.atan2(resto.y, resto.w);
      th = ((th + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      // Cerca de media vuelta, girar hacia donde va el antebrazo.
      const dGiro = sig.giroMano - acc.giroMano;
      if (Math.abs(th) > 2.6 && Math.sign(th) !== Math.sign(dGiro) && dGiro !== 0) th -= Math.sign(th) * 2 * Math.PI;

      const Q = new THREE.Quaternion().slerp(columpio, t).multiply(acc.Q)
        .multiply(_q.setFromAxisAngle(EJE, th * t));
      const nuevo = { Q, giroMano: acc.giroMano + dGiro * t };
      if (giro) {
        nuevo.giroAnt = acc.giroAnt + (sig.giroAnt - acc.giroAnt) * t;
        nuevo.columpioAnt = acc.columpioAnt.clone().slerp(sig.columpioAnt, t);
      }
      acc = nuevo;
    }

    // La mano en local: lo que falta tras la cadena que dejó el mixer.
    const padre = this.#orientacion(cadena.slice(1), (b) => b.quaternion);
    mano.quaternion.copy(padre.invert().multiply(acc.Q)).normalize();
    if (giro) {
      giro.quaternion.copy(this.reposo.get(giro))
        .multiply(_q.setFromAxisAngle(EJE, acc.giroAnt))
        .multiply(acc.columpioAnt).normalize();
    }
  }
}
