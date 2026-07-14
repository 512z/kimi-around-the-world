// Single-player NPC Kimi balls: three mascots that keep you company in the
// lobby — idle bobbing, wandering the plaza with the same floaty low-g feel
// as the player, little hops, and following you around when you come close.
// They expose the same ball/pos/vel shape as RemotePlayer so they flow
// through player.remotes collisions and the DOM name-label layer unchanged.
import * as THREE from 'three';
import {
  BALL_R, HOVER, ACCEL, JUMP_V, GRAV,
  createKimiBall, dampAngle, resolveStructureColliders,
} from './player.js';

const MAX_SPEED = 4.0;        // ~player pace
const WORLD_R = 2300;
const PLAZA = { x: -95, z: 110 };

const NPC_POOL = [
  { name: 'YIMI', colorHex: '#f2c94c' },  // yellow
  { name: 'RIMI', colorHex: '#eb5757' },  // red
  { name: 'BIMI', colorHex: '#2e7bf6' },  // blue
  { name: 'GIMI', colorHex: '#27ae60' },  // green
  { name: 'WIMI', colorHex: '#8b5a2b' },  // brown
];

// First three of YELLOW/RED/BLUE/GREEN/BROWN skipping the player's own color —
// no NPC ever matches the player (a yellow player gets RED+BLUE+GREEN, etc.).
export function pickNpcSpecs(playerColorHex) {
  const mine = (playerColorHex || '').toLowerCase();
  const picked = NPC_POOL.filter((c) => c.colorHex.toLowerCase() !== mine);
  return picked.slice(0, 3);
}

export class NpcBall {
  constructor(scene, heightAt, colliders, spec, x, z) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.colliders = colliders;
    this.name = spec.name;
    this.colorHex = spec.colorHex;
    this.ball = createKimiBall(spec.colorHex, spec.name);
    this.tilt = this.ball.children[0];
    this.pos = new THREE.Vector3(x, heightAt(x, z) + HOVER, z);
    this.vel = new THREE.Vector2();      // planar x,z (same convention as PlayerController)
    this.heading = Math.random() * Math.PI * 2;
    this.bobPh = Math.random() * 6.28;
    this.t = Math.random() * 10;
    this.yVel = 0;
    this.airborne = false;

    this.state = 'idle';                 // idle | wander | social
    this.stateT = 1.5 + Math.random() * 2.5;
    this.wp = new THREE.Vector2(x, z);   // wander waypoint
    this.socialCd = 3 + Math.random() * 5; // don't instantly swarm the player

    this.ball.position.copy(this.pos);
    this.ball.rotation.y = this.heading;
    scene.add(this.ball);
  }

  _enterIdle() {
    this.state = 'idle';
    this.stateT = 1.5 + Math.random() * 2.5;
  }

  _enterWander() {
    // waypoint 15–70 m out from the plaza, any direction
    const a = Math.random() * Math.PI * 2;
    const d = 15 + Math.random() * 55;
    this.wp.set(PLAZA.x + Math.cos(a) * d, PLAZA.z + Math.sin(a) * d);
    this.state = 'wander';
    this.stateT = 6 + Math.random() * 6; // give up on far waypoints eventually
  }

  _enterSocial() {
    this.state = 'social';
    this.stateT = 3 + Math.random() * 5;
  }

  _endSocial() {
    this.socialCd = 6 + Math.random() * 4; // don't glue forever
    this._enterIdle();
  }

  _accelToward(tx, tz, dt) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      this.vel.x += (dx / d) * ACCEL * dt;
      this.vel.y += (dz / d) * ACCEL * dt;
    }
    return d;
  }

  // ball-vs-ball vs the player + sibling NPCs — same push-out/bounce as
  // PlayerController.collide (each ball moves itself, like remote clients do)
  _collideBalls(player, all, selfIdx) {
    const R2 = BALL_R * 2;
    for (let k = -1; k < all.length; k++) {
      if (k === selfIdx) continue;
      const o = k < 0 ? player : all[k];
      if (k < 0 && !player.enabled) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      let d = Math.hypot(dx, dz);
      if (d < R2) {
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        d = Math.max(d, 1e-4);
        const overlap = R2 - d;
        this.pos.x += nx * overlap;
        this.pos.z += nz * overlap;
        const rvx = this.vel.x - (o.vel?.x || 0);
        const rvz = this.vel.y - (o.vel?.z || 0);
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const impulse = -(1 + 0.6) * vn + 0.5;
          this.vel.x += nx * impulse;
          this.vel.y += nz * impulse;
        } else {
          this.vel.x += nx * 0.5;
          this.vel.y += nz * 0.5;
        }
      }
    }
    // world bounds
    const wr = Math.hypot(this.pos.x, this.pos.z);
    if (wr > WORLD_R) {
      this.pos.x *= WORLD_R / wr;
      this.pos.z *= WORLD_R / wr;
      this.vel.multiplyScalar(0.3);
    }
  }

  update(dt, player, all, selfIdx) {
    this.t += dt;
    this.stateT -= dt;
    if (this.socialCd > 0) this.socialCd -= dt;

    const pdx = player.pos.x - this.pos.x;
    const pdz = player.pos.z - this.pos.z;
    const playerDist = Math.hypot(pdx, pdz);

    // ---- state machine
    if (this.state === 'idle') {
      // face the player when they're close (mascot read)
      if (playerDist < 10 && playerDist > 1e-4) {
        this.heading = dampAngle(this.heading, Math.atan2(pdx, pdz), 4, dt);
      }
      if (this.socialCd <= 0 && playerDist < 14) this._enterSocial();
      else if (this.stateT <= 0) this._enterWander();
    } else if (this.state === 'wander') {
      const d = this._accelToward(this.wp.x, this.wp.y, dt);
      if (this.socialCd <= 0 && playerDist < 14) this._enterSocial();
      else if (d < 2 || this.stateT <= 0) this._enterIdle();
    } else { // social: tag along at ~3 m
      if (playerDist > 3.2) this._accelToward(player.pos.x, player.pos.z, dt);
      if (playerDist > 25 || this.stateT <= 0) this._endSocial(); // sprinted away / bored
    }

    // occasional little low-g hop while on the move
    if (!this.airborne && this.state !== 'idle' && Math.random() < 0.25 * dt) {
      this.yVel = JUMP_V * (0.7 + Math.random() * 0.4);
      this.airborne = true;
    }

    // ---- damping + speed clamp (player feel)
    this.vel.multiplyScalar(Math.exp(-3.4 * dt));
    const sp = this.vel.length();
    if (sp > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp);

    // ---- integrate + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    this._collideBalls(player, all, selfIdx);
    resolveStructureColliders(this.pos, this.vel, this.colliders);

    // ---- vertical: hover bob, floaty low-g hop
    const groundY = this.heightAt(this.pos.x, this.pos.z) + HOVER;
    if (this.airborne) {
      this.yVel -= GRAV * dt;
      this.pos.y += this.yVel * dt;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.yVel = 0;
        this.airborne = false;
      }
    } else {
      this.pos.y = groundY + Math.sin(this.t * 1.6 + this.bobPh) * 0.1;
    }
    this.ball.position.copy(this.pos);

    // ---- heading + tilt into velocity (same read as the player ball)
    if (sp > 0.35) this.heading = dampAngle(this.heading, Math.atan2(this.vel.x, this.vel.y), 9, dt);
    this.ball.rotation.y = this.heading;
    this.tilt.rotation.x = -Math.min(sp / MAX_SPEED, 1) * 0.22;
    this.tilt.rotation.z = Math.sin(this.t * 2.1 + this.bobPh) * 0.03;
  }

  dispose() { this.scene.remove(this.ball); }
}
