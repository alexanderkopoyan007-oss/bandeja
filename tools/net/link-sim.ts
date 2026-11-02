// Two (or four) clients over a fake link, in one process: delay, jitter and loss, each client's hands reacting to its
// own predicted screen. Reports whether the clients agree, how often and how far they rewind, how far things jump on
// screen, and what a reader of the event ring (sound, HUD, crowd, stats all read it the same way) sees against the truth.
//   node tools/net/link-sim.ts [seconds]
import { MatchSim, E_FLOOR, E_HIT, E_NET, E_POINT, E_SWING, E_TOSS, E_WALL, E_WHIFF, E_FAULT, PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Hands } from './hash-core.ts';
import { RollbackClient, type Packet, type Frame } from '../../src/net/rollback.ts';

class Link {
  private readonly q: Array<{ at: number; p: Packet }> = [];
  private r: number;
  private readonly ms: number;
  private readonly loss: number;
  private readonly jitter: number;
  constructor(ms: number, loss: number, jitter: number, seed: number) { this.ms = ms; this.loss = loss; this.jitter = jitter; this.r = seed | 0; }
  private next(): number { this.r = (Math.imul(this.r, 1664525) + 1013904223) | 0; return (this.r >>> 8) / (1 << 24); }
  send(now: number, p: Packet): void {
    if (this.next() < this.loss) return;
    this.q.push({ at: now + (this.ms + this.jitter * this.next()) / 1000, p });
  }
  /** Oldest first, and a late packet can pass an earlier one, as on a real network. */
  due(now: number): Packet[] {
    const out: Packet[] = [];
    for (let i = this.q.length - 1; i >= 0; i--) if (this.q[i]!.at <= now) { out.push(this.q[i]!.p); this.q.splice(i, 1); }
    return out.reverse();
  }
}

const KINDS: Record<number, string> = { [E_HIT]: 'hit', [E_FLOOR]: 'floor', [E_WALL]: 'wall', [E_NET]: 'net', [E_POINT]: 'point', [E_WHIFF]: 'whiff', [E_SWING]: 'swing', [E_FAULT]: 'fault', [E_TOSS]: 'toss' };

interface Seen { k: string; p: number; t: number; at: number }

export interface LinkResult { big: number[]; hitsBy: number; secs: number; agreed: number; disagreed: number; rollPerSec: number; depth: number[]; replay: number[]; ballJump: number[]; bodyJump: number[]; stallPct: number; events: Record<string, { truth: number; ghost: number; missed: number; lateMs: number }>; points: number }

export function runLink(cfg: MatchConfig, seats: number[][], ms: number, loss: number, jitter: number, secs: number, opts = {}): LinkResult {
  const clients = seats.map((s) => new RollbackClient(cfg, s, opts));
  const hands = cfg.human.map((h, i) => (h ? new Hands(cfg.seed + i * 977) : null));
  for (const h of hands) if (h) h.timed = 0.045;
  const links = clients.map((_, a) => clients.map((_, b) => (a === b ? null : new Link(ms, loss, jitter, cfg.seed + a * 31 + b * 7))));
  const ballJump: number[] = [], bodyJump: number[] = [];
  // Client 0 is the one watched: where things were drawn just before each rewind, and just after.
  const c0 = clients[0]!, m0 = c0.sim;
  const before = { x: 0, y: 0, z: 0, bx: [0, 0, 0, 0], bz: [0, 0, 0, 0] };
  let inRally = false;
  c0.onBefore = () => { inRally = m0.phase === PH_RALLY; before.x = m0.ball.pos.x; before.y = m0.ball.pos.y; before.z = m0.ball.pos.z; m0.players.forEach((p, i) => { before.bx[i] = p.pos.x; before.bz[i] = p.pos.z; }); };
  c0.onAfter = () => {
    // (a rewind across the moment a point starts or ends "moves" everything to its next place, and nobody sees that as a jump)
    if (!inRally || m0.phase !== PH_RALLY) return;
    ballJump.push(Math.hypot(m0.ball.pos.x - before.x, m0.ball.pos.y - before.y, m0.ball.pos.z - before.z));
    let b = 0;
    m0.players.forEach((p, i) => { b = Math.max(b, Math.hypot(p.pos.x - before.bx[i]!, p.pos.z - before.bz[i]!)); });
    bodyJump.push(b);
  };
  const ticks = Math.round(secs * 120);
  let seen = 0;
  const shown: Seen[] = [];
  const trueFrames: Array<Map<number, Frame>> = cfg.human.map(() => new Map());
  let waited = 0;
  for (let w = 0; w < ticks && !clients.some((c) => c.sim.phase === PH_OVER); w++) {
    const now = w * DT;
    for (let a = 0; a < clients.length; a++) {
      const c = clients[a]!;
      for (let b = 0; b < clients.length; b++) {
        const l = links[b]![a];
        if (l) for (const p of l.due(now)) c.receive(p);
      }
    }
    for (let a = 0; a < clients.length; a++) {
      const c = clients[a]!, m = c.sim;
      const M = m as never as { score: { serverPlayer(): number } };
      for (const s of c.seats) {
        const f = hands[s]!.frame(m, s, m.tick, (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === s);
        c.local(s, f);
        const pk = c.packet(s);
        trueFrames[s]!.set(pk.ack, pk.frames[pk.frames.length - 1]!);
        for (let b = 0; b < clients.length; b++) links[a]![b]?.send(now, pk);
      }
      if (!c.advance()) waited++;
    }
    // The real readers, as they all read the ring.
    if (m0.eventSeq - seen > m0.events.length) seen = m0.eventSeq - m0.events.length;
    while (seen < m0.eventSeq) {
      const e = m0.events[seen % m0.events.length]!;
      seen++;
      const k = KINDS[e.kind];
      if (k) shown.push({ k, p: e.player, t: e.time, at: m0.time });
      if (e.kind === E_HIT && e.player >= 0 && hands[e.player]) hands[e.player]!.hit(m0.tick);
    }
  }
  // The truth: the same match on the inputs as they really were.
  const T = new MatchSim(cfg);
  const fs = cfg.human.map(() => new InputFrame());
  const ins: Array<InputFrame | null> = cfg.human.map(() => null);
  const end = Math.min(...clients.map((c) => c.sim.tick));
  const truth: Seen[] = [];
  let ts = 0;
  for (let t = 0; t < end; t++) {
    for (let s = 0; s < ins.length; s++) {
      if (!cfg.human[s]) continue;
      const fr = trueFrames[s]!.get(t) ?? { x: 0, y: 0, held: 0, ev: [] };
      const f = fs[s]!;
      f.clear(); f.moveX = fr.x; f.moveY = fr.y;
      for (const e of fr.ev) f.push(e[0], e[1], e[2]);
      f.held = fr.held;
      ins[s] = f;
    }
    T.step(ins);
    while (ts < T.eventSeq) {
      const e = T.events[ts % T.events.length]!;
      ts++;
      const k = KINDS[e.kind];
      if (k) truth.push({ k, p: e.player, t: e.time, at: 0 });
    }
  }
  // Each truth event against what the reader actually saw, within a few ticks.
  const events: LinkResult['events'] = {};
  const used = new Array(shown.length).fill(false);
  const lates: Record<string, number[]> = {};
  for (const t of truth) {
    const E = (events[t.k] ??= { truth: 0, ghost: 0, missed: 0, lateMs: 0 });
    E.truth++;
    let hit = -1;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i]!;
      if (used[i] || s.k !== t.k || s.p !== t.p) continue;
      if (Math.abs(s.t - t.t) < 0.06) { hit = i; break; }
    }
    if (hit < 0) E.missed++;
    else { used[hit] = true; (lates[t.k] ??= []).push((shown[hit]!.at - t.t) * 1000); }
  }
  shown.forEach((s, i) => { if (!used[i] && s.t < end * DT) { const E = (events[s.k] ??= { truth: 0, ghost: 0, missed: 0, lateMs: 0 }); E.ghost++; } });
  for (const k of Object.keys(lates)) { const v = lates[k]!.sort((x, y) => x - y); events[k]!.lateMs = v[Math.floor(v.length * 0.95)]!; }
  // Do the clients agree? Every hash at a tick all of them have and every seat's inputs were known by.
  let agreed = 0, disagreed = 0;
  for (const [t, h] of clients[0]!.hashes) {
    if (t >= end - 200) continue;
    if (clients.every((c) => c.hashes.get(t) === h)) agreed++; else disagreed++;
  }
  const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))]! : 0; };
  return {
    big: [0.05, 0.25, 0.5, 1].map((m) => (ballJump.filter((j) => j > m).length * 60) / (end * DT)), hitsBy: truth.filter((t) => t.k === 'hit').length,
    secs: end * DT, agreed, disagreed, rollPerSec: c0.rollbacks / (end * DT), points: truth.filter((t) => t.k === 'point').length,
    depth: [pct(c0.depths, 0.5), pct(c0.depths, 0.95), pct(c0.depths, 1)], replay: [pct(c0.replayMs, 0.5), pct(c0.replayMs, 0.99), pct(c0.replayMs, 1)],
    ballJump: [pct(ballJump, 0.5), pct(ballJump, 0.95), pct(ballJump, 1)], bodyJump: [pct(bodyJump, 0.5), pct(bodyJump, 0.95), pct(bodyJump, 1)],
    stallPct: (100 * waited) / (clients.length * Math.max(1, end)), events,
  };
}

if (process.argv[1]?.endsWith('link-sim.ts')) {
  const secs = +(process.argv[2] ?? 300);
  const FORMAT = { mode: 1, setsToWin: 2, gamesPerSet: 6, finalSet: 0 };
  const base = (seed: number, hum: number[]): MatchConfig => ({ seed, doubles: true, human: [0, 1, 2, 3].map((i) => hum.includes(i)), aiLevel: [0.8, 1], aiStyle: [], timingScale: 1.5, assist: 0.45, autoTiming: false, format: FORMAT } as never);
  for (const [name, hum, seats] of [['2 people, 2 AI', [0, 1], [[0], [1]]], ['4 people', [0, 1, 2, 3], [[0], [1], [2], [3]]]] as Array<[string, number[], number[][]]>) {
    for (const ms of [0, 40, 80, 150]) {
      const delay = ms === 0 ? 0 : Math.min(9, Math.max(3, Math.round((ms * 1.2 * 120) / 1000 / 2)));
      const r = runLink(base(5200000 + ms, hum), seats, ms, ms ? 0.02 : 0, ms ? ms * 0.15 : 0, secs, { delay });
      const ev = Object.entries(r.events).map(([k, v]) => `${k} ${v.truth}/g${v.ghost}/m${v.missed}/+${v.lateMs.toFixed(0)}`).join('  ');
      console.log(`${name}, ${ms} ms, delay ${delay}t: ${r.secs.toFixed(0)} s, ${r.points} pts, agree ${r.agreed}/${r.agreed + r.disagreed}, rewinds/s ${r.rollPerSec.toFixed(1)}, depth t ${r.depth.join('/')}, replay ms ${r.replay.map((x) => x.toFixed(2)).join('/')}, ball jump m ${r.ballJump.map((x) => x.toFixed(2)).join('/')}, per min over .05/.25/.5/1 m ${r.big.map((x) => x.toFixed(1)).join('/')}, body ${r.bodyJump.map((x) => x.toFixed(2)).join('/')}, hits ${r.hitsBy}, stalled ${r.stallPct.toFixed(1)}%`);
      console.log(`   events truth/ghost/missed/+late95ms: ${ev}`);
    }
  }
}
