# BANDEJA — working notes for Claude

A realistic, fluid 3D padel game for desktop browsers. Free to build, run and host. Full spec: the owner's brief (M0–M8 below); approved plan: `~/.claude/plans/toasty-swimming-bonbon.md`.

## Architecture rules (non-negotiable)
- **`src/sim/` is pure TypeScript**: no DOM, no three, no Node. `tsconfig.sim.json` has `lib: ES2022` and no types, and `tests/sim/purity.test.ts` fails on any forbidden import. Rendering, animation, audio and UI only *read* sim state.
- **Deterministic fixed step at 120 Hz.** Randomness only from the seeded RNG in `src/sim/core`. Never `Math.random`, `Date.now` or wall-clock time inside the sim. Trig/exp go through `smath` so they can be swapped for cross-browser-exact versions when online play arrives.
- **Replays = seed + input frames.** `MatchSim.step(input)`, `snapshot()`, `restore()`. Any new sim state must be included in snapshot/restore and the state hash.
- **Input is timestamped** (`event.timeStamp`, `Gamepad.timestamp`, both `performance.now()` time). The sim receives the exact time inside the tick; timing grades use it.
- **Render interpolation** between the previous and current sim state by the accumulator fraction.
- **No allocations in hot loops.** Sim maths writes into preallocated vectors/typed arrays; pools for transient objects. `npm run alloc` runs 100k AI-vs-AI ticks under `--trace-gc`; budget is ≤ 1 minor GC per 10k ticks (~83 s of play), each < 1 ms. Measured 2026-10-27: 10 per 100k, longest 0.17 ms, 1.7 µs per tick.
- **Timing/plan traps** (found the hard way):
  - Contact windows must be searched with the release look-back (`RELEASE_LOOKBACK`, 0.3 s). Searching from "now" makes the ideal of a window you are already in slide forward with the clock: the ring never closes and auto-timing never fires.
  - A re-prediction (after any bounce/wall) restarts the path at the impact: pass `wallsSoFar` and `startFlags` to `Prediction.compute`, or "off the glass" is forgotten and the impact sample looks hittable.
  - Re-planning every few ticks from wherever the player is makes the plan flip between options (player runs back and forth): plans keep their contact unless a clearly better one appears.
  - Anything that changes a shot after `solve()` (e.g. serve spin by key) makes it miss its target: put it in the `ShotRequest` (`spinScale`).
  - The assist must arrive (speed from braking distance), not overshoot: running past the spot puts the body in the ball's line.
- **V8 traps that cause per-tick garbage** (found the hard way):
  - A class field declared without a value (`x: number;`) is emitted as a real field that starts `undefined`; V8 then tags it and boxes every double written to it. Always initialise numeric fields (`x = 0`).
  - `const sqrt = Math.sqrt` aliases are opaque to V8: each call returns a boxed number. `smath` uses tiny wrapper functions instead.
  - Doubles passed into or returned from non-inlined functions get boxed. In hot paths pass results through fields (see `Ball.findContact`/`tryWall`, `Player.driveX/driveZ/clock` + `move()`). Measured 2026-10-27 after that fix: 166 B/tick, 5 GCs per 100k ticks.

## Conventions
- Units: metres, seconds, radians, kilograms. Axes: x across the court (left −), y up, z along it; net at z = 0; team 0 on z > 0 (near the broadcast camera).
- Imports inside the project use explicit `.ts` extensions (Node 24 runs sim code directly for tools). Erasable TypeScript only: no `enum`, no namespaces, no parameter properties; use `const` numbers for kinds.
- All tunable content is JSON in `data/` (courts, surfaces, later arenas, rackets, players). Code reads it; don't hard-code numbers that belong in data.
- Exact-pinned dependencies. three 0.186.1 (`three/webgpu`, TSL), vite 8, vitest 5, typescript 7.
- The Browser pane cannot capture a WebGPU canvas (it shows black). For visual checks use `node tools/shot.mjs <url> <png>` (real Chrome, WebGPU) or `?backend=webgl` in the pane.

## Court interpretation (FIP Rules of Padel, application 01.01.2026)
- 20 × 10 m inside; net 0.88 m centre / 0.92 m posts, posts ≤ 1.05 m; service lines 6.95 m from the net; centre line extends 20 cm past them; lines 5 cm.
- Back walls: 3 m wall + 1 m mesh. Side walls, variant 1 (standard): 3 m × 2 m then 2 m × 2 m glass steps; enclosure 4 m high over the 4 m stepped section, 3 m in the centre. Variant 2 (panoramic): 3 m × 4 m glass, mesh to 4 m over the extreme 2 m only. The PDF's "3 m in the center 6 meters" wording is ambiguous; this is our reading.
- Two openings per side flank the net post with a divider post (rule 13.b); 1.05–1.10 m wide, 2.0–2.2 m high.
- Narrow singles (20 × 6 m) is not an FIP court; it is our variant.
- Ball: 6.35–6.77 cm, 56.0–59.4 g; dropped from 2.54 m must bounce 135–145 cm (altitude ball above 1000 m: 122–135 cm). This is the bounce model's calibration test.
- Scoring options per the PDF: Advantage, Star Point, Golden Point (no default named; ours is Star Point). Serve and point rules: see `src/sim/rules` and their tests, which cite rule numbers.

## Performance budgets
| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Target FPS | 60 | 60 | 120 | 120+ |
| Draw calls | ≤150 | ≤300 | ≤500 | ≤800 |
| Triangles on screen | ≤300k | ≤1M | ≤2.5M | ≤5M |
| Texture memory | ≤256 MB | ≤512 MB | ≤1 GB | ≤2 GB |

Every preset: sim ≤ 1 ms per frame; zero GC during a rally; no shader compiles or asset loads mid-point (warm up on the loading screen); first playable < 10 s.
Measured with `npm run build && npm run perf` (Chrome with puppeteer, 1080p, AI-vs-AI autoplay; Medium with CPU throttled 4× as the laptop proxy). Headless Chrome paces vsync'd frames at 30 Hz whatever the load, so perf runs turn the frame limit off and judge 60/120 Hz from the p99 frame time. The dev machine is an M1 Max, so GPU-side numbers for integrated graphics are a proxy only.

## Tools
- **One headless Chrome at a time on this machine.** Run every Chrome-launching tool through `bash tools/one-chrome.sh <cmd>` (shares the lock/queue with the Meridian project's audit tools, which run in parallel sessions). Never `pkill` Chrome by pattern: other sessions' puppeteer Chromes look identical; stop only PIDs you started.
- `bash tools/one-chrome.sh node tools/shot.mjs <url> <png> [waitMs] [w] [h]`: real-Chrome screenshot (the Browser pane shows WebGPU canvases as black).
- `npm run alloc`: GC budget check for the sim. `npm run perf`: frame-time report (needs `npm run build`).
- `bash tools/one-chrome.sh node tools/bot-play.mjs [url] [secs]`: plays as the human with real keyboard events timed in the page, releasing on `focusIdeal` (the ring's moment); checks that grades use exact key timestamps (p50 error ≈ 8 ms while frames are 33 ms).
- URL options: `?autoplay=1 &seed= &court=standard|panoramic|singles-narrow &floor=turf|hard|carpet|clay &scoring=star|golden|advantage &ai=0..1 &assist=0..1 (default 0.45; 0 = keys always move, no aim target) &timing=1..2 (window scale, default 1.5; 1 = strict) &autotime=1 (a held swing fires itself, graded Good) &pro=1 &aim=mouse &alt= &temp= &windx= &windz= &backend=webgl &dpr=`.

## Assets and licensing
- Only CC0 or clearly free licences (Poly Haven, ambientCG, MakeHuman/MPFB output, CC0 Freesound) or our own generated work. Every asset goes in `CREDITS.md` with source and licence.
- `assets-src/` holds raw downloads and is gitignored. **Raw Mixamo files are never committed** (Adobe allows use inside games, not redistribution of the raw files); only processed, packed game assets go in `public/assets/`.
- No real players' names or likenesses. No real-money anything.

## Working rules
- Solo work, no agents or workflows unless the owner asks (he watches token spend closely).
- End of every milestone: `npm test`, `npm run typecheck`, `npm run build`, `npm run alloc`, `npm run perf`, look at screenshots, fix regressions, commit, push, check the Pages deploy, then a short summary (works / doesn't / what I need from him).
- Commits use the GitHub noreply identity configured in this repo, never his personal email.

## Milestones
- [x] **M0** Plan, scaffold, CLAUDE.md, tests, deploy to GitHub Pages (2026-10-27)
- [ ] **M1** Feel slice: grey-box court, full ball + wall physics, 1 player vs simple AI, timing-based hitting, serve, scoring
  - 2026-10-27: first playable deployed. Measured: medium-4x laptop proxy p99 6.9 ms (holds 120 Hz); 4K (2x ratio) averages 271 fps but shows queue stalls with the frame limit off (needs GPU timestamps, M4). Waiting on the owner's feel playtest before M2.
  - Owner's first playtest (2026-10-27): "no cage like real life", "timing quite hard", "minimalist (expected)". Fixed: real cage (posts, rails, anti-aliased wire mesh, doors, glass); timing windows ×1.5 by default, a ring around the ball that closes at the perfect moment (green = Good, cyan = Perfect), a floor spot for where to stand, positioning assist on whenever the ball is coming, optional `?autotime=1`. Looks are M4. Perf after the cage (wire mesh unlit; it cost half the 4K frame when lit): medium-4x p99 3.5 ms; 4K average 478 fps, p99 9.4 ms; 34 draw calls.
  - Second playtest (2026-10-27): "ring helps, make it better", "no way to aim", "can't hit the ball off the wall". Fixed:
    - Aim: while a shot key is held for an incoming ball (and while setting up a serve) WASD steers a yellow target on the far court (`Player.aimX/aimZ`, `MatchSim.steerAim`) and the player runs to the planned spot at full assist; released shots and serves go to that target. `?assist=0` keeps the keys on movement (old relative aim at release).
    - Wall play: one contact plan (`planStand`) drives the spot, the ring, the meter and auto-timing (`MatchSim.focusIdeal`). Deep balls are planned off the glass, spots in the ball's path are rejected, the plan is sticky (keep bonus; locked in the last 0.35 s), contacts within 50 ms of an impact are avoided.
    - Timing cue: approach ring meets a fixed target ring, both constant on-screen size; grade flash; HUD shows ms early/late and "Out of reach"; "Off the glass" hint.
    - Measured with a human-like bot (scratch lab, see tests/sim/assist.test.ts): balls off the glass returned 99% (was ~40%), AI-vs-AI unchanged.
  - Third playtest (2026-10-27): "better; needs an overhead button for lobs". Added O = overhead (`BTN_OVERHEAD`, held as `SHOT_BANDEJA`): the plan and the windows switch to overhead costs (`overheadCost`, ideal 2.35 m, reach 0.4 m, racket side), contact makes a bandeja or, with Space, a smash; a ball that has dropped below ~1.55 m is sliced instead. HUD hints "Lob · hold O", racket loads above the head. Assisted timing now releases just before the ideal (contact still at the ideal), not after. Bot test: 90%+ of lobs taken overhead at >= 2 m.
  - Not in M1 yet: receiver's choice of side on a deciding point is fixed to the right for humans; ball lodged in mesh / on top of a wall; out-of-court play (stretch); sound (M7).
- [ ] **M2** Animation: humanoid, locomotion, core shots, contact time-warp, IK
- [ ] **M3** Doubles, partner/opponent AI, full rules, padel-specific shots
- [ ] **M4** Graphics: first arenas, lighting, post, quality presets, perf tuning
- [ ] **M5** Character creator, ridiculous mode, rackets, cosmetics, roster
- [ ] **M6** Career, tournament, academy, challenges, local multiplayer
- [ ] **M7** Broadcast cameras, replays, clip export, audio pass, menus
- [ ] **M8** Polish, accessibility, final optimisation, deploy
- [ ] Stretch: online rollback multiplayer, out-of-court play, more arenas
