// Measuring sounds the way the padel noise reports do (tools and tests only; nothing in the game imports this):
// A-weighting, the sound level meter's fast time weighting, octave and third-octave bands, attack and decay times.
// Everything is plain float maths over buffers.
import { SR } from './dsp.ts';

/** In-place radix-2 FFT. re.length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const a = (sign * 2 * Math.PI) / len;
    const half = len >> 1;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const tr = re[j]! * wr - im[j]! * wi, ti = re[j]! * wi + im[j]! * wr;
        re[j] = re[i]! - tr; im[j] = im[i]! - ti;
        re[i] = re[i]! + tr; im[i] = im[i]! + ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
}

export function pow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

/** The A-weighting curve in dB at frequency f (IEC 61672). */
export function aDb(f: number): number {
  const f2 = f * f;
  const num = 12194 ** 2 * f2 * f2;
  const den = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2);
  return 20 * Math.log10(num / den) + 2.0;
}

/** A-weighted copy: the curve applied in the frequency domain. */
export function aWeight(buf: Float32Array, sr = SR): Float32Array {
  const N = pow2(buf.length + 1024);
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(buf);
  fft(re, im);
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * sr) / N;
    const g = k === 0 ? 0 : Math.pow(10, aDb(f) / 20);
    re[k] = re[k]! * g; im[k] = im[k]! * g;
    if (k > 0 && k < N / 2) { re[N - k] = re[N - k]! * g; im[N - k] = im[N - k]! * g; }
  }
  fft(re, im, true);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < out.length; i++) out[i] = re[i]!;
  return out;
}

const dB = (x: number): number => (x > 0 ? 10 * Math.log10(x) : -200);

/** The largest level of a meter on Fast (exponential, 125 ms), dB re full scale, of a signal already weighted. */
export function fastMax(buf: Float32Array, sr = SR, tau = 0.125): number {
  const k = Math.exp(-1 / (tau * sr));
  let e = 0, m = 0;
  for (let i = 0; i < buf.length; i++) {
    e = k * e + (1 - k) * buf[i]! * buf[i]!;
    if (e > m) m = e;
  }
  return dB(m);
}

/** A meter on Fast over A-weighting: what LAFmax would read for this sound, dB re full scale. */
export function lafmax(buf: Float32Array, sr = SR): number { return fastMax(aWeight(buf, sr), sr); }

/** Sound exposure of a whole buffer, A-weighted, dB re (full scale)^2 s. */
export function sel(buf: Float32Array, sr = SR): number {
  const a = aWeight(buf, sr);
  let e = 0;
  for (let i = 0; i < a.length; i++) e += a[i]! * a[i]!;
  return dB(e / sr);
}

export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const THIRDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];

/** The power spectrum of a buffer (Hann window unless `plain`), returning |X|^2 per bin and the bin width. */
export function powerSpectrum(buf: Float32Array, sr = SR, plain = false): { p: Float64Array; df: number } {
  const N = pow2(buf.length);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < buf.length; i++) {
    const w = plain ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (buf.length - 1));
    re[i] = buf[i]! * w;
  }
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return { p, df: sr / N };
}

/** Energy in dB per band (centre `c[i]`, edges c / w .. c * w), from a power spectrum. */
export function bands(buf: Float32Array, c: number[], width: number, sr = SR): number[] {
  const { p, df } = powerSpectrum(buf, sr, true);
  return c.map((f) => {
    const lo = f / width, hi = f * width;
    let e = 0;
    const k0 = Math.max(1, Math.round(lo / df)), k1 = Math.min(p.length - 1, Math.round(hi / df));
    for (let k = k0; k < k1; k++) e += p[k]!;
    return dB(e);
  });
}
export const octaveBands = (b: Float32Array, sr = SR): number[] => bands(b, OCTAVES, Math.SQRT2, sr);
export const thirdBands = (b: Float32Array, sr = SR): number[] => bands(b, THIRDS, 2 ** (1 / 6), sr);

/** Peak frequency, smoothed over a third of an octave so one line of a mode doesn't win over a band; and the centroid. */
export function peakAndCentroid(buf: Float32Array, sr = SR): { peak: number; centroid: number; aCentroid: number } {
  // (no window: an impact starts at the buffer's first samples, and a Hann window would weigh its attack at nothing)
  const { p, df } = powerSpectrum(buf, sr, true);
  let tot = 0, wf = 0, atot = 0, awf = 0;
  for (let k = 1; k < p.length; k++) {
    const f = k * df;
    tot += p[k]!; wf += p[k]! * f;
    const a = p[k]! * Math.pow(10, aDb(f) / 10);
    atot += a; awf += a * f;
  }
  // Sliding third-octave energy (by prefix sum) on a log grid.
  const pre = new Float64Array(p.length + 1);
  for (let k = 0; k < p.length; k++) pre[k + 1] = pre[k]! + p[k]!;
  let best = 0, peak = 0;
  for (let f = 30; f < Math.min(16000, sr / 2.3); f *= 2 ** (1 / 24)) {
    const k0 = Math.max(1, Math.round((f / 2 ** (1 / 6)) / df)), k1 = Math.min(p.length, Math.round((f * 2 ** (1 / 6)) / df) + 1);
    const e = pre[k1]! - pre[k0]!;
    if (e > best) { best = e; peak = f; }
  }
  return { peak, centroid: tot > 0 ? wf / tot : 0, aCentroid: atot > 0 ? awf / atot : 0 };
}

/** Times on the sound's energy envelope (2 ms rms): 10-90% attack of the rms, and when it falls for good 20 and 40 dB under its top. */
export function times(buf: Float32Array, sr = SR): { attack: number; t20: number; t40: number; len: number; crest: number } {
  const w = Math.max(4, Math.round(0.002 * sr));
  const hop = Math.max(1, Math.round(0.00025 * sr));
  const env: number[] = [];
  let acc = 0;
  let peakAbs = 0, tot = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    acc += x * x;
    if (i >= w) acc -= buf[i - w]! * buf[i - w]!;
    if ((i + 1) % hop === 0) env.push(Math.max(acc, 0) / w);
    peakAbs = Math.max(peakAbs, Math.abs(x));
    tot += x * x;
  }
  let top = 0, topI = 0;
  for (let i = 0; i < env.length; i++) if (env[i]! > top) { top = env[i]!; topI = i; }
  if (top <= 0) return { attack: 0, t20: 0, t40: 0, len: buf.length / sr, crest: 0 };
  let i10 = 0, i90 = 0;
  for (let i = 0; i <= topI; i++) {
    if (i10 === 0 && env[i]! >= top * 0.01) i10 = i; // -20 dB on energy is 10% of the amplitude
    if (env[i]! >= top * 0.81) { i90 = i; break; }
  }
  const last = (th: number): number => { for (let i = env.length - 1; i >= 0; i--) if (env[i]! >= th) return i; return 0; };
  const t = (i: number): number => (i * hop) / sr;
  return {
    attack: t(Math.max(0, i90 - i10)), t20: t(last(top * 0.01)) - t(topI), t40: t(last(top * 1e-4)) - t(topI), len: buf.length / sr,
    crest: 20 * Math.log10(peakAbs / Math.sqrt(tot / buf.length)),
  };
}

/** A mono mix of however many channels. */
export function mono(ch: Float32Array[]): Float32Array {
  if (ch.length === 1) return ch[0]!;
  const out = new Float32Array(ch[0]!.length);
  for (let i = 0; i < out.length; i++) { let s = 0; for (const c of ch) s += c[i]!; out[i] = s / ch.length; }
  return out;
}

/** A 16-bit WAV of one or two channels. */
export function wavBytes(ch: Float32Array[], sr: number): Uint8Array {
  const n = ch[0]!.length, c = ch.length;
  const buf = new DataView(new ArrayBuffer(44 + n * c * 2));
  const put = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); buf.setUint32(4, 36 + n * c * 2, true); put(8, 'WAVEfmt '); buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); buf.setUint16(22, c, true); buf.setUint32(24, sr, true); buf.setUint32(28, sr * c * 2, true);
  buf.setUint16(32, c * 2, true); buf.setUint16(34, 16, true); put(36, 'data'); buf.setUint32(40, n * c * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { buf.setInt16(o, Math.max(-32767, Math.min(32767, Math.round(ch[k]![i]! * 32767))), true); o += 2; }
  return new Uint8Array(buf.buffer);
}
