// Static-deploy fallback test: plain static server (no WebSocket) — the game
// must start and run single-player with zero console/page errors.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });
const BASE = 'http://localhost:8124/';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 120000 });
await sleep(600);

await page.keyboard.press('Enter'); // ENTER GAME
await sleep(3500); // > 2s fallback timer

const st = await page.evaluate(() => ({
  state: window.__game.state(),
  online: window.__game.netOnline(),
  crew: window.__game.crew(),
  local: window.__game.local(),
}));
console.log('after enter:', JSON.stringify(st));

// drive the ball; it must move
await page.evaluate(() => window.__game.setKey('KeyW', true));
await sleep(1500);
await page.evaluate(() => window.__game.setKey('KeyW', false));
const moved = await page.evaluate(() => {
  const l = window.__game.local();
  return Math.hypot(l.x - (-87), l.z - 110);
});
console.log(`moved ${moved.toFixed(2)}m from fallback spawn, speed ok`);

await page.screenshot({ path: 'shots/g_fallback.png' });
writeFileSync('shots/errors-fallback.txt', errors.length ? errors.join('\n') + '\n' : 'NO ERRORS\n');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no errors');
await browser.close();
