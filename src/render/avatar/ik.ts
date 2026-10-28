// Two-bone IK for arms and legs, in world space on live three.js bones. Allocation-free: the maths is done on
// plain numbers, because three's small vector helpers (distanceTo, dot, addScaledVector...) box their doubles
// when V8 doesn't inline them into a function this size. All bones have unit scale, so a world rotation is read
// straight off the world matrix.
import * as THREE from 'three/webgpu';

const U1 = new THREE.Vector3();
const U2 = new THREE.Vector3();
const Q = new THREE.Quaternion();
const QW = new THREE.Quaternion();
const QP = new THREE.Quaternion();

/** World rotation of an object (unit scale) from its current world matrix. */
export function worldQuat(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  return out.setFromRotationMatrix(o.matrixWorld);
}

/** Give `o` the world rotation `q` by setting its local rotation (its parent's matrix must be current). */
export function setWorldQuat(o: THREE.Object3D, q: THREE.Quaternion): void {
  QP.setFromRotationMatrix(o.parent!.matrixWorld).invert();
  o.quaternion.multiplyQuaternions(QP, q);
}

/** Rotate `o` in world space by `delta` (applied on the left of its world rotation). */
export function rotateWorld(o: THREE.Object3D, delta: THREE.Quaternion): void {
  QW.setFromRotationMatrix(o.matrixWorld).premultiply(delta);
  setWorldQuat(o, QW);
}

/**
 * Turn `upper` and `mid` so the origin of `end` lands on `target`, bending the middle joint towards `pole`
 * (all world space). The chain's world matrices must be current, and are current again afterwards.
 * Out-of-reach targets are met as nearly as the chain allows.
 */
export function twoBoneIK(upper: THREE.Bone, mid: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
  const mu = upper.matrixWorld.elements, mm = mid.matrixWorld.elements, me = end.matrixWorld.elements;
  const sx = mu[12]!, sy = mu[13]!, sz = mu[14]!;
  const ex = mm[12]!, ey = mm[13]!, ez = mm[14]!;
  const wx = me[12]!, wy = me[13]!, wz = me[14]!;
  const a = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy) + (ez - sz) * (ez - sz));
  const b = Math.sqrt((wx - ex) * (wx - ex) + (wy - ey) * (wy - ey) + (wz - ez) * (wz - ez));
  const tx = target.x - sx, ty = target.y - sy, tz = target.z - sz;
  let c = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (c < 1e-6 || a < 1e-6 || b < 1e-6) return;
  const dx = tx / c, dy = ty / c, dz = tz / c;
  const lo = Math.abs(a - b) + 1e-4;
  const hi = a + b - 1e-4;
  c = c < lo ? lo : c > hi ? hi : c;
  // Where the elbow (knee) goes: on the circle around the shoulder-target line, on the pole's side.
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  let px = pole.x - sx, py = pole.y - sy, pz = pole.z - sz;
  let pd = px * dx + py * dy + pz * dz;
  px -= dx * pd; py -= dy * pd; pz -= dz * pd;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-4) {
    px = ex - sx; py = ey - sy; pz = ez - sz;
    pd = px * dx + py * dy + pz * dz;
    px -= dx * pd; py -= dy * pd; pz -= dz * pd;
    pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-4) return;
  }
  px /= pl; py /= pl; pz /= pl;
  const e2x = sx + dx * x + px * h, e2y = sy + dy * x + py * h, e2z = sz + dz * x + pz * h;

  U1.x = (ex - sx) / a; U1.y = (ey - sy) / a; U1.z = (ez - sz) / a;
  U2.x = (e2x - sx) / a; U2.y = (e2y - sy) / a; U2.z = (e2z - sz) / a;
  Q.setFromUnitVectors(U1, U2);
  rotateWorld(upper, Q);
  upper.updateMatrixWorld(true);

  // The lower bone from the new elbow towards the (reachable) target.
  const nx = mm[12]!, ny = mm[13]!, nz = mm[14]!;
  const ux = me[12]! - nx, uy = me[13]! - ny, uz = me[14]! - nz;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const vx = sx + dx * c - nx, vy = sy + dy * c - ny, vz = sz + dz * c - nz;
  const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (ul < 1e-6 || vl < 1e-6) return;
  U1.x = ux / ul; U1.y = uy / ul; U1.z = uz / ul;
  U2.x = vx / vl; U2.y = vy / vl; U2.z = vz / vl;
  Q.setFromUnitVectors(U1, U2);
  rotateWorld(mid, Q);
  mid.updateMatrixWorld(true);
}

const QA = new THREE.Quaternion();
const QB = new THREE.Quaternion();
const XL = new THREE.Vector3();
const YL = new THREE.Vector3();
const ZL = new THREE.Vector3();
const XW = new THREE.Vector3();
const YW = new THREE.Vector3();
const ZW = new THREE.Vector3();
const HU = new THREE.Vector3();
/** Quaternion components on their way into QB (fromArray: no double crosses a call; see the file's header). */
const QV = new Float64Array(4);

/**
 * A limb whose middle joint is a hinge (the elbow: every clip bends the forearm about one axis of its own frame,
 * within a degree). The middle bone gets its rest rotation turned about `hinge` (its frame) by the bend that puts
 * the end at the target's distance; then the upper bone is turned as a whole so the end lands on the target with
 * the middle joint towards `pole` (world). Unlike twoBoneIK, nothing here starts from the clip's pose, so no
 * shortest-arc turn can flip the forearm over when the bend it needs is the other way from the clip's (that
 * showed as forearms and hands turning 150-180 degrees in a frame). Chain world matrices must be current.
 */
export interface HingeLimb {
  /** The middle joint's hinge (its own frame) and its rest rotation. */
  hinge: THREE.Vector3;
  rest: THREE.Quaternion;
  /** Last frame's side for the middle joint off the shoulder-to-end line (world; zero = none yet). */
  side: THREE.Vector3;
}

/**
 * Most the middle joint's side may turn about the shoulder-to-end line in one call (rad; set per frame by the
 * caller: a double passed into a call that isn't inlined is boxed).
 */
export const IK_TURN = new Float64Array([Math.PI]);

export function hingeIK(upper: THREE.Bone, mid: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3,
  limb: HingeLimb): void {
  const hinge = limb.hinge, rest = limb.rest, side = limb.side;
  const mu = upper.matrixWorld.elements, mm = mid.matrixWorld.elements;
  const sx = mu[12]!, sy = mu[13]!, sz = mu[14]!;
  const L = mid.position, E = end.position;
  const a = Math.sqrt(L.x * L.x + L.y * L.y + L.z * L.z);
  const b = Math.sqrt(E.x * E.x + E.y * E.y + E.z * E.z);
  const tx = target.x - sx, ty = target.y - sy, tz = target.z - sz;
  let c = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (c < 1e-6 || a < 1e-6 || b < 1e-6) return;
  const dx = tx / c, dy = ty / c, dz = tz / c;
  const lo = Math.abs(a - b) + 1e-4, hi = a + b - 1e-4;
  c = c < lo ? lo : c > hi ? hi : c;
  // The bend: with l = rest^-1 L (the upper bone's offset seen from the middle bone), |L + rest H(beta) E| = c
  // reads l.(H E) = K; Rodrigues makes the left side A + B cos(beta) + C sin(beta).
  QA.copy(rest).invert();
  XL.copy(L).applyQuaternion(QA);
  const hx = hinge.x, hy = hinge.y, hz = hinge.z;
  const lh = XL.x * hx + XL.y * hy + XL.z * hz, eh = E.x * hx + E.y * hy + E.z * hz;
  const A = lh * eh;
  const B = XL.x * E.x + XL.y * E.y + XL.z * E.z - A;
  // h x E
  const cx = hy * E.z - hz * E.y, cy = hz * E.x - hx * E.z, cz = hx * E.y - hy * E.x;
  const C = XL.x * cx + XL.y * cy + XL.z * cz;
  const K = (c * c - a * a - b * b) / 2;
  const R = Math.sqrt(B * B + C * C);
  if (R < 1e-9) return;
  const k = (K - A) / R;
  const beta = Math.atan2(C, B) + Math.acos(k < -1 ? -1 : k > 1 ? 1 : k);
  const sh = Math.sin(beta / 2);
  QV[0] = hx * sh; QV[1] = hy * sh; QV[2] = hz * sh; QV[3] = Math.cos(beta / 2);
  QB.fromArray(QV);
  mid.quaternion.multiplyQuaternions(rest, QB);
  // The upper bone's own frame: x along the shoulder-to-end line, y towards the middle joint (x cross the hinge,
  // the side a bend about the hinge puts the joint), z the rest.
  // (normalised by hand: Vector3.normalize passes doubles through length() and divideScalar(), boxed.)
  XL.copy(E).applyQuaternion(mid.quaternion).add(L);
  let nl = Math.sqrt(XL.x * XL.x + XL.y * XL.y + XL.z * XL.z);
  XL.x /= nl; XL.y /= nl; XL.z /= nl;
  HU.copy(hinge).applyQuaternion(rest);
  YL.crossVectors(XL, HU);
  nl = Math.sqrt(YL.x * YL.x + YL.y * YL.y + YL.z * YL.z);
  if (nl < 1e-9) return;
  YL.x /= nl; YL.y /= nl; YL.z /= nl;
  ZL.crossVectors(XL, YL);
  // The world frame it must match: x towards the target, y towards the pole off that line. The side turns about
  // the line no faster than IK_TURN from last frame's: when the pole passes close by the line its side swings
  // round, and taken as it is that was the whole arm turning over in a frame (upper arm and hand 160-180 degrees).
  let px = pole.x - sx, py = pole.y - sy, pz = pole.z - sz;
  let pd = px * dx + py * dy + pz * dz;
  px -= dx * pd; py -= dy * pd; pz -= dz * pd;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  // Last frame's side, square to this frame's line.
  let qx = side.x, qy = side.y, qz = side.z;
  const qd = qx * dx + qy * dy + qz * dz;
  qx -= dx * qd; qy -= dy * qd; qz -= dz * qd;
  const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const had = ql > 1e-6;
  if (pl < 1e-4) {
    if (had) { px = qx; py = qy; pz = qz; pl = ql; } else {
      px = mm[12]! - sx; py = mm[13]! - sy; pz = mm[14]! - sz;
      pd = px * dx + py * dy + pz * dz;
      px -= dx * pd; py -= dy * pd; pz -= dz * pd;
      pl = Math.sqrt(px * px + py * py + pz * pz);
      if (pl < 1e-6) return;
    }
  }
  px /= pl; py /= pl; pz /= pl;
  if (had) {
    qx /= ql; qy /= ql; qz /= ql;
    // The turn from last frame's side to the pole's, about the line: sin = d.(q x p), cos = q.p.
    const sn = dx * (qy * pz - qz * py) + dy * (qz * px - qx * pz) + dz * (qx * py - qy * px);
    const cs = qx * px + qy * py + qz * pz;
    const ang = Math.atan2(sn, cs), lim = IK_TURN[0]!;
    if (ang > lim || ang < -lim) {
      const a2 = ang > 0 ? lim : -lim, ca = Math.cos(a2), sa = Math.sin(a2);
      // q turned about the line: q cos + (d x q) sin.
      px = qx * ca + (dy * qz - dz * qy) * sa;
      py = qy * ca + (dz * qx - dx * qz) * sa;
      pz = qz * ca + (dx * qy - dy * qx) * sa;
    }
  }
  side.x = px; side.y = py; side.z = pz;
  XW.x = dx; XW.y = dy; XW.z = dz;
  YW.x = px; YW.y = py; YW.z = pz;
  ZW.crossVectors(XW, YW);
  // R = W L^T (each world axis times its local one), then its quaternion, by hand: Matrix4.makeBasis hands 16
  // doubles to Matrix4.set, boxed whenever that call isn't inlined (100 MB per 100k ticks of four players).
  const m11 = XW.x * XL.x + YW.x * YL.x + ZW.x * ZL.x, m12 = XW.x * XL.y + YW.x * YL.y + ZW.x * ZL.y, m13 = XW.x * XL.z + YW.x * YL.z + ZW.x * ZL.z;
  const m21 = XW.y * XL.x + YW.y * YL.x + ZW.y * ZL.x, m22 = XW.y * XL.y + YW.y * YL.y + ZW.y * ZL.y, m23 = XW.y * XL.z + YW.y * YL.z + ZW.y * ZL.z;
  const m31 = XW.z * XL.x + YW.z * YL.x + ZW.z * ZL.x, m32 = XW.z * XL.y + YW.z * YL.y + ZW.z * ZL.y, m33 = XW.z * XL.z + YW.z * YL.z + ZW.z * ZL.z;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1);
    QV[3] = 0.25 / k; QV[0] = (m32 - m23) * k; QV[1] = (m13 - m31) * k; QV[2] = (m21 - m12) * k;
  } else if (m11 > m22 && m11 > m33) {
    const k = 2 * Math.sqrt(1 + m11 - m22 - m33);
    QV[3] = (m32 - m23) / k; QV[0] = 0.25 * k; QV[1] = (m12 + m21) / k; QV[2] = (m13 + m31) / k;
  } else if (m22 > m33) {
    const k = 2 * Math.sqrt(1 + m22 - m11 - m33);
    QV[3] = (m13 - m31) / k; QV[0] = (m12 + m21) / k; QV[1] = 0.25 * k; QV[2] = (m23 + m32) / k;
  } else {
    const k = 2 * Math.sqrt(1 + m33 - m11 - m22);
    QV[3] = (m21 - m12) / k; QV[0] = (m13 + m31) / k; QV[1] = (m23 + m32) / k; QV[2] = 0.25 * k;
  }
  QA.fromArray(QV);
  setWorldQuat(upper, QA);
  upper.updateMatrixWorld(true);
}
