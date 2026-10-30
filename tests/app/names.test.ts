import { dealCast } from '../../src/game/cast.ts';
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

describe('the cast', () => {
  it('a match is men or women throughout, the names fit, the seed decides it', () => {
    let women = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed < 400; seed++) {
      const c = dealCast(seed);
      expect(new Set(c.people).size).toBe(4);
      const ws = c.people.filter((p) => Number(p.slice(1)) >= 7).length;
      expect(ws === 0 || ws === 4).toBe(true);
      expect(c.women).toBe(ws === 4);
      if (c.women) women++;
      for (const p of c.people) seen.add(p);
      expect(dealCast(seed)).toEqual(c);
      const names = dealNames(seed, 4, c);
      names.forEach((n, i) => expect(c.nations[i]).toContain(n.nation));
    }
    expect(women).toBeGreaterThan(90);
    expect(women).toBeLessThan(200);
    expect(seen.size).toBe(10);
  });
});
