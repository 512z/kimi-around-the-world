// NPC color rule: no NPC ever matches the player's color.
import { chromium } from '/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/blender-kimi/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--no-first-run'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;

for (const [playerColor, expect] of [
  ['yellow', ['#eb5757', '#2e7bf6', '#27ae60']],  // red, blue, green
  ['blue',   ['#f2c94c', '#eb5757', '#27ae60']],  // yellow, red, green
  ['green',  ['#f2c94c', '#eb5757', '#2e7bf6']],  // yellow, red, blue
  ['red',    ['#f2c94c', '#2e7bf6', '#27ae60']],  // yellow, blue, green
  ['brown',  ['#f2c94c', '#eb5757', '#2e7bf6']],  // yellow, red, blue
]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((c) => localStorage.setItem('kimi.color', c), playerColor);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('http://localhost:8125/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
  await sleep(6500);
  await page.keyboard.press('Enter'); // ENTER THE MOON -> mode screen
  await sleep(600);
  await page.keyboard.press('Enter'); // SINGLE PLAYER
  await sleep(1500);
  const npcs = await page.evaluate(() => window.__game.npcs().map(n => n.color));
  const got = JSON.stringify(npcs), want = JSON.stringify(expect);
  const ok = npcs.length === 3 && expect.every(c => npcs.includes(c)) && !npcs.includes(null);
  console.log(`${ok ? 'PASS' : 'FAIL'} player=${playerColor} -> npcs=${got} (want ${want})`);
  if (!ok) fail++;
  await ctx.close();
}
await browser.close();
console.log(fail ? `${fail} FAIL` : 'ALL PASS');
process.exit(fail ? 1 : 0);
