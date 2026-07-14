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
await new Promise(r => setTimeout(r, 5500));
await page.evaluate(() => {
  const g = window.SELENE.game;
  const p = g.player;
  const L = g.env.track.length;
  g.clock = 400;
  p.lap = 2; p.lapTimes = [138.4, 141.2]; p.cpIndex = 12; p.lapStart = 380;
  p.totalDist = L * 2 + (L - 60);
  const f = g.env.track.frameAt(L - 60);
  p.pos.set(f.x, f.y + 0.52, f.z); p.s = L - 60; p.lastS = L - 60;
  p.vel.set(Math.sin(p.yaw) * 55, 0, Math.cos(p.yaw) * 55);
  g.bestLap = 138.4;
  g.cars.forEach((c, i) => { if (i < 4 && c !== p) { c.finished = true; c.finishTime = 380 + i * 3; c.totalDist = L * 3; } });
});
// wait for results
let ok = false;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const st = await page.evaluate(() => window.SELENE.state);
  if (st === 'results') { ok = true; console.log('results at +', i + 1, 's'); break; }
}
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: 'shots/screen-results.png' });
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 1200));
const st2 = await page.evaluate(() => ({ state: window.SELENE.state, lap: window.SELENE.game.player.lap, clock: +window.SELENE.game.clock.toFixed(1), cars: window.SELENE.game.cars.length }));
console.log('after RACE AGAIN:', JSON.stringify(st2));
await browser.close();
