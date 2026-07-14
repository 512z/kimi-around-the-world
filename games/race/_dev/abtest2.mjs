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
await new Promise(r => setTimeout(r, 2000));
// hide all chevron pads
await page.evaluate(() => { window.SELENE.env.track.chevrons.forEach(c => { if (c.mesh) c.mesh.visible = false; }); });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'shots/ab-nochevrons.png' });
// also hide gantry + strips + pylons: find by name in scene
await page.evaluate(() => {
  const sc = window.SELENE.env.scene;
  sc.traverse(o => {
    if (o.name === 'stripL' || o.name === 'stripR') o.visible = false;
    if (o.isInstancedMesh && o.geometry.type === 'SphereGeometry') o.visible = false;
  });
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'shots/ab-nostrips.png' });
console.log('done');
await browser.close();
