# Decisions

The owner's brief (2026-10-27): make the game as realistic and as good as possible, in nine phases, in order,
each verified before the next. Plus, in their own words: a volley shot, a serve motion more like the pros', and a
better-looking, more realistic court. Every decision and the reason for it goes here, newest last.

## Setup
- **Branch.** The work is on `realism-brief`, committed after each step. Pages deploys from `main`, so each phase
  is merged to main once it is verified. The owner can then play it, and the standing "just push it" holds.
- **Agents.** The owner set the budget when asked: 1-2 agents while working, 3-4 at most at a phase's end for
  the verifier and the fresh-eyes review. A phase is done when a fresh review finds nothing new and serious.
- **Where the owner's three asks land.** The volley shot goes in Phase 2: a new shot with its own timing window,
  key and placement. The serve motion goes in Phase 3 (animation, studied from pros). The court goes in Phase 5
  (photo-match). Doing them in the brief's order means each one is built on the phases before it: the volley's
  physics on the validated ball and racket, its animation on the Phase 3 checks.
- **/reference does not exist.** There is no `/reference` or `~/bandeja/reference`: no photos, clips or audio of
  the owner's. Realism is backed by published research and measured data instead, and every place where footage
  or photos would settle something goes in `OPEN_QUESTIONS.md`.

## Phase 1: ball physics validation
- **The lab.** `src/sim/lab/ballLab.ts` fires 38 shots at the floor, both glass walls, the mesh, the corners and the
  joins, and measures every contact: restitution, tangential speed kept, angles, the contact point's tangential COR,
  spin, scatter, energy, and what players see off the back glass (height a metre out, how far it comes back).
  `node tools/ball-lab.ts <tag>` writes `docs/lab/ball-lab-<tag>.md/.json` (before and after are committed);
  `?lab=ball` replays the shots on the court in the browser; `tests/sim/ballLab.test.ts` holds the tuned numbers.
  Two ITF court-pace shots (`cpr-turf`, `spr-glass`) let the lab be compared with the published tests directly.
- **Research.** A research agent collected what is published (report summarised in `docs/realism.md`): the FIP and
  ITF specs, the Spanish court standard, IBV's lab tests of 10 padel balls for Testfakta, Dignall's thesis, Cross,
  Hamilton. Nobody has published padel glass or mesh rebound, and Gea García 2021 (glass vs concrete) is
  paywalled; where there is no data the number is labelled tuning.
- **Restitution falls with impact speed at the ball's rate.** Dignall measured pressurised tennis balls on a rigid
  surface from 0.80 at 3 m/s to 0.60 at 20 m/s: a slope of about 0.0115 per m/s. The slope is the ball's, so hard,
  turf and glass all use it; e0 is set so the FIP drop test stays at 141 cm on hard.
  (The old slope, 0.010, made a 30 m/s impact too lively.)
- **Turf bounces like a hard floor, less a little for the sand.** The standard asks for at least 80% of a rigid
  floor's rebound; sand-filled turf measures 100.7% (tennis). The old turf gave 87% noise-free. Now it has the
  hard floor's restitution, and the sand's random speed loss (tuning) brings the average to about 97%.
  Friction 0.62 → 0.59, inside IBV's 0.56-0.62 for padel balls on padel turf; the lab's court-pace test reads CPR
  44.7, inside their 36-50. (IBV publishes no angle: the lab assumes the ITF's 16°. At 16° the ball slides through
  the whole contact, so the friction reads back as put in; only the restitution half of CPR checks anything.)
- **Glass: rigid x 0.985, friction 0.35.** The panel's impedance takes 1-2% of the energy (derived), and felt on
  smooth glazed tile slides at about 0.35 (ITF test). The old glass was 0.966 of the floor at the drop speed and
  slid at 0.30. Off the glass, a topspin drive now comes back 11.6 m (was 11.4) and the smash rises to 7.7 m
  (was 7.0). That came from the livelier floor, not the glass friction (correction after review): the ball
  grips the back glass at any friction from 0.20 to 0.35 (11.3/11.6/11.6 m), and only the side-glass pace test
  depends on it. The smash meets the glass higher (2.22 m, was 2.00) because the turf now gives e_n 0.66 for it,
  not 0.61.
- **Joins: flush glass joins are not frames.** The old model gave every seam, and the wall-to-wall corner, a 22°
  random normal. FIP requires flush joins and a uniform rebound, so a glass-to-glass join is now nearly a plain
  bounce (3° jitter, 3% speed scatter: tuning) and the corner is just two walls. Frames (mesh posts, the mesh panel's
  frame on top of the glass, the end of the glass against the mesh, door edges) keep the irregular bounce.
  Lab: the back-glass seam's scatter went from 20.9 ± 15.8° to 2.5 ± 1.9°.
- **Ball wear follows the one measurement.** IBV/Testfakta's 10 balls after 666 strokes gripped 2-11% more (mean
  4.7%) and bounced 0.7-4.9% higher (first written as 8 balls, 2-7% and 0.7-2.8%: two rows of their table were
  missed; corrected after review); the old model instead leaked pressure so a 150-point match lost 4 cm of drop test, which nothing
  measured. Now friction rises 4.7% and restitution 1% as the nap fluffs up (with the Hawk-Eye drag rise), and
  there is no pressure loss within a match (unmeasured; noted in OPEN_QUESTIONS.md).
- **Clay friction 0.80 → 0.70** (Cross 2010 measured tennis clay at 0.70). Clay stays a fantasy surface.
- **Mesh: unchanged.** No data exists; the numbers stay tuning and are listed in OPEN_QUESTIONS.md.
- **Gameplay effect** (AI doubles, 24 seeds x 300 s, `tools/point-mix.ts`, before = b2985de, after = the review
  fixes below, round 2 included): 360 → 317 points, median rally 9 → 11 shots, untouched winners (double bounce)
  48.6 → 47.0%, own-side errors 44.2 → 46.1%, balls hitting an opponent 1.4 → 2.5% (8 points; for Phase 4).
  Both moves are towards the pros (winners 34-42%, errors about 60%), and small. Corrected after the Phase 2
  verifier: this line first said 328 points, 43.9/49.1%, median 10, 3.7%, which no commit reproduces (round 1's
  commit, 97611af, gives 321, 47.0/45.8%, median 11, 2.8% on two runs); those figures came from a build in
  between. The first write-up before that quoted 12 seeds on an older build still (173 points, 48/45/5%): a
  one-tick change swings 12 seeds by 10%, hence 24.
- **A test threshold moved**: La Serpiente's víbora share among overheads was required to be 1.4x El Relojero's;
  with her víbora chance saturating near 1 it came out 1.36 after the tuning (the behaviour holds, the factor was
  empirical), so the bar is 1.25. The net test that counts points lost in the netting pools 24 seeds instead of 16:
  with the livelier ball seeds 1-16 gave 6 such points against its bar of 8 (seeds 1-24: 11). The rule it checks
  is unchanged; the sample was too small.
- **A V8 trap found on the way.** Adding one multiply to the bounce made Ball.step allocate in about half of all
  doubles runs (19-20 GCs per 100k ticks against a budget of 10): the wear update's exp(), inlined into every
  Ball.step tree, put the tree over TurboFan's inlining budget. The bounce now only counts wear; MatchSim applies
  it after the step (`Ball.applyWear`). 8 runs out of 8: 4-5 GCs. Court zone lookups also take their point through
  fields (`Court.qu/qy`).
- **Review round 1** (an independent verifier and a fresh-eyes reviewer, read-only). Fixed:
  - *Junctions were two instant bounces in an order a millimetre decided* (high). A ball landing at the foot of the
    glass went 4.1 m up and past the net or 1.1 m up and 8 m out depending on a 4 mm shift; a square corner came
    out 22° skewed. A real ball's contact lasts about 4 ms and it squashes about a centimetre, so when the second
    surface is reached within that the two bounces are now solved together (both orders, averaged by how close to
    simultaneous, up to 30% extra loss in the exact nick: tuning). The result is smooth across the offset (lab
    test: under 5 cm of apex per 0.5 mm, under 45 cm per 10 mm out to plain floor-then-glass), a square corner
    exits square, and a nick within 5 mm of the floor counts as landing first (FIP: good in the corner).
  - *The sand made bounce height random* (high): a 2.5° tilt of the normal on a 12° drive changed the upward speed
    about 20% (heights spread 26%). Tilting the normal in the plane of the bounce mixes the ball's along-court
    speed into its height; real sand mostly skews the ball's line. Turf now turns the rebound about the normal
    (2° sd) with a 0.3° tilt; heights spread under 8% (test), the line still wanders 1.7°. Hard, carpet and clay
    were changed the same way (tuning, no data).
  - *Glancing hits could have a tilt bigger than their angle of approach* (medium): no impulse, a contact recorded,
    a second one at once. The tilt is now at most half the approach angle and the exit is enforced along the
    real normal.
  - *Rolling balls went through walls, and starting to roll logged up to four floor contacts* (medium). A rolling
    ball now comes back off glass and mesh at its foot (one wall contact) and rolls out through an opening; the
    flight loop stops when the ball dies, and a dying ball logs exactly one more bounce (its second, for the
    rules: a ball that low bounces again within 50 ms).
  - *No contact with free edges* (low): a ball passing just over a wall top or through a door within a radius of
    its frame went untouched. Wall tops, the enclosure's step and door posts and lintels are now edge lines.
  - *A ball below the floor fell forever* (low, not seen in play): it is bounced back up.
  - *Wall-play numbers were only guarded on one side* (medium): back-glass shots now have two-sided bands on how
    far they come back, their apex and their height a metre out (model values: a change to them must be meant).
  - *No test covered the deferred wear in a match* (medium): a MatchSim test checks drag and friction against the
    wear after a minute of play.
  - Docs corrected: IBV's 10 balls, the smash attribution, the gameplay numbers, the lab's 38 shots, stale
    pressure-loss text, the racket's worn-ball comment.
- **Review round 2** (fresh-eyes, read-only, 6 seeds x 300 s of doubles: junctions are rare in AI play, about 1
  per 1,445 floor bounces, so these mostly matter to a human playing near the glass). Fixed:
  - *A kiss of the glass took half the floor bounce* (high): the nick's extra loss (30%) went with how close to
    simultaneous the two contacts were, not with how hard the second surface was met, so a ball drifting into the
    glass at 0.1 mm/s as it landed bounced to 0.47 m instead of 0.93 m. The loss now scales with the second
    surface's share of the squeeze (smaller over larger normal approach speed): the drift case bounces to 0.927 m,
    a down-the-line drive grazing the side glass keeps its height, a ball driven into the foot of the glass still
    loses more (lab test: drift 0, 0.1 mm/s, 5 cm/s, 0.3 and 1 m/s).
  - *The second surface's material was read at the wrong point* (medium): extrapolated with the pre-bounce
    velocity it was below the floor (the side wall's mesh section read as the glass above it: a glass bounce
    instead of mesh, and a serve beside the side mesh not called a fault, 7.1.e) or tens of centimetres along a
    slow wall. It is now read at most a contact time on and never below the floor.
  - *The path jumped at the edge of the junction window* (medium): the second bounce was applied at the first
    contact's instant, up to a contact time before the ball reached the second surface, so 0.1 mm of offset
    moved the ball 11.5 cm a quarter-second later. The junction now flies the ball on to the second surface (as
    the first bounce alone sends it, under gravity) and records the second contact when it gets there; when that
    flight runs past the step, the ball is that far ahead of the clock and the next step starts that far in
    (`Ball.ahead`, hashed and copied). Worst jump per 0.1 mm across the window: 2.5-6 cm (the ordinary sensitivity
    of a bounce at that speed; test: under 4 cm for the rincón shot from 40 to 110 mm).
  - *The junction's clamp could kill a ball* (low): when the second surface's friction turned the ball back into
    the first, its normal speed was set to 0.05 m/s; it now bounces off the first surface again.
  - *Starting to roll added energy* (low, after the point): spin was set to v/r without slowing the ball, up to
    alpha (0.55) of its kinetic energy from nothing. The friction impulse that stops the slip is now applied:
    v' = (v + alpha r w x n)/(1 + alpha), the spin set to match. (A real ball skids to that state over a few
    tenths of a second; it gets there at once. Same end state.)
  - *A ball caught in the rigid net slid through the post* (low, predictions and solver ghosts only; the match
    ball's cloth already stops it): the catch now stops at the post.
  - *A 5 cm band beyond each wall counted as inside* (low, about 1 in 60k fuzzed balls): a ball whose centre is
    past a wall's plane (over the top or through an opening) is outside.
  - Left open: a second surface reached only after the first bounce (spin turning the ball into the glass) is
    still two contacts (OPEN_QUESTIONS.md). Clay keeps a 1° tilt, so a flat drive's height on clay varies about
    10% (clay is a fantasy surface). The rigid net's catch logs no extra bounce for a dying ball (predictions only).
  - Allocation: the match content changes with the physics, so GC counts move by match; four seeds of singles,
    before 4/12/4/4, after 5/5/5/8 (`ALLOC_SEED=` picks the seed in `tools/alloc-check.mjs`). Budget 10.
- **A second V8 trap: exp() calls.** With the junction code, singles allocated in about one run in six (13-30 GCs
  per 100k ticks). `--no-concurrent-recompilation` made it repeat every run (15), and the heap profile showed
  smath's `exp` wrapper not inlined into `Ball.integrate` (spin decay) and `Player.runTime`: its argument and
  result were boxed on every call, 30 MB per 100k ticks. Those hot calls now go through the Float64Array IO
  directly (`FIO[0] = x; expF(); FIO[0]`), as do the net's and the cloth step's; no double crosses a call there.
  Singles 3-5, doubles 6-7, avatars 4-5 over 6 runs (budget 10); the junction search is skipped more than 20 cm
  from a second surface.

## Phase 2: game feel
- **Values live in FEEL.md.** Every feel number (timing windows, volley reach, movement, split-step, sound,
  rumble, camera) is listed there with where it lives and why; this section is the decisions and what they did.
- **Input latency: render the present, not one tick behind.** The sim already took key events at their exact
  timestamps (a release is judged when it happened), but the render drew between the last two ticks *behind*
  now, adding a tick (8.3 ms) before a key's effect could be seen. The loop now steps until the sim is at or just
  past now and blends back to now (`?runahead=0` restores the old loop). `tools/latency.mjs` measures key → used
  by the sim → frame drawn → GPU done in both modes (results: FEEL.md).
- **The volley gets its own key (N), as the owner asked.** Holding it plans the incoming ball in the air
  (`planStand(volleyKey)`) with a volley's comfortable height (waist to shoulder) and a reach band instead of set
  feet: volleys are played on the move, met with a reach or a step. A volley planned too late is blocked off the
  bounce. The first version planned volleys like groundstrokes (stop, set the feet) and most were late; the
  reach band fixed it. Its test moved from singles to doubles: a net player in singles faces passing shots 2.4-3.2 m
  wide, which no volley plan should chase. Result (5 seeds x 120 s): a doubles net player takes 79% of balls in
  the air with N against 47% with the drive key, and loses no more points on its own shots (0 against 1).
- **Each shot has its own timing windows.** The tolerance of a contact is how far the face turns per millisecond,
  so the windows scale with the square root of the face's angular speed against the drive's (capped): a punch
  volley 1.35x, a lob 1.15x, a bandeja 0.85x, a smash 0.72x, a víbora 0.65x (FEEL.md has the table). The cue
  ring, the HUD's timing meter and auto-timing all use the shot the release is heading for (`windowScale`),
  including the modifier being held (`Player.heldMod`, hashed).
- **The split-step is real, and a standstill is heavy.** The old split-step was a 1.35x acceleration boost for
  0.35 s. The data say otherwise: the hop is airborne about 142 ms (no grip), and its value is getting going, not
  extra acceleration (a 1.35x boost would need 14.5 m/s², past what the shoe's grip allows). Now force builds from
  20% to full over 0.3 s from a static stance, the airborne hop gives no push, and the landing pre-loads the legs
  (no build-up for 0.3 s after it). Calibrated (scratch scripts, then `tests/sim/splitstep.test.ts`): a target
  1-2.5 m away is reached 108-117 ms sooner with the split-step (measured: 104 ms, Uzu 2009; 13.1%, Nieminen 2014),
  feet start about 280 ms after the opponent's contact (tennis: 266-311 ms). The planner adds the build-up and
  remaining airtime to its run times (within 40 ms of the simulated arrival, tested). The avatar's hop is the
  ballistic 2.5 cm for 142 ms (was a 6 cm lift).
- **Two V8 traps on the way.** A tuning field read only on a rare branch had no type feedback there, and reaching
  it deoptimised `move()` mid-rally: every tuning value `move()` and `startLag()` use is read up front. And a
  double returned from `startLag()` would be boxed: it writes a field (`lagT`). The singles allocation spikes
  that remained were the Phase 1 exp() trap (fixed there).
- **An AI bug, found by a test: modifiers stayed held all match.** The AI's input frame is reused and
  `InputFrame.clear()` leaves `held` alone (a keyboard sets it each frame), so after an AI's first smash it held
  power for every later shot, and after a víbora, precision. The styles test caught it when the split-step changed
  where overheads are taken: every style's overheads had drifted to víboras (El Relojero 53%, La Serpiente 55%),
  so the style made no difference. `SimpleAi.think` now clears its held bits each tick. La Serpiente plays víboras
  on 33% of her overheads, El Relojero 8%; the test's bar goes back to 1.4x (Phase 1 had lowered it to 1.25 on this
  bug's account).
- **Test samples enlarged, not bars lowered** (overheads in `assist.test.ts`): 5 matches gave 20-25 lobs for an 85%
  bar, 4 gave 13 víboras for an 80% one, 12 gave 36-45 smashes against a 40-lob floor; now 8, 12 and 16 matches.
  One bar moved on purpose: a víbora lands in 79% of the time over 30 matches with the test's assist (it was over
  80% before it had the tightest timing window of any shot), so the bar is 72%.
- **Hit feedback.** Racket sound by contact quality (WebAudio, synthesised: a centred hit short and bright, a
  mistimed one duller with a frame knock; loudness by ball speed; played at the event's exact time), a camera kick
  on smashes (up to 1.2° of push-in and a 2 cm jolt over a third of a second), and gamepad support with rumble
  (a crisp tap for a clean hit, a buzz for a mishit, a thump for a smash). The timing readout (grade and ms
  early/late) was already there and is unchanged; the owner asked not to restyle the cues without seeing them.
  All tuning by ear and feel (FEEL.md); Phase 6 does the full soundscape.
- **Gameplay effect** (AI doubles, 24 seeds x 300 s, `tools/point-mix.ts`; Phase 1 after its review fixes → Phase
  2): 328 → 297 points, median rally 10 → 11 shots, untouched winners 43.9 → 56.2%, own-side errors 49.1 →
  36.0%, balls on an opponent 3.7 → 3.4%. That moves away from the pros (winners 34-42%, errors about 60%). Taken
  apart: without the split-step model 54.9/39.0%, without the AI fix 54.4/38.0%. The shift is the per-shot
  windows: volleys are a quarter of all shots and now get 1.35x the drive's window, so the AI misses fewer. The
  AI's timing spread is a stand-in until Phase 4 calibrates its errors against pro match statistics; the windows
  are for the player's hands.
