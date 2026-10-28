// The split-step and getting going (Phase 2, FEEL.md). From a standstill force builds up over startRamp; a
// split-step hop as the opponent strikes lands the player loaded, so the first step needs no build-up. Measured:
// the split-step reaches a target about 104 ms (12-13%) sooner (Uzu et al. 2009; Nieminen et al. 2014).
import { describe, expect, it } from 'vitest';
import { Player } from '../../src/sim/player/player.ts';
import { DT } from '../../src/sim/core/constants.ts';

/** Seconds from `go` until the player has covered `d` metres along +x (driving full that way from `go`). */
function arrive(d: number, split: boolean, go = 0.17): number {
  const p = new Player(0);
  p.setHalf(1, 5, 10);
  p.pos.set(-2, 0, 5);
  p.facing = 0;
  if (split) p.trySplitStep(0);
  for (let i = 0; i < 600; i++) {
    const now = i * DT;
    p.clock = now;
    p.driveX = now >= go ? 1 : 0;
    p.driveZ = 0;
    p.move();
    if (p.pos.x + 2 >= d) return now + DT - go;
  }
  return 99;
}

/** The planner's estimate of the same run, asked at `go`. */
function planned(d: number, split: boolean, go = 0.17): number {
  const p = new Player(0);
  p.setHalf(1, 5, 10);
  p.pos.set(-2, 0, 5);
  if (split) p.trySplitStep(0);
  for (let i = 0; i * DT < go - 1e-9; i++) { p.clock = i * DT; p.driveX = 0; p.move(); }
  p.clock = go;
  p.runD = d;
  p.runX = 1;
  p.runZ = 0;
  p.runTime();
  return p.runT;
}

describe('split-step', () => {
  it('reaches a target 1-2.5 m away about 100 ms sooner, 9-14% of the run, as measured', () => {
    for (const d of [1, 1.5, 2.5]) {
      const without = arrive(d, false);
      const withSplit = arrive(d, true);
      const gain = without - withSplit;
      expect(gain).toBeGreaterThan(0.085);
      expect(gain).toBeLessThan(0.13);
      expect(gain / without).toBeGreaterThan(0.08);
      expect(gain / without).toBeLessThan(0.2);
    }
  });

  it('in the air there is no grip: the drive does nothing until the feet land', () => {
    const p = new Player(0);
    p.setHalf(1, 5, 10);
    p.pos.set(0, 0, 5);
    p.trySplitStep(0);
    for (let i = 0; i * DT < p.tune.splitStepAir - DT; i++) {
      p.clock = i * DT;
      p.driveX = 1;
      p.move();
    }
    expect(p.vel.x).toBe(0);
    expect(p.pos.x).toBe(0);
    p.clock += DT * 2;
    p.move();
    expect(p.vel.x).toBeGreaterThan(0);
  });

  it('a player already on the move has no build-up to pay', () => {
    const p = new Player(0);
    p.setHalf(1, 5, 10);
    p.pos.set(-2, 0, 5);
    p.vel.set(2, 0, 0);
    p.clock = 1;
    p.driveX = 1;
    p.move();
    expect(p.pushFrom).toBe(-1e9);
  });

  it('the planner knows: its run time matches the simulated arrival within 40 ms, with and without', () => {
    for (const d of [0.8, 1.5, 3]) {
      for (const s of [false, true]) {
        expect(Math.abs(planned(d, s) - arrive(d, s))).toBeLessThan(0.04);
      }
    }
  });
});

/** A straight sprint forward (looking where it runs) from a stance: seconds to 5 m and to 10 m, and the planner's. */
function sprint(): { t5: number; t10: number; plan5: number; plan10: number } {
  const p = new Player(0);
  p.minX = -50; p.maxX = 50; p.minZ = -50; p.maxZ = 50;
  p.pos.set(0, 0, 0);
  p.facing = 0;
  let t5 = 0, t10 = 0;
  for (let i = 0; i < 1000 && t10 === 0; i++) {
    p.clock = 10 + i * DT;
    p.driveX = 0;
    p.driveZ = -1;
    p.move();
    const d = -p.pos.z;
    if (t5 === 0 && d >= 5) t5 = (i + 1) * DT;
    if (d >= 10) t10 = (i + 1) * DT;
  }
  const q = new Player(0);
  q.pos.set(0, 0, 0);
  q.facing = 0;
  q.clock = 10;
  q.splitAt = -100;
  q.runX = 0; q.runZ = -1;
  q.runD = 5; q.runTime();
  const plan5 = q.runT;
  q.runD = 10; q.runTime();
  return { t5, t10, plan5, plan10: q.runT };
}

describe('sprinting (force-velocity profile, data/tuning.json player)', () => {
  it('the 5-10 m split is a padel player\'s: 0.85-0.89 s (Saez de Villarreal et al. 2023)', () => {
    // The one sprint number that doesn't depend on what started the clock. With the profile's intercept at the
    // run cap it was 0.90 s; at the field-sport v0 of 7.5-11 m/s it would be 0.83 s (the run reaches the cap by 4 m).
    const s = sprint();
    expect(s.t10 - s.t5).toBeGreaterThan(0.845);
    expect(s.t10 - s.t5).toBeLessThan(0.89);
  });

  it('the planner runs the same profile, up to the cap and on at it (within 40 ms at 5 and 10 m)', () => {
    const s = sprint();
    expect(Math.abs(s.plan5 - s.t5)).toBeLessThan(0.04);
    expect(Math.abs(s.plan10 - s.t10)).toBeLessThan(0.04);
  });
});
