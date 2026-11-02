// One tab of the two-tab proof: the real game, drawn and sounding, as a rollback client. Loaded by main.ts on ?net=<seat>
// (&ms= one way, &delay= ticks, &loss=, &secs=). BroadcastChannel carries the packets; the far end holds each until the
// fake link would have delivered it. Both tabs set one clock (a shared start time), so this says nothing about clock sync.
import type { Game, GameOptions } from '../../src/game/game.ts';
import type { MatchSim, MatchEvent } from '../../src/sim/match.ts';
import { PH_SETUP, PH_TOSS, PH_RALLY, E_HIT } from '../../src/sim/match.ts';
import { RollbackClient, type Packet } from './rollback.ts';
import { Hands } from './hash-core.ts';

interface Ev { seq: number; kind: number; player: number; time: number; a: number }
const copy = (e: MatchEvent): Ev => ({ seq: e.seq, kind: e.kind, player: e.player, time: e.time, a: e.a });

export function prepare(o: GameOptions, p: URLSearchParams): void {
  o.match.human = [true, true, false, false];
  o.match.aiLevel = [0.8, 0.8];
  o.human = Number(p.get('net'));
}

export function attach(game: Game, p: URLSearchParams): void {
  const seat = Number(p.get('net')), ms = Number(p.get('ms') ?? 80), delay = Number(p.get('delay') ?? 6), loss = Number(p.get('loss') ?? 0.02), secs = Number(p.get('secs') ?? 60);
  const sim = game.sim, seed = sim.cfg.seed;
  const client = new RollbackClient(sim.cfg, [seat], { delay }, sim);
  const hands = new Hands(seed + seat * 977);
  hands.timed = 0.045;
  const ch = new BroadcastChannel(`bandeja-net-${seed}`);
  const wall = (): number => performance.timeOrigin + performance.now();
  const inbox: Array<{ at: number; p: Packet }> = [];
  let start = 0, sent = 0, lost = 0, r = (seed + seat) | 0;
  const die = (): number => { r = (Math.imul(r, 1664525) + 1013904223) | 0; return (r >>> 8) / (1 << 24); };

  const frames: number[] = [], simMs: number[] = [], hops: number[] = [], bodyHops: number[] = [];
  let stepMs = 0, last = 0, hitches = 0, stalled = 0, scoreBack = 0, seqBack = 0, lastPts = 0;
  const shown: Ev[] = [], truth: Ev[] = [];
  let seenShown = 0, seenTruth = 0, bx = 0, by = 0, bz = 0, wasRally = false;
  const px = [0, 0, 0, 0], pz = [0, 0, 0, 0];
  const before = (): void => {
    const b = sim.ball.pos;
    bx = b.x; by = b.y; bz = b.z;
    wasRally = sim.phase === PH_RALLY;
    for (let i = 0; i < 4; i++) { px[i] = sim.players[i]!.pos.x; pz[i] = sim.players[i]!.pos.z; }
  };
  const readTruth = (): void => {
    for (; seenTruth < sim.eventSeq; seenTruth++) truth.push(copy(sim.events[seenTruth % sim.events.length]!));
  };
  client.onBefore = before;
  client.onRestore = () => {
    if (sim.eventSeq < seenTruth) { seqBack++; truth.length = Math.max(0, truth.length - (seenTruth - sim.eventSeq)); }
    seenTruth = sim.eventSeq;
  };
  client.onAfter = () => {
    readTruth();
    if (wasRally && sim.phase === PH_RALLY) {
      const b = sim.ball.pos;
      hops.push(Math.hypot(b.x - bx, b.y - by, b.z - bz));
      let w = 0;
      for (let i = 0; i < 4; i++) w = Math.max(w, Math.hypot(sim.players[i]!.pos.x - px[i]!, sim.players[i]!.pos.z - pz[i]!));
      bodyHops.push(w);
    }
  };

  ch.onmessage = (e: MessageEvent) => {
    const d = e.data as { ready?: number; start?: number; at?: number; p?: Packet };
    if (d.ready !== undefined && seat === 0 && start === 0) { start = wall() + 2500; ch.postMessage({ start }); }
    else if (d.start) start = d.start;
    else if (d.p) inbox.push({ at: d.at!, p: d.p });
  };
  const drain = (): void => {
    const now = wall();
    for (let i = 0; i < inbox.length;) {
      if (inbox[i]!.at <= now) { client.receive(inbox[i]!.p); inbox.splice(i, 1); }
      else i++;
    }
  };

  game.paused = true;
  const hello = setInterval(() => { if (start === 0) ch.postMessage({ ready: seat }); else clearInterval(hello); }, 200);
  const g = game as unknown as { epoch: number };
  game.stepper = (m: MatchSim) => {
    const t0 = performance.now();
    drain();
    if (client.ahead >= client.o.maxBack) { stalled++; stepMs += performance.now() - t0; return; }
    const M = m as never as { score: { serverPlayer(): number } };
    const toss = (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === seat;
    const pk = client.local(seat, hands.frame(m, seat, m.tick, toss));
    if (die() < loss) lost++;
    else { ch.postMessage({ at: wall() + ms + (die() - 0.5) * 0.3 * ms, p: pk }); sent++; }
    client.advance();
    readTruth();
    stepMs += performance.now() - t0;
  };

  const pts = (): number => { const s = sim.score as never as { points: number[]; games: number[]; sets: number[] }; return s.games[0]! * 100 + s.games[1]! * 100 + (s.sets?.[0] ?? 0) * 1000 + (s.sets?.[1] ?? 0) * 1000 + s.points[0]! + s.points[1]!; };
  const errors: string[] = [];
  addEventListener('error', (e) => errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  let endAt = 0, tickWas = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    if (game.paused) {
      if (start !== 0 && wall() >= start) { game.paused = false; g.epoch = start - performance.timeOrigin; endAt = now + secs * 1000; last = now; }
      return;
    }
    if (endAt === 0 || now > endAt + 3000) return;
    // (a reader's cursor, once a frame, as the HUD, sound and the rest have)
    if (sim.eventSeq - seenShown > sim.events.length) seenShown = sim.eventSeq - sim.events.length;
    while (seenShown < sim.eventSeq) shown.push(copy(sim.events[seenShown++ % sim.events.length]!));
    const q = pts();
    if (q < lastPts && q > lastPts - 50) scoreBack++;
    lastPts = q;
    if (sim.tick - tickWas >= 12) hitches++;
    tickWas = sim.tick;
    frames.push(now - last);
    simMs.push(stepMs);
    stepMs = 0;
    last = now;
    if (now > endAt + 2000) {
      const hashes: Array<[number, number]> = [];
      for (const [t, h] of client.hashes) if (t <= sim.tick - client.o.maxBack) hashes.push([t, h]);
      const kinds = (l: Ev[]): Record<number, number> => { const o: Record<number, number> = {}; for (const e of l) o[e.kind] = (o[e.kind] ?? 0) + 1; return o; };
      const near = (e: Ev, l: Ev[]): boolean => l.some((x) => x.kind === e.kind && x.player === e.player && Math.abs(x.time - e.time) < 0.06);
      const ghost = shown.filter((e) => e.time < sim.time - 1 && !near(e, truth)), miss = truth.filter((e) => e.time < sim.time - 1 && !near(e, shown));
      (window as unknown as { __net: unknown }).__net = {
        seat, ms, delay, tick: sim.tick, sent, lost, hashes, frames, simMs, hops, bodyHops, hitches, stalled, scoreBack, seqBack,
        rollbacks: client.rollbacks, depths: client.depths, replayMs: client.replayMs, stalls: client.stalls,
        ghost: kinds(ghost), miss: kinds(miss), shown: kinds(shown), truth: kinds(truth), errors,
        hitTruth: truth.filter((e) => e.kind === E_HIT).length, calls: (game as unknown as { renderer: { info: { render: { calls: number } } } }).renderer?.info?.render?.calls ?? -1,
      };
    }
  };
  requestAnimationFrame(frame);
}
