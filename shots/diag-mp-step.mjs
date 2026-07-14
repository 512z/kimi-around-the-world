// Deterministic MP pickup test: neutralize rAF (headless throttling) and step
// the game loop manually at fixed dt. MP solo, player AI-driven (demo=1).
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  window.requestAnimationFrame = () => 0; // kill the rAF loop; we step manually
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:9101/index.html?auto=1&demo=1&name=TEST&color=2e7bf6', { waitUntil: 'domcontentloaded' });

// wait for game + player sim, inject AI + instrumentation
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
      if (r) window.__log.gives.push({ who: car.isPlayer ? 'PLAYER' : String(car.netId || '?'), item: car.item, s: +(car.s ?? -1).toFixed(0) });
      return r;
    };
    return true;
  }).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log('setup done at', ((Date.now() - t0) / 1000).toFixed(1), 's');

// step the game manually: 0.05 s per step, in batches; poll state between
let gameTime = 0;
let raceReached = false;
for (let round = 0; round < 400; round++) { // up to 400*1s game time
  const snap = await page.evaluate(() => {
    const g = window.SELENE.game;
    for (let i = 0; i < 20; i++) g.update(0.05); // +1.0 s game time
    return { state: g.state, s: g.player.s, td: g.player.totalDist, cd: g.countdownT, item: g.player.item };
  });
  gameTime += 1;
  if (snap.state === 'race') raceReached = true;
  if (round % 10 === 0 || snap.state !== 'countdown') {
    console.log(`gt=${gameTime}s state=${snap.state} s=${snap.s?.toFixed(0)} td=${snap.td?.toFixed(0)} cd=${snap.cd?.toFixed(2)} item=${snap.item}`);
  }
  if (raceReached && snap.td > 2100) break;
  // also let server messages (raceStart etc.) arrive
  await new Promise(r => setTimeout(r, 25));
}

const out = await page.evaluate(() => ({
  gives: window.__log.gives,
  state: window.SELENE.game.state,
  item: window.SELENE.game.player.item,
}));
console.log('FINAL state =', out.state, ' playerItem =', out.item);
console.log('gives:', JSON.stringify(out.gives));
await browser.close();
