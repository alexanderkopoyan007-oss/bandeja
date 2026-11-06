import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_BANDEJA, SHOT_SERVE, SHOT_SMASH, SHOT_VIBORA } from '../../src/sim/contact/shots.ts';
import { mannequinWithPeople } from './people.ts';

// Into a ground stroke the body falls no faster than gravity lets it: feet on the floor can't pull it down (review round 33, #8: the
// hips fell at 1.8-2.0 g at the median, over 1 g in nine strokes in ten). The hip joints, as the reviewer measured them.
describe('the hips into a ground stroke', () => {
  const p = mannequinWithPeople().people[0]!;
  const ys: number[][] = [[], [], [], []], air: boolean[][] = [[], [], [], []], hits: Array<{ i: number; k: number }> = [];
  const w = new THREE.Vector3();
  let seq = 0;
  runAnimQa(p, { seed: 5, seconds: 300, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      // (the hip joints' mean, as the reviewer's drop13)
      const a = raw as unknown as { legL: THREE.Bone[]; legR: THREE.Bone[]; jumpT0: number };
      a.legL[0]!.updateWorldMatrix(true, false);
      a.legR[0]!.updateWorldMatrix(true, false);
      ys[i]!.push((a.legL[0]!.getWorldPosition(w).y + a.legR[0]!.getWorldPosition(w).y) / 2);
      air[i]!.push(a.jumpT0 >= 0);
    });
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind === E_HIT && e.a !== SHOT_SERVE && e.a !== SHOT_SMASH && e.a !== SHOT_BANDEJA && e.a !== SHOT_VIBORA) hits.push({ i: e.player, k: ys[0]!.length - 1 });
    }
  } });

  it('falls at under 1 g into most strokes', () => {
    // As the reviewer's drop13: smoothed over 7 frames, the peak down acceleration from the highest point to the lowest, 0.6 s before the ball to 0.1 s after.
    const peaks: number[] = [];
    for (const h of hits) {
      const y = ys[h.i]!;
      if (h.k < 90 || h.k + 30 > y.length || air[h.i]!.slice(h.k - 78, h.k + 18).some(Boolean)) continue;
      const S: number[] = [];
      for (let k = -78; k <= 18; k++) { let s = 0; for (let j = -3; j <= 3; j++) s += y[h.k + k + j]!; S.push(s / 7); }
      let lo = 1e9, il = 0, hi = -1e9, ih = 0;
      for (let i = 24; i < S.length; i++) if (S[i]! < lo) { lo = S[i]!; il = i; }
      for (let i = 0; i < il; i++) if (S[i]! > hi) { hi = S[i]!; ih = i; }
      if (hi - lo < 0.05) continue;
      let pa = 0;
      for (let i = Math.max(ih, 6); i <= il && i < S.length - 6; i++) pa = Math.max(pa, (2 * S[i]! - S[i - 6]! - S[i + 6]!) / (0.05 * 0.05));
      peaks.push(pa / 9.81);
    }
    peaks.sort((a, b) => a - b);
    const over = peaks.filter((g) => g > 1).length / peaks.length;
    console.log(`hipFall: ${peaks.length} falls, p50 ${peaks[Math.floor(peaks.length * 0.5)]!.toFixed(2)} p90 ${peaks[Math.floor(peaks.length * 0.9)]!.toFixed(2)} g, over 1 g ${(100 * over).toFixed(0)}%`);
    // (before Avatar.governFall, on f238cee: p50 2.04, p90 3.14 g; after, 0.90 and 1.39, 27% over 1 g. What is still over 1 g is mostly a run stopping for the ball:
    // a braking foot put out in front that the hips must come down to reach, review round 26's #9; then the share comes down)
    expect(peaks.length).toBeGreaterThan(50);
    expect(peaks[Math.floor(peaks.length * 0.5)]!).toBeLessThan(0.95);
    expect(peaks[Math.floor(peaks.length * 0.9)]!).toBeLessThan(1.5);
    expect(over).toBeLessThan(0.3);
  });
});
