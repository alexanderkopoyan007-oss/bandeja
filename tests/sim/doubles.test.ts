// Doubles: four players, the FIP serve rotation (6.9, 8.2-8.3), who may return the serve (8.1), and AI pairs that
// actually play the game (both partners hit, few balls in the body).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_POINT, E_HIT, E_TOSS, E_FAULT, E_LET, PH_SETUP, PH_RALLY } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';
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

describe('a human with an AI partner', () => {
  // A human-like bot as player 0: holds drive for the balls the pair gives it (auto timing releases) and serves in
  // turn; it never moves by itself, so the positioning assist and the formation assist place it. The AI partner
  // (player 2) plays the rest.
  function playHuman(seed: number, seconds: number) {
    const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false], autoTiming: true, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame();
    const frames = [f, null, null, null];
    const out = { hits: [0, 0, 0, 0], serves: 0, given: 0, returned: 0, points: 0 };
    let holding = false;
    let seen = 0;
    let pending = false;
    let waiting = false;
    for (let i = 0; i < seconds * 120; i++) {
      f.clear();
      const p = m.players[0]!;
      if (holding && p.swing !== SW_CHARGE) { f.push(false, BTN_DRIVE, m.time); holding = false; }
      const serve = m.phase === PH_SETUP && m.score.serverPlayer() === 0 && m.time > m.phaseUntil + 0.2;
      const ours = m.phase === PH_RALLY && m.rally.hitter === 1 && m.taker[0] === 0;
      if (!holding && p.swing === SW_IDLE && (serve || ours)) {
        f.push(true, BTN_DRIVE, m.time);
        holding = true;
      }
      f.held = holding ? BTN_DRIVE : 0;
      m.step(frames);
      if (pending && m.taker[0] === 0) { out.given++; pending = false; waiting = true; }
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_HIT) {
          out.hits[e.player]!++;
          if (e.player === 0 && e.a === SHOT_SERVE) out.serves++;
          if (e.player === 0 && waiting) out.returned++;
          waiting = false;
          pending = e.team === 1;
        }
        if (e.kind === E_POINT) {
          // The opponents' shot ended in the net or out before it reached us: not a ball we had to play.
          if (waiting && e.team === 0) out.given--;
          out.points++;
          pending = false;
          waiting = false;
        }
      }
    }
    return out;
  }

  it('the human gets their share of the balls, serves in turn, and returns most of them', () => {
    const r = playHuman(3, 600);
    expect(r.points).toBeGreaterThan(15);
    expect(r.serves).toBeGreaterThan(3);
    expect(r.hits[0]).toBeGreaterThan(20);
    expect(r.hits[2]).toBeGreaterThan(20);
    expect(r.given).toBeGreaterThan(20);
    expect(r.returned / r.given).toBeGreaterThan(0.9);
  });
});
