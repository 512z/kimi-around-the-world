import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 2000)); // countdown phase
await page.screenshot({ path: 'shots/ab-baseline.png' });
// A: kill dust
await page.evaluate(() => { window.SELENE.game.dust.emitFromCar = () => {}; });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shots/ab-nodust.png' });
// B: also hide flames + underglow on player
await page.evaluate(() => {
  const p = window.SELENE.game.player.mesh;
  p.userData.flames.forEach(f => f.visible = false);
  if (p.userData.underglow) p.userData.underglow.visible = false;
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shots/ab-noflames.png' });
// C: also hide the whole player mesh
await page.evaluate(() => { window.SELENE.game.player.mesh.visible = false; });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shots/ab-nocar.png' });
// D: check renderer exposure/bloom state
const info = await page.evaluate(() => {
  const e = window.SELENE.env;
  return { hasBloom: true };
});
console.log('done');
await browser.close();
