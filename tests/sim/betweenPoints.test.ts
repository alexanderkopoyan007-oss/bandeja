// Between the points, as a person sees it. A key in the walk back put all four in their places in that frame, up to 8.8 m with no cut, and the prompt for the
// serve asked for that key. The server's partner stood with their back to the net until the serve went, then spun round (review round 32).
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_SETUP, PH_TOSS, PH_OVER } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';

const off = (facing: number, side: number): number => {
  const a = facing - (side > 0 ? 0 : Math.PI);
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI;
};

describe('a key in the walk back', () => {
  it('puts everyone in their places under the dip, never in plain sight', () => {
    let skips = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = new MatchSim({ seed: 5500 + seed, doubles: true, human: [true, false, false, false], aiLevel: [1, 1], assist: 0.45, timingScale: 1.5, firstServer: 1,
        format: { mode: 1, setsToWin: 1, gamesPerSet: 6, finalSet: 0 } } as never);
      const none = [null, null, null, null];
      const f = new InputFrame();
      let start = -1;
      for (let t = 0; t < 120 * 400 && m.phase !== PH_OVER && skips < 40; t++) {
        const x = m.players.map((p) => p.pos.x), z = m.players.map((p) => p.pos.z);
        const under = m.cutComing;
        if (m.phase === PH_SETUP && m.walking > 0 && m.walking < 3) {
          if (start < 0) start = m.time;
          if (m.time > start + 1 && !under && m.cutIn > 1) {
            f.clear();
            f.push(true, BTN_DRIVE, m.time);
            f.held = BTN_DRIVE;
            m.step([f, null, null, null]);
            f.clear();
            f.push(false, BTN_DRIVE, m.time);
            m.step([f, null, null, null]);
            skips++;
            expect(m.cutComing).toBe(true);
            expect(m.cutIn).toBeGreaterThan(0.2);
            continue;
          }
        } else start = -1;
        m.step(none);
        // (the walk at most: anything further is a jump, and only a cut may hide one)
        const far = Math.max(...m.players.map((p, i) => Math.hypot(p.pos.x - x[i]!, p.pos.z - z[i]!)));
        if (far > 0.1 && m.phase === PH_SETUP) expect(under).toBe(true);
      }
    }
    expect(skips).toBeGreaterThan(8);
  });
});

describe('the walk back', () => {
  it('turns nobody faster than a walk turns, at either end', () => {
    // (facing along the walk, they arrived back to their place and were set square in a tick, 150-210 degrees; review round 33)
    const m = new MatchSim({ seed: 5602, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    const none = [null, null, null, null];
    let most = 0, walks = 0, was = 0;
    const f0 = m.players.map((p) => p.facing);
    for (let t = 0; t < 120 * 600 && m.phase !== PH_OVER; t++) {
      m.step(none);
      if (m.walking > 0 && m.walking < 3 && was === 0) walks++;
      m.players.forEach((p, i) => {
        const d = Math.abs(Math.atan2(Math.sin(p.facing - f0[i]!), Math.cos(p.facing - f0[i]!)));
        // (but the cut at a change of ends, where they come on from the post on the other side, and the walk's first tick, which
        // ends the dead time: a player turning there at its 7 rad/s, 0.058 a tick, went on for that one tick on seed 5602)
        if (was > 0 && was < 3) most = Math.max(most, d);
        f0[i] = p.facing;
      });
      was = m.walking;
    }
    expect(walks).toBeGreaterThan(20);
    // (the walk's own 2 rad/s, a tick at a time)
    expect(most).toBeLessThan(0.05);
  });
});

describe('the server\'s partner', () => {
  it('faces the opponents at the serve', () => {
    const m = new MatchSim({ seed: 5601, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    const none = [null, null, null, null];
    const M = m as never as { score: { serverPlayer(): number } };
    let n = 0, away = 0;
    for (let t = 0; t < 120 * 900 && m.phase !== PH_OVER; t++) {
      m.step(none);
      if (m.phase !== PH_TOSS) continue;
      const i = M.score.serverPlayer() ^ 2, p = m.players[i]!;
      n++;
      if (off(p.facing, m.side(p.team)) > 30) away++;
    }
    expect(n).toBeGreaterThan(200);
    // (135 degrees, every serve, before)
    expect(away / n).toBeLessThan(0.02);
  });
});
