// The match's highlights (M7 phase B, the brief's "a match highlight reel"): the best few points of the match, kept as
// they were played and watched again from the results. As with an instant replay (replay.ts) nothing is filmed: a kept
// point is a copy of the match taken as the point was set up (MatchSim.copyFrom) and the humans' inputs since, kept in
// the challenges' compact form once the point is over (inputLog.ts). Each point is scored for how much of a highlight
// it is (the rally's length, a ball out of the court, a hard overhead, the set or the match on it) and the best
// HL_MAX are kept, shown in the order they were played. The reel re-runs each from its copy with the kept inputs.
import { MatchSim, PH_SETUP, PH_DEAD, PH_OVER, E_HIT, E_POINT, E_EXIT, E_SET, E_MATCH, type MatchConfig } from '../sim/match.ts';
import { SHOT_SMASH, SHOT_VIBORA, SHOT_BANDEJA, SHOT_SERVE } from '../sim/contact/shots.ts';
import { InputFrame } from '../sim/input.ts';
import { DT } from '../sim/core/constants.ts';
import { InputLog, LogPlayer, type SavedLog } from './inputLog.ts';

/** Points kept. */
export const HL_MAX = 8;
/** A point longer than this (ticks, from its setup) is not kept (as replays: 90 s). */
const MAX_TICKS = 120 * 90;
/** A clip starts LEAD s before the serve is struck (the toss and the bounce in the hand) and ends AFTER s after the
 * point. */
const LEAD = 1.2;
const AFTER = 1.4;
/** The winning shot is slowed to SLOW, from SLOW_BEFORE s before it to SLOW_AFTER s after, eased over RAMP s: lighter
 * than the instant replay's second take, as a reel keeps moving. */
const SLOW = 0.5;
const SLOW_BEFORE = 0.25;
const SLOW_AFTER = 0.6;
const RAMP = 0.15;
/** An overhead winner this fast (m/s off the racket) or more counts as a hard one (replay.ts BIG_SPEED). */
const HARD = 21;
/** Ticks re-run per frame to reach a clip's start (as replays: 4.5 ms a frame). */
const PREP_PER_FRAME = 300;

/** What a point is worth as a highlight: a shot a stroke, and a bonus for each thing that makes one. */
export const HL_WEIGHTS = { shot: 1, exit: 10, hardOverhead: 6, setPoint: 6, matchPoint: 25 } as const;

export function highlightScore(p: { shots: number; exited: boolean; hardOverhead: boolean; set: boolean; match: boolean }): number {
  const w = HL_WEIGHTS;
  return p.shots * w.shot + (p.exited ? w.exit : 0) + (p.hardOverhead ? w.hardOverhead : 0) + (p.set ? w.setPoint : 0) + (p.match ? w.matchPoint : 0);
}

export interface Clip {
  /** The point's number in the match (from 1), for the order played. */
  n: number;
  score: number;
  /** The match as the point was set up. */
  readonly sim: MatchSim;
  /** Each human's inputs from then (by Highlights' `humans`). */
  logs: SavedLog[];
  /** Sim times: the clip's start and end, and the winning shot (and who hit it). */
  start: number;
  end: number;
  strikeT: number;
  hitter: number;
  /** The score before the point (team 0 first) and what made it, for the caption. */
  label: string;
  why: string;
}

/** Keeps the match's best points as it is played (beforeStep/afterStep around every live tick, as Replays). */
export class Highlights {
  /** Off online, in drills and challenges (game.ts). */
  enabled = true;
  /** The points kept, in the order played. */
  readonly clips: Clip[] = [];
  private readonly cfg: MatchConfig;
  private readonly humans: number[];
  private readonly logs: InputLog[];
  private readonly snap: MatchSim;
  /** Sims of clips dropped for better ones, reused. */
  private readonly spare: MatchSim[] = [];
  private recording = false;
  private pointOver = false;
  private snapTime = 0;
  private label = '';
  private points = 0;
  private seen = 0;
  // The point being played.
  private serveT = -1;
  private shots = 0;
  private exited = false;
  private hitPlayer = -1;
  private hitShot = -1;
  private hitSpeed = 0;
  private hitTime = 0;
  // A point played and waiting to be kept or not (once its AFTER s are recorded).
  private pending = false;
  private pScore = 0;
  private pEnd = 0;
  private pStrike = 0;
  private pHitter = -1;
  private pWhy = '';
  private pBase = '';
  /** The last shot won the point (its hitter's side won it). */
  private pWon = false;
  private pSet = false;
  private pMatch = false;

  constructor(cfg: MatchConfig, humans: readonly number[]) {
    this.cfg = cfg;
    this.humans = [...humans];
    this.snap = new MatchSim(cfg);
    this.logs = this.humans.map(() => new InputLog(MAX_TICKS));
  }

  /** Before each live tick, with every player's frame for it, by player number. */
  beforeStep(live: MatchSim, inputs: ReadonlyArray<InputFrame | null>): void {
    if (!this.enabled) return;
    if (this.pending && live.time >= this.pEnd) this.finish();
    if (live.phase === PH_DEAD || live.phase === PH_OVER) this.pointOver = true;
    if (live.phase === PH_SETUP && live.walking === 0 && (!this.recording || this.pointOver)) {
      if (this.pending) this.finish();
      this.snap.copyFrom(live);
      this.snapTime = live.time;
      this.label = scoreLabel(live);
      this.recording = true;
      this.pointOver = false;
      this.serveT = -1;
      this.shots = 0;
      this.exited = false;
      this.hitPlayer = -1;
      for (const l of this.logs) l.reset();
    }
    if (!this.recording) return;
    for (let h = 0; h < this.humans.length; h++) this.logs[h]!.record(inputs[this.humans[h]!] ?? null);
  }

  /** After each live tick: its events (the point's shots, how it ended). */
  afterStep(live: MatchSim): void {
    while (this.seen < live.eventSeq) {
      const e = live.events[this.seen % live.events.length]!;
      this.seen++;
      if (!this.enabled || e.seq !== this.seen - 1) continue;
      if (e.kind === E_HIT) {
        if (e.a === SHOT_SERVE && this.serveT < 0) this.serveT = e.time;
        this.shots++;
        this.hitPlayer = e.player;
        this.hitShot = e.a;
        this.hitSpeed = e.c;
        this.hitTime = e.time;
      } else if (e.kind === E_EXIT) this.exited = true;
      else if (e.kind === E_POINT) this.pointPlayed(e.team, e.time);
      else if (e.kind === E_SET && this.pending) this.rescore(true, this.pMatch);
      else if (e.kind === E_MATCH && this.pending) this.rescore(this.pSet, true);
    }
  }

  private pointPlayed(winner: number, t: number): void {
    this.points++;
    if (!this.recording || this.logs.some((l) => l.full) || this.hitPlayer < 0) return;
    const won = (this.hitPlayer & 1) === winner;
    this.pWon = won;
    const overhead = this.hitShot === SHOT_SMASH || this.hitShot === SHOT_VIBORA || this.hitShot === SHOT_BANDEJA;
    this.pending = true;
    this.pEnd = t + AFTER;
    this.pStrike = this.hitTime;
    this.pHitter = this.hitPlayer;
    this.pSet = false;
    this.pMatch = false;
    this.pBase = won && this.exited ? 'Out of the court' : won && overhead && this.hitSpeed >= HARD ? `${Math.round(this.hitSpeed * 3.6)} km/h overhead`
      : this.shots >= 10 ? `${this.shots}-shot rally` : `${this.shots} shots`;
    this.rescore(false, false);
  }

  private rescore(set: boolean, match: boolean): void {
    this.pSet = set;
    this.pMatch = match;
    const overhead = this.hitShot === SHOT_SMASH || this.hitShot === SHOT_VIBORA || this.hitShot === SHOT_BANDEJA;
    // (a ball out of the court, or a hard overhead, counts when it won the point: a smash netted is no highlight)
    this.pScore = highlightScore({ shots: this.shots, exited: this.pWon && this.exited, hardOverhead: this.pWon && overhead && this.hitSpeed >= HARD, set, match });
    this.pWhy = match ? `Match point · ${this.pBase}` : set ? `Set point · ${this.pBase}` : this.pBase;
  }

  /** The match is over (game.ts, before the results): a point still waiting is kept or not now, cut at what was
   * recorded of it. */
  flush(live: MatchSim): void {
    if (!this.pending) return;
    this.pEnd = Math.min(this.pEnd, live.time);
    this.finish();
  }

  /** The point waiting is kept if it is among the best (once, as the next is set up or its AFTER s have passed). */
  private finish(): void {
    this.pending = false;
    const worst = this.clips.reduce((w, c, i) => (w < 0 || c.score < this.clips[w]!.score ? i : w), -1);
    if (this.clips.length >= HL_MAX && this.pScore <= this.clips[worst]!.score) return;
    let sim: MatchSim;
    if (this.clips.length >= HL_MAX) sim = this.clips.splice(worst, 1)[0]!.sim;
    else sim = this.spare.pop() ?? new MatchSim(this.cfg);
    sim.copyFrom(this.snap);
    const start = this.serveT >= 0 ? Math.max(this.snapTime + DT, this.serveT - LEAD) : this.snapTime + DT;
    // (no further than the inputs recorded: past them a human would stand still)
    const recorded = this.logs.length ? this.snapTime + this.logs[0]!.ticks * DT : this.pEnd;
    this.pEnd = Math.min(this.pEnd, recorded);
    this.clips.push({
      n: this.points, score: this.pScore, sim, logs: this.logs.map((l) => l.save()), start, end: this.pEnd,
      strikeT: this.pStrike, hitter: this.pHitter, label: this.label, why: this.pWhy,
    });
    this.clips.sort((a, b) => a.n - b.n);
  }
}

/** The score before a point, team 0 first: "Set 2 · 4-3 · 30-15". */
function scoreLabel(m: MatchSim): string {
  const s = m.score, pts = s.display();
  const points = pts[1] === '' ? pts[0] : pts[0] === '' ? pts[1] : `${pts[0]}-${pts[1]}`;
  return `Set ${s.history.length + 1} · ${s.games[0]}-${s.games[1]} · ${points}`;
}

export const RL_IDLE = 0;
export const RL_PREP = 1;
export const RL_SHOW = 2;

/** The reel: each kept point re-run from its copy with its kept inputs, one after another. */
export class Reel {
  state: number = RL_IDLE;
  readonly sim: MatchSim;
  /** The clip showing (its place in the reel), the moment drawn (sim time) and how fast it runs. */
  index = -1;
  clock = 0;
  speed = 1;
  /** Counts the cuts to a new clip (game.ts cuts the camera, the people and the sound when it changes). */
  cuts = 0;
  private clips: readonly Clip[] = [];
  private readonly humans: number[];
  private players: LogPlayer[] = [];
  private readonly inputs: Array<InputFrame | null>;

  constructor(cfg: MatchConfig, humans: readonly number[]) {
    this.sim = new MatchSim(cfg);
    this.humans = [...humans];
    this.inputs = new Array<InputFrame | null>(this.sim.players.length).fill(null);
  }

  get clip(): Clip | null {
    return this.clips[this.index] ?? null;
  }

  get count(): number {
    return this.clips.length;
  }

  /** From the first clip. False with none to show. */
  start(clips: readonly Clip[]): boolean {
    this.clips = clips;
    this.index = -1;
    return this.next();
  }

  /** On to the next clip (a skip), or the end: false once there is none. */
  next(): boolean {
    this.index++;
    const c = this.clip;
    if (!c) { this.stop(); return false; }
    this.sim.copyFrom(c.sim);
    this.players = c.logs.map((l) => new LogPlayer(l));
    this.state = RL_PREP;
    return true;
  }

  /** While preparing: re-run towards the clip's start, a frame's share at a time. True once it is there. */
  prepare(): boolean {
    const c = this.clip!;
    for (let k = 0; k < PREP_PER_FRAME && this.sim.time < c.start - DT; k++) this.stepOne();
    if (this.sim.time < c.start - DT) return false;
    this.state = RL_SHOW;
    this.clock = this.sim.time;
    this.speed = 1;
    this.cuts++;
    return true;
  }

  /** Showing: advance by a frame's `dt` of wall time. False once the reel is over. */
  advance(dt: number): boolean {
    const c = this.clip!;
    const u = this.clock - c.strikeT;
    const into = u < -SLOW_BEFORE ? -SLOW_BEFORE - u : u > SLOW_AFTER ? u - SLOW_AFTER : 0;
    this.speed = SLOW + (1 - SLOW) * Math.min(1, into / RAMP);
    this.clock += dt * this.speed;
    while (this.sim.time < this.clock) this.stepOne();
    if (this.clock < c.end) return true;
    return this.next();
  }

  /** The tick being drawn's blend (render alpha) for the clock. */
  get alpha(): number {
    return Math.max(0, Math.min(1, (this.clock - (this.sim.time - DT)) / DT));
  }

  stop(): void {
    this.state = RL_IDLE;
    this.index = -1;
    this.players = [];
  }

  private stepOne(): void {
    for (let h = 0; h < this.humans.length; h++) this.inputs[this.humans[h]!] = this.players[h]?.next() ?? null;
    this.sim.step(this.inputs);
  }
}
