# QA army: p7-r3

2000 matches (seed0 2), 535.4 h of play, 231.3 M ticks, 160232 points, in 29.1 min on 6 workers. Oracles: on.

Matches with any problem: 5.

Slowest sim tick: 355.18 ms; ticks over 4 ms: 303285 (1311.4 per million).

Heap after each match (after GC): first 12.7 MB, last 14.3 MB, max 14.6 MB.

## Problems by kind

- **spin-too-high: spin** — 8× in 2 matches; first: match 230 tick 134482 (`node tools/qa/army.ts --seed0 2 --only 230`)
  - spin 911 rad/s
- **side-flip-low: sideZ** — 2× in 2 matches; first: match 460 tick 76945 (`node tools/qa/army.ts --seed0 2 --only 460`)
  - sideZ changed sign with the ball at y 0.821 z -0.313 (netSide -1, inNet false)
- **ball-in-wall: side** — 1× in 1 matches; first: match 1463 tick 141089 (`node tools/qa/army.ts --seed0 2 --only 1463`)
  - ball 0.032 m into the side wall at z -6.022 y 3.978 (surface 2), vel -1.689,-7.118,-6.598
