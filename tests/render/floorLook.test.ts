// The floor option changes the picture as well as the bounce (REVIEW.md round 2 #15): `?floor=` gives the court
// that floor's look over the arena's (data/floor-looks.json); turf, or no floor, keeps the arena's own.
import { describe, expect, it } from 'vitest';
import { arenaDef, ARENA_KEYS } from '../../src/render/arena/arena.ts';
import { FLOOR_NAMES } from '../../src/audio/voices.ts';

describe('floor looks', () => {
  it('every arena keeps its own turf, and takes each other floor\'s look', () => {
    for (const a of ARENA_KEYS) {
      const own = arenaDef(a);
      expect(arenaDef(a, 'turf')).toBe(own);
      expect(arenaDef(a, undefined)).toBe(own);
      for (const f of FLOOR_NAMES) {
        if (f === 'turf') continue;
        const d = arenaDef(a, f);
        expect(d.floor.kind).toBe(f);
        // The rest of the arena is untouched, and the shared definition isn't changed.
        expect(d.surround).toBe(own.surround);
        expect(own.floor.kind).toBe('turf');
      }
    }
    expect(arenaDef('stadium', 'clay').floor.color).not.toBe(arenaDef('stadium').floor.color);
    // A hard court keeps the arena's colour (a blue hall is a blue hard court).
    expect(arenaDef('stadium', 'hard').floor.color).toBe(arenaDef('stadium').floor.color);
  });
});
