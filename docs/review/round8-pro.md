# Round 8: the professional's review

Review of `phase9` at 8fd6459. I wrote it blind: every finding without a dagger (†) was measured before I opened `REVIEW.md` or any round 7
report. The draft is saved as `tools/out/r8p/draft-blind.md` (not tracked); findings 25-30 were in my working notes rather than that file. I then read
them and ran round 6's and round 7's own probes on today's code. Reading changed three things, and all three are marked below:

- **Two ranks went up from what round 7 gave.** Findings 2 and 3 were Mediums in round 7's table and are High here. Both were High candidates in my
  blind draft, and section 3 gives the reason for each. The strictly new High is finding 1.
- **Eight Mediums and Lows were added after reading** (8, 14, 15, 16, 18, 21, 23, 24). They are round 7 items I had numbers for but had not
  drafted as findings. They carry a dagger (†) and are not independent confirmation.
- **One blind finding was struck and one of round 7's turned out to be a bug in the measure.** See section 3 on left and right.

**The short version.** Nothing is Critical. Three Highs.

- **High, new:** a net player who is lobbed runs backwards with his chest to the net for the first 1.2 s of a 2 s retreat. It happens in most points
  and is the plainest wrong movement left in the game.
- **High, raised from round 7's Medium:** only a lob ever moves a net pair. The chiquita, the shot padel's net fight is built on, is volleyed at 0.75 m
  from 1.65 m off the net, with 0.2% errors.
- **High, raised from round 7's Medium:** women's matches. Smashes win 10% (women on tour about 30), points last 19.4 s (14.4-16.2), and they are a third of
  all matches.

Round 7's Critical (the slice key) and its High on the smash coming back are properly fixed. The men's game at the top level is very close to the
published figures on rally shape, endings, serve, return, third shot, overhead mix and smash. Most of what is left is the body and the net fight.

## 1. How I reviewed

**Headless runs.** All on today's code, on seeds no earlier round used.

| Run | Sample | Output in `tools/out/r8p/` |
|---|---|---|
| `tools/match-stats.ts` level 1, seeds 2501 and 2701 | 6,000 points each | `ms-l1-2501`, `ms-l1-2701` |
| same, level 0.5, seed 2501 | 6,000 | `ms-l05-2501` |
| same, women, seeds 6501 and 2701 | 4,020 and 6,000 | `ms-women`, `ms-women2` |
| Level matchups 1 v 0.75, 1 v 0.5, 0.75 v 0.5, 0.5 v 0, and rows at 0.75 and 0 | about 4,000 points each | `lv-*` |
| Styles against neutral, and head to head (`r4p2-h2h.ts`) | about 6,000 points a pair | `h-*`, `h2h-win.txt` |
| Every point dumped (`r5p-dump.ts`), queried with `r7p/q*.mjs`, `r6/q-*.mjs` and my `a1`-`a21.mjs` | level 1: 6,000; 0.5: 2,000; women 1,500; singles 1,500 and level 0.5 1,000; narrow 1,500; left-handers 1,500 | `d-*.ndjson` |
| Round 7's dumps put through the same queries, for like-for-like figures | 6,000 | `tools/out/r7p/d-l1*.ndjson` |
| Bot in the human's seat (`r7p/human2.ts`, noise 45 ms) | mixed at 0.55, 0.8, 1; each key alone at 1; singles | `human-*.txt` |
| Practice (`r5p-practice.ts`, bot and "does what the drill says") | 300 feeds a drill | `practice.txt`, `practice-follow.txt` |
| `tools/point-mix.ts` doubles and singles; `tools/anim-check.ts` 5 seeds x 120 s | | `mix-*.txt`, `anim-check-r8p.md` |
| Body: `r8-gs.ts`, `r8-vt.ts`, `r6-game.ts`, `r6/body.ts`, `r7p/oh-body.ts`, my `gs2`-`gs4.ts` (rotation through a stroke, the retreat) | 150 s x 5 seeds, the retreat on three ranges and two people | `gs*.txt`, `old-body.txt`, `oh-body.txt` |

**Old probes.** 15 re-run at round 8's seeds, all exit 0 (`old.status`): `r3p-nettake`, `r3p-ret`, `r3p-backvol`, `r3p-lobfollow`, `r4p-nettake`, `r4p-lobfollow`,
`r4p-oh`, `r4p-ret2`, `r4p-backvol`, `r4p2-handoff`, `r4p2-dir`, `r4p2-vh`, `r4p2-whiff`, `r4p2-giveup`, `r5p-smreply`. `r6/letgo.ts` and `r6/die2.ts` run too. `r6-volley.ts` still doesn't
exist. `r7p/q16-18` take a single JSON file, not a dump, so I skipped them. **`r7p/q10.mjs` line 20 has a bug: it takes the side of the court from
the team number, and teams change ends.** I made the same mistake in my first pass. Section 3 says what it cost round 7.

**Chrome.** The queue was slow but it moved. In real Chrome: `tools/bot-play.mjs` in doubles (seed 101, 16 hits of 16 swings), singles (102, 18 of 19) and narrow (103,
27 of 28), timing error p50 3-4 ms, no page errors; Practice Volleys and Knock-out through the app; 31 captures of seeds 104-106 (`r7p/cap.mjs`, round 3's
capture script adapted). While that job was queued I also took the same moments from the Browser pane with `?backend=webgl`, stepped by hand, and judged poses
and positions from those, no lines or lighting.

Captures are in `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r8-pro/`: `a*.png`, `b*.png`, `w*.png`, `m*.png` (real Chrome), and
the same names as `.jpg` plus `c-*.jpg` (pane). The sheets I viewed: `tools/out/r8p/sheet1.jpg`, `sheet2.jpg` (strokes, pane), and `sheet3.jpg` (the retreat), `sheet4.jpg` (women and modes, real Chrome),
`sheet5.jpg` (close-ups) in the scratchpad's parent folder. Five images viewed.

**Sources.** SMF is `docs/research/shots-movement-feel.md`, SSM is `docs/research/serve-and-strokes-motion.md`, pose figures are `docs/research/footage-pose.md`. Published figures are in
brackets. Level 1 and doubles unless stated. Two-range figures are written a / b.

## 2. Findings, ranked

Critical 0, High 3, Medium 15, Low 12.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **The lobbed net player backpedals with his chest to the net.** A pro reads the lob, drops a foot and turns: free hand at the ball, shoulder to the net, then runs or skips side-on and is already set for the overhead. Here he runs backwards square, racket upright in front of his chest, and turns only for the last half second. It is the commonest big movement in the game (lobs in 83% of points) and it happens right under the TV camera. | **Chest from square to the net, 0.2 / 0.4 / 0.6 / 0.8 / 1.0 / 1.2 / 1.4 / 1.6 s after the lob's strike, lobbed net players who ran back:** 13, 14, 14, 15, 23, 27, 54, 76° (n 55, p1, seeds 601-605); 15, 16, 17, 15, 22, 33, 52, 75 (n 66, p1, seeds 701-705); 11, 11, 14, 16, 16, 38, 62, 78 (n 49, p7, seeds 801-804). The overhead comes 1.92 / 2.05 / 2.36 s after the lob (p5/50/95). **Samples moving back over 2 m/s:** under 40° from square 67.5 / 64.5 / 70.6% (n 163 / 220 / 153), side-on 25-33%. **Capture** `sheet3.jpg`: seed 104, p0, bandeja at 28.99 s: frames at -1.6, -1.3, -1.0, -0.7 s all chest to the net. `w8-face.jpg` (-1.2 s): forearms crossed before a square chest. **Cause:** `avatar.ts:1571`: the side run needs the way of travel under `SIDE_RUN_MAX` = 1.35 quarter turns, so a retreat, near 2, plays the back clip. SSM line 331: "Turn side-on early, chassé the last 1-2 steps", and that "the game's movement model already runs back side-on". The sim does; the body doesn't. There is no padel measurement of turn against shuffle (same line), so the real-world half is coaching and photographs. The chassé is measured: 44% of bandejas (Espino 2015, SSM line 224). | With an overhead planned and the way of travel behind him, turn the hips within the first 0.3 s and run the side-run clip, free arm at the ball. A wider `SIDE_RUN_MAX` for that case needs no new clip. `gs4.ts` is the check: under 40° in under a quarter of samples. |
| 2 | High | **Only a lob ever moves a net pair, and the chiquita has no bite.** In padel the pair at the back has two ways back in: lob over, or a soft ball at the feet that forces a volley up, then walk in behind it. Here the second doesn't exist. The net pair volleys chiquitas from comfortable height, never errs, never gives ground, and the player who played it stays at the back. A pro would stop playing the shot inside one match. | **Shot that won the net:** lob 95.0%, chiquita 0.5, n 4,118 (`q13`). Round 7's dumps, same query: 91.8, n 4,087. Pros 60.6 / 39.4 (Muñoz 2017, `docs/ai.md`). `r4p-nettake`: 80.4% (n 928), `r3p-nettake` 79.3 (n 690), chiquita 0% of 811, slice 0% of 1,378, drive 1% of 1,357. **Net pair both still up two shots later:** chiquita 99.8, slice 99.9, drive 98.7, lob 64.4. **Chiquitas from the back at a net pair, n 3,122:** volleyed 97.5%, volley errors 0.2% in both seed ranges (drive 2.6, slice 1.3), winners 3.0, met 1.19 / 1.65 / 2.24 m from the net at 0.71-0.80 m, only 6.6-19% under 0.6 m when met inside 2 m. The net player moves in 0.24 / 0.65 / 1.06 m to meet it, with the ball 0.14-0.56 m over the tape. The hitter's pair is both up two shots later 6.0% of the time (after a lob 24.2). The chiquita hitter's pair wins 38.5% of those points, so the shot isn't bad, it just doesn't change anything. | In order. Net clearance and dip: a chiquita should cross close to the tape and be at or below it by the service-box T. Net pair standing further back (#4), so it lands in front of them. A pressure cost on a volley struck under the tape on the move. The hitter's pair walks in behind a chiquita that made the volley go up, as `lobFollow` does for lobs. Check against `q13` (60.6). |
| 3 | High | **Women's matches: overheads don't finish and points run long.** 35% of matches are women's (`cast.ts`). The character of the rally is right (lobs, volleys). But a tour player's smash ends a third of the time, and here one in ten. The volley takes over as the finisher and the point runs a third longer than it should. | **6,000 points, seed 2701 / 4,020, seed 6501:** 13.7 / 14.1 shots, **19.4 / 19.9 s** (14.4-16.2, about 12 shots). W / FE / UE 23.5 / 30.5 / 46.0 and 22.9 / 31.2 / 45.9 (main draw 30-36 / 28-32 / 35-37, Conde-Ripoll 2025). **Smash W 10.1% (n 2,001), 8.6% (n 1,383)**, dump d-w1 11.6% (n 441), 91 / 100 / 105 / 109 / 115 km/h; women on tour flat 33.3, topspin 29.2 (SMF lines 56-57). Last shot of winners: volley 63.4 / 66.4, smash 14.3 / 12.9 (round 7, 2,040 points: 41.2, 20.4). Winners bounce / back / out 84.2 / 5.1 / 1.2 and 86.6 / 3.8 / 1.0 (76.9 / 11.8 / 11.3); round 7 82.4 / 9.2 / 0.9. Serving pair 56.5 / 55.7 (48.5). The likely cause is `ai-skill.json` women `smashEffort` 0.73 and `smash` 0.64: 105 km/h, and in the dump 0.5% of smashes leave the court. I did not test a change. | Raise the women's smash until W reaches about 30 with back-over winners near 12, then re-measure UE and rally length. Correct the comment in `ai-skill.json`. |
| 4 | Medium | **The net pair stands too close.** The floor of the formation is where they live. | Pair's mean distance at the opponents' strike from over 5 m p5/25/50/75/95: 2.10 / 2.19 / 2.40 / 2.63 / 3.69 m (n 25,200). Nearer man 2.09 / 2.10 / 2.12 / 2.42 / 3.31. 70% under 2.5 m, same in both ranges. Level 0.5 stands at 3.09, nearer the right place than level 1. National 3.8, regional 4.5 (Ramón-Llin 2019, `docs/ai.md`). `formation.ts` `upDepth()` takes 0.7 off `UP_Z` 3.1 whenever the ball is low or after a wall, which is most of the time, and the stagger takes 0.3 more off the nearer man. Net volleys struck 1.59 / 2.04 / 2.68 m out. Caution: this is the price of round 6's fix (77% under the tape then, 60.5 now). Going back without anything else undoes it. | 2.7-3.0 m when the ball is at the back, closing only on a ball rising or short. Watch below-the-tape. |
| 5 | Medium | **Bandeja and víbora almost never finish, and the bandeja has one shape.** | 1.6% of winners (bandeja 0.9, víbora 0.7; 12.7, SMF). W 0.6 / 0.8 (3.5-7.2). FE 4.2 / 5.9, so they do press. Bandeja 64 / 68 / 71 / 73 / 77 km/h, 1.74-2.00 m at the net, landing 6.90-9.60 m, 1.6% within 1.5 m of the middle. Round 7 tried a short, wide one and it did worse. | Round 7's cause stands: the defender reads every bounce. A misread off the glass, pressure-scaled. |
| 6 | Medium | **Por tres and por cuatro are rare.** | Out of the court 6.9 / 6.6% of winners (17.4, Ramírez Ortega 2025), 2.9% of points (about 6.5). 98.3% smash. 5.9% of smashes. | As round 7. |
| 7 | Medium | **Too much comes off the glass, and half the errors do.** | 3.17 glass shots a point, 27.5% of shots (19, Mellado-Arbelo 2019). Last shot of errors: back wall 22.6-24.1, double wall 16, side wall 9.4 = 48% (pros: volley 30, groundstroke 30, lob 15; back wall 19 on golden points). Double wall E 14.6. | Fewer volleys to the corners; take more before the glass. |
| 8† | Medium | **Contrapared errors.** | E 26.1% (n 789; UE 4.7-7.7, Mellado-Arbelo 2019), after a smash 42.3%. Its frequency is right: 11.9-12.2% of points (11-13). | As round 7. |
| 9 | Medium | **The forehand's coil is late and shallow.** | Chest at -0.6 / -0.45 / -0.3 / -0.2 / -0.1 / 0 / +0.1 s: 6, 11, 42, 60, 73, 36, -3° (n 29, `gs2b`); `body.ts` 59 at -0.2, 4 at contact (n 16). Hips peak 36 at -0.1. Prep 531 ms off the wall (Espino, SSM line 304); tennis 106° shoulders, 83° hips at about -240 ms (SSM lines 142-143, an analogue only). So the turn comes about 150-250 ms later than those, shallower, and the shoulders are already unwinding at contact. Backhand is fine: chest -98 at -0.2. | Start the unit turn with the prep, about -0.5 s. |
| 10 | Medium | **The volley arm still snaps straight in the last tenth.** Round 7's fix took the racket head up; the arm's timing is what's left. | Mid forehand elbow 92, 117, 110, 113 at -0.3..-0.08, then 42 at contact (n 16, `gs3`); `body.ts` 63 at contact (n 6). Mid backhand 111, 116, 105, 104, then 30 (n 27); `body.ts` 45 (n 12). All forehand volleys 71, 89, 84, 84, 38 (n 50). Video stays 60-90, 63 at contact (13 volleys, clip 4). The two probes differ by 20°, and the snap is there on either. | Hold the elbow at 60-90 and punch from the shoulder. |
| 11 | Medium | **Víbora body against video.** | Elbow 88 (`body.ts` n 6, `r6-game` n 7), wrist 0.18 trunks; video 53, 0.6 (clip 3, small n). Contact 1.68 m is inside the notes' 1.55-1.85, so the height alone is no finding. | Straighten the arm into the ball. |
| 12 | Medium | **El Muro loses to everyone.** | 43.4 v Reloj, 46.0 v Martillo, 43.6 v Serpiente (about 6,000 points each, ±1.3), matches 49, 42, 46. Martillo 49.8, Serpiente 50.5 v Reloj, Martillo v Serpiente 47.7. | As round 7. |
| 13 | Medium | **Practice: "Side glass" still isn't, and the shots that decide points have no drill.** | Doing what the drill says, 300 feeds: 8.9% side-wall, 54.2 double wall, 23.2 back wall, 36.6 untouched, feed 73 km/h, 75.3 reaches the back glass. Round 7: 4.3, 64, 45 untouched. Better, not there. Back glass 77.5% back-wall, Lobs 86.4 bandeja, both teach the shot; Volleys 69.2 volley, 28.2 untouched. **No drill** for the return, chiquita, bajada or the move to the net. | Slower, shorter feed; a chiquita drill would teach what #2 needs. |
| 14† | Medium | **Level 0.5: the wrong errors.** | 6,000 points: W 18.5, FE 21.6, UE 60.0 (qualifiers W 33-40, UE 37-38, Conde-Ripoll 2025). Smash W 41.6, double faults 5.1. Rally shape right: 7.6 shots, 23.5 / 25.5 / 22.2 / 28.8. | As round 7. |
| 15† | Medium | **A quarter of smashes against two back are answered on the rise.** | 25.3% of replies (n 1,085, 0.38 / 0.44 / 0.57 s after the strike; under 15 wanted). All replies 16.1 (n 1,708). Round 7 33.6 and 21.9. Better. | As round 7. |
| 16† | Medium | **Almost everything is struck from a standstill.** | Hitter under 0.1 m/s 67.7% (70.4). Third shot by the server 0 / 0.76 / 1.37 m/s (1.98, Ramón-Llin 2021). | Let approach shots and volleys be struck moving. |
| 17 | Medium | **Narrow singles: the ball still ends on the wall.** | n 1,500: 21.6% on the full, 12.4 off the court (out 10.3), mesh 5.9. The rest is padel: 12.2 shots, 15.2 s, serve 58, volleys 25%. | Scale targets to the 6 m width. |
| 18† | Medium | **Net players still let reachable balls past.** | `letgo.ts` seeds 2501: 92 of 1,500, 6.1 per 100 points (7.9-9.3 at round 7; target 5). | Same family as round 7's hand-off, which already moved it. |
| 19 | Low | Distance a point: server 21.3, partner 20.1 m (10.7 / 7.5 on shorter rallies, Ramón-Llin 2013). In points under 10 s: 11.4 / 10.6. So the server's right and the partner moves 40% too much. | `q-move`, `a` queries, n 6,000. | |
| 20 | Low | First serve 59 / 65 / 72 km/h against 69.95 ± 6.62 for open amateurs (Sánchez-Pay 2023). Inside one SD. | `q-serve` n 5,531. | |
| 21† | Low | Smash direction: down the line 55, from the middle 22.9, cross 17.5 (77.7 line of flat men). Round 7's #23. | n 3,200. | |
| 22 | Low | Volleys of lobs from the back court at knee height: 0.33 a point, y 0.16 / 0.44 / 0.81 / 1.31 / 1.53, E 10.9, 39.8% after a lob. | n 1,960. Round 7's #24. | |
| 23† | Low | Tracker-style 0.5 s peak speed 16.7 / 17.0 / 17.3 / 17.8 / 18.3 km/h a match (WPT 15.2). Above 15 km/h only 1.9% of the time. | Round 7's #25. | |
| 24† | Low | Serve-time places don't differ by side: glass 62.4 / 62.5 (published left 12% more). | `q-serve`. Round 7's #26. | |
| 25 | Low | Frame-shot speed outliers: smash up to 216 km/h, contrapared 170, víbora 140. | 25 of 3,200 smashes over 150. | Clamp. |
| 26 | Low | Volley forehand share 57-58% (44, WPT 2014). The middle goes to the forehand; left court 75.6, right 39.2. | n 6,915. | |
| 27 | Low | Low volleys stoop instead of sitting: under 0.6 m trunk 43°, hips 0.72 m; 0.6-0.95 m trunk 32, hips 0.81. No video figure at that height. | `gs4` n 37. | |
| 28 | Low | Backhand feet stay open: stance line -31° with the chest at -98. | `gs2b` n 18. | |
| 29 | Low | The serving pair keeps too much in long points: 54.0 / 53.7% at 9+ shots (42, national). | n 6,000. | |
| 30 | Low | Knock-out has a cliff: the bot took 5 of 5 at Club, 1 of 7 at Advanced, 0 of 8 at Pro. | 55.0 / 45.8 / 41.8% of points. A bot isn't a person. | |

**Faces and bodies.** From stroke-distance frames (`sheet1.jpg`-`sheet5.jpg`) they read as well-made game characters: good proportions, a real range of builds, kit and skirts that look right. Hair reads as a
shape, not as hair. Faces at that distance are plausible and plain. They are not people yet, and that is the known source limit, so I don't count it as new. I took no new face close-up; the critic
has those. The owner names four things, faces, bodies, how they move, hair and kit. In play I would put how they move first: #1, then #9 and #10. It costs more realism than the faces do from the
game camera, and it can be fixed now, without MetaHuman.

### The body, stroke by stroke

Game today against video. Sources are `body.ts` (seeds 171-175) and `gs` probes; n small where shown.

| Stroke | Measure | Video | Game | Verdict |
|---|---|---|---|---|
| Serve | Elbow, trunk | 13-21, 33-41 | 30, 27 | Right in kind; struck at 0.70 m, chest 47° |
| Forehand | Chest through the stroke | | #9 | Contact 0.52-0.59 m in front (0.64) |
| Backhand | Chest, elbow | side-on, 18-37 | -79 at contact, 30 | Holds |
| Forehand volley | Elbow, lean | 63, head up | 42-63, -31 mid | Lean fixed; timing #10 |
| Backhand volley | Elbow | 54 | 30-45 | Short of it, head level |
| Bandeja | Elbow, hips, chest | 54-65, 0.87-0.92 | 57 (n 16), 0.87, 58 | Holds |
| Víbora | Elbow, wrist | 53, 0.6 | 88, 0.18 | #11 |
| Smash | Elbow, legs, chest | 139 to 53, 27 / 23 | 112 to 32, 68 / 2 (airborne), 4 | Bent less at the start; contact 0.38 m in front (0.45) |
| Off the glass | Chest | side-on | 47 FH, 82 BH | Holds |
| Volley feet | Stance | Open step, ball-side foot (Chao 2008) | 10 / -28°, 0.80 / 0.94 m | Holds. My blind "feet square" was wrong |

`anim-check` 5 seeds: racket to ball p50 0.7-1.1 cm, p90 1.4-2.7, lag 0-8 ms, legs through 1.8-2.5%, skate 21.6-23.5 cm/s, pops 12.9-21.8 a minute. On seed 2, pops went 124 to 155 from round 7's run. The critic owns
those figures.

### What holds up

- **Headline numbers.** 11.3 / 11.4 shots a point, 15.1 / 15.3 s, 0.75 shots/s (10-11, 13.5-14.8, 0.80). A little long, as it has been. W / FE / UE 37.8 / 26.4 / 35.8 and 37.3 / 26.3 / 36.4 (34-42 / 29-33 / 29-33).
- **Rally shape.** CV 0.78 against Courel's 0.76. Rescaled to his mean: 27.9 / 23.3 / 20.8 / 28.0 against 26 / 26 / 22 / 26.
- **How points end.** Winners by bounce / back / out 48.2 / 40.1 / 6.9, body 4.8 (48 / 35 / 17). Errors net 54, back 16, side 15-16 (51 / 28 / 17). Smash 53-55% of winners (43), volley 32-34 (28). Smash W 46.7 (45), UE 4.4 (6). Volley W 3.9 (3.4-5.7).
- **Serve.** Lanes 60-62 / 26-27 / 11-13 (64.6 / 24.3 / 11.1). Net clear 1.27 m, about 1,250 rpm. Faults 7.2-7.4, double 1.8 (about 10, 2.1). Serving pair 61.2 (62).
- **Return.** Flat 69.9, lob 30.1 (34.7 lobs). Flat to the server's half 67.8 (71.9). Return errors 3.5. Left-court returns backhand 77.4 (over 75).
- **Third shot.** Server 3.80 m from the net, 0.79 s after the return (3.84, 0.86).
- **Overhead mix.** In points: bandeja 41.9, víbora 28.0, smash 38.4, bajada 18.2 (44-48, 20-23, 37-41, 14-17). Bandeja 71, víbora 79, smash 132 km/h. Smash 94-96% from 3-5 m.
- **Lobs.** 18.4% of shots, in 83% of points (76-81), apex 6.56 m, landing 8.25 m.
- **Left and right.** Left court ends 40.2% of its endings as winners, right 35.2 (41.8 / 34.1, Conde-Ripoll 2025). Volley forehand 75.6 left, 39.2 right.
- **Positions.** Zones of hits 48.6 / 22.5 / 28.9 (49 / 19 / 26). Attack changes in 41% of points (37). Both up 39, both back 47.5, split 13.
- **Ladder.** 1 v 0.75: 61.4. 1 v 0.5: 71.5. 0.75 v 0.5: 61.7. 0.5 v 0: 67.4. Shots 5.5, 7.6, 9.2, 11.3 at 0, 0.5, 0.75, 1.
- **Styles.** Plain to see: lobs of Muro 25.7%, smash of overheads Martillo 53.2, víbora Serpiente 66.3.
- **No one-key exploit.** Level 1, each key alone, 45 ms noise: drive 45.4, lob 45.8, slice 45.1, volley 44.6, topspin 32.3, drop 33.4 (±3.8). Mixed bot 55.0 / 45.8 / 41.8 at 0.55 / 0.8 / 1.
- **Human pair's formation.** Both up 40.5%, both back 53.5.
- **Standard singles.** 5.5 shots, 8.6 s, server 52.3. Short, but it isn't broken any more. Narrow is the better mode.
- **Contact in front.** Serve 0.50 (0.52), ground 0.56-0.59 (0.64), volley 0.27 (0.38), bandeja 0 (-0.01), smash 0.39 (0.45), lob 0.56 (0.65).

### Not ranked

Play outside the court (stretch goal, R1 #9). The feint smash: no such shot.

### Not checked

- No person played. Human figures are the bot at 45 ms noise.
- Real-Chrome frames of the retreat itself. `sheet3.jpg` is the pane; the real-Chrome plan's b04 and b05 followed the lobber, not the man running back. The numbers are headless. I judged pose only.
- The own-smash moment on camera.
- Round 7's Lows #22 at the two-up measure (#27, feet from net-to-net volleys) and split-step counts (#25): not re-measured.
- Women's bodies by the numbers: only `gs-p7` and the retreat. Face close-ups: none taken.
- Left-handers: the dump ran (`d-lefty`, 1,500 points), and I did not go through it stroke by stroke.

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **NEW** | No review has it. `OPEN_QUESTIONS.md` lists a backpedal clip as a wish, without a finding. Blind High. |
| 2 | **REPEAT R7 #8, R6 #19; raised from Medium** | Lob 91.8 to 95.0 on the same query. Blind High. What moved me: the pair stays up 99.8% after a chiquita and its volleys err 0.2%. Round 7 had "success 0%" but not why. In the terms of the rank, a pro sees it inside a match. If the verifier reads it as right in kind, that is the case for Medium. |
| 3 | **REPEAT R7 #13, R6 #23, R5 #5; raised from Medium** | Overall not a regression: W rose 21.4 to 23.5, rally within noise. Volley took over from the smash as the finisher (41 to 63% of winners) and back-over winners fell 9.2 to 5.1 (about 2.8 SE). Blind High on smash W, which no earlier round measured. |
| 4 | **REPEAT R7 #22, raised from Low** | It is a cause of #2, and level 0.5 stands better than level 1. |
| 5 | REPEAT R7 #6 | |
| 6 | REPEAT R7 #7 | |
| 7 | REPEAT R7 #9, R1 #3 | "Half the errors" is new. |
| 8† | REPEAT R7 #10 | |
| 9 | **NEW** | |
| 10 | **REPEAT R7 #4, C2** | What's left of them. |
| 11 | REPEAT R7 #15 | |
| 12 | REPEAT R7 #11 | |
| 13 | REPEAT R7 #12, better; no-drill part NEW | |
| 14† | REPEAT R7 #14 | |
| 15† | REPEAT R7 #17 | Better. |
| 16† | REPEAT R7 #19 | |
| 17 | REPEAT R7 #20 | |
| 18† | REPEAT R7 #16 | Better. |
| 19 | REPEAT R4's distance note | |
| 20 | NEW | Round 7 listed the pace under what holds; I rank it Low. |
| 21†, 22, 23†, 24† | REPEAT R7 #23, #24, #25, #26 | |
| 25-29 | NEW | |
| 30 | REPEAT R5's note | |

Strictly NEW at High: one, #1. By the loop's rule the loop goes on.

### Round 7's statuses

| Row | Claimed | Holds? | Number today |
|---|---|---|---|
| #1 Slice key | Fixed | **Yes** | Slice alone 45.1% (n 667, ±3.8), 0 of 4, level with drive 45.4. AI v AI: slice returns W 1.3% (n 1,766). Receivers win 0.6% of points inside 2 shots (2.4-3.2) |
| #2 Smash comes back | Fixed | **Yes** | 4 of 6,000 (74 on round 7's dumps, same query) |
| #3 Singles server | Fixed | **Yes** | Receivers 6.0% (90 of 1,500), server 52.3. Slice returns still W 20.7 (n 392) in that mode |
| #4 Forehand volley | Fixed | **Part** | Lean -31 mid, -32 low, backhand -1: holds. Mid forehand elbow 63 (n 6) on its tool, 42 (n 16) on the series. **Mid backhand "54 (54)": 45 (n 12), 30 (n 27).** Arm still closes 50-70° in the last 80 ms. Better |
| P5 Sitters | Better | **Yes** | Volley W 3.9. Plain net volleys W 1.6 (1.2). 0.95 m and up W 8.6, lost 7.2 (7.3, 6.9 on round 7's dumps). Drop 0.123 a point, W 54.2 |
| P6, P7 | Open | Yes | 1.6%; 6.9 / 6.6 |
| #18 "There is no left and right" | Open | **No: it was a bug** | `q10.mjs` took the side from the team number, which flips at a change of ends. On round 7's own dumps, with the true side: left-court returns backhand 76.9 (52.8 claimed), volley forehand 78.8 left, 28.2 right. Closed |
| #8 Fight for the net, Open | "91.8" | Worse | 95.0 |
| #21 Serve faults, Open | 5.3-6.6, 0.7-0.9 | Better | 7.2-7.4, 1.8 (double faults at level 0.5 now 5.1, high). Close at level 1 |
| Round 7's other Mediums | Open | Yes | All still open. Its #16 and #17 are better; #15, #19, #20 moved a little |

### Older statuses that don't hold

- **R5 #5 "winners 73 / 17 / 4".** 84.2 / 5.1 / 1.2 on 6,000 points, and it was already 82.4 / 9.2 / 0.9 at round 7. The comment in `data/ai-skill.json` still says it.
- **`docs/ai.md` net depth 3.1 at level 1, and R6 #6's reading of it.** Real mean 2.40, nearer man 2.12.
- **`footage-pose.md` volley row "116, 90, 82, then 57".** 92-117 then 42 mid forehand (n 16). The row is a game figure, not a review status, but round 7's #4 leans on it.
- **R5 #3 "1.5-2.7% of points".** Lobs out 3.0% (183 of 6,000, ±0.4). Just over.
- **R4 #2 "Fixed", drop volley.** 0.123 a point at W 54.2. Round 7 said the drop wasn't cut; it has gone up since (0.103).
- **R1 #3, walls.** 27.5 against 19.

### Statuses that hold

- **R6 #1 "Better".** 6.1 per 100, improving. **R6 #3 "Better".** 8.5% (127 of 1,500), target 8. **R6 #4.** 16.1 all replies, 25.3 against two back.
- **R6 #6.** 60.5% below the tape. Limit: #4 here.
- **R4 #1.** Cross / line 59.1 / 40.9 (57.5 / 42.5), `r4p2-dir`. **R4 #3.** 60-62 to the glass. **R4 #18.** Víbora 79 against 71.
