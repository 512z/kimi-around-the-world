// Verify the four fixes: attract-cam ground clearance across shot cuts,
// barrier rails above terrain, rocket homing hits, race-mode sanity.
// Usage: node _dev/fixcheck.mjs [attractSeconds] [raceSeconds]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const attractSec = parseFloat(process.argv[2] || '45');
const raceSec = parseFloat(process.argv[3] || '90');
mkdirSync(new URL('./shots/', import.meta.url).pathname, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) logs.push('[error] ' + m.text()); });

await page.goto('http://localhost:8140/index.html', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => !!window.SELENE).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log('booted');

// ---- barrier rails vs terrain (static geometry check) ----
const railCheck = await page.evaluate(() => {
  const { env } = window.SELENE;
  const out = { checked: 0, buried: 0, worst: 0 };
  for (const name of ['railL', 'railR']) {
    const rail = env.track.group.getObjectByName(name);
    const pos = rail.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) { // top row vertices
      const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
      const t = env.terrain.sampleHeight(x, z);
      out.checked++;
      const clearance = y - t;
      if (clearance < 0.05) { out.buried++; out.worst = Math.min(out.worst, clearance); }
    }
  }
  return out;
});
console.log('RAIL CHECK:', JSON.stringify(railCheck));

// ---- attract cam ground clearance across several shot cuts ----
let minClear = Infinity, samples = 0;
const tEnd = Date.now() + attractSec * 1000;
while (Date.now() < tEnd) {
  await new Promise(r => setTimeout(r, 120));
  const c = await page.evaluate(() => {
    const { env } = window.SELENE;
    const p = env.camera.position;
    return p.y - env.terrain.sampleHeight(p.x, p.z);
  }).catch(() => null);
  if (c !== null) { minClear = Math.min(minClear, c); samples++; }
}
console.log(`ATTRACT CAM: ${samples} samples, min clearance ${minClear.toFixed(2)}m`);
await page.screenshot({ path: new URL('./shots/fix-attract.png', import.meta.url).pathname });

// ---- race with autopilot: rockets must chase and hit ----
await page.goto('http://localhost:8140/index.html?race=1&auto=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => window.SELENE?.state === 'race').catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log('race running');
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: new URL('./shots/fix-grid.png', import.meta.url).pathname });

let rocketsSeen = 0, rocketsWithTarget = 0, hits = 0, closest = Infinity;
let raceMinClear = Infinity;
const seen = new Set();
const t2 = Date.now() + raceSec * 1000;
while (Date.now() < t2) {
  await new Promise(r => setTimeout(r, 150));
  const st = await page.evaluate(() => {
    const g = window.SELENE.game;
    const cam = window.SELENE.env.camera.position;
    return {
      rockets: g.items.rockets.map((r, i) => ({
        i, hasTarget: !!r.target,
        dist: r.target ? Math.hypot(r.target.pos.x - r.x, r.target.pos.z - r.z) : null,
      })),
      stunned: g.cars.filter(c => c.stunT > 0.8).length,
      camClear: cam.y - window.SELENE.env.terrain.sampleHeight(cam.x, cam.z),
      fps: window.__fps, state: g.state,
    };
  }).catch(() => null);
  if (!st) continue;
  raceMinClear = Math.min(raceMinClear, st.camClear);
  for (const r of st.rockets) {
    const key = `${r.i}-${Math.floor(Date.now() / 8000)}`;
    if (!seen.has(key)) { seen.add(key); rocketsSeen++; if (r.hasTarget) rocketsWithTarget++; }
    if (r.dist !== null) closest = Math.min(closest, r.dist);
  }
  if (st.stunned > 0) hits++;
  if (st.state === 'results') break;
}
console.log(`RACE: rockets seen ~${rocketsSeen}, with target ${rocketsWithTarget}, closest approach ${closest === Infinity ? 'n/a' : closest.toFixed(1)}m, stun-frames ${hits}, cam min clearance ${raceMinClear.toFixed(2)}m`);
const fps = await page.evaluate(() => window.__fps);
console.log('fps:', fps, '| console issues:', logs.length ? logs.join(' | ') : 'none');
await page.screenshot({ path: new URL('./shots/fix-race.png', import.meta.url).pathname });
await browser.close();
