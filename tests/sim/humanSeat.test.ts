// The human's seat: a held swing meets the ball and the assist keeps out of its line, as an AI's always have. A person
// holding the key too long gets a late hit, not a swing through nothing; on the assist, they don't run into a ball they
// mean to take off the glass. Six points in a hundred ended that way, and one swing in ten went through the air.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_BODY, E_HIT, E_POINT, E_SWING, E_WHIFF, PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS } from '../../src/sim/match.ts';
import { G_GOOD, G_PERFECT } from '../../src/sim/contact/timing.ts';
import { SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';

describe('the human seat', () => {
  it('holding the key to the end hits the ball, and the ball seldom hits the player', () => {
    let hits = 0, whiffs = 0, bodies = 0, points = 0, swings = 0, praised = 0;
    for (let i = 0; i < 4; i++) {
      const m = new MatchSim({ seed: 180001 + i, doubles: true, human: [true, false, false, false], aiLevel: [0.8, 0.8], aiStyle: [],
        timingScale: 1.5, assist: 0.45, autoTiming: false, format: { mode: 1, setsToWin: 1, gamesPerSet: 3, finalSet: 0 } } as never);
      const f = new InputFrame();
      const M = m as never as { score: { serverPlayer(): number }; stand: Array<{ valid: boolean }>; tossIdeal: number };
      let seq = 0, held = false, strike = 0;
      for (let t = 0; t < 120 * 900 && m.phase !== PH_OVER; t++) {
        f.clear();
        const srv = (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === 0;
        if (srv) {
          // (a tap tosses the ball; held through the toss, let go at its moment)
          if (m.phase === PH_SETUP && t % 45 === 0) { f.push(!held, BTN_DRIVE, m.time); held = !held; }
          else if (m.phase === PH_TOSS && !held && m.time < M.tossIdeal - 0.1) { f.push(true, BTN_DRIVE, m.time); held = true; }
          else if (m.phase === PH_TOSS && held && m.time >= M.tossIdeal) { f.push(false, BTN_DRIVE, m.time); held = false; }
        } else if (m.phase === PH_RALLY && M.stand[0]!.valid) {
          // A person's reaction, then held: the swing goes off by itself.
          if (!held && m.time > strike + 0.35) { f.push(true, BTN_DRIVE, m.time); held = true; }
        } else if (held && !srv) { f.push(false, BTN_DRIVE, m.time); held = false; }
        f.held = held ? BTN_DRIVE : 0;
        m.step([f, null, null, null]);
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_HIT) { strike = m.time; if (e.player === 0) hits++; }
          else if (e.kind === E_WHIFF && e.player === 0) whiffs++;
          else if (e.kind === E_BODY && e.player === 0) bodies++;
          else if (e.kind === E_POINT) points++;
          else if (e.kind === E_SWING && e.player === 0 && e.a !== SHOT_SERVE) { swings++; if (e.b === G_PERFECT || e.b === G_GOOD) praised++; }
        }
      }
    }
    // (a key never let go is a late hit now, so these matches are over sooner: 144 hits where a timed-as-if-released hold had over 150)
    expect(hits).toBeGreaterThan(120);
    // (those left are this script letting go as its plan goes: real releases; three in four were praised)
    expect(praised / swings).toBeLessThan(0.25);
    expect(whiffs / (hits + whiffs)).toBeLessThan(0.05);
    expect(bodies / points).toBeLessThan(0.07);
  }, 300000);
});
