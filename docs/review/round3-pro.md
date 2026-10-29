# Review round 3: the professional player

I wrote this blind. First I played and measured the game from scratch and drafted every way it falls short of
professional padel. Only then did I read REVIEW.md to mark each finding NEW, REPEAT or REGRESSION. No code or data
was changed for this review.

## 1. How I reviewed

- **Code:** branch phase9 at 875fa99. The sim was unchanged by 830a641, which only added docs.
- **Levels:** level 1 (the "Pro" difficulty) unless I say otherwise. Level 0.55 is the game's default ("Club").
- **Headless measurement:** all AI doubles unless marked singles. Every probe below is a scratch script in `tools/out/`.

| Tool | Run | Output |
|---|---|---|
| `node tools/match-stats.ts` | `--points 2000 --level 1 --workers 4 --seed0 901` | `tools/out/r3p-stats-l1.txt` |
| `node tools/match-stats.ts` | `--points 1000 --level 0.5 --seed0 901` | `r3p-stats-l05.txt` |
| match-stats, styles head to head | `--styles muro,martillo,muro,martillo` and `serpiente,reloj,…` | `r3p-stats-muro-martillo.txt`, `r3p-stats-serp-reloj.txt` |
| match-stats, each style against the neutral one | `muro,reloj,…` and `martillo,reloj,…` | `r3p-stats-*-vs-reloj.txt` |
| `node tools/point-mix.ts` | `24 300` and `12 300 singles` (the tool's default level, 0.55) | `r3p-mix-d.txt`, `r3p-mix-s.txt` |
| `node tools/anim-check.ts` | `r3p 120 3` | `tools/out/r3p-anim-check.md` (moved out of docs/lab) |
| `tools/out/r3-baj-anim.ts` | `150 3 901` | `r3p-anim-cls.txt` |
| `r3p-anim-hand.ts` (the same probe split into forehand and backhand) | `240 4 901` | `r3p-anim-hand.txt` |
| `r3p-probe.ts` (serve, return, third shot, speeds, lobs, overheads, walls, rhythm, volley depth) | 1500 points at level 1, seeds 901-910 | `r3p-probe-l1.txt` |
| r3p-probe.ts, singles | standard court; narrow court via `r3p-probe-court.ts` | `r3p-probe-singles.txt` |
| `r3p-ret2.ts` (who plays the third shot after each kind of return) | 1200 returns at level 1, 800 at 0.55 | console |
| `r3p-oh.ts` / `r3p-oh2.ts` (after an overhead: positions, reply time, replies volleyed, predicted landing) | | console |
| `r3p-backvol.ts` (volleys struck more than 6 m from the net) | | console |
| `r3p-nettake.ts` (which shot takes a pair from both-back to both-up) | | console |
| `r3p-lobfollow.ts` (lobs that get past a net pair: do the lobbers come in?) | | console |

- **Captures:** 19 frames in the scratchpad `r3-pro/` folder, not committed. They were taken with
  `tools/out/r3p-cap.mjs` on the dev server, `?autoplay=1&seed=905&ai=1`. The script finds each moment with a ghost
  MatchSim built from the page's own config, then steps the real game to that tick (the event times matched to the
  tick). Views: TV is the broadcast camera; front, side and behind are 3.4-3.6 m from the player.

| File | What it shows |
|---|---|
| r3p-01-serve-tv | Serve formation |
| r3p-02-return-tv | Return contact: server already in at 3.8 m |
| r3p-03-lobapex-tv | A lob at its 8.2 m apex |
| r3p-04-bandeja-volleyed-tv, r3p-05-bandeja-volleyed-front | A defender at 8.1 m volleying a bandeja at 0.31 m |
| r3p-06/07/08-bh-ground-* | Backhand lob return: backswing, contact front, contact behind |
| r3p-09-fh-backwall-behind | Forehand off the back glass |
| r3p-10-bh-backwall-behind | Backhand slice off the back glass |
| r3p-11-bandeja-side, r3p-12-vibora-side | Bandeja and víbora contacts |
| r3p-13-smash-side, r3p-14-smash-pre | Smash contact and trophy position |
| r3p-15-netvolley-front, r3p-20-bh-volley-net-front | Volleys |
| r3p-16-split-front | Receiver's split step |
| r3p-17/18-return-to-netman-* | A flat return played straight to the server's partner at the net |

## 2. Findings, ranked by impact

Pro figures come from what `tools/match-stats.ts` prints beside each number, plus `docs/research/*.md`. Each cell
names its source.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Back-court defenders volley deep bandejas off their shins instead of letting them come off the glass.** Defending a bandeja is a glass shot: the ball lands deep, sits down off the back glass, and the defender lobs or plays low from there. Here the defender stands at the back and takes it on the full at knee height, before the bounce. That speeds the reply up, so the bandeja player can't get back to the net. It also produces "volley" net-takes from 7 m. | **Bandeja replies (level 1, n 1122):** 58.3% are taken before the bounce, from a median 7.03 m from the net (p90 7.47) at a median 0.62 m high. Those balls would have landed 8.35 m deep. Level 0.55 is the same: 56.6%, 7.02 m, 0.63 m. The probe is `r3p-oh2.ts`. **Volleys from the back:** volleys struck more than 6 m out are 6.5% of all shots and 17.4% of all volleys, at a median 0.50 m high (p25 0.29). 42% of them answer a bandeja and 24% a lob (`r3p-backvol.ts`). **Effect:** the reply comes 0.86 s after a bandeja, against 1.26 s after a víbora. At the reply the bandeja hitter is within 5 m of the net only 56% of the time (víbora 84%; `r3p-oh.ts`). These back-court volleys make 31.7% of all net-takes from both-back (`r3p-nettake.ts`). **Pros:** groundstrokes before the glass are 23.1% of shots and back-wall shots 12.8% (WPT men 2014, match-stats). There is no class for volleys from the back because pros barely play them. **Captures:** r3p-04, r3p-05 (a forehand drop volley at 0.31 m from 8.1 m). **Cause:** `data/ai-skill.json:21` sets `glassWait` to 0, which zeroes both glass terms in `positioning.ts:207-209` for every AI player. The planner's pace and time cost applies only after a bounce (`positioning.ts:195-200`), so the only thing against a back-court volley is a flat +0.4 (`positioning.ts:210-211`). | Give the AI back a glass preference for balls that will land within about 2 m of the back glass. Alternatively, cost a before-the-bounce contact below about 0.8 m when the player is more than 6 m out. Hold the back-wall share down some other way (defenders standing a little deeper, the bajada), not by banning the glass. Target: under 10% of bandeja replies taken on the full from the back. |
| 2 | High | **Returns go at the net player, not the incoming server.** With the server running in, the return goes to the server's feet or over the net player as a lob. The AI's flat returns go to the man already at the net, who volleys them. | **Who plays the third shot after a flat return (level 1, n 1200 returns):** the server's partner 41.8% of all returns, the server 25.0%. That is 60% of flat returns played by the partner. At level 0.55 it is 49.9% against 18.3%. The flat return passes nearer the partner 37.2% of the time and nearer the server 16.2% (`r3p-ret2.ts`). **Pros:** flat returns go at the server 71.9% of the time (national, Ramón-Llin et al. 2019, `docs/research/shots-movement-feel.md` §3). **Code:** `simpleAi.ts:924-928`, the target against one up and one back: half go to the net player's feet, half deep on the net player's side. The comment says "the back player's corner", but `x = back.pos.x > 0 ? -spread*0.7 : …` puts the ball deep behind the net player. **Captures:** r3p-18, then r3p-17 (the return heading for the near-right net player, who volleys it). | When the receiver chooses against a server coming in, play low cross-court at the server's feet or through the middle, or lob over the net player. Go to the net player only with a chiquita or a rare down-the-line pass. Target: about 70% of flat returns played by the server. |
| 3 | High | **The lob doesn't swap the roles.** In padel the lob is how a pair takes the net: when it gets past the net players, the lobbers run in while the others turn for the glass. Here, after a lob that gets past, the lobbers mostly stay at the back. | **Net-takes from both-back (level 1, n 537):** the lob makes 19.2% of them. Pros: 60.6% (Muñoz et al. 2017, as cited at `simpleAi.ts:805`). Of 2,040 lobs played from both-back, 5% leave the pair both up at the reply (`r3p-nettake.ts`). **Lobs that got past a net pair:** these were let bounce and played back 3.44 s later (median). At that reply both lobbers are within 5 m of the net only 27.2% of the time, and the deeper lobber is at a median 5.97 m (`r3p-lobfollow.ts`, n 412). All four players are at the back 11.1% of rally time (match-stats). **Code:** `formation.ts:103-121`. `deepLob` follows only a lob landing within `LOB_BEATS` (2.0 m) of the back glass, and only while no opponent is planning a volley. | Follow any lob the net players can't take in the air. Judge it as they turn and run (their plan is after the bounce or off the glass), not by its landing depth. Step up to the transition zone on every lob and go all the way in once they are running back. Measure the lob's share of net-takes. |
| 4 | High | **Backhands, and shots off the back glass, are struck square to the net.** A padel backhand is played side-on, with the racket-side shoulder to the net and the feet across. A ball off the back glass is played side-on beside the front foot. Here the body faces the net at contact, often in an open stance, so it looks like a push. | **Shoulder line against the net at contact** (`r3p-anim-hand.ts`, 4 seeds × 240 s; 0° = chest to the net). Every class has the body's root yaw at 0-8° p50, square to the net. **Pros:** the research notes have the back-wall exit played "side-on as the ball passes to the glass, then move forward with the rebound and hit in front" (`docs/research/serve-and-strokes-motion.md` §4.2), and give 0-30° at contact only for the forehand drive (§4.2, from tennis). Nothing in the notes supports a backhand contact at 20°. **Code:** `strokes.ts:73-76` (`BACKHAND` contact yaw 0.35 rad, 20°), and `avatar.ts:1455-1487`, which squares every stroke's stance to the net. **Captures:** r3p-10 (backhand slice off the back glass: back flat to the camera, shoulders parallel to the net, feet square) and r3p-09 (forehand lob off the glass, the same). | A backhand contact key with the shoulders about 70-90° turned and a neutral or closed step. Keep the wall turn (`WALL_TURN`) through contact for back-glass shots, so they are hit side-on beside the front foot. Add a backhand threshold to animQa's chest-at-contact check. |
| 5 | Medium | **Too few short points; long ones dominate.** Pros have plenty of 1-4 s points: return errors, a server's volley winner, a smash off a short lob. The AI's points almost all grind on. | **Rally length at level 1** (1-4 s / 5-7 / 8-11 / over 11): 13.1 / 18.0 / 20.3 / 48.6%, against pros' 26 / 26 / 22 / 26. **Points of 1-2 shots:** 4.3%. **Shots a point:** median 8, p90 24 (`r3p-probe-l1.txt`). The mean is in the pros' band (11.3 shots, 14.6 s), but the shape is wrong. **Trend of 1-4 s points in REVIEW.md's files:** 15.8% (round 1 before), 17.0% (round 1 after), 14.9% (round 2 fix 7), 13.1% now. | Mostly downstream of #1 and #3: back-court volleys and lobbers who stay back keep defenders alive. Add pressure on the third shot (the server's volley to the feet or the open court) and re-measure the 1-4 s share. |
| 6 | Medium | **The serve is a soft placement to the middle.** Pros serve about two in three to the side glass, with slice. | **Direction (level 1, n 1500):** side glass 31.9%, T 34.1%, middle 34.0%. WPT men: 64.6 / 24.3 / 11.1 (Sánchez-Alcaraz et al. 2020, Appl Sci). **Speed:** median 64.9 km/h (p10 58.9, p90 72.9). Open-category amateur men: 70.0 ± 6.6 (Sánchez-Pay et al. 2023). **Faults:** first-serve faults 5.0% (match-stats) and 6.0% (probe), against 7.1% (WPT 2019) or 10.6% (WPT 2014). Double faults 0 of 101 second serves (pros 2.1%). **Serving pair wins:** 66.2%, against 62.5%. **Code:** `simpleAi.ts:204-225`. Only 35% of first serves go wide and no second serve does. The rest go to the T (0.6-0.8 m off the centre line) or to the middle of the box. | Send most serves into the side glass (about 65%, more on the left side), with a few to the T and the body. First serves a little faster than a club player's (75-80 km/h) with more risk; a small double-fault rate. |
| 7 | Medium | **The víbora is a slower, lower bandeja.** The víbora is the attacking overhead: more pace and sidespin than the bandeja, into the side glass. The AI's is slower than its bandeja and struck at head height with the racket still cocked behind the head. | **Speed off the racket at level 1:** víbora median 64.7 km/h (n 507), bandeja 70.7 (n 1159), smash 130.4. **Contact height:** víbora 1.69 m (p10 1.59), bandeja 1.93 m (`r3p-probe-l1.txt`). This is a little above the notes' derived 1.55-1.85 m band; the height is defensible but the pace is not. **Shot data:** `data/shots.json` gives the víbora the higher face-speed cap (25.2 against 20.7 m/s), but the spin takes it. **Capture:** r3p-12, at contact with the racket beside and behind the head and the elbow up. | Solve the víbora for more pace than the bandeja (target its speed, not only its cap), and move its contact out to the racket side with the arm extending through the ball. |
| 8 | Medium | **The styles' net trait doesn't show.** "El Muro" (net 0.6, stays back) spends more time at the net than its opponents. "Martillo" (net 1.6) is barely ahead of the neutral style. | **Net time, level 1, 1,200-1,500 points each:** Muro 38.1% against Relojero 33.9%; Martillo 40.9% against Relojero 38.2%; head to head, Muro 40.8% against Martillo 33.1%. Muro also volleys more than Martillo (37.8 against 28.8% of shots). The other traits do show: Muro lobs 20.7-21.3% of shots, Martillo smashes 46-48% of its overheads, Serpiente plays the víbora in 62% of its overheads (`r3p-stats-*.txt`). | Tie the net trait to what decides net time in play: Muro shouldn't follow its own lobs in, and Martillo should follow its drives and chiquitas in. Check the style signatures head to head, not only against the neutral style. |
| 9 | Medium | **Points still end the wrong way.** Too many volley winners and net errors; too few long errors, forced errors, and bandeja or víbora winners; too many errors off the glass. | **Errors:** net 58.1 / back glass on the full 17.3 / side 12.0%. Pros: 51 / 28 / 17. **Endings:** forced errors 25.5% (pros 29-33). **Last shot of winners:** volley 39.6% (pros 28.4); bandeja and víbora 5.7% (pros 12.7, Sánchez-Alcaraz et al. 2022). **Unforced errors per stroke:** back-wall 8.9%, double-wall 13.5%, side-wall 8.2%; pros 5-6% for groundstrokes and back-wall shots (match-stats header). | Part follows from #1: deep bandejas played off the glass are bandejas that force errors. Put more of the AI's pace errors into length and fewer into the net. Lower the error spread on clean back-glass balls. |
| 10 | Medium | **Singles is a glass-hitting contest.** Nobody serves and volleys, and a third to a half of points end with a ball into the glass on the full. Singles is in the setup menu (`app.ts:236`). | **Standard court, level 1:** 35.6% of points end `wall_before_bounce`. The median point is 4 shots. The server is still 7.60 m back when the return is struck and plays the third shot from 6.64 m. Volleys are taken at a median 6.55 m. Return to third shot takes 1.99 s (`r3p-probe-singles.txt`). **Narrow court:** wall before bounce 49.5%, median 5 shots. **Level 0.55, standard court:** 31.5% wall before bounce, median 3 shots (`r3p-mix-s.txt`). There is no FIP singles benchmark, so this is judged as padel. | Give singles its own targets: depth margins from the back glass, and a server who comes in behind a deep serve. Treat a drive at the glass on the full as a choice error the AI avoids. |
| 11 | Low | **No play outside the court.** After a smash *por tres* or *por cuatro*, a defender may chase the ball out through the door and play it back; pros do it a few times a match. Here the point ends when the ball leaves. | 3.9% of points end `exit_after_bounce` at level 1 (`r3p-probe-l1.txt`). **Code:** `rally.ts:251-263`. | (Stretch goal in CLAUDE.md.) |
| 12 | Low | **Serve-time positions never vary.** | At every serve the server's partner stands at 2.60 m from the net, \|x\| 2.50 (p10 = p90). The receiver's partner stands at 7.60 m. Many pros stand on or just inside the service line and vary the net player's spot. | Draw the net player's depth and width from a small range, and allow the receiver's partner forward of the service line. |
| 13 | Low | **Lobs a little scarce.** | 15.9% of shots, against about 20% for elite men (2013, match-stats). | |
| 14 | Low | **The thighs pass through each other in stance.** | Legs clip in 2.7-3.0% of frames, worst 14.7 cm (thigh against thigh). The neck turns faster than people can: 460-578 frames over 1.25 times the limit per seed (`r3p-anim-check.md`). | |

Things that hold up as padel, measured this round:
- **Rhythm:** 1.27 s between shots (pros about 1.25) and 0.92 s from return to third shot (national 0.86).
- **Volleys:** the median volley is struck 2.86 m from the net.
- **Overheads:** lobs against a net pair are taken overhead 84% of the time. The smash is 27% of overheads, at a median 130 km/h, a winner 36% of the time with an error rate of 3%.
- **Share of points each stroke appears in:** bandeja 43.6% (WPT 44-48), bajada 14.0% (14-17), contrapared 12.9% (11-13), lob 80.7% (76-81).
- **Where shots are hit from:** back / transition / net 49.9 / 19.5 / 30.6% (pros 49 / 19 / 26).
- **Level ladder:** level 0.5 plays 6.5 shots a point with 51.7% unforced errors.
- **Overhead stances:** the smash's trophy position (r3p-14) and the bandeja's side-on contact (chest 53° from the net) look right.

## 3. Against REVIEW.md

### Each finding marked

| # | Mark | Why |
|---|---|---|
| 1 | **NEW, caused by a fix** | Round-1 #3's "Fixed for the AI" set the AI's `glassWait` to 0. That traded balls off the glass for shin-high volleys from the back. Round-1 #3's back-wall share is now 16.7% (pros 12.8). |
| 2 | **NEW** | |
| 3 | **NEW** | |
| 4 | **NEW** | Round-2 #4 covered the overheads only, and its numbers still hold: bandeja 53°, víbora 39°, smash 2° at contact. |
| 5 | **REPEAT** | Round-1 #5 and round-2 #6. The short-point share regressed (see below). |
| 6 | **NEW**, with **REPEAT** of round-1 #8 and round-2 #13 for the faults | Direction and speed are new. Faults repeat round-1 #8 and round-2 #13. |
| 7 | **NEW** | It touches round-2 #4, whose víbora "own key" holds as a chest angle; the pace and contact pose are new. |
| 8 | **NEW** | |
| 9 | **REPEAT** | Round-1 #6 and round-2 #3. The bandeja and víbora winner share (docs/ai.md "known gaps") is new to REVIEW.md. |
| 10 | **NEW** | |
| 11 | **REPEAT** | Round-1 #9. |
| 12 | **NEW** | |
| 13 | **REPEAT** | Round-1 #13. |
| 14 | **NEW** | |

### Round-1 and round-2 statuses that my measurements don't support

- **Round-2 #6, "Fixed with 2-3", rallies drag: not fixed, and short points regressed.** Over 11 s: 48.6% now,
  against 50.2 / 48.9 / 47.6% in the earlier files. Points of 1-4 s fell to 13.1%, from 17.0% (round 1 after) and
  14.9% (round 2 fix 7). The pros are at 26%. This is also round-1 #5's "Better".
- **Round-1 #8, "Better", serve faults: doesn't hold.** First-serve faults went 6.2% → 7.2% (the "Better") → 4.9%
  (round 2 fix 7) → 5.0% now. Double faults are 0 of 101 (0 of 146 and 0 of 100 before), against the pros' 2%.
  Round-2 #13's "Open" is accurate. The serving pair now wins 66.2% (61.1% in round 1), above the pros' 62.5%.
- **Round-1 #3, "Fixed for the AI", too much off the back glass: the number is better (16.7% against 12.8%), but
  the fix created finding #1.** Back-wall shots still appear in 70.2% of points.
- **Round-2 #3, "Better", how points end: partly holds.**
  - Holds: body winners are 6.7% of winners (was 9.2%), and net errors 58.1% (was 60%).
  - Doesn't hold: the volley's share of winners is 39.6%, no better than the 38% the status claimed. Errors on the
    full into the back glass are 17.3%, where round 2 had 14.9-18.4%. Forced errors are 25.5%, where round 2 had 26%.
- **Round-2 #2, "Fixed", the overhead game: holds.** Lobs against a net pair are taken overhead 84.4% of the time.
  The bandeja appears in 43.6% of points. The smash is the last shot of 41.3% of winners. Out-of-court winners are
  10.7% of winners. The remaining gap (bandeja and víbora as winners, 5.7% against 12.7%) is in #9 above.
- **Round-2 #4, "Fixed", the overhead stances: holds as measured.**
  - Measured: bandeja 53°, víbora 39-40°, smash 2-5° at contact.
  - But: the víbora's contact capture (r3p-12) shows the racket still cocked behind the head (#7).
- **Round-2 #7, "Fixed at the cause", bajada racket misses: can't confirm.** Only 3 bajadas fell in my animation sample
  (racket to ball 0.051 m), too few to judge either way.
