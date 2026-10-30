# Review round 6: the professional player

I wrote this blind. I played and measured the game first and drafted every way it falls short of professional padel. The
draft is saved as `tools/out/r6/draft-blind.md`. Only then did I read REVIEW.md and the round-4 and round-5 reports, to mark
each finding NEW, REPEAT or REGRESSION and to check every Round 5 status in my area. No code or data was changed; this report
is the only tracked change.

One limit on "blind": finding 4 was not in the draft. I measured it when checking R5 #1's status, so it is not independent
confirmation. Everything else ranked High was in the draft.

**The short version.** Nothing is Critical, and the game is padel in kind. Round 5's fixes for lobs out of the court and the
server's sprint hold, and the bandeja's body now sits close to the tour photos. Six findings are High:
- Net players let reachable balls fly past them and wait for the rebound, 31 times in 100 points. New, and the biggest.
- The fix for smashes moved the endings: smash 54-57% of winners (43), volley 14-17% (28.4), forced errors 17-19% (29-33).
- Defenders still watch soft balls die: 15% of points end that way, 96% of them reachable.
- Smashes are still answered on the rise: 70% of replies against two back, 0.45 s after the strike.
- The forehand volley, the most-played stroke, is square, straight-armed and racket-head down. By the owner's photo standard
  that now ranks High.
- The formation is on rails: 3.10 m from the net whatever the ball, so 77% of net volleys are struck below the tape.

## 1. How I reviewed

- **Code:** the brief's commit, phase9 at e39b531. Baselines for comparison came from two outside checkouts: 59125d6 (what
  round 5 reviewed) and 413d837 (round 5's AI fix).
- **Levels:** level 1 ("Pro") unless I say otherwise. Level 0.5 is the other end of the ladder. `point-mix` uses its default
  level, 0.55.
- **Seeds:** all new to this round. Headless 1901, 3101, 2101-2801 and 15001-15601; 1701 also, to compare with round 5's
  range. Browser seeds 41-50.
- **Noise:** percentages on about 2000 points carry about ±2 points at 95%, on 3000 about ±1.8, head-to-heads about ±1.8.
  Where it matters I give each seed range, written a/b/c. p10/50/90 are written 1/2/3.
- **Sources:** SMF is `docs/research/shots-movement-feel.md`, SSM is `docs/research/serve-and-strokes-motion.md`. Pro figures
  are in brackets. Published figures printed by `tools/match-stats.ts` come from the same files.

| Tool | Run | Output (`tools/out/r6/`) |
|---|---|---|
| `node tools/match-stats.ts` | 2040 points at level 1 on three ranges (1901, 1701, 3101); level 0.5; women's | `stats-l1-*.txt`, `stats-l05-1901.txt`, `stats-women.txt` |
| Levels and styles through match-stats | 1 v 0.5, 1 v 0.75, 0.75 v 0.5, 0.8 v 0.55; each style against neutral | `lv-*.txt`, `s-{muro,mart,serp}.txt` |
| `r5p-dump.ts`, read by `q-*.mjs` (new queries: serve, return, net, overhead, wall, movement, last shots, status) | Level 1: 3000 points (2101, 2301). Level 0.5: 1000. Singles 800 and 500. Narrow 800 | `d-*.ndjson` |
| `letgo.ts`, `letgo2.ts` (new: balls crossing a net player's plane in the air, and the taker's plan at that moment) | 1500 + 1000 points level 1, 800 level 0.5, 1200 for plans; 1500 each on the two old commits | console, figures in finding 1 |
| `die2.ts` (new: plan at the first bounce on a soft double-bounce winner) | 2000 points; `r4p2-giveup` on the two old commits | console, figures in finding 3 |
| `body.ts` (new: chest, ball, racket lean, stance, knees, elbow by stroke class) | 3 seeds | console, figures in findings 5 and 17 |
| `r6-game.ts`, `pose-metrics.ts`, `r6-pro.ts` (the owner's 33-photo pose comparison) | Game over 3 seeds against the tour photos | `game-p1.txt` |
| `r5p-human.ts`, `r5p-practice.ts` | QA bot at 4 levels and 7 habits; four drills, 300 feeds each | `human.txt`, `prac-follow.txt`, `prac-bot.txt` |
| `node tools/point-mix.ts`, `node tools/anim-check.ts` | Doubles and singles; `r6p 120 3` (outputs moved out of docs/lab) | `mix-*.txt`, `anim-check.md`, `animcheck.txt` |
| `r4p2-h2h.ts`, `r4p2-dir.ts`, `r4p2-full.ts`, `r4p2-anim-hand.ts`, `r4p2-anim-deep.ts` | Six style pairings about 3000 points each; direction; full-toss endings; hand and low strokes | `h2h.txt`, `dir-l1.txt`, `full-d.txt`, `anim-hand.txt`, `anim-deep.txt` |

**Round 3-5 probes.** All still run on today's code. Reused unchanged, all exit 0 (`old.status`, `old-*.txt`): `r4p-ret2`,
`r4p-oh`, `r4p-ohctx`, `r4p-nettake`, `r4p-lobfollow`, `r4p-backvol`, `r4p-dist`, `r4p2-whiff`, `r4p2-giveup`, `r4p2-vh`,
`r4p2-handoff`, `r5p-smreply`, `r3p-oh`, `r3p-oh2`, `r3p-backvol`, `r3p-nettake`, `r3p-lobfollow`, `r3p-ret`, `r3p-ret2`; also
the ones in the table. Adapted: `r5p-cap.mjs` as `r6/cap.mjs`, with a filter for the let-through moment and a fix for singles.

**Bot play.** The keyboard bot played the human side in real Chrome through the real input path. Seed 46 lost its browser
tab to a tool crash and was rerun on 49.

| Mode | Seed | Hits | Timing error p50 | Notes |
|---|---|---|---|---|
| Doubles | 44 | 10 of 10 | 2.8 ms | Won 3, lost 1 |
| Singles | 45 | 20 of 21 | 3.2 ms | One whiff, won 1, lost 3 |
| Singles, narrow | 49 | 21 of 21 | 4.3 ms | Won 1, lost 0 |

**Captures.** 39 frames and 6 contact sheets, not committed, in
`/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r6-pro/`. Real Chrome, seeds
41-50. Six images viewed. Stale banners from sim-jumping are set aside. Four planned let-through frames (d03-d06) weren't
found on that seed.

| Files | What they show |
|---|---|
| a01-a02 | Serve and return |
| a05, a06, a08, c01-c08 | Backhand; forehand and backhand volleys mid and low, prep and contact, from the side |
| a09-a12, c10-c12 | Bandeja, víbora, smash |
| a13-a15 | Wall forehand and backhand, lob |
| b01-b04, d01-d02 | A net player letting a ball past |
| b05-b08 | The formation at four moments |
| e01, e02 | Practice (Volleys) and Knock-out |
| f01-f02, g01-g02 | Singles on the standard and narrow courts |

## 2. Findings, ranked by impact

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Net players let reachable balls past and wait for the rebound.** A flat ball at chest height, inside racket reach, is the ball a net player is there for. If he lets it go he gives up the net and has to play it from deep. Here he steps aside, turns and runs back. An expert sees this inside a few games. It also feeds findings 2, 6 and 10. | **`letgo.ts`, 1500 points:** 727 flat balls (48.5 per 100 points) pass within 1.1 m of a net player, 0.35-1.7 m high, more than 0.3 s after the strike (p50 0.65 s, 55-60 km/h, 0.82-0.99 m high). **Played by nobody in the air and taken after the bounce: 466, 31 per 100 points.** Second range 310 of 1000 points. Level 0.5: 127 of 800. Ordinary volley balls among the 727 (under 90 km/h, 0.6-1.5 m): 35.3 per 100 points, 0.50/0.64/0.97 m off the body. **Taker's plan at that moment (`letgo2.ts`, 1200 points):** off the wall 305 of 436 (70%), contact 1.2 s later at 2.43/4.70/6.34 m from the net; partner had no plan 137 times. **Also** 500 off-glass balls (16.7 per 100 points) struck within 4.5 m of the net. **One case:** a topspin at 76 km/h, 1.35 m high, 0.4 m from a player at 3.1 m; he steps aside and plays it 2.3 s later, 1.62 m off the net, after it came back off the far glass. **History:** 59125d6 26.5, 413d837 28.9, now 31 per 100 points, all within noise of each other. So it was there at round 5 and isn't caused by its fix. **Published:** I know no let-through rate for net players. Volley share 26.4 (29.6), volley W 2.1 (3.4-5.7, Mellado-Arbelo 2019, SMF). **Code:** `src/sim/player/positioning.ts` `planStand`: the glass bonus and `heightCost` outweigh the volley, and `press` only acts on `b === 1`. Captures b01-b04, d01-d02. | A player inside the service line should not get the glass bonus on a ball inside reach unless it is going out. Glass waiting is for players behind the service line. Target: under 5 per 100 points. |
| 2 | High | **Points end on the smash, the volley has stopped finishing, and forced errors have halved.** Pros win most points by pressing from the net with volleys and bandejas until a smash or an error comes. Here half the winners are one stroke. The balance round 5 listed as holding is gone. | **Last shot of winners, four ranges:** smash 54.1/55.7/54.1/56.7 (43.0, Sánchez-Alcaraz 2022, SMF; round 5 43-47). Volley 14.4/14.4/14.1/16.6 (28.4; round 5 20-23.5). Bandeja + víbora 9.1/8.3/9.0/6.2 (12.7). **W/FE/UE:** 44.2/17.1/38.7, 44.7/16.9/38.5, 43.9/18.9/37.2, 44.6/18.8/36.6 (main draw 34-42/29-33/29-33, Conde-Ripoll 2025, SMF; round 5 36.9-37.7/25.7-26.0/36.3-37.4). **Per stroke:** smash W 56.6/56.2 (45.1), FE 5.7/7.8 (0.8); volley W 2.1 (3.4-5.7); bajada UE 11.0. **Net volleys v two back, 3000 points:** 0-0.6 m 40.3% of them, W 0.5; 0.6-0.88 m 35.1%, W 1.3; 0.88-1.1 m 12.4%, W 5.5; 1.1-1.4 m 9.1%, W 7.0, FE 11.6; 1.4-2 m 3.1%, W 4.8, FE 7.4. **The high ball isn't put away:** at or over 1.05 m n 821: lands in the service box or lanes 58.5%, side glass first 30%, 2.62 m from the nearest opponent, 72 km/h, W 3.7. **Zones (mine: under 4 m, 4-7, past 7):** winners 38.9/46.0/15.1 (56.6/32.1/10.6); errors 17.5/26.1/56.3 (26.6/30.6/42.0; Sánchez-Alcaraz 2022, SMF). **Cause:** e6123b0 and 413d837, R5 #1's fix, made smashes unreturnable, and findings 1 and 6 starve the volley. | Let more flat smashes sit up off the glass for a defender who has stepped aside, as finding 4 asks. Then make the high volley the put-away: aim at the feet and the open gap, from closer in. Targets: smash 43-47 of winners, volley 24-30, FE over 25, W under 42. |
| 3 | High | **Defenders watch soft balls die.** A ball that takes 1.7 s to bounce twice and passes within a step or two is chased at full speed by any pro. Here he waits for a glass it doesn't reach, then jogs. One point in seven ends this way. | **Double-bounce winners off a shot that is no smash or drop:** 15.3% of points (458 of 3000), 15.4% (308 of 2000), 14.8% (297 of 2000, `r4p2-giveup`). 83% touch a wall, at 0.24/0.54/0.69 m. Strike to second bounce 1.44/1.73/2.09 s. **Best defender:** moved 0.99/1.94/3.34 m, peak 2.48/3.25/4.49 m/s, ended 1.02/2.73/5.02 m away, 96% reachable at 4 m/s, 10% neither moved a metre. WPT top speed 4.2 m/s (Miralles 2025, `docs/realism.md`). **Cause (`die2.ts`):** plan at the first bounce is off the wall in 62%, not in time 59%, run left 0.22/1.23/3.46 m; `planStand`'s `y < 0.3` floor then has no contact left. One bandeja landed 0.6 m from a defender who stood still until 0.4 s after the bounce. **Strokes:** volley(air) 147 at 36/55/75 km/h, drive 92, slice 85, bandeja 53, víbora 49. **Handoff:** 94 cases (4.7%), taker never changed in 58. **History:** 13.8% at 59125d6, 15.7% at 413d837. | Go early to the ball whose wall contact will be too low. Replan once the first bounce shows it, and let the partner take over. Under 8% of points. |
| 4 | High | **Smashes are still answered on the rise.** A little better in kind: the defender no longer lobs or drives it. He still plays a stroke sooner than a human can react and prepare. Full strokes have become slices and contraparedes. | **3000 points, 1564 smashes:** no reply 914. 650 replies: on the rise 292 (44.9%), off a wall 247, in the air 110. **Against two back (n 1195):** 414 replies, **on the rise 291, 70.3%** (wanted under 15; round 5's own fix measured 65). 0.38/0.45/0.58 s after the strike, contact 0.40/0.74/1.21 m, ball 55/74/81 km/h, slice 57%, contrapared 38.8%, lob 1.4%, drive 1.7%. That is about one smash in four against two back. **Contrapared after a smash:** n 159, 0.53 s, error 18.9%. **Budget:** reaction 140-190 ms (Triolet, Mecheri, SMF), hitting phase 369-386 ms on wall shots and smashes (Espino 2015, SMF). **Smash result:** W 56.6, FE 5.7-7.8 (45.1, 0.8). | Same as round 5: step off the line and wait for the glass. Inside about 0.5 s a defender can only block, or be beaten. |
| 5 | High | **The forehand volley is square, straight-armed and racket-head down.** It is the most-played stroke in the game. A tour volley shows the shoulder turned, the elbow bent and the racket head above the hand, punched out in front. This one is a stiff arm held out to the side with the head drooping. On the owner's standard, real photos of real players, it fails at a glance. | **Mid-height forehand volley (`body.ts`, n 12):** contact 0.85 m; chest 3° to the net at contact, 19-23° 0.2 s before; ball 0.11 m ahead of the hips against 0.40 m on low volleys by the same measure (all volleys 0.38, Sánchez-Alcaraz 2021, SMF); 0.54-0.60 m out to the side; racket head 12-13° below level; elbow 32-36°. **Tour photos:** elbow 67° on a high volley (p11), 56° on a backhand volley (p09), racket head above the hand. Only two clear photos, both at higher contacts, so the elbow figure is thin; the look isn't. **All FH volleys:** chest p50 3°, p90 8-10. Backhand volley 63-67°. **Elbow 30.24° at contact** on `volley`, `volley low`, ground, low, lob, serve and smash: the IK clamp, not a pose (`game-p1.txt`). **Code:** `src/render/avatar/strokes.ts` `volley(f, name)` derives the volley by shrinking the forehand's keys, so it inherits its contact. Captures c01, c02, c03, a06. The backhand volley is side-on (c04, c05). | A forehand volley key of its own from the photos: shoulder turn 30-45°, elbow 60-70°, racket head above the wrist, contact 0.3-0.4 m in front. Loosen the IK clamp. Add it to animQa. |
| 6 | High | **The formation is on rails.** Real net pairs breathe: they close on a high ball, drop for a lob, and one comes in while the other holds. Here both stand on a line at 3.10 m whatever the opponent does. The depth doesn't change, so the contact doesn't, and volleys are struck low (R5 #17). It is what the whole net game is built on. | **Net pair at the opponents' strike (n 14,924), p5/25/50/75/95:** 3.09/3.10/3.10/3.18/4.72 m; stagger 0/0/0.02/0.55/1.71 m. The nearer net player is at 3.10 m whether the opponent strikes low or high. **Back pair:** 7.14/7.91/7.98/8.00/8.13 m, stagger 0/0.01/0.04/0.17/0.74 m. **Published:** third shot from 3.84 ± 0.91 m; "when one moves close to the net the partner drops back some metres" (Ramón-Llin 2019, 2021, SMF, qualitative). **Result:** net volleys (`r4p2-vh`, n 3843) 0.34/0.49/0.65/0.85/1.15 m, 76.9% below the tape (70.8 at round 4, 72.2 at round 5), 6.5% over 1.25 m. Tennis 3 m out 1.07-1.23 m (Chao 2008, SSM, an analogue). Incoming ball 1.23 m over the net, drops 0.59 m before contact at 2.71 m; 1 m closer is about 0.3 m higher. **Code:** `src/sim/player/formation.ts` `UP_Z` 3.1, `BACK_Z` 8.0; `DODGE` is the only lateral duty. Captures b05-b08. | Depth from the ball: close to about 2-2.5 m when the opponent is under pressure or struck low from deep, drop to 4 m when he can lob. Stagger the pair. |
| 7 | Medium | **The walls carry the errors.** | All walls 27.4 (19.0): back 15.5 (12.8), side 5.7 (2.7), double 6.2 (3.5). UE back 9.5 (5.4-6.3), double 13.8, side 5.6, ground 2.9 (4.6-5.8; Mellado-Arbelo 2019, SMF). Wall UE is 3.3× ground, pros 1.1×. Back + double + side make 54% of errors, about 30% derived from Mellado. | Shift errors from the glass to the ground. Fewer deep cross-courts into the corner. |
| 8 | Medium | **Beaten players still swing.** | 11.7 per 100 points (12.7 at round 5), 91% out of reach, ball 0.93/1.46/2.32 m away. Stand-downs 32.1 per 100 points. `old-r4p2-whiff.txt`. | Stand down when the ball will be beyond reach at the swing. |
| 9 | Medium | **Shin volleys from the back.** | Volleys from past 6 m 2.3% of shots, contact 0.16/0.59/1.50 m. `old-r4p-backvol.txt`, `q-misc.mjs`. | `holdShort` for any ball landing at the feet past 6 m. |
| 10 | Medium | **The serve's edge has the wrong shape.** | Serving pair by shots 1-2/3-4/5-6/7-8/9+: 72.3/68.6/67.7/68.8/56.3, 68.4/65.7/67.9/66.9/57.7, 76.0/64.7/68.9/66.8/54.5 (97.9/64.5/63.7/56.7/41.6, Ramón-Llin 2019, national, SMF). 2-shot points 6.6%, 27% of them return winners, slices through the middle at 71 km/h past the incoming server. Receivers win 1.8% of points in 1-2 shots. Overall 61-63 (62.5). | Follows from finding 1. A return past the server should need a real angle. |
| 11 | Medium | **El Muro loses to everyone, by more.** | 42.8 v Reloj, 40.0 v Martillo, 44.4 v Serpiente (about 3000 points each, ±1.8); round 5 44.4/45.4/45.6. Martillo, the smash-heavy style, gained: 52.2 v Reloj and v Serpiente. Net time Muro 26.5, Reloj 31.8. `h2h.txt`. | Give the wall what real wall players have: fewer errors off the glass. |
| 12 | Medium | **One key beats a mixed game.** | QA bot at level 1 by habit: slice 51.5 (4 of 6 matches), volley 50.2 (3 of 5), against mixed play 39.5 (0 of 9), drive 41.6, lob 38.9, topspin 37.4, drop 24.3 (±3.4). `human.txt`. My reading, not measured: the slice lives on finding 1, because net players let it through. Bot caveat: its timing is perfect. | Make low sliced balls an invitation to volley once finding 1 is fixed, then re-measure. |
| 13 | Medium | **Practice drills don't isolate their shot.** | Bot pressing the drill's key, 300 feeds. Back glass: played 74.3, back wall 75.3 of those, won 46.5 (round 5 51.7). Side glass: played 54.0, double wall 69.8, side wall 5.6, 83.7% reach the back glass, won 20.5 (29.8). Volleys: played 75, volley 63.6 of those, so 47.7% of feeds (44 at round 5), feed apex 1.34/2.07/6.93 m, won 38.9. Lobs: bandeja 81.6, bajada 18.0, won 37.5 (57.4), so the good drill got harder. `prac-follow.txt`. | Keep the Volleys feed under 3 m. Feed Side glass off one wall. Ease the Lobs drill's defence. |
| 14 | Medium | **Standard-court singles is short and open.** | n 800: 5.1 shots, 8.2 s, 61.3% double bounce, 15.6% of time at the net, 8.8% volleys, return winners 12.9%. QA bot 17.7/23.2/30.7/44.9 points won (level 1 to 0.2), 0 of 36 matches, whiffs about 30%: the human still has no recovery. `human.txt`. Capture f01. | As round 5: serve-and-volley behind deep serves only; a recovery for humans. |
| 15 | Medium | **On the narrow court the ball keeps leaving.** | n 800: 11.9 shots, 15.6 s, out 5.4 + exit 12.1 = 17.5% off the court (round 5 20.0), on the full 19.6, volleys 13.5% of errors, smash 26.6% of winners. Capture g01-g02. | Scale targets and angles to the 6 m width. |
| 16 | Medium | **Players hit their own side.** | `hit_body_own` 52 of 3000 = 1.7% of points (round 5 1.1-1.3, about 2 standard errors up). 37 are a new class: a smash bounces far side, comes back and hits a standing player of the hitter's pair, half the time the hitter himself (1.2 per 100 points). 14 inside 0.4 s, third-shot slices into a partner's back. | The pair moves off the rebound's line; the striker aims clear of his partner. |
| 17 | Medium | **Low groundstrokes are a squat, not a lunge.** Commit b9fcf4a went after this. The photos are still another shape. | Game groundstroke low: stance 0.98, knees 86/65°, trunk 41°. Four tour photos (p32, p37, p44, p73): stance 0.84-1.22, lead knee 27-63, other knee 19-43, trunk 34-54. Both game knees are outside every photo's range; trunk and stance are inside. The low volley is close to its one clear photo (p10): knees 77/36 against 78/23, trunk 45 against 41. Captures a05, a15. | A lunge: lead knee bends, back leg trails, chest over the knee. |
| 18 | Medium | **There is no left and right.** A padel pair is two roles: the left player finishes on the forehand overhead, the right player builds. Here the two sides are the same player. | Overheads in the middle L/R 50.5/49.5; volley forehands in the middle 51.6%, L/R 50.7/49.3; winners by side 676 v 666 (left 41.8, right 34.1, Conde-Ripoll 2025, SMF). Left-side return backhands 53.8 (over 75, Sánchez-Alcaraz 2020, SMF). | Give the left player the overheads in the middle and the right player the build. Style tables can carry it. |
| 19 | Medium | **The fight for the net has changed shape.** | Same probe, level 1: lob 48.7 and 49.1% of net takes (60.6, Muñoz 2017, SMF; round 5 61.0), bandeja 21-23 (14.0). Chiquita 0.5% of net takes, success 1% of 680, lob 17%. The chiquita is the textbook way in, and here it almost never gets there. | Follow a good chiquita to the net. Find why bandejas from both-back now take the net at 43% (32). |
| 20 | Medium | **Too many contraparedes, too many missed.** | In 20.4% of points (11-13), error 15.2% (4.7-7.7, Mellado-Arbelo 2019, SMF), W 0. Follows volleys 47%, smashes 25%: a stroke for a ball that beat you turned into an everyday reply. | Reserve it for balls past the player, and lower its error. |
| 21 | Medium | **Almost no play outside the court.** | Winners that leave the court after a bounce 13-15% of winners (17, Ramírez Ortega 2025, SMF). 0.5% of strokes are struck outside. FIP 14.2 allows the chase. | Stretch goal. |
| 22 | Medium | **The bottom of the ladder is short and unforced.** | Level 0.5: 6.5 shots, 8.6 s, W/FE/UE 25.9/21.3/52.8, volley UE 17, back wall 21.1, double wall 29.5, double faults 3.7. `stats-l05-1901.txt`. | Fewer first-ball errors. |
| 23 | Medium | **Women's rallies run long and thin.** | 13.4 shots, 18.8 s (14.4-16.2), 0.71 shots/s (0.73-0.75). W/FE/UE 35.8/18.5/45.6 (UE 35.5-37.5, Conde-Ripoll 2025, SMF). Serving pair 57.0 (48.5). `stats-women.txt`. | Trim the error table, and the rally with it. |
| 24 | Medium | **Almost everything is struck from a standstill.** | Hitter speed at contact p50 0, 76% under 0.1 m/s. Third shot after a flat return 0/0.57/1.17 m/s (1.98 on average, Ramón-Llin 2021, SSM). Pros volley, bandeja and approach moving forward. | Let approach shots and volleys be struck moving. |
| 25 | Medium | **Faces.** They read as stock MakeHuman: fine at play distance, plainly doll-like close up. The source's limit. Movement costs more realism than faces today, so I rank them below findings 1-6. The MetaHuman pilot stands. | Side close-ups c01-c12. Same as Critic R5 #10. | MetaHuman pilot. |
| 26 | Low | **Stretched low contacts.** | Racket over 0.25 m from the ball: forehand groundstroke 7% of 28, backhand 3% of 33 (round 5 18% of 34; small samples). Median 1.1 cm. | Leave it. |
| 27 | Low | **Serve direction ignores the side.** | Right side 61.1/11.6/27.2, left 62.6/11.6/25.7. Published: left 12% more to the glass, right 14% more to the T (Sánchez-Alcaraz 2020, SMF). | Small bias by side. |
| 28 | Low | **Server and receiver stand on one spot.** | Receiver 8.60 m, 2.50 m, p10 = p90. Server 7.20 m. | The same small range as the partners. |
| 29 | Low | **Too many forehands in places.** | Side wall 50 (33), volley 53.1 (44), groundstroke 54.7 (46; WPT 2014). | With finding 18. |
| 30 | Low | **Wall shots win a little too much.** | W 1.5-2.0 (under 1, SMF). Partly finding 3. | |
| 31 | Low | **Serves land short.** | 5.19/5.92/6.62 m from the net. Line at 6.95 m. | Aim deeper. |
| 32 | Low | **Odd frames.** | a08: a volley at 0.12 m folded over the ball. Legs through 2.7-3.6%, maximum 14.9 cm, mostly in ready stance (`anim-check.md`). | |
| 33 | Low | **Every glass serve is played off the glass.** | 97.8% of them; 51.5% of all returns off the side wall. Pros take some early. No published figure I can cite. | A few returns before the wall. |
| 34 | Low | **Rally a little long.** | 15.2 s, 11.4 shots at 0.74 shots/s (13.5-14.8 s, 10-11, 0.80; Martín-Miguel 2024, SMF). Follows from finding 1. | |

R5 #26 (split steps) and R5 #27 (match peak speed) I did not re-measure on round 5's terms. Peak per point is 3.00/4.29/4.74 m/s (4.2 for a match).

Things that hold up as padel, measured this round:
- **The serve.** Direction 61.9/11.6/26.5 (64.6/11.1/24.3), 67 km/h, first-serve faults 6.7-7.8 (men 7-10), double faults under 2%.
- **The return.** Lob 30.7% (34.7), errors 4.9 (5.4), flat ones played by the server 80.6% (71.9, a little high), lob apex 6.55 m.
- **The server's run.** 3.00 m/s (2.93 ± 0.43), 4.84 m from the net at the return (5.08 ± 0.58), moved 3.03 m (2.71 ± 0.58),
  third shot from 4.02 m (3.84 ± 0.91), return to third 0.84 s (0.86).
- **The overhead game.** 1.76 a point. Bandeja 47.9, víbora 24.8, smash 27.4 of them (tray 55.7, flat 26.6 + x3 9.8), bajada
  12.5 extra (7.9). In points: bandeja 46.1 (44-48), smash 36.5 (37-41), lob 81.0 (76-81). Choice by depth is right: under 4 m
  96-98% smash, 6-8 m 1%. Bandeja lands 8.28 m deep and reaches the glass at 0.64 m. Víbora 79 km/h against 71. Smash 132 km/h.
- **The lob.** 1.84 a point, apex 6.56 m, out 0.9% of points, better than round 5's 1.5-2.7.
- **Rally direction.** Cross/line 56.3/43.7 (57.5/42.5), middle 28.9.
- **Rhythm's shape.** Scaled to Courel's mean the rally shares read 24.5/25.1/20.7/29.7 (26.1/25.9/22.2/25.8), CV 0.82 (0.76).
  Zones 50.0/24.6/25.4 (49/19/26). Tracking 1.38 m/s.
- **The ladder is monotone.** 1 v 0.5 70.5, 1 v 0.75 63.1, 0.75 v 0.5 59.7, 0.8 v 0.55 58.1. Knock-out climbs club, advanced, pro.
- **Styles are legible.** Muro 12.4 shots a point, Martillo 9.5, Serpiente 12.1.
- **The body in the overhead.** Bandeja stance 1.07 against 0.99, hips 0.84 against 0.85, trunk 14 against 6, elbow 58 against
  47, chest side-on 56-59°. Captures c10-c12 read right. The one smash photo has straighter knees, 15/11 against 70/2 (n 1). Backhand side-on 66-79°.
- **The return's body** (a02). **Racket to ball** p50 1.1 cm, p90 2.5-2.7, lag 0-8 ms, pops 14-17 per minute.
- **The input.** Bot play grades exact, 2.8-4.3 ms p50.

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **NEW** | Round 5's "let-through ... holds" looked at balls past the service line, never at net players. R4 #17 and R5 #10 are about chasing after, not the volley not made. It was already there at 59125d6. |
| 2 | **REGRESSION**, caused by R5 #1's fix | Round 5 listed smash 43-47 and W/FE/UE under what holds. REPEAT in part of R5 #21 and R4 #19, now worse. REVIEW.md's R5 #1 row printed W 58.7 and said nothing of the volley. |
| 3 | **REPEAT R5 #10, R4 #17, raised from Medium** | Blind High. 15% of points, and the cause is now measured. |
| 4 | **REPEAT R5 #1** | Still High. Not in my blind draft. Smaller in kind: full strokes are gone. |
| 5 | **REPEAT R5 #19, R4 #22, raised from Medium** | Blind High, on the owner's photo standard, which is new this round. |
| 6 | **REPEAT R5 #6 and #17, raised from Medium** | Blind High. It is the cause of the low volley and starves finding 2. |
| 7 | **REPEAT R5 #7, R1 #3** | |
| 8 | **REPEAT R5 #8, R4 #16** | |
| 9 | **REPEAT R5 #9** | |
| 10 | **REPEAT R5 #11, R4 #12** | The return-winner class is explained by finding 1. |
| 11 | **REPEAT R5 #12, worse** | |
| 12 | **NEW** | Round 5 printed slice 49.7 under "No one-key exploit" but had no mixed baseline beside it. |
| 13 | **REPEAT R5 #13** | Volleys drill unchanged, Lobs drill harder. |
| 14 | **REPEAT R5 #14** | |
| 15 | **REPEAT R5 #15** | |
| 16 | **REPEAT R5 #16, worse**; the came-back class is NEW | |
| 17 | **NEW** | Judged on the photo standard. R5 #18 was about reach. |
| 18 | **REPEAT R5 #24, raised from Low** | Blind Medium. Side roles are NEW. |
| 19 | **NEW** | R3 #3's lob share has fallen, see below. |
| 20 | **NEW** | Round 5 printed 15.5 under what holds; 20.4 no longer does. |
| 21 | **REPEAT R5 #20** | |
| 22 | **REPEAT R5 #22** | |
| 23 | **NEW**, follows R5 #5's fix | |
| 24 | **REPEAT R5 #4 (rest), R4 #23** | |
| 25 | **REPEAT Critic R5 #10** | Ranked here against my list only. |
| 26 | **REPEAT R5 #18, lowered to Low** | The number fell, on small samples. |
| 27 | **NEW** | |
| 28 | **REPEAT R5 #23** | |
| 29 | **REPEAT R5 #24** (rest) | |
| 30 | **REPEAT R5 #25** | |
| 31 | **REPEAT R5 #28** | |
| 32 | **REPEAT R5 #29** | |
| 33-34 | **NEW** | |

No finding is Critical. One High is NEW and one is a REGRESSION, so by the loop's rule it goes on.

### Round 5's statuses: which don't hold

- **R5 #2, "Fixed", net volleys run backwards: fixed for the inversion only.** The table turned round: at or over 0.95 m n 1258 W
  6.6 L 1.9; under 0.55 m n 2100 W 0.4 L 6.3. But its own targets missed: the chiquita's reply err is 3.0 against its own 4.3
  (wanted above), and errors by zone are 17.5/26.1/56.3 against the 27/31/42 wanted. Volley finishing fell (finding 2).
- **Round 5's "holds up" on endings: no longer.** Smash 43-47 is 54-57. W/FE/UE is 44/17-19/37-39. Rhythm 14.3 s is 15.2 s.
- **R4 #19, "Better", W/FE/UE: regressed.** FE 25.7 at round 5, now 17-19.
- **R4 #12, "Better: 75-82", then 74.8-76.3:** now 68.4-76.0.
- **R3 #3, "lob 61-70% of net-takes":** 48.7 on `r4p-nettake`, which gave round 5 61.0, and 49.1 on `r3p-nettake` (60.6).
- **R4 #20, "fixed at a price", El Muro 4-6 points:** the price is now 5.6-10 points.
- **Round 5's "No one-key exploit":** thin. Slice is 12 points above mixed play at the top level (finding 12).
- **Round 5's "contrapared 15.5 (11-13)" under what holds:** 20.4.
- **R5 #13, "Bandeja elbow still 100 against 47":** stale in the good direction. It is 55-58 since b536d6f.
- **R1 #3, walls:** 27.4 against 19.0. Still short.

### Statuses that hold, with a cost or a limit

- **R5 #1, "Better. Still High":** holds. Replies on the rise 65 → 70% against two back, within noise, but full strokes are gone.
  The cost is finding 2.
- **R5 #4, "Better":** third from 4.02 m. The third is still struck at 0.57 m/s (1.98).
- **R5 #5, "Better":** winners 74.1/18.1/2.7 + body 5.1 (76.9/11.8/11.3), first faults 10.4, serving pair 57.0 (48.5). New long
  rallies (finding 23).
- **R4 #4, "Fixed":** bandeja volleyed 11%, holds for bandejas. Not for shins (finding 9), and not at the net (finding 1).
- **R4 #6, "Better":** singles unchanged, 5.1 shots.
- **R4 #11, "Fixed":** back glass 15.5%, true of the back glass only.

### Statuses that hold

- **R5 #3, "Fixed":** 0.9% of points, better than the claim.
- **R4 #1:** cross/line 56.3/43.7. **R4 #2:** drop 0.049 a point, W 31. **R4 #3:** side glass 61.9. **R4 #5:** on the full 9.6% of points, side
  glass 6.4%, on the standard court. **R4 #18:** víbora 79 against 71.
- **R5 #6-22 and #23-29, "Open":** all open, as marked above. #18 has eased; #26 and #27 weren't re-measured.
- **R2 #6, R3 #12, closed by round 4:** the shape still fits when scaled. Lobs in 81.0% of points.
