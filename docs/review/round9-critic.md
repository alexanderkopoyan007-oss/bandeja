# Review round 9: the games critic (Top Spin 2K25 lens)

Branch phase9 at 57fb7e1, dev server on :5192, 31 Oct 2026. Findings were drafted blind in `tools/out/r9c-draft.txt`, saved at 05:56 before
I opened REVIEW.md or the round 8 reports. Changes made after that are listed at the start of section 3. No code, data or other tracked
file was changed. This report is my only new file outside `tools/out`.

**Verdict.** Nothing is Critical. There are 3 High, 26 Medium and 12 Low findings.
- **Two Highs are NEW, and both are about how they move.** The bandeja and víbora are hit before the swing: the racket is still at
  1 m/s a tenth of a second before the ball, and three quarters of the stroke's travel comes after it. And players who have reached their
  place keep tapping their feet on the spot, six lifts a second, with the body still.
- **The third High is the faces,** the known MakeHuman limit, still the worst thing in a close-up. It isn't new.
- **Round 8's fixes are real, and four "Fixed" rows are too strong.** Weight went in for a player running forwards, not for the side
  shuffle, and a hard stop still leans the wrong way. The walk's feet are fixed while the player walks; the tap starts when he stops.
  Pops of 15 degrees or more run 2.8-3.3 a player-minute, not 2.1. The racket keeps its speed after the ball and still dips on it.
- **One Medium is a REGRESSION, a side effect of a good fix.** The walk back now faces where it's going, so the cut-aways, the game's one
  close look at its people, show their backs: facing the lens 80 to 49%, backs 9 to 40%, on round 8's own seed. See finding 6.

## 1. How I reviewed

**Tools.** The dev server in real Chrome through `tools/one-chrome.sh` (`tools/out/r9c-cap.mjs`, a copy of the earlier runners, stepped frames
and live play). `tools/bot-play.mjs`. `runAnimQa` at 120 Hz in Node for pose, feet, speed and pops (`tools/out/r9c-*.ts`). `git archive`
trees of 8fd6459, c660d41, 712c1d4, 20eb7e9, 0873392 and 1d6880b, to date anything that looked like a regression. `node tools/audio-reel.ts`.
The Browser pane with `backend=webgl`, for stepped stills and probes while Meridian fleets held the Chrome lock, for about 100 minutes early on and again from 06:20.

**Runs and samples**

| What | Sample |
|---|---|
| Arenas, courts, floors | 4 arenas, 3 courts, 4 floors, real Chrome, 1600 px |
| People | face p1, p2, p7, p8, p9, p10; body p1, p7, p9; hand p1, p7. Stills |
| Strokes, stepped | HUD-free strips: serve, drive, volley, slice, bandeja, smash, víbora, chiquita, lob (men); drive, smash, bandeja, serve, volley (women) |
| Pose against the footage table | p1 seeds 3701-3703, p7 seeds 3901-3903; overheads 3901-3908; bandeja elbow on unseen seeds 4201-4214 (n 40, n 52 at 8fd6459); víbora 4101-4106 with serpiente players (n 10) |
| Racket speed through time | p1 seeds 4201-4208, p7 seeds 4301-4308, 120 s each: 45 bandejas, 10 víboras, 37 smashes, 91 drives, 125 slices, 210 volleys, 138 serves, 101 lobs |
| Feet and flight | p1 seeds 3701-3703 and 3801-3802, p7 seeds 3901-3903 and 3801-3802, 120 s each |
| Foot tap | 84 and 75 player-seconds at the end of the walk, 78 and 103 in the set-up; 76 at 8fd6459 |
| Weight | p1 and p7, seeds 3701-3703 and 3901-3903, about 10,000 frames each way |
| Pops | seeds 3901-3904 and 3701-3704, 32 player-minutes each |
| Pace | seeds 131-138, 240 s, 114 points; women 151-154, 62 points |
| Replays | stepped: men's 136 and women's 153; rate from seeds 131-145 and 151-156, 130 s each, 21 replays |
| Match ends | doubles with `gfx=tv`, women's, singles, change of ends; sim stepped on to the end |
| Camera coverage | seed 140, 3 presets, 150 s, 4,953 rally frames; cut-aways seeds 141, 148 (Chrome), 111, 115 (pane), 170 s each |
| Contact | as drawn in Chrome, seeds 143-145, 153, 261 hits; as drawn in the pane, seeds 116, 117, 128 hits; Node, same measure, 1,312 hits on HEAD, 1,312 on c660d41, 837 on 8fd6459 |
| Human play | `bot-play.mjs` doubles and singles; the capture bot in live matches (doubles, `gfx=tv`, singles, women's); racket as drawn seeds 146, 147 |
| The app | cold load, settings, setup, start, pause, full short match, results, rematch; drills Side glass and Lobs and overheads; Knock-out round one to round two |
| Sound | reel of the impact and crowd banks, read and measured; I can't listen |

**Captures:** `/private/tmp/claude-501/-Users-alexanderkopoyan/f0a8b35e-578b-4e34-9b0f-8b799ee54184/scratchpad/r9-critic/`. I viewed 17 sheets
(`sheet-*.jpg`), and the file names below are in that folder.

**Set aside.**
- Two low-camera strips from the hidden pane were badly framed (`sheet-walk.jpg`, `sheet-tap.jpg`) and settled nothing. The tap's proof is
  the real-Chrome strip `sheet-tap2.jpg`.
- A bot run in the hidden pane was invalid: its timers are throttled, 4 hits. I kept only its HUD text.
- Stale banners after sim jumps. Bandeja and smash strips stop just short of the ball because of where the job's window fell, so I use them
  for the shape only, and the speeds for the timing.
- `sheet-p-ban.jpg` is from the pane (WebGL), checked against numbers from Node. I judge the pose in it, not its lighting.

## 2. Findings, ranked

Basis: M measured, J judgment. Real-world figures are named; "general" means ordinary biomechanics or coaching knowledge, not a padel paper.

| # | Rank | Finding | Evidence | Basis | Fix direction |
|---|---|---|---|---|---|
| 1 | High | **The bandeja and víbora are hit before the swing.** The player holds the trophy pose, the ball leaves, then the arm comes through. The shape is close to the video, which is why this reads as a timing fault. It's the sport's signature stroke, and replays run it at 0.35×. | Bandeja, n 45 (p1 22, p7 23): racket 1.0-1.1 m/s at -100 ms, 1.6-1.7 at -66, 4.8-5.0 at -33, 7.5-9.2 at contact, 11.1-14.3 at +17. The sim's face speed is 15.4-16.0, so the drawing has 47-60% of it at the ball. Path in the 0.3 s before 0.49-0.59 m, after 1.81-1.84 m. A drive: 5.7-6.1 m/s at -100 ms, 1.72 m before, 1.61-1.69 after. Víbora, n 10: 1.4-1.6 at -100, 7.9-8.6 at contact, 13.0-13.8 at +17, sim 18.8-20.5, path 0.58-0.63 and 1.77-1.85. Fastest elbow opening +58 ms (n 18, noisy, -8 to +75). `sheet-p-ban.jpg`, seed 131, hit 113.56: trophy unchanged at 113.55, racket at the chest by 113.60. Video: the free hand goes 0.5 at -0.3 s to -0.5 at +0.1, so the body unwinds through the 0.3 s before the ball; game 0.82 at -0.2. No published swing time exists; a real forward swing of 0.2-0.3 s is general | M | Start the forward swing about 0.2 s before contact and put the speed before the ball. Retime the OVERHEAD and VIBORA keys around contact, then re-measure the elbow and the follow-through |
| 2 | High | **Feet tap on the spot once a player reaches his place.** The walk ends, the body stops, the feet go on: left, right, left, a little sewing machine under a still player. It runs through every wait in a walk back and, less often, in the set-up. Cut-aways have the feet in frame, and at TV it's the one thing moving on a still player. | Speed under 0.3 m/s for over 0.35 s, walking: 6.21 lifts a second per player, 4.3 cm high (p90 4.9), travel 0.2 cm (p1, 84 player-s); 6.20, 4.5 cm, 0.2 cm (p7, 75 player-s). Set-up standing 2.84 and 2.70 a second, 4.4-4.6 cm (78, 103 player-s). Hips move 0.59 cm p50 meanwhile (n 85). Chrome, seed 131, 20.31-20.81 s: speed 0, walking 2, feet [0, 4.4], [0, 0], [4.7, 0], [0, 4.2] cm, alternating about every 0.15 s; `sheet-tap2.jpg`. Same at 8fd6459: 6.21 a second (76 player-s), so it predates round 8. Height and period match `STEP_LIFT` 0.05 m and `STEP_TIME` 0.15 s (`avatar.ts:497,501`); `gaitSince > 0.35 / hz` (`avatar.ts:2890`) also still fires at speed 0. Not traced to one line. Real receivers do bounce, but that's the whole body, on the serve, not a shuffle of feet between points (general) | M+J | Standing still at the end of a walk, plant both feet and stop stepping unless the body moved. Ease into the ready stance. Then measure lifts a second again |
| 3 | High | **Faces close up still don't look human.** Not new: the source's limit, with the MetaHuman pilot waiting on Epic's sign-in. Better hair and shoes make the face the weak link. | `sheet-b1.jpg`: PS3-era MakeHuman. p1 hair a solid cap, p10's braid a lumpy cap with a blue sheen at the front, p7 flat blue eyes, even skin. 6 face stills, 3 body | J | The MetaHuman pilot. Nothing short of that closes it. Rank order: this is the worst thing close, 1 and 2 the worst things in play |
| 4 | Medium | **The run barely touches the floor.** Short dabs and long floats. It reads as light, and that's half of what the owner means by bodies in play. | Both feet off (sole over 1.5 cm): 65% at 1.5-3.5 m/s and 75% over 3.5 (p1), 69% and 78% (p7). Real running at 3-5 m/s: about 25-35%, and none at a walk-run under 2.5 (general). Stance p50 108 ms, real about 200-250 (general). Hands 15 cm apart p50 over 3.5 m/s, so little arm swing (30 s of 813 player-s up there) | M | Longer stance, lower flight, in the run cycle. Arms that drive |
| 5 | Medium | **Weight went in for the forward run only.** A good fix there. Half the movement in padel is sideways, and there it's flat. A hard stop still leans into the stop. | Feet to head, start / steady / brake. Facing the run: 30.0 / 19.4 / 11.4 (p1, n 3317, 3241, 1601), 28.6 / 18.9 / 11.0 (p7). Sideways: 12.3 / 11.5 / 10.1 (n 3614, 1110, 846), 11.9 / 11.0 / 9.9. About 0.19° per m/s², unchanged from round 8's 0.11-0.26; `atan(a/g)` is 5.8. Backwards 14.0 / 6.7 / 1.5. Braking at -6.2 m/s² stays +11 towards travel | M | Lean by the acceleration in the body's own frame, sideways too, and let a hard stop go past upright |
| 6 | Medium | **Cut-aways now show more backs.** The walk-back fix turns players towards their places, and the camera didn't turn with it. This is the game's one close look at its people, and it lands every point. | Winners facing the lens / back to it, same probe, share of player-frames in the cut-away. Round 8's own seeds: 111 doubles 49 / 40 (n 5,714, 10 points), round 8 80 / 9 (n 5,088); 115 singles 47 / 19 (n 2,443, 12 points), round 8 83 / 1 (n 1,995). Fresh seeds 141, 148: 42 / 42 (n 5,792), 56 / 18 (n 2,320). Seeds 111 and 115 ran in the pane, 141 and 148 in Chrome. Round 8 row 7 took forwards in the walk from 13 to 67%, so I take that as the cause; I didn't run the old build in a page | M+J | Pick the cut-away's side from where the pair is walking, or hold the shot until they turn |
| 7 | Medium | **The smash peaks after the ball, and it's drawn slower than it's played.** The same fault as finding 1, milder: there is a real swing here. | n 37: 3.7-4.1 m/s at -100 ms, 8.6-9.4 at contact, 15.5-18.2 at +17, peak 16.2-18.5 up to +66 ms, sim 25.0-25.4. Path 1.01-1.08 m before, 2.32-2.42 after. Serve drawn at 0.72-0.75 of the sim. Legs at contact 69.6 / 1.7 and 69.0 / 1.8, video 27 / 23 | M | Move the peak to the ball. A second, softer knee in the air |
| 8 | Medium | **The racket still dips on the ball.** Round 8 fixed what comes after contact. The contact sample itself is slow, one 120 Hz sample that's one frame at 60. Replays run it at 0.35×. | -17 / 0 / +17 ms, m/s, p1 and p7 alike: drive 10.2 / 8.4 / 10.4 (n 91), slice 12.6 / 8.1 / 10.4 (n 125), volley 4.7 / 3.1 / 6.8 (n 210), smash 13.4 / 8.6 / 18.2 (n 37), lob 11.0 / 9.7 / 11.0 (n 101) | M | Find what pulls the hand on the hit frame (the contact blend) and keep its speed |
| 9 | Medium | **The racket misses the ball on 2-5 contacts in a hundred.** Rare, but the worst are far off: a volley at 1.27 m. Rank unchanged. | As drawn in Chrome, seeds 143-145, 153: 13 of 261 over 15 cm, 8 over 30, worst 87 cm on a low lob, p90 4.0-9.1. Round 8's seeds 116 and 117 on this build (pane): 3 of 128, worst 25; round 8 had 0 of 160 on them. Node, same measure, same seeds on each tree: 23 of 1,312 over 15 cm (1.75%) on HEAD, 21 on c660d41; 12 of 837 on 8fd6459. p90 7.6-8.0 on HEAD, 6.5-6.8 before; over 10 cm 50 against 32. Worst 127 cm at 0.20 m | M | Low, wide balls: the worst are under 0.6 m. Reach the ball or play a different stroke |
| 10 | Medium | **Feet slide through strokes and runs.** The walk is better. Rally stances aren't. | Middle 60% of a stance over 5 cm: swing 18.1%, 21.2% (n 493, 449; p90 11-12 cm), jog 19.5%, 10.0%; walk 11.8%, 8.1% (n 876, 1,093). Whole stance over 10 cm: swing 34.5%, 29.2%. Most of the rest sits at a stance's two ends | M | Lock the planted foot through the stroke; turn on the ball of the foot |
| 11 | Medium | **The walk back is quick and short.** Much better, and it's a walk. Still a hurry for a player between points. | At 1.5 m/s: 2.60 and 2.84 steps a second, 0.58 and 0.53 m a step; real about 2.0 and 0.75 (general). Lean 14.0° p1, 7.4 p7. Both feet off 4%, 6%; double support 26%, 24% | M | Longer steps, slower cadence, p1's lean halved. No pelvis twist yet |
| 12 | Medium | **The forehand's finish folds.** The arm collapses after the ball, where the video keeps it open. | Elbow at +0.08 / +0.16 / +0.24 s: 69 / 90 / 101 (p1, n 14), 62 / 71 / 86 (p7, n 14). Video 47-64 / 38-60 / 43-64 | M | Keep the arm long through +0.25 s |
| 13 | Medium | **The víbora is still played from the shoulder.** | Elbow p10 / 50 / 90 86 / 92 / 117, hand 0.10 over the shoulder (n 10, serpiente seeds 4101-4106); 79 / 87 / 96 and all over 75 (n 9). Video 53, 0.6 trunks (one coach's high ball) | M | With finding 1: a higher contact, a more open arm |
| 14 | Medium | **Pops of 15° or more are above the claim.** All pops held. | 15+ 106 and 89 in 32 player-minutes, 3.3 and 2.8; 30+ 14, 20; 45+ 3, 1. All 12.7-13.5 a minute. Mostly ready stance. Knee spins 0. R7 2.0-2.28 | M | The ready-stance arm blend |
| 15 | Medium | **The arm flicks straight on the way back.** Better, on overheads not. | 60-40-55 after contact (stricter than round 8's 25°): 44 of 142, 31%. Backhand 16, forehand 26, serve 27, volley 28, overhead 83, smash 100 | M | Hold the elbow through the recovery |
| 16 | Medium | **No voice on court.** No umpire's score, no call between partners, no commentary. A big gap at this tier, and the first thing a TV game adds. | No speech family in `src/audio`; grep. Grunts are good | M | An umpire's score call first (show the owner) |
| 17 | Medium | **Hair moves as one piece.** The owner's "hair": much better still, but it doesn't move. | `sheet-b1.jpg`, `sheet-f2.jpg`: shape follows the head, no strands | J | Second-order swing on long hair; ponytail on a bone |
| 18 | Medium | **Few reactions, one set of strokes for ten people.** | Same keys for all ten. `sheet-f1.jpg`, `sheet-f2.jpg`: the women's strokes differ by scale. Mannerisms in `data/manners.json`, no new reaction since round 8 | J | Two or three signature strokes; anger, relief, a look at the partner |
| 19 | Medium | **One trainer mesh for ten people.** | All shoes one mesh, recoloured. p3 and p6 share `short01`, fit apart | J | A second trainer |
| 20 | Medium | **Practice has no goal.** The drill names a skill and tips it, and nothing counts. | d-pr1, d-pr2 text: "LET IT COME OFF THE GLASS", "HIGH OFF THE GLASS · HOLD O FOR A BAJADA". No target or score in either | M | A count, a target, an end |
| 21 | Medium | **A singles win is a shrug.** The winner stands. | `sheet-c1.jpg`; `src/render/avatar` unchanged here | J | A fist, a knee, a run to the net |
| 22 | Medium | **Replays are still mostly smashes.** Much better: drops, volleys and lobs appear. | 13 of 21 smash (R8 16 of 17): men 7 of 14, with 3 volleys, 2 drops, a lob, a bandeja; women 6 of 7. Seeds 131-145, 151-156 | M | Long rallies and glass recoveries |
| 23 | Medium | **Grey stadium roof, empty chair.** | `sheet-f1.jpg`, `sheet-h1.jpg`; chair at `stadium.ts:192`, nobody on it. `src/render/arena` unchanged | J | A dark roof with rigs; an umpire |
| 24 | Medium | **The hall and clubs stay behind the stadium.** The hall has no walls. Club night has a dim green cast. | `sheet-a1.jpg`: open-sided shed over flat green lawn and flat grey concrete; night near court RGB 92, 112, 51 | M+J | Hall walls, ground detail, a neutral night |
| 25 | Medium | **No opening.** | `sheet-d1.jpg`: wide shot and banner | J | A skippable opening (show the owner) |
| 26 | Medium | **The end-wall mesh sits over the near pair at the net.** | TV: near-at-net frames behind the band 86.9% (n 4,649), ball through it 24.8% (n 4,953), heads 47.6-57.7%. Round 8: 91%, 38.5% | M | The owner's choice of camera |
| 27 | Medium | **"TV close" and "player" can lose a player.** | Seed 140, n 4,953: `near` some player off 17.5%, ball 0.9%; `player` 5.8%, 1.0%. Round 8, seed 110: 2.6%, 0.2%; round 7, seed 96: 10.6%. Off-screen is always the near pair | M | Tilt down or follow the near pair |
| 28 | Medium | **Floors are flat paint and look alike.** Clay is the exception. | Stadium court RGB: carpet 69, 83, 198; turf 73, 88, 210; hard 77, 85, 187; clay 186, 106, 69 | M+J | Wear, fibre, ball marks; a sheen that tells them apart |
| 29 | Medium | **The Knock-out's start doesn't say which round.** | `d-ko-start` HUD: "VS MISAKI OKADA (JPN) & EBBA LINDQVIST..."; the results say QUARTER-FINAL | M | The round in the banner (show the owner) |
| 30 | Low | Hair through the band and visor; slivers at two necklines. Face camera only. | `crop-band.png`: p8's band, p9's visor; `crop-kit.png`: p7, p10 | J | Trim the hair under them |
| 31 | Low | p9's tee rounds the shoulders; skirts are stiff. | `b-p9-body.png`, `sheet-f2.jpg` | J | Shoulder weights; a skirt that lags |
| 32 | Low | The bandeja's elbow spreads wide. The median is right. | p10 / 50 / 90 34 / 61 / 93, under 45 28%, over 75 25% (n 40). 8fd6459: 31 / 59 / 93 (n 52). Video 54-65 (n 7) | M | Narrow it by the ball's height |
| 33 | Low | Thighs pass through each other. | Legs test 4.4-5.5% of frames (R8 1.57-2.06, R8's verifier 1.8-2.5), up to 14.9 cm, at the hip capsule. Knees at least 8-13 cm apart, crossed 0-6% | M | Hip capsule, or nothing |
| 34 | Low | Long names cut off in the score bug. | Code unchanged; carried | J | Fit to width |
| 35 | Low | Kits have no print. | `sheet-b1.jpg` | J | A chest print |
| 36 | Low | The result banner runs over a replay's first second. | No clear at `RP_PREP` (`game.ts:707`); `src/ui` unchanged | M | Clear calls as a replay starts (show the owner) |
| 37 | Low | Nothing on court answers the ball. | No particle or fence-shake code in `src/render` | M | A puff, a fence shiver |
| 38 | Low | The TV lower third can read the wrong way round. | `src/ui/tv.ts` unchanged | J | "Point to" the winners (show the owner) |
| 39 | Low | Ball trail reads as a string. A cue, so the owner's call. | `sheet-a3.jpg` | J | Show the owner |
| 40 | Low | Low balls a little squat. | Not re-measured; carried | J | |
| 41 | Low | One singles swing in ten graded far late. Cause not traced: it may be the bot's timer under load. | Singles 1 at 94.9 ms in 10; capture bot +72, -66 in 9 (doubles under 35) | M | Trace it |

### What holds up

- **The stadium,** crowd, banners, the arena's scale (`sheet-a1.jpg`). Still the best-looking thing in the game. Every arena, court and floor reads right.
- **Stroke shapes** (`sheet-f1.jpg`, `sheet-f2.jpg`). A low drive with a real lunge, side-on trophy, a jump on the smash, women's and men's. Ready, forehand to contact, backhand and mid volley sit near the table.
- **Low volleys.** Elbow 52-55 under 0.6 m (n 19), 59-61 mid (n 8), 61-65 high (n 5). All volleys p10 / 50 / 90 30 / 56 / 65 (n 99). Round 8's fix holds.
- **The backhand's finish.** Wrist -0.23 at +0.24 s (n 7), video -0.12, was -0.47. The arm stays long, elbow 30-33.
- **The walk itself.** Forwards, planted, footsteps 2.10 a second moving, both feet off 4-6%.
- **Contact at the median.** 2.0-2.9 cm as drawn, face to the ball's way out 22-28° at p50.
- **Truthful input.** `bot-play.mjs`: doubles 9 hits of 9, p50 4.3 ms; singles 10 of 10, p50 4.4 ms. Capture bot 0 whiffs in 32 swings in live matches. Racket as drawn on a human's hits p50 5.5-5.6 cm, worst 6.6 cm (n 11).
- **Pace.** 7.8 s from point to serve (6.9-8.5), women 7.9. A key skips the walk.
- **Cut-aways frame people.** Nobody out of shot in 44 points. Who they show is finding 6. The racket tap between partners is good.
- **Replays.** Low angle, 0.35× at the ball, about 6 s, Enter skips (`sheet-rp.jpg`).
- **Match end.** Embrace, walk, net tap, in men's, women's and TV (`sheet-c1.jpg`).
- **The app.** Clean title, setup, settings, pause, results (`sheet-d1.jpg`). Title ready 3.3 s, Start match 2.5 s, Rematch 1.7 s. Knock-out moves on to the next round with a new pair.
- **TV graphics** (`sheet-h1.jpg`). Compact bug, radar gun, game card.
- **Sound bank.** Nothing clips. Hard hits peak -7.6 dB, gone in 4 ms at -40. Men's loud grunts 140-192 Hz, women's 245-329. Applause tails 2.35 s. Glass is the one oddity: energy over 300 Hz about -47 dB, so it's a thud with no "pock" in it, by numbers only.

## 3. Against REVIEW.md

**Changes after the blind draft.**
- **Bandeja "elbow 93, a regression": retracted.** The elbow is bimodal and my n 18 was a poor sample. On seeds 4201-4214 the median is 61 (n 40), and 59 at 8fd6459 (n 52). No regression; the spread is Low finding 32.
- **Bandeja "racket behind the chest": retracted.** Published contact is -0.01 ± 0.34 m from the centre of gravity. Finding 1 now stands on the swing's timing, with a far larger sample (n 45).
- **Walk feet, draft "High?" to Medium, then folded into 10 and 11.** The 13.8 cm was mostly a stance's ends. On the middle 60%, round 8's "Better" holds.
- **Legs clip dropped to Low** (33): hip capsule, the knees don't cross.
- **Added after the blind draft, from round 8's list:** 13, 14, 15, 17-27, 29, 33-41, seen again or carried. Also 8 and 9, from a larger probe than the draft's.
- **Cut-aways, 6, added after the draft.** The run landed later, and it read as a regression only against round 8's log, so I reran round 8's seeds.
- **Dropped:** a laptop-speaker worry about glass; it survives a 200 Hz high-pass at -6.8 dB. The package (career, creator, saved records) is a later milestone, as in earlier rounds.

### Each finding marked

R8 # is the numbering of `round8-critic.md`; "row" below is REVIEW.md's Round 8 table.

| # | Mark | Note |
|---|---|---|
| 1 Bandeja, víbora timing | **NEW** | There since at least round 8's start: path 0.28 m in 0.05 s at 8fd6459. Not a regression |
| 2 Foot tap | **NEW** | The same at 8fd6459. Round 8 fixed the moving part, 8.01 to 2.18 lifts a second |
| 3 Faces | REPEAT R8 #2, R7 #1, R6 #9, R5 #10, R4 #7, R3 #21 | The source's limit |
| 4 Run | NEW as a finding | Round 8 #8 noted flight on the walk only |
| 5 Weight | REPEAT R8 #1 | Lowered: the forward run is fixed, the rest isn't |
| 6 Cut-aways | **REGRESSION** of round 8's cut-aways (its "What holds up": the pair faces the lens 80%, 83%) | From row 7's fix. Proven on round 8's own seeds |
| 7 Smash | REPEAT R8 #10 | Peak after the ball is new |
| 8 Racket dip | REPEAT R8 #4 | |
| 9 Misses | REPEAT R7 #10, R6 #10, R5 #11, R4 #27, R3 #20 | Not a regression: same rate on the old trees |
| 10 Feet slide | REPEAT R8 #3 | |
| 11 Walk | REPEAT R8 #8 | |
| 12 Forehand finish | NEW as a finding | The table's own row |
| 13 Víbora | REPEAT R8 #9 | |
| 14 Pops | REPEAT R8 #7 | |
| 15 Flick | REPEAT R8 #6 | Stricter measure |
| 16 Voice | REPEAT R8 #11 | |
| 17 Hair | REPEAT R8 #13 | |
| 18 Reactions | REPEAT R8 #15 | |
| 19 Trainer | REPEAT R8 #14 | Hair half closed |
| 20 Practice | REPEAT R8 #16 | |
| 21 Singles win | REPEAT R8 #17 | |
| 22 Replays | REPEAT R8 #18 | Better |
| 23 Stadium | REPEAT R8 #19 | |
| 24 Clubs, hall | REPEAT R8 #20 | |
| 25 Opening | REPEAT R8 #21 | |
| 26 Mesh | REPEAT R8 #22 | |
| 27 TV close | REPEAT R8 #23 | |
| 28 Floors | REPEAT R8 #24 | |
| 29 Knock-out | REPEAT R8 #25 | |
| 30 Hair through kit | NEW | Face camera only |
| 31 Tee, skirts | NEW | |
| 32 Bandeja spread | NEW | |
| 33 Thighs | REPEAT R8 #26 | Rate up, cause artefact |
| 34 Names | REPEAT R8 #28 | Carried |
| 35 Print | REPEAT R8 #29 | |
| 36 Replay banner | REPEAT R8 #30, R5 #18, R4 #9 | |
| 37 Nothing answers | REPEAT R8 #31 | |
| 38 Lower third | REPEAT R8 #32 | Carried |
| 39 Trail | REPEAT R8 #33 | |
| 40 Low balls | REPEAT R8 #27 | Carried |
| 41 Late grades | REPEAT R8 #36 | |

### Statuses that don't hold

- **Round 8 row 2 "Fixed" (weight): Better.** True for a player running forwards (30.0 / 19.4 / 11.4, the table's figures). Sideways is flat, as before. REVIEW's own note says a hard stop doesn't lean back.
- **Round 8 row 6 "Fixed" (pops 15+ 2.1): Better.** 3.3 and 2.8 on my seeds (32 player-minutes each). All pops about 13 holds.
- **Round 8 row 7 "Fixed" (walk): Better.** All of its numbers hold while the player moves. It leaves 6.2 lifts a second at the end of the walk, finding 2, and it costs the cut-aways, finding 6.
- **Round 8 row 9 "Fixed" (racket through the ball): Better.** The speed after contact holds for the drive and slice. At the contact sample it dips 15-36%, and the smash peaks 17-66 ms late. Bandeja and víbora are finding 1.
- **Round 8 row 15 "Fixed" (kit): holds from every game camera,** as the row says. At the face camera there are slivers at p7's and p10's necklines, and hair through p8's band and p9's visor. Low.
- **`footage-pose.md`, forehand +0.16 s "75":** 90 and 71 (n 14 each). +0.24 s "113": 101 and 86.
- **`footage-pose.md`, Bandeja elbow "57-63":** the median, 61. The spread is 34-93.
- **`footage-pose.md`, Backhand wrist at +0.24 "-0.47":** -0.23 (n 7). Better than the table says.

### Statuses that hold

- **Round 8 row 8 Better (walk feet),** on the middle 60%: 11.8%, 8.1%, from 20%.
- **Row 10 Fixed (low volleys).** 52-55 under 0.6 m.
- **Row 11 Better (flicks).** Row 16 Better (ten heads, a pair of shoes each).
- **Row 12's replay sound,** by code (`soundscape.replay`, `game.ts:746`).
- **Row 13, row 14 Open:** seen or carried above.
- **Row 4 Better, still open.**
- **R6 #10, racket misses, Medium.** See finding 9.
- **R3 #10.** The key help folds after the first point. It's about 500 × 390 px on the first.
- **R5 #7.** Rematch 1.7 s; "On to the semi-final" deals new rivals.
- **R8 #5, the locked arm, and R8 #34, the backhand's finish:** both closed as findings. -0.23 against the video's -0.12 is within the clip's spread.

### Not checked

- **The mix's level, a third round with no reading.** An analyser on the master read 1,273 blocks of silence over two runs in Chrome with the context "running" (`r9c-jobs-l.log`). In the pane the context reported running with its clock at 0.005 s after 45 s, so I suspect no audio device behind a headless page, not a silent game. A self-test with an oscillator was queued and blocked by the lock. Round 8's -33 / -28 / -4 stays calculated, and R7's -45.4 dBFS is the last real reading. Someone should listen.
- **The worst misses on screen.** A strip of seed 144's 87 cm lob and seed 145's 59 cm volley was blocked by the lock, so finding 9 stands on numbers. Contact on seeds 118 and 119, and cut-aways on seeds 161 and 162, were blocked too.
- **R8 #35 back-pedal at a run:** not re-measured, and the pro covers row 1.
- **Faces in motion:** stills only this round, so blinks and speech-free expressions weren't judged.
- **`cam=hand`:** the shoulder blocks the view in both stills, so the grip wasn't seen this round.
- **Close-ups of p3-p6.**
- **Sound by ear.** Measured only.
- **Gamepad play; performance;** Back glass and Volleys drills.
- **Club-night men's and women's stills beyond the arena sheet;** long names on a live score bug (34); the lower third's wording on a live error (38).
