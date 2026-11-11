// Render a poster PNG for each model from its GLB, in headless Chromium.
//
//   node render_posters.mjs                 every model
//   node render_posters.mjs animal-cell     one model
//
// Each poster is 1200 x 900 with a transparent background, the model lit by a
// soft studio environment and seen from a three-quarter view. three.js is
// loaded from bank/.work/render/node_modules (see README.md).

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = path.resolve(here, '..', '..');
const threeDir = path.join(bank, '.work', 'render', 'node_modules', 'three');

// Pack folder and camera for each model. `view` is the direction the camera
// looks from; `fill` is how much of the frame the model's bounding sphere fills.
const MODELS = {
  'dna-double-helix': { pack: 'biology/dna-structure', view: [1, 0.35, 0.9], fill: 1.0 },
  'animal-cell': { pack: 'biology/cell-structure', view: [1, 0.7, 1], fill: 1.2 },
  'water-molecule': { pack: 'chemistry/bonding', view: [0.3, 0.25, 1], fill: 1.05 },
  'methane-molecule': { pack: 'chemistry/bonding', view: [0.35, 0.45, 0.82], fill: 1.05 },
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

window.renderPoster = async (url, view, fill) => {
  const W = 1200, H = 900, SS = 2;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W * SS, H * SS);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh && o.material.transparent) {
      o.material.depthWrite = false;
      o.renderOrder = 2;
    }
  });
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = new THREE.Vector3(...view).normalize();

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.copy(dir.clone().add(new THREE.Vector3(-0.6, 1.2, 0.1)).multiplyScalar(2));
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-dir.x, 0.6, -dir.z);
  scene.add(rim);

  const fov = 30;
  const camera = new THREE.PerspectiveCamera(fov, W / H, 0.01, 10);
  const half = THREE.MathUtils.degToRad(fov / 2);
  const dist = sphere.radius / Math.sin(half) / fill;
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);

  renderer.render(scene, camera);

  // downsample the supersampled frame for smooth edges
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  return out.toDataURL('image/png');
};
window.ready = true;
</script></body></html>`;

function contentType(p) {
  if (p.endsWith('.js')) return 'text/javascript';
  if (p.endsWith('.glb')) return 'model/gltf-binary';
  return 'text/html';
}

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice('/three/'.length));
  if (url.startsWith('/subjects/')) file = path.join(bank, url);
  if (!file || !file.startsWith(bank)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': contentType(file) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true);
  for (const name of names) {
    const spec = MODELS[name];
    if (!spec) throw new Error(`unknown model: ${name}`);
    const glb = `/subjects/${spec.pack}/assets/${name}.glb`;
    const dataUrl = await page.evaluate(([u, v, f]) => window.renderPoster(u, v, f), [glb, spec.view, spec.fill]);
    const out = path.join(bank, 'subjects', spec.pack, 'assets', `${name}.png`);
    await writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`${name}: wrote ${path.relative(bank, out)}`);
  }
} finally {
  await browser.close();
  server.close();
}
