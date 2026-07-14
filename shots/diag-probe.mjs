// Probe: where are the cars, where are the boxes, is anyone moving?
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:9101/index.html?demo=1&race=1', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  if (await page.evaluate(() => window.SELENE && window.SELENE.state === 'race').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log('race after', ((Date.now() - t0) / 1000).toFixed(1), 's');

for (let round = 0; round < 4; round++) {
  await new Promise(r => setTimeout(r, 15000));
  const snap = await page.evaluate(() => {
    const g = window.SELENE.game;
    const cars = g.cars.map(c => ({ p: c.isPlayer ? 'YOU' : 'ai', s: +c.s.toFixed(0), x: +c.pos.x.toFixed(0), z: +c.pos.z.toFixed(0), y: +c.pos.y.toFixed(1), v: +Math.hypot(c.vel.x, c.vel.z).toFixed(1), item: c.item, dis: c.disabled }));
    // nearest car to each of first-row boxes
    const row1 = g.items.boxes.filter(b => b.s === 650).map(b => {
      let best = Infinity, who = null;
      for (const c of g.cars) {
        const d = Math.hypot(c.pos.x - b.x, c.pos.z - b.z);
        if (d < best) { best = d; who = c.isPlayer ? 'YOU' : 'ai'; }
      }
      return { bx: +b.x.toFixed(0), bz: +b.z.toFixed(0), by: +b.y.toFixed(1), near: +best.toFixed(1), who, active: b.active };
    });
    return { fps: window.__fps, t: g.clock?.toFixed(1), trackL: g.env.track.length, state: g.state, cars, row1 };
  });
  console.log(`--- t+${(round + 1) * 15}s fps=${snap.fps} clock=${snap.t} L=${snap.trackL} state=${snap.state}`);
  console.log('cars:', snap.cars.map(c => `${c.p}:s${c.s} v${c.v}${c.item ? ' [' + c.item + ']' : ''}`).join('  '));
  for (const b of snap.row1) console.log(`  box@(${b.bx},${b.bz},y${b.by}) active=${b.active} nearest car ${b.near}m (${b.who})`);
}
await browser.close();
