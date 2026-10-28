// Which sim functions V8 deoptimises once a match is under way (Phase 8 review, CLAUDE.md's "a tuning field read
// only on a rare branch" trap): doubles with a bot human as player 0 (the human's code paths: charging, aim,
// assisted positioning and timing) and AI for the rest, `warm` seconds of sim time to warm the JIT, then deopts
// counted by source line over `secs` more, across several matches so rare branches come up.
//   node --trace-deopt-verbose tools/sim-deopt.ts [warm 120] [secs 900] [matches 4] 2>&1 | node tools/sim-deopt.ts --report
// The first form prints markers and V8's trace; --report reads it from stdin and counts what came after the warm-up.
import { MatchSim, PH_OVER } from '../src/sim/match.ts';
import { InputFrame } from '../src/sim/input.ts';
import { DT } from '../src/sim/core/constants.ts';
import { BotHuman } from './qa/humans.ts';

if (process.argv[2] === '--report') {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  const lines = text.split('\n');
  let counting = false;
  let pending: { fn: string; why: string } | null = null;
  const rows = new Map<string, { n: number; when: string[] }>();
  let warm = 0, after = 0;
  let when = '';
  for (const l of lines) {
    if (l.startsWith('@@ counting')) { counting = true; continue; }
    if (l.startsWith('@@ warm')) { counting = false; continue; }
    const tm = l.match(/^@@ t (\d+) (\d+)/);
    if (tm) { when = `m${tm[1]} ${tm[2]}s`; continue; }
    if (l.includes('bailout (kind:')) {
      pending = { fn: (l.match(/<JSFunction ([^ >]*)/) ?? [])[1] ?? '?', why: ((l.match(/reason: ([^)]*)\)/) ?? [])[1] ?? '').trim() };
      if (counting) after++; else warm++;
      if (!counting) pending = null;
    } else if (pending && l.includes(';;; deoptimize at')) {
      const at = ((l.match(/deoptimize at <([^>]*)>/) ?? [])[1] ?? '?').replace(/^.*?\/(src|tools)\//, '$1/');
      const k = `${pending.fn} @ ${at} :: ${pending.why}`;
      const r = rows.get(k) ?? { n: 0, when: [] };
      r.n++;
      r.when.push(when);
      rows.set(k, r);
      pending = null;
    }
  }
  console.log(`deoptimisations: ${warm} while warming up, ${after} after it (by match and sim time, 5 s markers)`);
  for (const [k, r] of [...rows].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(r.n).padStart(4)}  ${k}   [${r.when.join(', ')}]`);
} else {
  const warm = Number(process.argv[2] ?? 120);
  const secs = Number(process.argv[3] ?? 900);
  const matches = Number(process.argv[4] ?? 4);
  for (let m = 0; m < matches; m++) {
    console.log(`@@ warm match ${m}`);
    const sim = new MatchSim({ seed: 100 + m, doubles: true, human: [true, false, false, false], assist: 0.45, timingScale: 1.5, aiLevel: [0.55, 0.85] });
    const bot = new BotHuman(0, 7 + m);
    const f = new InputFrame();
    const inputs: (InputFrame | null)[] = [f, null, null, null];
    let t = 0;
    const end = warm + secs;
    for (; t < end && sim.phase !== PH_OVER; t += DT) {
      // Only the first match warms up: later ones count from their first tick (the JIT is warm by then).
      if (m === 0 && Math.abs(t - warm) < DT / 2) console.log('@@ counting');
      if (m > 0 && t === 0) console.log('@@ counting');
      const tick = Math.round(t / DT);
      if (tick % 600 === 0) console.log(`@@ t ${m} ${Math.round(t)}`);
      bot.act(sim, f);
      sim.step(inputs);
    }
    console.log(`@@ match ${m} played ${t.toFixed(0)} s`);
  }
}
