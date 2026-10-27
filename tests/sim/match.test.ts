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

describe('timing is judged on the exact input time', () => {
  it('a release 3 ms after the ideal moment is graded with a 3 ms error, wherever it falls inside the tick', async () => {
    const { InputFrame, BTN_DRIVE } = await import('../../src/sim/input.ts');
    const { DT } = await import('../../src/sim/core/constants.ts');
    for (const offset of [0.003, -0.004, 0.0101]) {
      const m = new MatchSim({ seed: 3, human: [true, false], firstServer: 0 });
      const f = new InputFrame();
      // Wait out the pre-serve pause, then press to drop the ball.
      while (m.time < m.phaseUntil + DT) { f.clear(); m.step([f, null]); }
      f.clear();
      f.push(true, BTN_DRIVE, m.time);
      f.held = BTN_DRIVE;
      m.step([f, null]);
      const releaseAt = m.tossIdeal + offset;
      // Step until the tick that contains the release time, then deliver it with its exact timestamp.
      while (m.time + DT <= releaseAt) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
      f.clear();
      f.push(false, BTN_DRIVE, releaseAt);
      m.step([f, null]);
      expect(m.players[0]!.timingDelta).toBeCloseTo(offset, 9);
    }
  });
});

describe('assisted timing', () => {
  it('a swing held through the ideal moment goes off by itself and grades Good', async () => {
    const { InputFrame, BTN_DRIVE } = await import('../../src/sim/input.ts');
    const { DT } = await import('../../src/sim/core/constants.ts');
    const { G_GOOD } = await import('../../src/sim/contact/timing.ts');
    for (const timingScale of [1, 1.5, 2]) {
      const m = new MatchSim({ seed: 3, human: [true, false], firstServer: 0, autoTiming: true, timingScale });
      const f = new InputFrame();
      while (m.time < m.phaseUntil + DT) { f.clear(); m.step([f, null]); }
      f.clear();
      f.push(true, BTN_DRIVE, m.time);
      f.held = BTN_DRIVE;
      m.step([f, null]);
      // Never release: keep holding well past the ideal moment.
      const until = m.tossIdeal + 0.4;
      while (m.time < until) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
      expect(m.players[0]!.grade).toBe(G_GOOD);
      expect(m.players[0]!.timingDelta).toBeLessThan(0);
    }
  });
});
