/**
 * Avatar Señas · Intérprete en vivo (v51)
 *
 * Escucha sin parar (reconocimiento de voz del navegador), corta lo que oye en
 * frases, las traduce una por una con el cerebro lingüístico y las va poniendo
 * en la cola del secuenciador sin cortar la seña que se está mostrando.
 *
 * Como en un noticiero se habla más rápido de lo que se seña, el avatar se
 * atrasa. Para no quedarse varias frases atrás:
 *   1. Si lo pendiente pasa de `objetivo` segundos, las señas se aceleran poco a
 *      poco, hasta `velocidadMax`.
 *   2. Si aun así pasa de `retrasoMax`, se descartan frases enteras que todavía
 *      no empezaron (nunca la que se está mostrando ni la última que llegó),
 *      como hace un intérprete humano cuando resume.
 *
 * Motores de reconocimiento (v52):
 *   'navegador' → el de Chrome/Edge (Web Speech API). Necesita internet y solo
 *                 oye el micrófono.
 *   'whisper'   → Whisper en el propio computador (escucha-whisper.js +
 *                 oido_whisper.py). Sin internet, y puede oír el micrófono, el
 *                 <video> del noticiero o una pestaña.
 *
 * Eventos (addEventListener):
 *   'estado'   → detail: { escuchando, motor, modelo? }
 *   'parcial'  → detail: { texto }            texto que todavía puede cambiar
 *   'frase'    → detail: { id, texto }        frase cerrada, va al cerebro
 *   'glosas'   → detail: { id, texto, datos } respuesta del cerebro
 *   'metricas' → detail: { retraso, velocidad, latencia, frases, omitidas, sinDeletrear, errores }
 *
 * Deletreo en vivo (v53): una palabra que no tiene seña se deletrea letra por
 * letra, y eso tarda mucho (DIMENSIONES son 11 letras, unos 7 s). Una frase de 2 s
 * puede convertirse en 20 s de señas y el avatar se queda atrás. Como hace un
 * intérprete que resume, en vivo:
 *   - Los nombres propios (con mayúscula en medio de la frase: Cartagena, Petro)
 *     se deletrean siempre.
 *   - Las demás palabras sin seña se deletrean solo si el atraso no pasaría de
 *     `holguraDeletreo` segundos; si no, quedan solo en el subtítulo.
 *   - Las letras van `velocidadLetras` veces más rápido que en una frase escrita.
 *   `deletreo`: 'auto' (lo anterior), 'siempre' o 'nombres' (solo nombres propios).
 *   'error'    → detail: { titulo, detalle }
 */

import { EscuchaWhisper } from './escucha-whisper.js?v=55';

export const CONFIG_VIVO = {
  idioma: 'es-CO',
  objetivo: 3, // Segundos pendientes que se aceptan sin acelerar.
  rango: 8, // Segundos extra para llegar a la velocidad máxima.
  velocidadMax: 1.6,
  retrasoMax: 15, // Por encima de esto se descartan frases viejas.
  reinicio: 250, // ms antes de volver a escuchar cuando el navegador corta.
  deletreo: 'auto', // 'auto' | 'siempre' | 'nombres'
  holguraDeletreo: 6, // s de atraso hasta los que se deletrean palabras comunes
  velocidadLetras: 1.3,
};

/** Quita tildes y pasa a mayúsculas (la Ñ se conserva). */
const normalizar = (palabra) => palabra
  .toUpperCase()
  .replace(/Ñ/g, '\u0001')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0001/g, 'Ñ');

/**
 * Palabras escritas con mayúscula que no empiezan oración: nombres propios.
 * Whisper y Chrome escriben así los nombres (Cartagena, Gustavo Petro).
 */
export function nombresPropios(texto) {
  const nombres = new Set();
  const re = /\p{L}+/gu;
  let m;
  while ((m = re.exec(texto))) {
    const palabra = m[0];
    if (palabra[0] === palabra[0].toLowerCase()) continue;
    const antes = texto.slice(0, m.index).trimEnd();
    const iniciaOracion = antes === '' || /[.!?¡¿:;"«(\n…-]$/.test(antes);
    // Una sigla (ONU, DIAN) también se deletrea aunque empiece la oración.
    const sigla = palabra.length > 1 && palabra === palabra.toUpperCase();
    if (!iniciaOracion || sigla) nombres.add(normalizar(palabra));
  }
  return nombres;
}

export class InterpreteVivo extends EventTarget {
  #sequencer;
  #config;
  #voz = null;
  #activo = false;
  #siguienteId = 1;
  #cadena = Promise.resolve(); // Traduce en orden, una frase a la vez.
  #llegada = new Map(); // id de frase → momento en que se cerró (ms).
  #vistas = new Set(); // Frases que ya empezaron a señarse.
  #temporizador = null;
  #metricas = { retraso: 0, velocidad: 1, latencia: null, frases: 0, omitidas: 0, sinDeletrear: 0, errores: 0 };
  #oido = null; // EscuchaWhisper, se crea la primera vez que se usa

  /** 'navegador' o 'whisper'. Se puede cambiar mientras no esté escuchando. */
  motor = 'navegador';
  /** Con Whisper: 'microfono', 'video' o 'pestana'. */
  fuente = 'microfono';
  /** Con Whisper y fuente 'video': el elemento que se oye. */
  video = null;
  /** Con Whisper y fuente 'sistema': la fuente de PulseAudio/PipeWire (null = lo que suena). */
  fuenteSistema = null;

  /**
   * @param {{
   *   sequencer: import('./secuenciador-senas.js').SecuenciadorSenas,
   *   traducir: (texto: string) => Promise<object>,
   *   config?: Partial<typeof CONFIG_VIVO>,
   * }} opciones traducir recibe una frase y devuelve la respuesta del cerebro
   *   ({ animacion: { secuencia }, glosa_lsc, ... }), o lanza un Error con
   *   `titulo` y `detalle`.
   */
  constructor({ sequencer, traducir, config = {} }) {
    super();
    this.#sequencer = sequencer;
    this.traducir = traducir; // Se puede cambiar, por ejemplo para pruebas.
    this.#config = { ...CONFIG_VIVO, ...config };

    // Latencia: desde que se cierra la frase hasta que empieza su primera seña.
    sequencer.addEventListener('sena', ({ detail }) => {
      const { lote } = detail;
      if (lote == null || this.#vistas.has(lote) || !this.#llegada.has(lote)) return;
      this.#vistas.add(lote);
      this.#metricas.latencia = (performance.now() - this.#llegada.get(lote)) / 1000;
      this.#llegada.delete(lote);
    });
  }

  /** true si el navegador trae reconocimiento de voz (Chrome y Edge sí; Firefox no). */
  static get disponible() {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  get escuchando() {
    return this.#activo;
  }

  get metricas() {
    return { ...this.#metricas };
  }

  /** Empieza a escuchar y a ajustar el ritmo. */
  async iniciar() {
    if (this.#activo) return;
    this.#activo = true;
    this.#arrancarRitmo();
    this.dispatchEvent(new CustomEvent('estado', { detail: { escuchando: true, motor: this.motor } }));

    if (this.motor === 'whisper') {
      this.#oido ??= this.#crearOido();
      try {
        await this.#oido.iniciar({ fuente: this.fuente, video: this.video, fuenteSistema: this.fuenteSistema });
      } catch {
        this.detener(); // El error ya se avisó.
      }
      return;
    }

    if (InterpreteVivo.disponible) {
      this.#voz ??= this.#crearVoz();
      this.#escuchar();
    } else {
      this.#error('Sin reconocimiento de voz', 'Usa Chrome o Edge, o elige Whisper');
      this.detener();
    }
  }

  /** Deja de escuchar. Lo que ya está en la cola se termina de señar. */
  detener() {
    if (!this.#activo) return;
    this.#activo = false;
    try { this.#voz?.stop(); } catch { /* ya estaba detenido */ }
    this.#oido?.detener();
    // El ritmo sigue hasta que se vacíe la cola, y luego vuelve a la normal.
    this.dispatchEvent(new CustomEvent('estado', { detail: { escuchando: false, motor: this.motor } }));
  }

  /** Fuentes de audio del sistema que Whisper puede grabar, o null si no responde. */
  fuentesWhisper() {
    this.#oido ??= this.#crearOido();
    return this.#oido.fuentes();
  }

  /** Estado del oído Whisper: { modelo, listo, error } o null si no responde. */
  saludWhisper() {
    this.#oido ??= this.#crearOido();
    return this.#oido.salud();
  }

  /**
   * Trata un texto como si se hubiera oído: lo traduce y lo encola. Sirve para
   * subtítulos, pruebas o para alimentar el modo en vivo desde otra fuente.
   * @param {string} texto
   * @returns {Promise<void>}
   */
  procesarTexto(texto) {
    const limpio = String(texto ?? '').trim();
    if (!limpio) return Promise.resolve();

    const id = this.#siguienteId++;
    this.#llegada.set(id, performance.now());
    this.#metricas.frases++;
    this.dispatchEvent(new CustomEvent('frase', { detail: { id, texto: limpio } }));
    this.#arrancarRitmo();

    const paso = this.#cadena.then(async () => {
      let datos;
      try {
        datos = await this.traducir(limpio);
      } catch (error) {
        this.#metricas.errores++;
        this.#llegada.delete(id);
        this.#error(error.titulo ?? 'No se pudo traducir', error.detalle ?? error.message);
        return;
      }
      this.dispatchEvent(new CustomEvent('glosas', { detail: { id, texto: limpio, datos } }));

      const secuencia = this.#resumirDeletreo(limpio, datos?.animacion?.secuencia ?? []);
      if (secuencia.length === 0) {
        this.#llegada.delete(id);
        return;
      }
      await this.#sequencer.encolarGlosas(secuencia.map((p) => ({
        glosa: p.glosa,
        archivo: p.archivo,
        duracion: p.duracion,
        expresion: p.expresion,
        palabraOrigen: p.palabraOrigen,
      })), { lote: id });
    });
    this.#cadena = paso.catch(() => {});
    return paso;
  }

  /**
   * Simula un noticiero sin micrófono: entrega las frases una tras otra, cada
   * `intervalo` segundos (aprox. lo que tarda alguien en decirlas).
   * @param {string[]} frases
   * @param {number} [intervalo=2.5]
   */
  async simular(frases, intervalo = 2.5) {
    for (const frase of frases) {
      this.dispatchEvent(new CustomEvent('parcial', { detail: { texto: frase } }));
      this.procesarTexto(frase);
      await new Promise((r) => setTimeout(r, intervalo * 1000));
    }
  }

  /**
   * Decide qué palabras sin seña se deletrean (ver "Deletreo en vivo" arriba).
   * Devuelve la secuencia sin las letras de las palabras que se saltan y con las
   * letras que quedan más cortas.
   */
  #resumirDeletreo(texto, secuencia) {
    const { deletreo, holguraDeletreo, velocidadLetras } = this.#config;
    if (deletreo === 'siempre' && velocidadLetras === 1) return secuencia;

    // Agrupa: cada seña sola, y las letras seguidas de una misma palabra juntas.
    const grupos = [];
    for (const paso of secuencia) {
      const esLetra = paso.tipo === 'LETRA';
      const ultimo = grupos.at(-1);
      if (esLetra && ultimo?.letras && ultimo.palabra === (paso.palabraOrigen ?? '')) {
        ultimo.pasos.push(paso);
      } else {
        grupos.push({ letras: esLetra, palabra: esLetra ? (paso.palabraOrigen ?? '') : null, pasos: [paso] });
      }
    }

    const velocidad = this.#sequencer.velocidad;
    const dur = (paso) => (Number(paso.duracion) || 0.6) / velocidad;
    const nombres = nombresPropios(texto);
    // Atraso que quedaría: lo pendiente, más las señas de esta frase, más lo deletreado.
    let atraso = this.#sequencer.pendienteSegundos
      + grupos.filter((g) => !g.letras).flatMap((g) => g.pasos).reduce((t, p) => t + dur(p), 0);

    const salida = [];
    for (const grupo of grupos) {
      if (!grupo.letras) { salida.push(...grupo.pasos); continue; }
      const letras = grupo.pasos.map((p) => ({ ...p, duracion: (Number(p.duracion) || 0.6) / velocidadLetras }));
      const costo = letras.reduce((t, p) => t + dur(p), 0);
      const esNombre = nombres.has(normalizar(grupo.palabra));
      const cabe = deletreo === 'siempre' || (deletreo === 'auto' && atraso + costo <= holguraDeletreo);
      if (esNombre || cabe) {
        salida.push(...letras);
        atraso += costo;
      } else {
        this.#metricas.sinDeletrear++;
      }
    }
    return salida;
  }

  /* ----- Whisper ---------------------------------------------------------- */

  #crearOido() {
    const oido = new EscuchaWhisper();
    oido.addEventListener('parcial', ({ detail }) => {
      this.dispatchEvent(new CustomEvent('parcial', { detail }));
    });
    oido.addEventListener('final', ({ detail }) => this.procesarTexto(detail.texto));
    oido.addEventListener('estado', ({ detail }) => {
      if (detail.modelo) {
        this.dispatchEvent(new CustomEvent('estado', { detail: { escuchando: true, motor: 'whisper', modelo: detail.modelo } }));
      }
    });
    oido.addEventListener('error', ({ detail }) => this.dispatchEvent(new CustomEvent('error', { detail })));
    return oido;
  }

  /* ----- Reconocimiento de voz del navegador ------------------------------ */

  #crearVoz() {
    const Reconocimiento = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const voz = new Reconocimiento();
    voz.lang = this.#config.idioma;
    voz.continuous = true; // No se detiene al final de cada frase.
    voz.interimResults = true; // Para mostrar el subtítulo mientras se habla.

    voz.addEventListener('result', (event) => {
      let parcial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const resultado = event.results[i];
        const texto = resultado[0].transcript.trim();
        if (resultado.isFinal) this.procesarTexto(texto);
        else parcial += ` ${texto}`;
      }
      this.dispatchEvent(new CustomEvent('parcial', { detail: { texto: parcial.trim() } }));
    });

    voz.addEventListener('error', (event) => {
      // 'no-speech' y 'aborted' son normales en un silencio largo: se vuelve a escuchar.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const mensajes = {
        'not-allowed': ['Micrófono bloqueado', 'Permite el micrófono para esta página'],
        'service-not-allowed': ['Micrófono bloqueado', 'Permite el micrófono para esta página'],
        'audio-capture': ['Sin micrófono', 'Conecta un micrófono o elige la entrada de audio'],
        network: ['Sin conexión', 'El reconocimiento de voz de Chrome necesita internet'],
      };
      const [titulo, detalle] = mensajes[event.error] ?? ['Error de reconocimiento', event.error];
      this.#error(titulo, detalle);
      // Sin permiso o sin micrófono no tiene sentido insistir.
      if (event.error !== 'network') this.detener();
    });

    // Chrome corta la escucha continua cada cierto tiempo: se reanuda sola.
    voz.addEventListener('end', () => {
      if (this.#activo) setTimeout(() => this.#activo && this.#escuchar(), this.#config.reinicio);
    });

    return voz;
  }

  #escuchar() {
    try {
      this.#voz.start();
    } catch {
      // "already started": el navegador todavía no había cerrado la anterior.
    }
  }

  /* ----- Ritmo ------------------------------------------------------------ */

  #arrancarRitmo() {
    this.#temporizador ??= setInterval(() => this.#ajustarRitmo(), 250);
  }

  #ajustarRitmo() {
    const { objetivo, rango, velocidadMax, retrasoMax } = this.#config;
    const seq = this.#sequencer;

    if (seq.pendienteSegundos > retrasoMax) {
      const descartados = seq.recortarPendientes(objetivo + rango / 2);
      descartados.forEach((lote) => this.#llegada.delete(lote));
      this.#metricas.omitidas += descartados.length;
    }

    const pendiente = seq.pendienteSegundos;
    const meta = 1 + Math.max(0, pendiente - objetivo) / rango * (velocidadMax - 1);
    // Cambio suave: la velocidad no salta de una seña a la otra.
    const velocidad = seq.velocidad + (Math.min(meta, velocidadMax) - seq.velocidad) * 0.3;
    seq.velocidad = Math.abs(velocidad - 1) < 0.01 ? 1 : velocidad;

    Object.assign(this.#metricas, { retraso: pendiente, velocidad: seq.velocidad });
    this.dispatchEvent(new CustomEvent('metricas', { detail: this.metricas }));

    // Apagado y sin nada pendiente: deja de medir.
    if (!this.#activo && pendiente === 0 && seq.velocidad === 1) {
      clearInterval(this.#temporizador);
      this.#temporizador = null;
    }
  }

  #error(titulo, detalle) {
    console.warn('[En vivo]', titulo, '·', detalle);
    this.dispatchEvent(new CustomEvent('error', { detail: { titulo, detalle } }));
  }
}
