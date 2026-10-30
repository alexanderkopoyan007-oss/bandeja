# Review round 6: the games critic (Top Spin 2K25 lens)

Branch phase9 at e39b531, dev server on :5192, 30 Oct 2026. Everything here is against e39b531. Later changes to AI
timing and volleys are not reviewed. Sections 1 and 2 were drafted blind (`tools/out/r6c-draft.txt`), and the
corrections made afterwards are listed at the start of section 3. No code, data or tracked file was changed. This
report is my only new file outside `tools/out`.

**This review was stopped early at the coordinator's request.** The last job, `r6c-jobs-i` (the status checks), was
queued for Chrome and stopped before it started. Those checks are listed under "Not checked". Each is marked as such,
not passed.

**Verdict.** Nothing is Critical. There are 4 High, 18 Medium and 7 Low findings.
- **One High is a REGRESSION:** the last pose pass fixed the bandeja's contact but left the arm straight overhead for
  0.31 s before it.
- **One High is NEW:** the walk back is a trot in the ready crouch.
- **Two Highs are REPEATs:** the faces, and the racket missing the ball.

The loop therefore goes on. Both new Highs are about how people move. The walk shows on nearly every point and the
bandeja often.

**How to read "Basis".** **M** = measured, with the sample given. **J** = my judgement from captures or from reading
the code. **M+J** = the number is measured and the rank or the reading of it is judged. Real-world figures I give from
general knowledge are marked as such.

## 1. How I reviewed

**Tools**
- Capture runner: `tools/out/r6c-cap.mjs`, a copy of `r5c-cap.mjs`, through `tools/one-chrome.sh`. Jobs are
  `tools/out/r6c-jobs-a` to `-h`, adapted from rounds 3-5, and `-f0`, a scan of hit times inside the browser.
- Reused: `r3c-sheet.py`, the draw-time contact probe (`MEASURE`, `r3c-jobs-h.mjs`), the camera probe (`PROBE`,
  `r5c-jobs-j.mjs`), the Phase 3 QA (`r6c-anim.ts`, a copy of `r5c-anim.ts`), `r5c-walk.ts`, `r5c-oh.ts`, and
  `r6-pro.ts`, `r6-game.ts` and `pose-metrics.ts` (as `r6c-pro.ts`, `r6c-game.ts`).
- New this round:
  - `r6c-swing.ts`: the racket face as drawn, by shot.
  - `r6c-oh.ts`: an overhead's preparation.
  - `r6c-gait.ts`: the walk back.
  - `r6c-f0.ts`: grunt pitch.
  - `r6c-audio.ts`: the reel, measured per sound.
  - `r6c-jobs-g.mjs`: a three-quarter front camera set in the page, for strokes.
- `r6c-oh.ts` and `r6c-swing.ts` also ran on 59125d6 (the code round 5 reviewed), and `r6c-oh.ts` on f01a5cc, in
  scratch copies under `tools/out/r6c-old-*`. That is what makes finding 1 a regression and not an opinion.
- Sound: `node tools/audio-reel.ts`. **I can't listen, so every sound finding comes from measurement or code.** The
  master-bus tap returned no audio blocks in two runs this round (jobs e and g, AudioContext "running"), so the live
  mix was **not** re-measured.

**Runs and samples**

| What | Sample |
|---|---|
| Arenas, courts, floors | 4 arenas, 3 courts, 3 floor looks, men and women, 1600 px |
| People | all ten, `?cam=face`, `body`, `hand` |
| Strokes, frame-stepped | serve, smash (men), bandeja (men, women), víbora, drive, low volley, plus a women's ready-to-move strip |
| Racket as drawn | seeds 2101-2106 and 2201-2206, 120 s each, 2 ranges agree; 59125d6 on 2201-2206 |
| Overhead preparation | seeds 2301-2308 × 120 s: 21 bandejas, 24 smashes, 2 víboras; same seeds on 59125d6 and f01a5cc |
| Pose against 33 tour photos | p1 and p7, seeds 1701+, 3 × 120 s; p1 again, 8 × 120 s |
| Walk back | p1 seeds 1701-1703 and 2401-2403, p7 seeds 2411-2412; 18,181 + 11,896 moving player-ticks in the last two |
| Replays | 2 stepped (one each angle); rate from seeds 41-52, 12 × 200 s, 18 replays |
| Match ends | doubles seed 82 (`gfx=tv`), women seed 84 and singles seed 65 (score set to 40-0 in the page) |
| Camera coverage | seeds 51 and 53 × 3 presets × 150 s, about 4,500 rally frames each; singles 120 s |
| Contact, draw time | seeds 56, 57 (two left-handers), 58 (women), 150 s each, 189 hits |
| Animation QA | seeds 1701-1704, 120 s each, four players |
| Human play | `tools/bot-play.mjs` doubles seed 69, singles seed 70; capture bot, seeds 61 and 62, 22 hits as drawn |
| A whole match | title to results through the menus: 4-2, 634 s, 7 replays, then pause, rematch, quit |
| Practice, Knock-out | 3 of 4 drills from the menu; Knock-out's first 40 s |
| Sound | reel of 42 impact and 10 crowd items, 24 grunt renders × 3 |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r6-critic/`.
I viewed 25 images, nearly all contact sheets (`s*.jpg`); file names below are in that folder.

## 2. Findings, ranked

Nothing is Critical. The game runs from the menus to the results and is padel from every camera.

| # | Rank | Finding | Evidence | Basis | Fix direction |
|---|---|---|---|---|---|
| 1 | High | **Before a bandeja the racket arm goes straight up and stays there for 0.31 s.** The last pose pass ("arms longer") fixed the elbow at contact and straightened the whole preparation with it, so the "Y" is worse than round 5's. This is the shot the game is named after. | Racket elbow flexion, degrees, seeds 2301-2308, p1, at -0.5 / -0.35 / -0.2 / -0.1 / 0 s: **round 5's code** 70 / 101 / 81 / 78 / 109 (n 30); **f01a5cc** 121 / 75 / 60 / 74 / 89 (n 21); **now** 119 / 46 / **30** / 41 / 39 (n 21), wrist 0.34 m above the head joint at -0.2 s, arm straight for 0.31 s (0 s on both older commits). p1 and p7 in `r6c-game`: elbow at -0.2 s 31.6 and 28.3, wrist 1.0 and 1.05 torsos over the shoulders (n 12 each). **Tour photos**, overhead prep: elbow 27-100, median about 60; wrist -0.36 to 0.49. Contact 46-47. The smash is right: 96 / 113 / 36. Captures: `s21-bandeja-m.jpg`, `s23-strokes.jpg`, frames 0-4 of the bandeja, 1-4 of the víbora (n 2, seen, so víbora is by eye). | M+J | Keep the new contact key and give the backswing back its bent elbow, extending only over the last 0.1 s. Pin the elbow at -0.2 s in `animQa`. |
| 2 | High | **The walk back is a trot in the ready crouch.** There is no walk clip, so after every point the players go back at 2.2 m/s with knees bent and racket up in both hands. This is the game's closest regular camera, and it runs on nearly every point. | `docs/mixamo.md`: no walk among the clips. Moving player-ticks in `sim.walking`: speed **2.20 m/s at both p50 and p95** (a constant); the straighter knee is still bent **40-42°** at the median; trunk 19-25° forward; p1 18,181 and p7 11,896 ticks. Standing during the walk: same crouch, knees 40-41°. In the rally the same measures are 38-41° and 20°, so nothing relaxes. General gait figures, not padel data: walking 1.2-1.5 m/s, walk-to-run change near 2 m/s, the stance knee under 20°. Captures: `s11-walk.jpg` (both frames), `s10-cut72.jpg` 12-17. | M+J | A real walk clip, upright, racket lowered in one hand, at about 1.3 m/s. The time budget of the walk will need looking at. |
| 3 | High | **The people still don't look like actual humans close up.** Bodies and kit are good at TV distance; the faces are the limit, as known. Ranked below 1 and 2 because they are only this visible in the close-up tool, while a cut-away shows them about 40 px tall. | `s3-faces.jpg`, `s6-neck.jpg`: smooth, waxy MakeHuman skin; brows as thin separate lines; p7's closed lids a bronze band; hair as solid helmets, with p5's and p9's fringes over an eye mid-rally. **Teeth:** in p7's open mouth they are dark blue-black (one frame, seen, not measured). The ten do read as ten different people. | J | MetaHuman pilot, as planned. Look at the teeth again: this is the second round they read blue. |
| 4 | High | **The racket still misses the ball on about one contact in thirty.** Medians are excellent. This keeps round 5's rank for now, with a caveat: I did not get to view these cases at TV, and that view is what made round 5 rank it High. If they read fair, it is Medium. | Draw-time probe, 189 hits in 450 s: 15 cm or more about 6 (3.2%; two of them sit at 15 after rounding), 30 cm or more 2. Worst: volley 63 cm at 0.30 m (seed 56, 61.17 s), slice 55 cm at 0.13 m (seed 58 women, 96.22 s), lob 25, slice 24, all four under 0.7 m. Median 1-2.5 cm, smash 6-10 cm. Round 5: 17 of 323 (5.3%). **That difference is within noise** (about 1.2 standard errors). | M+J | The low-ball cases on the run, then a replay filter on the worst contact. |
| 5 | Medium | **The drawn racket moves at about half the speed the ball needs, and the body doesn't whip.** The swing's time is right and its size isn't. Same on round 5's code, so not a regression. | Peak face speed as drawn, m/s (seed ranges 2101+ / 2201+), against `shots.json` racketMax and median ball speed out: drive 11.1 / 11.1 vs 19.1, ball 17-18 (n 51 / 46); slice 13.1 / 13.5 vs 17.8; volley 6.7 / 6.4 vs 12.3, ball 14; serve 8.6 / 8.6 vs 15.9, ball 18; bandeja 8.5 / 8.5 vs 20.7, ball 19, 0.33-0.35 m of path in 0.07 s (n 24 / 12); **smash 14.8 / 14.6 vs 29.5, ball 34.6 m/s** (n 12 / 15). Forward swing 0.11-0.15 s on drive, slice, volley and smash. Pelvis and shoulders peak within 0.01 s of each other (`pelLead`, drive n 51 / 46), so there is no hips-then-shoulders lag. `post.ts` has bloom and no motion blur. | M+J | A longer arc through the wrist and a real racket drop on overheads; lead the hips by a few frames. Show the owner before tuning: the tempo is good as it is. |
| 6 | Medium | **Every stroke meets the ball with the same locked arm.** | Median racket elbow at contact is the same number across groundstroke, low groundstroke, lob, chiquita, contrapared, volley, low volley and serve: **30.24° for p1, 31.39° for p7**, a limit and not a pose (n 110 groundstrokes, 42 volleys, 39 low volleys, p1). Ready 28.5°. Tour photos: volleys 56-67 (3 of 4), ready 52-63 (3 of 4), groundstrokes 33-44. Photo depth comes from a single view, so these are ranges and not targets. | M+J | Bring the volley and ready keys in towards the body; let the hip reach do less. |
| 7 | Medium | **The shirt's neckline is cut at triangle level, so it reads as torn.** Jagged edges, square notches and floating slivers of skin on about six of the ten. Only the close camera shows it: at 1600 px it doesn't read in a cut-away. | `s6-neck.jpg`: p2's sliver, p6's notches, p8, p10; `s3-faces.jpg`. Code: `kit.ts:462-470` drops whole triangles to open the collar. | J | A smooth cut in the shader, or re-meshed collars. |
| 8 | Medium | **No voice on court.** No umpire and no music, replays are silent, and the partner's calls exist only as text. Padel on TV is full of "mía!" and "vale". | No speech family in `src/audio`. `soundscape.ts`: no case for `E_CALL`. `game.ts:746` feeds the soundscape the live sim only, which is paused through a replay. | J | Replay audio first, then calls, then the umpire. |
| 9 | Medium | **The game is probably still very quiet.** Round 5's number carried, **not re-measured.** | Round 5: rally -44.8 dB, peak -12. My tap returned 0 blocks twice. | J | Re-measure once the tap works. |
| 10 | Medium | **Practice has no goal.** | `s20-cams.jpg`, job d's HUD text: a match board at 0-0 with a dealt coach's name ("Lautaro Ferreyra"); "Your point ... Games 0, 0" is announced and the score never moves. No count, streak or end. | J | Count clean returns, a best streak. |
| 11 | Medium | **Hair is rigid.** | `avatar.ts:905`: hair is a skinned mesh on the same skeleton, with no spring (shirt hems have one). | J | The hem's spring on tips of ponytails and braids. |
| 12 | Medium | **A singles win is still a shrug.** | `s26-ends-ws.jpg`, h-ends 01 and 04: the winner stands upright, racket down, while the crowd rises. | J | Something bigger for a lone winner. |
| 13 | Medium | **Shirts mark at the shoulder when the arm goes up.** | `s9-serve.jpg` frame 4: a dark gash at the sleeve, seen once. | J | Shoulder weights. |
| 14 | Medium | **Replays need a last pass.** Nearly all are smashes, and the second angle shows mostly floor. | 18 replays in 2,400 s: 16 smash, 1 drive, 1 slice. `s13-rp47.jpg`: the jib is far off and its lines run diagonally. The call banner sits on the first frame (`d-rp49-09`, `d-rp47-09`). The full match had 7 in 634 s (n 1, a perfect-timing bot). | M+J | A longer lens on the jib; clear the call as a replay starts (show the owner). |
| 15 | Medium | **Grey stadium, empty chair.** The low replay angle gives a third of the frame to a bare grey roof. | `s12-rp49.jpg`; `s21-bandeja-m.jpg`. | J | A dark roof with rigs; an umpire on the chair. |
| 16 | Medium | **The clubs and hall stay a generation behind the players.** | `s2-hall-night.jpg`: stair-step bands on the hall's grass, flat green beyond, tree trunks cut at the roof band. | J | Tree cards; the hall's coplanar ground. |
| 17 | Medium | **No opening; a change of ends is a camera orbit and a jump.** | `s24-ends.jpg`; the match opens on the wide shot with a banner (`s17-human.jpg`). | J | A skippable opening; a walk round the post (show the owner). |
| 18 | Medium | **The end-wall mesh sits over the near pair at the net.** | Near-at-net frames behind the band 82.3 and 82.6%; ball through it 30.0 and 32.7% of rally frames (seeds 51, 53). | M | The owner's choice of camera. |
| 19 | Medium | **"TV close" loses a player part of the time.** | Some player off screen 18.6 and 8.9% of rally frames; ball off 1.7 and 1.3%. `player` 6.6 and 2.7%. | M | Tilt down or follow the near pair. |
| 20 | Medium | **One reaction clip each, and one cut-away shot.** | `avatar.ts:205`; `s10-cut72.jpg`. | J | More clips; a second and third shot. |
| 21 | Medium | **The floor is flat paint on close cameras.** | `s11-walk.jpg`, `s12-rp49.jpg`. Seen, not re-measured. | J | Wear, fibre, ball marks. |
| 22 | Medium | **The Knock-out doesn't say which round it is.** Carried from round 5; only the first 40 s were seen here. | `g-ko-start2.png`. | J | A small draw (show the owner). |
| 23 | Low | **Low balls are still a little squat.** Stance and trunk now match the photos. | n 22, p1: hips 0.74 leg lengths (photos 0.78-0.88), knees 76 / 51 (27-63 / 19-43), stance 1.04 (0.84-1.22), trunk 42 (34-54). | M | A touch less knee. Photo depth is noisy. |
| 24 | Low | Racket holes read as chrome studs close up. | `s19-detail.jpg`, top left, one crop. | J | Darker hole walls. |
| 25 | Low | Shirt folds read as regular stripes on the back. | `s5-hands.jpg`, p1, p4. | J | Break up the pattern. |
| 26 | Low | Animation pops steady, under the limit. | 16.6-17.4 a minute, limit 30, seeds 1701-1704. | M | None needed yet. |
| 27 | Low | Thighs pass through each other. | 2.95-3.18% of frames, up to 14.9 cm. | M | Stance width in the ready pose. |
| 28 | Low | Long names cut off in the score bug. | "C. Barbosa · D. Carval..." (`s2-hall-night.jpg`). | J | Fit the name (show the owner). |
| 29 | Low | The ball trail reads as a long string. | `s19-detail.jpg`, bottom left. | J | A cue: show the owner. |

### What holds up

- **The strokes other than the bandeja's preparation.** The serve (`s9-serve.jpg`) and drive (`s8c-drive.jpg`) have real
  shape: a padel underarm serve, an open stance, a finish over the shoulder. The smash has a true elbow whip (96 / 113 /
  36) and a jump. Overheads are side-on: shoulders 74-84° at -0.2 s, n 45.
- **Timing of overheads.** The racket is up 0.65 s before contact (p10-p90 0.62-0.69), n 13 bandejas, 7 smashes.
- **Rackets and shoes.** Printed faces, wrist cords, a closed grip (`s5-hands.jpg`).
- **People at TV distance, men and women.** Ten distinct people; the women's fitted kit reads right (`s4-bodies.jpg`,
  `s25-playw.jpg`).
- **Match ends.** Embrace, walk to the net, tap, net shot, for men and women (`s15-over82.jpg`, `s26-ends-ws.jpg`). The
  crowd standing is still the best moment in the game.
- **Cut-aways in real frames.** The pair stays in shot through the walk (`s10-cut72.jpg`, frames 5-18).
- **Walk-back spacing.** Partners never under 0.40 m in 12 matches.
- **Truthful input.** Doubles 14 of 14 swings hit, error p50 4.2, p90 17.8, max 35 ms. Singles 12 of 12, p50 2.3, p90
  3.8, max 4.6 ms. The human's racket as drawn: 22 hits, p50 about 3.5 cm, worst 6.8 cm.
- **Animation QA.** Knee spins 0, soles never below the floor, swept contact p50 1.0-1.1 cm, p90 2.3-2.8 cm.
- **Camera.** Default TV: ball never off screen, any player off 0 and 0.3%.
- **App.** Title, setup, settings, pause and results are clean (`s16-app.jpg`). Start match 1.35 s, Rematch 1.29 s, quit
  to title 1.26 s; ready 4.45 s on a heavily loaded machine, so not comparable with round 5's 2.7 s.
- **Sound bank.** Nothing clips in the reel. Men's loud grunts 138-192 Hz, women's 244-329 Hz.

## 3. Against REVIEW.md

**Corrections after the blind draft.**
- **Bandeja, undecided to High, REGRESSION.** Running the probe on old commits showed the elbow change came with
  b536d6f. Bandeja's short swing (0.33-0.35 m) and low racket speed did not change, so they moved to finding 5.
- **The finding is the straight elbow, not the two raised arms.** Round 5's pro calls both arms up normal for a bandeja.
- **Dropped: "chest square to the camera".** My eye was fooled by the three-quarter camera: measured 74-84° side-on.
- **Dropped: low-ball stance 0.80.** That was n 7. With n 22 it is 1.04, inside the photos' range. The rest went to Low.
- **Dropped: cut-aways "nobody in frame 87%".** That was round 5's job p, already known to be false. Real frames show
  the pair. The job must not be used, and p2 did not run.
- **Set aside:** `c-bandeja-body` and `c-slice-body` (seed 74 is a women's deal, so Node's times don't apply; Node's
  scan matches the browser on men's deals, checked on seeds 71-73), and `d-over81` and `d-over83w` (no end in 200 s).
- **Faces:** High stays, placed below 1 and 2 because of how rarely they are this visible.

### Each finding marked

| # | Mark | Note |
|---|---|---|
| 1 Bandeja's straight arm | **REGRESSION** | Of R5 #13's pose pass (b536d6f). The Y itself is REPEAT R3 #22, R4 #25, R5 critic #16. |
| 2 Walk back | **NEW** | No earlier round measured it; rounds 3-5 praised the walk's staging and spacing, which still hold. |
| 3 People close up | REPEAT R5 #10, R4 #7, R3 #21 | |
| 4 Contact | REPEAT R5 #11, R4 #27, R3 #6, #20 | |
| 5 Racket speed, no whip | NEW | Present on round 5's code too. |
| 6 Locked arm | NEW | |
| 7 Neckline | REPEAT R5 critic #5, in part | |
| 8 No voice | REPEAT R5 critic #8, R4 #26, R3 #19, R2 #11 | The partner's silent calls are the new part. |
| 9 Quiet mix | REPEAT R5 critic #9 | Not re-measured. |
| 10 Practice | REPEAT R5 critic #11 | |
| 11 Rigid hair | REPEAT R5 critic #15 | |
| 12 Singles win | REPEAT R5 critic #13, R4 #8 | |
| 13 Shoulder | REPEAT R5 critic #14 | |
| 14 Replays | REPEAT R5 critic #18, R4 #30 | The smash share is new. |
| 15 Stadium | REPEAT R5 critic #20, R4 #31, #32 | |
| 16 Clubs, hall | REPEAT R5 critic #19, R4 #35 | |
| 17 Opening | REPEAT R5 critic #21, R4 #34 | |
| 18 Mesh | REPEAT R5 critic #10, R4 #28 | Same in kind. |
| 19 TV close | REPEAT R5 critic #22, R4 #29 | |
| 20 Reactions, cut-away | REPEAT R5 critic #17, #23, R4 #33 | |
| 21 Floor | REPEAT R5 critic #7 | |
| 22 Knock-out | REPEAT R5 critic #12 | |
| 23 Low balls | NEW | Follows b9fcf4a; small. |
| 24, 25 | NEW | |
| 26 Pops | REPEAT R5 critic #24 | Unchanged. |
| 27 Thighs | REPEAT R3 #28 | |
| 28, 29 | REPEAT R5 critic #27, #30 | |

### Statuses that don't hold

- **R5 #13 "Bandeja elbow still 100 against 47":** out of date, and the fix went past it. The elbow is 39 at contact
  now, but straight through the preparation (finding 1). "Fixed at contact, regressed before it" is the true status.
- **R5 #10 "Teeth shading ... done":** doesn't hold as "done". p7's teeth are still dark blue-black. One frame, seen and
  not measured, so treat this as a reason to re-check.
- **R5 #11 "none over 15.1 in about 440 contacts":** doesn't hold on the draw-time probe: 63, 55, 25 and 24 cm in 189
  hits. The status may come from another probe, so compare like with like. "Better" is not shown either: 3.2% against
  5.3% is within noise.
- **R5 #12 "0.45 s up":** understated. It measures 0.65 s now. A good result, but the figure is stale.

### Statuses that hold

- **R5 #6 women's kit:** holds by eye. Silhouette not re-measured.
- **R5 #9 women's voices:** holds. 244-329 Hz against men's 138-192 on the loudest grunts; `soundscape.ts:183` picks by
  `cfg.women`. Pitch measured, not heard.
- **R5 #13 ready stance 20.5°:** holds, 20.49, n 92,184.
- **R5 #10 three new haircuts:** hold. No shared bowl cut, no silver p9. Two fringes still cover an eye.
- **R4 #8 Better, R4 #9 Better, R4 #10 Better:** hold as round 5 corrected them.
- **R4 #25 "Fixed for the crouch":** the serve is upright. "The Y of the arms stays" is now worse.
- **R4 #26-35 Open:** #26, #28, #29, #30, #31, #33, #34 and #35 still open, seen or measured above. #27 is finding 4.
  #32 seen only as an empty chair.
- **R3 #10:** key help still folds after the first point.

### Not checked (job i was stopped before it ran)

- **R5 #7 Rematch and next-round cast:** only read in the code (`app.ts:109`, `:505`). Not played.
- **R5 #8 singles cut-away:** seen right at one match end (`s26-ends-ws.jpg`, seed 65, near winner). Point-by-point
  framing not re-run.
- **R5 #6:** the kit silhouette numbers.
- **Finding 4's two worst misses at TV:** not viewed, and that decides High or Medium.
- **Teeth:** not measured at a grunt.
- **R5 #12 "The akimbo tail stands":** I did not see it in the smash sequence (`s22-smash-m.jpg`), so it may be gone.
  One sequence, not measured.
- **Floors:** carpet and clay were captured but not viewed; only hard was.
- **R3 #29:** the pan.
- Also not done: the live mix; the fourth drill (Back glass); gamepad play; R5's Low items beyond those listed;
  performance, which is measured separately.
