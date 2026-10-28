// The QA bot army (Phase 7): thousands of headless matches across every mode, court, floor, ball, climate, scoring
// format, AI level and style, with AI players, "bot" humans (the human code path played well: keys pressed ahead of
// the ball and released on the cue's moment) and "monkey" humans (random keys, holds, mashing, stale timestamps,
// aim anywhere). Every tick is checked (tools/qa/checks.ts), every call is judged again by the referee and score
// oracles written from the FIP text alone (tools/qa/refereeOracle.ts, scoreOracle.ts), and every problem is logged
// with what reproduces it.
//
//   node --expose-gc tools/qa/army.ts [--matches 2000] [--workers 7] [--seed0 1] [--tag name] [--only 17] [--trace 17:123456]
//                         [--no-oracle] [--max-hours 4]
//
// --only N replays match N alone (same seed0) and prints its anomalies in full; --trace N:tick prints the facts
// and events around that tick. Writes tools/out/army-<tag>.json and docs/qa/army-<tag>.md.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MatchSim } from '../../src/sim/match.ts';
import { makeConfig, matchConfig, describe, type ArmyConfig } from './config.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { BotHuman, MonkeyHuman, type Driver } from './humans.ts';
import { Checks, type Anomaly } from './checks.ts';
import type { Judge as JudgeT } from './judge.ts';

/** The judge needs the oracles; loaded only when they are wanted (and there). */
const Judge: (typeof import('./judge.ts'))['Judge'] | null = process.argv.includes('--no-oracle') && isMainThread ? null
  : await import('./judge.ts').then((m) => m.Judge).catch((e: Error) => { console.error(`oracles unavailable: ${e.message}`); return null; });

// ---- one match -------------------------------------------------------------------------------------------------

export interface MatchReport {
  index: number;
  config: string;
  ok: boolean;
  ticks: number;
  gameSecs: number;
  wallMs: number;
  points: number;
  faults: number;
  lets: number;
  maxTickMs: number;
  slowTicks: number;
  heapMB: number;
  anomalies: Anomaly[];
}

export interface RunOptions {
  oracle: boolean;
  maxHours: number;
  /** Print the facts and events around this tick. */
  trace?: number;
  /** Print each slow tick (--only). */
  slowLog?: boolean;
}

export function runMatch(c: ArmyConfig, o: RunOptions): MatchReport {
  const t0 = performance.now();
  const anomalies: Anomaly[] = [];
  const note = (a: Anomaly): void => { if (anomalies.length < 200) anomalies.push(a); };
  let sim: MatchSim;
  try {
    sim = new MatchSim(matchConfig(c));
  } catch (e) {
    note({ kind: 'crash', detail: `constructor: ${(e as Error).stack ?? e}`, tick: 0, time: 0 });
    return { index: c.index, config: describe(c), ok: false, ticks: 0, gameSecs: 0, wallMs: 0, points: 0, faults: 0, lets: 0, maxTickMs: 0, slowTicks: 0, heapMB: 0, anomalies };
  }
  const n = sim.players.length;
  const drivers: Array<Driver | null> = [];
  const frames: Array<InputFrame | null> = [];
  for (let i = 0; i < n; i++) {
    const h = c.humans[i];
    drivers.push(h === 'bot' ? new BotHuman(i, c.seed + 31 * i) : h === 'monkey' ? new MonkeyHuman(i, c.seed + 37 * i) : null);
    frames.push(h === 'ai' ? null : new InputFrame());
  }
  const checks = new Checks(sim, note);
  const judge: JudgeT | null = o.oracle && Judge ? new Judge(sim, c, note, o.trace) : null;
  const maxTicks = Math.round(o.maxHours * 3600 / DT);
  let maxTickMs = 0;
  let slowTicks = 0;
  let ok = true;
  while (sim.phase !== 4 /* PH_OVER */) {
    if (sim.tick >= maxTicks) {
      note({ kind: 'match-too-long', detail: `not over after ${o.maxHours} h of play: ${sim.score.sets.join('-')} sets, ${sim.score.games.join('-')}`, tick: sim.tick, time: sim.time });
      ok = false;
      break;
    }
    for (let i = 0; i < n; i++) drivers[i]?.act(sim, frames[i]!);
    judge?.beforeStep();
    const a = performance.now();
    try {
      sim.step(frames);
    } catch (e) {
      note({ kind: 'crash', detail: `step: ${(e as Error).stack ?? e}`, tick: sim.tick, time: sim.time });
      ok = false;
      break;
    }
    const ms = performance.now() - a;
    if (sim.tick > 2000) {
      if (ms > maxTickMs) maxTickMs = ms;
      if (ms > 4) {
        slowTicks++;
        if (o.slowLog && slowTicks <= 40) console.log(`  slow tick ${sim.tick}: ${ms.toFixed(2)} ms, phase ${sim.phase}, inNet ${sim.ball.inNet}, coupled ${sim.ball.coupled}, ball ${sim.ball.pos.x.toFixed(2)},${sim.ball.pos.y.toFixed(2)},${sim.ball.pos.z.toFixed(2)}`);
      }
    }
    judge?.afterStep();
    checks.afterStep();
  }
  if (ok) judge?.finish();
  let heapMB = 0;
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) { g(); heapMB = process.memoryUsage().heapUsed / 1048576; }
  return {
    index: c.index, config: describe(c), ok: ok && anomalies.length === 0, ticks: sim.tick, gameSecs: sim.time,
    wallMs: performance.now() - t0, points: judge?.points ?? 0, faults: judge?.faults ?? 0, lets: judge?.lets ?? 0,
    maxTickMs, slowTicks, heapMB, anomalies,
  };
}

// ---- workers and the report ------------------------------------------------------------------------------------

interface Args { matches: number; workers: number; seed0: number; tag: string; only: number; trace: number[]; oracle: boolean; maxHours: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { matches: 200, workers: Math.max(1, availableParallelism() - 2), seed0: 1, tag: 'run', only: -1, trace: [], oracle: true, maxHours: 4 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = argv[i + 1];
    if (k === '--matches') { a.matches = Number(v); i++; }
    else if (k === '--workers') { a.workers = Number(v); i++; }
    else if (k === '--seed0') { a.seed0 = Number(v); i++; }
    else if (k === '--tag') { a.tag = v!; i++; }
    else if (k === '--only') { a.only = Number(v); i++; }
    else if (k === '--trace') { a.trace = v!.split(':').map(Number); i++; }
    else if (k === '--no-oracle') a.oracle = false;
    else if (k === '--max-hours') { a.maxHours = Number(v); i++; }
  }
  return a;
}

function summarise(args: Args, reports: MatchReport[], wallS: number): string {
  const L: string[] = [];
  const total = reports.length;
  const bad = reports.filter((r) => !r.ok);
  const ticks = reports.reduce((s, r) => s + r.ticks, 0);
  const pts = reports.reduce((s, r) => s + r.points, 0);
  const hours = reports.reduce((s, r) => s + r.gameSecs, 0) / 3600;
  const kinds = new Map<string, { n: number; matches: Set<number>; first: { m: number; a: Anomaly } }>();
  for (const r of reports) {
    for (const a of r.anomalies) {
      const key = `${a.kind}: ${a.sig ?? a.detail.slice(0, 90)}`;
      const k = kinds.get(key) ?? { n: 0, matches: new Set<number>(), first: { m: r.index, a } };
      k.n++;
      k.matches.add(r.index);
      kinds.set(key, k);
    }
  }
  L.push(`# QA army: ${args.tag}`, '');
  L.push(`${total} matches (seed0 ${args.seed0}), ${hours.toFixed(1)} h of play, ${(ticks / 1e6).toFixed(1)} M ticks, ${pts} points, in ${(wallS / 60).toFixed(1)} min on ${args.workers} workers. Oracles: ${args.oracle ? 'on' : 'off'}.`, '');
  L.push(`Matches with any problem: ${bad.length}.`, '');
  const maxTick = Math.max(...reports.map((r) => r.maxTickMs));
  const slow = reports.reduce((s, r) => s + r.slowTicks, 0);
  L.push(`Slowest sim tick: ${maxTick.toFixed(2)} ms; ticks over 4 ms: ${slow} (${(slow / ticks * 1e6).toFixed(1)} per million).`, '');
  const heaps = reports.filter((r) => r.heapMB > 0).map((r) => r.heapMB);
  if (heaps.length > 4) L.push(`Heap after each match (after GC): first ${heaps[0]!.toFixed(1)} MB, last ${heaps[heaps.length - 1]!.toFixed(1)} MB, max ${Math.max(...heaps).toFixed(1)} MB.`, '');
  L.push('## Problems by kind', '');
  if (kinds.size === 0) L.push('None.');
  const sorted = [...kinds.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [key, k] of sorted) {
    L.push(`- **${key}** — ${k.n}× in ${k.matches.size} matches; first: match ${k.first.m} tick ${k.first.a.tick} (\`node tools/qa/army.ts --seed0 ${args.seed0} --only ${k.first.m}\`)`);
    L.push(`  - ${k.first.a.detail.replace(/\n/g, ' ').slice(0, 400)}`);
  }
  return L.join('\n') + '\n';
}

if (isMainThread) {
  const args = parseArgs(process.argv.slice(2));
  const opts: RunOptions = { oracle: args.oracle, maxHours: args.maxHours };
  if (args.only >= 0) {
    const c = makeConfig(args.seed0, args.only);
    const r = runMatch(c, { ...opts, slowLog: true, trace: args.trace[0] === args.only ? args.trace[1] : undefined });
    console.log(describe(c));
    console.log(JSON.stringify(c));
    console.log(`ticks ${r.ticks}, ${(r.gameSecs / 60).toFixed(1)} min of play, ${r.points} points, ${r.wallMs.toFixed(0)} ms; slowest tick ${r.maxTickMs.toFixed(2)} ms, ${r.slowTicks} over 4 ms`);
    for (const a of r.anomalies) console.log(`[${a.kind}] tick ${a.tick} t=${a.time.toFixed(3)}: ${a.detail}`);
  } else {
    const t0 = performance.now();
    const reports: MatchReport[] = [];
    let next = 0;
    let done = 0;
    await new Promise<void>((resolve) => {
      const spawn = (): void => {
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { opts, seed0: args.seed0 } });
        let current = -1;
        const feed = (): void => {
          if (next < args.matches) wk.postMessage(current = next++);
          else { current = -1; wk.postMessage(-1); }
        };
        const finished = (): void => {
          done++;
          if (done % 50 === 0) console.log(`${done}/${args.matches} matches, ${((performance.now() - t0) / 60000).toFixed(1)} min`);
          if (done >= args.matches) resolve();
        };
        wk.on('message', (r: MatchReport) => {
          reports.push(r);
          if (!r.ok) console.log(`match ${r.index}: ${r.anomalies.length} problems (${r.anomalies[0]?.kind}: ${r.anomalies[0]?.detail.slice(0, 120)})`);
          finished();
          feed();
        });
        wk.on('error', (e) => {
          // A worker that dies (out of memory, a throw outside the match) costs its match, not the run.
          if (current >= 0) {
            const c = makeConfig(args.seed0, current);
            reports.push({ index: current, config: describe(c), ok: false, ticks: 0, gameSecs: 0, wallMs: 0, points: 0, faults: 0, lets: 0, maxTickMs: 0, slowTicks: 0, heapMB: 0,
              anomalies: [{ kind: 'crash', sig: 'worker', detail: `worker died: ${(e as Error).stack ?? e}`, tick: 0, time: 0 }] });
            finished();
            if (next < args.matches) spawn();
          }
        });
        feed();
      };
      for (let w = 0; w < Math.min(args.workers, args.matches); w++) spawn();
    });
    reports.sort((a, b) => a.index - b.index);
    const wallS = (performance.now() - t0) / 1000;
    const md = summarise(args, reports, wallS);
    mkdirSync('tools/out', { recursive: true });
    mkdirSync('docs/qa', { recursive: true });
    writeFileSync(`tools/out/army-${args.tag}.json`, JSON.stringify({ args, reports }, null, 1));
    writeFileSync(`docs/qa/army-${args.tag}.md`, md);
    console.log(md);
  }
} else {
  const { opts, seed0 } = workerData as { opts: RunOptions; seed0: number };
  parentPort!.on('message', (index: number) => {
    if (index < 0) { process.exit(0); }
    parentPort!.postMessage(runMatch(makeConfig(seed0, index), opts));
  });
}
