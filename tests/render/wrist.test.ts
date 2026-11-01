// A racket can't turn in the hand, so everything a key says about the racket it says about the wrist and the forearm, and no
// other check could see it: skin, hands and elbows all passed with the wrist at 105-124 degrees off the forearm in the ready
// position, 124 at the serve's address, and the palm to the ball on every backhand. Measured from the joints alone.
import * as THREE from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { mannequinWithPeople } from './people.ts';

/** A person's wrist (degrees): flexion, extension, radial and ulnar deviation. */
const FLEX = 75, EXT = 70, RADIAL = 20, ULNAR = 35;

describe('the wrist', () => {
  const by: Record<string, number[]> = {};
  const med = (k: string): number => by[k]!.slice().sort((a, b) => a - b)[by[k]!.length >> 1]!;
  const pronation: number[] = [];

  beforeAll(() => {
    const P = mannequinWithPeople().people[0]!;
    const bone = (n: string): number => P.bone(n);
    const iE = bone('RightForeArm'), iW = bone('RightHand'), iM = bone('RightHandMiddle1'), iI = bone('RightHandIndex1'), iP = bone('RightHandPinky1'), iS = bone('RightArm');
    const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), M = new THREE.Vector3(), I = new THREE.Vector3(), L = new THREE.Vector3();
    const A = new THREE.Vector3(), F = new THREE.Vector3(), K = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), H = new THREE.Vector3(), T = new THREE.Vector3(), Up = new THREE.Vector3();
    interface Av { addr: boolean; carryW: number; tapW: number; armRacket: unknown; armR: unknown; root: THREE.Object3D; bones: THREE.Bone[]; w: number; ready: number; st: number; lastT: number; tCon: number; fam: { name: string } }
    for (const seed of [2350001, 2350002, 2350003, 2350004]) {
      runAnimQa(P, { seed, seconds: 60, onFrame: (_m: unknown, av: unknown[]) => {
        for (const x of av as Av[]) {
          if (x.armRacket !== x.armR) continue;
          const fam = x.w > 0.3 ? x.fam.name : 'ready', c = x.lastT - x.tCon;
          const between = fam !== 'ready' ? '' : x.addr ? 'address' : x.carryW > 0.5 ? 'carry' : x.tapW > 0.5 ? 'tap' : '';
          const stage = between || (fam === 'ready' ? (x.ready > 0.8 ? 'ready' : '') : x.st === 1 ? `${fam} back` : x.st === 2 && Math.abs(c) < 0.02 ? `${fam} contact` : '');
          if (!stage) continue;
          x.root.updateMatrixWorld(true);
          const b = x.bones;
          S.setFromMatrixPosition(b[iS]!.matrixWorld); E.setFromMatrixPosition(b[iE]!.matrixWorld); W.setFromMatrixPosition(b[iW]!.matrixWorld);
          M.setFromMatrixPosition(b[iM]!.matrixWorld); I.setFromMatrixPosition(b[iI]!.matrixWorld); L.setFromMatrixPosition(b[iP]!.matrixWorld);
          A.subVectors(W, E).normalize(); F.subVectors(M, W).normalize();
          K.subVectors(I, L).addScaledVector(F, -I.clone().sub(L).dot(F)).normalize();
          N.crossVectors(K, F).normalize();
          const bend = Math.acos(Math.max(-1, Math.min(1, A.dot(F)))) * 57.3, dir = Math.atan2(-A.dot(K), -A.dot(N));
          const fl = bend * Math.cos(dir), ra = bend * Math.sin(dir);
          (by[stage] ??= []).push(Math.hypot(fl / (fl > 0 ? FLEX : EXT), ra / (ra > 0 ? RADIAL : ULNAR)));
          if (stage === 'ready' || stage.endsWith('contact')) {
            U.subVectors(E, S).normalize(); H.crossVectors(U, A).normalize(); Up.crossVectors(H, A); T.copy(K).addScaledVector(A, -K.dot(A));
            pronation.push(Math.abs(Math.atan2(-T.dot(H), T.dot(Up))) * 57.3);
          }
        }
      } } as never);
    }
  }, 300000);

  it('stays in a wrist\'s range in the ready position (2.27 times past it)', () => {
    expect(med('ready')).toBeLessThan(1.2);
  });

  it('stays in range between the points as well: walking back, tapping rackets, at the address (2.28, 2.02 and 2.14)', () => {
    expect(med('carry')).toBeLessThan(0.7);
    expect(med('tap')).toBeLessThan(1);
    expect(med('address')).toBeLessThan(1);
  });

  it('is back and ready at the serve\'s backswing (3.46 times past it, the hand folded 124 degrees)', () => {
    expect(med('serve back')).toBeLessThan(1.3);
  });

  it('strikes a backhand with the back of the hand, a forehand laid back (2.25 and 1.64)', () => {
    expect(med('backhand contact')).toBeLessThan(1.15);
    expect(med('forehand contact')).toBeLessThan(1.35);
    expect(med('volley-fh contact')).toBeLessThan(1.35);
    expect(med('volley-bh contact')).toBeLessThan(1.35);
  });

  it('takes the racket back with no wrist past its range for long', () => {
    for (const k of ['backhand back', 'forehand back', 'smash back', 'volley-fh back', 'volley-bh back']) expect(med(k)).toBeLessThan(1.4);
  });

  it('leaves the forearm a forearm\'s turn at the ready and at the ball', () => {
    const p = pronation.slice().sort((a, b) => a - b);
    expect(p[Math.floor(p.length * 0.9)]!).toBeLessThan(95);
  });
});
