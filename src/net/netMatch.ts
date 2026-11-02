// One online match: the rollback client wrapped round the game's sim, with its packets, its clock and its event feed. The game
// calls frame() each frame and step() for each tick; everything else here reacts to the network.
import { PH_RALLY, type MatchSim } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import type { InputFrame } from '../sim/input.ts';
import { NetFeed } from './feed.ts';
import { MAX_FRAMES, P_INPUT, decodeInput, encodeInput, type InputPacket } from './packet.ts';
import { RollbackClient } from './rollback.ts';
import type { OnlineSession, OnlineStart, SeatHandover } from './session.ts';
import { now } from './links.ts';

/** Packets a second by a data channel, and through the room (each costs the free plan, and a socket can't drop one anyway). */
const SEND_MS = 1000 / 60;
const SEND_RELAY_MS = 1000 / 30;
/** Silence from a player that means they have gone (ms). */
const GONE_MS = 6000;
/** From noticing a player has gone to the AI taking their seat (ms). Meanwhile everyone passes on what they last heard of them,
 *  so that whoever decides the tick knows it all, and nobody has to rewind further than a rewind can reach. */
const PASS_ON_MS = 1000;
const PASS_EVERY_MS = 100;
/** Ticks of a gone player's hands passed round. */
const TAIL = 64;
/** How long a word on the screen stays (ms). */
const NOTE_MS = 5000;
/** How long another player's word about a seat waits for this client to see the same (ms). */
const TOLD_FOR_MS = 15000;
/** The most ticks a packet goes back. A far end this far behind has been cut off anyway. */
const SEND_BACK = MAX_FRAMES - 1;
/** Ticks past our clock a peer's frames can honestly be: its lead over us, its input delay, and some slack for the clocks. */
const AHEAD_MAX = 240;

/** Word from a stranger: only what these fields should hold. */
function sane(h: SeatHandover): boolean {
  if (typeof h !== 'object' || h === null || !Number.isInteger(h.seat) || !Number.isInteger(h.at) || !Number.isInteger(h.first) || !Array.isArray(h.tail)) return false;
  if (h.seat < 0 || h.first < 0 || h.at < 0 || h.tail.length > MAX_FRAMES) return false;
  return h.tail.every((f) => typeof f === 'object' && f !== null && Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isInteger(f.held)
    && typeof f.aim === 'boolean' && Number.isFinite(f.tx) && Number.isFinite(f.tz) && Array.isArray(f.ev)
    && f.ev.every((e) => Array.isArray(e) && typeof e[0] === 'boolean' && Number.isInteger(e[1]) && Number.isFinite(e[2])));
}
/** Ticks of lead over a peer before this clock moves, once a second; the other end does the same the other way. */
const CLOCK_SLACK = 1.5;
/** A wait this long is worth saying so (ms). */
const WAIT_SHOWN_MS = 500;

export interface NetHooks {
  /** Ticks' worth of time the local player must act ahead of what they see (s). */
  readonly lead: number;
  frame(): void;
  step(input: InputFrame | null): void;
  /** The match is decided for certain. */
  readonly over: boolean;
  /** A word for the screen about the connection, or nothing. */
  readonly note: string;
  /** Held up: no tick can run yet, and input is left in its queue. */
  readonly held: boolean;
  /** The epoch moved by this (ms): for the clock's corrections. */
  drift(): number;
  /** Where the ball was moved to by the last rewinds, as a correction to ease out: dx, dy, dz, then cleared. */
  readonly nudge: { x: number; y: number; z: number };
}

export class NetMatch implements NetHooks {
  readonly client: RollbackClient;
  readonly feed: NetFeed;
  readonly lead: number;
  readonly nudge = { x: 0, y: 0, z: 0 };
  private readonly session: OnlineSession;
  private readonly seat: number;
  /** Peer id by seat, and each peer's seat. */
  private readonly seatOf = new Map<number, number>();
  private readonly inbox: Array<{ from: number; data: ArrayBuffer }> = [];
  /** The newest of our frames each peer has confirmed. */
  private readonly acked = new Map<number, number>();
  private readonly sentAt = new Map<number, number>();
  /** Each peer's tick less ours at a packet's arrival, allowing for its flight (smoothed). */
  private readonly behind = new Map<number, number>();
  private readonly theirHash = new Map<number, number>();
  private clockAt = 0;
  private adjust = 0;
  private frameAt = 0;
  private heldSince = 0;
  /** When the match began, and when each peer's packets were last heard (now() ms). */
  private beganAt = Infinity;
  private readonly heardAt = new Map<number, number>();
  /** Seats whose player has gone, and when the seat is to pass to the AI. */
  private readonly going = new Map<number, number>();
  /** Seats whose player the room says has left: nothing brings them back. */
  private readonly leftRoom = new Set<number>();
  /** Word from others about seats we haven't seen go. */
  private readonly told = new Map<number, { h: SeatHandover; at: number }>();
  private passedAt = 0;
  private hashFrom = 0;
  private noteText = '';
  private noteUntil = 0;
  private readonly sim: MatchSim;
  private readonly idle: Array<InputFrame | null>;
  private lastHash = 0;
  private lastHashTick = 0;
  /** The newest hash heard (from any peer: each sends every one, so one peer's are enough to catch a split from it, and all are read). */
  private lastHeard = 0;
  stopped = false;
  /** The sims differ: the match can't go on. */
  onDesync: ((tick: number) => void) | null = null;
  /** Figures for the debug readout and tools/net. */
  readonly stats = { rollbacks: 0, stalled: 0, hashesChecked: 0, sent: 0, got: 0 };

  constructor(sim: MatchSim, session: OnlineSession, start: OnlineStart) {
    this.sim = sim;
    this.session = session;
    this.seat = session.seat;
    this.lead = start.delay * DT;
    this.idle = start.seats.map(() => null);
    start.seats.forEach((id, s) => { if (id >= 0 && id !== session.you) this.seatOf.set(id, s); });
    for (const id of this.seatOf.keys()) { this.acked.set(id, -1); this.sentAt.set(id, 0); this.behind.set(id, 0); }
    this.client = new RollbackClient(sim.cfg, [this.seat], { delay: start.delay }, sim);
    this.feed = new NetFeed(sim);
    let bx = 0, by = 0, bz = 0, rally = false;
    this.client.onBefore = () => { const b = sim.ball.pos; bx = b.x; by = b.y; bz = b.z; rally = sim.phase === PH_RALLY; };
    this.client.onRestore = () => this.feed.rewound();
    this.client.onAfter = () => {
      this.feed.collect();
      if (rally && sim.phase === PH_RALLY) {
        const b = sim.ball.pos;
        this.nudge.x += bx - b.x;
        this.nudge.y += by - b.y;
        this.nudge.z += bz - b.z;
      }
    };
    session.onGamePacket = (from, data) => {
      if (new DataView(data).getUint8(0) === P_INPUT) this.inbox.push({ from, data });
    };
    session.onHandover = (from, h) => this.heardHandover(from, h);
    // (what happened while this client was still loading)
    for (const seat of session.leftSeats) this.seatLeft(seat);
    for (const { from, h } of session.handovers) this.heardHandover(from, h);
  }

  /** Once a frame, before any tick: take in what has arrived, and send what is due. */
  frame(): void {
    if (this.stopped) return;
    if (this.over) {
      this.feed.collect();
      this.feed.settle(this.sim.time);
      // Someone a little behind still needs our last frames, and if the packet with them is lost they would wait for ever.
      for (const m of this.inbox.splice(0)) {
        try { this.heardAck(m.from, decodeInput(m.data).ack); } catch { /* not a packet */ }
      }
      this.send();
      return;
    }
    for (const m of this.inbox.splice(0)) this.take(m.from, m.data);
    const t = now();
    // A held match's clock stands still with it, or it would race to catch up when it can go on.
    if (this.client.ahead >= this.client.o.maxBack) {
      if (this.heldSince === 0) this.heldSince = t;
      else this.adjust += t - this.frameAt;
    } else this.heldSince = 0;
    this.frameAt = t;
    const conf = this.client.confirmed;
    this.feed.settle((conf + 1) * DT);
    // Decided: the players walk to the net on their own, however soon someone leaves for the results.
    if (this.feed.over) {
      this.send();
      return;
    }
    this.checkHashes(conf);
    this.send();
    this.keepClock();
    this.watchPlayers(t);
  }

  /** The match has started (the moment, performance.now() time): from here a silent player is a missing one. */
  begin(at: number): void {
    this.beganAt = at + performance.timeOrigin;
  }

  /** The room says this seat's player has left. */
  seatLeft(seat: number): void {
    if (![...this.seatOf.values()].includes(seat) || this.over) return;
    this.leftRoom.add(seat);
    const at = now() + PASS_ON_MS;
    if ((this.going.get(seat) ?? Infinity) > at) this.going.set(seat, at);
  }

  private watchPlayers(t: number): void {
    let slowest = -1, low = Infinity;
    for (const [id, seat] of this.seatOf) {
      const quiet = t - Math.max(this.heardAt.get(id) ?? 0, this.beganAt), known = this.client.lastKnown[seat]!;
      if (quiet > GONE_MS - PASS_ON_MS && !this.going.has(seat)) this.going.set(seat, t + PASS_ON_MS);
      if (known < low) { low = known; slowest = seat; }
    }
    // Talking, but with nothing new: a client stuck, or something worse. Held this long, it's the one holding everyone.
    if (slowest >= 0 && this.heldSince > 0 && t - this.heldSince > GONE_MS && !this.going.has(slowest)) this.going.set(slowest, t + PASS_ON_MS);
    if (this.going.size === 0) return;
    this.passOn(t);
    for (const [seat, told] of this.told) {
      if (this.going.has(seat)) { this.told.delete(seat); this.giveSeat(told.h); return; }
      if (t - told.at > TOLD_FOR_MS) this.told.delete(seat);
    }
    // The lowest player still here decides, for everyone: a seat must pass on one tick or the sims split.
    let lowest = this.session.you;
    for (const [id, seat] of this.seatOf) if (!this.going.has(seat) && id < lowest) lowest = id;
    if (lowest !== this.session.you) return;
    for (const [seat, at] of this.going) {
      if (t < at) continue;
      const c = this.client, tick = c.lastKnown[seat]! + 1, first = Math.max(0, tick - TAIL);
      const h: SeatHandover = { seat, at: tick, first, tail: c.packet(seat, first).frames };
      this.session.handover(h);
      this.giveSeat(h);
      return;
    }
  }

  /** What we last heard of the gone, to everyone left. */
  private passOn(t: number): void {
    const links = this.session.links;
    if (!links || t - this.passedAt < PASS_EVERY_MS) return;
    this.passedAt = t;
    for (const seat of this.going.keys()) {
      const k = this.client.lastKnown[seat]!;
      if (k < 0) continue;
      const p = this.client.packet(seat, Math.max(0, k - TAIL + 1));
      const out = encodeInput({ ...p, ack: -1, tick: this.sim.tick, hashTick: 0, hash: 0 });
      for (const [id, s] of this.seatOf) if (!this.going.has(s)) links.send(id, out);
    }
  }

  /**
   * Another player's word that a seat passes to the AI. Nobody's word alone removes a player: it counts once this client has seen
   * the same (the room said they left, or they've gone silent), so a stranger can't throw anyone out. Word about this seat is
   * ignored too: if the others really have given up on us they go silent in turn, and we play on with the AI in their seats.
   */
  private heardHandover(from: number, h: SeatHandover): void {
    if (this.stopped || this.over || !this.seatOf.has(from) || !sane(h) || h.seat === this.seat) return;
    if (this.going.has(h.seat)) this.giveSeat(h);
    else this.told.set(h.seat, { h, at: now() });
  }

  private giveSeat(h: SeatHandover): void {
    if (![...this.seatOf.values()].includes(h.seat)) return;
    for (const [id, s] of this.seatOf) if (s === h.seat) this.seatOf.delete(id);
    this.going.delete(h.seat);
    // Hashes either side of this may come from different histories.
    this.theirHash.clear();
    this.hashFrom = h.at + 120;
    if (!this.client.dropSeat(h.seat, h.at, h.first, h.tail)) { this.stopped = true; this.onDesync?.(h.at); return; }
    this.feed.collect();
    this.noteText = 'A player has left. The AI plays their seat.';
    this.noteUntil = now() + NOTE_MS;
  }

  /** From a stranger, perhaps: a bad packet is dropped, and a player can only speak for their own seat. */
  private take(from: number, data: ArrayBuffer): void {
    const seat = this.seatOf.get(from);
    if (seat === undefined) return;
    let p: InputPacket;
    try { p = decodeInput(data); } catch { return; }
    this.stats.got++;
    if (p.seat !== seat) {
      if (this.going.has(p.seat)) this.give(p);
      return;
    }
    this.heardAt.set(from, now());
    const known = this.client.lastKnown[seat]!;
    if (!this.give(p)) return;
    // (back from a silence: their seat stays theirs)
    if (this.client.lastKnown[seat]! > known && !this.leftRoom.has(seat)) this.going.delete(seat);
    this.heardAck(from, p.ack);
    const flight = ((this.session.links?.rtt(from) ?? 0) / 2000) / DT;
    const lag = p.tick + flight - this.sim.tick, was = this.behind.get(from) ?? 0;
    this.behind.set(from, was + (lag - was) * 0.1);
    if (p.hashTick > this.lastHeard) {
      this.lastHeard = p.hashTick;
      this.theirHash.set(p.hashTick, p.hash);
    }
  }

  /** False: it starts past a gap that can't be: a sender only skips what we've confirmed. */
  private give(p: InputPacket): boolean {
    if (p.first > this.client.lastKnown[p.seat]! + 1 || p.first + p.frames.length > this.sim.tick + AHEAD_MAX) return false;
    if (!this.client.reaches(p)) { this.stopped = true; this.onDesync?.(p.first); return false; }
    this.client.receive(p);
    return true;
  }

  private checkHashes(conf: number): void {
    const c = this.client;
    for (const [t, h] of this.theirHash) {
      if (t - 1 > conf) continue;
      const mine = c.hashes.get(t);
      this.theirHash.delete(t);
      if (mine === undefined || t < this.hashFrom) continue;
      this.stats.hashesChecked++;
      if ((mine >>> 0) !== h) { this.stopped = true; this.onDesync?.(t); return; }
    }
    // The newest of ours that can't change any more.
    const t = Math.floor((conf + 1) / 60) * 60;
    if (t > this.lastHashTick && c.hashes.has(t)) { this.lastHashTick = t; this.lastHash = c.hashes.get(t)!; }
  }

  private heardAck(from: number, ack: number): void {
    if (ack > (this.acked.get(from) ?? -1)) this.acked.set(from, ack);
  }

  private send(): void {
    const links = this.session.links;
    if (!links) return;
    const t = now();
    for (const [id, seat] of this.seatOf) {
      if (t - this.sentAt.get(id)! < (links.direct(id) ? SEND_MS : SEND_RELAY_MS)) continue;
      if (this.over && this.acked.get(id)! >= this.client.lastKnown[this.seat]!) continue;
      this.sentAt.set(id, t);
      const p = this.client.packet(this.seat, Math.max(this.acked.get(id)! + 1, this.client.lastKnown[this.seat]! - SEND_BACK));
      links.send(id, encodeInput({ ...p, ack: this.client.lastKnown[seat]!, tick: this.sim.tick, hashTick: this.lastHashTick, hash: this.lastHash }));
      this.stats.sent++;
    }
  }

  /** The clocks started together, but no two run alike: whoever is ahead of the slowest gives a tick back. */
  private keepClock(): void {
    const t = now();
    if (t - this.clockAt < 1000) return;
    this.clockAt = t;
    let low = 0, high = 0;
    for (const v of this.behind.values()) { low = Math.min(low, v); high = Math.max(high, v); }
    // A quarter of the gap each, so a long hold evens out in seconds and the usual tick of drift goes one tick at a time.
    if (low < -CLOCK_SLACK) this.adjust += Math.max(1, Math.round(-low / 4)) * DT * 1000;
    else if (high > CLOCK_SLACK) this.adjust -= Math.max(1, Math.round(high / 4)) * DT * 1000;
  }

  drift(): number {
    const a = this.adjust;
    this.adjust = 0;
    return a;
  }

  get over(): boolean { return this.feed.over; }
  get note(): string {
    const t = now();
    if (this.heldSince > 0 && t - this.heldSince > WAIT_SHOWN_MS) return 'Waiting for the other players';
    if (this.sim.ai[this.seat]) return 'You were away, so the AI has your seat';
    return t < this.noteUntil ? this.noteText : '';
  }
  get held(): boolean { return !this.over && this.client.ahead >= this.client.o.maxBack; }
  step(input: InputFrame | null): void {
    if (this.stopped) return;
    if (this.over) {
      this.sim.step(this.idle);
      return;
    }
    if (this.client.ahead >= this.client.o.maxBack) { this.stats.stalled++; return; }
    if (input) this.client.local(this.seat, input);
    this.client.advance();
    this.feed.collect();
  }

  end(): void {
    this.stopped = true;
    this.stats.rollbacks = this.client.rollbacks;
    this.session.onGamePacket = null;
  }
}
