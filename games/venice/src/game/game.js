// GONDOLIER — game: one-oar gondola physics, tide, wakes, collisions, fares.
import * as THREE from 'three';
import { makeGondola, BOAT_SCALE } from '../scene/gondola.js';
import { makePerson } from '../scene/person.js';
import { RemoteGondola, makeKimiPilot } from '../net.js';
import { makeRegattaItems } from './items.js';
import { DOCKS, BRIDGES, ROUTE_END } from '../scene/canal.js';
import { makeAIFleet } from './ai.js';

const LEG_NAMES = ['CA\' D\'ORO PIER', 'CAMPO S. MARIA', 'PONTE STORTO', 'RIO TERRÀ', 'SQUERO VECCHIO', 'ZATTERE ALBA'];
const MAX_FARES_LOST = 3;
const KISS_SPEED = 1.0;        // m/s max for a clean docking
const KISS_LATERAL = 0.7;
const KISS_ANGLE = Math.PI * 0.28;
const KISS_HOLD = 0.7;         // seconds of gentle contact to dock
const CRASH_SPEED = 0.95;      // m/s normal impact that costs a fare

export function makeGame(app) {
  const { world, camera, scene } = app;
  const canal = world.canal;

  // ---------- player boat ----------
  const boat = makeGondola(world.textures, { physical: true });
  boat.visible = false;
  scene.add(boat);

  // ---------- crew: KIMI at the oar + a low-poly passenger ----------
  // counter-scaled so they keep real-world size on the scaled-down boat
  const gondolier = makeKimiPilot('#2E7BF6');
  gondolier.root.position.set(0, 0.5, -0.2); // amidships — Kimi rides the boat's center
  gondolier.root.scale.setScalar(1 / BOAT_SCALE);
  boat.add(gondolier.root);
  // my bubble-shield visual
  const myBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  myBubble.visible = false;
  myBubble.scale.setScalar(1 / BOAT_SCALE);
  boat.add(myBubble);

  const passenger = makePerson('tourist');
  passenger.root.position.set(0, -0.05, 1.05);
  passenger.root.scale.setScalar(1 / BOAT_SCALE);
  passenger.root.visible = false;
  boat.add(passenger.root);
  const charsReady = Promise.resolve();

  // ---------- physics state ----------
  const S = {
    x: 0, z: 0, vx: 0, vz: 0, heading: 0, omega: 0,
    blockT: 0, shieldT: 0,   // item effects: input lockout / bubble shield
    mouseX: 0, mouseY: 0, sweepVel: 0, sweepRate: 0, stroking: false,
    w: false, a: false, s: false, d: false,
    polePhase: 0,
    speed: 0,
  };

  // ---------- run state ----------
  const R = {
    state: 'idle',        // idle | countdown | playing | gameover | complete
    leg: 0,               // current leg index 0..4 (dock i -> i+1)
    carrying: false,
    faresLost: 0,
    faresDelivered: 0,
    bumps: 0,
    startTime: 0,
    elapsed: 0,
    countdown: 0,
    kissTimer: 0,
    crashCooldown: 0,
    tideDir: 1,
    notice: null,         // {text, t, kind}
  };

  const camPos = new THREE.Vector3(0, 2, -8);
  const camLook = new THREE.Vector3();
  let camShake = 0;
  const listeners = {};
  function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
  function emit(ev, data) { (listeners[ev] || []).forEach((f) => f(data)); }

  function boardPassenger() {
    R.carrying = true;
    passenger.root.visible = true;
  }

  function reset() {
    const sm = canal.atS(DOCKS[0].s + 6);
    S.x = sm.x; S.z = sm.z; S.vx = S.vz = 0;
    S.heading = sm.ang; S.omega = 0;
    S.sweepRate = 0; S.stroking = false; S.polePhase = 0;
    R.leg = 0; R.carrying = true; R.faresLost = 0; R.faresDelivered = 0;
    R.bumps = 0; R.elapsed = 0; R.kissTimer = 0; R.crashCooldown = 0;
    R.tideDir = 1; R.notice = null;
    boardPassenger();
  }

  function startRun() {
    if (SP.on) { spStart(); return; } // solo regatta: restart vs the same 3 NPCs
    reset();
    boat.visible = true;
    R.state = 'countdown';
    R.countdown = 3.2;
    emit('countdown', 3);
    emit('state', R.state);
  }

  function endRun(kind) {
    R.state = kind; // 'gameover' | 'complete'
    emit('results', {
      kind,
      time: R.elapsed,
      fares: R.faresDelivered,
      lost: R.faresLost,
      bumps: R.bumps,
      legs: 5,
    });
    emit('state', R.state);
  }

  function notice(text, kind = 'info') {
    R.notice = { text, kind, t: 0 };
    emit('notice', R.notice);
  }

  // ---------- LAN multiplayer (moon-lobby handoff) ----------
  // Point-to-point regatta: everyone poles from the first pier to ZATTERE
  // ALBA; fares/docking are off, crashes just bounce. Thin relay — remote
  // gondolas are interpolated puppets; finish order settles on the server.
  const MP = { net: null, prof: null, slot: 0, remotes: new Map(), finishS: DOCKS[DOCKS.length - 1].s, results: null };

  function mpInit(net, prof) {
    MP.net = net;
    MP.prof = prof;
    gondolier.setColor('#' + (prof.color >>> 0).toString(16).padStart(6, '0'));
    world.remoteBoats = [];
    MP.items = makeRegattaItems({
      S, canal, scene, water: world.water, net,
      notice,
      myId: () => MP.net.id,
      remotes: () => MP.remotes,
      isOn: () => R.state === 'playing',
      leaderId: () => {
        const order = mpOrder();
        const top = order.find((o) => !o.isPlayer);
        const meFirst = order[0]?.isPlayer;
        if (meFirst && order.length > 1) return order[1].id ?? null;
        return top?.id ?? null;
      },
      // the boat directly ahead of me in the running order (for SWAP)
      aheadId: () => {
        const order = mpOrder();
        const meIdx = order.findIndex((o) => o.isPlayer);
        if (meIdx > 0) return order[meIdx - 1].id ?? null;
        return null;
      },
      setBubble: (on) => { myBubble.visible = on; },
      shake: (amt) => { camShake = Math.max(camShake, amt); },
      teleport: (x, z, heading) => {
        S.x = x; S.z = z; S.heading = heading;
        const sp = Math.hypot(S.vx, S.vz) * 0.4;
        S.vx = Math.sin(heading) * sp; S.vz = Math.cos(heading) * sp;
        S.omega = 0;
      },
    });
  }

  function mpSpawn() {
    const sm = canal.atS(DOCKS[0].s + 6 + Math.floor(MP.slot / 2) * 7);
    const lat = (MP.slot % 2 === 0 ? -1 : 1) * 1.6;
    S.x = sm.x + Math.cos(sm.ang) * lat;
    S.z = sm.z - Math.sin(sm.ang) * lat;
    S.vx = S.vz = 0; S.heading = sm.ang; S.omega = 0;
    R.leg = 0; R.carrying = false; R.faresLost = 0; R.faresDelivered = 0;
    R.bumps = 0; R.elapsed = 0; R.kissTimer = 0; R.crashCooldown = 0;
    passenger.root.visible = false;
    boat.visible = true;
    R.state = 'grid';
    emit('state', R.state);
    notice('ON THE WATER — WAITING FOR GONDOLIERS', 'dim');
  }

  function mpWelcome(msg) {
    const me = (msg.players || []).find((p) => p.id === MP.net.id);
    MP.slot = me ? me.slot : 0;
    mpRoster(msg.players || []);
    mpSpawn();
    if (msg.race?.phase === 'racing') {
      mpRaceStart({ startAt: msg.race.startAt, serverNow: msg.serverNow });
    }
  }

  function mpRoster(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      if (p.id === MP.net.id || MP.remotes.has(p.id)) continue;
      const rg = new RemoteGondola(scene, world.textures, p);
      MP.remotes.set(p.id, rg);
    }
    for (const [id, rg] of [...MP.remotes]) {
      if (!seen.has(id)) { rg.dispose(scene); MP.remotes.delete(id); }
    }
    world.remoteBoats = [...MP.remotes.values()].map((r) => r.boat);
  }

  function mpStates(msg) {
    for (const st of msg.arr || []) {
      const rg = MP.remotes.get(st.id);
      if (rg) rg.pushState(st.d, st.at ?? msg.now, st.lap, st.prog);
    }
  }

  function mpRaceStart(msg) {
    if (R.state !== 'grid') mpSpawn();
    const remain = Math.max(0.05, (msg.startAt - (msg.serverNow ?? Date.now())) / 1000);
    R.state = 'countdown';
    R.countdown = remain;
    R._lastCount = 99;
    emit('countdown', Math.min(3, Math.ceil(remain - 0.2)));
    emit('state', R.state);
  }

  function mpItem(msg) {
    if (!MP.items || msg.from === MP.net?.id) return;
    MP.items.onNet(msg);
  }

  function useItem() { (MP.items || SP.items)?.use(); }

  function mpFinishes(finishes, ended = false) {
    for (const f of finishes) {
      const rg = MP.remotes.get(f.id);
      if (rg) { rg.finished = true; rg.finishTime = f.time; }
    }
    MP.results = finishes;
    if (R.state === 'mpdone') renderMpResults();
  }

  function mpOrder() {
    const meProg = canal.nearestS(S.x, S.z).s;
    const me = { id: MP.net?.id, name: MP.prof.name, finished: R.state === 'mpdone', finishTime: MP.myTime ?? Infinity, prog: meProg, isPlayer: true };
    const rest = [...MP.remotes.values()].map((r) => ({
      id: r.info.id, name: r.info.name, finished: r.finished, finishTime: r.finishTime ?? Infinity, prog: r.prog, isPlayer: false,
    }));
    return [me, ...rest].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
  }

  function renderMpResults() {
    let el = document.getElementById('mp-results');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mp-results';
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:80;' +
        'min-width:360px;padding:26px 34px;text-align:center;background:rgba(6,11,20,.85);' +
        'border:1px solid rgba(114,173,247,.35);border-radius:10px;font-family:"Geist Mono",ui-monospace,monospace;' +
        'color:#eef5fc;text-transform:uppercase;';
      document.body.appendChild(el);
    }
    const order = fieldOrder();
    const rows = order.map((r, i) =>
      `<div style="display:flex;gap:14px;padding:7px 0;font-size:13px;letter-spacing:.12em;` +
      `border-bottom:1px solid rgba(114,173,247,.14);${r.isPlayer ? 'color:#fff;font-weight:600;' : 'color:rgba(226,238,250,.75);'}">` +
      `<span style="width:22px;color:rgba(226,238,250,.4)">${i + 1}</span><b style="flex:1;text-align:left">${r.name}</b>` +
      `<i style="font-style:normal;color:#9fc7f7">${r.finished && r.finishTime !== Infinity ? r.finishTime.toFixed(1) + 'S' : '—'}</i></div>`).join('');
    const back = new URLSearchParams(location.search).get('back');
    el.innerHTML = `<h2 style="margin:0 0 14px;font-size:12px;font-weight:500;letter-spacing:.4em;color:#72adf7">REGATTA · RESULTS</h2>` +
      rows +
      (back ? `<a href="${back}" style="display:inline-block;margin-top:16px;padding:9px 20px;border:1px solid rgba(114,173,247,.45);` +
        `border-radius:4px;color:#eef5fc;text-decoration:none;font-size:10px;letter-spacing:.24em">← BACK TO THE MOON</a>` : '');
  }

  function mpFinishCheck() {
    if (!MP.net || R.state !== 'playing') return;
    const s = canal.nearestS(S.x, S.z).s;
    if (s >= MP.finishS) {
      MP.myTime = R.elapsed;
      MP.net.sendFinish(R.elapsed);
      R.state = 'mpdone';
      emit('state', R.state);
      notice('FINISH!', 'good');
      setTimeout(renderMpResults, 900);
    }
  }

  // ---------- solo regatta (moon-lobby ?solo=1 handoff) ----------
  // Same point-to-point regatta as the LAN mode, but the other three boats are
  // local AI drivers (src/game/ai.js) instead of relay puppets. No socket.
  const SP = { on: false, prof: null, fleet: null, bots: [], items: null, myTime: null, teleport: null };

  function spOrder() {
    const meProg = canal.nearestS(S.x, S.z).s;
    const me = { id: 'me', name: SP.prof.name, finished: R.state === 'mpdone', finishTime: SP.myTime ?? Infinity, prog: meProg, isPlayer: true };
    const rest = SP.bots.map((b) => ({
      id: b.id, name: b.name, finished: b.finished, finishTime: b.finishTime, prog: b.s, isPlayer: false,
    }));
    return [me, ...rest].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
  }

  function fieldOrder() { return SP.on ? spOrder() : mpOrder(); }

  // the victim side of the player's pranks, applied to the bots locally
  function spDispatch(msg) {
    switch (msg.sub) {
      case 'wave': {
        const fx = Math.sin(S.heading), fz = Math.cos(S.heading);
        for (const b of SP.bots) {
          const dx = b.x - S.x, dz = b.z - S.z;
          const d = Math.hypot(dx, dz);
          if (d < 40 && (dx * fx + dz * fz) / (d || 1) > 0.5) b.hitWave(fx, fz);
        }
        break;
      }
      case 'anchor': SP.bots.find((b) => b.id === msg.targetId)?.hitAnchor(); break;
      case 'swap': {
        const b = SP.bots.find((x) => x.id === msg.targetId);
        if (b) {
          const bx = b.x, bz = b.z, bh = b.heading;
          b.teleport(msg.x, msg.z, msg.heading);
          SP.teleport(bx, bz, bh);
        }
        break;
      }
      // splash/shield/fx are screen- or net-side effects — nothing local to apply
    }
  }

  function spInit({ name, color, npcs }) {
    SP.on = true;
    SP.prof = { name, color };
    gondolier.setColor('#' + (color >>> 0).toString(16).padStart(6, '0'));
    SP.fleet = makeAIFleet({ canal, scene, world, npcs, finishS: MP.finishS, player: S });
    SP.bots = SP.fleet.bots;
    world.remoteBoats = SP.bots.map((b) => b.boat); // the player bumps into bots
    SP.teleport = (x, z, heading) => {
      S.x = x; S.z = z; S.heading = heading;
      const sp = Math.hypot(S.vx, S.vz) * 0.4;
      S.vx = Math.sin(heading) * sp; S.vz = Math.cos(heading) * sp;
      S.omega = 0;
    };
    // a loopback "net": items use it to reach their victims, here the local bots
    const soloNet = { id: 'me', sendItem: (payload) => spDispatch(payload) };
    SP.items = makeRegattaItems({
      S, canal, scene, water: world.water, net: soloNet,
      notice,
      myId: () => 'me',
      remotes: () => new Map(),
      isOn: () => R.state === 'playing',
      leaderId: () => {
        const order = spOrder();
        const meFirst = order[0]?.isPlayer;
        if (meFirst && order.length > 1) return order[1].id ?? null;
        return order.find((o) => !o.isPlayer)?.id ?? null;
      },
      aheadId: () => {
        const order = spOrder();
        const meIdx = order.findIndex((o) => o.isPlayer);
        if (meIdx > 0) return order[meIdx - 1].id ?? null;
        return null;
      },
      setBubble: (on) => { myBubble.visible = on; },
      shake: (amt) => { camShake = Math.max(camShake, amt); },
      teleport: SP.teleport,
      bots: () => SP.bots, // whirlpool traps catch bots too (see items.js)
    });
  }

  function spStart() {
    if (!SP.on) return;
    document.getElementById('mp-results')?.remove();
    SP.myTime = null;
    // grid slot 0 (front-left), bots staggered behind like the relay assigns
    const sm = canal.atS(DOCKS[0].s + 6);
    S.x = sm.x + Math.cos(sm.ang) * -1.6;
    S.z = sm.z - Math.sin(sm.ang) * -1.6;
    S.vx = S.vz = 0; S.heading = sm.ang; S.omega = 0;
    S.blockT = 0; S.shieldT = 0;
    R.leg = 0; R.carrying = false; R.faresLost = 0; R.faresDelivered = 0;
    R.bumps = 0; R.elapsed = 0; R.kissTimer = 0; R.crashCooldown = 0;
    passenger.root.visible = false;
    boat.visible = true;
    SP.fleet.spawn();
    R.state = 'countdown';
    R.countdown = 3.2;
    R._lastCount = 99;
    emit('countdown', 3);
    emit('state', R.state);
  }

  function spFinishCheck() {
    if (!SP.on || R.state !== 'playing') return;
    const s = canal.nearestS(S.x, S.z).s;
    if (s >= MP.finishS) {
      SP.myTime = R.elapsed;
      R.state = 'mpdone';
      emit('state', R.state);
      notice('FINISH!', 'good');
      setTimeout(renderMpResults, 900);
    }
  }

  function spQuit() {
    if (!SP.on) return;
    SP.fleet?.setVisible(false);
    document.getElementById('mp-results')?.remove();
  }

  function spBoats() {
    return SP.bots.map((b) => ({
      name: b.name,
      color: '#' + b.color.toString(16).padStart(6, '0'),
      x: +b.x.toFixed(2), z: +b.z.toFixed(2), s: +b.s.toFixed(1),
      finished: b.finished,
      finishTime: b.finishTime === Infinity ? null : +b.finishTime.toFixed(2),
    }));
  }

  // ---------- input (fed by UI/main) ----------
  // absolute mouse x for the oar angle; motion is fed per-event for frame-independent thrust
  function setMouse(nx, ny) { S.mouseX = nx; S.mouseY = ny; }
  function strokeMotion(v) { // signed normalized sweep velocity (per second)
    S.sweepVel = THREE.MathUtils.lerp(S.sweepVel, v, 0.6);
  }
  function setKey(k, down) {
    if (k === 'w') S.w = down;
    if (k === 's') S.s = down;
    if (k === 'a') S.a = down;
    if (k === 'd') S.d = down;
  }
  function shove() {
    if (R.state !== 'playing') return;
    const w = canal.wallsAt(S.x, S.z);
    const side = w.left.dist < w.right.dist ? w.left : w.right;
    if (side.dist > 3.0) { notice('NOTHING TO SHOVE', 'dim'); return; }
    S.vx += side.nx * 3.4;
    S.vz += side.nz * 3.4;
    S.omega += (side === w.left ? -1 : 1) * 0.9;
    world.water.addWake(S.x, S.z, 1.0);
    notice('SHOVE!', 'dim');
  }

  // ---------- wake events from NPC boats ----------
  let seenWakes = 0;
  const wakeBus = world.wakeBus || (world.wakeBus = []);
  function processWakes() {
    for (; seenWakes < wakeBus.length; seenWakes++) {
      const wk = wakeBus[seenWakes];
      wk.hitPlayer = false;
    }
    for (const wk of wakeBus) {
      if (wk.hitPlayer) continue;
      const age = (performance.now() / 1000) - wk.t;
      const front = age * 2.6;
      const d = Math.hypot(S.x - wk.x, S.z - wk.z);
      if (Math.abs(d - front) < 1.2 && front > 2 && front < 26) {
        wk.hitPlayer = true;
        const nx = (S.x - wk.x) / (d || 1), nz = (S.z - wk.z) / (d || 1);
        const mag = wk.strength * 1.1;
        S.vx += nx * mag; S.vz += nz * mag;
        S.omega += (nx * Math.cos(S.heading) - nz * Math.sin(S.heading)) * 0.4;
        notice('WAKE!', 'dim');
      }
    }
  }

  // ---------- collision with walls + bridge piers + other boats ----------
  const HULL_F = 3.8 * BOAT_SCALE + 0.4;  // bow/stern probe distance
  const HULL_S = 0.7 * BOAT_SCALE;        // side probe distance
  function collide(dt) {
    if (R.crashCooldown > 0) R.crashCooldown -= dt;
    const pts = [
      [S.x, S.z],
      [S.x + Math.sin(S.heading) * HULL_F, S.z + Math.cos(S.heading) * HULL_F],   // bow
      [S.x - Math.sin(S.heading) * HULL_F, S.z - Math.cos(S.heading) * HULL_F],   // stern
      [S.x + Math.cos(S.heading) * HULL_S, S.z - Math.sin(S.heading) * HULL_S],
      [S.x - Math.cos(S.heading) * HULL_S, S.z + Math.sin(S.heading) * HULL_S],
    ];
    let crashed = false, hitSpeed = 0, crashCause = 'wall';
    for (const [px, pz] of pts) {
      const w = canal.wallsAt(px, pz);
      for (const side of [w.left, w.right]) {
        let limit = 0.55;
        // bridge pier intrusion
        for (const br of BRIDGES) {
          const sm = canal.nearestS(px, pz);
          if (Math.abs(sm.s - br.s) < br.thick / 2 + 1.2) limit += br.pier;
        }
        if (side.dist < limit) {
          const pen = limit - side.dist;
          // push the whole boat out
          S.x += side.nx * pen;
          S.z += side.nz * pen;
          const vn = S.vx * side.nx + S.vz * side.nz;
          if (vn < 0) {
            const impact = -vn;
            S.vx -= (1.35) * vn * side.nx;
            S.vz -= (1.35) * vn * side.nz;
            S.omega += (Math.random() - 0.5) * impact * 0.6;
            if (impact > hitSpeed) hitSpeed = impact;
            if (impact > CRASH_SPEED && R.crashCooldown <= 0 && R.state === 'playing') {
              crashed = true;
            } else if (impact > 0.3) {
              R.bumps++;
            }
          }
        }
      }
    }
    // --- other boats (NPC + moored): capsule along their centerline
    const others = [world.npcBoat, ...(world.moored || []), ...(world.remoteBoats || [])];
    for (const ob of others) {
      if (!ob) continue;
      const bx = ob.position.x, bz = ob.position.z;
      const h = ob.rotation.y;
      const fx = Math.sin(h), fz = Math.cos(h);
      const dx = S.x - bx, dz = S.z - bz;
      const along = THREE.MathUtils.clamp(dx * fx + dz * fz, -4.0 * BOAT_SCALE, 4.0 * BOAT_SCALE);
      const px = bx + fx * along, pz = bz + fz * along;
      let nx = S.x - px, nz = S.z - pz;
      const d = Math.hypot(nx, nz) || 1e-4;
      const limit = 0.85 + HULL_S;
      if (d < limit) {
        nx /= d; nz /= d;
        S.x += nx * (limit - d);
        S.z += nz * (limit - d);
        const vn = S.vx * nx + S.vz * nz;
        if (vn < 0) {
          const impact = -vn;
          S.vx -= 1.3 * vn * nx;
          S.vz -= 1.3 * vn * nz;
          S.omega += (Math.random() - 0.5) * impact * 0.5;
          world.water.addWake(px, pz, 0.8);
          if (impact > hitSpeed) hitSpeed = impact;
          if (impact > CRASH_SPEED && R.crashCooldown <= 0 && R.state === 'playing') {
            crashed = true;
            crashCause = 'boat';
          } else if (impact > 0.3) {
            R.bumps++;
          }
        }
      }
    }
    if (crashed) {
      R.crashCooldown = 2.5;
      R.bumps++;
      world.water.addWake(S.x, S.z, 1.2);
      if (MP.net) {
        notice('SCRAPE!', 'bad');
      } else if (R.carrying) {
        R.carrying = false;
        R.faresLost++;
        passenger.root.visible = false;
        notice(crashCause === 'boat' ? 'FARE LOST — MIND THE TRAFFIC' : 'FARE LOST — MIND THE PLASTER', 'bad');
        emit('farelost', R.faresLost);
        if (R.faresLost >= MAX_FARES_LOST) { endRun('gameover'); return; }
      } else {
        notice('SCRAPE!', 'bad');
      }
      emit('crash', hitSpeed);
    }
  }

  // ---------- tide ----------
  function tideAccel(dt) {
    const sm = canal.nearestS(S.x, S.z);
    const targetDir = sm.s < 300 ? 1 : -1;
    if (targetDir !== R.tideDir) {
      R.tideDir = targetDir;
      notice('THE TIDE TURNS', 'dim');
      emit('tide', targetDir);
    }
    const tx = Math.sin(sm.sample.ang) * targetDir, tz = Math.cos(sm.sample.ang) * targetDir;
    const mag = 0.42;
    const cvx = tx * mag, cvz = tz * mag;
    S.vx += (cvx - S.vx) * 0.28 * dt;
    S.vz += (cvz - S.vz) * 0.28 * dt;
    return sm.s;
  }

  // ---------- oar physics ----------
  function stroke(dt) {
    if (S.blockT > 0) return; // item effect: oar's out of your hands
    let thrust = 0, yaw = 0;
    // --- keyboard: W forward, S back-pole, A/D steer
    // (camera looks +Z, so world +X is screen-left: A -> heading+, D -> heading-)
    if (S.w) thrust += 8.0;
    if (S.s) thrust -= 3.5;
    const rudder = 0.35 + 0.65 * Math.min(1, S.speed / 1.5);
    if (S.a) yaw += 2.4 * rudder;
    if (S.d) yaw -= 2.4 * rudder;
    // --- mouse sweep (analog alternative)
    const rate = S.sweepVel;
    S.sweepVel *= Math.exp(-2.6 * dt);
    S.sweepRate = THREE.MathUtils.lerp(S.sweepRate, Math.abs(rate), 0.25);
    const power = THREE.MathUtils.clamp(Math.abs(rate) * 1.15 - 0.25, 0, 4.2);
    if (power > 0.02) {
      const dir = rate < 0 ? 1 : -1; // sweep left = power stroke, right = recovery
      thrust += power * (dir > 0 ? 5.5 : 1.7);
      yaw += power * (dir > 0 ? 0.95 : -0.55); // oar on starboard: power stroke yaws bow left
    }
    if (thrust !== 0 || yaw !== 0) {
      const fx = Math.sin(S.heading), fz = Math.cos(S.heading);
      S.vx += fx * thrust * dt;
      S.vz += fz * thrust * dt;
      S.omega += yaw * dt;
      S.omega = THREE.MathUtils.clamp(S.omega, -1.3, 1.3);
      if (thrust > 1 && Math.random() < thrust * dt * 0.18) {
        world.water.addWake(
          S.x - Math.cos(S.heading) * 1.2 - fx * 2,
          S.z + Math.sin(S.heading) * 1.2 - fz * 2,
          0.35,
        );
      }
    }
    if (S.s) { // back-pole drags the blade: extra braking
      const drag = Math.min(1, 3.5 * dt);
      S.vx *= 1 - drag; S.vz *= 1 - drag;
      S.omega *= 1 - Math.min(1, 2.5 * dt);
    }
    // animation gating with hysteresis
    if (!S.stroking && (S.sweepRate > 1.0 || S.w)) S.stroking = true;
    else if (S.stroking && S.sweepRate < 0.35 && !S.w) S.stroking = false;
  }

  // ---------- integration ----------
  function integrate(dt) {
    // drag: linear + quadratic
    const sp = Math.hypot(S.vx, S.vz);
    const dragF = 0.5 * sp + 0.22 * sp * sp;
    if (sp > 1e-4) {
      S.vx -= (S.vx / sp) * dragF * dt;
      S.vz -= (S.vz / sp) * dragF * dt;
    }
    // weathervane: heading drifts toward velocity
    if (sp > 0.4) {
      const vang = Math.atan2(S.vx, S.vz);
      let d = vang - S.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      S.omega += d * Math.min(1, sp * 0.5) * dt;
    }
    S.omega *= Math.exp(-2.4 * dt);
    S.heading += S.omega * dt;
    S.x += S.vx * dt;
    S.z += S.vz * dt;
    S.speed = Math.hypot(S.vx, S.vz);
  }

  // ---------- docking ----------
  function dockLogic(dt, s) {
    const target = DOCKS[R.leg + 1];
    if (!target) return;
    const sm = canal.atS(target.s);
    const nx = Math.cos(sm.ang) * target.side, nz = -Math.sin(sm.ang) * target.side;
    // dock center: at the wall, jutting out dock.depth/2
    const dcx = sm.x + nx * (sm.width / 2 - target.depth / 2);
    const dcz = sm.z + nz * (sm.width / 2 - target.depth / 2);
    const along = (S.x - dcx) * Math.sin(sm.ang) + (S.z - dcz) * Math.cos(sm.ang);
    const across = (S.x - dcx) * nx + (S.z - dcz) * nz;
    const inZone = Math.abs(along) < target.size + 1.2 && Math.abs(across) < target.depth * 0.75 + 0.9;
    // heading parallel to wall?
    let dAng = Math.abs(S.heading - sm.ang);
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    dAng = Math.abs(dAng);
    const parallel = dAng < KISS_ANGLE || dAng > Math.PI - KISS_ANGLE;
    const latVel = Math.abs(S.vx * nx + S.vz * nz);
    if (inZone && S.speed < KISS_SPEED && latVel < KISS_LATERAL && parallel) {
      R.kissTimer += dt;
      if (R.kissTimer >= KISS_HOLD) {
        // docked!
        R.faresDelivered += R.carrying ? 1 : 0;
        emit('docked', { leg: R.leg, delivered: R.carrying });
        R.leg++;
        if (R.leg >= DOCKS.length - 1) { endRun('complete'); return; }
        boardPassenger();
        R.kissTimer = 0;
        notice('KISSED THE DOCK — NEXT FARE', 'good');
      }
    } else {
      R.kissTimer = Math.max(0, R.kissTimer - dt * 2);
    }
    return { target, sm, dcx, dcz, inZone, dist: Math.hypot(S.x - dcx, S.z - dcz) };
  }

  // ---------- camera ----------
  function updateCamera(dt) {
    const fx = Math.sin(S.heading), fz = Math.cos(S.heading);
    const w = canal.wallsAt(S.x, S.z);
    const wallNear = Math.min(w.left.dist, w.right.dist);
    const lift = THREE.MathUtils.clamp(2.2 - wallNear, 0, 1.4);
    const dist = 7.2 - lift * 1.2;
    const targetPos = new THREE.Vector3(
      S.x - fx * dist,
      1.95 + lift + S.speed * 0.12,
      S.z - fz * dist,
    );
    // keep the camera inside the canal: shove it off nearby walls
    for (let iter = 0; iter < 2; iter++) {
      const cw = canal.wallsAt(targetPos.x, targetPos.z);
      for (const side of [cw.left, cw.right]) {
        if (side.dist < 1.0) {
          targetPos.x += side.nx * (1.0 - side.dist);
          targetPos.z += side.nz * (1.0 - side.dist);
          targetPos.y += (1.0 - side.dist) * 0.8;
        }
      }
    }
    // swap-teleports move the boat across the canal in one frame — snap, don't sweep
    if (camPos.distanceTo(targetPos) > 25) {
      camPos.copy(targetPos);
      camLook.set(S.x + fx * 5, 1.15, S.z + fz * 5);
    } else {
      camPos.lerp(targetPos, 1 - Math.exp(-3.2 * dt));
      camLook.lerp(new THREE.Vector3(S.x + fx * 5, 1.15, S.z + fz * 5), 1 - Math.exp(-4 * dt));
    }
    camera.position.copy(camPos);
    if (camShake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * camShake * 0.35;
      camera.position.y += (Math.random() - 0.5) * camShake * 0.22;
      camera.position.z += (Math.random() - 0.5) * camShake * 0.35;
      camShake *= Math.exp(-3.5 * dt);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
  }

  // ---------- visuals sync ----------
  function syncVisuals(dt) {
    boat.position.set(S.x, Math.sin(performance.now() * 0.001) * 0.02, S.z);
    boat.rotation.y = S.heading;
    boat.rotation.z = THREE.MathUtils.lerp(boat.rotation.z, -S.omega * 0.25 - (S.vx * Math.cos(S.heading) - S.vz * Math.sin(S.heading)) * 0.05, 0.1);
    boat.rotation.x = THREE.MathUtils.lerp(boat.rotation.x, S.speed * 0.012, 0.05);
    // oar: sweeps with the pole cycle / mouse, angles like a rudder on A/D
    const oar = boat.userData.oar;
    if (oar) {
      let targetY = 0.5; // rest: blade starboard-aft
      if (S.stroking && S.w) targetY = 0.5 + Math.sin(S.polePhase * Math.PI * 2) * 0.45;
      else if (S.stroking) targetY = 0.5 + S.mouseX * 0.8;
      let targetZ = S.a ? -0.28 : (S.d ? 0.28 : 0);
      oar.rotation.y = THREE.MathUtils.lerp(oar.rotation.y, targetY, 0.2);
      oar.rotation.z = THREE.MathUtils.lerp(oar.rotation.z, targetZ, 0.12);
      oar.rotation.x = THREE.MathUtils.lerp(oar.rotation.x, S.s ? 0.25 : 0, 0.1);
    }
    // gondolier pose
    const steer = (S.a ? 1 : 0) + (S.d ? -1 : 0);
    if (S.stroking) {
      let phase, intensity;
      if (S.w) {
        S.polePhase = (S.polePhase + dt * 0.85) % 1;
        phase = S.polePhase;
        intensity = 1;
      } else {
        phase = THREE.MathUtils.clamp(0.5 - S.mouseX * 0.5, 0.05, 0.95);
        intensity = Math.min(1, S.sweepRate / 3);
      }
      gondolier.update(dt, { mode: 'pole', phase, intensity, steer });
    } else {
      gondolier.update(dt, { mode: 'idle', steer: steer * 0.5 });
    }
    if (passenger.root.visible) passenger.update(dt, { mode: 'sit' });
    // mist thickens under bridges
    let underBridge = false;
    const sm = canal.nearestS(S.x, S.z);
    for (const br of BRIDGES) if (Math.abs(sm.s - br.s) < br.thick + 4) underBridge = true;
    world.mist.setDensity((app.quality?.mist ?? 1) * (underBridge ? 1.9 : 1.0));
  }

  // ---------- main update ----------
  function update(dt, t) {
    // remote puppets ride the relay timeline
    if (MP.net) {
      const serverNow = MP.net.serverTime();
      for (const rg of MP.remotes.values()) rg.update(serverNow, dt);
      if (R.state === 'playing' || R.state === 'mpdone') {
        MP.net.maybeSendState(S, canal.nearestS(S.x, S.z).s);
      }
      if (S.blockT > 0) S.blockT -= dt;
      MP.items?.update(dt);
    }
    // solo regatta: local AI boats instead of relay puppets
    if (SP.on) {
      if (S.blockT > 0) S.blockT -= dt;
      SP.items?.update(dt);
      const racing = R.state === 'playing' || R.state === 'mpdone';
      SP.fleet?.update(dt, racing);
    }
    if (R.state === 'grid') {
      // parked at the pier: bob in place until the shared start
      S.vx *= 0.9; S.vz *= 0.9; S.omega *= 0.9;
      integrate(dt);
      updateCamera(dt);
      syncVisuals(dt);
      return;
    }
    if (R.state === 'mpdone') {
      // drifting past the finish while the field comes home
      stroke(dt); integrate(dt); collide(dt);
      updateCamera(dt); syncVisuals(dt);
      return;
    }
    if (R.state === 'countdown') {
      R.countdown -= dt;
      const n = Math.ceil(R.countdown - 0.2);
      if (n !== R._lastCount && n >= 1) { R._lastCount = n; emit('countdown', n); }
      if (R.countdown <= 0) {
        R.state = 'playing';
        R.startTime = t;
        emit('go');
        emit('state', R.state);
        if (MP.net || SP.on) notice('ROW!', 'good');
      }
      updateCamera(dt);
      syncVisuals(dt);
      return;
    }
    if (R.state !== 'playing') {
      updateCamera(dt);
      syncVisuals(dt);
      return;
    }
    if (!R.startTime && MP.net) R.startTime = t;
    R.elapsed = t - R.startTime;
    stroke(dt);
    const s = tideAccel(dt);
    integrate(dt);
    collide(dt);
    processWakes();
    const inRegatta = MP.net || SP.on;
    const dockInfo = inRegatta ? null : dockLogic(dt, s);
    if (MP.net) mpFinishCheck();
    else if (SP.on) spFinishCheck();
    updateCamera(dt);
    syncVisuals(dt);
    const order = inRegatta ? fieldOrder() : null;
    emit('hud', {
      time: R.elapsed,
      speed: S.speed,
      leg: R.leg,
      legs: DOCKS.length - 1,
      carrying: R.carrying,
      faresLost: R.faresLost,
      maxLost: MAX_FARES_LOST,
      tideDir: R.tideDir,
      progress: canal.nearestS(S.x, S.z).s / (inRegatta ? MP.finishS : ROUTE_END),
      mpOrder: order ? order.findIndex((r) => r.isPlayer) + 1 : null,
      mpTotal: order ? (MP.net ? MP.remotes.size + 1 : SP.bots.length + 1) : null,
      kiss: R.kissTimer / KISS_HOLD,
      dockDist: dockInfo?.dist ?? null,
      legName: LEG_NAMES[Math.min(R.leg + 1, LEG_NAMES.length - 1)],
    });
  }

  return {
    S, R, boat,
    on, emit,
    startRun, endRun, reset,
    setMouse, strokeMotion, setKey, shove,
    update,
    get ready() { return charsReady; },
    notice,
    mpInit, mpWelcome, mpRoster, mpStates, mpRaceStart, mpFinishes, mpItem, useItem,
    MP,
    spInit, spStart, spQuit, spBoats,
    SP,
  };
}
