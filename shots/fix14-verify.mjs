import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(8000);
await page.screenshot({ path: 'shots/g_fix14_menu.png' });

// ball screen pos before ENTER (preview) vs after (player)
const ballScreen = () => page.evaluate(() => {
  const v = new window.__THREE.Vector3();
  // preview removed after start; track the local ball instead
  const g = window.__game.local();
  if (!g) return null;
  v.set(g.x, g.y, g.z).project(window.__camera);
  return [+(v.x * 0.5 + 0.5).toFixed(3), +(-v.y * 0.5 + 0.5).toFixed(3)];
});
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 5000 });
const s1 = await ballScreen();
await page.waitForTimeout(900);
const s2 = await ballScreen();
await page.waitForTimeout(1500);
const s3 = await ballScreen();
console.log('ball screen x,y: +0.1s', s1, ' → +1s', s2, ' → +2.5s', s3);
const moved = Math.hypot(s1[0]-s3[0], s1[1]-s3[1]);
console.log(`ball screen drift: ${(moved*100).toFixed(1)}% of screen`);
console.log(moved < 0.12 ? 'CONTINUITY OK' : 'BALL JUMPED');
await page.screenshot({ path: 'shots/g_fix14_play.png' });
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await browser.close();
