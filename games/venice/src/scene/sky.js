// Dawn sky dome: gradient + sun disk/glow + drifting cloud band. No textures.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.13, 0.115, 1).normalize(); // low over +Z
export const SUN_COLOR = new THREE.Color(1.0, 0.72, 0.42);
export const FOG_COLOR = new THREE.Color(0.56, 0.53, 0.52);
export const FOG_DENSITY = 0.0085;

export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSunDir;
      uniform float uTime;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.55;
        for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.05; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float y = clamp(d.y, -0.12, 1.0);

        // base gradient
        vec3 zenith  = vec3(0.09, 0.15, 0.30);
        vec3 mid     = vec3(0.42, 0.44, 0.58);
        vec3 horizon = vec3(0.98, 0.72, 0.48);
        vec3 below   = vec3(0.30, 0.26, 0.30);
        vec3 col = mix(mid, zenith, smoothstep(0.06, 0.75, y));
        col = mix(horizon, col, smoothstep(-0.02, 0.22, y));
        col = mix(below, col, smoothstep(-0.12, 0.0, y));

        // warm tint toward sun azimuth
        float sunAz = pow(clamp(dot(normalize(vec2(d.x, d.z)), normalize(vec2(uSunDir.x, uSunDir.z))), 0.0, 1.0), 2.0);
        col += vec3(0.35, 0.16, 0.05) * sunAz * (1.0 - smoothstep(0.0, 0.5, y));

        // clouds (drifting band)
        vec2 cuv = vec2(atan(d.x, d.z) * 3.0, d.y * 7.0);
        float cl = fbm(cuv * 1.6 + vec2(uTime * 0.012, 0.0));
        float band = smoothstep(0.02, 0.14, y) * (1.0 - smoothstep(0.25, 0.6, y));
        float clouds = smoothstep(0.52, 0.85, cl) * band * 0.6;
        vec3 cloudCol = mix(vec3(1.0, 0.82, 0.62), vec3(0.85, 0.55, 0.45), sunAz);
        col = mix(col, cloudCol, clouds * (0.35 + 0.65 * sunAz));

        // sun disk + glow
        float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
        col += vec3(1.0, 0.8, 0.5) * pow(sd, 900.0) * 10.0;
        col += vec3(1.0, 0.65, 0.35) * pow(sd, 24.0) * 0.5;
        col += vec3(0.9, 0.5, 0.25) * pow(sd, 4.0) * 0.18;

        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.userData.isSky = true;
  mesh.update = (t) => { mat.uniforms.uTime.value = t; };
  return mesh;
}
