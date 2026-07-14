// Kimi-ball player: the kimi_mascot.glb hero model (Kimi_Body + white pill
// eyes), floaty low-g movement, follow camera, ball-vs-ball bounce collisions,
// remote interpolation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BALL_R = 0.8;

// ---- hero mascot model, preloaded once and cloned per player -------------
// The glb supplies the GEOMETRY (body + pill eyes); its baked materials are
// discarded and replaced with this game's original velvet recipe, so the ball
// is lit by the sun like everything else — dark inside structure shadows
// (airless moon), whisper of self-hue so it never reads 100% black.
let kimiProto = null;
const kimiReady = new GLTFLoader()
  .loadAsync('./assets/kimi_mascot.glb')
  .then((gltf) => {
    const inner = gltf.scene;
    // normalize: center at origin, sphere diameter = 2 * BALL_R
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const scale = (BALL_R * 2) / Math.max(size.x, size.y, size.z);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    const wrapper = new THREE.Group();
    inner.scale.setScalar(scale);
    inner.position.set(-center.x, -center.y, -center.z);
    wrapper.add(inner);
    // this game's balls face +Z — flip if the glb's eyes sit on -Z
    const eyeC = new THREE.Vector3();
    let eyeN = 0;
    inner.traverse((o) => {
      if (o.isMesh && /eye/i.test(o.name)) {
        eyeC.add(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
        eyeN++;
      }
    });
    if (eyeN && eyeC.z < 0) inner.rotation.y = Math.PI;
    kimiProto = wrapper;
  })
  .catch((err) => console.warn('kimi_mascot.glb failed to load:', err));

function makeKimiModel(color) {
  const model = kimiProto.clone(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;   // go dark inside structure shadows (airless moon)
    if (/eye/i.test(o.name)) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0x333333, emissiveIntensity: 0.6, roughness: 0.5,
      });
      return;
    }
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: color.clone(), metalness: 0.0, roughness: 0.45,
      specularIntensity: 0.0,          // velvet read: no specular lobe at all
      emissive: color.clone().multiplyScalar(0.05), emissiveIntensity: 1,
    });
    // soft fresnel rim baked into the body material — no shell mesh, no hard
    // additive outline: just a gentle edge glow in the ball's own hue
    bodyMat.onBeforeCompile = (sh) => {
      sh.uniforms.rimColor = { value: color.clone().lerp(new THREE.Color(0xffffff), 0.35) };
      sh.fragmentShader = 'uniform vec3 rimColor;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.5);
        totalEmissiveRadiance += rimColor * rimF * 0.25;`
      );
    };
    o.material = bodyMat;
  });
  return model;
}
export const HOVER = 0.95;   // ball center above terrain
export const MAX_SPEED = 4.2;
const SPRINT_MUL = 1.9;      // Shift
export const ACCEL = 24;
export const JUMP_V = 5.5;   // Space — floaty low-g hop (~4.7 m apex)
export const GRAV = 3.2;
const WORLD_R = 2300;
const CONTACT_MARGIN = 0.8;  // start damping approach velocity this far out

export function createKimiBall(colorHex, name = '') {
  const group = new THREE.Group();        // yaw (heading)
  const tilt = new THREE.Group();         // tilt into velocity
  group.add(tilt);

  const color = new THREE.Color(colorHex);
  if (kimiProto) {
    tilt.add(makeKimiModel(color));
  } else {
    // glb still in flight (or failed): attach as soon as it lands
    kimiReady.then(() => { if (kimiProto) tilt.add(makeKimiModel(color)); });
  }

  group.userData.name = name;
  return group;
}

export function dampAngle(cur, target, lambda, dt) {
  let d = ((target - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
  return cur + d * (1 - Math.exp(-lambda * dt));
}

// ball vs base structures: positional push-out + kill inward velocity
// (with a little restitution pop). Two passes for corner stability.
// Shared by PlayerController and the single-player NPC balls.
export function resolveStructureColliders(pos, vel, colliders) {
  const r = BALL_R + 0.02;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      let nx = 0, nz = 0, push = 0;
      if (c.type === 'cylinder') {
        if (pos.y + r < (c.y0 || 0) || pos.y - r > (c.y0 || 0) + c.h) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const minD = r + c.r;
        if (d < minD) {
          if (d > 1e-4) { nx = dx / d; nz = dz / d; push = minD - d; }
          else { nx = 1; nz = 0; push = minD; } // dead center: eject +x
        }
      } else if (c.type === 'capsuleH') {
        // closest point on segment (ax,az)-(bx,bz)
        const ex = c.bx - c.ax, ez = c.bz - c.az;
        const len2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((pos.x - c.ax) * ex + (pos.z - c.az) * ez) / len2));
        const qx = c.ax + ex * t, qz = c.az + ez * t;
        const dx = pos.x - qx, dz = pos.z - qz;
        const d = Math.hypot(dx, dz);
        const minD = r + c.r;
        if (d < minD) {
          if (d > 1e-4) { nx = dx / d; nz = dz / d; push = minD - d; }
          else { // on the segment axis: eject along the segment normal
            const len = Math.sqrt(len2);
            nx = -ez / len; nz = ex / len; push = minD;
          }
        }
      } else if (c.type === 'box') {
        const cos = Math.cos(-(c.yaw || 0)), sin = Math.sin(-(c.yaw || 0));
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        const qx = Math.max(-c.hx, Math.min(lx, c.hx));
        const qz = Math.max(-c.hz, Math.min(lz, c.hz));
        let ddx = lx - qx, ddz = lz - qz;
        const d = Math.hypot(ddx, ddz);
        if (d < r) {
          let lnx, lnz, p;
          if (d > 1e-4) { lnx = ddx / d; lnz = ddz / d; p = r - d; }
          else {
            // center inside the box: eject along the nearest face
            const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
            if (ox < oz) { lnx = Math.sign(lx) || 1; lnz = 0; p = ox + r; }
            else { lnx = 0; lnz = Math.sign(lz) || 1; p = oz + r; }
          }
          nx = lnx * cos + lnz * sin;   // local → world (inverse rotation)
          nz = -lnx * sin + lnz * cos;
          push = p;
        }
      }
      if (push > 0) {
        pos.x += nx * push;
        pos.z += nz * push;
        const vn = vel.x * nx + vel.y * nz;
        if (vn < 0) {
          vel.x -= nx * vn * 1.4;  // stop inward motion + 0.4 pop
          vel.y -= nz * vn * 1.4;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- local player
export class PlayerController {
  constructor(scene, camera, heightAt) {
    this.scene = scene;
    this.camera = camera;
    this.heightAt = heightAt;
    this.ball = null;
    this.tilt = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();      // planar x,z
    this.heading = 0;
    this.bobPh = Math.random() * 6.28;
    this.t = 0;

    this.camAz = Math.PI;                // camera azimuth (orbits ball)
    this.camDist = 9.5;
    this.camPitch = 0.38;
    this.dragging = false;
    this.lastDrag = -10;
    this.camPos = new THREE.Vector3(0, 5, 6);

    this.keys = new Set();
    this.remotes = [];                   // RemotePlayer list for collisions
    this.colliders = [];                 // base structure colliders (from base.js)
    this.enabled = false;
    this.yVel = 0;                       // vertical (jump) velocity
    this.airborne = false;
    this.jumpQueued = false;
  }

  spawn(profile, spawnPt) {
    if (this.ball) this.scene.remove(this.ball);
    this.ball = createKimiBall(profile.colorHex, profile.name);
    this.tilt = this.ball.children[0];
    this.pos.set(spawnPt.x, this.heightAt(spawnPt.x, spawnPt.z) + HOVER, spawnPt.z);
    this.vel.set(0, 0);
    this.yVel = 0;
    this.airborne = false;
    // align the follow cam with the CURRENT camera's view direction (the menu
    // hold framing) so the menu→game handoff is a pure push-in, no yaw swing
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.camAz = Math.atan2(-dir.x, -dir.z);
    this.heading = this.camAz;           // ball keeps facing the camera too
    const cp = Math.cos(this.camPitch);
    this.camPos.set(
      this.pos.x + Math.sin(this.camAz) * cp * this.camDist,
      this.pos.y + Math.sin(this.camPitch) * this.camDist + 1.2,
      this.pos.z + Math.cos(this.camAz) * cp * this.camDist
    );
    this.ball.position.copy(this.pos);
    this.scene.add(this.ball);
    this.enabled = true;
  }

  despawn() {
    this.enabled = false;
    if (this.ball) { this.scene.remove(this.ball); this.ball = null; }
  }

  setKey(code, down) {
    if (code === 'Space' && down && !this.keys.has('Space')) this.jumpQueued = true;
    if (down) this.keys.add(code); else this.keys.delete(code);
  }

  startDrag() { this.dragging = true; this.lastDrag = this.t; }
  drag(dx, dy) {
    this.camAz -= dx * 0.005;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.12, 1.1);
    this.lastDrag = this.t;
  }
  endDrag() { this.dragging = false; }
  zoom(d) { this.camDist = THREE.MathUtils.clamp(this.camDist + d, 4, 16); }

  // ball vs base structures: positional push-out + kill inward velocity
  // (with a little restitution pop). Two passes for corner stability.
  // ball vs base structures: delegates to the shared module helper above
  // (same math the NPC balls use in single-player mode)
  resolveStructureColliders() {
    resolveStructureColliders(this.pos, this.vel, this.colliders);
  }

  // pre-integration velocity constraint: bleed off approach velocity inside
  // the contact margin so deep tunneling can't happen at large dt
  preCollide() {
    const R2 = BALL_R * 2;
    for (const r of this.remotes) {
      const dx = this.pos.x - r.pos.x;
      const dz = this.pos.z - r.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < R2 + CONTACT_MARGIN && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        const vn = this.vel.x * nx + this.vel.y * nz;
        if (vn < 0) {
          // full stop of approach at R2, fading to none at the margin edge
          const k = 1 - (d - R2) / CONTACT_MARGIN;
          this.vel.x -= nx * vn * k;
          this.vel.y -= nz * vn * k;
        }
      }
    }
  }

  collide() {
    const R2 = BALL_R * 2;
    for (const r of this.remotes) {
      const dx = this.pos.x - r.pos.x;
      const dz = this.pos.z - r.pos.z;
      let d = Math.hypot(dx, dz);
      if (d < R2) {
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        d = Math.max(d, 1e-4);
        // positional push-out (own ball moves full overlap; remote client
        // moves theirs symmetrically)
        const overlap = R2 - d;
        this.pos.x += nx * overlap;
        this.pos.z += nz * overlap;
        // bounce: kill approach velocity along n + restitution pop
        const rvx = this.vel.x - (r.vel?.x || 0);
        const rvz = this.vel.y - (r.vel?.z || 0);
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const impulse = -(1 + 0.6) * vn + 0.5;
          this.vel.x += nx * impulse;
          this.vel.y += nz * impulse;
        } else {
          this.vel.x += nx * 0.5;
          this.vel.y += nz * 0.5;
        }
      }
    }
    // world bounds
    const wr = Math.hypot(this.pos.x, this.pos.z);
    if (wr > WORLD_R) {
      this.pos.x *= WORLD_R / wr;
      this.pos.z *= WORLD_R / wr;
      this.vel.multiplyScalar(0.3);
    }
  }

  update(dt) {
    if (!this.enabled || !this.ball) return;
    this.t += dt;

    // input → camera-relative planar acceleration
    const fwd = new THREE.Vector2(-Math.sin(this.camAz), -Math.cos(this.camAz));
    const right = new THREE.Vector2(-fwd.y, fwd.x);  // screen-right = fwd × up
    const ax = new THREE.Vector2();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ax.add(fwd);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ax.sub(fwd);
    if (this.keys.has('KeyD')) ax.add(right);
    if (this.keys.has('KeyA')) ax.sub(right);
    if (this.keys.has('ArrowLeft')) this.camAz += dt * 1.8;
    if (this.keys.has('ArrowRight')) this.camAz -= dt * 1.8;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (ax.lengthSq() > 0) {
      ax.normalize().multiplyScalar(ACCEL * (sprint ? 1.25 : 1) * dt);
      this.vel.add(ax);
    }

    // damping + speed clamp
    const damp = Math.exp(-3.4 * dt);
    this.vel.multiplyScalar(damp);
    const sp = this.vel.length();
    const maxSp = MAX_SPEED * (sprint ? SPRINT_MUL : 1);
    if (sp > maxSp) this.vel.multiplyScalar(maxSp / sp);

    // integrate
    this.preCollide();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    this.collide();
    this.resolveStructureColliders();

    // vertical: hover bob on the ground, floaty low-g jump when airborne
    const groundY = this.heightAt(this.pos.x, this.pos.z) + HOVER;
    if (this.jumpQueued && !this.airborne) {
      this.yVel = JUMP_V;
      this.airborne = true;
    }
    this.jumpQueued = false;
    if (this.airborne) {
      this.yVel -= GRAV * dt;
      this.pos.y += this.yVel * dt;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.yVel = 0;
        this.airborne = false;
      }
    } else {
      this.pos.y = groundY + Math.sin(this.t * 1.6 + this.bobPh) * 0.1;
    }
    this.ball.position.copy(this.pos);

    // heading + tilt into velocity; when idle, turn to face the camera (mascot read)
    if (sp > 0.35) {
      this.idleT = 0;
      const target = Math.atan2(this.vel.x, this.vel.y);
      this.heading = dampAngle(this.heading, target, 9, dt);
    } else {
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > 0.8) this.heading = dampAngle(this.heading, this.camAz, 2.5, dt);
    }
    this.ball.rotation.y = this.heading;
    const tiltAmt = Math.min(sp / MAX_SPEED, 1) * 0.22;
    this.tilt.rotation.x = -tiltAmt;
    this.tilt.rotation.z = Math.sin(this.t * 2.1 + this.bobPh) * 0.03;

    // camera azimuth trails movement (slight 3/4 offset so the face stays readable)
    if (sp > 0.6 && this.t - this.lastDrag > 2.5 &&
        !this.keys.has('ArrowLeft') && !this.keys.has('ArrowRight')) {
      const moveAz = Math.atan2(this.vel.x, this.vel.y) + Math.PI + 0.42;
      this.camAz = dampAngle(this.camAz, moveAz, 0.9, dt);
    }

    // follow camera (damped)
    const cp = Math.cos(this.camPitch);
    const off = new THREE.Vector3(
      Math.sin(this.camAz) * cp * this.camDist,
      Math.sin(this.camPitch) * this.camDist + 1.2,
      Math.cos(this.camAz) * cp * this.camDist
    );
    const desired = this.pos.clone().add(off);
    desired.y = Math.max(desired.y, this.heightAt(desired.x, desired.z) + 1.3);
    const k = 1 - Math.exp(-5.5 * dt);
    this.camPos.lerp(desired, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pos.x, this.pos.y + 0.3, this.pos.z);
  }
}

// ---------------------------------------------------------------- remote player
export class RemotePlayer {
  constructor(scene, heightAt, profile) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.ball = createKimiBall(profile.colorHex, profile.name);
    this.tilt = this.ball.children[0];
    this.pos = new THREE.Vector3(profile.x, 0, profile.z);
    this.vel = new THREE.Vector2();
    this.heading = profile.heading || 0;
    this.bobPh = Math.random() * 6.28;
    this.buf = [];                       // {t, x, z, vx, vz, heading}
    this.t = Math.random() * 10;
    scene.add(this.ball);
  }

  pushState(t, s) {
    this.buf.push({ t, x: s.x, z: s.z, y: s.y ?? null, vx: s.vx || 0, vz: s.vz || 0, heading: s.heading || 0 });
    if (this.buf.length > 24) this.buf.shift();
  }

  update(dt, now) {
    this.t += dt;
    // interpolation at now - 80ms (LAN: keep the buffer tight)
    const rt = now - 0.08;
    let a = null, b = null;
    for (let i = this.buf.length - 1; i >= 0; i--) {
      if (this.buf[i].t <= rt) { a = this.buf[i]; b = this.buf[i + 1] || a; break; }
    }
    if (!a) { a = this.buf[0]; b = this.buf[1] || a; }
    if (a) {
      const span = Math.max(1e-3, b.t - a.t);
      const k = THREE.MathUtils.clamp((rt - a.t) / span, 0, 1.4);
      this.pos.x = a.x + (b.x - a.x) * k;
      this.pos.z = a.z + (b.z - a.z) * k;
      this.vel.set(a.vx + (b.vx - a.vx) * k, a.vz + (b.vz - a.vz) * k);
      let dh = ((b.heading - a.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.heading = a.heading + dh * k;
    }
    // streamed y carries hover bob AND jumps; ground formula is the fallback
    // for peers on an older client that doesn't send y
    let sy = null;
    if (a && a.y != null && b.y != null) {
      const span2 = Math.max(1e-3, b.t - a.t);
      const k2 = THREE.MathUtils.clamp((now - 0.08 - a.t) / span2, 0, 1.4);
      sy = a.y + (b.y - a.y) * k2;
    }
    this.pos.y = sy ?? (this.heightAt(this.pos.x, this.pos.z) + HOVER + Math.sin(this.t * 1.6 + this.bobPh) * 0.1);
    this.ball.position.copy(this.pos);
    this.ball.rotation.y = this.heading;
    const sp = this.vel.length();
    this.tilt.rotation.x = -Math.min(sp / MAX_SPEED, 1) * 0.22;
  }

  dispose() { this.scene.remove(this.ball); }
}
