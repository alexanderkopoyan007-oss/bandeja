import { describe, expect, it } from 'vitest';
import { dealCast } from '../../src/game/cast.ts';
import { dealNames } from '../../src/game/names.ts';

describe('who plays', () => {
  it('the generated people modelled with their arms out are dealt like everyone else, to matches of their own sex', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 400; seed++) {
      const c = dealCast(seed);
      for (const n of c.people) seen.add(n);
      expect(c.people.includes('meshy2') && !c.women).toBe(false);
      expect(c.people.includes('meshy3') && c.women).toBe(false);
    }
    expect(seen.has('meshy2') && seen.has('meshy3')).toBe(true);
    expect(seen.has('meshy')).toBe(false); // (his arms were modelled down: the sleeve is fused to his ribs)
  });

  it('naming a woman first makes it a match of women, a guest too', () => {
    expect(dealCast(1, ['meshy2', 'p7', 'p8', 'p9']).women).toBe(true);
    expect(dealCast(1, ['p7', 'p8', 'p9', 'p10']).women).toBe(true);
    expect(dealCast(1, ['meshy3', 'p2', 'p3', 'p4']).women).toBe(false);
  });

  it('a seed deals the same cast, names and kits, so a rematch that keeps the seed keeps everyone', () => {
    const a = dealCast(4242), b = dealCast(4242);
    expect(b).toEqual(a);
    expect(dealNames(4242, 4, b)).toEqual(dealNames(4242, 4, a));
  });

  it("a knock-out's next round keeps the player and partner and changes the opponents, men's and women's alike", () => {
    let changed = 0;
    for (let seed = 1; seed < 200; seed++) {
      const a = dealCast(seed), r = dealCast(seed, undefined, seed * 31 + 7);
      expect(r.people[0]).toBe(a.people[0]);
      expect(r.people[2]).toBe(a.people[2]);
      expect(r.women).toBe(a.women);
      expect(r.kits).toEqual(a.kits);
      expect(new Set(r.people).size).toBe(4);
      if (r.people[1] !== a.people[1] || r.people[3] !== a.people[3]) changed++;
    }
    expect(changed).toBeGreaterThan(100);
  });
});
