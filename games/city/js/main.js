import * as THREE from 'three';
import { Engine } from './engine.js';
import { loadAssets } from './assets.js';
import { makeSky, makeEnvironment } from './sky.js';
import { City } from './city.js';
import { Life } from './life.js';
import { Game } from './game.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { GlobalUniforms } from './utils.js';

const canvas = document.getElementById('gl');
const engine = new Engine(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.35, 3600);
camera.position.set(0, 30, 0);
scene.add(camera);

// lighting for the PBR assets (city itself is all custom shaders)
scene.add(new THREE.HemisphereLight(0x1d2a40, 0x100c14, 1.1));
const key = new THREE.DirectionalLight(0x8fb4d8, 0.5);
key.position.set(-40, 90, 30);
scene.add(key);
const fill = new THREE.DirectionalLight(0xff3d7f, 0.22);
fill.position.set(50, 30, -60);
scene.add(fill);

scene.add(makeSky());
scene.environment = makeEnvironment(engine.renderer);

// ------------------------------------------------------------- boot -------
const lfill = document.querySelector('#lbar .fill');
const lpct = document.getElementById('lpct');

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

let game = null, ui = null, life = null;
const audio = new AudioSys();

(async () => {
  try {
    await loadAssets((p, key) => {
      lfill.style.width = `${Math.round(p * 88)}%`;
      lpct.textContent = `CONNECTING ${Math.round(p * 88)}% — ${key.toUpperCase()}`;
    });
  } catch (err) {
    lpct.textContent = 'ASSET LOAD FAILED — ' + err.message;
    console.error(err);
    return;
  }

  const city = new City(scene);
  life = new Life(scene, city);
  game = new Game(scene, engine, city, life, camera, audio);
  ui = new UI(game, engine, life, audio);
  city.groundMat.uniforms.tRefl.value = engine.reflRT.texture;
  window.__game = game; // test/debug hook

  lfill.style.width = '100%';
  lpct.textContent = 'GRID ONLINE';

  // pre-warm shaders with a couple of hidden frames before revealing
  let warm = 0;
  const warmup = () => {
    game.update(1 / 60, engine.time);
    engine.renderReflection(scene, camera);
    city.groundMat.uniforms.uMirrorVP.value.copy(engine.mirrorVP);
    engine.render(scene, camera, 1 / 60);
    if (++warm < 3) requestAnimationFrame(warmup);
    else {
      document.getElementById('loading').classList.add('done');
      requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(warmup);
})();

// -------------------------------------------------------------- loop ------
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = 0;
const fpsEl = document.getElementById('fps');
if (location.search.includes('debug')) document.body.classList.add('debug');

function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  GlobalUniforms.uTime.value = engine.time;

  game.update(dt, engine.time);

  // planar reflection for the wet street (layer 1 objects only)
  engine.renderReflection(scene, camera);
  game.city.groundMat.uniforms.uMirrorVP.value.copy(engine.mirrorVP);
  game.city.groundMat.uniforms.tRefl.value = engine.reflRT.texture;

  engine.render(scene, camera, dt);

  // fps meter (?debug)
  fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    fpsEl.textContent = `${Math.round(fpsAcc / fpsN)} FPS · ${engine.width}×${engine.height}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}
