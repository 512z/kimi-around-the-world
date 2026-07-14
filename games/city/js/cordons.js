import * as THREE from 'three';
import { GAME, PLAYER } from './config.js';
import { clamp, lerp, GlobalUniforms, FogUniforms, FOG_PARS } from './utils.js';

// Traffic-grid cordon: a hex-field wall sealing the canyon with one closing
// breach ring. Fly the ring = break the cordon; touch the field = signal lost.
export class Cordons {
  constructor(scene, glyphTex, city) {
    this.scene = scene;
    this.city = city;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: GlobalUniforms.uTime,
        tGlyphs: { value: glyphTex },
        uGap: { value: new THREE.Vector3(0, 30, 10) },  // x, y, radius (plane-local world units)
        uAlarm: { value: 0 },                            // 0 calm cyan -> 1 red alert
        uBroken: { value: 0 },                           // burst anim after breach
        uSize: { value: new THREE.Vector2(76, 92) },
        ...FogUniforms,
      },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        uniform float uTime, uAlarm, uBroken;
        uniform vec3 uGap;
        uniform vec2 uSize;
        uniform sampler2D tGlyphs;
        ${FOG_PARS}
        // hex grid distance
        float hexDist(vec2 p){
          p = abs(p);
          return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
        }
        vec4 hexCoords(vec2 uv){
          vec2 r = vec2(1.0, 1.73);
          vec2 h = r * 0.5;
          vec2 a = mod(uv, r) - h;
          vec2 b = mod(uv - h, r) - h;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;
          return vec4(gv.x, gv.y, uv.x - gv.x, uv.y - gv.y);
        }
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec2 lp = (vUv - 0.5) * uSize;        // plane-local meters, origin center
          vec2 gapC = uGap.xy;
          float gd = distance(lp, gapC);

          // hex cells
          vec4 hc = hexCoords(lp * 0.42);
          float hd = hexDist(hc.xy);
          float cellRnd = h21(hc.zw);
          float edge = smoothstep(0.46, 0.5, hd);
          float fill = 0.05 + 0.1 * step(0.93, fract(cellRnd + uTime * 0.13));

          vec3 calm = vec3(0.14, 0.8, 1.0);
          vec3 alert = vec3(1.0, 0.14, 0.2);
          vec3 col = mix(calm, alert, uAlarm);

          float pulse = 0.65 + 0.35 * sin(uTime * (2.0 + uAlarm * 7.0) - gd * 0.24);

          // breach ring
          float ring = smoothstep(2.2, 0.7, abs(gd - uGap.z));
          float inGap = smoothstep(uGap.z, uGap.z - 1.6, gd);

          float field = (edge * 0.9 + fill) * (1.0 - inGap);
          float a = field * 0.46 * pulse + ring * 1.2;
          // alarm veil: the whole sheet wakes up as you close on it
          a += uAlarm * 0.07 * (1.0 - inGap) * pulse;

          // scrolling warning glyphs on two bands
          float band = step(abs(fract(lp.y * 0.045 + 0.5) - 0.5), 0.06);
          float gg = texture2D(tGlyphs, vec2(lp.x * 0.012 + uTime * 0.05, fract(lp.y * 0.045) * 4.0)).a;
          a += band * gg * 0.5 * (1.0 - inGap);

          // breach burst: expanding shockwave rings, field dissolves
          if (uBroken > 0.0) {
            float t = uBroken;
            float w = smoothstep(0.1, 0.0, abs(gd - t * 70.0) / 3.4);
            a = a * max(0.0, 1.0 - t * 2.6) + w * max(0.0, 1.0 - t) * 0.7;
          }

          vec3 outc = col * (a * 1.7) + vec3(1.0) * ring * 0.35;
          float fade = exp(-distance(vW, cameraPosition) * uFogDensity * 1.1);
          gl_FragColor = vec4(outc * fade, clamp(a, 0.0, 1.0) * fade);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.layers.enable(1);
    scene.add(this.mesh);

    // edge stanchions
    const post = new THREE.BoxGeometry(0.9, 1, 0.9);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x11151c, metalness: 0.6, roughness: 0.4, emissive: 0xff2233, emissiveIntensity: 1.6 });
    this.posts = [new THREE.Mesh(post, postMat), new THREE.Mesh(post, postMat)];
    for (const p of this.posts) { p.visible = false; this.scene.add(p); }

    this.gateZ = 0;
    this.gap = new THREE.Vector2(0, 30);
    this.state = 'idle'; // idle | armed | broken
    this.brokenT = 0;
    this.count = 0;
  }

  reset(playerZ) {
    this.count = 0;
    this.state = 'armed';
    this.brokenT = 0;
    this._schedule(playerZ - GAME.cordonFirst);
  }

  _schedule(z) {
    this.gateZ = z;
    const ceil = Math.max(PLAYER.ceiling0 - this.count * PLAYER.ceilingDrop, PLAYER.ceilingMin);
    // pick the breach point with the best clearance from solid geometry —
    // a ring inside a deck or skybridge would be unflyable; the window also
    // reaches past the gate so a clean ring doesn't dump you into a deck 17m on
    const obs = this.city ? this.city.obstaclesNear(z - 26, z + 14) : [];
    let bestX = 0, bestY = Math.min(30, ceil - 6), bestClear = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const gx = (Math.random() - 0.5) * 26;
      const gy = clamp(6 + Math.random() * (ceil - 12), 7, ceil - 6);
      let clear = 1e9;
      for (const o of obs) {
        if (o.isHolo) continue;
        const dx = Math.max(o.min.x - gx, 0, gx - o.max.x);
        const dy = Math.max(o.min.y - gy, 0, gy - o.max.y);
        clear = Math.min(clear, Math.hypot(dx, dy));
      }
      if (clear > bestClear) { bestClear = clear; bestX = gx; bestY = gy; }
      if (clear > 6) break;
    }
    this.gap.set(bestX, bestY);
    this.mesh.visible = true;
    this.mesh.position.set(0, 46, z);
    this.mesh.scale.set(76, 92, 1);
    this.mat.uniforms.uSize.value.set(76, 92);
    this.mat.uniforms.uBroken.value = 0;
    for (const p of this.posts) p.visible = true;
    this.posts[0].position.set(-27, 0, z); this.posts[0].scale.y = 14; this.posts[0].position.y = 7;
    this.posts[1].position.set(27, 0, z); this.posts[1].scale.y = 14; this.posts[1].position.y = 7;
    this.state = 'armed';
  }

  // radius given player distance (closes as you approach)
  currentRadius(playerZ) {
    const d = Math.max(0, playerZ - this.gateZ);
    return lerp(GAME.gapRMin, GAME.gapR0, clamp(d / 420, 0, 1));
  }

  update(dt, player, onBreak, onHit) {
    if (this.state === 'idle') return;
    const u = this.mat.uniforms;
    if (this.state === 'armed') {
      const r = this.currentRadius(player.pos.z);
      // gap center in plane-local coords (plane centered y=46)
      u.uGap.value.set(this.gap.x, this.gap.y - 46, r);
      const d = player.pos.z - this.gateZ;
      u.uAlarm.value = clamp(1 - d / 300, 0, 1);

      if (d <= 0) { // crossed the plane this frame
        const dx = player.pos.x - this.gap.x, dy = player.pos.y - this.gap.y;
        const rr = Math.hypot(dx, dy);
        if (rr < r + 0.4) {
          this.count++;
          this.state = 'broken';
          this.brokenT = 0;
          u.uAlarm.value = 0; // breach reads as success-cyan, not alarm
          onBreak(this.count);
        } else {
          onHit();
        }
      }
    } else if (this.state === 'broken') {
      this.brokenT += dt;
      u.uBroken.value = this.brokenT;
      if (this.brokenT > 1.1) {
        const spacing = Math.max(GAME.cordonSpacingMin, GAME.cordonSpacing0 - this.count * 30);
        this._schedule(player.pos.z - spacing);
      }
    }
  }

  distanceTo(playerZ) { return this.state === 'armed' ? Math.max(0, playerZ - this.gateZ) : 0; }
  hide() { this.mesh.visible = false; for (const p of this.posts) p.visible = false; this.state = 'idle'; }
}
