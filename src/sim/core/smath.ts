// All transcendental maths in the sim goes through here. Math.* trig/exp/log results may differ between
// JS engines; when online play needs bit-exact cross-browser replays, swap these for fixed polynomial versions.
// These are small functions rather than `const sqrt = Math.sqrt` aliases: V8 inlines them and recognises the
// Math builtins inside, whereas a call through an alias returns a boxed number and allocates every time.
export function sin(x: number): number { return Math.sin(x); }
export function cos(x: number): number { return Math.cos(x); }
export function atan2(y: number, x: number): number { return Math.atan2(y, x); }
export function exp(x: number): number { return Math.exp(x); }
export function log(x: number): number { return Math.log(x); }
export function pow(x: number, y: number): number { return Math.pow(x, y); }
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
