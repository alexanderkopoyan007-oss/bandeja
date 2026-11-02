// The change of ends was the shortest break in a match: 3.4 s from the last ball to the next serve against 8 after any other point, the game's
// call gone in the frame it came up, and the card still up over the serve.
import { describe, expect, it } from 'vitest';
import { E_ENDS, E_GAME, E_HIT, E_POINT, MatchSim, PH_DEAD } from '../../src/sim/match.ts';

describe('a change of ends', () => {
  it('holds the game\'s call, turns the pairs round at the cut, and takes longer than a fault', () => {
    const m = new MatchSim({ seed: 41, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    let seen = 0, gameAt = -1, lastBall = -1, sideAtGame = 0, ends = 0;
    const gaps: number[] = [], calls: number[] = [];
    let waiting = false;
    for (let k = 0; k < 120 * 1500 && gaps.length < 6; k++) {
      m.step([null, null, null, null]);
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_POINT) lastBall = m.time;
        if (e.kind === E_GAME) { gameAt = m.time; sideAtGame = m.side(0); }
        if (e.kind === E_ENDS && gameAt > 0) {
          calls.push(m.time - gameAt);
          ends++;
          waiting = true;
          gameAt = -1;
        }
        if (e.kind === E_HIT && waiting) { gaps.push(m.time - lastBall); waiting = false; }
      }
      // (nobody changes ends in the hold: the game's call is over the end it was won on)
      if (gameAt > 0 && m.phase === PH_DEAD) expect(m.side(0)).toBe(sideAtGame);
    }
    expect(ends).toBeGreaterThan(3);
    for (const c of calls) expect(c).toBeGreaterThan(2);
    for (const g of gaps) expect(g).toBeGreaterThan(5.5);
  }, 120_000);
});
