import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('requestfailed', r => console.log('REQFAIL', r.url(), r.failure()?.errorText));
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => console.log(m.type() + ':', m.text()));
await page.goto('http://localhost:8140/index.html', { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('goto:', e.message));
await new Promise(r => setTimeout(r, 8000));
const info = await page.evaluate(() => ({
  bootError: window.__bootError || null,
  loader: document.querySelector('div[style*="z-index: 100"]')?.textContent || null,
  errors: window.__errors || [],
}));
console.log('STATE:', JSON.stringify(info, null, 1));
await browser.close();
