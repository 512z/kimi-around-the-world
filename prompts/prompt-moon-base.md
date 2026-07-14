You are an expert real-time 3D graphics engineer and game developer. In the CURRENT working directory, build a browser-based real-time 3D experience of the scene described below, in webgpu/shader/three.js — then turn it into a playable multiplayer lobby with a cinematic front-end.

## Scene
A lunar research base on the edge of a wide crater, in airless high-contrast daylight. Vast procedural regolith terrain rolls out to a rim mountain range, the Sun hangs low and warm, and a huge luminous Earth with swirling clouds and a thin atmosphere dominates the black sky above the horizon, stars burning around it. The base itself is alive: white habitat modules linked by pressurized tunnels, two glass domes, a comms tower and a mast, a field of solar panels, a landing pad with a descended lander, rovers parked and crawling, drones on patrol, and two astronauts at work. Dust devils drift past the floodlights. The camera opens on a wide cinematic fly-in from the crater vista down to a hero shot of your own Kimi ball waiting in the plaza — this loop runs live behind the menu.

## Part 1 — The scene
- The only structural constraint: the finished result must be a static site rooted in THIS directory with `index.html` as the entry point — it will be deployed to a public URL as-is. Everything it needs at runtime must live in this directory or load from public CDNs. Do not write project files outside this directory.
- Everything else is entirely your choice: tech stack, rendering approach, libraries, file layout. Choose whatever produces the best result.
- Visual quality first: rich, dense, cinematic — every element above present and genuinely animated, with natural secondary motion. Target ~60fps at 1080p.

## Part 2 — The game
**KIMI AROUND THE WORLD** — a multiplayer lunar lobby. You ARE a Kimi ball: roll and float around the base in low gravity (WASD camera-relative movement, Shift sprint, Space hop), bounce off your friends (ball-vs-ball collision with restitution), and bump into nothing else — every module, tunnel, dome, tower, rover and astronaut has a proper collider. Pick your callsign and ball color on the menu; they persist.

- **The player character must be authored in Blender via the Blender MCP**: model the Kimi mascot yourself in Blender (the round body, the pill eyes, the velvet material), export it as a GLB into this directory, and load it as every player's ball. No downloaded models.
- **LAN multiplayer**: a small `server.js` serves the static files AND relays presence over WebSocket on the same port — up to 8 players on the same wifi share the moon, name tags overhead, 20 Hz state fan-out with interpolated remote balls. On any static host without the relay, silently fall back to solo exploration.
- **The lobby launches the fleet**: the first player in is the HOST and gets three buttons — MOON RACE, VENICE SPEED, CYBER SPACESHIP. Picking one arms a shared 5-second countdown on everyone's screen; at GO, every client is redirected together to that game's server (its port on the same host), carrying `?auto=1&name=<callsign>&color=<hex>&back=<lobby URL>` so the game knows who you are and can send you back. Host migrates if the host leaves.
- It must feel good moment-to-moment: a damped follow camera (drag to orbit, wheel to zoom), hover bob, tilt-into-velocity, the ball turning to face the camera when idle.

## Part 3 — The front-end (menu, HUD, screens)
Internalize this design system exactly. No cards, no modals, no flat color backgrounds — ever.

**Non-negotiables**
1. **The background is the game.** The lunar fly-in ends in a live hold on your preview ball behind the menu at full quality. A static screenshot is acceptable only as a loading placeholder.
2. **Legibility comes from a scrim, not a panel.** A diagonal gradient — dark at the left edge, transparent by ~65% width — plus a soft bottom gradient. Never a solid box, card, or `backdrop-filter` blur panel.
3. **One left rail.** Brand, menu, footer and every sub-screen live on a single vertical axis at `left: 7vw`. Sub-screens swap content on that rail; the rail itself never moves.
4. **Letterbox bars** (`5.5vh`, near-black) top and bottom while in menus; they retract (height → 0, `.8s cubic-bezier(.6,.05,.25,1)`) when gameplay starts.

**Layout grammar** — overline `MOONSHOT AI PRESENTS` at 16vh (accent, 10–11px, tracking ≥.5em); title `KIMI AROUND THE WORLD` huge at weight 200 with exactly one accent-colored word at weight 400–500; menu items from ~50vh (`ENTER THE MOON`, `CALLSIGN`, `KIMI COLOR`, `CONTROLS`); footer hints at 91vh. Sub-screens reuse the identical grammar.

**Typography — Geist Mono** (`"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`). Title `clamp(40px, 6vw, 84px)` / 200; menu item 13–14px / 500 / .28–.35em; footer hint 10px / 500 / .3em. Everything UPPERCASE.

**Color** — dark ink + near-white + exactly ONE accent: Kimi blue `#72adf7`, sampled from Earth's glow. Express states with the accent plus opacity steps of white, nothing else.

**Menu items** — 1px accent tick grows 0 → 30px on select, label slides right ~46px. Value items (`KIMI COLOR ‹ BLUE ›`) render the value in accent with chevrons while selected; color dots are clickable too. Keyboard and mouse share ONE selection state.

**Motion & sound** — staggered entrance, crossfade screen swaps, center countdown notices that pop and self-fade; tiny WebAudio blips (nav tick ≈ 2.1kHz, confirm two-tone). AudioContext lazily on first gesture.

## Verification
Do not stop at "the code looks correct" — run it headlessly (a real headless Chrome via playwright/puppeteer): capture console errors, screenshot the menu and the base, drive two browser contexts against the LAN server and verify both players see each other, collide, and redirect together when the host launches a game. Iterate until it matches the description and looks impressive. Then write a short `README.md`.

---

Addendum — Part 4, what it grew into (same session):

**Single-player mode.** ENTER THE MOON now fades the rail to exactly two options: SINGLE PLAYER and MULTI-PLAYER. Multiplayer is the LAN flow above. Single player never touches the network — instead three **NPC Kimi balls** keep you company (yellow, red, plus colors that never match your own), idling, wandering the plaza, hopping, and following you when you come close. When you launch a game solo, the same three NPCs follow you in as AI opponents — three race cars, three gondolas, three ships — via `?solo=1&name=…&color=…&npcs=NAME:hex,NAME:hex,NAME:hex&back=…` on the redirect URL.
