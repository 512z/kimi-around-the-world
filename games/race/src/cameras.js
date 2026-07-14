// SELENE GP — cameras: chase cam for racing, car-anchored cinematic cam for
// the attract loop. The cinematic camera defines each shot RELATIVE to the
// focus car's current road frame, so the pack is always in frame and the
// camera banks with the road through the bowl, passes under the gantry, and
// catches earth/sun whenever the road heads their way.

import * as THREE from 'three';
import { damp, clamp } from './util.js';

export class ChaseCam {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this.shake = 0;
  }

  update(dt, car, terrain) {
    const sp = car.speed;
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    // tight chase: the car should stay big in frame even at top speed
    const dist = 7.0 + sp * 0.03;
    const height = 2.7 + sp * 0.012 + (car.grounded ? 0 : Math.min(2.5, car.airTime * 1.6));
    const desired = new THREE.Vector3(
      car.pos.x - fwd.x * dist,
      car.pos.y + height,
      car.pos.z - fwd.z * dist,
    );
    const ground = terrain.sampleHeight(desired.x, desired.z) + 1.4;
    if (desired.y < ground) desired.y = ground;
    this.pos.x = damp(this.pos.x, desired.x, 5.5, dt);
    this.pos.y = damp(this.pos.y, desired.y, 4.0, dt);
    this.pos.z = damp(this.pos.z, desired.z, 5.5, dt);

    const lookTarget = new THREE.Vector3(
      car.pos.x + fwd.x * (9 + sp * 0.1),
      car.pos.y + 1.3 + clamp(car.vel.y * 0.06, -1.5, 3),
      car.pos.z + fwd.z * (9 + sp * 0.1),
    );
    this.look.x = damp(this.look.x, lookTarget.x, 7, dt);
    this.look.y = damp(this.look.y, lookTarget.y, 6, dt);
    this.look.z = damp(this.look.z, lookTarget.z, 7, dt);

    this.shake = Math.max(car.impact * 0.5, this.shake - dt * 1.5);
    const sh = this.shake * this.shake;
    this.cam.position.set(
      this.pos.x + (Math.random() - 0.5) * sh * 0.6,
      this.pos.y + (Math.random() - 0.5) * sh * 0.4,
      this.pos.z + (Math.random() - 0.5) * sh * 0.6,
    );
    this.cam.lookAt(this.look);
    const boostKick = (car.boosting || car.turboing) ? 8 : 0;
    this.cam.fov = damp(this.cam.fov, 60 + Math.min(13, sp * 0.16) + boostKick, boostKick ? 6 : 3, dt);
    this.cam.updateProjectionMatrix();
  }

  snap(car, terrain) {
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    this.pos.set(car.pos.x - fwd.x * 9, car.pos.y + 3.5, car.pos.z - fwd.z * 9);
    this.look.copy(car.pos);
  }
}

// Shot = offsets in the focus car's road frame:
//   along: meters behind (-) / ahead (+) of the car along the centerline
//   side:  meters across (+ = right of travel)
//   up:    meters above the road surface
//   look:  meters ahead of the car to aim at (negative = look back at the pack)
//   fov, hold (seconds)
const SHOTS = [
  { along: -10, side: 3.5, up: 2.2, look: 45, fov: 50, hold: 7 },
  { along: -24, side: -10, up: 7.0, look: 22, fov: 46, hold: 6 },
  { along: 16, side: 4.5, up: 1.7, look: -26, fov: 55, hold: 5 },
  { along: -70, side: 16, up: 15, look: 70, fov: 42, hold: 6 },
  { along: -5, side: -2.5, up: 1.35, look: 75, fov: 62, hold: 5 },
  { along: -130, side: 44, up: 60, look: 90, fov: 50, hold: 6 },
  { along: 30, side: -14, up: 9, look: -40, fov: 48, hold: 5 },
  { along: -40, side: 2, up: 3.2, look: 120, fov: 44, hold: 6 },
];

export class CinematicCam {
  constructor(camera, track, terrain) {
    this.cam = camera;
    this.track = track;
    this.terrain = terrain;
    this.shot = 0;
    this.shotT = 0;
    this.pos = new THREE.Vector3(0, 10, 0);
    this.look = new THREE.Vector3();
    this.started = false;
  }

  _framePos(frame, side, up) {
    const x = frame.x + frame.rx * side;
    const z = frame.z + frame.rz * side;
    return new THREE.Vector3(x, this.terrain.sampleHeight(x, z) + up, z);
  }

  update(dt, focusCar) {
    if (!focusCar) return;
    const s = focusCar.s;
    let cut = !this.started;
    const shot = SHOTS[this.shot];
    this.shotT += dt;
    if (this.shotT > shot.hold) {
      this.shotT = 0;
      this.shot = (this.shot + 1) % SHOTS.length;
      cut = true; // hard cut between shots — a glide would tunnel through hills
    }
    const cur = SHOTS[this.shot];

    const fPos = this.track.frameAt(s + cur.along);
    const desired = this._framePos(fPos, cur.side, cur.up);
    const ground = this.terrain.sampleHeight(desired.x, desired.z) + 1.8;
    if (desired.y < ground) desired.y = ground;

    const fLook = this.track.frameAt(s + cur.look);
    const lookTarget = new THREE.Vector3(fLook.x, fLook.y + 2.0, fLook.z);
    // pull the aim onto the pack itself when looking back at it
    if (cur.look < 0) lookTarget.lerp(focusCar.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0.7);

    const lambda = cut ? 1000 : 0.9;
    this.pos.x = damp(this.pos.x, desired.x, lambda, dt);
    this.pos.y = damp(this.pos.y, desired.y, lambda, dt);
    this.pos.z = damp(this.pos.z, desired.z, lambda, dt);
    this.look.x = damp(this.look.x, lookTarget.x, lambda, dt);
    this.look.y = damp(this.look.y, lookTarget.y, lambda, dt);
    this.look.z = damp(this.look.z, lookTarget.z, lambda, dt);
    this.started = true;

    // safety: even the damped in-shot path must never dip under the surface
    const floor = this.terrain.sampleHeight(this.pos.x, this.pos.z) + 1.2;
    if (this.pos.y < floor) this.pos.y = floor;

    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    this.cam.fov = damp(this.cam.fov, cur.fov, cut ? 1000 : 1.6, dt);
    this.cam.updateProjectionMatrix();
  }
}
