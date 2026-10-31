# Review round 8: the games critic (Top Spin 2K25 lens)

Branch phase9 at 8fd6459, dev server on :5192, 30-31 Oct 2026. Findings were drafted blind in `tools/out/r8c-draft.txt`, saved before
I opened REVIEW.md or the round 7 reports. Changes made after that are listed at the start of section 3. No code, data or other
tracked file was changed. This report is my only new file outside `tools/out`.

**Verdict.** Nothing is Critical. There are 2 High, 23 Medium and 11 Low findings.
- **One High is NEW: the bodies carry no weight.** The trunk leans the same 16-19° when a player sprints off, runs steadily or brakes
  hard. Nothing in the earlier reports covers it. It answers the owner's "how they move", and by the loop's rule it means another round.
- **One High is a REPEAT:** the faces close up. This is the known limit of the MakeHuman source, and it is not counted as new.
- **One Medium is a REGRESSION:** pops of 15° or more have about doubled since round 7's table, 2.0 to 3.6-4.0 per player-minute.
- Round 7's fixes that I could check held, the volley's above all. See section 3 for the few statuses that don't.

**How to read "Basis".** **M** = measured, with the sample given. **J** = my judgement from captures or code. **M+J** = the number is
measured and the rank or reading is judged. Real-world figures I give from general knowledge are marked as such.

## 1. How I reviewed

**Chrome.** The lock was held by a perf run and other sessions for about the first 40 minutes, and load averages ran from 20 to 41.
So measurements came first, then nine real-Chrome batches between 00:25 and 01:45.

**Tools**
- Capture runner: `tools/out/r8c-cap.mjs`, a copy of `r7c-cap.mjs` that survives a failed job and logs how Chrome exits. Jobs:
  `r8c-jobs-a/b/c/d/d2/e/f/g/i.mjs`, adapted from round 7's.
- Reused as `r8c-*`: `r7c-anim`, `-game`, `-swing`, `-gait`, `-walk`, `-over`, `-volley2`, `-pops`, `-feet`, `-scan`, `-audio`, `-f0`,
  `r8-gs.ts`, `r8-vt.ts`, `r7c-grid.py`; `PROBE`, `CUT`, `COUNT`, `WATCH`, `REPORT`, `TAP`, `LOUD` from earlier jobs.
- New this round:
  - `r8c-lean.ts`: tilt along travel while starting, steady and braking.
  - `r8c-move.ts`: chest against travel, cadence, turn rates.
  - `r8c-plant2.ts`, `r8c-plant3.ts`: planted feet from the less-moving of ankle and toe, whole stance and middle 60%. These avoid the
    rolling sole that made round 7 drop `r7c-feet.ts`.
  - `r8c-plant.ts`: feet at contact.
  - `r8c-flick.ts`: the elbow after contact.
  - `r8c-sole.ts`, `r8c-flight.ts`: soles, flight phase and footstep triggers.
  - `r8c-pops2.ts`: when the ready pops come.
  - `r8c-volh.ts`: volley elbow and racket lean by height.
  - `r8c-strip.py`: stroke strips.
- Sound: `node tools/audio-reel.ts`, then `r8c-audio.ts` and `r8c-f0.ts`. **I can't listen, so every sound finding comes from measurement
  or code.**

**Runs and samples**

| What | Sample |
|---|---|
| Arenas, courts, floors | 4 arenas, 3 courts, hard and carpet, real Chrome, 1600 px. Clay and the three preset women's stills were lost to a timeout |
| People | face p1, p2, p7; body p1, p7; hand p1, p7, real Chrome. The other faces were lost to a timeout. p8-p10 seen only at distance and in strips |
| Strokes, stepped | drive, volley, slice, chiquita, bandeja, smash, víbora, serve (men); serve, volley, smash (women). HUD-free strips for all |
| Pose against the footage table | p1 and p7, seeds 2501-2505 and 2701-2705 |
| Weight | p1 seeds 2901-2902, 18,000 frames; p7 seeds 3001-3002 |
| Feet | p1 seeds 3201-3203, p7 seeds 3401-3403, 120 s each; about 4,000 stances each |
| Overheads | seeds 2801-2808, 120 s: 23 bandejas, 12 smashes, 8 víboras |
| Pops | seeds 2701-2704 and 2101-2104, 32 player-minutes each |
| Replays | 2 stepped, one a men's replay; rate from seeds 101-112, 200 s each, 17 replays. The women's job missed its replay |
| Match ends | doubles with `gfx=tv`, women's, singles, change of ends; score set to 40-0 in the page |
| Camera coverage | seed 110, 3 presets, 150 s, 4,930 rally frames; cut-aways seeds 111, 115 |
| Contact as drawn | seeds 116-119, 296 hits |
| Human play | `bot-play.mjs` doubles and singles, the capture bot in live matches, racket as drawn seeds 120, 121 |
| The app | cold load, settings, controls, setup, start, pause, match end, results, rematch; 2 drills; Knock-out round one to the semi-final's start |
| Sound | reel of 42 impact and 10 crowd items, 24 grunt renders × 3 |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r8-critic/`. I viewed 12
contact sheets (`sheet-*.jpg`), and the file names below are in that folder.

**Set aside.**
- Chrome closed under two jobs ("Target closed": the app job's bot run at 00:26 and `hum1` at 01:25), and both ran clean on a retry. Later
  runs through the same paths exited with code 0. I can't say what closed it, and I don't count it as a game fault.
- Women's stroke times came from a men's scan, so the women's drive and bandeja strips missed the stroke. Women's matches run differently
  in the sim (round 7's note).
- `sheet-g.jpg`, the fixed-camera feet strip, was cropped badly and settled nothing. Finding 3 stands on numbers alone.
- Stale banners after sim jumps. The replay's banner in finding 30 is not one: the clock ran normally there.

## 2. Findings, ranked

| # | Rank | Finding | Evidence | Basis | Fix direction |
|---|---|---|---|---|---|
| 1 | High | **The bodies carry no weight.** Starts and stops don't reach the upper body. A player drives off and pulls up with the same trunk angle as a steady run, as if the feet were on a conveyor. Sideways, the lean even goes the wrong way when stopping. It shows at TV distance, in every run, and it is most of what "how they move" comes down to. | Tilt along travel, trunk / feet-to-head, deg, facing the run, over 2 m/s, not swinging. **p1:** steady 18.9 / 17.5 (n 1,734), starting at +5.4 m/s² 19.5 / 18.5 (n 2,924), braking at -6.4 m/s² 18.6 / 16.6 (n 1,478). **p7, other seeds:** 16.1 / 17.2 (n 1,998), 17.2 / 18.6 (n 2,438), 15.7 / 16.0 (n 1,240). So the change is about ±1°, within the spread of a steady run. Physics: atan(a/g) is 29° forwards and 33° back from upright, so whole-body tilt should swing tens of degrees (general mechanics; a runner's trunk swings less than the body line). Sideways steps: 3.5° towards travel starting (n 2,955), 11.9° braking (n 973), the wrong way round. Code: `avatar.ts` has no lean from the player's acceleration; the only lean is towards the contact (`LEAN_FROM`). | M | A spring on the sim's acceleration tilting the body from the ankles, plus a trunk that comes up and a foot that plants ahead on a hard stop. It is render-only and needs no new clips. |
| 2 | High | **The people still don't look human close up.** Not new: the source's limit, with the MetaHuman pilot waiting on the owner's sign-in. Better than last round at cut-away size. The owner's other three complaints are findings 1, 3-8 and 13-14. | `sheet-b1.jpg`, real Chrome: waxy, even skin; hair a solid cap on p1; eyes hooded when looking down. Teeth read pale in the frames I saw. | J | The MetaHuman pilot. |
| 3 | Medium | **Feet slide under the body.** Most of the travel is the foot skimming in and out of a stance, but a fifth of stances also slide through their middle. No earlier report ranks this: round 7's measure rolled along the sole, so it was dropped. | Stances of 100 ms or more, sole under 2 cm, less-moving of ankle and toe. Whole stance over 10 cm: walk back 49% (n 1,315), swing 34% (n 562), under 1.5 m/s 20% (n 1,366). p7 37%, 27%, 20%. Middle 60% only, over 5 cm: walk back 20%, swing 21%, p90 14 cm in a swing. Real: about 0-2 cm (general knowledge). Lowest sole more than 1.5 cm up at contact: 28% of groundstrokes (n 110), 26% of volleys (n 62), but only 1-4 cm. Both feet off in a jog 64-68% (real about 30-40%, general knowledge). | M | Foot locks at landing that hold through mid-stance while the body moves; the sole's contact window from the clip's own stance. |
| 4 | Medium | **The racket is slow and slows further at the ball.** The volley's swing is now the right size, and the dip is the worse for it: the racket nearly stops on the ball, then speeds away. Replays run this at 0.35×. | Face speed, m/s, at -17 / 0 / +17 ms: drive 9.6 / 6.5 / 8.3 (n 22), volley 4.7 / 2.7 / 6.0 (n 38), smash 13.8 / 10.3 / 13.2 (n 6), slice 12.4 / 9.1 / 7.6 (n 17). p7 matches within 0.2. A point further out: drive 28.1 / 18.9 / 16.3 (n 17), volley 5.9 / 5.4 / 12.2 (n 40). Pelvis lead over the shoulders: drive 0.00 s (n 22), smash 0.00 (n 6), lob 0.03 (n 20). | M | Keep speed through the ball in the contact warp; a stroke's peak at or just after contact. |
| 5 | Medium | **Most volleys still meet the ball on a locked arm.** Mid-height is fixed. But most volleys are low, and those stop at the joint limit. | Elbow at contact: low (under 0.85 m) 30 (n 64 of 92, 70%), mid 63 forehand (n 12), 47 backhand (n 8), high 60-64 (n 8). Video 63 and 54. Drive forehand 41-53, backhand 30-31, serve 30-31, lob 30-32 (n 7-23). | M | A bent contact on low volleys, with the hips and knees taking the height. |
| 6 | Medium | **The arm flicks straight on the way back to ready.** After the follow-through the elbow bends, goes straight again, then bends to ready, because the hand's path passes too far from the turning shoulder. It is small at TV, plain in a cut-away or a replay's tail. | Elbow goes from 60 or more to 40 or less and back to 55 or more within 1 s, no new stroke: volleys 64% (n 56), serves 84% (n 19), median low point 28-31. Timeline, volley: 69, 71, 67, 46, 28, 26, 24, 29, 57, 71, 76 at 50 ms steps, seed 2901. Medians at +0.38 / +0.5 s: volley 80 / 30, serve 64 / 30 (n 21, 23). Overheads score 100% too, but there it is the natural follow-through, so they are not counted. | M | Blend the recovery in the shoulder's frame, or arc the hand. |
| 7 | Medium | **Pops of 15° or more have about doubled.** Most come in the ready stance at shuffling speed, not at a change of stroke. On a four-player court that is one every 4 s. | 15° or more: **4.0 and 3.6 per player-minute** (127, 114 in 32, two seed ranges), against round 7's 2.0 (49 in 24). 30° or more: 0.28 and 0.44. All pops 18.3 and 19.2, and 14.9-21.75 by seed, against means of 14.9 and 15.9. Ready pops of 10° or more (n 125): 65% at 0.5-2 m/s, 99% over 1 s from a contact, 67% in the forearms and upper arms. | M | Trace the racket arm's solve in ready during a shuffle. Under the test's limit, so not urgent. |
| 8 | Medium | **The walk back is still a retimed jog.** It reads as a walk at cut-away size, and round 7's numbers are unchanged. New here: it has a flight phase, and the footsteps fire four times too often. | Both feet off 25% of frames, double support 24% (n 15,003); real 0% and about 20% (general gait figures). The swing foot dips to 0.5 cm mid-swing. Knee 18 / 35 / 47, lean 14.8 (p1), 7.6 (p7), speed 1.50 at p50 and p95. Footstep triggers 8.5 a second per player (real about 2; 84 player-s), by `soundscape.ts`'s own thresholds. Quiet in the mix (-31 dBFS peak), so a code fact more than a heard one. | M | A walk clip. Until then a longer gap between step sounds. |
| 9 | Medium | **The víbora is hit from the shoulder with the arm folded.** | Elbow 96, wrist 0.07 at contact (n 8), against 53, 0.6 on video. `sheet-f-m.jpg`: it stays well short of the bandeja's reach. | M | Its own contact key: higher, the arm longer. |
| 10 | Medium | **The smash's arc is short, and one leg locks in the air.** Otherwise a strong stroke in the strips. | Elbow most bent 115 at -100 ms, 34 at contact (n 12), video 139 to 53. Legs at contact 69.5 / 1.7 (n 7), the 1.7 a joint limit, video 27 / 23. | M | A deeper drop; 15-25° on the straight leg. |
| 11 | Medium | **No voice on court, and replays are silent.** | No speech family in `src/audio`. `game.ts:746` still feeds the soundscape the live sim. | J | Replay audio first, then calls, then the umpire. |
| 12 | Medium | **The game is very quiet.** Carried from round 7. The tap returned no blocks twice this round, but the sound code and levels are unchanged since (git log), so round 7's -45.4 dBFS in a rally stands. | `r8c-jobs-d2.log`, `r8c-jobs-g.log`: blocks 0. | J | Lift the master towards -24. |
| 13 | Medium | **Hair moves as one piece.** Long hair has round 7's swing, up to 15 cm. It follows the body's starts and stops, not its stride, and the rest is a cap. | `kit.ts`: `HAIR_SWING` 3 on the hem's lag of up to 5 cm; the lag hangs straight on a steady run (`avatar.ts`). Seen, not measured in motion. | J | A pendulum per tail, driven by the hips. |
| 14 | Medium | **Ten people, one pair of shoes, six haircuts.** Two men in a match often share a head of hair. | `data/players/*.json`: `shoes05` for all ten; hair short01 ×2 (p3, p6), short04 ×2 (p4, p5), afro01 ×2 (p2, p8), ponytail01 ×2 (p7, p9). | M | Shoe colours per person; two more hair meshes. |
| 15 | Medium | **Few reactions, one set of strokes for ten people.** Better: one point in three is a held pose. The manners run tempo 0.90-1.08 and size 0.86-1.12, which is hard to see at TV. | `avatar.ts:2115`, `data/manners.json`. | J | More reactions; a signature finish per person. |
| 16 | Medium | **Practice has no goal.** | `d-pr1-start.png`; HUD text "Rin Morita ... DOUBLE BOUNCE, THEIR POINT ... Games 0, 0". | J | Count clean returns and a best streak. |
| 17 | Medium | **A singles win is still a shrug.** | `sheet-c6.jpg`, top row: the winner stands, racket down. | J | Something bigger for a lone winner. |
| 18 | Medium | **Replays need a last pass.** The low angle is good. Nearly all are smashes, and big rallies rarely get one. | Seeds 101-112, 40 min: 17 replays, 16 smashes, 1 drop. Round 7: 29 of 39. Two angles. | M+J | Give more kinds of point a replay; a third angle. |
| 19 | Medium | **Grey stadium roof, empty chair.** | `sheet-f-m.jpg`, `sheet-c1.jpg`. | J | A dark roof with rigs; an umpire on the chair. |
| 20 | Medium | **The clubs and hall stay behind the stadium.** | `sheet-a1.jpg`: flat green ground and walls beside a crowded stadium. | J | Tree cards, ground detail. |
| 21 | Medium | **No opening.** | `d-start1.png`: the wide shot and a banner. | J | A skippable opening (show the owner). |
| 22 | Medium | **The end-wall mesh sits over the near pair at the net.** | TV: near-at-net frames behind the band 91%, ball through it 38.5% (n 4,930, seed 110). Round 7: 84.1%, 31.5%. | M | The owner's choice of camera. |
| 23 | Medium | **"TV close" can lose a player.** The rank stands on round 7's sample: this seed is kinder and the camera code hasn't changed. | Seed 110: some player off 2.6%, ball off 0.1%. Round 7, seed 96: 10.6%, 1.8%. `player`: 0.2%, 0%, head behind mesh 85-87%. | M | Tilt down or follow the near pair. |
| 24 | Medium | **The floor is flat paint on close cameras.** | `sheet-c2.jpg`, `sheet-f-m.jpg`. | J | Wear, fibre, ball marks. |
| 25 | Medium | **The Knock-out's start doesn't say which round.** | HUD text: "VS LÉA GIRARD (FRA) & SARA CASTRO". The results do say it. | J | The round in the banner (show the owner). |
| 26 | Low | Thighs pass through each other. | 1.57-2.06% of frames, up to 14.8 cm (seeds 2501-2504). | M | Stance width in ready. |
| 27 | Low | Very low balls a little squat. | Volley under 0.5 m: hips 0.65, knees 88 / 74, trunk 46 (n 7). | M | Less on the second knee. |
| 28 | Low | Long names cut off in the score bug. | `sheet-a1.jpg`: "H. Nakamura · M. Fun...". | J | Fit the name (show the owner). |
| 29 | Low | Kits have no print. | `sheet-b1.jpg`: panels, seams and wristbands, no print. | J | A chest print. |
| 30 | Low | The result banner runs on over the first second of a replay. | `sheet-c1.jpg`, frames 04 and 08: "DOUBLE BOUNCE" over the low angle. Banner 1.6 s, replay starts 0.8 s after the point. | M+J | Clear calls as a replay starts (show the owner). |
| 31 | Low | Nothing on court answers the ball. | No particle or fence-shake code in `src/render`. | J | A puff of sand; a fence shiver. |
| 32 | Low | The TV lower third can read the wrong way round. | `sheet-c6.jpg`, bottom row: "ERROR · HIT THE WALL BEFORE BOUNCING" over the winners' names. | J | "Point to" the winners (show the owner). |
| 33 | Low | Ball trail reads as a string. | `sheet-a1.jpg`, the narrow court. A cue, so the owner's call. | J | Show the owner. |
| 34 | Low | The backhand's follow-through finishes low. | Wrist -0.47 at +0.24 s (n 7), video -0.12. Across +0.34, video +0.3-0.4. | M | Lift the finish. |
| 35 | Low | Some players back-pedal at a run. | Over 3.5 m/s, back to travel 16% of frames (832 of 5,142). Real players turn. | M | Turn the hips sooner. |
| 36 | Low | Three singles swings graded far late. Cause not traced: it may be the bot's timer under load. | Bot released on the ring: 125, 138, 173 ms late, 3 of 26 singles swings; doubles 0 of 33, worst 19 ms. Round 7 had one at 135, also singles. | M | Check whether the ideal moves after release. |

### What holds up

- **Every arena, court and floor I saw reads right** (`sheet-a1.jpg`). The stadium remains the best-looking thing in the game.
- **Strokes against the video.** Ready, forehand from contact on, backhand, bandeja, serve and the mid-height volley are all near the table.
  The HUD-free strips (`sheet-f-m.jpg`) show real padel shapes: a low drive with a high finish, side-on overheads, a real jump on the
  smash.
- **The volley's size.** Path 0.49 / 0.62 / 0.45 m by height against a drive's 1.00.
- **Contact.** As drawn: p50 1.7-2.3 cm, p90 3.3-4.9 cm, 2 of 296 over 15 cm, worst 36 cm. Face to ball's way out 20-27° at p50, 35-46° at p90,
  was 28-30 and 45-57. Human racket at the ball: p50 4 cm, p90 7-11 cm (n 18).
- **Truthful input.** `bot-play.mjs`: doubles 8 hits of 8, p50 3.7 ms; singles 9 of 9, p50 4.7 ms.
- **Mid-distance people, the kit and the cut-aways** (`sheet-c2.jpg`). Women's skirts, tanks and polo collars read right. The pair faces the lens
  80% and 83% of the time, and nobody is out of frame in 21 points.
- **Match end.** Embrace, walk to the net, rackets touched, in men's and women's matches (`sheet-c6.jpg`).
- **Rackets and the grip** (`sheet-b1.jpg`): printed faces, closed hand, wrist cord.
- **App.** Title, setup, settings, pause and results are clean. Under load 20-40: title ready 6.7 s (limit 10), Start match 4.6 s, Rematch 1.3 s.
- **Sound bank.** Nothing clips. Men's loud grunts 140-192 Hz, women's 245-329 Hz. Hard racket hits are gone by -40 dB at 22 ms, glass rings
  to 376-478 ms.

## 3. Against REVIEW.md

**Changes after the blind draft.**
- **Feet, draft "High?" to Medium.** Round 7's warning about the rolling sole made me measure again. Without it the slide is real but smaller,
  and most of it sits at a stance's two ends. My fixed-camera strip settled nothing, so I don't raise it on numbers alone.
- **Pops, draft Medium, now marked REGRESSION,** against round 7's own 2.0.
- **Víbora, draft "Med/High", Medium.** Unchanged since round 7's Medium, and the video is one coach's high ball.
- **Added from round 7's list, not in my draft:** 11-13, 15-17, 19-25, 27-33 (seen again or carried). They are REPEATs.
- **Dropped from my draft:** the package (no career, creator or saved records). M5 and M6 are later milestones, and earlier rounds didn't rank it.

### Each finding marked

| # | Mark | Note |
|---|---|---|
| 1 Weight | **NEW** | Not in any earlier report |
| 2 People close up | REPEAT R7 #1, R6 #9, R5 #10, R4 #7, R3 #21 | Open, the source's limit |
| 3 Feet | NEW as a finding | Long-standing: QA's planted-foot p90 is 144-169 cm/s now, 169-182 in round 7 |
| 4 Racket speed | REPEAT R7 #4, R6 C#5 | The volley's near-stop is new |
| 5 Locked arm | REPEAT R7 #5, R6 C#6 | Now only on low volleys, 70% of them |
| 6 Arm flick | NEW | |
| 7 Pops | **REGRESSION** of R7 #25 | Low to Medium |
| 8 Walk | REPEAT R7 #3, R6 #8 | Flight phase and step rate are new |
| 9 Víbora | REPEAT R7 #6 | |
| 10 Smash | REPEAT R7 #7 | |
| 11 No voice | REPEAT R7 #9 | |
| 12 Quiet | REPEAT R7 #10 | Not re-measured |
| 13 Hair | REPEAT R7 #11 | Better holds |
| 14 Shared shoes, hair | NEW | |
| 15 Reactions | REPEAT R7 #12 | Better holds |
| 16 Practice | REPEAT R7 #13 | |
| 17 Singles win | REPEAT R7 #14 | |
| 18 Replays | REPEAT R7 #15 | |
| 19 Stadium | REPEAT R7 #16 | |
| 20 Clubs, hall | REPEAT R7 #17 | |
| 21 Opening | REPEAT R7 #18 | |
| 22 Mesh | REPEAT R7 #19 | |
| 23 TV close | REPEAT R7 #20 | |
| 24 Floor | REPEAT R7 #21 | |
| 25 Knock-out | REPEAT R7 #22 | |
| 26 Thighs | REPEAT R7 #26 | |
| 27 Low balls | REPEAT R7 #27 | Different height band |
| 28 Long names | REPEAT R7 #28 | |
| 29 Kit | REPEAT R7 #29 | Better holds |
| 30 Replay banner | REPEAT R5 #18, R4 #9 | Dropped from later lists, never fixed |
| 31 Nothing answers the ball | REPEAT R7 #24 | |
| 32 Lower third | REPEAT R7 #23 | |
| 33 Trail | REPEAT R7 #30 | |
| 34 Backhand finish | NEW as a finding | The table's own row |
| 35 Back-pedal | NEW | |
| 36 Late grades, singles | NEW | Cause not traced |

### Statuses that don't hold

- **Round 7's "Animation pops steady" (#25, Low), counted as Open.** 15° or more has about doubled. See finding 7.
- **`docs/research/footage-pose.md`, four game figures.**
  - Forehand elbow at -0.22 s, "49": 30 and 31 (n 9 each, p1 and p7), at the arm's stop. The -0.08 and contact figures hold.
  - Volley elbow "116, 90, 82, then 57": forehand 61, 95, 98, 98, 47; backhand 98, 98, 100, 77, 30 (n 17, 21). 57 holds for mid-height only.
  - Backhand volley elbow at contact, "37": 30-33 (n 21).
  - Serve elbow "...44, 48, 30": the rise and fall comes later and larger, 49, 64, 30 at +0.24, +0.38, +0.5 s (n 23). It is finding 6.
- **R7 #4's racket lean, "-31":** I can't confirm the figure. My measure (handle axis to the horizontal) gives -15 to -17 for every height under
  1.2 m, forehand and backhand (n 84). The hang is gone, so **Fixed holds,** but this is a different measure from the table's.
- **R7 #4, mid backhand "54":** 47 (n 8), a small sample. Mid forehand 63 (n 12) is better than the claim.
- **R4 #9 / R5 #18, the banner over a replay:** dropped from later lists without a fix.

### Statuses that hold

- **R7 #4 Fixed:** see above, with finding 5 for the low volleys it didn't reach.
- **R7 C2 Fixed:** path 0.49 / 0.62 / 0.45 m, better than claimed.
- **R7 #5 Better, still open.** Teeth read pale in the frames I saw; R5 #10's dark teeth not seen.
- **R7 C8 Fixed:** clean on p1, p2 and p7. The others were not seen close.
- **R7 C11 Better, C12 Better, C29 Better:** by code and captures.
- **R7 "6+ Medium" and "40+ Low" Open:** seen or carried above.
- **R6 #10 Medium:** 2 of 296 over 15 cm, worst 36 cm, near the verifier's 1.1% and 40.8 cm.
- **R5 #7 Rematch and next round:** Rematch 1.3 s; "On to the semi-final" keeps your pair and deals new rivals.
- **R3 #10:** the key help folds after the first point.

### Not checked

- **The mix's level:** the tap gave no blocks in two runs. R7's -45.4 dBFS is carried, not confirmed.
- **Clay floor, and women's stills in a chosen arena:** lost to a page-load timeout.
- **Close-ups of p3-p6 and p8-p10,** so necklines and teeth on them weren't checked. p8's face job timed out, and it took p9 and p10 with it.
- **Women's replay** (the job missed it), the jib angle, and the women's drive and bandeja as stepped strokes.
- **A foot slide seen on screen:** `sheet-g.jpg` was cropped wrongly.
- **Back glass and Volleys drills;** gamepad play; performance (measured separately).
- **`gfx=tv` beyond the bug and the match end.**
