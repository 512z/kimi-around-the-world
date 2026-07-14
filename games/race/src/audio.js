// SELENE GP — fully synthesized race audio. No assets.

export class RaceAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineSub = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.rivalGain = null;
    this.rivalOsc = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.ctx.destination);

    // engine: detuned sawtooth pair + sub sine through a lowpass
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.detune.value = 7;
    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = 'sine';
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineSub.connect(this.engineGain);
    this.engineOsc.start(); this.engineOsc2.start(); this.engineSub.start();

    // rival pass-by voice
    this.rivalOsc = this.ctx.createOscillator();
    this.rivalOsc.type = 'sawtooth';
    const rf = this.ctx.createBiquadFilter();
    rf.type = 'lowpass'; rf.frequency.value = 500;
    this.rivalGain = this.ctx.createGain();
    this.rivalGain.gain.value = 0;
    this.rivalOsc.connect(rf).connect(this.rivalGain).connect(this.master);
    this.rivalOsc.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  duck(on) {
    if (!this.ctx || !this.master || !this.enabled) return;
    this.master.gain.setTargetAtTime(on ? 0.06 : 0.5, this.ctx.currentTime, 0.15);
  }

  // car: player CarSim; nearest: {dist, relSpeed} of closest rival or null
  updateEngine(car, nearest, dt) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const sp01 = Math.min(1, car.speed / 85);
    const thr = car.throttleViz;
    const f = 38 + sp01 * 118 + thr * 34 + (car.boosting ? 26 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(350 + sp01 * 2600 + thr * 1200, t, 0.08);
    const vol = (car.disabled ? 0.015 : 0.03) + thr * 0.075 + sp01 * 0.05 + (car.boosting ? 0.05 : 0) + (car.grounded ? 0 : -0.02);
    this.engineGain.gain.setTargetAtTime(Math.max(0.004, vol), t, 0.09);

    if (nearest && nearest.dist < 90) {
      const k = Math.max(0, 1 - nearest.dist / 90);
      this.rivalOsc.frequency.setTargetAtTime(40 + Math.min(1, nearest.speed / 85) * 110, t, 0.1);
      this.rivalGain.gain.setTargetAtTime(k * k * 0.09, t, 0.12);
    } else {
      this.rivalGain.gain.setTargetAtTime(0, t, 0.2);
    }
  }

  beep(freq = 880, dur = 0.12, gain = 0.12, type = 'square') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  countdown(n) {
    if (n === 0) { // GO!
      this.beep(1320, 0.3, 0.14, 'square');
      setTimeout(() => this.beep(1760, 0.35, 0.1, 'square'), 90);
    } else {
      this.beep(660, 0.11, 0.11);
    }
  }

  checkpoint() { this.beep(990, 0.08, 0.07, 'sine'); setTimeout(() => this.beep(1320, 0.1, 0.06, 'sine'), 70); }

  boostPad() { this.beep(520, 0.09, 0.09, 'triangle'); setTimeout(() => this.beep(780, 0.12, 0.08, 'triangle'), 60); }

  finish() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.beep(f, 0.28, 0.11, 'square'), i * 130));
  }

  whoosh() { // boost ignition
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const dur = 0.45;
    this._noiseBurst(t, dur, 300, 2200, 0.14);
  }

  _noiseBurst(t, dur, f0, f1, gain, type = 'bandpass') {
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  itemPickup() { this.beep(1175, 0.07, 0.09, 'square'); setTimeout(() => this.beep(1568, 0.1, 0.08, 'square'), 60); }
  rocketLaunch() { if (this.ctx && this.enabled) this._noiseBurst(this.ctx.currentTime, 0.3, 900, 200, 0.1); }
  explosion() {
    if (!this.ctx || !this.enabled) return;
    this._noiseBurst(this.ctx.currentTime, 0.55, 180, 40, 0.22, 'lowpass');
    this.beep(70, 0.4, 0.12, 'sine');
  }
  shieldUp() { this.beep(523, 0.18, 0.08, 'sine'); setTimeout(() => this.beep(784, 0.22, 0.07, 'sine'), 100); }
  shieldBlock() { this.beep(392, 0.12, 0.09, 'triangle'); }
  splat() { this.beep(220, 0.08, 0.08, 'sine'); setTimeout(() => this.beep(160, 0.1, 0.07, 'sine'), 50); }
  turbo() { if (this.ctx && this.enabled) this._noiseBurst(this.ctx.currentTime, 0.5, 400, 2600, 0.12); }
}
