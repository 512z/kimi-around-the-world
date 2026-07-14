// Autopilot soak test: starts a race with ?auto=1&race=1, samples telemetry
// every 2s for N minutes, checks laps/checkpoints/AI progress/NaN/fps.
// Usage: node _dev/soak.mjs [minutes] [W] [H]
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const minutes = parseFloat(process.argv[2] || '4');
const W = parseInt(process.argv[3] || '1600');
const H = parseInt(process.argv[4] || '900');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: [`--window-size=${W},${H}`, '--use-gl=angle', '--use-angle=metal', '--no-first-run', '--disable-extensions'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:8140/index.html?auto=1&race=1', { waitUntil: 'domcontentloaded' });

for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  if (await page.evaluate(() => !!window.SELENE)) break;
}
console.log('booted, starting soak');

const samples = [];
const tEnd = Date.now() + minutes * 60000;
while (Date.now() < tEnd) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await page.evaluate(() => {
    const g = window.SELENE?.game;
    if (!g) return null;
    const p = g.player;
    const bad = g.cars.find(c => !isFinite(c.pos.x + c.pos.y + c.pos.z) || c.pos.y < -600 || c.pos.y > 2000);
    return {
      fps: window.__fps, state: g.state, clock: +g.clock.toFixed(1),
      lap: p.lap, laps: p.lapTimes.map(t => +t.toFixed(2)), cp: p.cpIndex,
      pos: g.order.indexOf(p) + 1, spd: Math.round(p.speedKmh), y: +p.pos.y.toFixed(1),
      air: +p.airTime.toFixed(2), s: Math.round(p.s),
      ai: g.cars.filter(c => c !== p).map(c => ({ lap: c.lap, s: Math.round(c.s) })),
      bad: bad ? bad.name : null,
      errors: window.__errors.length,
    };
  });
  if (!s) continue;
  samples.push(s);
  const aiSummary = s.ai.map(a => `${a.lap}:${a.s}`).join(' ');
  console.log(`t=${s.clock}s st=${s.state} fps=${s.fps} P${s.pos} lap=${s.lap} cp=${s.cp} spd=${s.spd} y=${s.y} air=${s.air} | ai ${aiSummary}${s.bad ? ' BAD=' + s.bad : ''}${s.errors ? ' ERRORS=' + s.errors : ''}`);
  if (s.bad || s.errors) { console.log('!! problem detected, stopping'); break; }
  if (s.state === 'results') {
    const res = await page.evaluate(() => window.__lastResults || null);
    console.log('RESULTS state reached. laps:', JSON.stringify(s.laps));
    await page.screenshot({ path: new URL('./shots/soak-results.png', import.meta.url).pathname });
    break;
  }
}
console.log('console issues:', logs.length ? '\n' + logs.slice(0, 20).join('\n') : 'none');
await browser.close();
