// Earth: day/night terminator, city lights, rotating clouds, fresnel atmosphere shell.
import * as THREE from 'three';
import { makeEarthTextures } from './textures.js';

const VERT = /* glsl */`
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EARTH_FRAG = /* glsl */`
uniform sampler2D dayTex;   // rgb = albedo
uniform sampler2D cityTex;  // rgb = city lights
uniform sampler2D oceanTex; // r = ocean mask
uniform vec3 sunDir;
uniform vec3 camPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(camPos - vPosW);
  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.10, 0.24, ndl);

  vec3 albedo = texture2D(dayTex, vUv).rgb;
  float ocean = texture2D(oceanTex, vUv).r;

  vec3 lit = albedo * (max(ndl, 0.0) * vec3(2.0, 1.94, 1.85) + vec3(0.02, 0.035, 0.06));
  // ocean specular glint (tight, subtle)
  vec3 H = normalize(sunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 600.0) * ocean * max(ndl, 0.0);
  lit += vec3(1.0, 0.98, 0.92) * spec * 0.35;

  vec3 city = texture2D(cityTex, vUv).rgb;
  vec3 night = albedo * vec3(0.008, 0.012, 0.025) + city * 2.4;

  vec3 col = mix(night, lit, day);

  // limb atmosphere tint on day side
  float limb = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  col += vec3(0.30, 0.52, 0.95) * limb * day * 0.55;
  // subtle rim on night side too
  col += vec3(0.10, 0.22, 0.5) * limb * (1.0 - day) * 0.25;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUD_FRAG = /* glsl */`
uniform sampler2D cloudTex;
uniform vec3 sunDir;
uniform vec3 camPos;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vNormalW);
  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.14, 0.30, ndl);
  vec4 c = texture2D(cloudTex, vUv);
  if (c.a < 0.01) discard;
  vec3 col = c.rgb * (max(ndl, 0.0) * vec3(1.9, 1.82, 1.75) + vec3(0.03, 0.045, 0.07));
  // warm tint at terminator
  float term = smoothstep(0.05, 0.35, ndl) * (1.0 - smoothstep(0.35, 0.7, ndl));
  col += vec3(0.5, 0.22, 0.08) * term * 0.5;
  gl_FragColor = vec4(col, c.a * (day * 0.95 + 0.05));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_VERT = /* glsl */`
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ATMO_FRAG = /* glsl */`
uniform vec3 sunDir;
uniform vec3 camPos;
uniform float intensity;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(camPos - vPosW);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.5);
  float sun = pow(max(dot(N, sunDir) * 0.5 + 0.5, 0.0), 2.0);
  vec3 col = mix(vec3(0.16, 0.34, 0.72), vec3(0.75, 0.88, 1.0), sun) * rim * intensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createEarth(sunDir) {
  const group = new THREE.Group();
  const R = 1050;
  const DIST = 12500;
  const dir = new THREE.Vector3(-0.50, 0.52, -0.69).normalize(); // high above horizon, NW
  group.position.copy(dir).multiplyScalar(DIST);

  const tex = makeEarthTextures(1024, 512);
  const uniforms = {
    dayTex: { value: tex.day },
    cityTex: { value: tex.city },
    oceanTex: { value: tex.ocean },
    sunDir: { value: sunDir.clone() },
    camPos: { value: new THREE.Vector3() },
  };

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: EARTH_FRAG, uniforms,
      fog: false,
    })
  );
  earth.rotation.z = 0.41; // axial tilt
  // SphereGeometry maps texture column u to angle phi = u*2pi (x=-cos phi, z=sin phi);
  // the point facing the Moon sits near phi = 2.1 rad -> u = 0.334. Rotate the
  // land-richest longitude there.
  earth.rotation.y = -(tex.bestU - 0.334) * Math.PI * 2;
  group.add(earth);

  const cloudUniforms = {
    cloudTex: { value: tex.clouds },
    sunDir: { value: sunDir.clone() },
    camPos: { value: new THREE.Vector3() },
  };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.018, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: CLOUD_FRAG, uniforms: cloudUniforms,
      transparent: true, depthWrite: false, fog: false,
    })
  );
  clouds.rotation.z = 0.41;
  group.add(clouds);

  const atmoUniforms = {
    sunDir: { value: sunDir.clone() },
    camPos: { value: new THREE.Vector3() },
    intensity: { value: 1.1 },
  };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.055, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: atmoUniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.FrontSide, fog: false,
    })
  );
  group.add(atmo);

  // inner back-shell so the limb glow wraps the silhouette from behind
  const atmoBackUniforms = {
    sunDir: { value: sunDir.clone() },
    camPos: { value: new THREE.Vector3() },
    intensity: { value: 0.35 },
  };
  const atmoBack = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.09, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: atmoBackUniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.BackSide, fog: false,
    })
  );
  group.add(atmoBack);

  function update(t, dt, camera) {
    earth.rotation.y += dt * 0.004;
    clouds.rotation.y += dt * 0.014;
    uniforms.camPos.value.copy(camera.position);
    cloudUniforms.camPos.value.copy(camera.position);
    atmoUniforms.camPos.value.copy(camera.position);
    atmoBackUniforms.camPos.value.copy(camera.position);
  }

  return { group, update, direction: dir };
}
