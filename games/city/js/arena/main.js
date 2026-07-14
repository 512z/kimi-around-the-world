// SKY STRIKE — multiplayer dogfight over the GRIDLOCK rain canyon.
// The scene modules (engine/city/sky/life) are used as-is; the canyon repeats
// every 480 m (periodic chunk seeds) so the arena is a seamless loop that all
// players share. Thin-relay multiplayer: clients own their sim, shots are
// broadcast, the VICTIM adjudicates hits on itself.
import * as THREE from 'three';
import { Engine } from '../engine.js';
import { loadAssets } from '../assets.js';
import { makeSky, makeEnvironment } from '../sky.js';
import { City } from '../city.js';
import { Life, GlowPool } from '../life.js';
import { WORLD, PLAYER, QUALITY_PRESETS } from '../config.js';
import { clamp, damp, smoothstep, GlobalUniforms, FogUniforms } from '../utils.js';
import { Net, RemoteShip } from './net.js';
import { buildShip, poseShip, stepShip, feedHeroLights, SHIP_RADIUS } from './ship.js';
import { Combat } from './combat.js';
import { ArenaItems } from './items.js';
import { ArenaBots } from './bots.js';

const LOOP = WORLD.chunkLen * WORLD.loopChunks; // 480 m
const Z_HOME = -160;                            // loop window: (Z_HOME - LOOP, Z_HOME]
const MATCH_MS = 180000;                        // 3-minute dogfight
const STUN_S = 2.0;                             // one hit = 2 s of dead controls
const STUN_GRACE_S = 1.2;                       // can't be re-hit right after recovering
const RESPAWN_S = 2.6;
const INVULN_S = 2.0;

const params = new URLSearchParams(location.search);
const MY_NAME = (params.get('name') || 'Kimi').slice(0, 12);
const MY_COLOR = parseInt(params.get('color') || '2a6fe6', 16);
const BACK_URL = params.get('back') || '';

// Moon-lobby single-player handoff: ?solo=1&npcs=NAME:hex,NAME:hex,NAME:hex —
// no relay, no menu, 3 AI pilots join the dogfight straight from the countdown.
const NPCS = (() => {
  const out = [];
  for (const ent of (params.get('npcs') || '').split(',')) {
    const m = /^([^:]{1,12}):([0-9a-fA-F]{6})$/.exec(ent.trim());
    if (!m) return [];
    out.push({ name: m[1], color: parseInt(m[2], 16) });
  }
  return out.length === 3 ? out : [];
})();
const SOLO = params.get('solo') === '1' && NPCS.length === 3;

// Solo-mode stub: answers the Net interface without opening a WebSocket. Item
// uses loop back locally so bots can adjudicate them on themselves (shots are
// purely local bolt objects in solo and never loop back).
class NullNet {
  constructor() { this.id = 0; this.connected = false; this.handlers = {}; }
  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, data) { this.handlers[evt]?.(data); }
  connect() { return Promise.resolve(); }
  serverTime() { return Date.now(); }
  join() {}
  sendItem(payload) {
    if (payload.sub === 'shot') return;
    queueMicrotask(() => this.emit('item', { from: this.id, ...payload }));
  }
  maybeSendState() {}
}

const dzLoop = (z, ref) => {
  let d = (z - ref) % LOOP;
  if (d > LOOP / 2) d -= LOOP;
  if (d < -LOOP / 2) d += LOOP;
  return d;
};

// ------------------------------------------------------------------ sfx ----
const sfx = (() => {
  let ctx = null;
  const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  const env = (dur, gain = 0.05) => {
    const g = ac().createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    g.connect(ctx.destination);
    return g;
  };
  const tone = (freq, type, dur, gain, slide = 0) => {
    try {
      const o = ac().createOscillator();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
      o.connect(env(dur, gain));
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    } catch { /* audio unavailable */ }
  };
  return {
    shot: () => { tone(920, 'sawtooth', 0.09, 0.028, -600); tone(1840, 'square', 0.05, 0.012, -900); },
    clang: () => tone(2600, 'triangle', 0.07, 0.03, -1400),
    hurt: () => { tone(160, 'sawtooth', 0.22, 0.06, -70); tone(70, 'sine', 0.3, 0.07); },
    boom: () => { tone(90, 'sawtooth', 0.65, 0.09, -55); tone(46, 'sine', 0.8, 0.1, -18); },
    kill: () => { tone(660, 'square', 0.09, 0.04); setTimeout(() => tone(990, 'square', 0.12, 0.04), 90); },
    tick: () => tone(1320, 'sine', 0.07, 0.045),
    go: () => { tone(880, 'square', 0.1, 0.05); setTimeout(() => tone(1320, 'square', 0.16, 0.05), 100); },
  };
})();

// ------------------------------------------------------------------ boot ---
export async function boot(rootEl) {
  const $ = id => document.getElementById(id);
  const hud = $('hud'), fade = $('fade');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  rootEl.appendChild(canvas);

  const engine = new Engine(canvas);
  engine.applyQuality(QUALITY_PRESETS.BALANCED);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.35, 3600);
  camera.position.set(0, 30, Z_HOME + 30);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0x1d2a40, 0x100c14, 1.1));
  const key = new THREE.DirectionalLight(0x8fb4d8, 0.5);
  key.position.set(-40, 90, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xff3d7f, 0.22);
  fill.position.set(50, 30, -60);
  scene.add(fill);
  scene.add(makeSky());
  scene.environment = makeEnvironment(engine.renderer);

  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  window.addEventListener('resize', onResize);
  onResize();

  fade.textContent = 'C Y B E R   S P A C E S H I P';
  await loadAssets((p) => { fade.textContent = `LOADING ${Math.round(p * 100)}%`; });
  fade.textContent = 'C Y B E R   S P A C E S H I P';

  const city = new City(scene);
  const life = new Life(scene, city);
  life.applyQuality(QUALITY_PRESETS.BALANCED);
  const glows = new GlowPool(scene, 200);
  city.groundMat.uniforms.tRefl.value = engine.reflRT.texture;

  // ---------------------------------------------------------- local state --
  const P = {
    pos: new THREE.Vector3(0, PLAYER.startY, Z_HOME),
    vel: new THREE.Vector3(0, 0, -PLAYER.cruise),
    speed: PLAYER.cruise,
    speedHold: PLAYER.cruise,
    heat: 0, overheated: 0, burnCd: 0, boosting: false, bank: 0,
    alive: true, respawnT: 0, invulnT: 0,
    stunT: 0, stunSpin: 0, stunGraceT: 0,
    itemShieldT: 0, dashUntil: 0,
  };
  let mode = 'connecting'; // connecting | hold | countdown | playing | over
  let mySlot = 0;

  // Everyone launches from the same start line: a grid formation keyed by the
  // relay-assigned slot, applied when the shared raceStart arrives.
  function formationPos(slot) {
    const col = slot % 5, row = Math.floor(slot / 5);
    return new THREE.Vector3((col - 2) * 8, PLAYER.startY, Z_HOME - row * 14);
  }
  function parkAtFormation() {
    P.pos.copy(formationPos(mySlot));
    P.vel.set(0, 0, 0);
    P.speed = 0;
    P.speedHold = PLAYER.cruise;
    P.bank = 0;
    P.heat = 0; P.overheated = 0;
    P.stunT = 0; P.stunGraceT = 0;
  }
  let matchStartAt = 0, matchEndAt = 0;
  let shake = 0;
  const sparks = [];
  const scoreboard = new Map(); // id -> {kills, deaths}
  const names = new Map();      // id -> {name, color}
  const board = id => { if (!scoreboard.has(id)) scoreboard.set(id, { kills: 0, deaths: 0 }); return scoreboard.get(id); };

  const myShip = buildShip({ color: MY_COLOR, name: MY_NAME, showTag: false });
  myShip.group.position.copy(P.pos);
  scene.add(myShip.group);

  // ------------------------------------------------------------- network ---
  const net = SOLO ? new NullNet() : new Net();
  const remotes = new Map(); // id -> RemoteShip
  let bots = null;           // solo-mode AI pilots (null in multiplayer)

  // One hit = systems offline for STUN_S — the ship tumbles uncontrolled,
  // then control returns (no HP, no death from bolts). Shared by bolts and
  // offensive items; the item shield eats one incoming hit first.
  function hitMe(fromId) {
    if (!P.alive || mode !== 'playing') return;
    if (P.stunT > 0 || P.stunGraceT > 0 || P.invulnT > 0) return;
    if (items && items.tryBlock()) return;
    P.stunT = STUN_S;
    P.stunSpin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
    shake = Math.min(1.2, shake + 0.7);
    engine.params.flash = Math.max(engine.params.flash, 0.35);
    sfx.hurt();
    board(fromId).kills++;
    board(net.id).deaths++;
    net.sendItem({ sub: 'stunned', by: fromId });
    feed(nameOf(fromId), nameOf(net.id));
    explodeAt(P.pos, 18);
    showCenter('SYSTEMS OFFLINE', false, STUN_S * 1000);
    updateScore();
  }

  const combat = new Combat({
    scene, glows, net, remotes, dzLoop,
    getMyPos: () => (P.alive ? P.pos : null),
    sfx,
    onSelfHit: (fromId) => hitMe(fromId),
  });

  const items = new ArenaItems({
    scene, glows, net, dzLoop,
    zHome: Z_HOME, loop: LOOP, P,
    remotes: () => remotes,
    myId: () => net.id,
    leaderId: () => {
      // EMP seeks the HITS leader among the other pilots
      let best = null, bestK = -1;
      for (const id of remotes.keys()) {
        const k = board(id).kills;
        if (k > bestK) { bestK = k; best = id; }
      }
      if (bots) for (const id of bots.aliveIds()) {
        const k = board(id).kills;
        if (k > bestK) { bestK = k; best = id; }
      }
      return best;
    },
    applyHit: (byId) => hitMe(byId),
    showMsg: (text, ms = 1200) => showCenter(text, false, ms),
    sfx,
    isOn: () => mode === 'playing' && P.alive,
  });

  const colorOf = (c) => Number.isInteger(c) ? c : (parseInt(String(c).replace('#', ''), 16) || 0xe0403a);
  function ensureRemote(info) {
    if (info.id === net.id || remotes.has(info.id)) return;
    const rs = new RemoteShip(info);
    rs.ship = buildShip({ color: colorOf(info.color), name: info.name, showTag: true });
    scene.add(rs.ship.group);
    remotes.set(info.id, rs);
    names.set(info.id, { name: info.name, color: info.color });
    board(info.id);
  }
  function dropRemote(id) {
    const rs = remotes.get(id);
    if (rs?.ship) scene.remove(rs.ship.group);
    remotes.delete(id);
  }

  net.on('welcome', (msg) => {
    names.set(net.id, { name: MY_NAME, color: MY_COLOR.toString(16) });
    board(net.id);
    mySlot = (msg.players || []).find(p => p.id === net.id)?.slot ?? 0;
    (msg.players || []).forEach(ensureRemote);
    if (msg.race?.phase === 'racing') {
      // joined mid-match — drop straight onto the line
      matchStartAt = msg.race.startAt;
      matchEndAt = matchStartAt + MATCH_MS;
      parkAtFormation();
      mode = Date.now() + net.clockOffset < matchStartAt ? 'countdown' : 'playing';
      if (mode === 'playing') { P.vel.set(0, 0, -PLAYER.cruise); P.speed = PLAYER.cruise; }
    } else {
      mode = 'hold';
      parkAtFormation();
      showCenter('WAITING FOR PILOTS…', true);
    }
  });
  net.on('roster', (players) => {
    const seen = new Set(players.map(p => p.id));
    players.forEach(ensureRemote);
    for (const id of [...remotes.keys()]) if (!seen.has(id)) dropRemote(id);
  });
  net.on('states', (msg) => {
    for (const s of msg.arr || []) {
      const rs = remotes.get(s.id);
      if (rs) rs.pushState(s.d, s.at ?? msg.now);
    }
  });
  net.on('full', () => showCenter('ARENA FULL (8 MAX)', true));
  net.on('raceStart', (msg) => {
    matchStartAt = msg.startAt;
    matchEndAt = matchStartAt + MATCH_MS;
    parkAtFormation(); // every client lines up on the same start line
    mode = 'countdown';
  });
  net.on('item', (msg) => {
    if (bots) bots.onNetItem(msg); // solo: bots adjudicate my shock/EMP on themselves
    if (msg.from === net.id) return;
    if (msg.sub === 'shot') combat.onNetShot(msg);
    else if (['shock', 'emp', 'shieldOn', 'shieldPop'].includes(msg.sub)) items.onNet(msg);
    else if (msg.sub === 'stunned') {
      // msg.from = victim, msg.by = shooter
      board(msg.from).deaths++;
      if (msg.by >= 0) board(msg.by).kills++;
      if (msg.by === net.id) { sfx.kill(); showCenter('HIT!', false, 900); }
      feed(nameOf(msg.by), nameOf(msg.from));
      const rs = remotes.get(msg.from);
      if (rs?.ship) explodeAt(rs.ship.group.position, 18);
      updateScore();
    } else if (msg.sub === 'die') {
      // msg.from = victim crashed into the grid
      board(msg.from).deaths++;
      feed(nameOf(-1), nameOf(msg.from));
      const rs = remotes.get(msg.from);
      if (rs?.ship) explodeAt(rs.ship.group.position);
      updateScore();
    }
  });

  if (!SOLO) {
    try {
      await net.connect();
      net.join(MY_NAME, MY_COLOR, params.get('auto') === '1');
    } catch {
      showCenter('CONNECTION FAILED — PLEASE REFRESH', true);
    }
  }

  // --------------------------------------------------------------- input ---
  const keys = new Set();
  const mouse = { x: 0, y: 0 };
  let firing = false, burnQueued = false;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { burnQueued = true; e.preventDefault(); }
    if (e.code === 'KeyJ') firing = true;
    if (e.code === 'KeyE') items.use();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyJ') firing = false; });
  window.addEventListener('mousemove', (e) => {
    mouse.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
    mouse.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
  });
  window.addEventListener('mousedown', () => { firing = true; });
  window.addEventListener('mouseup', () => { firing = false; });
  window.addEventListener('blur', () => { keys.clear(); firing = false; });

  // ----------------------------------------------------------------- hud ---
  const centerEl = $('center-msg'), timerEl = $('timer'), killsEl = $('kills'),
    hpFill = $('hp-fill'), heatFill = $('heat-fill'), speedEl = $('speed'),
    feedEl = $('feed'), resultsEl = $('results'), whoEl = $('who');
  whoEl.textContent = MY_NAME.toUpperCase();
  let centerTimer = 0;
  function showCenter(text, sticky = false, ms = 1400) {
    centerEl.textContent = text;
    centerEl.style.opacity = '1';
    clearTimeout(centerTimer);
    if (!sticky) centerTimer = setTimeout(() => { centerEl.style.opacity = '0'; }, ms);
  }
  const nameOf = id => id === -1 ? 'THE GRID' : (names.get(id)?.name || `P${id}`).toUpperCase();
  function feed(killer, victim) {
    const row = document.createElement('div');
    row.textContent = `${killer} ▸ ${victim}`;
    feedEl.prepend(row);
    while (feedEl.children.length > 4) feedEl.lastChild.remove();
    setTimeout(() => { row.style.opacity = '0'; setTimeout(() => row.remove(), 600); }, 4200);
  }
  // top bar doubles as the stun-recovery meter: full cyan when in control,
  // draining red while systems are offline
  function updateStunBar() {
    if (P.stunT > 0) {
      hpFill.style.width = `${(P.stunT / STUN_S) * 100}%`;
      hpFill.style.background = '#ff5470';
    } else {
      hpFill.style.width = '100%';
      hpFill.style.background = '#53d5fd';
    }
  }
  function updateScore() { killsEl.textContent = `HITS ${board(net.id).kills}`; }
  updateStunBar(); updateScore();

  // ------------------------------------------------------------ lifecycle --
  // crashing into the grid is the only way to blow up — bolts just stun
  function die() {
    if (!P.alive) return;
    P.alive = false;
    P.respawnT = RESPAWN_S;
    P.stunT = 0;
    board(net.id).deaths++;
    net.sendItem({ sub: 'die' });
    feed(nameOf(-1), nameOf(net.id));
    explodeAt(P.pos);
    engine.params.flash = 0.6;
    shake = 1.6;
    sfx.boom();
    myShip.group.visible = false;
    showCenter('HIT THE GRID', false, 1800);
    updateScore();
  }

  function respawn() {
    P.alive = true;
    P.invulnT = INVULN_S;
    P.pos.set((Math.random() - 0.5) * 24, PLAYER.startY, P.pos.z);
    P.vel.set(0, 0, -PLAYER.cruise);
    P.speed = P.speedHold = PLAYER.cruise;
    P.heat = 0; P.overheated = 0; P.bank = 0;
    myShip.group.visible = true;
  }

  function explodeAt(p, n = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const sp = 5 + Math.random() * 24;
      sparks.push({
        p: p.clone(),
        v: new THREE.Vector3(Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 5, Math.sin(a) * Math.cos(b) * sp),
        life: 0.5 + Math.random() * 1.0, t: 0, hot: Math.random(),
      });
    }
  }

  let resultsShown = false;
  function showResults() {
    resultsShown = true;
    const rows = [...scoreboard.entries()]
      .map(([id, s]) => ({ id, name: nameOf(id), ...s }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    resultsEl.innerHTML = '<h2>CYBER SPACESHIP · RESULTS</h2>' + rows.map((r, i) =>
      `<div class="rrow${r.id === net.id ? ' me' : ''}"><span>${i + 1}</span><b>${r.name}</b><i>${r.kills} HITS · DOWN ${r.deaths}</i></div>`,
    ).join('') + (BACK_URL ? `<a class="rback" href="${BACK_URL}">← BACK TO THE LUNAR LOBBY</a>` : '');
    resultsEl.style.display = 'block';
  }

  // ------------------------------------------------------------ main loop --
  let last = performance.now();
  let lastCamZWrap = 0;
  let lastTickShown = -1;
  const _lastCamPos = new THREE.Vector3().copy(camera.position);
  const camVel = new THREE.Vector3();

  hud.style.opacity = '1';
  fade.style.opacity = '0';
  setTimeout(() => { fade.style.display = 'none'; }, 2700);

  if (BACK_URL) {
    const a = document.createElement('a');
    a.id = 'back-to-moon';
    a.href = BACK_URL;
    a.textContent = '← BACK TO THE MOON';
    document.body.appendChild(a);
  }

  // ---------------------------------------------------------- solo mode ----
  // ?solo=1&npcs=…: no relay was ever opened — line up on the same start line
  // as the LAN flow, with 3 AI pilots from the lobby contract joining on the
  // same physics, combat and scoring paths as remote humans.
  if (SOLO) {
    names.set(net.id, { name: MY_NAME, color: MY_COLOR.toString(16) });
    board(net.id);
    bots = new ArenaBots({
      scene, city, combat, glows, sfx, dzLoop, loop: LOOP, zHome: Z_HOME,
      formationPos, playerP: P, getMode: () => mode,
      board, myId: () => net.id, nameOf, feed, explodeAt, showCenter, updateScore,
      STUN_S, STUN_GRACE_S, RESPAWN_S, INVULN_S,
    }, NPCS);
    for (const b of bots.bots) names.set(b.id, { name: b.name, color: b.color.toString(16) });
    matchStartAt = Date.now() + 4200; // short local countdown, then ENGAGE
    matchEndAt = matchStartAt + MATCH_MS;
    parkAtFormation();
    mode = 'countdown';
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = engine.time;
    GlobalUniforms.uTime.value = time;
    const serverNow = net.serverTime();

    // ---- mode transitions
    if (mode === 'countdown') {
      const remain = matchStartAt - serverNow;
      const c = Math.ceil(remain / 1000);
      if (remain <= 0) { mode = 'playing'; showCenter('ENGAGE', false, 1000); sfx.go(); }
      else if (c !== lastTickShown) { lastTickShown = c; showCenter(`ENGAGE IN ${c}`, true); sfx.tick(); }
    }
    if (mode === 'playing' && serverNow >= matchEndAt && !resultsShown) {
      mode = 'over';
      showCenter('TIME', false, 1600);
      sfx.boom();
      setTimeout(showResults, 1200);
    }

    // ---- local ship
    const playing = mode === 'playing';
    const parked = mode === 'connecting' || mode === 'hold' || mode === 'countdown';
    if (P.alive && !playing && !parked) {
      // match over: cruise straight while the results are up
      stepShip(P, dt, { keys: new Set(), mx: 0, my: 0, burn: false });
      if (P.pos.z < Z_HOME - LOOP) { P.pos.z += LOOP; camera.position.z += LOOP; _lastCamPos.z += LOOP; }
      myShip.group.position.copy(P.pos);
      poseShip(myShip, P.vel.x, P.vel.y, P.speed, P.bank, dt);
      feedHeroLights(P, myShip.accent);
    } else if (P.alive && parked) {
      // parked on the start line: hover in formation, no forward motion —
      // everyone leaves the same line when ENGAGE hits
      burnQueued = false;
      const home = formationPos(mySlot);
      P.pos.x = damp(P.pos.x, home.x, 4, dt);
      P.pos.z = damp(P.pos.z, home.z, 4, dt);
      P.pos.y = home.y + Math.sin(time * 1.7 + mySlot) * 0.5;
      P.vel.set(0, 0, 0);
      P.speed = damp(P.speed, 0, 3, dt);
      P.bank = damp(P.bank, 0, 4, dt);
      myShip.group.position.copy(P.pos);
      poseShip(myShip, 0, 0, PLAYER.minSpeed, P.bank, dt); // idle thruster shimmer
      feedHeroLights(P, myShip.accent);
    } else if (P.alive) {
      const stunned = P.stunT > 0;
      if (stunned) {
        // systems offline: controls dead, the ship coasts and tumbles
        P.stunT -= dt;
        P.vel.x = damp(P.vel.x, 0, 1.2, dt);
        P.vel.y = damp(P.vel.y, -6, 1.5, dt); // sags out of the sky
        P.speed = damp(P.speed, PLAYER.minSpeed * 0.5, 1.4, dt);
        P.vel.z = -P.speed;
        P.pos.addScaledVector(P.vel, dt);
        if (P.pos.y < 2.0) { P.pos.y = 2.0; P.vel.y = 0; }
        P.bank += P.stunSpin * dt; // uncontrolled roll
        for (let i = 0; i < 2; i++) {
          glows.push(P.pos.x + (Math.random() - 0.5), P.pos.y + 0.3, P.pos.z + Math.random(), 2.6, 1.0, 0.3, 0.7, 0);
        }
        if (P.stunT <= 0) {
          P.stunGraceT = STUN_GRACE_S;
          P.bank = P.bank % (Math.PI * 2);
          showCenter('SYSTEMS ONLINE', false, 800);
        }
        updateStunBar();
      }
      if (P.stunGraceT > 0) P.stunGraceT -= dt;
      const input = stunned
        ? { keys: new Set(), mx: 0, my: 0, burn: false }
        : { keys, mx: mouse.x, my: mouse.y, burn: burnQueued };
      burnQueued = false;
      if (!stunned) {
        if (P.speed < PLAYER.minSpeed) P.speed = Math.max(P.speed, PLAYER.minSpeed * 0.6); // spool up off the line
        stepShip(P, dt, input);
        if (hpFill.style.width !== '100%') updateStunBar();
      }

      // seamless loop wrap (the city repeats every LOOP meters)
      if (P.pos.z < Z_HOME - LOOP) {
        P.pos.z += LOOP;
        camera.position.z += LOOP;
        _lastCamPos.z += LOOP;
        for (const s of sparks) s.p.z += LOOP;
      }

      // obstacle crash → explode + respawn (deathmatch, not run-over)
      if (playing && P.invulnT <= 0) {
        for (const o of city.obstaclesNear(P.pos.z - 60, P.pos.z + 30)) {
          if (o.isHolo) continue;
          const dx = Math.max(o.min.x - P.pos.x, 0, P.pos.x - o.max.x);
          const dy = Math.max(o.min.y - P.pos.y, 0, P.pos.y - o.max.y);
          const dz = Math.max(o.min.z - P.pos.z, 0, P.pos.z - o.max.z);
          if (Math.hypot(dx, dy, dz) - PLAYER.radius <= 0) { die(); break; }
        }
      }

      if (P.alive) {
        // street skim: sparks + shake, not death
        if (P.pos.y < 2.0) {
          P.pos.y = 2.0;
          P.vel.y = Math.max(P.vel.y, 0);
          shake = Math.max(shake, 0.25);
        }
        myShip.group.position.copy(P.pos);
        poseShip(myShip, P.vel.x, P.vel.y, P.speed, P.bank, dt);
        // invulnerability shimmer after respawn
        if (P.invulnT > 0) {
          P.invulnT -= dt;
          myShip.group.visible = Math.sin(time * 30) > -0.6;
          if (P.invulnT <= 0) myShip.group.visible = true;
        }
        if (playing && firing) combat.tryFire(P, dt);
        else combat.fireCd = Math.min(combat.fireCd, 0.05);
        feedHeroLights(P, myShip.accent);
      }
    } else {
      P.respawnT -= dt;
      if (P.respawnT <= 0 && mode !== 'over') respawn();
    }

    // ---- remotes (rendered on MY loop window)
    for (const rs of remotes.values()) {
      rs.update(serverNow);
      if (!rs.ship) continue;
      const g = rs.ship.group;
      g.position.z = P.pos.z + dzLoop(g.position.z, P.pos.z);
      poseShip(rs.ship, rs.vx, rs.vy, rs.speed, rs.bank, dt);
      if (rs.ship.tag) rs.ship.tag.material.opacity = clamp(2.0 - Math.abs(dzLoop(g.position.z, P.pos.z)) / 260, 0, 1);
    }

    // ---- bots (solo mode): AI pilots on the same physics/combat paths
    if (bots) bots.update(dt, time);

    // ---- combat + sparks
    glows.begin();
    items.update(dt);
    combat.update(dt, P.invulnT > 0 || P.stunT > 0 || P.stunGraceT > 0 || !P.alive || !playing);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      if (s.t > s.life) { sparks.splice(i, 1); continue; }
      s.v.y -= 22 * dt;
      s.p.addScaledVector(s.v, dt);
      const k = 1 - s.t / s.life;
      const col = s.hot > 0.6 ? [3.4, 2.2, 0.6] : [3.0, 0.8, 0.3];
      glows.push(s.p.x, s.p.y, s.p.z, col[0] * k, col[1] * k, col[2] * k, 0.5 + k * 0.5, 0);
    }
    glows.end();

    // ---- camera: chase (alive) or wreck orbit (dead)
    if (P.alive) {
      const back = 8.6 + P.speed * 0.022;
      const tp = new THREE.Vector3(
        P.pos.x * 0.92 - P.vel.x * 0.055,
        Math.max(P.pos.y + 2.9 - P.vel.y * 0.03, 2.2),
        P.pos.z + back,
      );
      const look = new THREE.Vector3(P.pos.x + P.vel.x * 0.22, P.pos.y + P.vel.y * 0.16 - 0.4, P.pos.z - 17);
      if (camera.position.distanceTo(tp) > 100) camera.position.copy(tp);
      else {
        camera.position.x = damp(camera.position.x, tp.x, 7.5, dt);
        camera.position.y = damp(camera.position.y, tp.y, 7.5, dt);
        camera.position.z = damp(camera.position.z, tp.z, 14, dt);
      }
      const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), P.bank * 0.5));
      camera.quaternion.slerp(q, 1 - Math.exp(-9 * dt));
      const speedN = clamp((P.speed - PLAYER.minSpeed) / (PLAYER.boostSpeed - PLAYER.minSpeed), 0, 1);
      camera.fov = damp(camera.fov, 62 + speedN * 12 + (P.boosting ? 5 : 0), 4, dt);
    } else {
      const t = time * 0.4 + 2.2;
      const c = P.pos;
      const pos = new THREE.Vector3(c.x + Math.cos(t) * 12, Math.max(c.y + 4, 6), c.z + 10 + Math.sin(t) * 5);
      camera.position.lerp(pos, 1 - Math.exp(-2.2 * dt));
      camera.lookAt(c.x, c.y, c.z);
    }
    if (shake > 0.003) {
      camera.rotation.x += (Math.random() - 0.5) * shake * 0.012;
      camera.rotation.y += (Math.random() - 0.5) * shake * 0.012;
      camera.rotation.z += (Math.random() - 0.5) * shake * 0.017;
    }
    shake = Math.max(0, shake - dt * 3.2);
    camera.updateProjectionMatrix();

    // ---- world systems
    const camZ = camera.position.z;
    city.update(camZ, time);
    camVel.copy(camera.position).sub(_lastCamPos).divideScalar(Math.max(dt, 1e-4));
    if (camVel.length() > 400) camVel.set(0, 0, -P.speed); // wrap frame
    _lastCamPos.copy(camera.position);
    life.update(dt, time, camZ, camera.position, camVel, playing);

    engine.params.warp = damp(engine.params.warp, P.boosting && playing ? 1 : 0, 4, dt);
    engine.params.flash = Math.max(0, engine.params.flash - dt * 2.6);
    engine.params.rain = damp(engine.params.rain, 0.55, 1.2, dt);
    FogUniforms.uFogDensity.value = 0.0027;

    // ---- net send + HUD
    if (net.connected && mode !== 'connecting') net.maybeSendState(P);
    if (playing || mode === 'over') {
      const remain = Math.max(0, matchEndAt - serverNow);
      const mm = Math.floor(remain / 60000), ss = Math.floor((remain % 60000) / 1000);
      timerEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    }
    speedEl.textContent = `${Math.round(P.speed * 3.6)} KM/H`;
    heatFill.style.width = `${P.heat}%`;
    heatFill.style.background = P.overheated > 0 ? '#ff5470' : '#53d5fd';

    // ---- render
    engine.renderReflection(scene, camera);
    city.groundMat.uniforms.uMirrorVP.value.copy(engine.mirrorVP);
    engine.render(scene, camera, dt);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }
  requestAnimationFrame(loop);

  // debug/test surface
  window.__arena = {
    get P() { return P; }, get mode() { return mode; },
    net, remotes, combat, scoreboard,
    get myShip() { return myShip; },
    LOOP, dzLoop,
    solo: SOLO,
    bots: () => (bots ? bots.list() : []),
    step: (now) => frame(now), // headless tests: drive frames manually if rAF stalls
  };
}
