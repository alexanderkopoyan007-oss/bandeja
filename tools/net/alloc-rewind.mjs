// Garbage from rollback: an AI match with a snapshot every `gap` ticks into a ring and a 12-tick rewind every 30 ticks,
// under --trace-gc, against the same match with neither. The sim's budget is 10 scavenges in 100k ticks (npm run alloc).
//   node tools/net/alloc-rewind.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--child') {
  const { MatchSim, PH_OVER } = await import('../../src/sim/match.ts');
  const ticks = +process.argv[3], gap = +process.argv[4];
  const cfg = { seed: 77, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] };
  const t0 = performance.now();
  const ring = gap ? Array.from({ length: Math.ceil(24 / gap) + 1 }, () => new MatchSim(cfg)) : [];
  const built = gap ? (performance.now() - t0) / ring.length : 0;
  let m = new MatchSim(cfg);
  const none = [null, null, null, null];
  const step = (n) => { for (let i = 0; i < n; i++) { if (m.phase === PH_OVER) m = new MatchSim({ ...cfg, seed: m.tick + 1 }); m.step(none); } };
  step(20000);
  console.log('MEASURE');
  let at = 0, copies = 0, rewinds = 0;
  const t1 = performance.now();
  for (let t = 0; t < ticks; t++) {
    if (gap && t % gap === 0) { ring[at]?.copyFrom(m); at = (at + 1) % ring.length; copies++; }
    step(1);
    if (gap && t % 30 === 29) {
      const back = ring[(at - 3 + ring.length * 2) % ring.length];
      m.copyFrom(back);
      step(2 * gap);
      rewinds++;
    }
  }
  console.log(`END gap ${gap}: ${copies} copies, ${rewinds} rewinds, ${(performance.now() - t1).toFixed(0)} ms, one snapshot sim built in ${built.toFixed(1)} ms, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
  process.exit(0);
}
const me = fileURLToPath(import.meta.url);
for (const gap of [0, 1, 4]) {
  const r = spawnSync(process.execPath, ['--trace-gc', me, '--child', '100000', String(gap)], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout.split('\n');
  const a = out.findIndex((l) => l === 'MEASURE'), b = out.findIndex((l) => l.startsWith('END'));
  const mid = out.slice(a, b);
  const ms = (l) => { const m = l.match(/MB, (?:pooled: [0-9.]+ MB, )?([0-9.]+) \/ [0-9.]+ ms/); return m ? +m[1] : 0; };
  const sum = (k) => { const v = mid.filter((l) => l.includes(k)).map(ms); return `${v.length} (total ${v.reduce((p, c) => p + c, 0).toFixed(0)} ms, longest ${Math.max(0, ...v).toFixed(1)})`; };
  console.log(out[b] ?? r.stderr.slice(0, 400), '| scavenges', sum('Scavenge'), '| mark-compacts', sum('Mark-Compact'));
}
