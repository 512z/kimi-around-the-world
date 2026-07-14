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
await new Promise(r => setTimeout(r, 6000)); // racing
// freeze: park the pack, point camera at player car 3/4 front
await page.evaluate(() => {
  const S = window.SELENE;
  S.game.state = 'paused';
  const p = S.game.player;
  const cam = S.env.camera;
  const T = S.THREE;
  const fwd = new T.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  const right = new T.Vector3(fwd.z, 0, -fwd.x);
  cam.position.copy(p.pos).add(fwd.clone().multiplyScalar(5.5)).add(right.clone().multiplyScalar(3.2)).add(new T.Vector3(0, 2.1, 0));
  cam.lookAt(p.pos.clone().add(new T.Vector3(0, 0.5, 0)));
  cam.fov = 38; cam.updateProjectionMatrix();
  // stop game updates moving the camera: monkeypatch
  S.game.update = () => {};
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/car-studio.png' });
console.log('done');
await browser.close();
