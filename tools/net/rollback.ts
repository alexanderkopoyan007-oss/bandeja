// Rollback netcode, the feasibility version. One client: it steps on what it knows and guesses the rest (a remote seat
// goes on doing what it was last seen doing, with no new presses); a packet that shows a guess was wrong takes the sim
// back to a snapshot and replays the true inputs up to now. Nothing here knows about sockets: `outbox`/`receive` carry
// plain objects, so a fake link in Node and BroadcastChannel in the browser drive the same code.
import { MatchSim, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';

export interface Frame { x: number; y: number; held: number; ev: Array<[boolean, number, number]> }
export interface Packet { from: number; seat: number; first: number; frames: Frame[]; ack: number }

export const EMPTY: Frame = { x: 0, y: 0, held: 0, ev: [] };
export const takeFrame = (f: InputFrame): Frame => ({ x: f.moveX, y: f.moveY, held: f.held, ev: Array.from({ length: f.evCount }, (_, i) => [f.ev[i]!.press, f.ev[i]!.button, f.ev[i]!.t] as [boolean, number, number]) });
function putFrame(f: InputFrame, r: Frame): InputFrame {
  f.clear();
  f.moveX = r.x;
  f.moveY = r.y;
  for (const e of r.ev) f.push(e[0], e[1], e[2]);
  f.held = r.held;
  return f;
}
const same = (a: Frame, b: Frame): boolean => a.x === b.x && a.y === b.y && a.held === b.held && a.ev.length === 0 && b.ev.length === 0;

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
    const count = Math.ceil(this.o.maxBack / this.o.snapEvery) + 2;
    this.ring = Array.from({ length: count }, () => new MatchSim(cfg));
    this.ringTick = new Array(count).fill(-1);
    this.frames = Array.from({ length: this.n }, () => new InputFrame());
    this.inputs = cfg.human.map(() => null);
    for (const s of seats) for (let t = 0; t < this.o.delay; t++) this.known[s]!.set(t, EMPTY);
    for (const s of seats) this.lastKnown[s] = this.o.delay - 1;
  }

  /** This tick's hands. They act `delay` ticks from now, so a press's exact moment moves with them. */
  local(seat: number, f: InputFrame): Packet {
    const t = this.sim.tick + this.o.delay;
    const fr = takeFrame(f);
    for (const e of fr.ev) e[2] += this.o.delay * DT;
    this.known[seat]!.set(t, fr);
    this.lastKnown[seat] = t;
    const first = Math.max(0, t - this.o.redundancy + 1), frames: Frame[] = [];
    for (let k = first; k <= t; k++) frames.push(this.known[seat]!.get(k) ?? EMPTY);
    return { from: seat, seat, first, frames, ack: t };
  }

  private inputFor(seat: number, tick: number): Frame {
    const k = this.known[seat]!.get(tick);
    if (k) return k;
    const l = this.known[seat]!.get(Math.min(tick, this.lastKnown[seat]!));
    return l ? { x: l.x, y: l.y, held: l.held, ev: [] } : EMPTY;
  }

  private stepOne(): void {
    const t = this.sim.tick;
    if (t % this.o.snapEvery === 0) {
      const i = (t / this.o.snapEvery) % this.ring.length;
      this.ring[i]!.copyFrom(this.sim);
      this.ringTick[i] = t;
    }
    for (let s = 0; s < this.n; s++) {
      if (!this.humanSeat(s)) { this.inputs[s] = null; continue; }
      const fr = this.inputFor(s, t);
      this.used[s]!.set(t, fr);
      this.inputs[s] = putFrame(this.frames[s]!, fr);
    }
    this.sim.step(this.inputs);
    if (this.sim.tick % 60 === 0) this.hashes.set(this.sim.tick, this.sim.hash());
    // (a spent frame can go: nothing rolls back past maxBack)
    const old = t - this.o.maxBack - 4;
    if (old >= 0) for (let s = 0; s < this.n; s++) this.used[s]!.delete(old);
  }

  private humanSeat(s: number): boolean { return this.sim.cfg.human[s] === true; }

  /** How far ahead of the slowest seat's known inputs this client is, in ticks. */
  get ahead(): number {
    let low = Infinity;
    for (let s = 0; s < this.n; s++) if (this.humanSeat(s)) low = Math.min(low, this.lastKnown[s]!);
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
