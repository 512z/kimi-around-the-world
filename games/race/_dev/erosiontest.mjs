import { Terrain } from '../src/terrain.js';
import { Track } from '../src/track.js';
const terrain = new Terrain(); terrain.buildNatural();
const track = new Track(); track.build(2).buildHash();
const { py } = track.samples;
for (let i = 0; i < track.count; i++) py[i] = terrain.sampleHeight(track.samples.px[i], track.samples.pz[i]);
for (let pass = 0; pass < 4; pass++) { const p = py.slice(); for (let i = 0; i < track.count; i++) { py[i] = p[(i-1+track.count)%track.count]*0.25 + p[i]*0.5 + p[(i+1)%track.count]*0.25; } }
const ridgeS = track.nearestS(-504, -1071).s;
const protect = (s) => { let d = Math.abs(s - ridgeS); d = Math.min(d, track.length - d); return d < 70; };
const PASSES = parseInt(process.argv[2] || '900');
for (let pass = 0; pass < PASSES; pass++) {
  const prev = py.slice();
  for (let i = 0; i < track.count; i++) {
    if (protect(track.samples.s[i])) continue;
    const chord = (prev[(i-1+track.count)%track.count] + prev[(i+1)%track.count]) / 2 + 0.001;
    if (py[i] > chord) py[i] = chord;
  }
}
// scan convexity
let worst = 0, worstS = 0;
for (let i = 0; i < track.count; i++) {
  if (protect(track.samples.s[i])) continue;
  const a = py[(i-1+track.count)%track.count], c = py[(i+1)%track.count];
  const conv = py[i] - (a + c) / 2; // >0 means convex-up bump (launches)
  if (conv > worst) { worst = conv; worstS = track.samples.s[i]; }
}
console.log(`passes=${PASSES} worst residual bump: ${worst.toFixed(4)}m at s=${worstS.toFixed(0)} (R≈${(4/(2*Math.max(worst,1e-6))).toFixed(0)}m)`);
