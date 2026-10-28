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
