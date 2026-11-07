// Motion matching at run time (src/render/avatar/matcher.ts, ?motion=2) on the five cycles the game has now: it must
// pick the cycle that travels the way the sim is going, carry it on at the ground speed without jumping, allocate
// nothing, and hold the animation QA thresholds the sector blend holds (tests/render/animQa.test.ts).
// Measured 2026-11-07 with node tools/anim-check.ts (MOTION=2), 90 s on seeds 1, 2, 3 L against the blend: skate
// 13.3-13.8 cm/s (13.2-13.8), pops 11.7-18.8 per player-minute (10.5-19.2), pelvis frames over its limit 54-77 (111-190);
// a sole's deepest dip under the floor 5.2 cm (3.3) on 0.03% of frames. About 20 switches per player-minute while
// moving; 22% of the time a direction other than the blend's sector, with legs through each other 7.4% (6.6% blended:
// strafes picked for the path ahead with the body still going another way). Picking only clips the legs can be turned
// onto (WARP_REACH) and carrying the footfall's phase across a switch: legs through each other 6.4-6.7% on seeds 1, 2
// (6.1-6.6% blended), 4.3% on 3 L (3.9%); pops 15.0, 19.7, 16.2 (13.3, 19.2, 10.5).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { Matcher } from '../../src/render/avatar/matcher.ts';
import { expectAnimQa } from './qaThresholds.ts';

const asset = (() => {
  const raw = gunzipSync(readFileSync(new URL('../../public/assets/player.bnz', import.meta.url)));
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
})();
const NAMES = ['jog', 'run', 'strafeLeft', 'runBack', 'strafeRight'];
const cycles = NAMES.map((n) => asset.clip(n));
const DT = 1 / 60;

/** A matcher fed steady travel at (vx, vz) in the body's frame for `secs`; the jumps it made after the first second. */
function steady(m: Matcher, vx: number, vz: number, secs: number): number {
  m.vx = vx; m.vz = vz; m.wx = vx; m.wz = vz;
  m.sp = Math.hypot(vx, vz);
  m.dt = DT;
  let jumps = 0;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    m.step();
    if (m.jumped && i * DT > 1) jumps++;
  }
  return jumps;
}

describe('motion matching at run time', () => {
  it('picks the cycle that travels the way the sim goes, and stays on it', () => {
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i]!;
      const m = new Matcher(asset, cycles);
      const jumps = steady(m, c.speed * c.dirX, c.speed * c.dirZ, 4);
      expect(NAMES[m.src]).toBe(NAMES[i]);
      expect(jumps).toBe(0);
    }
  });

  it('carries the clip on by the ground covered', () => {
    const run = cycles[1]!;
    const m = new Matcher(asset, cycles);
    steady(m, 0, run.speed, 1);
    // at 0.9 of the clip's own speed, its time runs at 0.9
    steady(m, 0, run.speed * 0.9, 0.2);
    const t0 = m.t;
    m.step();
    let d = m.t - t0;
    if (d < 0) d += run.duration;
    expect(d).toBeCloseTo(DT * 0.9, 6);
  });

  it('follows the sim round a turn within a search', () => {
    // Running ahead, the sim turns the body to its right (-x) at its own push and braking; once the way of travel is
    // nearer the right than ahead, the right strafe or the back run plays within one search. (With only the four
    // directions the matcher can't pick a new one before the body has turned: matcher.ts WARP_REACH.)
    const run = cycles[1]!;
    const m = new Matcher(asset, cycles);
    steady(m, 0, run.speed, 1);
    const wx = -cycles[4]!.speed;
    let late = 0;
    for (let i = 0; i < 120; i++) {
      const dx = wx - m.vx, dz = -m.vz, dl = Math.hypot(dx, dz), a = 8 * DT;
      if (dl <= a) { m.vx = wx; m.vz = 0; } else { m.vx += (dx / dl) * a; m.vz += (dz / dl) * a; }
      m.wx = wx; m.wz = 0;
      m.sp = Math.hypot(m.vx, m.vz);
      m.step();
      const right = Math.abs(Math.atan2(m.vx, m.vz)) > Math.PI / 4;
      if (right && NAMES[m.src] !== 'strafeRight' && NAMES[m.src] !== 'runBack') late++;
    }
    expect(late * DT).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(NAMES[m.src]).toBe('strafeRight');
  });

  it('steps without allocating', () => {
    const m = new Matcher(asset, cycles);
    m.dt = DT; m.accel = 8.5; m.brake = 8;
    const go = (n: number): void => {
      for (let i = 0; i < n; i++) {
        // the wish swings round every second: searches and jumps
        const a = (i % 60) * (Math.PI / 30);
        m.wx = 4 * Math.sin(a); m.wz = 4 * Math.cos(a);
        m.vx += (m.wx - m.vx) * 0.1; m.vz += (m.wz - m.vz) * 0.1;
        // (not Math.hypot: it takes its arguments as a list, and allocates)
        m.sp = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
        m.step();
      }
    };
    // Warmed up longer than the library's search test: the search runs every sixth step here, so it reaches
    // optimised code late (measured after 5000 steps 67 bytes a step, after 60000 0.2).
    go(60000);
    const before = process.memoryUsage().heapUsed;
    go(20000);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_000_000);
  });

  const L = [false, true, true, false];
  for (const [seed, lefty] of [[1, []], [5, L]] as Array<[number, boolean[]]>) {
    it(`holds the animation QA thresholds, seed ${seed}${lefty.length ? ' (left-handers)' : ''}`, () => {
      Avatar.motion = 2;
      try {
        expectAnimQa(runAnimQa(asset, { seed, seconds: 60, lefty, repeatEvery: 7 }));
      } finally {
        Avatar.motion = 0;
      }
    }, 120_000);
  }
});
