/**
 * Avatar Señas · Punto de entrada de la aplicación
 *
 * Organización del proyecto:
 *   app.js                 → visor 3D (Módulo 1) e interfaz de prueba.
 *   secuenciador-senas.js  → cola de glosas y transiciones (Módulo 2).
 *   control-facial.js      → expresiones y gestos de cabeza (Módulo 2).
 *
 * AvatarViewer no depende de la interfaz a propósito. Una frase en español pasa
 * por el cerebro lingüístico (Python, Módulo 5), que pide la secuencia a Java;
 * al final todo llega a secuenciador.reproducirSecuenciaGlosas(listaGlosas).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ControlFacial, EXPRESIONES } from './control-facial.js?v=61';
// ?v= obliga al navegador a descargar la versión nueva tras un cambio.
import { SecuenciadorSenas } from './secuenciador-senas.js?v=60';
import { setEstilo } from './estilo-anime.js?v=51';
import { TransicionNatural } from './transicion-natural.js?v=51';
import { InterpreteVivo } from './interprete-vivo.js?v=55';
import { CerebroLocal } from './cerebro-local.js?v=60';

/* ==========================================================================
   1. CONFIGURACIÓN
   ========================================================================== */

/**
 * Avatares disponibles. Cada uno tiene su modelo y su carpeta de señas, porque los
 * clips se generan para el cuerpo de cada avatar (alto, largo de brazos y manos).
 * El backend envía rutas que empiezan por "animations/": el secuenciador las cambia
 * por la carpeta del avatar elegido.
 */
const AVATARES = {
  adam: { nombre: 'Adam', modelo: './avatares/adam/avatar.glb', animaciones: './avatares/adam/animations/' },
  clasico: { nombre: 'Clásico (anterior)', modelo: './models/avatar.glb', animaciones: './animations/' },
};
const AVATAR_INICIAL = 'adam';

/** Avatar elegido: ?avatar= en la dirección, la última elección guardada o el inicial. */
function avatarElegido() {
  let id = new URLSearchParams(location.search).get('avatar');
  if (!id) {
    try { id = localStorage.getItem('avatar'); } catch { id = null; }
  }
  return AVATARES[id] ? id : AVATAR_INICIAL;
}
const AVATAR = avatarElegido();

/*
 * Vista para OBS (v55): ?overlay deja solo el avatar, con fondo transparente, y
 * empieza a interpretar solo. El audio lo graba el oído Whisper del sistema
 * (&fuente=..., por omisión todo lo que suena en el computador), porque OBS no
 * da micrófono a sus fuentes de navegador. &subtitulos=1 muestra lo que oye y
 * &metricas=1 el atraso.
 */
const PARAMS = new URLSearchParams(location.search);
const MODO_OVERLAY = PARAMS.has('overlay');
const FUENTE_TODO = '@DEFAULT_MONITOR@';
if (MODO_OVERLAY) document.body.classList.add('modo-overlay');

const CONFIG = {
  avatar: AVATAR,
  modelUrl: `${AVATARES[AVATAR].modelo}?v=51b`, // ?v= obliga a descargar el modelo nuevo.
  animaciones: AVATARES[AVATAR].animaciones,

  background: 0x20262e,

  camera: {
    fov: 35, // Un ángulo cerrado deforma menos el cuerpo que uno abierto.
  },

  framing: {
    // Las señas ocurren de la cintura hacia arriba, así que la cámara inicial
    // apunta al torso en lugar de al centro geométrico del cuerpo.
    // Plano medio: de la cadera a la cabeza, con las manos grandes en pantalla.
    // Con el avatar de 1,79 m se ve de 0,73 m a 1,84 m de altura.
    targetHeight: 0.72, // Punto de mira: fracción de la altura del modelo.
    visibleHeight: 0.62, // Fracción de la altura que entra en cuadro (antes 0.8).
    // Ancho del espacio de señas como fracción de la altura. No se usa el ancho
    // real del modelo porque en pose T los brazos extendidos lo inflan y, en un
    // móvil en vertical, el avatar quedaría diminuto.
    visibleWidth: 0.58, // Caben las dos manos abiertas a los lados (BIENVENIDO).
  },

  lights: {
    ambient: { color: 0xffffff, intensity: 0.9 },
    // Direccional principal: da volumen. Las otras dos suavizan las sombras
    // y separan la silueta del fondo, lo que ayuda a leer manos y brazos.
    key: { color: 0xfff4e6, intensity: 2.2, position: [2, 4, 3] },
    fill: { color: 0xdfe9ff, intensity: 0.8, position: [-3, 2, 2] },
    rim: { color: 0xffffff, intensity: 0.8, position: [0, 3, -4] },
  },

  animation: {
    fadeSeconds: 0.25, // Transición entre animaciones.
    // Tope del delta: evita saltos tras un tirón. Por debajo de 10 FPS la seña
    // se ve más lenta, pero sigue completa en vez de saltarse movimientos.
    maxDelta: 0.1,
  },

  // Estilo visual inicial: 'anime' (cel shading) o 'realista'.
  estilo: 'realista',

  // Módulo 4: backend Spring Boot con el diccionario de señas.
  backend: {
    url: 'http://localhost:8080/api/animacion',
  },

  // Módulo 5: cerebro lingüístico (FastAPI). Convierte la frase en glosas,
  // pide la secuencia a Java y responde { glosas, animacion }.
  cerebro: {
    url: 'http://localhost:8001/api/v1/traducir',
    // v56: la gramática y el diccionario también corren en la página (cerebro-local.js),
    // así que traducir texto no necesita Python ni Java. ?cerebro=servidor usa el de Python.
    local: './cerebro-datos.json',
    modo: PARAMS.get('cerebro') || 'auto', // 'auto' (local; si no carga, el servidor) | 'local' | 'servidor'
  },

  // Glosas del selector de prueba: las 334 señas del Diccionario básico de la LSC instaladas.
  devUi: {
    glosas: [
      'HOLA', 'ADIOS', 'GRACIAS', 'BUENO', 'BUENOS_DIAS', 'BUENAS_TARDES', 'BUENAS_NOCHES', 'NOCHE',
      'LO_SIENTO', 'DE_NADA', 'PERDON', 'COMO_ESTA', 'COMO', 'SI', 'NO', 'BIEN',
      'MAL', 'YO', 'TU', 'EL', 'NOSOTROS', 'USTEDES', 'QUE', 'QUIEN',
      'DONDE', 'CUANDO', 'POR_QUE', 'CUANTO', 'CUAL', 'MAMA', 'PAPA', 'HERMANO',
      'HIJO', 'FAMILIA', 'AMIGO', 'AMOR', 'HOY', 'AYER', 'MAÑANA', 'AHORA',
      'DIA', 'SEMANA', 'QUERER', 'TENER', 'COMER', 'AYUDAR', 'ENTENDER', 'APRENDER',
      'TRABAJAR', 'ESTUDIAR', 'VIVIR', 'NECESITAR', 'PODER', 'GUSTAR', 'SABER', 'PENSAR',
      'ESPERAR', 'CASA', 'SORDO', 'OYENTE', 'INTERPRETE', 'SEÑAR', 'BIENVENIDO', 'POR_FAVOR',
      'NOMBRE', 'MIO', 'SUYO', 'NUESTRO', 'REGULAR',
      'TUYO', 'USTED', 'ELLOS', 'ATENCION', 'OLVIDAR', 'RECORDAR', 'TAMBIEN', 'NO_PODER', 'NO_SABER', 'NO_IMPORTA',
      'GROSERO', 'PEREZOSO', 'MOLESTAR', 'INTERES', 'ASISTIR', 'CONFUNDIDO', 'OBEDECER', 'JAMAS', 'CANSON',
      'EMBARAZO', 'YERNO', 'LUNA_DE_MIEL', 'UNION_LIBRE', 'SEPARADO', 'CATOLICO', 'MATRIMONIO_CATOLICO', 'MATRIMONIO_CIVIL',
      'BAUTISMO', 'MEJOR', 'MAYOR', 'MENOR', 'PADRINO', 'MATRIMONIO', 'ADOPTAR', 'PADRASTRO', 'MADRASTRA', 'HERMANASTRO',
      'DIVORCIO', 'COMPROMISO', 'CRISTIANO', 'ATEO',
      'VIUDO', 'AMANTE', 'HACER_EL_AMOR', 'SEXO', 'SEXUALIDAD',
      'PERMISO', 'NOS_VEMOS',
      // tanda 7 (v34): colegio e instituciones
      'BACHILLERATO', 'BIBLIOTECA', 'CIENCIAS', 'COMPAÑERO', 'CORTAR', 'CURSO', 'DIBUJAR', 'DIPLOMA', 'EDUCACION_FISICA',
      'ESPAÑOL', 'GEOGRAFIA', 'HISTORIA', 'INGLES', 'INVENTAR', 'KINDER', 'MATEMATICAS', 'PRIMARIA', 'QUIMICA', 'SALON',
      'TABLERO', 'SUMAR', 'TEMA', 'CALIFICAR', 'BIOLOGIA', 'MANUALIDADES', 'BORRADOR', 'CARTUCHERA', 'COSEDORA', 'CUADERNO',
      'DICCIONARIO', 'ESFERO', 'HOJA', 'LAPIZ', 'MARCADOR', 'MORRAL', 'PEGANTE', 'REGLA', 'TAJALAPIZ', 'POLICIA', 'ALCALDE',
      'PRESIDENTE', 'GOBIERNO', 'BANDERA', 'CEDULA', 'LEY', 'VOTAR', 'REUNION', 'SUELDO', 'JUSTICIA', 'PAZ', 'DIOS',
      'IGLESIA', 'REZAR', 'MISA', 'NAVIDAD', 'BIBLIA', 'SACERDOTE',
      // tanda 8 (v35): profesiones y naturaleza
      'ABOGADO', 'ACTOR', 'ARQUITECTO', 'ARTE', 'CAJERO', 'CANTANTE', 'CARPINTERO', 'CELADOR', 'CHEF', 'CHOFER',
      'CIENTIFICO', 'COMERCIANTE', 'CONTADOR', 'JEFE', 'DIRECTOR', 'ELECTRICISTA', 'ENFERMERA', 'ESCRITOR',
      'FOTOGRAFO', 'INGENIERO', 'MECANICO', 'MUSICO', 'ODONTOLOGO', 'PELUQUERO', 'PERIODISTA', 'PILOTO', 'PINTOR',
      'PLOMERO', 'PROFESION', 'PSICOLOGO', 'SECRETARIA', 'VENDEDOR', 'ZAPATERO', 'EXPERIENCIA', 'ARBOL', 'ESTRELLA',
      'LLUVIA', 'LUNA', 'MAR', 'MONTAÑA', 'NUBE', 'RIO', 'FLOR', 'CAMPO', 'CAMPESINO', 'FINCA', 'PIEDRA', 'PLAYA',
      'SOL', 'VIENTO',
      // tanda 9 (v36): geografía, cualidades, colores y calificar
      'AFRICA', 'AMERICA', 'ASIA', 'AUSTRALIA', 'BARRANQUILLA', 'BRASIL', 'CALI', 'CARTAGENA', 'ECUADOR', 'ESPAÑA',
      'ESTADOS_UNIDOS', 'EUROPA', 'MEDELLIN', 'MUNDO', 'PANAMA', 'PERU', 'VENEZUELA', 'ALTO', 'ANCHO', 'ANGOSTO',
      'CALIENTE', 'CLARO', 'COMPLETO', 'CORRECTO', 'CORTO', 'COSA', 'DAÑADO', 'FINO', 'FRIO', 'LARGO',
      'NUEVO', 'OSCURO', 'PARECIDO', 'PELIGROSO', 'PESADO', 'SUCIO', 'ULTIMO', 'VACIO', 'VIEJO', 'ANARANJADO',
      'COLOR', 'GRIS', 'MORADO', 'CUIDADO', 'DESPACIO', 'IMPOSIBLE', 'MISMO', 'NORMAL', 'PEOR', 'RAPIDO',
      'URGENTE',
      // tanda 10 (v37): animales, números, espacio y cantidad
      'ACUARIO', 'ARAÑA', 'BALLENA', 'BURRO', 'CARACOL', 'CONDOR', 'DELFIN', 'ELEFANTE', 'GALLO', 'HORMIGA',
      'JAULA', 'JIRAFA', 'MICO', 'MORDER', 'MOSCA', 'NIDO', 'OSO', 'OVEJA', 'PATO', 'PEZ',
      'PICAR', 'SAPO', 'TIBURON', 'TORO', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS',
      'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'CINCUENTA', 'CIEN', 'MIL', 'MILLON', 'NUMERO', 'ABAJO', 'ARRIBA',
      'ADELANTE', 'DETRAS', 'ADENTRO', 'AFUERA', 'CERCA', 'LEJOS', 'NORTE', 'OCCIDENTE', 'ORIENTE', 'SUR',
      'MAS', 'MENOS', 'NADA',
      // tanda 11 (v38): características y sentimientos
      'AGIL', 'AUTORITARIO', 'BESAR', 'CAPAZ', 'VALIENTE', 'FUERTE', 'CHISTOSO', 'COBARDE', 'CONFIANZA', 'CONTENTO',
      'COQUETO', 'CUMPLIDO', 'CURIOSO', 'DEPRIMIDO', 'DESCONCERTADO', 'DESOBEDIENTE', 'DESOCUPADO', 'DESORDENADO', 'DIGNIDAD', 'ELEGANTE',
      'EMOCIONADO', 'ENAMORAR', 'FURIOSO', 'ENVIDIOSO', 'EXPRESIVO', 'FAMOSO', 'FIEL', 'INFIEL', 'FLACO', 'GENEROSO',
      'GORDO', 'HONESTO', 'IGNORAR', 'INCUMPLIDO', 'INOCENTE', 'JUICIOSO', 'LIDER', 'LOCO', 'MALO', 'MENTIROSO',
      'OBEDIENTE', 'ODIO', 'OPTIMISTA', 'ORGULLOSO', 'PACIENCIA', 'PENA', 'PESIMISTA', 'POBRE', 'RESPONSABLE', 'SEGURO',
      'SERIO', 'SOLO', 'TERCO', 'TIERNO', 'TIMIDO',
      // tanda 12 (v39): frutas, verduras, comidas y bebidas
      'AGUACATE', 'AJO', 'AJI', 'ARVEJA', 'BANANO', 'COCO', 'CEBOLLA', 'CURUBA', 'DURAZNO', 'FRESA',
      'FRIJOL', 'GUAYABA', 'HABICHUELA', 'LECHUGA', 'LIMON', 'MANDARINA', 'MANGO', 'MANZANA', 'MAZORCA', 'MORA',
      'PAPAYA', 'PERA', 'PIÑA', 'UVA', 'TOMATE', 'VERDURA', 'YUCA', 'ZANAHORIA', 'ACEITE', 'ACIDO',
      'AREPA', 'AROMATICA', 'AZUCAR', 'CAMARON', 'CERVEZA', 'COCINAR', 'COMIDA', 'ENSALADA', 'ESPESO', 'GALLETA',
      'GELATINA', 'HAMBURGUESA', 'JAMON', 'MERCADO', 'PANELA', 'PASTA', 'PERRO_CALIENTE', 'PIZZA', 'PONQUE', 'SAL',
      'SALSA_DE_TOMATE', 'SANDUCHE', 'TAMAL', 'VINO', 'YOGUR',
      // tanda 13 (v40): ciudad y transporte
      'AEROPUERTO', 'ALMACEN', 'AUTOPISTA', 'AVENIDA', 'BASURA', 'BOMBA_DE_GASOLINA', 'CAFETERIA', 'CAJERO_AUTOMATICO',
      'CARCEL', 'CARNICERIA', 'CARRERA', 'CEMENTERIO', 'CENTRO_COMERCIAL', 'CENTRO', 'DIRECCION', 'DROGUERIA',
      'EDIFICIO', 'ESQUINA', 'ESTACION_DE_POLICIA', 'ESTADIO', 'FABRICA', 'FERRETERIA', 'FUNERARIA', 'HOTEL',
      'LIBRERIA', 'MUSEO', 'OFICINA', 'PANADERIA', 'PAPELERIA', 'PARADERO', 'PARQUEADERO', 'PELUQUERIA',
      'PLAZA_DE_MERCADO', 'PORTERIA', 'PUENTE', 'SEMAFORO', 'SUPERMERCADO', 'TERMINAL', 'AMBULANCIA', 'BUSETA',
      'CAMION', 'CARRETERA', 'CHOCAR', 'FLOTA', 'FRENAR', 'HELICOPTERO', 'PITAR', 'TRANCON',
      'TRANSMILENIO', 'TREN', 'VELOZ', 'VIAJAR',
      // tanda 14 (v41): hogar y vivienda
      'ALICATE', 'ALMOHADA', 'APAGAR_LA_LUZ', 'PRENDER_LA_LUZ', 'ARMARIO', 'ASCENSOR', 'ASPIRADORA', 'BALDE',
      'BANDEJA', 'BATIDORA', 'BOTELLA', 'BRILLADORA', 'CAJA', 'CANECA', 'COBIJA', 'COMEDOR',
      'COPA', 'CORTINA', 'CUADRO', 'CUCHILLO', 'DESTORNILLADOR', 'DETERGENTE', 'DUCHA', 'ESCOBA',
      'ESPEJO', 'ESPONJA', 'ESTUFA', 'EXTINGUIDOR', 'FOSFORO', 'HERRAMIENTA', 'HORNO', 'JARDIN',
      'JARRA', 'LADRILLO', 'LAMPARA', 'LAVADORA', 'LICUADORA', 'LINTERNA', 'MANGUERA', 'MARTILLO',
      'OLLA', 'ORGANIZAR', 'PARED', 'PATIO', 'PINTURA', 'PLANCHA', 'POCILLO', 'SARTEN',
      'SERVILLETA', 'SOFA', 'TALADRO', 'TAPETE', 'TENDER_LA_CAMA', 'TENEDOR', 'TIMBRE', 'TRAPERO',
      'TRASTEAR', 'TUBERIA',
      // tanda 15 (v42): deportes y actividades
      'AJEDREZ', 'ARBITRO', 'ATLETISMO', 'BALON', 'BILLAR', 'BALONCESTO', 'BOXEO', 'BUCEO',
      'CAMPEON', 'CAMPEONATO', 'CANCHA', 'DEPORTE', 'EMPATAR', 'ENTRENAR', 'FUTBOL', 'GANAR',
      'GOL', 'NADAR', 'PARTIDO', 'PATINAJE', 'PERDER', 'REGLAMENTO', 'TEJO', 'TENIS',
      'VOLEIBOL', 'TROFEO', 'ACEPTAR', 'ACOMPAÑAR', 'ARREGLAR', 'CAER', 'CAMBIAR', 'CINE',
      'CONCIERTO', 'CUIDAR', 'ENVIAR', 'ESCOGER', 'EXTRAÑAR', 'FALTAR', 'FIESTA', 'GUARDAR',
      'GUITARRA', 'INVITAR', 'LLENAR', 'LLEVAR', 'MOSTRAR', 'PASEAR', 'PELICULA', 'PIANO',
      'PRACTICAR', 'PRESTAR', 'REGALAR', 'RESPETAR', 'SALTAR', 'SUERTE', 'VACACIONES',
      // tanda 16 (v43): vestuario, aseo personal y salud
      'ABRIGO', 'SACO', 'CHAQUETA', 'BILLETERA', 'BLUSA', 'CADENA', 'CAMISETA', 'CINTURON',
      'CORBATA', 'DESVESTIRSE', 'FALDA', 'LANA', 'MEDIAS', 'PIJAMA', 'SOMBRERO', 'SUDADERA',
      'TELA', 'UNIFORME', 'AFEITAR', 'BAÑAR', 'CEPILLAR', 'CEPILLO_DE_DIENTES', 'CHAMPU', 'COLORETE',
      'CREMA_DE_DIENTES', 'CREMA_DE_MANOS', 'DESODORANTE', 'EMBETUNAR', 'JABON', 'MAQUILLAJE', 'PAÑAL', 'PAPEL_HIGIENICO',
      'PERFUME', 'TALCO', 'TOALLA', 'TOALLA_HIGIENICA', 'ACNE', 'ALGODON', 'CANCER', 'CIRUGIA',
      'DESMAYARSE', 'DIARREA', 'EXAMEN_MEDICO', 'FRACTURA', 'INFARTO', 'INFECCION', 'JERINGA', 'RADIOGRAFIA',
      'SIDA', 'TERMOMETRO',
      // tanda 17 (v44): inteligencia, tiempo, comunicación y cultura sorda
      'CONOCER', 'DECIDIR', 'CREER', 'NO_CREER', 'DEFENDER', 'DESCUBRIR', 'DUDAR', 'IDEA',
      'NO_ENTENDER', 'PREOCUPAR', 'PROBLEMA', 'RAZON', 'VERDAD', 'DE_PRONTO', 'FECHA', 'HACE_MUCHO_TIEMPO',
      'MINUTO', 'POR_LA_MAÑANA', 'PRONTO', 'PROXIMO', 'TIEMPO', 'TODO_EL_DIA', 'ACONSEJAR', 'CHISME',
      'CONTAR', 'CORREO', 'DISCUTIR', 'ENTONCES', 'GRITAR', 'OTRO', 'PALABRA', 'REPETIR',
      'SECRETO', 'SILENCIO', 'TAMPOCO', 'ALFABETO_MANUAL', 'AUDIFONO', 'AUDIOMETRIA', 'COPIAR', 'FENASCOL',
      'ORALIZAR', 'FONOAUDIOLOGO', 'HIPOACUSICO', 'INSOR', 'INTEGRAR', 'LENGUA_DE_SEÑAS', 'SORDO_CIEGO', 'TELEFONO_DE_TEXTO',
      // tanda 18 (v45): tecnología y administración, gobierno y comercio
      'ANTENA_PARABOLICA', 'CALCULADORA', 'CAMARA', 'CELULAR', 'COMPUTADOR', 'DISCO_COMPACTO', 'EQUIPO_DE_SONIDO', 'FAX',
      'FILMADORA', 'FOTOCOPIADORA', 'IMPRESORA', 'INTERNET', 'TELEFONO', 'VIDEO', 'ADMINISTRAR', 'AHORRAR',
      'ASOCIACION', 'CHEQUE', 'CONGRESO', 'CONSIGNAR', 'COOPERATIVA', 'CREDITO', 'CULTURA', 'DEMOCRACIA',
      'DEPARTAMENTO', 'DERECHO', 'DEUDA', 'ETICA', 'FACTURA', 'FIRMAR', 'FRONTERA', 'GASTAR',
      'HOJA_DE_VIDA', 'IMPUESTO', 'MULTA', 'INDIGENA', 'INSTITUTO', 'JUNTA', 'LIBRE', 'MANIFESTACION',
      'PESO', 'PENSIONADO', 'POLITICO', 'PUEBLO', 'QUIEBRA', 'RENUNCIAR', 'SINDICATO', 'SOCIO',
      // tanda 19 (v47): acciones y distracciones, sanciones sociales y vicios, religión
      'ABANDONAR', 'ACOSTUMBRAR', 'AGREGAR', 'APLAZAR', 'APOYAR', 'APROVECHAR', 'CARNAVAL', 'COGER',
      'COLGAR', 'CONTINUAR', 'DEPENDER', 'DISCOTECA', 'ENGAÑAR', 'EQUIVOCARSE', 'ESPARCIR', 'ESTRENAR',
      'FLAUTA', 'HABER', 'METER', 'MUSICA', 'PARECER', 'PARTICIPAR', 'PROGRESAR', 'PROHIBIR',
      'ABORTAR', 'ABUSAR', 'ABUSO_SEXUAL', 'CASTIGAR', 'ALCOHOLISMO', 'CULPABLE', 'DROGADICCION', 'FUMAR',
      'ENEMIGO', 'HOMICIDIO', 'LADRON', 'NARCOTRAFICO', 'PELEAR', 'ROBAR', 'SECUESTRAR', 'ALMA',
      'COMULGAR', 'DIABLO', 'FE', 'JESUS', 'MILAGRO', 'MONJA', 'ORACION', 'PECADO',
      'RELIGION', 'SEMANA_SANTA',
      // tanda 20 (v48): ser humano (cuerpo, fisiología, vestuario) y profesiones
      'ADULTO', 'ALGUNOS', 'CADA_UNO', 'ANCIANO', 'ELLOS_DOS', 'HOMOSEXUAL', 'NOSOTROS_DOS', 'TU_MISMO',
      'YO_MISMO', 'BIGOTE', 'CALVO', 'CANOSO', 'CEJA', 'ESTOMAGO', 'FRENTE', 'HOMBRO',
      'MENTON', 'MONO', 'MORENO', 'PENE', 'PESTAÑAS', 'UÑAS', 'VAGINA', 'VELLUDO',
      'ASUSTARSE', 'CRECER', 'DEBIL', 'OBSERVAR', 'OLER', 'RESPIRAR', 'TOCAR', 'BRASIER',
      'CUERO', 'INTERIORES', 'MODA', 'PANTALONCILLOS', 'VESTIDO_DE_BAÑO', 'ACTIVIDAD', 'DIBUJANTE', 'EMPLEADA_DOMESTICA',
      'ESCULTOR', 'FILOSOFO', 'LINGUISTA', 'LOTERO', 'MENSAJERO', 'MODISTA', 'PEDIATRA', 'REINA',
      // tanda 21 (v49): lenguaje y comunicación, educación, naturaleza
      'APARTE', 'COMUNICAR', 'CRITICAR', 'DISCURSO', 'ESPERE', 'FRASE', 'HASTA', 'INSULTAR',
      'JUSTIFICAR', 'LENGUA', 'PARA', 'PERO', 'QUE_ALIVIO', 'SIGNIFICAR', 'VOCABULARIO', 'ASORVAL',
      'SOCIEDAD_DE_SORDOS_DE_BOGOTA', 'MAS_O_MENOS', 'CUAL_DE_LOS_DOS', 'PARA_QUE', 'QUE_ES_ESO', 'QUE_LE_PASA', 'AGRADECER', 'FELICITAR',
      'PRESENTAR_A', 'BILINGUISMO', 'CALIFICACION', 'FALLAR', 'GANAR_EL_AÑO', 'FISICA', 'MEDIR', 'PASAR_EL_AÑO',
      'PERDER_EL_AÑO', 'PUPITRE', 'HORARIO_DE_CLASES', 'LONCHERA', 'PINCEL', 'ARCO_IRIS', 'CIELO', 'PETROLEO',
      'SEMBRAR', 'HOGAR', 'MACHISMO', 'PRIVADO', 'AÑO_PASADO', 'SEISCIENTOS',
      // tanda 22 (v50): las últimas del diccionario
      'ACUEDUCTO', 'ENERGIA_ELECTRICA', 'GARAJE', 'REGISTRADORA', 'COLECTIVO', 'PASE', 'PINCHAR', 'TRANSPORTAR',
      'CASETE_VHS', 'CEMENTO', 'CHIMENEA', 'FLORERO', 'CAPITAL', 'FISCAL', 'HIMNO_NACIONAL', 'MINISTERIO',
      'VOCAL', 'TELEVISOR', 'ELEGIR', 'INSTITUTO_DE_CIEGOS_Y_SORDOS',
      // v54: señas nuevas del video de Fundesor
      'ELLA', 'POR_DONDE', 'QUE_PASO',
      // tanda 2 (v22)
      'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO',
      'NUEVE', 'DIEZ', 'ROJO', 'AZUL', 'AMARILLO', 'VERDE', 'NEGRO', 'BLANCO',
      'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO', 'DECIR',
      'HABLAR', 'VER', 'OIR', 'PREGUNTAR', 'RESPONDER', 'EXPLICAR', 'LEER', 'ESCRIBIR',
      'ENSEÑAR', 'LLAMAR', 'PROFESOR', 'ESTUDIANTE', 'CLASE', 'COLEGIO', 'UNIVERSIDAD', 'LIBRO',
      'TAREA', 'EXAMEN', 'COLOMBIA', 'BOGOTA', 'CIUDAD', 'PAIS', 'NOTICIERO', 'PERIODICO',
      'TELEVISION', 'AQUI', 'ALLA', 'YA', 'MUCHO', 'POCO', 'TODOS', 'FUTURO',
      'GRANDE', 'PEQUEÑO', 'BONITO', 'IMPORTANTE', 'FACIL', 'DIFICIL', 'IGUAL', 'DIFERENTE',
      'CAMINAR', 'CORRER', 'DORMIR', 'JUGAR', 'TOMAR', 'COMPRAR', 'PAGAR', 'SALIR',
      'ENTRAR', 'VENIR', 'TERMINAR', 'EMPEZAR', 'FELIZ', 'TRISTE', 'CANSADO', 'ENFERMO',
      'HOSPITAL', 'MEDICO', 'PERSONA', 'HOMBRE', 'MUJER', 'NIÑO', 'BEBE', 'ESPOSO',
      'NOVIO', 'AGUA', 'PAN', 'CAFE', 'PLATA',
      // tanda 3 (v23)
      'MARZO', 'ENERO', 'FEBRERO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
      'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'MES', 'AÑO', 'ANTES', 'DESPUES',
      'SIEMPRE', 'NUNCA', 'TARDE', 'TEMPRANO', 'HORA', 'OTRA_VEZ', 'TODAVIA', 'A_VECES',
      'MAS_TARDE', 'UN_MOMENTO', 'DESAYUNO', 'ALMUERZO', 'ARROZ', 'CARNE', 'POLLO', 'PESCADO',
      'HUEVO', 'LECHE', 'JUGO', 'GASEOSA', 'SOPA', 'QUESO', 'FRUTA', 'HELADO',
      'RICO', 'DULCE', 'CHOCOLATE', 'EMPANADA', 'NARANJA', 'CARRO', 'BUS', 'MOTO',
      'BICICLETA', 'AVION', 'TAXI', 'BARCO', 'MANEJAR', 'PARAR', 'CALLE', 'BARRIO',
      'TIENDA', 'BANCO', 'PARQUE', 'RESTAURANTE', 'BRAVO', 'ABURRIDO', 'MIEDO', 'TRANQUILO',
      'OCUPADO', 'AMABLE', 'INTELIGENTE', 'FEO', 'BUSCAR', 'ABRIR', 'CERRAR', 'DAR',
      'TRAER', 'HACER', 'VISITAR', 'BAILAR', 'CANTAR', 'PEDIR', 'ENCONTRAR', 'CARO',
      'BARATO', 'GRATIS',
      // tanda 4 (v24)
      'ABUELO', 'PRIMO', 'TIO', 'SOBRINO', 'NIETO', 'CUÑADO', 'SUEGRO', 'PADRES',
      'CASADO', 'SOLTERO', 'CABEZA', 'CARA', 'OJOS', 'NARIZ', 'BOCA', 'OREJA',
      'DIENTES', 'CABELLO', 'CUELLO', 'BRAZO', 'MANOS', 'DEDOS', 'PIERNAS', 'PIES',
      'ESPALDA', 'CORAZON', 'CUERPO', 'GRIPA', 'TOS', 'MEDICAMENTO', 'INYECCION', 'SALUD',
      'SANO', 'SANGRE', 'MAREO', 'HAMBRE', 'SED', 'LLORAR', 'REIR', 'DESCANSAR',
      'DESPERTAR', 'SENTARSE', 'SENTIR', 'NACER', 'MORIR', 'VIDA', 'SOÑAR', 'ANIMAL',
      'PERRO', 'GATO', 'CABALLO', 'VACA', 'CERDO', 'GALLINA', 'PAJARO', 'RATON',
      'CONEJO', 'MARIPOSA', 'LEON', 'TORTUGA', 'CULEBRA', 'BAÑO', 'CAMA', 'COCINA',
      'MESA', 'SILLA', 'PUERTA', 'VENTANA', 'LLAVE', 'LUZ', 'NEVERA', 'VASO',
      'PLATO', 'CUCHARA', 'LAVAR', 'LIMPIAR', 'BARRER', 'ALCOBA', 'SALA', 'APARTAMENTO',
      'ESCALERA', 'ROPA', 'CAMISA', 'PANTALON', 'ZAPATO', 'VESTIRSE', 'RELOJ', 'BOLSO',
      'CACHUCHA', 'CUMPLEAÑOS',
    ],
    secuencia: [
      { glosa: 'HOLA', duracion: 1.2, expresion: 'sonrisa' },
      { glosa: 'GRACIAS', duracion: 1.5, expresion: 'asentir' },
    ],
  },
};

/* ==========================================================================
   2. VISOR 3D
   ========================================================================== */

class AvatarViewer {
  /** @param {HTMLElement} container Elemento donde se inserta el canvas. */
  constructor(container) {
    this.container = container;

    // Estado del modelo. Se llena en loadModel().
    this.model = null; // Raíz del avatar en la escena.
    this.mixer = null; // THREE.AnimationMixer del avatar.
    this.actions = new Map(); // nombre del clip → acciones reutilizables
    this.systems = []; // Sistemas que participan en cada cuadro (ver addSystem).
    this.bones = new Map(); // nombre del hueso → THREE.Bone
    this.morphMeshes = []; // Mallas con blendshapes (expresiones faciales).
    this.currentAction = null;
    this.frameId = undefined; // Id del requestAnimationFrame en curso.

    // Timer reemplaza a THREE.Clock, marcado como obsoleto desde r183.
    // connect() evita un delta enorme al volver de otra pestaña.
    this.timer = new THREE.Timer();
    this.timer.connect(document);

    this.#createScene();
    this.#createCamera();
    this.#createRenderer();
    this.#createLights();
    this.#createControls();
    this.#observeResize();
  }

  /* ----- Configuración de Three.js --------------------------------------- */

  #createScene() {
    this.scene = new THREE.Scene();
    // En la vista para OBS no hay fondo: OBS pone el avatar encima del video.
    this.scene.background = MODO_OVERLAY ? null : new THREE.Color(CONFIG.background);
  }

  #createCamera() {
    // Aspecto, near y far se ajustan después: dependen de la pantalla y del
    // tamaño del modelo (#frameModel).
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.01, 100);
    this.camera.position.set(0, 1.2, 4);
  }

  #createRenderer() {
    // Lanza una excepción si el dispositivo no soporta WebGL; main() la captura
    // y la muestra en pantalla.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: MODO_OVERLAY });
    if (MODO_OVERLAY) this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping; // Respeta mejor el tono de piel.
    this.container.appendChild(this.renderer.domElement);
  }

  #createLights() {
    const { ambient, key, fill, rim } = CONFIG.lights;

    this.scene.add(new THREE.AmbientLight(ambient.color, ambient.intensity));

    for (const { color, intensity, position } of [key, fill, rim]) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(...position);
      this.scene.add(light);
    }
  }

  #createControls() {
    // Incluye mouse y touch: arrastrar rota, rueda o pellizco hace zoom.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; // El giro frena con suavidad.
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.2, 0);
  }

  #observeResize() {
    // ResizeObserver cubre más casos que window 'resize': rotar el móvil,
    // barras del navegador o paneles que cambien el tamaño del contenedor.
    new ResizeObserver(() => this.#resize()).observe(this.container);
    this.#resize();
  }

  #resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return; // Contenedor oculto.

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Se limita a 2x: más resolución gasta GPU sin mejora visible en móviles.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    if (this.encuadreAutomatico) this.encuadrar();
  }

  /* ----- Carga del modelo ------------------------------------------------ */

  /**
   * Carga un .glb/.gltf y lo agrega a la escena.
   *
   * @param {string} url Ruta del modelo.
   * @param {(percent: number|null) => void} [onProgress] Recibe 0–100, o null
   *   si el servidor no informa el tamaño del archivo.
   * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>}
   *   Se resuelve cuando el avatar ya está en escena y el mixer está listo.
   *   Se rechaza si el archivo no existe o no se puede interpretar.
   */
  async loadModel(url, onProgress) {
    const loader = new GLTFLoader();

    const gltf = await loader.loadAsync(url, (event) => {
      onProgress?.(event.lengthComputable ? (event.loaded / event.total) * 100 : null);
    });

    this.model = gltf.scene;
    this.scene.add(this.model);

    this.#prepareMeshes();
    this.#setupAnimation(gltf.animations);
    this.#frameModel();

    return gltf;
  }

  #prepareMeshes() {
    this.model.traverse((node) => {
      if (node.isBone) this.bones.set(node.name, node);

      // Three.js calcula la visibilidad con la pose de reposo. Si un brazo
      // animado sale de esa zona, la malla podría desaparecer al orbitar.
      if (node.isSkinnedMesh) node.frustumCulled = false;

      if (node.morphTargetDictionary) this.morphMeshes.push(node);
    });
  }

  /** Centra el avatar en el origen y encuadra la cámara, sea cual sea su escala. */
  #frameModel() {
    this.model.updateMatrixWorld(true);

    // El segundo argumento mide vértice por vértice. Es más preciso con mallas
    // con esqueleto, porque aplica la pose actual de los huesos.
    const box = new THREE.Box3().setFromObject(this.model, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Pies sobre y = 0, cuerpo centrado en x y z.
    this.model.position.x -= center.x;
    this.model.position.y -= box.min.y;
    this.model.position.z -= center.z;

    // Distancia necesaria para que quepan tanto el alto como el ancho: la
    // calcula encuadrar(). El ancho es el que manda en un móvil en vertical.
    this.alturaModelo = size.y;
    this.encuadrar();
  }

  /**
   * Pone la cámara en el plano medio según el tamaño actual del visor. Se llama
   * al cargar y, con `encuadreAutomatico`, cada vez que el visor cambia de tamaño
   * (por ejemplo al pasar al recuadro del modo noticiero).
   */
  encuadrar() {
    if (!this.alturaModelo) return;
    const size = { y: this.alturaModelo };
    const { targetHeight, visibleHeight, visibleWidth } = CONFIG.framing;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distanceForHeight = (size.y * visibleHeight) / 2 / tanHalfFov;
    const distanceForWidth = (size.y * visibleWidth) / 2 / (tanHalfFov * this.camera.aspect);
    const distance = Math.max(distanceForHeight, distanceForWidth);

    const lookAtY = size.y * targetHeight;

    this.controls.target.set(0, lookAtY, 0);
    this.camera.position.set(0, lookAtY, distance);

    // near y far proporcionales: los modelos pueden venir en metros o en cm.
    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = size.y * 0.25; // Lo bastante cerca para ver las manos.
    this.controls.maxDistance = distance * 4;
    this.controls.update();
  }

  /* ----- Animación ------------------------------------------------------- */

  #setupAnimation(clips) {
    // El mixer se crea aunque el modelo no traiga clips, para poder recibirlos
    // después con addClip().
    this.mixer = new THREE.AnimationMixer(this.model);
    clips.forEach((clip) => this.addClip(clip));
  }

  /**
   * Registra un clip para poder reproducirlo por nombre. Sirve para los clips
   * del modelo y para los que lleguen después por otras vías.
   * Los nombres de sus pistas deben coincidir con los huesos (ver this.bones).
   *
   * @param {THREE.AnimationClip} clip
   */
  addClip(clip) {
    if (!this.mixer) throw new Error('Carga el modelo antes de agregar animaciones.');
    this.actions.set(clip.name, [this.mixer.clipAction(clip)]);
  }

  /** @returns {string[]} Nombres de los clips disponibles. */
  get clipNames() {
    return [...this.actions.keys()];
  }

  /**
   * Reproduce un clip con una transición suave desde el actual.
   *
   * @param {string} name Nombre del clip.
   * @param {object} [options]
   * @param {boolean} [options.loop=true] Repetir de forma indefinida.
   * @param {number} [options.fade] Duración de la transición en segundos.
   * @param {number} [options.timeScale=1] Velocidad (2 = doble de rápido).
   * @param {number} [options.duration] Duración deseada en segundos. Si se
   *   indica, calcula la velocidad y tiene prioridad sobre timeScale.
   * @returns {THREE.AnimationAction|null} La acción, o null si no existe.
   */
  play(name, { loop = true, fade = CONFIG.animation.fadeSeconds, timeScale = 1, duration } = {}) {
    const pool = this.actions.get(name);
    if (!pool) {
      console.warn(`[AvatarViewer] No existe el clip "${name}". Disponibles:`, this.clipNames);
      return null;
    }

    // Pedir el bucle que ya está sonando no debe reiniciarlo.
    const previous = this.currentAction;
    if (loop && previous?.getClip().name === name && previous.loop === THREE.LoopRepeat) {
      return previous;
    }

    const next = this.#freeAction(pool);
    const speed = duration ? next.getClip().duration / duration : timeScale;

    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop; // Sin bucle, conserva la última pose.
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1);
    next.play();

    this.#fadeOutActive(next, fade);
    next.fadeIn(fade);

    this.currentAction = next;
    return next;
  }

  /** Detiene el clip actual con una transición a la pose de reposo del modelo. */
  stop(fade = CONFIG.animation.fadeSeconds) {
    this.#fadeOutActive(null, fade);
    this.currentAction = null;
  }

  /**
   * Devuelve una acción que no esté en uso. Una acción no puede desvanecerse
   * hacia sí misma, así que HOLA + HOLA necesita dos acciones del mismo clip.
   * Para obtener la segunda se clona el clip: el mixer guarda una por clip.
   */
  #freeAction(pool) {
    const free = pool.find((action) => !action.isScheduled() || !action.enabled);
    if (free) return free;

    const action = this.mixer.clipAction(pool[0].getClip().clone());
    pool.push(action);
    return action;
  }

  /**
   * Desvanece todo lo que esté sonando, en la misma duración de la acción nueva.
   * Es un cross-fade que también funciona si llega una seña en plena transición.
   *
   * Si la suma de pesos no se mantiene en 1, el mixer completa lo que falta con
   * la pose de reposo del modelo y el brazo se desvía. Por eso:
   * - no se atiende solo a la acción anterior: puede haber otras a medio apagar;
   * - cada una parte de su peso visible, porque fadeOut() parte del peso base y
   *   una acción con 0,5 saltaría a 1.
   */
  #fadeOutActive(keep, fade) {
    for (const action of [...this.actions.values()].flat()) {
      if (action === keep || !action.isScheduled() || !action.enabled) continue;
      action.setEffectiveWeight(action.getEffectiveWeight());
      action.fadeOut(fade);
    }
  }

  /** @returns {string[]} Nombres de los blendshapes faciales del modelo. */
  get expressionNames() {
    return Object.keys(this.morphMeshes[0]?.morphTargetDictionary ?? {});
  }

  /* ----- Bucle de renderizado -------------------------------------------- */

  /**
   * Registra un sistema en el bucle. Puede definir estos métodos opcionales:
   * - beforeMixer(delta): decide qué debe sonar en este cuadro.
   * - afterMixer(delta): ajusta lo que el mixer acaba de calcular.
   * - afterRender(): limpia cambios que solo debían durar este cuadro.
   */
  addSystem(system) {
    this.systems.push(system);
  }

  start() {
    if (this.frameId !== undefined) return; // Evita dos bucles simultáneos.
    this.frameId = requestAnimationFrame(this.#tick);
  }

  // Función flecha para conservar `this` al pasarla a requestAnimationFrame.
  #tick = (timestamp) => {
    this.frameId = requestAnimationFrame(this.#tick);

    this.timer.update(timestamp);
    const delta = THREE.MathUtils.clamp(this.timer.getDelta(), 0, CONFIG.animation.maxDelta);

    for (const system of this.systems) system.beforeMixer?.(delta);

    // Avanza los huesos según el tiempo real transcurrido, de modo que la seña
    // dura lo mismo en una pantalla de 60 Hz que en una de 144 Hz.
    this.mixer?.update(delta);

    for (const system of this.systems) system.afterMixer?.(delta);

    this.controls.update(); // Necesario cada cuadro por enableDamping.
    this.renderer.render(this.scene, this.camera);

    for (const system of this.systems) system.afterRender?.();
  };
}

/* ==========================================================================
   3. INTERFAZ Y ARRANQUE
   ========================================================================== */

const ui = {
  viewer: document.getElementById('viewer'),
  loader: document.getElementById('loader'),
  status: document.getElementById('status'),
  progressBar: document.getElementById('progress-bar'),
  panel: document.getElementById('dev-panel'),
  glossSelect: document.getElementById('gloss-select'),
  glosaLsc: document.getElementById('glosa-lsc'),
  expressionSelect: document.getElementById('expression-select'),
  phraseInput: document.getElementById('phrase-input'),
  phraseButton: document.getElementById('phrase-button'),
  micButton: document.getElementById('mic-button'),
  liveButton: document.getElementById('live-button'),
  newsButton: document.getElementById('news-button'),
  noticiero: document.getElementById('noticiero'),
  noticieroVideo: document.getElementById('noticiero-video'),
  noticieroIframe: document.getElementById('noticiero-iframe'),
  noticieroArchivo: document.getElementById('noticiero-archivo'),
  noticieroUrl: document.getElementById('noticiero-url'),
  noticieroCargar: document.getElementById('noticiero-cargar'),
  noticieroVivo: document.getElementById('noticiero-vivo'),
  oidoSelects: [...document.querySelectorAll('.oido-select')],
  oidoEstado: document.getElementById('oido-estado'),
  noticieroSalir: document.getElementById('noticiero-salir'),
  subtitulo: document.getElementById('subtitulo-vivo'),
  obs: document.getElementById('obs'),
  obsFuente: document.getElementById('obs-fuente'),
  obsSubtitulos: document.getElementById('obs-subtitulos'),
  obsUrl: document.getElementById('obs-url'),
  obsCopiar: document.getElementById('obs-copiar'),
  obsAbrir: document.getElementById('obs-abrir'),
  metricas: document.getElementById('vivo-metricas'),
  avatarSelect: document.getElementById('avatar-select'),
  styleSelect: document.getElementById('style-select'),
  indicator: document.getElementById('sign-indicator'),
  indicatorName: document.getElementById('sign-name'),
  indicatorDetail: document.getElementById('sign-detail'),
  indicatorBar: document.getElementById('sign-progress-bar'),
};

function showProgress(percent) {
  if (percent === null) {
    ui.status.textContent = 'Cargando avatar…';
    return;
  }
  ui.status.textContent = `Cargando avatar… ${Math.round(percent)}%`;
  ui.progressBar.style.width = `${percent}%`;
}

function showError(message) {
  ui.status.textContent = message;
  ui.loader.classList.add('is-error');
  ui.loader.hidden = false;
}

function showSignStatus(name, detail = '') {
  ui.indicatorName.textContent = name;
  ui.indicatorDetail.textContent = detail;
}

function showIdle() {
  showSignStatus('Pose neutral', 'En espera');
  ui.indicatorBar.style.transform = 'scaleX(0)';
}

/**
 * Reproduce la secuencia que arma el backend Java: { secuencia, noEncontradas }.
 * La usan los dos caminos: glosas directas (Módulo 4) y frase en español (Módulo 5).
 * Las palabras que no están en el diccionario llegan deletreadas, letra por letra.
 */
function reproducirRespuestaJava(sequencer, datos, entrada) {
  if (datos.noEncontradas?.length > 0) {
    console.warn('[Backend] Sin letra en el abecedario:', datos.noEncontradas.join(', '));
  }

  if (!datos.secuencia?.length) {
    showSignStatus('Sin señas', `Nada que reproducir para: ${entrada}`);
    return;
  }

  // Sin await: el botón queda libre para lanzar otra traducción, que
  // reemplaza a la actual con una transición suave.
  sequencer.reproducirSecuenciaGlosas(datos.secuencia.map((paso) => ({
    glosa: paso.glosa,
    archivo: paso.archivo,
    duracion: paso.duracion,
    expresion: paso.expresion,
    palabraOrigen: paso.palabraOrigen,
  })));
}

/** Nombre corto de cada tipo de oración que devuelve la gramática del cerebro. */
const TIPOS_ORACION = {
  afirmativa: 'afirmativa',
  negativa: 'negación · cabeza que niega',
  pregunta_abierta: 'pregunta abierta · cejas',
  pregunta_si_no: 'pregunta sí/no · cejas arriba',
  emocion: 'emoción',
  exclamativa: 'exclamación',
};

/**
 * Muestra la glosa LSC bajo la frase: una línea por oración, en orden de señas,
 * con las palabras que se deletrean en tono más suave y el tipo de oración.
 */
function mostrarGlosaLsc(datos) {
  if (!ui.glosaLsc) return;
  const oraciones = datos.oraciones ?? [];
  ui.glosaLsc.replaceChildren(...oraciones.map((o) => {
    const linea = document.createElement('span');
    linea.className = 'oracion';
    o.glosas.forEach((glosa, i) => {
      const g = document.createElement('span');
      if (o.con_sena && !o.con_sena[i]) {
        g.className = 'deletreo';
        g.title = 'Sin seña: se deletrea';
      }
      g.textContent = (i ? ' ' : '') + glosa;
      linea.append(g);
    });
    if (o.tipo === 'pregunta_abierta' || o.tipo === 'pregunta_si_no') linea.append('(?)');
    const tipo = document.createElement('span');
    tipo.className = 'tipo';
    tipo.textContent = TIPOS_ORACION[o.tipo] ?? o.tipo;
    linea.append(tipo);
    return linea;
  }));
  ui.glosaLsc.hidden = oraciones.length === 0;
}

/**
 * Detecta servicios viejos que siguen abiertos: un cerebro sin gramática (no devuelve
 * 'oraciones') o un backend con el diccionario anterior (deletrea glosas que sí tienen
 * seña). En ese caso lo dice bajo la frase: la solución es reiniciar iniciar.sh.
 */
function revisarVersiones(datos) {
  if (datos.cerebro === 'local') return; // Sin servidores: no hay versiones que comparar.
  let aviso = '';
  if (!datos.oraciones) {
    aviso = 'El cerebro (puerto 8001) es una versión anterior sin gramática LSC. Cierra y vuelve a ejecutar iniciar.sh.';
  } else {
    const conSena = datos.oraciones.flatMap((o) => o.glosas.filter((_, i) => o.con_sena?.[i]));
    const enJava = new Set((datos.animacion?.secuencia ?? []).filter((p) => p.tipo === 'SENA').map((p) => p.glosa));
    const faltan = [...new Set(conSena.filter((g) => !enJava.has(g)))];
    if (faltan.length) {
      aviso = `El backend (puerto 8080) tiene el diccionario anterior y deletrea ${faltan.join(', ')}. `
        + 'Cierra y vuelve a ejecutar iniciar.sh.';
    }
  }
  if (!aviso || !ui.glosaLsc) return;
  console.warn('[Avatar Señas]', aviso);
  const linea = document.createElement('span');
  linea.className = 'oracion aviso';
  linea.textContent = '⚠ ' + aviso;
  ui.glosaLsc.append(linea);
  ui.glosaLsc.hidden = false;
}

/* Cerebro local (v56): se descarga al abrir la página, en paralelo con el avatar. */
let cerebroLocal = null;
const cargaCerebroLocal = CONFIG.cerebro.modo === 'servidor'
  ? Promise.resolve(null)
  : CerebroLocal.cargar(CONFIG.cerebro.local)
    .then((c) => {
      cerebroLocal = c;
      console.info(`[Cerebro] Local listo (versión ${c.version}): ${c.senas.size} señas`);
      return c;
    })
    .catch((error) => {
      console.warn('[Cerebro] No se pudo cargar el cerebro local; se usará el servidor:', error);
      return null;
    });

/** Indicador para cada error del cerebro lingüístico: [título, detalle]. */
const ERRORES_CEREBRO = {
  422: ['Frase sin palabras', 'Escribe al menos una palabra'],
  502: ['Error en el backend', 'Java respondió con un error; revisa su terminal'],
  503: ['Backend no disponible', 'Arranca el backend en el puerto 8080'],
};

/**
 * Módulo 5: envía la frase en español al cerebro lingüístico (Python). El
 * servicio la convierte en glosas, pide la secuencia a Java y devuelve las dos
 * cosas. Las glosas que entendió quedan en la consola.
 */
/** Error de traducción con un título y un detalle cortos para el indicador. */
class ErrorTraduccion extends Error {
  constructor(titulo, detalle) {
    super(`${titulo}: ${detalle}`);
    this.titulo = titulo;
    this.detalle = detalle;
  }
}

/**
 * Pide al cerebro lingüístico la traducción de una frase. Devuelve su respuesta
 * ({ glosas, glosa_lsc, oraciones, animacion }) o lanza un ErrorTraduccion.
 * La usan la caja "Español", el dictado y el modo en vivo.
 */
async function pedirTraduccion(texto) {
  if (CONFIG.cerebro.modo !== 'servidor') {
    const local = cerebroLocal ?? await cargaCerebroLocal;
    if (local) {
      try {
        return local.traducir(texto);
      } catch (error) {
        if (error.estado === 422) throw new ErrorTraduccion(...ERRORES_CEREBRO[422]);
        throw error;
      }
    }
    if (CONFIG.cerebro.modo === 'local') {
      throw new ErrorTraduccion('Sin cerebro local', 'No se pudo cargar cerebro-datos.json');
    }
  }

  let respuesta;
  try {
    respuesta = await fetch(CONFIG.cerebro.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto_espanol: texto }),
    });
  } catch (error) {
    // fetch solo falla así cuando no hay conexión: el servicio Python está apagado.
    console.error('[Cerebro] Sin conexión con el servicio Python:', error);
    throw new ErrorTraduccion('Cerebro no disponible', 'Arranca el servicio Python en el puerto 8001');
  }

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.animacion) {
    // El detalle completo (por ejemplo, la URL de Java) queda en la consola.
    console.error(`[Cerebro] Respondió ${respuesta.status}:`, datos?.detail ?? datos);
    const [titulo, detalle] = ERRORES_CEREBRO[respuesta.status]
      ?? [respuesta.ok ? 'Respuesta no válida' : `Error ${respuesta.status}`, 'Revisa la consola'];
    throw new ErrorTraduccion(titulo, detalle);
  }

  console.info('[Cerebro] Respuesta:', datos);
  return datos;
}

async function traducirFrase(sequencer) {
  if (ui.phraseButton.disabled) return; // Ya hay una petición en curso.

  const texto = ui.phraseInput.value.trim();
  if (!texto) {
    showSignStatus('Escribe una frase', 'Ejemplo: Hola, ¿cómo estás?');
    ui.phraseInput.focus();
    return;
  }

  ui.phraseButton.disabled = true;
  showSignStatus('Traduciendo…', 'Cerebro lingüístico');

  try {
    const datos = await pedirTraduccion(texto);
    mostrarGlosaLsc(datos);
    revisarVersiones(datos);
    reproducirRespuestaJava(sequencer, datos.animacion, datos.glosa_lsc ?? datos.glosas.join(' '));
  } catch (error) {
    if (!(error instanceof ErrorTraduccion)) throw error;
    showSignStatus(error.titulo, error.detalle);
  } finally {
    ui.phraseButton.disabled = false;
  }
}

/**
 * Dictado por voz: usa el reconocimiento de voz del navegador (Web Speech API)
 * para escribir la frase en la caja "Español" y traducirla al terminar de hablar.
 * Chrome y Edge lo traen; Firefox no, y ahí el botón queda oculto. En Chrome el
 * audio se envía a los servidores de Google para reconocerlo: necesita internet.
 */
function setupDictado(sequencer) {
  const Reconocimiento = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Reconocimiento) {
    console.info('[Voz] Este navegador no tiene reconocimiento de voz; se oculta el micrófono.');
    return;
  }

  const voz = new Reconocimiento();
  voz.lang = 'es-CO';
  voz.interimResults = true; // Muestra el texto mientras la persona habla.
  voz.continuous = false; // Se detiene sola al terminar la frase.

  let escuchando = false;
  let fraseFinal = '';

  const marcar = (activo) => {
    escuchando = activo;
    ui.micButton.setAttribute('aria-pressed', String(activo));
    ui.micButton.textContent = activo ? '⏹ Detener' : '🎤 Hablar';
  };

  voz.addEventListener('start', () => {
    fraseFinal = '';
    marcar(true);
    showSignStatus('Escuchando…', 'Di la frase en español');
  });
  voz.addEventListener('result', (event) => {
    const texto = Array.from(event.results, (r) => r[0].transcript).join(' ').trim();
    ui.phraseInput.value = texto;
    if (event.results[event.results.length - 1].isFinal) fraseFinal = texto;
  });
  voz.addEventListener('error', (event) => {
    console.error('[Voz] Error de reconocimiento:', event.error);
    const mensajes = {
      'not-allowed': ['Micrófono bloqueado', 'Permite el micrófono para esta página'],
      'service-not-allowed': ['Micrófono bloqueado', 'Permite el micrófono para esta página'],
      'no-speech': ['No se oyó nada', 'Intenta de nuevo, más cerca del micrófono'],
      'audio-capture': ['Sin micrófono', 'Conecta un micrófono e intenta de nuevo'],
      network: ['Sin conexión', 'El dictado por voz necesita internet'],
    };
    const [titulo, detalle] = mensajes[event.error] ?? ['No se pudo dictar', 'Revisa la consola'];
    showSignStatus(titulo, detalle);
  });
  voz.addEventListener('end', () => {
    marcar(false);
    if (fraseFinal) traducirFrase(sequencer);
  });

  ui.micButton.hidden = false;
  ui.micButton.addEventListener('click', () => {
    if (escuchando) voz.stop();
    else voz.start();
  });
}

/**
 * Modo en vivo y modo noticiero (v51).
 *
 * - "🔴 En vivo": escucha sin parar y va señando frase por frase (InterpreteVivo).
 * - "📺 Noticiero": un video a pantalla completa y el avatar en un recuadro en la
 *   esquina, como el intérprete de un noticiero. El video puede ser un archivo del
 *   computador, un enlace a un .mp4 o un video de YouTube.
 *
 * Qué oye (v52), en el selector "Oído":
 * - Google: el reconocimiento de voz de Chrome/Edge. Necesita internet y solo oye
 *   el micrófono (o el "Monitor" de la salida, elegido como entrada en pavucontrol).
 * - Whisper: oido_whisper.py en este computador (puerto 8002). Sin internet, y oye
 *   el micrófono, el video cargado en el noticiero o una pestaña compartida
 *   (YouTube va en un iframe, así que para YouTube se comparte la pestaña).
 */
function setupVivo(viewer, sequencer) {
  const vivo = new InterpreteVivo({ sequencer, traducir: pedirTraduccion });
  window.interpreteVivo = vivo;

  const botones = [ui.liveButton, ui.noticieroVivo].filter(Boolean);
  const marcar = (activo) => {
    botones.forEach((b) => {
      b.setAttribute('aria-pressed', String(activo));
      b.textContent = activo ? '⏹ Detener en vivo' : '🔴 En vivo';
    });
    ui.micButton.disabled = activo; // El dictado y el modo en vivo comparten el micrófono.
    ui.metricas.hidden = !activo && sequencer.pendienteSegundos === 0;
    if (activo) showSignStatus('En vivo', 'Escuchando…');
  };
  /* ----- Oído: motor y fuente ----------------------------------------------- */
  const OIDOS = {
    'navegador': { motor: 'navegador', fuente: 'microfono' },
    'whisper-microfono': { motor: 'whisper', fuente: 'microfono' },
    'whisper-video': { motor: 'whisper', fuente: 'video' },
    'whisper-pestana': { motor: 'whisper', fuente: 'pestana' },
    'whisper-sistema': { motor: 'whisper', fuente: 'sistema' },
  };
  // Con "audio del computador" el oído graba esta fuente (la misma que la vista para OBS).
  const leerFuenteSistema = () => {
    try { return localStorage.getItem('lsc.fuenteSistema') || FUENTE_TODO; } catch { return FUENTE_TODO; }
  };
  vivo.fuenteSistema = MODO_OVERLAY ? (PARAMS.get('fuente') || FUENTE_TODO) : leerFuenteSistema();
  const leerOido = () => {
    try { return localStorage.getItem('lsc.oido'); } catch { return null; }
  };
  let oido = MODO_OVERLAY ? 'whisper-sistema' : (OIDOS[leerOido()] ? leerOido() : 'navegador');
  const estadoOido = (texto, mal = false) => {
    if (!ui.oidoEstado) return;
    ui.oidoEstado.textContent = texto;
    ui.oidoEstado.hidden = !texto;
    ui.oidoEstado.classList.toggle('mal', mal);
  };
  const revisarWhisper = async () => {
    if (OIDOS[oido].motor !== 'whisper') { estadoOido(''); return; }
    estadoOido('Buscando Whisper…');
    const salud = await vivo.saludWhisper();
    if (oido !== elegido) return; // Cambió mientras tanto.
    if (!salud) estadoOido('Whisper no responde: ¿se abrió con iniciar.sh?', true);
    else if (salud.error) estadoOido(`Whisper falló: ${salud.error}`, true);
    else if (!salud.listo) estadoOido(`Whisper cargando el modelo ${salud.modelo}…`);
    else estadoOido(`Whisper listo (${salud.modelo})`);
  };
  let elegido = oido;
  const aplicarOido = (valor) => {
    oido = elegido = valor;
    Object.assign(vivo, OIDOS[valor]);
    ui.oidoSelects.forEach((s) => { s.value = valor; });
    if (!MODO_OVERLAY) {
      try { localStorage.setItem('lsc.oido', valor); } catch { /* sin almacenamiento */ }
    }
    revisarWhisper();
  };
  ui.oidoSelects.forEach((s) => {
    s.hidden = false;
    s.addEventListener('change', () => {
      if (vivo.escuchando) vivo.detener(); // Se cambia de oído: se vuelve a dar "En vivo".
      aplicarOido(s.value);
    });
  });
  aplicarOido(oido);

  const alternar = () => {
    if (vivo.escuchando) { vivo.detener(); return; }
    if (vivo.motor === 'whisper' && vivo.fuente === 'video') {
      if (!ui.noticieroIframe.hidden && ui.noticieroIframe.src) {
        showSignStatus('YouTube no se puede oír así', 'Elige "Whisper · una pestaña" y comparte esta pestaña con su audio');
        return;
      }
      if (!ui.noticieroVideo.currentSrc) {
        showSignStatus('Falta el video', 'Abre 📺 Noticiero y carga un archivo o un enlace .mp4');
        return;
      }
      vivo.video = ui.noticieroVideo;
    }
    vivo.iniciar();
  };
  botones.forEach((b) => { b.hidden = false; b.addEventListener('click', alternar); });

  vivo.addEventListener('estado', ({ detail }) => {
    marcar(detail.escuchando);
    if (detail.modelo) estadoOido(`Whisper escuchando (${detail.modelo})`);
  });

  // Subtítulo: lo que se va oyendo, y la última frase cerrada mientras no haya otra.
  let ultimaFrase = '';
  const subtitular = (texto) => {
    ui.subtitulo.textContent = texto;
    ui.subtitulo.hidden = !texto;
  };
  vivo.addEventListener('parcial', ({ detail }) => subtitular(detail.texto || ultimaFrase));
  vivo.addEventListener('frase', ({ detail }) => {
    ultimaFrase = detail.texto;
    subtitular(ultimaFrase);
    if (!document.body.classList.contains('modo-noticiero')) ui.phraseInput.value = detail.texto;
  });
  vivo.addEventListener('glosas', ({ detail }) => {
    mostrarGlosaLsc(detail.datos);
  });
  vivo.addEventListener('error', ({ detail }) => showSignStatus(detail.titulo, detail.detalle));
  vivo.addEventListener('metricas', ({ detail }) => {
    const { retraso, velocidad, latencia, frases, omitidas, sinDeletrear } = detail;
    ui.metricas.hidden = !vivo.escuchando && retraso === 0;
    const partes = [
      `Atraso ${retraso.toFixed(1)} s`,
      `Velocidad ${velocidad.toFixed(2)}×`,
      latencia == null ? null : `Latencia ${latencia.toFixed(1)} s`,
      `${frases} frases`,
      omitidas ? `${omitidas} resumidas` : null,
      sinDeletrear ? `${sinDeletrear} sin deletrear` : null,
    ];
    ui.metricas.textContent = partes.filter(Boolean).join(' · ');
    ui.metricas.classList.toggle('alto', retraso > 8);
  });

  /* ----- Modo noticiero ----------------------------------------------------- */

  const idYoutube = (url) => {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  };
  let urlLocal = null;
  const mostrarVideo = (src, esYoutube) => {
    ui.noticieroVideo.pause();
    ui.noticieroVideo.hidden = esYoutube;
    ui.noticieroIframe.hidden = !esYoutube;
    if (esYoutube) {
      ui.noticieroVideo.removeAttribute('src');
      ui.noticieroIframe.src = src;
    } else {
      ui.noticieroIframe.removeAttribute('src');
      // Para que Whisper pueda oír un .mp4 de otro sitio, el sitio debe permitirlo (CORS).
      if (/^https?:/.test(src)) ui.noticieroVideo.crossOrigin = 'anonymous';
      else ui.noticieroVideo.removeAttribute('crossorigin');
      ui.noticieroVideo.src = src;
      ui.noticieroVideo.play().catch(() => { /* el usuario le da play */ });
    }
  };
  ui.noticieroArchivo.addEventListener('change', () => {
    const archivo = ui.noticieroArchivo.files?.[0];
    if (!archivo) return;
    if (urlLocal) URL.revokeObjectURL(urlLocal);
    urlLocal = URL.createObjectURL(archivo);
    mostrarVideo(urlLocal, false);
  });
  const cargarUrl = () => {
    const url = ui.noticieroUrl.value.trim();
    if (!url) return;
    const id = idYoutube(url);
    if (id) mostrarVideo(`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`, true);
    else mostrarVideo(url, false);
  };
  ui.noticieroCargar.addEventListener('click', cargarUrl);
  ui.noticieroUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') cargarUrl(); });

  const modoNoticiero = (activo) => {
    document.body.classList.toggle('modo-noticiero', activo);
    ui.noticiero.hidden = !activo;
    ui.newsButton.setAttribute('aria-pressed', String(activo));
    // El visor cambia de tamaño: se reencuadra con cada cambio mientras dura el
    // paso al recuadro (o de vuelta a pantalla completa) y, al salir, se deja de
    // hacer para no deshacer el zoom que ponga la persona.
    viewer.encuadreAutomatico = true;
    requestAnimationFrame(() => viewer.encuadrar());
    if (!activo) {
      setTimeout(() => { viewer.encuadrar(); viewer.encuadreAutomatico = false; }, 400);
      ui.noticieroVideo.pause();
      ui.noticieroIframe.removeAttribute('src');
    }
  };
  ui.newsButton.hidden = false;
  ui.newsButton.addEventListener('click', () => modoNoticiero(!document.body.classList.contains('modo-noticiero')));
  ui.noticieroSalir.addEventListener('click', () => modoNoticiero(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('modo-noticiero')) modoNoticiero(false);
  });
  if (new URLSearchParams(location.search).has('noticiero')) modoNoticiero(true);

  setupObs(vivo);
  if (MODO_OVERLAY) setupOverlay(viewer, vivo);
  return vivo;
}

/* ----- v55 · Transmisión con OBS ------------------------------------------- */

/** Dirección de la vista para OBS con las opciones elegidas en el panel. */
function urlOverlay({ fuente, subtitulos }) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('overlay', '');
  url.searchParams.set('avatar', CONFIG.avatar);
  if (fuente && fuente !== FUENTE_TODO) url.searchParams.set('fuente', fuente);
  if (subtitulos) url.searchParams.set('subtitulos', '1');
  return url.href.replace('overlay=&', 'overlay&').replace(/overlay=$/, 'overlay');
}

/** Sección "Usar en OBS" del panel: elegir qué oye y copiar el enlace. */
function setupObs(vivo) {
  if (!ui.obs || MODO_OVERLAY) return;
  const actualizar = () => {
    ui.obsUrl.value = urlOverlay({ fuente: ui.obsFuente.value, subtitulos: ui.obsSubtitulos.checked });
  };
  const cargarFuentes = async () => {
    const lista = await vivo.fuentesWhisper();
    const elegida = vivo.fuenteSistema || FUENTE_TODO;
    if (!lista) {
      ui.obsFuente.replaceChildren(new Option('Todo lo que suena en el computador', FUENTE_TODO));
      ui.obsFuente.title = 'Whisper no responde: se muestran solo las opciones básicas';
    } else {
      ui.obsFuente.replaceChildren(...lista.map((f) => {
        const tipo = f.nombre === FUENTE_TODO ? '' : (f.tipo === 'monitor' ? 'Salida: ' : 'Entrada: ');
        return new Option(tipo + f.descripcion, f.nombre);
      }));
    }
    if ([...ui.obsFuente.options].some((o) => o.value === elegida)) ui.obsFuente.value = elegida;
    actualizar();
  };
  ui.obs.addEventListener('toggle', () => { if (ui.obs.open) cargarFuentes(); });
  ui.obsFuente.addEventListener('change', () => {
    vivo.fuenteSistema = ui.obsFuente.value;
    try { localStorage.setItem('lsc.fuenteSistema', ui.obsFuente.value); } catch { /* sin almacenamiento */ }
    actualizar();
  });
  ui.obsSubtitulos.addEventListener('change', actualizar);
  ui.obsCopiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.obsUrl.value);
      ui.obsCopiar.textContent = 'Copiado';
    } catch {
      ui.obsUrl.select(); // Sin permiso de portapapeles: queda seleccionado para Ctrl+C.
      ui.obsCopiar.textContent = 'Usa Ctrl+C';
    }
    setTimeout(() => { ui.obsCopiar.textContent = 'Copiar enlace'; }, 2000);
  });
  ui.obsAbrir.addEventListener('click', () => window.open(ui.obsUrl.value, 'avatar-obs', 'width=540,height=600'));
  ui.obsFuente.replaceChildren(new Option('Todo lo que suena en el computador', FUENTE_TODO));
  actualizar();
}

/** Vista para OBS: escucha sola y se reconecta si el oído se reinicia. */
function setupOverlay(viewer, vivo) {
  const subtitulos = PARAMS.get('subtitulos') === '1';
  const metricas = PARAMS.get('metricas') === '1';
  document.body.classList.toggle('overlay-subtitulos', subtitulos);
  document.body.classList.toggle('overlay-metricas', metricas);
  viewer.encuadreAutomatico = true; // OBS puede cambiar el tamaño de la fuente en cualquier momento.

  // Los errores se ven unos segundos en el subtítulo (si no, en OBS no hay dónde verlos).
  let ocultar;
  vivo.addEventListener('error', ({ detail }) => {
    ui.subtitulo.textContent = `⚠ ${detail.titulo}: ${detail.detalle}`;
    ui.subtitulo.hidden = false;
    ui.subtitulo.classList.add('error');
    clearTimeout(ocultar);
    ocultar = setTimeout(() => {
      ui.subtitulo.classList.remove('error');
      if (!subtitulos) ui.subtitulo.hidden = true;
    }, 8000);
  });
  vivo.addEventListener('parcial', () => ui.subtitulo.classList.remove('error'));

  // Arranca y, si se cae (oído reiniciado, fuente cerrada), lo vuelve a intentar.
  const vigilar = () => {
    if (!vivo.escuchando) vivo.iniciar();
  };
  vigilar();
  setInterval(vigilar, 5000);
}

function setupDevUi(viewer, sequencer) {
  // La primera opción no es una glosa: así elegir cualquiera dispara "change".
  const elegir = new Option('Elegir…', '', true, true);
  elegir.disabled = true;
  ui.glossSelect.replaceChildren(elegir, ...CONFIG.devUi.glosas.map((glosa) => new Option(glosa, glosa)));
  ui.expressionSelect.replaceChildren(...Object.keys(EXPRESIONES).map((name) => new Option(name, name)));

  // Sin botones: al cambiar la glosa o la expresión, el avatar reproduce la
  // glosa elegida con esa expresión.
  const reproducirSeleccion = () => {
    if (!ui.glossSelect.value) return;
    // Los archivos no llevan tildes ni Ñ (MAÑANA -> MANANA.glb), igual que en el backend
    const glosa = ui.glossSelect.value;
    const archivo = `animations/${glosa.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.glb`;
    sequencer.reproducirGlosa(glosa, { archivo, expresion: ui.expressionSelect.value });
  };
  ui.glossSelect.addEventListener('change', reproducirSeleccion);
  ui.expressionSelect.addEventListener('change', reproducirSeleccion);
  // Cambiar de avatar recarga la página: así no quedan en memoria el modelo y los
  // clips del avatar anterior, que tienen otro cuerpo.
  ui.avatarSelect.replaceChildren(...Object.entries(AVATARES).map(([id, a]) => new Option(a.nombre, id)));
  ui.avatarSelect.value = CONFIG.avatar;
  ui.avatarSelect.addEventListener('change', () => {
    try { localStorage.setItem('avatar', ui.avatarSelect.value); } catch { /* sin almacenamiento: va en la URL */ }
    const url = new URL(location.href);
    url.searchParams.set('avatar', ui.avatarSelect.value);
    location.replace(url);
  });
  ui.styleSelect.value = CONFIG.estilo;
  ui.styleSelect.addEventListener('change', () => setEstilo(viewer, ui.styleSelect.value));
  ui.phraseButton.addEventListener('click', () => traducirFrase(sequencer));
  setupDictado(sequencer);
  setupVivo(viewer, sequencer);
  ui.phraseInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') traducirFrase(sequencer);
  });

  sequencer.addEventListener('cargando', () => showSignStatus('Cargando…'));
  sequencer.addEventListener('sena', ({ detail }) => {
    const { glosa, indice, total, expresion, palabraOrigen } = detail;
    const contexto = palabraOrigen ? `Deletreo de ${palabraOrigen} · ` : '';
    showSignStatus(glosa, `${contexto}Seña ${indice + 1} de ${total} · ${expresion}`);
  });
  sequencer.addEventListener('fin', ({ detail }) => {
    showIdle();
    if (detail.omitidas.length > 0) {
      const glosas = detail.omitidas.map((aviso) => aviso.glosa).join(', ');
      ui.indicatorDetail.textContent = `Sin animación: ${glosas}`;
    }
  });

  // La barra cambia en cada cuadro. Por eso se actualiza dentro del bucle y no
  // con eventos, que solo avisan cuando empieza una seña.
  viewer.addSystem({
    afterMixer() {
      if (sequencer.estado.activo) {
        ui.indicatorBar.style.transform = `scaleX(${sequencer.estado.progreso})`;
      }
    },
  });

  showIdle();
  ui.indicator.hidden = false;
  ui.panel.hidden = false;
}

console.info('[Avatar Señas] app.js versión 51 (1178 señas, modo en vivo y noticiero) cargada');

async function main() {
  let viewer;

  try {
    viewer = new AvatarViewer(ui.viewer);
  } catch (error) {
    console.error('[AvatarViewer] No se pudo iniciar WebGL:', error);
    showError('Este navegador o dispositivo no pudo iniciar WebGL, necesario para mostrar el avatar.');
    return;
  }

  // Disponible en la consola del navegador y para los próximos módulos.
  window.avatarViewer = viewer;

  // El bucle arranca antes de cargar: la escena ya responde mientras tanto.
  viewer.start();

  try {
    const gltf = await viewer.loadModel(CONFIG.modelUrl, showProgress);

    console.info('[AvatarViewer] Modelo cargado en escena:', {
      huesos: viewer.bones.size,
      animaciones: viewer.clipNames,
      blendshapes: viewer.expressionNames,
      generador: gltf.asset?.generator,
    });

    const hueso = (re) => [...viewer.bones.values()].find((bone) => re.test(bone.name));
    const head = hueso(/head$/i);
    // v61: huesos para la postura (inclinar el tronco en las preguntas de sí o no, etc.).
    const huesos = { columna0: hueso(/spine$/i), columna1: hueso(/spine1$/i), columna2: hueso(/spine2$/i), cuello: hueso(/neck$/i) };
    const facial = new ControlFacial({ mallas: viewer.morphMeshes, cabeza: head, modelo: viewer.model, huesos });
    const sequencer = new SecuenciadorSenas(viewer, facial, { carpeta: CONFIG.animaciones });

    // El orden importa: la cola decide antes del mixer y el rostro actúa después.
    viewer.addSystem(sequencer);
    // Rehace la mano durante los cross-fades para que no gire de forma imposible (v47).
    const transicion = new TransicionNatural(viewer);
    viewer.addSystem(transicion);
    window.transicionNatural = transicion;
    viewer.addSystem(facial);

    setEstilo(viewer, CONFIG.estilo);
    if (MODO_OVERLAY) viewer.scene.background = null; // El estilo no debe poner fondo.
    setupDevUi(viewer, sequencer);

    // Disponibles en la consola del navegador y para los próximos módulos.
    window.secuenciador = sequencer;
    window.controlFacial = facial;
    window.reproducirSecuenciaGlosas = (lista) => sequencer.reproducirSecuenciaGlosas(lista);

    ui.loader.hidden = true;
    sequencer.resetear();
  } catch (error) {
    console.error('[AvatarViewer] Error al cargar el modelo:', error);
    showError(`No se pudo cargar ${CONFIG.modelUrl}. Revisa que el archivo exista en esa ruta y sea un .glb válido.`);
  }
}

main();

