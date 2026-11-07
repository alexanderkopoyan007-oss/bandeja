// Motion matching's library and search (docs/motion-plan.md, "Locomotion matching"). Every frame of a set of clips is
// described by the same few numbers as a query from the game: where the feet are from the hips and how fast they move,
// how fast the hips move, and the path 0.2, 0.4 and 0.6 s ahead with the facing along it, all in the body's own frame
// (+z ahead, +x its left, as the clips are drawn). The search returns the frame nearest a query (Clavet 2016,
// "Motion Matching and The Road to Next-Gen Animation"; Holden et al. 2020, "Learned Motion Matching").
//
// The sim stays the truth (motion plan, the rule): the query's path comes from where the sim is taking the player, and
// the library only chooses what the body does on the way. Building allocates (once per asset); searching doesn't.
import * as THREE from 'three/webgpu';
import type { Clip, PlayerAsset } from './asset.ts';

/** The path's sample times ahead (s). */
export const TRAJ_T = [0.2, 0.4, 0.6] as const;
/** Feature layout: feet from the hips (left x z, right x z), feet velocities (same), hips velocity (x z), the path's
 * points (x z at each TRAJ_T), the facing there (x z at each). */
export const F_FEET = 0, F_FEET_V = 4, F_HIPS_V = 8, F_TRAJ = 10, F_DIR = 16, FEATURES = 22;
/** How much each group counts against the others once each feature is scaled to unit spread. */
const GROUP_WEIGHT: Array<[number, number, number]> = [
  [F_FEET, F_FEET_V, 0.75],
  [F_FEET_V, F_HIPS_V, 1],
  [F_HIPS_V, F_TRAJ, 1.5],
  [F_TRAJ, F_DIR, 1],
  [F_DIR, FEATURES, 1],
];

export interface MatchSource {
  clip: Clip;
  /** Ground travel the clip was animated for in the body's frame (m/s): an in-place cycle's `speed` along (dirX, dirZ);
   * zero for a clip that moves its hips itself or stands. */
  vx: number;
  vz: number;
}

/** A source with the travel its clip was made for (an in-place locomotion cycle), or none. */
export function sourceOf(clip: Clip): MatchSource {
  const loco = clip.loop && clip.speed > 0;
  return { clip, vx: loco ? clip.speed * clip.dirX : 0, vz: loco ? clip.speed * clip.dirZ : 0 };
}

export class MatchDb {
  readonly sources: MatchSource[];
  /** Frames in the library, and for each its source and frame. */
  readonly n: number;
  readonly sourceOf: Uint16Array;
  readonly frameOf: Uint16Array;
  /** n x FEATURES, already scaled: (raw - mean) / spread x weight. */
  readonly feat: Float32Array;
  readonly mean = new Float32Array(FEATURES);
  /** weight / spread per feature: a raw query becomes (raw - mean) x this. */
  readonly scale = new Float32Array(FEATURES);
  /** The last search's scaled query (kept so a search allocates nothing). */
  private readonly qs = new Float32Array(FEATURES);

  constructor(asset: PlayerAsset, sources: MatchSource[]) {
    this.sources = sources;
    const lf = asset.bone('LeftFoot'), rf = asset.bone('RightFoot');
    let n = 0;
    for (const s of sources) n += s.clip.frames - (s.clip.loop ? 1 : 0);
    this.n = n;
    this.sourceOf = new Uint16Array(n);
    this.frameOf = new Uint16Array(n);
    const raw = new Float32Array(n * FEATURES);
    let row = 0;
    for (let si = 0; si < sources.length; si++) {
      const s = sources[si]!;
      const c = s.clip;
      const frames = c.frames - (c.loop ? 1 : 0);
      // Feet and hips of every frame from the hips, by forward kinematics on this asset's skeleton.
      const feet = new Float32Array(frames * 4), hips = new Float32Array(frames * 2);
      for (let f = 0; f < frames; f++) {
        footPositions(asset, c, f, lf, rf, feet, f * 4);
        hips[f * 2] = c.hips[f * 3]!;
        hips[f * 2 + 1] = c.hips[f * 3 + 2]!;
      }
      const at = (f: number): number => (c.loop ? ((f % frames) + frames) % frames : Math.min(Math.max(f, 0), frames - 1));
      for (let f = 0; f < frames; f++) {
        const o = row * FEATURES;
        const prev = at(f - 1), next = at(f + 1), span = (next - prev || 1) / c.fps;
        // The hips' ground velocity: the clip's own hip travel plus the ground it was made to cover.
        const hvx = (hips[next * 2]! - hips[prev * 2]!) / span + s.vx;
        const hvz = (hips[next * 2 + 1]! - hips[prev * 2 + 1]!) / span + s.vz;
        for (let k = 0; k < 4; k++) {
          raw[o + F_FEET + k] = feet[f * 4 + k]!;
          // A foot's ground velocity: its own move from the hips, plus the hips'.
          raw[o + F_FEET_V + k] = (feet[next * 4 + k]! - feet[prev * 4 + k]!) / span + (k % 2 === 0 ? hvx : hvz);
        }
        raw[o + F_HIPS_V] = hvx;
        raw[o + F_HIPS_V + 1] = hvz;
        for (let j = 0; j < TRAJ_T.length; j++) {
          // Ahead along the clip: its own hip travel and the ground it covers. A one-shot clip ends where it ends.
          const ft = f + TRAJ_T[j]! * c.fps;
          const fa = c.loop ? ft : Math.min(ft, frames - 1);
          const fl = at(Math.floor(fa));
          // (a loop's hips come back to where they began each cycle: its travel is all in vx, vz)
          raw[o + F_TRAJ + j * 2] = hips[fl * 2]! - hips[f * 2]! + s.vx * TRAJ_T[j]!;
          raw[o + F_TRAJ + j * 2 + 1] = hips[fl * 2 + 1]! - hips[f * 2 + 1]! + s.vz * TRAJ_T[j]!;
          // The clips keep facing +z.
          raw[o + F_DIR + j * 2] = 0;
          raw[o + F_DIR + j * 2 + 1] = 1;
        }
        this.sourceOf[row] = si;
        this.frameOf[row] = f;
        row++;
      }
    }
    // Each feature to unit spread, its group weighted; a feature that never varies counts by its group's weight alone.
    for (let k = 0; k < FEATURES; k++) {
      let m = 0;
      for (let r = 0; r < n; r++) m += raw[r * FEATURES + k]!;
      m /= Math.max(n, 1);
      let v = 0;
      for (let r = 0; r < n; r++) v += (raw[r * FEATURES + k]! - m) ** 2;
      const sd = Math.sqrt(v / Math.max(n, 1));
      const g = GROUP_WEIGHT.find(([a, b]) => k >= a && k < b)![2];
      this.mean[k] = m;
      this.scale[k] = g / Math.max(sd, 0.05);
    }
    this.feat = new Float32Array(n * FEATURES);
    for (let r = 0; r < n; r++) for (let k = 0; k < FEATURES; k++) this.feat[r * FEATURES + k] = (raw[r * FEATURES + k]! - this.mean[k]!) * this.scale[k]!;
  }

  /** Squared distance of library row `r` from the last query given to `search` (scaled). */
  cost(r: number): number {
    let d = 0;
    const o = r * FEATURES, q = this.qs, x = this.feat;
    for (let k = 0; k < FEATURES; k++) { const e = x[o + k]! - q[k]!; d += e * e; }
    return d;
  }

  /**
   * The library row nearest `query` (raw features, FEATURES long). `keep`: the row playing now, or -1; it wins over a
   * better one unless that one is nearer by more than `slack` (squared scaled distance), so near-ties don't flicker
   * between clips. (A share of the best cost doesn't do: a query the library matches well has a best cost near 0.)
   */
  search(query: Float32Array, keep = -1, slack = 0.5): number {
    const q = this.qs, x = this.feat, n = this.n;
    for (let k = 0; k < FEATURES; k++) q[k] = (query[k]! - this.mean[k]!) * this.scale[k]!;
    // (the distance written out in the loop, not through cost(): a double returned from a call V8 doesn't inline is
    // a heap number, and this runs over every frame of the library)
    let best = -1, bestD = Infinity, keepD = Infinity;
    for (let r = 0; r < n; r++) {
      let d = 0;
      const o = r * FEATURES;
      for (let k = 0; k < FEATURES; k++) { const e = x[o + k]! - q[k]!; d += e * e; }
      if (r === keep) keepD = d;
      if (d < bestD) { bestD = d; best = r; }
    }
    return keep >= 0 && keepD <= bestD + slack ? keep : best;
  }
}

const M = Array.from({ length: 128 }, () => new THREE.Matrix4());
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3(1, 1, 1);

/** The feet's ankles from the hips (x, z in the body's frame) at a clip's frame `f`, into out[o..o+4). Build time only. */
function footPositions(asset: PlayerAsset, c: Clip, f: number, lf: number, rf: number, out: Float32Array, o: number): void {
  const nb = asset.bones.length;
  const world = nb <= M.length ? M : Array.from({ length: nb }, () => new THREE.Matrix4());
  for (let i = 0; i < nb; i++) {
    const b = asset.bones[i]!;
    Q.fromArray(c.quat, (f * nb + i) * 4);
    if (b.parent < 0) P.fromArray(c.hips, f * 3);
    else P.fromArray(b.pos);
    world[i]!.compose(P, Q, S);
    if (b.parent >= 0) world[i]!.premultiply(world[b.parent]!);
  }
  const hx = c.hips[f * 3]!, hz = c.hips[f * 3 + 2]!;
  P.setFromMatrixPosition(world[lf]!);
  out[o] = P.x - hx; out[o + 1] = P.z - hz;
  P.setFromMatrixPosition(world[rf]!);
  out[o + 2] = P.x - hx; out[o + 3] = P.z - hz;
}
