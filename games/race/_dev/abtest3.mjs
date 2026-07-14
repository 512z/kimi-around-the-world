import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 2500)); // countdown showing a number
await page.screenshot({ path: 'shots/ab3-baseline.png' });
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/ab3-noui.png' });
await page.evaluate(() => { document.getElementById('ui').style.display = ''; document.getElementById('scene').style.display = 'none'; });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/ab3-nocanvas.png' });
console.log('done');
await browser.close();
