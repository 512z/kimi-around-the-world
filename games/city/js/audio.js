// Procedural WebAudio: menu blips per spec + rain bed, synth pad, engine,
// boost, sirens. No audio assets; context created lazily on first gesture.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.mode = 'menu';
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);

    // ---- rain bed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.03 * w) / 1.03; d[i] = (last * 2.4 + w * 0.22) * 0.8; }
    const rain = ctx.createBufferSource(); rain.buffer = buf; rain.loop = true;
    const rainBP = ctx.createBiquadFilter(); rainBP.type = 'bandpass'; rainBP.frequency.value = 900; rainBP.Q.value = 0.45;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.05;
    rain.connect(rainBP); rainBP.connect(this.rainGain); this.rainGain.connect(this.master);
    rain.start();

    // ---- brooding pad (two detuned saws through a slow lowpass)
    this.padOsc = [];
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    const padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.frequency.value = 320; padLP.Q.value = 2.2;
    this.padLP = padLP;
    for (const [f, dt] of [[55, -6], [82.41, 5], [110, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt;
      const g = ctx.createGain(); g.gain.value = 0.3;
      o.connect(g); g.connect(padLP); o.start();
      this.padOsc.push(o);
    }
    padLP.connect(this.padGain); this.padGain.connect(this.master);

    // ---- engine
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 62;
    this.engSub = ctx.createOscillator(); this.engSub.type = 'sine'; this.engSub.frequency.value = 31;
    const engLP = ctx.createBiquadFilter(); engLP.type = 'lowpass'; engLP.frequency.value = 240; engLP.Q.value = 1.4;
    this.engLP = engLP;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const subG = ctx.createGain(); subG.gain.value = 0.5;
    this.engOsc.connect(engLP); this.engSub.connect(subG); subG.connect(engLP);
    engLP.connect(this.engGain); this.engGain.connect(this.master);
    this.engOsc.start(); this.engSub.start();

    // ---- boost wind
    const wb = ctx.createBufferSource(); wb.buffer = buf; wb.loop = true; wb.playbackRate.value = 0.7;
    this.boostBP = ctx.createBiquadFilter(); this.boostBP.type = 'bandpass'; this.boostBP.frequency.value = 600; this.boostBP.Q.value = 1.1;
    this.boostGain = ctx.createGain(); this.boostGain.gain.value = 0;
    wb.connect(this.boostBP); this.boostBP.connect(this.boostGain); this.boostGain.connect(this.master);
    wb.start();

    // ---- distant siren (two-tone)
    this.sirOsc = ctx.createOscillator(); this.sirOsc.type = 'triangle'; this.sirOsc.frequency.value = 700;
    const sirHP = ctx.createBiquadFilter(); sirHP.type = 'highpass'; sirHP.frequency.value = 500;
    this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
    this.sirOsc.connect(sirHP); sirHP.connect(this.sirGain); this.sirGain.connect(this.master);
    this.sirOsc.start();
    this._sirT = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.linearRampToValueAtTime(on ? 0.85 : 0, this.ctx.currentTime + 0.15);
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (mode === 'menu') {
      this.padGain.gain.linearRampToValueAtTime(0.05, t + 1.2);
      this.engGain.gain.linearRampToValueAtTime(0, t + 0.4);
      this.boostGain.gain.linearRampToValueAtTime(0, t + 0.3);
      this.sirGain.gain.linearRampToValueAtTime(0, t + 0.4);
      this.rainGain.gain.linearRampToValueAtTime(0.05, t + 1.0);
    } else {
      this.padGain.gain.linearRampToValueAtTime(0.016, t + 1.0);
      this.engGain.gain.linearRampToValueAtTime(0.055, t + 0.6);
      this.rainGain.gain.linearRampToValueAtTime(0.085, t + 1.0);
    }
  }

  // short synth blip helper
  _blip(freq, dur = 0.05, gain = 0.035, type = 'sine', slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(dur, gain, freq = 800, q = 0.7, slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(freq, t); bp.Q.value = q;
    if (slide) bp.frequency.exponentialRampToValueAtTime(Math.max(60, freq + slide), t + dur);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  }

  event(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'nav': this._blip(2100, 0.05, 0.035); break;
      case 'confirm': this._blip(880, 0.07, 0.05); setTimeout(() => this._blip(1320, 0.1, 0.05), 55); break;
      case 'back': this._blip(1500, 0.06, 0.03, 'sine', -500); break;
      case 'tick': this._blip(1050, 0.06, 0.05); break;
      case 'go': this._blip(1320, 0.08, 0.06); setTimeout(() => this._blip(1760, 0.16, 0.06), 70); break;
      case 'countdown': break;
      case 'nearmiss': this._blip(2600, 0.09, 0.045, 'sine', -700); break;
      case 'ghost': this._blip(1800, 0.12, 0.03); setTimeout(() => this._blip(2400, 0.14, 0.025), 60); break;
      case 'cordon':
        this._blip(660, 0.1, 0.06); setTimeout(() => this._blip(990, 0.12, 0.06), 80);
        setTimeout(() => this._blip(1320, 0.2, 0.05), 160);
        this._noise(0.5, 0.10, 500, 0.6, 900);
        break;
      case 'crash':
        this._noise(0.9, 0.30, 300, 0.4, -240);
        this._blip(55, 0.6, 0.20, 'sine', -25);
        break;
      case 'pause': this._blip(700, 0.08, 0.03); break;
      case 'warning': this._blip(490, 0.14, 0.04, 'square'); break;
    }
  }

  gameFrame(player, pursuerDist) {
    if (!this.ctx || this.mode !== 'game') return;
    const t = this.ctx.currentTime;
    const sp = player.speed / 74;
    this.engOsc.frequency.setTargetAtTime(52 + sp * 74, t, 0.08);
    this.engSub.frequency.setTargetAtTime(26 + sp * 37, t, 0.08);
    this.engLP.frequency.setTargetAtTime(200 + sp * 900, t, 0.1);
    this.boostGain.gain.setTargetAtTime(player.boosting ? 0.12 : 0.0, t, 0.14);
    this.boostBP.frequency.setTargetAtTime(player.boosting ? 2100 : 500, t, 0.3);
    // siren proximity wail
    this._sirT += 0.016;
    const two = Math.floor(this._sirT * 2.6) % 2;
    this.sirOsc.frequency.setTargetAtTime(two ? 720 : 950, t, 0.03);
    const prox = Math.max(0, 1 - pursuerDist / 60);
    this.sirGain.gain.setTargetAtTime(prox * 0.016, t, 0.2);
  }
}
