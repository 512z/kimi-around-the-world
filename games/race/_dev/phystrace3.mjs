// Dump profile around s=2912 and AI internals around the east-flank departure.
import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim } from '../src/car.js';
import { AIController } from '../src/ai.js';

const fakeMesh = () => ({ position: new THREE.Vector3(), rotation: { set() {} }, rotateX() {}, rotateZ() {}, userData: { wheels: [], flames: [] } });
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track); track.makeCheckpoints(12);

console.log('--- profile s=2700..3100 (every 10m) ---');
let line = '';
for (let i = 0; i < track.count; i++) {
  const s = track.samples.s[i];
  if (s >= 2700 && s <= 3100 && i % 5 === 0) line += `${s.toFixed(0)}:${track.samples.py[i].toFixed(2)}(${(track.samples.bank[i] * 57.3).toFixed(0)}°) `;
}
console.log(line);
console.log('ridgeS =', track.nearestS(-504, -1071).s.toFixed(0));

const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'TEST' });
const f0 = track.frameAt(track.length - 16);
sim.placeAt(f0, track.length - 16); sim.totalDist = -16;
sim.ai = new AIController(sim, { skill: 1.0, boldness: 1.0 });
const DT = 1 / 120;
let t = 0;
for (let i = 0; i < 120 * 100; i++) {
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  t += DT;
  if (t > 50 && t < 62 && i % 15 === 0) {
    const near = track.nearestS(sim.pos.x, sim.pos.z);
    console.log(`t=${t.toFixed(2)} s=${sim.s.toFixed(0)} d=${near.dist.toFixed(1)} spd=${sim.speedKmh.toFixed(0)} steer=${input.steer.toFixed(2)} off=${sim.ai.offset.toFixed(1)} yawV=${sim.yawVel.toFixed(2)} slip=${sim.slip.toFixed(2)} vy=${sim.vel.y.toFixed(1)} y=${sim.pos.y.toFixed(1)} air=${sim.airTime.toFixed(2)}`);
  }
  if (t > 68 && t < 76 && i % 15 === 0) {
    const near = track.nearestS(sim.pos.x, sim.pos.z);
    console.log(`B t=${t.toFixed(2)} s=${sim.s.toFixed(0)} d=${near.dist.toFixed(1)} spd=${sim.speedKmh.toFixed(0)} steer=${input.steer.toFixed(2)} vy=${sim.vel.y.toFixed(1)} y=${sim.pos.y.toFixed(1)} air=${sim.airTime.toFixed(2)} bank=${(near.frame.bank * 57.3).toFixed(0)}`);
  }
}
