# Review round 9: the professional player

I wrote this blind. I measured the game and fixed a ranked draft (`tools/out/r9p/draft-blind.md`, saved at 05:06) before I opened
REVIEW.md or any round 8 report. Only then did I mark each finding NEW, REPEAT or REGRESSION. No code or data changed for this
review, and this report is the only tracked change. Don't look for a commit from me.

**The short version.** Nothing is Critical. This is padel in kind: the rhythm, the winners-to-errors split, the overhead game, the
lobs and the serve's places all sit on published figures. Two findings are High, and neither is in any earlier report as such.

1. **Players strike with their back to the net.** A contrapared plan left over from an earlier ball reaches the body on ordinary
   shots: 2.0% of all hits in a browser match, serves included. It is a bug, it was on screen 20 times in that match, and it is
   the first thing to fix under the owner's "how they move".
2. **The last change gave points away off the glass.** `READ_ERR` (230adaa) went in after round 8's reviews had run, so nobody has
   reviewed it. On the same seeds at 6000 points, back-glass unforced errors rose from 8.9 to 10.7, and the double-bounce winners a
   defender watches rose from 8.3 to 12.9%. It bought real things too (section 2, #2), but it is blind to how hard the ball is: a
   slow plain ball off the back glass is lost 5.8% of the time, seven times a groundstroke.

Measured on `phase9` at 57fb7e1, level 1 unless I say otherwise.

## 1. How I reviewed

- **Code:** branch phase9 at 57fb7e1. HEAD didn't move. I also ran a sim-only tree of 8fd6459 (the commit round 8's reviewers
  really ran) out of `git archive`, to compare old and new on the same seeds.
- **Sides:** ends change, so every "left court" or "right court" below is taken from the contact's z, not the team number. That
  mistake made an earlier "serve places don't differ by side".
- **Sample sizes:** given per figure. Any old-against-new difference I rank on is 6000 points on the same seeds, or a probe's own
  run stated next to it.
- **Played by a person:** nobody. This is AI play, a scripted human in Node, and frames. See "Not checked" at the end.

All scratch is in `tools/out/r9p/` (gitignored).

| Tool | Run | Output |
|---|---|---|
| `tools/match-stats.ts` | Level 1, 6000 points, seeds 3701, 3901. 8fd6459: 6000 points, seed 3701 | `l1-6000-3701.txt`, `l1-6000-3901.txt`, `old8-3701.txt` |
| match-stats, other | Level 0.5, singles (1, 0.5), women, `--pressure` 6000 points seed 5101 | `l05-3701.txt`, `s1a.txt`, `s1b.txt`, `s05b.txt`, `women.txt`, `pressure.txt` |
| match-stats, head to head | Levels 1 v .75, 1 v .5, .5 v 0; every pair of the four styles, 3000 points each | `lv-*.txt`, `sty-*.txt` |
| `r5p-dump.ts` + my `q.py`, `q2`-`q5`, `h2h.py` (every shot of every point) | 6000 + 6000 level 1, 3000 level 0.5, 2500 singles, 2500 narrow, nine 3000-point head-to-heads | `d-*.ndjson`, `h-*.ndjson` |
| `r6/die2.ts`, `r6/letgo.ts` | 2500 points each, old and new, seeds 3701, 3901 | `die-*.txt`, `letgo-*.txt` |
| `body.ts` (new: chest, hips, contact, feet, racket-face speed through the ball, per stroke class) | p1 and p7, up to 8 seeds x 180 s | `body-p1.txt`, `body2-p1.txt`, `body3-p1.txt`, `body-p7.txt` |
| `svfam.ts`, `cfam.ts`, `rk.ts` (new: which stroke family the avatar draws against what the sim strikes) | Seeds 131-138, 201-212 | console |
| `r8-gs.ts`, `r8p/gs3.ts`, `r8p/gs4.ts`, `r6-game.ts`, `r8c-lean.ts`, `tools/anim-check.ts` | p1 and p7; anim-check 3 seeds x 120 s | `gs-p1.txt`, `gs4-*.txt`, `r6game-p1.txt`, `lean-p1.txt`, `anim-check.txt` |
| `r5p-human.ts`, `practice.ts` (r5p-practice, apex counted to the first touch), `point-mix` | Knock-out ladder, drills, doubles and singles | `human.txt`, `prac-*.txt`, `mix-*.txt` |
| Old probes re-run, all exit 0 | r3p-ret, -ret2, -backvol, -lobfollow, -nettake, -oh, -oh2; r4p-ret2, -backvol, -lobfollow, -nettake, -oh, -ohctx, -dist; r4p2-dir | `old/` |
| Real Chrome, `cap.mjs` through `one-chrome.sh` | Seed 131, 10 of 16 frames found in its 120 s window. A second run and `bot-play` never got the lock | `cap1.txt` |
| Browser pane, `?backend=webgl`, whole match seed 133 and stale-frame capture | 991 hits, 144 serves | `pane.js` |

`r6-volley.ts` no longer exists. `r3p-cap` was adapted as `cap.mjs`.

Captures are in `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r9-pro/`:
`sheet-stale1.jpg` (a chiquita, spun round, seed 133 at 69.54 s), `sheet-stale2.jpg` (a serve struck backwards, seed 133 at 1763.17 s),
`sheet-oh.jpg` (víbora, bandeja, smash, seed 137), `sheet-gs.jpg` (volleys and drives, seed 139), `sheet-real1.jpg` (real Chrome, seed
131). Pane frames were used for the pose only, not for lines or light. Sim-jump stale banners are set aside, as asked.

## 2. Findings, ranked

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Strokes and serves drawn with the back to the net.** An AI's `standPlan` stays valid with `contra` true across the point break and when the shot changes. `avatar.ts:1522` hands that to `pickFamily` and `:1568` keeps it, so the body plays a contrapared the sim isn't playing. | Browser, seed 133, whole match: 20 of 991 hits (2.0%), 4 of 144 serves (2.8%); first 480 s, 6 of 228. Node, seeds 201-212: 27 hits of 1294 drawn this way with no glass (lob 11, drive 6, slice 3, serve 3, chiquita 2, volley 2) against 16 true contrapareds. Seeds 131-138: 3 of 132 serves. Chest at contact 140-176 degrees from the net (drive 155, n 5; lob 162-176, n 15; slice 140, n 3; serve 165, n 3); 90 is side-on. The family flips backhand-chiquita to forehand-contra at the last moment and the chest turns about 250 degrees in 0.2 s (`sheet-stale1.jpg`). A real player never does either. | Clear the plan at the point's start. Take `contra` from what the sim strikes (`p.contra` at the release or shot key), not the plan. Add a test: no family but serve on a serve, chest under 90 unless the sim calls it a contrapared. |
| 2 | High | **The glass misread gives points away, whatever the ball.** `simpleAi.ts:222` draws `READ_ERR` 0.4 x (2 - level) for every ball; `:1248` has no pace, corner or spin in it. Glass is the sport's defining skill, and easy balls off it are where the best AI is now weakest. | 8fd6459 to today, same seed 3701, 6000 points (seed 3901 in brackets): back-wall UE 8.9 to 10.7 (11.6), pros 5.4-6.3. Double-wall 14.9 to 18.6 (19.1), pros 0-14. Side-wall 7.0 to 8.2 (7.5), pros 6.8-8.4. Glass strokes as last shot of errors 48.0 to 52.6 (53.4); derived from Mellado-Arbelo 2019 about 19 of unforced errors. Groundstroke as last shot of errors 12.3 (11.3), pros 30. Easy balls (pressure under 0.5, 6000 points): back-wall error 5.8% (n 5977), side 3.6, groundstroke 0.8, volley 0.5. 71% of lost back-wall balls go into the net (1137 of 1609). Double-bounce winners off a non-smash, non-drop (`die2`, 2500 points each): 8.3 / 8.1% to 12.9 / 12.7% (207, 202 to 322, 318); "plan off the wall" 60 / 75 to 180 / 196; "in time at first bounce" 51 / 56 to 159 / 173. Winners that bounce twice 49.1 to 53.4 (48), same seeds, 6000 points. In 6000 points, 762 such winners, 379 of them 56 km/h volleys through the glass. | Scale the misread by difficulty: pace into the glass, corners, side spin. None on a slow plain back-glass ball. Keep it on fast bandejas, víboras and corners, where the gain below came from. Then look at the volleys through the glass, which are what a pair would aim. |
| 3 | Medium | **Defenders stand on one line, and only a lob moves a net pair.** Verifier's ruling from round 8 applied: the net-take measure hasn't moved, and a cause doesn't raise a rank. | At the opponents' strike 79.1% of back-court snapshots are at 7.75-8.25 m (p10/50/90 7.64 / 7.99 / 8.02; 7.5 m bin 5.4%, 7 m 3.2%). After a low ball forces a volley under 0.75 m the nearest defender is at 7.93 at the volley and 7.99 at their next strike; one inside 5.2 m in 0.6-0.9% (slice n 4354, drive n 3025), 13.5% (chiquita n 2884). Net takes off a lob: 79.5% (r4p-nettake, n 816), 81.0 (r3p, n 844), 98.1 by my stricter query (n 2473); real 60.6 (Muñoz 2017). Takes by a slice 1% of 1305, drive 1% of 1225, chiquita 1% of 747. Chiquita volleyed 5633 times: E 0.43%, W 4.38, net pair still both up two shots later 57.1 (my threshold; 99.8 by round 8's query). Drop volleys 0.107 a point, W 52.8, 5.0% of points, landing 6.44 m from a defender at 8.0. | A low ball that forces a volley under the tape is the signal for the far pair to come forward, one step at least, and the formation's back depth should follow the ball and their shot. |
| 4 | Medium | **Overhead swings peak after the ball has gone.** | Face speed m/s at -0.04 / 0 / +0.04 / +0.08 s: smash 10.5-11.2 / 10.8-10.9 / 17.0-17.4 / 16.9-18.6 (n 23, 67, 34 p7); bandeja 5.1 / 10.4 / 12.4-13.7 / 8 (n 37, 107, 51); víbora 6.6-7.4 / 9.5-9.8 / 11.3-12.8 / 8. The ball leaves at 36 m/s, which needs about 23 m/s at the face. Tennis serve peaks 2-3 ms before impact (Landlinger 2010). Drives are flat, 9.5 / 8.7 / 8.5. Shows in slow replays. | Move the contact later in the keyed swing, so the fastest frames are the ones before the ball. |
| 5 | Medium | **Weight behind the feet at contact.** | Hips against the feet's midpoint, towards the net: FH drive -0.09 m (p7 -0.06), FH slice -0.11 (-0.09), FH lob -0.06 (-0.09), FH chiquita -0.12, FH volley -0.08 (-0.07), BH drive -0.05 (-0.04). FH hips go from +0.15 at -0.12 s back to +0.06 at contact (n 49, 52). No video figure: this is the coaching principle, weight through the ball. | Key the hips forward of the feet through contact on forehands. |
| 6 | Medium | **Too much comes off the side glass.** | 53% of returns (3458 of 6480). 60.6% of 12000 points have a return off some glass. Side-wall 8.0-8.3% of shots (men 2.7, national 5.7). All glass 26.7% of shots, 2.74 a point (19, Mellado-Arbelo). | Take more returns before the glass, and cut the side-first plans; the error half is #2. |
| 7 | Medium | **Bandeja and víbora still finish half as often as they should.** Better, thanks to #2. | 1.7 to 5.8-6.6% of winners (12.7), 6000 points two seeds. | Keep when #2 is fixed; re-measure. |
| 8 | Medium | **Por tres and por cuatro are rare.** | Out of the court 5.7-5.9% of winners (17.4); women 2.4 (11.3); 2.66% of points (about 6.5). Exits 6% of smashes (279 of 4610; paths side-back 196, back 48). Smash at first glass height 0.43 / 0.99 / 1.52 m. | More high kicks: the smash at the back glass needs height, or the wall's rebound more speed. |
| 9 | Medium | **The net pair stands too close.** | 2.09 / 2.37 / 4.65 m at the opponents' strike from the back (3.84 national at the third shot; research 3.5-4.5). Level 0.5: 3.09. Replies under the tape 56.8% (60.5). | The setting is 3.1 m and the floor of the formation is where they live: move the floor. |
| 10 | Medium | **El Muro loses to everyone.** | 43.6 v Reloj, 45.7 v Martillo, 42.5 v Serpiente (n 3000, ±1.8); holds about 63 / 90, 67 / 85, 61 / 92, despite level +0.08. Worth about 0.35 of level. The others are level: Martillo 49.4, Serpiente 49.6 v Reloj, Martillo v Serpiente 48.5. | Same defect as #3: a pair that stays back with no way forward. Fix that, then re-measure. |
| 11 | Medium | **Women's serving pair wins too much.** Overheads are fixed; this isn't. | 59.7% (6000, seed 3901) against 48.5 published; holds about 72 against about 46. | Women's first-serve speed and return depth, not smash. |
| 12 | Medium | **Víbora body against video, worse on tall people.** | p1 elbow 97-104, wrist 0.11-0.15 (n 25); p7 57, 0.46 (n 12); video 53, 0.6. Overhead heights in the sim are fixed whoever plays, 1.69 m contact, so a tall body folds. | Scale overhead contact and keys to stature. |
| 13 | Medium | **Contrapared errors.** | E 29.7% (n 1323; R8 26.1); UE 4.7-7.7 published; in 10.2% of points (right). | The take is right; the choice to play it into a smash isn't. |
| 14 | Medium | **Return through the middle left to bounce twice.** | 84 of 12000 (0.7%). Serving pair at 1-2 shots 77.7-79.1 against 98 (national). Server 1.2 m away at 5 m, 70 km/h; then the back glass; whiff 6%. | A server who hasn't been told it's his ball: the taker rule on a return through the middle. |
| 15 | Medium | **Standard singles ends on walls and double bounces.** | 5.38 shots, 8.43 s, server 53.0. Double-wall 29.1 + contrapared 14.5 = 43.6% of errors. Double-bounce 53.8% of endings, winners off glass 37%. | The same misread as #2, and a lone player has no partner to cover it. Re-measure after #2. |
| 16 | Medium | **Narrow singles still ends on the wall.** | 2500 points: wall on the full 19.6%, out 10.6, own mesh 4.8. 10.75 shots, 13.5 s, server 58.6. | As R8. |
| 17 | Medium | **Practice: Side glass isn't, and the deciding shots have no drill.** | Side glass first shots 58.6% double wall, 6.9% side wall, 42% untouched, 73.5% reach the back glass. Volleys 60.8% volleys. Back glass 84.2% back-wall, Lobs 85.7% good bandejas: those two are right. No drill for the return, chiquita, bajada or the move to the net. | Feed nearer the side glass. Add the four drills. |
| 18 | Medium | **Level 0.5 errors, better but not right.** | W / FE / UE 23.2 / 22.9 / 53.9 (R8 18.5 / 21.6 / 60; qualifiers W 33-40, UE 37-38). 6.8 shots (7.3). Volley UE 14.4, back-wall 24.4, double-wall 33.3. | #2 costs most here, because the misread doubles at level 0 and weighs 1.5x at 0.5. |
| 19 | Medium | **Smash against two back is answered before the glass.** Better. | 21.8% of replies (n 1799; R8 25.3; under 15 wanted). | Back pair stands too deep and flat to step in; let the ball through. |
| 20 | Medium | **Too much is struck from a standstill.** Better. | Hitter under 0.1 m/s 58.5% (R8 67.7). Third shot by the server 0 / 0.81 / 1.51 m/s. | Keep going. |
| 21 | Medium | **The forehand's coil is late and shallow.** Better. | Chest at -0.3 / -0.2 / -0.12 / 0 s: 60 / 88 / 87 / 38 (R8 42 / 60 / 73 / 36). | Start the turn earlier. |
| 22 | Medium | **Net players let reachable balls past.** Better. | `letgo`: 139 after a bounce in 2500 points, 5.6 per 100 (155, 6.2 on 8fd6459; R8 6.1). | As R8. |
| 23 | Low | Forehand volley's racket head sits -30 degrees at every height from 0.4 to 1.2 m (backhand -1). Video: racket level. | `rk.ts`, n in `gs4`. | Key by height. |
| 24 | Low | Bandeja chest falls from 59 to 7 by +0.2 s: a real bandeja stays side-on longer. | `body3-p1.txt`. | |
| 25 | Low | Net exchanges 0.53 s apart (derived .22-.27 on assumed speeds), speeds 40-65 km/h. | `q.py net`. The real figure is assumed, so it's Low. | |
| 26 | Low | Martillo doesn't hit harder: drive 60 v 62, smash 129 v 129 (Muro's drive 67). | h2h, n 3000. | |
| 27 | Low | "Other" errors 14% (3): out 9.6, mesh 3.2. | Both 6000-point runs. | |
| 28 | Low | Knock-out has a cliff: scripted human 53.9 / 51.0 / 41.7% of points, matches 4 of 7, 4 of 5, 0 of 8. | `human.txt`. | |
| 29 | Low | Frame-shot outliers: 40 of 4610 smashes over 150 km/h. | Dumps. | Clamp. |
| 30 | Low | Serving pair at 9+ shots 55.6-55.7% (42, national); level at about 50 only from 15+ shots. | n 12000. | |
| 31 | Low | Distance a point 19.2 / 18.0 m (10.7 / 7.5, shorter rallies). | `r4p-dist`. | |

**Why #2 stays High, stated openly.** A verifier could call it right in kind: the AI still plays the glass, the misread is doing a real
job, and the rally numbers improved. That is the case for Medium. I kept High because it got worse on the same seeds, it stands at
about twice the published per-stroke rate, an expert sees a slow ball off the back glass put in the net within a set, and this is
the skill padel is known for. What the misread gained is real and should be kept: bandeja plus víbora winners 1.7 to 5.8-6.6% (12.7),
smash share 55 to 49 (43), shots 11.4 to 10.2, seconds 15.4 to 13.7.

**The people.** Against the owner's four, in the order I'd fix them:

1. **How they move:** first, and fixable now. #1 is a bug, #4 and #5 are keys, and all three show from the broadcast camera or in replays.
2. **Bodies in play:** right proportions in action, and the round 8 lean and retreat hold. What's left is #5 and #12.
3. **Faces up close:** at stroke distance they read as plausible game characters, not people. That's the known MakeHuman limit with
   MetaHuman waiting, so I don't count it as new. I took no close-up this round, and it ranks behind the first two because it is
   only seen in close-ups and replays, while movement is on screen all match.
4. **Hair and kit:** nothing in my frames argued with round 8's "Better"; the critic owns this.

### What holds up

- **Rhythm:** 10.2 shots, 13.7 s, 0.75 a second (10-11, 13.5-14.8, 0.80), n 12000. CV 0.76 against Courel's 0.76: the shape of the
  length distribution was closed in round 4 and stays closed.
- **How points end:** W / FE / UE 39.8 / 27.2 / 33.0 and 40.2 / 25.9 / 33.9 (34-42 / 29-33 / 29-33). Winners bounce 53.4-54.0, back 35.7-36.8
  (48, 35). Errors net 55-57 (51). Zones of winners: net 52.9, mid 39.8, back 7.2; errors back 51.5.
- **Serve:** 58 / 64 / 72 km/h, 0.71 m contact, 1153 rpm, net clearance .39. Faults 7.2, double 1.4. Places wall 60 / T 27.3 / middle 12.7
  (64.6 / 24.3 / 11.1). By true court: left 66.5 / 21.9, right 54.1 / 32.8 (published: left more wall, right more T).
- **Return:** lob 29.9%. Flat to the server 76.7 (71.9). Left court backhand 77.1, right forehand 67.3, down the line 51.8.
- **Third shot:** 3.62 m, 0.79 s (3.84, 0.86). Third contact on a lob return 6.57 m.
- **Overheads, share of points:** bandeja 39.4-39.6, víbora 25.8-26.4, smash 34.4-35.6, bajada 15.7-15.8, contrapared 9.8-10
  (44-48, 20-23, 37-41, 14-17, 11-13). Smash 49% of winners (43), W 49-51, UE 3.9-4.8, 119 / 132 / 141 km/h, contact 2.49, line 73.6 of wing contacts (77.7).
  W by depth under 3 m: 55; 3-4: 58; 4-5: 53; 5-6: 41; over 6: 23. Bandeja 71 km/h, landing 8.3, 64% back first; víbora 79, 41% side first.
- **Lobs:** 18.4% of shots, 1.99 a point, apex 6.55, landing 5.96 / 8.18 / 9.37, in 82% of points (76-81).
- **Volley:** W 4.6, UE 5.4-5.5 (3-6, 3-5). Cross 52-59.8 (57.5). Zones of hits 49 / 22 / 28 (49 / 19 / 26).
- **Movement:** in play 1.52 m/s, peak 4.67, p99 5.31. Anim-check: skate 20-21.6 cm/s, 80-108 pops a run, knee spins 0, legs through 5.2-6.05%.
- **Ladder and styles:** 1 v .75 60.2, 1 v .5 68.8, .5 v 0 66.7. Signatures: lob Muro 29.5, overhead Martillo 56, víbora Serpiente 65.
- **Women:** smash W 32.9, 15.7 s, 31.9 / 29.5 / 38.6.
- **No one-key exploit at level 1:** scripted human's share of points mixed 41.7, lob 43.6, drive 49.5, slice 45.8 (±3.3). The drive result is within noise of even, not a farm.
- **Practice feeds:** my first reading of "lob feeds" was my own measure counting the whole rally. Measured to the first touch, they're fine.

## 3. Against REVIEW.md

Ranks that moved after I read REVIEW.md: #3 from High to Medium (the verifier lowered the same finding in round 8 for reasons that still
apply; it's the only move). #2 was High blind, stays High, and only its proof changed: the old-against-new comparison came after reading,
when I saw 230adaa landed after the reviews. Two blind items went: the forehand volley's square feet (R8 ruled that it holds, Chao 2008)
and the rally shape (closed by R4).

| # | Mark | Note |
|---|---|---|
| 1 | **NEW** | No earlier report. Hits about 1 stroke in 50 |
| 2 | **REGRESSION**, proven | Of R8 P#7 / R1 #3 (glass errors) and R6 #3 (High, "Better"). Same seeds, 6000 points |
| 3 | REPEAT R8 #5 (P#2), R7 #8, R6 #19 | The rail figure is NEW; stays Medium by the verifier's ruling |
| 4 | **NEW** | R8 #9 looked at the dip, not the peak's timing |
| 5 | **NEW** | |
| 6 | REPEAT R8 P#7, R1 #3 | Share of returns is new detail |
| 7 | REPEAT R8 P#5, R7 #6 | Better |
| 8 | REPEAT R8 P#6, R7 #7 | A little lower: 6.5 on 8fd6459, same seeds, 5.7-5.9 now |
| 9 | REPEAT R8 P#4, R7 #22 | |
| 10 | REPEAT R8 P#12, R7 #11 | |
| 11 | REPEAT R5 #5; what's left of R8 row 3 | |
| 12 | REPEAT R8 P#11, C#9, R7 #15 | Stature as cause is new |
| 13 | REPEAT R8 P#8 | Worse, 26.1 to 29.7 |
| 14 | REPEAT R4 #12, R2 #13 | |
| 15 | **NEW** | R8 said the mode "isn't broken any more", and it isn't. Earlier singles rows were other faults; this is the glass errors in it |
| 16 | REPEAT R8 P#17 | Better, 21.6 to 19.6 |
| 17 | REPEAT R8 P#13, R7 #12 | |
| 18 | REPEAT R8 P#14 | Better |
| 19 | REPEAT R8 P#15 | Better |
| 20 | REPEAT R8 P#16 | Better |
| 21 | REPEAT R8 P#9 | Better |
| 22 | REPEAT R8 P#18 | Better |
| 23 | REPEAT in part: the verifier accepted -31 / -17 as two measures in R8 | |
| 24 | NEW | |
| 25 | NEW | |
| 26 | NEW | |
| 27 | NEW | The tool has shown it for rounds; no report ranked it |
| 28 | REPEAT R8 P#30 | |
| 29 | REPEAT R8 P#25 | |
| 30 | REPEAT R8 P#29 | |
| 31 | REPEAT R8 P#19 | Better, 21.3 / 20.1 to 19.2 / 18.0 |

### Statuses that don't hold

- **R6 #3 "Better":** 11.2% of points then, 8.1-8.3 by the same probe on 8fd6459, 12.7-12.9 now (under 8 wanted). Finding #2.
- **R8 P#24 / R7 #26 "serve places don't differ by side" is a measuring bug**: the side came from the team number, and ends change. By the
  contact's z it's 66.5 against 54.1 on the wall, as published. Close both, as R7 #18 was closed.
- **R8 #9 "Fixed" is Better.** It holds for the drive and for the smash's dip. A slice still falls from 10.6-11.5 to 8.0-8.3 m/s at
  contact, and the smash peaks 0.08 s late (finding #4).
- **R8 #3 "Fixed" holds only for the overheads.** Smash W 32.9 and 15.7 s stand; the women's serving pair wins 59.7 against 48.5 (finding #11).
- **REVIEW.md's round 8 opening says "written blind on c660d41".** All three reports say 8fd6459, and 230adaa came between them. So the
  misread has never been reviewed; the R8 table's "unseen seeds" numbers are fix-time numbers, not a review's.
- **R5 #3 "Fixed, 1.5-2.7%":** holds for the side fence, 2.1%. But lobs out altogether are 4.5% of points (289 back or end, 255 side), so don't read it as the whole of lobs out.
- **`docs/ai.md`:** the ladder and top-level tables are stale (11.0 shots, 14.7 s against 10.2, 13.7).

### Statuses that hold

- R8 #1: going back over 2 m/s, chest under 40 degrees 8.5% men (n 117). Women 14.3% (n 161), against a claimed 8.0, a small sample; side-on 59.0 / 63.4.
- R8 #2: lean 30.4 / 19.4 / 11.1 (n 3632 / 2913 / 1753).
- R8 #10: elbow low 55 (n 23), mid 59 (n 25).
- R7 P6 Better. R7 #1, slice key (45.8). R7 #2, the smash that comes back: 0 by-body in 12000. R8 #5, #13, #14: still open, as stated.

### Not checked

- No person played. Everything is AI play, a scripted human in Node, and frames.
- `tools/bot-play.mjs` in real Chrome (doubles, singles, narrow): not run. The Chrome lock was held by other sessions' jobs for the
  42 minutes it was queued, and I stopped my queued jobs at 05:38. Real key timing and hit rates are not checked this round, not passed.
- Finding #1 in real Chrome: the stale frames were captured in the pane only (`?backend=webgl`). The same capture queued for real
  Chrome never got the lock. The first real-Chrome run found 10 of 16 frames, none of them a stale one. The sim is deterministic and
  the Node counts agree, so the finding stands, but it has no WebGPU frame.
- Knock-out and Practice through the app's menus: measured headless only (`r5p-human.ts`, `practice.ts`), not played in a browser.
- Critic's rows 4, 6, 7, 8, 11, 12, 15 and 16 in the R8 table.
- Left-handers' strokes, gone through class by class. The body probes skip them.
- Face close-ups: none taken this round.
- Sound.
