// Deep instrumentation: bowl-entry flight diagnosis.
import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim } from '../src/car.js';
import { AIController } from '../src/ai.js';

const fakeMesh = () => ({ position: new THREE.Vector3(), rotation: { set() {} }, rotateX() {}, rotateZ() {}, userData: { wheels: [], flames: [] } });

const terrain = new Terrain();
terrain.buildNatural();
const track = new Track();
track.build(2).buildHash();
track.setHeightsFromTerrain(terrain);
terrain.carve(track);
track.makeCheckpoints(12);

// dump road profile through the bowl entry
const py = track.samples.py, sArr = track.samples.s;
console.log('--- profile s=4700..5600 ---');
let line = '';
for (let i = 0; i < track.count; i++) {
  if (sArr[i] >= 4700 && sArr[i] <= 5600 && i % 25 === 0) line += `s=${sArr[i].toFixed(0)} y=${py[i].toFixed(1)} bank=${(track.samples.bank[i]*57.3).toFixed(0)}  `;
}
console.log(line);

const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'TEST' });
const f0 = track.frameAt(track.length - 16);
sim.placeAt(f0, track.length - 16);
sim.totalDist = -16;
sim.ai = new AIController(sim, { skill: 1.0, boldness: 1.0 });

const DT = 1 / 120;
let t = 0;
let events = [];
for (let i = 0; i < 120 * 200; i++) {
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  t += DT;
  const near = track.nearestS(sim.pos.x, sim.pos.z);
  if (sim.airTime > 0.9 && sim.airTime - DT <= 0.9 + 1e-6) {
    events.push(`AIR-START t=${t.toFixed(1)} s=${sim.s.toFixed(0)} dist=${near.dist.toFixed(1)} y=${sim.pos.y.toFixed(1)} vy=${sim.vel.y.toFixed(1)} vxz=${Math.hypot(sim.vel.x, sim.vel.z).toFixed(1)} offroad=${sim.offroad.toFixed(2)} x=${sim.pos.x.toFixed(0)} z=${sim.pos.z.toFixed(0)}`);
  }
  if (sim.airTime > 1.2 && i % 30 === 0) {
    events.push(`  air t=${t.toFixed(1)} s=${sim.s.toFixed(0)} dist=${near.dist.toFixed(1)} y=${sim.pos.y.toFixed(1)} vy=${sim.vel.y.toFixed(1)} vxz=${Math.hypot(sim.vel.x, sim.vel.z).toFixed(1)}`);
  }
  if (sim.impact > 0.5) events.push(`IMPACT t=${t.toFixed(1)} s=${sim.s.toFixed(0)} imp=${sim.impact.toFixed(2)} y=${sim.pos.y.toFixed(1)} dist=${near.dist.toFixed(1)}`);
}
console.log('--- events ---');
console.log(events.slice(0, 60).join('\n'));
