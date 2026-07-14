// MOON RACE driving pickup test: ?demo=1 lets the AI drive the player car.
// In-page rAF instrumentation records, per item box, the player's closest
// approach (d2 and y-diff at that moment) plus every giveRandomItem call.
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

// wait for game + race state
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  if (await page.evaluate(() => window.SELENE && window.SELENE.state === 'race').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log('race state reached after', ((Date.now() - t0) / 1000).toFixed(1), 's');

// inject instrumentation
await page.evaluate(() => {
  const g = window.SELENE.game;
  window.__log = { gives: [], boxes: g.items.boxes.map((b, i) => ({ i, s: b.s, minD2: Infinity, ydAtMin: null })) };
  const orig = g.items.giveRandomItem.bind(g.items);
  g.items.giveRandomItem = (car, sp) => {
    const r = orig(car, sp);
    if (r) window.__log.gives.push({ t: +performance.now().toFixed(0), who: car.isPlayer ? 'PLAYER' : 'AI', item: car.item, s: +car.s?.toFixed(0) });
    return r;
  };
  (function track() {
    requestAnimationFrame(track);
    const g = window.SELENE?.game;
    if (!g || g.state !== 'race' || !g.player) return;
    const L = window.__log.boxes;
    for (let k = 0; k < g.items.boxes.length; k++) {
      const b = g.items.boxes[k];
      const dx = g.player.pos.x - b.x, dz = g.player.pos.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < L[k].minD2) { L[k].minD2 = d2; L[k].ydAtMin = Math.abs(g.player.pos.y - b.y); }
    }
  })();
});

// drive until player passes s=2100 (two box rows: 650, 1950) or timeout
const t1 = Date.now();
let lastS = -1;
while (Date.now() - t1 < 240000) {
  const s = await page.evaluate(() => window.SELENE?.game?.player?.s ?? -1).catch(() => -1);
  if (s !== lastS) { lastS = s; }
  if (s > 2100) break;
  if (s < 0 && Date.now() - t1 > 10000) { console.log('player.s stuck at', s); break; }
  await new Promise(r => setTimeout(r, 1000));
}

const out = await page.evaluate(() => {
  const g = window.SELENE.game;
  return {
    playerS: g.player.s,
    gives: window.__log.gives,
    close: window.__log.boxes.filter(b => b.minD2 < 64).map(b => ({ i: b.i, s: b.s, minD: +Math.sqrt(b.minD2).toFixed(2), yd: +b.ydAtMin?.toFixed(2) })),
  };
});
console.log('player reached s =', out.playerS?.toFixed(0));
console.log('giveRandomItem calls:', JSON.stringify(out.gives));
console.log('boxes the player passed within 8m of:');
for (const c of out.close) console.log(`  box#${c.i} (s=${c.s}): closest ${c.minD}m, y-diff ${c.yd}m ${c.minD < 3 && c.yd < 3.5 ? '<-- SHOULD HAVE PICKED UP' : ''}`);

await browser.close();
