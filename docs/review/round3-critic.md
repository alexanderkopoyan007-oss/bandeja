# Review round 3: the games critic (Top Spin 2K25 lens)

Branch phase9 at 875fa99, dev server on :5192, 29 Oct 2026. Written blind first (sections 1-2), then marked
against REVIEW.md (section 3). No code, data or tracked file was changed.

## 1. How I reviewed

**Tools**
- `tools/out/r3c-cap.mjs` (scratch): one headless Chrome per batch, always through `tools/one-chrome.sh` (12
  launches in all). It can freeze the page clock (`performance.now`) and step the game at exact 1/60 s or 1/120 s
  frames (`Game.tick()` then `renderOnce()`, so the skin is fresh). It can also jump the sim alone (`sim.step`), drive
  the menus with keys and clicks, and run the `bot-play.mjs` player inside the page while Node takes screenshots at
  cue moments.
- An in-page contact probe (in `tools/out/r3c-jobs-h.mjs`). Every 1/120 s it measures the racket's face centre (the
  racket group's origin, `racket.ts`) against each `E_HIT` contact point, ±60 ms around the contact. It ran on two
  matches of 150 s: seed 7, and seed 5 with left-handers 1 and 2.
- `tools/out/r3c-sheet.py`: contact sheets and crops (PIL).
- `node tools/audio-reel.ts`: the listening reel and spectrograms. I measured envelopes, peaks and grunt pitch with
  python. **I could not listen** (no audio out here), so sound findings come from code, data and measurements only.
- Code read: `render/views.ts` (camera), `ui/hud.ts`, `ui/tv.ts`, `ui/transitions.ts`, `app/app.ts`, `app/options.ts`,
  `render/arena/*`, `audio/*` (soundscape, engine, voices), `data/arenas.json`, `data/audio.json`, `FEEL.md`.

**URLs** (all `http://localhost:5192/`): `?autoplay=1&seed=7` with `arena=stadium|hall|club-day|club-night`,
`court=panoramic`, `mode=singles`, `mode=singles&court=singles-narrow`, `floor=clay|hard|carpet`, `gfx=tv`,
`cam=face&camp=0..3`, `cam=hand`, `cam=body&camp=0|1|2|3`, `cam=ball`, and `sets=1&games=1`. Also seed 5 with
`lefty=1,2`; the app at `/` (title, setup, settings, Quick match, pause, a full match to the results); and human play
at `?seed=5` (doubles) and `?seed=3&mode=singles`.

**Captures.** All in `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r3-critic/`
(called `r3-critic/` below). There are 46 single captures and 12 frame sequences (112 frames). Sheets: `sheet-*.png`;
crops: `crop-*.png`.

| Group | Files |
|---|---|
| Arenas, courts, floors (TV camera, seed 7 at 12.9 s) | a-stadium, a-hall, a-clubday, a-clubnight, a-panoramic, a-singles, a-narrow, a-floor-clay/hard/carpet, f-night-rt, g-stadium-4k (3200×1800); sheet-arenas, sheet-courts, sheet-floors |
| TV graphics | a-tv-start, a-tv-point, a-tv-game; sheet-tv |
| People up close | b-face0..3, b-face0-walk, b-hand0, b-hand2-contact, b-body1, b-ball; sheet-faces, sheet-close, crop-face2-hair, crop-face1-collar, crop-body1-hem |
| Motion (frames every 0.05 s unless noted) | c-smash-tv, c-smash-body (smash, 63.8 s), c-bandeja-body (10.7 s), c-serve-body (every 0.1 s), c-contra-body (37.7 s), c-between (every 0.5 s, 16.4-23.4 s), f-net, f-glass, i-drive-p2, i-volley-p1, i-contra-p2 (the worst contacts); sheet-smash-*, sheet-bandeja-body, sheet-serve-body, sheet-serve-knees, sheet-between, crop-between-tap, crop-knees, sheet-misses |
| App | d-title, d-setup, d-settings, d-loading, d-match-start, d-pause, d-dead (every 0.25 s), d-game (every 0.5 s across a game end), d-results |
| Human play | e-human-d-00..03, e-human-s-00..03 |
| Match end | f-over-step, f-over-jump, j-end-a/b (real-time loop), k-end (every 1 s after match point); sheet-over, sheet-end-rt, sheet-k-end |

**Artefacts I set aside.** Where I jumped the sim (`simTo`), the HUD shows banners from points it skipped (the
"CHANGE OF ENDS" and "INTO THE NET" in sheet-misses). Two captures that ran the clock backwards after a freeze showed
empty stands (f-over-step-rt, d-results). With a forward clock the crowd stays (j-end-a/b), so I don't report it.
The results stats in d-results are wrong only because I sim-stepped 860 s past the stats' event reader. The TV lower
third in a-tv-point was caught mid-wipe.

**What holds up against a 2K game** (not ranked):
- Load: the title is up at 2.7 s (`__loadLog` "shown" 2675 ms).
- The input path: the bot went 8/8 Perfect in doubles (p50 2 ms) and 11/11 in singles (p50 4 ms).
- The rackets: printed faces, drilled holes and wrist cords (c-bandeja-body-10, f-glass-03/04).
- The felt ball with its seam (b-ball, f-net).
- Points end on the walk back, a racket tap and the cut-away (sheet-between).
- The menus are clean and quick.

## 2. Findings, ranked

Nothing is Critical: every mode loads and plays, and the human's input path is exact.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **A match ends on a freeze-frame.** After match point the ball hangs in mid-air and the four players stand frozen where they were. The camera swings round as if for a change of ends, and then the menu comes up. There is no celebration, no handshake at the net and no applause shot. The end of a match is the moment a 2K game spends most on. | **k-end-00..03** (seed 7, `sets=1&games=1`, 1 s apart after match point): from sim 467.5 to 470.5 s the ball stays at (-0.41, 0.38, 3.78) and every player's position is unchanged (logged each frame). k-end-00 is mid camera swing. Also sheet-end-rt (real-time loop: the same pose at 471.5 s) and f-over-step. **Code:** match.ts:548-551 (PH_OVER only advances the clock); game.ts waits 3.2 s, then calls `onMatchOver`. | Drop the ball and let the bodies play an end-of-match sequence. The winners react, both pairs walk to the net to shake hands, and the cut-away camera frames it (it exists for the walk back). Skip the change-of-ends swing after the last game. |
| 2 | High | **The racket misses the ball on about one contact in twelve.** The median contact is right (1-4 cm from the face centre). But 11 of 132 contacts are more than 15 cm off the face centre, and the worst are 56-66 cm: the ball leaves with nothing near it. They are low balls: drives at the feet, low volleys, a contrapared, plus a víbora. | **Probe** (face centre to the sim's contact point, closest within ±60 ms): seed 7 had 71 contacts, 6 over 15 cm, worst a drive by p2 at 109.23 s (ball at 0.20 m) 56 cm, a víbora by p3 at 106.68 s 29 cm, a drive by p0 at 132.36 s 27 cm, a lob 24 cm. Seed 5 (lefty 1,2) had 61 contacts, 5 over 15 cm: a volley by p1 at 52.91 s (0.42 m) 66 cm, a contrapared by p2 at 89.84 s (0.68 m) 62 cm, a serve 28 cm, a drive 27 cm. **Captures:** sheet-misses. In row 1 the racket is at chest height while the ball comes up off the floor a metre away. In row 2 the lefty's racket is behind his shoulder as a knee-high ball passes in front. | Add these shot kinds to animQa's per-shot thresholds (low drives, low volleys, the contrapared, the víbora). The low-ball path needs the racket head dropped and the lunge within reach before contact. Where the body can't get there, the sim should stand down or frame the shot rather than hit through air. |
| 3 | High | **Legs come apart at the shorts' hem, and it shows in the game's own between-points shot.** There is a hole in the back of the knee with the court showing through it. The thigh skin ends in saw-tooth flaps that stick out of the shorts. The far players show pale knee patches even from the broadcast camera. | **crop-knees** (from c-between-03, which is the in-game cut-away at the net post, 1600×900): a hole through the dark-skinned player's knee shows the court. **sheet-serve-knees** (c-serve-body 02/04/05/07): jagged skin flaps at the hem in every frame. **crop-glass04-knee:** a gap between the thigh and the shorts with the court behind. **crop-4k-far** (g-stadium-4k, broadcast camera at 2×): pale patches on both far players' knees. The back hem is clean now (c-smash-body-09, crop-body1-hem). | The same build-time pass that fixed the shirt's back (`cut_shorts_under_shirt`) is needed for the shorts' leg hem. Keep skin under the hem to a few cm past it. Weight the hem ring and the knee seam to the thigh bone, and push the hem out along the normal, never in. Add a back-of-knee check to people.test.ts. |
| 4 | High | **One locked camera and no replays.** The broadcast camera never moves. It sits 7.6 m up and 15.5 m behind the glass with a constant 26° lens. Its only motion is a pan of 12% of the ball's x, a tilt for lobs, a smash kick and the change-of-ends swing. There is no replay of a winner, no slow motion, no player-side or low camera, and no camera choice in Settings. In Top Spin 2K25 the camera presets, the replay after a big point and the between-points cinematics are half the presentation. | **Code:** views.ts:279-281 (CAM_BACK 15.5, CAM_HEIGHT 7.6, FOV 26); views.ts:393-400 (the position depends only on the end and lookX); views.ts:434 (the one cut-away, only while walking). Nothing in src implements a replay (grep). **d-settings:** no camera item. **sheet-smash-tv:** a 35.8 m/s smash winner gets no camera reaction beyond the kick, and there is no replay after the point (c-between). | Replays are cheap here: the sim is deterministic, so a point is its seed plus inputs. Keep the last point's input frames and re-sim it with a replay director: two or three angles (low behind the hitter, side at the net, ball-follow), with slow motion near the winning contact. Add two or three camera presets to Settings (TV high, TV low, behind the player). |
| 5 | High | **The night court is blown out to a glowing lime slab, and its lines nearly vanish.** The night turf renders more than twice as bright as the same club by day. | **a-clubnight**, f-night-rt (real-time), a-floor-carpet. **Measured:** the near-court patch at night is RGB (209,233,146) against its albedo `#4a7c36` (74,124,54); by day it is (97,131,81) against `#3f7d3d`. Down the centre line (x 800, y 450-880) the night turf's median luminance is 234 against the line's 251, a contrast of 1.07. By day it is 124 against 210; in the stadium, 88 against 240. **Data:** arenas.json club-night light.floods intensity 95, decay 1.2. | Expose the night from the lit court: bring the floods down until the turf sits near its day luminance. Keep the darkness beyond the fence, and let the floods' falloff show towards the corners (real night courts are bright in the middle and darker at the glass). Add a test that samples line-to-turf contrast in every arena and floor. |
| 6 | High | **The controls panel covers the near-right quarter for the whole match.** It is 11 lines of key help, about 500×390 px of a 1600×900 frame. It sits where the human or their partner plays, and it is still there after 75 s of a menu-started Quick match. (HUD: the owner's call, so describe and show first.) | **d-match-start** (2.2 s into a Quick match from the title), **d-game-05** (75 s: the panel cuts off the partner's racket side), e-human-d-02, and every TV capture without `gfx=tv`. **Code:** hud.ts:192 (made visible); hud.ts:260-264 (only H hides it, and it isn't remembered). | Direction, to show the owner before building: show the panel before the first serve of a player's first match only, then fold it to one "H controls" key cap. The contextual hints (pills like "Let it come off the glass", e-human-s-03) already teach in play, and the pause menu has Controls. |
| 7 | High | **It is an exhibition game.** Play and Quick match are the only modes, and the four AI opponents are named by playing style ("YOU · Martillo", "Serpiente · Muro"). There is no player, no character, no career, no tournament, no unlocks and no online play. A 2K reviewer would score the package on this before the first rally. | **d-title, d-setup:** Mode, Opponents, Partner, Opponents' style, Venue, Court, Scoring, Length, Hand. **d-match-start:** the score bug and "VS LA SERPIENTE & EL MURO". | Roadmap (M5/M6). In the meantime, deal fictional names, nations and looks from the seed and show the style as a subtitle (cheap and in data), so a match is against someone. |
| 8 | Medium | **Every point is followed by the same single shot.** The between-points package works (walk back, racket tap, cut-away), but it is one camera: the net post 1.7 m up, framing the pair that won the point. Then it cuts back to the broadcast angle. There is no close-up of the server bouncing the ball, no losing-pair or crowd shot, and no variation by how the point ended. By the third game it reads as a loop. | **sheet-between** (every 0.5 s from 16.4 s): wide, then the post cut-away from frame 2 to 9, then wide again from frame 10 for the serve. **crop-between-tap:** the tap. **Code:** views.ts:294-298 (CUT_HEIGHT 1.7, CUT_POST 0.7, CUT_NET 0.8, CUT_FOV 34), views.ts:434. | Give the cut-away director a few shots and a rule for choosing among them. Use a close-up of the hitter after a winner, the pair from the other post, a slow push-in on the server at the bounce, and a crowd or bench shot after long rallies. Never use the same shot twice in a row. |
| 9 | Medium | **There is no voice anywhere.** No umpire calls the score, faults or lets aloud; the chair at the net is empty. There are no line calls, commentary or music (the menus have only wooden ticks). The crowd and players are all synthesised: bursts of applause, cheers and grunts. Top Spin 2K25 has no commentary booth either, but its umpire calls every point and its menus have music. | **Code:** no voice or umpire in src/audio; announce.ts is an ARIA live region only; engine.ts:386 has the menu ticks only. **Captures:** a-tv-game (the empty chair, at the change-of-ends swing). **Reel** (`r3-critic/audio/`): applause big 3.6 s (attack 0.87 s, peak -14 dBFS), cheer 2.0 s, ooh 0.94 s. Grunts are 0.22-0.31 s formant voices at f0 120-200 Hz. I could not listen. | Score calls in Spanish and English: CC0 recordings, or the formant voice for "falta" and "let". Seat an umpire in the chair, using the crowd's MakeHuman pipeline. Add a menu music bed and a short sting at games and sets. |
| 10 | Medium | **Close up, the people look like stock MakeHuman.** The skin is matte and doesn't vary. The dark-skinned player goes purple-black in shadow. The hair is a dark helmet with see-through slits between the cards at the crown. Faces hold one neutral look. Fine from the TV camera, plain in the cut-away and the change-of-ends swing. | **sheet-faces** (b-face1..3, b-face0-walk), **b-face0**. **crop-face2-hair:** slits at the crown, showing the stands. **crop-face1-collar:** magenta-purple in the cheek's shadow. | Skin: a thin subsurface/sheen term and a skin-tone-aware shadow tint, rather than the arena's blue/red bounce. Hair: denser cards at the crown or a dark scalp layer under it; it has one at the hairline. Faces: a little effort and reaction morphing at contact and after points, from the face rig that already moves. |
| 11 | Medium | **Overheads and the serve have stiff, odd poses.** Before a bandeja both arms go straight up in a "Y" and hold it for about 0.3 s. The contact comes beside the head with the forearm folded across the face. The free hand goes to the hip right after a smash. The serve is played from a deep squat (knees near 90°, trunk about 45° forward) from the bounce through contact. | **sheet-bandeja-body:** frames 3-8 show the Y; frame 10 (40 ms after contact) and **crop-bandeja-face** show the forearm across the face; the event's contact is at 1.92 m. **c-smash-body-09:** the free hand on the hip. **sheet-serve-body:** frames 0-6 in the squat. (R2's measured side-on angles still hold: chest turned at contact.) | Bandeja: racket up behind the head with the elbow at shoulder height, and the free arm pointing at the ball (one arm up, not both). Contact in front of the hitting shoulder with the arm near straight, finishing forward and across. Smash: the free arm folds into the chest. Serve: a slight knee bend and a waist-high contact, with the trunk near upright. |
| 12 | Medium | **The hall still looks like an outdoor club.** From the game camera you see grass, trees and sky past the far glass and a grey surround. The roof and its lights are never in frame. | **a-hall** (sheet-arenas, top right). **Geometry:** the camera is at z 25.5 (views.ts CAM_BACK 15.5 + half-length 10); the shed ends at z 15 (arenas.json hall.hall.z), with the roof at 9 m rising 1.6 m. The roof's front edge is 7.6° above the camera's eye line; the top of the frame is 2.2° below it (look-at pitch 15.2° down, half of the 26° lens). | Lengthen the shed past the camera (z of 27 m or more), or build the camera's end wall with its doors and lights. Lower the hall's roof line into frame, or give the hall its own camera height under the eaves. |
| 13 | Medium | **The better presentation can't be chosen in the game.** The TV graphics package (`gfx=tv`: score bug with logo, lower thirds, radar gun) and the floor choice (clay, hard, carpet) are URL-only. A player from the menus always gets the plain bug and turf. | **Code:** options.ts:150 (`floor: 'turf'` for every menu match); optionsFromSetup passes no `gfx`. **a-tv-start, a-tv-point, a-tv-game** (the package works); **sheet-floors** (the floor looks work). | Once the owner has seen the TV package (it is behind the flag for that reason), add it as a Settings choice ("Score: plain / broadcast"). Add Floor to the match setup, next to Court. |
| 14 | Low | **The camera's pan depends on frame rate.** The pan's smoothing is a fixed 5% a frame, so at 144 Hz it follows the ball 2.4× faster than at 60 Hz. The tilt beside it is done on the match clock. | **Code:** views.ts:396 `this.lookX += (ballX * 0.12 - this.lookX) * 0.05;`; the tilt (views.ts:430) uses `1 - exp(-dt / TILT_LAG)`. | `1 - Math.exp(-dt / tau)` on the sim's dt, as the tilt does. |
| 15 | Low | **The ball trail reads as a string tied to the ball.** On a lob it is a thin line from the ball to the top of the frame. (A cue: the owner's call.) | **sheet-smash-tv** frames 0-7: the line from the lobbed ball up out of frame. | Direction to show the owner: a short tapered ribbon that fades, or the trail only while the human is taking the ball. |
| 16 | Low | **The crowd are cut-outs at 2×.** All are seated with the same lean and face the court the same way. Nobody follows the ball. The lighting is flat with no rim or shade from the floodlights. They do stand for the big moments. | **crop-4k-crowd** (g-stadium-4k), **sheet-over** (f-over-step: the ovation, people standing). | Turn the head of the sprite's view cell towards the ball (there are 7 angles already), and pick from two or three seated poses per person. Add a light gradient across the stands from the court. |
| 17 | Low | **The game score card lands on the near pair at the serve.** The card after a game sits at 62% of the height, between the server and the partner, for 2.8 s while the serve is set up. (HUD: describe, show first.) | **d-game-05** (the "SET 1" card beside the receiver's ring and the near players). **Code:** transitions.ts CSS `.card` top 62%, CARD_SECS 2.8. | Direction: put it in the upper third over the far stands, or in the cut-away before the serve. |

## 3. Against REVIEW.md (rounds 1 and 2)

| # | Mark | Note |
|---|---|---|
| 1 Freeze-frame match end | NEW | |
| 2 Racket misses on low balls | NEW | Round 2 #7 measured bajadas only. These are drives, volleys, a contrapared and a víbora; there was no bajada in my 300 s. |
| 3 Knee hole and hem flaps | REPEAT R2 #12 | That finding already named "a notch in the knee and a white edge inside the shorts' hem". Its fix covered the back hem only. |
| 4 One camera, no replays | REPEAT (rounds 1-2 "Not ranked: later milestones", M7) | Ranked now because the comparison is a shipped 2K game. |
| 5 Night blown out | NEW | |
| 6 Controls panel | REPEAT R2 #10 (Open) | I rank it High, not Medium: it is in every match, over a player. |
| 7 Exhibition only, style names | REPEAT R2 #18 (names, Open) and the later-milestones list (M5/M6) | |
| 8 One cut-away shot | NEW | R2 #5's fix holds; this is about variety. |
| 9 No voice, empty chair, no music | REPEAT R2 #11 (umpire calls, Open) and R1 #12 (the chair as bare dressing) | Music is NEW. |
| 10 People close up | REPEAT R1 #10 and R2 #16 | |
| 11 Overhead and serve poses | NEW | R2 #4's measured fix (chest angles) holds; this is the arms and the squat. |
| 12 Hall reads outdoor | REPEAT R2 #8 (Open) | Unchanged. |
| 13 TV package and floors URL-only | NEW | R2 #15 noted "URL-only" as a side remark; its "Fixed" was the floor's look. |
| 14 Pan smoothing per frame | NEW | |
| 15 Ball trail | REPEAT R2 #14 (Open) | |
| 16 Crowd cut-outs | REPEAT R1 #1 (Fixed) | The fix holds; these are Low polish notes. |
| 17 Score card placement | NEW | |

**Round 1-2 statuses that my captures don't support**
- **R2 #12 "Fixed" (clothes clip):** holds for the shirt's back hem. Back views are clean in c-smash-body-09, c-bandeja-body and crop-body1-hem. But the knee notch and the shorts' hem edge named in the same finding are still there. They now show in the game's own cut-away (crop-knees from c-between-03), in sheet-serve-knees and in crop-glass04-knee, and as pale knee patches at 2× from the TV camera (crop-4k-far). **Better, not Fixed.**
- **R2 #16 "Fixed" (hair):** the hairline is soft now, but the crown still shows slits between the cards with the stands behind (crop-face2-hair). **Better.**
- **R2 #7 "Fixed at the cause" (bajada misses):** I can't check bajadas (none in 2 × 150 s). The same failure, a racket 25-66 cm from the ball at the sim's contact, is on other low and wide shots in 8% of contacts (finding 2). The class isn't closed.
- **R2 #15 "Fixed" (floor look):** holds for the look (sheet-floors: clay, hard and carpet differ from turf). But the floor still can't be chosen outside the URL (options.ts:150). Carpet at night is blown out like the turf (finding 5).
- **R2 #1 "Not reproduced" (missing lines):** holds. Lines are there in the hall, club-day, club-night and singles-narrow (sheet-arenas, sheet-courts). At night they are washed nearly out by exposure (finding 5), which may be what was seen.

**Statuses that hold:** R1 #1 (crowd of people, not blocks: crop-4k-crowd), R1 #7 (no grey waistband band), R2 #4
(overheads side-on at contact: sheet-bandeja-body frames 9-11), R2 #5 (walk back, racket tap, cut-away, the server's
bounces: sheet-between, crop-between-tap).

**Better than its status:** R2 #19 ("VS" banner over the boards, Open): d-match-start shows it on a dark backing
plate, readable over the boards.

**Not checked this round:** R2 #17 (grip at rest), the AI and pro-figure findings (the padel pro's half), and
performance (nothing looked slow in play; I didn't run `npm run perf`).
