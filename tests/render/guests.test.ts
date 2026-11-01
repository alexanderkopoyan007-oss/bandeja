// The generated people (tools/assets/meshy/): one fused surface each on the game skeleton, their joints fitted to their own bodies.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { GUESTS, guestAsset, mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const guests = GUESTS.map((n) => guestAsset(n, base));
const J = (a: (typeof guests)[number], n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);

describe('the generated people', () => {
  it.each(GUESTS)('%s stands on the game skeleton with a human build', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const h = a.look!.height;
    expect(a.look!.kit.baked).toBe(true);
    expect(a.bones.length).toBe(base.bones.length);
    // Standing proportions, as shares of the height: hips, shoulders, arm and leg lengths, both sides alike.
    expect(J(a, 'Hips').y / h).toBeGreaterThan(0.5);
    expect(J(a, 'Hips').y / h).toBeLessThan(0.6);
    expect(J(a, 'LeftArm').y / h).toBeGreaterThan(0.74);
    expect(J(a, 'LeftArm').y / h).toBeLessThan(0.84);
    for (const [from, to, lo, hi] of [['LeftArm', 'LeftForeArm', 0.11, 0.19], ['LeftForeArm', 'LeftHand', 0.13, 0.19], ['LeftUpLeg', 'LeftLeg', 0.22, 0.29], ['LeftLeg', 'LeftFoot', 0.18, 0.25]] as const) {
      const d = J(a, from).distanceTo(J(a, to)) / h;
      expect(d).toBeGreaterThan(lo);
      expect(d).toBeLessThan(hi);
      expect(J(a, from.replace('Left', 'Right')).distanceTo(J(a, to.replace('Left', 'Right'))) / h).toBeCloseTo(d, 2);
    }
  });

  // A flattened waist laps over its own other end with no triangle flipped: two parts of the body share texels and the second shows as shards
  // of the first (decimate-bake.py `overlaps`). Every texel's centre lies in one triangle only.
  it.each(GUESTS)('no two parts of %s share the texture', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const geo = a.geometry;
    const uv = geo.getAttribute('uv'), idx = geo.index!;
    const N = 1024, seen = new Int32Array(N * N).fill(-1);
    let shared = 0, covered = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const p = [0, 1, 2].map((k) => { const i = idx.getX(t + k); return [uv.getX(i) * N, uv.getY(i) * N] as const; });
      const x0 = Math.max(0, Math.floor(Math.min(p[0]![0], p[1]![0], p[2]![0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(p[0]![0], p[1]![0], p[2]![0])));
      const y0 = Math.max(0, Math.floor(Math.min(p[0]![1], p[1]![1], p[2]![1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(p[0]![1], p[1]![1], p[2]![1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const s = [0, 1, 2].map((i) => { const a_ = p[i]!, b = p[(i + 1) % 3]!; return (b[0] - a_[0]) * (y + 0.5 - a_[1]) - (b[1] - a_[1]) * (x + 0.5 - a_[0]); });
        if ((s[0]! >= 0 && s[1]! >= 0 && s[2]! >= 0) || (s[0]! <= 0 && s[1]! <= 0 && s[2]! <= 0)) {
          if (seen[y * N + x]! >= 0 && seen[y * N + x] !== t) shared++;
          else covered++;
          seen[y * N + x] = t;
        }
      }
    }
    expect(shared / covered).toBeLessThan(0.0005);
  });

  // Modelled with the arms down, the sleeve fuses to the ribs: lifted, the arm comes out of a hole and half the sleeve stays behind, which the owner
  // read as an arm on backwards (804 cm2 stretched on the first woman). Joint numbers can't see it: this measures the skin. Modelled in a T: 42, and 13.
  it.each(GUESTS)('the skin of %s stays on the arm when the arm goes overhead', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const arm = a.bone('RightArm'), S = new THREE.Vector3().setFromMatrixPosition(a.restWorld[arm]!);
    const raised = new Set([arm]);
    for (let grew = true; grew;) { grew = false; a.bones.forEach((b, i) => { if (b.parent >= 0 && raised.has(b.parent) && !raised.has(i)) { raised.add(i); grew = true; } }); }
    const about = new THREE.Matrix4().makeTranslation(S.x, S.y, S.z).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 3)).multiply(new THREE.Matrix4().makeTranslation(-S.x, -S.y, -S.z));
    const Ms = a.restWorld.map((m, i) => (raised.has(i) ? about.clone().multiply(m) : m.clone()).multiply(a.boneInverses[i]!));
    const geo = a.geometry, P = geo.getAttribute('position'), I = geo.getAttribute('skinIndex'), W = geo.getAttribute('skinWeight'), idx = geo.index!;
    const moved = new Float32Array(P.count * 3), v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      o.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = W.getComponent(i, k); if (w > 0) o.addScaledVector(v.fromBufferAttribute(P, i).applyMatrix4(Ms[I.getComponent(i, k)]!), w); }
      o.toArray(moved, i * 3);
    }
    const r = [0, 1, 2].map(() => new THREE.Vector3()), q = [0, 1, 2].map(() => new THREE.Vector3());
    const area = (t: THREE.Vector3[]): number => new THREE.Vector3().subVectors(t[1]!, t[0]!).cross(new THREE.Vector3().subVectors(t[2]!, t[0]!)).length() / 2;
    let stretched = 0;
    for (let t = 0; t < idx.count; t += 3) {
      for (let k = 0; k < 3; k++) { const i = idx.getX(t + k); r[k]!.fromBufferAttribute(P, i); q[k]!.fromArray(moved, i * 3); }
      if (q[0]!.x * S.x < 0 && Math.abs(q[0]!.y - S.y) > 0.5) continue; // (the other side of the body, away from the arm)
      let st = 0;
      for (let k = 0; k < 3; k++) { const e = (k + 1) % 3; st = Math.max(st, q[k]!.distanceTo(q[e]!) / Math.max(r[k]!.distanceTo(r[e]!), 1e-4)); }
      if (st > 1.8 && area(q) > area(r)) stretched += area(q) - area(r);
    }
    expect(stretched * 1e4).toBeLessThan(80);
  });

  // One painted surface, so a face moves only by p1's keys carried across (rig.py), and the kit's colours only by a mask (kit-mask.py).
  it.each(GUESTS)('%s has a face that moves and a kit to colour', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const { kit, morphs, face, height } = a.look!;
    expect(kit.shirtLum).toBeGreaterThan(0);
    expect(kit.shortsLum).toBeGreaterThan(0);
    expect(face).not.toBeNull();
    const f = face!, P = a.geometry.getAttribute('position');
    expect(f.verts.length).toBeGreaterThan(300);
    // The face and neck and nothing else: a key that reached the shirt would drag the collar.
    let lowest = Infinity;
    for (const v of f.verts) lowest = Math.min(lowest, P.getY(v));
    expect(lowest / height).toBeGreaterThan(0.72);
    // The lips part: over the mouth the skin stays, under it the jaw takes it down (with only one key's nearest skin they smeared).
    const m = kit.mouth!, jaw = f.pos[morphs.indexOf('jawOpen')]!;
    let over = 0, under = 0;
    f.verts.forEach((v, i) => {
      if (Math.abs(P.getX(v)) > 0.015 || P.getZ(v) < m[2] - 0.02) return;
      const up = P.getY(v) - m[1];
      if (up > 0.004 && up < 0.02) over = Math.max(over, -jaw[i * 3 + 1]!);
      if (up < -0.004 && up > -0.02) under = Math.max(under, -jaw[i * 3 + 1]!);
    });
    expect(under).toBeGreaterThan(0.02);
    expect(over).toBeLessThan(under * 0.5);
    // Both eyes level, the mouth under them on the middle: the drawn lid and lips land on the paint.
    expect(kit.eye![0]).toBeGreaterThan(0.025);
    expect(kit.eye![0]).toBeLessThan(0.045);
    expect((kit.eye![1] - m[1]) / height).toBeGreaterThan(0.03);
    expect((kit.eye![1] - m[1]) / height).toBeLessThan(0.056);
  });

  it.each(GUESTS)('%s moves as cleanly as the regular cast', (name) => {
    const r = runAnimQa(guests[GUESTS.indexOf(name)]!, { seed: 14601, seconds: 30, repeatEvery: 7 } as never);
    expect(r.pops.perMinute).toBeLessThan(32);
  }, 300000);
});
