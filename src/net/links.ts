// A link to each other player: a WebRTC data channel that drops rather than resends, set up over the room. Until it opens, and
// for good if it never does (some home and mobile networks), packets go through the room instead, more slowly. Each link keeps
// the round trip and the far clock's offset from small pings, so all players can start on one moment.
import { ICE_SERVERS, TEST_LAG, TEST_LOSS, TEST_RELAY } from './config.ts';
import { P_PING, P_PONG, encodeClock } from './packet.ts';
import type { RoomSocket } from './room.ts';

const PING_MS = 250;
const RELAY_PING_EVERY = 4;
/** Silence on a data channel that sends packets through the room instead (ms). */
const CHANNEL_QUIET_MS = 1500;
/** Smaller than any packet of ours. */
const MIN_PACKET = 24;
export const now = (): number => performance.timeOrigin + performance.now();

class Link {
  readonly id: number;
  readonly pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  /** Round trip (ms), smoothed; 0 until measured. */
  rtt = 0;
  private best = Infinity;
  /** Their clock minus ours (ms). */
  offset = 0;
  heard = now();
  /** Last heard by the data channel. */
  heardDirect = 0;

  constructor(id: number) {
    this.id = id;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  }

  get direct(): boolean { return !TEST_RELAY && this.dc?.readyState === 'open'; }

  clock(t0: number, far: number): void {
    const t = now(), rtt = t - t0;
    this.rtt = this.rtt === 0 ? rtt : this.rtt + (rtt - this.rtt) * 0.2;
    // The offset from the quickest trips: a slow one was held up one way or the other and says less.
    this.best = Math.min(this.best * 1.002, rtt);
    if (rtt <= this.best * 1.25) this.offset = far - (t0 + rtt / 2);
  }
}

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

export class Links {
  private readonly room: RoomSocket;
  private readonly links = new Map<number, Link>();
  private readonly timer: ReturnType<typeof setInterval>;
  private beat = 0;
  /** A game packet from a player. */
  onPacket: ((from: number, data: ArrayBuffer) => void) | null = null;

  constructor(room: RoomSocket) {
    this.room = room;
    this.timer = setInterval(() => {
      this.beat++;
      // (through the room every message counts against the free plan)
      for (const [id, l] of this.links) {
        const ping = encodeClock(P_PING, now());
        // (a channel that has gone quiet is still tried: it's how it comes back)
        if (l.direct && !this.open(l)) try { l.dc!.send(ping); } catch { /* it has gone */ }
        if (this.open(l) || this.beat % RELAY_PING_EVERY === 0 || l.rtt === 0) this.send(id, ping);
      }
    }, PING_MS);
  }

  /** A player is here. The one who came first makes the offer. */
  add(id: number, offer: boolean): void {
    if (this.links.has(id)) return;
    const l = new Link(id);
    this.links.set(id, l);
    l.pc.onicecandidate = (e) => { if (e.candidate) this.room.send(id, { rtc: { ice: e.candidate.toJSON() } }); };
    l.pc.ondatachannel = (e) => this.channel(l, e.channel);
    if (!offer) return;
    this.channel(l, l.pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
    void l.pc.createOffer().then((o) => l.pc.setLocalDescription(o)).then(() => this.room.send(id, { rtc: { sdp: l.pc.localDescription } }));
  }

  private channel(l: Link, dc: RTCDataChannel): void {
    l.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => { l.heardDirect = now(); this.packet(l.id, e.data as ArrayBuffer); };
    dc.onopen = () => { l.heardDirect = now(); };
  }

  /** WebRTC's set-up messages, from the room. */
  async signal(from: number, s: Signal): Promise<void> {
    if (!this.links.has(from)) this.add(from, false);
    const l = this.links.get(from)!;
    if (s.sdp) {
      await l.pc.setRemoteDescription(s.sdp);
      if (s.sdp.type === 'offer') {
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        this.room.send(from, { rtc: { sdp: l.pc.localDescription } });
      }
    } else if (s.ice) await l.pc.addIceCandidate(s.ice).catch(() => undefined);
  }

  /** Bytes for a player, by the quickest way open. */
  send(id: number, data: ArrayBuffer): void {
    const l = this.links.get(id);
    if (!l) return;
    if (this.open(l)) {
      try { l.dc!.send(data); return; } catch { /* the channel went: the room carries this one */ }
    }
    this.room.relay(id, data);
  }

  /** A channel can read as open long after its path has gone: silence sends us to the room, and anything heard brings us back. */
  private open(l: Link): boolean { return l.direct && now() - l.heardDirect < CHANNEL_QUIET_MS; }

  packet(from: number, data: ArrayBuffer): void {
    if (TEST_LAG > 0 || TEST_LOSS > 0) {
      if (Math.random() >= TEST_LOSS) setTimeout(() => this.arrived(from, data), TEST_LAG * (0.85 + 0.3 * Math.random()));
    } else this.arrived(from, data);
  }

  private arrived(from: number, data: ArrayBuffer): void {
    const l = this.links.get(from);
    if (!l || !(data instanceof ArrayBuffer) || data.byteLength < MIN_PACKET) return;
    l.heard = now();
    const kind = new DataView(data).getUint8(0);
    if (kind === P_PING) this.send(from, encodeClock(P_PONG, new DataView(data).getFloat64(8, true), now()));
    else if (kind === P_PONG) { const R = new DataView(data); l.clock(R.getFloat64(8, true), R.getFloat64(16, true)); }
    else this.onPacket?.(from, data);
  }

  remove(id: number): void {
    this.links.get(id)?.pc.close();
    this.links.delete(id);
  }

  ids(): number[] { return [...this.links.keys()]; }
  rtt(id: number): number { return this.links.get(id)?.rtt ?? 0; }
  offset(id: number): number { return this.links.get(id)?.offset ?? 0; }
  direct(id: number): boolean { const l = this.links.get(id); return l !== undefined && this.open(l); }

  close(): void {
    clearInterval(this.timer);
    for (const l of this.links.values()) l.pc.close();
    this.links.clear();
  }
}
