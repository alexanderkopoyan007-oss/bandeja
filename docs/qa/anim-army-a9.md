# Animation army: a9

`node tools/qa/anim-army.ts --configs 60 --secs 90 --seed0 1`: 60 configurations x 90 s of play with the animated bodies (90 min), 0.6 min on 5 workers. Judged on tests/render/animQa.test.ts's thresholds (contact limits doubled where a bot or monkey human plays).

**7 of 60 configurations fail a threshold.**

| Failure | Configurations |
|---|---|
| pops per min | 3 |
| racket in body share | 3 |
| serve hand in torso | 3 |
| serve pops per min | 1 |

| # | Configuration | Skate | Pops/min | Racket-ball p50/p90 (cm) | Racket in body | Hand in torso | Legs | Fastest turn (°) | Knee spins | Fails |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | #0 doubles panoramic turf standard adv bo3 4g normal humans=monkey,ai,ai,ai ai=0.30/0.40 | 11.3 | 17.0 | 0.6 / 2.0 | 0.82% | 0.35% | 1.28% | 54 | 0 | ok |
| 1 | #1 singles standard carpet standard adv bo1 6g normal humans=monkey,ai ai=0.28/0.52 | 5.3 | 8.0 | 0.8 / 0.9 | 0.23% | 0.28% | 1.23% | 34 | 0 | ok |
| 2 | #2 doubles panoramic turf standard wind adv bo3 6g tb7 humans=ai,ai,ai,ai ai=0.16/0.54 | 13.8 | 9.7 | 0.7 / 2.1 | 0.21% | 0.38% | 1.52% | 39 | 0 | ok |
| 3 | #3 doubles standard carpet standard golden bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.28/0.48 | 13.3 | 15.7 | 0.7 / 4.2 | 0.93% | 0.63% | 1.63% | 58 | 0 | ok |
| 4 | #4 doubles panoramic turf standard star bo3 4g tb7 humans=ai,ai,ai,ai ai=0.29/0.19 | 15.5 | 14.7 | 1.1 / 4.4 | 0.16% | 0.47% | 2.05% | 53 | 0 | ok |
| 5 | #5 doubles panoramic turf standard star bo3 6g normal humans=bot,monkey,ai,ai ai=0.12/0.37 | 12.7 | 13.3 | 0.5 / 2.6 | 0.70% | 0.36% | 2.08% | 44 | 0 | ok |
| 6 | #6 doubles standard clay altitude adv bo3 6g stb10 humans=monkey,monkey,monkey,monkey ai=0.40/0.95 | 21.7 | 43.7 | 0.9 / 2.9 | 1.53% | 0.94% | 4.14% | 52 | 0 | pops per min 43.667 (limit 30); racket in body share 0.015 (limit 0.01) |
| 7 | #7 doubles standard clay standard star bo3 4g normal humans=ai,ai,ai,ai ai=0.98/0.83 | 18.6 | 11.0 | 0.6 / 2.6 | 0.17% | 1.50% | 3.10% | 39 | 0 | ok |
| 8 | #8 doubles standard carpet standard adv bo3 6g tb7 humans=bot,ai,bot,ai ai=0.11/0.61 | 14.4 | 12.5 | 0.5 / 3.3 | 0.26% | 0.41% | 2.27% | 42 | 0 | ok |
| 9 | #9 singles panoramic turf standard wind star bo3 6g normal humans=bot,ai ai=0.03/0.15 | 12.9 | 17.7 | 0.7 / 4.9 | 0.43% | 0.73% | 3.17% | 50 | 0 | ok |
| 10 | #10 doubles standard turf altitude wind star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.11/0.01 | 12.6 | 7.3 | 1.1 / 3.4 | 0.34% | 0.33% | 1.86% | 50 | 0 | ok |
| 11 | #11 singles singles-narrow turf altitude wind star bo1 4g normal humans=monkey,monkey ai=0.34/0.40 | 14.3 | 26.0 | 0.6 / 0.8 | 2.38% | 0.34% | 2.66% | 46 | 0 | racket in body share 0.024 (limit 0.01) |
| 12 | #12 singles standard clay standard golden bo3 4g normal humans=bot,ai ai=0.79/0.14 | 13.3 | 10.7 | 0.7 / 4.7 | 0.78% | 0.29% | 2.40% | 44 | 0 | ok |
| 13 | #13 singles standard turf standard wind star bo3 6g normal humans=monkey,monkey ai=0.61/0.40 | 14.7 | 22.7 | 0.4 / 0.7 | 0.58% | 0.50% | 1.99% | 43 | 0 | serve hand in torso 0.006 (limit 0.005); serve pops per min 31.800 (limit 25) |
| 14 | #14 doubles panoramic clay standard star bo3 6g no-tb humans=bot,ai,bot,ai ai=0.45/0.10 | 12.3 | 10.5 | 0.4 / 2.7 | 0.17% | 0.16% | 1.73% | 39 | 0 | ok |
| 15 | #15 doubles standard carpet standard star bo3 6g tb7 humans=ai,ai,ai,ai ai=0.42/0.51 | 13.7 | 10.7 | 0.6 / 2.9 | 0.32% | 0.54% | 1.85% | 39 | 0 | ok |
| 16 | #16 doubles standard turf standard golden bo1 6g tb7 humans=ai,ai,ai,ai ai=0.78/0.07 | 12.8 | 10.3 | 0.6 / 1.9 | 0.23% | 0.41% | 1.50% | 52 | 0 | ok |
| 17 | #17 doubles panoramic turf standard star bo3 6g normal humans=ai,ai,ai,ai ai=0.68/0.40 | 13.1 | 11.3 | 0.8 / 3.4 | 0.10% | 0.48% | 1.48% | 43 | 0 | ok |
| 18 | #18 singles singles-narrow carpet standard golden bo3 4g normal humans=monkey,monkey ai=0.66/0.78 | 12.3 | 26.0 | 0.2 / 0.7 | 0.90% | 0.20% | 1.92% | 53 | 0 | ok |
| 19 | #19 doubles panoramic turf standard star bo1 6g tb7 humans=ai,ai,ai,ai ai=0.86/0.79 | 18.7 | 16.5 | 0.8 / 2.6 | 0.36% | 1.14% | 3.29% | 53 | 0 | ok |
| 20 | #20 doubles standard clay standard wind star bo3 6g normal humans=bot,ai,bot,ai ai=0.72/0.82 | 16.7 | 17.8 | 0.9 / 7.2 | 0.48% | 0.73% | 2.13% | 40 | 0 | ok |
| 21 | #21 doubles standard carpet standard golden bo3 4g normal humans=bot,monkey,ai,ai ai=0.33/0.19 | 12.5 | 17.2 | 0.6 / 11.9 | 0.41% | 0.51% | 1.99% | 46 | 0 | ok |
| 22 | #22 doubles standard turf standard adv bo3 6g normal humans=bot,ai,ai,ai ai=0.40/0.48 | 15.4 | 12.5 | 0.5 / 3.1 | 0.19% | 0.24% | 1.76% | 42 | 0 | ok |
| 23 | #23 singles singles-narrow turf standard golden bo1 4g tb7 humans=ai,ai ai=0.21/0.10 | 16.7 | 11.0 | 0.8 / 5.1 | 0.32% | 0.59% | 2.87% | 62 | 0 | ok |
| 24 | #24 singles standard turf standard star bo3 4g normal humans=ai,ai ai=0.92/0.17 | 17.1 | 20.0 | 0.8 / 4.4 | 0.41% | 0.97% | 3.91% | 47 | 0 | ok |
| 25 | #25 doubles standard turf standard star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.87/0.18 | 14.9 | 9.5 | 0.8 / 3.3 | 0.18% | 0.71% | 1.55% | 37 | 0 | ok |
| 26 | #26 doubles standard clay standard star bo3 4g no-tb humans=bot,ai,ai,ai ai=0.23/0.28 | 11.7 | 11.8 | 0.6 / 4.2 | 0.18% | 0.34% | 1.42% | 42 | 0 | ok |
| 27 | #27 doubles standard turf standard wind star bo3 4g normal humans=ai,ai,ai,ai ai=0.11/0.57 | 14.8 | 7.7 | 0.6 / 3.5 | 0.15% | 0.55% | 1.88% | 46 | 0 | ok |
| 28 | #28 doubles standard turf standard adv bo3 6g stb10 humans=bot,monkey,ai,ai ai=0.48/0.37 | 4.6 | 5.5 | 0.7 / 2.2 | 0.00% | 0.05% | 0.68% | 49 | 0 | ok |
| 29 | #29 doubles panoramic carpet standard wind adv bo3 4g stb10 humans=bot,ai,ai,ai ai=0.25/0.10 | 14.9 | 11.3 | 1.0 / 5.2 | 0.19% | 0.29% | 2.44% | 47 | 0 | ok |
| 30 | #30 singles panoramic turf standard adv bo3 4g normal humans=bot,monkey ai=0.14/0.94 | 10.8 | 22.0 | 0.2 / 0.7 | 0.31% | 0.52% | 1.54% | 45 | 0 | ok |
| 31 | #31 singles singles-narrow turf standard adv bo3 6g no-tb humans=monkey,monkey ai=0.14/0.06 | 16.4 | 23.7 | 0.3 / 0.6 | 0.59% | 0.21% | 2.42% | 41 | 0 | ok |
| 32 | #32 doubles standard carpet altitude wind star bo1 6g normal humans=bot,ai,bot,ai ai=0.04/0.38 | 14.1 | 15.8 | 0.5 / 2.1 | 0.17% | 0.27% | 3.18% | 46 | 0 | ok |
| 33 | #33 doubles standard turf standard adv bo1 6g stb10 humans=bot,monkey,ai,ai ai=0.76/0.07 | 15.0 | 23.2 | 0.5 / 1.2 | 0.36% | 0.78% | 2.09% | 53 | 0 | ok |
| 34 | #34 singles panoramic hard altitude star bo3 4g no-tb humans=bot,ai ai=0.11/0.78 | 12.1 | 11.3 | 0.2 / 3.5 | 0.23% | 0.49% | 2.31% | 38 | 0 | ok |
| 35 | #35 doubles standard carpet standard adv bo3 6g no-tb humans=bot,ai,ai,ai ai=0.90/0.84 | 14.8 | 8.2 | 0.4 / 2.2 | 0.12% | 0.61% | 1.49% | 43 | 0 | ok |
| 36 | #36 doubles standard carpet altitude adv bo3 6g stb10 humans=ai,ai,ai,ai ai=0.26/0.93 | 15.4 | 8.2 | 1.3 / 4.5 | 0.17% | 0.68% | 2.30% | 37 | 0 | ok |
| 37 | #37 doubles standard turf standard wind star bo1 6g tb7 humans=ai,ai,ai,ai ai=0.39/0.53 | 14.4 | 8.7 | 1.4 / 4.2 | 0.39% | 0.71% | 1.91% | 51 | 0 | ok |
| 38 | #38 singles standard carpet standard wind star bo3 6g normal humans=ai,ai ai=0.05/0.01 | 17.5 | 10.7 | 0.7 / 3.0 | 0.25% | 0.49% | 4.17% | 39 | 0 | ok |
| 39 | #39 doubles panoramic turf standard star bo3 4g normal humans=bot,ai,ai,ai ai=0.33/0.35 | 16.7 | 12.7 | 0.3 / 2.4 | 0.19% | 0.51% | 2.46% | 38 | 0 | ok |
| 40 | #40 doubles panoramic hard standard wind star bo3 4g normal humans=ai,ai,ai,ai ai=0.96/0.91 | 18.0 | 11.2 | 1.0 / 4.0 | 0.25% | 0.91% | 3.08% | 37 | 0 | ok |
| 41 | #41 doubles panoramic hard standard wind star bo3 4g stb10 humans=bot,monkey,ai,ai ai=0.99/0.20 | 14.1 | 16.8 | 0.5 / 3.1 | 0.43% | 0.26% | 2.22% | 47 | 0 | ok |
| 42 | #42 doubles panoramic turf altitude adv bo3 6g stb10 humans=ai,ai,ai,ai ai=0.89/0.14 | 12.3 | 7.3 | 0.7 / 1.8 | 0.23% | 0.43% | 1.58% | 43 | 0 | ok |
| 43 | #43 singles singles-narrow carpet standard wind adv bo3 6g normal humans=bot,ai ai=0.03/0.19 | 13.8 | 13.7 | 0.7 / 2.7 | 0.37% | 1.11% | 2.18% | 50 | 0 | ok |
| 44 | #44 doubles standard turf standard adv bo3 4g normal humans=monkey,monkey,monkey,monkey ai=0.78/0.41 | 21.2 | 31.3 | 0.3 / 1.4 | 2.16% | 0.84% | 4.12% | 49 | 0 | pops per min 31.333 (limit 30); racket in body share 0.022 (limit 0.01) |
| 45 | #45 singles standard turf standard adv bo1 6g stb10 humans=ai,ai ai=0.05/0.11 | 16.3 | 8.3 | 0.7 / 2.3 | 0.29% | 0.44% | 4.32% | 41 | 0 | ok |
| 46 | #46 singles standard hard standard adv bo3 6g stb10 humans=ai,ai ai=0.79/0.95 | 19.9 | 15.7 | 0.8 / 2.0 | 0.25% | 1.72% | 3.81% | 51 | 0 | ok |
| 47 | #47 doubles standard turf standard wind star bo3 4g tb7 humans=bot,ai,ai,ai ai=0.62/0.80 | 15.0 | 16.7 | 1.0 / 9.8 | 0.23% | 0.70% | 1.91% | 59 | 0 | ok |
| 48 | #48 doubles standard turf standard wind adv bo3 6g stb10 humans=monkey,ai,ai,ai ai=0.58/0.26 | 7.4 | 12.5 | 0.2 / 0.6 | 0.24% | 0.16% | 1.35% | 48 | 0 | ok |
| 49 | #49 singles singles-narrow hard standard wind star bo1 4g stb10 humans=monkey,ai ai=0.65/0.06 | 13.2 | 28.0 | 0.6 / 5.9 | 0.51% | 0.62% | 2.89% | 54 | 0 | ok |
| 50 | #50 doubles standard hard standard star bo3 6g stb10 humans=ai,ai,ai,ai ai=0.69/0.76 | 13.8 | 9.8 | 0.8 / 2.2 | 0.21% | 0.56% | 2.22% | 46 | 0 | ok |
| 51 | #51 doubles standard clay standard wind star bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.69/0.25 | 9.1 | 14.7 | 0.8 / 1.7 | 0.12% | 0.09% | 0.93% | 43 | 0 | ok |
| 52 | #52 singles standard turf standard star bo3 4g no-tb humans=bot,ai ai=0.02/0.21 | 11.4 | 14.3 | 0.4 / 3.2 | 0.38% | 0.37% | 2.37% | 48 | 0 | ok |
| 53 | #53 singles panoramic turf standard wind star bo3 6g stb10 humans=ai,ai ai=0.83/0.40 | 19.0 | 16.7 | 0.9 / 2.8 | 0.28% | 1.26% | 4.79% | 53 | 0 | ok |
| 54 | #54 doubles standard turf standard golden bo3 4g no-tb humans=ai,ai,ai,ai ai=0.45/0.79 | 14.4 | 12.2 | 0.9 / 3.1 | 0.19% | 0.86% | 2.02% | 50 | 0 | ok |
| 55 | #55 doubles standard clay standard golden bo3 4g stb10 humans=monkey,ai,ai,ai ai=0.80/0.91 | 11.2 | 21.2 | 0.7 / 2.1 | 0.44% | 0.46% | 1.73% | 49 | 0 | serve hand in torso 0.006 (limit 0.005) |
| 56 | #56 singles singles-narrow turf standard wind star bo3 6g normal humans=ai,ai ai=0.53/0.73 | 19.9 | 17.0 | 1.1 / 6.7 | 0.32% | 0.58% | 3.84% | 50 | 0 | ok |
| 57 | #57 doubles panoramic turf standard star bo3 4g no-tb humans=bot,ai,ai,ai ai=0.76/0.36 | 14.0 | 8.3 | 1.2 / 6.0 | 0.11% | 0.38% | 1.77% | 48 | 0 | ok |
| 58 | #58 doubles panoramic turf standard wind adv bo3 4g no-tb humans=monkey,ai,ai,ai ai=0.37/0.71 | 8.3 | 10.3 | 0.4 / 3.1 | 0.31% | 0.15% | 1.17% | 42 | 0 | serve hand in torso 0.006 (limit 0.005) |
| 59 | #59 singles panoramic carpet standard wind star bo3 6g normal humans=monkey,ai ai=0.13/0.85 | 15.8 | 31.0 | 0.7 / 2.5 | 0.63% | 1.16% | 4.19% | 47 | 0 | pops per min 31.000 (limit 30) |

## Worst moments in the failing runs

- #6: pop pop RightLeg (forehand-drop) p2 t=1.6 44.6°, pop pop LeftLeg (backhand-slice) p1 t=29.5 39.3°, pop pop RightForeArm (forehand-drop) p2 t=1.3 30.8°, turn turn RightHand p2 t=59.4 51.6°, turn turn RightHand p2 t=27.2 49.5°, clip legs thighL/thighR p0 t=29.2 14.9 cm, clip legs thighL/thighR p0 t=29.2 14.8 cm, clip legs thighL/thighR p1 t=62.0 14.7 cm, contact slice at 0.40 m p0 t=60.9 34.6 cm, contact drop at 0.99 m p3 t=61.7 4.9 cm
- #11: pop pop RightForeArm (backhand-lob) p1 t=87.0 23.1°, pop pop RightForeArm (backhand) p1 t=35.0 21.1°, pop pop LeftLeg (ready) p1 t=81.5 20.3°, turn turn RightHand p1 t=43.5 46.1°, clip legs thighL/thighR p0 t=65.1 14.5 cm, clip legs thighL/thighR p0 t=65.2 14.5 cm, clip legs thighL/thighR p0 t=71.9 14.3 cm, contact serve at 0.78 m p0 t=18.9 0.8 cm, contact serve at 0.79 m p1 t=71.4 0.8 cm
- #13: pop pop LeftForeArm (forehand-lob-left) p0 t=28.9 30.7°, pop pop LeftForeArm (forehand-left) p0 t=74.9 30.4°, pop pop RightArm (forehand-lob-left) p0 t=29.4 27.7°, clip legs thighL/thighR p0 t=37.6 13.6 cm, clip legs thighL/thighR p0 t=86.7 13.5 cm, clip legs thighL/thighR p0 t=86.7 13.5 cm, contact serve at 0.54 m p1 t=13.5 1.1 cm, contact serve at 0.88 m p1 t=1.1 0.7 cm
- #44: pop pop RightLeg (backhand-slice) p1 t=82.7 28.3°, pop pop RightForeArm (backhand) p1 t=86.6 25.3°, pop pop RightLeg (backhand) p0 t=50.1 24.7°, turn turn RightHand p3 t=2.9 48.8°, turn turn RightHand p3 t=57.7 45.4°, clip legs thighL/thighR p0 t=60.4 14.9 cm, clip legs thighL/thighR p0 t=60.4 14.9 cm, clip legs thighL/thighR p0 t=60.4 14.8 cm, contact serve at 0.40 m p0 t=86.2 2.3 cm, contact serve at 0.56 m p1 t=62.4 1.4 cm
- #55: pop pop RightForeArm (forehand-drop) p0 t=53.5 30.8°, pop pop RightForeArm (backhand-lob) p0 t=51.2 30.7°, pop pop RightLeg (ready) p0 t=64.9 28.7°, turn turn RightHand p0 t=57.2 48.5°, clip legs thighL/thighR p0 t=77.1 13.5 cm, clip legs thighL/thighR p0 t=77.1 13.4 cm, clip legs shinL/thighR p0 t=79.5 13.1 cm, contact topspin at 0.45 m p0 t=86.3 3.3 cm, contact slice at 0.27 m p2 t=17.8 2.5 cm
- #58: pop pop RightForeArm (backhand) p0 t=60.7 23.9°, pop pop RightForeArm (backhand-lob) p0 t=45.4 23.7°, pop pop RightLeg (serve) p0 t=27.9 23.1°, clip legs thighL/thighR p0 t=75.0 14.5 cm, clip legs thighL/thighR p0 t=45.0 14.1 cm, clip legs thighL/thighR p0 t=45.0 13.8 cm, contact volley at 0.31 m p0 t=82.8 6.4 cm, contact slice at 0.46 m p2 t=68.3 3.3 cm
- #59: pop pop RightForeArm (backhand-slice) p1 t=14.3 30.8°, pop pop RightArm (backhand-slice) p1 t=14.3 28.5°, pop pop RightArm (backhand) p0 t=12.3 23.8°, turn turn RightHand p0 t=43.3 46.6°, turn turn RightHand p0 t=70.7 46.5°, clip legs thighL/thighR p0 t=33.5 14.5 cm, clip legs thighL/thighR p1 t=64.3 14.5 cm, clip legs thighL/thighR p1 t=64.3 14.2 cm, contact slice at 0.55 m p0 t=79.2 88.3 cm, contact slice at 0.85 m p0 t=12.4 10.6 cm
