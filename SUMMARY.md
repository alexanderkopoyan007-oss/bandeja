# BANDEJA realism brief: summary

The owner's brief (27 Oct 2026): make the game as realistic and as good as possible, in nine phases, each verified
before the next. It also asked for a volley shot, a serve more like the pros' and a better-looking court, and
during the work: real net physics, play off the back glass, padel rackets and their grip, the ball's look and real
people. This page covers what each phase changed, the numbers before and after, and the bugs found and fixed. The
reasons and the evidence are in `DECISIONS.md`, phase by phase. What couldn't be verified here is in
`OPEN_QUESTIONS.md`.

- Machine for every number: this M1 Max, Chrome, 1080p, unless a line says otherwise. Other sessions' Chromes and
  system daemons often loaded the machine, so frame rates from Phase 8 on come from paired runs back to back, with
  the load average printed.
- "AI doubles" means four AI players at level 1, headless, measured the way pro match-analysis studies measure
  (`tools/match-stats.ts`, `tools/point-mix.ts`).
- Every phase ended with an independent verifier and a fresh-eyes reviewer (read-only agents), repeated until a
  fresh review found nothing new and serious.

## Before and after
The build at the start of the brief (b2985de) against this one, at the same seed and moment of an AI match. The
close-ups use a camera placed from the sim's own positions, so both builds get the same view
(`tools/before-after.mjs`).

The broadcast view:
![TV view](docs/summary/tv.jpg)
![TV view, later in a point](docs/summary/tv2.jpg)

A player: the Y Bot mannequin with a stick racket, against a MakeHuman player holding a padel racket in a
continental grip.
![A player](docs/summary/body.jpg)

The ball in flight: one flat yellow before, felt and seam with the shutter's stretch after.
![The ball](docs/summary/ball.jpg)

The net and the court:
![The net](docs/summary/net.jpg)

The four arenas now (stadium, covered club hall, outdoor club by day and under floodlights), none of which existed
before the brief:
![Arenas](docs/summary/arenas.jpg)

## Phase 1: ball physics validation
**What changed**
- A ball lab (`node tools/ball-lab.ts`, `?lab=ball`) fires 38 shots at the floor, the glass, the mesh, the corners
  and the joins. It measures every contact (restitution, spin, scatter, energy) and locks the tuned numbers into
  tests.
- The bounce is tuned to published data:
  - Restitution falls with impact speed at a tennis ball's measured rate (Dignall).
  - Turf bounces like a hard floor less the sand, and its friction (0.59) is inside IBV's padel-ball range.
  - Glass is rigid × 0.985 with friction 0.35 (ITF felt on glazed tile). Flush glass joins are no longer frames.
  - Wear follows IBV/Testfakta's 666-stroke test. Clay friction is Cross's 0.70.
- Junctions (a ball meeting the floor and the glass within one contact time) are solved as one squeeze, not as two
  instant bounces in an order a millimetre decided.

**Numbers**

| | Before | After |
|---|---|---|
| FIP drop test (2.54 m onto the hard floor) | 141 cm | 141 cm (135-145 allowed) |
| Lab court pace on turf (IBV: 36-50) | not measured | CPR 44.7 |
| Scatter off a back-glass seam | 20.9 ± 15.8° | 2.5 ± 1.9° |
| Topspin drive off the back glass, distance back | 11.4 m | 11.6 m |
| Corner fuzz (100k balls): tunnels through the glass, balls left inside a wall | 38, 31 | 0, 0 |
| Medium, CPU 4×: frame p50 / p99 | 2.4 / 4.5 ms | 2.4 / 4.3 ms |
| High, 2× pixel ratio | 498 fps | 539 fps (±8% between runs of one build) |

**Bugs found and fixed** (five review rounds)
- A ball landing at the foot of the glass went 4.1 m up or 1.1 m up depending on a 4 mm shift (junction order).
- The sand randomised bounce height by 26%; it now skews the line, not the height.
- A kiss of the glass halved the floor bounce.
- Corner balls tunnelled through the third wall.
- A topspin nick at the glass foot lost the point.
- Rolling balls went through walls.
- A ball pushed onto the rigid net's plane hung in the air.
- Two V8 traps made the ball step allocate: the wear update's `exp()` blew the inlining budget, and the `exp`
  wrapper boxed doubles. Both were fixed, bringing it back to 3-8 GCs per 100k ticks against a budget of 10.

## Phase 2: game feel
**What changed**
- **Input latency.** The render draws the present instead of one tick behind (run-ahead). While a swing is held, the
  sim is not run ahead, so no strike lands late.
- **The volley** gets its own key (N), as the owner asked. It plans the ball in the air with a reach band, met on the
  move.
- **Timing windows per shot**, from how fast each shot's face turns: a punch volley 1.35×, a lob 1.19×, a bandeja
  0.84×, a víbora 0.76×, a smash 0.71×.
- **A real split-step.** The hop is airborne about 142 ms, and force builds from 20% at a standstill. A target 1-2.5 m
  away is reached 11-16% sooner (measured: 104 ms, 13.1%).
- **Hit feedback.** Racket sounds by contact quality, a camera kick on smashes, and gamepad support with rumble.
- Every feel value is listed in `FEEL.md`.

**Numbers**

| | Before | After |
|---|---|---|
| Key → frame drawn, p50 / p95 (`tools/latency.mjs`) | 9.1 / 11.4 ms | 5.0 / 8.7 ms |
| Key → GPU done, p50 / p95 | 14.2 / 17.3 ms | 10.6 / 14.3 ms |
| Late strikes while a swing is held, 60-240 Hz emulation | 6-34% of releases | 0 |
| Doubles net player taking the ball in the air | 36% (drive key) | 80% (volley key) |
| Medium 4× frame p99 | 4.3 ms | 4.1 ms |

**Bugs found and fixed** (verifier, then four fresh-eyes rounds)
- Run-ahead struck the ball up to a tick late (11-30% of releases).
- The HUD's calls changed the sim, so the same seed played out differently with `?autotime=1`.
- A held swing was drawn unblended at 120 Hz and faster screens: frames repeated, then jumped.
- A modifier let go 0-6 ms after the shot key was lost, turning every smash into a bandeja.
- The AI held power or precision for the whole match after its first smash or víbora, so its styles made no
  difference.
- The timing ring counted down on the drawn clock (+20 ms at 60 Hz).
- After a hitch, queued keys were graded up to 220 ms early.

## Phase 3: animation realism
**What changed**
- **Measured first.** An animation QA (`tools/anim-check.ts`) draws every tick of a match and measures:
  - foot skating, soles under the floor and joint speeds against what people reach;
  - racket to ball at contact;
  - one-frame pops and clipping against capsules fitted to the mesh.
  It runs as a test (`tests/render/animQa.test.ts`).
- **Smoother motion.** The animation's inputs are inertialized (Bollo, Holden), never the IK's output.
- **Feet.** Planted feet stay where they were put down, and diagonal running uses orientation warping.
- **Limbs.** Arms are solved as hinges measured from the clips.
- **Legs.** Rate limits on the hips, knees, shins and lunges, each traced frame by frame.
- **Contact in front of the body, as pros play it.** Ground strokes are planned 0.6 m in front (it was 0.12 m),
  against highly trained players' 0.64 m (Sánchez-Alcaraz 2021).
- **Low balls are a lunge, not a squat.**
- **The serve, from pro studies** (the owner's ask):
  - The player stands side-on, and the ball is pushed down from 0.95 m so it bounces to the waist.
  - The backswing is turned 100° (research: 105°), with contact out to the side.
  - Contact height went from 0.57 m to 0.87 m.
- Motion matching was not built, because six looping Mixamo clips give it nothing to match (`OPEN_QUESTIONS.md`).

**Numbers** (3 seeds × 120 s, AI doubles)

| | Before | After |
|---|---|---|
| Foot skating | 54-68 cm/s | 16-18 cm/s |
| Soles under the floor | 7-9% of foot frames (8 cm) | 0 |
| One-frame pops | 118-145 per player-minute | 14.8-18.3 |
| Worst one-frame joint turn | 177° | 96° |
| Racket inside the body | 2.0-2.6% of frames | 0.15-0.19% |
| Racket to ball at contact, p50 / p90 | not measured | 4-8 mm / 7.8-8.3 cm |
| Serve contact height | 0.57 m | 0.87 m |

**Bugs found and fixed** (a verifier and three fresh reviews)
- Forearms flipped 150-180° in a frame: two-bone IK turned the wrong way.
- Racket blends re-picked the short way mid-blend.
- Left-handers' feet flipped.
- The same moment drawn twice snapped every body.
- Knees spun 150-165° over a tenth of a second, which the pop rule couldn't see. This is now its own QA measure.
- The hips lurched up to 29 cm in a frame, then fell 20-30 cm after a fix.
- Feet tapped.

## Phase 4: AI
**What changed**
- **Measured first.** `node tools/match-stats.ts` plays AI doubles headless and measures them the way match-analysis
  studies measure pro padel: shots and seconds a point, endings, the shot mix, per-stroke outcomes and the serve.
  Forced errors are judged by `src/sim/ai/pressure.ts`, which was written before any tuning and never changed by it.
- **Human limits:**
  - Reaction is 0.30 − 0.13 × level s, so 0.17 s at the top (pros commit at 140-160 ms; Triolet 2013, Mecheri 2019).
  - A correction delay after surprising bounces.
  - No smashing a ball still climbing past the shoulders off the glass.
  - No strokes at a ball behind the body, and no swings at the air.
- **Overheads at their own heights:** bandeja 1.95 m, víbora 1.72 m, smash 2.42 m. All of them used to be planned at
  2.35 m. The smash is hit in the air with a jump.
- **Doubles teamwork:**
  - Partners switch sides when one takes the other's lob (0 of 29 before, 68-74% after).
  - They cross back and call "Mine!", "Yours!" and "Switch!".
- **Difficulty** is fitted to the published ladder: novices about 5.6 shots a point, recreational players 7.3,
  national 8.0, pros 10-11.
- **Four personalities you can tell apart:**
  - Martillo drives 27% of its shots and smashes 71% of its overheads.
  - El Muro lobs 28%.
  - La Serpiente plays 68% of its overheads as víboras.

**Numbers** (AI doubles at the top level)

| | Before | Pros | After |
|---|---|---|---|
| Shots a point | 16.2-16.5 | 10-11 | 10.9 |
| Seconds a point | 21.6-22.0 | 13.5-14.8 | 14.9 |
| Winners / forced / unforced errors | 27 / 35 / 37% | 34-42 / 29-33 / 29-33% | 42.5 / 22.9 / 34.6% |
| Points ending on a swing at the air | 35% | 0 | 10.3% (balls that died below reach) |
| Level 0 shots a point, first-serve faults | 2.5, 55% | about 5.6 | 5.2, 14% |

**Bugs found and fixed**
- AI modifiers stayed held all match (from Phase 2).
- Partners switched lanes off a stale plan (94 episodes in 4 × 300 s, now 10).
- Blocks were "corrected" for nothing (27 of 153 corrections).
- A beaten AI swung at the air: stand-downs swung 90-100% of the way; now 17 of 19 make no forward swing.
- Good volleys 70 ms late were cut.
- The switch call didn't follow the formation's own rule, and cross-backs twitched (7 of 13).

## Phase 5: visual realism (photo-match)
**What changed**
- **Photo-match mode** (`?photo=<id>`). Eleven public reference photos of real courts are used:
  - The camera is solved from hand-marked court points (2.4 px RMS on arena-wide-2).
  - The game renders through that camera with the photo over it as a wipe, a blend or lines.
- **Four arenas** (stadium, covered club hall, outdoor club by day and by night). Colours were picked off the
  photos, and the boards are generic, with no real event's branding.
- **Turf.** Sand-filled fibres at two scales, wear where players stand, roll seams 4 m apart, and lines painted in
  the shader.
- **Glass.** Fresnel reflection of a box-projected environment, a faint iron green, ball prints and dust at the
  foot.
- **Players dressed.** Kit regions in the shader, sweat that grows with the match, folds, and hems that lag the
  body.
- **Ball.** Optic-yellow felt with sheen and fuzz, and the seam turned by the sim's spin.
- **Broadcast camera at the TV position** (7.6 m up, 15.5 m back, a 26° lens; Javadiha 2021). Before, it was 6.3 m up,
  9.2 m back with a 42° lens.
- **Look.** Khronos PBR Neutral tone mapping and HDR bloom.
- **Optional TV graphics** behind `?gfx=tv`: a score bug, point straps, radar speeds and match stats.

**Numbers**

| | Before | After |
|---|---|---|
| Draw calls, triangles | 43, 473k | 78, 848k |
| Medium 4× frame p50 / p99 | 2.5 / 4.3 ms | 5.5 / 8.4 ms (178 fps, 0 frames over 20 ms) |
| High 2× p99, frames over 20 ms | 8.8 ms, 0.66% | 22.7 ms, 1.95% (Phase 8 work) |
| Night turf colour against the night photo (sRGB) | not matched | 180-191 / 207-234 / 135-139 against 169-195 / 187-217 / 117-128 |

**Bugs found and fixed**
- The 26° lens made the approved timing rings 1.7× bigger on screen; they're now scaled by the lens.
- Lobs left the top of the frame (38 of 154 rallies). The camera now tilts with the ball.
- The crowd cost 891k triangles. It was cut to 302k drawn, then replaced in Phase 9.
- `bumpMap()` did nothing on procedural heights, so the folds and fuzz were invisible. Bump is now differentiated
  in screen space.
- The kit's regions blended through other regions' colours: dark sock rings and black seams.
- A double fault never got its TV strap.

## Phase 6: sound
**What changed**
- No recordings were available, so every sound is synthesised from physical models and measured in tests:
  - **Racket:** a perforated paddle "pock" at 450-1500 Hz (Piana 2025), and a frame clack above 2 kHz.
  - **Bounce:** on hard, 1 kHz then a decaying 250 Hz.
  - **Glass:** a panel's plate modes from 10.7 Hz up.
  - **Mesh and posts:** mesh wire modes and rattle, posts ringing as free bars.
  - **Net:** a catch "fwump".
  - **Shoes:** crunch on turf, squeak on hard.
  - **Swish:** rises with racket speed.
  - **Grunts:** formant voices (Klatt).
  - **Crowd:** applause from ClaPD clappers and gasps, groans and cheers.
  - **Rooms:** an impulse response per arena (stadium RT60 2.4 / 2.0 / 1.3 s).
  - **Ambience:** birds, crickets, floodlight hum and next-door courts.
- Sounds play at the event's exact time, from the broadcast camera.
- The crowd follows the match: hushed for the serve, a murmur of tension, applause by the point.

**Numbers**: medium 4× with sound on against off: 141 against 178 fps (about 0.35-0.4 ms a frame unthrottled), and
still 0 frames over 20 ms.

**Bugs found and fixed**
- **Critical:** sound froze for good in Firefox, because `AudioListener.positionX` doesn't exist there.
- **High:**
  - A club's eight watchers clapped as loud as a stadium.
  - The master compressor coloured every mix.
  - The racket's sound came from the timing grade instead of the impact, so a Perfect frame shot sounded clean.
  - Scuffs depended on the frame rate.
- **Medium:** levels stepped between bins, every floor was equally loud, the crowd carried its state between points,
  and two-render sounds alternated A/B/A/B.

## Phase 7: rules and QA
**What changed**
- **Oracles.** A referee and a scorer written from the FIP text alone, without reading the game's rules code, judge
  every call. Where the text is ambiguous, `tools/qa/ORACLE-NOTES.md` holds 44 readings. When the game and an oracle
  disagree, the FIP text decides.
- **The QA army** (`tools/qa/army.ts`):
  - It draws thousands of matches across every mode, court, floor, ball, climate, scoring format, level, style and
    handedness.
  - Three kinds of player take part: the AI, "bots" (the human code path played well) and "monkeys" (random keys).
  - Every tick is checked: walls, the floor, the net, tunnelling, speed, spin, energy, stuck balls, players, NaN,
    slow ticks and the heap.
- **An animation army and a 20-minute browser soak.**

**Numbers**

| Run | Result |
|---|---|
| First army run (200 matches) | 86 corner calls and 6 net-touch disagreements |
| `p7-r1` (2,000 matches, 549 h of play) | 39 matches with a problem |
| `p7-r3` (2,000 new matches) | 5, of which 4 were the checker's own mistakes |
| Animation army, 60 configurations × 90 s | pops 21.9 → 14.7 a player-minute, fastest one-frame turn 77° → 46° |
| Browser soak, 20 min | 1 frame over 20 ms of 71,975; heap 14.7 → 15.5 MB; no errors |

**Bugs found and fixed** (21, each with a regression test that fails on the old code; `docs/qa/REPORT.md`)
- **Rules:**
  - A ball in the corner where the glass meets the floor lost the point (FIP 14.1.i says it's good).
  - A missed swing at the serve wasn't a fault.
  - A dropped ball nobody swung at was a fault.
  - A net serve that then touched a player wasn't a let.
  - The server's partner could play the dropped ball.
  - A partner could push the server over the line.
  - One-set matches applied the final-set rule.
  - An AI server stalled after a re-toss.
- **Physics:**
  - A smash in the top of the net climbed out onto the far side.
  - A drive went through a net billowed by wind.
  - A ball at the fence step's corner went 3 cm into the wall.
- **Animation:** eight flips and snaps of the arms, legs and spine (66-148° in a frame).

## Phase 8: performance and polish
**What changed**
- **An app around the game.** It has a title screen over an attract match, Play, Quick match, Settings, Controls,
  Credits, a pause screen and a results screen with the match's stats. Menus work by keyboard, mouse and pad. The
  loading screen names its stages and says in words what failed, with a retry. Between points the picture dips
  instead of showing players jump.
- **Quality presets** Low / Medium / High / Ultra, plus Auto (the default). Auto is High with a dynamic render scale
  judged against the display's own period, and only pixels change, so no shader compiles mid-point.
- **Accessibility:**
  - A colour-blind safe palette: every pair of grades stays at ΔE ≥ 25 under simulated protanopia, deuteranopia and
    tritanopia.
  - WCAG contrast on every panel, plus a High contrast setting.
  - Reduced motion and text size 100/125/150%.
  - Screen-reader announcements of the score and labelled menus.
  - Full key remapping, forgiving/standard/strict windows, auto timing, and one-tap swings.
- **Pausing.** The game pauses on focus loss, a hidden tab or an unplugged pad, and a held swing is let go at the
  resume moment.
- **Load.** Shaders compile on the loading screen. A `scheduler.yield` fallback halves the load where it's missing
  (Safari, Firefox).

**Numbers**

| | Before | After |
|---|---|---|
| Medium 4×, paired with Phase 7: p50 / p99 / 1% low | 6.2 / 11.6 ms / 75.9 fps | 5.5 / 8.8 ms / 86.9 fps |
| High 2× paced at 120 Hz | not measured | 120.5 fps, no 120 Hz refresh missed |
| Integrated-GPU stand-in, Medium unpaced | not measured | p99 9.3 ms, 0 frames over 20 ms, holds 60 Hz |
| Load, broadband, CPU 4×: title playable + Quick match → first frame | | 5.49 + 3.46 = 8.95 s (budget 10 s) |
| Load, slow 4G | | 6.46 + 3.48 = 9.94 s |
| Load without `scheduler.yield` (as Safari) | 19.20 s | 9.12 s |
| Heap per match → title cycle | 0.81 MB + 3.3 MB buffers + 2 DOM nodes | 0.31 MB (three's bind-group cache), DOM flat |

Unpaced High at 2× is no better than Phase 7: its 1% low was 33.6 against 40.5 fps in the paired run. In every
unpaced High run the main thread is blocked on a full GPU queue, which a display's pacing never lets fill.

**Bugs found and fixed**
- **The pad menu loop survived `hide()`.** During play, pressing A restarted the match and the stick moved hidden
  focus.
- **A leak of 0.81 MB per match.** New shadow lights each match filled three's bind-group cache. The lights are
  pooled now.
- **The Auto scale sank to 0.6 for good.** On a 50 Hz screen or a 30 Hz cap, every frame counted as slow.
- **A swing held through a pause stayed charged.** It then went off by itself late.
- **Sim fields deoptimised mid-match.** They were changing from small integers to doubles. 73 deopts went to 48,
  and the rest are first visits of rare branches.
- **Three panels failed WCAG contrast.** The menu's shade let text drop to 2.6:1 below 1857 px.

## Phase 9: expert review, and the owner's playtest requests
### The owner's requests (28 Oct)
- **Contrapared** ("I can't hit a shot off of it"):
  - A ball that got behind you near your own back glass can now be turned on and played up into that glass, so it
    comes back over the net.
  - It has its own solver, plan, stroke and HUD hint.
  - The human path never took the plan, because the turn was charged again on every re-plan. Now the QA bot plays
    23 of 33 contrapared plans (it was 4 of 21), and 21 come back.
- **Rackets and grip:**
  - The racket is built to FIP limits: a round 26 × 28 cm head, 38 mm thick, 52 holes, the open throat, overgrip,
    butt cap and wrist cord. Before, it was a cylinder on a stick.
  - The grip is a continental grip solved from each hand's own mesh. Before, 84 skin vertices sat inside the handle,
    up to 4.5 mm deep; now 9 do, at most 2.1 mm. Hand-in-torso dropped from 0.7-2.1% to 0.05-0.13% of frames.
- **The ball's look.** The felt is mottled at three scales, the seam is a whiter sunk rubber line, and there is a
  nap sheen and stray fibres on the silhouette. The trail no longer hangs under a served ball.
- **The physics audit.** Auditors measured the sim against published figures and a second set tried to refute
  each finding: nine findings, one refuted, three left open. Fixed:
  - The AI smashed at 144 km/h at every level. Now it's 132 km/h at the top and 109 at level 0 (amateurs 105-125,
    semi-pros 121-133).
  - The sprint's push faded early. It now matches the padel 5-10 m split: 0.858 s, against a measured 0.85-0.89.
  - The AI sprinted flat out into formation. Its per-match peak is now 4.34 m/s over 1 s; WPT men's median is 4.2.
  - The altitude ball is used above 1,000 m.
  - Halls have a roof: 1 strike in 90 used to go through it, and it's now scored by FIP.
  - Rolling deceleration is set per floor.
- **The people.** The Y Bot mannequin is replaced by four men made in MPFB 2 from CC0 MakeHuman assets, bound on the
  game's own skeleton so every clip and IK target works unchanged. Two draw calls each, 29-31k triangles each
  (55k for the mannequin).

### The owner's requests (29 Oct)
"The racket looks unrealistic, so do the people, make them look like actual humans, extremely high def."
- **The people.**
  - Skin at its source's full 2048 px, with occlusion baked in Cycles.
  - A scalp painted under the hair, so the hairline grows out of the skin, and alpha-to-coverage hair.
  - Glass-fronted eyes, teeth and a tongue.
  - Skin shading: wrap lighting standing in for subsurface scattering, more through the ears, oilier T-zone, wetter
    lips, pores.
  - A face that moves, with 16 expression and gaze keys from MakeHuman's expression units: blinks, the eyes on the
    ball, effort at contact, grunts on smashes and serves, breathing after a run, a smile or a frown after the point.
  - Cost: 37-40k triangles a person (was 31k), about 1.15 MB of textures each.
  - The kit is fitted to the body. The shirt's hem no longer goes into the body: the cloth lag's inward part is
    dropped, and the shorts under the shirt are cut and tucked in. That was round 2's #12, which had survived two
    "fixes".
- **The racket, second pass.** Four original rackets, one per player: BRASA (diamond), MAREA (round), CIERZO
  (teardrop), ÓRBITA (round). Every name and design is made up.
  - Built from real padel rackets:
    - a rounded frame under a clear coat or matte finish;
    - sand-finish faces;
    - 50-61 holes of 12-13 mm with foam walls between carbon skins;
    - a protector;
    - a straight or arched throat;
    - a spiral overgrip with a finishing tape;
    - a flared cap and a flat braided wrist strap.
  - Within FIP limits: 45.5 cm long, 26 cm wide and 37.9 mm thick with the protector.
  - Cost: 13-14k triangles close up, 1.7k at the TV camera, 2 draw calls each (was 5).
  - An independent critique found one High problem (the neck through the tape collar) and four Mediums: holes popping
    between detail levels, a mirror-like lacquer, holes through the model names, and one colourway close to a real
    racket's. All were fixed.

### Review round 1 (`REVIEW.md`)
A professional padel player's eye and a Top Spin 2K25 critic's ranked 13 findings, four of them High. All four are
fixed. Before | after, AI doubles at level 1 over 2,040 points (`docs/review/match-stats-l1*.txt`), against WPT
2020 men (PMC11359520):

| | Before | After | Pros |
|---|---|---|---|
| Bajada, share of points (High #2) | 0 | 15.2% | 14-17% |
| Back-wall shots, share of shots (High #3) | 27.4% | 21.2% | 12.8% (WPT 2014) |
| All wall shots | 32.4% | 26.5% | 19.0-24.5% |
| Smash share of overheads (High #4) | 49% | 31% | 26-36% |
| Bandeja / víbora / smash, share of points | | 33.9 / 24.7 / 28.9% | 44-48 / 20-23 / 30-33% |
| Shots a point, seconds a point | 11.2, 15.4 s | 11.7, 15.5 s | 10-11, 13.5-14.8 s |
| Errors into the net, off the side | 70%, 4.6% | 67%, 9.0% | 51%, 17% |
| Stadium crowd (High #1): triangles, draw calls | 343k, 12 | 9k, 4 | |

### Review round 2 (`REVIEW.md`)
A fresh review found 19 findings: five High, seven Medium, seven Low. Four of the Highs are fixed. The fifth (#1,
no lines in the hall) did not reproduce: the captures had been taken before the floor's shader compiled. Before |
after, AI doubles at level 1 over 2,040 points (`docs/review/match-stats-l1-r1.txt`, `-r2fix7.txt`), against pros:

| | Before | After | Pros |
|---|---|---|---|
| Bandeja / smash, share of points (High #2) | 33.9 / 28.9% | 40.1 / 35.0% | 44-48 / 30-33% flat, plus 7-8% por tres |
| Smash, share of winners (High #2) | 28.1% | 39.4% | 43% |
| Out of the court, share of winners | 7.3% | 9.7% | 17% |
| Volley, share of winners (High #3) | 43.8% | 40.2% | 28% |
| Winners off an opponent's body | 17.7% | 8.9% | (no class) |
| Errors into the net | 67.1% | 58.0% | 51% |
| Unforced errors, share of points | 39.3% | 36.5% | 29-33% |
| Shots and seconds a point (Medium #6) | 11.7, 15.5 s | 11.2, 14.4 s | 10-11, 13.5-14.8 s |
| Chest to the net at contact: bandeja / víbora / smash (High #4) | 11-13° each | 53 / 38 / 5° | side-on / side / square |
| Bajadas over 25 cm from the racket (Medium #7) | 3 in 8 | 1 in 5 | |

- **High #5, between points:** where the players used to brake to a stand, dip to black and teleport, they now:
  - walk back, partners meeting first;
  - tap rackets;
  - get a net-post camera cut-away on the winning pair;
  - and the server bounces the ball twice before the serve.
  The next toss comes 5.7 s after the point (it was about 3.3 s; FIP allows 20 s).
- **Medium #7, bajadas:** the misses were the sim's fault. Its reach was 1.35 m out at any height, so the AI took
  smashes a metre in front of it at 2.7 m. The reach now shrinks above the shoulder (`reachAt`).
- **Low #15:** the floor option now changes the picture as well as the bounce.
- **Low #16:** hair has alpha to coverage.
- Left for the owner, who asked to see cue and HUD changes first:
  - #10, the controls panel over the court;
  - #14, the ball trail.
- Still open, at Medium: the hall's look (#8), the stadium's dressing (#9), umpire calls (#11).

### Review round 3 (`REVIEW.md`)
Two fresh reviews found 32 findings: eleven High, thirteen Medium, eight Low, none Critical (`docs/review/round3-*.md`).
Ten Highs are fixed. The eleventh (the racket missing the ball) is better, and its last case is now a Medium.
Before | after:

| | Before | After | Real life |
|---|---|---|---|
| Bandeja replies volleyed on the full (pro #1) | 58.9% | 36.5%, mostly by net players | let through to the glass |
| Volleys from over 6 m out, share of shots | 6.5% | 2.5% | rare |
| Flat returns played by the incoming server (pro #2) | 36% | 75% | 71.9% go at the server |
| Net-takes made by the lob (pro #3) | 19.2% | 51% | 60.6% |
| Chest to the net at contact: backhand / backhand off the glass / forehand off the glass (pro #4) | 13 / 19 / 6° | 63 / 78 / 48° | side-on |
| Contacts with the racket over 10 cm from the ball (critic #2) | 24 of 640 | 17 of 640 | |
| Night court, line-to-turf contrast (critic #5) | 1.07 | 1.86 | 1.87 by day |
| Leg sectors with skin above the shorts' hem (critic #3) | 0 of 64 | 63 of 64 | |

- **The match end (critic #1).** It used to freeze, with the ball in the air. Now:
  - the ball falls and everyone reacts;
  - both pairs walk to the net, touch rackets across it and step back;
  - a camera shot along the net frames it;
  - there is no false change of ends.
- **Replays and cameras (critic #4).**
  - Instant replays of big points: an exact re-run of the point from a copy of the match, from two angles in turn,
    slowed round the winning shot, on 7-14% of points.
  - Three camera presets in Settings: TV, TV close and Player.
  - The pan no longer runs faster at a higher frame rate.
- **The key help (critic #6)** folds away after the first point. **Opponents (critic #7)** have made-up names and
  nations.
- **The hall (critic Medium #12)** has its far gable clad up to the roof.
- Open at Medium:
  - short points;
  - the serve's direction;
  - the víbora's pace;
  - the styles' net trait;
  - how points end;
  - singles;
  - cut-away variety;
  - an umpire's voice;
  - stiff overhead and serve poses;
  - low half-volleys planned late.
- **Frame rate:** the build from before round 3 (875fa99) against this one, two runs each back to back, load
  average 3.9-12.9 (`tools/out/r3-perf.log`).
  - Medium at CPU 4×: 122.3 / 133.3 fps, p99 10.8 / 10.0 ms before; 130.8 / 148.5 fps, p99 10.9 / 10.9 ms after. No
    frame over 20 ms, except 2 in one run after.
  - High at 2×, unpaced: p99 19.2 / 19.8 ms before; 19.0 / 16.0 ms after.
  - High paced at 120 Hz: every run holds 120 Hz.
  - Draw calls 89 → 90; triangles 437k → 441k.
  - With replays off (`&replays=0`): 141.1 fps, p99 9.7 ms.
  - The sim's p99 a frame rose 1.0 → 1.7-1.8 ms at CPU 4×, and 0.2 → 0.4 ms unthrottled. This is round 3's AI
    planning: replays off read the same.

### Review round 4 (`REVIEW.md`)
Two fresh reviews found ten Highs, none Critical (`docs/review/round4-*.md`), and two of them were new. Eight Highs are
fixed. The people (#7) are better and close to what the MakeHuman source can give, and the modes (#10) are better, with
a guided first match, career and online still on the roadmap. Numbers from 2000 points at level 1. Before | after:

| | Before | After | Real life |
|---|---|---|---|
| Flat shots, cross-court / down the line (pro #1) | 42 / 58 | 56.4 / 43.6 | 57.5 / 42.5 (WPT) |
| The outer metre of the court, share of flat shots (pro #1) | 1.6% | 5.7% | |
| Back-glass climbs, share of shots (pro #11) | 20.6% | 15.8% | 12.8% |
| Drop volleys a point; contact height (pro #2) | 0.26, from 0.69 m | 0.05, from 1.20 m | |
| Serve: side glass / T / middle (pro #3) | even round the box | 57-60 / 25 / 15-17 | 64.6 / 24.3 / 11.1 |
| Bandejas volleyed on the full against two players back (pro #4) | 20% | 9.4% | let through to the glass |
| Singles: points ended on the full into a wall (pro #5) | 38% | 13.2% | |
| Singles: volleys, share of shots (pro #6) | 3.7% | 11.2% | |
| Singles: server's distance from the net at the return, p10 / p50 / p90 (pro #6) | 7.60 m every time | 4.13 / 4.76 / 7.61 m | our variant |

- **Up close (critic #7).** The violet in the eye sockets, the lavender eye whites and the pale band under the jaw were
  our own shading, not the source. Skin now takes a warm ambient light, the irises are brown, the eyes have a
  catchlight, dark skin keeps its sheen, and hair and shoes have detail. Close up they still read as well-made game
  characters, not photographs.
- **The match end (critic #8).** The winners run to each other and embrace, the losers bend over with their hands on
  their knees, then both pairs walk to the net.
- **The cast (critic #9).** Ten people, four of them women, in men's or women's matches, with eight kits and names
  from nations that fit the face. Only the four people on court are loaded for a match.
- **Modes (critic #10).** A three-round knock-out and four practice drills: back glass, side glass, lobs and overheads,
  and volleys.

### Review round 5 (`REVIEW.md`)
Two fresh reviews found eleven Highs, none Critical (`docs/review/round5-*.md`), and nine were new. Five are fixed, five are
better and still short, and one, the faces, waits on the MetaHuman pilot. Numbers from 2000 points at level 1. Before | after:

| | Before | After | Real life |
|---|---|---|---|
| Net volleys off a high ball, W / L (pro #2) | 6.9 / 11.8 | 5.8 / 2.2 | the ball to kill |
| Net volleys off a low ball, W / L (pro #2) | 0.7 / 1.6 | 0.5 / 6.2 | the ball that hurts |
| Lobs out on the full, share of points (pro #3) | 5.8% | 1.5-2.7% | |
| Replies to a smash on the rise, against two back (pro #1) | 83% | 65% | under 15% |
| Third shot struck from, metres from the net (pro #4) | 3.13 | 4.03 | 3.84 |
| Women: winners by double bounce / came back / out (pro #5) | 46-52 / 31-34 / 13-15 | 73 / 17 / 4 | 76.9 / 11.8 / 11.3 |
| Women: first serves in (pro #5) | 93 | 89.5 | 87.7 |
| Women: serving pair wins (pro #5) | 64.4-65.0 | 58 | 48.5 |
| Racket to ball, worst contact (critic #6) | 27.6 cm | 15.1 cm | |
| Ready stance, trunk (pose pass) | 47° | 20.5° | 5-19° |

- **Women's matches (critic #1, #4).** Fitted tops and shorts, four women's voices and the published women's game.
- **Rematch and the knock-out (critic #2).** A rematch keeps everybody and the next round keeps your pair.
- **Singles (critic #3).** The cut-away finds the winner.
- **Faces (critic #5).** Teeth and hair are better. The faces are the next job, with MetaHuman.

### Review round 6 (`REVIEW.md`)
Two fresh reviews found ten Highs, none Critical (`docs/review/round6-*.md`; the critic's is partial, stopped before its status
job ran). Three are fixed, one is down to Medium, five are better and short of the real figure, and one, the faces, waits on
MetaHuman. Numbers from 2000 points at level 1. Before is e39b531, the round's start. Before | after:

| | Before | After | Real life |
|---|---|---|---|
| Endings W / FE / UE (pro #2) | 44.7 / 16.9 / 38.5 | 38.1 / 27.0 / 34.9 | 34-42 / 29-33 / 29-33 |
| Winners: double bounce / came back / out | 39.8 / 43.6 / 13.2 | 50.0 / 40.2 / 5.8 | 48 / 35 / 17 |
| Smash, share of winners (pro #2) | 55.7 | 52.2 | 43 |
| Volley, share of winners (pro #2) | 14.4 | 23.7 | 28.4 |
| Swings at the air, per 100 points (pro #3) | 12.5 | 1.0 | about none |
| Soft balls left to die, share of points (pro #3) | 18.4% | 11.2% | under 8% |
| Reachable balls let past at the net, per 100 points (pro #1) | 31 | 3.5 | |
| Replies to a smash on the rise (pro #4) | 70.3% | 18.8% | under 15% |
| Net pair's depth, p10 / 50 / 90, m (pro #6) | 3.09 / 3.10 / 3.18 | 2.10 / 2.63 / 3.66 | breathes |
| Stagger within the net pair, median, m (pro #6) | 0.02 | 0.47 | |
| Forehand volley: chest off square (pro #5) | 5° | 40° | 25° on the hips, 11-55 by camera |
| Forehand volley: wrist in front of the shoulder (pro #5) | 0.26 m | 0.41 m | 0.39 m |
| Forehand volley: elbow (pro #5) | 30° (its stop) | 34-41° | 63° |
| Bandeja: elbow at -0.2 s / contact (critic #1) | 30 / 39 | 85 / 50 | about 60 / 54-65 |
| Walk back: speed, hips (critic #2) | 2.2 m/s, 0.88 | 1.5 m/s, 0.96 | 1.2-1.5 m/s |
| Bajadas, share of points | 17.9 | 17.1 | 14-17 |
| Contraparedes, share of points | 19.4 | 11.9 | 11-13 |
| Shots per point, seconds | 10.7, 14.6 | 10.4, 14.1 | 10-11, 9.4-14.8 |
| Lower levels, shots per point: 0 / 0.5 | | 5.2 / 6.9 | 5.6 / 7.3 |

- **One number went the wrong way.** Winners out of the court fell from 13.2% to 5.8% (17), the price of more grip loss on glass.
  Lowering it again gave 42.8 / 44.8 / 7.8 at 0.25 and 37.7 / 47.6 / 10.2 at 0.18: more out, further off on the other two, so it stays.
- **Real footage.** Bandeja, víbora, smash and forehand volley are compared with pose read from public clips, numbers only
  (`docs/research/footage-pose.md`). Groundstrokes, the serve and the backhand volley aren't.
- **Women** moved too: 13.5 shots, 19.3 s, W / FE / UE 23.2 / 31.7 / 45.1, serving pair 51.2 (48.5, was 57.0), winners 85 / 6 / 1 (76.9 /
  11.8 / 11.3). The serving pair is much closer; the winners are thinner and the rally still long.
- **Performance.** Paired runs against the build before round 3 (load average 6-12). High at 120 Hz: 120.5 fps both. Medium, CPU 4×:
  frames over 20 ms 1.06% then 0.52%, CPU p99 20.1-24.9 ms then 14.8, sim p99 0.2 then 0.5 ms, max 1.4 then 3.0. Allocation: 3-7 GCs in
  100,000 ticks (budget 10).
- **Load is over budget on this loaded machine.** Broadband, CPU 4×: title playable 13.9-14.4 s and Quick match 6.1-7.2 s, against the
  build before round 3's 14.7 and 5.5 in the same runs, and Phase 8's 5.49 and 3.46 on a quiet machine. It needs a quiet rerun, and the ten
  people's meshes and textures are the likely cost (`OPEN_QUESTIONS.md`).

### Review round 7 (`REVIEW.md`)
Two fresh reviews and a third pass that re-measured both (`docs/review/round7-*.md`). One Critical, a one-key exploit, and three
Highs; a fourth High was lowered to Medium. All are fixed except the faces. Numbers from 2000 points at level 1. Before is c96b20b,
the round's start. Before | after:

| | Before | After | Real life |
|---|---|---|---|
| Slice-only player against level 1, 45 ms timing (pro #1) | 63.4%, 21 of 21 matches | 43.4%, 1 of 8 | an exploit should lose |
| Slice returns that win outright (pro #1) | 51% | 5% | |
| Receivers winning in one return, share of points (pro #1) | 2.4% | 0.5% | |
| Serving pair, 1-2 shot points (pro #1) | 64% | 83-88% | national 98 |
| Smash coming back at its own side, of 3000 points (pro #2) | 40 | 2 | |
| Hitting your own side's body, share of points (pro #2) | 1.8% | 0.5% | |
| Singles: return winners, server wins (pro #3) | 11.0%, 49.3% | 5.3%, 52.9% | |
| Volley: racket lean, mid forehand / low forehand (pro #4) | -62 / -64 | -31 / -31 | |
| Volley: elbow, mid forehand / mid backhand (pro #4) | 45 / | 58 / 54 | 63 / 54 |
| Volley: racket path by height, m (critic #2) | 1.18 / 0.75 / 0.62 | 0.66 / 0.62 / 0.53 | shorter than a drive's 1.0 |
| Endings W / FE / UE | 36.2 / 27.6 / 36.2 | 36.7 / 27.6 / 35.7 | 34-42 / 29-33 / 29-33 |
| Winners: double bounce / came back / out | | 42.2 / 46.1 / 5.3 | 48 / 35 / 17 |
| Smash, volley, share of winners | 53.3, 21.0 | 58.2, 27.3 | 43, 28.4 |
| Shots per point, seconds | 10.8, 14.7 | 11.6, 15.5 | 10-11, 9.4-14.8 |
| Serving pair wins | 61.8-63.3% | 61.8% | about 62 |
| GCs per 100k ticks, singles / doubles / avatars | | 8 / 8 / 6 | budget 10 |

- **Two numbers went the wrong way.** Rallies grew by 0.8 shots to 11.6, over the pros' 10-11, because points that used to end on a
  return now go on. The smash's share of winners rose to 58 (43): the fix took away cheap winners, and bandeja and víbora still don't
  finish (1.7, real 12.7). That's the largest gap left in the game itself.
- **The people.** All ten have their own faces with asymmetry, skin with blotches and pores, real cloth folds, clean necklines,
  stitched hems, wristbands, and long hair on a spring. In a cut-away they read as people. Close up they read as a good game
  character and not as a photograph, and the 312-texel face is why.

### The movement pass, and the owner's four worst parts (30 Oct)
Elbow angles in degrees, on the same measure for pros on video and the game's own swings (`docs/research/footage-pose.md`):

| | Before | After | Video |
|---|---|---|---|
| Ready, right / left elbow | 28 / 32 | 61-67 / 44-56 | 46-66 / 45-47 |
| Forehand elbow at contact | 30 (its stop) | 48 | 31-34 |
| Volley elbow, take-back to contact | 30 (its stop) | 116 to 57 | 54-63 at contact |
| Serve, largest spike | 92 | none | |

Medium-preset p99, machine at load 30-60, so noisy: 19.1 / 15.7 ms before and 17.3 / 18.0 after. High 28.6 / 15.8 and 26.0 / 22.4. Load
on broadband, title plus match: 14.17 + 9.75 s and 18.45 + 10.33 s. Nothing here is beyond the noise. A quiet rerun is still open.

### Nobody reads the glass exactly (31 Oct)
The largest single gain in how points play since the rounds began, and one line of cause: the AI knew how every ball would come off the
glass. A defender now sets up slightly off the spot until the ball has come off it. 6000 points on unseen seeds, before | after:

| | Before | After | Real life |
|---|---|---|---|
| Shots, seconds per point | 11.3, 15.1 | 10.2, 13.7 | 10-11, 9.4-14.8 |
| Smash, volley, share of winners | 54.4, 32.0 | 48.0, 33.0 | 43, 28.4 |
| Bandeja + víbora, share of winners | 1.5 | 6.0 | 12.7 |
| Winners: double bounce / came back / out | 49.3 / 40.5 / 6.0 | 53.3 / 35.6 / 6.2 | 48 / 35 / 17 |
| Endings W / FE / UE | 39.4 / 26.0 / 34.6 | 38.8 / 27.6 / 33.6 | 34-42 / 29-33 / 29-33 |

Balls leaving the court are still far short (6 against 17), rallies still have too few short points (45.7% over 11 s against 26), and
double-bounce winners now overshoot by 5.

### Review round 8 (`REVIEW.md`)
Two new Highs (the lobbed player's backpedal, bodies with no weight), two repeats at High (women's overheads, faces close up) and a proven
Medium regression (pops doubled). Three of the four Highs fixed and the regression gone. The people close up stay High: better, and limited by the source.
- **Women's matches.** One value, `women.smashEffort` 0.85, a stale fit. Verified on seeds the agent didn't use (9101+, 6000 points): smash W 9.6 to 30.0
  (tour 29-33), 17.0 to 16.0 s a point, W / FE / UE 28.2 / 32.5 / 39.3 to 31.7 / 31.0 / 37.3 (30-36 / 28-32 / 35-37). Volleys still take 43% of winners.
- **Kit.** Tanks, the polo, p8's hips and all ten heads and shoes (`DECISIONS.md`).
- **Sound.** 12 dB louder; replays have sound.
- **Performance.** Before the kit merge, paired at load 9-14: medium p99 17.9 to 15.9 ms, high 20.7 to 18.6, so no cost from the movement work.

### How they move, round 8 (31 Oct)
The owner named four worst parts. This is the third, how they move. Before | after, same seeds:

| | Before | After | Real life |
|---|---|---|---|
| Whole body lean starting / steady / braking (deg) | 18.0 / 17.3 / 16.6 | 30.5 / 19.3 / 11.2 | starts lean hard, stops lean back |
| Lobbed net player going back, chest under 40 deg from square | 70.2% | 9.5% | rarely |
| Pops of 15 degrees or more, per player-minute | 4.83 | 2.1 | 0 |
| Walk back: going forwards | 13% | 67% | nearly all of it |
| Walk back: both feet off the floor | 21% | 4.3% | 0 |
| Walk back: footsteps a second | 5.25 | about 2 | 2 |
| Low volley elbow (under 0.85 m) | 30 | 50-56 | 63 |
| Racket speed just after a drive's contact (m/s) | 7.2-7.6 | 9.3-9.9 | as it arrived |

Still short: a jog is in the air 64-68% of the time (real 30-40), hard stops don't lean back, the walk has no pelvis twist, and the
thighs of the four women overlap in 11% of frames, which is the test's wide capsules more than anything you'd see.

### Review round 9 (`REVIEW.md`)
One new High (strokes drawn with the back to the net) and one proven High regression (the misread on easy balls), both fixed. The faces repeat at High, waiting on Epic's Install.
- **Back to the net.** 36 of 3,047 hits to 0 of 3,165. An AI that gave up a contrapared for a block left its plan saying contrapared, and the body believed the plan.
- **The misread.** Now needs pace and spin together. Bandeja + víbora 6.2-7.0 to 13.3% of winners (12.7), volleys 33-34 to 27.5 (28.4), serving pair 62.9 (62), plain double-bounce
  winners 10.6 to 7.5% of points.
- **Overheads.** A real racket drop: bandeja 33 ms out 4.7 to 9.6 m/s, smash at the ball 9.0 to 17.6.
- **The dip at the ball.** Gone from every stroke: a sum that ran the swing's end a frame long. Drive at the ball 7.7 to 11.8 m/s.
- **Feet tapping.** 6.2 lifts a second to 1.5, and those are real steps.
- **Cut-aways.** A pair going back is filmed from their back glass: backs 30 to 21%, faces 56 to 62.
- **Performance.** With the kit's double-sided draw in, load 8-13: medium p99 16.5 ms, high 21.7, high paced at 120 Hz 8.3 with no frame missed and CPU p99 2.8 ms. Quick match to its first frame 6.4-7.0 s on broadband at CPU 4×.

### Bugs found and fixed in Phase 9 (outside the review rounds)
- **The owner's contrapared bug.** A human's contrapared plan was charged its turn again on every re-plan, so it
  always ran out of time and fell back to a stroke facing the net, which whiffed.
- **The grip.** The old handle sat 30° off the fingers with half of it inside the palm, and the wrist hung past the
  butt.
- **A hidden tab never advanced three's node frame,** so captures with bloom kept their first render.
- **The ball's trail** hung under a served ball like a string, and stayed behind a dead ball.
- **The physics audit:**
  - The AI smashed at 144 km/h at every level.
  - The sprint's push faded at the run cap.
  - The AI sprinted flat out into formation.
  - About 1 strike in 90 went through the 9 m hall roof.
- **The people:**
  - Binding on a baked T-pose blended the weights twice.
  - Turning MPFB's clavicle shrugged each shoulder 9 cm.
  - Soles sat 4-5 mm under the floor.
  - The short MPFB thumb went through the handle.
- **The crowd sprites:**
  - Every sprite was drawn at giant size across the court. three applies the instance matrix before
    `positionNode`, so the seat's coordinates scaled the quad.
  - One spectator's hair rendered as a white helmet.
  - The first cut clapped mid-point.
- **Review round 2's fixes turned up:**
  - The AI's "out of reach" flag survived from one rally into the next serve.
  - So did the avatar's "beaten" flag: a server who had lost the last point on a ball out of reach swung 0.1 s
    late.
  - The sim's reach ignored height (bajadas a metre out at 2.7 m).
  - The hems' cloth lag pushed the shirt into the body, so the shorts, and through the hollow body the court,
    showed through.
- **Review round 3's fixes turned up:**
  - The planner thought players could stop at once. A run counted only the speed along the way, so a spot closer
    than the player could stop at was planned as a stand, and assisted timing fired after the ball had passed the body.
  - Left-handers' smashes never left the ground. The hop checked the smash family, and a left-hander's is its
    mirrored copy. Bandejas and víboras never hopped at all.
  - The score changed ends after the last set of a match, so the camera swung round for a change of ends that
    would never be played.
  - The stadium's end stand hid when the camera passed its front row, not its back row, so the rows in front of a
    closer camera went missing.
- **Review round 4's fixes turned up:**
  - The first net built in a page took the warm-up's throws and then served as the first match's net. Its leftovers
    made the first match differ from every later one until the net was next hit, and the determinism test showed it
    only once a seed stayed off the net for 83 s.
  - The ambient light on skin didn't change at all at first: three adds the environment's diffuse in its specular
    step, so both had to be overridden.
  - One skin made Blender quit silently during the build, and one hairstyle covered an eye. Both were swapped.
