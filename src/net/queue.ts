// Looking for a public match: a socket to the queue (worker/room.js), told how many are looking and, in the end, which room.
import { BUILD, ROOMS_URL } from './config.ts';

export interface Found {
  code: string;
  /** This player makes the room and starts the match. */
  host: boolean;
  /** Players in the group. */
  n: number;
}

export interface QueueEvents {
  waiting(n: number): void;
  found(f: Found): void;
  failed(message: string): void;
}

/** The queue moves on when someone in it speaks, and that keeps it awake, so only while there's anyone to match. */
const BEAT_MS = 2000;
/** Alone, a beat the server answers without waking: it costs nothing, and someone joining moves the queue by themselves. */
const IDLE_BEAT = 15;

export class QueueSocket {
  private readonly ws: WebSocket;
  private readonly beat: ReturnType<typeof setInterval>;
  private done = false;

  constructor(on: QueueEvents) {
    this.ws = new WebSocket(`${ROOMS_URL}/find?v=${encodeURIComponent(BUILD)}`);
    let others = false, beats = 0;
    this.beat = setInterval(() => {
      beats++;
      if (this.ws.readyState !== WebSocket.OPEN) return;
      if (others) this.ws.send('.');
      else if (beats % IDLE_BEAT === 0) this.ws.send('ping');
    }, BEAT_MS);
    this.ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data as string) as { t: string; n?: number; code?: string; host?: boolean; why?: string };
      if (m.t === 'wait') { others = m.n! > 1; on.waiting(m.n!); }
      else if (m.t === 'match') { this.close(); on.found({ code: m.code!, host: m.host!, n: m.n! }); }
      else if (m.t === 'no') { this.close(); on.failed('Too many players are looking right now. Try again in a moment.'); }
    };
    this.ws.onclose = () => { if (!this.done) { this.close(); on.failed('Could not reach the match server. Check your connection.'); } };
    this.ws.onerror = () => undefined;
  }

  close(): void {
    this.done = true;
    clearInterval(this.beat);
    this.ws.close();
  }
}
