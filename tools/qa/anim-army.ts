// The animation army (Phase 7): the animated bodies (src/render/avatar, no browser) played through many of the QA
// army's configurations: singles and doubles, every court, styles, levels, left-handers, and bot and monkey humans
// (random keys make strokes start, stop and change in ways the AI never does). Each run is measured by
// src/render/avatar/animQa.ts and judged against the thresholds tests/render/animQa.test.ts holds for AI play.
//
//   node tools/qa/anim-army.ts [--configs 40] [--secs 60] [--workers 6] [--seed0 1] [--tag name] [--only N]
//
// Writes tools/out/anim-army-<tag>.json and docs/qa/anim-army-<tag>.md.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa, type QaReport } from '../../src/render/avatar/animQa.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { makeConfig, matchConfig, describe, type ArmyConfig } from './config.ts';
import { BotHuman, MonkeyHuman, type Driver } from './humans.ts';

export interface AnimResult {
  index: number;
  config: string;
  humans: string;
  wallS: number;
  fails: string[];
  crash?: string;
  /** The numbers the verdict reads. */
  n: {
    skate: number; below: number; planted50: number; dist50: number; dist90: number; lag50: number; pops: number;
    racketBody: number; handTorso: number; legs: number; serveHand: number; serveRacket: number; servePops: number;
    flips: number; fastest: number; kneeSpins: number; repeatDeg: number; nan: number; hits: number;
  };
  worst: string[];
}

/** The verdict: tests/render/animQa.test.ts's thresholds (AI play), the contact ones only where an AI swung. */
function judge(r: QaReport, humans: boolean): { fails: string[]; n: AnimResult['n'] } {
  const flips = r.pops.worst.filter((e) => e.value >= 105).length;
  let fastest = 0;
  for (const p of Object.values(r.pops.peaks)) fastest = Math.max(fastest, p.max / 120);
  const n = {
    skate: r.feet.skate, below: r.feet.belowShare, planted50: r.feet.planted.p50, dist50: r.contact.dist.p50,
    dist90: r.contact.dist.p90, lag50: r.contact.lag.p50, pops: r.pops.perMinute, racketBody: r.clip.racketBody,
    handTorso: r.clip.handTorso, legs: r.clip.legs, serveHand: r.serve.handTorso, serveRacket: r.serve.racketBody,
    servePops: r.serve.popsPerMinute, flips, fastest, kneeSpins: r.pops.kneeSpins.length, repeatDeg: r.repeat.maxDeg,
    nan: r.nan, hits: r.contact.hits,
  };
  const fails: string[] = [];
  const over = (what: string, v: number, lim: number): void => { if (!(v < lim)) fails.push(`${what} ${v.toFixed(3)} (limit ${lim})`); };
  over('skate cm/s', n.skate, 25);
  over('soles below floor share', n.below, 0.001);
  over('planted sole p50 cm/s', n.planted50, 0.01);
  if (n.hits >= 10) {
    over('racket-ball p50 m', n.dist50, humans ? 0.03 : 0.015);
    over('racket-ball p90 m', n.dist90, humans ? 0.2 : 0.12);
    over('contact lag p50 s', n.lag50, humans ? 0.017 : 0.009);
  }
  over('pops per min', n.pops, 30);
  over('racket in body share', n.racketBody, 0.01);
  over('hand in torso share', n.handTorso, 0.035);
  over('legs through share', n.legs, 0.05);
  over('serve hand in torso', n.serveHand, 0.005);
  over('serve racket in body', n.serveRacket, 0.015);
  over('serve pops per min', n.servePops, 25);
  if (flips) fails.push(`${flips} one-frame flips of 105° or more`);
  over('fastest one-frame turn °', n.fastest, 105);
  if (n.kneeSpins) fails.push(`${n.kneeSpins} knee spins`);
  over('same moment drawn twice °', n.repeatDeg, 0.01);
  if (n.nan) fails.push(`${n.nan} NaN frames`);
  return { fails, n };
}

function loadAsset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

export function runOne(asset: ReturnType<typeof loadAsset>, c: ArmyConfig, secs: number): AnimResult {
  const t0 = performance.now();
  const n = c.doubles ? 4 : 2;
  const drivers: Array<Driver | null> = [];
  const frames: Array<InputFrame | null> = [];
  for (let i = 0; i < n; i++) {
    const h = c.humans[i];
    drivers.push(h === 'bot' ? new BotHuman(i, c.seed + 31 * i) : h === 'monkey' ? new MonkeyHuman(i, c.seed + 37 * i) : null);
    frames.push(h === 'ai' ? null : new InputFrame());
  }
  const humans = c.humans.some((h) => h !== 'ai');
  const base = { index: c.index, config: describe(c), humans: c.humans.join(','), wallS: 0 };
  try {
    const r = runAnimQa(asset, {
      seed: c.seed, seconds: secs, doubles: c.doubles, lefty: c.lefty, repeatEvery: 7, match: matchConfig(c),
      inputs: (m) => { for (let i = 0; i < n; i++) drivers[i]?.act(m, frames[i]!); return frames; },
    });
    const { fails, n: nums } = judge(r, humans);
    const f = (x: number): string => x.toFixed(1);
    const worst = [
      ...r.pops.worst.slice(0, 3).map((e) => `pop ${e.what} p${e.player} t=${f(e.t)} ${f(e.value)}°`),
      ...r.pops.turnWorst.slice(0, 2).map((e) => `turn ${e.what} p${e.player} t=${f(e.t)} ${f(e.value)}°`),
      ...r.pops.kneeSpins.slice(0, 2).map((e) => `knee ${e.what} p${e.player} t=${f(e.t)} ${f(e.value)}°`),
      ...r.clip.worst.slice(0, 3).map((e) => `clip ${e.what} p${e.player} t=${f(e.t)}${e.value ? ' ' + f(e.value * 100) + ' cm' : ''}`),
      ...r.contact.worst.slice(0, 2).map((e) => `contact ${e.what} p${e.player} t=${f(e.t)} ${f(e.value * 100)} cm`),
    ];
    return { ...base, wallS: (performance.now() - t0) / 1000, fails, n: nums, worst };
  } catch (e) {
    const z = { skate: 0, below: 0, planted50: 0, dist50: 0, dist90: 0, lag50: 0, pops: 0, racketBody: 0, handTorso: 0, legs: 0, serveHand: 0, serveRacket: 0, servePops: 0, flips: 0, fastest: 0, kneeSpins: 0, repeatDeg: 0, nan: 0, hits: 0 };
    return { ...base, wallS: (performance.now() - t0) / 1000, fails: ['crash'], crash: String((e as Error).stack ?? e), n: z, worst: [] };
  }
}

interface Args { configs: number; secs: number; workers: number; seed0: number; tag: string; only: number }

function parse(): Args {
  const a: Args = { configs: 40, secs: 60, workers: Math.max(1, availableParallelism() - 4), seed0: 1, tag: 'run', only: -1 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i], x = v[i + 1];
    if (k === '--configs') { a.configs = Number(x); i++; }
    else if (k === '--secs') { a.secs = Number(x); i++; }
    else if (k === '--workers') { a.workers = Number(x); i++; }
    else if (k === '--seed0') { a.seed0 = Number(x); i++; }
    else if (k === '--tag') { a.tag = String(x); i++; }
    else if (k === '--only') { a.only = Number(x); i++; }
  }
  return a;
}

function report(args: Args, rs: AnimResult[], wallS: number): string {
  const L: string[] = [];
  const bad = rs.filter((r) => r.fails.length);
  L.push(`# Animation army: ${args.tag}`, '');
  L.push(`\`node tools/qa/anim-army.ts --configs ${args.configs} --secs ${args.secs} --seed0 ${args.seed0}\`: ${rs.length} configurations x ${args.secs} s of play with the animated bodies (${(rs.length * args.secs / 60).toFixed(0)} min), ${(wallS / 60).toFixed(1)} min on ${args.workers} workers. Judged on tests/render/animQa.test.ts's thresholds (contact limits doubled where a bot or monkey human plays).`, '');
  L.push(`**${bad.length} of ${rs.length} configurations fail a threshold.**`, '');
  const by: Record<string, number> = {};
  for (const r of bad) for (const f of r.fails) { const k = f.replace(/ [-\d.]+ \(limit.*$/, '').replace(/^\d+ /, ''); by[k] = (by[k] ?? 0) + 1; }
  if (bad.length) {
    L.push('| Failure | Configurations |', '|---|---|');
    for (const [k, v] of Object.entries(by).sort((x, y) => y[1] - x[1])) L.push(`| ${k} | ${v} |`);
    L.push('');
  }
  L.push('| # | Configuration | Skate | Pops/min | Racket-ball p50/p90 (cm) | Racket in body | Hand in torso | Legs | Fastest turn (°) | Knee spins | Fails |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const pc = (x: number): string => (100 * x).toFixed(2) + '%';
  for (const r of rs) {
    const n = r.n;
    L.push(`| ${r.index} | ${r.config} | ${n.skate.toFixed(1)} | ${n.pops.toFixed(1)} | ${(n.dist50 * 100).toFixed(1)} / ${(n.dist90 * 100).toFixed(1)} | ${pc(n.racketBody)} | ${pc(n.handTorso)} | ${pc(n.legs)} | ${n.fastest.toFixed(0)} | ${n.kneeSpins} | ${r.fails.join('; ') || 'ok'} |`);
  }
  if (bad.length) {
    L.push('', '## Worst moments in the failing runs', '');
    for (const r of bad) L.push(`- #${r.index}: ${r.crash ? 'crash: ' + r.crash.split('\n')[0] : r.worst.join(', ')}`);
  }
  return L.join('\n') + '\n';
}

if (isMainThread) {
  const args = parse();
  const ids = args.only >= 0 ? [args.only] : Array.from({ length: args.configs }, (_, i) => i);
  const results: AnimResult[] = [];
  const t0 = performance.now();
  let next = 0;
  const nw = Math.min(args.workers, ids.length);
  await new Promise<void>((done) => {
    let live = nw;
    for (let w = 0; w < nw; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { secs: args.secs } });
      const feed = (): void => {
        if (next >= ids.length) { worker.postMessage(null); return; }
        worker.postMessage(makeConfig(args.seed0, ids[next++]!));
      };
      worker.on('message', (r: AnimResult) => {
        results.push(r);
        process.stderr.write(`${r.index}: ${r.fails.length ? r.fails.join('; ') : 'ok'} (${r.wallS.toFixed(0)} s)\n`);
        feed();
      });
      worker.on('error', (e: Error) => { process.stderr.write(`worker error: ${e.stack}\n`); });
      worker.on('exit', () => { if (--live === 0) done(); });
      feed();
    }
  });
  results.sort((a, b) => a.index - b.index);
  const md = report(args, results, (performance.now() - t0) / 1000);
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  mkdirSync(new URL('../../docs/qa/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../out/anim-army-${args.tag}.json`, import.meta.url), JSON.stringify(results, null, 1) + '\n');
  writeFileSync(new URL(`../../docs/qa/anim-army-${args.tag}.md`, import.meta.url), md);
  console.log(md.split('\n').slice(0, 14).join('\n'));
} else {
  const asset = loadAsset();
  const secs = (workerData as { secs: number }).secs;
  parentPort!.on('message', (c: ArmyConfig | null) => {
    if (!c) { process.exit(0); }
    parentPort!.postMessage(runOne(asset, c, secs));
  });
}
