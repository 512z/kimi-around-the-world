import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(8000);

const cam = () => page.evaluate(() => {
  const d = new window.__THREE.Vector3();
  window.__camera.getWorldDirection(d);
  const p = window.__camera.position;
  return { dir: [d.x, d.z].map(v => +v.toFixed(3)), pos: [p.x, p.y, p.z].map(v => +v.toFixed(1)) };
});
const n = v => { const m = Math.hypot(v[0], v[1]); return [v[0]/m, v[1]/m]; };
const ang = (a, b) => { const x = n(a), y = n(b); return Math.acos(Math.min(1, x[0]*y[0] + x[1]*y[1])) * 180 / Math.PI; };

const c0 = await cam();
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(300); const c1 = await cam();
await page.waitForTimeout(600); const c2 = await cam();
await page.waitForTimeout(900); const c3 = await cam();
console.log('menu dir:', c0.dir, 'pos:', c0.pos);
console.log('+0.3s dir:', c1.dir, `(yaw Δ ${ang(c0.dir, c1.dir).toFixed(1)}°)`, 'pos:', c1.pos);
console.log('+0.9s dir:', c2.dir, `(yaw Δ ${ang(c0.dir, c2.dir).toFixed(1)}°)`, 'pos:', c2.pos);
console.log('+1.8s dir:', c3.dir, `(yaw Δ ${ang(c0.dir, c3.dir).toFixed(1)}°)`, 'pos:', c3.pos);
const maxSwing = Math.max(ang(c0.dir, c1.dir), ang(c0.dir, c2.dir), ang(c0.dir, c3.dir));
console.log(maxSwing < 12 ? 'HANDOFF OK (no yaw swing)' : 'YAW SWING PRESENT');
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();
