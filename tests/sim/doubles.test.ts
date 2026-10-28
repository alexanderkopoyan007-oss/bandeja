// Doubles: four players, the FIP serve rotation (6.9, 8.2-8.3), who may return the serve (8.1), and AI pairs that
// actually play the game (both partners hit, few balls in the body).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_POINT, E_HIT, E_TOSS, E_FAULT, E_LET, E_CALL, CALL_MINE, CALL_YOURS, CALL_SWITCH, PH_SETUP, PH_RALLY } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { SW_IDLE, SW_CHARGE, type Player } from '../../src/sim/player/player.ts';
import { SHOT_SERVE, SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { WHY_HIT_BODY_OPP, WHY_HIT_BODY_OWN } from '../../src/sim/rules/rally.ts';
import { MODE_GOLDEN, DEFAULT_FORMAT } from '../../src/sim/rules/score.ts';

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
  // Long enough for six service games now that rallies run longer (median 8 shots a point).
  const a = play(7, 900);

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
    const out = { hits: [0, 0, 0, 0], serves: 0, given: 0, returned: 0, points: 0, yours: 0, humanCalls: 0 };
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
        // A faulted serve is not a ball to return either (it was counted against the human: seven of the fourteen
        // 'missed' balls in 900 s were out-of-box, net and glass-first faults).
        if (e.kind === E_FAULT && waiting) { out.given--; waiting = false; }
        if (e.kind === E_CALL && e.player === 0) out.humanCalls++;
        if (e.kind === E_CALL && e.player === 2 && e.a === CALL_YOURS) out.yours++;
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
    const r = playHuman(3, 900);
    expect(r.points).toBeGreaterThan(15);
    expect(r.serves).toBeGreaterThan(3);
    expect(r.hits[0]).toBeGreaterThan(20);
    expect(r.hits[2]).toBeGreaterThan(20);
    expect(r.given).toBeGreaterThan(20);
    expect(r.returned / r.given).toBeGreaterThan(0.9);
    // The AI partner tells the human which contested balls are theirs; the human never 'speaks'.
    expect(r.yours).toBeGreaterThan(0);
    expect(r.humanCalls).toBe(0);
  });
});

describe('pair teamwork', () => {
  // Lobs to one side over a net pair, taken by the partner on the diagonal: does the lobbed player cross over? And
  // the calls a pair makes.
  function teamwork(seeds: number, secs: number) {
    let mateTakes = 0, switched = 0, splitTicks = 0, ticks = 0;
    const calls = [0, 0, 0];
    for (let sd = 1; sd <= seeds; sd++) {
      const m = new MatchSim({ seed: sd * 7919, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
      let seen = 0;
      let lob: { team: number; over: number; lane: number; taken: boolean } | null = null;
      const laneOf = (team: number) => Math.sign((m.players[team]!.pos.x - m.players[team + 2]!.pos.x) * m.side(team));
      for (let k = 0; k < 120 * secs; k++) {
        m.step(NONE);
        if (m.phase === PH_RALLY && m.rally.hitter >= 0 && (k & 7) === 0) {
          const t = m.rally.hitter;
          ticks++;
          if ((Math.abs(m.players[t]!.pos.z) < 5) !== (Math.abs(m.players[t + 2]!.pos.z) < 5)) splitTicks++;
        }
        while (seen < m.eventSeq) {
          const e = m.events[seen++ % m.events.length]!;
          if (e.kind === E_CALL) calls[e.a]!++;
          if (e.kind === E_POINT) lob = null;
          if (e.kind !== E_HIT) continue;
          if (lob && e.team === lob.team && !lob.taken) {
            lob.taken = true;
            if (e.player === lob.over) lob = null; else mateTakes++;
          } else if (lob && lob.taken && e.team !== lob.team) {
            if (laneOf(lob.team) !== lob.lane) switched++;
            lob = null;
          }
          if (!lob && SHOT_KEYS[e.a] === 'lob') {
            const team: number = 1 - e.team;
            const a: Player = m.players[team]!, b: Player = m.players[team + 2]!;
            let lx = 0;
            for (let i = 0; i < m.pred.n; i++) if (m.pred.bounces[i]! > 0) { lx = m.pred.x[i]!; break; }
            if (Math.abs(a.pos.z) < 5 && Math.abs(b.pos.z) < 5 && Math.abs(lx) > 1.3) {
              lob = { team, over: (a.pos.x - b.pos.x) * lx > 0 ? team : team + 2, lane: laneOf(team), taken: false };
            }
          }
        }
      }
    }
    return { mateTakes, switched, split: splitTicks / ticks, calls };
  }

  it('partners move as a unit, switch sides when the partner takes a lob over them, and call the ball', () => {
    const r = teamwork(6, 300);
    // The pair that just struck is level (both up or both back) most of the time: split 11-12% when measured.
    expect(r.split).toBeLessThan(0.2);
    // Before the switch existed: 0 of 29.
    expect(r.mateTakes).toBeGreaterThan(5);
    expect(r.switched / r.mateTakes).toBeGreaterThan(0.4);
    expect(r.calls[CALL_MINE]).toBeGreaterThan(20);
    expect(r.calls[CALL_SWITCH]).toBeGreaterThan(5);
  }, 120_000);
});

describe('deciding point', () => {
  it('the receiving pair chooses who receives: a pair with a human puts the human on it', () => {
    for (const human of [0, 2]) {
      const cfg = { seed: 5, doubles: true, firstServer: 1, format: { ...DEFAULT_FORMAT, mode: MODE_GOLDEN } };
      const m = new MatchSim({ ...cfg, human: [0, 1, 2, 3].map((i) => i === human) });
      m.score.points[0] = 3;
      m.score.points[1] = 3;
      (m as unknown as { startPoint(): void }).startPoint();
      expect(m.score.isDecidingPoint()).toBe(true);
      expect(m.score.receiverPlayer()).toBe(human);
    }
  });
});

describe('AI playing styles', () => {
  function shots(style: string, seed = 7, out: Record<string, number> = { all: 0 }): Record<string, number> {
    const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiStyle: [style, style, style, style] });
    let seen = 0;
    for (let i = 0; i < 120 * 400; i++) {
      m.step(NONE);
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind !== E_HIT) continue;
        out.all!++;
        out[SHOT_KEYS[e.a]!] = (out[SHOT_KEYS[e.a]!] ?? 0) + 1;
      }
    }
    return out;
  }

  it('El Muro lobs far more than Martillo; La Serpiente turns more overheads into víboras', () => {
    const muro = shots('muro');
    const martillo = shots('martillo');
    // Overheads are rare (10-15 a run), so the víbora share pools ten seeds; five were still a coin toss.
    const pool = (style: string) => {
      let acc = shots(style);
      for (const seed of [1, 2, 3, 4, 5, 6, 8, 9, 10]) acc = shots(style, seed, acc);
      return acc;
    };
    const serpiente = pool('serpiente');
    const reloj = pool('reloj');
    const share = (s: Record<string, number>, k: string) => (s[k] ?? 0) / s.all!;
    expect(share(muro, 'lob')).toBeGreaterThan(1.5 * share(martillo, 'lob'));
    const vib = (s: Record<string, number>) => (s.vibora ?? 0) / ((s.vibora ?? 0) + (s.bandeja ?? 0) + (s.smash ?? 0));
    // (Phase 1 lowered this bar to 1.25 when the ratio came out 1.36. The cause was the AI never letting go of a
    // modifier: after one víbora precision stayed held, so every style's overheads drifted to víboras. With that
    // fixed in Phase 2 the ratio is about 4.)
    expect(vib(serpiente)).toBeGreaterThan(1.4 * vib(reloj));
  }, 300_000);
});
