// VENICE SPEED — AI gondola drivers for the solo regatta (lobby ?solo=1 handoff).
// Three local bots pole the same point-to-point course as the player: centerline
// lookahead steering, wall shove-offs, boat separation — and the same oar/tide/
// drag physics constants the player's boat uses in game.js.
import * as THREE from 'three';
import { makeGondola, BOAT_SCALE } from '../scene/gondola.js';
import { makeKimiPilot, makeNameSprite } from '../net.js';
import { DOCKS, BRIDGES } from '../scene/canal.js';

// physics mirrors game.js (oar thrust, rudder, hull probes, wall restitution)
const THRUST = 8.0;
const BACK_POLE = 3.5;
const YAW = 2.4;
const HULL_F = 3.8 * BOAT_SCALE + 0.4;
const HULL_S = 0.7 * BOAT_SCALE;
const LOOKAHEAD = 11;                 // m of centerline to steer toward
const SKILLS = [0.88, 0.82, 0.76];    // per-bot throttle trim — quick but beatable

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function makeAIFleet({ canal, scene, world, npcs, finishS, player }) {
  const bots = npcs.map((n, i) => {
    const color = n.color >>> 0;
    const hex = '#' + color.toString(16).padStart(6, '0');
    const boat = makeGondola(world.textures, { physical: false });
    boat.visible = false;
    scene.add(boat);
    const pilot = makeKimiPilot(hex);
    pilot.root.position.set(0, 0.5, -0.2); // amidships, same as the local pilot
    pilot.root.scale.setScalar(1 / BOAT_SCALE);
    boat.add(pilot.root);
    const tag = makeNameSprite(n.name.toUpperCase());
    tag.position.set(0, 2.3, 0);
    tag.scale.multiplyScalar(1 / BOAT_SCALE);
    boat.add(tag);
    const b = {
      id: 'bot' + i, name: n.name.toUpperCase(), color,
      boat, pilot, tag,
      x: 0, z: 0, vx: 0, vz: 0, heading: 0, omega: 0, speed: 0, s: 0,
      blockT: 0, shoveCd: 0, stuckT: 0, reverseT: 0,
      skill: SKILLS[i % SKILLS.length],
      finished: false, finishTime: Infinity,
      polePhase: Math.random(),
      // item hits (same numbers items.js applies to human victims)
      hitWave(fx, fz) {
        b.vx += fx * 4.2; b.vz += fz * 4.2;
        b.omega += 3.2;
        b.blockT = Math.max(b.blockT, 1.4);
      },
      hitAnchor() {
        b.vx *= 0.1; b.vz *= 0.1;
        b.blockT = Math.max(b.blockT, 2.2);
      },
      hitWhirl() {
        b.omega += 3.4;
        b.blockT = Math.max(b.blockT, 1.7);
      },
      teleport(x, z, heading) {
        b.x = x; b.z = z; b.heading = heading;
        const sp = Math.hypot(b.vx, b.vz) * 0.4;
        b.vx = Math.sin(heading) * sp; b.vz = Math.cos(heading) * sp;
        b.omega = 0;
      },
    };
    return b;
  });

  // grid slots like the relay assigns: player takes slot 0, bots 1..3
  function spawn() {
    bots.forEach((b, i) => {
      const slot = i + 1;
      const sm = canal.atS(DOCKS[0].s + 6 + Math.floor(slot / 2) * 7);
      const lat = (slot % 2 === 0 ? -1 : 1) * 1.6;
      b.x = sm.x + Math.cos(sm.ang) * lat;
      b.z = sm.z - Math.sin(sm.ang) * lat;
      b.vx = b.vz = 0; b.heading = sm.ang; b.omega = 0; b.speed = 0;
      b.s = DOCKS[0].s + 6;
      b.blockT = 0; b.shoveCd = 0; b.stuckT = 0; b.reverseT = 0;
      b.finished = false; b.finishTime = Infinity;
      b.boat.visible = true;
      syncVisual(b, 0, false);
    });
    clock = 0;
  }

  function setVisible(v) {
    for (const b of bots) b.boat.visible = v;
  }

  // ---------- walls + bridge piers (mirror of game.js collide) ----------
  const PX = new Float64Array(5), PZ = new Float64Array(5);
  function collideWalls(b) {
    PX[0] = b.x; PZ[0] = b.z;
    PX[1] = b.x + Math.sin(b.heading) * HULL_F; PZ[1] = b.z + Math.cos(b.heading) * HULL_F;
    PX[2] = b.x - Math.sin(b.heading) * HULL_F; PZ[2] = b.z - Math.cos(b.heading) * HULL_F;
    PX[3] = b.x + Math.cos(b.heading) * HULL_S; PZ[3] = b.z - Math.sin(b.heading) * HULL_S;
    PX[4] = b.x - Math.cos(b.heading) * HULL_S; PZ[4] = b.z + Math.sin(b.heading) * HULL_S;
    for (let k = 0; k < 5; k++) {
      const w = canal.wallsAt(PX[k], PZ[k]);
      for (const side of [w.left, w.right]) {
        let limit = 0.55;
        for (const br of BRIDGES) {
          const sm = canal.nearestS(PX[k], PZ[k]);
          if (Math.abs(sm.s - br.s) < br.thick / 2 + 1.2) limit += br.pier;
        }
        if (side.dist < limit) {
          const pen = limit - side.dist;
          b.x += side.nx * pen;
          b.z += side.nz * pen;
          const vn = b.vx * side.nx + b.vz * side.nz;
          if (vn < 0) {
            b.vx -= 1.35 * vn * side.nx;
            b.vz -= 1.35 * vn * side.nz;
            b.omega += (Math.random() - 0.5) * (-vn) * 0.6;
          }
        }
      }
    }
    // cornered? shove off the wall like the player's Space
    if (b.shoveCd > 0) b.shoveCd -= 1 / 60;
    else {
      const w = canal.wallsAt(b.x, b.z);
      const side = w.left.dist < w.right.dist ? w.left : w.right;
      if (side.dist < 1.0) {
        b.vx += side.nx * 3.4;
        b.vz += side.nz * 3.4;
        b.omega += (side === w.left ? -1 : 1) * 0.9;
        world.water.addWake(b.x, b.z, 1.0);
        b.shoveCd = 2.5;
      }
    }
  }

  // ---------- other boats: capsule along their centerline ----------
  function pushOutOfBoat(b, ox, oz, oh) {
    const fx = Math.sin(oh), fz = Math.cos(oh);
    const dx = b.x - ox, dz = b.z - oz;
    const along = THREE.MathUtils.clamp(dx * fx + dz * fz, -4.0 * BOAT_SCALE, 4.0 * BOAT_SCALE);
    const px = ox + fx * along, pz = oz + fz * along;
    let nx = b.x - px, nz = b.z - pz;
    const d = Math.hypot(nx, nz) || 1e-4;
    const limit = 0.85 + HULL_S;
    if (d < limit) {
      nx /= d; nz /= d;
      b.x += nx * (limit - d);
      b.z += nz * (limit - d);
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        b.vx -= 1.3 * vn * nx;
        b.vz -= 1.3 * vn * nz;
        b.omega += (Math.random() - 0.5) * (-vn) * 0.5;
        world.water.addWake(px, pz, 0.8);
      }
    }
  }

  // ---------- one bot tick ----------
  function step(b, dt, racing) {
    const near = canal.nearestS(b.x, b.z);
    b.s = near.s;
    if (racing && !b.finished && b.s >= finishS) {
      b.finished = true;
      b.finishTime = clock;
    }

    // --- decide inputs
    let throttle = 0, yawIn = 0;
    if (racing && !b.finished && b.blockT <= 0) {
      const laS = Math.min(b.s + LOOKAHEAD, finishS + 6);
      const tm = canal.atS(laS);
      let tx = tm.x, tz = tm.z;
      throttle = b.skill;
      // wall shyness: probe a boat-length ahead, bend the target off the wall
      const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
      const w = canal.wallsAt(b.x + fx * 4.5, b.z + fz * 4.5);
      const nearWall = Math.min(w.left.dist, w.right.dist);
      if (nearWall < 2.2) {
        const side = w.left.dist < w.right.dist ? w.left : w.right;
        tx += side.nx * (2.2 - nearWall) * 3;
        tz += side.nz * (2.2 - nearWall) * 3;
        throttle *= 0.55;
      }
      // ease off for tight curvature
      const bend = Math.abs(angDiff(tm.ang, near.sample.ang));
      if (bend > 0.3) throttle *= THREE.MathUtils.clamp(1 - (bend - 0.3) * 0.9, 0.45, 1);
      // separation from the player + the other bots
      for (const o of others) {
        if (o === b) continue;
        const ox = b.x - o.x, oz = b.z - o.z;
        const d = Math.hypot(ox, oz);
        if (d < 4 && d > 1e-3) {
          tx += (ox / d) * (4 - d) * 1.5;
          tz += (oz / d) * (4 - d) * 1.5;
        }
      }
      // stuck nose-in? back-pole out of it
      if (b.reverseT > 0) {
        b.reverseT -= dt;
      } else if (b.speed < 0.35) {
        b.stuckT += dt;
        if (b.stuckT > 2.2) { b.reverseT = 0.7; b.stuckT = 0; }
      } else b.stuckT = 0;
      const want = Math.atan2(tx - b.x, tz - b.z);
      yawIn = THREE.MathUtils.clamp(angDiff(want, b.heading) * 2.4, -1, 1);
    }

    // --- oar (mirrors game.js stroke)
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    const rudder = 0.35 + 0.65 * Math.min(1, b.speed / 1.5);
    const thrust = b.reverseT > 0 ? -BACK_POLE : throttle * THRUST;
    if (thrust !== 0 || yawIn !== 0) {
      b.vx += fx * thrust * dt;
      b.vz += fz * thrust * dt;
      b.omega += yawIn * YAW * rudder * dt;
      b.omega = THREE.MathUtils.clamp(b.omega, -1.3, 1.3);
      if (thrust > 1 && Math.random() < thrust * dt * 0.18) {
        world.water.addWake(
          b.x - Math.cos(b.heading) * 1.2 - fx * 2,
          b.z + Math.sin(b.heading) * 1.2 - fz * 2,
          0.35,
        );
      }
    }
    if (b.reverseT > 0) { // back-pole drags the blade: extra braking
      const drag = Math.min(1, 3.5 * dt);
      b.vx *= 1 - drag; b.vz *= 1 - drag;
      b.omega *= 1 - Math.min(1, 2.5 * dt);
    }

    // --- tide (mirrors game.js tideAccel; only pushes while racing)
    if (racing) {
      const targetDir = near.s < 300 ? 1 : -1;
      const cvx = Math.sin(near.sample.ang) * targetDir * 0.42;
      const cvz = Math.cos(near.sample.ang) * targetDir * 0.42;
      b.vx += (cvx - b.vx) * 0.28 * dt;
      b.vz += (cvz - b.vz) * 0.28 * dt;
    }

    // --- integrate (mirrors game.js)
    const sp = Math.hypot(b.vx, b.vz);
    const dragF = 0.5 * sp + 0.22 * sp * sp;
    if (sp > 1e-4) {
      b.vx -= (b.vx / sp) * dragF * dt;
      b.vz -= (b.vz / sp) * dragF * dt;
    }
    if (sp > 0.4) {
      const d = angDiff(Math.atan2(b.vx, b.vz), b.heading);
      b.omega += d * Math.min(1, sp * 0.5) * dt;
    }
    b.omega *= Math.exp(-2.4 * dt);
    b.heading += b.omega * dt;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.speed = Math.hypot(b.vx, b.vz);

    collideWalls(b);
    pushOutOfBoat(b, player.x, player.z, player.heading);
    for (const o of bots) if (o !== b) pushOutOfBoat(b, o.x, o.z, o.heading);
    if (world.npcBoat) pushOutOfBoat(b, world.npcBoat.position.x, world.npcBoat.position.z, world.npcBoat.rotation.y);
    for (const m of world.moored || []) pushOutOfBoat(b, m.position.x, m.position.z, m.rotation.y);

    if (b.blockT > 0) b.blockT -= dt;
  }

  // ---------- visuals ----------
  function syncVisual(b, dt, racing) {
    b.boat.position.set(b.x, Math.sin(performance.now() * 0.001 + b.polePhase * 7) * 0.02, b.z);
    b.boat.rotation.y = b.heading;
    b.boat.rotation.z = THREE.MathUtils.lerp(
      b.boat.rotation.z,
      -b.omega * 0.25 - (b.vx * Math.cos(b.heading) - b.vz * Math.sin(b.heading)) * 0.05,
      0.1,
    );
    b.boat.rotation.x = THREE.MathUtils.lerp(b.boat.rotation.x, b.speed * 0.012, 0.05);
    const stroking = racing && !b.finished && b.blockT <= 0;
    if (stroking) b.polePhase = (b.polePhase + dt * 0.85) % 1;
    b.pilot.update(dt, stroking
      ? { mode: 'pole', phase: b.polePhase, intensity: Math.min(1, b.speed / 2) }
      : { mode: 'idle' });
    const oar = b.boat.userData.oar;
    if (oar) {
      const targetY = stroking ? 0.5 + Math.sin(b.polePhase * Math.PI * 2) * 0.45 : 0.5;
      oar.rotation.y = THREE.MathUtils.lerp(oar.rotation.y, targetY, 0.2);
    }
  }

  let clock = 0;
  const others = []; // player-shaped {x,z} + bots, for separation
  function update(dt, racing) {
    if (racing) clock += dt;
    others.length = 0;
    others.push(player, ...bots);
    for (const b of bots) {
      step(b, dt, racing);
      syncVisual(b, dt, racing);
    }
  }

  return { bots, spawn, update, setVisible, get clock() { return clock; } };
}
