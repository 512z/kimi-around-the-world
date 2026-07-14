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
await page.evaluate(() => { window.SELENE.game.player.mesh.visible = false; });
await new Promise(r => setTimeout(r, 600));
const reread = await page.evaluate(() => window.SELENE.game.player.mesh.visible);
console.log('player visible after 600ms:', reread);
await page.evaluate(() => { window.SELENE.game.cars.forEach(c => c.mesh.visible = false); });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'shots/ab7-allhidden.png' });
// check for stray meshes near player pos
const stray = await page.evaluate(() => {
  const S = window.SELENE, p = S.game.player.pos, out = [];
  S.env.scene.traverse(o => {
    if ((o.isMesh || o.isSprite || o.isPoints) && o.visible) {
      const wp = o.getWorldPosition(new S.THREE.Vector3());
      if (wp.distanceTo(p) < 12) out.push(`${o.type}:${o.geometry?.type || 'sprite'}:${wp.distanceTo(p).toFixed(1)}m:parent=${o.parent?.type}:${parentVisible(o)}`);
    }
  });
  function parentVisible(o) { let v = true; let x = o; while (x) { v = v && x.visible; x = x.parent; } return v; }
  return out;
});
console.log('visible objects within 12m of player:', JSON.stringify(stray));
await browser.close();
