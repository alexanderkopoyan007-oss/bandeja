// The meter and the grade agree: a release on the moment the meter shows is graded on that moment.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_OVER, E_SWING, E_WHIFF } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';
import { G_PERFECT, GRADE_TEXT } from '../../src/sim/contact/timing.ts';
import { DT } from '../../src/sim/core/constants.ts';

/**
 * Plays as the person (player 0, singles): holds drive from the opponent's strike and lets go exactly when the meter
 * reads Perfect (the sim's time on focusIdeal, as the HUD's mark has it). Returns each such release's grade and whether
 * the planned contact was in reach from where the body was.
 */
function releasesOnTheMeter(seed: number, seconds: number): { grade: number; inReach: boolean }[] {
  const m = new MatchSim({ seed, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5, aiLevel: [1, 1] });
  const f = new InputFrame();
  const out: { grade: number; inReach: boolean }[] = [];
  let holding = false, seen = 0, inReach = true, waiting = false;
  for (let k = 0; k < seconds * 120 && m.phase !== PH_OVER; k++) {
    f.clear();
    const p = m.players[0]!;
    if (holding && p.swing !== SW_CHARGE) holding = false;
    if (!holding && p.swing === SW_IDLE && m.phase === PH_RALLY && m.rally.hitter === 1) {
      f.push(true, BTN_DRIVE, m.time);
      holding = true;
    }
    if (holding && p.swing === SW_CHARGE && m.phase === PH_RALLY) {
      const ideal = m.focusIdeal(0);
      if (ideal >= m.time && ideal < m.time + DT) {
        inReach = m.focusInReach;
        f.push(false, BTN_DRIVE, ideal);
        holding = false;
        waiting = true;
      }
    }
    f.held = holding ? BTN_DRIVE : 0;
    m.step([f, null]);
    for (; seen < m.eventSeq; seen++) {
      const e = m.events[seen % m.events.length]!;
      if (!waiting || e.player !== 0 || (e.kind !== E_SWING && e.kind !== E_WHIFF)) continue;
      out.push({ grade: e.b, inReach });
      waiting = false;
    }
  }
  return out;
}

describe('the timing meter', () => {
  it('a release on the meter\'s Perfect is graded Perfect, the planned contact in reach or still on the way', () => {
    // On the way (or not getting there), the meter shows the plan's own moment; the release was judged only against
    // windows in reach from where the body was, so it came back "Too early" or "Too late" by 200 ms (seed 8 at 20.9 s),
    // or as a swing at nothing (seeds 3 and 4), on a Perfect meter (the owner, 6 Nov 2026).
    const all: { grade: number; inReach: boolean }[] = [];
    for (const seed of [3, 4, 8]) all.push(...releasesOnTheMeter(seed, 60));
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((r) => !r.inReach).length).toBeGreaterThan(2);
    const off = all.filter((r) => r.grade !== G_PERFECT).map((r) => `${GRADE_TEXT[r.grade]}${r.inReach ? '' : ' (on the way)'}`);
    expect(off).toEqual([]);
  });
});
