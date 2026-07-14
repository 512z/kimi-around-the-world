import * as THREE from 'three';
import { WORLD, PLAYER, GAME } from './config.js';
import { clamp, lerp, damp, smoothstep, GlobalUniforms, FogUniforms } from './utils.js';
import { PlayerTaxi } from './player.js';
import { Pursuers } from './enemies.js';
import { Cordons } from './cordons.js';
import { GlowPool } from './life.js';

// Game orchestration: states, cameras, collisions, scoring.
export class Game {
  constructor(scene, engine, city, life, camera, audio) {
    this.scene = scene; this.engine = engine; this.city = city; this.life = life;
    this.camera = camera; this.audio = audio;

    this.player = new PlayerTaxi(scene);
    this.glows = new GlowPool(scene, 220);
    this.pursuers = new Pursuers(scene, city, this.glows);
    this.cordons = new Cordons(scene, city.glyphs, city);

    this.state = 'attract';
    this.attractT = Math.random() * 400;
    this.attractZ = -60;
    this.camVel = new THREE.Vector3();
    this._lastCamPos = new THREE.Vector3();
    this.ui = null;

    // run stats
    this.stats = { score: 0, dist: 0, nearMiss: 0, cordons: 0, ghosts: 0, time: 0, topSpeed: 0 };
    this.ceiling = PLAYER.ceiling0;
    this.ceilingTarget = PLAYER.ceiling0;
    this.shake = 0;
    this.slowmo = 1;
    this._nearCand = new Map();
    this._awarded = new Set();
    this._ghosted = new Set();
    this._pursuerCd = new Map();
    this._sparks = [];

    // input
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const menu = this.ui && this.ui.active;
      if (e.code === 'KeyR' && ['playing', 'crashed', 'results', 'paused'].includes(this.state)
          && (!menu || menu === 'results' || menu === 'pause')) {
        this.ui && this.ui.hideAll();
        this.ui && this.ui._toPlayingChrome();
        this.startRun(true);
        return;
      }
      if (menu) return; // a menu screen owns the rest
      if (e.code === 'Escape' && this.state === 'playing') this.pauseGame();
      if (e.code === 'Space' && this.state === 'playing') { this.burnQueued = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      this.mouse.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.state === 'playing') this.pauseGame();
    });

    this.player.hide();

    // ceiling marker: faint additive grid at the clearance ceiling so the
    // "chase drops lower" is something you see coming, not a surprise shove
    const cgMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: GlobalUniforms.uTime, uProx: { value: 0 }, uHit: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vW; uniform float uTime, uProx, uHit;
        void main(){
          vec2 gp = vW.xz * 0.35;
          vec2 f = abs(fract(gp) - 0.5);
          float line = smoothstep(0.455, 0.5, max(f.x, f.y));
          float sweep = 0.8 + 0.2 * sin(uTime * 3.0);
          float a = line * (0.10 + 0.34 * uProx + 0.55 * uHit) * sweep;
          vec3 col = mix(vec3(0.25, 0.7, 1.0), vec3(1.0), clamp(uHit * 0.8 + uProx * 0.3, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 2.0, a);
        }
      `,
    });
    this.ceilGrid = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), cgMat);
    this.ceilGrid.rotation.x = -Math.PI / 2;
    this.ceilGrid.frustumCulled = false;
    this.ceilGrid.visible = false;
    scene.add(this.ceilGrid);
  }

  // ---------------------------------------------------------- state flow --
  startRun(instant = false) {
    this.stats = { score: 0, dist: 0, nearMiss: 0, cordons: 0, ghosts: 0, time: 0, topSpeed: 0 };
    this.ceiling = PLAYER.ceiling0;
    this.ceilingTarget = PLAYER.ceiling0;
    this.burnQueued = false;
    this.crashReason = null;
    this._nearCand.clear(); this._awarded.clear(); this._ghosted.clear(); this._pursuerCd.clear();
    this.slowmo = 1;

    // spawn just ahead of wherever the attract camera is, clear of any deck
    const z0 = (this.state === 'attract' || instant) ? this.attractZ - 40 : this.player.pos.z;
    let spawnY = PLAYER.startY;
    for (const d of this.city.crossDeckList()) {
      if (d.z < z0 + 20 && d.z > z0 - 200 && Math.abs(d.y - spawnY) < 9) {
        spawnY = d.y - 12 > 14 ? d.y - 12 : d.y + 12;
      }
    }
    this.player.reset(z0);
    this.player.pos.y = spawnY;
    this.player.speedHold = PLAYER.cruise;
    this.pursuers.reset();
    this.cordons.hide();

    this.countdownT = instant ? 0.35 : 3.4;
    this._cdLast = Math.ceil(this.countdownT);
    this.state = 'countdown';
    // remember camera pose to blend from
    this._camFrom = this.camera.matrixWorld.clone();
    this._camFromPos = this.camera.position.clone();
    this._camFromQuat = this.camera.quaternion.clone();
    this._cdTotal = this.countdownT;
    this.ui && this.ui.onCountdownStart();
    this.audio && this.audio.event('countdown');
  }

  beginPlay() {
    this.state = 'playing';
    this.cordons.reset(this.player.pos.z);
    this.pursuers.setCount(GAME.pursuers0, this.player);
    this.ui && this.ui.onGo();
    this.audio && this.audio.event('go');
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui && this.ui.onPause();
    this.audio && this.audio.event('pause');
  }
  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio && this.audio.event('confirm');
  }
  quitToMenu() {
    this.state = 'attract';
    this.player.hide();
    this.pursuers.reset();
    this.cordons.hide();
    // attract camera resumes from near the run's end
    this.attractZ = this.player.pos.z - 30;
    this.ui && this.ui.onMenu();
  }

  crash(reason) {
    if (this.state !== 'playing') return;
    this.state = 'crashed';
    this.crashT = 0;
    this.player.alive = false;
    this.crashPos = this.player.pos.clone();
    this.crashReason = reason;
    this.engine.params.flash = 0.32;
    this.shake = 2.4;
    this.slowmo = 0.22;
    // spark burst
    this._sparks.length = 0;
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const sp = 3 + Math.random() * 18;
      this._sparks.push({
        p: this.crashPos.clone(),
        v: new THREE.Vector3(Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 6, Math.sin(a) * Math.cos(b) * sp - this.player.speed * 0.5),
        life: 0.5 + Math.random() * 0.9,
        t: 0, hot: Math.random(),
      });
    }
    this.audio && this.audio.event('crash');
    this.ui && this.ui.onCrash(reason);
  }

  // ------------------------------------------------------------- updates --
  update(dt, time) {
    // time scaling for crash slow-mo
    if (this.state === 'crashed') this.slowmo = damp(this.slowmo, 1, 1.2, dt);
    const sdt = dt * (this.state === 'crashed' ? this.slowmo : 1);

    switch (this.state) {
      case 'attract': this._updateAttract(dt, time); break;
      case 'countdown': this._updateCountdown(dt, time); break;
      case 'playing': this._updatePlaying(sdt, time); break;
      case 'paused': break;
      case 'crashed': this._updateCrashed(dt, sdt, time); break;
      case 'results': this._updateCrashCam(dt); break;
    }
    if (this.state !== 'playing') this.ceilGrid.visible = false;

    // world systems always follow the camera
    const camZ = this.camera.position.z;
    this.city.update(camZ, time);
    const playing = this.state === 'playing';
    this.camVel.copy(this.camera.position).sub(this._lastCamPos).divideScalar(Math.max(dt, 1e-4));
    this._lastCamPos.copy(this.camera.position);
    this.life.update(dt, time, camZ, this.camera.position, this.camVel, playing);

    // sparks
    this.glows.begin();
    this._updateSparks(dt);
    if (playing || this.state === 'crashed' || this.state === 'countdown' || this.state === 'paused' || this.state === 'results') {
      this.pursuers.update(playing ? sdt : 0, this.player, time, this.stats.cordons);
    }
    this.glows.end();

    // engine post params
    const p = this.engine.params;
    p.flash = Math.max(0, p.flash - dt * 4.2);
    const rainBase = 0.72 + this.stats.cordons * 0.07;
    p.rain = damp(p.rain, clamp(playing || this.state === 'crashed' ? rainBase : 0.72, 0, 1.0), 1.2, dt);
    GlobalUniforms.uRainAmt.value = Math.min(1.1, 0.95 + this.stats.cordons * 0.03);
    p.warp = damp(p.warp, this.player.boosting && playing ? 1 : 0, 4, dt);
    this.shake = Math.max(0, this.shake - dt * 3.2);

    // fog thickens slightly per cordon (the chase drops into the soup)
    FogUniforms.uFogDensity.value = 0.0027 + this.stats.cordons * 0.00012;

    // world rebase to keep fp precision healthy
    if (this.player.pos.z < -WORLD.rebaseAt || this.attractZ < -WORLD.rebaseAt) this._rebase();
  }

  _updateAttract(dt, time) {
    this.attractT += dt;
    this.attractZ -= 24 * dt;
    const t = this.attractT;
    const z = this.attractZ;
    let x = Math.sin(t * 0.06) * 6.5 + Math.sin(t * 0.023) * 3.0;
    let y = 25 + Math.sin(t * 0.041) * 7 - Math.max(0, Math.sin(t * 0.013 + 1.0)) * 8;

    // dodge crossing decks / bridges smoothly
    let push = 0;
    for (const d of this.city.crossDeckList()) {
      const dz = z - d.z;
      if (dz < 60 && dz > -20) {
        const dy = y - d.y;
        if (Math.abs(dy) < 7) push += Math.sign(dy || 1) * (7 - Math.abs(dy)) * smoothstep(60, 10, Math.abs(dz));
      }
    }
    this._attractPush = damp(this._attractPush || 0, push, 2.5, dt);
    y += this._attractPush;

    // sidestep pylons ahead
    let pushX = 0;
    for (const o of this.city.obstaclesNear(z - 90, z + 10)) {
      if (o.kind !== 'pylon' || o.isHolo) continue;
      const oz = (o.min.z + o.max.z) / 2;
      const dz = z - oz;
      if (dz < 70 && dz > -6) {
        const ox = (o.min.x + o.max.x) / 2;
        const dx = x - ox;
        if (Math.abs(dx) < 6) pushX += Math.sign(dx || 1) * (6 - Math.abs(dx)) * smoothstep(70, 14, Math.abs(dz));
      }
    }
    this._attractPushX = damp(this._attractPushX || 0, pushX, 2.5, dt);
    x += this._attractPushX;

    this.camera.position.set(x, y, z);
    const lx = Math.sin((t + 4) * 0.06) * 6.5 + Math.sin((t + 4) * 0.023) * 3.0;
    const ly = 25 + Math.sin((t + 4) * 0.041) * 7 - Math.max(0, Math.sin((t + 4) * 0.013 + 1.0)) * 8 + this._attractPush;
    this.camera.lookAt(lx * 0.6, ly - 1.5, z - 70);
    this.camera.rotation.z += Math.sin(t * 0.05) * 0.05;
    this.camera.fov = damp(this.camera.fov, 60, 2, dt);
    this.camera.updateProjectionMatrix();
    // hidden player still needs light slots cleared
    const dl = GlobalUniforms.uDynPos.value;
    dl[0].w = 0; dl[1].w = 0;
  }

  _updateCountdown(dt, time) {
    this.countdownT -= dt;
    const c = Math.ceil(Math.max(this.countdownT, 0));
    if (c !== this._cdLast) {
      this._cdLast = c;
      this.ui && this.ui.onCountdownTick(c);
      this.audio && this.audio.event('tick');
    }
    // player cruises straight
    const inp = { keys: new Set(), mx: 0, my: 0 };
    this.player.update(dt, { keys: inp.keys, mx: 0, my: 0 }, this.ceiling);

    // blend camera from menu pose to chase pose
    const k = smoothstep(0, 1, 1 - clamp(this.countdownT / this._cdTotal, 0, 1));
    const chase = this._chasePose(dt, true);
    this.camera.position.lerpVectors(this._camFromPos, chase.pos, k);
    const q = this._camFromQuat.clone().slerp(chase.quat, k);
    this.camera.quaternion.copy(q);
    this.camera.fov = lerp(60, 64, k);
    this.camera.updateProjectionMatrix();

    if (this.countdownT <= 0) this.beginPlay();
  }

  _chasePose(dt, immediate = false) {
    const pl = this.player;
    const back = 8.6 + pl.speed * 0.022;
    const targetPos = new THREE.Vector3(
      pl.pos.x * 0.92 - pl.vel.x * 0.055,
      pl.pos.y + 2.9 - pl.vel.y * 0.03,
      pl.pos.z + back,
    );
    targetPos.y = Math.max(targetPos.y, 2.2);
    const look = new THREE.Vector3(
      pl.pos.x + pl.vel.x * 0.22,
      pl.pos.y + pl.vel.y * 0.16 - 0.4,
      pl.pos.z - 17,
    );
    const m = new THREE.Matrix4().lookAt(targetPos, look, new THREE.Vector3(0, 1, 0));
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);
    // roll with bank
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pl.bank * 0.5);
    quat.multiply(roll);
    return { pos: targetPos, quat };
  }

  _updatePlaying(dt, time) {
    const pl = this.player;
    // ceiling descends smoothly toward its target — the drop telegraphs itself
    this.ceiling = damp(this.ceiling, this.ceilingTarget, 1.5, dt);
    const input = { keys: this.keys, mx: this.mouse.x, my: this.mouse.y, burn: this.burnQueued };
    this.burnQueued = false;
    pl.update(dt, input, this.ceiling);
    this.stats.time += dt;
    this.stats.dist += pl.speed * dt;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, pl.speed);

    // ceiling marker grid
    const cg = this.ceilGrid;
    const ceilProx = clamp(1 - (this.ceiling - pl.pos.y) / 14, 0, 1);
    cg.visible = ceilProx > 0.01;
    if (cg.visible) {
      cg.position.set(pl.pos.x, this.ceiling, pl.pos.z - 10);
      cg.material.uniforms.uProx.value = ceilProx;
      cg.material.uniforms.uHit.value = damp(cg.material.uniforms.uHit.value, pl.ceilingHit || 0, 8, dt);
    }

    // camera
    const chase = this._chasePose(dt);
    const lagP = 7.5, lagQ = 9;
    this.camera.position.x = damp(this.camera.position.x, chase.pos.x, lagP, dt);
    this.camera.position.y = damp(this.camera.position.y, chase.pos.y, lagP, dt);
    this.camera.position.z = damp(this.camera.position.z, chase.pos.z, 14, dt);
    this.camera.quaternion.slerp(chase.quat, 1 - Math.exp(-lagQ * dt));
    const speedN = clamp((pl.speed - PLAYER.minSpeed) / (PLAYER.boostSpeed - PLAYER.minSpeed), 0, 1);
    const targetFov = 62 + speedN * 12 + (pl.boosting ? 5 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    // shake
    const prox = clamp(1 - this.pursuers.nearestDist(pl) / 20, 0, 1);
    const amp = 0.0016 * pl.speed * 0.02 + prox * 0.004 + this.shake * 0.012 + (pl.ceilingHit || 0) * 0.004;
    this.camera.rotation.x += (Math.random() - 0.5) * amp;
    this.camera.rotation.y += (Math.random() - 0.5) * amp;
    this.camera.rotation.z += (Math.random() - 0.5) * amp * 1.4;
    this.camera.updateProjectionMatrix();

    // ---------------- collisions
    const pz = pl.pos.z;
    const obs = this.city.obstaclesNear(pz - 90, pz + 50);
    this.pursuers.setNearObstacles(obs);
    let crashed = null;
    for (const o of obs) {
      if (o.isHolo) {
        if (!this._ghosted.has(o.id) &&
          pl.pos.x > o.min.x && pl.pos.x < o.max.x &&
          pl.pos.y > o.min.y && pl.pos.y < o.max.y &&
          pl.pos.z > o.min.z && pl.pos.z < o.max.z) {
          this._ghosted.add(o.id);
          this.stats.ghosts++;
          this.ui && this.ui.onToast('GHOSTED', '+100');
          this.audio && this.audio.event('ghost');
        }
        continue;
      }
      const dx = Math.max(o.min.x - pl.pos.x, 0, pl.pos.x - o.max.x);
      const dy = Math.max(o.min.y - pl.pos.y, 0, pl.pos.y - o.max.y);
      const dz = Math.max(o.min.z - pl.pos.z, 0, pl.pos.z - o.max.z);
      const d = Math.hypot(dx, dy, dz) - pl.radius;
      if (d <= 0) { crashed = o.kind; break; }
      if (d < GAME.nearMissDist && !this._awarded.has(o.id)) {
        const c = this._nearCand.get(o.id);
        if (!c || d < c) this._nearCand.set(o.id, d);
      }
      // passed → award
      if (o.min.z > pz + 3 && this._nearCand.has(o.id) && !this._awarded.has(o.id)) {
        this._awarded.add(o.id);
        this._nearCand.delete(o.id);
        this.stats.nearMiss++;
        this.ui && this.ui.onToast('NEAR MISS', `+${GAME.nearMissScore}`);
        this.audio && this.audio.event('nearmiss');
      }
    }
    if (crashed) { this.crash(crashed); return; }

    // pursuer contact + near-miss
    let hitPursuer = false;
    this.pursuers.forEachActive((u) => {
      const d = u.pos.distanceTo(pl.pos);
      if (d < pl.radius + 1.5) hitPursuer = true;
      else if (d < 5.2) {
        const rel = u.vel.distanceTo(pl.vel);
        const cd = this._pursuerCd.get(u) || 0;
        if (rel > 13 && time > cd) {
          this._pursuerCd.set(u, time + 1.2);
          this.stats.nearMiss++;
          this.ui && this.ui.onToast('NEAR MISS', `+${GAME.nearMissScore}`);
          this.audio && this.audio.event('nearmiss');
        }
      }
    });
    if (hitPursuer) { this.crash('pursuer'); return; }

    // street skim: sparks + drag, not death
    if (pl.pos.y < 2.0) {
      pl.pos.y = 2.0;
      pl.vel.y = Math.max(pl.vel.y, 0);
      pl.speedHold = Math.max(PLAYER.minSpeed, (pl.speedHold ?? PLAYER.cruise) - 8 * dt);
      this.shake = Math.max(this.shake, 0.3);
      if (Math.random() < 0.5) this._spawnSkim(pl);
    }

    // cordons
    this.cordons.update(dt, pl,
      (count) => { // break
        this.stats.cordons = count;
        this.ceilingTarget = Math.max(PLAYER.ceiling0 - count * PLAYER.ceilingDrop, PLAYER.ceilingMin);
        this.pursuers.setCount(Math.min(GAME.pursuers0 + count * GAME.pursuersPerCordon, GAME.pursuersMax), pl);
        this.shake = Math.max(this.shake, 0.8);
        this.ui && this.ui.onCordonBreak(count, Math.round(this.ceilingTarget));
        this.audio && this.audio.event('cordon');
      },
      () => this.crash('cordon'),
    );

    // score
    this.stats.score = Math.floor(
      this.stats.dist * GAME.distScore +
      this.stats.nearMiss * GAME.nearMissScore +
      this.stats.cordons * GAME.cordonScore +
      this.stats.ghosts * 100,
    );

    // HUD
    this.ui && this.ui.onHUD(this.stats, pl, this.cordons, this.ceiling, this.pursuers.nearestDist(pl));
    this.audio && this.audio.gameFrame(pl, this.pursuers.nearestDist(pl));
  }

  _spawnSkim(pl) {
    this._sparks.push({
      p: new THREE.Vector3(pl.pos.x + (Math.random() - 0.5) * 1.4, 1.2, pl.pos.z + 1),
      v: new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 5, 8),
      life: 0.4, t: 0, hot: 0.2,
    });
  }

  _updateCrashed(dt, sdt, time) {
    this.crashT += dt;
    // tumble the rig
    this.player.rig.rotation.x += sdt * 3.1;
    this.player.rig.rotation.z += sdt * 4.4;
    this.player.pos.addScaledVector(this.player.vel, sdt * 0.4);
    this.player.vel.multiplyScalar(1 - sdt * 1.4);
    this.player.pos.y = Math.max(this.player.pos.y - 9 * sdt * this.crashT, 1.4);
    this.player.rig.position.copy(this.player.pos);
    this._updateCrashCam(dt);
    if (this.crashT > 1.5) {
      this.state = 'results';
      this.ui && this.ui.onResults(this.stats);
    }
  }

  _updateCrashCam(dt) {
    // slow orbit around the wreck
    const t = (this.crashT || 0) * 0.4 + 2.2;
    const c = this.crashPos || this.player.pos;
    const pos = new THREE.Vector3(c.x + Math.cos(t) * 12, Math.max(c.y + 4, 6), c.z + 10 + Math.sin(t) * 5);
    this.camera.position.lerp(pos, 1 - Math.exp(-2.2 * dt));
    this.camera.lookAt(c.x, c.y, c.z);
    this.camera.fov = damp(this.camera.fov, 58, 2, dt);
    this.camera.updateProjectionMatrix();
  }

  _updateSparks(dt) {
    for (let i = this._sparks.length - 1; i >= 0; i--) {
      const s = this._sparks[i];
      s.t += dt;
      if (s.t > s.life) { this._sparks.splice(i, 1); continue; }
      s.v.y -= 22 * dt;
      s.p.addScaledVector(s.v, dt);
      const k = 1 - s.t / s.life;
      const col = s.hot > 0.6 ? [2.0, 1.3, 0.42] : [1.8, 0.5, 0.2];
      this.glows.push(s.p.x, s.p.y, s.p.z, col[0] * k, col[1] * k, col[2] * k, 0.35 + k * 0.35, 0);
    }
  }

  _rebase() {
    const R = WORLD.rebaseAt;
    this.player.pos.z += R;
    this.player.rig.position.z += R;
    this.attractZ += R;
    this.camera.position.z += R;
    this._lastCamPos.z += R;
    if (this.crashPos) this.crashPos.z += R;
    this.cordons.gateZ += R;
    this.cordons.mesh.position.z += R;
    this.pursuers.forEachActive((u) => { u.pos.z += R; });
    for (const s of this._sparks) s.p.z += R;
  }
}
