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
