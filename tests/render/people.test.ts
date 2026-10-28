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
      expect(p.geometry.getAttribute('position').count).toBeLessThan(20000);
    }
  });

  it('stands at its height on the floor, arms out level as the game skeleton rests', () => {
    for (const p of base.people) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array;
      let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < r.length / 3; v++) {
        lo = Math.min(lo, r[v * 3 + 1]!);
        if (A[v * 3 + 2]! > 0.5) hi = Math.max(hi, r[v * 3 + 1]!);
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
      // Within a few cm of the mannequin's joints, so its clips and strokes fit (the hips scaled in the clips).
      expect(Math.abs(at(p, 'Hips').y - at(base, 'Hips').y)).toBeLessThan(0.07);
      expect(Math.abs(at(p, 'RightHand').x - at(base, 'RightHand').x)).toBeLessThan(0.06);
    }
  });

  it('dresses skin, shirt, shorts and shoes', () => {
    for (const p of base.people) {
      const A = p.geometry.getAttribute('bodyA').array as Float32Array, B = p.geometry.getAttribute('bodyB').array as Float32Array;
      const n = A.length / 3;
      const count = (arr: Float32Array, k: number): number => { let c = 0; for (let v = 0; v < n; v++) if (arr[v * 3 + k]! > 0.5) c++; return c; };
      expect(count(A, 2)).toBeGreaterThan(5000); // skin
      expect(count(A, 0)).toBeGreaterThan(1500); // shirt
      expect(count(A, 1)).toBeGreaterThan(300); // shorts
      expect(count(B, 1)).toBeGreaterThan(500); // shoes
      expect(count(B, 0)).toBeGreaterThan(50); // socks
      expect([P_SKIN, P_SHIRT, P_SHOE]).toEqual([0, 1, 3]);
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
        expect(inside).toBeLessThan(25);
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
      expect(r.clip.legs).toBeLessThan(0.05);
      expect(r.serve.handTorso).toBeLessThan(0.005);
      expect(r.serve.racketBody).toBeLessThan(0.015);
      expect(r.serve.popsPerMinute).toBeLessThan(25);
      expect(r.pops.worst.filter((e) => e.value >= 105)).toEqual([]);
      expect(r.pops.kneeSpins).toEqual([]);
      expect(r.repeat.maxDeg).toBeLessThan(0.01);
    }, 120_000);
  }
});
