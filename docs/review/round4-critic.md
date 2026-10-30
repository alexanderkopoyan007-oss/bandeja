# Review round 4: the games critic (Top Spin 2K25 lens)

Branch phase9 at 78637a7, dev server on :5192, 30 Oct 2026. Sections 1 and 2 were written blind, then corrected for
errors found afterwards (listed at the start of section 3). Section 3 marks them against REVIEW.md. No code, data or
tracked file was changed. This report is the only new file outside `tools/out`.

**Verdict.** Nothing is Critical. There are 4 High, 10 Medium and 6 Low findings, and **no NEW finding at High**. All
four Highs repeat earlier ones. Two of those marks are judgement calls, explained in section 3.

## 1. How I reviewed

**Earlier run.** A cut-off run of this review left captures dated 07:05 to 07:12 on 29 Oct, minutes after commit
78637a7 (07:03). HEAD and the working tree have not changed since, so I reused them: every arena, court and floor
(`a-*`), each face, body and hand in rally and walk-back (`b-*`), and seven strokes frame-stepped (`c-*`). Everything
else is from this run.

**Tools**
- Capture runner: `tools/out/r4c-cap.mjs`, a copy of round 3's `r3c-cap.mjs` with an early stop at the results screen
  and a longer protocol timeout. Jobs are `tools/out/r4c-jobs-a` to `-m`. It freezes the page clock and steps the game
  at exact frames, in real Chrome on WebGPU, through `tools/one-chrome.sh`.
- To skip forward I stepped `g.tick()` with drawing off, not `sim.step`, so the replay recorder ran. The older jumped
  frames carry stale call banners, which I set aside as round 3 did.
- Contact: round 3's draw-time probe from `r3c-jobs-h.mjs` on new seeds. Also `tools/out/r4c-contact.ts` and
  `r4c-contact2.ts`, which use `animQa`'s swept-path measure, the method DECISIONS.md gives for round 3's fix.
  (`tools/out/r3c2-miss.ts` itself is not in this checkout.)
- Animation: `tools/out/r4c-anim.ts`, the Phase 3 QA written to `tools/out`, because `tools/anim-check.ts` writes into
  the tracked `docs/lab`.
- Camera coverage: a page probe (`r4c-jobs-f.mjs`, `r4c-jobs-l.mjs`) that projects the ball and each player's head and
  feet every frame, and traces the line of sight through the camera's end wall.
- Sheets: `tools/out/r4c-grid.py`, in place of `r3c-sheet.py`. Pixel measures: `r4c-px.py`, `r4c-fixed.py`.
- Sound: `node tools/audio-reel.ts`, measured with `tools/out/r4c-audio.ts` and `r4c-audio2.ts`. **I can't listen, so
  every sound finding comes from measurement or code.** I also tried to tap the live game's master bus in headless
  Chrome, twice, and got no audio blocks, so the in-game mix is unmeasured. A third test of why was queued behind the
  other reviewer and cancelled.

**Runs and samples**

| What | Sample |
|---|---|
| Seed scans | seeds 13-34, doubles and singles, up to 400 s each |
| Replays | 3 stepped at 5 Hz (both angles); rate from seeds 27-34, 2,345 s of play, 19 replays |
| Cut-aways | seed 14, one point at 4 Hz (24 frames) |
| Match ends | seed 20, plain (36 frames at 2 Hz) and `gfx=tv` (10 at 1 Hz) |
| TV graphics | seed 20, a game's end and change of ends at 1 Hz (14 frames) |
| Camera coverage | seeds 18 and 24 × 3 presets × 150 s (11,083 rally frames per preset), plus 120 s of singles |
| Contact, swept path | right-handers 791 hits (seeds 1401-1404, 1501-1512, 120 s each); with two left-handers 577 hits (1401-1404, 1501-1506) |
| Contact, draw time | seed 14 and seed 22 with left-handers, 150 s each, 122 hits |
| Animation QA | seeds 1301-1303, 120 s each, four players |
| Human play | `tools/bot-play.mjs` 75 s in doubles (seed 31) and singles (seed 32); capture bot on seeds 33-35 |
| A whole match | title, settings, controls, credits, setup, a full short set to the results (4-0, 333 s, 23 points, 2 replays), pause, rematch, quit, with the capture bot |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r4-critic/`.
The sheets, `s-*.png`, are the quickest way in. File names below are in that folder.

## 2. Findings, ranked

Nothing is Critical. The game runs from the menus to the results and is padel from every camera.

| # | Rank | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| 1 | High | **The people convince at TV distance but not close up.** The owner asked for "actual humans, extremely high def and realistic". The closest shot the game itself offers already looks like game characters, and the close cameras show why. | Close-ups (`s-faces.png`, `s-eyes.png`, `s-faces-walk.png`): lavender whites of the eyes, a violet socket with an orange band on the lid, "brown" irises drawn dark red, and a pale fringe on the lower lashes. Player 1's face has mean luminance 23 of 255 against 68 and 99 for two light-skinned faces, so it reads as a dark mask. Hair is a solid cap on three of the four. All four wear the same blank, downcast look. A neck stump with a brown faceted edge shows at the collar when the head drops (`c-face3.png`). Shoes have no laces or mesh (`b-body3-rally.png`). Budget: 37-40k triangles a person, one 3072 × 2048 atlas, the face about 420 texels wide. In the game's own shots a head is about 90 px tall at 900p, at the net after a match (`d-over20-10.png`). Top Spin 2K25 shows its faces full-frame. | Eyes first: they are the biggest gain and the cheapest. The source atlas (`c-atlas-p1.png`) has no violet or orange round the eyes, so both come from our shading. Lift the sclera (`eyeCol`, `kit.ts`), recolour the iris, warm the ambient on skin so the arena's blue and red bounce doesn't pool in the sockets, and rein in the red `bleed` at the lid's terminator (`SkinLighting`). Then a warmer fill and specular on dark skin, the neck edge hidden under the collar, laces and mesh on the shoes, and a highlight that breaks up the hair. Keep the CC0 rule. |
| 2 | High | **Winning the match is the same small gesture as winning a point.** Every match ends on it. | `s-win.png`: at "Game, set and match" the crowd is on its feet and the two winners stand 5 m apart, nearly still, each with a small movement of the racket hand. `reaction()` (`avatar.ts:1881`) plays the same upper-body `celebrate` clip as a routine point, for `OVER_REACT` 1.6 s (`match.ts:157`), over idle legs. Partners never go to each other: `overTargets` sends them straight to the net. In real padel the winners run together, embrace or drop to the floor. | A match-win stage of 3-4 s before the walk to the net: the partners run together and embrace or jump, the losers go hands on knees, the camera holds on the winners, then the racket tap, which is good and should stay. It needs one new clip or a procedural embrace. |
| 3 | High | **The same four men play every match, in the same kit, under new names.** Dealing names makes the sameness easier to see. | `views.ts:192`: `people[idx % people.length]`. `kit.ts:196`: `kitFor(idx)`, fixed by player number. `data/players/p1-4.json`: all `gender: 1.0`. The human is always p1 and the partner always p3, whatever "Partner: Random" says. Names ignore faces: seed 17 calls the middle-aged European model "H. Ishikawa" (JPN) and the East Asian model "T. Monteiro" (POR). No women, in a sport with men's and women's tours. | The pipeline exists (`tools/assets/mpfb/build-all.sh`). Build 8-12 people including women, deal them from the seed, draw each name from a pool that fits the face, and deal kit colours per match. Let the human pick a look long before any full creator. |
| 4 | High | **One mode and no teaching.** The menu is Play, Quick match, Settings, Controls, Credits. | `app.ts` title screen, `s-app.png`. There is no practice court, tutorial, tournament, career or online play. The only teaching is a key panel on the first point: about 16 lines over 13% of the frame, right beside the human (`e-hum-d-start.png`), for a game with a hold-and-release timing ring and twelve shots. Top Spin 2K25 has an academy, a career and online tours. | Owner's call: M5, M6 and the stretch goal on the roadmap. The smallest useful package is a guided first match in place of the panel, a practice court with a ball feed for the wall shots, and a three-round knock-out using the dealt names. |
| 5 | Medium | **The broadcast has no voice and no music, and replays are silent.** No umpire calls the score, and the title and results have no music. | `src/audio` and `data/audio.json`: no music or speech, only crowd formants and player grunts. `game.ts:732`: `soundscape.update(this.sim, ...)` reads the live match, which is paused during a replay, so the replay's ball, racket and glass make no sound for its 7-8 s. Replays come about every 2 minutes (19 in 2,345 s). Top Spin 2K25 has no commentary either, but its umpire calls every point and its menus have music. | Replay first, because it is cheap: feed the replay sim's events to the soundscape, slowed with the picture, under a ducked crowd. Then umpire score calls, the smallest voice with the most presence, then CC0 music. |
| 6 | Medium | **About one contact in sixty still leaves the racket 15 cm or more from the ball.** Most are low, but not all. | Swept-path QA, 15 cm or more (wider than the 13 cm half-width of a face): right-handers 13 of 791 (1.6%), with seed ranges from 0.7% to 2.3%. Runs with two left-handers: 18 of 577 (3.1%), but only 10 of those 18 were by the left-handers, which is what chance gives, so this isn't shown to be a left-handed fault. Worst: a lob at 1.97 m (64 cm), a drop at 0.96 m (56 cm), a topspin at 0.86 m (46 cm), and serves at 0.85-0.89 m (17-29 cm, six cases). These counts are lower bounds, as the QA keeps eight per seed. Draw-time probe, frame-sampled and harsher: 7 of 122, worst 44 cm (`s-misses.png` top rows, `k-miss-body-*.png`: the ball goes one side of the body, the racket the other). At the TV camera a far-side case is hard to see (`s-miss-tv.png`). Near-side ones, close cameras and slow-motion replays show them. | Look at what the worst share: the overheads and serves are scripted, so those should be fixable first. Then earlier half-volley planning, as round 3 said. A replay could also skip a point whose winner is a miss. |
| 7 | Medium | **The end-wall mesh sits over the net zone from the default camera.** | From 15.5 m back and 7.6 m up, the 3 m rail lands on the net line and the 4 m rail 7.2 m beyond it (`c-netband.png`). Rally frames: the ball is seen through the mesh 30.8% and 28.3% of the time (seeds 18 and 24). The near pair's chests are behind it in 90.3% and 87.8% of their frames at the net (3,366 and 5,589 frames), with the 3 m rail across their waists (`s-net.png`). On the Player preset it is 100%. The far pair is clear, as designed. | A choice, not a bug: any camera behind the wall sees the band somewhere. Show the owner a camera a little higher or further back, and a panoramic court without the 3-4 m band at the camera's end. |
| 8 | Medium | **"TV close" loses a player from the frame in a fifth of the rally.** | Some player's head or feet off screen: `near` 21.2% and 19.8% of rally frames (the human 10.3% and 11.5%; the ball 1.6% and 3.2%). Default TV 0.4% and 4.5% (ball 0 and 1.0%). Player 7.2% and 8.4% (ball 0.5% and 1.9%). Its bottom edge cuts the near glass, where padel's rebounds land. | Tilt it down, or follow the near pair. |
| 9 | Medium | **Replays need a last pass.** The call banner stays over the first second, and the second angle is no closer than the live picture. | `s-rp17.png` frames 14-18 and `s-rp17b.png` frames 12-14: "DOUBLE BOUNCE" sits over the replay for about 1 s. The jib shows the hitter at about 12% of frame height, the same as the live near player, with crowd filling the top third. The first angle, low behind the glass, is excellent (`d-rp17-26.png`). | Clear the call as a replay starts (HUD: show the owner). Bring the jib closer or give it a longer lens. |
| 10 | Medium | **The stadium has empty grey where its roof and stand corners should be.** | `a-stadium-1440.png`: flat grey is 17% of the top third, 5.7% of the frame, in wedges between the stands. Replays and lobs show a plain grey wall and bare skylights (`d-rp17-26.png`). | A dark roof with hanging structure, and tiers or a scoreboard in the corners. |
| 11 | Medium | **Nobody works the court.** The umpire's chair and benches are empty and the bags sit unattended. No ball kids, no coach. | `stadium.ts:189`; the empty chair is in frame beside the net in `a-stadium-1440.png`. "Game, set and match" comes from nobody. Hall and club venues have no people at all, and the neighbouring courts stand empty though you can hear them (`a-hall.png`, `a-clubday.png`). | An umpire on the chair (an idle clip and a head turn per point) and a figure or two on the bench. The stadium's crowd sprites would do for club benches. |
| 12 | Medium | **Reactions are one clip each.** | `player.bnz` holds 10 clips: one `celebrate`, one `dejected`. Only the last striker reacts, upper body only, for 1.6 s, the same after every point (`avatar.ts:1885-1890`). | Three or four of each, chosen by the point: a shrug for an error, a fist for a long rally, a shout for a smash. |
| 13 | Medium | **A match has no opening, and a change of ends has no walk.** | The first frame after the loading screen is the wide shot with the players in place (`e-hum-d-start.png`), and the serve is ready about 3 s later. No walk-on, no warm-up, no faces with names. The `VS` banner is the whole introduction. A change of ends is a dip to black and the players are across (`transitions.ts`); nobody walks round the net post or sits. | A skippable opening of 5-8 s: the arena, then each pair on a close camera with their names. Show the owner the change of ends with a real walk. |
| 14 | Medium | **The clubs' scenery is a generation behind the players.** | `a-floor-clay.png`: flat-shaded blob trees and a plain fence fill the top half of the frame on cut-aways. | Tree cards or a photo backdrop. |
| 15 | Low | The panoramic court's glass clamps read as black specks on the floor. | `g-net-pano-00.png`, `a-panoramic.png`. 7 × 10 cm, frame-coloured (`courtView.ts`). | Bright steel, and smaller. |
| 16 | Low | Autoplay's "DOUBLE BOUNCE / NEAR SIDE" means the near side won the point, but reads as where it bounced. | `hud.ts:470`, `s-rp17.png`. Attract only: the player sees "Your point". | "Near side's point" (HUD: show the owner). |
| 17 | Low | The replay tag says "Enter skips" to a player on a gamepad, where any button skips. | `game.ts:695`, `d-rp17-26.png`. | Follow the last device used (HUD: show the owner). |
| 18 | Low | At 1280 × 720 the `VS` banner wraps and reaches down to the far pair's heads for its first seconds. | `k-laptop.png`. | Scale it with the window (HUD: show the owner). |
| 19 | Low | All racket sounds decay alike: 21-25 ms to -40 dB, from the softest drop to the hardest smash. | Reel, `tools/out/r4c-audio2.ts`. Measured, not heard. | Longer tails on the big hits. |
| 20 | Low | The results show pair totals only. | `h-results.png`. No per-player line and nothing to compare with the last match. | A per-player column. |

### What holds up

- **People at TV distance.** They read as athletes, in front of a dense, believable crowd (`c-stadium-near-players.png`).
- **Strokes.** Serve, smash, bandeja, víbora, contra-pared, volley and lob each have their own shape (`s-strokesA.png`, `s-strokesB.png`). The overhead in the low replay angle is the best-looking thing in the game. The QA's "thighs through each other" count (2.6-2.9%, up to 14.8 cm) is ordinary crossover stepping: I looked at the worst cases (`s-misses.png`, bottom rows) and they look fine.
- **Timing.** Bot play: 28 of 28 swings hit and graded Perfect, error p50 2-4 ms. Typical contact is exact: p50 0.5-0.6 cm on the swept path.
- **Replays.** They work and are well chosen: 19 in 2,345 s, 2 in the 23 points of the full match, skippable, and well framed from the low angle.
- **Between points.** The hard cut to the net post (`s-cut14.png`) and the partners' racket tap feel like TV. So does the walk to the net at the end (`d-over20-10.png`).
- **The broadcast camera.** Calm: yaw rate p99 0.3°/s and no reversals in 6,142 rally frames. The ball left the frame in 0-1% of rally frames.
- **HUD.** Score, hints and rings stay clear of the play, and the key help folds after the first point.
- **TV graphics (`?gfx=tv`).** The lower thirds, game card and change-of-ends stats (`s-tvgame.png`) are ready for the owner to judge. They look more like a broadcast than the plain score does.
- **Arenas.** Club-night is good: the court matches the day court and the far pair stay readable (`a-clubnight.png`). The hall reads as the open-sided shed it is meant to be.
- **Rackets.** They hold up closest of anything: printed faces, drilled holes, wrist cords (`c-grips.png`).
- **App.** Title in 2.7-3.4 s from a warm dev server, into a match in 1.1 s, rematch 1.1 s, back to the title 1.0 s. Menus are clean and keyboard-driven. The results add up: 17 points won = 5 winners + 11 opponent errors + 1 double fault.
- **Sound bank.** Levels sit in a sensible order and nothing clips (reel peak -4.3 dBFS). Glass rings to -40 dB in 376-478 ms, the racket in about 22 ms. Measured, not heard.

## 3. Against REVIEW.md

**Corrections after the blind draft.** I give these so the blind draft isn't mistaken for what is printed above.
- **Voice, down from High to Medium.** My draft said Top Spin 2K25 has a commentary team. Round 3's report says it has none, which matches what I remember. Without commentary as the comparison, the gap is the umpire, music and silent replays, which is Medium, as round 3 had it.
- **Contact, narrowed.** My draft said low balls and left-handers were the problem. Twelve more seeds put the rate on round 3's measure, showed misses on non-low balls too, and gave no left-handed excess.
- **Counts corrected.** Replay rate (2,345 s, not 2,700 s), frames at the net, and total hits.
- **Softened comparisons.** I removed a claim about how Top Spin's heads are made and one about what its menu opens on, as I can't check either here.

### Each finding marked

| # | Mark | Note |
|---|---|---|
| 1 People close up | REPEAT R3 #21, R2 #16, R1 #10 | **Raised from Medium to High, my judgement.** The owner's request is the yardstick, and the eye and socket faults are ours rather than the source's (see below). |
| 2 Match win | REPEAT R3 #5 (the celebration half) | **Judgement call.** R3's text said "no celebration", so I mark it REPEAT. The freeze-frame fix itself holds. If the owner reads the flat celebration as a separate problem, this is the one High that would count as new. |
| 3 Same four men | REPEAT R3 #11 (the looks half), R1 #10 | R3's fix dealt names, not "looks". The clash between names and faces is NEW and comes from that fix. Roster: M5. |
| 4 One mode, no teaching | REPEAT R3 #11, R1-R2 later milestones | Roadmap: M6, stretch. |
| 5 No voice, silent replays | REPEAT R3 #19, R2 #11 | Silent replays are in OPEN_QUESTIONS, not in the review table, so that part is NEW to it. |
| 6 Contact | REPEAT R3 #20 and #6 | Non-low and serve misses extend #20. |
| 7 Mesh band over the net | NEW | DECISIONS.md and OPEN_QUESTIONS.md cover the far pair only. The near pair at the net is what's behind it. |
| 8 TV close crops | NEW | The preset came with R3 #8's fix. |
| 9 Replay banner and jib | NEW | The feature came with R3 #8's fix. |
| 10 Stadium grey | REPEAT R2 #9, R1 #12 | Open. |
| 11 Nobody works the court | REPEAT R3 #19 and R1 #12 for the empty chair | Ball kids, coach, and the empty clubs and neighbour courts are NEW. |
| 12 One clip each | NEW | R3 #18 is about the camera, not the bodies. |
| 13 No opening, no walk at change of ends | NEW | R2 #5 covered between points only. |
| 14 Club scenery | REPEAT R1 #11 | No status recorded. |
| 15-20 Low | NEW | |

No finding is a REGRESSION in the strict sense. The nearest is the name and face clash in #3.

### Statuses that don't hold

- **R3 #21 "limited by the CC0 source":** not for the eyes. The atlas's skin round the eyes has no violet or orange, and its sclera is near white (`c-atlas-p1.png`). The violet is the arena's bounce in the sockets, the orange is `SkinLighting`'s red bleed at the lid, and the lavender is `eyeCol` darkening the sclera. Only the red iris is in the source, and that can be recoloured.
- **R3 #5 "Fixed":** holds for the freeze-frame, the walk to the net, the tap and the net camera, all seen. "Everyone reacts" is true, but the reaction is a point's clip, so the "no celebration" half is **Better, not Fixed**.
- **R3 #11 "Names fixed":** the names work and the nations show. But the same finding's direction said "looks" too, and the names now contradict the faces. **Better.**
- **R3 #8 "Fixed":** holds for replays and for having presets. The TV close preset loses a player in about 20% of rally frames, so OPEN_QUESTIONS' "checked only in captures" was the right caution. **Replays Fixed, presets Better.**

### Statuses that hold

- **R3 #6 "Better" (1.25% over 15 cm):** holds on its own measure. Right-handers 13 of 791 (1.6%), and 9 of 599 (1.5%) on the same 12 × 120 s shape. The two seed ranges, 2.30% and 0.68%, differ by more than that gap. Over 10 cm: 19 of 599 (3.2%) against its 2.7%.
- **R3 #7 "Fixed" (legs at the hem):** no holes or flaps in a deep squat, a wide lunge or the net shot (`s-hems.png`).
- **R3 #9 "Fixed" (night court):** line-to-turf contrast 1.84, measured my way, the same as the day court's 1.84 and in line with its 1.86.
- **R3 #10 "Fixed" (key help):** folds after the first point, and the H hint shows (`e-hum-d-end.png`, `s-hems.png`).
- **R3 #23 "Fixed" (hall gable):** the gable is there. Grass and trees still fill the opening below the eaves, as an open-sided shed should.
- **R3 #29 "Fixed" (pan):** eases on the match clock (`views.ts:477`).
- **R2 #5 (between points):** walk back, racket tap, cut-away.
- **R1 #1 (crowd):** people, not blocks.

### Round 3 items still open, re-checked

- **#18 One cut-away shot:** still the same net-post shot after every point (`s-cut14.png`). It feels like TV once; variety is still missing.
- **#20 Half-volleys:** see finding 6.
- **#22 Stiff poses:** both arms still go up in the Y before a bandeja, and the serve still starts from the deep squat (`s-strokesA.png`).
- **#24 TV graphics and floors URL-only:** still so. The setup screen has no floor item and Settings has no score style.
- **#30 Ball trail:** still a thin line (`b-body3-rally.png`).
- **R2 #17 Grip at rest:** much better. Close up the fingers still sit loosely (`c-grips.png`).

**Not checked this round:** R3 #31 (crowd detail) and #32 (score card placement), gamepad play, Enter skipping the match end, and performance, which is measured separately.
