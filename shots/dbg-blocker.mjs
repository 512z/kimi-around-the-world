import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.tp(-50, -7));
await page.waitForTimeout(300);
const l = await page.evaluate(() => window.__game.local());
console.log('ball at:', l.x.toFixed(2), l.z.toFixed(2), 'y:', l.y.toFixed(2));
const cols = await page.evaluate(() => window.__game.colliders());
const near = cols.map(c => {
  let d;
  if (c.type === 'cylinder') d = Math.hypot(l.x - c.x, l.z - c.z) - c.r;
  else if (c.type === 'box') d = Math.hypot(l.x - c.x, l.z - c.z) - Math.max(c.hx, c.hz);
  else { const ex=c.bx-c.ax, ez=c.bz-c.az, L2=ex*ex+ez*ez||1; const t=Math.max(0,Math.min(1,((l.x-c.ax)*ex+(l.z-c.az)*ez)/L2)); d = Math.hypot(l.x-(c.ax+ex*t), l.z-(c.az+ez*t)) - c.r; }
  return { c, d: +d.toFixed(2) };
}).filter(o => o.d < 6).sort((a, b) => a.d - b.d);
for (const o of near) console.log(o.d, 'm from surface:', JSON.stringify(o.c));
await browser.close();
