# Round 7: the professional's review

Review of `phase9` at c96b20b. I wrote it blind: every finding numbered 1-15, 21-25 and 27 below was measured and drafted before I opened
`REVIEW.md` or the round 6 reports. That draft is saved as `tools/out/r7p/draft-blind.md` (not tracked). Then I read them and
re-ran round 6's own probes. That changed three things, and all three are marked in the table:

- **One rank went up.** The forehand volley was Medium in the draft and is High here (finding 4). Round 6's tool read the racket head 12° below
  level and today reads 62°, so "right in kind" no longer holds.
- **Five Mediums and one Low were added after reading** (16-20, 26). They are round 6 items I had not separately drafted. They carry a
  dagger (†) and are not independent confirmation.
- **Marks were added**, and small figures in the draft were corrected against their output files. One line on El Muro's matches that had no
  measurement behind it was cut.

**The short version.** One Critical, three Highs.

- **Critical:** one unaimed key beats every level. A bot holding only the slice key, never steering, won 58-61% of points at Pro and 23 of 23
  matches. Half its returns were clean winners.
- **High:** a smash winner loses the point when it comes back and hits the pair who struck it, one or two a match.
- **High:** in standard singles the server jogs at 3.0 m/s after the return, because the follow-in cap outlives the serve.
- **High:** the forehand volley hangs the racket head 62° below level from a straight arm, worse than round 6's 12°.

Round 6's "Fixed" on net players letting balls past doesn't hold (8-9 per 100 points, not 3.5), and its "70.3 to 18.8" compares two
different measures. The rest of the game stands up: rally length and shape, the serve, the return, the overhead mix, the smash's pace
and winner rate, and contact in front on nearly every stroke.

## 1. How I reviewed

**Headless runs.** All on today's code, on seeds round 6 did not use unless stated.

| Run | Sample | Output in `tools/out/r7p/` |
|---|---|---|
| `tools/match-stats.ts` level 1, seeds 2101 and 2301 | 2,040 points each | `l1-2101.txt`, `l1-2301.txt` |
| same, level 0.5 | 2,040 points each | `l05-2101.txt`, `l05-2301.txt` |
| same, women, level 1 | 2,040 points | `w-l1.txt` |
| Level matchups 1 v 0.5, 1 v 0.75, 0.75 v 0.5 | 1,500 points each | `lv-*.txt` |
| Styles against neutral | about 2,500 points each | `s-muro.txt`, `s-mart.txt`, `s-serp.txt` |
| Styles head to head (`r4p2-h2h.ts`) | about 2,600 points a pair | `h2h.txt` |
| Every point dumped (`r5p-dump.ts`), then queried | level 1: 6,000 points, level 0.5: 2,500, singles 1,500, narrow 1,500 | `d-*.ndjson`, `q1.mjs`-`q21.mjs` |
| Rich log (`r4p2-log.ts`) | doubles 1,500, singles 1,000, narrow 1,000 | `log-*.txt` |
| Bot in the human's seat (`r5p-human.ts`, and my `human2.ts`, which logs every shot) | 600-900 points a run, cue noise 45 and 80 ms | `human.txt`, `h2-*`, `h3*.txt` |
| Practice (`r5p-practice.ts`) | 300 feeds a drill | `prac-bot.txt`, `prac-follow.txt` |
| `tools/point-mix.ts` doubles and singles; `tools/anim-check.ts` 3 seeds x 120 s | | `mix-*.txt`, `anim-check-r7p.md` |
| `r6-game.ts`, `r6/body.ts`, my `oh-body.ts` (body timeline, 8 seeds x 150 s) | | `game-*.txt`, `body.txt`, `oh-body.txt` |
| Tick traces of chosen points | | `tr1.ts`, `tr2.ts`, `TR=` in `human2.ts` |
| Scratch experiment, no tracked file touched: server's run cap off once the return is struck | 3,000 doubles points, 1,500 singles | `exp1.ts`, `e1-*.ndjson` |
| After the draft: round 6's `letgo.ts` on ranges 5101, 1701, 5401 (1,500 each); `die2.ts` on 5301; `r4p2-dir.ts` (2,000); round 6's `q-*.mjs` on my dumps and on its own from e39b531 | | `letgo-*.txt`, `die2-5301.txt`, `dir-l1.txt`, `r6q-l1.txt` |

**Old probes.** All 19 re-run from `r3p-*`, `r4p*` and `r5p-*` still run on today's code (exit 0, `old.status`). I also reused `r4p2-log`, `r4p2-h2h`, `r5p-dump`,
`r5p-q`, `r5p-human`, `r5p-practice`, `r6-game` and `r6/body.ts`. `tools/out/r6-volley.ts`, named in the brief, does not exist, and there are
no `r6p-*` files at the top of `tools/out`: round 6's scripts are in `tools/out/r6/`.

**Chrome.** The lock never came. My capture chain and bot runs queued from 19:45 behind other sessions and had not run by the time I
finished. So the frames below come from the Browser pane, `?backend=webgl`, stepped by hand with `__snap`, seeds 71 and 77. I judged
poses and positions from them, and no lines or lighting. A slice bot run in the pane on seed 77 gave only 4 points (3 won), which is too few to
count for anything.

Sheets: `sheet-a1.png`, `sheet-a2.png` (strokes), `sheet-c.png` (a return passing a pair), `sheet-v.png` (low forehand volleys), in
`/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r7-pro/`. Five images viewed.

**Sources.** SMF is `docs/research/shots-movement-feel.md`; pose figures are `docs/research/footage-pose.md`. Published figures are in brackets. Level 1 and
doubles unless stated. Two-range figures are written a / b.

## 2. Findings, ranked

Critical 1, High 3, Medium 16, Low 7.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | Critical | **One key beats every level: the slice down the middle.** The middle between two net players is open, a slice through it dies at the back, and the untouched aim points straight at it. Someone who only ever presses L, and never steers, beats Pro. This undoes the level ladder and turns the return, the weakest shot in padel, into the best one. | **Bot holding only slice, released on the cue with 45 ms SD, `timingScale` 1.25 (stricter than the game's 1.5):** 58.4 / 61.5 / 61.2% of points at level 1 (n 900 / 826 / 703), **23 of 23 matches**; 64.8% at 0.8 (8/8); 69.3% at 0.55 (10/10). Volley key, which falls to slice: 61.6% (8/8). Same bot on drive: 44.2 / 43.4%, 0 of 13. Lob 44.9%, 0/6. Mixed 47.4%, 2/7. **51% of its slice returns are clean winners** (96 of 189; drive 0 of 205); other slices 11.0% of 1,212, other drives 1.2%. It made 3 errors in 826 points, about 0.2% a shot; the AI's slices err about 10% (n 8,112). With 80 ms SD it falls to 46.2% (1 of 6), still 30% return winners. So it needs good timing, not padel. **Cause.** `match.ts` starts every human rally shot at x = 0 and 7 m deep until steered. The net pair stands 3.4-3.7 m apart, so that line is 1.8 m from both. Flat balls 1.5-2 m from the nearer player are volleyed 70% of the time (n 1,813), against 89-94% inside 1.5 m (n 7,811). A slice dies at the glass, while a drive comes back to the server at 3.6 m (`q18.mjs`). **AI v AI, same hole:** 16.3% of flat returns pass through the deep middle (n 4,225), 21% of those are clean winners. Flat balls at two up land in the central metre 61.9% of the time (n 721; round 6 51.8). **Receivers win 2.4 / 3.2% of all points inside 2 shots** (3,000 points each; round 6 1.8), so the serving pair wins 53-64% of 1-2 shot points. National players win 97.9% (Ramón-Llin 2019, SMF §5), which implies about 0.15% of points. Passing winners 6.1% of points (368 of 6,000) against about 2.8% derived from Mellado's shares. **Traces** (seed 2101; human seed 34100 t 94.3, t 26.45): the net partner is the taker, moves late, misses reach by about 0.15 m and stands down, and the taker isn't handed on until the next prediction version, at the bounce. The server, 1.3-2 m from the line, keeps drifting to his lane. `r4p2-handoff`: taker changed 0.89 s after the strike, ball passed at 0.74 s, 6.4% of points. Capture `sheet-c.png`. | In order. (a) Hand the ball over in the air: when the taker can't reach it, the partner takes it at once. The sums say the gap isn't the fault: a ball 1.8 m away, passing in 0.74 s, needs a 0.45 m step. (b) The server owns the middle on the return until it has passed. (c) Close the pair a little with the ball central. (d) Give the human's untouched shot a real risk, or a less perfect line. Re-run the habit table: no key above mixed by more than noise. |
| 2 | High | **A smash winner comes back and loses the point.** Nobody steps out of the way of their own ball. | 74 of 6,000 points (1.3 / 1.1%): a smash bounces, comes off the glass and hits the smasher (41) or his partner (33) 1.65-1.96 s later, 98.6% after one bounce. That is 5.8% of would-be smash winners, one or two a match. Level 0.5: 0.3% (7 of 2,500). Narrow 8 of 1,500, standard singles 2 of 1,500. The rule is right (`rally.ts` `onBody`). The fault is `formation()`, which dodges only `if (coming)`, and the hitter's own ball isn't. Men's winners come back over the net 34.7% of the time (Ramírez Ortega 2025, SMF §1e), and players take one step. Also 25 of 6,000 points are a partner struck inside 0.4 s (0.4%). | Treat a ball coming back as `coming` for the dodge; check a human's positioning assist too. |
| 3 | High | **Standard singles: the server jogs after the return.** The serve's follow-in cap outlives the serve. | Receivers win 11.0% of all points inside 2 shots (165 of 1,500; `log-s1` 10.1), the server wins 25% of 1-2 shot points and 49.3% overall. Traces of seed 2101: the server chases a ball to the open side at exactly 3.0 m/s for 1.2 s and never arrives; top speed elsewhere is 4.8. `SimpleAi.serveIn` holds `SERVE_RUN` 3.0 until his own next strike (simpleAi.ts:217, :1234) and `drift()` applies it to the chase. **Scratch experiment, cap off once the return is struck:** 7.0% (105 of 1,500), server wins 39.0% of short points and 52.0% overall; doubles unchanged, 2.4 to 2.5%. Narrow court 0.7-0.8%, so this is the wide court's. Mode as a whole: 5.2 shots, 8.2 s, 15.7% of time at the net, slices 42.7% of winners. Mixed bot 44.0 / 28.1 / 25.1 / 17.3% at 0.2 / 0.55 / 0.8 / 1, no match won. | End `serveIn` when the opponent strikes. It is a one-line cause; re-measure the mode after it. |
| 4 | High, Medium in the blind draft | **The forehand volley hangs the racket from a straight arm.** It is the most-played stroke. The chest is fixed, but the head of the racket hangs down at the ball, the arm snaps straight in the last tenth of a second and the free arm flies out. "Head up" is the first thing a coach says about a volley. | **Racket lean (`body.ts`, 0 = level):** mid forehand volley **-62°** (p10/50/90 -65/-62/-17, n 14, contact 0.88 m); low -64 (n 32); mid backhand -5 (n 14); low backhand -35 (n 23). Round 6, same tool: 12-13° below level on mid forehands. **Elbow:** all volleys 31 at contact (n 141), mid forehand 45, low forehand 31, `r6-game` 44.6 (n 30) and 30.2 low (n 6); video 63 (53-79, `footage-pose.md`). **Timeline (`oh-body.txt`, n 141):** elbow 110 at -0.1 s, 31 at contact; wrist -0.15 to -0.67 trunks in that tenth. That is a drop of the arm, not a punch. **Cause:** `Family.wrist` sets the hand in front of the chest and "the racket turns the least way to reach the ball from there" (DECISIONS.md, a5d0d57), so a ball below the hand points the head at the floor. No video figure for the lean: pose can't see a racket; round 6's two tour photos show the head above the hand. Capture `sheet-v.png`: arm straight, racket by the shin. | Take the height from the legs and the hand, and cap the racket within about 30° of level on anything over the shin. Add volley lean to animQa. |
| 5 | Medium | **Sitters at the net aren't put away; the drop volley does the finishing.** | Plain net volleys win 1.2% (n 15,252); from 1.5 m or higher 2.3% (n 690), while the smash wins 45%. The drop wins 52.1% (n 620, 0.103 a point). Drops win 5.4% of all points, every other net volley 3.1%. **Same tool on round 6's dumps:** drop 0.044 a point, W 31.1, 1.4% of points; other volleys 4.1%. **High balls are lost more than mid ones:** at 0.95 m or over W 7.5, lost 6.2 (n 3,966; round 6 W 6.6, lost 1.9); 0.55-0.95 m W 1.4, lost 2.3. Pros' volleys W 3.4-5.7 (Mellado-Arbelo 2019); 28.4% of winners. | High volleys aimed to finish: feet, short angle, side fence, not deep to the glass. Take the drop back to about 0.05 a point. |
| 6 | Medium | **Bandeja and víbora almost never finish.** | 2.5 / 0.9% of winners (12.7, Sánchez-Alcaraz 2022); round 6, same tool: 9.1 / 9.0 / 8.3. Bandeja W 0.8 / 0.3 (3.5-7.2), víbora W 1.1 / 0.4. They do force errors (FE 3.7-6.3). Smash takes the difference: 52-55% of winners (43). | A short, wide víbora or bandeja that dies when the defender is late. |
| 7 | Medium | **Por tres and por cuatro are rare, and nobody leaves the court.** | Ball out of the court 6.0-7.0% of winners (17.4, Ramírez Ortega 2025); 2.0-2.2% of points. WPT men play a por tres in 7-8% of points (Martín-Miguel 2024). Back over the net 38.6-42.7 (34.7). Out-of-court retrieval doesn't exist (a known stretch goal). | Aim kill smashes to leave, as DECISIONS.md suspects. |
| 8 | Medium | **The fight for the net is lob-only.** | Lob 79.8 / 81.3% of net takes (`r4p-nettake` n 968, `r3p-nettake` n 662), 91.8% on my stricter measure (n 4,087), against 60.6 (Muñoz 2017). Chiquita success 0% of 852, drive 1%, slice 0%. Net pairs driven back by a lob 95.5%. Attack changes themselves are right: 39.4% of points (37). | A pair that plays a good chiquita walks in behind it. |
| 9 | Medium | **Too many balls are played off the glass.** | 3.1 glass shots a point, 28.3% of shots (19, Mellado-Arbelo 2019; about 1.7-2 a point). Double wall 0.67 a point, in 43.7% of points (28), UE 14.3 (`q-wall`). | Take more before the glass; fewer volleys to the corners. |
| 10 | Medium | **Contrapared errors.** | 24.9% lost (n 795; UE 4.7-7.7, Mellado-Arbelo 2019); 36% out, 33% on the full. After a smash 43.7% (n 222). Singles 45.5, narrow 40.7. Round 6: 15.2 and 18.9. | Plan its height from the ball's pace, and take it only when on. |
| 11 | Medium | **El Muro loses to everyone.** | 44.9 v Reloj, 45.8 v Martillo, 45.9 v Serpiente (about 2,600 points each, ±1.9). Martillo and Serpiente are within noise of neutral (49.5, 48.9, 48.8). `level` +0.08 does nothing at level 1, where it clamps. | Fewer free lobs, or let the clamp go. |
| 12 | Medium | **Practice: "Side glass" isn't side glass.** | A bot pressing the drill's key plays side-wall on 4.3% of first shots and double-wall on 64%; 77% of feeds reach the back glass; 45% go untouched; it wins 29% (n 300), at 69-88 km/h. It is the corner, padel's hardest ball, sold as the side-glass lesson. Back glass 77% back-wall, Lobs 98% overhead (bandeja 85), both good. Volleys 59% volley, 27% go by. | Feed shorter and slower so that it comes off before the back wall. |
| 13 | Medium | **Women's matches at the top level.** | W / FE / UE 21.4 / 31.7 / 46.9 (30-36 / 28-32 / 35.5-37.5, Conde-Ripoll 2025); 18.9 s a point (14.4-16.2); 13.2 shots. They are 35% of matches (`people.json`). The rally's character is right: lobs 23.9% of shots, volleys 41% of winners, back over the net 9.2 (11.8). | Fewer unforced errors, shorter points. |
| 14 | Medium | **Level 0.5: the wrong errors.** | W 18.3-19.8, UE about 55.6 (n 4,080), volley UE 17.5, back wall 20.5. Qualifiers: W 33.0-40.3, UE 37.2-38.4 (Conde-Ripoll 2025). Rally length is right: 6.9 shots, shares 28/26/22/24. The AI ladder separates; a mixed human bot doesn't feel it: 56.2 / 52.4 / 48.4 / 47.4% at 0.2 / 0.55 / 0.8 / 1, because the AI partner scales too. | Keep the rally, cut UE, let more winners through. |
| 15 | Medium | **Víbora body against video.** | Elbow 89-95 at contact, wrist 0.09-0.36 trunks above the shoulders (`oh-body` n 10, `body` n 6); video 53 and 0.6 (`footage-pose.md` clip 3). Contact 1.61-1.69 m. Bent arm, ball beside the ear; reads as a low bandeja (`sheet-a1.png`). | Raise the contact; straighten the arm. |
| 16† | Medium | **Net players still let reachable balls past.** | Round 6's probe: flat balls inside 1.1 m left to bounce **7.9 / 8.8 / 9.3 per 100 points** (118, 132, 139 of 1,500; three ranges). `letgo.ts`. About one point in eleven. Target was under 5. | Same family as #1's hand-off. |
| 17† | Medium | **A sixth of smashes against two back are answered on the rise.** | Same measure as round 6: 376 of 1,058 replies, 35.5%, of 2,278 smashes, at 0.37/0.43/0.50 s, slice 83% (under 15% of replies wanted). Budget 140-190 ms reaction (Triolet, Mecheri, SMF) plus a stroke. Smash FE 10.1-13.7 (0.8). A block is possible where a stroke isn't, so I rank this lower than round 6 did. | Step off the line and wait for the glass. |
| 18† | Medium | **There is no left and right.** | Overheads in the middle L/R 50.3/49.7 (n 2,414); winners by side 1,124 v 1,103 (41.8 v 34.1, Conde-Ripoll 2025); left-side returns backhand 52.8 (over 75, Sánchez-Alcaraz 2020). | Style tables can carry the left player's overheads. |
| 19† | Medium | **Almost everything is struck from a standstill.** | Hitter under 0.1 m/s at contact 70.4%, p90 1.14 m/s. Third shot by the server 0/0.69/1.21 m/s (1.98, Ramón-Llin 2021). | Let approach shots and volleys be struck moving. |
| 20† | Medium | **Narrow singles: the ball still ends on the wall.** | On the full 23.6% of points, off the court 12.6, mesh 5.1 (n 1,500; round 6 19.6 and 17.5). The rest of the mode is padel (see below). | Scale targets to the 6 m width. |
| 21 | Low | Serve faults 5.3-6.6%, double faults 0.7-0.9% (about 10 and 2). Level 0.5 is right: 9.0 and 2.7. | Two ranges, 2,040 each. | |
| 22 | Low | The net pair has a new floor at 2.10 m: p5/25/50 2.09/2.11/2.29 (n 31,298). Attack position about 3.8 m. | `q-move`. Third-shot depth and coaching advice, so soft data. | |
| 23 | Low | Smashes go down the line 54-61% by two measures, flat men 77.7. | `q14` n 2,689, `q-oh`. | |
| 24 | Low | Back-court volleys at the shins: 2.0% of shots from past 6 m, p50 0.75 m; 10.9% of bandeja replies volleyed, 69% of those under 0.7 m. | `old-r4p-backvol.txt`, `log-l1.txt`. | |
| 25 | Low | Split-steps 70 per 5 min, 7.7 in Priego 2013. Match top speed 4.80 m/s smoothed against 4.2 (Miralles 2025). | `log-l1.txt`, `q7`. | |
| 26† | Low | Serve-time places: no difference by side (right 62.8/11.3/25.9, left 60.7/12.6/26.7; published left 12% more to the glass); receiver on one spot, 8.60 m, 2.50 m; serves land short, 5.96 m (line 6.95). | `q-serve` n 2,812. | |
| 27 | Low | Net-to-net volleys go through the middle, rarely at the feet: feet 1.0%, body 3.3% (n 302). | `q3.mjs`, against two up. | |

**Faces and bodies.** The people read as game characters, well proportioned, with faces that are plainly the MakeHuman source. I rank that below
findings 1-4 and do not count it as new. Movement and the racket cost more realism than the faces do today.

### What holds up

- **The headline numbers.** 10.9 / 10.7 shots a point, 14.8 / 14.5 s (10-11, 13.5-14.8, Martín-Miguel 2024). W / FE / UE 35.9 / 28.4 / 35.7.
- **Rally shape.** Raw over 11 s is 48-50% against 26, but that is the mean: CV 0.81-0.85 against Courel's 0.76, and scaled to Courel's mean the shares read 28-30 / 23 / 20 / 27-28 against 26 / 26 / 22 / 26.
- **The serve.** 66.6 km/h, about 1,250 rpm, net clear 1.27 m, side glass 60, T 25-27, middle 12-15 (64.6 / 24.3 / 11.1). Server at the return 4.80 m (5.08), moved 3.04 m in 1.27 s (2.71 in 1.22).
- **The return.** Lobs 29-30% (34.7), flat ones 67.6 km/h, 1.22 m at the net, 76.6% at the server (71.9).
- **Third shot.** Struck from 3.84 m (3.84), 0.81 s after the return (0.86).
- **Attack changes** in 39.4% of points (37). Lobs 18.7% of shots, in 81% of points (76-81), apex 6.54 m. Contrapared 12.6% of points (11-13). Bajada 17% (14-17).
- **Overheads.** Tray-like 68.9, smash 31.1 of overheads in the air. Smash W 45.4-46.6 (45.1), UE 5.5-6.8 (5.9), median 132 km/h. By depth: 94% smash inside 4 m, 60% at 4-6 m, 1% at 6-8 m. Víbora 79 km/h against 70, 2,157 rpm against 1,299. Bandeja and víbora reach the back glass 75% of the time, at 0.65 m.
- **Direction.** Cross/line 56.5/43.5 (57.5/42.5, `r4p2-dir.ts`).
- **Who wins.** Serving pair 60.2 (62.5). Zones of hits 51/22/27 (49/19/26).
- **Ladder, AI v AI.** 1 v 0.5: 70.7. 1 v 0.75: 62.4. 0.75 v 0.5: 60.9. Styles are legible: Muro lobs 25%, W 1.7; Martillo smash 56% of overheads; Serpiente víbora 68%.
- **Narrow singles.** 11.8 shots, 15 s, 26% of hits at the net, serve 54.6%. It plays like padel, apart from #20.
- **Practice.** Lobs recovered: won 51.3 (37.5 at round 6). Back glass won 51.3.
- **Bodies.** Contact in front: ground 0.43-0.48 m (0.64), volleys 0.26-0.49 (0.38), bandeja 0.02 (-0.01), smash 0.41 (0.45), wall 0.54-0.56 (0.43). Chest: backhand 65, volley 37-57, bandeja 58. Racket to ball 1 cm p50, 2.5 p90, pops 12.75-15.5 a minute, knee spins 0. Bandeja elbow 42-66 by probe (54-65), hips 0.88 (0.87-0.92), free hand in the video's shape. Smash crouch 88/75 at -0.5 s (93/67 at -0.65) and a real jump. Low ground strokes lean 33-41°, pros in photos 34-54°.

### Not checked

- `tools/bot-play.mjs` in real Chrome, for all three modes; Practice and Knock-out through the menus in Chrome. The lock never came. Practice and the bot human were run headless instead, so the real keyboard path was not exercised this round.
- Real-Chrome captures. Poses are from the pane; lines and lighting were not judged.
- The own-smash moment on camera: none found in the first 700 s of seed 71.
- A human's timing. The 45 and 80 ms figures bracket it; no person played.

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **REPEAT R6 #12 and #10, raised from Medium; REGRESSION of R4 #12** | Slice 51.5 (4 of 6) with perfect timing at round 6, 58-61 (23 of 23) with 45 ms noise now. Round 6 expected its #1 fix to close it; it didn't. Serving pair's 1-2 shot points 68-76 at round 6, 53-64 now. Round 5 said "no one-key exploit". |
| 2 | **REPEAT R6 #16, raised from Medium** | Same rate, 1.2 per 100 points. The cause, the dodge's `coming`, is new. |
| 3 | **REPEAT R6 #14, R5 #14, raised from Medium** | Return winners 12.9 then, 11.0 now. The cause and the experiment are new. |
| 4 | **REPEAT R6 #5; REGRESSION on the racket head** | Chest and hand fixed, head 12 to 62° down. Blind rank Medium, raised, as said at the top. |
| 5 | **REGRESSION of R4 #2** | |
| 6 | **REGRESSION**, within R6 #2, R3 #16 | 6-9% of winners at round 6, 1-2.5 now. |
| 7 | **REPEAT R6 #21, R3 #25, R1 #9**, and R6 #2's cost | |
| 8 | **REPEAT R6 #19**, now on the other side of the figure | 49 then, 80 now, 60.6 wanted. |
| 9 | **REPEAT R6 #7, R1 #3** | |
| 10 | **REPEAT R6 #20; REGRESSION on errors** | |
| 11 | **REPEAT R6 #11, R5 #12**, better | 40-44 then, 45-46 now. |
| 12 | **REPEAT R6 #13, R5 #13** | |
| 13 | **REPEAT R6 #23** | |
| 14 | **REPEAT R6 #22, R5 #22** | |
| 15 | **NEW** as a body finding | R3 #14 was the víbora's pace. |
| 16† | **REPEAT R6 #1** | Its "Fixed" doesn't hold. |
| 17† | **REPEAT R6 #4, R5 #1, lowered to Medium** | Not in my blind draft. |
| 18† | **REPEAT R6 #18** | Not in my blind draft. |
| 19† | **REPEAT R6 #24, R4 #23** | Not in my blind draft. |
| 20† | **REPEAT R6 #15** | The ball leaves less and hits the wall more. |
| 21 | **REPEAT R4 #21, R1 #8** | Round 6 listed it under what holds. |
| 22 | **NEW**, a cost of R6 #6's fix | |
| 23 | **NEW** | |
| 24 | **REPEAT R6 #9, lowered to Low** | |
| 25 | **REPEAT R5 #26, #27** | |
| 26† | **REPEAT R6 #27, #28, #31** | |
| 27 | **NEW** | |

One finding is Critical and three are High, and two of the four carry a REGRESSION, so by the loop's rule it goes on.

### Round 6's statuses that don't hold

- **R6 #1 "Fixed. 31 per 100 points to about 3.5."** On the same probe it is 7.9 / 8.8 / 9.3 on three ranges of 1,500, one of them round 6's own 1701. Better, not Fixed, and over its target of 5.
- **R6 #4 "Better. 70.3% of replies to 18.8."** Those are two measures. 70.3 was against two back and is now 35.5. The all-replies figure was 44.9 and is now 21.9 (`r5p-smreply` 20.6). Better, by half what it says.
- **R6 #5 "Better."** Chest 37 and the hand hold. The racket head, one of the finding's three parts, got worse (12 to 62° down) and the row doesn't mention it. "Elbow 34-41" is a blend: 45 mid, 30-31 on low volleys, still at the stop.
- **R6 #2 "Better. Volley 14.4 to 23.7."** True as a count, not as the finding meant. The gain is drop volleys: 1.4 to 5.4% of points, while every other net volley fell from 4.1 to 3.1. Bandeja and víbora fell from 6-9% of winners to 1-2.5, unreported. Smash FE 10-14 (0.8).
- **R6 P #20 "11.9% of points".** Frequency holds, 12.6. Error rate went from 15.2 to 24.9, and after a smash from 18.9 to 43.7.
- **R6 P #24 "better with strokes on the run".** Barely: 76 to 70.4% under 0.1 m/s, third shot 0.57 to 0.69 m/s (1.98).

### Older statuses that don't hold

- **R4 #2 "Fixed", the drop volley.** 0.05 a point at W 31 is now 0.103 at W 52.1.
- **R5 #2 "Fixed", net volleys run backwards.** Winning held. Losing didn't: high balls lost 2.2 then, 6.2 now, more than mid ones.
- **R4 #12 "Better".** 53-64, below where it started.
- **R4 #6 "Fixed", singles.** Server wins 49.3 on the standard court against the 56.9 claimed; 54.6 on narrow.
- **R3 #3, lob 61-70% of net-takes.** Now 80-81, past 60.6 the other way.
- **R1 #3, walls.** 28.3 against 19.0.

### Statuses that hold

- **R6 #2** on endings: 35.9 / 28.4 / 35.7, better than claimed. Smash 52-55. Out of the court 6-7.
- **R6 #3 "Better":** 9.7-9.9% of points (11.2), still over 8. Swings at the air 1.1 per 100 points (1.0).
- **R6 #6 "Fixed":** nearer net player 2.10/2.68/4.00, stagger p50/p75 0.43/0.62, 64.5% of net volleys below the tape. Limit: #22.
- **R6 P #8 "better":** 1.1 per 100 points, against 11.7.
- **R6 P #7-25 and #26-34 "Open":** open as marked. #11 and #15 have eased, #34 is gone (14.5-14.8 s).
- **R5 #3 "Fixed":** lobs out 2.4% of points, inside its 1.5-2.7, up from 0.9 at round 6.
- **R4 #4:** bandeja replies volleyed 10.9%.
- **R4 #1:** cross/line 56.5/43.5, its own probe. **R4 #3:** serve 60 to the glass. **R4 #18:** víbora 79 against 70.
