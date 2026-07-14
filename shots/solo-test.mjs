// Single-player mode verification (rAF live; manual stepping for NPC motion).
// Run: PORT=9191 node server.js &  then  node shots/solo-test.mjs
// Navigations to the live game ports (9101-9103) are intercepted + aborted —
// this test never touches the fleet servers, it only records the launch URL.
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const BASE = 'http://localhost:9191/';
const errors = [];
const launches = [];
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
// never touch the live fleet ports — capture the would-be launch URL instead
await ctx.route(/:(9101|9102|9103)\//, (route) => {
  launches.push(route.request().url());
  route.abort();
});
await ctx.addInitScript(() => {
  // try/catch: this also runs on the chrome-error document after the aborted
  // launch redirect, where localStorage is denied
  try {
    localStorage.setItem('kimi.name', 'KIMI');
    localStorage.setItem('kimi.color', 'green'); // 3rd NPC must skip green -> BIMI
  } catch { /* error page */ }
});

const page = await ctx.newPage();
// favicon.ico 404 is pre-existing (no favicon in the repo) — not this feature
page.on('console', (m) => {
  if (m.type() === 'error' && !m.location()?.url?.endsWith('favicon.ico')) errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 120000 });
await sleep(500);

// ---- menu: ENTER THE MOON -> MODE screen with exactly two items
check('main screen on', await page.evaluate(() => document.getElementById('main').classList.contains('on')));
await page.keyboard.press('Enter');
await sleep(700);
check('mode screen on', await page.evaluate(() => document.getElementById('mode').classList.contains('on')));
const items = await page.evaluate(() =>
  [...document.querySelectorAll('#md .mi')].map((el) => el.textContent.trim()));
check('mode items are SINGLE PLAYER / MULTI-PLAYER',
  items.length === 2 && items[0] === 'SINGLE PLAYER' && items[1] === 'MULTI-PLAYER', items.join(' | '));

// Esc returns to main
await page.keyboard.press('Escape');
await sleep(600);
check('Esc back to main', await page.evaluate(() => document.getElementById('main').classList.contains('on')));

// ---- SINGLE PLAYER
await page.keyboard.press('Enter');   // -> mode
await sleep(600);
await page.keyboard.press('Enter');   // -> SINGLE PLAYER (first item)
await sleep(1200);

check('state PLAYING', (await page.evaluate(() => window.__game.state())) === 'PLAYING');
check('mode single', (await page.evaluate(() => window.__game.mode())) === 'single');
const npcs0 = await page.evaluate(() => window.__game.npcs());
check('3 NPCs spawned', npcs0.length === 3, JSON.stringify(npcs0));
const expectIds = [['YIMI', '#f2c94c'], ['RIMI', '#eb5757'], ['BIMI', '#2e7bf6']];
check('NPC names/colors (green player -> BIMI third)',
  expectIds.every(([n, c], i) => npcs0[i]?.name === n && npcs0[i]?.color === c),
  npcs0.map((n) => `${n.name}:${n.color}`).join(', '));
check('crew counter shows 4', (await page.evaluate(() => document.getElementById('crew-n').textContent)) === '4');
check('NPC name labels in DOM', await page.evaluate(() => {
  const t = [...document.querySelectorAll('#labels .lab')].map((l) => l.textContent);
  return ['YIMI', 'RIMI', 'BIMI'].every((n) => t.includes(n));
}));

// ---- NPC motion + structure-collider respect (manual stepping, 40 sim-seconds)
const colliderCheck = await page.evaluate(() => {
  const cols = window.__game.colliders();
  // mirrors the game's contact test with a 0.15 m penetration tolerance
  window.__npcInCollider = (p) => {
    const R = 0.8 - 0.15;
    for (const c of cols) {
      if (c.type === 'cylinder') {
        if (p.y + 0.82 < (c.y0 || 0) || p.y - 0.82 > (c.y0 || 0) + c.h) continue;
        if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + R) return `cylinder@${c.x},${c.z}`;
      } else if (c.type === 'capsuleH') {
        const ex = c.bx - c.ax, ez = c.bz - c.az;
        const len2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((p.x - c.ax) * ex + (p.z - c.az) * ez) / len2));
        if (Math.hypot(p.x - (c.ax + ex * t), p.z - (c.az + ez * t)) < c.r + R) return 'capsuleH';
      } else if (c.type === 'box') {
        const cos = Math.cos(-(c.yaw || 0)), sin = Math.sin(-(c.yaw || 0));
        const lx = (p.x - c.x) * cos - (p.z - c.z) * sin;
        const lz = (p.x - c.x) * sin + (p.z - c.z) * cos;
        if (Math.abs(lx) < c.hx + R && Math.abs(lz) < c.hz + R) return 'box';
      }
    }
    return null;
  };
  return cols.length;
});
console.log(`colliders loaded: ${colliderCheck}`);
let moved = 0;
let violations = 0;
for (let round = 0; round < 40; round++) {
  const snap = await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.__game.step(0.05); // 1 sim-second
    return window.__game.npcs().map((p) => ({ ...p, hit: window.__npcInCollider(p) }));
  });
  violations += snap.filter((p) => p.hit).length;
  if (round === 39) {
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(snap[i].x - npcs0[i].x, snap[i].z - npcs0[i].z) > 0.5) moved++;
    }
  }
}
const npcsEnd = await page.evaluate(() => window.__game.npcs());
check('NPCs move around (all 3 displaced > 0.5 m over 40 sim-s)', moved === 3,
  npcsEnd.map((n, i) => `${n.name} moved ${Math.hypot(n.x - npcs0[i].x, n.z - npcs0[i].z).toFixed(1)}m`).join(', '));
check('NPCs never inside structure colliders', violations === 0, `${violations} violating samples`);

// ---- SP picker: host-menu visible, MOON RACE arms countdown -> contract URL
check('picker (#host-menu) visible in SP', await page.evaluate(() =>
  document.getElementById('host-menu').classList.contains('on')));
check('#host-wait hidden in SP', await page.evaluate(() =>
  !document.getElementById('host-wait').classList.contains('on')));
await page.click('.host-start[data-game="race"]');
await sleep(400);
check('countdown UI armed', await page.evaluate(() =>
  document.getElementById('launch-count').classList.contains('on')));
const t0 = Date.now();
while (!launches.length && Date.now() - t0 < 8000) await sleep(150);
check('launch redirected', launches.length === 1);
if (launches.length) {
  const u = new URL(launches[0]);
  const sp = u.searchParams;
  check('launch URL is the solo contract URL',
    u.port === '9101' && u.pathname === '/' &&
    sp.get('solo') === '1' && sp.get('name') === 'KIMI' && sp.get('color') === '27ae60' &&
    sp.get('npcs') === 'YIMI:f2c94c,RIMI:eb5757,BIMI:2e7bf6' &&
    sp.get('back') === 'http://localhost:9191/',
    launches[0]);
}

// ---- MULTI-PLAYER path still connects (fresh page, real server on 9191)
const page2 = await ctx.newPage();
page2.on('console', (m) => {
  if (m.type() === 'error' && !m.location()?.url?.endsWith('favicon.ico')) errors.push(`[mp console] ${m.text()}`);
});
page2.on('pageerror', (e) => errors.push(`[mp pageerror] ${e.message}`));
await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
await page2.waitForFunction('window.__sceneReady === true', undefined, { timeout: 120000 });
await sleep(500);
await page2.keyboard.press('Enter');    // -> mode
await sleep(600);
await page2.keyboard.press('ArrowDown'); // -> MULTI-PLAYER
await page2.keyboard.press('Enter');
let online = false;
for (let i = 0; i < 30 && !online; i++) {
  await sleep(300);
  online = await page2.evaluate(() => window.__game.netOnline());
}
check('MULTI-PLAYER state PLAYING', (await page2.evaluate(() => window.__game.state())) === 'PLAYING');
check('MULTI-PLAYER mode multi', (await page2.evaluate(() => window.__game.mode())) === 'multi');
check('netOnline true (server on 9191)', online);
check('no NPCs in multi', (await page2.evaluate(() => window.__game.npcs().length)) === 0);

check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
await browser.close();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
