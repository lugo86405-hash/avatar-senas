/**
 * Avatar Señas · Escucha con Whisper (v52)
 *
 * Captura audio en el navegador y lo manda al "oído" (oido_whisper.py, puerto
 * 8002), que lo transcribe con Whisper en el propio computador. A diferencia del
 * reconocimiento de voz de Chrome, no necesita internet y puede oír directamente
 * el audio del video del noticiero, sin pasar por los parlantes.
 *
 * Fuentes:
 *   'microfono' → el micrófono (getUserMedia).
 *   'video'     → el <video> de la página (archivo del computador o .mp4 con CORS).
 *   'pestana'   → una pestaña o la pantalla con su audio (getDisplayMedia). Sirve
 *                 para YouTube: al compartir hay que marcar "Compartir audio".
 *   'sistema'   → (v55) la página no graba nada: el oído graba una fuente del
 *                 sistema (lo que suena en el computador o un micrófono) y solo
 *                 manda el texto. Es lo que usa la vista para OBS, porque OBS no
 *                 da micrófono a sus fuentes de navegador.
 *
 * El audio se pasa a mono, 16 000 Hz y 16 bits en un AudioWorklet y sale en
 * pedazos de 100 ms por WebSocket.
 *
 * Eventos (addEventListener):
 *   'estado'  → detail: { activo, modelo? }
 *   'parcial' → detail: { texto }
 *   'final'   → detail: { texto, duracion, demora }
 *   'error'   → detail: { titulo, detalle }
 */

export const CONFIG_WHISPER = {
  url: 'ws://localhost:8002/ws/oir',
  emision: 'ws://localhost:8002/ws/emision',
  salud: 'http://localhost:8002/salud',
  fuentes: 'http://localhost:8002/fuentes',
  frecuencia: 16000,
  muestrasPorEnvio: 1600, // 100 ms
};

/**
 * Procesador del AudioWorklet. Mezcla a mono y baja a 16 kHz promediando las
 * muestras de cada intervalo (un filtro sencillo que evita el aliasing más
 * grueso). Funciona con cualquier frecuencia de entrada (44,1 k, 48 k, 16 k…).
 * Va como texto porque el worklet se carga desde una URL propia.
 */
export const CODIGO_WORKLET = `
class Captura16k extends AudioWorkletProcessor {
  constructor(opciones) {
    super();
    const { frecuencia, muestrasPorEnvio } = opciones.processorOptions;
    this.razon = sampleRate / frecuencia;
    this.siguiente = this.razon;
    this.indice = 0;
    this.suma = 0;
    this.cuenta = 0;
    this.tam = muestrasPorEnvio;
    this.salida = new Int16Array(this.tam);
    this.n = 0;
  }

  process(entradas) {
    const canales = entradas[0];
    if (!canales || canales.length === 0) return true;
    const largo = canales[0].length;
    for (let i = 0; i < largo; i++) {
      let x = 0;
      for (let c = 0; c < canales.length; c++) x += canales[c][i];
      this.suma += x / canales.length;
      this.cuenta++;
      this.indice++;
      if (this.indice >= this.siguiente) {
        const v = Math.max(-1, Math.min(1, this.suma / this.cuenta));
        this.salida[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.suma = 0;
        this.cuenta = 0;
        this.siguiente += this.razon;
        if (this.n === this.tam) {
          this.port.postMessage(this.salida.buffer, [this.salida.buffer]);
          this.salida = new Int16Array(this.tam);
          this.n = 0;
        }
      }
    }
    // Evita que los índices crezcan sin límite en sesiones largas.
    if (this.indice > 1e9) { this.indice -= 1e9; this.siguiente -= 1e9; }
    return true;
  }
}
registerProcessor('captura-16k', Captura16k);
`;

// Un solo AudioContext para toda la página: un <video> solo se puede conectar a
// una fuente de audio una vez, así que no se puede crear otro contexto después.
let contexto = null;
let workletListo = null;
const fuentesVideo = new WeakMap(); // <video> → MediaElementAudioSourceNode

async function obtenerContexto() {
  if (!contexto) {
    // Frecuencia normal (48 kHz): el video se sigue oyendo bien y el worklet baja a 16 kHz.
    contexto = new AudioContext();
    const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: 'text/javascript' }));
    workletListo = contexto.audioWorklet.addModule(url);
  }
  await workletListo;
  if (contexto.state === 'suspended') await contexto.resume();
  return contexto;
}

export class EscuchaWhisper extends EventTarget {
  #config;
  #ws = null;
  #nodo = null;
  #fuente = null; // nodo de audio que alimenta al worklet
  #stream = null; // micrófono o pantalla, para apagarlos al terminar
  #activo = false;

  constructor(config = {}) {
    super();
    this.#config = { ...CONFIG_WHISPER, ...config };
  }

  get activo() {
    return this.#activo;
  }

  /** Pregunta al oído si está encendido y con el modelo cargado. */
  async salud() {
    try {
      const r = await fetch(this.#config.salud, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      return await r.json();
    } catch {
      return null;
    }
  }

  /** Fuentes de audio del sistema que el oído puede grabar (modo 'sistema'). */
  async fuentes() {
    try {
      const r = await fetch(this.#config.fuentes, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      return (await r.json()).fuentes ?? [];
    } catch {
      return null;
    }
  }

  /**
   * Empieza a escuchar.
   * @param {{fuente?: 'microfono'|'video'|'pestana'|'sistema', video?: HTMLVideoElement,
   *          fuenteSistema?: string}} [opciones]
   */
  async iniciar({ fuente = 'microfono', video = null, fuenteSistema = null } = {}) {
    if (this.#activo) return;
    this.#activo = true;
    try {
      // Antes de pedir el micrófono o la pestaña: si el oído no está, no tiene sentido.
      // (Rápido, para no perder el permiso del clic que pide compartir la pestaña.)
      if (!(await this.salud())) {
        throw Object.assign(new Error('Whisper no responde'), {
          titulo: 'Whisper no responde',
          detalle: 'Abre el proyecto con iniciar.sh (y instala Whisper: ver cerebro-linguistico/README.md)',
        });
      }
      if (fuente === 'sistema') {
        // El oído graba y transcribe; aquí solo llega el texto.
        const url = new URL(this.#config.emision);
        if (fuenteSistema) url.searchParams.set('fuente', fuenteSistema);
        await this.#conectar(url.href);
        return;
      }
      const ctx = await obtenerContexto();
      this.#fuente = await this.#crearFuente(ctx, fuente, video);
      await this.#conectar(this.#config.url);

      this.#nodo = new AudioWorkletNode(ctx, 'captura-16k', {
        processorOptions: { frecuencia: this.#config.frecuencia, muestrasPorEnvio: this.#config.muestrasPorEnvio },
      });
      this.#nodo.port.onmessage = ({ data }) => {
        if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(data);
      };
      // El worklet debe llegar al destino para que el navegador lo ejecute; con volumen 0 no se oye dos veces.
      const mudo = ctx.createGain();
      mudo.gain.value = 0;
      this.#fuente.connect(this.#nodo).connect(mudo).connect(ctx.destination);
    } catch (error) {
      this.#activo = false;
      this.#limpiar();
      this.#error(error.titulo ?? 'No se pudo escuchar', error.detalle ?? error.message);
      throw error;
    }
  }

  /** Deja de escuchar. Pide al oído la última frase y luego cierra. */
  async detener() {
    if (!this.#activo) return;
    this.#activo = false;
    try { this.#fuente?.disconnect(this.#nodo); } catch { /* ya desconectado */ }
    this.#nodo?.disconnect();
    this.#nodo = null;
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;

    const ws = this.#ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ accion: 'fin' }));
      // Da tiempo a que llegue la última frase antes de cerrar.
      setTimeout(() => ws.close(), 4000);
    }
    this.#ws = null;
    this.dispatchEvent(new CustomEvent('estado', { detail: { activo: false } }));
  }

  /* ----- Internos ----------------------------------------------------------- */

  async #crearFuente(ctx, fuente, video) {
    if (fuente === 'video') {
      if (!video?.src && !video?.currentSrc) {
        throw this.#falla('No hay video', 'Carga un archivo o un enlace .mp4 (para YouTube usa "una pestaña")');
      }
      let nodo = fuentesVideo.get(video);
      if (!nodo) {
        nodo = ctx.createMediaElementSource(video);
        nodo.connect(ctx.destination); // El video se sigue oyendo por los parlantes.
        fuentesVideo.set(video, nodo);
      }
      return nodo;
    }

    if (fuente === 'pestana') {
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true, // Chrome exige video para compartir el audio de una pestaña.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          preferCurrentTab: true,
          systemAudio: 'include',
        });
      } catch {
        throw this.#falla('No se compartió la pestaña', 'Elige la pestaña y marca "Compartir audio"');
      }
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw this.#falla('Sin audio', 'Al compartir la pestaña marca "Compartir audio de la pestaña"');
      }
      stream.getVideoTracks().forEach((t) => t.stop()); // Solo se usa el audio.
      this.#stream = stream;
      return ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const bloqueado = error?.name === 'NotAllowedError';
      throw this.#falla(bloqueado ? 'Micrófono bloqueado' : 'Sin micrófono',
        bloqueado ? 'Permite el micrófono para esta página' : 'Conecta un micrófono o elige otra entrada');
    }
    this.#stream = stream;
    return ctx.createMediaStreamSource(stream);
  }

  #conectar(direccion) {
    return new Promise((resolve, reject) => {
      let abierto = false;
      const ws = new WebSocket(direccion);
      ws.binaryType = 'arraybuffer';
      this.#ws = ws;

      ws.onmessage = ({ data }) => {
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m.tipo === 'listo') {
          abierto = true;
          this.dispatchEvent(new CustomEvent('estado', { detail: { activo: true, modelo: m.modelo } }));
          resolve();
        } else if (m.tipo === 'parcial') {
          this.dispatchEvent(new CustomEvent('parcial', { detail: { texto: m.texto } }));
        } else if (m.tipo === 'final') {
          this.dispatchEvent(new CustomEvent('final', { detail: m }));
        } else if (m.tipo === 'fin_fuente') {
          this.#error('Se cortó el audio', m.detalle);
          this.detener();
        } else if (m.tipo === 'error') {
          const falla = this.#falla('Whisper no está listo', m.detalle);
          if (!abierto) reject(falla);
          else this.#error(falla.titulo, falla.detalle);
        }
      };
      ws.onerror = () => {
        if (!abierto) {
          reject(this.#falla('Whisper no disponible',
            'Arranca el oído (puerto 8002) con iniciar.sh; los pasos están en cerebro-linguistico/README.md'));
        }
      };
      ws.onclose = () => {
        if (abierto && this.#activo && this.#ws === ws) {
          this.#error('Se cortó Whisper', 'El oído (puerto 8002) se cerró');
          this.detener();
        }
      };
    });
  }

  #limpiar() {
    // La fuente de un <video> no se desconecta: sigue sonando por los parlantes.
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
    this.#ws?.close();
    this.#ws = null;
  }

  #falla(titulo, detalle) {
    const error = new Error(`${titulo}: ${detalle}`);
    error.titulo = titulo;
    error.detalle = detalle;
    return error;
  }

  #error(titulo, detalle) {
    console.warn('[Whisper]', titulo, '·', detalle);
    this.dispatchEvent(new CustomEvent('error', { detail: { titulo, detalle } }));
  }
}
