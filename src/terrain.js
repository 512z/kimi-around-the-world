// Terrain: FBM heightmap + crater basin, vertex-colored regolith with tiled
// canvas detail maps, instanced rocks, distant ridges, horizon skirt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, ihash } from './noise.js';
import { makeRegolithSet } from './textures.js';

export const CRATER = { x: -950, z: -680, R: 1180, depth: 150, rimH: 78 };
export const BASE_FLAT = { inner: 260, outer: 420 }; // flatten radius around origin

export function heightAt(x, z) {
  // rolling mare terrain
  let h = fbm2(x * 0.00085 + 3.1, z * 0.00085 + 8.4, 5) * 190 - 70;
  h += fbm2(x * 0.0035 + 20, z * 0.0035 + 5, 4) * 13;
  h += fbm2(x * 0.014 + 60, z * 0.014 + 33, 3) * 2.2; // small-scale roughness
  h += fbm2(x * 0.00022 + 50, z * 0.00022 + 90, 3) * 260 - 90; // long swells

  // crater: parabolic bowl + gaussian rim
  const dx = x - CRATER.x, dz = z - CRATER.z;
  const d = Math.hypot(dx, dz);
  const r = d / CRATER.R;
  if (r < 1.0) {
    h += -CRATER.depth * (1 - r * r);
  }
  h += CRATER.rimH * Math.exp(-Math.pow((r - 1.0) / 0.14, 2));
  // ejecta ripple outside rim
  if (r > 1.0 && r < 1.9) {
    h += 10 * Math.sin((r - 1) * 22) * Math.exp(-(r - 1) * 2.2);
  }
  // small craters sprinkled (deterministic)
  for (let i = 0; i < 16; i++) {
    const cx = (ihash(i, 7) - 0.5) * 7000;
    const cz = (ihash(i, 19) - 0.5) * 7000;
    const cr = 55 + ihash(i, 31) * 250;
    const cd = Math.hypot(x - cx, z - cz) / cr;
    if (cd < 1.6) {
      h += -cr * 0.14 * Math.max(0, 1 - cd * cd);
      h += cr * 0.05 * Math.exp(-Math.pow((cd - 1) / 0.18, 2));
    }
  }

  // flatten under the base
  const db = Math.hypot(x, z);
  const f = THREE.MathUtils.smoothstep(db, BASE_FLAT.inner, BASE_FLAT.outer);
  return h * f;
}

function buildTerrainMesh() {
  const SIZE = 5000, SEG = 440;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cDark = new THREE.Color(0.133, 0.134, 0.14);
  const cMid = new THREE.Color(0.262, 0.268, 0.282);
  const cLight = new THREE.Color(0.43, 0.438, 0.455);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    // macro albedo variation: darker crater floor, lighter fresh rim, mottle
    const dx = x - CRATER.x, dz = z - CRATER.z;
    const r = Math.hypot(dx, dz) / CRATER.R;
    const mottle = fbm2(x * 0.0016 + 100, z * 0.0016, 3);
    const fine = fbm2(x * 0.02, z * 0.02, 2);
    let t = 0.35 + (mottle - 0.5) * 0.38 + (fine - 0.5) * 0.12;
    if (r < 0.85) t *= 0.78;                          // dark basin floor
    const rimGlow = Math.exp(-Math.pow((r - 1.0) / 0.16, 2));
    t += rimGlow * 0.22;                              // brighter rim
    t = THREE.MathUtils.clamp(t, 0, 1);
    tmp.copy(cDark).lerp(cMid, Math.min(1, t * 1.6)).lerp(cLight, Math.max(0, t * 1.6 - 1));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const tex = makeRegolithSet(1024);
  for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) t.repeat.set(90, 90);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(1.8, 1.8),
    roughnessMap: tex.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildSkirt() {
  // dark ring beyond the terrain, dipping down: hides the plane edge, fakes curvature
  const inner = 2480, outer = 16000;
  const geo = new THREE.RingGeometry(inner, outer, 128, 6);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const k = THREE.MathUtils.smoothstep(d, inner, inner + 900);
    const drop = k * (380 + (d - inner) * 0.02);
    pos.setY(i, heightAt(x, z) * (1 - k) - drop);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

function buildRidges() {
  // distant mountain arcs: tall displaced strips far out, catch the low sun
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x333335, roughness: 1, metalness: 0, side: THREE.DoubleSide, fog: false });
  const placements = [
    { az: -2.5, dist: 7200, w: 9000, h: 880, seed: 3 },
    { az: -1.2, dist: 8000, w: 10000, h: 1150, seed: 8 },
    { az: 0.4, dist: 6800, w: 8000, h: 720, seed: 14 },
    { az: 1.6, dist: 7600, w: 9500, h: 980, seed: 21 },
    { az: 2.7, dist: 7000, w: 8500, h: 820, seed: 33 },
  ];
  for (const p of placements) {
    const geo = new THREE.PlaneGeometry(p.w, p.h, 160, 10);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const yn = (y + p.h / 2) / p.h; // 0 bottom .. 1 top
      const ridge = fbm2(x * 0.0007 + p.seed, p.seed, 5);
      const jag = fbm2(x * 0.004 + p.seed * 3, p.seed, 3) * 0.22;
      // fade peaks down at the strip ends so no hard vertical cut is visible
      const edge = THREE.MathUtils.smoothstep(1 - Math.abs(x) / (p.w / 2), 0, 0.14);
      const top = (ridge * 0.78 + jag * 0.22) * p.h * edge;
      // reshape so the silhouette follows the ridge profile; base sinks far below ground
      const newY = -900 + yn * (top + 900);
      pos.setY(i, newY);
      pos.setZ(i, (fbm2(x * 0.001 + p.seed, yn * 3 + p.seed, 2) - 0.5) * 550 * yn);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.sin(p.az) * p.dist, 0, Math.cos(p.az) * p.dist);
    m.lookAt(0, 0, 0);
    group.add(m);
  }
  return group;
}

function buildRocks() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a867f, roughness: 0.95, metalness: 0.0, flatShading: true, vertexColors: false,
  });

  // prototype geometries: distorted icosahedrons
  const protos = [];
  for (let p = 0; p < 6; p++) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = fbm2(x * 1.7 + p * 9.1, z * 1.7 + y * 1.3 + p * 3.7, 3);
      const s = 0.55 + n * 0.9;
      pos.setXYZ(i, x * s, y * s * 0.8, z * s);
    }
    g.computeVertexNormals();
    protos.push(g);
  }

  // candidate placement: denser near crater rim
  const buckets = protos.map(() => []);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0, attempts = 0;
  while (placed < 800 && attempts < 8000) {
    attempts++;
    const ang = Math.random() * Math.PI * 2;
    const rad = 120 + Math.pow(Math.random(), 0.7) * 2100;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    // rim density boost
    const dr = Math.abs(Math.hypot(x - CRATER.x, z - CRATER.z) - CRATER.R);
    const rimBoost = Math.exp(-dr * dr / (2 * 260 * 260));
    const density = 0.22 + rimBoost * 0.75 + fbm2(x * 0.002, z * 0.002, 2) * 0.25;
    if (Math.random() > density) continue;
    const db = Math.hypot(x, z);
    if (db < 240) continue; // keep base area clear-ish

    const big = Math.random() < 0.12;
    const s = big ? 2.5 + Math.random() * 5.5 : 0.25 + Math.pow(Math.random(), 1.8) * 1.6;
    const bi = (Math.random() * protos.length) | 0;
    buckets[bi].push({ x, z, s, y: heightAt(x, z) + s * 0.28 });
    placed++;
  }

  buckets.forEach((list, bi) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(protos[bi], mat, list.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    list.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(Math.random() * 3, Math.random() * 6.28, Math.random() * 3);
      dummy.scale.setScalar(r.s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const g = 0.4 + Math.random() * 0.3;
      color.setRGB(g, g * 0.97, g * 0.92);
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  });

  // a few hero boulders near the base for close shots (merged geometry)
  const heroGeos = [];
  const heroSpots = [
    [320, 140, 7], [-290, 220, 9], [180, -260, 6], [-380, -60, 11], [420, -180, 8],
  ];
  for (const [x, z, s] of heroSpots) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const n = fbm2(px * 1.4 + x, pz * 1.4 + py * 1.7 + z, 3);
      const k = 0.6 + n * 0.75;
      pos.setXYZ(i, px * k, py * k * 0.85, pz * k);
    }
    g.computeVertexNormals();
    g.scale(s, s, s);
    g.rotateY(Math.random() * 6.28);
    g.translate(x, heightAt(x, z) + s * 0.25, z);
    heroGeos.push(g);
  }
  const hero = new THREE.Mesh(mergeGeometries(heroGeos), mat);
  hero.castShadow = true; hero.receiveShadow = true;
  group.add(hero);

  return group;
}

// flat ribbon mesh following a world-space path (for tracks / footprints).
// texture is baked full-length; UVs stay in [0,1] (large wrapped UVs break
// transparent sampling on software WebGL backends).
export function buildRibbon(points, width, texture, { yOffset = 0.05 } = {}) {
  const pts = points.map(p => new THREE.Vector3(p[0], heightAt(p[0], p[1]) + yOffset, p[1]));
  const n = pts.length;
  let totalLen = 0;
  for (let i = 1; i < n; i++) totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);

  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x, tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    if (i > 0) acc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const v = acc / totalLen;
    positions[i * 6]     = p.x + nx * width / 2; positions[i * 6 + 1] = p.y; positions[i * 6 + 2] = p.z + nz * width / 2;
    positions[i * 6 + 3] = p.x - nx * width / 2; positions[i * 6 + 4] = p.y; positions[i * 6 + 5] = p.z - nz * width / 2;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = v;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = v;
    if (i < n - 1) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false,
    roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

export function createTerrain() {
  const group = new THREE.Group();
  group.add(buildTerrainMesh());
  group.add(buildSkirt());
  group.add(buildRidges());
  group.add(buildRocks());
  return { group, heightAt };
}
