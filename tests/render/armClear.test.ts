// A forearm can go through the trunk with every hand-in-torso check passing: those read the mannequin, 11 cm of chest on a long arm, where the
// people have 14-15 cm on a short one. Moved in to bend the elbow, the keys sank the arm in the chest on half a serve's follow-through and
// on one body in four standing still, and nothing here saw it (review round 21). Measured on the real capsules of real bodies.
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { fitCapsules, runAnimQa } from '../../src/render/avatar/animQa.ts';
import { guestAsset, mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const BODIES = [['p1', base.people.find((p) => p.look!.name === 'p1')!], ['meshy3', guestAsset('meshy3', base)]] as const;
/** How far in counts, and the points along the forearm looked at (shares from the elbow). */
const DEEP = 0.03, ALONG = [0.35, 0.65, 0.95];

describe('the arm stays out of the trunk', () => {
  it.each(BODIES)('%s', (_name, P) => {
    const caps = fitCapsules(P).filter((c) => c.name === 'chest' || c.name === 'pelvis');
    const iE = P.bone('RightForeArm'), iW = P.bone('RightHand');
    const E = new THREE.Vector3(), W = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), X = new THREE.Vector3(), S = new THREE.Vector3();
    const seen: Record<string, [number, number]> = { ready: [0, 0], 'serve after': [0, 0] };
    for (const seed of [2350001, 2350002]) {
      runAnimQa(P, { seed, seconds: 60, onFrame: (_m: unknown, av: unknown[]) => {
        for (const x of av as { armRacket: unknown; armR: unknown; root: THREE.Object3D; bones: THREE.Bone[]; w: number; ready: number; st: number; lastT: number; tCon: number; fam: { name: string } }[]) {
          if (x.armRacket !== x.armR) continue;
          const k = x.w < 0.3 ? (x.ready > 0.8 ? 'ready' : '') : x.fam.name === 'serve' && x.st === 2 && x.lastT > x.tCon ? 'serve after' : '';
          if (!k) continue;
          x.root.updateMatrixWorld(true);
          E.setFromMatrixPosition(x.bones[iE]!.matrixWorld);
          W.setFromMatrixPosition(x.bones[iW]!.matrixWorld);
          let inside = false;
          for (const u of ALONG) {
            X.copy(E).lerp(W, u);
            for (const c of caps) {
              A.setFromMatrixPosition(x.bones[c.ia]!.matrixWorld);
              B.setFromMatrixPosition(x.bones[c.ib]!.matrixWorld);
              S.subVectors(B, A);
              const t = Math.max(0, Math.min(1, X.clone().sub(A).dot(S) / S.lengthSq()));
              if (A.clone().addScaledVector(S, t).distanceTo(X) < c.r - DEEP) inside = true;
            }
          }
          seen[k]![0]++;
          if (inside) seen[k]![1]++;
        }
      } } as never);
    }
    expect(seen.ready![0]).toBeGreaterThan(2000);
    expect(seen['serve after']![0]).toBeGreaterThan(50);
    expect(seen.ready![1] / seen.ready![0]).toBeLessThan(0.02);
    expect(seen['serve after']![1] / seen['serve after']![0]).toBeLessThan(0.02);
  }, 300000);
});
