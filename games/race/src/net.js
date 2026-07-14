// SELENE GP — LAN multiplayer client + interpolated remote car puppets.
// Thin relay: every client owns its own sim and streams transforms with the
// sender's sample time (`at`), so remote cars interpolate on the true
// timeline (fan-out re-stamping caused visible stutter in an earlier game).
import * as THREE from 'three';
import { makeCarMesh, makeNameTag } from './car.js';
import { makeShieldMesh } from './items.js';

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
  startRace() { this.send({ t: 'startRace' }); }
  sendFinish(time) { this.send({ t: 'finish', time }); }
  sendItem(payload) { this.send({ t: 'item', ...payload }); }

  maybeSendState(car, lap, prog) {
    const now = performance.now();
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    const r = (x) => Math.round(x * 1000) / 1000;
    this.send({
      t: 'state',
      at: this.serverTime(),
      d: [
        r(car.pos.x), r(car.pos.y), r(car.pos.z), r(car.yaw),
        r(car.speed), r(car.visualPitch), r(car.visualRoll), r(car.steerViz),
      ],
      lap, prog: Math.round(prog * 10) / 10,
    });
  }
}

// ---------------------------------------------------------------------------
// Interpolated remote car: the real car mesh, posed straight from the buffer.
export class RemoteCar {
  constructor(scene, info, markBloom) {
    this.info = info; // {id, name, color, slot}
    const hex = '#' + (info.color >>> 0).toString(16).padStart(6, '0');
    this.mesh = makeCarMesh({ name: info.name, color: hex }, false);
    scene.add(this.mesh);
    markBloom?.(this.mesh);
    this.tag = makeNameTag(info.name, hex);
    this.mesh.add(this.tag);
    this.buffer = [];
    this.lap = 0;
    this.prog = 0;
    this.finished = false;
    this.pos = this.mesh.position; // aliases for contact + standings code
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.yaw = 0;
    this.wheelRot = 0;
    this._lastPos = new THREE.Vector3();
    // item-system interop: remote cars are valid rocket targets / peel victims
    // (cosmetically — the victim's own client adjudicates the real hit)
    this.netId = info.id;
    this.item = 'remote';   // truthy -> the pickup loop never gives puppets items
    this.grounded = true;
    this.s = 0;             // stamped from prog by game.update
    this.shieldT = 0;       // mirrored from their shield broadcast
    this.stunT = 0;
    this.stunSpin = 0;
    this.impact = 0;
    this.shieldMesh = makeShieldMesh();
    this.mesh.add(this.shieldMesh);
  }

  pushState(d, at, lap, prog) {
    this.lap = lap; this.prog = prog;
    const last = this.buffer[this.buffer.length - 1];
    if (last && at <= last.at) return; // relay re-broadcasts — drop duplicates
    this.buffer.push({ at, x: d[0], y: d[1], z: d[2], yaw: d[3], speed: d[4], pitch: d[5], roll: d[6], steer: d[7] });
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
      // teleports (resets) — snap, never sweep
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 60) { const s = k < 0.5 ? s0 : s1; s0 = s; s1 = s; k = 0; }
      this.mesh.position.set(
        s0.x + (s1.x - s0.x) * k,
        s0.y + (s1.y - s0.y) * k,
        s0.z + (s1.z - s0.z) * k,
      );
      this.yaw = lerpA(s0.yaw, s1.yaw, k);
      this.speed = s0.speed + (s1.speed - s0.speed) * k;
      const pitch = s0.pitch + (s1.pitch - s0.pitch) * k;
      const roll = s0.roll + (s1.roll - s0.roll) * k;
      this.mesh.rotation.set(pitch, this.yaw, roll, 'YXZ');
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

    // wheels spin with reported speed; steer pose from the stream
    this.wheelRot += (this.speed / 0.52) * dt;
    const wheels = this.mesh.userData.wheels;
    if (wheels) {
      const steer = this.buffer[this.buffer.length - 1].steer || 0;
      for (const w of wheels) {
        w.tire.rotation.x = this.wheelRot;
        w.tire.rotation.z = Math.PI / 2;
        if (w.steerable) w.group.rotation.y = steer * 0.5;
      }
    }
    const drv = this.mesh.userData.driver;
    if (drv) drv.rotation.z = -(this.buffer[this.buffer.length - 1].steer || 0) * 0.35;
    if (this.mesh.userData.beaconMat) {
      this.mesh.userData.beaconMat.emissiveIntensity = 1.5 + Math.abs(Math.sin(performance.now() * 0.005)) * 2.5;
    }
    const flames = this.mesh.userData.flames;
    if (flames) {
      const k = Math.min(this.speed / 60, 1);
      for (const f of flames) {
        f.scale.set(1, Math.max(0.04, 0.08 + k * 0.4), 1);
        f.material.opacity = 0.1 + k * 0.45;
      }
    }
    // mirrored shield visual
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      this.shieldMesh.visible = true;
      this.shieldMesh.material.opacity = 0.18 + 0.1 * Math.sin(performance.now() * 0.006);
    } else this.shieldMesh.visible = false;
    // velocity estimate for the soft car-car contact
    this.vel.set(
      (this.mesh.position.x - this._lastPos.x) / Math.max(dt, 1e-3), 0,
      (this.mesh.position.z - this._lastPos.z) / Math.max(dt, 1e-3),
    );
    if (this.vel.length() > 300) this.vel.set(0, 0, 0); // teleport frame
    this._lastPos.copy(this.mesh.position);
  }

  // standings use lap*L + s like the local sim's totalDist
  get totalDist() { return this.prog; }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}
