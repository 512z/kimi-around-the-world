import * as THREE from 'three';

/* ================================================================== *
 *  Procedural night sky for a lunar grand prix.
 *  Everything is shader / primitive based - no external assets.
 * ================================================================== */

/* ------------------------------------------------------------------ */
/* Shared GLSL: hashes, value noise, fbm, axis rotation               */
/* ------------------------------------------------------------------ */
const GLSL_NOISE = /* glsl */`
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p){
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float vnoise(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i + vec3(0.0, 0.0, 0.0));
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
    u.z);
}
float fbm(vec3 p){
  float s = 0.0;
  float a = 0.5;
  for(int i = 0; i < 4; i++){
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
vec3 rotAxis(vec3 v, vec3 ax, float ang){
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
}
`;

/* ------------------------------------------------------------------ */
/* Sky dome: star field + tilted Milky Way band                       */
/* ------------------------------------------------------------------ */
function makeDomeMaterial(sunDir){
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vDir;

      // One layer of cell-based stars. Hashing happens in 3D on the
      // direction vector, so there are no polar seams.
      float starLayer(vec3 d, float freq, float thresh, float tw, out float hue){
        vec3 p = d * freq;
        vec3 cell = floor(p);
        float h = hash13(cell);
        hue = hash13(cell + 17.31);
        if(h < thresh) return 0.0;
        vec3 rnd = hash33(cell);
        float dist = length(fract(p) - rnd);
        float core = pow(smoothstep(0.5, 0.0, dist), 3.0);
        float mag = (h - thresh) / max(1.0 - thresh, 0.001);
        float ph = hash13(cell + 5.7);
        // very subtle time-based twinkle
        float twinkle = 1.0 + tw * sin(uTime * (0.6 + ph * 1.8) + ph * 43.0);
        return core * (0.3 + 0.7 * mag) * twinkle;
      }

      void main(){
        vec3 d = normalize(vDir);

        // ---- base sky: ink black with the faintest cool zenith lift
        vec3 col = vec3(0.0012, 0.0018, 0.0060);
        col += vec3(0.0006, 0.0009, 0.0022) * clamp(d.y, 0.0, 1.0);

        // ---- Milky Way: tilted band with cloudy multi-octave structure
        vec3 bn = normalize(vec3(0.35, 0.55, 0.75));
        float bd = dot(d, bn);
        float band = exp(-bd * bd * 30.0);          // gaussian falloff from centerline
        float big = fbm(d * 2.6 + 11.0);
        float mid = fbm(d * 6.5 + 3.0);
        float fine = fbm(d * 16.0);
        float structure = big * 0.50 + mid * 0.35 + fine * 0.25;
        float clumpy = smoothstep(0.30, 0.80, structure);
        float dust = 1.0 - 0.55 * smoothstep(0.50, 0.80, fbm(d * 8.0 + 30.0)) * band;
        float milky = band * (0.08 + 0.92 * clumpy) * dust;
        vec3 milkyCol = mix(vec3(0.012, 0.016, 0.026), vec3(0.045, 0.055, 0.075), clumpy);
        col += milkyCol * milky * 1.6;

        // ---- stars: three layers (faint many -> rare bright pinpoints)
        float hue;
        vec3 stars = vec3(0.0);

        float s1 = starLayer(d, 300.0, 0.92, 0.10, hue);
        stars += mix(vec3(0.72, 0.78, 1.0), vec3(1.0, 0.86, 0.62), hue) * s1 * 0.8;

        float s2 = starLayer(d, 230.0, 0.95, 0.08, hue);
        stars += mix(vec3(0.80, 0.85, 1.0), vec3(1.0, 0.90, 0.70), hue) * s2 * 1.7;

        float s3 = starLayer(d, 170.0, 0.985, 0.06, hue);
        stars += mix(vec3(0.85, 0.90, 1.0), vec3(1.0, 0.92, 0.78), hue) * s3 * 3.2;

        // ---- extra dense, faint stars inside the Milky Way band
        float bandThresh = mix(0.985, 0.80, clamp(milky, 0.0, 1.0));
        float s4 = starLayer(d, 340.0, bandThresh, 0.12, hue);
        stars += mix(vec3(0.70, 0.75, 0.95), vec3(1.0, 0.90, 0.75), hue) * s4 * 0.55;

        col += stars;

        // ---- soft warm aureole toward the sun
        float sunDot = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.82, 0.55) * pow(sunDot, 40.0) * 0.10;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Additive billboard (view-space aligned quad) with radial falloff   */
/* ------------------------------------------------------------------ */
const BILLBOARD_VERT = /* glsl */`
  uniform float uSize;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

function makeGlowMaterial(color, power, intensity){
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false, // keep glows hot for bloom
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uSize: { value: 1000 },
      uOpacity: { value: 1 },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      uniform float uOpacity;
      varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float g = pow(clamp(1.0 - d, 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor * g * uIntensity * uOpacity, g * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function makeSun(sunDir, planeGeo){
  const group = new THREE.Group();
  group.position.copy(sunDir).multiplyScalar(30000);

  const layers = [
    { size: 700,   color: 0xfff2dd, power: 2.5, intensity: 2.6 },  // intense disk
    { size: 2600,  color: 0xffdcb0, power: 2.4, intensity: 0.35 }, // halo
    { size: 6000,  color: 0xffd0a0, power: 2.6, intensity: 0.028 }, // wide glare
  ];
  for(const L of layers){
    const mat = makeGlowMaterial(L.color, L.power, L.intensity);
    mat.uniforms.uSize.value = L.size;
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    group.add(mesh);
  }
  return group;
}

/* ------------------------------------------------------------------ */
/* Earth: procedural continents, swirling clouds, terminator,         */
/* city lights, blue fresnel atmosphere                               */
/* ------------------------------------------------------------------ */
function makeEarth(sunDir, earthDir){
  const group = new THREE.Group();
  const R = 900;

  // Rotate the true sun direction so the earth reads ~half-lit from
  // the origin (the true geometry would give an almost-full earth).
  const axis = new THREE.Vector3().crossVectors(sunDir, earthDir).normalize();
  const lightDir = sunDir.clone().applyAxisAngle(axis, 0.985).normalize();

  const surfMat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uLightDir: { value: lightDir },
    },
    vertexShader: /* glsl */`
      varying vec3 vLocal;
      varying vec3 vNrmW;
      varying vec3 vPosW;
      void main(){
        vLocal = normalize(position);
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      uniform vec3 uLightDir;
      varying vec3 vLocal;
      varying vec3 vNrmW;
      varying vec3 vPosW;

      // Scattered warm speckles, clustered into "metro" regions.
      float cityField(vec3 d){
        vec3 p = d * 75.0;
        vec3 cell = floor(p);
        float h = hash13(cell);
        float mask = smoothstep(0.42, 0.62, fbm(d * 3.2 + 20.0));
        return step(0.925, h) * mask * (0.4 + 0.6 * hash13(cell + 3.0));
      }

      void main(){
        vec3 n = normalize(vLocal);
        vec3 N = normalize(vNrmW);
        vec3 V = normalize(cameraPosition - vPosW);
        float ndl = dot(N, uLightDir);
        float day = smoothstep(-0.22, 0.35, ndl);

        // ---- continents from fbm on the sphere normal
        float cont = fbm(n * 2.6) + 0.22 * fbm(n * 6.5 + 5.0) - 0.08;
        float land = smoothstep(0.5, 0.545, cont);

        vec3 ocean = mix(vec3(0.008, 0.035, 0.100), vec3(0.015, 0.070, 0.170), fbm(n * 9.0));
        vec3 landCol = mix(vec3(0.035, 0.060, 0.050), vec3(0.080, 0.130, 0.105), fbm(n * 5.0 + 4.0));
        // faint teal coastal shelf
        landCol += vec3(0.0, 0.02, 0.025) * smoothstep(0.5, 0.53, cont) * (1.0 - land);
        vec3 surf = mix(ocean, landCol, land);

        // ---- ocean sun glint
        vec3 H = normalize(V + uLightDir);
        float spec = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * step(0.0, ndl);
        surf += vec3(0.5, 0.6, 0.8) * spec * 0.6;

        // ---- day/night terminator + city lights (land only)
        float night = 1.0 - smoothstep(-0.3, -0.02, ndl);
        float cities = cityField(n) * land * night;
        vec3 col = surf * (0.03 + 1.15 * day);
        col += vec3(1.0, 0.5, 0.2) * cities * 0.8;

        // ---- swirling clouds, domain-warped, slow drift
        vec3 ax = normalize(vec3(0.2, 1.0, 0.15));
        float warp = fbm(n * 2.0 + 8.0) * 3.2;
        vec3 w = rotAxis(n, ax, warp + uTime * 0.006);
        float cl = fbm(w * 3.0 + vec3(uTime * 0.005, uTime * 0.002, 0.0));
        cl = smoothstep(0.52, 0.82, cl + 0.18 * fbm(w * 8.0));
        float cloudLit = 0.05 + 0.95 * smoothstep(-0.1, 0.35, ndl);
        col = mix(col, vec3(0.85, 0.89, 0.94) * cloudLit, cl * 0.85);

        // ---- day-side limb atmosphere tint
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vec3(0.29, 0.62, 1.0) * rim * (0.1 + 0.9 * day) * 0.3;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const surface = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), surfMat);
  surface.renderOrder = -6;
  group.add(surface);

  // additive atmosphere shell, slightly larger
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uLightDir: { value: lightDir },
    },
    vertexShader: /* glsl */`
      varying vec3 vNrmW;
      varying vec3 vPosW;
      void main(){
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uLightDir;
      varying vec3 vNrmW;
      varying vec3 vPosW;
      void main(){
        vec3 N = normalize(vNrmW);
        vec3 V = normalize(cameraPosition - vPosW);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
        float day = smoothstep(-0.35, 0.55, dot(N, uLightDir));
        gl_FragColor = vec4(vec3(0.29, 0.62, 1.0) * rim * (0.15 + 0.85 * day) * 1.4, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.09, 64, 48), atmoMat);
  atmo.renderOrder = -5;
  group.add(atmo);

  group.position.copy(earthDir).multiplyScalar(25000);
  group.userData.surfaceMat = surfMat;
  return group;
}

/* ------------------------------------------------------------------ */
/* Satellites: custom lit metal/panel materials (no scene lights      */
/* needed), primitive-built bodies, additive glints                   */
/* ------------------------------------------------------------------ */
function makePanelTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#050a18';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(120, 160, 255, 0.55)';
  ctx.lineWidth = 2;
  for(let i = 0; i <= 8; i++){
    const p = i * 16;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(128, p); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeBlackTexture(){
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeSatMaterials(sunDir, panelTex, blackTex){
  const vert = /* glsl */`
    varying vec3 vNrmW;
    varying vec3 vPosW;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      vNrmW = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vPosW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const frag = /* glsl */`
    uniform vec3 uSunDir;
    uniform vec3 uAlbedo;
    uniform float uShininess;
    uniform float uSpec;
    uniform sampler2D uEmissiveMap;
    uniform vec3 uEmissive;
    uniform float uEmissiveStrength;
    uniform vec2 uGridScale;
    varying vec3 vNrmW;
    varying vec3 vPosW;
    varying vec2 vUv;
    void main(){
      vec3 N = normalize(vNrmW);
      vec3 V = normalize(cameraPosition - vPosW);
      vec3 L = normalize(uSunDir);
      float ndl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), uShininess) * step(0.001, dot(N, L));
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      vec3 sunCol = vec3(1.0, 0.95, 0.85);
      vec3 col = uAlbedo * (sunCol * ndl * 1.7 + vec3(0.015, 0.020, 0.035));
      col += sunCol * spec * uSpec;
      col += fres * uAlbedo * 0.12;
      vec3 em = texture2D(uEmissiveMap, vUv * uGridScale).rgb * uEmissive * uEmissiveStrength;
      col += em;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
  const mk = (opts) => new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uAlbedo: { value: new THREE.Color(opts.albedo) },
      uShininess: { value: opts.shininess },
      uSpec: { value: opts.spec },
      uEmissiveMap: { value: opts.emissiveMap || blackTex },
      uEmissive: { value: new THREE.Color(opts.emissive || 0x000000) },
      uEmissiveStrength: { value: opts.emissiveStrength || 0 },
      uGridScale: { value: new THREE.Vector2(opts.grid ? opts.grid[0] : 1, opts.grid ? opts.grid[1] : 1) },
    },
    vertexShader: vert,
    fragmentShader: frag,
  });
  return {
    body: mk({ albedo: 0x9aa3ad, shininess: 48, spec: 1.2 }),
    dark: mk({ albedo: 0x2a2e35, shininess: 24, spec: 0.6 }),
    panel: mk({ albedo: 0x070b16, shininess: 60, spec: 0.5, emissiveMap: panelTex, emissive: 0x1a3a66, emissiveStrength: 2.4, grid: [6, 3] }),
  };
}

function makeGlint(glintMat, size){
  const mat = glintMat.clone();
  mat.uniforms.uSize.value = size;
  mat.uniforms.uOpacity.value = 0;
  const mesh = new THREE.Mesh(glintMat._geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function buildSatellite(mats, glintMat){
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.8), mats.body);
  g.add(body);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 12), mats.dark);
  collar.position.y = 0.7;
  g.add(collar);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), mats.dark);
  mast.position.y = 1.3;
  g.add(mast);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.15, 0.3, 16, 1, true), mats.body);
  dish.position.y = 1.9;
  g.add(dish);
  const panelGeo = new THREE.BoxGeometry(0.05, 2.2, 4.6);
  const p1 = new THREE.Mesh(panelGeo, mats.panel);
  p1.position.x = 1.35;
  const p2 = new THREE.Mesh(panelGeo, mats.panel);
  p2.position.x = -1.35;
  g.add(p1, p2);
  const glint = makeGlint(glintMat, 180);
  g.add(glint);
  g.userData.glint = glint;
  g.scale.setScalar(5.0); // ~24 units tip to tip
  return g;
}

function buildStation(mats, glintMat){
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5.0, 16), mats.body);
  core.rotation.x = Math.PI / 2;
  g.add(core);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 16), mats.dark);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 2.9;
  g.add(hub);
  const truss = new THREE.Mesh(new THREE.BoxGeometry(18, 0.18, 0.18), mats.dark);
  g.add(truss);
  const truss2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 7), mats.dark);
  g.add(truss2);
  const panelGeo = new THREE.BoxGeometry(0.06, 3.0, 4.6);
  for(const x of [-8.5, -4.5, 4.5, 8.5]){
    const p = new THREE.Mesh(panelGeo, mats.panel);
    p.position.x = x;
    g.add(p);
  }
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.2, 0.4, 16, 1, true), mats.body);
  dish.position.set(0, 1.2, -2.5);
  dish.rotation.x = Math.PI * 0.35;
  g.add(dish);
  const glint = makeGlint(glintMat, 340);
  g.add(glint);
  g.userData.glint = glint;
  g.scale.setScalar(1.5); // ~34 units tip to tip
  return g;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                         */
/* ------------------------------------------------------------------ */
export function createSky({ scene, renderer }){
  const sunDirection = new THREE.Vector3(0.86, 0.14, -0.49).normalize();
  const earthDir = new THREE.Vector3(-0.55, 0.22, 0.8).normalize();

  // ---- dome
  const domeMat = makeDomeMaterial(sunDirection);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 64, 32), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // ---- sun
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const sun = makeSun(sunDirection, planeGeo);
  scene.add(sun);

  // ---- earth
  const earth = makeEarth(sunDirection, earthDir);
  scene.add(earth);

  // ---- satellites
  const panelTex = makePanelTexture();
  if(renderer){
    panelTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  const blackTex = makeBlackTexture();
  const satMats = makeSatMaterials(sunDirection, panelTex, blackTex);

  const glintMat = makeGlowMaterial(0xcfe4ff, 2.5, 4.5);
  glintMat._geo = planeGeo; // shared geometry ref for glint meshes

  const satDefs = [
    { obj: buildSatellite(satMats, glintMat), R: 2400, alt: 2750, inc: 0.55, speed: 0.035, phase: 0.0, spin: 0.25 },
    { obj: buildSatellite(satMats, glintMat), R: 3000, alt: 2800, inc: -0.40, speed: 0.028, phase: 2.1, spin: -0.18 },
    { obj: buildSatellite(satMats, glintMat), R: 1800, alt: 2750, inc: 0.75, speed: 0.045, phase: 4.2, spin: 0.30 },
    { obj: buildStation(satMats, glintMat),  R: 3400, alt: 2950, inc: 0.30, speed: 0.020, phase: 1.2, spin: 0.08 },
  ];
  for(const def of satDefs) scene.add(def.obj);
  const satellites = satDefs.map(d => d.obj);

  // ---- frame update
  const _axis = new THREE.Vector3();
  function updateSatellite(def, t){
    const th = t * def.speed + def.phase;
    const cosI = Math.cos(def.inc);
    const sinI = Math.sin(def.inc);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const x = def.R * c;
    const z = def.R * s * cosI;
    const y = def.alt + def.R * s * sinI;
    const obj = def.obj;
    obj.position.set(x, y, z);
    // heading along velocity, plus slow roll
    obj.lookAt(x - def.R * s, y + def.R * c * sinI, z + def.R * c * cosI);
    obj.rotateZ(t * def.spin + def.phase);
    // glint: panel normal is the local X axis
    _axis.set(1, 0, 0).applyQuaternion(obj.quaternion);
    const facing = Math.abs(_axis.dot(sunDirection));
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.1 + def.phase * 3.0);
    obj.userData.glint.material.uniforms.uOpacity.value = Math.pow(facing, 8.0) * pulse;
  }

  function update(dt, elapsed){
    domeMat.uniforms.uTime.value = elapsed;
    earth.userData.surfaceMat.uniforms.uTime.value = elapsed;
    earth.rotation.y += dt * 0.004; // full rotation in ~26 min
    for(const def of satDefs) updateSatellite(def, elapsed);
  }

  return {
    sunDirection,
    earth,
    sun,
    satellites,
    update,
  };
}
