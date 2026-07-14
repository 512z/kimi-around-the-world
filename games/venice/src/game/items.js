// VENICE SPEED — water prank items for the multiplayer regatta.
// Floating lantern crates along the canal; E to use. Thin-relay + victim
// authoritative: uses are broadcast, each victim applies effects to itself
// and then broadcasts an `fx` so EVERYONE sees the hit land (big water rings,
// camera shake) — invisible pranks aren't pranks.
import * as THREE from 'three';

const ROW_S = [45, 100, 160, 220, 280, 340, 400, 460, 520];
const LANES = [-0.55, 0, 0.55];   // fraction of half-width
const RESPAWN = 8;
const PICKUP_R2 = 2.1 * 2.1;

export const ITEM_DEFS = {
  wave:   { label: 'WAVE',   w: 0.24, color: '#7fd4ff' },
  whirl:  { label: 'WHIRL',  w: 0.18, color: '#6fe0c8' },
  anchor: { label: 'ANCHOR', w: 0.14, color: '#c9ced6' },
  splash: { label: 'SPLASH', w: 0.16, color: '#9fd8ff' },
  shield: { label: 'SHIELD', w: 0.14, color: '#ffd9a8' },
  swap:   { label: 'SWAP',   w: 0.14, color: '#ffb168' },
};

const ICONS = {
  wave: '<path d="M4 20c4-6 8-6 12 0s8 6 12 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 12c4-6 8-6 12 0s8 6 12 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>',
  whirl: '<path d="M16 5a11 11 0 1 1-9 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M16 10a6 6 0 1 1-5 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>',
  anchor: '<path d="M16 6v18M16 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 15l-4 3c2 6 7 9 12 9s10-3 12-9l-4-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  splash: '<path d="M16 4c4 6 7 10 7 14a7 7 0 1 1-14 0c0-4 3-8 7-14z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="7" cy="24" r="1.6" fill="currentColor"/><circle cx="25" cy="22" r="1.4" fill="currentColor"/>',
  shield: '<path d="M16 4l10 4v8c0 7-4 11-10 13-6-2-10-6-10-13V8z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>',
  swap: '<path d="M6 11h17l-5-5M26 21H9l5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function rollItem() {
  let total = 0;
  for (const k in ITEM_DEFS) total += ITEM_DEFS[k].w;
  let r = Math.random() * total;
  for (const k in ITEM_DEFS) { r -= ITEM_DEFS[k].w; if (r <= 0) return k; }
  return 'wave';
}

// api: { S, canal, scene, water, net, notice, myId(), leaderId(), aheadId(),
//        remotes(), isOn(), setBubble(on), shake(amt), teleport(x,z,heading),
//        bots?() — solo-regatta AI boats (whirlpools catch them too) }
export function makeRegattaItems(api) {
  const { scene, canal } = api;

  // ---------- HUD slot ----------
  const slot = document.createElement('div');
  slot.id = 'item-slot';
  slot.style.cssText =
    'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:40;display:none;' +
    'width:64px;height:64px;border-radius:12px;align-items:center;justify-content:center;' +
    'background:rgba(6,11,20,.62);border:1.5px solid rgba(114,173,247,.5);' +
    'box-shadow:0 0 18px rgba(114,173,247,.2);pointer-events:none;';
  slot.innerHTML = '<span id="item-icon"></span>' +
    '<span style="position:absolute;right:-7px;bottom:-7px;width:20px;height:20px;border-radius:5px;' +
    'display:flex;align-items:center;justify-content:center;font:700 11px \'Geist Mono\',monospace;' +
    'color:#0a1526;background:linear-gradient(180deg,#cfe4ff,#72adf7)">E</span>';
  document.body.appendChild(slot);
  const iconEl = slot.querySelector('#item-icon');

  let held = null;
  function setHeld(kind) {
    held = kind;
    if (!kind) { slot.style.display = 'none'; return; }
    slot.style.display = 'flex';
    iconEl.innerHTML = `<svg viewBox="0 0 32 32" style="width:36px;height:36px;display:block;color:${ITEM_DEFS[kind].color};filter:drop-shadow(0 0 6px currentColor)">${ICONS[kind]}</svg>`;
  }

  // ---------- expanding water-ring bursts (the "it landed HERE" language) ---
  const rings = []; // {mesh, t, life, r0, r1}
  function ringBurst(x, z, colorHex, big = false) {
    for (let i = 0; i < (big ? 3 : 2); i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.15, 40),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(colorHex).multiplyScalar(1.6),
          transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.1 + i * 0.02, z);
      scene.add(mesh);
      rings.push({ mesh, t: -i * 0.16, life: 0.9, r1: (big ? 9 : 5.5) + i * 2 });
    }
    api.water?.addWake?.(x, z, big ? 1.6 : 1.0);
    api.water?.addWake?.(x + 1.2, z - 0.8, 0.8);
    api.water?.addWake?.(x - 1.0, z + 1.1, 0.8);
  }

  // ---------- crates: floating dawn lanterns ----------
  const group = new THREE.Group();
  scene.add(group);
  const shellGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const shellMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd9a0').multiplyScalar(1.6),
    wireframe: true, transparent: true, opacity: 0.85,
  });
  const coreGeo = new THREE.SphereGeometry(0.22, 10, 8);
  const coreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#fff2d8').multiplyScalar(1.8),
    transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boxes = [];
  for (const s of ROW_S) {
    const sm = canal.atS(s);
    const nx = Math.cos(sm.ang), nz = -Math.sin(sm.ang);
    for (const lane of LANES) {
      const lat = lane * (sm.width / 2 - 1.4);
      const x = sm.x + nx * lat, z = sm.z + nz * lat;
      const grp = new THREE.Group();
      grp.position.set(x, 0.55, z);
      grp.add(new THREE.Mesh(shellGeo, shellMat));
      grp.add(new THREE.Mesh(coreGeo, coreMat.clone()));
      group.add(grp);
      boxes.push({ grp, x, z, active: true, respawn: 0, phase: Math.random() * 6.28 });
    }
  }

  // ---------- whirlpool traps (bigger, angrier) ----------
  const whirls = [];
  function spawnWhirl(x, z, ownerId) {
    const grp = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8 + i * 1.1, 1.6 + i * 1.3, 32),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#6fe0c8').multiplyScalar(1.5),
          transparent: true, opacity: 0.55 - i * 0.18, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1 + i * 0.02;
      grp.add(ring);
    }
    grp.position.set(x, 0, z);
    scene.add(grp);
    whirls.push({ grp, x, z, ownerId, life: 35, arm: 1.2 });
    api.water?.addWake?.(x, z, 1.0);
  }
  function popWhirl(i, big) {
    ringBurst(whirls[i].x, whirls[i].z, '#6fe0c8', big);
    scene.remove(whirls[i].grp);
    whirls.splice(i, 1);
  }

  // ---------- splash overlay (vision prank — now actually blinding) --------
  let splashEl = null, flashEl = null;
  function showSplash() {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:fixed;inset:0;z-index:36;pointer-events:none;opacity:0;' +
        'background:radial-gradient(circle, rgba(220,240,255,.85), rgba(190,220,245,.4) 60%, transparent);' +
        'transition:opacity .18s ease;';
      document.body.appendChild(flashEl);
    }
    if (splashEl) splashEl.remove();
    splashEl = document.createElement('div');
    splashEl.style.cssText = 'position:fixed;inset:0;z-index:35;pointer-events:none;opacity:1;transition:opacity 1.2s ease;';
    const blobs = [];
    for (let i = 0; i < 16; i++) {
      const sz = 140 + Math.random() * 320;
      blobs.push(`<div style="position:absolute;left:${Math.random() * 92 - 6}%;top:${Math.random() * 88 - 4}%;` +
        `width:${sz}px;height:${sz * (0.85 + Math.random() * 0.4)}px;border-radius:50%;` +
        `background:radial-gradient(circle at 42% 35%, rgba(225,242,255,.6), rgba(170,205,240,.32) 52%, transparent 74%);` +
        `filter:blur(${1 + Math.random() * 3}px)"></div>`);
    }
    splashEl.innerHTML = blobs.join('');
    document.body.appendChild(splashEl);
    // white slap, then the droplets cling and fade
    flashEl.style.opacity = '1';
    setTimeout(() => { flashEl.style.opacity = '0'; }, 220);
    const el = splashEl;
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 1300); }, 3600);
  }

  // ---------- use ----------
  function use() {
    if (!held || !api.isOn()) return;
    const kind = held;
    setHeld(null);
    const S = api.S;
    const r = (v) => +v.toFixed(2);
    if (kind === 'wave') {
      api.net.sendItem({ sub: 'wave' });
      ringBurst(S.x + Math.sin(S.heading) * 4, S.z + Math.cos(S.heading) * 4, '#7fd4ff');
      api.notice('WAVE SURGE!', 'good');
    } else if (kind === 'whirl') {
      const bx = S.x - Math.sin(S.heading) * 5, bz = S.z - Math.cos(S.heading) * 5;
      spawnWhirl(bx, bz, api.myId());
      api.net.sendItem({ sub: 'whirl', x: r(bx), z: r(bz) });
      api.notice('WHIRLPOOL SET', 'dim');
    } else if (kind === 'anchor') {
      const target = api.leaderId();
      if (target == null) { api.notice('NO TARGET', 'dim'); setHeld(kind); return; }
      api.net.sendItem({ sub: 'anchor', targetId: target });
      api.notice('ANCHOR AWAY!', 'good');
    } else if (kind === 'splash') {
      api.net.sendItem({ sub: 'splash' });
      ringBurst(S.x, S.z, '#9fd8ff');
      api.notice('SPLASH!', 'good');
    } else if (kind === 'shield') {
      S.shieldT = 8;
      api.net.sendItem({ sub: 'shieldOn' });
      api.notice('BUBBLE SHIELD!', 'good');
    } else if (kind === 'swap') {
      const target = api.aheadId() ?? api.leaderId();
      if (target == null) { api.notice('NO TARGET', 'dim'); setHeld(kind); return; }
      api.net.sendItem({ sub: 'swap', targetId: target, x: r(S.x), z: r(S.z), heading: r(S.heading) });
      api.notice('SWAP!', 'good');
    }
  }

  // ---------- incoming ----------
  function blocked() {
    const S = api.S;
    if (S.shieldT > 0) {
      S.shieldT = 0;
      api.net.sendItem({ sub: 'shieldPop' });
      ringBurst(S.x, S.z, '#ffd9a8');
      api.notice('BLOCKED!', 'good');
      return true;
    }
    return false;
  }

  // victim tells the world where the hit landed so everyone sees it
  function announceFx(kind) {
    const S = api.S;
    api.net.sendItem({ sub: 'fx', kind, x: +S.x.toFixed(1), z: +S.z.toFixed(1) });
  }

  function onNet(msg) {
    const S = api.S;
    const rg = api.remotes().get(msg.from);
    switch (msg.sub) {
      case 'wave': {
        if (!rg) return;
        const dx = S.x - rg.boat.position.x, dz = S.z - rg.boat.position.z;
        const d = Math.hypot(dx, dz);
        const fwd = { x: Math.sin(rg.boat.rotation.y), z: Math.cos(rg.boat.rotation.y) };
        const ahead = (dx * fwd.x + dz * fwd.z) / (d || 1);
        if (d < 40 && ahead > 0.5) {
          if (blocked()) return;
          S.vx += fwd.x * 4.2; S.vz += fwd.z * 4.2;
          S.omega += 3.2;
          S.blockT = Math.max(S.blockT || 0, 1.4);
          ringBurst(S.x, S.z, '#7fd4ff', true);
          api.shake(1.0);
          announceFx('wave');
          api.notice('WAVE INCOMING!', 'bad');
        }
        break;
      }
      case 'whirl': spawnWhirl(msg.x, msg.z, msg.from); break;
      case 'whirlPop': {
        const i = whirls.findIndex((w) => Math.hypot(w.x - msg.x, w.z - msg.z) < 3);
        if (i >= 0) popWhirl(i, true);
        break;
      }
      case 'anchor':
        if (msg.targetId === api.myId()) {
          if (blocked()) return;
          S.vx *= 0.1; S.vz *= 0.1;
          S.blockT = Math.max(S.blockT || 0, 2.2);
          ringBurst(S.x, S.z, '#c9ced6', true);
          api.shake(0.9);
          announceFx('anchor');
          api.notice('ANCHORED!', 'bad');
        }
        break;
      case 'splash':
        if (blocked()) return;
        showSplash();
        api.shake(0.5);
        announceFx('splash');
        api.notice('SPLASHED!', 'bad');
        break;
      case 'swap':
        if (msg.targetId === api.myId()) {
          if (blocked()) return;
          const myX = S.x, myZ = S.z, myH = S.heading;
          ringBurst(myX, myZ, '#ffb168', true);
          api.teleport(msg.x, msg.z, msg.heading);
          ringBurst(msg.x, msg.z, '#ffb168', true);
          api.shake(1.2);
          api.net.sendItem({ sub: 'swapAck', targetId: msg.from, x: +myX.toFixed(2), z: +myZ.toFixed(2), heading: +myH.toFixed(2) });
          api.notice('SWAPPED!', 'bad');
        }
        break;
      case 'swapAck':
        if (msg.targetId === api.myId()) {
          ringBurst(S.x, S.z, '#ffb168', true);
          api.teleport(msg.x, msg.z, msg.heading);
          ringBurst(msg.x, msg.z, '#ffb168', true);
          api.shake(1.2);
          api.notice('SWAPPED!', 'good');
        }
        break;
      case 'fx':
        // a victim somewhere confirmed a hit — show it to everyone
        ringBurst(msg.x, msg.z, ITEM_DEFS[msg.kind]?.color || '#9fd8ff', true);
        break;
      case 'shieldOn': if (rg) rg.shieldT = 8; break;
      case 'shieldPop':
        if (rg) {
          rg.shieldT = 0;
          ringBurst(rg.boat.position.x, rg.boat.position.z, '#ffd9a8');
        }
        break;
    }
  }

  // ---------- per-frame ----------
  function update(dt) {
    const S = api.S;
    const t = performance.now() / 1000;
    for (const b of boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) { b.active = true; b.grp.visible = true; b.grp.scale.setScalar(0.01); }
        continue;
      }
      const pop = Math.min(1, b.grp.scale.x + dt * 3);
      if (pop < 1) b.grp.scale.setScalar(pop);
      b.grp.rotation.y += dt * 1.1;
      b.grp.position.y = 0.55 + Math.sin(t * 1.7 + b.phase) * 0.12;
      if (api.isOn() && !held) {
        const dx = S.x - b.x, dz = S.z - b.z;
        if (dx * dx + dz * dz < PICKUP_R2) {
          setHeld(rollItem());
          b.active = false; b.respawn = RESPAWN; b.grp.visible = false;
          api.water?.addWake?.(b.x, b.z, 0.5);
          api.notice(ITEM_DEFS[held].label, 'dim');
        }
      }
    }
    // expanding rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.t += dt;
      if (rg.t < 0) continue;
      const k = rg.t / rg.life;
      if (k >= 1) { scene.remove(rg.mesh); rings.splice(i, 1); continue; }
      const sc = 1 + k * rg.r1;
      rg.mesh.scale.setScalar(sc);
      rg.mesh.material.opacity = 0.85 * (1 - k) * (1 - k);
    }
    // whirlpools
    for (let i = whirls.length - 1; i >= 0; i--) {
      const w = whirls[i];
      w.life -= dt;
      if (w.arm > 0) w.arm -= dt;
      w.grp.rotation.y += dt * 3.0;
      w.grp.position.y = Math.sin(t * 4 + i) * 0.03;
      if (w.life <= 0) { popWhirl(i, false); continue; }
      if (w.arm <= 0 && w.ownerId !== api.myId() && api.isOn()) {
        const dx = S.x - w.x, dz = S.z - w.z;
        if (dx * dx + dz * dz < 2.6 * 2.6) {
          if (!blocked()) {
            S.omega += 3.4;
            S.blockT = Math.max(S.blockT || 0, 1.7);
            api.shake(1.0);
            announceFx('whirl');
            api.notice('CAUGHT IN THE WHIRL!', 'bad');
          }
          api.net.sendItem({ sub: 'whirlPop', x: +w.x.toFixed(2), z: +w.z.toFixed(2) });
          popWhirl(i, true);
        }
      }
      // solo regatta: bots blunder into armed traps the same way
      if (w.arm <= 0 && whirls[i] === w && api.bots) {
        for (const b of api.bots()) {
          if (b.id === w.ownerId) continue;
          const dx = b.x - w.x, dz = b.z - w.z;
          if (dx * dx + dz * dz < 2.6 * 2.6) { b.hitWhirl(); popWhirl(i, true); break; }
        }
      }
    }
    if (S.shieldT > 0) S.shieldT -= dt;
    api.setBubble?.(S.shieldT > 0);
  }

  return { use, onNet, update, get held() { return held; } };
}
