// One player's body: the Y Bot skinned mesh, driven by blended Mixamo locomotion, with the strokes made in code
// (key poses in strokes.ts, reached with two-bone IK and timed so the racket meets the ball at the sim's contact
// moment) and the racket in the right hand. Reads the sim only. Allocation-free per frame.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../../sim/match.ts';
import { PH_DEAD, PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS, SETUP_HOLD } from '../../sim/match.ts';
import { routineHand, routineHeight, routineTime } from '../routine.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../../sim/player/player.ts';
import { MOD_POWER, MOD_PRECISION, SHOT_BANDEJA, SHOT_DRIVE, SHOT_DROP, SHOT_LOB, SHOT_SLICE, SHOT_SMASH, SHOT_TOPSPIN, SHOT_VIBORA } from '../../sim/contact/shots.ts';
import type { StandPlan } from '../../sim/player/positioning.ts';
import { STRETCH_DIVE, STRETCH_JUMP } from '../../sim/contact/windows.ts';
import { DT } from '../../sim/core/constants.ts';
import { dressedIndex, personMeshes, personOf, type Clip, type PlayerAsset } from './asset.ts';
import { FaceDriver, type FaceInput } from './face.ts';
import { Pose, accumulate, blendMasked, normalize, sampleClip, sampleCycle } from './pose.ts';
import { hingeIK, IK_BEND, IK_SOFT, IK_TURN, rotateWorld, setWorldQuat, twoBoneIK, worldQuat } from './ik.ts';
import { fitCapsules, RACKET_PTS } from './capsules.ts';
import { makeRacketModel, makeWristCord } from './racket.ts';
import { solveGrip, cupPalms } from './grip.ts';
import type { HingeLimb } from './ik.ts';
import { INERT_DT, Inertializer, InertN, InertQ } from './inertia.ts';
import { Matcher, WARP_REACH } from './matcher.ts';
import { fitSoles, type SolePoint } from './soles.ts';
import { applySelf, kitMaterial, personMaterial, type KitLook, type KitState, type SelfLook } from './kit.ts';
import type { Dressing, Piece } from './costume.ts';
import { indexAttribute, positionsOf, shapeOf, simplifyOffThread } from '../lod.ts';
import { lodWanted, PERSON_LOD, POSE_WEIGHT } from '../lodCore.ts';
import { LOD_MORPHS, lodSkins } from '../lodPose.ts';
import { piecesFor, type Paint } from './paint.ts';
import MANNERS from '../../../data/manners.json' with { type: 'json' };
import { type OverArm,
  BACKHAND, TRIUMPH, TRIUMPH_LEFT, FIST, FIST_LEFT, HIP, HIP_LEFT, BH_CHIQUITA, BH_CONTRA, BH_DROP, BH_LOB, BH_SLICE, FH_CHIQUITA, FH_CONTRA, FH_DROP, FH_LOB, FH_SLICE, FOREHAND, OVERHEAD, READY, READY_LEFT, TAP, TAP_LEFT, HUG, HUG_LEFT, KNEES, KNEES_LEFT, CARRY, CARRY_LEFT, SERVE, SERVE_ADDRESS, SERVE_ADDRESS_LEFT, SERVE_TURN_SHARE, SMASH, VIBORA, VOLLEY_BH, VOLLEY_FH,
  leftFamily,
  rightFamily,
  type Family, type Key,
} from './strokes.ts';
import { TS, sampleTrack, type StrokeTrack } from './clipStroke.ts';

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const QUAT_ID = new THREE.Quaternion();
/** How far a raised arm goes behind the chest's plane (rad), the extra it has hanging low, and between what elevations. */
const ARM_BEHIND = 0.6;
const ARM_BEHIND_LOW = 1.1;
const ARM_LOW0 = 0.25;
const ARM_LOW1 = 0.6;
/** The soft edge of that limit (rad). */
const ARM_EDGE = 0.2;
/** The same limit on the racket arm's elbow (rad), which stays further forward. */
const ELBOW_BEHIND = 0.45;
/** How far the wrist goes off the forearm's line (rad), its soft edge, and how long (s) after the ball the limit comes back. */
const WRIST_MAX = 1.48;
const WRIST_EDGE = 0.3;
const WRIST_AFTER = 0.08;
/** A person's wrist (rad, as wrist.test.ts): flexion, extension, radial and ulnar deviation; held to it from HAND_SOFT of it, softly over HAND_EDGE. */
const HAND_FLEX = 1.31, HAND_EXT = 1.22, HAND_RADIAL = 0.35, HAND_ULNAR = 0.61, HAND_SOFT = 0.85, HAND_EDGE = 0.3;
/** How fast that limit moves the racket on the hand (rad/s). */
const WRIST_RATE = (720 * Math.PI) / 180;
/** How strongly the racket's line picks the elbow's side against the key's pole (see elbowBehindRacket). */
const ELBOW_SHAFT = 3;
/** Where an overhead's follow-through goes on the way (m along each): through the ball, then down. */
const OVER_WAY = new THREE.Vector3(0, 0.12, 1).normalize();
const OVER_DOWN = new THREE.Vector3(0, -1, 0.1).normalize();
const OVER_ON = 0.38;
/** A human's planned moment follows the ring with this time constant (s); a change of this much (s) is another ball's moment. */
const RING_TAU = 0.1;
const RING_JUMP = 0.2;
/** How far out from the body a swing drawn by the hand bows (m): the straight way from the back to the ball passes the shoulder. */
const BY_HAND_OUT = 0.14;
/** The arm OverArm's curves are drawn for (m), when the chest's curves start giving way to the ball (progress), the trunk's ease (s). */
/** How long the mouth stays with a grunt (s): the clipped voice's is 0.1-0.2, the long one's 0.26-0.56. */
const GRUNT_MOUTH = 0.65; // the held grunt lasts up to about 0.65 s (voices.ts GRUNT_LONG)
/** How far through a follow-through (Family.way) the racket is at its way round. */
const WAY_AT = 0.45;
/** The hand goes through the ball first, then to its chest-frame place (OverArm.under) over these times after it (s). */
const OVER_AFTER0 = 0, OVER_AFTER1 = 0.3;
const OVER_ARM = 0.56;
/** Of the speed the hand brings to a serve's ball, how much carries on past it, the time that takes to spend (s), and when the path has it back. */
const THROUGH_CARRY = 0.6, THROUGH_TIME = 0.04, THROUGH_FROM = 0.02, THROUGH_TO = 0.18;
/** How fast a late release shortens an overhead's way to the ball (s). */
const LAG_EASE = 0.11;
const OVER_TO_BALL = 0.72;
/** Where the racket's turn starts going over to the contact's (of the swing). */
const OVER_TURN_FROM = 0.3;
const OVER_TILT_EASE = 0.05;
/** How much of the cartwheel the neck takes back: the eyes stay on the ball. */
const OVER_NECK = 0.6;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Quadratic Bézier a -> b with the control point c. */

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

/**
 * The way a limb bends in the pose as it is (before IK): from the line root -> end out to the middle joint, as a
 * unit vector into `out`, with a little of `fx, fz` (forward) so a straight limb still has a side to bend to.
 * A pole there keeps the IK's elbow or knee where the animation had it: switching the IK on or off doesn't snap it.
 */
function bendDir(a: THREE.Bone, m: THREE.Bone, e: THREE.Bone, fwd: THREE.Vector3, out: THREE.Vector3): void {
  const fx = fwd.x, fy = fwd.y, fz = fwd.z;
  const A = a.matrixWorld.elements, M = m.matrixWorld.elements, E = e.matrixWorld.elements;
  const lx = E[12]! - A[12]!, ly = E[13]! - A[13]!, lz = E[14]! - A[14]!;
  const mx = M[12]! - A[12]!, my = M[13]! - A[13]!, mz = M[14]! - A[14]!;
  const ll = lx * lx + ly * ly + lz * lz;
  const t = ll > 1e-9 ? (mx * lx + my * ly + mz * lz) / ll : 0;
  let bx = mx - lx * t + fx * 0.004, by = my - ly * t + fy * 0.004, bz = mz - lz * t + fz * 0.004;
  const bl = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bl < 1e-9) { bx = fx; by = fy; bz = fz; } else { bx /= bl; by /= bl; bz /= bl; }
  out.x = bx; out.y = by; out.z = bz;
}
const bendL = new THREE.Vector3();
const bendR = new THREE.Vector3();
const bendA = new THREE.Vector3();
const bendF = new THREE.Vector3();
/** bendDir's forward hint (a vector: doubles passed to a call that isn't inlined are boxed). */
const bendFwd = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Blend weight for lerpV / nlerpQ, in a field: V8 boxes a double passed to a call it doesn't inline. */
const BL = { u: 0 };

/** Quaternion scratch for blendTo (Quaternion.set boxes its doubles when V8 doesn't inline it). */
const QB4 = new Float64Array(4);

/** q = normalised lerp from `from` to q by BL.u, the short way (a fade between two near poses). */
function blendTo(q: THREE.Quaternion, from: THREE.Quaternion): void {
  const u = BL.u, d = from.x * q.x + from.y * q.y + from.z * q.z + from.w * q.w;
  const s = d < 0 ? -u : u, v = 1 - u;
  const x = from.x * v + q.x * s, y = from.y * v + q.y * s, z = from.z * v + q.z * s, w = from.w * v + q.w * s;
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  QB4[0] = x / l; QB4[1] = y / l; QB4[2] = z / l; QB4[3] = w / l;
  q.fromArray(QB4);
}

/** a = lerp(a, b, BL.u). */
function lerpV(a: THREE.Vector3, b: THREE.Vector3): void {
  const u = BL.u;
  a.x += (b.x - a.x) * u;
  a.y += (b.y - a.y) * u;
  a.z += (b.z - a.z) * u;
}

/** q, or -q (the same rotation), whichever is nearer `prev`; prev = the result. */
function alignQ(q: THREE.Quaternion, prev: THREE.Quaternion): void {
  if (q.x * prev.x + q.y * prev.y + q.z * prev.z + q.w * prev.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  prev.copy(q);
}

/**
 * a = nlerp(a, b, BL.u) (for blending poses, close enough to slerp). Two rotations can be blended either way round. The
 * way is the short one, unless the other is nearer last frame's (`prev`, the blend's own output, zero when there is none)
 * by more than a jump anyone would see. A fade runs u down from 1, where both ways start out alike: picked by nearness
 * alone, a third of the volleys' recoveries took the long way, 250 degrees for a turn of 110. Re-picked the short way
 * whenever b swung far, mid-blend, the racket turned over in a frame, and the wrist with it (60 cm at a left-hander's
 * overhead). Reset to the short way at fixed ends, a blend on the long way snapped back 7 degrees as it passed them.
 * Both inputs should be continuous from frame to frame (alignQ).
 */
/** q negated if that puts it nearer `ref` (the same rotation, kept on one side from frame to frame). */
function sideOf(q: THREE.Quaternion, ref: THREE.Quaternion): void {
  if (q.x * ref.x + q.y * ref.y + q.z * ref.z + q.w * ref.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
}

/** slerpAs's result on its way into the quaternion (a double passed to a call V8 doesn't inline is boxed). */
const QSL = new Float64Array(4);
/** out = a turned towards b by u, the way b's sign gives (Quaternion.slerp re-picks the short way). */
function slerpAs(a: THREE.Quaternion, b: THREE.Quaternion, u: number, out: THREE.Quaternion): void {
  const c = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let ka = 1 - u, kb = u;
  if (c < 0.9995 && c > -0.9995) {
    const th = Math.acos(c), sn = Math.sin(th);
    ka = Math.sin((1 - u) * th) / sn; kb = Math.sin(u * th) / sn;
  } else if (c <= -0.9995) kb = -u; // a full turn apart: the same rotation, so the short way is no jump
  const x = a.x * ka + b.x * kb, y = a.y * ka + b.y * kb, z = a.z * ka + b.z * kb, w = a.w * ka + b.w * kb;
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  if (l < 1e-9) { out.copy(b); return; }
  QSL[0] = x / l; QSL[1] = y / l; QSL[2] = z / l; QSL[3] = w / l;
  out.fromArray(QSL);
}

/** nlerpQ's result on its way into the quaternion (a double passed to a call V8 doesn't inline is boxed). */
const QN = new Float64Array(4);
/** How much nearer last frame the long way must be for a blend to stay on it (half-angle, rad: 4 degrees of the result). */
const WAY_JUMP = 0.035;
/** Out of `curve`, one value a dimension. */
const CURVE = new Float64Array(3);

/** Through `vals` (`dim` values a knot) at the knots, smooth at each of them (Catmull-Rom on uneven knots), into CURVE. */
function curve(knots: number[], vals: number[], dim: number, s: number): void {
  const n = knots.length;
  let i = 0;
  while (i < n - 2 && s > knots[i + 1]!) i++;
  const t0 = knots[i]!, t1 = knots[i + 1]!, h = t1 - t0, u = s <= t0 ? 0 : s >= t1 ? 1 : (s - t0) / h;
  const ip = i > 0 ? i - 1 : i, iq = i + 2 < n ? i + 2 : i + 1, tp = knots[ip]!, tq = knots[iq]!;
  const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
  for (let d = 0; d < dim; d++) {
    const a = vals[i * dim + d]!, b = vals[(i + 1) * dim + d]!, p = vals[ip * dim + d]!, q = vals[iq * dim + d]!;
    CURVE[d] = h00 * a + (h10 * (b - p) * h) / (t1 - tp) + h01 * b + (h11 * (q - a) * h) / (tq - t0);
  }
}

/** The rotation with these axes as its columns, by hand (see hingeIK). */
function basisQuat(xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, zx: number, zy: number, zz: number, out: THREE.Quaternion): void {
  const tr = xx + yy + zz;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1);
    out.w = 0.25 / k; out.x = (yz - zy) * k; out.y = (zx - xz) * k; out.z = (xy - yx) * k;
  } else if (xx > yy && xx > zz) {
    const k = 2 * Math.sqrt(1 + xx - yy - zz);
    out.w = (yz - zy) / k; out.x = 0.25 * k; out.y = (xy + yx) / k; out.z = (xz + zx) / k;
  } else if (yy > zz) {
    const k = 2 * Math.sqrt(1 + yy - xx - zz);
    out.w = (zx - xz) / k; out.x = (xy + yx) / k; out.y = 0.25 * k; out.z = (yz + zy) / k;
  } else {
    const k = 2 * Math.sqrt(1 + zz - xx - yy);
    out.w = (xy - yx) / k; out.x = (xz + zx) / k; out.y = (yz + zy) / k; out.z = 0.25 * k;
  }
}

function nlerpQ(a: THREE.Quaternion, b: THREE.Quaternion, prev: THREE.Quaternion): void {
  const u = BL.u, v = 1 - u;
  const x1 = a.x * v + b.x * u, y1 = a.y * v + b.y * u, z1 = a.z * v + b.z * u, w1 = a.w * v + b.w * u;
  const x2 = a.x * v - b.x * u, y2 = a.y * v - b.y * u, z2 = a.z * v - b.z * u, w2 = a.w * v - b.w * u;
  const l1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1 + w1 * w1), l2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2 + w2 * w2);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let plus: boolean;
  if (l1 < 1e-6 || l2 < 1e-6) plus = l1 >= l2;
  else if (prev.x * prev.x + prev.y * prev.y + prev.z * prev.z + prev.w * prev.w < 0.5) plus = dot >= 0;
  else {
    const c1 = Math.abs(x1 * prev.x + y1 * prev.y + z1 * prev.z + w1 * prev.w) / l1;
    const c2 = Math.abs(x2 * prev.x + y2 * prev.y + z2 * prev.z + w2 * prev.w) / l2;
    const t1 = Math.acos(c1 > 1 ? 1 : c1), t2 = Math.acos(c2 > 1 ? 1 : c2);
    plus = dot >= 0 ? t1 - t2 <= WAY_JUMP : t2 - t1 > WAY_JUMP;
  }
  // Two rotations far apart: the plain blend does most of the turn at the middle of the way, and the racket spun round
  // the wrist, 135 degrees in a tenth of a second after every backhand volley. This weighting turns it evenly.
  const c = (a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) * (plus ? 1 : -1);
  if (c < 0.9995 && c > -0.9995) {
    const th = Math.acos(c), su = Math.sin(u * th), sv = Math.sin(v * th), k = su + sv, g = su / k, h = (plus ? 1 : -1) * g, e = sv / k;
    const x = a.x * e + b.x * h, y = a.y * e + b.y * h, z = a.z * e + b.z * h, w = a.w * e + b.w * h;
    const l = Math.sqrt(x * x + y * y + z * z + w * w);
    QN[0] = x / l; QN[1] = y / l; QN[2] = z / l; QN[3] = w / l;
  } else if (plus) { QN[0] = x1 / l1; QN[1] = y1 / l1; QN[2] = z1 / l1; QN[3] = w1 / l1; } else { QN[0] = x2 / l2; QN[1] = y2 / l2; QN[2] = z2 / l2; QN[3] = w2 / l2; }
  a.fromArray(QN);
  prev.copy(a);
}

/** An arm's hinge, plus the way from its shoulder to the hand last frame (zero: none yet), for keepOff. */
type Elbow = HingeLimb & { dir: THREE.Vector3 };
/** How fast an elbow's side may swing round the shoulder-to-hand line (rad/s): the shoulder's rotation speed limit. */
const ELBOW_SIDE_RATE = (1500 * Math.PI) / 180;
/** The racket elbow's out of a stroke, and how long after the ball (s) the stroke's own pace lasts. */
const ELBOW_SIDE_CALM = (500 * Math.PI) / 180, ELBOW_SIDE_FAST_AFTER = 0.12;
/**
 * How fast an elbow may bend or straighten (rad/s): 1.8x the forearm's peak in a serve (LIMITS, 2050 deg/s), so
 * no swing comes near it and it stops only the jumps (80-99 degrees in a frame; at 1.25x a human's late serve met
 * the ball a frame later still).
 */
const ELBOW_BEND_RATE = (1.8 * 2050 * Math.PI) / 180;
/**
 * Cloth lag (kit.ts): spring stiffness (1/s², about 2 Hz, a shirt hem's swing) and damping (1/s, ζ ≈ 0.6) of the
 * point the hems follow, and the most they trail (m). Sweat: the time term and the distance term add; at the AI's
 * pace (about 4.4 km an hour of play, more than the 2 km/h Miralles 2025 measured for pros, since the AI shuffles more)
 * a shirt is soaked after about 40 minutes, a set. Dry at the start.
 */
const CLOTH_K = 160;
const CLOTH_C = 15;
const CLOTH_MAX = 0.05;
/**
 * Long hair's pendulum: the spring that holds it where the head carries it, per unit mass, for hair PONY_L0 long (1/s^2: about
 * 2.8 Hz), softer for longer hair as a pendulum's own swing is slower (k by L0 / length: 43 cm of hair about 1.3 Hz); its
 * damping against the head's own motion (a share of critical); the steps it is solved in (s); gravity (m/s^2); the furthest
 * the tip strays (a share of the hair's length: about 35 degrees); and how far it may come forwards in the body's frame, into
 * the back of the neck (m). At 120 and 0.8 a 9 cm ponytail spent most of play between 10 and 50 degrees off the head, half
 * its time at the cap, and its cards turned edge on.
 */
const PONY_K = 300;
const PONY_L0 = 0.1;
const PONY_ZETA = 0.3;
const PONY_H = 1 / 240;
const PONY_G = 9.81;
const PONY_MAX = 0.6;
const PONY_FWD = 0.01;
const SWEAT_T = 4800;
const SWEAT_M = 6000;

/**
 * An elbow's hinge, measured from the clips: the axis (forearm frame) of the forearm's turn from its rest rotation,
 * averaged over every clip frame bent more than 20 degrees (on the Y Bot it is the forearm's z, within a degree).
 * The knees stay on twoBoneIK (the clips turn the shin about 10 degrees off any one axis and run with the legs
 * nearly straight; solving them as hinges threw that away: tried twice, it tripled the pops and, on 2026-10-28,
 * raised them from 13.6 to 115 per player-minute over 24 seeds both ways), but turn about their measured hinge
 * before the shortest-arc remainder (`twoBoneIK`'s `hinge`).
 */
function elbowHinge(asset: PlayerAsset, name: string): Elbow {
  const bi = asset.bone(name);
  const rest = new THREE.Quaternion().fromArray(asset.bones[bi]!.quat);
  const inv = rest.clone().invert();
  const nb = asset.bones.length;
  const acc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (const cn of ['idle', 'jog', 'run', 'strafeLeft', 'runBack', 'strafeRight', 'celebrate', 'dejected']) {
    const c = asset.clip(cn);
    for (let f = 0; f < c.frames; f++) {
      const o = (f * nb + bi) * 4;
      q.set(c.quat[o]!, c.quat[o + 1]!, c.quat[o + 2]!, c.quat[o + 3]!).premultiply(inv);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const ang = 2 * Math.acos(Math.min(1, q.w));
      const s = Math.sqrt(Math.max(1e-12, 1 - q.w * q.w));
      if (ang > 0.35) acc.x += (q.x / s) * ang, acc.y += (q.y / s) * ang, acc.z += (q.z / s) * ang;
    }
  }
  if (acc.lengthSq() < 1e-9) acc.set(0, 0, name.startsWith('Right') ? -1 : 1);
  return { hinge: acc.normalize(), rest, side: new THREE.Vector3(), dir: new THREE.Vector3(), bend: new Float64Array(2) };
}

/**
 * Fastest an arm joint turns while its solve fades to the clip (rad/s): the two can be near 180 degrees apart (the
 * ready pose's racket up in front against the clip's hanging by the side), where the short way between them flips
 * from one side to the other: the upper arm and hand turned over 148 degrees in a frame. At this rate it takes
 * about a tenth of a second. (Keeping last frame's way round instead spun the arm the long way.)
 */
const FADE_TURN_RATE = (1500 * Math.PI) / 180;

/** The arms' soft zone at full reach (m; ik.ts IK_SOFT): at a target exactly at full reach the hand falls 1.5 cm short. */
const ARM_SOFT = 0.03;

/** The free arm's elbow hangs down and back. */
const OFF_POLE = new THREE.Vector3(0.5, 0.75, -0.3);
const OFF_POLE_LEFT = new THREE.Vector3(-0.5, 0.75, -0.3);

// Stroke timeline (render side).
const ST_NONE = 0;
const ST_PREP = 1;
const ST_SWING = 2;
const ST_FADE = 3;

/** How long the racket takes from the end of the backswing to the ball at least (s). A release closer to the
 * contact than this still shows a whole swing, arriving a little after the real contact. */
const MIN_SWING = 0.11;
const MIN_CAUGHT = 0.05;
/** How far past the ideal moment a human's serve is timed (s). With SERVE_STRIKE (sim) the rest of the swing fits in. */
const SERVE_LATE = 0.05;
/** The forward swing starts this long before the planned contact while the key is still held (s)... */
const LEAD = 0.16;
/** A stroke drawn by a clip's track (clipStroke.ts): by how far into the forward swing the clip's swing has been turned onto this
 * ball (a share of the swing), over how much of the follow-through it turns back to the clip's own, and how much of the clip's
 * trunk lean (sideways, forward) goes onto the spine over what the stance already has. */
const TRACK_BEND = 0.6;
const TRACK_UNBEND = 0.7;
/** The share of the arm's length a measured swing's hand may be from the shoulder before its racket is turned in (reachIn). */
const TRACK_ARM = 0.97;
/** The least of a track's lead a swing may have left when it is picked and still be drawn by it (pickFamily). */
const TRACK_RUSH = 0.6;
/** A measured swing is for a ball like its own (trackFits): no more than this turn about the shoulder from the clip's (rad),
 * between these shares of the clip's reach; and how much nearer than that (rad) a ball must be once the keyed stroke has it. */
const TRACK_FIT_TURN = 0.45;
const TRACK_FIT_NEAR = 0.8;
const TRACK_FIT_FAR = 1.2;
const TRACK_FIT_MARGIN = 0.1;
/** The fit is asked from this share of the swing's lead before the ball (just before the forward swing starts). */
const TRACK_FIT_FROM = 1.12;
const TRACK_TILT = 0.8;
const TRACK_BOW = 0.5;
/** In the air an overhead's lean is the whole body's, from the feet up: this share of it turns the pelvis about its own
 * middle and the legs with it, the rest bends the spine as on the floor. The pro's smash (yRiT052FmVw): the spine 30-44
 * degrees off upright all through, the hips' line rolled 11-35 of them, the legs out along the same line; with the
 * pelvis upright and the legs straight down under it the swing was an arm on a post. In by the jump's height. */
const TRACK_PELVIS = 0.55;
const TRACK_BOW_AIR = 0.85;
const TRACK_TILT_EASE = 0.02;
/** A track's elbow out of the trunk (elbowClear): the trunk's half width and half depth for the elbow's centre (m) and the
 * part of the hips-to-neck line it is kept out along; the turn's step and most (rad), how much shorter the other way
 * round must be to change to it, and how fast the turn comes in and goes (s). */
const TRACK_TRUNK_W = 0.175;
const TRACK_TRUNK_D = 0.125;
const TRACK_TRUNK_LO = 0.05;
const TRACK_TRUNK_HI = 1.0;
const TRACK_SWIVEL_STEP = 0.07;
const TRACK_SWIVEL_MAX = 2.6;
const TRACK_SWIVEL_KEEP = 0.5;
const TRACK_SWIVEL_IN = 0.02;
const TRACK_SWIVEL_OUT = 0.12;
const PELVIS_AIR0 = 0.02;
const PELVIS_AIR1 = 0.14;
/** ...and, the release being anyone's guess, runs this share of the swing behind it at full speed... */
const HOVER_BEHIND = 0.06;
/** ...only braking once the moment has gone by with no release, over this share (it never parks: see hover). */
const HOVER_EASE = 0.04;
/** Nearest a hand is put to its own shoulder, as a share of the arm's length (see keepOff). */
const ARM_MIN = 0.35;
/** Fastest the way from a shoulder to its hand may turn (rad/s; see keepOff). */
const REACH_TURN_RATE = 40;
/**
 * Lowest the hips bone goes (m, world): a deep lunge with the front thigh level, the hip joints about 0.5 m up
 * (knee height on the Y Bot).
 */
const HIP_FLOOR = 0.66;
/** The racket's points (its frame), flat. */
const RACKET_P = Float64Array.from(RACKET_PTS.flatMap((p) => [p.x, p.y, p.z]));
/**
 * How long a push of the racket out of the body takes to die away (s): taken anew every frame it turned the forearm
 * over in a frame whenever the deepest point moved to another capsule (pops), so the push builds at once and lets
 * go smoothly.
 */
const CLEAR_EASE = 0.08;
/** Most the racket is pushed out of the body (m): a backhand's backswing across the chest can't be cleared. */
const CLEAR_MAX = 0.2;
/** How far the racket is kept outside the torso's and head's capsules (m). */
const RACKET_CLEAR = 0.015;
/** Where along the forearm the body is checked (0 elbow, 1 wrist), and how far into a capsule its axis may go: an arm's
 * own thickness lies against the side, its axis 3-4 cm off the skin. */
const FOREARM_T = [0.35, 0.65, 1];
const FOREARM_ROOM = -0.03;
const FOREARM_AFTER = 0.25;
/** How far off a trunk capsule's surface the elbow's joint stays (m): the arm's own thickness, less the give of the flank and a capsule that is the body's median. */
const ELBOW_ROOM = 0.02;
/**
 * After the ball the racket elbow and forearm out of the trunk. The follow-through's keys are placed for the mannequin's 11 cm of chest, and on a person's 14 the
 * elbow finished on the sternum, 6-11 cm inside it: half the forehand slices, a third of the backhand volleys, a sixth of the lobs on the generated woman (review
 * round 28). Its circle round the shoulder-to-hand line had no clear place on a bandeja or a backhand volley and was 50-145 degrees round on a slice, so it is the hand
 * that goes out: by ELBOW_OUT_GAIN of the depth found on the arm as solved, no faster than ELBOW_OUT_RATE (m/s), the push let go over ELBOW_OUT_EASE (s).
 */
const ELBOW_OUT_GAIN = 1.5, ELBOW_OUT_RATE = 2.5, ELBOW_OUT_EASE = 0.15;
/** guardCaps' first ones, the pelvis and the chest: the trunk. */
const TRUNK_CAPS = 2;
/** Pelvis, chest and head capsules per asset (fitted once): bone pairs, and radii. */
const GUARD = new WeakMap<PlayerAsset, { bones: Int32Array; r: Float64Array }>();
function guardCaps(asset: PlayerAsset): { bones: Int32Array; r: Float64Array } {
  let g = GUARD.get(asset);
  if (!g) {
    const caps = fitCapsules(asset).filter((c) => c.name === 'pelvis' || c.name === 'chest' || c.name === 'head' || c.name === 'thighL' || c.name === 'thighR');
    g = { bones: Int32Array.from(caps.flatMap((c) => [c.ia, c.ib])), r: Float64Array.from(caps.map((c) => c.r)) };
    GUARD.set(asset, g);
  }
  return g;
}
/** How long the follow-through's share of the trunk's movement takes to let go when a new stroke starts (s). */
const FINISH_EASE = 0.15;
/**
 * The share of a low ball's shortfall the hips take by dropping; the rest is left to the upper body bending towards
 * it (SPINE_REACH, after the legs): taken by the hips alone every ball under 0.6 m was met in a full squat.
 */
const DOWN_SHARE = 0.22;
/** The same at a volley, played from the knees: at 0.22 the trunk bowed 39 degrees to a ball at 0.7 m, the arm long (elbow 33; 63 on video). */
const VOLLEY_DOWN = 0.55;
/** Time after the ball (s) that drop is let go over. */
const VOLLEY_UP = 0.3;
/** The share more for a ball just off the ground (under DOWN_LOW1 m, from DOWN_LOW0): a half-volley is got down to. */
const DOWN_LOW = 0.45;
const DOWN_LOW0 = 0.4, DOWN_LOW1 = 0.15;
/** Most the upper body bends from the spine's base towards a ball out of the arm's reach (rad). */
const SPINE_REACH = 0.75;
/**
 * Fastest that bend changes (rad/s): taken fresh each frame it flipped sides when the target passed under the
 * spine's base (a 52 degree jump of the lower back in a frame). Fast enough to follow a lunge for the ball: at 6 the
 * hand was still short of it at contact (contact distance p90 2.8 -> 4.5 cm over the animation army).
 */
const SPINE_REACH_RATE = 20;
/** The bend fades out as the target goes round behind the spine's base, where its way is undefined (rad). */
const SPINE_REACH_BACK0 = (140 * Math.PI) / 180, SPINE_REACH_BACK1 = (165 * Math.PI) / 180;
/** The share of the bend let go after the ball, over BEND_UP_T s. */
const BEND_UP = 0.7;
const BEND_UP_T = 0.3;
/** Fastest the hips come back up from a drop (m/s): standing up out of a lunge. */
const HIP_RISE = 1.5;
/** Fastest the hips drop (m/s): into a lunge, about 0.3 m in 0.15 s. */
const HIP_FALL = 2;
/**
 * The hips' height is a body's, not a key's (review round 33, #8: into a ground stroke they fell at 1.8 g at the median,
 * 3 g at p90; feet on the floor can't pull a body down faster than gravity). The height the pose wants is followed with
 * the hips' own speed: gaining speed downwards (or stopping a rise) at no more than FALL_G, braking a fall (or setting off
 * up) at no more than FALL_BRAKE, the legs pushing.
 */
const FALL_G = 0.85 * 9.81;
const FALL_BRAKE = 2 * 9.81;
/**
 * And planned from the contact: the hips are no higher than the stroke's height at the ball plus what a fall from rest
 * covers in the time left, FALL_PLAN t² (from FALL_EARLY s before the ball). A fall at FALL_G braked at FALL_BRAKE covers
 * 3.2 t²; this leaves the follower room to catch the curve from rest. The key's own drop comes in over the last 0.3 s, so
 * without the plan the hips set off late and fell at twice gravity, or (only limited) met the ball 12 cm above the pose.
 */
const FALL_PLAN = 2.6;
/** How long after the ball a stroke's fall is planned (s): the hips go on down into a lunge's finish. */
const FALL_AFTER = 0.2;
const FALL_EARLY = 0.03;
/** How fast what the follower leaves at the end of a stroke goes (rad/s, critically damped): put straight back, a low stroke's hips
 * left 7 cm under a rising pose jumped up in one frame 0.2 s after the ball, and the planted knee with them. */
const FALL_LET = 12;
/** Time before the contact (s) the hips start leaning towards it, and lean fully. */
const LEAN_FROM = 0.4;
const LEAN_FULL = 0.1;
/**
 * A key goes down a second before the ball, and turning early is right, but at the stroke's full weight from the press a
 * player ran that second stooped over a ball still metres away, the arm locked at the back key and both arms dead (trunk
 * 35 at -500 ms, the AI 11; head 1.33 m, free 1.43; review round 17, the biomechanist's #2). The stroke's share of the
 * body while the racket is carried, and the time before the ball (s) it starts to take the rest and has it (the hand is
 * at the end of the arm from about 0.6 of the share, so it has to come late: elbow 30-31 at -0.22 s on video; at 0.5 the
 * racket hung beside the hips, in and out of racketClear, a pop a stroke). No later than the groundstrokes' lead, or a
 * forward swing would start from a carried racket.
 */
const HOLD_CARRY = 0.3;
const HOLD_FAR = 0.45;
const HOLD_NEAR = 0.32;
/** Fastest that share changes (per second): a plan can jump when the ball hits something. */
const HOLD_RATE = 4;
/** Fastest the bends towards the ball come and go (per second): a held stroke dropped took them from none to all. */
const NEAR_RATE = 12;
/** Fastest the hips' reach towards the ball changes after the contact (m/s, over the feet): the follow-through moves
 * the key at racket speed, and a reach following it swung the hips 0.38 m in five frames, a foot turning 123° in one. */
const REACH_RATE = 2.5;
/** The same before the contact (m/s): a new plan's reach comes in over 0.1 s or so. */
const REACH_RATE_BEFORE = 4;
/** After a jump's ball and on landing (m/s): held to the ball and let go all at once, the hips lurched 2.7 m/s off the feet. */
const REACH_RATE_AIR = 0.6, REACH_RATE_LAND = 1.2;
/** Fastest the reach's speed rises after the contact (m/s²): to the limit in about a tenth of a second. */
const REACH_ACC = 25;
/** Nearest an ankle comes to its hip, as a share of the leg's length (a deep lunge's front leg is about 0.6). */
const LEG_FOLD = 0.55;
/** Lowest an ankle goes (m): the foot flat on the floor. */
const ANKLE_MIN = 0.08;
/** Fastest the racket turns (rad/s): 3600°/s, over a tennis forehand's racket at contact (about 1500°/s) and a
 * serve's; under it every stroke the QA has seen. */
const RACKET_TURN_RATE = (3600 * Math.PI) / 180;
/** Most the racket tips about the ball when the arm can't reach it (rad, tipRacket): past this the face no longer looks at the target. */
const TIP_MAX = 1;
/** How fast that tip's turn moves (rad/s): on top of the racket's own turn. */
const TIP_RATE = (1200 * Math.PI) / 180;
/** Fastest the body's turn away from a wall changes (rad/s). */
const WALL_YAW_RATE = 8;
/** Face centre to the top of the frame (m), and how close the frame comes to the floor when it tips. */
const RACKET_TOP = 0.17;
/**
 * The hand's height at a volley: most above the ball (m) and below it (the head up). Never over it: the head dropped 6 cm under the hand on
 * low forehand volleys, a tray by the hip, and the legs get a low ball, not the wrist.
 */
const HAND_OVER = 0;
const HAND_UNDER = 0.3;
const VOLLEY_ARM = 0.78;
/** The arm no longer than this share of itself on the way back to ready (see solveArms), eased over RECOVER_EASE s. */
const RECOVER_ARM = 0.85;
const RECOVER_EASE = 0.12;
/** How fast the arm comes to Family.after from the ball (s). */
const AFTER_EASE = 0.045;
const VOLLEY_BEND = 0.86;
const VOLLEY_BEND_RATE = 9;
const BACK_FOLLOW = 1;
/** A volley's take-back: this far back from the ball away from the net (m), and at least this far to the racket's side
 * of the feet and in front of them (m). */
const PUNCH_BACK = 0.3;
const PUNCH_SIDE = 0.22;
const PUNCH_FRONT = -0.05;
/** The ball this far below the volley's own contact height (m): the take-back's racket starts to drop, and has dropped. */
const BACK_DROP0 = 0, BACK_DROP1 = -0.3;
const BACK_LOW = -0.7;
const BACK_HIGH = 0.3;
const HAND_TO_BALL = 0.36;
const shaftTo = new THREE.Vector3();
const shaftFrom = new THREE.Vector3();
const shaftTurn = new THREE.Quaternion();
const RACKET_FLOOR = 0.02;
/** Fastest a shin twists about its own length (rad/s): 2400°/s, four times a fast pivot's 180° in 0.3 s. */
const SHIN_TWIST_RATE = (2400 * Math.PI) / 180;
/** limitShins' turn back about the shin (a double passed to a call V8 doesn't inline is boxed). */
const QS = new Float64Array(4);
const qFoot = new THREE.Quaternion();
const qWalk = new THREE.Quaternion();
const qWalk2 = new THREE.Quaternion();
const qWalk3 = new THREE.Quaternion();
/** Most the hips drop for a low or wide ball (crouch, lunge and reach together; m). */
const DROP_MAX = 0.55;
/** A dive's simple motion (stretchMotion): the hips' drop at the floor (m) and the time it takes to get back up (s). */
const DIVE_DROP = 0.3;
const DIVE_RISE = 0.35;
/**
 * The smash is hit in the air, both feet off before the contact (Espino et al. 2015 via
 * docs/research/serve-and-strokes-motion.md 4.2; contact 2.30-2.50 m at full reach): a ballistic hop peaking at the
 * contact, as high as the ball is above what the toes reach (JUMP_TOES), up to JUMP_MAX (no padel jump height is
 * published; a smash hop is well under a standing jump's 35-45 cm), landing on bent knees (LAND_DROP over LAND_TIME).
 * Standing on the toes only, smashes met at 2.4 m missed the ball by about 10 cm.
 */
const JUMP_MAX = 0.3;
/** The bandeja's and víbora's hop at most (m): the sim's reach for every overhead assumes the shoulder raised by
 * tuning.json reachJump (0.2 m), and on the toes alone a bandeja met 0.94 m out at 2.41 m missed by 34 cm. They are
 * played off a small push or a scissor kick, lower than the smash's. */
const JUMP_MAX_OH = 0.2;
const JUMP_TOES = 0.12;
/** The dip before a smash's take-off: how far the hips drop (m) and over how long (s). */
const JUMP_DIP = 0.15;
const JUMP_DIP_TIME = 0.34;
/** The scissor kick at a hop of SCISSOR_FULL m or more: the back foot's way back and up, the front foot's way forward. */
const SCISSOR_FULL = 0.15;
const SCISSOR_BACK = 0.3;
const SCISSOR_UP = 0.3;
const SCISSOR_FRONT = 0.22;
/** When the kick opens against the contact (s), and how far both feet come up under the hips in the air (m): 3 cm of a leg is 27 degrees at the knee. */
const SCISSOR_FROM = -0.04, SCISSOR_OPEN = 0.14, SCISSOR_TUCK = 0.03;
/** A bandeja's rear foot off the floor (m), when against the contact it goes, and when it comes down again (s). */
const REAR_OFF = 0.05, REAR_OFF_FROM = -0.08, REAR_OFF_AT = -0.01, REAR_OFF_LAND_FROM = 0.05, REAR_OFF_LAND_AT = 0.2;
/**
 * And before that it rolls up over its toes as the weight goes onto the front foot (rad, from REAR_ROLL_FROM to REAR_ROLL_AT s about the ball, down again
 * from REAR_DOWN_FROM to REAR_DOWN_AT). A flat lift hovered for half a second with the knee closing, and read as nothing (review round 29).
 */
const REAR_ROLL = 0.6, REAR_ROLL_FROM = -0.24, REAR_ROLL_AT = -0.03, REAR_DOWN_FROM = 0.1, REAR_DOWN_AT = 0.3;
/**
 * A drive's (and a slice's and a lob's) and the serve's rear foot the same, less far: the heel comes up as the weight goes onto the front foot
 * through the ball, and down in the finish (rad, s about the ball). The rear foot is the racket side's on a forehand and the serve, the other on a
 * backhand. It stayed flat, 2-7 degrees up at a drive, 0 at the serve (review round 32, #11; the serve's standard is
 * docs/research/serve-and-strokes-motion.md K5, a drive's from coaching text, no footage row).
 */
const DRIVES = /^(forehand|backhand)(-slice|-lob)?$/, DRIVE_ROLL_RATE = 3.5;
const DRIVE_ROLL = 0.35, SERVE_ROLL = 0.45, DRIVE_ROLL_FROM = -0.18, DRIVE_ROLL_AT = 0.02, DRIVE_DOWN_FROM = 0.2, DRIVE_DOWN_AT = 0.45;
/**
 * In the air the legs come in under the body: AIR_IN of the feet's width across the stance goes, and neither leg reaches past AIR_REACH of its length (1 -
 * cos(13.5), knees 27 on video). Left to a stance measured on the floor the feet stayed 0.52-0.65 m apart, and on a longer body the front knee locked at 2 degrees.
 */
const AIR_IN = 0.6, AIR_REACH = 0.9725, AIR_REAR_UP = 0.04;
/** ...and comes up this far, or that leg sits at its full length, a peg to the hip (2 degrees, 37 on video). */
const SCISSOR_FRONT_UP = 0.06;
const JUMP_HEIGHT = 1.8;
const JUMP_SHORT = 1.0;
const LAND_DROP = 0.06;
const LAND_TIME = 0.2;
const FOLLOW = 0.3;
const FOLLOW_N = 3;
/** The same for a stroke with an arm drawn in the chest's frame: a serve left the ball at 8 m/s from 13, and a cap of 3 is why. */
const FOLLOW_N_OVER = 4.5;
/**
 * The share of the follow-through's path taken at the speed it left the ball; the rest goes evenly over the whole of it. All of it at that speed had a fast arm at the
 * finish in 50-80 ms of 300-450, and the hand parked until the recovery, 220 ms on a volley, the serve's elbow flat from +0.18 s (video: folding on past +0.3 s).
 */
const FOLLOW_QUICK = 0.55;
/** A hip's range (solveLegs): how far round from the hips a foot (rad), and a knee, may point; how far outward a knee
 * sits off the hips (rad, or they brush each other). */
const FOOT_OFF_HIPS = (65 * Math.PI) / 180, KNEE_OFF_HIPS = (42 * Math.PI) / 180, KNEE_OUT = 0.14;
/** Fastest a foot turns off the hips (rad/s): over what the hips turn on a planted foot, under a flip from limit to limit. */
const FOOT_TURN_RATE = 20;
const HIP_OUT = 0.68, HIP_ACROSS = 0.36;
/**
 * A planted foot steps once its leg is this much of the way to the hip's range (HIP_OUT, HIP_ACROSS): at the range the leg's limit
 * moved the foot, and planted feet slid 130-170 cm/s on 3% of p8's planted frames as bodies turned over them. Standing and
 * walking only: in a run it took off the foot due next a little early, before the other was down, and pops rose by a tenth.
 */
const HIP_STEP = 0.9;
/**
 * A foot on the floor keeps its lowest sole point where it is (PIN_*): within PIN_ON of the floor, held to one point until another
 * is PIN_SWITCH lower, and let go (pinned again where it is) past PIN_MAX, which is a step's work, not a slide's. The run's roll
 * onto the ball turns about the floor under the toe joint, 3.4-4.7 cm under it, and the strokes' heel rolls about the ball: the
 * sole went along the floor 3-7 cm/s on a fifth of planted frames.
 */
const PIN_ON = 0.005;
const PIN_SWITCH = 0.003;
const PIN_MAX = 0.05;
/** How far under the hips the trunk's ellipse goes (of the hips to the neck). */
const TRUNK_BELOW = -0.08;
/** The most the ready position follows the chest round (rad). */
const READY_TURN_MAX = 1.6;
const READY_TURN_EASE = 0.09;
/** A run's free hand from its shoulder, in arm's lengths: out, up the trunk, forward, and its swing fore and aft. */
const RUN_HAND_OUT = 0.16, RUN_HAND_UP = -0.56, RUN_HAND_FWD = 0.22, RUN_HAND_SWING = 0.3;
/** And its elbow's pole, straight behind the shoulder and this far down (arm's lengths, for each one back). */
const RUN_POLE_DOWN = 0.3;
/** An ankle's range from flat on a square shin, up and pointed (rad). */
const ANKLE_UP = (34 * Math.PI) / 180, ANKLE_DOWN = (50 * Math.PI) / 180;
/** How far (m) a volley's way out bows on through the ball. */
const PUNCH_THROUGH = 0.08;
/** How long a held pose after a point lasts (s). */
const MOOD_TIME = 1.3;
/** How far a long follow-through's curve rises (m): a drive's hand comes up to the shoulder with the arm still long. */
const THROUGH_UP = 0.25;
const FADE = 0.35;
/**
 * Fastest the racket's way back to ready may turn at its peak (rad/s), and the longest that way may take (s): at a fixed
 * FADE, from a low finish to the head-up ready, the arm took the racket through 110-135 degrees in a tenth of a second,
 * the hardest movement of the whole volley, and after the ball.
 */
const FADE_TURN = (450 * Math.PI) / 180;
const FADE_MAX = 0.6;
const PREP = 0.28;
/**
 * A ball on the player before a full backswing fits (a reflex block of a smash taken 0.15 s after the reaction):
 * the backswing is cut to PREP_SHARE of the time left, at least PREP_MIN. At the full PREP the arm was only half
 * into the stroke at the contact and missed the ball by 40 cm.
 */
const PREP_SHARE = 0.6;
const PREP_MIN = 0.06;
/** Share of the shoulder turn taken by the whole body (the rest is the spine). */
const BODY_TURN = 0.35;
/**
 * Extra turn to the racket side for a ball taken off the back glass (rad): side-on as it goes past to the glass and
 * still side-on at the contact, beside the front foot (review round 3, the pro's #4: it used to ease off as the ball
 * came off the glass, so the shot was struck square to the net). Less on the backhand, whose stroke is side-on
 * already. It turns the hips and everything above them, not the stance the racket's keys are in, so the face still
 * goes where the shot goes. WALL_EASE: how fast it comes and goes (s).
 */
const WALL_TURN = 1.0;
const WALL_TURN_BH = 0.35;
/** Racket tap (racketTap): partners this close (m), for this long (s), turned this share of the way to each other. */
const TAP_NEAR = 1.3;
/** The end of a match: the embrace starts with the partner within HUG_NEAR m; the beaten bend over BOW_AFTER s after
 * match point, BOW_ANGLE rad down the spine. */
const HUG_NEAR = 0.85;
const BOW_AFTER = 1.1;
const BOW_ANGLE = 0.62;
const TAP_HOLD = 0.75;
/** How fast the body turns back from its own glass after a contrapared (rad/s): 180 degrees in 0.57 s, a pivot on the spot. */
const GLASS_BACK = 5.5;
/** How long a server takes to turn side-on into the address (s, eased in and out): 68 degrees at the hips, begun as they stand at their place. */
const ADDR_TURN_S = 1.2;
/** When into the tap the rackets touch (s; the pose is nine-tenths there), and at what height (m). */
const TAP_TOUCH = 0.3, TAP_TOUCH_Y = 1.3;
const TAP_TURN = 0.8;
/**
 * Walking back between points. There is no walk clip (docs/mixamo.md), so the jog is drawn WALK_UP of the way to the
 * upright stand: the knees straighter, the trunk up, the step shorter and WALK_CADENCE more of them. (Review round 6,
 * the critic's #2: a trot in the ready crouch, knees 40 degrees.)
 */
const WALK_UP = 0.8;
/** Each player's idle clip this far apart (s): all four breathed in step from the same frame, the one crouch held by four people. */
const IDLE_APART = 1.37;
const WALK_CADENCE = 0.4;
/**
 * The walk's feet. A slowed jog keeps its flight phase (both feet off 21% of frames, 5 steps a second, 83% of the way
 * sideways or backwards with the chest on the net: review round 8, the critic's #3 and #8), so walkFeet draws them: each
 * put down WALK_AHEAD of half the way a stance covers ahead of the body and held there, heel first (WALK_HEEL rad, toes
 * up) and off the ball of the foot (WALK_ROLL rad) when the body has gone past it, for WALK_STANCE of the stride. A step
 * is WALK_STEP legs long at WALK_HZ0 to WALK_HZ1 strides a second, the ankle lifted WALK_CLEAR through a swing, the feet
 * WALK_WIDTH of the hips' width off the line and turned out WALK_TOE. A foot further than WALK_REACH legs from the body
 * goes whatever the other is doing. The hips are highest over a stance foot (WALK_HIP of the leg), WALK_BOB lower with
 * both feet down and WALK_SWAY over the foot that is down, and each arm swings WALK_ARM against its leg. Below
 * WALK_GAIT_V (m/s) it stands. They turn at up to WALK_TURN_RATE (rad/s) to where they are going (the sim's facing stays
 * on the net), back to the net from WALK_NEAR1 m off their place to WALK_NEAR0, and it fades in and out over WALK_IN s.
 * (The hips at 0.96 of the leg and a step a leg long held a knee straight in 55% of walk frames, a stroll on locked knees; review
 * round 32, #10. Now 19%, the swing leg folding 58 degrees at the median.)
 */
const WALK_STANCE = 0.6;
const WALK_AHEAD = 0.85;
const WALK_REACH = 0.75;
const WALK_HEEL = 0.3;
const WALK_ROLL = 0.62;
const WALK_STEP = 0.85;
const WALK_HZ0 = 0.6;
const WALK_HZ1 = 1.25;
const WALK_CLEAR = 0.03;
const WALK_WIDTH = 0.95;
const WALK_TOE = 0.1;
const WALK_HIP = 0.92;
const WALK_BOB = 0.04;
const WALK_SWAY = 0.02;
const WALK_ARM = 0.13;
const WALK_GAIT_V = 0.35;
const WALK_TURN_RATE = 4.5;
const WALK_TURN_GAIN = 9;
const WALK_TURN_ACC = 28;
const WALK_IN = 0.15;
const WALK_NEAR0 = 0.5;
const WALK_NEAR1 = 1.8;
/** How far towards the carry key (CARRY) the racket goes while walking back. */
const CARRY_W = 0.9;
/** The middle of a hand past the wrist, as a share of the forearm. */
const PALM_ALONG = 0.33;
const STAND_EASE = 0.4;
/**
 * How far from the idle's ready crouch a server stands, from the address to the contact: a server is tall behind the
 * ball with the knees a little bent (review round 3, critic #11: all through the serve the idle's crouch had the trunk
 * 45 degrees forward and the knees near 90).
 */
const SERVE_STAND = 0.8;
/** The height (m) the server's hand lets the dropped ball go. */
const SERVE_LET_GO = 1.2;
/**
 * How far the trunk comes up from the idle clip's lean, standing (rad). The clip is a tennis ready crouch, trunk 47
 * degrees forward through every shot played standing; padel players wait and hit far more upright (MediaPipe on WPT
 * photos: 5-19 ready, 6 at the volley, 30 at a groundstroke; the knees and hips were already theirs).
 */
/** How far the ready position takes over from the clip in play (the serve's address and a tap take all of it). */
const READY_HOLD = 0.97;
/**
 * The most of its length the arm is out in the ready position: an elbow of 52, footage 46-66. Near straight a few centimetres are tens of degrees: the fit left five
 * people of ten on 22-45 standing still and everybody on 18-20 at times on the move, the lean that reached for the hand came off in a stroke's first frame, and a straight arm
 * has no side for its elbow, which found one again in a frame. Those were half the pops, read as "ready" though each was a backswing starting.
 */
const READY_REACH = 0.89;
const READY_UP = 1.1;
/** The shoulder height (m, standing) READY's numbers are for. */
const READY_SHOULDER = 1.355;
/** And the arm's length (m). */
const READY_ARM = 0.5;
interface Manner { tempo: number; back: number; follow: number; high: number; out: number }
const PLAIN_MANNER: Manner = { tempo: 1, back: 1, follow: 1, high: 0, out: 0 };
/** How much of the crouch for a low ball the knees take, and how far the trunk folds for it instead (rad, at 0.4 m). */
const CROUCH_SHARE = 0.3;
const LOW_BEND = 0.75;
/**
 * How quickly an overhead (Family.stand) stands the trunk up (s): it is played upright, the head under the ball's
 * path. In the idle's crouch the head was 0.25 m in front of the feet at 1.37 m, the ball 0.37 m behind it: the
 * contact came beside the head with the forearm folded across the face (review round 3, critic #11).
 */
const OVERHEAD_STAND_EASE = 0.15;
const WALL_EASE = 0.2;
/** How far the head turns from the chest to watch the ball (rad), and the neck's share of it. */
const LOOK_YAW = 1.25;
/** Eyes off a dead ball (Avatar.gazeAt): how fast (s), the partner's eyes from within GAZE_MATE m, else level and GAZE_FAR m
 * ahead, wandering GAZE_WANDER rad at GAZE_DRIFT rad/s. */
/** How far the thing looked at may move in a frame before it counts as a jump (m), and how fast the head comes round to it then (s). */
const GAZE_JUMP = 0.8, GAZE_SETTLE = 0.12;
const GAZE_UP_T = 0.35, GAZE_MATE = 3.5, GAZE_MATE_Y = 1.6, GAZE_FAR = 6, GAZE_WANDER = 0.3, GAZE_DRIFT = 0.45;
const NECK_SHARE = 0.4;
/**
 * Standing or shuffling slowly the feet stay planted while the body turns and drifts over them, and a foot steps
 * (one at a time, lifted, over STEP_TIME) once it is this far (m) or this turned (rad) from where the animation
 * wants it. Further than STEP_SNAP it steps at once, whatever the other foot is doing.
 */
const STEP_DIST = 0.13;
const STEP_YAW = 0.55;
const STEP_TIME = 0.15;
/**
 * The run in a rally, drawn as the walk is (walkFeet): the clips have each foot down 17% of the cycle, both off 65-78% of
 * the time (about 30 in real running), and clip by clip no foot height changes that. On over RUN_V_ON m/s, off under
 * RUN_V_OFF; handed to the foot locks RUN_PLANT s before a contact. Strides a second, RUN_HZ0 + RUN_HZ_V a m/s up to
 * RUN_HZ_MAX; the share of a stride a foot is down, RUN_DUTY0 at RUN_V0 to RUN_DUTY1 at RUN_V1; RUN_AHEAD of that ahead of
 * the hips (nearer the half a walk puts down, and the knee lands straight); feet RUN_WIDTH of the hip's width off the
 * middle, in under the body (at 1.2 two rails 26 cm apart, a wide-legged trot from behind), RUN_WIDE going sideways, or they pass through each other; RUN_CLEAR + RUN_CLEAR_V a m/s of clearance and
 * RUN_KICK rad of heel at speed; RUN_ROLL rad of heel up as a foot leaves. RUN_REACH of the leg from the hips, a planted
 * foot goes. RUN_STILL: nearer its place than this (m), a foot isn't due a step.
 */
const RUN_V_ON = 0.45;
const RUN_V_OFF = 0.3;
/** Between points the run gait takes over at this speed and a half metre a second more (m/s). At 2.5 a body at 2.5-2.8 m/s was still on a stroke
 * clip and flung its rear foot up and far behind for 70 ms, about twice a minute for a moving seat; the reviewer's trial at 1.8 cut that to a third
 * with the pops unchanged (review round 26). The rally's gait takes over from 0.45, so jogging on it is nothing new. */
const RUN_V_BREAK = 1.8;
const RUN_PLANT = 0.3;
/** The run is back on this long after a contact (s). */
const RUN_AFTER = 0.08;
/** How much of RUN_PLANT goes by RUN_PLANT_V1 m/s, from RUN_PLANT_V0. */
const RUN_PLANT_FAST = 0.6;
/** The chest stops following a run's hips this long before a contact (s), wholly by RUN_CHEST_NEAR, and is free again RUN_CHEST_BACK after it. */
const RUN_CHEST_FAR = 0.6, RUN_CHEST_NEAR = 0.3, RUN_CHEST_BACK = 0.3, RUN_CHEST_EASE = 0.06;
const RUN_PLANT_V0 = 1.5;
const RUN_PLANT_V1 = 3;
const RUN_IN = 0.1;
const RUN_HZ0 = 1.15;
const RUN_HZ_V = 0.2;
const RUN_HZ_MAX = 2;
const RUN_V0 = 1;
const RUN_V1 = 3.5;
/** How far through its swing a run's foot is clear of the floor: off it from the first frames, and the flight shows. */
const RUN_LIFT = 0.1;
const RUN_DUTY0 = 0.52;
const RUN_DUTY1 = 0.41;
const RUN_AHEAD = 0.3;
const RUN_WIDTH = 0.7;
const RUN_WIDE = 1.4;
const RUN_CLEAR = 0.04;
const RUN_CLEAR_V = 0.01;
const RUN_KICK = 0.9;
const RUN_ROLL = 0.95;
const RUN_REACH = 0.58;
const RUN_STILL = 0.06;
/**
 * A run's hips, from the leg and not from the clip, as the walk's are: at the bottom RUN_HIP0 of the hip's standing height
 * at RUN_V0, RUN_HIP1 at RUN_V1, up RUN_BOB (m) as a foot leaves, the bottom RUN_LOW through its time down, ahead of the
 * middle of it, the leg still taking the landing. The hips had been sunk a flat 15 cm at 4 m/s to take near-straight legs
 * off the landing, which sat the short players in a squat: 0.80 of the height, the thigh 60 degrees forward at the median,
 * the knee 69 on the straighter leg. Runners: knee about 14 at the landing, 40 down, 5-10 cm of bob.
 */
const RUN_HIP0 = 0.94;
const RUN_HIP1 = 0.92;
const RUN_BOB = 0.06;
const RUN_LOW = 0.3;
/** Into and out of those hips (s): on with the gait they jumped with every run tipping into a walk, a knee 10 degrees in a frame. */
const RUN_HIP_IN = 0.12;
/**
 * The last share of a leg's reach, given up gently by a foot in the air: near straight a knee's angle runs away with the
 * distance (1% of the reach is 16 degrees, 3% is 28), and a foot swinging into reach took a knee from 2 to 29 degrees in a
 * frame. A foot on the floor stays exactly where it was put.
 */
const RUN_SOFT = 0.03;
/**
 * The most of a leg's reach a foot on the floor is asked for (a foot in the air: at its landing, FALL_PLAN); how far through its
 * swing a foot lands soon enough that the other may not leave; how fast the hips may go up or down for all that (m/s).
 */
const RUN_STRETCH = 0.975;
const RUN_LANDS = 0.6;
const RUN_HIP_RATE = 1.2;
const RUN_HIP_EASE = 0.03;
/** The most a run's hips sink for a foot (m): they followed one left behind, hips 0.68 m at 2 m/s, feet over a metre apart. */
const RUN_SINK = 0.13;
/** How far down the hips are taken as being when a planted foot is judged out of reach and steps at once, whatever the other foot is doing (m). Less has both feet off the floor 43% of a run and cuts the stance short, more slides the foot and leaves the thigh out; real running is about 30, a foot down 0.2 s. */
const RUN_STEP_SINK = 0.07;
/** How much of the way to under the hips a run's foot goes in the middle of a swing: from a foot left out to the side the straight line to its landing held the thigh out 55 degrees in the air. */
const RUN_UNDER = 0.6;
/** By how much of the swing a run's foot has turned to its landing's heading. */
const RUN_YAW_BY = 0.35;
/**
 * A planted foot more than RUN_PIVOT_FROM off the run's heading pivots on its ball towards it, at up to RUN_PIVOT_RATE (rad/s): a
 * run set off from a ready stance with both feet still pointing the old way, 75-140 degrees off the hips for up to 1.4 s until
 * the first step, the stance knee twisted in and the thigh across the body (review round 33, #10).
 */
const RUN_PIVOT_FROM = 0.5;
const RUN_PIVOT_RATE = 8;
/** How far past the trunk's rim (`k`, the share of the way out) a hand is taken right round the front. */
const TRUNK_ROUND = 0.25;
/** How fast the hips follow a stroke's `weight` (s). */
const INTO_EASE = 0.05;
/** How far a stride throws long hair at speed, to the side and up (m). */
const HAIR_THROW = 0.05;
const HAIR_BOB = 0.02;
/** How much of the forward clips' lean goes from the trunk in a drawn run (rad): they lean 20 degrees at a steady 3 m/s, a
 * person about 10. */
const RUN_UP = 0.22;
/** How far each hand swings at speed (m; the racket hand 0.4 of it): they were 15 cm apart, the arms carried. */
const RUN_ARM = 0.2;
/** Where in the swing the foot is highest, and how fast a planted foot rolls (rad/s). */
const RUN_PEAK = 0.3;
const RUN_FALL = 0.86;
/** From where in a walk's swing its landing is held (its arc is a sine: within a centimetre of the floor from here). */
const WALK_DOWN = 0.85;
const RUN_ALONG = 0.02;
/** By when a run's foot has gone along to its place, which is held from then: it comes straight down onto it. Along to the end of
 * the swing, the last centimetre to the floor went at 1.4-1.7 m/s, on 6% of p8's frames on it. (Held from RUN_FALL, as it starts
 * down, pops rose by 0.5 a minute for 0.2 cm/s less skating.) */
const RUN_SET = 0.92;
const RUN_THROUGH = 0.55;
const RUN_LEVEL = 0.8;
const RUN_ROLL_RATE = 9;
/** The least a foot is down, as a share of its time in a steady run. */
const RUN_DOWN = 0.75;
/** A foot this far behind its stance's end goes before its turn. */
/**
 * The soonest a run's next foot may go, as a share of a stride. A run's steps are all but even: at 0.2 a foot that had
 * fallen behind left early, the next waited, and the whole run went short, long, short, long (0.12 s then 0.35 s).
 */
const RUN_EARLY = 0.42;
/** Past this share of its reach, squared, a foot goes even before its turn: it is the one thing a run can't hold. */
const RUN_STRANDED = 2.25;
const RUN_BEHIND = 1.4;
const RUN_SIDE_HZ = 0.5;
/** Running backwards: quicker and shorter again (steps of over a metre at 3.5 m/s), on the ball of the foot, which lands
 * first and rolls down (rad of heel up at the landing). The forward run's roll had the heel going up as the foot went
 * ahead of the hips, the ankle pointed past 55 degrees in 38% of frames. */
const RUN_BACK_HZ = 0.4;
const RUN_BACK_ROLL = 0.4;
/** How far the heel comes up behind a run, over the clearance, as a share of the leg: a person's lands about 0.33 m up at
 * 4 m/s, and this one's was 0.19, the back leg trailing long and straight, the thigh 52 degrees behind at p10. */
const RUN_HEEL = 0.22;
/** The nearest a foot lands to the middle of the hips, as a share of where it lands going straight. */
const RUN_CLOSE = 0.7;
/** How far through its swing the other foot must be before a foot left behind may go. */
const RUN_TURNS = 0.35;
/** A step for reach moves the foot at least this far (m). */
const STEP_MIN = 0.04;
/** A planted foot whose heading is this far (rad) from the body's steps even while the other foot is stepping: held
 * longer, a body turning on the spot (a left-hander's stroke squaring up from a ball behind) left it 180° behind. */
const WAIT_TURN_MAX = 1.6;
const STEP_LIFT = 0.05;
/** A step's height for its length (share), and the fastest a stepping foot's way is covered (m/s, on average over the step). */
const STEP_RISE = 0.2;
const STEP_SPEED = 2.6;
const STEP_SNAP = 0.7;
/**
 * Set at the ball: from SET_BEFORE (s) before a stroke's contact to SET_AFTER after it, a planted foot steps only when the leg can't reach it or it is
 * left STEP_SNAP behind, and a step under way is quickened to be down SET_LAND before the ball (no quicker than SET_LEFT for what is left of it). The
 * stroke clips step the front foot in late, and the lock followed: at a slow stroke the front toe went 15 cm or more in the last 0.15 s on 44-71% of
 * groundstrokes and was off the floor at the ball on 24-62% (review round 27). The plant before an elite player's ball is 0.37 s off the back glass
 * (Espino 2015, five players), and nobody has published one for a groundstroke.
 */
const SET_BEFORE = 0.22, SET_AFTER = 0.1, SET_LAND = 0.1, SET_LEFT = 0.04;
/**
 * Foot locks while moving: a clip's stance foot drifts over the floor (its stride doesn't match the body's speed
 * exactly, the blend of two directions shortens it, the body turns over it), so a foot whose sole comes within
 * LOCK_ON (m) of the floor stays where it was put down, at the yaw it had, until the clip lifts it past LOCK_OFF,
 * has moved on LOCK_DRIFT (m) or turned LOCK_YAW (rad) from it, or the leg can't reach it; then it goes back onto
 * the clip's foot over LOCK_RELEASE (s).
 */
const LOCK_ON = 0.015;
const LOCK_OFF = 0.035;
const LOCK_DRIFT = 0.25;
const LOCK_YAW = 0.7;
const LOCK_RELEASE = 0.12;
/** Sole points per asset (fitted once from the mesh). */
const SOLES = new WeakMap<PlayerAsset, SolePoint[][]>();
const vs = new THREE.Vector3();
const vsc = new THREE.Vector3();
const mf = new THREE.Matrix4();
const mt = new THREE.Matrix4();
const ml = new THREE.Matrix4();
/** Lunge: a planned contact further than LUNGE_FROM (m, flat) from the racket shoulder steps the foot on its side out. */
const LUNGE_FROM = 0.9;
const LUNGE_MAX = 0.55;
/** The least share of a lunge the far foot makes (it steps after the near one). */
const LUNGE_TRAIL = 0.5;
/** Fastest a foot's lunge offset moves (m/s): a long step's pace. */
const LUNGE_RATE = 3;
/** Furthest a lunging foot goes from its hip, as a share of the leg's length (the lock lets go at 0.985). */
const LUNGE_REACH = 0.95;
/** How far a stroke steps the foot on the ball's side towards it (m), and a low ball's (under 0.45 m, from 0.95 m). Pros
 * meet groundstrokes on a base 1.2 legs wide, the feet well apart and the knees easy (43/40 degrees, MediaPipe on WPT
 * photos), and a low ball with the trail leg nearly straight (45/21), the trunk folded 45 degrees: a lunge and a bend
 * from the hips, where this got low by a squat (107/83) on feet at 0.9 legs. */
const LUNGE_BASE = 0.42;
const LUNGE_LOW = 0.58;
/** An overhead's feet: the racket-side foot back and the other forward (m), side-on (0.99 legs wide against 0.45). */
const OH_FOOT_BACK = 0.34;
const OH_FOOT_FRONT = 0.16;
/** Below this weight (the stroke's or the ready position's) the arm solve fades into the clip's arm. */
const ARM_FADE = 0.15;
/** Furthest a swing reaches past the arm (m: hand to the face's centre and the hips' reach), and the heights an
 * out-of-reach contact is swung at between (m). */
const CON_REACH = 1.0;
const CON_LOW = 0.25;
const CON_TOP = 2.7;
/** Locomotion: how close to halfway between two directions (a quarter turn = 1) their clips cross-fade. */
const WARP_BAND = 0.1;
/** Motion matching (Avatar.motion 2): the most the legs of the cycle playing are turned onto the way of travel, as far
 * as the search may pick a clip from it (matcher.ts WARP_REACH). */
const MATCH_WARP_MAX = WARP_REACH;
/**
 * Side-on run: across faster than SIDE_RUN_ON (m/s) the legs turn onto the way the body is going and run (the
 * forward run, warped up to SIDE_RUN_MAX quarter turns), back to the strafes below SIDE_RUN_OFF. The strafe clips
 * step no faster than 2.8-3.4 m/s at the cadence cap, the sim's players go 4.8 m/s across: the stance foot was held
 * up to 25 cm behind and swung through the other leg on release (QA army: legs through each other in 6-8% of
 * frames in singles). Players turn their hips and run for a wide ball.
 */
const SIDE_RUN_ON = 2.6;
const SIDE_RUN_OFF = 2.1;
const SIDE_RUN_MAX = 1.35;
/** How quickly the direction clips' weights follow the way of travel (s). */
const CYCLE_EASE = 0.06;
/** Most the spine turns back against the legs' warp (rad); past it the chest turns with the hips. */
const WARP_SPINE_MAX = Math.PI / 4;
/** Most the chest turns off the hips (rad). */
const TWIST_MAX = Math.PI / 4;
/**
 * The run back for a ball going over or past: side-on, shoulder to the net, not backpedalling square. Turns the
 * stance RETREAT_TURN (the overhead's own take-back) as the player goes back between RETREAT_V0 and RETREAT_V1 (m/s). The
 * spine may turn back RETREAT_SPINE more against the legs running away. A lobbed net player's chest was 13-17 degrees
 * from square for the first second (review round 8, the pro's #1).
 */
const RETREAT_TURN = 1.25;
const RETREAT_V0 = 0.8;
const RETREAT_V1 = 1.8;
const RETREAT_SPINE = 0.5;
const RETREAT_IN = 0.09;
const RETREAT_OUT = 0.22;
/**
 * The body's weight: the player tilts towards their acceleration from the ankles, hips over the driving foot and behind
 * a braking one, and the trunk goes with it. LEAN_GAIN rad per m/s² (physics' atan(a/g) is 0.1), at most LEAN_MAX, on a
 * spring (LEAN_W rad/s, damping LEAN_Z) so it lags the push and settles. LEAN_TRUNK of the angle again in the spine,
 * LEAN_STROKE of it gone in a stroke, whose keys lean for themselves. Trunk and body answered at 3% of physics, the same
 * in a start, a steady run and a hard stop (review round 8, the critic's #1).
 */
const LEAN_GAIN = 0.09;
const LEAN_MAX = 0.42;
const LEAN_W = 13;
const LEAN_Z = 0.62;
const LEAN_TRUNK = 1;
/** Its share in each joint of the spine, least at the waist: in thirds, a hard stop parted a shirt from its shorts. */
const LEAN_SPINE = [0.15, 0.35, 0.5];
const LEAN_STROKE = 0.85;
const LEAN_HAND = 0.25;
/** Slowing down, the body goes past upright behind its feet: the run's own forward lean has to go first. */
const LEAN_BRAKE = 1.5;
/** And its limit, over LEAN_MAX: a stop's trunk went 37 degrees back over feet that hadn't come out in front of it. */
const LEAN_BRAKE_MAX = 1.1;
/** How far a landing goes ahead for each radian of lean back, and in for each forward (m): a stop lands out in front of the body, a start under it. */
const RUN_LEAN_STEP = 0.5;
/** How much of a leg's length the lean takes the hips off the feet for each radian. All of it put them 0.46 m off the feet at a hard stop, legs near straight, then 0.13 m lower for the arc: hips 0.61 m at walking pace. */
const LEAN_HIP = 0.4;
/** How fast the chest turns with the hips into a side-on run and back out of it (rad/s): switched at once, the
 * chest, arms and head jumped up to 45 degrees in a frame. */
const WARP_CHEST_RATE = 7;
/** How fast the legs turn into a side-on run and back out of it (rad/s): a quarter turn in 0.3 s. Switched at once,
 * the hips and the spine's turn back jumped together and their inertialization undid the cancelling (pops tripled); at 8,
 * on top of the body's own turn, the hips went 70 degrees in 80 ms every three seconds (review round 17, the biomechanist's #6). */
const WARP_SWITCH_RATE = 5.5;

/**
 * How fast each joint can turn (deg/s), for inertialization: a target moving faster than 1.25x this in a frame is a
 * jump, smoothed over. Peak speeds people reach: tennis serve, world-class players (Fleisig et al. 2003, mean + 2 SD):
 * pelvis 620, upper torso 1110, shoulder internal rotation 3600, elbow extension 2050, wrist 3990; sprinting knee
 * about 1500, hip 900; ankle 1200 (estimate); head turns about 700. Joints not listed: 1000 (the shoulder girdle).
 */
const JOINT_LIMITS: Record<string, number> = {
  Hips: 620, Spine: 1110, Spine1: 1110, Spine2: 1110, Neck: 700, Head: 700,
  LeftShoulder: 1000, RightShoulder: 1000, LeftArm: 3600, RightArm: 3600, LeftForeArm: 2050, RightForeArm: 2050,
  LeftHand: 3990, RightHand: 3990, LeftUpLeg: 900, RightUpLeg: 900, LeftLeg: 1500, RightLeg: 1500,
  LeftFoot: 1200, RightFoot: 1200, LeftToeBase: 1200, RightToeBase: 1200,
};

/** How one hand holds the racket. */
interface Grip {
  hand: THREE.Bone;
  /** The racket's origin (face centre) and rotation in the hand's frame. */
  pos: THREE.Vector3;
  /** From the wrist to the racket's origin, in the racket's frame. */
  off: THREE.Vector3;
  q: THREE.Quaternion;
  qInv: THREE.Quaternion;
  /** Gripping fingers: bone index and the local rotation (x, y, z, w) that curls it round the handle. */
  bones: number[];
  quats: Float32Array;
  /** The wrist cord for this hand, in the racket's frame. */
  cord: THREE.Mesh;
}

export function makeRacket(): THREE.Group {
  return makeRacketModel();
}

export class Avatar {
  /** At the player's feet. Its yaw is the stance plus part of the shoulder turn, plus PI (the model faces +z). */
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly racket: THREE.Group;
  private readonly bones: THREE.Bone[];
  private readonly nb: number;

  private readonly clips: { idle: Clip; cycle: Clip[]; celebrate: Clip; dejected: Clip };
  /** Bones from the spine up (the reaction clips play on these over the legs' locomotion). */
  private readonly upper: Uint8Array;
  // Reaction after a point: the player whose shot ended it pumps a fist (won) or holds their head (lost).
  private react: Clip | null = null;
  /** A held pose after the point instead of a clip, its sign (won, lost), when it began, and how many points this one has ended. */
  private moodKey: Key | null = null;
  private moodSign = 1;
  private moodAt = -0;
  private reactN = 0;
  private reactStart = 0;
  private reactFrom = 0;
  private lastPhase = -1;
  // Split step: a small hop as the opponent strikes, landing with bent knees (feet kept planted).
  private lift = 0;
  private splitDrop = 0;
  /** Smash jump: how far the ball is above the arm's reach (m, from the legs' solve), and the hop under way. */
  private upNeed = 0;
  private jumpH = 0;
  /** The pelvis's share of a measured overhead's lean now (TRACK_PELVIS), and that turn in the world for the legs. */
  private leanPelvis = 0;
  private readonly leanW = new THREE.Quaternion();
  /** How high the jump has this player at the ball it is going up for (smashJump; 0 with none coming). */
  private liftBall = 0;
  private jumpT0 = -1;
  private jumpT = 0;
  private landAt = -1;
  /** When this player last grunted (sim s; the soundscape says): the mouth opens with the voice, not by the stroke. */
  gruntAt = -10;
  /** A volley's reach down at the ball (m; see VOLLEY_UP). */
  private downAt = 0;
  /** The hips' drop shown last frame (m; see HIP_RISE). */
  private dropShown = 0;
  /** The hips' height above the root as shown (m; -1 starts afresh), its speed (m/s) and the lift last frame (see FALL_G). */
  private fallY = -1;
  private fallV = 0;
  private fallLift = 0;
  /** What the follower left when a stroke ended (m above the pose) and its speed, let go at FALL_LET; whether it was following
   * last frame, and the pose's height then. */
  private fallR = 0;
  private fallRV = 0;
  private fallIn = false;
  private fallWant = 0;
  /** What FALL_G took off the drop this frame (m; minus: the hips higher than the pose wants). */
  private fallOff = 0;
  /** The drop the stroke wants at its contact (m), and the crouch it will have then (see FALL_PLAN). */
  private dropC = 0;
  private crouchC = 0;
  /** Planted feet (left, right): weight, where each is (world), its yaw, and a step under way (-1: none). */
  private plantW = 0;
  private sp = 0;
  /** Sole points per foot, and hip-to-ankle length at rest. */
  private readonly soles: SolePoint[][];
  private readonly legLen: number;
  /**
   * This body's legs over the modelled person's (asset.legScale; 1 unless the creator reshaped it). The lower body's
   * distances in metres (the hips' floor, drops and push, the run's bob and sink, steps, lunges, an overhead's feet, the
   * hop and its landing) were tuned on the people as modelled and go with the leg: a 0.66 m hip floor over a 0.55 leg's 0.60 m hips left it
   * no drop at all, and a knee spun round. Not the run's cadence (shorter, quicker strides doubled that leg's pops, and
   * Froude's square root still added a quarter), nor a foot's clearance, which is the floor's (lower lifts read as sliding).
   */
  private legK = 1;
  /** How far a jump's legs have come in under the body (scissor, AIR_*). */
  private airK = 0;
  /** How far the legs reach out to AIR_REACH in the air (0 to 1): all of it up to a smash's ball, none once the kick opens. */
  private airLong = 0;
  /** A run has ended: no new step (held only with a foot up, the frame it landed took the next one, and they stepped on the spot). */
  private gaitStop = false;
  /** ... and with a foot in the air, the gait stays until it's down. */
  private gaitEnd = false;
  /** The clip's feet before IK: ankle height and lowest sole point (world). */
  private readonly fkY = new Float64Array(2);
  private readonly lowY = new Float64Array(2);
  /** Foot locks (see LOCK_ON): on, where, the body's yaw then, and a release under way (-1: none) from where. */
  private readonly lockOn = new Uint8Array(2);
  private readonly lockPos = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly lockYaw = new Float64Array(2);
  private readonly relT = new Float64Array([-1, -1]);
  private readonly relFrom = [new THREE.Vector3(), new THREE.Vector3()];
  /** The foot's world rotation while locked (it doesn't roll over the floor), and where its release starts. */
  private readonly lockQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly relQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** A release forced while the foot is still down steps it (lifted), rather than sliding it; and its length (s). */
  private readonly relLift = new Uint8Array(2);
  private readonly relDur = new Float64Array([LOCK_RELEASE, LOCK_RELEASE]);
  private readonly relUp = new Float64Array([STEP_LIFT, STEP_LIFT]);
  /** The step's target rotations last frame, each kept on the side of the one before (see the step). */
  private readonly relQT = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly relToeT = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** 0 until the step's first frame has set relQT / relToeT. */
  private readonly relTOk = new Uint8Array(2);
  /** Toes: their local rotation while locked (they don't bend over the floor either), and at the release. */
  private readonly toes: THREE.Bone[];
  private readonly lockToe = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly relToe = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** Bits: 1 foot locks, 2 soles kept above the floor (for comparisons). */
  static feetMask = 3;
  /** The hips' fall at a body's pace (FALL_G; governFall), off for A/B checks. */
  static fallOn = true;
  private readonly cycleW = new Float64Array(5);
  private readonly cycleTo = new Float64Array(5);
  private cycleOk = false;
  private warpShown = 0;
  private warpShownOk = false;
  /** Orientation warp (rad): how far the legs turn from the playing clip's direction onto the body's travel. */
  private warp = 0;
  /** Running side-on (SIDE_RUN_ON). */
  private sideRun = false;
  /** How far the chest has turned with the legs' warp (rad), following WARP_CHEST_RATE. */
  private chestWarp = 0;
  private warpWish = 0;
  private chestFree = 1;
  /** What the warp has still to turn after a switch into or out of a side-on run (rad), going at WARP_SWITCH_RATE. */
  private warpOff = 0;
  private readonly pose: Pose;
  private readonly tmp: Pose;
  /**
   * After match point nobody stands ready: the idle's ready crouch gives way (standW, eased over STAND_EASE s) to an
   * upright stand (standPose: the celebrate clip's first frame, arms down, the racket hanging from the hand). A server
   * takes SERVE_STAND of it.
   */
  private readonly standPose: Pose;
  private readonly allBones: Uint8Array;
  private standW = 0;
  /** Between points: how far the jog is drawn towards the upright stand (WALK_UP, eased). */
  private walkUp = 0;
  /** Added to the stance to go where the walk goes, and the feet's gait (WALK_*): weight, the hips' eased weight. */
  private walkTurn = 0;
  private walkTurnV = 0;
  private gaitW = 0;
  private gaitH = 0;
  private gaitRunH = 0;
  /** Last frame's turn on an overhead's way to its curve, for keeping the way round (nlerpQ); zero when there is none. */
  private readonly overPrev = new THREE.Quaternion(0, 0, 0, 0);
  private afterW = -0;
  private runHipY = -1;
  private runHipTo = 0;
  private gaitOn = 0;
  /** 1: walkFeet is drawing a rally's run, not the walk back; which foot goes next, and how long since one went (s). */
  private gaitRun = 0;
  private gaitNext = 0;
  private gaitUp = 0;
  /** The hips' push off the body's middle this frame (m). */
  private hipOutX = 0;
  private hipOutZ = 0;
  private gaitPhase = 0;
  private gaitSince = 0;
  private gaitHz = 0.5;
  private gaitLast = 0;
  /** Each foot: how far through its swing (-1: down), seconds down, its pitch at lift-off and now. */
  private readonly gaitSwing = new Float64Array(2);
  private readonly gaitDown = new Float64Array(2);
  private readonly gaitPitch = new Float64Array(2);
  private readonly gaitPitchNow = new Float64Array(2);
  private readonly gaitPlant = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly gaitFrom = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly gaitTo = [new THREE.Vector3(), new THREE.Vector3()];
  /** Each foot's yaw down, at the start of its swing, and where it will land. */
  private readonly gaitYaw = new Float64Array(2);
  private readonly gaitYawFrom = new Float64Array(2);
  private readonly gaitYawTo = new Float64Array(2);
  /** Rest pose (model space): feet and toes flat on the floor, toes in their feet, the ankle's height, hips' half-width. */
  private readonly footRestQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** Each foot's way forward, in its own bone. */
  private readonly footFwd = [new THREE.Vector3(), new THREE.Vector3()];
  /** The same for its left, the ankle's hinge: level however the foot is pitched. */
  private readonly footSide = [new THREE.Vector3(), new THREE.Vector3()];
  /** Each foot's turn from the hips, last frame (solveLegs). */
  private readonly chestQ = new THREE.Quaternion();
  private rideTurn = -0;
  private readonly footOff = [-0, -0];
  /** The trunk's half width and depth (outOfTrunk), from the shoulders. */
  private trunkW = 0.18;
  private trunkD = 0.115;
  private readonly toeRestQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly toeRestLocal = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly ankleY: number;
  private readonly hipW: number;
  private readonly ballLen: number;
  /** How much of the pose is the idle clip (not running): set by locomote. */
  private idleW = 1;
  private cutPending = false;

  /** The next frame draws another match, or another moment (a replay starts or ends): every filter starts afresh. */
  /** A player's own skin and hair, changed in place (the creator's turntable). */
  setSelf(self: SelfLook | null | undefined): void {
    if (this.kit) applySelf(this.kit, self);
  }

  cutNext(): void {
    this.cutPending = true;
    this.lastT = -1;
  }
  private phase = 0;
  private idleClock = 0;
  private lastT = -1;
  /** Inputs to locomote() (fields: V8 boxes doubles passed to calls it doesn't inline). */
  private dt = 0;
  private yRoot = 0;
  private vx = 0;
  private vz = 0;

  // Bones by role.
  private readonly hips: THREE.Bone;
  private readonly spine: THREE.Bone[];
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  /** Rest world rotations (model space), inverted: a bone's facing is its rotation away from these, applied to +z. */
  private readonly chestRestInv = new THREE.Quaternion();
  private readonly headRestInv = new THREE.Quaternion();
  private readonly armR: THREE.Bone[];
  private readonly armL: THREE.Bone[];
  private readonly legL: THREE.Bone[];
  private readonly legR: THREE.Bone[];
  /** Right-handed 1, left-handed -1 (the player's), and what follows from it: which arm holds the racket. */
  private handed = 1;
  private armRacket: THREE.Bone[];
  private armFree: THREE.Bone[];
  /** Each elbow's hinge (forearm frame) and the forearm's rest rotation, for hingeIK. */
  private readonly elbowR: Elbow;
  private readonly elbowL: Elbow;
  private elbowRacket: Elbow;
  private elbowFree: Elbow;
  private readonly grips: Grip[];
  private grip: Grip;
  private readyKey: Key = READY;
  private readyFit: Key = READY;
  /** The server's address before the toss (side-on, the ball in the free hand): this player's copy, the hand on the ball. */
  private readonly addrKey: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  /** The address's share of the ready pose (eased: at the serve's contact the address hands over to the ready pose). */
  private addrW = 0;
  /** How far the body has turned side-on into the address (0 to 1, at ADDR_TURN_S; the hands go at addrW's pace). */
  private addrTurn = 0;
  private placedW = 1;
  /** The chest's turn from square this frame (hips and spine together, rad). */
  private chestTurn = 0;
  private readonly outAddr = new THREE.Quaternion(0, 0, 0, 0);
  /** The racket tap between partners after a point (racketTap): weight, time close, the way to the partner. */
  private tapW = 0;
  /** What tapW is carrying towards: TAP, or an end-of-match key. */
  private tapKey: Key | null = null;
  /** The bend of the beaten at the end of a match (0..1). */
  private bowW = 0;
  private tapT = 0;
  private tapYaw = 0;
  private readonly outTap = new THREE.Quaternion(0, 0, 0, 0);
  /** The racket carried while walking back: weight (eased), and its key blend. */
  private carryW = 0;
  private readonly outCarry = new THREE.Quaternion(0, 0, 0, 0);
  private readonly carryMix: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  private readonly tapMix: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  private readonly readyMix: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  /** Serving: the address is the ready pose (from the point's setup to the contact). */
  private addr = false;
  /** How far the free hand has gone to the serve's address spot (0 to 1). */
  get addressing(): number { return this.addrW * this.placedW; }
  /** The middle of the free hand (world): a third of a forearm past the wrist, about where a ball sits in it. */
  palm(out: THREE.Vector3): THREE.Vector3 {
    v1.setFromMatrixPosition(this.armFree[1]!.matrixWorld);
    out.setFromMatrixPosition(this.armFree[2]!.matrixWorld);
    return out.add(v1.subVectors(out, v1).multiplyScalar(PALM_ALONG));
  }
  /** The serve's ball is still in the free hand (set up, or being pushed down). */
  private inHand = false;
  /** A point is on for this player (the ready position applies). */
  private on = false;
  /** The hips' share of the shoulder turn (the stroke's own, eased). */
  private bt = BODY_TURN;
  private offPole = OFF_POLE;

  // Stroke state.
  private st = ST_NONE;
  private fam: Family = FOREHAND;
  private lastSwing = 0;
  private lastHit = -10;
  private lastHitX = 0;
  private lastHitY = 0;
  private lastHitZ = 0;
  private prepStart = 0;
  private prepFromW = 0;
  private tRel = 0;
  private tCon = 0;
  private relW = 1;
  /** The stroke changed at the release: the swing blends over from the backswing it had. */
  private relBlend = false;
  private prevBounces = 0;
  private relS = 0;
  private swingS = 0;
  private fadeStart = 0;
  private fadeLen = FADE;
  private fadeFromW = 0;
  private readonly conW = new THREE.Vector3();
  /** The clip's arm rotations before the arm solve (racket arm, then free arm). */
  private readonly armClipQ = [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion());
  /** Last frame's arm rotations after the fade (fadeArm turns no faster than FADE_TURN_RATE from these), and whether each arm's are there. */
  private readonly fadePrev = [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion());
  private readonly fadeOk = new Uint8Array(2);
  /** The contact pulled in to reach (contactKey). */
  private readonly conClamp = new THREE.Vector3();
  private readonly backP = new THREE.Vector3();
  private readonly backQ = new THREE.Quaternion();
  private hasCon = false;
  /** Stroke weight (0 = pure locomotion) and the blended key it is pulling towards (model space). */
  w = 0;
  /** Weight of the ready position (racket up in front) under the stroke. */
  private ready = 0;
  private readonly kp = new THREE.Vector3();
  private readonly kq = new THREE.Quaternion();
  private readonly kpole = new THREE.Vector3();
  private readonly hand0 = new THREE.Vector3();
  /** The overhead's elbow in the chest's frame (out, up, fwd; m), how much of the swing is the chest's, and how far it's in. */
  private readonly overE = new THREE.Vector3();
  private readonly overQ = new THREE.Quaternion();
  private readonly finKey: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  /** A track's key (trackKey): the racket shoulder in the stance's frame, the turn onto this ball and its share, and the trunk's lean the track has now. */
  private readonly trSh = new THREE.Vector3();
  private readonly trAt = new THREE.Vector3();
  /** How far the legs took the racket shoulder from where the stroke measured it (racketSh), last frame (world). */
  private readonly shLegs = new THREE.Vector3();
  /** How far a track's elbow is turned about the shoulder-to-hand line to stand clear of the trunk (elbowClear; rad, eased). */
  private swivel = 0;
  private readonly trA = new THREE.Vector3();
  private readonly trB = new THREE.Vector3();
  private readonly fitA = new THREE.Vector3();
  private readonly fitB = new THREE.Vector3();
  private readonly trTurn = new THREE.Quaternion();
  private readonly conTurn = new THREE.Quaternion();
  private readonly rchA = new THREE.Vector3();
  private readonly rchB = new THREE.Vector3();
  private readonly rchC = new THREE.Vector3();
  private readonly rchQ = new THREE.Quaternion();
  private readonly conA = new THREE.Vector3();
  private readonly conB = new THREE.Vector3();
  private readonly trPart = new THREE.Quaternion();
  private trTilt = 0.5;
  private trBow = 0.5;
  /** What the player looks at (world), and how far their eyes are off a dead ball. */
  private readonly gaze = new THREE.Vector3();
  private readonly gazeWas = new THREE.Vector3();
  private readonly gazeFrom = new THREE.Vector3();
  private gazeUp = 0;
  private readonly overEnd = new THREE.Quaternion();
  private readonly overTurn = new THREE.Quaternion();
  private readonly overHead = new THREE.Vector3();
  /** An overhead's follow-through, by the hand: from the ball to the finish, and the racket's centre from the hand. */
  private readonly overA = new THREE.Vector3();
  private readonly overB = new THREE.Vector3();
  private readonly overC = new THREE.Vector3();
  private overU = 0;
  private overIn = 1;
  /** The serve's hand through the ball (serveThrough): the velocity it carries, the contact it's for, the target these last two frames. */
  private readonly throughV = new THREE.Vector3();
  private throughFor = -1;
  private readonly handWas = new THREE.Vector3();
  private readonly handWas2 = new THREE.Vector3();
  private handDt = 0;
  /** The shoulders' cartwheel and the trunk's bow, eased. */
  private overTilt = 0;
  private overBow = 0;
  private readonly wristWant = new THREE.Quaternion();
  private readonly handAxes: THREE.Vector3[] = [];
  private readonly handF = new THREE.Vector3();
  private readonly handK = new THREE.Vector3();
  private readonly wristAfter = new THREE.Quaternion();
  private readonly tipWant = new THREE.Quaternion();
  private readonly tipOff = new THREE.Quaternion();
  private readonly wristQ = new THREE.Quaternion();
  private readonly chestOut = new THREE.Vector3(1, 0, 0);
  private readonly chestUp = new THREE.Vector3(0, 1, 0);
  private readonly chestFwd = new THREE.Vector3(0, 0, 1);
  private readonly koff = new THREE.Vector3();
  private readonly kfree = new THREE.Vector3();
  private kyaw = 0;
  private crouch = 0;
  private bendW = 0;
  /** The stroke's share of the body while its key is held (HOLD_CARRY). */
  private holdW = 0.5;
  /** Bends towards the ball wait for it: 0 until LEAN_FROM before it, 1 at LEAN_FULL. */
  private nearW = 0.5;
  /** The arm kept bent under a carried racket, 0 to 1. */
  private heldBent = 0;
  /** Frames left of a cut (placed for the next point), the next as well: the clip's pose lands a frame after the feet are placed. */
  private cutNow = 0;
  private readonly from: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  private readonly con: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  private readonly ctrl = new THREE.Vector3();
  /** Stance yaw (sim convention: 0 faces -z). */
  private yaw = 0;
  private stanceC = 1;
  /** The stance yaw as a rotation (model to world). */
  private readonly stanceQ = new THREE.Quaternion();
  private stanceS = 0;
  /** Turned side-on to the glass while the ball goes past it (0..1), towards which side, and whether to. */
  private wall = 0;
  private wallWant = 0;
  private readonly mid = new THREE.Vector3();
  /** The share of the family's racket drop this swing has time for. */
  private lagK = 1;
  /** The sim was going for a contrapared at the last held frame. */
  private contraHeld = false;
  /** A contrapared's turn to the own glass: the drawn yaw while it lasts and as it is let go of at GLASS_BACK, and the stroke's weight. */
  private glassOn = false;
  private glassYaw = 0;
  private glassW = 0;
  private hand = 1;
  /** Weight of watching the ball with the head. */
  private look = 0;
  /** Hips pushed towards a ball out of reach (world x, z). */
  private reachX = 0;
  private reachZ = 0;
  private reachV = 0;
  private dropV = 0;
  /** The rear heel's roll at a drive or the serve as shown (rad), and which foot it is on. */
  private driveRoll = 0;
  private driveRollF = 0;
  /** The weight's tilt (rad, towards world x and z) and its rate; last frame's filtered velocity. */
  private tiltX = 0;
  private tiltZ = 0;
  /** How far the hips have gone into the ball (m), and which way the net is along z. */
  private intoBall = 0;
  private netZ = 1;
  private hipTiltX = 0;
  private hipTiltZ = 0;
  private tiltVX = 0;
  private tiltVZ = 0;
  private lastVX = 0;
  private lastVZ = 0;
  private tiltOk = false;
  /** How far into the run back (0-1), and the spine's extra room for it. */
  private retreat = 0;

  // Scratch per avatar.
  private readonly footL = new THREE.Vector3();
  private readonly footR = new THREE.Vector3();
  private readonly footQL = new THREE.Quaternion();
  private readonly footQR = new THREE.Quaternion();
  private readonly tgt = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  /** The body's turn away from a wall as shown (WALL_YAW_RATE). */
  private wallYaw = 0;
  /** The racket's tip about a ball out of reach (tipRacket; rad), and that turn. */
  private tip = 0;
  private readonly tipQ = new THREE.Quaternion();
  /** The upper body's bend towards a ball out of reach (world), and whether last frame's is there to follow from. */
  private readonly lean = new THREE.Quaternion();
  private readonly leanT = new THREE.Quaternion();
  private leanOk = false;
  /** Each knee's hinge (shin frame), measured from the clips as the elbows' are. */
  private readonly kneeL: THREE.Vector3;
  private readonly kneeR: THREE.Vector3;
  /** Last frame's knee side off the hip-to-ankle line (twoBoneIK's rate limit; zero: none yet). */
  private readonly kneeSideL = new THREE.Vector3();
  private readonly kneeSideR = new THREE.Vector3();
  /** Last frame's shins (world), for SHIN_TWIST_RATE; shinOk 0: none yet (a cut). */
  private readonly shinQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly shinOk = new Uint8Array(2);
  /** Each foot's lunge offset (world x, z for the left foot, then the right), as shown. */
  private readonly lungeOff = new Float64Array(4);
  /** The free shoulder before the hips drop and push and the spine leans (world): its keys move with the trunk. */
  private readonly freeSh = new THREE.Vector3();
  /** How far the key is along the forward swing this frame (0 at the backswing, 1 at the contact; see swingKey). */
  private keyS = 0;
  /** How fast the key was going into the ball (m/s), and last frame's place. */
  private swingV = 0;
  private recoverW = 0;
  private readonly kpWas = new THREE.Vector3();
  /** The racket's push out of the body last frame (world, m), let go over CLEAR_EASE. */
  private readonly clearOff = new THREE.Vector3();
  /** The racket hand's push out after the ball (world, m) and where it is going (ELBOW_OUT_GAIN). */
  private readonly elbowPush = new THREE.Vector3();
  private readonly elbowPushTo = new THREE.Vector3();
  /** How much of the racket's push out of the body the arm's weight allows this frame (0 as the arms switch off). */
  private clearW = 1;
  /** Last frame's racket rotation (world), for RACKET_TURN_RATE; racketQOk false: none yet (a cut, arms off). */
  private readonly racketQ = new THREE.Quaternion();
  private racketQOk = false;
  private readonly dir0 = new THREE.Vector3();
  private readonly side0 = new THREE.Vector3();
  /** Last frame's racket elbow bend, for the second solve (racketClear). */
  private bend0 = 0;
  private readonly dirF0 = new THREE.Vector3();
  private readonly sideF0 = new THREE.Vector3();
  private bendF0 = 0;
  /** The capsules the racket is kept out of (pelvis, chest, head). */
  private readonly guardBones: Int32Array;
  private readonly guardR: Float64Array;
  /** The racket shoulder, likewise: after the contact the follow-through goes with the trunk (`finishU`). */
  private readonly racketSh = new THREE.Vector3();
  /** How far into the follow-through (0 up to the contact, 1 at the finish), eased; and where it is heading. */
  private finishU = 0;
  private finishTo = 0;
  /** Shoulder to wrist, arm straight (m). */
  private readonly armLen: number;
  /** This body's shoulders above READY_SHOULDER (m). */
  private readonly shoulderUp: number;
  /** How this person plays the same strokes (data/manners.json). */
  private readonly manner: Manner;
  /** A shorter player jumps higher for the same ball (the sim's contacts are one height for everyone): JUMP_SHORT m per
   * metre under JUMP_HEIGHT. */
  private readonly jumpMore: number;
  /**
   * Pops smoothed over (see inertia.ts): the clip pose before IK, the head after looking, the stance's facing, the
   * stroke's key and weight, the hips' drop and reach. `inertial = false` shows the raw pose (QA comparisons).
   */
  inertial = true;
  /** Which filters run (QA only): 1 clip pose, 2 head, 4 facing, 8 key, 16 weight, 32 hips. */
  static inertMask = 63;
  /** Locomotion: 0 the sector blend; 2 motion matching (matcher.ts, ?motion=2, until the owner has seen it). */
  static motion = 0;
  /** A look at the clips' swings on every ball (?motion=3&tracks=...&fit=0): trackFits says yes to all. Never set in a match anyone plays. */
  static trackAny = false;
  /** The motion matcher over the five cycles (Avatar.motion 2 only). */
  private readonly matcher: Matcher | null;
  private readonly inertia: Inertializer;
  private readonly inertiaSkip: Uint8Array;
  private readonly headInertia: Inertializer;
  private readonly headSkip: Uint8Array;
  private readonly yawI = new InertN(1, (1.25 * 620 * Math.PI) / 180);
  private readonly kpI = new InertN(3, 10);
  private readonly kqI = new InertQ((1500 * Math.PI) / 180);
  private readonly kpoleI = new InertN(3, 6);
  private readonly koffI = new InertN(3, 8);
  private readonly kyawI = new InertN(1, (1.25 * 1110 * Math.PI) / 180);
  private readonly wI = new InertN(1, 30);
  private readonly dropI = new InertN(1, 1.5);
  private lastRootX = 0;
  private lastRootZ = 0;
  /** The racket's rotation blends' last outputs (see nlerpQ; zero = none). */
  private readonly outReady = new THREE.Quaternion(0, 0, 0, 0);
  private readonly outKey = new THREE.Quaternion(0, 0, 0, 0);
  /** Last frame's blend inputs, to keep their signs continuous. */
  private readonly prevFkQ = new THREE.Quaternion();
  private readonly prevReadyQ = new THREE.Quaternion();
  private readonly prevKeyQ = new THREE.Quaternion();
  /** What is left of a smoothing offset each frame: 1, or less so it reaches zero at the contact moment. */
  private keepCon = 1;
  /** The planned contact's time and the plan's spot (for the reach: where the body will be). */
  private tPlan = -1;
  /** A human's planned moment, smoothed (planned). */
  private ringT = 0;
  private planOk = false;
  private planX = 0;
  private planZ = 0;
  /** The planned contact is an AI's own release (or a serve's ideal for an AI): its moment is known. */
  private known = false;
  /** The AI is charged for a ball that no longer passes within its reach (SimpleAi.beaten). */
  private beaten = false;

  /** The kit's per-frame inputs (kit.ts), null for a plain body (QA, tests). */
  private readonly kit: KitState | null = null;
  /** Cloth lag: a point on a spring chasing the body (world, m) and its velocity; the hems trail by its offset. */
  private clothX = 0;
  private clothY = 0;
  private clothZ = 0;
  private clothVX = 0;
  private clothVY = 0;
  private clothVZ = 0;
  private bodyVX = 0;
  private bodyVY = 0;
  private bodyVZ = 0;
  private lastLift = 0;
  private clothOn = false;
  /** Long hair's pendulum (kit.ts hairHang): its pivot and the pivot-to-tip arm at rest in the head bone's frame, rest gravity
   * in that frame, and its length; the tip (world, m) and its velocity, and where the pivot and the head-carried tip were last frame. */
  private readonly ponyPiv = new THREE.Vector3();
  private readonly ponyArm = new THREE.Vector3();
  private readonly ponyG = new THREE.Vector3();
  private ponyLen = 0;
  private ponyK = 0;
  private ponyC = 0;
  private ponyOn = false;
  private ponyLive = false;
  private ponyX = 0;
  private ponyY = 0;
  private ponyZ = 0;
  private ponyVX = 0;
  private ponyVY = 0;
  private ponyVZ = 0;
  private ponyPX = 0;
  private ponyPY = 0;
  private ponyPZ = 0;
  private ponyTX = 0;
  private ponyTY = 0;
  private ponyTZ = 0;
  /** Metres run this match (render-side): sweat builds with effort as well as time. */
  private ran = 0;
  /**
   * Each foot's lowest sole point after this frame's pose (world): x, height above the floor, z, for the left then
   * the right foot. The soundscape hears a step where one comes down onto the floor.
   */
  readonly feet = new Float64Array(6);
  /**
   * Each foot's sole points after this frame's pose (world x, y, z): heel, toe tip, then the two edges, the left foot's
   * four then the right's (soles.ts). Contact shadows are laid under them (render/grounding.ts).
   */
  readonly soleWorld = new Float64Array(24);
  /** The racket tap's touch, for the soundscape: counted at each, at this point (x, y, z). One of the two counts it. */
  tapSeq = 0;
  readonly tapAt = new Float64Array(3);
  private readonly footA = new THREE.Vector3();
  private readonly footQ = new THREE.Quaternion();

  /** QA: a fixed sweat level for screenshots (negative = from the match). */
  static sweatAt = -1;
  /** A person's face (expression and gaze keys), null for the mannequin and plain bodies. */
  readonly face: FaceDriver | null = null;
  private readonly faceIn: FaceInput = { toContact: Infinity, sinceContact: -1, strain: 0, grunt: false, puff: 0, mood: 0, moodT: 0, gazeYaw: 0, gazePitch: 0 };
  /** The eyes' midpoint in the head bone's frame. */
  private readonly eyeInHead = new THREE.Vector3();
  private puff = 0;

  /** `self`: a player's own skin and hair (kit.ts SelfLook), changeable later with `setSelf`. */
  constructor(asset: PlayerAsset, look: number | KitLook, paint?: Paint, self?: SelfLook | null) {
    this.lodAsset = asset;
    this.nb = asset.bones.length;
    this.pose = new Pose(this.nb);
    this.tmp = new Pose(this.nb);
    this.standPose = new Pose(this.nb);
    this.allBones = new Uint8Array(this.nb).fill(1);
    this.bones = asset.bones.map((d) => {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.fromArray(d.pos);
      b.quaternion.fromArray(d.quat);
      return b;
    });
    asset.bones.forEach((d, i) => { if (d.parent >= 0) this.bones[d.parent]!.add(this.bones[i]!); });
    let mat: THREE.Material;
    let hairMat: THREE.Material | null = null;
    if (typeof look === 'number') {
      mat = new THREE.MeshStandardMaterial({ color: look, vertexColors: true, roughness: 0.55, metalness: 0.05 });
      if (asset.look) hairMat = new THREE.MeshStandardMaterial({ color: look, roughness: 0.6, metalness: 0 });
    } else if (asset.look) {
      const k = personMaterial(asset, look, paint, self);
      mat = k.material;
      hairMat = k.hair;
      this.kit = k.state;
      applySelf(k.state, self);
    } else {
      const k = kitMaterial(asset, look);
      mat = k.material;
      this.kit = k.state;
    }
    const skeleton = new THREE.Skeleton(this.bones, asset.boneInverses);
    // A dressed person is drawn as body + face (the face alone carries the morph targets); after the material, which
    // adds attributes the face copies.
    cupPalms(asset);
    const pm = asset.look && typeof look !== 'number' ? personMeshes(asset) : null;
    // (the cuts chosen, drawn from the garments built for this body: triangles of this avatar's own over the shared attributes)
    const pieces = pm && typeof look !== 'number' ? piecesFor(asset.look!.wardrobe, paint) : null;
    const body = pm && pieces ? ownGeometry(pm.body, new THREE.BufferAttribute(dressedIndex(asset, pieces), 1), null) : pm?.body;
    this.mesh = new THREE.SkinnedMesh(body ?? asset.geometry, mat);
    this.mesh.add(this.bones[0]!);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    const morphed: THREE.SkinnedMesh[] = [];
    if (pm?.face) {
      const fm = new THREE.SkinnedMesh(pm.face, mat);
      this.faceMesh = fm;
      fm.bind(skeleton, new THREE.Matrix4());
      fm.castShadow = true;
      fm.frustumCulled = false;
      this.root.add(fm);
      morphed.push(fm);
    }
    if (asset.look && hairMat) {
      // A person's hair, brows and lashes: alpha-tested, on the same skeleton.
      const hair = new THREE.SkinnedMesh(asset.look.alphaGeometry, hairMat);
      this.hairMesh = hair;
      hair.bind(skeleton, new THREE.Matrix4());
      hair.castShadow = true;
      hair.frustumCulled = false;
      this.root.add(hair);
      if (asset.look.alphaGeometry.morphAttributes.position) morphed.push(hair);
    }
    if (pm?.face && asset.look) {
      let seed = 7;
      for (let i = 0; i < asset.look.name.length; i++) seed = seed * 31 + asset.look.name.charCodeAt(i);
      this.face = new FaceDriver(asset.look.morphs, seed);
      for (const m of morphed) m.morphTargetInfluences = this.face.influences as unknown as number[];
      // The eyes' midpoint at rest, into the head bone's frame.
      const B = asset.geometry.getAttribute('bodyB') as THREE.BufferAttribute;
      let n = 0;
      for (let v = 0; v < B.count; v++) {
        if (B.getY(v) < 0.5) continue;
        this.eyeInHead.x += asset.restPos[v * 3]!; this.eyeInHead.y += asset.restPos[v * 3 + 1]!; this.eyeInHead.z += asset.restPos[v * 3 + 2]!;
        n++;
      }
      if (n) this.eyeInHead.multiplyScalar(1 / n).applyMatrix4(asset.restWorld[asset.bone('Head')]!.clone().invert());
    }

    const b = (n: string): THREE.Bone => this.bones[asset.bone(n)]!;
    this.hips = b('Hips');
    this.spine = [b('Spine'), b('Spine1'), b('Spine2')];
    this.neck = b('Neck');
    this.head = b('Head');
    asset.restWorld[asset.bone('Spine2')]!.decompose(v1, this.chestRestInv, v2);
    this.chestRestInv.invert();
    asset.restWorld[asset.bone('Head')]!.decompose(v1, this.headRestInv, v2);
    this.headRestInv.invert();
    const hang = this.kit?.hang;
    if (hang && this.kit?.pony) {
      // (in the head bone's frame, as the skin is bound to it: rest world inverse)
      const inv = asset.restWorld[asset.bone('Head')]!.clone().invert();
      this.ponyPiv.copy(hang.pivot).applyMatrix4(inv);
      this.ponyArm.copy(hang.tip).applyMatrix4(inv).sub(this.ponyPiv);
      this.ponyG.set(0, -PONY_G, 0).applyQuaternion(this.headRestInv);
      this.ponyLen = this.ponyArm.length();
      this.ponyK = (PONY_K * PONY_L0) / Math.max(this.ponyLen, PONY_L0 / 2);
      this.ponyC = 2 * PONY_ZETA * Math.sqrt(this.ponyK);
      this.ponyOn = this.ponyLen > 0.03;
    }
    this.armR = [b('RightArm'), b('RightForeArm'), b('RightHand')];
    this.armL = [b('LeftArm'), b('LeftForeArm'), b('LeftHand')];
    // The hand's own axes, in the wrist's frame: along the middle finger, and across the knuckles from the little finger to the index.
    for (let i = 0; i < 2; i++) {
      const at = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(asset.restWorld[asset.bone((i === 0 ? 'Right' : 'Left') + n)]!);
      const wrist = at('Hand'), Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(asset.restWorld[asset.bone(i === 0 ? 'RightHand' : 'LeftHand')]!)).invert();
      const F = at('HandMiddle1').sub(wrist).normalize(), K = at('HandIndex1').sub(at('HandPinky1'));
      K.addScaledVector(F, -K.dot(F)).normalize();
      this.handAxes.push(F.applyQuaternion(Q), K.applyQuaternion(Q));
    }
    this.elbowR = elbowHinge(asset, 'RightForeArm');
    this.elbowL = elbowHinge(asset, 'LeftForeArm');
    const gc = guardCaps(asset);
    this.guardBones = gc.bones;
    this.guardR = gc.r;
    this.kneeL = elbowHinge(asset, 'LeftLeg').hinge;
    this.kneeR = elbowHinge(asset, 'RightLeg').hinge;
    this.legL = [b('LeftUpLeg'), b('LeftLeg'), b('LeftFoot')];
    this.legR = [b('RightUpLeg'), b('RightLeg'), b('RightFoot')];
    this.toes = [b('LeftToeBase'), b('RightToeBase')];
    let soles = SOLES.get(asset);
    if (!soles) { soles = fitSoles(asset); SOLES.set(asset, soles); }
    this.soles = soles;
    v1.setFromMatrixPosition(asset.restWorld[asset.bone('LeftUpLeg')]!);
    v2.setFromMatrixPosition(asset.restWorld[asset.bone('LeftLeg')]!);
    v3.setFromMatrixPosition(asset.restWorld[asset.bone('LeftFoot')]!);
    this.legLen = v1.distanceTo(v2) + v2.distanceTo(v3);
    this.legK = asset.legScale ?? 1;
    this.hipW = Math.abs(v1.x);
    this.ankleY = v3.y;
    this.ballLen = Math.abs(v3.z - v1.setFromMatrixPosition(asset.restWorld[asset.bone('LeftToeBase')]!).z);
    for (let f = 0; f < 2; f++) {
      const n = f === 0 ? 'Left' : 'Right';
      asset.restWorld[asset.bone(n + 'Foot')]!.decompose(v1, this.footRestQ[f]!, v2);
      this.footFwd[f]!.set(0, 0, 1).applyQuaternion(qFoot.copy(this.footRestQ[f]!).invert());
      this.footSide[f]!.set(1, 0, 0).applyQuaternion(qFoot);
      if (f === 0) {
        const sw = v1.setFromMatrixPosition(asset.restWorld[asset.bone('LeftArm')]!).distanceTo(v2.setFromMatrixPosition(asset.restWorld[asset.bone('RightArm')]!));
        this.trunkW = sw * 0.42;
        this.trunkD = sw * 0.27;
      }
      asset.restWorld[asset.bone(n + 'ToeBase')]!.decompose(v1, this.toeRestQ[f]!, v2);
      this.toeRestLocal[f]!.copy(this.footRestQ[f]!).invert().multiply(this.toeRestQ[f]!);
    }
    this.clips = {
      idle: asset.clip('idle'),
      cycle: [asset.clip('jog'), asset.clip('run'), asset.clip('strafeLeft'), asset.clip('runBack'), asset.clip('strafeRight')],
      celebrate: asset.clip('celebrate'),
      dejected: asset.clip('dejected'),
    };
    this.matcher = Avatar.motion === 2 ? new Matcher(asset, this.clips.cycle) : null;
    this.standPose.t = 0;
    sampleClip(this.clips.celebrate, this.standPose);
    this.upper = new Uint8Array(this.nb);
    const spineIdx = asset.bone('Spine');
    for (let i = 0; i < this.nb; i++) {
      for (let j = i; j >= 0; j = asset.bones[j]!.parent) if (j === spineIdx) { this.upper[i] = 1; break; }
    }

    const rw = asset.restWorld;
    const bp = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(rw[asset.bone(n)]!);
    this.armLen = bp('RightArm').distanceTo(bp('RightForeArm')) + bp('RightForeArm').distanceTo(bp('RightHand'));
    this.shoulderUp = bp('RightArm').y - READY_SHOULDER;
    this.manner = (MANNERS as unknown as Record<string, Manner>)[personOf(asset.look?.name ?? '')] ?? PLAIN_MANNER;
    // (from the person as modelled: a body the creator shortened had the whole difference, a 0.65 m hop on a 0.43 m leg, the knee spun round)
    this.jumpMore = Math.max(0, JUMP_HEIGHT - (asset.look?.height ?? JUMP_HEIGHT) / (asset.heightScale ?? 1)) * JUMP_SHORT;
    this.grips = [this.makeGrip(asset, 'Right'), this.makeGrip(asset, 'Left')];
    const lim = new Float64Array(this.nb);
    this.inertiaSkip = new Uint8Array(this.nb);
    for (let i = 0; i < this.nb; i++) {
      const l = JOINT_LIMITS[asset.bones[i]!.name];
      lim[i] = l === undefined ? 0 : (1.25 * l * Math.PI) / 180;
      this.inertiaSkip[i] = l === undefined ? 1 : 0;
    }
    this.inertia = new Inertializer(lim);
    this.headInertia = new Inertializer(lim);
    this.headSkip = new Uint8Array(this.nb).fill(1);
    this.headSkip[asset.bone('Neck')] = 0;
    this.headSkip[asset.bone('Head')] = 0;
    this.yawI.wrapAngle = true;
    this.kyawI.wrapAngle = true;
    this.grip = this.grips[0]!;
    this.armRacket = this.armR;
    this.armFree = this.armL;
    this.elbowRacket = this.elbowR;
    this.elbowFree = this.elbowL;
    this.racket = makeRacket();
    this.setHanded(1);
  }

  /** The grip for one hand ('Right' or 'Left'), solved from this body's hand (grip.ts). */
  private makeGrip(asset: PlayerAsset, side: string): Grip {
    const s = solveGrip(asset, side);
    return {
      hand: this.bones[asset.bone(side + 'Hand')]!,
      pos: s.pos, off: s.wrist.clone().negate(), q: s.q, qInv: s.q.clone().invert(), bones: s.bones, quats: s.quats, cord: makeWristCord(s.wrist, s.forearm, s.wristR),
    };
  }

  /**
   * The kit's inputs: sweat from the match's length and the metres run; the hems' lag from a spring (about 2 Hz,
   * damped) chasing the body, so they trail when it speeds up, stops or lands, and hang straight on a steady run.
   */
  private dress(sim: MatchSim, cut: boolean, dt: number, rx: number, rz: number, yRoot: number): void {
    const k = this.kit;
    const X = this.root.position.x, Y = this.lift, Z = this.root.position.z;
    if (cut || dt <= 0) {
      if (cut || !this.clothOn) {
        this.clothOn = true;
        this.clothX = X; this.clothY = Y; this.clothZ = Z;
        this.clothVX = this.clothVY = this.clothVZ = 0;
        this.bodyVX = this.bodyVY = this.bodyVZ = 0;
      }
      this.lastLift = Y;
      if (!cut || !k) return;
    } else {
      this.bodyVX = rx / dt;
      this.bodyVY = (Y - this.lastLift) / dt;
      this.bodyVZ = rz / dt;
      this.lastLift = Y;
      this.ran += Math.sqrt(rx * rx + rz * rz);
      // Spring towards the body, damped against the body's own velocity: a steady run has no lag, a change of pace
      // swings the hem by about a / CLOTH_K.
      const h = Math.min(dt, 1 / 30);
      this.clothVX += (CLOTH_K * (X - this.clothX) + CLOTH_C * (this.bodyVX - this.clothVX)) * h;
      this.clothVY += (CLOTH_K * (Y - this.clothY) + CLOTH_C * (this.bodyVY - this.clothVY)) * h;
      this.clothVZ += (CLOTH_K * (Z - this.clothZ) + CLOTH_C * (this.bodyVZ - this.clothVZ)) * h;
      this.clothX += this.clothVX * h;
      this.clothY += this.clothVY * h;
      this.clothZ += this.clothVZ * h;
    }
    if (!k) return;
    let ox = this.clothX - X, oy = this.clothY - Y, oz = this.clothZ - Z;
    const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (d > CLOTH_MAX) {
      ox *= CLOTH_MAX / d; oy *= CLOTH_MAX / d; oz *= CLOTH_MAX / d;
    }
    // World offset into the body's frame (the mesh turns with the root).
    const c = Math.cos(yRoot), s = Math.sin(yRoot);
    const lag = k.lag.value;
    lag.x = ox * c - oz * s;
    lag.y = oy;
    lag.z = ox * s + oz * c;
    if (k.sway) {
      const a = this.gaitW * smoothstep(RUN_V0, RUN_V1, this.sp), ph = 2 * Math.PI * this.gaitPhase, w = k.sway.value;
      w.x = HAIR_THROW * a * Math.sin(ph);
      w.y = HAIR_BOB * a * Math.cos(2 * ph);
    }
    k.sweat.value.x = Avatar.sweatAt >= 0 ? Avatar.sweatAt : Math.min(1, sim.time / SWEAT_T + this.ran / SWEAT_M);
  }

  /** Switch the racket hand (the sim's `handed`): racket, grip, arms and stroke keys all follow. */
  /**
   * Put on pieces made in code (costume.ts), each on its bone; a one-sided piece shows on the arm it belongs to as the
   * player's hand changes. A modelled headband taken off, and hair pressed under a head piece, get geometry of this
   * avatar's own over the shared attributes (another player may be dressed as the same person).
   */
  wear(d: Dressing): void {
    const { pieces, bodyIndex, hair, paintedWrists } = d;
    this.kit?.wrist?.value.setX(paintedWrists ? 1 : 0);
    for (const p of pieces) {
      if (p.skinned) {
        // (on the skeleton, as the body is: bind pose, identity bind matrix)
        const sm = p.mesh as THREE.SkinnedMesh;
        sm.bind(this.mesh.skeleton, new THREE.Matrix4());
        sm.frustumCulled = false;
        this.root.add(sm);
      } else {
        const b = this.bones.find((x) => x.name === p.bone);
        if (!b) continue;
        b.add(p.mesh);
      }
      if (p.arm) this.sided.push(p);
    }
    if (bodyIndex) this.mesh.geometry = ownGeometry(this.mesh.geometry, bodyIndex, null);
    if (hair && this.hairMesh) this.hairMesh.geometry = ownGeometry(this.hairMesh.geometry, null, new THREE.BufferAttribute(hair, 3));
    this.showSided();
  }

  /** The hair, brows and lashes (null for the mannequin). */
  private hairMesh: THREE.SkinnedMesh | null = null;
  /** The face, with the expressions' morph targets (null without one). */
  private faceMesh: THREE.SkinnedMesh | null = null;

  /**
   * Low quality's simpler triangles for the body and face (lodCore.ts PERSON_LOD), made in a worker; until they come, and
   * wherever the camera is near enough to see the difference (pickLod), the full ones are drawn.
   */
  private lod: { meshes: THREE.Mesh[]; full: THREE.BufferAttribute[]; low: THREE.BufferAttribute[]; error: number } | null = null;
  private lodOn = false;
  /** (its skeleton, for the poses the simpler triangles are checked in) */
  private readonly lodAsset: PlayerAsset;

  /** Ask for the simpler triangles (after `wear`: they are made from the triangles worn). */
  async makeLod(): Promise<void> {
    const meshes: THREE.Mesh[] = [this.mesh];
    if (this.faceMesh) meshes.push(this.faceMesh);
    // (each its own geometry over the shared attributes: another player may be drawn from the same person)
    for (const m of meshes) m.geometry = ownGeometry(m.geometry, null, null);
    const full = meshes.map((m) => m.geometry.index!);
    // (checked in a lunge, a wide stance with the arms up and a crouch, and the face with its mouth open, eyes shut and smiling)
    const skins = lodSkins(this.lodAsset), morphs = this.lodAsset.look?.morphs ?? [];
    const done = await Promise.all(meshes.map((m, i) =>
      simplifyOffThread(full[i]!.array, positionsOf(m.geometry), PERSON_LOD, undefined, shapeOf(m.geometry, skins, morphs, LOD_MORPHS, POSE_WEIGHT))));
    if (done.some((d) => !d) || meshes.some((m, i) => m.geometry.index !== full[i])) return;
    this.lod = { meshes, full, low: done.map((d, i) => indexAttribute(d!.index, full[i]!)), error: Math.max(...done.map((d) => d!.error)) };
  }

  /** Draw the simpler triangles while they are within half a pixel of the full ones (`k`: lodCore pxPerMetreAt1). */
  pickLod(camPos: THREE.Vector3, k: number): void {
    const l = this.lod;
    if (!l) return;
    const on = lodWanted(l.error, v1.setFromMatrixPosition(this.hips.matrixWorld).distanceTo(camPos), k, this.lodOn);
    if (on === this.lodOn) return;
    this.lodOn = on;
    for (let i = 0; i < l.meshes.length; i++) l.meshes[i]!.geometry.setIndex(on ? l.low[i]! : l.full[i]!);
  }

  /**
   * Back to the full triangles for good, before the scene is freed: a geometry's dispose frees only the index it holds, so it
   * should hold the larger (the simpler one, a fifth of it, goes with its arrays).
   */
  dropLod(): void {
    const l = this.lod;
    if (!l) return;
    for (let i = 0; i < l.meshes.length; i++) l.meshes[i]!.geometry.setIndex(l.full[i]!);
    this.lod = null;
    this.lodOn = false;
  }

  /** Triangles the body and face draw now (tests, the perf tool). */
  get lodState(): { on: boolean; error: number; full: number; low: number } | null {
    const l = this.lod;
    if (!l) return null;
    let full = 0, low = 0;
    for (let i = 0; i < l.meshes.length; i++) { full += l.full[i]!.count / 3; low += l.low[i]!.count / 3; }
    return { on: this.lodOn, error: l.error, full, low };
  }

  private readonly sided: Piece[] = [];

  private showSided(): void {
    const racket = this.handed > 0 ? 'R' : 'L';
    for (const p of this.sided) p.mesh.visible = (p.side === racket) === (p.arm === 'racket');
  }

  /** Skin matrices are refreshed once per animation-loop frame; a render outside the loop calls this first. */
  refreshSkin(): void {
    this.root.updateMatrixWorld(true);
    this.mesh.skeleton.update();
  }

  private setHanded(h: number): void {
    this.handed = h;
    this.handF.copy(this.handAxes[h > 0 ? 0 : 2]!);
    this.handK.copy(this.handAxes[h > 0 ? 1 : 3]!);
    this.grip = this.grips[h > 0 ? 0 : 1]!;
    this.showSided();
    this.armRacket = h > 0 ? this.armR : this.armL;
    this.armFree = h > 0 ? this.armL : this.armR;
    this.elbowRacket = h > 0 ? this.elbowR : this.elbowL;
    this.elbowFree = h > 0 ? this.elbowL : this.elbowR;
    // The ready position's height follows the shoulders: the key is an absolute height, and on a taller body it hung the arm straight.
    const rk0 = h > 0 ? READY : READY_LEFT, up = this.shoulderUp;
    this.readyFit = { p: rk0.p.clone(), q: rk0.q, pole: rk0.pole.clone(), yaw: rk0.yaw, off: rk0.off.clone() };
    // (and its reach the arm's, about the shoulder, so everybody bends the elbow alike)
    const k = this.armLen / READY_ARM, fit = (o: THREE.Vector3): void => { o.y = READY_SHOULDER + up + (o.y - READY_SHOULDER) * k; o.z *= k; };
    fit(this.readyFit.p); fit(this.readyFit.off); fit(this.readyFit.pole);
    this.readyFit.p.y += this.manner.high; this.readyFit.off.y += this.manner.high;
    this.readyFit.p.z += this.manner.out; this.readyFit.off.z += this.manner.out;
    this.readyKey = this.readyFit;
    const ak = h > 0 ? SERVE_ADDRESS : SERVE_ADDRESS_LEFT;
    this.addrKey.p.copy(ak.p);
    this.addrKey.q.copy(ak.q);
    this.addrKey.pole.copy(ak.pole);
    this.addrKey.yaw = ak.yaw;
    this.addrKey.off.copy(ak.off);
    this.offPole = h > 0 ? OFF_POLE : OFF_POLE_LEFT;
    for (const g of this.grips) this.racket.remove(g.cord);
    this.racket.add(this.grip.cord);
    this.grip.hand.add(this.racket);
    this.racket.position.copy(this.grip.pos);
    this.racket.quaternion.copy(this.grip.q);
    this.fam = h > 0 ? FOREHAND : leftFamily(FOREHAND);
    this.st = ST_NONE;
    this.w = 0;
  }

  // ---- stance frame (model space of the feet, without the shoulder turn) ----

  /** Model-space point of the stance frame to world. */
  private toWorld(m: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const c = this.stanceC, s = this.stanceS;
    return out.set(this.root.position.x + m.x * c + m.z * s, m.y, this.root.position.z - m.x * s + m.z * c);
  }

  private toModel(w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const c = this.stanceC, s = this.stanceS;
    const dx = w.x - this.root.position.x, dz = w.z - this.root.position.z;
    return out.set(dx * c - dz * s, w.y, dx * s + dz * c);
  }

  private quatToWorld(m: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    return out.multiplyQuaternions(this.stanceQ, m);
  }

  // ---- strokes ----

  private pickFamily(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number, contra = false, left = Infinity, toBall = Infinity): Family {
    const f = contra ? (hand > 0 ? FH_CONTRA : BH_CONTRA) : this.pickRight(sim, p, idx, c, overhead, volley, hand);
    const fam = this.handed > 0 ? f : leftFamily(f);
    // A measured swing takes its own time: picked with `left` seconds to the ball, under TRACK_RUSH of its lead, it is the
    // keyed stroke (the only two clip-drawn hits in six hundred seconds that met the ball 11-12 cm off were the only two
    // picked under 0.2 s from it: a vibora at a ball by the ear in 0.135 s, the elbow at its rate's stop all the way).
    if (!fam.track || !fam.coded) return fam;
    if (left < fam.track.lead * TRACK_RUSH) return fam.coded;
    // And it is one swing, at one ball: turned about the shoulder onto a ball far from the one it was measured at, the
    // whole arm goes where no arm does (11 Nov 2026, the owner: "inverting, going into the body"; the frames with the
    // elbow inside the trunk were the swings turned 45-65 degrees, a backhand's arm straight through the chest). A ball
    // further off than TRACK_FIT_TURN, or nearer or further than TRACK_FIT_NEAR to TRACK_FIT_FAR of the clip's reach, is
    // the keyed stroke's, which is built to meet a ball anywhere. (Once keyed it stays so: the callers, and the margin.)
    // Asked only once the forward swing is about to start or has (`toBall` seconds to the ball, within TRACK_FIT_FROM of
    // the track's lead): before that the player is still on the way and the ball's place a guess (the first go asked at
    // every pick, and no clip's swing was ever played).
    return toBall >= fam.track.lead * TRACK_FIT_FROM || this.trackFits(fam.track, c, fam.high === true, this.fam === fam.coded ? TRACK_FIT_MARGIN : 0) ? fam : fam.coded;
  }

  /** Whether a track's swing meets the ball at `c` (world) nearly as the clip met its own: the turn about the racket shoulder
   * and the stretch trackKey would give it, from where the shoulder will be at the ball (the stand plan's place for the
   * player, the trunk's own way there off the track, a jump's rise). */
  private trackFits(tr: StrokeTrack, c: THREE.Vector3, high: boolean, margin: number): boolean {
    const rs = this.racketSh;
    if (Avatar.trackAny || (rs.x === 0 && rs.y === 0 && rs.z === 0)) return true;
    const at = this.fitA.copy(rs).add(this.shLegs);
    // (a jump's crouch before the take-off is not where the legs have the shoulder at the ball: asked from down there,
    // 0.18 m low, a smash fitted to its ball to 5-11 degrees was 1.3 of its reach away and never played)
    if (high) at.y -= this.shLegs.y;
    if (this.planOk) { at.x += this.planX - this.root.position.x; at.z += this.planZ - this.root.position.z; }
    this.toModel(at, at);
    at.x += tr.sh0.x - tr.sh[0]!;
    at.y += (tr.sh0.y - tr.sh[1]!) * TRACK_TILT + (high ? this.liftBall - this.lift : 0);
    at.z += tr.sh0.z - tr.sh[2]!;
    const c1 = this.toModel(c, this.fitB).sub(at), l1 = c1.length();
    if (l1 < 1e-4 || tr.c0len < 1e-4) return true;
    const k = l1 / tr.c0len;
    if (k < TRACK_FIT_NEAR + margin * 0.3 || k > TRACK_FIT_FAR - margin * 0.3) return false;
    return c1.dot(tr.c0) / (l1 * tr.c0len) >= Math.cos(TRACK_FIT_TURN - margin);
  }

  /** The stroke for a right-hander (`hand` +1 forehand, -1 backhand). */
  private pickRight(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number): Family {
    if (sim.phase <= PH_TOSS && sim.score.serverPlayer() === idx) return SERVE;
    // An AI holds power or precision only as it lets go: its intent says which overhead or topspin it is.
    const ai = sim.ai[idx];
    // While the key is held the modifiers being held say it; from the release on, the ones it was released with.
    const mod = p.swing === SW_CHARGE ? p.heldMod : p.mod;
    // (a ball dropped below what the overhead key can reach is the sim's slice or volley: the trophy held and a chop from 1.5 m at it left the ball going on its own)
    const low = overhead && c.y < p.tune.overheadHeight - (mod === MOD_PRECISION ? 0.53 : 0.3);
    if ((overhead && !low) || c.y > 1.8) {
      if (p.shot === SHOT_SMASH || mod === MOD_POWER || (ai !== null && ai !== undefined && ai.smash)) return SMASH;
      // The víbora: the overhead key with precision (the sim's SHOT_BANDEJA + MOD_PRECISION), or an AI's intent.
      if (p.shot === SHOT_VIBORA || (p.shot === SHOT_BANDEJA && mod === MOD_PRECISION) || (ai !== null && ai !== undefined && ai.vibora)) return VIBORA;
      return OVERHEAD;
    }
    if (volley) return hand > 0 ? VOLLEY_FH : VOLLEY_BH;
    const sh = p.shot;
    if (sh === SHOT_TOPSPIN && (mod === MOD_PRECISION || (ai !== null && ai !== undefined && ai.chiquita))) return hand > 0 ? FH_CHIQUITA : BH_CHIQUITA;
    if (sh === SHOT_SLICE || low) return hand > 0 ? FH_SLICE : BH_SLICE;
    if (sh === SHOT_LOB) return hand > 0 ? FH_LOB : BH_LOB;
    if (sh === SHOT_DROP) return hand > 0 ? FH_DROP : BH_DROP;
    return hand > 0 ? FOREHAND : BACKHAND;
  }

  /** Forehand (+1) or backhand (-1) side of a contact point, for a right-hander facing the net. */
  private handOf(sim: MatchSim, p: Player, c: THREE.Vector3): number {
    return (c.x - p.pos.x) * sim.side(p.team) * p.handed >= 0 ? 1 : -1;
  }

  /** The predicted ball at time t (world). */
  private predAt(sim: MatchSim, t: number, out: THREE.Vector3): THREE.Vector3 {
    const pr = sim.pred;
    const i = pr.indexAt(t);
    // Between the samples either side (a tick apart): the sample at or before t alone put the racket up to a
    // tick's flight (8-17 cm at rally speeds) behind the ball.
    // (the last sample has none after it: reading past the end, even times nothing, gave NaN, and that player's bones
    // stayed NaN for the rest of the match, the player gone from the picture; review round 15, the sceptic)
    if (i < 0) return out;
    if (i + 1 >= pr.n) return out.set(pr.x[i]!, pr.y[i]!, pr.z[i]!);
    let f = (t - pr.start) / DT - i;
    if (!(f > 0)) f = 0;
    else if (f > 1) f = 1;
    out.x = pr.x[i]! + (pr.x[i + 1]! - pr.x[i]!) * f;
    out.y = pr.y[i]! + (pr.y[i + 1]! - pr.y[i]!) * f;
    out.z = pr.z[i]! + (pr.z[i + 1]! - pr.z[i]!) * f;
    return out;
  }

  /** Snapshot the current blended key, so a new phase starts from wherever the racket is. */
  private snapshot(): void {
    this.from.p.copy(this.kp);
    this.from.q.copy(this.kq);
    this.from.pole.copy(this.kpole);
    this.from.off.copy(this.koff);
    this.from.yaw = this.kyaw;
  }

  /** The family's free hand from its place at `i` (of Family.free) towards the next, by u. */
  private freeKey(a: number[], i: number, u: number): void {
    const K = this.kfree;
    K.x = a[i]! + (a[i + 3]! - a[i]!) * u;
    K.y = a[i + 1]! + (a[i + 4]! - a[i + 1]!) * u;
    K.z = a[i + 2]! + (a[i + 5]! - a[i + 2]!) * u;
  }

  private setKey(a: Key, b: Key, u: number): void {
    this.kp.copy(a.p).lerp(b.p, u);
    this.kq.copy(a.q).slerp(b.q, u);
    this.kpole.copy(a.pole).lerp(b.pole, u);
    this.koff.copy(a.off).lerp(b.off, u);
    this.kyaw = a.yaw + (b.yaw - a.yaw) * u;
  }

  /**
   * Contact key: the family's, at the ball, the racket head dropped for a low ball. A contact out of reach (a human
   * letting go while still running to the ball, a whiff) is swung at in its direction, no further out than
   * CON_REACH beyond the arm, and a whiff keeps the point it was swinging at: keyed 5 m out, then switched to the
   * family's own contact by the body at the release, the racket swept a metre in four frames and the arm flipped
   * 118 degrees (QA army, a bot letting go early).
   */
  private contactKey(): Key {
    const k = this.con;
    const f = this.fam;
    const sh = this.racketSh, cw = this.conW;
    const dx = cw.x - sh.x, dy = cw.y - sh.y, dz = cw.z - sh.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), R = this.armLen + CON_REACH;
    if (sh.x === 0 && sh.y === 0 && sh.z === 0) k.p.copy(f.contact.p);
    else if (d > R) {
      const u = R / d, cc = this.conClamp;
      cc.set(sh.x + dx * u, Math.min(CON_TOP, Math.max(CON_LOW, sh.y + dy * u)), sh.z + dz * u);
      this.toModel(cc, k.p);
    } else this.toModel(cw, k.p);
    k.q.copy(f.contact.q);
    // A measured swing is turned about the racket shoulder onto this ball (trackKey), and its racket at the ball with it:
    // the legs work the reach out from this key, and with the clip's own turn they put the hips where a racket turned
    // 50 degrees another way would have wanted them.
    if (f.track && !(sh.x === 0 && sh.y === 0 && sh.z === 0)) {
      const c1 = this.toModel(sh, this.conA).negate().add(k.p), l1 = c1.length(), tr = f.track;
      if (l1 > 1e-4 && tr.c0len > 1e-4) k.q.premultiply(this.conTurn.setFromUnitVectors(this.conB.copy(tr.c0).multiplyScalar(1 / tr.c0len), c1.multiplyScalar(1 / l1)));
      this.reachIn(k.p, k.q, this.toModel(sh, this.conA), 1);
    }
    if (f.wrist) this.reachFrom(k, f.wrist);
    else if (f.low) k.q.slerp(f.low, smoothstep(0.95, 0.4, k.p.y));
    if (f.tip) k.q.multiply(f.tip);
    k.pole.copy(f.contact.pole);
    k.yaw = f.contact.yaw;
    k.off.copy(f.contact.off);
    return k;
  }

  /** Where the racket waits: a volley's take-back goes with the ball's height (`con` holds this contact), so that a low
   * volley is a short punch with the legs under it, not an arm dropped from the shoulder (elbow 110 at -0.1 s, 31 at
   * contact: round 7, the pro's #4). */
  private backPoint(): THREE.Vector3 {
    const f = this.fam, big = this.manner.back;
    if (!f.wrist || !this.hasCon) {
      if (big === 1) return f.back.p;
      return this.backP.copy(f.contact.p).lerp(f.back.p, big);
    }
    const c = this.con.p, d = c.y - f.contact.p.y;
    const p = this.backP.copy(f.back.p);
    p.y += BACK_FOLLOW * (d < BACK_LOW ? BACK_LOW : d > BACK_HIGH ? BACK_HIGH : d);
    // Back from this ball, the way it will leave: put by the stance, the take-back stood wherever the feet happened to
    // point, and the last 100 ms went sideways and down with nothing towards the net (review round 15). In front of the
    // chest and on its own side whatever comes: a ball at the body is a short punch.
    const side = f.contact.p.x < 0 ? -1 : 1;
    const x = c.x + this.netZ * this.stanceS * PUNCH_BACK, z = c.z - this.netZ * this.stanceC * PUNCH_BACK;
    p.x = side * Math.max(PUNCH_SIDE, x * side);
    p.z = Math.max(PUNCH_FRONT, z);
    return p;
  }

  /** The take-back's racket: head up, and for a low volley already dropping to the ball, or a head-up racket a low ball's way
   * below it leaves the hand at the end of a straight arm (elbow at its stop until the hit, then 57; video 63 throughout). */
  private backTurn(k: Key): THREE.Quaternion {
    const f = this.fam;
    if (!f.wrist || !this.hasCon) return f.back.q;
    return this.backQ.copy(f.back.q).slerp(k.q, smoothstep(BACK_DROP0, BACK_DROP1, this.con.p.y - f.contact.p.y));
  }

  /** The key's racket turned the least way to point from the hand's place (Family.wrist) at the ball. */
  private reachFrom(k: Key, w: THREE.Vector3): void {
    const wy = Math.max(k.p.y - HAND_UNDER, Math.min(k.p.y + HAND_OVER, w.y));
    // The hand stays at that height however far out the ball is: the racket's end rises or drops by this much.
    const up = (k.p.y - wy) / HAND_TO_BALL;
    const hx = k.p.x - w.x, hz = k.p.z - w.z, hl = Math.sqrt(hx * hx + hz * hz) || 1, across = Math.sqrt(1 - up * up) / hl;
    shaftTo.set(hx * across, up, hz * across);
    shaftFrom.set(0, 1, 0).applyQuaternion(k.q);
    shaftTurn.setFromUnitVectors(shaftFrom, shaftTo);
    k.q.premultiply(shaftTurn);
  }

  /** Forward swing at progress s (0 = end of the backswing, 1 = the ball), into the blended key. */
  private swingKey(s: number): void {
    this.keyS = s;
    const f = this.fam;
    // A measured swing: the clip's own way to the ball, in its own time.
    if (f.track) {
      this.trackKey(f.track, -(1 - s) * f.track.lead, smoothstep(0, TRACK_BEND, s));
      return;
    }
    const k = this.contactKey();
    // Accelerating into the ball along a curve below (groundstrokes). An overhead has the ball here, and overKey draws
    // the way to it.
    const e = Math.pow(s, 1.7);
    if (f.over) {
      this.kp.copy(k.p);
      this.kq.copy(k.q);
    } else {
      const bp = this.backPoint();
      if (f.via) {
        // The control point that puts the curve through `via` at its moment: B(ev) = via.
        const ev = Math.pow(f.viaS ?? 0.5, 1.7), u = 1 - ev, c = 1 / (2 * ev * u);
        this.ctrl.copy(f.via).addScaledVector(bp, -u * u).addScaledVector(k.p, -ev * ev).multiplyScalar(c);
        // Let go with no swing begun, straighter: no time to go round.
        if (this.st === ST_SWING && this.relS === 0) this.ctrl.lerp(this.mid.copy(bp).lerp(k.p, 0.5), 1 - this.lagK);
      } else {
        this.ctrl.copy(bp).lerp(k.p, 0.5);
        this.ctrl.y -= f.dip;
        this.ctrl.z -= f.loop;
      }
      if (f.byHand) {
        const q0 = this.backTurn(k);
        this.overA.copy(this.grip.off).applyQuaternion(q0).negate().add(bp);
        this.overB.copy(this.grip.off).applyQuaternion(k.q).negate().add(k.p);
        this.ctrl.copy(this.overA).lerp(this.overB, 0.5);
        this.ctrl.y -= f.dip;
        this.ctrl.z -= f.loop;
        this.ctrl.x += (f.contact.p.x < 0 ? -1 : 1) * BY_HAND_OUT;
        bezier(this.overA, this.ctrl, this.overB, e, this.kp);
        this.kq.copy(q0).slerp(k.q, e);
        this.kp.add(this.overC.copy(this.grip.off).applyQuaternion(this.kq));
      } else {
        bezier(bp, this.ctrl, k.p, e, this.kp);
        this.kq.copy(this.backTurn(k)).slerp(k.q, e);
      }
    }
    this.kpole.copy(f.back.pole).lerp(k.pole, e);
    // (an overhead's free arm comes in as the chest comes round, ahead of the racket, by the swing's time)
    this.koff.copy(f.back.off).lerp(k.off, f.over ? smoothstep(0.1, 0.8, s) : e);
    if (f.free) this.freeKey(f.free, 0, e);
    this.kyaw = f.back.yaw + (k.yaw - f.back.yaw) * e;
  }

  /**
   * A measured swing's racket whose hand the arm cannot get to (a ball further out than the clip's swing reaches, the
   * racket across the arm's line as the clip held it): turned about its face's centre, the least way and by `g` of it,
   * until the arm can. The handle comes round towards the shoulder, as a player at full stretch holds it; the face's centre
   * stays on the ball. A backhand volley 1.5 m from the shoulder was met 12 cm off without (the hand 0.3 m short of its place).
   */
  private reachIn(p: THREE.Vector3, q: THREE.Quaternion, sh: THREE.Vector3, g: number): void {
    const u = this.rchA.copy(this.grip.pos).applyQuaternion(this.rchQ.multiplyQuaternions(q, this.grip.qInv)), r = u.length();
    const A = this.armLen * TRACK_ARM;
    const wx = p.x - u.x - sh.x, wy = p.y - u.y - sh.y, wz = p.z - u.z - sh.z;
    if (r < 1e-4 || wx * wx + wy * wy + wz * wz <= A * A) return;
    const to = this.rchB.copy(sh).sub(p), l = to.length();
    if (l < 1e-4) return;
    // (the hand on the sphere about the ball, the shoulder l from the ball: within the arm's length of it inside this cone)
    const cmin = Math.min(1, (l * l + r * r - A * A) / (2 * l * r));
    u.multiplyScalar(-1 / r);
    to.multiplyScalar(1 / l);
    const c0 = u.dot(to);
    if (c0 >= cmin) return;
    const axis = this.rchC.crossVectors(u, to), al = axis.length();
    if (al < 1e-5) return;
    q.premultiply(this.rchQ.setFromAxisAngle(axis.multiplyScalar(1 / al), (Math.acos(c0 < -1 ? -1 : c0) - Math.acos(cmin < -1 ? -1 : cmin)) * g));
  }

  /**
   * The stroke's key off its track (clipStroke.ts) at `tau` seconds from the ball. The racket and the elbow are kept as the
   * clip has them from the racket shoulder, and by `g` (0 the clip's own, 1 at the ball) that shape is turned about the
   * shoulder and stretched so the racket's centre at the ball is this contact's: a higher ball is the same swing swung
   * higher. The shoulder is last frame's (this frame's trunk isn't turned yet), as it was drawn; the turn is worked out
   * from the same one, so at the ball the key is the contact whatever the shoulder did.
   */
  private trackKey(tr: StrokeTrack, tau: number, g: number): void {
    const k = this.contactKey();
    sampleTrack(tr, tau);
    const sh = this.trSh, rs = this.racketSh;
    if (rs.x === 0 && rs.y === 0 && rs.z === 0) sh.copy(TS.sh);
    else {
      // The shoulder as it is drawn: racketSh is taken before the legs lean the hips to the ball and stand them up
      // (solveLegs), 17 cm from the drawn one at a smash's full reach, and a swing hung from there sat that far off the
      // arm: the drop's hand 0.4 m behind the chest. (What solveArms adds of it after the ball is left to it.)
      const c = this.stanceC, s = this.stanceS, L = this.shLegs, u = 1 - this.finishU;
      this.toModel(rs, sh);
      sh.x += (L.x * c - L.z * s) * u; sh.y += L.y * u; sh.z += (L.x * s + L.z * c) * u;
    }
    const part = this.trPart.identity();
    let stretch = 1;
    if (g > 0) {
      // The turn and the stretch are the ball's from where the shoulder will be when it is met, not from where it is on
      // the way: the trunk's own way there (the track's shoulder, as the trunk takes its tilt) and what is left of a
      // jump's rise. From the shoulder of the moment, a smash's swing 0.2 s out (the shoulder 0.35 m under where it
      // meets the ball: the jump just begun, the racket shoulder still the low one) was stretched by a half, the hand
      // half a metre behind the spine on a straight arm where the clip has it folded by the neck.
      const at = this.trAt.copy(sh);
      if (tau < 0) {
        at.x += tr.sh0.x - TS.sh.x;
        at.y += (tr.sh0.y - TS.sh.y) * TRACK_TILT + this.liftBall - this.lift;
        at.z += tr.sh0.z - TS.sh.z;
      }
      const c1 = this.trA.copy(k.p).sub(at), l1 = c1.length();
      if (l1 > 1e-4 && tr.c0len > 1e-4) {
        this.trTurn.setFromUnitVectors(this.trB.copy(tr.c0).multiplyScalar(1 / tr.c0len), c1.multiplyScalar(1 / l1));
        part.slerp(this.trTurn, g);
        stretch = 1 + (l1 / tr.c0len - 1) * g;
      }
    }
    this.kp.copy(TS.p).sub(TS.sh).applyQuaternion(part).multiplyScalar(stretch).add(sh);
    this.kq.copy(part).multiply(TS.q);
    if (g > 0) this.reachIn(this.kp, this.kq, sh, g);
    this.kpole.copy(TS.pole).sub(TS.sh).applyQuaternion(part).add(sh);
    this.koff.copy(TS.off);
    this.kyaw = TS.yaw;
    this.trTilt = TS.tilt;
    this.trBow = TS.bow;
  }

  /**
   * Where the follow-through ends. A volley's finish is the family's step on from wherever this ball was met: going on to
   * a fixed place, the racket took 6 m/s into the ball and left it at 14, the ball meeting a still racket that then
   * lurched off. A volley stops short by the ball.
   */
  private finishKey(f: Family, k: Key): Key {
    if (!f.wrist) return f.finish;
    const c = f.contact, e = f.finish, K = this.finKey;
    K.p.copy(k.p).add(e.p).sub(c.p);
    K.q.copy(c.q).conjugate().premultiply(e.q).multiply(k.q);
    K.pole.copy(e.pole);
    K.off.copy(e.off);
    K.yaw = e.yaw;
    return K;
  }

  /** The contact this player is set up for (world, into conW) and when; -1 if none. */
  private planned(sim: MatchSim, idx: number): number {
    if (sim.phase === PH_TOSS && sim.score.serverPlayer() === idx && sim.rally.hitter < 0) {
      // An AI server lets go at its own moment, and one after the ideal is the contact (an early one waits for it).
      const ai = sim.ai[idx];
      // A human's a little late, where most Good releases fall: a racket timed to the ideal itself got there, the ball
      // near its top and all but still, stood by it and snapped (a third of serves; review round 17, the biomechanist's #5).
      const at = ai ? (ai.pressed && !ai.released && ai.releaseAt > sim.tossIdeal ? ai.releaseAt : sim.tossIdeal) : sim.tossIdeal + SERVE_LATE;
      this.known = ai !== null && ai !== undefined;
      // (not the last rally's: a serve held as beaten waited at the backswing and swung 0.1 s late)
      this.beaten = false;
      this.predAt(sim, at, this.conW);
      return at;
    }
    this.known = false;
    this.beaten = false;
    const st = this.plan(sim, idx);
    // An AI lets go at its own release time (the window it tracks, its timing error included); a late release is
    // the contact, an early one meets the ball at the window's ideal moment: time the swing to that, at wherever
    // the ball will be then (timed to an early release, the overhead's target jumped 27 cm at the release and the
    // forearm turned 82 degrees in a frame; QA army). Also with no stand plan: a reflex block at a ball coming at
    // the body has none, and the racket waited at the chest and had 40 ms to get down to a ball at the shins
    // (19 cm above it; review round 3, critic #2).
    const ai = sim.ai[idx];
    this.beaten = ai ? ai.beaten : false;
    if (!st.valid && !(ai && ai.pressed && !ai.released && ai.releaseAt > sim.time - 0.05)) return -1;
    if (ai && ai.pressed && !ai.released && ai.releaseAt > sim.time - 0.05) {
      this.known = true;
      const at = ai.releaseAt > ai.releaseIdeal ? ai.releaseAt : ai.releaseIdeal;
      this.predAt(sim, at, this.conW);
      return at;
    }
    // A human is shown the ring's moment and will let go on it, so that is what the swing is timed to: the plan's own was
    // up to 50 ms sooner on a volley, a racket sent 0.8 m up the ball's line that then came back with it (review round 15).
    // That moment moves with the player, and a moment 20 ms on is 40 cm further along a volley's ball: smoothed, or the
    // take-back behind it jumped about in the last fifth of a second (twice the AI's path; review round 16, the coach's #6).
    const ring = ai ? -1 : sim.focusIdeal(idx);
    if (ring >= 0) {
      const off = ring - this.ringT;
      this.ringT = this.lastSwing !== SW_CHARGE || Math.abs(off) > RING_JUMP ? ring : this.ringT + off * (1 - Math.exp(-this.dt / RING_TAU));
      this.predAt(sim, this.ringT, this.conW);
      return this.ringT;
    }
    this.conW.set(st.bx, st.by, st.bz);
    return st.t;
  }

  /**
   * How far along a human's swing is, s being how far it would be were the plan's moment the release. A swing stopped
   * short of the ball stood still in the air for 50-100 ms and then jumped half a metre in a frame: this one slows
   * down instead, and is still closing on the ball when the release comes (review round 13). The slowing starts at the
   * plan's moment, not before it: started earlier, even a Perfect release fell to a third of the speed and then snapped
   * through the ball in a frame, and the better you timed it the worse it looked (review round 15). What is left at a
   * release that came on the moment is about a frame of quick swing, MIN_SWING's rate putting it 7 ms behind the ball.
   */
  private hover(s: number): number {
    const on = s - HOVER_BEHIND, from = 1 - HOVER_BEHIND;
    return on <= from ? on : from + HOVER_EASE * (1 - Math.exp((from - on) / HOVER_EASE));
  }

  /** The player's stand plan: the AI's own, or the sim's for a human. */
  private plan(sim: MatchSim, idx: number): Readonly<StandPlan> {
    const ai = sim.ai[idx];
    return ai ? ai.standPlan : sim.stand[idx]!;
  }

  /**
   * The stroke timeline. The sim grades the release against the contact moment itself (a perfect release IS
   * the contact), so a swing that only started at the release would always arrive late. Instead the forward
   * swing starts while the key is still held, timed to the planned contact; it hovers just short of the ball
   * until the release, then finishes exactly at the sim's contact moment.
   */
  private updateStroke(sim: MatchSim, p: Player, idx: number, t: number): void {
    const sw = p.swing;
    const st = this.plan(sim, idx);
    this.planOk = st.valid;
    this.planX = st.x;
    this.planZ = st.z;
    // A hit moves lastContact; a whiff only stamps lastContactTime.
    const hit = p.lastContactTime !== this.lastHit
      && (p.lastContact.x !== this.lastHitX || p.lastContact.y !== this.lastHitY || p.lastContact.z !== this.lastHitZ);
    if (sw === SW_CHARGE) {
      if (this.lastSwing !== SW_CHARGE) {
        this.snapshot();
        this.prepStart = t;
        this.prepFromW = this.w;
        this.st = ST_PREP;
        this.overPrev.set(0, 0, 0, 0);
        this.swingS = 0;
        this.holdW = -1;
        if (this.w === 0) this.nearW = 0;
      }
      const tp = this.planned(sim, idx);
      this.hasCon = tp >= 0;
      this.tPlan = tp;
      // Off the back glass: side-on to the racket side while the ball, on this side, still goes towards it.
      const side = sim.side(p.team);
      // The sim's own word on it, not the plan's: an AI that gives up a contrapared to block what comes at it leaves
      // the plan saying contrapared, and the body played that with its back to the net (review round 9, the pro's #1).
      const contra = sim.contraGlass(idx) > 0;
      const planned = st.valid && st.contra === contra;
      this.contraHeld = contra;
      if (planned) this.hand = st.hand;
      this.wallWant = st.valid && st.afterWall && !contra && sim.phase === PH_RALLY && sim.ball.pos.z * side > 0 ? 1 : 0;
      if (this.swingS === 0) {
        // Re-aimed while the plan changes (the ball may cross to the other side); a change of stroke blends
        // over from wherever the racket is rather than jumping.
        if (!this.hasCon) this.conW.set(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
        const hand = planned ? st.hand : this.handOf(sim, p, this.conW) * (contra ? -1 : 1);
        // (a stroke stays the one its backswing began as: only the first pick of a backswing can be the rushed one)
        const first = this.lastSwing !== SW_CHARGE;
        let fam = this.pickFamily(sim, p, idx, this.conW, st.valid && st.overhead, st.valid && st.volley, hand, contra, first && this.hasCon ? tp - t : Infinity, this.hasCon ? tp - t : Infinity);
        if (!first && fam.coded && this.fam === fam.coded) fam = fam.coded;
        if (fam !== this.fam && t - this.prepStart > 0.03) {
          this.snapshot();
          this.prepStart = t;
          this.prepFromW = this.w;
        }
        this.fam = fam;
      }
      const lead = this.fam.lead ?? LEAD;
      // A human's release can come at any moment, so the swing waits short of the ball for it; an AI's moment is
      // known, and its swing runs straight into the ball.
      // An AI that sees the ball won't pass within its reach holds the backswing (it stands down at the release
      // rather than swing at the air; the swing went 90-100% of the way into nothing before this).
      if (this.hasCon && tp - t < lead && !this.beaten) {
        // Never faster than the quickest swing (a backswing held while beaten and let go late jumped to nearly
        // done in one frame and snapped the elbow).
        const cap = this.swingS + this.dt / (MIN_SWING * this.fam.punch);
        const s = 1 - (tp - t) / lead;
        this.swingS = Math.max(this.swingS, Math.min(this.known ? Math.min(s, 1) : this.hover(s), cap));
        // The plan's moment goes by and the ball goes on, so the racket follows it: a release now strikes it now.
        if (!this.known && t > tp) this.predAt(sim, t, this.conW);
      }
    }
    // Release (a whiff at release goes straight to recover): finish the swing at the contact moment. The wall turn
    // holds through the forward swing to the contact.
    if ((sw !== SW_CHARGE && sw !== SW_COMMITTED) || hit) this.wallWant = 0;
    const released = (sw === SW_COMMITTED && this.lastSwing !== SW_COMMITTED)
      || (sw === SW_RECOVER && this.lastSwing === SW_CHARGE)
      || (hit && this.st === ST_NONE);
    if (released) {
      if (this.st !== ST_PREP) { this.snapshot(); this.swingS = 0; }
      // The swing's progress (relS) is last frame's: carry on from then, so this frame already moves (starting the
      // rest of the swing now held the racket still for a frame and then jumped).
      this.tRel = t - this.dt;
      this.relBlend = false;
      this.relS = this.swingS;
      this.relW = this.st === ST_PREP ? this.w : 0;
      // Released and struck within one tick (the AI often lets go right at the ball): the hit is the contact.
      this.hasCon = sw === SW_COMMITTED || hit;
      if (hit) this.conW.set(p.lastContact.x, p.lastContact.y, p.lastContact.z);
      else if (this.hasCon) this.predAt(sim, p.contactTime, this.conW);
      // A forward swing already under way keeps its stroke. Otherwise the stroke is picked for the contact the
      // sim is actually taking, which can be far from the plan (an AI turns a planned groundstroke into a reflex
      // volley at the body), and a backswing built for another stroke blends over into it.
      // (a strike clears p.contra: released and struck in one tick, what was held is what was struck)
      const contra = sw === SW_COMMITTED ? p.contra : this.contraHeld;
      if (this.hasCon && (this.st !== ST_PREP || this.swingS === 0 || (this.fam.glass ?? false) !== contra)) {
        const fresh = !st.valid || st.contra !== contra || Math.abs(st.t - (hit ? p.lastContactTime : p.contactTime)) > 0.12;
        const vol = fresh
          ? (hit ? this.prevBounces : sim.rally.bounces) === 0 && (p.shot === SHOT_DRIVE || p.shot === SHOT_SLICE)
          : st.volley;
        // (facing the glass the forehand is the other side)
        const hand = fresh ? this.handOf(sim, p, this.conW) * (contra ? -1 : 1) : st.hand;
        let fam = this.pickFamily(sim, p, idx, this.conW, !fresh && st.overhead, vol && !contra, hand, contra, (hit ? p.lastContactTime : p.contactTime) - t, 0);
        if (this.st === ST_PREP && fam.coded && this.fam === fam.coded) fam = fam.coded;
        if (this.st === ST_PREP && fam !== this.fam) { this.snapshot(); this.relBlend = true; }
        this.fam = fam;
      }
      // (from tRel, the moment relS is: counted from this frame the last of the swing took a frame longer than it had,
      // and the racket fell by a quarter just at the ball; review round 9, the critic's #8)
      // (the ball gone before the swing started: it takes the quickest way, and is still 40 cm behind it; one hit in forty, the arm swinging at nothing; review round 29)
      this.tCon = Math.max(hit ? p.lastContactTime : this.hasCon ? p.contactTime : t, this.tRel + (1 - this.relS) * (hit ? MIN_CAUGHT : MIN_SWING) * this.fam.punch);
      this.st = ST_SWING;
    } else if (this.st === ST_SWING && sw === SW_COMMITTED) {
      this.predAt(sim, p.contactTime, this.conW);
    }
    // The real contact: where the ball actually was.
    if (hit && this.st === ST_SWING) this.conW.set(p.lastContact.x, p.lastContact.y, p.lastContact.z);
    this.lastHit = p.lastContactTime;
    this.lastHitX = p.lastContact.x;
    this.lastHitY = p.lastContact.y;
    this.lastHitZ = p.lastContact.z;
    // A backswing dropped without a swing (the partner took the ball): let go from where it is.
    if (this.st === ST_PREP && sw !== SW_CHARGE) this.fadeOut(t, this.w);
    this.lastSwing = sw;
    this.prevBounces = sim.rally.bounces;

    const f = this.fam;
    if (this.st === ST_PREP) {
      this.lagK = 1;
      const left = this.hasCon ? this.tPlan - this.prepStart : PREP;
      const prep = (f.prep ?? PREP) * this.manner.tempo;
      const u = smoothstep(0, left * PREP_SHARE < prep ? Math.max(PREP_MIN, left * PREP_SHARE) : prep, t - this.prepStart);
      if (this.swingS > 0) this.swingKey(this.swingS);
      else {
        // Held at the end of the backswing: no forward swing yet (keyS is what the racket clear's release reads; the
        // last stroke's 0.99 left over here cancelled its carried push on almost every backswing frame).
        this.keyS = 0;
        this.setKey(f.back, f.back, 1);
        if (f.free) this.freeKey(f.free, 0, 0);
        if (f.track) this.trackKey(f.track, -f.track.lead, 0);
        else if (!f.wrist) this.kp.copy(this.backPoint());
        else if (this.hasCon) {
          this.contactKey();
          this.kp.copy(this.backPoint());
          this.kq.copy(this.backTurn(this.contactKey()));
        }
      }
      if (this.prepFromW > 0 && u < 1) this.blendFrom(u);
      // (a serve is a stroke of its own, and an overhead is up with the free arm long before the ball)
      const held = sim.phase !== PH_RALLY || f.over || f.high ? 1 : this.hasCon ? HOLD_CARRY + (1 - HOLD_CARRY) * smoothstep(HOLD_FAR, HOLD_NEAR, this.tPlan - t) : HOLD_CARRY;
      const lim = HOLD_RATE * this.dt, off = held - this.holdW;
      this.holdW = this.holdW < 0 ? held : this.holdW + (off > lim ? lim : off < -lim ? -lim : off);
      this.w = this.prepFromW + (this.holdW - this.prepFromW) * u;
      this.overIn = u;
    } else if (this.st === ST_SWING) {
      if (t < this.tCon) {
        const g = clamp01((t - this.tRel) / (this.tCon - this.tRel));
        // A late release runs the rest of the swing in less time: less of a racket drop, or the hand turns 107 degrees in
        // a frame. Eased in: at half a step a frame it moved the whole of the arm's way at the release, the racket from 5 m/s to
        // 28 in a frame and slowing into the ball.
        const lead = (this.tCon - this.tRel) / ((1 - this.relS) * (f.lead ?? LEAD));
        this.lagK += ((lead < 1 ? lead : 1) - this.lagK) * (1 - Math.exp(-this.dt / LAG_EASE));
        this.swingKey(this.relS + (1 - this.relS) * g);
        if (this.dt > 0) this.swingV = this.kp.distanceTo(this.kpWas) / this.dt;
        this.kpWas.copy(this.kp);
        if (this.relBlend) this.blendFrom(smoothstep(0, 0.7, g));
        this.overIn = this.relBlend ? smoothstep(0, 0.7, g) : 1;
        this.w = this.relW + (1 - this.relW) * smoothstep(0, 0.06, t - this.tRel);
      } else if (t < this.tCon + (f.follow ?? FOLLOW) * this.manner.follow) {
        // Follow-through, slowing down, carrying on through the ball before wrapping round.
        const s = clamp01((t - this.tCon) / ((f.follow ?? FOLLOW) * this.manner.follow));
        if (f.track) {
          // (the clip's own way out of the ball, in its own time, turning back from this ball's place to the clip's)
          this.trackKey(f.track, s * f.track.follow, 1 - smoothstep(0, TRACK_UNBEND, s));
          this.w = 1;
          this.finishTo = s;
        } else {
        const k = this.contactKey();
        const fin = this.finishKey(f, k);
        const hand = f.way || (f.over && !f.over.under);
        // (an overhead goes on the way it came, over the top, before it wraps down)
        if (hand) this.overPath(k, fin);
        else {
          this.ctrl.copy(k.p).lerp(fin.p, 0.5);
          this.ctrl.z += f.through ?? (f.wrist ? PUNCH_THROUGH : 0.25);
          if (f.through) this.ctrl.y += THROUGH_UP;
        }
        // Leaving the ball at the speed it arrived: the racket fell to 60% of it in a frame, and the hit read as a stop
        // (review round 8, the critic's #4).
        const away = hand ? this.overAt(k, fin, 0.1) * 10 : 2 * k.p.distanceTo(this.ctrl);
        const n = (this.swingV * (f.follow ?? FOLLOW) * this.manner.follow) / Math.max(0.05, away);
        const top = f.over ? FOLLOW_N_OVER : FOLLOW_N, ks = (n < 2 ? 2 : n > top ? top : n) / FOLLOW_QUICK;
        const e = FOLLOW_QUICK * (1 - Math.exp(-ks * s)) / (1 - Math.exp(-ks)) + (1 - FOLLOW_QUICK) * s * s * (3 - 2 * s);
        if (hand) this.overAt(k, fin, e);
        else {
          bezier(k.p, this.ctrl, fin.p, e, this.kp);
          this.kq.copy(k.q).slerp(fin.q, e);
        }
        this.kpole.copy(k.pole).lerp(f.finish.pole, e);
        this.koff.copy(k.off).lerp(f.finish.off, e);
        if (f.free) this.freeKey(f.free, 3, e);
        this.kyaw = k.yaw + (f.finish.yaw - k.yaw) * e;
        this.w = 1;
        this.finishTo = e;
        }
      } else {
        const fin = this.finishKey(f, this.contactKey());
        if (f.track) this.trackKey(f.track, f.track.follow, 0);
        else this.setKey(fin, fin, 1);
        if (f.free) this.freeKey(f.free, 3, 1);
        this.fadeOut(this.tCon + (f.follow ?? FOLLOW) * this.manner.follow, 1);
        this.finishTo = 1;
      }
    }
    if (this.st === ST_PREP || (this.st === ST_SWING && t < this.tCon) || this.st === ST_NONE) this.finishTo = 0;
    if (this.st === ST_FADE) {
      this.setKey(this.from, this.from, 1);
      const u = smoothstep(this.fadeStart, this.fadeStart + this.fadeLen, t);
      this.w = this.fadeFromW * (1 - u);
      if (u >= 1) {
        this.st = ST_NONE;
        this.w = 0;
        // A measured stroke leaves the key the keyed one would have. The next stroke starts from the last one's final key however long
        // ago that was (none of it shows by then, but its way up to the new take-back begins there): a slice 15 s after a smash that the
        // clip finishes by the racket-side hip took its racket up from there, through the body, and the arm, pushed clear of it for a
        // quarter of a second, met the ball 27 cm off (6 after the keyed smash, which finishes in front of the free hip).
        // (from the ready position instead, for every stroke: that slice the same 6 cm, but a vibora from rest 23.6 cm off where it was 4.4)
        const c = this.fam.track ? this.fam.coded : undefined;
        if (c) {
          this.setKey(c.finish, c.finish, 1);
          this.kpI.reset(); this.kqI.reset(); this.kpoleI.reset(); this.koffI.reset(); this.kyawI.reset();
        }
      }
    } else if (this.st === ST_NONE) {
      this.w = 0;
    }
    // (the swing's way in while the key is still held too: an AI lets go at the ball, and its one frame of ST_SWING is
    // the contact's, so the smoothing's offset was still there at the ball)
    const end = this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.swingS > 0 && this.hasCon ? this.tPlan : -1;
    this.keepCon = end >= t ? (end - t) / (end - t + this.dt) : 1;
    if (this.inertial && (Avatar.inertMask & 24) !== 0) { this.keyT = t; this.smoothKey(); }
    // Low balls: bend the knees (contact or plan height), scaled by the stroke's weight.
    const cy = this.hasCon ? this.conW.y : 1;
    const toBall = this.st === ST_SWING ? this.tCon - t : this.st === ST_PREP ? (this.hasCon ? this.tPlan - t : HOLD_FAR) : 0;
    const nearOff = (sim.phase !== PH_RALLY || f.over || f.high ? 1 : smoothstep(LEAN_FROM, LEAN_FULL, toBall)) - this.nearW, nearLim = NEAR_RATE * this.dt;
    this.nearW += nearOff > nearLim ? nearLim : nearOff < -nearLim ? -nearLim : nearOff;
    this.crouchC = (f.crouch * CROUCH_SHARE * Math.min(0.18 * this.legK, Math.max(0, (0.95 * this.legK - cy) * 0.4)) + (f.sit ?? 0)) * this.w;
    this.crouch = this.crouchC * this.nearW;
    this.bendW = f.crouch > 0 ? smoothstep(1.25, 0.4, cy) * this.w * this.nearW : 0;
    // Up out of it after the ball: with the whole body tipping into the run the trunk was at 42 degrees at +0.24 s.
    if (this.st === ST_SWING || this.st === ST_FADE) this.bendW *= 1 - BEND_UP * smoothstep(0, BEND_UP_T, t - this.tCon);
  }

  /**
   * An overhead's way on from the ball is drawn by the hand. Drawn by the racket's centre, the racket turning over to
   * point at the net pulled the hand back along the handle, into the shoulder, while the centre went on: the elbow went
   * from 36 at the ball to 125 at +110 ms and out again, a jab (31-62 on video; review round 16, the coach's #4).
   */
  private overPath(k: Key, fin: Key): void {
    this.overA.copy(this.grip.off).applyQuaternion(k.q).negate().add(k.p);
    this.overB.copy(this.grip.off).applyQuaternion(fin.q).negate().add(fin.p);
    this.ctrl.copy(this.overA).addScaledVector(OVER_WAY, OVER_ON).addScaledVector(OVER_DOWN, OVER_ON);
  }

  /** The key at `e` of an overhead's follow-through (overPath); returns how far its racket centre is from the ball's key. */
  private overAt(k: Key, fin: Key, e: number): number {
    bezier(this.overA, this.ctrl, this.overB, e, this.kp);
    const way = this.fam.way;
    if (way && e < WAY_AT) this.kq.copy(k.q).slerp(way, e / WAY_AT);
    else if (way) this.kq.copy(way).slerp(fin.q, (e - WAY_AT) / (1 - WAY_AT));
    else this.kq.copy(k.q).slerp(fin.q, e);
    this.kp.add(this.overC.copy(this.grip.off).applyQuaternion(this.kq));
    return this.kp.distanceTo(k.p);
  }

  /** Pull the blended key back towards the snapshot: u = 0 is the snapshot, 1 the key as it is. */
  private blendFrom(u: number): void {
    this.kp.lerpVectors(this.from.p, this.kp, u);
    q1.copy(this.from.q).slerp(this.kq, u);
    this.kq.copy(q1);
    this.kpole.lerpVectors(this.from.pole, this.kpole, u);
    this.koff.lerpVectors(this.from.off, this.koff, u);
    this.kyaw = this.from.yaw + (this.kyaw - this.from.yaw) * u;
  }

  /** Blend back to the animation from the current key, starting at `from` with weight `w`. */
  private fadeOut(from: number, w: number): void {
    this.snapshot();
    this.st = ST_FADE;
    this.fadeStart = from;
    // (the racket as it is against ready as it will be, on the chest; 1.5: a smoothstep's peak over its mean)
    this.quatToWorld(this.readyKey.q, q2);
    q2.premultiply(this.chestQ);
    this.fadeLen = Math.min(FADE_MAX, Math.max(FADE, (1.5 * q2.angleTo(this.racketQ)) / FADE_TURN));
    this.fadeFromW = w;
  }

  // ---- locomotion ----

  private locomote(p: Player): void {
    const dt = this.dt;
    const yRoot = this.yRoot;
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.08) : 1;
    this.vx += (p.vel.x - this.vx) * k;
    this.vz += (p.vel.z - this.vz) * k;
    this.carryWeight();
    // Velocity in the model's frame (+z forward, +x its left).
    const c = Math.cos(yRoot), s = Math.sin(yRoot);
    const mx = this.vx * c - this.vz * s;
    const mz = this.vx * s + this.vz * c;
    const sp = Math.sqrt(mx * mx + mz * mz);
    this.sp = sp;
    const move = smoothstep(0.12, 0.9, sp);
    this.idleW = 1 - move;
    // Four directions: forward (jog or run by speed), left, back, right. The nearest one plays, its legs turned
    // onto the way the body is going (orientation warping, up to 45 degrees; the spine turns back so the upper body
    // faces as it did); only near halfway between two (WARP_BAND) do they cross-fade. A blend of two directions'
    // strides passes the legs through each other (a strafe's crossover step averaged with a forward stride) and
    // puts the feet under the floor; the crossover itself, its legs passing front and back, is what players do.
    let wf = 1, wl = 0, wb = 0, wr = 0;
    this.warp = 0;
    const qd = sp > 1e-3 ? Math.atan2(mx, mz) / (Math.PI / 2) : 0;
    const aq = qd < 0 ? -qd : qd;
    const was = this.sideRun;
    const mt = this.matcher;
    // (motion matching: the cycle the search picked, -1 without it or in a side-on run; its legs' warp onto the way of
    // travel)
    let si = -1, mw = 0;
    if (mt !== null) {
      // The search picks the cycle and its frame from the sim's velocity and the path towards its movement wish
      // (matcher.ts); its legs are turned onto the way the body is really going, as the sector blend's are.
      const wxw = p.driveX * p.qTop, wzw = p.driveZ * p.qTop;
      mt.vx = mx; mt.vz = mz;
      mt.wx = wxw * c - wzw * s; mt.wz = wxw * s + wzw * c;
      mt.accel = p.tune.accel; mt.brake = p.tune.brake;
      mt.dt = dt; mt.sp = sp; mt.cadence = 1 + WALK_CADENCE * this.walkUp;
      mt.step();
      // A jump to another frame is the inertializer's to blend (only seen once the cycle has weight).
      if (mt.jumped && move > 0.05) this.inertia.force = true;
      const cl = this.clips.cycle[mt.src]!;
      let d = sp > 1e-3 ? Math.atan2(mx, mz) - Math.atan2(cl.dirX, cl.dirZ) : 0;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      mw = (d > MATCH_WARP_MAX ? MATCH_WARP_MAX : d < -MATCH_WARP_MAX ? -MATCH_WARP_MAX : d) * move;
    }
    // (with matching too: the library has no side-on run yet, and its strafes cross the legs at speed, so the blend's
    // side-on run stands in until captured footwork brings one)
    if (this.sideRun) { if (sp < SIDE_RUN_OFF || aq < 0.4 || aq > SIDE_RUN_MAX + 0.1) this.sideRun = false; }
    else if (sp > SIDE_RUN_ON && aq > 0.5 && aq < SIDE_RUN_MAX) this.sideRun = true;
    if (mt !== null && !this.sideRun) {
      si = mt.src;
      wf = si <= 1 ? 1 : 0; wl = si === 2 ? 1 : 0; wb = si === 3 ? 1 : 0; wr = si === 4 ? 1 : 0;
      this.warp = mw;
    }
    // The side-on run's warp: the forward run (jog or run by speed, below), its legs turned onto the way it goes.
    const sideWarp = qd * (Math.PI / 2) * move;
    if (si >= 0) {
      // (matched: set above)
    } else if (this.sideRun) {
      this.warp = sideWarp;
    } else if (sp > 1e-3) {
      const q = qd;
      const k = Math.round(q);
      const r = q - k;
      const ar = r < 0 ? -r : r;
      const x = ar > 0.5 - WARP_BAND ? 0.5 * smoothstep(0.5 - WARP_BAND, 0.5, ar) : 0;
      const nb = k + (r < 0 ? -1 : 1);
      wf = 0;
      for (let j = 0; j < 2; j++) {
        const sec = ((j === 0 ? k : nb) % 4 + 4) % 4;
        const wt = j === 0 ? 1 - x : x;
        if (sec === 0) wf += wt; else if (sec === 1) wl += wt; else if (sec === 2) wb += wt; else wr += wt;
      }
      this.warp = (r - x * (r < 0 ? -1 : 1)) * (Math.PI / 2) * move;
    }
    // A switch turns the legs from one warp to the other no faster than WARP_SWITCH_RATE (the clip itself changes
    // at once: its pose's jump is the inertialization's).
    if (was !== this.sideRun) {
      this.warpOff += this.sideRun ? sideWarp - (mt !== null ? mw : this.strafeWarp(qd, move)) : this.warp - sideWarp;
      // The run's posture differs from the strafe's by a few degrees in every joint, under the limits: carried over.
      this.inertia.force = true;
    }
    {
      const lim = WARP_SWITCH_RATE * this.dt, o = this.warpOff;
      this.warpOff = o > lim ? o - lim : o < -lim ? o + lim : 0;
      this.warp -= this.warpOff;
      this.warpWish = this.warp;
      // The legs no further round from the chest than a spine turns: running one way with the chest turned into a stroke
      // the other, the shoulders were up to 135 degrees off the hips.
      const ch = this.chestTurn * (1 - this.bt) + this.chestWarp;
      this.warp = this.warp > ch + TWIST_MAX ? ch + TWIST_MAX : this.warp < ch - TWIST_MAX ? ch - TWIST_MAX : this.warp;
      // Nor anywhere else: a clip's edge at a shuffle stepped it 20 degrees in a frame.
      const d = this.warp - this.warpShown;
      if (this.warpShownOk && lim > 0) this.warp = this.warpShown + (d > lim ? lim : d < -lim ? -lim : d);
      this.warpShown = this.warp;
      this.warpShownOk = true;
    }
    const run = smoothstep(2.6, 4.4, sp);
    // Eased: the way of travel can swing through a clip's edge in two frames at a shuffle, and the chest of one clip
    // isn't the chest of the next (the shoulders jumped 6 cm in a frame, both elbows 15-26 degrees).
    const W = this.cycleW, Wt = this.cycleTo;
    if (si >= 0) for (let i = 0; i < 5; i++) Wt[i] = i === si ? 1 : 0;
    else { Wt[0] = wf * (1 - run); Wt[1] = wf * run; Wt[2] = wl; Wt[3] = wb; Wt[4] = wr; }
    const ease = this.cycleOk && dt > 0 ? 1 - Math.exp(-dt / CYCLE_EASE) : 1;
    this.cycleOk = true;
    for (let i = 0; i < 5; i++) W[i] = W[i]! + (Wt[i]! - W[i]!) * ease;
    // One shared phase: advance it by distance over the blended stride, capped so the legs never spin.
    let dist = 0, per = 0;
    const cy = this.clips.cycle;
    for (let i = 0; i < 5; i++) { dist += W[i]! * cy[i]!.speed * cy[i]!.duration; per += W[i]! * cy[i]!.duration; }
    // (a walk's step is shorter than the jog's it is drawn from: more of them)
    const freq = Math.min(sp / Math.max(dist, 1e-3), 1.7 / Math.max(per, 1e-3)) * (1 + WALK_CADENCE * this.walkUp);
    // (matched: the clip's own time, carried on by the matcher at the ground speed)
    this.phase = mt !== null && si >= 0 ? mt.ph : (this.phase + freq * dt) % 1;
    // The arms and hips in time with the feet: the clips' left foot comes down at phase 0, as gaitPhase's does.
    if (this.gaitRun > 0 && this.gaitW > 0) {
      const d = ((this.gaitPhase - this.phase + 1.5) % 1) - 0.5, pull = dt > 0 ? 1 - Math.exp(-dt / 0.04) : 0;
      this.phase = (this.phase + d * pull * this.gaitW + 1) % 1;
      if (mt !== null && si >= 0) { mt.ph = this.phase; mt.applyPhase(); }
    }
    this.idleClock += dt;

    const acc = this.pose;
    const tmp = this.tmp;
    acc.clear();
    if (move < 1) {
      tmp.t = this.idleClock + p.index * IDLE_APART;
      sampleClip(this.clips.idle, tmp);
      const sw = this.standW;
      if (sw > 0) {
        const st = this.standPose;
        st.w = sw;
        blendMasked(tmp, st, this.allBones);
        for (let k = 0; k < 3; k++) tmp.hips[k] = tmp.hips[k]! + (st.hips[k]! - tmp.hips[k]!) * sw;
      }
      tmp.w = 1 - move;
      accumulate(acc, tmp);
    }
    for (let i = 0; i < 5; i++) {
      // (matched: the one cycle playing; the jump from the last is the inertializer's)
      const w = (si >= 0 ? (i === si ? 1 : 0) : W[i]!) * move;
      if (w < 0.002) continue;
      tmp.t = this.phase;
      sampleCycle(cy[i]!, tmp);
      if (this.walkUp > 0) {
        const st = this.standPose;
        st.w = this.walkUp;
        blendMasked(tmp, st, this.allBones);
        for (let k = 0; k < 3; k++) tmp.hips[k] = tmp.hips[k]! + (st.hips[k]! - tmp.hips[k]!) * this.walkUp;
      }
      tmp.w = w;
      accumulate(acc, tmp);
    }
    normalize(acc);
  }

  /**
   * How far the racket elbow's side may swing round the shoulder-to-hand line this frame: at a stroke's pace into the ball and just after
   * it, at ELBOW_SIDE_CALM after that. At the stroke's pace all the time, the elbow flew round a still hand on the way back to the ready,
   * 0.14 m or more in 0.1 s after a quarter to a half of forehand volleys (review round 33, #9).
   */
  private racketSideLimit(): number {
    if (this.dt <= 0) return Math.PI;
    const fast = this.st === ST_PREP || (this.st === ST_SWING && this.lastT < this.tCon + ELBOW_SIDE_FAST_AFTER);
    return (fast ? ELBOW_SIDE_RATE : ELBOW_SIDE_CALM) * this.dt;
  }

  /** The tilt's spring on this frame's acceleration (LEAN_*). */
  private carryWeight(): void {
    const dt = this.dt;
    if (!this.tiltOk || dt <= 0) {
      this.tiltOk = dt > 0 || this.tiltOk;
      this.lastVX = this.vx;
      this.lastVZ = this.vz;
      return;
    }
    const ax = (this.vx - this.lastVX) / dt, az = (this.vz - this.lastVZ) / dt;
    this.lastVX = this.vx;
    this.lastVZ = this.vz;
    const brake = ax * this.vx + az * this.vz < 0 ? LEAN_BRAKE : 1;
    let tx = ax * LEAN_GAIN * brake, tz = az * LEAN_GAIN * brake;
    const t = Math.sqrt(tx * tx + tz * tz), most = LEAN_MAX * (brake > 1 ? LEAN_BRAKE_MAX : 1);
    if (t > most) { tx *= most / t; tz *= most / t; }
    const h = dt < 0.02 ? dt : 0.02;
    const w2 = LEAN_W * LEAN_W, d = 2 * LEAN_Z * LEAN_W;
    for (let left = dt; left > 1e-6; left -= h) {
      const u = left < h ? left : h;
      this.tiltVX += (w2 * (tx - this.tiltX) - d * this.tiltVX) * u;
      this.tiltVZ += (w2 * (tz - this.tiltZ) - d * this.tiltVZ) * u;
      this.tiltX += this.tiltVX * u;
      this.tiltZ += this.tiltVZ * u;
    }
  }

  /** The strafes' warp for direction q (quarter turns from forward), as locomote has it outside a side-on run. */
  private strafeWarp(q: number, move: number): number {
    const k = Math.round(q);
    const r = q - k;
    const ar = r < 0 ? -r : r;
    const x = ar > 0.5 - WARP_BAND ? 0.5 * smoothstep(0.5 - WARP_BAND, 0.5, ar) : 0;
    return (r - x * (r < 0 ? -1 : 1)) * (Math.PI / 2) * move;
  }

  // ---- per frame ----

  /** `t`: the interpolated sim time being drawn. Animation runs on its steps, in step with the sim. */
  update(sim: MatchSim, p: Player, idx: number, alpha: number, t: number): void {
    // No time has passed (game.ts draws the same moment twice while the render lag eases in, most often at 165-240
    // Hz): last frame's pose is this frame's. Run with dt 0 every filter and rate limit treated it as a cut and snapped
    // (joints up to 137° in a frame). Time a long way back is a new start.
    if (this.lastT >= 0 && t <= this.lastT) {
      if (t > this.lastT - 0.5 && p.handed === this.handed) return;
      this.lastT = -1;
    }
    if (p.handed !== this.handed) this.setHanded(p.handed);
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    INERT_DT[0] = dt;
    const pp = sim.prevPlayers[idx]!;
    this.root.position.set(pp.x + (p.pos.x - pp.x) * alpha, 0, pp.z + (p.pos.z - pp.z) * alpha);
    // Stance: the sim faces the ball; a stroke squares up to the net and turns the shoulders instead
    // (last frame's stroke weight: the stroke below reads this frame).
    const net = sim.side(p.team) > 0 ? 0 : Math.PI;
    // A cut (placed for the next point) starts every filter afresh.
    const rx = this.root.position.x - this.lastRootX, rz = this.root.position.z - this.lastRootZ;
    this.lastRootX = this.root.position.x;
    this.lastRootZ = this.root.position.z;
    const cut = rx * rx + rz * rz > 0.25 || this.cutPending;
    this.cutNow = cut ? 2 : this.cutNow > 0 ? this.cutNow - 1 : 0;
    this.cutPending = false;
    if (cut) this.resetInertia();
    // Serving: from the point's setup to the contact the address is the ready pose (side-on, the ball in hand).
    // (not while walking back to the places: sim.walking)
    const placed = sim.walking === 0;
    this.addr = placed && sim.score.serverPlayer() === idx && (sim.phase === PH_SETUP || (sim.phase === PH_TOSS && sim.rally.hitter < 0));
    // Ready position while a point is on (and for the receiver waiting for the serve), not at a sprint; the server's
    // is the address. Decided before the stance, which it turns. A cut (players placed for the next point) starts in
    // the new point's pose, not on the way to it.
    this.on = sim.phase === PH_RALLY || (placed && (sim.phase === PH_SETUP || sim.phase === PH_TOSS) && sim.score.serverPlayer() !== idx);
    this.racketTap(sim, idx, p, dt);
    let want = this.addr ? 1 : this.on ? READY_HOLD * (1 - smoothstep(3.6, 5.2, Math.sqrt(this.vx * this.vx + this.vz * this.vz))) : 0;
    if (want < this.tapW) want = this.tapW;
    // Walking back (and to the net after match point): the racket carried (CARRY), not swung with the arms; eased in
    // and out (carryW).
    const carry = !placed || (sim.phase === PH_OVER && sim.overStage === 2);
    this.carryW += ((carry ? 1 : 0) - this.carryW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.2) : 0);
    if (this.carryW < 0.001) this.carryW = 0;
    if (want < CARRY_W * this.carryW) want = CARRY_W * this.carryW;
    this.ready += (want - this.ready) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.18) : 0);
    this.addrW += ((this.addr ? 1 : 0) - this.addrW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.1) : 0);
    // The body turns side-on at a person's pace, from the moment the server stands at their place while the others walk in. It came with
    // the hands, 83 degrees at the chest in 0.38 s, every serve, as the walk ended (review round 34, #4). Out of it with the hands.
    const hx = sim.walkHomeX[idx]! - p.pos.x, hz = sim.walkHomeZ[idx]! - p.pos.z;
    const addrTo = this.addr || (sim.walking === 2 && sim.score.serverPlayer() === idx && hx * hx + hz * hz < WALK_NEAR0 * WALK_NEAR0 && this.vx * this.vx + this.vz * this.vz < WALK_GAIT_V * WALK_GAIT_V);
    this.addrTurn = cut ? (addrTo ? 1 : 0) : addrTo ? Math.min(1, this.addrTurn + dt / ADDR_TURN_S) : Math.min(this.addrTurn, this.addrW);
    // (the ball stays in the hand as the hand comes up, by the first moment the serve can go: at addrW's 0.1 s it left the palm by 0.4 m at the end of a walk)
    this.placedW = sim.phase === PH_SETUP ? smoothstep(0, SETUP_HOLD, sim.time - (sim.phaseUntil - SETUP_HOLD)) : 1;
    this.mixReady();
    // (a blend not under way has no last frame to stay on the side of: the first frame of a racket tap, at 7% of the way,
    // took the last tap's side, the long way, and every hand on court jumped 35 degrees in a frame; review round 15)
    if (this.carryW > 0.001) this.mixKey(this.carryMix, this.handed > 0 ? CARRY : CARRY_LEFT, this.carryW, this.outCarry);
    else this.outCarry.set(0, 0, 0, 0);
    if (this.tapW > 0.001) this.mixKey(this.tapMix, this.tapKey ?? (this.handed > 0 ? TAP : TAP_LEFT), this.tapW, this.outTap);
    else this.outTap.set(0, 0, 0, 0);
    // (held on the net from then too: the sim turns the server 48 degrees as the walk ends, and the hands' 0.1 s let 15 of it through and back)
    const sq = Math.max(this.w, this.ready * (addrTo ? 1 : this.addrW));
    // (a contrapared is played facing the player's own back glass: while it's being played, as the family stays set after it, and a server whose last ball of the
    // point was one turned to their own glass to serve, 180 degrees in 0.3 s; review round 33)
    let yaw = p.facing + wrapAngle(net - p.facing) * sq;
    // Into a contrapared at the stroke's own pace; out of it, turned back from the glass no faster than a person pivots. It followed the
    // stroke's weight out while the sim's facing chased the ball back over them, 150-200 degrees in a third of a second, about a dozen a
    // set from your seat (review round 34, #2).
    const glass = this.fam.glass && this.w > 0;
    if (glass && (cut || !this.glassOn || this.w >= this.glassW)) {
      this.glassYaw = p.facing + wrapAngle(net + Math.PI - p.facing) * sq;
      this.glassOn = true;
    } else if (this.glassOn) {
      const d = wrapAngle((glass ? p.facing + wrapAngle(net + Math.PI - p.facing) * sq : yaw) - this.glassYaw), step = GLASS_BACK * dt;
      if (cut || (!glass && Math.abs(d) <= step)) this.glassOn = false;
      else this.glassYaw += d > step ? step : d < -step ? -step : d;
    }
    this.glassW = glass ? this.w : 0;
    this.yaw = this.glassOn ? this.glassYaw : yaw;
    {
      // Going back with the ball going past: side-on, the stance turned so the hands and the racket go with it, into
      // the overhead's own turn as the stroke's weight comes in.
      const side = sim.side(p.team);
      const past = sim.phase === PH_RALLY && sim.rally.hitter >= 0 && sim.rally.hitter !== p.team && sim.ball.vel.z * side > 0;
      const to = past ? smoothstep(RETREAT_V0, RETREAT_V1, this.vz * side) : 0;
      this.retreat += (to - this.retreat) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / (to > this.retreat ? RETREAT_IN : RETREAT_OUT)) : 0);
      if (this.retreat < 0.001) this.retreat = 0;
      this.yaw -= this.handed * RETREAT_TURN * this.retreat * (1 - this.w);
    }
    {
      // Walking back: turned to where they are going (the sim's facing stays on the net).
      const sp = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
      const going = sim.walking > 0 || (sim.phase === PH_OVER && sim.overStage === 2);
      // The last of the way with the net back in front of them: the serve is half a second after they get there.
      const hx = sim.walkHomeX[idx]! - p.pos.x, hz = sim.walkHomeZ[idx]! - p.pos.z;
      const near = sim.walking === 2 ? smoothstep(WALK_NEAR0, WALK_NEAR1, Math.sqrt(hx * hx + hz * hz)) : 1;
      // (on the side of the turn already made: walking straight back, the way read +180 one frame and -180 the next, the turn back to the net chased the
      // wrong side and they arrived with their back to it, then spun 250 degrees in 0.4 s; review round 33. Unwound the way it went, not wrapped.)
      let way = sp > WALK_GAIT_V ? wrapAngle(Math.atan2(-this.vx, -this.vz) - this.yaw) : this.walkTurn;
      if (way - this.walkTurn > Math.PI) way -= 2 * Math.PI;
      else if (way - this.walkTurn < -Math.PI) way += 2 * Math.PI;
      const to = !going ? 0 : way * near;
      // (eased into the turn: from standing to 4.5 rad/s in a frame popped both arms)
      const e = to - this.walkTurn, wish = e * WALK_TURN_GAIN, lim = WALK_TURN_ACC * dt;
      const dv = (wish > WALK_TURN_RATE ? WALK_TURN_RATE : wish < -WALK_TURN_RATE ? -WALK_TURN_RATE : wish) - this.walkTurnV;
      this.walkTurnV = cut ? 0 : this.walkTurnV + (dv > lim ? lim : dv < -lim ? -lim : dv);
      this.walkTurn = cut ? 0 : this.walkTurn + this.walkTurnV * dt;
      // (inside half a turn either way, so the way back to the net is the shorter: on a curving walk it passed 180 and was eased back through the back glass,
      // 250-280 degrees where 80-100 would do, one walk in eleven; review round 34. The yaw filter wraps, so the whole turn taken off is no jump.)
      if (this.walkTurn > Math.PI) this.walkTurn -= 2 * Math.PI;
      else if (this.walkTurn < -Math.PI) this.walkTurn += 2 * Math.PI;
      this.yaw += this.walkTurn;
      const gait = this.gaitW > 0 ? WALK_GAIT_V * 0.5 : WALK_GAIT_V;
      // Running in a rally, up to the last steps before a contact (a backswing is begun on the run).
      // And from just after it: the arms finish the stroke on a body already on its way. Kept off to the end of the follow-through, the first
      // half second of every recovery was the clip's legs, both feet up half the time (review round 26).
      // (and at a run's pace later: taken off 0.3 s out with the body still going at 3 m/s, the last stride to the ball was the clip's too, a shin
      // level behind for a third of a second; review round 27)
      // (an overhead's front foot is down over a quarter of a second before the ball, at any speed: it was 0.12 s, the weight never through it)
      const rightName = rightFamily(this.fam).name;
      const plantIn = rightName === 'overhead' || rightName === 'vibora' ? RUN_PLANT : RUN_PLANT * (1 - RUN_PLANT_FAST * smoothstep(RUN_PLANT_V0, RUN_PLANT_V1, sp));
      // (the chest is the stroke's by then: going with the hips up to the ball, it came back to it in the last frames and took the arms with it)
      // (eased: a swing that starts inside RUN_CHEST_NEAR would otherwise take the whole twist off in one frame)
      const free = this.st === ST_SWING ? (t < this.tCon ? 0 : smoothstep(0, RUN_CHEST_BACK, t - this.tCon)) : this.st === ST_PREP && this.hasCon ? smoothstep(RUN_CHEST_NEAR, RUN_CHEST_FAR, this.tPlan - t) : 1;
      this.chestFree += (free - this.chestFree) * (1 - Math.exp(-this.dt / RUN_CHEST_EASE));
      const near2 = (this.st === ST_SWING && t < this.tCon + RUN_AFTER && this.tCon - t < plantIn) || (this.st === ST_PREP && this.hasCon && this.tPlan - t < plantIn);
      // (and a real run between points: moving in the set-up or after a point drew the clips' bounding strides, the rear leg out straight and the foot .55 m up, review round 31.
      // A shuffle there stays off it: at the rally's speeds the gait went on and off under people settling for the serve, 1.5 pops a player-minute)
      const rally = sim.phase === PH_RALLY, on = this.gaitRun > 0 && this.gaitW > 0;
      const running = !going && !near2 && sp > (rally ? (on ? RUN_V_OFF : RUN_V_ON) : on ? RUN_V_BREAK : RUN_V_BREAK + 0.5);
      // A foot in the air comes down before the run lets go of it: faded out at 0.47 of its swing it was left behind a body doing 4 m/s, and the leg's length dragged
      // it out straight behind, 0.4 m off the floor, on a lunge at a ball going past (review round 30).
      this.gaitStop = !running && !going && !cut && this.gaitRun > 0;
      this.gaitEnd = this.gaitStop && this.gaitW > 0 && (this.gaitSwing[0]! > 0 || this.gaitSwing[1]! > 0);
      if (going) this.gaitRun = 0;
      else if (running) this.gaitRun = 1;
      const ramp = dt > 0 ? dt / (this.gaitRun > 0 ? RUN_IN : WALK_IN) : 0;
      this.gaitW = cut || (going && this.w >= 0.02) ? 0 : running || this.gaitEnd || (going && sp > gait) ? Math.min(1, this.gaitW + ramp) : Math.max(0, this.gaitW - ramp);
      this.gaitH += ((this.gaitW > 0 && this.gaitRun === 0 ? 1 : 0) - this.gaitH) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / WALK_IN) : 0);
      if (this.gaitH < 0.001) this.gaitH = 0;
      this.gaitRunH += ((this.gaitW > 0 && this.gaitRun > 0 ? 1 : 0) - this.gaitRunH) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / RUN_HIP_IN) : 0);
      if (this.gaitRunH < 0.001) this.gaitRunH = 0;
    }
    // Turned towards the partner for the racket tap.
    if (this.tapW > 0.001) this.yaw += wrapAngle(this.tapYaw - this.yaw) * this.tapW * TAP_TURN;
    // The body turns no faster than a person turns (the sim faces the ball at once, even one that has just passed).
    if (this.inertial && (Avatar.inertMask & 4) !== 0) {
      this.yawI.in[0] = this.yaw;
      this.yawI.step();
      this.yaw = this.yawI.out[0]!;
    }
    this.dt = dt;
    IK_TURN[0] = dt > 0 ? ELBOW_SIDE_RATE * dt : Math.PI;
    IK_BEND[0] = dt > 0 ? ELBOW_BEND_RATE * dt : Math.PI;
    IK_SOFT[0] = ARM_SOFT;
    const ys = this.yaw + Math.PI;
    this.stanceC = Math.cos(ys);
    this.stanceS = Math.sin(ys);
    this.stanceQ.setFromAxisAngle(UP, ys);
    this.updateStroke(sim, p, idx, t);
    {
      // Into the follow-through as the stroke goes (continuous at the contact), out of it over FINISH_EASE.
      const d = this.finishTo - this.finishU, r = dt > 0 ? dt / FINISH_EASE : 1;
      this.finishU = this.finishTo >= this.finishU && this.finishTo > 0 ? this.finishTo : d < -r ? this.finishU - r : this.finishTo;
    }
    this.wall += (this.wallWant - this.wall) * (dt > 0 ? 1 - Math.exp(-dt / WALL_EASE) : 0);
    // (the address's turn at its own pace, addrTurn, not the hands')
    const at = smoothstep(0, 1, this.addrTurn), rk = this.readyFit;
    const turn = this.kyaw * this.w + (rk.yaw + (this.addrKey.yaw - rk.yaw) * at) * this.ready * (1 - this.w);
    const btTo = this.w > 0.01 ? this.fam.bodyTurn ?? BODY_TURN : BODY_TURN + (SERVE_TURN_SHARE - BODY_TURN) * at;
    this.bt += (btTo - this.bt) * (dt > 0 && !cut ? 1 - Math.exp(-dt / 0.12) : 1);
    // No faster than a body turns: the turn away from a wall changes sides with the stroke's hand (the hips 77° in a
    // frame on a monkey's change of hand beside the glass).
    const wallTo = -this.hand * this.handed * (this.hand > 0 ? WALL_TURN : WALL_TURN_BH) * this.wall * sq;
    const wallLim = cut ? Math.PI : WALL_YAW_RATE * dt;
    const wallYaw = Math.min(this.wallYaw + wallLim, Math.max(this.wallYaw - wallLim, wallTo));
    this.wallYaw = wallYaw;
    this.chestTurn = turn + wallYaw;
    const yRoot = ys + turn * this.bt + wallYaw;
    this.root.rotation.y = yRoot;

    this.yRoot = yRoot;
    const ohStand = this.st === ST_PREP || this.st === ST_SWING ? this.fam.stand ?? 0 : 0;
    const walks = sim.walking > 0 || sim.phase === PH_OVER || sim.phase === PH_DEAD;
    this.walkUp += ((walks ? WALK_UP : 0) - this.walkUp) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / STAND_EASE) : 0);
    if (this.walkUp < 0.001) this.walkUp = 0;
    const standTo = sim.phase === PH_OVER ? 1 : this.addr ? SERVE_STAND : sim.walking > 0 || sim.phase === PH_DEAD ? WALK_UP : ohStand;
    this.standW += (standTo - this.standW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / (ohStand > 0 ? OVERHEAD_STAND_EASE : STAND_EASE)) : 0);
    if (this.standW < 0.001) this.standW = 0;
    this.netZ = p.pos.z > 0 ? -1 : 1;
    if (cut) this.intoBall = 0;
    this.locomote(p);
    this.reaction(sim, idx, t);
    this.splitStep(p, t);
    this.stretchMotion(p, t);
    this.smashJump(t);
    this.root.position.y = this.lift;
    this.dress(sim, cut, dt, rx, rz, yRoot);

    // Pose -> bones, with the racket hand gripping.
    const q = this.pose.q;
    for (let i = 0; i < this.nb; i++) this.bones[i]!.quaternion.set(q[i * 4]!, q[i * 4 + 1]!, q[i * 4 + 2]!, q[i * 4 + 3]!);
    const gq = this.grip.quats;
    const gb = this.grip.bones;
    for (let k = 0; k < gb.length; k++) {
      this.bones[gb[k]!]!.quaternion.set(gq[k * 4]!, gq[k * 4 + 1]!, gq[k * 4 + 2]!, gq[k * 4 + 3]!);
    }
    const h = this.pose.hips;
    this.hips.position.set(h[0]!, h[1]!, h[2]!);
    // Orientation warp: hips and legs (and the hips' sway) turned, the spine turned back: the chest's world rotation
    // unchanged up to WARP_SPINE_MAX of warp; past it (a side-on run) the chest turns with the hips, no faster than
    // WARP_CHEST_RATE.
    {
      // (in a run the chest goes too, off a stroke's turn as well: held on the stroke, the hips stayed with it and the legs ran sideways to
      // the way they were going, the fast frames that far off it doubled by a smaller TWIST_MAX; review round 26)
      const wa = this.warp + (this.warpWish - this.chestTurn * (1 - this.bt) - this.warp) * this.gaitW * this.chestFree, room = WARP_SPINE_MAX + RETREAT_SPINE * this.retreat;
      const want = wa > room ? wa - room : wa < -room ? wa + room : 0;
      const lim = cut ? Math.PI : WARP_CHEST_RATE * dt, d = want - this.chestWarp;
      this.chestWarp += d > lim ? lim : d < -lim ? -lim : d;
    }
    if (this.warp !== 0 || this.chestWarp !== 0) {
      const wa = this.warp;
      q1.setFromAxisAngle(UP, wa);
      const hq = this.hips.quaternion;
      // spine' = hips^-1 * back^-1 * hips * spine.
      const back = wa - this.chestWarp;
      q3.setFromAxisAngle(UP, -back).multiply(hq);
      q2.copy(hq).invert();
      q2.multiply(q3);
      this.spine[0]!.quaternion.premultiply(q2);
      hq.premultiply(q1);
      const cw = Math.cos(wa), sw = Math.sin(wa), hx = this.hips.position.x, hz = this.hips.position.z;
      this.hips.position.x = hx * cw + hz * sw;
      this.hips.position.z = -hx * sw + hz * cw;
    }
    // Shoulder turn and lean in the spine.
    if (this.w > 0 || turn !== 0 || this.bendW > 0) {
      const spineTurn = (turn * (1 - this.bt)) / 3;
      const lean = (LOW_BEND * this.bendW) / 3;
      q1.setFromAxisAngle(AXIS_Y, spineTurn);
      q2.setFromAxisAngle(AXIS_X, lean);
      for (let k = 0; k < 3; k++) this.spine[k]!.quaternion.multiply(q1).multiply(q2);
    }
    if (this.bowW > 0) {
      q2.setFromAxisAngle(AXIS_X, (this.bowW * BOW_ANGLE) / 3);
      for (let k = 0; k < 3; k++) this.spine[k]!.quaternion.multiply(q2);
    }
    // The weight in the trunk: forwards about its x, sideways about its z (+z tips it to -x). The neck keeps the head
    // near level.
    {
      // (as the chest faces: past WARP_SPINE_MAX it turns with the hips, and a side-on run leaned across its way)
      const y = yRoot + this.chestWarp, k = LEAN_TRUNK * (1 - LEAN_STROKE * this.w), c = Math.cos(y), s = Math.sin(y);
      const up = this.gaitRun > 0 ? RUN_UP * this.gaitW * (this.cycleW[0]! + this.cycleW[1]!) * (1 - LEAN_STROKE * this.w) : 0;
      const fw = (this.tiltX * s + this.tiltZ * c) * k - up, lf = (this.tiltX * c - this.tiltZ * s) * k;
      this.hipTiltX = this.tiltX;
      this.hipTiltZ = this.tiltZ;
      if (fw * fw + lf * lf > 1e-6) {
        for (let j = 0; j < 3; j++) {
          q2.setFromAxisAngle(AXIS_X, fw * LEAN_SPINE[j]!);
          q1.setFromAxisAngle(AXIS_Z, -lf * LEAN_SPINE[j]!);
          this.spine[j]!.quaternion.multiply(q2).multiply(q1);
        }
        q2.setFromAxisAngle(AXIS_X, -fw * 0.6);
        this.neck.quaternion.multiply(q2);
      }
    }
    // An overhead's shoulders go over like a cartwheel, the free one up at the trophy, the racket one up at the ball, and
    // the trunk bows after it.
    {
      const o = this.fam.over, swing = this.st === ST_SWING && t < this.tCon;
      let tilt = 0, bow = 0;
      if (o && this.w > 0 && (this.st === ST_PREP || this.st === ST_SWING)) {
        const up0 = smoothstep(0.3, 1, this.keyS), fin = swing || this.st === ST_PREP ? 0 : this.finishTo;
        tilt = (o.tilt[0]! + (o.tilt[1]! - o.tilt[0]!) * up0 + (o.tilt[2]! - o.tilt[1]!) * fin) * this.w;
        bow = o.pitch * fin * this.w;
      }
      // (a measured stroke: the trunk's lean the clip has at this moment of it)
      const tracked = this.fam.track !== undefined && this.w > 0 && this.st !== ST_NONE;
      if (tracked) {
        // (off the floor an overhead's lean is whole: nothing stands under it to be kept over)
        const air = this.fam.high ? smoothstep(PELVIS_AIR0, PELVIS_AIR1, this.lift) : 0;
        tilt = this.trTilt * (TRACK_TILT + (1 - TRACK_TILT) * air) * this.w;
        bow = this.trBow * (TRACK_BOW + (TRACK_BOW_AIR - TRACK_BOW) * air) * this.w;
      }
      // (a track is smooth already: eased as the keyed tilt is, the shoulders were 0.4 rad over at the ball where the clip has 0.63, and 0.17 s late)
      const dt = this.dt, ease = dt > 0 ? 1 - Math.exp(-dt / (tracked ? TRACK_TILT_EASE : OVER_TILT_EASE)) : 1;
      this.overTilt += (tilt - this.overTilt) * ease;
      this.overBow += (bow - this.overBow) * ease;
      this.leanPelvis = 0;
      if (this.overTilt * this.overTilt + this.overBow * this.overBow > 1e-6) {
        const pa = this.fam.track && this.fam.high && this.st !== ST_NONE ? TRACK_PELVIS * smoothstep(PELVIS_AIR0, PELVIS_AIR1, this.lift) : 0;
        if (pa > 1e-3) {
          this.leanPelvis = pa;
          q2.setFromAxisAngle(AXIS_X, this.overBow * pa);
          q1.setFromAxisAngle(AXIS_Z, this.overTilt * this.handed * pa);
          q2.multiply(q1);
          // (in the world, for the feet: the root's turn and the hips' own either side of it)
          q3.multiplyQuaternions(this.root.quaternion, this.hips.quaternion);
          this.leanW.copy(q3).multiply(q2).multiply(q3.invert());
          this.hips.quaternion.multiply(q2);
        }
        const sp = (1 - pa) / 3;
        q2.setFromAxisAngle(AXIS_X, this.overBow * sp);
        q1.setFromAxisAngle(AXIS_Z, this.overTilt * this.handed * sp);
        for (let j = 0; j < 3; j++) this.spine[j]!.quaternion.multiply(q2).multiply(q1);
        q1.setFromAxisAngle(AXIS_Z, -this.overTilt * this.handed * OVER_NECK);
        q2.setFromAxisAngle(AXIS_X, -this.overBow * OVER_NECK);
        this.neck.quaternion.multiply(q2).multiply(q1);
      }
    }
    // Up out of the idle clip's tennis crouch, the head kept level.
    const up = READY_UP * this.idleW * (1 - this.standW);
    if (up > 0) {
      q2.setFromAxisAngle(AXIS_X, -up / 3);
      for (let k = 0; k < 3; k++) this.spine[k]!.quaternion.multiply(q2);
      q2.setFromAxisAngle(AXIS_X, up);
      this.neck.quaternion.multiply(q2);
    }
    // The clip pose (locomotion, reactions, the shoulder turn) carried on smoothly through any jump, before IK.
    if (this.inertial && (Avatar.inertMask & 1) !== 0) this.inertia.apply(this.bones, this.hips.position, this.inertiaSkip);
    this.root.updateMatrixWorld(true);

    // The server's free hand holds the ball, and goes down with it as it is pushed into the turf.
    const on = this.on;
    if (this.addr) {
      const b = sim.ball;
      if (sim.phase === PH_SETUP) this.inHand = true;
      else if (b.pos.y < SERVE_LET_GO || b.vel.y >= 0) this.inHand = false;
      if (this.inHand) {
        const u = routineTime(sim, t);
        v1.set(b.pos.x, b.pos.y - (u >= 0 ? routineHand(u) : 0), b.pos.z);
        this.toModel(v1, this.addrKey.off);
      }
    }

    const watch = on || (this.addr && (sim.phase === PH_TOSS || routineTime(sim, t) >= 0)) || sim.walking > 0;
    this.look += ((watch ? 1 : 0) - this.look) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 0);
    this.gazeAt(sim, idx, t, dt);
    this.gazeSettle(dt);
    if (this.look >= 0.01) this.watchBall();

    this.plantW += (1 - smoothstep(0.25, 0.7, this.sp) - this.plantW) * (dt > 0 ? 1 - Math.exp(-dt / 0.08) : 0);
    this.freeSh.setFromMatrixPosition(this.armFree[0]!.matrixWorld);
    this.racketSh.setFromMatrixPosition(this.armRacket[0]!.matrixWorld);
    this.solveLegs();
    this.limitShins();
    if (this.w > 0 || this.ready >= 0.01) this.solveArms();
    else {
      this.elbowR.side.set(0, 0, 0); this.elbowL.side.set(0, 0, 0); this.elbowR.dir.set(0, 0, 0); this.elbowL.dir.set(0, 0, 0);
      this.outReady.set(0, 0, 0, 0); this.outKey.set(0, 0, 0, 0);
      this.clearOff.set(0, 0, 0);
      this.elbowPush.set(0, 0, 0); this.elbowPushTo.set(0, 0, 0);
      this.racketQOk = false;
      this.shLegs.set(0, 0, 0);
      this.swivel = 0;
      // (the next fade starts afresh, not from a frame long gone)
      this.fadeOk.fill(0);
    }

    // The head after looking (the ball can move faster than a head turns).
    if (this.inertial && (Avatar.inertMask & 2) !== 0) {
      this.headInertia.apply(this.bones, null, this.headSkip);
      this.neck.updateMatrixWorld(true);
    }
    this.measureFeet();
    if (this.face) this.updateFace(sim, p, t, dt);
    if (this.ponyOn) this.swingHair(cut, dt);
  }

  /**
   * Long hair as one pendulum on the head (kit.ts hairHang): its tip, a mass on a spring towards where the head alone carries
   * it, damped against the head's own motion and held at the hair's length from the pivot, so it lags the head's moves (turns
   * and nods included) and swings back. Gravity acts as it differs from the rest pose's (the groom is modelled hanging under
   * it): a head bowed lets the hair fall away from it. The tip's offset goes to the hair's shader in the body's frame.
   */
  private swingHair(cut: boolean, dt: number): void {
    const k = this.kit!;
    this.head.updateWorldMatrix(true, false);
    const e = this.head.matrixWorld.elements;
    const px = this.ponyPiv.x, py = this.ponyPiv.y, pz = this.ponyPiv.z, ax = this.ponyArm.x, ay = this.ponyArm.y, az = this.ponyArm.z;
    const wx = e[0]! * px + e[4]! * py + e[8]! * pz + e[12]!, wy = e[1]! * px + e[5]! * py + e[9]! * pz + e[13]!, wz = e[2]! * px + e[6]! * py + e[10]! * pz + e[14]!;
    const tx = wx + e[0]! * ax + e[4]! * ay + e[8]! * az, ty = wy + e[1]! * ax + e[5]! * ay + e[9]! * az, tz = wz + e[2]! * ax + e[6]! * ay + e[10]! * az;
    if (cut || !this.ponyLive) {
      this.ponyX = tx; this.ponyY = ty; this.ponyZ = tz;
      this.ponyVX = this.ponyVY = this.ponyVZ = 0;
      this.ponyLive = true;
    } else if (dt > 0) {
      // gravity beyond the rest pose's, in the world: g minus rest gravity carried round by the head
      const gx = this.ponyG.x, gy = this.ponyG.y, gz = this.ponyG.z;
      const fx = -(e[0]! * gx + e[4]! * gy + e[8]! * gz), fy = -PONY_G - (e[1]! * gx + e[5]! * gy + e[9]! * gz), fz = -(e[2]! * gx + e[6]! * gy + e[10]! * gz);
      const vtx = (tx - this.ponyTX) / dt, vty = (ty - this.ponyTY) / dt, vtz = (tz - this.ponyTZ) / dt;
      const n = Math.ceil(dt / PONY_H), h = dt / n, L = this.ponyLen, K = this.ponyK, C = this.ponyC;
      for (let i = 1; i <= n; i++) {
        // (the head's carried tip and the pivot moved straight across the frame: the spring pulls towards the tip as it is at the
        // step's start, where the hair is, and the length holds about the pivot at its end; pulled towards the end's, the hair led
        // a steady run by a step's travel)
        const f0 = (i - 1) / n, f = i / n;
        const qx = this.ponyTX + (tx - this.ponyTX) * f0, qy = this.ponyTY + (ty - this.ponyTY) * f0, qz = this.ponyTZ + (tz - this.ponyTZ) * f0;
        const cx = this.ponyPX + (wx - this.ponyPX) * f, cy = this.ponyPY + (wy - this.ponyPY) * f, cz = this.ponyPZ + (wz - this.ponyPZ) * f;
        this.ponyVX += (K * (qx - this.ponyX) - C * (this.ponyVX - vtx) + fx) * h;
        this.ponyVY += (K * (qy - this.ponyY) - C * (this.ponyVY - vty) + fy) * h;
        this.ponyVZ += (K * (qz - this.ponyZ) - C * (this.ponyVZ - vtz) + fz) * h;
        let nx = this.ponyX + this.ponyVX * h - cx, ny = this.ponyY + this.ponyVY * h - cy, nz = this.ponyZ + this.ponyVZ * h - cz;
        const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (d > 1e-6) { nx *= L / d; ny *= L / d; nz *= L / d; }
        nx += cx; ny += cy; nz += cz;
        this.ponyVX = (nx - this.ponyX) / h; this.ponyVY = (ny - this.ponyY) / h; this.ponyVZ = (nz - this.ponyZ) / h;
        this.ponyX = nx; this.ponyY = ny; this.ponyZ = nz;
      }
    }
    this.ponyPX = wx; this.ponyPY = wy; this.ponyPZ = wz;
    this.ponyTX = tx; this.ponyTY = ty; this.ponyTZ = tz;
    // The tip's offset from where the head carries it, capped, and never forwards into the back of the neck (the body's +z).
    const c = Math.cos(this.yRoot), sn = Math.sin(this.yRoot);
    let ox = this.ponyX - tx, oy = this.ponyY - ty, oz = this.ponyZ - tz;
    const d = Math.sqrt(ox * ox + oy * oy + oz * oz), cap = PONY_MAX * this.ponyLen;
    if (d > cap) { ox *= cap / d; oy *= cap / d; oz *= cap / d; }
    const fwd = ox * sn + oz * c;
    if (fwd > PONY_FWD) { ox -= (fwd - PONY_FWD) * sn; oz -= (fwd - PONY_FWD) * c; }
    // The turn about the pivot from the head-carried arm to the swung one (world), then both into the body's frame (the
    // root's: position and yaw), as the hair's shader works in.
    const rx = tx - wx, ry = ty - wy, rz = tz - wz, ux = rx + ox, uy = ry + oy, uz = rz + oz;
    let kx = ry * uz - rz * uy, ky = rz * ux - rx * uz, kz = rx * uy - ry * ux;
    const s = Math.sqrt(kx * kx + ky * ky + kz * kz), angle = Math.atan2(s, rx * ux + ry * uy + rz * uz);
    if (s > 1e-9) { kx /= s; ky /= s; kz /= s; } else { kx = 0; ky = 1; kz = 0; }
    const r = this.root.matrixWorld.elements, bx = wx - r[12]!, by = wy - r[13]!, bz = wz - r[14]!;
    const at = k.ponyAt!.value, w = k.pony!.value;
    at.x = bx * c - bz * sn; at.y = by; at.z = bx * sn + bz * c;
    w.x = kx * c - kz * sn; w.y = ky; w.z = kx * sn + kz * c; w.w = angle;
  }

  /** The face's inputs from the stroke, the run, the point and the ball, then its keys (face.ts). */
  private updateFace(sim: MatchSim, p: Player, t: number, dt: number): void {
    const f = this.faceIn;
    f.toContact = this.st === ST_SWING ? this.tCon - t : this.st === ST_PREP && this.hasCon ? p.contactTime - t : Infinity;
    if (f.toContact < 0) f.toContact = Infinity;
    f.sinceContact = p.lastContactTime > 0 && p.lastContactTime <= t ? t - p.lastContactTime : -1;
    const fam = rightFamily(this.fam);
    f.strain = fam === SMASH ? 1 : fam === OVERHEAD || fam === VIBORA ? 0.8 : fam === SERVE ? 0.7 : fam.punch < 1 ? 0.45 : 0.65;
    f.grunt = t >= this.gruntAt && t - this.gruntAt < GRUNT_MOUTH;
    // Out of breath: the run's pace averaged over about 6 s, from a brisk 3 m/s up.
    const sp = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    this.puff += (Math.min(1, Math.max(0, (sp - 1.2) / 3)) - this.puff) * (dt > 0 ? 1 - Math.exp(-dt / 6) : 0);
    f.puff = sim.phase === PH_RALLY ? this.puff * 0.4 : this.puff;
    f.mood = this.react === this.clips.celebrate ? 1 : this.react === this.clips.dejected ? -1 : this.moodKey ? this.moodSign : 0;
    f.moodT = t - this.reactStart;
    // What they look at from between the eyes, in the head's own frame (+z ahead, +x its left, +y up).
    const hm = this.head.matrixWorld;
    v1.copy(this.eyeInHead).applyMatrix4(hm);
    const b = this.gaze;
    v2.x = b.x - v1.x; v2.y = b.y - v1.y; v2.z = b.z - v1.z;
    worldQuat(this.head, q1).multiply(this.headRestInv).invert();
    v2.applyQuaternion(q1);
    const w = this.look;
    f.gazeYaw = Math.atan2(v2.x, v2.z) * w;
    f.gazePitch = Math.atan2(v2.y, Math.sqrt(v2.x * v2.x + v2.z * v2.z)) * w;
    this.face!.update(dt, f);
    this.kit?.face?.value.set(this.face!.blink, this.face!.jaw);
  }

  /** `feet`: where each sole's lowest point is now. */
  private measureFeet(): void {
    for (let f = 0; f < 2; f++) {
      const foot = (f === 0 ? this.legL : this.legR)[2]!;
      this.footA.setFromMatrixPosition(foot.matrixWorld);
      worldQuat(foot, this.footQ);
      this.soleLow(f, this.footA, this.footQ);
      for (let k = 0; k < 12; k++) this.soleWorld[f * 12 + k] = this.soleP[k]!;
      this.feet[f * 3] = this.footA.x;
      this.feet[f * 3 + 1] = this.low1;
      this.feet[f * 3 + 2] = this.footA.z;
    }
  }

  /** The ready pose: the serve's address, the plain ready position, or on the way between them (addrW). */
  private mixReady(): void {
    const rk = this.readyFit;
    const a = this.addrW;
    if (a >= 0.999) { this.readyKey = this.addrKey; this.outAddr.set(0, 0, 0, 0); return; }
    if (a <= 0.001) { this.readyKey = rk; this.outAddr.set(0, 0, 0, 0); return; }
    const m = this.readyMix, k = this.addrKey;
    BL.u = a;
    m.p.copy(rk.p); lerpV(m.p, k.p);
    m.pole.copy(rk.pole); lerpV(m.pole, k.pole);
    m.off.copy(rk.off); lerpV(m.off, k.off);
    m.yaw = rk.yaw + (k.yaw - rk.yaw) * a;
    m.q.copy(rk.q);
    nlerpQ(m.q, k.q, this.outAddr);
    this.readyKey = m;
  }

  /**
   * After a point the partners meet as they walk back (MatchSim.walking 1) and touch rackets: within TAP_NEAR m of
   * each other, for TAP_HOLD s, each turns towards the other with the racket up in front (TAP). After match point
   * each does the same with the opponent across the net (MatchSim.overStage 3).
   */
  private racketTap(sim: MatchSim, idx: number, p: Player, dt: number): void {
    let want = 0;
    let bow = 0;
    const net = sim.phase === PH_OVER && sim.overStage === 3;
    if (sim.phase === PH_OVER && sim.overStage === 1) {
      // The end of a match: the winners run together and embrace; the beaten bend over, hands on the knees. Alone, the
      // winner goes on celebrating (reaction()), both arms up.
      this.tapT += dt;
      if ((idx & 1) !== sim.score.winner) {
        if (this.tapT > BOW_AFTER) { want = 1; bow = 1; this.tapKey = this.handed > 0 ? KNEES : KNEES_LEFT; }
      } else if (sim.doubles) {
        const q = sim.players[idx ^ 2]!;
        const mx = q.pos.x - p.pos.x, mz = q.pos.z - p.pos.z;
        if (mx * mx + mz * mz < HUG_NEAR * HUG_NEAR) {
          want = 1;
          this.tapKey = this.handed > 0 ? HUG : HUG_LEFT;
          this.tapYaw = Math.atan2(-mx, -mz);
        }
      } else {
        want = 1;
        this.tapKey = this.handed > 0 ? TRIUMPH : TRIUMPH_LEFT;
        this.tapYaw = this.yaw;
      }
    } else if ((sim.doubles && (sim.walking === 1 || sim.walking === 3)) || net) {
      // (walking 3 too: at a change of ends the sim walks partners to meet first and sends them to the post ENDS_TO_POST before
      // the hold ends, so a game won there gets its tap; review round 34, #8, closed 6 Nov)
      this.tapKey = null;
      const qi = net ? sim.overMate[idx]! : idx ^ 2, q = sim.players[qi]!;
      const mx = q.pos.x - p.pos.x, mz = q.pos.z - p.pos.z;
      if (mx * mx + mz * mz < TAP_NEAR * TAP_NEAR) {
        const was = this.tapT;
        this.tapT += dt;
        if (idx < qi && was < TAP_TOUCH && this.tapT >= TAP_TOUCH) {
          this.tapSeq++;
          this.tapAt[0] = (p.pos.x + q.pos.x) * 0.5;
          this.tapAt[1] = TAP_TOUCH_Y;
          this.tapAt[2] = (p.pos.z + q.pos.z) * 0.5;
        }
        want = this.tapT < TAP_HOLD ? 1 : 0;
        // (facing f looks along (-sin f, -cos f))
        this.tapYaw = Math.atan2(-mx, -mz);
      }
    } else this.tapT = 0;
    if (this.moodKey) {
      if (sim.time - this.moodAt < MOOD_TIME && want === 0) { want = 1; this.tapKey = this.moodKey; }
      else if (sim.time - this.moodAt >= MOOD_TIME) this.moodKey = null;
    }
    // (a cut starts it afresh, as it does the other weights: a key in the tap left them turned to where their partner had been, review round 34)
    this.tapW += (want - this.tapW) * (this.cutNow === 2 ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0);
    if (this.tapW < 0.001) this.tapW = 0;
    this.bowW += (bow - this.bowW) * (dt > 0 ? 1 - Math.exp(-dt / 0.3) : 0);
    if (this.bowW < 0.001) this.bowW = 0;
  }

  /** The ready key carried towards `k` by u, into `m` (the racket's turn kept continuous through `prev`). */
  private mixKey(m: Key, k: Key, u: number, prev: THREE.Quaternion): void {
    const r = this.readyKey;
    BL.u = u;
    m.p.copy(r.p); lerpV(m.p, k.p);
    m.pole.copy(r.pole); lerpV(m.pole, k.pole);
    m.off.copy(r.off); lerpV(m.off, k.off);
    m.yaw = r.yaw + (k.yaw - r.yaw) * u;
    m.q.copy(r.q);
    nlerpQ(m.q, k.q, prev);
    this.readyKey = m;
  }

  private resetInertia(): void {
    this.warpOff = 0;
    this.leanOk = false;
    this.cycleOk = false;
    this.warpShownOk = false;
    this.tiltOk = false;
    this.tiltX = 0;
    this.tiltZ = 0;
    this.hipTiltX = 0;
    this.hipTiltZ = 0;
    this.walkTurn = 0;
    this.walkTurnV = 0;
    this.gaitW = 0;
    this.gaitH = 0;
    this.gaitRunH = 0;
    this.runHipY = -1;
    this.gaitOn = 0;
    this.tiltVX = 0;
    this.tiltVZ = 0;
    this.retreat = 0;
    this.fadeOk.fill(0);
    this.elbowR.bend[1] = 0;
    this.elbowL.bend[1] = 0;
    this.inertia.reset();
    this.headInertia.reset();
    this.yawI.reset();
    this.kpI.reset();
    this.kqI.reset();
    this.kpoleI.reset();
    this.koffI.reset();
    this.kyawI.reset();
    this.wI.reset();
    this.dropI.reset();
    this.dropShown = 0;
    this.fallY = -1;
    this.fallOff = 0;
    this.pinOk.fill(0);
    this.driveRoll = 0;
    this.jumpT0 = -1;
    this.landAt = -1;
    this.upNeed = 0;
    this.racketQOk = false;
    this.kneeSideL.set(0, 0, 0);
    this.kneeSideR.set(0, 0, 0);
    this.shinOk.fill(0);
    this.lungeOff.fill(0);
    this.reachX = 0;
    this.reachZ = 0;
    this.lockOn.fill(0);
    this.relT.fill(-1);
    this.elbowR.side.set(0, 0, 0);
    this.elbowL.side.set(0, 0, 0);
    this.elbowR.dir.set(0, 0, 0);
    this.elbowL.dir.set(0, 0, 0);
    this.clearOff.set(0, 0, 0);
    this.elbowPush.set(0, 0, 0); this.elbowPushTo.set(0, 0, 0);
    this.outReady.set(0, 0, 0, 0);
    this.outKey.set(0, 0, 0, 0);
    this.outAddr.set(0, 0, 0, 0);
  }

  /**
   * The stroke's key and weight, carried on smoothly through a jump (a stroke picked again at the release, the
   * contact moved by a new plan). Any offset is gone by the contact: the racket still meets the ball.
   */
  /** smoothKey's time (a field: see BL). */
  private keyT = 0;
  private smoothKey(): void {
    const t = this.keyT;
    // The forward swing (it starts during the charge, timed to the plan) moves fast by design.
    const fast = (this.st === ST_SWING && t < this.tCon + 0.03) || (this.st === ST_PREP && this.swingS > 0);
    const keep = this.keepCon;
    if ((Avatar.inertMask & 8) === 0) { this.wI.keep = keep; this.smoothW(); return; }
    const P = this.kpI;
    P.limit = fast ? 45 : 10;
    P.keep = keep;
    P.in[0] = this.kp.x; P.in[1] = this.kp.y; P.in[2] = this.kp.z;
    P.step();
    this.kp.fromArray(P.out);
    const Q = this.kqI;
    Q.limit = fast ? (5000 * Math.PI) / 180 : (1500 * Math.PI) / 180;
    Q.keep = keep;
    Q.in.copy(this.kq);
    Q.step();
    this.kq.copy(Q.out);
    const L = this.kpoleI;
    L.limit = fast ? 30 : 6;
    L.keep = keep;
    L.in[0] = this.kpole.x; L.in[1] = this.kpole.y; L.in[2] = this.kpole.z;
    L.step();
    this.kpole.fromArray(L.out);
    const O = this.koffI;
    O.in[0] = this.koff.x; O.in[1] = this.koff.y; O.in[2] = this.koff.z;
    O.step();
    this.koff.fromArray(O.out);
    const Y = this.kyawI;
    Y.keep = keep;
    Y.in[0] = this.kyaw;
    Y.step();
    this.kyaw = Y.out[0]!;
    this.wI.keep = keep;
    this.smoothW();
  }

  /** The stroke weight, carried on smoothly (its offset gone by the contact: wI.keep, set by the caller). */
  private smoothW(): void {
    if ((Avatar.inertMask & 16) === 0) return;
    const W = this.wI;
    W.in[0] = this.w;
    W.step();
    this.w = Math.min(1, Math.max(0, W.out[0]!));
  }

  /**
   * What the player looks at (gaze): the ball, until it is dead. Then a person looks up: at their partner as they meet,
   * else level, the way they are going, with the head wandering a little. They all stared at a dead ball on the floor,
   * and looking down brings the lids down: every close-up between points was a player with their head bowed and their
   * eyes shut, whoever had won.
   */
  private gazeAt(sim: MatchSim, idx: number, t: number, dt: number): void {
    const away = sim.walking > 0 || sim.phase === PH_OVER;
    this.gazeUp += ((away ? 1 : 0) - this.gazeUp) * (dt > 0 ? 1 - Math.exp(-dt / GAZE_UP_T) : 1);
    const b = sim.ball.pos, G = this.gaze;
    if (this.gazeUp < 0.001) {
      G.copy(b);
      const u = this.addr ? routineTime(sim, t) : -1;
      if (u >= 0) G.y = routineHeight(u, b.y, sim.world.spec.radius);
      return;
    }
    const hm = this.head.matrixWorld.elements, hy = hm[13]!;
    let x: number, z: number, y = hy;
    const mate = sim.doubles && sim.walking === 1 ? sim.players[(idx + 2) & 3]! : null;
    const mx = mate ? mate.pos.x - hm[12]! : 0, mz = mate ? mate.pos.z - hm[14]! : 0;
    if (mate && mx * mx + mz * mz < GAZE_MATE * GAZE_MATE) {
      x = mate.pos.x; z = mate.pos.z; y = GAZE_MATE_Y;
    } else {
      worldQuat(this.spine[2]!, q1).multiply(this.chestRestInv);
      v1.x = 0; v1.y = 0; v1.z = 1;
      v1.applyQuaternion(q1);
      const a = Math.atan2(v1.x, v1.z) + Math.sin(t * GAZE_DRIFT + idx * 1.7) * GAZE_WANDER;
      x = hm[12]! + Math.sin(a) * GAZE_FAR; z = hm[14]! + Math.cos(a) * GAZE_FAR;
    }
    const u = this.gazeUp;
    G.x = b.x + (x - b.x) * u; G.y = b.y + (y - b.y) * u; G.z = b.z + (z - b.z) * u;
  }

  /**
   * What they look at never jumps: the ball put back for the next point took it across the court in a frame, and all four
   * heads turned 8-10 degrees with it. In play it is left alone, the ball's fastest frame being well under GAZE_JUMP.
   */
  private gazeSettle(dt: number): void {
    const G = this.gaze, W = this.gazeWas, F = this.gazeFrom;
    const ox = W.x - G.x, oy = W.y - G.y, oz = W.z - G.z;
    if (ox * ox + oy * oy + oz * oz > GAZE_JUMP * GAZE_JUMP) {
      F.x += ox; F.y += oy; F.z += oz;
    }
    W.copy(G);
    const k = dt > 0 ? Math.exp(-dt / GAZE_SETTLE) : 1;
    F.x *= k; F.y *= k; F.z *= k;
    G.x += F.x; G.y += F.y; G.z += F.z;
  }

  /**
   * Turn the neck and head to what they look at (gaze), as far as a neck turns from the chest. Facings are read off the
   * bones themselves (the clip may already have the head turned), so this only adds what is missing.
   */
  private watchBall(): void {
    const b = this.gaze;
    const hm = this.head.matrixWorld.elements;
    const dx = b.x - hm[12]!, dy = b.y - hm[13]!, dz = b.z - hm[14]!;
    const want = Math.atan2(dx, dz);
    const elev = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    worldQuat(this.spine[2]!, q1).multiply(this.chestRestInv);
    v1.x = 0; v1.y = 0; v1.z = 1;
    v1.applyQuaternion(q1);
    const chest = Math.atan2(v1.x, v1.z);
    worldQuat(this.head, q1).multiply(this.headRestInv);
    v1.x = 0; v1.y = 0; v1.z = 1;
    v1.applyQuaternion(q1);
    const hy = Math.atan2(v1.x, v1.z);
    const hp = Math.asin(Math.max(-1, Math.min(1, v1.y)));
    const rel = Math.max(-LOOK_YAW, Math.min(LOOK_YAW, wrapAngle(want - chest)));
    const yaw = wrapAngle(chest + rel - hy) * this.look;
    const pitch = (Math.max(-0.8, Math.min(0.7, elev)) - hp) * this.look;
    // Positive turns about the facing's left axis look down.
    const fy = hy + yaw;
    v2.x = Math.cos(fy); v2.y = 0; v2.z = -Math.sin(fy);
    q2.setFromAxisAngle(UP, yaw * NECK_SHARE);
    q3.setFromAxisAngle(v2, -pitch * NECK_SHARE);
    q2.premultiply(q3);
    rotateWorld(this.neck, q2);
    this.neck.updateMatrixWorld(true);
    q2.setFromAxisAngle(UP, yaw * (1 - NECK_SHARE));
    q3.setFromAxisAngle(v2, -pitch * (1 - NECK_SHARE));
    q2.premultiply(q3);
    rotateWorld(this.head, q2);
    this.head.updateMatrixWorld(true);
  }

  /**
   * Reaction clips on the upper body while the ball is dead after a point (its last striker), and after match point
   * (everyone: the winners celebrate, the losers hang their heads; the last striker's carries on).
   */
  private reaction(sim: MatchSim, idx: number, t: number): void {
    const phase = sim.phase;
    if (phase === PH_DEAD && this.lastPhase !== PH_DEAD) {
      const won = sim.pointWinner;
      this.react = null;
      if (won >= 0 && sim.lastStrikePlayer === idx) {
        const mine = (idx & 1) === won;
        this.reactStart = t;
        // (one time in three not a clip: the same two reactions for everybody, every point, was the critic's #12)
        this.reactN = (this.reactN + 1) | 0;
        if ((this.reactN + idx) % 3 === 0) {
          this.moodKey = mine ? (this.handed > 0 ? FIST : FIST_LEFT) : this.handed > 0 ? HIP : HIP_LEFT;
          this.moodSign = mine ? 1 : -1;
          this.moodAt = sim.time;
        } else {
          this.react = mine ? this.clips.celebrate : this.clips.dejected;
          this.reactFrom = mine ? 0.4 : 0.9;
        }
      }
    } else if (phase === PH_OVER && this.lastPhase !== PH_OVER) {
      const mine = (idx & 1) === sim.score.winner;
      const clip = mine ? this.clips.celebrate : this.clips.dejected;
      if (this.react !== clip) {
        this.react = clip;
        this.reactFrom = mine ? 0.4 : 0.9;
        this.reactStart = t;
      }
    }
    this.lastPhase = phase;
    if (!this.react) return;
    let rt = t - this.reactStart;
    // (a match won: again and again until the partners meet)
    if (phase === PH_OVER && sim.overStage === 1 && (idx & 1) === sim.score.winner && rt > 1.5 && this.tapW < 0.3) {
      this.reactStart = t;
      rt = 0;
    }
    // (it carries on into the walk back, which starts 1.2 s after the point)
    const live = phase === PH_DEAD || sim.walking > 0 || (phase === PH_OVER && sim.overStage === 1);
    const w = smoothstep(0, 0.2, rt) * (1 - smoothstep(1.25, 1.55, rt)) * (live ? 1 : 0);
    if (rt > 1.6 || !live) { this.react = null; return; }
    const tmp = this.tmp;
    tmp.t = this.reactFrom + rt;
    sampleClip(this.react, tmp);
    tmp.w = w;
    blendMasked(this.pose, tmp, this.upper);
  }

  /**
   * The split step: a ballistic hop for the sim's airborne time (g T^2 / 8 high: 2.5 cm for 142 ms), then a 5 cm
   * knee bend as the landing loads the legs.
   */
  /**
   * The drop that puts the hips where a body can be (FALL_G, FALL_PLAN): the pose's height above the root followed with a
   * speed of its own. In the air (a split step's hop, a jump) the lift is ballistic already: followed exactly, and its speed
   * carried into the landing, which the legs then brake.
   */
  private governFall(drop: number): number {
    const lift = this.root.position.y, clip = this.hips.matrixWorld.elements[13]! - lift, want = clip - drop, dt = this.dt;
    if (!Avatar.fallOn) { this.fallY = -1; return drop; }
    if (this.fallY < 0) { this.fallY = this.fallWant = want; this.fallV = this.fallR = this.fallRV = 0; this.fallIn = false; this.fallLift = lift; return drop; }
    if (dt <= 0) return clip - this.fallY;
    // In the air the lift is the fall, ballistic already, and the legs under it are free: followed exactly, the hips' speed kept.
    // Landed, the hips go on from where they were at that speed, and the legs brake it.
    if (lift > 0) {
      this.fallV = (want + lift - this.fallY - this.fallLift) / dt;
      this.fallY = this.fallWant = want;
      this.fallLift = lift;
      this.fallR = this.fallRV = 0;
      this.fallIn = false;
      return drop;
    }
    if (this.fallLift > 0) { this.fallY += this.fallLift; this.fallLift = 0; }
    const tc = this.st === ST_SWING || this.st === ST_FADE ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : -1;
    // Only into a stroke and through its ball: elsewhere the walk and the run set the hips' height by what the feet on the floor
    // reach. Held above that, the legs fell short and planted feet slid after the hips (p8 16 cm/s on a fifth of her frames);
    // held there only as far as the feet reach, the hips jumped at the limit and pops doubled. Out of a stroke the hips are the
    // pose's, at its speed, so a stroke's fall starts from the body's own; the run's bob and landings are a body's themselves.
    if (tc < 0 || this.lastT > tc + FALL_AFTER) {
      // (what the stroke left goes on a spring of its own, over the pose as it moves, FALL_LET)
      if (this.fallIn) {
        this.fallR = this.fallY - want;
        this.fallRV = this.fallV - (want - this.fallWant) / dt;
        this.fallIn = false;
      }
      if (this.fallR !== 0 || this.fallRV !== 0) {
        this.fallRV += (-FALL_LET * FALL_LET * this.fallR - 2 * FALL_LET * this.fallRV) * dt;
        this.fallR += this.fallRV * dt;
        if ((this.fallR < 0 ? -this.fallR : this.fallR) < 1e-4 && (this.fallRV < 0 ? -this.fallRV : this.fallRV) < 1e-3) this.fallR = this.fallRV = 0;
      }
      const y = want + this.fallR;
      this.fallV = (y - this.fallY) / dt;
      this.fallY = y;
      this.fallWant = want;
      return clip - y;
    }
    this.fallIn = true;
    this.fallR = this.fallRV = 0;
    this.fallWant = want;
    let to = want;
    if (tc > this.lastT) {
      const tau = tc - this.lastT - FALL_EARLY;
      const plan = clip - this.dropC + (tau > 0 ? FALL_PLAN * tau * tau : 0);
      if (plan < to) to = plan;
    }
    const lo = -FALL_G * dt, hi = FALL_BRAKE * dt;
    const e = this.fallY - to;
    const vd = e > 0 ? -Math.sqrt(2 * FALL_BRAKE * e) : Math.sqrt(2 * FALL_G * -e);
    let dv = vd - this.fallV;
    if (dv < lo) dv = lo;
    else if (dv > hi) dv = hi;
    this.fallV += dv;
    let y = this.fallY + this.fallV * dt;
    // (a fall arriving within the step is there: stopping it is the legs braking; a rise goes over and comes back at under g)
    if (e > 0 && y < to) { y = to; this.fallV = (y - this.fallY) / dt; }
    this.fallY = y;
    return clip - y;
  }

  private splitStep(p: Player, t: number): void {
    const u = t - p.splitAt;
    const len = p.tune.splitStepTime;
    const air = p.tune.splitStepAir;
    this.lift = 0;
    this.splitDrop = 0;
    if (u < 0 || u >= len) return;
    if (u < air) this.lift = 4.905 * u * (air - u);
    else this.splitDrop = 0.05 * Math.sin((Math.PI * (u - air)) / (len - air));
  }

  /**
   * The sim's dive or jump for a ball out of reach (windows.ts STRETCH_*). A jump is drawn as the overhead's hop is, on
   * the sim's own take-off and landing. A dive, until it is animated (owner, 2026-11-04: gameplay first), only drops the
   * body towards the floor through its flight, holds it there and rises at the end; the reach leans it to the ball.
   */
  private stretchMotion(p: Player, t: number): void {
    if (p.stretchKind === STRETCH_JUMP && t >= p.stretchAt && t < p.stretchLand && this.jumpT0 !== p.stretchAt) {
      this.jumpT0 = p.stretchAt;
      this.jumpT = p.stretchLand - p.stretchAt;
      this.jumpH = (9.81 * this.jumpT * this.jumpT) / 8;
      this.landAt = -1;
    } else if (p.stretchKind === STRETCH_DIVE) {
      this.splitDrop += DIVE_DROP * this.legK * smoothstep(p.stretchAt, p.stretchLand, t) * (1 - smoothstep(p.stretchUntil - DIVE_RISE, p.stretchUntil, t));
    }
  }

  /**
   * The overhead's hop (JUMP_MAX for a smash, JUMP_MAX_OH for a bandeja or víbora): taken off so that it peaks at the contact, as high as the ball is above the toes'
   * reach then (a late take-off flies lower to peak on time), held whatever the plan does next, and landed on bent
   * knees. Adds to lift and splitDrop (after splitStep). The feet leave their locks as the clip's soles leave the floor.
   */
  private smashJump(t: number): void {
    this.liftBall = 0;
    if (this.jumpT0 >= 0) {
      const u = (t - this.jumpT0) / this.jumpT;
      if (u >= 0 && u < 1) { this.lift += 4 * this.jumpH * u * (1 - u); if (u < 0.5) this.liftBall = this.jumpH; return; }
      this.landAt = u >= 1 ? this.jumpT0 + this.jumpT : -1;
      this.jumpT0 = -1;
    }
    if (this.landAt >= 0) {
      const v = (t - this.landAt) / LAND_TIME;
      if (v >= 0 && v < 1) this.splitDrop += LAND_DROP * this.legK * Math.sin(Math.PI * v);
      else this.landAt = -1;
    }
    const fam = rightFamily(this.fam);
    if (fam !== SMASH && fam !== OVERHEAD && fam !== VIBORA) return;
    const tc = this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : -1;
    if (tc < 0 || t >= tc) return;
    const h = Math.min(((fam === SMASH ? JUMP_MAX : JUMP_MAX_OH) + this.jumpMore) * this.legK, this.upNeed - JUMP_TOES);
    if (h < 0.03) return;
    const T = 2 * Math.sqrt((2 * h) / 9.81);
    this.liftBall = h;
    if (t < tc - T / 2) {
      // The knees load before a smash's jump (on video 93 and 67 degrees about 0.65 s before the hit, then straight).
      const v = (t - (tc - T / 2 - JUMP_DIP_TIME)) / JUMP_DIP_TIME;
      if (v > 0 && fam === SMASH) this.splitDrop += JUMP_DIP * this.legK * Math.sin(Math.PI * v);
      return;
    }
    const T2 = Math.min(T, 2 * (tc - t));
    this.jumpT = T2;
    this.jumpH = (9.81 * T2 * T2) / 8;
    this.jumpT0 = t;
    this.landAt = -1;
  }

  /**
   * In the air, an overhead's scissor kick: the racket-side leg comes through behind, knee bent, the other reaches
   * forward for the landing (MediaPipe on WPT smashes: knees 138 and 37 at the top of the jump, where every smash here
   * was dead straight, 1.7 degrees). After the ball: at it the legs are long and under the body, knees 27 and 23 on the
   * footage, where the kick opened 0.15 s before it had the feet a metre apart with the front knee locked. And on the
   * floor the rear foot of a bandeja or a víbora comes off it into the ball.
   */
  private scissor(): void {
    const rear = this.handed > 0 ? 1 : 0;
    const back = rear === 1 ? this.footR : this.footL, front = rear === 1 ? this.footL : this.footR;
    const con = this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : -1;
    this.airK = 0;
    this.airLong = 0;
    if (this.jumpT0 < 0 || this.jumpT <= 0) {
      const name = rightFamily(this.fam).name;
      if (con >= 0 && (name === 'overhead' || name === 'vibora')) {
        const T = this.lastT - con;
        const roll = REAR_ROLL * smoothstep(REAR_ROLL_FROM, REAR_ROLL_AT, T) * (1 - smoothstep(REAR_DOWN_FROM, REAR_DOWN_AT, T));
        if (roll > 0.001) this.rollOver(rear, back, rear === 1 ? this.footQR : this.footQL, roll);
        back.y += REAR_OFF * smoothstep(REAR_OFF_FROM, REAR_OFF_AT, T) * (1 - smoothstep(REAR_OFF_LAND_FROM, REAR_OFF_LAND_AT, T));
      }
      let want = 0, f = this.driveRollF;
      if (con >= 0 && (name === 'serve' || DRIVES.test(name))) {
        const T = this.lastT - con;
        f = name.startsWith('backhand') ? 1 - rear : rear;
        want = (name === 'serve' ? SERVE_ROLL : DRIVE_ROLL) * smoothstep(DRIVE_ROLL_FROM, DRIVE_ROLL_AT, T) * (1 - smoothstep(DRIVE_DOWN_FROM, DRIVE_DOWN_AT, T));
      }
      // (no faster than DRIVE_ROLL_RATE, and down before it changes feet: the serve's contact moves when its swing starts, and the heel
      // jumped with it, serve pops 7 a minute to 42)
      if (f !== this.driveRollF) { if (this.driveRoll > 0.001) want = 0; else this.driveRollF = f; }
      const step = DRIVE_ROLL_RATE * this.dt, d = want - this.driveRoll;
      this.driveRoll += d > step ? step : d < -step ? -step : d;
      const g = this.driveRollF;
      if (this.driveRoll > 0.001) this.rollOver(g, g === 1 ? this.footR : this.footL, g === 1 ? this.footQR : this.footQL, this.driveRoll);
      return;
    }
    const u = (this.lastT - this.jumpT0) / this.jumpT;
    if (u <= 0 || u >= 1) return;
    const air = 4 * u * (1 - u);
    const lift = this.jumpH * air;
    this.airK = smoothstep(0.02, SCISSOR_FULL, lift);
    // Long legs up to the ball, let go as the kick opens after it.
    this.airLong = con < 0 ? 0 : this.airK * (1 - smoothstep(SCISSOR_FROM, SCISSOR_OPEN, this.lastT - con));
    if (lift < 0.02) return;
    const k = Math.min(1, lift / SCISSOR_FULL), kick = k * (con < 0 ? 1 : smoothstep(SCISSOR_FROM, SCISSOR_OPEN, this.lastT - con));
    const fx = this.stanceS, fz = this.stanceC;
    back.x -= fx * SCISSOR_BACK * kick; back.z -= fz * SCISSOR_BACK * kick;
    back.y += SCISSOR_UP * kick + SCISSOR_TUCK * k;
    front.x += fx * SCISSOR_FRONT * kick; front.z += fz * SCISSOR_FRONT * kick;
    front.y += SCISSOR_FRONT_UP * kick + SCISSOR_TUCK * k;
    // (up to the ball the rear leg is long as well: the clip's bent rear foot came with the jump, knee 64 at the hit against 23 on video)
    if (con >= 0 && back.y > front.y + AIR_REAR_UP) back.y -= (back.y - front.y - AIR_REAR_UP) * k * (1 - smoothstep(SCISSOR_FROM, SCISSOR_OPEN, this.lastT - con));
  }

  /** Foot f's target rolled over the ball of the foot, heel up by `pitch` rad, the toes staying flat on the floor as they are. */
  private rollOver(f: number, A: THREE.Vector3, Q: THREE.Quaternion, pitch: number): void {
    const b = this.ballLen, h = this.ankleY, sn = Math.sin(pitch), cs = Math.cos(pitch), fw = b * (1 - cs) + h * sn;
    q3.copy(this.footRestQ[f]!).invert().premultiply(Q);
    v1.set(0, 0, 1).applyQuaternion(q3);
    const l = Math.sqrt(v1.x * v1.x + v1.z * v1.z) || 1, sf = v1.x / l, cf = v1.z / l;
    A.x += sf * fw;
    A.y += b * sn + h * (cs - 1);
    A.z += cf * fw;
    const toe = this.toes[f]!;
    qWalk.multiplyQuaternions(Q, toe.quaternion);
    v1.set(cf, 0, -sf);
    q3.setFromAxisAngle(v1, pitch);
    Q.premultiply(q3);
    qWalk2.copy(Q).invert().multiply(qWalk);
    toe.quaternion.copy(qWalk2);
  }

  /** Crouch and lunge: lower the hips (and push them towards a ball out of reach) with the feet kept planted. */
  private solveLegs(): void {
    // How far the arm would fall short of where the key puts the wrist: the hips go that way (up to 40 cm out,
    // down up to 30 cm for a ball below the shoulder, the knees taking the drop; up to 12 cm for one above
    // the reach, onto the toes or off the ground). Before the contact, the contact's key: the same at the ball, and
    // steady before it (the swinging key moves at racket speed, and the hips followed it, up to 29 cm in a frame).
    const before = (this.st === ST_PREP && this.hasCon) || (this.st === ST_SWING && this.lastT < this.tCon);
    {
      // Into the ball: the hips over the front of the feet by the contact (they were 6-14 cm behind them).
      const go = this.st === ST_PREP ? this.swingS : this.st === ST_SWING || this.st === ST_FADE ? 1 : 0;
      if (this.jumpT0 < 0) this.intoBall += ((this.fam.weight ?? 0) * go * this.w - this.intoBall) * (this.dt > 0 ? 1 - Math.exp(-this.dt / INTO_EASE) : 0);
    }
    if (before) {
      const k = this.contactKey();
      this.toWorld(k.p, v1);
      this.quatToWorld(k.q, q2);
    } else {
      this.toWorld(this.kp, v1);
      this.quatToWorld(this.kq, q2);
    }
    q3.multiplyQuaternions(q2, this.grip.qInv);
    v3.copy(this.grip.pos).applyQuaternion(q3);
    v2.setFromMatrixPosition(this.armRacket[0]!.matrixWorld);
    // (with the weight going in as well: the two together took the hips 20 cm too near the ball, 37 cm on at a serve, and
    // the arm hit it folded at 96 degrees)
    v2.z += (before ? this.fam.weight ?? 0 : this.intoBall) * this.netZ;
    // Measured from where the shoulder will be at the contact: a player still running to the ball gets there on
    // their feet, not by lunging the hips out (that put the hips 0.33 m off the floor at a sprint, the knees folded
    // through). The run left: towards the plan's spot, as far as the present speed covers in the time left.
    const left = (this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : this.lastT) - this.lastT;
    if (left > 0 && this.planOk) {
      const ex = this.planX - this.root.position.x, ez = this.planZ - this.root.position.z;
      const ed = Math.sqrt(ex * ex + ez * ez);
      const go = Math.sqrt(this.vx * this.vx + this.vz * this.vz) * Math.min(left, 0.6);
      if (ed > 1e-3) { const f = Math.min(1, go / ed); v2.x += ex * f; v2.z += ez * f; }
    }
    const dx = v1.x - v3.x - v2.x, dy = v1.y - v3.y - v2.y, dz = v1.z - v3.z - v2.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Leaning in over the last LEAN_FROM s before the contact, not from the start of the prep (from the contact's key
    // the hips leaned 18 cm towards a ball 0.4 s away at p90, and 20-29 cm through a serve's toss).
    const lean = before ? smoothstep(LEAN_FROM, LEAN_FULL, left) : 1;
    // (a volley is punched from a bent arm, elbow 63 on video: the body goes to the ball, not the arm)
    const armTo = this.armLen * (this.fam.arm ?? (this.fam.wrist || this.fam.volley ? VOLLEY_ARM : 0.96));
    const short = len > 1e-3 ? Math.max(0, len - armTo) * this.w * lean : 0;
    // How far above the arm's reach the contact is, whole (the smash's hop is decided before the lean is in).
    this.upNeed = before && len > 1e-3 && dy > 0 ? (Math.max(0, len - armTo) * dy) / len : 0;
    const dh = Math.sqrt(dx * dx + dz * dz);
    const push = dh > 1e-3 ? Math.min(0.4 * this.legK, (short * dh) / len) : 0;
    let rx = dh > 1e-3 ? (dx / dh) * push : 0;
    let rz = dh > 1e-3 ? (dz / dh) * push : 0;
    // Before the contact the target is steady, and its limit only smooths a new plan in (the reach must be whole by
    // the contact: it is what puts the racket on the ball).
    // (nothing pushes off in the air: the hips went back, forward and back again through a jump, 0.56 m of path on a 0.16 m flight)
    if (this.dt > 0) {
      const ex = rx - this.reachX, ez = rz - this.reachZ;
      const e = Math.sqrt(ex * ex + ez * ez);
      // (after the ball from where it was going: the limit from a standing start was a corner on the frame of contact, 2 m/s and more in a tick on every stroke)
      const top = this.jumpT0 >= 0 ? (before ? 0 : REACH_RATE_AIR) : before ? REACH_RATE_BEFORE : this.landAt >= 0 ? REACH_RATE_LAND : REACH_RATE, was = this.reachV + REACH_ACC * this.dt;
      const lim = (before || was > top ? top : was) * this.dt;
      if (e > lim) { rx = this.reachX + (ex * lim) / e; rz = this.reachZ + (ez * lim) / e; }
      this.reachV = (e > lim ? lim : e) / this.dt;
    }
    this.reachX = rx;
    this.reachZ = rz;
    const share = (this.fam.wrist || this.fam.volley ? VOLLEY_DOWN : DOWN_SHARE) + DOWN_LOW * smoothstep(DOWN_LOW0, DOWN_LOW1, v1.y);
    const K = this.legK;
    let down = dy < 0 ? Math.min(0.3 * K, (short * -dy) / len) * share : 0;
    if (before) {
      // (the same at the ball, the lean whole: what the fall is planned towards)
      const sc = len > 1e-3 ? Math.max(0, len - armTo) * this.w : 0;
      this.dropC = Math.min(DROP_MAX * K, this.crouchC + (dh > 1e-3 ? Math.min(0.4 * K, (sc * dh) / len) : 0) * 0.15 + (dy < 0 ? Math.min(0.3 * K, (sc * -dy) / len) * share : 0))
        - (dy > 0 ? Math.min(0.12 * K, (sc * dy) / len) : 0);
    }
    // A volley's finish stays down where it met the ball, and the hips went on following that key: lowest 0.3 s after
    // the ball, back 0.55 s after it, and four volleys in ten ran off still sitting. The drop was for the ball. A serve the same: 7 cm down and back
    // in a quarter of a second after every ball (review round 27).
    if (this.fam.wrist || this.fam.volley || rightFamily(this.fam).name === 'serve') {
      if (before) this.downAt = down;
      else down = this.downAt * (1 - smoothstep(0, VOLLEY_UP, this.lastT - this.tCon));
    }
    // The knees bend no faster than a body drops (the crouch jumped when the stroke or its contact changed). The
    // reach follows the stroke's key, which is smoothed already.
    let crouch = this.crouch;
    if (this.inertial && (Avatar.inertMask & 32) !== 0) {
      const D = this.dropI;
      D.keep = this.keepCon;
      D.in[0] = crouch;
      D.step();
      crouch = D.out[0]!;
    }
    // No lower than a deep lunge (hips about 0.4 m; crouch, reach and drop together reached 0.62).
    let drop = Math.min(DROP_MAX * K, crouch + push * 0.15 + down + this.splitDrop) - (dy > 0 ? Math.min(0.12 * K, (short * dy) / len) : 0);
    // Up out of a low reach no faster than a body stands up from a lunge: the reach follows the stroke's key, which
    // swings up and in after the contact, and the hips came up 0.19 m in four frames.
    if (this.dt > 0 && drop < this.dropShown - HIP_RISE * this.dt) drop = this.dropShown - HIP_RISE * this.dt;
    // Down no faster than a body drops into a lunge: the contact's key jumps when the contact is replanned at the
    // release (an overhead planned at 2.0 m taken at 1.2 m), and the hips fell 20-30 cm in a frame, the knees 50-97°.
    if (this.dt > 0 && drop > this.dropShown + HIP_FALL * this.dt) drop = this.dropShown + HIP_FALL * this.dt;
    // And after the ball from the speed they had: on the frame of contact a serve's hips went from rising to falling at the limit.
    if (this.dt > 0) {
      const v = (drop - this.dropShown) / this.dt, lim = REACH_ACC * this.dt;
      if (!before) drop = this.dropShown + (v > this.dropV + lim ? this.dropV + lim : v < this.dropV - lim ? this.dropV - lim : v) * this.dt;
      this.dropV = (drop - this.dropShown) / this.dt;
    }
    // Never lower than a deep lunge, thigh level (the drop and the reach together put the hip joints 0.28 m off the
    // floor, the legs folded flat and turning over).
    const room = this.hips.matrixWorld.elements[13]! - HIP_FLOOR * K;
    if (drop > room) drop = room > 0 ? room : drop < 0 ? drop : 0;
    this.dropShown = drop;
    // The weight from the ankles: the hips over the driving foot, behind a braking one.
    const tk = this.legLen * LEAN_HIP * (1 - LEAN_STROKE * this.w);
    let hipX = this.reachX + this.hipTiltX * tk, hipZ = this.reachZ + this.hipTiltZ * tk + this.intoBall * this.netZ;
    const tilt2 = this.hipTiltX * this.hipTiltX + this.hipTiltZ * this.hipTiltZ;
    drop += 0.5 * tilt2 * tk;
    if (this.gaitH > 0) {
      // The walk's hips: over the foot that is down, lowest with both down.
      const ph = this.gaitPhase, h = this.gaitH;
      // (over the floor the jump has left: see the run's)
      const y = (this.legL[0]!.matrixWorld.elements[13]! + this.legR[0]!.matrixWorld.elements[13]!) * 0.5 - this.lift;
      const want = this.legLen * WALK_HIP + this.ankleY - WALK_BOB * this.legK * 0.5 * (1 + Math.cos(4 * Math.PI * (ph - (WALK_STANCE - 0.5) / 2)));
      drop += (y - want) * h;
      const sway = WALK_SWAY * h * Math.cos(2 * Math.PI * (ph - WALK_STANCE / 2));
      hipX += this.stanceC * sway;
      hipZ -= this.stanceS * sway;
    }
    if (this.gaitRunH > 0) {
      // (the hips' height without a jump's lift: a smash jumped out of a run had the run's hips, a height over the floor, pulled back down
      // by all the jump lifted them while the run faded: 0.13 m at the ball, the feet hanging that much lower and the racket 10-19 cm short)
      const y = (this.legL[0]!.matrixWorld.elements[13]! + this.legR[0]!.matrixWorld.elements[13]!) * 0.5 - this.lift;
      const fast = smoothstep(RUN_V0, RUN_V1, this.sp), stance = RUN_DUTY0 + (RUN_DUTY1 - RUN_DUTY0) * fast;
      const low = (this.legLen + this.ankleY) * (RUN_HIP0 + (RUN_HIP1 - RUN_HIP0) * fast);
      // (on the feet's own clock, the time since the last landing: gaitPhase is the arms' and lags the landings, and on it the hips rode
      // highest with a foot under them and lowest as it left, a walk's wave on a run's legs)
      const step = 2 * this.gaitHz * this.gaitSince;
      // (no more bob than the body can come down from at FALL_G at this cadence: half of it times (2 pi f)^2 is the fall at its top, and a
      // fixed 6 cm at four steps a second came down at 1.9 g; runners bob less the quicker their steps)
      const fs = 2 * this.gaitHz, top0 = (2 * FALL_G) / (4 * Math.PI * Math.PI * fs * fs), bob = top0 < RUN_BOB * this.legK ? top0 : RUN_BOB * this.legK;
      let want = low + bob * 0.5 * (1 - Math.cos(2 * Math.PI * ((step < 1 ? step : 1) - 2 * RUN_LOW * stance)));
      // No higher than the feet on the floor can reach, and the one about to be: a leg at full stretch is where a knee pops.
      const r2 = this.legLen * this.legLen * RUN_STRETCH * RUN_STRETCH, ox = this.root.position.x + hipX, oz = this.root.position.z + hipZ;
      // The one in the air, planned from its landing as a stroke's fall is from the ball (FALL_PLAN): no higher than its leg reaches
      // there from where the hips will be, plus what a fall covers in the time left. Judged from the hips as they are, and only
      // in the last of the swing, a braking foot put out in front pulled them down 9 cm in 0.08 s, at 2 g (review round 33, #8).
      const swingT = (1 - (RUN_DUTY0 + (RUN_DUTY1 - RUN_DUTY0) * fast)) / (this.gaitHz > 0 ? this.gaitHz : 1);
      for (let f = 0; f < 2; f++) {
        const u = this.gaitSwing[f]!;
        const left = u < 0 ? 0 : (1 - u) * swingT;
        const P = u < 0 ? (f === 0 ? this.footL : this.footR) : this.gaitTo[f]!;
        const gx = P.x - ox - this.vx * left, gz = P.z - oz - this.vz * left, room = r2 - gx * gx - gz * gz;
        if (room > 0) {
          const top = (u < 0 ? P.y : this.ankleY) + Math.sqrt(room) + FALL_PLAN * left * left;
          if (top < want) want = top;
        }
      }
      if (want < low - RUN_SINK * this.legK) want = low - RUN_SINK * this.legK;
      if (this.runHipY < 0) this.runHipY = this.runHipTo = want;
      // (eased first: each cap above comes and goes with a foot, and went straight to the limit, the head jumping 2 cm in a frame nine times a second)
      this.runHipTo += (want - this.runHipTo) * (this.dt > 0 ? 1 - Math.exp(-this.dt / RUN_HIP_EASE) : 0);
      const lim = RUN_HIP_RATE * this.dt, to = this.runHipTo;
      this.runHipY += to > this.runHipY + lim ? lim : to < this.runHipY - lim ? -lim : to - this.runHipY;
      drop += (y - this.runHipY) * this.gaitRunH;
    } else this.runHipY = -1;
    const wanted = drop;
    drop = this.governFall(drop);
    this.fallOff = drop - wanted;
    this.hipOutX = hipX;
    this.hipOutZ = hipZ;
    const plant = this.plantW >= 0.01;
    const pushed = Math.abs(hipX) + Math.abs(hipZ);

    this.footL.setFromMatrixPosition(this.legL[2]!.matrixWorld);
    this.footR.setFromMatrixPosition(this.legR[2]!.matrixWorld);
    worldQuat(this.legL[2]!, this.footQL);
    worldQuat(this.legR[2]!, this.footQR);
    this.measureSoles();
    const fx0 = this.footL.x, fz0 = this.footL.z, gx0 = this.footR.x, gz0 = this.footR.z;
    if ((Avatar.feetMask & 1) !== 0) {
      this.lockFeet();
      this.walkFeet();
    }
    // No sole below the floor (a blend of two directions' strides can put one 6 cm under), measured as the foot
    // will be: at its target, turned as the locks hold it, the toes as they are.
    let lifted = false;
    if ((Avatar.feetMask & 2) !== 0) {
      for (let f = 0; f < 2; f++) {
        const A = f === 0 ? this.footL : this.footR;
        this.soleLow(f, A, f === 0 ? this.footQL : this.footQR);
        const low = this.low1;
        if (low < 0) { A.y -= low; lifted = true; }
      }
    }
    this.scissor();
    if (this.leanPelvis > 0) {
      // The legs go with the pelvis: the feet about its middle by the same turn (they are off the floor, and no lower than it).
      const H = this.hips.matrixWorld.elements, hx = H[12]!, hy = H[13]!, hz = H[14]!, floor = this.ankleY;
      for (let f = 0; f < 2; f++) {
        const A = f === 0 ? this.footL : this.footR;
        v1.set(A.x - hx, A.y - hy, A.z - hz).applyQuaternion(this.leanW);
        A.set(hx + v1.x, Math.max(floor, hy + v1.y), hz + v1.z);
        (f === 0 ? this.footQL : this.footQR).premultiply(this.leanW);
      }
    }
    for (let f = 0; f < 2; f++) this.pinFoot(f);
    const moved = Math.abs(this.footL.x - fx0) + Math.abs(this.footL.z - fz0) + Math.abs(this.footR.x - gx0) + Math.abs(this.footR.z - gz0);
    if (drop < 0.005 && drop > -0.005 && pushed < 0.005 && !plant && !lifted && moved < 1e-4 && this.lockOn[0] === 0 && this.lockOn[1] === 0 && this.gaitW === 0) {
      // The clip's knees as they are: no side to carry on from next time.
      this.kneeSideL.set(0, 0, 0);
      this.kneeSideR.set(0, 0, 0);
      return;
    }
    // Hips are a child of the (turned) model: move them in its frame.
    const c = Math.cos(this.root.rotation.y), s = Math.sin(this.root.rotation.y);
    // How the knees bend in the clip, before the hips move.
    bendFwd.set(s, 0, c);
    bendDir(this.legL[0]!, this.legL[1]!, this.legL[2]!, bendFwd, bendL);
    bendDir(this.legR[0]!, this.legR[1]!, this.legR[2]!, bendFwd, bendR);
    this.hips.position.x += hipX * c - hipZ * s;
    this.hips.position.z += hipX * s + hipZ * c;
    this.hips.position.y -= drop;
    this.hips.updateMatrixWorld(true);
    // Knees bend the way the clip bends them, turned to the foot; see the limits below.
    const ml = this.legL[0]!.matrixWorld.elements, mr = this.legR[0]!.matrixWorld.elements;
    let ox = mr[12]! - ml[12]!, oz = mr[14]! - ml[14]!;
    const ol = Math.sqrt(ox * ox + oz * oz) || 1;
    ox /= ol; oz /= ol;
    const pelvis = Math.atan2(oz, -ox);
    for (let side = 0; side < 2; side++) {
      const leg = side === 0 ? this.legL : this.legR;
      const bd = side === 0 ? bendL : bendR;
      // An ankle no nearer its hip than LEG_FOLD of the leg: with the hips low, a lifted foot left at the clip's
      // height folded the leg flat, the knee down at the ankle (where its side is undefined). Lowered, not moved.
      const A = side === 0 ? this.footL : this.footR;
      const mh = leg[0]!.matrixWorld.elements;
      // What a hip lets a leg do. A foot no further round from the hips than FOOT_OFF_HIPS (it pivots as the body turns
      // over it), the knee over the foot as far as the thigh turns in its socket, the leg no further out or across than
      // the hip's range: feet were put down and legs swung with nothing asking any of that, and 12% of frames had a knee
      // more than 55 degrees off its foot.
      const FQ = side === 0 ? this.footQL : this.footQR;
      // (the turn off the ankle's hinge: a foot hanging toes down behind a run has no forward to read)
      v1.copy(this.footSide[side]!).applyQuaternion(FQ);
      // (carried on from last frame's, not taken the short way: a foot right behind the hips went from one limit to the
      // other in a frame, a 128-degree pop)
      const wasOff = this.footOff[side]!;
      let off = wasOff + wrapAngle(wrapAngle(Math.atan2(-v1.z, v1.x) - pelvis) - wasOff);
      // (over to the other side when the body has gone round it, no faster than a foot turns: in a frame it is that pop)
      const footLim = this.cutNow > 0 ? Infinity : FOOT_TURN_RATE * this.dt;
      let footTo = off > FOOT_OFF_HIPS ? FOOT_OFF_HIPS : off < -FOOT_OFF_HIPS ? -FOOT_OFF_HIPS : off;
      if (footTo - wasOff > footLim) footTo = wasOff + footLim;
      else if (wasOff - footTo > footLim) footTo = wasOff - footLim;
      if (footTo !== off) {
        qWalk.setFromAxisAngle(AXIS_Y, footTo - off);
        FQ.premultiply(qWalk);
        off = footTo;
      }
      // (what the foot was left at, not what it asked for: kept before the limit it could run a whole turn off the hips,
      // which reads as no turn at all, and the foot stayed 65 degrees round for the rest of the match, 15 feet of 32 in
      // 20 minutes; review round 17, the biomechanist's #1)
      this.footOff[side] = off;
      const kh = pelvis + (off > KNEE_OFF_HIPS ? KNEE_OFF_HIPS : off < -KNEE_OFF_HIPS ? -KNEE_OFF_HIPS : off) + (side === 0 ? KNEE_OUT : -KNEE_OUT);
      // (level: the clip's own bend pointing down the leg left the pole on the leg's line, and the knee of a foot coming
      // down to land swung 100 degrees off the hips)
      bd.x = Math.sin(kh);
      bd.y = 0;
      bd.z = Math.cos(kh);
      {
        const ax = A.x - mh[12]!, ay = A.y - mh[13]!, az = A.z - mh[14]!, out = side === 0 ? -1 : 1;
        const l = (ax * ox + az * oz) * out, d = Math.sqrt(ax * ax + ay * ay + az * az);
        const most = d * HIP_OUT, least = -d * HIP_ACROSS, back = l > most ? most - l : l < least ? least - l : 0;
        if (back !== 0) { A.x += ox * out * back; A.z += oz * out * back; }
      }
      // The pole: the clip's bend direction out from the middle of the hip-to-ankle line as it is now. Out from the
      // clip's own knee it carried where the clip had the foot: a foot put down elsewhere (a step released in front
      // while backpedalling with the hips low) took the pole across the leg and the knee swung round 150-165 degrees
      // over a tenth of a second (14 times in 24 seeds both ways x 120 s; none since).
      this.pole.set((mh[12]! + A.x) * 0.5 + bd.x * 0.8, (mh[13]! + A.y) * 0.5 + bd.y * 0.8, (mh[14]! + A.z) * 0.5 + bd.z * 0.8);
      const fx = A.x - mh[12]!, fy = A.y - mh[13]!, fz = A.z - mh[14]!;
      if (this.airK > 0) {
        const cx = this.stanceC, cz = -this.stanceS, wide = (fx * cx + fz * cz) * AIR_IN * this.airK;
        A.x -= cx * wide;
        A.z -= cz * wide;
        const gx = A.x - mh[12]!, gy = A.y - mh[13]!, gz = A.z - mh[14]!, d = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const far = this.legLen * (1 - (1 - AIR_REACH) * this.airK);
        if (d > far) {
          A.x = mh[12]! + (gx * far) / d;
          A.y = mh[13]! + (gy * far) / d;
          A.z = mh[14]! + (gz * far) / d;
        } else if (this.airLong > 0 && d > 1e-3) {
          // And as long as that at the ball, under the body: the jump clip's crouched legs came up with the lift, knees 42-59 at the hit
          // against 27 and 23 on the footage (review round 33, #11). No ankle under its standing height.
          const to = (d + (far - d) * this.airLong) / d;
          A.x = mh[12]! + gx * to;
          A.y = Math.max(ANKLE_MIN, mh[13]! + gy * to);
          A.z = mh[14]! + gz * to;
        }
      }
      const minD = this.legLen * LEG_FOLD;
      if (fx * fx + fy * fy + fz * fz < minD * minD) {
        const y = mh[13]! - Math.sqrt(Math.max(0, minD * minD - fx * fx - fz * fz));
        if (y < A.y) {
          A.y = y > ANKLE_MIN ? y : ANKLE_MIN;
          // Never through the floor (a foot on its toes went 8 cm under): lowered only until the sole touches it.
          this.soleLow(side, A, side === 0 ? this.footQL : this.footQR);
          const low = this.low1;
          if (low < 0) A.y -= low;
        }
      }
      const u = this.gaitRun > 0 && this.gaitW > 0 ? this.gaitSwing[side]! : -1;
      if (u > 0) {
        const room = this.legLen * RUN_SOFT * smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u)), far = this.legLen - room;
        const gx = A.x - mh[12]!, gy = A.y - mh[13]!, gz = A.z - mh[14]!, d = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (room > 1e-4 && d > far) {
          const k = (far + room * (1 - Math.exp((far - d) / room))) / d;
          A.x = mh[12]! + gx * k;
          A.y = mh[13]! + gy * k;
          A.z = mh[14]! + gz * k;
        }
      }
      twoBoneIK(leg[0]!, leg[1]!, leg[2]!, A, this.pole, side === 0 ? this.kneeL : this.kneeR, side === 0 ? this.kneeSideL : this.kneeSideR);
      setWorldQuat(leg[2]!, FQ);
      leg[2]!.updateMatrixWorld(true);
      // An ankle's range. The shin past it with the foot flat: the heel comes up, rolling over the ball of the foot, and the
      // leg is solved again to where that takes the ankle (3-8% of frames were past 40 degrees, 3 in 4 going backwards).
      // A foot pointed past it comes back up.
      const mk = leg[1]!.matrixWorld.elements, ma = leg[2]!.matrixWorld.elements;
      v2.set(mk[12]! - ma[12]!, mk[13]! - ma[13]!, mk[14]! - ma[14]!).normalize();
      v1.copy(this.footFwd[side]!).applyQuaternion(FQ);
      const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z, up = Math.PI / 2 - Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
      if (up > ANKLE_UP || up < -ANKLE_DOWN) {
        // (about the hinge: a foot hanging toes down has no forward to take an axis from)
        v3.copy(this.footSide[side]!).applyQuaternion(FQ);
        const sl = Math.sqrt(v3.x * v3.x + v3.z * v3.z) || 1, sf = -v3.z / sl, cf = v3.x / sl;
        const p = up > 0 ? up - ANKLE_UP : up + ANKLE_DOWN;
        v3.x = cf; v3.y = 0; v3.z = -sf;
        qWalk.setFromAxisAngle(v3, p);
        FQ.premultiply(qWalk);
        if (p > 0) {
          const b = this.ballLen, h = this.ankleY, sn = Math.sin(p), cs = Math.cos(p), fw = b * (1 - cs) + h * sn;
          A.x += sf * fw;
          A.z += cf * fw;
          A.y += b * sn + h * (cs - 1);
        }
        this.soleLow(side, A, FQ);
        if (this.low1 < 0) A.y -= this.low1;
        twoBoneIK(leg[0]!, leg[1]!, leg[2]!, A, this.pole, side === 0 ? this.kneeL : this.kneeR, side === 0 ? this.kneeSideL : this.kneeSideR);
        setWorldQuat(leg[2]!, FQ);
        leg[2]!.updateMatrixWorld(true);
      }
    }
  }

  /**
   * Each shin twists about its own length no faster than SHIN_TWIST_RATE (the turn back is about the knee-to-ankle
   * line, so the ankle stays put; the foot keeps its world rotation). Where the knee's hinge turn hands over to the
   * plain solve (the target close to the hinge's line, or behind the shin) the shin twisted 50-60° in a frame.
   */
  private limitShins(): void {
    for (let side = 0; side < 2; side++) {
      const leg = side === 0 ? this.legL : this.legR;
      const S = this.shinQ[side]!;
      worldQuat(leg[1]!, q1);
      if (this.dt > 0 && this.shinOk[side] === 1) {
        // The turn since last frame (world), q1 S^-1, and its part about the shin's line.
        q2.copy(S).invert().premultiply(q1);
        const mk = leg[1]!.matrixWorld.elements, ma = leg[2]!.matrixWorld.elements;
        let ax = ma[12]! - mk[12]!, ay = ma[13]! - mk[13]!, az = ma[14]! - mk[14]!;
        const al = Math.sqrt(ax * ax + ay * ay + az * az);
        if (al > 1e-6) {
          ax /= al; ay /= al; az /= al;
          let p = q2.x * ax + q2.y * ay + q2.z * az, w = q2.w;
          if (w < 0) { w = -w; p = -p; }
          const tw = 2 * Math.atan2(p, w), lim = SHIN_TWIST_RATE * this.dt;
          if (tw > lim || tw < -lim) {
            const ex = (tw > 0 ? lim : -lim) - tw, sh = Math.sin(ex / 2);
            QS[0] = ax * sh; QS[1] = ay * sh; QS[2] = az * sh; QS[3] = Math.cos(ex / 2);
            q3.fromArray(QS);
            worldQuat(leg[2]!, qFoot);
            rotateWorld(leg[1]!, q3);
            leg[1]!.updateMatrixWorld(true);
            setWorldQuat(leg[2]!, qFoot);
            leg[2]!.updateMatrixWorld(true);
            worldQuat(leg[1]!, q1);
          }
        }
      }
      S.copy(q1);
      this.shinOk[side] = 1;
    }
  }

  /**
   * Whether an ankle at (x, y, z) is HIP_STEP of the way to the edge of foot f's hip's range (HIP_OUT, HIP_ACROSS), with the hips
   * where they will be this frame (the clip's, moved by hipOut and down by the drop shown).
   */
  private outOfHip(f: number, x: number, y: number, z: number): boolean {
    const ml = this.legL[0]!.matrixWorld.elements, mr = this.legR[0]!.matrixWorld.elements;
    let ox = mr[12]! - ml[12]!, oz = mr[14]! - ml[14]!;
    const ol = Math.sqrt(ox * ox + oz * oz) || 1;
    ox /= ol;
    oz /= ol;
    const mh = f === 0 ? ml : mr, out = f === 0 ? -1 : 1;
    const ax = x - mh[12]! - this.hipOutX, ay = y - mh[13]! + this.dropShown + this.fallOff, az = z - mh[14]! - this.hipOutZ;
    const l = (ax * ox + az * oz) * out, d = Math.sqrt(ax * ax + ay * ay + az * az);
    return l > d * HIP_OUT * HIP_STEP || l < -d * HIP_ACROSS * HIP_STEP;
  }

  /** A planted foot's sole stays where it is on the floor (PIN_*). Planted: not in a step, nor in the gait's swing. */
  private pinFoot(f: number): void {
    const A = f === 0 ? this.footL : this.footR, g = this.gaitW;
    const planted = (g <= 0 || this.gaitSwing[f]! < 0) && (g >= 1 || this.relT[f]! < 0);
    if (!planted) { this.pinOk[f] = 0; return; }
    this.soleLow(f, A, f === 0 ? this.footQL : this.footQR);
    if (this.low1 > PIN_ON) { this.pinOk[f] = 0; return; }
    const P = this.soleP, k = this.pinK[f]!;
    if (this.pinOk[f] === 1 && P[k * 3 + 1]! <= this.low1 + PIN_SWITCH) {
      const dx = this.pinX[f]! - P[k * 3]!, dz = this.pinZ[f]! - P[k * 3 + 2]!;
      if (dx * dx + dz * dz <= PIN_MAX * PIN_MAX) {
        // (into where the foot is held, the lock's and the gait's, not only this frame's target: let go, the foot went back to them in a frame)
        A.x += dx;
        A.z += dz;
        if (g < 1 && this.lockOn[f] === 1) { this.lockPos[f]!.x += dx; this.lockPos[f]!.z += dz; }
        if (g > 0) { this.gaitPlant[f]!.x += dx; this.gaitPlant[f]!.z += dz; }
        return;
      }
    }
    const lk = this.lowK;
    this.pinOk[f] = 1;
    this.pinK[f] = lk;
    this.pinX[f] = P[lk * 3]!;
    this.pinZ[f] = P[lk * 3 + 2]!;
  }

  /** soleLow's result (a field: a double returned from a call that isn't inlined is boxed), which point it is, and where each was. */
  private low1 = 0;
  private lowK = 0;
  private readonly soleP = new Float64Array(24);
  /** PIN_*: whether each foot's sole is held, by which point, and where. */
  private readonly pinOk = new Uint8Array(2);
  private readonly pinK = new Uint8Array(2);
  private readonly pinX = new Float64Array(2);
  private readonly pinZ = new Float64Array(2);
  /** The lowest point of foot f's sole with the ankle at A turned to Q (the toes as they are now), into low1. */
  private soleLow(f: number, A: THREE.Vector3, Q: THREE.Quaternion): void {
    const foot = (f === 0 ? this.legL : this.legR)[2]!;
    vsc.setFromMatrixScale(foot.matrixWorld);
    mf.compose(A, Q, vsc);
    const S = this.soles[f]!;
    let low = Infinity;
    for (let k = 0; k < S.length; k++) {
      const sp = S[k]!;
      const b = this.bones[sp.bone]!;
      if (b === foot) vs.copy(sp.local).applyMatrix4(mf);
      else {
        // A toe bone: its local transform under the foot (one or two bones down).
        mt.compose(b.position, b.quaternion, b.scale);
        if (b.parent !== foot && b.parent) { ml.compose(b.parent.position, b.parent.quaternion, b.parent.scale); mt.premultiply(ml); }
        mt.premultiply(mf);
        vs.copy(sp.local).applyMatrix4(mt);
      }
      this.soleP[k * 3] = vs.x;
      this.soleP[k * 3 + 1] = vs.y;
      this.soleP[k * 3 + 2] = vs.z;
      if (vs.y < low) { low = vs.y; this.lowK = k; }
    }
    this.low1 = low;
  }

  /** The clip's ankle heights and the lowest point of each sole (fkY, lowY), before any IK. */
  private measureSoles(): void {
    for (let f = 0; f < 2; f++) {
      const S = this.soles[f]!;
      let low = Infinity;
      for (let k = 0; k < S.length; k++) {
        const sp = S[k]!;
        vs.copy(sp.local).applyMatrix4(this.bones[sp.bone]!.matrixWorld);
        if (vs.y < low) low = vs.y;
      }
      this.lowY[f] = low;
      this.fkY[f] = f === 0 ? this.footL.y : this.footR.y;
    }
  }

  /**
   * The feet stay where they were put down (see LOCK_ON), rolling and bending no more than the floor lets them. A
   * foot the clip lifts goes back onto the clip's; one held down too long (the body drifted or turned over it, the
   * leg can't reach, or a stroke's lunge wants it out wide) steps there, lifted, one foot at a time while standing.
   * Standing (plantW 1) the steps come sooner (STEP_DIST, STEP_YAW) than running (LOCK_DRIFT, LOCK_YAW). Rewrites
   * the foot targets (footL/R, footQL/R) and the toes.
   */
  private lockFeet(): void {
    const yaw = this.yRoot;
    const s = this.plantW;
    const drift = (LOCK_DRIFT + (STEP_DIST - LOCK_DRIFT) * s) * this.legK;
    const turnMax = LOCK_YAW + (STEP_YAW - LOCK_YAW) * s;
    // Lunge: a stroke's contact wide of the racket shoulder moves where the foot on that side wants to be. Only
    // with the feet planted (running, the gait does the reaching: a swinging foot sent 0.55 m out at a sprint came
    // back in a frame), and shared between the feet as the ball goes round in front or behind (picking one foot by
    // the side the ball is on moved the whole lunge to the other foot in a frame, the knee turning 177 degrees).
    // Held through the stroke's fade as its weight goes (dropped at the fade's first frame, a foot mid-step jumped
    // 0.55 m back), and each foot's offset moves no faster than LUNGE_RATE.
    const LO = this.lungeOff;
    const tc = this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : -1, now = this.lastT;
    const setAt = tc >= 0 && rightFamily(this.fam) !== SMASH && now > tc - SET_BEFORE && now < tc + SET_AFTER;
    let wlx = 0, wlz = 0, wrx = 0, wrz = 0;
    // (a stroke is met at walking pace or less as often as not, and its feet are set then too)
    const sp = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    const set = Math.max(s, 1 - smoothstep(1.2, 3.2, sp));
    if (this.hasCon && (this.st === ST_PREP || this.st === ST_SWING || this.st === ST_FADE) && set > 0.01) {
      const sh = this.armRacket[0]!.matrixWorld.elements;
      const dx = this.conW.x - sh[12]!, dz = this.conW.z - sh[14]!;
      const d = Math.max(1e-6, Math.sqrt(dx * dx + dz * dz));
      // A low ball steps the foot towards it too, so the body goes down into a lunge (front knee bent, the back one
      // low) rather than a squat over feet at standing width (every ball under 0.6 m was met in a full squat).
      const fam = rightFamily(this.fam);
      const oh = fam === SMASH || fam === OVERHEAD || fam === VIBORA;
      const wide = Math.max(0, d - LUNGE_FROM) * 1.3;
      const low = oh ? 0 : (LUNGE_BASE + (LUNGE_LOW - LUNGE_BASE) * smoothstep(0.95 * this.legK, 0.45 * this.legK, this.conW.y)) * this.legK;
      const out = Math.min(LUNGE_MAX * this.legK, wide > low ? wide : low) * set * (this.st === ST_FADE ? this.w : 1);
      if (out > 0.04) {
        // The model's left (+x) in world: which side of the body the ball is on, as a share.
        const lw = smoothstep(-0.35, 0.35, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d);
        const ox = (dx / d) * out, oz = (dz / d) * out;
        // (the other foot comes after it: left where it was, a 0.46 m lunge stood the player in a straight-legged A, feet
        // 1.2 legs apart for the whole of a volley)
        const sl = lw > LUNGE_TRAIL ? lw : LUNGE_TRAIL, sr = 1 - lw > LUNGE_TRAIL ? 1 - lw : LUNGE_TRAIL;
        wlx = ox * sl; wlz = oz * sl;
        wrx = ox * sr; wrz = oz * sr;
      }
      if (oh) {
        const k = set * (this.st === ST_FADE ? this.w : 1), fx = this.stanceS * k, fz = this.stanceC * k;
        const back = (this.handed > 0 ? OH_FOOT_BACK : -OH_FOOT_FRONT) * this.legK, front = (this.handed > 0 ? OH_FOOT_FRONT : -OH_FOOT_BACK) * this.legK;
        wlx += fx * front; wlz += fz * front;
        wrx -= fx * back; wrz -= fz * back;
      }
    }
    const lim = LUNGE_RATE * this.dt;
    for (let f = 0; f < 2; f++) {
      const ex = (f === 0 ? wlx : wrx) - LO[f * 2]!, ez = (f === 0 ? wlz : wrz) - LO[f * 2 + 1]!;
      const el = Math.sqrt(ex * ex + ez * ez), k = el > lim ? lim / el : 1;
      LO[f * 2] = LO[f * 2]! + ex * k;
      LO[f * 2 + 1] = LO[f * 2 + 1]! + ez * k;
    }
    // No further out than the leg reaches from its hip (a lunge past it let the foot's lock go for want of reach,
    // and the step went back to the same place: the foot lifted and set down again and again, the leg straight).
    const R = this.legLen * LUNGE_REACH;
    for (let f = 0; f < 2; f++) {
      const A = f === 0 ? this.footL : this.footR;
      const lx = LO[f * 2]!, lz = LO[f * 2 + 1]!;
      const a = lx * lx + lz * lz;
      let k = 1;
      if (a > 1e-8) {
        // From the hip as it will be, after the drop and the reach.
        const hip = (f === 0 ? this.legL : this.legR)[0]!.matrixWorld.elements;
        const px = A.x - hip[12]! - this.reachX, py = A.y - hip[13]! + this.dropShown + this.fallOff, pz = A.z - hip[14]! - this.reachZ;
        // The largest share of the lunge that keeps the foot within R, or no further than the clip has it when
        // that is further (k = 0 there instead jumped the foot back the whole lunge as the clip's foot crossed R).
        const p2 = px * px + py * py + pz * pz;
        const c = p2 < R * R ? p2 - R * R : 0;
        const b = 2 * (px * lx + pz * lz);
        if (a + b + c > 0) k = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      }
      A.x += lx * k; A.z += lz * k;
    }
    for (let f = 0; f < 2; f++) {
      const A = f === 0 ? this.footL : this.footR;
      const Q = f === 0 ? this.footQL : this.footQR;
      const toe = this.toes[f]!;
      const L = this.lockPos[f]!;
      const low = this.lowY[f]!;
      if (this.lockOn[f] === 1) {
        const ex = A.x - L.x, ez = A.z - L.z;
        const far = ex * ex + ez * ez;
        // Left this far behind (a body spinning into a stroke while this foot waited for the other): it steps at
        // once, as it would forced (it went there in a frame, 0.65 m; a cut between points resets the locks anyway).
        const snap = far > STEP_SNAP * STEP_SNAP * this.legK * this.legK;
        // From the hip as it will be, after the drop (measured from the clip's hip, standing taller, a held lunge was
        // always out of reach: the foot let go and stepped back to the same place, over and over), with or without the
        // reach towards the ball, whichever is nearer: the reach brings a lunging foot's hip over it, and takes it
        // away from the back foot, which stays planted as the body leans (released, it stepped mid-lunge and the
        // knee spun round over the next frames).
        const hip = (f === 0 ? this.legL : this.legR)[0]!.matrixWorld.elements;
        const hx = L.x - hip[12]!, hy = A.y - hip[13]! + this.dropShown + this.fallOff, hz = L.z - hip[14]!;
        const hx2 = hx - this.reachX, hz2 = hz - this.reachZ;
        const d2 = Math.min(hx * hx + hz * hz, hx2 * hx2 + hz2 * hz2) + hy * hy;
        const reach = this.legLen * 0.985;
        const lifted = low > LOCK_OFF;
        const turned = Math.abs(wrapAngle(yaw - this.lockYaw[f]!));
        // (out of reach is no reason to step to where the foot already is: a player standing tall has the leg at 0.986
        // of its length, and tapped on the spot six times a second; review round 9, the critic's #2)
        const forced = (!setAt && (far > drift * drift || turned > turnMax)) || (d2 > reach * reach && far > STEP_MIN * STEP_MIN * this.legK * this.legK) || (this.st === ST_NONE && this.outOfHip(f, L.x, A.y, L.z));
        // Standing, one foot steps at a time (the other waits, still held), unless it is being left far behind.
        const o = 1 - f;
        const waits = !lifted && s > 0.5 && this.relLift[o] === 1 && this.relT[o]! >= 0 && turned < WAIT_TURN_MAX;
        if (lifted || snap || (forced && !waits)) {
          this.lockOn[f] = 0;
          this.relT[f] = 0;
          this.relFrom[f]!.copy(L);
          this.relQ[f]!.copy(this.lockQ[f]!);
          this.relToe[f]!.copy(this.lockToe[f]!);
          this.relLift[f] = lifted ? 0 : 1;
          this.relDur[f] = lifted ? LOCK_RELEASE : STEP_TIME;
          this.relTOk[f] = 0;
        }
      } else if (low < LOCK_ON && this.relT[f]! < 0) {
        this.lockOn[f] = 1;
        L.copy(A);
        this.lockYaw[f] = yaw;
        this.lockQ[f]!.copy(Q);
        this.lockToe[f]!.copy(toe.quaternion);
      }
      if (this.lockOn[f] === 1) {
        A.x = L.x;
        A.z = L.z;
        Q.copy(this.lockQ[f]!);
        toe.quaternion.copy(this.lockToe[f]!);
      } else if (this.relT[f]! >= 0) {
        {
          // A step is as long and as high as the way it has to go: over a fixed 0.15 s, 5 cm up, a foot handed on from the run skated 30-50 cm on its toes (review round 31).
          // Read every frame, the target going on with the body: read on the first, a 0.6-0.8 m step still took 0.14 s, the foot at 9 m/s (review round 26).
          const go = Math.hypot(A.x - this.relFrom[f]!.x, A.z - this.relFrom[f]!.z), up = go * STEP_RISE > STEP_LIFT ? go * STEP_RISE : STEP_LIFT;
          if (this.relT[f] === 0 || up > this.relUp[f]!) this.relUp[f] = up;
          if (this.relLift[f] === 1 && go / (STEP_SPEED * this.legK) > this.relDur[f]!) this.relDur[f] = go / (STEP_SPEED * this.legK);
        }
        if (setAt && now < tc && this.relLift[f] === 1 && this.relT[f]! < 1) {
          const left = (1 - this.relT[f]!) * this.relDur[f]!, want = Math.max(SET_LEFT, tc - SET_LAND - now);
          if (left > want) this.relDur[f] = want / (1 - this.relT[f]!);
        }
        let t = this.relT[f]! + this.dt / this.relDur[f]!;
        if (t >= 1) t = -1;
        this.relT[f] = t;
        if (t >= 0) {
          const e = smoothstep(0, 1, t);
          const F = this.relFrom[f]!;
          A.x = F.x + (A.x - F.x) * e;
          A.z = F.z + (A.z - F.z) * e;
          if (this.relLift[f] === 1) A.y += this.relUp[f]! * Math.sin(Math.PI * t);
          // From the step's start to the target, the target kept on the side of last frame's (the short way only on
          // the first frame) and never re-picked: the target moves with the body, and Quaternion.slerp re-picks the
          // short way once start and target are 180° apart (the foot spun 165° in a frame). Chasing the target from
          // last frame's rotation instead lagged it, leaving more of the turn for the touch-down (feet skated more).
          const QT = this.relQT[f]!, TT = this.relToeT[f]!;
          if (this.relTOk[f] === 0) { QT.copy(this.relQ[f]!); TT.copy(this.relToe[f]!); this.relTOk[f] = 1; }
          sideOf(Q, QT);
          QT.copy(Q);
          sideOf(toe.quaternion, TT);
          TT.copy(toe.quaternion);
          slerpAs(this.relQ[f]!, QT, e, Q);
          slerpAs(this.relToe[f]!, TT, e, toe.quaternion);
        }
      }
    }
  }

  /**
   * The walk (WALK_*) over what the locks made of the feet, which it leaves in the locks' own state: when it stops they
   * carry on from here, the stance foot held and the other finishing its step. A foot goes when the body has gone past
   * it, not on a clock: walkers slow, stop for a partner and turn back, and a stride timed from the phase left a foot
   * planted a leg's length behind.
   */
  private walkFeet(): void {
    const w = this.gaitW;
    if (w <= 0) {
      this.gaitOn = 0;
      return;
    }
    const vx = this.vx, vz = this.vz, sp = Math.sqrt(vx * vx + vz * vz), dt = this.dt;
    const run = this.gaitRun > 0;
    // (a run's feet go by the hips: the lean has them up to 30 cm ahead of the body's middle, out of the back leg's reach)
    const rx = this.root.position.x + (run ? this.hipOutX : 0), rz = this.root.position.z + (run ? this.hipOutZ : 0);
    // (a run's legs are turned onto the way it goes: warp)
    const yaw = run ? this.yRoot + this.warp : this.yRoot, c = Math.cos(yaw), s = Math.sin(yaw);
    if (this.gaitOn === 0) {
      this.gaitOn = 1;
      this.gaitSince = 1;
      this.gaitUp = 0;
      for (let f = 0; f < 2; f++) {
        const A = f === 0 ? this.footL : this.footR;
        this.gaitPlant[f]!.set(A.x, 0, A.z);
        this.gaitSwing[f] = -1;
        this.gaitDown[f] = 1;
        this.gaitYaw[f] = yaw;
      }
    }
    const step = WALK_STEP * this.legLen, hz0 = (0.5 * sp) / step;
    const ux = sp > 1e-3 ? vx / sp : s, uz = sp > 1e-3 ? vz / sp : c, across = ux * c - uz * s, side = across * across;
    // (quicker and shorter going sideways: a long step has the hips past the leading foot, and that leg under the other)
    const backW = run ? smoothstep(0.1, 0.8, -(ux * s + uz * c)) : 0;
    const hz = run ? Math.min(RUN_HZ_MAX, RUN_HZ0 + RUN_HZ_V * sp) * (1 + RUN_SIDE_HZ * side + RUN_BACK_HZ * backW) : hz0 < WALK_HZ0 ? WALK_HZ0 : hz0 > WALK_HZ1 ? WALK_HZ1 : hz0;
    const fast = run ? smoothstep(RUN_V0, RUN_V1, sp) : 0;
    const stance = run ? RUN_DUTY0 + (RUN_DUTY1 - RUN_DUTY0) * fast : WALK_STANCE;
    const stay = (sp * stance) / hz, ahead = stay * (run ? RUN_AHEAD : WALK_AHEAD * 0.5), back = stay - ahead;
    // Each foot on its own side of the body, along it (a shuffle's feet never cross, and a walk's body is along the way).
    const wide = run ? RUN_WIDTH + (RUN_WIDE - RUN_WIDTH) * side : WALK_WIDTH;
    const G = this.gaitSwing, P = this.gaitPlant;
    this.gaitSince += dt;
    this.gaitUp += dt;
    this.gaitHz = hz;
    const off = run ? this.hipW * wide : 0;
    // How far ahead of its place each foot is, along the way it is going.
    const d0x = P[0]!.x - rx - c * off, d0z = P[0]!.z - rz + s * off, d1x = P[1]!.x - rx + c * off, d1z = P[1]!.z - rz - s * off;
    const rel0 = d0x * ux + d0z * uz, rel1 = d1x * ux + d1z * uz;
    const far0 = d0x * d0x + d0z * d0z, far1 = d1x * d1x + d1z * d1z;
    const reach = this.legLen * (run ? RUN_REACH : WALK_REACH), r2 = reach * reach;
    // Left behind by a turn back: it goes whatever the other foot is doing.
    let hard = G[0]! < 0 && far0 > r2 ? 0 : G[1]! < 0 && far1 > r2 ? 1 : -1;
    // (a run's feet go by turns even so: two in the middle of a swing together is a hop, feet side by side)
    if (hard >= 0 && run && G[1 - hard]! >= 0 && (G[1 - hard]! < RUN_TURNS || (this.st === ST_NONE && this.gaitUp < RUN_EARLY / hz && (hard === 0 ? far0 : far1) < r2 * RUN_STRANDED))) hard = -1;
    if (run) {
      // Further than the leg reaches with the hips a little down: it goes as the other comes down, half a stride behind it.
      const fast = smoothstep(RUN_V0, RUN_V1, sp), low = (this.legLen + this.ankleY) * (RUN_HIP0 + (RUN_HIP1 - RUN_HIP0) * fast) - RUN_STEP_SINK * this.legK - this.ankleY;
      const stretch = this.legLen * RUN_STRETCH, reachIt = stretch * stretch - low * low, stride = back * RUN_BEHIND;
      // (and past where a stride's own foot gets to: at a run's pace that is further than a straight leg, the heel coming up for it, and
      // judged on reach alone every foot left early, landed beside the other and the run galloped)
      const most = reachIt > stride * stride ? reachIt : stride * stride;
      for (let f = 0; f < 2; f++) {
        if (G[f]! >= 0 || (G[1 - f]! >= 0 && G[1 - f]! < RUN_LANDS)) continue;
        const gx = P[f]!.x - rx, gz = P[f]!.z - rz;
        if (gx * gx + gz * gz > most) { hard = f; break; }
      }
    }
    // (and a walk's planted foot the hip can't keep the leg over: HIP_STEP)
    if (hard < 0 && !run) for (let f = 0; f < 2; f++) if (G[f]! < 0 && this.outOfHip(f, P[f]!.x, this.ankleY, P[f]!.z)) { hard = f; break; }
    let go = hard;
    if (go < 0 && run) {
      // By turns, half a stride apart, sooner if the foot has fallen behind: a foot goes while the other is in the air,
      // and that is what a run's flight is.
      const f = this.gaitNext;
      // (and only once it has pushed: a run's first strides took off 20 ms after they landed)
      if (G[f]! < 0 && this.gaitUp >= RUN_EARLY / hz && this.gaitDown[f]! >= (RUN_DOWN * stance) / hz) {
        const rel = f === 0 ? rel0 : rel1, far = f === 0 ? far0 : far1;
        if ((rel < -back * RUN_BEHIND && G[1 - f]! < 0) || (this.gaitUp >= 0.5 / hz && far > RUN_STILL * RUN_STILL * this.legK * this.legK)) go = f;
      }
    } else if (go < 0 && G[0]! < 0 && G[1]! < 0 && this.gaitSince >= 0.1 / hz) {
      // The one further behind, or the one further away when the walk has changed direction under them.
      const f = far0 > far1 + 0.05 ? 0 : far1 > far0 + 0.05 ? 1 : rel0 < rel1 ? 0 : 1, rel = f === 0 ? rel0 : rel1;
      const turned = wrapAngle(yaw - this.gaitYaw[f]!);
      if (rel < -back || this.gaitSince > 0.35 / hz || turned > 0.9 || turned < -0.9) go = f;
    }
    if (go >= 0 && !this.gaitStop) {
      G[go] = 0;
      this.gaitNext = 1 - go;
      this.gaitUp = 0;
      this.gaitFrom[go]!.copy(P[go]!);
      this.gaitYawFrom[go] = this.gaitYaw[go]!;
      this.gaitPitch[go] = this.gaitPitchNow[go]!;
    }
    // The phase for the hips and the arms: on at the stride's rate, pulled towards where the last landing puts it.
    const last = this.gaitLast === 0 ? 0 : 0.5, at = this.gaitSince * hz;
    const was = wrapAngle(2 * Math.PI * (last + (at < 0.49 ? at : 0.49) - this.gaitPhase)) / (2 * Math.PI);
    this.gaitPhase = (this.gaitPhase + (hz + 4 * was) * dt + 1) % 1;
    const swingT = (1 - stance) / hz, h = this.ankleY, b = this.ballLen, hl = b * 0.45;
    for (let f = 0; f < 2; f++) {
      const sign = f === 0 ? 1 : -1;
      const A = f === 0 ? this.footL : this.footR, Q = f === 0 ? this.footQL : this.footQR, toe = this.toes[f]!;
      const Pf = P[f]!, To = this.gaitTo[f]!, YT = this.gaitYawTo;
      let u = G[f]!;
      if (u >= 0) {
        u += dt / swingT;
        if (u >= 1) {
          u = -1;
          Pf.copy(To);
          this.gaitYaw[f] = YT[f]!;
          this.gaitDown[f] = 0;
          this.gaitSince = 0;
          this.gaitLast = f;
        }
        G[f] = u;
      }
      let pitch: number, x: number, z: number, y = h, fy: number, bend = 1;
      if (u < 0) {
        const tl = this.gaitDown[f] = this.gaitDown[f]! + dt;
        if (run) {
          // A foot down while the hips turn onto a run pivots on its ball towards the way it goes (RUN_PIVOT_*).
          const d = wrapAngle(yaw + sign * WALK_TOE - this.gaitYaw[f]!), ad = d < 0 ? -d : d;
          if (ad > RUN_PIVOT_FROM) {
            const y0 = this.gaitYaw[f]!, top = RUN_PIVOT_RATE * dt, y1 = y0 + (d > 0 ? 1 : -1) * (ad - RUN_PIVOT_FROM < top ? ad - RUN_PIVOT_FROM : top);
            Pf.x += b * (Math.sin(y0) - Math.sin(y1));
            Pf.z += b * (Math.cos(y0) - Math.cos(y1));
            this.gaitYaw[f] = y1;
          }
        }
        // (from where it is now: on the frame it lands, rel0 and rel1 still have it where it took off, and the roll stepped)
        const dx = Pf.x - rx - sign * c * off, dz = Pf.z - rz + sign * s * off, rel = dx * ux + dz * uz, sg = stay > 1e-3 ? (ahead - rel) / stay : 0;
        pitch = run ? RUN_ROLL * smoothstep(0.45, 1, sg) * (1 - backW) + RUN_BACK_ROLL * backW * (1 - smoothstep(0, 0.6, sg)) : WALK_ROLL * smoothstep(0.5, 1, sg) - WALK_HEEL * (1 - smoothstep(0, 0.1 / hz, tl));
        x = Pf.x;
        z = Pf.z;
        fy = this.gaitYaw[f]!;
      } else {
        // Where the body will be when it lands, the step ahead of that, on its own side of the line.
        const left = (1 - u) * swingT;
        const wd = sign * this.hipW * wide;
        const lean = run ? this.tiltX * ux + this.tiltZ * uz : 0, out = ahead - lean * (lean > 0 ? RUN_LEAN_STEP * 0.45 : RUN_LEAN_STEP);
        // (put down where it was going once it comes down, from RUN_SET or WALK_DOWN of the swing: going on with the body, a run's foot
        // went the last centimetre to the floor at 1.7 m/s, 6% of p8's frames on it)
        if (u < (run ? RUN_SET : WALK_DOWN)) {
          To.x = rx + vx * left + ux * out + c * wd;
          To.y = 0;
          To.z = rz + vz * left + uz * out - s * wd;
          // Going sideways the trailing foot closes up to the hips, and no further: a side step, not one leg through the
          // other (over SIDE_RUN_ON the legs have turned onto the way, and it never comes to this).
          const lat = sign * across * ahead + this.hipW * wide, least = this.hipW * wide * RUN_CLOSE;
          if (lat < least) {
            To.x += sign * c * (least - lat);
            To.z -= sign * s * (least - lat);
          }
        }
        YT[f] = yaw + sign * WALK_TOE;
        // (a run's foot goes up before it goes along, and comes down onto its place: it skated the floor both ways)
        const e = run ? smoothstep(RUN_ALONG, RUN_SET, u) : smoothstep(0, 1, u), F = this.gaitFrom[f]!;
        x = F.x + (To.x - F.x) * e;
        z = F.z + (To.z - F.z) * e;
        if (run) {
          // (round under the hips, on its own side, not along the straight line: a foot left out to the side swung past them)
          const k = RUN_UNDER * Math.sin(Math.PI * e), wx = sign * c * off, wz = -sign * s * off;
          x += (rx + wx - x) * k;
          z += (rz + wz - z) * k;
        }
        // (from where it is, not from where it took off: half way round, the short way flips)
        // (a run's, by RUN_YAW_BY of the swing: the leg turns back under the hips once the foot is off the floor; turned over the
        // whole swing, a foot that took off still pointing the way it was put down before the body turned held the knee 40-85
        // degrees in, and the thigh swung across the body in the first strides; review round 33, #10)
        const YN = this.gaitYawFrom, by = run ? (RUN_YAW_BY - u) * swingT : left, T = by < left ? by : left;
        YN[f] = YN[f]! + (wrapAngle(YT[f]! - YN[f]!) * dt) / (T > dt ? T : dt);
        fy = YN[f]!;
        pitch = this.gaitPitch[f]! * (1 - smoothstep(0, 0.45, u));
        if (run) {
          // The heel comes up behind and the knee through: highest early in the swing.
          const up = u < RUN_PEAK ? smoothstep(0, RUN_PEAK, u) : 1 - smoothstep(RUN_PEAK, 1, u);
          pitch += RUN_KICK * fast * (u < RUN_PEAK ? up : 1 - smoothstep(RUN_PEAK, RUN_LEVEL, u)) * (1 - backW) + RUN_BACK_ROLL * backW * smoothstep(0.5, 1, u);
          // (held up late and put down: lowered all the way it skimmed the floor for the last third, and read as a slide)
          y += (RUN_CLEAR + RUN_CLEAR_V * sp) * (u < RUN_PEAK ? smoothstep(0, RUN_LIFT, u) : 1 - smoothstep(RUN_FALL, 1, u));
          // (and it is the heel that goes high, behind the hips: down again before it passes under them, or a knee bent 100
          // degrees over the foot is a thigh 50 degrees up, then 65 as it reached forward)
          y += RUN_HEEL * this.legLen * fast * (1 - backW) * (u < RUN_PEAK ? up : 1 - smoothstep(RUN_PEAK, RUN_THROUGH, u));
        } else {
          pitch -= WALK_HEEL * smoothstep(0.45, 1, u);
          y += WALK_CLEAR * Math.sin(Math.PI * u);
        }
        bend = 1 - smoothstep(0, 0.35, u);
        // (going back it lands on the ball, the toes turned up for it already: straight until it landed, they lifted the ankle
        // 3.6 cm off the floor and dropped it in a frame, the knee 11 degrees)
        if (run) {
          const toes = Math.min(1, 3 * backW) * smoothstep(0.5, 1, u);
          if (toes > bend) bend = toes;
        }
      }
      // (no faster than an ankle turns: a foot landing short of its place began the roll in a frame)
      if (run && this.gaitOn === 2) {
        const was = this.gaitPitchNow[f]!, lim = RUN_ROLL_RATE * dt;
        pitch = pitch > was + lim ? was + lim : pitch < was - lim ? was - lim : pitch;
      }
      this.gaitPitchNow[f] = pitch;
      // Rolling over the ball of the foot (heel up) or the heel (toes up): where that takes the ankle.
      const up = pitch < 0 ? -pitch : pitch, sn = Math.sin(up), cs = Math.cos(up);
      const fw = pitch >= 0 ? b * (1 - cs) + h * sn : hl * (cs - 1) - h * sn;
      y += (pitch >= 0 ? b : hl) * sn + h * (cs - 1);
      const sf = Math.sin(fy), cf = Math.cos(fy);
      A.x += (x + sf * fw - A.x) * w;
      A.y += (y - A.y) * w;
      A.z += (z + cf * fw - A.z) * w;
      qWalk.setFromAxisAngle(AXIS_Y, fy);
      qWalk2.setFromAxisAngle(AXIS_X, pitch);
      qWalk3.multiplyQuaternions(qWalk, qWalk2).multiply(this.footRestQ[f]!);
      sideOf(Q, qWalk3);
      Q.slerp(qWalk3, w);
      // The toes flat on the floor as the heel comes up, straight again through the swing.
      qWalk.multiply(this.toeRestQ[f]!);
      qWalk2.copy(Q).invert().multiply(qWalk);
      qWalk3.copy(this.toeRestLocal[f]!).slerp(qWalk2, bend);
      toe.quaternion.slerp(qWalk3, w);
      // The sole on the floor, not over it, coming down onto it through the end of the swing.
      this.soleLow(f, A, Q);
      A.y -= this.low1 * w * (u < 0 ? 1 : smoothstep(0.55, 1, u));
      if (w < 1) continue;
      // (the heel still up: it steps when the walk stops, not left held on its toes)
      if (u < 0 && pitch < 0.12) {
        this.lockOn[f] = 1;
        this.lockPos[f]!.copy(A);
        this.lockYaw[f] = yaw;
        this.lockQ[f]!.copy(Q);
        this.lockToe[f]!.copy(toe.quaternion);
        this.relT[f] = -1;
      } else {
        this.lockOn[f] = 0;
        this.relT[f] = 0;
        this.relFrom[f]!.copy(A);
        this.relQ[f]!.copy(Q);
        this.relToe[f]!.copy(toe.quaternion);
        this.relLift[f] = 1;
        this.relDur[f] = STEP_TIME;
        this.relTOk[f] = 0;
      }
    }
    this.gaitOn = 2;
  }

  /**
   * The elbow out of the trunk, going round the shoulder-to-hand line. Every guard here looks at the hand or a forearm from a third of the way down it, and nothing at the elbow:
   * with the hips low the elbow is at the waist, and a volley's went 10-14 cm into the flank on a third of its frames, the forearm's guards reading it clear. In proportion to the
   * depth, so it comes in as the elbow gets there.
   */
  private elbowOut(arm: THREE.Bone[], T: THREE.Vector3, P: THREE.Vector3): void {
    const e = arm[0]!.matrixWorld.elements, A = arm[1]!.position, H = arm[2]!.position;
    const sx = e[12]!, sy = e[13]!, sz = e[14]!;
    let lx = T.x - sx, ly = T.y - sy, lz = T.z - sz;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (ll < 1e-6) return;
    lx /= ll; ly /= ll; lz /= ll;
    const a2 = A.x * A.x + A.y * A.y + A.z * A.z, b2 = H.x * H.x + H.y * H.y + H.z * H.z, full = Math.sqrt(a2) + Math.sqrt(b2);
    const c = ll < full ? ll : full, d = (a2 - b2 + c * c) / (2 * c), h2 = a2 - d * d;
    if (h2 < 1e-4) return;
    let px = P.x - sx, py = P.y - sy, pz = P.z - sz;
    const pd = px * lx + py * ly + pz * lz;
    px -= lx * pd; py -= ly * pd; pz -= lz * pd;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-6) return;
    const k = Math.sqrt(h2) / pl, ex = sx + lx * d + px * k, ey = sy + ly * d + py * k, ez = sz + lz * d + pz * k;
    const G = this.guardBones, Rr = this.guardR, B = this.bones;
    let ox = 0, oy = 0, oz = 0;
    for (let i = 0; i < TRUNK_CAPS; i++) {
      const ea = B[G[2 * i]!]!.matrixWorld.elements, eb = B[G[2 * i + 1]!]!.matrixWorld.elements;
      const ax = ea[12]!, ay = ea[13]!, az = ea[14]!, tx = eb[12]! - ax, ty = eb[13]! - ay, tz = eb[14]! - az;
      const t2 = tx * tx + ty * ty + tz * tz;
      let u = t2 > 1e-12 ? ((ex - ax) * tx + (ey - ay) * ty + (ez - az) * tz) / t2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = ex - ax - tx * u, dy = ey - ay - ty * u, dz = ez - az - tz * u, dd = Math.sqrt(dx * dx + dy * dy + dz * dz), pen = Rr[i]! + ELBOW_ROOM - dd;
      if (pen > 0 && dd > 1e-6) { ox += (dx / dd) * pen; oy += (dy / dd) * pen; oz += (dz / dd) * pen; }
    }
    if (ox === 0 && oy === 0 && oz === 0) return;
    P.x = ex + ox; P.y = ey + oy; P.z = ez + oz;
  }

  /**
   * A measured swing's elbow kept out of the trunk. One camera has a joint's depth least well of all, and the elbow's
   * worst: of the six clips' own swings, four have the elbow's centre 3-6 cm in front of the spine through part of the
   * follow-through or the swing (inside the ribs: the game's player drew it there in 4-13% of a clip stroke's frames, a
   * keyed stroke's in 0-3%; 11 Nov 2026, the owner: "going into the body"). The hand is where the swing has it, so the
   * elbow is somewhere on its circle about the shoulder-to-hand line: it is turned round that line, the shorter way, to
   * the first place its centre is outside the trunk (an ellipse about the hips-to-neck line: TRACK_TRUNK_W to the side,
   * TRACK_TRUNK_D to the front and the back), quickly in and slowly out. elbowOut before it is a nudge by how deep the
   * elbow is in a capsule, which a capsule narrower than the trunk is wide lets through at the flank.
   */
  private elbowClear(arm: THREE.Bone[], T: THREE.Vector3, P: THREE.Vector3): void {
    const e = arm[0]!.matrixWorld.elements, A = arm[1]!.position, Hd = arm[2]!.position;
    const sx = e[12]!, sy = e[13]!, sz = e[14]!;
    let lx = T.x - sx, ly = T.y - sy, lz = T.z - sz;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const a2 = A.x * A.x + A.y * A.y + A.z * A.z, b2 = Hd.x * Hd.x + Hd.y * Hd.y + Hd.z * Hd.z, full = Math.sqrt(a2) + Math.sqrt(b2);
    const c = ll < full ? ll : full, d = ll > 1e-6 ? (a2 - b2 + c * c) / (2 * c) : 0, h2 = a2 - d * d;
    let px = P.x - sx, py = P.y - sy, pz = P.z - sz;
    let pl = 0;
    if (ll > 1e-6) {
      lx /= ll; ly /= ll; lz /= ll;
      const pd = px * lx + py * ly + pz * lz;
      px -= lx * pd; py -= ly * pd; pz -= lz * pd;
      pl = Math.sqrt(px * px + py * py + pz * pz);
    }
    const ease = (to: number): void => {
      const k = this.dt > 0 ? 1 - Math.exp(-this.dt / (Math.abs(to) > Math.abs(this.swivel) ? TRACK_SWIVEL_IN : TRACK_SWIVEL_OUT)) : 1;
      this.swivel += (to - this.swivel) * k;
    };
    if (ll < 1e-6 || h2 < 1e-4 || pl < 1e-6) { ease(0); return; }
    px /= pl; py /= pl; pz /= pl;
    // (the circle's other axis: the line crossed with the pole's side)
    const qx = ly * pz - lz * py, qy = lz * px - lx * pz, qz = lx * py - ly * px;
    const h = Math.sqrt(h2), cx = sx + lx * d, cy = sy + ly * d, cz = sz + lz * d;
    // The trunk: the hips-to-neck line, the shoulders' line across it, and the way out of the chest.
    const Hh = this.hips.matrixWorld.elements, N = this.neck.matrixWorld.elements, Sl = this.armL[0]!.matrixWorld.elements, Sr = this.armR[0]!.matrixWorld.elements;
    const hx = Hh[12]!, hy = Hh[13]!, hz = Hh[14]!;
    const ax = N[12]! - hx, ay = N[13]! - hy, az = N[14]! - hz, al2 = ax * ax + ay * ay + az * az;
    if (al2 < 1e-6) { ease(0); return; }
    let ox = Sl[12]! - Sr[12]!, oy = Sl[13]! - Sr[13]!, oz = Sl[14]! - Sr[14]!;
    const od = (ox * ax + oy * ay + oz * az) / al2;
    ox -= ax * od; oy -= ay * od; oz -= az * od;
    const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (ol < 1e-6) { ease(0); return; }
    ox /= ol; oy /= ol; oz /= ol;
    const al = Math.sqrt(al2);
    const fx = (oy * az - oz * ay) / al, fy = (oz * ax - ox * az) / al, fz = (ox * ay - oy * ax) / al;
    // How far inside the trunk's ellipse the elbow is, turned by `t` (under 1: inside).
    const at = (t: number): number => {
      const ct = Math.cos(t) * h, st = Math.sin(t) * h;
      const x = cx + px * ct + qx * st - hx, y = cy + py * ct + qy * st - hy, z = cz + pz * ct + qz * st - hz;
      const u = (x * ax + y * ay + z * az) / al2;
      if (u < TRACK_TRUNK_LO || u > TRACK_TRUNK_HI) return 2;
      const w = (x * ox + y * oy + z * oz) / TRACK_TRUNK_W, f = (x * fx + y * fy + z * fz) / TRACK_TRUNK_D;
      return w * w + f * f;
    };
    let need = 0;
    if (at(0) < 1) {
      // The first clear place either way; the way it already goes is kept unless the other is much the shorter.
      let up = 0, dn = 0;
      for (let t = TRACK_SWIVEL_STEP; t <= TRACK_SWIVEL_MAX; t += TRACK_SWIVEL_STEP) { if (at(t) >= 1) { up = t; break; } }
      for (let t = TRACK_SWIVEL_STEP; t <= TRACK_SWIVEL_MAX; t += TRACK_SWIVEL_STEP) { if (at(-t) >= 1) { dn = t; break; } }
      if (up === 0 && dn === 0) need = this.swivel;
      else if (dn === 0) need = up;
      else if (up === 0) need = -dn;
      else if (this.swivel > 0.02) need = dn + TRACK_SWIVEL_KEEP < up ? -dn : up;
      else if (this.swivel < -0.02) need = up + TRACK_SWIVEL_KEEP < dn ? up : -dn;
      else need = up <= dn ? up : -dn;
    }
    ease(need);
    const t = this.swivel;
    if (Math.abs(t) < 1e-4) return;
    const ct = Math.cos(t) * pl, st = Math.sin(t) * pl;
    P.x = cx + px * ct + qx * st; P.y = cy + py * ct + qy * st; P.z = cz + pz * ct + qz * st;
  }

  /**
   * A hand target no nearer its shoulder than ARM_MIN of the arm's length. A key blend can pass the hand through the
   * shoulder (a left-hander's slice put the free hand 2 cm from it, a backhand's recovery the racket hand), and
   * there the line from the shoulder to the hand turns over in a frame, the whole arm with it. So the way from the
   * shoulder to the hand (`dir`, kept per arm) turns no faster than REACH_TURN_RATE (a hand 0.6 m out at 24 m/s;
   * swings stay under it, so away from the shoulder it is exact), and the hand is put along it, at least ARM_MIN out.
   * Pushing straight out alone flips across the shoulder: no smooth rule pushes every point out of a ball.
   */
  private keepOff(upper: THREE.Bone, target: THREE.Vector3, dir: THREE.Vector3): void {
    const e = upper.matrixWorld.elements;
    const dx = target.x - e[12]!, dy = target.y - e[13]!, dz = target.z - e[14]!;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) {
      if (dir.x === 0 && dir.y === 0 && dir.z === 0) return;
    } else {
      const rx = dx / d, ry = dy / d, rz = dz / d;
      const c = dir.x * rx + dir.y * ry + dir.z * rz;
      const turn = this.dt > 0 ? REACH_TURN_RATE * this.dt : Math.PI;
      const fresh = dir.x === 0 && dir.y === 0 && dir.z === 0;
      if (fresh || c >= Math.cos(turn)) {
        dir.x = rx; dir.y = ry; dir.z = rz;
      } else {
        // Turn dir towards r by `turn`, in their plane.
        let px = rx - c * dir.x, py = ry - c * dir.y, pz = rz - c * dir.z;
        let pl = Math.sqrt(px * px + py * py + pz * pz);
        if (pl < 1e-6) {
          // Straight behind: any way round.
          px = -dir.z; py = 0; pz = dir.x;
          pl = Math.sqrt(px * px + pz * pz);
          if (pl < 1e-6) { px = 1; py = 0; pz = 0; pl = 1; }
        }
        const cs = Math.cos(turn), sn = Math.sin(turn);
        const nx = dir.x * cs + (px / pl) * sn, ny = dir.y * cs + (py / pl) * sn, nz = dir.z * cs + (pz / pl) * sn;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        dir.x = nx / nl; dir.y = ny / nl; dir.z = nz / nl;
      }
    }
    const r = Math.max(d, ARM_MIN * this.armLen);
    target.x = e[12]! + dir.x * r;
    target.y = e[13]! + dir.y * r;
    target.z = e[14]! + dir.z * r;
  }

  /**
   * How far the racket elbow and the forearm's first two thirds are inside the trunk, as solved: adds the way out at the deepest, ELBOW_OUT_GAIN times its depth,
   * to `to` (at most CLEAR_MAX).
   */
  private elbowDepth(fa: THREE.Bone, hand: THREE.Bone, to: THREE.Vector3): void {
    const G = this.guardBones, Rr = this.guardR, B = this.bones, me = fa.matrixWorld.elements, mw = hand.matrixWorld.elements;
    let best = 0, nx = 0, ny = 0, nz = 0;
    for (let r = 0; r < 3; r++) {
      const along = r * 0.35, room = r === 0 ? ELBOW_ROOM : FOREARM_ROOM;
      const px = me[12]! + (mw[12]! - me[12]!) * along, py = me[13]! + (mw[13]! - me[13]!) * along, pz = me[14]! + (mw[14]! - me[14]!) * along;
      for (let k = 0; k < TRUNK_CAPS; k++) {
        const ea = B[G[2 * k]!]!.matrixWorld.elements, eb = B[G[2 * k + 1]!]!.matrixWorld.elements;
        const ax = ea[12]!, ay = ea[13]!, az = ea[14]!, sx = eb[12]! - ax, sy = eb[13]! - ay, sz = eb[14]! - az;
        const l2 = sx * sx + sy * sy + sz * sz;
        let u = l2 > 1e-12 ? ((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / l2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = px - ax - sx * u, dy = py - ay - sy * u, dz = pz - az - sz * u, d = Math.sqrt(dx * dx + dy * dy + dz * dz), pen = Rr[k]! + room - d;
        if (pen > best && d > 1e-6) { best = pen; nx = dx / d; ny = dy / d; nz = dz / d; }
      }
    }
    if (best <= 0) return;
    const g = ELBOW_OUT_GAIN * best;
    to.x += nx * g; to.y += ny * g; to.z += nz * g;
    const l = to.length();
    if (l > CLEAR_MAX) to.multiplyScalar(CLEAR_MAX / l);
  }

  /** The free forearm out of the torso, as racketClear does the racket's. */
  private freeClear(ul: THREE.Bone, fl: THREE.Bone, hl: THREE.Bone): void {
    const G = this.guardBones, Rr = this.guardR, B = this.bones, me = fl.matrixWorld.elements, mw = hl.matrixWorld.elements;
    let best = 0, sx2 = 0, sy2 = 0, sz2 = 0;
    for (let r = 0; r < FOREARM_T.length; r++) {
      const along = FOREARM_T[r]!;
      const px = me[12]! + (mw[12]! - me[12]!) * along, py = me[13]! + (mw[13]! - me[13]!) * along, pz = me[14]! + (mw[14]! - me[14]!) * along;
      for (let k = 0; k < Rr.length; k++) {
        const ea = B[G[2 * k]!]!.matrixWorld.elements, eb = B[G[2 * k + 1]!]!.matrixWorld.elements;
        const ax = ea[12]!, ay = ea[13]!, az = ea[14]!;
        const sx = eb[12]! - ax, sy = eb[13]! - ay, sz = eb[14]! - az;
        const l2 = sx * sx + sy * sy + sz * sz;
        let u = l2 > 1e-12 ? ((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / l2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = px - ax - sx * u, dy = py - ay - sy * u, dz = pz - az - sz * u;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const pen = (Rr[k]! + FOREARM_ROOM - d) / along;
        if (pen <= 0 || d < 1e-6) continue;
        if (pen > best) best = pen;
        sx2 += (dx / d) * pen; sy2 += (dy / d) * pen; sz2 += (dz / d) * pen;
      }
    }
    const sl = Math.sqrt(sx2 * sx2 + sy2 * sy2 + sz2 * sz2);
    if (best <= 0 || sl < 1e-9) return;
    const push = best > CLEAR_MAX ? CLEAR_MAX : best;
    v1.set(mw[12]! + (sx2 / sl) * push, mw[13]! + (sy2 / sl) * push, mw[14]! + (sz2 / sl) * push);
    const E = this.elbowFree;
    E.dir.copy(this.dirF0); E.side.copy(this.sideF0); E.bend[0] = this.bendF0;
    this.keepOff(ul, v1, E.dir);
    hingeIK(ul, fl, hl, v1, this.pole, E);
  }

  /**
   * Keep the racket out of the torso and the head: a key placed for a standing body, a backhand volley at the body
   * or a follow-through with the trunk bent over a low ball put the frame through the chest and the face (2-3% of
   * frames). The deepest racket point inside a capsule (plus RACKET_CLEAR) moves the hand straight out by that much
   * from where it is, the racket keeping its rotation, and the arm is solved again. The hand's world rotation is q3.
   */
  private racketClear(ua: THREE.Bone, fa: THREE.Bone, hand: THREE.Bone): void {
    const G = this.guardBones, Rr = this.guardR, B = this.bones;
    const m = this.racket.matrixWorld.elements, me = fa.matrixWorld.elements, mw = hand.matrixWorld.elements;
    // The racket moves with the hand, so the push is found on the racket moved by it (vx, vy, vz), then the arm is
    // solved once (each solve may turn the elbow's side by its frame's allowance).
    let vx = 0, vy = 0, vz = 0;
    for (let it = 0; it < 3; it++) {
      // Every point inside, each pushing straight out by its depth: the deepest's depth along the sum's direction
      // (the deepest alone jumped between points and capsules, the forearm with it).
      let best = 0, sx2 = 0, sy2 = 0, sz2 = 0;
      // (the forearm too, each point going with the hand by its share of the way from the elbow)
      // (not in the forward swing, a fast arm's push came and went in a frame: serves popped 30 times a minute for 5)
      const nR = RACKET_P.length / 3, nF = this.st === ST_SWING && this.lastT < this.tCon + (this.fam.wrist || this.fam.volley ? 0 : FOREARM_AFTER) ? 0 : FOREARM_T.length;
      for (let r = 0; r < nR + nF; r++) {
        let px: number, py: number, pz: number, along = 1, room = RACKET_CLEAR;
        if (r < nR) {
          const lx = RACKET_P[r * 3]!, ly = RACKET_P[r * 3 + 1]!, lz = RACKET_P[r * 3 + 2]!;
          px = m[0]! * lx + m[4]! * ly + m[8]! * lz + m[12]! + vx;
          py = m[1]! * lx + m[5]! * ly + m[9]! * lz + m[13]! + vy;
          pz = m[2]! * lx + m[6]! * ly + m[10]! * lz + m[14]! + vz;
        } else {
          along = FOREARM_T[r - nR]!;
          room = FOREARM_ROOM;
          px = me[12]! + (mw[12]! - me[12]! + vx) * along;
          py = me[13]! + (mw[13]! - me[13]! + vy) * along;
          pz = me[14]! + (mw[14]! - me[14]! + vz) * along;
        }
        for (let k = 0; k < Rr.length; k++) {
          const ea = B[G[2 * k]!]!.matrixWorld.elements, eb = B[G[2 * k + 1]!]!.matrixWorld.elements;
          const ax = ea[12]!, ay = ea[13]!, az = ea[14]!;
          const sx = eb[12]! - ax, sy = eb[13]! - ay, sz = eb[14]! - az;
          const l2 = sx * sx + sy * sy + sz * sz;
          let u = l2 > 1e-12 ? ((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / l2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = px - ax - sx * u, dy = py - ay - sy * u, dz = pz - az - sz * u;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const pen = (Rr[k]! + room - d) / along;
          if (pen <= 0 || d < 1e-6) continue;
          if (pen > best) best = pen;
          sx2 += (dx / d) * pen; sy2 += (dy / d) * pen; sz2 += (dz / d) * pen;
        }
      }
      const sl = Math.sqrt(sx2 * sx2 + sy2 * sy2 + sz2 * sz2);
      if (best <= 0 || sl < 1e-9) break;
      vx += (sx2 / sl) * best; vy += (sy2 / sl) * best; vz += (sz2 / sl) * best;
    }
    // No more than the arm's weight allows (see clearW).
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz), cap = CLEAR_MAX * this.clearW;
    if (vl > cap) { const r = cap / vl; vx *= r; vy *= r; vz *= r; }
    if (vl < 1e-9 || cap <= 0) return;
    // From where the hand is, not where it was asked to be: a hand short of an out-of-reach target pushed further
    // out stays where it is (the arm is straight), and moved from where it is it slides round the shoulder.
    const mh = hand.matrixWorld.elements;
    this.tgt.x = mh[12]! + vx; this.tgt.y = mh[13]! + vy; this.tgt.z = mh[14]! + vz;
    this.elbowRacket.dir.copy(this.dir0);
    this.elbowRacket.side.copy(this.side0);
    this.elbowRacket.bend[0] = this.bend0;
    this.keepOff(ua, this.tgt, this.elbowRacket.dir);
    IK_TURN[0] = this.racketSideLimit();
    hingeIK(ua, fa, hand, this.tgt, this.pole, this.elbowRacket);
    IK_TURN[0] = this.dt > 0 ? ELBOW_SIDE_RATE * this.dt : Math.PI;
    setWorldQuat(hand, q3);
    hand.updateMatrixWorld(true);
  }

  /**
   * A wrist goes about 85 degrees off the forearm's line and stops. With the hand low and the racket stood up over it the
   * shaft points back at the shoulder, and no elbow makes that good (the wrist 14-30 degrees from folded flat as a
   * backswing began): the racket tips out on the hand instead, softly, by `k` (nothing at the ball: the head is on it).
   */
  private wristLimit(fa: THREE.Bone, hand: THREE.Bone, k: number): void {
    const D = this.wristWant, W = this.wristQ;
    D.x = 0; D.y = 0; D.z = 0; D.w = 1;
    const me = fa.matrixWorld.elements, mh = hand.matrixWorld.elements;
    let fx = mh[12]! - me[12]!, fy = mh[13]! - me[13]!, fz = mh[14]! - me[14]!;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    q2.multiplyQuaternions(q3, this.grip.q);
    const S = this.hand0.copy(this.grip.off).applyQuaternion(q2);
    const sl = Math.sqrt(S.x * S.x + S.y * S.y + S.z * S.z);
    if (k > 0 && fl > 1e-6 && sl > 1e-6) {
      fx /= fl; fy /= fl; fz /= fl;
      const sx = S.x / sl, sy = S.y / sl, sz = S.z / sl;
      const cs = fx * sx + fy * sy + fz * sz, dev = Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs), from = WRIST_MAX - WRIST_EDGE;
      // Axis s x f, turning the shaft towards the forearm's line.
      const ax = sy * fz - sz * fy, ay = sz * fx - sx * fz, az = sx * fy - sy * fx, al = Math.sqrt(ax * ax + ay * ay + az * az);
      if (dev > from && al > 1e-6) {
        v3.x = ax / al; v3.y = ay / al; v3.z = az / al;
        D.setFromAxisAngle(v3, (dev - from - WRIST_EDGE * (1 - Math.exp((from - dev) / WRIST_EDGE))) * k);
      }
      // And on through the follow-through by the hand itself: nothing asked what the keys there did to a wrist, and it went half as far again as
      // one goes, the racket's head flopping over at the end of the bandeja, the slice and the lob (review round 28).
      const after = (this.st === ST_SWING && this.lastT > this.tCon) || this.st === ST_FADE ? k * this.w : 0;
      if (after > 0) {
        const F = v1.copy(this.handF).applyQuaternion(q3), K = v2.copy(this.handK).applyQuaternion(q3);
        const nx = (K.y * F.z - K.z * F.y) * this.handed, ny = (K.z * F.x - K.x * F.z) * this.handed, nz = (K.x * F.y - K.y * F.x) * this.handed;
        const c = fx * F.x + fy * F.y + fz * F.z, bend = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
        const up = -(fx * K.x + fy * K.y + fz * K.z), bk = -(fx * nx + fy * ny + fz * nz), r = Math.sqrt(up * up + bk * bk);
        if (r > 1e-6) {
          const fl = bk / r, ra = up / r, a = fl / (fl > 0 ? HAND_FLEX : HAND_EXT), e = ra / (ra > 0 ? HAND_RADIAL : HAND_ULNAR), past = bend * Math.sqrt(a * a + e * e);
          if (past > HAND_SOFT) {
            const to = HAND_SOFT + HAND_EDGE * (1 - Math.exp((HAND_SOFT - past) / HAND_EDGE));
            v3.set(F.y * fz - F.z * fy, F.z * fx - F.x * fz, F.x * fy - F.y * fx).normalize();
            this.wristAfter.setFromAxisAngle(v3, bend * (1 - to / past) * after);
            D.premultiply(this.wristAfter);
          }
        }
      }
    }
    // Followed at a wrist's speed: with the shaft dead against the forearm the axis has no way to go, and taken as it
    // is the racket turned over in a frame (166-178 degrees).
    const d = Math.min(1, Math.abs(W.x * D.x + W.y * D.y + W.z * D.z + W.w * D.w));
    const ang = 2 * Math.acos(d), lim = WRIST_RATE * this.dt;
    if (this.dt > 0 && ang > lim) W.slerp(D, lim / ang);
    else W.copy(D);
    if (W.w < 0.99999985) q3.premultiply(W);
  }

  /**
   * The racket's point and turn (v1, q1) towards another's (v2, q2) by BL.u: the hand goes straight and the racket turns
   * on it. Blending the racket's point instead dragged the hand round it as the racket turned (20 cm off at the middle
   * of a 150-degree turn), and the wrist folded to 30-50 degrees at the start of every backswing.
   */
  private blendRacket(out: THREE.Quaternion): void {
    const off = this.grip.off, h = this.hand0;
    h.copy(off).applyQuaternion(q1); v1.sub(h);
    h.copy(off).applyQuaternion(q2); v2.sub(h);
    lerpV(v1, v2);
    nlerpQ(q1, q2, out);
    h.copy(off).applyQuaternion(q1); v1.add(h);
  }

  /**
   * The overhead's way to the ball (see OverArm): the key (v2, q2, the contact) from the chest's curves, the whole curve
   * sliding onto the ball over the last of the swing, from OVER_TO_BALL. Blending from the curve to the ball instead put
   * the hand at the curve's end with nothing left of its speed: the racket head lost half of it in the last 30 ms and
   * was at its fastest before the ball, not at it. Let go late, there's less time to go round (lagK).
   */
  private overKey(o: OverArm, ua: THREE.Bone): void {
    const s = this.keyS, g0 = (s - OVER_TO_BALL) / (1 - OVER_TO_BALL), a = this.lagK * this.overIn, left = (1 - (g0 > 0 ? g0 * g0 : 0)) * a;
    if (left <= 0) {
      this.overPrev.set(0, 0, 0, 0);
      return;
    }
    this.overU = left;
    // The racket's turn onto the contact's starts far sooner: 100-140 degrees of it in that last stretch was most of the
    // head's speed.
    const g1 = (s - OVER_TURN_FROM) / (1 - OVER_TURN_FROM), turn = (1 - (g1 > 0 ? g1 * g1 : 0)) * a;
    this.chestAxes(this.armFree[0]!, ua);
    const O = this.chestOut, U = this.chestUp, F = this.chestFwd, m = ua.matrixWorld.elements, k = this.armLen / OVER_ARM, n = o.knots.length - 1;
    curve(o.knots, o.hand, 3, s);
    const ho = (CURVE[0]! - o.hand[n * 3]!) * k, hu = (CURVE[1]! - o.hand[n * 3 + 1]!) * k, hf = (CURVE[2]! - o.hand[n * 3 + 2]!) * k;
    const eo = o.hand[n * 3]! * k, eu = o.hand[n * 3 + 1]! * k, ef = o.hand[n * 3 + 2]! * k;
    // (what is left of the curve from here to its end, and where its end is)
    const lx = -O.x * ho + U.x * hu + F.x * hf, ly = -O.y * ho + U.y * hu + F.y * hf, lz = -O.z * ho + U.z * hu + F.z * hf;
    const hx = m[12]! - O.x * eo + U.x * eu + F.x * ef, hy = m[13]! - O.y * eo + U.y * eu + F.y * ef, hz = m[14]! - O.z * eo + U.z * eu + F.z * ef;
    curve(o.knots, o.elbow, 3, s);
    const E = this.overE;
    E.x = CURVE[0]! * k; E.y = CURVE[1]! * k; E.z = CURVE[2]! * k;
    curve(o.knots, o.back, 1, s);
    // The shaft laid back from up the trunk about the shoulder line, its face out along that line.
    this.laidBack(CURVE[0]!, o.roll ?? Math.PI, this.overQ);
    this.laidBack(o.back[n]!, o.roll ?? Math.PI, this.overEnd);
    const off = this.grip.off, h = this.hand0, W = this.overTurn;
    h.copy(off).applyQuaternion(q2);
    const kx = v2.x - h.x, ky = v2.y - h.y, kz = v2.z - h.z;
    W.copy(this.overEnd).conjugate().premultiply(this.overQ);
    if (a < 1) W.slerp(QUAT_ID, 1 - a);
    // (the way round holds from frame to frame: the two can sit half a turn apart, and taken the short way each time the racket went round
    // the other side the frame the gap passed half a turn, 25 degrees at once, on nearly every left-hander's serve)
    BL.u = turn;
    nlerpQ(q2, this.overEnd, this.overPrev);
    q2.premultiply(W);
    h.copy(off).applyQuaternion(q2);
    v2.x = kx + (hx - kx) * left + lx * a + h.x;
    v2.y = ky + (hy - ky) * left + ly * a + h.y;
    v2.z = kz + (hz - kz) * left + lz * a + h.z;
    if (this.dt > 0 && this.st === ST_SWING) this.swingV = v2.distanceTo(this.overHead) / this.dt;
    this.overHead.copy(v2);
  }

  /**
   * The racket laid back by `back` from up the trunk, about the shoulder line (chestAxes), `roll` round its long axis from
   * its palm's side out along that line to the racket side (half a turn has that side to the free arm, and pronation turns it to the ball).
   */
  private laidBack(back: number, roll: number, out: THREE.Quaternion): void {
    const O = this.chestOut, U = this.chestUp, F = this.chestFwd, cp = Math.cos(back), sp = Math.sin(back);
    const ax = U.x * cp - F.x * sp, ay = U.y * cp - F.y * sp, az = U.z * cp - F.z * sp;
    // (the side away from the racket side, turned by what's left of a half turn about the shaft)
    const c = Math.cos(roll), s = Math.sin(roll), n0x = -O.x, n0y = -O.y, n0z = -O.z;
    const nx = n0x * c + (ay * n0z - az * n0y) * s, ny = n0y * c + (az * n0x - ax * n0z) * s, nz = n0z * c + (ax * n0y - ay * n0x) * s;
    basisQuat(ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx, ax, ay, az, nx, ny, nz, out);
  }

  /**
   * A hand target out of the trunk: an ellipse round the spine from the hips to the neck, wider than deep, in the
   * chest's frame (chestAxes). Whatever put it there, keys or a turn under them, a hand doesn't go through a body.
   */
  /**
   * The ready position turned with the chest, about the middle of the shoulders: it is placed for the turn its key asks
   * for (chestTurn), and a chest turned off that (a recovery, a side-on run) came through hands left where they were, the
   * forearms folded against the neck. Leaves that turn in chestQ for the racket's own.
   */
  private onChest(T: THREE.Vector3, ua: THREE.Bone, share = 1): void {
    const turn = this.rideTurn * share;
    this.chestQ.setFromAxisAngle(AXIS_Y, turn);
    const a = this.armFree[0]!.matrixWorld.elements, b = ua.matrixWorld.elements, mx = (a[12]! + b[12]!) * 0.5, mz = (a[14]! + b[14]!) * 0.5;
    const c = Math.cos(turn), s = Math.sin(turn), dx = T.x - mx, dz = T.z - mz;
    T.x = mx + dx * c + dz * s;
    T.z = mz - dx * s + dz * c;
  }

  /** How far the ready position has followed the chest round: eased, as a stride's turn of the chest stays out of the hands. */
  private followChest(ua: THREE.Bone): void {
    this.chestAxes(this.armFree[0]!, ua);
    const F = this.chestFwd, off = wrapAngle(Math.atan2(F.x, F.z) - Math.atan2(this.stanceS, this.stanceC) - this.chestTurn);
    // (a server's address has its own pose, the chest turning into it as it blends)
    const want = (off > READY_TURN_MAX ? READY_TURN_MAX : off < -READY_TURN_MAX ? -READY_TURN_MAX : off) * (1 - this.addrW);
    this.rideTurn += (want - this.rideTurn) * (this.dt > 0 ? 1 - Math.exp(-this.dt / READY_TURN_EASE) : 1);
  }

  private outOfTrunk(T: THREE.Vector3): void {
    const H = this.hips.matrixWorld.elements, N = this.neck.matrixWorld.elements;
    const ax = N[12]! - H[12]!, ay = N[13]! - H[13]!, az = N[14]! - H[14]!, ll = ax * ax + ay * ay + az * az;
    const dx = T.x - H[12]!, dy = T.y - H[13]!, dz = T.z - H[14]!, u = (dx * ax + dy * ay + dz * az) / ll;
    if (u < TRUNK_BELOW || u > 1) return;
    const px = dx - ax * u, py = dy - ay * u, pz = dz - az * u;
    const O = this.chestOut, F = this.chestFwd, rw = this.trunkW, rd = this.trunkD;
    const x = px * O.x + py * O.y + pz * O.z, z = px * F.x + py * F.y + pz * F.z, e2 = (x * x) / (rw * rw) + (z * z) / (rd * rd);
    if (e2 >= 1) return;
    // Round the front, whichever half of the trunk the key has reached: pushed straight out a hand crossing the body went round the back,
    // 26-41 cm behind the chest on a stroke in a hundred, the elbow through the breastbone.
    // (coming in with the depth: all at once at the back rim, a hand jumped through the body in a frame)
    const e = Math.sqrt(e2), k = e > 1e-3 ? 1 / e - 1 : 0, mx = x * k, mz = e > 1e-3 ? (z < 0 ? z * k - 2 * z * (1 + k) * smoothstep(0, TRUNK_ROUND, k) : z * k) : rd;
    T.x += O.x * mx + F.x * mz;
    T.y += O.y * mx + F.y * mz;
    T.z += O.z * mx + F.z * mz;
  }

  /** After the ball, the hand going to its place in the chest's frame (OverArm.under), the racket as the key has it. */
  private overAfter(o: number[], ua: THREE.Bone): void {
    const u = this.st === ST_FADE ? 1 : smoothstep(OVER_AFTER0, OVER_AFTER1, this.lastT - this.tCon);
    if (u <= 0) return;
    this.overU = u;
    this.chestAxes(this.armFree[0]!, ua);
    const O = this.chestOut, U = this.chestUp, F = this.chestFwd, m = ua.matrixWorld.elements, k = this.armLen / OVER_ARM;
    const ho = o[0]! * k, hu = o[1]! * k, hf = o[2]! * k;
    const E = this.overE;
    E.x = o[3]! * k; E.y = o[4]! * k; E.z = o[5]! * k;
    const h = this.hand0;
    h.copy(this.grip.off).applyQuaternion(q2);
    v2.x += (m[12]! - O.x * ho + U.x * hu + F.x * hf + h.x - v2.x) * u;
    v2.y += (m[13]! - O.y * ho + U.y * hu + F.y * hf + h.y - v2.y) * u;
    v2.z += (m[14]! - O.z * ho + U.z * hu + F.z * hf + h.z - v2.z) * u;
  }

  /**
   * The hand goes on through the ball with the speed it brought (THROUGH_*). The curve into the ball and the path away from it meet there with nothing to say they run
   * on: the hand lost half its speed in a tick at the serve's hit, 6.9 to 3.2 m/s, and the racket flicked over on a nearly still hand (review round 29).
   */
  private serveThrough(): void {
    const T = this.lastT - this.tCon;
    if ((this.st === ST_SWING || this.st === ST_FADE) && T >= 0) {
      if (this.throughFor !== this.tCon) {
        this.throughFor = this.tCon;
        this.throughV.subVectors(this.handWas, this.handWas2);
        if (this.handDt > 0) this.throughV.multiplyScalar(THROUGH_CARRY / this.handDt);
        else this.throughV.set(0, 0, 0);
      }
      v2.addScaledVector(this.throughV, THROUGH_TIME * (1 - Math.exp(-T / THROUGH_TIME)) * (1 - smoothstep(THROUGH_FROM, THROUGH_TO, T)));
    }
    this.handWas2.copy(this.handWas);
    this.handWas.copy(v2);
    this.handDt = this.dt;
  }

  /** The trunk's axes from the shoulders: out towards `arm`, up the spine, forward out of the chest (world). */
  private chestAxes(arm: THREE.Bone, other: THREE.Bone): void {
    const a = arm.matrixWorld.elements, o = other.matrixWorld.elements, H = this.hips.matrixWorld.elements;
    const O = this.chestOut, U = this.chestUp, F = this.chestFwd;
    let ox = a[12]! - o[12]!, oy = a[13]! - o[13]!, oz = a[14]! - o[14]!;
    let nl = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (nl < 1e-6) return;
    ox /= nl; oy /= nl; oz /= nl;
    let ux = (a[12]! + o[12]!) / 2 - H[12]!, uy = (a[13]! + o[13]!) / 2 - H[13]!, uz = (a[14]! + o[14]!) / 2 - H[14]!;
    const ud = ux * ox + uy * oy + uz * oz;
    ux -= ox * ud; uy -= oy * ud; uz -= oz * ud;
    nl = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (nl < 1e-6) return;
    ux /= nl; uy /= nl; uz /= nl;
    const sgn = this.handed > 0 ? 1 : -1;
    O.x = ox; O.y = oy; O.z = oz;
    U.x = ux; U.y = uy; U.z = uz;
    F.x = (oy * uz - oz * uy) * sgn; F.y = (oz * ux - ox * uz) * sgn; F.z = (ox * uy - oy * ux) * sgn;
  }

  /**
   * A raised arm doesn't go behind the chest's plane: a shoulder runs out about 40 degrees behind it level, a little
   * less above that, and only hanging does the arm swing back past it. A point on the arm is turned forward round
   * the spine to stay inside, softly. `way` is 1 on the free side, -1 on the racket side.
   * (The keys are in the stance's frame, and the chest turns under them: a free hand placed for a body that had already
   * come round was 55-60 degrees behind it at 125 degrees of elevation.)
   */
  private shoulderLimit(arm: THREE.Bone, target: THREE.Vector3, way: number, behind: number): void {
    const a = arm.matrixWorld.elements, U = this.chestUp, F = this.chestFwd;
    const Ox = this.chestOut.x * way, Oy = this.chestOut.y * way, Oz = this.chestOut.z * way;
    const sx = a[12]!, sy = a[13]!, sz = a[14]!;
    const dx = target.x - sx, dy = target.y - sy, dz = target.z - sz;
    const co = dx * Ox + dy * Oy + dz * Oz, cu = dx * U.x + dy * U.y + dz * U.z, cf = dx * F.x + dy * F.y + dz * F.z;
    const r = Math.sqrt(co * co + cf * cf);
    if (r < 1e-4) return;
    const elev = Math.atan2(r, -cu), lim = -behind - ARM_BEHIND_LOW * (1 - smoothstep(ARM_LOW0, ARM_LOW1, elev));
    const hz = Math.atan2(cf, co);
    if (hz >= lim + ARM_EDGE) return;
    const h = lim + ARM_EDGE * Math.exp((hz - lim - ARM_EDGE) / ARM_EDGE);
    const c2 = r * Math.cos(h), f2 = r * Math.sin(h);
    target.x = sx + Ox * c2 + U.x * cu + F.x * f2;
    target.y = sy + Oy * c2 + U.y * cu + F.y * f2;
    target.z = sz + Oz * c2 + U.z * cu + F.z * f2;
  }

  /**
   * The elbow is on the far side of the hand from the racket: a wrist goes only so far, so the forearm carries on the
   * shaft's line. The pole alone chose the side whatever the racket was doing, and the wrist folded to 42-57 degrees
   * in the volleys, the serve and the racket's drop (a person has about 95). With the head hanging behind the back
   * this also puts the elbow up, which is where it is in a real overhead. A racket along the arm says nothing about
   * the side, and the key's pole carries on.
   */
  private elbowBehindRacket(ua: THREE.Bone, q: THREE.Quaternion): void {
    const e = ua.matrixWorld.elements, P = this.pole, T = this.tgt;
    const sx = e[12]!, sy = e[13]!, sz = e[14]!;
    let lx = T.x - sx, ly = T.y - sy, lz = T.z - sz;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (ll < 1e-6) return;
    lx /= ll; ly /= ll; lz /= ll;
    // Back along the shaft, off the shoulder-to-hand line.
    const bx = -2 * (q.x * q.y - q.w * q.z), by = 2 * (q.x * q.x + q.z * q.z) - 1, bz = -2 * (q.y * q.z + q.w * q.x);
    const bd = bx * lx + by * ly + bz * lz;
    // The key's pole off the line, a unit long.
    let px = P.x - sx, py = P.y - sy, pz = P.z - sz;
    const pd = px * lx + py * ly + pz * lz;
    px -= lx * pd; py -= ly * pd; pz -= lz * pd;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl > 1e-6) { px /= pl; py /= pl; pz /= pl; }
    px = lx * 0.3 + px + (bx - lx * bd) * ELBOW_SHAFT;
    py = ly * 0.3 + py + (by - ly * bd) * ELBOW_SHAFT;
    pz = lz * 0.3 + pz + (bz - lz * bd) * ELBOW_SHAFT;
    // Where that puts the elbow, and the shoulder's limit on it: the upper arm stays about on the line of the shoulders
    // and the forearm goes back, with the hand behind the chest (the rule above had the elbow as far behind as the hand).
    const E = this.armRacket[1]!.position, H = this.armRacket[2]!.position;
    const a2 = E.x * E.x + E.y * E.y + E.z * E.z, b2 = H.x * H.x + H.y * H.y + H.z * H.z, a = Math.sqrt(a2), full = a + Math.sqrt(b2);
    const c = ll < full ? ll : full, d = (a2 - b2 + c * c) / (2 * c), h2 = a2 - d * d;
    const pd2 = px * lx + py * ly + pz * lz;
    px -= lx * pd2; py -= ly * pd2; pz -= lz * pd2;
    const pl2 = Math.sqrt(px * px + py * py + pz * pz);
    if (pl2 < 1e-6) return;
    const k = (h2 > 0 ? Math.sqrt(h2) : 0) / pl2;
    P.x = sx + lx * d + px * k; P.y = sy + ly * d + py * k; P.z = sz + lz * d + pz * k;
    this.shoulderLimit(ua, P, -1, ELBOW_BEHIND);
  }

  /** Racket arm to the key (blended with the animation by the stroke weight), free hand to its key. */
  private solveArms(): void {
    const w = this.w;
    const ua = this.armRacket[0]!, fa = this.armRacket[1]!, hand = this.armRacket[2]!;
    // The clip's arms, to fade the solve out into as the arms let go (ARM_FADE).
    const AQ = this.armClipQ;
    AQ[0]!.copy(ua.quaternion); AQ[1]!.copy(fa.quaternion); AQ[2]!.copy(hand.quaternion);
    AQ[3]!.copy(this.armFree[0]!.quaternion); AQ[4]!.copy(this.armFree[1]!.quaternion); AQ[5]!.copy(this.armFree[2]!.quaternion);
    const ready = this.readyKey;
    {
      const m = ua.matrixWorld.elements;
      this.shLegs.set(m[12]! - this.racketSh.x, m[13]! - this.racketSh.y, m[14]! - this.racketSh.z);
    }
    // Where the animation has the racket, pulled to the ready position, then to the stroke's key (world).
    this.racket.updateMatrixWorld();
    v1.setFromMatrixPosition(this.racket.matrixWorld);
    worldQuat(this.racket, q1);
    alignQ(q1, this.prevFkQ);
    this.followChest(ua);
    if (this.ready > 0) {
      this.toWorld(ready.p, v2);
      // The key is placed for a body over its feet: the weight takes the hips and the chest forward of them, and they
      // came through the racket it left behind (3% of frames). First, because the chest's turn is about the shoulders,
      // and a key still at the feet's place swung up to 60 cm round them: the hand went behind the back when a run stopped.
      const reach = this.legLen * LEAN_HIP * (1 - LEAN_STROKE * w);
      v2.x += this.hipTiltX * reach + this.tiltX * LEAN_HAND;
      v2.z += this.hipTiltZ * reach + this.tiltZ * LEAN_HAND;
      this.onChest(v2, ua);
      // The walk's or the run's arm swing, smaller with the racket in it.
      const pump = WALK_ARM * this.gaitH + (this.gaitRun > 0 ? RUN_ARM * this.gaitW * smoothstep(RUN_V0, RUN_V1, this.sp) : 0);
      const sw = this.handed * pump * 0.4 * Math.cos(2 * Math.PI * this.gaitPhase);
      v2.x += this.stanceS * sw;
      v2.z += this.stanceC * sw;
      this.quatToWorld(ready.q, q2);
      q2.premultiply(this.chestQ);
      alignQ(q2, this.prevReadyQ);
      // (the serve's address, a tap and a carried racket are arms of their own, which it lets go to)
      const held = (1 - this.addrW) * (1 - this.carryW) * (1 - this.tapW);
      if (held > 0) {
        q3.multiplyQuaternions(q2, this.grip.qInv);
        v3.copy(this.grip.pos).applyQuaternion(q3);
        const mh = ua.matrixWorld.elements, hx = v2.x - v3.x - mh[12]!, hy = v2.y - v3.y - mh[13]!, hz = v2.z - v3.z - mh[14]!;
        const hd = Math.sqrt(hx * hx + hy * hy + hz * hz), hl = this.armLen * (READY_REACH + (1.1 - READY_REACH) * (1 - held));
        if (hd > hl) {
          const r = 1 - hl / hd;
          v2.x -= hx * r; v2.y -= hy * r; v2.z -= hz * r;
        }
      }
      // (the hold is the key itself: at 0.97 the clip's racket stayed in the blend, nlerpQ's way never came back to the
      // short one, and the racket hung 10 degrees off the key and snapped back, a pop a rally)
      BL.u = this.ready >= READY_HOLD ? 1 : this.ready / READY_HOLD;
      this.blendRacket(this.outReady);
    }
    this.toWorld(this.kp, v2);
    if (this.finishU > 0) {
      // The follow-through's keys are placed for a standing body: when the hips are still low after a low ball (they
      // rise no faster than HIP_RISE) the finish went into the chest and the head. It goes with the shoulder.
      const mr = ua.matrixWorld.elements, u = this.finishU;
      v2.x += (mr[12]! - this.racketSh.x) * u; v2.y += (mr[13]! - this.racketSh.y) * u; v2.z += (mr[14]! - this.racketSh.z) * u;
    }
    this.quatToWorld(this.kq, q2);
    // (the way back to ready is on the chest too: the wrist went 20-29 cm behind the chest's front, inside the trunk)
    if (this.recoverW > 0.001) {
      this.onChest(v2, ua, this.recoverW);
      q2.premultiply(this.chestQ);
    }
    this.overU = 0;
    const over = this.fam.over;
    if (over && (this.st === ST_PREP || (this.st === ST_SWING && this.lastT < this.tCon))) this.overKey(over, ua);
    else if (over?.under && (this.st === ST_SWING || this.st === ST_FADE)) this.overAfter(over.under, ua);
    if (over?.under) this.serveThrough();
    alignQ(q2, this.prevKeyQ);
    BL.u = w;
    this.blendRacket(this.outKey);
    // The racket turns no faster than RACKET_TURN_RATE (the racket centre still goes where the key puts it; the hand
    // follows from the rotation): a reflex volley released 46 ms before the contact, the stroke 18% in, blended the
    // hand from the ready grip to the volley's in three frames, 117° in one.
    const RQ = this.racketQ;
    if (this.dt > 0 && this.racketQOk) {
      const d = Math.min(1, Math.abs(q1.x * RQ.x + q1.y * RQ.y + q1.z * RQ.z + q1.w * RQ.w));
      const ang = 2 * Math.acos(d), lim = RACKET_TURN_RATE * this.dt;
      if (ang > lim) { q2.copy(RQ).slerp(q1, lim / ang); q1.copy(q2); }
    }
    RQ.copy(q1);
    this.racketQOk = true;
    // Hand = racket rotation without the grip; wrist = racket centre minus the grip offset.
    q3.multiplyQuaternions(q1, this.grip.qInv);
    this.tgt.copy(this.grip.pos).applyQuaternion(q3);
    this.tgt.subVectors(v1, this.tgt);
    // Out of the arm's reach: bend the upper body towards it (up to SPINE_REACH), pivoting at the spine's base.
    const mu = ua.matrixWorld.elements;
    const sx = mu[12]! - this.tgt.x, sy = mu[13]! - this.tgt.y, sz = mu[14]! - this.tgt.z;
    // (a volley bends over the ball before it straightens the arm: elbow 63 on video, 30 at every ball under 0.85 m)
    const excess = Math.sqrt(sx * sx + sy * sy + sz * sz) - this.armLen * (0.98 - (0.98 - (this.fam.wrist || this.fam.volley ? VOLLEY_BEND : this.fam.bend ?? 0.98)) * w * w);
    const base = this.spine[0]!;
    this.leanT.identity();
    if (excess > 0) {
      const mb = base.matrixWorld.elements;
      const ax = mu[12]! - mb[12]!, ay = mu[13]! - mb[13]!, az = mu[14]! - mb[14]!;
      const bx = this.tgt.x - mb[12]!, by = this.tgt.y - mb[13]!, bz = this.tgt.z - mb[14]!;
      const al = Math.sqrt(ax * ax + ay * ay + az * az), bl = Math.sqrt(bx * bx + by * by + bz * bz);
      const cs = (ax * bx + ay * by + az * bz) / Math.max(al * bl, 1e-9);
      const ang = Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs);
      // Only to reach the ball: a finish out of the arm's reach bent the trunk 38-53 degrees after it, a body folded in half.
      const done = this.st === ST_FADE || (this.st === ST_SWING && this.lastT >= this.tCon);
      const phi = done ? 0 : Math.min(ang, excess / Math.max(al, 0.1), SPINE_REACH) * smoothstep(SPINE_REACH_BACK1, SPINE_REACH_BACK0, ang) * this.nearW;
      // Axis a x b.
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (phi > 1e-3 && cl > 1e-6) {
        v3.x = cx / cl; v3.y = cy / cl; v3.z = cz / cl;
        this.leanT.setFromAxisAngle(v3, phi);
      }
    }
    // Followed no faster than SPINE_REACH_RATE (a cut starts at the new one).
    const LN = this.lean, LT = this.leanT;
    if (this.leanOk && this.dt > 0) {
      const d = Math.min(1, Math.abs(LN.x * LT.x + LN.y * LT.y + LN.z * LT.z + LN.w * LT.w));
      const ang = 2 * Math.acos(d), lim = (this.fam.wrist || this.fam.volley ? VOLLEY_BEND_RATE : SPINE_REACH_RATE) * this.dt;
      if (ang > lim) LN.slerp(LT, lim / ang);
      else LN.copy(LT);
    } else LN.copy(LT);
    this.leanOk = true;
    if (LN.w < 0.99999985) {
      rotateWorld(base, LN);
      base.updateMatrixWorld(true);
    }
    this.tipRacket(ua, w);
    v3.copy(ready.pole);
    BL.u = w;
    lerpV(v3, this.kpole);
    this.toWorld(v3, this.pole);
    this.chestAxes(this.armFree[0]!, ua);
    this.elbowBehindRacket(ua, q1);
    if (this.overU > 0) {
      const O = this.chestOut, U = this.chestUp, F = this.chestFwd, E = this.overE, m = ua.matrixWorld.elements;
      v3.x = m[12]! - O.x * E.x + U.x * E.y + F.x * E.z;
      v3.y = m[13]! - O.y * E.x + U.y * E.y + F.y * E.z;
      v3.z = m[14]! - O.z * E.x + U.z * E.y + F.z * E.z;
      BL.u = this.overU;
      lerpV(this.pole, v3);
    }
    // As the stroke and the ready position let go, the elbow goes back to where the clip bends it.
    const ik = Math.max(this.ready, w);
    if (ik < 1) {
      bendDir(ua, fa, hand, DOWN, bendA);
      v2.setFromMatrixPosition(fa.matrixWorld).addScaledVector(bendA, 0.5);
      BL.u = 1 - ik;
      lerpV(this.pole, v2);
    }
    // Last frame's arm way and elbow side: a second solve this frame (racketClear) limits its turn from these, not
    // from the first solve's, or the rate limits would be doubled on those frames.
    this.dir0.copy(this.elbowRacket.dir);
    this.side0.copy(this.elbowRacket.side);
    this.bend0 = this.elbowRacket.bend[0]!;
    // On the way back to ready the arm stays bent: the hand's way from the finish to the ready key passes further from
    // the shoulder turning under it than the arm is long, and the elbow went 132, 41, 97 in a fifth of a second.
    this.recoverW += ((this.st === ST_FADE ? 1 : 0) - this.recoverW) * (this.dt > 0 ? 1 - Math.exp(-this.dt / RECOVER_EASE) : 1);
    // So does a carried racket: a contrapared's and a lob's back keys were still out of reach at half their weight.
    this.heldBent += ((this.st === ST_PREP ? clamp01((1 - this.holdW) / (1 - HOLD_CARRY)) : 0) - this.heldBent) * (this.dt > 0 ? 1 - Math.exp(-this.dt / RECOVER_EASE) : 0);
    const bent = Math.max(this.recoverW, this.heldBent);
    // After the ball too, and on into the recovery, which takes it from there (Family.after).
    const af = this.fam.after, afterOn = af !== undefined && ((this.st === ST_SWING && this.lastT >= this.tCon) || this.st === ST_FADE);
    this.afterW += ((afterOn ? 1 : 0) - this.afterW) * (this.dt > 0 ? 1 - Math.exp(-this.dt / AFTER_EASE) : 1);
    if (bent > 0.001 || this.afterW > 0.001) {
      const e = ua.matrixWorld.elements;
      const dx = this.tgt.x - e[12]!, dy = this.tgt.y - e[13]!, dz = this.tgt.z - e[14]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const l0 = 1.05 - (1.05 - RECOVER_ARM) * bent, l1 = 1.05 - (1.05 - (af ?? 1.05)) * this.afterW;
      const lim = this.armLen * (l0 < l1 ? l0 : l1);
      if (d > lim) {
        const r = lim / d;
        this.tgt.set(e[12]! + dx * r, e[13]! + dy * r, e[14]! + dz * r);
      }
    }
    this.keepOff(ua, this.tgt, this.elbowRacket.dir);
    // Last frame's push out of the body, dying away (see racketClear).
    // Gone by the contact (the racket has to be on the ball then), let go over the last fifth of the forward swing.
    // The let-go caps the push in proportion to the swing left (multiplying the carried push down every frame
    // instead compounded: a 20 cm push went in two frames and the elbow straightened 99 degrees in one; QA army).
    const before = (this.st === ST_PREP && this.hasCon) || (this.st === ST_SWING && this.lastT < this.tCon);
    const sLeft = before ? Math.max(0, 1 - this.keyS) / 0.2 : 1;
    const co = this.clearOff, k = this.dt > 0 ? Math.exp(-this.dt / CLEAR_EASE) : 0;
    co.x *= k; co.y *= k; co.z *= k;
    // The push fades with the arm's weight, gone as the arms switch off (at ready 0.01 a 19 cm push was still held,
    // and the hand went back to the clip 143° in a frame).
    this.clearW = smoothstep(0.01, 0.15, Math.max(this.ready, w)) * Math.min(1, sLeft);
    const cl0 = Math.sqrt(co.x * co.x + co.y * co.y + co.z * co.z), cap0 = CLEAR_MAX * this.clearW;
    if (cl0 > cap0) { const r = cl0 > 1e-9 ? cap0 / cl0 : 0; co.x *= r; co.y *= r; co.z *= r; }
    const t0x = this.tgt.x, t0y = this.tgt.y, t0z = this.tgt.z;
    this.tgt.x += co.x; this.tgt.y += co.y; this.tgt.z += co.z;
    const ep = this.elbowPush, et = this.elbowPushTo, past = (this.st === ST_SWING && this.lastT >= this.tCon) || this.st === ST_FADE;
    if (!past) et.set(0, 0, 0);
    else if (this.dt > 0) et.multiplyScalar(Math.exp(-this.dt / ELBOW_OUT_EASE));
    const ex = et.x - ep.x, ey = et.y - ep.y, ez = et.z - ep.z, el = Math.sqrt(ex * ex + ey * ey + ez * ez), es = ELBOW_OUT_RATE * this.dt;
    if (el > es) { const r = es / el; ep.x += ex * r; ep.y += ey * r; ep.z += ez * r; } else ep.copy(et);
    this.tgt.add(ep);
    this.outOfTrunk(this.tgt);
    this.elbowOut(this.armRacket, this.tgt, this.pole);
    if (this.fam.track) this.elbowClear(this.armRacket, this.tgt, this.pole); else this.swivel = 0;
    IK_TURN[0] = this.racketSideLimit();
    hingeIK(ua, fa, hand, this.tgt, this.pole, this.elbowRacket);
    IK_TURN[0] = this.dt > 0 ? ELBOW_SIDE_RATE * this.dt : Math.PI;
    this.wristLimit(fa, hand, before ? Math.min(1, sLeft) : smoothstep(0, WRIST_AFTER, this.lastT - this.tCon));
    setWorldQuat(hand, q3);
    hand.updateMatrixWorld(true);
    this.racketClear(ua, fa, hand);
    if (past) this.elbowDepth(fa, hand, et);
    co.x = this.tgt.x - t0x; co.y = this.tgt.y - t0y; co.z = this.tgt.z - t0z;
    const cl = Math.sqrt(co.x * co.x + co.y * co.y + co.z * co.z);
    if (cl > CLEAR_MAX) { const r = CLEAR_MAX / cl; co.x *= r; co.y *= r; co.z *= r; }

    // Free hand.
    const ul = this.armFree[0]!, fl = this.armFree[1]!, hl = this.armFree[2]!;
    v1.setFromMatrixPosition(hl.matrixWorld);
    // The keys are placed for a standing body: when the hips drop or push and the spine leans, the free hand goes
    // with the shoulder (a low slice's crouch had brought the shoulder down onto the hand's key).
    const mf = ul.matrixWorld.elements;
    const fx = mf[12]! - this.freeSh.x, fy = mf[13]! - this.freeSh.y, fz = mf[14]! - this.freeSh.z;
    const runW = this.gaitRun > 0 ? this.gaitW * smoothstep(RUN_V0, RUN_V1, this.sp) : 0;
    if (this.ready > 0) {
      this.toWorld(ready.off, v2);
      v2.x += fx; v2.y += fy; v2.z += fz;
      this.onChest(v2, ua);
      const pump = WALK_ARM * this.gaitH + (this.gaitRun > 0 ? RUN_ARM * this.gaitW * smoothstep(RUN_V0, RUN_V1, this.sp) : 0);
      const sw = -this.handed * pump * Math.cos(2 * Math.PI * this.gaitPhase);
      v2.x += this.stanceS * sw;
      v2.z += this.stanceC * sw;
      // A run's free arm pumps beside the body. From its place in front of the belly it went straight back through the
      // hips, 7% of a run's frames with the forearm inside the pelvis.
      if (runW > 0) {
        this.chestAxes(ul, ua);
        const O = this.chestOut, U = this.chestUp, F = this.chestFwd, a = this.armLen, fw = RUN_HAND_FWD - (this.handed * Math.cos(2 * Math.PI * this.gaitPhase) * RUN_HAND_SWING);
        const hx = mf[12]! + (O.x * RUN_HAND_OUT + U.x * RUN_HAND_UP + F.x * fw) * a;
        const hy = mf[13]! + (O.y * RUN_HAND_OUT + U.y * RUN_HAND_UP + F.y * fw) * a;
        const hz = mf[14]! + (O.z * RUN_HAND_OUT + U.z * RUN_HAND_UP + F.z * fw) * a;
        v2.x += (hx - v2.x) * runW;
        v2.y += (hy - v2.y) * runW;
        v2.z += (hz - v2.z) * runW;
      }
      BL.u = this.ready;
      lerpV(v1, v2);
    }
    const fr = this.fam.free;
    if (fr) {
      const K = this.kfree, O = this.chestOut, U = this.chestUp, F = this.chestFwd, a = this.armLen;
      this.chestAxes(ul, ua);
      v2.x = mf[12]! + (O.x * K.x + U.x * K.y + F.x * K.z) * a;
      v2.y = mf[13]! + (O.y * K.x + U.y * K.y + F.y * K.z) * a;
      v2.z = mf[14]! + (O.z * K.x + U.z * K.y + F.z * K.z) * a;
    } else {
      this.toWorld(this.koff, v2);
      v2.x += fx; v2.y += fy; v2.z += fz;
    }
    // (all the way for an overhead: the free arm points at the ball, straight)
    BL.u = this.fam.over || this.fam.high || fr ? w : w * 0.85;
    lerpV(v1, v2);
    // The free elbow hangs down and back from the chest, which has turned with the stroke (in the stance frame a
    // pole fixed square to the net comes into line with the arm when the body is side-on, and the elbow flips).
    const cT = Math.cos(this.chestTurn), sT = Math.sin(this.chestTurn), op = this.offPole;
    v3.set(op.x * cT + op.z * sT, op.y, -op.x * sT + op.z * cT);
    this.toWorld(v3, this.pole);
    const ikF = Math.max(this.ready, w * 0.85);
    if (ikF < 1) {
      bendDir(ul, fl, hl, DOWN, bendF);
      v2.setFromMatrixPosition(fl.matrixWorld).addScaledVector(bendF, 0.5);
      BL.u = 1 - ikF;
      lerpV(this.pole, v2);
    }
    // A run's free elbow is behind the shoulder. Down and back off the chest, the pole lay along the arm with the hand at the back of
    // the swing, and the elbow swung out like a wing: the upper arm over 45 degrees out in 14% of fast-run frames (review round 33, #9).
    if (runW > 0 && w < 1) {
      this.chestAxes(ul, ua);
      const F = this.chestFwd, U = this.chestUp, a = this.armLen;
      v2.set(mf[12]! - (F.x + U.x * RUN_POLE_DOWN) * a, mf[13]! - (F.y + U.y * RUN_POLE_DOWN) * a, mf[14]! - (F.z + U.z * RUN_POLE_DOWN) * a);
      BL.u = runW * this.ready * (1 - w);
      lerpV(this.pole, v2);
    }
    this.chestAxes(ul, ua);
    this.outOfTrunk(v1);
    this.shoulderLimit(ul, v1, 1, ARM_BEHIND);
    this.keepOff(ul, v1, this.elbowFree.dir);
    const E = this.elbowFree;
    this.dirF0.copy(E.dir); this.sideF0.copy(E.side); this.bendF0 = E.bend[0]!;
    this.elbowOut(this.armFree, v1, this.pole);
    hingeIK(ul, fl, hl, v1, this.pole, E);
    this.freeClear(ul, fl, hl);
    // Fade into the clip's arms below ARM_FADE of weight: the hinge solve has its own elbow side and upper-arm roll,
    // so at a weight of 0.01 the arm was still far from the clip's and went back to it in a frame when the arms
    // switched off (the free arm 55-72 degrees, between points; QA army).
    this.fadeArm(this.armRacket, 0, smoothstep(0.01, ARM_FADE, Math.max(this.ready, w)));
    this.fadeArm(this.armFree, 3, smoothstep(0.01, ARM_FADE, Math.max(this.ready, w * 0.85)));
  }

  /**
   * A ball still out of the arm's reach with the upper body bent: the racket tips about the ball (v1), the head going
   * down and the wrist coming back within the arm's reach, as a hand reaching for a low ball does. With the racket held
   * as the key has it, balls under 0.5 m were missed by 15-28 cm (review round 5, the critic's #6).
   */
  private tipRacket(ua: THREE.Bone, w: number): void {
    const mu = ua.matrixWorld.elements, T = this.tgt;
    const dx = v1.x - mu[12]!, dy = v1.y - mu[13]!, dz = v1.z - mu[14]!;
    const gx = v1.x - T.x, gy = v1.y - T.y, gz = v1.z - T.z;
    const D = Math.sqrt(dx * dx + dy * dy + dz * dz), g = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const W = this.tipWant;
    W.x = 0; W.y = 0; W.z = 0; W.w = 1;
    let want = 0;
    if (D >= 1e-3 && g >= 1e-3) {
      const tx = T.x - mu[12]!, ty = T.y - mu[13]!, tz = T.z - mu[14]!;
      const R = this.armLen * 0.98;
      if (tx * tx + ty * ty + tz * tz > R * R) {
        const now = Math.acos(Math.min(1, Math.max(-1, (dx * gx + dy * gy + dz * gz) / (D * g))));
        const c = (D * D + g * g - R * R) / (2 * D * g);
        want = Math.min(TIP_MAX, Math.max(0, now - (c >= 1 ? 0 : Math.acos(Math.max(-1, c))))) * w;
      }
    }
    if (this.dt > 0) {
      const lim = RACKET_TURN_RATE * this.dt;
      want = Math.min(this.tip + lim, Math.max(this.tip - lim, want));
    }
    this.tip = want;
    // Axis g x d, turning the racket's way from the ball to the hand towards the way from the ball to the shoulder.
    const cx = gy * dz - gz * dy, cy = gz * dx - gx * dz, cz = gx * dy - gy * dx;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (want >= 1e-3 && cl >= 1e-6) {
      v3.x = cx / cl; v3.y = cy / cl; v3.z = cz / cl;
      W.setFromAxisAngle(v3, want);
    }
    // Followed as a turn, not just as an amount: with the ball, hand and shoulder nearly in line that axis comes round
    // fast, and the hand went 90 degrees in a frame.
    const TQ = this.tipQ;
    if (this.dt > 0) {
      const d = Math.min(1, Math.abs(TQ.x * W.x + TQ.y * W.y + TQ.z * W.z + TQ.w * W.w));
      const ang = 2 * Math.acos(d), lim = TIP_RATE * this.dt;
      if (ang > lim) TQ.slerp(W, lim / ang);
      else TQ.copy(W);
    } else TQ.copy(W);
    if (TQ.w > 0.99999985) return;
    q2.multiplyQuaternions(TQ, q1);
    q3.multiplyQuaternions(q2, this.grip.qInv);
    v2.copy(this.grip.pos).applyQuaternion(q3);
    // The frame stays off the floor, the tip given back in proportion: the head of a ball taken off the ground.
    const y0 = v1.y + (gy / g) * RACKET_TOP, y1 = v1.y + (v2.y / g) * RACKET_TOP;
    if (y1 < RACKET_FLOOR && y1 < y0) {
      const back = Math.max(0, (y0 - RACKET_FLOOR) / (y0 - y1));
      this.tip = want * back;
      TQ.slerp(this.tipOff, 1 - back);
      q2.multiplyQuaternions(TQ, q1);
      q3.multiplyQuaternions(q2, this.grip.qInv);
      v2.copy(this.grip.pos).applyQuaternion(q3);
    }
    T.subVectors(v1, v2);
  }

  /** The arm's three bones from the clip's (armClipQ from `k`) to the solve's by `f`. */
  private fadeArm(arm: THREE.Bone[], k: number, f: number): void {
    const ok = this.fadeOk[k / 3] === 1 && this.dt > 0;
    this.fadeOk[k / 3] = 1;
    if (f < 1) {
      BL.u = f;
      const lim = FADE_TURN_RATE * this.dt;
      for (let j = 0; j < 3; j++) {
        const q = arm[j]!.quaternion, pv = this.fadePrev[k + j]!;
        blendTo(q, this.armClipQ[k + j]!);
        // No faster than FADE_TURN_RATE from last frame's.
        if (ok) {
          const d = Math.min(1, Math.abs(q.x * pv.x + q.y * pv.y + q.z * pv.z + q.w * pv.w));
          const ang = 2 * Math.acos(d);
          if (ang > lim) q.copy(pv.slerp(q, lim / ang));
        }
      }
      arm[0]!.updateMatrixWorld(true);
    }
    for (let j = 0; j < 3; j++) this.fadePrev[k + j]!.copy(arm[j]!.quaternion);
  }
}

/** A geometry sharing `s`'s attributes and morphs, with its own triangles or positions. */
function ownGeometry(s: THREE.BufferGeometry, index: THREE.BufferAttribute | null, position: THREE.BufferAttribute | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(s.attributes)) g.setAttribute(k, k === 'position' && position ? position : s.getAttribute(k));
  g.morphAttributes = s.morphAttributes;
  g.morphTargetsRelative = s.morphTargetsRelative;
  g.setIndex(index ?? s.index);
  for (const gr of s.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.boundingSphere = s.boundingSphere;
  return g;
}
