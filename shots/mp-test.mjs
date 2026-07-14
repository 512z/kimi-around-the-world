// Multiplayer + menu verification: two browser contexts on node server.js.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });
const BASE = 'http://localhost:8125/';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function newPage(ctx) {
  const page = await ctx.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__sceneReady === true', undefined, { timeout: 120000 });
  await sleep(800);
  return page;
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
// concurrent loads: a ready page animating on SwiftShader starves the next navigation
const [pageA, pageB] = await Promise.all([newPage(ctxA), newPage(ctxB)]);
console.log('both pages ready');

// ---- enter game via the menu (real Enter key on first item)
await pageA.keyboard.press('Enter');
await pageB.keyboard.press('Enter');
await sleep(2500);

const stateA = await pageA.evaluate(() => window.__game.state());
const stateB = await pageB.evaluate(() => window.__game.state());
const onlineA = await pageA.evaluate(() => window.__game.netOnline());
const onlineB = await pageB.evaluate(() => window.__game.netOnline());
const crewA = await pageA.evaluate(() => window.__game.crew());
console.log(`states: A=${stateA} B=${stateB} online: A=${onlineA} B=${onlineB} crewA=${crewA}`);

// ---- spawn deconfliction
const la = await pageA.evaluate(() => window.__game.local());
const lb = await pageB.evaluate(() => window.__game.local());
const spawnDist = Math.hypot(la.x - lb.x, la.z - lb.z);
console.log(`spawn distance: ${spawnDist.toFixed(2)}m (need >= 1.6)`);

// ---- drive both balls at each other, sample min distance
function azTo(from, to) {
  const fx = to.x - from.x, fz = to.z - from.z;
  const fl = Math.hypot(fx, fz) || 1;
  return Math.atan2(-fx / fl, -fz / fl); // fwd = (-sin az, -cos az)
}
await pageA.evaluate((az) => window.__game.setAzimuth(az), azTo(la, lb));
await pageB.evaluate((az) => window.__game.setAzimuth(az), azTo(lb, la));
await pageA.evaluate(() => window.__game.setKey('KeyW', true));
await pageB.evaluate(() => window.__game.setKey('KeyW', true));

let minDist = Infinity;
const samples = [];
for (let i = 0; i < 36; i++) {
  await sleep(140);
  const a = await pageA.evaluate(() => window.__game.local());
  const b = await pageB.evaluate(() => window.__game.local());
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  minDist = Math.min(minDist, d);
  samples.push(+d.toFixed(2));
}
await pageA.evaluate(() => window.__game.setKey('KeyW', false));
await pageB.evaluate(() => window.__game.setKey('KeyW', false));
await sleep(1200);
const a2 = await pageA.evaluate(() => window.__game.local());
const b2 = await pageB.evaluate(() => window.__game.local());
const finalDist = Math.hypot(a2.x - b2.x, a2.z - b2.z);
console.log(`min contact distance: ${minDist.toFixed(2)}m (need >= ~1.52), final after release: ${finalDist.toFixed(2)}m`);
console.log(`samples: ${samples.join(' ')}`);

// ---- screenshots: gameplay with 2 balls + labels (idle -> balls turn to camera)
await sleep(1600);
await pageA.screenshot({ path: 'shots/g_play.png' });

// pause screen
await pageA.keyboard.press('Escape');
await sleep(700);
await pageA.screenshot({ path: 'shots/g_pause.png' });
await pageA.keyboard.press('Escape'); // resume
await sleep(500);

// ---- menu screens (page B: leave to attract first)
await pageB.keyboard.press('Escape');
await sleep(400);
await pageB.evaluate(() => { // select LEAVE GAME via keyboard: down, enter
});
await pageB.keyboard.press('ArrowDown');
await sleep(150);
await pageB.keyboard.press('Enter');
await sleep(900);
await pageB.screenshot({ path: 'shots/g_menu.png' });

// name edit mode: ArrowDown to NAME, Enter
await pageB.keyboard.press('ArrowDown');
await sleep(150);
await pageB.keyboard.press('Enter');
await sleep(500);
await pageB.screenshot({ path: 'shots/g_nameedit.png' });
await pageB.keyboard.press('KeyC'); // becomes CIMI
await sleep(400);

// color cycle + controls screen
await pageB.keyboard.press('ArrowDown'); // to COLOR
await sleep(150);
await pageB.keyboard.press('ArrowRight');
await sleep(200);
await pageB.keyboard.press('ArrowRight');
await sleep(300);
await pageB.screenshot({ path: 'shots/g_color.png' });
await pageB.keyboard.press('ArrowDown'); // to CONTROLS
await sleep(150);
await pageB.keyboard.press('Enter');
await sleep(700);
await pageB.screenshot({ path: 'shots/g_controls.png' });

const persisted = await pageB.evaluate(() => ({
  name: localStorage.getItem('kimi.name'), color: localStorage.getItem('kimi.color'),
}));
console.log(`persisted profile: ${JSON.stringify(persisted)}`);

writeFileSync('shots/errors.txt', errors.length ? errors.join('\n') + '\n' : 'NO ERRORS\n');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no errors');
await browser.close();
