// Cross-machine determinism probe: hashes the exact output bits of the maths functions the sim uses over
// fixed pseudo-random inputs, and the sim's state hash every second of a seeded AI-vs-AI match. Run it on two
// machines and diff the output; the first differing line says which function or which second diverged.
// Usage: node tools/det-probe.ts [seconds]
import { MatchSim } from '../src/sim/match.ts';
import * as sm from '../src/sim/core/smath.ts';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function mix(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0]!, 0x01000193) >>> 0;
  return Math.imul(h ^ u32[1]!, 0x01000193) >>> 0;
}

// Deterministic inputs (integer LCG, no Math.random).
let s = 12345;
function rnd(): number {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return s / 4294967296;
}

const N = 2_000_000;
const fns: Array<[string, () => number]> = [
  ['sin', () => Math.sin((rnd() - 0.5) * 40)],
  ['cos', () => Math.cos((rnd() - 0.5) * 40)],
  ['sinBig', () => Math.sin((rnd() - 0.5) * 4000)],
  ['atan2', () => Math.atan2((rnd() - 0.5) * 100, (rnd() - 0.5) * 100)],
  ['atan', () => Math.atan((rnd() - 0.5) * 200)],
  ['exp', () => Math.exp(rnd() * 60 - 55)],
  ['log', () => Math.log(rnd() * 1e4 + 1e-6)],
  ['pow', () => Math.pow(rnd() * 100 + 1e-3, (rnd() - 0.5) * 6)],
  ['powHalf', () => Math.pow(rnd() * 100, 0.5)],
  ['sqrt', () => Math.sqrt(rnd() * 1e4)],
  ['hypot', () => Math.hypot((rnd() - 0.5) * 100, (rnd() - 0.5) * 100)],
  ['fma-ish', () => { const a = rnd() * 3, b = rnd() * 7, c = rnd() * 11; return a * b + c; }],
  ['sim.sin', () => sm.sin((rnd() - 0.5) * 40)],
  ['sim.cos', () => sm.cos((rnd() - 0.5) * 40)],
  ['sim.atan2', () => sm.atan2((rnd() - 0.5) * 100, (rnd() - 0.5) * 100)],
  ['sim.exp', () => sm.exp(rnd() * 60 - 55)],
  ['sim.log', () => sm.log(rnd() * 1e4 + 1e-6)],
  ['sim.pow', () => sm.pow(rnd() * 100 + 1e-3, (rnd() - 0.5) * 6)],
];
const out: Record<string, string> = {};
for (const [name, f] of fns) {
  s = 12345;
  let h = 0x811c9dc5;
  for (let i = 0; i < N; i++) h = mix(h, f());
  out[name] = h.toString(16);
}
console.log('math', JSON.stringify(out));

const secs = Number(process.argv[2] ?? 300);
const m = new MatchSim({ seed: 7, human: [false, false] });
const hashes: string[] = [];
for (let i = 1; i <= secs * 120; i++) {
  m.step([null, null]);
  if (i % 120 === 0) hashes.push(m.hash().toString(16));
}
console.log('sim', hashes.join(' '));
console.log('node', process.version, process.arch, process.platform);
