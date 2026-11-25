/**
 * Avatar Señas · Estilo visual anime (cel shading)
 *
 * Cambia el aspecto del avatar sin tocar el modelo ni las animaciones:
 *   - Sombreado por bandas (MeshToonMaterial) en lugar de sombreado realista.
 *   - Contorno negro con la técnica "inverted hull": una copia de la malla,
 *     un poco inflada, que solo dibuja sus caras traseras.
 *   - Luz de estilo anime: una luz principal fuerte y un borde brillante.
 *   - Fondo con degradado y una sombra suave bajo los pies.
 *
 * setEstilo(viewer, 'anime' | 'realista') alterna entre los dos y guarda los
 * materiales originales para poder volver.
 */

import * as THREE from 'three';

export const CONFIG_ANIME = {
  bandas: [0.62, 0.86, 1.0],      // Niveles de luz del sombreado (sombra, medio, luz). Suaves para no manchar la cara.
  grosorContorno: 0.0032,          // Metros. Más grueso tapa los dedos.
  colorContorno: 0x1b1420,
  fondo: ['#cfe3ff', '#f6e9ff'],  // Degradado de arriba hacia abajo.
  luces: { ambient: 1.25, key: 2.0, fill: 0.5, rim: 2.0 },
  excluirContorno: /ojo|eye|cara/i, // Sin contorno: la malla 'Cara' (cabeza con ojos, dientes y boca por dentro).
};

const estado = new WeakMap(); // viewer → datos del modo anime

/* ----- Piezas ------------------------------------------------------------ */

function texturaBandas(niveles) {
  const datos = new Uint8Array(niveles.map((n) => Math.round(n * 255)));
  const tex = new THREE.DataTexture(datos, niveles.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; // Bordes duros entre bandas.
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function materialToon(original, bandas) {
  const toon = new THREE.MeshToonMaterial({
    color: original.color?.clone() ?? new THREE.Color(0xffffff),
    map: original.map ?? null,
    gradientMap: bandas,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    side: original.side,
  });
  toon.name = `${original.name}_anime`;
  return toon;
}

function materialContorno(grosor, color) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grosor = { value: grosor };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float grosor;\nvoid main() {')
      // Se infla en la pose de reposo, antes del esqueleto: así sigue a la animación.
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * grosor;');
  };
  return mat;
}

function crearContorno(malla, material) {
  const contorno = new THREE.SkinnedMesh(malla.geometry, material);
  contorno.name = `${malla.name}_contorno`;
  contorno.bind(malla.skeleton, malla.bindMatrix);
  contorno.bindMode = malla.bindMode;
  contorno.frustumCulled = false;
  // Comparte las expresiones faciales: mismo arreglo, no una copia.
  if (malla.morphTargetInfluences) {
    contorno.morphTargetInfluences = malla.morphTargetInfluences;
    contorno.morphTargetDictionary = malla.morphTargetDictionary;
  }
  contorno.position.copy(malla.position);
  contorno.quaternion.copy(malla.quaternion);
  contorno.scale.copy(malla.scale);
  malla.parent.add(contorno);
  return contorno;
}

function fondoDegradado([arriba, abajo]) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, arriba);
  grad.addColorStop(1, abajo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sombraPiso() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(40, 30, 60, 0.35)');
  grad.addColorStop(1, 'rgba(40, 30, 60, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const plano = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  plano.rotation.x = -Math.PI / 2;
  plano.position.y = 0.002;
  plano.name = 'sombra_anime';
  return plano;
}

/* ----- Preparación (una sola vez) --------------------------------------- */

function preparar(viewer, cfg) {
  const bandas = texturaBandas(cfg.bandas);
  const contornoMat = materialContorno(cfg.grosorContorno, cfg.colorContorno);
  const mallas = [];
  viewer.model.traverse((n) => { if (n.isMesh && !n.name.endsWith('_contorno')) mallas.push(n); });

  const datos = {
    materiales: mallas.map((m) => ({
      malla: m,
      original: m.material,
      anime: Array.isArray(m.material) ? m.material.map((x) => materialToon(x, bandas)) : materialToon(m.material, bandas),
    })),
    contornos: mallas
      .filter((m) => m.isSkinnedMesh && !cfg.excluirContorno.test(m.name))
      .map((m) => crearContorno(m, contornoMat)),
    luces: viewer.scene.children.filter((o) => o.isLight).map((luz) => ({ luz, intensidad: luz.intensity })),
    fondoOriginal: viewer.scene.background,
    fondoAnime: fondoDegradado(cfg.fondo),
    sombra: sombraPiso(),
    toneMapping: viewer.renderer.toneMapping,
  };
  viewer.scene.add(datos.sombra);
  estado.set(viewer, datos);
  return datos;
}

/* ----- API --------------------------------------------------------------- */

/**
 * @param {object} viewer AvatarViewer con el modelo ya cargado.
 * @param {'anime' | 'realista'} estilo
 */
export function setEstilo(viewer, estilo, cfg = CONFIG_ANIME) {
  if (!viewer.model) return;
  const datos = estado.get(viewer) ?? preparar(viewer, cfg);
  const anime = estilo === 'anime';

  for (const { malla, original, anime: toon } of datos.materiales) {
    malla.material = anime ? toon : original;
  }
  datos.contornos.forEach((c) => { c.visible = anime; });
  document.body.dataset.estilo = estilo; // El CSS adapta el título al fondo claro.
  datos.sombra.visible = anime;
  viewer.scene.background = anime ? datos.fondoAnime : datos.fondoOriginal;
  // Sin tone mapping los colores planos se ven limpios, como en una animación.
  viewer.renderer.toneMapping = anime ? THREE.NoToneMapping : datos.toneMapping;

  // Orden de las luces en la escena: ambiental, principal, relleno, borde.
  const nombres = ['ambient', 'key', 'fill', 'rim'];
  datos.luces.forEach(({ luz, intensidad }, i) => {
    luz.intensity = anime ? (cfg.luces[nombres[i]] ?? intensidad) : intensidad;
  });
}
