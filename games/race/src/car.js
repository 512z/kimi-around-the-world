// SELENE GP — procedural open-wheel lunar racers + shared vehicle simulation.
// Player and AI run the exact same CarSim; only the input source differs.

import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, angleWrap, TAU } from './util.js';
import { smoothstep } from './util.js';

export const LIVERIES = [
  { name: 'APEX',  color: 0x34e3ff },
  { name: 'VOLT',  color: 0xa6ff3c },
  { name: 'EMBER', color: 0xff7a30 },
  { name: 'NOVA',  color: 0xff4fd8 },
  { name: 'GHOST', color: 0xcfe9ff },
  { name: 'PULSE', color: 0x9b6bff },
  { name: 'SOL',   color: 0xffcf4a },
  { name: 'RIFT',  color: 0xff455d },
];

// Sculpt a box by warping its vertices in normalized [-0.5, 0.5] space,
// then scaling to (w, h, d). fn(x,y,z) -> {x,y,z} normalized.
function sculptedBox(w, h, d, fn, segW = 4, segD = 6) {
  const g = new THREE.BoxGeometry(1, 1, 1, segW, 2, segD);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = fn(v.x, v.y, v.z);
    p.setXYZ(i, r.x * w, r.y * h, r.z * d);
  }
  g.computeVertexNormals();
  return g;
}

export function makeCarMesh(livery, isPlayer = false) {
  const g = new THREE.Group();
  const acc = new THREE.Color(livery.color);

  // Matte race livery: colorless specular is what washes paint to white under
  // the low sun, so keep metalness near zero, widen roughness, and cap the
  // dielectric F0 with specularIntensity. Color comes from diffuse; sparkle
  // stays in the neon parts.
  const paint = new THREE.MeshPhysicalMaterial({
    color: acc.clone().multiplyScalar(0.42).lerp(new THREE.Color(0x0e1219), 0.5),
    metalness: 0.1, roughness: 0.55, specularIntensity: 0.35,
    clearcoat: 0.18, clearcoatRoughness: 0.45,
    emissive: acc, emissiveIntensity: 0.03, envMapIntensity: 0.16,
  });
  const accent = new THREE.MeshPhysicalMaterial({
    color: acc.clone().multiplyScalar(0.72), metalness: 0.1, roughness: 0.52, specularIntensity: 0.35,
    clearcoat: 0.15, clearcoatRoughness: 0.45,
    emissive: acc, emissiveIntensity: 0.08, envMapIntensity: 0.16,
  });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x07090d, metalness: 0.35, roughness: 0.68, envMapIntensity: 0.22 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.92, metalness: 0.05 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x2f333a, metalness: 0.85, roughness: 0.35 });
  const neon = new THREE.MeshBasicMaterial({ color: acc.clone().multiplyScalar(2.0), toneMapped: false });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1524, metalness: 0.3, roughness: 0.12,
    transparent: true, opacity: 0.5, transmission: 0.0,
    clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.4,
  });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // forward = +Z — modern open-wheel proportions, ~5.4m long
  // --- floor / undertray ---
  add(new THREE.BoxGeometry(1.9, 0.05, 4.9), darkTrim, 0, -0.24, 0.1);
  // --- nose: tapered with raised tip ---
  add(sculptedBox(1.15, 0.34, 2.5, (x, y, z) => {
    const t = z + 0.5;                    // 0 rear → 1 tip
    const sx = 1 - t * (0.62 + 0.1 * t);  // strong forward taper
    const sy = 1 - t * 0.45;
    return { x: x * sx, y: y * sy + t * 0.14, z };
  }), paint, 0, -0.05, 1.95);
  // nose accent band (thin)
  add(sculptedBox(0.16, 0.025, 1.05, (x, y, z) => {
    const t = z + 0.5; const sx = 1 - t * 0.5;
    return { x: x * sx, y, z };
  }), accent, 0, 0.14, 2.35);
  // --- front wing: main plane, two flaps, endplates, pylons ---
  add(new THREE.BoxGeometry(2.55, 0.035, 0.55), paint, 0, -0.21, 2.85);
  add(new THREE.BoxGeometry(2.35, 0.03, 0.3), paint, 0, -0.13, 2.62, -0.12);
  add(new THREE.BoxGeometry(2.1, 0.025, 0.22), paint, 0, -0.06, 2.47, -0.18);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.22, 0.6), darkTrim, 1.27 * s, -0.11, 2.7);
    add(new THREE.BoxGeometry(0.04, 0.05, 0.5), accent, 1.27 * s, 0.02, 2.72);
    add(new THREE.BoxGeometry(0.05, 0.24, 0.3), darkTrim, 0.24 * s, -0.02, 2.52);
  }
  // --- front suspension wishbones ---
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.62, 0.022, 0.05), darkTrim, 0.62 * s, 0.05, 1.62, 0, 0, 0.28 * s);
    add(new THREE.BoxGeometry(0.62, 0.022, 0.05), darkTrim, 0.62 * s, -0.12, 1.68, 0, 0, -0.2 * s);
  }
  // --- monocoque / cockpit tub ---
  add(sculptedBox(1.5, 0.5, 2.2, (x, y, z) => {
    const t = Math.abs(z);
    return { x: x * (1 - t * 0.25), y: y * (1 - t * 0.1), z };
  }), paint, 0, -0.02, 0.35);
  // cockpit surround accent
  add(new THREE.TorusGeometry(0.52, 0.035, 6, 18), accent, 0, 0.3, 0.28, Math.PI / 2, 0, 0);
  // --- sidepods: undercut, sloped ---
  for (const s of [-1, 1]) {
    add(sculptedBox(0.62, 0.46, 1.7, (x, y, z) => {
      const t = y + 0.5;
      const u = z + 0.5;
      return { x: x * (0.7 + 0.3 * t) * (0.88 + 0.12 * u), y: y - (u) * 0.1 * (y > 0 ? 1 : 0), z };
    }), paint, 0.78 * s, -0.09, -0.35);
    // undercut inlet (dark inset)
    add(new THREE.BoxGeometry(0.04, 0.16, 0.4), darkTrim, 1.06 * s, -0.02, 0.35);
    // sidepod accent stripe (thin)
    add(new THREE.BoxGeometry(0.1, 0.02, 1.0), accent, 0.83 * s, 0.16, -0.5);
  }
  // --- engine cover / spine ---
  add(sculptedBox(0.85, 0.62, 1.9, (x, y, z) => {
    const t = 0.5 - z;                  // 0 front → 1 tail
    return { x: x * (1 - t * 0.62), y: y * (1 - t * 0.35), z };
  }), paint, 0, 0.22, -1.25);
  // airbox with dark inlet
  add(new THREE.BoxGeometry(0.34, 0.24, 0.34), paint, 0, 0.56, -0.62);
  add(new THREE.BoxGeometry(0.24, 0.1, 0.06), darkTrim, 0, 0.6, -0.44);
  // shark fin
  add(new THREE.BoxGeometry(0.035, 0.5, 1.05), paint, 0, 0.52, -1.55);
  // --- canopy: low teardrop ---
  const canopy = add(new THREE.SphereGeometry(0.55, 16, 12), glass, 0, 0.34, 0.3);
  canopy.scale.set(0.85, 0.52, 1.5);
  // halo
  add(new THREE.TorusGeometry(0.44, 0.04, 7, 16, Math.PI), darkTrim, 0, 0.52, 0.42, Math.PI * 0.5, 0, 0);
  add(new THREE.BoxGeometry(0.045, 0.32, 0.045), darkTrim, 0, 0.42, 0.82);
  // --- rear wing: main plane, flap, endplates, swan neck ---
  add(new THREE.BoxGeometry(1.95, 0.045, 0.5), paint, 0, 0.88, -2.25, 0.1);
  add(new THREE.BoxGeometry(1.95, 0.035, 0.28), paint, 0, 0.7, -2.12, 0.16);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.52, 0.68), darkTrim, 0.97 * s, 0.72, -2.2);
    add(new THREE.BoxGeometry(0.04, 0.14, 0.6), accent, 0.97 * s, 0.94, -2.2);
  }
  add(new THREE.BoxGeometry(0.1, 0.55, 0.22), darkTrim, 0, 0.5, -2.05);
  // --- diffuser + strakes ---
  add(new THREE.BoxGeometry(1.6, 0.22, 0.55), darkTrim, 0, -0.12, -2.25, 0.35);
  for (const s of [-0.5, 0, 0.5]) add(new THREE.BoxGeometry(0.03, 0.24, 0.4), darkTrim, s * 0.7, -0.1, -2.3, 0.35);
  // brake light bar
  const brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2222, emissiveIntensity: 0.3, toneMapped: false });
  add(new THREE.BoxGeometry(0.7, 0.05, 0.04), brakeLightMat, 0, 0.3, -2.52);
  g.userData.brakeMat = brakeLightMat;
  // beacon on the airbox
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: acc, emissiveIntensity: 3, toneMapped: false });
  add(new THREE.SphereGeometry(0.05, 8, 6), beaconMat, 0, 0.7, -0.62);
  g.userData.beaconMat = beaconMat;
  // headlights
  const headMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdff4ff, emissiveIntensity: 2.5, toneMapped: false });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.14, 0.04, 0.05), headMat, 0.22 * s, 0.02, 3.0, 0, 0.3 * s, 0);
  }
  // wing accent stripe
  const wingGlow = add(new THREE.BoxGeometry(1.5, 0.012, 0.025), neon, 0, 0.905, -2.48, 0.1);
  // --- rear suspension ---
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.6, 0.022, 0.05), darkTrim, 0.6 * s, 0.02, -1.5, 0, 0, 0.24 * s);
    add(new THREE.BoxGeometry(0.6, 0.022, 0.05), darkTrim, 0.6 * s, -0.14, -1.42, 0, 0, -0.18 * s);
  }

  // neon floor edge strips + nose tip line (thin, restrained)
  add(new THREE.BoxGeometry(0.02, 0.025, 3.0), neon, 0.96, -0.21, -0.2);
  add(new THREE.BoxGeometry(0.02, 0.025, 3.0), neon, -0.96, -0.21, -0.2);
  add(new THREE.BoxGeometry(0.22, 0.02, 0.03), neon, 0, 0.06, 3.05);
  const underMat = new THREE.MeshBasicMaterial({ color: acc.clone().multiplyScalar(1.3), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const under = add(new THREE.PlaneGeometry(1.8, 3.2), underMat, 0, -0.27, 0.1, -Math.PI / 2, 0, 0);
  under.castShadow = false;
  g.userData.underglow = under;

  // --- wheels: slick tires, brake discs, thin glowing rim rings ---
  const ringMat = new THREE.MeshBasicMaterial({ color: acc.clone().multiplyScalar(2.0), toneMapped: false });
  const wheels = [];
  const wpos = [[1.16, 1.58, 0.5, 0.42, true], [-1.16, 1.58, 0.5, 0.42, true], [1.19, -1.48, 0.56, 0.5, false], [-1.19, -1.48, 0.56, 0.5, false]];
  for (const [x, z, r, wd, steerable] of wpos) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wd, 20), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wg.add(tire);
    // brake disc
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.52, wd + 0.04, 14), brakeMat);
    disc.rotation.z = Math.PI / 2;
    wg.add(disc);
    // thin glowing rim ring on the outer face
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.015, 0.028, 6, 26), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x > 0 ? wd / 2 + 0.01 : -wd / 2 - 0.01;
    wg.add(ring);
    wg.position.set(x, -0.06 + (r - 0.5), z);
    g.add(wg);
    wheels.push({ group: wg, tire, steerable, baseX: x });
  }
  g.userData.wheels = wheels;

  // thruster flames
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x6f9fd0), transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const flames = [];
  for (const x of [-0.35, 0.35]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 8, 1, true), flameMat.clone());
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.0, -2.62);
    f.castShadow = false;
    g.add(f);
    flames.push(f);
  }
  g.userData.flames = flames;
  g.userData.livery = livery;

  // --- Kimi at the wheel: the mascot orb IS the driver's helmet ---
  const driver = new THREE.Group();
  const orbMat = new THREE.MeshStandardMaterial({
    color: acc, emissive: acc, emissiveIntensity: 0.55, roughness: 0.45, metalness: 0,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), orbMat);
  orb.castShadow = true;
  driver.add(orb);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4,
  });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), eyeMat);
    eye.scale.set(0.05, 0.09, 0.03);
    eye.position.set(s * 0.09, 0.05, 0.242);
    driver.add(eye);
  }
  driver.position.set(0, 0.5, 0.12);
  g.add(driver);
  g.userData.driver = driver;

  return g;
}

export function makeNameTag(text, color) {
  // Hi-res canvas, redrawn once the Geist Mono webfont actually arrives —
  // drawing at boot races the font fetch and bakes the fallback in forever.
  const W = 512, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const accent = '#' + new THREE.Color(color).getHexString();
  const FONT = '500 56px "Geist Mono", ui-monospace, Menlo, monospace';
  const draw = () => {
    c.clearRect(0, 0, W, H);
    c.font = FONT;
    if ('letterSpacing' in c) c.letterSpacing = '9px';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    // thin dark rim instead of a blur shadow — stays crisp over sky and regolith
    c.strokeStyle = 'rgba(4, 8, 14, 0.82)';
    c.lineWidth = 9;
    c.strokeText(text, W / 2, 50);
    c.fillStyle = '#eef5fc';
    c.fillText(text, W / 2, 50);
    // livery tick under the name (same accent grammar as the HUD)
    const w = Math.min(180, 34 + text.length * 15);
    c.fillStyle = accent;
    c.fillRect((W - w) / 2, 97, w, 7);
    tex.needsUpdate = true;
  };
  draw();
  if (document.fonts?.load) {
    document.fonts.load('500 56px "Geist Mono"').then(draw).catch(() => {});
    document.fonts.ready.then(draw).catch(() => {});
  }
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.92, depthTest: false, toneMapped: false }));
  spr.scale.set(5.2, 1.3, 1);
  spr.position.y = 2.1;
  return spr;
}

// ---------------------------------------------------------------------------
// Vehicle simulation — lunar maglev-downforce model.
// ---------------------------------------------------------------------------
const G = 2.6;                 // lunar-ish gravity (m/s²)
const RIDE = 0.58;             // ride height above surface
const ENGINE = 21.0;           // m/s² full throttle
const BOOST = 17.0;            // additional m/s² — boost must feel like a kick
const BRAKE = 36.0;            // m/s²
const DRAG = 0.0026;           // per m/s²  (top speed ≈ 88 m/s ≈ 315 km/h)
const MAGLEV = 0.0042;         // downforce accel per (m/s)² — presses car to road
const AIR_MAGLEV_FADE = 8.0;   // maglev fades with height above surface

const _n = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class CarSim {
  constructor(mesh, opts = {}) {
    this.mesh = mesh;
    this.name = opts.name || 'DRIVER';
    this.isPlayer = !!opts.isPlayer;
    this.color = opts.color || 0xffffff;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawVel = 0;
    this.grounded = true;
    this.airTime = 0;
    this.boost = 0.62;
    this.boosting = false;
    this.turboing = false;
    // power-up state (owned by items.js / game.js)
    this.item = null;      // 'banana' | 'rocket' | 'shield' | 'turbo' | null
    this.shieldT = 0;
    this.turboT = 0;
    this.stunT = 0;
    this.stunSpin = 0;
    this.shieldMesh = null;
    this.wheelRot = 0;
    this.steerViz = 0;
    this.pitch = 0; this.roll = 0;
    this.visualPitch = 0; this.visualRoll = 0;
    this.slip = 0;               // 0..1 drift amount
    this.offroad = 0;            // 0..1
    this.impact = 0;             // landing impact pulse
    this.boostFlash = 0;
    this.disabled = false;       // locked during countdown

    // race state (owned by game.js but kept here for convenience)
    this.lap = 0;
    this.s = 0;                  // arc-length progress on centerline
    this.lastS = 0;
    this.cpIndex = 0;            // next checkpoint
    this.lapTimes = [];
    this.lapStart = 0;
    this.finished = false;
    this.finishTime = 0;
    this.totalDist = 0;          // lap*L + s for standings
    this.padCooldown = -1;
    this.respawnTimer = 0;
    this.stuckTimer = 0;
    this.throttleViz = 0;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get speedKmh() { return Math.hypot(this.vel.x, this.vel.y, this.vel.z) * 3.6; }

  // Seat the car on the actual surface. frame.y is the CENTERLINE height —
  // on banked road a laterally-offset grid slot differs by lat·tan(bank), so
  // when a terrain is provided we sample the real ground under the car and
  // pre-tilt the body to the surface normal (countdown runs no physics).
  placeAt(frame, s, terrain = null) {
    const y = terrain ? terrain.sampleHeight(frame.x, frame.z) + RIDE : frame.y + RIDE;
    this.pos.set(frame.x, y, frame.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(frame.tx, frame.tz);
    this.yawVel = 0;
    this.grounded = true;
    this.airTime = 0;
    this.s = s;
    this.lastS = s;
    if (terrain) {
      const nrm = terrain.sampleNormal(frame.x, frame.z, _n);
      const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
      const rightX = fwdZ, rightZ = -fwdX;
      this.visualPitch = Math.asin(clamp(nrm.x * fwdX + nrm.z * fwdZ, -0.7, 0.7));
      this.visualRoll = -Math.asin(clamp(nrm.x * rightX + nrm.z * rightZ, -0.7, 0.7));
    }
  }

  resetToTrack(env) {
    const near = env.track.nearestS(this.pos.x, this.pos.z);
    const sBack = (near.s - 6 + env.track.length) % env.track.length;
    const f = env.track.frameAt(sBack);
    this.placeAt(f, sBack, env.terrain);
    this.boost = Math.max(this.boost, 0.3);
  }

  step(input, dt, env) {
    if (this.disabled) input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    this.braking = input.brake > 0 && this.speed > 2;
    // timer bookkeeping
    this.turboT = Math.max(0, this.turboT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.turboing = this.turboT > 0;
    let stunned = false;
    if (this.stunT > 0) {
      this.stunT -= dt;
      stunned = true;
      input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
    }
    const terrain = env.terrain, track = env.track;
    const groundH = terrain.sampleHeight(this.pos.x, this.pos.z);
    const heightAbove = this.pos.y - groundH - RIDE;

    // surface info
    const near = track.nearestS(this.pos.x, this.pos.z);
    const hw = near.frame.hw;
    this.offroad = smoothstep(hw - 1.5, hw + 13, near.dist);
    const gripMul = lerp(1.0, 0.65, this.offroad);
    this.s = near.s;

    const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let vx = this.vel.x, vz = this.vel.z;
    const speed = Math.hypot(vx, vz);

    // --- vertical: gravity + speed-scaled maglev downforce ---------------
    // Maglev holds the car onto steep ramps and walls; it releases only at
    // genuine crests (ground curvature demand > gravity), so the rim-crest
    // launch goes ballistic while dives and ramp climbs stay pinned.
    const fwdx0 = Math.sin(this.yaw), fwdz0 = Math.cos(this.yaw);
    const laG = clamp(speed * 0.12, 5, 11);
    const hBack = terrain.sampleHeight(this.pos.x - fwdx0 * laG, this.pos.z - fwdz0 * laG);
    const hFwd = terrain.sampleHeight(this.pos.x + fwdx0 * laG, this.pos.z + fwdz0 * laG);
    const curv = (hBack - 2 * groundH + hFwd) / (laG * laG); // >0 = crest
    const demand = speed * speed * Math.max(0, curv);
    const release = 1 - smoothstep(G * 0.85, G + MAGLEV * speed * speed * 0.5, demand);
    const maglev = Math.exp(-Math.max(0, heightAbove) / AIR_MAGLEV_FADE) * MAGLEV * speed * speed * release;
    this.vel.y -= (G + maglev) * dt;

    // ground contact (penetration response)
    if (heightAbove <= 0) {
      const n = terrain.sampleNormal(this.pos.x, this.pos.z, _n);
      // separate
      this.pos.y = groundH + RIDE;
      const velN = this.vel.x * n.x + this.vel.y * n.y + this.vel.z * n.z;
      if (velN < 0) {
        const impact = -velN;
        this.vel.x -= velN * n.x;
        this.vel.y -= velN * n.y;
        this.vel.z -= velN * n.z;
        if (impact > 7) this.impact = Math.min(1, (impact - 7) / 14);
      }
      // wall-hit window: the rail/boulder push-out can wedge the car against
      // rising ground; the projection above then pumps +vy every frame — cap
      // it so a wall stop never becomes a launch
      if (this._wallHitT > 0) this.vel.y = Math.min(this.vel.y, 4);
      if (!this.grounded && this.airTime > 0.25) this.impact = Math.max(this.impact, Math.min(0.6, this.airTime * 0.25));
      this.grounded = true;
      this.airTime = 0;
    } else if (heightAbove > 0.35) {
      this.grounded = false;
      this.airTime += dt;
    } else {
      // maglev hover gap — treat as grounded, keep airTime frozen
      this.grounded = true;
    }

    vx = this.vel.x; vz = this.vel.z;
    const sp = Math.hypot(vx, vz) || 1e-5;

    if (this.grounded) {
      // --- steering: body yaw ---
      const aLatMax = (G + MAGLEV * sp * sp) * 1.3 * gripMul;
      const yawMax = clamp(aLatMax / Math.max(sp, 6), 0.42, input.handbrake ? 2.6 : 1.75);
      // reversing flips the yaw response (real-car reverse steering) and gets
      // a calmer rate — backing out of a wall must be controllable
      const fwdSpeed0 = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
      const revK = fwdSpeed0 < -0.5 ? -0.8 : 1.0;
      // high-speed authority taper lives in the TARGET so damping reaches it
      let desiredYaw = input.steer * revK * yawMax * (input.handbrake ? 1.35 : 1.0) * (1 - clamp01(sp / 240) * 0.25);
      if (stunned) desiredYaw = this.stunSpin; // spun out: wild rotation, no authority
      // steering input is analog-ramped upstream, so yaw can track it tightly
      this.yawVel = damp(this.yawVel, desiredYaw, input.handbrake ? 7.0 : 13.0, dt);
      this.yaw = angleWrap(this.yaw + this.yawVel * dt);

      // --- longitudinal forces along body forward ---
      fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const fwdSpeed = vx * fwd.x + vz * fwd.z;
      let accel = 0;
      if (input.throttle > 0) accel += ENGINE * input.throttle;
      if (this.turboing) accel += 26; // power-up turbo: free thrust, no meter
      this.boosting = false;
      if (input.boost && this.boost > 0.01 && input.throttle > 0) {
        accel += BOOST;
        this.boost = Math.max(0, this.boost - 0.32 * dt);
        this.boosting = true;
      }
      if (stunned) accel -= 8; // spin-out scrubs speed
      if (input.brake > 0 && fwdSpeed > -13) accel -= BRAKE * input.brake * (fwdSpeed > 0 ? 1 : 0.75);
      accel -= DRAG * fwdSpeed * Math.abs(fwdSpeed);
      accel -= fwdSpeed * lerp(0.05, 0.55, this.offroad); // regolith drag
      this.vel.x += fwd.x * accel * dt;
      this.vel.z += fwd.z * accel * dt;

      // --- lateral: grip rotates velocity toward body heading ---
      vx = this.vel.x; vz = this.vel.z;
      const vAng = Math.atan2(vx, vz);
      let diff = angleWrap(this.yaw - vAng);
      // reversing: grip must align velocity to the REAR axis, not spin the
      // car's motion around toward the nose (that made backing out impossible)
      if (Math.abs(diff) > Math.PI / 2) diff = angleWrap(diff - Math.PI);
      const gripRate = (aLatMax / Math.max(sp, 6)) * (input.handbrake ? 0.24 : 1.0) * lerp(1, 0.45, this.offroad);
      const rot = clamp(diff, -gripRate * dt, gripRate * dt);
      const cos = Math.cos(rot), sin = Math.sin(rot);
      this.vel.x = vx * cos + vz * sin;
      this.vel.z = -vx * sin + vz * cos;
      this.slip = damp(this.slip, clamp01(Math.abs(diff) * 2.2), 6, dt);

      // regolith bumpiness
      if (this.offroad > 0.15 && sp > 12) {
        const b = (Math.sin(this.pos.x * 0.9) + Math.cos(this.pos.z * 1.1)) * 0.5;
        this.vel.y += b * this.offroad * clamp01(sp / 60) * 3.5 * dt;
      }
    } else {
      // airborne: floaty, minimal authority (stunned cars keep their spin)
      this.yawVel = damp(this.yawVel, stunned ? this.stunSpin : input.steer * 0.55, 0.9, dt);
      this.yaw = angleWrap(this.yaw + this.yawVel * dt);
      this.vel.x -= this.vel.x * 0.02 * dt;
      this.vel.z -= this.vel.z * 0.02 * dt;
      this.slip = damp(this.slip, 0, 1.5, dt);
    }

    // boulder collisions
    const nearby = terrain.bouldersNear(this.pos.x, this.pos.z, 3, CarSim._bs || (CarSim._bs = []));
    for (let i = 0; i < nearby.length; i++) {
      const b = nearby[i];
      const dx = this.pos.x - b.x, dz = this.pos.z - b.z;
      const d = Math.hypot(dx, dz);
      const minD = b.r * 0.82 + 1.15;
      if (d < minD && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        this.pos.x = b.x + nx * minD;
        this.pos.z = b.z + nz * minD;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= vn * 1.35 * nx;
          this.vel.z -= vn * 1.35 * nz;
          // climbing a slope carries big +vy; a hard wall stop must kill it
          // with the forward motion or the car sails off into lunar orbit
          if (-vn > 3) {
            if (this.vel.y > 0) this.vel.y = Math.min(this.vel.y * clamp(1 - (-vn - 3) / 9, 0.1, 1), 4);
            this._wallHitT = 0.3;
          }
          this.impact = Math.max(this.impact, Math.min(1, -vn / 22));
        }
      }
    }

    // integrate position
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // corridor guardrails — the 边栏 barriers are solid: slide along, never leave.
    // The wall face sits at hw+1.6 and the car is ~1.5m from center to tire
    // edge, so the CENTER must stop at hw-0.1 or the bodywork clips the rail.
    if (Math.abs(near.dSigned) > near.frame.hw - 8) {
      const rail = track.nearestS(this.pos.x, this.pos.z);
      const lim = rail.frame.hw - 0.1;
      if (Math.abs(rail.dSigned) > lim) {
        const side = Math.sign(rail.dSigned);
        const rx = rail.frame.rx * side, rz = rail.frame.rz * side;
        const excess = Math.abs(rail.dSigned) - lim;
        this.pos.x -= rx * excess;
        this.pos.z -= rz * excess;
        const vOut = this.vel.x * rx + this.vel.z * rz;
        // the rail is NOT frictionless: grinding along it scrubs speed, hard
        // contact scrubs more. Without this a car could ride the rail up the
        // big climb at full speed and launch off the crest.
        this._railTouchT = 0.6;
        const grind = 1 - Math.exp(-(0.5 + Math.max(0, vOut) * 0.15) * dt);
        this.vel.x -= this.vel.x * grind;
        this.vel.z -= this.vel.z * grind;
        if (vOut > 0) {
          this.vel.x -= rx * vOut * 1.35;
          this.vel.z -= rz * vOut * 1.35;
          this.impact = Math.max(this.impact, Math.min(0.7, vOut / 22));
          if (vOut > 4) this.railScrape = 0.35;
          // a rail hit while climbing must eat the climb's vertical momentum
          // too, or the car launches skyward
          if (vOut > 3) {
            if (this.vel.y > 0) this.vel.y = Math.min(this.vel.y * clamp(1 - (vOut - 3) / 9, 0.1, 1), 4);
            this._wallHitT = 0.3;
          }
        }
      }
    }
    this.railScrape = Math.max(0, (this.railScrape || 0) - dt);
    this._wallHitT = Math.max(0, (this._wallHitT || 0) - dt);
    // while touching (or just off) the rail, vertical momentum is capped, and
    // the car is actively reeled back onto the surface: rail grinding scrubs
    // speed, which collapses the speed² maglev on the banked wall — without
    // this suction the car separates and glides high off the bank ("撞栏起飞")
    if (this._railTouchT > 0) {
      this._railTouchT -= dt;
      this.vel.y = Math.min(this.vel.y, 5);
      const above = this.pos.y - (terrain.sampleHeight(this.pos.x, this.pos.z) + RIDE);
      if (above > 0.05) this.vel.y -= 40 * dt;
    }

    // world bounds
    const lim = 3950;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = clamp(this.pos.x, -lim, lim); this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = clamp(this.pos.z, -lim, lim); this.vel.z *= -0.3; }

    // hard safety clamps
    if (!isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.z)) {
      this.resetToTrack(env);
    }
    const vmax = 170;
    const vv = Math.hypot(this.vel.x, this.vel.z);
    if (vv > vmax) { const k = vmax / vv; this.vel.x *= k; this.vel.z *= k; }

    // --- visual state ---
    this.steerViz = damp(this.steerViz, input.steer, 12, dt);
    this.throttleViz = damp(this.throttleViz, input.throttle, 8, dt);
    this.wheelRot += (vx * fwd.x + vz * fwd.z) * dt / 0.52;
    this.impact = Math.max(0, this.impact - dt * 2.2);
    this.boostFlash = Math.max(0, this.boostFlash - dt * 2);

    // body attitude from surface normal
    if (this.grounded) {
      // chord attitude: sample where the axles actually sit — the point
      // normal lagged behind grade breaks at speed and the nose clipped in
      const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
      const rightX = fwdZ, rightZ = -fwdX;
      const WB = 1.9, TW = 0.85;
      const hF = terrain.sampleHeight(this.pos.x + fwdX * WB, this.pos.z + fwdZ * WB);
      const hB = terrain.sampleHeight(this.pos.x - fwdX * WB, this.pos.z - fwdZ * WB);
      const hR = terrain.sampleHeight(this.pos.x + rightX * TW, this.pos.z + rightZ * TW);
      const hL = terrain.sampleHeight(this.pos.x - rightX * TW, this.pos.z - rightZ * TW);
      const targetPitch = clamp(-Math.atan2(hF - hB, 2 * WB), -0.75, 0.75);
      const targetRoll = clamp(Math.atan2(hR - hL, 2 * TW), -0.75, 0.75);
      this.visualPitch = damp(this.visualPitch, targetPitch, 16, dt);
      this.visualRoll = damp(this.visualRoll, targetRoll, 16, dt);
    } else {
      this.visualPitch = damp(this.visualPitch, clamp(this.vel.y * 0.02, -0.3, 0.3), 1.2, dt);
      this.visualRoll = damp(this.visualRoll, 0, 1.2, dt);
    }

    // stuck detection (for auto-recovery / AI)
    if (sp < 1.5 && input.throttle > 0.5) this.stuckTimer += dt; else this.stuckTimer = 0;
  }

  // copy state into the render mesh
  syncMesh(dt, elapsed) {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.set(0, this.yaw, 0);
    m.rotateX(this.visualPitch);
    m.rotateZ(this.visualRoll);
    const wheels = m.userData.wheels;
    for (const w of wheels) {
      w.tire.rotation.x = this.wheelRot;
      w.tire.rotation.z = Math.PI / 2;
      if (w.steerable) w.group.rotation.y = this.steerViz * 0.5;
    }
    const flames = m.userData.flames;
    const boostK = (this.boosting || this.turboing) ? 1.5 : 1.0;
    const flick = 0.75 + 0.25 * Math.sin(elapsed * 47.0 + this.pos.x);
    const flameScale = (0.08 + this.throttleViz * 0.42 + (this.turboing ? 0.25 : 0)) * boostK * flick;
    for (const f of flames) {
      f.scale.set(1, Math.max(0.04, flameScale), 1);
      f.material.opacity = clamp01(0.1 + this.throttleViz * 0.55 + (this.turboing ? 0.2 : 0)) * ((this.boosting || this.turboing) ? 1 : 0.75);
      f.material.color.set(this.turboing ? 0x9ffff0 : this.boosting ? 0x8fc8ff : 0x6f9fd0).multiplyScalar((this.boosting || this.turboing) ? 1.15 : 0.8);
    }
    const drv = m.userData.driver;
    if (drv) {
      drv.rotation.z = -this.steerViz * 0.35;   // leans into the corner
      drv.rotation.x = this.visualPitch * 0.3;
      drv.position.y = 0.5 + Math.sin(elapsed * 2.2 + this.pos.x) * 0.008;
    }
    const ug = m.userData.underglow;
    if (ug) ug.material.opacity = (0.1 + this.throttleViz * 0.1) * (this.grounded ? 1 : 0.4) + (this.boosting ? 0.12 : 0) + (this.turboing ? 0.18 : 0);
    if (m.userData.brakeMat) m.userData.brakeMat.emissiveIntensity = this.braking ? 3.0 : 0.3;
    if (m.userData.beaconMat) m.userData.beaconMat.emissiveIntensity = 1.5 + Math.abs(Math.sin(elapsed * 5)) * 2.5;
    if (this.shieldMesh) {
      this.shieldMesh.visible = this.shieldT > 0;
      if (this.shieldMesh.visible) {
        const pulse = 0.25 + 0.12 * Math.sin(elapsed * 6) + (this.shieldT < 1 ? 0.15 * Math.sin(elapsed * 22) : 0);
        this.shieldMesh.material.opacity = Math.max(0.06, pulse);
      }
    }
  }
}
