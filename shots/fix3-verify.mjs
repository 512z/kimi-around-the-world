// Verify round 3: ball goes dark in structure shadows (receiveShadow + low emissive).
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

async function shot(name, x, z, az) {
  await page.evaluate(([x, z, az]) => { window.__game.tp(x, z); window.__game.setAzimuth(az); }, [x, z, az]);
  await page.waitForTimeout(2500); // camera + idle face-camera settle
  await page.screenshot({ path: `shots/${name}.png` });
}

// sunny control (spawn plaza, open ground)
await shot('g_fix3_sun', -95, 110, 0.7);
// shadow candidates: WNW of dome (-50,-18) and module M2 (-44,26)
await shot('g_fix3_sh1', -64, -32, 2.4);
await shot('g_fix3_sh2', -58, 10, 2.4);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
