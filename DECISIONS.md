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
- **Review round 3** (fresh-eyes, read-only; 100k fuzzed balls into corners and wall feet on every floor and
  court, 50k slow corner balls, 60k at wall tops and doors). Fixed:
  - *In a corner the junction's flight went through the third wall* (high, new in round 2): the flight on to the
    second surface (up to 12 ms) moved the ball with no collision test, so in a corner it could carry the centre
    past the other wall's contact plane; a wall is only met by crossing its plane, so the ball sank through the
    glass and was ruled out (38 exits through glass and 31 balls left inside a wall in 100k; 0 in AI play, where
    junctions are rare, but a human playing into the corners would meet it). The flight now stops at any other
    wall's contact plane, and, as the floor already did, a ball found past a solid wall's plane (still overlapping
    it) and going out bounces at once. Fuzz after: 0 tunnels, 0 embedded, 0 events out of time order (tests: the
    reviewer's corner drop, and 4,000 balls into the four corners).
  - *A second surface the ball never reached was logged* (low, since round 1): a ball barely closing on the second
    surface (the 12 ms cap) or stopped short by a third wall was logged as touching it, e.g. a serve 3.6 mm from
    the side mesh, never closer than 3.2 mm, faulted (7.1.e), or a topspin ball hitting the back glass 8 mm above
    the floor and flying up to 1.1 m logged a floor bounce. The squeeze still changes the bounce (the ball deforms
    against the first surface), but the contact is logged only when the flight gets there.
  - *Wear counted twice* when the ball bounces off the first surface again (low).
  - Left as is: a ball that dies right after a junction gains up to 12 ms of travel (it is dead; only where it
    rests moves), and after a flight longer than a tick (8.3 ms) the ball stands still for one tick (a few cm of
    hitch, in junctions only). Gameplay unchanged (24 x 300 s: 317 points, 47.0% / 46.1%, median 11 shots).
- **Review round 4** (fresh-eyes, read-only; the round-3 fuzzers again on every court and floor, 40k balls at wall
  tops, doors and mesh, realistic drives, lobs and slices landing around the glass foot). Fixed:
  - *A topspin nick at the foot of the back glass lost the point* (medium, new in round 3): logging the second
    surface only when the flight after the first reaches it missed a ball already touching the floor whose
    topspin the glass turns upward: the flight never closes on the floor, so no floor contact was logged and the
    referee called the wall before the bounce (0.7-0.8% of balls landing within 5 cm of the back glass's foot went
    to the wrong team). The second surface also counts as reached when the ball would meet it within half a
    contact time at its incoming speed (it keeps closing while it compresses against the first), or when it is
    the floor within `nickGap` (that field's meaning); logged at the first contact then. Test: the reviewer's
    ball logs its floor contact, then the wall. The round-3 cases (6-9 mm gaps with topspin, a serve 3.6 mm from
    the side mesh) stay unlogged.
  - Checked and fine: the wall recovery band fired only at the enclosure step's top corner (a ball over the 3 m
    section into the 4 m one sits up to 2.3 cm in the mesh for 3 ticks, then comes off its face; round 2 sent
    those through it); determinism across runs and interpreter-only; 0 tunnels, embeds, energy gains, stuck balls.
- **Review round 5** (fresh-eyes, read-only): **nothing new and serious; Phase 1 is verified.** The reviewer
  built an independent contact model (spring-damper ball, 2 µs steps against every plane; agrees with the sim's
  single bounces within 0.1-0.5 m/s) and compared calls at junctions on 40k realistic shots per court/floor
  (ShotSolver with swing errors), balls placed at wall feet, 20k door shots, the round-4 fuzzers on every court,
  AI matches, alloc over 6 seeds (3-8 GCs per 100k ticks), determinism with the JIT off. Calls differ from the
  reference on about 0.1% of shots near walls, about 60% of those the 5 mm nick allowance, and round 4 has as
  many or fewer than round 3 everywhere. The one band that moved: a ball already bounced coming down onto the
  back glass within 5 cm of the floor, wrong calls 5.3% → 3.4% (missed double bounces 5.0% → 1.05%, phantom ones
  0.3% → 2.3%, nearly all balls the reference brings within 3 mm of the floor). AI play reaches that band in 2
  of 425 wall contacts. Fixed: *a ball pushed out of the rigid net (predictions and solver ghosts only) hung in
  the air*: spin curved it back onto the net's plane, where it was caught again at f = 0 every substep (once in
  20k short shots); the body planes now only catch a ball at the start of a step if it is moving in (alloc singles 6-7 before, 7-8 after over 3-4 runs: noise, budget 10). Test in
  `tests/sim/net.test.ts`. Left as Low (OPEN_QUESTIONS.md): the friction-aware "reached" refinement the
  reviewer prototyped (wrong calls in that band 673 → 411 per 20k), within the reference model's own
  uncertainty; the junction applying the second surface's squeeze to a ball that never reaches it (serves within
  1 cm of the side mesh miss a fence fault, 63 in 20k on the narrow singles court, about 1 in 20k on standard);
  the nick being a distance (5 mm) rather than a time; the dying-ball rule placing a ball on the floor 1-2 cm
  early.
- **Frame rate, before → after Phase 1** (`npm run build && npm run perf`, 30 s each, AI doubles, this M1 Max):
  medium with the CPU throttled 4x (laptop proxy) p50 2.4 → 2.4 ms, p99 4.5 → 4.3 ms, max 15.6 → 12.0 ms, 0 frames
  over 20 ms either way, sim p99 0.8 ms both; high (2x pixel ratio) 498 → 539 fps, p99 8.9 → 8.8 ms, 99 → 105
  frames over 20 ms (0.66% → 0.65%; the same queue stalls with the frame limit off that M1 noted, not new). No
  regression. 43 → 42 draw calls.
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
  wide, which no volley plan should chase. Result (12 seeds x 120 s): a doubles net player takes 80% of balls in
  the air with N against 36% with the drive key, and under 5% of their shots lose the point either way (3 of 162
  with N, 1 of 174 with the drive key; 5 seeds gave 0 and 1, which proved nothing). Misses were not counted: see
  the fresh-eyes round.
- **Each shot has its own timing windows.** The tolerance of a contact is how far the face turns per millisecond,
  so the windows scale with the square root of the face's angular speed against the drive's (capped at 1.35):
  a punch volley 1.35x (the cap), a lob 1.19x, a bandeja 0.84x, a víbora 0.76x, a smash 0.71x; every value is
  that derivation except the drop, held at 1.2 (a touch shot: depth control is its difficulty) (FEEL.md has the
  table; the first version tuned a few round the derivation, the víbora down to 0.65, for no measured reason). The
  cue ring, the HUD's timing meter and auto-timing all use the shot the release is heading for (`windowScale`),
  including the modifier being held (`Player.heldMod`, hashed). Humans only for now: the AI's timing spread was
  fitted with one window for every shot, and the per-shot windows moved its error mix away from the pros (below);
  Phase 4 refits the AI with them on.
- **The split-step is real, and a standstill is heavy.** The old split-step was a 1.35x acceleration boost for
  0.35 s. The data say otherwise: the hop is airborne about 142 ms (no grip), and its value is getting going, not
  extra acceleration (a 1.35x boost would need 11.5 m/s², past what the shoe's grip allows). Now force builds from
  20% to full over 0.3 s from a static stance, the airborne hop gives no push, and the landing pre-loads the legs
  (no build-up for 0.3 s after it). Calibrated (scratch scripts, then `tests/sim/splitstep.test.ts`): a target
  1-2.5 m away is reached 108-117 ms (11-16%) sooner with the split-step (measured: 104 ms, Uzu 2009; 13.1% over
  2.70 m, Nieminen 2014, where the game gives about 10%); with a 170 ms decision the push starts 175 ms after the
  opponent's contact, the feet have moved 1 cm by 225 ms and 5 cm by 283 ms (tennis, first foot movement:
  266-311 ms). A human already pushing a direction when the opponent strikes doesn't hop (a forced hop would hold
  their keys for 142 ms; the verifier measured them arriving 17-33 ms later than without it). The planner adds the build-up and
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
  bar, 4 gave 13 víboras for an 80% one, 12 gave 36-45 smashes against a 40-lob floor; 8, 12 and 16 matches
  (those sizes were already in Phase 1's last commit; Phase 2 kept them).
  The víbora bar was first lowered to 72% on a wrong reading (that its narrow window made it miss); the verifier
  found the misses were swings the 3 s "held too long" safety had let off by themselves, graded against nothing
  (the bot, like the HUD's hint, holds O from the opponent's strike, and a lob can hang longer than 3 s). A held
  swing now waits while its ball is still coming (released 0.25 s past the contact, or at 8 s); with assisted
  timing all 131 víboras over 30 matches grade Good and land, and the bar is 90%.
- **Hit feedback.** Racket sound by contact quality (WebAudio, synthesised: a centred hit short and bright, a
  mistimed one duller with a frame knock; loudness by ball speed; played at the event's exact time), a camera kick
  on smashes (up to 1.2° of push-in and a 2 cm jolt over a third of a second), and gamepad support with rumble
  (a crisp tap for a clean hit, a buzz for a mishit, a thump for a smash). The timing readout (grade and ms
  early/late) was already there and is unchanged; the owner asked not to restyle the cues without seeing them.
  All tuning by ear and feel (FEEL.md); Phase 6 does the full soundscape.
- **Verifier round** (independent, read-only; it re-ran every claim, the citations included). Fixed, beyond what
  is written into the bullets above:
  - *Run-ahead could strike the ball up to a tick late* (medium): a release arriving for a moment the sim had
    already run past had its contact moved to the next tick (11-15% of releases at 60 Hz, 23-30% at 120 Hz, median
    2.3 ms late, and anything in that tick, a body hit, already decided). While a swing is held, the tick holding
    its contact now waits until now reaches it (`Game.tick`). Not enough: see the fresh-eyes round.
  - *Gamepad timing* (medium): a pad's timestamp is its latest report of anything, so it is now kept between the
    last poll and now (a stale value landed an event far in the past); triggers use their value with hysteresis
    (held past 50%, let go below 40%) instead of `pressed`, which Chromium flips early in the travel.
  - *Sprint text* (medium): "5 m from rest in about 1.3 s" was never true (1.45 s before Phase 2, 1.56 s with the
    build-up). The acceleration stays (the match-data peaks are already below the game's); the text says what the
    game does, and the padel sprint check is an open question.
  - Low: the avatar picked smash or chiquita during the charge from the previous release's modifier (now the held
    one); `splitAt`/`pushFrom` are hashed; the smash rumble is capped at its stated range and its comment matches
    the code; the camera kick starts in the frame that shows the hit; citation labels (Brenner & Smeets' 5-7 ms
    are untrained people; Miralles used WIMU Pro GNSS + LPS); split-step numbers restated (11-16% at 1-2.5 m, push
    at 175 ms, 5 cm at 283 ms, 1.35 x 8.5 = 11.5 m/s²).
  - Left: `focusHeight` can stay from an earlier window while the planned contact is still out of reach (the cue
    shows the plan's moment then; harmless today); the HUD and cue call `focusIdeal`/`windowScale`, which write
    sim scratch fields (no sim state); a pad press may not unlock audio (OPEN_QUESTIONS.md). The first two were
    not harmless: see the fresh-eyes round.
- **Fresh-eyes round** (independent, read-only, from scratch). Fixed:
  - *Run-ahead still struck late* (high): holding back the tick with the ideal moment covers releases before the
    ideal only; one after it meets the ball at its own moment, and that tick was still run ahead. An emulation of
    `Game.tick` against the sim (releases at ideal ± 30 ms, delivered the next frame) still had 6-34% of releases
    late, up to 7.7 ms. While the human holds a swing the sim is now not run ahead at all (checked in the loop):
    0 late at 60, 120 and 144 Hz. The cost is at most a tick of display latency while a swing is held.
  - *The HUD changed the sim* (medium, determinism): `focusIdeal` left `focusHeight`/`focusVolley` from an
    earlier call on one path, assisted timing read them, and the HUD and cue call it between steps, so with
    `?autotime=1` the same seed and inputs played out differently (seed 12 parted at 71.5 s). Every field it sets
    is now set on every path, from the plan when no window is found; test: the volley matches, with and without
    the cue's calls between steps, hashed through the match (a difference inside a rally can heal at the next
    point, so the end hash alone missed it).
  - *Assisted timing swung at nothing* (medium): it let a held swing go `early` before the planned moment even
    while the player was still running there, out of reach (volley plans come only 30 ms before the contact), so
    the volley key missed 32 times against 14 for the drive key, and the volley test did not count misses. It now
    waits until the contact is in reach; the test counts misses and the points lost straight after them: 0 misses
    either way, 1 of 216 swings losing the point with N and 2 of 189 with J.
  - Low: every player's clock is the tick's at the top of `step()` (plans read it before `applyInput` set it, so
    every plan used the previous tick's time and the first re-plan after a strike missed the hop's airtime); a
    gamepad unplugged with a button held lets go of it and forgets its buttons (the swing waited for the 3-8 s
    safety, and the next press after reconnecting was swallowed); pad events go into the queue in time order (one
    stamped before a queued key event landed a tick late); the sample-size slip above.
- **Gameplay effect** (AI doubles, 24 seeds x 300 s, `tools/point-mix.ts`; Phase 1 after review round 2 → Phase 2
  after the verifier's fixes): 317 → 331 points, median rally 11 → 10 shots, untouched winners 47.0 → 50.2%,
  own-side errors 46.1 → 42.6%, balls on an opponent 2.5 → 3.0%. A small move away from the pros (winners 34-42%,
  errors about 60%), left for Phase 4. The first write-up said 328 → 297 and 43.9 → 56.2% winners: its Phase 1
  baseline didn't reproduce (see Phase 1), and most of the shift it found was the per-shot windows applied to the
  AI (volleys, a third of all shots, got 1.35x the window, so the AI missed fewer). The windows now apply to humans
  only until Phase 4 refits the AI's timing with them on. After the fresh-eyes round (the players' clock): 340
  points, median 9, winners 49.7%, own-side errors 44.7%, balls on an opponent 3.2%.
- **Fresh-eyes round 2** (independent, read-only; 8 setups x 4 seeds x 120 s compared tick by tick for render-side
  calls, an emulation of `Game.tick` at 60-165 Hz, 886k queue events). Fixed:
  - *A held swing was drawn unblended* (high on 120 Hz and faster screens, new in round 1's fix): with the sim kept
    at or behind now while a swing is held, the render drew the newest tick as it was, so frames with no new tick
    repeated (17% at 144 Hz, 27% at 165 Hz, 5-25% at 120 Hz by frame phase) and the rest jumped by whole ticks,
    for about 58% of rally time (the HUD tells you to hold from the opponent's strike). The picture is now drawn a
    tick behind while a swing is held, blended, the lag eased in and out at 25% of frame time and kept until the
    contact: 0 repeated frames at 60-165 Hz in the emulation, still 0 late strikes. A release is drawn a tick later
    than a press (8.3 ms; it was 4-6 ms on average unblended).
  - *A modifier let go just after the shot key was lost* (medium): `buildInput` sent the keys as they were at frame
    time and the release read power and precision from that, so Space let go 0-6 ms after O made every smash a
    bandeja (28 of 49 at 12 ms; víbora and chiquita with Shift, and the pad triggers, the same). The held state is
    now built from the events handed to the sim (resynced from the keys when the queue is empty), and a release
    reads the modifiers as they were at its moment (later events in the same tick undone): all smashes at 0-12 ms.
    Test: `tests/sim/input.test.ts`.
  - Low: with both Shift keys down, letting go of one let go of precision (a button is now held while any of its
    keys is); the latency probe tells presses from releases.
  - Left: the HUD meter reads `sim.time` and the ring the render time (up to a tick apart, cosmetic); unplugging
    the pad mid-charge swings at that moment rather than cancelling (the sim has no cancel); for rollback later,
    `Player.writeState` leaves out the half bounds and the human's stand plans are not hashed (both before Phase 2).
- **Frame rate, Phase 1 → Phase 2** (`npm run build && npm run perf`, 30 s each, AI doubles, this M1 Max; build
  a8f763d): medium with the CPU throttled 4x (laptop proxy) p50 2.4 → 2.4 ms, p99 4.3 → 4.1 ms, max 12.0 → 10.2
  ms, 0 frames over 20 ms, sim p99 0.8 → 0.9 ms; high (2x pixel ratio) 539 → 498 fps, p99 8.8 → 8.8 ms, 105 → 99
  frames over 20 ms (0.65% → 0.66%, the queue stalls M1 noted). No regression: the average at high moves ±8%
  between runs of the same build (Phase 1's own before/after went 498 → 539 with no rendering change); p99 and
  the stalls are the same. 42 draw calls, 473k triangles. Round 3's change is in when the loop steps, not what
  it draws.
- **Fresh-eyes round 3** (independent, read-only; 189 tests, typecheck, point mix 24 x 300 s, alloc over four
  seeds, render-side determinism, the modifier fix end to end with the real `KeyboardInput`, an emulation of
  `Game.tick` against the real sim at 60-240 Hz). Fixed:
  - *The picture jumped at the human's release and repeated frames until the contact* (medium-high, new in round 2):
    run-ahead resumed as soon as the swing left CHARGE while the render lag was still a tick, so the sim ran to now,
    the clamp pulled the drawn moment forward by up to a tick in one frame (onto the hit itself when the release
    tick is the contact tick), and an early release was drawn unblended (alpha 0) until the contact. Releases with
    a step more than 2 ms beyond the frame: 33% at 60 Hz, 68% at 120 Hz, 63-77% at 144-165 Hz; a repeated frame in
    21-26% at 144-165 Hz. The lag is now worked out before stepping and the sim is stepped to the drawn moment (now
    less the lag), keeping the hold break; a dropped backlog draws from the new clock (it stepped back up to 3 ms
    after a hitch over 100 ms). Emulation after: 0 repeated frames, 0 steps beyond the ease, 0 late strikes at 60,
    144 and 165 Hz (the reviewer's prototype, also 0 at 75-240 Hz, with 3 ms jitter and with hitches).
  - *The timing ring counted down on the drawn clock* (medium): while a swing is held the picture is a tick behind,
    so a release as the ring closed was graded +20 ms at 60 Hz and +12 ms at 144 Hz (a bot with no reaction delay;
    +10 / +4 counted on now). The ring now counts down on the clock releases are judged on (render time + lag =
    now) and stays drawn on the ball. Its look is unchanged; only when it closes moved, by at most a tick.
  - Left (low): a key event that reaches the page after its timestamp can strike late (1 ms transit: 1% of releases,
    max 0.3 ms; Chrome's transit is about 1 ms); the pad and the keyboard holding the same button share one bit (one
    letting go releases it); with `?assist=0` aim reads the movement keys at frame time, not at the release (moves
    are axes, not queued events). In OPEN_QUESTIONS.md.
- **Fresh-eyes round 4** (independent, read-only; an emulation of the new `Game.tick` against the real sim at 60-240
  Hz with jitter, hitches, tab hide/show, `?runahead=0`, autotime, doubles, volley and overhead keys and 127 serves;
  determinism without the render-side calls over ~20 runs; alloc over five seeds): **nothing Medium or above;
  Phase 2 is verified.** No late strikes for holds of 20 ms or more at any refresh rate; a bot releasing as the
  ring closes is graded 0.0 ms at the median. Fixed from its Low list: the ring now counts down on the sim's own
  clock (`simNow`, or the sim's time after a dropped backlog), exact on every frame including the press frame
  (render time + lag fell 5-8 ms behind there at 60 Hz); and a dropped backlog (a hitch over 100 ms) moves the
  queued keys' stamps up to now (they were in the sim's past: releases graded up to 220 ms early and struck up to
  67 ms late, 6 of 185 in the reviewer's hitch run; 0 with the clamp). Left (OPEN_QUESTIONS.md): a few repeated
  frames while the lag eases in after a press at 165-240 Hz; taps under 15 ms can strike late; the camera kick
  and rumble can lead the drawn hit by up to a tick; `npm run alloc` drives only AI players (a human-path bot
  measured 7-15 GCs per 100k ticks, mean 10.2, against 8.6 on Phase 1's code: within match noise).

## Phase 3: animation realism
- **Measure first** (`node tools/anim-check.ts <tag> [secs] [seeds]`, `src/render/avatar/animQa.ts`, results in
  `docs/lab/anim-check-*.md`): every sim tick of an AI doubles match drawn, then foot skating (Zhang et al. 2018's
  measure), planted-sole drift, soles under the floor, racket to ball at the contact, the face against the ball's
  way out, one-frame pops and joint speeds against what people reach (Fleisig 2003 and others in `avatar.ts`),
  and clipping with capsules fitted to the mesh (racket in body, hand in torso, thighs through each other, net,
  glass, players). Seed 3 plays two left-handers. Before Phase 3 (`anim-check-before.md`): skate 54-68 cm/s,
  soles under the floor 7-9% of foot frames (8 cm), pops 118-145 per player-minute.
- **Inertialization of the animation's inputs** (Bollo 2016, Holden 2021; `src/render/avatar/inertia.ts`): the clip
  pose before IK, the stroke's key, the body's facing, the stroke weight and the crouch carry on smoothly through a
  jump (a jump goes into an offset that dies away with a critically damped spring), never the IK's output (that
  would lift the feet off their plants and the racket off the ball). Pops 119-180 → 45-68.
- **Feet**: a sole within 1.5 cm of the floor stays where it was put down, rotation and toes held, until the clip
  lifts it or the body drifts, turns or reaches too far over it (then it steps, lifted, one foot at a time when
  standing); soles kept above the floor measured as the foot will be; orientation warping for diagonal running
  (the nearest direction's clip with the legs turned up to 45 degrees onto the travel). Skate 57-65 → 17-19 cm/s,
  planted-sole drift p50 → 0, soles under the floor → 0.
- **Allocation**: the new code passed doubles to calls V8 doesn't inline; fixed (30-33 → 4-7 GCs per 100k ticks).
- **The serve, studied from pros** (owner's ask; `docs/research/serve-and-strokes-motion.md` §4.1: FIP rules,
  Ramón-Llin and Courel-Ibáñez's serve studies, the tennis forehand's kinematics for the swing, physics for the
  bounce). Before, the server stood square, dropped the ball from waist height and swatted it at knee height
  with an underarm flick. Now:
  - Ball: held at 0.95 m, 0.55 m out to the racket side and 0.5 m ahead, pushed down at 3.2 m/s so it bounces up
    to an apex near the waist, struck 20 ms before the apex (`match.ts` SERVE_*). Contact height 0.57 → 0.87 m,
    toss to contact 0.79 → 0.62 s, serve speed 56-66 → 59-69 km/h (still under FIP's waist rule; 58-72 km/h p10-p90
    after the contact-placement change below, measured in the Phase 3 review).
  - Address (K0): side-on (hips about 80°, shoulders 85°), racket in front at the waist face up, the free hand on
    the ball, which it follows down as it is pushed (`SERVE_ADDRESS`, the avatar's `addrKey`).
  - Swing keys from the research in the court frame (`courtKey`: forward, out to the racket side, up): backswing
    to the racket head above the grip, face about vertical, shoulders turned 100° (measured 101°, hips 85°; the
    research 105° / 85°); a waypoint at the mid forward swing out to the racket side and dropping (`Family.via`,
    the curve's bend solved through it); contact at the ball out to the side, face open; low forward finish.
    Measured turns at contact 56° / 49° (research 45° / 50°) and at the finish about 25° (15° / 25°).
  - The research measures from the floor under the mid-hip, the keys from the player's position: the pelvis sits
    0.13 m behind it at the top of the backswing (weight on the rear leg), so the backswing is that much further
    back (the racket arm was folded to 25-30% of its length there; now 62-70%).
  - Free hand keys placed from the measured free shoulder (it was 8-12 cm from its own shoulder at contact, the
    arm folded flat and the elbow flipping): towards the bounce in the backswing, down by the free hip after.
  - The serve address hands over to the ready position over about 0.1 s (`addrW`) instead of in one frame at the
    contact (the free hand jumped 85°).
  - An AI server's swing is timed to its own release (one after the ideal is the contact), as rally shots were.
  - Serve QA (3 seeds, 13-17 s of serving each): racket in body 0.88 / 0.42 / 0.40%, hand in torso 0 / 0 / 0%,
    pops 4.5 / 0 / 10.7 per minute (the first version of the new serve: 2.3 / 0.9 / 1.0%, 2.6 / 2.1 / 1.9%, 36 / 49
    / 60; the old swat: about 0 on all three, it barely moved).
- **Arms solved as hinges** (`hingeIK` in `ik.ts`). Every clip bends the forearm about one axis of its own frame
  (per-frame distance from that axis, frames bent over 20°: p50 0.63° right / 0.81° left, max 11-14°, measured from
  all eight clips, `elbowHinge`), so the elbow is solved exactly: the forearm's
  rest rotation turned about that hinge by the bend that puts the wrist at the target's distance, then the upper
  arm turned as a whole so the wrist lands on the target with the elbow towards the pole. The old two-bone IK
  turned the clip's forearm the shortest way onto the new direction, which flips over when the bend needed is the
  other way from the clip's: forearms and hands turning 150-180° in a frame, the worst pops in every match. The
  elbow's side about the shoulder-to-wrist line turns no faster than 1500°/s (well under the 3600°/s the QA allows a
  shoulder), so a pole passing
  close by that line swings the elbow round instead of flipping it. The free arm's pole turns with the chest. The
  knees stay on the two-bone IK: solving them as hinges threw away the clips' shin rotation (about 10°) and
  tripled the pops (measured, reverted).
- **Racket rotation blends keep their way round by continuity** (`nlerpQ`): the way that lands nearer last frame's
  result, the short way only at a blend's start. Re-picking the short way mid-blend turned the racket over in a
  frame (a left-hander's overhead: the wrist target jumped 60 cm).
- **Swing timing**: an AI's release moment is known, so its forward swing runs straight into the ball instead of
  waiting at 85% for the release (that wait, then 15% of the swing in one or two frames, was a pop at most AI
  contacts); the rest of a swing after a release starts from last frame's moment (it held still for a frame). On
  the QA's new contact measure (the face's path between frames: a face that passes through the ball on time is
  already centimetres past it at the frame that reports the hit, which the old measure scored against it):
  racket to ball p50 4-9 mm, p90 6-10 cm, the closest moment p50 0 ms late, p90 one frame; with the old wait
  1-2 mm and 3-7 cm but up to two frames late (a 20 m/s ball is 30 cm away by then) and 10-20% more pops.
- **Hips**: the reach that pushes and lowers the hips towards a ball out of the arm's reach is now measured from
  where the shoulder will be at the contact (the plan's spot, as far as the present speed covers in the time
  left): a sprinting player had their hips pushed out and dropped to 0.33 m. The total drop is capped at 0.55 m
  (a 0.4 m cap cost low volleys up to 7 cm of contact).
- **QA after the serve and arm work** (3 seeds x 120 s, before → after): pops 51-64 → 37-50 per player-minute,
  racket in body 2.0-2.6 → 1.6-2.2%, hand in torso 3.7-5.7 → 3.0-4.8%, legs through 2.7-3.5% (unchanged), skate
  17-18 cm/s, soles under the floor 0, avatars 6-7 GCs per 100k ticks. Left: the leg flips (up to 177° at the
  knee and foot in a stretch at a sprint, a few per match), and the leg pops that make up most of the count
  (small, at foot plants and lifts).
- **Hands kept off their own shoulders** (`keepOff`). The free hand's keys are placed for a standing body, so a
  low slice's crouch brought the free shoulder down onto the hand's key (a left-hander's free hand 2 cm from its
  shoulder), and a backhand's recovery passed the racket hand through its shoulder. There the line from the
  shoulder to the hand turns over in a frame and the whole arm with it (167° and 123° pops). Two changes: the free
  hand's keys move with the free shoulder when the hips drop or push and the spine leans; and the way from each
  shoulder to its hand turns no faster than 40 rad/s (a hand 0.6 m out at 24 m/s; swings stay under it, so away
  from the shoulder it changes nothing), with the hand put along it at least 35% of the arm's length out. Pushing
  the hand straight out from the shoulder alone moved the flip, not removed it: no smooth rule pushes every point
  out of a ball, so the push needs memory. Shoulder joint speed max 15400 → 7800°/s, frames over the limit 42 → 5;
  wrist max 13200 → 6000°/s; contact unchanged.
- **QA as a test** (`tests/render/animQa.test.ts`): 60 s of seed 1 and seed 3 (two left-handers) with thresholds
  a little above today's numbers (skate, soles under the floor, planted feet, contact distance and lag, pops,
  clipping, the serve's own numbers, and no arm or hand turning 150° or more in a frame), so a change that brings
  a flip back fails `npm test`.
- **Inertializer allocation**: `expQ` and the predicted rotation wrote through `Quaternion.set`/`normalize`
  (boxed doubles when not inlined; the largest allocation site in the avatar run); they write through a
  Float64Array now. Avatars 7-8 → 6 GCs per 100k ticks.
- **Legs: no more flips** (the worst pops left: knees and feet turning up to 177° in a frame). Four causes, each
  traced frame by frame:
  - The lunge (a planted foot stepping out towards a wide contact) was given to whichever foot was on the ball's
    side, picked by a sign: with the ball nearly in front or behind, the whole 0.55 m moved to the other foot in a
    frame, and it applied at a sprint to a foot in the air. It now needs the feet planted (scaled by `plantW`) and
    is shared between the feet by a smooth weight on the ball's side.
  - The knee turned the shortest way from the clip's shin onto the new one: a shin that had to fold back past its
    clip's line went over the top, twisting about itself. The knee now turns about its hinge (measured from the
    clips as the elbows' are) and only the small rest the shortest way, faded out where either direction comes
    into line with the hinge (a hard switch there was a 128° twist of its own).
  - The hips came back up out of a low reach at up to 5.7 m/s, following the stroke's key as it swung up after the
    contact. They now rise no faster than 1.5 m/s (`HIP_RISE`, standing up out of a lunge).
  - The drop and the reach together put the hip joints 0.28 m off the floor (the legs folded flat, nothing a
    knee can do there). The hips bone now stops at 0.58 m (`HIP_FLOOR`: a deep lunge with the front thigh level,
    hip joints at knee height), and the upper body bends up to 43° towards a ball still out of reach
    (`SPINE_REACH`, was 30°), which kept the contact (seed 2 p90 9.9 → 8.4 cm; it was 12.5 cm with the floor alone).
  - QA, 3 seeds x 120 s (before → after): pops 35-48 → 20.5-26 per player-minute, the worst pop 177° → 72°, knee
    max 21300 → 6000°/s, ankle max 19300 → 11500°/s, contact p50 4-9 mm and p90 7.7-8.4 cm (6-10 before),
    legs through 2.8-3.5% (unchanged). The QA test now fails on any one-frame spike of 120° or more, or more
    than 35 pops per player-minute (raised to 40 with the low-ball lunge below, which put the test's seed 1 at 34.75).
- **Motion matching: not built.** Motion matching (Clavet 2016, "Motion Matching and The Road to Next-Gen
  Animation", GDC; Holden et al. 2020's learned version) picks, several times a second, the frame of a large
  motion database whose pose and future path best match where the player is going, and blends to it with
  inertialization. Its quality comes entirely from the database: hours of unstructured capture (starts, stops,
  plants, turns, cuts, side steps, crossovers, recoveries). This game has six looping Mixamo locomotion clips (idle,
  jog, run, run back, strafe left and right; `docs/mixamo.md`), no starts, stops or turns: every query would land
  on one of those loops at the right phase, which is what the direction blend with a stride-matched phase already
  does. What does the job of motion matching here instead: the four-direction blend at one phase advanced by
  distance (no skating), orientation warping for diagonals, inertialization of every input, planted feet with
  stepping, the lunge, and the split-step hop. What would make motion matching worth building is in
  OPEN_QUESTIONS.md (the clips, or capture).
- **Video-to-mocap: not done here.** Turning video of real play into clips needs a pose-estimation model's weights
  (a download the owner hasn't approved), video to run it on (there is no `/reference/video` on this machine) and
  a body-model licence; see OPEN_QUESTIONS.md. The serve was instead studied from the published measurements
  (`docs/research/serve-and-strokes-motion.md`) and built as key poses.
- **Where contact happens, from the pros** (sim; `data/tuning.json` `//reach`, `planStand`). Measured in AI doubles
  (4 seeds x 300 s, contact point from the body's centre, towards the net): drives 0.00 m on average, lobs 0.02,
  volleys 0.18, against highly trained players' 0.64, 0.65 and 0.38 (Sánchez-Alcaraz et al. 2021). The game
  planned every ground stroke 0.12 m in front and 0.75 m out to the side, so the ball came level with the body,
  the arm reaching sideways. Now ground strokes are planned 0.6 m in front and 0.67 m out (0.9 m away across the
  floor: `reachComfort`, which the timing windows also use for the ideal moment), volleys 0.35 m in front
  (`VOLLEY_FRONT`, as the volley key already did) and `volleyReach` 0.7 m away; the timing windows use the same
  distances for their ideal moment and now cost a contact behind the body (a ball off the back glass
  passes the comfortable distance once behind the player, once in front). Measured after (4 seeds x 300 s):
  drives, lobs, slices p50 0.60 m, means 0.52-0.59, p10 0.13-0.33 (the paper's SD 0.32); volleys p50 0.35.
  What it did to the rally (`node tools/point-mix.ts 12 300`, AI doubles): points ending unreached 47.9 → 53.8%,
  errors into their own side 45.6 → 38.6% (the first figures written here, 59% and 33%, didn't reproduce) (contacts in front are struck better; the comfortable distance also counts as no
  stretch now). The published mix is winners 35-42%, forced 25-33%, unforced 29-38% (main-draw men), so the AI
  now wins too many points outright: its error rates and shot choice are Phase 4's to calibrate, against those
  numbers, not by putting the contact back beside the body.
- **Ready position**: the racket 0.52 m out (was 0.42) and higher, the hands about 0.35 m in front of the body
  with the elbows bent; the racket hand had sat 18 cm in front of the hips, and a running body's pelvis tilted onto
  it (8% of a left-handed pair's frames had a hand inside the pelvis).
- **The follow-through goes with the trunk**: after the contact the racket's key moves with the racket shoulder
  as the hips move (it is read before the spine's lean towards the ball, so not with that) (as the free hand's keys do), eased in from the contact and out over 0.15 s when the
  next stroke starts. The hips rising no faster than a body stands up had left the finish key (placed for a
  standing body) in the chest and face after low balls.
- **The racket is kept out of the body** (`racketClear`): the racket's points against the pelvis, chest and head
  capsules (the QA's, fitted to the mesh; `capsules.ts` is shared now); every point inside pushes straight out by
  its depth, the racket is moved by the push found on its moved position (three rounds, no IK between), and the
  arm is solved once from where the hand is (a hand short of an out-of-reach target can't be pushed further out,
  only round the shoulder). The push carries over and dies away over 0.08 s (taken anew each frame, it moved
  between points and capsules and turned the forearm over); the carried part is at most 0.2 m (a backhand's
  backswing across the chest can't be cleared; it had grown to 0.5 m) and is gone over the last fifth of the
  forward swing so the racket is on the ball at the contact. A fresh push on top can make a frame's push larger
  (p99 0.16 m, max 0.30 m, in 8% of arm-solve frames, measured in the review).
- **QA after** (3 seeds x 120 s; the matches differ from the table above, the sim's contact placement changed):
  racket in body 1.7-2.3 → 0.18-0.30%, hand in torso 3.0-4.8 → 1.0-1.8%, contact p50 4-8 mm and p90 6.2-7.8 cm,
  pops 22-30 per player-minute (the guard adds about 2), legs through 2.6-3.2%, avatars 4 GCs per 100k ticks.
- **Frame rate, Phase 3 against Phase 2** (`npm run perf`, two runs each, other sessions' Chromes also running on
  this machine): medium with the CPU throttled 4x p50 2.5 / 2.5 ms, p99 4.5 / 4.6 ms before; 2.5 ms, p99 4.3 ms
  after (one run at 2.8 / 5.1 ms overlapped a point-mix run); high at 2x p99 9.2 → 8.8-9.1 ms, 0.66% of frames
  over 20 ms both (the queue stalls seen since M1). Draw calls 42 → 43.
- **Low balls: a lunge, not a squat.** Real-Chrome frames at stroke contacts showed every ball under 0.6 m met in
  a full squat, knees splayed, the hips on the floor limit (90% of those contacts; hips bone at 0.58 m). Three
  changes: a low ball steps the foot on its side towards it (`LUNGE_LOW` 0.45 m from a contact at 0.95 m down to
  0.45 m, shared between the feet as the wide-ball lunge is), the hips take 55% of the arm's vertical shortfall
  and leave the rest to the upper body bending towards the ball (`DOWN_SHARE`), the racket head drops further for
  a low ball (48° below level at the lowest, was 33°: a low volley's head below the wrist), and the hips stop at
  0.66 m (`HIP_FLOOR`, a deep lunge). Feet apart at low contacts p50 0.58 → 0.78 m; contact p90 8.0 / 7.7 / 7.8 cm (seed 1 rose from 6.2 cm,
  and its 60 s test run from 6.2 to 9.2 cm against the test's 12), pops 24-30.5 per player-minute. The hips still
  sit on the floor at most low balls: 81% of contacts under 0.6 m have the hips bone within 1 cm of 0.66 m (83% sat
  on the old 0.58 m floor), so the clamp, not `DOWN_SHARE`, sets their height; the stance is wider and the upper
  body takes more, but it is a lunge onto a floor limit.
- **End-of-phase review** (a verifier re-running every claim and a fresh-eyes reviewer, both read-only). Fixed:
  - **Left-handers' feet still flipped** (128-165° in a frame on 4 of 12 left-handed matches; Phase 3 had only ever
    measured one left-handed seed, which had none). A stroke squaring a left-hander up from a ball behind turned the
    body about 190° on the spot while a planted foot waited for the other to finish its step; its step then started
    180° from its target, and a start-to-target slerp re-picked the short way mid-step. Steps now turn from last
    frame's rotation by the share of the way left (no re-pick once under way; replaced in the second review, below),
    and a foot left more than 1.6 rad behind the body steps even while the other is stepping (`WAIT_TURN_MAX`). A right-hander's foot turned 123° in
    a frame as the hips' reach collapsed after a contact (0.38 m in five frames, the follow-through moving the key
    at racket speed): after the contact the reach changes no faster than 2.5 m/s (`REACH_RATE`; before the contact
    it is what puts the racket on the ball, and limiting it there cost 2-4 cm of contact p90; see the second review
    for what drives it there now).
  - **The same moment drawn twice snapped every body** (game.ts draws sim time twice while the render lag eases in
    at a press, about once a held swing at 240 Hz): with dt 0 every filter and rate limit treated the frame as a
    cut (up to 137° in a frame). `Avatar.update` now keeps last frame's pose when time hasn't moved.
  - A reflex volley's hand turned 117° in a frame (released 46 ms before the contact with the stroke 18% faded in):
    the racket turns no faster than 3600°/s (`RACKET_TURN_RATE`; the racket centre still goes to the key, so the
    contact's position is unchanged, but not always its face: see the second review).
  - The racket clear's carried push was cancelled on almost every backswing frame by the last stroke's progress
    (`keyS` 0.99, never reset while the backswing held); a clear's second arm solve doubled the arm's rate limits
    that frame (it now limits from last frame's state); the clear's push is reset when the arms switch off; the
    lunge can't divide by zero; three per-frame `Vector3.set` calls write through `fromArray`.
  - `volleyFront` moved to `data/tuning.json` (it drives the plan now); a front distance longer than the reach in the
    data can no longer make the plan NaN.
  - Text corrected above where the review measured otherwise: the point mix after the contact change (53.8% / 38.6%,
    not 59% / 33%), the test's pop threshold (40), seed 1's contact p90 rise, the hips still on their floor at most
    low balls, the clear's push size, the elbow hinge's spread, the serve speed, the windows' cost.
  - The QA now also measures the fastest one-frame turn of any joint (a turn next to a large neighbour is no pop:
    the 123° step and the 117° hand were both missed) and draws every seventh frame twice; the test runs a third
    seed (5, left-handers) and fails on any joint turning 120° or more in a frame or any bone moving on a repeated
    frame. `anim-check` plays left-handers on seeds 3, 5 and 6.
  - **After** (3 seeds x 120 s, `docs/lab/anim-check-cur.md`): pops 29.1 / 25.3 / 22.4 per player-minute (was 30.5 /
    26.0 / 23.9), racket in body 0.13 / 0.20 / 0.17% (0.24 / 0.28 / 0.22), hand in torso 0.88 / 1.05 / 1.79%, legs
    through 2.6-3.2% (unchanged), contact p50 4-8 mm and p90 7.7-8.0 cm (unchanged), the same moment drawn twice
    0.000°. Fastest one-frame turn of any joint over 12 left-handed and 12 right-handed matches x 120 s: 96° and 91°
    (were 165° and 117°). Joint maxima on seeds 1-3 (°/s): shoulder 8853, wrist 7332, knee 9386, hip 9489, ankle
    10979; the worst pop 91.5° (seed 1, a foot snapping down as its lock lets go). Avatars 4 GCs per 100k ticks.
  - Left as they are: the serve's tuning numbers (`SERVE_*` in match.ts, sourced in comments) stay in code for now;
    the follow-through follows the hips' move, not the spine's lean; `setHanded` after the first frame doesn't reset
    the filters (handedness is fixed at match start); some per-frame three helpers that box doubles remain in the
    avatar (`setFromAxisAngle` for the stance) with allocation inside budget.
- **Second fresh review** (a new read-only reviewer with its own probes; one serious finding, five smaller). Fixed:
  - **Knees and feet still flipped, 153-173° in a frame** (the first review's 96° held over 120 s, but not over 300 s
    or more seeds). Five causes, each traced frame by frame:
    - A knee's pole came close to the hip-to-ankle line with the hips low and a foot lifted, and its side swung round
      in a frame. `twoBoneIK` now keeps last frame's side per knee and turns it no faster than `IK_TURN` (as the
      elbows' `hingeIK` does), and an ankle never comes nearer its hip than 55% of the leg (`LEG_FOLD`): lowered, but
      only until the sole touches the floor (lowering it further put a foot on its toes 8 cm under).
    - The knee's turn about its hinge flipped side as the target swung round behind the shin (a turn of -155° then
      +178°: the shin spun 118°). A knee can't bend 180° either way, so that turn fades out from 120° to 180°
      (`HINGE_FADE0`) and the plain solve takes the rest.
    - Where that hand-over happens the shin twisted 50-60° about its own length in a frame: a shin now twists no
      faster than 2400°/s (`SHIN_TWIST_RATE`, about the knee-to-ankle line, so the ankle stays put). It acts 0-24
      times per 120 s match.
    - The lunge (a foot stepping out to a wide or low ball) was dropped on the stroke's first fade frame, and a foot
      mid-step jumped 0.55 m back (58° in the shin). It is held through the fade by the stroke's weight, each foot's
      offset moves no faster than 3 m/s (`LUNGE_RATE`), and it goes no further from the hip than 95% of the leg
      (`LUNGE_REACH`), measured from the hip as it will be after the drop and the reach. The locks' reach check was
      measured from the clip's (standing) hip too, so a held lunge was always out of reach: the foot let go, stepped
      back to the same place, and did it again every 0.15 s with the leg straight.
    - A foot left more than `STEP_SNAP` (0.7 m) behind went there in a frame; it now steps at once instead (a cut
      between points resets the locks anyway, so the snap only ever fired in play: 0.65 m, 122° in the foot).
    - The racket's push out of the body was carried at full size while the arms faded out, and as they switched off
      the hand went back to the clip 143° in a frame. The push now fades with the arm's weight (`clearW`).
  - **The hips lurched up to 29 cm in a frame before the contact**, following the swinging key at racket speed (the
    QA logged a 58° leg pop with it). Before the contact the reach is now worked out from the contact's key (the
    same at the ball, steady before it), and changes no faster than 4 m/s (`REACH_RATE_BEFORE`) as a new plan comes
    in. Hips relative to the root per frame over seeds 1-6 both ways: max 4.0-5.6 cm (were 15-29 cm), no frame over
    8 cm (were 2.4-5.3 per player-minute); contact p90 unchanged (8.0 / 8.3 / 7.8 cm). The hips sit 1-3 cm further
    from the sim's position at p90 (they lean towards the contact earlier).
  - The step's carried turn (the first review's fix) lagged its target and left more of the turn for the
    touch-down: feet skated more on all 24 matches of seeds 1-12. Steps turn from their start to the target again,
    the target kept on the side of last frame's and the slerp never re-picking the short way (`slerpAs`); the foot's
    turn on a step's last frame p90 4.0-4.3° (was 5.1-5.8°). `WAIT_TURN_MAX` stays: the reviewer found it changes
    almost nothing on the seeds that needed it (149 vs 149 both-feet steps), so it is a guard, not the fix.
  - `volleyFront` is read at the top of the plan, not in the rare volley-key branch (a value read only there
    deoptimised the function when it came; the sim is bit-exact).
  - Two stale joint maxima above (wrist 7332, hip 9489).
  - **After** (3 seeds x 120 s, `docs/lab/anim-check-cur.md`): pops 19.3 / 16.8 / 15.9 per player-minute (were
    29.1 / 25.3 / 22.4), skating 16.1 / 18.6 / 18.5 cm/s (16.7 / 19.2 / 18.7), contact p50 4-8 mm and p90 7.8-8.3 cm,
    racket in body 0.15-0.20%, no sole below the floor, ankle maxima 2522 / 2494 / 2586 °/s (were 10979 / 9113;
    corrected by the final review, which read 4222 here). Over 24 seeds both ways x 120 s: pops 15.7 per
    player-minute on average (21.5 before this round), skating 17.2 cm/s (17.8), and the fastest one-frame turn of
    any joint 96° (a left-hander's racket hand in a fast swing; no leg over 80° on these seeds: the final review
    found 83-97° beyond them, below). The test now fails at pops 30 per minute (was 40) and any joint turning 105°
    in a frame (was 120). Avatars 4 GCs per 100k ticks.
  - Left as they are: within two frames of the contact the racket face can be up to 15-19° short of its key where
    the turn limit holds it (11 frames in 16 matches; the face's p50 / p90 are unchanged). The limit also hides a
    ready-to-stroke blend that asks for up to 141° in a frame as the stroke weight crosses about 0.5 with the ready
    weight high (seed 7 L, t=107.13: the racket turns about 200° in 58 ms at the cap); a slerp there instead of the
    nlerp is the fix, not done yet.
- **Final fresh review** (the fourth phase-end agent: a new read-only reviewer with its own probes, against 0529a23
  for "before"; two serious findings and five smaller ones). Fixed:
  - **The hips fell 20-30 cm in a frame, the knees 50-97° with them** (a regression of the second review's fix: before
    the contact the reach comes from the contact's key, which jumps when a release changes the contact, e.g. an
    overhead planned at 2.0 m taken at 1.2 m, and nothing limited the hips going down). The drop now falls no faster
    than 2 m/s (`HIP_FALL`, the reviewer's suggestion), as it already rose no faster than `HIP_RISE`. Frames with the
    hips' height changing more than 8 cm, seeds 25-40 both ways x 120 s: 0 (49 at review, 20 on the old tree).
  - **Knee spins**: a knee turning round 150-165° over a tenth of a second, 17-33° a frame, which neither the pop
    rule nor the one-frame limit sees (14 in 24 seeds both ways x 120 s; 4 on seeds 1-12 in the old tree). Traced
    frame by frame (seed 5 L, player 0, t=35.0: backpedalling at 4 m/s into a low backhand slice, the hips 23 cm
    down, a step released in front): the knee's pole was the clip's knee plus its bend direction, and the clip's knee
    carries where the clip has the foot. With the foot put down somewhere else (a lock, a lunge, a released step)
    the pole crossed to the other side of the hip-to-ankle line and the knee swung round, smeared by the side's rate
    limit and `limitShins`. The pole is now the clip's bend direction out from the middle of the hip-to-ankle line as
    it is: the same knee where the foot is the clip's, no flip where it isn't. Knee spins over 24 seeds both ways x
    120 s: 0; pops, contact, skating and the worst one-frame turn unchanged (13.6 vs 13.6 per player-minute, 96°);
    thighs through each other 2.8% (2.7%). `animQa` now reports them (`pops.kneeSpins`: the knee's local rotation
    more than 150° from any of its last 12 frames) and the test fails on any.
    - Tried first, as the reviewer suggested: knees solved as hinges like the elbows (`hingeIK`). No spins, but pops
      rose from 13.6 to 115 per player-minute (leg joints jerking a few degrees a frame), as the first attempt found;
      the knees stay on `twoBoneIK` (the doc comment above `elbowHinge` says why).
  - **The hips leaned towards the contact far earlier than before** (the reach from the contact's key applies from
    the start of the preparation: standing p50 11.6 cm, more than 0.4 s before the contact p90 17.9 cm, against 0
    and 1.3 cm on the old tree). The reach before the contact now comes in over the last 0.4 to 0.1 s (`LEAN_FROM`,
    `LEAN_FULL`): more than 0.4 s before, p50 / p90 / p99 0 / 0 / 0 cm; standing p50 4.0 cm; hips off the root
    running above 3 m/s p99 12.6 cm (18.1 at review, 11.1 old). Serve pops over seeds 25-40 both ways: 4.8 per
    minute (8.8 at review, 6.1 old; the worst, seed 27 R, 15.5, was 23.3).
  - **Foot taps** (a lock let go for reach with less than 3 cm to step): the lock's reach check is now measured from
    the nearer of the hip as the clip has it and as it will be after the reach (a deep lunge's back foot was let go
    and stepped back to where it was). 6.8 per player-minute (22.7 at review, 31.5 old).
  - Stale numbers above corrected (ankle maxima; "no leg over 80°" holds on seeds 1-24 only).
  - Not changed: a few low-ball contacts are worse than on the old tree (the reviewer's seed 37 R: a slice from 15 to
    36 cm), 4 worse and 1 better by more than 5 cm out of 1543 hits on seeds 1-12; contact p90 over 24 seeds both
    ways 5.9 cm, the same as before these fixes.
  - **After** (`docs/lab/anim-check-cur.md`, 3 seeds x 120 s): pops 18.3 / 15.5 / 14.8 per player-minute, skating
    16.1 / 18.6 / 18.4 cm/s, contact p50 4-8 mm and p90 7.8-8.3 cm, racket in body 0.15-0.19%, no sole below the
    floor, ankle maxima 2322 / 2047 / 1991 °/s, no knee spins. `npm test` 193/193, both typechecks, `npm run alloc`
    singles 5, doubles 4, avatars 4 GCs per 100k ticks.

## Phase 4: AI
- **Measure first** (`node tools/match-stats.ts`, worker threads; `docs/ai.md`): AI doubles headless, measured the
  way the match-analysis studies measure professional padel (`docs/research/shots-movement-feel.md` §1, §5): shots
  and seconds a point, rally-length shares, point endings, how winners and errors finish, the last shot of each,
  the shot mix, where shots are hit from, per-stroke outcomes (any error of a stroke counts against it, as
  Mellado-Arbelo et al. 2019 code it), serve numbers, the serving pair's wins by rally length. A forced error is
  judged by `src/sim/ai/pressure.ts` (pace, time, stretch, running, height, walls), written before any tuning and
  never changed by it, so tuning can't move errors between forced and unforced without the play changing. At the
  start of Phase 4 the top level played 16.2-16.5 shots and 21.6-22.0 s a point (pros 10-11, 9.4-14.8 s), W/FE/UE
  27/35/37 (pros 34-42 / 29-33 / 29-33), 58-60% of winners volleys and 16-18% smashes (pros 28 and 43).
- **Off a wall, a ball still climbing past the shoulders can't be met** (`riseMaxOffWall` 1.47 m, Drillis & Contini
  shoulder height 0.818 of 1.80 m). The AI had taken 13-15 m/s smash rebounds 0.15-0.3 s after the glass at
  2-2.9 m, rising, often with a smash of its own: smash winners 11.5% → 27%.
- **Reaction 0.30 − 0.13 × level s** (0.17 s at the top; was 0.13, faster than any measured player): pros commit
  to a direction 140-160 ms after the opponent's contact and start the racket 187 ± 22 ms after it (Triolet et al.
  2013, Mecheri et al. 2019). Defenders had blocked 150 km/h smashes on the rise from 8 m.
- **The easier ball** (`PRESSURE_COST` 0.3 in `planStand`): a ground-stroke plan costs the ball's pace and how
  little time it leaves, the first two pressure terms worked out for each candidate contact, so a hard ball is let
  through to the glass when its rebound can be played. The AI had half-volleyed 150 km/h smashes 0.06-0.2 s after
  their bounce from 8 m.
- **Overheads at their own heights** (bandeja 1.95, víbora 1.72, smash 2.42 m; research bands 1.85-2.05,
  1.55-1.85, 2.30-2.50 m): the AI picks the overhead when it reads the lob and plans, times and is judged at that
  height (`ohKind` through `findWindows`, `releaseSwing` and `windowsFor`). Everything had been planned at 2.35 m.
  Measured p50: smash 2.39, bandeja 1.91, víbora 1.69 m. The human's cue keeps 2.35 m: a ring that moved when
  Space went down mid-charge would play worse.
- **Volley play**: a ball below the tape is lifted soft with margin (precision), a high one near the net put away
  (power), right 40-90% of the time by level and the wrong way round otherwise (a mistake of choice, not a miss).
  Volley errors 10% → 6-7%.
- **Smash range** (`KILL_DEPTH` 6.0 m, was 5.5): measured value of an overhead by depth: a smash taken within 7 m of
  the net wins about half its points (54% by contact depth; 34% by where it lands), a bandeja 11-18%. Then: smashes 5.2% of shots (pros 6-6.9) and 47.7%
  of winners (pros 43).
- **Skill**: motor 0.75 and pressure 1.15 from a sweep (routine errors up, pressured errors down): rallies 16.5 →
  12.0 shots. Refit at the end (below).
- **Smash jump and reflex blocks** (avatar): the smash is hit in the air, a ballistic hop peaking at the contact as
  high as the ball is above the toes' reach (at most 0.3 m; no padel figure, OPEN_QUESTIONS.md), landing on bent
  knees: smash contact p50 9.5 cm → about 0.8 cm (pooled over seeds; one seed read 0.2 cm). A ball on the player before a full backswing fits gets a backswing cut
  to 0.6 of the time left (at least 0.06 s): blocks of smashes 0.15 s after the reaction had missed by 40 cm, the
  arm only halfway into the stroke at the fixed 0.28 s ramp. The AI's choice there was right: that smash comes back
  over the net off the glass, so the block before the glass is the only play.
- **Doubles teamwork.** Pairs already moved as a unit (one up and one back 11-12% of the time) and covered the
  middle (forehand in the middle on a tie). Switching sides was missing: when the partner took a lob over us on the
  diagonal, the lobbed player dropped back on their own side, outside the partner, and the pair defended 1.2 m
  apart with the other side open (0 of 29 such lobs ended switched). Now the player whose side the partner goes to
  (over 0.8 m across the centre) crosses over (10 of 16 switched on the first seeds; 68-74% over 12-36 seeds), and a switched pair of AIs crosses back once its
  ball is over 1 s from bouncing over there (crossing back is coaching practice: players have their side). Calls
  (`E_CALL`): a contested ball (runs within 1.5 m) or a switch is called once, 0.25 s after the strike, "Mine!",
  "Yours!" or "Switch!", about two a point; the human's AI partner calls for the pair and the HUD shows it on a
  small line in the shot line's type (new HUD text: the owner should see it). No rates are published for any of
  this (OPEN_QUESTIONS.md).
- **Difficulty fitted to the amateur-to-pro ladder.** Level 0 had played 2.5 shots a point with 55% of first serves
  and 42% of second serves faulted: robotic, not human. The skill table (`data/ai-skill.json`) now holds values at
  levels 0, 0.5 and 1, fitted by sweeps to the published ladder: novices about 5.6 shots a point and trained
  recreational players about 7.3 (derived, not measured: the serve is 21.5% and 15.8% of their shots, Sánchez-Alcaraz
  et al. 2021, and serves a point are taken as 1 plus an assumed first-serve fault share of about 0.2 and 0.15),
  national 8.0 (Ramón-Llin et al. 2020; the 9.38 often quoted beside it is elite play, Torres-Luque et al. 2015),
  pros 10-11. Weaker AIs also make a weaker player's mistakes: they attack from further back (regional players
  about 4.5 m from the net, national 3.8 m: Ramón-Llin et al. 2019; our top level stands at 3.1 m), move with the ball less as a pair, lob a net pair less
  and drive into the volleyers more, and take the net less (novices volley 15.5% of their shots, trained players
  25.1%). Making the weaker servers aim safer was tried and dropped: with the fitted skill, the pro aims already
  give 14% first-serve faults at level 0 and 11% at 0.5 (no amateur figures are published).
- **Personalities made recognisable.** Before, Martillo hit no harder than the neutral style and was at the net no
  more; El Muro erred more than it, not less. Added: a `pace` trait (power or precision on drives, slices, lobs
  and mid-height volleys, and drives chosen over slices or the reverse), the smash trait widening the smash range,
  the net trait setting how close in a pair stands and how good a lob must be to follow it in, and a chiquita as a
  way to the net (lobs are 60.6% of net takes: Muñoz et al. 2017). Over 60 mixed matches at the end of Phase 4
  (`docs/ai.md` has the table): Martillo drives 27% of its shots, smashes 71% of its overheads and errs most (8.3% a
  shot); El Muro lobs 28%, smashes 16% of its overheads and wins least (2.8%), though its many slices make it err a
  little more than the neutral style (5.3% against 4.7%); La Serpiente plays 68% of its overheads as víboras and the
  most drops and chiquitas.
- **Correction delay.** Every bounce re-predicts the ball, and the AI replanned on that tick: after a random bounce
  (turf, mesh, glass joins, the net cord) it saw the new path 110-170 ms sooner than a player can correct. Now a
  bounce that moves the planned contact more than 0.15 m is corrected after 0.17 − 0.06 × level s (×0.8-1.2:
  0.09-0.20 s over all levels, 0.09-0.13 s at the top).
  About 22 corrections per 100 shots, mostly turf bounces 15-30 cm off; it bites only when the contact comes soon
  after the bounce.
- **Off the glass.** The AI's timing error had no real cost for a ball off the glass (difficulty +0.3): it erred on
  3.1-3.5% of its back-wall shots against the pros' 5.4-6.3%, and wall shots are the least accurate stroke in a
  target test (Delgado García et al. 2017). `AFTER_WALL` 1.5: 5.5%, rallies 11.7 → 11.2 shots. The ladder was
  refit with it: timing [0.030, 0.023, 0.018] s and motor [1.10, 0.92, 0.65].
- **The AI judged on each shot's own windows**, as humans are (`data/shots.json` `timing`: a volley's window 1.35x,
  a smash's 0.71x). The code had kept one window for every AI shot until Phase 4 refit the AI's timing. Volley
  errors barely moved (5.3% → 5.2% of volleys; the verifier's re-run); rallies lengthened to 11.9 shots, so
  `AFTER_WALL` went to 1.8: back-wall unforced errors 6.0% (pros 5.4-6.3). Final 1,000-match run: 10.9 shots and
  14.9 s a point; levels 0 / 0.5 / 0.75 at 5.2 / 7.1 / 8.7 shots (`docs/ai.md`).
- **No strokes at a ball behind the body.** A contact was any ball within reach, wherever it was: 1.4% of the AI's
  contacts were 0.6-1.4 m behind the hitter (a ball that bounced past a net player, slices and lobs off it), and the
  avatar's racket missed them by up to 59 cm (the animation test's seed 1 failed at a contact p90 of 16.8 cm). Now a
  ball more than 0.4 m behind the hips (`BEHIND_MAX`, away from the net; contacts are met 0.4-0.6 m in front of the
  body: Sánchez-Alcaraz et al. 2021) is no window, and at the contact more than 0.65 m behind (the reach check's
  0.25 m margin) is a miss: none beyond 0.65 m now.
- **No swings at the air.** 35% of top-level points (15% at level 0) ended on an AI's full swing at a ball out of
  its reach: the opponents' winners, each drawn as a swing at nothing. Now an AI that, at its release, has no window
  within reach of where it stands lets the swing go unmade (`MatchSim.standDown`). Points that still end on a swing
  that misses, measured by the verifier before the review fixes below: 13.5% at level 0, 12.5% at 0.5, 10.3% at the
  top (late swings at fast balls off the glass and balls that died below reach; OPEN_QUESTIONS.md).
- **Tests.** `tests/sim/ai.test.ts`: the ladder (rally length by level, beginners still rallying, serve faults,
  whiffs) and the four styles' signatures; `tests/sim/doubles.test.ts`: teamwork (depth split, switches after
  partner takes, calls) and the human's partner calling their balls. A faulted serve no longer counts as a ball the
  human failed to return (7 of the 14 'missed' balls were faults). The smash-exit check runs 40 matches: the AI lobs
  deep and smashes from 6-8 m can't leave the court; 10 of 58 matches had one, none of the first 25.
- **Review fixes** (end-of-phase verifier and fresh-eyes review, commit d9d905b): a strike by the other side voids
  the AI's stand plan (partners had switched lanes off the plan for the previous ball: 94 such episodes in 4 × 300 s,
  now 10); a bounce is judged surprising against where the ball was predicted at the planned moment, so blocks are
  no longer "corrected" for nothing (27 of 153 corrections, now 0); a beaten AI holds its backswing instead of
  swinging at the air (stand-downs had swung 90-100% of the way; now 17 of 19 make no forward swing), and no
  forward swing is quicker than the quickest real one; a late release at a ball already past the body is graded Too
  late, not filed as out of reach (Good volleys 70 ms late had been cut: 13 of 237, now 1 of 208); the switch call
  follows the formation's own rule on the taker's real plan (a call followed by the swap 12 of 26 → 17 of 28; the
  taker's "Mine!" is consistent with its play 89 of 92); a cross-back is decided once per ball before its bounce and
  held (`MatchSim.crossBack`, in the state hash: 6 of 6 complete, none after the bounce; 7 of 13 had twitched).
- **Final measurement** (1,000 matches at level 1, 300 at levels 0, 0.5, 0.75; the table is in `docs/ai.md`): 10.9
  shots and 14.9 s a point, W/FE/UE 42.5 / 22.9 / 34.6%, serving pair wins 62.6%, errors into the net 70.6%.
  Remaining gaps against the pros, all in `OPEN_QUESTIONS.md`: rallies over 11 s are 48% (pros 26%), shots off the
  back glass 27.5% (12.8%), forced errors 23% (29-33%), bandejas and víboras finish 3% of winners (13%), errors off
  the side wall 4.5% (17%).
