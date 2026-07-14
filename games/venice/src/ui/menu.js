// Front-end state machine: one left rail, screen stack, keyboard+mouse input.
import { blip, setSound } from './audio.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, '0')}.${d}`;
};

export function makeUI(app) {
  const ui = document.getElementById('ui');
  const scrim = document.getElementById('scrim');
  const noticeEl = document.getElementById('notice');
  const hudEl = document.getElementById('hud');
  const game = app.game;

  // ---------- screen definitions ----------
  const screens = {
    menu: {
      over: 'CANALE DI VENEZIA — 05:40',
      title: ['VENICE ', 'SPEED'],
      items: [
        { label: 'START RUN', act: 'start' },
        { label: 'CONTROLS', act: 'controls' },
        { label: 'SETTINGS', act: 'settings' },
      ],
      footer: '↑↓ SELECT   ENTER CONFIRM',
    },
    controls: {
      over: 'HOW TO POLE',
      title: ['THE ', 'CONTROLS'],
      body: 'controls',
      items: [{ label: 'BACK', act: 'back' }],
      footer: 'ESC BACK',
    },
    settings: {
      over: 'PREFERENCES',
      title: ['THE ', 'SETTINGS'],
      items: [
        { label: 'QUALITY', value: () => app.settings.quality, cycle: (d) => cycleQuality(d) },
        { label: 'SOUND', value: () => (app.settings.sound ? 'ON' : 'OFF'), cycle: () => toggleSound() },
        { label: 'BACK', act: 'back' },
      ],
      footer: '←→ CHANGE   ENTER CONFIRM',
    },
    pause: {
      over: 'THE CANAL WAITS',
      title: ['GAME ', 'PAUSED'],
      items: [
        { label: 'RESUME', act: 'resume' },
        { label: 'RESTART RUN', act: 'restart' },
        { label: 'SETTINGS', act: 'settings' },
        { label: 'MAIN MENU', act: 'main' },
      ],
      footer: 'ESC RESUME',
    },
    results: {
      over: 'RUN COMPLETE',
      title: ['0:00.0'],
      body: 'results',
      items: [
        { label: 'RETRY', act: 'restart' },
        { label: 'MAIN MENU', act: 'main' },
      ],
      footer: 'ENTER CONFIRM',
    },
  };

  function cycleQuality(d) {
    const order = ['LOW', 'MEDIUM', 'HIGH'];
    const i = order.indexOf(app.settings.quality);
    app.applyQuality(order[(i + d + 3) % 3]);
    blip.nav();
    refreshValues();
  }
  function toggleSound() {
    app.settings.sound = !app.settings.sound;
    app.saveSettings();
    setSound(app.settings.sound);
    blip.confirm();
    refreshValues();
  }

  // ---------- DOM ----------
  const screenEls = {};
  for (const [id, def] of Object.entries(screens)) {
    const el = h(`<section class="screen${def.body ? ' sub' : ''}" data-screen="${id}">
      <div class="rail">
        <div class="over">${def.over}</div>
        <div class="ttl">${titleHTML(def)}</div>
        <div class="menu"></div>
        <div class="foot">${def.footer || ''}</div>
      </div>
    </section>`);
    const menuEl = el.querySelector('.menu');
    if (def.body) {
      const body = h(`<div class="body"></div>`);
      el.querySelector('.rail').insertBefore(body, menuEl);
      if (def.body === 'controls') {
        body.innerHTML = `
          <div class="row"><span class="k">W</span><span class="v">POLE FORWARD — THRUST</span></div>
          <div class="row"><span class="k">A / D</span><span class="v">WORK THE OAR — STEER LEFT / RIGHT</span></div>
          <div class="row"><span class="k">S</span><span class="v">BACK-POLE — REVERSE + BRAKE</span></div>
          <div class="row"><span class="k">MOUSE</span><span class="v">SWEEP THE OAR — ANALOG THRUST + STEER</span></div>
          <div class="row"><span class="k">SPACE</span><span class="v">SHOVE OFF A WALL</span></div>
          <p class="desc">Ferry each fare between the moorings. Kiss the dock slow and straight to let them step aboard. Scrape plaster, clip a pier, or ram the mooring and the fare steps off — three lost fares ends the morning. The tide turns mid-route and the canal only gets narrower.</p>`;
      }
    }
    def.items.forEach((it, i) => {
      const mi = h(`<button class="mi" data-i="${i}">
        <span class="tick"></span>
        <span class="label">${it.label}</span>
        ${it.value ? `<span class="val"><span class="chev">‹&nbsp;</span><span class="vv"></span><span class="chev">&nbsp;›</span></span>` : ''}
      </button>`);
      mi.addEventListener('pointerover', () => select(id, i));
      mi.addEventListener('click', () => { activate(id, i); mi.blur(); });
      menuEl.appendChild(mi);
    });
    ui.appendChild(el);
    screenEls[id] = el;
  }

  function titleHTML(def) {
    const t = def.title;
    if (t.length === 2) return `${t[0]}<span class="acc">${t[1]}</span>`;
    return t[0];
  }

  function refreshValues() {
    for (const [id, def] of Object.entries(screens)) {
      def.items.forEach((it, i) => {
        if (!it.value) return;
        const vv = screenEls[id].querySelector(`.mi[data-i="${i}"] .vv`);
        if (vv) vv.textContent = it.value();
      });
    }
  }

  // ---------- navigation ----------
  let stack = ['menu'];
  let sel = { menu: 0, controls: 0, settings: 0, pause: 0, results: 0 };
  let mode = 'menu'; // 'menu' | 'hud'

  function current() { return stack[stack.length - 1]; }

  function select(id, i) {
    const def = screens[id];
    i = (i + def.items.length) % def.items.length;
    if (sel[id] !== i) { sel[id] = i; blip.nav(); }
    [...screenEls[id].querySelectorAll('.mi')].forEach((mi, k) => mi.classList.toggle('sel', k === i));
  }

  function show(id, { asBack = false } = {}) {
    if (!asBack && current() !== id) stack.push(id);
    const el = screenEls[id];
    for (const [sid, sel2] of Object.entries(screenEls)) {
      const on = sel2 === el;
      sel2.classList.toggle('active', on);
      if (on) {
        sel2.classList.remove('entering');
        void sel2.offsetWidth;
        sel2.classList.add('entering');
      }
    }
    refreshValues();
    select(id, sel[id] || 0);
  }

  function goBack() {
    if (stack.length > 1) {
      stack.pop();
      show(current(), { asBack: true });
      blip.back();
    }
  }

  function activate(id, i) {
    const it = screens[id].items[i];
    if (!it) return;
    if (it.cycle) { it.cycle(1); return; }
    blip.confirm();
    switch (it.act) {
      case 'start': startGame(); break;
      case 'restart': startGame(); break;
      case 'controls': show('controls'); break;
      case 'settings': show('settings'); break;
      case 'back': goBack(); break;
      case 'resume': resumeGame(); break;
      case 'main': toMainMenu(); break;
    }
  }

  // ---------- mode transitions ----------
  // chrome-only switch (menu rail away, HUD on) — multiplayer enters the water
  // through this without arming a solo run
  function enterHud() {
    stack = ['menu'];
    for (const el of Object.values(screenEls)) el.classList.remove('active');
    mode = 'hud';
    ui.classList.add('playing', 'hudonly');
    scrim.classList.add('playing');
    hudEl.classList.add('active');
    hud.onRunStart();
  }

  function startGame() {
    enterHud();
    app.startRun();
  }

  function pauseGame() {
    if (mode !== 'hud' || (game.R.state !== 'playing' && game.R.state !== 'countdown')) return;
    mode = 'menu';
    app.setMode('paused');
    ui.classList.remove('playing', 'hudonly');
    scrim.classList.remove('playing');
    hudEl.classList.remove('active');
    stack = ['pause'];
    show('pause', { asBack: true });
  }

  function resumeGame() {
    mode = 'hud';
    app.setMode('game');
    ui.classList.add('playing', 'hudonly');
    scrim.classList.add('playing');
    hudEl.classList.add('active');
    for (const el of Object.values(screenEls)) el.classList.remove('active');
    blip.confirm();
  }

  function toMainMenu() {
    mode = 'menu';
    app.quitToMenu();
    hudEl.classList.remove('active');
    stack = ['menu'];
    show('menu', { asBack: true });
  }

  function showResults(r) {
    mode = 'menu';
    app.setMode('results');
    ui.classList.remove('playing', 'hudonly');
    scrim.classList.remove('playing');
    hudEl.classList.remove('active');
    noticeEl.classList.remove('pop', 'pop-slow'); // no leftover notices over results
    void noticeEl.offsetWidth;
    const def = screens.results;
    const el = screenEls.results;
    el.querySelector('.over').textContent = r.kind === 'complete' ? 'RUN COMPLETE' : 'THE MORNING IS LOST';
    el.querySelector('.ttl').innerHTML = `${fmtTime(r.time)}`;
    const rating = r.kind !== 'complete' ? 'UNFINISHED'
      : r.lost === 0 && r.fares === 5 ? 'PERFECT MORNING'
      : r.fares >= 4 ? 'FAIR WINDS'
      : 'CHOPPY WATERS';
    const body = el.querySelector('.body');
    body.innerHTML = `
      <div class="row"><span class="k">FARES</span><span class="v acc">${r.fares} / 5 DELIVERED</span></div>
      <div class="row"><span class="k">LOST</span><span class="v">${r.lost} STEPPED OFF</span></div>
      <div class="row"><span class="k">BUMPS</span><span class="v">${r.bumps}</span></div>
      <div class="row"><span class="k">RATING</span><span class="v">${rating}</span></div>`;
    stack = ['results'];
    show('results', { asBack: true });
  }

  // ---------- keyboard ----------
  addEventListener('keydown', (e) => {
    if (mode === 'hud') {
      if (e.key === 'Escape') pauseGame();
      return;
    }
    const id = current();
    const def = screens[id];
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); select(id, sel[id] + 1); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); select(id, sel[id] - 1); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      const it = def.items[sel[id]];
      if (it?.cycle) { e.preventDefault(); it.cycle(-1); }
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      const it = def.items[sel[id]];
      if (it?.cycle) { e.preventDefault(); it.cycle(1); }
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      activate(id, sel[id]);
    } else if (k === 'Escape') {
      if (id === 'pause') resumeGame();
      else goBack();
    }
  });

  // ---------- notices ----------
  let noticeTimer = null;
  function notice(html, { small = false, slow = false } = {}) {
    noticeEl.innerHTML = html;
    noticeEl.classList.remove('pop', 'pop-slow', 'small');
    void noticeEl.offsetWidth;
    if (small) noticeEl.classList.add('small');
    noticeEl.classList.add(slow ? 'pop-slow' : 'pop');
  }

  // ---------- HUD ----------
  const hud = makeHUD(app, notice);

  game.on('results', showResults);
  game.on('countdown', (n) => { blip.nav(); notice(`${n}`); });
  game.on('go', () => { blip.go(); notice(`<span class="acc">GO</span>`); });
  game.on('notice', (n) => {
    if (n.kind === 'bad') { blip.bad(); notice(n.text, { small: true, slow: true }); }
    else if (n.kind === 'good') { blip.good(); notice(n.text, { small: true }); }
    else if (n.text === 'THE TIDE TURNS') { notice(n.text, { small: true, slow: true }); }
  });

  // open main menu
  refreshValues();
  show('menu');

  return { notice, hud, enterHud, get mode() { return mode; } };
}

// ---------------------------------------------------------------- HUD ----
function makeHUD(app, notice) {
  const game = app.game;
  const el = document.getElementById('hud');
  el.innerHTML = `
    <div class="hud-clock"><span class="t">0:00.0</span><span class="sub"></span></div>
    <div class="hud-fares"></div>
    <div class="hud-speed">
      <div class="num">0.0</div>
      <div class="lab">KNOTS · <span class="tide"></span></div>
    </div>
    <div class="hud-rail"></div>
    <div class="hud-kiss">KISS THE DOCK<div class="barline"><i></i></div></div>
    <div class="hud-hints">
      <div><b>W</b> POLE FORWARD · <b>A D</b> STEER · <b>S</b> BACK-POLE</div>
      <div><b>MOUSE</b> SWEEP THE OAR — ANALOG CONTROL</div>
      <div><b>SPACE</b> SHOVE OFF A WALL · <b>E</b> ITEM · <b>ESC</b> PAUSE</div>
    </div>`;

  const clockEl = el.querySelector('.hud-clock .t');
  const subEl = el.querySelector('.hud-clock .sub');
  const faresEl = el.querySelector('.hud-fares');
  const speedEl = el.querySelector('.hud-speed .num');
  const tideEl = el.querySelector('.tide');
  const railEl = el.querySelector('.hud-rail');
  const kissEl = el.querySelector('.hud-kiss');
  const kissBar = kissEl.querySelector('i');
  const hintsEl = el.querySelector('.hud-hints');

  // dock ticks
  const DOCK_POS = [25, 140, 255, 375, 480, 585];
  const ticks = DOCK_POS.map((s, i) => {
    const t = document.createElement('i');
    t.className = 'tick';
    t.style.top = `${(s / 600) * 100}%`;
    railEl.appendChild(t);
    return t;
  });
  const dot = document.createElement('i');
  dot.className = 'dot';
  railEl.appendChild(dot);

  let hintsTimer = null;
  function onRunStart() {
    hintsEl.classList.remove('gone');
    clearTimeout(hintsTimer);
    hintsTimer = setTimeout(() => hintsEl.classList.add('gone'), 8000);
  }

  let lastLeg = 0;
  game.on('hud', (d) => {
    const m = Math.floor(d.time / 60), s = Math.floor(d.time % 60), dd = Math.floor((d.time * 10) % 10);
    clockEl.textContent = `${m}:${String(s).padStart(2, '0')}.${dd}`;
    subEl.textContent = d.mpOrder
      ? `P${d.mpOrder}/${d.mpTotal} — FIRST TO ZATTERE ALBA`
      : d.carrying
        ? `FARE ${d.leg + 1}/5 → ${d.legName}`
        : `NO FARE — REACH ${d.legName}`;
    speedEl.textContent = (d.speed * 1.94).toFixed(1);
    tideEl.textContent = d.tideDir > 0 ? 'TIDE ▲' : 'TIDE ▼';
    if (d.mpOrder) {
      faresEl.innerHTML = `REGATTA <span class="lost">P${d.mpOrder}</span>`;
    } else {
      const lost = '●'.repeat(d.faresLost) + '○'.repeat(d.maxLost - d.faresLost);
      faresEl.innerHTML = `FARES LOST <span class="lost">${lost}</span>`;
    }
    dot.style.top = `${Math.min(1, d.progress) * 100}%`;
    for (let i = 0; i < ticks.length; i++) ticks[i].classList.toggle('done', i <= d.leg);
    if (d.kiss > 0.02) {
      kissEl.classList.add('on');
      kissBar.style.width = `${Math.min(1, d.kiss) * 100}%`;
    } else {
      kissEl.classList.remove('on');
    }
    lastLeg = d.leg;
  });

  return { onRunStart };
}
