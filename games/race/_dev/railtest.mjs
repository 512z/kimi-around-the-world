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
// hurl the player sideways into the barrier at speed
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const f = g.env.track.frameAt(400);
  p.pos.set(f.x, f.y + 0.52, f.z);
  p.yaw = Math.atan2(f.tx, f.tz);
  // mostly sideways velocity toward the right barrier
  p.vel.set(f.rx * 42 + f.tx * 20, 0, f.rz * 42 + f.tz * 20);
  g.chase.snap(p, g.env.terrain);
});
const samples = [];
for (let i = 0; i < 14; i++) {
  await new Promise(r => setTimeout(r, 250));
  const s = await page.evaluate(() => {
    const g = window.SELENE.game, p = g.player;
    const n = g.env.track.nearestS(p.pos.x, p.pos.z);
    return { d: +n.dSigned.toFixed(1), hw: +n.frame.hw.toFixed(1), spd: Math.round(p.speedKmh), impact: +p.impact.toFixed(2) };
  });
  samples.push(s);
}
console.log('rail impact sequence:');
samples.forEach((s, i) => console.log(`  t=${(i * 0.25).toFixed(2)} dSigned=${s.d} (limit ${(s.hw + 0.8).toFixed(1)}) spd=${s.spd} impact=${s.impact}`));
await page.screenshot({ path: 'shots/rail-hit.png' });
// now try to drive THROUGH the barrier for 3s with full throttle into it
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const f = g.env.track.frameAt(400);
  p.pos.set(f.x, f.y + 0.52, f.z);
  p.yaw = Math.atan2(f.rx, f.rz); // facing straight at the right barrier
  p.vel.set(0, 0, 0);
});
await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 3000));
await page.keyboard.up('KeyW');
const end = await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const n = g.env.track.nearestS(p.pos.x, p.pos.z);
  return { d: +n.dSigned.toFixed(1), limit: +(n.frame.hw + 0.8).toFixed(1) };
});
console.log('after 3s full-throttle into barrier:', JSON.stringify(end), '(d must stay <= limit)');
await browser.close();
