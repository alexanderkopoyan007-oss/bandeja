// Doubles: four players, the FIP serve rotation (6.9, 8.2-8.3), who may return the serve (8.1), and AI pairs that
// actually play the game (both partners hit, few balls in the body).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_POINT, E_HIT, E_TOSS, E_FAULT, E_LET } from '../../src/sim/match.ts';
import { SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { WHY_HIT_BODY_OPP, WHY_HIT_BODY_OWN } from '../../src/sim/rules/rally.ts';

const NONE = [null, null, null, null];

interface Log {
  m: MatchSim;
  points: number;
  hits: number[];
  serves: number[];
  bodyEnds: number;
  /** Server of each service turn, in order (consecutive tosses by the same player merged). */
  servers: number[];
  /** Returns of serve made by someone other than the receiver. */
  wrongReturns: number;
  returns: number;
}

function play(seed: number, seconds: number): Log {
  const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
  const log: Log = { m, points: 0, hits: [0, 0, 0, 0], serves: [0, 0, 0, 0], bodyEnds: 0, servers: [], wrongReturns: 0, returns: 0 };
  let seen = 0;
  let receiver = -1;
  for (let i = 0; i < 120 * seconds; i++) {
    m.step(NONE);
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_TOSS && log.servers[log.servers.length - 1] !== e.player) log.servers.push(e.player);
      if (e.kind === E_HIT) {
        log.hits[e.player]!++;
        if (e.a === SHOT_SERVE) {
          log.serves[e.player]!++;
          receiver = m.score.receiverPlayer();
        } else if (receiver >= 0) {
          log.returns++;
          if (e.player !== receiver) log.wrongReturns++;
          receiver = -1;
        }
      }
      if (e.kind === E_POINT || e.kind === E_FAULT || e.kind === E_LET) receiver = -1;
      if (e.kind === E_POINT) {
        log.points++;
        if (e.a === WHY_HIT_BODY_OPP || e.a === WHY_HIT_BODY_OWN) log.bodyEnds++;
      }
    }
  }
  return log;
}

describe('doubles', () => {
  const a = play(7, 600);

  it('is deterministic', () => {
    const run = (seed: number) => {
      const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
      for (let i = 0; i < 10000; i++) m.step(NONE);
      return m.hash();
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  it('AI pairs play real rallies, and every player hits and serves', () => {
    expect(a.points).toBeGreaterThan(30);
    for (let i = 0; i < 4; i++) {
      expect(a.hits[i]).toBeGreaterThan(25);
      expect(a.serves[i]).toBeGreaterThan(3);
    }
  });

  it('balls are played, not taken in the body: under 12% of points end on a player', () => {
    const b = play(1, 600);
    expect((a.bodyEnds + b.bodyEnds) / (a.points + b.points)).toBeLessThan(0.12);
  });

  it('6.9: the pairs alternate service games, and partners take turns within each pair', () => {
    const s = a.servers.slice(0, 6);
    expect(s.length).toBe(6);
    for (let k = 0; k + 1 < s.length; k++) expect(s[k]! & 1).not.toBe(s[k + 1]! & 1);
    for (let k = 0; k + 2 < s.length; k++) expect(s[k]! ^ s[k + 2]!).toBe(2);
  });

  it('8.1: only the receiver returns the serve', () => {
    expect(a.returns).toBeGreaterThan(25);
    expect(a.wrongReturns).toBe(0);
  });
});
