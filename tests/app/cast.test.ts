import { describe, expect, it } from 'vitest';
import { dealCast } from '../../src/game/cast.ts';
import { dealNames } from '../../src/game/names.ts';

describe('who plays', () => {
  it('the generated people are dealt first and each only once, one to a team, in matches of their own sex', () => {
    for (let seed = 1; seed < 400; seed++) {
      const c = dealCast(seed);
      expect(new Set(c.people).size).toBe(4);
      if (c.women) {
        expect(c.people[0]).toBe('meshy2');
        expect(c.people.includes('meshy') || c.people.includes('meshy3')).toBe(false);
      } else {
        expect([c.people[0], c.people[1]].sort()).toEqual(['meshy', 'meshy3']);
        expect(c.people.includes('meshy2')).toBe(false);
      }
    }
  });

  it('a person keeps one voice from match to match, and each style is on court in a men\'s match', () => {
    const voice = new Map<string, number>();
    for (let seed = 1; seed < 200; seed++) {
      const c = dealCast(seed);
      c.people.forEach((n, i) => {
        expect(c.voices[i]!).toBeGreaterThanOrEqual(c.women ? 4 : 0);
        expect(c.voices[i]!).toBeLessThan(c.women ? 8 : 4);
        expect(voice.get(n) ?? c.voices[i]).toBe(c.voices[i]);
        voice.set(n, c.voices[i]!);
      });
      if (!c.women) expect(new Set([c.voices[0]! % 2, c.voices[1]! % 2]).size).toBe(2);
    }
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
