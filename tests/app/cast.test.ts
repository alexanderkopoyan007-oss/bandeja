import { describe, expect, it } from 'vitest';
import { dealCast } from '../../src/game/cast.ts';
import { dealNames } from '../../src/game/names.ts';

describe('who plays', () => {
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
