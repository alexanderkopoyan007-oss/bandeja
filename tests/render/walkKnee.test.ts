import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { mannequinWithPeople } from './people.ts';

// The walk back between points bends its knees: the swing leg folds, and a knee is straight only about the heel's strike (review round
// 32, #10: a knee at the solver's stop in 57-64% of walk frames, the swing's bend 27 degrees at most).
describe('the walk between points', () => {
  const p = mannequinWithPeople().people[0]!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let frames = 0, locked = 0;
  const swing: number[] = [];
  const peak = [0, 0];
  const bend = (leg: THREE.Bone[]): number => {
    leg[0]!.getWorldPosition(a); leg[1]!.getWorldPosition(b); leg[2]!.getWorldPosition(c);
    const u = b.clone().sub(a).normalize(), v = c.clone().sub(b).normalize();
    return Math.acos(Math.min(1, u.dot(v))) * 180 / Math.PI;
  };
  runAnimQa(p, { seed: 9, seconds: 240, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      const t = raw as unknown as { legL: THREE.Bone[]; legR: THREE.Bone[]; gaitH: number; gaitSwing: number[] };
      if (i !== 0) return;
      if (!(m.walking > 0 && t.gaitH > 0.99)) { peak[0] = peak[1] = 0; return; }
      t.legL[0]!.updateWorldMatrix(true, true);
      t.legR[0]!.updateWorldMatrix(true, true);
      const k = [bend(t.legL), bend(t.legR)];
      frames++;
      if (k[0]! <= 3 || k[1]! <= 3) locked++;
      for (let f = 0; f < 2; f++) {
        // The most a knee folds through each swing.
        if (t.gaitSwing[f]! >= 0) peak[f] = Math.max(peak[f]!, k[f]!);
        else if (peak[f]! > 0) { swing.push(peak[f]!); peak[f] = 0; }
      }
    });
  } });

  it('has a straight knee in under a quarter of its frames and folds the swing leg', () => {
    swing.sort((x, y) => x - y);
    // (here 19% straight, the swing's fold p10/p50/p90 54/58/67 degrees; with the hips at 0.96 and a step a leg long, 55% and 43/51/57)
    expect(frames).toBeGreaterThan(600);
    expect(locked / frames).toBeLessThan(0.25);
    expect(swing[swing.length >> 1]!).toBeGreaterThan(50);
  });
});
