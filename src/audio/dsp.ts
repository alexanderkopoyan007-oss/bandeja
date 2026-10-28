// Sound synthesis in plain TypeScript (Phase 6): everything renders into Float32Arrays, so the sounds are built
// once at load (several variations of each) and checked in node by the tests (spectrum, length, peak level).
// No WebAudio here; `bank.ts` turns these into AudioBuffers and `engine.ts` plays them.
//
// Impacts are modal: a contact force pulse (a half-sine as long as the contact lasts) drives a few damped
// resonances. That is how an impact sounds in physics: the pulse's length sets how high the spectrum reaches
// (a 5 ms contact rolls off above about 200-400 Hz of its own, a 1 ms one reaches several kHz), and the modes
// (the ball's shell, the racket's face, a glass panel's bending, a post's ringing) colour it.

export const SR = 48000;

/** A seeded generator (LCG), so a bank is the same every load and in the tests. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** Roughly normal (sum of three uniforms), mean 0, SD about 1. */
  gauss(): number { return (this.next() + this.next() + this.next() - 1.5) * 2; }
}

/** One damped resonance: frequency (Hz), time for its level to fall 60 dB (s), amplitude. */
export interface Mode { f: number; t60: number; a: number }

/** Pole radius for a decay to -60 dB in t60 seconds at sample rate sr. */
export function poleR(t60: number, sr = SR): number { return Math.exp(-6.9078 / (t60 * sr)); }

/**
 * Modes struck by a half-sine force pulse `contact` seconds long. Each mode is an exact two-pole resonator driven by
 * the pulse, normalised so a mode far below the pulse's roll-off starts at amplitude `a` (an impulse's response does
 * not depend on the damping); a mode near or above 1/contact is excited less, by the pulse's own spectrum. That is
 * what makes a long, soft contact dull and a short, hard one bright.
 */
export function modal(out: Float32Array, at: number, modes: Mode[], contact: number, gain = 1, sr = SR): void {
  const n = out.length;
  const np = Math.max(2, Math.round(contact * sr));
  const start = Math.round(at * sr);
  for (let mi = 0; mi < modes.length; mi++) {
    const m = modes[mi]!;
    if (m.f >= sr * 0.45 || m.a === 0) continue;
    const r = poleR(m.t60, sr);
    const w = (2 * Math.PI * m.f) / sr;
    const c1 = 2 * r * Math.cos(w), c2 = -r * r;
    // h[n] = g r^n sin((n+1)w) / sin(w); the pulse's area is 2 np / pi.
    const g = (m.a * gain * Math.sin(w) * Math.PI) / (2 * np);
    const floor = Math.abs(m.a * gain) * 1e-5;
    let y1 = 0, y2 = 0;
    for (let i = start; i < n; i++) {
      const k = i - start;
      const x = k < np ? Math.sin((Math.PI * k) / np) : 0;
      const y = x * g + c1 * y1 + c2 * y2;
      y2 = y1;
      y1 = y;
      out[i] = out[i]! + y;
      if (k > np && Math.abs(y) < floor && Math.abs(y2) < floor) break;
    }
  }
}

/**
 * The pressure pulse of a body being stopped and thrown back over `contact` seconds: the derivative of the half-sine
 * force (one cycle, positive then negative). Its spectrum peaks near 1/contact: the dull "thud" of a soft contact,
 * the "tick" of a hard one.
 */
export function contactPulse(out: Float32Array, at: number, contact: number, amp: number, sr = SR): void {
  const np = Math.max(2, Math.round(contact * sr));
  const start = Math.round(at * sr);
  for (let k = 0; k < np && start + k < out.length; k++) out[start + k] = out[start + k]! + amp * Math.cos((Math.PI * k) / np);
}

/**
 * Granular noise: `count` tiny clicks (each a noise grain `grainLen` s long through a band-pass at a random centre in
 * [fLo, fHi]) at times drawn from an exponential with mean `spread` after `at`, each a bit quieter than the last.
 * Sand under a ball or a shoe, the rattle of mesh in its frame.
 */
export function grains(out: Float32Array, rng: Rng, at: number, count: number, spread: number, grainLen: number,
  fLo: number, fHi: number, amp: number, q = 1.5, sr = SR): void {
  const bq = new Biquad(sr);
  for (let gi = 0; gi < count; gi++) {
    const t = at - spread * Math.log(1 - rng.next() * 0.995);
    const start = Math.round(t * sr);
    const len = Math.max(4, Math.round(grainLen * sr * rng.range(0.5, 1.5)));
    if (start + len >= out.length) continue;
    bq.set('bp', fLo * Math.pow(fHi / fLo, rng.next()), q);
    bq.reset();
    const a = amp * rng.range(0.3, 1) * Math.exp(-(t - at) / (spread * 2 + 1e-4));
    for (let k = 0; k < len + Math.round(sr * 0.002) && start + k < out.length; k++) {
      const env = k < len ? Math.sin((Math.PI * k) / len) : 0;
      out[start + k] = out[start + k]! + bq.run((rng.next() * 2 - 1) * env) * a;
    }
  }
}

/** A biquad (RBJ cookbook), run over a buffer in place. */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  readonly sr: number;

  constructor(sr = SR) { this.sr = sr; }

  static make(type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q: number, gainDb = 0, sr = SR): Biquad {
    const b = new Biquad(sr);
    b.set(type, f, q, gainDb);
    return b;
  }

  reset(): void { this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }

  set(type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q: number, gainDb = 0): void {
    const sr = this.sr;
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }

  process(buf: Float32Array, from = 0, to = buf.length): void {
    for (let i = from; i < to; i++) buf[i] = this.run(buf[i]!);
  }
}

/** Shaped noise added into `out`: an envelope (attack, then exponential decay to -60 dB in t60) over white noise. */
export function noiseBurst(out: Float32Array, rng: Rng, at: number, attack: number, t60: number, amp: number,
  filters: Biquad[] = [], sr = SR): void {
  const start = Math.round(at * sr);
  const na = Math.max(1, Math.round(attack * sr));
  const len = Math.min(out.length - start, na + Math.round(t60 * sr * 1.1));
  const k = 6.9078 / (t60 * sr);
  for (let i = 0; i < len; i++) {
    const env = i < na ? i / na : Math.exp(-(i - na) * k);
    let x = (rng.next() * 2 - 1) * env * amp;
    for (const f of filters) x = f.run(x);
    out[start + i] = out[start + i]! + x;
  }
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]!));
  return p;
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Scale to a peak level (linear). */
export function normalise(buf: Float32Array, to: number): Float32Array {
  const p = peak(buf);
  if (p > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i]! * to) / p;
  return buf;
}

/** Fade the last `secs` out (no click at the end of a buffer). */
export function fadeTail(buf: Float32Array, secs: number, sr = SR): Float32Array {
  const n = Math.min(buf.length, Math.round(secs * sr));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] = buf[buf.length - 1 - i]! * (i / n);
  return buf;
}

/**
 * Spectral centroid (Hz) and the share of energy in bands, by a plain DFT over a window (tests only; slow but
 * exact). Bands: [lo, hi) Hz pairs.
 */
export function spectrum(buf: Float32Array, bands: Array<[number, number]>, from = 0, len = 4096, sr = SR): { centroid: number; share: number[] } {
  const N = Math.min(len, buf.length - from);
  const bins = Math.floor(N / 2);
  let tot = 0, wsum = 0;
  const share = bands.map(() => 0);
  for (let k = 1; k < bins; k++) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * k) / N;
    for (let i = 0; i < N; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      const x = buf[from + i]! * hann;
      re += x * Math.cos(w * i);
      im -= x * Math.sin(w * i);
    }
    const p = re * re + im * im;
    const f = (k * sr) / N;
    tot += p;
    wsum += p * f;
    bands.forEach(([lo, hi], j) => { if (f >= lo && f < hi) share[j] = share[j]! + p; });
  }
  return { centroid: tot > 0 ? wsum / tot : 0, share: share.map((s) => (tot > 0 ? s / tot : 0)) };
}

/**
 * A formant resonator (Klatt 1980): unity gain at DC, centre f, bandwidth bw (Hz). Cascaded, they make a vocal tract.
 */
export class Formant {
  private a = 1; private b = 0; private c = 0; private y1 = 0; private y2 = 0;
  readonly sr: number;
  constructor(sr: number) { this.sr = sr; }
  set(f: number, bw: number): void {
    const T = 1 / this.sr;
    this.c = -Math.exp(-2 * Math.PI * bw * T);
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
    this.a = 1 - this.b - this.c;
  }
  run(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Remove any DC offset (mean). */
export function removeDC(buf: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m += buf[i]!;
  m /= Math.max(1, buf.length);
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! - m;
  return buf;
}

/**
 * RT60 by Schroeder backward integration of an impulse response: the energy decay curve's slope between -5 and
 * -25 dB, extrapolated to -60 (T20, ISO 3382). Optionally after a band filter.
 */
export function rt60(ir: Float32Array, sr = SR, band?: Biquad[]): number {
  const x = Float32Array.from(ir);
  if (band) for (const b of band) b.process(x);
  const e = new Float64Array(x.length);
  let acc = 0;
  for (let i = x.length - 1; i >= 0; i--) { acc += x[i]! * x[i]!; e[i] = acc; }
  const db = (i: number): number => 10 * Math.log10(e[i]! / e[0]! + 1e-30);
  let i5 = -1, i25 = -1;
  for (let i = 0; i < x.length; i++) {
    if (i5 < 0 && db(i) <= -5) i5 = i;
    if (db(i) <= -25) { i25 = i; break; }
  }
  if (i5 < 0 || i25 < 0) return 0;
  return ((i25 - i5) / sr) * 3;
}

/** Linear resampling (an impulse response rendered at 48 kHz for a 44.1 kHz context). */
export function resample(buf: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return buf;
  const n = Math.round((buf.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i * from) / to, i0 = Math.floor(t), f = t - i0;
    out[i] = (buf[i0] ?? 0) * (1 - f) + (buf[i0 + 1] ?? 0) * f;
  }
  return out;
}
