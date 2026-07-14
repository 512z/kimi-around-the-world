import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });
const views = [
  { name: 'arm',     p: [46, 7, -44],  t: [28, 3, -64] },
  { name: 'mast',    p: [-22, 5, -88], t: [-42, 2, -106] },
  { name: 'foot',    p: [-28, 5, -18], t: [-50, 0, -55] },
  { name: 'lander',  p: [-158, 7, 178], t: [-185, 4, 150] },
  { name: 'roverA',  p: [-80, 9, 165], t: [-110, 2, 110], seek: 30 },
  { name: 'roverB',  p: [-80, 9, 165], t: [-110, 2, 110], seek: 36 },
  { name: 'dome',    p: [48, 8, 80],   t: [26, 3, 58] },
  { name: 'solar',   p: [235, 12, 60], t: [195, 3, 10] },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

for (const v of views) {
  await page.goto(`http://localhost:8123/?free=1&t=${v.seek || 0}`, { waitUntil: 'load', timeout: 60000 });
  const t0 = Date.now();
  await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  await page.evaluate(({ p, t }) => {
    window.__camera.position.set(p[0], p[1], p[2]);
    window.__controls.target.set(t[0], t[1], t[2]);
    window.__controls.update();
  }, v);
  await page.waitForTimeout(2500);
  // rough fps over 1.5s
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const loop = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else res(n / 1.5); };
    requestAnimationFrame(loop);
  }));
  await page.screenshot({ path: `shots/dbg_${v.name}.png` });
  console.log(`${v.name}: load=${loadMs}ms fps~${fps.toFixed(0)}`);
}

writeFileSync('shots/errors.txt', errors.length ? errors.join('\n') + '\n' : 'NO ERRORS\n');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no errors');
await browser.close();
