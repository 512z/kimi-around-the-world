// Canal water: planar reflection RT + procedural ripples + wake rings + jade depth.
import * as THREE from 'three';
import { SUN_DIR, SUN_COLOR, FOG_COLOR, FOG_DENSITY } from './sky.js';

const MAX_WAKES = 10;

export function makeWater(renderer, scene) {
  const rtSize = new THREE.Vector2(1024, 576);
  const rt = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;

  const texMatrix = new THREE.Matrix4();
  const reflCam = new THREE.PerspectiveCamera();

  const wakes = [];
  for (let i = 0; i < MAX_WAKES; i++) wakes.push(new THREE.Vector4(9999, 9999, 0, 99)); // x,z,radius,age
  let wakeCursor = 0;

  const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uRefl: { value: rt.texture },
    uTexMatrix: { value: texMatrix },
    uSunDir: { value: SUN_DIR },
    uSunColor: { value: new THREE.Vector3(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b) },
    uFogColor: { value: new THREE.Vector3(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b) },
    uFogDensity: { value: FOG_DENSITY },
    uCamPos: { value: new THREE.Vector3() },
    uWakes: { value: wakes },
    uDeep: { value: new THREE.Vector3(0.016, 0.085, 0.078) },   // jade depth
    uShallow: { value: new THREE.Vector3(0.035, 0.13, 0.11) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform mat4 uTexMatrix;
      varying vec3 vWorld;
      varying vec4 vUvProj;
      varying vec3 vViewVec;
      uniform vec3 uCamPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vUvProj = uTexMatrix * wp;
        vViewVec = uCamPos - wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld;
      varying vec4 vUvProj;
      varying vec3 vViewVec;
      uniform float uTime;
      uniform sampler2D uRefl;
      uniform vec3 uSunDir, uSunColor, uFogColor, uDeep, uShallow;
      uniform float uFogDensity;
      uniform vec4 uWakes[${MAX_WAKES}];

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }

      // analytic wave height: directional sines + fbm chop + wake rings
      float waveH(vec2 p, float t) {
        float h = 0.0;
        h += sin(dot(p, vec2(0.55, 0.22)) * 1.9 + t * 0.9) * 0.045;
        h += sin(dot(p, vec2(-0.3, 0.6)) * 2.6 + t * 1.15) * 0.030;
        h += sin(dot(p, vec2(0.8, -0.35)) * 4.3 + t * 1.6) * 0.016;
        h += (vnoise(p * 1.7 + vec2(t * 0.25, t * 0.14)) - 0.5) * 0.030;
        h += (vnoise(p * 4.1 - vec2(t * 0.18, t * 0.30)) - 0.5) * 0.012;
        for (int i = 0; i < ${MAX_WAKES}; i++) {
          vec4 w = uWakes[i];
          float age = w.w;
          if (age > 8.0) continue;
          float d = distance(p, w.xy);
          float front = age * 2.6;                 // expanding ring speed
          float ring = sin((d - front) * 5.5) * exp(-abs(d - front) * 1.4);
          float env = exp(-age * 0.55) * smoothstep(front + 6.0, front - 2.0, d);
          h += ring * env * 0.075;
        }
        return h;
      }

      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        float e = 0.35;
        float h0 = waveH(p, t);
        float hx = waveH(p + vec2(e, 0.0), t);
        float hz = waveH(p + vec2(0.0, e), t);
        vec3 n = normalize(vec3((h0 - hx) / e, 1.0, (h0 - hz) / e));

        vec3 V = normalize(vViewVec);
        float fres = pow(1.0 - clamp(dot(V, n), 0.0, 1.0), 3.0);
        fres = 0.04 + 0.96 * fres;

        // reflection with normal distortion
        vec2 ruv = vUvProj.xy / vUvProj.w;
        ruv += n.xz * 0.075;
        vec3 refl = texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb;
        // canal water swallows light: dim + slightly desaturate reflections
        float rl = dot(refl, vec3(0.333));
        refl = mix(vec3(rl), refl, 0.85) * 0.78;

        // body color: deeper jade looking down, lighter at grazing
        float facing = clamp(dot(V, n), 0.0, 1.0);
        vec3 body = mix(uShallow, uDeep, pow(facing, 0.7));
        // subtle large-scale color variation (current patches)
        body *= 0.85 + 0.25 * vnoise(p * 0.08 + vec2(t * 0.02, 0.0));

        vec3 col = mix(body, refl, 0.10 + fres * 0.82);

        // sun specular (HDR for bloom)
        vec3 H = normalize(V + uSunDir);
        float spec = pow(clamp(dot(n, H), 0.0, 1.0), 320.0);
        col += uSunColor * spec * 4.5;
        // broader sheen
        col += uSunColor * pow(clamp(dot(n, H), 0.0, 1.0), 18.0) * 0.05;

        // glitter sparkle
        float gl = vnoise(p * 22.0 + n.xz * 30.0);
        col += uSunColor * pow(gl, 9.0) * 0.05 * (0.3 + fres);

        // dawn scatter: water catches warm light toward sun
        float sunAz = pow(clamp(dot(normalize(vec2(V.x, V.z)), normalize(vec2(uSunDir.x, uSunDir.z))), 0.0, 1.0), 3.0);
        col += vec3(0.5, 0.22, 0.08) * sunAz * 0.25 * (0.4 + 0.6 * fres);

        // fog
        float dist = length(vViewVec);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF);

        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 300);
  mesh.frustumCulled = false;
  mesh.userData.noReflect = true;

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const clipBias = 0.002;

  function updateReflection(camera) {
    // reflect camera across y=0
    reflCam.projectionMatrix.copy(camera.projectionMatrix);
    reflCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);
    lookDir.y = -lookDir.y;
    reflCam.up.set(camera.up.x, -camera.up.y, camera.up.z);
    reflCam.lookAt(reflCam.position.clone().add(lookDir));
    reflCam.updateMatrixWorld();

    texMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    texMatrix.multiply(reflCam.projectionMatrix);
    texMatrix.multiply(reflCam.matrixWorldInverse);

    // oblique near-plane clipping at water level (Eric Lengyel) — keep y > 0
    clipPlane.set(new THREE.Vector3(0, 1, 0), 0);
    clipPlane.applyMatrix4(reflCam.matrixWorldInverse);
    const cp = new THREE.Vector4(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
    const proj = reflCam.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(cp.x) + proj.elements[8]) / proj.elements[0],
      (Math.sign(cp.y) + proj.elements[9]) / proj.elements[5],
      -1.0,
      (1.0 + proj.elements[10]) / proj.elements[14],
    );
    cp.multiplyScalar(2.0 / cp.dot(q));
    proj.elements[2] = cp.x;
    proj.elements[6] = cp.y;
    proj.elements[10] = cp.z + 1.0 - clipBias;
    proj.elements[14] = cp.w;

    const oldTarget = renderer.getRenderTarget();
    const oldClear = renderer.getClearColor(new THREE.Color()).clone();
    const oldAlpha = renderer.getClearAlpha();
    mesh.visible = false;
    // hide non-reflectable objects
    const hidden = [];
    scene.traverse((o) => {
      if (o.visible && o.userData.noReflect) { o.visible = false; hidden.push(o); }
    });
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x9e948c, 1); // fog-toned fallback behind mirrored sky
    renderer.clear();
    renderer.render(scene, reflCam);
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClear, oldAlpha);
    for (const o of hidden) o.visible = true;
    mesh.visible = true;
  }

  function addWake(x, z, strength = 1) {
    const w = wakes[wakeCursor];
    w.set(x, z, strength, 0);
    wakeCursor = (wakeCursor + 1) % MAX_WAKES;
  }

  function update(t, dt, camera) {
    uniforms.uTime.value = t;
    uniforms.uCamPos.value.copy(camera.position);
    for (const w of wakes) if (w.w < 99) w.w += dt;
  }

  return { mesh, update, updateReflection, addWake, setFogDensity: (d) => { uniforms.uFogDensity.value = d; } };
}
