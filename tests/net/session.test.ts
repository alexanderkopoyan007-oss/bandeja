// The room and the match: what a session does with what the room tells it, and what a match does when the room goes away.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASES, Hands } from '../../tools/net/hash-core.ts';
import { NetMatch } from '../../src/net/netMatch.ts';
import { P_SEAT } from '../../src/net/packet.ts';
import { OnlineSession, type OnlineStart } from '../../src/net/session.ts';
import { MatchSim, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 1;
  binaryType = '';
  sent: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeSocket.last = this; }
  send(d: string): void { this.sent.push(d); }
  close(): void { this.readyState = 3; }
  say(m: unknown): void { this.onmessage!({ data: JSON.stringify(m) }); }
  drop(): void { this.readyState = 3; this.onclose!(); }
}

class FakePeer {
  closed = false;
  onicecandidate = null;
  ondatachannel = null;
  localDescription = null;
  createDataChannel(): object { return {}; }
  createOffer(): Promise<object> { return Promise.resolve({}); }
  setLocalDescription(): Promise<void> { return Promise.resolve(); }
  close(): void { this.closed = true; }
}

const START: OnlineStart = { seats: [0, 1, -1, -1], delay: 3, castSeed: 7 } as OnlineStart;

/** A session in a room with one other player, who is the host. */
function joined(): { s: OnlineSession; ws: FakeSocket; closed: string[]; gos: number[] } {
  const s = new OnlineSession('ABCDE'), ws = FakeSocket.last, closed: string[] = [], gos: number[] = [];
  s.onClosed = (m) => closed.push(m);
  s.onGo = (at) => gos.push(at);
  ws.say({ t: 'in', you: 1, host: 0, peers: [0] });
  return { s, ws, closed, gos };
}

const playing = (s: OnlineSession, ws: FakeSocket): void => {
  ws.say({ t: 'msg', from: 0, d: { start: START } });
  s.ready();
  ws.say({ t: 'msg', from: 0, d: { go: Date.now() } });
};

describe('a session in a room', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('RTCPeerConnection', FakePeer); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('takes go once: a second would restart the clock of a match already running', () => {
    const { s, ws, gos } = joined();
    playing(s, ws);
    const at = s.goTime;
    ws.say({ t: 'msg', from: 0, d: { go: Date.now() + 60000 } });
    expect(gos.length).toBe(1);
    expect(s.goTime).toBe(at);
    s.leave();
  });

  it('a host made in the middle of a match says nothing, and one made before go says it', () => {
    const mid = joined();
    playing(mid.s, mid.ws);
    mid.ws.sent.length = 0;
    mid.ws.say({ t: 'left', id: 0 });
    mid.ws.say({ t: 'host', id: 1 });
    expect(mid.ws.sent.some((m) => m.includes('"go"'))).toBe(false);
    mid.s.leave();

    const early = joined();
    early.ws.say({ t: 'msg', from: 0, d: { start: START } });
    early.s.ready();
    early.ws.say({ t: 'host', id: 1 });
    expect(early.gos.length).toBe(1);
    early.s.leave();
  });

  it('losing the room in a match leaves the match; in the lobby it ends the session', () => {
    const inMatch = joined();
    playing(inMatch.s, inMatch.ws);
    inMatch.ws.drop();
    expect(inMatch.closed).toEqual([]);
    expect(inMatch.s.roomLost).toBe(true);
    inMatch.s.leave();

    const lobby = joined();
    lobby.ws.drop();
    expect(lobby.closed.length).toBe(1);
    lobby.s.leave();
  });

  it('keeps a link to a player the room has lost until their seat goes', () => {
    const { s, ws } = joined();
    playing(s, ws);
    ws.say({ t: 'left', id: 0 });
    expect(s.links!.ids()).toEqual([0]);
    s.released(0);
    expect(s.links!.ids()).toEqual([]);
    s.leave();
  });

  it('starts the next match fresh after one in which a player left', () => {
    const { s, ws, gos } = joined();
    playing(s, ws);
    ws.say({ t: 'left', id: 0 });
    s.backToLobby();
    expect(s.links!.ids()).toEqual([]);
    expect(s.goTime).toBe(null);
    expect(gos.length).toBe(1);
    s.leave();
  });
});

describe('a match without the room', () => {
  let clock = 1000;
  beforeEach(() => { clock = 1000; vi.spyOn(performance, 'now').mockImplementation(() => clock); });
  afterEach(() => { vi.restoreAllMocks(); });

  const cfg: MatchConfig = { ...CASES[2]!.cfg, human: [true, true, true, false] };
  const LATENCY = 10;

  /** Three players on data channels alone. `drop` says whether a packet is lost on its way. */
  function table(drop: (data: ArrayBuffer) => boolean) {
    const q: Array<{ at: number; to: number; from: number; data: ArrayBuffer }> = [];
    const start = { seats: [0, 1, 2, -1], delay: 4, castSeed: 1 } as OnlineStart;
    let w = 0;
    const players = [0, 1, 2].map((you) => {
      const links = {
        send: (id: number, data: ArrayBuffer) => { if (!drop(data)) q.push({ at: w + LATENCY, to: id, from: you, data }); },
        rtt: () => 0,
        direct: () => true,
      };
      const session = { you, seat: you, links, leftSeats: new Set<number>(), handovers: [], onGamePacket: null, onHandover: null, handover() { /* the room has gone */ }, released() { /* no link to close here */ } };
      const sim = new MatchSim(cfg), net = new NetMatch(sim, session as never, start);
      const hands = new Hands(cfg.seed + you * 977);
      hands.timed = 0.045;
      net.begin(clock);
      return { sim, net, hands, session: session as unknown as OnlineSession, you };
    });
    return {
      players,
      run(ticks: number, alive: (p: (typeof players)[number]) => boolean): void {
        for (let i = 0; i < ticks; i++, w++, clock += 1000 / 120) {
          for (let k = q.length - 1; k >= 0; k--) {
            const m = q[k]!;
            if (m.at > w) continue;
            q.splice(k, 1);
            if (alive(players[m.to]!)) players[m.to]!.session.onGamePacket?.(m.from, m.data);
          }
          for (const p of players) {
            if (!alive(p)) continue;
            p.net.frame();
            const m = p.sim, M = m as never as { score: { serverPlayer(): number } };
            p.net.step(p.hands.frame(m, p.you, m.tick, (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === p.you));
          }
        }
      },
    };
  }

  it('the room saying a player left changes nothing if their packets keep coming', () => {
    const t = table(() => false);
    t.run(600, () => true);
    t.players[0]!.net.seatLeft(2);
    t.players[1]!.net.seatLeft(2);
    t.run(600, () => true);
    expect(t.players.map((p) => p.sim.aiTaken)).toEqual([0, 0, 0]);
    expect(t.players[0]!.net.stats.hashesChecked).toBeGreaterThan(5);
    expect(t.players[0]!.net.stopped).toBe(false);
  });

  it('a player who really leaves is gone within a second or two', () => {
    const t = table(() => false);
    t.run(600, () => true);
    const stay = (p: { you: number }): boolean => p.you !== 2;
    t.players[0]!.net.seatLeft(2);
    t.players[1]!.net.seatLeft(2);
    t.run(240, stay);
    expect(t.players[0]!.sim.aiTaken).toBe(4);
    expect(t.players[1]!.sim.aiTaken).toBe(4);
  });

  it('with no room at all the seat still passes on one tick, even if the first words are lost', () => {
    let lost = 0;
    const t = table((data) => new DataView(data).getUint8(0) === P_SEAT && lost++ < 4);
    t.run(600, () => true);
    const stay = (p: { you: number }): boolean => p.you !== 2;
    t.run(120 * 12, stay);
    const [a, b] = [t.players[0]!, t.players[1]!];
    expect(lost).toBeGreaterThan(0);
    expect([a.sim.aiTaken, b.sim.aiTaken]).toEqual([4, 4]);
    expect(a.net.stopped || b.net.stopped).toBe(false);
    const sure = Math.min(a.net.client.confirmed, b.net.client.confirmed);
    let compared = 0;
    for (const [tick, h] of a.net.client.hashes) {
      if (tick >= sure || tick < 800 || !b.net.client.hashes.has(tick)) continue;
      compared++;
      expect(b.net.client.hashes.get(tick)).toBe(h);
    }
    expect(compared).toBeGreaterThan(5);
  });
});
