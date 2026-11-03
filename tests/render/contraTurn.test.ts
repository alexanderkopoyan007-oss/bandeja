import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_CONTRAPARED } from '../../src/sim/contact/shots.ts';
import { mannequinWithPeople } from './people.ts';

// After a contrapared the body turns back from its own glass no faster than a person pivots (review round 34, #2: 150-200 degrees in a
// third of a second).
describe('the turn back after a contrapared', () => {
  const p = mannequinWithPeople().people[0]!;
  const yaws: number[][] = [[], [], [], []], faces: number[][] = [[], [], [], []], times: number[] = [], contras: Array<{ i: number; k: number }> = [];
  // (two seeds, one after the other in the same arrays: a contrapared comes a few times in ten minutes, and seed 7 alone had none once the
  // defenders read close overheads, and seeds 7 and 8 two; a window across the join holds no contrapared)
  for (const seed of [7, 8, 11]) {
    let seq = 0;
    runAnimQa(p, { seed, seconds: 600, lefty: [], onFrame: (m, av) => {
      times.push(m.time);
      av.forEach((raw, i) => { yaws[i]!.push((raw as unknown as { yaw: number }).yaw); faces[i]!.push(m.players[i]!.facing); });
      for (; seq < m.eventSeq; seq++) {
        const e = m.events[seq % m.events.length]!;
        if (e.kind === E_HIT && e.a === SHOT_CONTRAPARED) contras.push({ i: e.player, k: times.length - 1 });
      }
    } });
  }

  it('turns at most 135 degrees in any third of a second in the second after one', () => {
    const worstOf = (src: number[][]): number => {
    let worst = 0;
    for (const c of contras) {
      const y = src[c.i]!;
      for (let k = c.k; k < Math.min(y.length, c.k + 60); k++) {
        let k2 = k;
        while (k2 < y.length && times[k2]! - times[k]! < 1 / 3) k2++;
        if (k2 >= y.length) break;
        let turn = 0;
        for (let j = k + 1; j <= k2; j++) turn += Math.atan2(Math.sin(y[j]! - y[j - 1]!), Math.cos(y[j]! - y[j - 1]!));
        worst = Math.max(worst, Math.abs(turn) * 180 / Math.PI);
      }
    }
    return worst;
    };
    const worst = worstOf(yaws);
    // (the sim's own facing, which chases the ball back over them, turned 137 in the worst third of a second; drawn, 204 before and 108 now, over 5 contrapareds on three seeds)
    expect(worstOf(faces)).toBeLessThan(180);
    expect(contras.length).toBeGreaterThan(3);
    expect(worst).toBeLessThan(135);
  });
});
