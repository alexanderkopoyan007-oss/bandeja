// A smash from deep errs more (data/shots.json deepError) because a flat smash from the back is the club player's
// mistake. Off the glass the same stroke is a bajada, a shot pros make at a third of that rate: the extra error doubled
// the AI's bajada errors, 7.7 to 15.9 in a hundred, until it was tied to a ball met in the air (review round 30).
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { ShotSolver, strike, SHOT_SMASH, MOD_NONE, type ShotRequest, type ShotResult } from '../../src/sim/contact/shots.ts';

const m0 = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] });
const solver = new ShotSolver(m0.world);

function spread(inAir: boolean): number {
  const res: ShotResult = { reachable: false, speed: 0, idealX: 0, idealZ: 0 };
  let sum = 0, sq = 0;
  const n = 300;
  for (let k = 0; k < n; k++) {
    const b = new Ball();
    b.pos.set(0.5, 2.3, 7.8);
    b.vel.set(0, -3, 2);
    b.spin.set(0, 0, 0);
    const req: ShotRequest = {
      shot: SHOT_SMASH, mod: MOD_NONE, targetX: 0, targetZ: -6, inAir, quality: 0.82, timingDelta: 0, handSide: 1,
      moving: 0, stretch: 0, power: 1, control: 1, spinScale: 1, motor: 0, bodyX: 0.5, bodyZ: 7.4,
    };
    strike(solver, b, req, new Rng(500 + k), res);
    const a = Math.atan2(b.vel.x, -b.vel.z);
    sum += a;
    sq += a * a;
  }
  return Math.sqrt(sq / n - (sum / n) * (sum / n));
}

describe('a smash from deep', () => {
  it('errs more met in the air than off the glass', () => {
    expect(spread(true)).toBeGreaterThan(1.25 * spread(false));
  });
});
