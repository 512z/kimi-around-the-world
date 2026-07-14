import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 2500));
const info = await page.evaluate(() => {
  const S = window.SELENE;
  const g = S.game;
  const out = { state: g.state, cars: g.cars.length, playerVisibleBefore: g.player.mesh.visible };
  g.player.mesh.visible = false;
  // count car-root groups in scene (groups with userData.wheels)
  let carRoots = 0, visCarRoots = 0;
  const names = [];
  g.cars.forEach((c, i) => {
    names.push(`${i}:${c.name}:vis=${c.mesh.visible}:inScene=${!!c.mesh.parent}`);
  });
  out.names = names;
  out.playerVisibleAfter = g.player.mesh.visible;
  return out;
});
console.log(JSON.stringify(info, null, 1));
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/ab6-hidden.png' });
await browser.close();
