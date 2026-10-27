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
  contact: key(v(-0.75, 1.0, 0.45), v(-0.85, 0.12, 0.5), v(0.05, 0.08, 1), v(-0.45, 0.8, -0.15), 0.15, v(0.4, 1.05, 0.15)),
  finish: key(v(0.28, 1.55, 0.12), v(0.45, 0.35, -0.8), v(0.85, 0.1, 0.4), v(-0.15, 1.45, 0.45), 0.95, v(0.35, 1.12, -0.05)),
  low: racketQuat(v(-0.72, -0.55, 0.42), v(0.05, 0.3, 1)),
  dip: 0.28,
  loop: 0.1,
  crouch: 1,
};

export const BACKHAND: Family = {
  name: 'backhand',
  back: key(v(0.55, 1.12, -0.38), v(0.3, 0.6, -0.72), v(1, 0.05, -0.15), v(0.25, 1.05, 0.45), 1.2, v(0.42, 1.12, -0.12)),
  contact: key(v(0.72, 0.98, 0.42), v(0.85, 0.12, 0.5), v(-0.05, 0.08, 1), v(0.35, 0.95, 0.35), 0.35, v(0.55, 1.05, -0.35)),
  finish: key(v(-0.45, 1.5, 0.22), v(-0.5, 0.62, -0.58), v(-0.85, 0.15, 0.4), v(-0.2, 1.5, 0.45), -0.45, v(0.6, 1.1, -0.42)),
  low: racketQuat(v(0.72, -0.55, 0.42), v(-0.05, 0.3, 1)),
  dip: 0.22,
  loop: 0.05,
  crouch: 1,
};

export const OVERHEAD: Family = {
  name: 'overhead',
  // Trophy position: side-on, racket up behind the head, the free hand pointing at the ball.
  back: key(v(-0.32, 2.0, -0.32), v(0.05, 0.85, -0.5), v(-1, 0, 0.1), v(-0.65, 1.55, -0.2), -1.2, v(0.25, 2.1, 0.4)),
  contact: key(v(-0.3, 2.45, 0.4), v(-0.2, 0.92, 0.32), v(0.02, 0.2, 1), v(-0.7, 1.65, 0.2), -0.15, v(0.3, 1.3, 0.2)),
  // Bandeja finish: controlled, the racket ends in front at chest height.
  finish: key(v(0.12, 1.15, 0.48), v(0.35, -0.2, 0.9), v(0.1, -0.6, 0.8), v(-0.4, 1.2, 0.3), 0.3, v(0.35, 1.1, 0)),
  dip: -0.05,
  loop: 0.38,
  crouch: 0,
};

/** Smash: same trophy and contact, but the racket comes right down past the left hip. */
export const SMASH: Family = {
  ...OVERHEAD,
  name: 'smash',
  finish: key(v(0.38, 0.78, 0.12), v(0.6, -0.65, -0.3), v(0.2, -0.3, 0.9), v(-0.1, 1.0, 0.4), 0.75, v(0.35, 1.05, -0.1)),
};

export const SERVE: Family = {
  name: 'serve',
  // Underarm: the racket back low, the free hand out in front holding the ball.
  back: key(v(-0.55, 0.78, -0.55), v(-0.3, 0.25, -0.9), v(-1, 0.1, 0.2), v(-0.4, 0.75, -0.4), -0.9, v(-0.05, 0.95, 0.45)),
  contact: key(v(-0.55, 0.85, 0.45), v(-0.8, -0.2, 0.55), v(0, 0.12, 1), v(-0.5, 0.8, -0.1), -0.1, v(0.35, 1.0, 0.1)),
  finish: key(v(-0.05, 1.45, 0.55), v(0.1, 0.8, 0.6), v(0, -0.3, 1), v(-0.3, 1.2, 0.4), 0.4, v(0.35, 1.05, 0.05)),
  low: racketQuat(v(-0.62, -0.6, 0.5), v(0, 0.3, 1)),
  dip: 0.12,
  loop: 0,
  crouch: 0.6,
};

/** A volley is a short punch: the backswing and follow-through pulled most of the way in towards contact. */
function volley(f: Family, name: string): Family {
  const shrink = (k: Key, u: number): Key => ({
    p: k.p.clone().lerp(f.contact.p, u),
    q: k.q.clone().slerp(f.contact.q, u * 0.6),
    pole: k.pole.clone().lerp(f.contact.pole, u),
    yaw: k.yaw + (f.contact.yaw - k.yaw) * u,
    off: k.off.clone(),
  });
  return { ...f, name, back: shrink(f.back, 0.55), finish: shrink(f.finish, 0.6), dip: f.dip * 0.2, loop: 0, crouch: 0.8 };
}

export const VOLLEY_FH = volley(FOREHAND, 'volley-fh');
export const VOLLEY_BH = volley(BACKHAND, 'volley-bh');

/**
 * Ready position between shots: the racket up in front of the chest, head up, edge towards the net, the free
 * hand on the throat. Held during rallies (let go when sprinting).
 */
export const READY: Key = key(v(-0.12, 1.22, 0.42), v(0.15, 0.75, 0.55), v(-1, 0, 0.15), v(-0.45, 0.85, -0.1), 0, v(0.02, 1.1, 0.4));
