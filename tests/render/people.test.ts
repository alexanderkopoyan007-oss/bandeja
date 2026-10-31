// The people the players are dressed as (public/assets/people/, built by tools/assets/mpfb/build-all.sh): each on the
// game skeleton, standing at its height on the floor in the game skeleton's T-pose, holding the racket as the
// mannequin does, and animating inside the mannequin's QA limits. Measured 2026-10-28, 60 s of seed 1 doubles each
// (mannequin first): skate 17.2 | 14.5 12.8 13.4 13.8 cm/s, contact p50 7.2 | 5.9-8.3 mm, pops 23.3 | 18.3-22.5 per
// player-minute, racket in body 0.13 | 0.21-0.27%, hand in torso 0.09 | 0.25-0.41%, no flips or knee spins. Grip:
// fingertips 6.4-11.3 mm off the handle (mannequin 8.1-12.8), the thumb's tip 21-23 mm (its middle joint 7-8 mm on
// the grip; mannequin 14 mm).
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople } from './people.ts';
import { PEOPLE, P_SHIRT, P_SHOE, P_SKIN } from '../../src/render/avatar/asset.ts';
import { solveGrip } from '../../src/render/avatar/grip.ts';
import { HANDLE_R } from '../../src/render/avatar/racket.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';

describe('people', () => {
  const base = mannequinWithPeople();
  const at = (a: typeof base, n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);

  it('every person is on the game skeleton, with its atlases', () => {
    expect(base.people.map((p) => p.look!.name)).toEqual(PEOPLE);
    for (const p of base.people) {
      expect(p.bones.map((b) => b.name)).toEqual(base.bones.map((b) => b.name));
      // The same rest rotations, so every clip and stroke drives the body unchanged.
      p.bones.forEach((b, i) => expect(b.quat).toEqual(base.bones[i]!.quat));
      for (const f of Object.values(p.look!.textures)) expect(existsSync(new URL('../../public/assets/people/' + f, import.meta.url))).toBe(true);
      expect(p.look!.alphaGeometry.getAttribute('uv').count).toBeGreaterThan(500);
      expect(p.geometry.getAttribute('position').count).toBeLessThan(22000);
      // WebGPU binds at most 8 vertex buffers: skinning's 5 and the person's 3 (bodyA, bodyB, bodyX).
      const custom = Object.keys(p.geometry.attributes).filter((k) => !['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'].includes(k));
      expect(custom.sort()).toEqual(['bodyA', 'bodyB', 'bodyX']);
    }
  });

  it('stands at its height on the floor, arms out level as the game skeleton rests', () => {
    for (const p of base.people) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array;
      let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < r.length / 3; v++) {
        lo = Math.min(lo, r[v * 3 + 1]!);
        if (A[v * 4 + 2]! > 0.5) hi = Math.max(hi, r[v * 3 + 1]!);
      }
      expect(Math.abs(lo)).toBeLessThan(0.005);
      expect(Math.abs(hi - p.look!.height)).toBeLessThan(0.02);
      for (const s of ['Left', 'Right']) {
        const arm = at(p, s + 'Arm'), hand = at(p, s + 'Hand');
        expect(Math.abs(hand.y - arm.y)).toBeLessThan(0.01);
        expect(Math.abs(hand.z - arm.z)).toBeLessThan(0.01);
        // The legs straight down.
        const hip = at(p, s + 'UpLeg'), foot = at(p, s + 'Foot');
        expect(Math.hypot(foot.x - hip.x, foot.z - hip.z)).toBeLessThan(0.03);
      }
      // Within a few cm of the mannequin's joints, so its clips and strokes fit (the hips scaled in the clips). The
      // women are 6-14 cm shorter, with arms 8-11 cm shorter: the swing still meets the ball (Avatar.jumpMore, measured
      // with tools/anim-check on the shortest: smash p90 5 cm, the rest as the men's).
      expect(Math.abs(at(p, 'Hips').y - at(base, 'Hips').y)).toBeLessThan(0.09);
      expect(Math.abs(at(p, 'RightHand').x - at(base, 'RightHand').x)).toBeLessThan(0.12);
    }
  });

  it('dresses skin, shirt, shorts and shoes', () => {
    for (const p of base.people) {
      const A = p.geometry.getAttribute('bodyA').array as Float32Array, B = p.geometry.getAttribute('bodyB').array as Float32Array;
      const n = A.length / 4;
      const count = (arr: Float32Array, k: number): number => { let c = 0; for (let v = 0; v < n; v++) if (arr[v * 4 + k]! > 0.5) c++; return c; };
      expect(count(A, 2)).toBeGreaterThan(5000); // skin
      expect(count(A, 0)).toBeGreaterThan(900); // shirt (a tank has no sleeves)
      expect(count(A, 1)).toBeGreaterThan(250); // shorts
      expect(count(B, 0)).toBeGreaterThan(500); // shoes
      expect(count(A, 3)).toBeGreaterThan(50); // socks
      expect(count(B, 1)).toBeGreaterThan(400); // eyes
      expect(count(B, 2)).toBeGreaterThan(1000); // teeth
      expect(count(B, 3)).toBeGreaterThan(100); // tongue
      expect([P_SKIN, P_SHIRT, P_SHOE]).toEqual([0, 1, 3]);
    }
  });

  // Review round 3, critic #3: the thigh's skin ended 0.4-4 cm below the shorts' hem, so there was a ring of nothing
  // between the leg and the shorts, and the court showed through the back of the knee. It now goes on up inside
  // the shorts' legs, all round (the leg in eight sectors about the hem's middle, the back of the knee included).
  it('has skin under the shorts all round each leg, a few cm up inside the hem', () => {
    for (const p of base.people) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array, X = p.geometry.getAttribute('bodyX').array as Float32Array;
      const n = r.length / 3;
      // (the shorts themselves: a skirt's cloth, bodyX.x above 0, hangs clear of the leg, over the inner shorts)
      const shorts = (v: number): boolean => A[v * 4 + 1]! > 0.5 && X[v * 4]! === 0;
      for (const side of [-1, 1]) {
        const leg = (v: number): boolean => Math.sign(r[v * 3]!) === side && r[v * 3 + 1]! < 0.95;
        let hem = Infinity;
        for (let v = 0; v < n; v++) if (shorts(v) && leg(v)) hem = Math.min(hem, r[v * 3 + 1]!);
        let cx = 0, cz = 0, c = 0;
        for (let v = 0; v < n; v++) if (shorts(v) && leg(v) && r[v * 3 + 1]! < hem + 0.06) { cx += r[v * 3]!; cz += r[v * 3 + 2]!; c++; }
        cx /= c; cz /= c;
        const top = new Array(8).fill(-1);
        for (let v = 0; v < n; v++) {
          const x = r[v * 3]!, y = r[v * 3 + 1]!, z = r[v * 3 + 2]!;
          if (A[v * 4 + 2]! < 0.5 || Math.sign(x) !== side || Math.abs(x) < 0.01 || y < hem - 0.05 || y > hem + 0.2) continue;
          const b = Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / (2 * Math.PI)) * 8) % 8;
          top[b] = Math.max(top[b], y - hem);
        }
        // (measured 30 Oct, all ten: 3.6-9.0 cm in every one of the eight sectors. With the hems at mid-thigh the inside of the thigh a
        // little way up lies 1-3 cm from the middle, so the midline is kept clear by only 1 cm: at 4 cm the inner sectors read -1 cm or
        // nothing, though the skin was there)
        expect(top.filter((t) => t > 0.03).length).toBe(8);
      }
    }
  });

  it('has a face: expression and gaze keys on a small face mesh, lids that close, eyes that turn about their centres', () => {
    for (const p of base.people) {
      const look = p.look!;
      expect(look.morphs).toEqual(expect.arrayContaining(['blinkL', 'blinkR', 'jawOpen', 'smile', 'browDown', 'lookLeft', 'lookUp', 'lookDown']));
      const f = look.face!;
      expect(f.verts.length).toBeLessThan(p.geometry.getAttribute('position').count * 0.5);
      expect(f.pos.length).toBe(look.morphs.length);
      // A blink moves the upper lid about 1-2 cm and nothing below the nose.
      const k = look.morphs.indexOf('blinkL');
      let most = 0, lowest = Infinity;
      for (let j = 0; j < f.verts.length; j++) {
        const d = Math.hypot(f.pos[k]![j * 3]!, f.pos[k]![j * 3 + 1]!, f.pos[k]![j * 3 + 2]!);
        if (d > 1e-4) lowest = Math.min(lowest, p.restPos[f.verts[j]! * 3 + 1]!);
        most = Math.max(most, d);
      }
      expect(most).toBeGreaterThan(0.006);
      expect(most).toBeLessThan(0.03);
      expect(lowest).toBeGreaterThan(look.height - 0.2);
      // Looking left turns each eyeball rigidly about its own centre: distances within it are kept, and its centre
      // stays put (a turn about a point off the centre swings the eyeball into the lids).
      const B = p.geometry.getAttribute('bodyB').array as Float32Array;
      const L = look.morphs.indexOf('lookLeft');
      const eye = [] as number[];
      for (let j = 0; j < f.verts.length; j++) if (B[f.verts[j]! * 4 + 1]! > 0.5) eye.push(j);
      expect(eye.length).toBeGreaterThan(200);
      const at0 = (j: number, a: number): number => p.restPos[f.verts[j]! * 3 + a]!;
      const at1 = (j: number, a: number): number => at0(j, a) + f.pos[L]![j * 3 + a]!;
      for (const side of [1, -1]) {
        const ids = eye.filter((j) => at0(j, 0) * side > 0);
        let worst = 0, moved = 0;
        for (let k = 0; k < ids.length; k++) {
          const a = ids[k]!, b = ids[(k * 7 + 3) % ids.length]!;
          const d0 = Math.hypot(at0(a, 0) - at0(b, 0), at0(a, 1) - at0(b, 1), at0(a, 2) - at0(b, 2));
          const d1 = Math.hypot(at1(a, 0) - at1(b, 0), at1(a, 1) - at1(b, 1), at1(a, 2) - at1(b, 2));
          worst = Math.max(worst, Math.abs(d1 - d0));
          moved = Math.max(moved, Math.hypot(f.pos[L]![a * 3]!, f.pos[L]![a * 3 + 1]!, f.pos[L]![a * 3 + 2]!));
        }
        expect(worst).toBeLessThan(0.0003);
        expect(moved).toBeGreaterThan(0.005);
        // The eyeball's sphere (least squares: |p|^2 = 2 p.c + d), and every vertex's distance from its centre kept.
        const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], rhs = [0, 0, 0, 0];
        for (const j of ids) {
          const row = [2 * at0(j, 0), 2 * at0(j, 1), 2 * at0(j, 2), 1];
          const y = at0(j, 0) ** 2 + at0(j, 1) ** 2 + at0(j, 2) ** 2;
          for (let r = 0; r < 4; r++) { rhs[r]! += row[r]! * y; for (let c = 0; c < 4; c++) N[r]![c]! += row[r]! * row[c]!; }
        }
        for (let i = 0; i < 4; i++) for (let r = i + 1; r < 4; r++) {
          const f = N[r]![i]! / N[i]![i]!;
          for (let c = i; c < 4; c++) N[r]![c]! -= f * N[i]![c]!;
          rhs[r]! -= f * rhs[i]!;
        }
        const sol = [0, 0, 0, 0];
        for (let i = 3; i >= 0; i--) { let t = rhs[i]!; for (let c = i + 1; c < 4; c++) t -= N[i]![c]! * sol[c]!; sol[i] = t / N[i]![i]!; }
        let drift = 0;
        for (const j of ids) {
          const r0 = Math.hypot(at0(j, 0) - sol[0]!, at0(j, 1) - sol[1]!, at0(j, 2) - sol[2]!);
          const r1 = Math.hypot(at1(j, 0) - sol[0]!, at1(j, 1) - sol[1]!, at1(j, 2) - sol[2]!);
          drift = Math.max(drift, Math.abs(r1 - r0));
        }
        expect(drift).toBeLessThan(0.0004);
      }
    }
  });

  it('holds the racket: fingers closed onto the handle, the posed hand out of it', () => {
    interface GV { hand: THREE.Bone; pos: THREE.Vector3; q: THREE.Quaternion; bones: number[]; quats: Float32Array }
    for (const p of base.people) {
      const r = solveGrip(p, 'Right'), l = solveGrip(p, 'Left');
      for (let k = 0; k < r.gaps.length; k++) {
        expect(r.gaps[k]!).toBeGreaterThan(0);
        expect(Math.abs(r.gaps[k]! - l.gaps[k]!)).toBeLessThan(0.004);
      }
      for (const k of [2, 5, 8, 11, 14]) expect(r.gaps[k]!).toBeLessThan(0.025);
      expect(r.wrist.y).toBeLessThan(-0.25);
      const av = new Avatar(p, 0xffffff) as unknown as { root: THREE.Object3D; bones: THREE.Bone[]; grips: GV[]; mesh: THREE.SkinnedMesh };
      for (const g of av.grips) for (let k = 0; k < g.bones.length; k++) av.bones[g.bones[k]!]!.quaternion.fromArray(g.quats, k * 4);
      av.root.updateMatrixWorld(true);
      av.mesh.skeleton.update();
      for (const g of av.grips) {
        const inv = g.hand.matrixWorld.clone().multiply(new THREE.Matrix4().compose(g.pos, g.q, new THREE.Vector3(1, 1, 1))).invert();
        const v = new THREE.Vector3();
        let inside = 0, deepest = 0;
        for (let i = 0; i < av.mesh.geometry.getAttribute('position').count; i++) {
          av.mesh.getVertexPosition(i, v);
          v.applyMatrix4(av.mesh.matrixWorld).applyMatrix4(inv);
          if (v.y > -0.17 || v.y < -0.31) continue;
          const d = HANDLE_R - Math.hypot(v.x, v.z);
          if (d > 0) { inside++; deepest = Math.max(deepest, d); }
        }
        // The mannequin's limit, with 1.5 mm more for the ball of the thumb: MPFB's thumb is short and soft, and its
        // proximal pad presses 4.5-4.8 mm into the grip where it wraps (the mannequin's deepest is 2.1 mm).
        expect(inside).toBeLessThan(32);
        expect(deepest).toBeLessThan(0.0055);
      }
    }
  });

  for (const name of PEOPLE) {
    it(`animates inside the mannequin's limits: ${name}`, () => {
      const p = base.people.find((x) => x.look!.name === name)!;
      const r = runAnimQa(p, { seed: 1, seconds: 60, lefty: [], repeatEvery: 7 });
      expect(r.feet.skate).toBeLessThan(25);
      expect(r.feet.belowShare).toBeLessThan(0.001);
      expect(r.feet.planted.p50).toBeLessThan(0.01);
      expect(r.contact.dist.p50).toBeLessThan(0.015);
      expect(r.contact.dist.p90).toBeLessThan(0.12);
      expect(r.contact.lag.p50).toBeLessThan(0.009);
      expect(r.pops.perMinute).toBeLessThan(30);
      expect(r.clip.racketBody).toBeLessThan(0.01);
      expect(r.clip.handTorso).toBeLessThan(0.035);
      // (six seeds, p7 and p10: 3.6-5.6%, and 3.8-5.4 before the glass misread; men about 1.3. Seed 1 alone sat at 3.8-5.6.)
      expect(r.clip.legs).toBeLessThan(0.06);
      expect(r.serve.handTorso).toBeLessThan(0.005);
      expect(r.serve.racketBody).toBeLessThan(0.015);
      // (12 s of serving: one pop more is 5 a minute. The mannequin keeps its 25 in animQa.test.ts; p10 at 25.9 here was
      // 11.2 over 180 s.)
      expect(r.serve.popsPerMinute).toBeLessThan(45);
      expect(r.pops.worst.filter((e) => e.value >= 105)).toEqual([]);
      expect(r.pops.kneeSpins).toEqual([]);
      expect(r.repeat.maxDeg).toBeLessThan(0.01);
    }, 120_000);
  }
});
