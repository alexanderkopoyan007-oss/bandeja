// A pair's chemistry (M6 phase E, the career's: MatchConfig.chemistry). Neutral (0.5), null or missing plays the match
// from before to the bit; less reads the opponents' ball later, more sooner; more calls the balls between the pair.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_CALL, E_HIT, type MatchConfig } from '../../src/sim/match.ts';

function hashOf(seed: number, chemistry?: MatchConfig['chemistry']): number {
  const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], chemistry });
  const none = [null, null, null, null];
  for (let k = 0; k < 10000; k++) m.step(none);
  return m.hash();
}

/** Team 0's AI over a few matches: its mean reaction (s) after the opponents strike, and the pair's calls. */
function pair(c: number): { react: number; calls: number } {
  let sum = 0, n = 0, calls = 0;
  for (const seed of [3, 5, 8, 13]) {
    const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [0.6, 0.6], chemistry: [c, null] });
    const none = [null, null, null, null];
    let seen = m.eventSeq;
    for (let k = 0; k < 120 * 120; k++) {
      m.step(none);
      for (; seen < m.eventSeq; seen++) {
        const e = m.events[seen % m.events.length]!;
        if (e.kind === E_CALL && (e.player & 1) === 0) calls++;
        if (e.kind === E_HIT && (e.player & 1) === 1) {
          // (set as the opponents strike: its reaction from now)
          const ai = m.ai[2]!;
          sum += ai.reactAt - m.time;
          n++;
        }
      }
    }
  }
  return { react: sum / n, calls };
}

describe('pair chemistry', () => {
  it('neutral, null or missing: the match from before, to the bit', () => {
    const before = hashOf(7);
    expect(before.toString(16)).toBe('90c06c87');
    expect(hashOf(7, [0.5, 0.5])).toBe(before);
    expect(hashOf(7, [null, null])).toBe(before);
    expect(hashOf(7, [])).toBe(before);
    // Out of range is ignored, not clamped into a change.
    expect(hashOf(7, [Number.NaN, 7])).toBe(before);
    expect(hashOf(7, [0.1, null])).not.toBe(before);
  });

  it('a new pair reads the ball later and calls less; an old one sooner and calls more', () => {
    const fresh = pair(0), neutral = pair(0.5), old = pair(1);
    expect(fresh.react).toBeGreaterThan(neutral.react * 1.15);
    expect(old.react).toBeLessThan(neutral.react * 0.92);
    expect(fresh.calls).toBeLessThan(neutral.calls);
    expect(old.calls).toBeGreaterThan(neutral.calls);
  }, 60000);
});
