# FEEL.md: how the game is meant to feel, and every number behind it

Phase 2 of the realism brief ("game feel"). Each value says where it lives, what it is, and why it is that number:
measured data where there is some (sources in `docs/research/shots-movement-feel.md` and `docs/realism.md`),
derived from data, or tuning (then it says so). Change a value here and in its data file together.

## 1. Input and latency

| Value | Where | Why |
|---|---|---|
| Key events carry `event.timeStamp`; pad events `Gamepad.timestamp` | `src/game/input/keyboard.ts`, `gamepad.ts` | A release is judged at the moment it happened, not when the next frame polls it: the frame rate never moves your timing. |
| Sim at 120 Hz, fixed step | `src/sim/core/constants.ts` | Deterministic; an input inside a tick is placed at its exact time in it. |
| Run-ahead render (default on, `?runahead=0` off) | `src/game/game.ts` tick() | The sim steps until it is at or just past *now* and the render blends the last two ticks to now, instead of drawing a tick behind. Saves one tick (8.3 ms) between a key and the screen. Measured with `tools/latency.mjs` (key → used by the sim → drawn → GPU done, both modes): see Latency results below. |
| ...except while you hold a swing | same | While a swing is held the sim is not run ahead of now, and the picture is drawn one tick behind, blended between ticks as `?runahead=0` draws (drawing the newest tick as it is repeated frames: 17% at 144 Hz, 27% at 165 Hz, 5-25% at 120 Hz by frame phase). The lag eases in and out with the render clock 25% slow or fast, and stays until the contact; the sim is stepped to the drawn moment (now less the lag), so the release neither pulls the picture forward nor leaves it unblended (round 3: before, 63-77% of releases at 144-165 Hz jumped and a fifth repeated a frame). The timing ring counts down on now (render time + lag), not on the drawn moment, so releasing as it closes is not graded a tick late. The cost: a release is drawn a tick later than a press. Otherwise a release arriving next frame for a moment the sim had already passed met the ball up to a tick late: 18-33% of releases at 60 Hz and 34-36% at 120-144 Hz, up to 7.7 ms late. Holding back only the tick with the ideal moment (the first fix) left 6-34%, all releases after the ideal; this gives 0 at 60, 120 and 144 Hz (an emulation of `Game.tick` against the sim, releases at ideal ± 30 ms). |
| Up to 12 ticks a frame, then drop the backlog | `MAX_TICKS_PER_FRAME` | A stall never turns into a fast-forward spiral. |

**Latency results** (`tools/latency.mjs 80`: 160 key events at random intervals, 1600x900, this M1 Max). First
run (the build before the fresh-eyes fixes, run-ahead pass first):

| | key → frame that uses it | key → drawn (render submit) | key → GPU done |
|---|---|---|---|
| Run-ahead (default) | p50 3.9, p95 8.3 ms | p50 4.4, p95 9.0 ms | p50 9.6, p95 60.6 ms |
| One tick behind (`?runahead=0`) | p50 5.0, p95 8.4 ms | p50 9.2, p95 10.4 ms | p50 14.5, p95 17.8 ms |

Re-run with the passes swapped (`LAT_REVERSE=1`, build a8f763d, after fresh-eyes round 2):

| | key → drawn | presses → drawn | releases → drawn | key → GPU done |
|---|---|---|---|---|
| Run-ahead (default) | p50 5.0, p95 8.7 ms | p50 4.8, p95 8.7 ms | p50 5.6, p95 8.7 ms | p50 10.6, p95 14.3 ms |
| One tick behind (`?runahead=0`) | p50 9.1, p95 11.4 ms | p50 9.2, p95 10.6 ms | p50 9.1, p95 11.9 ms | p50 14.2, p95 17.3 ms |

Run-ahead saves 4.1-4.8 ms at the median, key to drawn. The first run's GPU-done tail (p95 60.6 ms) was the
first pass warming up, not the loop: with the order swapped the run-ahead pass has the shorter tail (p95 14.3
ms). The display adds about half a refresh before the next frame starts plus one compositor frame (60 Hz: about
8 + 17 ms; 120 Hz: about 4 + 8 ms). Fresh-eyes round 3 changed how a release is drawn (the picture stays a tick
behind until the contact instead of catching up at the release), so a release is now drawn about a tick later
than the re-run's 5.6 ms; presses are unchanged.

## 2. Timing windows

A shot is judged on when you release it against the ideal contact moment of the incoming ball.

| Value | Where | Why |
|---|---|---|
| Half-widths: Perfect ±25 ms, Good ±60, Early/Late ±110, beyond that Too early/late (a whiff past ±220) | `data/tuning.json` timing | People hitting a falling ball with a bat in the lab manage a timing SD of about 5-7 ms (untrained people; top players 4 ms or less), and 12-23 ms against real or virtual moving targets; tapping moving targets on a screen is about 12 ms SD (Brenner & Smeets 2015). A screen game has no ball-on-racket feel and a display delay, so Perfect is about 2 SD of a good screen player. |
| Timing-window setting `?timing=` (default 1.5) | `src/main.ts` | Accessibility: everything above scales by it. |
| Per-shot multipliers (below), for human players | `data/shots.json` `timing` | The tolerance of a contact is how far the face turns per millisecond. It scales with the face's angular speed at contact: face speed (`racketMax`) over the swing radius, about 1.3 m for groundstrokes and 1.0 m for overheads. The multiplier is the square root of the drive's angular speed over the shot's (softened, so no shot is unplayable), capped at 1.35. AI players keep one window for every shot until Phase 4 refits their timing spread with these on. |

| Shot | ω ≈ racketMax / R (rad/s) | √(ω_drive/ω) | Used | Note |
|---|---|---|---|---|
| Drive | 19.1 / 1.3 = 14.7 | 1.00 | 1.00 | the reference |
| Topspin | 19.5 / 1.3 = 15.0 | 0.99 | 0.99 | |
| Slice | 17.8 / 1.3 = 13.7 | 1.04 | 1.04 | |
| Lob | 13.5 / 1.3 = 10.4 | 1.19 | 1.19 | |
| Drop | 9.6 / 1.3 = 7.4 | 1.41 | 1.20 | capped lower: a drop is a touch shot, depth control is the hard part |
| Serve | 15.9 / 1.3 = 12.2 | 1.10 | 1.10 | |
| Smash | 29.5 / 1.0 = 29.5 | 0.71 | 0.71 | |
| Bandeja | 20.7 / 1.0 = 20.7 | 0.84 | 0.84 | |
| Volley | 12.3 / 1.3 = 9.5 if it swung; a punch barely turns the face | 1.25 (as a swing) | 1.35 | the cap: a blocked volley is a placement, not a swing |
| Víbora | 25.2 / 1.0 = 25.2 | 0.76 | 0.76 | brushes across the ball at speed |
| Chiquita | 13.6 / 1.3 = 10.5 | 1.18 | 1.18 | |

The numbers in the ω column are the game's own face speeds; the radii are estimates (no padel figures). The
"Used" column is the derivation, except the drop (held at 1.2) and the volley (the cap). A first version tuned
several round it, the víbora down to 0.65 to make it "the riskiest overhead"; nothing measured supported that.

**Contact quality from the grade** (`src/sim/contact/timing.ts` gradeQuality): Perfect 1, Good 0.82, Early/Late
0.55, Too early/late 0.15. Quality drives the shot's error, pace and spin (shots.ts), and the sound and rumble
below.

**The timing readout.** After every swing the HUD shows the grade and how many milliseconds early or late it was
(`src/ui/hud.ts`). Pro mode (`P`) hides it with the other cues; the shot's name and speed still show after a Good
or Perfect hit.

## 3. The volley (key N)

| Value | Where | Why |
|---|---|---|
| Holding N plans the incoming ball in the air | `src/sim/player/positioning.ts` planStand(volleyKey) | The volley is the padel net player's main shot; it must be choosable, not left to the planner. |
| Comfortable volley height 0.8-1.45 m (cost rises below at 1.4/m, above at 0.7/m) | `src/sim/contact/windows.ts` volleyCost | Between the waist and the shoulders a punch volley is easy; below the tape it has to be lifted; above the shoulder it becomes a high volley. |
| Reach band 0.35-1.15 m to the side, met 0.35 m in front | positioning.ts VOLLEY_REACH_MIN/MAX/FRONT | Volleys are met with a reach or a step, not from set feet. The arm and racket reach about 1.35 m; the comfortable punch is nearer. |
| Time needed: the run plus 30 ms | positioning.ts | A volley is played on the move: no stop-and-set time (groundstrokes take 50-100 ms more to set the feet). |
| A volley planned too late is blocked off the bounce as a short slice | match.ts shotFor | The key never produces a nonsense shot. |

Test: `tests/sim/volley.test.ts` (12 matches: a net player takes 81% of balls in the air with N against 41% with
the drive key, and under 5% of their swings lose the point either way, swings that meet nothing counted: 1 of 216
with N, 2 of 189 with the drive, no misses. Assisted timing used to let a volley swing go before the ball was in
reach: 32 misses with N against 14 with J, 8.8% of swings losing the point against 4.3%).

## 4. Movement

| Value | Where | Why |
|---|---|---|
| Top speed 6.0 m/s forward, 4.8 sideways, 4.3 backwards | `data/tuning.json` player | Court-sport sprint capability; in matches WPT men peak at a median 4.2 m/s (Miralles et al. 2025, WIMU Pro GNSS + LPS), and the AI uses full effort only when the time asks for it. Sideways and backwards are estimates. |
| Acceleration 8.5 m/s² from rest, falling linearly to 0 at top speed | tuning.json `accel` | A sprint's force-velocity profile. 5 m forward takes 1.56 s from a standstill (the force build-up below included) and 1.45 s once already moving or after a split-step. This used to say "about 1.3 s, as sprint tests give"; it never was (1.45 s before Phase 2), and no padel sprint time has been read yet (OPEN_QUESTIONS.md). Not raised: the match-data acceleration peaks are already below the game's. |
| Braking 8.0 m/s², grip 9.0 m/s² shared by braking, turning and pushing | `brake`, `grip` | Shoe on sand-filled turf, μ about 0.9. Estimate. |
| 85% speed while the swing is committed | `chargingSpeedScale` | Holding a shot key is preparation, done on the run; only the swing itself slows the feet. |
| Positioning assist 0.3 (human default 0.45 via `?assist=`) | `positioningAssist` | How strongly the human is steered to the planned spot while holding a shot key. |

## 5. The split-step and getting going

Players hop as the opponent strikes and land as they read the ball. In the game the hop is real (no grip in the
air) and its value is real too: from a standstill force takes time to build, and the landing pre-loads the legs.

| Value | Where | Why |
|---|---|---|
| Take-off at the opponent's contact | match.ts (after a strike, opponents' `trySplitStep`) | World-class tennis: take-off +9 ± 36 ms, landing +152 ± 25 ms after the opponent's contact (Mecheri et al. 2019). |
| Airborne 0.142 s | `splitStepAir` | Same source: about 142 ms in the air. No push, braking or turning while airborne. |
| Only from under 1.6 m/s | `splitStepMaxSpeed` | A player still running doesn't hop. |
| From a standstill, push starts at 20% of full and reaches full over 0.3 s | `startFrom`, `startRamp` | Force development: calibrated with the next row so the split-step's gain matches the data. Tuning against data. |
| A landing pre-loads for 0.3 s | `splitPreload` | The first step after landing needs no build-up. Tuning. |
| The result | `tests/sim/splitstep.test.ts` | A target 1-2.5 m away is reached 108-117 ms sooner with the split-step (11-16% of the run; 8% at 4 m). Measured: 104 ms, 764 vs 868 ms (Uzu et al. 2009), and 13.1% over 2.70 m (Nieminen et al. 2014), where the game gives about 10%. With a 170 ms decision the push starts 175 ms after the opponent's contact, the feet have moved 1 cm by 225 ms and 5 cm by 283 ms; tennis players' first foot movement comes at 266-311 ms. |
| No hop for a human already moving | match.ts (`keysMove`) | A human pushing a direction when the opponent strikes goes instead: a forced hop held their keys for its 142 ms of air. |
| The planner knows | player.ts `startLag()` in `runTime()` | The AI and the human's assist plan with the build-up and the remaining airtime, so arrival estimates stay within 40 ms (test). |
| The hop on screen: 2.5 cm, then a 5 cm knee bend to 0.34 s | `src/render/avatar/avatar.ts` splitStep, `splitStepTime` | Ballistic: g·T²/8 for 142 ms in the air. |

## 6. Hit feedback

Sound, rumble and the camera read the sim's hit events (`src/game/feedback.ts`); none of them writes to the sim.

**Sound** (`src/audio/sound.ts`, WebAudio, synthesised; `?sound=0` off). All of this is tuning by ear: no padel
impact recordings were analysed (Phase 6 does the full soundscape with references).

| Value | Why |
|---|---|
| Impact: a 3-6 ms noise burst through a resonance at 900-1400 Hz, Q 1.2-4, decay 18-48 ms | A ball meeting a solid face is a short broadband "pock" with a body resonance. |
| Contact quality 1 → resonance 1400 Hz, narrow, 18 ms; quality 0.15 → about 1000 Hz, wide, 45 ms | A centred, well-timed hit is short, bright and dry; an off-centre one is duller and rings longer. |
| Below quality 0.8: a 240 → 170 Hz frame knock, louder the worse the contact | The frame's low knock is what tells a player they missed the sweet spot. |
| Loudness ∝ ball speed off the racket / 25 m/s (0.15-1.6), drops and chiquitas at 0.45, overheads +15% | Louder the harder the hit. |
| Pan from the hit's screen position, louder nearer the camera | Where the sound comes from. |
| Played at the event's exact time (up to 50 ms ahead) | With run-ahead the sim is up to a tick ahead of the screen; the sound lands with the picture. |
| A swish for a swing that meets nothing | A whiff should be heard as one. |

**Rumble** (gamepad `vibrationActuator`, Chrome/Edge):

| Hit | Rumble | Why |
|---|---|---|
| Good or Perfect (quality ≥ 0.8) | 45 ms, weak motor 0.25-0.5 (by pace), strong 0.05 | A clean hit is a crisp tap. |
| Early/Late/Too early/Too late | 90 ms, strong motor 0.1-0.4 (worse = more), weak 0.1 | A mishit buzzes in the hand. |
| Smash or víbora | 110 ms, strong 0.55-0.85 (by pace, capped at 40 m/s), weak 0.6 | The big one. |
| Whiff | 40 ms, weak 0.15 | You felt nothing, nearly. |

**Camera on a smash** (`BroadcastCamera.kick`, `src/render/views.ts`): up to 2.9% of zoom in (1.2° of the old 42° lens; Phase 5 moved the camera to the TV position with a 26° lens) and a 2 cm jolt that
rings down at 11 Hz with a 90 ms decay, over 0.35 s. Strength: smash 1, víbora (or a bandeja over 20 m/s) 0.4,
times the pace ((speed − 15) / 20 m/s, 0-1), times 0.5-1 for distance to the camera. Broadcast cameras don't
shake; this is the camera operator flinching, felt more than seen. Tuning. It starts in the frame that shows the
hit (feedback runs before the camera update).

A new rumble is dropped while one is still playing (the actuator would cut the first off). Browsers start audio
only from a user gesture, and a pad press may not count as one in every browser: a pad-only player may need one
key or click before the sound starts.

## 7. Gamepad mapping

Stick moves (it wins over the keys when pushed; 22% dead zone, rescaled). A drive, X topspin, B slice, Y lob, d-pad
drop, LB volley, RB overhead, RT power, LT precision (triggers held past half-way, let go below 40%: Chromium flips
a trigger's `pressed` early in its travel). Same timestamped queue as the keyboard, but a pad's timestamp is its
latest report of anything, so with the stick moving a button change can be stamped up to a report (a few ms) late;
it is kept between the last poll and now. `navigator.getGamepads()` makes a little garbage each frame while a pad
is connected (the API's, unavoidable).
