import { Track } from '../src/track.js';
import { CRATERS } from '../src/terrain.js';
const track = new Track(); track.build(2).buildHash();
for (let i = 0; i < CRATERS.length; i++) {
  const c = CRATERS[i];
  let best = 1e9;
  for (let j = 0; j < track.count; j += 4) {
    const d = Math.hypot(track.samples.px[j] - c.x, track.samples.pz[j] - c.z);
    if (d < best) best = d;
  }
  const cl = best - c.r;
  console.log(`#${i} (${c.x},${c.z}) r=${c.r} roadDist=${best.toFixed(0)} rimClearance=${cl.toFixed(0)} ${cl < 100 && i > 1 ? '<<< CLOSE' : 'ok'}`);
}
