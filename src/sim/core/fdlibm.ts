// Bit-exact transcendental functions for the sim: ports of fdlibm (via musl) that use only IEEE-754
// double arithmetic (+ - * /, which JS defines exactly, with no fused multiply-add) and bit access through
// a typed-array view. Math.sin/cos/atan/atan2/exp/log/pow give different bits on different CPUs and OSes
// (measured 2026-10-27 with Node 24: macOS arm64, Linux arm64 and Linux x64 all disagree), which made the
// same seed and inputs play out differently on GitHub's Linux runner than on a Mac. These give the same
// bits everywhere. Accuracy is fdlibm's (< 1 ulp); sin/cos reduce arguments exactly up to |x| ~ 1.6e6.
//
// Calling convention: arguments go in IO[0] (and IO[1]) and the result comes back in IO[0]; use the
// wrappers in smath.ts. These functions are too big for V8 to inline, and a double passed to or returned
// from a call that is not inlined is boxed: one heap number per call, which put the sim over its GC
// budget. Typed-array slots hold raw doubles, so nothing is allocated. Not re-entrant (nothing here is).
//
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
F[0] = 1;
const HI = U[1] === 0x3ff00000 ? 1 : 0; // index of the high word (1 on little-endian machines)
const LO = 1 - HI;

/** Arguments in, result out (see above). */
export const IO = new Float64Array(2);
/** Reduction result: x = n*pi/2 + (T[0] + T[1]); also the kernels' inputs. */
const T = new Float64Array(2);

/** High 32 bits of x as an unsigned integer. */
function hiWord(x: number): number {
  F[0] = x;
  return U[HI]!;
}
function loWord(x: number): number {
  F[0] = x;
  return U[LO]!;
}
function fromWords(hi: number, lo: number): number {
  U[HI] = hi;
  U[LO] = lo;
  return F[0]!;
}

// ---- sin / cos -------------------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

/** IO[0] = +-sin(x + y) for |x| <= pi/4, (x, y) in T (k_sin.c). */
function kSin(iy: number, neg: boolean): void {
  const x = T[0]!;
  const y = T[1]!;
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  const out = iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
  IO[0] = neg ? -out : out;
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** IO[0] = +-cos(x + y) for |x| <= pi/4, (x, y) in T (k_cos.c). */
function kCos(neg: boolean): void {
  const x = T[0]!;
  const y = T[1]!;
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1.0 - hz;
  const out = w + (((1.0 - w) - hz) + (z * r - x * y));
  IO[0] = neg ? -out : out;
}

const TOINT = 6755399441055744.0; // 1.5 / DBL_EPSILON
const PIO4 = 7.85398163397448278999e-01;
const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/**
 * Cody-Waite reduction of x = IO[0] by pi/2 into T, returning n (the "medium" path of e_rem_pio2.c, used
 * here for every size: exact for |x| < 2^20 * pi/2, still deterministic, if less accurate, beyond).
 */
function remPio2(ix: number): number {
  const x = IO[0]!;
  let fn = x * INVPIO2 + TOINT - TOINT;
  let n = fn | 0;
  let r = x - fn * PIO2_1;
  let w = fn * PIO2_1T;
  if (r - w < -PIO4) {
    n--;
    fn--;
    r = x - fn * PIO2_1;
    w = fn * PIO2_1T;
  } else if (r - w > PIO4) {
    n++;
    fn++;
    r = x - fn * PIO2_1;
    w = fn * PIO2_1T;
  }
  let y0 = r - w;
  const ex = ix >>> 20;
  let ey = (hiWord(y0) >>> 20) & 0x7ff;
  if (ex - ey > 16) {
    let t = r;
    w = fn * PIO2_2;
    r = t - w;
    w = fn * PIO2_2T - ((t - r) - w);
    y0 = r - w;
    ey = (hiWord(y0) >>> 20) & 0x7ff;
    if (ex - ey > 49) {
      t = r;
      w = fn * PIO2_3;
      r = t - w;
      w = fn * PIO2_3T - ((t - r) - w);
      y0 = r - w;
    }
  }
  T[0] = y0;
  T[1] = (r - y0) - w;
  return n;
}

/** IO[0] = sin(IO[0]). */
export function sinIO(): void {
  const x = IO[0]!;
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return; // |x| < 2^-26: sin x = x
    T[0] = x;
    T[1] = 0;
    kSin(0, false);
    return;
  }
  if (ix >= 0x7ff00000) { IO[0] = x - x; return; } // NaN or infinity
  const n = remPio2(ix) & 3;
  if (n === 0) kSin(1, false);
  else if (n === 1) kCos(false);
  else if (n === 2) kSin(1, true);
  else kCos(true);
}

/** IO[0] = cos(IO[0]). */
export function cosIO(): void {
  const x = IO[0]!;
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) { IO[0] = 1.0; return; } // |x| < 2^-27 * sqrt(2)
    T[0] = x;
    T[1] = 0;
    kCos(false);
    return;
  }
  if (ix >= 0x7ff00000) { IO[0] = x - x; return; }
  const n = remPio2(ix) & 3;
  if (n === 0) kCos(false);
  else if (n === 1) kSin(1, true);
  else if (n === 2) kCos(true);
  else kSin(1, false);
}

// ---- atan / atan2 ----------------------------------------------------------------------------------------

const ATANHI0 = 4.63647609000806093515e-01;
const ATANHI1 = 7.85398163397448278999e-01;
const ATANHI2 = 9.82793723247329054082e-01;
const ATANHI3 = 1.57079632679489655800e+00;
const ATANLO0 = 2.26987774529616870924e-17;
const ATANLO1 = 3.06161699786838301793e-17;
const ATANLO2 = 1.39033110312309984516e-17;
const ATANLO3 = 6.12323399573676603587e-17;
const AT0 = 3.33333333333329318027e-01;
const AT1 = -1.99999999998764832476e-01;
const AT2 = 1.42857142725034663711e-01;
const AT3 = -1.11111104054623557880e-01;
const AT4 = 9.09088713343650656196e-02;
const AT5 = -7.69187620504482999495e-02;
const AT6 = 6.66107313738753120669e-02;
const AT7 = -5.83357013379057348645e-02;
const AT8 = 4.97687799461593236017e-02;
const AT9 = -3.65315727442169155270e-02;
const AT10 = 1.62858201153657823623e-02;

/** IO[0] = atan(IO[0]). */
export function atanIO(): void {
  let x = IO[0]!;
  const hx = hiWord(x);
  const neg = hx >>> 31 !== 0;
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (x === x) IO[0] = neg ? -ATANHI3 : ATANHI3;
    return;
  }
  let id: number;
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e400000) return; // |x| < 2^-27: atan x = x
    id = -1;
  } else {
    x = neg ? -x : x;
    if (ix < 0x3ff30000) { // |x| < 1.1875
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); } // 7/16 <= |x| < 11/16
      else { id = 1; x = (x - 1.0) / (x + 1.0); } // 11/16 <= |x| < 19/16
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); } // |x| < 2.4375
    else { id = 3; x = -1.0 / x; }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) { IO[0] = x - x * (s1 + s2); return; }
  const hi = id === 0 ? ATANHI0 : id === 1 ? ATANHI1 : id === 2 ? ATANHI2 : ATANHI3;
  const lo = id === 0 ? ATANLO0 : id === 1 ? ATANLO1 : id === 2 ? ATANLO2 : ATANLO3;
  const r = hi - (x * (s1 + s2) - lo - x);
  IO[0] = neg ? -r : r;
}

const PI = 3.1415926535897931160e+00;
const PI_LO = 1.2246467991473531772e-16;

/** IO[0] = atan2(y = IO[0], x = IO[1]). */
export function atan2IO(): void {
  const y = IO[0]!;
  const x = IO[1]!;
  if (x !== x || y !== y) { IO[0] = x + y; return; }
  let ix = hiWord(x);
  const lx = loWord(x);
  let iy = hiWord(y);
  const ly = loWord(y);
  if (ix === 0x3ff00000 && lx === 0) { // x = 1.0
    IO[0] = y;
    atanIO();
    return;
  }
  const m = ((iy >>> 31) & 1) | ((ix >>> 30) & 2); // 2*sign(x) + sign(y)
  ix &= 0x7fffffff;
  iy &= 0x7fffffff;
  if ((iy | ly) === 0) { // y = 0
    IO[0] = m <= 1 ? y : m === 2 ? PI : -PI;
    return;
  }
  if ((ix | lx) === 0) { IO[0] = (m & 1) !== 0 ? -PI / 2 : PI / 2; return; } // x = 0
  if (ix === 0x7ff00000) { // x infinite
    if (iy === 0x7ff00000) IO[0] = m === 0 ? PI / 4 : m === 1 ? -PI / 4 : m === 2 ? (3 * PI) / 4 : (-3 * PI) / 4;
    else IO[0] = m === 0 ? 0.0 : m === 1 ? -0.0 : m === 2 ? PI : -PI;
    return;
  }
  if (ix + (64 << 20) < iy || iy === 0x7ff00000) { IO[0] = (m & 1) !== 0 ? -PI / 2 : PI / 2; return; } // |y/x| > 2^64
  let z: number;
  if ((m & 2) !== 0 && iy + (64 << 20) < ix) z = 0; // |y/x| < 2^-64, x < 0
  else {
    const q = y / x;
    IO[0] = q < 0 ? -q : q;
    atanIO();
    z = IO[0]!;
  }
  IO[0] = m === 0 ? z : m === 1 ? -z : m === 2 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

// ---- exp / log -------------------------------------------------------------------------------------------

const LN2HI = 6.93147180369123816490e-01;
const LN2LO = 1.90821492927058770002e-10;
const INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

const TWO1023 = fromWords(0x7fe00000, 0);

/** IO[0] *= 2^n (scalbn.c). */
function scalbnIO(n: number): void {
  let y = IO[0]!;
  if (n > 1023) {
    y *= TWO1023;
    n -= 1023;
    if (n > 1023) {
      y *= TWO1023;
      n -= 1023;
      if (n > 1023) n = 1023;
    }
  } else if (n < -1022) {
    y *= 2.2250738585072014e-308 * 9007199254740992; // 2^-1022 * 2^53
    n += 1022 - 53;
    if (n < -1022) {
      y *= 2.2250738585072014e-308 * 9007199254740992;
      n += 1022 - 53;
      if (n < -1022) n = -1022;
    }
  }
  IO[0] = y * fromWords((0x3ff + n) << 20, 0);
}

/** IO[0] = exp(IO[0]). */
export function expIO(): void {
  let x = IO[0]!;
  const h = hiWord(x);
  const neg = h >>> 31;
  const hx = h & 0x7fffffff;
  if (hx >= 0x4086232b) { // |x| >= 708.39
    if (x !== x) return;
    if (x > 709.782712893383973096) { IO[0] = x * TWO1023; return; } // overflow to infinity
    if (x < -745.13321910194110842) { IO[0] = 0; return; }
  }
  let hi: number;
  let lo: number;
  let k: number;
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx >= 0x3ff0a2b2) k = (INVLN2 * x + (neg ? -0.5 : 0.5)) | 0; // |x| >= 1.5 ln2
    else k = 1 - neg - neg;
    hi = x - k * LN2HI;
    lo = k * LN2LO;
    x = hi - lo;
  } else if (hx > 0x3e300000) { // |x| > 2^-28
    k = 0;
    hi = x;
    lo = 0;
  } else {
    IO[0] = 1 + x;
    return;
  }
  const xx = x * x;
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
  IO[0] = 1 + ((x * c) / (2 - c) - lo + hi);
  if (k !== 0) scalbnIO(k);
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

/** IO[0] = log(IO[0]). */
export function logIO(): void {
  let x = IO[0]!;
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000 || hx >>> 31 !== 0) {
    if (((hx & 0x7fffffff) | lx) === 0) { IO[0] = -1 / (x * x); return; } // log(+-0) = -inf
    if (hx >>> 31 !== 0) { IO[0] = NaN; return; } // log(negative)
    k -= 54; // subnormal: scale up
    x *= 18014398509481984; // 2^54
    hx = hiWord(x);
  } else if (hx >= 0x7ff00000) {
    return;
  } else if (hx === 0x3ff00000 && lx === 0) {
    IO[0] = 0;
    return;
  }
  // Reduce x into [sqrt(2)/2, sqrt(2)].
  hx += 0x3ff00000 - 0x3fe6a09e;
  k += (hx >>> 20) - 0x3ff;
  hx = (hx & 0x000fffff) + 0x3fe6a09e;
  x = fromWords(hx, loWord(x));
  const f = x - 1.0;
  const hfsq = 0.5 * f * f;
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const dk = k;
  IO[0] = s * (hfsq + R) + dk * LN2LO - hfsq + f + dk * LN2HI;
}

/**
 * IO[0] = IO[0]^IO[1] for a positive base as exp(y log x): deterministic, within a few dozen ulps (the sim
 * only uses it at set-up). The usual special cases are kept; a negative base gives NaN.
 */
export function powIO(): void {
  const x = IO[0]!;
  const y = IO[1]!;
  if (y === 0 || x === 1) { IO[0] = 1; return; }
  if (x !== x || y !== y || x < 0) { IO[0] = NaN; return; }
  if (x === 0) { IO[0] = y > 0 ? 0 : Infinity; return; }
  logIO();
  IO[0] = y * IO[0]!;
  expIO();
}
