# QA army: p9-physics

300 matches (seed0 1), 86.3 h of play, 37.3 M ticks, 25238 points, in 3.2 min on 5 workers. Oracles: on.

Matches with any problem: 15.

Slowest sim tick: 100.78 ms; ticks over 4 ms: 1684 (45.2 per million).

Heap after each match (after GC): first 12.7 MB, last 14.3 MB, max 14.5 MB.

## Problems by kind

- **ball-very-high: height** — 56× in 14 matches; first: match 13 tick 314168 (`node tools/qa/army.ts --seed0 1 --only 13`)
  - ball at 14.0 m
- **spin-too-high: spin** — 8× in 2 matches; first: match 20 tick 14510 (`node tools/qa/army.ts --seed0 1 --only 20`)
  - spin 410 rad/s at 3.6 m/s
