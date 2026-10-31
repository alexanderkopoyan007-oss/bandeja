# Round 9: verification

Checked on `phase9` at 57fb7e1. Every number below comes from seeds neither report used (21001-30002), unless a row says it reruns a report's own seeds. No tracked
file changed and nothing is committed. Scratch runs are in `tools/out/r9v/` (gitignored). Frames are in
`/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r9v/`. The comparison tree is the pro's `git archive` of 8fd6459, which I
diffed against a fresh archive (`src` and `data` match). "Same seeds" means both commits ran them.

**Result.** All five High findings reproduce, and none is within noise. Two ranks and one mark don't hold, and one explanation is mostly wrong.

- **Pro 1, the back to the net, stands as NEW at High.** The rate is about half what the report gives, and most cases aren't stale plans.
- **Pro 2, the misread, stays High as a proven REGRESSION, on narrower grounds.** Defenders now lose balls they were in time for. The headline doesn't hold: the misread didn't cost more points to glass errors, and the easy-ball gap was already there.
- **Critic 1, the bandeja swing, is a REPEAT at Medium, not NEW at High.** Rounds 6 and 7 already had it, and the pro ranks the same fault Medium.
- **Critic 2, the foot tap, is NEW at Medium.** The number reproduces to the decimal, but it only shows between points.
- **Critic 3, the faces, stays a High REPEAT.**

**One finding stands as NEW at High: Pro 1. The loop goes on.**

## Critical and High findings

| Finding | Verdict | My number (sample) | Report's number | Rank I'd give | NEW or REPEAT |
|---|---|---|---|---|---|
| Pro 1: strokes and serves drawn with the back to the net | **CONFIRMED** (rate lower, cause corrected) | **Drawn as a contrapared, struck plain: 36 of 3,047 hits, 1.2%** (11 of 1,240 seeds 24601-12; 7 of 608 p7, seeds 24651-6; 18 of 1,199 seeds 28101-12), against 27 true contrapareds. Serves 5 of 485, 1.0%. Chest over 120° from the net on a non-contrapared 28 of 3,047, 0.9%. Chest at contact drive 153-165, lob 174-180, serve 165 (n 3). 24 of the 36 go past 120°; the volleys stay at 9-23. Turn 100-170° in the last 0.2 s (3 to 111, 12 to 180). My own probe on the pro's seeds 201-212 gives his exact 27 of 1,294, 16 true, so the probes agree and his seeds ran high. Seeds 28001-8: 21 more, of which **17 had a plan made for this ball**, after the last hit, and only the **4 serves** carried one across the point break (7.4-9.4 s old). **Real Chrome, WebGPU, first frames of this:** seed 24611, 136.5 s, a lob at 0.47 m, `forehand-contra` from -0.3 s through contact (`sheet-stale-side.jpg`) | 2.0-2.1%; serves 2.8%; "stale" | **High** | **NEW.** No earlier report has it. R2 #7 saw a bajada facing the glass, but that was traced to reach; R5 P#29's odd frames are other families |
| Pro 2: the glass misread gives points away, whatever the ball | **CONFIRMED as a regression, part of the claim WRONG** | Same seeds, 6,000 points each, 8fd6459 to today. **Per stroke, reproduced:** back-wall UE 8.8 to 11.2 (seed 21001), 9.7 to 10.9 (23001); double-wall 14.2 to 18.5, 15.7 to 18.0. **Double-bounce winners off a non-smash, non-drop (2,500 points each): 7.2 / 8.4% to 12.0 / 13.2%** (179, 211 to 300, 329); "in time at first bounce" **44 / 49 to 177 / 178**; plan off the wall 55 / 48 to 191 / 195. Balls through the glass that die, not smash or drop: 6.6 to 11.1 per 100 points (395 to 663; volley 258 to 376, víbora 22 to 109), median 63-65 km/h. Winners that bounce twice 48.5 / 47.3 to 55.7 / 55.0 (48). **Not reproduced as a cost:** glass errors per 100 points **27.4 to 27.7** (seed 21001), because glass shots fell from 3.02 to 2.61 a point. UE share of endings fell, 35.3 / 36.0 to 33.0 / 33.1 (29-33). **Easy back-wall balls were already bad: 5.1% (n 7,027) before, 6.2% (n 5,627) now**, groundstroke 0.7 both, seed 27001 | 8.9 to 10.7; 14.9 to 18.6; 8.3 to 12.9; easy 5.8 | **High**, on the double-bounce figures only | **REGRESSION** of R6 #3, proven. Not NEW. Against R8 P#7 / R1 #3 it moved the rate per shot, not the points |
| Critic 1: bandeja and víbora hit before the swing | **CONFIRMED, WRONG RANK, wrong mark** | Bandeja n 50 (p1 25, p7 25): 1.0, 1.0 m/s at -100 ms; 7.6, 8.1 at contact; 15.0, 11.1 at +17; sim 15.5, 16.0; path 0.49, 0.53 m before, 1.82, 1.82 after. Drive at -100 ms 5.6-5.9, path 1.59-1.77 m. Víbora n 8: 1.4-1.5, 7.3-9.3, 11.6-14.8; path 0.55-0.73, 1.77-1.78. Seeds 24201-8, 24301-8 | 1.0-1.1; 7.5-9.2; 11.1-14.3; 0.49-0.59; 1.81-1.84 | **Medium** | **REPEAT**, not NEW. R7 C4: "Bandeja 7.1 / 6.2 / 10.9 ... fastest after the ball has gone"; today 7.1-7.2 / 7.6-8.1 / 11.1-15.0. R6 C5 had 0.33-0.35 m of path in 0.07 s. Both Medium. Same fault as Pro 4 and Critic 7: merge the three |
| Critic 2: feet tap on the spot | **CONFIRMED, WRONG RANK** | **6.38, 6.39 lifts a second** (p1, p7), 4.3, 4.6 cm high, travel 0.2-0.3 cm, 154 and 131 player-s, seeds 24401-5, 24501-5. Set-up 2.93, 2.60. Per walk back: 3.9 episodes, median 0.71 s, p90 2.0, 3.3 player-s among the four (28 walks). **In the cut-away:** the framed pair have both feet in frame and tapping 0.85 player-s a walk, 6.1-9.7 m from the lens, so a lift is 7-11 px at 1600 × 900, computed from `views.ts` (n 28 walks). At TV about 4.5 px near and 2.5 far, computed | 6.21, 6.20; 4.3-4.5 cm; 2.7-2.8 | **Medium** | **NEW.** No earlier report. R8 #8 was the walk itself |
| Critic 3: faces close up | **CONFIRMED** | Assets don't change with a seed, so I took people the critic didn't: p3, p4 and p5 at the face camera, real Chrome, `sheet-faces.jpg` (p6's frame caught the back of his head). Game-character heads, even skin, hair a solid shape, drawn-looking eyes | PS3-era MakeHuman | **High** | REPEAT R8 #4, R7 #5, R6 #9, R5 #10, R4 #7, R3 #21 |

**Why Pro 1 stays High at half the rate.** 1.2% is about 12 hits in the pro's 991-hit match, and 1% of serves. It isn't a small error: the whole body faces the wrong way and spins through 100-170° in 0.2 s. True contrapareds are outnumbered, 36 to 27. R6 #10 went to Medium at 1%, but that was a racket 15 cm off a ball.

**Pro 1's cause and fix need correcting.** "Stale" fits the serves only. In 17 of 21 rally cases the AI planned a contrapared for this ball, then struck it plain, some before the planned contact (up to 1.67 s early). The pro's first fix, clearing the plan at the point's start, would catch about a fifth of them. His second, taking `contra` from what the sim strikes, should clear them at contact, so it is the one to do first. The backswing still reads the plan, so a late change of mind may need a blend of its own.

**Why Pro 2 stays High, and what doesn't carry it.**
- The per-stroke rates are real, but they don't show points given away. Glass errors per 100 points didn't move, and unforced errors fell as a share of endings.
- The line "a slow plain ball off the back glass is lost 5.8% of the time, seven times a groundstroke" describes something older. It was already seven times at 8fd6459 (5.1 against 0.7). The misread adds about one point, so scaling it by difficulty won't close that gap.
- What the misread did do is on the double-bounce line. A defender who was in time now loses the ball in about 7% of points, up from about 2%, and those balls have a median of about 65 km/h. That is R6 #3 back over its "under 8" target, and an expert sees it within a match.
- The gains are real too, same seeds: bandeja + víbora 1.5-2.3 to 7.4-7.9% of winners, smash 56.3-56.5 to 46.4-47.0.

**Why Critic 1 is Medium.** The numbers are exact, and the path before and after the ball is a better description than earlier rounds gave. But the fault was found twice at Medium with the same speeds, the pro ranks it Medium independently, there is no published swing time, and round 8's verifier ruled that a better account of a fault doesn't raise its rank. It is plainly visible in slow replays.

**Why Critic 2 is Medium.** It is real, and it lands every point. But it never shows in a rally, and it needs a cut-away and a look at the bottom of the frame. In play the pops, the feet sliding and the run all sit at Medium, and those are on screen all match. The critic's proof strip comes from a debug camera at knee height. My two tries at a strip through the game's own cut-away failed: the first caught a dip to black, and the second never got the lock. So the 7-11 px is geometry, not a frame I looked at.

**Critic 2's cause.** The report points at `gaitSince > 0.35 / hz` (`avatar.ts:2890`), but it can't be that line. With `WALK_HZ0` 0.6 it fires no faster than about 1.7 a second, and the code doesn't exist at 8fd6459, where the critic measured 6.21 and I measured 6.15. The 0.15 s period is `STEP_TIME` in the foot locks, so the standing stepper is the place to look. I didn't trace it further.

## Round 8 table

Rows marked Fixed or Better. Rows 5, 13 and 14 are Open, and 40+ are Low, so they aren't here.

| Row | Status claimed | Holds? | My number (sample) |
|---|---|---|---|
| 1 Lobbed net player | Fixed | **Yes** | Going back over 2 m/s, chest under 40°: 9.8% (p1, n 173), 11.1% (p7, n 180). Side-on 67.6, 66.1. The women's claimed 8.0 reads 11.1 here and 14.3 in the pro's run, small samples |
| 2 Weight | Fixed | **No: Better** | Facing the run 30.5 / 19.6 / 10.7 (n 4,156, 3,079, 1,939), as claimed. Sideways flat at 12.6 / 12.1 / 10.0 (n 3,627, 1,149, 1,131). Back 13.4 / 9.8 / 1.6. Half of padel's movement carries none of it |
| 3 Women's overheads | Fixed | **Yes** | Seed 26001, 6,000 points: smash W 31.4 (n 1,636), 15.7 s, W / FE / UE 32.2 / 28.8 / 39.1, volley 46.5% of winners, serving pair 59.9. The pro's "holds only for the overheads" isn't a failed status: the row names volleys 43 and the serving pair 61 as open |
| 4 Faces | Better, open | **Yes** | Critic 3 |
| 6 Pops of 15° or more | Fixed, 2.1 | **No: Better** | 3.2 and 2.6 a player-minute (102, 83 in 32 player-minutes each, seeds 24901-4, 24951-4). All pops 12.9, 12.7 holds. Above the 1.9-2.5 of round 7's commit, below round 8's 3.6-4.1 |
| 7 Walk back | Fixed | **Part: Better** | Forwards 69.1, 68.8% (n 25,915, 28,501; my probe, within 45°). Footsteps 2.26, 2.54 a second. Both feet off 6, 8% (claimed 4.3). The moving part holds. It leaves the tap (Critic 2), which it didn't cause: 6.15 lifts a second at 8fd6459 on my seeds 24401-3 (89 player-s). The critic's cut-away regression is not re-run |
| 8 Walk feet | Better | **Yes** | Over 5 cm mid-stance: walk 10.5, 7.3% (n 892, 1,065), from 20. Swing 24.1, 20.8 (n 589, 504): running stances unchanged, as the row says |
| 9 Racket through the ball | Fixed | **No: Better** | -17 / 0 / +17 ms: drive 10.1 / 8.1 / 10.6, 10.2 / 7.1 / 10.6 (n 43, 58), slice 12.6 / 8.3 / 10.3 (n 54), volley 4.4 / 3.0 / 7.0 (n 100), smash 13.4 / 8.9 / 17.2 (n 20). It keeps speed after the ball; the dip at the ball is 20-34% |
| 10 Low volleys | Fixed | **Yes** | Elbow under 0.6 m 51, 53 (n 13, 16); under 0.85 m 57, 56 (n 16, 8); seeds 25351-3, 25801-6. I didn't re-measure the opening rate |
| 11 Arm flick | Better | **Yes** | 45 of 150, 30%: serve 20, volley 19, forehand 27, backhand 8. Overheads don't share it: overhead family 100 (n 10), smash 89 (n 9). That is the 60-40-55 measure, stricter than the row's 25° |
| 12 Mix, replays | Better | **By code only** | `lift` 12 in `data/audio.json`, `engine.ts` adds it. `soundscape.replay` plays the point. **Why the tap reads silence:** in headless Chrome here an AudioContext says "running" but its clock moved 5.3 ms in 1.2 s, oscillator test, even without `--mute-audio`. It's the page, not the game. A level needs a person or an offline render |
| 15 Kit | Fixed | Not re-measured | No tool: the row's 8,640 views were a one-off pass. No hole seen at the face camera on p3, p4 and p5, three stills |
| 16 Heads and shoes | Better | **Yes** | 8 hair ids in `data/players`: p3 and p6 share `short01`, p2 and p8 `afro01`, told apart by `hair_fit`. The row's "all ten heads differ" rests on that fit |

**Other statuses checked.**
- **The pro on REVIEW.md's "blind on c660d41": correct.** All three round 8 reports say 8fd6459, and 230adaa came between that and c660d41. The misread has never been reviewed until now.
- **The critic's "Fixed" corrections to rows 2, 6, 7 and 9 hold.** The pro's on row 9 also holds, and his on row 3 doesn't.

## Corrections to the two reports

- Pro #1: the rate is 1.2%, not 2.0-2.1, on 3,047 fresh hits. "Stale" holds for serves only, and the fix order should be reversed.
- Pro #2: the easy-ball figures predate the misread, and points lost to glass errors didn't rise. Fix direction "scale by difficulty" should be tested against the double-bounce figures, not the easy-ball ones.
- Critic #1: NEW is wrong; it's in R6 C5 and R7 C4. Merge with Pro #4 and Critic #7.
- Critic #2: the code line named can't be the cause.

## Not checked

- No person played. AI play and frames only.
- A strip of the tap through the game's own cut-away. The job was still queued behind other sessions' Chrome when I wrote this. The px figures are computed.
- The back-to-the-net body from the TV camera. My "tv" frames kept the side camera, so I set them aside. The WebGPU frames show the side view only.
- `tools/bot-play.mjs`, left-handers and sound by ear.
- Row 7's cut-away regression, row 10's opening rate, and row 15's views.
- The pro's other "don't hold" items not listed above: R5 #3, `docs/ai.md`, and the serve-place side bug.

## What decides the loop

**NEW at High or above:**

1. Pro 1, High: strokes and serves drawn with the back to the net.

**Proven regression at High:** Pro 2, defenders losing balls off the glass they were in time for (R6 #3).

**REPEAT at High:** Critic 3, the faces.

**Lowered to Medium:** Critic 1 (REPEAT), Critic 2 (NEW at Medium).

By the loop's rule it goes on.
