/**
 * Avatar Señas · Cerebro local (v56)
 *
 * Traduce en el navegador, sin Python ni Java, con las mismas reglas que el
 * cerebro (procesador_lsc.py) y el backend (AnimacionService.java). Así la página
 * funciona en un celular o en cualquier computador, incluso sin internet.
 *
 * Las tablas (vocabulario, sinónimos, verbos, diccionario de clips...) no se
 * copian a mano: exportar_cerebro.py las saca de procesador_lsc.py y de data.sql
 * y las guarda en cerebro-datos.json. Aquí solo está la lógica, traducida línea
 * por línea de Python; si cambia una regla de procesador_lsc.py hay que cambiarla
 * también aquí (las pruebas comparan las dos versiones frase por frase).
 *
 * Uso:
 *   const cerebro = await CerebroLocal.cargar('./cerebro-datos.json');
 *   const datos = cerebro.traducir('Hola, ¿cómo estás?');
 *   // datos tiene la misma forma que la respuesta de /api/v1/traducir:
 *   // { texto_espanol, glosas, glosa_lsc, oraciones, animacion: { secuencia, duracionTotal, noEncontradas } }
 */

const PALABRA = /[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
const SIGNOS = /([.,;:!?¡¿\n]+)/;
const SOLO_SIGNOS = /^[.,;:!?¡¿\n]+$/;
const ALFANUM = /[\p{L}\p{N}]/u;
const ESPACIO = /\s/u;

/** Quita tildes y diéresis, pero conserva la Ñ (igual que el backend Java). */
function quitarTildes(texto) {
  let salida = '';
  for (const c of texto.normalize('NFC')) {
    salida += (c === 'ñ' || c === 'Ñ') ? c : c.normalize('NFD').replace(/\p{M}/gu, '');
  }
  return salida;
}

/** Deja letras, números, espacios y la puntuación que usa la gramática. */
function quitarSignosRaros(texto) {
  let salida = '';
  for (const c of texto) salida += (ALFANUM.test(c) || ESPACIO.test(c) || '.,;:!?¡¿'.includes(c)) ? c : ' ';
  return salida;
}

/** Igualdad de dos objetos planos como en Python (mismas claves y mismos valores). */
function iguales(a, b) {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}
const contiene = (lista, x) => lista.some((y) => iguales(x, y));

const PRONOMBRES = new Set(['YO', 'TU', 'EL', 'NOSOTROS', 'USTEDES', 'USTED', 'ELLOS']);
const POSESIVOS = new Set(['MIO', 'TU', 'SUYO', 'NUESTRO', 'TUYO']);
// v60 (video "Cómo hacer preguntas en LSC"): IR, sujeto tácito TÚ, demostrativos y YA al final
const IR_FORMAS = new Set(['VOY', 'VAS', 'VA', 'VAMOS', 'VAN', 'IBA', 'IBAS', 'IBAMOS', 'IBAN', 'IR', 'IRE', 'IRAS',
  'IREMOS', 'IRAN', 'IDO', 'YENDO', 'FUI', 'FUISTE', 'FUE', 'FUIMOS', 'FUERON']);
const IR_SER = new Set(['FUI', 'FUISTE', 'FUE', 'FUIMOS', 'FUERON']);
const DEMOSTRATIVOS = new Set(['ese', 'esa', 'eso', 'esos', 'esas', 'este', 'esto', 'estos',
  'aquel', 'aquella', 'aquello', 'aquellos', 'aquellas']);
const DEMOSTRATIVOS_PRONOMBRE = new Set(['eso', 'esto', 'aquello']);
const SEGUNDA_PERSONA = /(AS|ES|ASTE|ISTE)$/;
const DETERMINANTES = new Set(['la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'mis', 'tus', 'sus', 'nuestras',
  'nuestros', 'muchas', 'muchos', 'pocas', 'pocos', 'esas', 'esos', 'estas', 'estos', 'otras', 'otros']);
const SUJETOS = new Set(['YO', 'TU', 'EL', 'ELLA', 'NOSOTROS', 'USTEDES', 'USTED', 'ELLOS']);

// v63: números (video "Los Números en LSC" + Diccionario pp. 207-215)
const VALOR_NUMERO = new Map(Object.entries({
  CERO: 0, UNO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8,
  NUEVE: 9, DIEZ: 10, ONCE: 11, DOCE: 12, TRECE: 13, CATORCE: 14, QUINCE: 15,
  DIECISEIS: 16, DIECISIETE: 17, DIECIOCHO: 18, DIECINUEVE: 19, VEINTE: 20,
  VEINTIUNO: 21, VEINTIUN: 21, VEINTIUNA: 21, VEINTIDOS: 22, VEINTITRES: 23, VEINTICUATRO: 24,
  VEINTICINCO: 25, VEINTISEIS: 26, VEINTISIETE: 27, VEINTIOCHO: 28, VEINTINUEVE: 29,
  TREINTA: 30, CUARENTA: 40, CINCUENTA: 50, SESENTA: 60, SETENTA: 70, OCHENTA: 80,
  NOVENTA: 90, CIEN: 100, CIENTO: 100, DOSCIENTOS: 200, DOSCIENTAS: 200,
  TRESCIENTOS: 300, TRESCIENTAS: 300, CUATROCIENTOS: 400, CUATROCIENTAS: 400,
  QUINIENTOS: 500, QUINIENTAS: 500, SEISCIENTOS: 600, SEISCIENTAS: 600,
  SETECIENTOS: 700, SETECIENTAS: 700, OCHOCIENTOS: 800, OCHOCIENTAS: 800,
  NOVECIENTOS: 900, NOVECIENTAS: 900,
}));
const MULTIPLICADORES = new Map([['MIL', 1000], ['MILLON', 1000000], ['MILLONES', 1000000]]);
const DIGITOS = ['CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const UNO_A_DIECINUEVE = [...DIGITOS, 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const DECENAS = new Map([[20, 'VEINTE'], [30, 'TREINTA'], [40, 'CUARENTA'], [50, 'CINCUENTA'],
  [60, 'SESENTA'], [70, 'SETENTA'], [80, 'OCHENTA'], [90, 'NOVENTA']]);
const CENTENAS = ['', 'CIEN', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

/** Lee un número con cifras o palabras desde i: [valor, palabras usadas, cifras|null] o null. */
function leerNumero(normas, i) {
  const w0 = normas[i];
  if (/^[0-9]+$/.test(w0)) return [Number(w0), 1, w0];
  let total = 0;
  let actual = 0;
  let k = i;
  let antes = null;
  while (k < normas.length) {
    const w = normas[k];
    const sig = k + 1 < normas.length ? normas[k + 1] : null;
    if ((w === 'UN' || w === 'UNA') && MULTIPLICADORES.has(sig) && [null, 'centena', 'mult'].includes(antes)) {
      actual += 1;
      antes = 'unidad';
    } else if (VALOR_NUMERO.has(w)) {
      const v = VALOR_NUMERO.get(w);
      if (!(antes === null || antes === 'mult' || (antes === 'centena' && v < 100))) break;
      actual += v;
      antes = v >= 100 ? 'centena' : (v >= 20 && v % 10 === 0 ? 'decena' : 'unidad');
    } else if (w === 'Y' && antes === 'decena' && VALOR_NUMERO.has(sig)
        && VALOR_NUMERO.get(sig) >= 1 && VALOR_NUMERO.get(sig) <= 9) {
      actual += VALOR_NUMERO.get(sig);
      antes = 'unidad';
      k += 1;
    } else if (MULTIPLICADORES.has(w) && antes !== 'mult') {
      if (MULTIPLICADORES.get(w) === 1000) total += (actual || 1) * 1000;
      else total = (total + (actual || 1)) * 1000000;
      actual = 0;
      antes = 'mult';
    } else break;
    k += 1;
  }
  if (k === i) return null;
  return [total + actual, k - i, null];
}

/** Glosas LSC de un número: 25 -> DOS CINCO; 2026 -> DOS MIL DOS SEIS; 300 -> TRESCIENTOS. */
function senasNumero(n, cifras = null) {
  if (cifras !== null && (cifras.length >= 8 || (cifras.length > 1 && cifras[0] === '0'))) {
    return [...cifras].map((c) => DIGITOS[Number(c)]);   // teléfonos y códigos: cifra por cifra
  }
  if (n < 20) return [UNO_A_DIECINUEVE[n]];
  const out = [];
  if (n >= 1000000) {
    const m = Math.floor(n / 1000000);
    n %= 1000000;
    out.push(...(m === 1 ? [] : senasNumero(m)), 'MILLON');
  }
  if (n >= 1000) {
    const m = Math.floor(n / 1000);
    n %= 1000;
    out.push(...(m === 1 ? [] : senasNumero(m)), 'MIL');
  }
  if (n >= 100) {
    out.push(CENTENAS[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n === 0) return out;
  if (n < 20) return [...out, UNO_A_DIECINUEVE[n]];
  if (DECENAS.has(n)) return [...out, DECENAS.get(n)];
  return [...out, DIGITOS[Math.floor(n / 10)], DIGITOS[n % 10]];
}
const MARCAS = { pregunta_abierta: '(?)', pregunta_si_no: '(?)', exclamativa: '(!)' };

export class CerebroLocal {
  /** Descarga cerebro-datos.json y prepara las tablas. */
  static async cargar(url = './cerebro-datos.json') {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`No se pudo cargar ${url} (${r.status})`);
    return new CerebroLocal(await r.json());
  }

  constructor(datos) {
    const g = datos.gramatica;
    this.version = datos.version;
    const conjunto = (lista) => new Set(lista);
    // Más largas primero; a igual largo, en el orden del archivo (sort es estable, como en Python).
    this.expresiones = g.expresiones.map(([partes, glosa]) => ({ partes, glosa }))
      .sort((a, b) => b.partes.length - a.partes.length);
    this.sinonimos = new Map(Object.entries(g.sinonimos));
    this.vocabulario = conjunto(g.vocabulario);
    this.cortesia = conjunto(g.cortesia);
    this.tiempo = conjunto(g.tiempo);
    this.interrogativas = conjunto(g.interrogativas);
    this.preguntasFijas = conjunto(g.preguntas_fijas);
    this.verbos = conjunto(g.verbos);
    this.interrogativasPalabras = new Map(Object.entries(g.interrogativas_palabras));
    this.omitir = conjunto(g.omitir);
    this.emociones = new Map(Object.entries(g.emociones));
    this.quePregunta = conjunto(g.que_pregunta);
    this.cuandoPregunta = conjunto(g.cuando_pregunta);
    this.terminaciones = Object.entries(g.terminaciones); // [['AR', [...]], ['ER', ...], ['IR', ...]]
    this.noVerbos = conjunto(g.no_verbos);
    this.sustantivosVerbales = conjunto(g.sustantivos_verbales);
    this.cliticos = g.cliticos ?? []; // v57: los más largos primero
    this.rostroPregunta = new Map(Object.entries(g.rostro_pregunta ?? {})); // v58
    const d = g.direccionales ?? {};                     // v67: verbos direccionales
    this.direccionales = new Map(Object.entries(d.verbos ?? {}));
    this.direcciones = new Set(d.direcciones ?? []);
    this.lugarPronombre = new Map(Object.entries(d.lugar_pronombre ?? {}));
    this.lugarClitico = new Map(Object.entries(d.lugar_clitico ?? {}));
    this.cliticosSueltos = new Set(d.cliticos_sueltos ?? []);
    this.lugarTrasA = new Map(Object.entries(d.lugar_tras_a ?? {}));
    this.antesDelNombre = new Set(d.antes_del_nombre ?? []);
    this.masculinosEnA = new Set(d.masculinos_en_a ?? []);
    this.femeninos = new Set(d.femeninos ?? []);
    this.irregularesPersona = new Map(Object.entries(d.irregulares_persona ?? {}));
    this.pegadosFijos = new Map(Object.entries(d.pegados_fijos ?? {}));
    this.personas = new Set(d.personas ?? []);                // v68
    this.lugarPropio = new Map(Object.entries(d.lugar_propio ?? {}));
    this.senas = new Map(Object.entries(datos.diccionario.senas));
    this.letras = new Map(Object.entries(datos.diccionario.letras));
  }

  /* ----- Gramática (procesador_lsc.py) ------------------------------------- */

  /** Divide en oraciones por la puntuación y marca preguntas y exclamaciones. */
  #oraciones(texto) {
    texto = texto.replace(/(?<=\d)[.,](?=\d{3}(?!\d))/g, '');   // v63: "2.000" es un número
    const oraciones = [];
    let actual = { texto: '', pregunta: false, exclamacion: false };
    const cerrar = () => {
      if (/[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(actual.texto)) oraciones.push(actual);
      actual = { texto: '', pregunta: false, exclamacion: false };
    };
    for (const parte of texto.split(SIGNOS)) {
      if (!parte) continue;
      if (SOLO_SIGNOS.test(parte)) {
        if (parte.includes('?')) actual.pregunta = true;
        if (parte.includes('!')) actual.exclamacion = true;
        cerrar();
        if (parte.includes('¿')) actual.pregunta = true;
        if (parte.includes('¡')) actual.exclamacion = true;
      } else {
        actual.texto += parte;
      }
    }
    cerrar();
    if (oraciones.length) oraciones.at(-1).ultima = true;
    return oraciones;
  }

  #preguntaSinSignos(b, siguiente, o) {
    if (b === 'que') return this.quePregunta.has(siguiente);
    if (b === 'cuando') return Boolean(o.ultima) && this.cuandoPregunta.has(siguiente);
    return true;
  }

  /** Verbo del vocabulario del que viene una conjugación regular, o null. */
  verboBase(palabra) {
    for (const [inf, terms] of this.terminaciones) {
      for (const t of terms) {
        if (palabra.endsWith(t) && palabra.length - t.length >= 2) {
          const base = palabra.slice(0, -t.length) + inf;
          if (this.verbos.has(base)) return base;
        }
      }
    }
    return null;
  }

  /** Verbo al que se le pegó un pronombre ("enseñarte" -> ENSEÑAR), o null. */
  sinCliticos(palabra) {
    for (const c of this.cliticos) {
      if (palabra.endsWith(c) && palabra.length - c.length >= 2) {
        const base = palabra.slice(0, -c.length);
        const glosa = this.sinonimos.get(base) || (this.verbos.has(base) ? base : null) || this.verboBase(base);
        if (this.verbos.has(glosa)) return glosa;
      }
    }
    return null;
  }

  esVerbo(glosa) {
    if (this.noVerbos.has(glosa)) return false;
    return this.verbos.has(glosa) || /(AR|ER|IR)$/.test(glosa);
  }


  /* ----- v67: verbos direccionales (procesador_lsc._direccionar) ------------ */

  /** Lado de una tercera persona por el género de la palabra: ella a la derecha, él a la izquierda. */
  #lugarSustantivo(n) {
    if (this.femeninos.has(n) || ((n.endsWith('A') || n.endsWith('AS')) && !this.masculinosEnA.has(n))) return '3D';
    return '3I';
  }

  /** Persona de una forma verbal (con tildes, sin pronombres pegados): '1', '2', '3' o null. */
  #personaForma(b) {
    if (this.irregularesPersona.has(b)) return this.irregularesPersona.get(b);
    const llana = quitarTildes(b);
    const termina = (s, lista) => lista.some((t) => s.endsWith(t));
    if (termina(llana, ['ar', 'er', 'ir', 'ando', 'iendo'])) return null;
    if (termina(llana, ['amos', 'emos', 'imos'])) return '1';
    if (termina(llana, ['aste', 'iste', 'as', 'es'])) return '2';
    if (termina(b, ['é', 'í'])) return '1';
    if (b.endsWith('ó')) return '3';
    if (termina(llana, ['aron', 'ieron', 'an', 'en'])) return '3';
    if (llana.endsWith('o')) return '1';
    if (termina(llana, ['a', 'e'])) return '3';
    return null;
  }

  /** Pronombres pegados a la forma del verbo ("AYUDAME" -> "ME"), o null. */
  #cliticoPegado(glosa, n) {
    if (this.pegadosFijos.has(n) && this.sinonimos.get(n) === glosa) return this.pegadosFijos.get(n);
    if (this.sinonimos.get(n) === glosa || this.verboBase(n) === glosa) return null;
    for (const c of this.cliticos) {
      if (n.endsWith(c) && n.length - c.length >= 2) {
        const base = n.slice(0, -c.length);
        if ((this.sinonimos.get(base) || (this.verbos.has(base) ? base : null) || this.verboBase(base)) === glosa) return c;
      }
    }
    return null;
  }

  /* ----- v68: personas ubicadas en el espacio y recordadas entre oraciones ----- */

  #genero(n) {
    return this.femeninos.has(n) || ((n.endsWith('A') || n.endsWith('AS')) && !this.masculinosEnA.has(n)) ? 'f' : 'm';
  }

  /** Lugar de una tercera persona; la primera vez va a su lado (ella derecha, él izquierda) o al libre. */
  #ubicar(memoria, clave) {
    const lugares = memoria.lugar;
    if (!lugares.has(clave)) {
      const preferido = clave.endsWith(':f') ? '3D' : '3I';
      const otro = preferido === '3D' ? '3I' : '3D';
      const usados = new Set(lugares.values());
      const lugar = !usados.has(preferido) ? preferido : !usados.has(otro) ? otro : preferido;
      for (const [c, l] of [...lugares]) {
        if (l === lugar) {                               // quien estaba ahí deja el lugar
          lugares.delete(c);
          memoria.recientes.splice(memoria.recientes.indexOf(c), 1);
        }
      }
      lugares.set(clave, lugar);
    }
    const k = memoria.recientes.indexOf(clave);
    if (k >= 0) memoria.recientes.splice(k, 1);
    memoria.recientes.push(clave);
    return lugares.get(clave);
  }

  /** Clave de la última persona nombrada (del género pedido y que no esté en `excluir`). */
  #referente(memoria, genero = null, excluir = null) {
    for (let k = memoria.recientes.length - 1; k >= 0; k -= 1) {
      const c = memoria.recientes[k];
      if ((genero === null || c.endsWith(`:${genero}`)) && memoria.lugar.get(c) !== excluir) return c;
    }
    return null;
  }

  /** Clave de memoria si el item nombra a una persona (sustantivo de persona o nombre propio). */
  #clavePersona(x, normas, palabras) {
    const p = x.pos;
    if (p === undefined || p === null) return null;
    const n = normas[p];
    if (this.personas.has(x.glosa)) return `${x.glosa}:${this.#genero(n)}`;
    const inicial = palabras[p].slice(0, 1);
    const mayuscula = inicial !== inicial.toLowerCase() && inicial === inicial.toUpperCase();
    if (mayuscula && /^\p{L}+$/u.test(n) && n.length > 2 && n === x.glosa && !this.vocabulario.has(n)
        && !this.sinonimos.has(n) && !this.omitir.has(n) && this.verboBase(n) === null) {
      return `${n}:${this.#genero(n)}`;
    }
    return null;
  }

  /** Pone a los verbos direccionales el recorrido (x.direccion), ubica a las personas en el espacio
   *  (recordándolas entre oraciones con `memoria`) y quita los pronombres objeto que ya dice el verbo. */
  #direccionar(items, bajas, normas, palabras = bajas, memoria = { lugar: new Map(), recientes: [] }) {
    const quitar = new Set();
    const conPos = (y) => y.pos !== undefined && y.pos !== null;
    const lugarDe = (y) => y.lugarMem;
    const verPersona = (y) => {
      if ('lugarMem' in y) return y.lugarMem;
      let clave = this.#clavePersona(y, normas, palabras);
      if (clave) {
        y.lugarMem = this.#ubicar(memoria, clave);
      } else if (this.lugarPropio.has(y.glosa)) {        // ÉL / ELLA: la última persona de su género
        const g = y.glosa === 'ELLA' ? 'f' : 'm';
        clave = this.#referente(memoria, g) || `${y.glosa}:${g}`;
        y.lugarMem = this.#ubicar(memoria, clave);
        if (y.lugarMem !== this.lugarPropio.get(y.glosa)) y.direccion = y.lugarMem;   // ELLA_3I
      }
      return y.lugarMem;
    };
    for (const x of items) {
      verPersona(x);
      const verbo = x.glosa;
      const p = x.pos;
      if (!this.direccionales.has(verbo) || !conPos(x)) continue;
      const b = bajas[p];
      const n = normas[p];
      let objeto = null;
      let sujeto = null;
      const pegado = this.#cliticoPegado(verbo, n);
      const forma = pegado ? b.slice(0, b.length - pegado.length) : b;
      let clitico = null;
      if (pegado) {
        for (const c0 of ['NOS', 'LES', 'LOS', 'LAS', 'ME', 'TE', 'SE', 'LE', 'LO', 'LA']) {
          if (pegado.startsWith(c0)) {
            let c = c0.toLowerCase();
            if (c === 'se') c = pegado.length > 2 ? 'le' : null;
            if (['lo', 'la', 'los', 'las'].includes(c) && !this.direccionales.get(verbo)) c = null;
            clitico = c;
            break;
          }
        }
      } else {
        const cadena = [];
        let k = p - 1;
        if (this.#personaForma(forma) === null) {         // "me puedes ayudar", "te voy a pagar"
          let saltos = 0;
          while (k >= 0 && saltos < 3 && (bajas[k] === 'a' || IR_FORMAS.has(normas[k])
              || items.some((y) => y.pos === k && this.verbos.has(y.glosa)))) {
            k -= 1;
            saltos += 1;
          }
        }
        while (k >= 0 && cadena.length < 2 && this.cliticosSueltos.has(bajas[k])) {
          cadena.unshift(bajas[k]);
          k -= 1;
        }
        if (cadena.length) {
          let c = cadena[0];
          if (c === 'se') c = cadena.length > 1 ? 'le' : null;
          if (['lo', 'la', 'los', 'las'].includes(c) && (cadena.length > 1 || !this.direccionales.get(verbo))) c = null;
          clitico = c;
        }
      }
      if (clitico) {
        objeto = this.lugarClitico.get(clitico);
        if (objeto[0] === '3') objeto = '3';              // se decide abajo, con la memoria
      }
      // "a mí", "a ti", "a ella", "a mi mamá" después del verbo
      for (let k = p + 1; k < Math.min(p + 6, bajas.length - 1); k += 1) {
        if (bajas[k] !== 'a' && bajas[k] !== 'al') continue;
        let j = k + 1;
        let lugar = null;
        if (bajas[k] === 'a' && this.lugarTrasA.has(bajas[j]) && !(
          bajas[j] === 'mi' && j + 1 < bajas.length && !this.omitir.has(normas[j + 1]))) {
          lugar = this.lugarTrasA.get(bajas[j]);
          for (const y of items) {
            if (y.pos === j) {
              quitar.add(y);
              if (lugar[0] === '3') lugar = verPersona(y) || lugar;
            }
          }
        } else if (objeto === null || objeto === '3') {
          while (j < bajas.length - 1 && this.antesDelNombre.has(bajas[j])) j += 1;
          if (!this.omitir.has(normas[j]) && !this.esVerbo(this.sinonimos.get(normas[j]) ?? normas[j])) {
            const destino = items.filter((y) => y.pos === j);
            lugar = destino.length ? (verPersona(destino[0]) ?? null) : null;
            if (lugar === null) lugar = bajas[k] === 'al' ? '3I' : this.#lugarSustantivo(normas[j]);
          }
        }
        if (lugar && (objeto === null || (objeto === '3' && lugar[0] === '3'))) objeto = lugar;
        break;
      }
      if (objeto === null) continue;
      // sujeto: pronombre o persona nombrada antes del verbo, o la persona de la forma verbal
      const previos = items.filter((y) => conPos(y) && y.pos < p);
      for (const y of [...previos].reverse()) {
        if (this.lugarPronombre.has(y.glosa) && !(y.pos > 0 && bajas[y.pos - 1] === 'a')) {
          sujeto = lugarDe(y) || this.lugarPronombre.get(y.glosa);
          break;
        }
      }
      if (sujeto === null) {
        let persona = this.#personaForma(forma);
        if (pegado && persona !== null) persona = '2'; // "ayúdame", "dime": imperativo
        if (persona === null) {                          // "quiero ayudarte": la persona del verbo anterior
          for (const y of [...previos].reverse()) {
            if (this.verbos.has(y.glosa)) {
              persona = this.#personaForma(bajas[y.pos]);
              if (persona) break;
            }
          }
        }
        if (persona === '3') {
          const antes = previos.filter((y) => lugarDe(y) && !(y.pos > 0 && ['a', 'al'].includes(bajas[y.pos - 1])));
          if (antes.length) {
            persona = lugarDe(antes.at(-1));
          } else {
            const ref = this.#referente(memoria, null, objeto);
            if (ref && (objeto !== '3' || memoria.recientes.length > 1)) persona = memoria.lugar.get(ref);
            else if (!quitarTildes(forma).endsWith('n')) persona = '2';   // "ayuda a tu hermano": una orden
          }
        }
        sujeto = persona || (objeto === '1' ? '2' : '1');
      }
      if (objeto === '3') {                              // "le", "lo", "la": la última persona que no es el sujeto
        const g = { lo: 'm', los: 'm', la: 'f', las: 'f' }[clitico] ?? null;
        const ref = this.#referente(memoria, g, sujeto) || this.#referente(memoria, null, sujeto);
        objeto = ref ? memoria.lugar.get(ref) : (sujeto === '3D' || clitico === 'lo' || clitico === 'los' ? '3I' : '3D');
      }
      if (sujeto === '3') sujeto = objeto === '3D' ? '3I' : '3D';
      if (sujeto === objeto) continue;
      // "a ti te digo": el pronombre objeto ya lo dice el verbo
      for (const y of items) {
        const j = y.pos;
        if (conPos(y) && j > 0 && bajas[j - 1] === 'a' && this.lugarTrasA.has(bajas[j])
            && this.lugarTrasA.get(bajas[j]) === objeto && !(bajas[j] === 'mi' && j + 1 < bajas.length)) quitar.add(y);
      }
      const direccion = `${sujeto}_${objeto}`;
      if (this.direcciones.has(direccion)) x.direccion = direccion;
    }
    return items.filter((x) => !quitar.has(x));
  }

  #analizarOracion(o, memoria) {
    const palabras = o.texto.match(PALABRA) ?? [];
    const bajas = palabras.map((p) => p.normalize('NFC').toLowerCase());
    const normas = palabras.map((p) => quitarTildes(p).toUpperCase());
    const items = [];
    const omitidas = [];
    let emocion = null;
    let verboTu = null;                                  // v60: verbo en segunda persona sin sujeto
    let tuPendiente = false;
    let i = 0;
    while (i < palabras.length) {
      const expresion = this.expresiones.find(({ partes }) =>
        partes.every((p, k) => normas[i + k] === p));
      if (expresion) {                                   // expresiones de varias palabras
        const { partes, glosa } = expresion;
        const origen = palabras.slice(i, i + partes.length).join(' ');
        for (const b_ of bajas.slice(i, i + partes.length)) {   // v62: "¡qué asco!" también pone la cara
          if (this.emociones.has(b_)) emocion = this.emociones.get(b_);
        }
        for (const g of glosa.split(/\s+/).filter(Boolean)) {
          items.push({ glosa: g, origen });
          if (this.interrogativas.has(g)) o.pregunta = true;
        }
        i += partes.length;
        continue;
      }
      const b = bajas[i];
      const n = normas[i];
      const numero = leerNumero(normas, i);              // v63: números compuestos
      if (numero !== null) {
        const [valor, usadas, cifras] = numero;
        const origen = palabras.slice(i, i + usadas).join(' ');
        for (const g of senasNumero(valor, cifras)) items.push({ glosa: g, origen, relativo: false });
        i += usadas;
        continue;
      }
      const siguienteNorma = i + 1 < normas.length ? normas[i + 1] : null;
      const sig = siguienteNorma === null ? null : (this.sinonimos.get(siguienteNorma) ?? siguienteNorma);
      let glosa = null;
      let relativo = false;
      if (this.emociones.has(b)) emocion = this.emociones.get(b);
      if (this.interrogativasPalabras.has(b)) {
        const tieneTilde = b !== quitarTildes(b);
        const alInicio = i === 0 && this.#preguntaSinSignos(b, siguienteNorma, o);
        if (tieneTilde || o.pregunta || alInicio) {
          glosa = this.interrogativasPalabras.get(b);
          o.pregunta = true;
        } else if (b === 'como') {
          // "yo como arroz": verbo comer; si no, "como" comparativo conserva su seña
          const previa = items.length ? items.at(-1).glosa : null;
          glosa = ((previa === 'YO' || previa === null) && sig !== null) ? 'COMER' : 'COMO';
          relativo = glosa === 'COMO';
        } else if (b !== 'que') {
          glosa = this.interrogativasPalabras.get(b);   // "la casa donde vivo": no se pierde la palabra
          relativo = true;
        }
      } else if (b === 'él') {
        glosa = 'EL';
      } else if (b === 'el') {
        const sustantivo = siguienteNorma !== null && this.sustantivosVerbales.has(siguienteNorma);
        glosa = (sig === null || (this.esVerbo(sig) && !sustantivo)) ? 'EL' : null;
      } else if (b === 'sí') {
        glosa = 'SI';
      } else if (b === 'sé' || (b === 'se' && i > 0 && ['no', 'yo', 'lo', 'ya'].includes(bajas[i - 1]))) {
        glosa = 'SABER';                                 // "no sé", "yo sé", "lo sé" (con o sin tilde)
      } else if (b === 'si') {
        glosa = palabras.length === 1 ? 'SI' : null;
      } else if (b === 'no') {
        glosa = 'NO';
      } else if (b === 'mi') {
        glosa = 'MIO';
      } else if (IR_FORMAS.has(n)) {
        const tras2 = i + 2 < normas.length ? normas[i + 2] : null;
        if (IR_SER.has(n)) {
          glosa = ['A', 'AL', 'PARA', 'HACIA'].includes(siguienteNorma) ? 'IR' : null; // "fue bueno": SER
        } else if (siguienteNorma === 'A' && tras2 !== null && /(AR|ER|IR)$/.test(tras2)) {
          glosa = null;                                  // futuro con "ir a" + infinitivo
        } else {
          glosa = 'IR';
        }
      } else if (DEMOSTRATIVOS.has(b)) {
        glosa = 'ESE';
      } else if (this.omitir.has(n)) {
        glosa = null;
      } else {
        glosa = this.sinonimos.get(n) || (this.vocabulario.has(n) ? n : this.verboBase(n)) || this.sinCliticos(n) || n;
      }
      if (b === 'eres' || b === 'estás') {
        tuPendiente = verboTu === null;
      } else if (verboTu === null && glosa !== null && this.verbos.has(glosa) && n !== glosa && SEGUNDA_PERSONA.test(n)
          && !(i > 0 && DETERMINANTES.has(bajas[i - 1]))) {
        tuPendiente = true;                              // "vives", "comiste", "quieres" (no "las preguntas")
      }
      if (glosa) {
        items.push({ glosa, origen: palabras[i], relativo, pos: i });
        if (tuPendiente && verboTu === null) verboTu = items.at(-1);
        tuPendiente = false;
      } else omitidas.push(palabras[i]);
      i += 1;
    }

    const conDireccion = this.#direccionar(items, bajas, normas, palabras, memoria);   // v67-v68: verbos direccionales y personas en el espacio
    items.length = 0;
    items.push(...conDireccion);

    // --- orden de la LSC
    const cortesia = items.filter((x) => this.cortesia.has(x.glosa));
    const tiempo = items.filter((x) => this.tiempo.has(x.glosa));
    const preguntas = items.filter((x) => this.interrogativas.has(x.glosa) && !x.relativo);
    let resto = items.filter((x) => !contiene(cortesia, x) && !contiene(tiempo, x) && !contiene(preguntas, x));
    // sujeto antes del verbo: TU HERMANO VIVIR DONDE
    if (resto.length >= 2 && this.esVerbo(resto[0].glosa)
        && (PRONOMBRES.has(resto[1].glosa) || POSESIVOS.has(resto[1].glosa))) {
      const largo = (POSESIVOS.has(resto[1].glosa) && resto.length >= 3 && !this.esVerbo(resto[2].glosa)) ? 2 : 1;
      resto = [...resto.slice(1, 1 + largo), ...resto.slice(0, 1), ...resto.slice(1 + largo)];
    }
    // "¿cómo se llama tu mamá?": el poseedor va antes de NOMBRE (TU MAMA NOMBRE CUAL)
    for (let k = 0; k < resto.length; k += 1) {
      const x = resto[k];
      if (x.glosa === 'NOMBRE' && quitarTildes(x.origen.toLowerCase()).startsWith('como se llama') && k + 1 < resto.length) {
        resto = [...resto.slice(0, k), ...resto.slice(k + 1), x];
        break;
      }
    }
    // v60: el demostrativo va después del sustantivo (PERSONA ESE)
    for (let k = 0; k < resto.length - 1;) {
      const x = resto[k];
      const y = resto[k + 1];
      if (x.glosa === 'ESE' && !DEMOSTRATIVOS_PRONOMBRE.has(x.origen.toLowerCase())
          && !this.esVerbo(y.glosa) && !SUJETOS.has(y.glosa) && y.glosa !== 'NO') {
        resto[k] = y;
        resto[k + 1] = x;
        k += 2;
      } else k += 1;
    }
    // v60: sujeto tácito de segunda persona: TU justo antes del verbo
    if (verboTu !== null && !items.some((x) => SUJETOS.has(x.glosa))) {
      const tu = { glosa: 'TU', origen: verboTu.origen, relativo: false };
      const donde = resto.indexOf(verboTu);
      if (donde >= 0) resto = [...resto.slice(0, donde), tu, ...resto.slice(donde)];
    }
    // negación: NO después del primer verbo que la sigue; si no hay verbo, al final
    const cuerpo = [];
    const negados = [];
    let pendientes = 0;
    const agregarNo = () => {
      for (let k = 0; k < pendientes; k += 1) cuerpo.push({ glosa: 'NO', origen: 'no' });
    };
    for (const x of resto) {
      if (x.glosa === 'NO' && resto.length > 1) {
        pendientes += 1;
        continue;
      }
      cuerpo.push(x);
      if (pendientes && this.esVerbo(x.glosa)) {
        negados.push(x);
        agregarNo();
        pendientes = 0;
      }
    }
    agregarNo();
    // v60: YA (acción terminada) al final, salvo "ya no"
    const conYa = (cuerpo.length > 1 && !cuerpo.some((x) => x.glosa === 'NO'))
      ? [...cuerpo.filter((x) => x.glosa !== 'YA'), ...cuerpo.filter((x) => x.glosa === 'YA')]
      : cuerpo;
    const ordenados = [...cortesia, ...tiempo, ...conYa, ...preguntas];

    // --- tipo de oración y expresión facial
    const glosas = ordenados.map((x) => x.glosa + (x.direccion ? `_${x.direccion}` : ''));
    let tipo;
    let expresion;
    if (preguntas.length || glosas.some((g) => this.preguntasFijas.has(g))) {
      [tipo, expresion] = ['pregunta_abierta', 'pregunta_abierta'];
    } else if (o.pregunta) {
      [tipo, expresion] = ['pregunta_si_no', 'pregunta_si_no'];
    } else if (glosas.includes('NO') && glosas.length > 1) {
      [tipo, expresion] = ['negativa', null];
    } else if (emocion) {
      [tipo, expresion] = ['emocion', emocion];
    } else if (o.exclamacion) {
      [tipo, expresion] = ['exclamativa', 'cejas_arriba'];
    } else {
      [tipo, expresion] = ['afirmativa', null];
    }
    if (emocion && tipo !== 'emocion' && expresion === null) expresion = emocion;
    for (const x of ordenados) {
      if (this.cortesia.has(x.glosa)) x.expresion = null;              // conserva la suya
      else if (tipo === 'negativa') x.expresion = contiene(negados, x) ? 'negar' : emocion;
      else if (x.glosa === 'NO') x.expresion = null;                   // el clip ya niega
      else if (tipo === 'pregunta_abierta' && !x.relativo
        && (this.interrogativas.has(x.glosa) || this.preguntasFijas.has(x.glosa))) {
        x.expresion = this.rostroPregunta.get(x.glosa) ?? 'pregunta_wh'; // v58: cara de la seña
      } else x.expresion = expresion;
      if (x.relativo && x.expresion === null) x.expresion = 'neutral';  // "donde vivo": sin ceño
    }

    return {
      texto: o.texto.trim(),
      tipo,
      glosas,
      expresiones: ordenados.map((x) => x.expresion),
      con_sena: glosas.map((g) => this.vocabulario.has(g)),
      omitidas,
      glosa_lsc: glosas.join(' ') + (MARCAS[tipo] ?? ''),
    };
  }

  /** Frase en español -> oraciones con glosas en orden LSC y expresión por glosa. */
  analizar(texto) {
    const memoria = { lugar: new Map(), recientes: [] };   // v68: las personas quedan en su lugar de una oración a otra
    const oraciones = this.#oraciones(quitarSignosRaros(texto)).map((o) => this.#analizarOracion(o, memoria));
    return {
      oraciones,
      glosas: oraciones.flatMap((o) => o.glosas),
      expresiones: oraciones.flatMap((o) => o.expresiones),
      glosa_lsc: oraciones.map((o) => o.glosa_lsc).join(' // '),
    };
  }

  /* ----- Diccionario de clips (AnimacionService.java) ---------------------- */

  #paso(glosa, [archivo, duracion, blend], tipo, palabraOrigen) {
    return { glosa, archivo, duracion, expresion: blend || 'neutral', tipo, palabraOrigen };
  }

  /** Quita tildes y diéresis pero conserva la Ñ; descarta lo que no sea letra o número. */
  static normalizarParaDeletreo(palabra) {
    let salida = '';
    for (const c of palabra.toUpperCase()) {
      if (c === 'Ñ') { salida += c; continue; }
      for (const b of c.normalize('NFD').replace(/\p{M}/gu, '')) {
        if (/[\p{L}\p{Nd}]/u.test(b)) salida += b;               // Character.isLetterOrDigit
      }
    }
    return salida;
  }

  #deletrear(palabra, secuencia, noEncontradas) {
    const letras = CerebroLocal.normalizarParaDeletreo(palabra);
    let i = 0;
    while (i < letras.length) {
      if (i + 1 < letras.length && this.letras.has(letras.slice(i, i + 2))) {   // dígrafo (CH, LL, RR)
        const d = letras.slice(i, i + 2);
        secuencia.push(this.#paso(d, this.letras.get(d), 'LETRA', palabra));
        i += 2;
        continue;
      }
      const letra = letras[i];
      if (this.letras.has(letra)) secuencia.push(this.#paso(letra, this.letras.get(letra), 'LETRA', palabra));
      else noEncontradas.push(letra);
      i += 1;
    }
  }

  /** Glosas -> pasos de animación: seña, partes de una glosa compuesta o deletreo. */
  animar(glosas) {
    const secuencia = [];
    const noEncontradas = [];
    for (const cruda of glosas) {
      if (!cruda || !cruda.trim()) continue;
      const glosa = cruda.trim().toUpperCase();
      if (this.senas.has(glosa)) {
        secuencia.push(this.#paso(glosa, this.senas.get(glosa), 'SENA', null));
        continue;
      }
      for (const parte of glosa.split(/[_\s-]+/)) {
        if (!parte) continue;
        if (parte !== glosa && this.senas.has(parte)) secuencia.push(this.#paso(parte, this.senas.get(parte), 'SENA', null));
        else this.#deletrear(parte, secuencia, noEncontradas);
      }
    }
    const total = secuencia.reduce((t, p) => t + p.duracion, 0);
    return { secuencia, duracionTotal: Math.round(total * 100) / 100, noEncontradas };
  }

  /* ----- Todo junto (main.py) ---------------------------------------------- */

  /**
   * Texto en español -> la misma respuesta que /api/v1/traducir.
   * Lanza un Error con `estado = 422` si el texto no tiene palabras.
   */
  traducir(texto) {
    const analisis = this.analizar(texto);
    if (!analisis.glosas.length) {
      throw Object.assign(new Error('El texto no tiene palabras para traducir.'), { estado: 422 });
    }
    const secuencia = [];
    const noEncontradas = [];
    analisis.glosas.forEach((glosa, k) => {
      const parcial = this.animar([glosa]);
      const expresion = analisis.expresiones[k];
      for (const paso of parcial.secuencia) secuencia.push(expresion ? { ...paso, expresion } : paso);
      noEncontradas.push(...parcial.noEncontradas);
    });
    const total = secuencia.reduce((t, p) => t + (p.duracion || 0), 0);
    return {
      texto_espanol: texto,
      glosas: analisis.glosas,
      glosa_lsc: analisis.glosa_lsc,
      oraciones: analisis.oraciones,
      animacion: { secuencia, duracionTotal: Math.round(total * 100) / 100, noEncontradas },
      cerebro: 'local',
    };
  }
}
