import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });
const times = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : [0, 22, 44, 66, 88, 105];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText || ''}`));

for (const t of times) {
  const label = String(t).padStart(3, '0');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`http://localhost:8123/?t=${t}`, { waitUntil: 'load', timeout: 60000 });
      break;
    } catch (e) {
      if (attempt === 1) { errors.push(`[goto] t=${t}: ${e.message}`); }
      else await page.waitForTimeout(1500);
    }
  }
  try {
    await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 60000 });
  } catch {
    errors.push(`[timeout] scene not ready at t=${t}`);
  }
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => window.__camInfo || null).catch(() => null);
  if (info) console.log(`  cam seg=${info.seg} lt=${info.lt} pos=${info.p.map((n) => n.toFixed(0))} tgt=${info.t.map((n) => n.toFixed(0))}`);
  await page.screenshot({ path: `shots/t${label}.png` }).catch((e) => errors.push(`[screenshot] t=${t}: ${e.message}`));
  console.log(`shot t=${t} done`);
}

writeFileSync('shots/errors.txt', errors.length ? errors.join('\n') + '\n' : 'NO ERRORS\n');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no errors');
await browser.close();
