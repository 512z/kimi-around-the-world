// SELENE GP — KartRider-style power-up field: rows of six item boxes along
// the road, prank items (banana peel, rocket, shield, turbo), projectiles,
// dropped hazards, explosion FX. Player and AI share the same mechanics.

import * as THREE from 'three';
import { clamp, clamp01, angleWrap, TAU } from './util.js';

export const ITEM_TYPES = ['banana', 'rocket', 'shield', 'turbo'];

const ROW_S = [650, 1950, 3150, 4250, 5350, 6500, 7650, 8450]; // arc positions of box rows
const BOXES_PER_ROW = 8;
const RESPAWN = 8;            // seconds
const PEEL_LIFE = 50;
const ROCKET_LIFE = 6.5;

export class ItemField {
  constructor(env) {
    this.env = env;           // { scene, track, audio, dust, terrain }
    this.group = new THREE.Group();
    env.scene.add(this.group);
    this.boxes = [];
    this.peels = [];
    this.rockets = [];
    this.fx = [];
    // LAN multiplayer hooks (set by game.mpInit): { net, playerSim, myId }.
    // Uses are broadcast; every client simulates peels/rockets locally and the
    // VICTIM's own client applies the real hit to its sim.
    this.mpHooks = null;
    this._buildBoxes();
    this._buildFxPool();
  }

  _buildBoxes() {
    const shellGeo = new THREE.IcosahedronGeometry(1.25, 0);
    const shellMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9fd8ff).multiplyScalar(1.9),
      wireframe: true, transparent: true, opacity: 0.9, toneMapped: false,
    });
    const coreGeo = new THREE.OctahedronGeometry(0.55, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffffff).multiplyScalar(2.2),
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (const s of ROW_S) {
      const f = this.env.track.frameAt(s);
      const hw = f.hw;
      for (let k = 0; k < BOXES_PER_ROW; k++) {
        const lat = -hw + 3.4 + k * ((2 * hw - 6.8) / (BOXES_PER_ROW - 1));
        const x = f.x + f.rx * lat;
        const z = f.z + f.rz * lat;
        const y = this.env.terrain.sampleHeight(x, z) + 1.5;
        const grp = new THREE.Group();
        grp.position.set(x, y, z);
        const shell = new THREE.Mesh(shellGeo, shellMat);
        const core = new THREE.Mesh(coreGeo, coreMat.clone());
        grp.add(shell, core);
        this.group.add(grp);
        this.boxes.push({ grp, shell, core, s, x, y, z, active: true, respawn: 0, phase: Math.random() * TAU });
      }
    }
  }

  _buildFxPool() {
    const ringGeo = new THREE.RingGeometry(0.55, 0.75, 24);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffd9a0).multiplyScalar(2.0), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.env.scene.add(m);
      this.fx.push({ mesh: m, t: 0, life: 0, kind: 'ring' });
    }
  }

  _spawnFx(x, y, z, color, big) {
    const fx = this.fx.find(f => f.life <= 0);
    if (!fx) return;
    fx.mesh.visible = true;
    fx.mesh.position.set(x, y, z);
    fx.mesh.material.color.set(color).multiplyScalar(2.2);
    fx.life = fx.t = big ? 0.55 : 0.4;
    fx.maxScale = big ? 16 : 7;
  }

  reset() {
    for (const b of this.boxes) { b.active = true; b.respawn = 0; b.grp.visible = true; b.grp.scale.setScalar(1); }
    for (const p of this.peels) this.env.scene.remove(p.mesh);
    this.peels.length = 0;
    for (const r of this.rockets) this.env.scene.remove(r.mesh);
    this.rockets.length = 0;
  }

  _rollItem(car, standingsPos) {
    // trailing cars get better items (KartRider rubber-band)
    const behind = standingsPos > 4;
    // prank-forward mix: most rolls should let you mess with someone
    const w = {
      banana: behind ? 0.26 : 0.4,
      rocket: behind ? 0.46 : 0.34,
      shield: behind ? 0.08 : 0.12,
      turbo: behind ? 0.2 : 0.14,
    };
    let r = Math.random() * (w.banana + w.rocket + w.shield + w.turbo);
    for (const t of ITEM_TYPES) { r -= w[t]; if (r <= 0) return t; }
    return 'banana';
  }

  giveRandomItem(car, standingsPos) {
    if (car.item) return false;
    car.item = this._rollItem(car, standingsPos);
    this.env.audio.itemPickup?.();
    return true;
  }

  useItem(car, cars) {
    const it = car.item;
    if (!it) return null;
    car.item = null;
    const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    if (it === 'banana') {
      const x = car.pos.x - fwd.x * 4.5;
      const z = car.pos.z - fwd.z * 4.5;
      const y = this.env.terrain.sampleHeight(x, z) + 0.2;
      const mesh = this._makePeelMesh();
      mesh.position.set(x, y, z);
      this.env.scene.add(mesh);
      this.peels.push({ mesh, x, z, owner: car, ownerId: car.netId ?? null, arm: 0.15, life: PEEL_LIFE });
      this.env.audio.splat?.();
      return { sub: 'use', kind: 'banana', x, z };
    } else if (it === 'rocket') {
      const x = car.pos.x + fwd.x * 3;
      const z = car.pos.z + fwd.z * 3;
      const mesh = this._makeRocketMesh();
      mesh.position.set(x, car.pos.y + 0.6, z);
      mesh.rotation.y = car.yaw;
      this.env.scene.add(mesh);
      const sp = Math.max(95, car.speed + 55);
      // lock onto the next car ahead ALONG THE TRACK (KartRider-style) —
      // no aim cone: firing while sliding sideways still chases the leader ahead
      const L = this.env.track.length;
      let victim = null, bestGap = 560;
      for (const o of cars) {
        if (o === car || o.finished) continue;
        const gap = (o.s - car.s + L) % L;
        if (gap > 2 && gap < bestGap) { bestGap = gap; victim = o; }
      }
      const vx = fwd.x * sp + car.vel.x * 0.3, vz = fwd.z * sp + car.vel.z * 0.3;
      this.rockets.push({
        mesh, x, y: car.pos.y + 0.6, z, vx, vz,
        owner: car, ownerId: car.netId ?? null, life: ROCKET_LIFE, age: 0, target: victim,
      });
      this.env.audio.rocketLaunch?.();
      return { sub: 'use', kind: 'rocket', x, z, y: car.pos.y + 0.6, vx, vz, targetId: victim?.netId ?? null };
    } else if (it === 'shield') {
      car.shieldT = 5.5;
      this.env.audio.shieldUp?.();
      return { sub: 'use', kind: 'shield' };
    } else if (it === 'turbo') {
      car.turboT = 2.4;
      this.env.audio.turbo?.();
      return { sub: 'use', kind: 'turbo' };
    }
    return null;
  }

  // A remote player used an item — replicate it locally. resolver(netId)
  // returns the local object for that player (my sim or a remote puppet).
  applyRemoteUse(desc, ownerId, resolver) {
    const owner = resolver(ownerId);
    if (desc.kind === 'banana') {
      const y = this.env.terrain.sampleHeight(desc.x, desc.z) + 0.2;
      const mesh = this._makePeelMesh();
      mesh.position.set(desc.x, y, desc.z);
      this.env.scene.add(mesh);
      this.peels.push({ mesh, x: desc.x, z: desc.z, owner, ownerId, arm: 0.15, life: PEEL_LIFE });
    } else if (desc.kind === 'rocket') {
      const mesh = this._makeRocketMesh();
      mesh.position.set(desc.x, desc.y, desc.z);
      mesh.rotation.y = Math.atan2(desc.vx, desc.vz);
      this.env.scene.add(mesh);
      const target = desc.targetId != null ? resolver(desc.targetId) : null;
      this.rockets.push({
        mesh, x: desc.x, y: desc.y, z: desc.z, vx: desc.vx, vz: desc.vz,
        owner, ownerId, life: ROCKET_LIFE, age: 0, target,
      });
      this.env.audio.rocketLaunch?.();
    } else if (desc.kind === 'shield') {
      if (owner && owner !== this.mpHooks?.playerSim) owner.shieldT = 5.5;
    }
    // turbo: no local effect — their speed stream already shows it
  }

  // a remote victim confirmed a rocket hit — detonate our cosmetic copy there
  detonateRocketNear(x, z) {
    let best = -1, bd = 30 * 30;
    for (let i = 0; i < this.rockets.length; i++) {
      const dx = this.rockets[i].x - x, dz = this.rockets[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const r = this.rockets[best];
      this._spawnFx(r.x, r.y, r.z, 0xffd9a0, true);
      this.env.audio.explosion?.();
      this.env.scene.remove(r.mesh);
      this.rockets.splice(best, 1);
    } else {
      this._spawnFx(x, 1.5, z, 0xffd9a0, true);
    }
  }

  removePeelNear(x, z) {
    let best = -1, bd = 16;
    for (let i = 0; i < this.peels.length; i++) {
      const dx = this.peels[i].x - x, dz = this.peels[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      this._spawnFx(this.peels[best].x, 1, this.peels[best].z, 0xffd9a0, false);
      this.env.scene.remove(this.peels[best].mesh);
      this.peels.splice(best, 1);
    }
  }

  _makePeelMesh() {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe14d).multiplyScalar(1.7), toneMapped: false });
    const peel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 6, 12, Math.PI * 1.35), mat);
    peel.rotation.x = Math.PI / 2;
    grp.add(peel);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), mat);
    tip.position.set(0.35, 0, 0.45);
    grp.add(tip);
    return grp;
  }

  _makeRocketMesh() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.8, roughness: 0.3 }));
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5544).multiplyScalar(1.5), toneMapped: false }));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.8;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 7, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb066).multiplyScalar(1.8), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -0.85;
    grp.add(body, nose, flame);
    grp.userData.flame = flame;
    return grp;
  }

  _hitCar(car, sourceX, sourceZ, heavy) {
    if (car.shieldT > 0) {
      car.shieldT = 0; // shield absorbs one hit
      this._spawnFx(car.pos.x, car.pos.y + 0.5, car.pos.z, 0x66ccff, false);
      this.env.audio.shieldBlock?.();
      if (this.mpHooks && car === this.mpHooks.playerSim) {
        this.mpHooks.net.sendItem({ sub: 'shieldPop' });
      }
      return false;
    }
    if (this.mpHooks && car === this.mpHooks.playerSim && heavy) {
      this.mpHooks.net.sendItem({ sub: 'rocketBoom', x: car.pos.x, z: car.pos.z });
    }
    car.stunT = heavy ? 1.7 : 1.3;
    car.stunSpin = (Math.random() < 0.5 ? -1 : 1) * (heavy ? 4.6 : 3.6) * (0.8 + Math.random() * 0.4);
    const damp = heavy ? 0.5 : 0.65;
    car.vel.x *= damp; car.vel.z *= damp;
    car.impact = 1;
    this._spawnFx(car.pos.x, car.pos.y + 0.4, car.pos.z, 0xffd9a0, heavy);
    if (heavy && this.env.dust) {
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * TAU;
        this.env.dust.emit(car.pos.x, car.pos.y, car.pos.z,
          Math.cos(a) * (3 + Math.random() * 6), 2 + Math.random() * 5, Math.sin(a) * (3 + Math.random() * 6),
          0.6 + Math.random() * 0.8, 0.9 + Math.random() * 0.9);
      }
    }
    this.env.audio.explosion?.();
    return true;
  }

  // called once per frame from the game loop (visual-rate), and it internally
  // runs pickups/projectiles at frame dt — cheap enough (48 boxes, few rockets)
  update(dt, cars, standingsOf, pickupsEnabled) {
    // --- animate + pickups ---
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) {
          b.active = true; b.grp.visible = true;
          b.grp.scale.setScalar(0.01);
        }
        continue;
      }
      b.phase += dt;
      b.grp.rotation.y += dt * 1.6;
      b.shell.rotation.x += dt * 0.7;
      b.grp.position.y = b.y + Math.sin(b.phase * 1.8) * 0.28;
      const pop = Math.min(1, b.grp.scale.x + dt * 4);
      if (pop < 1) b.grp.scale.setScalar(pop);
      b.core.material.opacity = 0.65 + 0.3 * Math.sin(b.phase * 4);
      if (pickupsEnabled) {
        for (const car of cars) {
          if (car.item) continue;
          const dx = car.pos.x - b.x, dz = car.pos.z - b.z;
          if (dx * dx + dz * dz < 9 && Math.abs(car.pos.y - b.y) < 3.5) {
            this.giveRandomItem(car, standingsOf(car));
            b.active = false; b.respawn = RESPAWN; b.grp.visible = false;
            this._spawnFx(b.x, b.y, b.z, 0x9fd8ff, false);
            break;
          }
        }
      }
    }

    // --- peels ---
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const p = this.peels[i];
      p.life -= dt;
      p.arm -= dt;
      p.mesh.rotation.y += dt * 1.2;
      if (p.life <= 0) { this.env.scene.remove(p.mesh); this.peels.splice(i, 1); continue; }
      if (p.arm > 0) continue;
      for (const car of cars) {
        if (car === p.owner) continue;
        if (p.ownerId != null && car.netId != null && car.netId === p.ownerId) continue;
        // swept test: distance from the peel to the segment the car covered
        // this frame — at 250 km/h a point test tunnels straight through
        const cx = car.pos.x, cz = car.pos.z;
        const pxv = cx - (car.vel?.x || 0) * dt, pzv = cz - (car.vel?.z || 0) * dt;
        const ex = cx - pxv, ez = cz - pzv;
        const len2 = ex * ex + ez * ez || 1e-6;
        const tt = Math.max(0, Math.min(1, ((p.x - pxv) * ex + (p.z - pzv) * ez) / len2));
        const qx = pxv + ex * tt - p.x, qz = pzv + ez * tt - p.z;
        if (qx * qx + qz * qz < 3.2 && car.grounded) {
          this._hitCar(car, p.x, p.z, false);
          // victim-authoritative: only MY OWN hit is real — tell the others so
          // the peel disappears everywhere
          if (this.mpHooks && car === this.mpHooks.playerSim) {
            this.mpHooks.net.sendItem({ sub: 'peelGone', x: p.x, z: p.z });
          }
          this.env.audio.splat?.();
          this.env.scene.remove(p.mesh);
          this.peels.splice(i, 1);
          break;
        }
      }
    }

    // --- rockets ---
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.age += dt;
      // homing: chase the locked victim with lead prediction. Fallback for a
      // lockless launch: acquire whoever is broadly ahead of the flight path.
      if (r.age > 0.18) {
        if (!r.target || r.target.finished) {
          let best = null, bd = 260 * 260;
          const sp0 = Math.hypot(r.vx, r.vz) || 1;
          for (const car of cars) {
            if (car === r.owner) continue;
            if (r.ownerId != null && car.netId != null && car.netId === r.ownerId) continue;
            const dx = car.pos.x - r.x, dz = car.pos.z - r.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > bd || d2 < 4) continue;
            const dot = (dx * r.vx + dz * r.vz) / (Math.sqrt(d2) * sp0);
            if (dot < 0.35) continue;
            bd = d2; best = car;
          }
          r.target = best;
        }
        if (r.target) {
          const sp = Math.hypot(r.vx, r.vz);
          const ddx = r.target.pos.x - r.x, ddz = r.target.pos.z - r.z;
          const dist = Math.hypot(ddx, ddz);
          // aim ahead of the victim so the intercept works at speed
          const lead = Math.min(0.55, dist / Math.max(sp, 1));
          let ax = r.target.pos.x + r.target.vel.x * lead - r.x;
          let az = r.target.pos.z + r.target.vel.z * lead - r.z;
          // long-range: bias along the road so the chase stays in the corridor
          // instead of cutting across boulder fields
          if (dist > 110) {
            const near = this.env.track.nearestS(r.x, r.z);
            const f2 = this.env.track.frameAt(near.s + 45);
            const al = Math.hypot(ax, az) || 1;
            const k = clamp((dist - 110) / 220, 0, 0.6);
            ax = (ax / al) * (1 - k) + f2.tx * k;
            az = (az / al) * (1 - k) + f2.tz * k;
          }
          const want = Math.atan2(ax, az);
          const cur = Math.atan2(r.vx, r.vz);
          // terminal guidance doubles authority so the rocket can't orbit
          const rate = dist < 30 ? 13 : 5.5;
          const turn = clamp(angleWrap(want - cur), -rate * dt, rate * dt);
          const a = cur + turn;
          // keep overtaking the victim even if they're boosting
          const spNew = Math.max(95, r.target.speed + 45);
          r.vx = Math.sin(a) * spNew; r.vz = Math.cos(a) * spNew;
          // graze fuse: passed the point of closest approach right next to the
          // victim → detonate on them instead of sailing past
          if (dist < 10 && r.lastD !== undefined && dist > r.lastD + 0.05) {
            this._hitCar(r.target, r.x, r.z, true);
            r.life = 0;
          }
          r.lastD = dist;
        }
      }
      r.x += r.vx * dt;
      r.z += r.vz * dt;
      // terrain-following hover: look a little ahead so ramps don't clip it
      const ground = Math.max(
        this.env.terrain.sampleHeight(r.x, r.z),
        this.env.terrain.sampleHeight(r.x + r.vx * 0.12, r.z + r.vz * 0.12),
      );
      const wantY = ground + 0.95 + Math.sin(r.age * 7) * 0.12;
      r.y += clamp(wantY - r.y, -22 * dt, 22 * dt);
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.rotation.y = Math.atan2(r.vx, r.vz);
      if (r.mesh.userData.flame) r.mesh.userData.flame.scale.y = 0.9 + 0.4 * Math.sin(r.age * 60);
      // exhaust trail
      if (this.env.dust) {
        this.env.dust.emit(
          r.x - r.vx * 0.02, r.y, r.z - r.vz * 0.02,
          (Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2,
          0.35 + Math.random() * 0.3, 0.35 + Math.random() * 0.25,
        );
      }

      let detonated = false;
      if (r.life <= 0 || r.y <= ground + 0.55) detonated = true;
      if (!detonated) {
        for (const car of cars) {
          if (car === r.owner) continue;
          if (r.ownerId != null && car.netId != null && car.netId === r.ownerId) continue;
          const dx = car.pos.x - r.x, dz = car.pos.z - r.z;
          // proximity fuse ~4.5m: skimming past the bumper still detonates
          if (dx * dx + dz * dz < 20 && Math.abs(car.pos.y - r.y) < 2.6) {
            this._hitCar(car, r.x, r.z, true);
            detonated = true;
            break;
          }
        }
      }
      if (!detonated) {
        const bs = this.env.terrain.bouldersNear(r.x, r.z, 1, []);
        for (const b of bs) {
          const dx = b.x - r.x, dz = b.z - r.z;
          if (dx * dx + dz * dz < (b.r + 0.5) ** 2) { detonated = true; this._spawnFx(r.x, r.y, r.z, 0xffd9a0, false); break; }
        }
      }
      if (detonated) {
        this._spawnFx(r.x, r.y, r.z, 0xffd9a0, true);
        this.env.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }

    // --- fx ---
    for (const fx of this.fx) {
      if (fx.life <= 0) continue;
      fx.life -= dt;
      if (fx.life <= 0) { fx.mesh.visible = false; continue; }
      const k = 1 - fx.life / fx.t;
      fx.mesh.scale.setScalar(0.5 + k * fx.maxScale);
      fx.mesh.material.opacity = (1 - k) * 0.8;
    }

    // --- AI item usage (never the human player unless autopilot is driving) ---
    const allowAiUse = this.allowAiUse || ((car) => !car.isPlayer);
    for (const car of cars) {
      if (!car.ai || !car.item || !allowAiUse(car)) continue;
      car.aiUseCd = Math.max(0, (car.aiUseCd || 0) - dt);
      if (car.aiUseCd > 0) continue;
      const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
      let ahead = null, aheadD = Infinity, behind = null, behindD = Infinity;
      for (const o of cars) {
        if (o === car) continue;
        const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
        const d = Math.hypot(dx, dz);
        const dot = (dx * fwd.x + dz * fwd.z) / (d || 1);
        if (dot > 0.85 && d < aheadD) { aheadD = d; ahead = o; }
        if (dot < -0.7 && d < behindD) { behindD = d; behind = o; }
      }
      if (car.item === 'rocket' && ahead && aheadD < 170) { this.useItem(car, cars); car.aiUseCd = 2.5; }
      else if (car.item === 'banana' && behind && behindD < 42) { this.useItem(car, cars); car.aiUseCd = 2.5; }
      else if (car.item === 'shield' && behind && behindD < 75) { this.useItem(car, cars); car.aiUseCd = 2.5; }
      else if (car.item === 'turbo') {
        const f = this.env.track.frameAt(car.s + 40);
        const turn = Math.abs(angleWrap(Math.atan2(f.tx, f.tz) - Math.atan2(Math.sin(car.yaw), Math.cos(car.yaw))));
        if (turn < 0.35 && car.speed < 68) { this.useItem(car, cars); car.aiUseCd = 2.5; }
      }
    }
  }
}

export function makeShieldMesh() {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x66ccff).multiplyScalar(1.3), transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2.3, 14, 10), mat);
  m.visible = false;
  return m;
}
