import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8125', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.waitForTimeout(3000);
// next to parked rover (-120,96) + astronaut (-118,88), camera on the sun side
await page.evaluate(() => { window.__game.tp(-112, 104); window.__game.setAzimuth(0.7); });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/g_fix8_sunside.png' });
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();
