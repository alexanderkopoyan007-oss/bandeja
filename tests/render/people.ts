// The mannequin's asset with the people (public/assets/people/) parsed onto it, as the game loads them (no textures).
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
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

/** The MetaHuman people on this machine (their packs never leave it: no licence to ship them, so CI has none). */
export function metaHumansHere(base: PlayerAsset): PlayerAsset[] {
  return PEOPLE.map((n) => n + 'mh').filter((n) => existsSync(new URL('../../public/assets/people/' + n + '.bnz', import.meta.url)))
    .map((n) => parseBodyAsset(gz(`people/${n}.bnz`), base));
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

/**
 * How far a point is outside a surface of `p` (bind pose, or the positions `at`) made of the triangles `tris` (vertex ids, three
 * a triangle): the nearest point on them within 2 cm, and the distance along the normal there (the corners' normals blended),
 * negative inside. (A nearest vertex's normal gave false hits beside steep slopes.) The normals are the bind pose's: in the rest
 * pose the feet turn 2-4 degrees, which moves `along` by under a tenth of a millimetre at these distances.
 */
export function surfaceNear(p: PlayerAsset, tris: ArrayLike<number>, at?: THREE.BufferAttribute): (q: THREE.Vector3) => { d: number; along: number } {
  const pos = at ?? p.geometry.getAttribute('position'), nrm = p.geometry.getAttribute('normal');
  const cells = new Map<string, number[]>(), key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const P = (v: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(pos, v);
  for (let t = 0; t < tris.length; t += 3) {
    const seen = new Set<string>();
    for (let k = 0; k < 3; k++) {
      const v = tris[t + k]!, c = key(Math.floor(pos.getX(v) / 0.01), Math.floor(pos.getY(v) / 0.01), Math.floor(pos.getZ(v) / 0.01));
      if (seen.has(c)) continue;
      seen.add(c);
      let l = cells.get(c);
      if (!l) cells.set(c, (l = []));
      l.push(t);
    }
  }
  const tri = new THREE.Triangle(), cp = new THREE.Vector3(), bary = new THREE.Vector3(), n = new THREE.Vector3();
  return (q) => {
    const cx = Math.floor(q.x / 0.01), cy = Math.floor(q.y / 0.01), cz = Math.floor(q.z / 0.01);
    let bd = Infinity, along = Infinity;
    const done = new Set<number>();
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      for (const t of cells.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        if (done.has(t)) continue;
        done.add(t);
        const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
        tri.set(P(a), P(b), P(c));
        tri.closestPointToPoint(q, cp);
        const d = cp.distanceTo(q);
        if (d >= bd) continue;
        bd = d;
        tri.getBarycoord(cp, bary);
        n.set(0, 0, 0).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, a), bary.x)
          .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, b), bary.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, c), bary.z).normalize();
        along = q.clone().sub(cp).dot(n);
      }
    }
    return { d: bd, along };
  };
}
