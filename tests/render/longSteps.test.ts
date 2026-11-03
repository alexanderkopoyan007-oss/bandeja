// A long re-step takes longer: its length was read on its first frame, before the body had gone on, so a 0.6-0.8 m step still took
// 0.14 s and the foot flicked across the floor at 6-10 m/s, 18 at worst (review round 26).
import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { mannequinWithPeople } from './people.ts';

describe('a long step', () => {
  it('is not a flick', () => {
    const P = mannequinWithPeople().people[0]!;
    const iA = [P.bone('LeftFoot'), P.bone('RightFoot')];
    const top: number[] = [];
    for (const seed of [5100000, 5100001, 5100002]) {
      const cur: Array<Array<{ x0: number; z0: number; px: number; pz: number; top: number } | null>> = [[null, null], [null, null], [null, null], [null, null]];
      runAnimQa(P, { seed, seconds: 240, onFrame: (_m, av) => {
        av.forEach((raw, i) => {
          const a = raw as unknown as { root: { updateMatrixWorld(f: boolean): void }; bones: Array<{ matrixWorld: { elements: number[] } }>; relT: Float64Array; relLift: Uint8Array; gaitW: number };
          a.root.updateMatrixWorld(true);
          for (let f = 0; f < 2; f++) {
            const e = a.bones[iA[f]!]!.matrixWorld.elements, x = e[12]!, z = e[14]!;
            const on = a.relT[f]! >= 0 && a.relLift[f] === 1 && a.gaitW === 0;
            let c = cur[i]![f]!;
            if (on && !c) c = cur[i]![f] = { x0: x, z0: z, px: x, pz: z, top: 0 };
            if (!c) continue;
            if (on) { c.top = Math.max(c.top, Math.hypot(x - c.px, z - c.pz) * 120); c.px = x; c.pz = z; continue; }
            if (Math.hypot(x - c.x0, z - c.z0) >= 0.45) top.push(c.top);
            cur[i]![f] = null;
          }
        });
      } });
    }
    top.sort((a, b) => a - b);
    const p90 = top[Math.floor(0.9 * (top.length - 1))]!;
    console.log(`steps of 0.45 m or more: ${top.length}, top foot speed p50 ${top[top.length >> 1]!.toFixed(1)} p90 ${p90.toFixed(1)} m/s`);
    expect(top.length).toBeGreaterThan(20);
    // (read on the first frame: p50 6.1, p90 9.4 m/s; read every frame: 5.5 and 7.7)
    expect(p90).toBeLessThan(9);
  }, 600000);
});
