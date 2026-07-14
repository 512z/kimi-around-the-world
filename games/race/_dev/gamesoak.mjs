// Node full-game soak: runs the REAL Game class with stubbed env for 3 laps
// of game time. Exercises 8-car traffic, car-car collisions, checkpoints,
// lap logic, standings, resets and results — no rendering needed.
import * as THREE from '../vendor/three.module.js';

// --- minimal DOM/canvas stubs for CanvasTexture-based name tags ---
const ctxStub = new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : () => {}) });
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub, style: {} }) };
global.window = { devicePixelRatio: 1 };

const { Terrain } = await import('../src/terrain.js');
const { Track } = await import('../src/track.js');
const { Game } = await import('../src/game.js');

const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track);
terrain.buildBoulders({ add() {} }, track);

const resultsLog = { called: false, data: null };
const menu = {
  showScreen() {}, showCountdown() {}, showNotice() {},
  setResults(d) { resultsLog.called = true; resultsLog.data = d; },
  updateHud() {}, setMinimap() {},
};
const audio = new Proxy({}, { get: () => () => {} });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1.7, 0.5, 90000);

const game = new Game({ scene, camera, terrain, track, audio, menu, autopilot: true });
game.startRace();

const DT = 1 / 60;
let t = 0, lastLog = 0, maxY = -1e9, nan = false, resetsSeen = new Set();
let firstLapT = null, finishT = null, prevLapP = 0;
const lapMarks = [];
while (t < 900 && game.state !== 'results') {
  game.update(DT);
  t += DT;
  for (const c of game.cars) {
    if (!isFinite(c.pos.x + c.pos.y + c.pos.z + c.vel.x)) { nan = true; console.log('NaN on', c.name, 'at t=', t.toFixed(1)); break; }
    if (Math.abs(c.pos.y) > maxY) maxY = Math.abs(c.pos.y);
    if (c.offRoadT > 6 && !resetsSeen.has(c.name)) { resetsSeen.add(c.name); console.log(`reset: ${c.name} at t=${t.toFixed(0)} s=${c.s.toFixed(0)}`); }
  }
  if (nan) break;
  const p = game.player;
  if (p.lap > prevLapP) { lapMarks.push(t.toFixed(1)); prevLapP = p.lap; }
  if (t - lastLog > 30) {
    lastLog = t;
    const ord = game.order.map(c => c.name).join(',');
    console.log(`t=${t.toFixed(0)} st=${game.state} P${game.order.indexOf(p) + 1} lap=${p.lap} cp=${p.cpIndex} spd=${p.speedKmh.toFixed(0)} | order: ${ord}`);
  }
}
console.log('---');
console.log('final state:', game.state, 'at t=', t.toFixed(1));
console.log('player laps at:', lapMarks.join(', ') || 'none');
console.log('player lapTimes:', game.player.lapTimes.map(x => x.toFixed(2)).join(', '));
console.log('bestLap:', game.bestLap?.toFixed(2));
console.log('results called:', resultsLog.called);
if (resultsLog.data) {
  console.log('results: position', resultsLog.data.position, '/', resultsLog.data.total, 'totalTime', resultsLog.data.totalTime?.toFixed(2));
  console.log('standings:', resultsLog.data.standings.map(s => `${s.name}:${s.time ? s.time.toFixed(1) : 'DNF'}${s.isPlayer ? '*' : ''}`).join(' '));
}
console.log('max |y|:', maxY.toFixed(1), 'NaN:', nan, 'resets:', resetsSeen.size);
