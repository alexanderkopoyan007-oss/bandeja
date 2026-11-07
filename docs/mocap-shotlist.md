# Capture shot list, from the sim

*Made by `node tools/shot-list.ts 32 600 250`: 32 AI doubles matches of 10 min (AI levels 0.35-1, styles and left-handers mixed, a third women's), 926 points, 7619 contacts. The sim is a stand-in for real play: a person at the controls hits from the same windows, but their mix will differ a little.*

**121 cells hold 95.0% of all contacts; 244 takes** (in proportion to each cell's share of 250, at least one and at most 10 per cell). The rest (139 cells, 5.0%) use the nearest captured take, or the procedural keys until one exists. 1.7% of contacts were dives or jumps; those stay procedural (no dives on court).

A drive cell lists its swings (flat, topspin, slice: the same feed, the player varies the swing). In each cell: "met" is where the ball was against the hips (in front, beside, behind), "came in" how the player arrived over the last half second (still under 0.8 m/s; else moving forward, back, across to the ball, away from it), as shares of the cell (%). Film the takes in that mix.

| Family | Hand | Ball height | Out to the side | Share | Running total | Takes | Met | Came in |
|---|---|---|---|---|---|---|---|---|
| serve | forehand | - | - | 13.6% | 13.6% | 10 | in front 100 | still 100 |
| bandeja | forehand | high | close | 4.3% | 17.8% | 10 | beside 91 | still 65, back 32 |
| drive (slice 52, flat 40) | forehand | mid | arm out | 4.2% | 22.0% | 10 | in front 90, beside 10 | still 72 |
| volley | forehand | mid | arm out | 3.9% | 25.9% | 10 | beside 60, in front 39 | still 65, forward 18, across to it 15 |
| volley | backhand | mid | arm out | 3.3% | 29.1% | 8 | beside 63, in front 36 | still 66, forward 19, across to it 13 |
| drive (slice 54, flat 40) | backhand | mid | arm out | 3.2% | 32.4% | 8 | in front 83, beside 15 | still 72, across to it 11 |
| vibora | forehand | high | close | 3.0% | 35.3% | 7 | beside 85, in front 14 | still 63, back 35 |
| volley | forehand | mid | close | 2.4% | 37.7% | 6 | in front 91 | still 80, forward 17 |
| volley | backhand | mid | close | 2.4% | 40.1% | 6 | in front 90 | still 83, forward 13 |
| volley | forehand | low | arm out | 2.3% | 42.4% | 6 | beside 55, in front 45 | still 58, across to it 21, forward 19 |
| volley | forehand | mid | reaching | 2.2% | 44.6% | 6 | beside 70, in front 29 | still 67, forward 18, across to it 15 |
| smash | forehand | overhead | close | 2.2% | 46.9% | 6 | in front 80, beside 20 | still 86, back 11 |
| lob | forehand | mid | arm out | 2.0% | 48.9% | 5 | in front 84, beside 13 | still 72, back 13 |
| volley | backhand | mid | reaching | 1.9% | 50.7% | 5 | beside 66, in front 34 | still 68, forward 17, across to it 13 |
| drive (slice 56, flat 41) | forehand | low | arm out | 1.8% | 52.5% | 4 | in front 82, beside 14 | still 39, forward 26, across to it 19, back 12 |
| volley | backhand | low | close | 1.8% | 54.3% | 4 | in front 95 | still 72, forward 14 |
| volley | forehand | low | close | 1.8% | 56.1% | 4 | in front 86, beside 14 | still 75, forward 11 |
| volley | backhand | low | arm out | 1.7% | 57.8% | 4 | in front 56, beside 42 | still 59, forward 20, across to it 19 |
| lob | backhand | mid | arm out | 1.7% | 59.5% | 4 | in front 86, beside 12 | still 71, across to it 12, forward 11 |
| drive (slice 51, flat 48) | backhand | low | arm out | 1.6% | 61.2% | 4 | in front 74, beside 21 | still 33, forward 28, across to it 25, back 13 |
| lob | backhand | low | arm out | 1.3% | 62.5% | 3 | in front 65, beside 23, behind 12 | still 48, across to it 26, forward 17 |
| drive off the back glass (flat 43, slice 40, topspin 17) | forehand | mid | arm out | 1.3% | 63.7% | 3 | in front 93 | back 45, still 30, across to it 12, forward 10 |
| lob | forehand | low | arm out | 1.1% | 64.9% | 3 | in front 71, beside 15, behind 14 | still 44, across to it 21, forward 15, back 14 |
| chiquita | forehand | mid | arm out | 1.0% | 65.9% | 2 | in front 84, beside 16 | still 73, back 12, across to it 11 |
| lob off the back glass | forehand | mid | arm out | 0.9% | 66.8% | 2 | in front 86, beside 14 | back 37, still 30, forward 20, across to it 11 |
| drive off the back glass (flat 41, slice 41, topspin 17) | backhand | mid | arm out | 0.9% | 67.7% | 2 | in front 86, beside 13 | back 43, still 36 |
| volley | forehand | low | reaching | 0.9% | 68.6% | 2 | in front 63, beside 36 | still 49, across to it 29, forward 17 |
| drive off the side glass (slice 52, flat 45) | forehand | mid | arm out | 0.8% | 69.4% | 2 | in front 94 | across to it 58, still 32 |
| volley | backhand | low | reaching | 0.8% | 70.2% | 2 | in front 73, beside 25 | still 65, forward 18, across to it 13 |
| chiquita | backhand | mid | arm out | 0.7% | 70.9% | 2 | in front 88, beside 12 | still 71, forward 16 |
| volley | forehand | high | close | 0.7% | 71.6% | 2 | in front 64, beside 20, behind 16 | still 88 |
| drive off the side glass (flat 57, slice 41) | backhand | mid | arm out | 0.6% | 72.2% | 2 | in front 94 | across to it 67, still 27 |
| drive off the side glass (flat 51, slice 49) | forehand | low | arm out | 0.6% | 72.8% | 2 | in front 85, beside 15 | across to it 57, still 32 |
| volley | forehand | high | arm out | 0.6% | 73.4% | 1 | beside 64, in front 33 | still 71, forward 21 |
| drive off the side glass (flat 57, slice 43) | backhand | low | arm out | 0.6% | 73.9% | 1 | in front 67, beside 24 | across to it 74, still 19 |
| lob off the back glass | backhand | mid | arm out | 0.5% | 74.5% | 1 | in front 85, beside 15 | still 41, back 24, forward 22, across to it 12 |
| drive off the back glass (slice 46, flat 38, topspin 15) | forehand | high | arm out | 0.5% | 75.0% | 1 | in front 95 | still 62, forward 18, back 10 |
| drive off the back glass (slice 58, flat 37) | forehand | low | arm out | 0.5% | 75.5% | 1 | in front 71, beside 26 | still 42, back 34, across to it 21 |
| lob off the side glass | backhand | mid | arm out | 0.5% | 76.0% | 1 | in front 87, beside 13 | across to it 61, still 21, back 13 |
| drive (slice 50, flat 33, topspin 17) | forehand | low | close | 0.5% | 76.4% | 1 | in front 75, beside 17 | across to it 56, still 14, back 14, away 11 |
| volley | backhand | high | close | 0.5% | 76.9% | 1 | in front 94 | still 81, forward 11 |
| chiquita | forehand | low | arm out | 0.5% | 77.4% | 1 | in front 81, beside 17 | still 47, forward 25, across to it 14, back 11 |
| volley | backhand | high | arm out | 0.5% | 77.8% | 1 | beside 77, in front 17 | still 83 |
| lob off the back glass | forehand | low | arm out | 0.5% | 78.3% | 1 | in front 66, beside 34 | still 57, back 26, across to it 11 |
| drive off back and side glass (flat 47, slice 44) | backhand | mid | arm out | 0.4% | 78.8% | 1 | in front 88 | across to it 35, back 32, still 29 |
| chiquita | backhand | low | arm out | 0.4% | 79.2% | 1 | in front 79, beside 21 | still 41, forward 29, across to it 21 |
| drive (slice 56, flat 38) | forehand | low | reaching | 0.4% | 79.6% | 1 | beside 68, in front 24 | still 62, across to it 21 |
| lob off the side glass | forehand | mid | arm out | 0.4% | 80.1% | 1 | in front 97 | across to it 70, still 21 |
| lob | forehand | low | close | 0.4% | 80.5% | 1 | in front 91 | across to it 63, back 16, still 16 |
| lob off the side glass | backhand | low | arm out | 0.4% | 80.9% | 1 | in front 84, beside 13 | across to it 59, still 34 |
| lob off the back glass | backhand | low | arm out | 0.4% | 81.3% | 1 | in front 55, beside 32, behind 13 | still 45, back 26, across to it 23 |
| drive (flat 57, slice 37) | backhand | low | reaching | 0.4% | 81.7% | 1 | beside 53, in front 27, behind 20 | still 37, across to it 33, back 20, forward 10 |
| drive off the back glass (flat 54, slice 39) | forehand | mid | close | 0.4% | 82.1% | 1 | in front 93 | back 39, still 29, across to it 29 |
| drive off the back glass (slice 43, flat 43, topspin 14) | backhand | mid | reaching | 0.4% | 82.5% | 1 | beside 46, behind 32, in front 21 | across to it 36, still 36, back 18, away 11 |
| drive off back and side glass (slice 44, flat 37, topspin 19) | forehand | mid | arm out | 0.4% | 82.8% | 1 | in front 85, beside 15 | across to it 48, back 33, still 11 |
| lob off the back glass | forehand | high | arm out | 0.4% | 83.2% | 1 | in front 100 | still 74, forward 19 |
| drive off the back glass (slice 44, flat 37, topspin 19) | backhand | low | arm out | 0.4% | 83.5% | 1 | in front 70, beside 22 | still 44, back 37, across to it 15 |
| volley | forehand | high | reaching | 0.3% | 83.9% | 1 | beside 92 | still 73, forward 15 |
| lob | forehand | low | reaching | 0.3% | 84.2% | 1 | beside 58, in front 35 | across to it 35, still 27, away 15, forward 15 |
| drive (flat 60, slice 32) | backhand | mid | reaching | 0.3% | 84.5% | 1 | beside 68, in front 20, behind 12 | still 40, across to it 36, back 20 |
| drive (slice 52, flat 40) | backhand | low | close | 0.3% | 84.9% | 1 | in front 84, beside 12 | across to it 64, still 16, back 12 |
| lob off the side glass | forehand | low | arm out | 0.3% | 85.2% | 1 | in front 63, beside 21, behind 17 | across to it 63, still 25 |
| drive off the back glass (slice 48, flat 30, topspin 22) | backhand | high | arm out | 0.3% | 85.5% | 1 | in front 91 | still 57, across to it 22, forward 17 |
| drive (flat 48, slice 48) | forehand | mid | close | 0.3% | 85.8% | 1 | in front 91 | across to it 43, still 26, back 17 |
| lob | backhand | low | close | 0.3% | 86.1% | 1 | in front 86, behind 14 | still 45, across to it 32 |
| bandeja off the back glass | forehand | high | close | 0.3% | 86.3% | 1 | beside 100 | still 90 |
| drive off the side glass (slice 52, flat 48) | forehand | mid | reaching | 0.3% | 86.6% | 1 | beside 86, behind 14 | still 38, across to it 38, back 24 |
| lob off the back glass | backhand | high | arm out | 0.3% | 86.9% | 1 | in front 100 | still 67, forward 24 |
| drive (slice 74, flat 26) | forehand | mid | reaching | 0.2% | 87.1% | 1 | beside 74, in front 26 | still 74, away 16 |
| drive off the back glass (slice 47, flat 32, topspin 21) | forehand | mid | reaching | 0.2% | 87.4% | 1 | in front 53, beside 26, behind 21 | back 53, across to it 21, away 16, still 11 |
| chiquita off the back glass | backhand | mid | arm out | 0.2% | 87.6% | 1 | in front 100 | still 61, back 22, forward 11 |
| volley | backhand | high | reaching | 0.2% | 87.9% | 1 | beside 89, in front 11 | still 61, forward 17, across to it 17 |
| chiquita off the back glass | forehand | mid | arm out | 0.2% | 88.1% | 1 | in front 89, beside 11 | still 39, back 33, away 11, across to it 11 |
| drive (flat 56, slice 38) | backhand | mid | close | 0.2% | 88.3% | 1 | in front 100 | across to it 69, still 31 |
| drive off back and side glass (flat 75, slice 19) | forehand | mid | close | 0.2% | 88.5% | 1 | in front 100 | still 69, across to it 19 |
| drive off back and side glass (slice 50, flat 31, topspin 19) | backhand | mid | close | 0.2% | 88.7% | 1 | in front 88, behind 13 | still 38, across to it 31, away 19, back 13 |
| chiquita off the side glass | backhand | low | arm out | 0.2% | 88.9% | 1 | in front 80, beside 20 | across to it 67, still 20 |
| bandeja | forehand | high | arm out | 0.2% | 89.1% | 1 | beside 93 | back 60, away 20, still 20 |
| drive off back and side glass (flat 79, slice 21) | backhand | low | arm out | 0.2% | 89.3% | 1 | beside 50, in front 43 | still 50, across to it 36, back 14 |
| lob off the side glass | backhand | mid | reaching | 0.2% | 89.5% | 1 | beside 71, behind 29 | back 50, across to it 29, still 21 |
| drive off the side glass (slice 71, flat 29) | backhand | mid | reaching | 0.2% | 89.7% | 1 | beside 79, behind 14 | across to it 43, back 29, still 29 |
| lob off back and side glass | forehand | mid | arm out | 0.2% | 89.9% | 1 | in front 86, beside 14 | back 43, across to it 36, still 14 |
| lob | forehand | mid | reaching | 0.2% | 90.0% | 1 | beside 54, behind 23, in front 23 | still 62, back 23 |
| lob | backhand | low | reaching | 0.2% | 90.2% | 1 | in front 77, beside 23 | across to it 46, forward 31, still 23 |
| lob | backhand | mid | reaching | 0.2% | 90.4% | 1 | beside 46, behind 38, in front 15 | still 77, across to it 23 |
| drive off back and side glass (slice 62, flat 38) | backhand | high | arm out | 0.2% | 90.5% | 1 | in front 85, beside 15 | across to it 31, still 31, back 23, forward 15 |
| drop | backhand | mid | arm out | 0.2% | 90.7% | 1 | beside 83 | still 75, forward 17 |
| vibora | forehand | high | arm out | 0.2% | 90.9% | 1 | in front 58, beside 42 | away 42, back 42, still 17 |
| chiquita off the side glass | forehand | mid | arm out | 0.2% | 91.0% | 1 | in front 92 | across to it 67, still 33 |
| drive off the back glass (flat 33, slice 33, topspin 33) | backhand | mid | close | 0.2% | 91.2% | 1 | in front 92 | across to it 67, back 25 |
| chiquita off the side glass | forehand | low | arm out | 0.2% | 91.3% | 1 | in front 83 | across to it 58, still 25 |
| lob off the side glass | forehand | mid | reaching | 0.2% | 91.5% | 1 | beside 83, behind 17 | across to it 67, back 17, still 17 |
| lob off back and side glass | backhand | mid | arm out | 0.2% | 91.6% | 1 | in front 67, beside 33 | back 42, across to it 33, still 17 |
| drive off the side glass (flat 67, slice 33) | forehand | low | reaching | 0.2% | 91.8% | 1 | beside 67, behind 17, in front 17 | across to it 58, still 33 |
| drive off the side glass (flat 73, slice 27) | backhand | low | reaching | 0.1% | 91.9% | 1 | beside 91 | across to it 64, still 27 |
| smash off the back glass | forehand | high | close | 0.1% | 92.1% | 1 | beside 100 | still 100 |
| drive off back and side glass (flat 55, slice 36) | forehand | low | arm out | 0.1% | 92.2% | 1 | in front 55, beside 45 | still 55, across to it 27, back 18 |
| drive off back and side glass (flat 45, slice 36, topspin 18) | backhand | mid | reaching | 0.1% | 92.4% | 1 | in front 64, beside 27 | across to it 55, back 45 |
| chiquita off back and side glass | backhand | mid | arm out | 0.1% | 92.5% | 1 | beside 55, in front 45 | still 45, across to it 27, back 27 |
| lob off the back glass | forehand | mid | reaching | 0.1% | 92.7% | 1 | beside 73, in front 27 | across to it 27, back 27, away 27, still 18 |
| lob off the side glass | forehand | low | reaching | 0.1% | 92.8% | 1 | beside 70, behind 20, in front 10 | across to it 70, still 30 |
| lob off back and side glass | forehand | low | arm out | 0.1% | 92.9% | 1 | in front 60, beside 30, behind 10 | across to it 50, back 30, still 20 |
| lob | backhand | mid | close | 0.1% | 93.1% | 1 | in front 100 | across to it 70, still 30 |
| lob off back and side glass | backhand | mid | close | 0.1% | 93.2% | 1 | in front 100 | still 50, across to it 30, forward 10, away 10 |
| drop | forehand | mid | arm out | 0.1% | 93.3% | 1 | beside 90, behind 10 | still 80, forward 20 |
| drive off the side glass (slice 80, flat 20) | backhand | low | close | 0.1% | 93.5% | 1 | beside 70, behind 20, in front 10 | still 90, across to it 10 |
| lob off the side glass | backhand | low | reaching | 0.1% | 93.6% | 1 | beside 70, behind 20, in front 10 | across to it 80, still 10, back 10 |
| chiquita off the back glass | backhand | low | arm out | 0.1% | 93.7% | 1 | in front 78, beside 22 | still 78, forward 11, across to it 11 |
| chiquita off the back glass | forehand | low | arm out | 0.1% | 93.8% | 1 | in front 67, beside 33 | still 56, back 33, across to it 11 |
| drive off the back glass (slice 44, flat 44, topspin 11) | backhand | low | reaching | 0.1% | 93.9% | 1 | beside 67, in front 22, behind 11 | across to it 44, still 22, back 22, away 11 |
| lob off back and side glass | backhand | mid | reaching | 0.1% | 94.0% | 1 | in front 75, beside 25 | back 50, across to it 38, forward 13 |
| drive off the side glass (slice 63, flat 38) | forehand | low | close | 0.1% | 94.1% | 1 | in front 63, beside 25, behind 13 | still 50, across to it 38, forward 13 |
| lob off back and side glass | backhand | low | arm out | 0.1% | 94.3% | 1 | in front 50, beside 38, behind 13 | still 63, forward 25, across to it 13 |
| drive off back and side glass (slice 50, flat 38, topspin 13) | backhand | low | reaching | 0.1% | 94.4% | 1 | in front 38, beside 38, behind 25 | across to it 63, still 25, back 13 |
| smash | forehand | overhead | arm out | 0.1% | 94.5% | 1 | in front 88, behind 13 | away 50, across to it 25, still 13, back 13 |
| drive off the side glass (flat 63, slice 38) | backhand | mid | close | 0.1% | 94.6% | 1 | in front 63, beside 38 | across to it 63, still 38 |
| contrapared off the back glass | forehand | low | arm out | 0.1% | 94.7% | 1 | behind 100 | back 50, still 50 |
| drive off back and side glass (flat 86, slice 14) | backhand | low | close | 0.1% | 94.8% | 1 | in front 57, behind 29, beside 14 | still 57, across to it 29, away 14 |
| chiquita | backhand | low | close | 0.1% | 94.9% | 1 | in front 86, beside 14 | across to it 71, forward 14, still 14 |
| lob off the back glass | forehand | low | reaching | 0.1% | 94.9% | 1 | beside 43, behind 43, in front 14 | across to it 43, still 29, back 29 |
| lob off the side glass | forehand | low | close | 0.1% | 95.0% | 1 | in front 71, behind 14, beside 14 | across to it 71, still 14, forward 14 |

## By family (all contacts)

| Family | Forehand | Backhand |
|---|---|---|
| volley | 15.0% | 13.0% |
| drive | 7.6% | 6.2% |
| serve | 13.6% | 0.0% |
| lob | 4.1% | 3.8% |
| drive off the back glass | 3.1% | 2.4% |
| bandeja | 4.5% | 0.1% |
| drive off the side glass | 2.1% | 1.8% |
| lob off the back glass | 2.1% | 1.4% |
| vibora | 3.2% | 0.0% |
| chiquita | 1.7% | 1.4% |
| lob off the side glass | 1.2% | 1.4% |
| drive off back and side glass | 1.0% | 1.4% |
| smash | 2.4% | 0.0% |
| lob off back and side glass | 0.6% | 0.7% |
| chiquita off the back glass | 0.5% | 0.5% |
| chiquita off the side glass | 0.4% | 0.5% |
| drop | 0.4% | 0.3% |
| bandeja off the back glass | 0.3% | 0.1% |
| chiquita off back and side glass | 0.2% | 0.2% |
| contrapared off the back glass | 0.1% | 0.2% |
| bandeja off back and side glass | 0.2% | 0.0% |
| contrapared | 0.1% | 0.1% |
| smash off the back glass | 0.1% | 0.0% |
| contrapared off back and side glass | 0.0% | 0.1% |
| contrapared off the side glass | 0.0% | 0.0% |
| smash off back and side glass | 0.0% | 0.0% |
| vibora off the back glass | 0.0% | 0.0% |
| vibora off back and side glass | 0.0% | 0.0% |
| drop off the back glass | 0.0% | 0.0% |

Ball height: low under 0.6 m; mid 0.6-1.2 m; high 1.2-2 m; overhead 2 m and up. Out to the side, from the hips: close under 0.5 m; arm out 0.5-0.9 m; reaching 0.9 m and up.
