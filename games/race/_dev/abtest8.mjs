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
await page.screenshot({ path: 'shots/ab8-0-baseline.png' });
// 1: hide glass canopy
await page.evaluate(() => { const m = window.SELENE.game.player.mesh; m.traverse(o => { if (o.material && o.material.transparent && o.material.opacity < 0.7 && o.geometry?.type === 'SphereGeometry') o.visible = false; }); });
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: 'shots/ab8-1-noglass.png' });
// 2: hide neon basic-material emissive parts (strips, rings)
await page.evaluate(() => { const m = window.SELENE.game.player.mesh; m.traverse(o => { if (o.material && o.material.isMeshBasicMaterial && o.geometry?.type !== 'ConeGeometry') o.visible = false; }); });
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: 'shots/ab8-2-noneon.png' });
// 3: hide flames+underglow (additive)
await page.evaluate(() => { const m = window.SELENE.game.player.mesh; m.traverse(o => { if (o.material && o.material.blending === 2) o.visible = false; }); });
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: 'shots/ab8-3-noadd.png' });
// 4: hide paint body (physical material)
await page.evaluate(() => { const m = window.SELENE.game.player.mesh; m.traverse(o => { if (o.material && o.material.isMeshPhysicalMaterial) o.visible = false; }); });
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: 'shots/ab8-4-nopaint.png' });
console.log('done');
await browser.close();
