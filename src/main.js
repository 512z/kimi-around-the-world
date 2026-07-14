// KIMI LUNAR — cinematic + playable LAN-multiplayer lunar base.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTerrain } from './terrain.js';
import { createEarth } from './earth.js';
import { createBase } from './base.js';
import { createCameraRig, LOOP } from './camera.js';
import { makeSoftSprite } from './textures.js';
import { createMenu, COLOR_BY_ID } from './menu.js';
import { PlayerController, RemotePlayer, createKimiBall } from './player.js';
import { NetClient } from './net.js';
import { pickNpcSpecs, NpcBall } from './npc.js';

const params = new URLSearchParams(location.search);
const seekT = parseFloat(params.get('t') || '0') || 0;
const freeCam = params.get('free') === '1';

// ------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.domElement.id = 'scene';
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 3200, 9500);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 60000);
camera.position.set(880, 340, 900);

// ------------------------------------------------------------- lighting
const SUN_DIR = new THREE.Vector3(0.62, 0.22, 0.75).normalize(); // low, warm, from ESE (behind wide shots -> full Earth)
const sun = new THREE.DirectionalLight(0xfff4e6, 5.2);
sun.position.copy(SUN_DIR).multiplyScalar(900);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 2800;
// Tight shadow box that FOLLOWS the player (updated per frame below): a
// static ±520 m box put ~25 cm per texel and needed normalBias 2.6, which
// swallowed the small ball-on-ball / ball-on-ground shadows entirely.
// ±140 m around the action = ~7 cm texels -> crisp Kimi shadows.
const SH = 140;
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(sun.target);

// airless: extremely low ambient + dim blue earthshine from Earth's sky direction
scene.add(new THREE.AmbientLight(0x141a26, 0.25));
const EARTH_DIR = new THREE.Vector3(-0.50, 0.52, -0.69).normalize();
const earthshine = new THREE.DirectionalLight(0x4a6ea8, 0.35);
earthshine.position.copy(EARTH_DIR).multiplyScalar(500);
scene.add(earthshine);

// ------------------------------------------------------------- stars
function makeStars(n = 2600) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // uniform on sphere, avoid clustering near Earth's disk
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th));
    if (d.dot(EARTH_DIR) > 0.992) { i--; continue; }
    d.multiplyScalar(28000 + Math.random() * 8000);
    pos[i * 3] = d.x; pos[i * 3 + 1] = d.y; pos[i * 3 + 2] = d.z;
    const b = 0.25 + Math.pow(Math.random(), 2.5) * 0.75;
    const tint = Math.random();
    col[i * 3] = b * (0.85 + tint * 0.15);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (0.85 + (1 - tint) * 0.15);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.8, sizeAttenuation: false, vertexColors: true, fog: false,
    transparent: true, opacity: 0.95, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}
scene.add(makeStars());

// ------------------------------------------------------------- sun disk + glow
{
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(190, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 4.0), fog: false })
  );
  disk.position.copy(SUN_DIR).multiplyScalar(24000);
  disk.lookAt(0, 0, 0);
  scene.add(disk);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeSoftSprite(128, 'rgba(255,240,210,1)'), color: new THREE.Color(1.6, 1.4, 1.1),
    transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.scale.set(7000, 7000, 1);
  glow.position.copy(SUN_DIR).multiplyScalar(23500);
  scene.add(glow);
}

// ------------------------------------------------------------- world
const terrain = createTerrain();
scene.add(terrain.group);

const earth = createEarth(SUN_DIR);
scene.add(earth.group);

const base = createBase();
scene.add(base.group);

// ------------------------------------------------------------- post
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.5, 1.25
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------- game systems
const PLAZA = { x: -95, z: 110 };
const FALLBACK_SPAWN = { x: PLAZA.x + 8, z: PLAZA.z }; // ring slot 0 (matches server.js)

const rig = createCameraRig();
const player = new PlayerController(scene, camera, terrain.heightAt);
window.__player = player; // test hook (same spirit as __sceneReady)
player.colliders = base.colliders;
const remotes = new Map();             // id -> RemotePlayer
const labels = new Map();              // id -> div
const net = new NetClient();
const npcs = [];                       // single-player NpcBall crew

let gameState = 'ATTRACT';             // ATTRACT | PLAYING | PAUSED
let gameMode = null;                   // null | 'single' | 'multi'
let fovTarget = 70;                    // wide showcase FOV in menus, 55 in-game
let camBlend = null;                   // menu→game camera handoff tween
const blendP = new THREE.Vector3();
const blendQ = new THREE.Quaternion();
let netNow = 0;                        // seconds, local clock for interpolation
let stateAcc = 0;

function profile() {
  const p = menu.getProfile();
  return { name: p.name, color: p.color, colorHex: COLOR_BY_ID[p.color].hex };
}

// ---------------------------------------------------- game launcher (host)
// The moon is the lobby for the other games: the first player in is the HOST
// and picks the game; everyone shares a 5 s countdown then redirects together.
const GAME_TARGETS = {
  race:   { port: 9101, path: '/', staticPath: 'games/race/', label: 'MOON RACE' },
  venice: { port: 9102, path: '/', staticPath: 'games/venice/', label: 'VENICE SPEED' },
  city:   { port: 9103, path: '/arena.html', staticPath: 'games/city/arena.html', label: 'CYBER SPACESHIP' },
};

// On localhost / private LAN IPs the game servers live on sibling ports; on
// any public static host (GitHub Pages, fcapp…) there are no game servers, so
// the solo launcher links to the in-repo static copies instead.
function isLocalHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
function gameBaseUrl(target) {
  return isLocalHost()
    ? `http://${location.hostname}:${target.port}${target.path}`
    : new URL(target.staticPath, location.href).href;
}
let isHost = false;
let launchAt = null;                  // server clock ms
let launchGame = 'race';
let launchClockOffset = 0;            // serverNow - Date.now()
let launchRedirected = false;
let soloLaunch = false;               // single-player local countdown

function updateHostUi() {
  const counting = launchAt !== null;
  const solo = gameMode === 'single';
  document.getElementById('host-menu').classList.toggle(
    'on', ((net.online && isHost) || solo) && !counting && gameState === 'PLAYING');
  document.getElementById('host-wait').classList.toggle(
    'on', net.online && !isHost && !counting && gameState === 'PLAYING');
}

function armLaunch(msg) {
  launchAt = msg.startAt;
  launchGame = GAME_TARGETS[msg.game] ? msg.game : 'race';
  launchClockOffset = msg.serverNow - Date.now();
  launchRedirected = false;
  soloLaunch = false;
  updateHostUi();
}

// single-player picker: same countdown UI, short local fuse, no server
function armSoloLaunch(game) {
  if (launchAt !== null) return;
  launchAt = Date.now() + 1800;
  launchGame = GAME_TARGETS[game] ? game : 'race';
  launchClockOffset = 0;
  launchRedirected = false;
  soloLaunch = true;
  updateHostUi();
}

function updateLaunchCountdown() {
  const el = document.getElementById('launch-count');
  if (launchAt === null || gameState === 'ATTRACT') { el.classList.remove('on'); return; }
  const remain = launchAt - (Date.now() + launchClockOffset);
  const target = GAME_TARGETS[launchGame];
  if (remain <= 0) {
    if (!launchRedirected) {
      launchRedirected = true;
      el.querySelector('.lc-n').textContent = 'GO';
      const p = profile();
      const back = encodeURIComponent(`${location.origin}${location.pathname}`);
      const base = gameBaseUrl(target);
      if (soloLaunch) {
        // contract URL: solo=1, player name/color, 3 NPC name:hex entries
        const npcParam = encodeURIComponent(
          npcs.map((n) => `${n.name}:${n.colorHex.replace('#', '')}`).join(','));
        window.location.href =
          `${base}?solo=1&name=${encodeURIComponent(p.name)}` +
          `&color=${p.colorHex.replace('#', '')}&npcs=${npcParam}&back=${back}`;
      } else {
        window.location.href =
          `http://${location.hostname}:${target.port}${target.path}?auto=1&name=${encodeURIComponent(p.name)}` +
          `&color=${p.colorHex.replace('#', '')}&back=${back}`;
      }
    }
    return;
  }
  el.classList.add('on');
  el.querySelector('.lc-g').textContent = `${target.label} · STARTING IN`;
  el.querySelector('.lc-n').textContent = Math.ceil(remain / 1000);
}

for (const btn of document.querySelectorAll('.host-start')) {
  btn.addEventListener('click', () => {
    if (gameMode === 'single') armSoloLaunch(btn.dataset.game);
    else net.startRace(btn.dataset.game);
    btn.blur();
  });
}

function addRemote(p) {
  if (remotes.has(p.id) || p.id === net.id) return;
  const r = new RemotePlayer(scene, terrain.heightAt, {
    name: p.name, colorHex: COLOR_BY_ID[p.color]?.hex || '#2E7BF6',
    x: p.x, z: p.z, heading: p.heading || 0,
  });
  remotes.set(p.id, r);
  player.remotes = [...remotes.values()];
  menu.setCrew(remotes.size + (player.enabled ? 1 : 0));
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  r.dispose();
  remotes.delete(id);
  player.remotes = [...remotes.values()];
  menu.setCrew(remotes.size + (player.enabled ? 1 : 0));
  const lab = labels.get(id);
  if (lab) { lab.remove(); labels.delete(id); }
}

function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

// ---------------------------------------------------- single-player NPC crew
function spawnNpcs(prof) {
  const specs = pickNpcSpecs(prof.colorHex);
  // small ring around the player's plaza spawn (server slot 0)
  for (let i = 0; i < specs.length; i++) {
    const a = (i / specs.length) * Math.PI * 2 + Math.PI / 3;
    npcs.push(new NpcBall(
      scene, terrain.heightAt, base.colliders, specs[i],
      FALLBACK_SPAWN.x + Math.cos(a) * 4, FALLBACK_SPAWN.z + Math.sin(a) * 4,
    ));
  }
  player.remotes = npcs; // the player bumps into NPCs exactly like remote humans
}

function clearNpcs() {
  for (const n of npcs) n.dispose();
  npcs.length = 0;
  player.remotes = [];
}

function updateNpcs(dt) {
  for (let i = 0; i < npcs.length; i++) npcs[i].update(dt, player, npcs, i);
}

// SINGLE PLAYER: no net at all — the plaza spawn plus three NPC Kimi balls
function startSinglePlayer() {
  const prof = profile();
  if (preview.obj) scene.remove(preview.obj);
  fovTarget = 55;
  camBlend = { t: 0, fromP: camera.position.clone(), fromQ: camera.quaternion.clone() };
  net.leave();
  player.spawn(prof, FALLBACK_SPAWN);
  spawnNpcs(prof);
  gameMode = 'single';
  gameState = 'PLAYING';
  document.body.classList.add('playing');
  menu.show(null);
  menu.showHint();
  menu.setCrew(1 + npcs.length);
  updateHostUi();
}

function startGame() {
  const prof = profile();
  if (preview.obj) scene.remove(preview.obj);
  fovTarget = 55;
  // hand the camera off smoothly: blend from the menu hold framing into the
  // follow cam instead of cutting
  camBlend = { t: 0, fromP: camera.position.clone(), fromQ: camera.quaternion.clone() };
  player.spawn(prof, FALLBACK_SPAWN); // optimistic; server may relocate via init
  gameMode = 'multi';
  gameState = 'PLAYING';
  document.body.classList.add('playing');
  menu.show(null);
  menu.showHint();
  menu.setCrew(1);

  net.leave();
  const fresh = new NetClient();
  Object.assign(net, fresh);
  net.onInit = (msg) => {
    player.spawn(prof, msg.spawn);
    for (const p of msg.players) if (p.id !== net.id) addRemote(p);
    menu.setCrew(remotes.size + 1);
    isHost = msg.hostId === net.id;
    if (msg.launch) armLaunch(msg.launch);
    updateHostUi();
  };
  net.onHost = (hid) => { isHost = hid === net.id; updateHostUi(); };
  net.onCountdown = (msg) => armLaunch(msg);
  net.onFallback = () => {
    menu.setCrew(1); isHost = false; updateHostUi();
    if (net.full) {
      const el = document.createElement('div');
      el.textContent = 'MOON LOBBY FULL (8 MAX) — EXPLORING SOLO';
      el.style.cssText = 'position:fixed;left:50%;top:12vh;transform:translateX(-50%);z-index:40;' +
        'font:500 11px "Geist Mono",ui-monospace,monospace;letter-spacing:.3em;color:#eef5fc;' +
        'padding:10px 18px;border:1px solid rgba(114,173,247,.4);border-radius:4px;' +
        'background:rgba(6,11,20,.7);transition:opacity 1s ease;';
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 1100); }, 6000);
    }
  };
  net.onJoin = (p) => addRemote(p);
  net.onLeave = (id) => removeRemote(id);
  net.onState = (msg) => {
    const r = remotes.get(msg.id);
    if (r) r.pushState(netNow, msg);
  };
  net.connect(prof);
}

function pauseGame() {
  if (gameState !== 'PLAYING') return;
  gameState = 'PAUSED';
  document.body.classList.remove('playing');
  player.keys.clear();
  menu.show('pause');
}

function resumeGame() {
  if (gameState !== 'PAUSED') return;
  gameState = 'PLAYING';
  document.body.classList.add('playing');
  menu.show(null);
}

function leaveGame() {
  gameState = 'ATTRACT';
  gameMode = null;
  isHost = false; launchAt = null; soloLaunch = false;
  updateHostUi(); updateLaunchCountdown();
  document.body.classList.remove('playing');
  player.despawn();
  fovTarget = 70;
  if (preview.obj) scene.add(preview.obj);
  net.leave();
  clearRemotes();
  clearNpcs();
  menu.setCrew(1);
  menu.show('main');
  document.getElementById('labels').innerHTML = '';
  labels.clear();
}

// ------------------------------------------------------------- attract-mode preview ball
// The player's Kimi ball idles in the plaza during the menu; name/color edits
// rebuild it live so the menu choices are visible in the scene.
const preview = {
  obj: null,
  pos: new THREE.Vector3(PLAZA.x + 8, 0, PLAZA.z), // == server slot 0 == FALLBACK_SPAWN: the menu ball IS your ball
  t: 0,
};
function refreshPreview(p) {
  const colorHex = COLOR_BY_ID[p.color]?.hex || '#2E7BF6';
  if (preview.obj) {
    scene.remove(preview.obj);
    preview.obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  preview.obj = createKimiBall(colorHex, p.name);
  preview.obj.position.copy(preview.pos);
  if (gameState === 'ATTRACT') scene.add(preview.obj);
}

const menu = createMenu({
  onSingle: startSinglePlayer,
  onMulti: startGame,
  onResume: resumeGame,
  onLeave: leaveGame,
  onProfileChange: (p) => refreshPreview(p),
});

// ------------------------------------------------------------- debug controls (free cam)
let controls = null;
if (freeCam) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 5, 0);
}

// ------------------------------------------------------------- input
addEventListener('keydown', (e) => {
  menu.ensureAudio();
  if (gameState === 'PLAYING') {
    if (e.code === 'Escape') { pauseGame(); e.preventDefault(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) {
      player.setKey(e.code, true);
      e.preventDefault();
    }
    return;
  }
  if (menu.handleKey(e)) e.preventDefault();
});

addEventListener('keyup', (e) => {
  if (gameState === 'PLAYING') player.setKey(e.code, false);
});

// camera drag / zoom while playing
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (gameState !== 'PLAYING') return;
  menu.ensureAudio();
  player.startDrag();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (gameState === 'PLAYING' && player.dragging) player.drag(e.movementX, e.movementY);
});
canvas.addEventListener('pointerup', () => player.endDrag());
canvas.addEventListener('wheel', (e) => {
  if (gameState !== 'PLAYING') return;
  player.zoom(Math.sign(e.deltaY) * 0.6);
  e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------- name labels (DOM, projected)
const labelLayer = document.getElementById('labels');
const projV = new THREE.Vector3();
function updateLabels() {
  const all = gameState === 'ATTRACT'
    ? (preview.obj && preview.obj.parent ? [['preview', { ball: preview.obj, pos: preview.obj.position }]] : [])
    : [['local', player], ...remotes.entries(), ...npcs.map((n, i) => [`npc${i}`, n])];
  if (!all.length) { labelLayer.style.display = 'none'; return; }
  labelLayer.style.display = '';
  const seen = new Set();
  for (const [id, p] of all) {
    if (!p.ball) continue;
    seen.add(id);
    let lab = labels.get(id);
    if (!lab) {
      lab = document.createElement('div');
      lab.className = 'lab';
      labelLayer.appendChild(lab);
      labels.set(id, lab);
    }
    lab.textContent = p.ball.userData.name || 'KIMI'; // live name-edit preview
    projV.copy(p.pos); projV.y += 1.7;
    projV.project(camera);
    if (projV.z > 1) { lab.style.display = 'none'; continue; }
    lab.style.display = '';
    lab.style.left = `${(projV.x * 0.5 + 0.5) * innerWidth}px`;
    lab.style.top = `${(-projV.y * 0.5 + 0.5) * innerHeight}px`;
  }
  for (const [id, lab] of labels) if (!seen.has(id)) { lab.remove(); labels.delete(id); }
}

// ------------------------------------------------------------- loop
const clock = new THREE.Clock();
let sceneTime = seekT;
// opening intro: fly from the wide crater vista (t=96) into the hero close-up
// of the preview ball (t=0) in 5 s, then HOLD — the menu is the stage.
// (?t= seek skips the intro and free-runs the loop from that time.)
const INTRO_FROM = 96, INTRO_DUR = 5;
let introT = seekT !== 0 ? null : 0;
let firstFrame = true;
window.__sceneReady = false;

const _shadowFocus = new THREE.Vector3();
function updateShadowFollow() {
  const focus = player.enabled && player.ball ? player.pos : camera.position;
  const texel = (SH * 2) / 4096;
  _shadowFocus.set(
    Math.round(focus.x / texel) * texel,
    0,
    Math.round(focus.z / texel) * texel,
  );
  sun.position.copy(SUN_DIR).multiplyScalar(900).add(_shadowFocus);
  sun.target.position.copy(_shadowFocus);
  sun.target.updateMatrixWorld();
}

function frame() {
  updateShadowFollow();
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  sceneTime += dt;
  netNow += dt;

  updateLaunchCountdown();

  if (gameState === 'PLAYING' || gameState === 'PAUSED') {
    if (gameState === 'PLAYING') {
      player.update(dt);
      updateNpcs(dt);
      if (camBlend) {
        camBlend.t += rawDt / 1.6;
        const e = Math.min(1, camBlend.t), k = e * e * (3 - 2 * e);
        blendP.copy(camera.position); blendQ.copy(camera.quaternion);
        camera.position.lerpVectors(camBlend.fromP, blendP, k);
        camera.quaternion.slerpQuaternions(camBlend.fromQ, blendQ, k);
        if (e >= 1) camBlend = null;
      }
      stateAcc += dt;
      if (stateAcc > 0.05 && player.enabled) { // 20 Hz state
        stateAcc = 0;
        net.sendState({
          x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2),
          y: +player.pos.y.toFixed(2), // jumps must replicate
          vx: +player.vel.x.toFixed(2), vz: +player.vel.y.toFixed(2),
          heading: +player.heading.toFixed(3),
        });
      }
    }
    for (const r of remotes.values()) r.update(dt, netNow);
  } else if (controls) {
    controls.update();
  } else {
    let camT = sceneTime;
    if (introT !== null) {
      introT = Math.min(introT + rawDt, INTRO_DUR); // wall-clock: 5 s at any fps
      const s = introT / INTRO_DUR;
      camT = INTRO_FROM + (s * s * (3 - 2 * s)) * (LOOP - INTRO_FROM);
    }
    rig.apply(camera, camT, dt);
    // preview ball: hover bob + turn to face the camera
    if (preview.obj && preview.obj.parent) {
      preview.t += dt;
      const gy = terrain.heightAt(preview.pos.x, preview.pos.z) + 0.95;
      preview.obj.position.set(preview.pos.x, gy + Math.sin(preview.t * 1.6) * 0.1, preview.pos.z);
      preview.obj.rotation.y = Math.atan2(
        camera.position.x - preview.pos.x, camera.position.z - preview.pos.z
      );
    }
  }
  updateLabels();

  // FOV drift: 70 showcase in menus → 55 gameplay
  if (Math.abs(camera.fov - fovTarget) > 0.01) {
    camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();
  }

  earth.update(sceneTime, dt, camera);
  base.update(sceneTime, dt);

  composer.render();

  if (firstFrame) {
    firstFrame = false;
    window.__sceneReady = true;
    const loader = document.getElementById('loader');
    if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 1400); }
  }
}
frame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------- debug / test handles
window.__camera = camera;
window.__scene = scene;
window.__controls = controls;
window.__THREE = THREE;
window.__rendererInfo = () => JSON.parse(JSON.stringify(renderer.info.render));
window.__dbgRenderStats = () => {
  renderer.info.reset();
  renderer.render(scene, camera);
  const s = JSON.parse(JSON.stringify(renderer.info.render));
  renderer.info.reset();
  return s;
};
window.__game = {
  setKey: (code, down) => player.setKey(code, down),
  setAzimuth: (a) => { player.camAz = a; player.lastDrag = player.t; },
  tp: (x, z) => { player.pos.x = x; player.pos.z = z; player.vel.set(0, 0); },
  start: () => { if (gameState === 'ATTRACT') startGame(); },
  state: () => gameState,
  mode: () => gameMode,
  crew: () => remotes.size + npcs.length + (player.enabled ? 1 : 0),
  npcs: () => npcs.map((n) => ({
    name: n.name, color: n.colorHex,
    x: +n.pos.x.toFixed(2), y: +n.pos.y.toFixed(2), z: +n.pos.z.toFixed(2),
  })),
  // manual loop driver for throttled headless rAF (same calls as frame())
  step: (dt = 0.05) => { if (gameState === 'PLAYING') { player.update(dt); updateNpcs(dt); } },
  local: () => player.enabled ? {
    x: player.pos.x, y: player.pos.y, z: player.pos.z,
    vx: player.vel.x, vz: player.vel.y, heading: player.heading,
  } : null,
  remoteBalls: () => [...remotes.values()].map((r) => ({
    x: r.pos.x, z: r.pos.z, name: r.ball.userData.name,
  })),
  netOnline: () => net.online,
  colliders: () => base.colliders,
  dbg: () => ({
    camAz: +player.camAz.toFixed(3), heading: +player.heading.toFixed(3),
    idleT: +((player.idleT || 0)).toFixed(2), sp: +player.vel.length().toFixed(2),
    state: gameState,
  }),
};
