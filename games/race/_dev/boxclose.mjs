import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/index.html', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await page.evaluate(() => {
  const S = window.SELENE, T = S.THREE;
  S.game.update = () => {};
  const b = S.game.items.boxes[3];
  const cam = S.env.camera;
  cam.position.set(b.x + 14, b.y + 3.5, b.z + 14);
  cam.lookAt(b.x, b.y, b.z);
  cam.fov = 45; cam.updateProjectionMatrix();
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/box-close.png' });
console.log('done');
await browser.close();
