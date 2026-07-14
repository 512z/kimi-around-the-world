import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 8000)); // well into race
const d1 = await page.evaluate(() => {
  const g = window.SELENE.game;
  g.player.item = 'rocket';
  return { state: g.state, item: g.player.item };
});
await new Promise(r => setTimeout(r, 300));
const d2 = await page.evaluate(() => {
  const g = window.SELENE.game;
  const el = document.querySelector('[data-hud="itemwrap"]');
  return {
    state: g.state, item: g.player.item,
    classes: el.className,
    name: document.querySelector('[data-hud="itemname"]').textContent,
    hudHidden: document.querySelector('.hud-layer').classList.contains('hidden'),
  };
});
console.log('t0:', JSON.stringify(d1));
console.log('t1:', JSON.stringify(d2));
await browser.close();
