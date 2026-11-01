// The partner of a human who has taken the net: comes in too, and aims round them. A stand-in runs to the net by hand, as nothing in the game does for
// them, and hits what comes to it.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_OVER, E_HIT, E_POINT } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_VOLLEY } from '../../src/sim/input.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';
import { WHY_HIT_BODY_OWN } from '../../src/sim/rules/rally.ts';

function atNet(seed: number, seconds: number): { points: number; intoYou: number; split: number; strikes: number } {
  const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false], firstServer: 0, autoTiming: true, assist: 0, timingScale: 1.5 });
  const f = new InputFrame();
  const t = { points: 0, intoYou: 0, split: 0, strikes: 0 };
  let holding = 0, seen = 0, last = -1;
  for (let i = 0; i < seconds * 120 && m.phase !== PH_OVER; i++) {
    f.clear();
    const p = m.players[0]!;
    if (holding && p.swing !== SW_CHARGE) { f.push(false, holding, m.time); holding = 0; }
    const serve = m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2;
    const mine = m.phase === PH_RALLY && m.rally.hitter === 1 && m.taker[0] === 0;
    if (!holding && p.swing === SW_IDLE && (serve || mine)) { holding = serve ? BTN_DRIVE : BTN_VOLLEY; f.push(true, holding, m.time); }
    if (!p.aiming && m.phase === PH_RALLY) {
      const s = m.side(0), dx = 1.6 * s - p.pos.x, dz = s * 3.5 - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { f.moveX = (dx / d) * s; f.moveY = (-dz / d) * s; }
    }
    f.held = holding;
    m.step([f, null, null, null]);
    for (; seen < m.eventSeq; seen++) {
      const e = m.events[seen % m.events.length]!;
      if (e.kind === E_HIT) {
        last = e.player;
        if (e.player % 2 === 1 && Math.abs(p.pos.z) < 5.2) { t.strikes++; if (Math.abs(m.players[2]!.pos.z) > 6) t.split++; }
      } else if (e.kind === E_POINT) { t.points++; if (e.a === WHY_HIT_BODY_OWN && e.team === 1 && last === 2) t.intoYou++; }
    }
  }
  return t;
}

describe('the partner of a human at the net', () => {
  const all = { points: 0, intoYou: 0, split: 0, strikes: 0 };
  for (let seed = 1; seed <= 16; seed++) {
    const t = atNet(seed, 400);
    all.points += t.points; all.intoYou += t.intoYou; all.split += t.split; all.strikes += t.strikes;
  }
  it('plays with them', () => {
    process.stderr.write(`partner: ${all.points} points, ${all.intoYou} into you; strikes at you at the net ${all.strikes}, ${all.split} with the partner on the glass\n`);
    expect(all.points).toBeGreaterThan(300);
    expect(all.intoYou / all.points).toBeLessThan(0.006);
    expect(all.split / all.strikes).toBeLessThan(0.13); // (0.17 before)
  });
});
