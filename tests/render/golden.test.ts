// The golden club (DECISIONS.md "The golden club"): its data, the sky's half floats, and where its trees stand.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { arenaDef } from '../../src/render/arena/arena.ts';
import { half } from '../../src/render/arena/golden.ts';
import { palmSpots, treeSpots } from '../../src/render/arena/grove.ts';
import { playCameraOf } from '../../src/app/options.ts';
import audio from '../../data/audio.json' with { type: 'json' };

/** A half float's bits back to a number. */
function fromHalf(h: number): number {
  const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1;
  return s * (e ? 2 ** (e - 15) * (1 + m / 1024) : 2 ** -14 * (m / 1024));
}

describe('the golden club', () => {
  const def = arenaDef('club-golden');

  it('is its own arena with a photographed sky, its sun the key light', () => {
    expect(def.kind).toBe('outdoor');
    expect(def.hdri && existsSync(`public/${def.hdri.src}`)).toBe(true);
    const d = def.light.key.dir;
    expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo(1, 3);
    // the photograph's sun is 11.4 degrees up (hilly_terrain_01_puresky since round 5; tools/assets/golden/sky.py)
    expect((Math.asin(d[1]!) * 180) / Math.PI).toBeCloseTo(11.4, 1);
    for (const k of def.grove!.trees.kinds) for (const f of ['albedo', 'normal']) expect(existsSync(`public/assets/arena/golden/${k.name}-${f}.webp`)).toBe(true);
  });

  it('shows the photographed scene on the glass at its own level, not the shade\'s lifted one', () => {
    // (light.env lifts the ambient; a mirror at 3.2 laid a pale haze over everything seen through the glass)
    expect(def.light.env).toBeGreaterThan(1);
    expect(def.light.reflect).toBe(1);
  });

  it('has its own sound, not the stadium\'s', () => {
    expect((audio as unknown as { arenas: Record<string, unknown> }).arenas['club-golden']).toBeDefined();
  });

  it('encodes half floats to the nearest, carrying a round-up into the exponent', () => {
    for (const v of [1, 1.9999, 0.49999, 0.124999, 2.5, 0.0313, 0.1127, 3.7, 1000]) {
      expect(Math.abs(fromHalf(half(v)) - v) / v).toBeLessThan(1 / 1024);
    }
    expect(fromHalf(half(70000))).toBe(65504);
  });

  it('keeps the broadcast camera\'s way to the court clear of palms and trees', () => {
    const g = def.grove!;
    const court = { x: 5, z: 10 };
    for (const p of palmSpots(g.palms)) {
      expect(Math.abs(p.x) > court.x + 2 || p.z < -court.z - 2).toBe(true); // outside the cage
      expect(p.z).toBeLessThan(court.z); // none behind the near end
    }
    const trees = treeSpots(g.trees).flat();
    expect(trees.length).toBe(g.trees.count);
    for (const t of trees) {
      const inside = Math.abs(t.x) < g.trees.keepOut[0]! && t.z > -g.trees.keepOut[1]! && t.z < g.trees.keepOut[2]!;
      expect(inside).toBe(false);
    }
  });

  it('has shrubs in a bed along its wall, and a camera on the court by default (round 5)', () => {
    const g = def.grove!, sh = g.shrubs!, w = def.garden!.wall!;
    const all = treeSpots(g.trees, sh), plain = treeSpots(g.trees);
    // the wood's trees are where they were without the shrubs (their own random stream)
    for (let k = 0; k < plain.length; k++) expect(all[k]!.slice(0, plain[k]!.length)).toEqual(plain[k]);
    const shrubs = all.flatMap((l, k) => l.slice(plain[k]!.length));
    expect(shrubs.length).toBe(sh.count);
    const wallX = def.surround.x + 3 - w.inset - w.thick / 2, wallZ = def.surround.z + 3 - w.inset - w.thick / 2;
    for (const t of shrubs) {
      // outside the surround's turf, inside the wall, sunk under the ground
      expect(Math.abs(t.x) > def.surround.x || Math.abs(t.z) > def.surround.z).toBe(true);
      expect(Math.abs(t.x) <= wallX && Math.abs(t.z) <= wallZ).toBe(true);
      expect(t.y!).toBeLessThan(0);
    }
    expect(playCameraOf('club-golden', 'tv')).toBe('court');
    expect(playCameraOf('club-golden', 'side')).toBe('side'); // a camera the player chose stays
    expect(playCameraOf('club-day', 'tv')).toBe('tv');
  });
});
