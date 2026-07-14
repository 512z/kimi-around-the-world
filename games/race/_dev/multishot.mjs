// Multi-shot helper: fresh page per URL (robust against GPU process crashes).
// Usage: node _dev/multishot.mjs coretest v=1 v=2 v=3 v=4 v=5
//    or: node _dev/multishot.mjs index "auto=1&race=1" ...
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page_ = process.argv[2];
const queries = process.argv.slice(3);

for (const q of queries) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--window-size=1600,900', '--use-gl=angle', '--use-angle=metal', '--no-first-run', '--disable-extensions'],
    defaultViewport: { width: 1600, height: 900 },
  });
  try {
    const pg = await browser.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push('CONSOLE ' + m.text()); });
    const url = `http://localhost:8140/_dev/${page_}.html?${q}`;
    await pg.goto(url, { waitUntil: 'load', timeout: 90000 });
    // wait for window.SELENE up to 60s
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await pg.evaluate(() => !!window.SELENE || !!window.__bootError)) break;
    }
    await new Promise(r => setTimeout(r, 1500));
    const name = q.replace(/[^a-z0-9]/gi, '_');
    await pg.screenshot({ path: `shots/${page_}-${name}.png` });
    console.log(`${page_}?${q}: ${errs.length ? 'ISSUES: ' + errs.join(' | ') : 'clean'} -> shots/${page_}-${name}.png`);
  } catch (e) {
    console.log(`${page_}?${q}: FAILED ${e.message}`);
  }
  await browser.close();
}
