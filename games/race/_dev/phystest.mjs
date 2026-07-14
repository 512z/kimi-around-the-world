// Headless physics validation (no rendering): builds the real terrain+track,
// drives CarSim with the real AI controller, reports telemetry.
import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
import { CarSim, LIVERIES } from '../src/car.js';
import { AIController } from '../src/ai.js';

const fakeMesh = () => ({
  position: new THREE.Vector3(),
  rotation: { set() {}, },
  rotateX() {}, rotateZ() {},
  userData: { wheels: [], flames: [] },
});

const terrain = new Terrain();
terrain.buildNatural();
const track = new Track();
track.build(2).buildHash();
track.setHeightsFromTerrain(terrain);
terrain.carve(track);
track.makeCheckpoints(12);
console.log('track length', track.length.toFixed(0), 'm');

const env = { terrain, track };
const sim = new CarSim(fakeMesh(), { name: 'TEST' });
const f0 = track.frameAt(track.length - 16);
sim.placeAt(f0, track.length - 16);
sim.totalDist = -16;
sim.ai = new AIController(sim, { skill: 1.0, boldness: 1.0 });

const DT = 1 / 120;
let maxSpeed = 0, maxAir = 0, airStart = 0, airs = [], lapT = 0, lastS = sim.s;
let t = 0, maxY = -1e9, nan = false, ridgeAir = 0;
let biggestStep = 0;
let prevY = sim.pos.y;
const sHist = [];
let offRoadT = 0, resets = 0;

for (let i = 0; i < 120 * 200; i++) { // up to 200s
  const input = sim.ai.computeInput(env, [sim]);
  sim.step(input, DT, env);
  // mirror game.js safety net
  const nr = track.nearestS(sim.pos.x, sim.pos.z);
  if (nr.dist > nr.frame.hw + 3) offRoadT += DT; else offRoadT = 0;
  if (offRoadT > 6 || sim.stuckTimer > 5) { sim.resetToTrack(env); offRoadT = 0; sim.stuckTimer = 0; resets++; }
  t += DT;
  if (!isFinite(sim.pos.x + sim.pos.y + sim.vel.x)) { nan = true; break; }
  maxSpeed = Math.max(maxSpeed, sim.speedKmh);
  maxY = Math.max(maxY, sim.pos.y);
  const stepY = Math.abs(sim.pos.y - prevY); prevY = sim.pos.y;
  biggestStep = Math.max(biggestStep, stepY / DT);
  if (!sim.grounded) { maxAir = Math.max(maxAir, sim.airTime); if (sim.airTime < DT * 1.5) airStart = t; }
  else if (maxAir > 0.3 && sim.airTime === 0) { airs.push(+maxAir.toFixed(2)); maxAir = 0; }
  // ridge zone airtime (near s where ridge is: straight after gantry)
  let ds = sim.s - lastS;
  if (ds > track.length / 2) ds -= track.length;
  if (ds < -track.length / 2) ds += track.length;
  sim.totalDist += ds;
  lastS = sim.s;
  if (sim.totalDist > track.length && lapT === 0) lapT = t;
  if (i % 600 === 0) sHist.push(`t=${t.toFixed(0)}s s=${sim.s.toFixed(0)} spd=${sim.speedKmh.toFixed(0)} air=${sim.airTime.toFixed(2)} y=${sim.pos.y.toFixed(1)}`);
}

console.log('NaN:', nan, 'resets:', resets);
console.log('max speed km/h:', maxSpeed.toFixed(0));
console.log('lap time:', lapT ? lapT.toFixed(1) + 's' : 'NOT COMPLETED in 200s');
console.log('max y:', maxY.toFixed(1), 'biggest vertical step m/s:', biggestStep.toFixed(0));
console.log('airtime events >0.3s:', airs.join(', ') || 'none');
console.log('samples:', sHist.join(' | '));

// off-road test: drive straight off the edge
const sim2 = new CarSim(fakeMesh(), { name: 'OFFROAD' });
const f1 = track.frameAt(100);
sim2.placeAt(f1, 100);
let maxBump = 0, py = sim2.pos.y;
for (let i = 0; i < 120 * 12; i++) {
  sim2.step({ throttle: 1, brake: 0, steer: 0.35, handbrake: false, boost: false }, DT, env);
  maxBump = Math.max(maxBump, Math.abs(sim2.pos.y - py) * 120); py = sim2.pos.y;
  if (!isFinite(sim2.pos.x)) { console.log('OFFROAD NaN!'); break; }
}
console.log('offroad: end speed', sim2.speedKmh.toFixed(0), 'km/h, max vert step m/s:', maxBump.toFixed(0), 'offroad=', sim2.offroad.toFixed(2));

// boulder ram test: teleport onto a boulder
const sim3 = new CarSim(fakeMesh(), { name: 'RAM' });
const b = terrain.boulders.length ? null : null;
terrain.buildBoulders({ add() {} }, track, 3);
const bld = [...terrain.boulderHash.values()].flat()[0];
sim3.pos.set(bld.x - bld.r - 0.5, terrain.sampleHeight(bld.x, bld.z) + 0.5, bld.z);
sim3.vel.set(30, 0, 0); sim3.yaw = Math.PI / 2;
for (let i = 0; i < 120 * 3; i++) sim3.step({ throttle: 1, brake: 0, steer: 0, handbrake: false, boost: false }, DT, env);
console.log('boulder ram: end pos finite:', isFinite(sim3.pos.x + sim3.pos.z), 'speed:', sim3.speedKmh.toFixed(0));
