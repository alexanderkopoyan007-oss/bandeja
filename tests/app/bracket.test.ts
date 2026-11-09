// M6 phase B: the tournament draw. Seeds where the layout puts them, byes for the top seeds, the other ties settled
// from the entries' strengths the same way every time, the player's ties as they played them, and a draw read back
// from the store checked value by value.
import { describe, expect, it } from 'vitest';
import {
  current, drawFrom, finished, makeDraw, playRound, recordYours, roundName, roundsWon, scoreLine, seedLines, stillIn, winChance, rng,
  type Entry,
} from '../../src/app/bracket.ts';

const field = (n: number): Entry[] => Array.from({ length: n }, (_, i) => ({ players: [`p${i}`], rating: 0.05 - i * 0.005, seed: 0 }));
const opts = { doubles: false, women: false, games: 6, sets: 2, you: -1 };

describe('a draw', () => {
  it('keeps the top seeds apart until the late rounds', () => {
    for (const size of [4, 8, 16]) {
      const l = seedLines(size), at = (s: number): number => l.indexOf(s);
      expect([...l].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
      // 1 and 2 in different halves; 1 to 4 in different quarters; the first round is always k against size + 1 - k.
      expect(Math.floor(at(1) / (size / 2))).not.toBe(Math.floor(at(2) / (size / 2)));
      expect(new Set([1, 2, 3, 4].map((s) => Math.floor(at(s) / (size / 4)))).size).toBe(4);
      for (let k = 0; k < size; k += 2) expect(l[k]! + l[k + 1]!).toBe(size + 1);
    }
  });

  it('seeds the strongest, keeps 1 and 2 apart, gives the top seeds the byes', () => {
    const d = makeDraw(11, field(6), opts);
    const first = d.rounds[0]!;
    expect(first).toHaveLength(4);
    const lines = first.flatMap((t) => [t.a, t.b]);
    // Seeds 1 and 2 (entries 0 and 1, the strongest) in different halves, each against a bye.
    expect(d.entries[0]!.seed).toBe(1);
    expect(d.entries[1]!.seed).toBe(2);
    expect(Math.floor(lines.indexOf(0) / 4)).not.toBe(Math.floor(lines.indexOf(1) / 4));
    for (const e of [0, 1]) {
      const t = first.find((x) => x.a === e || x.b === e)!;
      expect(t.a === -1 || t.b === -1).toBe(true);
      expect(t.winner).toBe(e);
      expect(t.score).toBe('bye');
    }
    // Everyone is in it once.
    expect(lines.filter((x) => x >= 0).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('settles the other ties the same way every time, the stronger side more often', () => {
    const run = (seed: number): string => {
      const d = makeDraw(seed, field(16), opts);
      while (!finished(d)) playRound(d);
      return JSON.stringify(d.rounds);
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
    // Over many draws the top seed wins far more often than the 16th.
    let top = 0, last = 0;
    for (let s = 0; s < 400; s++) {
      const d = makeDraw(s, field(16), opts);
      while (!finished(d)) playRound(d);
      const w = d.rounds[d.rounds.length - 1]![0]!.winner;
      if (w === 0) top++;
      if (w === 15) last++;
    }
    expect(top).toBeGreaterThan(40);
    expect(last).toBeLessThan(top / 4);
    expect(winChance({ players: [], rating: 0.04, seed: 0 }, { players: [], rating: 0, seed: 0 })).toBeCloseTo(0.79, 2);
  });

  it('waits for the player, then goes on with their result', () => {
    const d = makeDraw(3, field(8), { ...opts, you: 7 });
    const { tie } = current(d);
    expect(tie).not.toBeNull();
    // Not played yet: the round waits.
    playRound(d);
    expect(d.rounds).toHaveLength(1);
    recordYours(d, true, '6-4 6-3');
    playRound(d);
    expect(d.rounds).toHaveLength(2);
    expect(stillIn(d)).toBe(true);
    expect(roundsWon(d)).toBe(1);
    expect(current(d).tie).not.toBeNull();
    recordYours(d, false, '3-6 4-6');
    expect(stillIn(d)).toBe(false);
    // Out: the rest of the draw plays itself out.
    while (!finished(d)) playRound(d);
    expect(d.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(roundName(1)).toBe('Final');
    expect(roundName(4)).toBe('Quarter-finals');
  });

  it('reads scores as padel scores do', () => {
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const s = scoreLine(r, Math.random() * 0.5, 6, 2);
      const sets = s.split(' ').map((x) => x.split('-').map(Number) as [number, number]);
      expect(sets.filter(([a, b]) => a > b).length).toBe(2);
      for (const [a, b] of sets) {
        const hi = Math.max(a, b), lo = Math.min(a, b);
        expect(hi === 6 ? lo <= 4 : hi === 7 && (lo === 5 || lo === 6)).toBe(true);
      }
    }
    // Short sets: to 4, 5-4 on a tie-break.
    const short = scoreLine(rng(2), 0.1, 4, 1);
    expect(short).toMatch(/^(4-[0-2]|5-[34])$/);
  });

  it('reads back only a draw', () => {
    const d = makeDraw(8, field(5), { ...opts, you: 2 });
    recordYours(d, true, '6-2 6-2');
    playRound(d);
    const back = drawFrom(JSON.parse(JSON.stringify(d)));
    expect(back).toEqual(d);
    expect(drawFrom(null)).toBeNull();
    expect(drawFrom({ ...d, you: 99 })).toBeNull();
    expect(drawFrom({ ...d, rounds: [[{ a: 0, b: 1, winner: 3, score: '' }]] })).toBeNull();
    expect(drawFrom({ ...d, entries: [{ players: ['x'], rating: 'high', seed: 0 }, ...d.entries] })).toBeNull();
  });
});
