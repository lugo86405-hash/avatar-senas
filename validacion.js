/**
 * Puente LSC · Validación de señas (v65)
 *
 * Lleva el estado de cada seña del diccionario:
 *   validada  ✓  aprobada por una persona sorda o un intérprete
 *   video     ◐  comparada con el video de un intérprete, falta que la apruebe una persona
 *   corregir  !  alguien anotó qué está mal
 *   pendiente ○  nadie la ha revisado
 *
 * validaciones.json trae el orden de importancia (las señas que más salen en
 * noticias y conversación van primero) y los estados oficiales. Lo que marca
 * quien valida en esta página se guarda en el navegador (localStorage) y manda
 * sobre el archivo; se puede exportar en JSON para unirlo al archivo oficial.
 */

export const ESTADOS = {
  validada: { icono: '✓', nombre: 'Validada', corto: 'Validada' },
  video: { icono: '◐', nombre: 'Revisada con video', corto: 'Con video' },
  corregir: { icono: '!', nombre: 'Necesita corrección', corto: 'Corregir' },
  pendiente: { icono: '○', nombre: 'Sin validar', corto: 'Sin validar' },
};

/** Lo que puede estar mal en una seña (los cinco parámetros de la LSC). */
export const FALLAS = {
  mano: 'Forma de la mano',
  lugar: 'Lugar (dónde está la mano)',
  movimiento: 'Movimiento',
  palma: 'Orientación de la palma',
  cara: 'Cara o cabeza',
};

/** Filtros de la lista: qué estados muestra cada uno. */
export const FILTROS = {
  pendientes: ['pendiente', 'video'],
  corregir: ['corregir'],
  todas: null,
};

const CLAVE = 'puente-validaciones';

const sinTildes = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Validacion extends EventTarget {
  /** Descarga validaciones.json. Si falla, sigue con una lista vacía. */
  static async cargar(url) {
    try {
      const respuesta = await fetch(url, { cache: 'no-cache' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      return new Validacion(await respuesta.json());
    } catch (error) {
      console.warn('[Validación] No se pudo leer', url, error);
      return new Validacion({ orden: [], senas: {} });
    }
  }

  #local;

  constructor(datos) {
    super();
    this.orden = datos.orden ?? [];
    this.palabras = datos.palabras ?? {};
    this.oficial = datos.senas ?? {};
    this.#puestos = new Map(this.orden.map((g, i) => [g, i + 1]));
    this.#local = this.#leer();
  }

  #puestos;

  #leer() {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
      if (guardado && typeof guardado === 'object') return { nombre: guardado.nombre ?? '', senas: guardado.senas ?? {} };
    } catch { /* sin almacenamiento o dañado: se empieza de cero */ }
    return { nombre: '', senas: {} };
  }

  #guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(this.#local));
    } catch (error) {
      console.warn('[Validación] No se pudo guardar en el navegador:', error);
    }
    this.dispatchEvent(new Event('cambio'));
  }

  get nombre() {
    return this.#local.nombre;
  }

  set nombre(valor) {
    this.#local.nombre = String(valor ?? '').trim().slice(0, 80);
    this.#guardar();
  }

  /** ¿La glosa está en la lista? (las letras del deletreo no lo están) */
  tiene(glosa) {
    return this.#puestos.has(glosa);
  }

  puesto(glosa) {
    return this.#puestos.get(glosa) ?? null;
  }

  /** Estado completo: { estado, fuente?, fallas?, nota?, quien?, fecha? }. */
  info(glosa) {
    return this.#local.senas[glosa] ?? this.oficial[glosa] ?? { estado: 'pendiente' };
  }

  estado(glosa) {
    return this.info(glosa).estado;
  }

  /** ¿La marca viene de esta página (y no del archivo oficial)? */
  esLocal(glosa) {
    return glosa in this.#local.senas;
  }

  /**
   * @param {string} glosa
   * @param {'validada'|'corregir'} estado
   * @param {{fallas?: string[], nota?: string}} [detalle]
   */
  marcar(glosa, estado, { fallas = [], nota = '' } = {}) {
    if (!ESTADOS[estado]) throw new Error(`Estado desconocido: ${estado}`);
    this.#local.senas[glosa] = {
      estado,
      ...(fallas.length ? { fallas } : {}),
      ...(nota.trim() ? { nota: nota.trim() } : {}),
      quien: this.#local.nombre || 'Sin nombre',
      fecha: new Date().toISOString(),
    };
    this.#guardar();
  }

  /** Quita la marca local: la seña vuelve al estado del archivo oficial. */
  deshacer(glosa) {
    delete this.#local.senas[glosa];
    this.#guardar();
  }

  /** Cuántas hay en cada estado. */
  resumen() {
    const cuenta = { total: this.orden.length, validada: 0, video: 0, corregir: 0, pendiente: 0 };
    for (const g of this.orden) cuenta[this.estado(g)]++;
    return cuenta;
  }

  /** Glosas del filtro, en orden de importancia, que coinciden con el texto (glosa o palabra). */
  lista(filtro = 'pendientes', texto = '') {
    const estados = FILTROS[filtro] ?? null;
    const buscar = sinTildes(texto.trim()).replace(/\s+/g, '_');
    return this.orden.filter((g) => {
      if (estados && !estados.includes(this.estado(g))) return false;
      if (!buscar) return true;
      if (sinTildes(g).includes(buscar)) return true;
      return (this.palabras[g] ?? []).some((p) => sinTildes(p).replace(/\s+/g, '_').includes(buscar));
    });
  }

  /** La que sigue a `glosa` dentro del filtro (o la primera si no hay más adelante). */
  siguiente(glosa, filtro = 'pendientes') {
    const estados = FILTROS[filtro] ?? null;
    const ok = (g) => !estados || estados.includes(this.estado(g));
    const desde = this.orden.indexOf(glosa);
    for (let i = desde + 1; i < this.orden.length; i++) if (ok(this.orden[i])) return this.orden[i];
    for (let i = 0; i < desde; i++) if (ok(this.orden[i])) return this.orden[i];
    return null;
  }

  /** Las marcas hechas en esta página, para guardarlas o enviarlas. */
  exportar() {
    return {
      tipo: 'puente-lsc-validaciones',
      version: 1,
      exportado: new Date().toISOString(),
      validador: this.#local.nombre,
      senas: this.#local.senas,
    };
  }

  /**
   * Une un archivo exportado con las marcas de esta página. Si las dos tienen la
   * misma seña, queda la más reciente. Devuelve cuántas señas cambiaron.
   */
  importar(datos) {
    if (!datos || typeof datos.senas !== 'object') throw new Error('El archivo no tiene validaciones de Puente LSC.');
    let cambiadas = 0;
    for (const [glosa, marca] of Object.entries(datos.senas)) {
      if (!this.#puestos.has(glosa) || !ESTADOS[marca?.estado]) continue;
      const actual = this.#local.senas[glosa];
      if (actual && (actual.fecha ?? '') >= (marca.fecha ?? '')) continue;
      this.#local.senas[glosa] = marca;
      cambiadas++;
    }
    if (!this.#local.nombre && datos.validador) this.#local.nombre = datos.validador;
    this.#guardar();
    return cambiadas;
  }
}
