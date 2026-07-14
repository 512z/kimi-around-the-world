import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); if (await page.evaluate(() => !!window.SELENE)) break; }
await new Promise(r => setTimeout(r, 6000));
const shoot = async (name, setup) => {
  await page.evaluate(setup);
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: `shots/${name}.png` });
};
const frameCar = (carExpr) => `(() => {
  const S = window.SELENE, T = S.THREE;
  S.game.update = () => {};
  const p = ${carExpr};
  const cam = S.env.camera;
  const fwd = new T.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  const right = new T.Vector3(fwd.z, 0, -fwd.x);
  cam.position.copy(p.pos).add(fwd.clone().multiplyScalar(5.5)).add(right.clone().multiplyScalar(3.2)).add(new T.Vector3(0, 2.1, 0));
  cam.lookAt(p.pos.clone().add(new T.Vector3(0, 0.5, 0)));
  cam.fov = 38; cam.updateProjectionMatrix();
})()`;
// A: player as-is
await shoot('cs2-player', frameCar('S.game.player'));
// B: player, emissive killed on all physical materials
await shoot('cs2-noemis', `(() => {
  ${frameCar('S.game.player')}
  window.SELENE.game.player.mesh.traverse(o => { if (o.material && o.material.isMeshPhysicalMaterial) { o.material.emissiveIntensity = 0; o.material.needsUpdate = true; } });
})()`);
// C: APEX (cyan AI car) as-is
await shoot('cs2-apex', frameCar('S.game.cars[0]'));
console.log('done');
await browser.close();
