// MOON RACE item-pickup diagnosis: teleport the player onto an item box and
// check whether car.item gets set (SP mode and MP/auto mode).
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const URL_BASE = 'http://localhost:9101/index.html';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});

async function waitFor(page, fn, timeout = 60000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for ' + label);
}

async function testPickup(page, mode) {
  const before = await page.evaluate(() => {
    const g = window.SELENE.game;
    return { state: g.state, boxes: g.items.boxes.length, active: g.items.boxes.filter(b => b.active).length };
  });
  console.log(`[${mode}] state=${before.state} boxes=${before.boxes} active=${before.active}`);

  let picked = null;
  for (let attempt = 0; attempt < 10 && !picked; attempt++) {
    await page.evaluate(() => {
      const g = window.SELENE.game;
      const b = g.items.boxes.find(b => b.active);
      if (!b) return;
      g.player.item = null;
      g.player.pos.x = b.x;
      g.player.pos.z = b.z;
      g.player.vel.x = 0; g.player.vel.z = 0;
    });
    await new Promise(r => setTimeout(r, 400));
    picked = await page.evaluate(() => {
      const g = window.SELENE.game;
      return g.player.item ? { item: g.player.item, activeLeft: g.items.boxes.filter(b => b.active).length } : null;
    });
  }
  console.log(`[${mode}] pickup result:`, picked || 'FAILED — no item after 10 attempts');
  return picked;
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

// ---------- single player ----------
const p1 = await ctx.newPage();
p1.on('pageerror', e => console.log('[SP] PAGEERROR', e.message));
p1.on('console', m => { if (m.type() === 'error') console.log('[SP] console.error', m.text()); });
await p1.goto(`${URL_BASE}?race=1`, { waitUntil: 'domcontentloaded' });
await waitFor(p1, () => !!window.SELENE, 60000, 'SELENE');
await waitFor(p1, () => window.SELENE && window.SELENE.state === 'race', 30000, 'state=race');
const sp = await testPickup(p1, 'SP');
await p1.close();

// ---------- multiplayer (auto=1, as launched from the moon lobby) ----------
const p2 = await ctx.newPage();
p2.on('pageerror', e => console.log('[MP] PAGEERROR', e.message));
p2.on('console', m => { if (m.type() === 'error') console.log('[MP] console.error', m.text()); });
await p2.goto(`${URL_BASE}?auto=1&name=TEST&color=2e7bf6`, { waitUntil: 'domcontentloaded' });
await waitFor(p2, () => !!window.SELENE, 60000, 'SELENE');
await waitFor(p2, () => window.SELENE && window.SELENE.state === 'race', 60000, 'state=race (mp)');
const mp = await testPickup(p2, 'MP');
await p2.close();

await browser.close();
console.log('SUMMARY: SP =', sp ? 'OK' : 'BROKEN', '| MP =', mp ? 'OK' : 'BROKEN');
