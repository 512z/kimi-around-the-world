// SELENE GP — circuit definition, sampling and track-side geometry.
// The road surface itself is carved into the terrain heightfield (terrain.js);
// this module owns the centerline, bank/width profile, nearest-point queries
// and everything emissive along the edges.

import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, mulberry32 } from './util.js';

// Control points: x, z, bank in degrees (+ = left edge raised), half-width.
// Closed loop, driven counterclockwise starting at the start/finish gantry.
// Layout scaled to ~8.8km lap.
//
// s=0 sits on the north-plain run heading WEST (away from the low sun at
// (0.86, 0.14, -0.49)): tangent·sun ≈ -0.9, so the grid and the opening
// straight are lit from behind — no windshield glare at lights-out. The old
// sun-facing straight (with the rim-crest launch) is now mid-lap.
const CTRL = [
  { x:    67, z:  1116, bank: -10, hw: 14 }, // start/finish — north plain, heading west
  { x:  -585, z:  1057, bank: -8, hw: 14 }, // north plain
  { x: -1057, z:   787, bank: -18, hw: 15 }, // drop toward bowl
  { x: -1327, z:   427, bank: -44, hw: 16 }, // bowl entry, steep bank
  { x: -1417, z:    45, bank: -58, hw: 16 }, // bowl bottom (crater A)
  { x: -1215, z:  -337, bank: -42, hw: 16 }, // bowl exit climb
  { x:  -855, z:  -652, bank: -22, hw: 15 }, // exit sweeper
  { x:  -607, z:  -967, bank: -8,  hw: 14 }, // link to the old main straight
  { x:  -427, z: -1206, bank: 0,  hw: 13 }, // west straight
  { x:   135, z: -1237, bank: 0,  hw: 13 }, // rim-crest launch zone (mid-lap)
  { x:   697, z: -1206, bank: 4,  hw: 13 }, // end of straight
  { x:  1282, z:  -922, bank: 16, hw: 14 }, // T3-4 right sweeper
  { x:  1552, z:  -225, bank: 22, hw: 14 }, // east flank climb
  { x:  1536, z:   859, bank: -12, hw: 15 }, // hairpin approach (heading NW)
  { x:  1183, z:  1213, bank: -8, hw: 16 }, // hairpin entry (crater B rim, NE)
  { x:   900, z:  1330, bank: -9, hw: 16 }, // hairpin wrap (due N of crater B)
  { x:   700, z:  1270, bank: -8, hw: 16 }, // hairpin wrap (NW, stays outside rim)
  { x:   524, z:  1067, bank: -5, hw: 15 }, // hairpin exit onto the grid straight
];

const DEG = Math.PI / 180;

// ---- closed centripetal Catmull-Rom over {x,z} with scalar channels ----
function crEval(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Track {
  constructor() {
    this.samples = null;      // {px,pz,py,bank,hw,s} Float32Arrays
    this.length = 0;
    this.hash = null;         // spatial hash for nearestS
    this.hashCell = 40;
    this.chevrons = [];       // {s, x, z}
    this.group = new THREE.Group();
  }

  _eval(u) {
    const n = CTRL.length;
    const fu = ((u % 1) + 1) % 1 * n;
    const i1 = Math.floor(fu) % n;
    const t = fu - Math.floor(fu);
    const i0 = (i1 - 1 + n) % n, i2 = (i1 + 1) % n, i3 = (i1 + 2) % n;
    const p0 = CTRL[i0], p1 = CTRL[i1], p2 = CTRL[i2], p3 = CTRL[i3];
    // bank interpolation must be angle-aware (wrap handled by values being close)
    return {
      x: crEval(p0.x, p1.x, p2.x, p3.x, t),
      z: crEval(p0.z, p1.z, p2.z, p3.z, t),
      bank: crEval(p0.bank, p1.bank, p2.bank, p3.bank, t),
      hw: crEval(p0.hw, p1.hw, p2.hw, p3.hw, t),
    };
  }

  // Resample at uniform arc length.
  build(ds = 2) {
    // dense pass to measure length
    const N = 6000;
    const pts = [];
    let len = 0, px0 = null, pz0 = null;
    for (let i = 0; i <= N; i++) {
      const p = this._eval(i / N);
      pts.push(p);
      if (px0 !== null) len += Math.hypot(p.x - px0, p.z - pz0);
      px0 = p.x; pz0 = p.z;
    }
    // uniform resample
    const count = Math.ceil(len / ds);
    const out = {
      px: new Float32Array(count), pz: new Float32Array(count),
      py: new Float32Array(count), bank: new Float32Array(count),
      hw: new Float32Array(count), s: new Float32Array(count),
    };
    let seg = 1, acc = 0, last = pts[0];
    for (let k = 0; k < count; k++) {
      const target = (k / count) * len;
      while (seg < pts.length) {
        const p = pts[seg];
        const d = Math.hypot(p.x - last.x, p.z - last.z);
        if (acc + d >= target) {
          const f = d > 1e-6 ? (target - acc) / d : 0;
          out.px[k] = lerp(last.x, p.x, f);
          out.pz[k] = lerp(last.z, p.z, f);
          out.bank[k] = lerp(last.bank, p.bank, f) * DEG;
          out.hw[k] = lerp(last.hw, p.hw, f);
          out.s[k] = target;
          break;
        }
        acc += d; last = p; seg++;
      }
    }
    this.samples = out;
    this.length = len;
    this.count = count;
    return this;
  }

  // Build spatial hash over samples (store every 2nd sample) for nearest queries.
  buildHash() {
    const cell = this.hashCell;
    this.hash = new Map();
    const { px, pz } = this.samples;
    for (let i = 0; i < this.count; i += 2) {
      const key = `${Math.floor(px[i] / cell)},${Math.floor(pz[i] / cell)}`;
      let arr = this.hash.get(key);
      if (!arr) { arr = []; this.hash.set(key, arr); }
      arr.push(i);
    }
    return this;
  }

  // Frame at arc length s: tangent, right vector, bank, half-width.
  frameAt(s) {
    const L = this.length;
    s = ((s % L) + L) % L;
    const f = (s / L) * this.count;
    let i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    const t = f - Math.floor(f);
    const { px, pz, py, bank, hw } = this.samples;
    const x = lerp(px[i], px[j], t), z = lerp(pz[i], pz[j], t), y = lerp(py[i], py[j], t);
    let tx = px[j] - px[i], tz = pz[j] - pz[i];
    if (j < i) { tx = px[0] - px[i]; tz = pz[0] - pz[i]; }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    return {
      x, y, z,
      tx, tz,
      rx: tz, rz: -tx,             // right vector (screen-right when heading +t)
      bank: lerp(bank[i], bank[j], t),
      hw: lerp(hw[i], hw[j], t),
    };
  }

  // Nearest centerline sample to (x,z). Returns {s, idx, dSigned, dist, frame}
  nearestS(x, z) {
    const cell = this.hashCell;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = Infinity, bestI = 0;
    // expand search radius until we find samples (cars can end up in the infield)
    for (let radius = 1; radius <= 16 && best === Infinity; radius++) {
      for (let ox = -radius; ox <= radius; ox++) {
        for (let oz = -radius; oz <= radius; oz++) {
          if (Math.max(Math.abs(ox), Math.abs(oz)) !== radius && radius > 1) continue;
          const arr = this.hash.get(`${cx + ox},${cz + oz}`);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k];
            const d = (this.samples.px[i] - x) ** 2 + (this.samples.pz[i] - z) ** 2;
            if (d < best) { best = d; bestI = i; }
          }
        }
      }
    }
    // refine: check segments in a window around bestI
    let bestS = this.samples.s[bestI], bestDist = Infinity, bestSide = 1, projT = 0, segI = bestI;
    const W = 6;
    for (let w = -W; w <= W; w++) {
      const i = (bestI + w + this.count) % this.count;
      const j = (i + 1) % this.count;
      const ax = this.samples.px[i], az = this.samples.pz[i];
      let bx = this.samples.px[j], bz = this.samples.pz[j];
      if (j === 0) { bx += 0; } // wrap handled by closed loop coords
      const ex = bx - ax, ez = bz - az;
      const el2 = ex * ex + ez * ez || 1e-6;
      let t = ((x - ax) * ex + (z - az) * ez) / el2;
      t = clamp(t, 0, 1);
      const qx = ax + ex * t, qz = az + ez * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < bestDist) {
        bestDist = d;
        bestS = this.samples.s[i] + t * (this.length / this.count);
        if (bestS >= this.length) bestS -= this.length;
        const side = Math.sign((x - qx) * ez - (z - qz) * ex) || 1;
        bestSide = side;
        projT = t; segI = i;
      }
    }
    return {
      s: bestS,
      idx: segI,
      dist: bestDist,
      dSigned: bestDist * bestSide,
      frame: this.frameAt(bestS),
    };
  }

  // ---- geometry ------------------------------------------------------------

  setHeightsFromTerrain(terrain) {
    const { px, pz, py } = this.samples;
    for (let i = 0; i < this.count; i++) py[i] = terrain.sampleHeight(px[i], pz[i]);
    // smooth longitudinal profile (keep big features like the bowl)
    for (let pass = 0; pass < 4; pass++) {
      const prev = py.slice();
      for (let i = 0; i < this.count; i++) {
        const a = prev[(i - 1 + this.count) % this.count];
        const b = prev[i];
        const c = prev[(i + 1) % this.count];
        py[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
    }
    // Erode convex-up crests (rim crossings) so the road never launches cars
    // uncontrollably — EXCEPT the designed rim-crest jump on the finish straight.
    // Fixed point allows crest radius ≈ dx²/(2·tol) = 2000m; maglev+g holds the
    // car down on anything gentler than ~250m at racing speeds.
    const ridgeS = this.nearestS(-504, -1071).s;
    const protect = (s) => {
      let d = Math.abs(s - ridgeS);
      d = Math.min(d, this.length - d);
      return d < 70;
    };
    const n = this.count;
    const sArr = this.samples.s;
    let bufA = py;
    let bufB = new Float32Array(n);
    for (let pass = 0; pass < 6000; pass++) {
      bufB.set(bufA);
      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        if (protect(sArr[i])) continue;
        const chord = (bufA[(i - 1 + n) % n] + bufA[(i + 1) % n]) / 2 + 0.001;
        if (bufB[i] > chord) {
          const d = bufB[i] - chord;
          bufB[i] = chord;
          if (d > maxDelta) maxDelta = d;
        }
      }
      const tmp = bufA; bufA = bufB; bufB = tmp;
      if (maxDelta < 0.0005) break;
    }
    if (bufA !== py) py.set(bufA);
    // one mild smoothing pass to round the sharpest valley kinks (concave only —
    // the eroded profile has no convexities left for smoothing to amplify)
    {
      const prev = py.slice();
      for (let i = 0; i < n; i++) {
        if (protect(sArr[i])) continue;
        const a = prev[(i - 1 + n) % n];
        const c = prev[(i + 1) % n];
        py[i] = a * 0.125 + prev[i] * 0.75 + c * 0.125;
      }
    }
    return this;
  }

  buildMeshes(terrain, opts = {}) {
    const { px, pz, py, hw } = this.samples;
    const n = this.count;

    // --- corridor barriers ("边栏"): dark panel wall + glowing top rail ---
    // Left side (+right vector) cyan, right side red — and they're solid:
    // car.js clamps the car inside them (see the guardrail response in step()).
    //
    // Base height per sample: never below the road surface OR the shoulder
    // terrain just outside the rail (sampled over a 3m window). Raw terrain at
    // the rail foot sits in the carve blend zone and can slope hard laterally —
    // basing on it buried the glowing rail inside rims and dunes.
    const bankArr = this.samples.bank;
    const barrierBase = (side) => {
      const base = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let tx = px[j] - px[i], tz = pz[j] - pz[i];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const rx = tz * side, rz = -tx * side;
        const edge = hw[i] + 1.6;
        const roadH = py[i] - side * edge * Math.tan(bankArr[i]);
        let h = roadH;
        for (const off of [0, 1.5, 3]) {
          h = Math.max(h, terrain.sampleHeight(px[i] + rx * (edge + off), pz[i] + rz * (edge + off)));
        }
        base[i] = h;
      }
      for (let pass = 0; pass < 6; pass++) {
        const prev = base.slice();
        for (let i = 0; i < n; i++) {
          base[i] = prev[(i - 1 + n) % n] * 0.25 + prev[i] * 0.5 + prev[(i + 1) % n] * 0.25;
        }
      }
      return base;
    };
    const barrierGeo = (side, base, yBot, yTop, w = 0) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 2 * 3);
      const idx = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let tx = px[j] - px[i], tz = pz[j] - pz[i];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const rx = tz * side, rz = -tx * side;
        const edge = hw[i] + 1.6;
        for (let k = 0; k < 2; k++) {
          const off = edge + (k === 0 ? -w : w);
          const o = (i * 2 + k) * 3;
          pos[o] = px[i] + rx * off;
          pos[o + 1] = base[i] + (k === 0 ? yBot : yTop);
          pos[o + 2] = pz[i] + rz * off;
        }
        const a = i * 2, b = i * 2 + 1, c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
        idx.push(a, c, b, b, c, d);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x121824, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide,
    });
    for (const side of [1, -1]) {
      const base = barrierBase(side);
      const wall = new THREE.Mesh(barrierGeo(side, base, -2.4, 1.35), wallMat);
      wall.receiveShadow = true;
      const railCol = side > 0 ? 0x18c8ff : 0xff5230;
      const rail = new THREE.Mesh(barrierGeo(side, base, 1.32, 1.52, 0.14),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(railCol).multiplyScalar(1.9), toneMapped: false, side: THREE.DoubleSide }));
      wall.name = side > 0 ? 'wallL' : 'wallR';
      rail.name = side > 0 ? 'railL' : 'railR';
      this.group.add(wall, rail);
    }

    // --- marker pylons alternating sides ---
    const pylonEvery = Math.round(150 / 2); // samples are 2m
    const pylonGeo = new THREE.CylinderGeometry(0.28, 0.6, 5, 6);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, metalness: 0.4 });
    const tipGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd8ff).multiplyScalar(2.2), toneMapped: false });
    const pylonCount = Math.floor(n / pylonEvery);
    const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonCount);
    const tips = new THREE.InstancedMesh(tipGeo, tipMat, pylonCount);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let pc = 0;
    for (let i = 0; i < n; i += pylonEvery) {
      const side = ((i / pylonEvery) | 0) % 2 === 0 ? 1 : -1;
      const f = this.frameAt(this.samples.s[i]);
      const off = f.hw + 2.6;
      const x = f.x + f.rx * off * side;
      const z = f.z + f.rz * off * side;
      const y = terrain.sampleHeight(x, z);
      v.set(x, y + 2.5, z); m.compose(v, q, sc); pylons.setMatrixAt(pc, m);
      v.set(x, y + 5.2, z); m.compose(v, q, sc); tips.setMatrixAt(pc, m);
      pc++;
    }
    pylons.instanceMatrix.needsUpdate = true; tips.instanceMatrix.needsUpdate = true;
    pylons.castShadow = true;
    this.group.add(pylons, tips);

    // --- start/finish gantry at s=0 ---
    const f0 = this.frameAt(0);
    const yaw0 = Math.atan2(f0.tx, f0.tz);
    const gantry = new THREE.Group();
    gantry.rotation.y = yaw0;
    gantry.position.set(f0.x, f0.y, f0.z);
    // legs run deep below grade so they meet the ground on banked/uneven spots
    const legGeo = new THREE.BoxGeometry(1.6, 24, 1.6);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.5, metalness: 0.7 });
    const span = f0.hw * 2 + 11;
    const beamGeo = new THREE.BoxGeometry(span, 4, 2.6);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x3c4047, roughness: 0.5, metalness: 0.7 });
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set((f0.hw + 4.2) * side, 4, 0);
      leg.castShadow = true;
      gantry.add(leg);
    }
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 16;
    beam.castShadow = true;
    gantry.add(beam);
    // emissive sign band (canvas text)
    const signCv = document.createElement('canvas');
    signCv.width = 1024; signCv.height = 128;
    const sc2 = signCv.getContext('2d');
    sc2.fillStyle = '#0a0d14'; sc2.fillRect(0, 0, 1024, 128);
    sc2.fillStyle = '#ffb066';
    sc2.font = '500 78px "Geist Mono", ui-monospace, monospace';
    sc2.textAlign = 'center'; sc2.textBaseline = 'middle';
    sc2.fillText('SELENE GP', 512, 56);
    sc2.fillStyle = '#7d8898';
    sc2.font = '500 26px "Geist Mono", ui-monospace, monospace';
    sc2.fillText('MARE IMBRIUM CIRCUIT', 512, 106);
    const signTex = new THREE.CanvasTexture(signCv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
    signMat.color.multiplyScalar(1.35);
    signMat.toneMapped = false;
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(span - 1.5, 3.2), signMat);
      face.position.set(0, 16, 1.36 * side);
      if (side < 0) face.rotation.y = Math.PI;
      gantry.add(face);
    }
    this.group.add(gantry);
    this.gantryFrame = f0;

    // --- checkered start line decal ---
    const lineGeo = new THREE.PlaneGeometry(f0.hw * 2 - 1, 3.4);
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = 256; lineCanvas.height = 44;
    const cx = lineCanvas.getContext('2d');
    cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, 256, 44);
    const cells = 16;
    for (let r = 0; r < 3; r++) for (let c = 0; c < cells; c++) {
      if ((r + c) % 2 === 0) { cx.fillStyle = '#8f949c'; cx.fillRect(c * 16, r * 14 + 1, 16, 14); }
    }
    const lineTex = new THREE.CanvasTexture(lineCanvas);
    lineTex.colorSpace = THREE.SRGBColorSpace;
    const lineMat = new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    line.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), yaw0);
    // follow the banked surface (roadSurfaceY = py − dSigned·tan(bank))
    line.rotateOnWorldAxis(new THREE.Vector3(f0.tx, 0, f0.tz).normalize(), -f0.bank);
    line.position.set(f0.x, f0.y + 0.25, f0.z);
    this.group.add(line);

    // --- boost chevron pads on the racing line ---
    const chevCanvas = document.createElement('canvas');
    chevCanvas.width = 128; chevCanvas.height = 128;
    const cc = chevCanvas.getContext('2d');
    cc.clearRect(0, 0, 128, 128);
    cc.strokeStyle = '#8fffd0';
    cc.lineWidth = 10;
    for (let k = 0; k < 3; k++) {
      const y = 100 - k * 34;
      cc.beginPath(); cc.moveTo(24, y); cc.lineTo(64, y - 24); cc.lineTo(104, y); cc.stroke();
    }
    const chevTex = new THREE.CanvasTexture(chevCanvas);
    chevTex.colorSpace = THREE.SRGBColorSpace;
    const chevGeo = new THREE.PlaneGeometry(9, 9);
    const chevMat = new THREE.MeshBasicMaterial({
      map: chevTex, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, toneMapped: false,
    });
    const padSpacing = 640;
    const padCount = Math.floor(this.length / padSpacing);
    for (let k = 0; k < padCount; k++) {
      const s = 320 + k * padSpacing;
      const f = this.frameAt(s);
      const pad = new THREE.Mesh(chevGeo, chevMat);
      pad.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      // +π: the canvas "up" lands pointing backwards after the flat rotation —
      // chevrons must point down-track, the way the cars travel
      pad.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(f.tx, f.tz) + Math.PI);
      // lie flat on banked sections (the bowl runs up to ~58°)
      pad.rotateOnWorldAxis(new THREE.Vector3(f.tx, 0, f.tz).normalize(), -f.bank);
      pad.position.set(f.x, f.y + 0.3, f.z);
      this.group.add(pad);
      this.chevrons.push({ s, x: f.x, z: f.z, mesh: pad });
    }

    return this.group;
  }

  // progress helpers for checkpoints/standings --------------------------
  makeCheckpoints(n = 12) {
    this.checkpoints = [];
    for (let i = 0; i < n; i++) this.checkpoints.push((i / n) * this.length);
    return this.checkpoints;
  }
}
