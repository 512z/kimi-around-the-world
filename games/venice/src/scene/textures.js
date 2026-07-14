// Procedural canvas textures for the Venice scene.
// Everything is generated at load time; no image assets needed.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(canvas, { srgb = false, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// small value-noise helpers for canvas dirt
function splat(ctx, x, y, r, color, alpha, rng) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- facades ---
// Atlas: 2048 x 2560. Cells 512x1024:
//   row 0: F0..F3  (x = i*512, y = 0)
//   row 1: F4..F7  (x = i*512, y = 1024)
//   row 2 (y=2048, h=512): B0..B3 blind/plaster cells (x = i*512)
const ATLAS_W = 2048, ATLAS_H = 2560;
export const FACADE_CELLS = 8;
export const BLIND_CELLS = 4;
export function facadeCellUV(i) {
  return { u: (i % 4) * 512 / ATLAS_W, v: 1 - (Math.floor(i / 4) * 1024 + 1024) / ATLAS_H,
           w: 512 / ATLAS_W, h: 1024 / ATLAS_H };
}
export function blindCellUV(i) {
  return { u: i * 512 / ATLAS_W, v: 1 - (2048 + 512) / ATLAS_H, w: 512 / ATLAS_W, h: 512 / ATLAS_H };
}

const PLASTERS = ['#a9714b', '#bf8a62', '#b8836a', '#c9a884', '#9e7a55', '#b39a7d', '#a86848', '#c0956f', '#a98f76', '#bb7e58'];
const SHUTTERS = ['#3f5c4a', '#4a6b52', '#37574f', '#55624a', '#2f4f5c', '#5a5242', '#6b3f3a'];

function drawBrickPatch(ctx, x, y, w, h, rng, base = '#8a5a44') {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
  const bh = 9, bw = 22;
  ctx.fillStyle = 'rgba(40,25,20,.55)';
  for (let yy = y; yy < y + h; yy += bh) {
    const off = ((yy / bh) | 0) % 2 ? bw / 2 : 0;
    ctx.fillRect(x, yy, w, 1.4);
    for (let xx = x - bw; xx < x + w; xx += bw) ctx.fillRect(xx + off, yy, 1.4, bh);
  }
  // tonal variation between bricks
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${rng() > .5 ? '255,230,210' : '20,10,8'},${0.04 + rng() * 0.06})`;
    ctx.fillRect(x + rng() * w, y + rng() * h, bw * 0.8, bh * 0.7);
  }
  ctx.restore();
}

function drawArchedWindow(ctx, E, x, y, w, h, rng, lit, opts = {}) {
  const r = w * 0.5; // arch radius
  const frame = Math.max(3, w * 0.10);
  // stone surround
  ctx.fillStyle = '#cabfa8';
  ctx.beginPath();
  ctx.moveTo(x - frame, y + h);
  ctx.lineTo(x - frame, y + r);
  ctx.arc(x + w / 2, y + r, r + frame, Math.PI, 0);
  ctx.lineTo(x + w + frame, y + h);
  ctx.closePath(); ctx.fill();
  // inner shadow line
  ctx.fillStyle = 'rgba(60,50,40,.5)';
  ctx.fillRect(x - frame, y + h - 2, w + frame * 2, 4);
  // glass
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (lit) { g.addColorStop(0, '#6e4a22'); g.addColorStop(1, '#33220f'); }
  else { g.addColorStop(0, '#2e4054'); g.addColorStop(.45, '#1f2c3a'); g.addColorStop(1, '#121a24'); }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x, y + r);
  ctx.arc(x + w / 2, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
  // sky glint on glass
  if (!lit) {
    ctx.fillStyle = 'rgba(150,180,200,.10)';
    ctx.beginPath();
    ctx.moveTo(x + w * .15, y + r * 1.1); ctx.lineTo(x + w * .55, y + r * 1.1);
    ctx.lineTo(x + w * .25, y + h * .75); ctx.lineTo(x + w * .05, y + h * .75);
    ctx.closePath(); ctx.fill();
  }
  // mullions
  ctx.strokeStyle = lit ? 'rgba(30,18,8,.8)' : 'rgba(8,12,16,.85)';
  ctx.lineWidth = Math.max(1.5, w * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x + 2, y + h * .55); ctx.lineTo(x + w - 2, y + h * .55);
  ctx.stroke();
  // sill
  ctx.fillStyle = '#b8ac95';
  ctx.fillRect(x - frame * 1.4, y + h, w + frame * 2.8, frame * 1.2);
  // shutters (open)
  if (!opts.noShutters && rng() > 0.25) {
    const sw = w * 0.52;
    const col = SHUTTERS[(rng() * SHUTTERS.length) | 0];
    for (const side of [-1, 1]) {
      const sx = side < 0 ? x - frame - sw * (0.55 + rng() * 0.3) : x + w + frame - sw * (0.15 + rng() * 0.3);
      ctx.fillStyle = col;
      ctx.fillRect(sx, y + r * 0.7, sw, h - r * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      for (let s = 1; s < 5; s++) ctx.fillRect(sx + (sw / 5) * s - 1, y + r * 0.7, 2, h - r * 0.5);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(sx, y + r * 0.7, 2, h - r * 0.5);
    }
  }
  // rain streaks below window
  ctx.strokeStyle = 'rgba(40,32,26,.16)';
  ctx.lineWidth = 1;
  for (let s = 0; s < 4; s++) {
    const sx = x + rng() * w;
    ctx.beginPath(); ctx.moveTo(sx, y + h + 4); ctx.lineTo(sx + (rng() - .5) * 6, y + h + 18 + rng() * 40); ctx.stroke();
  }
  // emissive pass
  if (lit && E) {
    E.fillStyle = '#d98a3c';
    E.beginPath();
    E.moveTo(x, y + h); E.lineTo(x, y + r);
    E.arc(x + w / 2, y + r, r, Math.PI, 0);
    E.lineTo(x + w, y + h); E.closePath(); E.fill();
    const g2 = E.createRadialGradient(x + w / 2, y + h * .6, 2, x + w / 2, y + h * .6, h * .9);
    g2.addColorStop(0, 'rgba(210,140,70,.55)');
    g2.addColorStop(1, 'rgba(210,140,70,0)');
    E.fillStyle = g2;
    E.fillRect(x - w, y - h * .4, w * 3, h * 2);
  }
  // roughness pass: glass smoother
  if (opts.R) {
    opts.R.fillStyle = lit ? '#505050' : '#7a7a7a';
    opts.R.beginPath();
    opts.R.moveTo(x, y + h); opts.R.lineTo(x, y + r);
    opts.R.arc(x + w / 2, y + r, r, Math.PI, 0);
    opts.R.lineTo(x + w, y + h); opts.R.closePath(); opts.R.fill();
  }
}

function drawFacadeCell(ctx, E, R, ox, oy, w, h, rng, blind) {
  const plaster = blind ? '#a98c6e' : PLASTERS[(rng() * PLASTERS.length) | 0];
  ctx.fillStyle = plaster;
  ctx.fillRect(ox, oy, w, h);
  R.fillStyle = '#d8d8d8'; R.fillRect(ox, oy, w, h); // rough plaster

  // plaster blotches
  for (let i = 0; i < 46; i++) {
    const light = rng() > 0.5;
    splat(ctx, ox + rng() * w, oy + rng() * h, 20 + rng() * 90,
      light ? 'rgba(255,240,220,1)' : 'rgba(70,48,34,1)', 0.05 + rng() * 0.10, rng);
  }
  // vertical grime streaks
  for (let i = 0; i < 26; i++) {
    const x = ox + rng() * w, len = 40 + rng() * 180, y = oy + rng() * (h - len);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(50,38,28,0)');
    g.addColorStop(.3, `rgba(50,38,28,${0.05 + rng() * 0.08})`);
    g.addColorStop(1, 'rgba(50,38,28,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rng() * 6, len);
  }
  // exposed brick patches
  if (!blind) {
    const n = 1 + (rng() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const bw = 60 + rng() * 130, bh = 50 + rng() * 120;
      const bx = ox + rng() * (w - bw), by = oy + 40 + rng() * (h - bh - 160);
      drawBrickPatch(ctx, bx, by, bw, bh, rng);
      // re-cover edges with plaster blobs so it looks worn-through
      for (let k = 0; k < 10; k++)
        splat(ctx, bx + rng() * bw, by + rng() * bh, 10 + rng() * 30, plaster.startsWith('#') ? hexToRgba(plaster, 1) : plaster, 0.55, rng);
    }
  }

  // waterline damp band (bottom ~16%)
  const dampH = h * (0.14 + rng() * 0.06);
  const dg = ctx.createLinearGradient(0, oy + h - dampH, 0, oy + h);
  dg.addColorStop(0, 'rgba(24,32,26,0)');
  dg.addColorStop(.5, 'rgba(26,36,29,.6)');
  dg.addColorStop(1, 'rgba(18,26,21,.95)');
  ctx.fillStyle = dg; ctx.fillRect(ox, oy + h - dampH - 8, w, dampH + 8);
  // algae streaks in damp band
  for (let i = 0; i < 18; i++) {
    const x = ox + rng() * w;
    ctx.strokeStyle = `rgba(60,80,55,${0.10 + rng() * 0.15})`;
    ctx.lineWidth = 1 + rng() * 2.5;
    ctx.beginPath(); ctx.moveTo(x, oy + h - dampH + rng() * 20); ctx.lineTo(x + (rng() - .5) * 4, oy + h); ctx.stroke();
  }
  R.fillStyle = '#a0a0a0'; R.fillRect(ox, oy + h - dampH, w, dampH); // damp = a bit smoother

  if (!blind) {
    // windows
    const floors = 3 + (rng() * 2 | 0);         // 3..4
    const cols = 2 + (rng() * 2 | 0);           // 2..3
    const topPad = h * 0.10, botPad = h * 0.24;
    const floorH = (h - topPad - botPad) / floors;
    const winW = Math.min(74, (w - 60) / cols * 0.52);
    const winH = Math.min(floorH * 0.62, 120);
    for (let f = 0; f < floors; f++) {
      const wy = oy + topPad + f * floorH + (floorH - winH) * 0.5;
      for (let c = 0; c < cols; c++) {
        const wx = ox + (w / cols) * c + (w / cols - winW) / 2 + (rng() - .5) * 6;
        const lit = rng() < 0.10;
        drawArchedWindow(ctx, E, wx, wy, winW, winH, rng, lit, { R });
      }
    }
    // arched doorway at ground floor
    const dw = 86, dh = 132;
    const dx = ox + (rng() > 0.5 ? w * 0.14 : w - dw - w * 0.14);
    const dy = oy + h - dampH * 0.55 - dh;
    ctx.fillStyle = '#b3a78f';
    ctx.beginPath();
    ctx.moveTo(dx - 8, dy + dh); ctx.lineTo(dx - 8, dy + dw / 2);
    ctx.arc(dx + dw / 2, dy + dw / 2, dw / 2 + 8, Math.PI, 0);
    ctx.lineTo(dx + dw + 8, dy + dh); ctx.closePath(); ctx.fill();
    const dg2 = ctx.createLinearGradient(0, dy, 0, dy + dh);
    dg2.addColorStop(0, '#241c15'); dg2.addColorStop(1, '#0e0b08');
    ctx.fillStyle = dg2;
    ctx.beginPath();
    ctx.moveTo(dx, dy + dh); ctx.lineTo(dx, dy + dw / 2);
    ctx.arc(dx + dw / 2, dy + dw / 2, dw / 2, Math.PI, 0);
    ctx.lineTo(dx + dw, dy + dh); ctx.closePath(); ctx.fill();
    R.fillStyle = '#404040';
    R.fillRect(dx, dy + dh * .4, dw, dh * .6);
    // occasional small shrine / street number plaque
    if (rng() > 0.5) {
      ctx.fillStyle = '#d8cfb8';
      ctx.fillRect(ox + w - 60, oy + h - dampH - 40, 26, 16);
      ctx.fillStyle = '#5a4a38'; ctx.font = '10px serif';
      ctx.fillText(`${10 + (rng() * 9000 | 0)}`, ox + w - 57, oy + h - dampH - 28);
    }
    // cornice
    const corH = 14 + rng() * 10;
    ctx.fillStyle = 'rgba(235,225,205,.85)';
    ctx.fillRect(ox, oy, w, corH * .4);
    ctx.fillStyle = 'rgba(70,55,40,.5)';
    ctx.fillRect(ox, oy + corH * .4, w, corH * .35);
    ctx.fillStyle = 'rgba(30,22,16,.35)';
    ctx.fillRect(ox, oy + corH * .75, w, 4);
  } else {
    // blind cells: maybe a couple of tiny windows
    if (rng() > 0.4) {
      const n = 1 + (rng() * 2 | 0);
      for (let i = 0; i < n; i++) {
        drawArchedWindow(ctx, null, ox + 40 + rng() * (w - 120), oy + 80 + rng() * (h - 300), 44, 66, rng, false, { noShutters: rng() > .5, R });
      }
    }
  }
  // cracks
  ctx.strokeStyle = 'rgba(35,26,20,.30)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    let x = ox + rng() * w, y = oy + rng() * h * .7;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 4 + (rng() * 5 | 0);
    for (let s = 0; s < segs; s++) { x += (rng() - .5) * 14; y += 8 + rng() * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function makeFacadeAtlas(seed = 7) {
  const rng = mulberry32(seed);
  const col = makeCanvas(ATLAS_W, ATLAS_H);
  const emi = makeCanvas(ATLAS_W, ATLAS_H);
  const rgh = makeCanvas(ATLAS_W, ATLAS_H);
  const c = col.getContext('2d'), e = emi.getContext('2d'), r = rgh.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, ATLAS_W, ATLAS_H);
  for (let i = 0; i < FACADE_CELLS; i++) {
    drawFacadeCell(c, e, r, (i % 4) * 512, Math.floor(i / 4) * 1024, 512, 1024, rng, false);
  }
  for (let i = 0; i < BLIND_CELLS; i++) {
    drawFacadeCell(c, e, r, i * 512, 2048, 512, 512, rng, true);
  }
  return {
    map: canvasTexture(col, { srgb: true }),
    emissiveMap: canvasTexture(emi, { srgb: true }),
    roughnessMap: canvasTexture(rgh),
  };
}

// --------------------------------------------------------------- roofs ------
export function makeRoofTexture(seed = 11) {
  const rng = mulberry32(seed);
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a4553a'; ctx.fillRect(0, 0, 512, 512);
  const tw = 34, th = 20;
  for (let y = 0; y < 512 + th; y += th) {
    const off = ((y / th) | 0) % 2 ? tw / 2 : 0;
    for (let x = -tw; x < 512 + tw; x += tw) {
      const l = 0.8 + rng() * 0.55;
      ctx.fillStyle = `rgb(${Math.min(255, 164 * l) | 0},${Math.min(255, 85 * l) | 0},${Math.min(255, 58 * l) | 0})`;
      ctx.beginPath();
      ctx.moveTo(x + off, y);
      ctx.lineTo(x + off + tw, y);
      ctx.lineTo(x + off + tw, y + th * .82);
      ctx.quadraticCurveTo(x + off + tw / 2, y + th * 1.05, x + off, y + th * .82);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(30,14,8,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  // grime + moss
  for (let i = 0; i < 60; i++)
    splat(ctx, rng() * 512, rng() * 512, 10 + rng() * 50, rng() > .7 ? 'rgba(60,75,45,1)' : 'rgba(30,15,8,1)', 0.06 + rng() * 0.1, rng);
  return canvasTexture(c, { srgb: true, repeat: [1, 1] });
}

// --------------------------------------------------------------- stone ------
export function makeStoneTexture(seed = 23) {
  const rng = mulberry32(seed);
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c8270'; ctx.fillRect(0, 0, 512, 512);
  const bh = 42, bw = 96;
  for (let y = 0; y < 512; y += bh) {
    const off = ((y / bh) | 0) % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 512 + bw; x += bw) {
      const l = 0.75 + rng() * 0.35;
      ctx.fillStyle = `rgb(${140 * l | 0},${130 * l | 0},${112 * l | 0})`;
      ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
      // stone speckle
      for (let s = 0; s < 8; s++) {
        ctx.fillStyle = `rgba(${rng() > .5 ? '255,250,240' : '20,16,12'},${.05 + rng() * .08})`;
        ctx.fillRect(x + off + rng() * bw, y + rng() * bh, 3 + rng() * 6, 2 + rng() * 4);
      }
    }
  }
  ctx.strokeStyle = 'rgba(40,34,28,.6)'; ctx.lineWidth = 2;
  for (let y = 0; y < 512; y += bh) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    const off = ((y / bh) | 0) % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 512 + bw; x += bw) {
      ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + off, y + bh); ctx.stroke();
    }
  }
  // moss at bottom
  const g = ctx.createLinearGradient(0, 400, 0, 512);
  g.addColorStop(0, 'rgba(50,65,42,0)');
  g.addColorStop(1, 'rgba(50,65,42,.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 380, 512, 132);
  return canvasTexture(c, { srgb: true, repeat: [1, 1] });
}

// ---------------------------------------------------------------- mist ------
export function makeMistTexture(seed = 31) {
  const rng = mulberry32(seed);
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 220; i++) {
    const x = 128 + (rng() - .5) * 220, y = 128 + (rng() - .5) * 220;
    const d = Math.hypot(x - 128, y - 128) / 128;
    if (d > 1) continue;
    splat(ctx, x, y, 12 + rng() * 34, 'rgba(255,255,255,1)', (1 - d) * (0.05 + rng() * 0.09), rng);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// -------------------------------------------------------------- bricole -----
export function makeStripeTexture() {
  const c = makeCanvas(64, 256);
  const ctx = c.getContext('2d');
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = ((y / 32) | 0) % 2 ? '#8f262a' : '#ddd6c4';
    ctx.fillRect(0, y, 64, 32);
  }
  // wood grain hints
  ctx.fillStyle = 'rgba(40,25,15,.15)';
  for (let i = 0; i < 20; i++) ctx.fillRect(Math.random() * 64, 0, 1.5, 256);
  return canvasTexture(c, { srgb: true, repeat: [1, 1] });
}

// --------------------------------------------------------------- wood -------
export function makeWoodTexture(seed = 41) {
  const rng = mulberry32(seed);
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4a2f'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    const n = Math.sin(y * 0.13) * 8 + (rng() - .5) * 10;
    ctx.fillStyle = `rgba(${90 + n | 0},${62 + n * .7 | 0},${38 + n * .5 | 0},.5)`;
    ctx.fillRect(0, y, 256, 2);
  }
  for (let i = 0; i < 30; i++)
    splat(ctx, rng() * 256, rng() * 256, 4 + rng() * 16, 'rgba(30,18,10,1)', .12, rng);
  return canvasTexture(c, { srgb: true, repeat: [1, 1] });
}

// ------------------------------------------------- dawn env (PMREM src) -----
export function makeSkyEquirect() {
  const c = makeCanvas(1024, 512);
  const ctx = c.getContext('2d');
  // vertical gradient: zenith blue -> dawn peach at horizon
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#1b2a4a');
  g.addColorStop(0.35, '#3d5178');
  g.addColorStop(0.48, '#8a86a0');
  g.addColorStop(0.52, '#d9a98c');
  g.addColorStop(0.56, '#f2c79a');
  g.addColorStop(0.62, '#e8b48a');
  g.addColorStop(0.75, '#6b5f6e');
  g.addColorStop(1.0, '#2a2430');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  // sun glow band around horizon (y ~ 256)
  const sg = ctx.createRadialGradient(512, 262, 10, 512, 262, 240);
  sg.addColorStop(0, 'rgba(255,236,205,.95)');
  sg.addColorStop(.25, 'rgba(255,205,150,.55)');
  sg.addColorStop(1, 'rgba(255,190,140,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, 60, 1024, 400);
  // a few soft clouds
  const rng = mulberry32(99);
  for (let i = 0; i < 90; i++) {
    const x = rng() * 1024, y = 120 + rng() * 220;
    splat(ctx, x, y, 30 + rng() * 90, 'rgba(255,225,200,1)', 0.03 + rng() * 0.05, rng);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
