// One player's body: the Y Bot skinned mesh, driven by blended Mixamo locomotion, with the strokes made in code
// (key poses in strokes.ts, reached with two-bone IK and timed so the racket meets the ball at the sim's contact
// moment) and the racket in the right hand. Reads the sim only. Allocation-free per frame.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../../sim/match.ts';
import { PH_DEAD, PH_RALLY, PH_SETUP, PH_TOSS } from '../../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../../sim/player/player.ts';
import { MOD_POWER, MOD_PRECISION, SHOT_DRIVE, SHOT_DROP, SHOT_LOB, SHOT_SLICE, SHOT_SMASH, SHOT_TOPSPIN } from '../../sim/contact/shots.ts';
import type { StandPlan } from '../../sim/player/positioning.ts';
import { DT } from '../../sim/core/constants.ts';
import type { Clip, PlayerAsset } from './asset.ts';
import { Pose, accumulate, blendMasked, normalize, sampleClip, sampleCycle } from './pose.ts';
import { hingeIK, IK_TURN, rotateWorld, setWorldQuat, twoBoneIK, worldQuat } from './ik.ts';
import type { HingeLimb } from './ik.ts';
import { INERT_DT, Inertializer, InertN, InertQ } from './inertia.ts';
import { fitSoles, type SolePoint } from './soles.ts';
import {
  BACKHAND, BH_CHIQUITA, BH_DROP, BH_LOB, BH_SLICE, FH_CHIQUITA, FH_DROP, FH_LOB, FH_SLICE, FOREHAND, OVERHEAD, READY, READY_LEFT, SERVE, SERVE_ADDRESS, SERVE_ADDRESS_LEFT, SERVE_TURN_SHARE, SMASH, VOLLEY_BH, VOLLEY_FH,
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
  out.set(bx, by, bz);
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
 * An elbow's hinge, measured from the clips: the axis (forearm frame) of the forearm's turn from its rest rotation,
 * averaged over every clip frame bent more than 20 degrees (on the Y Bot it is the forearm's z, within a degree).
 * The knees stay on twoBoneIK: the clips turn the shin about 10 degrees off any one axis and run with the legs
 * nearly straight, and solving them as hinges threw that away and tripled the pops (measured).
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
  return { hinge: acc.normalize(), rest, side: new THREE.Vector3(), dir: new THREE.Vector3() };
}

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
/** Most the hips drop for a low or wide ball (crouch, lunge and reach together; m). */
const DROP_MAX = 0.55;
const FOLLOW = 0.3;
const FADE = 0.35;
const PREP = 0.28;
/** Share of the shoulder turn taken by the whole body (the rest is the spine). */
const BODY_TURN = 0.35;
/** Extra turn to the racket side while the ball goes past to the glass (rad), and how fast it comes and goes (s). */
const WALL_TURN = 1.0;
const WALL_EASE = 0.2;
/** How far the head turns from the chest to watch the ball (rad), and the neck's share of it. */
const LOOK_YAW = 1.25;
const NECK_SHARE = 0.4;
/**
 * Standing or shuffling slowly the feet stay planted while the body turns and drifts over them, and a foot steps
 * (one at a time, lifted, over STEP_TIME) once it is this far (m) or this turned (rad) from where the animation
 * wants it. Further than STEP_SNAP (a teleport between points) the feet just go there.
 */
const STEP_DIST = 0.13;
const STEP_YAW = 0.55;
const STEP_TIME = 0.15;
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
/** Locomotion: how close to halfway between two directions (a quarter turn = 1) their clips cross-fade. */
const WARP_BAND = 0.1;

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

/** Fingers of the racket hand ('Right' or 'Left' in front), curled round the grip (rad, per joint). */
const GRIP: Array<[string, number]> = [
  ['HandIndex1', 0.95], ['HandIndex2', 1.2], ['HandIndex3', 0.8],
  ['HandMiddle1', 1.1], ['HandMiddle2', 1.3], ['HandMiddle3', 0.85],
  ['HandRing1', 1.2], ['HandRing2', 1.3], ['HandRing3', 0.85],
  ['HandPinky1', 1.3], ['HandPinky2', 1.25], ['HandPinky3', 0.85],
  ['HandThumb1', 0.3], ['HandThumb2', 0.45], ['HandThumb3', 0.35],
];

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
}

export function makeRacket(): THREE.Group {
  const racket = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.03, 24),
    new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.4, metalness: 0.2 }),
  );
  face.rotation.x = Math.PI / 2;
  face.scale.set(1, 1, 1.12);
  face.castShadow = true;
  racket.add(face);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  );
  handle.position.y = -0.24;
  handle.castShadow = true;
  racket.add(handle);
  return racket;
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
  /** Toes: their local rotation while locked (they don't bend over the floor either), and at the release. */
  private readonly toes: THREE.Bone[];
  private readonly lockToe = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly relToe = [new THREE.Quaternion(), new THREE.Quaternion()];
  /** Bits: 1 foot locks, 2 soles kept above the floor (for comparisons). */
  static feetMask = 3;
  private readonly cycleW = new Float64Array(5);
  /** Orientation warp (rad): how far the legs turn from the playing clip's direction onto the body's travel. */
  private warp = 0;
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
  private readonly lean = new THREE.Quaternion();
  /** The free shoulder before the hips drop and push and the spine leans (world): its keys move with the trunk. */
  private readonly freeSh = new THREE.Vector3();
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

  constructor(asset: PlayerAsset, color: number) {
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
    const mat = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.55, metalness: 0.05 });
    this.mesh = new THREE.SkinnedMesh(asset.geometry, mat);
    this.mesh.add(this.bones[0]!);
    this.mesh.bind(new THREE.Skeleton(this.bones, asset.boneInverses), new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

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
    this.grips = [this.makeGrip(asset, 'Right', 1), this.makeGrip(asset, 'Left', -1)];
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

  /** The grip for one hand; `hs` is +1 for the right, -1 for the left (the mirror image). */
  private makeGrip(asset: PlayerAsset, side: string, hs: number): Grip {
    // The hand's frame at rest (T-pose): fingers F, thumb side T, palm normal N.
    const rw = asset.restWorld;
    const at = (n: string, out: THREE.Vector3): THREE.Vector3 => out.setFromMatrixPosition(rw[asset.bone(side + n)]!);
    const hand = rw[asset.bone(side + 'Hand')]!;
    const ph = at('Hand', new THREE.Vector3());
    const F = at('HandMiddle1', new THREE.Vector3()).sub(ph).normalize();
    const T = at('HandThumb2', new THREE.Vector3()).sub(ph);
    T.addScaledVector(F, -T.dot(F)).normalize();
    const N = new THREE.Vector3().crossVectors(T, F).multiplyScalar(hs).normalize();
    // Handshake grip: the racket runs on from the hand, tilted 30 degrees to the thumb side, strings parallel
    // to the palm; the handle sits in the fist just off the palm, gripped 27 cm below the face centre.
    const A = F.clone().multiplyScalar(Math.cos(0.52)).addScaledVector(T, Math.sin(0.52)).normalize();
    const Nf = N.clone().addScaledVector(A, -N.dot(A)).normalize();
    const X = new THREE.Vector3().crossVectors(A, Nf);
    const origin = ph.clone().addScaledVector(F, 0.085).addScaledVector(N, 0.035).addScaledVector(A, 0.27);
    const mr = new THREE.Matrix4().makeBasis(X, A, Nf).setPosition(origin);
    const local = hand.clone().invert().multiply(mr);
    const g: Grip = {
      hand: this.bones[asset.bone(side + 'Hand')]!,
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), qInv: new THREE.Quaternion(),
      bones: [], quats: new Float32Array(GRIP.length * 4),
    };
    local.decompose(g.pos, g.q, v1);
    g.qInv.copy(g.q).invert();

    // Finger curl: about F x N in model space (moves a finger towards the palm; N is already the mirrored palm
    // normal for the left hand, which turns the axis the way a mirrored rotation needs), in each bone's frame.
    const K = new THREE.Vector3().crossVectors(F, N).normalize();
    GRIP.forEach(([name, ang], k) => {
      const i = asset.bone(side + name);
      const restW = new THREE.Quaternion();
      rw[i]!.decompose(v1, restW, v2);
      const axis = K.clone().applyQuaternion(restW.invert());
      const q = new THREE.Quaternion().fromArray(asset.bones[i]!.quat).multiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      g.bones.push(i);
      q.toArray(g.quats, k * 4);
    });
    return g;
  }

  /** Switch the racket hand (the sim's `handed`): racket, grip, arms and stroke keys all follow. */
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

  private pickFamily(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number): Family {
    const f = this.pickRight(sim, p, idx, c, overhead, volley, hand);
    return this.handed > 0 ? f : leftFamily(f);
  }

  /** The stroke for a right-hander (`hand` +1 forehand, -1 backhand). */
  private pickRight(sim: MatchSim, p: Player, idx: number, c: THREE.Vector3, overhead: boolean, volley: boolean, hand: number): Family {
    if (sim.phase <= PH_TOSS && sim.score.serverPlayer() === idx) return SERVE;
    // An AI holds power or precision only as it lets go: its intent says which overhead or topspin it is.
    const ai = sim.ai[idx];
    // While the key is held the modifiers being held say it; from the release on, the ones it was released with.
    const mod = p.swing === SW_CHARGE ? p.heldMod : p.mod;
    if (overhead || c.y > 1.8) return p.shot === SHOT_SMASH || mod === MOD_POWER || (ai !== null && ai !== undefined && ai.smash) ? SMASH : OVERHEAD;
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

  /** Contact key: the family's, at the ball, the racket head dropped for a low ball. */
  private contactKey(): Key {
    const k = this.con;
    const f = this.fam;
    if (this.hasCon) this.toModel(this.conW, k.p);
    else k.p.copy(f.contact.p);
    k.q.copy(f.contact.q);
    if (f.low) k.q.slerp(f.low, smoothstep(0.95, 0.4, k.p.y));
    k.pole.copy(f.contact.pole);
    k.yaw = f.contact.yaw;
    k.off.copy(f.contact.off);
    return k;
  }

  /** Forward swing at progress s (0 = end of the backswing, 1 = the ball), into the blended key. */
  private swingKey(s: number): void {
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
      this.predAt(sim, at, this.conW);
      return at;
    }
    this.known = false;
    const st = this.plan(sim, idx);
    if (!st.valid) return -1;
    // An AI lets go at its own release time (the window it tracks, its timing error included), and the release
    // is the contact: time the swing to that, at wherever the ball will be then.
    const ai = sim.ai[idx];
    if (ai && ai.pressed && !ai.released && ai.releaseAt > sim.time - 0.05) {
      this.known = true;
      this.predAt(sim, ai.releaseAt, this.conW);
      return ai.releaseAt;
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
      this.wallWant = st.valid && st.afterWall && this.swingS === 0 && sim.phase === PH_RALLY
        && sim.ball.pos.z * side > 0 && sim.ball.vel.z * side > 0.3 ? 1 : 0;
      if (this.swingS === 0) {
        // Re-aimed while the plan changes (the ball may cross to the other side); a change of stroke blends
        // over from wherever the racket is rather than jumping.
        if (!this.hasCon) this.conW.set(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
        const hand = st.valid ? st.hand : this.handOf(sim, p, this.conW);
        const fam = this.pickFamily(sim, p, idx, this.conW, st.valid && st.overhead, st.valid && st.volley, hand);
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
      if (this.hasCon && tp - t < lead) this.swingS = Math.max(this.swingS, Math.min(this.known ? 1 : HOVER, 1 - (tp - t) / lead));
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
        const fam = this.pickFamily(sim, p, idx, this.conW, !fresh && st.overhead, vol, fresh ? this.handOf(sim, p, this.conW) : st.hand);
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
      const u = smoothstep(0, PREP, t - this.prepStart);
      if (this.swingS > 0) this.swingKey(this.swingS);
      else this.setKey(f.back, f.back, 1);
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
      } else {
        this.setKey(f.finish, f.finish, 1);
        this.fadeOut(this.tCon + FOLLOW, 1);
      }
    }
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
    if (sp > 1e-3) {
      const q = Math.atan2(mx, mz) / (Math.PI / 2);
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

  // ---- per frame ----

  /** `t`: the interpolated sim time being drawn. Animation runs on its steps, in step with the sim. */
  update(sim: MatchSim, p: Player, idx: number, alpha: number, t: number): void {
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
    this.addr = sim.score.serverPlayer() === idx && (sim.phase === PH_SETUP || (sim.phase === PH_TOSS && sim.rally.hitter < 0));
    // Ready position while a point is on (and for the receiver waiting for the serve), not at a sprint; the server's
    // is the address. Decided before the stance, which it turns. A cut (players placed for the next point) starts in
    // the new point's pose, not on the way to it.
    this.on = sim.phase === PH_RALLY || ((sim.phase === PH_SETUP || sim.phase === PH_TOSS) && sim.score.serverPlayer() !== idx);
    const want = this.addr ? 1 : this.on ? 0.85 * (1 - smoothstep(3.6, 5.2, Math.sqrt(this.vx * this.vx + this.vz * this.vz))) : 0;
    this.ready += (want - this.ready) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.18) : 0);
    this.addrW += ((this.addr ? 1 : 0) - this.addrW) * (cut ? 1 : dt > 0 ? 1 - Math.exp(-dt / 0.1) : 0);
    this.mixReady();
    const sq = Math.max(this.w, this.ready * this.addrW);
    this.yaw = p.facing + wrapAngle(net - this.hand * this.handed * WALL_TURN * this.wall - p.facing) * sq;
    // The body turns no faster than a person turns (the sim faces the ball at once, even one that has just passed).
    if (this.inertial && (Avatar.inertMask & 4) !== 0) {
      this.yawI.in[0] = this.yaw;
      this.yawI.step();
      this.yaw = this.yawI.out[0]!;
    }
    this.dt = dt;
    IK_TURN[0] = dt > 0 ? ELBOW_SIDE_RATE * dt : Math.PI;
    const ys = this.yaw + Math.PI;
    this.stanceC = Math.cos(ys);
    this.stanceS = Math.sin(ys);
    this.stanceQ.setFromAxisAngle(UP, ys);
    this.updateStroke(sim, p, idx, t);
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
    this.root.position.y = this.lift;

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
    // Orientation warp: hips and legs (and the hips' sway) turned, the spine turned back.
    if (this.warp !== 0) {
      const wa = this.warp;
      q1.setFromAxisAngle(UP, wa);
      const hq = this.hips.quaternion;
      // spine' = hips^-1 * warp^-1 * hips * spine: the chest's world rotation unchanged.
      q2.copy(hq).invert();
      q3.copy(q1).invert().multiply(hq);
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
    this.solveLegs();
    if (this.w > 0 || this.ready >= 0.01) this.solveArms();
    else {
      this.elbowR.side.set(0, 0, 0); this.elbowL.side.set(0, 0, 0); this.elbowR.dir.set(0, 0, 0); this.elbowL.dir.set(0, 0, 0);
      this.outReady.set(0, 0, 0, 0); this.outKey.set(0, 0, 0, 0);
    }

    // The head after looking (the ball can move faster than a head turns).
    if (this.inertial && (Avatar.inertMask & 2) !== 0) {
      this.headInertia.apply(this.bones, null, this.headSkip);
      this.neck.updateMatrixWorld(true);
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

  private resetInertia(): void {
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
    this.lockOn.fill(0);
    this.relT.fill(-1);
    this.elbowR.side.set(0, 0, 0);
    this.elbowL.side.set(0, 0, 0);
    this.elbowR.dir.set(0, 0, 0);
    this.elbowL.dir.set(0, 0, 0);
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
    this.kp.set(P.out[0]!, P.out[1]!, P.out[2]!);
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
    this.kpole.set(L.out[0]!, L.out[1]!, L.out[2]!);
    const O = this.koffI;
    O.in[0] = this.koff.x; O.in[1] = this.koff.y; O.in[2] = this.koff.z;
    O.step();
    this.koff.set(O.out[0]!, O.out[1]!, O.out[2]!);
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
    const w = smoothstep(0, 0.2, rt) * (1 - smoothstep(1.25, 1.55, rt)) * (phase === PH_DEAD ? 1 : 0);
    if (rt > 1.6 || phase !== PH_DEAD) { this.react = null; return; }
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

  /** Crouch and lunge: lower the hips (and push them towards a ball out of reach) with the feet kept planted. */
  private solveLegs(): void {
    // How far the arm would fall short of where the key puts the wrist: the hips go that way (up to 40 cm out,
    // down up to 30 cm for a ball below the shoulder, the knees taking the drop; up to 12 cm for one above
    // the reach, onto the toes or off the ground).
    this.toWorld(this.kp, v1);
    this.quatToWorld(this.kq, q2);
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
    const short = len > 1e-3 ? Math.max(0, len - this.armLen * 0.96) * this.w : 0;
    const dh = Math.sqrt(dx * dx + dz * dz);
    const push = dh > 1e-3 ? Math.min(0.4, (short * dh) / len) : 0;
    this.reachX = dh > 1e-3 ? (dx / dh) * push : 0;
    this.reachZ = dh > 1e-3 ? (dz / dh) * push : 0;
    const down = dy < 0 ? Math.min(0.3, (short * -dy) / len) : 0;
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
    const drop = Math.min(DROP_MAX, crouch + push * 0.35 + down + this.splitDrop) - (dy > 0 ? Math.min(0.12, (short * dy) / len) : 0);
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
    if (drop < 0.005 && drop > -0.005 && pushed < 0.005 && !plant && !lifted && moved < 1e-4 && this.lockOn[0] === 0 && this.lockOn[1] === 0) return;
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
      v3.setFromMatrixPosition(leg[1]!.matrixWorld);
      this.pole.set(v3.x + bd.x * 0.8, v3.y + bd.y * 0.8, v3.z + bd.z * 0.8);
      twoBoneIK(leg[0]!, leg[1]!, leg[2]!, side === 0 ? this.footL : this.footR, this.pole);
      setWorldQuat(leg[2]!, side === 0 ? this.footQL : this.footQR);
      leg[2]!.updateMatrixWorld(true);
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
    // Lunge: a stroke's contact wide of the racket shoulder moves where the foot on that side wants to be.
    if (this.hasCon && (this.st === ST_PREP || this.st === ST_SWING)) {
      const sh = this.armRacket[0]!.matrixWorld.elements;
      const dx = this.conW.x - sh[12]!, dz = this.conW.z - sh[14]!;
      const d = Math.sqrt(dx * dx + dz * dz);
      const out = Math.min(LUNGE_MAX, Math.max(0, d - LUNGE_FROM) * 1.3);
      if (out > 0.04) {
        // The model's left (+x) in world: which side of the body the ball is on.
        const left = dx * Math.cos(yaw) - dz * Math.sin(yaw) > 0;
        const A = left ? this.footL : this.footR;
        A.x += (dx / d) * out;
        A.z += (dz / d) * out;
      }
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
        if (far > STEP_SNAP * STEP_SNAP) { this.lockOn[f] = 0; this.relT[f] = -1; continue; }
        const hip = (f === 0 ? this.legL : this.legR)[0]!.matrixWorld.elements;
        const hx = L.x - hip[12]!, hy = A.y - hip[13]!, hz = L.z - hip[14]!;
        const reach = this.legLen * 0.985;
        const lifted = low > LOCK_OFF;
        const forced = far > drift * drift || Math.abs(wrapAngle(yaw - this.lockYaw[f]!)) > turnMax || hx * hx + hy * hy + hz * hz > reach * reach;
        // Standing, one foot steps at a time (the other waits, still held).
        const o = 1 - f;
        const waits = !lifted && s > 0.5 && this.relLift[o] === 1 && this.relT[o]! >= 0;
        if (lifted || (forced && !waits)) {
          this.lockOn[f] = 0;
          this.relT[f] = 0;
          this.relFrom[f]!.copy(L);
          this.relQ[f]!.copy(this.lockQ[f]!);
          this.relToe[f]!.copy(this.lockToe[f]!);
          this.relLift[f] = lifted ? 0 : 1;
          this.relDur[f] = lifted ? LOCK_RELEASE : STEP_TIME;
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
          q1.copy(this.relQ[f]!).slerp(Q, e);
          Q.copy(q1);
          q1.copy(this.relToe[f]!).slerp(toe.quaternion, e);
          toe.quaternion.copy(q1);
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

  /** Racket arm to the key (blended with the animation by the stroke weight), free hand to its key. */
  private solveArms(): void {
    const w = this.w;
    const ua = this.armRacket[0]!, fa = this.armRacket[1]!, hand = this.armRacket[2]!;
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
    this.quatToWorld(this.kq, q2);
    alignQ(q2, this.prevKeyQ);
    BL.u = w;
    lerpV(v1, v2);
    nlerpQ(q1, q2, this.outKey);
    // Hand = racket rotation without the grip; wrist = racket centre minus the grip offset.
    q3.multiplyQuaternions(q1, this.grip.qInv);
    this.tgt.copy(this.grip.pos).applyQuaternion(q3);
    this.tgt.subVectors(v1, this.tgt);
    // Out of the arm's reach: bend the upper body towards it (up to 30 degrees), pivoting at the spine's base.
    const mu = ua.matrixWorld.elements;
    const sx = mu[12]! - this.tgt.x, sy = mu[13]! - this.tgt.y, sz = mu[14]! - this.tgt.z;
    const excess = Math.sqrt(sx * sx + sy * sy + sz * sz) - this.armLen * 0.98;
    if (excess > 0) {
      const base = this.spine[0]!;
      const mb = base.matrixWorld.elements;
      const ax = mu[12]! - mb[12]!, ay = mu[13]! - mb[13]!, az = mu[14]! - mb[14]!;
      const bx = this.tgt.x - mb[12]!, by = this.tgt.y - mb[13]!, bz = this.tgt.z - mb[14]!;
      const al = Math.sqrt(ax * ax + ay * ay + az * az), bl = Math.sqrt(bx * bx + by * by + bz * bz);
      const cs = (ax * bx + ay * by + az * bz) / Math.max(al * bl, 1e-9);
      const ang = Math.acos(cs < -1 ? -1 : cs > 1 ? 1 : cs);
      const phi = Math.min(ang, excess / Math.max(al, 0.1), 0.52);
      // Axis a x b.
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (phi > 1e-3 && cl > 1e-6) {
        v3.x = cx / cl; v3.y = cy / cl; v3.z = cz / cl;
        this.lean.setFromAxisAngle(v3, phi);
        rotateWorld(base, this.lean);
        base.updateMatrixWorld(true);
      }
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
    this.keepOff(ua, this.tgt, this.elbowRacket.dir);
    hingeIK(ua, fa, hand, this.tgt, this.pole, this.elbowRacket);
    setWorldQuat(hand, q3);
    hand.updateMatrixWorld(true);

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
  }
}
