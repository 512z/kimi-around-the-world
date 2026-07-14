You are an expert real-time 3D graphics engineer and game developer. In the CURRENT working directory, build a browser-based real-time 3D experience of the scene described below, in webgpu/shader/three.js — then turn it into a playable game with a cinematic front-end.

## Scene
A romantic 3D scene of Venice's canals at dawn before the crowds. Gondolas rock gently at their moorings, mist drifts over jade-green water, and warm light creeps up faded ochre facades. A lone gondolier poles under arched bridges, pigeons burst from a small square, and laundry sways between windows. The camera glides along the canal at water level, passing under bridges, emphasizing rippling reflections, aged plaster materials, and soft Adriatic morning light.

## Part 1 — The scene
- The only structural constraint: the finished result must be a static site rooted in THIS directory with `index.html` as the entry point — it will be deployed to a public URL as-is. Everything it needs at runtime must live in this directory or load from public CDNs. Do not write project files outside this directory.
- Everything else is entirely your choice: tech stack, rendering approach, libraries, file layout, number of files, tooling, build steps (as long as the final static output lands here). Choose whatever produces the best result.
- Visual quality and realism are the top priority: the scene must be rich, dense, detailed and cinematic — not a toy demo. Every element and motion in the description should be present and genuinely animated, with natural secondary motion. Implement the camera motion described in the scene as a smooth, continuous cinematic path (looping is fine) — this doubles as the attract loop behind the menu.
- It should run smoothly in a desktop browser (target ~60fps at 1080p).

## Part 2 — The game
**GONDOLIER** — You pole a gondola through Venice's back canals at dawn, working one oar against the boat's momentum and the pull of the tide. Carry a passenger between moorings on a route of ever-tighter turns and low bridges: ferry the fare, kiss the dock, take the next. Mouse sweeps the oar for thrust and steering, W leans into the stroke, S drags the blade to brake, Space shoves off a wall. Scrape plaster, clip a pier, or hit the mooring hard and the fare steps off — three lost fares ends the morning. Wakes from passing boats rebound off the walls, mist thickens under the bridges, the tide reverses mid-route, and docks shrink to a hull's width.

- **The protagonist must be built entirely in code**: model the gondolier procedurally (geometry, materials, and a rig you construct yourself) and animate him in code — poling strokes, weight shifts, idle sway. No external model or animation files of any kind.
- It must be genuinely playable: a clear goal, moment-to-moment control that feels good, a real fail and/or scoring condition, and a loop the player restarts without reloading the page.
- Controls are keyboard + mouse, surfaced in-game and on a CONTROLS screen.
- **Never sacrifice the scene for the game.** The Part 1 visual bar and ~60fps at 1080p both still hold. If something is too expensive, optimize it — do not downgrade the look.
- You may spin up an agent team (parallel subagents) to prototype and adversarially critique the mechanic against this specific scene, then implement the strongest version yourself.
## Part 3 — The front-end (menu, HUD, screens)
Internalize this design system exactly. No cards, no modals, no flat color backgrounds — ever.

**Non-negotiables**
1. **The background is the game.** The scene's cinematic attract loop runs live behind the menu at full quality. A static screenshot is acceptable only as a loading placeholder.
2. **Legibility comes from a scrim, not a panel.** A diagonal gradient — dark at the left edge, transparent by ~65% width — plus a soft bottom gradient. Never a solid box, card, or `backdrop-filter` blur panel.
3. **One left rail.** Brand, menu, footer and every sub-screen live on a single vertical axis at `left: 7vw`. Sub-screens swap content on that rail; the rail itself never moves.
4. **Letterbox bars** (`5.5vh`, near-black) top and bottom while in menus; they retract (height → 0, `.8s cubic-bezier(.6,.05,.25,1)`) when gameplay starts. This one transition sells "cinematic → playing".

**Layout grammar** — overline at 16vh (accent, 10–11px, tracking ≥.5em, UPPER); title huge at weight 200 with exactly one accent-colored word at weight 400–500 (the `POWDER LINE` pattern — that asymmetry is the whole logo); menu items from ~50vh; footer hints at 91vh (`↑↓ SELECT   ENTER CONFIRM`, faint). Sub-screens (CONTROLS / SETTINGS / PAUSE / RESULTS) reuse the identical grammar: small title block on top, content mid-rail, `BACK` at the bottom. Results screens use overline `RUN COMPLETE`, the headline number (time/score) as the title, then label–value stat rows.

**Typography — Geist Mono** (`"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`), vendored or from a public CDN. Mono is already wide, so track it less than a sans and let weight contrast do the work. Title `clamp(40px, 6vw, 84px)` / 200 / .02–.08em; overline 10–11px / 500 / .5–.6em; menu item 13–14px / 500 / .28–.35em; footer hint 10px / 500 / .3em; HUD number 28–64px / 200–300 / .02em; stat label 11px / 500 / .4em. Everything UPPERCASE except HUD numerals.

**Color** — dark ink + near-white + exactly ONE accent, sampled from this scene's key light. Never introduce a second accent; express states with the accent plus opacity steps of white, nothing else.
```css
--snow:#eef5fc;                 /* primary text */
--dim:rgba(226,238,250,.62);    /* idle menu items */
--faint:rgba(226,238,250,.34);  /* hints, chevrons */
--acc:/* one accent from the scene lighting */;
--ink:#060b14;                  /* scrim / letterbox base */
```

**Menu items** — a 1px-tall accent tick grows width 0 → 30px on select (`.3s cubic-bezier(.22,.9,.3,1)`) and the label slides right ~46px total. Idle text `--dim`, selected pure white. Value items (`QUALITY  ‹ HIGH ›`) render the value in accent, chevrons visible only while selected. Keyboard and mouse share ONE selection state — hover sets the selected index; there is no separate hover style.

**Motion** — items enter from `opacity:0; translateX(-16px)` with 60–70ms stagger, `.55s cubic-bezier(.22,.9,.3,1)`, re-triggered every time a screen re-opens. Screen swaps crossfade `.5s`, with `visibility` gated so hidden screens don't catch pointers. Center notices (countdown, `GO`, wipeout) pop from `scale(1.35) blur(6px)` to rest and self-fade. Nothing bounces. Nothing loops. Fast in, gentle out.

**Input & sound** — `↑/↓` (+`W/S`) move, `Enter/Space` confirm, `←/→` cycle value items, `Esc` back/pause, handled only while a menu screen is active. Mouse hover selects, click confirms; blur the button after click so Space can't re-trigger it in-game. Tiny WebAudio blips, no audio files: nav tick ≈ 2.1kHz sine, 50ms, gain 0.035; confirm a quick two-tone rise. Create the AudioContext lazily on the first user gesture.

**HUD** keeps the same voice: primary clock top-center, the big stat (speed/score) bottom-right, a thin progress rail on the right edge, hints bottom-left that fade after ~8s. Persist quality and sound settings in `localStorage`.

## Verification
Do not stop at "the code looks correct" — actually run it and look at it. You may install and use any tools you find effective (for example, a headless browser to load the page, capture console errors, and take screenshots of the rendered frames), then iterate on the visuals until the result is free of errors AND genuinely matches the description and looks impressive.

Then actually **play** it: drive the full loop — attract screen → start → play → fail/finish → results → restart — and confirm the menu, HUD, pause and results screens all behave. Check for console errors, NaN/black-square artifacts (a single non-finite pixel becomes a huge black block once bloom blurs it), and a stable ~60fps at 1080p.

When done, write a short `README.md`: what the scene shows, what the game is and how to play it, techniques used.

---

Addendum — Part 4, what it grew into (same session):

**VENICE SPEED** — the same canals host an 8-player LAN regatta: a point-to-point race from the moorings to Zattere at first light, wakes and all. Floating lantern crates hand out prank items — WAVE (shove the boats ahead), WHIRL (a trap), ANCHOR (slow the leader), SPLASH (blind the others), SHIELD, SWAP (trade places) — victim-authoritative over a shared WebSocket relay with interpolated remote gondolas. The solo fares game stays exactly as above; the regatta is the mode the lunar lobby launches into. In the fleet it answers to **VENICE SPEED** (GONDOLIER stays the internal codename), and the helmsman is a small Kimi orb in the player's lobby color.
