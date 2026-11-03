// Set at the ball: at a slow groundstroke or volley the front foot was still stepping, the stroke clips stepping it in late and the foot
// lock following them. It landed at the ball or lifted off at it, off the floor at the contact on 24-62% of groundstrokes (review round 27).
import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { rightFamily, type Family } from '../../src/render/avatar/strokes.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { mannequinWithPeople } from './people.ts';

const GROUND = /^(forehand|backhand|volley-fh|volley-bh)(-slice|-lob|-chiquita)?$/;

describe('the front foot at a slow stroke', () => {
  it('is down before the ball', () => {
    const P = mannequinWithPeople().people[0]!;
    const iA = [P.bone('LeftFoot'), P.bone('RightFoot')], iT = [P.bone('LeftToeBase'), P.bone('RightToeBase')];
    const off: number[] = [], downMs: number[] = [];
    for (const seed of [3, 4]) {
      const H: number[][][] = [[], [], [], []], hits: Array<{ i: number; k: number }> = [];
      let seq = 0, fr = 0;
      runAnimQa(P, { seed, seconds: 240, onFrame: (m, av) => {
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!, p = m.players[e.player]!;
          if (e.kind === E_HIT && GROUND.test(rightFamily((av[e.player] as unknown as { fam: Family }).fam).name) && Math.hypot(p.vel.x, p.vel.z) < 0.5) hits.push({ i: e.player, k: fr });
        }
        av.forEach((raw, i) => {
          const a = raw as unknown as { root: { updateMatrixWorld(f: boolean): void }; bones: Array<{ matrixWorld: { elements: number[] } }> };
          a.root.updateMatrixWorld(true);
          const r: number[] = [];
          for (let f = 0; f < 2; f++) {
            const A = a.bones[iA[f]!]!.matrixWorld.elements, T = a.bones[iT[f]!]!.matrixWorld.elements;
            r.push(A[12]!, A[13]!, A[14]!, T[13]!);
          }
          H[i]!.push(r);
        });
        fr++;
      } });
      // Down: the ankle within 3 cm or the toe within 2 cm of its lowest (1st percentile of the run).
      const low = (c: number): number => { const a = H.flatMap((h) => h.map((r) => r[c]!)).sort((x, y) => x - y); return a[Math.floor(a.length * 0.01)]!; };
      const lowA = [low(1), low(5)], lowT = [low(3), low(7)];
      for (const h of hits) {
        if (h.k < 60) continue;
        const R = H[h.i]!, now = R[h.k]!, f = Math.abs(now[2]!) < Math.abs(now[6]!) ? 0 : 1;
        const down = (r: number[]): boolean => r[f * 4 + 1]! - lowA[f]! < 0.03 || r[f * 4 + 3]! - lowT[f]! < 0.02;
        off.push(down(now) ? 0 : 1);
        let k = h.k;
        while (k > h.k - 60 && down(R[k]!)) k--;
        downMs.push(((h.k - k) * 1000) / 120);
      }
    }
    const p50 = downMs.sort((x, y) => x - y)[downMs.length >> 1]!, share = off.reduce((s, x) => s + x, 0) / off.length;
    console.log(`slow strokes ${off.length}: front foot off the floor at the ball ${(100 * share).toFixed(0)}%, down before it p50 ${p50.toFixed(0)} ms`);
    expect(off.length).toBeGreaterThan(80);
    // (before the hold: 39% off the floor, down 50 ms at the median; with it 15% and 142 ms)
    expect(share).toBeLessThan(0.2);
    expect(p50).toBeGreaterThan(90);
  }, 600000);
});
