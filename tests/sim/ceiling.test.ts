// An indoor roof (FIP: at least 6 m of free height, 8 m suggested): the ball touching it is dead. Before the good
// bounce the hitter loses the point (13.1.g/h/l: an element not related to the court); after it, it is a correct
// return (14.1.d: "hits the ceiling, the lights or any other object"). Players lob under it. Before 2026-10-28 the sim
// had no roof: in the club hall (roof 9 m) about 1 shot in 90 flew through it.
import { describe, expect, it } from 'vitest';
import { Ball, HIT_ROOF } from '../../src/sim/ball/ball.ts';
import { makeWorld } from '../../src/sim/setup.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { V3 } from '../../src/sim/core/v3.ts';
import { ShotSolver } from '../../src/sim/contact/shots.ts';
import { Rally, R_POINT, WHY_ROOF, WHY_ROOF_AFTER_BOUNCE } from '../../src/sim/rules/rally.ts';
import { roofOf } from '../../src/app/options.ts';

function serveRally(): Rally {
  const r = new Rally();
  r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0;
  r.onStrike(0, 1, true, 0.6, 1.0);
  r.onBallZ(-1); r.onFloor(-2, -5);
  r.onStrike(1, -1, false);
  r.onBallZ(2); r.onFloor(1, 6);
  // The near team's shot: the ball is theirs now.
  r.onStrike(0, 1, false);
  return r;
}

/** Fly a ball to its top (or the roof); the top and whether it touched the roof. */
function fly(ceiling: number, vy: number): { top: number; roof: number; vyAfter: number } {
  const w = makeWorld({ env: { ceiling } });
  const b = new Ball();
  b.pos.set(0, 1.5, 4);
  b.vel.set(0, vy, -3);
  let top = 0, roof = 0, vyAfter = 0;
  for (let t = 0; t < 4 && b.pos.y > 0.05; t += DT) {
    b.step(w, DT, null);
    for (let i = 0; i < b.eventCount; i++) if (b.events[i]!.kind === HIT_ROOF) { roof++; vyAfter = b.vel.y; }
    top = Math.max(top, b.pos.y);
  }
  return { top, roof, vyAfter };
}

describe('indoor roof', () => {
  it('the ball meets the roof once and comes back down off it', () => {
    const r = fly(9, 14);
    expect(r.roof).toBe(1);
    expect(r.top).toBeLessThanOrEqual(9 - 0.0328 + 1e-9);
    expect(r.vyAfter).toBeLessThan(0);
    // In the open air the same ball goes on up (about 1.5 + 14^2 / 2g less drag).
    const open = fly(Infinity, 14);
    expect(open.roof).toBe(0);
    expect(open.top).toBeGreaterThan(9.5);
  });

  it('before the good bounce the hitter loses; after it, it is a winner (13.1.g, 14.1.d)', () => {
    const a = serveRally();
    a.onRoof();
    expect([a.result, a.winner, a.why]).toEqual([R_POINT, 1, WHY_ROOF]);
    const b = serveRally();
    b.onBallZ(-1); b.onFloor(1, -4);
    b.onRoof();
    expect([b.result, b.winner, b.why]).toEqual([R_POINT, 0, WHY_ROOF_AFTER_BOUNCE]);
    // Over its own half, not yet across the net: the hitter's (13.1.l).
    const c = serveRally();
    c.onRoof();
    expect(c.winner).toBe(1);
  });

  it('a lob is solved under the roof: its top stays 1 m below it and it still lands near the target', () => {
    const p = new V3(0, 1.0, 4);
    const v = new V3(), w = new V3();
    const tops: number[] = [];
    for (const ceiling of [Infinity, 9]) {
      const s = new ShotSolver(makeWorld({ env: { ceiling } }));
      // A lob over a pair at the net from mid-court with a very high clearance (8 m over the tape).
      expect(s.solve(p, 0, -8.5, 600, 8, 40, v, w)).toBe(true);
      const b = new Ball();
      b.pos.copy(p); b.vel.copy(v); b.spin.copy(w);
      const world = makeWorld({ env: { ceiling } });
      let top = 0, landZ = NaN;
      for (let t = 0; t < 5 && Number.isNaN(landZ); t += DT) {
        b.step(world, DT, null);
        top = Math.max(top, b.pos.y);
        for (let i = 0; i < b.eventCount; i++) if (b.events[i]!.kind === 1) landZ = b.events[i]!.z;
      }
      tops.push(top);
      expect(Math.abs(landZ - -8.5)).toBeLessThan(0.6);
    }
    expect(tops[0]!).toBeGreaterThan(9);
    expect(tops[1]!).toBeLessThan(9 - 1);
  });

  it('the arenas: the club hall has a 9 m roof, the stadium 19 m, outdoors none', () => {
    expect(roofOf('hall')).toBe(9);
    expect(roofOf('stadium')).toBe(19);
    expect(roofOf('club-day')).toBe(Infinity);
    expect(roofOf('club-night')).toBe(Infinity);
  });
});
