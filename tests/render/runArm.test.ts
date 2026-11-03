import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { mannequinWithPeople } from './people.ts';

// A fast run's free arm swings fore and aft beside the body, its elbow behind, not out like a wing (review round 33, #9: the upper arm
// over 45 degrees out from the trunk in 18% of frames over 2.8 m/s, against 15-25 for a real running arm, from memory).
describe('the free arm in a fast run', () => {
  const p = mannequinWithPeople().people[0]!;
  const sl = new THREE.Vector3(), sr = new THREE.Vector3(), el = new THREE.Vector3(), nk = new THREE.Vector3(), hp = new THREE.Vector3();
  const out: number[] = [];
  runAnimQa(p, { seed: 9, seconds: 300, lefty: [], onFrame: (_m, av) => {
    for (const raw of av) {
      const t = raw as unknown as { armL: THREE.Bone[]; armR: THREE.Bone[]; hips: THREE.Bone; sp: number; gaitRun: number; gaitW: number };
      if (!(t.gaitRun > 0 && t.gaitW > 0.9 && t.sp > 2.8)) continue;
      t.armL[1]!.updateWorldMatrix(true, false);
      t.armR[0]!.updateWorldMatrix(true, false);
      t.armL[0]!.getWorldPosition(sl); t.armR[0]!.getWorldPosition(sr); t.armL[1]!.getWorldPosition(el); t.hips.getWorldPosition(hp);
      // The trunk's side axis (to the free, left, side) square to its up axis, hips to between the shoulders.
      nk.copy(sl).add(sr).multiplyScalar(0.5).sub(hp).normalize();
      const side = sl.clone().sub(sr);
      side.addScaledVector(nk, -side.dot(nk)).normalize();
      const arm = el.sub(sl).normalize();
      out.push(Math.asin(Math.max(-1, Math.min(1, arm.dot(side)))) * 180 / Math.PI);
    }
  } });

  it('keeps the free upper arm within 45 degrees of the trunk nearly always', () => {
    const s = out.slice().sort((x, y) => x - y), wide = out.filter((x) => x > 45).length / out.length;
    // (here out p10/p50/p90 3/13/22 degrees, over 45 in 0.9% of frames; with the pole down and back off the chest 13/23/50 and 14.1%)
    expect(out.length).toBeGreaterThan(300);
    expect(wide).toBeLessThan(0.05);
  });
});
