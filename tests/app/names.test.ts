import { describe, expect, it } from 'vitest';
import { dealNames, nameOf, PRO_SURNAMES } from '../../src/game/names.ts';

// Review round 3, critic High #7: the AIs get made-up names dealt from the seed, never a professional's surname.
describe('player names', () => {
  it('are dealt from the seed, a different surname each, never a professional player surname', () => {
    expect(dealNames(42, 4)).toEqual(dealNames(42, 4));
    expect(dealNames(42, 4)).not.toEqual(dealNames(43, 4));
    const pros = new Set(PRO_SURNAMES);
    const nations = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) {
      const ns = dealNames(seed, 4);
      expect(new Set(ns.map((n) => n.last)).size).toBe(4);
      for (const n of ns) {
        expect(pros.has(n.last)).toBe(false);
        expect(n.first.length).toBeGreaterThan(1);
        expect(n.nation).toMatch(/^[A-Z]{3}$/);
        nations.add(n.nation);
      }
    }
    expect(nations.size).toBeGreaterThanOrEqual(8);
  });
  it('read as "D. Campos" in the score rows and in full elsewhere', () => {
    const n = { first: 'Diego', last: 'Campos', nation: 'ESP' };
    expect(nameOf(n, true)).toBe('D. Campos');
    expect(nameOf(n, false)).toBe('Diego Campos');
  });
});
