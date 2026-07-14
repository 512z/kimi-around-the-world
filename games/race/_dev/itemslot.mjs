import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1400,800', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 6000));
// teleport the player right onto a box
const got = await page.evaluate(() => {
  const g = window.SELENE.game, p = g.player;
  const b = g.items.boxes.find(b => b.active);
  p.pos.set(b.x, g.env.terrain.sampleHeight(b.x, b.z) + 0.52, b.z);
  p.vel.set(0, 0, 5);
  return true;
});
await new Promise(r => setTimeout(r, 600));
const state = await page.evaluate(() => {
  const p = window.SELENE.game.player;
  const wrap = window.SELENE.env.menu.currentScreen();
  const el = document.querySelector('[data-hud="itemwrap"]');
  const cs = el ? getComputedStyle(el) : null;
  return { item: p.item, wrapHidden: el?.classList.contains('hidden'), opacity: cs?.opacity, name: document.querySelector('[data-hud="itemname"]')?.textContent };
});
console.log('pickup state:', JSON.stringify(state));
await page.screenshot({ path: 'shots/item-slot-check.png' });
await browser.close();
