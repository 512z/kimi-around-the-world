import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.tp(-50, -4.2));
await page.evaluate(() => window.__game.setAzimuth(0));
await page.waitForTimeout(200);
await page.evaluate(() => window.__game.setKey('KeyW', true));
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(2000);
  const l = await page.evaluate(() => window.__game.local());
  console.log(`+${(i+1)*2}s z=${l.z.toFixed(2)} vz=${l.vz.toFixed(2)}`);
}
await page.evaluate(() => window.__game.setKey('KeyW', false));
await browser.close();
