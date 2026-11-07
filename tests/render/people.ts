// The mannequin's asset with the people (public/assets/people/) parsed onto it, as the game loads them (no textures).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dressedIndex, parseBodyAsset, parsePlayerAsset, PEOPLE, type PlayerAsset } from '../../src/render/avatar/asset.ts';
import { piecesFor, type Paint } from '../../src/render/avatar/paint.ts';

const gz = (path: string): ArrayBuffer => {
  const raw = gunzipSync(readFileSync(new URL('../../public/assets/' + path, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
};

/** The people generated with Meshy (data/people.json `guests`): not in PEOPLE, whose tests expect parts, hair cards and a face. */
export const GUESTS = ['meshy', 'meshy2', 'meshy3'];

export function guestAsset(name: string, base: PlayerAsset): PlayerAsset {
  return parseBodyAsset(gz(`people/${name}.bnz`), base);
}

export function mannequinWithPeople(): PlayerAsset {
  const base = parsePlayerAsset(gz('player.bnz'));
  for (const n of PEOPLE) base.people.push(parseBodyAsset(gz(`people/${n}.bnz`), base));
  return base;
}

/** A person's opaque triangles drawn as modelled (or in the cut `paint` chooses), the face's included (ids into its geometry): their wardrobe's other cuts are in the
 * buffers too (asset.ts Wardrobe), drawn only when chosen. */
export function drawnTriangles(p: PlayerAsset, paint?: Paint): number[] {
  const f = p.look!.face!, w = p.look!.wardrobe;
  const body = w ? dressedIndex(p, piecesFor(w, paint) ?? w.worn) : f.bodyIndex;
  return [...body, ...Array.from(f.index, (i) => f.verts[i]!)];
}
