// The volley key (N): holding it plans the incoming ball in the air, the player moves in to cut it off, and the
// contact is a punch volley. A bot plays at the net with it and with the drive key, to compare.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_OVER, E_HIT, E_POINT } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_VOLLEY, BTN_POWER } from '../../src/sim/input.ts';
import { SHOT_VOLLEY, SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';

interface Tally { hits: number; volleys: number; won: number; lost: number; bounced: number }

/**
 * A net player: serves with drive, then after each of its own shots closes to 3 m from the net and holds `key`
 * as the opponent strikes (auto timing releases it). `power` holds Space too.
 */
function netPlay(seed: number, seconds: number, key: number, power = false): Tally {
  const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false], firstServer: 0, autoTiming: true, assist: 0.45, timingScale: 1.5 });
  const f = new InputFrame();
  const t: Tally = { hits: 0, volleys: 0, won: 0, lost: 0, bounced: 0 };
  let holding = 0;
  let seen = 0;
  let mine = false;
  for (let i = 0; i < seconds * 120 && m.phase !== PH_OVER; i++) {
    f.clear();
    const p = m.players[0]!;
    if (holding && p.swing !== SW_CHARGE) { f.push(false, holding, m.time); holding = 0; }
    const serve = m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2;
    // Doubles: only the balls given to us (the partner takes the rest).
    const incoming = m.phase === PH_RALLY && m.rally.hitter === 1 && m.taker[0] === 0;
    if (!holding && p.swing === SW_IDLE && (serve || incoming)) {
      holding = serve ? BTN_DRIVE : key;
      f.push(true, holding, m.time);
    }
    if (!p.aiming && m.phase === PH_RALLY && m.rally.hitter === 0) {
      const s = m.side(0);
      // Our lane: the side of the court we are on relative to the partner, 2.2 m off the middle.
      const mate = m.players[2]!;
      const lane = (p.pos.x - mate.pos.x) >= 0 ? 1 : -1;
      const dx = lane * 2.2 - p.pos.x;
      const dz = s * 3.0 - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) { f.moveX = (dx / d) * s; f.moveY = (-dz / d) * s; }
    }
    f.held = holding | (power && holding ? BTN_POWER : 0);
    m.step([f, null, null, null]);
    for (; seen < m.eventSeq; seen++) {
      const e = m.events[seen % m.events.length]!;
      if (e.kind === E_HIT && e.player === 0 && e.a !== SHOT_SERVE) {
        t.hits++;
        if (e.a === SHOT_VOLLEY) t.volleys++;
        mine = true;
      } else if (e.kind === E_HIT) mine = false;
      else if (e.kind === E_POINT) {
        if (mine) { if (e.team === 0) t.won++; else t.lost++; }
        mine = false;
      }
    }
  }
  return t;
}

const pool = (key: number, power = false): Tally => {
  const all: Tally = { hits: 0, volleys: 0, won: 0, lost: 0, bounced: 0 };
  for (let seed = 1; seed <= 5; seed++) {
    const t = netPlay(seed, 120, key, power);
    all.hits += t.hits; all.volleys += t.volleys; all.won += t.won; all.lost += t.lost;
  }
  return all;
};

describe('volley key', () => {
  const volley = pool(BTN_VOLLEY);
  const drive = pool(BTN_DRIVE);

  it('at the net, holding it takes most balls in the air; the drive key lets more of them bounce', () => {
    expect(volley.hits).toBeGreaterThan(40);
    expect(volley.volleys / volley.hits).toBeGreaterThan(0.7);
    expect(volley.volleys / volley.hits).toBeGreaterThan(drive.volleys / Math.max(1, drive.hits) + 0.1);
  });

  it('the volleys land: the net player loses no more points on their own shots than with the drive key', () => {
    const errV = volley.lost / Math.max(1, volley.hits);
    const errD = drive.lost / Math.max(1, drive.hits);
    expect(errV).toBeLessThan(errD + 0.05);
  });
}, 300_000);
