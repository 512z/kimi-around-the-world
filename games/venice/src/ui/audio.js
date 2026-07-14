// Tiny WebAudio blips — no assets. Lazy AudioContext on first user gesture.
let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  } catch {}
  return ctx;
}

export function initAudio(on) {
  enabled = on;
  const kick = () => { ensure(); if (ctx?.state === 'suspended') ctx.resume(); };
  addEventListener('pointerdown', kick, { once: true });
  addEventListener('keydown', kick, { once: true });
}
export function setSound(on) { enabled = on; }

function tone(freq, dur, gain, type = 'sine', when = 0, slideTo = null) {
  if (!enabled || !ensure()) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export const blip = {
  nav: () => tone(2100, 0.05, 0.035),
  confirm: () => { tone(880, 0.09, 0.04); tone(1320, 0.12, 0.035, 'sine', 0.06); },
  back: () => tone(1400, 0.06, 0.03, 'sine', 0, 900),
  bad: () => { tone(200, 0.16, 0.05, 'triangle', 0, 120); },
  good: () => { tone(700, 0.1, 0.04); tone(1050, 0.14, 0.04, 'sine', 0.07); tone(1580, 0.18, 0.03, 'sine', 0.14); },
  go: () => tone(520, 0.22, 0.05, 'sine', 0, 1040),
};
