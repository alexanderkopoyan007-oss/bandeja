// A player's socket to the room (worker/room.js): who is here, messages between them, and game packets for a pair with no
// direct path.
import { BUILD, ROOMS_URL } from './config.ts';

/** No vowels: no words in a code, and nothing mistaken for a number. */
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const newCode = (): string => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const validCode = (s: string): boolean => /^[BCDFGHJKLMNPQRSTVWXZ]{5}$/.test(s);

/** Answered by the server without waking the room (worker/room.js). */
const BEAT_MS = 30000;

export type RoomRefusal = 'taken' | 'none' | 'full' | 'version' | 'network';

export interface RoomOptions {
  create?: boolean;
  /** Players the room takes, when creating it. */
  max?: number;
  /** Keep trying this long (ms) if the room isn't there yet: a public match's first player can be a moment behind the rest. */
  patience?: number;
}

export interface RoomEvents {
  in(you: number, host: number, peers: number[]): void;
  join(id: number): void;
  left(id: number): void;
  host(id: number): void;
  message(from: number, d: unknown): void;
  packet(from: number, data: ArrayBuffer): void;
  /** Refused, or the connection to the room has gone. */
  closed(why: RoomRefusal | 'lost'): void;
}

export class RoomSocket {
  private ws!: WebSocket;
  private readonly on: RoomEvents;
  private readonly url: string;
  private readonly until: number;
  private done = false;
  private entered = false;
  private readonly beat: ReturnType<typeof setInterval>;

  constructor(code: string, o: RoomOptions, on: RoomEvents) {
    this.on = on;
    this.url = `${ROOMS_URL}/room/${code}?v=${encodeURIComponent(BUILD)}${o.create ? `&create=1&max=${o.max ?? 4}` : ''}`;
    this.until = performance.now() + (o.patience ?? 0);
    this.beat = setInterval(() => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send('ping'); }, BEAT_MS);
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      if (typeof e.data !== 'string') {
        const b = new Uint8Array(e.data as ArrayBuffer);
        if (b.length > 1) this.on.packet(b[0]!, b.buffer.slice(1));
        return;
      }
      const m = JSON.parse(e.data) as { t: string; you?: number; host?: number; peers?: number[]; id?: number; from?: number; d?: unknown; why?: RoomRefusal };
      if (m.t === 'in') { this.entered = true; this.on.in(m.you!, m.host!, m.peers!); }
      else if (m.t === 'join') this.on.join(m.id!);
      else if (m.t === 'left') this.on.left(m.id!);
      else if (m.t === 'host') this.on.host(m.id!);
      else if (m.t === 'msg') this.on.message(m.from!, m.d);
      else if (m.t === 'no') this.refused(m.why!);
    };
    ws.onclose = () => this.finish(this.entered ? 'lost' : 'network');
    ws.onerror = () => undefined;
  }

  private refused(why: RoomRefusal): void {
    if (why === 'none' && performance.now() < this.until) {
      this.ws.onclose = null;
      setTimeout(() => { if (!this.done) this.open(); }, 300);
    } else this.finish(why);
  }

  private finish(why: RoomRefusal | 'lost'): void {
    if (this.done) return;
    this.done = true;
    clearInterval(this.beat);
    this.on.closed(why);
  }

  /** To one player, or -1: everyone else. */
  send(to: number, d: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ to, d }));
  }

  relay(to: number, data: ArrayBuffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const b = new Uint8Array(data.byteLength + 1);
    b[0] = to;
    b.set(new Uint8Array(data), 1);
    this.ws.send(b);
  }

  close(): void {
    this.done = true;
    clearInterval(this.beat);
    this.ws.close();
  }
}
