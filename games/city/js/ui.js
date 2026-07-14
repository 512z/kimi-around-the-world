import { QUALITY_PRESETS, QUALITY_ORDER, STORAGE } from './config.js';
import { clamp } from './utils.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

export class UI {
  constructor(game, engine, life, audio) {
    this.game = game; this.engine = engine; this.life = life; this.audio = audio;
    game.ui = this;

    this.screens = {};
    for (const el of $$('.screen')) this.screens[el.dataset.screen] = el;
    this.stack = [];
    this.active = null;
    this.sel = 0;
    this.items = [];

    this.quality = localStorage.getItem(STORAGE.quality) || 'HIGH';
    if (!QUALITY_PRESETS[this.quality]) this.quality = 'HIGH';
    this.sound = (localStorage.getItem(STORAGE.sound) ?? 'ON') === 'ON';
    this.best = parseInt(localStorage.getItem(STORAGE.best) || '0', 10);

    audio.enabled = this.sound;
    this._applyQuality(false);

    // pointer
    document.addEventListener('mousemove', (e) => {
      const r = $('#reticle');
      r.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });
    document.addEventListener('pointerdown', () => this.audio.ensure(), { once: false });
    document.addEventListener('keydown', () => this.audio.ensure(), { once: false });

    // menu keyboard (captures while a screen is active)
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.audio.ensure(); // keyboard gestures must also wake audio (capture below would swallow them)
      const k = e.code;
      if (k === 'ArrowUp' || k === 'KeyW') { this._move(-1); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 'KeyS') { this._move(1); e.preventDefault(); }
      else if (k === 'Enter' || k === 'Space') { this._confirm(); e.preventDefault(); }
      else if (k === 'ArrowLeft') this._cycle(-1);
      else if (k === 'ArrowRight') this._cycle(1);
      else if (k === 'Escape') this._back();
      else return;
      e.stopImmediatePropagation(); // menu owns the key — don't leak to game hotkeys
    }, true);

    // item hover + click share one selection state
    for (const name in this.screens) {
      const items = [...this.screens[name].querySelectorAll('.item')];
      items.forEach((el, i) => {
        el.addEventListener('mouseenter', () => {
          if (this.active !== name) return;
          if (this.sel !== i) { this.sel = i; this._paintSel(); this.audio.event('nav'); }
        });
        el.addEventListener('click', () => {
          if (this.active !== name) return;
          this.sel = i; this._paintSel();
          this._confirm();
          if (document.activeElement) document.activeElement.blur();
        });
      });
    }

    this.hintsT = 0;
    this._noticeEl = $('#notice');
    this.showScreen('main');
  }

  // ------------------------------------------------------------ screens --
  showScreen(name, push = true) {
    if (this.active === name) return;
    if (this.active && push) this.stack.push(this.active);
    for (const n in this.screens) this.screens[n].classList.remove('active');
    const el = this.screens[name];
    // force reflow so item stagger re-triggers every open
    void el.offsetWidth;
    el.classList.add('active');
    this.active = name;
    this.items = [...el.querySelectorAll('.item')];
    // stagger index for the entrance animation (re-set every open)
    el.querySelectorAll('.item, .row').forEach((n, i) => n.style.setProperty('--i', i));
    this.sel = 0;
    this._paintSel();
    this._syncVals();
  }

  hideAll() {
    for (const n in this.screens) this.screens[n].classList.remove('active');
    this.active = null;
    this.stack.length = 0;
  }

  _move(d) {
    if (!this.items.length) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this._paintSel();
    this.audio.event('nav');
  }
  _paintSel() {
    this.items.forEach((el, i) => el.classList.toggle('sel', i === this.sel));
  }

  _confirm() {
    const el = this.items[this.sel];
    if (!el) return;
    const act = el.dataset.act;
    if (el.dataset.val) { this._cycle(1); return; }
    this.audio.event('confirm');
    switch (act) {
      case 'start': this._startGame(); break;
      case 'controls': this.showScreen('controls'); break;
      case 'settings': this.showScreen('settings'); break;
      case 'back': this._back(); break;
      case 'resume': this.hideAll(); this._toPlayingChrome(); this.game.resumeGame(); break;
      case 'restart': this.hideAll(); this._toPlayingChrome(); this.game.startRun(true); break;
      case 'retry': this.hideAll(); this._toPlayingChrome(); this.game.startRun(true); break;
      case 'quit': this.game.quitToMenu(); break;
      case 'resetbest':
        this.best = 0; localStorage.setItem(STORAGE.best, '0');
        this.toastNotice('BEST CLEARED', true);
        break;
    }
  }

  _cycle(d) {
    const el = this.items[this.sel];
    if (!el || !el.dataset.val) return;
    this.audio.event('nav');
    if (el.dataset.val === 'quality') {
      const i = QUALITY_ORDER.indexOf(this.quality);
      this.quality = QUALITY_ORDER[(i + d + QUALITY_ORDER.length) % QUALITY_ORDER.length];
      localStorage.setItem(STORAGE.quality, this.quality);
      this._applyQuality(true);
    } else if (el.dataset.val === 'sound') {
      this.sound = !this.sound;
      localStorage.setItem(STORAGE.sound, this.sound ? 'ON' : 'OFF');
      this.audio.ensure();
      this.audio.setEnabled(this.sound);
    }
    this._syncVals();
  }

  _syncVals() {
    const q = $('.item[data-val="quality"] .vtext');
    if (q) q.textContent = this.quality;
    const s = $('.item[data-val="sound"] .vtext');
    if (s) s.textContent = this.sound ? 'ON' : 'OFF';
  }

  _applyQuality(live) {
    const p = QUALITY_PRESETS[this.quality];
    this.engine.applyQuality(p);
    if (this.life) this.life.applyQuality(p);
  }

  _back() {
    if (this.active === 'pause') { this._confirmAct('resume'); return; }
    const prev = this.stack.pop();
    this.audio.event('back');
    if (prev) this.showScreen(prev, false);
    else if (this.game.state === 'paused') this.showScreen('pause', false);
  }
  _confirmAct(act) {
    const idx = this.items.findIndex((e) => e.dataset.act === act);
    if (idx >= 0) { this.sel = idx; this._confirm(); }
  }

  _startGame() {
    this.hideAll();
    this._toPlayingChrome();
    this.audio.setMode('game');
    this.game.startRun(false);
    this.hintsT = 0;
    $('#hints').classList.remove('fade');
  }
  _toPlayingChrome() {
    document.body.classList.add('playing');
    $('#scrim').classList.add('hidden');
    this.audio.setMode('game');
  }

  // ------------------------------------------------------- game events ---
  onCountdownStart() {}
  onCountdownTick(n) {
    if (n > 0) this.notice(String(n), false);
  }
  onGo() { this.notice('GO', true); }

  onPause() {
    document.body.classList.remove('playing');
    $('#scrim').classList.remove('hidden');
    this.showScreen('pause');
    this.stack.length = 0;
    this.audio.setMode('menu');
  }

  onMenu() {
    document.body.classList.remove('playing');
    $('#scrim').classList.remove('hidden');
    this.hideAll();
    this.showScreen('main');
    this.audio.setMode('menu');
  }

  onCrash(reason) {
    const label = {
      tower: 'TOWER IMPACT', pylon: 'PYLON IMPACT', deck: 'DECK IMPACT',
      bridge: 'SKYBRIDGE IMPACT', billboard: 'BILLBOARD IMPACT',
      pursuer: 'INTERCEPTED', cordon: 'CORDON WALL',
    }[reason] || 'SIGNAL LOST';
    this.notice(`SIGNAL LOST<span class="sub2">${label}</span>`, false);
  }

  onResults(stats) {
    document.body.classList.remove('playing');
    $('#scrim').classList.remove('hidden');
    if (stats.score > this.best) {
      this.best = stats.score;
      localStorage.setItem(STORAGE.best, String(this.best));
    }
    $('#r-score').textContent = stats.score.toLocaleString('en-US');
    $('#r-dist').textContent = `${Math.floor(stats.dist).toLocaleString('en-US')} M`;
    $('#r-near').textContent = stats.nearMiss;
    $('#r-cord').textContent = stats.cordons;
    $('#r-top').textContent = `${Math.round(stats.topSpeed * 3.6)} KM/H`;
    $('#r-best').textContent = this.best.toLocaleString('en-US');
    this.showScreen('results');
    this.stack.length = 0;
    this.audio.setMode('menu');
  }

  onCordonBreak(count, ceiling) {
    this.notice(`CORDON ${String(count).padStart(2, '0')} BROKEN<span class="sub2">CLEARANCE CEILING ${ceiling}M — PURSUIT ESCALATING</span>`, true);
  }

  onToast(label, pts) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${label}<span class="pts">${pts}</span>`;
    const box = $('#toasts');
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => t.remove(), 1700);
  }

  notice(html, accent = false) {
    const el = document.createElement('div');
    el.className = 'pop' + (accent ? ' acc' : '');
    el.innerHTML = html;
    this._noticeEl.innerHTML = '';
    this._noticeEl.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 1400);
  }
  toastNotice(text, accent) { this.notice(text, accent); }

  // -------------------------------------------------------------- HUD ----
  onHUD(stats, player, cordons, ceiling, pursuerDist) {
    // clock
    const t = stats.time;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    const ds = Math.floor((t % 1) * 10);
    $('#clock').innerHTML = `${mm}:${ss}<span class="ms">.${ds}</span>`;
    // big stat
    $('#score').textContent = stats.score.toLocaleString('en-US');
    $('#speed').innerHTML = `${Math.round(player.speed * 3.6)}<span class="unit"> KM/H</span>`;
    // heat
    const heat = $('#heat');
    heat.querySelector('.fill').style.width = `${player.heat}%`;
    heat.classList.toggle('hot', player.overheated > 0);
    $('#heatlab').textContent = player.overheated > 0 ? 'OVERHEATED' : 'BOOST HEAT';
    // progress rail to next cordon
    const d = cordons.distanceTo(player.pos.z);
    const total = Math.max(380, 560 - cordons.count * 30);
    const k = cordons.state === 'armed' ? clamp(1 - d / total, 0, 1) : 1;
    $('#prail .fill').style.height = `${k * 100}%`;
    $('#prail .lab').textContent = `CORDON ${String(cordons.count + 1).padStart(2, '0')} — ${Math.max(0, Math.round(d))}M`;
    // closing alert
    $('#alert').classList.toggle('on', cordons.state === 'armed' && d < 150);
    // danger vignette: pursuer proximity or flying past the curb line
    const proxP = clamp(1 - pursuerDist / 16, 0, 1) * 0.9;
    const proxX = clamp((Math.abs(player.pos.x) - 25.6) / 6, 0, 1) * 0.75;
    $('#danger').style.opacity = Math.max(proxP, proxX);
    // hints fade
    this.hintsT += 1 / 60;
    if (this.hintsT > 8) $('#hints').classList.add('fade');
  }
}
