// SELENE GP — ballistic regolith dust. Particles are kicked up by the cars
// and fall in clean parabolas (no drag, no billowing — vacuum).

import * as THREE from 'three';
import { clamp01 } from './util.js';

const MAX = 3200;
const G = 2.6;

export class Dust {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);   // remaining seconds
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aMaxLife', new THREE.BufferAttribute(this.maxLife, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setDrawRange(0, MAX);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x7d786f) },
        uPix: { value: 1 },
      },
      vertexShader: `
        attribute float aLife;
        attribute float aMaxLife;
        attribute float aSize;
        varying float vFade;
        uniform float uPix;
        void main() {
          vFade = clamp(aLife / max(aMaxLife, 0.001), 0.0, 1.0);
          vFade = smoothstep(0.0, 0.25, vFade) * vFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPix * 200.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vFade;
        uniform vec3 uColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float a = (1.0 - r * 4.0) * vFade * 0.32;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._emitAcc = new Map();
  }

  setPixelRatio(pr) { this.points.material.uniforms.uPix.value = pr; }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
  }

  // call once per frame per car
  emitFromCar(car, dt, terrain) {
    if (!car.grounded) return;
    const sp = car.speed;
    if (sp < 8) return;
    const intensity = (0.35 + car.slip * 1.4 + car.offroad * 2.2 + car.impact * 3.0) * clamp01(sp / 40);
    let acc = (this._emitAcc.get(car) || 0) + intensity * dt * 90;
    this._emitAcc.set(car, acc);
    const fwd = { x: Math.sin(car.yaw), z: Math.cos(car.yaw) };
    while (acc >= 1) {
      acc -= 1;
      const side = (Math.random() - 0.5) * 2.4;
      const back = -1.8 - Math.random() * 0.8;
      const x = car.pos.x + fwd.z * side + fwd.x * back;
      const z = car.pos.z - fwd.x * side + fwd.z * back;
      const y = terrain.sampleHeight(x, z) + 0.25;
      const out = (Math.random() - 0.5) * 2;
      this.emit(
        x, y, z,
        car.vel.x * 0.06 + fwd.z * out * sp * 0.05 + (Math.random() - 0.5) * 1.5,
        0.6 + Math.random() * 1.7 + car.impact * 4,
        car.vel.z * 0.06 - fwd.x * out * sp * 0.05 + (Math.random() - 0.5) * 1.5,
        0.3 + Math.random() * 0.55 + car.offroad * 0.5,
        1.1 + Math.random() * 1.5,
      );
    }
    this._emitAcc.set(car, acc);
  }

  update(dt, terrain) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.vel[i * 3 + 1] -= G * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const g = terrain.sampleHeight(this.pos[i * 3], this.pos[i * 3 + 2]);
      if (this.pos[i * 3 + 1] < g) { this.life[i] = 0; this.size[i] = 0; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
    this.points.geometry.attributes.aMaxLife.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}
