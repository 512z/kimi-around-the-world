// Verify round 2: no ghost players on fresh server, highlight looks soft/round.
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

const remotes = await page.evaluate(() => window.__game.remoteBalls());
const crew = await page.evaluate(() => window.__game.crew());
console.log('remotes:', JSON.stringify(remotes), 'crew:', crew);
console.log(remotes.length === 0 && crew === 1 ? 'GHOSTS OK' : 'GHOSTS PRESENT');

// camera on the sun side (sun az ≈ 0.70 rad) so the highlight faces us
await page.evaluate(() => window.__game.setAzimuth(0.70));
await page.waitForTimeout(3000); // settle + idle face-camera
await page.screenshot({ path: 'shots/g_fix2.png' });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
