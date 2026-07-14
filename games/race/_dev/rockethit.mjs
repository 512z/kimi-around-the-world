// Focused rocket-homing test: force-fire rockets from the player and verify
// they chase the car ahead and detonate on it.
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,720', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?race=1&auto=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.SELENE?.state === 'race').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 1000));
}
await new Promise(r => setTimeout(r, 6000)); // let the field spread out

for (let trial = 1; trial <= 4; trial++) {
  const res = await page.evaluate(async () => {
    const g = window.SELENE.game;
    const me = g.player;
    me.item = 'rocket';
    g.items.useItem(me, g.cars);
    const r = g.items.rockets[g.items.rockets.length - 1];
    if (!r) return { fired: false };
    const victim = r.target ? r.target.name : null;
    let minD = Infinity, hit = false, t = 0;
    while (t < 5000) {
      await new Promise(res2 => setTimeout(res2, 50));
      t += 50;
      if (!g.items.rockets.includes(r)) {
        // rocket gone — did the victim just get stunned?
        hit = r.target ? r.target.stunT > 0 : false;
        break;
      }
      if (r.target) {
        const d = Math.hypot(r.target.pos.x - r.x, r.target.pos.z - r.z);
        if (d < minD) minD = d;
      }
    }
    return { fired: true, victim, minD: +minD.toFixed(1), hit };
  });
  console.log(`trial ${trial}:`, JSON.stringify(res));
  await new Promise(r => setTimeout(r, 4000));
}
await browser.close();
