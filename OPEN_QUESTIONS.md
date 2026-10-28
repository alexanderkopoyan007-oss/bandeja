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

## Phase 3 (animation)
- **Clips for motion matching and for better movement.** Six looping locomotion clips can't feed motion matching
  (DECISIONS.md). Settled by: more Mixamo downloads with the owner's Adobe ID, same settings as `docs/mixamo.md`
  (In Place off for these, so the root motion can be measured): runs starting from a standstill forwards and to
  each side, running to a stop, 90° and 180° turns while running, side shuffles that start and stop, a crossover
  step, a backpedal turning into a run (retreating for a lob), and a lunge to each side. Search terms that should
  find them on mixamo.com: "start running", "run to stop", "running turn", "side step", "shuffle", "crossover",
  "lunge". Better still: an hour of capture of a padel player moving freely on court.
- **Video-to-mocap.** Monocular video-to-motion models (for example WHAM, GVHMR, 4D-Humans) could turn match
  footage into clips for strokes Mixamo doesn't have. Not done: it needs the owner's OK to download model weights
  (several hundred MB to a few GB), footage to run it on (the owner's own play filmed side-on at 60 fps or more;
  broadcast footage raises its own rights question), and most of these output the SMPL body model, whose licence
  is granted after a registration (an account only the owner can make) and, as far as its site says, for
  non-commercial research; whether a free public game fits needs the owner to read it. Settled by: the owner's
  yes on all three.
- **Stroke motion beyond the serve.** The serve's key poses follow published padel and tennis measurements; the
  other strokes' contact positions now follow Sánchez-Alcaraz et al. 2021, but their joint angles and timings are
  the M2 key poses with tennis anchors (`docs/research/serve-and-strokes-motion.md` §4.2, §5: padel joint
  kinematics for any stroke are unpublished). Settled by: the de Sire et al. 2024 full text (3D shoulder
  kinematics, pros vs amateurs), or side-on video of the owner's own strokes.
- **What the QA can't see.** `tools/anim-check.ts` measures skating, contact, pops, joint speeds and clipping; it
  can't judge whether a swing looks like a padel player's. Settled by: the owner watching a match (the serve
  especially) and saying which strokes look wrong.

## Phase 4 (AI)
- **Shots off the back glass.** 27% of the top AI's shots against 12.8% for professional men (Mellado-Arbelo et al.
  2019 via `docs/research/shots-movement-feel.md`); per point that is 3.0 back-wall shots against 1.1-1.4 (12.8%
  of 8.9-11 shots; 1.7 only counting side and double walls too, 19% of the pros' shots), with groundstrokes per
  point matching. The excess is long exchanges of deep volleys retrieved off the glass. Not
  settled: no study gives where volleys land or how often defenders take a deep ball before the glass, and the
  planner's glass costs barely move the share. Settled by: a landing-depth distribution for volleys against a pair
  at the back (tracking data such as SAGIT's), or the owner's judgement from watching AI matches.
- **How errors finish.** Into the net 70.6% (pros 51%), off the side wall 4.5% (pros 17%; final 1,000-match run). The side-wall share
  needs targets near the side glass that go wrong sideways; the AI's sideways spread and margins come from the
  line-margin rule, not from data. Settled by: per-stroke direction-error data (the tennis analogue in the
  research notes is a 34-40 m² landing ellipse, not padel).
- **Amateur serve faults.** No study found gives first-serve fault or double-fault rates below professional level.
  The AI's come out of its skill alone (first-serve faults / double faults of second serves, end of Phase 4):
  16.8% / 5.2% (level 0), 12.0% / 2.7% (0.5), 9.4% / 1.4% (0.75), 6.5% / 0.6% (top; pros about 10% / 2%).
- **Doubles teamwork rates.** The distance between partners, how often pairs switch sides on a lob, and how often
  players call the ball are not published (research notes §5: not found). The AI's are coaching geometry: partners
  about 4.0 m apart, a switch after 68-74% of partner-taken lobs to one side (12-36 seeds), about two calls a point.
- **Smash jump height.** No padel figure; the avatar hops up to 0.3 m, as high as the ball is above the toes' reach.
- **Air shots.** Points ending on a swing that misses the ball (late swings at fast balls off the glass, balls
  that died below reach): 13.5% at level 0, 12.5% at 0.5, 10.3% at the top (the verifier's count, before the review
  fixes). No rate is published; professionals rarely miss outright, so the top
  level may be high. Settled by: frame-by-frame coding of a professional match for complete misses.
- **Rally shape and how points end at the top level.** Against the pros: rallies over 11 s are 48% of points
  (26%) and those of 1-4 s 17% (26%), though the mean (10.9 shots, 14.9 s) sits in the pros' range; forced errors
  23% (29-33%); bandejas and víboras finish 3% of winners (13%). The overhead's reward and the defenders' reach
  come from the physics and the error model, not from a fit to these shares. Settled by: per-stroke outcome
  tables by rally phase for professional men (the published ones give totals only), or the owner's judgement
  after watching AI matches.
- **Personalities.** The four styles' traits are set by design (recognisable, not measured from real players); they
  are tested to stay distinct (`tests/sim/ai.test.ts`) but no player's real profile is behind any of them, by rule.

## Phase 5 (visual realism)
- **A realistic body and face.** The players are the Y Bot mannequin (separate shells for the chest, belly and
  joints, no face), dressed in the shader. Skin, hair and clothing can only go so far on it. Settled by: a
  realistic rigged human the licence allows (Mixamo's other characters, downloaded by the owner with their Adobe
  ID, or a CC0 base body from MakeHuman/MPFB, which needs Blender), then rebinding it to our skeleton.
- **Glass reflections of the players.** The arena-glass photo shows the players mirrored in the side glass at
  grazing angles; our glass reflects only the arena baked at load. Settled by: a planar reflection per glass wall
  on the High preset (Phase 8 measures its cost).
- **The broadcast lens.** The camera's height and distance come from Javadiha et al. 2021; the lens (26°) is chosen
  so the court fills the frame as TV frames do, not measured. Settled by: one broadcast frame with the court's
  corners marked, solved with `tools/photo-solve.ts` (a still from the owner's own screen is enough; it is not
  shipped).
- **Sweat timing.** How fast shirts darken (soaked after about a set at the AI's pace) is a guess; no study gives
  sweat patch growth in padel. Settled by: photos of the same players early and late in a match.
- **The cues' colours under the new tone mapping.** The timing rings keep their size on screen, but Phase 5's
  switch from AgX to Neutral tone mapping makes their green and cyan a little brighter and more saturated than
  the owner saw. Settled by: the owner looking at them (unchanged if they like it; `toneMapped: false` or the old
  colours if not).
- **The 15.5 m camera distance.** The paper's abstract gives the 7.6 m height; the 15.5 m behind the glass is from
  its body as read earlier and wasn't re-found in the review. The framing check (the near mesh covering the far
  court to the far service line) holds either way. Settled by: the paper's full text, or a broadcast frame solved.
- **The ball's seam up close.** The seam's distance is stored per vertex (about 4 mm apart for a 4 mm line), so in
  a close replay it renders a little beaded. Invisible from the broadcast camera. Settled by: an analytic seam
  distance in the shader if replays get close-ups (Phase 7/8).

## Phase 6 (sound)
- **No padel recordings were analysed.** Every sound is synthesised from published descriptions and physics; the
  only padel-specific measurements found are qualitative (Piana et al. 2025's spectra peak at 800-1000 Hz
  A-weighted; "glass bangs low, mesh rings high"). How close each sound is to a real court is untested. Settled by:
  the owner's `/reference/audio` (a phone recording at a club is enough: hits, bounces, glass, mesh, feet), or the
  owner's OK to download CC0 recordings (Freesound needs an account, which only the owner can make); the tests then
  compare spectra and decays.
- **Racket face modes.** The padel racket's bending and plate mode frequencies (205, 480, 1050, 1520, 2650 Hz) are
  estimates (no modal analysis of a padel racket was found; a tennis frame's first mode is 146 Hz). Settled by: the
  Loughborough padel racket acoustics paper (ISEA 2024), whose full text was not readable here, or a recording.
- **Room acoustics.** The arenas' RT60s are estimates within published ranges, not measurements of padel venues.
- **Grunts and crowd voices** are formant synthesis: clearly voices, not clearly people. Settled by: recorded
  vocal samples (the owner's own, or licensed), which the engine would play the same way.
- **Speakers.** The glass's boom is mostly under 300 Hz, which laptop speakers barely reproduce; on them the glass
  is mostly its edge and the ball's pop. Not compensated (headphones and TV speakers carry it).
- **The bounce's level against the hit.** The game puts the ball's bounce over 4 dB under a clean drive and the shoes
  15-32 dB under it. No padel measurement of these ratios was found (broadcast mixes put the bounce well under the
  hit, but they are mixed, not measured). Settled by: a recording at a court, read at the camera's distance.
- **A gamepad-only player may hear nothing.** Browsers start audio only from a user gesture, and a pad press doesn't
  count in every browser; a pad-only player needs one key or click. A small "press any key for sound" hint would fix
  it, but it is new UI: needs the owner's OK.
- **Output latency.** Sounds are scheduled at the event's time; the device's output latency (10-40 ms wired,
  150 ms+ on Bluetooth) is not taken off, and Safari doesn't report it. Whether it is noticeable is for a player to say.


## Phase 7 (rules and QA)
- **Out-of-court play** (FIP 13.1.e, 14.1.j, rule 16) isn't built. No court allows it, so a ball that leaves the
  court after a good bounce ends the point, which is the rule on courts without it (13.1.d). Pro events play it on
  courts with space round them, and it is padel's most spectacular rally. Building it means the floor outside the
  court, players and the AI running out through the doors (and round the side for an end-wall ball), returns from
  outside, and new rules tests: days of work. Settled by: the owner saying whether they want it, and for which
  arenas.
- **The FIP readings the oracles chose** (`tools/qa/ORACLE-NOTES.md`, 44 of them) are one careful reading of an
  ambiguous text: which box is "left" in 6.5, 7.1.d reaching the serving pair only before the bounce, a corner nick
  being a glass touch with the ball's centre within 6 cm of the floor, and so on. The game now agrees with all of
  them. Settled by: a referee, or the FIP's own clarifications, on the ones marked as judgement calls.
- **The corner's height** (6 cm for the ball's centre, 2.7 cm for its bottom) is the oracle's reading of "the angle
  where the wall joins the ground", not a measured referee's eye. Settled by: footage of called corner balls.
- **The server's partner and the dropped ball.** Before the serve only the server's racket meets the ball; another
  player's swing at it misses. FIP has no rule for a partner hitting the server's drop (it never happens); the oracle
  read it as the serve's fault. Either is defensible.
- **Monkey thresholds.** Random-input players fail per-minute animation limits set for AI play (they swing three
  times as often). Whether random mashing should look as clean as real play is a call for the owner.
