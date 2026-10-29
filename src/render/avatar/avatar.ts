// One player's body: the Y Bot skinned mesh, driven by blended Mixamo locomotion, with the strokes made in code
// (key poses in strokes.ts, reached with two-bone IK and timed so the racket meets the ball at the sim's contact
// moment) and the racket in the right hand. Reads the sim only. Allocation-free per frame.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../../sim/match.ts';
import { PH_DEAD, PH_RALLY, PH_SETUP, PH_TOSS } from '../../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../../sim/player/player.ts';
import { MOD_POWER, MOD_PRECISION, SHOT_BANDEJA, SHOT_DRIVE, SHOT_DROP, SHOT_LOB, SHOT_SLICE, SHOT_SMASH, SHOT_TOPSPIN, SHOT_VIBORA } from '../../sim/contact/shots.ts';
import type { StandPlan } from '../../sim/player/positioning.ts';
import { DT } from '../../sim/core/constants.ts';
import { personMeshes, type Clip, type PlayerAsset } from './asset.ts';
import { FaceDriver, type FaceInput } from './face.ts';
import { Pose, accumulate, blendMasked, normalize, sampleClip, sampleCycle } from './pose.ts';
import { hingeIK, IK_BEND, IK_SOFT, IK_TURN, rotateWorld, setWorldQuat, twoBoneIK, worldQuat } from './ik.ts';
import { fitCapsules, RACKET_PTS } from './capsules.ts';
import { makeRacketModel, makeWristCord } from './racket.ts';
import { solveGrip } from './grip.ts';
import type { HingeLimb } from './ik.ts';
import { INERT_DT, Inertializer, InertN, InertQ } from './inertia.ts';
import { fitSoles, type SolePoint } from './soles.ts';
import { kitMaterial, personMaterial, type KitLook, type KitState } from './kit.ts';
import {
  BACKHAND, BH_CHIQUITA, BH_CONTRA, BH_DROP, BH_LOB, BH_SLICE, FH_CHIQUITA, FH_CONTRA, FH_DROP, FH_LOB, FH_SLICE, FOREHAND, OVERHEAD, READY, READY_LEFT, TAP, TAP_LEFT, CARRY, CARRY_LEFT, SERVE, SERVE_ADDRESS, SERVE_ADDRESS_LEFT, SERVE_TURN_SHARE, SMASH, VIBORA, VOLLEY_BH, VOLLEY_FH,
  leftFamily,
  type Family, type Key,
} from './strokes.ts';

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();

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
 * a = nlerp(a, b, BL.u) (for blending poses, close enough to slerp). Two rotations can be blended either way round;
 * the way is the one whose result is nearer last frame's (`prev`, the blend's own output, zero when there is none),
 * and the short way only at the blend's start. Re-picking the short way mid-blend whenever b swung far (the old
 * rule) turned the racket over in a frame, and the wrist with it (60 cm at a left-hander's overhead). Both inputs
 * should be continuous from frame to frame (alignQ).
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
function nlerpQ(a: THREE.Quaternion, b: THREE.Quaternion, prev: THREE.Quaternion): void {
  const u = BL.u, v = 1 - u;
  const x1 = a.x * v + b.x * u, y1 = a.y * v + b.y * u, z1 = a.z * v + b.z * u, w1 = a.w * v + b.w * u;
  const x2 = a.x * v - b.x * u, y2 = a.y * v - b.y * u, z2 = a.z * v - b.z * u, w2 = a.w * v - b.w * u;
  const l1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1 + w1 * w1), l2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2 + w2 * w2);
  let plus: boolean;
  if (l1 < 1e-6 || l2 < 1e-6) plus = l1 >= l2;
  else if (u < 0.02 || prev.x * prev.x + prev.y * prev.y + prev.z * prev.z + prev.w * prev.w < 0.5) {
    plus = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w >= 0;
  } else {
    const c1 = Math.abs(x1 * prev.x + y1 * prev.y + z1 * prev.z + w1 * prev.w) / l1;
    const c2 = Math.abs(x2 * prev.x + y2 * prev.y + z2 * prev.z + w2 * prev.w) / l2;
    plus = c1 >= c2;
  }
  if (plus) { QN[0] = x1 / l1; QN[1] = y1 / l1; QN[2] = z1 / l1; QN[3] = w1 / l1; } else { QN[0] = x2 / l2; QN[1] = y2 / l2; QN[2] = z2 / l2; QN[3] = w2 / l2; }
  a.fromArray(QN);
  prev.copy(a);
}

/** An arm's hinge, plus the way from its shoulder to the hand last frame (zero: none yet), for keepOff. */
type Elbow = HingeLimb & { dir: THREE.Vector3 };
/** How fast an elbow's side may swing round the shoulder-to-hand line (rad/s): the shoulder's rotation speed limit. */
const ELBOW_SIDE_RATE = (1500 * Math.PI) / 180;
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
/** The forward swing starts this long before the planned contact while the key is still held (s)... */
const LEAD = 0.16;
/** ...and waits this far along (0..1) for the release. */
const HOVER = 0.85;
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
/** Pelvis, chest and head capsules per asset (fitted once): bone pairs, and radii. */
const GUARD = new WeakMap<PlayerAsset, { bones: Int32Array; r: Float64Array }>();
function guardCaps(asset: PlayerAsset): { bones: Int32Array; r: Float64Array } {
  let g = GUARD.get(asset);
  if (!g) {
    const caps = fitCapsules(asset).filter((c) => c.name === 'pelvis' || c.name === 'chest' || c.name === 'head');
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
const DOWN_SHARE = 0.55;
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
/** Fastest the hips come back up from a drop (m/s): standing up out of a lunge. */
const HIP_RISE = 1.5;
/** Fastest the hips drop (m/s): into a lunge, about 0.3 m in 0.15 s. */
const HIP_FALL = 2;
/** Time before the contact (s) the hips start leaning towards it, and lean fully. */
const LEAN_FROM = 0.4;
const LEAN_FULL = 0.1;
/** Fastest the hips' reach towards the ball changes after the contact (m/s, over the feet): the follow-through moves
 * the key at racket speed, and a reach following it swung the hips 0.38 m in five frames, a foot turning 123° in one. */
const REACH_RATE = 2.5;
/** The same before the contact (m/s): a new plan's reach comes in over 0.1 s or so. */
const REACH_RATE_BEFORE = 4;
/** Nearest an ankle comes to its hip, as a share of the leg's length (a deep lunge's front leg is about 0.6). */
const LEG_FOLD = 0.55;
/** Lowest an ankle goes (m): the foot flat on the floor. */
const ANKLE_MIN = 0.08;
/** Fastest the racket turns (rad/s): 3600°/s, over a tennis forehand's racket at contact (about 1500°/s) and a
 * serve's; under it every stroke the QA has seen. */
const RACKET_TURN_RATE = (3600 * Math.PI) / 180;
/** Fastest a shin twists about its own length (rad/s): 2400°/s, four times a fast pivot's 180° in 0.3 s. */
const SHIN_TWIST_RATE = (2400 * Math.PI) / 180;
/** limitShins' turn back about the shin (a double passed to a call V8 doesn't inline is boxed). */
const QS = new Float64Array(4);
const qFoot = new THREE.Quaternion();
/** Most the hips drop for a low or wide ball (crouch, lunge and reach together; m). */
const DROP_MAX = 0.55;
/**
 * The smash is hit in the air, both feet off before the contact (Espino et al. 2015 via
 * docs/research/serve-and-strokes-motion.md 4.2; contact 2.30-2.50 m at full reach): a ballistic hop peaking at the
 * contact, as high as the ball is above what the toes reach (JUMP_TOES), up to JUMP_MAX (no padel jump height is
 * published; a smash hop is well under a standing jump's 35-45 cm), landing on bent knees (LAND_DROP over LAND_TIME).
 * Standing on the toes only, smashes met at 2.4 m missed the ball by about 10 cm.
 */
const JUMP_MAX = 0.3;
const JUMP_TOES = 0.12;
const LAND_DROP = 0.06;
const LAND_TIME = 0.2;
const FOLLOW = 0.3;
const FADE = 0.35;
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
/** Extra turn to the racket side while the ball goes past to the glass (rad), and how fast it comes and goes (s). */
const WALL_TURN = 1.0;
/** Racket tap (racketTap): partners this close (m), for this long (s), turned this share of the way to each other. */
const TAP_NEAR = 1.3;
const TAP_HOLD = 0.75;
const TAP_TURN = 0.8;
/** How far towards the carry key (CARRY) the racket goes while walking back. */
const CARRY_W = 0.9;
const WALL_EASE = 0.2;
/** How far the head turns from the chest to watch the ball (rad), and the neck's share of it. */
const LOOK_YAW = 1.25;
const NECK_SHARE = 0.4;
/**
 * Standing or shuffling slowly the feet stay planted while the body turns and drifts over them, and a foot steps
 * (one at a time, lifted, over STEP_TIME) once it is this far (m) or this turned (rad) from where the animation
 * wants it. Further than STEP_SNAP it steps at once, whatever the other foot is doing.
 */
const STEP_DIST = 0.13;
const STEP_YAW = 0.55;
const STEP_TIME = 0.15;
/** A planted foot whose heading is this far (rad) from the body's steps even while the other foot is stepping: held
 * longer, a body turning on the spot (a left-hander's stroke squaring up from a ball behind) left it 180° behind. */
const WAIT_TURN_MAX = 1.6;
const STEP_LIFT = 0.05;
const STEP_SNAP = 0.7;
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
/** Fastest a foot's lunge offset moves (m/s): a long step's pace. */
const LUNGE_RATE = 3;
/** Furthest a lunging foot goes from its hip, as a share of the leg's length (the lock lets go at 0.985). */
const LUNGE_REACH = 0.95;
/** How far a low ball (under 0.45 m, from 0.95 m) steps the foot on its side towards it (m). */
const LUNGE_LOW = 0.45;
/** Below this weight (the stroke's or the ready position's) the arm solve fades into the clip's arm. */
const ARM_FADE = 0.15;
/** Furthest a swing reaches past the arm (m: hand to the face's centre and the hips' reach), and the heights an
 * out-of-reach contact is swung at between (m). */
const CON_REACH = 1.0;
const CON_LOW = 0.25;
const CON_TOP = 2.7;
/** Locomotion: how close to halfway between two directions (a quarter turn = 1) their clips cross-fade. */
const WARP_BAND = 0.1;
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
/** Most the spine turns back against the legs' warp (rad); past it the chest turns with the hips. */
const WARP_SPINE_MAX = Math.PI / 4;
/** How fast the chest turns with the hips into a side-on run and back out of it (rad/s): switched at once, the
 * chest, arms and head jumped up to 45 degrees in a frame. */
const WARP_CHEST_RATE = 3.5;
/** How fast the legs turn into a side-on run and back out of it (rad/s): a quarter turn in 0.2 s. Switched at once,
 * the hips and the spine's turn back jumped together and their inertialization undid the cancelling (pops tripled). */
const WARP_SWITCH_RATE = 8;

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
  private reactStart = 0;
  private reactFrom = 0;
  private lastPhase = -1;
  // Split step: a small hop as the opponent strikes, landing with bent knees (feet kept planted).
  private lift = 0;
  private splitDrop = 0;
  /** Smash jump: how far the ball is above the arm's reach (m, from the legs' solve), and the hop under way. */
  private upNeed = 0;
  private jumpH = 0;
  private jumpT0 = -1;
  private jumpT = 0;
  private landAt = -1;
  /** The hips' drop shown last frame (m; see HIP_RISE). */
  private dropShown = 0;
  /** Planted feet (left, right): weight, where each is (world), its yaw, and a step under way (-1: none). */
  private plantW = 0;
  private sp = 0;
  /** Sole points per foot, and hip-to-ankle length at rest. */
  private readonly soles: SolePoint[][];
  private readonly legLen: number;
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
  private readonly cycleW = new Float64Array(5);
  /** Orientation warp (rad): how far the legs turn from the playing clip's direction onto the body's travel. */
  private warp = 0;
  /** Running side-on (SIDE_RUN_ON). */
  private sideRun = false;
  /** How far the chest has turned with the legs' warp (rad), following WARP_CHEST_RATE. */
  private chestWarp = 0;
  /** What the warp has still to turn after a switch into or out of a side-on run (rad), going at WARP_SWITCH_RATE. */
  private warpOff = 0;
  private readonly pose: Pose;
  private readonly tmp: Pose;
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
  /** The server's address before the toss (side-on, the ball in the free hand): this player's copy, the hand on the ball. */
  private readonly addrKey: Key = { p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), yaw: 0, off: new THREE.Vector3() };
  /** The address's share of the ready pose (eased: at the serve's contact the address hands over to the ready pose). */
  private addrW = 0;
  /** The chest's turn from square this frame (hips and spine together, rad). */
  private chestTurn = 0;
  private readonly outAddr = new THREE.Quaternion(0, 0, 0, 0);
  /** The racket tap between partners after a point (racketTap): weight, time close, the way to the partner. */
  private tapW = 0;
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
  private fadeFromW = 0;
  private readonly conW = new THREE.Vector3();
  /** The clip's arm rotations before the arm solve (racket arm, then free arm). */
  private readonly armClipQ = [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion());
  /** Last frame's arm rotations after the fade (fadeArm turns no faster than FADE_TURN_RATE from these), and whether each arm's are there. */
  private readonly fadePrev = [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion());
  private readonly fadeOk = new Uint8Array(2);
  /** The contact pulled in to reach (contactKey). */
  private readonly conClamp = new THREE.Vector3();
  private hasCon = false;
  /** Stroke weight (0 = pure locomotion) and the blended key it is pulling towards (model space). */
  w = 0;
  /** Weight of the ready position (racket up in front) under the stroke. */
  private ready = 0;
  private readonly kp = new THREE.Vector3();
  private readonly kq = new THREE.Quaternion();
  private readonly kpole = new THREE.Vector3();
  private readonly koff = new THREE.Vector3();
  private kyaw = 0;
  private crouch = 0;
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
  private hand = 1;
  /** Weight of watching the ball with the head. */
  private look = 0;
  /** Hips pushed towards a ball out of reach (world x, z). */
  private reachX = 0;
  private reachZ = 0;

  // Scratch per avatar.
  private readonly footL = new THREE.Vector3();
  private readonly footR = new THREE.Vector3();
  private readonly footQL = new THREE.Quaternion();
  private readonly footQR = new THREE.Quaternion();
  private readonly tgt = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
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
  /** The racket's push out of the body last frame (world, m), let go over CLEAR_EASE. */
  private readonly clearOff = new THREE.Vector3();
  /** How much of the racket's push out of the body the arm's weight allows this frame (0 as the arms switch off). */
  private clearW = 1;
  /** Last frame's racket rotation (world), for RACKET_TURN_RATE; racketQOk false: none yet (a cut, arms off). */
  private readonly racketQ = new THREE.Quaternion();
  private racketQOk = false;
  private readonly dir0 = new THREE.Vector3();
  private readonly side0 = new THREE.Vector3();
  /** Last frame's racket elbow bend, for the second solve (racketClear). */
  private bend0 = 0;
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
  /**
   * Pops smoothed over (see inertia.ts): the clip pose before IK, the head after looking, the stance's facing, the
   * stroke's key and weight, the hips' drop and reach. `inertial = false` shows the raw pose (QA comparisons).
   */
  inertial = true;
  /** Which filters run (QA only): 1 clip pose, 2 head, 4 facing, 8 key, 16 weight, 32 hips. */
  static inertMask = 63;
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
  /** Metres run this match (render-side): sweat builds with effort as well as time. */
  private ran = 0;
  /**
   * Each foot's lowest sole point after this frame's pose (world): x, height above the floor, z, for the left then
   * the right foot. The soundscape hears a step where one comes down onto the floor.
   */
  readonly feet = new Float64Array(6);
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

  constructor(asset: PlayerAsset, look: number | KitLook) {
    this.nb = asset.bones.length;
    this.pose = new Pose(this.nb);
    this.tmp = new Pose(this.nb);
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
      const k = personMaterial(asset, look);
      mat = k.material;
      hairMat = k.hair;
      this.kit = k.state;
    } else {
      const k = kitMaterial(asset, look);
      mat = k.material;
      this.kit = k.state;
    }
    const skeleton = new THREE.Skeleton(this.bones, asset.boneInverses);
    // A dressed person is drawn as body + face (the face alone carries the morph targets); after the material, which
    // adds attributes the face copies.
    const pm = asset.look && typeof look !== 'number' ? personMeshes(asset) : null;
    this.mesh = new THREE.SkinnedMesh(pm ? pm.body : asset.geometry, mat);
    this.mesh.add(this.bones[0]!);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    const morphed: THREE.SkinnedMesh[] = [];
    if (pm?.face) {
      const fm = new THREE.SkinnedMesh(pm.face, mat);
      fm.bind(skeleton, new THREE.Matrix4());
      fm.castShadow = true;
      fm.frustumCulled = false;
      this.root.add(fm);
      morphed.push(fm);
    }
    if (asset.look && hairMat) {
      // A person's hair, brows and lashes: alpha-tested, on the same skeleton.
      const hair = new THREE.SkinnedMesh(asset.look.alphaGeometry, hairMat);
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
    this.armR = [b('RightArm'), b('RightForeArm'), b('RightHand')];
    this.armL = [b('LeftArm'), b('LeftForeArm'), b('LeftHand')];
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
    this.clips = {
      idle: asset.clip('idle'),
      cycle: [asset.clip('jog'), asset.clip('run'), asset.clip('strafeLeft'), asset.clip('runBack'), asset.clip('strafeRight')],
      celebrate: asset.clip('celebrate'),
      dejected: asset.clip('dejected'),
    };
    this.upper = new Uint8Array(this.nb);
    const spineIdx = asset.bone('Spine');
    for (let i = 0; i < this.nb; i++) {
      for (let j = i; j >= 0; j = asset.bones[j]!.parent) if (j === spineIdx) { this.upper[i] = 1; break; }
    }

    const rw = asset.restWorld;
    const bp = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(rw[asset.bone(n)]!);
    this.armLen = bp('RightArm').distanceTo(bp('RightForeArm')) + bp('RightForeArm').distanceTo(bp('RightHand'));
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
      pos: s.pos, q: s.q, qInv: s.q.clone().invert(), bones: s.bones, quats: s.quats, cord: makeWristCord(s.wrist, s.forearm, s.wristR),
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
    k.sweat.value.x = Avatar.sweatAt >= 0 ? Avatar.sweatAt : Math.min(1, sim.time / SWEAT_T + this.ran / SWEAT_M);
  }

  /** Switch the racket hand (the sim's `handed`): racket, grip, arms and stroke keys all follow. */
  /** Skin matrices are refreshed once per animation-loop frame; a render outside the loop calls this first. */
  refreshSkin(): void {
    this.root.updateMatrixWorld(true);
    this.mesh.skeleton.update();
  }

  private setHanded(h: number): void {
    this.handed = h;
    this.grip = this.grips[h > 0 ? 0 : 1]!;
    this.armRacket = h > 0 ? this.armR : this.armL;
    this.armFree = h > 0 ? this.armL : this.armR;
    this.elbowRacket = h > 0 ? this.elbowR : this.elbowL;
    this.elbowFree = h > 0 ? this.elbowL : this.elbowR;
    this.readyKey = h > 0 ? READY : READY_LEFT;
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

  private pickFamily(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number, contra = false): Family {
    const f = contra ? (hand > 0 ? FH_CONTRA : BH_CONTRA) : this.pickRight(sim, p, idx, c, overhead, volley, hand);
    return this.handed > 0 ? f : leftFamily(f);
  }

  /** The stroke for a right-hander (`hand` +1 forehand, -1 backhand). */
  private pickRight(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number): Family {
    if (sim.phase <= PH_TOSS && sim.score.serverPlayer() === idx) return SERVE;
    // An AI holds power or precision only as it lets go: its intent says which overhead or topspin it is.
    const ai = sim.ai[idx];
    // While the key is held the modifiers being held say it; from the release on, the ones it was released with.
    const mod = p.swing === SW_CHARGE ? p.heldMod : p.mod;
    if (overhead || c.y > 1.8) {
      if (p.shot === SHOT_SMASH || mod === MOD_POWER || (ai !== null && ai !== undefined && ai.smash)) return SMASH;
      // The víbora: the overhead key with precision (the sim's SHOT_BANDEJA + MOD_PRECISION), or an AI's intent.
      if (p.shot === SHOT_VIBORA || (p.shot === SHOT_BANDEJA && mod === MOD_PRECISION) || (ai !== null && ai !== undefined && ai.vibora)) return VIBORA;
      return OVERHEAD;
    }
    if (volley) return hand > 0 ? VOLLEY_FH : VOLLEY_BH;
    const sh = p.shot;
    if (sh === SHOT_TOPSPIN && (mod === MOD_PRECISION || (ai !== null && ai !== undefined && ai.chiquita))) return hand > 0 ? FH_CHIQUITA : BH_CHIQUITA;
    if (sh === SHOT_SLICE) return hand > 0 ? FH_SLICE : BH_SLICE;
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
    let f = (t - pr.start) / DT - i;
    if (i + 1 >= pr.n || !(f > 0)) f = 0;
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
    if (f.low) k.q.slerp(f.low, smoothstep(0.95, 0.4, k.p.y));
    k.pole.copy(f.contact.pole);
    k.yaw = f.contact.yaw;
    k.off.copy(f.contact.off);
    return k;
  }

  /** Forward swing at progress s (0 = end of the backswing, 1 = the ball), into the blended key. */
  private swingKey(s: number): void {
    this.keyS = s;
    const f = this.fam;
    const k = this.contactKey();
    // Accelerating into the ball along a curve below (groundstrokes) or behind the head (overheads).
    const e = Math.pow(s, 1.7);
    if (f.via) {
      // The control point that puts the curve through `via` at its moment: B(ev) = via.
      const ev = Math.pow(f.viaS ?? 0.5, 1.7), u = 1 - ev, c = 1 / (2 * ev * u);
      this.ctrl.copy(f.via).addScaledVector(f.back.p, -u * u).addScaledVector(k.p, -ev * ev).multiplyScalar(c);
    } else {
      this.ctrl.copy(f.back.p).lerp(k.p, 0.5);
      this.ctrl.y -= f.dip;
      this.ctrl.z -= f.loop;
    }
    bezier(f.back.p, this.ctrl, k.p, e, this.kp);
    this.kq.copy(f.back.q).slerp(k.q, e);
    this.kpole.copy(f.back.pole).lerp(k.pole, e);
    this.koff.copy(f.back.off).lerp(k.off, e);
    this.kyaw = f.back.yaw + (k.yaw - f.back.yaw) * e;
  }

  /** The contact this player is set up for (world, into conW) and when; -1 if none. */
  private planned(sim: MatchSim, idx: number): number {
    if (sim.phase === PH_TOSS && sim.score.serverPlayer() === idx && sim.rally.hitter < 0) {
      // An AI server lets go at its own moment, and one after the ideal is the contact (an early one waits for it).
      const ai = sim.ai[idx];
      const at = ai && ai.pressed && !ai.released && ai.releaseAt > sim.tossIdeal ? ai.releaseAt : sim.tossIdeal;
      this.known = ai !== null && ai !== undefined;
      // (not the last rally's: a serve held as beaten waited at the backswing and swung 0.1 s late)
      this.beaten = false;
      this.predAt(sim, at, this.conW);
      return at;
    }
    this.known = false;
    this.beaten = false;
    const st = this.plan(sim, idx);
    if (!st.valid) return -1;
    // An AI lets go at its own release time (the window it tracks, its timing error included); a late release is
    // the contact, an early one meets the ball at the window's ideal moment: time the swing to that, at wherever
    // the ball will be then (timed to an early release, the overhead's target jumped 27 cm at the release and the
    // forearm turned 82 degrees in a frame; QA army).
    const ai = sim.ai[idx];
    this.beaten = ai ? ai.beaten : false;
    if (ai && ai.pressed && !ai.released && ai.releaseAt > sim.time - 0.05) {
      this.known = true;
      const at = ai.releaseAt > ai.releaseIdeal ? ai.releaseAt : ai.releaseIdeal;
      this.predAt(sim, at, this.conW);
      return at;
    }
    this.conW.set(st.bx, st.by, st.bz);
    return st.t;
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
        this.swingS = 0;
      }
      const tp = this.planned(sim, idx);
      this.hasCon = tp >= 0;
      this.tPlan = tp;
      // Off the back glass: side-on to the racket side while the ball, on this side, still goes towards it.
      const side = sim.side(p.team);
      if (st.valid) this.hand = st.hand;
      this.wallWant = st.valid && st.afterWall && !st.contra && this.swingS === 0 && sim.phase === PH_RALLY
        && sim.ball.pos.z * side > 0 && sim.ball.vel.z * side > 0.3 ? 1 : 0;
      if (this.swingS === 0) {
        // Re-aimed while the plan changes (the ball may cross to the other side); a change of stroke blends
        // over from wherever the racket is rather than jumping.
        if (!this.hasCon) this.conW.set(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
        const hand = st.valid ? st.hand : this.handOf(sim, p, this.conW);
        const fam = this.pickFamily(sim, p, idx, this.conW, st.valid && st.overhead, st.valid && st.volley, hand, st.valid && st.contra);
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
        this.swingS = Math.max(this.swingS, Math.min(this.known ? 1 : HOVER, 1 - (tp - t) / lead, cap));
      }
    }
    // Release (a whiff at release goes straight to recover): finish the swing at the contact moment.
    if (sw !== SW_CHARGE) this.wallWant = 0;
    const released = (sw === SW_COMMITTED && this.lastSwing !== SW_COMMITTED)
      || (sw === SW_RECOVER && this.lastSwing === SW_CHARGE);
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
      if (this.hasCon && (this.st !== ST_PREP || this.swingS === 0)) {
        const fresh = !st.valid || Math.abs(st.t - (hit ? p.lastContactTime : p.contactTime)) > 0.12;
        const vol = fresh
          ? (hit ? this.prevBounces : sim.rally.bounces) === 0 && (p.shot === SHOT_DRIVE || p.shot === SHOT_SLICE)
          : st.volley;
        // (a contrapared is only struck from a contrapared plan; facing the glass the forehand is the other side)
        const contra = fresh ? p.contra : st.contra;
        const hand = fresh ? this.handOf(sim, p, this.conW) * (contra ? -1 : 1) : st.hand;
        const fam = this.pickFamily(sim, p, idx, this.conW, !fresh && st.overhead, vol && !contra, hand, contra);
        if (this.st === ST_PREP && fam !== this.fam) { this.snapshot(); this.relBlend = true; }
        this.fam = fam;
      }
      this.tCon = Math.max(hit ? p.lastContactTime : this.hasCon ? p.contactTime : t, t + (1 - this.relS) * MIN_SWING * this.fam.punch);
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
      const left = this.hasCon ? this.tPlan - this.prepStart : PREP;
      const u = smoothstep(0, left * PREP_SHARE < PREP ? Math.max(PREP_MIN, left * PREP_SHARE) : PREP, t - this.prepStart);
      if (this.swingS > 0) this.swingKey(this.swingS);
      else {
        // Held at the end of the backswing: no forward swing yet (keyS is what the racket clear's release reads; the
        // last stroke's 0.99 left over here cancelled its carried push on almost every backswing frame).
        this.keyS = 0;
        this.setKey(f.back, f.back, 1);
      }
      if (this.prepFromW > 0 && u < 1) this.blendFrom(u);
      this.w = this.prepFromW + (1 - this.prepFromW) * u;
    } else if (this.st === ST_SWING) {
      if (t < this.tCon) {
        const g = clamp01((t - this.tRel) / (this.tCon - this.tRel));
        this.swingKey(this.relS + (1 - this.relS) * g);
        if (this.relBlend) this.blendFrom(smoothstep(0, 0.7, g));
        this.w = this.relW + (1 - this.relW) * smoothstep(0, 0.06, t - this.tRel);
      } else if (t < this.tCon + FOLLOW) {
        // Follow-through, slowing down, carrying on through the ball before wrapping round.
        const s = clamp01((t - this.tCon) / FOLLOW);
        const e = 1 - (1 - s) * (1 - s);
        const k = this.contactKey();
        this.ctrl.copy(k.p).lerp(f.finish.p, 0.5);
        this.ctrl.z += 0.25;
        bezier(k.p, this.ctrl, f.finish.p, e, this.kp);
        this.kq.copy(k.q).slerp(f.finish.q, e);
        this.kpole.copy(k.pole).lerp(f.finish.pole, e);
        this.koff.copy(k.off).lerp(f.finish.off, e);
        this.kyaw = k.yaw + (f.finish.yaw - k.yaw) * e;
        this.w = 1;
        this.finishTo = e;
      } else {
        this.setKey(f.finish, f.finish, 1);
        this.fadeOut(this.tCon + FOLLOW, 1);
        this.finishTo = 1;
      }
    }
    if (this.st === ST_PREP || (this.st === ST_SWING && t < this.tCon) || this.st === ST_NONE) this.finishTo = 0;
    if (this.st === ST_FADE) {
      this.setKey(this.from, this.from, 1);
      const u = smoothstep(this.fadeStart, this.fadeStart + FADE, t);
      this.w = this.fadeFromW * (1 - u);
      if (u >= 1) { this.st = ST_NONE; this.w = 0; }
    } else if (this.st === ST_NONE) {
      this.w = 0;
    }
    this.keepCon = this.st === ST_SWING && t < this.tCon ? (this.tCon - t) / (this.tCon - t + this.dt) : 1;
    if (this.inertial && (Avatar.inertMask & 24) !== 0) { this.keyT = t; this.smoothKey(); }
    // Low balls: bend the knees (contact or plan height), scaled by the stroke's weight.
    const cy = this.hasCon ? this.conW.y : 1;
    this.crouch = f.crouch * Math.min(0.18, Math.max(0, (0.95 - cy) * 0.4)) * this.w;
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
    this.fadeFromW = w;
  }

  // ---- locomotion ----

  private locomote(p: Player): void {
    const dt = this.dt;
    const yRoot = this.yRoot;
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.08) : 1;
    this.vx += (p.vel.x - this.vx) * k;
    this.vz += (p.vel.z - this.vz) * k;
    // Velocity in the model's frame (+z forward, +x its left).
    const c = Math.cos(yRoot), s = Math.sin(yRoot);
    const mx = this.vx * c - this.vz * s;
    const mz = this.vx * s + this.vz * c;
    const sp = Math.sqrt(mx * mx + mz * mz);
    this.sp = sp;
    const move = smoothstep(0.12, 0.9, sp);
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
    if (this.sideRun) { if (sp < SIDE_RUN_OFF || aq < 0.4 || aq > SIDE_RUN_MAX + 0.1) this.sideRun = false; }
    else if (sp > SIDE_RUN_ON && aq > 0.5 && aq < SIDE_RUN_MAX) this.sideRun = true;
    // The side-on run's warp: the forward run (jog or run by speed, below), its legs turned onto the way it goes.
    const sideWarp = qd * (Math.PI / 2) * move;
    if (this.sideRun) {
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
      this.warpOff += this.sideRun ? sideWarp - this.strafeWarp(qd, move) : this.warp - sideWarp;
      // The run's posture differs from the strafe's by a few degrees in every joint, under the limits: carried over.
      this.inertia.force = true;
    }
    {
      const lim = WARP_SWITCH_RATE * this.dt, o = this.warpOff;
      this.warpOff = o > lim ? o - lim : o < -lim ? o + lim : 0;
      this.warp -= this.warpOff;
    }
    const run = smoothstep(2.6, 4.4, sp);
    const W = this.cycleW;
    W[0] = wf * (1 - run); W[1] = wf * run; W[2] = wl; W[3] = wb; W[4] = wr;
    // One shared phase: advance it by distance over the blended stride, capped so the legs never spin.
    let dist = 0, per = 0;
    const cy = this.clips.cycle;
    for (let i = 0; i < 5; i++) { dist += W[i]! * cy[i]!.speed * cy[i]!.duration; per += W[i]! * cy[i]!.duration; }
    const freq = Math.min(sp / Math.max(dist, 1e-3), 1.7 / Math.max(per, 1e-3));
    this.phase = (this.phase + freq * dt) % 1;
    this.idleClock += dt;

    const acc = this.pose;
    const tmp = this.tmp;
    acc.clear();
    if (move < 1) {
      tmp.t = this.idleClock;
      sampleClip(this.clips.idle, tmp);
      tmp.w = 1 - move;
      accumulate(acc, tmp);
    }
    for (let i = 0; i < 5; i++) {
      const w = W[i]! * move;
      if (w < 0.002) continue;
      tmp.t = this.phase;
      sampleCycle(cy[i]!, tmp);
      tmp.w = w;
      accumulate(acc, tmp);
    }
    normalize(acc);
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
    const cut = rx * rx + rz * rz > 0.25;
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
    let want = this.addr ? 1 : this.on ? 0.85 * (1 - smoothstep(3.6, 5.2, Math.sqrt(this.vx * this.vx + this.vz * this.vz))) : 0;
    if (want < this.tapW) want = this.tapW;
    // Walking back: the racket carried (CARRY), not swung with the arms; eased in and out (carryW).
    this.carryW += ((placed ? 0 : 1) - this.carryW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.2) : 0);
    if (this.carryW < 0.001) this.carryW = 0;
    if (want < CARRY_W * this.carryW) want = CARRY_W * this.carryW;
    this.ready += (want - this.ready) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.18) : 0);
    this.addrW += ((this.addr ? 1 : 0) - this.addrW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.1) : 0);
    this.mixReady();
    if (this.carryW > 0.001) this.mixKey(this.carryMix, this.handed > 0 ? CARRY : CARRY_LEFT, this.carryW, this.outCarry);
    if (this.tapW > 0.001) this.mixKey(this.tapMix, this.handed > 0 ? TAP : TAP_LEFT, this.tapW, this.outTap);
    const sq = Math.max(this.w, this.ready * this.addrW);
    // (a contrapared is played facing the player's own back glass)
    const face = this.fam.glass ? net + Math.PI : net;
    this.yaw = p.facing + wrapAngle(face - this.hand * this.handed * WALL_TURN * this.wall - p.facing) * sq;
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
    const turn = this.kyaw * this.w + this.readyKey.yaw * this.ready * (1 - this.w);
    const btTo = this.w > 0.01 ? this.fam.bodyTurn ?? BODY_TURN : this.addr ? SERVE_TURN_SHARE : BODY_TURN;
    this.bt += (btTo - this.bt) * (dt > 0 && !cut ? 1 - Math.exp(-dt / 0.12) : 1);
    this.chestTurn = turn;
    const yRoot = ys + turn * this.bt;
    this.root.rotation.y = yRoot;

    this.yRoot = yRoot;
    this.locomote(p);
    this.reaction(sim, idx, t);
    this.splitStep(p, t);
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
      const wa = this.warp;
      const want = wa > WARP_SPINE_MAX ? wa - WARP_SPINE_MAX : wa < -WARP_SPINE_MAX ? wa + WARP_SPINE_MAX : 0;
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
    if (this.w > 0 || turn !== 0) {
      const spineTurn = (turn * (1 - this.bt)) / 3;
      const lean = Math.min(0.4, this.crouch * 1.2) / 3;
      q1.setFromAxisAngle(AXIS_Y, spineTurn);
      q2.setFromAxisAngle(AXIS_X, lean);
      for (let k = 0; k < 3; k++) this.spine[k]!.quaternion.multiply(q1).multiply(q2);
    }
    // The clip pose (locomotion, reactions, the shoulder turn) carried on smoothly through any jump, before IK.
    if (this.inertial && (Avatar.inertMask & 1) !== 0) this.inertia.apply(this.bones, this.hips.position, this.inertiaSkip);
    this.root.updateMatrixWorld(true);

    // The server's free hand holds the ball, and goes down with it as it is pushed into the turf.
    const on = this.on;
    if (this.addr) {
      const b = sim.ball;
      if (sim.phase === PH_SETUP) this.inHand = true;
      else if (b.pos.y < 0.75 || b.vel.y >= 0) this.inHand = false;
      if (this.inHand) { v1.set(b.pos.x, b.pos.y, b.pos.z); this.toModel(v1, this.addrKey.off); }
    }

    const watch = on || (this.addr && sim.phase === PH_TOSS);
    this.look += ((watch ? 1 : 0) - this.look) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 0);
    if (this.look >= 0.01) this.watchBall(sim);

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
      this.racketQOk = false;
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
  }

  /** The face's inputs from the stroke, the run, the point and the ball, then its keys (face.ts). */
  private updateFace(sim: MatchSim, p: Player, t: number, dt: number): void {
    const f = this.faceIn;
    f.toContact = this.st === ST_SWING ? this.tCon - t : this.st === ST_PREP && this.hasCon ? p.contactTime - t : Infinity;
    if (f.toContact < 0) f.toContact = Infinity;
    f.sinceContact = p.lastContactTime > 0 && p.lastContactTime <= t ? t - p.lastContactTime : -1;
    const fam = this.fam;
    f.strain = fam === SMASH ? 1 : fam === OVERHEAD || fam === VIBORA ? 0.8 : fam === SERVE ? 0.7 : fam.punch < 1 ? 0.45 : 0.65;
    f.grunt = fam === SMASH || fam === SERVE;
    // Out of breath: the run's pace averaged over about 6 s, from a brisk 3 m/s up.
    const sp = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    this.puff += (Math.min(1, Math.max(0, (sp - 1.2) / 3)) - this.puff) * (dt > 0 ? 1 - Math.exp(-dt / 6) : 0);
    f.puff = sim.phase === PH_RALLY ? this.puff * 0.4 : this.puff;
    f.mood = this.react === this.clips.celebrate ? 1 : this.react === this.clips.dejected ? -1 : 0;
    f.moodT = t - this.reactStart;
    // The ball from between the eyes, in the head's own frame (+z ahead, +x its left, +y up).
    const hm = this.head.matrixWorld;
    v1.copy(this.eyeInHead).applyMatrix4(hm);
    const b = sim.ball.pos;
    v2.x = b.x - v1.x; v2.y = b.y - v1.y; v2.z = b.z - v1.z;
    worldQuat(this.head, q1).multiply(this.headRestInv).invert();
    v2.applyQuaternion(q1);
    const w = this.look;
    f.gazeYaw = Math.atan2(v2.x, v2.z) * w;
    f.gazePitch = Math.atan2(v2.y, Math.sqrt(v2.x * v2.x + v2.z * v2.z)) * w;
    this.face!.update(dt, f);
  }

  /** `feet`: where each sole's lowest point is now. */
  private measureFeet(): void {
    for (let f = 0; f < 2; f++) {
      const foot = (f === 0 ? this.legL : this.legR)[2]!;
      this.footA.setFromMatrixPosition(foot.matrixWorld);
      worldQuat(foot, this.footQ);
      this.soleLow(f, this.footA, this.footQ);
      this.feet[f * 3] = this.footA.x;
      this.feet[f * 3 + 1] = this.low1;
      this.feet[f * 3 + 2] = this.footA.z;
    }
  }

  /** The ready pose: the serve's address, the plain ready position, or on the way between them (addrW). */
  private mixReady(): void {
    const rk = this.handed > 0 ? READY : READY_LEFT;
    const a = this.addrW;
    if (a >= 0.999) { this.readyKey = this.addrKey; return; }
    if (a <= 0.001) { this.readyKey = rk; return; }
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
   * each other, for TAP_HOLD s, each turns towards the other with the racket up in front (TAP).
   */
  private racketTap(sim: MatchSim, idx: number, p: Player, dt: number): void {
    let want = 0;
    if (sim.doubles && sim.walking === 1) {
      const q = sim.players[idx ^ 2]!;
      const mx = q.pos.x - p.pos.x, mz = q.pos.z - p.pos.z;
      if (mx * mx + mz * mz < TAP_NEAR * TAP_NEAR) {
        this.tapT += dt;
        want = this.tapT < TAP_HOLD ? 1 : 0;
        // (facing f looks along (-sin f, -cos f))
        this.tapYaw = Math.atan2(-mx, -mz);
      }
    } else this.tapT = 0;
    this.tapW += (want - this.tapW) * (dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0);
    if (this.tapW < 0.001) this.tapW = 0;
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
    const dt = this.dt;
    // The forward swing (it starts during the charge, timed to the plan) moves fast by design.
    const fast = (this.st === ST_SWING && t < this.tCon + 0.03) || (this.st === ST_PREP && this.swingS > 0);
    const keep = this.st === ST_SWING && t < this.tCon ? (this.tCon - t) / (this.tCon - t + dt) : 1;
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
   * Turn the neck and head to watch the ball, as far as a neck turns from the chest. Facings are read off the
   * bones themselves (the clip may already have the head turned), so this only adds what is missing.
   */
  private watchBall(sim: MatchSim): void {
    const b = sim.ball.pos;
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

  /** Reaction clips on the upper body while the ball is dead after a point. */
  private reaction(sim: MatchSim, idx: number, t: number): void {
    const phase = sim.phase;
    if (phase === PH_DEAD && this.lastPhase !== PH_DEAD) {
      const won = sim.pointWinner;
      this.react = null;
      if (won >= 0 && sim.lastStrikePlayer === idx) {
        const mine = (idx & 1) === won;
        this.react = mine ? this.clips.celebrate : this.clips.dejected;
        this.reactFrom = mine ? 0.4 : 0.9;
        this.reactStart = t;
      }
    }
    this.lastPhase = phase;
    if (!this.react) return;
    const rt = t - this.reactStart;
    // (it carries on into the walk back, which starts 1.2 s after the point)
    const live = phase === PH_DEAD || sim.walking > 0;
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
   * The smash's hop (JUMP_MAX): taken off so that it peaks at the contact, as high as the ball is above the toes'
   * reach then (a late take-off flies lower to peak on time), held whatever the plan does next, and landed on bent
   * knees. Adds to lift and splitDrop (after splitStep). The feet leave their locks as the clip's soles leave the floor.
   */
  private smashJump(t: number): void {
    if (this.jumpT0 >= 0) {
      const u = (t - this.jumpT0) / this.jumpT;
      if (u >= 0 && u < 1) { this.lift += 4 * this.jumpH * u * (1 - u); return; }
      this.landAt = u >= 1 ? this.jumpT0 + this.jumpT : -1;
      this.jumpT0 = -1;
    }
    if (this.landAt >= 0) {
      const v = (t - this.landAt) / LAND_TIME;
      if (v >= 0 && v < 1) this.splitDrop += LAND_DROP * Math.sin(Math.PI * v);
      else this.landAt = -1;
    }
    if (this.fam !== SMASH) return;
    const tc = this.st === ST_SWING ? this.tCon : this.st === ST_PREP && this.hasCon ? this.tPlan : -1;
    if (tc < 0 || t >= tc) return;
    const h = Math.min(JUMP_MAX, this.upNeed - JUMP_TOES);
    if (h < 0.03) return;
    const T = 2 * Math.sqrt((2 * h) / 9.81);
    if (t < tc - T / 2) return;
    const T2 = Math.min(T, 2 * (tc - t));
    this.jumpT = T2;
    this.jumpH = (9.81 * T2 * T2) / 8;
    this.jumpT0 = t;
    this.landAt = -1;
  }

  /** Crouch and lunge: lower the hips (and push them towards a ball out of reach) with the feet kept planted. */
  private solveLegs(): void {
    // How far the arm would fall short of where the key puts the wrist: the hips go that way (up to 40 cm out,
    // down up to 30 cm for a ball below the shoulder, the knees taking the drop; up to 12 cm for one above
    // the reach, onto the toes or off the ground). Before the contact, the contact's key: the same at the ball, and
    // steady before it (the swinging key moves at racket speed, and the hips followed it, up to 29 cm in a frame).
    const before = (this.st === ST_PREP && this.hasCon) || (this.st === ST_SWING && this.lastT < this.tCon);
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
    const short = len > 1e-3 ? Math.max(0, len - this.armLen * 0.96) * this.w * lean : 0;
    // How far above the arm's reach the contact is, whole (the smash's hop is decided before the lean is in).
    this.upNeed = before && len > 1e-3 && dy > 0 ? (Math.max(0, len - this.armLen * 0.96) * dy) / len : 0;
    const dh = Math.sqrt(dx * dx + dz * dz);
    const push = dh > 1e-3 ? Math.min(0.4, (short * dh) / len) : 0;
    let rx = dh > 1e-3 ? (dx / dh) * push : 0;
    let rz = dh > 1e-3 ? (dz / dh) * push : 0;
    // Before the contact the target is steady, and its limit only smooths a new plan in (the reach must be whole by
    // the contact: it is what puts the racket on the ball).
    if (this.dt > 0) {
      const ex = rx - this.reachX, ez = rz - this.reachZ;
      const e = Math.sqrt(ex * ex + ez * ez), lim = (before ? REACH_RATE_BEFORE : REACH_RATE) * this.dt;
      if (e > lim) { rx = this.reachX + (ex * lim) / e; rz = this.reachZ + (ez * lim) / e; }
    }
    this.reachX = rx;
    this.reachZ = rz;
    const down = dy < 0 ? Math.min(0.3, (short * -dy) / len) * DOWN_SHARE : 0;
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
    let drop = Math.min(DROP_MAX, crouch + push * 0.35 + down + this.splitDrop) - (dy > 0 ? Math.min(0.12, (short * dy) / len) : 0);
    // Up out of a low reach no faster than a body stands up from a lunge: the reach follows the stroke's key, which
    // swings up and in after the contact, and the hips came up 0.19 m in four frames.
    if (this.dt > 0 && drop < this.dropShown - HIP_RISE * this.dt) drop = this.dropShown - HIP_RISE * this.dt;
    // Down no faster than a body drops into a lunge: the contact's key jumps when the contact is replanned at the
    // release (an overhead planned at 2.0 m taken at 1.2 m), and the hips fell 20-30 cm in a frame, the knees 50-97°.
    if (this.dt > 0 && drop > this.dropShown + HIP_FALL * this.dt) drop = this.dropShown + HIP_FALL * this.dt;
    // Never lower than a deep lunge, thigh level (the drop and the reach together put the hip joints 0.28 m off the
    // floor, the legs folded flat and turning over).
    const room = this.hips.matrixWorld.elements[13]! - HIP_FLOOR;
    if (drop > room) drop = room > 0 ? room : drop < 0 ? drop : 0;
    this.dropShown = drop;
    const plant = this.plantW >= 0.01;
    const pushed = Math.abs(this.reachX) + Math.abs(this.reachZ);

    this.footL.setFromMatrixPosition(this.legL[2]!.matrixWorld);
    this.footR.setFromMatrixPosition(this.legR[2]!.matrixWorld);
    worldQuat(this.legL[2]!, this.footQL);
    worldQuat(this.legR[2]!, this.footQR);
    this.measureSoles();
    const fx0 = this.footL.x, fz0 = this.footL.z, gx0 = this.footR.x, gz0 = this.footR.z;
    if ((Avatar.feetMask & 1) !== 0) this.lockFeet();
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
    const moved = Math.abs(this.footL.x - fx0) + Math.abs(this.footL.z - fz0) + Math.abs(this.footR.x - gx0) + Math.abs(this.footR.z - gz0);
    if (drop < 0.005 && drop > -0.005 && pushed < 0.005 && !plant && !lifted && moved < 1e-4 && this.lockOn[0] === 0 && this.lockOn[1] === 0) {
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
    this.hips.position.x += this.reachX * c - this.reachZ * s;
    this.hips.position.z += this.reachX * s + this.reachZ * c;
    this.hips.position.y -= drop;
    this.hips.updateMatrixWorld(true);
    // Knees bend the way the clip bends them.
    for (let side = 0; side < 2; side++) {
      const leg = side === 0 ? this.legL : this.legR;
      const bd = side === 0 ? bendL : bendR;
      // An ankle no nearer its hip than LEG_FOLD of the leg: with the hips low, a lifted foot left at the clip's
      // height folded the leg flat, the knee down at the ankle (where its side is undefined). Lowered, not moved.
      const A = side === 0 ? this.footL : this.footR;
      const mh = leg[0]!.matrixWorld.elements;
      // The pole: the clip's bend direction out from the middle of the hip-to-ankle line as it is now. Out from the
      // clip's own knee it carried where the clip had the foot: a foot put down elsewhere (a step released in front
      // while backpedalling with the hips low) took the pole across the leg and the knee swung round 150-165 degrees
      // over a tenth of a second (14 times in 24 seeds both ways x 120 s; none since).
      this.pole.set((mh[12]! + A.x) * 0.5 + bd.x * 0.8, (mh[13]! + A.y) * 0.5 + bd.y * 0.8, (mh[14]! + A.z) * 0.5 + bd.z * 0.8);
      const fx = A.x - mh[12]!, fy = A.y - mh[13]!, fz = A.z - mh[14]!;
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
      twoBoneIK(leg[0]!, leg[1]!, leg[2]!, A, this.pole, side === 0 ? this.kneeL : this.kneeR, side === 0 ? this.kneeSideL : this.kneeSideR);
      setWorldQuat(leg[2]!, side === 0 ? this.footQL : this.footQR);
      leg[2]!.updateMatrixWorld(true);
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

  /** soleLow's result (a field: a double returned from a call that isn't inlined is boxed). */
  private low1 = 0;
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
      if (vs.y < low) low = vs.y;
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
    const drift = LOCK_DRIFT + (STEP_DIST - LOCK_DRIFT) * s;
    const turnMax = LOCK_YAW + (STEP_YAW - LOCK_YAW) * s;
    // Lunge: a stroke's contact wide of the racket shoulder moves where the foot on that side wants to be. Only
    // with the feet planted (running, the gait does the reaching: a swinging foot sent 0.55 m out at a sprint came
    // back in a frame), and shared between the feet as the ball goes round in front or behind (picking one foot by
    // the side the ball is on moved the whole lunge to the other foot in a frame, the knee turning 177 degrees).
    // Held through the stroke's fade as its weight goes (dropped at the fade's first frame, a foot mid-step jumped
    // 0.55 m back), and each foot's offset moves no faster than LUNGE_RATE.
    const LO = this.lungeOff;
    let wlx = 0, wlz = 0, wrx = 0, wrz = 0;
    if (this.hasCon && (this.st === ST_PREP || this.st === ST_SWING || this.st === ST_FADE) && s > 0.01) {
      const sh = this.armRacket[0]!.matrixWorld.elements;
      const dx = this.conW.x - sh[12]!, dz = this.conW.z - sh[14]!;
      const d = Math.max(1e-6, Math.sqrt(dx * dx + dz * dz));
      // A low ball steps the foot towards it too, so the body goes down into a lunge (front knee bent, the back one
      // low) rather than a squat over feet at standing width (every ball under 0.6 m was met in a full squat).
      const wide = Math.max(0, d - LUNGE_FROM) * 1.3, low = LUNGE_LOW * smoothstep(0.95, 0.45, this.conW.y);
      const out = Math.min(LUNGE_MAX, wide > low ? wide : low) * s * (this.st === ST_FADE ? this.w : 1);
      if (out > 0.04) {
        // The model's left (+x) in world: which side of the body the ball is on, as a share.
        const lw = smoothstep(-0.35, 0.35, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d);
        const ox = (dx / d) * out, oz = (dz / d) * out;
        wlx = ox * lw; wlz = oz * lw;
        wrx = ox * (1 - lw); wrz = oz * (1 - lw);
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
        const px = A.x - hip[12]! - this.reachX, py = A.y - hip[13]! + this.dropShown, pz = A.z - hip[14]! - this.reachZ;
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
        const snap = far > STEP_SNAP * STEP_SNAP;
        // From the hip as it will be, after the drop (measured from the clip's hip, standing taller, a held lunge was
        // always out of reach: the foot let go and stepped back to the same place, over and over), with or without the
        // reach towards the ball, whichever is nearer: the reach brings a lunging foot's hip over it, and takes it
        // away from the back foot, which stays planted as the body leans (released, it stepped mid-lunge and the
        // knee spun round over the next frames).
        const hip = (f === 0 ? this.legL : this.legR)[0]!.matrixWorld.elements;
        const hx = L.x - hip[12]!, hy = A.y - hip[13]! + this.dropShown, hz = L.z - hip[14]!;
        const hx2 = hx - this.reachX, hz2 = hz - this.reachZ;
        const d2 = Math.min(hx * hx + hz * hz, hx2 * hx2 + hz2 * hz2) + hy * hy;
        const reach = this.legLen * 0.985;
        const lifted = low > LOCK_OFF;
        const turned = Math.abs(wrapAngle(yaw - this.lockYaw[f]!));
        const forced = far > drift * drift || turned > turnMax || d2 > reach * reach;
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
        let t = this.relT[f]! + this.dt / this.relDur[f]!;
        if (t >= 1) t = -1;
        this.relT[f] = t;
        if (t >= 0) {
          const e = smoothstep(0, 1, t);
          const F = this.relFrom[f]!;
          A.x = F.x + (A.x - F.x) * e;
          A.z = F.z + (A.z - F.z) * e;
          if (this.relLift[f] === 1) A.y += STEP_LIFT * Math.sin(Math.PI * t);
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
   * Keep the racket out of the torso and the head: a key placed for a standing body, a backhand volley at the body
   * or a follow-through with the trunk bent over a low ball put the frame through the chest and the face (2-3% of
   * frames). The deepest racket point inside a capsule (plus RACKET_CLEAR) moves the hand straight out by that much
   * from where it is, the racket keeping its rotation, and the arm is solved again. The hand's world rotation is q3.
   */
  private racketClear(ua: THREE.Bone, fa: THREE.Bone, hand: THREE.Bone): void {
    const G = this.guardBones, Rr = this.guardR, B = this.bones;
    const m = this.racket.matrixWorld.elements;
    // The racket moves with the hand, so the push is found on the racket moved by it (vx, vy, vz), then the arm is
    // solved once (each solve may turn the elbow's side by its frame's allowance).
    let vx = 0, vy = 0, vz = 0;
    for (let it = 0; it < 3; it++) {
      // Every point inside, each pushing straight out by its depth: the deepest's depth along the sum's direction
      // (the deepest alone jumped between points and capsules, the forearm with it).
      let best = 0, sx2 = 0, sy2 = 0, sz2 = 0;
      for (let r = 0; r < RACKET_P.length; r += 3) {
        const lx = RACKET_P[r]!, ly = RACKET_P[r + 1]!, lz = RACKET_P[r + 2]!;
        const px = m[0]! * lx + m[4]! * ly + m[8]! * lz + m[12]! + vx;
        const py = m[1]! * lx + m[5]! * ly + m[9]! * lz + m[13]! + vy;
        const pz = m[2]! * lx + m[6]! * ly + m[10]! * lz + m[14]! + vz;
        for (let k = 0; k < Rr.length; k++) {
          const ea = B[G[2 * k]!]!.matrixWorld.elements, eb = B[G[2 * k + 1]!]!.matrixWorld.elements;
          const ax = ea[12]!, ay = ea[13]!, az = ea[14]!;
          const sx = eb[12]! - ax, sy = eb[13]! - ay, sz = eb[14]! - az;
          const l2 = sx * sx + sy * sy + sz * sz;
          let u = l2 > 1e-12 ? ((px - ax) * sx + (py - ay) * sy + (pz - az) * sz) / l2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = px - ax - sx * u, dy = py - ay - sy * u, dz = pz - az - sz * u;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const pen = Rr[k]! + RACKET_CLEAR - d;
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
    hingeIK(ua, fa, hand, this.tgt, this.pole, this.elbowRacket);
    setWorldQuat(hand, q3);
    hand.updateMatrixWorld(true);
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
    // Where the animation has the racket, pulled to the ready position, then to the stroke's key (world).
    this.racket.updateMatrixWorld();
    v1.setFromMatrixPosition(this.racket.matrixWorld);
    worldQuat(this.racket, q1);
    alignQ(q1, this.prevFkQ);
    if (this.ready > 0) {
      this.toWorld(ready.p, v2);
      this.quatToWorld(ready.q, q2);
      alignQ(q2, this.prevReadyQ);
      BL.u = this.ready;
      lerpV(v1, v2);
      nlerpQ(q1, q2, this.outReady);
    }
    this.toWorld(this.kp, v2);
    if (this.finishU > 0) {
      // The follow-through's keys are placed for a standing body: when the hips are still low after a low ball (they
      // rise no faster than HIP_RISE) the finish went into the chest and the head. It goes with the shoulder.
      const mr = ua.matrixWorld.elements, u = this.finishU;
      v2.x += (mr[12]! - this.racketSh.x) * u; v2.y += (mr[13]! - this.racketSh.y) * u; v2.z += (mr[14]! - this.racketSh.z) * u;
    }
    this.quatToWorld(this.kq, q2);
    alignQ(q2, this.prevKeyQ);
    BL.u = w;
    lerpV(v1, v2);
    nlerpQ(q1, q2, this.outKey);
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
    const excess = Math.sqrt(sx * sx + sy * sy + sz * sz) - this.armLen * 0.98;
    const base = this.spine[0]!;
    this.leanT.identity();
    if (excess > 0) {
      const mb = base.matrixWorld.elements;
      const ax = mu[12]! - mb[12]!, ay = mu[13]! - mb[13]!, az = mu[14]! - mb[14]!;
      const bx = this.tgt.x - mb[12]!, by = this.tgt.y - mb[13]!, bz = this.tgt.z - mb[14]!;
      const al = Math.sqrt(ax * ax + ay * ay + az * az), bl = Math.sqrt(bx * bx + by * by + bz * bz);
      const cs = (ax * bx + ay * by + az * bz) / Math.max(al * bl, 1e-9);
      const ang = Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs);
      const phi = Math.min(ang, excess / Math.max(al, 0.1), SPINE_REACH) * smoothstep(SPINE_REACH_BACK1, SPINE_REACH_BACK0, ang);
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
      const ang = 2 * Math.acos(d), lim = SPINE_REACH_RATE * this.dt;
      if (ang > lim) LN.slerp(LT, lim / ang);
      else LN.copy(LT);
    } else LN.copy(LT);
    this.leanOk = true;
    if (LN.w < 0.99999985) {
      rotateWorld(base, LN);
      base.updateMatrixWorld(true);
    }
    v3.copy(ready.pole);
    BL.u = w;
    lerpV(v3, this.kpole);
    this.toWorld(v3, this.pole);
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
    hingeIK(ua, fa, hand, this.tgt, this.pole, this.elbowRacket);
    setWorldQuat(hand, q3);
    hand.updateMatrixWorld(true);
    this.racketClear(ua, fa, hand);
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
    if (this.ready > 0) {
      this.toWorld(ready.off, v2);
      v2.x += fx; v2.y += fy; v2.z += fz;
      BL.u = this.ready;
      lerpV(v1, v2);
    }
    this.toWorld(this.koff, v2);
    v2.x += fx; v2.y += fy; v2.z += fz;
    BL.u = w * 0.85;
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
    this.keepOff(ul, v1, this.elbowFree.dir);
    hingeIK(ul, fl, hl, v1, this.pole, this.elbowFree);
    // Fade into the clip's arms below ARM_FADE of weight: the hinge solve has its own elbow side and upper-arm roll,
    // so at a weight of 0.01 the arm was still far from the clip's and went back to it in a frame when the arms
    // switched off (the free arm 55-72 degrees, between points; QA army).
    this.fadeArm(this.armRacket, 0, smoothstep(0.01, ARM_FADE, Math.max(this.ready, w)));
    this.fadeArm(this.armFree, 3, smoothstep(0.01, ARM_FADE, Math.max(this.ready, w * 0.85)));
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
