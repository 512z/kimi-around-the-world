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
// find bloom pass and disable
const r1 = await page.evaluate(() => {
  const e = window.SELENE.env;
  // composer not exposed; walk renderer? expose quickly:
  return Object.keys(e);
});
console.log('env keys:', r1);
// expose composer from main via SELENE? not present. Instead: reduce exposure to kill bloom input
await page.evaluate(() => {
  // find the player's surroundings: list objects within 30m of player
  const e = window.SELENE.env;
  const p = window.SELENE.game.player.pos;
  const near = [];
  e.scene.traverse(o => {
    if (o.isMesh || o.isSprite || o.isPoints || o.isInstancedMesh) {
      const wp = o.getWorldPosition(new window.SELENE.THREE.Vector3());
      const d = wp.distanceTo(p);
      if (d < 40) near.push(`${o.type}:${o.geometry?.type || o.material?.type}:${d.toFixed(1)}m:vis=${o.visible}`);
    }
  });
  return near;
}).then(r => console.log('near player:', r));
await browser.close();
