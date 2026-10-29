// Instant replays (review round 3, critic High #4). After a big point the broadcast shows it again from another
// angle, the winning shot in slow motion, as padel on TV does. The sim is deterministic, so a replay is the point
// itself re-run: a copy of the match taken as the point was set up (MatchSim.copyFrom) stepped on with the human's
// inputs recorded since. Nothing is filmed or stored per frame.
import { MatchSim, PH_SETUP, PH_DEAD, PH_OVER, E_HIT, E_POINT, E_EXIT, type MatchConfig } from '../sim/match.ts';
import { SHOT_SMASH, SHOT_VIBORA, SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { InputFrame } from '../sim/input.ts';
import { DT } from '../sim/core/constants.ts';

/** The human's inputs kept: a point from its setup, up to this many ticks (longer points get no replay). */
const MAX_TICKS = 120 * 90;
/** The replay starts LEAD s before the winning shot (the shot before it) and ends AFTER s after the point. */
const LEAD = 1.9;
const AFTER = 0.7;
/** The live reaction is shown first: the replay comes DELAY s after the point. */
const DELAY = 0.8;
/** Slow motion from SLOW_BEFORE s before the winning shot to SLOW_AFTER s after it, at SLOW, eased over RAMP s. */
const SLOW = 0.35;
const SLOW_BEFORE = 0.3;
const SLOW_AFTER = 0.9;
const RAMP = 0.15;
/** Which points: a winner that left the court (por tres, por cuatro), an overhead winner at BIG_SPEED m/s or more,
 * or a winner at the end of a rally of BIG_RALLY shots; and at least GAP points since the last replay. */
const BIG_SPEED = 21;
const BIG_RALLY = 10;
const GAP = 2;
/** Ticks re-run per frame to reach the replay's start (15 us a tick: 4.5 ms a frame), over a few frames: no hitch. */
const PREP_PER_FRAME = 300;

export const RP_IDLE = 0;
export const RP_PREP = 1;
export const RP_SHOW = 2;

export class Replays {
  /** The Replays setting (and ?replays=0). */
  enabled = true;
  state: number = RP_IDLE;
  /** The match being replayed (what is drawn while state is RP_SHOW). */
  readonly sim: MatchSim;
  /** Its clock: the moment drawn (sim time), and how fast it runs now (1 = real time). */
  clock = 0;
  speed = 1;
  /** The player who hit the winning shot, its time, and the replay's angle (0 behind the hitter, 1 from the side). */
  hitter = -1;
  strikeT = 0;
  angle = 0;
  /** Replays shown (tools, tests). */
  shown = 0;
  /** The live match time at which the next replay begins (-1: none due). */
  due = -1;

  private readonly snap: MatchSim;
  private readonly frames: InputFrame[] = [];
  private readonly human: number;
  private readonly inputs: Array<InputFrame | null>;
  private snapTick = -1;
  private snapTime = 0;
  private recording = false;
  private pointOver = false;
  private n = 0;
  private seen = 0;
  private hitPlayer = -1;
  private hitShot = -1;
  private hitSpeed = 0;
  private hitTime = 0;
  private exited = false;
  private since = 99;
  private start = 0;
  private end = 0;

  /** `human`: the human's player, or -1 (autoplay). */
  constructor(cfg: MatchConfig, human: number) {
    this.sim = new MatchSim(cfg);
    this.snap = new MatchSim(cfg);
    this.human = human;
    this.inputs = new Array<InputFrame | null>(this.sim.players.length).fill(null);
    if (human >= 0) for (let i = 0; i < MAX_TICKS; i++) this.frames.push(new InputFrame());
  }

  /** Before each live tick, with the human's frame for it (null: none). */
  beforeStep(live: MatchSim, f: InputFrame | null): void {
    if (live.phase === PH_DEAD || live.phase === PH_OVER) this.pointOver = true;
    if (live.phase === PH_SETUP && live.walking === 0 && (!this.recording || this.pointOver) && this.due < 0 && this.state === RP_IDLE) {
      // The point is set up: the copy it will be replayed from.
      this.snap.copyFrom(live);
      this.snapTick = live.tick;
      this.snapTime = live.time;
      this.recording = true;
      this.pointOver = false;
      this.n = 0;
      this.exited = false;
      this.hitPlayer = -1;
    }
    // (on through the dead ball and the walk back: the replay ends AFTER s after the point, and the next point's
    // setup starts the next recording)
    if (!this.recording) return;
    if (this.human < 0) { this.n++; return; }
    if (this.n >= MAX_TICKS) { this.recording = false; this.n = -1; return; }
    const r = this.frames[this.n++]!;
    if (f) r.copyFrom(f);
    else { r.clear(); r.held = 0; }
  }

  /** After each live tick: watch its events for a point worth showing again. */
  afterStep(live: MatchSim): void {
    while (this.seen < live.eventSeq) {
      const e = live.events[this.seen % live.events.length]!;
      this.seen++;
      if (e.seq !== this.seen - 1) continue;
      if (e.kind === E_HIT) {
        this.hitPlayer = e.player;
        this.hitShot = e.a;
        this.hitSpeed = e.c;
        this.hitTime = e.time;
      } else if (e.kind === E_EXIT) this.exited = true;
      else if (e.kind === E_POINT) this.consider(e.team, e.time, live);
    }
  }

  private consider(winner: number, t: number, live: MatchSim): void {
    this.since++;
    if (!this.enabled || this.n < 0 || this.snapTick < 0 || this.hitPlayer < 0 || (this.hitPlayer & 1) !== winner) return;
    if (this.hitTime < this.snapTime + 0.3 || this.since <= GAP) return;
    const overhead = this.hitShot === SHOT_SMASH || this.hitShot === SHOT_VIBORA || this.hitShot === SHOT_BANDEJA;
    const big = this.exited || (overhead && this.hitSpeed >= BIG_SPEED) || live.rally.shots >= BIG_RALLY;
    if (!big) return;
    this.since = 0;
    this.hitter = this.hitPlayer;
    this.strikeT = this.hitTime;
    this.start = Math.max(this.snapTime + 0.2, this.hitTime - LEAD);
    this.end = t + AFTER;
    this.due = t + DELAY;
  }

  /** Start the replay that is due: re-run the point from its copy (over the next frames: prepare()). */
  begin(): void {
    this.due = -1;
    this.recording = false;
    this.sim.copyFrom(this.snap);
    this.state = RP_PREP;
    this.angle = this.shown % 2;
  }

  /** While preparing: re-run towards the replay's start, a frame's share at a time. True once it is there. */
  prepare(): boolean {
    for (let k = 0; k < PREP_PER_FRAME && this.sim.time < this.start - DT; k++) this.stepOne();
    if (this.sim.time < this.start - DT) return false;
    this.state = RP_SHOW;
    this.clock = this.sim.time;
    this.speed = 1;
    this.shown++;
    return true;
  }

  /** Showing: advance by a frame's `dt` of wall time (slowed round the winning shot). False once it is over. */
  advance(dt: number): boolean {
    const u = this.clock - this.strikeT;
    const into = u < -SLOW_BEFORE ? -SLOW_BEFORE - u : u > SLOW_AFTER ? u - SLOW_AFTER : 0;
    this.speed = SLOW + (1 - SLOW) * Math.min(1, into / RAMP);
    this.clock += dt * this.speed;
    while (this.sim.time < this.clock) this.stepOne();
    if (this.clock >= this.end) { this.stop(); return false; }
    return true;
  }

  /** The tick being drawn's blend (render alpha) for the clock. */
  get alpha(): number {
    return Math.max(0, Math.min(1, (this.clock - (this.sim.time - DT)) / DT));
  }

  stop(): void {
    this.state = RP_IDLE;
    this.due = -1;
  }

  private stepOne(): void {
    if (this.human >= 0) {
      const k = this.sim.tick - this.snapTick;
      this.inputs[this.human] = k >= 0 && k < this.n ? this.frames[k]! : null;
    }
    this.sim.step(this.inputs);
  }
}
