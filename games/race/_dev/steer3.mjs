import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1400,800', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 6000));
// place on the finish straight heading +X along the road
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const f = g.env.track.frameAt(300);
  p.pos.set(f.x, f.y + 0.52, f.z);
  p.yaw = Math.atan2(f.tx, f.tz);
  p.vel.set(Math.sin(p.yaw) * 30, 0, Math.cos(p.yaw) * 30);
  g.chase.snap(p, g.env.terrain);
});
await new Promise(r => setTimeout(r, 200));
const before = await page.evaluate(() => {
  const p = window.SELENE.game.player;
  return { x: p.pos.x, z: p.pos.z, yaw: +p.yaw.toFixed(3) };
});
await page.keyboard.down('KeyD');
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: 'shots/steer-D-final.png' });
const afterD = await page.evaluate(() => {
  const p = window.SELENE.game.player;
  return { x: p.pos.x, z: p.pos.z, yaw: +p.yaw.toFixed(3) };
});
await page.keyboard.up('KeyD');
await page.keyboard.down('KeyA');
await new Promise(r => setTimeout(r, 1200));
const afterA = await page.evaluate(() => {
  const p = window.SELENE.game.player;
  return { x: p.pos.x, z: p.pos.z, yaw: +p.yaw.toFixed(3) };
});
await page.keyboard.up('KeyA');
console.log('before:', JSON.stringify(before));
console.log('afterD:', JSON.stringify(afterD), '-> yaw', (afterD.yaw - before.yaw).toFixed(2));
console.log('afterA:', JSON.stringify(afterA), '-> yaw', (afterA.yaw - afterD.yaw).toFixed(2));
console.log('D should turn screen-right = +Z here; A screen-left = -Z');
await browser.close();
