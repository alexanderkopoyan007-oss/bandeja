import { dealCast } from '../../src/game/cast.ts';
import roster from '../../data/people.json';
import { describe, expect, it } from 'vitest';
import { dealNames, nameOf, OWNER_ROSTER, PRO_SURNAMES } from '../../src/game/names.ts';

// Review round 3, critic High #7: the AIs get made-up names dealt from the seed, never a professional's surname.
describe('player names', () => {
  it('are dealt from the seed, a different surname each, never a professional player surname', () => {
    expect(dealNames(42, 4)).toEqual(dealNames(42, 4));
    expect(dealNames(42, 4)).not.toEqual(dealNames(43, 4));
    const pros = new Set(PRO_SURNAMES);
    const nations = new Set<string>();
    // (made-up names are a women's match's: a men's match deals the owner's roster, below)
    const all = { nations: Array.from({ length: 4 }, () => ['ESP', 'ARG', 'ITA', 'FRA', 'POR', 'BRA', 'SWE', 'MEX', 'NED', 'JPN']), women: true };
    for (let seed = 0; seed < 2000; seed++) {
      const ns = dealNames(seed, 4, all);
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
  it('a men\'s match deals four different names from the owner\'s roster, the seed deciding which', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const ns = dealNames(seed, 4);
      expect(new Set(ns.map((n) => n.last)).size).toBe(4);
      for (const n of ns) { expect(OWNER_ROSTER.some((r) => r.last === n.last && r.first === n.first)).toBe(true); seen.add(n.last); }
    }
    expect(seen.size).toBe(OWNER_ROSTER.length);
    expect(nameOf(OWNER_ROSTER[0]!, true)).toBe('Boris');
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
      const ws = c.people.filter((p) => roster.women.some((w) => w.name === p) || roster.guests.some((g) => g.name === p && 'woman' in g)).length;
      expect(ws === 0 || ws === 4).toBe(true);
      expect(c.women).toBe(ws === 4);
      if (c.women) women++;
      for (const p of c.people) seen.add(p);
      expect(dealCast(seed)).toEqual(c);
      const names = dealNames(seed, 4, c);
      // (a women's match's made-up names fit the faces; a men's match is the owner's roster)
      if (c.women) names.forEach((n, i) => expect(c.nations[i]).toContain(n.nation));
      else names.forEach((n) => expect(OWNER_ROSTER.some((r) => r.last === n.last)).toBe(true));
    }
    expect(women).toBeGreaterThan(90);
    expect(women).toBeLessThan(200);
    expect(seen.size).toBe(13);
  });
});
