import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
await page.goto('https://deploymelene-gp-lvsnviludf.cn-beijing-vpc.fcapp.run/', { waitUntil: 'domcontentloaded', timeout: 60000 });
let booted = false;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  if (await page.evaluate(() => !!window.SELENE)) { booted = true; console.log(`booted from public URL after ${i + 1}s`); break; }
}
await new Promise(r => setTimeout(r, 4000));
const diag = await page.evaluate(() => ({ fps: window.__fps, state: window.SELENE?.state, errors: window.__errors }));
console.log('diag:', JSON.stringify(diag), 'pageerrors:', errs.length ? errs.slice(0, 3) : 'NONE');
await page.screenshot({ path: 'deploy-check.png' });
await browser.close();
