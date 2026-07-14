// Low-poly cute character built from primitives, with a tiny procedural rig.
// No external assets. Poses: pole (gondolier stroke), idle, sit.
import * as THREE from 'three';

function mat(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true, metalness: 0 });
}

function limb(len, r, color, seg = 6) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, len, seg, 1), mat(color));
  mesh.position.y = -len / 2;
  return mesh;
}

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function makeShirtTexture(base, stripe) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 32, 64);
  ctx.fillStyle = stripe;
  for (let y = 4; y < 64; y += 14) ctx.fillRect(0, y, 32, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PALETTES = {
  gondolier: { skin: 0xe7b48c, shirt: '#f2ede0', stripe: '#2c5a8e', pants: 0x22303f, hat: 'straw', hair: 0x2e2016 },
  tourist: { skin: 0xd9a07a, shirt: '#e06830', stripe: '#f2c14e', pants: 0x6a5036, hat: 'sun', hair: 0x5a3a22 },
  local1: { skin: 0xe0aa80, shirt: '#7a9a5a', stripe: '#5a7a42', pants: 0x3a3a42, hat: 'none', hair: 0x20242a },
  local2: { skin: 0xc89068, shirt: '#b04848', stripe: '#8a3030', pants: 0x2a2e36, hat: 'cap', hair: 0x1a1a1a },
};

export function makePerson(kind = 'gondolier') {
  const p = { ...PALETTES[kind] || PALETTES.gondolier };
  const root = new THREE.Group();

  const skinMat = mat(p.skin);
  const pantsMat = mat(p.pants);
  const shirtMat = new THREE.MeshStandardMaterial({
    map: makeShirtTexture(p.shirt, p.stripe), roughness: 0.9, flatShading: true,
  });

  // ---- skeleton groups
  const hips = joint(root, 0, 0.82, 0);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.20, 0.20), pantsMat);
  pelvis.position.y = -0.02;
  hips.add(pelvis);

  const spine = joint(hips, 0, 0.10, 0);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.145, 0.52, 7, 1), shirtMat);
  torso.position.y = 0.26;
  torso.rotation.y = Math.PI / 7;
  spine.add(torso);
  // neckerchief
  const kerchief = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.12, 5), mat(0xb3282d));
  kerchief.position.set(0, 0.50, 0.10);
  kerchief.rotation.x = Math.PI;
  spine.add(kerchief);

  const neck = joint(spine, 0, 0.56, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 9, 7), skinMat);
  head.scale.set(0.92, 1.05, 0.95);
  head.position.y = 0.10;
  neck.add(head);
  // nose + eyes (tiny)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 5), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.10, 0.145);
  neck.add(nose);
  const eyeMat = mat(0x1a1a1a, 0.5);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), eyeMat);
    eye.position.set(sx * 0.055, 0.13, 0.135);
    neck.add(eye);
  }
  // hair cap
  if (p.hat !== 'sun') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(p.hair));
    hair.position.y = 0.115;
    neck.add(hair);
  }

  // hats
  if (p.hat === 'straw') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.025, 10), mat(0xd9b96a));
    brim.position.y = 0.235;
    neck.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.11, 9), mat(0xd9b96a));
    crown.position.y = 0.30;
    neck.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.138, 0.14, 0.035, 9), mat(0xb3282d));
    band.position.y = 0.265;
    neck.add(band);
  } else if (p.hat === 'sun') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.31, 0.022, 10), mat(0xe4d2a8));
    brim.position.y = 0.235;
    neck.add(brim);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(0xe4d2a8));
    crown.position.y = 0.235;
    neck.add(crown);
  } else if (p.hat === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(0x35506a));
    cap.position.y = 0.125;
    neck.add(cap);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.1), mat(0x35506a));
    visor.position.set(0, 0.135, 0.15);
    visor.rotation.x = -0.25;
    neck.add(visor);
  }

  // arms
  const shL = joint(spine, -0.215, 0.44, 0);
  const shR = joint(spine, 0.215, 0.44, 0);
  const armColor = p.skin;
  shL.add(limb(0.30, 0.055, armColor));
  shR.add(limb(0.30, 0.055, armColor));
  const elL = joint(shL, 0, -0.30, 0);
  const elR = joint(shR, 0, -0.30, 0);
  elL.add(limb(0.28, 0.048, armColor));
  elR.add(limb(0.28, 0.048, armColor));
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.058, 6, 5), skinMat);
  handL.position.y = -0.29;
  elL.add(handL);
  const handR = handL.clone();
  elR.add(handR);
  // sleeve caps
  const slvL = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.14, 6), shirtMat);
  slvL.position.y = -0.05;
  shL.add(slvL);
  const slvR = slvL.clone();
  shR.add(slvR);

  // legs
  const legL = joint(hips, -0.10, -0.08, 0);
  const legR = joint(hips, 0.10, -0.08, 0);
  legL.add(limb(0.40, 0.075, p.pants));
  legR.add(limb(0.40, 0.075, p.pants));
  const kneeL = joint(legL, 0, -0.40, 0);
  const kneeR = joint(legR, 0, -0.40, 0);
  kneeL.add(limb(0.38, 0.062, p.pants));
  kneeR.add(limb(0.38, 0.062, p.pants));
  const shoeMat = mat(0x3a2a1e);
  for (const [k] of [[kneeL], [kneeR]]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.20), shoeMat);
    shoe.position.set(0, -0.38, 0.04);
    k.add(shoe);
  }

  const J = { hips, spine, neck, shL, shR, elL, elR, legL, legR, kneeL, kneeR };

  // ------------------------------------------------ pose engine
  let t = Math.random() * 10;
  const tmp = { x: 0, y: 0, z: 0 };
  function setRot(g, x, y, z, k = 1) {
    g.rotation.x = x * k;
    g.rotation.y = y * k;
    g.rotation.z = z * k;
  }

  function update(dt, params = {}) {
    const { mode = 'idle', phase = 0, intensity = 0, steer = 0 } = params;
    t += dt;
    if (mode === 'pole') {
      const s = Math.sin(phase * Math.PI * 2);
      const c = Math.cos(phase * Math.PI * 2);
      const k = 0.45 + 0.55 * Math.min(1, intensity);
      // torso drives forward on the power half, recovers upright
      spine.rotation.x = (0.06 + s * 0.20) * k;
      spine.rotation.y = -0.10 - s * 0.05 + steer * 0.18;
      spine.rotation.z = steer * -0.06;
      hips.position.y = 0.82 + c * 0.018 * k;
      hips.rotation.x = s * 0.04 * k;
      hips.rotation.y = steer * 0.10;
      // oar side is starboard (-X local): right arm leads, left follows
      shR.rotation.x = (-0.55 - s * 0.80) * k;
      shR.rotation.z = -0.55 + c * 0.12 * k;
      elR.rotation.x = (-0.55 + c * 0.35) * k - 0.15;
      shL.rotation.x = (-0.35 - s * 0.55) * k;
      shL.rotation.z = -0.30 + c * 0.08 * k;
      elL.rotation.x = (-0.45 + c * 0.25) * k - 0.1;
      // legs brace, counter to the drive
      legL.rotation.x = (-0.12 - s * 0.10) * k;
      legR.rotation.x = (0.06 + s * 0.08) * k;
      kneeL.rotation.x = (0.22 + c * 0.08) * k;
      kneeR.rotation.x = (0.16 - c * 0.06) * k;
      neck.rotation.x = -spine.rotation.x * 0.45;
      neck.rotation.y = -spine.rotation.y * 0.4;
    } else if (mode === 'sit') {
      hips.position.y = 0.44;
      spine.rotation.x = 0.04 + Math.sin(t * 1.6) * 0.012;
      spine.rotation.y = Math.sin(t * 0.5) * 0.05;
      legL.rotation.x = -1.22;
      legR.rotation.x = -1.22;
      legL.rotation.z = -0.06;
      legR.rotation.z = 0.06;
      kneeL.rotation.x = 1.5;
      kneeR.rotation.x = 1.5;
      shL.rotation.x = -0.5;
      shR.rotation.x = -0.5;
      shL.rotation.z = -0.18;
      shR.rotation.z = 0.18;
      elL.rotation.x = -0.7;
      elR.rotation.x = -0.7;
      neck.rotation.y = Math.sin(t * 0.4) * 0.25;
      neck.rotation.x = Math.sin(t * 0.9) * 0.03;
    } else {
      // idle: breathing + weight shift + looking around
      hips.position.y = 0.82 + Math.sin(t * 1.8) * 0.008;
      hips.rotation.z = Math.sin(t * 0.7) * 0.025;
      hips.rotation.y = Math.sin(t * 0.43) * 0.04;
      spine.rotation.x = 0.03 + Math.sin(t * 1.8) * 0.015;
      spine.rotation.y = Math.sin(t * 0.31) * 0.06;
      shL.rotation.x = -0.14 + Math.sin(t * 1.1) * 0.03;
      shR.rotation.x = -0.14 + Math.sin(t * 1.1 + 0.4) * 0.03;
      shL.rotation.z = -0.10;
      shR.rotation.z = 0.10;
      elL.rotation.x = -0.22;
      elR.rotation.x = -0.22;
      legL.rotation.x = 0.02;
      legR.rotation.x = -0.02;
      kneeL.rotation.x = 0.05;
      kneeR.rotation.x = 0.05;
      neck.rotation.y = Math.sin(t * 0.37) * 0.35;
      neck.rotation.x = Math.sin(t * 0.8) * 0.02;
    }
  }

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return { root, joints: J, update };
}
