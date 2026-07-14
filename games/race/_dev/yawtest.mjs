import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim } from '../src/car.js';
const fakeMesh = () => ({ position: new THREE.Vector3(), rotation: { set() {} }, rotateX() {}, rotateZ() {}, userData: { wheels: [], flames: [] } });
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track);
const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'YAW' });
const f = track.frameAt(3000);
sim.placeAt(f, 3000);
sim.vel.set(Math.sin(sim.yaw) * 74, 0, Math.cos(sim.yaw) * 74); // 74 m/s forward
const DT = 1/120;
for (let i = 0; i < 120; i++) {
  sim.step({ throttle: 0, brake: 0, steer: -0.75, handbrake: false, boost: false }, DT, env);
  if (i % 12 === 0) console.log(`t=${(i/120).toFixed(1)} yawV=${sim.yawVel.toFixed(3)} spd=${sim.speed.toFixed(1)} dbg=${JSON.stringify(sim._dbg)}`);
}
