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
await new Promise(r => setTimeout(r, 6000));
await page.evaluate(() => { window.SELENE.game.player.item = 'rocket'; });
await new Promise(r => setTimeout(r, 400));
const pos = await page.evaluate(() => {
  const el = document.querySelector('[data-hud="itemwrap"]');
  const r = el.getBoundingClientRect();
  return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), hidden: el.classList.contains('hidden') };
});
console.log('item slot center:', JSON.stringify(pos), '(screen 1600x900: center-top = ~800, ~130)');
await page.screenshot({ path: 'shots/slot-top.png' });
// E-key timing: arm, press E, measure frames until useItem fires
const timing = await page.evaluate(() => {
  return new Promise((resolve) => {
    const g = window.SELENE.game;
    g.player.item = 'banana';
    let used = false;
    const orig = g.items.useItem.bind(g.items);
    g.items.useItem = (c, cars) => { if (c === g.player && c.item) used = true; orig(c, cars); };
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    const iv = setInterval(() => {
      if (used) { clearInterval(iv); resolve({ ms: +(performance.now() - t0).toFixed(1) }); }
    }, 1);
    setTimeout(() => { clearInterval(iv); resolve({ ms: -1, note: 'timeout' }); }, 2000);
  });
});
console.log('E->useItem latency:', JSON.stringify(timing));
await browser.close();
