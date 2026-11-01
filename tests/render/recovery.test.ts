import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { mannequinWithPeople } from './people.ts';

// Round 10's two bugs, on the people as they play. A racket that takes the long way back to ready, and an arm folded at
// the serve, both pass every limit on speed and pops.
describe('after the ball and at it', () => {
  const p = mannequinWithPeople().people[0]!;
  const ratios: number[] = [], elbows: number[] = [];
  const q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3();
  const fade = [0, 1, 2, 3].map(() => ({ on: false, was: new THREE.Quaternion(), from: new THREE.Quaternion(), path: 0, cut: false }));
  let seq = 0;
  runAnimQa(p, { seed: 3, seconds: 150, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      const a = raw as unknown as { st: number; racket: THREE.Object3D };
      const f = fade[i]!;
      a.racket.updateWorldMatrix(true, false);
      a.racket.getWorldQuaternion(q);
      if (a.st === 3) {
        if (!f.on) { f.on = true; f.path = 0; f.from.copy(q); } else f.path += q.angleTo(f.was);
      } else if (f.on) {
        f.on = false;
        // (only one that got all the way back: a new stroke cuts it short)
        if (a.st === 0) { const d = q.angleTo(f.from); if (d > 1) ratios.push(f.path / d); }
      }
      f.was.copy(q);
    });
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind !== E_HIT || e.a !== SHOT_SERVE) continue;
      const sk = (av[e.player] as unknown as { mesh: THREE.SkinnedMesh }).mesh.skeleton;
      sk.getBoneByName('RightArm')!.getWorldPosition(S);
      sk.getBoneByName('RightForeArm')!.getWorldPosition(E);
      sk.getBoneByName('RightHand')!.getWorldPosition(W);
      // (flexion: 0 is a straight arm)
      elbows.push(180 - (180 / Math.PI) * S.sub(E).angleTo(W.sub(E)));
    }
  } });

  it('the racket goes back to ready the short way', () => {
    expect(ratios.length).toBeGreaterThan(20);
    ratios.sort((a, b) => a - b);
    // (with the bug back 3.8, now 1.7; the body's own turn adds a little to any)
    expect(ratios[Math.floor(ratios.length * 0.9)]!).toBeLessThan(1.8);
  });

  it('a serve is met with a long arm', () => {
    expect(elbows.length).toBeGreaterThan(5);
    elbows.sort((a, b) => a - b);
    // (99 when the reach and the weight both took the hips to the ball, 50 now; a coach 44-52, video 39)
    expect(elbows[elbows.length >> 1]!).toBeLessThan(65);
  });
});
