// After the ball the racket elbow came across onto the sternum on the generated bodies: their chests are 14 cm, the mannequin the
// follow-through keys were placed on has 11. On the woman the game seats as you, half the forehand slices and a third of the backhand
// volleys put the forearm's centre line 6 cm or more inside her chest, the elbow deepest (review round 28, #3).
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { fitCapsules, runAnimQa } from '../../src/render/avatar/animQa.ts';
import { rightFamily, type Family } from '../../src/render/avatar/strokes.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { guestAsset, mannequinWithPeople } from './people.ts';

const FAMS = ['forehand-slice', 'forehand-lob', 'overhead', 'volley-bh', 'volley-fh', 'forehand'];

describe('the racket elbow after the ball', () => {
  it('stays out of the generated woman\'s chest', () => {
    const P = guestAsset('meshy2', mannequinWithPeople());
    const C = fitCapsules(P).find((c) => c.name === 'chest')!;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), X = new THREE.Vector3();
    const open: Array<{ i: number; t: number; fam: string; deep: number }> = [], done: Array<{ fam: string; deep: number }> = [];
    let seq = 0;
    for (const seed of [5, 6, 7]) {
      seq = 0;
      runAnimQa(P, { seed, seconds: 240, onFrame: (m, av) => {
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_HIT) open.push({ i: e.player, t: m.time, fam: rightFamily((av[e.player] as unknown as { fam: Family }).fam).name, deep: -1 });
        }
        for (let k = open.length - 1; k >= 0; k--) {
          const o = open[k]!, x = av[o.i] as unknown as { root: THREE.Object3D; bones: THREE.Bone[]; armRacket: THREE.Bone[] };
          if (m.time > o.t + 0.5) { done.push(o); open.splice(k, 1); continue; }
          x.root.updateMatrixWorld(true);
          A.setFromMatrixPosition(x.bones[C.ia]!.matrixWorld); B.setFromMatrixPosition(x.bones[C.ib]!.matrixWorld).sub(A);
          E.setFromMatrixPosition(x.armRacket[1]!.matrixWorld); W.setFromMatrixPosition(x.armRacket[2]!.matrixWorld);
          for (const u of [0, 0.35, 0.65, 0.95]) {
            X.copy(E).lerp(W, u);
            const t = Math.max(0, Math.min(1, X.clone().sub(A).dot(B) / B.lengthSq()));
            o.deep = Math.max(o.deep, C.r - A.clone().addScaledVector(B, t).distanceTo(X));
          }
        }
      } });
      open.length = 0;
    }
    const share: Record<string, string> = {};
    let n = 0, deep = 0;
    for (const f of FAMS) {
      const a = done.filter((d) => d.fam === f), d = a.filter((x) => x.deep >= 0.06).length;
      share[f] = `${d}/${a.length}`;
      n += a.length; deep += d;
    }
    console.log('6 cm or more into the chest, 0 to +0.5 s:', share);
    expect(n).toBeGreaterThan(120);
    // (39 of 175 before, 22%: slices 17 of 23, lobs 11 of 32; 8 of 175 with the push, half of them within two frames of the contact, the forward swing's)
    expect(deep / n).toBeLessThan(0.07);
  }, 600000);
});
