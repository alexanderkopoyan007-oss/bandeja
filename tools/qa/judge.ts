// The QA army's judge: turns the sim's events into rule facts (tools/qa/facts.ts), has the referee and score
// oracles (written from the FIP text alone) decide them, and notes every disagreement with the game: a call the
// game made differently, a call one side made and the other didn't, a score, server, receiver, box or end that
// differs.
//
// The oracles see the court through their own eyes: the serve's box and each team's half come from the score
// oracle, not from the game, so a game that serves into the wrong box or plays the wrong end shows up as a
// disagreement rather than being passed through.
import type { MatchSim } from '../../src/sim/match.ts';
import { SIDE_RIGHT, MODE_ADVANTAGE, MODE_GOLDEN, FINAL_ADVANTAGE, FINAL_NORMAL, FINAL_TIEBREAK7 } from '../../src/sim/rules/score.ts';
import { SURF_MESH, WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT } from '../../src/sim/court/court.ts';
import { SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { REASON_TEXT } from '../../src/sim/rules/rally.ts';
import type { Anomaly } from './checks.ts';
import type { ArmyConfig } from './config.ts';
import type { Call, Fact, Format, Half, MatchFacts, ScoreState, Wall } from './facts.ts';
import { RefereeOracle } from './refereeOracle.ts';
import { ScoreOracle } from './scoreOracle.ts';

const PH_SETUP = 0;
const PH_TOSS = 1;
const PH_RALLY = 2;

const E_HIT = 1, E_FLOOR = 2, E_WALL = 3, E_NET = 4, E_POINT = 5, E_FAULT = 6, E_LET = 7, E_WHIFF = 11, E_TOSS = 13, E_EXIT = 14, E_BODY = 18;
const EVENT_RING = 64;
/** Facts kept for the log around a disagreement. */
const KEEP = 24;

function wallName(w: number): Wall {
  return w === WALL_BACK_NEAR ? 'backNear' : w === WALL_BACK_FAR ? 'backFar' : w === WALL_SIDE_LEFT ? 'sideLeft' : 'sideRight';
}

function fmtFact(f: Fact): string {
  const o: Record<string, unknown> = { ...f };
  for (const k of ['x', 'y', 'z']) if (typeof o[k] === 'number') o[k] = Number((o[k] as number).toFixed(2));
  return JSON.stringify(o);
}

export class Judge {
  readonly ref: RefereeOracle;
  readonly score: ScoreOracle;
  points = 0;
  faults = 0;
  lets = 0;
  private lastSeq: number;
  private phaseBefore = -1;
  private side: Half = 1;
  /** The serve attempt in progress (from its 'serve' fact): server, and whether it has been struck. */
  private server = -1;
  private struck = false;
  private oracleCall: Call | null = null;
  private oracleCallAt = 0;
  private readonly recent: string[] = [];
  private attempt = 0;

  private readonly sim: MatchSim;
  private readonly note: (a: Anomaly) => void;
  private readonly trace: number | undefined;

  constructor(sim: MatchSim, cfg: ArmyConfig, note: (a: Anomaly) => void, trace?: number) {
    this.sim = sim;
    this.note = note;
    this.trace = trace;
    const c = sim.world.court;
    const m: MatchFacts = {
      doubles: sim.doubles,
      court: {
        width: c.def.width, length: c.def.length, serviceLineFromNet: c.def.serviceLineFromNet, lineWidth: c.def.lineWidth,
        doors: c.openings.map((o) => ({ z0: o.z0, z1: o.z1, height: o.height })),
        outOfCourtPlay: sim.rally.outOfCourtPlay,
      },
    };
    this.ref = new RefereeOracle(m);
    const f = cfg.format;
    const fmt: Format = {
      mode: f.mode === MODE_ADVANTAGE ? 'advantage' : f.mode === MODE_GOLDEN ? 'golden' : 'star',
      setsToWin: f.setsToWin,
      gamesPerSet: f.gamesPerSet,
      finalSet: f.finalSet === FINAL_NORMAL ? 'normal' : f.finalSet === FINAL_ADVANTAGE ? 'advantage' : f.finalSet === FINAL_TIEBREAK7 ? 'tiebreak7' : 'supertb10',
      doubles: sim.doubles,
      firstServerTeam: sim.score.serverTeam(),
      team0Half: sim.side(0) > 0 ? 1 : -1,
    };
    this.score = new ScoreOracle(fmt);
    // The match is already in its first point's setup: describe it now.
    this.lastSeq = sim.eventSeq - 1;
    this.startAttempt();
    this.phaseBefore = sim.phase;
  }

  private flag(kind: string, sig: string, detail: string): void {
    this.note({ kind, sig, detail: `${detail}\n  facts: ${this.recent.join(' | ')}`, tick: this.sim.tick, time: this.sim.time });
  }

  private feed(f: Fact): void {
    this.recent.push(fmtFact(f));
    if (this.recent.length > KEEP) this.recent.shift();
    if (this.trace !== undefined && Math.abs(this.sim.tick - this.trace) < 600) console.log(`  [${this.sim.tick}] fact ${fmtFact(f)}`);
    const call = this.ref.feed(f);
    if (call && !this.oracleCall) {
      this.oracleCall = call;
      this.oracleCallAt = this.sim.time;
    }
  }

  /** A serve attempt begins: compare the score and who serves where, then tell the referee. */
  private startAttempt(): void {
    const s = this.sim;
    const sc = s.score;
    const need = this.score.needs();
    if (need === 'setStart') this.score.choose({ firstServerSlot: [sc.firstServerSlot[0]!, sc.firstServerSlot[1]!], firstReceiverSlot: [sc.firstReceiverSlot[0]!, sc.firstReceiverSlot[1]!] });
    let st: ScoreState = this.score.state();
    if (st.deciding || this.score.needs() === 'deciding') {
      this.score.choose({ decidingSide: sc.decidingSide === SIDE_RIGHT ? 'right' : 'left' });
      st = this.score.state();
    }
    this.compareScore(st);
    this.attempt++;
    this.server = st.server;
    this.struck = false;
    this.oracleCall = null;
    this.recent.length = 0;
    this.side = st.halves[st.serverTeam]!;
    this.feed({ k: 'serve', server: st.server, receiver: st.receiver, half: this.side, side: st.side });
  }

  private compareScore(st: ScoreState): void {
    const sc = this.sim.score;
    const s = this.sim;
    const diffs: string[] = [];
    if (st.over !== (sc.winner >= 0)) diffs.push(`over: oracle ${st.over}, game ${sc.winner >= 0}`);
    if (st.points[0] !== sc.points[0] || st.points[1] !== sc.points[1]) diffs.push(`points ${st.points.join('-')} vs game ${sc.points.join('-')}`);
    if (st.games[0] !== sc.games[0] || st.games[1] !== sc.games[1]) diffs.push(`games ${st.games.join('-')} vs game ${sc.games.join('-')}`);
    if (st.sets[0] !== sc.sets[0] || st.sets[1] !== sc.sets[1]) diffs.push(`sets ${st.sets.join('-')} vs game ${sc.sets.join('-')}`);
    if (st.tiebreak !== sc.tiebreak) diffs.push(`tiebreak ${st.tiebreak} vs game ${sc.tiebreak}`);
    if (!st.over) {
      if (st.server !== sc.serverPlayer()) diffs.push(`server ${st.server} vs game ${sc.serverPlayer()}`);
      if (st.receiver !== sc.receiverPlayer()) diffs.push(`receiver ${st.receiver} vs game ${sc.receiverPlayer()}`);
      const side = sc.serveSide() === SIDE_RIGHT ? 'right' : 'left';
      if (st.side !== side) diffs.push(`box ${st.side} vs game ${side}`);
      if (st.deciding !== sc.isDecidingPoint()) diffs.push(`deciding ${st.deciding} vs game ${sc.isDecidingPoint()}`);
    }
    for (let t = 0; t < 2; t++) if (st.halves[t] !== s.side(t)) diffs.push(`team ${t} half ${st.halves[t]} vs game ${s.side(t)}`);
    if (diffs.length) {
      const where = `${sc.history.map((h) => h.join('-')).join(' ')} | ${sc.games.join('-')} | ${sc.points.join('-')}${sc.tiebreak ? ' TB' : ''}`;
      this.note({ kind: 'score-mismatch', sig: diffs.map((d) => d.split(' ')[0]).join(','), detail: `${diffs.join('; ')} (game score ${where})`, tick: s.tick, time: s.time });
    }
  }

  beforeStep(): void {
    this.phaseBefore = this.sim.phase;
  }

  afterStep(): void {
    const s = this.sim;
    const b = s.ball;
    const startSide = this.ballSide;
    // Events of this tick in order, a crossing inserted before the first contact on the new side.
    let crossed = b.netSide !== startSide && !b.outside;
    let crossFed = false;
    const feedCross = (): void => {
      if (crossed && !crossFed) { this.feed({ k: 'cross', to: b.netSide > 0 ? 1 : -1 }); crossFed = true; }
    };
    let result: Call | null = null;
    for (let q = Math.max(this.lastSeq + 1, s.eventSeq - EVENT_RING); q < s.eventSeq; q++) {
      const e = s.events[q % EVENT_RING]!;
      if (e.seq !== q) continue;
      if (crossed && !crossFed && (e.kind === E_FLOOR || e.kind === E_WALL || e.kind === E_HIT || e.kind === E_EXIT) && Math.sign(e.z) === b.netSide) feedCross();
      switch (e.kind) {
        case E_TOSS: this.feed({ k: 'toss', player: e.player }); break;
        case E_HIT: {
          const serve = e.a === SHOT_SERVE;
          if (serve) this.struck = true;
          const p = s.players[e.player]!;
          const st = this.score.state();
          const half = st.halves[p.team]!;
          this.feed({ k: 'strike', player: e.player, serve, half, x: e.x, y: e.y, z: e.z, waist: p.tune.waistHeight, outside: false, feetOk: serve ? this.feetOk(e.player, half, st.side) : true });
          break;
        }
        case E_WHIFF: {
          const serve = this.phaseBefore === PH_TOSS && e.player === this.server && !this.struck;
          this.feed({ k: 'whiff', player: e.player, serve });
          break;
        }
        case E_FLOOR: {
          // A bounce under a pocket of netting pushed past the line is on the hitter's side of the net.
          let z = e.z;
          if (Math.sign(z) !== b.netSide && Math.abs(z) < 0.5 && !crossed) z = b.netSide * 0.001;
          this.feed({ k: 'floor', x: e.x, z });
          break;
        }
        case E_WALL: this.feed({ k: 'wall', surface: e.a === SURF_MESH ? 'mesh' : 'glass', wall: wallName(e.b), x: e.x, y: e.y, z: e.z }); break;
        case E_NET: this.feed({ k: 'net', part: e.a === 1 ? 'tape' : e.a === 2 ? 'post' : 'net', x: e.x, y: e.y, z: e.z }); break;
        case E_EXIT: this.feed({ k: 'exit', door: e.a === 1, wall: wallName(e.b), x: e.x, y: e.y, z: e.z }); break;
        case E_BODY: this.feed({ k: 'body', player: e.player }); break;
        case E_POINT: result = { result: 'point', winner: e.team, rule: REASON_TEXT[e.a] ?? String(e.a) }; break;
        case E_FAULT:
          result = e.b === 2 ? { result: 'point', winner: 1 - e.team, rule: `double fault (${REASON_TEXT[e.a]})` } : { result: 'fault', winner: -1, rule: REASON_TEXT[e.a] ?? '' };
          break;
        case E_LET: result = { result: 'let', winner: -1, rule: REASON_TEXT[e.a] ?? '' }; break;
      }
      if (this.trace !== undefined && Math.abs(s.tick - this.trace) < 600) console.log(`  [${s.tick}] event ${e.kind} p${e.player} t${e.team} a${e.a} b${e.b} (${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)})`);
    }
    this.lastSeq = s.eventSeq - 1;
    if (!result) feedCross();
    this.ballSide = b.netSide;

    if (result) this.decided(result);
    else if (this.oracleCall && s.time - this.oracleCallAt > 0.25 && (s.phase === PH_RALLY || s.phase === PH_TOSS)) {
      const o = this.oracleCall;
      this.flag('ref-oracle-only', `${o.result}${o.result === 'point' ? ' ' + o.rule : ''}`, `oracle called ${o.result}${o.result === 'point' ? ` to team ${o.winner}` : ''} (${o.rule}) ${(s.time - this.oracleCallAt).toFixed(2)} s ago; the game plays on`);
      this.oracleCall = { ...o, result: o.result, rule: o.rule + ' (reported)' };
      this.oracleCallAt = 1e18;
    }
    // A new serve attempt starts whenever the game puts the ball back in the server's hand.
    if (s.phase === PH_SETUP && this.phaseBefore !== PH_SETUP && s.score.winner < 0) this.startAttempt();
  }

  private ballSide = 1;

  private decided(game: Call): void {
    if (game.result === 'point') this.points++;
    else if (game.result === 'fault') this.faults++;
    else this.lets++;
    const o = this.oracleCall;
    if (!o) {
      this.flag('ref-game-only', `${game.result} ${game.rule}`, `game called ${game.result}${game.result === 'point' ? ` to team ${game.winner}` : ''} (${game.rule}); the oracle had not decided`);
    } else if (o.result !== game.result || (o.result === 'point' && o.winner !== game.winner)) {
      this.flag('ref-mismatch', `game ${game.result}:${game.rule} / oracle ${o.result}:${o.rule}`,
        `game: ${game.result}${game.result === 'point' ? ` to team ${game.winner}` : ''} (${game.rule}); oracle: ${o.result}${o.result === 'point' ? ` to team ${o.winner}` : ''} (${o.rule})`);
    }
    // The score follows the game's call, so one disagreement doesn't shift every later comparison.
    if (game.result === 'point') this.score.pointWon(game.winner);
    // Keep the referee's serve count in step with the game's (its own count is checked by the call above).
    this.syncServe(game);
  }

  /** After a disagreement the referee oracle may expect another serve number than the game: follow the game. */
  private syncServe(game: Call): void {
    const o = this.oracleCall;
    if (!o || o.result === game.result) return;
    this.ref.resync(game.result === 'fault' ? 2 : game.result === 'let' ? this.ref.serveNo : 1);
  }

  /** 6.1-6.3, from the body's centre (the sim has no feet): behind the service line, on the serving side of the centre line. */
  private feetOk(player: number, half: Half, side: 'right' | 'left'): boolean {
    const p = this.sim.players[player]!;
    const c = this.sim.world.court;
    const behind = p.pos.z * half >= c.def.serviceLineFromNet + c.def.lineWidth / 2;
    // A server facing the net from the z > 0 half has +x on their right.
    const sign = (side === 'right' ? 1 : -1) * half;
    return behind && p.pos.x * sign >= 0 && Math.abs(p.pos.x) <= c.halfW;
  }

  finish(): void {
    const s = this.sim;
    const st = this.score.state();
    if (!st.over || st.winner !== s.score.winner) {
      this.note({ kind: 'score-mismatch', sig: 'match-end', detail: `match over: oracle ${st.over} winner ${st.winner}, game winner ${s.score.winner}; sets ${st.sets.join('-')} vs ${s.score.sets.join('-')}`, tick: s.tick, time: s.time });
    }
  }
}
