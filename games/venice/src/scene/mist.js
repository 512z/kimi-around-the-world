// Drifting canal mist: one Points draw call, billboarded in the vertex shader.
// Extra density under bridges; overall density controllable (gameplay + quality).
import * as THREE from 'three';
import { BRIDGES } from './canal.js';
import { mulberry32 } from './textures.js';
import { FOG_COLOR, FOG_DENSITY } from './sky.js';

export function makeMist(canal, texture) {
  const rng = mulberry32(888);
  const pts = [];
  // along-canal scatter
  for (let i = 0; i < 130; i++) {
    const s = rng() * 640;
    const sm = canal.atS(s);
    const lat = (rng() - 0.5) * (sm.width + 10);
    const nx = Math.cos(sm.ang), nz = -Math.sin(sm.ang);
    pts.push({
      x: sm.x + nx * lat, z: sm.z + nz * lat,
      y: 0.4 + rng() * 2.6,
      scale: 3.5 + rng() * 7,
      phase: rng() * 6.28,
      amp: 0.6 + rng() * 1.8,
      base: 0.06 + rng() * 0.12,
    });
  }
  // dense banks under bridges
  for (const br of BRIDGES) {
    const sm = canal.atS(br.s);
    for (let i = 0; i < 12; i++) {
      pts.push({
        x: sm.x + (rng() - 0.5) * 6,
        z: sm.z + (rng() - 0.5) * (br.thick + 5),
        y: 0.5 + rng() * 2.2,
        scale: 2.5 + rng() * 4.5,
        phase: rng() * 6.28,
        amp: 0.4 + rng(),
        base: 0.13 + rng() * 0.12,
      });
    }
  }
  const n = pts.length;
  const pos = new Float32Array(n * 3);
  const attr = new Float32Array(n * 4); // scale, phase, amp, baseAlpha
  pts.forEach((p, i) => {
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    attr[i * 4] = p.scale; attr[i * 4 + 1] = p.phase; attr[i * 4 + 2] = p.amp; attr[i * 4 + 3] = p.base;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMist', new THREE.BufferAttribute(attr, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTex: { value: texture },
      uColor: { value: new THREE.Vector3(0.80, 0.80, 0.78) },
      uFogColor: { value: new THREE.Vector3(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b) },
      uFogDensity: { value: FOG_DENSITY },
      uDensity: { value: 1.0 },
    },
    vertexShader: /* glsl */`
      attribute vec4 aMist;
      uniform float uTime;
      varying float vAlpha;
      varying float vFog;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.11 + aMist.y) * aMist.z;
        p.z += cos(uTime * 0.09 + aMist.y * 1.3) * aMist.z * 0.8 + uTime * 0.22;
        p.y += sin(uTime * 0.17 + aMist.y * 2.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_PointSize = min(380.0, aMist.x * (300.0 / max(1.0, dist)));
        gl_Position = projectionMatrix * mv;
        vAlpha = aMist.w * (0.65 + 0.35 * sin(uTime * 0.23 + aMist.y * 3.0))
               * smoothstep(5.0, 16.0, dist);   // fade close puffs
        vFog = 1.0 - exp(-${FOG_DENSITY.toFixed(4)} * ${FOG_DENSITY.toFixed(4)} * dist * dist);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      uniform vec3 uColor;
      uniform vec3 uFogColor;
      uniform float uDensity;
      varying float vAlpha;
      varying float vFog;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        float a = t.a * vAlpha * uDensity;
        if (a < 0.01) discard;
        vec3 col = mix(uColor, uFogColor, vFog * 0.8);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.noReflect = true;
  points.renderOrder = 5;
  points.update = (t) => { mat.uniforms.uTime.value = t; };
  points.setDensity = (d) => { mat.uniforms.uDensity.value = d; };
  return points;
}
