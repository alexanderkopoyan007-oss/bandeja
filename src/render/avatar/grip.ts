// How a hand holds the racket, solved once per hand from the player's own mesh and skeleton (so a new body grips
// as well as this one): where the handle lies in the hand, how the racket turns about it, and the curls that close the
// hand on it.
//
// A padel grip is the tennis continental, the hammer grip (photos of the hold: Tennis Companion's grip guide; padel: Padelshop's
// and Decathlon's guides). The handle lies across the base of the fingers and runs out under the heel of the hand, which is on the
// butt. The middle, ring and little fingers close right round it, tips towards the base of the thumb, touching each other; the index stays
// up the handle and closes less; the thumb crosses the front between it and the middle finger. The V between thumb and
// index lies on the narrow top edge of the frame, which is `GRIP_BEVEL` from an eastern grip's palm parallel to the strings:
// one bevel of the octagonal handle is 45 degrees.
//
// Frame (model space, the rest pose): F along the fingers (wrist to the middle finger's base), K across the knuckles
// towards the index finger, N out of the palm (the side the thumb is on).
import * as THREE from 'three/webgpu';
import type { PlayerAsset } from './asset.ts';
import { HANDLE_R, RACKET_BUTT } from './racket.ts';

/** The face's turn about the handle from square to the palm (rad). */
export const GRIP_BEVEL = (45 * Math.PI) / 180;
/** The handle's angle off the knuckle line (rad): 59 degrees off the fingers, so about 120 to the forearm with the wrist straight. A photo of a tennis hold reads 128, on a
 * palm that cups round the handle; a rigid palm can lie only so far across. */
const HANDLE_TILT = (31 * Math.PI) / 180;
/** The handle's axis at the index finger: this far back from its knuckle (m on a hand with a 113 mm palm): in the crease at the finger's base. */
const AXIS_BACK = -0.005;
/** How far the handle presses into the palm's surface (m), at the index finger and at the far edge of the hand. The real palm cups: the ring and little fingers' knuckles
 * come down round the handle, and the heel pad gives. This skeleton has no bones in the palm, so the handle goes down to them instead. */
const PALM_SINK = 0.007;
const PALM_SINK_FAR = 0.014;
/** The butt's end past the hand's edge (m): the heel of the hand is on the bottom of the handle, and the little finger against the cap. */
const BUTT_PAST = 0.002;
/** How far a finger presses into the grip (share of its radius: soft tissue and the tape give). */
const PRESS = 0.85;
/** Joint limits for the curl (rad): knuckle, middle, end joint. */
const FINGER_MAX = [1.65, 1.75, 1.3];
/** Each finger's flexion turned onto the handle: a closing finger goes round it, not along it (the real ones converge on the base of the thumb). */
const FINGER_TURN = 1;
/** And turned a little more towards the others, index to little finger (rad): at rest the knuckles stand 21-29 mm apart, and the fingers are 16 wide, and a closed hand has
 * no gaps. Not the index: it stays up the handle, and the thumb crosses between it and the middle finger. */
const FINGER_CONVERGE = [-0.04, 0.12, 0, -0.15];
/** The index finger closes less than the others (the joints' limits, rad), as in any cylinder grip. */
const INDEX_MAX = [1.45, 1.1, 0.75];
/** Where the thumb's tip lies: between the index and middle fingers' tips up the handle (share of the way from the middle's), and round the handle short of the middle's (rad). */
const THUMB_UP = 0.45;
const THUMB_ROUND = -0.15;
/** The thumb's end joint closes this share of its middle joint. */
const THUMB_IP = 0.8;

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
  /** How far round the handle each finger goes, knuckle to tip, index first (rad; QA). */
  wrap: number[];
  /** How far past the middle finger's tip the thumb's tip reaches round the handle (rad; QA). */
  thumbPast: number;
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
  const SI = geo.getAttribute('skinIndex'), SW = geo.getAttribute('skinWeight');
  const rest = asset.restPos;
  const hand = idx('Hand');
  const palm: Array<[number, number, number]> = [];
  const segR = new Map<number, number[]>();
  /** The same along the middle of each segment only (away from the knuckles and, for the thumb, the palm's skin
   * that its weights take in): the thumb's pad. */
  const midR = new Map<number, number[]>();
  const v = new THREE.Vector3();
  for (let i = 0; i < rest.length / 3; i++) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
    if (best < 0) continue;
    v.fromArray(rest, i * 3);
    if (best === hand) { palm.push(coord(v)); continue; }
    const name = asset.bones[best]!.name;
    if (!name.startsWith(side + 'Hand') || !/\d$/.test(name)) continue;
    const child = asset.bones.findIndex((b) => b.parent === best);
    if (child < 0) continue;
    const a = new THREE.Vector3().setFromMatrixPosition(rw[best]!), b = new THREE.Vector3().setFromMatrixPosition(rw[child]!);
    const seg = b.clone().sub(a);
    const t0 = v.clone().sub(a).dot(seg) / seg.lengthSq();
    const t = THREE.MathUtils.clamp(t0, 0, 1);
    let list = segR.get(best);
    if (!list) { list = []; segR.set(best, list); }
    const d = v.distanceTo(a.addScaledVector(seg, t));
    list.push(d);
    if (t0 > 0.2 && t0 < 0.8) {
      let mid = midR.get(best);
      if (!mid) { mid = []; midR.set(best, mid); }
      mid.push(d);
    }
  }
  const radius = (b: number, q = 0.8, from = segR): number => {
    const l = from.get(b);
    if (!l || l.length < 4) return 0.01;
    l.sort((x, y) => x - y);
    return l[Math.min(l.length - 1, Math.floor(l.length * q))]!;
  };
  /** The thumb's outer segments: clear of the grip by their pad's full thickness less 1.5 mm of give. */
  const padR = (b: number): number => Math.max(PRESS * radius(b), radius(b, 0.97, midR) - 0.0015);
  const surf = (f: number, k: number): number => {
    let m = -1;
    for (const [pf, pk, pn] of palm) if ((pf - f) ** 2 + (pk - k) ** 2 < 0.012 * 0.012 && pn > m) m = pn;
    return m < 0 ? 0.02 : m;
  };

  // The handle's axis lies at the base of the fingers, from behind the index finger's knuckle to the hand's far edge, a handle's radius off the palm less
  // what it presses in. On the palm itself the knuckles stood 4-5 cm off the axis, the fingers could only reach it with their tips, and it was a stick on
  // an open hand.
  const [fi, ki] = coord(at('HandIndex1'));
  const [, kp] = coord(at('HandPinky1'));
  const scale = at('HandMiddle1').distanceTo(wrist) / 0.113;
  const tilt = Math.tan(HANDLE_TILT);
  const f1 = fi - AXIS_BACK * scale, k1 = ki, k0 = kp, f0 = f1 - (k1 - k0) * tilt;
  let n0 = 0;
  for (let u = 0; u <= 10; u++) n0 = Math.max(n0, surf(f0 + (f1 - f0) * u / 10, k0 + (k1 - k0) * u / 10));
  const n1 = n0 + HANDLE_R - PALM_SINK;
  n0 += HANDLE_R - PALM_SINK_FAR;
  const pt = (f: number, k: number, n: number): THREE.Vector3 =>
    wrist.clone().addScaledVector(F, f).addScaledVector(K, k).addScaledVector(N, n);
  const A = pt(f1, k1, n1).sub(pt(f0, k0, n0)).normalize();
  // Where the handle leaves the hand: its edge past the little finger's line, by that finger's thickness.
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

  const cyl = (p: THREE.Vector3): [number, number] => {
    const d = p.clone().sub(H0);
    const s = d.dot(A);
    d.addScaledVector(A, -s);
    return [s, Math.atan2(d.dot(S), d.dot(N0))];
  };
  // Finger curls, joint by joint from the knuckle: each turns (about its own flexion axis) until the next joint, or
  // any point of the segment, touches the grip, or until the joint's limit.
  const out: GripSolve = {
    pos, q, bones: [], quats: new Float32Array(0), wrist: new THREE.Vector3(), forearm: new THREE.Vector3(), wristR: 0.035, gaps: [], wrap: [], thumbPast: 0,
  };
  const qs: number[] = [];
  const finish = (ids: number[], curl: THREE.Quaternion[], w: THREE.Matrix4[]): THREE.Matrix4[] => {
    if (out.wrap.length < 4) {
      let round = 0, last = NaN;
      for (const m of w) {
        const [, ph] = cyl(new THREE.Vector3().setFromMatrixPosition(m));
        if (!Number.isNaN(last)) { let d = ph - last; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; round += Math.abs(d); }
        last = ph;
      }
      out.wrap.push(round);
    }
    for (let j = 1; j < w.length; j++) out.gaps.push(offAxis(new THREE.Vector3().setFromMatrixPosition(w[j]!)) - HANDLE_R);
    for (let j = 0; j < ids.length; j++) {
      out.bones.push(ids[j]!);
      const lq = new THREE.Quaternion().fromArray(asset.bones[ids[j]!]!.quat).multiply(curl[j]!);
      qs.push(lq.x, lq.y, lq.z, lq.w);
    }
    return w;
  };
  const chain = (names: string[], max: number[], converge: number): THREE.Matrix4[] => {
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
    // Each joint's flexion axis in its own frame, from the rest pose.
    const w0 = worldAt();
    // A finger's flexion, turned about the palm's normal from where it lies at rest onto the handle.
    const turn = new THREE.Quaternion();
    const hinge = new THREE.Vector3();
    {
      const a0 = new THREE.Vector3().setFromMatrixPosition(w0[0]!), b0 = new THREE.Vector3().setFromMatrixPosition(w0[1]!);
      hinge.crossVectors(b0.clone().sub(a0).normalize(), N).normalize();
      const along = A.clone().addScaledVector(N, -A.dot(N)).normalize();
      const across = new THREE.Vector3().crossVectors(along, N);
      if (along.dot(hinge) < 0) along.negate();
      const qw = new THREE.Quaternion().setFromUnitVectors(hinge, hinge.clone().lerp(along, FINGER_TURN).normalize());
      // (about the line across the handle through the knuckle: a turn about the palm's normal tips the plane the finger closes in, so it leaves its line one way
      // at the middle joint and comes back at the tip)
      qw.premultiply(new THREE.Quaternion().setFromAxisAngle(across, converge));
      const r0q = new THREE.Quaternion();
      w0[0]!.decompose(v, r0q, sc);
      turn.copy(r0q).invert().multiply(qw).multiply(r0q);
    }
    const axes = ids.map((_, j) => {
      const a = new THREE.Vector3().setFromMatrixPosition(w0[j]!);
      const b = new THREE.Vector3().setFromMatrixPosition(w0[j + 1] ?? w0[j]!);
      const axisW = new THREE.Vector3().crossVectors(b.sub(a).normalize(), N).normalize();
      const rq = new THREE.Quaternion();
      w0[j]!.decompose(v, rq, sc);
      return axisW.applyQuaternion(rq.invert());
    });
    // How far each segment's bone line keeps from the handle's axis: a finger pressed in a little (PRESS of its radius).
    const R = ids.map((b) => HANDLE_R + PRESS * radius(b));
    const ang = ids.map(() => 0);
    const set = (): void => { for (let j = 0; j < ids.length; j++) { curl[j]!.setFromAxisAngle(axes[j]!, ang[j]!); if (j === 0) curl[j]!.premultiply(turn); } };
    {
      // From the knuckle out, each joint closes until its segment is on the grip. A straight segment can only touch at one place, so the joint between two
      // stands proud of the surface by what half the next segment's chord leaves: closed until the joint itself touched, the next segment had nowhere to go
      // but away, and the finger was a claw.
      const seg = ids.map((_, j) => {
        const wm = worldAt();
        return new THREE.Vector3().setFromMatrixPosition(wm[j]!).distanceTo(new THREE.Vector3().setFromMatrixPosition(wm[j + 1] ?? wm[j]!));
      });
      for (let j = 0; j < ids.length; j++) {
        const stand = j + 1 < ids.length ? Math.hypot(R[j + 1]!, 0.5 * seg[j + 1]!) : 0;
        for (let step = 0; step < 240 && ang[j]! < max[j]!; step++) {
          ang[j] = Math.min(max[j]!, ang[j]! + 0.01);
          set();
          const wm = worldAt();
          const p0 = new THREE.Vector3().setFromMatrixPosition(wm[j]!), p1 = new THREE.Vector3().setFromMatrixPosition(wm[j + 1] ?? wm[j]!);
          let near = Infinity;
          for (let u = 1; u <= 4; u++) near = Math.min(near, offAxis(p0.clone().lerp(p1, u / 4)));
          if (near <= R[j]! || (stand > 0 && offAxis(p1) <= stand)) break;
        }
      }
      set();
    }
    return finish(ids, curl, worldAt());
  };
  let index: THREE.Matrix4[] = [], middle: THREE.Matrix4[] = [];
  FINGERS.forEach((f, i) => {
    const w = chain([`Hand${f}1`, `Hand${f}2`, `Hand${f}3`], i === 0 ? INDEX_MAX : FINGER_MAX, FINGER_CONVERGE[i]!);
    if (f === 'Index') index = w;
    if (f === 'Middle') middle = w;
  });
  // The thumb closes over the side of the handle, part of the way round towards the fingers (the continental grip's
  // thumb on the bevel beside the index finger) and up the handle: its tip goes to a point on the grip's surface
  // round from where the thumb starts, never across the handle (a straight reach went through it).
  // It crosses the front of the handle between the index and middle fingers, to meet the middle finger's tip.
  const [si] = cyl(new THREE.Vector3().setFromMatrixPosition(index[3]!));
  const [sm, pm] = cyl(new THREE.Vector3().setFromMatrixPosition(middle[3]!));
  const phiG = pm + THUMB_ROUND;
  const rG = HANDLE_R + padR(idx('HandThumb3')) + 0.002;
  const sG = sm + (si - sm) * THUMB_UP;
  const goalAt = (phi: number): THREE.Vector3 => H0.clone().addScaledVector(A, sG).addScaledVector(N0, rG * Math.cos(phi)).addScaledVector(S, rG * Math.sin(phi));

  // The thumb is laid out rather than searched for: a chain from its base, which turns freely, over the handle to that point, its two outer joints hinges, with the pad
  // turned to the handle. (By descent on the joints it snaked, or stood off the handle, and each tip reached was a different thumb.)
  {
    const ids = ['HandThumb1', 'HandThumb2', 'HandThumb3'].map(idx);
    const tipB = asset.bones.findIndex((b) => b.parent === ids[2]);
    const P = [...ids, tipB].map((b) => new THREE.Vector3().setFromMatrixPosition(rw[b]!));
    const L = [0, 1, 2].map((j) => P[j]!.distanceTo(P[j + 1]!));
    const u = P[3]!.clone().sub(P[0]!).normalize();
    // The pad: where the end joint's skin lies from its bone (the bone runs near the thumb's back).
    const pad = new THREE.Vector3();
    for (let i = 0; i < rest.length / 3; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      if (best !== ids[2]) continue;
      v.fromArray(rest, i * 3).sub(P[2]!);
      pad.add(v.addScaledVector(u, -v.dot(u)));
    }
    if (pad.lengthSq() < 1e-8) pad.copy(N);
    const p = pad.addScaledVector(u, -pad.dot(u)).normalize();
    const hinge = new THREE.Vector3().crossVectors(u, p);
    const layout = (G: THREE.Vector3): { dir: THREE.Vector3[]; bend: THREE.Vector3; h: THREE.Vector3; th: number; clear: number } => {
      const chord = G.clone().sub(P[0]!), D = chord.length();
      const x = chord.clone().normalize();
      const mid = P[0]!.clone().add(G).multiplyScalar(0.5).sub(H0);
      const y = mid.addScaledVector(A, -mid.dot(A));
      y.addScaledVector(x, -y.dot(x)).normalize();
      const shape = (t: number): [number, number] => [L[0]! + L[1]! * Math.cos(t) + L[2]! * Math.cos(t * (1 + THUMB_IP)), -L[1]! * Math.sin(t) - L[2]! * Math.sin(t * (1 + THUMB_IP))];
      let lo = 0, hi = 1.5;
      for (let k = 0; k < 24; k++) { const t = 0.5 * (lo + hi), [a, b] = shape(t); if (Math.hypot(a, b) > D) lo = t; else hi = t; }
      const th = 0.5 * (lo + hi);
      const [sx, sy] = shape(th), al = -Math.atan2(sy, sx);
      const at = (a: number): THREE.Vector3 => x.clone().multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a));
      const dir = [at(al), at(al - th), at(al - th * (1 + THUMB_IP))];
      let q = P[0]!.clone(), clear = Infinity;
      for (let j = 0; j < 3; j++) {
        const e = q.clone().addScaledVector(dir[j]!, L[j]!);
        if (j > 0) for (let k = 1; k <= 4; k++) clear = Math.min(clear, offAxis(q.clone().lerp(e, k / 4)) - HANDLE_R - padR(ids[j]!));
        q = e;
      }
      const bend = at(al - Math.PI / 2);
      return { dir, bend, h: new THREE.Vector3().crossVectors(dir[0]!, bend), th, clear };
    };
    // Its tip goes as far round as it can without the thumb going into the grip.
    let lay = layout(goalAt(phiG));
    for (let k = 1; k <= 8 && lay.clear < -0.001; k++) lay = layout(goalAt(phiG + k * 0.07));
    const qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lay.dir[0]!, lay.bend, lay.h).multiply(new THREE.Matrix4().makeBasis(u, p, hinge).transpose()));
    const rq = (b: number): THREE.Quaternion => new THREE.Quaternion().setFromRotationMatrix(rw[b]!);
    const curl = [
      rq(ids[0]!).invert().multiply(qw).multiply(rq(ids[0]!)),
      new THREE.Quaternion().setFromAxisAngle(hinge.clone().applyQuaternion(rq(ids[1]!).invert()), lay.th),
      new THREE.Quaternion().setFromAxisAngle(hinge.clone().applyQuaternion(rq(ids[2]!).invert()), lay.th * THUMB_IP),
    ];
    const w: THREE.Matrix4[] = [];
    let m = rw[asset.bones[ids[0]!]!.parent]!.clone();
    [...ids, tipB].forEach((b, j) => {
      m = m.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3().fromArray(asset.bones[b]!.pos), new THREE.Quaternion().fromArray(asset.bones[b]!.quat), new THREE.Vector3(1, 1, 1)));
      if (j < 3) m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(curl[j]!));
      w.push(m);
    });
    finish(ids, curl, w);
    let past = cyl(new THREE.Vector3().setFromMatrixPosition(w[3]!))[1] - pm;
    while (past > Math.PI) past -= 2 * Math.PI;
    while (past < -Math.PI) past += 2 * Math.PI;
    out.thumbPast = -past;
  }
  out.quats = Float32Array.from(qs);

  // The wrist's thickness: forearm skin within 4 cm of the wrist joint, its furthest from the forearm's axis.
  {
    const fa = idx('ForeArm');
    const fd = wrist.clone().sub(at('ForeArm')).normalize();
    let r = 0;
    for (let i = 0; i < rest.length / 3; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      if (best !== fa) continue;
      v.fromArray(rest, i * 3).sub(wrist);
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
