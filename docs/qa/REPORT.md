# Phase 7: rules and QA report

What the QA army found in the game, what was fixed, and what is left. Every fix has a regression test in
`tests/qa/regressions.test.ts`; the commands that reproduce each finding are in the army reports beside this file.

## How the game was tested

- **Rules oracles.** A referee and a scorer written from the FIP text alone (*Rules of Padel*, application
  01.01.2026, `scratch/qa/fip-rules.txt`), without reading the game's rules code: `tools/qa/refereeOracle.ts`,
  `tools/qa/scoreOracle.ts`. Where the text is ambiguous or silent, the reading the oracles use, and why, is in
  `tools/qa/ORACLE-NOTES.md` (44 readings). They have their own tests (`tests/qa/oracle.test.ts`). Every call the
  game makes (point, fault, let, score, server, receiver, box, ends, tie-break, deciding point) is judged again by
  them from the facts of the rally (strikes, bounces, walls, the net, bodies, exits), and any disagreement is logged
  with the facts and a command that replays it.
- **The match army.** `node --expose-gc tools/qa/army.ts --matches 2000 --workers 7`: headless matches drawn across
  every mode (singles, doubles), court (standard, panoramic, narrow singles), floor, ball (standard, altitude),
  climate (temperature, altitude, wind), scoring format (advantage, golden point, star point; best of one or
  three; 4- or 6-game sets; normal, no tie-break, match tie-break to 7 or 10), AI level and style, left- and
  right-handers, with three kinds of player: the AI; "bots" (the human code path played well: keys pressed ahead of
  the ball and let go on the cue's moment); and "monkeys" (random keys, holds, mashing, stale timestamps, aim
  anywhere). Every tick is checked (`tools/qa/checks.ts`): the ball in a wall, under the floor, through the net,
  tunnelling, too fast, spinning too fast, too high, gaining energy, stuck; a player out of bounds, too fast,
  accelerating too hard, partners inside each other; a toss, setup or dead ball that never ends; a rally or match
  that never ends; NaN anywhere; crashes; slow ticks; the heap after each match.
- **The animation army.** `node tools/qa/anim-army.ts --configs 60 --secs 90`: the same mix of matches and players
  driving the animated bodies, judged on the Phase 3 thresholds (`tests/render/animQa.test.ts`): skating, planted
  feet, soles under the floor, racket to ball at contact, pops, joint speeds, one-frame flips, knee spins,
  racket in the body, hand in the torso, legs through each other, and the serve on its own.
- **The browser soak.** `bash tools/one-chrome.sh node tools/soak.mjs 20`: the built game in Chrome, AI doubles
  for 20 minutes, sampled every 30 s for the JS heap after a forced collection, DOM nodes, listeners, three's live
  geometries and textures, frame times and errors.

## Found and fixed

### Rules

| # | What the army found | How | Fix |
|---|---|---|---|
| 1 | A swing that missed the serve wasn't a fault (FIP 7.1.b: an attempt to hit is the serve, 6.6). | referee oracle | `onServeMissed` on a whiff at the release or the contact. |
| 2 | A dropped ball nobody swung at, bouncing twice, was a fault. It isn't a serve at all (6.6). | referee oracle | The server picks it up and drops it again (`retoss`). |
| 3 | A serve off the net that then touched a player (receiver or server's partner) wasn't a let (9.1.b). | referee oracle | `onBody` replays it. |
| 4 | A net cord rolling over the tape stayed on the hitter's side for up to 20 ticks past the net. | through-net check | The side changes when the centre passes over the cable's centre line. |
| 5 | The server's partner could hit the ball the server had dropped: the point was played with no serve. | referee oracle (13.1.q) | Before the serve only the server plays the ball. |
| 6 | **The corner.** A ball 2.7 cm off the floor at the opponents' glass, on the floor 8 ms later, lost the point as "hit the wall before bouncing"; 86 calls in 200 matches. FIP 14.1.i: a ball in "the angle where the wall joins the ground" is good. Serves into the box's corner with the side glass too. | referee oracle | A glass touch with the ball's centre at most 6 cm up counts as the bounce (`Rally.cornerY`); the floor touch right after it is the same bounce. |
| 7 | A serve whose centre was 3-5 cm past the net's plane when it met the tape was played on instead of replayed (9.1.a). | referee oracle | A net touch before the bounce counts on either side of the plane. |
| 8 | In a one-set match, "final set: no tie-break" applied (there is no final set) while "final set: match tie-break" didn't. | score oracle | The final-set rule needs a deciding set (`setsToWin >= 2`). The menu only offers the normal final set today. |
| 9 | A partner walking into the server before the serve pushed them 45 cm forward, the ball in hand with them, and the serve dropped inside the service line was played (6.2). | referee oracle (7.1.a) | The server stands still before the serve and the partner gives way; a drop or a contact over the service line or the centre line is a fault (`WHY_SERVE_AREA`). |

### Physics

| # | What the army found | How | Fix |
|---|---|---|---|
| 10 | A smash driven into the top of the net climbed out of its pocket past the cable's centre line and changed sides while the netting still held it. | through-net check | The ball's side doesn't change while the netting grips it. |
| 11 | **A ball through the net.** A 4.6 m/s wind billowed the bottom of the sleeping net 12 cm out. A drive at 0.32 m and 14.5 m/s was already past the netting when it came within the 4 cm a sleeping net was coupled at, and went through. 8 of 64 such drives in the test. | through-net check | The ball is coupled to a sleeping net within the net's measured bulge (`NetCloth.bulge`). |

### Animation

| # | What the animation army found | Fix |
|---|---|---|
| 12 | Singles legs passed through each other on a side-on run. | Side-on run with a warp offset and forced inertialization on the switch. |
| 13 | The racket arm switched off at a ready weight of 0.01: a 66° pop. | The arm fades to its clip over `ARM_FADE`. |
| 14 | An out-of-reach contact flipped the arm 118°. | The contact is pulled in to reach (`CON_REACH`). |
| 15 | The AI's contact target jumped when its early release was replanned (82°). | The planned contact uses the ideal release. |
| 16 | The elbow straightened 99° in a frame when a push out of the body let go. | The push dies away linearly; the elbow bends no faster than 1.8× a serve's forearm peak. |
| 17 | The elbow snapped straight at full reach (31° in a frame: near straight its bend goes as the square root of the shortfall). | A soft zone at full reach (`IK_SOFT`, 3 cm; the hand falls 1.5 cm short at exactly full reach). |
| 18 | The upper body's reach lean flipped sides as the target passed under the spine's base: the lower back jumped 52°. | The lean follows at 20 rad/s and fades where its direction is undefined. |
| 19 | The arm's fade between its solve and the clip turned the upper arm over 148° in a frame when the two were near 180° apart. | The fade turns no faster than 1500°/s. (Keeping last frame's way round instead spun the arm the long way: 27 configurations failed.) |

60 configurations × 90 s: 18 failing at the first run, 10 before the last four fixes, 7 after. All 7 have a random-input monkey (see below).

### Tools

- The through-net check took the pocket's entry below the tape for the crossing of a ball that went in, climbed out
  and over the cable; it now takes the crossing where the side changes if that is above the tape.
- The net's settled-shape cache was keyed on the air's density and never bounded: 2000 climates grew the army's
  heap 9 KB a match. It keeps 16 now.

## Not fixed, not built

- **Out-of-court play** (FIP 13.1.e, 14.1.j, 16) is not built: no court allows it, so a ball that leaves the
  court after a good bounce ends the point, which is the rule for such courts (13.1.d). Building it needs the space
  outside the court, the doors to run through, players and the AI chasing out there, and the rules of returning
  from outside. OPEN_QUESTIONS.md asks whether it is wanted.
- **Touching the net (13.1.a) can't happen**: players are kept 0.3 m from it. The rule is in the oracle only.
- **No hall ceiling.** Indoor arenas have no ceiling to hit (14.1.d counts a ceiling after a good bounce as a
  correct return; before it, it is out).
- **Monkey animation.** The 7 configurations still failing the animation thresholds all have a monkey: 3 on pops
  per minute (31-44, limit 30), 3 on the racket in the body (1.5-2.4%, limit 1%), 3 on the serve hand in the torso
  (0.6%, limit 0.5%), 1 on serve pops. Monkeys swing about three times as often as the AI (46 swings against 16 in
  the same 90 s) and somewhat more jerkily (1.2-2.7 pops a swing against the AI's 0.5-1.9), so per-minute limits
  set for AI play don't fit them; no AI-only configuration fails.
- **Allocation with four bodies** is 8-9 minor GCs per 100k ticks (budget 10; 7-8 before Phase 7; CLAUDE.md said 2
  at Phase 3). Phase 8.

## Numbers

| Run | Code | Result |
|---|---|---|
| Match army `p7-r1` ([report](army-p7-r1.md)) | before fixes 6-11 | 2000 matches, 549 h of play, 164,873 points, 17.9 min on 7 workers: 39 matches with a problem. 4 were one-set "no tie-break" matches whose score diverged and then disagreed on everything after (#8); 27 the through-net check (#10 and #11, and the checker's own two mistakes); the rest #6, #7, #9, #11. No crash, no ball stuck, no match that didn't end. |
| Animation army `a1` → `a10` ([a1](anim-army-a1.md), [a10](anim-army-a10.md)) | before #12 → final | 60 configurations × 90 s. Pops 21.9 → 14.7 a player-minute, serve pops 8.9 → 5.8, fastest one-frame turn 77° → 46°, racket to ball at contact p50 0.5 → 0.7 cm and p90 2.7 → 3.4 cm (the soft reach), contact lag p50 4.4 → 5.1 ms. Failing configurations 18 → 7, all 7 with a monkey. |
| Browser soak | final | 20 min of AI doubles in Chrome at 1080p, vsync: 71,975 frames, 1 over 20 ms, none over 50 ms; JS heap after GC 14.7 → 15.5 MB (0.019 MB a minute after warm-up), DOM nodes 151 → 153, three's geometries 38 and textures 28 throughout; no errors; 1.4 s from load to playing. |
