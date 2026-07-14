import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.waitForTimeout(3000);
for (const [x, z] of [[-89.5, 120], [-112, 78], [-97, 108]]) {
  await page.evaluate(([x, z]) => window.__game.tp(x, z), [x, z]);
  await page.waitForTimeout(300);
  const l = await page.evaluate(() => window.__game.local());
  console.log(`heightAt(${x},${z}) = ${(l.y - 0.95).toFixed(2)}`);
}
await browser.close();
