/**
 * Simpler triangles for Low quality (lod.ts runs this in a worker; tests run it directly): meshoptimizer's simplifier over
 * an index buffer. Only triangles go: every vertex, with its skin weights, morph deltas and the material's attributes, stays
 * as it is, so a simplified index can be swapped into the same geometry and drawn by the same shader.
 */
import type { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export interface LodOpts {
  /** The furthest any surface may move, in metres (meshopt's absolute error: the shape's own units). */
  error: number;
  /** Stop at this share of the triangles even if the error allows fewer. */
  ratio: number;
}

/** A player's body and face (the hair's cards are left: collapsing a card loses its shape, not detail). */
export const PERSON_LOD: LodOpts = { error: 0.0025, ratio: 0.15 };
/** How much the check poses count beside the bind pose (lodPose.ts): at 8 no pose moves the surface 7 mm (at 4, 12.5 mm on a guest's
 * arms-up stance; tests/render/lod.test.ts). */
export const POSE_WEIGHT = 8;
/** Props seen from no nearer than the bench: their triangles were made for the close-up camera. */
export const PROP_LOD: LodOpts = { error: 0.002, ratio: 0.1 };

/**
 * `index` simplified (whole triangles of it, `index`'s own vertices) and the error it reached, in metres. Open edges are kept
 * where they are (a garment's hem over the skin, the face's edge on the neck), so nothing opens a gap. `groups`: ranges of
 * `index` simplified one by one (a multi-material mesh), returned as the new ranges.
 */
export function simplifyIndex(S: typeof MeshoptSimplifier, index: Uint32Array, positions: Float32Array, o: LodOpts,
  groups: Array<[number, number]> = [[0, index.length]], shape: ShapeAttributes | null = null): { index: Uint32Array; error: number; groups: Array<[number, number]> } {
  const parts: Uint32Array[] = [], out: Array<[number, number]> = [];
  let error = 0, at = 0;
  const weights = shape ? new Array<number>(shape.stride).fill(shape.weight ?? 1) : null;
  for (const [start, count] of groups) {
    const src = index.subarray(start, start + count);
    const target = Math.max(3, Math.floor((count / 3) * o.ratio) * 3);
    const [res, e] = count < 3 ? [src, 0]
      : shape ? S.simplifyWithAttributes(src, positions, 3, shape.data, shape.stride, weights!, null, target, o.error, ['LockBorder', 'Sparse', 'ErrorAbsolute'])
        : S.simplify(src, positions, 3, target, o.error, ['LockBorder', 'Sparse', 'ErrorAbsolute']);
    parts.push(res);
    out.push([at, res.length]);
    at += res.length;
    error = Math.max(error, e);
  }
  const all = new Uint32Array(at);
  for (let i = 0, k = 0; i < parts.length; k += parts[i]!.length, i++) all.set(parts[i]!, k);
  return { index: all, error, groups: out };
}

/** Per vertex, more places the simplifier keeps the shape at (lodPose.ts): `stride` floats a vertex, in metres. */
export interface ShapeAttributes { data: Float32Array; stride: number; weight?: number }

/**
 * Where each vertex goes in each check pose (`skins`: per pose, a skin matrix per bone, 16 floats column-major, lodPose.ts)
 * and with each set of morphs applied (`morphs`: per set, xyz deltas over the bind pose), as one row of xyz's a vertex.
 * Simplifying with these as attributes keeps a triangle out of any place it would cut across in one of them.
 */
export function shapeAttributes(positions: Float32Array, skinIndex: ArrayLike<number> | null, skinWeight: ArrayLike<number> | null,
  skins: Float32Array[], morphs: Float32Array[]): ShapeAttributes {
  const n = positions.length / 3, poses = skinIndex && skinWeight ? skins : [];
  const stride = 3 * (poses.length + morphs.length);
  const data = new Float32Array(n * stride);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    let o = v * stride;
    for (const m of poses) {
      let px = 0, py = 0, pz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight![v * 4 + k]!;
        if (w === 0) continue;
        const b = skinIndex![v * 4 + k]! * 16;
        px += w * (m[b]! * x + m[b + 4]! * y + m[b + 8]! * z + m[b + 12]!);
        py += w * (m[b + 1]! * x + m[b + 5]! * y + m[b + 9]! * z + m[b + 13]!);
        pz += w * (m[b + 2]! * x + m[b + 6]! * y + m[b + 10]! * z + m[b + 14]!);
      }
      data[o++] = px; data[o++] = py; data[o++] = pz;
    }
    for (const d of morphs) { data[o++] = x + d[v * 3]!; data[o++] = y + d[v * 3 + 1]!; data[o++] = z + d[v * 3 + 2]!; }
  }
  return { data, stride };
}

/** Pixels per metre at distance 1 for a camera with vertical field of view `fovDeg` drawing `heightPx` tall. */
export function pxPerMetreAt1(fovDeg: number, heightPx: number): number {
  return heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** Draw the simpler triangles while their error is under this many pixels; back to the full ones over LOD_PX_OFF. */
export const LOD_PX_ON = 0.5;
export const LOD_PX_OFF = 0.6;

/** Whether a shape whose simplified error is `error` m, `dist` m away, should draw its simpler triangles (`was`: drawn so last frame). */
export function lodWanted(error: number, dist: number, k: number, was: boolean): boolean {
  const px = (error * k) / Math.max(dist, 1e-3);
  return was ? px < LOD_PX_OFF : px < LOD_PX_ON;
}
