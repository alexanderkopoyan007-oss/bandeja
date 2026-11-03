import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { rightFamily, type Family } from '../../src/render/avatar/strokes.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { mannequinWithPeople } from './people.ts';

// After a forehand volley the racket arm goes back to the ready without the elbow flying round a still hand (review round 33, #9: the
// elbow 0.14 m or more in 0.1 s with the hand under 6 cm, after 46% of forehand volleys, at +0.28 s at the median).
describe('the racket elbow after a forehand volley', () => {
  const p = mannequinWithPeople().people[0]!;
  const v = new THREE.Vector3();
  const elbow: number[][][] = [[], [], [], []], hand: number[][][] = [[], [], [], []];
  const volleys: Array<{ i: number; k: number }> = [];
  let seq = 0, frame = 0;
  runAnimQa(p, { seed: 9, seconds: 420, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      const t = raw as unknown as { armR: THREE.Bone[] };
      t.armR[2]!.updateWorldMatrix(true, false);
      elbow[i]!.push(t.armR[1]!.getWorldPosition(v).toArray());
      hand[i]!.push(t.armR[2]!.getWorldPosition(v).toArray());
    });
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind === E_HIT && rightFamily((av[e.player] as unknown as { fam: Family }).fam).name === 'volley-fh') volleys.push({ i: e.player, k: frame });
    }
    frame++;
  } });

  it('flicks the elbow after few of them', () => {
    const d = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    let flicked = 0, n = 0;
    for (const h of volleys) {
      const E = elbow[h.i]!, H = hand[h.i]!;
      if (h.k + 84 > E.length) continue;
      n++;
      for (let k = h.k; k < h.k + 72; k++) if (d(E[k]!, E[k + 12]!) >= 0.14 && d(H[k]!, H[k + 12]!) < 0.06) { flicked++; break; }
    }
    // (here 5 of 24, 21%; at a stroke's pace all the time, 9 of 24, 38%. On 300 s before the defenders read close overheads: 3 of 22 and 6
    // of 22. At 300 deg/s it read 2 of 22 but the arm met the trunk in 12% of meshy3's frames, over armClear's 10%)
    expect(n).toBeGreaterThan(20);
    expect(flicked / n).toBeLessThan(0.25);
  });
});
