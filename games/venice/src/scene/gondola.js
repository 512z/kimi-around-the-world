// Parametric gondola: lofted hull, ferro, brass sheer rail, benches, oar + forcola.
// Local space: +Z = bow, -Z = stern, y=0 at waterline, origin amidships.
import * as THREE from 'three';

export const GONDOLA_LEN = 10.8;
export const GONDOLA_BEAM = 1.42;
export const BOAT_SCALE = 0.45; // gameplay scale: sized so the Kimi orb reads as the boat's pilot

function hullSection(t) {
  // t: 0 bow -> 1 stern
  const w = (GONDOLA_BEAM / 2) * Math.pow(Math.sin(Math.PI * Math.min(0.999, t)), 0.62);
  const sheer = 0.45 + 0.95 * Math.pow(1 - t, 7) + 1.25 * Math.pow(t, 8); // gunwale height
  const keel = 0.42 * Math.pow(Math.sin(Math.PI * Math.min(0.999, t)), 0.45); // below waterline
  const off = 0.10 * Math.sin(Math.PI * t) * (t - 0.35); // asymmetry (gondola lee side)
  return { w, sheer, keel, off };
}

export function buildGondolaHull() {
  const N = 48, M = 14;
  const pos = [], uvs = [], idx = [];
  const edge = { port: [], star: [] }; // sheer edge points for brass rail
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const { w, sheer, keel, off } = hullSection(t);
    const z = (0.5 - t) * GONDOLA_LEN;
    for (let j = 0; j <= M; j++) {
      const u = j / M;
      const x = off + (u * 2 - 1) * w;
      const y = sheer - (sheer + keel) * (1 - Math.pow(Math.abs(u * 2 - 1), 1.9));
      pos.push(x, y, z);
      uvs.push(t * 4, u);
      if (j === 0) edge.port.push(new THREE.Vector3(x, y, z));
      if (j === M) edge.star.push(new THREE.Vector3(x, y, z));
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = a + 1, c = a + (M + 1), d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, edge };
}

function makeFerro() {
  // iconic prow comb — flat extruded shape in the X=0 plane (slim, dark steel)
  const s = new THREE.Shape();
  s.moveTo(0.0, 0.2);
  s.bezierCurveTo(0.4, 0.45, 0.56, 1.0, 0.5, 1.5);
  s.lineTo(0.38, 1.52);
  s.bezierCurveTo(0.42, 1.05, 0.3, 0.62, 0.05, 0.42);
  s.closePath();
  // teeth
  for (let k = 0; k < 5; k++) {
    const y = 0.5 + k * 0.2;
    s.moveTo(0.46 - k * 0.025, y);
    s.lineTo(0.66 - k * 0.035, y + 0.09);
    s.lineTo(0.44 - k * 0.025, y + 0.13);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
  g.translate(0, 0, -0.02);
  return g;
}

export function makeGondola(textures, { physical = true } = {}) {
  const group = new THREE.Group();
  const { geo: hullGeo, edge } = buildGondolaHull();

  const hullMat = physical
    ? new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.35, envMapIntensity: 0.45, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.5, envMapIntensity: 0.4, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(hullGeo, hullMat));

  const woodMat = new THREE.MeshStandardMaterial({ map: textures.wood, roughness: 0.88, color: 0x6a5036 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.0 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.3, metalness: 1.0, envMapIntensity: 0.9 });
  const velvetMat = new THREE.MeshStandardMaterial({ color: 0x5e1f22, roughness: 0.95 });

  // brass sheer rails
  for (const e of [edge.port, edge.star]) {
    const curve = new THREE.CatmullRomCurve3(e);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.022, 6, false), brassMat));
  }
  // floor boards — above the waterline so water never shows inside the hull
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.04, 7.6), woodMat);
  floor.position.set(0, 0.11, -0.3);
  group.add(floor);
  // side stringers: cover the gap between floor edge and hull wall
  for (const sx of [-1, 1]) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 7.6), woodMat);
    strake.position.set(sx * 0.62, 0.16, -0.3);
    strake.rotation.z = sx * -0.35;
    group.add(strake);
  }
  // benches
  for (const [z, w] of [[1.1, 1.0], [-0.1, 1.05], [-1.3, 0.95]]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, 0.42), velvetMat);
    bench.position.set(0, 0.37, z);
    group.add(bench);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.22, 0.3), woodMat);
    legs.position.set(0, 0.22, z);
    group.add(legs);
  }
  // bow deck + stern platform (cover the ends so water can't peek in)
  const bowDeck = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 1.6), woodMat);
  bowDeck.position.set(0, 0.33, 3.95);
  bowDeck.rotation.x = -0.12;
  group.add(bowDeck);
  const stern = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 1.9), woodMat);
  stern.position.set(0, 0.46, -4.2);
  stern.rotation.x = 0.16;
  group.add(stern);

  // ferro (prow comb) + tail curl
  const ferro = new THREE.Mesh(makeFerro(), ironMat);
  ferro.position.set(0, 0.5, 5.15);
  ferro.rotation.y = Math.PI; // teeth face forward (+Z) … shape drawn facing +X; rotate to align
  ferro.rotation.x = -0.35;
  group.add(ferro);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 16, Math.PI * 1.2), ironMat);
  tail.position.set(0, 1.28, -5.3);
  tail.rotation.x = 0.5;
  group.add(tail);

  // forcola (rowlock) on starboard (-X) near stern
  const forcola = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.55, 8), woodMat);
  post.position.y = 0.25;
  forcola.add(post);
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6), woodMat);
    horn.position.set(sx * 0.09, 0.52, 0.02);
    horn.rotation.z = sx * -0.5;
    forcola.add(horn);
  }
  forcola.position.set(-0.62, 0.5, -3.6);
  group.add(forcola);
  group.userData.forcola = forcola;

  // oar (remo): shaft + blade, pivoting at forcola — blade trails astern (-Z),
  // grip forward; base angle points it starboard-aft
  const oar = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 4.1, 8), woodMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -1.2;
  oar.add(shaft);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 1.05), woodMat);
  blade.position.z = -3.4;
  oar.add(blade);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), woodMat);
  grip.position.z = 0.95;
  oar.add(grip);
  oar.position.copy(forcola.position).add(new THREE.Vector3(-0.05, 0.45, 0));
  oar.rotation.y = 0.5; // blade out to starboard (-X) and astern (-Z)
  group.add(oar);
  group.userData.oar = oar;

  // contact shadow decal
  const shadowTex = makeBlobTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 11.5),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.renderOrder = 2;
  shadow.userData.noReflect = true;
  group.add(shadow);

  group.userData.hullMat = hullMat;
  group.scale.setScalar(BOAT_SCALE);
  return group;
}

let blobTex = null;
function makeBlobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,.9)');
  g.addColorStop(0.6, 'rgba(0,0,0,.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, 7); ctx.fill();
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
