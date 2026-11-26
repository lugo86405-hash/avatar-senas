/**
 * Avatar Señas · Módulo 2: Control facial
 *
 * Convierte nombres de expresión ("sonrisa", "asentir") en movimiento del rostro
 * y de la cabeza. Tiene tres capas, de la más concreta a la más general:
 *
 *   Morph target → la forma real guardada en el modelo ('mouth-open').
 *   BLENDSHAPES  → nombre lógico estable que usa el proyecto (boca_abierta).
 *   EXPRESIONES  → lo que llega en el JSON de glosas ("sonrisa", "asentir").
 *
 * Si cambias de avatar, normalmente basta con editar BLENDSHAPES. El resto del
 * proyecto, incluido el servicio de NLP, no se entera del cambio.
 */

import * as THREE from 'three';

/* ==========================================================================
   Configuración
   ========================================================================== */

/**
 * Nombre lógico → morph targets del modelo y su peso (0–1).
 * Las claves internas deben coincidir exactamente con los shape keys del .glb.
 * Compruébalas en la consola con: avatarViewer.expressionNames
 */
export const BLENDSHAPES = {
  // Avatar realista: las claves internas son los 35 shape keys de la malla 'Cara'.
  // "izq" y "der" son la izquierda y la derecha del avatar.
  cejas_arriba: { ceja_int_izq: 1, ceja_int_der: 1, ceja_ext_izq: 1, ceja_ext_der: 1 },
  cejas_abajo: { ceja_baja_izq: 1, ceja_baja_der: 1, ceno: 1 },
  cejas_centro_arriba: { ceja_int_izq: 1, ceja_int_der: 1 },
  ceja_izq_arriba: { ceja_int_izq: 0.8, ceja_ext_izq: 1 },
  ceja_der_arriba: { ceja_int_der: 0.8, ceja_ext_der: 1 },
  ceno: { ceno: 1 },
  ojos_abiertos: { ojo_abierto_izq: 1, ojo_abierto_der: 1 },
  ojos_entrecerrados: { ojo_entrecerrado_izq: 1, ojo_entrecerrado_der: 1 },
  ojos_cerrados: { parpado_izq_cerrado: 1, parpado_der_cerrado: 1 },
  ojos_felices: { ojo_entrecerrado_izq: 1, ojo_entrecerrado_der: 1, parpado_izq_cerrado: 0.2, parpado_der_cerrado: 0.2 },
  ojos_enojo: { ojo_entrecerrado_izq: 0.5, ojo_entrecerrado_der: 0.5 },
  ojos_tristes: { parpado_izq_cerrado: 0.25, parpado_der_cerrado: 0.25 },
  guino: { parpado_der_cerrado: 1, ojo_entrecerrado_der: 0.5 },
  mirada_izq: { mirada_izq: 1 },
  mirada_der: { mirada_der: 1 },
  mirada_arriba: { mirada_arriba: 1 },
  mirada_abajo: { mirada_abajo: 1 },
  nariz_arrugada: { nariz_arrugada: 1 },
  mejillas_infladas: { mejilla_inflada_izq: 1, mejilla_inflada_der: 1 },
  mejilla_izq_inflada: { mejilla_inflada_izq: 1 },
  mejilla_der_inflada: { mejilla_inflada_der: 1 },
  mejillas_hundidas: { mejillas_hundidas: 1 },
  boca_abierta: { mandibula_abierta: 1 },
  boca_fruncida: { labios_o: 1 },
  labios_fruncidos: { labios_fruncidos: 1 },
  labios_estirados: { labios_estirados: 1 },
  boca_apretada: { labios_apretados: 1 },
  boca_triste: { boca_triste_izq: 1, boca_triste_der: 1 },
  boca_lado: { boca_izq: 1 },
  labio_sup_arriba: { labio_sup_arriba: 1 },
  labio_inf_abajo: { labio_inf_abajo: 1 },
  lengua_fuera: { lengua_fuera: 1 },
  sonrisa: { sonrisa_izq: 1, sonrisa_der: 1 },
  sonrisa_abierta: { sonrisa_izq: 1, sonrisa_der: 1, mandibula_abierta: 0.3, labio_sup_arriba: 0.3 },
};

/**
 * Gestos de cabeza: giran el hueso de la cabeza con un movimiento periódico.
 * Asentir y negar no son blendshapes, porque mueven el cráneo y no la piel.
 * El eje usa coordenadas del avatar: X = izquierda/derecha, Y = arriba/abajo.
 */
export const GESTOS_CABEZA = {
  asentir: { eje: [1, 0, 0], amplitud: 0.16, frecuencia: 1.7 },
  negar: { eje: [0, 1, 0], amplitud: 0.2, frecuencia: 1.9 },
};

/**
 * Valores válidos para el campo "expresion" del JSON de glosas.
 * - rostro: nombre de BLENDSHAPES → intensidad (0–1).
 * - cabeza: nombre de GESTOS_CABEZA (opcional).
 * - postura (v61, opcional): inclinación sostenida mientras dura la expresión,
 *   en grados y sumada a lo que hace el clip. columna = tronco hacia adelante (+)
 *   o atrás (−); cuello y cabeza = hacia adelante/abajo (+) o atrás/arriba (−);
 *   ladeo = la cabeza hacia un hombro. Ej.: en una pregunta de sí o no el cuerpo
 *   se inclina un poco hacia la otra persona.
 */
export const EXPRESIONES = {
  neutral: { rostro: {} },
  sonrisa: { rostro: { sonrisa_abierta: 0.8, ojos_entrecerrados: 0.4 } },
  cejas_arriba: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.4 } },
  ceno: { rostro: { cejas_abajo: 1, ojos_enojo: 0.5 } },
  boca_abierta: { rostro: { boca_abierta: 0.8 } },
  sorpresa: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.9, boca_fruncida: 0.9 }, postura: { columna: -4, cabeza: -4 } },
  tristeza: { rostro: { cejas_centro_arriba: 1, ojos_tristes: 0.8, boca_triste: 0.9 }, postura: { cuello: 3, cabeza: 7 } },
  ruego: { rostro: { cejas_centro_arriba: 0.8, ojos_entrecerrados: 0.6, boca_apretada: 0.3, sonrisa: 0.15 }, postura: { columna: 3, ladeo: 5 } }, // petición (POR_FAVOR, PERMISO); v59 según el video
  enojo: { rostro: { cejas_abajo: 1, ojos_enojo: 1, boca_apretada: 0.9 }, postura: { columna: 2, cabeza: 3 } },
  duda: { rostro: { ceja_izq_arriba: 1, boca_lado: 1 }, postura: { ladeo: -5 } },
  guino: { rostro: { guino: 1, sonrisa: 0.8 } },
  risa: { rostro: { ojos_felices: 1, sonrisa_abierta: 1, cejas_arriba: 0.3 }, postura: { cabeza: -4 } },
  asco: { rostro: { nariz_arrugada: 1, cejas_abajo: 0.6, labio_sup_arriba: 0.5 }, postura: { columna: -3, cabeza: -2 } },
  // Rasgos no manuales frecuentes en lengua de señas.
  pregunta_si_no: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.5 }, postura: { columna: 5, cuello: 3, cabeza: 3 } },   // cejas arriba
  pregunta_abierta: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.3 }, postura: { columna: 3, ladeo: 4 } }, // ceño
  mejillas_infladas: { rostro: { mejillas_infladas: 1 } },
  mejillas_hundidas: { rostro: { mejillas_hundidas: 1 } },
  labios_fruncidos: { rostro: { labios_fruncidos: 1 } },
  lengua_fuera: { rostro: { lengua_fuera: 1 } },
  // v58 · Rostro del intérprete real (video "Vocabulario Básico 2", Fundesor).
  // El ceño de pregunta_abierta acompaña toda la pregunta; sobre la seña
  // interrogativa misma la boca también se mueve:
  pregunta_wh: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.3, boca_triste: 1, boca_apretada: 0.35 }, postura: { columna: 3 } }, // ¿dónde?, ¿cómo?, ¿por qué?, ¿quién?: comisuras abajo
  pregunta_que: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.5, labio_sup_arriba: 0.6, labios_estirados: 0.4, boca_abierta: 0.15 }, postura: { columna: 3 } }, // ¿qué?: labio arriba, dientes
  pregunta_cuando: { rostro: { ceno: 1, cejas_abajo: 0.4, ojos_entrecerrados: 0.2, labios_fruncidos: 0.8, boca_fruncida: 0.3 }, postura: { columna: 3 } }, // ¿cuándo?: labios en trompa
  pregunta_cuanto: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.7, boca_apretada: 0.5, boca_triste: 0.35 }, postura: { columna: 3 } }, // ¿cuánto?, ¿cuál?: ojos entrecerrados
  // v59 · Saludos y cortesía (video "Vocabulario Básico 1", Fundesor).
  pregunta_amable: { rostro: { cejas_arriba: 0.8, ojos_abiertos: 0.3, sonrisa: 0.45 }, postura: { columna: 3, ladeo: 4 } }, // ¿cómo estás?: cejas arriba y media sonrisa
  contento: { rostro: { cejas_arriba: 0.5, ojos_abiertos: 0.3, sonrisa: 0.55 }, postura: { cabeza: -3 } },       // BIEN
  sonrisa_suave: { rostro: { sonrisa: 0.5, ojos_entrecerrados: 0.5 } },                  // GRACIAS, CON GUSTO, BUENAS TARDES
  somnoliento: { rostro: { ojos_cerrados: 0.45, ojos_entrecerrados: 0.4, sonrisa: 0.2 }, postura: { cabeza: 3, ladeo: 6 } }, // BUENAS NOCHES
  pena: { rostro: { cejas_centro_arriba: 1, ceno: 0.3, boca_triste: 0.6, boca_apretada: 0.4 }, postura: { cuello: 2, cabeza: 5 } }, // PERDÓN
  lo_siento: { rostro: { cejas_centro_arriba: 0.8, ojos_cerrados: 0.8, boca_triste: 0.7 }, postura: { cuello: 3, cabeza: 8 } },   // LO SIENTO: ojos cerrados
  alegre: { rostro: { cejas_arriba: 0.7, ojos_abiertos: 0.3, sonrisa_abierta: 0.7 }, postura: { cabeza: -4 } },  // FELIZ CUMPLEAÑOS
  // Pronombres: labios hacia adelante; en ÉL/ELLA la mirada sigue al índice.
  pronombre: { rostro: { labios_fruncidos: 0.6 } },
  pronombre_izq: { rostro: { labios_fruncidos: 0.5, mirada_izq: 0.8 } },
  pronombre_der: { rostro: { labios_fruncidos: 0.5, mirada_der: 0.8 } },
  asentir: { rostro: { sonrisa: 0.4 }, cabeza: 'asentir' },
  negar: { rostro: { cejas_abajo: 0.5 }, cabeza: 'negar' },
};

const VELOCIDAD_ROSTRO = 14; // Con 14, llega al 95 % del gesto en unos 0,2 s.
const VELOCIDAD_CABEZA = 9; // La cabeza pesa más que la piel: reacciona más lento.
const VELOCIDAD_POSTURA = 5; // El tronco es aún más lento: llega en unos 0,6 s.
const GRADOS = Math.PI / 180;
// Hueso, eje del avatar y parte de cada componente de la postura que recibe.
// La inclinación del tronco se reparte entre las tres vértebras para que se curve.
const REPARTO_POSTURA = [
  ['columna', 'columna0', [1, 0, 0], 0.3], ['columna', 'columna1', [1, 0, 0], 0.35], ['columna', 'columna2', [1, 0, 0], 0.35],
  ['cuello', 'cuello', [1, 0, 0], 1], ['cabeza', 'cabeza', [1, 0, 0], 1], ['ladeo', 'cabeza', [0, 0, 1], 1],
];
const UMBRAL = 0.001; // Por debajo de este valor se considera que ya llegó.

/* ==========================================================================
   ControlFacial
   ========================================================================== */

export class ControlFacial {
  #morphs = new Map(); // nombre → { actual, objetivo, destinos: [[malla, índice]] }
  #gestos = new Map(); // nombre → { eje, frecuencia, amplitud, objetivo, fase }
  #cabeza = null;
  #rotacionBase = new THREE.Quaternion();
  #cabezaModificada = false;
  #huesosPostura = {}; // columna0..2, cuello, cabeza
  #postura = { columna: { actual: 0, objetivo: 0 }, cuello: { actual: 0, objetivo: 0 },
    cabeza: { actual: 0, objetivo: 0 }, ladeo: { actual: 0, objetivo: 0 } };
  #basesPostura = new Map(); // hueso → rotación del clip, para deshacer después de dibujar
  #qPostura = new THREE.Quaternion();
  #qHueso = new THREE.Quaternion();
  #ejePostura = new THREE.Vector3();

  // Objetos reutilizados: evitan crear basura en cada cuadro de animación.
  #ejeMundo = new THREE.Vector3();
  #qModelo = new THREE.Quaternion();
  #qCabeza = new THREE.Quaternion();
  #qGesto = new THREE.Quaternion();

  /** Nombre de la expresión activa. */
  expresion = 'neutral';

  /**
   * @param {object} opciones
   * @param {THREE.Mesh[]} opciones.mallas Mallas con morph targets.
   * @param {THREE.Bone} [opciones.cabeza] Hueso para asentir y negar.
   * @param {THREE.Object3D} opciones.modelo Raíz del avatar.
   * @param {object} [opciones.huesos] Huesos para la postura: columna0, columna1, columna2, cuello.
   */
  constructor({ mallas, cabeza = null, modelo, huesos = {} }) {
    this.modelo = modelo;
    this.#cabeza = cabeza;
    this.#huesosPostura = { ...huesos, cabeza };

    // Un modelo con varios materiales llega dividido en varias mallas. Cada
    // morph se registra en todas, porque si una parte no recibe el valor, la
    // cara se abre por las uniones entre materiales.
    for (const malla of mallas) {
      for (const [nombre, indice] of Object.entries(malla.morphTargetDictionary)) {
        if (!this.#morphs.has(nombre)) {
          this.#morphs.set(nombre, { actual: 0, objetivo: 0, destinos: [] });
        }
        this.#morphs.get(nombre).destinos.push([malla, indice]);
      }
    }

    for (const [nombre, { eje, amplitud, frecuencia }] of Object.entries(GESTOS_CABEZA)) {
      this.#gestos.set(nombre, {
        eje: new THREE.Vector3(...eje).normalize(),
        amplitudMaxima: amplitud,
        frecuencia,
        amplitud: 0,
        objetivo: 0,
        fase: 0,
      });
    }

    this.#avisarBlendshapesFaltantes();
  }

  /**
   * Cambia de expresión. Solo fija el objetivo: el cambio visible ocurre poco a
   * poco en update(), para que el rostro nunca salte.
   *
   * @param {string} [nombre] Clave de EXPRESIONES. Si no existe, usa neutral.
   */
  setExpresion(nombre = 'neutral') {
    const clave = Object.hasOwn(EXPRESIONES, nombre) ? nombre : 'neutral';
    if (clave !== nombre) {
      console.warn(`[ControlFacial] Expresión desconocida: "${nombre}". Se usa neutral.`);
    }
    this.expresion = clave;

    const { rostro, cabeza, postura = {} } = EXPRESIONES[clave];
    for (const [parte, valor] of Object.entries(this.#postura)) valor.objetivo = (postura[parte] ?? 0) * GRADOS;

    for (const morph of this.#morphs.values()) morph.objetivo = 0;

    for (const [logico, intensidad] of Object.entries(rostro)) {
      for (const [nombreMorph, peso] of Object.entries(BLENDSHAPES[logico] ?? {})) {
        const morph = this.#morphs.get(nombreMorph);
        if (morph) morph.objetivo = Math.min(1, morph.objetivo + peso * intensidad);
      }
    }

    for (const [nombreGesto, gesto] of this.#gestos) {
      const activo = nombreGesto === cabeza;
      // Si el gesto arranca desde cero, también empieza su ciclo desde cero.
      if (activo && gesto.amplitud < UMBRAL) gesto.fase = 0;
      gesto.objetivo = activo ? gesto.amplitudMaxima : 0;
    }
  }

  /** @param {number} delta Segundos desde el cuadro anterior. */
  afterMixer(delta) {
    this.#actualizarRostro(delta);
    this.#actualizarPostura(delta);
    this.#actualizarCabeza(delta);
  }

  /**
   * Deshace el gesto de cabeza después de dibujar. Si el clip no anima la
   * cabeza, nadie reescribe ese hueso y el giro se acumularía cuadro a cuadro.
   */
  afterRender() {
    if (this.#cabezaModificada) {
      this.#cabeza.quaternion.copy(this.#rotacionBase);
      this.#cabezaModificada = false;
    }
    // La postura también se deshace: el próximo cuadro parte otra vez del clip.
    for (const [hueso, base] of this.#basesPostura) hueso.quaternion.copy(base);
    this.#basesPostura.clear();
  }

  /** Inclinación sostenida (v61): se suma a la pose del clip, hueso por hueso. */
  #actualizarPostura(delta) {
    const factor = 1 - Math.exp(-VELOCIDAD_POSTURA * delta);
    let hayPostura = false;
    for (const valor of Object.values(this.#postura)) {
      valor.actual = THREE.MathUtils.lerp(valor.actual, valor.objetivo, factor);
      if (Math.abs(valor.actual - valor.objetivo) < UMBRAL * GRADOS) valor.actual = valor.objetivo;
      if (valor.actual !== 0) hayPostura = true;
    }
    if (!hayPostura) return;

    this.modelo.getWorldQuaternion(this.#qModelo);
    // De la cadera hacia arriba: cada hueso usa su orientación ya inclinada.
    for (const [parte, nombreHueso, eje, peso] of REPARTO_POSTURA) {
      const hueso = this.#huesosPostura[nombreHueso];
      const angulo = this.#postura[parte].actual * peso;
      if (!hueso || angulo === 0) continue;
      if (!this.#basesPostura.has(hueso)) this.#basesPostura.set(hueso, hueso.quaternion.clone());
      // Igual que en los gestos: el eje del avatar se lleva al espacio del hueso.
      hueso.getWorldQuaternion(this.#qHueso).invert();
      this.#ejePostura.set(...eje).applyQuaternion(this.#qModelo).applyQuaternion(this.#qHueso).normalize();
      this.#qPostura.setFromAxisAngle(this.#ejePostura, angulo);
      hueso.quaternion.multiply(this.#qPostura);
      hueso.updateMatrixWorld(true);
    }
  }

  #actualizarRostro(delta) {
    // El lerp clásico con un factor fijo iría más rápido a 144 Hz que a 60 Hz.
    // Este factor depende del tiempo y da la misma velocidad en cualquier pantalla.
    const factor = 1 - Math.exp(-VELOCIDAD_ROSTRO * delta);

    for (const morph of this.#morphs.values()) {
      if (morph.actual === morph.objetivo) continue;

      morph.actual = THREE.MathUtils.lerp(morph.actual, morph.objetivo, factor);
      if (Math.abs(morph.actual - morph.objetivo) < UMBRAL) morph.actual = morph.objetivo;

      for (const [malla, indice] of morph.destinos) {
        malla.morphTargetInfluences[indice] = morph.actual;
      }
    }
  }

  #actualizarCabeza(delta) {
    if (!this.#cabeza) return;

    const factor = 1 - Math.exp(-VELOCIDAD_CABEZA * delta);
    let hayGesto = false;

    for (const gesto of this.#gestos.values()) {
      gesto.amplitud = THREE.MathUtils.lerp(gesto.amplitud, gesto.objetivo, factor);
      if (Math.abs(gesto.amplitud - gesto.objetivo) < UMBRAL) gesto.amplitud = gesto.objetivo;
      gesto.fase += delta;
      if (gesto.amplitud > 0) hayGesto = true;
    }

    if (!hayGesto) return;

    this.#rotacionBase.copy(this.#cabeza.quaternion);
    this.#cabezaModificada = true;

    this.modelo.getWorldQuaternion(this.#qModelo);
    this.#cabeza.getWorldQuaternion(this.#qCabeza).invert();

    for (const gesto of this.#gestos.values()) {
      if (gesto.amplitud === 0) continue;

      // Los huesos tienen ejes locales arbitrarios. Se parte del eje del avatar
      // y se traduce al espacio del hueso para que asentir siempre sea asentir.
      this.#ejeMundo.copy(gesto.eje).applyQuaternion(this.#qModelo).applyQuaternion(this.#qCabeza);
      const angulo = gesto.amplitud * Math.sin(2 * Math.PI * gesto.frecuencia * gesto.fase);
      this.#qGesto.setFromAxisAngle(this.#ejeMundo.normalize(), angulo);
      this.#cabeza.quaternion.multiply(this.#qGesto);
    }
  }

  #avisarBlendshapesFaltantes() {
    const faltantes = Object.values(BLENDSHAPES)
      .flatMap((pesos) => Object.keys(pesos))
      .filter((nombre) => !this.#morphs.has(nombre));

    if (faltantes.length > 0) {
      console.warn('[ControlFacial] El modelo no tiene estos blendshapes:', faltantes);
    }
  }
}
