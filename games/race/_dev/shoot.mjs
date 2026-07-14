// Headless verification harness v2: retry on GPU-process detachment.
// Usage: node _dev/shoot.mjs <outName> [urlQuery] [runSeconds] [W H]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const name = process.argv[2] || 'shot';
const query = process.argv[3] || '';
const runSec = parseFloat(process.argv[4] || '6');
const W = parseInt(process.argv[5] || '1600');
const H = parseInt(process.argv[6] || '900');
mkdirSync(new URL('./shots/', import.meta.url).pathname, { recursive: true });

for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      '--use-gl=angle', '--use-angle=metal',
      '--enable-webgpu', '--ignore-gpu-blocklist',
      '--no-first-run', '--disable-extensions',
    ],
    defaultViewport: { width: W, height: H },
  });
  try {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('favicon')) logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    const url = `http://localhost:8140/index.html${query ? '?' + query : ''}`;
    console.log('loading', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let booted = false;
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await page.evaluate(() => ({
        ok: !!window.SELENE, bootError: window.__bootError || null, errors: window.__errors || [],
      })).catch(() => null);
      if (!st) throw new Error('detached');
      if (st.bootError) { console.log('BOOT ERROR:', st.bootError); break; }
      if (st.ok) { booted = true; console.log(`booted after ${i + 1}s`); break; }
      if (i % 10 === 9) console.log(`waiting... ${i + 1}s`);
    }

    if (booted) {
      await new Promise(r => setTimeout(r, runSec * 1000));
      const diag = await page.evaluate(() => ({
        fps: window.__fps, state: window.SELENE?.state, errors: window.__errors,
      }));
      console.log('diag:', JSON.stringify(diag));
    }
    console.log('console issues:', logs.length ? '\n' + logs.join('\n') : 'none');
    await page.screenshot({ path: new URL(`./shots/${name}.png`, import.meta.url).pathname });
    console.log('saved', `shots/${name}.png`);
    await browser.close();
    break;
  } catch (e) {
    console.log(`attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`);
    await browser.close().catch(() => {});
    if (attempt === 2) process.exit(1);
  }
}
