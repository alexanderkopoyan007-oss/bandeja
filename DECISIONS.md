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
  over 20 ms both (the queue stalls seen since M1). Draw calls 42 → 43. After the final review (one run, queued
  behind and overlapping other sessions' Chrome jobs): medium 4x p50 3.0 ms, p99 5.4 ms, 0 frames over 20 ms, 329
  fps; high at 2x p99 9.3 ms, 0.66% over 20 ms (max 56.7 ms), 480 fps; sim p99 1.3 / 0.2 ms; draw calls 42.
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
- **Frame rate, Phase 4 against Phase 3** (`npm run perf`, other sessions' Chromes also running on this machine): the
  AI runs in the sim, which is a small share of a frame. Medium with the CPU throttled 4x p50 2.5 → 2.3 ms, p99 4.3
  → 4.2 ms, max 12.8 ms, 0 frames over 20 ms, sim p99 1.1 ms; high at 2x p99 8.8-9.1 → 8.7 ms, 0.66% of frames over
  20 ms (the queue stalls seen since M1). Draw calls 42, 473k triangles. Alloc: singles 3, doubles 5, avatars 6
  GCs per 100k ticks (budget 10).

## Phase 5: visual realism (photo-match)
- **Photo-match mode** (`?photo=<id>`, `src/game/photoMatch.ts`, `tools/photo-solve.ts`, `reference/photos.json`):
  11 public reference photos (Wikimedia Commons, CC0 / CC BY / CC BY-SA; `reference/SOURCES.md`) of indoor and
  outdoor courts by day and night; the images are kept out of git and out of the build (their list,
  `reference/photos.json`, and `SOURCES.md` are committed). Court points marked by hand give a photo's camera
  (position, yaw, pitch, roll, vertical FOV and one radial distortion term) by Levenberg-Marquardt over many
  starts; so far only arena-wide-2 has marked points and a solved camera (2.4 px RMS; its service lines, which were
  not fitted, land on the photo's). The other ten are compared by eye through the broadcast camera at the photo's
  shape. The game renders through the solved camera with the photo over it: a wipe (drag or [ ]), a blend, the
  photo alone, the game alone (O cycles), and `&lines=1` draws the solve.
- **Arenas** (`data/arenas.json`, `src/render/arena/`, `?arena=stadium|hall|club-day|club-night`, default
  stadium): a stadium with stands on four sides, a seated crowd that sways as rallies grow, generic boards
  ("BANDEJA / PADEL / OPEN", no real event's branding), hall walls, trusses and a lit roof; a covered club hall
  (portal frames, translucent roof, high-bays, daylight past the open sides); an outdoor club by day and under
  floodlights, with neighbour courts beside ours (clubs build in rows). Colours were picked off the photos: the
  stadium's blue turf and red surround off arena-wide-2, the night court off the night photo (turf measured
  180-191 / 207-234 / 135-139 against the photo's 169-195 / 187-217 / 117-128 sRGB).
- **Turf** (`src/render/turf.ts`): sand-filled artificial grass, the most common padel surface: fibre and sand
  detail at two scales, wear where players stand (the service boxes and the back), roll seams 4 m apart, paler
  and dustier at grazing angles (sand shows between the fibres), and the lines painted in the shader.
- **Glass**: what you see through it, plus Fresnel reflection (8% face-on for two faces, rising to grazing) of an
  environment rendered from the arena once at load, box-projected onto the hall or the club's surroundings so
  each wall reflects its own side (a plain lookup made the near glass at night reflect the floodlit court), a
  faint iron green, ball prints (faint felt rings smeared along the skid) and dust at the foot that fade with
  distance. Not reflected: the players and the ball (needs a planar reflection per wall; a Phase 8 preset: not
  built, see Phase 8).
- **Tone mapping**: Khronos PBR Neutral (AgX turned the photos' saturated blues and reds to periwinkle and salmon;
  `?tone=agx|aces` compares).
- **Players dressed** (`src/render/avatar/kit.ts`): the mannequin mesh becomes a padel player in the shader: each
  vertex gets a region from the bone that moves it most and where it sits on that bone (a short-sleeved shirt to
  mid upper arm and over the hips, shorts to mid thigh, socks, shoes with a gum sole and a stripe, a hair cap,
  skin elsewhere); partners wear the same kit, each has their own skin and hair. Collar and sleeve hems in the
  kit's trim colour (side panels were tried and read as blotches). Sweat: wet patches grow from where shirts
  darken first (the middle of the chest, the spine, under the arms, the small of the back) with the match's
  length and the metres run (the two add: soaked after about 40 minutes at the AI's pace; dry at the start), and
  skin turns shinier; the darkening is 30% (42% read as camouflage on the red shirt). Folds: about 2 mm of bump
  fixed to the body (`render/bump.ts`; see the review fixes). Hems lag the body: a point on a
  spring (about 2 Hz, damped against the body's own velocity, so a steady run has no lag) chases the hips, and the
  shirt from the chest down and the shorts' legs trail by its offset, at most 5 cm.
- **Ball** (`src/render/ballLook.ts`): optic-yellow felt with sheen and fuzz, the seam's dog-bone curve as a pale
  4 mm line, turned by the sim's spin each frame; the seam blurs into the felt when a frame's turn passes what a
  camera can follow. A shutter stretch along the path (1/500 s; 1/250 s read as an egg up close).
- **Bloom** (`src/render/post.ts`): the scene renders to an HDR target; what is brighter than a per-arena threshold
  (above the sunlit lines: 3-5 linear) blooms, as a broadcast lens blooms floodlight lenses and roof panels, which
  are now HDR emitters (4-14x white). The first threshold (1.4 at night) bloomed the floodlit turf itself. `?bloom=0`
  renders straight to the screen. Under a 0 x 0 canvas (a hidden tab) the pass draws nothing: WebGL targets made at
  zero size stayed black after a resize.
- **Broadcast camera at the TV position**: the de facto standard padel broadcast view is about 7.6 m above the
  floor and 15.5 m behind the back glass (Javadiha et al. 2021, Sensors 21(10) 3368, from professional footage). We
  had 6.3 m up, 9.2 m back and a 42° lens; now 7.6 m, 15.5 m and 26°. Check: from there the near end's mesh (3-4 m
  high) covers the far court from the foot of the net to the far service line, as the paper describes TV frames,
  and as our render now shows. The smash kick's zoom is now a share of the lens (2.9%). The sky dome shrank to
  240 m so its far side stays inside the camera's 300 m far plane from the new position.
- **Broadcast graphics** (`src/ui/tv.ts`, `?gfx=tv`; off by default until the owner has seen it, by the rule that
  the HUD isn't restyled unseen): a score bug in the kits' colours with the server's ball, a tag sliding out of it
  (break, set and match point worked out on a copy of the score; star and golden point; deuce n; tie-break), a
  radar readout of serve and smash speeds, a strap after each point (winner, error and its cause, ace, double fault,
  out of the court; the rally's length) and after a first-serve fault, the scoreboard after each game, and match
  stats at each change of ends (points, winners, errors, double faults, won on serve, fastest smash, longest
  rally). The graphics run on the match clock; a strap still waiting is replaced, not queued, when the next comes.
  Generic: "BDJ OPEN", no real tour's names or look.
- **Trees**: crowns of nine jittered clumps lit with normals out from the crown's centre (foliage scatters light
  as a volume), darker underneath and inside; they had been three spheres.
- **Review fixes** (verifier and fresh-eyes review, 2026-10-28):
  - The timing rings are sized in radians of view and the 26° lens had made them 1.7x bigger on screen than the
    ones the owner approved: they are scaled by the lens now (`lensScale`), the same size in pixels as before.
    Their colours shifted a little with the change from AgX to Neutral tone mapping (OPEN_QUESTIONS.md).
  - Lobs left the top of the frame (38 of 154 rallies over 6 AI matches, against 11 with the old camera): the
    camera tilts up with the ball, as the operator does, keeping it 2.5° below the top edge (up to 14°, 0.2 s lag,
    easing back at half that rate).
  - The stadium crowd cost 891k triangles (4,640 people at 192): people are low-poly now (74 each; a head is 5-10
    pixels from the camera) and grouped by stand (draws 3 -> 12), and the stand behind the camera is not drawn
    (302k drawn), except during the change-of-ends swing and in photo-match mode.
  - The change-of-ends swing went through the stadium's back rows: it goes round an ellipse (20.5 m at the side)
    and, in the stadium only (`camera.swingRise`), climbs 2.5 m at its middle; in the hall that climb went through
    the roof (re-review).
  - `bumpMap()` only works on textures (it offsets their UVs to difference the height), so the kit's folds and
    the ball's fuzz did nothing: `render/bump.ts` differentiates the height in screen space (Mikkelsen 2010), and
    fades the bump where a pixel covers more than a quarter of a feature (a far player's folds would shimmer).
  - The kit's region code blended through the codes between two regions (a dark ring at each sock top, sleeves
    through the shorts' colour, black seams where every weight was 0): one weight per region now.
  - TV graphics: a double fault (an `E_FAULT` with b = 2, no `E_POINT`) had no strap and was never counted; a
    receiver volleying the serve was shown as a double fault. Both fixed; points won and won on serve now count
    double faults.
  - Writing a number to a scalar uniform's `.value` boxes it (one per avatar and the ball per frame): sweat and the
    seam blur are a vector uniform's `.x`.
  - Sweat: the time and distance terms add, so the shirt was soaked in about 25 minutes, and wet spots showed at
    the start; now dry at 0 and soaked after about a set at the AI's pace.
  - The night arena's floodlit lines (4-6 linear) straddled its bloom threshold of 5: raised to 7.5 (the lenses,
    13, still bloom). The hit sound's and smash kick's distance law still had the old camera's distances (the far
    end got none). The crowd's excitement decays by time, not by frame. A photo without a solved camera keeps the
    photo's shape; the solver's starting pitch looked up; the ball lab's sky was cut by a 200 m far plane.

- **Frame rate, Phase 4 → Phase 5** (`npm run perf`, 30 s, AI doubles, this M1 Max, other sessions' Chromes
  running. Phase 4 drew nothing new, so "before" is the Phase 3 entry's run; Phase 5 was measured on the Phase 6
  build with `?sound=0`, which draws the same): medium with the CPU throttled 4x frame p50 2.5 → 5.5 ms, p99 4.3 →
  8.4 ms (178 fps after), 0 frames over 20 ms either way (it holds 60 and 120 Hz); high (2x pixel ratio) p99 8.8 →
  22.7 ms, frames over 20 ms 0.66% → 1.95% (212 fps after). Draw calls 43 → 78, triangles 473k → 848k (arenas,
  stands, crowd, glass, turf). The high preset's tail is a Phase 8 item.

## Phase 6: sound
- **No recordings: synthesis.** `/reference/audio` doesn't exist and downloads need the owner's word, so every sound
  is synthesised (the brief's third option). Physical models where there is something to model, rendered in plain
  TypeScript into buffers so tests can measure them (`src/audio/voices.ts`, `dsp.ts`; tests/audio, 27 tests):
  - **Impacts are modes struck by a contact.** A half-sine force pulse as long as the contact drives two-pole
    resonators; a mode well below the pulse's roll-off starts at its amplitude, one above it is excited by the pulse's
    spectrum (a long soft contact is dull, a short hard one bright). The resonators are driven by the force's rate of
    change, scaled back by the difference's gain at each mode, so a struck mode has no net area (a spectrogram showed
    the first version's DC plateau under every hit). The ball's shell and a face's plate modes ring from the
    contact's sharp onset (17% of the contact time): driven by the whole 5 ms pulse alone they were 36 dB down at
    1 kHz and every hit came out a 250 Hz thud.
  - **Racket.** A padel racket is a solid perforated paddle (carbon or fibreglass skins on EVA foam), so a hit is a
    dry "pock" with no strings' ring (Piana et al. 2025: carbon drier, fibreglass less sharp, faster impacts sharper).
    Contact about 5 ms (racket sports' dwell, Zienowicz et al., IOA 2008), shorter when harder. Measured: clean hits
    centre at 450-1500 Hz (padel play's A-weighted spectrum peaks at 800-1000 Hz, Piana et al.) and 90% of their
    energy arrives within 30 ms (Piana et al.'s ambisonic recordings: the direct sound spans about 30 ms). Off the
    sweet spot the face's first bending mode (about 205 Hz; a tennis frame's is 146 Hz, Russell, and a padel racket
    is shorter and stiffer: an estimate) rings, half as bright and longer; a frame hit clacks above 2 kHz. Slices
    brush felt across the face before the hit. Bins: five kinds (drive, volley, overhead, slice, touch), three powers
    and three contacts (clean, off, frame), from the impact itself: the ball's speed against the face and where on
    the face it met (review fix, below).
  - **Bounce.** On a hard floor about 1 kHz for the first cycles, then a decaying ~250 Hz (line-calling patent US
    9551572), held by a test. Sand-filled turf is damped (porous fibres; the sand softens the bounce, Piana et al.)
    with grains of sand scattering; carpet is muffled; resin/hard loudest (ibid.).
  - **Glass.** "A low frequency bang" (Higgins, via The Padel Paper): a 2 x 3 m panel of 12 mm toughened glass, its
    bending modes from plate theory (f11 = 10.7 Hz, crowding from 50 Hz up), weighted by the mode shapes at a random
    impact point and by radiation (odd-odd modes radiate best), loss factor 0.04 (an estimate: glass in gaskets);
    a hard ball clanks the panel in its fixings. Mesh: "a higher frequency ringing" (ibid.): wire modes from 400 Hz
    to 7 kHz and the panel rattling in its frame. Posts and frames ring as free bars (1 : 2.756 : 5.404 : 8.933),
    for about 0.3 s (bolted). A wall hit within 4 cm of a frame (`Court.backZone/sideZone` seamDist) rings the steel.
  - **Net.** The netting's catch is a soft low "fwump" over 15-20 ms; a net cord is a tick on the tape and the
    cable; a net post rings like a smaller post.
  - **Feet.** Sand-filled turf crunches (grains at 2-7.5 kHz) with no squeak (padel soles are herringbone/omni for
    sand); clay crunches coarser; carpet pats; a hard court slaps and squeaks (stick-slip chirps at 1.3-2.5 kHz).
    Steps are heard where an avatar's sole comes down onto the floor (`Avatar.feet`, the lowest sole point each
    frame), or by a stride clock for the capsules; scuffs where a player brakes hard or cuts.
  - **Swing.** Turbulent noise whose band rises with the racket's speed; aeolian pressure goes about as speed cubed,
    so a block volley is near silent and a smash swishes. On every swing (`E_SWING`), whiffs included.
  - **Voices.** A Rosenberg glottal pulse train with jitter and shimmer and breath noise through five cascaded
    formant resonators (Klatt 1980), vowel formants from Peterson & Barney 1952. Grunts: pitched up by effort and
    falling, voiced only past an effort, breath below it; four players' voices; each player grunts with their own
    propensity on overheads and hard drives. Shouts carry more sound power in real padel than impacts (Piana et al.:
    +1.9 dB(A) overall), but the game keeps them a step under the racket.
  - **Crowd.** Applause is many clappers, each with a hand configuration from ClaPD's resonance table (Peltola et
    al. 2007, after Repp 1987; a clap about 5 ms, Jylhä & Erkut 2008), about 4 claps a second (tuning), joining and
    leaving at their own times; a stadium's thousands beyond the 160 rendered are a band of noise in the claps'
    spectrum. Gasps, groans and cheers are 40 formant voices, men's and women's, staggered, with noise standing in
    for the rest. The murmur is talkers in phrases at about 5 syllables a second (Pellegrino et al. 2011: 5-8).
  - **Rooms.** A stereo impulse response per arena: decaying noise in three bands, each with its own RT60, early
    reflections (the court's own glass, the roof, the end walls) and, in the covered hall, a flutter between floor
    and roof. Stadium RT60 2.4 / 2.0 / 1.3 s (low / mid / high; an estimate for a big hall, BB93 caps school sports
    halls at 1.5 s), covered hall 1.6 / 1.25 / 0.8 s, outdoors 0.3 s of the glass and the clubhouse. Measured by
    Schroeder integration (T20) in the tests within 20% (mid) and 25% (low) of the spec.
  - **Ambience.** Wind with gusts and leaves, birds by day, crickets and the floodlights' 100 Hz hum by night, a
    covered hall's air; the courts next door play rallies (about a hit a second, then pauses: club padel is about 88
    impacts in 5 minutes, Higgins), heard from where those courts stand.
- **The bank** (`src/audio/bank.ts`, `data/audio.json`): 2-4 renders of each sound per parameter bin (about 200
  buffers, 0.5-1 s of synthesis, mostly the crowd) rendered in a worker (`bankWorker.ts`) so the first frames never
  stall, the racket first. Each family is scaled so its loudest render sits at its level (peak dBFS for impacts, rms
  for beds); a play picks a render at random, never the last one, with +-3% pitch and +-1.5 dB, and a continuous
  parameter (speed, effort) picks the bin below or above at random by where it falls between them, the level
  following it, so sounds slide with the play rather than step.
- **Engine** (`src/audio/engine.ts`): heard from the broadcast camera (the listener follows it each frame): 32 pooled
  voices (gain, an air/distance low-pass, an equal-power panner with the inverse distance law at 16 m reference so
  the far baseline is about 6 dB down, and a send to the arena's reverb that grows with distance), four buses, a
  master gain, a safety limiter (-2 dBFS, 20:1, make-up gain undone) and a clip that is exact below 0.8 (review fix,
  below). Sounds play at the event's exact time (up to
  50 ms ahead, as the sim runs ahead of the screen). Audio starts on the first key, click or pad press (browsers
  allow it only from a gesture), in autoplay too, and pauses with the tab.
- **The mix.** Levels in `data/audio.json`: racket -5 dBFS peak, glass -6, mesh -9, posts -10, bounce -14, net -14,
  grunts -13, swish -20, shoes -30; beds by rms: applause -26, cheer -25, murmur -41. Tests hold: no single sound at
  its loudest play needs the limiter; the busiest moment (a smash off the glass with a grunt, steps, a cheer and the
  big applause over the murmur) peaks under the limiter's threshold in every arena on every floor; the shoes sit 15-32 dB under the racket, the bounce
  over 4 dB under, the crowd's chatter 9+ dB under a hit (hushed 16 dB further in a point).
- **The crowd follows the match** (`src/audio/soundscape.ts`): chatter between points, hushed as the server gets
  ready, a murmur of tension rising past 6 shots, a gasp (big crowds) at a smash or a ball off two walls sent back,
  then applause by the point: small for most, big after a long rally or a smash winner, a cheer for a ball played
  out of the court, a groan for a long rally lost on an error or a double fault, more for sets and the match. Club
  crowds (8-14 people) only clap.
- **Feedback**: the Phase 2 hit sound (`sound.ts`) is gone; rumble and the smash's camera kick stay in
  `src/game/feedback.ts`.

### Phase 6 review fixes
Two reviews (a verifier and a fresh pair of ears reading the code) found one critical problem, four high and about
twenty medium or low. Fixed:
- **Critical: sound froze for good in Firefox.** The engine set the listener through `positionX`, which Firefox's
  `AudioListener` doesn't have; the throw came out of the frame loop. The listener's position now lives in the
  engine's own fields and goes through `setPosition` where `positionX` is missing, only when the camera has moved;
  `game.ts` catches any audio failure once and carries on silent; a foot's `footDown` is set before the step plays,
  so a throw can't make it play every frame.
- **High: a club's eight watchers clapped as loud as a stadium.** Reactions are levelled by the part that sounds
  (`activeRms`, not the whole render with its silent tail) and by headcount: `crowdDb(N) = 10 log10(N / 4600)`
  (power adds with clappers), +6 dB under 50 people (they sit by the court). Eight people clap 22 dB under the
  stadium; every crowd render is capped at -9 dBFS peak. Tests hold both.
- **High: the master chain coloured every mix.** The -8 dBFS 12:1 compressor ran on most hits and its automatic
  make-up gain lifted everything under it. It is now a safety limiter at -2 dBFS, 20:1, hard knee, with the make-up
  gain taken back out (`1 / (1 / fullScale)^0.6`, WebAudio's own formula), so it is unity below the threshold; the
  soft clip is the identity up to 0.8. The mix tests run all four arenas on all four floors through that chain and
  hold the busiest moment under the threshold: in play nothing touches it.
- **High: the racket's sound came from the timing grade.** A "Perfect" frame shot sounded clean. The hit event now
  carries the impact speed (`MatchEvent.d`, the ball against the face, from `ShotResult.impactSpeed`) and where it
  met the face (`q`: 0 centre to 1 edge, 2 the frame, from the contact point against the head's length and width);
  power is (speed - 4) / 36 m/s, a contact past 0.55 is off-centre.
- **High: scuffs depended on the frame rate.** Braking and cutting were judged from one frame's velocity change,
  so 144 fps scuffed far less than 60. They are judged over a fixed 0.1 s window now; a test plays the same match at
  60 and 144 fps and gets the same count within 35%.
- **Medium and low:**
  - **Levels follow a law.** A bin's level now goes with its speed or force (`law` per family in `bank.ts`); the
    bins only change the timbre, so `binFor` slides between them with no step (a test checks both picks at every
    midpoint agree within 0.2 dB). The gain is clamped only above the top bin.
  - **Floors keep their loudness.** Bounces, steps and scuffs were each normalised per floor, so sand rang as loud
    as resin. They are levelled on turf (`floorRef`); the other floors keep their own level against it (a test:
    resin over 2 dB louder than turf, carpet quietest).
  - **The bounce sat 3.6 dB under the racket.** It is now -17 dBFS peak (from -14) and the shoes -31 (from -30):
    a test holds the bounce over 4 dB under a clean drive and the shoes 15-32 dB under it on turf and on resin.
    Broadcast mixes put the ball's bounce well under the hit; there is no padel measurement of the ratio
    (OPEN_QUESTIONS.md).
  - **The crowd carried its state between points.** Wall counts and the "long rally" state now reset on every point,
    fault and let; walls count only in a rally; no gasp at a serve; a set or match point plays one celebration (no
    applause stacked on a big one in the last 3 s); a long rally gets a cheer only for a winner, a groan for an error;
    the cheer comes 0.3 s after the point. The hush starts at the server's set-up (time constant 0.35 s) and the
    chatter returns after the point (0.8 s); a test reads the murmur's level at each serve's contact as WebAudio
    follows its targets. The tension rises 13 dB by about 22 shots (7 was inaudible under the hush).
  - **Frame clacks.** The rim's modes (1.9, 2.9, 4.3, 6.1 kHz) are struck by a 0.22 ms pulse and the face's bend is
    damped on a frame hit: brighter than a clean hit, with more energy above 2 kHz, at about the same loudness (a
    test measures all three).
  - **The swish peaks at the contact.** It was played at the swing's start; it is now scheduled so its peak lands
    25 ms before the contact (`WHOOSH_LEAD` + `WHOOSH_PEAK`), started part-way in when late; whiffs swish too. A
    test: 80% of swishes peak within 45 ms before to 20 ms after the hit.
  - **Steps.** Force from the speed and the braking (`0.06 + v / 6.5 + brake / 18`), the capsules' stride clock at
    a runner's cadence (`1.6 + 0.48 v` steps a second).
  - **Variety.** Three or more renders of anything heard often: with two, "never the one just played" was a strict
    A/B/A/B.
  - **Ambience.** Birds are one-shot calls from the trees 14-32 m to the side, 4-10 m up, at random (a loop of birds
    repeated audibly every few seconds); the wind loop is 17 s and the murmur 12 s; the stadium has its air
    handling under the play.
  - **Engine.** Buffers made once per family (at unlock or on arrival from the worker), the raw floats dropped; the
    render picker uses typed arrays, not string keys; a voice is free when its sound has ended by the audio clock;
    `pause()` always suspends or resumes, and a state change while paused is put right; without a worker the bank
    renders one family per 30 ms task after 1.5 s, so the first frames never stall; the impulse response's bands
    use independent noise and its flutter can't go negative; `air.Q` is -3.01 dB (Butterworth); loop requests that
    change nothing are skipped. `src/audio/sink.ts` holds the interface the soundscape plays into, so the tests
    record it without WebAudio or three.
- **Not done:**
  - **A gamepad-only player may hear nothing until a key or click.** Browsers start audio only from a user gesture
    and a pad press may not count. A hint would be new UI, which needs the owner's OK first (OPEN_QUESTIONS.md).
  - **Output latency isn't compensated.** `AudioContext.outputLatency` (10-40 ms; Bluetooth 150+) would move every
    sound earlier; Safari doesn't report it, and the swish's lead covers the usual wired case.
  - **Partner calls aren't voiced** ("¡mía!", "¡tuya!"): the calls are on the HUD; voices would need recorded
    speech to sound like people (formant synthesis gives vowels, not words).
- **Frame rate, sound off → on** (the same Phase 6 build, `QUERY=&sound=0` then without, back to back): medium 4x
  178 → 141 fps, frame p50 5.5 → 7.1 ms, p99 8.4 → 9.8 ms, CPU work p50 4.9 → 6.3 ms (the soundscape and WebAudio's
  main-thread share: about 0.35 ms a frame unthrottled), still 0 frames over 20 ms; high 212 → 202 fps, p99 22.7 →
  29.0 ms, 1.95% over 20 ms both. The audio's cost is a Phase 8 item (voice pooling, fewer parameter writes;
  Phase 8 measured about 0.4 ms a frame at 4x and left it).

## Phase 7: rules and QA
What was found and fixed, with the commands that reproduce it: `docs/qa/REPORT.md`. The decisions:
- **Oracles from the rules text alone.** The referee and scorer that judge the army's matches
  (`tools/qa/refereeOracle.ts`, `scoreOracle.ts`) were written from the FIP text without reading the game's rules
  code, so a shared misreading can't hide; where the text is ambiguous the reading and its reason are in
  `tools/qa/ORACLE-NOTES.md`. When the game and an oracle disagree, the FIP text decides, not either side. This
  phase the text sided with the oracle every time; the per-tick checker was wrong twice (below).
- **Three kinds of player.** The AI alone never mashes keys, holds a swing for seconds or walks into its partner,
  and those found bugs: "bots" play the human code path well, "monkeys" press anything at any time
  (`tools/qa/humans.ts`). Each army match draws its players, mode, court, floor, ball, climate, format, levels and
  styles (`tools/qa/config.ts`).
- **The corner (14.1.i).** FIP says a ball bouncing "in the angle where the wall joins the ground" is a correct
  return. The game counted it only when the wall and the floor met in the same tick, so a ball a few millimetres up
  the glass first lost the point (86 calls in 200 matches). A glass touch on the opponents' side before the bounce
  with the ball's centre at most 6 cm up (its bottom within 2.7 cm of the floor) is now the bounce, and the floor
  touch within 25 cm right after it is the same bounce: the oracle's reading, adopted because no referee can tell
  2.7 cm from the corner. Mesh isn't a wall: a low touch of the opponents' mesh still loses (13.1.g).
- **A net touch before the bounce counts on both sides of the plane** (9.1.a): a ball's centre can be 3-5 cm past
  the net's plane while the ball still touches the tape.
- **Before the serve only the server plays the ball**, and stands still: a partner walking into them gives way (a
  push moved the server and the ball in hand 45 cm over the line). A drop or a contact outside the server's own area
  (behind the service line, on their side of the centre line; a ball on a line hasn't crossed it) is a fault,
  `WHY_SERVE_AREA` (6.2, 7.1.a).
- **The final-set rule needs a deciding set**: in a one-set match there is no "one set all", so neither "no
  tie-break" nor a match tie-break applies (the game applied the first and not the second).
- **The ball changes sides only by crossing the cable's line above it** (or beyond the posts), never by being past
  it and never while the netting grips it. Three versions of a smash into the top of the net put the ball on the far
  side after it climbed out of the pocket. A ball the cable springs back under, above the tape, does go over (it is a
  ball on the tape).
- **A sleeping net in wind isn't at the cable's line.** A 4.6 m/s wind stands its bottom 12 cm out; the ball is now
  coupled to a sleeping net within its measured bulge (`NetCloth.bulge`), or a drive went through it (8 of 64 such
  drives in the test).
- **Animation, from the animation army** (`tools/qa/anim-army.ts`): a soft zone at full reach for the elbows
  (`IK_SOFT` 3 cm, a rational ease, not exp; the hand falls 1.5 cm short at exactly full reach), the elbow's bend
  rate-limited to 1.8× a serve's forearm peak (1.25× made a human's late serve meet the ball a frame later still),
  the reach lean followed at 20 rad/s (at 6 the hand was short of the ball at contact: p90 2.8 → 4.5 cm) and faded
  where its direction is undefined (140-165° behind the spine's base), the arm's fade to its clip limited to
  1500°/s. Keeping last frame's way round in that fade was tried first: it spun the arm the long way (27 of 60
  configurations then turned a joint over 105° in a frame).
- **Monkeys are judged on the AI's limits and 7 of 60 fail**, all on per-minute counts (pops, racket in the body,
  hand in the torso). They swing far more often than the AI (46 swings to 16 in one configuration's 90 s); per swing
  the two overlap (1.1-4.0 pops a swing against 0.5-4.8 over six configurations). The limits stay where they are
  (OPEN_QUESTIONS.md).
- **Edge end points are contacts** (second army run, match 1463): a ball coming down onto the top corner of the
  side fence's step (3 m to 4 m) met neither edge's line within its length and no face, and went 3.2 cm into the
  wall for a tick. `Court.corners` lists every edge's end points once and `Ball.tryCorners` tests the ball's path
  against a sphere round each, near the walls only. `npm run alloc` six times after: singles 3, doubles 4-5 GCs per
  100k ticks, as before.
- **Checker fixes** (four): the through-net check took a pocket's entry below the tape for the crossing of a ball
  that later went over the cable, and assumed the net at z = 0 (a pushed-back cable isn't); the spin check's flat
  900 rad/s flagged balls leaving a gripping bounce (now rim speed over 1.5 x the ball's speed + 8 m/s, or over
  1600 rad/s); the low side-flip check read a crossing just above the tape as one under it.
- **Regression tests for every fix**, each checked to fail on the code before it (the verifier found #8, #10 and the
  animation fixes had none): `tests/qa/regressions.test.ts` (rules, physics, the bounded cache) and
  `tests/qa/animRegressions.test.ts` (the four animation-army configurations that turned a joint 97-137 degrees in a
  frame before the fixes and 37-49 after; all four fail on the old avatar code). The smash test needed a steeper
  sweep than the first one tried: of 1344 smashes into the net top, 28 were put on the far side while held under the
  old rule, none now.
- **The rally's state and the serve's drop point are in `MatchSim.hash()`** (new state goes in the hash).
- **Not built**: out-of-court play (OPEN_QUESTIONS.md), touching the net (players are kept 0.3 m off it), a hall
  ceiling.
- **Frame rate** (Phase 7 changed no rendering; `npm run perf` on the Phase 7 build, measured with nothing else
  running: an earlier run beside the test suite read 12 ms p99 on medium-4x): medium-4x (laptop proxy) p50 6.6 ms,
  p99 9.8 ms, no frame over 20 ms, 1% low 84 fps (Phase 6: p50 7.1, p99 9.8); high (2x pixel ratio, frame limit
  off) p50 3.8 ms, p99 20.6 ms, 1.03% of frames over 20 ms, 1% low 36 fps (Phase 6: p99 29.0, 1.95%). The high
  run's spikes are the GPU queue stalls seen since M1 with the frame limit off; they vary a lot between runs.

## Phase 8: performance and polish
Measured with `tools/perf.mjs` (Chrome with puppeteer, 1080p, AI-vs-AI autoplay, the frame limit off), with
`tools/lifecycle.mjs` (match → title → match cycles, heap and GPU objects after GC) and `node tools/perf.mjs 20 load`
(cold starts on throttled networks). The machine was shared with other sessions (load average 4-17 over the
review's runs), so before and after numbers come from paired runs back to back, and each run prints its load.

**Screens**
- **One app around the game** (`src/app/app.ts`): a title screen over an attract match on the chosen arena, Play
  (match setup), Quick match, Settings, Controls, Credits, a pause screen (Esc, Start, or leaving the window) and a
  results screen with the match's stats (`src/game/stats.ts`). URL options (`?autoplay=1` and the rest) still
  launch straight into a game (`directLaunch`), so every tool keeps working.
- **Menus** (`src/ui/menu/menu.ts`): plain buttons in a list (sliders for the choices), driven alike by the keyboard,
  the mouse and a pad (d-pad or stick with repeat, A to choose, B back, Start pause and resume, also from the pause
  menu's Settings and Controls). Screens slide in (0.22 s) and fade instead with reduced motion. Going back puts
  the focus where it was. The pad is polled only while a menu is up, by one loop that clears its id before it
  polls (a `hide()` from inside the poll, a button that starts a match, used to leave the loop running:
  `cancelAnimationFrame` can't stop the callback that is running, so during play A pressed the stale Quick match
  again and restarted the match, and the stick moved hidden focus); a hidden menu has nothing left to press.
  Checked with a scripted pad in Chrome (`tools/pad-check.mjs`: PASS on this build; the build before the fix
  fails its restart, focus, pause sub-screen and held-swing checks). The game ignores Start while a menu has it
  and marks the press that resumed as used (the two polls run in one frame in either order).
- **Loading** (`src/ui/loading.ts`): named stages with a bar over an opaque screen that fades once the first frame
  is drawn; a failure says which step failed (the renderer, the players' download, tried three times: two retries,
  1 s and 2 s apart, or the arena's build, for the title as for a match) in words, not a raw `Error:`, and offers
  one Try again button (a key, a click or a new press of the pad's A). The progress bar alone has the progressbar
  role; the message is an alert beside it.
- **Between points and games** (`src/ui/transitions.ts`): the sim puts the players back the instant the dead time
  ends, so the picture dips to near black for a quarter second over that instant, as a broadcast cuts away, instead
  of showing four players jump. After a game or a set a score card shows the match so far.
- **No placeholders left**: names fall back to P1/Player 1 (never "undefined"), every setting has a description,
  the sounds are all synthesised (Phase 6), the icon is ours.
- **Settings** are stored in `localStorage` (`bandeja.settings.v1`) and every stored value is checked against its
  allowed values on load (a bad or old file falls back field by field). Key remapping (`input/bindings.ts`): an
  action whose keys were all removed stays empty; a key given to one action leaves the others' defaults.

**Quality presets** (`src/render/quality.ts`): chosen by what costs GPU time here, pixels first. Low: pixel ratio 1,
render scale 0.75, 1024 shadow map, no bloom. Medium: ratio 1, full scale, 2048, bloom. High (the game as it was):
ratio up to 2, so on a screen at ratio 1 High draws what Medium draws. Ultra: 4096 shadows. Auto (the default) is
High with dynamic resolution (`Game.adapt`; `?quality=auto` runs it from a URL): about half a second of slow
frames takes the render scale down 0.1 (to 0.6 at least), 900 frames without one try a step up, and a step up
that has to come back down within 10 s doubles the wait. Only the pixel ratio changes, so no shader compiles
mid-point.
- **Slow is judged against the display.** The first version counted every frame over 18.5 ms as slow, so on a
  50 Hz screen, or with a browser's 30 Hz cap (battery savers; headless Chrome paces at 30 Hz), every frame was
  slow and the scale sank to 0.6 for good. A frame is now slow past max(18.5 ms, 1.25 display periods). The
  period is measured while the page loads (`render/display.ts`: the lower quartile of requestAnimationFrame
  intervals while the main thread mostly waits on the renderer and the download) and lowered when frames run
  faster than it (the 10th percentile of the last 256). Intervals alone can't tell a 30 Hz cap from a GPU that
  only makes 30 Hz on a 60 Hz screen, so one more check: when the scale reaches its floor and the median frame is
  no faster than at full scale, pixels were never the limit (a cap, or the CPU): the scale goes back to full and
  that frame time becomes the period. Checked with `node tools/perf.mjs 30 autocap`, paced by the game's own
  `?fpscap` (which the load-time sample can't see, so harder than a browser's cap): at 30 Hz the scale went to the
  floor in the first seconds and came back to full when the floor check ran (28% of the run at 0.6, 3% at 0.7,
  full from then on); at 50 Hz it took one step to 0.9 at the start and was back at full after the 900-frame
  probe, never lower. On the integrated-GPU stand-in Auto stayed at full scale (above).

**Frame rate** (each run 30 s of the AI match after a 3 s settle, 1080p, the frame limit off unless paced; the
review's runs on build 45f0f12, logs in `tools/out/p8-review-*.log` with the load average before and after each)

| Run | load average | p50 ms | p99 ms | 1% low fps | frames > 20 ms |
|---|---|---|---|---|---|
| Phase 7, medium, CPU 4x (paired with the next) | | 6.2 | 11.6 | 75.9 | 0 |
| Phase 8, medium, CPU 4x (paired) | | 5.5 | 8.8 | 86.9 | 1 (0.02%) |
| Phase 8 before the review, medium, CPU 4x (two runs) | 7.9 / 8.5 | 7.1 / 8.7 | 11.3 / 12.0 | 74 / 75 | 1 / 0 |
| Phase 8 review, medium, CPU 4x | 4.2 → 7.6 | 5.7 | 9.1 | 88.4 | 0 |
| Phase 7, high, 2x pixels, unpaced (paired with the next) | | 3.0 | 20.3 | 40.5 | 1.01% |
| Phase 8, high, 2x pixels, unpaced (paired) | | 3.1 | 28.6 | 33.6 | 1.98% |
| Phase 8 before the review, high, 2x pixels, unpaced | | 5.3 | 38.5 | 23.9 | 2.14% |
| Phase 8 review, high, 2x pixels, unpaced | 7.6 → 8.5 | 3.0 | 19.9 | 38.6 | 0.99% |
| Phase 8 review, high, 2x pixels, paced at 120 Hz | 8.5 → 7.5 | 8.3 | 8.3 | 120.5 | 0 (no 120 Hz refresh missed) |

Integrated-GPU stand-in (`node tools/perf.mjs 30 igpu`, then `igpu60`): CPU 4x, five times the pixels.

| Preset (pixel ratio asked → drawn) | load average | p50 ms | p99 ms | 1% low fps | frames > 20 ms | holds 60 Hz |
|---|---|---|---|---|---|---|
| Low (1 → 1.68: √5 × its 0.75 render scale) | 4.0 → 3.7 | 4.1 | 6.4 | 135.7 | 0 (max 13.6) | yes |
| Medium (1 → 2.24) | 3.7 → 3.7 | 5.9 | 9.3 | 84.8 | 0 (max 18.3) | yes |
| High (1.5 → 3.35) | 3.7 → 4.1 | 8.8 | 60.9 | 15.8 | 67 (2.39%) | **no** |
| Ultra (1.5 → 3.35) | 4.1 → 4.0 | 8.7 | 55.2 | 16.2 | 72 (2.55%) | **no** |
| Auto (1.5 → 3.35; stayed at full scale) | 4.0 → 4.2 | 8.3 | 56.0 | 16.2 | 77 (2.66%) | **no** |
| Medium, paced at 60 Hz | 10.2 → 11.3 | 16.8 | 17.4 | 55.5 | 1 (20.1 ms) | one late frame in 1,778 |
| High, paced at 60 Hz | 11.3 → 10.9 | 16.8 | 17.5 | 55.2 | 0 (max 19.2) | yes |
| Ultra, paced at 60 Hz | 10.9 → 9.9 | 16.8 | 17.4 | 57.2 | 0 (max 18.4) | yes |
| Auto, paced at 60 Hz (stayed at full scale) | 9.9 → 12.9 | 16.8 | 17.4 | 55.1 | 0 (max 19.3) | yes |

- **The 1% low** is 1000 / the mean frame time of the slowest 1% of frames (0.1% likewise); every run reports it,
  frames over 20 ms and frames over 9.33 ms (a missed 120 Hz refresh).
- **The integrated-GPU stand-in** throttles the CPU 4x and draws five times the pixels (`?gpuload=5` scales the
  pixel ratio by √5): an M1 Max has about five times the fill rate and bandwidth of an Iris Xe or a Radeon 680M.
  Low and Medium cap the pixel ratio at 1, so they draw the same at any ratio; High, Ultra and Auto run at 1.5, a
  14-15" laptop's usual 125-150% (at ratio 1 High draws what Medium draws). Unpaced, Low and Medium hold 60 Hz with
  no frame over 20 ms; **High, Ultra and Auto don't**: their median frame is 8.3-8.8 ms, but 2.4-2.7% of frames
  take over 20 ms and the 1% low is 16 fps, with the main thread's work at p99 equal to the frame time, the same
  full GPU queue as the unpaced High runs at 2x below. Paced as a 60 Hz screen paces them (`?fpscap=60`, under a
  load average of 10-13), all four draw 59.3 frames a second (the cap's own spacing here is 16.8 ms) with p99
  17.4-17.5 ms and nothing over 20 ms but one 20.1 ms frame on Medium. Whether a frame 1-3 ms past the period would
  miss a real screen's refresh depends on the compositor, which the stand-in can't show. Auto never left full scale
  in either run: the unpaced stalls are single frames, not the half second of slow frames it reacts to. It is a
  stand-in (OPEN_QUESTIONS.md). The first version of this table ran High at ratio 1 (so it measured Medium), never
  ran Ultra or Auto, and gave Low 0 frames over 20 ms where its log had 1 (21.5 ms); those runs were 25 s.
- **Unpaced High is slower in Phase 8 than in Phase 7** in the paired run: 1% low 33.6 against 40.5 fps, p99 28.6
  against 20.3 ms, 1.98% against 1.01% of frames over 20 ms. The final run before the review measured 23.9 fps,
  38.5 ms and 2.14%, the review's 38.6 fps, 19.9 ms and 0.99%; neither is paired, and the machine's load moves
  these runs that much. What Phase 8 added to the unpaced cost wasn't isolated. In every unpaced High run the main
  thread's work at p99 equals the frame time: it is blocked submitting into a full GPU queue, which a display's
  pacing never lets fill. Paced as a 120 Hz screen paces it (`?fpscap=120`), the same High run at twice the pixels
  holds 120 Hz to the frame: 3615 frames in 30 s, max 8.3 ms, CPU work p50 1.3 ms.
- **The final build** (7e62375: after 45f0f12 only sim fields' initial values changed) was paired with 45f0f12,
  alternating A B A B (`tools/out/p8-review-pair.log`), while other processes loaded the machine (Chrome helpers
  outside the runs at 100-130% CPU, load average 6-8): medium at 4x 1% low 56.8 and 60.3 fps against 57.4 and
  61.4, p99 15.7 and 14.7 ms against 14.3 and 14.5. The same within the noise; both ran half as fast as the runs above,
  even paced at 120 Hz (68-89 fps), which is the machine, not the build.
- **GPU timestamps can't be used on Apple GPUs**: three's timestamp queries reported 27 ms of GPU time a frame at
  140 fps (the passes' times overlap). They are opt-in (`?gputime=1`, `GPUTIME=1` for perf.mjs) and off otherwise.
- **The audio's cost** (left to Phase 8 by Phase 6): `node tools/perf.mjs 30 audio`, medium at CPU 4x with the
  sound on, off, on, off back to back (load average 7.9 → 5.0): 183.9 and 185.7 fps with sound against 201.3 and
  200.8 without, frame p50 5.3 against 4.8 ms, p99 8.3-8.4 against 7.8-8.0 ms, main-thread work p50 4.7-4.8
  against 4.4 ms. About 0.4 ms a frame at 4x (0.1 ms unthrottled); one sound-on run had one 20.5 ms frame. Phase 6
  measured 1.4 ms at 4x on its own build. Voice pooling and fewer parameter writes weren't needed for 60 Hz and
  weren't done.
- **The JIT** (V8's deoptimisations). The first version of this bullet said only warm-up deoptimisations were left,
  from a run that launched a match straight from the URL (no title match first), stopped printing at 30 and had 30
  after its 8 s warm-up. Measured now through the app as a player meets it (`node tools/perf.mjs 60 deopt`, CPU 4x,
  every deopt placed by the build's source map): on 45f0f12, 619 while loading and over the title match's first
  30 s, 68 over its next 60 s (33 in the sim, 17 of them "wrong map" in the ball and the net cloth) and none over
  the player's first 60 s after Quick match, the match's build included. On the final build (7e62375, load average
  16.5): 637, then 47 (22 in the sim, every one a first visit of a branch but one "lost precision"), then none
  again. The sim's own were traced in Node (`tools/sim-deopt.ts`: four doubles matches of up to 1,020 s with
  a bot human, and with `AI=1` four of the title's all-AI match, `--trace-generalization` for the causes). Fields
  that held small integers until their first fraction, seconds to minutes in (the ball's surface and wall ids
  read from a Float64Array, its junction and net-catch scratch fields, the rally's corner touch and the serve boxes,
  `SimpleAi.servePressAt`, the shot request, the AI styles built from JSON) changed their class's map then, and
  every optimised function reading a ball, a rally or an AI deoptimised in a burst ("wrong map", "not a Smi");
  they start as doubles now. `Player.move`'s wall clamps, stores reached only at a wall, choose between locals.
  After a 120 s warm-up the bot-human matches went from 73 deopts to 48 (40 in the sim); the AI matches have 64
  after 30 s (60 in the sim: 50 in the first match, 10 in the three after it). Every one left is single: the first
  time play reaches a branch with no type feedback (and two one-off number guesses), and the function is optimised
  again straight away. They are listed in OPEN_QUESTIONS.md, not fixed: it would take warming every rare branch.
- **Garbage**: the page makes 17-27 MB/s of short-lived garbage, almost all inside three (render-object cache keys,
  sorting, sampler updates; the avatar's IK while the JIT warms up). Minor GCs run about once a second, the longest
  1.5-5.3 ms with the CPU throttled 4x; none breaks a 60 Hz frame, and the 1% lows above include them. The sim
  itself stays inside its budget (`npm run alloc`).

**Load time** (cold, CPU throttled 4x, 1.12 MB downloaded)

| Network | title playable | Quick match → first frame | total |
|---|---|---|---|
| Broadband (25 Mbit/s, 40 ms) | 5.49 s | 3.46 s | 8.95 s |
| Slow 4G (9 Mbit/s, 150 ms) | 6.46 s | 3.48 s | 9.94 s |
| Broadband, no `scheduler.yield` (as Safari), before the fallback | 10.55 s | 8.65 s | 19.20 s |
| Broadband, no `scheduler.yield`, with the fallback | 5.59 s | 3.52 s | 9.12 s |

- **A `scheduler.yield` fallback** (`src/main.ts`): three's `compileAsync` yields to the page between objects with
  `scheduler.yield`, and without it (Safari, Firefox) with one animation frame per object, which doubled the load. A
  `MessageChannel` queue stands in for it.
- **Shaders compile on the loading screen** for the whole scene (`Game.warmUp`), so none compiles mid-point. Most of
  the load is that compile (2.54 s of the title's 5.49 s, 2.37 s of the match's 3.46 s with the CPU at 4x, the
  broadband run with the fallback).
- **A hidden tab stalls WebGL's compile**: three polls for shader readiness with animation frames, which a hidden tab
  doesn't get. Only an issue for tools driving a hidden tab (the Browser pane).

**Memory between matches** (`tools/lifecycle.mjs`, 12 cycles)
- A finished game frees its geometries, materials, textures and shadow maps (`render/dispose.ts`). GPU objects stay
  flat across cycles.
- **The leak was three's bind groups.** Each match's new shadow-casting lights made every material build new
  shadow uniforms, and three's `NodeBuilder` keeps every bind group it ever made in a cache keyed by the renderer
  (`_bindingGroupsCache`, never freed): 0.81 MB of heap and 3.3 MB of buffers a match, and two DOM nodes. The arena's
  lights are now made once and reused (`render/arena/lights.ts`, `pooledLight`; every property is set on each
  build, tested against fresh lights): 0.32 MB a match, DOM flat.
- **The residual** is the same cache: about 48 bind groups (~130 KB) a match from materials built for each match.
  It is inside three; reusing every material between matches would remove it, at the cost of a far bigger change.
  A hundred matches in one sitting cost about 30 MB. Worth reporting to three (it needs the owner's OK: it is
  public).
- **The pooled lights aren't disposed at a teardown any more** (`disposeTree` skips what `lights.ts` keeps; before,
  every teardown freed their shadow maps and the next build made them again). Paired lifecycle runs, 12 cycles
  each (load average 5.7 and 4.5): 0.315 MB a cycle on the build before the review, 0.31 MB on this one, so the
  residual is the bind-group cache, not the lights. DOM nodes stay between 226 and 234 (which screens the cycle
  passed through); geometries, textures, canvases and listeners don't move.

**Left from earlier phases**
- **Triangles** (`node tools/perf.mjs 30 tris`): every preset draws the same 608,546 triangles in view (847,6xx
  counted by the renderer, the shadow pass included): the four players 221,280 (55,320 each, skinned), the crowd
  about 302,000 (74 a person, 4,084 in view: torso, head, hair) and the seats 64,512 (5,376 boxes), the rest under
  25,000. CLAUDE.md's Low budget is 300k; the presets change only pixels, shadows and bloom, so Low is twice that
  in view and 2.8 times it counted. Not changed: Low holds 60 Hz on the integrated-GPU stand-in with a 1% low of
  136 fps, so its triangles aren't what limits it there, and cutting them means a lighter crowd and body LODs on
  Low, which change a look the owner approved (OPEN_QUESTIONS.md).
- **Glass reflections of the players and the ball** (Phase 5 left them for "a Phase 8 preset"): not built. A planar
  reflection renders the scene again for each glass wall in view (two to four from the broadcast camera), each
  about as costly as the main pass (an estimate, not measured), and unpaced High at 2x already fills the GPU, so it
  could only be an Ultra option. Whether it is worth building and measuring is the owner's call (OPEN_QUESTIONS.md).

**Accessibility**
- **Colours**: a colour-blind safe palette (blue Good, cyan Perfect, yellow early/late, dark orange a miss). Simulated
  protanopia, deuteranopia and tritanopia (Machado et al. 2009) keep every pair of grades at ΔE ≥ 25 with it; the
  default merges Good and Early/Late at ΔE 10.4 (protanopia). The words are always shown with the colours.
  `tests/app/palette.test.ts`.
- **Contrast**: every panel's text is checked against WCAG 1.4.3 (4.5:1, 3:1 for large text) over any scene behind
  the panel, from black to white and the arenas' colours. Three failed and were brightened (menu group labels, the
  help panel, the between-points card; the narrow-screen shade darkened a little). The coloured call subtitles keep
  the approved look and fall to 1.8:1 over a white backdrop, so a **High contrast** setting makes the panels nearly
  solid, darkens the score bug and backs the loose timing words (grade, shot, partner and the ms line); everything
  passes with it. The test reads the panels' colours and alphas from the CSS itself (`HUD_CSS`, `MENU_CSS`), so its
  cases are what is drawn. The menu's shade was a share of the window (.7 to 34%, .4 at 52%), so below about
  1857 px the 520 px column ran into the fade and the description and accent sub-title fell to 2.6-4.2:1 over a
  white scene at 1280-1600 px; its .7 stop is now the column's right edge plus 40 px (`calc(6vw + var(--col) +
  40px)`), about where 34% was at 1920 px, so .7 is the true worst case under any menu text.
- **Motion**: reduced (or the system's `prefers-reduced-motion`) turns off the camera kick on smashes and the score
  banner's slam, fades menus instead of sliding them, stops the key-capture blink and the loading screen's ball.
  The menus get it from the first screen (the menu was made after the look was applied, so at boot it slid), the
  CSS has `prefers-reduced-motion` fallbacks unless Motion is set to Full, and the first loading screen follows
  the stored text size, motion and contrast.
- **Text size** 100/125/150% for the HUD and menus.
- **Screen readers**: the score, points, games and sets are announced through a polite live region
  (`ui/announce.ts`; the words go in a task after the clear, so the same words twice are read twice); menu items
  are buttons and sliders with labels and value text, group titles are headings, the description line is live,
  the menu is a modal dialog labelled by its title, decoration is hidden, and on a narrow window the side card's
  copy under the list is the one read (the hidden copy is display: none).
- **Input**: every key can be remapped, and the help panel, hints and serve call name the keys in use; everything
  works on a pad (menus included) and the rumble can be turned off.
- **Settings in the pause menu**: sound, picture (not the preset), accessibility, pro mode, mouse aim, the
  announcer and the keys apply at once. The timing window, the assist, auto timing and the swing mode are the
  sim's configuration: a replay is the seed and the input frames under one configuration, so they apply from the
  next match and say so, as Quality does. With one-tap swings Auto timing shows as on and can't be changed.
- **Timing help**: forgiving, standard or strict windows; positioning assist off to strong; auto timing (a held
  swing fires itself, graded Good); and **one-tap swings** (Swing: One tap): a tap starts the swing and the game
  times it, for players who can't hold and release on time.
- **Pausing**: the game pauses when the window loses focus, the tab is hidden or the pad is unplugged (a point used to
  play on while you were away), also when that happened while the match was loading. A swing held as it paused
  is let go at the resume moment (`KeyboardInput.resume`: a release event for every button the sim still holds
  that no key or pad button holds, judged like any release). Before, both the pause and the resume flushed the
  queue, the release was dropped and the sim's swing stayed charged: the movement keys kept steering the aim,
  other shot keys did nothing and the swing went off by itself late. `tests/app/pauseRelease.test.ts` (which also
  shows the old path leaving it charged) and `tools/pad-check.mjs` hold it.
- Not verified with people or hardware: a real screen reader, physical controllers, colour-blind players
  (OPEN_QUESTIONS.md).

## Phase 9: expert review
**The contrapared** (owner's playtest, 2026-10-28: "I can't hit a shot off of it; when recovering the human does a
weird move instead of possibly hitting it off of their back glass as they do in real life"). A ball that has bounced
and got behind the player, close to their own back glass, is turned on and played up into that glass so it comes off
it over the net (FIP 13.l: the hitter's own glass is legal before the ball crosses, their mesh is not).
- **Shot** (`SHOT_CONTRAPARED`, `data/shots.json`): `ShotSolver.solveContra` aims at the target as seen in the glass
  (the mirror image), takes the elevation through the aimed glass height (1.9 m, higher on a retry), finds the speed by
  secant on the flown landing and turns the yaw for the sideways miss, all flown through the real ball with the walls
  (`flyWalls`). A launch is clean only if the own back glass comes first, below its top, nothing else is touched, the
  net is cleared by 15 cm and the ball comes down on the far half. 4-9 flights, 0.6 ms on average on the strike tick
  (2 ms at most).
- **When**: `planStand` adds a contrapared candidate for each sample after the bounce, 0.75-2.8 m from the glass and
  0.3-1.55 m up, standing on the net side of the ball facing the glass, with a turn of 0.15 s on top of the run and a
  cost of 1.1 over a comfortable stroke plus the same pace/hurry cost as any ball, so it is only played when no stroke
  facing the net is on in time. Contact windows for it (`findWindows(..., contraGlass)`) are behind the body by 0.1 m
  or more and 0.45 m or more off the glass. The AI plans it the same way and aims it deep cross or middle.
- **Human path** (the owner's bug): the plan was there but the swing never took it. Two causes found by tracing the QA
  bot: the turn was charged again on every re-plan, so in the last 0.2 s before the contact a contrapared plan was
  always out of time and fell back to a stroke facing the net, which whiffed; and an out-of-time contrapared was left
  out of the least-late fallback. Now the plan remembers that the player has turned (`StandPlan.turned`) and the
  contrapared competes in the fallback. QA bot (10 seeds x 240 s): 23 of 33 contrapared plans played (was 4 of 21),
  21 of them came back and the rally went on.
- **AI** (6 seeds x 300 s): 1.4% of hits (was 0.3%), 13 of 14 returned. No published frequency was found; it is a
  rare defensive save in pro play, which this matches in kind.
- **Body**: its own stroke (`FH_CONTRA`/`BH_CONTRA`, `Family.glass`): the stance turns round to the glass, a short
  low backswing (no room), a steep lift with the face well open, finishing high. The forehand facing the glass is on
  the other side, so the sim's hand side flips too. Face centre to ball at contact p50 under 1 cm, stance square to the
  glass at every contact (`tests/render/contrapared.test.ts`). The HUD hints "Contrapared · turn and play it up into
  your own glass" (the existing hint pill; any shot key plays it).
- Tests: `tests/sim/contrapared.test.ts` (solver, swing errors: over 80% still go glass-net-court, AI share and
  legality, the human path).

**The racket and the grip** (owner, 2026-10-28: "make the padel rackets look more accurate and fix their grip on it").
- **Racket** (`render/avatar/racket.ts`, render only; the sim's racket stays `data/rackets.json`): to the FIP limits
  and the sim's own frame (tip 14.5 cm above the face centre, butt 31 cm below): a round head 26 x 28 cm, 38 mm thick
  with rounded edges, 52 holes of 13 mm in a hex pattern clear of the rim, the open throat ("heart") between two arms,
  a 12.5 cm grip in white overgrip wound in a spiral, a flared butt cap, and the wrist cord looped round the wrist. The
  cosmetic is generic (carbon twill, a glossy rim, one accent stripe). 5.5k triangles, shared geometry and materials.
  It replaces a cylinder for a head and a stick for a handle.
- **Grip** (`render/avatar/grip.ts`): the old handle ran along the fingers 30 degrees off them, its axis 3.5 mm off the
  palm's bone line, so half the handle was inside the palm (84 skin vertices up to 4.5 mm inside it), finger joints
  were inside the handle, and the wrist hung past the butt. Now it is the continental grip padel is played with: the
  handle lies across the palm from the heel pad under the little finger to the base of the index finger (53 degrees
  off the fingers on this hand, the racket at about 127 degrees to the forearm), a handle's radius off the palm's
  surface as measured from the mesh, the heel pad just over the butt cap, the face turned 35 degrees from square to the
  palm towards the thumb side. Each finger closes in a power grip's proportions (knuckle : middle : end joint 0.75 : 1 :
  0.65) until a segment touches the tape, then its far joints go on closing; the thumb is solved onto the side of the
  handle, part of the way round towards the fingers (a straight reach to the middle finger went through the handle).
  Solved from the body's own mesh and skeleton at load (8-16 ms a hand), so another body grips as well.
- Measured (`tests/render/grip.test.ts`, `node tools/anim-check.ts`): 9 skin vertices at most 2.1 mm inside the handle;
  every finger joint outside it and the fingertips on it; hands mirror to under 2 mm. AI doubles, 3 seeds x 60 s: hand
  in torso 0.05-0.13% of frames (was 0.7-2.1%), pops 7.5-12 a minute (was 15-22), racket to ball p50 8-9 mm, p90 2.6-3.6
  cm, racket in body unchanged (0.1-0.2%).
- Captures: a hidden tab runs no animation frames, so three's node frame never advanced and the post-processing's
  scene pass kept its first render; `Game.renderOnce` advances it (captures with bloom on work again).

**The racket, second pass** (owner, 2026-10-29: "the racket looks unrealistic").
- **What was wrong**: the first racket was an ExtrudeGeometry with one bevel segment (hard flat edges), about 60
  identical holes in a plain hex grid with walls the black of the face, a 256x448 twill texture with one stripe, a
  plain cylinder handle and MeshStandardMaterials: up close a flat black disc with dots, at the TV camera a black blob.
- **One racket per player** (`data/racket-looks/p1-p4.json`, by player number as the people are): shape (BRASA
  diamond, MAREA round, CIERZO teardrop, ORBITA round), throat (teardrop or rounded triangle), finish (sand, matte,
  gloss), hole size, pitch, rows and blank zones, protector (solid or translucent), grip, tape, cap and cord
  colours, and the art. `balance` and `weight` describe the racket only: the sim's racket (`data/rackets.json`) is
  physics and unchanged. `views.ts` dresses each avatar's racket (`dressRacket`); avatar.ts is untouched.
- **Shapes**: every outline keeps the tip at RACKET_TIP (the frame's outline tops out 0.9 mm under it, the protector
  makes up the rest, so the racket is 45.5 cm with it), the butt at RACKET_BUTT and the face centre at the origin.
  Round: the 26 x 28 cm ellipse, widest at the face centre. Teardrop: widest about 4 cm up (3 cm before the review). Diamond: widest 5.5 cm up,
  flat shoulders, near-straight sides. Widths are scaled to 25.98 cm at most. The arms are straight tubes from a tight
  concave turn off the head to a straight neck that runs up out of the finishing tape (the first try let the corner
  rounding eat the neck, so it flared inside the tape and poked through it); the heart is the outline offset in by
  the arms' 17.5 mm, closed under a 15 mm bridge.
- **One mesh, one material** (`racket.ts`, `racketMaterial.ts`): frame, faces, holes, protector, grip, tape and cap
  are one geometry; each triangle carries its region (`rkInfo`), the material (MeshPhysicalNodeMaterial) picks colour,
  roughness, metalness, clear coat and bump by region. 1 draw call plus the cord (was 4 plus the cord).
  - Frame: a superellipse profile (exponent 2.4, 9 mm round from the band, the full 37 mm since the review) swept round
    the outline and round the heart, meeting the faces tangentially; lacquered by the look's frame finish (since the
    review: below), printed from the art's side strips (model name and maker along the sides).
  - Faces: flat, 0.4 mm below the frame's band (the crisp line where face meets frame), matte (0.86 sand, 0.66
    matte) with a sand grit: two grain sizes (0.4 and 1.1 mm) as a screen-space bump, each fading out as a pixel
    outgrows it (bump.ts's rule), the grain also catching a little light; gloss prints and foil from the art's mask.
  - Holes: rows following the face's edge (each row's count and phase chosen from a few that fit the most holes; phase
    0 or a half spacing keeps it symmetric, as it must be: the same holes go through both faces and the back's print
    is mirrored), then a hex grid shifted to fit the most, blank zones kept clear for type (ellipses in data). 57-63
    holes of 12-13 mm (50-61 since the review's blank zones under the names), at least 8 mm of wall between, the margin
    from the face's edge held. Each hole is a front chamfer (0.7 mm), the wall and a back chamfer (14 sides since the
    review); the wall is banded by depth in the shader: 1.6 mm skin, the EVA foam (off-white, pores), skin, and darker
    towards mid depth (a 13 mm hole 37 mm deep sees little sky). The first pass printed a skin-coloured ring round each
    hole; the review found it read as heavy black outlines on a white face (below).
  - Protector: the frame's profile stood 0.9 mm off over 28-32 cm round the tip, reaching 2.5 mm onto the band each
    side, thinning over its last 12 mm to a squared end; solid rubber or, translucent, the frame's print through it.
  - Bridge: a raised logo plate (0.5 mm) with the mark in foil.
  - Handle: the overgrip is a helical mesh whose rows follow the tape's edge (16.5 mm a turn, a real 0.7 mm step per
    turn, a groove at its foot), mean radius HANDLE_R all along, so grip.ts's solve and its tests are unchanged; the
    shader darkens the foot of each step and lights its lifted edge. A finishing tape (printed) wraps over the
    grip's end and onto the neck, closing the collar's top. The butt cap flares round the heel of the hand to a flat
    end plate with the logo, the cord leaving through its centre; the cord is braided (two crossing helices of
    strands in the shader) in the racket's colour (dressRacket repaints it when the avatar swaps hands, through
    `childadded`).
- **Graphics** (`racketArt.ts`): in the first pass one canvas per racket at 5 px/mm over the face (1352 x 2008: the
  face, two side strips for the halves of the outline, the tape's print, the cap's logo) and a quarter-size mask (gloss
  print, metallic foil); the sides have their own canvas since the review. Four original designs: chevrons on carbon
  twill with foil pinlines (BRASA; ember and gold before the review), a tide wave on
  white (MAREA), a split cobalt panel with lime cuts (CIERZO), orbit rings and a halftone on gloss black (ORBITA).
  The maker is the game's own mark (BANDEJA, a ball over a tilted tray), the names are made up, the type is the
  system sans-serif (nothing downloaded). The back is the same print mirrored, so it reads the same from either
  side. Texture memory in the first pass: about 15 MB a racket with mips, 62 MB for four (was under 1 MB); halving
  the canvases on the Low preset is the lever if that budget gets tight.
- **Level of detail** (`RacketLod`): a far level (no through-holes, the plain handle; about 1.7k triangles; its holes
  painted in a hole's tone since the review) when the racket is small on screen. three's LOD measures plain distance; this
  scales it by the lens (switch at 6 m through a 45-degree lens: the broadcast camera's 26 degrees from 17-30 m
  always gets the far level, a long lens the near one). Each camera keeps its own choice and hysteresis (a
  spotlight's shadow pass picked the far level and then moved the view's threshold); orthographic shadow cameras
  leave the view's choice, so the key light's shadow shows the holes. At the TV camera the rackets read in their
  colours (white MAREA, magenta-edged ORBITA) instead of black blobs, with no sub-pixel holes to shimmer.
- **Cost** (first pass; after the review below): near level 13.7-14.3k triangles plus the cord's 480 (at most 14.8k a
  racket), far 1.7k; 2 draw calls a racket. Geometry, material and textures are shared per look and cached; disposeTree frees them with the match (the
  textures are also material properties for that) and three uploads them again for the next. Nothing is allocated
  per frame (RacketLod uses module vectors; the levels are toggled, not rebuilt).
- Measured on both backends (WebGPU and `?backend=webgl`): the same pictures, no console errors, the game running.
  Captures: `bash tools/one-chrome.sh node tools/racket-shots.mjs <outdir> <prefix> <builddir> <port>` (review
  cameras, studio close-ups from the racket's own frame, the four side by side, the TV view with each racket's screen
  position; `AT=` the moment, `RP=` whose racket, `ONLY=` shots). `node tools/racket-stats.ts`: triangles, size and
  holes per racket. Trap: `tools/one-chrome.sh` sets `T` for its queue ticket, so an environment variable named `T`
  passed through it arrives as a path.
- Tests: `tests/render/racket.test.ts` (every racket inside FIP's length, width, thickness, handle and hole limits;
  RACKET_TIP/BUTT/HANDLE_R and the tip and butt where the sim has them; the face centre inside the face; each shape's
  widest point; holes inside the face, clear of the margin, the blank zones and each other, mirrored, every wall in
  the mesh; draw calls and triangles; the overgrip's mean radius at HANDLE_R with a real step; the level of detail
  through the lens, its hysteresis and shadow cameras; dressing and cord; disposal); `tests/render/grip.test.ts`
  still green.
- **Review fixes** (2026-10-29, an independent review of the branch: one high, four medium, ten low findings; the
  captures are `scratchpad/racket-shots/final-*`):
  - **The neck came through the finishing tape** (high; every racket, both backends: 56-72 frame vertices up to 4.2 mm
    outside the tape at its top). The neck is a rounded rectangle about 30 x 37 mm whose corners reach 19.8 mm from the
    axis, and the bottom of the outline's sweep (the profile swept along the neck's flat bottom) rose 9 mm into the
    collar at full width; the tape was a round lathe narrowing to 14.8 mm at its lip. Now the frame's sweep is cut open
    2 mm inside the tape (`NECK_CUT`; the band's flat polygon closes straight across there) and the tape is a loft:
    round on the overgrip, flaring over 16 mm into the neck's own section (ray-cast from the sweep's profile,
    `neckRay`) and lying 0.4 mm over it up to its edge on the neck. Its columns stand at the section's own corners
    (an evenly spaced tape cut 0.2 mm inside the neck's corners between columns; the test caught it). This also ends
    the "chunky cuff": the collar is now a flare from the 35 mm grip into the 30 x 37 mm neck, as a moulded handle is.
    Test: no frame vertex below TAPE_Y1 lies outside the tape's section at its height (both levels), the frame stops
    inside the tape and the tape ends on the neck.
  - **Holes popped at the level switch** (medium): the far level printed each hole as a disc in the skin's colour and
    darkened the face 10%, so at about 99 px of racket the holes flipped from lit foam to dark dots (or vanished on
    white). The print now runs on under the holes (the near level never shows it there; the chamfers do), and the
    mask's blue channel marks the holes, which the far level paints in a hole's tone, the foam's colour times 0.28
    (linear), measured: at the switching distance the near and far levels' mean colours now agree within 3-6 levels
    of 255 for all four rackets (they were 15-17 apart) and the mean per-pixel difference halved (17-20 to 8-11). The
    switch stays at about 99 px (`LOD_NEAR` 6 m through a 45-degree lens).
  - **The lacquer was a mirror** (medium: black frames read chrome or navy, the heart's walls streaked): clear coat 1 at
    roughness 0.05 over 0.3. Each look now has a `frameFinish` (racketMaterial.ts `FRAME_FINISH`): gloss = roughness
    0.4 under a clear coat of 0.7 at 0.17, satin 0.48 / 0.4 at 0.3, matte 0.66 and no coat (BRASA is matte, MAREA and
    ORBITA gloss, CIERZO satin); the heart's sweep has 12 profile steps (was 8), the cap is semi-gloss (0.42, coat 0.3).
  - **Holes went through the model names** (medium: BRASA read DRASA, ORBITA's R and B pierced, CIERZO on holes): a
    blank zone (data) under each name and the type round it, and one under ORBITA's emblem.
  - **BRASA's colourway** (medium, a brand risk: black diamond, orange-red chevrons and gold lines is close to a current
    pro line's signature look): now teal to deep petrol chevrons with ember foil pinlines, a teal protector and a matte
    black frame.
  - **The frame's side print was half the face's resolution** (2.5 px/mm, blocky up close): the sides have their own
    canvas (2048 x 456, `sideLayout`), each half of the outline laid out piecewise along it, so the type along each
    side gets about 8 px/mm and the protector's print about 4, the plain runs between less; across the profile 4.8
    px/mm by arc length (was by profile step, sparse in the middle where the type is).
  - **The protector was a plain band**: it now has its own print in the side canvas (its colour, or the frame's print
    under a milky tint of it when translucent; a moulded line along each edge; BANDEJA along each shoulder), a fine
    moulded grain, a 0.2 mm square edge on the band (was 0.05 mm) and 16 mm bevelled ends; it lies 0.45 mm on the faces
    and 0.9 mm round the outside.
  - **Thickness**: the frame is 37 mm (was 36) and the protector's 0.45 mm a face makes 37.9 mm, the "38 MM" printed
    (test: within half a millimetre of it, still at most 38).
  - **Holes**: 14 sides (was 12; 16 would have put the racket over 15k triangles), chamfers their own region showing the
    face's print darkened (0.62) instead of the skin's colour, no printed ring: the wall's top 1.6 mm is the skin line.
  - **A black overgrip's spiral vanished** (the step's shading multiplied a near-black): each turn's lifted edge now also
    adds a little light and is smoother, scaled by how dark the grip is.
  - **The tape's scan lines** (a 0.7 mm sine bump drew lines through its print): removed. Its seam is at the back and
    its print strip padded (a dark line showed at the seam).
  - **The wrist cord** was a five-sided 5.2 mm tube: now a flat braided strap 8.4 x 2.2 mm lying flat on the wrist (its
    width along the forearm), with a slider where the loop closes; one mesh, about 600 triangles.
  - **Shapes**: the teardrop is widest 4 cm up and tapers 2-3 cm a side narrower than the round head low down; the
    teardrop throat hangs from an arched bridge with 20 mm corners and a sharp point, the triangle has a straight top,
    4.5 mm corners and a rounded point.
  - **Type**: drawn upright and slanted by our own skew (no synthesised italic), Segoe UI ahead of the generic fallbacks.
  - **Texture memory**: the face at 4.2 px/mm (was 5; a close-up filling a 1080p frame is about 4) leaves room for the
    side canvas: about 14 MB a racket with mips, 57 MB for four (was 62), 43 MB of canvases kept for re-uploads (was 46).
  - **Cost**: near level 13.1-14.3k triangles plus the strap's 604 (at most 14.95k a racket), far 1.7k; still 2 draw
    calls a racket.
  - Tools: `bash tools/one-chrome.sh node tools/racket-closeups.mjs <outdir> <builddir> <port> [backends] [groups]`
    (the review's views: hand camera on each player, studio close-ups at a 4 mm near plane, the level switch side by
    side, body and TV; `PREFIX=`, `ONLY=`).

**The ball's look** (owner, 2026-10-28: "the ball doesn't look real").
- Felt (`render/ballLook.ts`): the old ball was one flat yellow with a thin seam line, so up close it read as a
  plastic sphere. Now the felt is mottled at three scales (patches, fibre, fine nap) between a duller and a brighter
  yellow-green, presses darker beside the seam, the seam is a whiter sunk rubber line (rougher felt 0.95, smoother
  seam 0.5), a soft sheen gives the nap's glow at grazing angles, and a thin transparent shell 4.5% outside the ball
  carries stray fibres on the silhouette only (opacity from noise times the edge term, no depth write). At the TV
  camera the ball is 12-15 px across and reads as a felt ball with a seam; the extra cost is one draw call per ball.
- Trail (`render/views.ts`): drawn only while a struck ball is in play. It used to be drawn from the toss, so during a
  serve it hung under the dropped ball like a string, and it stayed behind a dead ball between points.

**The physics audit** (owner, 2026-10-28: "make sure everything is right as well, physics wise, if it's not, fix
it"). A workflow of auditors measured the sim against published figures and a second set re-measured and tried to
refute each finding (scripts and traces in the session scratchpad, `physics-audit/`). Nine findings; one refuted (F3),
three left open with what would settle them (F4, F7, and F6's pressure term: OPEN_QUESTIONS.md, Phase 9). Fixed, each
measured against an unchanged copy of the previous commit on the same seeds (AI doubles, 24 matches x 600 s):
- **F1, AI smash speed by level.** The in-play smash median was 144 km/h at every AI level (n 482), above every
  measured figure (semi-professionals 133 unopposed and 121 against opponents, amateurs 125 and 105: Rivilla-Garcia et
  al. 2019; trained men off fed lobs about 133: Saez de Villarreal et al. 2023). The auditor's cause (power counted
  twice) was refuted: the 138 km/h calibration already had power held. The fix keeps a human's power smash and gives
  the AI a smash effort by level (`data/ai-skill.json` smashEffort 0.70 / 0.80 / 0.88 of the full power swing, as
  `ShotRequest.power`): median 132 km/h at level 1 (p10 113, p90 141) and 109 at level 0 (was 141). Rallies at level 1
  are a little longer (12.1 strikes a point, was 10.4), since fewer smashes are winners.
- **F2, the sprint's force-velocity profile.** Propulsion fell to zero at the run cap (6 m/s), so the push faded
  early. It now falls to zero at its own intercept (`data/tuning.json` fvSpeed, scaled sideways and back by the
  direction's top speed) and the run is capped as before; `Player.runTime()` follows the same law (exponential to
  the cap, then on at it), so the planner agrees within 40 ms at 5 and 10 m (`tests/sim/splitstep.test.ts`). The
  auditor proposed v0 8.5-9 m/s (field sports' 7.5-11) with accel 10.5-11; the verifier kept accel 8.5 (F0, under the
  shoe's grip) and the start ramps as calibrated. I fitted v0 to the one padel sprint number that doesn't depend on
  how the clock was started, the 5-10 m split (0.85-0.89 s): with the 6 m/s cap any v0 of 7 or more reaches the cap
  by 4-5 m and gives 0.833 s, so v0 is 6.5 (0.858 s; 0.900 before). 5 m from a stance 1.53 s (was 1.56), after a
  split-step 1.41 s (was 1.44).
- **F5, the AI's run effort.** Every AI player hit its top speed every few minutes. Traced (wrapping `drift`): most
  per-match peaks were formation moves with the deadline floored 0.4 s ahead and re-set every tick, so the time-left
  speed asked for a flat-out sprint over any 2-3 m reposition. The AI now chases at 0.88 of the top speed that way
  (`chaseEffort`) and moves into the formation at no more than 0.8 of it (`formationEffort`), flat out only when the
  time left asks; what sets the peaks now is late chases (under 0.3 s left over about 2 m). Per-match peak at level 1:
  raw 4.88 m/s, 0.5 s average 4.59, 1 s average 4.34, the same as before F2's stronger push (4.88 / 4.55 / 4.34);
  WPT men's tracker-smoothed median is 4.2 m/s over 85-minute matches (Miralles et al. 2025). Reach is unchanged:
  points ending on a double bounce 28.3% (30.7%).
- **F6, the altitude ball.** `?ball=standard|altitude`, and above 1,000 m (`?alt=`) the altitude ball unless asked
  otherwise (FIP allows it there; its drop test is 122-135 cm). The menus play at sea level. No pressure term: no
  measured rebound-vs-altitude figure was found (OPEN_QUESTIONS.md).
- **F8, the roof.** The hall's roof is drawn at 9 m and about 1 strike in 90 went through it. `Environment.ceiling`
  (the arena's `hall.height`: club hall 9 m, stadium 19 m, outdoors none, `app/options.ts roofOf`) gives the ball a
  roof (`BallWorld.roofY`, checked in `checkExit`): a touch is `HIT_ROOF`, scored by FIP (`Rally.onRoof`): before the
  good bounce the hitter loses (13.1.g/h/l, `WHY_ROOF` "Hit the roof"), after it, a winner (14.1.d, "Winner off the
  roof"). The ball comes back down off it (30% of its rise, 60% of its pace along: a guess) and the point is over.
  Predictions and the solver's ghosts treat a touch as a dead ball. Players lob under it: the solver lowers the
  height over the net until the flown top is `ROOF_MARGIN` 1.5 m under the roof (drag steepens the fall, so the real
  flight peaks above the vacuum parabola: the first cut, on the parabola alone, peaked 0.2 m over its mark), and the
  contrapared counts a ghost that peaks there as unclean. 0.5 m left 1.6% of lobs touching the 9 m roof (swing errors
  add up to a metre to a steep lob from near the net) and 3.5% of points ending on it; at 1.5 m 3 lobs in 1,400 and
  5 contrapareds in 24 matches (their rebound off the glass is very sensitive to the swing's errors). In the open the
  sim's old "out above 12 m" became 30 m (a safety net; contrapared and lob heights are unchanged: p90 7.5 and 8.1 m).
  The QA army's indoor configurations now have a roof (a third 9 m, the rest 19 m, no new random draw) and feed the
  referee oracle's existing `object` fact (ORACLE-NOTES 23). QA army, 300 matches (`docs/qa/army-p9-physics.md`):
  no disagreement between the game and the oracle; the only new flag was the 14 m height sanity bound, which a
  monkey's wild serve outdoors now passes (the old 12 m "out" stopped it first; the bound is 25 m now).
- **F9, rolling.** A rolling ball's slowdown (0.8 m/s per second, hard-coded) is now per floor in
  `data/surfaces.json` (`rollDecel`, 0.8 on each until a ramp-roll test measures it).
- Tests: `tests/sim/ceiling.test.ts` (the roof's physics, the calls, lobs under it, the arenas' roofs),
  `tests/sim/splitstep.test.ts` (the 5-10 m split and the planner on long runs; both fail on the old profile),
  `tests/app/settings.test.ts` (`?ball=`, altitude, roofs from the URL and the menus), `tests/sim/ball.test.ts`
  (rolling). Allocation unchanged (`npm run alloc`, 3 runs: 3-4 GCs per 100k ticks for the sim, 7 with the bodies).

**The people** (owner, 2026-10-28: "the ball doesn't look real, nor do the people"; approved downloading MPFB 2 and
the MakeHuman CC0 asset packs). The players were the Y Bot mannequin, dressed by the shader. They are now four men
made in MPFB 2 (MakeHuman's Blender add-on) from the CC0 MakeHuman base mesh, skins, eyes, brows, lashes, hair and
clothes, on the game's own skeleton, so every clip, stroke, IK target and the grip work on them unchanged.
- **Build** (`sh tools/assets/mpfb/build-all.sh`, about 30 s for four): `make-player.py` makes a body from
  `data/players/<name>.json` (macro settings, skin, hair, brows, lashes, eyes, T-shirt and shorts, trainers) in a
  background Blender with its own profile under `assets-src/` (the owner's Blender settings are never touched);
  `finish-player.py` (the same session) bakes the shape, scales soles to skin top to the player's height (MPFB's
  macro height is set so the scale is within 2% of 1: a 2.02 m body squashed to 1.80 m had a small head and long
  shoulders), slices the trousers level into shorts, removes skin MPFB's masks leave under the clothes and posts
  the rig. `build-people.mjs` puts it on the game skeleton and writes `public/assets/people/` (380 KB + 140-240 KB of
  textures a person).
- **Bound in the modelled pose.** The mesh stays in MPFB's A-pose and each bone's inverse bind matrix is
  (T-pose world)^-1 x (its move from the A-pose to the T-pose), so at rest the skinned mesh is the T-pose posed
  straight from the modelled shape: baking a T-pose first and skinning that again blends the weights twice (a
  shoulder or elbow loses volume twice over). Only bones that differ from the game skeleton by pose are moved: arms,
  hands and fingers (the forearm and hand also rolled so the palm faces as the game skeleton's), and the legs
  straight down. Shoulders, spine, neck, head, hips and feet keep MPFB's own joints, with the game skeleton's rest
  rotations: the first cut aimed every bone, and turning MPFB's clavicle (28 degrees down to its arm joint) to the
  game skeleton's level one raised each shoulder 9 cm, a shrug. The game reads the T-pose skin (`asset.restPos`)
  wherever it measures the body (soles, grip, capsules).
- **Proportions**, against the mannequin at 1.80 m: hips 1.026 m (0.998), shoulder joint 1.445 (1.436), hand
  0.734 (0.738). The clips' hips travel and the run cycles' ground speed are scaled by each body's hips height (1.01-
  1.06). Soles were 4-5 mm under the floor in the T-pose (straight legs are longer than splayed ones); the skeleton
  goes up by that (the bind matrices stay, so the skin rises with it).
- **Clothes.** The suit's own texture has a printed logo on the shirt and jeans, and the trainers' texture is a
  photograph of a branded shoe with its stripes: neither is used. The shirt and shorts are the kit's colours shaded
  by the suit's ambient-occlusion map (its folds and seams), the trainers are coloured as the mannequin's were (gum
  sole, a stripe in the shirt's colour) and the crew sock built into them (the thin tube above 11.8 cm) takes the
  socks' colour. Sweat patches, fabric folds and the hems' lag work as on the mannequin (`personMaterial`).
  Skin the shirt hugs poked through at the shoulders once the arm moved: the clothes go 3 mm out and skin that sees
  them within 3 cm straight out is removed, except a 2.5 cm band next to open skin, so looking into a sleeve never
  shows a hole in the arm.
- **Two draw calls a person** (body and clothes in one atlas, 1536 x 1024; hair, brows and lashes alpha-tested in a
  second, 768 x 512). Each about 29-31k triangles.
- **The four**: young white man 1.80 m (p1), young black man 1.84 m with a short afro (p2), white man in his late
  thirties 1.77 m (p3), young East Asian man 1.79 m (p4). A short side-swept fringe on p4 was swapped for short slick
  hair (it read as a fashion model, not a padel player). Player n is person n (`PlayerView`), `?people=0` brings the
  mannequin back.
- **The grip on a smaller hand.** MPFB's thumb is 2 cm shorter than the Y Bot's and sits nearer the palm. Reaching
  round the handle, its middle segment went through the grip, and the old fix (move the target outwards) left its
  tip 27 mm off the handle. The target first turns back round the handle towards the thumb's base (three quarter-
  radian tries), then goes out. The tip pad is now kept out by its own thickness, measured mid-segment: MPFB's
  weights give the thumb's segments some palm skin, so their typical radius read 21 mm. Thumb tip now 21-23 mm off the
  handle, its middle joint 7-8 mm (on it); fingertips 6.4-11.3 mm (mannequin 8.1-12.8). The ball of the thumb presses
  4.5-4.8 mm into the grip where it wraps (the mannequin's deepest skin is 2.1 mm).
- **Animation QA**, 60 s of seed 1 doubles each (mannequin | people): skate 17.2 | 12.8-14.5 cm/s, contact p50 7.2 |
  5.9-8.3 mm, pops 23.3 | 18.3-22.5 per player-minute, racket in body 0.13 | 0.21-0.27%, hand in torso 0.09 |
  0.25-0.41%, no flips or knee spins; all inside the mannequin's limits (`tests/render/people.test.ts`).
- Allocation unchanged with the people (`npm run alloc` 3 runs: avatars 6-7 GCs per 100k ticks, as before).
- **Frame rate**, built game, `QUERY=&people=0` (the mannequin) against the people, paired back to back on a
  busy machine (load average 7-11; logs `tools/out/people-*.log`): Medium at CPU 4x 123.8 fps, 1% low 65.7, p99
  13.0 ms | 121.4, 77.6, 11.5 ms; High 2x unpaced 211.2 fps, p99 23.9 ms | 219.4, 21.9 ms; High paced at 120 Hz held
  120 Hz in all four runs, CPU work 1.4-1.5 | 1.9 ms a frame (the four extra skinned meshes). Draw calls 103 | 111,
  triangles in view 896k | 695k (the mannequin's mesh is 55k triangles, a person 29-31k). The second Medium pair was
  dropped: another project's browser check held the machine's one-Chrome lock.

### Review round 1 (REVIEW.md)
The expert review (a professional player's eye and a games critic's) ranked 13 findings; the four High ones are
fixed here. AI doubles at level 1 over 2,040 points, before | after (`node tools/match-stats.ts --points 2000
--level 1`; `docs/review/match-stats-l1.txt` before, `docs/review/match-stats-l1-r1.txt` after). Pro figures: WPT
2020 men (Courel-Ibáñez/Sánchez-Alcaraz et al., *Sports* 2024, PMC11359520), which reports each stroke as the share
of points it appears in; `match-stats` now counts strokes that way too (`inPoints`), and an overhead off the
hitter's own back glass after the bounce as its own class, the bajada.
- **The bajada** (High #2). Pros smash a lob that bounced deep and comes off their back glass high back down
  (14-17% of men's points); the AI never did, since overheads were planned only from inside 6.5 m before the bounce.
  `positioning.offGlassHigh` says when one is on: after the bounce on our half the first wall is the back glass and
  the ball then falls through head height + 0.1 m (`BAJADA_ABOVE`) or higher, 6.5 m or more from the net
  (`BAJADA_DEPTH`). The AI takes such a ball that way with a chance by level (`data/ai-skill.json` bajada 0.03 / 0.12
  / 0.25, drawn once a ball at `onStrike`), planned with the overhead key's planner at the bandeja's height, met no
  nearer the net than 6 m (a ball still high well out of the glass is let drop); 45% are struck flat and hard (the
  smash shape, 6.2-7.4 m deep with margin: from 9 m back a full-pace ball runs long on a small error), the rest placed
  deep like a bandeja; after 40% (per unit of the style's net) the pair moves up. A human gets a hint, "High off the
  glass · hold O for a bajada, with Space smash it down" (the existing hint pill), and holding O already planned the
  ball off the glass. Measured: bajada in 15.2% of points (pros 14-17), W 7.2% FE 7.2% UE 9.2% of them. Tests
  (`tests/sim/bajada.test.ts`): when it is on (a deep lob yes; a drive, a ball into the side glass first, the other
  half no), the AI's share by level and depth, and a human (the QA bot following the hint, `BotHuman(..., hints)`)
  holding O and playing it off the glass. The overhead stroke animates it as it is.
- **Play off the glass** (High #3). The planner added 0.6 to a contact before the glass within 1.7 m of the back
  and took 0.1 off any contact after it, so the AI let nearly every deep ball through: back-wall shots 27.4% of all
  shots against WPT men's 12.8% (2014), all wall shots 32.4% against 19.0-24.5%. That bias was written for the
  owner's wall play, so it stays for humans and the AI has none (`Player.glassWait`: 1 human, `ai-skill.json`
  glassWait 0). After: back-wall 21.2%, all walls 26.5%, groundstrokes before the glass 20.7% (pros 23.1); back-wall
  shots in 71.5% of points (pros forehand 42-45%, backhand 34-36%, so about 60-65% for either). What is left comes
  from where balls land: the probe (16 matches) put the median bounce of a net volley 2.9 m from the back glass.
- **The overhead choice** (High #4). The smash was 49% of the AI's overheads against 26-36% for pros (bandeja in
  44-48% of men's points, flat smash 30-33%), since inside the kill depth the top AI smashed 95% of the time. The
  smash share now falls with how short the landing is (`KILL_SURE` 0.8 m: full rate only 0.8 m inside the kill
  depth). After: smash 31% of overheads, in 28.9% of points; bandeja 33.9%, víbora 24.7% (pros 20-23); smash W 28.4%
  FE 21.5% (was 23.2 / 18.5).
- **Errors and pace** (Medium #5, #6), retuned because the overhead fix lengthened rallies (to 12.7 shots, the
  ladder test's limit is 13.5): the AI's sideways swing spread is wider (`shots.json` swing.motor pathYaw 0.8 ->
  1.8: errors off the side 4.6% -> 9.0%, pros 17; into the net 70.0% -> 67.1%, pros 51) and its spread grows more
  with pressure and less on easy balls (`ai-skill.json` pressure 1.15 -> 1.6, motor at level 1 0.65 -> 0.6: forced
  errors 24.2% -> 25.3%, pros 29-33). Rallies 11.2 -> 11.7 shots (pros 10-11), 15.4 -> 15.5 s a point (13.5-14.8),
  0.73 -> 0.76 shots/s (0.80); endings W / FE / UE 35.4 / 25.3 / 39.3 (pros 34-42 / 29-33 / 29-33). First-serve
  faults 6.2% -> 7.2% (pros about 10). Not closed: the error split and the unforced share stay off the pros' (#5,
  #6 stay Medium, re-measured in round 2).
- **The crowd** (High #1). The stadium's 4,640 spectators were a six-sided cylinder, a box for the thighs, a 20-face
  ball for a head and a cap. They are now twelve MakeHuman people (`data/crowd.json`: men and women, 20s to 70s,
  white, black and East Asian; casual, sport, smart and work clothes; one hat) made in MPFB and rendered in Blender
  (`tools/assets/crowd/`) seated, clapping (two frames) and standing with the arms up, from 7 angles round the front
  (-90 to 90 degrees, 10 degrees down) into a 2048 x 1408 atlas of 64 x 128 cells (base 419 KB, shirt light 109 KB).
  Each frame is rendered with a white shirt and a black one: the black render is the person without the shirt's own
  light and the difference is the light on the shirt, so the game tints each seat's shirt exactly (B + tint x light,
  in linear light) from the old palette of mostly dark and neutral tops. The clothes are plain materials (their
  textures carry logos). In the game (`render/arena/crowd.ts`) each seat is one quad that turns to face the camera,
  shows the nearest angle (half the seats mirrored, so 24 looks), sits so the hips are on the seat, and is not drawn
  when seen from behind (no back view; the stand under the TV camera). What the crowd does follows the point
  (`game/crowdMood.ts`, the same judgement as the crowd's sound in `audio/soundscape.ts`). Through a point it sits
  and leans with the rally. After the point it applauds, more for a long rally, and about half stand for a winning
  smash or víbora, a ball played out of the court, a long rally won, a set or the match. The applause decays over
  2.6 s and the standing over 1.8 s, seat by seat by hash. The first cut clapped as the rally grew, which no crowd
  does mid-point. Traps: three applies the instance matrix
  before `positionNode`, so `positionLocal` there already holds the seat's translation (the first build drew every
  sprite scaled by its seat's coordinates: giants across the court); Blender's `image.pixels` of a 16-bit PNG are
  only the stored values with the colour space set to Non-Color; the system Python has no numpy (packing runs in
  Blender's). Triangles for the crowd 343k -> 9k, draw calls 12 -> 4.
- **The waistband** (Medium #7). The suit's occlusion map was baked with the shorts' top under the shirt, so a shirt
  riding up as a player bends showed a grey band: above the shirt's hem the shorts' occlusion is lifted to at least
  0.82 (`kit.ts` aoShorts).

### The people made real (owner, 29 Oct: "make them look like actual humans, extremely high def")
Close up the players were MakeHuman bodies with a 1024 skin, flat lighting, a bald band between the hair cards and
the forehead, glassless low-poly eyes, no mouth and a face that never moved. What changed, all from MakeHuman's CC0
assets (no new downloads) and our own code:
- **Resolution.** The skin at its source's full 2048 (was scaled to 1024), hair 2048, eyes, teeth and tongue 512
  (`finish-player.py` RECT; atlases 3072 x 2048 and 2560 x 2048). About 1.15 MB of textures a person.
- **Baked occlusion.** Cycles bakes ambient occlusion in the T-pose (10 s a person on the GPU): the skin's goes in
  the atlas's alpha, the eyes' and shoes' per vertex, the hair's from each card's height over the scalp (cards under
  others are darker). The hair cards are left out of the bake (Cycles' AO sees a card's whole quad), and teeth and
  tongue are baked with the mouth open (closed, the lips hide them and they bake black). The game uses it for the
  ambient light, for the specular in creases and under the hair, and a little in the colour.
- **The scalp under the hair.** Rays from each skin texel near the hair, out along the normal, add up the cards'
  coverage (1 - product of (1 - alpha) over every card crossed); the skin there takes the roots' colour and loses
  its occlusion, so the hairline grows out of the skin. The brows get the same at half strength.
- **Eyes.** MakeHuman's high-poly eyes, without their cornea shell: it is mapped to a transparent patch of the eye
  texture and, drawn opaque, it was a lavender cap over the iris (black once lit). The wet cornea is a near-mirror
  clearcoat on the eyeball. Eye colours per person in `data/players/*.json` (`eye_colour`).
- **Teeth and tongue** (teeth_base, tongue01) for the open mouths below.
- **Skin shading** (`kit.ts` PersonNodeMaterial): light bleeding round the terminator (wrap lighting, reddened, as
  pre-integrated skin approximates subsurface scattering), more through the ears; roughness and an oily clearcoat by
  region (lips and lids wetter, the T-zone oilier, all of it shinier with sweat); pores as a 12 um bump that fades
  out where a pixel covers more than a few of them. The regions come from what the expression units move (pursing
  moves the lips, closing the lids, the nose and brow units the T-zone), since MakeHuman's region masks don't match
  its skin UVs; the ears are the head's most lateral skin.
- **Hair**: alpha to coverage over the 4 MSAA samples (soft strands, not a hard alpha-test edge), a dimmer highlight
  tinted by the hair, a soft sheen; the shadow keeps a hard cut (`maskShadowNode`).
- **A face that moves** (`face.ts`, `person_face.py`). Sixteen morph targets from MakeHuman's expression units,
  weighted by each body's own race mix: blinks, squint, brows down / inner up / up, jaw open, lips pressed, smile,
  grimace, sneer, neck tense, and four gaze keys (each eyeball turned 30 degrees sideways, 25 up or down, about the
  sphere fitted to it; the lids follow up and down). The proxies (lashes, brows, hair, teeth, tongue) follow by
  their .mhclo fitting (each vertex = three body vertices' weighted sum, so their keys are the same sum of the body's
  moves; MPFB's own transfer only knows ARKit and viseme names). Only the moving part of the mesh carries them: the
  face (5.3k vertices of 21k) is drawn as its own mesh with the body's material. Driven each frame: blinks every
  2-6 s and at most of their own contacts, the eyes on the ball (what the head leaves them, quick as a saccade),
  effort over a contact (brows down, eyes narrowed, lips pressed; an open-mouthed grunt on smashes and serves),
  breathing through the mouth after running, a smile or a frown after the point they ended.
- **Kit fit** (`person_face.fit_suit`). The casual suit sat 13 mm off the skin (27 at the sides): every vertex
  keeps only 35% of its gap past 6 mm on the torso (folds stay, smaller), the shirt stays 14 mm clear over the
  waistband and hangs freer in its last few cm, the shorts' legs keep 60%, and the waistband goes in under the shirt
  (round 2's #12: it poked through at the small of the back). Moves smoothed over the mesh.
- **WebGPU allows 8 vertex buffers** (skinning takes 5): the person's per-vertex data is packed into three
  (`bodyA`, `bodyB`: one weight per part; `bodyX`: per part, the skin's regions, the eyes' and shoes' occlusion, the
  shirt's sweat). The first build used 11 and drew nothing on WebGPU while WebGL was fine; `people.test.ts` checks.
- Traps: `Image.scale()` on a copy of an image whose buffer isn't loaded leaves the old size (the teeth came out as
  streaks: read the pixels and resize in numpy); a MASK modifier can't be applied with shape keys (masked vertices
  are deleted by bmesh, which keeps keys and attributes); the basemesh's eye joints sit about 1 cm off the eyeballs'
  centres; three's morph texture is vertices x morphs, so keys on the whole 21k-vertex mesh would cost 4 x 7 MB.
- Cost: a person is 37-40k triangles (was 31k), the .bnz 745-790 KB (was 380). Tests: `people.test.ts` (morphs, lids,
  eyeballs turning rigidly, the 8-buffer limit, the parts) and the animation QA per person all pass.

### Review round 2, High #4: one action per overhead
The bandeja, víbora, bajada and smash shared one trophy and one square-on contact; only the finish differed. Now
(`strokes.ts`, from docs/research/serve-and-strokes-motion.md §4.2): the bandeja side-on at contact with the face 25
degrees open and a controlled finish; the víbora lower and out to the racket side, the face less open and turned to
cut the ball's outside, finishing low by the free hip; the smash with a deeper trophy, turning square at contact,
the face flat. The avatar picks the víbora from the overhead key with precision or the AI's intent. Measured
(`tools/out/r2-bajada-anim.ts`, 10 seeds x 300 s): chest to the net at contact bandeja 53 degrees (research 50-60),
víbora 38, smash 5 (all 0 before, i.e. square); racket to ball at contact p50 2.0 / 2.2 / 4.3 cm as before.

### Review round 2, High #2: the overhead game
A net pair let a deep lob go to the glass rather than take it in the air: against a pair at the net 59% of lobs were
answered overhead in the air and 22% off the back glass, and of the lobs landing 7-8 m from the net 9% were taken in
the air (`tools/out/r3-lob-reply.ts`). The planner found the in-air contact 0-0.1 s out of time for the better-placed
player (`r3-lob-cand.ts`) for two reasons:
- Every overhead was planned 0.3 m in front of the body, so the stand spot sat 0.3 m deeper than a bandeja needs.
  Sánchez-Alcaraz et al. 2021 measured the bandeja's contact level with the centre of gravity (-0.01 m) and the
  smash's 0.45 m in front. Each overhead now stands where it is met (`data/tuning.json` overheadFront*: bandeja 0,
  víbora 0.2, smash 0.45, the first read 0.15).
- Every overhead had to come to a stop first. Players take a deep lob's bandeja or smash still drifting back (the
  smash's scissor kick is struck going backwards). An AI's overhead may now arrive at up to 1.5 m/s
  (`Player.ohArrive`, data/ai-skill.json). The planner counts only the braking down to that speed, and the run
  allows it only when the time left asks. The shot's moving error (shots.json swing) pays for it. 1.5 is an
  estimate: no speed at contact is published.
After: 75% of lobs against a net pair are taken overhead in the air and 7% go off the glass.

Smashes came back: 80-89% of those met 4-6 m from the net were returned off the glass, because they were hit flat
from 2.36 m (median) and landed short and low. The smash was planned at 2.42 m, which is under a player's reach:
standing reach is about 1.33 x stature (2.36 m at 1.80 m) and the racket's centre adds about 0.25 m at full
stretch. It is now planned at 2.55 m (no padel study gives the contact height). Out-of-court winners doubled in the
probe (`r3-smash.ts`): 5% to about 8-11% of smashes. A put-away from inside 4.5 m and above 2.2 m is aimed at the
side glass near the opponents' service line (every out-of-court winner in the probe came from there).
- Fewer lobs reach the glass, so the bajada had fewer chances. Before, it came mostly from lobs that passed a net
  pair; only 21% of bajada plans were played as one. Its chance at level 1 goes from 0.25 to 0.9, so the top
  level takes nearly every one it can.
- The contrapared test now counts a contrapared as deep from 6.0 m (was 6.5). Planned with the glass 0.75-2.8 m
  behind, an early release met one at 6.4 m after the RNG stream moved.

Measured (`node tools/match-stats.ts --points 2000 --level 1 --seed0 501`, docs/review/match-stats-l1-r2fix2.txt),
before → after, pros in brackets:
- In points (WPT 2020): bandeja 33.3% → 42.1% (44-48), smash 27.6% → 30.7% (flat 30-33, x3 7-8), bajada 14.5% →
  13.3% (14-17).
- Back-wall shots 21.2% → 17.1% of all shots (12.8).
- Last shot of winners: smash 25.3% → 32.7% (43), volley 50.0% → 45.7% (28).
- Smash winners 28.8% → 34.8% (45). Out-of-court winners 5.1% → 7.8% of winners (17). Shots per second 0.76 → 0.79
  (0.80), seconds per point 14.8 → 13.9.

### Review round 2, High #3: how points end
Round 2 measured these problems at level 1:
- Net volleys ended 50% of winners (pros 28).
- 18-21% of winners hit a body, which the pros' 48/35/17 split has no room for.
- Errors: into the net 65% (51), long into the back glass on the full 18% (28), off the side 9% (17).
- Unforced errors were 37% of endings and forced errors 26% (29-33 each).

- **Body hits.** `tools/out/r3-body.ts` / `r3-body2.ts` classify every winner that hit a body. Over 40 matches, 24
  of 46 hit the partner who wasn't taking the ball. That player had no plan for it and was usually crossing its
  line to the formation spot, too late to stop by the time the ball was on them. A first fix (step out once the
  ball would hit where we stand) made it worse, 44 of 71 hit while dodging, because their momentum carried them
  in. Now the player not taking the ball keeps to their own side of its line where it passes them: the formation
  spot is held at least 0.55 m from it, from the moment the prediction exists (`SimpleAi.formation`). Those hits
  went to 0; the rest hit takers.
  - "At the feet" had aimed at the net player's own x, landing behind them. It now lands 0.6 m inside them,
    towards the partner, just behind their feet line.
  - A volley against a pair at the net is sometimes played short and angled off the side glass.
- **Error mix.** The AI's swing-to-swing spread (`data/shots.json` swing.motor) was mostly height: path pitch 1.0°,
  face 0.6°, pace 3%, direction 1.8°. A pitch error drops a ball into the net long before it puts one past the
  glass: targets clear the tape by tens of centimetres and leave metres before the back wall. More of it is now
  pace and direction: pitch 0.75°, face 0.45°, pace 6%, direction 2.4°.
  - 10% pace (tried) gave pros' split, 53/22/13, but lost 38% of AI contrapareds (11% before). A ball off our own
    glass magnifies a pace error. At 6% they are lost 12-21%.
- **Forced and unforced.** Less base spread at the top level (motor 0.6 → 0.38) and more growth with pressure
  (1.6 → 3.0) put more of the errors under pressure. Level 0.5 goes 0.92 → 0.7 and level 0 1.1 → 0.95, which keeps
  the ladder: the beginners' first-serve faults had risen to 38% with the new pace spread.
  - The forced share hardly moves whatever pressure's weight (24-27% over seven settings). It needs more hard
    balls to begin with, not a different error model. Left as a Medium for round 3.
- **Tests.** Two "never" tests now allow what the new spread makes rare but real, each with the case that showed it:
  - A late bajada met at 5.59 m (the test counts from 5.5).
  - A contrapared into the player's own mesh, at most a tenth of them; the old settings put 2 of 63 there over 20
    seeds.

Measured (2,040 points, level 1, seed0 501; docs/review/match-stats-l1-r2fix3.txt), round 2 → now, pros in brackets:
- Winners that hit a body: 20.5% → 9.2%.
- Last shot of winners: volley 50.0% → 37.5% (28), smash 25.3% → 41.1% (43).
- Errors: net 65.3% → 59.6% (51), long 18.4% → 17.7% (28), side 9.1% → 11.5% (17).
- Endings W / FE / UE: 37.1 / 26.1 / 36.8 → 38.5 / 26.4 / 35.0 (34-42 / 29-33 / 29-33).
- Shots per point 11.3 → 11.3, seconds 14.8 → 14.5. Out-of-court winners 5.1% → 11.2% of winners (17).
- In points: bandeja 40.5% (44-48), smash 35.3%, bajada 15.6% (14-17).

### Review round 2, High #5: between points
Before, a point's dead time (1.1-1.7 s) ended with everyone teleported to their places and the serve 0.5 s later.
Human matches dipped to black over the jump; autoplay and the attract match showed it.
- **The walk back** (`MatchSim.walking`, `walkStep`). After a point, partners meet first: they walk to 0.8 m apart,
  for at most 1.2 s. Then everyone walks to their place at up to 2.2 m/s (a brisk walk, arriving without
  overshooting), with 5 s in all before they are put there anyway. After a fault or let there is no meeting. The
  next serve's moment is drawn only once everyone is in place, and any key a human presses skips the walk.
  - The dead time after a point is 1.2 s (was 1.7): the reactions carry on into the walk.
  - A change of ends still cuts. Nobody walks round the net: the dead time is held 0.35 s longer
    (`MatchSim.cutComing`), and the picture dips (ui/transitions.ts) over the cut, only there.
  - `walkBack: false` keeps the old teleport, for tools.
  - Point end to the next toss: 5.7 s median (`tools/out/r3-walk.ts`; was about 3.3). FIP allows 20 s.
- **The avatar** (`avatar.ts`):
  - **Racket tap.** Partners within 1.3 m during the meeting turn 80% of the way to each other and raise the racket
    in front at shoulder height for 0.75 s (`TAP` in strokes.ts).
  - **Carry.** Walking, the racket is carried low in front of the hips with the free hand on its throat (`CARRY`).
    The run clip's arm swing put it into the thighs in 1-2% of frames; with the carry, 0.2-0.3%. Both keys are eased
    in and out: switched at once they flipped the racket 140-158° in a frame.
  - Nobody watches the ball while walking: it jumps into the server's hand as the walk starts, and the head
    followed it 96° in a frame once that was no longer a cut.
- **The cut-away camera** (`BroadcastCamera.cutaway`, `?cutaway=0` off). While everyone walks, the camera cuts to
  a net-post camera, 1.7 m up and 0.7 m in from the side glass, on the side of the pair that won the point. It
  follows their middle (34°) and cuts back to the broadcast angle for the serve, as TV coverage cuts to a pair
  after a point. The cut also hides the ball going into the server's hand.
- **The server's routine** (`BallView.serveBounce`, drawn only; the sim holds the ball). 0.25 s after everyone is in
  place, two bounces from the hand, 0.5 s each, with the bounce sound (`Soundscape.routineBounce`).
- **Bugs found on the way.**
  - The AI's "out of reach" flag survived from the last rally into the next serve.
  - The avatar's own "beaten" flag did too: the serve's branch never reset it. A serve after a rally the server
    lost on a ball out of reach held its backswing and swung 0.1 s late. 4 of p0's serves in seed 7 met the ball
    0.06-0.11 s after the sim's contact. Both are reset now.
- **QA.** animQa's serve measures no longer count the server's walk back (it counts with the rest of play). The
  left-hander mirror test plays 120 s (12 of their hits in 90 s now).

## Review round 2 #15: the floor option shows (2026-10-29)
- `?floor=hard|carpet|clay` had changed the bounce and the sound but not the picture: the court was always drawn
  as the arena's turf. `arenaDef(arena, floor)` now lays that floor's look over the arena's
  (`data/floor-looks.json`, sources in its `//`). What an entry leaves out stays the arena's, so a blue hall is a
  blue hard court; clay is always terracotta. Neighbour courts take the same floor.
  - Hard: painted acrylic, no sand, no rolls, satin.
  - Carpet: no infill, 2 m rolls.
  - Clay: brick dust, paler dust showing.
- `tests/render/floorLook.test.ts`. Captures: r3-floor-clay (club-day), r3-floor-hard (hall), r3-floor-carpet
  (stadium).

## Review round 2 #7: bajadas the racket missed (2026-10-29)
- **What the misses were.** `tools/out/r3-baj-anim.ts` prints every bajada's contact: stroke, height, where it was
  against the body, speed. The misses were nearly all AI smashes off the back glass, met 1.0-1.1 m in front of the
  body at 2.5-2.7 m with the player still running (2.3-2.7 m/s). No arm reaches that far out that high. The
  animation was right to miss: the sim accepted the contact.
- **Cause.** The sim's reach was a cylinder: `reachMax` 1.35 m across the floor at any height up to
  `contactMaxHeight` 2.75 m (1.6 m at the moment of the hit).
- **Fix.** `reachAt(y)` (`contact/windows.ts`, `data/tuning.json` //reachHigh) is used by the windows (plans, the
  AI's release tracking) and by the hit itself. It is the full 1.35 m up to the shoulder plus a small jump. Above
  that it is a sphere about the shoulder (1.05 m to the face's centre), plus 0.3 m for the shoulder's offset and
  lean. That gives 1.10 m at 2.35, 0.87 m at 2.55 and 0.3 m at 2.75, all derived from stature (Drillis & Contini).
- **Measured** (16 seeds x 200 s): bajadas over 25 cm from the racket fell from 3 in 8 to 1 in 5. The worst miss
  went from 0.97 m to 0.31 m (a víbora 1.29 m out at 2.06 m, inside the reach; the avatar's 40 cm hip reach falls
  short). Every overhead class is at 0-2% over 25 cm. Match stats at level 1 (2040 points) are within noise:
  - smash 3.6% of shots (3.8)
  - smash 39% of winners (41)
  - 11.2 shots a point (11.3)
  - whiffs 0.2% of errors (0.5)
- `tests/sim/reach.test.ts`.

## Review round 2 #12, again: the shirt's hem (2026-10-29)
- **Still there.** After the people pass, the merged build's back views (`cam=body`) still showed round 2's
  ragged dark notch at the shirt's lower back. It had steps the size of the suit's faces, and in one frame the court
  showed through.
- **Cause: the hems' cloth lag** (`kit.ts`). The spring moves the shirt's hem by a lag vector whatever way the
  surface faces. A lag pointing into the body, as the player pulls up or turns, put the back hem behind the shorts.
  Where the skin under the shirt is removed, the hollow body showed through. Now the part of the lag into the body
  is dropped (`hemLag`, against the skinned `normalLocal`). The hem still swings out and sideways, never in.
- **And the shorts under the shirt** (`person_face.cut_shorts_under_shirt`, build time). The waistband sat a few mm
  under the shirt.
  - Shorts with the shirt within 3 cm straight out are removed, except a 2 cm band by the shorts that show (115
    faces a player).
  - What stays under the shirt goes 1 cm in towards the body. So does the showing shorts within 5 cm of the shirt,
    graded to nothing. The skin under it is removed anyway.
  - Moving only the band did nothing: the suit's faces are 3-4 cm across, longer than the band.
- **Checked.** 12 back views (4 players x 3 moments, seed 7): no notch, no steps, no see-through. Before the lag
  fix, 3 of the 12 showed one.
