/**
 * Avatar Señas · Service worker (v56)
 *
 * Hace que la página se pueda instalar como app y abrir sin internet:
 * - Página, estilos, código y cerebro-datos.json: primero la red (así un cambio
 *   se ve enseguida) y, si no hay conexión, la copia guardada.
 * - Three.js (CDN), modelos y clips .glb: primero la copia guardada, porque no
 *   cambian sin cambiar su ?v=. Se guardan la primera vez que se usan.
 * - Whisper, el cerebro y el backend (puertos 8001, 8002, 8080) nunca se guardan.
 */
const VERSION = 'avatar-senas-v57'; // cambiarla borra las copias viejas (señas incluidas)
const NUCLEO = `${VERSION}-nucleo`;
const RECURSOS = `${VERSION}-recursos`;

const INICIALES = [
  './',
  './index.html',
  './style.css?v=55c',
  './app.js?v=57',
  './cerebro-local.js?v=56',
  './cerebro-datos.json',
  './manifest.webmanifest',
  './iconos/icono-192.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(NUCLEO)
      .then((cache) => Promise.allSettled(INICIALES.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

const esRecurso = (url) => /\.(glb|gltf|bin|png|jpg|webp|ktx2)$/i.test(url.pathname)
  || url.hostname === 'cdn.jsdelivr.net';

async function primeroCache(peticion) {
  const guardada = await caches.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) (await caches.open(RECURSOS)).put(peticion, respuesta.clone());
  return respuesta;
}

async function primeroRed(peticion) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) (await caches.open(NUCLEO)).put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await caches.match(peticion, { ignoreSearch: peticion.mode === 'navigate' });
    if (guardada) return guardada;
    throw error;
  }
}

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const mismoOrigen = url.origin === self.location.origin;
  if (!mismoOrigen && url.hostname !== 'cdn.jsdelivr.net') return; // servicios locales y otros sitios: directo
  if (url.searchParams.has('overlay')) return;                     // la vista para OBS siempre en vivo
  evento.respondWith(esRecurso(url) ? primeroCache(request) : primeroRed(request));
});
