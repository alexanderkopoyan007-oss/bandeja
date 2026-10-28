// Shot shapes in flight: a clean contact from the back of the court, flown through the real ball model.
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { ShotSolver, strike, SHOT_CHIQUITA, SHOT_DRIVE, MOD_NONE, type ShotRequest, type ShotResult } from '../../src/sim/contact/shots.ts';

const m = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] });
const solver = new ShotSolver(m.world);

/** Strike from (0.5, y, z) on the near side towards (0, -depth) and fly it until it comes down after the bounce. */
function fly(shot: number, z: number, y: number, depth: number) {
  const b = new Ball();
  b.pos.set(0.5, y, z);
  b.vel.set(0, -2, 10);
  const req: ShotRequest = {
    shot, mod: MOD_NONE, targetX: 0, targetZ: -depth, quality: 0.82, timingDelta: 0, handSide: 1,
    moving: 0, stretch: 0, power: 1, control: 1, spinScale: 1, motor: 0, bodyX: 0, bodyZ: z + 0.6,
  };
  const res: ShotResult = { reachable: false, speed: 0, idealX: 0, idealZ: 0 };
  strike(solver, b, req, new Rng(5), res);
  // Height where players at the net stand (2.6 m past it).
  let net = NaN, land = NaN, top = 0, atNet = NaN, prevZ = b.pos.z, prevVy = b.vel.y;
  for (let k = 0; k < 600; k++) {
    b.step(m.world, 1 / 120, null);
    if (prevZ > 0 && b.pos.z <= 0) net = b.pos.y;
    if (prevZ > -2.6 && b.pos.z <= -2.6) atNet = b.pos.y;
    if (Number.isNaN(land) && prevVy < 0 && b.vel.y > 0 && b.pos.y < 0.3) land = -b.pos.z;
    if (!Number.isNaN(land)) {
      top = Math.max(top, b.pos.y);
      if (b.vel.y < 0) break;
    }
    prevZ = b.pos.z;
    prevVy = b.vel.y;
  }
  return { reachable: res.reachable, speed: res.speed, net, land, top, atNet };
}

describe('shots', () => {
  it('chiquita: soft, just over the tape, dipping at the feet of players at the net', () => {
    for (const [z, y] of [[8.5, 0.6], [6.5, 0.9]] as const) {
      const c = fly(SHOT_CHIQUITA, z, y, 3.3);
      const d = fly(SHOT_DRIVE, z, y, 7.2);
      expect(c.reachable).toBe(true);
      expect(c.net).toBeLessThan(1.35);
      expect(c.net).toBeGreaterThan(0.95);
      expect(c.land).toBeGreaterThan(2.5);
      expect(c.land).toBeLessThan(4.0);
      expect(c.speed).toBeLessThan(d.speed * 0.8);
      // At the net players' feet: below knee height where a drive is still at the hip. (Its topspin kicks it up
      // again after the bounce, higher than a flatter drive: that is real, and not the point of the shot.)
      expect(c.atNet).toBeLessThan(0.6);
      expect(c.atNet).toBeLessThan(d.atNet - 0.3);
    }
  });
});
