// SELENE GP — race state machine: attract → grid countdown → race → results.

import * as THREE from 'three';
import { CarSim, makeCarMesh, makeNameTag, LIVERIES } from './car.js';
import { AIController } from './ai.js';
import { Dust } from './dust.js';
import { ItemField, makeShieldMesh } from './items.js';
import { ChaseCam, CinematicCam } from './cameras.js';
import { RemoteCar } from './net.js';
import { clamp, clamp01, angleWrap } from './util.js';

const LAPS = 3;
const N_CARS = 8;
const N_CP = 12;
const FIXED = 1 / 120;

export class Game {
  constructor(env) {
    this.env = env;                 // { scene, camera, terrain, track, audio, menu }
    this.state = 'attract';
    this.clock = 0;
    this.bestLap = null;
    this.cars = [];
    this.player = null;
    this.acc = 0;
    this.countdownT = 0;
    this.standingsT = 0;
    this.order = [];
    this.autopilot = env.autopilot || false;
    // LAN multiplayer (moon-lobby handoff): mp = { net, prof } while online.
    // Humans only — the AI grid stays home; remote cars are puppets.
    this.mp = null;
    // Single-player lobby handoff: solo = { name, color, npcs[3] } — a 4-car
    // grid (3 named NPC opponents + the local player), no network at all.
    this.solo = null;
    this.remotes = new Map(); // id -> RemoteCar
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.wrongWayT = 0;
    this.noticeT = 0;
    this.minimapTrack = null;
    this.finishDelay = 0;

    this.dust = new Dust(env.scene);
    env.dust = this.dust;
    this.items = new ItemField(env);
    this.chase = new ChaseCam(env.camera);
    this.cine = new CinematicCam(env.camera, env.track, env.terrain);
    env.track.makeCheckpoints(N_CP);

    this._buildMinimapTrack();
    this._spawnAttractGrid();
  }

  // ---- setup -------------------------------------------------------------
  _liverySet() {
    return LIVERIES.slice(0, N_CARS);
  }

  _spawnAttractGrid() {
    this._clearCars();
    const liv = this._liverySet();
    // two packs of four so the cinematic camera always has traffic to frame
    const packGap = 26;
    for (let i = 0; i < N_CARS; i++) {
      const mesh = makeCarMesh(liv[i], false);
      this.env.scene.add(mesh);
      this.env.markBloom?.(mesh);
      const sim = new CarSim(mesh, { name: liv[i].name, color: liv[i].color });
      sim.shieldMesh = makeShieldMesh();
      mesh.add(sim.shieldMesh);
      const pack = i < 4 ? 0 : 0.5;
      const s = (pack + 0.002) * this.env.track.length + (i % 4) * packGap;
      const f = this.env.track.frameAt(s % this.env.track.length);
      sim.placeAt(f, s % this.env.track.length, this.env.terrain);
      sim.totalDist = s % this.env.track.length;
      sim.ai = new AIController(sim, { skill: 0.9 + (i % 4) * 0.035, boldness: 0.9 + (i % 3) * 0.05 });
      const tag = makeNameTag(liv[i].name, liv[i].color);
      mesh.add(tag);
      sim.tag = tag;
      this.cars.push(sim);
    }
    this.player = this.cars[0];
  }

  _clearCars() {
    for (const c of this.cars) this.env.scene.remove(c.mesh);
    this.cars = [];
  }

  _spawnRaceGrid() {
    this._clearCars();
    // solo handoff: the lobby's 3 NPCs + the local player; else the 8-car AI grid
    const liv = this.solo
      ? [...this.solo.npcs, { name: this.solo.name, color: this.solo.color }]
      : this._liverySet();
    const n = liv.length;
    const L = this.env.track.length;
    for (let i = 0; i < n; i++) {
      const isPlayer = i === n - 1; // player starts at the back
      const l = liv[i];
      const mesh = makeCarMesh(l, isPlayer);
      this.env.scene.add(mesh);
      this.env.markBloom?.(mesh);
      const sim = new CarSim(mesh, { name: isPlayer && !this.solo ? 'YOU' : l.name, color: l.color, isPlayer });
      sim.shieldMesh = makeShieldMesh();
      mesh.add(sim.shieldMesh);
      const row = Math.floor(i / 2), col = i % 2;
      const s = L - 16 - row * 7.5;
      const f = this.env.track.frameAt(s);
      const lat = col === 0 ? -4.2 : 4.2;
      sim.placeAt({ ...f, x: f.x + f.rx * lat, z: f.z + f.rz * lat }, s, this.env.terrain);
      sim.totalDist = s - L;
      sim.disabled = true;
      sim.ai = new AIController(sim, { skill: 0.92 + (i * 0.013), boldness: 0.92 + ((i * 7) % 5) * 0.035 });
      if (!isPlayer) {
        const tag = makeNameTag(l.name, l.color);
        mesh.add(tag);
        sim.tag = tag;
      }
      this.cars.push(sim);
      if (isPlayer) this.player = sim;
    }
    this.chase.snap(this.player, this.env.terrain);
  }

  _buildMinimapTrack() {
    const pts = [];
    const step = Math.floor(this.env.track.count / 220);
    for (let i = 0; i < this.env.track.count; i += step) {
      pts.push([this.env.track.samples.px[i], this.env.track.samples.pz[i]]);
    }
    this.minimapTrack = pts;
  }

  // ---- public API (called from main / menu hooks) ------------------------
  // Single-player handoff from the moon lobby: race the 3 NPCs that followed
  // the player from the plaza. The roster stays on `this.solo`, so menu
  // restarts (RACE AGAIN / RESTART RACE) rerun the same lineup. No network.
  startSoloRace(prof) {
    this.solo = prof;
    this.startRace();
  }

  startRace() {
    this.env.audio.ensure();
    this.env.audio.duck(false);
    this._spawnRaceGrid();
    this.items.reset();
    this._usePrev = false;
    this.state = 'countdown';
    this.countdownT = 3.9;
    this.clock = 0;
    this.bestLap = null;
    this.finishDelay = 0;
    for (const c of this.cars) {
      c.lap = 0; c.lapTimes = []; c.cpIndex = 0; c.finished = false; c.boost = 0.62;
      c.lapStart = 0; c.item = null; c.shieldT = 0; c.turboT = 0; c.stunT = 0;
    }
    this.env.menu.showScreen('none');
    this.env.menu.updateHud({ visible: true, speedKmh: 0, lap: 0, lapsTotal: LAPS, position: this.cars.length, total: this.cars.length, clock: 0, bestLap: null, boost: 0.62, raceProgress: 0, drift: false, item: null, standings: [] });
  }

  pause() {
    if (this.mp) return; // shared race clock — no local pause
    if (this.state !== 'race' && this.state !== 'countdown') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.env.audio.duck(true);
    this.env.menu.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState || 'race';
    this.env.audio.duck(false);
    this.env.menu.showScreen('none');
  }

  quitToMenu() {
    this.state = 'attract';
    this.env.audio.duck(true);
    this.env.menu.updateHud({ visible: false });
    this._spawnAttractGrid();
    this.env.menu.showScreen('main');
  }

  resetPlayer() {
    if (this.state !== 'race') return;
    this.player.resetToTrack(this.env);
    this.player.disabled = false;
  }

  // ---- LAN multiplayer -----------------------------------------------------
  mpInit(net, prof) {
    this.mp = { net, prof, slot: 0, started: false };
    this.items.mpHooks = { net, playerSim: null };
  }

  _mpHex() { return '#' + (this.mp.prof.color >>> 0).toString(16).padStart(6, '0'); }

  // my car alone on the grid, placed by relay slot (two-wide rows like solo)
  _spawnMpCar() {
    this._clearCars();
    const L = this.env.track.length;
    const slot = this.mp.slot;
    const mesh = makeCarMesh({ name: this.mp.prof.name, color: this._mpHex() }, true);
    this.env.scene.add(mesh);
    this.env.markBloom?.(mesh);
    const sim = new CarSim(mesh, { name: this.mp.prof.name, color: this.mp.prof.color, isPlayer: true });
    sim.shieldMesh = makeShieldMesh();
    mesh.add(sim.shieldMesh);
    const row = Math.floor(slot / 2), col = slot % 2;
    const gs = L - 16 - row * 7.5;
    const f = this.env.track.frameAt(gs);
    const lat = col === 0 ? -4.2 : 4.2;
    sim.placeAt({ ...f, x: f.x + f.rx * lat, z: f.z + f.rz * lat }, gs, this.env.terrain);
    sim.totalDist = gs - L;
    sim.disabled = true;
    sim.netId = this.mp.net.id;
    this.cars = [sim];
    this.player = sim;
    this.items.mpHooks.playerSim = sim;
    this.chase.snap(sim, this.env.terrain);
  }

  mpWelcome(msg) {
    const me = (msg.players || []).find((p) => p.id === this.mp.net.id);
    this.mp.slot = me ? me.slot : 0;
    this.mpRoster(msg.players || []);
    this._spawnMpCar();
    this.items.reset();
    this.state = 'grid';
    this.env.menu.showScreen('none');
    this.env.menu.showNotice('ON THE GRID — WAITING FOR PLAYERS', 3200);
    this.env.menu.updateHud({ visible: true, speedKmh: 0, lap: 0, lapsTotal: LAPS, position: 1, total: this.remotes.size + 1, clock: 0, bestLap: null, boost: 0.62, raceProgress: 0, drift: false, item: null, standings: [] });
    if (msg.race?.phase === 'racing') {
      // joined mid-race (or mid-countdown): sync to the shared start
      this.mpRaceStart({ startAt: msg.race.startAt, serverNow: msg.serverNow });
    }
  }

  mpRoster(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      if (p.id === this.mp.net.id || this.remotes.has(p.id)) continue;
      this.remotes.set(p.id, new RemoteCar(this.env.scene, p, this.env.markBloom));
    }
    for (const [id, rc] of [...this.remotes]) {
      if (!seen.has(id)) { rc.dispose(this.env.scene); this.remotes.delete(id); }
    }
  }

  mpStates(msg) {
    for (const st of msg.arr || []) {
      const rc = this.remotes.get(st.id);
      if (rc) rc.pushState(st.d, st.at ?? msg.now, st.lap, st.prog);
    }
  }

  mpRaceStart(msg) {
    this.env.audio.ensure();
    this.env.audio.duck(false);
    if (this.state !== 'grid') this._spawnMpCar();
    this.items.reset();
    this._usePrev = false;
    const remainMs = msg.startAt - (msg.serverNow ?? Date.now());
    this.state = 'countdown';
    this.countdownT = Math.max(0.05, remainMs / 1000);
    this._cdSyncAt = performance.now() + remainMs; // shared GO instant
    this.clock = 0;
    this.bestLap = null;
    this.finishDelay = 0;
    const c = this.player;
    c.lap = 0; c.lapTimes = []; c.cpIndex = 0; c.finished = false; c.boost = 0.62;
    c.lapStart = 0; c.item = null; c.shieldT = 0; c.turboT = 0; c.stunT = 0;
    this.mp.started = true;
    this.env.menu.showScreen('none');
  }

  mpItem(msg) {
    if (msg.from === this.mp?.net.id) return;
    const resolver = (id) => id === this.mp.net.id ? this.player : this.remotes.get(id);
    if (msg.sub === 'use') this.items.applyRemoteUse(msg, msg.from, resolver);
    else if (msg.sub === 'peelGone') this.items.removePeelNear(msg.x, msg.z);
    else if (msg.sub === 'rocketBoom') this.items.detonateRocketNear(msg.x, msg.z);
    else if (msg.sub === 'shieldPop') {
      const rc = this.remotes.get(msg.from);
      if (rc) rc.shieldT = 0;
    }
  }

  // cars the item field sees in MP: my sim + the remote puppets (rocket
  // targets / peel victims — cosmetically; each victim adjudicates itself)
  _itemCars() { return [this.player, ...this.remotes.values()]; }

  mpFinishes(finishes, ended = false) {
    for (const f of finishes) {
      const rc = this.remotes.get(f.id);
      if (rc) { rc.finished = true; rc.finishTime = f.time; }
    }
    this.mp.lastFinishes = finishes;
    if (this.state === 'results' || (ended && this.player?.finished)) this._showResults();
  }

  _mpOrder() {
    const all = [this.player, ...this.remotes.values()];
    return all.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalDist - a.totalDist;
    });
  }

  // ---- per-frame update ----------------------------------------------------
  update(dt) {
    if (this.state === 'attract') {
      this._simStep(dt, true);
      this.cine.update(dt, this._nearestToCamera());
    } else if (this.state === 'grid') {
      // multiplayer grid hold: idle flames, chase cam, wait for raceStart
      this.player.throttleViz = 0.05 + 0.03 * Math.sin(performance.now() * 0.01);
      this.chase.update(dt, this.player, this.env.terrain);
    } else if (this.state === 'countdown') {
      this._updateCountdown(dt);
    } else if (this.state === 'race') {
      this._raceStep(dt);
    } else if (this.state === 'results') {
      this._simStep(dt * 0.35, true); // slow-motion victory roll
      this.cine.update(dt, this.player);
    }
    // remote puppets interpolate on the relay timeline
    if (this.mp) {
      const serverNow = this.mp.net.serverTime();
      const L = this.env.track.length;
      for (const rc of this.remotes.values()) {
        rc.update(serverNow, dt);
        rc.s = ((rc.prog % L) + L) % L;
      }
      if (this.player && this.mp.started && !['attract'].includes(this.state)) {
        this.mp.net.maybeSendState(this.player, this.player.lap, this.player.totalDist);
      }
    }
    // sync meshes always
    const t = performance.now() / 1000;
    for (const c of this.cars) {
      c.syncMesh(dt, t);
      this.dust.emitFromCar(c, dt, this.env.terrain);
      if (c.tag && this.state !== 'attract') {
        const d = c.mesh.position.distanceTo(this.env.camera.position);
        c.tag.material.opacity = c === this.player ? 0 : clamp01(1 - (d - 110) / 340) * 0.95;
      } else if (c.tag) {
        c.tag.material.opacity = 0;
      }
    }
    this.dust.update(dt, this.env.terrain);
    // boost pad flash decay
    for (const pad of this.env.track.chevrons) {
      if (pad.mesh && pad.mesh.material.opacity > 0.95) {
        pad.mesh.material.opacity = Math.max(0.95, pad.mesh.material.opacity - dt * 1.2);
      }
    }
    // power-up field (pickups only while racing)
    this.items.allowAiUse = (car) => !car.isPlayer || this.autopilot;
    this.items.update(
      dt,
      this.mp ? this._itemCars() : this.cars,
      (car) => this.order.indexOf(car) + 1,
      this.state === 'race',
    );
  }

  _nearestToCamera() {
    // attract camera anchors on the pack leader for stable framing
    let best = null, bd = -Infinity;
    for (const c of this.cars) {
      if (c.totalDist > bd) { bd = c.totalDist; best = c; }
    }
    return best;
  }

  _updateCountdown(dt) {
    const prev = Math.ceil(this.countdownT);
    this.countdownT -= dt;
    const now = Math.ceil(this.countdownT);
    if (now !== prev) {
      if (now >= 1 && now <= 3) { this.env.menu.showCountdown(String(now)); this.env.audio.countdown(now); }
      else if (now === 0) { this.env.menu.showCountdown('GO'); this.env.audio.countdown(0); }
    }
    // keep cars idling on the grid
    for (const c of this.cars) {
      c.throttleViz = 0.05 + 0.03 * Math.sin(performance.now() * 0.01 + c.pos.x);
    }
    if (this.countdownT <= -0.55) {
      this.env.menu.showCountdown(null);
      for (const c of this.cars) { c.disabled = false; c.lapStart = 0; }
      this.state = 'race';
      this.clock = 0;
    }
    this.chase.update(dt, this.player, this.env.terrain);
  }

  _raceStep(dt) {
    this.clock += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 6) {
      this._physicsSubstep(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 6) this.acc = 0; // spiral-of-death guard

    // standings (throttled)
    this.standingsT -= dt;
    if (this.standingsT <= 0) {
      this.standingsT = 0.25;
      this.order = this.mp ? this._mpOrder() : this.cars.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.totalDist - a.totalDist;
      });
    }
    const pos = this.order.indexOf(this.player) + 1;

    // wrong-way notice
    const f = this.env.track.frameAt(this.player.s);
    const dot = Math.sin(this.player.yaw) * f.tx + Math.cos(this.player.yaw) * f.tz;
    if (dot < -0.3 && this.player.speed > 12) this.wrongWayT += dt; else this.wrongWayT = 0;
    this.noticeT -= dt;
    if (this.wrongWayT > 0.8 && this.noticeT <= 0) {
      this.env.menu.showNotice('WRONG WAY', 1400);
      this.noticeT = 3;
    }

    // HUD
    const lapShown = Math.min(LAPS, this.player.lap + 1);
    this.env.menu.updateHud({
      visible: true,
      speedKmh: this.player.speedKmh,
      lap: this.player.finished ? LAPS : lapShown,
      lapsTotal: LAPS,
      position: pos,
      total: this.mp ? this.remotes.size + 1 : this.cars.length,
      clock: this.clock,
      bestLap: this.bestLap,
      boost: this.player.boost,
      raceProgress: clamp01((this.player.totalDist + this.env.track.length) / (this.env.track.length * LAPS)),
      drift: this.player.slip > 0.45,
      item: this.player.item,
      standings: this.order.map(c => ({
        name: c.name ?? c.info?.name,
        color: '#' + new THREE.Color(c.color ?? c.info?.color ?? 0xffffff).getHexString(),
        lap: Math.min(LAPS, c.lap + (c.finished ? 0 : 1)),
        me: c === this.player,
        finished: c.finished,
      })),
    });
    // power-up use (edge-triggered)
    const useNow = !!this.input.useItem;
    if (useNow && !this._usePrev && this.player.item && !this.player.finished) {
      const desc = this.items.useItem(this.player, this.mp ? this._itemCars() : this.cars);
      if (desc && this.mp) this.mp.net.sendItem(desc);
    }
    this._usePrev = useNow;
    const mmCars = this.mp ? [this.player, ...this.remotes.values()] : this.cars;
    this.env.menu.setMinimap({
      track: this.minimapTrack,
      cars: mmCars.map(c => ({ x: c.pos.x, z: c.pos.z, isPlayer: c === this.player, color: '#' + new THREE.Color(c.color ?? c.info?.color ?? 0xffffff).getHexString() })),
    });

    // audio
    let near = null, nd = Infinity;
    for (const c of this.cars) {
      if (c === this.player) continue;
      const d = c.pos.distanceTo(this.player.pos);
      if (d < nd) { nd = d; near = c; }
    }
    this.env.audio.updateEngine(this.player, near ? { dist: nd, speed: near.speed } : null, dt);
    if (this.player.boosting && !this._wasBoosting) this.env.audio.whoosh();
    this._wasBoosting = this.player.boosting;

    this.chase.update(dt, this.player, this.env.terrain);

    if (this.player.finished) {
      this.finishDelay -= dt;
      if (this.finishDelay <= 0) this._showResults();
    }
  }

  // Two contact circles per car (nose + tail along the heading) so 5.4 m
  // cars can't pass through each other the way single small circles allowed.
  // mutual=true splits the correction between both cars (solo sims);
  // mutual=false moves only car `a` (MP: the remote resolves its own side).
  _carContact(a, b, mutual) {
    const OFF = 1.5, R2 = 2.4; // circle spacing / combined radius
    const ax = Math.sin(a.yaw) * OFF, az = Math.cos(a.yaw) * OFF;
    const bx = Math.sin(b.yaw ?? 0) * OFF, bz = Math.cos(b.yaw ?? 0) * OFF;
    for (const oa of [-1, 1]) {
      for (const ob of [-1, 1]) {
        const pax = a.pos.x + ax * oa, paz = a.pos.z + az * oa;
        const pbx = b.pos.x + bx * ob, pbz = b.pos.z + bz * ob;
        const dx = pbx - pax, dz = pbz - paz;
        const d = Math.hypot(dx, dz);
        if (d >= R2 || d < 1e-3 || Math.abs(a.pos.y - b.pos.y) >= 1.6) continue;
        const nx = dx / d, nz = dz / d;
        const push = (R2 - d) * (mutual ? 0.5 : 1);
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        if (mutual) { b.pos.x += nx * push; b.pos.z += nz * push; }
        const rel = ((b.vel?.x || 0) - a.vel.x) * nx + ((b.vel?.z || 0) - a.vel.z) * nz;
        if (rel < 0) {
          const imp = rel * (mutual ? 0.55 : 0.9);
          a.vel.x += nx * imp; a.vel.z += nz * imp;
          if (mutual) { b.vel.x -= nx * imp; b.vel.z -= nz * imp; }
          a.impact = Math.max(a.impact, Math.min(0.5, -rel / 25));
          if (mutual) b.impact = Math.max(b.impact, a.impact);
        }
      }
    }
  }

  _physicsSubstep(dt) {
    const env = this.env;
    for (const c of this.cars) {
      let input;
      if (c === this.player && !this.autopilot) input = this.input;
      else input = c.ai.computeInput(env, this.cars);
      c.step(input, dt, env);
    }
    // car-car contact (nose+tail circle pairs — long cars can't clip through)
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        this._carContact(this.cars[i], this.cars[j], true);
      }
    }
    // multiplayer: soft contact against remote puppets — only MY car yields
    // (their client resolves their side; both shoving here would double it)
    if (this.mp && this.player && !this.player.disabled) {
      for (const rc of this.remotes.values()) {
        this._carContact(this.player, rc, false);
      }
    }
    // race logic per car
    for (const c of this.cars) this._raceLogic(c, dt);
    // AI sustained wrong-way / lost off-road → recover
    for (const c of this.cars) {
      if (!c.ai || c.finished) continue;
      const f = this.env.track.frameAt(c.s);
      const dot = Math.sin(c.yaw) * f.tx + Math.cos(c.yaw) * f.tz;
      if (dot < -0.2 && c.speed > 8) c.wrongWayT = (c.wrongWayT || 0) + dt;
      else c.wrongWayT = 0;
      const nearC = this.env.track.nearestS(c.pos.x, c.pos.z);
      if (nearC.dist > nearC.frame.hw + 3) c.offRoadT = (c.offRoadT || 0) + dt;
      else c.offRoadT = 0;
      if (c.wrongWayT > 4 || c.stuckTimer > 5 || c.offRoadT > 6) {
        c.resetToTrack(this.env);
        c.wrongWayT = 0; c.stuckTimer = 0; c.offRoadT = 0;
        // keep race progress consistent after teleport
        c.lastS = c.s;
      }
    }
  }

  _raceLogic(c, dt) {
    const track = this.env.track;
    const L = track.length;
    let ds = c.s - c.lastS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (Math.abs(ds) > 200) ds = 0; // defensive: ignore projection teleports
    c.totalDist += ds;

    // checkpoint crossings (forward only)
    if (ds > 0 && !c.finished) {
      const cps = track.checkpoints;
      const next = cps[c.cpIndex % cps.length];
      let crossed = false;
      if (c.lastS <= c.s) crossed = next > c.lastS && next <= c.s;
      else crossed = next > c.lastS || next <= c.s; // wrapped
      const near = track.nearestS(c.pos.x, c.pos.z);
      if (crossed && near.dist < near.frame.hw + 9) {
        c.cpIndex++;
        if (c === this.player) this.env.audio.checkpoint();
      }
      // lap line = s wrap
      if (c.lastS > L * 0.75 && c.s < L * 0.25 && near.dist < near.frame.hw + 9) {
        if (c.totalDist < L * 0.5) {
          // opening crossing — the grid sits just behind the line, so the
          // first pass STARTS lap 1: arm the checkpoints, sync the lap clock
          c.cpIndex = 1;
          c.lapStart = this.clock;
        } else if (c.cpIndex >= cps.length) {
          c.lap++;
          const lapT = this.clock - c.lapStart;
          c.lapStart = this.clock;
          c.lapTimes.push(lapT);
          c.cpIndex = 1; // cp0 sits on the line — already passed by crossing it
          if (c === this.player) {
            if (!this.bestLap || lapT < this.bestLap) this.bestLap = lapT;
            this.env.audio.checkpoint();
          }
          if (c.lap >= LAPS && !c.finished) {
            c.finished = true;
            c.finishTime = this.clock;
            if (c === this.player) {
              this.finishDelay = 2.6;
              this.env.audio.finish();
              this.env.menu.showNotice('FINISH', 2200);
              if (this.mp) this.mp.net.sendFinish(this.clock);
            }
          }
        } else if (c === this.player && this.noticeT <= 0) {
          this.env.menu.showNotice('MISSED CHECKPOINT', 1500);
          this.noticeT = 3;
        }
      }
    }
    c.lastS = c.s;

    // boost pads
    if (c.boost < 0.999) {
      for (const pad of track.chevrons) {
        let d = Math.abs(c.s - pad.s);
        d = Math.min(d, L - d);
        if (d < 7 && c.grounded) {
          const dx = c.pos.x - pad.x, dz = c.pos.z - pad.z;
          if (dx * dx + dz * dz < 64 && c.padCooldown !== pad.s) {
            c.boost = Math.min(1, c.boost + 0.5);
            c.boostFlash = 1;
            c.padCooldown = pad.s;
            if (c === this.player) this.env.audio.boostPad();
            if (pad.mesh) pad.mesh.material.opacity = 1.4;
          }
        }
      }
    }
    if (c.grounded) { /* pads re-arm when far */ }
    for (const pad of track.chevrons) {
      let d = Math.abs(c.s - pad.s); d = Math.min(d, L - d);
      if (d > 30 && c.padCooldown === pad.s) c.padCooldown = -1;
    }
  }

  _simStep(dt, aiOnly) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 4) {
      for (const c of this.cars) {
        const input = c.ai ? c.ai.computeInput(this.env, this.cars) : { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
        c.step(input, FIXED, this.env);
      }
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 4) this.acc = 0;
  }

  _showResults() {
    this.state = 'results';
    if (this.mp) {
      const order = this._mpOrder();
      const leaderT = order[0].finishTime || this.clock;
      const standings = order.map((c) => ({
        name: c.name ?? c.info?.name,
        time: c.finished ? c.finishTime : null,
        gap: c.finished ? c.finishTime - leaderT : null,
        isPlayer: c === this.player,
      }));
      this.env.menu.updateHud({ visible: false });
      this.env.menu.setResults({
        position: order.indexOf(this.player) + 1,
        total: order.length,
        totalTime: this.player.finishTime,
        bestLap: this.bestLap,
        laps: this.player.lapTimes,
        standings,
      });
      this.env.menu.showScreen('results');
      return;
    }
    const order = this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalDist - a.totalDist;
    });
    const leaderT = order[0].finishTime || this.clock;
    const standings = order.map((c) => ({
      name: c.name,
      time: c.finished ? c.finishTime : null,
      gap: c.finished ? c.finishTime - leaderT : null,
      isPlayer: c === this.player,
    }));
    this.env.menu.updateHud({ visible: false });
    this.env.menu.setResults({
      position: order.indexOf(this.player) + 1,
      total: this.cars.length,
      totalTime: this.player.finishTime,
      bestLap: this.bestLap,
      laps: this.player.lapTimes,
      standings,
    });
    this.env.menu.showScreen('results');
  }

  // progress [0..1] through the race for HUD rail
  raceProgress() {
    return clamp01((this.player.totalDist + this.env.track.length) / (this.env.track.length * LAPS));
  }

  // debug/test hook (window.__game.grid()): current grid roster with colors
  // and positions, so headless checks can assert the lineup and movement.
  grid() {
    return this.cars.map((c) => ({
      name: c.name,
      color: '#' + new THREE.Color(c.color ?? 0xffffff).getHexString(),
      isPlayer: !!c.isPlayer,
      x: +c.pos.x.toFixed(2), y: +c.pos.y.toFixed(2), z: +c.pos.z.toFixed(2),
      s: +c.s.toFixed(1), lap: c.lap, finished: !!c.finished,
    }));
  }
}
