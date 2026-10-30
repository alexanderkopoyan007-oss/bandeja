// Where the AI's rally goes (review round 4, the pro's #1, #2, #4-#6): measured over whole matches, so a seed shift
// moves a share a little and not a test's verdict.
import { describe, it, expect } from 'vitest';
import { MatchSim, E_HIT, E_FLOOR, E_POINT, E_WALL, PH_OVER } from '../../src/sim/match.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { WALL_BACK_NEAR, WALL_BACK_FAR } from '../../src/sim/court/court.ts';

interface Tally { cross: number; line: number; drops: number; dropLow: number; points: number; volleys: number; shots: number; ohFull: number; oh: number; sideFull: number }

function play(doubles: boolean, matches: number, seed0: number): Tally {
  const out: Tally = { cross: 0, line: 0, drops: 0, dropLow: 0, points: 0, volleys: 0, shots: 0, ohFull: 0, oh: 0, sideFull: 0 };
  const n = doubles ? 4 : 2;
  for (let k = 0; k < matches; k++) {
    const m = new MatchSim({ seed: seed0 + k, doubles, human: new Array(n).fill(false), aiLevel: [1, 1] });
    const none = new Array(n).fill(null);
    let seen = 0, last = '', from = 0, bounces = 0, twoBack = false;
    for (let t = 0; m.phase !== PH_OVER && t < 120 * 2400; t++) {
      m.step(none);
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_HIT) {
          const kind = SHOT_KEYS[e.a] ?? '?';
          out.shots++;
          if (bounces === 0 && kind !== 'serve') out.volleys++;
          if (last === 'bandeja') { out.oh++; if (bounces === 0 && Math.abs(e.z) > 6) out.ohFull++; }
          if (bounces === 0 && kind === 'drop' && Math.abs(e.z) < 5) { out.drops++; if (e.y < 0.85) out.dropLow++; }
          last = kind; from = e.x; bounces = 0;
          twoBack = m.players.every((p) => p.team === e.team || Math.abs(p.pos.z) > 5);
        } else if (e.kind === E_FLOOR) {
          if (bounces === 0 && twoBack && Math.abs(from) > 1 && Math.abs(e.x) > 1 && (last === 'drive' || last === 'slice' || last === 'topspin')) {
            if (e.x * from < 0) out.cross++; else out.line++;
          }
          bounces++;
        } else if (e.kind === E_WALL && bounces === 0 && e.b !== WALL_BACK_NEAR && e.b !== WALL_BACK_FAR && last !== 'serve' && last !== 'contrapared') out.sideFull++;
        else if (e.kind === E_POINT) out.points++;
      }
    }
  }
  return out;
}

describe('where the AI puts the ball', () => {
  it('doubles: cross-court leads, net drops come off high balls, bandejas are let through', () => {
    const t = play(true, 8, 2301);
    expect(t.cross / (t.cross + t.line)).toBeGreaterThan(0.5);
    expect(t.dropLow / Math.max(1, t.drops)).toBeLessThan(0.2);
    expect(t.drops / t.points).toBeLessThan(0.14);
    expect(t.ohFull / t.oh).toBeLessThan(0.15);
  }, 300000);

  it('singles: the side glass on the full is rare and players come to the net', () => {
    const t = play(false, 10, 2401);
    expect(t.sideFull / t.points).toBeLessThan(0.14);
    expect(t.volleys / t.shots).toBeGreaterThan(0.07);
  }, 300000);
});
