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
 */
export const EXPRESIONES = {
  neutral: { rostro: {} },
  sonrisa: { rostro: { sonrisa_abierta: 0.8, ojos_entrecerrados: 0.4 } },
  cejas_arriba: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.4 } },
  ceno: { rostro: { cejas_abajo: 1, ojos_enojo: 0.5 } },
  boca_abierta: { rostro: { boca_abierta: 0.8 } },
  sorpresa: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.9, boca_fruncida: 0.9 } },
  tristeza: { rostro: { cejas_centro_arriba: 1, ojos_tristes: 0.8, boca_triste: 0.9 } },
  ruego: { rostro: { cejas_centro_arriba: 0.7, sonrisa: 0.3 } }, // petición amable (POR_FAVOR)
  enojo: { rostro: { cejas_abajo: 1, ojos_enojo: 1, boca_apretada: 0.9 } },
  duda: { rostro: { ceja_izq_arriba: 1, boca_lado: 1 } },
  guino: { rostro: { guino: 1, sonrisa: 0.8 } },
  risa: { rostro: { ojos_felices: 1, sonrisa_abierta: 1, cejas_arriba: 0.3 } },
  asco: { rostro: { nariz_arrugada: 1, cejas_abajo: 0.6, labio_sup_arriba: 0.5 } },
  // Rasgos no manuales frecuentes en lengua de señas.
  pregunta_si_no: { rostro: { cejas_arriba: 1, ojos_abiertos: 0.5 } },   // cejas arriba
  pregunta_abierta: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.3 } }, // ceño
  mejillas_infladas: { rostro: { mejillas_infladas: 1 } },
  mejillas_hundidas: { rostro: { mejillas_hundidas: 1 } },
  labios_fruncidos: { rostro: { labios_fruncidos: 1 } },
  lengua_fuera: { rostro: { lengua_fuera: 1 } },
  // v58 · Rostro del intérprete real (video "Vocabulario Básico 2", Fundesor).
  // El ceño de pregunta_abierta acompaña toda la pregunta; sobre la seña
  // interrogativa misma la boca también se mueve:
  pregunta_wh: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.3, boca_triste: 1, boca_apretada: 0.35 } }, // ¿dónde?, ¿cómo?, ¿por qué?, ¿quién?: comisuras abajo
  pregunta_que: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.5, labio_sup_arriba: 0.6, labios_estirados: 0.4, boca_abierta: 0.15 } }, // ¿qué?: labio arriba, dientes
  pregunta_cuando: { rostro: { ceno: 1, cejas_abajo: 0.4, ojos_entrecerrados: 0.2, labios_fruncidos: 0.8, boca_fruncida: 0.3 } }, // ¿cuándo?: labios en trompa
  pregunta_cuanto: { rostro: { ceno: 1, cejas_abajo: 0.5, ojos_entrecerrados: 0.7, boca_apretada: 0.5, boca_triste: 0.35 } }, // ¿cuánto?, ¿cuál?: ojos entrecerrados
  // Pronombres: labios hacia adelante; en ÉL/ELLA la mirada sigue al índice.
  pronombre: { rostro: { labios_fruncidos: 0.6 } },
  pronombre_izq: { rostro: { labios_fruncidos: 0.5, mirada_izq: 0.8 } },
  pronombre_der: { rostro: { labios_fruncidos: 0.5, mirada_der: 0.8 } },
  asentir: { rostro: { sonrisa: 0.4 }, cabeza: 'asentir' },
  negar: { rostro: { cejas_abajo: 0.5 }, cabeza: 'negar' },
};

const VELOCIDAD_ROSTRO = 14; // Con 14, llega al 95 % del gesto en unos 0,2 s.
const VELOCIDAD_CABEZA = 9; // La cabeza pesa más que la piel: reacciona más lento.
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
   */
  constructor({ mallas, cabeza = null, modelo }) {
    this.modelo = modelo;
    this.#cabeza = cabeza;

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

    const { rostro, cabeza } = EXPRESIONES[clave];

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
    this.#actualizarCabeza(delta);
  }

  /**
   * Deshace el gesto de cabeza después de dibujar. Si el clip no anima la
   * cabeza, nadie reescribe ese hueso y el giro se acumularía cuadro a cuadro.
   */
  afterRender() {
    if (!this.#cabezaModificada) return;
    this.#cabeza.quaternion.copy(this.#rotacionBase);
    this.#cabezaModificada = false;
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
