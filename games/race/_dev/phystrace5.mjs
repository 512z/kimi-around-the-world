import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim } from '../src/car.js';
import { AIController } from '../src/ai.js';
const fakeMesh = () => ({ position: new THREE.Vector3(), rotation: { set() {} }, rotateX() {}, rotateZ() {}, userData: { wheels: [], flames: [] } });
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track); track.makeCheckpoints(12);
terrain.buildBoulders({ add() {} }, track, 3);
const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'TEST' });
const f0 = track.frameAt(track.length - 16);
sim.placeAt(f0, track.length - 16); sim.totalDist = -16;
sim.ai = new AIController(sim, { skill: 1.0, boldness: 1.0 });
const DT = 1 / 120;
let t = 0;
const ring = [];
for (let i = 0; i < 120 * 130; i++) {
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  t += DT;
  const near = track.nearestS(sim.pos.x, sim.pos.z);
  ring.push({ t, s: sim.s, x: sim.pos.x, z: sim.pos.z, y: sim.pos.y, vy: sim.vel.y, d: near.dist, spd: sim.speedKmh, air: sim.airTime, steer: input.steer, bank: near.frame.bank * 57.3, grnd: sim.grounded, slip: sim.slip });
  if (ring.length > 400) ring.shift();
  if (sim.airTime > 0.6 && sim.vel.y > 1.5) {
    console.log('=== launch event ===');
    for (let j = 0; j < ring.length; j += 12) {
      const r = ring[j];
      console.log(`t=${r.t.toFixed(1)} s=${r.s.toFixed(0)} d=${r.d.toFixed(1)} y=${r.y.toFixed(1)} vy=${r.vy.toFixed(1)} spd=${r.spd.toFixed(0)} air=${r.air.toFixed(2)} steer=${r.steer.toFixed(2)} slip=${r.slip.toFixed(2)} bank=${r.bank.toFixed(0)} g=${r.grnd ? 1 : 0} x=${r.x.toFixed(0)} z=${r.z.toFixed(0)}`);
    }
    break;
  }
}
