// Rollback netcode. One client steps on what it knows and guesses the rest (a remote seat goes on doing what it was last seen
// doing, with no new presses); a packet that shows a guess was wrong takes the sim back to a snapshot and replays the true inputs
// up to now. Nothing here knows about sockets: docs/net-proof.md measured this class over a fake link and in two windows.
import { MatchSim, type MatchConfig } from '../sim/match.ts';
import { InputFrame } from '../sim/input.ts';
import { DT } from '../sim/core/constants.ts';

/** One seat's hands for one tick. Exactly what crosses the wire: a value that doesn't survive packet.ts must not reach the sim. */
export interface Frame { x: number; y: number; held: number; ev: Array<[boolean, number, number]>; aim: boolean; tx: number; tz: number }
export interface Packet { seat: number; first: number; frames: Frame[]; ack: number }

export const EMPTY: Frame = { x: 0, y: 0, held: 0, ev: [], aim: false, tx: 0, tz: 0 };
/** A press's moment inside its tick travels as a whole number of these a second, so both ends hold the same bits. */
export const TIME_GRID = 2 ** 20;
export const evTime = (tick: number, off: number): number => tick * DT + off;
// (+ 0: a tiny negative stick rounds to -0, the wire carries 0, and the sim hashes the bits)
const axis = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127 + 0;
/** A tick's hands, rounded to what the wire carries, so the sender's sim steps on the same bits as everyone else's. */
export const takeFrame = (f: InputFrame, tick: number, shift: number): Frame => ({
  x: axis(f.moveX), y: axis(f.moveY), held: f.held, aim: f.aimAbs, tx: Math.fround(f.aimTX), tz: Math.fround(f.aimTZ),
  ev: Array.from({ length: f.evCount }, (_, i) => [f.ev[i]!.press, f.ev[i]!.button, evTime(tick, Math.round((f.ev[i]!.t + shift - tick * DT) * TIME_GRID) / TIME_GRID)] as [boolean, number, number]),
});
function putFrame(f: InputFrame, r: Frame): InputFrame {
  f.clear();
  f.moveX = r.x;
  f.moveY = r.y;
  f.aimAbs = r.aim;
  f.aimTX = r.tx;
  f.aimTZ = r.tz;
  for (const e of r.ev) f.push(e[0], e[1], e[2]);
  f.held = r.held;
  return f;
}
const same = (a: Frame, b: Frame): boolean => a.x === b.x && a.y === b.y && a.held === b.held && a.ev.length === 0 && b.ev.length === 0
  && a.aim === b.aim && a.tx === b.tx && a.tz === b.tz;

export interface RollbackOptions {
  /** Ticks a local input waits before it acts: time for the packet to arrive first. */
  delay: number;
  /** The most ticks it will go back; a snapshot is kept every `snapEvery` over that span. */
  maxBack: number;
  snapEvery: number;
  /** How many past frames each packet repeats, so a lost one is carried by the next. */
  redundancy: number;
}
export const DEFAULTS: RollbackOptions = { delay: 6, maxBack: 48, snapEvery: 4, redundancy: 32 };

export class RollbackClient {
  readonly sim: MatchSim;
  readonly n: number;
  readonly o: RollbackOptions;
  /** The inputs known for certain, by seat and tick. */
  private readonly known: Array<Map<number, Frame>>;
  /** The inputs the sim stepped on, by seat and tick (guesses included). */
  private readonly used: Array<Map<number, Frame>>;
  /** Every seat's newest tick known for certain. */
  readonly lastKnown: number[];
  private readonly ring: MatchSim[];
  private readonly ringTick: number[];
  private readonly frames: InputFrame[];
  private readonly inputs: Array<InputFrame | null>;
  /** The tick the AI took each seat over. */
  private readonly goneAt: number[];
  /** The state's hash at each tick that's a multiple of 60, replays overwriting it. */
  readonly hashes = new Map<number, number>();
  rollbacks = 0;
  resimTicks = 0;
  stalls = 0;
  readonly depths: number[] = [];
  readonly replayMs: number[] = [];
  /** Called around a rewind: before, then after, with the depth. */
  onBefore: (() => void) | null = null;
  onAfter: ((depth: number) => void) | null = null;
  /** Called with the sim back at the snapshot, before the replay. */
  onRestore: (() => void) | null = null;

  readonly seats: number[];

  constructor(cfg: MatchConfig, seats: number[], opts: Partial<RollbackOptions> = {}, sim?: MatchSim) {
    this.seats = seats;
    this.o = { ...DEFAULTS, ...opts };
    this.sim = sim ?? new MatchSim(cfg);
    this.n = cfg.human.length;
    this.known = Array.from({ length: this.n }, () => new Map());
    this.used = Array.from({ length: this.n }, () => new Map());
    this.lastKnown = new Array(this.n).fill(-1);
    this.goneAt = new Array(this.n).fill(Infinity);
    const count = Math.ceil(this.o.maxBack / this.o.snapEvery) + 2;
    this.ring = Array.from({ length: count }, () => new MatchSim(cfg));
    this.ringTick = new Array(count).fill(-1);
    this.frames = Array.from({ length: this.n }, () => new InputFrame());
    this.inputs = cfg.human.map(() => null);
    for (const s of seats) for (let t = 0; t < this.o.delay; t++) this.known[s]!.set(t, EMPTY);
    for (const s of seats) this.lastKnown[s] = this.o.delay - 1;
  }

  /** This tick's hands. They act `delay` ticks from now, so a press's exact moment moves with them. */
  local(seat: number, f: InputFrame): void {
    const t = this.sim.tick + this.o.delay;
    this.known[seat]!.set(t, takeFrame(f, t, this.o.delay * DT));
    this.lastKnown[seat] = t;
  }

  /** A seat's hands from `from` (default: the last `redundancy` ticks) up to the newest. */
  packet(seat: number, from = -1): Packet {
    const t = this.lastKnown[seat]!, first = Math.max(0, from >= 0 ? from : t - this.o.redundancy + 1), frames: Frame[] = [];
    for (let k = first; k <= t; k++) frames.push(this.known[seat]!.get(k) ?? EMPTY);
    return { seat, first, frames, ack: t };
  }

  private inputFor(seat: number, tick: number): Frame {
    const k = this.known[seat]!.get(tick);
    if (k) return k;
    const l = this.known[seat]!.get(Math.min(tick, this.lastKnown[seat]!));
    return l ? { x: l.x, y: l.y, held: l.held, ev: [], aim: l.aim, tx: l.tx, tz: l.tz } : EMPTY;
  }

  private stepOne(): void {
    const t = this.sim.tick;
    if (t % this.o.snapEvery === 0) {
      const i = (t / this.o.snapEvery) % this.ring.length;
      this.ring[i]!.copyFrom(this.sim);
      this.ringTick[i] = t;
    }
    for (let s = 0; s < this.n; s++) {
      if (t === this.goneAt[s]) this.sim.giveToAi(s);
      if (!this.humanSeat(s) || t >= this.goneAt[s]!) { this.inputs[s] = null; continue; }
      const fr = this.inputFor(s, t);
      this.used[s]!.set(t, fr);
      this.inputs[s] = putFrame(this.frames[s]!, fr);
    }
    this.sim.step(this.inputs);
    if (this.sim.tick % 60 === 0) this.hashes.set(this.sim.tick, this.sim.hash());
    // (a spent frame can go: nothing rolls back past maxBack)
    const old = t - this.o.maxBack - 4;
    if (old >= 0) {
      for (let s = 0; s < this.n; s++) {
        this.used[s]!.delete(old);
        // (a packet covers what the far end hasn't acknowledged, and when only one way of a link goes dead that end stops
        // maxBack past what it has of ours while we run on maxBack past its last: so two lengths, or it gets blanks and splits)
        this.known[s]!.delete(old - this.o.maxBack - this.o.redundancy);
      }
    }
  }

  private humanSeat(s: number): boolean { return this.sim.cfg.human[s] === true; }
  /** A seat whose hands we still wait for. */
  private waitsOn(s: number): boolean { return this.humanSeat(s) && this.goneAt[s] === Infinity; }

  /**
   * A player has gone, and it has been agreed that the AI plays their seat from tick `at`. `tail`: their last hands from
   * `first`, for whoever heard fewer; anyone who heard more forgets it. False: it's further back than a rewind can reach.
   */
  dropSeat(seat: number, at: number, first: number, tail: Frame[]): boolean {
    const kn = this.known[seat]!, u = this.used[seat]!;
    for (let i = 0; i < tail.length; i++) if (!kn.has(first + i) && first + i < at) kn.set(first + i, tail[i]!);
    for (const k of [...kn.keys()]) if (k >= at) kn.delete(k);
    this.lastKnown[seat] = at - 1;
    this.goneAt[seat] = at;
    let wrong = at;
    for (const [k, was] of u) if (k < wrong && !same(was, this.inputFor(seat, k))) wrong = k;
    if (wrong >= this.sim.tick) return true;
    if (!this.canRewind(wrong)) return false;
    this.rewindTo(wrong);
    return true;
  }

  /** There's a snapshot to go back to. */
  private canRewind(tick: number): boolean {
    for (let i = 0; i < this.ring.length; i++) if (this.ringTick[i]! <= tick && this.ringTick[i]! >= 0) return true;
    return false;
  }

  /** This packet can be taken: anything in it that changes what was played is within a rewind's reach. */
  reaches(p: Packet): boolean {
    const u = this.used[p.seat]!, kn = this.known[p.seat]!;
    for (let i = 0; i < p.frames.length; i++) {
      const k = p.first + i, was = u.get(k);
      if (k < this.sim.tick && was && !kn.has(k) && !same(was, p.frames[i]!)) return this.canRewind(k);
    }
    return true;
  }

  /** Every seat's hands are known up to and including this tick: nothing before it can change any more. */
  get confirmed(): number {
    let low = Infinity;
    for (let s = 0; s < this.n; s++) if (this.waitsOn(s)) low = Math.min(low, this.lastKnown[s]!);
    return low;
  }

  /** How far ahead of the slowest seat's known inputs this client is, in ticks. */
  get ahead(): number {
    let low = Infinity;
    for (let s = 0; s < this.n; s++) if (this.waitsOn(s)) low = Math.min(low, this.lastKnown[s]!);
    return this.sim.tick - low;
  }

  /** One tick forward, unless the link has fallen further behind than a rewind can reach: then it waits. */
  advance(): boolean {
    if (this.ahead >= this.o.maxBack) { this.stalls++; return false; }
    this.stepOne();
    return true;
  }

  /** A peer's packet: learn what's new, and rewind if a guess it answers was wrong. */
  receive(p: Packet): void {
    if (this.goneAt[p.seat] !== Infinity) return;
    let wrong = Infinity;
    const u = this.used[p.seat]!, kn = this.known[p.seat]!;
    for (let i = 0; i < p.frames.length; i++) {
      const k = p.first + i, fr = p.frames[i]!;
      if (kn.has(k)) continue;
      kn.set(k, fr);
      if (k > this.lastKnown[p.seat]!) this.lastKnown[p.seat] = k;
      const was = u.get(k);
      if (k < this.sim.tick && was && !same(was, fr) && k < wrong) wrong = k;
    }
    if (wrong === Infinity) return;
    this.rewindTo(wrong);
  }

  private rewindTo(tick: number): void {
    let best = -1;
    for (let i = 0; i < this.ring.length; i++) if (this.ringTick[i]! <= tick && this.ringTick[i]! >= 0 && (best < 0 || this.ringTick[i]! > this.ringTick[best]!)) best = i;
    if (best < 0) throw new Error(`no snapshot at or before tick ${tick} (now ${this.sim.tick})`);
    const now = this.sim.tick, t0 = performance.now();
    this.onBefore?.();
    this.sim.copyFrom(this.ring[best]!);
    this.onRestore?.();
    while (this.sim.tick < now) this.stepOne();
    this.rollbacks++;
    this.depths.push(now - this.ringTick[best]!);
    this.resimTicks += now - this.ringTick[best]!;
    this.replayMs.push(performance.now() - t0);
    this.onAfter?.(now - tick);
  }
}
