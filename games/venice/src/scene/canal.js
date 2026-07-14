// Canal layout: centerline spline, wall polylines, bridges, docks.
// Shared by the cinematic scene and the game (collision + objectives).
import * as THREE from 'three';

// control points of the canal centerline (x, z) — gentle S-curves, +Z forward
const CONTROL = [
  [0, -30], [0, 0], [2.5, 55], [-3.5, 115], [-6, 170], [1.5, 235],
  [8, 300], [3, 365], [-5.5, 425], [-2, 485], [5, 545], [0, 600], [0, 640],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export const ROUTE_END = 600;

// width profile: narrows from 12.5m to 8.7m with small wobble
// (widened for the multiplayer regatta — small boats, room to fight for a line)
export function canalWidth(s) {
  const t = THREE.MathUtils.clamp(s / ROUTE_END, 0, 1);
  return 12.5 - 3.8 * t + Math.sin(s * 0.045) * 0.4;
}

// piazzetta: left wall recedes between s=120..165
export const CAMPO = { s0: 118, s1: 168, depth: 13, side: -1 };
export function campoOffset(s) {
  if (s < CAMPO.s0 || s > CAMPO.s1) return 0;
  const t = (s - CAMPO.s0) / (CAMPO.s1 - CAMPO.s0);
  return Math.sin(t * Math.PI) * CAMPO.depth;
}

// bridge layout: arch apex descends along the route
export const BRIDGES = [85, 205, 320, 445, 555].map((s, i) => ({
  s,
  apex: 3.9 - i * 0.28,      // arch top above water
  deck: 4.7 - i * 0.25,      // walking deck
  thick: 5.5 - i * 0.3,      // depth along canal
  pier: 0.55 + i * 0.08,     // abutment intrusion per side
}));

// docks: alternate sides, shrink along the route
export const DOCKS = [25, 140, 255, 375, 480, 585].map((s, i) => ({
  s,
  side: i % 2 === 0 ? -1 : 1,
  size: 2.6 - i * 0.22,      // platform half-width along canal
  depth: 2.4 - i * 0.18,     // how far it juts out
}));

export class Canal {
  constructor(step = 1.5) {
    this.step = step;
    this.samples = [];   // {x, z, ang, s, width}
    this.left = [];      // wall polylines (THREE.Vector2)
    this.right = [];
    this._build();
  }

  _build() {
    const pts = CONTROL;
    const samples = [];
    let s = 0;
    let prev = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const n = Math.max(2, Math.ceil(segLen / this.step));
      for (let j = 0; j < n; j++) {
        if (i > 0 && j === 0) continue;
        const t = j / n;
        const x = catmull(p0[0], p1[0], p2[0], p3[0], t);
        const z = catmull(p0[1], p1[1], p2[1], p3[1], t);
        const dx = catmull(p0[0], p1[0], p2[0], p3[0], Math.min(1, t + 0.01)) - catmull(p0[0], p1[0], p2[0], p3[0], Math.max(0, t - 0.01));
        const dz = catmull(p0[1], p1[1], p2[1], p3[1], Math.min(1, t + 0.01)) - catmull(p0[1], p1[1], p2[1], p3[1], Math.max(0, t - 0.01));
        if (prev) s += Math.hypot(x - prev.x, z - prev.z);
        samples.push({ x, z, ang: Math.atan2(dx, dz), s, width: canalWidth(s) });
        prev = { x, z };
      }
    }
    this.samples = samples;
    this.length = s;

    for (const p of samples) {
      const nx = Math.cos(p.ang), nz = -Math.sin(p.ang); // normal (right-handed: +x side)
      const half = p.width / 2;
      // campo: left wall (side -1) recedes
      const offL = CAMPO.side < 0 ? campoOffset(p.s) : 0;
      const offR = CAMPO.side > 0 ? campoOffset(p.s) : 0;
      this.left.push(new THREE.Vector2(p.x - nx * (half + offL), p.z - nz * (half + offL)));
      this.right.push(new THREE.Vector2(p.x + nx * (half + offR), p.z + nz * (half + offR)));
    }
  }

  // nearest centerline sample index for a world point (full scan; cheap at ~450 samples)
  nearestS(x, z) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, s: this.samples[bi].s, dist: Math.sqrt(best), sample: this.samples[bi] };
  }

  atS(s) {
    const arr = this.samples;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].s < s) lo = mid + 1; else hi = mid; }
    const a = arr[Math.max(0, lo - 1)], b = arr[lo];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return {
      x: THREE.MathUtils.lerp(a.x, b.x, t),
      z: THREE.MathUtils.lerp(a.z, b.z, t),
      ang: THREE.MathUtils.lerp(a.ang, b.ang, t),
      s,
      width: canalWidth(s),
    };
  }

  // distance from point to a wall polyline + outward normal (pointing into canal)
  _distToWall(x, z, wall, sign) {
    let best = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < wall.length - 1; i++) {
      const ax = wall[i].x, az = wall[i].y, bxp = wall[i + 1].x, bzp = wall[i + 1].y;
      const ex = bxp - ax, ez = bzp - az;
      const L2 = ex * ex + ez * ez || 1e-6;
      const t = THREE.MathUtils.clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1);
      const px = ax + ex * t, pz = az + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bx = px; bz = pz; }
    }
    // normal pointing into the canal (away from wall): from wall point to query
    let nx = x - bx, nz = z - bz;
    const n = Math.hypot(nx, nz) || 1e-6;
    return { dist: best, nx: nx / n, nz: nz / n, wx: bx, wz: bz };
  }

  wallsAt(x, z) {
    return {
      left: this._distToWall(x, z, this.left, -1),
      right: this._distToWall(x, z, this.right, 1),
    };
  }
}
