import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1920,1080', '--use-gl=angle', '--use-angle=metal', '--no-first-run', '--disable-extensions'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
console.log('booted');
const samples = [];
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const f = await page.evaluate(() => ({ fps: window.__fps, state: window.SELENE.state }));
  samples.push(f.fps);
  if (i % 10 === 0) console.log(`t=${i}s fps=${f.fps} state=${f.state}`);
}
const sorted = samples.slice(5).sort((a, b) => a - b);
console.log(`fps@1080p HIGH: min=${sorted[0]} p10=${sorted[Math.floor(sorted.length * 0.1)]} median=${sorted[Math.floor(sorted.length / 2)]}`);
await page.screenshot({ path: 'shots/fps-1080p.png' });
await browser.close();
