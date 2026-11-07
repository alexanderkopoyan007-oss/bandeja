// M5 phase C step 5: both skirts and the polo's collar are built for every body (tools/assets/mpfb/person_kit.py make_skirt,
// make_collar), so any player can wear them. In the bind pose each skirt hangs clear of the legs and of the shorts worn under
// it (the tight pair, 'under', on a body modelled in loose shorts), below the shirt's hem, and its hem is under the shorts' own,
// so they never show beneath it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople, surfaceNear } from './people.ts';
import { dressedIndex } from '../../src/render/avatar/asset.ts';
import { piecesFor } from '../../src/render/avatar/paint.ts';

const people = mannequinWithPeople().people;
/** The tops and the collar: the skirt's top is tucked up inside the shirt (person_kit.py SKIRT_TUCK), so they're left out. */
const TOPS = new Set(['tee', 'tank', 'sleeveless', 'vneck', 'long', 'collar']);
/** Atlas v above which a skirt's texels are its lining (kit.ts SKIRT_OUT_V): the lining sits inside the cloth by design. */
const LINING_V = 0.236;

describe('skirts', () => {
  it('hang clear of the legs and the shorts under them, their hems under the shorts\'', () => {
    for (const p of people) for (const style of ['pleated', 'aline']) {
      const w = p.look!.wardrobe!, name = `${p.look!.name} ${style}`;
      const on = piecesFor(w, { bottom: style as 'pleated' | 'aline' }) ?? w.worn;
      expect(on, name).toContain(style);
      const base = p.look!.kit.bottom === 'shorts' ? 'under' : 'shorts';
      expect(on, name).toContain(base);
      const pos = p.geometry.getAttribute('position'), uv = p.geometry.getAttribute('uv');
      const skirt = w.pieces.indexOf(style), shorts = w.pieces.indexOf(base);
      const top = w.pieces.indexOf(on.find((x) => TOPS.has(x) && x !== 'collar')!);
      let shirtHem = Infinity, shortsHem = Infinity, skirtHem = Infinity;
      for (let v = 0; v < w.piece.length; v++) {
        const y = pos.getY(v);
        if (w.piece[v] === top) shirtHem = Math.min(shirtHem, y);
        else if (w.piece[v] === shorts) shortsHem = Math.min(shortsHem, y);
        else if (w.piece[v] === skirt) skirtHem = Math.min(skirtHem, y);
      }
      expect(skirtHem, `${name} hem under the shorts'`).toBeLessThan(shortsHem - 0.03);
      // What it goes over: the skin and the shorts as drawn with it (not the shirt it's tucked into).
      const idx = dressedIndex(p, on), under: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const c = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        if (c.every((v) => !TOPS.has(w.pieces[w.piece[v]!]!) && w.piece[v] !== skirt)) under.push(...c);
      }
      const near = surfaceNear(p, under), q = new THREE.Vector3();
      let worst = Infinity;
      for (let v = 0; v < w.piece.length; v++) {
        if (w.piece[v] !== skirt || uv.getY(v) > LINING_V || pos.getY(v) > shirtHem - 0.01) continue;
        const n = near(q.fromBufferAttribute(pos, v));
        if (n.d < 0.02) worst = Math.min(worst, n.along);
      }
      expect(worst, `${name} into the legs or the shorts`).toBeGreaterThan(-0.002);
    }
  });
});
