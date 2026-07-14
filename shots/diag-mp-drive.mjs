// MP solo (auto=1) real-driving pickup test — the exact scenario the lobby
// launches. demo=1 makes the player AI-driven; we inject an AIController onto
// the MP player sim (which spawns without one) right after it appears.
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });

await page.goto('http://localhost:9101/index.html?auto=1&demo=1&name=TEST&color=2e7bf6', { waitUntil: 'domcontentloaded' });

// wait for SELENE + player sim, then inject AI + instrumentation
const t0 = Date.now();
let injected = false;
while (Date.now() - t0 < 90000) {
  injected = await page.evaluate(async () => {
    const g = window.SELENE?.game;
    if (!g || !g.player || g.player.ai) return false;
    const { AIController } = await import('./src/ai.js');
    g.player.ai = new AIController(g.player, { skill: 0.95, boldness: 0.95 });
    // instrumentation: every give + per-box closest approach of the player
    window.__log = { gives: [], boxes: g.items.boxes.map((b, i) => ({ i, s: b.s, minD2: Infinity, yd: null })) };
    const orig = g.items.giveRandomItem.bind(g.items);
    g.items.giveRandomItem = (car, sp) => {
      const r = orig(car, sp);
      if (r) window.__log.gives.push({ who: car.isPlayer ? 'PLAYER' : String(car.netId || 'remote'), item: car.item, s: +(car.s ?? -1).toFixed(0) });
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
        if (d2 < L[k].minD2) { L[k].minD2 = d2; L[k].yd = Math.abs(g.player.pos.y - b.y); }
      }
    })();
    return true;
  }).catch(() => false);
  if (injected) break;
  await new Promise(r => setTimeout(r, 500));
}
if (!injected) { console.log('FAILED to inject (no player)'); await browser.close(); process.exit(1); }
console.log('injected AI onto MP player at', ((Date.now() - t0) / 1000).toFixed(1), 's');

// drive until player passes s=2100 (rows at 650 + 1950) or timeout
const t1 = Date.now();
let lastLog = 0;
while (Date.now() - t1 < 300000) {
  const snap = await page.evaluate(() => {
    const g = window.SELENE?.game;
    return g ? { s: g.player?.s ?? -1, state: g.state, cd: g.countdownT, fps: window.__fps } : null;
  }).catch(() => null);
  if (snap && Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    console.log(`  t+${((Date.now() - t1) / 1000).toFixed(0)}s state=${snap.state} s=${snap.s?.toFixed(0)} cd=${snap.cd?.toFixed(2)} fps=${snap.fps}`);
  }
  if (snap && snap.s > 2100) break;
  if (snap && snap.state === 'countdown' && Date.now() - t1 > 45000) { console.log('STUCK in countdown >45s — breaking'); break; }
  await new Promise(r => setTimeout(r, 1000));
}

const out = await page.evaluate(() => {
  const g = window.SELENE.game;
  return {
    state: g.state, playerS: g.player.s, playerItem: g.player.item,
    countdownT: g.countdownT, fps: window.__fps, errors: window.__errors || [],
    gives: window.__log.gives,
    close: window.__log.boxes.filter(b => b.minD2 < 100).map(b => ({ i: b.i, s: b.s, minD: +Math.sqrt(b.minD2).toFixed(2), yd: +(b.yd ?? -1).toFixed(2) })),
  };
});
console.log('state =', out.state, ' playerS =', out.playerS?.toFixed(0), ' playerItem =', out.playerItem,
  ' countdownT =', out.countdownT?.toFixed(2), ' fps =', out.fps);
console.log('errors:', JSON.stringify(out.errors));
console.log('gives:', JSON.stringify(out.gives));
console.log('boxes player passed within 10m:');
for (const c of out.close) console.log(`  box#${c.i} (s=${c.s}): closest ${c.minD}m yd ${c.yd}m ${c.minD < 3 && c.yd < 3.5 ? '<-- SHOULD PICK UP' : ''}`);
await browser.close();
