import { describe, expect, it } from 'vitest';
import { MatchSim, E_POINT, E_HIT, PH_OVER } from '../../src/sim/match.ts';

function runAi(seed: number, ticks: number): MatchSim {
  const m = new MatchSim({ seed, human: [false, false] });
  for (let i = 0; i < ticks && m.phase !== PH_OVER; i++) m.step([null, null]);
  return m;
}

describe('match', () => {
  it('is deterministic: same seed and inputs give the same state after 10k ticks', () => {
    expect(runAi(42, 10000).hash()).toBe(runAi(42, 10000).hash());
    expect(runAi(42, 10000).hash()).not.toBe(runAi(43, 10000).hash());
  });

  it('AI vs AI plays real rallies and scores points', () => {
    const m = new MatchSim({ seed: 7, human: [false, false] });
    let seen = 0;
    let points = 0;
    let hits = 0;
    for (let i = 0; i < 120 * 60 * 5; i++) {
      m.step([null, null]);
      while (seen < m.eventSeq) {
        const e = m.events[seen % 64]!;
        seen++;
        if (e.kind === E_POINT) points++;
        if (e.kind === E_HIT) hits++;
      }
    }
    expect(points).toBeGreaterThan(10);
    expect(hits / points).toBeGreaterThan(3);
  });
});
