// Cinematic attract-loop camera: glides along the canal at water level,
// passes under bridges, banks gently into turns. Seamlessly periodic.
import * as THREE from 'three';

const LOOP_LEN = 215;          // meters of canal covered by the loop
const SPEED = 1.62;            // m/s — slow dawn drift
const TWO_PI = Math.PI * 2;

export function makeAttractCamera(canal) {
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function apply(camera, time) {
    const s = ((time * SPEED) % LOOP_LEN + LOOP_LEN) % LOOP_LEN;
    const ph = (s / LOOP_LEN) * TWO_PI; // periodic phase

    const sm = canal.atS(s);
    const ahead = canal.atS(s + 13);

    // lateral drift (periodic), keep off the walls
    const drift = Math.sin(ph * 2) * 0.9 + Math.sin(ph * 5 + 1) * 0.35;
    const nx = Math.cos(sm.ang), nz = -Math.sin(sm.ang);
    pos.set(
      sm.x + nx * drift,
      1.02 + Math.sin(ph * 3) * 0.12,
      sm.z + nz * drift,
    );

    // look ahead, slightly rising and falling
    const lookDrift = Math.sin(ph * 2 + 0.8) * 1.6;
    const anx = Math.cos(ahead.ang), anz = -Math.sin(ahead.ang);
    look.set(
      ahead.x + anx * lookDrift,
      1.15 + Math.sin(ph * 2 - 0.5) * 0.35,
      ahead.z + anz * lookDrift,
    );

    // bank into turns
    const bank = Math.sin(ph * 2) * 0.012;
    up.set(Math.sin(bank), Math.cos(bank), 0);

    camera.position.copy(pos);
    camera.up.copy(up);
    camera.lookAt(look);
  }

  return { apply, LOOP_LEN, SPEED };
}
