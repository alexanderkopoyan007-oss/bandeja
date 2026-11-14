// M5 phase C step 5: both skirts and the polo's collar are built for every body (tools/assets/mpfb/person_kit.py make_skirt,
// make_collar), so any player can wear them. In the bind pose each skirt hangs clear of the legs and of the shorts worn under
// it (the tight pair, 'under', on a body modelled in loose shorts), below the shirt's hem, and its hem is under the shorts' own,
// so they never show beneath it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople, metaHumansHere, surfaceNear } from './people.ts';
import { dressedIndex } from '../../src/render/avatar/asset.ts';
import { piecesFor } from '../../src/render/avatar/paint.ts';

const base = mannequinWithPeople(), people = base.people;
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

  it('have folds in the cloth itself on the detailed builds: pleats that stand open at the hem, an A-line in flutes', () => {
    // (14 Nov 2026, the owner's list: "smooth near-black cones, painted pleats". The pleats were 5 mm steps and shut, the
    // A-line's folds two sine waves. person_kit.py skirt_mesh: a pleat's folded edge stands PLEAT_DEPTH out of the next one's
    // face at the hem, each its own share of it; an A-line has ALINE_FLUTES ridges of its own places and depths.)
    /** How many places round a ring of radii stand `least` or more out of the low points either side of them. */
    const ridges = (r: number[], least: number): number => {
      const n = r.length;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (r[i]! < r[(i + n - 1) % n]! || r[i]! <= r[(i + 1) % n]!) continue;
        const low = [1, -1].map((step) => {
          let m = r[i]!;
          for (let k = 1; k < n; k++) { const x = r[(i + k * step + n * k) % n]!; if (x > r[i]!) break; m = Math.min(m, x); }
          return m;
        });
        if (r[i]! - Math.max(low[0]!, low[1]!) >= least) count++;
      }
      return count;
    };
    for (const p of metaHumansHere(base)) for (const style of ['pleated', 'aline'] as const) {
      const w = p.look!.wardrobe!, skirt = w.pieces.indexOf(style), name = `${p.look!.name} ${style}`;
      const pos = p.geometry.getAttribute('position'), uv = p.geometry.getAttribute('uv');
      let hem = Infinity;
      for (let v = 0; v < w.piece.length; v++) if (w.piece[v] === skirt && uv.getY(v) <= LINING_V) hem = Math.min(hem, pos.getY(v));
      const ring: Array<[number, number]> = [];
      let cx = 0, cz = 0;
      for (let v = 0; v < w.piece.length; v++) if (w.piece[v] === skirt && uv.getY(v) <= LINING_V && pos.getY(v) < hem + 0.001) { ring.push([pos.getX(v), pos.getZ(v)]); cx += pos.getX(v); cz += pos.getZ(v); }
      cx /= ring.length; cz /= ring.length;
      const r = ring.map(([x, z]) => [Math.atan2(z - cz, x - cx), Math.hypot(x - cx, z - cz)] as [number, number]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      // (two thirds of the 34: each pleat has its own depth, 9-17 mm, over a ring that isn't round; the old shut 5 mm pleats
      // stood none this far out)
      if (style === 'pleated') expect(ridges(r, 0.007), `${name}: pleats standing 7 mm or more open at the hem`).toBeGreaterThanOrEqual(23);
      else expect(ridges(r, 0.012), `${name}: flutes 12 mm or more deep at the hem`).toBeGreaterThanOrEqual(6);
    }
  });
});
