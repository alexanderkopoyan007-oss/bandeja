# Round 8: verification

Checked on `phase9` at 8fd6459. Every number below comes from seeds neither report used (12001-16701). No tracked file changed and
nothing is committed. Scratch runs are in `tools/out/r8v/`. The comparison tree of round 7's commit c96b20b is in the scratchpad
(`r8v-c96/`), so "same seeds" below means both commits ran the same seeds.

**Result.** All five High findings reproduce, none within noise. One rank should come down: the pro's net fight is Medium, as round 7 had it.

**Two findings stand as NEW at High: the lobbed net player's backpedal and the bodies with no weight. The loop goes on.**

## Critical and High findings

| Finding | Verdict | My number (sample) | Report's number | Rank I'd give | NEW or REPEAT |
|---|---|---|---|---|---|
| Pro 1: the lobbed net player backpedals with his chest to the net | **CONFIRMED** | Chest from square at 0.2 / 0.4 / 0.6 / 0.8 / 1.0 / 1.2 / 1.4 / 1.6 s after the lob: **12, 13, 13, 17, 16, 28, 60, 81** (p1, n 47, seeds 14001-14005); **15, 15, 15, 15, 18, 35, 61, 81** (p7, n 64, seeds 14101-14104). Moving back over 2 m/s and under 40° from square: **70.2% (n 161), 66.8% (n 199)**. 1.5-2.5 retreats a point. Browser pane (WebGL), seed 14002, player 3: chest to the net at +0.8 and +1.1 s, racket before the chest, turned by +1.4 s (`sheet-ret-s.jpg`). | 11-17 up to 0.8 s; 64.5-70.6% | **High** | **NEW.** Not in rounds 1-7. Only a wish for a clip in `OPEN_QUESTIONS.md`. Critic 35 (Low) is the same fault seen through a gate over 3.5 m/s that this retreat mostly stays under; merge it here |
| Pro 2: only a lob moves a net pair, the chiquita has no bite | CONFIRMED, **WRONG RANK** | Lob 94.9% of net changes (n 4,112, `q13`). On `r4p-nettake`, the measure written for Muñoz's figure: **81.5% (n 1,937)**, chiquita 0% of 1,670. Chiquitas: volleyed 97.8%, volley errors 0.4% (n 3,086), met 1.20 / 1.65 / 2.24 m out at 0.71-0.80 m. Net pair still up two shots later 99.8%, hitter's pair both up 7.0%. Hitter's pair wins 37.9%, level with the lob's 38.4. | 95.0; 97.5, 0.2; 1.65; 99.8 | **Medium** | REPEAT R7 #8, R6 #19 |
| Pro 3: women's overheads don't finish, points run long | **CONFIRMED** | 6,000 points, seed 12501: **smash W 9.9% (n 1,980)**, 19.7 s, 13.9 shots, W / FE / UE 23.1 / 30.9 / 46.0, volley 62.9% of winners. Dump seed 16401: W 9.3, continues 86.9 (63), 104 km/h (n 664). Same seeds on c96b20b: smash W 11.4, 18.9 s, 23.6 / 31.1 / 45.3, volley 46.7. | 10.1; 19.4; 23.5 / 30.5 / 46.0; 63.4 | **High** | REPEAT R7 #13, R6 #23, R5 #5. Not a regression. The volley's rise is most likely the middle closing in round 7's fix (groundstroke, side and double-wall winners more than halved); I did not bisect it |
| Critic 1: the bodies carry no weight | **CONFIRMED** | Trunk / feet-to-head, facing the run, over 2 m/s. p1, seeds 14201-2: steady 19.0 / 17.3 (n 2,489), starting at +5.3 19.0 / 18.0 (n 3,357), braking at -6.4 18.6 / 16.6 (n 1,747). p7, seeds 14301-2: 16.0 / 17.2, 16.8 / 18.0, 15.7 / 16.2. **Regression, seeds 14401-3 and 14451-3 (n 4,414, 4,507): trunk 0.11-0.26°, body 0.11-0.23° per m/s² along travel, against 5.8 for atan(a/g).** Nine lags from -0.2 to +0.4 s: nothing over 0.7 the right way. Under 2 m/s, outside the report's gate: -0.02 to -0.35 at lag 0, so no hidden lean in the first steps. Sideways steps, trunk: starting 3.2, braking 12.7 (p1); 2.4, 8.6 (p7), the wrong way round. No acceleration input in `avatar.ts`. | ±1°; 3.5 / 11.9 | **High** | **NEW.** Not in rounds 1-7 |
| Critic 2: people don't look human close up | **CONFIRMED** | Assets don't change with a seed, so I took people the critic didn't: p3, p9, p10 in the pane, p3 and p10 in WebGPU. Waxy even skin, hair a solid shape. | sheet-b1, p1, p2, p7 | **High** | REPEAT R7 #5, R6 #9, R5 #10, R4 #7, R3 #21 |

**Why Pro 2 is Medium.**
- The 95.0 against 60.6 mixes measures. Round 7 called `q13` its "stricter measure". On the measure built for Muñoz the gap is 81.5 against 60.6, and that has not moved: 79.8-81.3 at round 7.
- The structure of the net fight is right: attack changes in 40.9% of points (37), and the chiquita wins as many points as the lob.
- Round 7 already had "chiquita success 0%" and ranked it Medium. Finding a cause doesn't raise a rank, as I ruled on round 7's singles. The fault is plain and worth fixing, but the game is right in kind.

**Why Pro 3 stays High when it is also a raised repeat.** The rally's character is right, which argues for Medium. But smash W is a new symptom no round measured, it is three times off a published figure (33.3), 87% of women's smashes come back against 63 on tour, and it sits on 35% of matches. A pro sees that inside a match.

**Limits on the two NEW Highs.**
- Pro 1's real-world half is coaching, plus the game's own notes (`SSM` line 331, and `CLAUDE.md`: "players turn for a lob"). No padel measurement exists. The first 0.4 s is under 1.3 m/s, so the visible backward run is about 0.6-0.8 s, not the report's 1.2 s. High stands: it happens in most points, and the sim already models a side-on run.
- Critic 1's "tens of degrees" is an upper bound. `atan(a/g)` is the body's centre over its stance foot, not the trunk, and the sim's accelerations are above WPT's tracker figures (`CLAUDE.md`: 6.4 / -7.7 against 4.6 / -4.5). Even 3 m/s² should give about 17° of body tilt. The response I measure is 3% of that, at every lag. The critic saw no capture of it. The rank rests on the numbers and on a far-pair player being about 120 px tall in a 1600 px TV frame.

## Round 7 table

| Row | Status claimed | Holds? | My number (sample) |
|---|---|---|---|
| #1 Slice key | Fixed | **Yes** | Slice alone, seeds 15001 and 15301: 45 ms 47.0, 45.9% (979, 977, ±3.1), 1 of 13 matches; drive 44.0 (1,040), 0 of 7. 60 ms 38.5 (979), 0 of 10. 80 ms 32.1 (975), 0 of 12; drive 35.4 (979). Human slice return winners 6.7, 3.4% (n 297, 298). AI v AI 1.1% (n 1,754) |
| #2 Smash comes back | Fixed | **Yes** | 4 of 6,000 (2 self, 2 partner) |
| #3 Singles server | Fixed | **Yes** | Receivers 5.07% (76 of 1,500), server 51.6. Slice returns there still W 18.8 (n 373) |
| #4 Forehand volley | Fixed | **Part: Better** | Lean holds: -31 mid, -32 low, backhand -1, -3 (`body.ts`, n 7, 32, 9, 17). Mid forehand elbow 63 (n 7), 61 (n 10). **Mid backhand "54": 43 (n 9), 49 (n 7).** Low volleys sit at the joint limit, 30-32 (n 30, 32), and they are 70% of volleys, so "from a straight arm" is fixed only above 0.85 m. Mid forehand still closes 113 to 40 in the last 80 ms (n 12) |
| #5 People close up | Better, open | Yes | Critic 2 |
| C2 Volley swung like a drive | Fixed | **Yes** | Path 0.52 / 0.42 / 0.53 m low / mid / high (n 167, 37, 42), drive 1.03 (n 46). My first run's 0.99 for high volleys was n 6 and went away at n 42 |
| C8 Neckline | Fixed | **Not for all ten** | Clean on p1, p2, p7 (critic). **p10's tank has saw-tooth holes through both shoulders and a slit behind the neck; the colour in them follows the backdrop, red then blue, in WebGL and WebGPU** (`crop-necks.jpg`, `crop-gpu-necks.jpg`). p3's polo collar shows a sliver. See below |
| C11 Hair | Better | Yes, by code | `HAIR_SWING` on the hem's lag. Not measured in motion |
| C12 Reactions, manners | Better | Yes, by code | Ten manners in `data/manners.json`. Not re-measured on screen |
| C29 Kits | Better | Yes, by code and frames | Panels, seams, marks; no print |
| P5 Sitters | Better | **Yes** | Volley W 3.5 (n 20,280, seed 12001). High net volleys W 9.3, lost 7.6 (n 5,619). Drop 0.126 a point, W 52.2 (n 757) |

Open rows I happened to re-measure, still open: bandeja + víbora 2.0% of winners, out of the court 6.5%.

**Other round 7 statuses.**
- **#18 "There is no left and right": a measuring bug, close it.** `q10.mjs` line 20 takes the side from the team number, which flips at a change of ends. By team number volley forehands read 53.9 / 53.2 on round 7's dumps. By the true side they read 79.3 / 27.9, and 75.5 / 38.3 today. Left-court returns backhand 76.9 (round 7's dumps), 78.6 today (n 2,858).
- **#25 "Pops steady": a proven REGRESSION at Medium.** Pops of 15° or more per player-minute, same seeds, 32 player-minutes each: **1.9, 2.5 on c96b20b; 3.6, 4.1 today** (61, 79 to 114, 132). All pops 15.6, 16.9 to 21.4, 18.8. Under the test's limit of 30.
- **#8's "91.8":** 94.9 on the same query (n 4,112), a real move on that query. Unchanged on `r4p-nettake`, so "worse" holds on one measure of two.

**Corrections to the two reports.**
- Pro: the mid forehand probes (63 and 42) don't disagree. `gs3` calls 0.6-0.95 m mid, and the others mean about 0.9 and up. Below about 0.85 m the elbow goes to the limit.
- Pro: "volley 41.2% of winners at round 7" was 2,040 points. Same seeds, 6,000 points: 46.7.
- Critic: the racket lean is two measures and both reproduce: `body.ts` -31, -32, handle to the horizontal -16, -17 (n 7-30). Fixed holds on either.

## One finding neither report has

| Finding | Rank | Evidence |
|---|---|---|
| **p10's shirt is holed at the shoulders, and it shows the court through her.** Saw-tooth gaps along both armholes, about 3-5 cm, and a slit behind the neck. | Medium | `?cam=face&camp=3&people=p3,p5,p9,p10`, seed 14601, ready stance, WebGL and WebGPU. Seen only at face-camera distance. Not judged at cut-away size (median 8 m, p5 4.85 m at round 7). p7 wears the same top and the critic saw her clean, so it may be p10's own fit. Against C8, not NEW at High |

## Not checked

- **Nothing in headless real Chrome.** A Meridian fleet (`deckcheck-all.sh`) held the queue for over 35 minutes, and each deck's ticket sorts ahead of mine. I cancelled my own job (only my two PIDs). The frames are from the Browser pane: the retreat and p9 in WebGL, p3 and p10 in both WebGL and WebGPU. `bot-play.mjs` not run.
- The retreat in the pane is one retreat. The numbers carry the finding.
- Faces of p4, p5, p6 and p8. p5 was not captured.
- Sound, drills, replays and camera findings: not ranked High, not re-run.
- Lower-ranked findings beyond those above, and older statuses (R1, R4, R5) except as they appear in these numbers.
- No person played. Human figures are the bot.

## What decides the loop

**Strictly NEW at High or above:**
1. Pro 1, High: the lobbed net player backpedals with his chest to the net.
2. Critic 1, High: the bodies carry no weight.

**REPEATS that stay at High:** Pro 3 (women's matches), Critic 2 (people close up).

**Lowered to Medium:** Pro 2 (net fight).

**Proven regressions, below High:** pops of 15° or more, Medium.

By the loop's rule it goes on.
