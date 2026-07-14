// Find exactly where/why the AI leaves the road.
import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim } from '../src/car.js';
import { AIController } from '../src/ai.js';

const fakeMesh = () => ({ position: new THREE.Vector3(), rotation: { set() {} }, rotateX() {}, rotateZ() {}, userData: { wheels: [], flames: [] } });
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track); track.makeCheckpoints(12);
const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'TEST' });
const f0 = track.frameAt(track.length - 16);
sim.placeAt(f0, track.length - 16); sim.totalDist = -16;
sim.ai = new AIController(sim, { skill: 1.0, boldness: 1.0 });

const DT = 1 / 120;
let t = 0, leftRoad = false;
for (let i = 0; i < 120 * 120; i++) {
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  t += DT;
  const near = track.nearestS(sim.pos.x, sim.pos.z);
  const hw = near.frame.hw;
  if (!leftRoad && near.dist > hw + 3) {
    leftRoad = true;
    console.log(`LEFT ROAD t=${t.toFixed(1)} s=${sim.s.toFixed(0)} dist=${near.dist.toFixed(1)} hw=${hw} spd=${sim.speedKmh.toFixed(0)} steer=${input.steer.toFixed(2)} thr=${input.throttle} brk=${input.brake.toFixed(2)} hb=${input.handbrake}`);
  }
  if (leftRoad && near.dist < hw - 3) { leftRoad = false; console.log(`back on t=${t.toFixed(1)} s=${sim.s.toFixed(0)}`); }
  if (i % 120 === 0 && t < 100) {
    const dot = Math.sin(sim.yaw) * near.frame.tx + Math.cos(sim.yaw) * near.frame.tz;
    console.log(`t=${t.toFixed(0)} s=${sim.s.toFixed(0).padStart(4)} d=${near.dist.toFixed(1).padStart(5)} off=${sim.offroad.toFixed(2)} spd=${sim.speedKmh.toFixed(0).padStart(3)} y=${sim.pos.y.toFixed(1).padStart(6)} steer=${input.steer.toFixed(2)} dot=${dot.toFixed(2)} off2=${sim.ai.offset.toFixed(1)}`);
  }
}
