# Review round 7: the games critic (Top Spin 2K25 lens)

Branch phase9 at c96b20b, dev server on :5192, 30 Oct 2026. Sections 1 and 2 were drafted blind
(`tools/out/r7c-draft.txt`, saved before I opened REVIEW.md or the round 6 reports). Corrections made afterwards are
listed at the start of section 3. No code, data or tracked file was changed. This report is my only new file outside
`tools/out`.

**Verdict.** Nothing is Critical. There is 1 High, 21 Medium and 8 Low findings.
- **The one High is a REPEAT:** the faces close up (R6 #9). The MetaHuman pilot still waits on the owner's Epic
  sign-in, so it is not counted as new.
- **No new High and no High regression.** Round 6's bandeja fix holds. Its walk-back fix holds as "Better", and I now
  rank the walk Medium, for the reason given in finding 3.
- **One Medium is a REGRESSION:** the volley's forward swing grew from 0.72 m to 1.08 m with round 6's volley fix, and
  is now as long as a drive's. This is the one to look at first. If the pro or the owner reads it as High at TV, the
  loop goes on.

**How to read "Basis".** **M** = measured, with the sample given. **J** = my judgement from captures or from reading
the code. **M+J** = the number is measured and the rank or the reading of it is judged. Real-world figures I give from
general knowledge are marked as such.

## 1. How I reviewed

**Chrome.** A fleet job from another project held the lock for most of the first hour, so the review ran in this order:
1. Node measurements.
2. A hidden Browser-pane tab (`?backend=webgl`, stepped by hand, `__snap` to a local receiver on 5199, closed
   afterwards). I used it for shapes and motion only, not for lines or lighting. Its files are named `pane-*`.
3. One real-Chrome pass of 68 jobs in 13 minutes once the lock came (20:40-20:53). Every look at lighting, arenas,
   floors and the app comes from that pass. Everything that came only from the pane is marked "pane".

**Tools**
- Capture runner: `tools/out/r7c-cap.mjs`, a copy of `r6c-cap.mjs`, through `tools/one-chrome.sh`. Jobs:
  `tools/out/r7c-jobs-a1/b/c/d/e.mjs` (merged by `r7c-jobs-a.mjs`) and `r7c-jobs-i.mjs`, adapted from `r6c-jobs-a` to
  `-i`.
- Reused:
  - `r6c-anim.ts`, `r6c-game.ts`, `r6c-gait.ts`, `r6c-swing.ts`, `r6c-scan.ts`, `r6c-f0.ts`, `r6c-audio.ts`, `r6c-grid.py`
    (as `r7c-*`);
  - `pose-metrics.ts`;
  - `r6-pro.json` (the tour photos);
  - `PROBE` (`r5c-jobs-j`), `CUT` (`r5c-jobs-p2`), `TAP` (`r4c-jobs-k`), `LOUD` (`r5c-jobs-k`).
- New this round:
  - `r7c-game2.ts`, `r7c-game3.ts`: pose at -650 / -400 / -200 / -100 ms, and volleys and groundstrokes split by height.
  - `r7c-over.ts`: overheads through time, with the chest's angle to the net.
  - `r7c-volley.ts`, `r7c-volley2.ts`: where the racket starts and ends each forward swing.
  - `r7c-walk.ts`: the walk cycle.
  - `r7c-pops.ts`: spikes by size.
  - `r7c-feet.ts`: stance slides. Not used: the "lowest sole point" rolls along the foot, so it overstates slides.
- Sound: `node tools/audio-reel.ts`, then `r7c-audio.ts`, plus the master-bus tap in a real match. **I can't listen, so
  every sound finding comes from measurement or code.** The tap worked this round.

**Runs and samples**

| What | Sample |
|---|---|
| Arenas, courts, floors | 4 arenas, 3 courts, hard / carpet / clay, men and women, 1600 px, real Chrome |
| People | all ten at `?cam=face`, and `hand` for all ten, real Chrome; `body` and a second take of face and hand for 8 (pane) |
| Strokes, frame-stepped | drive, volley, bandeja, smash (men, pane), víbora (pane), serve and walk (pane), women's smash (pane); real-Chrome strips captured, not viewed |
| Pose against footage and tour photos | p1: 3 + 10 + 8 seeds × 120 s; p7: 3 seeds. 112 volleys, 28 bandejas, 13 smashes, 10 víboras |
| Overheads through time | seeds 2601-2608 × 120 s, all four playing Martillo: 25 bandejas, 14 smashes |
| Racket as drawn | seeds 2101-2103 and 2301-2304, 120 s each; two ranges agree. Compared with round 6's files for 59125d6 and e39b531 |
| Walk back | p1 and p7, seeds 2201-2202, 18,497 moving player-ticks each |
| Replays | 3 stepped (one each way); rate from seeds 71-100, 30 × 300 s, 39 replays |
| Match ends | doubles (`gfx=tv`), women's, singles, score set to 40-0 in the page (r6c-jobs-h's way) |
| Camera coverage | seed 96 × 3 presets × 150 s, 4,573 rally frames; cut-aways seeds 97, 98 |
| Animation QA | seeds 2101-2104 and 2301-2304, 120 s each, four players |
| Human play | capture bot, doubles seeds 75 and 77, singles 76, women's 78; the app match. See section 3 for the rest |
| The app | cold load, settings, controls, setup, start, pause, match end, results, rematch |
| Practice, Knock-out | 2 of 4 drills; Knock-out round one to the semi-final's start |
| Sound | reel of 42 impact and 10 crowd items, 24 grunt renders × 3; mix tap 62.8 s, seed 99 |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r7-critic/`.
I viewed 24 images, nearly all contact sheets (`sheet-*.jpg`); file names below are in that folder.

**Set aside.**
- Node's scan doesn't know a seed's women's deal, so its times are wrong for a women's match unless `women` is set.
  Seed 74 went wrong this way; I fixed the job by forcing `people=` and set `women` in `r7c-scan.ts`.
- Stale HUD banners after sim jumps.
- `pane-cut-00` and other first frames with black stands: shaders still compiling.
- My `g.draw` no-op skips the replay logic. A 500 s jump in the pane showed no replays for that reason. Replays were
  always captured with drawing on.

## 2. Findings, ranked

| # | Rank | Finding | Evidence | Basis | Fix direction |
|---|---|---|---|---|---|
| 1 | High | **The people still don't look like actual humans close up.** Not new: this is the known limit of the MakeHuman source. Ranked by how seldom it shows: in a cut-away they read as good game characters, and it is the close view that fails. Everything else on the people is better than the faces. | `sheet-faces2.jpg` (real Chrome): waxy, even skin, brows as thin lines, helmet hair. Teeth dark blue-black in the open mouths of p5 and p7. p5 and p9 play with a fringe over one eye. Distance from the cut-away camera to all four players: p5 4.7 m, p50 7.6 m, under 4 m 2.7% (n 804, 240 s, pane), so a head is about 60-95 px tall at 1080p. | M+J | The MetaHuman pilot (the owner's sign-in). Meanwhile clear the two fringes from the eyes. |
| 2 | Medium | **A volley is now swung as far as a drive.** The volley should be the game's shortest stroke. The racket falls from shoulder height to below the hip, about a metre in 0.14 s, on two volleys in three. Worth a look at TV: if it reads as a chop there, it is High. | Forward swing path, m (p1): drive 1.05 (n 24); volley 1.08 (n 47), was 0.72 on 59125d6 (n 57). Seeds 2301-2304 agree: drive 1.00 (n 28), volley 1.05 (n 61). Peak face speed 10.2 m/s, was 7.0 on e39b531 (n 44). By contact height, seeds 2501-2506: under 0.85 m (n 44, 67%) path 1.18, starting 0.74 m above the pelvis and ending 0.20 below it; 0.85-1.2 m (n 13) 0.75; over 1.2 m (n 7) 0.62. Real volley: about 0.3-0.5 m (general coaching knowledge; no padel measurement exists). | M+J | Start the racket near the ball's height on low volleys, and shorten the forward path to under 0.6 m. Keep the hand position from the video keys. |
| 3 | Medium | **The walk back is a walk now, but the knees never straighten.** Round 6's fix works on screen: at cut-away size it reads as people walking back (`sheet-last.jpg`, top row). The numbers are still short, and all four walk at exactly the same speed. | `r7c-walk.ts`, 154 player-s each: knee p2 / p50 / p98 **18 / 35 / 48** (real about 5-20 in stance, 60 in swing: general gait figures). Lean 15.6 for p1, 8.8 for p7 (real 3-5). Ankle spread at most 0.51 m (real step about 0.78 m at this speed). Speed 1.50 at both p50 and p95. It is 28% of all frames. | M+J | A walk clip is still the real answer. Less lean on the men; ±10% on speed. |
| 4 | Medium | **The racket is too slow and slows further at the ball.** The drawn racket peaks 17 ms before contact, drops by a third at the contact and picks up again, on nearly every stroke. Replays run smashes at 0.35×, which makes it longer. | Face speed m/s at -17 / 0 / +17 ms: drive 10.3 / 6.8 / 7.8 (n 24), smash 13.5 / 8.6 / 11.5 (n 7), volley 9.8 / 5.7 / 6.3 (n 47), slice 12.5 / 8.2 / 5.8 (n 23), lob 10.4 / 7.3 / 8.4 (n 19). Bandeja 7.1 / 6.2 / 10.9 (n 8): fastest after the ball has gone. Seeds 2301-2304 repeat it: drive 10.7 / 6.9 / 8.2 (n 28), volley 9.9 / 5.6 / 5.8 (n 61), bandeja 7.2 / 6.2 / 10.8 (n 18). Smash peak 14 for a ball at 36 m/s. Pelvis and shoulders peak in the same frame (lead 0.00 s) on smash, serve, lob, slice and bandeja; `serve-and-strokes-motion.md` has the pelvis about 20 ms first in tennis. | M | Let the contact warp keep the speed through the ball. Longer arcs on overheads. |
| 5 | Medium | **Every stroke still meets the ball with the same locked arm.** | Racket elbow at contact is exactly 30.24 for p1 and 31.39 for p7 on groundstrokes at every height, lobs and serves (n 111 groundstrokes), and 30.27 on low volleys (n 62). Volleys overall 33.9 (n 112), high ones 45 (n 11), against 63 (53-79) on video. | M | Bring the limit down, a different elbow per family. |
| 6 | Medium | **The víbora is hit from the shoulder with the arm folded.** The biggest gap to the footage table. The clip is a coach's high ball, so the target is a direction and not a number. | Elbow **99**, wrist **0.08** at contact (n 10), against **53, 0.6** on video. Bandeja 57, 0.64 (n 28), so the víbora is hit about 0.3 m lower. `sheet-vib.jpg` (pane). | M+J | Own contact key: higher, the arm longer. |
| 7 | Medium | **The smash's arc is short of the video's, and one leg locks in the air.** The shape holds up well (`sheet-hair.jpg`): load, jump, contact. | Racket elbow most bent 115 at -100 ms, 33 at contact (n 14), against 139 to 53. Knee load now present but smaller and later: 72 / 57 at -0.4 s (n 13) against 93 / 67 at -0.65 s. Legs at contact 69 / 1.7, the 1.7 exact from -200 ms: a joint limit. Feet 0.9-1.0 m apart in the air. Tour photos vary (138 / 12, 66 / 37, 15 / 11), so the scissor is fair and the dead-straight leg is not. | M+J | A deeper racket drop; 15-25° on the straight leg. |
| 8 | Medium | **The shirt's neckline reads as torn in close-up.** Half the cast. It didn't show at cut-away size in the frames I checked. | `sheet-faces2.jpg`, real Chrome: p4, p6, p8, p9, p10 (5 of 10, one take). `sheet-necks.jpg`, pane: p3's bow-tie of skin on the chest, which shows in one take and not the other, so it depends on the pose. | J | A smooth collar cut. |
| 9 | Medium | **No voice on court, and replays are silent.** No umpire, no "mía!". | No speech family in `src/audio`. `game.ts:746` feeds the soundscape the live sim, which waits during a replay (`sim.time` held at 48.97 over the replay, pane). | J | Replay audio, then calls, then the umpire. |
| 10 | Medium | **The game is very quiet.** Now measured live. | Mix tap at default volume, 62.8 s, stadium: all **-39.7 dBFS**, gated -37.5, **rally -45.4**, peak **-15.6**. Console norm about -24 LKFS (general knowledge; my figure isn't K-weighted, so read it as about 13 dB low). | M+J | Lift the master towards -24 and let the limiter earn its place. |
| 11 | Medium | **Hair is rigid.** p7's ponytail and p10's long hair move as one piece with the head. Best seen on p10 from behind (`sheet-hands.jpg`, `sheet-bodies.jpg`). | Hair is skinned to the skeleton with no spring; hems have one (`avatar.ts:928`, `:184`). | J | The hem's spring on hair tips. Tie p10's hair up. |
| 12 | Medium | **One reaction each way, and one set of strokes for ten people.** Men and women, every style, the same swing. | Clips: idle, jog, run, three directions, `celebrate`, `dejected` (`avatar.ts:205`). The reaction ends about when the cut-away starts, so the repeat is seen from afar. | J | More reactions; a per-person swing tempo or finish. |
| 13 | Medium | **Practice has no goal,** and it opens with a match banner. | `d-pr2-start.png`: "VS JOAQUÍN QUIROGA (ARG) · EL MURO", a board at 0-0. HUD text: "Their point ... Games 0, 0". | J | Count clean returns and a best streak. Call the feeder the coach (show the owner). |
| 14 | Medium | **A singles win is still a shrug.** | `sheet-last.jpg`, bottom row: the winner stands, racket down, while the crowd rises. | J | Something bigger for a lone winner. |
| 15 | Medium | **Replays need a last pass.** The low angle is good. Three in four are smashes, about one per 3.8 minutes, and the exit cuts twice in 0.67 s. | Seeds 71-100, 150 min: 39 replays, 29 smashes (74%); 8 of 30 seeds had none in 5 minutes. Replay end, TV wide at 48.99, cut-away at 49.66 (`sheet-rp74.jpg`, pane). | M+J | Give more kinds of point a replay. Hold the wide shot or skip it. |
| 16 | Medium | **Grey stadium roof, empty chair.** | `sheet-arenas.jpg`, `sheet-hud.jpg`, `sheet-rp74.jpg`. | J | A dark roof with rigs; an umpire on the chair. |
| 17 | Medium | **The clubs and hall stay behind the stadium.** The players get better; these don't. | `sheet-arenas.jpg`: flat green ground and fence in club and hall; stadium far richer. | J | Tree cards, ground detail. |
| 18 | Medium | **No opening.** A match starts on the wide shot with a banner. | `d-start1.png`, `d-ko-start.png`. | J | A skippable opening (show the owner). |
| 19 | Medium | **The end-wall mesh sits over the near pair at the net.** | TV: near-at-net frames behind the band 84.1%, ball through it 31.5% of 4,573 rally frames. | M | The owner's choice of camera. |
| 20 | Medium | **"TV close" loses a player part of the time.** | Some player off 10.6%, ball off 1.8% (same 4,573 frames). `player` 4.0% and 1.0%, head behind mesh 62-65%. | M | Tilt down or follow the near pair. |
| 21 | Medium | **The floor is flat paint on close cameras.** | `sheet-rp74.jpg`, `sheet-last.jpg`. Seen, not measured. | J | Wear, fibre, ball marks. |
| 22 | Medium | **The Knock-out's start doesn't say which round.** The result screen does. | `d-ko-start.png`, `d-ko2-start.png`; results "THROUGH THE QUARTER-FINAL". | J | The round in the banner, a small draw (show the owner). |
| 23 | Low | The TV lower third can read as the wrong way round. "ERROR · INTO THE NET" with the winners' names under it. | HUD text, seed 75, `gfx=tv`: Correa · Gallo named, and they take the point. | J | "Error by" the losers, or "point to" the winners (show the owner). |
| 24 | Low | Nothing on court answers the ball. No sand kicks up and the fence never shakes. | No particle or fence-shake code in `src/render`. | J | A puff of sand on a hard bounce; a fence shiver. |
| 25 | Low | Animation pops steady, under the limit. | 10.1-21.6 a minute, means 14.9 and 15.9 over two ranges. 15° or more: 2.0 per player-minute (49 in 24), mostly going back to ready. | M | None needed yet. |
| 26 | Low | Thighs pass through each other. | 1.65-2.96% of frames, up to 14.9 cm, mostly in `ready`. | M | Stance width in the ready pose. |
| 27 | Low | Low balls still a little squat. | Volleys under 0.85 m: hips 0.73, knees 76 / 53, trunk 36 (n 62). The photo of a low wide volley: 0.75, 78 / 23, 41. | M | A touch less on the second knee. |
| 28 | Low | Long names cut off in the score bug. | "H. Nakamura · A. Med..." (`sheet-cutw.jpg`). | J | Fit the name (show the owner). |
| 29 | Low | Kits are plain. No seam, print or logo at any distance. | `sheet-hands.jpg`, `sheet-bodies.jpg`. | J | A chest print, a wristband. |
| 30 | Low | Ball trail reads as a string. | `sheet-band.jpg`, faint arc. A cue, so the owner's call. | J | Show the owner. |

### What holds up

- **Every arena, court and floor runs and reads right** (`sheet-arenas.jpg`, real Chrome). The stadium with its crowd is
  the best-looking thing in the game. A crowd member up close is better than the player at 2× zoom.
- **Mid-distance people.** The match-end net shot and the cut-aways (`sheet-cutw.jpg`) look like a good sports game.
  Women's fitted kit reads right.
- **Rackets and the grip** (`sheet-hands.jpg`): printed faces, closed hand, wrist cord.
- **Bandeja.** Side-on 74-76°, free arm up, racket held bent: elbow 78 / 83 / 93 at -400 / -200 / -100 ms (n 25),
  57-64 at contact, in the video's 54-65. The Y is gone.
- **Smash seen from behind** (`sheet-hair.jpg`): load, jump, contact, on a woman. Hips rise 0.48 m (0.82 to 1.30 m, n 14).
  Shoulders 82-84° side-on through the preparation; I first read the chest as square, and the number corrected me.
- **High and middle volleys against the photos.** The "hunched volley" I suspected was a low-ball effect: over 1.2 m
  trunk 13, hips 0.88 (n 11); under 0.85 m trunk 36, hips 0.73 (n 62), the same as the low-volley photo.
- **Cut-aways.** The pair faces the lens 80% and 75% of the time, and nobody is ever out of frame: 13 points doubles,
  13 singles, 0.0% empty.
- **Default camera.** Ball never off screen in 4,573 frames; any player off 2.7%.
- **Match end.** Embrace, walk to the net, rackets touched, net shot (`sheet-over-w.jpg`, pane).
- **App.** Title, setup, settings, pause and results are clean (`sheet-app.jpg`). Title ready 4.2 s, Start match 1.8 s,
  Rematch 1.5 s, on a machine under load.
- **Truthful input.** Capture bot: 18 swings in four live matches, 18 hits, 0 whiffs, timing error p50 1-3 ms, one
  37 ms.
- **Serve and women's drive in real Chrome** (`sheet-serve.jpg`, one of each). The serve bounces the ball at the feet
  and swings through low, side-on. The drive has a long low lunge and a high finish. Both read as the right stroke.
- **Contact in the QA.** Swept contact p50 0.9-1.3 cm, p90 2.4-2.9 cm, n 442. Worst 10.8 cm over 223 hits.
- **Sound bank.** Nothing clips. Men's loud grunts 140-192 Hz, women's 245-329 Hz. Racket hits are short, as padel's
  are (-40 dB by 22 ms), and glass rings on (-40 dB by 376-478 ms).

## 3. Against REVIEW.md

**Corrections after the blind draft.**
- **Finding 1, none to High, REPEAT.** My draft left the faces out as "known". They are still clearly short of the
  owner's request, so they keep round 6's rank and aren't counted as new.
- **The volley, plain Medium to REGRESSION.** Round 6's files give 0.72 m on 59125d6 and 7.0 m/s on e39b531 against
  1.08 m and 10.2 m/s now, so the growth came with the volley keys of R6 #5.
- **The walk stays Medium,** down from R6 #8's High: the trot, the crouch and the two-handed racket are gone, and what
  is left reads as a walk. This is a re-rank, not a softening: the same measures are given above.
- **Sheet-of-Y scare dropped.** One smash from a three-quarter camera looked like a star jump. `r7c-over.ts` shows it is
  side-on, and the video has "elbows 30-43, rising together" at that point.
- **The collar stays Medium.** Round 6 reached the same rank and my distance measure supports it.

### Each finding marked

| # | Mark | Note |
|---|---|---|
| 1 People close up | REPEAT R6 #9, R5 #10, R4 #7, R3 #21 | Open |
| 2 Volley swing | **REGRESSION** | Of R6 #5's fix. New measure |
| 3 Walk | REPEAT R6 #8 | Better holds; Medium now |
| 4 Racket speed | REPEAT R6 C#5 | The dip at contact is the new part |
| 5 Locked arm | REPEAT R6 C#6 | |
| 6 Víbora | NEW as a finding | The table's own row; R2 #4 was about shared keys |
| 7 Smash arc, leg | NEW as a finding | The table's rows |
| 8 Neckline | REPEAT R6 C#7, R5 C#5 | |
| 9 No voice | REPEAT R6 C#8, R5 C#8, R4 #26, R3 #19, R2 #11 | |
| 10 Quiet | REPEAT R6 C#9, R5 C#9 | Measured at last: rally -45.4, R5's -44.8 |
| 11 Rigid hair | REPEAT R6 C#11, R5 C#15 | |
| 12 Reactions | REPEAT R6 C#20, R5 C#17 | One set of strokes for ten people is the new part |
| 13 Practice | REPEAT R6 C#10, R5 C#11 | |
| 14 Singles win | REPEAT R6 C#12, R5 C#13, R4 #8 | |
| 15 Replays | REPEAT R6 C#14, R5 C#18, R4 #30 | The double cut is new |
| 16 Stadium | REPEAT R6 C#15, R5 C#20, R4 #31, #32 | |
| 17 Clubs, hall | REPEAT R6 C#16, R5 C#19, R4 #35 | |
| 18 Opening | REPEAT R6 C#17, R5 C#21, R4 #34 | |
| 19 Mesh | REPEAT R6 C#18, R5 C#10, R4 #28 | |
| 20 TV close | REPEAT R6 C#19, R5 C#22, R4 #29 | |
| 21 Floor | REPEAT R6 C#21, R5 C#7 | |
| 22 Knock-out | REPEAT R6 C#22, R5 C#12 | |
| 23 Lower third | NEW | |
| 24 Nothing answers the ball | NEW | |
| 25 Pops | REPEAT R6 C#26 | Unchanged |
| 26 Thighs | REPEAT R6 C#27, R3 #28 | |
| 27 Low balls | REPEAT R6 C#23 | |
| 28 Long names | REPEAT R6 C#28, R5 C#27 | |
| 29 Kit | NEW | |
| 30 Trail | REPEAT R6 C#29, R5 C#30 | |

### Statuses that don't hold

- **R6 #7 "contact 50":** the number doesn't reproduce. Median 57 (n 28), 64 (n 25), 74 (n 10): three seed ranges, all
  above 50. "Fixed" still holds: -0.2 s is 83, as claimed, and the first two contacts are inside the video's band.
- **R6 #5 "Better":** holds for what it measured, and it came with a cost nobody measured (finding 2).
- **R5 #10 "Teeth shading done":** still doesn't hold. p5's and p7's teeth are dark blue-black on WebGPU, seen at tile
  size in `sheet-faces2.jpg`, not measured at a grunt.
- **`docs/research/footage-pose.md`, two game figures are out of date.**
  - Bandeja elbow "50": see above.
  - Smash knees "none: open": there is a load now (72 / 57 at -0.4 s, n 13). It is late and small, not absent.
- **R5 #9 "f0 172-231 Hz":** stale, as round 6 found: 245-329 Hz on the loud grunts. The finding itself holds.

### Statuses that hold

- **R6 #7 Fixed:** see above.
- **R6 #8 Better:** 1.50 m/s, hips 0.96, straighter knee 30.2, racket low in one hand. Every number reproduces.
- **R6 #9 Open.**
- **R6 #5 elbow "34-41":** 33.9 overall, 45 on high volleys.
- **R6 C#5-8, #10-12, #14-22 Open:** seen or measured above. C#9 now measured.
- **R5 #7 Rematch and next round:** now played. Rematch keeps all four. "On to the semi-final" keeps your pair and
  deals new rivals (`d-rematch.png`, job `cup`).
- **R5 #8 singles cut-away:** 13 points, 0.0% empty.
- **R5 #6 women's kit:** by eye.
- **R3 #10:** key help folds after the first point.
- **R6 "Sound bank" and the tap:** the tap works with `TAP`/`LOUD`.

### Not checked

- **R6 #10, contact as drawn ("3 of 293 over 15 cm, worst 19"):** queued, but the Chrome lock never reached it (two
  jobs ahead of mine held it past the time limit). The swept QA's worst of 10.8 cm over 223 hits is another method, not
  a pass.
- **The human's racket as drawn, and `tools/bot-play.mjs` itself:** same queue. The capture bot, which uses that code,
  did run.
- **R6 C#13** (shoulder gash), **C#24** (holes), **C#25** (folds): not looked at.
- **Back glass and Volleys drills;** gamepad play; performance, which is measured separately.
- **Real-Chrome stroke strips** (`e-*`): the serve and the women's drive viewed (`sheet-serve.jpg`), the rest captured,
  not viewed, to stay within the image limit. Motion judged from the pane and from numbers.
- **The jib replay angle, women's replay, change of ends:** captured (`c-rp79w-*`, `c-ends95-*`), not viewed.
