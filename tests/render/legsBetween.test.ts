// The legs between strokes: where a run stops or turns. The lean took the hips 0.46 m off the feet and the leg's arc took them down again, and
// a planted foot left behind drew them lower still, hips 0.61 m at walking pace, feet over a metre apart, in the middle of nothing (the owner's
// "the legs the same"; review round 21). No stroke check could see it, and pops don't: the hips went there smoothly.
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { guestAsset, mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const BODIES = [['p1', base.people.find((p) => p.look!.name === 'p1')!], ['meshy3', guestAsset('meshy3', base)]] as const;
/** Of the hips' height standing: lower than this between strokes is a sit (shares of the frames, not of the time in a stop). */
const SUNK = 0.75;
/** Feet further apart than this, in legs, with the hips under SAG of their height: a straddle. */
const WIDE = 1.1, SAG = 0.85;

describe('the legs between strokes', () => {
  it.each(BODIES)('%s', (_name, P) => {
    const iH = P.bone('Hips'), iL = P.bone('LeftFoot'), iR = P.bone('RightFoot');
    const H = new THREE.Vector3(), L = new THREE.Vector3(), R = new THREE.Vector3();
    H.setFromMatrixPosition(P.restWorld[iH]!);
    L.setFromMatrixPosition(P.restWorld[P.bone('LeftUpLeg')]!);
    R.setFromMatrixPosition(P.restWorld[iL]!);
    const stand = H.y, leg = L.distanceTo(R);
    let frames = 0, sunk = 0, wide = 0;
    runAnimQa(P, { seed: 2350003, seconds: 60, onFrame: (_m: unknown, av: unknown[]) => {
      for (const x of av as { root: THREE.Object3D; bones: THREE.Bone[]; w: number; jumpT0: number }[]) {
        if (x.w > 0.05 || x.jumpT0 >= 0) continue;
        x.root.updateMatrixWorld(true);
        const hy = H.setFromMatrixPosition(x.bones[iH]!.matrixWorld).y;
        L.setFromMatrixPosition(x.bones[iL]!.matrixWorld);
        R.setFromMatrixPosition(x.bones[iR]!.matrixWorld);
        frames++;
        if (hy < stand * SUNK) sunk++;
        if (hy < stand * SAG && Math.hypot(L.x - R.x, L.z - R.z) > leg * WIDE) wide++;
      }
    } } as never);
    expect(frames).toBeGreaterThan(5000);
    expect(sunk / frames).toBeLessThan(0.002);
    expect(wide / frames).toBeLessThan(0.002);
  });
});
