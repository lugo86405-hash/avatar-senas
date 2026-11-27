/**
 * Avatar Señas · Módulo 2: Secuenciador de señas
 *
 * Recibe la lista de glosas, carga cada clip desde ./animations/ y las reproduce
 * en orden, con transiciones suaves y la expresión facial de cada seña.
 *
 * Módulo 4: si una entrada trae "archivo" (lo envía el backend), se carga esa
 * ruta en lugar de construirla desde la glosa. Así funcionan las letras del
 * deletreo, que viven en animations/letras/letra_x.glb.
 *
 * Línea de tiempo de dos señas con una transición de 0,25 s:
 *
 *   HOLA    ████████████▓▓▓░            ▓ = se desvanece mientras termina
 *   GRACIAS            ░▓▓▓████████████  ░ = aparece mientras empieza
 *                      └─┘ cross-fade
 *
 * La siguiente seña empieza antes de que termine la anterior. Si esperara al
 * final, el brazo se detendría un instante entre señas y se vería robótico.
 *
 * Modo en vivo (v51): encolarGlosas() agrega señas al final de la cola sin
 * cortar la que suena, y `velocidad` acelera las próximas señas cuando el avatar
 * se atrasa frente a quien habla. Cada entrada puede traer un `lote` (la frase de
 * la que viene) para medir el retraso y para descartar frases enteras si hace falta.
 *
 * Eventos (addEventListener):
 *   'cargando' → detail: { glosas }
 *   'sena'     → detail: { glosa, indice, total, expresion, duracion, lote }
 *   'encolada' → detail: { lote, glosas }
 *   'fin'      → detail: resultado de la secuencia
 *   'aviso'    → detail: { glosa, motivo }
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CONFIG_SECUENCIA = {
  carpeta: './animations/',
  extensiones: ['glb', 'gltf'], // Se prueban en este orden.
  transicion: 0.25, // Segundos. Se limita a [transicionMin, transicionMax].
  transicionMin: 0.2,
  transicionMax: 0.3,
  // Entrar y salir del reposo es más largo: la mano sube desde la cadera y, en
  // 0,25 s, recorrería casi un metro. Entre señas el recorrido es mucho menor.
  transicionIdle: 0.4,
  clipIdle: 'Reposo', // Clip del avatar al que se vuelve si no hay clip de espera.
  // v64: animación de espera (manos juntas frente al abdomen, como los intérpretes).
  // Se descarga de la carpeta de señas; mientras llega, se usa clipIdle.
  clipEspera: 'ESPERA',
  // Se agrega como ?v= a cada clip. Súbelo al regenerar las animaciones: si no,
  // el navegador puede usar un clip viejo de su caché (hecho para otro esqueleto).
  version: 66,
};

export class SecuenciadorSenas extends EventTarget {
  #viewer;
  #facial;
  #config;
  #loader = new GLTFLoader();
  #clips = new Map(); // glosa → Promise<AnimationClip>. Evita descargas repetidas.

  #cola = null; // Señas de la secuencia activa, o null si no hay ninguna.
  #indice = 0;
  #tiempo = 0; // Segundos transcurridos de la seña actual.
  #omitidas = [];
  #resolver = null; // Resuelve la promesa de la secuencia activa.
  #solicitud = 0; // Permite descartar una carga que quedó obsoleta.
  #velocidad = 1; // Multiplica la velocidad de las señas que empiecen desde ahora.
  #cadena = Promise.resolve(); // Mantiene el orden de lo que se encola.

  /**
   * @param {object} viewer Instancia de AvatarViewer.
   * @param {import('./control-facial.js').ControlFacial} facial
   * @param {Partial<typeof CONFIG_SECUENCIA>} [config]
   */
  constructor(viewer, facial, config = {}) {
    super();
    this.#viewer = viewer;
    this.#facial = facial;
    this.#config = { ...CONFIG_SECUENCIA, ...config };
  }

  /** Estado actual, pensado para la interfaz. */
  get estado() {
    const sena = this.#cola?.[this.#indice];
    if (!sena) return { activo: false, glosa: null, indice: 0, total: 0, progreso: 0 };

    return {
      activo: true,
      glosa: sena.glosa,
      indice: this.#indice,
      total: this.#cola.length,
      progreso: Math.min(1, this.#tiempo / this.#dur(sena)),
      lote: sena.lote ?? null,
    };
  }

  /** Velocidad de las próximas señas (1 = normal). Se limita a [0,5; 2]. */
  get velocidad() {
    return this.#velocidad;
  }

  set velocidad(valor) {
    this.#velocidad = THREE.MathUtils.clamp(Number(valor) || 1, 0.5, 2);
  }

  /** Segundos de señas que faltan por mostrar, contando lo que queda de la actual. */
  get pendienteSegundos() {
    if (!this.#cola) return 0;
    let total = Math.max(0, this.#dur(this.#cola[this.#indice]) - this.#tiempo);
    for (let i = this.#indice + 1; i < this.#cola.length; i++) total += this.#dur(this.#cola[i]);
    return total;
  }

  /**
   * Agrega señas al final de la cola sin interrumpir la que se está mostrando.
   * Si no hay nada sonando, empieza de inmediato desde la pose neutral. Las
   * llamadas se atienden en orden aunque sus clips terminen de bajar en otro orden.
   *
   * @param {Array<{glosa: string, archivo?: string, duracion?: number, expresion?: string, palabraOrigen?: string, lote?: *}>} listaGlosas
   * @param {{lote?: *}} [opciones] lote: identificador de la frase, para todas las entradas que no traigan uno.
   * @returns {Promise<{agregadas: number, omitidas: Array<{glosa: string, motivo: string}>, cancelada: boolean}>}
   */
  encolarGlosas(listaGlosas, { lote = null } = {}) {
    if (!Array.isArray(listaGlosas)) {
      throw new TypeError('encolarGlosas espera un arreglo de glosas.');
    }

    const solicitud = this.#solicitud;
    const { validas, omitidas } = this.#normalizar(listaGlosas.map((e) => ({ ...e, lote: e?.lote ?? lote })));
    // Las descargas empiezan ya; la cadena solo decide el orden de llegada a la cola.
    const cargas = Promise.allSettled(validas.map((s) => this.#cargarClip(s.clave, s.glosa, s.archivo)));

    const paso = this.#cadena.then(async () => {
      const resultados = await cargas;
      if (solicitud !== this.#solicitud) return { agregadas: 0, omitidas, cancelada: true };

      const nuevas = [];
      resultados.forEach((carga, i) => {
        const sena = validas[i];
        if (carga.status === 'fulfilled') nuevas.push({ ...sena, duracion: sena.duracion ?? carga.value.duration });
        else omitidas.push({ glosa: sena.glosa, motivo: carga.reason.message });
      });
      omitidas.forEach((aviso) => this.dispatchEvent(new CustomEvent('aviso', { detail: aviso })));

      if (nuevas.length > 0) {
        if (this.#cola) {
          this.#cola.push(...nuevas);
        } else {
          this.#cola = nuevas;
          this.#omitidas = [];
          this.#resolver = null;
          this.#iniciarSena(0);
        }
        this.dispatchEvent(new CustomEvent('encolada', { detail: { lote, glosas: nuevas.map((s) => s.glosa) } }));
      }
      return { agregadas: nuevas.length, omitidas, cancelada: false };
    });

    this.#cadena = paso.catch(() => {});
    return paso;
  }

  /**
   * Descarta frases enteras que todavía no empezaron, de la más vieja a la más
   * nueva, hasta que lo pendiente baje de maxSegundos. Nunca toca la frase que se
   * está mostrando ni la última que llegó. Devuelve los lotes descartados.
   */
  recortarPendientes(maxSegundos) {
    if (!this.#cola) return [];
    const actual = this.#cola[this.#indice];
    const lotes = [...new Set(this.#cola.slice(this.#indice + 1).map((s) => s.lote))]
      .filter((l) => l != null && l !== actual.lote);
    const descartados = [];
    for (const lote of lotes.slice(0, -1)) {
      if (this.pendienteSegundos <= maxSegundos) break;
      this.#cola = this.#cola.filter((s, i) => i <= this.#indice || s.lote !== lote);
      descartados.push(lote);
    }
    return descartados;
  }

  /**
   * Reproduce una lista de glosas, sin que ninguna falla detenga el resto.
   * Una secuencia nueva reemplaza a la activa con una transición suave.
   *
   * @param {Array<{glosa: string, archivo?: string, duracion?: number, expresion?: string, palabraOrigen?: string}>} listaGlosas
   *   - glosa: nombre de la seña. Se normaliza a mayúsculas.
   *   - archivo: ruta del clip. Si falta, se usa ./animations/GLOSA.glb.
   *   - palabraOrigen: palabra que se deletrea, solo para mostrarla.
   *   - duracion: segundos que debe durar. Si falta, usa la duración del clip.
   *   - expresion: clave de EXPRESIONES. Si falta, usa neutral.
   * @returns {Promise<{reproducidas: string[], omitidas: Array<{glosa: string, motivo: string}>, cancelada: boolean}>}
   *   Se resuelve al terminar o al ser reemplazada. Nunca se rechaza por una
   *   animación faltante: esas glosas aparecen en `omitidas`.
   * @throws {TypeError} Si listaGlosas no es un arreglo.
   */
  async reproducirSecuenciaGlosas(listaGlosas) {
    if (!Array.isArray(listaGlosas)) {
      throw new TypeError('reproducirSecuenciaGlosas espera un arreglo de glosas.');
    }

    const solicitud = ++this.#solicitud; // También descarta lo que se estaba encolando.
    const { validas, omitidas } = this.#normalizar(listaGlosas);

    this.dispatchEvent(new CustomEvent('cargando', { detail: { glosas: validas.map((s) => s.glosa) } }));

    // Se carga todo antes de empezar, para no congelar al avatar entre dos
    // señas mientras se descarga la siguiente.
    const cargas = await Promise.allSettled(validas.map((s) => this.#cargarClip(s.clave, s.glosa, s.archivo)));

    if (solicitud !== this.#solicitud) {
      return { reproducidas: [], omitidas, cancelada: true };
    }

    const cola = [];
    cargas.forEach((carga, i) => {
      const sena = validas[i];
      if (carga.status === 'fulfilled') {
        cola.push({ ...sena, duracion: sena.duracion ?? carga.value.duration });
      } else {
        omitidas.push({ glosa: sena.glosa, motivo: carga.reason.message });
      }
    });

    omitidas.forEach((aviso) => {
      console.warn(`[Secuenciador] Se omite ${aviso.glosa}: ${aviso.motivo}`);
      this.dispatchEvent(new CustomEvent('aviso', { detail: aviso }));
    });

    this.#terminarCola(true);

    if (cola.length === 0) {
      const resultado = { reproducidas: [], omitidas, cancelada: false };
      this.dispatchEvent(new CustomEvent('fin', { detail: resultado }));
      return resultado;
    }

    return new Promise((resolve) => {
      this.#cola = cola;
      this.#omitidas = omitidas;
      this.#resolver = resolve;
      this.#iniciarSena(0);
    });
  }

  /**
   * Atajo para probar o reproducir una sola seña.
   * @param {string} glosa
   * @param {{duracion?: number, expresion?: string}} [opciones]
   */
  reproducirGlosa(glosa, opciones = {}) {
    return this.reproducirSecuenciaGlosas([{ glosa, ...opciones }]);
  }

  /** Cancela lo que esté en curso y vuelve a la pose neutral. */
  resetear() {
    this.#solicitud++; // Invalida también las cargas que sigan pendientes.
    this.#terminarCola(true);
    this.#volverAIdle(this.#config.transicionIdle);
    this.dispatchEvent(new CustomEvent('fin', { detail: { reproducidas: [], omitidas: [], cancelada: true } }));
  }

  /**
   * Descarga clips por adelantado. Útil para el vocabulario más frecuente.
   * @param {string[]} glosas
   */
  precargar(glosas) {
    return Promise.allSettled(glosas.map((glosa) => this.#cargarClip(this.#formatearGlosa(glosa))));
  }

  /**
   * Avanza la cola. Depende del delta del bucle de renderizado y no de
   * setTimeout: comparte reloj con el mixer, así que una caída de cuadros o
   * una pestaña oculta no pueden desincronizar las señas de sus animaciones.
   */
  beforeMixer(delta) {
    if (!this.#cola) return;

    this.#tiempo += delta;

    const sena = this.#cola[this.#indice];
    const siguiente = this.#cola[this.#indice + 1];

    const fade = siguiente ? this.#fade(sena, siguiente) : this.#fadeIdle(sena);
    if (this.#tiempo < this.#dur(sena) - fade) return;

    if (siguiente) {
      this.#iniciarSena(this.#indice + 1);
    } else {
      this.#terminarCola(false);
      this.#volverAIdle(this.#fadeIdle(sena));
    }
  }

  /* ----- Reproducción ----------------------------------------------------- */

  #iniciarSena(indice) {
    const sena = this.#cola[indice];
    const anterior = this.#cola[indice - 1];
    const fade = anterior ? this.#fade(anterior, sena) : this.#fadeIdle(sena);

    this.#indice = indice;
    this.#tiempo = 0;
    sena.dur = sena.duracion / this.#velocidad; // La velocidad queda fija para esta seña.

    this.#viewer.play(sena.clave, {
      loop: false,
      duration: sena.dur,
      fade,
    });

    // En vivo la cola no termina nunca: se olvidan las señas ya mostradas.
    if (this.#indice > 60) {
      this.#cola.splice(0, this.#indice - 1);
      this.#indice = 1;
      indice = 1;
    }

    // Rostro y manos reciben la orden en el mismo cuadro.
    this.#facial.setExpresion(sena.expresion);
    this.#facial.setEnEspera?.(false);

    this.dispatchEvent(new CustomEvent('sena', {
      detail: {
        glosa: sena.glosa,
        indice,
        total: this.#cola.length,
        expresion: this.#facial.expresion,
        duracion: sena.dur,
        palabraOrigen: sena.palabraOrigen,
        lote: sena.lote ?? null,
      },
    }));
  }

  /**
   * Duración de la transición entre dos señas. Una seña muy corta no puede
   * pasar la mayor parte de su tiempo en transición, o no llegaría a verse.
   */
  #fade(...senas) {
    const { transicion, transicionMin, transicionMax } = this.#config;
    const base = THREE.MathUtils.clamp(transicion, transicionMin, transicionMax);
    const duraciones = senas.filter(Boolean).map((sena) => this.#dur(sena) * 0.4);
    return Math.min(base, ...duraciones);
  }

  /** Transición entre una seña y el reposo, con el mismo límite por seña corta. */
  #fadeIdle(sena) {
    return Math.min(this.#config.transicionIdle, this.#dur(sena) * 0.4);
  }

  /** Duración real de una seña: la fijada al empezar, o la que tendría a la velocidad actual. */
  #dur(sena) {
    return sena.dur ?? sena.duracion / this.#velocidad;
  }

  #terminarCola(cancelada) {
    if (!this.#cola) return;

    const resultado = {
      reproducidas: this.#cola.slice(0, this.#indice + 1).map((sena) => sena.glosa),
      omitidas: this.#omitidas,
      cancelada,
    };

    this.#cola = null;
    this.#resolver?.(resultado);
    this.#resolver = null;

    if (!cancelada) this.dispatchEvent(new CustomEvent('fin', { detail: resultado }));
  }

  #volverAIdle(fade) {
    this.#facial.setExpresion('neutral');
    this.#facial.setEnEspera?.(true);

    const { clipEspera, clipIdle } = this.#config;
    if (clipEspera && this.#viewer.clipNames.includes(clipEspera)) {
      this.#viewer.play(clipEspera, { loop: true, fade });
      return;
    }
    if (this.#viewer.clipNames.includes(clipIdle)) {
      this.#viewer.play(clipIdle, { loop: true, fade });
    } else {
      this.#viewer.stop(fade);
    }
    // La primera vez el clip de espera aún no está: se descarga y, si el avatar
    // sigue quieto cuando llega, pasa a él con calma.
    if (clipEspera) {
      const solicitud = this.#solicitud;
      this.#cargarClip(clipEspera).then(() => {
        if (this.#cola === null && solicitud === this.#solicitud) this.#volverAIdle(0.8);
      }, () => { this.#config.clipEspera = null; }); // Sin clip de espera: se queda el reposo.
    }
  }

  /* ----- Validación y carga ------------------------------------------------ */

  #formatearGlosa(glosa) {
    return String(glosa).trim().toLocaleUpperCase('es');
  }

  #normalizar(lista) {
    const validas = [];
    const omitidas = [];

    for (const entrada of lista) {
      const glosa = entrada?.glosa ? this.#formatearGlosa(entrada.glosa) : '';
      if (!glosa) {
        omitidas.push({ glosa: String(entrada?.glosa ?? '(vacía)'), motivo: 'La entrada no tiene glosa.' });
        continue;
      }

      const { duracion, expresion, palabraOrigen, lote } = entrada;
      const archivo = typeof entrada.archivo === 'string' && entrada.archivo.trim() ? entrada.archivo.trim() : null;
      validas.push({
        glosa,
        archivo,
        // Nombre del clip en el visor. Con archivo se usa la ruta, para que la
        // letra "A" no choque con una seña llamada "A".
        clave: archivo ?? glosa,
        duracion: Number.isFinite(duracion) && duracion > 0 ? duracion : null,
        expresion: expresion ?? 'neutral',
        palabraOrigen: palabraOrigen ?? null,
        lote: lote ?? null,
      });
    }

    return { validas, omitidas };
  }

  #cargarClip(clave, glosa = clave, archivo = null) {
    if (!this.#clips.has(clave)) {
      const carga = this.#descargarClip(clave, glosa, archivo).catch((error) => {
        this.#clips.delete(clave); // Un fallo de red no debe quedar guardado.
        throw error;
      });
      this.#clips.set(clave, carga);
    }
    return this.#clips.get(clave);
  }

  async #descargarClip(clave, glosa, archivo) {
    // Ruta enviada por el backend: se usa tal cual.
    if (archivo) {
      // El backend envía "animations/…": se usa la carpeta del avatar cargado.
      archivo = archivo.replace(/^(\.\/)?animations\//, this.#config.carpeta);
      try {
        const gltf = await this.#loader.loadAsync(encodeURI(archivo) + this.#sufijoVersion()); // encodeURI conserva las "/".
        const clip = this.#prepararClip(gltf, glosa, clave);
        this.#viewer.addClip(clip);
        return clip;
      } catch (error) {
        throw new Error(`No se encontró una animación válida en ${archivo}: ${error?.message ?? 'sin detalle'}`);
      }
    }

    const { carpeta, extensiones } = this.#config;
    let ultimoError = null;

    for (const extension of extensiones) {
      const url = `${carpeta}${encodeURIComponent(glosa)}.${extension}${this.#sufijoVersion()}`; // Admite Ñ y tildes.
      try {
        const gltf = await this.#loader.loadAsync(url);
        const clip = this.#prepararClip(gltf, glosa, clave);
        this.#viewer.addClip(clip);
        return clip;
      } catch (error) {
        ultimoError = error;
      }
    }

    const detalle = ultimoError?.message ?? 'sin detalle';
    throw new Error(`No se encontró una animación válida en ${carpeta}${glosa}: ${detalle}`);
  }

  #sufijoVersion() {
    const v = this.#config.version;
    return v ? `?v=${encodeURIComponent(v)}` : '';
  }

  /**
   * Deja solo las pistas que el avatar puede usar:
   * - rotaciones de huesos existentes, y
   * - la posición del hueso raíz, para movimientos de todo el cuerpo.
   * Se descartan las escalas y las posiciones de los demás huesos, que pueden
   * deformar al avatar. También los morph targets del clip, porque el rostro
   * lo controla ControlFacial a partir del campo "expresion".
   */
  #prepararClip(gltf, glosa, nombre = glosa) {
    const original = gltf.animations.find((clip) => clip.name === glosa) ?? gltf.animations[0];
    if (!original) throw new Error('el archivo no contiene animaciones');

    const { bones } = this.#viewer;
    const pistas = original.tracks.filter((pista) => {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(pista.name);
      const hueso = bones.get(nodeName);
      if (!hueso) return false;
      return propertyName === 'quaternion' || (propertyName === 'position' && !hueso.parent?.isBone);
    });

    if (pistas.length === 0) {
      throw new Error('sus huesos no coinciden con los del avatar');
    }

    return new THREE.AnimationClip(nombre, original.duration, pistas);
  }
}
