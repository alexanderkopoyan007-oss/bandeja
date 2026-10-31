# BANDEJA expert review (Phase 9)

Two reviewers, one list: a professional padel player (does it play like padel?) and a games critic who has played
Top Spin 2K25 (does it look, sound and feel like a top-tier sports game?). Ranked by impact on someone playing it.

- **Critical**: breaks the game or the sport's identity. **High**: an expert notices it within a minute or a match
  and it is clearly short of real padel or a top-tier sports game. **Medium**: noticeable, but the game is right in
  kind. **Low**: polish.
- Evidence: AI doubles at level 1 measured the way match-analysis studies measure pros (`node tools/match-stats.ts
  --points 2000 --level 1`, `docs/review/match-stats-l1.txt`), a probe of where each kind of shot bounces and how the
  next one is taken (16 matches), captures of every arena from the broadcast camera and close-ups (`?cam=body|face`),
  a human match played by the keyboard bot (`tools/bot-play.mjs`), and the QA army's findings from Phase 7.
- Pro figures: WPT 2020 quarter-finals to finals, 20 matches, 35,145 hits (Courel-Ibáñez/Sánchez-Alcaraz et al.,
  *Sports* 2024, PMC11359520): men 10-11 shots a point, 13.5-14.8 s, 0.80 shots/s; each stroke as the share of
  points it appears in (bandeja 44-48%, flat smash 30-33%, back-wall forehand 42-45%, backhand 34-36%, contrapared
  11-13%, bajada 14-17%). WPT 2014 men's shot mix (8,581 actions) and the per-stroke and ending figures already in
  `tools/match-stats.ts`.

Features the roadmap leaves to later milestones (replays and broadcast cameras M7, career and tournaments M6,
character creator M5, commentary, online play) are listed at the end and not ranked: this brief is the realism of
what is there.

## Round 1

| # | Rank | Reviewer | Finding | Evidence | Status |
|---|---|---|---|---|---|
| 1 | High | Critic | **The stadium crowd is made of blocks.** 4,640 people, each a six-sided cylinder, a box for thighs, a 20-face ball for a head and a cap: no arms, no legs, no faces. Next to the MakeHuman players it is the most dated thing on screen, and from the TV camera it fills the top third of the frame. | `rv-tv-b` (broadcast), `rv-face-*` (behind every close-up) | Fixed: twelve MakeHuman spectators as sprites (seated, clapping, standing; 7 angles; each shirt tinted), quiet through a point and applauding after (`cr-tv-c`, `cr-cheer`) |
| 2 | High | Pro | **No bajada.** A lob that comes off the back glass high is smashed back down by pros (in 14-17% of men's points). The AI never plays an overhead off the glass (it plans overheads only from inside 6.5 m, before the bounce), so every high ball off the glass is let drop and played as a groundstroke. A human holding O gets an overhead plan off the glass, untested and with no hint. | `simpleAi.ts plan()` (`abs(p.pos.z) < 6.5 && lobComing`), `chooseShot` (`depth < 7`) | Fixed: the AI plays it by level (15.2% of points), the HUD hints it, O plans it (`tests/sim/bajada.test.ts`) |
| 3 | High | Pro | **Too much is played off the back glass.** 27.4% of all shots are back-wall shots against 12.8% for WPT men in 2014; all wall shots 32.4% against 19.0% (2014) and 24.5% (an earlier pro-tour zone study). Groundstrokes before the glass 17.8% against 23.1%. A pro sees back players let nearly every deep ball through to the glass. The planner adds 0.6 to any contact before the glass within 1.7 m of the back and takes 0.1 off any after it: written for the owner's "can't hit it off the wall", it applies to the AI too. | match-stats L1; removing the bias for everyone: back-wall 22.4%, groundstrokes 22.0%, all walls 27.2% | Fixed for the AI (`Player.glassWait`; humans keep the wall play the owner asked for): back-wall 21.2%, all walls 26.5% |
| 4 | High | Pro | **Smashes where pros play the bandeja.** The smash is 49% of the AI's overheads (5.4% of shots against a bandeja's 3.8% and víbora's 1.8%); pros smash 26-36% of overheads and play the bandeja in 44-48% of points against the flat smash's 30-33%, to keep the net. The smash's winner rate is half the pros' (23% against 45%) because it is tried from too far. Left open by the physics audit (OPEN_QUESTIONS, "The x3 smash and overhead choice"). | match-stats L1 per-stroke table; `chooseOverhead` (95% smash inside the kill depth at level 1) | Fixed: smash 31% of overheads, in 28.9% of points; bandeja 33.9%, víbora 24.7% |
| 5 | Medium | Pro | **Rallies a little slow.** 15.4 s a point at 0.73 shots/s against 13.5-14.8 s at 0.80 for WPT men (shots a point 11.2, in their 10-11). Half the points last over 11 s. Mostly items 2-4: balls let through to the glass travel twice as far. | match-stats L1 | Better after 2-4: 11.7 shots, 15.5 s, 0.76 shots/s |
| 6 | Medium | Pro | **Errors go into the net, rarely off the side.** 70% of errors in the net against 51%; 4.6% off the side glass or out of the side against 17%. The swing's yaw error is small next to its pitch error, and the AI's targets keep 1.2 m off the side glass. | match-stats L1 errors line | Better: net 67%, side 9% |
| 7 | Medium | Critic | **A grey band at the waist.** When a player bends forward the shirt rides up and shows the shorts' waistband, which the suit's ambient-occlusion map darkens to grey (it was under the shirt in MakeHuman's model). Visible from the TV camera on a player leaning into a low ball. | `rv-body-b` | Fixed: the shorts above the shirt's hem are lit as they show |
| 8 | Medium | Pro | **Too few serve faults.** First-serve faults 6.2% against about 10%, double faults 0.8% of second serves against about 2%. | match-stats L1 | Better: 7.2% first-serve faults |
| 9 | Medium | Pro | **No play outside the court.** A ball that leaves over the side glass or by a door after a good bounce can be chased and played back from outside on courts that allow it (FIP 14.2); pros do it a few times a match after a smash por tres or por cuatro. The game calls the point at the second bounce. | CLAUDE.md (stretch goal) | not in this brief |
| 10 | Medium | Critic | **Faces are MakeHuman's.** Plausible at TV distance, plain in close-up: no expressions, no blinking, one look each for the four. | `rv-face-*` | limited by the CC0 source (OPEN_QUESTIONS) |
| 11 | Medium | Critic | **Low-poly trees** round the club arenas (clumps of spheres). | `rv-pano-clubday`, `rv-clubnight-tv` | |
| 12 | Low | Critic | **Bare stadium surround**: plain red floor and grey hall walls behind the stands; one TV camera and an umpire's chair as dressing. | `rv-tv-b` | |
| 13 | Low | Pro | **Lobs** 16.9% of shots against about 20% for elite men (2013); in kind right (lobs in most points). | match-stats L1 | |

After round 1 (`docs/review/match-stats-l1-r1.txt`): the four High findings are fixed; the Medium ones that came
with them are better but not closed. Frame rate before and after: DECISIONS.md, review round 1.

## Round 2

A blind draft first, then marked against round 1.

Evidence used:
- The round-2 captures (not committed), viewed at 1600 px, with 4K crops.
- docs/review/match-stats-l1-r1.txt ("file").
- My own runs: tools/out/r2-stats-l1.txt (840 points at level 1, `--seed0 501`) and tools/out/r2-stats-l05.txt (600 points at level 0.5).
- An avatar probe, tools/out/r2-bajada-anim.ts, over 30 seeds × 300 s of AI doubles. At each hit it measures the racket face centre to the sim's contact point, and which way the shoulder line faces relative to the net. Output is in r2-bajada-anim.txt and r2-baj-[abc].txt.
- Older captures, for history: rv-clubnight-tv and arena-hall (Phase 5).

| # | Rank | Reviewer | Finding | Evidence | NEW / REPEAT / REGRESSION | Fix direction | Status |
|---|---|---|---|---|---|---|---|
| 1 | High | Critic | **The main court has no lines in the hall, club-day and club-night arenas.** There are no service lines and no centre line. This includes the panoramic and singles-narrow courts. The neighbour courts beside it do show their lines. The stadium is fine, and it is the only arena without `neighbours`. | **Captures:** r2-hall-tv, r2-clubnight and r2-singles-hall have none; r2-clubday-pano has only a ghost of them in a 4K crop. The stadium captures have lines. The same bug is in round 1's rv-clubnight-tv and Phase 5's arena-hall. **Code:** arena.ts:98 (main court) and arena.ts:169 (neighbours) call the same `floorMaterial(def.floor, look)`. **Data:** arenas.json gives hall, club-day and club-night `neighbours`; the stadium has none. **Cause:** not found by reading the code. Nodes' cache keys are per id, so it is not shared-program collision. | NEW (round 1 missed it; present since Phase 5) | Remove `neighbours` from the hall for one render to confirm the correlation, then find what the neighbour build does to the main floor. Add a test that samples the near service line's pixel in every arena. | Not reproduced: the hall's lines are there in WebGL at 1280 and 7680 px and in WebGPU at 1280 px; the round-2 captures were most likely taken before the floor's pipeline had compiled. Rechecked in round 3 |
| 2 | High | Pro | **The overhead game is thin for pro level.** Net pairs let lobs go to the glass instead of taking them overhead, and smashes rarely leave the court. | **Shot mix at level 1** (file / my run): smash 3.0 / 2.9% of shots (pros 6.9; round 1 had 5.4); bandeja 4.2 / 4.2% (6.0); back-wall 21.2 / 21.2% (12.8). **Share of points:** a bandeja appears in 33.9 / 33.3% (WPT 44-48), a smash in 28.9 / 27.6% (flat 30-33 plus x3 7-8). **Winners:** the smash is the last shot of 28.1 / 25.3% of them (pros 43). Out-of-court winners (x3/x4) are 7.3 / 5.1% of winners, about 2-2.6% of points; pros 17%, about 6.5%. | REPEAT #3 and #4 (statuses don't hold, see below) | Make a bandeja or víbora the default answer to a lob a net player can reach; retreat to the glass only for lobs over the head. Aim more put-aways at x3/x4 when the ball is above smash height near the net. | Fixed: 75% of lobs against a net pair taken overhead in the air (59%); bandeja in 42% of points, smash 33% of winners, out-of-court winners 8% (DECISIONS.md) |
| 3 | High | Pro | **Points end the wrong way.** Net players win by volleying at or through bodies. Errors go into the net rather than long, and there are too few forced errors. | **Winners at level 1** (file / my run): the volley is the last shot of 43.8 / 50.0% (pros 28). 17.7 / 20.5% of winners hit an opponent's body, about 6-7.6% of all points; the pros' 48/35/17 split has no body class. **Endings:** unforced errors 39.3 / 36.8% (pros 29-33); forced errors 25.3 / 26.1% (29-33). **Errors:** into the net 67.1 / 65.3% (51); on the full into the back glass 14.9 / 18.4% (28). **Level 0.5** has the same shape: body 20.1% of winners, net 68.5%. | REPEAT #6 for the net share (its "Better" barely holds: 70 to 67/65%); NEW for the volley and body winners | Net volleys should go to the feet, the angles and the side glass rather than straight at a body. Tilt the AI's error mix towards pace errors that run long into the glass. Let pressure produce more forced errors. | Better: body winners 20.5% to 9.2%, volley 50% to 38% of winners, net errors 65% to 60%, UE 37% to 35%; forced errors still 26% (Medium in round 3) |
| 4 | High | Pro | **Bandeja, víbora, bajada and smash are one animation up to contact.** They share the same trophy and the same square-on contact key; only the finish differs. A bandeja is played side-on through contact, and the víbora has its own lateral, wristy action. | **Code:** strokes.ts:85-104: OVERHEAD's contact yaw is -0.15 rad, and SMASH is `{...OVERHEAD}` with another finish. avatar.ts:973 makes every overhead OVERHEAD or SMASH. **Probe:** at contact the shoulder line is 11-13° from square to the net for bandeja (n 177), víbora (45), smash (126) and bajada (22). | NEW | Author a side-on bandeja contact (chest towards the side wall, slicing across the ball). Give the víbora its own key (contact out to the side at shoulder height, with pronation). Keep the smash's full turn. | Fixed: chest to the net at contact bandeja 53°, víbora 38°, smash 5° |
| 5 | High | Critic | **Nothing happens between points.** There are 1.1-1.7 s of dead time, with the players braking to a stand. Then a 0.22 s dip to black, the players teleport to their serve places, and the serve comes 0.5 s later. There is no walk back, no ball bouncing before the serve, no partners' racket tap and no cut-away camera. In autoplay and attract the dip is off, so the teleport shows. | **Code:** match.ts:1400-1412 (dead time); match.ts:665 (no movement while dead); match.ts:369 (0.5 s setup); the transitions.ts header (the dip covers the teleport); game.ts:290 (no transitions in autoplay). | NEW | Walk the players back during the dead time with the locomotion they already have. Add a partners' racket tap and the server's ball bounce. Cut to a close camera for the walk-back, and back to the broadcast angle for the serve. | Fixed: walk back, partners' racket tap, carry, cut-away camera, the server's bounces; the dip only at a change of ends |
| 6 | Medium | Pro | **Pro-level points drag.** About half last over 11 s, and short points are scarce. | **Rally length at level 1:** 1-4 s / 5-7 / 8-11 / over 11 = 17.0 / 16.1 / 18.1 / 48.9% (file) and 16.7 / 15.7 / 21.7 / 46.0% (my run). Pros: 26 / 26 / 22 / 26. **Time per point:** 15.5 / 14.8 s (pros 9.4-14.8). | REPEAT #5 (its "Better" doesn't hold) | Mostly downstream of #2 and #3, since more overhead put-aways and forced errors end points sooner. Re-measure after those. | Fixed with 2-3: 11.3 shots and 14.5 s a point (pros 10-11, 13.5-14.8); 47% still over 11 s |
| 7 | Medium | Pro | **AI bajadas often miss with the racket.** At the sim's contact the racket is more than 25 cm from the ball in about one bajada in five; bandejas, víboras and smashes never miss like that. In the capture the player faces his own back glass at contact, racket at chest height, ball above his head. | **Probe:** bajada racket-to-ball p50 0.070 m, p90 0.317 m, over 0.25 m in 18% (n 22). Bandeja, víbora and smash: p50 0.021-0.040 m, over 0.25 m in 0% (n 348). **Capture:** r2-bajada-1 and its 4K crop. | NEW (in the shot round 1's #2 added) | Pick and time the bajada's stroke from the ball's path after the glass. Add bajadas to animQa's byShot with a threshold. | Fixed at the cause: the sim's reach was 1.35 m out at any height; `reachAt` shrinks it above the shoulder. Bajadas over 25 cm 3/8 to 1/5, worst 0.97 to 0.31 m (n is small: about one bajada per 300 s) |
| 8 | Medium | Critic | **The hall doesn't look like a hall from the game camera.** The camera stands 10.5 m outside the 30 m shed, so neither roof nor columns are in frame. You see the club's flat grass, low-poly trees and a flat grey surround, the same as the outdoor clubs. | **Captures:** r2-hall-tv, r2-singles-hall. **Code and data:** views.ts CAM_BACK 15.5 puts the camera at z 25.5; arenas.json hall.hall.z is 15. Phase 5's closer camera (arena-hall) still showed the roof's edge and a column. | NEW, plus REPEAT #11 (trees, no status) | Make the shed longer than the camera distance, or make the camera's end wall part of the hall, with a roof, lights and an end wall in frame. Replace the trees with impostor cards. | Open |
| 9 | Medium | Critic | **The stadium is under-dressed and flat-lit.** Above the stands is a plain light-grey box with no trusses, light rigs or video boards. The benches and umpire's chair are untextured boxes, and the surround is flat red. It fills the top quarter of every TV frame. | **Captures:** r2-stadium-tv-a/b, r2-serve, r2-bajada-1. **Code and data:** stadium.ts:169 (the roof is a flat emissive plane); arenas.json stadium.hall has wall #c9ccd1 and roof #e9ebee. | REPEAT #12 (no status; I rank it higher, Medium) | A dark ceiling with lighting trusses and hanging screens, a lit scoreboard, modelled benches and chair (towels, bottles), and a textured surround. | Open |
| 10 | Medium | Critic | **The controls panel sits over the court in every match until H is pressed.** It is 11 lines of key help over the near-right quadrant, where the human serves. | **Captures:** r2-ui-human-serve and r2-ui-human-rally (about 500×390 px of 1600×900). **Code:** hud.ts:192; hud.ts:261-264 (only H hides it, and that isn't remembered). | NEW | Show it on the first match only, or in the pause menu, and rely on the contextual hints. | Open (the HUD is the owner's call: shown first) |
| 11 | Medium | Critic | **No umpire calls.** Faults, lets and the score are never heard; they go only to an ARIA live region. A pro padel match has a chair umpire calling them, and the game already draws the chair. | **Code:** no umpire voice in src/audio (announce.ts is the ARIA announcer). **Data:** data/audio.json has no call family. | NEW | Synthesised or CC0-recorded calls ("falta", "let", the score) for faults, lets and games. | Open |
| 12 | Medium | Critic | **Clothes still clip at the TV camera's distance.** The shorts' waistband shows through the shirt at the lower back, now as a ragged black notch on the red shirt. Close up there is also a notch in the knee and a white edge inside the shorts' hem. | **Captures:** a 4K crop of r2-stadium-tv-a (near player); r2-body-0, r2-body-0b, r2-body-3. | REPEAT #7 (its "Fixed" holds for the grey shading only) | Keep the shorts' waist vertices under the shirt, or hide the ones under it, and fix the knee seam weights. | Fixed (29 Oct): the notch was the hems' cloth lag pushing the hem into the body; the lag's inward part is dropped (kit.ts `hemLag`), and the shorts under the shirt are cut and tucked in (person_face.cut_shorts_under_shirt) |
| 13 | Low | Pro | **Serving is a touch too safe.** There are no double faults at level 1, few first-serve faults, and receivers win too many short points. | **Level 1** (file / my run): double faults 0 of 146 / 0 of 75 (pros about 2%; round 1 had 0.8%); first-serve faults 7.2 / 8.9% (pros about 10%). The serving pair wins 85.4 / 84.3% of 1-2 shot points (national 98). | REPEAT #8 (better on first serves; double faults not better) | Widen the second-serve error slightly at level 1, and make the return less aggressive against a good serve. | Open (first-serve faults 5.9%, no double faults in 121) |
| 14 | Low | Critic | **The ball trail reads as a string tied to the ball.** It is a 1 px line 28 ticks long, and it is on in autoplay and TV graphics too. | **Code:** views.ts:21 and :70 (LineBasicMaterial, opacity 0.45). **Captures:** r2-hall-tv, r2-bajada-1, r2-stadium-tv-b. | NEW | A short tapered ribbon that fades, or the trail only in assisted play. | Open (a cue: shown to the owner first) |
| 15 | Low | Critic | **The floor option changes bounce and sound but not the picture.** With `floor=hard`, `carpet` or `clay`, the court is still drawn as the arena's turf. The option is URL-only. | **Code:** arena.ts:98 draws def.floor; game.ts:256 passes the floor only to the audio. **Captures:** r2-stadium-clay-tvgfx and r2-clubday-pano. | NEW | Build the court's FloorLook from the sim's floor kind. | Fixed: data/floor-looks.json over the arena's look |
| 16 | Low | Critic | **Hair has a hard, jagged hairline, and brows look drawn on.** This comes from how the hair cards are cut, not from the CC0 source. | **Captures:** r2-face-0, r2-face-2. | NEW (beyond round 1's #10 source limit) | Alpha-to-coverage or hashed alpha for hair, brows and lashes. | Fixed: alpha to coverage on the hair, scalp painted under it |
| 17 | Low | Critic | **The racket hand doesn't grip at rest.** The fingers are splayed open beside the handle, with the butt cap in the thigh. | **Capture:** r2-body-0b (4K crop). | NEW | Keep the grip curl whenever the racket is in the hand, and keep the handle out of the thigh at rest. | In progress with the racket's second pass |
| 18 | Low | Critic | **The score bug names players only by AI style** ("YOU · Relojero", "MURO · SERPIENTE"), with no names or flags. | **Captures:** r2-ui-human-rally, r2-ui-tvgfx. **Code:** game.ts:270-275. | NEW | Deal fictional names from the seed and show the style as a subtitle. | Open |
| 19 | Low | Critic | **The opening "VS ..." banner is drawn over the arena's board text,** so both are hard to read. | **Capture:** r2-ui-human-rally. | NEW | Give it a backing plate or move it off the boards. | Open |

### Round-1 statuses that don't hold up
- **#3 "Fixed" (too much off the back glass):** back-wall shots are still 21.2% (file, my run 21.2) against pros' 12.8%, 1.66× the pro rate. Groundstrokes are 20.7-20.9% against 23.1. Back-wall shots appear in 71% of points. This is "Better", not fixed.
- **#4 "Fixed" (overhead choice):** the balance between smash and bandeja moved, but overheads overall are now short of pros. The bandeja appears in 33-34% of points (WPT 44-48). The smash fell from 5.4% to 2.9-3.0% of shots (pros 6.9) and finishes 25-28% of winners (pros 43). The smash's own winner rate is 28% against pros' 45; round 1 found 23% and called it fixed.
- **#5 "Better" (rallies slow):** not better. Time per point went from 15.4 s to 15.5 s (my run 14.8 s), and 46-49% of points still last over 11 s (round 1 said "half"). Only shots/s moved, from 0.73 to 0.76.
- **#6 "Better" (errors into the net):** barely better. Net errors went from 70% to 67% (my run 65%) against pros' 51%. Side errors did improve, from 4.6% to 9%.
- **#7 "Fixed" (waistband):** the grey band is gone, but the shorts still show through the shirt at the lower back, now black and ragged. It is visible at 4K from the broadcast camera (r2-stadium-tv-a) and in r2-body-0.
- **#8 "Better" (serve faults):** true for first serves (6.2% to 7.2-8.9%). Double faults went from 0.8% to 0 in 221 second serves. That small sample doesn't prove a regression, but it isn't better.

### Captures wanted (round 2)
1. **Missing lines, WebGPU vs WebGL:** `?autoplay=1&seed=12&arena=hall&backend=webgl`, broadcast camera at 6 s.
2. **Missing lines up close:** `?autoplay=1&seed=12&arena=hall&cam=body&camp=0` at the first serve. This shows whether the lines exist close up (a coverage/LOD problem) or not at all (the material).
3. **AI bajada sequence:** frames at -0.3 s, -0.15 s, 0 and +0.1 s around an AI bajada's contact, from the broadcast camera and from `cam=body&camp=<that player>`. Seeds 7-30 at the default level produce about one bajada per 300 s match; the probe in tools/out/r2-bajada-anim.ts finds them.
4. **Overhead side view:** an AI bandeja contact and an AI smash contact with `cam=body`. This shows #4's shared square-on stance side by side.
5. **Between points in a human match:** `?seed=21&assist=1`, frames every 0.25 s from a point's last bounce to the next serve's contact (#5).

### Not ranked: later milestones
A critic would mark these down in a commercial release; the roadmap has them after this brief. Instant replays of
the last point from other angles (M7: the sim is deterministic, so a point is its seed and inputs), commentary (M7
audio), a character creator and rackets to choose (M5), career, tournaments and an academy (M6), online play (stretch).

## Round 3

Two reviews written blind on phase9 at 875fa99, then marked against rounds 1-2. The full reports, with every
probe, capture list and REPEAT/NEW note, are `docs/review/round3-pro.md` and `docs/review/round3-critic.md`.
- **Pro:** 2000 points at level 1 (`--seed0 901`), and 1000 at level 0.5. Probes of returns, lobs, overheads and back-court
  volleys (`tools/out/r3p-*`). 19 captures.
- **Critic:**
  - 46 captures and 12 frame sequences, in every arena, court, floor and camera.
  - A contact probe on two 150 s matches.
  - The app from title to results, and human play.
  - The audio reel. The critic could not listen to it.
- Nothing was Critical. Below, P = the pro's numbers, C = the critic's. The fixes and their measurements are in
  DECISIONS.md under "Review round 3".

| # | Rank | Reviewer | Finding | Evidence | Mark | Status |
|---|---|---|---|---|---|---|
| 1 | High | Pro P1 | **Back-court defenders volley deep bandejas off their shins** instead of letting them come off the glass. | 58.3% of bandeja replies taken on the full from 7.0 m at 0.62 m. Volleys from more than 6 m out were 6.5% of shots. Cause: round 1's `glassWait` 0 for the AI. | NEW, caused by round 1 #3's fix | Fixed: the cost is judged at the contact spot. Volleyed bandeja replies 58.9% → 36.5%, now mostly by net players. Volleys from over 6 m 6.5% → 2.5% |
| 2 | High | Pro P2 | **Returns go at the net player**, not the incoming server. | The server's partner played 60% of flat returns. Pros: 71.9% go at the server. | NEW | Fixed: flat returns played by the server 36% → 75% |
| 3 | High | Pro P3 | **The lob doesn't swap roles.** | The lob made 19.2% of net-takes from both-back. Pros: 60.6%. After a lob got past, the lobbers were both up 27% of the time. | NEW | Fixed (`lobFollow`): 51% of net-takes. Lobbers both up after a lob that gets past: 99% |
| 4 | High | Pro P4 | **Backhands and back-glass shots are played square to the net.** | Chest to the net at contact: backhand 13°, backhand off the glass 19°, forehand off it 6°. | NEW | Fixed: 63°, 78°, 48°. Backhand volleys 61°. animQa checks it |
| 5 | High | Critic C1 | **A match ends on a freeze-frame.** The ball hangs in the air, the players stand still, the camera swings round for a change of ends, then the menu comes up. | k-end-00..03; match.ts PH_OVER only advanced the clock. | NEW | Fixed: the match is played out. The ball falls, everyone reacts, both pairs walk to the net and touch rackets, then step back. A net camera shot. No end swap. Skippable |
| 6 | High | Critic C2 | **The racket misses the ball** on about one contact in twelve (11 of 132 over 15 cm). The worst are low balls. | The critic's contact probe; sheet-misses. | NEW | Better: 24 → 17 of 640 contacts over 10 cm. Over 15 cm: 1.25% of contacts (left-handed smashes hop now; bandejas and víboras hop too). The low-ball half-volley case is left as Medium #20 |
| 7 | High | Critic C3 | **Legs come apart at the shorts' hem.** A hole at the back of the knee, saw-tooth skin flaps. | crop-knees from the game's own cut-away; sheet-serve-knees. | REPEAT R2 #12 | Fixed: skin 6 cm up inside the hem and the hem flared 4 mm. 63 of 64 sectors have skin above the hem. people.test.ts checks it all round the leg |
| 8 | High | Critic C4 | **One locked camera and no replays.** | views.ts; nothing in src made a replay. | REPEAT (rounds 1-2 "later milestones") | Fixed: instant replays of big points. Each is an exact re-sim from a copy of the match, with two alternating angles and slow motion round the winning shot, about 7-14% of points. Camera presets TV / TV close / Player in Settings |
| 9 | High | Critic C5 | **The night court is blown out** to a lime slab, and its lines nearly vanish. | Line-to-turf contrast 1.07 at night against 1.87 by day. | NEW | Fixed: floods 95 → 16, contrast 1.86. nightLight.test.ts checks it |
| 10 | High | Critic C6 | **The key help panel covers the near-right quarter all match.** | d-match-start, d-game-05. | REPEAT R2 #10 | Fixed: it folds when the first point ends, a hint says H brings it back, and the choice is remembered. The owner to see (OPEN_QUESTIONS) |
| 11 | High | Critic C7 | **It is an exhibition game:** AIs are named by their style, and there is no career, tournament or online play. | d-title, d-setup, d-match-start. | REPEAT R2 #18 | Names fixed: made-up names and nations dealt from the seed, never a pro's surname; the style stays as a nickname. Career, tournaments and online play are roadmap items (M6, stretch) |
| 12 | Medium | Pro P5 | **Too few short points.** | 1-4 s points 13.1% (pros 26). Over 11 s 48.6% (pros 26). | REPEAT R1 #5, R2 #6 | Open |
| 13 | Medium | Pro P6 | **The serve is a soft placement to the middle.** | Side glass 31.9% (pros 64.6). 65 km/h. No double faults in 101 second serves. | NEW; faults REPEAT R1 #8 / R2 #13 | Open |
| 14 | Medium | Pro P7 | **The víbora is a slower, lower bandeja.** | 64.7 km/h against the bandeja's 70.7. | NEW | Open |
| 15 | Medium | Pro P8 | **The styles' net trait doesn't show.** | Muro 40.8% at the net against Martillo's 33.1% head to head. | NEW | Open |
| 16 | Medium | Pro P9 | **Points still end the wrong way.** | Net errors 58% (pros 51). Volley winners 39.6% (28.4). Bandeja and víbora winners 5.7% (12.7). Forced errors 25.5% (29-33). | REPEAT R1 #6, R2 #3 | Open |
| 17 | Medium | Pro P10 | **Singles is a glass-hitting contest.** | 35.6% of points end with a ball into the glass on the full; 49.5% on the narrow court. | NEW | Open |
| 18 | Medium | Critic C8 | **Every point is followed by the same single cut-away shot.** | sheet-between. | NEW | Open. The match end adds a net shot, and replays add two angles |
| 19 | Medium | Critic C9 | **No voice anywhere:** no umpire, no line calls, no menu music. | src/audio; the reel. | REPEAT R2 #11, R1 #12 | Open |
| 20 | Medium | Critic C2 (rest) | **Low balls switched to a half-volley about 60 ms before contact.** The racket can't get down a metre in time. | 10 of 123 volleys at 10-20 cm, `tools/out/r3c2-miss.ts`. | from #6 | Open: the AI needs to plan the half-volley earlier |
| 21 | Medium | Critic C10 | **Close up, the people look like stock MakeHuman.** | sheet-faces, crop-face2-hair. | REPEAT R1 #10, R2 #16 | Better after the people pass. The skin, hair and faces are limited by the CC0 source (OPEN_QUESTIONS) |
| 22 | Medium | Critic C11 | **Stiff overhead and serve poses:** both arms up in a "Y" before a bandeja, the serve from a deep squat. | sheet-bandeja-body, sheet-serve-body. | NEW | Open |
| 23 | Medium | Critic C12 | **The hall still looks like an outdoor club** from the game camera. | a-hall; the shed ends 10.5 m short of the camera. | REPEAT R2 #8 | Fixed: the far gable is clad up to the roof ridge (rails, clerestory, columns) and hidden at the camera's end |
| 24 | Medium | Critic C13 | **The TV graphics and the floor choice are URL-only.** | options.ts:150. | NEW | Open: the TV package needs the owner's look first |
| 25 | Low | Pro P11 | **No play outside the court.** | 3.9% of points end `exit_after_bounce`. | REPEAT R1 #9 | Stretch goal |
| 26 | Low | Pro P12 | **Serve-time positions never vary.** | The server's partner is at 2.60 m every time. | NEW | Open |
| 27 | Low | Pro P13 | **Lobs a little scarce.** | 15.9% of shots (about 20). | REPEAT R1 #13 | Open |
| 28 | Low | Pro P14 | **The thighs pass through each other in stance, and the neck turns too fast.** | Legs clip in 2.7-3.0% of frames. | NEW | Open |
| 29 | Low | Critic C14 | **The camera's pan depends on frame rate.** | views.ts:396. | NEW | Fixed: the pan eases on the match clock |
| 30 | Low | Critic C15 | **The ball trail reads as a string.** | sheet-smash-tv. | REPEAT R2 #14 | Open (a cue: the owner first) |
| 31 | Low | Critic C16 | **The crowd are cut-outs at 2×:** one pose, nobody follows the ball. | crop-4k-crowd. | REPEAT R1 #1 (polish) | Open |
| 32 | Low | Critic C17 | **The game score card lands on the near pair at the serve.** | d-game-05. | NEW | Open (HUD: the owner first) |

Round 3's eleven Highs are all fixed except the rest of #6, which is now the Medium #20 (and C7's roadmap half).
Round 2 statuses the reviewers didn't support:
- R2 #6 (rallies drag) is not fixed: short points regressed. It is open as #12.
- R2 #12 (clothes) was Better and is now fixed as #7.
- R2 #16 (hair) is Better.
- R1 #8 (serve faults) doesn't hold. It is open as #13.

## Round 4

Two reviews written blind on phase9 at 78637a7. The full reports are `docs/review/round4-pro.md` and
`docs/review/round4-critic.md`. Round 3's Mediums (branch r4-mediums) were not in that commit; they are marked here.
Nothing was Critical. Two Highs were new (the pro's #1 and #2), so the loop goes on to round 5. Numbers after the fix: 2000
points at level 1 (`--seed0 1301`), `tools/out/r4p2-*` re-run on the fixed code.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | High | P: everything flat goes down the middle: cross/line 42/58 (WPT 57.5/42.5), the outer metre 1.6% | NEW | **Fixed.** A table of cross-court corner, line and middle, judged from the contact's side: cross/line 56.4/43.6, middle 28%, |x| 0-1 m 14%, the outer metre 5.7%. Back-wall shots fell with it (below) |
| 2 | High | P: the drop volley is the finisher (W 32%, 0.26 a point), the plain volley W 1% | NEW | **Fixed.** A drop only off a ball above the tape from close in: 0.05 a point, struck from 1.20 m, 8% of what it was. Plain net volley W 1.0 → 1.8-2.2, volleys overall W 2.0-2.8 (pros 3-6). Angles: 44-61% land wider than 2.5 m (6%). Back players step in as our low ball drops at the net pair |
| 3 | High | P: the serve goes evenly round the box | REPEAT R3 #13 | **Fixed** on r4-mediums: side glass 57-60 / T 25 / middle 15-17 (WPT 64.6 / 24.3 / 11.1). First-serve faults 6.2%, return errors on side-glass serves 7.5% |
| 4 | High | P: bandejas half-volleyed at the shins | REPEAT R3 #1 | **Fixed.** 89 of 94 were emergency blocks by a defender running across the ball's line to a plan off the glass. They step off the line and wait (`holdShort`): 20% → 9.4% against two back |
| 5 | High | P: singles ends on the full into a wall, half the side glass | REPEAT R3 #17 | **Fixed.** Margin 1.4 m at level 1, depth on r4-mediums: on the full 38 → 13.2% of points, side glass 19.5 → 8.5% |
| 6 | High | P: singles has no fight for the net | REPEAT R3 #17 | **Fixed.** Serve and volley, approach rule: server 4.13/4.76/7.61 m at the return, volleys 3.7 → 11.2% of shots, server wins 56.9% (50) |
| 7 | High | C: people convince at TV distance, not close up | REPEAT R3 #21 | **Better, close to the source's limit.** Ambient hue off skin and eyes (no violet sockets, no lavender whites), brown irises, catchlights, no orange lid band, strand detail, laces and a knit on the shoes, no pale band under the jaw. Faces are MakeHuman's: still not 2K's scanned heads |
| 8 | High | C: winning the match is a point's gesture | REPEAT R3 #5 | **Fixed.** 3.6 s: the winners run together and embrace, the beaten bend over, hands on knees, then the walk to the net and the tap |
| 9 | High | C: the same four men in the same kit under new names | REPEAT R3 #11 | **Fixed.** Ten people (four women), men's or women's matches, names from nations that fit the face, eight kits, all from the seed; people load per match. Choosing your own look is M5 |
| 10 | High | C: one mode and no teaching | REPEAT R3 #11 | **Better.** A knock-out (three rounds) and four practice drills. A guided first match, career and online stay on the roadmap (OPEN_QUESTIONS.md) |
| 11 | Medium | P: back glass climbing back, 20.6% of shots | REGRESSION of R1 #3 | **Fixed** by #1: 15.8% (pros 12.8) |
| 12 | Medium | P: the serving pair lost its short points (66-74%) | REGRESSION of R2 #13 | Better: 75-82 |
| 13 | Medium | P: server runs in too far and too fast | NEW | Open |
| 14 | Medium | P: net volleys struck low (70.8% under the tape) | NEW | Open |
| 15 | Medium | P: stretched low contacts met late; animQa's window hides them | REPEAT R3 #20 | Open |
| 16 | Medium | P: beaten players still swing (9 per 100 points) | NEW | Open |
| 17 | Medium | P: the net pair doesn't chase what passes it | NEW | Open |
| 18 | Medium | P: the víbora is a slower bandeja | REPEAT R3 #14 | **Fixed** on r4-mediums: 79 against 71 km/h |
| 19 | Medium | P: endings read as qualifiers | REPEAT R3 #16 | Better: 33.8-36.6 / 27-28 / 35.6-38.4 (main draw 34-42 / 29-33 / 29-33) |
| 20 | Medium | P: the styles' net trait doesn't show | REPEAT R3 #15 | **Fixed** on r4-mediums: Muro 28.6%, Martillo 37.0% net time |
| 21 | Medium | P: too few serve faults | REPEAT | Better: 6.2% at level 1 (pros 7-10), 0.8% double (2.1) |
| 22 | Medium | P: forehand volley played square | NEW | Open |
| 23 | Medium | P: everything struck from a standstill | NEW | Open |
| 24 | Medium | P: the bottom of the ladder is short | NEW | Open: 4.6 / 6.3 (5.6 / 7.3 derived). docs/ai.md's table refreshed |
| 25 | Medium | P, C: stiff overhead and serve poses | REPEAT R3 #22 | **Fixed** on r4-mediums for the crouch; the Y of the arms stays |
| 26 | Medium | C: no voice or music, silent replays | REPEAT R3 #19 | Open |
| 27 | Medium | C: one contact in sixty 15 cm or more off | REPEAT R3 #20 | Open |
| 28 | Medium | C: the end-wall mesh over the net zone | NEW | Open, the owner's choice of camera |
| 29 | Medium | C: TV close loses a player a fifth of the time | NEW | Open |
| 30 | Medium | C: replays need a last pass | NEW | Open |
| 31 | Medium | C: empty grey in the stadium | REPEAT R2 #9 | Open |
| 32 | Medium | C: nobody works the court | REPEAT | Open |
| 33 | Medium | C: reactions are one clip each | NEW | Open |
| 34 | Medium | C: no opening, no walk at a change of ends | NEW | Open |
| 35 | Medium | C: club scenery a generation behind | REPEAT R1 #11 | Open |
| 36+ | Low | The rest of both reports (13 items) | | Open; serve-time places (P #24) **fixed** on r4-mediums |

Earlier statuses corrected by round 4:
- R3 #1 was Better, not Fixed, until `holdShort`.
- R1 #3 "Fixed for the AI" had slipped to 20.6% and is back at 15.8%.
- R2 #6 and R3 #12 (too few short points): closed. Scaled to the same mean, the shape matches; what stays is a mean near the top of WPT 2020's range.
- R3 #27 (lobs scarce): closed. 1.9 a point against about 2.0.
- R3 #21 "limited by the source" was wrong for the eyes: the violet, the orange and the lavender were our shading.
- R3 #5, #8 and #11 were Better, not Fixed.

## Round 5

Two reviews written blind on phase9 at 59125d6. The full reports are `docs/review/round5-pro.md` and
`docs/review/round5-critic.md`. Nothing was Critical. Nine Highs were new (P #1-3, #5; C #1-4, #6), so the loop goes on to
round 6. Numbers after the fix: 2000 points at level 1 (`--seed0 1701`), men's and women's, and `tools/anim-check.ts`.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | High | P: smashes are answered on the rise | NEW | Better. Felt grips less the harder it is pressed (`muFall`, pinned to Cross's and the ITF's numbers), and a defender plans for the ball's fall off the glass, or gives it up if it only climbs. Of 842 smashes, no reply 513, on the rise 213 (68 of them contraparedes), off the wall 112: 65% of replies on the rise, against under 15% wanted. Smash W 58.7 (45), FE 5.7 (0.8), UE 4.2 (6). Still High |
| 2 | High | P: net volleys run backwards | NEW | **Fixed.** High W 5.8 L 2.2; low W 0.5 L 6.2. The shot's height and depth were only set for overheads |
| 3 | High | P: lobs sail out over the side fence | NEW | **Fixed.** 1.5-2.7% of points |
| 4 | High | P: the server sprints in and parks | REPEAT R4 #13 | Better. Third shot taken from 4.03 m (3.84 wanted) |
| 5 | High | P: women's matches are men's matches | NEW | Better. A table of published differences (`ai-skill.json` `women`): winners 73 / 17 / 4 (76.9 / 11.8 / 11.3), first serves in 89.5 (87.7), speed 0.93. The serving pair still wins 58 (48.5), the gap in `OPEN_QUESTIONS.md` |
| 6 | High | C: women play in men's clothes | NEW | **Fixed.** A fitted top and shorts, separated by mesh piece |
| 7 | High | C: you become someone else every game | NEW | **Fixed.** Rematch keeps the whole cast; On to the next round keeps your pair and deals new rivals |
| 8 | High | C: singles cuts to an empty court | NEW | **Fixed.** The cut-away finds the winner with one player a side |
| 9 | High | C: women grunt in men's voices | NEW | **Fixed.** Four women's voices (f0 172-231 Hz) |
| 10 | High | C: the people don't reach "actual humans" close up | REPEAT | Open for the faces (MetaHuman pilot, the owner's request). Teeth shading and three new haircuts done |
| 11 | High | C: the racket misses the ball on one contact in twenty | REPEAT R4 #27, R3 #20 | Better. The miss was reach, not timing: the racket now tips about a ball the arm can't reach, off the floor. Worst 27.6 → 15.1 cm over 720 s, none over 15.1 in about 440 contacts. Balls under 0.16 m stay 9-15 cm off; the frame can't go further down |
| 12 | Medium | C: overheads start late and end at a pose | NEW | Better for the start: 0.45 s up, 0.75 s pressed. The akimbo tail stands |
| 13 | Medium | Pose pass against 33 tour photos (the owner's request, not a finding) | | Ready stance 47 → 20.5° (5-19), bandeja hips 76° shoulders side-on. Bandeja elbow still 100 against 47 |
| 14+ | Medium | P #6-22, C #7-9, #11-15, #17-23 | | Open |
| 36+ | Low | P #23-29, C #24-37 | | Open |

Earlier statuses corrected by round 5:
- R4 #20 "Fixed": fixed at a price. El Muro now loses all three pairings by 4-6 points.
- R4 #12 "Better: 75-82": 74.8-76.3, the floor is the ceiling.
- R4 #19: forced errors 25.7-26.0, not 27-28.
- R1 #3: all walls 28.0 against 19.0; side + double 12.2 against 6.2.
- R4 #9 and #8 were Better, not Fixed. R2 #5 held for doubles only.
- R4 #7 "close to the source's limit" was overstated: the mouth and hair were ours.

## Round 6

Two reviews written blind on e39b531. The full reports are `docs/review/round6-pro.md` and `docs/review/round6-critic.md`. The
critic's is partial: it was stopped before its status-check job ran, and what that would have covered is listed under "Not
checked" there, not counted as passed. Nothing was Critical. Ten Highs, seven of them new or regressions, so the loop goes on.
Numbers after the fix: 2000 points at level 1 (`--seed0 1701`), men's, and the scratch reports named in `DECISIONS.md`.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | High | P: net players let reachable balls past | NEW | **Fixed.** 31 per 100 points to about 3.5. A net player meets a ball in the air from where they stand, and backing off for the rebound costs |
| 2 | High | P: points end on the smash, forced errors halved | REGRESSION | Better. W / FE / UE 44.7 / 16.9 / 38.5 to 38.1 / 27.0 / 34.9 (34-42 / 29-33 / 29-33). Smash 55.7 to 52.2% of winners (43), volley 14.4 to 23.7 (28.4). Winners out of the court fell from 13.2 to 5.8 (17), the price of the glass change |
| 3 | High | P: defenders watch soft balls die | NEW | Better. 18.4% of points to 11.2 (under 8 wanted). The cause was the AI's release: swings at the air fell from 12.5 to 1.0 per 100 points |
| 4 | High | P: smashes answered on the rise | REPEAT R5 #1 | Better. 70.3% of replies to 18.8 (under 15), 70% now off the glass |
| 5 | High | P: the forehand volley is square and straight-armed | NEW | Better. Own keys from 13 volleys on video: chest 5 to 40°, wrist 0.26 to 0.41 m in front (0.39). Elbow 30 to 34-41 (63): the ball is lower and further than a coach's feed |
| 6 | High | P: the formation is on rails | NEW | **Fixed.** Nearer net player p10 / 50 / 90 at 2.10 / 2.63 / 3.66 m, pair stagger 0.47 / 1.35 m, was 3.10 and 0.02. 67.8% of net volleys are still below the tape (77) |
| 7 | High | C: before a bandeja the arm goes straight up | REGRESSION, REPEAT | **Fixed** by the video pass that was already on the branch: elbow at -0.2 s 85, contact 50 (54-65 on video) |
| 8 | High | C: the walk back is a trot | NEW | Better. 2.2 to 1.5 m/s, hips 0.88 to 0.96, racket low in one hand. No walk clip: it is the jog drawn most of the way to the upright stand, and the straighter knee is 30 (under 20 walking) |
| 9 | High | C: the people don't reach "actual humans" close up | REPEAT | Open. The MetaHuman pilot waits on one Epic sign-in and one launcher option |
| 10 | High | C: the racket misses the ball one contact in thirty | REPEAT | Better, now Medium. 3 of 293 contacts over 15 cm, worst 19, median 1. The critic's probe found 3.2% and 63 cm on e39b531, by another method |
| 11+ | Medium | P #7-25, C #5-22 | | Open except: P #8 (beaten players still swing) better with #3, P #20 (contraparedes) 11.9% of points (11-13), P #24 (strokes from a standstill) better with strokes on the run |
| 48+ | Low | P #26-34, C #23-29 | | Open |

Earlier statuses corrected by round 6:
- R5 #1 and #2 held only for what they measured: the inversion of high and low volleys is gone, but "Fixed" was too strong for #2.
- R5 #11 "none over 15.1 in about 440 contacts": not reproduced on e39b531.
- R5 #12 "0.45 s up": 0.65 s, which is better.
- R5 #13 "Bandeja elbow still 100 against 47": fixed at contact, regressed before it, now fixed.
- R5 critic's "Teeth shading done": p7's teeth are still dark in one frame, seen not measured.
- R4 #19: forced errors were 17-19, not 25.7. R4 #12: 68.4-76.0. R4 #20: Muro's price is 5.6-10 points.


## Round 7

Two reviews written blind on c96b20b, and a third pass that checked both on seeds neither had used. The reports are
`docs/review/round7-pro.md`, `round7-critic.md` and `round7-verify.md`. One Critical, three Highs, and one High lowered to Medium by
the verifier. None is strictly new, but the Critical and the volley are proven regressions on the same seeds, and earlier rounds
counted regressions, so the loop goes on. Numbers after the fix: 2000 points at level 1 (`--seed0 1701`), men's, and the scratch
reports named in `DECISIONS.md`.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | Critical | P: one key beats every level, the slice down the middle | REPEAT R6 #12, REGRESSION | **Fixed.** See the table below. The cause: the server's own volley was planned 0.05 s short (it counted stopping and setting the feet), so both partners read "not in time" and the net player kept a ball it could not reach. Slice returns that win 51 to 5% |
| 2 | High | P: a smash winner comes back and loses the point | REPEAT R6 #16 | **Fixed.** 40 to 2 of 3000 points. The dodge sat inside the check that the ball was coming at the player, so the smasher never looked at their own ball |
| 3 | Medium (P: High) | P: standard singles, the server jogs at 3.0 m/s | REPEAT R6 #14 | **Fixed.** Return winners 11.0 to 5.3%, server 49.3 to 52.9%. The serve's follow-in cap now ends when the chase starts |
| 4 | High | P: the forehand volley hangs the racket from a straight arm | REPEAT R6 #5, REGRESSION | **Fixed.** Racket lean mid -62 to -31, low -64 to -31, backhand about 0. Elbow on the mid forehand 45 to 58 (63 on video), mid backhand 54 (54) |
| 5 | High | C: the people don't look like actual humans close up | REPEAT | Better, still open. Each of the ten now has a head of their own with asymmetry, blotched skin with pores, clean necklines over a neck of the right colour, cloth with real folds. In a cut-away they read as people. Later on 30 Oct the ages went up to 0.52-0.62 with smaller eyes, which did more than any shader, and the kit, hair and builds were redone by tape measure (three of the four women in skirts, real shorts length, calves and shoulders). A face at arm's length stops at the source's 312 × 262 texels, and only MetaHuman gets past that. The launcher's Core Data option is still not installed |
| C2 | Medium | C: a volley is swung as far as a drive | REGRESSION | **Fixed** with #4. Racket path 1.18 / 0.75 / 0.62 to 0.66 / 0.62 / 0.53 m by height, a drive's about 1.0 |
| C8 | Medium | C: the neckline reads as torn | | **Fixed.** Cut per pixel, fitted to each shirt |
| C11 | Medium | C: hair is rigid | | **Better.** Long hair trails on the hems' spring. Bob and ponytail only |
| C29 | Low | C: kits are plain | | Better. Stitched hems and wristbands; no print |
| P5 | Medium | P: sitters at the net aren't put away | | **Better.** High volleys go short, inside the glass: volley W 3.1 to 3.7 (3.4-5.7), 6000 points. The drop wasn't cut: at 0.07 the gap went to the smash. It still wins 52-57% |
| P6 | Medium | P: bandeja and víbora almost never finish | | **Better.** The cause was the AI reading every ball off the glass exactly. With a misread, bandeja + víbora 1.5 to 6.0% of winners (12.7), smash 54 to 48 (43), shots 11.3 to 10.2 (10-11), 6000 unseen points. The short, wide target did worse and was rejected |
| P7 | Medium | P: nobody leaves the court | | **Open.** Out 6.6 to 6.9 of winners (17). Aim peaks at 13% of smashes, and topspin at 1500-3000 rpm reached 9-11 but sent smash W to 60-69 (45), so it was rejected |
| C12 | Medium | C: one reaction each way, one set of strokes for ten people | | **Better.** Ready, forehand, backhand, volley and serve re-keyed from video; ten manners of playing (`data/manners.json`); reactions are one point in three a held pose (`DECISIONS.md`, "The movement pass") |
| 6+ | Medium | P #8-20, C #3, C #4-22 except C8, C11, C12 | | Open |
| 40+ | Low | P #21-29, C #23-30 | | Open |

Pro #1, the slice bot on the verifier's seeds (7301+, level 1, timing window 1.25), share of points won and matches won:

| Timing noise | Before: slice | After: slice | After: drive |
|---|---|---|---|
| 45 ms | 63.4% (932), 21 of 21 over two ranges | 43.4% (957), 1 of 8 | 42.6% before |
| 60 ms | 56.4% (902), 7 of 7 | 38.0% (967), 0 of 10 | |
| 80 ms | 48.3% (1,030), 1 of 6 | 35.2% (980), 0 of 11 | 33.7% (935), 0 of 11 |

Earlier statuses corrected by round 7 (verifier):
- R6 #1 "Fixed, 31 to about 3.5": Better. 7.6-9.3 per 100 points, target under 5.
- R6 #2, the volley's 14.4 to 23.7: the gain was drop volleys. Plain net volleys fell, and bandeja + víbora fell to 1-2.5% of winners.
- R6 #4 "70.3 to 18.8": two measures. 70.3 was against two back, now 33.6; all replies 21.6-21.9.
- R6 #5 "Better": the chest and hand held, the racket head got worse. Fixed here as #4.
- R6 #7 "contact 50": 57-64. Inside the video's 54-65, so the status stands.
- R6 #10 "worst 19": 40.8 cm on a low volley. The rate holds at 1.1%, so Medium stands.

## Round 8

Two reviews written blind on 8fd6459 (230adaa, the glass misread, came after them, so round 9 was its first review), and a third pass that checked both on seeds neither had used. The reports are
`docs/review/round8-pro.md`, `round8-critic.md` and `round8-verify.md`. Two new Highs, two repeats at High and one proven Medium
regression, so the loop goes on. Numbers after the fixes are from the probes named in `DECISIONS.md`, on the verifier's seeds where they
exist, and 6000 points on unseen seeds for the sim.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | High | P: the lobbed net player backpedals square to the net | NEW | **Fixed.** Going back over 2 m/s, chest under 40 degrees from square 70.2 to 9.5% (men), 8.0 (women); side-on 28 to 66 |
| 2 | High | C: the bodies carry no weight | NEW | **Fixed.** Feet to head starting / steady / braking 18.0 / 17.3 / 16.6 to 30.5 / 19.3 / 11.2. A hard stop still doesn't lean back |
| 3 | High | P: women's overheads don't finish | REPEAT, not a regression | **Fixed.** `women.smashEffort` 0.85. Seeds 9101+, 6000 points: smash W 9.6 to 30.0 (29-33), seconds 17.0 to 16.0, W / FE / UE 28.2 / 32.5 / 39.3 to 31.7 / 31.0 / 37.3 (30-36 / 28-32 / 35-37). Volleys still take 43% of winners; the serving pair 61 (48.5) |
| 4 | High | C: the people don't look human close up | REPEAT | Better, still open. Ten different heads of hair, a pair of shoes each, no holes in the kit from any game camera. Faces past 312 texels need MetaHuman (`OPEN_QUESTIONS.md`) |
| 5 | Medium | P #2: only a lob moves a net pair (verifier lowered it from High) | | Open |
| 6 | Medium | C #7: pops of 15 degrees or more doubled | REGRESSION, proven | **Fixed.** 4.83 to 2.1 a player-minute (2.28 before the movement pass), all pops 24.8 to 13. Direction weights eased, warp rate-limited |
| 7 | Medium | C #8: the walk back is a retimed jog | | **Fixed.** Drawn feet, turned to where they are going: forwards 13 to 67%, both feet off 21 to 4.3%, footsteps 5.25 to about 2 a second. No pelvis twist yet |
| 8 | Medium | C #3: feet slide | | **Better** on the walk (held by construction, the toes roll 3 cm). Running stances are unchanged |
| 9 | Medium | C #4: the racket slows at the ball | | **Fixed.** Drive 11.8 then 9.3-9.9 m/s (7.2-7.6), slice 12.6 then 10.8, smash 11.9 then 14.5 |
| 10 | Medium | C #5, P #10: low volleys on a locked arm, the arm snaps | REPEAT R7 #4 | **Fixed.** Elbow under 0.6 m 30 to 50, under 0.85 m 30 to 56 (63), opening 94 to 53 over the last 0.13 s |
| 11 | Medium | C #6: the arm flicks straight on the way back | | **Better.** Flicks of 25 degrees: serve 69 to 45%, volley 71 to 49, slice 57 to 38; the measure's window also catches the next stroke |
| 12 | Medium | C #11, #12: quiet mix, silent replays | REPEAT | **Better.** 12 dB lift (calculated: rally -33, all -28, peak -4; not retapped). Replays play the point, pitched down. No voice on court |
| 13 | Medium | P #9, #11, C #9, #10: forehand coil late, víbora body, smash arc | | Open |
| 14 | Medium | P #4-7, #12, #13, #17; C #13, #15-25 | | Open |
| 15 | Medium | C: p10's tank holes, p3's polo sliver (verifier) | NEW | **Fixed.** p7 had the same fault. The pass found four more: p8's hips open to the court in play, wings on the back band, a salmon chest in the collar, dark skirt streaks. 7 of about 8,640 probe views still leak, all from 65 degrees above the player with the hair hidden, which no game camera does |
| 16 | Medium | C #14: ten people, one pair of shoes, six haircuts | | **Better.** All ten heads differ, each person has their own shoe and sole colour. It is still one trainer mesh |
| 40+ | Low | P #19-30, C #26-30 | | Open |

Earlier statuses corrected by round 8 (verifier):
- R7 #18 was a measuring bug in `q10.mjs` line 20, so it is closed.
- R7 #4 "Fixed" was Better: low volleys, 70% of volleys, sat at the elbow's limit. Fixed now, row 10.
- R7 C8 "Fixed" didn't hold for all ten: p10's and p3's necklines, row 15.
- R7 #25 and R4 #9 / R5 #18, the banner over a replay: still there.
- R4 #2, the drop volley: 0.123 a point, W 54. The rate fell, and it still wins half.
- `docs/research/footage-pose.md`'s game column was stale in four rows, and `docs/ai.md`'s net depth is a setting, not what is measured. Both corrected.

## Round 9

Two reviews written blind on 57fb7e1, the live build, and a third pass that checked both on seeds neither had used. The reports are
`docs/review/round9-pro.md`, `round9-critic.md` and `round9-verify.md`. One new High, one proven High regression and the faces repeating
at High, so the loop goes on. The verifier lowered two of the five Highs to Medium. Numbers after the fixes are from the probes named in
`DECISIONS.md`, on the verifier's seeds where they exist, and 6000 points on unseen seeds for the sim.

| # | Rank | Finding | Mark | Status |
|---|---|---|---|---|
| 1 | High | P #1: strokes and serves drawn with the back to the net, chest 140-176 degrees from it | NEW | **Fixed.** 36 of 3,047 hits to 0 of 3,165, verifier's seeds, serves 1.0% to 0. The body takes a contrapared from the sim, not the plan. The reports' first fix would have caught a fifth: 17 of 21 rally cases were a plan given up for a block |
| 2 | High | P #2: the glass misread takes balls defenders were in time for | REGRESSION, proven | **Fixed** on what the verifier ranked. Plain double-bounce winners 10.6 to 7.5% of points, in time for them 5.2 to 2.2 (2500 points, seed 41001). The misread now needs pace and spin together. The whole line stays 12.8%, because 5.3% of points are now bandejas and víboras dying off the glass, as they should: 13.3% of winners (12.7), volleys 27.5 (28.4). Back-wall UE 9.4 is still over 5.4-6.3 |
| 3 | High | C #3: faces close up | REPEAT | Open, waiting on Install in the Epic launcher (`OPEN_QUESTIONS.md`) |
| 4 | Medium | C #1, #7, P #4: overheads hit before the swing (verifier lowered it from High) | REPEAT R6 C5, R7 C4 | **Better.** A racket drop through a point behind the back. Bandeja 33 ms out 4.7 to 9.6 m/s, at the ball 7.5 to 11.1, path before the ball 0.28 to 0.72 m by this probe. Smash at the ball 9.0 to 17.6, peak 0.04 s after to on it. Still under the sim's 15-16 and 25 |
| 5 | Medium | C #2: feet tap on the spot (verifier lowered it from High) | NEW | **Fixed.** 6.2 lifts a second, travel 0.2 cm, to 1.5, travel 13-17 cm: real steps. It wasn't `gaitSince`: standing tall the leg is at 0.986 of its length against a limit of 0.985 |
| 6 | Medium | C #6: cut-aways show backs | REGRESSION of the walk fix | **Better.** A pair going back from the net is filmed from their back glass: doubles faces / backs 56 / 30 to 62 / 21, singles 46 / 24 to 60 / 17, same probe through the game's camera. Round 8's 80 / 9 came from walking backwards |
| 7 | Medium | C #8: the racket dips on the ball | R8 #9 | **Fixed.** A sum: the end of the swing was counted from the wrong frame. Drive 11.0 / 7.7 / 9.0 to 11.1 / 11.8 / 10.9 m/s, slice 12.9 / 11.2 / 8.3 to 13.0 / 12.5 / 11.6 |
| 8 | Medium | P #3, #5-22, C #4, #5, #9-29 | | Open |
| 30+ | Low | P #23-31, C #30-40 | | Open |

Earlier statuses corrected by round 9 (verifier):
- R8's opening said its reviews were on c660d41. They were on 8fd6459: corrected above.
- R8 row 2 "Fixed" was Better: facing the run 30.5 / 19.6 / 10.7 holds, sideways is flat at 12.6 / 12.1 / 10.0.
- R8 row 6 "Fixed, 2.1" was Better: 3.2 and 2.6 a player-minute on the verifier's seeds. 2.97 now, all pops 12.4.
- R8 row 7 "Fixed" was Better: the moving part holds, the tap and the cut-aways were left. Both handled above.
- R8 row 9 "Fixed" was Better, and is Fixed now, row 7 above.
- R8 row 15 holds from the game's cameras only: slivers at p7's and p10's necklines and hair through p8's band and p9's visor at the face camera (Low).
- R8 P#24 / R7 #26, serve places by side, was a measuring bug (the side came from the team number, and ends change). Closed.
- R6 #3 "Better" went back over its line with the misread, 12.7-12.9, and is row 2 above.
- R5 #3 "Fixed, 1.5-2.7%" holds for the side fence, 2.1%. Lobs out altogether are 4.5% of points.
- `docs/ai.md`'s ladder was stale; `docs/research/footage-pose.md`'s forehand finish, bandeja elbow and backhand wrist rows too. All corrected.
