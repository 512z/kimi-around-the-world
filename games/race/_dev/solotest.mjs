// Solo-mode (lobby NPC handoff) headless check.
// Serves the game on a scratch port and asserts:
//   - solo=1 + npcs boots straight into the countdown (no menu, no WebSocket)
//   - the grid is the player (name/color from params) + exactly the 3 NPCs
//   - countdown -> race, NPC cars actually move, no console errors
//   - player finish -> results with all 4 names; restart keeps the lineup
// Run: node _dev/solotest.mjs   (needs the game served on :9191)
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:9191/?solo=1&name=KIMI&color=2e7bf6' +
  '&npcs=' + encodeURIComponent('YIMI:f2c94c,RIMI:eb5757,GIMI:27ae60') +
  '&back=' + encodeURIComponent('http://localhost:9100/');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404')) errs.push('console: ' + m.text()); });
await page.evaluateOnNewDocument(() => {
  window.__wsAttempts = [];
  const WS = window.WebSocket;
  window.WebSocket = function (...a) { window.__wsAttempts.push(a[0]); return new WS(...a); };
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 1500));

// drive the game loop manually (headless rAF can be throttled)
const step = (frames, dt = 1 / 60) => page.evaluate((n, d) => { for (let i = 0; i < n; i++) window.__game.update(d); }, frames, dt);
const st = () => page.evaluate(() => ({ s: window.SELENE.state, screen: window.SELENE.env.menu.currentScreen() }));
const grid = () => page.evaluate(() => window.__game.grid());

let fail = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : '')); if (!ok) fail++; };

const s0 = await st();
check('boots straight to countdown (no menu stop)', s0.s === 'countdown' && s0.screen === 'none', JSON.stringify(s0));

const g0 = await grid();
const want = [['YIMI', '#f2c94c'], ['RIMI', '#eb5757'], ['GIMI', '#27ae60'], ['KIMI', '#2e7bf6']];
check('grid = 3 NPCs + player, names+colors from URL',
  g0.length === 4 && want.every(([n, c], i) => g0[i].name === n && g0[i].color === c) && g0[3].isPlayer && !g0[0].isPlayer,
  JSON.stringify(g0.map(c => [c.name, c.color, c.isPlayer])));

const ws = await page.evaluate(() => window.__wsAttempts);
check('no WebSocket attempted', ws.length === 0, JSON.stringify(ws));

check('back link rendered', await page.evaluate(() => [...document.querySelectorAll('a')].some(a => a.textContent.includes('BACK TO THE MOON'))));

// countdown -> race
await step(60 * 6);
const s1 = await st();
check('countdown reaches race', s1.s === 'race', JSON.stringify(s1));

// NPCs move under their own AI
const p0 = await grid();
await step(60 * 20);
const p1 = await grid();
const moved = p1.map((c, i) => Math.hypot(c.x - p0[i].x, c.z - p0[i].z));
check('NPC cars progress around the track', moved.slice(0, 3).every(d => d > 50), 'moved(m): ' + moved.map(d => d.toFixed(0)).join(','));

// fast-forward the player to the finish (same trick as _dev/e2e.mjs)
await page.evaluate(() => {
  const g = window.__game, p = g.player, L = g.env.track.length;
  g.clock = 300; p.lap = 2; p.lapTimes = [138, 141]; p.cpIndex = 12; p.lapStart = 280;
  p.totalDist = L * 3 - 40;
  const f = g.env.track.frameAt(L - 40);
  p.pos.set(f.x, f.y + 0.52, f.z); p.s = L - 40; p.lastS = L - 40;
  p.vel.set(Math.sin(p.yaw) * 55, 0, Math.cos(p.yaw) * 55);
});
for (let i = 0; i < 40; i++) { await step(30); if ((await st()).s === 'results') break; }
const s2 = await st();
check('player finish -> results', s2.s === 'results', JSON.stringify(s2));
const res = await page.evaluate(() => document.querySelector('#ui').textContent);
const allNamed = ['YIMI', 'RIMI', 'GIMI', 'KIMI'].every(n => res.includes(n));
check('results screen lists all 4 drivers', allNamed, allNamed ? '' : res.slice(0, 200));

// restart keeps the same 3 NPCs
await page.evaluate(() => window.__game.startRace());
await step(30);
const g2 = await grid();
check('restart keeps same lineup', g2.length === 4 && want.every(([n, c], i) => g2[i].name === n && g2[i].color === c),
  JSON.stringify(g2.map(c => [c.name, c.color])));

// plain launch still boots to the attract menu
const page2 = await browser.newPage();
const errs2 = [];
page2.on('pageerror', e => errs2.push(e.message));
await page2.goto('http://localhost:9191/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page2.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 1500));
const plain = await page2.evaluate(() => ({ s: window.SELENE.state, screen: window.SELENE.env.menu.currentScreen(), cars: window.__game.cars.length }));
check('plain launch unchanged (attract + main menu + 8 cars)', plain.s === 'attract' && plain.screen === 'main' && plain.cars === 8, JSON.stringify(plain));

check('no page/console errors (solo)', errs.length === 0, errs.slice(0, 3).join(' | '));
check('no page errors (plain)', errs2.length === 0, errs2.slice(0, 3).join(' | '));

await browser.close();
console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
process.exit(fail === 0 ? 0 : 1);
