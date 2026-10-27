// Seeded PRNG (sfc32). State is four uint32s so it snapshots and restores exactly.
import { cos, log, sqrt, PI } from './smath.ts';

export class Rng {
  readonly s = new Uint32Array(4);

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    const s = this.s;
    s[0] = 0x9e3779b9;
    s[1] = 0x243f6a88;
    s[2] = 0xb7e15162;
    s[3] = seed >>> 0;
    for (let i = 0; i < 16; i++) this.nextU32();
  }

  nextU32(): number {
    const s = this.s;
    const t = (((s[0]! + s[1]!) >>> 0) + s[3]!) >>> 0;
    s[3] = (s[3]! + 1) >>> 0;
    s[0] = s[1]! ^ (s[1]! >>> 9);
    s[1] = (s[2]! + (s[2]! << 3)) >>> 0;
    s[2] = ((s[2]! << 21) | (s[2]! >>> 11)) >>> 0;
    s[2] = (s[2]! + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Standard normal (Box–Muller, one value per call). */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return sqrt(-2 * log(u)) * cos(2 * PI * v);
  }
}
