// How a shot goes wrong. The owner's partner kept hitting it into their own fence: a badly met ball glanced off a face turned past it
// and flew on backwards at 20-30 m/s (1 volley in 80 at Club over 60 degrees off its aim, 1 in 50 at Novice, some straight back).
// A real miss goes into the net, long or wide. And the serve is struck at the waist, not by the knee.
import { describe, expect, it } from 'vitest';
import { E_FAULT, E_HIT, MatchSim, PH_OVER } from '../../src/sim/match.ts';
import { SHOT_CONTRAPARED, SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import * as R from '../../src/sim/rules/rally.ts';

const NONE = [null, null, null, null];

describe('a miss', () => {
  for (const [name, level] of [['Novice', 0.2], ['Club', 0.55]] as const) {
    it(`at ${name} a clean contact never leaves far off its aim`, () => {
      let shots = 0, wild = 0;
      for (let s = 0; s < 8; s++) {
        const m = new MatchSim({ seed: 210001 + s, doubles: true, human: [false, false, false, false], aiLevel: [level, level], format: { mode: 1, setsToWin: 1, gamesPerSet: 3, finalSet: 0 } } as never);
        const res = (m as unknown as { res: { idealX: number; idealZ: number; frame: boolean } }).res;
        let seen = 0;
        for (let t = 0; t < 120 * 1000 && m.phase !== PH_OVER; t++) {
          m.step(NONE);
          for (; seen < m.eventSeq; seen++) {
            const e = m.events[seen % m.events.length]!;
            if (e.kind !== E_HIT || e.a === SHOT_CONTRAPARED || e.a === SHOT_SERVE || res.frame) continue;
            const v = m.ball.vel;
            if (Math.hypot(v.x, v.z) < 3) continue;
            let d = Math.abs(Math.atan2(res.idealX - e.x, res.idealZ - e.z) - Math.atan2(v.x, v.z)) * 57.3;
            if (d > 180) d = 360 - d;
            shots++;
            if (d > 60) wild++;
          }
        }
      }
      expect(shots).toBeGreaterThan(1000);
      expect(wild / shots).toBeLessThan(0.002);
    }, 300000);
  }
});

describe('the serve', () => {
  it('is struck at the waist, legally', () => {
    const hs: number[] = [];
    let high = 0;
    for (let s = 0; s < 4; s++) {
      const m = new MatchSim({ seed: 211001 + s, doubles: true, human: [false, false, false, false], aiLevel: [0.55, 0.55], format: { mode: 1, setsToWin: 1, gamesPerSet: 2, finalSet: 0 } } as never);
      let seen = 0;
      for (let t = 0; t < 120 * 500 && m.phase !== PH_OVER; t++) {
        m.step(NONE);
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind === E_HIT && e.a === SHOT_SERVE) hs.push(e.y);
          if (e.kind === E_FAULT && e.a === R.WHY_SERVE_ABOVE_WAIST) high++;
        }
      }
    }
    hs.sort((a, b) => a - b);
    expect(hs.length).toBeGreaterThan(40);
    expect(hs[hs.length >> 1]!).toBeGreaterThan(0.85);
    expect(hs[hs.length - 1]!).toBeLessThan(1.02);
    expect(high).toBe(0);
  }, 120000);
});
