// Cinematic camera: closed Catmull-Rom spline for position + smoothed target spline.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

export const LOOP = 112; // seconds

// keyframes: [x, y, z] positions (y lifted above terrain at init)
const POS_KEYS = [
  [-78.8, 2.5, 121.3], // 0: hero hold — camera on the Earth-opposite side of the ball, ball centered
  [420, 92, 520],      // 1: glide out, Earth still framed
  [250, 55, 330],      // 2: descend toward base
  [130, 26, 180],      // 3: over the module cluster
  [25, 11, 100],       // 4: skim domes & modules
  [-55, 16, -25],      // 5: approach comm tower
  [-108, 12, 35],      // 6: pass tower, still framed on it
  [-140, 7, 185],      // 7: slow drift past pad + lander
  [-148, 4.5, 128],    // 8: rover / astronaut close pass
  [-60, 25, 240],      // 9: rise, looking back over the pad
  [160, 90, 360],      // 10: mid-wide, Earth above base
  [400, 170, 600],     // 11: crater vista with Earth, back to start
];

const TARGET_KEYS = [
  [-87, 6, 110],       // hold frame: looking just above the ball — ball lower-third, Earth directly above it
  [10, 260, -60],
  [30, 15, -20],
  [50, 8, 0],
  [-15, 5, 35],
  [-88, 22, -72],
  [-88, 18, -72],      // hold the tower in frame across two segments
  [-142, 4, 116],
  [-118, 2, 88],
  [0, 10, 40],
  [20, 240, -60],
  [-60, 390, -110],
];

// explicit per-segment durations (sum = LOOP): long slow close passes, brisk wide legs
const SEG_TIMES = [8, 8, 8, 9, 9, 7, 7, 10, 11, 9, 10, 16];

export function createCameraRig() {
  // lift control points safely above terrain
  const posPts = POS_KEYS.map(([x, y, z]) => new THREE.Vector3(x, Math.max(y, heightAt(x, z) + 2.5), z));
  const tgtPts = TARGET_KEYS.map(([x, y, z]) => new THREE.Vector3(x, Math.max(y, heightAt(x, z) + 1.5), z));

  // centripetal Catmull-Rom: no overshoot on wildly spaced keyframes
  const posCurve = new THREE.CatmullRomCurve3(posPts, true, 'centripetal', 0.5);
  const tgtCurve = new THREE.CatmullRomCurve3(tgtPts, true, 'centripetal', 0.5);
  const N = posPts.length;

  const cum = [0];
  for (const d of SEG_TIMES) cum.push(cum[cum.length - 1] + d);

  const camPos = new THREE.Vector3();
  const camTgt = new THREE.Vector3();

  function apply(camera, sceneTime, dt) {
    let tt = ((sceneTime % LOOP) + LOOP) % LOOP;
    let i = 0;
    while (i < SEG_TIMES.length - 1 && tt > cum[i + 1]) i++;
    let lt = (tt - cum[i]) / SEG_TIMES[i];
    // mild ease at segment boundaries for a settled, cut-free feel
    lt += (lt * lt * (3 - 2 * lt) - lt) * 0.35;
    const u = (i + lt) / N;
    posCurve.getPoint(u, camPos);
    tgtCurve.getPoint(u, camTgt);
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    window.__camInfo = { p: camPos.toArray(), t: camTgt.toArray(), seg: i, lt: +lt.toFixed(2) };
  }

  return { apply };
}
