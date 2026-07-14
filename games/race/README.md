# MOON RACE — Lunar Night Grand Prix

> Part of the [KIMI AROUND THE WORLD](../../README.md) monorepo — launched from the lunar lobby on port 9101.

A browser-based real-time 3D racing game on the Moon: a banked grand-prix
circuit carved into the regolith of Mare Imbrium, raced at night under a
star-dense sky with a half-lit Earth on the horizon. Solo against seven AI
rivals, or LAN-multiplayer with up to eight humans via the built-in relay.
Everything — terrain, circuit, cars, sky, dust, audio — is generated
procedurally in code. No downloaded models, textures, or sounds.

> **Names.** The canonical in-game name is **MOON RACE** (menu title,
> `<title>`, and the lobby's label for this game). The codebase still carries
> the earlier codename **SELENE GP** in comments, the `window.SELENE` debug
> hook, the `selene-settings` localStorage key, and `package.json`. The relay
> logs itself as **KIMI RACE** (`GAME_NAME` env default). Part of the
> **KIMI AROUND THE WORLD** fleet: lobby on port 9100, this game on **9101**.

## Run it

```sh
npm install        # one dep: ws
node server.js     # or: npm start
```

Serves the game statically **and** hosts the WebSocket race relay on one
port, bound to `0.0.0.0` for LAN play. Defaults: `PORT=9101`, `LAPS=3`,
`GAME_NAME='KIMI RACE'` (log line only). All responses carry
`Cache-Control: no-store` — module edits land on a plain reload.

Solo play also works from any static file server (e.g. `python3 -m
http.server` or `python3 _dev/serve.py`), since runtime deps are vendored in
`vendor/` (Three.js r169 + postprocessing addons); only the Geist Mono font
loads from a CDN. Multiplayer requires `server.js`. Best in desktop Chromium
with hardware WebGL.

## Controls

- **W/S** or **↑/↓** — throttle / brake
- **A/D** or **←/→** — steer (analog-ramped: taps are small corrections)
- **SHIFT** — boost (drains a meter refilled by glowing chevron pads on the line)
- **SPACE** — handbrake (breaks the rear loose for drifts)
- **Q / E** — use power-up
- **R** — reset onto the track facing the right way
- **ESC** — pause (solo only; the shared multiplayer clock can't be paused)

Menus: arrows or W/S to select, ←/→ to cycle settings, Enter/Space to
confirm, mouse fully supported. Settings (quality HIGH/MEDIUM/LOW, sound)
persist in localStorage.

## The race

Three laps around the ~8.8 km Mare Imbrium Circuit against seven AI rivals
running the identical vehicle simulation — they brake, drift wide, bounce
over crests, overtake, and use power-ups. Grid start with a synchronized
3-2-1 countdown (you start at the back), 12 checkpoint-validated laps
(cutting the circuit triggers a MISSED CHECKPOINT notice and the lap doesn't
count), wrong-way detection, live standings, minimap, best-lap clock, and a
full results board — restartable without reloading.

The physics sell the Moon: gravity is 2.6 m/s², so tires alone have no grip
— the cars press themselves onto the road with speed-squared maglev
downforce that fades with height and releases only at genuine crests. The
maglev holds the car onto the steep bowl wall (58° bank) at 300+ km/h, and
the rim-crest ridge mid-lap rewards a boosted exit with real hangtime. Off
the carved road the raw regolith is bumpy, low-grip and slow; boulders and
the corridor guardrails are hard, speed-scrubbing collisions. Top speed
≈ 315 km/h.

**Power-ups (KartRider-style).** Eight rows of eight glowing item boxes
straddle the racing line (respawn 8 s). Drive through one to roll an item —
trailing cars roll better ones. **Q/E** fires it: **Banana** drops a peel
behind you (spins out whoever touches it), **Rocket** homes in on the next
car ahead along the track (spin-out + speed scrub + shockwave), **Shield**
is a 5.5 s bubble that absorbs one hit, **Turbo** is 2.4 s of free thrust.

## Multiplayer (LAN + moon-lobby handoff)

Open the game with `?auto=1&name=<NAME>&color=<hex>&back=<lobby url>` — this
is what the KIMI AROUND THE WORLD lobby redirects everyone to after its
shared countdown, but you can also hand-craft the URL. With `auto=1` the
client skips the menu, connects to the relay on the same host/port, and
joins with the given name/color. The `back` URL adds a "← BACK TO THE MOON"
link.

- Humans only: the AI grid stays home. Your own car is simulated locally and
  streamed at 20 Hz; everyone else appears as interpolated puppet cars
  (140 ms delay, clock synced via ping/pong — transforms carry the sender's
  timestamp so remote motion is smooth).
- Power-ups are replicated: uses are broadcast, every client simulates the
  peel/rocket locally, and the **victim's** own client adjudicates the real
  hit.
- Relay protocol (`server.js`): `join → welcome + roster`, 20 Hz `states`
  fan-out, `startRace → raceStart {startAt: now+5 s}`, `finish → finishes`,
  `item` relayed verbatim, `raceEnd` when everyone finishes or the 12-minute
  deadline hits. Max 8 players (`full` message beyond that). Auto joiners
  arm a 4 s grace window so everyone redirected from the lobby lands on the
  same grid, then the race starts itself; late joiners sync into a race
  already in progress.
- Note: the client always races **3 laps** (hardcoded in `src/game.js`); the
  `LAPS` env only sets the count the relay advertises.

## Single-player lobby handoff (NPC race)

Open the game with
`?solo=1&name=<NAME>&color=<hex>&npcs=<NAME:hex,NAME:hex,NAME:hex>&back=<lobby url>`
— this is what the lobby redirects to when a single player launches MOON RACE
with the 3 NPC Kimi balls that followed them around the plaza. With `solo=1`
and exactly three valid `npcs` entries the client opens **no WebSocket** and
skips the menu entirely: it boots straight into the grid countdown with a
4-car field — the player (name/color from the params, fallback `KIMI` /
`#2e7bf6`, starting at the back) plus the three NPCs as AI opponents running
the identical CarSim/AIController, with their names/colors on the name tags,
standings, minimap, and results. RACE AGAIN / RESTART RACE rerun the same
lineup; the `back` URL still renders the "← BACK TO THE MOON" link. Plain
launches (no `solo`/`npcs`) are completely unchanged.

## Repository layout

- `index.html` — entry point: canvas, `#ui` mount, import map, boots `src/main.js`
- `style.css` — menu + HUD design system (Geist Mono, one accent, letterbox)
- `server.js` — static file server + WebSocket race relay on one port (no-store)
- `play` — self-symlink so `/play/...` URLs resolve to the game root
- `src/main.js` — bootstrap: renderer, lighting, selective-bloom pipeline, input, main loop, lobby handoff
- `src/menu.js` — entire front-end: menu screens, HUD, minimap, countdown, results
- `src/game.js` — race state machine: attract → grid/countdown → race → results; solo + MP logic
- `src/car.js` — procedural open-wheel car meshes (Kimi orb at the wheel) + the shared lunar vehicle sim
- `src/ai.js` — AI driver: lookahead steering, corner-speed judgment, overtaking, recovery
- `src/items.js` — power-up field: item boxes, banana/rocket/shield/turbo, projectiles, FX, MP replication
- `src/net.js` — multiplayer client (clock sync, reconnect) + interpolated `RemoteCar` puppets
- `src/track.js` — circuit centerline (Catmull-Rom, banking), checkpoints, nearest-point queries, edge lighting
- `src/terrain.js` — Mare Imbrium heightfield (single source of truth: render, carve, physics), boulders
- `src/sky.js` — procedural night sky: shader skydome, sun, Earth, satellites
- `src/dust.js` — ballistic regolith particles (clean parabolas, no billowing — vacuum)
- `src/audio.js` — fully synthesized WebAudio: engine, boost, countdown, items, UI (no assets)
- `src/cameras.js` — chase cam + car-anchored cinematic attract camera
- `src/util.js` — math, seeded RNG, fbm/value noise
- `vendor/` — Three.js r169 + postprocessing addons (vendored for offline deploy)
- `node_modules/` — `ws` only (the relay's dependency)
- `_dev/` — dev harnesses only; not referenced by the shipped game

## Testing

`_dev/` holds 51 Puppeteer (headless Chrome) scripts plus `serve.py`
(no-cache static server, default port 8140) and `shots/` reference
screenshots. The pattern: serve the game, `page.goto`, then drive/observe it
through the debug hooks the page exposes — soak tests run for minutes on
autopilot (`?demo=1`) with auto-start (`?race=1`) and sample
telemetry; physics traces and A/B steering tests probe the sim directly.

Debug hooks on `window`:

- `window.SELENE` — `{ game, env, THREE, bloom, composer, renderer, applyQuality, state }`
- `window.__game` — the `Game` instance (same object as `SELENE.game`);
  `window.__game.grid()` returns the current grid roster
  (`[{ name, color, isPlayer, x, y, z, s, lap, finished }]`)
- `window.__fps` — rolling FPS, updated once per second
- `window.__errors` / `window.__bootError` — captured runtime/boot errors
