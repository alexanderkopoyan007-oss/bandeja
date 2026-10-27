// The net as a soft catcher: a ball into the body bulges it and drops dead on the hitter's side, stiffer near the
// tape and the posts; the posts are solid steel; and the rules never count a bulge as the ball crossing.
import { describe, expect, it } from 'vitest';
import { Ball, HIT_NET, HIT_POST } from '../../src/sim/ball/ball.ts';
import { makeWorld } from '../../src/sim/setup.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { MatchSim, E_HIT, E_NET, E_POINT } from '../../src/sim/match.ts';

const w = makeWorld();

/** Fire a ball at the net from the near side and fly it until it is out of the net and on the floor or away. */
function intoNet(x: number, y: number, speed: number) {
  const b = new Ball();
  b.pos.set(x, y, 1.0);
  b.vel.set(0, 0, -speed);
  const out = { caught: false, deepest: 0, exitSpeed: NaN, endZ: 0, kinds: [] as number[] };
  for (let t = 0; t < 2; t += DT) {
    const was = b.inNet;
    b.step(w, DT, null);
    for (let k = 0; k < b.eventCount; k++) out.kinds.push(b.events[k]!.kind);
    if (b.inNet) out.caught = true;
    out.deepest = Math.min(out.deepest, b.pos.z);
    if (was && !b.inNet && Number.isNaN(out.exitSpeed)) out.exitSpeed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  }
  out.endZ = b.pos.z;
  return out;
}

describe('net', () => {
  it('a 25 m/s ball into the middle of the net bulges it 20-45 cm and drops dead on the hitter\'s side', () => {
    const r = intoNet(0, 0.45, 25);
    expect(r.kinds).toContain(HIT_NET);
    expect(r.caught).toBe(true);
    expect(-r.deepest).toBeGreaterThan(0.2);
    expect(-r.deepest).toBeLessThan(0.45);
    expect(r.exitSpeed).toBeLessThan(25 * 0.25);
    expect(r.endZ).toBeGreaterThan(0);
  });

  it('gives less near the tape and near the posts, and little to a soft ball', () => {
    const mid = -intoNet(0, 0.45, 25).deepest;
    expect(-intoNet(0, 0.76, 25).deepest).toBeLessThan(mid * 0.85);
    expect(-intoNet(4.2, 0.45, 25).deepest).toBeLessThan(mid * 0.7);
    const soft = intoNet(0, 0.45, 4);
    expect(soft.caught).toBe(true);
    expect(-soft.deepest).toBeLessThan(0.08);
    expect(soft.endZ).toBeGreaterThan(0);
  });

  it('the posts are solid: a ball off a post bounces straight back', () => {
    const b = new Ball();
    b.pos.set(w.court.halfW - 0.03, 0.6, 1.0);
    b.vel.set(0, 0, -20);
    let post = false;
    for (let t = 0; t < 0.2 && !post; t += DT) {
      b.step(w, DT, null);
      for (let k = 0; k < b.eventCount; k++) if (b.events[k]!.kind === HIT_POST) post = true;
    }
    expect(post).toBe(true);
    expect(b.inNet).toBe(false);
    expect(b.vel.z).toBeGreaterThan(5);
  });

  it('a ball rolling into the net stops against it and never rolls under', () => {
    const b = new Ball();
    b.pos.set(0.3, w.spec.radius, 1.5);
    b.vel.set(0, 0, -3);
    b.rolling = true;
    for (let t = 0; t < 3; t += DT) {
      b.step(w, DT, null);
      expect(b.pos.z).toBeGreaterThan(0);
    }
  });

  it('rules: a ball into the net loses the point for the hitter, even while it bulges past the line', () => {
    let netPoints = 0;
    let bulged = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
      let seen = 0;
      let hitter = -1;
      let intoNet = false;
      for (let i = 0; i < 120 * 300; i++) {
        m.step([null, null, null, null]);
        if (m.ball.inNet && hitter >= 0 && Math.sign(m.ball.pos.z) !== (hitter === 0 ? 1 : -1)) bulged++;
        while (seen < m.eventSeq) {
          const e = m.events[seen % m.events.length]!;
          seen++;
          if (e.kind === E_HIT) { hitter = e.team; intoNet = false; }
          if (e.kind === E_NET && e.a === 0) intoNet = true;
          if (e.kind === E_POINT) {
            if (intoNet) {
              netPoints++;
              expect(e.team).toBe(1 - hitter);
            }
            intoNet = false;
            hitter = -1;
          }
        }
      }
    }
    expect(netPoints).toBeGreaterThan(8);
    expect(bulged).toBeGreaterThan(0);
  });
});
