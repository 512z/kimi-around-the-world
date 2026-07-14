# VENICE SPEED — Venice at Dawn

> Part of the [KIMI AROUND THE WORLD](../../README.md) monorepo — launched from the lunar lobby on port 9102.

A browser-based real-time 3D experience of Venice's canals at dawn with two
games built on top of it: a solo fare-ferrying run and a LAN-multiplayer
gondola regatta. Part of the **KIMI AROUND THE WORLD** fleet — the moon lobby
(blender-kimi) hands players off here as **"VENICE SPEED" on port 9102**.

> **Name aliases:** the in-game name is **VENICE SPEED** (page title, loading
> screen, menu title, lobby label). The codebase still answers to **GONDOLIER**:
> that's the `server.js` `GAME_NAME` default, the `package.json` name, the
> `localStorage` keys (`gondolier.quality`, `gondolier.sound`), and the prefix
> of most source comments. Same game.

## Run it

**Solo (any static server):** everything loads from this directory plus the
three.js CDN, so `python3 -m http.server` works — open the page and press
START RUN. No multiplayer without `server.js`.

**Multiplayer (LAN):** one Node process serves the site AND the WebSocket
race relay on the same port:

```sh
npm install        # first time (installs `ws`)
node server.js     # default PORT=9102, bound to 0.0.0.0
```

Env: `PORT` (default 9102), `LAPS` (default 3 — carried in `raceStart` for
protocol compatibility; the regatta itself is point-to-point), `GAME_NAME`
(default `GONDOLIER`, log line only). Responses are sent `Cache-Control:
no-store` so LAN clients never run stale modules.

Note: three.js (0.169.0) comes from a jsdelivr import map — clients need
internet access even on the LAN.

## Controls

- **Menu:** ↑↓/WS select · ←→ cycle values · Enter/Space confirm · Esc back
  (pointer hover/click also works; WebAudio blips on first gesture).
- **W** — pole forward (thrust). The pilot's stroke cycles with your poling.
- **A / D** — work the oar: steer left / right (stronger with way on).
- **S** — back-pole: reverse and brake.
- **Mouse** — sweep the oar: analog thrust + steering alternative
  (sweep left = power stroke, right = recovery).
- **Space** — shove off a nearby wall (within 3 m).
- **E** — use held item (multiplayer regatta only).
- **Esc** — pause.

## The two games

**Solo — the morning run (START RUN from the menu).** Pole a gondola through a
route that keeps tightening: the canal narrows from 12.5 m to 8.7 m, five
bridges descend along the way, docks shrink to a hull's width, wakes from a
passing NPC boat rebound off the walls, mist thickens under the bridges, and
the tide reverses mid-route (s=300). Ferry five fares between six moorings:
kiss each dock slow (<1 m/s), straight, and lateral-gentle for 0.7 s to let
the fare step aboard or off. Scrape plaster, clip a pier, or ram a boat above
0.95 m/s and the fare steps off — three lost fares ends the morning; deliver
all five for a PERFECT MORNING. Results rate the run (PERFECT MORNING / FAIR
WINDS / CHOPPY WATERS / UNFINISHED) and everything restarts without reloading.

**Multiplayer — the regatta (via the moon lobby).** A point-to-point race:
everyone poles from the first pier to ZATTERE ALBA (s=585), first across wins.
Fares and docking are off, crashes just bounce. Instead, there are water-prank
items: floating lantern crates sit in three lanes at nine points along the
canal (8 s respawn, weighted random roll); press **E** to use:

- **WAVE** — surge that shoves and spins every boat ahead of you within 40 m.
- **WHIRL** — drops a 35 s whirlpool trap behind you (spins + locks the oar).
- **ANCHOR** — targets the race leader: 90% slow + 2.2 s input lockout.
- **SPLASH** — blinding water-droplet overlay on everyone else's screen.
- **SHIELD** — 8 s bubble that blocks one incoming hit.
- **SWAP** — trade positions (and headings) with the boat ahead of you.

Items are victim-authoritative: the user broadcasts the prank, each victim
applies it locally, then broadcasts an `fx` so everyone sees the water rings
and camera shake where it landed. Crashes into other boats resolve locally
against NPC, moored, and remote gondolas alike.

## How multiplayer works

The lobby redirects everyone to
`http://<host>:9102/?auto=1&name=<NAME>&color=<hex>&back=<lobby url>`.
`src/main.js` reads those params, shows a ← BACK TO THE MOON link, connects
`ws(s)://location.host`, and joins with `auto: true`.

**Single-player regatta (lobby solo mode):** the lobby can instead redirect to
`http://<host>:9102/?solo=1&name=<NAME>&color=<hex>&npcs=<NPCS>&back=<lobby url>`,
where `NPCS` is exactly three comma-joined `NAME:hex` entries (hex without `#`),
e.g. `YIMI:f2c94c,RIMI:eb5757,GIMI:27ae60`. With `solo=1` and 3 valid NPCs the
game opens **no WebSocket** and skips every menu: it boots straight into the
regatta countdown with the player gondola plus 3 local AI gondolas
(`src/game/ai.js`) named/colored from the params. The bots drive the same boat
physics as the player — centerline lookahead steering, wall shove-offs, boat
separation — and the existing countdown/HUD/results overlay are reused as-is
(restart keeps the same NPC lineup). Item crates still work for the player;
WAVE/ANCHOR/SWAP hit the bots locally, whirlpools catch them too, and the bots
themselves don't hold items. Debug: `window.__app.solo` (bool) and
`window.__app.spBoats()` → `[{name, color, x, z, s, finished, finishTime}]`.

- `server.js` is a static file server + `ws` relay on one port, same protocol
  as the rest of the fleet: `join` → `welcome` + `roster`; clients send
  `state` at 20 Hz; server fans out one `states` packet per tick; `startRace`
  → `raceStart {startAt: now+5000}`; `finish {time}` → `finishes` broadcast;
  `item` messages relayed verbatim.
- **Auto-start:** the first `auto` joiner arms a 4 s grace timer — everyone
  redirected from the moon lands on the same grid, then the race arms itself.
  Max 8 players (`full` message beyond that); server-assigned spawn slots
  stagger the grid in two columns.
- **Clock sync:** the client takes 4 pings and uses the median offset;
  countdowns run off the server's `startAt`. Remote gondolas are interpolated
  puppets on a 140 ms delay buffer with snap-on-teleport (for SWAP).
- **Finish:** crossing s=585 sends `finish`; when everyone finishes (or the
  12-minute deadline hits) the server broadcasts `raceEnd` and a results
  overlay ranks the field with a link back to the moon.
- The client auto-reconnects and re-joins on socket drop. A solo player can
  also just open the page without `auto=1` — no connection is attempted.

## Techniques

- **three.js (WebGL2)** via CDN import map; no build step.
- **Water**: custom GLSL — mirrored-camera planar reflection into a half-float
  RT with oblique near-plane clipping (Lengyel), analytic multi-octave ripple
  normals, expanding wake rings injected by boats/shoves/items, jade depth
  color, fresnel, HDR sun specular for bloom.
- **Procedural city**: canvas-painted facade atlas (color + emissive +
  roughness) baked into per-building UVs; the whole city merges into a handful
  of draw calls (buildings, roofs, chimneys, bridges, quays, poles, laundry).
  Laundry cloth sways in a vertex-shader wind patch. No image or model assets
  are shipped — only vendored Geist Mono fonts.
- **Characters**: low-poly characters built from primitives
  (`src/scene/person.js`) with a tiny procedural rig (pole / idle / sit). In
  gameplay the pilot is the **Kimi orb** (`makeKimiPilot` in `src/net.js`),
  colored per player; remote boats get the same orb plus a canvas name sprite.
- **Atmosphere**: procedural dawn sky dome (gradient + sun disk + drifting
  cloud band) doubled as a PMREM environment map, exponential fog, billboarded
  mist points (denser under bridges), instanced vertex-flap pigeons with a
  perch→burst→wheel→land cycle.
- **Post**: HDR composer — UnrealBloom, vignette + film grain, ACES output.
- **Menu design**: live scene behind a diagonal scrim (no panels), one left
  rail at 7vw, letterbox bars (5.5vh, retract in game), Geist Mono, one accent
  (#72adf7, the unified KIMI blue across the fleet).

## Performance

Targets ~60 fps at 1080p. Quality tiers (HIGH/MEDIUM/LOW, persisted in
localStorage) scale pixel ratio, bloom strength, reflection resolution, and
mist density.

## Project layout

```
index.html              entry: import map (three@0.169.0), loading screen, UI root
server.js               static file server + WebSocket race relay (PORT/LAPS/GAME_NAME env)
src/main.js             boot: renderer, HDR post chain, quality tiers, main loop,
                        input, window.__app hooks, lobby handoff (?auto=1)
src/net.js              WebSocket client (clock sync, 20 Hz state, reconnect),
                        Kimi-orb pilot, interpolated RemoteGondola puppets
src/game/game.js        gondola physics (oar, tide, wakes, collisions), solo fare
                        run, multiplayer regatta state machine, chase camera, HUD events
src/game/items.js       regatta items: lantern-crate pickups, WAVE/WHIRL/ANCHOR/
                        SPLASH/SHIELD/SWAP, victim-authoritative net effects
src/scene/world.js      world assembly: lights, env, city, water, mist, birds,
                        moored + NPC gondolas, dock locals, per-frame update
src/scene/canal.js      canal centerline spline, walls, width profile, bridges,
                        docks, campo — shared by scene and gameplay
src/scene/city.js       procedural buildings/roofs/bridges/quays/campo/poles/laundry,
                        merged into a handful of draw calls
src/scene/water.js      GLSL water: planar reflection RT, ripple normals, wake rings
src/scene/sky.js        dawn sky dome shader + sun/fog constants
src/scene/gondola.js    parametric gondola: lofted hull, ferro, brass rails, oar + forcola
src/scene/person.js     low-poly primitive characters with a tiny procedural rig
src/scene/textures.js   all canvas-painted textures (facade atlas, roof, stone, wood…)
src/scene/mist.js       billboarded mist points, denser under bridges
src/scene/birds.js      instanced pigeon flock: perch → burst → wheel → land
src/scene/attract.js    seamless cinematic camera loop behind the menu
src/ui/menu.js          menu state machine (one left rail), HUD, results screens
src/ui/audio.js         tiny synthesized WebAudio blips (no assets)
src/ui/styles.css       design system: scrim, letterbox bars, rail, HUD
assets/fonts/           vendored Geist Mono (200/300/400/500 woff2)
```

## Debug hooks & testing

No `_dev/` or `shots/` scripts ship in this project; the fleet's Playwright
harnesses live in the lobby repo and drive the game through these globals:

- `window.__ready` — set after the first rendered frame (loading screen fades).
- `window.__errors` — array collecting every `error` / `unhandledrejection`.
- `window.__app` — `{ scene, camera, renderer, world, game, ui, mode, setMode,
  seek(sec), fps, startRun(), quitToMenu(), settings, applyQuality(q) }`.
  `seek` scrubs the attract camera; `fps` is a rolling 0.5 s estimate. In the
  lobby solo handoff it also exposes `solo` (bool) and `spBoats()` (the 3 AI
  gondolas' names/colors/positions).

Settings (quality, sound) persist in `localStorage` under `gondolier.*`.
