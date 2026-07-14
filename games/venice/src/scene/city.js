// Procedural Venice: buildings, roofs, bridges, quays, campo, mooring poles, laundry.
// Everything merged into a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, facadeCellUV, blindCellUV, FACADE_CELLS, BLIND_CELLS } from './textures.js';
import { BRIDGES, DOCKS, CAMPO, campoOffset } from './canal.js';

function remapFaceUV(geo, faceIndex, rect, mirrorU = false) {
  // BoxGeometry: 6 faces x 4 verts; default uv 0..1 per face
  const uv = geo.attributes.uv;
  for (let v = 0; v < 4; v++) {
    const i = faceIndex * 4 + v;
    const u = uv.getX(i), w = uv.getY(i);
    uv.setXY(i, rect.u + (mirrorU ? 1 - u : u) * rect.w, rect.v + w * rect.h);
  }
}

function addBuilding(list, cx, cz, rotY, w, d, h, rng) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const f = facadeCellUV((rng() * FACADE_CELLS) | 0);
  const b = blindCellUV((rng() * BLIND_CELLS) | 0);
  // faces: 0:+x 1:-x 2:+y 3:-y 4:+z(front/canal) 5:-z(back)
  remapFaceUV(geo, 0, b, rng() > 0.5);
  remapFaceUV(geo, 1, b, rng() > 0.5);
  remapFaceUV(geo, 2, b);
  remapFaceUV(geo, 3, b);
  remapFaceUV(geo, 4, f, rng() > 0.5);
  remapFaceUV(geo, 5, rng() > 0.5 ? f : b, rng() > 0.5);
  geo.rotateY(rotY);
  geo.translate(cx, h / 2 - 0.1, cz);
  list.push(geo);
}

function addRoof(list, cx, cz, rotY, w, d, h, rng) {
  // gable prism with ridge along Z, end caps, eaves overhanging the walls
  const ridge = Math.min(d, w) * 0.32 + 0.8;
  const hw = w / 2 + 0.45, hd = d / 2 + 0.45;
  const g = new THREE.BufferGeometry();
  // 4 slope triangles + 2 gable-end triangles
  const tris = [
    [[-hw, 0, -hd], [0, ridge, -hd], [0, ridge, hd]],   // left slope
    [[-hw, 0, -hd], [0, ridge, hd], [-hw, 0, hd]],
    [[hw, 0, -hd], [hw, 0, hd], [0, ridge, hd]],        // right slope
    [[hw, 0, -hd], [0, ridge, hd], [0, ridge, -hd]],
    [[-hw, 0, -hd], [hw, 0, -hd], [0, ridge, -hd]],     // front gable
    [[-hw, 0, hd], [0, ridge, hd], [hw, 0, hd]],        // back gable
  ];
  const pos = [], uvs = [];
  for (const tri of tris) {
    for (const v of tri) {
      pos.push(v[0], v[1], v[2]);
      uvs.push((v[0] + v[1] * 0.6) * 0.35, v[2] * 0.35);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  g.rotateY(rotY);
  g.translate(cx, h - 0.55, cz); // sinks into the box: slopes overlap the walls
  list.push(g);
}

function addChimney(list, cx, cz, rotY, x, z, h, rng) {
  const ch = 1.5 + rng() * 1.3;
  const geo = new THREE.BoxGeometry(0.46, ch, 0.46);
  geo.translate(x, h + ch / 2 - 0.4, z); // base embedded into the roof
  geo.rotateY(rotY);
  geo.translate(cx, 0, cz);
  list.push(geo);
  if (rng() > 0.4) { // pot
    const pot = new THREE.CylinderGeometry(0.1, 0.14, 0.34, 7);
    pot.translate(x, h + ch - 0.15, z);
    pot.rotateY(rotY);
    pot.translate(cx, 0, cz);
    list.push(pot);
  }
}

export function buildCity(canal, textures) {
  const rng = mulberry32(1234);
  const walls = [
    { poly: canal.left, side: -1 },
    { poly: canal.right, side: 1 },
  ];
  const buildingGeos = [], roofGeos = [], chimneyGeos = [];

  for (const wall of walls) {
    // walk the wall polyline by arclength
    const pts = wall.poly;
    let i = 0;
    while (i < pts.length - 2) {
      // arclength position along wall
      let acc = 0, j = i;
      const w = 5.2 + rng() * 3.4;
      while (j < pts.length - 1 && acc < w) {
        acc += pts[j].distanceTo(pts[j + 1]);
        j++;
      }
      const mid = pts[(i + j) >> 1];
      const sInfo = canal.nearestS(mid.x, mid.y);
      const sm = sInfo.sample;
      const nx = Math.cos(sm.ang) * wall.side, nz = -Math.sin(sm.ang) * wall.side;
      const d = 6 + rng() * 7;
      const h = 9.5 + rng() * 7.5 + (sm.s > 400 ? rng() * 3 : 0);
      // building center: wall point + outward normal * d/2  (outward = away from canal)
      const cx = mid.x + nx * d / 2;
      const cz = mid.y + nz * d / 2;
      const rotY = Math.atan2(-nx, -nz); // local +Z faces the canal
      addBuilding(buildingGeos, cx, cz, rotY, w, d, h, rng);
      addRoof(roofGeos, cx, cz, rotY, w, d, h, rng);
      if (rng() > 0.45) addChimney(chimneyGeos, cx, cz, rotY, (rng() - .5) * w * 0.4, (rng() - .5) * d * 0.3, h, rng);
      i = j;
    }
  }

  const group = new THREE.Group();

  const merged = mergeGeometries(buildingGeos, false);
  const mat = new THREE.MeshStandardMaterial({
    map: textures.facade.map,
    emissiveMap: textures.facade.emissiveMap,
    emissive: new THREE.Color(1, 0.72, 0.42),
    emissiveIntensity: 0.5,
    roughnessMap: textures.facade.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  group.add(new THREE.Mesh(merged, mat));

  const roofMerged = mergeGeometries(roofGeos, false);
  const roofMat = new THREE.MeshStandardMaterial({
    map: textures.roof, roughness: 0.92, metalness: 0, envMapIntensity: 0.4,
  });
  group.add(new THREE.Mesh(roofMerged, roofMat));

  const chimMerged = mergeGeometries(chimneyGeos, false);
  const chimMat = new THREE.MeshStandardMaterial({ color: 0x7d5643, roughness: 0.95, envMapIntensity: 0.3 });
  group.add(new THREE.Mesh(chimMerged, chimMat));

  return { group, material: mat };
}

// ---------------------------------------------------------------- bridges ---
export function buildBridges(canal, textures) {
  const geos = [];
  for (const br of BRIDGES) {
    const sm = canal.atS(br.s);
    const half = sm.width / 2 + 1.1;
    const open = Math.max(1.4, sm.width / 2 - br.pier + 0.25);
    const spring = 0.35;
    const shape = new THREE.Shape();
    shape.moveTo(-half, -1.0);
    shape.lineTo(-half, br.deck + 0.3);
    shape.lineTo(half, br.deck + 0.3);
    shape.lineTo(half, -1.0);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-open, -0.6);
    hole.lineTo(-open, spring);
    hole.absarc(0, spring, open, Math.PI, 0, true);
    hole.lineTo(open, -0.6);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: br.thick, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -br.thick / 2);
    // uv in meters
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.28, uv.getY(i) * 0.28);
    geo.rotateY(sm.ang);
    geo.translate(sm.x, 0, sm.z);
    geos.push(geo);

    // parapets
    for (const side of [-1, 1]) {
      let para = new THREE.BoxGeometry(half * 2, 0.8, 0.28);
      const puv = para.attributes.uv;
      for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 3, puv.getY(i));
      para.translate(0, br.deck + 0.7, side * (br.thick / 2 - 0.14));
      para.rotateY(sm.ang);
      para.translate(sm.x, 0, sm.z);
      geos.push(para.toNonIndexed());
    }
    // keystone accent: small lighter block at arch apex (both faces)
    for (const side of [-1, 1]) {
      const ks = new THREE.BoxGeometry(0.5, 0.6, 0.16);
      ks.translate(0, spring + open - 0.25, side * (br.thick / 2 + 0.01));
      ks.rotateY(sm.ang);
      ks.translate(sm.x, 0, sm.z);
      geos.push(ks.toNonIndexed());
    }
  }
  const merged = mergeGeometries(geos, false);
  const mat = new THREE.MeshStandardMaterial({ map: textures.stone, roughness: 0.95, envMapIntensity: 0.4 });
  return new THREE.Mesh(merged, mat);
}

// ------------------------------------------------------------- quay edges ---
export function buildQuays(canal, textures) {
  const geos = [];
  for (const wall of [canal.left, canal.right]) {
    const pos = [], uvs = [], idx = [];
    let vi = 0;
    for (let i = 0; i < wall.length - 1; i++) {
      const a = wall[i], b = wall[i + 1];
      // skip campo interior edge segments (they get pavement instead)
      const sm = canal.nearestS((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (campoOffset(sm.s) > 0.5 && wall === canal.left) continue;
      const y0 = -0.8, y1 = 0.38;
      pos.push(a.x, y0, a.y, a.x, y1, a.y, b.x, y1, b.y, b.x, y0, b.y);
      const u = sm.s * 0.3;
      uvs.push(u, 0, u, 0.4, u + 0.3, 0.4, u + 0.3, 0);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  const mat = new THREE.MeshStandardMaterial({ map: textures.stone, roughness: 0.97, envMapIntensity: 0.35, side: THREE.DoubleSide });
  return new THREE.Mesh(merged, mat);
}

// ----------------------------------------------------------------- campo ----
export function buildCampo(canal, textures) {
  const group = new THREE.Group();
  const c = canal.atS((CAMPO.s0 + CAMPO.s1) / 2);
  const ang = c.ang;
  const nx = Math.cos(ang), nz = -Math.sin(ang);
  const half = c.width / 2;
  // pavement at receded wall
  const cx = c.x - nx * (half + CAMPO.depth / 2);
  const cz = c.z - nz * (half + CAMPO.depth / 2);
  const pave = new THREE.Mesh(
    new THREE.BoxGeometry(CAMPO.depth, 0.4, CAMPO.s1 - CAMPO.s0 + 8),
    new THREE.MeshStandardMaterial({ map: textures.stone, roughness: 0.95, envMapIntensity: 0.4 }),
  );
  pave.position.set(cx, 0.2, cz);
  pave.rotation.y = ang;
  const puv = pave.geometry.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 4, puv.getY(i) * 4);
  group.add(pave);
  // pozzo (well) at center
  const well = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 0.95, 12),
    new THREE.MeshStandardMaterial({ map: textures.stone, roughness: 0.95 }),
  );
  well.position.set(cx, 0.85, cz);
  group.add(well);
  const wellTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xb0a48e, roughness: 0.9 }),
  );
  wellTop.position.set(cx, 1.36, cz);
  group.add(wellTop);
  group.userData.center = new THREE.Vector3(cx, 0.4, cz);
  return group;
}

// ---------------------------------------------------------- mooring poles ---
export function buildPoles(canal, textures) {
  const rng = mulberry32(777);
  const geos = [];
  const spots = [];
  for (const dk of DOCKS) spots.push({ s: dk.s + dk.side * 3, side: dk.side });
  for (let i = 0; i < 26; i++) spots.push({ s: 15 + rng() * 585, side: rng() > 0.5 ? 1 : -1 });
  for (const sp of spots) {
    const sm = canal.atS(sp.s);
    const nx = Math.cos(sm.ang) * sp.side, nz = -Math.sin(sm.ang) * sp.side;
    const cluster = 1 + (rng() * 3 | 0);
    for (let k = 0; k < cluster; k++) {
      const along = (rng() - 0.5) * 3.5;
      const out = 0.6 + rng() * 1.6;
      const px = sm.x + nx * (sm.width / 2 - out) + Math.sin(sm.ang) * along * sp.side;
      const pz = sm.z + nz * (sm.width / 2 - out) - Math.cos(sm.ang) * along * sp.side;
      const h = 2.6 + rng() * 1.4;
      const geo = new THREE.CylinderGeometry(0.085, 0.1, h, 8);
      geo.rotateZ((rng() - 0.5) * 0.14);
      geo.rotateX((rng() - 0.5) * 0.14);
      geo.translate(px, h / 2 - 0.9, pz);
      geos.push(geo);
    }
  }
  const merged = mergeGeometries(geos, false);
  const mat = new THREE.MeshStandardMaterial({ map: textures.stripe, roughness: 0.85, envMapIntensity: 0.4 });
  return new THREE.Mesh(merged, mat);
}

// --------------------------------------------------------------- laundry ----
export function buildLaundry(canal, textures) {
  const rng = mulberry32(555);
  const lineGeos = [];
  const clothPos = [], clothUv = [], clothPhase = [], clothColor = [], clothIdx = [];
  let cv = 0;
  const COLORS = [0xe8e2d0, 0xd8d0c0, 0xb34a3a, 0x3a5a7a, 0x8a9a6a, 0xc9a24a, 0x9a8a9a];
  const nLines = 26;
  for (let i = 0; i < nLines; i++) {
    const s = 20 + (i / nLines) * 560 + rng() * 12;
    const sm = canal.atS(s);
    const y = 4.5 + rng() * 5.5;
    const nx = Math.cos(sm.ang), nz = -Math.sin(sm.ang);
    const half = sm.width / 2 + 0.2;
    const ax = sm.x - nx * half, az = sm.z - nz * half;
    const bx = sm.x + nx * half, bz = sm.z + nz * half;
    // catenary-ish sag
    const sag = 0.25 + rng() * 0.35;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push(new THREE.Vector3(
        ax + (bx - ax) * t,
        y - Math.sin(t * Math.PI) * sag,
        az + (bz - az) * t,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    lineGeos.push(new THREE.TubeGeometry(curve, 10, 0.012, 4, false));
    // cloths
    const nCloth = 2 + (rng() * 4 | 0);
    for (let k = 0; k < nCloth; k++) {
      const t = 0.12 + rng() * 0.76;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const w = 0.42 + rng() * 0.3, h = 0.55 + rng() * 0.45;
      const hang = y - Math.sin(t * Math.PI) * sag - h / 2;
      const angY = Math.atan2(tan.x, tan.z);
      const col = new THREE.Color(COLORS[(rng() * COLORS.length) | 0]);
      const phase = rng() * 6.28;
      // quad hanging from line, hinged at top
      const verts = [[-w / 2, h / 2, 0], [w / 2, h / 2, 0], [w / 2, -h / 2, 0], [-w / 2, -h / 2, 0]];
      const uvQ = [[0, 1], [1, 1], [1, 0], [0, 0]];
      const rot = new THREE.Matrix4().makeRotationY(angY);
      const tr = new THREE.Matrix4().makeTranslation(p.x, hang, p.z);
      const m = tr.multiply(rot);
      for (const v of [0, 1, 2, 3]) {
        const vv = new THREE.Vector3(...verts[v]).applyMatrix4(m);
        clothPos.push(vv.x, vv.y, vv.z);
        clothUv.push(uvQ[v][0], uvQ[v][1]);
        clothPhase.push(phase, verts[v][1] < 0 ? 1 : 0); // x=phase, y=loose-end flag
        clothColor.push(col.r, col.g, col.b);
      }
      clothIdx.push(cv, cv + 1, cv + 2, cv, cv + 2, cv + 3);
      cv += 4;
    }
  }
  const group = new THREE.Group();
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1 });
  group.add(new THREE.Mesh(mergeGeometries(lineGeos, false), lineMat));

  const clothGeo = new THREE.BufferGeometry();
  clothGeo.setAttribute('position', new THREE.Float32BufferAttribute(clothPos, 3));
  clothGeo.setAttribute('uv', new THREE.Float32BufferAttribute(clothUv, 2));
  clothGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(clothPhase, 2));
  clothGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(clothColor, 3));
  clothGeo.setIndex(clothIdx);
  clothGeo.computeVertexNormals();
  const clothMat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide, vertexColors: false });
  clothMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    clothMat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aPhase;
        attribute vec3 aColor;
        uniform float uTime;
        varying vec3 vClothColor;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vClothColor = aColor;
        float loose = aPhase.y;
        float sway = sin(uTime * 1.7 + aPhase.x + position.y * 2.0) * 0.06 * loose
                   + sin(uTime * 0.9 + aPhase.x * 1.7) * 0.035 * loose;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vClothColor;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vClothColor;`);
  };
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.userData.noReflect = true;
  group.add(cloth);
  group.userData.noReflect = true;
  group.update = (t) => { if (clothMat.userData.shader) clothMat.userData.shader.uniforms.uTime.value = t; };
  return group;
}
