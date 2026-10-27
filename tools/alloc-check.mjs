// Runs AI-vs-AI matches under --trace-gc and counts garbage collections during the measured stretch.
// The sim must allocate nothing per tick, so after JIT warm-up the count should be zero.
// Usage: node tools/alloc-check.mjs [ticks] [doubles]   (both formats when the second argument is left out)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--child') {
  const { MatchSim, PH_OVER } = await import('../src/sim/match.ts');
  const ticks = Number(process.argv[3] ?? 100000);
  const doubles = process.argv[4] === 'doubles';
  const make = (seed) => doubles
    ? new MatchSim({ seed, doubles, human: [false, false, false, false] })
    : new MatchSim({ seed, human: [false, false] });
  let m = make(1);
  const inputs = doubles ? [null, null, null, null] : [null, null];
  // Warm-up: let V8 optimise every path (serves, rallies, faults, games, sets).
  for (let i = 0; i < 60000; i++) {
    m.step(inputs);
    if (m.phase === PH_OVER) m = make(i);
  }
  console.log('@@START');
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < ticks; i++) {
    m.step(inputs);
    n++;
    if (m.phase === PH_OVER) break;
  }
  const ms = performance.now() - t0;
  console.log('@@END');
  console.log(`ticks ${n}  ${(ms / n * 1000).toFixed(2)} us/tick  points so far ${m.score.games.join('-')} games`);
} else {
  const ticks = process.argv[2] ?? '100000';
  const self = fileURLToPath(import.meta.url);
  let failed = false;
  for (const mode of process.argv[3] ? [process.argv[3]] : ['singles', 'doubles']) {
    const r = spawnSync(process.execPath, ['--trace-gc', self, '--child', ticks, mode], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = r.stdout + r.stderr;
    const a = out.indexOf('@@START');
    const b = out.indexOf('@@END');
    if (a < 0 || b < 0) {
      console.log(out.slice(-3000));
      process.exit(1);
    }
    const inside = out.slice(a, b).split('\n').filter((l) => /Scavenge|Mark-Compact|Minor|Mark-sweep/i.test(l));
    const tail = out.slice(b).split('\n').filter((l) => l.startsWith('ticks'));
    console.log(`${mode}: ${tail.join('\n')}`);
    // Budget: the sim may cause at most one minor GC per 10k ticks (~83 s of play), each well under a millisecond.
    // Doubles passed into non-inlined functions are boxed by V8, so a few bytes per tick remain; see CLAUDE.md.
    const budget = Math.ceil(Number(ticks) / 10000);
    const worst = Math.max(0, ...inside.map((l) => Number((l.match(/MB, pooled: [\d.]+ MB, ([\d.]+)/) ?? [])[1] ?? 0)));
    console.log(`${mode}: GCs during measured run: ${inside.length} (budget ${budget}), longest ${worst.toFixed(2)} ms`);
    for (const l of inside.slice(0, 3)) console.log('  ' + l.trim());
    if (inside.length > budget || worst >= 1) failed = true;
  }
  process.exit(failed ? 2 : 0);
}
