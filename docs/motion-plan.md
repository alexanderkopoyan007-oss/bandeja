# Motion plan: real movement on top of the real physics

*Written 6 Nov 2026. A plan for the owner to approve; nothing below is built yet.*

## The rule
**The sim stays exactly as it is.** It decides:
- where each player is, how fast they run (the force-velocity sprint fitted to padel data in `data/tuning.json`), and when they get there
- when and where the racket meets the ball, and how fast the face is moving (`racketSpeed`)
- every bounce, wall and spin

Animation only chooses real, captured human movement and bends it to fit what the sim already decided. No file in `src/sim/` changes. Before anything ships, the determinism probe hashes, golden replays and the online end-to-end test have to come out identical to today's.

## Why ours looks worse than theirs today
1. **The legs are five generic loops.** The legs play Mixamo jog, run, strafe and backpedal loops plus one idle. They're blended by direction and the legs are turned to the way of travel. Real padel movement is almost all transitions: match tracking has about 395 accelerations an hour, 80% of them over only 1-2 m (Miralles et al. 2025, in `tuning.json`). Starts, plants, stops, crossovers and turns don't exist in a loop, so we fake them with blending and warping, and blending is what looks "gamey".
2. **The strokes are drawn poses joined by curves.** Every stroke is a handful of key poses typed in code (`strokes.ts`), reached with IK, with the in-between filled by interpolation. Each pose has been measured against pro footage, so the stills are right. The motion between them isn't. A real swing is a chain: hips fire, then trunk, then shoulder, then elbow, then wrist, each peaking a little after the one before. That timing is what reads as "real", and you can't get it by interpolating between poses.
3. **Most of our animation code stops errors rather than making motion.** It handles joint limits, keeping arms out of the trunk, wrist limits, and smoothing out pops. All of that is needed, but it can only make wrong motion less wrong.

The fix for all three is the same: **real captured motion, picked by the computer to fit the moment (motion matching), then bent by a few centimetres to meet the sim's ball exactly.**

## How the racket still meets the ball exactly, without touching the physics
For each shot the sim gives us the family (drive, volley, bandeja...), the hand, the contact moment, the contact point and the racket speed. Then:
1. **Pick the take.** From all captured takes of that family and hand, take the one whose contact point relative to the player's feet, approach speed and swing speed are nearest the sim's. A hard drive picks a hard-swing take; a low ball picks a take where the player got low.
2. **Retime it.** Stretch or squeeze the backswing so the take's contact frame lands on the sim's contact moment. The forward swing keeps its captured timing as far as possible, because that's where the realism is.
3. **Blend the two or three nearest takes** to close most of the remaining gap.
4. **Spread the last few centimetres over the whole forward swing.** Hips, spine, shoulder and arm each take a share, starting at the start of the swing, so there's no last-moment yank. The racket meets the ball exactly where the sim says, as it does today.
5. **Layer the legs.** If the sim's run doesn't match the take's footwork, the legs come from locomotion matching (below) and the upper body from the take, joined through the spine. This is how sports games do it.

The gap left after step 3 is measured (target: median under 6 cm, 90th percentile under 15 cm, final numbers set after the pilot). A large gap means a missing take, and that goes on the next capture list.

## Locomotion matching (the legs)
- **What it compares:** a library of captured padel footwork (split steps, shuffles, crossovers, sprint starts, plants, backpedals, turn-and-run, back-wall exits) is searched every 0.1 s, and whenever the sim's plan changes. Each frame is described by:
  - the player's path 0.2, 0.4 and 0.6 s ahead and which way they face along it
  - where the feet are and how fast they move
  - how fast the hips move
- **Where the path ahead comes from:** the sim's own movement rules run forward on a copy of the player (or, if that step can't be run on a copy, the plan's target and the sim's speed limits). So it's the path the player will actually take.
- **What it reuses:** the search picks the best-fitting frame, and the inertializer we already have (`inertia.ts`, same method as Gears of War and Holden's work) makes the switch seamless. The remaining speed and direction gap goes through the stride and orientation warping and foot locking we already have. The root stays the sim's, always.
- **Cost:** about 20 minutes of motion is around 36,000 frames × 30 numbers. A brute-force search is about 1 million multiply-adds, under 1 ms in JavaScript, and a few times a second per player. It has to be allocation-free like the rest of the frame loop.

## The capture (the one thing I can't do alone)
The motion has to come from real people playing padel. Pro footage stays what it is now: reference numbers only, from `footage-pose.md`, never clips. Options:

| Route | What it takes | Quality | Cost |
|---|---|---|---|
| **A. Phones + FreeMoCap (recommended to start)** | 3-4 phones on tripods round a court, a printed calibration board, 3 coloured tape dots on the racket. FreeMoCap is free, open-source multi-camera capture that runs on the Mac. We only ship our own data, never its code; licence to check before use. | Good bodies. Racket from the tape dots, so the hand from the racket (it can't turn in the hand, `grip.ts`). Contact moment from the ball's pop on the phones' audio. | A court booking |
| B. Motion-capture studio day | A studio or university lab with optical markers on players and racket | Best, especially wrist and racket | Studio day rate; you'd arrange it and pay |
| C. Single-phone capture apps (Rokoko Vision, DeepMotion, Move.ai) | Your account on their site | Weaker depth from one camera, no racket | Free tiers to paid |

The captured motion is our own asset. The people captured agree in writing that their movement is used (only movement, never their look). Best is one right-hander and one left-hander who play well; a club coach would be ideal. Dives aren't captured (injury risk): the dive stays procedural, or gets done later on a gym mat.

**The shot list comes from the sim, not a guess.** I run a few hundred AI doubles points and record every contact: family, hand, height, how far out to the side and in front, and run-in speed. The list covers the cells that hold 95% of real in-game contacts. Expect about 200-300 takes plus about 15 minutes of footwork.
- **Made 7 Nov 2026:** [`docs/mocap-shotlist.md`](mocap-shotlist.md), from `node tools/shot-list.ts`. 926 points and 7619 contacts give 121 cells holding 95% of contacts, and 244 takes. Volleys are 28% of contacts, drives 14%, serves 14%, shots off the glass about 15%, lobs 8% and overheads 10%.

## Phases
Each one ends with tests, a review sheet or clip for you, and nothing live until you've seen it (behind `?motion=2`).

**0. Pilot capture (about 1 hour on court).**
- Me: a one-page setup guide (where the phones go, the board to print, the tape layout), the shot script, and the processing.
- You: one session, about 10 strokes and some footwork.
- **Gate:** body joints steady within a few degrees, racket direction steady, contact moment within one frame (1/30 s). If the racket or wrist is too noisy, strokes move to route B and the phones keep the footwork.

**1. Pipeline, one stroke end to end.** New tools in `tools/assets/mocap/`:
1. triangulate the joints
2. get the racket pose from the dots, and the hand from the racket
3. clean the data: filter, foot contacts, contact frame
4. retarget onto our 65-bone skeleton, per body, inside the joint limits we already check
5. label each take: family, contact point, racket speed
6. pack it into one compressed file, committed like `player.bnz`

Then the forehand drive plays in game from captured takes. **You see:** real footage numbers vs today's forehand vs the captured one, side and behind.

**2. Locomotion matching.** Pilot footwork, plus Mixamo pieces as filler until the full session, replaces the five-loop blend. Feet first, because padel is all short bursts.
- **While you arrange the capture**, I build this runtime against the clips we already have, so it's ready when the data lands.

**3. Full capture session (2-3 hours)** from the sim-made shot list.

**4. Every stroke from takes.** All families, both hands, serve, wall play. The procedural keys stay as the fallback for any cell with no take yet, so nothing gets worse while coverage grows.

**5. Finish and ship.**
- Personal style: `data/manners.json` tempo and shape steer which takes each player prefers, so the ten players don't all move alike.
- Partners waiting between shots, celebrations, a review clip, then ship.

## Checks (all automatic, on top of today's)
- **Sim unchanged:** an empty `src/sim` diff, plus identical determinism probe, golden replays and online test.
- **Today's animation QA all still passes:** animQa (racket to ball at contact, pops a minute, planted feet, soles, clipping), `armClear`, `wrist`, the joint limits from two angles.
- **New:**
  - foot slide while planted (cm)
  - the correction step 4 spreads (median and 90th percentile, cm)
  - share of frames with more than 10 cm of correction
  - search time per player
  - balance: the body's centre of mass over the feet, except in jumps and dives
- **Real against game:** the same trunk-frame numbers as `footage-pose.md` (stance, elbow, wrist, timing), now measured on the captured takes and on in-game play.
- **Budgets:**
  - motion download 4 MB or less, loaded after the menu
  - 60 Hz held on the Medium laptop proxy (`npm run perf`)
  - `npm run alloc` clean

## A bonus check on the physics (report only)
The capture also measures real side-shuffle speed, backpedal speed and turn rates. Today those are the sim's estimates (`sideSpeed`, `backSpeed`, `grip` in `tuning.json`; nothing published for padel). I'll put the real numbers next to the sim's and tell you. The sim only changes if you say so.

## What I need from you
1. **Capture route:** A (phones, recommended first), B (studio) or C (apps).
2. **Who and when:** one or two good players and about an hour of court time for the pilot.
3. **OK to download FreeMoCap** (a Python package and its pose models, kept outside the game's build).

Everything else I do: the guide, the tools, the runtime, the checks.

## Sources
- Clavet, "Motion Matching and The Road to Next-Gen Animation", GDC 2016.
- Holden, Kanoun, Perepichka, Popa, "Learned Motion Matching", SIGGRAPH 2020. Also Holden's open example code ([orangeduck/Motion-Matching](https://gittrend.io/repo/orangeduck/Motion-Matching), reported MIT; check the LICENSE) and "Code vs Data Driven Displacement".
- Bollo, "Inertialization", GDC 2016 (already used in `inertia.ts`).
- FreeMoCap: [PyPI](https://pypi.org/project/freemocap), [CG Channel launch article](https://www.cgchannel.com/2021/07/the-freemocap-project-markerless-mocap-for-under-100). Licence reported as AGPL; check before use.
- A padel visualisation in Unreal made from Rokoko capture plus hand keys: [CGArchitect](https://cgarchitect.com/projects/40e13954-slazenger-padel-clubs).
- Movement data already in the sim: Miralles et al. 2025, Haugen et al. 2019, Saez de Villarreal et al. 2023 (see `data/tuning.json`).
