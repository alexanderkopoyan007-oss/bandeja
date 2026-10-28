// The volley key (N): holding it plans the incoming ball in the air, the player moves in to cut it off, and the
// contact is a punch volley. A bot plays at the net with it and with the drive key, to compare.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_OVER, E_HIT, E_POINT, E_WHIFF } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_VOLLEY, BTN_POWER } from '../../src/sim/input.ts';
import { SHOT_VOLLEY, SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';

/** lost: points lost on the player's own hits; misses: swings that met nothing; lostMiss: points lost right after one. */
interface Tally { hits: number; volleys: number; won: number; lost: number; misses: number; lostMiss: number; hash: number }

/**
 * A net player: serves with drive, then after each of its own shots closes to 3 m from the net and holds `key`
 * as the opponent strikes (auto timing releases it). `power` holds Space too. `probe` reads the cue's helpers
 * between steps, as the HUD and the assist view do.
 */
function netPlay(seed: number, seconds: number, key: number, power = false, probe = false): Tally {
  const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false], firstServer: 0, autoTiming: true, assist: 0.45, timingScale: 1.5 });
  const f = new InputFrame();
  const t: Tally = { hits: 0, volleys: 0, won: 0, lost: 0, misses: 0, lostMiss: 0, hash: 0 };
  let holding = 0;
  let missed = false;
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
    if (probe && m.focusIdeal(0) >= -2) m.windowScale(0);
    // The state through the match, not only at its end: a difference inside a rally can heal at the next point.
    if ((i & 127) === 0) t.hash = Math.imul(t.hash, 31) + m.hash() | 0;
    for (; seen < m.eventSeq; seen++) {
      const e = m.events[seen % m.events.length]!;
      if (e.kind === E_HIT && e.player === 0 && e.a !== SHOT_SERVE) {
        t.hits++;
        if (e.a === SHOT_VOLLEY) t.volleys++;
        mine = true;
        missed = false;
      } else if (e.kind === E_HIT) { mine = false; missed = false; }
      else if (e.kind === E_WHIFF && e.player === 0) { t.misses++; missed = true; }
      else if (e.kind === E_POINT) {
        if (mine) { if (e.team === 0) t.won++; else t.lost++; }
        if (missed && e.team !== 0) t.lostMiss++;
        mine = false;
        missed = false;
      }
    }
  }
  return t;
}

const pool = (key: number, power = false): Tally => {
  const all: Tally = { hits: 0, volleys: 0, won: 0, lost: 0, misses: 0, lostMiss: 0, hash: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    const t = netPlay(seed, 120, key, power);
    all.hits += t.hits; all.volleys += t.volleys; all.won += t.won; all.lost += t.lost;
    all.misses += t.misses; all.lostMiss += t.lostMiss;
  }
  return all;
};

describe('volley key', () => {
  const volley = pool(BTN_VOLLEY);
  const drive = pool(BTN_DRIVE);

  it('at the net, holding it takes most balls in the air; the drive key lets more of them bounce', () => {
    expect(volley.hits).toBeGreaterThan(40);
    // 0.6: the Phase 4 AI keeps more balls low at a net player's feet, which have to bounce (0.66-0.70 now, from
    // above 0.7); what the key changes is the next line.
    expect(volley.volleys / volley.hits).toBeGreaterThan(0.6);
    expect(volley.volleys / volley.hits).toBeGreaterThan(drive.volleys / Math.max(1, drive.hits) + 0.1);
  });

  it('the volleys land: under 5% of the net player\'s swings lose the point (misses counted), about as with the drive key', () => {
    // 12 matches: 5 gave 0 and 1 lost points, which proved nothing. A swing that meets nothing counts, with the
    // point lost straight after it: assisted timing used to fire volley swings before the ball was in reach (32
    // misses with N against 14 with J, 8.8% of swings losing the point against 4.3%).
    const errV = (volley.lost + volley.lostMiss) / Math.max(1, volley.hits + volley.misses);
    const errD = (drive.lost + drive.lostMiss) / Math.max(1, drive.hits + drive.misses);
    process.stderr.write(`volley key: ${volley.hits} hits, ${volley.volleys} in the air, ${volley.lost} points lost on them, ${volley.misses} misses (${volley.lostMiss} lost after); drive key: ${drive.hits} hits, ${drive.volleys} in the air, ${drive.lost} lost, ${drive.misses} misses (${drive.lostMiss} lost after)\n`);
    // At Good timing errors are rare either way (1 of 216 with N, 2 of 189 with the drive key, no misses): the
    // check is that volleys stay that safe, not a difference between the keys.
    expect(volley.hits).toBeGreaterThan(120);
    expect(volley.misses).toBeLessThan(0.05 * volley.hits);
    expect(errV).toBeLessThan(0.05);
    expect(errV).toBeLessThan(errD + 0.03);
  });

  it('reading the cue between steps (HUD, assist view) leaves the sim as it was: replays are seed + inputs', () => {
    // Seed 12 used to part at 71.5 s: focusIdeal left the contact's height stale on one path, and assisted
    // timing read it.
    for (const seed of [12, 5]) expect(netPlay(seed, 90, BTN_VOLLEY, false, true).hash).toBe(netPlay(seed, 90, BTN_VOLLEY).hash);
  });
}, 300_000);
