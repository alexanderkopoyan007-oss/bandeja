// Rewind safety for rollback: one match stepped straight (A), and the same match (B) that keeps guessing a seat's inputs,
// runs on the guess, rewinds with copyFrom and replays the true inputs, as a client does when a late packet arrives.
// After every replay B must be A: same hash, and every number in the two objects the same (the hash lists fields; this
// walks all of them, so a field left out of copyFrom can't hide). Used by tests/net/rewind.test.ts and on its own:
//   node tools/net/rewind.ts [matches]
import { MatchSim, E_FAULT, E_MATCH, E_POINT, PH_OVER, PH_SETUP, PH_TOSS } from '../../src/sim/match.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { CASES, Hands, type HashCase } from './hash-core.ts';

const STATIC = /^(world|cfg|tuning|spec|def|court|surfaces|TIMING)$/;

/** Every path where two objects' numbers, booleans or structures differ. */
export function deepDiff(a: unknown, b: unknown, skip: RegExp, path = '', seen = new Set<object>(), out: string[] = [], limit = 20): string[] {
  if (out.length >= limit) return out;
  if (typeof a === 'function' || typeof b === 'function') return out;
  if (a === b) return out;
  if (typeof a === 'number' && typeof b === 'number') { if (Number.isNaN(a) && Number.isNaN(b)) return out; out.push(`${path}: ${a} v ${b}`); return out; }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) { out.push(`${path}: ${String(a)} v ${String(b)}`); return out; }
  if (seen.has(a)) return out;
  seen.add(a);
  if (ArrayBuffer.isView(a)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(Number.isNaN(x[i]) && Number.isNaN(y[i]))) { out.push(`${path}[${i}]: ${x[i]} v ${y[i]}`); break; }
    return out;
  }
  for (const k of Object.keys(a)) {
    if (skip.test(k)) continue;
    deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], skip, path ? `${path}.${k}` : k, seen, out, limit);
  }
  return out;
}

/** What one tick's seat did, kept to be replayed. */
interface Frame { x: number; y: number; held: number; ev: Array<[boolean, number, number]> }
const take = (f: InputFrame): Frame => ({ x: f.moveX, y: f.moveY, held: f.held, ev: Array.from({ length: f.evCount }, (_, i) => [f.ev[i]!.press, f.ev[i]!.button, f.ev[i]!.t] as [boolean, number, number]) });
const put = (f: InputFrame, r: Frame): InputFrame => {
  f.clear();
  f.moveX = r.x;
  f.moveY = r.y;
  for (const e of r.ev) f.push(e[0], e[1], e[2]);
  f.held = r.held;
  return f;
};

export interface RewindResult { label: string; ticks: number; rewinds: number; deep: number; hashBad: number; firstBad: string; diffs: string[]; onEvents: number; wrongPress: number }

export function rewindRun(c: HashCase, opts: { depth?: number; every?: number; deepEvery?: number; limit?: number } = {}): RewindResult {
  const depth = opts.depth ?? 12, every = opts.every ?? 17, deepEvery = opts.deepEvery ?? 25, limit = opts.limit ?? 120 * 3600 * 3;
  // (a throwaway first: the first build in a climate settles the net and keeps that solver's scratch, which no later step reads)
  new MatchSim(c.cfg);
  const A = new MatchSim(c.cfg), B = new MatchSim(c.cfg), S = new MatchSim(c.cfg);
  const n = c.cfg.human.length;
  const hands = c.cfg.human.map((h, i) => (h ? new Hands(c.cfg.seed + i * 977) : null));
  const M = A as never as { score: { serverPlayer(): number } };
  const f0 = Array.from({ length: n }, () => new InputFrame());
  const none: Array<InputFrame | null> = hands.map(() => null);
  const ring: Frame[][] = [];
  const res: RewindResult = { label: c.label, ticks: 0, rewinds: 0, deep: 0, hashBad: 0, firstBad: '', diffs: [], onEvents: 0, wrongPress: 0 };
  let seen = 0, tick = 0, since = 0, last = hands.map(() => ({ x: 0, y: 0, held: 0, ev: [] }) as Frame), want = false;
  S.copyFrom(B);
  for (; tick < limit && A.phase !== PH_OVER; tick++) {
    const srv = M.score.serverPlayer();
    const frames: Frame[] = [];
    const inA = none.slice();
    for (let i = 0; i < n; i++) {
      if (!hands[i]) continue;
      const f = hands[i]!.frame(A, i, tick, (A.phase === PH_SETUP || A.phase === PH_TOSS) && srv === i);
      inA[i] = f;
      frames[i] = take(f);
    }
    A.step(inA);
    while (seen < A.eventSeq) {
      const e = A.events[seen % A.events.length]!;
      seen++;
      if (e.player >= 0 && e.kind === 1 && hands[e.player]) hands[e.player]!.hit(tick);
      // (the events a rewind must cross: the very tick a point, a fault or the match ends)
      if (e.kind === E_POINT || e.kind === E_FAULT || e.kind === E_MATCH) { want = true; res.onEvents++; }
    }
    // B runs on a guess: what each seat was last seen doing, with no presses. A real client can't see a press coming.
    const inB = none.slice();
    for (let i = 0; i < n; i++) {
      if (!hands[i]) continue;
      if (frames[i]!.ev.length) res.wrongPress++;
      inB[i] = put(f0[i]!, { x: last[i]!.x, y: last[i]!.y, held: last[i]!.held, ev: [] });
    }
    B.step(inB);
    ring.push(frames);
    since++;
    if (since >= depth + (want ? 0 : every)) {
      // The late packet arrives: back to the snapshot, the true inputs replayed.
      B.copyFrom(S);
      for (const fr of ring) {
        const inR = none.slice();
        for (let i = 0; i < n; i++) if (hands[i]) inR[i] = put(f0[i]!, fr[i]!);
        B.step(inR);
      }
      ring.length = 0;
      since = 0;
      want = false;
      res.rewinds++;
      if (A.hash() !== B.hash()) { res.hashBad++; res.firstBad ||= `tick ${tick}`; }
      if (res.rewinds % deepEvery === 1 && res.diffs.length === 0) {
        res.deep++;
        res.diffs = deepDiff(A, B, STATIC);
      }
      S.copyFrom(B);
    }
    for (let i = 0; i < n; i++) if (hands[i]) last[i] = frames[i]!;
  }
  res.ticks = tick;
  return res;
}

if (process.argv[1]?.endsWith('rewind.ts')) {
  const n = +(process.argv[2] ?? CASES.length);
  for (const c of CASES.slice(0, n)) {
    const t0 = Date.now();
    const r = rewindRun(c);
    console.log(c.label.padEnd(42), r.ticks, 'ticks', r.rewinds, 'rewinds', r.onEvents, 'at points', r.wrongPress, 'presses missed', r.deep, 'full compares', 'hash bad', r.hashBad, r.firstBad, r.diffs.length ? `\n   ${r.diffs.join('\n   ')}` : '', `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
