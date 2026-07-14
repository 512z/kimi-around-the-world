import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1400,800', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 6000)); // racing
// teleport to open plain, heading +Z, give speed, hold D
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player, T = window.SELENE.THREE;
  p.pos.set(2000, g.env.terrain.sampleHeight(2000, -2000) + 0.52, -2000);
  p.yaw = 0; p.vel.set(0, 0, 30); p.stunT = 0;
  g.chase.snap(p, g.env.terrain);
});
await new Promise(r => setTimeout(r, 200));
const x0 = await page.evaluate(() => window.SELENE.game.player.pos.x);
await page.keyboard.down('KeyD');
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/steer-fixed.png' });
await page.keyboard.up('KeyD');
const x1 = await page.evaluate(() => window.SELENE.game.player.pos.x);
console.log(`D held: pos.x ${x0.toFixed(1)} -> ${x1.toFixed(1)} (delta ${(x1 - x0).toFixed(1)}; camera behind car heading +Z, so -X = screen RIGHT)`);
// off-road rejoin: drive off at an angle, then steer back with A
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  p.pos.set(2000, g.env.terrain.sampleHeight(2000, -2000) + 0.52, -2000);
  p.yaw = 0; p.vel.set(0, 0, 25);
});
await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 2000));
await page.keyboard.up('KeyW');
const off1 = await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const n = g.env.track.nearestS(p.pos.x, p.pos.z);
  return { dist: +n.dist.toFixed(1), offroad: +p.offroad.toFixed(2) };
});
console.log('after driving off-road 2s:', JSON.stringify(off1));
// hold A (should steer back left toward the road — road is at lower x)
await page.keyboard.down('KeyA'); await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 2500));
await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
const off2 = await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const n = g.env.track.nearestS(p.pos.x, p.pos.z);
  return { dist: +n.dist.toFixed(1), offroad: +p.offroad.toFixed(2), spd: Math.round(p.speedKmh) };
});
console.log('after A+W rejoin 2.5s:', JSON.stringify(off2));
await browser.close();
