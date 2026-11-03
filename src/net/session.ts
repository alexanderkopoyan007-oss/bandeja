// An online room as the app sees it: who sits where, and the steps from the lobby to the first tick. The host is the lobby's
// authority: seats, the match, and the moment it starts. Everything goes through the room socket except game packets (links.ts).
import type { MatchConfig } from '../sim/match.ts';
import { Links, now } from './links.ts';
import { newCode, RoomSocket, type RoomOptions, type RoomRefusal } from './room.ts';
import type { Frame } from './rollback.ts';

export interface OnlineStart {
  /** The whole match, exactly as the host made it: every client's sim is built from this. */
  match: MatchConfig;
  castSeed: number;
  arena: string;
  /** Peer id by seat, -1: the AI. */
  seats: number[];
  delay: number;
}

/** A player has gone: the AI plays their seat from tick `at`. `tail`: their last hands from tick `first`, for anyone who missed some. */
export interface SeatHandover {
  seat: number;
  at: number;
  first: number;
  tail: Frame[];
}

type Msg =
  | { rtc: Parameters<Links['signal']>[1] }
  | { seats: number[] }
  | { side: true }
  | { start: OnlineStart }
  | { ready: true }
  | { go: number }
  | { handover: SeatHandover };

export const SEATS = 4;
const MIN_DELAY = 3;
const MAX_DELAY = 9;
const validSeats = (s: unknown): s is number[] => Array.isArray(s) && s.length === SEATS && s.every((x) => Number.isInteger(x) && x >= -1);
const START_MARGIN_MS = 1500;
/** The match starts without anyone still loading after this (ms): the AI takes their seat once the others see they aren't there. */
const READY_WAIT_MS = 30000;
/** The input delay for a link: 60% of the slowest one-way time, 3 to 9 ticks (docs/net-proof.md). */
export const delayFor = (rttMs: number): number => Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.round((rttMs / 2) * 0.6 * 0.12)));

export const ROOM_LOST = 'The connection to the match server was lost.';

const REFUSED: Record<RoomRefusal | 'lost', string> = {
  taken: 'That code is in use. Try again.',
  none: 'No match with that code. It may have ended.',
  full: 'That match is full.',
  version: 'That match is on another version of the game. Reload the page, both of you.',
  network: 'Could not reach the match server. Check your connection.',
  lost: ROOM_LOST,
};

export class OnlineSession {
  readonly code: string;
  readonly isCreator: boolean;
  private readonly room: RoomSocket;
  links: Links | null = null;
  you = -1;
  host = -1;
  seats: number[] = new Array(SEATS).fill(-1);
  private readonly readyFrom = new Set<number>();
  private started: OnlineStart | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  /** The room is ready, or who is in it changed. */
  onChange: (() => void) | null = null;
  onStart: ((s: OnlineStart) => void) | null = null;
  /** Go: the moment, on this machine's clock (ms, performance.now()). */
  onGo: ((at: number) => void) | null = null;
  onClosed: ((message: string) => void) | null = null;
  /** A player left: the seat they had. */
  onLeft: ((seat: number) => void) | null = null;
  /** A player's word that the AI takes a seat. */
  onHandover: ((from: number, h: SeatHandover) => void) | null = null;
  /** Since the match was started: seats whose player has left, and word of seats handed on. A client still loading has no match
   *  to tell, and its match needs both when it comes. */
  readonly leftSeats = new Set<number>();
  readonly handovers: Array<{ from: number; h: SeatHandover }> = [];
  /** Go, as this machine's performance.now() time: set once it's known, loading or not. */
  goTime: number | null = null;
  /** Go on this machine's wall clock, for anyone who asks after it. */
  private wentAt: number | null = null;
  private amReady = false;
  /** This player became the host before go was said, so nobody has told it who is ready. */
  private tookOver = false;
  /** The room's connection went during a match. The players have each other, so it goes on; afterwards there's no room to go back to. */
  roomLost = false;
  /** Left the room during a match. Their link stays until their seat goes: the room can lose someone who is still playing. */
  private readonly lostPeers = new Set<number>();

  /** `code` null: a new room. */
  constructor(code: string | null, o: RoomOptions = {}) {
    this.isCreator = code === null || o.create === true;
    this.code = code ?? newCode();
    this.room = new RoomSocket(this.code, { ...o, create: this.isCreator }, {
      in: (you, host, peers) => {
        this.you = you;
        this.host = host;
        this.links = new Links(this.room);
        this.links.onPacket = (from, d) => this.onGamePacket?.(from, d);
        for (const p of peers) this.links.add(p, true);
        if (you === host) this.seats[0] = you;
        this.onChange?.();
      },
      join: (id) => {
        this.links?.add(id, false);
        if (this.you === this.host) { this.seats[this.seats.indexOf(-1)] = id; this.shareSeats(); }
      },
      left: (id) => {
        const seat = this.seats.indexOf(id);
        if (this.goTime !== null) this.lostPeers.add(id);
        else this.links?.remove(id);
        if (seat >= 0) this.seats[seat] = -1;
        if (this.you === this.host) this.shareSeats();
        if (seat >= 0) { this.leftSeats.add(seat); this.onLeft?.(seat); }
      },
      host: (id) => {
        this.host = id;
        // (the host gone between the start and go: everyone's waiting for a word that won't come)
        if (id === this.you && this.started && this.wentAt === null) {
          this.tookOver = true;
          if (this.amReady) this.go();
        }
        this.onChange?.();
      },
      message: (from, d) => this.message(from, d as Msg),
      packet: (from, d) => this.links?.packet(from, d),
      closed: (why) => {
        if (why === 'lost' && this.goTime !== null) this.roomLost = true;
        else this.onClosed?.(REFUSED[why]);
      },
    });
  }

  /** Game packets, while a match is on. */
  onGamePacket: ((from: number, data: ArrayBuffer) => void) | null = null;

  get isHost(): boolean { return this.you === this.host; }
  get seat(): number { return this.seats.indexOf(this.you); }
  /** Everyone is in the room with a seat. */
  get players(): number { return this.seats.filter((s) => s >= 0).length; }

  private shareSeats(): void {
    this.room.send(-1, { seats: this.seats });
    this.onChange?.();
  }

  /** Anyone can be in a public room: what comes in isn't taken on trust, and only the host says who sits where and when. */
  private message(from: number, m: Msg | null): void {
    if (typeof m !== 'object' || m === null) return;
    if ('rtc' in m) this.links?.signal(from, m.rtc).catch(() => undefined);
    else if ('side' in m) this.swapSide(from);
    else if ('ready' in m) this.readied(from);
    else if ('handover' in m) { if (this.handovers.length < SEATS * 2) this.handovers.push({ from, h: m.handover }); this.onHandover?.(from, m.handover); }
    else if (from !== this.host) return;
    else if ('seats' in m) { if (validSeats(m.seats)) { this.seats = m.seats; this.onChange?.(); } }
    else if ('start' in m) this.heardStart(m.start);
    else if ('go' in m && Number.isFinite(m.go) && this.started && this.wentAt === null) {
      // (once: a second go would restart the clock of a match already running)
      this.goTime = m.go - (this.links?.offset(this.host) ?? 0) - performance.timeOrigin;
      this.wentAt = this.goTime + performance.timeOrigin;
      this.onGo?.(this.goTime);
    }
  }

  private heardStart(st: OnlineStart): void {
    // (a player who came in as the host pressed Start has no seat in it, and waits for the next)
    if (typeof st !== 'object' || st === null || !validSeats(st.seats) || !st.seats.includes(this.you)) return;
    if (!Number.isInteger(st.delay) || st.delay < MIN_DELAY || st.delay > MAX_DELAY || !Number.isSafeInteger(st.castSeed) || st.castSeed < 0) return;
    this.started = st;
    // (a copy: someone leaving empties a seat in the room, not in the match that was started)
    this.seats = st.seats.slice();
    this.newMatch();
    this.onStart?.(st);
  }

  private newMatch(): void {
    this.leftSeats.clear();
    this.handovers.length = 0;
    this.goTime = null;
    this.wentAt = null;
    this.amReady = false;
    this.tookOver = false;
  }

  private swapSide(id: number): void {
    const at = this.seats.indexOf(id);
    if (at < 0 || this.started) return;
    // The other team's seats are the odd or even ones; empty ones first, then trading with whoever is there.
    const other = [(at & 1) === 0 ? 1 : 0, (at & 1) === 0 ? 3 : 2], to = other.find((s) => this.seats[s] === -1) ?? other[0]!;
    this.seats[at] = this.seats[to]!;
    this.seats[to] = id;
    this.shareSeats();
  }

  /** This player asks for the other side. */
  changeSide(): void {
    if (this.isHost) this.swapSide(this.you);
    else this.room.send(this.host, { side: true });
  }

  /** The host starts the match. */
  start(s: Omit<OnlineStart, 'seats' | 'delay'>): OnlineStart {
    let rtt = 0;
    for (const id of this.links?.ids() ?? []) rtt = Math.max(rtt, this.links!.rtt(id));
    const st: OnlineStart = { ...s, seats: this.seats.slice(), delay: delayFor(rtt) };
    this.started = st;
    this.readyFrom.clear();
    this.newMatch();
    this.room.send(-1, { start: st });
    this.readyTimer = setTimeout(() => this.go(), READY_WAIT_MS);
    return st;
  }

  /** This client's game is built and waiting. */
  ready(): void {
    this.amReady = true;
    if (this.tookOver) this.go();
    else if (this.isHost) this.readied(this.you);
    else this.room.send(this.host, { ready: true });
  }

  private readied(id: number): void {
    // (late: it missed go, or came before it was building)
    if (this.wentAt !== null) { if (id !== this.you) this.room.send(id, { go: this.wentAt }); return; }
    this.readyFrom.add(id);
    if (this.started && this.readyFrom.size >= this.started.seats.filter((s) => s >= 0).length) this.go();
  }

  private go(): void {
    if (this.wentAt !== null) return;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const at = now() + START_MARGIN_MS;
    this.wentAt = at;
    this.goTime = at - performance.timeOrigin;
    this.room.send(-1, { go: at });
    this.onGo?.(this.goTime);
  }

  /** A seat is handed to the AI. */
  handover(h: SeatHandover): void {
    this.room.send(-1, { handover: h });
  }

  /** A player's seat has gone to the AI: nothing more is needed from them. */
  released(id: number): void {
    if (this.lostPeers.delete(id)) this.links?.remove(id);
  }

  /** The match is over; the room stays for another. */
  backToLobby(): void {
    this.started = null;
    this.newMatch();
    for (const id of this.lostPeers) this.links?.remove(id);
    this.lostPeers.clear();
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyFrom.clear();
    this.onGamePacket = null;
  }

  leave(): void {
    this.onClosed = null;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.links?.close();
    this.room.close();
  }
}
