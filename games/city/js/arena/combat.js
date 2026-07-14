// Plasma bolts + hit adjudication. Same thin-relay trust model as the other
// games: the shooter broadcasts the shot, every client flies the bolt locally,
// and the VICTIM adjudicates hits on itself (then broadcasts the consequence).
import * as THREE from 'three';
import { SHIP_RADIUS } from './ship.js';

const BOLT_SPEED = 170;      // m/s
const BOLT_TTL = 2.4;        // s
const FIRE_INTERVAL = 0.22;  // s between shots (hold to autofire)
const POOL = 64;

export class Combat {
  // ctx: { scene, glows, net, dzLoop, getMyPos: () => Vector3|null, onSelfHit(fromId), sfx }
  constructor(ctx) {
    this.ctx = ctx;
    this.bolts = []; // {active, mine, from, p, v, t}
    this.fireCd = 0;

    const geo = new THREE.CapsuleGeometry(0.09, 2.6, 4, 8);
    geo.rotateX(Math.PI / 2); // long axis along z (flight direction)
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      m.visible = false;
      m.frustumCulled = false;
      ctx.scene.add(m);
      this.bolts.push({ active: false, mine: false, from: -1, mesh: m, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0 });
    }
  }

  _spawn(p, v, mine, from) {
    const b = this.bolts.find(x => !x.active) || this.bolts[0];
    b.active = true; b.mine = mine; b.from = from;
    b.p.copy(p); b.v.copy(v); b.t = 0;
    b.mesh.visible = true;
    b.mesh.position.copy(p);
    b.mesh.lookAt(p.x + v.x, p.y + v.y, p.z + v.z);
    return b;
  }

  // Local trigger — call every frame while the fire input is held.
  tryFire(P, dt) {
    this.fireCd -= dt;
    if (this.fireCd > 0) return false;
    this.fireCd = FIRE_INTERVAL;
    // fire along the velocity direction (where you're flying is where you aim)
    const dir = P.vel.clone().normalize();
    const p = P.pos.clone().addScaledVector(dir, 2.4);
    p.y -= 0.15;
    const v = dir.multiplyScalar(BOLT_SPEED);
    this._spawn(p, v, true, this.ctx.net.id);
    const r = x => Math.round(x * 100) / 100;
    this.ctx.net.sendItem({ sub: 'shot', x: r(p.x), y: r(p.y), z: r(p.z), vx: r(v.x), vy: r(v.y), vz: r(v.z) });
    this.ctx.sfx.shot();
    return true;
  }

  // Solo-mode bot trigger (arena bots.js) — same bolt pool and ballistics as
  // tryFire, but the bolt is owned by `fromId` and treated as a remote shot:
  // victim-authoritative against the player, adjudicated by bots for bots.
  fireFrom(P, fromId) {
    const dir = P.vel.clone().normalize();
    const p = P.pos.clone().addScaledVector(dir, 2.4);
    p.y -= 0.15;
    const v = dir.multiplyScalar(BOLT_SPEED);
    this._spawn(p, v, false, fromId);
    const r = x => Math.round(x * 100) / 100;
    this.ctx.net.sendItem({ sub: 'shot', from: fromId, x: r(p.x), y: r(p.y), z: r(p.z), vx: r(v.x), vy: r(v.y), vz: r(v.z) });
  }

  // Solo bots adjudicate hits on themselves — kill the bolt with its burst.
  killBolt(b) {
    b.active = false;
    b.mesh.visible = false;
    this._burst(b.p, 1.0);
  }

  // Remote shot arrived over the relay.
  onNetShot(msg) {
    // place the bolt on MY loop window so it flies past my ship, not a copy 800 m away
    const p = new THREE.Vector3(msg.x, msg.y, msg.z);
    const my = this.ctx.getMyPos();
    if (my) p.z = my.z + this.ctx.dzLoop(p.z, my.z);
    this._spawn(p, new THREE.Vector3(msg.vx, msg.vy, msg.vz), false, msg.from);
  }

  update(dt, invulnerable) {
    const my = this.ctx.getMyPos();
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      if (b.t > BOLT_TTL) { b.active = false; b.mesh.visible = false; continue; }
      b.p.addScaledVector(b.v, dt);
      b.mesh.position.copy(b.p);
      // glow trail
      this.ctx.glows.push(b.p.x, b.p.y, b.p.z, 1.2, 2.6, 3.4, 0.8, 0);

      // victim-authoritative: only remote bolts can hurt ME
      if (!b.mine && my && !invulnerable) {
        const dz = this.ctx.dzLoop(b.p.z, my.z);
        const dx = b.p.x - my.x, dy = b.p.y - my.y;
        if (dx * dx + dy * dy + dz * dz < SHIP_RADIUS * SHIP_RADIUS) {
          b.active = false; b.mesh.visible = false;
          this._burst(b.p, 1.0);
          this.ctx.onSelfHit(b.from);
          continue;
        }
      }
      // my bolts sparking on remote ships is cosmetic feedback only —
      // the victim's own client decides whether it actually hurt
      if (b.mine) {
        for (const rs of this.ctx.remotes.values()) {
          if (!rs.ship) continue;
          const g = rs.ship.group.position;
          const dx = b.p.x - g.x, dy = b.p.y - g.y, dz = b.p.z - g.z;
          if (dx * dx + dy * dy + dz * dz < SHIP_RADIUS * SHIP_RADIUS * 1.2) {
            b.active = false; b.mesh.visible = false;
            this._burst(b.p, 0.7);
            this.ctx.sfx.clang();
            break;
          }
        }
      }
    }
  }

  _burst(p, k) {
    for (let i = 0; i < 6; i++) {
      this.ctx.glows.push(
        p.x + (Math.random() - 0.5) * 1.6,
        p.y + (Math.random() - 0.5) * 1.6,
        p.z + (Math.random() - 0.5) * 1.6,
        3.2 * k, 1.6 * k, 0.5 * k, 0.9, 0,
      );
    }
  }
}
