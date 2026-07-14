// GONDOLIER — bootstrap: renderer, post chain, world build, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeWorld } from './scene/world.js';
import { makeAttractCamera } from './scene/attract.js';
import { makeGame } from './game/game.js';
import { makeUI } from './ui/menu.js';
import { initAudio, setSound } from './ui/audio.js';
import { Net } from './net.js';

export const QUALITY = {
  HIGH:   { pr: 1.6, bloom: 0.42, refl: [1024, 576], mist: 1.0 },
  MEDIUM: { pr: 1.25, bloom: 0.38, refl: [768, 432], mist: 0.8 },
  LOW:    { pr: 1.0, bloom: 0.0, refl: [512, 288], mist: 0.55 },
};

export function loadSettings() {
  try {
    return {
      quality: localStorage.getItem('gondolier.quality') || 'HIGH',
      sound: localStorage.getItem('gondolier.sound') !== 'off',
    };
  } catch { return { quality: 'HIGH', sound: true }; }
}
export function saveSettings(s) {
  try {
    localStorage.setItem('gondolier.quality', s.quality);
    localStorage.setItem('gondolier.sound', s.sound ? 'on' : 'off');
  } catch {}
}

const GrainVignette = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float vig = 1.0 - dot(q, q) * uVignette * 2.2;
      col.rgb *= clamp(vig, 0.0, 1.0);
      float g = hash(vUv * vec2(1234.0, 876.0) + fract(uTime) * 43.7) - 0.5;
      col.rgb += g * uGrain;
      gl_FragColor = vec4(max(col.rgb, 0.0), col.a);
    }
  `,
};

export async function boot() {
  const settings = loadSettings();
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2000);

  // composer with HDR buffers (world builds its own scene; we adopt it below)
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 0.88);
  composer.addPass(bloom);
  const grainPass = new ShaderPass(GrainVignette);
  composer.addPass(grainPass);
  composer.addPass(new OutputPass());

  let quality = QUALITY[settings.quality] || QUALITY.HIGH;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pr));
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bloom.strength = quality.bloom;
  }
  addEventListener('resize', resize);

  const progressEl = document.getElementById('loadbar');
  const progressTxt = document.getElementById('loadtext');
  const world = await makeWorld(renderer, (p, label) => {
    if (progressEl) progressEl.style.width = `${(p * 100) | 0}%`;
    if (progressTxt && label) progressTxt.textContent = label;
  });
  // adopt the world's scene (its reflection pass closes over it)
  renderPass.scene = world.scene;
  scene.fog = world.scene.fog; // keep ref for potential tweaks

  const attract = makeAttractCamera(world.canal);

  const game = makeGame({
    world, camera, scene: world.scene, renderer,
    get quality() { return quality; },
  });

  resize();

  const clock = new THREE.Clock();
  let t = 0;
  let mode = 'menu'; // 'menu' | 'game'
  let firstFrame = true;
  let fpsAccum = 0, fpsFrames = 0, fpsValue = 60;
  let attractOffset = 8; // +8s: start past the first stretch

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    if (mode === 'menu') {
      attract.apply(camera, t + attractOffset);
    } else if (mode === 'game') {
      game.update(dt, t);
    }
    world.update(dt, t, camera);
    grainPass.uniforms.uTime.value = t;
    composer.render();

    // fps estimate
    fpsAccum += dt; fpsFrames++;
    if (fpsAccum >= 0.5) { fpsValue = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

    if (firstFrame) {
      firstFrame = false;
      window.__ready = true;
      document.getElementById('loading')?.classList.add('done');
    }
  }
  renderer.setAnimationLoop(frame);

  // ---- game input (active while playing; UI owns menu input)
  let lastMX = null, lastMT = 0;
  addEventListener('pointermove', (e) => {
    if (mode !== 'game') return;
    const nx = (e.clientX / innerWidth) * 2 - 1;
    game.setMouse(nx, (e.clientY / innerHeight) * 2 - 1);
    const now = performance.now();
    if (lastMX !== null) {
      const dt = Math.max(0.008, (now - lastMT) / 1000);
      game.strokeMotion(((e.clientX - lastMX) / innerWidth * 2) / dt);
    }
    lastMX = e.clientX; lastMT = now;
  });
  addEventListener('pointerdown', () => { lastMX = null; });
  addEventListener('keydown', (e) => {
    if (mode !== 'game') return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 's' || k === 'a' || k === 'd') game.setKey(k, true);
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); game.shove(); }
    if (e.code === 'KeyE' && !e.repeat) game.useItem();
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 's' || k === 'a' || k === 'd') game.setKey(k, false);
  });
  addEventListener('blur', () => {
    for (const k of ['w', 'a', 's', 'd']) game.setKey(k, false);
  });

  // ---- external hooks (UI + verification)
  let soloMode = false;
  window.__app = {
    THREE, scene, camera, renderer, world,
    get mode() { return mode; },
    setMode(m) { mode = m; },
    seek(sec) { attractOffset = sec - t; },
    get fps() { return fpsValue; },
    game,
    get solo() { return soloMode; },
    spBoats() { return game.spBoats(); },
    startRun() { mode = 'game'; game.startRun(); },
    quitToMenu() { mode = 'menu'; game.boat.visible = false; game.spQuit(); },
    settings,
    saveSettings() { saveSettings(settings); },
    applyQuality(q) {
      settings.quality = q;
      quality = QUALITY[q] || QUALITY.HIGH;
      saveSettings(settings);
      resize();
      world.mist.setDensity(quality.mist);
    },
  };
  world.mist.setDensity(quality.mist);

  initAudio(settings.sound);
  setSound(settings.sound);
  const ui = makeUI(window.__app);
  window.__app.ui = ui;

  // ---- LAN multiplayer handoff (from the moon lobby) ----------------------
  // ?auto=1&name=KIMI&color=2e7bf6&back=<lobby url>
  const params = new URLSearchParams(location.search);
  const backUrl = params.get('back') || '';
  if (backUrl) {
    const a = document.createElement('a');
    a.href = backUrl;
    a.textContent = '← BACK TO THE MOON';
    a.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:70;padding:8px 16px;' +
      'border:1px solid rgba(114,173,247,.4);border-radius:4px;text-decoration:none;' +
      'font:500 10px "Geist Mono",ui-monospace,monospace;letter-spacing:.22em;' +
      'color:#eef5fc;background:rgba(6,11,20,.66);text-transform:uppercase;';
    document.body.appendChild(a);
  }
  // ---- single-player regatta handoff (from the moon lobby) --------------
  // ?solo=1&name=KIMI&color=2e7bf6&npcs=YIMI:f2c94c,RIMI:eb5757,GIMI:27ae60&back=<url>
  // No socket: the 3 NPC opponents are local AI gondolas (src/game/ai.js).
  const soloNpcs = (params.get('npcs') || '').split(',')
    .map((e) => {
      const [nm, hex] = e.split(':');
      const c = parseInt(hex || '', 16);
      return nm && Number.isFinite(c) ? { name: nm.slice(0, 10).toUpperCase(), color: c } : null;
    })
    .filter(Boolean);
  if (params.get('solo') === '1' && soloNpcs.length === 3) {
    const name = (params.get('name') || 'KIMI').slice(0, 10).toUpperCase();
    const color = parseInt(params.get('color') || '2e7bf6', 16);
    soloMode = true;
    game.spInit({ name, color, npcs: soloNpcs });
    game.spStart();
    mode = 'game';
    ui.enterHud();
  } else if (params.get('auto') === '1') {
    const name = (params.get('name') || 'KIMI').slice(0, 10).toUpperCase();
    const color = parseInt(params.get('color') || '2e7bf6', 16); // relay wants an int
    const net = new Net();
    game.mpInit(net, { name, color });
    net.on('welcome', (msg) => game.mpWelcome(msg));
    net.on('roster', (ps) => game.mpRoster(ps));
    net.on('states', (m) => game.mpStates(m));
    net.on('raceStart', (m) => game.mpRaceStart(m));
    net.on('finishes', (fin) => game.mpFinishes(fin));
    net.on('raceEnd', (fin) => game.mpFinishes(fin, true));
    net.on('item', (m) => game.mpItem(m));
    net.on('full', () => game.notice('REGATTA FULL (8 MAX)', 'bad'));
    net.connect()
      .then(() => net.join(name, color, true))
      .catch(() => game.notice('CONNECTION FAILED — PLEASE REFRESH', 'bad'));
    mode = 'game';
    ui.enterHud();
  }
  return window.__app;
}
