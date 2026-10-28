// Input edge cases at the sim's boundary: what a release reads from the keys around it.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_TOSS, PH_OVER, E_HIT } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_OVERHEAD, BTN_POWER } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';
import { SHOT_SMASH } from '../../src/sim/contact/shots.ts';

describe('modifiers at the release', () => {
  it('Space let go a few ms after the overhead key, in the same tick, still makes the smash', () => {
    // The fresh-eyes review: the release read the modifiers from the tick's end, so Space let go up to ~10 ms
    // after O turned every smash into a bandeja (and Shift's víbora and chiquita the same way).
    let smash = 0, other = 0;
    for (const seed of [1, 2, 3]) {
      const m = new MatchSim({ seed, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
      const f = new InputFrame();
      const p = m.players[0]!;
      let key = 0;
      let seen = 0;
      for (let i = 0; i < 120 * 150 && m.phase !== PH_OVER; i++) {
        f.clear();
        let pressed = false;
        if (!key && p.swing === SW_IDLE) {
          pressed = true;
          if (m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2) { key = BTN_DRIVE; f.push(true, key, m.time); }
          else if (m.phase === PH_RALLY && m.rally.hitter === 1) { key = BTN_OVERHEAD; f.push(true, key, m.time); f.push(true, BTN_POWER, m.time); }
          else pressed = false;
        }
        let held = key === BTN_OVERHEAD ? BTN_OVERHEAD | BTN_POWER : key;
        if (key && p.swing === SW_CHARGE) {
          const ideal = m.focusIdeal(0);
          const close = m.phase === PH_TOSS || (m.stand[0]!.valid && m.focusInReach);
          if (close && ideal >= m.time && ideal < m.time + DT) {
            // Both let go inside this tick, Space 4 ms after the shot key: the tick ends with neither held.
            const r = Math.max(m.time, ideal - 0.005);
            f.push(false, key, r);
            if (key === BTN_OVERHEAD) f.push(false, BTN_POWER, Math.min(r + 0.004, m.time + DT - 1e-4));
            held = 0;
            key = 0;
          }
        } else if (key && !pressed && p.swing !== SW_CHARGE) {
          f.push(false, key, m.time);
          if (key === BTN_OVERHEAD) f.push(false, BTN_POWER, m.time);
          held = 0;
          key = 0;
        }
        f.held = held;
        m.step([f, null]);
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind !== E_HIT || e.player !== 0 || e.y < 1.55) continue;
          if (e.a === SHOT_SMASH) smash++; else other++;
        }
      }
    }
    expect(smash + other).toBeGreaterThan(8);
    expect(smash / (smash + other)).toBeGreaterThan(0.9);
  });
});
