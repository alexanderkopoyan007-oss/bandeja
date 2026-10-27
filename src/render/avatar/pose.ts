// Pose buffers and clip sampling for the avatars. Everything works in preallocated Float32Arrays, so animating
// four players allocates nothing per frame. Times and weights travel in the Pose's fields, not as arguments:
// V8 boxes a double passed to a function it doesn't inline (the same trap as in the sim).
import type { Clip } from './asset.ts';

/** Local rotation of every bone plus the hips' position. */
export class Pose {
  readonly q: Float32Array;
  readonly hips = new Float32Array(3);
  readonly bones: number;
  /** Input to sampleClip (s) / sampleCycle (phase 0..1). */
  t = 0;
  /** This pose's weight in accumulate(); on the accumulator, the total for normalize(). */
  w = 0;
  constructor(bones: number) {
    this.bones = bones;
    this.q = new Float32Array(bones * 4);
  }

  copy(o: Pose): void {
    this.q.set(o.q);
    this.hips.set(o.hips);
  }

  clear(): void {
    this.q.fill(0);
    this.hips.fill(0);
    this.w = 0;
  }
}

/**
 * Sample a clip at time out.t (s) into `out`. Loops wrap; one-shot clips hold their last frame. Frames are
 * normalised-lerped, which is what slerp comes to at 30 fps.
 */
export function sampleClip(c: Clip, out: Pose): void {
  const nb = out.bones;
  const t = out.t;
  let x: number;
  if (c.loop) {
    const d = c.duration;
    let u = t % d;
    if (u < 0) u += d;
    x = u * c.fps;
  } else {
    x = Math.min(Math.max(t, 0) * c.fps, c.frames - 1);
  }
  let f0 = Math.floor(x);
  if (f0 > c.frames - 2) f0 = c.frames - 2;
  const u = x - f0;
  const a = f0 * nb * 4;
  const b = a + nb * 4;
  const q = c.quat;
  const o = out.q;
  for (let k = 0; k < nb * 4; k += 4) {
    const x0 = q[a + k]! + (q[b + k]! - q[a + k]!) * u;
    const y0 = q[a + k + 1]! + (q[b + k + 1]! - q[a + k + 1]!) * u;
    const z0 = q[a + k + 2]! + (q[b + k + 2]! - q[a + k + 2]!) * u;
    const w0 = q[a + k + 3]! + (q[b + k + 3]! - q[a + k + 3]!) * u;
    const l = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
    o[k] = x0 * l; o[k + 1] = y0 * l; o[k + 2] = z0 * l; o[k + 3] = w0 * l;
  }
  const h = c.hips;
  for (let k = 0; k < 3; k++) out.hips[k] = h[f0 * 3 + k]! + (h[f0 * 3 + 3 + k]! - h[f0 * 3 + k]!) * u;
}

/** Loop clips sampled by phase (out.t, 0..1 of a cycle), re-phased so 0 is the left foot landing. */
export function sampleCycle(c: Clip, out: Pose): void {
  out.t = (out.t + c.phase0) * c.duration;
  sampleClip(c, out);
}

/**
 * acc += src.w * src. Each quaternion is flipped onto acc's hemisphere first (the first source added sets it).
 * acc.w keeps the total. Call normalize() once all sources are in.
 */
export function accumulate(acc: Pose, src: Pose): void {
  const w = src.w;
  if (w <= 0) return;
  acc.w += w;
  const a = acc.q;
  const s = src.q;
  for (let k = 0; k < a.length; k += 4) {
    const d = a[k]! * s[k]! + a[k + 1]! * s[k + 1]! + a[k + 2]! * s[k + 2]! + a[k + 3]! * s[k + 3]!;
    const ww = d < 0 ? -w : w;
    a[k] = a[k]! + s[k]! * ww;
    a[k + 1] = a[k + 1]! + s[k + 1]! * ww;
    a[k + 2] = a[k + 2]! + s[k + 2]! * ww;
    a[k + 3] = a[k + 3]! + s[k + 3]! * ww;
  }
  for (let k = 0; k < 3; k++) acc.hips[k] = acc.hips[k]! + src.hips[k]! * w;
}

/** Normalise accumulated quaternions; hips are divided by the total weight (acc.w). */
export function normalize(acc: Pose): void {
  const a = acc.q;
  const totalW = acc.w;
  for (let k = 0; k < a.length; k += 4) {
    const l = Math.sqrt(a[k]! * a[k]! + a[k + 1]! * a[k + 1]! + a[k + 2]! * a[k + 2]! + a[k + 3]! * a[k + 3]!);
    if (l < 1e-9) { a[k] = 0; a[k + 1] = 0; a[k + 2] = 0; a[k + 3] = 1; continue; }
    a[k] = a[k]! / l; a[k + 1] = a[k + 1]! / l; a[k + 2] = a[k + 2]! / l; a[k + 3] = a[k + 3]! / l;
  }
  if (totalW > 0) for (let k = 0; k < 3; k++) acc.hips[k] = acc.hips[k]! / totalW;
}

/** acc = nlerp(acc, src, src.w) for the bones where mask is set (an overlay on part of the body). */
export function blendMasked(acc: Pose, src: Pose, mask: Uint8Array): void {
  const u = src.w;
  if (u <= 0) return;
  const a = acc.q, b = src.q;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const k = i * 4;
    const d = a[k]! * b[k]! + a[k + 1]! * b[k + 1]! + a[k + 2]! * b[k + 2]! + a[k + 3]! * b[k + 3]!;
    const s = d < 0 ? -u : u;
    const x = a[k]! * (1 - u) + b[k]! * s;
    const y = a[k + 1]! * (1 - u) + b[k + 1]! * s;
    const z = a[k + 2]! * (1 - u) + b[k + 2]! * s;
    const w = a[k + 3]! * (1 - u) + b[k + 3]! * s;
    const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    a[k] = x * l; a[k + 1] = y * l; a[k + 2] = z * l; a[k + 3] = w * l;
  }
}
