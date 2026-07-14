// The base: habitats, domes, towers, solar field, pad, rovers, drones, arm,
// astronauts, equipment, ground lighting, tracks and dust.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';
import {
  makePanelTextures, makeSolarTexture, makeContainerTexture, makePadTexture,
  makeSoftSprite,
} from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

function cylBetween(a, b, r, radial = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function groundY(x, z) { return heightAt(x, z); }

export function createBase() {
  const group = new THREE.Group();
  const updaters = [];

  // ------------------------------------------------------------ materials
  const panelTex = makePanelTextures();
  panelTex.map.repeat.set(1, 2);
  panelTex.emissiveMap.repeat.set(1, 1);
  panelTex.map.wrapS = panelTex.map.wrapT = THREE.RepeatWrapping;
  panelTex.emissiveMap.wrapS = panelTex.emissiveMap.wrapT = THREE.RepeatWrapping;

  const hullMat = new THREE.MeshStandardMaterial({
    map: panelTex.map, emissiveMap: panelTex.emissiveMap, emissive: 0xffffff,
    emissiveIntensity: 2.4, metalness: 0.55, roughness: 0.5, color: 0xb9bec6,
  });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9ba0a8, metalness: 0.6, roughness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.7, roughness: 0.4 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc4, metalness: 0.3, roughness: 0.6 });
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x868b92, metalness: 0.8, roughness: 0.35 });
  const regoMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1, metalness: 0 });
  const solarMat = new THREE.MeshStandardMaterial({
    map: makeSolarTexture(), color: 0x8899bb, metalness: 0.75, roughness: 0.18,
    emissive: 0x0a1838, emissiveIntensity: 0.35,
  });
  const suitMat = new THREE.MeshStandardMaterial({ color: 0xc6c2b8, metalness: 0.1, roughness: 0.75 });
  const suitDarkMat = new THREE.MeshStandardMaterial({ color: 0x9a968c, metalness: 0.2, roughness: 0.7 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x6e5314, metalness: 1.0, roughness: 0.12, emissive: 0x140d02, emissiveIntensity: 0.6,
  });
  const ledRed = () => new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2200, emissiveIntensity: 3 });
  const ledGreen = () => new THREE.MeshStandardMaterial({ color: 0x003000, emissive: 0x22ff66, emissiveIntensity: 3 });
  const ledWarm = () => new THREE.MeshStandardMaterial({ color: 0x201408, emissive: 0xffb060, emissiveIntensity: 3 });

  function add(mesh, cast = true, receive = true) {
    mesh.castShadow = cast; mesh.receiveShadow = receive; group.add(mesh); return mesh;
  }

  // ------------------------------------------------------------ habitat module
  function makeModule({ x, z, axis = 'x', legs = false, bury = 0, L = 20, R = 6 }) {
    const g = new THREE.Group();
    const y0 = groundY(x, z);
    const legH = legs ? 2.8 : 0.2;
    const cy = y0 + legH + R - bury;

    const bodyGeo = new THREE.CylinderGeometry(R, R, L, 40, 1, false);
    const body = new THREE.Mesh(bodyGeo, [hullMat, capMat, capMat]);
    if (axis === 'x') body.rotation.z = Math.PI / 2;
    else body.rotation.x = Math.PI / 2;
    body.position.y = cy;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // ringed end caps
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.35, 10, 40), trussMat);
      ring.position.y = cy;
      if (axis === 'x') { ring.rotation.y = Math.PI / 2; ring.position.x = s * L / 2; }
      else { ring.position.z = s * L / 2; }
      ring.castShadow = true;
      g.add(ring);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.98, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      cap.position.y = cy;
      cap.scale.set(1, 0.35, 1); // shallow dome, not a ball
      if (axis === 'x') { cap.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; cap.position.x = s * L / 2; }
      else { cap.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2; cap.position.z = s * L / 2; }
      cap.castShadow = true;
      g.add(cap);
      // docking hatch on the cap pole
      const hatch = new THREE.Group();
      hatch.add(new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.14, 8, 20), darkMat));
      hatch.add(new THREE.Mesh(new THREE.CircleGeometry(1.25, 20),
        new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })));
      hatch.position.y = cy;
      const off = s * (L / 2 + R * 0.36);
      if (axis === 'x') { hatch.rotation.y = Math.PI / 2; hatch.position.x = off; }
      else { hatch.position.z = off; }
      g.add(hatch);
    }

    // legs or berm
    if (legs) {
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const lx = x + (axis === 'x' ? sx * L * 0.38 : sx * R * 0.7);
        const lz = z + (axis === 'x' ? sz * R * 0.7 : sz * L * 0.38);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, legH + R * 0.6, 8), darkMat);
        leg.position.set(lx, groundY(lx, lz) + (legH + R * 0.6) / 2 - 0.2, lz);
        leg.castShadow = true;
        g.add(leg);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.3, 10), darkMat);
        foot.position.set(lx, groundY(lx, lz) + 0.15, lz);
        g.add(foot);
      }
    } else {
      const berm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.7 + bury, 24, 12), regoMat);
      berm.scale.set(1, 0.34, 1);
      berm.position.set(x, y0 + 0.4, z);
      berm.receiveShadow = true;
      g.add(berm);
    }

    g.position.set(x, 0, z);
    group.add(g);
    return { group: g, x, z, cy, L, R, axis };
  }

  // ------------------------------------------------------------ tunnel
  function makeTunnel(a, b) {
    const A = new THREE.Vector3(a.x, groundY(a.x, a.z) + 2.6, a.z);
    const B = new THREE.Vector3(b.x, groundY(b.x, b.z) + 2.6, b.z);
    const mid = A.clone().lerp(B, 0.5);
    mid.y = Math.max(A.y, B.y) - 0.6;
    const pts = [A, mid, B];
    for (let i = 0; i < pts.length - 1; i++) {
      const geo = cylBetween(pts[i], pts[i + 1], 1.9, 16);
      const m = new THREE.Mesh(geo, hullMat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
  }

  // ------------------------------------------------------------ observation dome
  function makeDome(x, z, r) {
    const y0 = groundY(x, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.1, 1.6, 32), capMat);
    base.position.set(x, y0 + 0.8, z);
    base.castShadow = true; base.receiveShadow = true;
    group.add(base);

    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fc0e0, metalness: 0, roughness: 0.06, transmission: 0.92,
        thickness: 1.5, ior: 1.3, transparent: true, opacity: 1,
        side: THREE.DoubleSide, clearcoat: 0.6, clearcoatRoughness: 0.1,
      })
    );
    glass.position.set(x, y0 + 1.6, z);
    group.add(glass);

    // fresnel rim shell
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.015, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
            gl_FragColor = vec4(vec3(0.45, 0.68, 1.0) * f * 1.2, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    shell.position.copy(glass.position);
    group.add(shell);

    // warm interior: emissive racks + glowing floor ring + light spill
    const interior = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.82, 24, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x402810, emissive: 0xff9040, emissiveIntensity: 1.4, side: THREE.BackSide })
    );
    interior.position.set(x, y0 + 1.2, z);
    group.add(interior);
    for (let i = 0; i < 3; i++) {
      const rack = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.6, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x202830, emissive: 0x66ffaa, emissiveIntensity: 1.6 })
      );
      const a = i * 2.1;
      rack.position.set(x + Math.cos(a) * r * 0.4, y0 + 2.4, z + Math.sin(a) * r * 0.4);
      group.add(rack);
    }
    const light = new THREE.PointLight(0xffa050, 16, 30, 2);
    light.position.set(x, y0 + 3.2, z);
    group.add(light);
  }

  // ------------------------------------------------------------ airlock
  function makeAirlock(x, z, rotY) {
    const y0 = groundY(x, z);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.9, 2.4), whiteMat);
    box.position.y = y0 + 1.45;
    box.castShadow = true; box.receiveShadow = true;
    g.add(box);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.25), darkMat);
    door.position.set(0, y0 + 1.2, 1.3);
    g.add(door);
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), ledRed());
    r.position.set(1.0, y0 + 2.4, 1.3);
    const gr = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), ledGreen());
    gr.position.set(0.65, y0 + 2.4, 1.3);
    g.add(r, gr);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
    updaters.push((t) => {
      r.material.emissiveIntensity = (Math.sin(t * 3.0) > 0) ? 3.5 : 0.25;
      gr.material.emissiveIntensity = (Math.sin(t * 3.0) > 0) ? 0.25 : 3.5;
    });
  }

  // ------------------------------------------------------------ comm tower + radar
  function makeTower(x, z, h, { scan = false, speed = 0.5 } = {}) {
    const y0 = groundY(x, z);
    const geos = [];
    const levels = 9;
    const corner = (i, sx, sz) => {
      const k = i / levels;
      const half = 2.4 + (0.75 - 2.4) * k;
      return new THREE.Vector3(x + sx * half, y0 + h * k, z + sz * half);
    };
    for (let i = 0; i < levels; i++) {
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        geos.push(cylBetween(corner(i, sx, sz), corner(i + 1, sx, sz), 0.13));
      }
      // zigzag braces
      const sides = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
      for (const [c0, c1] of sides) {
        geos.push(cylBetween(corner(i, c0[0], c0[1]), corner(i + 1, c1[0], c1[1]), 0.07));
        geos.push(cylBetween(corner(i, c1[0], c1[1]), corner(i + 1, c0[0], c0[1]), 0.07));
      }
    }
    const tower = new THREE.Mesh(mergeGeometries(geos), trussMat);
    tower.castShadow = true; tower.receiveShadow = true;
    group.add(tower);

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 12), darkMat);
    deck.position.set(x, y0 + h + 0.2, z);
    deck.castShadow = true;
    group.add(deck);

    // blinking beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), ledRed());
    beacon.position.set(x, y0 + h + 0.9, z);
    group.add(beacon);
    updaters.push((t) => { beacon.material.emissiveIntensity = (t % 1.4 < 0.18) ? 5 : 0.15; });

    // radar dish on yoke
    const yoke = new THREE.Group();
    yoke.position.set(x, y0 + h + 1.6, z);
    const pts = [];
    for (let i = 0; i <= 14; i++) { const r = i / 14 * 3.0; pts.push(new THREE.Vector2(r, r * r * 0.16)); }
    const dishGeo = new THREE.LatheGeometry(pts, 28);
    const dish = new THREE.Mesh(dishGeo, new THREE.MeshStandardMaterial({
      color: 0xcfd4da, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide,
    }));
    dish.castShadow = true;
    const mount = new THREE.Group();
    mount.rotation.x = -Math.PI / 2 + 0.6; // point up at ~34 deg elevation
    mount.add(dish);
    // feed horn
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.5, 6), darkMat);
    feed.position.set(0, 0.75, 0);
    const feedTip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), darkMat);
    feedTip.position.set(0, 1.5, 0);
    dish.add(feed, feedTip);
    yoke.add(mount);
    group.add(yoke);
    updaters.push((t) => {
      yoke.rotation.y = scan ? Math.sin(t * speed) * 1.2 : t * speed;
    });
  }

  // ------------------------------------------------------------ solar field
  function makeSolarField(cx, z0) {
    const pivots = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const x = cx + (col - 2.5) * 13;
        const z = z0 + (row - 1) * 16;
        const y0 = groundY(x, z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 3.6, 8), trussMat);
        pole.position.set(x, y0 + 1.8, z);
        pole.castShadow = true;
        group.add(pole);
        const pivot = new THREE.Group();
        pivot.position.set(x, y0 + 3.6, z);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.25, 7.6), darkMat);
        frame.castShadow = true;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 7.2), solarMat);
        panel.position.y = 0.16;
        panel.castShadow = true;
        pivot.add(frame, panel);
        pivot.rotation.x = 0.5;
        pivot.rotation.y = 0.69;
        group.add(pivot);
        pivots.push(pivot);
      }
    }
    updaters.push((t) => {
      const tilt = 0.5 + Math.sin(t * 0.05) * 0.1; // slow sun tracking
      for (const p of pivots) p.rotation.x = tilt;
    });
  }

  // ------------------------------------------------------------ landing pad
  function makePad(x, z, r) {
    const y0 = groundY(x, z);
    const padTex = makePadTexture();
    const side = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.85, metalness: 0.1 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8, 48), [side, top, side]);
    pad.position.set(x, y0 + 0.4, z);
    pad.receiveShadow = true; pad.castShadow = true;
    group.add(pad);

    const lights = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = ledWarm();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), m);
      b.position.set(x + Math.cos(a) * (r - 0.6), y0 + 0.95, z + Math.sin(a) * (r - 0.6));
      group.add(b);
      lights.push(m);
    }
    updaters.push((t) => {
      const head = (t * 3) % n;
      for (let i = 0; i < n; i++) {
        const d = (i - head + n) % n;
        lights[i].emissiveIntensity = d < 1 ? 4 : 0.5;
      }
    });
  }

  // ------------------------------------------------------------ containers
  function makeContainers(x, z) {
    const tex = makeContainerTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.55, color: 0xb0b4ba });
    const spots = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [2.8, 0, 0.4], [2.8, 1, 0.4], [-2.8, 0, -0.3]];
    for (const [dx, dy, dz] of spots) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), mat);
      const px = x + dx, pz = z + dz;
      c.position.set(px, groundY(px, pz) + 1.2 + dy * 2.45, pz);
      c.rotation.y = 0.15;
      c.castShadow = true; c.receiveShadow = true;
      group.add(c);
    }
  }

  // ------------------------------------------------------------ lander
  function makeLander(x, z) {
    const y0 = groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y0, z);
    g.rotation.y = 0.7;
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc29a3e, metalness: 0.95, roughness: 0.3 });
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 2.4, 8), goldMat);
    lower.position.y = 3.6; lower.castShadow = true; lower.receiveShadow = true;
    g.add(lower);
    const landerWhite = new THREE.MeshStandardMaterial({ color: 0xb6bac0, metalness: 0.3, roughness: 0.6 });
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 2.8, 8), landerWhite);
    upper.position.y = 6.2; upper.castShadow = true;
    g.add(upper);
    // crew windows (emissive)
    for (const a of [-0.5, 0.5]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0x88bbff, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.2 }));
      win.position.set(Math.sin(a) * 1.75, 6.6, Math.cos(a) * 1.75);
      win.rotation.y = a;
      g.add(win);
    }
    // docking port + top antenna
    const dock = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.7, 10), capMat);
    dock.position.y = 7.9; g.add(dock);
    const antMast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 6), trussMat);
    antMast.position.y = 8.9; g.add(antMast);
    const dpts = [];
    for (let k = 0; k <= 6; k++) { const r = k / 6 * 0.75; dpts.push(new THREE.Vector2(r, r * r * 0.25)); }
    const ant = new THREE.Mesh(new THREE.LatheGeometry(dpts, 14), whiteMat);
    ant.position.y = 9.6; ant.rotation.x = -0.9;
    g.add(ant);
    // engine bell
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.95, 1.1, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide }));
    bell.position.y = 2.0; g.add(bell);
    // legs + struts + footpads + ladder
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const cx = Math.cos(a), sz = Math.sin(a);
      const top = new THREE.Vector3(cx * 1.9, 3.4, sz * 1.9);
      const foot = new THREE.Vector3(cx * 3.7, 0.25, sz * 3.7);
      const leg = new THREE.Mesh(cylBetween(top, foot, 0.14), trussMat);
      leg.castShadow = true; g.add(leg);
      const strut = new THREE.Mesh(cylBetween(new THREE.Vector3(cx * 1.2, 2.6, sz * 1.2), foot, 0.07), trussMat);
      g.add(strut);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.22, 10), darkMat);
      pad.position.copy(foot); pad.castShadow = true; pad.receiveShadow = true;
      g.add(pad);
      if (i === 0) {
        // ladder
        for (let r = 0; r < 6; r++) {
          const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5), trussMat);
          rung.rotation.z = Math.PI / 2;
          rung.position.set(cx * (2.1 + r * 0.28), 3.1 - r * 0.45, sz * (2.1 + r * 0.28));
          g.add(rung);
        }
      }
    }
    group.add(g);
  }

  // ------------------------------------------------------------ propellant tanks
  function makeTankCluster(x, z) {
    for (let i = 0; i < 3; i++) {
      const px = x + (i - 1) * 5.6;
      const y0 = groundY(px, z);
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 3.4), darkMat);
      cradle.position.set(px, y0 + 0.4, z);
      cradle.castShadow = true; cradle.receiveShadow = true;
      group.add(cradle);
      const tank = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 18), whiteMat);
      tank.position.set(px, y0 + 2.9, z);
      tank.castShadow = true;
      group.add(tank);
      const band = new THREE.Mesh(new THREE.TorusGeometry(2.21, 0.09, 8, 32), darkMat);
      band.rotation.x = Math.PI / 2;
      band.position.copy(tank.position);
      group.add(band);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), trussMat);
      cap.position.set(px, y0 + 5.2, z);
      group.add(cap);
    }
    // pipe run to modules
    const pipe = new THREE.Mesh(cylBetween(
      new THREE.Vector3(x - 5.6, groundY(x - 5.6, z) + 0.5, z),
      new THREE.Vector3(36, groundY(36, -32) + 0.5, -32), 0.16), trussMat);
    group.add(pipe);
  }

  // ------------------------------------------------------------ floodlight pole
  function makeFloodlight(x, z, aimY = 0) {
    const y0 = groundY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9, 8), trussMat);
    pole.position.set(x, y0 + 4.5, z);
    pole.castShadow = true;
    group.add(pole);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), trussMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(x, y0 + 8.8, z);
    group.add(bar);
    for (const s of [-0.8, 0.8]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0d8, emissiveIntensity: 1.8 }));
      lamp.position.set(x + s, y0 + 8.5, z + 0.3);
      lamp.rotation.x = -0.5;
      lamp.rotation.y = aimY;
      group.add(lamp);
    }
  }

  // ------------------------------------------------------------ sensor mast / instruments
  function makeSensorMast(x, z) {
    const y0 = groundY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 14, 8), trussMat);
    pole.position.set(x, y0 + 7, z);
    pole.castShadow = true;
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), trussMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(x + 1.5, y0 + 12.5, z);
    group.add(arm);
    // spinning anemometer
    const anemo = new THREE.Group();
    anemo.position.set(x - 0.8, y0 + 13.2, z);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), whiteMat);
      blade.position.x = 0.6;
      const holder = new THREE.Group();
      holder.rotation.y = i * Math.PI * 2 / 3;
      holder.add(blade);
      anemo.add(holder);
    }
    group.add(anemo);
    updaters.push((t) => { anemo.rotation.y = t * 2.2; });

    const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), ledGreen());
    led.position.set(x, y0 + 14.3, z);
    group.add(led);
    updaters.push((t) => { led.material.emissiveIntensity = (Math.sin(t * 4.7) > 0.7) ? 4 : 0.2; });

    // instrument box at its foot with blinking LEDs
    makeInstrumentBox(x + 2.2, z + 1.5);
  }

  function makeInstrumentBox(x, z) {
    const y0 = groundY(x, z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), whiteMat);
    box.position.set(x, y0 + 0.65, z);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), trussMat);
    ant.position.set(x + 0.6, y0 + 2.0, z);
    group.add(ant);
    const leds = [];
    for (let i = 0; i < 3; i++) {
      const m = i === 1 ? ledGreen() : ledRed();
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), m);
      s.position.set(x - 0.91, y0 + 0.5 + i * 0.28, z - 0.3 + i * 0.3);
      group.add(s);
      leds.push(m);
    }
    updaters.push((t) => {
      leds.forEach((m, i) => { m.emissiveIntensity = (Math.sin(t * (2.3 + i * 1.7)) > 0.3) ? 3.5 : 0.15; });
    });
  }

  // ------------------------------------------------------------ antenna cluster
  function makeAntennaCluster(x, z) {
    for (let i = 0; i < 3; i++) {
      const px = x + (i - 1) * 3.2, pz = z + (i % 2) * 2.6;
      const y0 = groundY(px, pz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4 + i, 8), trussMat);
      pole.position.set(px, y0 + (4 + i) / 2, pz);
      pole.castShadow = true;
      group.add(pole);
      const pts = [];
      for (let k = 0; k <= 8; k++) { const r = k / 8 * 1.7; pts.push(new THREE.Vector2(r, r * r * 0.16)); }
      const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), whiteMat);
      dish.position.set(px, y0 + 4 + i, pz);
      dish.rotation.x = -Math.PI / 2 + 0.25 + i * 0.2;
      dish.rotation.z = i * 0.8;
      dish.castShadow = true;
      group.add(dish);
    }
  }

  // ------------------------------------------------------------ rover
  function makeRover({ path = null, x = 0, z = 0, rotY = 0, dust = null }) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 4.2), whiteMat);
    chassis.position.y = 1.15; chassis.castShadow = true; chassis.receiveShadow = true;
    body.add(chassis);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.7), capMat);
    cabin.position.set(0, 1.95, 1.0); cabin.castShadow = true;
    body.add(cabin);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.6), solarMat);
    deck.position.set(0, 1.62, -0.8); deck.rotation.x = 0.06;
    body.add(deck);
    // antenna mast + dish
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 6), trussMat);
    mast.position.set(0.9, 2.7, -1.6);
    body.add(mast);
    const dpts = [];
    for (let k = 0; k <= 6; k++) { const r = k / 6 * 0.5; dpts.push(new THREE.Vector2(r, r * r * 0.3)); }
    const dish = new THREE.Mesh(new THREE.LatheGeometry(dpts, 12), whiteMat);
    dish.position.set(0.9, 3.6, -1.6); dish.rotation.x = -1.0;
    body.add(dish);
    // headlights
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0d0, emissiveIntensity: 1.6 }));
      hl.position.set(sx, 1.3, 2.15);
      body.add(hl);
    }
    // wheels
    const wheels = [];
    for (const sx of [-1, 1]) {
      for (const wz of [-1.5, 0, 1.5]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 14), darkMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * 1.5, 0.55, wz);
        w.castShadow = true;
        body.add(w);
        wheels.push(w);
      }
    }

    const col = { type: 'box', x: 0, z: 0, yaw: rotY, hx: 1.4, hz: 2.2 };
    colliders.push(col);

    if (path) {
      // moving rover
      const curve = new THREE.CatmullRomCurve3(
        path.map(([px, pz]) => new THREE.Vector3(px, groundY(px, pz) + 1.1, pz)),
        true, 'catmullrom', 0.5
      );
      const len = curve.getLength();
      let prevU = 0;
      let dustAcc = 0;
      updaters.push((t, dt) => {
        const u = ((t * 3.2) / len) % 1;
        const p = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        root.position.set(p.x, groundY(p.x, p.z) + 1.1, p.z);
        root.rotation.y = Math.atan2(tan.x, tan.z);
        col.x = p.x; col.z = p.z; col.yaw = root.rotation.y;
        body.rotation.z = Math.sin(t * 1.7) * 0.02;
        body.rotation.x = Math.sin(t * 1.15 + 1) * 0.025;
        const du = (((u - prevU) % 1) + 1) % 1;
        for (const w of wheels) w.rotation.x += du * len / 0.55;
        prevU = u;
        // dust puffs behind
        if (dust) {
          dustAcc += dt;
          if (dustAcc > 0.14) {
            dustAcc = 0;
            const back = new THREE.Vector3(-Math.sin(root.rotation.y), 0, -Math.cos(root.rotation.y));
            dust.spawn(
              root.position.x + back.x * 2.4, groundY(p.x, p.z) + 0.4, root.position.z + back.z * 2.4,
              back.x * 1.2 + (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.4, back.z * 1.2 + (Math.random() - 0.5) * 0.6,
              2.2, 2.2 + Math.random() * 1.6, 0.5
            );
          }
        }
      });
    } else {
      root.position.set(x, groundY(x, z) + 1.1, z);
      root.rotation.y = rotY;
      col.x = x; col.z = z;
    }
    group.add(root);
    return root;
  }

  // ------------------------------------------------------------ cargo drone
  function makeDrone(waypoints, speed, dust) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.1), whiteMat);
    body.castShadow = true;
    root.add(body);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: 0xb0a060, metalness: 0.4, roughness: 0.6 }));
    cargo.position.y = -0.55;
    cargo.castShadow = true;
    root.add(cargo);
    const rotors = [];
    const rotorTex = makeSoftSprite(64, 'rgba(200,210,230,0.8)');
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5), darkMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(sx * 0.85, 0.05, sz * 0.55);
      root.add(arm);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20),
        new THREE.MeshBasicMaterial({ map: rotorTex, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(sx * 1.3, 0.12, sz * 0.55);
      root.add(disc);
      rotors.push(disc);
    }
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), ledRed());
    navR.position.set(0.75, 0.3, 0);
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), ledGreen());
    navG.position.set(-0.75, 0.3, 0);
    root.add(navR, navG);
    root.name = 'drone';
    group.add(root);

    const curve = new THREE.CatmullRomCurve3(
      waypoints.map(([px, py, pz]) => new THREE.Vector3(px, py, pz)), true, 'catmullrom', 0.5
    );
    const len = curve.getLength();
    let washAcc = 0;
    updaters.push((t, dt) => {
      const u = ((t * speed) / len) % 1;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      root.position.set(p.x, p.y + Math.sin(t * 2.1) * 0.3, p.z);
      root.rotation.y = Math.atan2(tan.x, tan.z);
      root.rotation.z = Math.sin(t * 1.3) * 0.06;
      root.rotation.x = Math.sin(t * 0.9 + 2) * 0.05;
      for (const r of rotors) r.rotation.z = t * 38;
      navR.material.emissiveIntensity = (t % 1.0 < 0.12) ? 4 : 0.2;
      navG.material.emissiveIntensity = (t % 1.0 < 0.12) ? 0.2 : 3;
      // dust wash when low
      const gy = groundY(p.x, p.z);
      if (p.y - gy < 8 && dust) {
        washAcc += dt;
        if (washAcc > 0.25) {
          washAcc = 0;
          dust.spawn(p.x + (Math.random() - 0.5) * 2, gy + 0.3, p.z + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2.5, 0.35, (Math.random() - 0.5) * 2.5, 1.8, 3 + Math.random() * 2, 0.35);
        }
      }
    });
  }

  // ------------------------------------------------------------ robotic arm
  function makeArm(x, z) {
    const y0 = groundY(x, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.2, 12), darkMat);
    base.position.set(x, y0 + 0.6, z);
    base.castShadow = true;
    group.add(base);

    const j1 = new THREE.Group(); j1.position.set(x, y0 + 1.2, z); group.add(j1);
    const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), whiteMat);
    seg1.position.y = 1.2; seg1.castShadow = true; j1.add(seg1);
    const j2 = new THREE.Group(); j2.position.y = 2.4; j1.add(j2);
    const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.0, 0.45), capMat);
    seg2.position.y = 1.0; seg2.castShadow = true; j2.add(seg2);
    const j3 = new THREE.Group(); j3.position.y = 2.0; j2.add(j3);
    const seg3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), whiteMat);
    seg3.position.y = 0.7; j3.add(seg3);
    const claw = new THREE.Group(); claw.position.y = 1.4; j3.add(claw);
    for (const s of [-1, 1]) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), darkMat);
      finger.position.set(s * 0.18, 0.25, 0);
      claw.add(finger);
    }
    updaters.push((t) => {
      j1.rotation.y = Math.sin(t * 0.23) * 0.9;
      j2.rotation.z = -0.5 + Math.sin(t * 0.31 + 1) * 0.35;
      j3.rotation.z = 0.6 + Math.sin(t * 0.47 + 2) * 0.4;
      claw.rotation.y = Math.sin(t * 0.8) * 0.6;
    });
  }

  // ------------------------------------------------------------ astronaut
  function makeAstronaut(x, z, { mode = 'walk', face = 0 }) {
    const y0 = groundY(x, z);
    const root = new THREE.Group();
    root.position.set(x, y0, z);
    root.rotation.y = face;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.42, 6, 12), suitMat);
    torso.position.y = 1.18; torso.castShadow = true;
    root.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x303640, emissive: 0x4488cc, emissiveIntensity: 0.7 }));
    chest.position.set(0, 1.3, 0.28);
    root.add(chest);
    // PLSS backpack
    const plss = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suitDarkMat);
    plss.position.set(0, 1.25, -0.36); plss.castShadow = true;
    root.add(plss);
    // helmet + visor
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), suitMat);
    helmet.position.y = 1.78; helmet.castShadow = true;
    root.add(helmet);
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 20, 14, -1.0, 2.0, 0.55, 2.0), visorMat);
    visor.position.set(0, 1.78, 0.02);
    root.add(visor);
    // neck ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 16), suitDarkMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.52;
    root.add(ring);

    // limbs with pivots
    function limb(parent, px, py, pz, r, len, mat) {
      const pivot = new THREE.Group();
      pivot.position.set(px, py, pz);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 8), mat);
      m.position.y = -len / 2 - r * 0.5;
      m.castShadow = true;
      pivot.add(m);
      parent.add(pivot);
      return pivot;
    }
    const legL = limb(root, 0.17, 0.92, 0, 0.13, 0.55, suitMat);
    const legR = limb(root, -0.17, 0.92, 0, 0.13, 0.55, suitMat);
    const armL = limb(root, 0.36, 1.42, 0, 0.11, 0.5, suitMat);
    const armR = limb(root, -0.36, 1.42, 0, 0.11, 0.5, suitMat);
    // boots & gloves
    for (const [piv, r] of [[legL, 0.15], [legR, 0.15]]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.34), suitDarkMat);
      boot.position.set(0, -0.72, 0.05);
      piv.add(boot);
    }
    for (const piv of [armL, armR]) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), suitDarkMat);
      glove.position.y = -0.62;
      piv.add(glove);
    }
    group.add(root);

    const col = { type: 'cylinder', x, z, r: 0.5, y0: 0, h: 2.4 };
    colliders.push(col);

    if (mode === 'walk') {
      // slow low-g patrol loop around the spawn point — actually goes places
      const cx = x, cz = z, R = 6;
      updaters.push((t) => {
        const a = t * 0.1;               // ~63 s per lap ≈ 0.6 m/s
        const px = cx + Math.cos(a) * R, pz = cz + Math.sin(a) * R;
        root.position.x = px;
        root.position.z = pz;
        col.x = px; col.z = pz;
        root.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)); // face travel
        const s = Math.sin(t * 1.05);
        legL.rotation.x = s * 0.5; legR.rotation.x = -s * 0.5;
        armL.rotation.x = -s * 0.35; armR.rotation.x = s * 0.35;
        root.position.y = groundY(px, pz) + Math.abs(Math.sin(t * 2.1)) * 0.06;
      });
    } else {
      // working at equipment: arm gestures
      updaters.push((t) => {
        armR.rotation.x = -1.35 + Math.sin(t * 0.85) * 0.3;
        armR.rotation.z = 0.3 + Math.sin(t * 0.5) * 0.2;
        armL.rotation.x = -0.5 + Math.sin(t * 0.6 + 1) * 0.15;
        root.rotation.y = face + Math.sin(t * 0.22) * 0.12;
        helmet.rotation.y = Math.sin(t * 0.4) * 0.3;
        visor.rotation.y = helmet.rotation.y;
      });
    }
  }

  // ------------------------------------------------------------ ground path lights
  function makePathLights(paths) {
    const positions = [];
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i], [bx, bz] = path[i + 1];
        const d = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.floor(d / 7));
        const nx = -(bz - az) / d, nz = (bx - ax) / d;
        for (let s = 0; s <= steps; s++) {
          const k = s / steps;
          const side = s % 2 ? 1.6 : -1.6;
          const x = ax + (bx - ax) * k + nx * side;
          const z = az + (bz - az) * k + nz * side;
          positions.push([x, z]);
        }
      }
    }
    const mat = ledWarm();
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 8), mat, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      dummy.position.set(x, groundY(x, z) + 0.28, z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    updaters.push((t) => { mat.emissiveIntensity = 2.6 + Math.sin(t * 1.5) * 0.5; });
  }

  // ------------------------------------------------------------ dust particle system
  function makeDustSystem(max = 260) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(max * 3);
    const life = new Float32Array(max);
    const size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { sprite: { value: makeSoftSprite() }, color: { value: new THREE.Color(0.42, 0.40, 0.38) } },
      vertexShader: `
        attribute float aLife;
        attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D sprite;
        uniform vec3 color;
        varying float vLife;
        void main() {
          vec4 t = texture2D(sprite, gl_PointCoord);
          float a = t.a * vLife;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);

    const parts = [];
    for (let i = 0; i < max; i++) parts.push({ active: false, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, fade: 0.5 });
    let cursor = 0;

    return {
      spawn(x, y, z, vx, vy, vz, lifeS, sz, fade = 0.5) {
        const p = parts[cursor];
        cursor = (cursor + 1) % max;
        Object.assign(p, { active: true, x, y, z, vx, vy, vz, life: lifeS, maxLife: lifeS, size: sz, fade });
      },
      update(dt) {
        for (let i = 0; i < max; i++) {
          const p = parts[i];
          if (p.active) {
            p.life -= dt;
            if (p.life <= 0) { p.active = false; life[i] = 0; positions[i * 3 + 1] = -999; continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.vx *= (1 - dt * 0.6); p.vz *= (1 - dt * 0.6);
            p.vy += dt * 0.15; // dust slowly billows up in vacuum-ish puff
            const k = p.life / p.maxLife;
            life[i] = Math.sin(k * Math.PI) * p.fade;
            size[i] = p.size * (1.6 - k * 0.6);
            positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
          }
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aLife.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
      },
    };
  }

  // ------------------------------------------------------------ ambient haze
  function makeHaze(n = 140) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const data = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 300;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = groundY(x, z) + 0.5 + Math.random() * 7;
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
      size[i] = 2 + Math.random() * 5;
      data.push({ ph: Math.random() * 6.28, sp: 0.05 + Math.random() * 0.12 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { sprite: { value: makeSoftSprite() }, color: { value: new THREE.Color(0.35, 0.34, 0.33) } },
      vertexShader: `
        attribute float aSize;
        varying float vA;
        uniform float uTime;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = 0.10 + 0.06 * sin(uTime * 0.4 + position.x * 0.1);
          gl_PointSize = aSize * (260.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D sprite;
        uniform vec3 color;
        varying float vA;
        void main() {
          vec4 t = texture2D(sprite, gl_PointCoord);
          float a = t.a * vA;
          if (a < 0.008) discard;
          gl_FragColor = vec4(color, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    mat.uniforms.uTime = { value: 0 };
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
    updaters.push((t, dt) => {
      mat.uniforms.uTime.value = t;
      const pos = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        pos[i * 3] += Math.sin(t * data[i].sp + data[i].ph) * dt * 0.35;
        pos[i * 3 + 2] += Math.cos(t * data[i].sp * 0.8 + data[i].ph) * dt * 0.35;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ============================================================ ASSEMBLY
  // colliders for the player ball: horizontal capsules (modules/tunnels),
  // vertical cylinders (towers/poles/tanks/people), boxes (rovers/containers/
  // lander). Dynamic objects (rovers, walking astronaut) mutate their entry.
  const colliders = [];
  const M1 = makeModule({ x: 0, z: 0, axis: 'x', legs: true });
  const M2 = makeModule({ x: -44, z: 26, axis: 'z', bury: 1.0 });
  const M3 = makeModule({ x: 36, z: -32, axis: 'x', bury: 0.6 });
  const M4 = makeModule({ x: -12, z: 64, axis: 'x', legs: true });
  const M5 = makeModule({ x: 60, z: 18, axis: 'z', bury: 2.2 });
  const M6 = makeModule({ x: 24, z: -66, axis: 'z', legs: true, L: 15 });

  makeTunnel(M1, M2);
  makeTunnel(M1, M3);
  makeTunnel(M2, M4);
  makeTunnel(M1, M5);
  makeTunnel(M3, M6);

  makeDome(22, 44, 8);
  makeDome(-50, -18, 7);

  makeAirlock(-44, 40, Math.PI);
  makeAirlock(-25, 64, Math.PI / 2);

  makeTower(-88, -72, 46, { scan: false, speed: 0.45 });
  makeTower(84, -88, 40, { scan: true, speed: 0.32 });

  makeSolarField(150, 8);
  makePad(-142, 116, 22);
  makeLander(-142, 116);
  makeContainers(74, 72);
  makeTankCluster(50, -50);
  makeFloodlight(-105, 100, 0.8);
  makeFloodlight(95, 45, -0.6);
  makeSensorMast(-36, -80);
  makeInstrumentBox(58, -58);
  makeAntennaCluster(-72, -50);
  makeArm(24, -50);

  // dust system (shared)
  const dust = makeDustSystem();

  // rovers
  const roverLoop = [[-105, 92], [-28, 124], [45, 105], [112, 58], [88, -18], [12, -52], [-68, -46], [-112, 18]];
  makeRover({ path: roverLoop, dust });
  makeRover({ x: -120, z: 96, rotY: -0.8 });
  makeRover({ x: -160, z: 130, rotY: 0.9 });

  // drones
  makeDrone([[74, 17, 72], [-142, 14, 116], [-12, 19, 64], [30, 16, 8]], 7.5, dust);
  makeDrone([[-50, 15, -18], [84, 46, -88], [150, 17, 8], [36, 14, -32]], 6.0, dust);

  // astronauts
  makeAstronaut(-118, 88, { mode: 'walk', face: -0.5 });
  makeAstronaut(-32, -74, { mode: 'work', face: 2.6 });

  // ------------------------------------------------------------ static colliders
  const cap = (ax, az, bx, bz, r) => colliders.push({ type: 'capsuleH', ax, az, bx, bz, r });
  const cyl = (x, z, r, h = 99) => colliders.push({ type: 'cylinder', x, z, r, y0: 0, h });
  const box = (x, z, hx, hz, yaw = 0) => colliders.push({ type: 'box', x, z, hx, hz, yaw });

  // habitat modules (horizontal capsules, R 6) + connecting tunnels (r 2.8)
  cap(-10, 0, 10, 0, 6);            // M1 (0,0) axis x
  cap(-44, 16, -44, 36, 6);         // M2 (-44,26) axis z
  cap(26, -32, 46, -32, 6);         // M3 (36,-32) axis x
  cap(-22, 64, -2, 64, 6);          // M4 (-12,64) axis x
  cap(60, 8, 60, 28, 6);            // M5 (60,18) axis z
  cap(24, -73.5, 24, -58.5, 6);     // M6 (24,-66) axis z, L 15
  cap(0, 0, -44, 26, 2.8);          // tunnel M1-M2
  cap(0, 0, 36, -32, 2.8);          // tunnel M1-M3
  cap(-44, 26, -12, 64, 2.8);       // tunnel M2-M4
  cap(0, 0, 60, 18, 2.8);           // tunnel M1-M5
  cap(36, -32, 24, -66, 2.8);       // tunnel M3-M6

  cyl(22, 44, 8, 7);                // dome
  cyl(-50, -18, 7, 6.5);            // dome
  box(-44, 40, 1.5, 2);             // airlock
  box(-25, 64, 1.5, 2);             // airlock
  cyl(-88, -72, 1.8, 46);           // comm tower
  cyl(84, -88, 1.8, 40);            // comm tower
  box(-142, 116, 3.5, 3.5);         // lander
  box(74, 72, 5, 3.5);              // container stack
  cyl(50, -50, 4, 6);               // tank cluster (approx)
  cyl(-105, 100, 0.7, 8);           // floodlight pole
  cyl(95, 45, 0.7, 8);              // floodlight pole
  cyl(-36, -80, 0.6, 10);           // sensor mast
  box(58, -58, 1.2, 1.2);           // instrument box
  cyl(-72, -50, 2.5, 8);            // antenna cluster
  cyl(24, -50, 1.5, 4);             // robotic arm base
  // solar field: panels sit on 3.6 m poles (ball passes under panels, hits poles)
  for (let row = 0; row < 3; row++)
    for (let colI = 0; colI < 6; colI++)
      cyl(150 + (colI - 2.5) * 13, 8 + (row - 1) * 16, 0.5, 3.6);

  // ------------------------------------------------------------ ground decals (opaque dark quads with
  // per-quad vertex colors — reads as compressed regolith; all transparent/
  // blend approaches proved unreliable on software WebGL backends)
  function makeGroundDecals(quads) {
    const n = quads.length;
    const positions = new Float32Array(n * 4 * 3);
    const colors = new Float32Array(n * 4 * 3);
    const indices = [];
    for (let i = 0; i < n; i++) {
      const q = quads[i];
      for (let v = 0; v < 4; v++) {
        positions[(i * 4 + v) * 3]     = q.p[v][0];
        positions[(i * 4 + v) * 3 + 1] = q.p[v][1];
        positions[(i * 4 + v) * 3 + 2] = q.p[v][2];
        colors[(i * 4 + v) * 3]     = q.c[0];
        colors[(i * 4 + v) * 3 + 1] = q.c[1];
        colors[(i * 4 + v) * 3 + 2] = q.c[2];
      }
      indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // quad oriented along tangent (tx,tz), centered (cx,cz), half-extents (hw,hl),
  // shaded as a multiplier of the terrain tone with per-quad jitter
  function decalQuad(quads, cx, cz, tx, tz, hw, hl, shade) {
    const y = groundY(cx, cz) + 0.03;
    const nx = -tz, nz = tx;
    const j = 0.82 + Math.random() * 0.36;
    const p = [];
    for (const [sw, sl] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      p.push([
        cx + nx * hw * sw + tx * hl * sl,
        y,
        cz + nz * hw * sw + tz * hl * sl,
      ]);
    }
    quads.push({ p, c: [shade * j, shade * j * 0.99, shade * j * 0.97] });
  }

  // footprints along the airlock->mast path
  {
    const quads = [];
    const steps = 150;
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = -44 + 8 * k + Math.sin(k * Math.PI) * 6;
      const z = 40 + (-72 - 40) * k;
      if (prev) {
        let tx = x - prev[0], tz = z - prev[1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const side = (i % 2 === 0) ? 0.16 : -0.16;
        const cx = prev[0] + (x - prev[0]) * 0.5 - tz * side;
        const cz = prev[1] + (z - prev[1]) * 0.5 + tx * side;
        decalQuad(quads, cx, cz, tx, tz, 0.13, 0.22, 0.1);
      }
      prev = [x, z];
    }
    makeGroundDecals(quads);
  }

  // tire tracks along the rover loop
  {
    const quads = [];
    const curve = new THREE.CatmullRomCurve3(
      roverLoop.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5
    );
    const len = curve.getLength();
    const steps = Math.round(len / 0.55);
    let p0 = curve.getPoint(0);
    for (let i = 1; i <= steps; i++) {
      const p1 = curve.getPoint(i / steps);
      let tx = p1.x - p0.x, tz = p1.z - p0.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
      if (i % 2 === 0) {
        for (const side of [-1.05, 1.05]) {
          decalQuad(quads, cx - tz * side, cz + tx * side, tx, tz, 0.17, 0.3, 0.11);
        }
      }
      // faint center drag
      if (i % 4 === 0) decalQuad(quads, cx, cz, tx, tz, 0.25, 0.5, 0.15);
      p0 = p1;
    }
    makeGroundDecals(quads);
  }

  // pathway lights
  makePathLights([
    [[-142, 116], [-44, 26]],
    [[-44, 26], [0, 0]],
    [[0, 0], [-50, -18]],
    [[0, 0], [36, -32]],
    [[-12, 64], [22, 44]],
    [[0, 0], [60, 18], [115, 12]],
    [[36, -32], [24, -66]],
  ]);

  makeHaze();

  function update(t, dt) {
    for (const fn of updaters) fn(t, dt);
    dust.update(dt);
  }

  return { group, update, colliders };
}
