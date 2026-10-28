# The AI

How the computer players work, what they are tuned against, and how to measure them. Decisions and the numbers
behind each change are in `DECISIONS.md` (Phase 4); what is still unknown is in `OPEN_QUESTIONS.md`.

## What an AI player is

One `SimpleAi` per computer player (`src/sim/ai/simpleAi.ts`), inside the deterministic sim. It plays through the
same inputs a human does: it moves, presses a shot key, holds modifiers, aims, and releases. The sim judges its
release on the same timing windows as a human's (`src/sim/contact/windows.ts`, `data/tuning.json` `timing`); a
human-only accessibility scale never applies to it. All its randomness comes from the match's `aiRng`, so a seed
replays exactly.

For each incoming ball:

1. **Reaction.** Nothing for `0.30 - 0.13 × level` s (×0.8-1.2) after the opponent's contact: 0.17 s at the top
   level, the measured 140-190 ms before a player commits (Triolet et al. 2013; Mecheri et al. 2019).
2. **Plan.** `planStand` (`src/sim/player/positioning.ts`) picks the contact it can reach in time at the best
   height: before or after the bounce, before or off the glass. It costs the ball's pace and how little time it
   leaves (`PRESSURE_COST`: the easier ball), a contact squeezed against the back glass, and a ball still climbing
   past the shoulders off a wall is never a contact (`riseMaxOffWall` 1.47 m), nor is a ball more than 0.4 m
   behind the hips (`BEHIND_MAX`, for humans too). A lob while at the net is taken in
   the air as an overhead, planned at that overhead's own height (bandeja 1.95, víbora 1.72, smash 2.42 m).
3. **Shot.** Overheads: a smash where it can finish the point (it lands within `KILL_DEPTH` 6.0 m, so the bounce
   kicks into the glass), else a bandeja or víbora. Volleys: a ball below the tape played safe (precision), a high
   one near the net put away (power). Doubles ground strokes by where the opponents are: against a pair at the
   net, lob them or dip a chiquita at their feet; against a pair at the back, drive and slice through the middle.
   The style's traits scale every one of these choices (below).
4. **Target** (`chooseDoublesTarget`): smashes down the line short enough to kick out, bandejas deep into a
   corner, víboras into the side glass, lobs 5.5-8.6 m deep, low balls at a net player's feet or through the
   middle; margins from the lines shrink with level and grow with the style's `margin`.
5. **Swing.** The key goes down 0.45 s before the planned contact. From then on the AI watches the ball from where
   it actually stands (`trackRelease`) and releases at the window's ideal moment plus its timing error:
   `timing(level) × difficulty`, where difficulty grows with the ball's pace, a ball off the glass
   (`AFTER_WALL` 1.8) and a low ball. It is judged on each shot's own window (`data/shots.json` `timing`),
   as a human is. The shot itself is spread by `motor(level) × (1 + 1.15 × pressure)`
   (`src/sim/ai/pressure.ts`: pace, time, stretch, running, height, walls).
6. **Corrections.** A bounce or wall that moves the ball more than 0.15 m off the planned contact (turf, mesh,
   glass joins, the net cord) is corrected 0.11-0.17 s later, not on the tick (online corrections take 110-170 ms).
7. **Beaten.** If at its release no window passes within reach of where it stands, it lets the swing go unmade
   (`MatchSim.standDown`) rather than swinging at the air.

## Doubles

- **Who takes the ball** (`MatchSim.updateTakers`): the shorter run to a reachable contact; within 0.8 m it is
  the player with the forehand in the middle; a decision only changes for a run 1 m shorter. A partner standing
  in the ball's line plays it.
- **Formation** (`src/sim/player/formation.ts`, shared with the human's positioning assist): both up (3.1 m from
  the net) or both back (8.0 m), each in a lane, the pair sliding towards the ball (more at the net). While the
  partner plays the ball, match their depth. After a deep lob that beats the opponents, follow it in; after a
  chiquita, sometimes.
- **Switching sides.** When the partner goes for a ball more than 0.8 m across the centre on our side (a lob over
  us taken on the diagonal, a poach), cross over and cover theirs. A switched pair of AIs crosses back to its own
  sides once its ball is more than 1 s from bouncing over there.
- **Calls** (`E_CALL`): a contested ball (the two runs within 1.5 m) or a switch is called once, 0.25 s after the
  opponent's contact: the taker's "Mine!", or the partner's "Yours!" / "Switch!". A human never speaks; their AI
  partner calls for the pair, and the HUD shows the partner's call.

## Difficulty

`aiLevel` runs from 0 (a novice) to 1 (the top difficulty, tuned against professional statistics). The skill
values in `data/ai-skill.json` are given at levels 0, 0.5 and 1 and interpolated between.

| What changes with level | Level 0 | Level 0.5 | Level 1 |
|---|---|---|---|
| Reaction (s) | 0.30 | 0.24 | 0.17 |
| Timing error SD (s, before difficulty) | 0.030 | 0.023 | 0.018 |
| Motor spread (per unit of `swing.motor`) | 1.10 | 0.92 | 0.65 |
| Correction delay (s) | 0.17 | 0.14 | 0.11 |
| Net depth when attacking (m from the net) | 4.5 | 3.8 | 3.1 |
| How much the pair follows the ball across | 0.4× | 0.7× | 1× |
| Lobs against a net pair (vs driving into them) | 0.5× | 0.75× | 1× |
| Taking the net from the back | 0.4× | 0.7× | 1× |
| Low volleys played safe / high ones put away | 40% | 65% | 90% |
| Smash from too far | often | sometimes | rarely |

The mistakes are a player's mistakes: mistimed swings, shots that sit up or find the net, standing too far back,
the wrong shot against a pair at the net, a beginner's struggle with balls off the glass. They never freeze and
never miss an easy ball on purpose, and a ball that is already out of reach when they would swing is let go, not
swung at (a late swing at a fast ball off the glass can still miss it, as a real one does).

Fitted against the published ladder from novices to professionals (rally length; `docs/research/`):

| Level | Shots a point | Benchmark | First-serve faults |
|---|---|---|---|
| 0 | 5.4 | novices about 5.6 (the serve 21.5% of their shots) | 14% |
| 0.5 | 7.6 | trained recreational players about 7.3 (15.8%) | 11% |
| 0.75 | 8.9 | national level 8-9.4 | 10% |
| 1 | 11.2 | professional men 10-11 | 7% (pros about 10) |

## Personalities

Four styles (`data/ai.json`; nicknames, never real players). Each trait multiplies a choice: `net` (how readily
the pair takes the net, how close in it stands, how good a lob must be to follow), `lob`, `drop` (drops and
chiquitas), `smash` (smash rather than bandeja, and from how far), `vibora`, `margin` (distance kept from lines
and walls), `pace` (above 0: drives over slices and power on drives, slices and mid-height volleys; below 0:
slices and precision, lobs included), and `level` (added to the match's level).

Measured over 60 mixed matches at the top level, about 2,400 shots each (`scratch/style-sig.ts`; the test is
`tests/sim/ai.test.ts`):

| Style | Plays like | Lobs | Drives | Smash of overheads | Víbora of overheads | Pace (km/h) | Winners / errors per shot |
|---|---|---|---|---|---|---|---|
| El Relojero | the neutral, steady baseline | 18% | 15% | 44% | 16% | 60.8 | 3.5% / 5.9% |
| El Muro | lobs and slices, bandejas, few errors | 30% | 6% | 13% | 21% | 57.9 | 1.9% / 4.6% |
| Martillo | flat drives, smashes everything, wins and loses points | 11% | 27% | 72% | 3% | 61.3 | 4.6% / 8.5% |
| La Serpiente | víboras into the side glass, drops and chiquitas | 15% | 12% | 23% | 62% | 57.8 | 3.8% / 6.2% |

## Measuring

```
node tools/match-stats.ts --points 2000 --level 1 --workers 7 [--pressure]
node tools/match-stats.ts --matches 1000 --level 1 --workers 7 --json out.json
```

It plays AI doubles headless on worker threads and reports what the match-analysis studies report: shots and
seconds a point, rally-length shares, point endings (winner / forced / unforced error, with the pressure judgement
in `src/sim/ai/pressure.ts` written before any tuning and never changed by it), how winners and errors finish, the
last shot of each, the shot mix, where shots are hit from, per-stroke outcomes, serve numbers, and the serving
pair's win rate by rally length. `--pressure` adds each stroke's error rate by pressure.

## Top level against the professionals

From the 1,000-match run at the end of Phase 4 (`DECISIONS.md` has the table): rally length, point endings,
serve numbers, where shots are hit from and the last shot of winners and errors sit in or near the professional
ranges. Known gaps: shots off the back glass are 27% of all shots (pros 12.8%; the defenders retrieve deep
volleys off the glass for longer than pros do), errors finish in the net more and off the side wall less than
pros', and groundstrokes taken under heavy pressure (half-volleys of smashes) err more than the pros' 4.6-5.8%.
