# The front-end (menu, HUD, screens)

Build the game's entire front-end — title menu, sub-screens (CONTROLS / SETTINGS / PAUSE / RESULTS), and in-game HUD — as one cinematic design system. Internalize it exactly. No cards, no modals, no flat color backgrounds — ever.

**Non-negotiables**
1. **The background is the game.** The scene's cinematic attract loop (cinematic camera, slow orbit, or demo replay) runs live behind the menu at full quality. A static screenshot is acceptable only as a loading placeholder.
2. **Legibility comes from a scrim, not a panel.** A diagonal gradient — dark at the left edge, transparent by ~65% width — plus a soft bottom gradient. Never a solid box, card, or `backdrop-filter` blur panel.
3. **One left rail.** Brand, menu, footer and every sub-screen live on a single vertical axis at `left: 7vw`. Sub-screens swap content on that rail; the rail itself never moves.
4. **Letterbox bars** (`5.5vh`, near-black) top and bottom while in menus; they retract (height → 0, `.8s cubic-bezier(.6,.05,.25,1)`) when gameplay starts. This one transition sells "cinematic → playing".

**Layout grammar** — overline at 16vh (accent, 10–11px, tracking ≥.5em, UPPER); title huge at weight 200 with exactly one accent-colored word at weight 400–500 (the `POWDER LINE` pattern — that asymmetry is the whole logo); menu items from ~50vh; footer hints at 91vh (`↑↓ SELECT   ENTER CONFIRM`, faint). Sub-screens reuse the identical grammar: small title block on top, content mid-rail, `BACK` at the bottom. Results screens use overline `RUN COMPLETE`, the headline number (time/score) as the title, then label–value stat rows, then menu items.

**Typography — Geist Mono** (`"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`), vendored or from a public CDN. Mono is already wide, so track it less than a sans and let weight contrast do the work. Title `clamp(40px, 6vw, 84px)` / 200 / .02–.08em; overline 10–11px / 500 / .5–.6em; menu item 13–14px / 500 / .28–.35em; footer hint 10px / 500 / .3em; HUD number 28–64px / 200–300 / .02em; stat label 11px / 500 / .4em. Everything UPPERCASE except HUD numerals.

**Color** — dark ink + near-white + exactly ONE accent, sampled from this scene's key light (sunlit snow → warm gold; neon night → cyan; forest → amber). Never introduce a second accent; express states with the accent plus opacity steps of white, nothing else.
```css
--snow:#eef5fc;                 /* primary text */
--dim:rgba(226,238,250,.62);    /* idle menu items */
--faint:rgba(226,238,250,.34);  /* hints, chevrons */
--acc:/* one accent from the scene lighting */;
--ink:#060b14;                  /* scrim / letterbox base */
```

**Menu items** — a 1px-tall accent tick grows width 0 → 30px on select (`.3s cubic-bezier(.22,.9,.3,1)`) and the label slides right ~46px total. Idle text `--dim`, selected pure white. Value items (`QUALITY  ‹ HIGH ›`) render the value in accent, chevrons visible only while selected. Keyboard and mouse share ONE selection state — hover sets the selected index; there is no separate hover style.

**Motion** — items enter from `opacity:0; translateX(-16px)` with 60–70ms stagger, `.55s cubic-bezier(.22,.9,.3,1)`, re-triggered every time a screen re-opens. Screen swaps crossfade `.5s`, with `visibility` gated so hidden screens don't catch pointers. Center notices (countdown, `GO`, wipeout) pop from `scale(1.35) blur(6px)` to rest and self-fade, restarted via reflow. Nothing bounces. Nothing loops. Fast in, gentle out.

**Input & sound** — `↑/↓` (+`W/S`) move, `Enter/Space` confirm, `←/→` cycle value items, `Esc` back/pause, handled only while a menu screen is active. Mouse hover selects, click confirms; blur the button after click so Space can't re-trigger it in-game. Tiny WebAudio blips, no audio files: nav tick ≈ 2.1kHz sine, 50ms, gain 0.035; confirm a quick two-tone rise. Create the AudioContext lazily on the first user gesture.

**HUD** keeps the same voice: primary clock top-center, the big stat (speed/score) bottom-right, a thin progress rail on the right edge, hints bottom-left that fade after ~8s. All numerals benefit from mono. Persist quality and sound settings in `localStorage`.

**Before you call it done, verify:**
- [ ] Engine attract loop renders behind the menu (not a screenshot)
- [ ] Diagonal scrim; zero cards/panels/blur boxes
- [ ] Single left rail at 7vw shared by all screens
- [ ] Letterbox in menus, retracting into gameplay
- [ ] Geist Mono everywhere; title weight 200 + one accent word
- [ ] One accent color, sampled from the scene lighting
- [ ] Tick-line selection, staggered entrance, value chevrons
- [ ] Keyboard/mouse parity + nav ticks
- [ ] Quality/sound settings persist (localStorage)
