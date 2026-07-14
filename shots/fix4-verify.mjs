// Verify round 4: default camera farther, Shift sprint, Space jump.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8125';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.evaluate(() => window.__game.setAzimuth(0.7));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/g_fix4_view.png' });

const L = () => page.evaluate(() => window.__game.local());
const key = (c, d) => page.evaluate(([c, d]) => window.__game.setKey(c, d), [c, d]);

async function dash(keys) {
  await page.evaluate(() => window.__game.tp(-95, 110));
  await page.waitForTimeout(900); // let planar vel damp out
  const a = await L();
  for (const k of keys) await key(k, true);
  await page.waitForTimeout(800);
  for (const k of keys) await key(k, false);
  const b = await L();
  return Math.hypot(b.x - a.x, b.z - a.z);
}

const walk = await dash(['KeyW']);
const run = await dash(['ShiftLeft', 'KeyW']);
console.log(`walk 0.8s: ${walk.toFixed(2)} m | sprint 0.8s: ${run.toFixed(2)} m`);
console.log(run > walk * 1.4 ? 'SPRINT OK' : 'SPRINT WEAK');

// jump: sample apex
await page.evaluate(() => window.__game.tp(-95, 110));
await page.waitForTimeout(500);
const y0 = (await L()).y;
await key('Space', true);
await key('Space', false);
let apex = y0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(120);
  const y = (await L()).y;
  if (y > apex) apex = y;
}
await page.waitForTimeout(2500);
const yEnd = (await L()).y;
console.log(`jump apex: +${(apex - y0).toFixed(2)} m | landed back: ${Math.abs(yEnd - y0) < 0.3 ? 'yes' : 'NO'}`);
console.log(apex - y0 > 2.5 ? 'JUMP OK' : 'JUMP WEAK');

await page.screenshot({ path: 'shots/g_fix4_end.png' });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
