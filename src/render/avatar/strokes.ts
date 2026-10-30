// Stroke key poses, authored by hand for a right-hander (Mixamo has no tennis or padel strokes).
//
// Model space: the character faces +z, +y up, +x is the character's LEFT (so the racket side is -x).
// Positions are of the racket face's centre, relative to the stance (between the feet, on the floor).
// Each key also gives the racket's long axis (handle to tip) and face normal (where the strings look), a point
// the elbow bends towards, the shoulder turn (yaw > 0 turns left), and where the free hand goes.
// The contact key's position is the ball; its other values come from the family.
import * as THREE from 'three/webgpu';

export interface Key {
  p: THREE.Vector3;
  /** Racket orientation (model space), from the long axis and face normal. */
  q: THREE.Quaternion;
  pole: THREE.Vector3;
  yaw: number;
  off: THREE.Vector3;
}

export interface Family {
  name: string;
  back: Key;
  contact: Key;
  finish: Key;
  /** Racket at a low contact (head dropped below the wrist); blended in by the ball's height. */
  low?: THREE.Quaternion;
  /** How far the forward swing dips below the straight line (m, + down) and swings out behind (m). */
  dip: number;
  loop: number;
  /** Crouch for low balls (0: none, overheads). */
  crouch: number;
  /** Shortest forward swing, as a share of the avatar's MIN_SWING (a volley is a quick punch). */
  punch: number;
  /** The hips' share of the shoulder turn (default the avatar's BODY_TURN). */
  bodyTurn?: number;
  /** How long before the planned contact the forward swing starts (s; default the avatar's LEAD). */
  lead?: number;
  /**
   * A point the forward swing passes through (model frame), at progress `viaS` of the swing's time: the curve's
   * bend is solved from it (instead of dip and loop), so the path keeps its shape wherever the contact is.
   */
  via?: THREE.Vector3;
  viaS?: number;
  /** Played facing the player's own back glass (the contrapared): the stance turns round to it. */
  glass?: boolean;
  /** How long the backswing takes (s; default the avatar's PREP). */
  prep?: number;
  /** How far the stroke stands the trunk up out of the idle's ready crouch (0..1; default none). */
  stand?: number;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Racket rotation whose +y is the long axis `a` and +z the face normal `n` (n is made perpendicular to a). */
export function racketQuat(a: THREE.Vector3, n: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const y = a.clone().normalize();
  const z = n.clone().addScaledVector(y, -n.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function key(p: THREE.Vector3, a: THREE.Vector3, n: THREE.Vector3, pole: THREE.Vector3, yaw: number, off: THREE.Vector3): Key {
  return { p, q: racketQuat(a, n), pole, yaw, off };
}

export const FOREHAND: Family = {
  name: 'forehand',
  back: key(v(-0.62, 1.12, -0.42), v(-0.25, 0.6, -0.75), v(-1, 0.05, -0.1), v(-0.55, 0.75, -0.55), -1.05, v(0.12, 1.25, 0.4)),
  contact: key(v(-0.75, 1.0, 0.45), v(-0.85, 0.12, 0.5), v(0.05, 0.08, 1), v(-0.45, 0.8, -0.15), 0.15, v(0.55, 1.12, 0.3)),
  finish: key(v(0.28, 1.55, 0.12), v(0.45, 0.35, -0.8), v(0.85, 0.1, 0.4), v(-0.15, 1.45, 0.45), 0.95, v(0.5, 1.1, -0.2)),
  low: racketQuat(v(-0.6, -0.74, 0.32), v(0.05, 0.3, 1)),
  dip: 0.28,
  loop: 0.1,
  crouch: 1,
  punch: 1,
};

/**
 * The padel backhand is played side-on (review round 3, the pro's #4): the racket-side shoulder to the net and the
 * shoulders turned about 90 degrees at the backswing, still about 70 at contact, and opening only to about 30 by the
 * finish. The free arm stays back. The hips take more of that turn than on the forehand (`bodyTurn`), so the feet
 * stand across. The old contact key had the shoulders 20 degrees turned, and the chest measured 13 degrees off
 * square at the hit: a push.
 */
export const BACKHAND: Family = {
  name: 'backhand',
  back: key(v(0.55, 1.12, -0.38), v(0.3, 0.6, -0.72), v(1, 0.05, -0.15), v(0.25, 1.05, 0.45), 1.55, v(0.42, 1.12, -0.12)),
  contact: key(v(0.72, 0.98, 0.42), v(0.85, 0.12, 0.5), v(-0.05, 0.08, 1), v(0.35, 0.95, 0.35), 1.25, v(0.55, 1.05, -0.35)),
  finish: key(v(-0.45, 1.5, 0.22), v(-0.5, 0.62, -0.58), v(-0.85, 0.15, 0.4), v(-0.2, 1.5, 0.45), 0.5, v(0.6, 1.1, -0.42)),
  bodyTurn: 0.6,
  low: racketQuat(v(0.6, -0.74, 0.32), v(-0.05, 0.3, 1)),
  dip: 0.22,
  loop: 0.05,
  crouch: 1,
  punch: 1,
};

/**
 * The overheads, one action each (docs/research/serve-and-strokes-motion.md §2.5-2.6, §4.2; review round 2 found
 * all of them sharing one square-on contact with only the finish apart).
 * Bandeja: side-on at the trophy (shoulders about 90 degrees), still 50-60 degrees turned at contact, the contact at
 * head height or a little above, level with the body; the face open about 25 degrees (a tray), a controlled finish
 * in front at chest height, the body still half side-on.
 */
export const OVERHEAD: Family = {
  name: 'overhead',
  // Trophy position: side-on, racket up behind the head, the free hand pointing at the ball.
  back: key(v(-0.32, 2.0, -0.32), v(0.05, 0.85, -0.5), v(-1, 0, 0.1), v(-0.65, 1.55, -0.2), -1.25, v(0.25, 2.1, 0.4)),
  contact: key(v(-0.35, 2.0, 0.1), v(0.32, 0.9, 0.28), v(0, 0.42, 0.91), v(-0.85, 1.5, -0.1), -0.95, v(0.62, 1.42, 0.35)),
  finish: key(v(0.05, 1.2, 0.5), v(0.35, -0.15, 0.9), v(0.05, -0.55, 0.85), v(-0.45, 1.2, 0.25), -0.15, v(0.4, 1.15, 0.05)),
  dip: -0.05,
  loop: 0.32,
  crouch: 0,
  punch: 1,
  stand: 0.35,
  prep: 0.45,
  bodyTurn: 0.7,
};

/**
 * Víbora: the same footwork, the contact lower (shoulder to head height) and further out to the racket side, the
 * face less open (10-15 degrees) and turned to cut the ball's outside, the path down 20-30 degrees and across the
 * body to the free side with more trunk turn and the forearm pronating: a finish low by the free hip.
 */
export const VIBORA: Family = {
  name: 'vibora',
  back: key(v(-0.45, 1.85, -0.38), v(-0.1, 0.8, -0.58), v(-1, 0.05, 0.15), v(-0.7, 1.45, -0.25), -1.3, v(0.25, 1.95, 0.4)),
  contact: key(v(-0.5, 1.7, 0.2), v(0.12, 0.92, 0.3), v(0.3, 0.2, 0.93), v(-0.9, 1.3, -0.05), -0.7, v(0.62, 1.32, 0.3)),
  finish: key(v(0.32, 0.92, 0.32), v(0.55, -0.55, 0.45), v(0.3, -0.45, 0.85), v(-0.15, 1.05, 0.4), 0.6, v(0.38, 1.05, -0.08)),
  dip: 0.08,
  loop: 0.28,
  crouch: 0,
  punch: 1,
  stand: 0.35,
  prep: 0.45,
  bodyTurn: 0.7,
};

/**
 * Smash: a tennis serve's chain. A deeper trophy (racket dropped behind the back), then the whole body turns through:
 * square to the net at contact at full reach, the face flat, and the racket comes right down past the free hip.
 */
export const SMASH: Family = {
  ...OVERHEAD,
  name: 'smash',
  back: key(v(-0.34, 1.92, -0.42), v(0.08, 0.7, -0.7), v(-1, 0, 0.12), v(-0.7, 1.5, -0.25), -1.4, v(0.25, 2.15, 0.45)),
  contact: key(v(-0.28, 2.45, 0.42), v(-0.15, 0.95, 0.27), v(0.02, 0.08, 1), v(-0.7, 1.7, 0.25), 0.05, v(0.45, 0.95, 0.2)),
  finish: key(v(0.38, 0.78, 0.12), v(0.6, -0.65, -0.3), v(0.2, -0.3, 0.9), v(-0.1, 1.0, 0.4), 0.75, v(0.35, 1.05, -0.1)),
  loop: 0.38,
};

/**
 * A key authored in the court's frame (F towards the net, S out to the racket side, U up: the research's frame, from
 * the floor under the mid-hip). Keys live in the stance's frame, square to the net whatever the body's turn (`yaw`
 * turns the hips and shoulders, not the frame), so this is only a change of axes.
 */
function courtKey(p: number[], a: number[], n: number[], pole: number[], yaw: number, off: number[]): Key {
  const m = (u: number[]): THREE.Vector3 => v(-u[1]!, u[2]!, u[0]!);
  return { p: m(p), q: racketQuat(m(a), m(n)), pole: m(pole), yaw, off: m(off) };
}

/**
 * The padel serve, a low forehand slice off a bounce the server feeds (docs/research/serve-and-strokes-motion.md
 * §4.1; a right-hander, keys in the court frame, see courtKey). The research measures from the floor under the
 * mid-hip, these keys from the player's position: at the top of the backswing the pelvis sits about 0.13 m behind
 * it (the weight on the rear leg), so the backswing is that much further back. The free hand points at the bounce
 * during the backswing, then comes down by the free hip (keys placed from the measured free shoulder, so the arm
 * is never folded flat). Side-on: the hips take most of the shoulder turn.
 * Backswing: the racket goes back and up while the ball bounces, head above the grip, shoulders about 100 degrees
 * turned (the tennis forehand's coil, 106 degrees at -231 ms). Forward swing high to low, starting about 300 ms out.
 * Contact at the top of the bounce out to the racket side, face about 25 degrees open, the shaft out to the side
 * with the head a little below the hand; the free hand folds in. Finish low and forward towards the target.
 */
const SERVE_TURN = 0.82;
export const SERVE: Family = {
  name: 'serve',
  back: courtKey([-0.68, 0.38, 1.5], [-0.1, 0.15, 1], [0.85, 0.5, 0.15], [-0.55, 0.55, 0.85], -1.75, [0.37, 0.47, 1.0]),
  contact: courtKey([0.5, 0.55, 0.9], [-0.2, 1, -0.15], [0.91, 0, 0.42], [-0.1, 0.5, 0.75], -0.8, [0.49, 0.09, 0.82]),
  finish: courtKey([0.75, 0.15, 1.25], [0.7, 0.1, 0.7], [-0.3, 0, 0.95], [0.4, 0.4, 1.0], -0.3, [0.33, -0.19, 0.87]),
  dip: 0.1,
  loop: 0,
  crouch: 1.5,
  punch: 1,
  bodyTurn: SERVE_TURN,
  lead: 0.3,
  // K4, mid forward swing (-120 ms of 300): out to the racket side and dropping, high to low.
  via: v(-0.55, 1.1, -0.3),
  viaS: 0.6,
};

/**
 * The server's address before the toss (§4.1 K0): side-on, the racket in front at the waist, face up, the free hand
 * out where it lets the ball go (the avatar puts it on the ball itself).
 */
export const SERVE_ADDRESS: Key = courtKey([0.1, 0.35, 0.95], [0.95, 0.3, 0.1], [0, 0, 1], [-0.2, 0.45, 0.8], -1.45, [0.5, 0.5, 0.95]);
export const SERVE_TURN_SHARE = SERVE_TURN;

/** A volley is a short punch: the backswing and follow-through pulled most of the way in towards contact. */
function volley(f: Family, name: string): Family {
  const shrink = (k: Key, u: number): Key => ({
    p: k.p.clone().lerp(f.contact.p, u),
    q: k.q.clone().slerp(f.contact.q, u * 0.6),
    pole: k.pole.clone().lerp(f.contact.pole, u),
    yaw: k.yaw + (f.contact.yaw - k.yaw) * u,
    off: k.off.clone(),
  });
  return { ...f, name, back: shrink(f.back, 0.55), finish: shrink(f.finish, 0.6), dip: f.dip * 0.2, loop: 0, crouch: 0.8, punch: 0.5 };
}

export const VOLLEY_FH = volley(FOREHAND, 'volley-fh');
export const VOLLEY_BH = volley(BACKHAND, 'volley-bh');

/**
 * Groundstroke variants by shot. `side` is -1 for the forehand (racket side -x), +1 for the backhand.
 * - Slice: racket back high, swung high to low with the face open, finishing low and forward.
 * - Lob: a big low-to-high lift with the face open, finishing high in front.
 * - Drop (dejada): a short, soft swing with the face open.
 * - Chiquita: a compact low-to-high brush with the face square, finishing at the shoulder.
 * - Contrapared: facing the back glass (the keys are the stance's, and the stance turns round), a short backswing
 *   kept low, then a steep low-to-high lift with the face well open that sends the ball up into the glass, finishing
 *   high in front of the face (the ball rebounds over the player's head towards the net).
 */
/** The backhand contrapared's shoulder turn at contact and backswing (rad): the backhand's before it went side-on. */
const CONTRA_BH_YAW = 0.35;
const CONTRA_BH_BACK_YAW = 1.2;

function variant(f: Family, side: number, kind: 'slice' | 'lob' | 'drop' | 'chiquita' | 'contra'): Family {
  const open = (k: Key, up: number): Key => {
    // Open the face (strings looking up): roll the racket about its handle. Forehand and backhand roll
    // opposite ways, since the racket points opposite ways.
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(k.q);
    return { ...k, q: new THREE.Quaternion().setFromAxisAngle(axis, -up * side).multiply(k.q) };
  };
  if (kind === 'slice') {
    return {
      ...f, name: `${f.name}-slice`,
      back: { ...f.back, p: f.back.p.clone().add(v(0, 0.28, 0)) },
      contact: open(f.contact, 0.45),
      low: f.low && open({ ...f.contact, q: f.low }, 0.45).q,
      finish: key(v(side * -0.05, 1.0, 0.68), v(side * 0.55, -0.25, 0.8), v(0, 0.55, 0.85), v(side * 0.3, 1.0, 0.4), f.contact.yaw - side * 0.35, f.finish.off),
      dip: -0.12,
      loop: 0.05,
    };
  }
  if (kind === 'lob') {
    return {
      ...f, name: `${f.name}-lob`,
      back: { ...f.back, p: f.back.p.clone().add(v(0, -0.18, 0)) },
      contact: open(f.contact, 0.6),
      low: f.low && open({ ...f.contact, q: f.low }, 0.6).q,
      finish: key(v(side * 0.15, 1.9, 0.5), v(side * -0.1, 0.9, 0.4), v(0, 0.2, 1), v(side * 0.5, 1.5, 0.3), f.contact.yaw - side * 0.2, f.finish.off),
      dip: 0.38,
      loop: 0.1,
    };
  }
  const shrink = (k: Key, u: number): Key => ({ ...k, p: k.p.clone().lerp(f.contact.p, u), pole: k.pole.clone().lerp(f.contact.pole, u) });
  if (kind === 'contra') {
    // (the glass is a metre or two away: no room for a full backswing)
    const back = shrink(f.back, 0.3);
    back.p.y -= 0.25;
    // Facing the glass, a lift into it: the backhand's shoulders stay as open as they were before the side-on keys.
    const cy = side > 0 ? CONTRA_BH_YAW : f.contact.yaw;
    return {
      ...f, name: `${f.name}-contra`, glass: true,
      bodyTurn: undefined,
      back: { ...back, yaw: side > 0 ? CONTRA_BH_BACK_YAW : back.yaw },
      contact: { ...open(f.contact, 0.75), yaw: cy },
      low: f.low && open({ ...f.contact, q: f.low }, 0.75).q,
      finish: key(v(side * 0.1, 2.0, 0.42), v(side * -0.05, 0.95, 0.3), v(0, 0.35, 1), v(side * 0.5, 1.55, 0.3), cy - side * 0.15, f.finish.off),
      dip: 0.42,
      loop: 0.06,
    };
  }
  if (kind === 'chiquita') {
    const back = shrink(f.back, 0.35);
    back.p.y -= 0.15;
    return { ...f, name: `${f.name}-chiquita`, back, finish: shrink(f.finish, 0.3), dip: 0.3, loop: 0.05 };
  }
  return {
    ...f, name: `${f.name}-drop`,
    back: shrink(f.back, 0.45),
    contact: open(f.contact, 0.55),
    low: f.low && open({ ...f.contact, q: f.low }, 0.55).q,
    finish: shrink({ ...f.finish, q: open(f.contact, 0.7).q }, 0.65),
    dip: 0.05,
    loop: 0,
  };
}

export const FH_SLICE = variant(FOREHAND, -1, 'slice');
export const FH_LOB = variant(FOREHAND, -1, 'lob');
export const FH_DROP = variant(FOREHAND, -1, 'drop');
export const BH_SLICE = variant(BACKHAND, 1, 'slice');
export const BH_LOB = variant(BACKHAND, 1, 'lob');
export const BH_DROP = variant(BACKHAND, 1, 'drop');
export const FH_CHIQUITA = variant(FOREHAND, -1, 'chiquita');
export const BH_CHIQUITA = variant(BACKHAND, 1, 'chiquita');
export const FH_CONTRA = variant(FOREHAND, -1, 'contra');
export const BH_CONTRA = variant(BACKHAND, 1, 'contra');

/**
 * Ready position between shots: the racket up in front of the chest, head up, edge towards the net, the free
 * hand on the throat. Held during rallies (let go when sprinting). The hands about 0.35 m in front of the body,
 * elbows bent (with the racket 0.42 m out the racket hand sat 18 cm in front of the hips, and a running body's
 * pelvis tilted onto it: 8% of a left-handed pair's frames had a hand inside the pelvis).
 */
export const READY: Key = key(v(-0.1, 1.28, 0.62), v(0.15, 0.75, 0.55), v(-1, 0, 0.15), v(-0.45, 0.85, -0.1), 0, v(-0.01, 1.13, 0.52));

/**
 * The racket tap after a point (avatar.ts racketTap): the racket raised in front at shoulder height, head up and a
 * little forward, the face towards the partner (the body is turned to them), the free hand down by the hip.
 */
export const TAP: Key = key(v(-0.18, 1.42, 0.5), v(-0.05, 0.9, 0.4), v(0, 0.15, 1), v(-0.5, 0.95, -0.1), 0, v(0.25, 0.95, 0.12));

/**
 * The end of a match: the winners' embrace, the racket arm over the partner's shoulder with the racket out behind them,
 * the free arm round their ribs; the beaten pair bent over, hands on the knees (the racket hanging from its hand).
 */
export const HUG: Key = key(v(-0.16, 1.64, 0.8), v(-0.03, 0.32, 1), v(1, 0, 0.05), v(-0.8, 0.85, -0.05), 0, v(0.24, 1.14, 0.46));
export const KNEES: Key = key(v(-0.2, 0.3, 0.3), v(-0.2, -0.9, 0.35), v(0, 0.3, 1), v(-0.75, 0.8, -0.25), 0, v(0.15, 0.68, 0.2));

/**
 * Walking back between points: the racket carried low in front of the hips, head up, the free hand on its throat
 * (the walk's arm swing put the racket into the thighs in 1-2% of frames).
 */
export const CARRY: Key = key(v(-0.12, 1.02, 0.45), v(0.1, 0.8, 0.6), v(-1, 0, 0.1), v(-0.55, 0.75, -0.15), 0, v(0.02, 1.0, 0.44));

// ---- left-handers: every key mirrored across the body's centre plane (model x -> -x) ----

function mirrorKey(k: Key): Key {
  return {
    p: v(-k.p.x, k.p.y, k.p.z),
    // A rotation seen in a mirror: (x, y, z, w) -> (x, -y, -z, w).
    q: new THREE.Quaternion(k.q.x, -k.q.y, -k.q.z, k.q.w),
    pole: v(-k.pole.x, k.pole.y, k.pole.z),
    yaw: -k.yaw,
    off: v(-k.off.x, k.off.y, k.off.z),
  };
}

function mirrorFamily(f: Family): Family {
  return {
    ...f,
    name: `${f.name}-left`,
    back: mirrorKey(f.back),
    contact: mirrorKey(f.contact),
    finish: mirrorKey(f.finish),
    low: f.low && new THREE.Quaternion(f.low.x, -f.low.y, -f.low.z, f.low.w),
    via: f.via && v(-f.via.x, f.via.y, f.via.z),
  };
}

const LEFT = new Map<Family, Family>();
const RIGHT = new Map<Family, Family>();
for (const f of [FOREHAND, BACKHAND, OVERHEAD, VIBORA, SMASH, SERVE, VOLLEY_FH, VOLLEY_BH, FH_SLICE, FH_LOB, FH_DROP, BH_SLICE, BH_LOB, BH_DROP,
  FH_CHIQUITA, BH_CHIQUITA, FH_CONTRA, BH_CONTRA]) {
  const l = mirrorFamily(f);
  LEFT.set(f, l);
  RIGHT.set(l, f);
}

/** The left-hander's version of a family. */
export function leftFamily(f: Family): Family {
  return LEFT.get(f)!;
}

/** The right-hander's family a family is (itself, or the one a left-hander's was mirrored from): compare this with
 * SMASH etc. (a left-hander's smash is another object, and `fam === SMASH` left them standing under smashes they
 * then missed by 25-37 cm: review round 3, critic #2). */
export function rightFamily(f: Family): Family {
  return RIGHT.get(f) ?? f;
}

export const READY_LEFT: Key = mirrorKey(READY);
export const TAP_LEFT: Key = mirrorKey(TAP);
export const HUG_LEFT: Key = mirrorKey(HUG);
export const KNEES_LEFT: Key = mirrorKey(KNEES);
export const CARRY_LEFT: Key = mirrorKey(CARRY);
export const SERVE_ADDRESS_LEFT: Key = mirrorKey(SERVE_ADDRESS);
