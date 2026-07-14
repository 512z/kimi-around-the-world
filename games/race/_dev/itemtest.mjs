import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 12000)); // racing toward first row (s=650)
await page.screenshot({ path: 'shots/items-boxes.png' });
// give player a rocket and fire it at the pack
await page.evaluate(() => {
  const g = window.SELENE.game;
  g.player.item = 'rocket';
  g.items.useItem(g.player, g.cars);
});
await new Promise(r => setTimeout(r, 450));
await page.screenshot({ path: 'shots/items-rocket.png' });
// shield + banana drop
await page.evaluate(() => {
  const g = window.SELENE.game;
  g.items.useItem({ get item() { return 'shield'; }, set item(v) {}, shieldT: 0, turboT: 0 }, g.cars);
  g.player.shieldT = 5.5;
  g.player.item = 'banana';
  g.items.useItem(g.player, g.cars);
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'shots/items-shield-banana.png' });
// HUD item slot check
await page.evaluate(() => { window.SELENE.game.player.item = 'turbo'; });
await new Promise(r => setTimeout(r, 300));
const hud = await page.evaluate(() => window.SELENE.env.menu.currentScreen());
await page.screenshot({ path: 'shots/items-hud.png' });
console.log('done, errors so far checked via PAGEERROR');
await browser.close();
