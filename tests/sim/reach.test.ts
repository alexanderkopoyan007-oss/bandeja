// How far out a high ball can be reached (REVIEW.md round 2 #7; data/tuning.json //reachHigh). The reach had been
// 1.35 m across the floor at any height, so the AI smashed balls 1.0-1.2 m in front of it at 2.5-2.7 m and the
// avatar's racket missed them by up to a metre.
import { describe, expect, it } from 'vitest';
import { reachAt } from '../../src/sim/contact/windows.ts';
import { DEFAULT_TUNING as T } from '../../src/sim/player/player.ts';

describe('reach by height', () => {
  it('is the full reach to head height, then shrinks to a sphere about the shoulder', () => {
    expect(reachAt(0.5, T)).toBe(T.reachMax);
    expect(reachAt(1.6, T)).toBe(T.reachMax);
    expect(reachAt(2.35, T)).toBeCloseTo(1.10, 2);
    expect(reachAt(2.55, T)).toBeCloseTo(0.87, 2);
    expect(reachAt(T.contactMaxHeight, T)).toBeCloseTo(T.reachLean, 2);
    let last = Infinity;
    for (let y = 0.1; y <= T.contactMaxHeight + 0.2; y += 0.01) {
      const r = reachAt(y, T);
      expect(r).toBeLessThanOrEqual(last + 1e-12);
      expect(r).toBeGreaterThanOrEqual(T.reachLean - 1e-12);
      last = r;
    }
  });
  it('still reaches every overhead at its planned spot (overheadReach out, at each kind\'s height)', () => {
    for (const y of [T.overheadIdealBandeja, T.overheadIdealVibora, T.overheadIdealSmash, T.overheadIdealHeight]) {
      expect(reachAt(y, T)).toBeGreaterThan(T.overheadReach + 0.3);
    }
  });
});
