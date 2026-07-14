// GitHub Pages deployment verification:
// https://512z.github.io/kimi-around-the-world/ → SINGLE PLAYER → NPCs →
// launch MOON RACE → must land on the in-repo static race page (not a port).
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const BASE = 'https://512z.github.io/kimi-around-the-world/';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l); } };

const page = await ctx.newPage();
page.on('pageerror', e => console.log('  pageerror:', e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 });
await sleep(6500);

await page.keyboard.press('Enter'); // ENTER THE MOON -> mode screen
await sleep(800);
await page.keyboard.press('Enter'); // SINGLE PLAYER
await sleep(2500);
const st = await page.evaluate(() => ({ mode: window.__game.mode(), crew: window.__game.crew(), npcs: window.__game.npcs().length }));
ok(st.mode === 'single', `lobby single mode on Pages (mode=${st.mode})`);
ok(st.crew === 4 && st.npcs === 3, `3 NPCs spawned on Pages (crew=${st.crew})`);

await page.click('.host-start[data-game="race"]');
await page.waitForURL(/games\/race/, { timeout: 30000 });
const url = page.url();
ok(url.includes('kimi-around-the-world/games/race/'), `redirect stays on Pages: ${url.slice(0, 110)}`);
ok(url.includes('solo=1') && url.includes('npcs='), 'solo+npcs params carried');

await page.waitForFunction(() => window.SELENE && window.SELENE.game, null, { timeout: 90000 });
await sleep(3000);
const race = await page.evaluate(() => ({
  state: window.SELENE.game.state,
  grid: window.__game.grid().map(c => ({ name: c.name, isPlayer: c.isPlayer })),
}));
ok(race.state === 'countdown' || race.state === 'race', `race boots on Pages (state=${race.state})`);
ok(race.grid.length === 4, `4-car NPC grid on Pages (${race.grid.map(c => c.name).join(',')})`);
await page.screenshot({ path: 'shots/pages-verify.png' });

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
