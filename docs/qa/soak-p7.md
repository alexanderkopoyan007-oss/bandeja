# Browser soak, Phase 7

`bash tools/one-chrome.sh node tools/soak.mjs 20` on the Phase 7 build: AI doubles, 1080p, vsync, sampled every 30 s.

```
  0.5 min  heap 14.7 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 3617
  1.0 min  heap 15.0 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 7225
  1.5 min  heap 15.0 MB  nodes 151  listeners 13  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 10829
  2.0 min  heap 15.1 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 16.8 max 17 ms  >20 0 >50 0  tick 14433
  2.5 min  heap 15.3 MB  nodes 150  listeners 13  geo 38 tex 28  frames 1799  p50 16.7 p99 17.5 max 18 ms  >20 0 >50 0  tick 18034
  3.0 min  heap 15.3 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 21640
  3.5 min  heap 15.5 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 25244
  4.0 min  heap 15.4 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.5 max 18 ms  >20 0 >50 0  tick 28850
  4.5 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.3 max 18 ms  >20 0 >50 0  tick 32454
  5.0 min  heap 15.4 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 36056
  5.5 min  heap 15.2 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 39658
  6.0 min  heap 15.2 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 43261
  6.5 min  heap 15.3 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.4 max 18 ms  >20 0 >50 0  tick 46863
  7.0 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.7 max 18 ms  >20 0 >50 0  tick 50465
  7.5 min  heap 15.2 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 54071
  8.0 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 57675
  8.5 min  heap 15.3 MB  nodes 151  listeners 14  geo 38 tex 28  frames 1799  p50 16.7 p99 17.2 max 17 ms  >20 0 >50 0  tick 61279
  9.0 min  heap 15.4 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 64883
  9.5 min  heap 15.4 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 68486
 10.0 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 19 ms  >20 0 >50 0  tick 72088
 10.5 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 75692
 11.0 min  heap 15.4 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 79294
 11.5 min  heap 15.4 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.7 max 18 ms  >20 0 >50 0  tick 82898
 12.0 min  heap 15.4 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 86500
 12.5 min  heap 15.4 MB  nodes 150  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 19 ms  >20 0 >50 0  tick 90102
 13.0 min  heap 15.3 MB  nodes 151  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.4 max 19 ms  >20 0 >50 0  tick 93707
 13.5 min  heap 15.5 MB  nodes 151  listeners 13  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 19 ms  >20 0 >50 0  tick 97309
 14.0 min  heap 15.6 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.7 max 20 ms  >20 0 >50 0  tick 100915
 14.5 min  heap 15.4 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 104523
 15.0 min  heap 15.5 MB  nodes 152  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.5 max 18 ms  >20 0 >50 0  tick 108127
 15.5 min  heap 15.3 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 111731
 16.0 min  heap 15.5 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.7 max 19 ms  >20 0 >50 0  tick 115335
 16.5 min  heap 15.5 MB  nodes 152  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 118938
 17.0 min  heap 15.5 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1801  p50 16.7 p99 17.6 max 28 ms  >20 1 >50 0  tick 122546
 17.5 min  heap 15.7 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.3 max 18 ms  >20 0 >50 0  tick 126156
 18.0 min  heap 15.4 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1801  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 129768
 18.5 min  heap 15.6 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.7 max 18 ms  >20 0 >50 0  tick 133370
 19.0 min  heap 15.5 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1800  p50 16.7 p99 17.6 max 19 ms  >20 0 >50 0  tick 136980
 19.5 min  heap 15.6 MB  nodes 152  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.1 max 19 ms  >20 0 >50 0  tick 140582
 20.0 min  heap 15.5 MB  nodes 153  listeners 12  geo 38 tex 28  frames 1799  p50 16.7 p99 17.6 max 18 ms  >20 0 >50 0  tick 144185

load to running 1.4 s; 71975 frames, over 20 ms 1 (0.00%), over 50 ms 0
heap 14.7 -> 15.5 MB, slope 0.019 MB/min after warm-up; nodes 0.15/min; geometries +0, textures +0
errors 0
VERDICT: no growth
```
