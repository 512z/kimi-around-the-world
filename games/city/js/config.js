// Global tuning constants for GRIDLOCK / rain-cybercity.

export const WORLD = {
  chunkLen: 160,          // meters per city chunk
  chunkCount: 10,         // live chunks ahead/behind camera
  roadHalf: 26,           // clear canyon half-width (collision wall)
  canyonHalf: 30,         // visual building face distance
  groundY: 0,
  loopChunks: 3,          // ARENA: chunk seeds repeat -> seamless 480 m loop
  rebaseAt: 40000,        // |z| where the world re-bases to protect fp precision
};

export const COLORS = {
  // one accent — cyan sampled from the holo key light. UI + key emissives share it.
  accent: 0x53d5fd,
  accent2: 0xff3d7f,      // scene-side magenta (never used by UI)
  amber: 0xffb54d,
  fogLow: 0x0a1220,
  fogHigh: 0x05070e,
  sky: 0x05070e,
};

export const QUALITY_PRESETS = {
  CINEMA:   { scale: 1.45, reflScale: 0.5,  rain: 7000, bloomMips: 6, steam: 110, peds: 16, fxaa: true },
  HIGH:     { scale: 1.2,  reflScale: 0.42, rain: 5200, bloomMips: 6, steam: 84,  peds: 13, fxaa: true },
  BALANCED: { scale: 1.0,  reflScale: 0.33, rain: 3600, bloomMips: 5, steam: 56,  peds: 9,  fxaa: true },
};
export const QUALITY_ORDER = ['BALANCED', 'HIGH', 'CINEMA'];

export const PLAYER = {
  cruise: 40,             // m/s baseline forward speed
  minSpeed: 27,
  maxSpeed: 54,
  boostSpeed: 74,
  throttleRate: 22,       // W/S accel
  latMax: 26,             // max lateral speed
  vertMax: 18,
  steerLag: 4.8,          // 1/s responsiveness
  burnImpulse: 21,        // Space vertical burn (m/s added)
  burnCooldown: 1.9,
  heatRate: 30,           // boost heat per second (~3.4s of boost)
  coolRate: 34,
  overheatLock: 2.2,
  radius: 1.35,           // collision sphere
  startY: 46,
  ceiling0: 84,           // starting clearance ceiling
  ceilingDrop: 10,        // per broken cordon
  ceilingMin: 22,
  floorY: 2.2,
};

export const GAME = {
  cordonFirst: 520,       // meters ahead of start
  cordonSpacing0: 560,
  cordonSpacingMin: 380,
  gapR0: 15,              // cordon gap radius when far
  gapRMin: 4.6,           // fully closed still (barely) passable
  pursuers0: 2,
  pursuersPerCordon: 2,
  pursuersMax: 9,
  nearMissDist: 3.4,
  nearMissScore: 150,
  cordonScore: 1000,
  distScore: 1.0,         // per meter
};

export const STORAGE = {
  quality: 'gridlock.quality',
  sound: 'gridlock.sound',
  best: 'gridlock.best',
};
