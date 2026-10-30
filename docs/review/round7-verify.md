# Round 7: verification

Checked on `phase9` at c96b20b. Every number below comes from a seed range the reports did not use. No tracked file changed and
nothing is committed. Scratch runs are in `tools/out/r7v/`. The comparison build of round 6's commit e39b531 is in the scratchpad
(`r7v-e39/`).

**Result.** All five Critical and High findings reproduce. One rank should come down: the pro's singles finding is Medium, not High.

**No finding is strictly NEW at High or above.** Two of them are proven REGRESSIONS on the same seeds against e39b531: the Critical
slice exploit and the High forehand volley racket head. Going by the word NEW alone, the loop would stop with a Critical open. Earlier
rounds counted regressions as well (round 6's "new or regressions"), and on that rule the loop goes on. The last section gives both
lists.

## Critical and High findings

| Finding | Verdict | My number (sample) | Report's number | Rank I'd give | NEW or REPEAT |
|---|---|---|---|---|---|
| Pro 1: one unaimed key (slice) beats every level | CONFIRMED, with a limit | Slice bot, 45 ms noise, level 1: **66.5% (926 points, seeds 6701+) and 63.4% (932, 7301+), 21 of 21 matches**. Level 0.8: 66.3% (701, 8 of 8). Level 0.55: 67.1% (764, 9 of 9). Drive 42.2 and 42.6% (953, 936), 1 of 16. Mixed 45.8% (990), 1 of 7. Slice returns 51.4 and 49.3% clean winners (n 210, 215). Receivers win 3.2% of points inside 2 shots (95 of 3,000, ±0.6). Serving pair wins 53.2% of 1-2 shot points (n 203). | 58-61%, 23 of 23; 51%; 2.4 / 3.2% | **Critical** | **REPEAT R6 #12, and a proven REGRESSION.** Same bot and seeds on e39b531: 51.0 and 49.7%, 5 of 12 matches. Slice return winners 17.9 and 14.2%. Receivers 1.7%, serving pair 71.8% |
| Pro 2: a smash winner comes back and loses the point | CONFIRMED | 45 of 3,000 points (1.5%, ±0.4), 2.4 a match, 6.9% of would-be smash winners. 25 hit the smasher, 20 the partner, 1.65 / 1.77 / 1.95 s later, all after one bounce. Code: the dodge sits inside `if (coming)`, `simpleAi.ts:409`. | 74 of 6,000; 5.8% | **High** | REPEAT R6 #16. The rate is within noise of round 6's 1.2 |
| Pro 3: standard singles, the server jogs at 3.0 m/s | CONFIRMED, **WRONG RANK** | Receivers win 11.3% inside 2 shots (169 of 1,500, ±1.6). Cap removed, same seeds: 5.8% (87 of 1,500), server wins 46.1 to 53.1%. Server's peak speed after a return winner: p50 3.13 m/s, never over 3.2 (n 169). Cap off: p50 4.29 (n 87). | 11.0 to 7.0%; 49.3 to 52.0% | **Medium** | REPEAT R6 #14, R5 #14. The rate has not moved in three rounds (12.9, 11.0, 11.3). Finding the cause does not raise the rank, the mode is secondary, and there is no pro baseline for it |
| Pro 4: forehand volley hangs the racket head from a straight arm | CONFIRMED | Racket lean, low forehand volley: -65 / -64 / -61 (p10/50/90, n 33). Mid: -65 / -61 / -18 (n 19). All volleys elbow 34.6 (n 74), 82.5 at -0.2 s (n 74), 63 on video. Seeds 7201-7208 and 7701-7708. | -62, -64; 31 | **High** | REPEAT R6 #5, with a REGRESSION on the mid volley. Same seeds on e39b531: mid -22 / -9 / -7 (n 10), low -62 / -56 / -31 (n 30). So the low volley was already hanging, and only the mid one regressed |
| Critic 1: people don't look human close up | CONFIRMED | Faces are fixed assets, so a new seed can't change the look. I viewed `sheet-faces2.jpg` and agree, teeth and hair included. Camera distance to players in cut-aways, seed 8801 (Browser pane): p5 4.85 m, p50 8.1 m, under 4 m 2.6% (n 2,776 samples, 19 points). | 4.7, 7.6, 2.7% | **High** | REPEAT R6 #9 and earlier. Not counted as new, as the critic says |

**Pro 1 needs this limit stated.** The headline holds only for accurate timing:

| Timing noise | Timing window 1.25 | Game default 1.5 | Drive at the same noise |
|---|---|---|---|
| 45 ms | 63.4% (932) | not run | 42.6% (936) |
| 60 ms | 56.4% (902), 7 of 7 | 55.7% (959), 7 of 7 | not run |
| 80 ms | 48.3% (1,030), 1 of 6 | 50.0% (1,087), 3 of 7 | 35.2% (951), window 1.5 |

- At 80 ms it no longer beats level 1, but it still holds level with it, and stays about 15 points above drive. All these runs use seeds 7301+.
- The cause holds. The same bot on the same seeds, aiming at a corner instead of the untouched middle, wins 42.8% (976, 0 of 8) and
  39.1% (1,032, 0 of 10). Aimed slice returns win 0.5%, not 50%.
- I keep Critical because the AI's level stops mattering: 66-67% at 0.55, 0.8 and 1. No person has played it, so whether a player
  really times under 60 ms is still open.

**One Medium worth a look.** Critic 2, the volley's swing length, reproduces: 1.05 m (n 69) against a drive's 1.04 (n 38), seeds 8501-8506.
It is the same stroke as Pro 4 and should be fixed with it. I did not judge it at TV distance, so it stays Medium.

## Round 6 table

| Row | Status claimed | Holds? | My number (sample) |
|---|---|---|---|
| #1 Net players let balls past | Fixed, 31 to about 3.5 per 100 | **No: Better** | 7.6 per 100 (114 of 1,500, seeds 6901+). Pro's three ranges 7.9-9.3. Target was under 5 |
| #2 Points end on the smash | Better | Yes for endings; smash within noise | W / FE / UE 36.2 / 27.6 / 36.2 (2,040, seeds 6101+). Smash 53.3% of winners (55.7 to 52.2 claimed), so that move is not clear. Volley 21.0 (23.7). Out of court 6.2 |
| #2, the volley part | 14.4 to 23.7 | Number yes, meaning no | Same seeds on e39b531 and now: drop volleys 0.038 to 0.097 a point, W 31.9 to 49.0%; plain net volleys fell from 4.4 to 3.1% of points |
| #3 Soft balls die | Better, 11.2% | Yes | 10.0% (150 of 1,500, die2); 11.1% (333 of 3,000, q-die). Swings at air 1.2 per 100 (18 of 1,500). Target under 8 not met |
| #4 Smashes on the rise | Better, 70.3 to 18.8 | Status yes, **number no** | 70.3 was against two back, now 33.6% (163 of 485). All replies 21.6% (164 of 758), smreply 23.8% (91 of 382). "70% off the glass" is 60.4% of replies (458 of 758) |
| #5 Forehand volley | Better | **Only in part** | Chest 36-37 (n 52) and elbow 34.6 hold. Racket head got worse, see Pro 4. Wrist 0.41 not re-measured |
| #6 Formation on rails | Fixed | Yes | Net pair z p5/50/95 2.09 / 2.28 / 4.69, stagger p50 0.44 (n 15,125). Below the tape 66.3% (77.0 on e39b531, same seeds). The 2.1 m floor is the pro's Low #22 |
| #7 Bandeja arm | Fixed | Status yes, **"contact 50" no** | Elbow 85.0 at -0.2 s, 62.9 at contact (n 22). Inside the video's 54-65 |
| #8 Walk back | Better | Yes | 1.50 m/s, hips 0.96, straighter knee 30.5 (n 30,010 ticks, seeds 7601-7603) |
| #9 People close up | Open | Yes | Critic 1 above |
| #10 Racket misses the ball | Better, Medium | Rate yes, **"worst 19" no** | 6 of 561 over 15 cm (1.1%), median 2.2 cm, worst 40.8 cm on a low volley. Node, same method as the page probe, not real Chrome. Medium stands |
| P #8 Beaten players swing | Better | Yes | 1.2 per 100 (as #3) |
| P #20 Contrapared | 11.9% of points | Frequency yes | 12.4% of points (2,040). 24.5% lost (n 339), 38.9% after a smash (n 108), so the pro's point on errors holds |
| P #24 Strokes on the run | Better | Barely | 70.3% still under 0.1 m/s; third shot 0.70 m/s (n 1,484) |

## Reports' status claims I re-measured

- Pro on R6 #1, #2, #4, #5, P #20 and P #24: all agree with my numbers above.
- Critic on R6 #7: agrees. My 62.9 falls inside its 57-74 spread.
- Pro on R4 #12: agrees, the serving pair wins 53.2-55.8% of short points.
- Pro on R1 #3: agrees, glass shots 27.1-28.6% of shots.
- Pro on R4 #6: agrees and is lower still, server wins 46.1% on the standard court.
- Pro's "from 1.5 m or higher 2.3" came out 1.4% (n 282), and drop W 52.1 came out 49.0% (n 290). Small samples, and neither changes a finding.

## Not checked

- **Nothing in real Chrome.** `/tmp/meridian-one-chrome.lock` has been a regular file since 20:53:02, with no holder updating it. `one-chrome.sh`
  needs `mkdir` to succeed and clears stale locks with `rmdir`, so neither works on a file and the queue looks stuck. Three other jobs were
  waiting. I left it alone, since it is shared with Meridian's sessions: the owner should look at it. This may also be part of why the
  pro's Chrome chain never ran.
- `tools/bot-play.mjs` and the real keyboard path, for the same reason. The slice result is headless. No person played.
- The own-smash moment on camera. The rate is measured, but nobody has seen one.
- Faces in a new real-Chrome take. I used the critic's sheet and new camera distances.
- R6 #5's wrist figure, and the pro's elbow timeline at -0.1 s.

## What decides the loop

**Strictly NEW at High or above: none.**

**Proven REGRESSIONS at High or above**, which earlier rounds counted towards going on:
1. Pro 1, Critical: the slice exploit. 51 to 65% of points on the same seeds, and slice return winners 16 to 50%.
2. Pro 4, High: the mid forehand volley's racket head, -9 to -61°.

**REPEATS that stay at High:** Pro 2 and Critic 1.

**Lowered to Medium:** Pro 3.
