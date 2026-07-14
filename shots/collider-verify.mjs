// Verify: ball cannot penetrate any base structure.
// Method: teleport the ball INSIDE each collider — the resolver must eject it.
// (Timing-proof, unlike ram tests under headless rAF throttling.)
import { chromium } from 'playwright';

const BASE = 'http://localhost:8125';
const BALL_R = 0.82;
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state() === 'ATTRACT', { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.local(), { timeout: 10000 });
await page.waitForTimeout(3000);

const L = () => page.evaluate(() => window.__game.local());
const cols = () => page.evaluate(() => window.__game.colliders());

async function ejectTest(name, x, z, penFn, extraWait = 1500) {
  await page.evaluate(([x, z]) => window.__game.tp(x, z), [x, z]);
  await page.waitForTimeout(extraWait);
  const p = await L();
  const pen = await penFn(p);
  const pass = pen > -0.15;
  console.log(`${pass ? 'OK ' : 'FAIL'} ${name}: margin ${pen.toFixed(2)} m (ball at ${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  return pass;
}

function penCapsule(p, c) {
  const ex = c.bx - c.ax, ez = c.bz - c.az;
  const len2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((p.x - c.ax) * ex + (p.z - c.az) * ez) / len2));
  return Math.hypot(p.x - (c.ax + ex * t), p.z - (c.az + ez * t)) - (BALL_R + c.r);
}
const penCyl = (p, c) => Math.hypot(p.x - c.x, p.z - c.z) - (BALL_R + c.r);
function penBox(p, c) {
  const cos = Math.cos(-c.yaw), sin = Math.sin(-c.yaw);
  const dx = p.x - c.x, dz = p.z - c.z;
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
  const ox = Math.abs(lx) - c.hx, oz = Math.abs(lz) - c.hz;
  return Math.hypot(Math.max(0, ox), Math.max(0, oz)) + Math.min(Math.max(ox, oz), 0) - BALL_R;
}

let ok = true;
const run = async (...a) => { if (!await ejectTest(...a)) ok = false; };

// static shapes: ball dropped inside, must be ejected to the surface
await run('module M1 (capsule)', 5, 3, (p) => penCapsule(p, { ax: -10, az: 0, bx: 10, bz: 0, r: 6 }));
await run('dome (cylinder)', -50, -14, (p) => penCyl(p, { x: -50, z: -18, r: 7 }));
await run('tower (cylinder)', -88, -71, (p) => penCyl(p, { x: -88, z: -72, r: 1.8 }));
await run('solar pole', 143.5, 8.3, (p) => penCyl(p, { x: 143.5, z: 8, r: 0.5 }));
await run('tunnel M1-M2', -19.8, 11.7, (p) => penCapsule(p, { ax: 0, az: 0, bx: -44, bz: 26, r: 2.8 }));
await run('lander (box)', -142, 116, (p) => penBox(p, { x: -142, z: 116, hx: 3.5, hz: 3.5, yaw: 0 }));

// parked rover: inside its box
let cs = await cols();
const parked = cs.find((c) => c.type === 'box' && Math.abs(c.x + 160) < 1 && Math.abs(c.z - 130) < 1);
await run('parked rover (box)', parked.x, parked.z, (p) => penBox(p, parked));

// walking astronaut: drop ball on top of the live collider; it walks on —
// the ball must never be left inside
cs = await cols();
const astro = cs.find((c) => c.type === 'cylinder' && c.r === 0.5 && Math.abs(c.x + 118) < 8 && Math.abs(c.z - 88) < 8);
await run('walking astronaut', astro.x, astro.z, async (p) => {
  const cs2 = await cols();
  const a2 = cs2.find((c) => c.type === 'cylinder' && c.r === 0.5);
  return penCyl(p, a2);
}, 2500);

// moving rover: drop ball on its live position
cs = await cols();
const rover = cs.find((c) => c.type === 'box' && c.hx === 1.4 && Math.abs(c.x + 160) > 2 && Math.abs(c.x + 120) > 2);
await run('moving rover (box)', rover.x, rover.z, async (p) => {
  const cs2 = await cols();
  const r2 = cs2.find((c) => c.type === 'box' && c.hx === 1.4 && Math.abs(c.x + 160) > 2 && Math.abs(c.x + 120) > 2);
  return penBox(p, r2);
}, 2000);

console.log(ok ? 'ALL COLLIDERS HOLD' : 'PENETRATION DETECTED');
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO ERRORS');
await browser.close();
