// The sim's maths must give the same bits on every machine (engine Math.* does not: see core/fdlibm.ts).
// Accuracy is checked against the engine's functions; determinism by a golden hash of output bits, which
// CI recomputes on Linux x64, so a difference from macOS arm64 fails the build.
import { describe, expect, it } from 'vitest';
import { sin, cos, atan, atan2, exp, log, pow } from '../../src/sim/core/smath.ts';

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
/** Distance in units in the last place between two finite doubles. */
function ulps(a: number, b: number): number {
  if (a === b) return 0;
  f64[0] = a;
  let ia = i64[0]!;
  f64[0] = b;
  let ib = i64[0]!;
  // Map to a monotonic integer line (negatives mirrored).
  if (ia < 0n) ia = -0x8000000000000000n - ia;
  if (ib < 0n) ib = -0x8000000000000000n - ib;
  const d = ia - ib;
  return Number(d < 0n ? -d : d);
}

const u32 = new Uint32Array(f64.buffer);
function mix(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0]!, 0x01000193) >>> 0;
  return Math.imul(h ^ u32[1]!, 0x01000193) >>> 0;
}

let seed = 1;
function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

interface Case { name: string; ours: (a: number, b: number) => number; ref: (a: number, b: number) => number; a: () => number; b: () => number; tol: number }
const cases: Case[] = [
  { name: 'sin', ours: (a) => sin(a), ref: (a) => Math.sin(a), a: () => (rnd() - 0.5) * 40, b: () => 0, tol: 1 },
  { name: 'sin wide', ours: (a) => sin(a), ref: (a) => Math.sin(a), a: () => (rnd() - 0.5) * 2e5, b: () => 0, tol: 1 },
  { name: 'cos', ours: (a) => cos(a), ref: (a) => Math.cos(a), a: () => (rnd() - 0.5) * 40, b: () => 0, tol: 1 },
  { name: 'atan', ours: (a) => atan(a), ref: (a) => Math.atan(a), a: () => (rnd() - 0.5) * 200, b: () => 0, tol: 1 },
  { name: 'atan2', ours: (a, b) => atan2(a, b), ref: (a, b) => Math.atan2(a, b), a: () => (rnd() - 0.5) * 100, b: () => (rnd() - 0.5) * 100, tol: 2 },
  { name: 'exp', ours: (a) => exp(a), ref: (a) => Math.exp(a), a: () => rnd() * 1400 - 700, b: () => 0, tol: 1 },
  { name: 'exp small', ours: (a) => exp(a), ref: (a) => Math.exp(a), a: () => (rnd() - 0.5) * 2, b: () => 0, tol: 1 },
  { name: 'log', ours: (a) => log(a), ref: (a) => Math.log(a), a: () => rnd() * 1e4, b: () => 0, tol: 1 },
  { name: 'log near 1', ours: (a) => log(a), ref: (a) => Math.log(a), a: () => 0.5 + rnd(), b: () => 0, tol: 1 },
  { name: 'pow', ours: (a, b) => pow(a, b), ref: (a, b) => Math.pow(a, b), a: () => rnd() * 10 + 1e-3, b: () => (rnd() - 0.5) * 12, tol: 64 }, // exp(y log x): error grows with |y log x|; set-up only
];

describe('sim maths', () => {
  it.each(cases)('$name is within $tol ulp of the engine', (c) => {
    seed = 1;
    let worst = 0;
    let at = 0;
    for (let i = 0; i < 200000; i++) {
      const a = c.a();
      const b = c.b();
      const u = ulps(c.ours(a, b), c.ref(a, b));
      if (u > worst) { worst = u; at = a; }
    }
    expect(worst, `${c.name} worst at ${at}`).toBeLessThanOrEqual(c.tol);
  });

  it('special values', () => {
    expect(Object.is(sin(0), 0)).toBe(true);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Infinity)).toBeNaN();
    expect(cos(NaN)).toBeNaN();
    expect(sin(Math.PI / 2)).toBe(1);
    expect(cos(Math.PI)).toBe(-1);
    expect(atan(Infinity)).toBe(Math.PI / 2);
    expect(atan(-1)).toBe(-Math.PI / 4);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(Object.is(atan2(-0, 1), -0)).toBe(true);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(atan2(Infinity, -Infinity)).toBe((3 * Math.PI) / 4);
    expect(atan2(1, -Infinity)).toBe(Math.PI);
    expect(atan2(NaN, 1)).toBeNaN();
    expect(exp(0)).toBe(1);
    expect(ulps(exp(1), Math.E)).toBeLessThanOrEqual(1); // fdlibm's exp(1) is famously 1 ulp high
    expect(exp(-Infinity)).toBe(0);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(1000)).toBe(Infinity);
    expect(exp(-1000)).toBe(0);
    expect(exp(-740)).toBeGreaterThan(0); // subnormal
    expect(log(1)).toBe(0);
    expect(log(Math.E)).toBe(1);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(log(Infinity)).toBe(Infinity);
    expect(log(5e-324)).toBeCloseTo(-744.44, 2); // smallest subnormal
    expect(pow(2, 10)).toBeCloseTo(1024, 9);
    expect(pow(0, 2)).toBe(0);
    expect(pow(5, 0)).toBe(1);
    expect(pow(-2, 0.5)).toBeNaN();
  });

  it('gives the same bits on every machine (golden hash; CI checks it on Linux x64)', () => {
    const got: Record<string, string> = {};
    for (const c of cases) {
      seed = 7;
      let h = 0x811c9dc5;
      for (let i = 0; i < 100000; i++) h = mix(h, c.ours(c.a(), c.b()));
      got[c.name] = h.toString(16);
    }
    expect(got).toEqual(GOLDEN);
  });
});

// Output-bit hashes computed on macOS arm64 (2026-10-27). If a deliberate change to core/fdlibm.ts changes
// them, update these, and check CI agrees.
const GOLDEN: Record<string, string> = {
  sin: '47be9917', 'sin wide': 'bd05e35', cos: 'ef1f4f1b', atan: '9395faf4', atan2: '8e16f4fa', exp: '54af3d9',
  'exp small': '51c5e615', log: 'b8314378', 'log near 1': '5ef52fd8', pow: '150eac0f',
};
