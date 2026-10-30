# Review round 4: the professional player

I wrote this blind. I played and measured the game first and drafted every way it falls short of professional padel.
Only then did I read REVIEW.md and the round-3 reports to mark each finding NEW, REPEAT or REGRESSION. No code or data
was changed for this review; this report is the only tracked change.

**The short version.** Nothing is Critical, and the game is padel in kind: the rhythm, rally shape, overhead game, lobs,
net-takes and style balance all hold against published figures. Six findings are High. Two are new, and both are about
*where the ball goes*: flat shots go down the middle, and against two back the net pair has one volley plus a drop
volley that wins a third of the time. The third High is the serve, which is still sent evenly around the box. The
fourth is the bandeja volleyed at the shins from the back, which round 3 improved but did not fix. The last two are
singles, which has no fight for the net and ends on the full into the glass.

An unmerged branch may already cover some of these (see the end of section 3). Everything below is measured on 78637a7.

## 1. How I reviewed

- **Code:** branch phase9 at 78637a7. HEAD did not move during the review.
- **Levels:** level 1 (the "Pro" difficulty) unless I say otherwise. Level 0.5 is the other end of the ladder I
  measured in full. `point-mix` uses the tool's default level, 0.55.
- **Headless measurement:** all AI, doubles unless marked singles. Every probe is a scratch script in `tools/out/`.
- **An earlier run of this review was cut off.** I re-ran its level 1 and level 0.5 stats at 78637a7. Both came back
  byte-identical, so I reused its `r4p-*` outputs. `r4p2-*` is new this sitting.

| Tool | Run | Output (`tools/out/`) |
|---|---|---|
| `node tools/match-stats.ts` | 2040 points, level 1, seed0 1301, and a second seed range | `r4p-stats-l1.txt`, `r4p-stats-l1b.txt`, `r4p2-stats-l1.txt` |
| match-stats, level 0.5 | 1000 points | `r4p-stats-l05.txt`, `r4p2-stats-l05.txt` |
| `r4p2-log.ts` (new: every shot of every point logged, then cut by serve direction, volley type, drop, let-through, tracking, endings) | Level 1: 3000 points (seed 1301), 2000 (5301), 2500 (7301). Level 0.5. Singles standard at 1 and 0.5, narrow. Panoramic, clay and hard courts | `r4p2-log-{l1,l1b,l1c,l05,singles,singles05,narrow,pano,clay,hard}.txt` |
| `r4p2-dir.ts` (new: shot direction, landing width, forehand share, how double-bounce winners happen) | 2000 points each, two seed ranges, plus level 0.5 | `r4p2-dir-{l1,l1b,l05}.txt` |
| `r4p2-full.ts` (new: balls into a wall on the full; target against landing) | Singles, narrow, doubles, 1500 points each | `r4p2-full-{singles,narrow,doubles}.txt` |
| `r4p2-whiff.ts` (new: what the swings that miss are) | Two seed ranges at level 1, one at 0.5 | `r4p2-whiff-{l1,l1b,l05}.txt` |
| `r4p2-giveup.ts`, `r4p2-giveup2.ts`, `r4p2-handoff.ts` (new: does anyone chase a ball that passes the net pair) | Level 1 | console and `r4p2-handoff.txt` |
| `r4p2-front.ts`, `r4p2-vh.ts` (new: contact in front of the body; height of volleys) | Level 1 | `r4p2-front-l1.txt`, console |
| `r4p2-h2h.ts`, `r4p2-hth.sh` (styles and levels head to head) | About 3000 points a pairing; six style pairings, each ladder step | `r4p2-h2h.txt`, `r4p2-{s-*,lv-*,l0,l1-b,l05-b}.{txt,json}` |
| `node tools/point-mix.ts` | Doubles and singles (default level) | `r4p2-mix-d.txt`, `r4p2-mix-s.txt` |
| `node tools/anim-check.ts` | `r4p 120 3` | `r4p2-anim-check.md`, `r4p2-animcheck.txt` (moved out of docs/lab) |
| `r4p2-anim-hand.ts`, `r4p2-anim-deep.ts`, `r4p2-anim-miss.ts` (body angle, late rackets, low deep volleys) | Seeds 13-16, 240 s each | `r4p2-anim-hand.txt`, `r4p2-anim-deep(2).txt`, `r4p2-anim-miss(2).txt` |

**Round-3 probes reused or adapted.**
- Reused unchanged: `tools/out/r3p-cap.mjs` (captures).
- Adapted: `r3p-probe.ts` and `r3p-probe-court.ts` (`r4p-probe-{l1,l05,singles,narrow}.txt`).
- Adapted: `r3p-oh.ts` and `r3p-oh2.ts` (`r4p-oh.txt`, `r4p-oh2-*.txt`, and new `r4p-ohctx.ts` for `r4p2-ohctx-l1.txt`).
- Adapted: `r3p-backvol.ts`, `r3p-lobfollow.ts`, `r3p-nettake.ts` (same names with `r4p-`).
- Adapted: `r3p-ret2.ts` (`r4p-ret.ts`, `r4p-ret2.ts`; `r4p2-ret.txt`, `r4p2-ret2-{l1,l05}.txt`).
- Adapted: `r3p-anim-hand.ts` (`r4p2-anim-hand.ts`).

**Bot play.** A keyboard bot played the human side in real Chrome through the real input path, 60 s each. Output is in
`r4p2-botplay.txt`.

| Mode | Seed | Hits | Timing error p50 | Notes |
|---|---|---|---|---|
| Doubles | 13 | 11 of 11 | 2.4 ms | Every grade Perfect |
| Singles | 14 | 15 of 15 | 2.4 ms | |
| Singles, narrow | 15 | 14 of 14 | 1.9 ms | |
| Panoramic on clay, AI 0.5 | 16 | 11 of 11 | 2.2 ms | Won 4, lost 0 |

There were no whiffs and the input path holds. Narrow, panoramic, clay and hard were measured headless and in these runs; the captures below are doubles and singles.

**Captures.** 50 frames and 3 contact sheets, not committed, in
`/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r4-pro/`. Taken with
`r3p-cap.mjs` on the dev server, `?autoplay=1&seed=23&ai=1` (doubles seed 31 for some moments, singles seed 29), 1600×900
in real Chrome. The script finds each moment with a ghost MatchSim, then steps the real game to that tick.

| Files | What they show |
|---|---|
| r4p-01..06 | Serve from TV, side, before contact and follow-through; return; lob at its apex |
| r4p-07/08/09, r4p-64/65/66 | Bandejas volleyed at the shins from the back |
| r4p-16..22 | Forehand and backhand groundstrokes; back-glass shots from behind |
| r4p-23..25 | Back wall, side wall, double wall |
| r4p-26..31 | Bandeja, víbora, smash, bajada |
| r4p-33, r4p-34 | Chiquita; split step |
| r4p-35, 36, 61, 62, 63 | Rally seen from the TV camera |
| r4p-40..43 | Singles: serve, return, third shot, back wall |
| r4p-50..53 | The drop volley: contact, flight, landing, the chase |
| r4p-54..58 | Forehand and backhand volleys |
| r4p-59, r4p-60 | Contrapared |
| sheet-a, sheet-b, sheet-c | Contact sheets of the above |

## 2. Findings, ranked by impact

Pro figures come from what `tools/match-stats.ts` prints beside each number and from `docs/research/shots-movement-feel.md`
(SMF), `docs/research/serve-and-strokes-motion.md` (SSM) and `docs/realism.md`. Each cell names its source. Ranges are
the spread across seed ranges. Percentages on about 3000 points carry about ±1.8 points at 95%.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Everything flat goes down the middle.** Against two at the back a pro moves them: corners, side glass, cross-court to open the line. Here the AI aims between them, so a rally is two pairs trading balls through the centre, and the outer metre of the court is nearly empty. | **Direction of ground, wall and volley shots struck from outside the centre (level 1, two seed ranges, about 8,000 shots each):** cross 22.9-24.1 / line 31.8-32.0 / to the middle 44.1-45.0%. **Cross against line alone:** 41.7-43.0 / 57.0-58.3. WPT 2014: 57.5 / 42.5 (Mellado-Arbelo et al. 2019, SMF §1a). The ratio is inverted. The paper has no "middle" class, so compare the ratio, not the raw shares. **Volleys alone:** 19.7-21.2 / 33.8-34.2 / 44.6-46.5%, and a further 46% of volleys are struck from the centre. **Landing width of flat shots against two back (n 4983, 5024):** \|x\| 0-1 m 57.9-59.2%, 1-2 m 28.4-29.6%, the outer metre 1.5-1.7%. Level 0.5: 56.8% in the centre metre. Output: `r4p2-dir-{l1,l1b,l05}.txt`. **Code:** `simpleAi.ts:983-984`, the both-back target is the opponents' midpoint plus a normal of 0.7 m. | Replace the both-back target with a weighted table: corners, side glass, line and body, with the middle a minority. Keep "por el medio" as one option; it is the right ball against a net pair. Target: cross about 57% of cross plus line. No published figure exists for landing width, so judge that on film. |
| 2 | High | **Net play against two back is one ball, and the drop volley is the finisher.** A net pair should work the point: deep to the corners, the side glass, angles, feet. Here the plain volley is a 47 km/h ball down the centre that almost never ends anything, and the drop is the way points are won. A human will find that within a match. | **Net volleys against two back (n 5852 and 3854):** 47 km/h; over the net p10/50/90 1.07/1.19/1.29 m; lands 5.95/7.14/8.10 m from the net; \|x\| under 1.2 m 65-66%, over 2.5 m 5.5-5.8%; side glass first 0.6-0.8%; at the feet 1.5%. Last shot of the point and won 1.0-1.1%, lost 2.2-2.6%. Pros' volleys: W 3-6 (Mellado-Arbelo 2019, match-stats header). **Net drops against two back:** 0.26 a point (799 in 3000, 523 in 2000); won 30.8-32.5%, lost 10.7-12.3%. Struck from 0.69 m, below the tape; 23-24 km/h; lands 1.6-1.7 m from the net. The nearest defender is 6.57 m away at depth 8.00 m, with 1.60 s before the second bounce. **Share of endings:** a drop's double bounce is 8.1-9.1% of all points, about 22% of all winners, about 70% of volley double-bounce winners (181 against 79). Published data has no drop-winner share. My analyst's estimate is 3-6% of winners, and it is only an estimate. The exploit needs no estimate: W 32% against W 1% from the same place. Output: `r4p2-log-{l1,l1b}.txt`, `r4p2-dir-{l1,l1b}.txt`. Captures r4p-50..53. **Code:** `simpleAi.ts:835`, `0.12 * st.drop`, with no check on contact height. | Cut the drop's base rate and allow it only on a ball above the tape from close in. Have defenders read it and shade forward. Lift the plain volley's W by giving it angles and pace that grow with contact height. Target: volley W 3-6 with drops inside it. |
| 3 | High | **The serve still goes evenly round the box.** Pros serve two in three into the side glass, and this is the first thing a player reads in a match. | **Direction (3000 + 2000 serves, level 1):** side glass 31.1-32.3 / T 32.2-33.1 / middle 35.3-35.4%. WPT men 64.6 / 24.3 / 11.1 (Sánchez-Alcaraz et al. 2020, SMF §6). Level 0.5: 25.6 / 30.1 / 42.9. **Code:** `simpleAi.ts:216-225` draws it directly, 35 / 35 / 30, and the second serve never goes wide (`second ? 0.5`). SMF §6 itself says "Aim about 63% at the side glass". **Height on the glass:** p50 0.54 m. **Speed:** 61-68 km/h (amateur open 70 ± 7, Sánchez-Pay et al. 2023; no pro figure). **Consequence for the fix:** side-glass serves make 7.3-9.1% return errors, T and middle 1.6-2.3%. At 65% to the glass, return errors go from 4.2% to about 6%, above the pros' 5.4 (SMF). | 65 / 24 / 11, more to the glass from the left, more T from the right (Sánchez-Alcaraz et al. 2022, SMF §6). Recheck return errors after. |
| 4 | High | **Bandejas are still half-volleyed at the shins from the back.** The defender stands on the spot where the bandeja lands and scoops it on the full. It is better than round 3, but a bandeja should be played off the glass and this one-in-five reply is the most visibly wrong stroke in the rally. | **Against two back (n 1572, 1047):** 20.4% and 19.9% taken on the full from past 6 m. Level 0.5: 17.9%. Contact p10/50/90 0.25/0.50/0.88 m; 76% under 0.7 m; struck from 7.1-7.2 m. The volleyer's pair went on to win 45-48%. That is about one point in ten. **All bandeja replies:** about 17% (213 of 1258) against round 3's target of under 10%. Víbora, for comparison: 2.4-3.0%. **Racket:** 28% of these low deep volleys meet the ball 33-150 ms late and 5.6% never come within 25 cm (n 18, so read it only as a direction; an earlier sample of 25 agrees). Captures r4p-07/08/09 (sim 33.375: contact at 0.39 m with the racket at head height and the ball 1.3 m below it), r4p-64/65/66 (half-volleys in a forehand ground stance). **Cause:** the defender stands at `BACK_Z` 8.0 m (`formation.ts:8`) and the bandeja lands at 8.22 m (p50), so the ball arrives at the feet. Output: `r4p2-log-l1.txt`, `r4p-oh2-*.txt`, `r4p2-ohctx-l1.txt`, `r4p2-anim-deep2.txt`. | Stand off the glass or step back early for a ball landing at the feet. Add a real cost to a contact under 0.8 m past 6 m. Plan the stroke early (also #11). Target: under 10% of bandeja replies. Watch #7: the last fix took this down by adding back-wall shots. |
| 5 | High | **Singles points end on the full into a wall, and half of those are the side glass.** A singles player has a full court and no partner to cover for; the side glass on the full is the error of a beginner. Here it happens standing still, off an unpressured ball. | **Points ending on the full into a wall:** 38.1% standard, 47.9% narrow, 35.8% standard at level 0.5 (n 1500 each). In doubles 18.3%. Those are 66.4% and 62.9% of errors; pros' doubles 28 back + 17 side (match-stats header). There is no singles benchmark, so this is judged as padel. **Which wall:** side glass 292 of 571 standard, 479 of 718 narrow, so 19.5% and 31.9% of all points. Doubles: 85 of 273. **Not pressure:** the hitter's speed is p50 0.00 m/s, from 7.4 m, at 0.73 m. **Cause:** `simpleAi.ts:892-895`: at level 1 the aim is 0.8 m inside the glass and the sideways miss has p90 1.3-1.4 m on the standard court and 0.9-1.2 m on the narrow one (lobs 1.9 and 1.5). The lob target is 8.6 m (`:897-899`), and 14.0-15.6% of singles lobs hit a wall on the full; doubles 3.7-4.6%, target 7.0-8.2 m. Output: `r4p2-full-{singles,narrow,doubles}.txt`. | A margin larger than the scatter: aim at least 1.4 m in from the glass at level 1, scaled by level. Lob target 7-8.2 m. Check 38% falls and that the side-glass share falls with it. |
| 6 | High | **Singles has no fight for the net.** Padel is decided at the net, and here nobody goes there. Two players trade from the back and points end in a handful of shots. | **Server at the return:** 7.60 m every time (p10 = p90). **Volleys:** 3.7% of shots (narrow 9.0%) against 28.1% in doubles. **Third shot a volley:** 2.9% (narrow 8.6%). **Third shot off the back or double wall:** 62%. **Shots hit from the net zone:** 10.5-11.1%. **Shape:** mean 5.17 shots, p50 4, 20.3% of points 1-2 shots. Receiver wins 11.0% of all points outright, 79% of those with slices, and the server wins 48.1%. Narrow: 6.91 shots, server 51.0%. 1.70 s between shots. Output: `r4p-probe-{singles,narrow}.txt`, `r4p2-log-{singles,narrow}.txt`. Capture r4p-41 and r4p-42. **Cause:** `simpleAi.ts:270-278`, singles recovery is `s * (nearNet ? 3.2 : 7.6)`, and `nearNet` needs a recent contact inside 5 m. No approach rule exists. | A singles approach rule: serve and volley behind a deep or side-glass serve, approach on short balls, and a singles version of the net-intent decision. Check volleys and the server's win share (the server should clearly lead). |
| 7 | Medium | **The back glass is climbing back.** Round 3's fix for #4 sent more balls to the glass, and the share is now near where round 2 complained. | **Back-wall shots:** 20.6% of shots (16.7 at round 3); pros 12.8 (WPT 2014, match-stats). **In points:** 76.7% (70.2). **A point:** about 2.35 (1.1-1.4, ratio from the pro share and shots a point). **Back-wall UE:** 8.8-9.7% (pros 5-6), double wall 12.1-12.5. 78.4% of deep balls are played off the glass (n 7594). Level 1, `r4p-stats-l1.txt`, `r4p2-log-l1.txt`. | Reduce the supply, not the choice: fewer flat balls to the back (#1, #2) and more low, short ones. Then trim the spread on clean back-glass balls. Fix with #4, not after it. |
| 8 | Medium | **The serving pair lost its short points, and its edge lasts too long.** | **Serving pair's wins on 1-2 shot points:** 65.7-74.3% (83.3 at round 3, 85 at round 2; national 97.9, match-stats). **Receivers win 1.1-1.7% of all points outright,** 68-81% of those with slices. **By length:** 3-6 shots 75 against national 64, 9-12 shots 58, 13-20 shots 54; the WPT edge is gone after the 12th shot (SMF §6). Output: `r4p-stats-l1.txt`, `r4p2-log-l1.txt`. | Find why a return slice double-bounces past a server already 4 m from the net (see #13). Then shrink the third-shot volley's advantage after shot 6. |
| 9 | Medium | **The server runs in too far and too fast.** | **At the return (n 3000):** 4.12 m from the net (national 5.08 ± 0.58). **Moved:** 3.76 m (2.71 ± 0.58) in 1.26 s (1.22 ± 0.20). Mean speed about 3.0 m/s, about the tracked *peak* of 2.93 ± 0.43 (Ramón-Llin et al. 2021, SSM). The third-shot contact itself is fine: 3.46 m (3.84 ± 0.91, SMF). Output: `r4p2-log-l1.txt`. | Stop the run about 1 m further back at the return. Finish the approach on the third shot. |
| 10 | Medium | **Net volleys are struck low.** A net player closes to take the ball above the tape. | **Contact height, net volleys (n about 6,000):** p10/25/50/75/90 0.36/0.51/0.69/0.94/1.25 m. 70.8% below the tape, 9.9% over 1.25 m. Skilled tennis players 3 m from the net meet the ball at 1.07-1.23 m (Chao et al. 2008, SSM); that is a tennis analogue, not a padel figure. Probe: `r4p2-vh.ts`. Captures r4p-54..58. | Volleyers meet the ball earlier and step forward. This helps #2: more balls above the tape means more can be hit down. |
| 11 | Medium | **Stretched low contacts still meet the ball late.** | **n 1235 contacts:** 95.5% within 15 cm by 33 ms, 3.4% late at 33-150 ms, 1.1% never within 15 cm, 0.4% never within 25 cm, 0.1% never within 50 cm. Groundstrokes 9.1% late. Median height 0.5 m, 69% on the run. **Why the tool misses it:** `animQa.ts:512` takes the best distance over 0-150 ms, so a swing 100 ms late passes. Output: `r4p2-anim-miss2.txt`. | R3 #20's open item: plan the low stroke earlier. Tighten animQa's window or add a check on time of nearest approach. |
| 12 | Medium | **Beaten players still swing.** | **8.9-9.7 whiffs per 100 points,** 93% out of reach (ball p50 1.61 m away), mostly graded Too late. 8.1-8.7% of points end on one. They are filed under the opponents' winners, so match-stats' "whiff 0.2-0.5%" hides them. `standDown` (`simpleAi.ts:307-313`) doesn't catch them. Output: `r4p2-whiff-{l1,l1b,l05}.txt`. | If the ball will be over reach at the swing time, stand down. docs/ai.md already promises this. |
| 13 | Medium | **The net pair doesn't chase what passes it.** The count of these winners is fine; it is how they look. | **Flat balls that beat two net players by a double bounce: 5.4% of points.** The taker changes in half of them, at 0.86 s, 0.21 s after the ball has passed 3.5 m; in the other half never. The nearest defender is 2.64 m from the dead ball. **Wider group, 10.1% of points:** 89% were reachable at 4 m/s, and the best defender moved 2.05 m at a peak of 3.99 m/s. **Winners from the back zone:** about 14%, pros 10.6 (SMF §1e), so this is behaviour only. Output: `r4p2-giveup*.ts`, `r4p2-handoff.txt`. | Hand over the taker earlier. The net player turns and runs on any ball that gets past. |
| 14 | Medium | **The víbora is still a slower bandeja.** | 64.9 against 70.5 km/h. W 1.6-1.8 against 2.1-2.4. Bandeja and víbora together 5.1-5.6% of winners; pros 12.7 (Sánchez-Alcaraz et al. 2022, SMF). `data/shots.json` gives the víbora 25.2 m/s against 20.7, but the spin takes it. | Solve for pace above the bandeja's. |
| 15 | Medium | **Endings read as WPT qualifiers, not the main draw.** | W / FE / UE 38-40 / 24-25 / 36.5-36.7. Main draw 34-42 / 29-33 / 29-33; qualifying UE 37-38 (match-stats, SMF). Volley winners improved to 32.5% (28.4). Errors into the net 55 (51). Output: `r4p-stats-l1*.txt`, `r4p2-log-l1.txt`. | More pace errors forced. Follows partly from #1 and #7. |
| 16 | Medium | **The styles' net trait doesn't show.** | **Net time, about 3000 points a pairing:** Muro 37.6-39.1% against Relojero 32.1, Martillo 33.6, Serpiente 34.7. Martillo 41.6 against Relojero 39.5. Muro, the wall, is at the net more than all three. Output: `r4p2-s-*.json`. | Tie the trait to following lobs and drives in. |
| 17 | Medium | **Too few serve faults.** | First-serve faults 4.8-5.1%; WPT 7.1-10.6 (SMF). Double faults 0-1% of second serves (about 100); pros 2.1. Output: `r4p-stats-l1.txt`. | First serves with more risk. Fix with #3. |
| 18 | Medium | **The forehand volley is played square.** | Chest 3° to the net at contact (p90 10-15°, n 196), against the backhand volley's 61°. No sourced figure; coaching says a shoulder turn and a step with the opposite foot. Output: `r4p2-anim-hand.txt`. Captures r4p-54/55. | A forehand volley key with a shoulder turn of about 30-45°. Add it to animQa. |
| 19 | Medium | **Everything is struck from a standstill.** | Hitter's speed p50 0.00, p90 0.76 m/s across rally shots. There are no running volleys and no shots played on the move. Output: `r4p2-log-l1.txt`, `r4p2-front-l1.txt`. | Let the approach run through the volley and through the bajada, on the same stance rules. |
| 20 | Medium | **The bottom of the ladder is too short.** | Level 0: 4.6 shots a point (novices about 5.6). Level 0.5: 6.5 (trained recreational about 7.3). Those two benchmarks are derived, not measured directly (docs/ai.md). Its own table of the game (5.2 / 7.1) is stale. Output: `r4p2-l0.txt`, `r4p-stats-l05.txt`. | Fewer first-ball errors at the low end. Refresh the table. |
| 21 | Medium | **Stiff overhead and serve poses.** | Both arms up in a Y before the bandeja (r4p-27). The wide serve crouch (r4p-02, r4p-03). Mostly the critic's area. | Round 3's open item. |
| 22 | Low | **Peak speeds a little high.** | 4.62/4.74/4.95 m/s against WPT 4.2 (Miralles et al. 2025, `docs/realism.md`), with 0.5 s smoothing: about 13% over. | Trim the sprint cap slightly. |
| 23 | Low | **No play outside the court.** | 4.4-4.8% of points end `exit_after_bounce`. | (Stretch goal.) |
| 24 | Low | **Serve-time positions never vary.** | Server's partner 2.60 m (p10 = p90), receiver's partner 7.60 m. | Draw them from a small range. |
| 25 | Low | **Thighs clip; the neck turns too fast.** | Legs clip in 2.5-2.7% of frames, worst 14.9 cm. Neck 349-480 frames over the limit per seed (`r4p2-anim-check.md`). | |
| 26 | Low | **Split steps very common.** | 79 per 5 min of rally time against 7.7 per 5 min of play (Priego et al. 2013, SMF). The published count looks low and covers dead time too, so the gap is smaller than it looks. | Leave it unless it reads as a twitch. |
| 27 | Low | **Serves land short.** | 5.7-6.0 m from the net, about 1 m inside the 6.95 m line. | Aim deeper; it also helps #3. |
| 28 | Low | **All-four-up points are mostly lobbed volleys.** | About 25% of volleys in that formation are lob volleys. No published figure. | Watch after #2. |

Things that hold up as padel, measured this round:
- **Rally shape.** Mean 15.1 s, SD 11.9-12.4, CV 0.79-0.81 against Courel-Ibáñez 2017's 0.76 (SMF). Scaled to Courel's
  mean, the 1-4 / 5-7 / 8-11 / over 11 s shares read 28.3 / 23.1 / 21.1 / 27.5 and 28.6 / 24.1 / 18.7 / 28.6, against his
  26.1 / 25.9 / 22.2 / 25.8. Unscaled, 11-12% of points last 1-4 s and 50% last over 11 s, because the game's mean sits with
  modern WPT play and not with Courel's 9.4 s. The mean is 2-12% over WPT 2020's 13.5-14.8 s. The shape is right.
- **Rhythm:** 1.27-1.33 s between shots; 0.90 s from return to third shot (national 0.86).
- **Return:** lob 31.5% (34.7), errors 4.2% (5.4), 1.22 m over the net, 66 km/h. The server plays 79.7% of flat
  returns (level 0.5 70.7%), pros 71.9.
- **Lobs:** apex 6.6 m, landing 8.04 m, 1.9 a point (WPT about 2.0); 75.3% taken in the air.
- **Net-takes:** the lob makes 57.3% (60.6); lobbers are both up after a lob that gets past 99.2%; a chiquita takes the
  net at the pair's next strike 10.5%, a lob 14.6%; partners swap on 13-14% of lobs (no data).
- **Strokes in points:** bandeja 41-43 (WPT 44-48), víbora 25.7 (20-23), smash 38 (37-41), bajada 17-18 (14-17),
  contrapared 12-13 (11-13), lob 81 (76-81).
- **Overheads:** smash 130.7 km/h, W 35.7-39.4, UE 2.8-3.0 (pros 45 / 6). In 2000 points, x3 77 and x4 6. The smash goes to
  the line 62%. Winners by double bounce / came back / out: 47-49 / 34-35 / 11-12.5 (48 / 35 / 17, Ramírez Ortega et
  al. 2025).
- **Where shots are hit from:** 50.9 / 18.9 / 30.3 (49 / 19 / 26).
- **Contact ahead of the body** (Sánchez-Alcaraz et al. 2021, SMF): serve 0.50 m (0.52), groundstroke 0.43 (0.64), volley
  0.35 (0.38), bandeja −0.01 (−0.01), smash 0.37 (0.45), back wall 0.60 (0.43), lob 0.49-0.62 (0.65). Groundstrokes
  are the one short of it, and not by much.
- **Body angles at contact:** backhand 60-61°, back-wall backhand 77-78°, back-wall forehand 46-48°, bandeja 52-53°,
  víbora 39-40°, smash 3-4°, forehand groundstroke 2-3° (notes 0-30).
- **Forehand shares:** back wall 64 (61), volley 53 (44), groundstroke 55 (46), side wall 51-54 (33).
- **Tracking:** 75 m per rally minute; under 15 km/h 97.4% of the time. Per point the server covers 17.4 m and the
  partner 15.0 (high level 10.7 / 7.5 on shorter rallies, Ramón-Llin et al. 2013; level 0.5 reads 9.1 / 6.7 against
  medium level 9.2 / 6.6).
- **Styles are balanced and legible.** Muro 47.1, Martillo 48.7, Serpiente 48.3 against Relojero; Martillo-Serpiente 49.9,
  Muro-Martillo 50.4, Muro-Serpiente 50.7 (about 3000 points, ±1.8). Muro lobs 22-23% of shots, Martillo smashes 46-54%
  of overheads, Serpiente's overheads are 59% víbora.
- **The ladder is monotone.** Level 1 beats 0.5 72.5% and 0.75 65.2%; 0.75 beats 0.5 60.7%; 0.5 beats 0.25 57.7% and 0
  65.1%.
- **Other modes.** Panoramic 11.40 shots, 15.32 s, server 62.1; clay 10.83, 14.47, 66.3; hard 10.55, 14.13, 62.4. All right
  in kind; the same findings apply.
- **Frames.** Overheads, chiquita and wall shots look right in kind in the captures. Contact heights are in the notes'
  bands (bandeja 1.85-2.05 m, víbora 1.55-1.85 m).

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **NEW** | Round 3 measured who plays the return, not where the rally goes. |
| 2 | **NEW** | Round 2 #3 was about volleys at bodies, and that held. The drop's 0.32 a point at round 3 went unjudged; it isn't a regression (now 0.26). |
| 3 | **REPEAT R3 #13, raised from Medium** | Nothing changed. I rank it High because it applies to every point, is a factor of two off, and an expert reads it within a match. Against round 3's own ranking, that is a harsher call; I stand by it. |
| 4 | **REPEAT R3 #1, status Better not Fixed** | Numbers in the status hold, the finding's target doesn't. |
| 5 | **REPEAT R3 #17, raised from Medium** | New this round: half are the side glass, struck unpressured, with the cause found. |
| 6 | **REPEAT R3 #17, raised from Medium** | Same round-3 row, a separate cause and fix. Round 3 ranked singles Medium; with no net play at all in a net sport, an expert sees it inside a minute. |
| 7 | **REGRESSION** of R1 #3, caused by R3 #1's fix | 16.7 → 20.6%. |
| 8 | **REGRESSION** of R2 #13 | The serving pair's short-point wins fell from 83-85% to 66-74%. |
| 9 | **NEW** | |
| 10 | **NEW** | |
| 11 | **REPEAT R3 #20** | With a tool gap behind it (see below). |
| 12 | **NEW** | |
| 13 | **NEW** | |
| 14 | **REPEAT R3 #14** | |
| 15 | **REPEAT R3 #16** | Volley winners improved from 39.6 to 32.5%. |
| 16 | **REPEAT R3 #15** | |
| 17 | **REPEAT R3 #13**, R1 #8, R2 #13 | |
| 18 | **NEW** | |
| 19 | **NEW** | |
| 20 | **NEW** | |
| 21 | **REPEAT R3 #22** | The critic's finding, seen again in my frames. |
| 22 | **NEW** | |
| 23 | **REPEAT R3 #25** | |
| 24 | **REPEAT R3 #26** | |
| 25 | **REPEAT R3 #28** | |
| 26 | **NEW** | |
| 27 | **NEW** | |
| 28 | **NEW** | |

### Statuses that don't hold

- **R3 #1, "Fixed", bandejas volleyed from the back: Better, not Fixed.** Its own numbers hold: 36.5% volleyed (now
  38.0%) and 2.5% of shots volleyed from over 6 m (now 2.6%). But the finding's target was under 10% of bandeja replies
  on the full from the back, and it stands at about 17% of all replies, 20% against two back.
- **R1 #3, "Fixed for the AI", too much off the back glass: no longer.** It went back up from 16.7% to 20.6%, undone by
  R3 #1's fix. Pros are at 12.8.
- **R2 #13 / R3 #13, "serving is a touch too safe": the short-point half has flipped.** The serving pair's 1-2 shot wins
  fell from 83-85% to 66-74%, against national 97.9. Serving is now too safe on faults and too weak on the shortest points.
- **R2 #6 and R3 #12, "too few short points": unsupported as a defect.** The gap to 26% is a comparison of shares against
  a shorter mean from 2017. Scaled to the same mean, the shape matches (28 / 23 / 21 / 28 against 26 / 26 / 22 / 26). What
  remains is a mean 2-12% over WPT 2020. I would close this and keep only that.
- **R3 #27, "lobs a little scarce": doesn't hold.** Per point the game matches WPT 2020: 1.9 against about 2.0, and lobs
  in 81% of points (76-81). The 20% figure is one elite-men sample from 2013.
- **R3 #6 (critic), "Better", the racket misses the ball: holds as written but flatters it.** Its 1.25% over 15 cm reads
  1.1% now. But the 150 ms window in `animQa.ts:512` passes the 3.4% of low contacts met 33-150 ms late.
- **docs/ai.md's ladder table is stale** (5.2 / 7.1 shots, now 4.6 / 6.5).

**Statuses that hold:**
- R3 #2, returns (79.7%).
- R3 #3, the lob swaps roles (57.3%, 99.2%).
- R3 #4, side-on backhands (60-61°, 77-78°, 46-48°, backhand volley 61°).
- R2 #2, the overhead game. R2 #4, overhead stances.
- R1 #2, the bajada (17-18% of points). R1 #4, smashes where pros play the bandeja (smash 32.8% of overheads).
- R2 #7, bajada racket misses: none over 25 cm, but n is 8.

### Possible overlap with an unmerged branch

Branch `r4-mediums` (at 8592325, in a worktree, 30 Oct) isn't in HEAD and I didn't review it. Its commit subjects cover
the serve to the side glass, serve-time places, the víbora, overhead poses, the styles' net trait, and singles depth
("balls into it on the full 37% to 23% of points"). So #3, #5, #14, #16, #21 and #24 may already be in hand. Judged from
the subject alone, the singles commit addresses the far glass, not the side glass that is half of #5. All findings here
stand against 78637a7, as briefed; they should be remeasured after that branch merges.
