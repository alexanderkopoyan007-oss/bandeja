// The net as cloth (src/sim/court/netCloth.ts): hangs to the FIP heights, a ball into the body pushes a pocket
// into it and drops on the hitter's side, the pocket is shallower near the tape and the posts and for slow balls,
// the cloth moves, rings down and sleeps, the posts are solid, nothing gets through below the cable, and the rules
// never count a pocket as the ball crossing.
import { describe, expect, it } from 'vitest';
import { Ball, HIT_NET, HIT_NETCORD, HIT_POST } from '../../src/sim/ball/ball.ts';
import { makeWorld, makeNetCloth } from '../../src/sim/setup.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Hasher } from '../../src/sim/core/hash.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { MatchSim, E_HIT, E_NET, E_POINT } from '../../src/sim/match.ts';
import type { NetCloth } from '../../src/sim/court/netCloth.ts';

const w = makeWorld();

/** One tick the way MatchSim runs it: the ball (coupled to the cloth when near it), else the cloth alone. */
function tick(b: Ball, net: NetCloth): void {
  net.beginTick();
  b.step(w, DT, null);
  if (!b.coupled && net.awake) net.freeTick();
}

/** Fire a ball at the net from `side`'s court (+1 near, -1 far) and fly it for `secs`. */
function fire(x: number, y: number, speed: number, opts: { vy?: number; side?: number; secs?: number; net?: NetCloth } = {}) {
  const s = opts.side ?? 1;
  const net = opts.net ?? makeNetCloth(w);
  const b = new Ball();
  b.cloth = net;
  b.pos.set(x, y, 1.0 * s);
  b.vel.set(0, opts.vy ?? 0, -speed * s);
  const out = { net, ball: b, kinds: [] as number[], deepest: 0, knotMove: 0, exitSpeed: NaN, endZ: 0, crossedLow: false };
  let wasIn = false;
  let over = false;
  const r = w.spec.radius;
  for (let t = 0; t < (opts.secs ?? 2); t += DT) {
    tick(b, net);
    for (let k = 0; k < b.eventCount; k++) out.kinds.push(b.events[k]!.kind);
    out.deepest = Math.min(out.deepest, b.pos.z * s);
    // Through the netting: past the cloth's surface (not just z = 0) without having gone over the cable.
    const x = b.pos.x;
    if (Math.abs(x) < net.halfW && Math.abs(b.pos.z) < 0.6 && b.pos.y > net.cableY(x)) over = true;
    if (!over && Math.abs(x) < net.halfW - 0.05 && b.pos.y < net.cableY(x) - r) {
      net.bx = x;
      net.by = b.pos.y;
      net.side = s;
      // (Measured across the patch under the ball in x-y, which reads a few cm off where the netting folds.)
      if (s * (b.pos.z - net.surfaceZ()) < -(r + 0.08)) out.crossedLow = true;
    }
    for (let k = 0; k < net.n; k++) out.knotMove = Math.max(out.knotMove, Math.abs(net.pos[k * 3 + 2]! - net.rest[k * 3 + 2]!));
    if (wasIn && !b.inNet && Number.isNaN(out.exitSpeed)) out.exitSpeed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    wasIn = b.inNet;
  }
  out.endZ = b.pos.z * s;
  if (!over && out.endZ < -0.02) out.crossedLow = true;
  return out;
}

describe('net cloth', () => {
  it('hangs to the FIP heights: tape top 0.88 m in the middle, 0.92 m at the posts, the bottom on the floor', () => {
    const net = makeNetCloth(w);
    const top = (x: number) => net.cableY(x) + net.spec.cableBelowTop;
    expect(top(0)).toBeGreaterThan(0.87);
    expect(top(0)).toBeLessThan(0.89);
    expect(top(net.halfW - 0.01)).toBeGreaterThan(0.91);
    expect(top(net.halfW - 0.01)).toBeLessThan(0.925);
    const mid = (net.cols / 2) | 0;
    expect(net.rest[(net.rows * net.nx + mid) * 3 + 1]!).toBeLessThan(0.02);
    expect(net.awake).toBe(false);
  });

  it('a 25 m/s ball into the middle pushes a 15-35 cm pocket and drops on the hitter\'s side', () => {
    for (const side of [1, -1]) {
      const r = fire(0, 0.45, 25, { side });
      expect(r.kinds).toContain(HIT_NET);
      expect(r.deepest).toBeLessThan(-0.15);
      expect(r.deepest).toBeGreaterThan(-0.35);
      expect(r.knotMove).toBeGreaterThan(0.15);
      expect(r.exitSpeed).toBeLessThan(25 * 0.3);
      expect(r.endZ).toBeGreaterThan(0);
      expect(r.crossedLow).toBe(false);
    }
  });

  it('the pocket is shallower for a slow ball, near the tape and near the posts', () => {
    const mid = -fire(0, 0.45, 25).deepest;
    const slow = fire(0, 0.45, 8);
    expect(-slow.deepest).toBeLessThan(0.12);
    expect(slow.endZ).toBeGreaterThan(0);
    expect(-fire(0, 0.8, 25).deepest).toBeLessThan(mid);
    expect(-fire(4.4, 0.45, 25).deepest).toBeLessThan(mid * 0.8);
  });

  it('moves, rings down and goes back to sleep at its rest shape', () => {
    const r = fire(-1.5, 0.4, 20, { secs: 5 });
    expect(r.knotMove).toBeGreaterThan(0.1);
    const net = r.net;
    expect(net.awake).toBe(false);
    let off = 0;
    for (let k = 0; k < net.n * 3; k++) off = Math.max(off, Math.abs(net.pos[k]! - net.rest[k]!));
    expect(off).toBeLessThan(0.03);
  });

  it('the posts are solid: a ball off a post bounces straight back', () => {
    const net = makeNetCloth(w);
    const b = new Ball();
    b.cloth = net;
    b.pos.set(w.court.halfW - 0.03, 0.6, 1.0);
    b.vel.set(0, 0, -20);
    let post = false;
    for (let t = 0; t < 0.2 && !post; t += DT) {
      tick(b, net);
      for (let k = 0; k < b.eventCount; k++) if (b.events[k]!.kind === HIT_POST) post = true;
    }
    expect(post).toBe(true);
    expect(b.inNet).toBe(false);
    expect(b.vel.z).toBeGreaterThan(5);
  });

  it('a ball rolling into the net stops against it and never rolls under', () => {
    const net = makeNetCloth(w);
    const b = new Ball();
    b.cloth = net;
    b.pos.set(0.3, w.spec.radius, 1.5);
    b.vel.set(0, 0, -3);
    b.rolling = true;
    for (let t = 0; t < 3; t += DT) {
      tick(b, net);
      expect(b.pos.z).toBeGreaterThan(-0.15);
    }
    expect(b.pos.z).toBeGreaterThan(0);
  });

  it('a clip of the tape takes pace off and the ball carries on or sits up', () => {
    const r = fire(0, 0.91, 20, { vy: -0.5 });
    expect(r.kinds).toContain(HIT_NETCORD);
    expect(Math.abs(r.ball.vel.z)).toBeLessThan(20);
  });

  it('nothing gets through below the cable: 200 random balls at up to 45 m/s', () => {
    const rng = new Rng(77);
    const net = makeNetCloth(w);
    for (let n = 0; n < 200; n++) {
      net.reset();
      const side = rng.next() < 0.5 ? 1 : -1;
      const r = fire((rng.next() * 2 - 1) * 4.9, 0.05 + rng.next() * 0.7, 10 + rng.next() * 35, {
        side, vy: rng.next() * 4 - 2, secs: 1.2, net,
      });
      expect(r.crossedLow).toBe(false);
      expect(r.deepest).toBeGreaterThan(-0.6);
    }
  }, 120_000);

  it('a hard low ball folds the netting into a bag and stays in it: 150 balls at 30-45 m/s below 35 cm', () => {
    // The bag's floor is nearly level; a ball once dropped through it and out under the net.
    const rng = new Rng(78);
    const net = makeNetCloth(w);
    for (let n = 0; n < 150; n++) {
      net.reset();
      const side = rng.next() < 0.5 ? 1 : -1;
      const r = fire((rng.next() * 2 - 1) * 4.5, 0.05 + rng.next() * 0.3, 30 + rng.next() * 15, {
        side, vy: rng.next() * 4 - 2, secs: 1.2, net,
      });
      expect(r.crossedLow).toBe(false);
    }
  }, 120_000);

  it('is deterministic: the same ball gives the same cloth hash', () => {
    const hash = () => {
      const r = fire(0.7, 0.5, 30, { secs: 1 });
      const h = new Hasher();
      r.net.hashInto(h);
      return h.h;
    };
    expect(hash()).toBe(hash());
  });

  it('rules: a ball into the net loses the point for the hitter, even while it bulges past the line', () => {
    let netPoints = 0;
    let bulged = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
      let seen = 0;
      let hitter = -1;
      let intoNet = false;
      let crossed = false;
      for (let i = 0; i < 120 * 300; i++) {
        m.step([null, null, null, null]);
        const own = hitter === 0 ? 1 : -1;
        if (hitter >= 0 && m.ball.sideZ * own < 0) crossed = true;
        if (m.ball.inNet && hitter >= 0 && Math.sign(m.ball.pos.z) !== own) bulged++;
        while (seen < m.eventSeq) {
          const e = m.events[seen % m.events.length]!;
          seen++;
          if (e.kind === E_HIT) { hitter = e.team; intoNet = false; crossed = false; }
          if (e.kind === E_NET && e.a === 0) intoNet = true;
          if (e.kind === E_POINT) {
            // Into the netting and never over: the hitter's point lost. (Off the netting and over the tape is
            // play on, like any net cord.)
            if (intoNet && !crossed) {
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
  }, 300_000);
});
