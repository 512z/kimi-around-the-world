// Verify: (1) A/D strafe matches screen-left/right, (2) fresnel rim looks soft.
// Usage: node shots/fix-verify.mjs [baseURL]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8125';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.evaluate(() => window.__game.setAzimuth(0)); // cam south of ball: +x = screen-right
await page.waitForTimeout(400);

async function strafe(code) {
  const before = await page.evaluate(() => window.__game.local());
  await page.evaluate((c) => window.__game.setKey(c, true), code);
  await page.waitForTimeout(700);
  await page.evaluate((c) => window.__game.setKey(c, false), code);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__game.local());
  return after.x - before.x; // +x is screen-right at camAz=0
}

const dRight = await strafe('KeyD');
// let it settle, then face the ball for the screenshot
await page.waitForTimeout(300);
await page.evaluate(() => window.__game.setKey('KeyD', true));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.setKey('KeyD', false));
await page.waitForTimeout(2500); // idle → ball turns to camera
await page.screenshot({ path: 'shots/g_fix.png' });

const aLeft = await strafe('KeyA');

console.log(`KeyD dx = ${dRight.toFixed(3)} (want > 0)`);
console.log(`KeyA dx = ${aLeft.toFixed(3)} (want < 0)`);
console.log(dRight > 0.05 && aLeft < -0.05 ? 'STRAFE OK' : 'STRAFE BROKEN');
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
