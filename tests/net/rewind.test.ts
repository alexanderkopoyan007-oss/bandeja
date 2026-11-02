// Rollback's two promises, held on a few matches: a rewind and replay lands on the state that never rewound, and two
// clients on a lossy link end up on one match. The full runs are tools/net/rewind.ts and tools/net/link-sim.ts.
import { describe, expect, it } from 'vitest';
import { CASES } from '../../tools/net/hash-core.ts';
import { rewindRun } from '../../tools/net/rewind.ts';
import { runLink } from '../../tools/net/link-sim.ts';

describe('rollback', () => {
  for (const label of ['2 humans, one each side', 'windy, hot, 900 m, panoramic, hard floor']) {
    it(`a rewind changes nothing: ${label}`, () => {
      const c = CASES.find((x) => x.label.includes(label));
      expect(c).toBeTruthy();
      const r = rewindRun(c!, { limit: 120 * 240 });
      expect(r.rewinds).toBeGreaterThan(100);
      expect(r.hashBad).toBe(0);
      expect(r.diffs).toEqual([]);
    });
  }

  it('two clients agree over 80 ms with 2% loss', () => {
    const r = runLink(CASES[2]!.cfg, [[0], [1]], 80, 0.02, 12, 120, { delay: 6 });
    expect(r.agreed).toBeGreaterThan(100);
    expect(r.disagreed).toBe(0);
  });
});
