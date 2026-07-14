import puppeteer from 'puppeteer-core';
async function testGame(url, name, startKeys) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--window-size=1400,800', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
    defaultViewport: { width: 1400, height: 800 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log(name, 'PAGEERROR', e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3500));
  await startKeys(page);
  // measure yaw before/after holding D
  const yaw0 = await page.evaluate(() => window.SELENE ? window.SELENE.game.player.yaw : (window.__sim ? window.__sim.quat.y : null));
  await page.keyboard.down('KeyD');
  await new Promise(r => setTimeout(r, 1400));
  await page.screenshot({ path: `steer-${name}-D.png` });
  await page.keyboard.up('KeyD');
  const yaw1 = await page.evaluate(() => window.SELENE ? +window.SELENE.game.player.yaw.toFixed(3) : null);
  console.log(`${name}: yaw ${yaw0} -> ${yaw1}`);
  await browser.close();
}
// my game: start race then hold D
await testGame('http://localhost:8140/index.html?auto=0&race=1', 'mine', async (page) => {
  await new Promise(r => setTimeout(r, 5000)); // through countdown
});
// moon-race: needs Enter on lobby? click enter button then wait
await testGame('http://localhost:1969/', 'theirs', async (page) => {
  const btn = await page.$('#enter-btn');
  if (btn) { await btn.click(); }
  await new Promise(r => setTimeout(r, 6000));
});
