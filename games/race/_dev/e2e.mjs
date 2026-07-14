import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404')) errs.push('console: ' + m.text()); });
await page.goto('http://localhost:8140/index.html', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 2000));
const st = async () => page.evaluate(() => ({ s: window.SELENE.state, menu: window.SELENE.env.menu.currentScreen(), errs: window.__errors.length }));
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await new Promise(r => setTimeout(r, 300)); } };

console.log('boot:', JSON.stringify(await st()));
// menu nav: down to SETTINGS, cycle quality, back, then START
await key('ArrowDown', 2); // settings
await key('Enter');
console.log('settings:', JSON.stringify(await st()));
await key('ArrowLeft');
const q = await page.evaluate(() => JSON.parse(localStorage.getItem('selene-settings')));
console.log('quality after cycle:', q.quality, '(expect MEDIUM)');
await key('ArrowRight'); // back to HIGH
await key('Escape');
console.log('back to main:', JSON.stringify(await st()));
await key('Enter'); // START RACE
await new Promise(r => setTimeout(r, 2000));
console.log('countdown:', JSON.stringify(await st()));
await new Promise(r => setTimeout(r, 5000));
console.log('racing:', JSON.stringify(await st()));
// manual driving check: hold W + A briefly
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
await new Promise(r => setTimeout(r, 1200));
await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
const drv = await page.evaluate(() => ({ spd: Math.round(window.SELENE.game.player.speedKmh), yawV: +window.SELENE.game.player.yawVel.toFixed(2), input: window.SELENE.game.input }));
console.log('manual input response: speed', drv.spd, 'km/h (W worked:', drv.spd > 30, ')');
// R reset
await key('KeyR');
console.log('after R:', JSON.stringify(await st()));
// pause + resume
await key('Escape');
console.log('paused:', JSON.stringify(await st()));
await key('Enter'); // RESUME
await new Promise(r => setTimeout(r, 500));
console.log('resumed:', JSON.stringify(await st()));
// fast-forward to results
await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player, L = g.env.track.length;
  g.clock = 400; p.lap = 2; p.lapTimes = [138, 141]; p.cpIndex = 12; p.lapStart = 380;
  p.totalDist = L * 3 - 40;
  const f = g.env.track.frameAt(L - 40);
  p.pos.set(f.x, f.y + 0.52, f.z); p.s = L - 40; p.lastS = L - 40;
  p.vel.set(Math.sin(p.yaw) * 55, 0, Math.cos(p.yaw) * 55);
});
for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 1000)); if ((await st()).s === 'results') break; }
console.log('results:', JSON.stringify(await st()));
// quit to menu
await key('ArrowDown');
await key('Enter');
await new Promise(r => setTimeout(r, 800));
console.log('quit to menu:', JSON.stringify(await st()));
console.log('pageerrors:', errs.length ? errs.slice(0, 5) : 'NONE');
await page.screenshot({ path: 'shots/e2e-final.png' });
await browser.close();
