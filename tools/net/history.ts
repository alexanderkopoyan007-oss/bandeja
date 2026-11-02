// Does a match depend on what this page did before it? Two real clients won't share a history: one sat on the title
// screen's AI match, one just loaded. Each case run alone in a fresh process, and in reverse order after everything
// else, must equal the forward run in tools/out/net/node.json.
//   node tools/net/history.ts            all cases, reverse order, then a fresh process per case
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES, runCase } from './hash-core.ts';

const ref = JSON.parse(readFileSync('tools/out/net/node.json', 'utf8')) as Array<{ samples: number[]; label: string }>;
const same = (i: number, s: number[]) => { const k = ref[i]!.samples.findIndex((h, j) => h !== s[j]); return k < 0 && s.length === ref[i]!.samples.length ? -1 : k; };
if (process.argv[2] === '--one') {
  const i = +process.argv[3]!;
  console.log(same(i, runCase(CASES[i]!).samples));
  process.exit(0);
}
let bad = 0;
for (let i = CASES.length - 1; i >= 0; i--) {
  const k = same(i, runCase(CASES[i]!).samples);
  if (k !== -1) { bad++; console.log('reverse order differs:', CASES[i]!.label, 'sample', k); }
}
console.log('reverse order:', CASES.length - bad, 'of', CASES.length, 'identical');
bad = 0;
const me = fileURLToPath(import.meta.url);
for (let i = 0; i < CASES.length; i++) {
  const r = spawnSync(process.execPath, [me, '--one', String(i)], { encoding: 'utf8' });
  if (r.stdout.trim() !== '-1') { bad++; console.log('fresh process differs:', CASES[i]!.label, r.stdout.trim().slice(0, 40), r.stderr.slice(0, 200)); }
}
console.log('fresh process each:', CASES.length - bad, 'of', CASES.length, 'identical');
