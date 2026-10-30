# Review round 5: the professional player

I wrote this blind. I played and measured the game first and drafted every way it falls short of professional padel.
The draft is saved as `blind-draft.md` in the capture folder. Only then did I read REVIEW.md and the round-3 and round-4
reports to mark each finding NEW, REPEAT or REGRESSION. No code or data was changed for this review; this report is the
only tracked change.

**The short version.** Nothing is Critical, and the game is padel in kind. Round 4's big fixes hold: the rally now goes
to the corners and the serve to the side glass, and the drop volley no longer decides points. Five findings are High, and
four of them are new. They are about what happens once the ball is struck hard or struck well:
- A smash is answered with a full stroke on the rise, 0.44 s after it left the racket.
- Net volleys run backwards: the sitter is the risky ball and the ball at the shoes is the safe one.
- Lobs sail out over the side fence on one point in seventeen, over half of them perfectly timed.
- Every women's match, 35% of all matches, is played as a men's match.

The fifth, a repeat raised from Medium, is the server's run: a sprint above the 4.2 m/s a WPT player typically tops out at in a
whole match, then a stop.

## 1. How I reviewed

- **Code:** the brief's commit, phase9 at 78de80f. HEAD moved to 59125d6 during the review. That commit adds 24 lines to
  DECISIONS.md and changes no code or data, so everything below stands against both.
- **Levels:** level 1 (the "Pro" difficulty) unless I say otherwise. Level 0.5 is the other end of the ladder I measured
  in full. `point-mix` uses the tool's default level, 0.55.
- **Seeds:** all new to this round. Headless 1701 and 2101 for the two main ranges, 5001-5601 and 8101-9101 for styles and
  levels, 11000-13400 for the human bot, 21000 for the drills. Browser seeds 41-47.
- **Noise:** percentages on about 2000 points carry about ±2 points at 95%, on 3000 about ±1.8. Where it matters I give both
  seed ranges, written a/b.

| Tool | Run | Output (`tools/out/`) |
|---|---|---|
| `node tools/match-stats.ts` | 2040 points at level 1, two seed ranges (1701, 2101); 2040 points at level 0.5, two ranges | `r5p-l1.txt`, `r5p-l1b.txt`, `r5p-l05.txt`, `r5p-l05b.txt` (+ `.json`) |
| Levels and styles through match-stats | 1 v 0.5, 1 v 0.75, 0.75 v 0.5, 0.8 v 0.55; each style against neutral | `r5p-lv-*.txt`, `r5p-s-{muro,mart,serp}.txt` |
| `r5p-dump.ts` (new: every point as JSON: each hit with all four players, ball in and out, spin, flight, pressure, 6 Hz samples), read by `r5p-a1..a15.mjs` | Level 1: 5000 points (2500 + 2500, `r5p-d-l1a`, `-l1b`). Level 0.5: 2500. Singles standard 1500 at level 1, 1000 at 0.5. Narrow 1500 | `r5p-d-*.ndjson` |
| `r5p-smreply.ts` (new: what the defender's plan was at each smash on the rise) | 295 cases | console; figures in finding 1 |
| `r5p-human.ts` (new: the QA bot human in player 0's seat, headless) | Doubles at 4 levels, 6 one-key habits at level 1, singles at 4 levels with and without a recovery | `r5p-human.txt`, `r5p-human-rec-*.txt` |
| `r5p-practice.ts` (new: the four drills, with a bot that presses the drill's own key, and with the QA bot) | 300 feeds a drill | `r5p-prac-follow.txt`, `r5p-prac-bot.txt` |
| `node tools/point-mix.ts` | Doubles and singles, 6 seeds × 300 s | `r5p-mix-d.txt`, `r5p-mix-s.txt` |
| `node tools/anim-check.ts` | `r5p 120 3` (outputs moved out of docs/lab) | `r5p-anim-check.md`, `r5p-animcheck.txt` |
| `r5p-anim-feet.ts` (new: soles at contact and racket to ball, by stroke class) | 3 seeds × 200 s | `r5p-anim-feet.txt` |
| `node tools/out/r4p2-h2h.ts` | Six style pairings, about 3000 points each | `r5p-h2h.txt` |

**Round 3-4 probes.** All still run on today's code. Reused unchanged, on new seeds: `r4p2-log` (level 1, singles,
narrow), `r4p2-dir`, `r4p2-full`, `r4p2-front`, `r4p2-vh`, `r4p2-whiff`, `r4p2-giveup`, `r4p2-handoff`, `r4p2-anim-hand`,
`r4p2-anim-deep`, `r4p-ret2`, `r4p-oh`, `r4p-ohctx`, `r4p-nettake`, `r4p-lobfollow`, `r4p-backvol`, `r4p-dist`, `r3p-nettake`,
`r3p-backvol`, `r3p-lobfollow`. Outputs are `r5p-old-*.txt`, `r5p-log-{l1,s1,n1}.txt`, `r5p-dir-l1.txt`,
`r5p-full-{s1,n1}.txt`. Adapted: `r3p-cap.mjs` as `r5p-cap.mjs`, with filters by why a point ended, who lost it, and depth.

**Bot play.** The keyboard bot played the human side in real Chrome through the real input path, 60 s each. Output is in
`r5p-bot-{d41,s42,n43}.txt`.

| Mode | Seed | Hits | Timing error p50 | Notes |
|---|---|---|---|---|
| Doubles | 41 | 13 of 13 | 3.2 ms | Won 4, lost 2 |
| Singles | 42 | 21 of 21 | 2.2 ms | Won 2, lost 2 |
| Singles, narrow | 43 | 19 of 20 | 2.7 ms | One late swing, won 3, lost 4 |

**Captures.** 50 frames and 8 contact sheets, not committed, in
`/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r5-pro/`. Real Chrome via
`r5p-cap.mjs` and `tools/shot.mjs`, 1600×900 and 1280×720, seeds 41-47. Stale banners from sim-jumping are set aside.
Three of the planned frames weren't found (b09-b11: the moment of a high volley into the glass); finding 2 rests on numbers.

| Files | What they show |
|---|---|
| a01-a05, a32-a33 | Serve, return, third shot |
| a06-a09, a14-a18 | Groundstrokes; back, side and double wall |
| a10-a13 | Forehand and backhand volleys |
| a19-a25, a27-a28 | Bandeja, víbora, smash, bajada, chiquita, lob |
| b01-b06 | A smash and its reply on the rise, from TV, front and behind |
| b07-b08 | A lob leaving over the side fence |
| b12-b13 | A chiquita and the block that answers it |
| b14-b16 | Return and third shot |
| c01-c03, d01-d03 | Singles on the standard and narrow courts |
| e01, e02 | Practice (Volleys) and Knock-out, through the menus |

## 2. Findings, ranked by impact

Pro figures come from what `tools/match-stats.ts` prints beside each number and from `docs/research/shots-movement-feel.md`
(SMF), `docs/research/serve-and-strokes-motion.md` (SSM) and `docs/realism.md`. Each cell names its source.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Smashes are answered on the rise.** A flat smash bounces and kicks into the glass at chest height. A defender steps off its line and plays it off the wall, or it beats him. Here he stands on the line and swings a full stroke at it a fraction of a second after the bounce, often a lob. This is the most-watched ball in padel, and the defence is not humanly possible. | **All smashes (5000 points, n 2729):** 1685 returned: 993 (59%) after the bounce and before any wall, 415 (25%) off a wall, 277 volleyed. **Against two back (n 2036):** 986 on the rise, 83% of the 1186 replies. **Time:** p10/50/90 0.39/0.44/0.52 s after the strike, 0.08/0.16/0.24 s after the bounce, ball arriving at 71 km/h, contact 0.47/0.88/1.47 m high, from 7.67 m. **Strokes:** lob 38.3, drive 23.6, slice 21.7, chiquita 9.2, topspin 3.9%. **Full stroke against a smash over 115 km/h inside 0.5 s:** 29.6% of all smashes (29.9/29.3 by seed range). **Time budget:** reaction 140-190 ms (Triolet; Mecheri, SMF), preparation 0.11 s at the very fastest (Tai 2022, tennis, SMF), hitting phase 369-386 ms on wall shots and smashes (Espino 2015, SMF). **Result:** smash FE 19.1, W 38.3, UE 4.0, continues 38.6 (n 847, `r5p-l1.txt`); WPT 0.8 / 45.1 / 5.9 / 48.2 (Mellado-Arbelo 2019, SMF). **Cause (`r5p-smreply.ts`, 295 cases):** first plan 0.18 s after the smash; in time for it 6.8%; planned off the glass 4.4%. The defender is at 8.0 m, the ball reaches the wall 0.38 s after that first plan at 1.32 m, and a contact off the glass existed in 65.8% of cases, 1.55 m away. `simpleAi.ts:599-627`: not in time means "block it from where we stand", then the full `chooseShot` menu. Bandejas, for contrast, go 79% off the glass (`r5p-old-r4p-ohctx.txt`). Captures b01-b04: backhand lob at 1.74 m, 0.38 s after the smash. | On a hard ball after the bounce, step off the line and wait for the glass (`holdShort`, on the not-in-time path too). A contact on the rise inside about 0.5 s is a block only: no lob, chiquita or topspin, and little pace. Target: under 15% of replies on the rise, smash FE under 5, W towards 45. |
| 2 | High | **Net volleys run backwards.** The ball above the tape is the one a net player kills. The ball at his shoes is the one that hurts him, and it is why anyone plays a chiquita. Here the sitter loses the point one time in nine, and the shoe-top ball floats safely to 6.9 m. Pressure at the net has no teeth, so the fight for the net has none. | **Net volleys against two back:** at or over 0.95 m n 2361, lost 11.8, won 6.9 (seed ranges 10.8/7.2, 12.9/6.5); 0.55-0.95 m n 5000, lost 1.9, won 1.4; under 0.55 m n 3224, lost 1.6, won 0.7. 63% of the high ones lost go on the full into the glass, at 73 km/h. That is about 5.6% of all points thrown away on a sitter. **All net volleys by height, lost:** 0-0.35 m 3.5, 0.35-0.55 1.5, 0.55-0.75 1.5, 0.75-0.95 3.4, 0.95-1.3 10.2, over 1.3 15.5. **Every low height** clears the net by 1.20 m and lands 6.9 m deep. **The chiquita (n 2218, 98.7% against two up):** its own error 7.4%, the reply's error 1.6% (n 2028, reply struck at 0.51 m), a winner on the reply 1.7%. **The server's first volley off a chiquita return:** 0 errors in 146, at 0.36 m. **Published:** all volleys UE 3.4-4.8 (Mellado-Arbelo 2019, SMF), no height split. Errors by zone net / middle / back 19.6 / 20.1 / 60.3, pros 26.6 / 30.6 / 42.0. Winners 44.4 / 38.5 / 17.1, pros 56.6 / 32.1 / 10.6 (SMF §1e). **Level 0.5** has the same shape: 0.95-1.3 m lost 20.9, over 1.3 m 27.2, below that about 10. **Since round 4:** on-the-full volley endings 3.8% of points (n 3000) to 6.5% (n 2000), 1.4% of volleys to 2.4%. So the angles that fixed R4 #2 cost this. **Code:** `simpleAi.ts:895-904`, under 0.9 m is `safe` (precision, error ×0.6), over 1.05 m close in is `punch` (power, error ×1.45); `pressure.ts` scores height only below 0.4 m, with nothing for a ball below the tape; `:1105-1112` aims the angle with no margin from the glass for that error. | A put-away from close in should be the safest shot on the court: lower its error, or keep its margin from the glass. A volley below the tape should carry pressure, float short and err more. Targets: lost falls with height, chiquita's reply error above its own error, zone errors near 27 / 31 / 42. |
| 3 | High | **Lobs sail out over the side fence.** At pro level the lob is the safest and best-grooved shot in the game. Here a cleanly struck lob flies clean out of the court about six times in a hundred points. | **Lobs out on the full:** 288 of 5000 points = 5.8% (6.2/5.3 by seed range), 265 of them over the side (the 3 m middle section), 23 over the back. Level 0.5 4.4%. **All "out":** 6.9% of points, about 11% of errors; errors "other" 13.3 against pros' 3.2 (Ramírez Ortega 2025, SMF; `r5p-l1.txt`). The published class is errors made from outside the court; a lob over the fence has no class of its own there. **Quality:** 54% are Perfect-grade, none is a frame shot. **Direction:** yawed 4/22/44° off the line to the target, some 40-60°. **Pressure:** out rate 0.9% under 0.8, 10.0% to 1.6, 29.2% over it. **Lob errors overall:** 8.0%, 22.8% of errors against pros' 14.8 (Sánchez-Alcaraz 2022, SMF). **Since round 4:** "out after lob" 3.7% of 3000 points (`r4p2-log-l1.txt`) to 5.2% of 2000, so about 2.5 standard errors up; the lob target has not changed since round 3, so the rise comes from what the defender is lobbing off. **Code:** `simpleAi.ts:1065-1069` draws the side of the lob at random, whatever side the contact is on. Captures b07-b08: ball past the fence at (−4.79, 4.28, −1.11). | Pick the lob's side from where it is struck. Turn pressure into depth and height, not yaw. Keep the lob's target far enough off the fence for its scatter. Target: out on the full under 1.5% of points, "other" errors under 6%. |
| 4 | High | **The server sprints in and parks.** A server follows his serve in at a run of about 3 m/s and is still coming when the return is struck. Here he sprints flat out and stops at the volley line. The third shot, the one that wins or loses the net, is played standing still from where a real server would still be arriving. It is the first thing on every point. | **Run-in speed:** p50 4.4 m/s at 1.0 s, 4.5 at 1.2 s, p90 4.8. Accelerate to about 2.9 m/s, peak 2.93 ± 0.43 (Ramón-Llin 2021, SSM K8). WPT men's median top speed in a whole match 4.2 m/s (Miralles 2025, `docs/realism.md`). **At the return:** 3.67/4.09/4.58 m from the net (5.08 ± 0.58), moved 3.84 m (2.71 ± 0.58) in 1.27 s (1.22 ± 0.20). **Third shot:** struck from 2.66/3.13/5.20 m (3.84 ± 0.91, Ramón-Llin, SMF), at 0/0/1.39 m/s (1.98 on average, same source); 54% had already stopped. **Whole game (R4 #23):** 80.8% of rally shots struck under 0.1 m/s; in the transition zone 78.0%, over 1 m/s only 8.9% (n 10329); off the back glass over 0.5 m/s only 8.7%, though SSM says to move forward with the rebound. **Side effects:** the run-in is 27.8% of all time over 15 km/h; it helps the chiquita lose (finding 2). Output: `r5p-log-l1.txt`, `r5p-a*.mjs`. | Cap the run at about 3 m/s, stop about 1 m further back at the return, split there, and carry on through the third shot. Let approach shots and volleys be struck moving (R4 #23). |
| 5 | High | **Women's matches are men's matches.** The game now deals women in 35% of its matches and they play the men's game, shot for shot. Women's professional padel is measurably different: no serve advantage, fewer smashes that leave the court, points won on the floor. An expert sees that inside a match. | **`src/game/cast.ts`:** "Nothing here touches the sim: looks only"; `data/people.json` `womensMatches` 0.35. **Game against published women (SMF, men's in brackets):** serving pair wins 64.4-65.0 against 48.5 (62.5); edge lasts past the 12th shot against gone after the 7th (12th). Winners by double bounce / came back / out 46-52 / 31-34 / 13-15 against 76.9 / 11.8 / 11.3 (47.9 / 34.7 / 17.4). Bandeja and víbora together 60% of the game's overheads against a tray's 68.8 alone (men 55.7); the flat smash is 17.0% of women's overheads (men 26.6), the game's smash 26%. First serves in 93 against 87.7 (92.9). T 24, middle 18 against 30.3, 7.3. Errors into the side glass 16-18 against 24.6 (17.0), into the net 53 against 45.3 (51.4). Top speed in a match 16.8 km/h against 14.1 (15.2). **What fits by chance:** rhythm, 14.3 s (14.4-16.2) and 0.75 shots/s (0.73-0.75). | Pass a `women` flag to the sim with a skill and style table: smash effort and x3/x4 down, serve risk and T share up, lobs up. Fit it to the same stats. Target: serving pair about 50%, double bounce about 75% of winners. |
| 6 | Medium | **The formation is on rails.** | Depth when up (p10/25/50/75/90) 3.09/3.10/3.10/3.22/4.37 m, partners' stagger 0.02 m; back 7.45/7.93/7.98/8.00/8.21 m, stagger 0.03 m. "In depth, keep a stagger when one closes on the net" (SMF). Third-shot contacts spread ±0.91 m in real play (SMF). `formation.ts:8` `UP_Z` 3.1, `BACK_Z` 8.0. Capture a32. | Depth that follows who has the ball, how hard it was hit and the partner: closer on a high ball, further on a low one. |
| 7 | Medium | **Wall play moved to the corners instead of falling.** | Back 15.8 (12.8), side 6.1 (2.7), double 6.1 (3.5), all walls 28.0 (19.0; WPT 2014, match-stats). Round 4: 20.6 / 3.2 / 2.5 = 26.3. Double-wall UE 13.9, and 14.4% of errors (5.8% at round 4). Output: `r5p-l1.txt`, `r4p-stats-l1.txt`. | Reduce the supply: more low, short balls and fewer deep cross-courts into the corner. Tune double-wall errors after. |
| 8 | Medium | **Beaten players still swing, more than before.** | 12.7 whiffs per 100 points (n 254 of 2000; ±1.6), 8.9-9.7 at round 4. 92% out of reach, ball p50 1.59 m away; 10.9% of points end on one. Stand-downs 30.9 per 100 points; 23.1% of points end after one. Output: `r5p-old-r4p2-whiff.txt`. | Stand down when the ball will be beyond reach at the swing. docs/ai.md already promises it. |
| 9 | Medium | **Shin volleys from the back live on outside the bandeja.** | Volleys struck past 6 m: 0.27 a point, 2.9% of shots (n 411 of 14353), p25/50/75 0.25/0.52/1.16 m high, 0.16 a point under 0.7 m. They answer volleys 33%, lobs 24%, bandejas 19%, drives 9%. Against two up: contact 0.44 m, lost 13.7% (n 293). Output: `r5p-old-r4p-backvol.txt`, `r5p-log-l1.txt`. | `holdShort` for any ball landing at the feet past 6 m, not only one crossing the run. |
| 10 | Medium | **The net pair doesn't chase what passes it.** | Flat balls beating two net players by a double bounce 5.2% of points (n 103): the taker changed in 36, never in 67. Wider group 13.3% of points (n 266): 94% reachable at 4 m/s, nearest defender ended 2.73 m short, best peak 3.68 m/s, in 8% neither moved a metre. Output: `r5p-old-r4p2-giveup.txt`, `r5p-old-r4p2-handoff.txt`. | Hand over the taker on any ball past the net pair, and run. |
| 11 | Medium | **The serve's edge has the wrong shape.** | Serving pair by shots 1-2 / 3-4 / 5-6 / 7-8 / 9+: 74.8 / 71.6 / 75.5 / 64.8 / 57.3 and 76.3 / 74.1 / 70.4 / 67.1 / 56.6; national 98 / 65 / 64 / 57 / 42. Receivers win 1.8% of points outright (`r5p-log-l1.txt`, n 2000). 21 or more shots 57.5%; the WPT edge is gone after the 12th (SMF). | Follows partly from finding 4. Then shrink the third-shot advantage after shot 6. |
| 12 | Medium | **El Muro now loses to everyone.** | Muro 44.4 v Reloj, 45.4 v Martillo, 45.6 v Serpiente (about 3050 points each, ±1.8), each well outside noise. Round 4: 47.1 / 50.4 / 50.7. The rest are level: Martillo 49.6, Serpiente 50.4 v Reloj, Martillo 49.7 v Serpiente. And that is after `data/ai.json` gives Muro +0.08 level. Net time 28.0 against 33.1. Output: `r5p-h2h.txt`, `r5p-s-muro.txt`. | Give the wall what real wall players have: fewer errors off the glass, a better lob. Not more level. |
| 13 | Medium | **Practice drills don't isolate their shot.** | A bot pressing the drill's own key, 300 feeds a drill. **Volleys:** 44% of feeds volleyed, 23.8% untouched, the rest after a bounce. **Side glass:** 46.2% untouched; of those played 65.2% double wall, 6.8% plain side wall. **Back glass:** back wall 72.6% of the 71.7% played. **Lobs and overheads:** 86.7% bandeja of 98% played, the right drill. Bot caveat: a person may do better. In capture e01 the Volleys drill shows a contrapared hint. Output: `r5p-prac-follow.txt`. | Feed the Volleys drill to a player already at the net. Feed Side glass so it comes off one wall. Hints should name the drill's shot. |
| 14 | Medium | **Standard-court singles: the return passes the server, and nobody recovers.** | 4.94 shots, 7.77 s (n 1500). 56.5% of points end by double bounce; 20.4% of those touch no wall. The opponent is 6.33 m from the second bounce at the strike and 2.61 m at the end. 1-2 shot points 15.5%, the receiver wins 63.1% of them, 9.8% of all points, 69% with slices. **A human:** the positioning assist doesn't recover in singles. QA bot won 44/31/25/15% of points at levels 0.2/0.55/0.8/1 (0 of 37 matches); given a recovery, 61/55/42/30% (10 of 27). Output: `r5p-log-s1.txt`, `r5p-human*.txt`. | Keep the singles AI's serve-and-volley behind deep serves only; recover to the middle sooner. Give humans the same drift doubles has. |
| 15 | Medium | **On the narrow court the ball keeps leaving.** | 20.0% of points end with the ball off the court (out 10.5, exit 9.5). 21.5% on the full into a wall, 17.2% side glass (258 of 1500, 102 of them volleys). Volley lost 20.7%. Round 4 before the fix: 47.9 / 31.9. Output: `r5p-log-n1.txt`, `r5p-full-n1.txt`. | Scale targets, lobs and volley angles to the 6 m width. The margin that fixed the standard court is too wide a scatter here. |
| 16 | Medium | **Players hit their own partners.** | 1.1% of points end on the hitter's own side's body (n 5000; 1.3% of 2000), about once or twice in a match, 16 of them a smash into the partner. No published class exists for this because it barely happens. Output: `r5p-d-*`, `r5p-log-l1.txt`. | The partner moves out of the striker's line (R2 #3's fix did this for one case); the striker aims clear of him. |
| 17 | Medium | **Net volleys are struck low.** | n 3876: p10/25/50/75/90 0.36/0.51/0.69/0.92/1.19 m, 72.2% below the tape, 7.7% over 1.25 m. Tennis 3 m out 1.07-1.23 m (Chao 2008, SSM; an analogue). Output: `r5p-old-r4p2-vh.txt`. | Close in and meet it earlier. Helps finding 2. |
| 18 | Medium | **Stretched low contacts are still late.** | Racket more than 25 cm from the ball at contact: groundstroke 5.3% of 113, side wall 8.3% of 36 (`r5p-anim-feet.txt`), forehand groundstroke 18% of 34 (`r5p-anim-deep.txt`). Small samples; the median is 2-3 cm. | Plan the low stroke earlier. |
| 19 | Medium | **The forehand volley is played square.** | Chest 1-7° to the net at contact (n 17 over three seeds; 2° in 23 more), the backhand volley 59-62°. Coaching says a shoulder turn and a step (no sourced figure). Output: `r5p-animcheck.txt`, `r5p-anim-deep.txt`. Capture a10. | A forehand volley key with a shoulder turn of about 30-45°. Add it to animQa. |
| 20 | Medium | **No play outside the court.** | 5.5% of points end `exit_after_bounce`, every one after a smash (`r5p-log-l1.txt`). FIP 14.2 allows the chase. Rounds 3-4 ranked it Low; round 1 Medium, and I agree with round 1. | Stretch goal. |
| 21 | Medium | **Endings still read as qualifiers.** | W / FE / UE 36.9 / 25.7 / 37.4 and 37.7 / 26.0 / 36.3 (main draw 34-42 / 29-33 / 29-33). Back glass on the full 16.9/16.6 of errors (28). Volley last shot of winners 20-23.5% (28.4), under the pros for the first time; bandeja and víbora 8.7-9.6 (12.7). | More forced errors follow from findings 1 and 2: pressure from low balls, not from smash blocks. |
| 22 | Medium | **The bottom of the ladder is short and unforced.** | Level 0.5: 6.3 shots (about 7.3, derived, docs/ai.md), 8.3-8.4 s, W / FE / UE 22 / 24 / 54. Volley UE 15.5-16.7, back wall 21, double wall 29. Double faults 3.8-4.8%. Output: `r5p-l05*.txt`. | Fewer first-ball errors at the low end. |
| 23 | Low | **Server and receiver stand on the same spot every point.** | Server 2.10 / 7.70 m, receiver 2.50 / 8.60 m, p10 = p90, n 2500. Partners vary (2.31-3.10 m, 6.72-7.68 m). Output: `r5p-a14.mjs`. | The same small range as the partners. |
| 24 | Low | **Too many forehands in places.** | Side wall 50 (33), volley 52 (44), groundstroke 53 (46; WPT 2014, `r5p-dir-l1.txt`). Middle volleys 48.9% forehand. | Backhand side and forehand side should follow the player's side of the court. |
| 25 | Low | **Wall shots win a little too much.** | W 1.4-1.7 (pros under 1, SMF), in part balls nobody chases (finding 10). | |
| 26 | Low | **Split steps very common.** | 72 per 5 min of rally time against 7.7 per 5 min of play (Priego 2013, SMF), which looks low and covers dead time too. | Leave it unless it reads as a twitch. |
| 27 | Low | **Peak speed a little high.** | 0.5 s-smoothed match peak 4.58/4.68/5.01 m/s against WPT 4.2 (Miralles 2025). Mostly finding 4. | |
| 28 | Low | **Serves land short.** | 5.7-6.0 m from the net, inside the 6.95 m line by about 1 m. | Aim deeper. |
| 29 | Low | **Odd frames.** | a18: a double-wall drive at 0.30 m in a strange bent backhand. c01: a singles volley drawn with the víbora family. Thighs clip up to 14.8 cm (`r5p-anim-check.md`), which the round 4 critic judged ordinary crossover stepping. | |

Things that hold up as padel, measured this round:
- **Rhythm and rally shape.** 10.7 shots a point (10-11), 14.3 s (13.5-14.8), 0.75 shots/s (0.80). Scaled to Courel's mean, the
  rally shares read 29.1 / 23.8 / 19.8 / 27.4 (26.1 / 25.9 / 22.2 / 25.8), CV 0.83 (0.76).
- **Winners and errors in outline.** W / FE / UE above. Double bounce / came back / out 51.7 / 31.1 / 12.8 and 46.4 / 34.2 / 14.7
  (48 / 35 / 17). Errors into the net 52-54 (51). Smash 43-47% of winners (43).
- **The serve.** 57.9 / 23.7 / 17.9 (64.6 / 24.3 / 11.1), 66 km/h, faults 6.5-6.9% (men 7.1-10), double faults 0.8-1.4% (2).
  Serving pair 64.4-65.0 (62.5).
- **The return.** Lob 31.1% (34.7), flat ones played by the server 73% (71.9), return to third 0.76 s (0.86).
- **The fight for the net.** The lob makes 61-70% of net-takes (60.6). Net changes in 35.3% of points (37).
- **The overhead game.** In points: bandeja 40-42 (44-48), víbora 26.5 (20-23), smash 36-38 (37-41), bajada 19 (14-17), contrapared
  15.5 (11-13), lob 80 (76-81). Víbora faster than the bandeja, 80 against 73 km/h. Bandeja W 3.0, UE 2.6 (3.5, 3.1).
- **The rally's direction.** Cross/line 55.5/44.5 (57.5/42.5), 29.5% to the middle, the outer metre 5.8%.
- **Let-through for what isn't a smash.** 80.3% of balls past the service line are played off the glass; bandeja 90%.
- **The body.** Contact ahead of the body: volley 0.35-0.38 m (0.38), tray −0.01 (−0.01), smash 0.39-0.45 (0.45), serve 0.50-0.52
  (0.52). Racket to ball p50 under 3.5 cm in every class. Both feet off the floor on the smash, 0.33 m (100% of 26). Pops 15-19 per
  player-minute (the test's limit is 30). Side-on: backhand 59-80°, back-wall 46-78°, bandeja 57-59°, smash 1-4°. The serve's
  crouch is gone. The trophy with both arms up is normal for a bandeja, as seen in a19 and a20.
- **Tracking.** 83 m per rally-minute. Under 15 km/h 97.5%.
- **Styles are legible.** Muro 23.5% lobs and 10.9% of overheads smashed; Martillo 54.2% smashed, 42.9% at the net; Serpiente 57.4%
  of overheads víboras, touch 7.5%. Three of them are level with each other.
- **The ladder is monotone.** 1 v 0.5 71.1%, 1 v 0.75 60.5%, 0.75 v 0.5 59.4%, 0.8 v 0.55 58.1%.
- **Knock-out.** Rounds at 0.55, 0.8 and 1, one set to 4 games. The QA bot took 4 of 6, 1 of 6 and 0 of 9 at those levels:
  a fair climb.
- **No one-key exploit.** QA bot at level 1 by habit: slice 49.7, volley 48.7, lob 44.2, drive 42.2, topspin 37.4, drop 22.9.
- **The input.** Bot play grades exact, 2-3 ms p50.

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **NEW** | Same family as R3 #1 and R4 #4 (a ball taken that should reach the glass), but a different ball and cause. Round 4's own table shows the split, 85% after the bounce, 14% off the glass, n 416, and nobody judged it. It predates round 4's fixes, so it's no regression. |
| 2 | **NEW**, partly caused by R4 #2's fix | R4 #14 and #19 saw low contact and qualifier endings, not that risk runs against height. The angles that fixed R4 #2 nearly doubled volleys on the full. |
| 3 | **NEW**, worse since R4 #1's fix | R1 #6 counted side errors, never out-of-court lobs. "Other" errors were printed at 11.5 in round 4 and went unjudged. |
| 4 | **REPEAT R4 #13, raised from Medium**, with R4 #23 | Same distances as round 4 (4.12 → 4.09 m). Blind, I ranked it High, and I keep that for three reasons: it opens every point, instantaneous speed is 1.5× the published peak (round 4 had only a mean of 3.0 m/s), and the third shot is measured to be standing where a real one is moving. |
| 5 | **NEW**, came with R4 #9's fix | The women arrived in round 4's cast. |
| 6 | **NEW** | |
| 7 | **REPEAT R1 #3**, moved by R4 #1's fix | See below. |
| 8 | **REPEAT R4 #16, worse** | 9 → 12.7 per 100 points. |
| 9 | **REPEAT R3 #1, R4 #4** | Bandejas are fixed; the shin volley isn't. |
| 10 | **REPEAT R4 #17** | |
| 11 | **REPEAT R4 #12** | |
| 12 | **REGRESSION** caused by R4 #20's fix | Round 4 listed the style balance under what holds. |
| 13 | **NEW** | Practice came with R4 #10's fix. |
| 14 | **REPEAT R4 #6** | The human half is NEW. |
| 15 | **REPEAT R3 #17, R4 #5** | |
| 16 | **NEW** | R2 #3 touched the cause (partners in the line). |
| 17 | **REPEAT R4 #14** | |
| 18 | **REPEAT R4 #15, R3 #20** | |
| 19 | **REPEAT R4 #22** | |
| 20 | **REPEAT R1 #9, R3 #25** | Rank back to round 1's Medium. |
| 21 | **REPEAT R4 #19, R3 #16** | Volley winners overshot downward (32.5 → 20-23.5). |
| 22 | **REPEAT R4 #24** | |
| 23 | **NEW** | Round 4's Low #24 covered the partners, and that fix holds. |
| 24 | **NEW** | Round 4 printed these shares under "holds up". |
| 25 | **NEW** | |
| 26-28 | **REPEAT** R4 pro #26, #22, #27 | |
| 29 | **REPEAT R3 #28** for the thighs; the frames are NEW | |

No finding is Critical. Four Highs are NEW, so by the loop's rule it goes on.

### Round 4's statuses: which don't hold

- **R4 #6, "Fixed", singles has no fight for the net: Better, not Fixed.** Its figures reproduce: server 4.14/4.76/7.61 m at the
  return, server wins 57.5%. Volleys are 9.9% (claimed 11.2), and the third shot is a volley 22.4% of the time (was 2.9). But
  shots from the net zone are only 12.8% (10.5-11.1 before), the point is 4.94 shots (5.17 before), and the receiver still wins
  9.8% of all points in one or two shots (11.0 before). The server now runs in and the return goes past him.
- **R4 #20, "Fixed", the styles' net trait: fixed at a price.** The trait holds: Muro 28.0% at the net, Martillo 42.9%. The balance
  doesn't: Muro loses all three pairings by 4-6 points, outside noise. Round 4's "styles are balanced" no longer holds.
- **R4 #11, "Fixed", and R1 #3, "Fixed for the AI": true of the back glass only.** It is 15.8%, as claimed. All walls went *up*,
  from 26.3 to 28.0 (19.0), past R1 #3's 26.5, because side and double wall doubled, 5.7 → 12.2 (6.2). Double wall went from 5.8%
  to 14.4% of errors.
- **R4 #12, "Better: 75-82": the range doesn't hold.** I get 74.8 and 76.3 (73.1 in the log, n 134). Its floor is its ceiling. It
  is better than 66-74, within ±7 on these samples.
- **R4 #19, "Better: 33.8-36.6 / 27-28 / 35.6-38.4": thin.** Forced errors read 25.7-26.0, a point or two under the claim, about
  the size of the noise, and little above the blind 24-25.

### Statuses that hold, with a cost or a limit

- **R4 #2, "Fixed":** 0.054 drops a point, struck from 1.21 m, plain volley W 2.0, 46% wider than 2.5 m. All hold. Volleys on the
  full went from 3.8% to 6.5% of points with it (finding 2).
- **R4 #4, "Fixed":** 9.4% volleyed against two back, víbora 1.1%. It holds for bandejas. Volleys from past 6 m are unchanged,
  2.5-2.9% of shots (finding 9), and the fix never reached smashes (finding 1).
- **R4 #5, "Fixed":** 12.5% on the full, 8.2% side glass on the standard court. On the narrow court 21.5% and 17.2%: better than
  47.9 and 31.9, but the status doesn't say so (finding 15).
- **R4 #10, "Better":** Knock-out works and climbs well. Three of the four drills don't isolate their shot (finding 13).
- **R4 #24 (pro), serve-time places, "fixed":** the partners vary; the server and receiver don't (finding 23).

### Statuses that hold

- **R4 #1:** cross/line 55.5/44.5, middle 29.5%, |x| 0-1 m 14.8%, the outer metre 5.8%.
- **R4 #3:** side glass 57.9, T 23.7, middle 17.9; faults 6.5-6.9%; return errors on side-glass serves 6.7%.
- **R4 #18:** the víbora 80 against the bandeja's 73 km/h.
- **R4 #21 "Better":** faults 6.5-6.9%, double faults 0.8-1.4%.
- **R4 #25:** the crouch is gone.
- **R3 #2:** 73% of flat returns played by the server. **R3 #3:** lob 61-70% of net-takes. **R3 #4:** side-on backhands, 59-80°.
- **R2 #2, R2 #4, R1 #2, R1 #4:** the overhead game and its stances.
- **The Open rows in my area** (R4 #13-17, #22-24) are all still open, as the marks above show.
- **R2 #6, R3 #12, R3 #27, closed by round 4:** the shape still matches when scaled; lobs in 80% of points.
