// A lob over a person at the net. The AI read a person's plan as it reads a partner's, and a person has no plan until
// they press, so nearly every lob looked to have beaten them: both lobbers ran in, and the bandeja from 7 m that the
// lob asks for met two players at 2.8 m and won 49 points in a hundred (review round 30). They now hold back while the
// person can still get under it, and come in only once that's gone.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS } from '../../src/sim/match.ts';
import { SHOT_BANDEJA, SHOT_SMASH } from '../../src/sim/contact/shots.ts';
import { InputFrame, BTN_DRIVE, BTN_OVERHEAD } from '../../src/sim/input.ts';

describe('a lob over a person', () => {
  it('leaves the lobbers back while that person can take it in the air', () => {
    let replies = 0, bothUp = 0;
    for (let i = 0; i < 6; i++) {
      const m = new MatchSim({ seed: 190101 + i, doubles: true, human: [true, false, false, false], aiLevel: [1, 1], aiStyle: [],
        timingScale: 1.5, assist: 0.45, autoTiming: false, format: { mode: 1, setsToWin: 1, gamesPerSet: 6, finalSet: 0 } } as never);
      const f = new InputFrame();
      const M = m as never as { score: { serverPlayer(): number }; stand: Array<{ valid: boolean }>; tossIdeal: number };
      let seq = 0, held = 0, strike = 0;
      for (let t = 0; t < 120 * 1800 && m.phase !== PH_OVER; t++) {
        f.clear();
        const srv = (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === 0;
        if (srv) {
          if (m.phase === PH_SETUP && t % 45 === 0) { f.push(held === 0, BTN_DRIVE, m.time); held = held ? 0 : BTN_DRIVE; }
          else if (m.phase === PH_TOSS && !held && m.time < M.tossIdeal - 0.1) { f.push(true, BTN_DRIVE, m.time); held = BTN_DRIVE; }
          else if (m.phase === PH_TOSS && held && m.time >= M.tossIdeal) { f.push(false, BTN_DRIVE, m.time); held = 0; }
        } else if (m.phase === PH_RALLY && !held && m.time > strike + 0.35 && (m.rally.hitter & 1) === 1) {
          // (the overhead held from a person's reaction, whenever it can still be had)
          const key = m.ball.vel.y > 0 && m.ball.pos.y > 2.2 && m.canOverhead(0) >= 0 ? BTN_OVERHEAD : M.stand[0]!.valid ? BTN_DRIVE : 0;
          if (key) { f.push(true, key, m.time); held = key; }
        } else if (held && !srv && m.phase !== PH_RALLY) { f.push(false, held, m.time); held = 0; }
        f.held = held;
        m.step([f, null, null, null]);
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind !== E_HIT) continue;
          strike = m.time;
          if (e.player === 0 && held) { f.clear(); f.push(false, held, m.time); held = 0; }
          if (e.player === 0 && (e.a === SHOT_BANDEJA || e.a === SHOT_SMASH) && Math.abs(e.z) > 6) {
            replies++;
            if (Math.abs(m.players[1]!.pos.z) < 4 && Math.abs(m.players[3]!.pos.z) < 4) bothUp++;
          }
        }
      }
    }
    expect(replies).toBeGreaterThan(8);
    // (65 in a hundred before; a lobber still comes in on a lob that has gone past that person)
    expect(bothUp / replies).toBeLessThan(0.35);
  }, 300000);
});
