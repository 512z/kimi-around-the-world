import * as THREE from 'three';
import { PLAYER, WORLD } from './config.js';
import { clamp, damp, GlobalUniforms } from './utils.js';
import { makeDrone, makeRobot } from './assets.js';

// The protagonist: a rogue cab — self-made quad-duct drone airframe
// (tools/build_drones.py) carrying an android fare on the rear deck playing
// the hand-keyed Standing_Phone clip (tools/build_clips.py), umbrella up.
export class PlayerTaxi {
  constructor(scene) {
    this.scene = scene;
    this.rig = new THREE.Group();
    scene.add(this.rig);

    const d = makeDrone('drone06', { emissiveBoost: 2.6 });
    this.drone = d;
    this.body = d.group;
    this.rig.add(this.body);

    // fare standing on the rear deck, glued to their phone
    const fare = makeRobot({ clipName: 'Standing_Phone_01_FemaleA', dark: true });
    fare.group.scale.setScalar(0.78);
    fare.group.position.set(0, 0.14, 1.02);
    fare.group.rotation.y = Math.PI; // face backward (they watch the pursuit)
    this.fare = fare;
    this.body.add(fare.group);

    // KIMI in the pilot seat — the mascot orb flies the cab
    const pilot = new THREE.Group();
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0x2e7bf6, emissive: 0x2e7bf6, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 22, 16), orbMat);
    pilot.add(orb);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), eyeMat);
      eye.scale.set(0.07, 0.13, 0.045);
      eye.position.set(s * 0.13, 0.1, -0.33);
      pilot.add(eye);
    }
    pilot.position.set(0, 0.58, -0.2);
    this.body.add(pilot);
    this.pilot = pilot;

    // fare's umbrella
    const umb = new THREE.Group();
    const umat = new THREE.MeshStandardMaterial({ color: 0x101720, metalness: 0.2, roughness: 0.5, emissive: 0x53d5fd, emissiveIntensity: 0.22 });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.3, 8), umat);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x777c88, metalness: 0.85, roughness: 0.3 }));
    stick.position.y = -0.38;
    umb.add(canopy, stick);
    umb.position.set(-0.14, 2.1, 0.06);
    umb.rotation.z = 0.1;
    fare.group.add(umb);
    this.umbrella = umb;

    // engine thruster glows
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x66d9ff) }, uPow: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        uniform float uPow;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(vec3(0.0), 1.0);
          mv.xy += (uv - 0.5) * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)) * (0.8 + uPow * 0.5);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform vec3 uColor; uniform float uPow;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float g = exp(-d * d * 5.5);
          gl_FragColor = vec4(uColor * g * (1.1 + uPow * 2.4), g * (0.7 + uPow * 0.3));
        }
      `,
    });
    this.thrusters = [];
    for (const [x, y, z, s] of [[-1.45, 0.02, 0.6, 1.15], [1.45, 0.02, 0.6, 1.15], [-0.5, -0.22, 1.42, 0.9], [0.5, -0.22, 1.42, 0.9]]) {
      const m = new THREE.Mesh(glowGeo, glowMat.clone());
      m.position.set(x, y, z);
      m.scale.setScalar(s);
      m.frustumCulled = false;
      this.body.add(m);
      this.thrusters.push(m);
    }
    // headlight cone (volumetric wedge)
    const coneGeo = new THREE.ConeGeometry(1, 1, 16, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2); // point forward -Z
    this.headCone = new THREE.Mesh(coneGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {},
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 2.6) * 0.12;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a, a);
        }
      `,
    }));
    this.headCone.scale.set(3.4, 26, 2.2);
    this.headCone.position.set(0, -0.1, -1.4);
    this.headCone.rotation.x = -0.06;
    this.body.add(this.headCone);

    // state
    this.pos = new THREE.Vector3(0, PLAYER.startY, 0);
    this.vel = new THREE.Vector3(0, 0, -PLAYER.cruise);
    this.speed = PLAYER.cruise;
    this.heat = 0;
    this.overheated = 0;
    this.burnCd = 0;
    this.boosting = false;
    this.alive = true;
    this.bank = 0; this.pitch = 0;
    this.radius = PLAYER.radius;
    this.topSpeed = 0;
  }

  reset(z0) {
    this.pos.set(0, PLAYER.startY, z0);
    this.vel.set(0, 0, -PLAYER.cruise);
    this.speed = PLAYER.cruise;
    this.heat = 0; this.overheated = 0; this.burnCd = 0;
    this.alive = true; this.bank = 0; this.pitch = 0;
    this.topSpeed = 0;
    this.rig.visible = true;
    this.rig.rotation.set(0, 0, 0);
  }

  update(dt, input, ceiling) {
    const P = PLAYER;
    if (!this.alive) return;

    // throttle
    let target = this.speedHold ?? P.cruise;
    if (input.keys.has('KeyW')) this.speedHold = clamp((this.speedHold ?? P.cruise) + P.throttleRate * dt, P.minSpeed, P.maxSpeed);
    if (input.keys.has('KeyS')) this.speedHold = clamp((this.speedHold ?? P.cruise) - P.throttleRate * dt, P.minSpeed, P.maxSpeed);
    target = this.speedHold ?? P.cruise;

    // boost + heat
    this.boosting = false;
    if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) {
      if (this.overheated <= 0 && this.heat < 100) {
        this.boosting = true;
        target = P.boostSpeed;
        this.heat += P.heatRate * dt;
        if (this.heat >= 100) { this.heat = 100; this.overheated = P.overheatLock; }
      }
    }
    if (!this.boosting) this.heat = Math.max(0, this.heat - P.coolRate * dt);
    if (this.overheated > 0) this.overheated -= dt;

    this.speed = damp(this.speed, target, this.boosting ? 2.6 : 1.9, dt);
    this.topSpeed = Math.max(this.topSpeed, this.speed);

    // steering from mouse offset
    const latT = input.mx * P.latMax;
    const vertT = -input.my * P.vertMax;
    this.vel.x = damp(this.vel.x, latT, P.steerLag, dt);
    this.vel.y = damp(this.vel.y, vertT, P.steerLag * 0.9, dt);

    // vertical burn (edge-triggered from the key handler, or held)
    if (this.burnCd > 0) this.burnCd -= dt;
    if ((input.burn || input.keys.has('Space')) && this.burnCd <= 0) {
      this.vel.y += P.burnImpulse;
      this.burnCd = P.burnCooldown;
      this.burnFlash = 1;
    }
    this.burnFlash = Math.max(0, (this.burnFlash || 0) - dt * 2.2);

    this.vel.z = -this.speed;
    this.pos.addScaledVector(this.vel, dt);

    // grid boundary (soft) — the canyon towers are the hard kill
    const XL = 38;
    if (Math.abs(this.pos.x) > XL) { this.pos.x = Math.sign(this.pos.x) * XL; this.vel.x *= -0.35; }
    if (this.pos.y > ceiling) { this.pos.y = damp(this.pos.y, ceiling, 8, dt); this.vel.y = Math.min(this.vel.y, 2); this.ceilingHit = 1; }
    else this.ceilingHit = Math.max(0, (this.ceilingHit || 0) - dt * 2);
    if (this.pos.y < 1.0) this.pos.y = 1.0;

    // pose
    this.bank = damp(this.bank, clamp(-this.vel.x * 0.032, -0.65, 0.65), 6, dt);
    this.pitch = damp(this.pitch, clamp(this.vel.y * 0.02, -0.42, 0.42) - (this.boosting ? 0.06 : 0), 6, dt);
    this.rig.position.copy(this.pos);
    this.rig.rotation.z = this.bank;
    this.rig.rotation.x = this.pitch;
    this.rig.rotation.y = clamp(-this.vel.x * 0.012, -0.3, 0.3);

    // secondary motion: umbrella drag, fare lean
    const drag = clamp(this.speed / PLAYER.boostSpeed, 0, 1);
    this.umbrella.rotation.x = -0.28 * drag + Math.sin(performance.now() * 0.003) * 0.04;
    this.fare.group.rotation.x = 0.1 * drag;
    this.fare.mixer.update(dt);
    this.drone.mixer && this.drone.mixer.update(dt);

    // thrusters flare
    const pw = clamp((this.speed - PLAYER.minSpeed) / (PLAYER.boostSpeed - PLAYER.minSpeed), 0, 1) + (this.burnFlash || 0) * 0.7;
    for (const t of this.thrusters) t.material.uniforms.uPow.value = pw;

    // feed the wet-street hero lights
    const dl = GlobalUniforms.uDynPos.value, dc = GlobalUniforms.uDynCol.value;
    dl[0].set(this.pos.x, Math.max(this.pos.y - 1, 1), this.pos.z - 9, 1.5);
    dc[0].setRGB(0.9, 0.95, 1.0);
    dl[1].set(this.pos.x, Math.max(this.pos.y - 2, 0.5), this.pos.z, 1.1 + pw * 1.5);
    dc[1].setHex(0x53d5fd);
  }

  // idle pose for the attract loop (parked on a rooftop pad off-screen)
  hide() { this.rig.visible = false; }
}
