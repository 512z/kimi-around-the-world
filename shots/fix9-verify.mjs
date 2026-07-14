import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(8000); // intro plays 5s wall-clock, then holds
await page.screenshot({ path: 'shots/g_fix9_hold.png' });
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();
