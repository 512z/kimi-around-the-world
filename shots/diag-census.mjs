// Full-race pickup census, deterministic (rAF disabled, manual stepping).
// SP: does the trailing PLAYER ever get items vs the AI pack?
// Run: node shots/diag-census.mjs
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:9101/index.html?demo=1&race=1', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  if (await page.evaluate(() => !!window.SELENE?.game?.player).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await page.evaluate(() => {
  const g = window.SELENE.game;
  window.__log = { gives: [] };
  const orig = g.items.giveRandomItem.bind(g.items);
  g.items.giveRandomItem = (car, sp) => {
    const r = orig(car, sp);
    if (r) window.__log.gives.push({ who: car.isPlayer ? 'PLAYER' : car.name, item: car.item, s: +(car.s ?? -1).toFixed(0) });
    return r;
  };
});

// step until the player finishes or cap
let finished = false;
for (let round = 0; round < 600; round++) {
  const snap = await page.evaluate(() => {
    const g = window.SELENE.game;
    for (let i = 0; i < 20; i++) g.update(0.05);
    return { state: g.state, lap: g.player.lap, td: Math.round(g.player.totalDist), pos: g.order.indexOf(g.player) + 1, fin: g.player.finished };
  });
  if (round % 20 === 0) console.log(`round ${round}: state=${snap.state} lap=${snap.lap} pos=${snap.pos}/${8}`);
  if (snap.fin || snap.state === 'results') { finished = true; break; }
  await new Promise(r => setTimeout(r, 5));
}

const out = await page.evaluate(() => window.__log.gives);
const tally = {};
for (const g of out) tally[g.who] = (tally[g.who] || 0) + 1;
console.log('finished =', finished, ' total pickups =', out.length);
console.log('pickups per car:', JSON.stringify(tally, null, 0));
console.log('PLAYER pickups:', out.filter(g => g.who === 'PLAYER').map(g => `${g.item}@s${g.s}`).join(', ') || 'NONE');
await browser.close();
