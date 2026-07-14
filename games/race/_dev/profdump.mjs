import * as THREE from '../vendor/three.module.js';
import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash(); track.setHeightsFromTerrain(terrain); terrain.carve(track);
let line = '';
for (let i = 0; i < track.count; i++) {
  const s = track.samples.s[i];
  if (s >= 6400 && s <= 8700 && i % 40 === 0) {
    const x = track.samples.px[i], z = track.samples.pz[i];
    line += `s=${s.toFixed(0)} prof=${track.samples.py[i].toFixed(0)} terr=${terrain.sampleHeight(x, z).toFixed(0)} bank=${(track.samples.bank[i]*57.3).toFixed(0)}  `;
  }
}
console.log(line);
