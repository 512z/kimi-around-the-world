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
await new Promise(r => setTimeout(r, 8000));
// freeze the sim, line up: teleport one AI car 60m ahead of player, fire rocket, step frames manually-ish
await page.evaluate(() => {
  const g = window.SELENE.game, T = window.SELENE.THREE;
  const p = g.player;
  const victim = g.cars.find(c => c !== p);
  const fwd = new T.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  victim.pos.copy(p.pos).add(fwd.clone().multiplyScalar(45));
  victim.vel.set(0, 0, 0); victim.yaw = p.yaw;
  victim.stunT = 0;
  p.item = 'rocket';
  g.items.useItem(p, g.cars);
});
for (let i = 0; i < 3; i++) {
  await new Promise(r => setTimeout(r, 260));
  await page.screenshot({ path: `shots/rocket-f${i}.png` });
}
const hit = await page.evaluate(() => {
  const g = window.SELENE.game;
  const victim = g.cars.find(c => c !== g.player);
  return { stunT: +victim.stunT.toFixed(2), rockets: g.items.rockets.length, fx: g.items.fx.filter(f => f.life > 0).length };
});
console.log('after ~800ms:', JSON.stringify(hit));
await browser.close();
