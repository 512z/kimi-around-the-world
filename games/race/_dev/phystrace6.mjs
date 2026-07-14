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
  if (t > 66 && t < 84 && i % 30 === 0) {
    const near = track.nearestS(sim.pos.x, sim.pos.z);
    // recompute AI internals
    const sp = sim.speed;
    const la1 = 26 + sp * 0.55;
    const hAt = (a) => { const f = track.frameAt(sim.s + a); return Math.atan2(f.tx, f.tz); };
    const h0 = hAt(0);
    const curv = Math.max(Math.abs((hAt(la1*0.5)-h0)), Math.abs(hAt(la1)-hAt(la1*0.5)), Math.abs(hAt(la1*1.8)-hAt(la1))) / (la1*0.5);
    const aLat = (2.6 + 0.0034*sp*sp)*1.18*0.85;
    const vCorner = Math.sqrt(aLat*sim.ai.boldness/Math.max(curv,1e-4));
    const yawErr = Math.abs(((Math.atan2(track.frameAt(sim.s+la1*0.8).tx, track.frameAt(sim.s+la1*0.8).tz)) - sim.yaw + Math.PI*3) % (Math.PI*2) - Math.PI);
    console.log(`t=${t.toFixed(1)} s=${sim.s.toFixed(0)} d=${near.dist.toFixed(1)} spd=${sim.speedKmh.toFixed(0)} curv=${curv.toFixed(4)} vC=${vCorner.toFixed(0)} steer=${input.steer.toFixed(2)} yawV=${sim.yawVel.toFixed(2)} slip=${sim.slip.toFixed(2)} thr=${input.throttle} brk=${input.brake.toFixed(2)} hb=${input.handbrake?1:0}`);
  }
}
