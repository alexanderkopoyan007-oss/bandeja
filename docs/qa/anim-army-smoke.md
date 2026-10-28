# Animation army: smoke

`node tools/qa/anim-army.ts --configs 40 --secs 20 --seed0 1`: 1 configurations x 20 s of play with the animated bodies (0 min), 0.0 min on 1 workers. Judged on tests/render/animQa.test.ts's thresholds (contact limits doubled where a bot or monkey human plays).

**0 of 1 configurations fail a threshold.**

| # | Configuration | Skate | Pops/min | Racket-ball p50/p90 (cm) | Racket in body | Hand in torso | Legs | Fastest turn (°) | Knee spins | Fails |
|---|---|---|---|---|---|---|---|---|---|---|
| 3 | #3 doubles standard carpet standard golden bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.28/0.48 | 14.1 | 21.0 | 0.2 / 3.7 | 0.69% | 0.28% | 2.17% | 95 | 0 | ok |
