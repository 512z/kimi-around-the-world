import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--window-size=1400,800', '--use-gl=angle', '--use-angle=metal', '--no-first-run'],
  defaultViewport: { width: 1400, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404')) console.log('CONSOLE-ERR', m.text()); });
await page.goto('http://localhost:8140/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 8000));
const info = await page.evaluate(() => ({ ok: !!window.SELENE, bootError: window.__bootError || null, errors: window.__errors || [] }));
console.log('STATE:', JSON.stringify(info));
await browser.close();
