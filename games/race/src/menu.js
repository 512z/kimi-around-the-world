/* ============================================================
   SELENE GP — menu.js
   The entire front-end (menu + HUD). Owns every DOM node in #ui.
   main.js imports createMenu(hooks) and drives it through the
   returned object — that object is the only integration seam.
   ============================================================ */

const LS_KEY = "selene-settings";
const QUALITIES = ["HIGH", "MEDIUM", "LOW"];

/* ---------- tiny helpers ---------- */
function mk(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function fmtTime(s) {
  if (s == null || !isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cc = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

/**
 * createMenu(hooks)
 * hooks (all optional):
 *   onStartRace(), onResume(), onRestart(), onQuitToMenu()
 *   onSettingChanged({ quality, sound })
 *   getSettings() -> { quality, sound }   (used at creation; else localStorage)
 */
export function createMenu(hooks) {
  hooks = hooks || {};
  const fire = (name, ...a) => {
    if (typeof hooks[name] === "function") {
      try {
        hooks[name](...a);
      } catch (e) {
        /* a broken hook must never kill the UI */
        console.warn("[selene] hook", name, "threw:", e);
      }
    }
  };

  /* ---------- settings ---------- */
  function normalize(s) {
    s = s || {};
    return {
      quality: QUALITIES.includes(s.quality) ? s.quality : "HIGH",
      sound: typeof s.sound === "boolean" ? s.sound : true,
    };
  }
  function loadSettings() {
    if (typeof hooks.getSettings === "function") {
      const fromHook = normalize(hooks.getSettings());
      if (fromHook) return fromHook;
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    return { quality: "HIGH", sound: true };
  }
  const settings = loadSettings();
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
    } catch (e) {}
    fire("onSettingChanged", { quality: settings.quality, sound: settings.sound });
  }
  function cycleQuality(dir) {
    let i = QUALITIES.indexOf(settings.quality);
    i = (i + dir + QUALITIES.length) % QUALITIES.length;
    settings.quality = QUALITIES[i];
    persist();
    refreshValues();
  }
  function toggleSound() {
    settings.sound = !settings.sound;
    persist();
    refreshValues();
  }

  /* ---------- audio (lazy, synthesized, no assets) ---------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function blip(kind) {
    if (!settings.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    if (kind === "confirm") {
      // quick two-tone rise 900 -> 1400 Hz over ~80ms
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(900, t0);
      osc.frequency.exponentialRampToValueAtTime(1400, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.04, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.095);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    } else {
      // nav tick: 2.1kHz sine, 50ms, gain 0.035
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(2100, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    }
  }

  /* ---------- navigation actions ---------- */
  function resume() {
    fire("onResume");
    showScreen("none");
  }
  function quitToMenu() {
    fire("onQuitToMenu");
    showScreen("main");
  }
  function raceAgain() {
    if (typeof hooks.onRestart === "function") fire("onRestart");
    else fire("onStartRace");
  }

  /* ---------- screen configuration ---------- */
  // title is an array of {t, acc}; exactly one acc word = the logo asymmetry.
  const screens = {
    main: {
      overline: "LUNAR NIGHT GRAND PRIX",
      title: [{ t: "MOON" }, { t: "RACE", acc: true }],
      items: [
        { label: "START RACE", action: () => fire("onStartRace") },
        { label: "CONTROLS", action: () => openScreen("controls", "main") },
        { label: "SETTINGS", action: () => openScreen("settings", "main") },
      ],
    },
    controls: {
      overline: "PILOT BRIEFING",
      title: [{ t: "DRIVER" }, { t: "CONTROLS", acc: true }],
      rows: [
        ["THROTTLE / BRAKE", "W · S  /  ↑ ↓"],
        ["STEER", "A · D  /  ← →"],
        ["BOOST", "SHIFT"],
        ["HANDBRAKE", "SPACE"],
        ["USE POWER-UP", "Q / E"],
        ["RESET CAR", "R"],
        ["PAUSE", "ESC"],
      ],
      note: "POWER-UPS — SIX BOXES PER ROW ON THE RACING LINE · BANANA / ROCKET / SHIELD / TURBO",
      items: [{ label: "BACK", action: goBack }],
    },
    settings: {
      overline: "GARAGE",
      title: [{ t: "RACE" }, { t: "SETTINGS", acc: true }],
      items: [
        { label: "QUALITY", value: true, get: () => settings.quality, cycle: cycleQuality },
        { label: "SOUND", value: true, get: () => (settings.sound ? "ON" : "OFF"), cycle: toggleSound },
        { label: "BACK", action: goBack },
      ],
    },
    pause: {
      overline: "PIT STOP",
      title: [{ t: "RACE" }, { t: "PAUSED", acc: true }],
      items: [
        { label: "RESUME", action: resume },
        { label: "RESTART RACE", action: () => fire("onRestart") },
        { label: "CONTROLS", action: () => openScreen("controls", "pause") },
        { label: "SETTINGS", action: () => openScreen("settings", "pause") },
        { label: "QUIT TO MENU", action: quitToMenu },
      ],
    },
    results: {
      overline: "RUN COMPLETE",
      items: [
        { label: "RACE AGAIN", action: raceAgain },
        { label: "QUIT TO MENU", action: quitToMenu },
      ],
    },
  };

  /* ---------- build DOM ---------- */
  let ui = document.getElementById("ui");
  if (!ui) {
    ui = mk("div");
    ui.id = "ui";
    document.body.appendChild(ui);
  }

  // letterbox bars
  const lbTop = mk("div", "letterbox letterbox-top");
  const lbBottom = mk("div", "letterbox letterbox-bottom");
  ui.appendChild(lbTop);
  ui.appendChild(lbBottom);

  // menu layer
  const menuLayer = mk("div", "menu-layer");
  const rail = mk("div", "rail");
  menuLayer.appendChild(rail);
  const footer = mk("div", "footer");
  footer.textContent = "↑↓ SELECT   ENTER CONFIRM";
  menuLayer.appendChild(footer);
  ui.appendChild(menuLayer);

  const screenEls = {};
  const valueEls = {}; // per screen -> array of value span elements (parallel to items)
  const selIndex = {}; // per screen -> selected index

  function buildTitle(cfg) {
    const t = mk("div", "title");
    cfg.title.forEach((part, i) => {
      const s = mk("span", part.acc ? "acc" : null);
      s.textContent = (i > 0 ? " " : "") + part.t;
      t.appendChild(s);
    });
    return t;
  }

  function buildItems(name, cfg) {
    const wrap = mk("div", "items");
    valueEls[name] = [];
    cfg.items.forEach((it, i) => {
      const btn = mk("button", "item" + (it.value ? " item-value" : ""));
      btn.type = "button";
      const label = mk("span", "item-label");
      label.textContent = it.label;
      btn.appendChild(label);
      if (it.value) {
        const val = mk("span", "item-val");
        const lc = mk("span", "chev");
        lc.textContent = "‹";
        const vt = mk("span", "vt");
        vt.textContent = it.get();
        const rc = mk("span", "chev");
        rc.textContent = "›";
        val.appendChild(lc);
        val.appendChild(vt);
        val.appendChild(rc);
        btn.appendChild(val);
        valueEls[name][i] = vt;
        it._valEl = vt;
      }
      btn.addEventListener("mouseenter", () => {
        if (active !== name) return;
        if ((selIndex[name] || 0) !== i) blip("nav");
        setSelected(name, i);
      });
      btn.addEventListener("click", () => {
        if (active !== name) return;
        setSelected(name, i);
        confirmSelected();
        btn.blur(); // so Space can't re-trigger the click
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function buildScreen(name) {
    const cfg = screens[name];
    const sec = mk("section", "screen screen-" + name);
    sec.dataset.screen = name;

    const ov = mk("div", "overline");
    ov.textContent = cfg.overline;
    sec.appendChild(ov);

    if (name === "results") {
      const title = mk("div", "title");
      title.dataset.res = "time";
      title.textContent = "0:00.00";
      sec.appendChild(title);

      const body = mk("div", "results-body");
      const grid = mk("div", "stat-grid");
      const sPos = mk("div", "stat");
      sPos.innerHTML = '<span class="k">POSITION</span><span class="v" data-res="position">—</span>';
      const sBest = mk("div", "stat");
      sBest.innerHTML = '<span class="k">BEST LAP</span><span class="v" data-res="bestlap">—</span>';
      grid.appendChild(sPos);
      grid.appendChild(sBest);
      body.appendChild(grid);
      const laps = mk("div", "lap-times");
      laps.dataset.res = "laptimes";
      body.appendChild(laps);
      const standings = mk("div", "standings");
      standings.dataset.res = "standings";
      body.appendChild(standings);
      sec.appendChild(body);
    } else {
      sec.appendChild(buildTitle(cfg));
      if (cfg.rows) {
        const rows = mk("div", "rows");
        cfg.rows.forEach(([k, v]) => {
          const r = mk("div", "row");
          const kk = mk("span", "k");
          kk.textContent = k;
          const vv = mk("span", "v");
          vv.textContent = v;
          r.appendChild(kk);
          r.appendChild(vv);
          rows.appendChild(r);
        });
        sec.appendChild(rows);
        if (cfg.note) {
          const note = mk("div", "note");
          note.textContent = cfg.note;
          rows.appendChild(note);
        }
      }
    }

    sec.appendChild(buildItems(name, cfg));
    rail.appendChild(sec);
    screenEls[name] = sec;
    selIndex[name] = 0;
  }

  ["main", "controls", "settings", "pause", "results"].forEach(buildScreen);

  // HUD layer
  const hud = mk("div", "hud-layer");
  hud.innerHTML = `
    <div class="hud-top">
      <div class="pos" data-hud="pos">1/8</div>
      <div class="hud-clock" data-hud="clock">0:00.00</div>
      <div class="lap" data-hud="lap">LAP 1/3</div>
    </div>
    <div class="hud-standings" data-hud="standings"></div>
    <div class="hud-progress"><div class="hud-progress-fill" data-hud="progress"></div></div>
    <div class="hud-item hidden" data-hud="itemwrap">
      <canvas class="hud-item-glyph" data-hud="itemglyph"></canvas>
      <div class="hud-item-key">Q</div>
      <div class="hud-item-name" data-hud="itemname">—</div>
    </div>
    <div class="hud-speed">
      <div class="hud-speed-row">
        <div class="hud-speed-val" data-hud="speed">0</div>
        <div class="hud-speed-unit">KM/H</div>
      </div>
      <div class="hud-boost" data-hud="boostwrap"><div class="hud-boost-fill" data-hud="boost"></div></div>
    </div>
    <div class="hud-bottomleft">
      <canvas class="minimap" data-hud="minimap"></canvas>
      <div class="hud-hints" data-hud="hints">
        <span><b>SHIFT</b> BOOST</span><span><b>Q·E</b> ITEM</span><span><b>SPACE</b> HANDBRAKE</span><span><b>R</b> RESET</span>
      </div>
    </div>`;
  ui.appendChild(hud);

  const hudEls = {};
  hud.querySelectorAll("[data-hud]").forEach((e) => (hudEls[e.dataset.hud] = e));

  // minimap canvas sizing (crisp on hi-dpi)
  const mmCanvas = hudEls.minimap;
  const MM = 150;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mmCanvas.width = MM * dpr;
  mmCanvas.height = MM * dpr;
  const mmCtx = mmCanvas.getContext("2d");
  const trackCanvas = document.createElement("canvas");
  trackCanvas.width = MM * dpr;
  trackCanvas.height = MM * dpr;
  const trackCtx = trackCanvas.getContext("2d");
  let mmTransform = null;
  let mmTrackRef = null;

  // notice layer
  const noticeLayer = mk("div", "notice-layer");
  const cdEl = mk("div", "center-notice countdown");
  const alertEl = mk("div", "center-notice alert");
  noticeLayer.appendChild(cdEl);
  noticeLayer.appendChild(alertEl);
  ui.appendChild(noticeLayer);

  /* ---------- selection + confirm ---------- */
  function itemsOf(name) {
    return screens[name] ? screens[name].items : [];
  }
  function setSelected(name, idx) {
    selIndex[name] = idx;
    const items = screenEls[name].querySelectorAll(".item");
    items.forEach((b, i) => b.classList.toggle("selected", i === idx));
  }
  function confirmSelected() {
    const items = itemsOf(active);
    const it = items[selIndex[active] || 0];
    if (!it) return;
    blip("confirm");
    if (it.value) it.cycle(+1);
    else if (it.action) it.action();
  }
  function moveSelection(delta) {
    const items = itemsOf(active);
    if (!items.length) return;
    let idx = selIndex[active] || 0;
    idx = (idx + delta + items.length) % items.length;
    setSelected(active, idx);
    blip("nav");
  }
  function cycleSelected(dir) {
    const items = itemsOf(active);
    const it = items[selIndex[active] || 0];
    if (it && it.value) {
      it.cycle(dir);
      blip("nav");
    }
  }

  /* ---------- value display refresh ---------- */
  function refreshValues() {
    Object.keys(valueEls).forEach((name) => {
      const arr = valueEls[name];
      screens[name].items.forEach((it, i) => {
        if (it.value && arr[i]) arr[i].textContent = it.get();
      });
    });
  }

  /* ---------- screen switching ---------- */
  let active = "main";
  let navReturn = "main";
  let hintsTimer = null;

  function triggerStagger(sec) {
    const items = sec.querySelector(".items");
    if (!items) return;
    [...items.children].forEach((it, i) => (it.style.animationDelay = (i * 0.065).toFixed(3) + "s"));
    items.classList.remove("stagger");
    void items.offsetWidth; // reflow to restart the animation
    items.classList.add("stagger");
  }

  function goBack() {
    if (active === "controls" || active === "settings") openScreen(navReturn || "main");
    else if (active === "pause") resume();
  }

  function openScreen(name, returnTo) {
    if (returnTo) navReturn = returnTo;
    showScreen(name);
  }

  function showScreen(name) {
    if (name !== "none" && !screens[name]) name = "main";
    active = name;
    const playing = name === "none";
    ui.classList.toggle("playing", playing);

    if (playing) {
      Object.values(screenEls).forEach((s) => s.classList.remove("active"));
      hud.classList.remove("hidden");
      // fade the control hints ~8s after gameplay starts
      hudEls.hints.classList.remove("faded");
      clearTimeout(hintsTimer);
      hintsTimer = setTimeout(() => hudEls.hints.classList.add("faded"), 8000);
    } else {
      clearTimeout(hintsTimer);
      hudEls.hints.classList.remove("faded");
      Object.entries(screenEls).forEach(([key, el]) => {
        if (key === name) {
          el.classList.add("active");
          setSelected(name, 0);
          triggerStagger(el);
        } else {
          el.classList.remove("active");
        }
      });
    }
  }

  /* ---------- center notices ---------- */
  function pop(el) {
    el.style.transition = "none";
    el.classList.remove("show");
    void el.offsetWidth;
    el.style.transition = "";
    el.classList.add("show");
  }
  function showCountdown(text) {
    if (text === null || text === undefined) {
      cdEl.classList.remove("show");
      return;
    }
    cdEl.textContent = text;
    cdEl.classList.toggle("go", String(text).toUpperCase() === "GO");
    pop(cdEl);
  }
  let noticeTimer = null;
  function showNotice(text, ms) {
    alertEl.textContent = text;
    pop(alertEl);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => alertEl.classList.remove("show"), ms || 1400);
  }

  /* ---------- results ---------- */
  function setResults(data) {
    data = data || {};
    const sec = screenEls.results;
    sec.querySelector('[data-res="time"]').textContent = fmtTime(data.totalTime);
    sec.querySelector('[data-res="position"]').textContent =
      data.position != null ? `${data.position} / ${data.total}` : "—";
    sec.querySelector('[data-res="bestlap"]').textContent =
      data.bestLap != null ? fmtTime(data.bestLap) : "—";

    const lapsWrap = sec.querySelector('[data-res="laptimes"]');
    lapsWrap.innerHTML = "";
    (data.laps || []).forEach((lt, i) => {
      const c = mk("div", "lt");
      const k = mk("span", "k");
      k.textContent = "LAP " + (i + 1);
      const v = mk("span", "v");
      v.textContent = fmtTime(lt);
      c.appendChild(k);
      c.appendChild(v);
      lapsWrap.appendChild(c);
    });

    const stWrap = sec.querySelector('[data-res="standings"]');
    stWrap.innerHTML = "";
    (data.standings || []).forEach((s, i) => {
      const row = mk("div", "srow" + (s.isPlayer ? " player" : ""));
      const pos = mk("span", "pos");
      pos.textContent = String(i + 1);
      const name = mk("span", "name");
      name.textContent = s.name;
      const time = mk("span", "time");
      if (s.time != null) time.textContent = fmtTime(s.time);
      else if (s.gap != null) time.textContent = "+" + Number(s.gap).toFixed(2);
      else time.textContent = "—";
      row.appendChild(pos);
      row.appendChild(name);
      row.appendChild(time);
      stWrap.appendChild(row);
    });
  }

  /* ---------- power-up glyph ---------- */
  const glyphCanvas = hudEls.itemglyph;
  const GMM = 48;
  glyphCanvas.width = GMM * dpr;
  glyphCanvas.height = GMM * dpr;
  const gCtx = glyphCanvas.getContext("2d");
  let curItem = null;
  const ITEM_LABEL = { banana: "BANANA", rocket: "ROCKET", shield: "SHIELD", turbo: "TURBO" };
  function drawGlyph(type) {
    const c = gCtx, s = GMM * dpr, m = s / 96;
    c.clearRect(0, 0, s, s);
    c.save();
    c.scale(m, m);
    c.lineCap = "round"; c.lineJoin = "round";
    if (type === "banana") {
      c.strokeStyle = "#ffe14d"; c.lineWidth = 10;
      c.beginPath(); c.arc(48, 44, 26, Math.PI * 0.15, Math.PI * 1.15); c.stroke();
      c.fillStyle = "#ffe14d";
      c.beginPath(); c.arc(30, 68, 5, 0, Math.PI * 2); c.fill();
    } else if (type === "rocket") {
      c.fillStyle = "#ff5544";
      c.beginPath(); c.moveTo(58, 20); c.lineTo(44, 52); c.lineTo(64, 56); c.closePath(); c.fill();
      c.fillStyle = "#eef5fc";
      c.fillRect(40, 50, 12, 22);
      c.fillStyle = "#72adf7";
      c.beginPath(); c.moveTo(42, 74); c.lineTo(48, 88); c.lineTo(54, 74); c.closePath(); c.fill();
    } else if (type === "shield") {
      c.strokeStyle = "#66ccff"; c.lineWidth = 7;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const x = 48 + Math.cos(a) * 26, y = 48 + Math.sin(a) * 26;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath(); c.stroke();
    } else if (type === "turbo") {
      c.strokeStyle = "#8fffd0"; c.lineWidth = 9;
      for (let k = 0; k < 2; k++) {
        const x = 26 + k * 22;
        c.beginPath(); c.moveTo(x, 30); c.lineTo(x + 20, 48); c.lineTo(x, 66); c.stroke();
      }
    }
    c.restore();
  }
  let rollTimer = null;
  function setHudItem(type) {
    if (type === curItem) return;
    const wasEmpty = !curItem;
    curItem = type;
    const wrap = hudEls.itemwrap;
    if (rollTimer) { clearInterval(rollTimer); rollTimer = null; }
    if (!type) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden", "pop");
    void wrap.offsetWidth;
    if (wasEmpty) {
      // slot-machine roll: cycle glyphs fast, then settle on the real item
      const pool = Object.keys(ITEM_LABEL);
      let ticks = 0;
      hudEls.itemname.textContent = "· · ·";
      drawGlyph(pool[(Math.random() * pool.length) | 0]);
      rollTimer = setInterval(() => {
        ticks++;
        if (ticks >= 9 || curItem !== type) {
          clearInterval(rollTimer); rollTimer = null;
          if (curItem === type) {
            drawGlyph(type);
            hudEls.itemname.textContent = ITEM_LABEL[type] || "—";
            wrap.classList.remove("pop");
            void wrap.offsetWidth;
            wrap.classList.add("pop");
          }
          return;
        }
        drawGlyph(pool[ticks % pool.length]);
      }, 75);
    } else {
      drawGlyph(type);
      hudEls.itemname.textContent = ITEM_LABEL[type] || "—";
      wrap.classList.add("pop");
    }
  }

  /* ---------- HUD ---------- */
  function updateHud(s) {
    s = s || {};
    if (s.visible === false) hud.classList.add("hidden");
    else hud.classList.remove("hidden");

    if (s.speedKmh != null) hudEls.speed.textContent = String(Math.max(0, Math.round(s.speedKmh)));
    if (s.clock != null) hudEls.clock.textContent = fmtTime(s.clock);
    if (s.position != null && s.total != null) hudEls.pos.textContent = `${s.position}/${s.total}`;
    if (s.lap != null && s.lapsTotal != null) hudEls.lap.textContent = `LAP ${s.lap}/${s.lapsTotal}`;
    if (s.item !== undefined) setHudItem(s.item);
    if (s.standings) {
      hudEls.standings.style.display = s.standings.length ? '' : 'none';
      hudEls.standings.innerHTML = s.standings.map((r, i) =>
        `<div class="stand-row${r.me ? " me" : ""}"><span class="pos">${i + 1}</span><i style="background:${r.color}"></i><span>${r.name}</span><span class="lapinfo">${r.finished ? "🏁" : "L" + r.lap}</span></div>`,
      ).join("");
    }

    if (s.raceProgress != null) {
      const p = Math.max(0, Math.min(1, s.raceProgress));
      hudEls.progress.style.height = (p * 100).toFixed(1) + "%";
    }
    if (s.boost != null) {
      const b = Math.max(0, Math.min(1, s.boost));
      hudEls.boost.style.transform = `scaleX(${b.toFixed(3)})`;
      hudEls.boostwrap.classList.toggle("empty", b <= 0.001);
    }
  }

  /* ---------- minimap ---------- */
  function buildTransform(points) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    points.forEach((p) => {
      const x = p[0],
        z = p[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    });
    const pad = 16 * dpr;
    const w = MM * dpr,
      h = MM * dpr;
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanZ);
    const usedW = spanX * scale,
      usedH = spanZ * scale;
    const offX = (w - usedW) / 2;
    const offZ = (h - usedH) / 2;
    mmTransform = {
      px: (x) => offX + (x - minX) * scale,
      pz: (z) => h - (offZ + (z - minZ) * scale), // flip Z so "forward" reads as up
    };
  }

  function cacheTrack(track) {
    buildTransform(track);
    const c = trackCtx;
    c.clearRect(0, 0, trackCanvas.width, trackCanvas.height);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.strokeStyle = "rgba(226,238,250,0.34)";
    c.lineWidth = 2 * dpr;
    c.beginPath();
    track.forEach((p, i) => {
      const x = mmTransform.px(p[0]),
        y = mmTransform.pz(p[1]);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath(); // it's a circuit
    c.stroke();
    // start line
    const a = track[0],
      b = track[1] || track[0];
    const ax = mmTransform.px(a[0]),
      ay = mmTransform.pz(a[1]);
    const bx = mmTransform.px(b[0]),
      by = mmTransform.pz(b[1]);
    const ang = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
    const len = 7 * dpr;
    c.strokeStyle = "rgba(114, 173, 247,0.9)";
    c.lineWidth = 2 * dpr;
    c.beginPath();
    c.moveTo(ax + Math.cos(ang) * len, ay + Math.sin(ang) * len);
    c.lineTo(ax - Math.cos(ang) * len, ay - Math.sin(ang) * len);
    c.stroke();
  }

  function setMinimap(data) {
    if (!data) return;
    const track = data.track;
    const cars = data.cars || [];
    if (track && track.length && track !== mmTrackRef) {
      mmTrackRef = track;
      cacheTrack(track);
    } else if (!mmTransform && cars.length) {
      buildTransform(cars.map((c) => [c.x, c.z]));
    }
    const c = mmCtx;
    c.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    if (trackCanvas.width) c.drawImage(trackCanvas, 0, 0);
    if (!mmTransform) return;
    cars.forEach((car) => {
      const x = mmTransform.px(car.x),
        y = mmTransform.pz(car.z);
      if (car.isPlayer) {
        c.beginPath();
        c.strokeStyle = "rgba(114, 173, 247,0.55)";
        c.lineWidth = 1.5 * dpr;
        c.arc(x, y, 6 * dpr, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.fillStyle = "#72adf7";
        c.arc(x, y, 3 * dpr, 0, Math.PI * 2);
        c.fill();
      } else {
        c.beginPath();
        c.fillStyle = car.color || "#eef5fc";
        c.arc(x, y, 2.6 * dpr, 0, Math.PI * 2);
        c.fill();
      }
    });
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (active === "none") return; // gameplay input handled elsewhere (main.js owns it)
    const k = e.key;
    let handled = true;
    if (k === "ArrowUp" || k === "w" || k === "W") {
      moveSelection(-1);
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
      moveSelection(1);
    } else if (k === "ArrowLeft") {
      cycleSelected(-1);
    } else if (k === "ArrowRight") {
      cycleSelected(1);
    } else if (k === "Enter" || k === " " || k === "Spacebar") {
      confirmSelected();
    } else if (k === "Escape") {
      goBack();
    } else {
      handled = false;
    }
    if (handled) {
      // The menu owns input while a screen is active: consume the key so it
      // can't leak into the game (main.js has a global Escape/keys handler).
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // unlock audio on the very first gesture
  function firstGesture() {
    ensureAudio();
    window.removeEventListener("pointerdown", firstGesture);
    window.removeEventListener("keydown", firstGesture);
  }

  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", firstGesture);
  window.addEventListener("keydown", firstGesture);

  /* ---------- init ---------- */
  refreshValues();
  showScreen("main");

  /* ---------- public API ---------- */
  return {
    showScreen,
    showCountdown,
    showNotice,
    setResults,
    updateHud,
    setMinimap,
    currentScreen: () => active,
    blip,
    destroy() {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", firstGesture);
      window.removeEventListener("keydown", firstGesture);
      clearTimeout(hintsTimer);
      clearTimeout(noticeTimer);
      if (audioCtx) audioCtx.close();
      ui.innerHTML = "";
    },
  };
}
