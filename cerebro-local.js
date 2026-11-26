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
    this.senas = new Map(Object.entries(datos.diccionario.senas));
    this.letras = new Map(Object.entries(datos.diccionario.letras));
  }

  /* ----- Gramática (procesador_lsc.py) ------------------------------------- */

  /** Divide en oraciones por la puntuación y marca preguntas y exclamaciones. */
  #oraciones(texto) {
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

  #analizarOracion(o) {
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
        for (const g of glosa.split(/\s+/).filter(Boolean)) {
          items.push({ glosa: g, origen });
          if (this.interrogativas.has(g)) o.pregunta = true;
        }
        i += partes.length;
        continue;
      }
      const b = bajas[i];
      const n = normas[i];
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
        items.push({ glosa, origen: palabras[i], relativo });
        if (tuPendiente && verboTu === null) verboTu = items.at(-1);
        tuPendiente = false;
      } else omitidas.push(palabras[i]);
      i += 1;
    }

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
    const glosas = ordenados.map((x) => x.glosa);
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
    const oraciones = this.#oraciones(quitarSignosRaros(texto)).map((o) => this.#analizarOracion(o));
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
