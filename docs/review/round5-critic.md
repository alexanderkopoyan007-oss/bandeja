# Review round 5: the games critic (Top Spin 2K25 lens)

Branch phase9 at 78de80f, dev server on :5192, 30 Oct 2026. (HEAD moved to 59125d6 during the review, a change to
DECISIONS.md only, so the code reviewed is 78de80f's.) Sections 1 and 2 were drafted blind, then corrected for
errors found afterwards (listed at the start of section 3). Section 3 marks them against REVIEW.md. No code, data or
tracked file was changed. This report is the only new file of mine outside `tools/out`. `docs/review/round5-pro.md`
appeared in the folder while I worked. I did not read it.

**Verdict.** Nothing is Critical. There are 6 High, 17 Medium and 14 Low findings. **Three of the Highs are NEW**:
women in men's clothes, women in men's voices, and a singles cut-away that shows an empty court on every point the
player wins. One is a REGRESSION: you become a different person every game. Two are REPEATs. So the loop goes on.
Three of the four new or regressed Highs come with round 4's "Fixed" cast.

## 1. How I reviewed

**Tools**
- Capture runner: `tools/out/r5c-cap.mjs`, a copy of `r4c-cap.mjs` writing to this round's folder. It freezes the page
  clock and steps the game at exact frames in real Chrome on WebGPU, through `tools/one-chrome.sh`. Jobs are
  `tools/out/r5c-jobs-a` to `-t`. To skip forward I stepped `g.tick()` with drawing off, so the replay recorder ran.
  Frames straight after a jump can carry stale call banners, and I set those aside.
- Reused from earlier rounds: `r3c-sheet.py`; round 3's draw-time contact probe (`MEASURE` in `r3c-jobs-h.mjs`); round
  4's camera coverage probe (`PROBE` in `r4c-jobs-f.mjs`); round 4's master-bus tap (`TAP`, `DUMP` in `r4c-jobs-k.mjs`).
  The tap worked this time, so the in-game mix is measured for the first time. Jobs a, c, d, e and f are adapted from
  round 4's a, c, d, h and e.
- New this round: `r5c-anim.ts` and `r5c-anim3.ts` (the Phase 3 QA written to `tools/out`), `r5c-scan.ts` (hit
  timelines, seeds 41-70), `r5c-walk.ts` (partner spacing), `r5c-grunts.ts` and `r5c-f0.py` (grunts and their pitch),
  `r5c-cast.mjs` (a port of `dealCast`, to measure who survives a rematch), and jobs o and p2 (kit silhouette in the
  bind pose, cut-away framing by the team on camera).
- Sound: `node tools/audio-reel.ts` and the master-bus tap. **I can't listen, so every sound finding comes from
  measurement or code.**

**Runs and samples**

| What | Sample |
|---|---|
| Arenas, courts, floors | 4 arenas, 3 courts, 4 floor looks, women in hall and stadium, 1600 px and 1440p |
| People | all ten, `?cam=face`, `body`, `hand`; faces in motion (smash, point won, point lost; men and women) |
| Strokes, frame-stepped | serve, smash (men, women, TV), bandeja, víbora, drive, volley, backhand, contrapared, lob, walk |
| Replays | 5 stepped, both angles, ball and hitter in frame; rate from seeds 41-70, 30 × 200 s, 32 replays |
| Cut-aways | doubles seeds 49, 53 (23 points, 4,399 frames); singles seeds 44, 65, 67 (47 points, 6,995 frames) |
| Match ends | doubles seeds 61, 62 (`gfx=tv`), 63 (women), 61 with `cutaway=0`; singles seeds 41, 44, 65, 67, 70 |
| Camera coverage | seeds 49 and 53 × 3 presets × 150 s (10,505 rally frames per preset), plus 120 s of singles (3,960) |
| Contact, draw time | seeds 44, 49 (two left-handers), 60, 66, 69, 150 s each, 323 hits; three near-side cases viewed at TV |
| Animation QA | seeds 1301-1303 (round 4's), 1701-1706, 2101-2104; 120 s each, four players |
| Walk-back spacing | 30 matches |
| Grunts | seeds 41-52, 200 s each, 176 grunts |
| Loudness | stadium 100 s, club-day 70 s, master bus at 48 kHz; a point-by-point tap on seed 58 |
| Human play | `tools/bot-play.mjs` doubles seed 64, singles seed 65; capture bot in the app flow |
| A whole match | title, settings, setup, a short set to the results (4-0, 428 s, 21 points, 2 replays), pause, rematch, quit |
| Practice, Knock-out | all four drills from the menu; Knock-out from the menu to 2-2 with the capture bot, then quarter-final to semi-final with the score set to match point in the page (a full run timed out) |
| Cast | 4,000 consecutive deals of `dealCast` |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r5-critic/`.
The sheets, `sheet-*.png`, are the quickest way in. File names below are in that folder.

## 2. Findings, ranked

Nothing is Critical. The game runs from the menus to the results and is padel from every camera.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **Women play in men's clothes, and the shirt bags at the hips.** Every women's match, which is 35% of matches. | All four women's builds list `male_casualsuit06` (`data/players/p7-p10.json`). Mesh widths in the bind pose (job o): shirt hem over waist 1.43-1.47 for women, 1.18-1.20 for men; hem 0.37-0.40 m on a 0.26-0.275 m waist. Same frame, same camera: woman 160 to 215 px (1.34), man 200 to 210 px (1.05) (`z-hips.png`). It reads from the TV camera (`z-hips-tv.png`, `a-women-hall.png`, `r-r2-start.png`), and worst from behind in the walk-back, where the hem rolls under like a tied bag (`sheet-h-walk47w.png` 8-11, `sheet-b-body.png` bottom row). Women on the tours wear fitted tops with skirts or fitted shorts. | Clothes cut for these bodies: a fitted top ending at the hip, and a skirt or fitted shorts. The list is per person, so this is data plus a fit pass in the MPFB pipeline. Extend `people.test.ts`'s hem checks to the women. |
| 2 | High | **You become someone else every game.** "Rematch" says "The same setup again", then deals you a new body, partner and opponents. A Knock-out does the same between rounds: you can change sex between the quarter-final and the semi-final. | `app.ts:99`: `nextSeed` on every build, and Rematch and the next round both come through it. Over 4,000 consecutive deals (`r5c-cast.mjs`): same person 9.4%, same sex 53.5%, same partner 9.6%, same opponents 2.0%. `e-rematch.png`: F. Lombardi with Ó. Serrano · G. Acosta opposite becomes E. Garza with D. Lombardi · D. Fujita opposite. Knock-out, job r: Sem Smit (NED) with M. Benítez in the quarter-final, Daniela Montes (MEX) with B. Ribeiro in the semi-final (`r-r2-start.png`). There is no setup item for your player, only the URL's `?people=`. In a top-tier sports game you are one athlete. | Keep the whole cast on Rematch. In a Knock-out keep you and your partner and deal only the opponents. Then a small "Your player" choice of the ten on the setup screen (show the owner). |
| 3 | High | **In singles, every point the player wins cuts to an empty court.** The same happens to the shot of winning the match. | `views.ts:420-422`: with one player a side the loop steps by 1, so for team 0 it adds both players and divides by 1; the shot looks at the sum of their positions, near the net. Line 427 does the same for the half. Team 1 is framed correctly. The human is always team 0 (`options.ts:97`, `:174`). Job p2, seeds 44, 65, 67: team 0's points, nobody in frame in 67-78% of 3,081 frames, and 15 of 20 points mostly empty; team 1's points 0 of 27, 0% of 3,914 frames. Doubles 0% of 4,399. `sheet-p-cuts44.png`: net, boards and crowd, no player, for about 1.5 s. Match point, `sheet-t-over.png` (score set in the page so the near player wins): seed 70 shows an empty court for over 3 s as the crowd rises, seed 65 has the winner at the frame's edge. | Sum only the cut team's players at lines 422 and 427. Add a test that the cut-away frames its team in singles and doubles, for both teams. |
| 4 | High | **Women grunt in men's voices.** Measured, not heard. | `src/audio/voices.ts:486-489`: "four men's voices", f0 101-136 Hz, tract 0.93-1.05, where 1 is an adult male's. `soundscape.ts:183` picks by player number, and nothing in `src/audio` mentions women. Rendered pitch of the grunts 143-197 Hz (`r5c-f0.py`). Seeds 41-52: 176 grunts in 2,400 s, 4.4 a minute, at peak -13 against the racket's -5 (`data/audio.json`), so they aren't buried. An adult woman speaks at about 165-255 Hz through a tract some 15% shorter, and effort raises the pitch, so the formants are wrong whatever the pitch is. | Four women's voices in `PLAYER_VOICES` (about 1.7 × f0, tract about 0.85), chosen by the cast's sex. |
| 5 | High | **The people still don't reach "actual humans, extremely high def" close up.** The eyes are much better than round 4. The mouth, hair and faces now carry it. | `sheet-b-face.png`, `z-p1.png`, `b-p9-face.png`, `sheet-i-fsmash.png`, `sheet-i-flost.png`: smooth, waxy MakeHuman faces. **Teeth are blue-grey:** brightest fifth rendered at 100, 97, 109 where the atlas has 239 white, and the mouth opens on every grunt (`kit.ts:365` darkens the mouth by the occlusion channel). **Hair:** p1 and p6 share a bowl cut, p7 and p10 a ponytail, p5's and p9's fringes cover an eye, and p9, built as a young woman (age 0.38), has a silver helmet that reads as fur up close and as an old woman at TV (`z-eyes10.png`). Brows are thin drawn lines. The neck hole's edge is jagged (`sheet-i-flost.png` 0-5). At TV distance all ten read as distinct, believable athletes. | Teeth first: it is our shading, and the cheapest gain. Then hair: one or two new CC0 styles per sex, and a natural colour for p9. Then a collar that sits on the neck. Scanned heads stay out of reach under the CC0 rule. |
| 6 | High | **The racket misses the ball on about one contact in twenty, frame-sampled, and sometimes you can see it from the default camera.** Medians are excellent; the tail is not. | Draw-time probe, 323 hits over 750 s: 15 cm or more 17 (5.3%), 30 cm or more 10 (3.1%, one per 75 s), five of those on the near side. These are lower bounds, as the probe keeps six per seed. Worst: volley 79 cm at 0.25 m, slice 77 cm at 0.29 m, slice 64, víbora 63, drive 58, volley 57. Median 1-3 cm; animQa's swept median 0.4-1.0 cm. **At TV:** `z-slice-tv.png` (seed 49, 141.3 s): the ball bounces beside the near player's feet and flies away in a V while his racket is up by his face. Of three near-side cases viewed at TV, that one reads as a ball bouncing off nothing; a víbora at 63 cm (`z-miss-tv.png`) and a volley at 57 cm (`z-q-vol60-tv.png`) read as fair. | The worst class first: low balls taken on the run, where the plan changes late. Replays should skip a winner whose contact is over 15 cm off. |
| 7 | Medium | **The court is a flat coat of paint on every close camera.** The largest surface in every cut-away and low replay has no surface. | Smoothest 120 × 40 px patch, standard deviation out of 255: 0.47 body camera, 0.67 cut-away, 0.77 TV, 1.16 club (`z-floor-close.png`). `turf.ts`'s header says the fibre and sand are "below a pixel at most distances". No wear on the service boxes or at the back, no footprints, no ball marks. Real padel turf is sanded and visibly fibrous, and wears pale where people play. At TV distance the floor is fine. | Scuffed lanes behind the service line and at the net in the albedo, fibre and sand grain up close, and fading marks where balls land. |
| 8 | Medium | **No umpire, no music, and replays are silent.** | No speech or music anywhere in `src/audio` or `data/audio.json`; the only "announcer" is the screen reader's. `game.ts:736`: `soundscape.update(this.sim, ...)` reads the live match, which is paused for the 7-8 s of a replay. Replays also cut in and out hard. | Feed the replay sim's events to the soundscape, slowed with the picture, under a ducked crowd. Then umpire calls, then CC0 menu music. |
| 9 | Medium | **The game is very quiet, and quietest between shots.** Measured, not heard. | Master bus at 100% volume: gated -35.4 dB in the stadium, -44.0 at club-day; rally only -44.8 and -44.7; peak -12.1 and -13.3. The default of 80% takes off 3.9 dB more. A broadcast mix sits at -23 LUFS, a home game about -24. My figure is unweighted, so it is not LUFS, but the gap is 11-20 dB. Seed 58, by phase: setup -49.1, rally between shots -49.2, dead time -40.1, near hit -23.9 (n 19), far hit -28.8 (n 13). A rally is a click 25 dB over near silence. | Raise the bed (crowd murmur, shoes, the hall) by 8-10 dB and limit the master bus, aiming for about -24 overall. Check by ear. |
| 10 | Medium | **The end-wall mesh sits over the near pair at the net.** | Near pair's frames at the net behind the band: 81.8% and 88.0% (seeds 49, 53); ball seen through it 25.3% and 29.2% of rally frames; luminance through it 0.68-0.72 of clear. `player` preset: 100%. | The owner's choice: a camera higher or further back, or a panoramic end wall. |
| 11 | Medium | **Practice has no goal.** | `g-pr0-end.png` to `g-pr3-end.png`: no score, streak, target or end. The match board stays at 0-0 and still says "THEIR POINT". The coach is a dealt name ("Paolo Lombardi"), and pause offers "Restart match". | Count clean returns of the drilled shot, a best streak, and a line of feedback on the failure. |
| 12 | Medium | **The Knock-out doesn't feel like a tournament.** | Nothing in a match says which round it is (`m-r1-start.png`, `m-r1-results.png`, `r-r2-start.png`). There is no draw, and the round's opponents are strangers to the one before. The results do name it: "Through the quarter-final", "On to the semi-final" (`r-r1-results.png`). | A small draw between rounds and "Semi-final" on the opening banner (show the owner). |
| 13 | Medium | **The match win only half lands.** | **Singles:** a lone winner keeps playing the point's clip for 3.6 s (`sheet-q-oversing.png` 0-4, `avatar.ts:1757`). **Doubles:** the embrace reads, a little stiff, with a free hand sticking out (`d-over61-03.png`), but the default shot frames only the winners, so the beaten's hands on knees is off screen: 0 of 16 frames at 2 Hz (seeds 61, 63). The pose itself is there (`sheet-q-beaten.png`, `cutaway=0`). | Something bigger for a lone winner: arms up, a drop to the knees. Cut once to the beaten, or a wider shot. |
| 14 | Medium | **Shirts tear at the shoulder when an arm goes up.** On every serve and overhead. | `sheet-c-serve.png` 2, 5, 6: a gash at the sleeve. `sheet-i-fsmash.png` 0-3: dark shards. About 6 px at replay scale. Men's hems also swell at the end of an overhead (`z-tear-replay.png`). | Rework the shoulder and armpit weights, or a clothed-arm correction like the leg's. |
| 15 | Medium | **Hair is rigid.** | The ponytail and braid hold their shape through a sprint and a smash (`sheet-i-fsmashw.png`, `sheet-c-smash-women.png`). Shirt hems have a spring (`avatar.ts:184-186`), hair has none. | The same spring on the ponytail's and braid's tips. |
| 16 | Medium | **Overheads start late and end at a pose.** | Racket up only 0.36 s before contact (p10-p90 0.34-0.40, n 31), with the ball 1.78-2.07 s in flight; `docs/research/serve-and-strokes-motion.md` has 516-540 ms of footwork preparation. Both arms still rise together (`sheet-c-bandeja.png` 4-8). 0.25-0.47 s after a smash the player stands with arms akimbo, ball in play (`sheet-c-smash.png` 11-15, women too). | Start the racket's rise on the ball's flight, not on a fixed lead. Replace the akimbo tail with a recovery step. |
| 17 | Medium | **Reactions are one clip each.** | `avatar.ts:205`, `:924-925`: one `celebrate`, one `dejected`, the same after every point. | Three or four of each, chosen by the point. |
| 18 | Medium | **Replays need a last pass.** | The call banner sits over the first second (`sheet-d-rp54.png` 3-7). The jib shows the hitter at 126-149 px against 180 px for the live near player, so the second angle is further away than the live picture. The low angle is excellent: 280-356 px, ball in frame 82-89%, and 89-100% in the slow part. Pan rate is calm: p50 3-22°/s, p90 18-37°/s (n 804). One replay per 187 s. | Clear the call as a replay starts (show the owner). A longer lens on the jib. |
| 19 | Medium | **The clubs and hall are a generation behind the players.** | Club-day: lollipop canopies and a flat fence fill the top half of every cut-away (`sheet-h-walk47w.png`). Hall: z-fighting stripes and stair-steps on the grass, tree trunks cut by the roof band, bare concrete (`z-hall-grass.png`, `a-women-hall.png`). | Tree cards or a photo backdrop. Fix the hall's coplanar ground. |
| 20 | Medium | **The stadium has nobody in it but the crowd, and grey where its roof should be.** | Empty umpire's chair, plain-box benches and bags (`a-court-panoramic.png`, `z-floors4.png`). Lavender wedges in the top corners of the TV frame. | An umpire on the chair, a figure on each bench, a dark roof with hanging rigs. |
| 21 | Medium | **No opening, and no walk at a change of ends.** | The first frame is the wide shot with the players in place (`m-r1-start.png`). A change of ends is a dip to black (`transitions.ts`). | A skippable opening; show the owner a real walk round the post. |
| 22 | Medium | **"TV close" loses a player for part of the rally.** | Some player's head or feet off screen: 20.7% and 3.5% of rally frames (seeds 49, 53), which shows how much it depends on the match. | Tilt it down or follow the near pair. |
| 23 | Medium | **One cut-away shot after every point.** | The same net-post shot, 23 of 23 points in doubles. It frames well there (finding 3 is singles): at least one player in shot in all 4,399 frames. | A second and third shot: the server bouncing the ball, the receiver from behind. |
| 24 | Low | Animation pops are up about a quarter. | animQa pops per minute, seeds 1301-1303: round 4 14.4 / 12.6 / 13.5, now 16.8 / 17.2 / 17.6. Fresh seeds: 1701-1706 mean 16.5, 2101-2104 mean 17.5. Limit 30, and I could not point to a visible fault. | See which recent clip adds them (upright overheads and the serve are likely). |
| 25 | Low | The free hand doesn't reach the throat in the ready stance. | Wrist to throat p50 18.4-21.4 cm (seed 53, 120 s, 1,366-2,774 frames a player), fingers spread (`b-p9-face.png`, `b-p3-hand.png`). `strokes.ts` says "the free hand on the throat". At TV distance it reads as right. | Close the hand onto the throat in READY. |
| 26 | Low | The panoramic court's clamps read as black specks on the floor. | `a-court-panoramic.png`, `z-floors4.png` bottom right. `courtView.ts:222,245,277`. | Bright steel, smaller. |
| 27 | Low | Long names are cut off in the score bug. | "Daiki Nakam...", "H. Ishik..." (`z-floors4.png`, `sheet-d-rp54.png`). | Initial and surname at a fitted size (show the owner). |
| 28 | Low | Crowd sprites bow their heads at their laps close up, and nobody follows the ball. | Behind every cut-away (`sheet-i-flost.png`). | A few look-at angles. |
| 29 | Low | The game score card lands beside the near server. | `m-r1-results.png`: "SET 1" at the serve. | Move it (show the owner). |
| 30 | Low | The ball trail reads as a string. | `z-slice-tv.png`. | A cue: show the owner a tapered ribbon. |
| 31 | Low | Autoplay's "DOUBLE BOUNCE / NEAR SIDE" reads as where it bounced. | `sheet-i-flost.png`. Attract only. | "Near side's point" (show the owner). |
| 32 | Low | "Enter skips" on a replay, whatever the device. | `hud.ts:222`. | Follow the last device (show the owner). |
| 33 | Low | Racket sounds all decay alike. | Reel byte-identical to round 4's (md5 9461d0cc, c5a5053d), so its 21-25 ms stands. Measured, not heard. | Longer tails on big hits. |
| 34 | Low | The results show pair totals only. | `e-results.png`. | A per-player column. |
| 35 | Low | A white shoe blooms into a glow at the `near` preset. | `z-flare.png` (`h-camsing-near-01.png`), seen once in 8 frames. | Clamp bloom on the shoes. |
| 36 | Low | Stray dark dashes on the stand's back wall. Polygonal shorts hem close up. | `z-dashes2.png`, `sheet-b-body.png`. | Polish. |
| 37 | Low | Three people on one banner with the same nickname. | `r-r2-start.png`: "EL RELOJERO & EL RELOJERO · YOUR PARTNER: ... EL RELOJERO". | Vary the styles in a Knock-out, or drop the nickname when they match (show the owner). |

### What holds up

- **People at TV distance.** Ten people read as different people, men and women (`sheet-a*.png`, `a-women-stadium.png`).
- **Rackets and grips.** Printed faces, drilled holes, wrist cords, and the racket hand closes on the handle
  (`sheet-b-hand.png`).
- **Eyes.** No lavender, no violet socket, no orange lid. Brown irises read as brown and catch a light (`z-eyes10.png`).
- **Strokes.** Serve, smash, bandeja, víbora, drive, volley, backhand and contrapared each have their own shape, and
  lunges read well. The serve is now upright and padel-like (`sheet-c-serve.png`).
- **Crowd.** The ovation at match point is the strongest moment in the game (`d-over61-03.png`).
- **Arenas at TV distance.** The stadium is strong, and club-night is atmospheric with clean lines
  (`a-arena-club-night.png`).
- **Doubles cut-aways.** Winners face the camera 71-74% of the time, backs 9-10% (8,798 player-frames).
- **The net at the end of a match.** The walk and the tap across it (`sheet-d-over61.png`, `sheet-d-over63w.png`).
- **Walk-back.** Partners never closer than 0.59 m in 30 matches, none under 0.40 m.
- **Animation QA.** Knee spins 0, soles never below the floor.
- **Truthful input.** Bot play, doubles seed 64: 18 of 18 swings hit, error p50 2.6, p90 4.6, max 34 ms. Singles seed
  65: 20 of 21, p50 3.4, p90 8.5, max 193 ms. What the player sees matches the input (`f-hum-tv-01.png`).
- **App.** Title, setup, settings, pause and results are clean, and the key help folds after point one. The full short
  match ran from the menus, and the results add up.
- **Load.** Ready in 2.7 s, title 3.3 s, Start match 2.07 s, Rematch 2.73 s, quit to title 1.94 s on the dev server.
  Arena to running: stadium 2.96, hall 3.41, club-day 3.29, club-night 4.51 s (9.9 s as the very first load of a fresh
  Chrome, 26 s on a cold Vite). Match and rematch are about twice round 4's 1.1 s, now that people load per match, and
  still short.
- **Sound bank.** Unchanged from round 4, and nothing clips. Peak -12 dB in the game.

## 3. Against REVIEW.md

**Corrections after the blind draft.** I give these so the blind draft isn't mistaken for what is printed above. The
draft is `tools/out/r5c-draft.txt`. Everything below came after I had read REVIEW.md unless it says otherwise.
- **Singles cut-away, Medium to High.** The draft had one empty frame and a measurement pending. Tracing it found the
  code bug, and the measurement shows it on 15 of 20 points the near player wins. It is a plain defect.
- **Contact stays High, my judgement.** The draft said High. The rate is the same as round 4, which ranked it Medium.
  I hold it at High because of what the default camera shows (`z-slice-tv.png`), not the number. One case in three is
  a thin sample, and it is the first thing to challenge.
- **Floor, High-or-Medium to Medium.** The draft left it open. It is lower fidelity, not a defect, and it is right at
  TV distance.
- **Dropped: "four people frozen at the net for 9 s".** That was autoplay running past the end, where no results come.
  In a real match it is 0.9 s stepping back plus the 1.5 s hold.
- **Dropped: "cut-aways show backs".** Job o's count read `pointWinner`, which clears partway through the walk, so it
  sometimes counted the wrong team. So did job p, whose "nobody in frame 43-61%" in doubles was false, and job o's
  feet and head figures used stale matrices. Job p2 keeps the team on camera and refreshes the matrices: faces 71-74%.
- **Dropped: club-night's load as a finding.** The 9.9 s was the first load in a fresh Chrome. A repeat took 4.5 s.
- **Down to Low:** clamps (round 4's rank, as I could not justify raising it), free hand, names cut off, crowd, pops.
- **`near` preset:** the empty frame in `sheet-h-camsing-near.png` was finding 3, not the preset.

### Each finding marked

| # | Mark | Note |
|---|---|---|
| 1 Women's kit | NEW | Comes with R4 #9's fix. Round 4 had no women. |
| 2 Re-dealt every game | REGRESSION | Comes with R4 #9's fix. Names already changed at a rematch in round 4, but the human was always p1: the person did not. |
| 3 Singles cut-away | NEW | In the code since the cut-away came in (R2 #5). Rounds 3 and 4 sampled doubles. |
| 4 Women's voices | NEW | Comes with R4 #9's fix. |
| 5 People close up | REPEAT R4 #7, R3 #21, R2 #16, R1 #10 | The eyes are fixed. Blue teeth and the shared hair are new parts. |
| 6 Contact | REPEAT R4 #27, R3 #20, R3 #6 | 15 cm or more, frame-sampled: R4 7 of 122 (5.7%), now 17 of 323 (5.3%). No change. Ranked High here, Medium in R4: see above. |
| 7 Flat floor | NEW | |
| 8 No voice, silent replays | REPEAT R4 #26, R3 #19, R2 #11 | |
| 9 Quiet mix | NEW | Round 4 could not tap the game. |
| 10 Mesh | REPEAT R4 #28 | R4: 90.3 and 87.8% at the net, ball 30.8 and 28.3%. Same in kind. |
| 11 Practice | NEW | The feature came with R4 #10. |
| 12 Knock-out | NEW | The feature came with R4 #10. |
| 13 Match win | REPEAT R4 #8 for singles; the beaten off screen NEW | |
| 14 Shoulder tears | NEW | R2 #12 and R3 #7 were the waist and the knee. |
| 15 Rigid hair | NEW | |
| 16 Overheads | REPEAT R4 #25 for the arms; late start and akimbo NEW | |
| 17 Reactions | REPEAT R4 #33 | |
| 18 Replays | REPEAT R4 #30 | The jib is now further away than the live near player, not level with it. |
| 19 Clubs and hall | REPEAT R4 #35, R3 #23's look, R1 #11 | Hall z-fighting is new. |
| 20 Stadium | REPEAT R4 #31, #32, R2 #9, R1 #12 | |
| 21 Opening | REPEAT R4 #34 | |
| 22 TV close | REPEAT R4 #29 | |
| 23 One cut-away shot | REPEAT R3 #18 | |
| 24 Pops | REGRESSION | A QA measure, within its limit. Ranked Low. |
| 25 Free hand | NEW | R2 #17 was the racket hand. |
| 26 Clamps | REPEAT R4 critic #15 | |
| 27 Names cut off | NEW | |
| 28 Crowd | REPEAT R3 #31 | |
| 29 Score card | REPEAT R3 #32 | |
| 30 Trail | REPEAT R3 #30, R2 #14 | |
| 31-34 | REPEAT R4 critic #16, #17, #19, #20 | |
| 35-37 | NEW | |

### Statuses that don't hold

- **R4 #9 "Fixed" (the same four men):** not Fixed. **Better.** Ten people, four women, nations that fit the faces,
  eight kits and the deal from the seed all hold. But the women wear men's clothes (finding 1) and have men's voices
  (finding 4), and dealing everything from a fresh seed takes away your own person (finding 2).
- **R4 #8 "Fixed" (winning the match):** **Better.** It holds for the doubles winners, who run together and embrace.
  It does not hold in singles, which still has the small gesture round 4 complained of, and which frames the near
  player's win on an empty court (finding 3). The beaten's half is true in the sim but off screen.
- **R4 #7 "Better, close to the source's limit":** "Better" holds, and the eye items hold. "Close to the source's
  limit" does not. The blue teeth are our shading, as the violet sockets were in round 3: the atlas is white. The
  shared cuts and p9's silver are our data.
- **R2 #5 "Fixed" (between points), confirmed by R4's critic:** holds for doubles only. The cut-away is broken for
  team 0 in singles.
- **R4 #29 "a fifth of the time":** the Open status holds, but a fifth is the top of the range: 20.7% and 3.5% here.

### Statuses that hold

- **R4 #10 "Better":** the Knock-out (quarter-final, semi-final, final, at club, advanced and pro) and four drills run
  from the menu. Findings 11 and 12 say why it is not more.
- **R4 #25 "Fixed for the crouch; the Y of the arms stays":** the serve is upright, and the arms still rise together.
- **R4 #26, #27, #28, #30, #31, #32, #33, #34, #35 "Open":** all still open, as marked above. For #27 I re-measured
  only the draw-time rate, not the swept-path "one in sixty".
- **R3 #9 night court:** clean lines and a readable far pair (`a-arena-club-night.png`). Seen, not re-measured.
- **R3 #10 key help:** folds after the first point. On that first point it is 18 lines over x 1085-1585, y 495-885.
- **R3 #29 pan:** eases on the match clock.
- **R4 #7's eye items:** no violet, no lavender, brown irises, catchlights, no orange band (`z-eyes10.png`).

### Round 3 items still open, re-checked

- **#24 TV graphics and floors URL-only:** still so (`src/app/options.ts`).
- **#18 one cut-away shot, #30 ball trail, #31 crowd, #32 score card:** still open, findings 23 and 28-30.

**Not checked this round:** gamepad play, R4 critic #18 (the `VS` banner at 1280 × 720), the laces and knit on the
shoes up close (my crops were from behind), and performance, which is measured separately.
