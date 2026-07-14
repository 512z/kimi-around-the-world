// SELENE GP — procedural Mare Imbrium heightfield.
// One Float32 height array is the single source of truth: the render mesh is
// built from it, the road is carved into it, and the vehicle physics samples
// it bilinearly — the road you see IS the surface you drive.

import * as THREE from 'three';
import { fbm2, valueNoise2, mulberry32, smoothstep, clamp, clamp01, lerp } from './util.js';

export const WORLD = 8000;          // meters, centered on origin
export const GRID = 1280;           // segments → 1281² vertices, 6.25m cells
const CELL = WORLD / GRID;
let terrain_owner = null, terrain_ownerAlong = null;
const HALF = WORLD / 2;

export const CRATERS = [
  { x: -1320, z: 45,   r: 560, depth: 158, rim: 34 },  // A — the bowl
  { x: 900,   z: 930,  r: 340, depth: 82,  rim: 12 },  // B — hairpin rim
  { x: 270,   z: 630,  r: 330, depth: 62,  rim: 16 },
  { x: -180,  z: -405, r: 260, depth: 44,  rim: 12 },
  { x: 675,   z: -270, r: 420, depth: 78,  rim: 20 },
  { x: -1485, z: -675, r: 300, depth: 55,  rim: 15 },
  { x: 1900,  z: 1150, r: 240, depth: 40,  rim: 12 },
  { x: -560,  z: 1780, r: 350, depth: 60,  rim: 16 },
  { x: 640,   z: -1850,r: 280, depth: 48,  rim: 13 },
  { x: -1620, z: 990,  r: 200, depth: 34,  rim: 10 },
  { x: 1480,  z: 1700, r: 170, depth: 28,  rim: 9 },
  { x: -45,   z: 180,  r: 120, depth: 18,  rim: 7 },
  { x: 1300,  z: -1300,r: 150, depth: 24,  rim: 8 },
  { x: -1215, z: -1440,r: 220, depth: 36,  rim: 11 },
];

// ridge the finish straight launches over (rim-crest): axis through C, dir D.
// R = σ²/2A ≈ 190m — sharp enough that even maglev can't hold a fast car down.
const RIDGE = { cx: -504, cz: -1071, dx: 0.62, dz: -0.785, amp: 4.0, sigma: 55, len: 900 };

function craterHeight(x, z) {
  let h = 0;
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    const u = d / c.r;
    if (u < 1) h -= c.depth * (1 - u * u);
    h += c.rim * Math.exp(-(((u - 1) / 0.17) ** 2));
    if (u > 1 && u < 2.2) h -= c.depth * 0.06 * Math.exp(-(((u - 1.5) / 0.5) ** 2)); // ejecta skirt
  }
  return h;
}

function naturalHeight(x, z) {
  let h = 0;
  h += (fbm2(x * 0.00032 + 17.3, z * 0.00032 + 4.1, 4) - 0.5) * 46;   // rolling plain
  h += (fbm2(x * 0.0016 + 3.7, z * 0.0016 + 9.2, 4) - 0.5) * 11;      // medium
  h += (fbm2(x * 0.009 + 31.7, z * 0.009 + 2.6, 3) - 0.5) * 2.6;      // rough
  h += craterHeight(x, z);
  // rim-crest ridge across the finish straight approach
  const rx = x - RIDGE.cx, rz = z - RIDGE.cz;
  const along = rx * RIDGE.dx + rz * RIDGE.dz;
  const across = -rx * RIDGE.dz + rz * RIDGE.dx;
  h += RIDGE.amp * Math.exp(-((across / RIDGE.sigma) ** 2)) * smoothstep(RIDGE.len, RIDGE.len * 0.55, Math.abs(along));
  return h;
}

export class Terrain {
  constructor() {
    this.heights = new Float32Array((GRID + 1) * (GRID + 1));
    this.road = new Float32Array((GRID + 1) * (GRID + 1)); // 0 natural .. 1 road
    this.boulders = [];
    this.boulderHash = new Map();
    this.mesh = null;
  }

  idx(i, j) { return j * (GRID + 1) + i; }

  buildNatural() {
    for (let j = 0; j <= GRID; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i <= GRID; i++) {
        const x = -HALF + i * CELL;
        this.heights[this.idx(i, j)] = naturalHeight(x, z);
      }
    }
    return this;
  }

  // --- queries used by physics -----------------------------------------
  sampleHeight(x, z) {
    const fi = (x + HALF) / CELL, fj = (z + HALF) / CELL;
    if (fi < 0 || fj < 0 || fi >= GRID || fj >= GRID) {
      const xi = clamp(Math.floor(fi), 0, GRID), zi = clamp(Math.floor(fj), 0, GRID);
      return this.heights[this.idx(xi, zi)] - 2;
    }
    const i = Math.floor(fi), j = Math.floor(fj);
    const fx = fi - i, fz = fj - j;
    const h00 = this.heights[this.idx(i, j)];
    const h10 = this.heights[this.idx(i + 1, j)];
    const h01 = this.heights[this.idx(i, j + 1)];
    const h11 = this.heights[this.idx(i + 1, j + 1)];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  sampleNormal(x, z, out) {
    const e = CELL;
    const hL = this.sampleHeight(x - e, z), hR = this.sampleHeight(x + e, z);
    const hD = this.sampleHeight(x, z - e), hU = this.sampleHeight(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  sampleRoadness(x, z) {
    const fi = Math.round((x + HALF) / CELL), fj = Math.round((z + HALF) / CELL);
    if (fi < 0 || fj < 0 || fi > GRID || fj > GRID) return 0;
    return this.road[this.idx(fi, fj)];
  }

  bouldersNear(x, z, radius, out) {
    out.length = 0;
    const cell = 60;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    const span = Math.ceil((radius + 12) / cell);
    for (let ox = -span; ox <= span; ox++) for (let oz = -span; oz <= span; oz++) {
      const arr = this.boulderHash.get(`${cx + ox},${cz + oz}`);
      if (arr) for (const b of arr) out.push(b);
    }
    return out;
  }

  // --- carve the circuit into the heightfield --------------------------
  // Two passes over road samples → nearby grid cells: first assign each vertex
  // to its closest sample (along-tangent), then apply the carve once per vertex.
  carve(track) {
    const samples = track.samples;
    const n = track.count;
    const shoulder = 16;
    const reach = 40;
    const cells = Math.ceil(reach / CELL);
    const owner = terrain_owner || (terrain_owner = new Int32Array((GRID + 1) * (GRID + 1)));
    const ownerAlong = terrain_ownerAlong || (terrain_ownerAlong = new Float32Array((GRID + 1) * (GRID + 1)));
    owner.fill(-1);
    ownerAlong.fill(1e9);
    for (let i = 0; i < n; i++) {
      const cx = samples.px[i], cz = samples.pz[i];
      const j2 = (i + 1) % n;
      let tx = samples.px[j2] - cx, tz = samples.pz[j2] - cz;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const gi = Math.round((cx + HALF) / CELL), gj = Math.round((cz + HALF) / CELL);
      for (let oj = -cells; oj <= cells; oj++) {
        const jj = gj + oj;
        if (jj < 0 || jj > GRID) continue;
        const z = -HALF + jj * CELL;
        for (let oi = -cells; oi <= cells; oi++) {
          const ii = gi + oi;
          if (ii < 0 || ii > GRID) continue;
          const x = -HALF + ii * CELL;
          const along = Math.abs((x - cx) * tx + (z - cz) * tz);
          if (along > 3.2) continue;
          const k = this.idx(ii, jj);
          if (along < ownerAlong[k]) { ownerAlong[k] = along; owner[k] = i; }
        }
      }
    }
    for (let k = 0; k < owner.length; k++) {
      const i = owner[k];
      if (i < 0) continue;
      const ii = k % (GRID + 1), jj = (k - ii) / (GRID + 1);
      const x = -HALF + ii * CELL, z = -HALF + jj * CELL;
      const j2 = (i + 1) % n;
      let tx = samples.px[j2] - samples.px[i], tz = samples.pz[j2] - samples.pz[i];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const rx = tz, rz = -tx;
      const dSigned = (x - samples.px[i]) * rx + (z - samples.pz[i]) * rz;
      const dist = Math.abs(dSigned);
      const hw = samples.hw[i];
      if (dist > hw + shoulder + 4) continue;
      const roadH = samples.py[i] - dSigned * Math.tan(samples.bank[i]);
      const blend = 1 - smoothstep(hw - 1.5, hw + shoulder, dist);
      const berm = 0.35 * Math.exp(-(((dist - hw - 4.5) / 3.0) ** 2)) * smoothstep(hw + 1, hw + 3.5, dist);
      this.heights[k] = lerp(this.heights[k], roadH, blend) + berm;
      this.road[k] = blend;
    }
    return this;
  }

  buildMesh() {
    const verts = (GRID + 1) * (GRID + 1);
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const aRoad = new Float32Array(verts);
    for (let j = 0; j <= GRID; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i <= GRID; i++) {
        const x = -HALF + i * CELL;
        const k = this.idx(i, j);
        const h = this.heights[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        uv[k * 2] = i / GRID * 110; uv[k * 2 + 1] = j / GRID * 110;
        const n = valueNoise2(x * 0.011 + 40, z * 0.011 + 7);
        const g = 0.46 + n * 0.1;
        col[k * 3] = g * 1.02; col[k * 3 + 1] = g; col[k * 3 + 2] = g * 0.97;
        aRoad[k] = this.road[k];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1));
    const indices = new Uint32Array(GRID * GRID * 6);
    let p = 0;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = this.idx(i, j), b = this.idx(i + 1, j), c = this.idx(i, j + 1), d = this.idx(i + 1, j + 1);
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, metalness: 0.0,
      map: makeRegolithAlbedo(), normalMap: makeRegolithNormal(),
      normalScale: new THREE.Vector2(0.5, 0.5), color: 0xbdb9b1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRoad;\nvarying float vRoad;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vRoad;
varying vec3 vWPos;
float h2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p.x+p.y)*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),u.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x),u.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 roadCol = vec3(0.055, 0.058, 0.068);
  float grit = vn(vWPos.xz * 1.7);
  roadCol *= 0.8 + grit * 0.4;
  diffuseColor.rgb = mix(diffuseColor.rgb, roadCol, clamp(vRoad * 1.3, 0.0, 1.0));
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.92, clamp(vRoad,0.0,1.0));`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.0, clamp(vRoad,0.0,1.0));`);
    };

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    return this.mesh;
  }

  // --- boulders ----------------------------------------------------------
  buildBoulders(scene, track, seed = 7) {
    const rng = mulberry32(seed * 7919);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = valueNoise2(v.x * 2.1 + 5, v.z * 2.1 + v.y * 3.3);
      const n2 = valueNoise2(v.y * 3.7 + 9, v.x * 2.9);
      v.multiplyScalar(0.72 + n * 0.5 + n2 * 0.22);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x76726b, roughness: 0.95, metalness: 0.02, flatShading: true });

    const placements = [];
    let guard = 0;
    while (placements.length < 430 && guard < 12000) {
      guard++;
      const x = (rng() - 0.5) * (WORLD - 400);
      const z = (rng() - 0.5) * (WORLD - 400);
      const r = 1.2 + Math.pow(rng(), 2.4) * 10;
      // keep the racing corridor clear: no boulders on or near the road
      if (track) {
        const near = track.nearestS(x, z);
        if (near.dist < near.frame.hw + r * 0.8 + 9) continue;
      }
      placements.push({ x, z, r, rot: rng() * Math.PI * 2, sx: 0.8 + rng() * 0.5, sy: 0.65 + rng() * 0.5, sz: 0.8 + rng() * 0.5 });
    }
    const inst = new THREE.InstancedMesh(geo, mat, placements.length);
    inst.castShadow = true; inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), vv = new THREE.Vector3(), s = new THREE.Vector3();
    const cell = 60;
    placements.forEach((b, i) => {
      const y = this.sampleHeight(b.x, b.z);
      e.set(rng2(b.x) * 0.6, b.rot, rng2(b.z) * 0.6);
      q.setFromEuler(e);
      vv.set(b.x, y + b.r * 0.32, b.z);
      s.set(b.r * b.sx, b.r * b.sy, b.r * b.sz);
      m.compose(vv, q, s);
      inst.setMatrixAt(i, m);
      const key = `${Math.floor(b.x / cell)},${Math.floor(b.z / cell)}`;
      let arr = this.boulderHash.get(key);
      if (!arr) { arr = []; this.boulderHash.set(key, arr); }
      arr.push({ x: b.x, z: b.z, r: b.r * Math.max(b.sx, b.sz) * 1.05 });
    });
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
    this.boulderMesh = inst;
    return inst;
  }
}

function rng2(v) { return (Math.sin(v * 12.9898) * 43758.5453) % 1; }

// ---------- procedural regolith textures (canvas) ----------
function makeRegolithAlbedo() {
  const s = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#9b9994';
  ctx.fillRect(0, 0, s, s);
  const rand = mulberry32(71);
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < s * s; i++) {
    const g = (rand() - 0.5) * 32;
    d[i * 4] = clamp(d[i * 4] + g, 0, 255);
    d[i * 4 + 1] = clamp(d[i * 4 + 1] + g, 0, 255);
    d[i * 4 + 2] = clamp(d[i * 4 + 2] + g * 0.9, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  // micro craters / freckles
  for (let i = 0; i < 950; i++) {
    const x = rand() * s, y = rand() * s, r = 1 + rand() * 6;
    ctx.fillStyle = `rgba(${30 + rand() * 40 | 0},${30 + rand() * 40 | 0},${34 + rand() * 40 | 0},${0.10 + rand() * 0.2})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(235,235,240,${0.05 + rand() * 0.12})`;
    ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.7, 0, 7); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeRegolithNormal() {
  const s = 256;
  const height = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      height[x + y * s] =
        fbm2(x * 0.06, y * 0.06, 3) +
        fbm2(x * 0.22, y * 0.22, 2) * 0.5;
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = x + y * s;
      const hx = height[((x + 1) % s) + y * s] - height[((x - 1 + s) % s) + y * s];
      const hy = height[x + ((y + 1) % s) * s] - height[x + ((y - 1 + s) % s) * s];
      const v = new THREE.Vector3(-hx * 2.2, -hy * 2.2, 1).normalize();
      img.data[i * 4] = (v.x * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
