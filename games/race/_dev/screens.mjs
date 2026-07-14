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
await new Promise(r => setTimeout(r, 2000));
const key = async (k) => { await page.keyboard.press(k); await new Promise(r => setTimeout(r, 350)); };

await key('ArrowDown'); // CONTROLS
await key('Enter');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: 'shots/screen-controls.png' });
await key('Escape');
await key('ArrowDown'); await key('ArrowDown'); // SETTINGS
await key('Enter');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: 'shots/screen-settings.png' });
await key('ArrowLeft'); // cycle quality
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'shots/screen-settings2.png' });
await key('Escape');
// start race then pause
await key('Enter'); // START RACE
await new Promise(r => setTimeout(r, 1500));
await key('Escape'); // pause
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: 'shots/screen-pause.png' });
const st = await page.evaluate(() => window.SELENE.state);
console.log('state after pause:', st);
await browser.close();
