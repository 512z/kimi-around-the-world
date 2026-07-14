// Verify round 5: exposure tamed near the dome + overall look.
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
await page.waitForTimeout(3000); // let net init re-spawn settle before teleporting

// right next to dome (-50,-18), facing it — same situation as the user's shot
await page.evaluate(() => { window.__game.tp(-44, -13); window.__game.setAzimuth(0.9); });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/g_fix5_dome.png' });

// overall look at the plaza
await page.evaluate(() => { window.__game.tp(-95, 110); window.__game.setAzimuth(0.7); });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/g_fix5_plaza.png' });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
