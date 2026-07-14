// Two-client MP pickup test: both players AI-driven, manual stepping on both
// pages (rAF disabled). Verifies box pickups stay independent per client.
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });

async function makePlayer(name) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${name}] PAGEERROR`, e.message));
  await page.goto(`http://localhost:9101/index.html?auto=1&demo=1&name=${name}&color=2e7bf6`, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const ok = await page.evaluate(async () => {
      const g = window.SELENE?.game;
      if (!g || !g.player || g.player.ai) return false;
      const { AIController } = await import('./src/ai.js');
      g.player.ai = new AIController(g.player, { skill: 0.95, boldness: 0.95 });
      window.__log = { gives: [] };
      const orig = g.items.giveRandomItem.bind(g.items);
      g.items.giveRandomItem = (car, sp) => {
        const r = orig(car, sp);
        if (r) window.__log.gives.push({ who: car.isPlayer ? 'ME' : String(car.netId || '?'), item: car.item, s: +(car.s ?? -1).toFixed(0) });
        return r;
      };
      return true;
    }).catch(() => false);
    if (ok) break;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[${name}] ready at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return page;
}

const [p1, p2] = await Promise.all([makePlayer('AAA'), makePlayer('BBB')]);

// step both in lockstep
for (let round = 0; round < 240; round++) {
  const snaps = await Promise.all([p1, p2].map(p => p.evaluate(() => {
    const g = window.SELENE.game;
    for (let i = 0; i < 20; i++) g.update(0.05);
    return { state: g.state, td: Math.round(g.player.totalDist), item: g.player.item };
  }).catch(() => null)));
  if (round % 20 === 0) console.log(`round ${round}: A ${snaps[0]?.state}/td${snaps[0]?.td}/${snaps[0]?.item} | B ${snaps[1]?.state}/td${snaps[1]?.td}/${snaps[1]?.item}`);
  if (snaps.every(s => s && s.td > 9100)) break; // both past ~1 lap
  await new Promise(r => setTimeout(r, 10));
}

for (const [name, p] of [['AAA', p1], ['BBB', p2]]) {
  const out = await p.evaluate(() => ({ gives: window.__log.gives, state: window.SELENE.game.state }));
  const mine = out.gives.filter(g => g.who === 'ME');
  console.log(`[${name}] state=${out.state} my pickups: ${mine.length} — ${mine.map(g => `${g.item}@s${g.s}`).join(', ') || 'NONE'}`);
}
await browser.close();
