// Phase 6: the bank's renders (levels, clean ends, determinism) and the mix's headroom.
import { describe, expect, it } from 'vitest';
import { peak, rms, resample, SR } from '../../src/audio/dsp.ts';
import { AUDIO, buildBank, binFor, racketBin, RQ_CLEAN, GLASS_V, BOUNCE_V, APPLAUSE_BIG, type Sample } from '../../src/audio/bank.ts';
import { FL_TURF, FL_HARD } from '../../src/audio/voices.ts';

const LOOPS = new Set(['murmur', 'wind', 'birds', 'crickets', 'hum', 'hall']);
const t0 = performance.now();
const bank = buildBank({ floor: FL_TURF, arena: 'stadium' });
const buildMs = performance.now() - t0;
const dB = (x: number): number => 20 * Math.log10(x);

describe('bank', () => {
  it('renders every family for the arena, in finite numbers', () => {
    for (const k of ['racket', 'bounce', 'glass', 'mesh', 'net', 'metal', 'whoosh', 'step', 'scuff', 'grunt', 'applause', 'murmur', 'ooh', 'aah', 'cheer']) {
      expect(bank.has(k), k).toBe(true);
    }
    for (const [k, fam] of bank) for (const row of fam) for (const s of row) for (const c of s.ch) {
      for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i]!)) throw new Error(`${k}: not finite`);
    }
    // In a worker this is off the main thread; it should still not take long.
    expect(buildMs).toBeLessThan(6000);
  });

  it('sets each family\'s loudest render at its level, ends every one-shot cleanly, with no DC', () => {
    const pk = AUDIO.peak as Record<string, number>, rm = AUDIO.rms as Record<string, number>;
    for (const [k, fam] of bank) {
      let top = 0;
      for (const row of fam) for (const s of row) for (const c of s.ch) {
        top = Math.max(top, rm[k] !== undefined ? rms(c) : peak(c));
        let m = 0;
        for (let i = 0; i < c.length; i++) m += c[i]!;
        expect(Math.abs(m / c.length), `${k} DC`).toBeLessThan(1e-3 * Math.max(peak(c), 1e-6) + 1e-6);
        if (!LOOPS.has(k)) {
          const n = Math.round(0.001 * s.sr);
          expect(rms(c, c.length - n), `${k} tail`).toBeLessThan(0.01 * peak(c) + 1e-7);
        }
      }
      expect(dB(top), k).toBeCloseTo(rm[k] ?? pk[k]!, 1);
    }
  });

  it('is the same on every load', () => {
    const again = buildBank({ floor: FL_TURF, arena: 'stadium' });
    for (const k of ['racket', 'glass', 'grunt', 'applause']) {
      const a = bank.get(k)![0]![0]!.ch[0]!, b = again.get(k)![0]![0]!.ch[0]!;
      expect(b.length).toBe(a.length);
      let d = 0;
      for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!));
      expect(d).toBe(0);
    }
  });

  it('builds what the place has: a club has birds and no cheering crowd; the floor changes the bounces', () => {
    const club = buildBank({ floor: FL_HARD, arena: 'club-day' });
    expect(club.has('birds')).toBe(true);
    expect(club.has('cheer')).toBe(false);
    const a = bank.get('bounce')![2]![0]!.ch[0]!, b = club.get('bounce')![2]![0]!.ch[0]!;
    let same = true;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { same = false; break; }
    expect(same).toBe(false);
  });

  it('binFor slides between bins and keeps level with the parameter', () => {
    let lo = 0, n = 2000;
    for (let i = 0; i < n; i++) if (binFor(BOUNCE_V, 7.5, i / n).bin === 1) lo++;
    // 7.5 is halfway from 5 to 10: half the plays use each.
    expect(lo / n).toBeCloseTo(0.5, 1);
    expect(binFor(BOUNCE_V, 7.5, 0.9).gain).toBeCloseTo(7.5 / 5, 5);
    expect(binFor(BOUNCE_V, 7.5, 0.1).gain).toBeCloseTo(7.5 / 10, 5);
    expect(binFor(BOUNCE_V, 100, 0.5).gain).toBeLessThanOrEqual(1.6);
  });
});

describe('mix', () => {
  // The engine's worst case for one play: the bin's gain cap, +1.5 dB of random level, the master gain, no
  // distance loss (nearer than the reference distance).
  const master = Math.pow(10, AUDIO.master / 20), rnd = Math.pow(10, 1.5 / 20);

  it('no single sound needs the limiter, at its loudest', () => {
    for (const [k, fam] of bank) {
      let top = 0;
      for (const row of fam) for (const s of row) for (const c of s.ch) top = Math.max(top, peak(c));
      const g = LOOPS.has(k) ? 1 : k === 'applause' || k === 'cheer' ? 1.3 : k === 'racket' ? 1.06 : 1.6;
      expect(top * g * rnd * master, k).toBeLessThan(1);
    }
  });

  /** Sum renders into a 48 kHz mono bus at times (s) and gains. */
  function scene(parts: Array<[Sample, number, number]>, secs: number): Float32Array {
    const out = new Float32Array(Math.round(secs * SR));
    for (const [s, at, g] of parts) {
      const c = resample(s.ch[0]!, s.sr, SR);
      const o = Math.round(at * SR);
      for (let i = 0; i < c.length && o + i < out.length; i++) out[o + i] = out[o + i]! + c[i]! * g * master;
    }
    return out;
  }

  it('the busiest moment (a smash off the glass, a grunt, the crowd erupting) peaks under 0 dBFS before the limiter', () => {
    const g = (k: string, bin = 0, v = 0): Sample => bank.get(k)![bin]![v]!;
    const mix = scene([
      [g('whoosh', 2), 0, rnd],
      [g('racket', racketBin(2, 2, RQ_CLEAN)), 0.05, 1.06 * rnd],
      [g('grunt', 2), 0.065, rnd],
      [g('bounce', 3), 0.17, 1.4 * rnd],
      [g('glass', GLASS_V.length - 1), 0.26, 1.4 * rnd],
      [g('step', 1), 0.1, rnd], [g('step', 1, 1), 0.35, rnd], [g('scuff'), 0.4, rnd],
      [g('cheer'), 0.4, 1.3], [g('applause', APPLAUSE_BIG), 0.6, 1.3],
      [g('murmur'), 0, 1],
    ], 3);
    expect(dB(peak(mix))).toBeLessThan(0);
  });

  it('is balanced: the racket leads, the shoes sit 15-30 dB under it, the crowd under the play', () => {
    const lvl = (k: string, bin = 0): number => {
      let m = 0;
      for (const s of bank.get(k)![bin]!) m = Math.max(m, rms(s.ch[0]!, 0, Math.round(0.05 * s.sr)));
      return dB(m);
    };
    const racket = lvl('racket', racketBin(0, 1, RQ_CLEAN));
    expect(racket - lvl('step', 1)).toBeGreaterThan(15);
    expect(racket - lvl('step', 1)).toBeLessThan(32);
    expect(racket - lvl('bounce', 2)).toBeGreaterThan(4);
    expect(racket).toBeGreaterThan(lvl('grunt', 1));
    expect(racket - dB(rms(bank.get('murmur')![0]![0]!.ch[0]!))).toBeGreaterThan(9);
  });
});
