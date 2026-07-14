// SELENE GP — AI driver. Produces the same input struct a human would,
// driving the identical CarSim physics: lookahead steering + corner-speed judgment.

import { clamp, clamp01, angleWrap } from './util.js';

const G = 2.6;
const MAGLEV = 0.0042;

export class AIController {
  constructor(car, opts = {}) {
    this.car = car;
    this.skill = opts.skill ?? 0.96;          // top-speed factor
    this.boldness = opts.boldness ?? 0.94;    // corner speed factor
    this.offset = 0;                          // lateral racing-line offset
    this.targetOffset = 0;
    this.offsetTimer = 0;
    this.recoverTimer = 0;
  }

  computeInput(env, rivals) {
    const car = this.car;
    const track = env.track;
    const sp = car.speed;
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

    // recovery from stuck / spun
    if (car.stuckTimer > 1.6) this.recoverTimer = 1.2;
    if (this.recoverTimer > 0) {
      this.recoverTimer -= 1 / 120;
      input.throttle = 0.2;
      input.steer = Math.sin(this.recoverTimer * 9) * 0.8;
      if (car.stuckTimer > 3.2) { car.resetToTrack(env); car.stuckTimer = 0; this.recoverTimer = 0; }
      return input;
    }

    // curvature analysis ahead — worst case over several lookaheads
    const la1 = 26 + sp * 0.55;
    const f0 = track.frameAt(car.s);
    const hAt = (ahead) => { const f = track.frameAt(car.s + ahead); return Math.atan2(f.tx, f.tz); };
    const h0 = Math.atan2(f0.tx, f0.tz);
    const hA = hAt(la1 * 0.5), hB = hAt(la1), hC = hAt(la1 * 1.8);
    const curv = Math.max(
      Math.abs(angleWrap(hA - h0)) / (la1 * 0.5),
      Math.abs(angleWrap(hB - hA)) / (la1 * 0.5),
      Math.abs(angleWrap(hC - hB)) / (la1 * 0.8),
    );
    const f1 = track.frameAt(car.s + la1);
    const f2 = track.frameAt(car.s + la1 * 2.1);

    // corner target speed from the same grip budget the sim uses (with margin)
    const bankBonus = 1 + Math.abs(Math.tan(f1.bank)) * 0.55;
    const aLat = (G + MAGLEV * sp * sp) * 1.18 * bankBonus * 0.85;
    let vCorner = curv > 1e-4 ? Math.sqrt(aLat * this.boldness / curv) : 999;
    const vTop = 87 * this.skill;
    let vTarget = Math.min(vTop, vCorner);

    // overtake / traffic: look for cars ahead within 55m
    let ahead = null, aheadGap = Infinity;
    for (const r of rivals) {
      if (r === car) continue;
      let ds = r.totalDist - car.totalDist;
      if (ds > 0 && ds < aheadGap) { aheadGap = ds; ahead = r; }
    }
    const near = track.nearestS(car.pos.x, car.pos.z);
    const offRoadNow = near.dist > near.frame.hw + 3;
    const passSide = Math.sin(car.s * 0.013 + car.color) > 0 ? 1 : -1;
    if (offRoadNow) {
      this.targetOffset = 0;
      vTarget = Math.min(vTarget, 40);
      // big slip off-road: point the body into the slide so grip can bite again
      const vAng = Math.atan2(car.vel.x, car.vel.z);
      const slipAng = angleWrap(vAng - car.yaw);
      if (Math.abs(slipAng) > 0.5 && sp > 14) {
        input.steer = clamp(slipAng * 1.1, -0.85, 0.85);
        input.throttle = 0.35;
        return input;
      }
      // gentle merge: aim well ahead on the centerline, low-gain steering
      const laM = clamp(sp * 1.1, 30, 80);
      const fm = track.frameAt(car.s + laM);
      const errM = angleWrap(Math.atan2(fm.x - car.pos.x, fm.z - car.pos.z) - car.yaw);
      input.steer = clamp(errM * 1.0 - car.yawVel * 0.45, -0.45, 0.45);
      input.throttle = sp < vTarget ? 0.8 : 0.2;
      return input;
    } else if (ahead && aheadGap < 55) {
      this.targetOffset = passSide * clamp(9 - aheadGap * 0.08, 5.5, 9);
      if (aheadGap < 26 && sp > ahead.speed) vTarget = Math.min(vTarget, ahead.speed * 0.98);
      // use boost to complete a pass
      if (aheadGap < 30 && car.boost > 0.4 && curv < 0.004) input.boost = true;
    } else if (this.offsetTimer <= 0) {
      // racing line: drift slightly toward inside of upcoming turn
      // (heading angle h=atan2(tx,tz) DECREASES in a left turn; inside of a
      // left turn is the -right-vector side, so offset follows +turn).
      // Keep tiny in sharp turns — the inside is where the craters are.
      const turn = angleWrap(hC - h0);
      const sharp = clamp01(curv / 0.003);
      this.targetOffset = clamp(turn * 18, -4, 4) * (1 - sharp * 0.75);
      this.offsetTimer = 0.5;
    }
    this.offsetTimer -= 1 / 120;
    this.offset += (this.targetOffset - this.offset) * 0.025;

    // side-by-side separation
    for (const r of rivals) {
      if (r === car) continue;
      const ds = Math.abs(r.totalDist - car.totalDist);
      if (ds < 5.5) {
        const lat = (r.pos.x - car.pos.x) * f0.rx + (r.pos.z - car.pos.z) * f0.rz;
        if (Math.abs(lat) < 4.2) {
          this.offset -= Math.sign(lat || 1) * 0.35;
          vTarget = Math.min(vTarget, sp + 2);
        }
      }
    }

    // aim point with offset — off-road: aim far ahead so the rejoin angle is shallow
    const laAim = la1 * 0.8;
    const look = track.frameAt(car.s + laAim);
    const off = clamp(this.offset, -look.hw + 3, look.hw - 3);
    const ax = look.x + look.rx * off;
    const az = look.z + look.rz * off;
    const aimAng = Math.atan2(ax - car.pos.x, az - car.pos.z);
    let err = angleWrap(aimAng - car.yaw);
    // correct if facing away from the track
    const headDot = Math.sin(car.yaw) * f0.tx + Math.cos(car.yaw) * f0.tz;
    if (headDot < -0.2) err += Math.sign(err || 1) * 0.8;
    // steer with yaw-rate + lateral-slip damping so fast rejoins don't overshoot
    const latVel = car.vel.x * f0.rx + car.vel.z * f0.rz; // m/s across the road
    const slipDamp = clamp(latVel * 0.045, -0.55, 0.55);
    const steerCap = offRoadNow ? 0.55 : 1.0;
    input.steer = clamp(err * 1.35 - car.yawVel * 0.55 - slipDamp, -steerCap, steerCap);

    // throttle / brake
    if (sp < vTarget * 0.985) {
      input.throttle = 1;
      if (sp < vTarget * 0.8 && car.boost > 0.55 && curv < 0.0035 && this.boldness > 1) input.boost = true;
    } else if (sp > vTarget * 1.04) {
      input.brake = clamp01((sp - vTarget) / 18);
      input.throttle = 0;
    } else {
      input.throttle = 0.55;
    }

    // handbrake into the tight hairpin when carrying too much speed
    if (curv > 0.021 && sp > vTarget * 1.12 && sp > 22) {
      input.handbrake = true;
      input.brake = Math.max(input.brake, 0.35);
    }

    return input;
  }
}
