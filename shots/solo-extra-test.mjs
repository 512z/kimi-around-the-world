// SP extras: social follow, player<->NPC bump, LEAVE GAME cleanup.
// Run with the scratch server up: PORT=9191 node server.js
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const BASE = 'http://localhost:9191/';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('kimi.name', 'KIMI'); localStorage.setItem('kimi.color', 'yellow'); } catch { }
});
const page = await ctx.newPage();
// favicon.ico 404 is pre-existing (no favicon in the repo) — not this feature
page.on('console', (m) => {
  if (m.type() === 'error' && !m.location()?.url?.endsWith('favicon.ico')) {
    errors.push(`[console] ${m.text()} @ ${m.location()?.url}`);
  }
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 120000 });
await sleep(400);

// yellow player: YIMI duplicates the color on purpose; third = BIMI (blue != yellow)
await page.keyboard.press('Enter');
await sleep(600);
await page.keyboard.press('Enter');
await sleep(1000);
const ids = await page.evaluate(() => window.__game.npcs().map((n) => `${n.name}:${n.color}`));
check('yellow player pool (dup yellow ok)', ids.join(',') === 'YIMI:#f2c94c,RIMI:#eb5757,BIMI:#2e7bf6', ids.join(','));

// ---- social: park the player 10 m from an NPC -> someone should close in
await page.evaluate(() => {
  const n = window.__game.npcs()[0];
  window.__game.tp(n.x + 10, n.z);
});
let minD = Infinity;
for (let i = 0; i < 30; i++) {
  const d = await page.evaluate(() => {
    for (let k = 0; k < 20; k++) window.__game.step(0.05);
    const me = window.__game.local();
    return Math.min(...window.__game.npcs().map((n) => Math.hypot(n.x - me.x, n.z - me.z)));
  });
  minD = Math.min(minD, d);
}
check('social follow closes to ~3 m', minD < 4.5, `min player-NPC distance ${minD.toFixed(2)}m over 30 sim-s`);

// ---- bump: drop the player exactly on an NPC -> both push out (>= ~1.5 m apart)
const sep = await page.evaluate(() => {
  const n = window.__game.npcs()[0];
  window.__game.tp(n.x, n.z); // dead overlap
  for (let k = 0; k < 30; k++) window.__game.step(0.05);
  const me = window.__game.local();
  const n2 = window.__game.npcs()[0];
  return Math.hypot(n2.x - me.x, n2.z - me.z);
});
check('player bumps NPC like a remote human', sep > 1.5, `separation ${sep.toFixed(2)}m (2r = 1.6)`);

// ---- LEAVE GAME: pause -> LEAVE -> ATTRACT, NPCs gone, preview back
await page.keyboard.press('Escape');
await sleep(600);
await page.keyboard.press('ArrowDown'); // pause rail: RESUME -> LEAVE GAME
await page.keyboard.press('Enter');
await sleep(800);
check('back to ATTRACT', (await page.evaluate(() => window.__game.state())) === 'ATTRACT');
check('mode reset to null', (await page.evaluate(() => window.__game.mode())) === null);
check('NPCs removed', (await page.evaluate(() => window.__game.npcs().length)) === 0);
check('crew counter back to 1', (await page.evaluate(() => document.getElementById('crew-n').textContent)) === '1');
check('main menu back on', await page.evaluate(() => document.getElementById('main').classList.contains('on')));

check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
await browser.close();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
