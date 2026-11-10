// Simplifies index buffers off the main thread for Low quality (lod.ts): a player's body is 11-30 ms of the simplifier,
// four times that on a slow laptop, which would otherwise land in the first load. The results are transferred, not copied.
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { shapeAttributes, simplifyIndex, type LodOpts } from './lodCore.ts';

/** A skinned shape's check poses and morphs (lodCore.ts shapeAttributes). */
export interface LodShape { skinIndex: ArrayLike<number> | null; skinWeight: ArrayLike<number> | null; skins: Float32Array[]; morphs: Float32Array[]; weight: number }
export interface LodJob { id: number; index: Uint32Array; positions: Float32Array; opts: LodOpts; groups?: Array<[number, number]>; shape?: LodShape }
export interface LodDone { id: number; index: Uint32Array; error: number; groups: Array<[number, number]> }

self.onmessage = async (ev: MessageEvent<LodJob>): Promise<void> => {
  await MeshoptSimplifier.ready;
  const j = ev.data;
  const sh = j.shape ? { ...shapeAttributes(j.positions, j.shape.skinIndex, j.shape.skinWeight, j.shape.skins, j.shape.morphs), weight: j.shape.weight } : null;
  const r = simplifyIndex(MeshoptSimplifier, j.index, j.positions, j.opts, j.groups, sh);
  const m: LodDone = { id: j.id, index: r.index, error: r.error, groups: r.groups };
  (self as unknown as Worker).postMessage(m, [r.index.buffer as ArrayBuffer]);
};
