import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(8000); // intro + hold
await page.screenshot({ path: 'shots/g_fix10_hold.png' });

// click the RED dot (3rd) directly
const dots = await page.$$('#v-dots .dot');
await dots[2].click();
await page.waitForTimeout(600);
const colorText = await page.$eval('#v-color-t', (el) => el.textContent);
await page.screenshot({ path: 'shots/g_fix10_red.png' });
console.log('color after dot click:', colorText, colorText === 'RED' ? 'DOT CLICK OK' : 'DOT CLICK FAILED');
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();
