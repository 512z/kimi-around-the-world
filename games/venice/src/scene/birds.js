// Pigeon flock: instanced flapping birds that perch around the campo,
// burst skyward when disturbed, wheel over the canal, and settle again.
import * as THREE from 'three';
import { mulberry32 } from './textures.js';

const N_BIRDS = 46;

function makeBirdGeo() {
  // 3 triangles: body + 2 wings; aWing: -1 left wing, 0 body, 1 right wing
  const pos = [
    // body (dart shape)
    0, 0, 0.22,  -0.035, 0, -0.14,  0.035, 0, -0.14,
    // left wing
    0, 0, 0.05,  -0.42, 0, -0.02,  -0.06, 0, -0.16,
    // right wing
    0, 0, 0.05,   0.06, 0, -0.16,   0.42, 0, -0.02,
  ];
  const wing = [0, 0, 0, -1, -1, -1, 1, 1, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.computeVertexNormals();
  return g;
}

export function makeBirds(campoCenter) {
  const rng = mulberry32(444);
  const geo = makeBirdGeo();
  const mat = new THREE.MeshBasicMaterial({ color: 0x6a6a72, side: THREE.DoubleSide, fog: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aWing;
        uniform float uTime;
        attribute float aPhase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float flap = sin(uTime * 14.0 + aPhase) ;
        transformed.y += flap * abs(aWing) * 0.3;
        transformed.z += abs(flap) * abs(aWing) * 0.06;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N_BIRDS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.noReflect = true;

  const phases = new Float32Array(N_BIRDS);
  for (let i = 0; i < N_BIRDS; i++) phases[i] = rng() * 6.28;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  // perch points: roofs/edges around the campo + on the well
  const perches = [];
  const C = campoCenter;
  for (let i = 0; i < N_BIRDS; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4 + rng() * 12;
    perches.push({
      x: C.x + Math.cos(a) * r * 0.8 - 4,
      y: 0.6 + (rng() > 0.55 ? rng() * 6 + 3 : rng() * 0.5), // mostly on ground/ledge, some on roofs
      z: C.z + Math.sin(a) * r,
    });
  }

  const birds = perches.map((p, i) => ({
    perch: p,
    pos: new THREE.Vector3(p.x, p.y, p.z),
    vel: new THREE.Vector3(),
    phase: phases[i],
    orbitR: 9 + rng() * 11,
    orbitH: 12 + rng() * 14,
    orbitDir: rng() > 0.5 ? 1 : -1,
    landed: true,
  }));

  const state = { mode: 'perched', t: 0, burstT: 0 };
  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();

  function burst() {
    if (state.mode !== 'perched') return;
    state.mode = 'burst';
    state.t = 0;
    for (const b of birds) b.landed = false;
  }

  function update(dt, time) {
    state.t += dt;
    // flap time uniform lives on the compiled shader
    if (mesh.material.userData.shader) mesh.material.userData.shader.uniforms.uTime.value = time;

    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (state.mode === 'perched') {
        b.pos.set(b.perch.x, b.perch.y, b.perch.z);
        dummy.rotation.set(0, b.phase, 0);
      } else if (state.mode === 'burst') {
        const t = Math.min(1, state.t / 3.2);
        const e = t * t * (3 - 2 * t);
        const a = b.phase + state.t * 1.6 * b.orbitDir;
        const tx = C.x + 2 + Math.cos(a) * b.orbitR * e;
        const tz = C.z + Math.sin(a) * b.orbitR * e;
        const ty = b.perch.y + e * b.orbitH + Math.sin(state.t * 3 + b.phase) * 0.6 * e;
        b.pos.set(tx, ty, tz);
        tmp.set(-Math.sin(a) * b.orbitDir, 0.15, Math.cos(a) * b.orbitDir).normalize();
        dummy.rotation.set(0, Math.atan2(tmp.x, tmp.z), 0.25 * b.orbitDir * e);
        if (state.t > 3.2) { state.mode = 'wheel'; state.t = 0; }
      } else if (state.mode === 'wheel') {
        const a = b.phase + state.t * 0.9 * b.orbitDir;
        const rr = b.orbitR + Math.sin(state.t * 0.4 + b.phase) * 3;
        b.pos.set(
          C.x + 2 + Math.cos(a) * rr,
          b.orbitH + Math.sin(state.t * 0.7 + b.phase * 2) * 3.5,
          C.z + Math.sin(a) * rr * 0.8 + Math.sin(state.t * 0.3) * 4,
        );
        tmp.set(-Math.sin(a) * b.orbitDir, 0.05, Math.cos(a) * b.orbitDir).normalize();
        dummy.rotation.set(0, Math.atan2(tmp.x, tmp.z), Math.sin(state.t * 0.5 + b.phase) * 0.4);
        if (state.t > 16) { state.mode = 'land'; state.t = 0; }
      } else { // land
        const t = Math.min(1, state.t / 4.0);
        const e = t * t * (3 - 2 * t);
        const a = b.phase + (16 * 0.9) * b.orbitDir + state.t * 0.5 * b.orbitDir;
        const sx = C.x + 2 + Math.cos(a) * b.orbitR * (1 - e);
        const sz = C.z + Math.sin(a) * b.orbitR * (1 - e);
        const sy = b.orbitH * (1 - e) + b.perch.y;
        b.pos.set(
          THREE.MathUtils.lerp(sx, b.perch.x, e),
          Math.max(b.perch.y, THREE.MathUtils.lerp(sy, b.perch.y, e)),
          THREE.MathUtils.lerp(sz, b.perch.z, e),
        );
        const dx = b.perch.x - b.pos.x, dz = b.perch.z - b.pos.z;
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        if (state.t > 4.0) {
          state.mode = 'perched'; state.t = 0;
          for (const bb of birds) bb.landed = true;
        }
      }
      dummy.position.copy(b.pos);
      const sc = b.landed ? 0.8 : 1;
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  mesh.userData.burst = burst;
  mesh.userData.update = update;
  mesh.userData.getMode = () => state.mode;
  return mesh;
}
