// SELENE GP — bootstrap: renderer, lighting, world assembly, main loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Terrain } from './terrain.js';
import { Track } from './track.js';
import { createSky } from './sky.js';
import { createMenu } from './menu.js';
import { Game } from './game.js';
import { RaceAudio } from './audio.js';
import { Net } from './net.js';

const params = new URLSearchParams(location.search);
const SETTINGS_KEY = 'selene-settings';

const QUALITY = {
  HIGH: { pr: Math.min(window.devicePixelRatio || 1, 2), shadows: 2048, bloom: 0.5, bloomRes: 1 },
  MEDIUM: { pr: Math.min(window.devicePixelRatio || 1, 1.5), shadows: 2048, bloom: 0.42, bloomRes: 0.75 },
  LOW: { pr: 1, shadows: 1024, bloom: 0.35, bloomRes: 0.5 },
};

function loadSettings() {
  try { return { quality: 'HIGH', sound: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { quality: 'HIGH', sound: true }; }
}

// ---- loading overlay ------------------------------------------------------
const loader = document.createElement('div');
loader.style.cssText = 'position:fixed;inset:0;background:#060b14;display:flex;align-items:center;justify-content:center;z-index:100;color:#eef5fc;font:500 11px "Geist Mono",ui-monospace,monospace;letter-spacing:.5em;text-transform:uppercase;transition:opacity .8s;';
loader.textContent = 'INITIALIZING';
document.body.appendChild(loader);
const setLoad = (t) => { loader.textContent = t; };
const yieldFrame = () => new Promise(r => setTimeout(r, 16));

async function boot() {
  const settings = loadSettings();
  let q = QUALITY[settings.quality] || QUALITY.HIGH;

  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(q.pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 90000);

  setLoad('SCULPTING MARE IMBRIUM');
  await yieldFrame();

  // ---- world build --------------------------------------------------------
  const terrain = new Terrain();
  terrain.buildNatural();
  await yieldFrame();

  const track = new Track();
  track.build(2).buildHash();
  track.setHeightsFromTerrain(terrain);
  terrain.carve(track);
  await yieldFrame();

  setLoad('SINTERING THE CIRCUIT');
  scene.add(terrain.buildMesh());
  await yieldFrame();
  scene.add(track.buildMeshes(terrain));
  terrain.buildBoulders(scene, track);
  await yieldFrame();

  setLoad('RAISING THE SKY');
  const sky = createSky({ scene, renderer });

  // ---- lighting -----------------------------------------------------------
  const sunDir = sky.sunDirection.clone().normalize();
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.3);
  sun.position.copy(sunDir).multiplyScalar(1200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadows, q.shadows);
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 3200;
  const S = 620;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x2a3f5e, 0x0a0b10, 0.85);
  scene.add(hemi);
  const earthFill = new THREE.DirectionalLight(0x4a7fd0, 0.22);
  earthFill.position.set(-0.55, 0.35, 0.8);
  scene.add(earthFill);
  // faint overhead starlight: gives crater interiors minimal modeling
  const starlight = new THREE.DirectionalLight(0x667d9e, 0.28);
  starlight.position.set(0.15, 1, 0.1);
  scene.add(starlight);

  // procedural environment for subtle metal reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  {
    const g = new THREE.SphereGeometry(100, 24, 12);
    const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true });
    const pos = g.attributes.position;
    const colors = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const up = Math.max(0, v.y);
      const sunK = Math.pow(Math.max(0, v.dot(sunDir)), 64) * 1.1;
      const c = new THREE.Color(0x0a1020).lerp(new THREE.Color(0x1c2b44), up * 0.6)
        .add(new THREE.Color(0xffd9a0).multiplyScalar(sunK));
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    envScene.add(new THREE.Mesh(g, m));
  }
  scene.environment = pmrem.fromScene(envScene, 0, 0.04, 120).texture;

  // ---- post fx: SELECTIVE (emissive-only) bloom ---------------------------
  // Only objects marked on the bloom layer (emissive materials, flagged via
  // toneMapped === false) feed the bloom pass; lit paint and regolith can
  // never bloom, so sunlit bodywork can't white-out.
  const BLOOM_LAYER = 1;
  const bloomLayerTest = new THREE.Layers();
  bloomLayerTest.set(BLOOM_LAYER);
  const markBloom = (root) => {
    root.traverse((o) => {
      if (o.isSprite) return; // name tags: crisp text, no glow halo
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) if (m && m.toneMapped === false) o.layers.enable(BLOOM_LAYER);
    });
  };

  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth * q.bloomRes, window.innerHeight * q.bloomRes),
    q.bloom, 0.45, 0.0,
  );
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
      void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
    defines: {},
  }), 'baseTexture');
  mixPass.needsSwap = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(mixPass);
  composer.addPass(new OutputPass());

  for (const c of [composer, bloomComposer]) {
    c.setPixelRatio(q.pr);
    c.setSize(window.innerWidth, window.innerHeight);
    if (c.renderTarget1.samples !== undefined) {
      c.renderTarget1.samples = 4;
      c.renderTarget2.samples = 4;
    }
  }
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
  const darkMats = {};
  function darkenNonBloomed(obj) {
    if ((obj.isMesh || obj.isPoints || obj.isSprite) && !bloomLayerTest.test(obj.layers)) {
      darkMats[obj.uuid] = obj.material;
      obj.material = darkMaterial;
    }
  }
  function restoreMaterial(obj) {
    if (darkMats[obj.uuid]) { obj.material = darkMats[obj.uuid]; delete darkMats[obj.uuid]; }
  }

  // ---- audio, menu, game --------------------------------------------------
  const audio = new RaceAudio();
  audio.setEnabled(settings.sound);

  const autopilot = params.get('demo') === '1';

  const env = { scene, renderer, camera, terrain, track, sky, audio, autopilot, menu: null, markBloom };
  const game = new Game(env);
  markBloom(scene); // flag all emissive (toneMapped:false) materials onto the bloom layer

  const menu = createMenu({
    onStartRace: () => game.startRace(),
    onResume: () => game.resume(),
    onRestart: () => game.startRace(),
    onQuitToMenu: () => game.quitToMenu(),
    onSettingChanged: (s) => {
      settings.quality = s.quality; settings.sound = s.sound;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      audio.setEnabled(s.sound);
      applyQuality(s.quality);
    },
    getSettings: () => settings,
  });
  env.menu = menu;
  game.env.menu = menu;

  // ---- LAN multiplayer handoff (from the moon lobby) ----------------------
  // ?auto=1&name=KIMI&color=2e7bf6&back=<lobby url>
  //
  // Single-player handoff (same lobby, NPC opponents, no network):
  // ?solo=1&name=KIMI&color=2e7bf6&npcs=YIMI:f2c94c,RIMI:eb5757,GIMI:27ae60&back=<url>
  const soloNpcs = (params.get('npcs') || '').split(',').map((e) => {
    const m = /^([A-Za-z0-9 _-]{1,12}):([0-9a-fA-F]{6})$/.exec(e.trim());
    return m ? { name: m[1].slice(0, 10).toUpperCase(), color: parseInt(m[2], 16) } : null;
  }).filter(Boolean);
  const SOLO = params.get('solo') === '1' && soloNpcs.length === 3;
  const MP = !SOLO && params.get('auto') === '1';
  const BACK_URL = params.get('back') || '';
  if (BACK_URL) {
    const a = document.createElement('a');
    a.href = BACK_URL;
    a.textContent = '← BACK TO THE MOON';
    a.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:60;padding:8px 16px;' +
      'border:1px solid rgba(114,173,247,.4);border-radius:4px;text-decoration:none;' +
      'font:500 10px "Geist Mono",ui-monospace,monospace;letter-spacing:.22em;' +
      'color:#eef5fc;background:rgba(6,11,20,.66);';
    document.body.appendChild(a);
  }
  if (MP) {
    const name = (params.get('name') || 'KIMI').slice(0, 10).toUpperCase();
    const color = parseInt(params.get('color') || '2e7bf6', 16); // relay wants an int
    const net = new Net();
    game.mpInit(net, { name, color });
    net.on('welcome', (msg) => game.mpWelcome(msg));
    net.on('roster', (ps) => game.mpRoster(ps));
    net.on('states', (m) => game.mpStates(m));
    net.on('raceStart', (m) => game.mpRaceStart(m));
    net.on('finishes', (fin) => game.mpFinishes(fin));
    net.on('item', (m) => game.mpItem(m));
    net.on('full', () => menu.showNotice('RACE FULL (8 MAX)', 6000));
    net.on('raceEnd', (fin) => game.mpFinishes(fin, true));
    net.connect()
      .then(() => net.join(name, color, true))
      .catch(() => menu.showNotice('CONNECTION FAILED — PLEASE REFRESH', 4000));
    menu.showScreen('none');
  }
  if (SOLO) {
    const name = (params.get('name') || 'KIMI').slice(0, 10).toUpperCase();
    const c = parseInt(params.get('color') || '', 16);
    const color = Number.isNaN(c) ? 0x2e7bf6 : c; // fallback: Kimi blue
    game.startSoloRace({ name, color, npcs: soloNpcs });
  }

  function applyQuality(name) {
    q = QUALITY[name] || QUALITY.HIGH;
    renderer.setPixelRatio(q.pr);
    for (const c of [composer, bloomComposer]) {
      c.setPixelRatio(q.pr);
      c.setSize(window.innerWidth, window.innerHeight);
    }
    bloomPass.strength = q.bloom;
    sun.shadow.mapSize.set(q.shadows, q.shadows);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }

  // ---- input --------------------------------------------------------------
  const keys = {};
  const INPUT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyR', 'KeyQ', 'KeyE', 'Escape']);
  window.addEventListener('keydown', (e) => {
    if (INPUT_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Escape') {
      if (game.state === 'race' || game.state === 'countdown') game.pause();
      else if (game.state === 'paused') game.resume();
    }
    if (e.code === 'KeyR' && game.state === 'race') game.resetPlayer();
  }, { passive: false });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  let steerAnalog = 0;
  function readInput(dt) {
    const g = game.input;
    g.throttle = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
    g.brake = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
    // note: positive sim yaw turns the car toward +X, which reads as
    // screen-LEFT from the chase camera — so D/Right must be negative.
    const target = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
    // analog ramp: keys ease in (progressive lock) and snap back faster —
    // small taps become small corrections instead of full-lock jerks
    const rate = target !== 0 && Math.sign(target) !== Math.sign(steerAnalog) ? 9 : target !== 0 ? 5.5 : 9;
    const d = target - steerAnalog;
    steerAnalog += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    g.steer = steerAnalog;
    g.handbrake = !!keys.Space;
    g.boost = !!(keys.ShiftLeft || keys.ShiftRight);
    g.useItem = !!(keys.KeyQ || keys.KeyE);
  }

  // ---- resize -------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloomComposer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- loop ---------------------------------------------------------------
  const clock = new THREE.Clock();
  let elapsed = 0;
  let fpsT = 0, fpsN = 0;
  window.__fps = 0;
  window.__errors = [];
  window.__game = game; // test/debug hook (same spirit as __fps/__errors)
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));

  window.SELENE = { game, env, THREE, bloom: bloomPass, composer, bloomComposer, renderer, applyQuality, get state() { return game.state; } };

  if (params.get('race') === '1') {
    // delayed auto-start for soak testing
    setTimeout(() => game.startRace(), 500);
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;

    if (game.state === 'race') readInput(dt);
    else { game.input.throttle = 0; game.input.brake = 0; game.input.steer = 0; game.input.handbrake = false; game.input.boost = false; game.input.useItem = false; }

    game.update(dt);
    sky.update(dt, elapsed);

    // keep the sun shadow frustum on the action
    const focus = (game.state === 'race' || game.state === 'countdown') ? game.player.pos : camera.position;
    sun.position.set(focus.x + sunDir.x * 1200, focus.y + sunDir.y * 1200 + 200, focus.z + sunDir.z * 1200);
    sun.target.position.set(focus.x, focus.y, focus.z);
    sun.target.updateMatrixWorld();

    // selective bloom: darken non-emissive objects, render bloom-only pass,
    // restore, then render the final composite with bloom added.
    scene.traverse(darkenNonBloomed);
    bloomComposer.render();
    scene.traverse(restoreMaterial);
    composer.render();

    fpsN++; fpsT += dt;
    if (fpsT >= 1) { window.__fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  }

  // initial attract camera placement + first render, then reveal
  game.update(0.016);
  sky.update(0.016, 0);
  scene.traverse(darkenNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreMaterial);
  composer.render();
  if (game.state === 'attract') menu.showScreen('main'); // solo/MP handoffs skip the menu
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 900);
  frame();
}

boot().catch((e) => {
  console.error(e);
  loader.textContent = 'ERROR: ' + e.message;
  loader.style.color = '#ff8080';
  window.__bootError = String(e.stack || e);
});
