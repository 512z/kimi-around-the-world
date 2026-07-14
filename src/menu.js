// Menu system (game-menu-design rules): single left rail, screens swap on the
// rail, tick-line selection, value items, keyboard + mouse, audio blips.
const COLORS = [
  { id: 'blue',   label: 'BLUE',   hex: '#2E7BF6' },
  { id: 'yellow', label: 'YELLOW', hex: '#f2c94c' },
  { id: 'red',    label: 'RED',    hex: '#eb5757' },
  { id: 'green',  label: 'GREEN',  hex: '#27ae60' },
  { id: 'brown',  label: 'BROWN',  hex: '#8b5a2b' },
];
export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));

const $ = (id) => document.getElementById(id);

export function createMenu({ onSingle, onMulti, onResume, onLeave, onProfileChange }) {
  // ---------------------------------------------------------- audio (lazy)
  let actx = null;
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }
  }
  function beep(f = 2100, gv = 0.035, d = 0.05) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(gv, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0006, actx.currentTime + d);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + d + 0.01);
  }
  const confirmBeep = () => { beep(1300); setTimeout(() => beep(1950), 70); };

  // ---------------------------------------------------------- profile
  let name = (localStorage.getItem('kimi.name') || 'KIMI').toUpperCase();
  if (!/^[A-Z]IMI$/.test(name)) name = 'KIMI';
  let colorId = localStorage.getItem('kimi.color') || 'blue';
  if (!COLOR_BY_ID[colorId]) colorId = 'blue';

  // dots
  const dotsEl = $('v-dots');
  const dotEls = COLORS.map((c) => {
    const b = document.createElement('b');
    b.className = 'dot';
    b.style.setProperty('--c', c.hex);
    dotsEl.appendChild(b);
    return b;
  });

  function paintProfile() {
    $('v-name-t').innerHTML = '';
    if (editing) {
      const first = document.createElement('span');
      first.textContent = name[0];
      const caret = document.createElement('span');
      caret.className = 'caret';
      const rest = document.createElement('span');
      rest.textContent = 'IMI';
      $('v-name-t').append(first, caret, rest);
    } else {
      $('v-name-t').textContent = name;
    }
    const col = COLOR_BY_ID[colorId];
    $('v-color-t').textContent = col.label;
    dotEls.forEach((d, i) => d.classList.toggle('on', COLORS[i].id === colorId));
    localStorage.setItem('kimi.name', name);
    localStorage.setItem('kimi.color', colorId);
    onProfileChange?.({ name, color: colorId });
  }

  // ---------------------------------------------------------- screens
  const screens = { main: $('main'), mode: $('mode'), controls: $('controls'), pause: $('pause') };
  const lists = {
    main: [...$('mm').querySelectorAll('.mi')],
    mode: [...$('md').querySelectorAll('.mi')],
    controls: [...$('mc').querySelectorAll('.mi')],
    pause: [...$('mp').querySelectorAll('.mi')],
  };
  const sel = { main: 0, mode: 0, controls: 0, pause: 0 };
  let cur = 'main';
  let editing = false;

  function paintSel() { (lists[cur] || []).forEach((el, i) => el.classList.toggle('sel', i === sel[cur])); }
  function show(name) {
    editing = false;
    cur = name;
    for (const [n, el] of Object.entries(screens)) el.classList.toggle('on', n === name);
    if (name) { sel[name] = Math.min(sel[name], lists[name].length - 1); paintSel(); paintProfile(); }
  }
  function setSel(i, snd) { if (sel[cur] === i) return; sel[cur] = i; paintSel(); if (snd) beep(); }

  function cycleColor(dir) {
    let i = COLORS.findIndex((c) => c.id === colorId);
    i = (i + dir + COLORS.length) % COLORS.length;
    colorId = COLORS[i].id;
    paintProfile();
    beep();
  }

  function activate(dir = 1) {
    const el = lists[cur][sel[cur]];
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'name') {
      if (dir !== 1) return;
      editing = true;
      paintProfile();
      confirmBeep();
      return;
    }
    if (act === 'color') { cycleColor(dir); return; }
    confirmBeep();
    if (act === 'play') show('mode');
    if (act === 'single') onSingle();
    if (act === 'multi') onMulti();
    if (act === 'controls') show('controls');
    if (act === 'back') show('main');
    if (act === 'resume') onResume();
    if (act === 'leave') onLeave();
  }

  dotEls.forEach((d, i) => {
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cur !== 'main' || editing) return;
      if (colorId !== COLORS[i].id) { colorId = COLORS[i].id; paintProfile(); beep(); }
      const idx = lists.main.findIndex((el) => el.dataset.act === 'color');
      if (idx >= 0) setSel(idx, false);
    });
  });

  // mouse
  for (const [screenName, items] of Object.entries(lists)) {
    items.forEach((el, i) => {
      el.addEventListener('mouseenter', () => { if (cur === screenName && !editing) setSel(i, true); });
      el.addEventListener('click', (e) => {
        e.currentTarget.blur();
        if (cur !== screenName || editing) return;
        sel[screenName] = i; paintSel(); activate();
      });
    });
  }

  // keyboard
  function handleKey(e) {
    ensureAudio();
    if (!cur && !editing) return false;
    if (editing) {
      if (e.code === 'Escape') { editing = false; paintProfile(); beep(); return true; }
      if (/^Key[A-Z]$/.test(e.code)) {
        name = e.code.slice(3) + 'IMI';
        editing = false;
        paintProfile();
        confirmBeep();
        return true;
      }
      return true; // swallow everything else while editing
    }
    const n = lists[cur].length;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': setSel((sel[cur] + n - 1) % n, true); return true;
      case 'ArrowDown': case 'KeyS': setSel((sel[cur] + 1) % n, true); return true;
      case 'ArrowLeft': activate(-1); return true;
      case 'ArrowRight': activate(1); return true;
      case 'Enter': case 'Space': activate(); return true;
      case 'Escape':
        if (cur === 'controls' || cur === 'mode') { show('main'); beep(); }
        else if (cur === 'pause') onResume();
        return true;
    }
    return false;
  }

  // ---------------------------------------------------------- HUD
  let hintTimer = null;
  function showHint() {
    const h = $('play-hint');
    h.style.opacity = '0.8';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { h.style.opacity = '0'; }, 8000);
  }
  function hideHint() { $('play-hint').style.opacity = '0'; clearTimeout(hintTimer); }
  function setCrew(n) { $('crew-n').textContent = String(n); }

  paintProfile();
  show('main');

  return {
    handleKey, show, setCrew, showHint, hideHint, ensureAudio,
    getProfile: () => ({ name, color: colorId }),
    isEditing: () => editing,
  };
}
