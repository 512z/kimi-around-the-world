// Procedural canvas textures. Everything generated at runtime; no image assets.
import * as THREE from 'three';
import { fbm2, vnoise2, fbm3, ihash } from './noise.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = null, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = aniso;
  return tex;
}

// ---------------------------------------------------------------- regolith
export function makeRegolithSet(size = 1024) {
  const cells = 32;
  // albedo
  const ac = makeCanvas(size, size);
  const actx = ac.getContext('2d');
  const aimg = actx.createImageData(size, size);
  // roughness
  const rc = makeCanvas(size, size);
  const rctx = rc.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  const hfield = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells, v = (y / size) * cells;
      const n = fbm2(u, v, 5, cells);
      const grit = fbm2(u * 4, v * 4, 3, cells * 4);
      const patch = fbm2(u * 0.25 + 31.7, v * 0.25 + 12.1, 2, cells);
      hfield[y * size + x] = n * 0.8 + grit * 0.2;

      let g = 138 + (n - 0.5) * 52 + (grit - 0.5) * 26 + (patch - 0.5) * 20;
      // sparkle: rare bright grains
      const sp = ihash(x, y);
      if (sp > 0.9985) g = 225 + sp * 30;
      else if (sp < 0.0008) g *= 0.55;
      const warm = (patch - 0.5) * 6;
      const i = (y * size + x) * 4;
      aimg.data[i]     = Math.max(0, Math.min(255, g + 1.5 + warm * 0.5));
      aimg.data[i + 1] = Math.max(0, Math.min(255, g + 0.5));
      aimg.data[i + 2] = Math.max(0, Math.min(255, g - 1.5 - warm * 0.5));
      aimg.data[i + 3] = 255;

      const r = 235 - (grit - 0.5) * 60 + (n - 0.5) * 25;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(120, Math.min(255, r));
      rimg.data[i + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  // normal from height (Sobel)
  const nc = makeCanvas(size, size);
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const strength = 2.6;
  const H = (x, y) => hfield[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      nimg.data[i]     = (nx / len * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  return {
    map: toTexture(ac, { srgb: true, repeat: [1, 1] }),
    normalMap: toTexture(nc, { repeat: [1, 1] }),
    roughnessMap: toTexture(rc, { repeat: [1, 1] }),
  };
}

// ---------------------------------------------------------------- hull panels
export function makePanelTextures(w = 1024, h = 512) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  // base coat
  ctx.fillStyle = '#b7bcc4';
  ctx.fillRect(0, 0, w, h);
  // grime
  const img = ctx.getImageData(0, 0, w, h);
  const cells = 16;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm2((x / w) * cells, (y / h) * cells * 0.5, 4, cells);
      const streak = vnoise2((x / w) * 64, (y / h) * 4, 64);
      let m = 1 - (n - 0.5) * 0.16 - Math.max(0, streak - 0.75) * 0.5;
      const i = (y * w + x) * 4;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m * 0.995;
    }
  }
  ctx.putImageData(img, 0, 0);
  // panel seams
  ctx.strokeStyle = 'rgba(40,44,52,0.85)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 96) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x + 2.5, 0); ctx.lineTo(x + 2.5, h); ctx.stroke(); }
  // rivets
  ctx.fillStyle = 'rgba(60,64,72,0.9)';
  for (let x = 16; x < w; x += 64) {
    for (let y = 12; y < h; y += 24) {
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  // stencil markings
  ctx.fillStyle = 'rgba(70,76,86,0.55)';
  ctx.font = 'bold 26px monospace';
  ctx.fillText('HAB-01', 40, 60);
  ctx.fillText('O2', w - 120, h - 40);
  ctx.fillStyle = 'rgba(200,150,40,0.5)';
  ctx.fillRect(40, 74, 90, 6);

  // emissive: warm window strips along the two sides (u = 0.25 / 0.75)
  const ec = makeCanvas(w, h);
  const ectx = ec.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, w, h);
  for (const ux of [w * 0.25, w * 0.75]) {
    for (let y = 28; y < h; y += 56) {
      const grd = ectx.createRadialGradient(ux, y, 1, ux, y, 20);
      grd.addColorStop(0, 'rgba(255,190,120,1)');
      grd.addColorStop(0.55, 'rgba(255,160,80,0.9)');
      grd.addColorStop(1, 'rgba(255,140,60,0)');
      ectx.fillStyle = grd;
      ectx.fillRect(ux - 22, y - 22, 44, 44);
      ectx.fillStyle = '#ffd9a0';
      ectx.fillRect(ux - 6, y - 8, 12, 16);
    }
  }
  return {
    map: toTexture(c, { srgb: true }),
    emissiveMap: toTexture(ec, { srgb: true }),
  };
}

// ---------------------------------------------------------------- solar panel
export function makeSolarTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#080f24';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 8;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const x = gx * cell, y = gy * cell;
      const grd = ctx.createLinearGradient(x, y, x + cell, y + cell);
      const b = 0.75 + ihash(gx, gy) * 0.5;
      grd.addColorStop(0, `rgb(${26 * b | 0},${52 * b | 0},${110 * b | 0})`);
      grd.addColorStop(1, `rgb(${15 * b | 0},${32 * b | 0},${74 * b | 0})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      // cell bus bar
      ctx.fillStyle = 'rgba(90,130,200,0.35)';
      ctx.fillRect(x + cell * 0.5 - 1, y + 3, 2, cell - 6);
    }
  }
  ctx.strokeStyle = 'rgba(120,150,210,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
  }
  return toTexture(c, { srgb: true });
}

// ---------------------------------------------------------------- container
export function makeContainerTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9aa1a8';
  ctx.fillRect(0, 0, size, size);
  // ribs
  for (let y = 0; y < size; y += 26) {
    ctx.fillStyle = 'rgba(40,44,50,0.55)';
    ctx.fillRect(0, y, size, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, y + 3, size, 2);
  }
  // posts
  ctx.fillStyle = 'rgba(50,54,60,0.8)';
  ctx.fillRect(0, 0, 14, size); ctx.fillRect(size - 14, 0, 14, size);
  // hazard label
  ctx.fillStyle = '#d8a020';
  ctx.fillRect(60, 60, 120, 60);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('CARGO', 68, 98);
  // grime
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x / 48, y / 48, 3);
      const m = 1 - Math.max(0, n - 0.6) * 0.35;
      const i = (y * size + x) * 4;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true });
}

// ---------------------------------------------------------------- landing pad
export function makePadTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size / 2;
  // base with radial shading
  const grd = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  grd.addColorStop(0, '#4a4e54');
  grd.addColorStop(0.85, '#34373c');
  grd.addColorStop(1, '#232528');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  // noise mottle
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x / 40, y / 40, 3);
      const m = 0.9 + n * 0.2;
      const i = (y * size + x) * 4;
      if (img.data[i + 3] > 0) { img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m; }
    }
  }
  ctx.putImageData(img, 0, 0);
  // hazard chevron ring
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    ctx.fillStyle = i % 2 ? '#c8a020' : '#1c1e22';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98, a0, a1);
    ctx.arc(cx, cy, R * 0.86, a1, a0, true);
    ctx.closePath(); ctx.fill();
  }
  // white ring
  ctx.strokeStyle = 'rgba(230,235,240,0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, Math.PI * 2); ctx.stroke();
  // dashed yellow ring
  ctx.strokeStyle = '#d8b030';
  ctx.lineWidth = 7;
  ctx.setLineDash([26, 20]);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // H marking
  ctx.fillStyle = 'rgba(235,240,245,0.92)';
  ctx.font = `bold ${(R * 0.5) | 0}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('H', cx, cy + R * 0.02);
  // blast scorch
  const sc = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 0.4);
  sc.addColorStop(0, 'rgba(10,10,12,0.55)');
  sc.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = sc;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2); ctx.fill();
  return toTexture(c, { srgb: true });
}

// ---------------------------------------------------------------- tracks & footprints (canvas baked full-length,
// so ribbon UVs stay in [0,1]: large wrapped UVs break transparent sampling
// on software WebGL backends; DataTexture upload also proved unreliable there)
function decalTexture(w, h, paint) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

export function makeTrackTexture(totalLen = 560) {
  const w = 4096, h = 256;
  const tiles = Math.max(1, Math.round(totalLen / 6));
  const tileW = w / tiles;
  return decalTexture(w, h, (ctx, W, H) => {
    for (let t = 0; t < tiles; t++) {
      const x0 = t * tileW;
      // tread blocks in both wheel lanes
      ctx.fillStyle = 'rgba(26,24,22,0.62)';
      for (let k = 0; k < 5; k++) {
        const bx = x0 + (k + 0.08) * tileW / 5;
        const bw = tileW * 0.54 / 5 * 5 * 0.54;
        for (const ly of [H * 0.22, H * 0.78]) ctx.fillRect(bx, ly - 10, tileW / 5 * 0.54, 20);
        void bw;
      }
      // faint center drag
      ctx.fillStyle = 'rgba(28,26,24,0.18)';
      ctx.fillRect(x0, H * 0.46, tileW, H * 0.08);
    }
  });
}

export function makeFootprintTexture(totalLen = 112) {
  const w = 2048, h = 256;
  const strides = Math.max(1, Math.round(totalLen / 1.2));
  const strideW = w / strides;
  return decalTexture(w, h, (ctx, W, H) => {
    // rect-scanline ovals (fillRect only — path-drawn alpha mis-uploads on some backends)
    const oval = (cx, cy, rx, ry) => {
      for (let y = -ry; y < ry; y += 2) {
        const xh = rx * Math.sqrt(Math.max(0, 1 - (y / ry) * (y / ry)));
        ctx.fillRect(cx - xh, cy + y, xh * 2, 2);
      }
    };
    for (let s = 0; s < strides; s++) {
      const cx = (s + 0.5) * strideW;
      const cy = s % 2 === 0 ? H * 0.3 : H * 0.7;
      ctx.fillStyle = 'rgba(12,10,9,0.9)';
      oval(cx, cy, strideW * 0.32, 26);
      ctx.fillStyle = 'rgba(60,54,48,0.55)';
      for (let t = -14; t <= 14; t += 7) ctx.fillRect(cx - 10, cy + t, 20, 2.5);
    }
  });
}

// ---------------------------------------------------------------- soft particle sprite
export function makeSoftSprite(size = 64, inner = 'rgba(255,255,255,1)') {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}

// ---------------------------------------------------------------- Earth (seamless, sampled on sphere)
export function makeEarthTextures(w = 1024, h = 512) {
  const dayC = makeCanvas(w, h), cityC = makeCanvas(w, h), cloudC = makeCanvas(w, h);
  const dctx = dayC.getContext('2d'), cctx = cityC.getContext('2d'), clctx = cloudC.getContext('2d');
  const dimg = dctx.createImageData(w, h), cimg = cctx.createImageData(w, h), climg = clctx.createImageData(w, h);
  // ocean mask lives in its own texture: canvas alpha premultiplies and would
  // destroy land colors if packed into the day map's alpha channel.
  const ocean = new Uint8Array(w * h);

  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

  for (let py = 0; py < h; py++) {
    const lat = (0.5 - py / h) * Math.PI;
    const slat = Math.sin(lat), clat = Math.cos(lat);
    for (let px = 0; px < w; px++) {
      const lon = (px / w - 0.5) * Math.PI * 2;
      const nx = clat * Math.cos(lon), ny = slat, nz = clat * Math.sin(lon);

      // continental field (domain-warped fbm)
      const wx = fbm3(nx * 1.35 + 4.2, ny * 1.35, nz * 1.35 - 2.1, 4);
      const wz = fbm3(nx * 1.35 - 8.6, ny * 1.35 + 3.3, nz * 1.35 + 5.9, 4);
      const e = fbm3(nx * 1.7 + wx * 1.3, ny * 1.7, nz * 1.7 + wz * 1.3, 5);
      const detail = fbm3(nx * 7.5, ny * 7.5, nz * 7.5, 4);

      const seaLevel = 0.55;
      const i = (py * w + px) * 4;
      let r, g, b, oceanMask;

      if (e < seaLevel) {
        // ocean: depth shading
        const depth = (seaLevel - e) / 0.35;
        const col = mix3([42, 118, 192], [14, 52, 116], Math.min(1, depth));
        const shimmer = (detail - 0.5) * 16;
        r = col[0] + shimmer * 0.4; g = col[1] + shimmer * 0.6; b = col[2] + shimmer;
        oceanMask = 255;
        ocean[py * w + px] = 255;
      } else {
        // land: elevation-based biomes
        const elev = (e - seaLevel) / 0.4;
        const moist = fbm3(nx * 3.1 + 40, ny * 3.1, nz * 3.1, 3);
        let col = mix3([174, 144, 90], [78, 146, 86], Math.min(1, moist * 1.4));    // tan <-> green
        col = mix3(col, [192, 182, 146], Math.max(0, elev - 0.12) * 2.2);           // highlands rock
        col = mix3(col, [146, 134, 116], Math.max(0, elev - 0.25) * 2.0);           // mountains
        const v = (detail - 0.5) * 24;
        r = col[0] + v; g = col[1] + v; b = col[2] + v * 0.8;
        oceanMask = 0;
        // snow peaks
        if (elev > 0.3) { const s = Math.min(1, (elev - 0.3) * 4); r = lerp(r, 235, s); g = lerp(g, 238, s); b = lerp(b, 242, s); }

        // city lights: clusters on populated lowlands
        const cluster = fbm3(nx * 9 + 80, ny * 9, nz * 9, 3);
        const pop = Math.max(0, (cluster - 0.58)) * 7 * Math.max(0, 1 - elev * 5) * (0.4 + moist);
        const ci = (py * w + px) * 4;
        if (pop > 0) {
          const warm = Math.min(1, pop);
          cimg.data[ci] = 255 * warm; cimg.data[ci + 1] = 200 * warm; cimg.data[ci + 2] = 110 * warm;
        }
        cimg.data[ci + 3] = 255;
      }

      // polar ice
      const ice = Math.max(0, (Math.abs(ny) - 0.72) * 5 + (detail - 0.5) * 1.4);
      if (ice > 0) {
        const t = Math.min(1, ice);
        const ic = oceanMask > 0 ? [200, 215, 228] : [228, 234, 240];
        r = lerp(r, ic[0], t); g = lerp(g, ic[1], t); b = lerp(b, ic[2], t);
      }

      dimg.data[i] = Math.max(0, Math.min(255, r));
      dimg.data[i + 1] = Math.max(0, Math.min(255, g));
      dimg.data[i + 2] = Math.max(0, Math.min(255, b));
      dimg.data[i + 3] = 255;

      // clouds: banded fbm, whiter cores
      const cl = fbm3(nx * 2.6 + 15, ny * 2.6, nz * 2.6 + 15, 5);
      const bands = 0.72 + 0.28 * Math.sin(lat * 3.0 + fbm3(nx * 1.2, ny * 1.2, nz * 1.2, 2) * 6);
      const density = Math.max(0, cl * bands - 0.52) * 3.2;
      const a = Math.min(1, density);
      const shade = 235 + (fbm3(nx * 9 + 3, ny * 9, nz * 9, 2) - 0.5) * 40;
      climg.data[i] = shade; climg.data[i + 1] = shade; climg.data[i + 2] = shade + 6;
      climg.data[i + 3] = a * 205;
    }
  }
  dctx.putImageData(dimg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  clctx.putImageData(climg, 0, 0);

  // pick the longitude with the most land to face the Moon
  const land = new Float32Array(w);
  for (let px = 0; px < w; px++) {
    let s = 0;
    for (let py = 0; py < h; py += 4) if (ocean[py * w + px] < 128) s++;
    land[px] = s;
  }
  let best = 0, bestV = -1;
  for (let px = 0; px < w; px++) {
    let v = 0;
    for (let k = -14; k <= 14; k++) v += land[(px + k + w) % w];
    if (v > bestV) { bestV = v; best = px; }
  }

  const oceanTex = new THREE.DataTexture(ocean, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  oceanTex.minFilter = oceanTex.magFilter = THREE.LinearFilter;
  oceanTex.needsUpdate = true;

  return {
    day: toTexture(dayC, { srgb: true }),
    city: toTexture(cityC, { srgb: true }),
    clouds: toTexture(cloudC, { srgb: true }),
    ocean: oceanTex,
    bestU: best / w,
  };
}
