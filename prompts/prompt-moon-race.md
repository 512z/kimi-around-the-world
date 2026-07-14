build the best racing game you can in three.js and webgpu as the greatest 3d graphics engineer, the racing must happen on the moon, where there are stars/sun/earth/satellites around, it must be multiplayer playable under the same wifi, the tracks must be very interesting, the scenes must be cinematic and realistic, the control must be correct and smooth, the fps must remain at least 60, the cars must be looking super cool

---

Addendum (what it grew into, same session):

## Part 1 — The scene
- A lunar grand-prix circuit at night: a banked track carved into the regolith of Mare Imbrium, a dense star field with the Milky Way, the Sun low on the horizon, a half-lit Earth with city lights, and satellites drifting overhead. Guardrails glow along the track edges; dust kicks up ballistically in vacuum. Cinematic attract camera flying over an AI pack — this runs live behind the menu.
- Static site rooted in the current directory, `index.html` entry, everything vendored or from public CDNs, ~60fps at 1080p.

## Part 2 — The game
**MOON RACE** — 3 laps, 8 cars, lunar physics: low gravity, maglev downforce that releases over genuine crests (a rim-crest jump mid-lap), a 58°-banked crater bowl, guardrailed corridor. Checkpoint-validated laps, live standings, minimap, best lap, results board. Single player races 7 AI drivers on the identical physics (you start at the back); LAN multiplayer under the same wifi races humans only — state streamed at 20 Hz with interpolated remote cars.
- **KartRider-style power-ups**: rows of item boxes across the road — banana peel, homing rocket, shield, turbo. Trailing cars roll better items. The AI uses them too.
- Controls: W/S throttle/brake, A/D steer, Shift boost (refilled by chevron pads), Space handbrake, Q/E use item, R reset, Esc pause.

## Part 3 — The front-end
Same cinematic design system as the rest of the fleet: live attract loop behind the menu, diagonal scrim, one left rail at 7vw, letterbox bars that retract into gameplay, Geist Mono with a weight-200 title and one accent word, tick-line selection, staggered entrance, WebAudio blips, settings persisted.

## Verification
Drive it headlessly (playwright/puppeteer): soak-test full races with the autopilot (`?demo=1&race=1`), verify pickups, lap validation and standings, screenshot the frames, fix every console error. Then play it for real.
