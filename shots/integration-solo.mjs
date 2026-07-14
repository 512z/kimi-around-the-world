// End-to-end integration: live lobby (8125) → SINGLE PLAYER → NPCs →
// launch MOON RACE on live 9101 → 4-car NPC grid. Plus solo smoke checks
// for venice (9102) and city (9103). Live servers serve fresh files, no
// restarts needed (client-side feature).
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 1. lobby flow ----------
console.log('== LOBBY (8125) ==');
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  pageerror:', e.message));
await page.goto('http://localhost:8125/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
await sleep(6500); // intro fly-in (wall clock)

// ENTER THE MOON is selected by default (sel 0) — press Enter
await page.keyboard.press('Enter');
await sleep(800);
const modeItems = await page.evaluate(() => [...document.querySelectorAll('#md .mi span')].map(s => s.textContent));
ok(JSON.stringify(modeItems) === JSON.stringify(['SINGLE PLAYER', 'MULTI-PLAYER']), `mode screen shows two options: ${JSON.stringify(modeItems)}`);

// pick SINGLE PLAYER (first, already selected)
await page.keyboard.press('Enter');
await sleep(2500);
const st1 = await page.evaluate(() => ({ state: window.__game.state(), mode: window.__game.mode(), crew: window.__game.crew(), npcs: window.__game.npcs() }));
ok(st1.state === 'PLAYING', 'single player enters PLAYING');
ok(st1.mode === 'single', 'mode = single');
ok(st1.crew === 4, `crew = 4 (got ${st1.crew})`);
ok(st1.npcs.length === 3, `3 NPCs (got ${st1.npcs.length})`);
const names = st1.npcs.map(n => n.name).sort().join(',');
ok(names === 'BIMI,RIMI,YIMI' || names === 'GIMI,RIMI,YIMI' || names === 'RIMI,WIMI,YIMI', `NPC names ${names}`);
ok(st1.npcs.some(n => n.color === '#f2c94c') && st1.npcs.some(n => n.color === '#eb5757'), 'yellow + red NPC present');

// NPCs move over time (drive the loop manually — headless rAF may throttle)
const before = st1.npcs.map(n => [n.x, n.z]);
for (let i = 0; i < 40; i++) await page.evaluate(() => window.__game.step(0.05));
const after = await page.evaluate(() => window.__game.npcs().map(n => [n.x, n.z]));
const moved = before.map((b, i) => Math.hypot(after[i][0] - b[0], after[i][1] - b[1]));
ok(moved.filter(m => m > 1).length >= 2, `NPCs wander (moved ${moved.map(m => m.toFixed(1)).join(',')} m)`);

// picker visible; click MOON RACE → real navigation to live 9101
const pickerOn = await page.evaluate(() => document.getElementById('host-menu').classList.contains('on'));
ok(pickerOn, 'game picker visible in SP');
await page.screenshot({ path: 'shots/solo-lobby.png' });
await page.click('.host-start[data-game="race"]');
console.log('  clicked MOON RACE, waiting for navigation…');
await page.waitForURL(/localhost:9101/, { timeout: 30000 });
const url = page.url();
ok(url.includes('solo=1'), 'race URL has solo=1');
ok(url.includes('npcs='), 'race URL carries npcs');
console.log('  url:', url.slice(0, 140));

// ---------- 2. race boots into 4-car NPC grid ----------
console.log('== RACE (9101) ==');
await page.waitForFunction(() => window.SELENE && window.SELENE.game, null, { timeout: 60000 });
await sleep(3000);
const race = await page.evaluate(() => {
  const g = window.SELENE.game;
  return { state: g.state, grid: window.__game.grid().map(c => ({ name: c.name, color: c.color, isPlayer: c.isPlayer })) };
});
ok(race.state === 'countdown' || race.state === 'race', `race state ${race.state}`);
ok(race.grid.length === 4, `4 cars (got ${race.grid.length})`);
const player = race.grid.find(c => c.isPlayer);
ok(player && player.color === '#2e7bf6', `player is blue KIMI (${player?.name} ${player?.color})`);
const expectedNpcNames = ['YIMI', 'RIMI', st1.npcs.find(n => !['YIMI', 'RIMI'].includes(n.name)).name].sort().join(',');
const npcNames = race.grid.filter(c => !c.isPlayer).map(c => c.name).sort().join(',');
ok(npcNames === expectedNpcNames, `NPC cars: ${npcNames} (expected ${expectedNpcNames})`);
await page.screenshot({ path: 'shots/solo-race.png' });
await page.close();

// ---------- 3. venice solo smoke ----------
console.log('== VENICE (9102) ==');
const p2 = await ctx.newPage();
p2.on('pageerror', e => console.log('  pageerror:', e.message));
await p2.goto('http://localhost:9102/?solo=1&name=KIMI&color=2e7bf6&npcs=YIMI%3Af2c94c%2CRIMI%3Aeb5757%2CBIMI%3A2e7bf6&back=http%3A%2F%2Flocalhost%3A8125%2F', { waitUntil: 'domcontentloaded' });
await p2.waitForFunction(() => window.__app && window.__ready, null, { timeout: 90000 });
await sleep(5000);
const ven = await p2.evaluate(() => ({ solo: window.__app.solo, boats: window.__app.spBoats().map(b => b.name) }));
ok(ven.solo === true, 'venice solo flag');
ok(ven.boats.length === 3, `venice 3 AI boats: ${ven.boats.join(',')}`);
await p2.close();

// ---------- 4. city solo smoke ----------
console.log('== CITY (9103) ==');
const p3 = await ctx.newPage();
p3.on('pageerror', e => console.log('  pageerror:', e.message));
await p3.goto('http://localhost:9103/arena.html?solo=1&name=KIMI&color=2e7bf6&npcs=YIMI%3Af2c94c%2CRIMI%3Aeb5757%2CBIMI%3A2e7bf6&back=http%3A%2F%2Flocalhost%3A8125%2F', { waitUntil: 'domcontentloaded' });
await p3.waitForFunction(() => window.__arena, null, { timeout: 90000 });
await sleep(5000);
const city = await p3.evaluate(() => ({ solo: window.__arena.solo, bots: window.__arena.bots().map(b => b.name) }));
ok(city.solo === true, 'city solo flag');
ok(city.bots.length === 3, `city 3 AI ships: ${city.bots.join(',')}`);
await p3.close();

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
