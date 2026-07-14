# CYBER SPACESHIP — neon-canyon chase + LAN dogfight

> Part of the [KIMI AROUND THE WORLD](../../README.md) monorepo — launched from the lunar lobby on port 9103 (`/arena.html`).

A browser-based real-time 3D cyberpunk megacity in heavy rain, shipped as **two
games on one shared engine and world**:

- **`index.html` — the solo chase.** You are a rogue cab (a quad-duct drone
  airframe with a Kimi orb in the pilot seat and one android fare on the rear
  deck, glued to their phone under an umbrella) running the length of the
  canyon after the transit grid revokes your clearance. Endless-runner: thread
  closing cordon walls, dodge towers and pursuer drones, score distance.
  Single-player, no network needed.
- **`arena.html` — the LAN dogfight ("Kimi Dogfight").** The same rain canyon,
  looped into a seamless 480 m arena: up to 8 pilots in player-colored ships
  shoot plasma bolts and grab items in a 3-minute HITS deathmatch. This is the
  mode the moon lobby hands off to (port **9103**, path `/arena.html`, lobby
  label "CYBER SPACESHIP").

The menu, loading screen, HUD and both `<title>` tags all read **CYBER
SPACESHIP** — that is the canonical name. Legacy aliases still in the code:
`GRIDLOCK` / `GRIDLOCK ARENA` (old README title, `package.json` name, the
server's `GAME_NAME` console banner, `localStorage` keys `gridlock.*`, code
comments).

## Run it

```sh
npm install          # first time — installs `ws` (only dependency)
node server.js       # one process: static files + WebSocket relay, 0.0.0.0
```

- `PORT=9103` (default) · `LAPS=3` (fleet-protocol compat; the dogfight is a
  3-minute timed match and ignores laps) · `GAME_NAME` (console banner only,
  default `GRIDLOCK ARENA`).
- Open `http://localhost:9103/` for the solo chase, `http://HOST-LAN-IP:9103/arena.html`
  for the dogfight. Desktop Chrome/Edge/Safari, WebGL2, ~60 fps at 1080p
  (quality presets in the solo game's SETTINGS; the arena pins BALANCED).
- **Static deploy of the solo game also works:** `python3 -m http.server` and
  open `index.html` — it touches no network. `arena.html` needs the Node
  server (its WebSocket relay).
- All responses are served with `Cache-Control: no-store` so LAN browsers
  never run stale modules.

## Controls (both games share the flight model)

| input | action |
| --- | --- |
| Mouse | Steer — offset from screen center banks the ship |
| W / S | Throttle up / down (27–54 m/s cruise band) |
| Shift | Boost to 74 m/s — builds heat; at 100% it locks out ~2.2 s |
| Space | Vertical burn — instant climb impulse (1.9 s cooldown) |
| Esc | Pause / back (solo only) |
| R | Instant restart (solo only) |
| Mouse click / hold, or J | Fire plasma bolts (arena only, autofire) |
| E | Use held item (arena only) |

Solo menus: `↑/↓` or `W/S` select, `Enter/Space` confirm, `←/→` cycle values,
`Esc` back; mouse hover selects, click confirms.

## The solo chase (`index.html`)

Cinematic attract flight through the canyon *is* the menu background — START
RUN hands you the controls after a 3 s countdown.

- **Cordons:** hex-field walls seal the canyon with one breach ring that
  shrinks as you approach (15 m → 4.6 m). Thread the ring to break the cordon
  (+1000); touch the field = crash. First cordon at 520 m, spacing tightens
  560 m → 380 m.
- **Escalation:** every broken cordon drops your clearance ceiling 10 m
  (84 m → 22 m floor, shown by a faint marker grid), thickens rain and fog,
  and scrambles +2 interceptor drones (2 start, 9 max) that station around you
  in a shrinking ring and match your speed — throttle is no escape.
- **Fatal:** towers, pylons, highway decks, skybridges, billboard frames,
  cordon walls, pursuer contact. Skimming the street is allowed (sparks +
  drag, not death). Flying through holograms is safe and scores (+100 each).
- **Score** = distance (1/m) + near misses (+150) + cordons (+1000) + ghosts
  (+100). Best score persists in `localStorage`. Results screen: distance,
  near misses, cordons, top speed, best.

## The dogfight (`arena.html`)

- **3-minute match, most HITS wins.** No HP: a bolt or offensive item hit puts
  your **systems offline for 2 s** — controls dead, ship sags and tumbles —
  with a 1.2 s no-rehit grace after recovery (the top bar is the stun-recovery
  meter, cyan when in control, draining red while offline).
- **The grid is the only killer:** clipping a tower/deck/pylon/bridge explodes
  you (2.6 s respawn, 2 s spawn invulnerability, death feed credits "THE
  GRID"). Street skim = sparks only.
- **Bolts:** 170 m/s, 0.22 s interval, 2.4 s TTL, fired along your velocity —
  where you fly is where you aim. Hits are **victim-authoritative**: the
  shooter broadcasts the shot, every client flies the bolt locally, the
  victim's own client adjudicates and broadcasts the consequence.
- **Items:** neon crates float in 4 rows × 3 spots around the loop (8 s
  respawn, hold one at a time, `E` to use):
  - **SHOCKWAVE** — 28 m AoE stun burst around you
  - **EMP** — auto-targets the current HITS leader among the other pilots
  - **SHIELD** — 8 s, eats the next incoming hit (bolt or item)
  - **DASH** — 2.5 s free surge past boost speed, no heat
- **Start flow:** everyone waits parked on a shared start line in a grid
  formation keyed by relay-assigned slot; `raceStart` triggers a shared 5 s
  "ENGAGE IN n" countdown. Mid-match joiners drop straight onto the line.
- **Arena:** the canyon repeats every 480 m (periodic chunk seeds) — a
  seamless loop all players share; ceiling fixed at 84 m, no cordons.
- **Results** board (HITS · DOWN) with a "← BACK TO THE LUNAR LOBBY" link when
  launched from the lobby.

## Solo dogfight vs AI (`arena.html?solo=1`)

Single-player handoff from the moon lobby:
`arena.html?solo=1&name=<NAME>&color=<hex>&npcs=<N1:hex,N2:hex,N3:hex>&back=<url>`
(`color`/npc hex without `#`; `npcs` is one URL-encoded query value, exactly 3
entries). With valid params the arena opens **no WebSocket** and skips the
relay lobby — you drop straight into the ENGAGE countdown against 3 AI pilots
(`js/arena/bots.js`) named/colored from `npcs`:

- Bots fly the same `stepShip` physics on computed inputs (throttle/boost,
  burn, fire at the 0.22 s interval), run the canyon loop, dodge grid geometry
  with lookahead, chase the nearest opponent with lead pursuit, and crash /
  stun / respawn through the same paths as the player. Their bolts are
  victim-adjudicated through the shared `Combat` pool, exactly like remote
  humans' shots; your SHOCKWAVE/EMP hit them via a local loopback of the item
  message. Bots skip item crates.
- A `NullNet` stub answers the `Net` interface locally so the state machine,
  HUD, scoreboard, results and `back` link run unchanged; invalid/missing
  `npcs` falls back to the normal multiplayer flow.
- Debug hooks: `window.__arena.solo` (bool), `window.__arena.bots()` →
  `[{name,color,x,y,z,speed,alive,stunned,hits,deaths}]`,
  `window.__arena.step(nowMs)` drives one frame manually for headless tests.

## Multiplayer & lobby handoff

`server.js` is one Node process: static file server + `ws` WebSocketServer on
the same port (default 9103, bound to `0.0.0.0`, max 8 players), speaking the
fleet-wide relay protocol:

- `join {name,color,auto}` → `welcome {id, serverNow, race, players[]}` +
  `roster` broadcast · `state` → 20 Hz fan-out `states` · `startRace` →
  `raceStart {startAt: now+5000}` · `item {…}` relayed verbatim with `from` ·
  `finish`/`finishes`/`raceEnd` (12 min deadline / abandoned-race reset).
- **Auto-start:** a `join` with `auto:1` (a moon-lobby arrival) arms a 4 s
  grace timer; when it fires, the match starts itself so everyone redirected
  from the lobby lands in the same race.
- **Lobby handoff:** the lunar lobby (port 9100) redirects to
  `http://<host>:9103/arena.html?auto=1&name=<NAME>&color=<hex>&back=<url>`.
  The arena reads `name` (≤12 chars shown; server keeps 10, uppercased),
  `color` (hex ship tint), `auto` (arms auto-start) and `back` (renders the
  "← BACK TO THE MOON" button and the results-screen link).
- **Netcode:** clients own their simulation; 20 Hz state snapshots carry the
  sender's clock time (median-of-4 ping sync); remotes interpolate with a
  140 ms delay, never across the loop seam; auto-reconnect on drop.

## Architecture

- `server.js` — static file server + fleet WebSocket race relay on one port.
- `index.html` — solo chase entry: rail menus, HUD, loading screen markup.
- `arena.html` — dogfight entry: self-contained HUD/CSS, imports `js/arena/main.js`.
- `js/main.js` — solo boot: scene/lights, asset-load progress, frame loop,
  planar reflection, FPS meter (`?debug` in URL), `window.__game` debug hook.
- `js/config.js` — all tuning constants: world chunks, player physics, cordon/
  pursuer/score rules, quality presets, `localStorage` keys.
- `js/engine.js` — WebGL2 renderer + custom HDR post chain (NaN-guarded bright
  pass, Karis mip bloom, ACES + teal grade, procedural lens rain, chromatic
  aberration, boost warp, vignette, grain, FXAA) + planar-reflection pass.
- `js/city.js` — procedural city: canvas neon-sign atlas (CJK + latin), custom
  shaders (window-grid towers, neon signs, holograms, wet reflective street,
  beacons, light shafts), seeded 160 m chunk ring (repeats every 3 chunks for
  the arena loop), obstacle queries, far skyline.
- `js/life.js` — traffic & atmosphere: 148 instanced cars (street/deck/
  crossing lanes), 52 air taxis, skinned pedestrian pool, GPU rain (≤7k
  camera-wrapped streaks), steam billboards, shared additive GlowPool.
- `js/sky.js` — storm-cloud sky dome lit from below + procedural PMREM
  environment for the PBR models.
- `js/game.js` — solo orchestration: attract/countdown/playing/paused/crashed/
  results states, chase & wreck cameras, collisions, scoring, world re-base.
- `js/player.js` — the cab: drone-cab + fare + Kimi-orb pilot rig, flight
  physics (throttle/boost heat/burn/ceiling), thruster & headlight visuals.
- `js/enemies.js` — pursuer swarm AI: shrinking ring formation, player-speed
  tracking, obstacle avoidance, police strobes.
- `js/cordons.js` — hex-field cordon wall shader + breach-ring placement and
  break/hit adjudication.
- `js/assets.js` — GLTF loading and normalization (`makeDrone`, `makeRobot`),
  clip bank, walking root-motion stripping.
- `js/ui.js` — solo menu screens, settings persistence, HUD, toasts/notices.
- `js/audio.js` — procedural WebAudio (menu blips, engine, boost, rain bed,
  sirens, crash), lazy AudioContext on first gesture.
- `js/utils.js` — seeded RNG, damp/lerp helpers, shared analytic height-fog
  GLSL + `onBeforeCompile` patcher, global per-frame uniforms.
- `js/arena/main.js` — dogfight: boot, match flow (hold/countdown/playing/
  over), input, stun/death/respawn, camera, HUD, `window.__arena` debug hook.
- `js/arena/net.js` — relay client (clock sync, reconnect, 20 Hz state send) +
  interpolating `RemoteShip` puppet.
- `js/arena/ship.js` — ship builder (player-tinted drone airframe + Kimi-orb
  pilot, nametag/beacon sprites) + shared flight physics `stepShip`.
- `js/arena/combat.js` — pooled plasma bolts, fire logic, victim-authoritative
  hit detection.
- `js/arena/items.js` — pickup crates, the four items and their relay messages.
- `css/ui.css` — solo front-end: left rail at 7 vw, diagonal scrim, letterbox
  bars, Geist Mono, one cyan accent.
- `vendor/three/` — Three.js **r170** (`three.module.js`) + addons GLTFLoader,
  BufferGeometryUtils, SkeletonUtils. ES modules via import map, no build step.
- `fonts/` — Geist Mono 200/300/400/500 (woff2).

## Assets — 100% original, built for this project

Every model is self-made, generated programmatically in Blender (no
third-party assets); the generator scripts ship in `tools/` for provenance:

- `tools/build_drones.py` → `drone-cab.glb` (player taxi / arena ship, rear
  fare deck), `drone-interceptor.glb` (pursuers, runtime-tinted red),
  `drone-patrol.glb` (ambient patrols) — hard-surface kitbashes with emissive
  accents and baked bob + rotor-spin animation.
- `tools/build_robot.py` → `android.glb`: 1.78 m robot mannequin, 17-bone
  armature, rigid nearest-bone skinning.
- `tools/build_clips.py` → `android-clips.glb`: hand-keyed NLA clip bank —
  `Standing_Phone_01_FemaleA` (the fare; exact name is load-bearing),
  `Standing_Idle_01`, `Walking_Chat_01`, `Walking_Phone_01`.

All five GLBs total ~1.4 MB — asset boot is effectively instant. Everything
else (city, highways, traffic, rain, steam, signage, UI) is procedural.

## Debug & testing

This subproject ships no `_dev/`/`shots/` harness — scripted headless-Chrome
verification runs from the fleet's playwright setup in the sibling
`blender-kimi/shots/` directory. The in-page debug surface:

- `window.__game` (solo) — the `Game` instance (state machine, stats, player,
  pursuers, cordons).
- `window.__arena` (dogfight) — `{ P, mode, net, remotes, combat, scoreboard,
  myShip, LOOP, dzLoop }`.
- `?debug` in the solo URL enables the FPS/resolution overlay.

Verified end-to-end with scripted sessions: full menu → countdown → play →
pause → crash → results → retry (solo) and lobby redirect → auto-start →
dogfight → results → back-to-lobby (arena), zero console errors, stable frame
rate at 1080p (CINEMA preset available for high-refresh displays).
