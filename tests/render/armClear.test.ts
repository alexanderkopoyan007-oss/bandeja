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
const DEEP = 0.03, ALONG = [0, 0.35, 0.65, 0.95];

describe('the arm stays out of the trunk', () => {
  it.each(BODIES)('%s', (_name, P) => {
    const caps = fitCapsules(P).filter((c) => c.name === 'chest' || c.name === 'pelvis');
    const iE = P.bone('RightForeArm'), iW = P.bone('RightHand');
    const E = new THREE.Vector3(), W = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), X = new THREE.Vector3(), S = new THREE.Vector3();
    const seen: Record<string, [number, number]> = { ready: [0, 0], 'serve after': [0, 0], 'volley after': [0, 0] };
    const iS = P.bone('RightArm'), Sh = new THREE.Vector3(), up = new THREE.Vector3(), fore = new THREE.Vector3();
    const bend: Record<string, number[]> = { volley: [], forehand: [], overhead: [] };
    let elbowIn = 0;
    for (const seed of [2350001, 2350002]) {
      runAnimQa(P, { seed, seconds: 60, onFrame: (_m: unknown, av: unknown[]) => {
        for (const x of av as { armRacket: unknown; armR: unknown; root: THREE.Object3D; bones: THREE.Bone[]; w: number; ready: number; st: number; lastT: number; tCon: number; fam: { name: string } }[]) {
          if (x.armRacket !== x.armR) continue;
          const after = x.st === 2 && x.lastT > x.tCon, volley = x.fam.name.startsWith('volley');
          const k = x.w < 0.3 ? (x.ready > 0.8 ? 'ready' : '') : x.fam.name === 'serve' && after ? 'serve after' : volley && after ? 'volley after' : '';
          const late = after && x.lastT > x.tCon + 0.08 ? (volley ? 'volley' : x.fam.name === 'overhead' || x.fam.name === 'vibora' ? 'overhead' : x.fam.name.startsWith('forehand') ? 'forehand' : '') : '';
          if (!k && !late) continue;
          x.root.updateMatrixWorld(true);
          E.setFromMatrixPosition(x.bones[iE]!.matrixWorld);
          W.setFromMatrixPosition(x.bones[iW]!.matrixWorld);
          if (late) {
            Sh.setFromMatrixPosition(x.bones[iS]!.matrixWorld);
            bend[late]!.push(up.subVectors(E, Sh).angleTo(fore.subVectors(W, E)) * 180 / Math.PI);
          }
          if (!k) continue;
          let inside = false, sunk = false;
          for (const u of ALONG) {
            X.copy(E).lerp(W, u);
            for (const c of caps) {
              A.setFromMatrixPosition(x.bones[c.ia]!.matrixWorld);
              B.setFromMatrixPosition(x.bones[c.ib]!.matrixWorld);
              S.subVectors(B, A);
              const t = Math.max(0, Math.min(1, X.clone().sub(A).dot(S) / S.lengthSq()));
              const d = A.clone().addScaledVector(S, t).distanceTo(X);
              if (d < c.r - DEEP) inside = true;
              if (u === 0 && k === 'ready' && d < c.r) sunk = true;
            }
          }
          seen[k]![0]++;
          if (inside) seen[k]![1]++;
          if (sunk) elbowIn++;
        }
      } } as never);
    }
    expect(seen.ready![0]).toBeGreaterThan(2000);
    expect(seen['serve after']![0]).toBeGreaterThan(50);
    expect(seen.ready![1] / seen.ready![0]).toBeLessThan(0.02);
    expect(seen['serve after']![1] / seen['serve after']![0]).toBeLessThan(0.02);
    // (the elbow itself: nothing looked at it, and with the hips low a volley's went 10-14 cm into the waist on a third of its frames by the skinned audit. These capsules read
    // volleys coarsely, so the sharp line is the ready position: joint inside the capsule 0.9-1.2% of frames before, 0.03-0.08 after)
    expect(elbowIn / seen.ready![0]).toBeLessThan(0.003);
    expect(seen['volley after']![0]).toBeGreaterThan(50);
    expect(seen['volley after']![1] / seen['volley after']![0]).toBeLessThan(0.1);
    // After the ball the arm stays bent, on the footage: forehand 38-64, bandeja 31-62. At the stop, 22-30, the recovery had to bend it 40 degrees in 100 ms.
    const median = (a: number[]): number => a.sort((x, y) => x - y)[a.length >> 1]!;
    expect(bend.volley!.length).toBeGreaterThan(50);
    expect(median(bend.volley!)).toBeGreaterThan(45);
    expect(median(bend.forehand!)).toBeGreaterThan(38);
    if (bend.overhead!.length > 20) expect(median(bend.overhead!)).toBeGreaterThan(31);
  }, 300000);
});
