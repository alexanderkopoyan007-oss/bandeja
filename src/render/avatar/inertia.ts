// Inertialization for the animated body (Phase 3): the pose the animation asks for can jump (a stroke changes at
// the release, a plan moves the contact, the hips drop for a low ball and come back, the body turns to a ball that
// has passed it), and a jump drawn as it is shows as a pop. Each channel here keeps what was last shown: when its
// target moves faster in one frame than a person could move it, the jump goes into an offset (shown = offset +
// target), and the offset dies away with a critically damped spring that starts at the channel's own velocity, so
// the motion carries on smoothly into the new pose (Bollo 2016, "Inertialization: High-Performance Animation
// Transitions in Gears of War", GDC; Holden 2021, "Spring-It-On"). Moves within the limits pass through untouched.
// The avatar filters its inputs (the clip pose before IK, the stroke's key, the hips' drop and reach, the body's
// facing), not the IK's output: smoothing the solved legs or racket arm would lift the feet off their plants and
// the racket off the ball. Allocation-free per frame; values cross calls through fields (V8 boxes doubles).
import * as THREE from 'three/webgpu';

const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
/** Rotation-vector scratch. */
const RV = new Float64Array(3);
const LN2 = 0.6931471805599453;
/**
 * The frame's dt (s), set by the caller before stepping, and the parameters of the step under way: doubles passed
 * as arguments to a call V8 doesn't inline are boxed (garbage every frame), so they travel in these.
 */
export const INERT_DT = new Float64Array(1);
/** [halfLife, keep, limit] for decay / stepRotation. */
const PRM = new Float64Array(3);

/** RV = log(q) as a rotation vector (angle * axis, radians), short way round. */
function logQ(q: THREE.Quaternion): void {
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) { RV[0] = 2 * x; RV[1] = 2 * y; RV[2] = 2 * z; return; }
  const a = (2 * Math.atan2(s, w)) / s;
  RV[0] = x * a; RV[1] = y * a; RV[2] = z * a;
}

/** Quaternion scratch: `Quaternion.set` and `normalize` box their doubles when V8 doesn't inline them. */
const QE = new Float64Array(4);

/** q = exp(RV). */
function expQ(q: THREE.Quaternion): THREE.Quaternion {
  const x = RV[0]!, y = RV[1]!, z = RV[2]!;
  const a = Math.sqrt(x * x + y * y + z * z);
  if (a < 1e-9) {
    const l = Math.sqrt(0.25 * a * a + 1);
    QE[0] = (x * 0.5) / l; QE[1] = (y * 0.5) / l; QE[2] = (z * 0.5) / l; QE[3] = 1 / l;
  } else {
    const s = Math.sin(a * 0.5) / a;
    QE[0] = x * s; QE[1] = y * s; QE[2] = z * s; QE[3] = Math.cos(a * 0.5);
  }
  return q.fromArray(QE);
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Critically damped decay of x[k..k+n) (velocities v) towards 0, exact for a step INERT_DT (Holden's damper); PRM[0..1]. */
function decay(x: Float64Array, v: Float64Array, k: number, n: number): void {
  const dt = INERT_DT[0]!, keep = PRM[1]!;
  const y = (2 * LN2) / Math.max(1e-5, PRM[0]!);
  const e = Math.exp(-y * dt);
  for (let c = k; c < k + n; c++) {
    const j = v[c]! + x[c]! * y;
    x[c] = e * (x[c]! + j * dt) * keep;
    v[c] = e * (v[c]! - j * y * dt) * keep;
  }
}

/**
 * A vector channel (n = 1 scalar, 3 position): `in` the target, `out` what to show. `limit` in units/s; `keep`
 * scales the offset each step (1 normally; less to make it reach zero by a deadline, e.g. the racket by contact).
 */
export class InertN {
  readonly in: Float64Array;
  readonly out: Float64Array;
  private readonly prev: Float64Array;
  private readonly x: Float64Array;
  private readonly v: Float64Array;
  private readonly tv: Float64Array;
  private readonly n: number;
  private primed = false;
  limit: number;
  halfLife: number;
  /** Angles: differences are taken the short way round. */
  wrapAngle = false;
  keep = 1;
  jumps = 0;

  constructor(n: number, limit: number, halfLife = 0.07) {
    this.n = n;
    this.in = new Float64Array(n);
    this.out = new Float64Array(n);
    this.prev = new Float64Array(n);
    this.x = new Float64Array(n);
    this.v = new Float64Array(n);
    this.tv = new Float64Array(n);
    this.limit = limit;
    this.halfLife = halfLife;
  }

  reset(): void {
    this.primed = false;
  }

  /** One frame of INERT_DT. */
  step(): void {
    const dt = INERT_DT[0]!;
    const n = this.n;
    if (!this.primed || dt <= 0) {
      for (let c = 0; c < n; c++) { this.out[c] = this.in[c]!; this.prev[c] = this.in[c]!; this.x[c] = 0; this.v[c] = 0; this.tv[c] = 0; }
      if (dt > 0) this.primed = true;
      return;
    }
    let d2 = 0;
    for (let c = 0; c < n; c++) {
      const d = this.wrapAngle ? wrap(this.in[c]! - this.prev[c]!) : this.in[c]! - this.prev[c]!;
      d2 += d * d;
    }
    PRM[0] = this.halfLife; PRM[1] = this.keep;
    decay(this.x, this.v, 0, n);
    const jump = d2 > this.limit * this.limit * dt * dt;
    if (jump) this.jumps++;
    for (let c = 0; c < n; c++) {
      const d = this.wrapAngle ? wrap(this.in[c]! - this.prev[c]!) : this.in[c]! - this.prev[c]!;
      if (jump) {
        // Carry on from what was shown, at its own velocity; assume the target keeps its old velocity.
        const w = this.tv[c]! + this.v[c]!;
        const pred = this.out[c]! + w * dt;
        this.x[c] = this.wrapAngle ? wrap(pred - this.in[c]!) : pred - this.in[c]!;
        this.v[c] = w - this.tv[c]!;
      } else {
        this.tv[c] = d / dt;
      }
      this.prev[c] = this.in[c]!;
      this.out[c] = this.in[c]! + this.x[c]!;
    }
  }
}

/** One rotation channel: `in` the target, `out` what to show. `limit` in rad/s. */
export class InertQ {
  readonly in = new THREE.Quaternion();
  readonly out = new THREE.Quaternion();
  private readonly prev = new THREE.Quaternion();
  private readonly x = new Float64Array(3);
  private readonly v = new Float64Array(3);
  private readonly tv = new Float64Array(3);
  private primed = false;
  limit: number;
  halfLife: number;
  keep = 1;
  jumps = 0;

  constructor(limit: number, halfLife = 0.07) {
    this.limit = limit;
    this.halfLife = halfLife;
  }

  reset(): void {
    this.primed = false;
  }

  /** One frame of INERT_DT. */
  step(): void {
    const dt = INERT_DT[0]!;
    if (!this.primed || dt <= 0) {
      this.out.copy(this.in);
      this.prev.copy(this.in);
      this.x.fill(0); this.v.fill(0); this.tv.fill(0);
      if (dt > 0) this.primed = true;
      return;
    }
    PRM[0] = this.halfLife; PRM[1] = this.keep; PRM[2] = this.limit;
    stepRotation(this.in, this.prev, this.out, this.x, this.v, this.tv, 0);
    if (JUMPED[0] === 1) this.jumps++;
  }
}

const JUMPED = new Uint8Array(1);

/**
 * One rotation, in place of `target` -> `shown`: offsets x (rotation vector) with velocity v, target velocity tv, at
 * index k; PRM [halfLife, keep, limit], over INERT_DT. JUMPED[0] says whether this frame was a jump.
 */
function stepRotation(target: THREE.Quaternion, prev: THREE.Quaternion, shown: THREE.Quaternion,
  x: Float64Array, v: Float64Array, tv: Float64Array, k: number): void {
  const dt = INERT_DT[0]!, limit = PRM[2]!;
  // The target's move this frame (in the parent's frame: target = delta * prev).
  q1.copy(prev).invert().premultiply(target);
  logQ(q1);
  const dx = RV[0]!, dy = RV[1]!, dz = RV[2]!;
  const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
  prev.copy(target);
  decay(x, v, k, 3);
  JUMPED[0] = 0;
  if (step > limit * dt) {
    JUMPED[0] = 1;
    // Carry on from what was shown, at its own angular velocity, into the new target.
    const wx = tv[k]! + v[k]!, wy = tv[k + 1]! + v[k + 1]!, wz = tv[k + 2]! + v[k + 2]!;
    RV[0] = wx * dt; RV[1] = wy * dt; RV[2] = wz * dt;
    expQ(q2);
    q2.multiply(shown);
    const l = Math.sqrt(q2.x * q2.x + q2.y * q2.y + q2.z * q2.z + q2.w * q2.w);
    QE[0] = q2.x / l; QE[1] = q2.y / l; QE[2] = q2.z / l; QE[3] = q2.w / l;
    q2.fromArray(QE);
    // The offset that shows that: offset * target = predicted.
    q3.copy(target).invert().premultiply(q2);
    logQ(q3);
    x[k] = RV[0]!; x[k + 1] = RV[1]!; x[k + 2] = RV[2]!;
    v[k] = wx - tv[k]!; v[k + 1] = wy - tv[k + 1]!; v[k + 2] = wz - tv[k + 2]!;
  } else {
    tv[k] = dx / dt; tv[k + 1] = dy / dt; tv[k + 2] = dz / dt;
  }
  RV[0] = x[k]!; RV[1] = x[k + 1]!; RV[2] = x[k + 2]!;
  expQ(q1);
  shown.copy(target).premultiply(q1);
}

/** Every bone's local rotation (and the hips' position), in place: the clip pose before IK. */
export class Inertializer {
  /** Per joint: the limit (rad/s), the shown rotation last frame, the target last frame. */
  private readonly limit: Float64Array;
  private readonly shown: THREE.Quaternion[];
  private readonly prevTarget: THREE.Quaternion[];
  private readonly ox: Float64Array;
  private readonly ov: Float64Array;
  private readonly tv: Float64Array;
  private readonly hips: InertN;
  private primed = false;
  halfLife = 0.07;
  jumps = 0;
  /** Treat every joint as jumping on the next apply (a switch of clip whose small moves the limits would pass). */
  force = false;

  constructor(limits: ArrayLike<number>, hipLimit = 3.5) {
    const n = limits.length;
    this.limit = Float64Array.from(limits);
    this.shown = [];
    this.prevTarget = [];
    for (let i = 0; i < n; i++) { this.shown.push(new THREE.Quaternion()); this.prevTarget.push(new THREE.Quaternion()); }
    this.ox = new Float64Array(n * 3);
    this.ov = new Float64Array(n * 3);
    this.tv = new Float64Array(n * 3);
    this.hips = new InertN(3, hipLimit);
  }

  /** Forget the history (a cut: players placed for the next point). */
  reset(): void {
    this.primed = false;
    this.hips.reset();
  }

  /** `bones[i].quaternion` are the targets; they become what is shown. skip[i] = 1 leaves a joint alone. Over INERT_DT. */
  apply(bones: THREE.Bone[], hips: THREE.Vector3 | null, skip: Uint8Array): void {
    const dt = INERT_DT[0]!;
    const n = this.shown.length;
    if (!this.primed || dt <= 0) {
      for (let i = 0; i < n; i++) { this.shown[i]!.copy(bones[i]!.quaternion); this.prevTarget[i]!.copy(bones[i]!.quaternion); }
      this.ox.fill(0); this.ov.fill(0); this.tv.fill(0);
      if (dt > 0) this.primed = true;
    } else {
      for (let i = 0; i < n; i++) {
        if (skip[i] === 1) continue;
        PRM[0] = this.halfLife; PRM[1] = 1; PRM[2] = this.force ? 0 : this.limit[i]!;
        stepRotation(bones[i]!.quaternion, this.prevTarget[i]!, this.shown[i]!, this.ox, this.ov, this.tv, i * 3);
        if (JUMPED[0] === 1) this.jumps++;
        bones[i]!.quaternion.copy(this.shown[i]!);
      }
    }
    this.force = false;
    if (hips) {
      const h = this.hips;
      h.in[0] = hips.x; h.in[1] = hips.y; h.in[2] = hips.z;
      h.step();
      hips.x = h.out[0]!; hips.y = h.out[1]!; hips.z = h.out[2]!;
    }
  }
}
