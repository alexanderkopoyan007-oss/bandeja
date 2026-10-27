// All transcendental maths in the sim goes through here, and it must be bit-exact on every machine: replays
// and (later) online play depend on the same inputs giving the same rally everywhere. Math.sin/cos/atan2/
// exp/log/pow are NOT: their last bits differ between CPUs and OSes, so they are replaced by fdlibm ports
// (core/fdlibm.ts). sqrt, abs, floor and plain arithmetic are exact by the IEEE / ECMAScript spec.
// These are small functions rather than `const sqrt = Math.sqrt` aliases: V8 inlines them and recognises the
// Math builtins inside, whereas a call through an alias returns a boxed number and allocates every time.
import { IO, sinIO, cosIO, atanIO, atan2IO, expIO, logIO, powIO } from './fdlibm.ts';

export function sin(x: number): number { IO[0] = x; sinIO(); return IO[0]!; }
export function cos(x: number): number { IO[0] = x; cosIO(); return IO[0]!; }
export function atan(x: number): number { IO[0] = x; atanIO(); return IO[0]!; }
export function atan2(y: number, x: number): number { IO[0] = y; IO[1] = x; atan2IO(); return IO[0]!; }
export function exp(x: number): number { IO[0] = x; expIO(); return IO[0]!; }
export function log(x: number): number { IO[0] = x; logIO(); return IO[0]!; }
export function pow(x: number, y: number): number { IO[0] = x; IO[1] = y; powIO(); return IO[0]!; }
export function sqrt(x: number): number { return Math.sqrt(x); } // IEEE-exact everywhere
export function abs(x: number): number { return x < 0 ? -x : x; }
export function min(a: number, b: number): number { return a < b ? a : b; }
export function max(a: number, b: number): number { return a > b ? a : b; }
export function floor(x: number): number { return Math.floor(x); }
export const PI = Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sign(v: number): number {
  return v < 0 ? -1 : 1;
}
