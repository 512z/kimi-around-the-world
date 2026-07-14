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
for (let i = 0; i < 120 * 130; i++) {
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  t += DT;
  if (t > 88 && i % 60 === 0) {
    const near = track.nearestS(sim.pos.x, sim.pos.z);
    const dot = Math.sin(sim.yaw) * near.frame.tx + Math.cos(sim.yaw) * near.frame.tz;
    // nearest boulder
    const bs = terrain.bouldersNear(sim.pos.x, sim.pos.z, 12, []);
    let nb = '';
    for (const b of bs) { const d = Math.hypot(sim.pos.x - b.x, sim.pos.z - b.z); if (d < b.r + 6) nb += ` B@${d.toFixed(1)}(r${b.r.toFixed(1)})`; }
    console.log(`t=${t.toFixed(0)} s=${sim.s.toFixed(0)} x=${sim.pos.x.toFixed(0)} z=${sim.pos.z.toFixed(0)} y=${sim.pos.y.toFixed(1)} d=${near.dist.toFixed(1)} spd=${sim.speedKmh.toFixed(0)} dot=${dot.toFixed(2)} steer=${input.steer.toFixed(2)} thr=${input.throttle} brk=${input.brake.toFixed(1)}${nb}`);
  }
}
