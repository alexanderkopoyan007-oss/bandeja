# Animation army: a1

`node tools/qa/anim-army.ts --configs 60 --secs 90 --seed0 1`: 60 configurations x 90 s of play with the animated bodies (90 min), 1.0 min on 3 workers. Judged on tests/render/animQa.test.ts's thresholds (contact limits doubled where a bot or monkey human plays).

**18 of 60 configurations fail a threshold.**

| Failure | Configurations |
|---|---|
| pops per min | 10 |
| legs through share | 5 |
| racket in body share | 3 |
| serve hand in torso | 3 |
| serve pops per min | 3 |
| fastest one-frame turn ° | 2 |
| one-frame flips of 105° or more | 1 |

| # | Configuration | Skate | Pops/min | Racket-ball p50/p90 (cm) | Racket in body | Hand in torso | Legs | Fastest turn (°) | Knee spins | Fails |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | #0 doubles panoramic turf standard adv bo3 4g normal humans=monkey,ai,ai,ai ai=0.30/0.40 | 10.9 | 29.7 | 0.4 / 1.8 | 0.69% | 0.33% | 1.86% | 94 | 0 | ok |
| 1 | #1 singles standard carpet standard adv bo1 6g normal humans=monkey,ai ai=0.28/0.52 | 4.8 | 13.7 | 0.7 / 0.8 | 0.30% | 0.32% | 1.31% | 77 | 0 | ok |
| 2 | #2 doubles panoramic turf standard wind adv bo3 6g tb7 humans=ai,ai,ai,ai ai=0.16/0.54 | 13.6 | 13.5 | 0.6 / 2.1 | 0.23% | 0.38% | 1.63% | 62 | 0 | ok |
| 3 | #3 doubles standard carpet standard golden bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.28/0.48 | 13.6 | 27.0 | 0.5 / 3.5 | 0.66% | 0.59% | 2.24% | 95 | 0 | ok |
| 4 | #4 doubles panoramic turf standard star bo3 4g tb7 humans=ai,ai,ai,ai ai=0.29/0.19 | 14.6 | 17.0 | 0.8 / 5.9 | 0.14% | 0.44% | 2.21% | 62 | 0 | ok |
| 5 | #5 doubles panoramic turf standard star bo3 6g normal humans=bot,monkey,ai,ai ai=0.12/0.37 | 12.0 | 21.7 | 0.4 / 2.6 | 0.73% | 0.38% | 2.48% | 76 | 0 | ok |
| 6 | #6 doubles standard clay altitude adv bo3 6g stb10 humans=monkey,monkey,monkey,monkey ai=0.40/0.95 | 20.9 | 59.7 | 0.6 / 1.1 | 1.43% | 1.25% | 3.96% | 72 | 0 | pops per min 59.667 (limit 30); racket in body share 0.014 (limit 0.01) |
| 7 | #7 doubles standard clay standard star bo3 4g normal humans=ai,ai,ai,ai ai=0.98/0.83 | 17.6 | 16.7 | 0.3 / 1.3 | 0.19% | 1.32% | 3.11% | 96 | 0 | ok |
| 8 | #8 doubles standard carpet standard adv bo3 6g tb7 humans=bot,ai,bot,ai ai=0.11/0.61 | 13.7 | 17.0 | 0.1 / 3.6 | 0.23% | 0.39% | 2.41% | 73 | 0 | ok |
| 9 | #9 singles panoramic turf standard wind star bo3 6g normal humans=bot,ai ai=0.03/0.15 | 12.4 | 25.3 | 0.7 / 4.9 | 0.38% | 0.68% | 4.73% | 93 | 0 | ok |
| 10 | #10 doubles standard turf altitude wind star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.11/0.01 | 12.6 | 9.7 | 0.8 / 2.2 | 0.36% | 0.36% | 1.70% | 82 | 0 | ok |
| 11 | #11 singles singles-narrow turf altitude wind star bo1 4g normal humans=monkey,monkey ai=0.34/0.40 | 14.0 | 34.7 | 0.6 / 0.8 | 2.25% | 0.54% | 3.18% | 51 | 0 | pops per min 34.667 (limit 30); racket in body share 0.022 (limit 0.01) |
| 12 | #12 singles standard clay standard golden bo3 4g normal humans=bot,ai ai=0.79/0.14 | 11.9 | 28.3 | 0.5 / 3.4 | 0.55% | 0.32% | 2.92% | 117 | 0 | 1 one-frame flips of 105° or more; fastest one-frame turn ° 117.238 (limit 105) |
| 13 | #13 singles standard turf standard wind star bo3 6g normal humans=monkey,monkey ai=0.61/0.40 | 13.2 | 31.3 | 0.2 / 0.5 | 0.59% | 0.44% | 3.13% | 69 | 0 | pops per min 31.333 (limit 30); serve hand in torso 0.006 (limit 0.005); serve pops per min 31.800 (limit 25) |
| 14 | #14 doubles panoramic clay standard star bo3 6g no-tb humans=bot,ai,bot,ai ai=0.45/0.10 | 12.6 | 16.2 | 0.2 / 2.9 | 0.18% | 0.30% | 1.74% | 88 | 0 | ok |
| 15 | #15 doubles standard carpet standard star bo3 6g tb7 humans=ai,ai,ai,ai ai=0.42/0.51 | 13.4 | 15.7 | 0.3 / 2.2 | 0.32% | 0.44% | 2.07% | 71 | 0 | ok |
| 16 | #16 doubles standard turf standard golden bo1 6g tb7 humans=ai,ai,ai,ai ai=0.78/0.07 | 12.4 | 16.3 | 0.4 / 1.3 | 0.14% | 0.40% | 1.57% | 77 | 0 | ok |
| 17 | #17 doubles panoramic turf standard star bo3 6g normal humans=ai,ai,ai,ai ai=0.68/0.40 | 12.6 | 21.5 | 0.5 / 1.4 | 0.18% | 0.34% | 1.64% | 78 | 0 | ok |
| 18 | #18 singles singles-narrow carpet standard golden bo3 4g normal humans=monkey,monkey ai=0.66/0.78 | 10.9 | 30.0 | 0.1 / 0.3 | 1.00% | 0.23% | 2.47% | 70 | 0 | pops per min 30.000 (limit 30) |
| 19 | #19 doubles panoramic turf standard star bo1 6g tb7 humans=ai,ai,ai,ai ai=0.86/0.79 | 17.2 | 20.3 | 0.6 / 2.5 | 0.32% | 1.07% | 3.28% | 87 | 0 | ok |
| 20 | #20 doubles standard clay standard wind star bo3 6g normal humans=bot,ai,bot,ai ai=0.72/0.82 | 15.7 | 23.8 | 0.5 / 7.0 | 0.44% | 0.68% | 2.80% | 75 | 0 | ok |
| 21 | #21 doubles standard carpet standard golden bo3 4g normal humans=bot,monkey,ai,ai ai=0.33/0.19 | 12.7 | 29.5 | 0.1 / 11.9 | 0.37% | 0.41% | 2.35% | 91 | 0 | serve pops per min 28.256 (limit 25) |
| 22 | #22 doubles standard turf standard adv bo3 6g normal humans=bot,ai,ai,ai ai=0.40/0.48 | 15.3 | 15.5 | 0.4 / 2.4 | 0.19% | 0.26% | 1.61% | 75 | 0 | ok |
| 23 | #23 singles singles-narrow turf standard golden bo1 4g tb7 humans=ai,ai ai=0.21/0.10 | 14.5 | 16.7 | 0.7 / 4.4 | 0.20% | 0.61% | 3.25% | 77 | 0 | ok |
| 24 | #24 singles standard turf standard star bo3 4g normal humans=ai,ai ai=0.92/0.17 | 16.2 | 28.3 | 0.6 / 4.4 | 0.35% | 0.54% | 7.01% | 88 | 0 | legs through share 0.070 (limit 0.05) |
| 25 | #25 doubles standard turf standard star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.87/0.18 | 13.9 | 13.8 | 0.6 / 2.2 | 0.19% | 0.73% | 1.91% | 101 | 0 | ok |
| 26 | #26 doubles standard clay standard star bo3 4g no-tb humans=bot,ai,ai,ai ai=0.23/0.28 | 11.6 | 12.3 | 0.4 / 3.5 | 0.19% | 0.35% | 1.65% | 85 | 0 | ok |
| 27 | #27 doubles standard turf standard wind star bo3 4g normal humans=ai,ai,ai,ai ai=0.11/0.57 | 14.0 | 12.7 | 0.5 / 2.9 | 0.15% | 0.50% | 2.06% | 79 | 0 | ok |
| 28 | #28 doubles standard turf standard adv bo3 6g stb10 humans=bot,monkey,ai,ai ai=0.48/0.37 | 4.4 | 10.0 | 0.3 / 1.2 | 0.00% | 0.05% | 0.85% | 70 | 0 | ok |
| 29 | #29 doubles panoramic carpet standard wind adv bo3 4g stb10 humans=bot,ai,ai,ai ai=0.25/0.10 | 13.7 | 12.3 | 0.8 / 4.9 | 0.18% | 0.37% | 2.54% | 79 | 0 | ok |
| 30 | #30 singles panoramic turf standard adv bo3 4g normal humans=bot,monkey ai=0.14/0.94 | 9.1 | 32.3 | 0.1 / 0.6 | 0.29% | 0.38% | 1.43% | 62 | 0 | pops per min 32.333 (limit 30) |
| 31 | #31 singles singles-narrow turf standard adv bo3 6g no-tb humans=monkey,monkey ai=0.14/0.06 | 15.3 | 38.7 | 0.2 / 0.6 | 0.38% | 0.16% | 2.63% | 69 | 0 | pops per min 38.667 (limit 30) |
| 32 | #32 doubles standard carpet altitude wind star bo1 6g normal humans=bot,ai,bot,ai ai=0.04/0.38 | 13.7 | 20.0 | 0.1 / 2.1 | 0.22% | 0.20% | 2.94% | 65 | 0 | ok |
| 33 | #33 doubles standard turf standard adv bo1 6g stb10 humans=bot,monkey,ai,ai ai=0.76/0.07 | 14.7 | 28.5 | 0.4 / 1.3 | 0.39% | 0.80% | 3.09% | 63 | 0 | ok |
| 34 | #34 singles panoramic hard altitude star bo3 4g no-tb humans=bot,ai ai=0.11/0.78 | 12.1 | 19.0 | 0.1 / 2.6 | 0.19% | 0.47% | 3.90% | 79 | 0 | ok |
| 35 | #35 doubles standard carpet standard adv bo3 6g no-tb humans=bot,ai,ai,ai ai=0.90/0.84 | 14.8 | 14.8 | 0.1 / 1.8 | 0.13% | 0.56% | 1.58% | 69 | 0 | ok |
| 36 | #36 doubles standard carpet altitude adv bo3 6g stb10 humans=ai,ai,ai,ai ai=0.26/0.93 | 15.0 | 10.8 | 0.7 / 3.4 | 0.18% | 0.41% | 2.33% | 73 | 0 | ok |
| 37 | #37 doubles standard turf standard wind star bo1 6g tb7 humans=ai,ai,ai,ai ai=0.39/0.53 | 13.5 | 12.0 | 0.7 / 4.5 | 0.34% | 0.63% | 2.39% | 73 | 0 | ok |
| 38 | #38 singles standard carpet standard wind star bo3 6g normal humans=ai,ai ai=0.05/0.01 | 14.5 | 27.7 | 0.4 / 2.2 | 0.22% | 0.48% | 5.18% | 97 | 0 | legs through share 0.052 (limit 0.05) |
| 39 | #39 doubles panoramic turf standard star bo3 4g normal humans=bot,ai,ai,ai ai=0.33/0.35 | 16.5 | 17.7 | 0.2 / 2.6 | 0.22% | 0.58% | 2.81% | 74 | 0 | ok |
| 40 | #40 doubles panoramic hard standard wind star bo3 4g normal humans=ai,ai,ai,ai ai=0.96/0.91 | 17.0 | 13.3 | 0.6 / 3.6 | 0.24% | 0.88% | 3.51% | 70 | 0 | ok |
| 41 | #41 doubles panoramic hard standard wind star bo3 4g stb10 humans=bot,monkey,ai,ai ai=0.99/0.20 | 13.3 | 24.3 | 0.5 / 2.2 | 0.53% | 0.38% | 2.32% | 94 | 0 | ok |
| 42 | #42 doubles panoramic turf altitude adv bo3 6g stb10 humans=ai,ai,ai,ai ai=0.89/0.14 | 12.0 | 12.5 | 0.6 / 2.0 | 0.19% | 0.39% | 1.78% | 70 | 0 | ok |
| 43 | #43 singles singles-narrow carpet standard wind adv bo3 6g normal humans=bot,ai ai=0.03/0.19 | 14.1 | 21.7 | 0.6 / 3.1 | 0.36% | 1.00% | 2.64% | 57 | 0 | ok |
| 44 | #44 doubles standard turf standard adv bo3 4g normal humans=monkey,monkey,monkey,monkey ai=0.78/0.41 | 19.6 | 41.5 | 0.1 / 0.3 | 2.07% | 0.86% | 4.54% | 75 | 0 | pops per min 41.500 (limit 30); racket in body share 0.021 (limit 0.01); serve pops per min 29.978 (limit 25) |
| 45 | #45 singles standard turf standard adv bo1 6g stb10 humans=ai,ai ai=0.05/0.11 | 13.9 | 18.0 | 0.7 / 2.0 | 0.26% | 0.51% | 5.18% | 73 | 0 | legs through share 0.052 (limit 0.05) |
| 46 | #46 singles standard hard standard adv bo3 6g stb10 humans=ai,ai ai=0.79/0.95 | 20.5 | 24.7 | 0.5 / 1.9 | 0.23% | 1.43% | 7.78% | 46 | 0 | legs through share 0.078 (limit 0.05) |
| 47 | #47 doubles standard turf standard wind star bo3 4g tb7 humans=bot,ai,ai,ai ai=0.62/0.80 | 13.6 | 20.3 | 0.6 / 4.4 | 0.29% | 0.58% | 2.34% | 64 | 0 | ok |
| 48 | #48 doubles standard turf standard wind adv bo3 6g stb10 humans=monkey,ai,ai,ai ai=0.58/0.26 | 7.3 | 18.3 | 0.4 / 0.7 | 0.25% | 0.12% | 1.08% | 85 | 0 | ok |
| 49 | #49 singles singles-narrow hard standard wind star bo1 4g stb10 humans=monkey,ai ai=0.65/0.06 | 13.5 | 30.3 | 0.5 / 2.7 | 0.47% | 0.40% | 3.68% | 84 | 0 | pops per min 30.333 (limit 30) |
| 50 | #50 doubles standard hard standard star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.69/0.76 | 14.0 | 10.8 | 0.7 / 3.5 | 0.22% | 0.52% | 2.24% | 57 | 0 | ok |
| 51 | #51 doubles standard clay standard wind star bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.69/0.25 | 8.9 | 20.8 | 0.6 / 1.0 | 0.10% | 0.12% | 1.14% | 74 | 0 | ok |
| 52 | #52 singles standard turf standard star bo3 4g no-tb humans=bot,ai ai=0.02/0.21 | 12.1 | 27.7 | 0.3 / 2.1 | 0.31% | 0.38% | 4.13% | 89 | 0 | ok |
| 53 | #53 singles panoramic turf standard wind star bo3 6g stb10 humans=ai,ai ai=0.83/0.40 | 17.8 | 26.7 | 1.1 / 2.9 | 0.20% | 1.00% | 8.09% | 77 | 0 | legs through share 0.081 (limit 0.05) |
| 54 | #54 doubles standard turf standard golden bo3 4g no-tb humans=ai,ai,ai,ai ai=0.45/0.79 | 14.4 | 17.0 | 0.5 / 3.0 | 0.22% | 0.70% | 2.40% | 51 | 0 | ok |
| 55 | #55 doubles standard clay standard golden bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.80/0.91 | 11.4 | 30.0 | 0.2 / 0.9 | 0.47% | 0.43% | 2.52% | 137 | 0 | pops per min 30.000 (limit 30); serve hand in torso 0.006 (limit 0.005); fastest one-frame turn ° 136.845 (limit 105) |
| 56 | #56 singles singles-narrow turf standard wind star bo3 6g normal humans=ai,ai ai=0.53/0.73 | 16.8 | 23.3 | 0.9 / 4.1 | 0.27% | 0.57% | 4.41% | 75 | 0 | ok |
| 57 | #57 doubles panoramic turf standard star bo3 4g no-tb humans=bot,ai,ai,ai ai=0.76/0.36 | 13.2 | 12.0 | 0.5 / 3.7 | 0.10% | 0.40% | 1.68% | 76 | 0 | ok |
| 58 | #58 doubles panoramic turf standard wind adv bo3 4g no-tb humans=monkey,ai,ai,ai ai=0.37/0.71 | 8.5 | 12.8 | 0.3 / 2.1 | 0.40% | 0.14% | 1.27% | 53 | 0 | serve hand in torso 0.006 (limit 0.005) |
| 59 | #59 singles panoramic carpet standard wind star bo3 6g normal humans=monkey,ai ai=0.13/0.85 | 14.3 | 47.3 | 0.5 / 3.1 | 0.56% | 1.09% | 4.28% | 79 | 0 | pops per min 47.333 (limit 30) |

## Worst moments in the failing runs

- #6: pop pop LeftArm p3 t=38.7 72.4°, pop pop LeftArm p0 t=30.4 69.7°, pop pop LeftArm p3 t=44.5 63.9°, turn turn LeftArm p3 t=38.7 72.4°, turn turn LeftArm p0 t=30.4 69.7°, clip legs thighL/thighR p3 t=61.2 14.9 cm, clip legs thighL/thighR p0 t=29.2 14.9 cm, clip legs thighL/thighR p0 t=60.6 14.8 cm, contact slice at 0.40 m p0 t=60.9 30.0 cm, contact slice at 0.70 m p2 t=82.2 2.9 cm
- #11: pop pop RightForeArm p1 t=82.5 27.3°, pop pop RightForeArm p0 t=55.7 23.1°, pop pop LeftForeArm p0 t=80.9 21.9°, turn turn RightForeArm p1 t=34.5 50.8°, turn turn LeftForeArm p1 t=88.4 50.2°, clip legs thighL/thighR p0 t=71.8 14.9 cm, clip legs thighL/thighR p0 t=71.8 14.1 cm, clip legs thighL/thighR p0 t=71.9 14.1 cm, contact serve at 0.78 m p0 t=18.9 0.8 cm, contact serve at 0.79 m p1 t=71.4 0.8 cm
- #12: pop pop RightForeArm p0 t=76.2 117.2°, pop pop RightArm p0 t=76.2 100.0°, pop pop LeftArm p1 t=56.5 75.7°, turn turn RightForeArm p0 t=76.2 117.2°, turn turn RightArm p0 t=76.2 100.0°, clip legs thighL/thighR p0 t=55.2 14.9 cm, clip legs thighL/thighR p1 t=10.9 14.8 cm, clip legs thighL/thighR p0 t=55.3 14.8 cm, contact bandeja at 2.75 m p1 t=19.3 53.3 cm, contact lob at 0.09 m p0 t=17.4 24.3 cm
- #13: pop pop LeftArm p1 t=10.7 68.7°, pop pop LeftArm p1 t=59.6 60.8°, pop pop LeftArm p1 t=47.4 56.4°, turn turn LeftArm p1 t=10.7 68.7°, turn turn LeftArm p1 t=59.6 60.8°, clip legs thighL/thighR p1 t=58.2 14.9 cm, clip legs thighL/thighR p1 t=58.3 14.7 cm, clip legs thighL/thighR p1 t=58.2 14.6 cm, contact serve at 0.88 m p1 t=1.1 0.7 cm, contact serve at 0.89 m p1 t=57.2 0.5 cm
- #18: pop pop LeftArm p0 t=85.5 51.2°, pop pop RightForeArm p0 t=26.7 45.4°, pop pop RightForeArm p0 t=76.6 30.6°, turn turn RightForeArm p0 t=36.2 70.4°, turn turn LeftForeArm p0 t=76.6 63.6°, clip legs thighL/thighR p0 t=26.3 14.7 cm, clip legs thighL/thighR p0 t=52.0 14.6 cm, clip legs thighL/thighR p0 t=27.2 14.5 cm, contact serve at 0.81 m p1 t=53.7 0.4 cm, contact serve at 0.81 m p0 t=15.0 0.3 cm
- #21: pop pop RightForeArm p0 t=78.9 90.9°, pop pop RightForeArm p3 t=54.3 83.2°, pop pop LeftArm p0 t=75.1 76.2°, turn turn RightForeArm p0 t=78.9 90.9°, turn turn RightForeArm p3 t=54.3 83.2°, clip legs thighL/thighR p3 t=21.4 14.8 cm, clip legs thighL/thighR p3 t=74.2 14.4 cm, clip legs thighL/thighR p1 t=5.8 14.1 cm, contact volley at 1.02 m p0 t=55.1 79.9 cm, contact bandeja at 2.19 m p1 t=8.1 64.0 cm
- #24: pop pop LeftHand p0 t=62.9 85.2°, pop pop LeftArm p0 t=62.9 84.7°, pop pop LeftArm p1 t=81.2 77.7°, turn turn RightForeArm p1 t=65.7 88.4°, turn turn LeftHand p0 t=62.9 85.2°, clip legs thighL/thighR p1 t=23.2 14.9 cm, clip legs thighL/thighR p1 t=8.8 14.8 cm, clip legs thighL/thighR p1 t=32.3 14.8 cm, contact smash at 2.65 m p0 t=61.1 42.9 cm, contact volley at 0.23 m p1 t=85.9 7.6 cm
- #30: pop pop LeftArm p0 t=33.9 61.5°, pop pop LeftArm p0 t=38.5 59.7°, pop pop RightForeArm p1 t=84.5 59.1°, turn turn LeftArm p0 t=33.9 61.5°, turn turn RightForeArm p1 t=61.3 60.5°, clip legs shinL/shinR p1 t=44.7 11.6 cm, clip legs shinL/shinR p1 t=44.7 11.6 cm, clip legs shinL/shinR p1 t=30.7 11.5 cm, contact serve at 0.86 m p0 t=36.0 1.0 cm, contact serve at 0.87 m p0 t=64.5 0.7 cm
- #31: pop pop LeftArm p1 t=54.8 69.2°, pop pop LeftArm p0 t=76.9 68.8°, pop pop LeftArm p0 t=25.9 67.0°, turn turn LeftArm p1 t=54.8 69.2°, turn turn LeftArm p0 t=76.9 68.8°, clip legs thighL/thighR p0 t=20.6 13.1 cm, clip legs thighL/thighR p0 t=20.6 12.7 cm, clip legs thighL/thighR p0 t=20.6 12.5 cm, contact topspin at 0.55 m p1 t=18.8 2.0 cm, contact serve at 0.89 m p1 t=47.5 0.7 cm
- #38: pop pop LeftHand p1 t=11.8 96.9°, pop pop LeftArm p1 t=11.8 96.4°, pop pop LeftHand p1 t=44.5 84.7°, turn turn LeftHand p1 t=11.8 96.9°, turn turn LeftArm p1 t=11.8 96.4°, clip legs thighL/thighR p1 t=89.6 14.9 cm, clip legs thighL/thighR p1 t=89.6 14.7 cm, clip legs thighL/thighR p1 t=68.5 14.7 cm, contact volley at 0.45 m p0 t=17.9 36.2 cm, contact drive at 0.53 m p0 t=67.2 35.0 cm
- #44: pop pop RightForeArm p2 t=28.4 74.5°, pop pop LeftArm p1 t=64.1 68.2°, pop pop RightForeArm p3 t=63.6 66.5°, turn turn RightForeArm p2 t=28.4 74.5°, turn turn LeftArm p1 t=64.1 68.2°, clip legs thighL/thighR p3 t=73.9 14.9 cm, clip legs thighL/thighR p3 t=73.9 14.9 cm, clip legs thighL/thighR p3 t=73.9 14.9 cm, contact serve at 0.85 m p1 t=19.9 0.7 cm, contact serve at 0.87 m p1 t=3.3 0.3 cm
- #45: pop pop LeftArm p1 t=65.7 67.5°, pop pop LeftArm p0 t=31.8 63.9°, pop pop RightForeArm p1 t=24.9 50.8°, turn turn RightForeArm p0 t=68.4 73.2°, turn turn LeftArm p1 t=65.7 67.5°, clip legs thighL/thighR p1 t=8.0 14.7 cm, clip legs thighL/thighR p1 t=8.0 14.7 cm, clip legs thighL/thighR p1 t=8.0 14.7 cm, contact topspin at 0.52 m p1 t=8.0 7.8 cm, contact volley at 1.17 m p0 t=88.9 3.8 cm
- #46: pop pop LeftForeArm p0 t=49.5 43.3°, pop pop LeftForeArm p0 t=9.5 38.6°, pop pop LeftForeArm p0 t=28.1 38.0°, turn turn LeftHand p0 t=80.8 46.2°, turn turn RightForeArm p1 t=51.5 45.8°, clip legs thighL/thighR p0 t=61.3 14.6 cm, clip legs thighL/thighR p1 t=19.4 14.6 cm, clip legs thighL/thighR p0 t=20.2 14.6 cm, contact drive at 1.01 m p1 t=88.8 3.3 cm, contact drive at 0.70 m p1 t=39.4 2.9 cm
- #49: pop pop RightArm p0 t=24.9 84.3°, pop pop RightForeArm p0 t=24.9 81.5°, pop pop LeftArm p1 t=15.6 72.9°, turn turn RightArm p0 t=24.9 84.3°, turn turn RightForeArm p0 t=24.9 81.5°, clip legs thighL/thighR p0 t=24.4 14.4 cm, clip legs shinL/thighR p0 t=24.4 13.1 cm, clip legs shinL/thighR p0 t=24.4 13.0 cm, contact slice at 0.53 m p0 t=74.3 69.6 cm, contact drive at 0.49 m p0 t=82.7 16.8 cm
- #53: pop pop RightForeArm p1 t=76.2 73.4°, pop pop LeftArm p0 t=42.7 70.6°, pop pop LeftArm p1 t=7.3 70.0°, turn turn RightForeArm p1 t=64.8 77.5°, turn turn RightForeArm p1 t=76.2 73.4°, clip legs thighL/thighR p0 t=53.1 14.8 cm, clip legs thighL/thighR p1 t=54.1 14.5 cm, clip legs thighL/thighR p1 t=12.6 14.4 cm, contact bandeja at 1.85 m p1 t=76.2 9.6 cm, contact volley at 0.36 m p0 t=49.4 7.1 cm
- #55: pop pop RightForeArm p0 t=2.8 103.3°, pop pop RightHand p0 t=13.0 83.6°, pop pop LeftArm p0 t=65.1 83.3°, turn turn RightForeArm p0 t=13.0 136.8°, turn turn RightForeArm p0 t=2.8 103.3°, clip legs thighL/thighR p1 t=88.5 14.9 cm, clip legs thighL/thighR p1 t=88.5 14.8 cm, clip legs thighL/thighR p1 t=88.5 14.8 cm, contact topspin at 0.45 m p0 t=86.3 3.2 cm, contact slice at 0.27 m p2 t=17.8 2.2 cm
- #58: pop pop LeftArm p1 t=63.8 52.6°, pop pop RightForeArm p3 t=16.2 30.1°, pop pop RightLeg p2 t=87.8 27.9°, turn turn LeftArm p1 t=63.8 52.6°, turn turn RightForeArm p0 t=36.8 46.4°, clip legs thighL/thighR p0 t=72.8 14.4 cm, clip legs thighL/thighR p0 t=72.7 14.2 cm, clip legs thighL/thighR p0 t=72.7 14.2 cm, contact volley at 0.31 m p0 t=82.8 4.5 cm, contact volley at 1.64 m p1 t=69.1 3.1 cm
- #59: pop pop RightForeArm p0 t=10.6 79.5°, pop pop RightForeArm p0 t=41.1 73.7°, pop pop LeftArm p1 t=67.2 66.5°, turn turn RightForeArm p0 t=10.6 79.5°, turn turn RightForeArm p0 t=41.1 73.7°, clip legs thighL/thighR p0 t=11.5 14.2 cm, clip legs thighL/thighR p0 t=64.9 14.1 cm, clip legs thighL/thighR p0 t=64.9 14.0 cm, contact slice at 0.55 m p0 t=79.2 86.2 cm, contact slice at 0.85 m p0 t=12.4 5.3 cm
