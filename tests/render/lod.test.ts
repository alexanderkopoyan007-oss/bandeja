// Low quality's simpler triangles (src/render/lodCore.ts): how many go, how far the shape moves at rest and in play, and that no edge opens.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { MeshoptSimplifier as S } from 'meshoptimizer/simplifier';
import { dressedIndex, personMeshes, type PlayerAsset } from '../../src/render/avatar/asset.ts';
import { positionsOf, shapeOf } from '../../src/render/lod.ts';
import { lodWanted, LOD_PX_OFF, LOD_PX_ON, PERSON_LOD, POSE_WEIGHT, pxPerMetreAt1, shapeAttributes, simplifyIndex, type ShapeAttributes } from '../../src/render/lodCore.ts';
import { LOD_MORPHS, lodSkins } from '../../src/render/lodPose.ts';
import { mergeParts } from '../../src/render/geom.ts';
import { GUESTS, guestAsset, mannequinWithPeople } from './people.ts';

await S.ready;
const base = mannequinWithPeople();
const people: PlayerAsset[] = [...base.people, ...GUESTS.map((n) => guestAsset(n, base))];

/** Each place's number, the same for every index over these positions (vertices at one place are one vertex: a UV seam is not an open edge). */
const PLACES = new WeakMap<Float32Array, Map<string, number>>();
function placeOf(pos: Float32Array): (v: number) => number {
  let id = PLACES.get(pos);
  if (!id) PLACES.set(pos, (id = new Map()));
  const m = id;
  return (v) => {
    const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let i = m.get(k);
    if (i === undefined) m.set(k, (i = m.size));
    return i;
  };
}

/** Edges used by one triangle only (an open edge: a hem, the face's rim, a hole), as "lo,hi" by place. */
function openEdges(index: ArrayLike<number>, pos: Float32Array): Set<string> {
  const at = placeOf(pos);
  const n = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = at(index[t + e]!), b = at(index[t + ((e + 1) % 3)]!);
    if (a === b) continue;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c === 1).map(([k]) => k));
}

interface Part { what: string; index: ArrayLike<number>; pos: Float32Array; shape: ShapeAttributes; skins: Float32Array[] }

/** What the game simplifies for a person (Avatar.makeLod): the body as worn and the face, each with its check poses and morphs. */
function partsOf(p: PlayerAsset): Part[] {
  const m = personMeshes(p), w = p.look!.wardrobe, f = p.look!.face;
  const skins = lodSkins(p), out: Part[] = [];
  const geos: Array<[string, THREE.BufferGeometry, ArrayLike<number>]> = [['body', m.body, w ? dressedIndex(p, w.worn) : f ? f.bodyIndex : p.geometry.index!.array]];
  if (m.face) geos.push(['face', m.face, m.face.index!.array]);
  for (const [what, g, index] of geos) {
    const pos = positionsOf(g), sh = shapeOf(g, skins, p.look!.morphs, LOD_MORPHS, POSE_WEIGHT);
    out.push({ what, index, pos, skins, shape: { ...shapeAttributes(pos, sh.skinIndex, sh.skinWeight, sh.skins, sh.morphs), weight: sh.weight } });
  }
  return out;
}

/**
 * How far `from`'s surface (its vertices and its triangles' centres) lies from `to`'s, the vertices placed by `at`: sorted
 * distances (m), 5 cm where nothing of `to` is within reach.
 */
function surfaceGap(at: (v: number, out: THREE.Vector3) => THREE.Vector3, from: ArrayLike<number>, to: ArrayLike<number>): number[] {
  const C = 0.03, cells = new Map<string, number[]>(), A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), Q = new THREE.Vector3();
  const tri = new THREE.Triangle(), hit = new THREE.Vector3(), box = new THREE.Box3();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (let t = 0; t < to.length; t += 3) {
    box.setFromPoints([at(to[t]!, A), at(to[t + 1]!, B), at(to[t + 2]!, D)]);
    for (let x = Math.floor(box.min.x / C); x <= Math.floor(box.max.x / C); x++) for (let y = Math.floor(box.min.y / C); y <= Math.floor(box.max.y / C); y++)
      for (let z = Math.floor(box.min.z / C); z <= Math.floor(box.max.z / C); z++) {
        let l = cells.get(key(x, y, z));
        if (!l) cells.set(key(x, y, z), (l = []));
        l.push(t);
      }
  }
  const near = (q: THREE.Vector3): number => {
    let best = 0.05;
    const cx = Math.floor(q.x / C), cy = Math.floor(q.y / C), cz = Math.floor(q.z / C);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++)
      for (const t of cells.get(key(x, y, z)) ?? []) {
        tri.set(at(to[t]!, A), at(to[t + 1]!, B), at(to[t + 2]!, D));
        const dd = tri.closestPointToPoint(q, hit).distanceTo(q);
        // (a triangle a pose squeezes flat has no closest point: its corners stand in)
        best = Math.min(best, Number.isNaN(dd) ? Math.min(A.distanceTo(q), B.distanceTo(q), D.distanceTo(q)) : dd);
      }
    return best;
  };
  const d: number[] = [];
  for (const v of new Set(Array.from(from))) d.push(near(at(v, Q).clone()));
  for (let t = 0; t < from.length; t += 3) d.push(near(at(from[t]!, A).clone().add(at(from[t + 1]!, B)).add(at(from[t + 2]!, D)).multiplyScalar(1 / 3)));
  return d.sort((x, y) => x - y);
}

describe('simpler triangles for Low', () => {
  it('a player keeps under 30% of their body and face, within 2.5 mm at rest, edges where they were', () => {
    for (const p of people) for (const { what, index, pos, shape } of partsOf(p)) {
      const r = simplifyIndex(S, Uint32Array.from(index), pos, PERSON_LOD, undefined, shape);
      const label = `${p.look!.name} ${what}: ${index.length / 3} -> ${r.index.length / 3}, ${(r.error * 1000).toFixed(2)} mm`;
      expect(r.index.length / index.length, label).toBeLessThan(0.3);
      expect(r.error, label).toBeLessThanOrEqual(PERSON_LOD.error);
      // (only the full mesh's own vertices: skin weights, morphs and the material's attributes stay valid)
      const used = new Set(Array.from(index));
      expect(Array.from(r.index).every((v) => used.has(v)), label).toBe(true);
      // (no gap opens at a hem or the face's rim, and no hole appears)
      const before = openEdges(index, pos), after = openEdges(r.index, pos);
      expect([...after].filter((e) => !before.has(e)).length, label).toBe(0);
      expect([...before].filter((e) => !after.has(e)).length, label).toBe(0);
    }
  });

  it('in a lunge, a wide stance with the arms up and a crouch, no part of the surface moves 8 mm', () => {
    // (the T-pose alone let the thighs join at the crotch: a web between the legs in a stance. p1 and p7 kept the most
    // and the least of the men, meshy3 is a fused guest)
    for (const name of ['p1', 'p7', 'meshy3']) {
      const p = people.find((q) => q.look!.name === name);
      expect(p, name).toBeTruthy();
      const { index, pos, shape, skins } = partsOf(p!)[0]!;
      const r = simplifyIndex(S, Uint32Array.from(index), pos, PERSON_LOD, undefined, shape);
      for (let k = 0; k < skins.length; k++) {
        const at = (v: number, o: THREE.Vector3): THREE.Vector3 => o.fromArray(shape.data, v * shape.stride + k * 3);
        for (const [way, d] of [['full to simpler', surfaceGap(at, index, r.index)], ['simpler to full', surfaceGap(at, r.index, index)]] as const) {
          const p99 = d[Math.floor(d.length * 0.99)]!, max = d[d.length - 1]!;
          const label = `${name} pose ${k} ${way}: p99 ${(p99 * 1000).toFixed(1)} mm, max ${(max * 1000).toFixed(1)} mm`;
          expect(p99, label).toBeLessThan(0.0035);
          expect(max, label).toBeLessThan(0.008);
        }
      }
    }
  });

  it('a mesh of several materials is simplified part by part, each keeping its own range', () => {
    const a = new THREE.SphereGeometry(0.2, 64, 48), b = new THREE.TorusGeometry(0.3, 0.02, 24, 96);
    b.translate(0.6, 0, 0);
    const g = mergeParts([{ g: a, m: 0 }, { g: b, m: 1 }]);
    const groups = g.groups.map((gr): [number, number] => [gr.start, gr.count]);
    const r = simplifyIndex(S, Uint32Array.from(g.index!.array), positionsOf(g), { error: 0.002, ratio: 0.1 }, groups);
    expect(r.groups.length).toBe(groups.length);
    let at = 0;
    for (let i = 0; i < r.groups.length; i++) {
      const [start, count] = r.groups[i]!, [s0, c0] = groups[i]!;
      expect(start).toBe(at);
      expect(count).toBeLessThan(c0);
      at += count;
      // (every triangle from its own part's vertices)
      const own = new Set(Array.from(g.index!.array.slice(s0, s0 + c0)));
      expect(Array.from(r.index.slice(start, start + count)).every((v) => own.has(v))).toBe(true);
    }
    expect(at).toBe(r.index.length);
  });

  it('switches by size on screen, with room between the two ways', () => {
    const k = pxPerMetreAt1(26, 810); // (the broadcast lens, Low's 1080p at three quarters)
    // the far pair at 25 m and the near at 13 m draw simplified; a close-up a metre from the face does not
    expect(lodWanted(PERSON_LOD.error, 25, k, false)).toBe(true);
    expect(lodWanted(PERSON_LOD.error, 13, k, false)).toBe(true);
    expect(lodWanted(PERSON_LOD.error, 1, k, true)).toBe(false);
    // between the two thresholds it stays as it was
    const d = (PERSON_LOD.error * k) / ((LOD_PX_ON + LOD_PX_OFF) / 2);
    expect(lodWanted(PERSON_LOD.error, d, k, true)).toBe(true);
    expect(lodWanted(PERSON_LOD.error, d, k, false)).toBe(false);
  });
});
