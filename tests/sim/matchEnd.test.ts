import { describe, expect, it } from 'vitest';
import { MatchSim, PH_OVER } from '../../src/sim/match.ts';
import { MODE_GOLDEN, FINAL_NORMAL } from '../../src/sim/rules/score.ts';

// Review round 3, critic High #1: a match used to end on a freeze-frame (the ball hanging in the air, four statues,
// the camera swinging round for a change of ends nobody played). Now the ball falls, everyone reacts, and both pairs
// walk to the net and touch rackets across it (MatchSim.overStage).
const FORMAT = { mode: MODE_GOLDEN, setsToWin: 1, gamesPerSet: 2, finalSet: FINAL_NORMAL };

function toTheEnd(seed: number, doubles: boolean): MatchSim {
  const m = new MatchSim({ seed, human: doubles ? [false, false, false, false] : [false, false], doubles, format: FORMAT });
  const inputs = doubles ? [null, null, null, null] : [null, null];
  for (let i = 0; i < 120 * 60 * 30 && m.phase !== PH_OVER; i++) m.step(inputs);
  return m;
}

describe('the end of a match', () => {
  for (const doubles of [true, false]) {
    it(`plays out after match point (${doubles ? 'doubles' : 'singles'})`, () => {
      const m = toTheEnd(11, doubles);
      expect(m.phase).toBe(PH_OVER);
      expect(m.overStage).toBe(1);
      const ends = m.score.ends;
      const by = m.ball.pos.y;
      const z0 = m.players.map((p) => Math.sign(p.pos.z));
      for (let i = 0; i < 120 * 14; i++) m.step(doubles ? [null, null, null, null] : [null, null]);
      expect(m.overStage).toBe(4);
      // Nobody changes ends after the last game.
      expect(m.score.ends).toBe(ends);
      // The ball is not left in the air.
      expect(m.ball.pos.y).toBeLessThan(Math.max(0.1, by));
      for (let i = 0; i < m.players.length; i++) {
        const p = m.players[i]!;
        // A step back from their spot by the net, on their own side...
        expect(Math.sign(p.pos.z)).toBe(z0[i]);
        expect(Math.abs(Math.abs(p.pos.z) - 0.9)).toBeLessThan(0.1);
        expect(Math.abs(p.pos.x - m.overX[i]!)).toBeLessThan(0.15);
        // ...facing the opponent across from them, who is on the other team, in the same lane.
        const q = m.players[m.overMate[i]!]!;
        expect(q.team).not.toBe(p.team);
        expect(Math.abs(q.pos.x - p.pos.x)).toBeLessThan(0.3);
        const want = Math.atan2(-(q.pos.x - p.pos.x), -(q.pos.z - p.pos.z));
        let d = want - p.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        expect(Math.abs(d)).toBeLessThan(0.15);
      }
    });
  }

  it('is deterministic', () => {
    const a = toTheEnd(5, true);
    const b = toTheEnd(5, true);
    for (let i = 0; i < 120 * 6; i++) { a.step([null, null, null, null]); b.step([null, null, null, null]); }
    expect(a.hash()).toBe(b.hash());
  });
});
