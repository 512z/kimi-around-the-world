import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: 'shots/ab9-0.png' });
await page.evaluate(() => {
  const m = window.SELENE.game.player.mesh;
  m.traverse(o => { if (o.material) { o.material.envMapIntensity = 0; if ('clearcoat' in o.material) o.material.clearcoat = 0; o.material.needsUpdate = true; } });
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/ab9-1-noenv-all.png' });
console.log('done');
await browser.close();
