import { describe, expect, it } from 'vitest';
import { MatchSim, E_FAULT, E_FLOOR, E_HIT, E_POINT, E_WALL, PH_OVER } from '../../src/sim/match.ts';
import { SHOT_BANDEJA, SHOT_KEYS, SHOT_VIBORA } from '../../src/sim/contact/shots.ts';
import { WALL_BACK_FAR, WALL_BACK_NEAR } from '../../src/sim/court/court.ts';

// The AI's serve and the overheads, against what WPT men do (review round 3, the pro's Mediums #6-#7 and Low #12;
// docs/research/shots-movement-feel.md §6): 64.6% of serves into the side glass, 24.3% to the T, 11.1% to the middle,
// from the left court more to the glass, about 7-10% of first serves faulted and 2% of second serves. The víbora is
// the attacking overhead, faster than the bandeja. The players' places at the serve vary from point to point.

function measure() {
  let serves = 0, glass = 0, left = 0, leftGlass = 0, right = 0, rightGlass = 0;
  let faults1 = 0, faults2 = 0, seconds = 0, firsts = 0;
  const bandeja: number[] = [], vibora: number[] = [];
  const net: number[] = [], back: number[] = [], netX: number[] = [];
  // (six whole matches: about 500 serves. In 300 s a match has only about 15 points.)
  for (let seed = 1; seed <= 6; seed++) {
    const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    const frames = [null, null, null, null];
    let seq = 0, open = false, fromLeft = false, bounced = false;
    for (let k = 0; k < 2400 * 120 && m.phase !== PH_OVER; k++) {
      m.step(frames);
      for (; seq < m.eventSeq; seq++) {
        const e = m.events[seq % m.events.length]!;
        if (e.kind === E_HIT) {
          open = false;
          if (SHOT_KEYS[e.a] === 'serve') {
            const p = m.players[e.player]!, mate = m.players[e.player ^ 2]!;
            serves++;
            if (m.serveNo === 2) seconds++; else firsts++;
            open = true;
            bounced = false;
            fromLeft = p.pos.x * m.side(p.team) < 0;
            if (fromLeft) left++; else right++;
            net.push(Math.abs(mate.pos.z));
            netX.push(Math.abs(mate.pos.x));
            const r = m.players[m.score.receiverPlayer()]!;
            back.push(Math.abs(m.players[r.index ^ 2]!.pos.z));
          } else if (e.a === SHOT_BANDEJA) bandeja.push(e.c);
          else if (e.a === SHOT_VIBORA) vibora.push(e.c);
        } else if (e.kind === E_FLOOR) bounced = true;
        else if (e.kind === E_WALL && open && bounced && e.b !== WALL_BACK_NEAR && e.b !== WALL_BACK_FAR) {
          open = false;
          glass++;
          if (fromLeft) leftGlass++; else rightGlass++;
        } else if (e.kind === E_FAULT) {
          if (e.b === 1) faults1++; else faults2++;
        } else if (e.kind === E_POINT) open = false;
      }
    }
  }
  return { serves, glass, left, leftGlass, right, rightGlass, faults1, faults2, firsts, seconds, bandeja, vibora, net, back, netX };
}

const med = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

describe('the AI serve and overheads', () => {
  const r = measure();

  it('serves mostly into the side glass, more from the left court', () => {
    expect(r.serves).toBeGreaterThan(300);
    expect(r.glass / r.serves).toBeGreaterThan(0.5);
    expect(r.glass / r.serves).toBeLessThan(0.75);
    expect(r.leftGlass / r.left).toBeGreaterThan(r.rightGlass / r.right);
  });

  it('faults some first serves and a few second serves', () => {
    expect(r.faults1 / r.firsts).toBeGreaterThan(0.03);
    expect(r.faults1 / r.firsts).toBeLessThan(0.15);
    expect(r.faults2 / r.seconds).toBeLessThan(0.08);
  });

  it('hits the víbora harder than the bandeja', () => {
    expect(r.vibora.length).toBeGreaterThan(40);
    expect(med(r.vibora)).toBeGreaterThan(med(r.bandeja) + 1);
  });

  it('varies where the net player and the receiver\'s partner stand', () => {
    expect(Math.min(...r.net)).toBeGreaterThanOrEqual(2.2 - 1e-9);
    expect(Math.max(...r.net)).toBeLessThanOrEqual(3.2 + 1e-9);
    expect(Math.max(...r.net) - Math.min(...r.net)).toBeGreaterThan(0.7);
    expect(Math.max(...r.netX) - Math.min(...r.netX)).toBeGreaterThan(0.6);
    expect(Math.min(...r.back)).toBeGreaterThanOrEqual(6.6 - 1e-9);
    expect(Math.max(...r.back)).toBeLessThanOrEqual(7.8 + 1e-9);
    expect(Math.max(...r.back) - Math.min(...r.back)).toBeGreaterThan(0.8);
  });
});
