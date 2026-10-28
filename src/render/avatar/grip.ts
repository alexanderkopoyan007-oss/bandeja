// How a hand holds the racket, solved once per hand from the player's own mesh and skeleton (so a new body grips
// as well as this one): where the handle lies in the palm, how the racket turns about it, and the finger curls that
// wrap the handle.
//
// A padel grip is the continental (Sánchez-Alcaraz & Courel-Ibáñez's coaching texts; tennis: the "hammer" grip): the
// handle lies diagonally across the palm, from the heel pad on the little-finger side to the base of the index
// finger, the fingers wrap round it and the thumb closes over it from the other side, and the hand sits at the end
// of the handle with the heel pad just over the butt cap (padel players hold the whole hand on the grip and wear the
// wrist cord). The face turns `GRIP_BEVEL` from square to the palm (an eastern grip, palm parallel to the strings)
// towards the thumb side: one bevel of the octagonal handle is 45 degrees.
//
// Frame (model space, the rest pose): F along the fingers (wrist to the middle finger's base), K across the knuckles
// towards the index finger, N out of the palm (the side the thumb is on).
import * as THREE from 'three/webgpu';
import type { PlayerAsset } from './asset.ts';
import { HANDLE_R, RACKET_BUTT } from './racket.ts';

/** The face's turn about the handle from square to the palm (rad). */
export const GRIP_BEVEL = (35 * Math.PI) / 180;
/** The heel pad sits this far up the handle from its end (m). */
const BUTT_PAST = 0.012;
/** How far a finger presses into the grip (share of its radius: soft tissue and the tape give). */
const PRESS = 0.85;
/** Joint limits for the curl (rad): knuckle, middle, end joint; the thumb's base, knuckle and end joint. */
const FINGER_MAX = [1.5, 1.75, 1.3];
const THUMB_MAX = [0.8, 1.0, 1.25];
/** How the joints share a closing hand (knuckle : middle : end joint; a power grip's proportions). */
const FINGER_RATIO = [0.75, 1, 0.65];
const THUMB_RATIO = [0.5, 0.8, 1];

export interface GripSolve {
  /** The racket's origin (face centre) and rotation in the hand bone's frame. */
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  /** Curled bones and their local rotations (x, y, z, w). */
  bones: number[];
  quats: Float32Array;
  /** The wrist (hand bone's origin) and the forearm's direction, in the racket's frame (for the wrist cord). */
  wrist: THREE.Vector3;
  forearm: THREE.Vector3;
  /** The wrist's radius (m): how far the forearm's skin reaches from its axis near the wrist. */
  wristR: number;
  /** Each finger joint's distance from the handle's axis after the curl, minus the handle radius (m; QA). */
  gaps: number[];
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

export function solveGrip(asset: PlayerAsset, side: string): GripSolve {
  const rw = asset.restWorld;
  const idx = (n: string): number => asset.bone(side + n);
  const at = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(rw[idx(n)]!);
  const wrist = at('Hand');
  const F = at('HandMiddle1').sub(wrist).normalize();
  const K = at('HandIndex1').sub(at('HandPinky1'));
  K.addScaledVector(F, -K.dot(F)).normalize();
  const N = new THREE.Vector3().crossVectors(F, K).normalize();
  if (N.dot(at('HandThumb2').sub(wrist)) < 0) N.negate();
  const coord = (p: THREE.Vector3): [number, number, number] => {
    const d = p.clone().sub(wrist);
    return [d.dot(F), d.dot(K), d.dot(N)];
  };

  // The palm's surface (how far out on the N side) and each finger segment's radius, from the mesh.
  const geo = asset.geometry;
  const P = geo.getAttribute('position'), SI = geo.getAttribute('skinIndex'), SW = geo.getAttribute('skinWeight');
  const hand = idx('Hand');
  const palm: Array<[number, number, number]> = [];
  const segR = new Map<number, number[]>();
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
    if (best < 0) continue;
    v.fromBufferAttribute(P, i);
    if (best === hand) { palm.push(coord(v)); continue; }
    const name = asset.bones[best]!.name;
    if (!name.startsWith(side + 'Hand') || !/\d$/.test(name)) continue;
    const child = asset.bones.findIndex((b) => b.parent === best);
    if (child < 0) continue;
    const a = new THREE.Vector3().setFromMatrixPosition(rw[best]!), b = new THREE.Vector3().setFromMatrixPosition(rw[child]!);
    const seg = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(v.clone().sub(a).dot(seg) / seg.lengthSq(), 0, 1);
    let list = segR.get(best);
    if (!list) { list = []; segR.set(best, list); }
    list.push(v.distanceTo(a.addScaledVector(seg, t)));
  }
  const radius = (b: number): number => {
    const l = segR.get(b);
    if (!l || l.length < 4) return 0.01;
    l.sort((x, y) => x - y);
    return l[Math.floor(l.length * 0.8)]!;
  };
  const surf = (f: number, k: number): number => {
    let m = -1;
    for (const [pf, pk, pn] of palm) if ((pf - f) ** 2 + (pk - k) ** 2 < 0.012 * 0.012 && pn > m) m = pn;
    return m < 0 ? 0.02 : m;
  };

  // The handle's axis: across the palm from the heel pad under the little finger (halfway up from the wrist to its
  // knuckle) to the base of the index finger, a handle's radius off the palm all along.
  const [fp, kp] = coord(at('HandPinky1'));
  const [fi, ki] = coord(at('HandIndex1'));
  const f0 = 0.5 * fp, k0 = kp, f1 = 0.92 * fi, k1 = ki;
  let n0 = surf(f0, k0) + HANDLE_R, n1 = surf(f1, k1) + HANDLE_R;
  let lift = 0;
  for (let s = 0; s <= 10; s++) {
    const u = s / 10;
    lift = Math.max(lift, surf(f0 + (f1 - f0) * u, k0 + (k1 - k0) * u) + HANDLE_R - (n0 + (n1 - n0) * u));
  }
  n0 += lift;
  n1 += lift;
  const pt = (f: number, k: number, n: number): THREE.Vector3 =>
    wrist.clone().addScaledVector(F, f).addScaledVector(K, k).addScaledVector(N, n);
  const A = pt(f1, k1, n1).sub(pt(f0, k0, n0)).normalize();
  // The heel pad's end: the hand's edge past the little finger's line (its finger's thickness), where the handle leaves
  // the hand.
  const H0 = pt(f0, k0, n0).addScaledVector(A, -radius(idx('HandPinky1')) / Math.max(0.3, A.dot(K)));
  // The face: square to the palm, turned GRIP_BEVEL about the handle towards the thumb side.
  const N0 = N.clone().addScaledVector(A, -N.dot(A)).normalize();
  const S = new THREE.Vector3().crossVectors(A, N0);
  if (S.dot(K) < 0) S.negate();
  const Z = N0.clone().multiplyScalar(Math.cos(GRIP_BEVEL)).addScaledVector(S, Math.sin(GRIP_BEVEL)).normalize();
  const X = new THREE.Vector3().crossVectors(A, Z);
  const centre = H0.clone().addScaledVector(A, -RACKET_BUTT - BUTT_PAST);
  const mr = new THREE.Matrix4().makeBasis(X, A, Z).setPosition(centre);
  const handW = rw[hand]!;
  const local = handW.clone().invert().multiply(mr);
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  local.decompose(pos, q, sc);

  // Distance of a model-space point from the handle's axis.
  const offAxis = (p: THREE.Vector3): number => {
    const d = p.clone().sub(H0);
    return d.addScaledVector(A, -d.dot(A)).length();
  };

  // Finger curls, joint by joint from the knuckle: each turns (about its own flexion axis) until the next joint, or
  // any point of the segment, touches the grip, or until the joint's limit.
  const out: GripSolve = {
    pos, q, bones: [], quats: new Float32Array(0), wrist: new THREE.Vector3(), forearm: new THREE.Vector3(), wristR: 0.035, gaps: [],
  };
  const qs: number[] = [];
  const chain = (names: string[], max: number[], thumb: boolean, target?: THREE.Vector3): THREE.Matrix4[] => {
    const ids = names.map((n) => idx(n));
    const tip = asset.bones.findIndex((b) => b.parent === ids[ids.length - 1]);
    const all = tip >= 0 ? [...ids, tip] : ids;
    // World matrices along the chain, from the first joint's parent (the hand at rest).
    const localM = all.map((b) => new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(asset.bones[b]!.pos), new THREE.Quaternion().fromArray(asset.bones[b]!.quat), new THREE.Vector3(1, 1, 1)));
    const parentW = rw[asset.bones[ids[0]!]!.parent]!;
    const curl = ids.map(() => new THREE.Quaternion());
    const worldAt = (): THREE.Matrix4[] => {
      const w: THREE.Matrix4[] = [];
      let m = parentW.clone();
      for (let j = 0; j < all.length; j++) {
        m = m.clone().multiply(localM[j]!);
        if (j < curl.length) m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(curl[j]!));
        w.push(m);
      }
      return w;
    };
    // Each joint's flexion axis in its own frame, from the rest pose: the fingers about their own axis (towards the
    // palm), the thumb straight towards the handle.
    const w0 = worldAt();
    const axes = ids.map((_, j) => {
      const a = new THREE.Vector3().setFromMatrixPosition(w0[j]!);
      const b = new THREE.Vector3().setFromMatrixPosition(w0[j + 1] ?? w0[j]!);
      const dir = b.clone().sub(a).normalize();
      let axisW: THREE.Vector3;
      if (thumb) {
        const d = a.clone().sub(H0);
        const to = H0.clone().addScaledVector(A, d.dot(A)).sub(a);
        to.addScaledVector(dir, -to.dot(dir)).normalize();
        axisW = new THREE.Vector3().crossVectors(dir, to).normalize();
      } else axisW = new THREE.Vector3().crossVectors(dir, N).normalize();
      const rq = new THREE.Quaternion();
      w0[j]!.decompose(v, rq, sc);
      return axisW.applyQuaternion(rq.invert());
    });
    const R = ids.map((b) => HANDLE_R + PRESS * radius(b));
    const ang = ids.map(() => 0);
    const ratio = thumb ? THUMB_RATIO : FINGER_RATIO;
    // The whole finger closes (the joints in a power grip's proportions) until a segment touches the grip; the joints
    // behind that segment stop, the ones beyond it go on closing round the handle, until each touches or is at its
    // limit.
    let free = target ? ids.length : 0;
    const set = (): void => { for (let j = 0; j < ids.length; j++) curl[j]!.setFromAxisAngle(axes[j]!, ang[j]!); };
    const touches = (wm: THREE.Matrix4[], j: number): boolean => {
      const p0 = new THREE.Vector3().setFromMatrixPosition(wm[j]!);
      const p1 = new THREE.Vector3().setFromMatrixPosition(wm[j + 1] ?? wm[j]!);
      for (let u = 0; u <= 4; u++) if (offAxis(p0.clone().lerp(p1, u / 4)) <= R[j]!) return true;
      return false;
    };
    for (let step = 0; step < 400 && free < ids.length; step++) {
      let moved = false;
      for (let j = free; j < ids.length; j++) {
        const nv = Math.min(max[j]!, ang[j]! + 0.01 * ratio[j]!);
        if (nv > ang[j]!) { ang[j] = nv; moved = true; }
      }
      if (!moved) break;
      set();
      const wm = worldAt();
      for (let j = ids.length - 1; j >= free; j--) {
        if (touches(wm, j)) {
          // Back off this step for the joints that carry the touching segment, and hold them.
          for (let i = free; i <= j; i++) ang[i] = Math.max(0, ang[i]! - 0.01 * ratio[i]!);
          free = j + 1;
          set();
          break;
        }
      }
    }
    if (!target) set();
    else {
      // The thumb closes over the handle onto the fingers (CCD towards `target`, each joint within its limit); if a
      // segment ends up in the grip, the target moves out and it solves again.
      const goal = target.clone();
      const qd = new THREE.Quaternion(), r0 = new THREE.Quaternion(), r0i = new THREE.Quaternion(), lim = new THREE.Quaternion();
      const pj = new THREE.Vector3(), pt = new THREE.Vector3(), d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
      for (let tries = 0; tries < 4; tries++) {
        for (let it = 0; it < 30; it++) {
          for (let j = ids.length - 1; j >= 0; j--) {
            const wm = worldAt();
            pj.setFromMatrixPosition(wm[j]!);
            pt.setFromMatrixPosition(wm[all.length - 1]!);
            d1.subVectors(pt, pj).normalize();
            d2.subVectors(goal, pj).normalize();
            qd.setFromUnitVectors(d1, d2);
            // In the joint's own frame (its rotation without this joint's curl).
            wm[j]!.decompose(v, r0, sc);
            r0.multiply(r0i.copy(curl[j]!).invert());
            r0i.copy(r0).invert();
            curl[j]!.premultiply(r0i.multiply(qd).multiply(r0)).normalize();
            if (!(Math.abs(curl[j]!.w) <= 1)) curl[j]!.identity();
            const a = 2 * Math.acos(Math.min(1, Math.abs(curl[j]!.w)));
            // (slerpQuaternions(identity, curl[j]) would copy the identity over curl[j] first)
            if (a > max[j]!) { lim.copy(curl[j]!); curl[j]!.identity().slerp(lim, max[j]! / a); }
          }
        }
        const wm = worldAt();
        let deficit = 0;
        for (let j = 0; j < ids.length; j++) {
          const p0 = new THREE.Vector3().setFromMatrixPosition(wm[j]!);
          const p1 = new THREE.Vector3().setFromMatrixPosition(wm[j + 1] ?? wm[j]!);
          for (let u = 1; u <= 4; u++) deficit = Math.max(deficit, R[j]! - offAxis(p0.clone().lerp(p1, u / 4)));
        }
        if (deficit <= 0.002) break;
        const dd = goal.clone().sub(H0);
        const radial = dd.addScaledVector(A, -dd.dot(A)).normalize();
        goal.addScaledVector(radial, deficit);
      }
    }
    const w = worldAt();
    for (let j = 1; j < all.length; j++) out.gaps.push(offAxis(new THREE.Vector3().setFromMatrixPosition(w[j]!)) - HANDLE_R);
    for (let j = 0; j < ids.length; j++) {
      out.bones.push(ids[j]!);
      const lq = new THREE.Quaternion().fromArray(asset.bones[ids[j]!]!.quat).multiply(curl[j]!);
      qs.push(lq.x, lq.y, lq.z, lq.w);
    }
    return w;
  };
  let middle: THREE.Matrix4[] = [];
  for (const f of FINGERS) {
    const w = chain([`Hand${f}1`, `Hand${f}2`, `Hand${f}3`], FINGER_MAX, false);
    if (f === 'Middle') middle = w;
  }
  // The thumb closes over the side of the handle, part of the way round towards the fingers (the continental grip's
  // thumb on the bevel beside the index finger) and up the handle: its tip goes to a point on the grip's surface
  // round from where the thumb starts, never across the handle (a straight reach went through it).
  const cyl = (p: THREE.Vector3): [number, number] => {
    const d = p.clone().sub(H0);
    const s = d.dot(A);
    d.addScaledVector(A, -s);
    return [s, Math.atan2(d.dot(S), d.dot(N0))];
  };
  const tb = at('HandThumb2'), tt = new THREE.Vector3().setFromMatrixPosition(rw[asset.bones.findIndex((b) => b.parent === idx('HandThumb3'))]!);
  const [sb, pb] = cyl(tb);
  const [, pm] = cyl(new THREE.Vector3().setFromMatrixPosition(middle[2]!));
  let dphi = pm - pb;
  while (dphi > Math.PI) dphi -= 2 * Math.PI;
  while (dphi < -Math.PI) dphi += 2 * Math.PI;
  const phiG = pb + Math.max(-1.2, Math.min(1.2, 0.5 * dphi));
  const rG = HANDLE_R + PRESS * radius(idx('HandThumb3')) + 0.002;
  const sG = sb + 0.7 * tb.distanceTo(tt);
  const goal = H0.clone().addScaledVector(A, sG).addScaledVector(N0, rG * Math.cos(phiG)).addScaledVector(S, rG * Math.sin(phiG));
  chain(['HandThumb1', 'HandThumb2', 'HandThumb3'], THUMB_MAX, true, goal);
  out.quats = Float32Array.from(qs);

  // The wrist's thickness: forearm skin within 4 cm of the wrist joint, its furthest from the forearm's axis.
  {
    const fa = idx('ForeArm');
    const fd = wrist.clone().sub(at('ForeArm')).normalize();
    let r = 0;
    for (let i = 0; i < P.count; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      if (best !== fa) continue;
      v.fromBufferAttribute(P, i).sub(wrist);
      const along = v.dot(fd);
      if (along > 0.005 || along < -0.04) continue;
      r = Math.max(r, v.addScaledVector(fd, -along).length());
    }
    if (r > 0.015) out.wristR = r;
  }
  const inv = mr.clone().invert();
  out.wrist.copy(wrist).applyMatrix4(inv);
  out.forearm.copy(wrist).sub(at('ForeArm')).normalize().transformDirection(inv);
  return out;
}
