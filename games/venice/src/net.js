// GONDOLIER — LAN multiplayer client, remote gondola puppets, Kimi pilot.
// Same thin-relay protocol as the rest of the KIMI fleet (see server.js).
import * as THREE from 'three';
import { makeGondola, BOAT_SCALE } from './scene/gondola.js';

const SEND_HZ = 20;
export const INTERP_DELAY = 140; // ms

export class Net {
  constructor() {
    this.ws = null;
    this.id = -1;
    this.clockOffset = 0;
    this.lastSend = 0;
    this.handlers = {};
    this.connected = false;
    this.joinedAs = null;
    this.reconnecting = false;
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, data) { this.handlers[evt]?.(data); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try { ws = new WebSocket(`${proto}://${location.host}`); }
      catch (e) { reject(e); return; }
      this.ws = ws;
      const pings = [];
      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
      };
      ws.onerror = () => reject(new Error('connection failed'));
      ws.onclose = () => {
        this.connected = false;
        this.emit('disconnect');
        this.scheduleReconnect();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.t) {
          case 'pong': {
            const now = Date.now();
            const rtt = now - msg.c;
            pings.push(msg.s + rtt / 2 - now);
            if (pings.length < 4) ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
            else {
              pings.sort((a, b) => a - b);
              this.clockOffset = pings[Math.floor(pings.length / 2)];
              resolve();
            }
            break;
          }
          case 'welcome': this.id = msg.id; this.emit('welcome', msg); break;
          case 'roster': this.emit('roster', msg.players); break;
          case 'states': this.emit('states', msg); break;
          case 'raceStart': this.emit('raceStart', msg); break;
          case 'finishes': this.emit('finishes', msg.finishes); break;
          case 'raceEnd': this.emit('raceEnd', msg.finishes); break;
          case 'item': this.emit('item', msg); break;
          case 'full': this.emit('full', msg); break;
        }
      };
      setTimeout(() => reject(new Error('connection timeout')), 6000);
    });
  }

  serverTime() { return Date.now() + this.clockOffset; }

  scheduleReconnect() {
    if (this.reconnecting || !this.joinedAs) return;
    this.reconnecting = true;
    const attempt = () => {
      this.connect().then(() => {
        this.reconnecting = false;
        this.join(this.joinedAs.name, this.joinedAs.color, this.joinedAs.auto);
      }).catch(() => setTimeout(attempt, 2000));
    };
    setTimeout(attempt, 1200);
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  join(name, color, auto = false) {
    this.joinedAs = { name, color, auto };
    this.send({ t: 'join', name, color, auto: !!auto });
  }
  sendFinish(time) { this.send({ t: 'finish', time }); }
  sendItem(payload) { this.send({ t: 'item', ...payload }); }

  maybeSendState(S, prog) {
    const now = performance.now();
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    const r = (x) => Math.round(x * 1000) / 1000;
    this.send({
      t: 'state',
      at: this.serverTime(),
      d: [r(S.x), r(S.z), r(S.heading), r(S.speed), S.stroking ? 1 : 0],
      lap: 0, prog: Math.round(prog * 10) / 10,
    });
  }
}

// ---------------------------------------------------------------------------
// Kimi at the oar — the mascot orb standing on the stern deck. Drop-in for
// makePerson's {root, update(dt, pose)} interface so game.js can pose it.
export function makeKimiPilot(colorHex) {
  const root = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const orbMat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), orbMat);
  orb.position.y = 0.42;
  orb.castShadow = true;
  root.add(orb);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.45,
  });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), eyeMat);
    eye.scale.set(0.062, 0.115, 0.038);
    eye.position.set(s * 0.115, 0.48, 0.305);
    root.add(eye);
  }
  let t = Math.random() * 6;
  function update(dt, pose = {}) {
    t += dt;
    const steer = pose.steer || 0;
    if (pose.mode === 'pole') {
      // bobs with the stroke cycle, leans into the pole
      const ph = (pose.phase ?? 0) * Math.PI * 2;
      orb.position.y = 0.42 + Math.sin(ph) * 0.05 * (pose.intensity ?? 1);
      root.rotation.x = Math.sin(ph + 0.6) * 0.1 * (pose.intensity ?? 1);
    } else {
      orb.position.y = 0.42 + Math.sin(t * 1.4) * 0.02;
      root.rotation.x *= 0.9;
    }
    root.rotation.z = THREE.MathUtils.lerp(root.rotation.z, -steer * 0.18, 0.1);
  }
  return { root, update, setColor(hex) {
    const c = new THREE.Color(hex);
    orbMat.color.copy(c);
    orbMat.emissive.copy(c);
  } };
}

export function makeNameSprite(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.font = '600 54px "Geist Mono", Menlo, monospace';
  c.textAlign = 'center';
  c.fillStyle = 'rgba(6,11,20,0.55)';
  const w = c.measureText(text).width + 60;
  c.beginPath(); c.roundRect((512 - w) / 2, 22, w, 84, 16); c.fill();
  c.fillStyle = '#eef5fc';
  c.fillText(text, 256, 80);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.6, 0.65, 1);
  return sp;
}

// Interpolated remote gondola with its own Kimi pilot.
export class RemoteGondola {
  constructor(scene, textures, info) {
    this.info = info; // {id, name, color, slot}
    const hex = '#' + (info.color >>> 0).toString(16).padStart(6, '0');
    this.boat = makeGondola(textures, { physical: false });
    scene.add(this.boat);
    this.pilot = makeKimiPilot(hex);
    this.pilot.root.position.set(0, 0.5, -0.2); // amidships, same as the local pilot
    this.pilot.root.scale.setScalar(1 / BOAT_SCALE);
    this.boat.add(this.pilot.root);
    this.tag = makeNameSprite(info.name.toUpperCase());
    this.tag.position.set(0, 2.3, 0);
    this.tag.scale.multiplyScalar(1 / BOAT_SCALE);
    this.boat.add(this.tag);
    this.buffer = [];
    this.prog = 0;
    this.finished = false;
    this.finishTime = 0;
    this.speed = 0;
    this.stroke = 0;
    this.shieldT = 0; // mirrored bubble from their shield broadcast
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0xbfe3ff, transparent: true, opacity: 0.16, depthWrite: false,
    });
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), bubbleMat);
    this.bubble.visible = false;
    this.bubble.scale.setScalar(1 / BOAT_SCALE);
    this.boat.add(this.bubble);
    // aliases so game.js collision can treat it like an NPC boat
    this.position = this.boat.position;
    this.rotation = this.boat.rotation;
  }

  pushState(d, at, _lap, prog) {
    this.prog = prog;
    const last = this.buffer[this.buffer.length - 1];
    if (last && at <= last.at) return;
    this.buffer.push({ at, x: d[0], z: d[1], heading: d[2], speed: d[3], stroke: d[4] });
    if (this.buffer.length > 40) this.buffer.splice(0, this.buffer.length - 40);
  }

  update(serverNow, dt) {
    if (this.buffer.length === 0) return;
    const t = serverNow - INTERP_DELAY;
    const buf = this.buffer;
    let a = null, b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].at <= t) { a = buf[i]; b = buf[i + 1] || null; break; }
    }
    const lerpA = (x, y, k) => {
      let d = ((y - x + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return x + d * k;
    };
    const apply = (s0, s1, k) => {
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 40) { const s = k < 0.5 ? s0 : s1; s0 = s; s1 = s; k = 0; }
      this.boat.position.set(
        s0.x + (s1.x - s0.x) * k,
        Math.sin(performance.now() * 0.001 + this.info.id) * 0.02,
        s0.z + (s1.z - s0.z) * k,
      );
      this.boat.rotation.y = lerpA(s0.heading, s1.heading, k);
      this.speed = s0.speed + (s1.speed - s0.speed) * k;
      this.stroke = s1.stroke;
    };
    if (!a) apply(buf[0], buf[0], 0);
    else if (!b) {
      const prev = buf[buf.length - 2] || a;
      const last = buf[buf.length - 1];
      const span = last.at - prev.at || 50;
      const k = Math.min((t - last.at) / span, 2);
      if (t - last.at < 250) apply(prev, last, 1 + k);
      else apply(last, last, 0);
    } else {
      apply(a, b, (t - a.at) / Math.max(1, b.at - a.at));
    }
    // mirrored shield bubble
    if (this.shieldT > 0) { this.shieldT -= dt; this.bubble.visible = true; }
    else this.bubble.visible = false;
    // pilot poles while their boat reports a stroke
    this._ph = ((this._ph || 0) + dt * 0.85 * (this.stroke ? 1 : 0)) % 1;
    this.pilot.update(dt, this.stroke
      ? { mode: 'pole', phase: this._ph, intensity: Math.min(1, this.speed / 2) }
      : { mode: 'idle' });
    // oar sway
    const oar = this.boat.userData.oar;
    if (oar) {
      const targetY = this.stroke ? 0.5 + Math.sin(this._ph * Math.PI * 2) * 0.45 : 0.5;
      oar.rotation.y = THREE.MathUtils.lerp(oar.rotation.y, targetY, 0.2);
    }
  }

  get totalDist() { return this.prog; }

  dispose(scene) { scene.remove(this.boat); }
}
