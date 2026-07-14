// World assembly: lights, env, all scene systems, NPC life, per-frame update.
import * as THREE from 'three';
import { Canal, DOCKS } from './canal.js';
import * as TEX from './textures.js';
import { makeSky, SUN_DIR, SUN_COLOR, FOG_COLOR, FOG_DENSITY } from './sky.js';
import { makeWater } from './water.js';
import { buildCity, buildBridges, buildQuays, buildCampo, buildPoles, buildLaundry } from './city.js';
import { makeMist } from './mist.js';
import { makeBirds } from './birds.js';
import { makeGondola, BOAT_SCALE } from './gondola.js';
import { makePerson } from './person.js';
import { mulberry32 } from './textures.js';

export async function makeWorld(renderer, onProgress = () => {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);

  // ---- env map for PBR reflections (one-time PMREM from the dawn gradient)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = TEX.makeSkyEquirect();
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose();

  // ---- lights
  const sun = new THREE.DirectionalLight(SUN_COLOR.getHex(), 2.8);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x93a6c4, 0x5a4e42, 0.85));

  // ---- textures
  onProgress(0.05, 'PAINTING PLASTER');
  const textures = {
    facade: TEX.makeFacadeAtlas(),
    roof: TEX.makeRoofTexture(),
    stone: TEX.makeStoneTexture(),
    mist: TEX.makeMistTexture(),
    stripe: TEX.makeStripeTexture(),
    wood: TEX.makeWoodTexture(),
  };

  const canal = new Canal();
  onProgress(0.15, 'RAISING FACADES');

  // ---- static city
  const sky = makeSky();
  scene.add(sky);
  const city = buildCity(canal, textures);
  scene.add(city.group);
  scene.add(buildBridges(canal, textures));
  scene.add(buildQuays(canal, textures));
  const campo = buildCampo(canal, textures);
  scene.add(campo);
  scene.add(buildPoles(canal, textures));
  const laundry = buildLaundry(canal, textures);
  scene.add(laundry);

  onProgress(0.3, 'FLOODING CANAL');
  const water = makeWater(renderer, scene);
  scene.add(water.mesh);

  const mist = makeMist(canal, textures.mist);
  scene.add(mist);

  const birds = makeBirds(campo.userData.center);
  scene.add(birds);

  onProgress(0.4, 'RIGGING GONDOLAS');
  // ---- moored gondolas (rocking at moorings)
  const rng = mulberry32(31337);
  const moored = [];
  const moorSpots = [
    { s: 45, side: 1 }, { s: 100, side: -1 }, { s: 240, side: 1 },
    { s: 400, side: -1 }, { s: 520, side: 1 },
  ];
  for (const sp of moorSpots) {
    const sm = canal.atS(sp.s);
    const nx = Math.cos(sm.ang) * sp.side, nz = -Math.sin(sm.ang) * sp.side;
    const g = makeGondola(textures, { physical: false });
    g.position.set(
      sm.x + nx * (sm.width / 2 - 1.35),
      0,
      sm.z + nz * (sm.width / 2 - 1.35),
    );
    // orient along canal, bow toward +s or -s randomly
    g.rotation.y = sm.ang + (rng() > 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.14;
    g.userData.rockPhase = rng() * 6.28;
    g.userData.baseY = g.rotation.y;
    scene.add(g);
    moored.push(g);
  }

  onProgress(0.55, 'WAKING THE CITY');
  // ---- NPC gondola with gondolier (the lone gondolier of the scene)
  const npcBoat = makeGondola(textures, { physical: false });
  scene.add(npcBoat);
  const gondolier = makePerson('gondolier');
  gondolier.root.position.set(0.08, 0.54, -4.15);
  gondolier.root.scale.setScalar(1 / BOAT_SCALE);
  npcBoat.add(gondolier.root);
  onProgress(0.7, 'CASTING PASSENGERS');

  // ---- dock passengers (idle locals waiting for a fare)
  const dockPeople = [];
  const peopleKinds = ['tourist', 'local1', 'local2'];
  for (let i = 1; i < DOCKS.length; i += 2) {
    const dk = DOCKS[i];
    const sm = canal.atS(dk.s);
    const nx = Math.cos(sm.ang) * dk.side, nz = -Math.sin(sm.ang) * dk.side;
    const p = makePerson(peopleKinds[i % peopleKinds.length]);
    p.root.position.set(
      sm.x + nx * (sm.width / 2 - dk.depth * 0.5),
      0.42,
      sm.z + nz * (sm.width / 2 - dk.depth * 0.5),
    );
    p.root.rotation.y = Math.atan2(nx, nz); // face the canal
    scene.add(p.root);
    dockPeople.push(p);
  }

  onProgress(0.85, 'FIRST LIGHT');

  // ---- NPC boat motion along the centerline
  let npcS = 150;
  let wakeTimer = 0;
  const wakeBus = []; // gameplay-visible wake events (read by the game)
  function updateNPC(dt) {
    npcS = (npcS + dt * 1.25) % canal.length;
    const sm = canal.atS(npcS);
    npcBoat.position.set(sm.x, 0, sm.z);
    npcBoat.rotation.y = sm.ang;
    // gentle rock
    npcBoat.rotation.z = Math.sin(performance.now() * 0.0006) * 0.015;
    wakeTimer -= dt;
    if (wakeTimer <= 0) {
      const wx = sm.x - Math.sin(sm.ang) * 3, wz = sm.z - Math.cos(sm.ang) * 3;
      water.addWake(wx, wz, 0.7);
      wakeBus.push({ x: wx, z: wz, t: performance.now() / 1000, strength: 0.8 });
      // rebound off nearby wall: a second reflected wavefront
      const w = canal.wallsAt(wx, wz);
      const side = w.left.dist < w.right.dist ? w.left : w.right;
      if (side.dist < 2.6) {
        water.addWake(side.wx, side.wz, 0.5);
        wakeBus.push({ x: side.wx, z: side.wz, t: performance.now() / 1000, strength: 0.55 });
      }
      if (wakeBus.length > 64) wakeBus.splice(0, wakeBus.length - 64);
      wakeTimer = 1.8;
    }
  }

  let npcPhase = 0;
  let birdBurstLatch = 0;
  function update(dt, time, camera, opts = {}) {
    sky.update(time);
    sky.position.copy(camera.position);
    water.update(time, dt, camera);
    water.updateReflection(camera);
    mist.update(time);
    laundry.update(time);
    birds.userData.update(dt, time);
    for (const g of moored) {
      const ph = g.userData.rockPhase;
      g.rotation.z = Math.sin(time * 0.62 + ph) * 0.035;
      g.rotation.x = Math.sin(time * 0.47 + ph * 1.7) * 0.02;
      g.rotation.y = g.userData.baseY + Math.sin(time * 0.31 + ph) * 0.012;
      g.position.y = Math.sin(time * 0.8 + ph) * 0.025;
    }
    updateNPC(dt);
    npcPhase = (npcPhase + dt * 0.42) % 1;
    gondolier.update(dt, { mode: 'pole', phase: npcPhase, intensity: 0.8 });
    for (const p of dockPeople) p.update(dt, { mode: 'idle' });
    // burst the pigeons when something approaches the campo
    const c = campo.userData.center;
    const dCam = camera.position.distanceTo(c);
    if (birdBurstLatch <= 0 && dCam < 46) {
      birds.userData.burst();
      birdBurstLatch = 60;
    }
    birdBurstLatch -= dt;
  }

  return {
    scene, canal, water, mist, birds, campo, textures, wakeBus, moored,
    update,
    dockPeople,
    npcBoat, gondolier,
    dispose() {},
  };
}
