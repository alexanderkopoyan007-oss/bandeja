// M5 phase D: a player's own racket colours (render/avatar/racketDesign.ts) over a racket's own look, and the caches
// that draw them (racket.ts): the shape's geometry shared by every racket of a look, the print by its colours, the
// material by the print and the overgrip. The material used to be cached by the look's name alone, so a later player's
// overgrip on the same look never showed (9 Nov).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { makeRacketModel, RACKET_LOOKS, racketCacheSize, racketLookFor } from '../../src/render/avatar/racket.ts';
import { designed, designFrom, designKey, nearestPalette, RACKET_PALETTE, type RacketColours } from '../../src/render/avatar/racketDesign.ts';
import { checkedRacket, RACKET_IDS } from '../../src/app/character.ts';

const parts = (g: THREE.Object3D): { geo: THREE.BufferGeometry; mat: THREE.Material } => {
  const m = g.getObjectByName('racketNear') as THREE.Mesh;
  return { geo: m.geometry, mat: m.material as THREE.Material };
};

const MINE: RacketColours = {
  art: 'orbit', face: '#f2f2ef', a: '#d42a2a', b: '#1d2738', accent: '#f2d02c', frame: '#111214', grip: '#2547c8', finish: 'gloss', frameFinish: 'matte',
};

describe('the racket designer', () => {
  it('paints the racket and keeps what it is: shape, holes, weight and maker', () => {
    const base = racketLookFor(0, RACKET_IDS.find((id) => id !== 'standard'));
    expect(designed(base, null)).toBe(base);
    const own = designed(base, MINE);
    expect([own.name, own.maker, own.shape, own.throat, own.weight, own.balance, own.holes]).toEqual([base.name, base.maker, base.shape, base.throat, base.weight, base.balance, base.holes]);
    expect([own.art, own.colours.base, own.colours.a, own.colours.b, own.colours.accent, own.colours.frame]).toEqual(['orbit', '#f2f2ef', '#d42a2a', '#1d2738', '#f2d02c', '#111214']);
    expect([own.grip, own.tape, own.bumper.colour, own.finish, own.frameFinish]).toEqual(['#2547c8', '#f2d02c', '#111214', 'gloss', 'matte']);
    expect(own.bumper.span).toBe(base.bumper.span);
    // The print's words read on the face: dark on a white face, white on a dark one.
    expect(own.colours.text).toBe('#141516');
    expect(designed(base, { ...MINE, face: '#1d2738' }).colours.text).toBe('#f2f2ef');
    // Every value is in the key.
    const keys = new Set([designKey(MINE), ...(Object.keys(MINE) as Array<keyof RacketColours>).map((k) => designKey({ ...MINE, [k]: k === 'art' ? 'tide' : k.endsWith('inish') ? 'sand' : '#58a8e8' }))]);
    expect(keys.size).toBe(Object.keys(MINE).length + 1);
  });

  it('starts from the maker’s colours in the palette’s nearest, and stores only palette colours', () => {
    for (const id of RACKET_IDS) {
      const look = racketLookFor(0, id), d = designFrom(look);
      const hexes = RACKET_PALETTE.map((p) => p.hex);
      for (const k of ['face', 'a', 'b', 'accent', 'frame', 'grip'] as const) expect(hexes).toContain(d[k]);
      expect([d.art, d.finish, d.frameFinish]).toEqual([look.art, look.finish, look.frameFinish]);
      // (a design the character keeps: checked, nothing lost)
      expect(checkedRacket({ base: id, look: d }).look).toEqual(d);
    }
    // A palette colour is its own nearest; anything else goes to a palette colour (a code from elsewhere).
    for (const p of RACKET_PALETTE) expect(nearestPalette(p.hex)).toBe(p.hex);
    expect(nearestPalette('#ff0000')).toBe('#d42a2a');
    expect(checkedRacket({ base: 'standard', look: { ...MINE, face: '#fefefe' } }).look!.face).toBe('#f2f2ef');
  });

  it('caches by what each part depends on: geometry by shape, material by print and overgrip', () => {
    const look = RACKET_LOOKS[1]!;
    const plain = parts(makeRacketModel(look));
    const coral = parts(makeRacketModel({ ...look, grip: '#f06a5a' }));
    const coral2 = parts(makeRacketModel({ ...look, grip: '#f06a5a' }));
    // The overgrip shows: its own material (it was the first one built), the same geometry.
    expect(coral.mat).not.toBe(plain.mat);
    expect(coral2.mat).toBe(coral.mat);
    expect(coral.geo).toBe(plain.geo);
    const own = parts(makeRacketModel(designed(look, MINE)));
    expect(own.mat).not.toBe(plain.mat);
    expect(own.geo).toBe(plain.geo);
    expect(parts(makeRacketModel(designed(look, MINE))).mat).toBe(own.mat);
  });

  it('keeps the newest few designs and frees the rest (the creator makes one at each change)', () => {
    const look = RACKET_LOOKS[2]!;
    const first = parts(makeRacketModel(designed(look, { ...MINE, a: '#148f8a' }))).mat as THREE.Material & { rkHeadMap: THREE.Texture };
    let mat = 0, tex = 0;
    first.addEventListener('dispose', () => mat++);
    first.rkHeadMap.addEventListener('dispose', () => tex++);
    const before = racketCacheSize();
    for (const p of RACKET_PALETTE.slice(0, 10)) makeRacketModel(designed(look, { ...MINE, a: p.hex }));
    const after = racketCacheSize();
    expect(after.designs).toBe(4);
    expect(mat).toBe(1);
    expect(tex).toBe(1);
    // Bounded: ten more designs, at most the kept ones' prints and materials more than before.
    expect(after.prints - before.prints).toBeLessThanOrEqual(4);
    expect(after.materials - before.materials).toBeLessThanOrEqual(4);
    // A maker's look is never let go.
    expect(parts(makeRacketModel(look)).mat).toBe(parts(makeRacketModel(look)).mat);
  });
});
