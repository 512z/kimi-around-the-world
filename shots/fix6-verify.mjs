// Verify round 6: full Earth in opening, lower camera, preview ball in attract,
// live name/color preview from the menu.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8125';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// 1) opening frame: Earth fully visible?
await page.goto(`${BASE}/?t=0`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/g_fix6_open.png' });

// 2) close pass: preview ball + label in frame
await page.goto(`${BASE}/?t=68`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__sceneReady, { timeout: 20000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shots/g_fix6_ball.png' });

// 3) live profile edit: NAME -> CIMI, COLOR -> YELLOW
await page.keyboard.press('ArrowDown');   // select NAME
await page.keyboard.press('Enter');       // edit mode
await page.keyboard.press('KeyC');        // C -> CIMI
await page.keyboard.press('ArrowDown');   // select COLOR
await page.keyboard.press('ArrowRight');  // BLUE -> YELLOW
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/g_fix6_profile.png' });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
