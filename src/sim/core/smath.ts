// All transcendental maths in the sim goes through here. Math.* trig/exp/log results may differ between
// JS engines; when online play needs bit-exact cross-browser replays, swap these for fixed polynomial versions.
export const sin = Math.sin;
export const cos = Math.cos;
export const atan2 = Math.atan2;
export const exp = Math.exp;
export const log = Math.log;
export const pow = Math.pow;
export const sqrt = Math.sqrt; // IEEE-exact everywhere
export const abs = Math.abs;
export const min = Math.min;
export const max = Math.max;
export const floor = Math.floor;
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
