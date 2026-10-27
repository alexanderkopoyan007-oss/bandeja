# BANDEJA — working notes for Claude

A realistic, fluid 3D padel game for desktop browsers. Free to build, run and host. Full spec: the owner's brief (M0–M8 below); approved plan: `~/.claude/plans/toasty-swimming-bonbon.md`.

## Architecture rules (non-negotiable)
- **`src/sim/` is pure TypeScript**: no DOM, no three, no Node. `tsconfig.sim.json` has `lib: ES2022` and no types, and `tests/sim/purity.test.ts` fails on any forbidden import. Rendering, animation, audio and UI only *read* sim state.
- **Deterministic fixed step at 120 Hz.** Randomness only from the seeded RNG in `src/sim/core`. Never `Math.random`, `Date.now` or wall-clock time inside the sim. Trig/exp go through `smath` so they can be swapped for cross-browser-exact versions when online play arrives.
- **Replays = seed + input frames.** `MatchSim.step(input)`, `snapshot()`, `restore()`. Any new sim state must be included in snapshot/restore and the state hash.
- **Input is timestamped** (`event.timeStamp`, `Gamepad.timestamp`, both `performance.now()` time). The sim receives the exact time inside the tick; timing grades use it.
- **Render interpolation** between the previous and current sim state by the accumulator fraction.
- **No allocations in hot loops.** Sim maths writes into preallocated vectors/typed arrays; pools for transient objects. `npm run alloc` must report zero GCs in the sim run.

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
Measured with `npm run perf` (Chrome, 1080p, AI-vs-AI autoplay; Medium with CPU throttled 4× as the laptop proxy). The dev machine is an M1 Max, so GPU-side numbers for integrated graphics are a proxy only.

## Assets and licensing
- Only CC0 or clearly free licences (Poly Haven, ambientCG, MakeHuman/MPFB output, CC0 Freesound) or our own generated work. Every asset goes in `CREDITS.md` with source and licence.
- `assets-src/` holds raw downloads and is gitignored. **Raw Mixamo files are never committed** (Adobe allows use inside games, not redistribution of the raw files); only processed, packed game assets go in `public/assets/`.
- No real players' names or likenesses. No real-money anything.

## Working rules
- Solo work, no agents or workflows unless the owner asks (he watches token spend closely).
- End of every milestone: `npm test`, `npm run typecheck`, `npm run build`, `npm run alloc`, `npm run perf`, look at screenshots, fix regressions, commit, push, check the Pages deploy, then a short summary (works / doesn't / what I need from him).
- Commits use the GitHub noreply identity configured in this repo, never his personal email.

## Milestones
- [ ] **M0** Plan, scaffold, CLAUDE.md, tests, deploy to GitHub Pages
- [ ] **M1** Feel slice: grey-box court, full ball + wall physics, 1 player vs simple AI, timing-based hitting, serve, scoring
- [ ] **M2** Animation: humanoid, locomotion, core shots, contact time-warp, IK
- [ ] **M3** Doubles, partner/opponent AI, full rules, padel-specific shots
- [ ] **M4** Graphics: first arenas, lighting, post, quality presets, perf tuning
- [ ] **M5** Character creator, ridiculous mode, rackets, cosmetics, roster
- [ ] **M6** Career, tournament, academy, challenges, local multiplayer
- [ ] **M7** Broadcast cameras, replays, clip export, audio pass, menus
- [ ] **M8** Polish, accessibility, final optimisation, deploy
- [ ] Stretch: online rollback multiplayer, out-of-court play, more arenas
