// Phase 6: the synthesised sounds measured against what is published about them (sources in voices.ts and
// DECISIONS.md). Spectra by plain DFT (dsp.spectrum); levels before the bank scales them.
import { describe, expect, it } from 'vitest';
import { Rng, SR, spectrum, peak, rms, rt60, Biquad, modal } from '../../src/audio/dsp.ts';
import * as V from '../../src/audio/voices.ts';
import { AUDIO, arenaAudio } from '../../src/audio/bank.ts';

const band = (b: Float32Array, lo: number, hi: number, from = 0, len = 4096, sr = SR): number =>
  spectrum(b, [[lo, hi]], from, Math.min(len, b.length - from), sr).share[0]!;
const centroid = (b: Float32Array, from = 0, len = 4096, sr = SR): number =>
  spectrum(b, [[0, 1]], from, Math.min(len, b.length - from), sr).centroid;
/** Time (s) by which a share `q` of the energy has arrived. */
function energyBy(b: Float32Array, q: number, sr = SR): number {
  let tot = 0;
  for (let i = 0; i < b.length; i++) tot += b[i]! * b[i]!;
  let acc = 0;
  for (let i = 0; i < b.length; i++) { acc += b[i]! * b[i]!; if (acc >= q * tot) return i / sr; }
  return b.length / sr;
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const many = <T>(n: number, f: (r: Rng, i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(new Rng(100 + i * 31), i));

describe('dsp', () => {
  it('a mode rings at its frequency and decays at its RT60', () => {
    const b = new Float32Array(SR);
    modal(b, 0, [{ f: 440, t60: 0.5, a: 1 }], 0.0002);
    // Level 60 dB down after 0.5 s: compare rms over 10 ms windows.
    const w = (t: number): number => rms(b, Math.round(t * SR), Math.round((t + 0.01) * SR));
    expect(20 * Math.log10(w(0.5) / w(0))).toBeCloseTo(-60, -1);
    const s = spectrum(b, [[420, 460]], 0, 8192);
    expect(s.share[0]!).toBeGreaterThan(0.8);
    // A short pulse starts a mode below its roll-off at about its amplitude.
    expect(peak(b)).toBeGreaterThan(0.85);
    expect(peak(b)).toBeLessThan(1.15);
  });
});

describe('racket', () => {
  it('is dry: the direct sound is over within 30 ms (Piana et al.)', () => {
    for (const k of [V.RK_DRIVE, V.RK_VOLLEY, V.RK_OVER, V.RK_SLICE, V.RK_TOUCH]) {
      const t = mean(many(6, (r) => energyBy(V.racket(r, k, 0.8, 0.05, false), 0.9)));
      expect(t).toBeLessThan(0.03);
    }
  });

  it('centres in the mids when clean (play peaks at 800-1000 Hz A-weighted), and sharper when harder', () => {
    const hard = mean(many(8, (r) => centroid(V.racket(r, V.RK_DRIVE, 0.95, 0.05, false))));
    const soft = mean(many(8, (r) => centroid(V.racket(r, V.RK_TOUCH, 0.2, 0.05, false))));
    expect(hard).toBeGreaterThan(450);
    expect(hard).toBeLessThan(1500);
    expect(hard).toBeGreaterThan(soft);
  });

  it('off the sweet spot is duller and rings longer (the first bending mode), the frame clacks', () => {
    const clean = many(8, (r) => V.racket(r, V.RK_DRIVE, 0.7, 0.05, false));
    const off = many(8, (r) => V.racket(r, V.RK_DRIVE, 0.7, 0.9, false));
    const frame = many(8, (r) => V.racket(r, V.RK_DRIVE, 0.7, 0.5, true));
    expect(mean(off.map((b) => centroid(b)))).toBeLessThan(0.6 * mean(clean.map((b) => centroid(b))));
    expect(mean(off.map((b) => energyBy(b, 0.9)))).toBeGreaterThan(mean(clean.map((b) => energyBy(b, 0.9))));
    // The rim's clack: brighter than a clean hit (not the face's 205 Hz bending: review, Phase 6), more energy
    // above 2 kHz in the first 10 ms, and no louder than a clean hit over its first 30 ms.
    const hi = (b: Float32Array): number => band(b, 2000, 8000, 0, 480) * rms(b, 0, 480) ** 2;
    expect(mean(frame.map(hi))).toBeGreaterThan(1.5 * mean(clean.map(hi)));
    expect(mean(frame.map((b) => centroid(b, 0, 960)))).toBeGreaterThan(mean(clean.map((b) => centroid(b, 0, 960))));
    const r30 = (b: Float32Array): number => rms(b, 0, 1440);
    expect(20 * Math.log10(mean(frame.map(r30)) / mean(clean.map(r30)))).toBeLessThan(1);
  });

  it('is louder the harder it is hit', () => {
    expect(mean(many(6, (r) => peak(V.racket(r, V.RK_DRIVE, 0.95, 0.05, false)))))
      .toBeGreaterThan(1.8 * mean(many(6, (r) => peak(V.racket(r, V.RK_DRIVE, 0.25, 0.05, false)))));
  });
});

describe('bounce', () => {
  it('on a hard floor: about 1 kHz for the first cycles, then a decaying ~250 Hz (US 9551572)', () => {
    const bs = many(8, (r) => V.bounce(r, V.FL_HARD, 12));
    // First 2.5 ms: the kHz band carries far more of the energy than it does later.
    const early = mean(bs.map((b) => band(b, 700, 1500, 48, 120)));
    const late = mean(bs.map((b) => band(b, 700, 1500, 480, 2400)));
    expect(early).toBeGreaterThan(3 * late);
    expect(mean(bs.map((b) => band(b, 150, 400, 480, 2400)))).toBeGreaterThan(0.5);
  });

  it('turf is damped and gritty, carpet muffled, hard loudest', () => {
    const at = (fl: number, f: (b: Float32Array) => number): number => mean(many(8, (r) => f(V.bounce(r, fl, 12))));
    expect(at(V.FL_TURF, peak)).toBeLessThan(0.7 * at(V.FL_HARD, peak));
    expect(at(V.FL_CARPET, peak)).toBeLessThan(0.7 * at(V.FL_HARD, peak));
    expect(at(V.FL_TURF, (b) => band(b, 2500, 12000))).toBeGreaterThan(2 * at(V.FL_CARPET, (b) => band(b, 2500, 12000)));
    expect(at(V.FL_CARPET, (b) => centroid(b))).toBeLessThan(at(V.FL_TURF, (b) => centroid(b)));
    // Faster is louder.
    expect(mean(many(6, (r) => peak(V.bounce(r, V.FL_TURF, 18))))).toBeGreaterThan(2 * mean(many(6, (r) => peak(V.bounce(r, V.FL_TURF, 3)))));
  });
});

describe('walls', () => {
  it('glass is a low bang, mesh a higher ring (Higgins / The Padel Paper)', () => {
    const g = mean(many(6, (r) => centroid(V.glass(r, 16), 0, 8192)));
    const m = mean(many(6, (r) => centroid(V.mesh(r, 12), 0, 8192)));
    expect(g).toBeLessThan(300);
    expect(m).toBeGreaterThan(2 * g);
    // The glass booms for a while; the racket is long gone by then.
    expect(mean(many(4, (r) => energyBy(V.glass(r, 16), 0.9)))).toBeGreaterThan(0.05);
  });

  it('louder with the ball speed; a hard hit rattles the fixings', () => {
    expect(mean(many(6, (r) => peak(V.glass(r, 26))))).toBeGreaterThan(2 * mean(many(6, (r) => peak(V.glass(r, 4)))));
    const hiAt = (v: number): number => mean(many(6, (r) => { const b = V.glass(r, v); return band(b, 1500, 6000, 240, 2400) * rms(b, 240, 2640) ** 2; }));
    expect(hiAt(26)).toBeGreaterThan(3 * hiAt(9));
  });

  it('a post rings as a free bar (1 : 2.756 : 5.404)', () => {
    const b = V.metal(new Rng(5), V.MT_POST, 15);
    const s = spectrum(b, [[300, 600], [900, 1600], [2000, 3200]], 0, 16384);
    // The fundamental leads; the next two modes are there, weaker (a ball's contact is slow for the highest).
    expect(s.share[0]!).toBeGreaterThan(0.4);
    expect(s.share[1]!).toBeGreaterThan(0.01);
    expect(s.share[2]!).toBeGreaterThan(0.002);
  });
});

describe('feet', () => {
  it('turf crunches high (sand), carpet pats low, a hard court squeaks', () => {
    const c = (fl: number): number => mean(many(8, (r) => centroid(V.step(r, fl, 0.7))));
    expect(c(V.FL_TURF)).toBeGreaterThan(1500);
    expect(c(V.FL_CARPET)).toBeLessThan(800);
    // The squeak is tonal: one band of a few hundred Hz holds much of a scuff's energy.
    const sq = V.scuff(new Rng(3), V.FL_HARD, 0.8);
    const s = spectrum(sq, [[1200, 3200]], 0, 8192);
    expect(s.share[0]!).toBeGreaterThan(0.4);
  });
});

describe('voices', () => {
  /** Fundamental by autocorrelation over a window. */
  function f0(b: Float32Array, from: number, len: number, sr: number): number {
    let best = 0, bestLag = 0;
    for (let lag = Math.round(sr / 400); lag < Math.round(sr / 70); lag++) {
      let s = 0;
      for (let i = 0; i < len; i++) s += b[from + i]! * b[from + i + lag]!;
      if (s > best) { best = s; bestLag = lag; }
    }
    return sr / bestLag;
  }

  it('a grunt is voiced near the speaker\'s pitch (raised by effort), louder and longer with effort', () => {
    const v = V.PLAYER_VOICES[0]!;
    const g = V.grunt(new Rng(9), v, 0.9);
    const p = f0(g, Math.round(0.03 * V.LO_SR), 1200, V.LO_SR);
    expect(p).toBeGreaterThan(v.f0 * 1.05);
    expect(p).toBeLessThan(v.f0 * 1.7);
    const hard = many(6, (r) => V.grunt(r, v, 0.95)), light = many(6, (r) => V.grunt(r, v, 0.3));
    expect(mean(hard.map((b) => rms(b)))).toBeGreaterThan(mean(light.map((b) => rms(b))));
    expect(mean(hard.map((b) => b.length))).toBeGreaterThan(mean(light.map((b) => b.length)));
  });
});

describe('crowd', () => {
  it('claps centre where ClaPD puts hand resonances (0.5-1.6 kHz) and the two ears differ', () => {
    const [L, R] = V.applause(new Rng(4), 12, 2, false);
    const c = centroid(L!, Math.round(0.6 * V.LO_SR), 8192, V.LO_SR);
    expect(c).toBeGreaterThan(600);
    expect(c).toBeLessThan(2500);
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < L!.length; i++) { lr += L![i]! * R![i]!; ll += L![i]! ** 2; rr += R![i]! ** 2; }
    expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.9);
  });

  it('the murmur loops without a seam', () => {
    // The step from the last sample to the first is no bigger than the steps inside (a cut would be a jump of the
    // order of the rms: many times the typical step of a low-passed bed).
    for (const seed of [2, 3, 4]) {
      const [L] = V.murmur(new Rng(seed), 10, 4);
      let d = 0;
      for (let i = 1; i < L!.length; i++) d += Math.abs(L![i]! - L![i - 1]!);
      d /= L!.length - 1;
      expect(Math.abs(L![L!.length - 1]! - L![0]!)).toBeLessThan(4 * d);
    }
  });
});

describe('rooms', () => {
  it('every arena\'s reverb has the RT60 its data asks for (T20, ISO 3382), per band', () => {
    for (const k of Object.keys(AUDIO.arenas)) {
      const room = arenaAudio(k).room;
      const ir = V.impulseResponse(new Rng(1), room);
      const mid = rt60(ir[0]!, SR, [Biquad.make('bp', 1000, 0.7)]);
      const lo = rt60(ir[0]!, SR, [Biquad.make('lp', 200, 0.7)]);
      expect(mid / room.rt60[1]).toBeGreaterThan(0.8);
      expect(mid / room.rt60[1]).toBeLessThan(1.2);
      expect(lo / room.rt60[0]).toBeGreaterThan(0.75);
      expect(lo / room.rt60[0]).toBeLessThan(1.25);
    }
  });
});
