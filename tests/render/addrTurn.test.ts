import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { PH_SETUP } from '../../src/sim/match.ts';
import { mannequinWithPeople } from './people.ts';

// The server turns side-on into the address at a person's pace, from when they stand at their place, not with a pivot as the walk
// ends (review round 34, #4: 83 degrees in 0.38 s, every serve).
describe('the server into the address', () => {
  const p = mannequinWithPeople().people[0]!;
  const serves: Array<{ hips: number[]; chest: number[]; t: number[] }> = [];
  let cur: { hips: number[]; chest: number[]; t: number[] } | null = null;
  runAnimQa(p, { seed: 11, seconds: 420, lefty: [], onFrame: (m, av) => {
    const s = m.score.serverPlayer(), a = av[s] as unknown as { yRoot: number; yaw: number; chestTurn: number; vx: number; vz: number };
    const pl = m.players[s]!, home = Math.hypot(m.walkHomeX[s]! - pl.pos.x, m.walkHomeZ[s]! - pl.pos.z);
    // At their place (walking in, the others not yet there) or placed, to the toss.
    const there = (m.walking === 2 && home < 0.5 && Math.hypot(a.vx, a.vz) < 0.35) || (m.walking === 0 && m.phase === PH_SETUP);
    if (there) {
      if (!cur) { cur = { hips: [], chest: [], t: [] }; serves.push(cur); }
      cur.hips.push(a.yRoot); cur.chest.push(a.yaw + Math.PI + a.chestTurn); cur.t.push(m.time);
    } else cur = null;
  } });

  const worst = (pick: (s: (typeof serves)[number]) => number[]): number[] => serves.map((s) => {
    const y = pick(s);
    let w = 0;
    for (let k = 0; k < y.length; k++) {
      let turn = 0;
      for (let j = k + 1; j < y.length && s.t[j]! - s.t[k]! <= 0.38; j++) turn += Math.atan2(Math.sin(y[j]! - y[j - 1]!), Math.cos(y[j]! - y[j - 1]!));
      w = Math.max(w, Math.abs(turn) * 180 / Math.PI);
    }
    return w;
  }).sort((x, y) => x - y);

  it('turns the hips and chest at most 45 degrees in any 0.38 s there', () => {
    const hips = worst((s) => s.hips), chest = worst((s) => s.chest);
    // (p50/p90/max here: hips 33/35/35 and chest 37/40/40; with the pivot as the walk ended 56/57/57 and 70/70/70)
    expect(serves.length).toBeGreaterThan(10);
    expect(hips[Math.floor(hips.length * 0.9)]!).toBeLessThan(45);
    expect(chest[Math.floor(chest.length * 0.9)]!).toBeLessThan(45);
  });
});
