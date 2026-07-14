import * as THREE from 'three';
import { GAME, PLAYER } from './config.js';
import { clamp, damp, GlobalUniforms } from './utils.js';
import { makeDrone } from './assets.js';

// Pursuit swarm: self-made interceptor drones that converge to box the player in.
export class Pursuers {
  constructor(scene, city, glows) {
    this.scene = scene;
    this.city = city;
    this.glows = glows; // shared game glow pool
    this.units = [];
    for (let i = 0; i < GAME.pursuersMax; i++) {
      const d = makeDrone('drone08', { emissiveBoost: 2.2, tint: 0xff5546 });
      d.group.visible = false;
      scene.add(d.group);
      this.units.push({
        drone: d, active: false,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        angle: (i / GAME.pursuersMax) * Math.PI * 2,
        age: 0, radius: 1.5, sirenPhase: i * 1.7,
        weave: Math.random() * 10,
      });
    }
    this.activeCount = 0;
  }

  reset() {
    for (const u of this.units) { u.active = false; u.drone.group.visible = false; }
    this.activeCount = 0;
  }

  setCount(n, player) {
    n = Math.min(n, this.units.length);
    while (this.activeCount < n) {
      const u = this.units[this.activeCount++];
      u.active = true;
      u.drone.group.visible = true;
      u.age = 0;
      // spawn close to the ring station — beside/above, never 50m behind
      // (a long transit through the player reads as an execution, not a chase)
      u.pos.set(
        player.pos.x + (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 10),
        clamp(player.pos.y + 6 + Math.random() * 10, 5, 80),
        player.pos.z + 5 + Math.random() * 12,
      );
      u.vel.set(0, 0, player.vel.z * 0.9);
    }
  }

  update(dt, player, time, aggression) {
    // cap tracks the player: throttle is no longer an escape button
    const maxSpeed = Math.max(PLAYER.cruise * 0.9, player.speed * 1.02) + aggression * 2.2;
    let idx = 0;
    for (const u of this.units) {
      if (!u.active) continue;
      u.age += dt;

      // formation point: a shrinking ring BESIDE/BEHIND the player (visible in
      // the chase cam, pressuring the brake line — not lurking 17m ahead)
      const ringR = Math.max(7.0, 16 - u.age * 0.7 - aggression * 1.1);
      const a = u.angle + time * 0.14;
      const tx = player.pos.x + player.vel.x * 0.4 + Math.cos(a) * ringR * 0.85;
      const ty = clamp(player.pos.y + player.vel.y * 0.4 + Math.sin(a) * ringR * 0.5, 3.5, 80);
      const tz = player.pos.z + 3 + Math.sin(a * 0.7 + u.weave) * 7;

      const acc = new THREE.Vector3(tx - u.pos.x, ty - u.pos.y, tz - u.pos.z);
      const d = acc.length();
      acc.normalize().multiplyScalar(clamp(d * 2.2, 0, 42));
      // weave so they read as alive
      acc.x += Math.sin(time * 2.1 + u.weave * 3.1) * 4.5;
      acc.y += Math.cos(time * 1.7 + u.weave * 2.3) * 2.2;

      // player-exclusion bubble: hard pressure, but contact is the player's fault
      const bx = u.pos.x - player.pos.x, by = u.pos.y - player.pos.y, bz = u.pos.z - player.pos.z;
      const bd = Math.hypot(bx, by, bz);
      if (bd < 8 && bd > 1e-3) {
        const f = (8 - bd) * 24;
        acc.x += (bx / bd) * f; acc.y += (by / bd) * f; acc.z += (bz / bd) * f;
      }

      // crude obstacle avoidance: steer off pylons/decks ahead
      const obs = this._nearObs;
      if (obs) {
        for (const o of obs) {
          if (u.pos.z - 8 > o.max.z || u.pos.z + 2 < o.min.z) continue;
          const cx = (o.min.x + o.max.x) / 2, cy = (o.min.y + o.max.y) / 2;
          const hw = (o.max.x - o.min.x) / 2 + 2.4, hh = (o.max.y - o.min.y) / 2 + 2.4;
          const dx = u.pos.x - cx, dy = u.pos.y - cy;
          if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
            // push out along the smaller penetration
            if (hw - Math.abs(dx) < hh - Math.abs(dy)) acc.x += Math.sign(dx || 1) * 60;
            else acc.y += Math.sign(dy || 1) * 60;
          }
        }
      }

      u.vel.addScaledVector(acc, dt);
      const sp = u.vel.length();
      if (sp > maxSpeed) u.vel.multiplyScalar(maxSpeed / sp);
      u.pos.addScaledVector(u.vel, dt);
      u.pos.x = clamp(u.pos.x, -30, 30);
      u.pos.y = clamp(u.pos.y, 3.2, 92);

      // pose
      const g = u.drone.group;
      g.position.copy(u.pos);
      g.rotation.y = clamp(-u.vel.x * 0.02, -0.7, 0.7);
      g.rotation.z = clamp(-u.vel.x * 0.03, -0.8, 0.8);
      g.rotation.x = clamp(u.vel.y * 0.02, -0.5, 0.5);
      u.drone.mixer && u.drone.mixer.update(dt);

      // police strobes (alternating red/blue) + menacing underglow
      const ph = Math.floor(time * 6 + u.sirenPhase) % 2;
      if (this.glows) {
        this.glows.push(u.pos.x - 1.0, u.pos.y + 0.8, u.pos.z, ph ? 4.6 : 0.2, 0.18, ph ? 0.25 : 4.6, 2.6, 0);
        this.glows.push(u.pos.x + 1.0, u.pos.y + 0.8, u.pos.z, ph ? 0.2 : 4.6, 0.18, ph ? 4.6 : 0.2, 2.6, 0);
        this.glows.push(u.pos.x, u.pos.y - 0.5, u.pos.z, 3.2, 0.5, 0.35, 2.2, 0);
        this.glows.push(u.pos.x, u.pos.y - 0.1, u.pos.z + 1.5, 3.0, 1.5, 0.55, 1.3, 0); // engine
      }

      // hero light slots 2-3 for the two nearest
      if (idx < 2) {
        const dl = GlobalUniforms.uDynPos.value, dc = GlobalUniforms.uDynCol.value;
        dl[2 + idx].set(u.pos.x, Math.max(u.pos.y - 1.5, 1), u.pos.z, 1.9);
        dc[2 + idx].setRGB(ph ? 2.4 : 0.3, 0.12, ph ? 0.3 : 2.4);
      }
      idx++;
    }
    // clear unused hero slots
    const dl = GlobalUniforms.uDynPos.value;
    for (let i = 2 - 0 + Math.min(idx, 2); i < 4; i++) dl[i].w = 0;
  }

  setNearObstacles(obs) { this._nearObs = obs; }

  // closest active pursuer distance (for HUD/audio tension)
  nearestDist(player) {
    let best = 1e9;
    for (const u of this.units) if (u.active) best = Math.min(best, u.pos.distanceTo(player.pos));
    return best;
  }

  forEachActive(fn) { for (const u of this.units) if (u.active) fn(u); }
}
