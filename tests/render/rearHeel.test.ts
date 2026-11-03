import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { rightFamily, type Family } from '../../src/render/avatar/strokes.ts';
import { E_HIT, PH_SETUP } from '../../src/sim/match.ts';
import { mannequinWithPeople } from './people.ts';

// Into a drive and the serve the rear foot rolls up over its toes as the weight goes forward (review round 32, #11: the heel 2-7 degrees
// up at a ground stroke's contact, the serve's 0).
describe('the rear heel', () => {
  const p = mannequinWithPeople().people[0]!;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const tilt: number[][][] = [[[], []], [[], []], [[], []], [[], []]], flat: number[][][] = [[[], []], [[], []], [[], []], [[], []]];
  const hits: Array<{ i: number; k: number; f: number; serve: boolean }> = [];
  let seq = 0, frame = 0;
  runAnimQa(p, { seed: 5, seconds: 300, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      const t = raw as unknown as { legL: THREE.Bone[]; legR: THREE.Bone[]; toes: THREE.Bone[] };
      for (let f = 0; f < 2; f++) {
        const foot = (f === 0 ? t.legL : t.legR)[2]!, toe = t.toes[f]!;
        toe.updateWorldMatrix(true, false);
        foot.getWorldPosition(a); toe.getWorldPosition(b);
        const e = Math.asin((a.y - b.y) / a.distanceTo(b)) * 180 / Math.PI;
        tilt[i]![f]!.push(e);
        if (m.phase === PH_SETUP && m.walking === 0) flat[i]![f]!.push(e);
      }
    });
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind !== E_HIT) continue;
      const t = av[e.player] as unknown as { fam: Family; hand: number; handed: number };
      const name = rightFamily(t.fam).name;
      const drive = /^(forehand|backhand)(-slice|-lob)?$/.test(name);
      if (!drive && name !== 'serve') continue;
      // (the rear foot: the racket side's on a forehand and the serve, the other on a backhand)
      const racket = t.handed > 0 ? 1 : 0;
      hits.push({ i: e.player, k: frame, f: name.startsWith('backhand') ? 1 - racket : racket, serve: name === 'serve' });
    }
    frame++;
  } });

  it('is up off the floor at a drive and at the serve', () => {
    const at = (serve: boolean): number[] => hits.filter((h) => h.serve === serve && h.k + 10 < tilt[h.i]![h.f]!.length).map((h) => {
      const ref = flat[h.i]![h.f]!.slice().sort((x, y) => x - y);
      return tilt[h.i]![h.f]![h.k + 10]! - ref[ref.length >> 1]!;
    }).sort((x, y) => x - y);
    const d = at(false), s = at(true);
    // (here at the median, 0.08 s after the ball: drives 23 degrees, serves 26; with no roll 3 and 0)
    expect(d.length).toBeGreaterThan(30);
    expect(s.length).toBeGreaterThan(10);
    expect(d[d.length >> 1]!).toBeGreaterThan(12);
    expect(s[s.length >> 1]!).toBeGreaterThan(12);
  });
});
