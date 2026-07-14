// Wall-penetration + start-grid brightness check.
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?race=1&auto=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.SELENE?.state === 'race').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 1000));
}

// grid shot for reflection check (race starts, cars still bunched)
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: new URL('./shots/wall-grid.png', import.meta.url).pathname });

// ram the wall: repeatedly push the player sideways, track worst overshoot
const worst = await page.evaluate(async () => {
  const g = window.SELENE.game;
  const env = window.SELENE.env;
  const me = g.player;
  let worst = -Infinity;
  for (let trial = 0; trial < 3; trial++) {
    const side = trial % 2 === 0 ? 1 : -1;
    const t0 = performance.now();
    while (performance.now() - t0 < 2600) {
      const near = env.track.nearestS(me.pos.x, me.pos.z);
      const f = near.frame;
      // shove hard toward the wall on top of whatever the sim is doing
      me.vel.x += f.rx * side * 60 * 0.05;
      me.vel.z += f.rz * side * 60 * 0.05;
      worst = Math.max(worst, Math.abs(near.dSigned) - f.hw);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  return +worst.toFixed(3);
});
console.log('max center overshoot beyond hw:', worst, 'm  (wall face is at hw+1.6; car half-width ~1.5 → must stay <= ~0.1)');

// close-up of the car pinned against the rail
await page.screenshot({ path: new URL('./shots/wall-contact.png', import.meta.url).pathname });
await browser.close();
