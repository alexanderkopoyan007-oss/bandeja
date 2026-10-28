# Open questions

Only things that genuinely couldn't be verified, each with what would settle it.

- **No reference material.** The brief points to `/reference` (photos, `/reference/video`, `/reference/audio`), but
  it doesn't exist on this machine. Anything below that asks for footage or photos could go there.

## Phase 1 (ball physics)
- **Padel glass rebound.** No published speed in/out, angle in/out or spin effect for a padel ball on tempered
  glass. Gea García et al. 2021 (doi 10.1080/24748668.2021.1875778) compared glass and concrete with 200 drives but
  is paywalled. The game uses a rigid wall x 0.985 and glazed-tile friction 0.35. Settled by: that paper's Table 2,
  or 240 fps phone video of balls into the back glass (in and out speeds and angles from the frames).
- **Mesh rebound.** Nothing measured, padel or proxy. The game's mesh (restitution about 0.3-0.35 at rally speeds,
  12° random normal, up to 18% random speed loss) is tuning. Settled by: slow-motion video of balls into the side
  and back mesh.
- **Off-the-back-glass trajectories.** A topspin drive bounced 3 m from the glass comes off it at chest height a
  metre out and would land 11.6 m back (past the net) if nobody touched it; a slice dies 2.4 m out. These follow
  from the friction and spin, but no study has filmed them (the floor gives the drive about 4,100 rpm of forward
  spin, which the glass turns into about 5 m/s upwards; with that spin taken away it would come back 5.3 m, and
  real balls may lose more spin at the glass). Settled by: broadcast or phone video of wall play.
- **Pressure loss within a match.** Unmeasured. The one measurement (IBV/Testfakta, 666 strokes) shows rebound
  rising slightly, FIP only caps the change at 4 cm after 9 simulated games, and retail claims of balls going flat
  in 1.5-6 h are unsourced. The game's ball doesn't lose pressure during a match.
- **Turf scatter.** The sand's scatter is tuning: a 2° sideways turn of the rebound, a 0.3° tilt and up to 3%
  speed loss, so the ball's line wanders about 1.7° while its bounce height stays within a few per cent. No
  measurement of bounce scatter on padel turf exists, and whether sand changes bounce height more than this
  (dead spots where the sand is thin) is unknown. Settled by: high-speed video of drives landing on padel turf.
- **The rincón and the corners.** A ball reaching the floor and the glass (or two walls) within a contact time
  (4 ms, from tennis) is solved as one squeeze, with up to 30% extra loss in the exact nick (tuning). How a padel
  ball really comes out of the rincón, and how dead the exact nick is, isn't measured. Settled by: slow-motion
  video of balls landing at the foot of the glass.
- **Worn ball off the racket.** The ball's restitution rises about 1% as it wears (IBV, off the court); the
  racket is assumed to see the same rise.
- **Real balls drop higher than the game's.** IBV's new balls dropped 141-153 cm (mean about 147, some above
  FIP's 145 cm cap); the game's ball drops 140.6 cm, inside FIP. Whether to move it towards 145 is open: nothing
  says which brand the game's ball is.
- **Sources not read in full.** Dignall's thesis (0.80 → 0.60 restitution, Hamilton's 100.7%, glazed-tile SPR
  65.5) is over the fetch limit and was quoted from the research agent's notes; Cross 2010's clay friction 0.70
  is not in the abstract (Cross 2008 also gives clay e_y about 0.85, above hard, while the game keeps clay below
  hard: clay is a fantasy surface). The NIDE sheet is a scan; a Walloon padel sheet also asks for rebound of 80%
  or more.
- **Frames.** The irregular bounce off frames (22° random normal) is tuning; it depends on each court's
  construction (tube sections, how flush the mesh is).

- **A second surface met just after a bounce** (Phase 1 review round 2): the junction looks for a second surface
  along the incoming path. When the first bounce's friction turns the ball into the glass (heavy spin at the foot
  of the wall), the glass is met 0.5-5 ms later as a separate contact, and the floor can follow 1 ms after it,
  which the rules count as a second bounce. In real play such a ball is pinned in the rincón and unplayable, so
  the point goes to the hitter either way; left as it is.
- **Junction calls in the last few millimetres** (review round 5, all Low): whether a ball squeezed at a wall foot
  touched the second surface is decided by a rule ("reached": flown there, within half a contact time at its
  closing speed, or the floor within 5 mm). Against the reviewer's independent contact model about 3.4% of balls
  that have bounced and come down onto the back glass within 5 cm of the floor get a different call (mostly balls
  within 3 mm of the floor); a friction-aware travel estimate (prototype in the review's `fixA/`) cuts that to
  about 2%, but the reference model is no more certain than that. The junction also bounces a ball off a second
  surface it never reaches, so a serve within 1 cm of the side mesh can miss a fence fault (63 in 20k on the
  narrow singles court, about 1 in 20k on standard), and the nick is a distance, not a time (FIP: "good in the
  nick"). A ball that leaves a wall-first junction dying is put on the floor 1-2 cm early. Settled by: high-speed
  video of balls at a padel wall's foot (none published), or the owner's call on a time-based nick.

## Phase 2 (game feel)
- **Display latency on the owner's machine.** `tools/latency.mjs` measures key → sim → frame drawn → GPU done in
  headless Chrome; the last step to light on the panel (compositor, display scan-out) isn't measurable from a
  page. Settled by: a 240 fps phone video of a key press and the screen (or the owner's feel of `?runahead=0`
  against the default).
- **Racket sound.** Synthesised and tuned by ear; no recording of a padel ball on a padel racket was analysed
  (sweet spot vs frame). Settled by: recordings (Phase 6), the owner's `/reference/audio` if it appears.
- **Timing window sizes.** The base windows (Perfect ±25 ms) come from screen-tapping precision (about 12 ms SD)
  and the per-shot multipliers from face angular speed (radii estimated). Whether they feel right is the owner's
  call after playing: the `?timing=` setting scales them all.
- **Split-step pre-load and build-up.** `startFrom` 0.2, `startRamp` 0.3 s and `splitPreload` 0.3 s are fitted
  so the split-step's gain matches the tennis data (Uzu, Nieminen); padel-specific measurements of the split-step
  don't exist.
- **The camera kick.** Broadcast cameras don't shake on a smash; the brief asked for a camera response, so it is
  a small push-in and jolt. Whether to keep it is the owner's call.
- **Sprint times.** The game's player covers 5 m forward in 1.56 s from a standstill and 1.45 s once moving. No
  padel sprint time has been read: Portuguese national-tier players and the Kinesiology 8-week training study
  both tested 5 m sprints, but their abstracts give no numbers. Settled by: the full texts' tables (5 m sprint
  mean and how the timing gates were set up).
- **Gamepad audio unlock.** A pad press may not count as a user gesture for starting audio in every browser; a
  pad-only player may need one key or click before sound starts. Settled by: a test on the owner's pad.
- **Input edge cases left open** (Phase 2 review round 3, all low): a key event that reaches the page after its
  timestamp can strike up to a few ms late (1 ms transit, Chrome's usual: 1% of releases, max 0.3 ms; 6 ms: up to
  22%, max 4.9 ms); the pad and the keyboard holding the same button share one bit, so letting go of one releases
  the swing while the other still holds it; with `?assist=0` the aim reads the movement keys at frame time rather
  than at the release moment (moves reach the sim as axes, not as timestamped events). Settled by: the owner's
  playtest on their own machine and pad, if any of them shows.
- **Render and feedback timing left open** (Phase 2 review round 4, all Low): while the render lag eases in after a
  press (about 33 ms) the hold keeps the sim at the last tick before now, so on 165-240 Hz screens a few frames
  repeat or step past the ease (165 Hz: 23 repeats a match-minute's worth of presses; skipping the hold while the
  lag eases in removes them but makes 10-20 ms taps strike late more often). A tap shorter than about 15 ms can
  strike up to 7.6 ms late (the press frame may already have run the sim past now). The camera kick and rumble can
  start up to a tick before the hit is drawn (sound already waits for it). `npm run alloc` drives AI players only;
  a human-path mode would close that gap. Settled by: the owner's playtest on a fast screen; none is visible at 60
  or 120 Hz in the emulation.
