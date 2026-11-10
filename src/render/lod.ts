/**
 * Low quality's simpler triangles (lodCore.ts), made in a worker (lodWorker.ts) while the match loads, and swapped in by
 * how large a shape is on screen. Without a worker (node, tests) nothing is simplified and everything draws in full.
 */
import * as THREE from 'three/webgpu';
import type { LodOpts } from './lodCore.ts';
import type { LodDone, LodJob, LodShape } from './lodWorker.ts';

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, (r: LodDone | null) => void>();

function lodWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<LodDone>): void => {
      const done = waiting.get(ev.data.id);
      waiting.delete(ev.data.id);
      done?.(ev.data);
    };
    worker.onerror = (): void => {
      // (it failed to start or threw: everything waiting, and everything after, draws in full)
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** A geometry's positions as plain xyz floats (the simplifier's input). */
export function positionsOf(g: THREE.BufferGeometry): Float32Array {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  if (p.array instanceof Float32Array && p.itemSize === 3 && !p.normalized && !(p as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute)
    return p.array.slice();
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { out[i * 3] = p.getX(i); out[i * 3 + 1] = p.getY(i); out[i * 3 + 2] = p.getZ(i); }
  return out;
}

/** `index` over `positions` simplified in the worker; null where there is no worker. */
export function simplifyOffThread(index: ArrayLike<number>, positions: Float32Array, opts: LodOpts, groups?: Array<[number, number]>, shape?: LodShape): Promise<LodDone | null> {
  const w = lodWorker();
  if (!w) return Promise.resolve(null);
  const id = nextId++;
  const job: LodJob = { id, index: Uint32Array.from(index), positions, opts, groups, shape };
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage(job, [job.index.buffer as ArrayBuffer, positions.buffer as ArrayBuffer]);
  });
}

/** A simplified index in the full one's array type (16-bit where the full one is). */
export function indexAttribute(a: Uint32Array, like: THREE.BufferAttribute): THREE.BufferAttribute {
  return new THREE.BufferAttribute(like.array instanceof Uint16Array ? Uint16Array.from(a) : a, 1);
}

const LOWER = new WeakMap<THREE.BufferGeometry, Promise<THREE.BufferGeometry | null>>();

/**
 * A static mesh drawn with simpler triangles from when they are made (Low quality's props: `opts` small enough that no
 * camera comes near enough to tell). The simpler geometry shares the full one's attributes and is made once per geometry.
 */
export async function lowerStatic(mesh: THREE.Mesh, opts: LodOpts): Promise<void> {
  const full = mesh.geometry;
  let p = LOWER.get(full);
  if (!p) {
    const index = full.index;
    const groups: Array<[number, number]> = full.groups.length ? full.groups.map((gr) => [gr.start, gr.count]) : index ? [[0, index.count]] : [];
    p = !index ? Promise.resolve(null) : simplifyOffThread(index.array, positionsOf(full), opts, groups).then((d) => {
      if (!d) return null;
      const g = new THREE.BufferGeometry();
      for (const k of Object.keys(full.attributes)) g.setAttribute(k, full.getAttribute(k));
      g.setIndex(indexAttribute(d.index, index));
      if (full.groups.length) d.groups.forEach(([start, count], i) => g.addGroup(start, count, full.groups[i]!.materialIndex));
      g.boundingSphere = full.boundingSphere;
      g.boundingBox = full.boundingBox;
      return g;
    });
    LOWER.set(full, p);
  }
  const g = await p;
  if (!g || mesh.geometry !== full) return;
  mesh.geometry = g;
  // (for tools/lod-check.mjs, which draws the full one beside it)
  mesh.userData.lodFull = full;
}

/** A skinned mesh's check poses (`skins`, lodPose.ts) and the sums of morph `sets` it has (by morph name), as a worker job carries them. */
export function shapeOf(g: THREE.BufferGeometry, skins: Float32Array[], morphNames: readonly string[], sets: readonly string[][], weight: number): LodShape {
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  const deltas = g.morphAttributes.position ?? [];
  const n = g.getAttribute('position').count, morphs: Float32Array[] = [];
  for (const set of sets) {
    const sum = new Float32Array(n * 3);
    let any = false;
    for (const name of set) {
      const d = deltas[morphNames.indexOf(name)];
      if (!d) continue;
      any = true;
      for (let i = 0; i < n * 3; i++) sum[i]! += (d.array as Float32Array)[i]!;
    }
    if (any) morphs.push(sum);
  }
  return { skinIndex: si ? (si.array as Uint16Array).slice() : null, skinWeight: sw ? (sw.array as Float32Array).slice() : null, skins, morphs, weight };
}
