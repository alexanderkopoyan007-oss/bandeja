// Phase 6: the bank's renders (levels, clean ends, determinism, the level law, floors) and the mix's headroom in
// every arena and on every floor, through the master chain as the engine builds it.
import { describe, expect, it } from 'vitest';
import { peak, rms, resample, SR } from '../../src/audio/dsp.ts';
import {
  AUDIO, buildBank, binFor, families, activeRms, racketBin, RQ_CLEAN, GLASS_V, BOUNCE_V, RACKET_POWER, APPLAUSE_BIG,
  type Sample,
} from '../../src/audio/bank.ts';
import { FL_TURF, FL_HARD, FL_CARPET, FL_CLAY } from '../../src/audio/voices.ts';

const LOOPS = new Set(['murmur', 'wind', 'crickets', 'hum', 'hall']);
const ARENAS = ['stadium', 'hall', 'club-day', 'club-night'];
const FLOORS = [FL_TURF, FL_HARD, FL_CARPET, FL_CLAY];
const t0 = performance.now();
const env = { floor: FL_TURF, arena: 'stadium' };
const bank = buildBank(env);
const buildMs = performance.now() - t0;
const dB = (x: number): number => 20 * Math.log10(x);
const lin = (x: number): number => Math.pow(10, x / 20);
const meanPeak = (row: Sample[]): number => row.reduce((m, s) => m + Math.max(...s.ch.map((c) => peak(c))), 0) / row.length;

describe('bank', () => {
  it('renders every family for the arena, in finite numbers', () => {
    for (const k of ['racket', 'bounce', 'glass', 'mesh', 'net', 'metal', 'whoosh', 'step', 'scuff', 'grunt', 'applause', 'murmur', 'ooh', 'aah', 'cheer']) {
      expect(bank.has(k), k).toBe(true);
    }
    for (const [k, fam] of bank) for (const row of fam) for (const s of row) for (const c of s.ch) {
      for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i]!)) throw new Error(`${k}: not finite`);
    }
    // In a worker this is off the main thread; it should still not take long.
    expect(buildMs).toBeLessThan(8000);
  });

  it('sets each family\'s loudest render at its level (capped crowds under it), ends every one-shot cleanly, with no DC', () => {
    for (const a of ['stadium', 'club-day']) {
      const b = a === 'stadium' ? bank : buildBank({ floor: FL_TURF, arena: a });
      for (const def of families({ floor: FL_TURF, arena: a })) {
        const fam = b.get(def.name)!;
        let top = 0, pk = 0;
        for (const row of fam) for (const s of row) for (const c of s.ch) {
          top = Math.max(top, def.rms !== undefined ? (def.active ? activeRms(c) : rms(c)) : peak(c));
          pk = Math.max(pk, peak(c));
          let m = 0;
          for (let i = 0; i < c.length; i++) m += c[i]!;
          expect(Math.abs(m / c.length), `${def.name} DC`).toBeLessThan(1e-3 * Math.max(peak(c), 1e-6) + 1e-6);
          if (!LOOPS.has(def.name)) {
            const n = Math.round(0.001 * s.sr);
            expect(rms(c, c.length - n), `${def.name} tail`).toBeLessThan(0.01 * peak(c) + 1e-7);
          }
        }
        const want = def.rms ?? def.peak!;
        if (def.peakCap !== undefined && dB(pk) > def.peakCap - 0.05) {
          expect(dB(pk), `${a} ${def.name} cap`).toBeCloseTo(def.peakCap, 1);
          expect(dB(top), `${a} ${def.name}`).toBeLessThan(want + 0.05);
        } else expect(dB(top), `${a} ${def.name}`).toBeCloseTo(want, 1);
      }
    }
  });

  it('is the same on every load', () => {
    const again = buildBank(env);
    for (const k of ['racket', 'glass', 'grunt', 'applause']) {
      const a = bank.get(k)![0]![0]!.ch[0]!, b = again.get(k)![0]![0]!.ch[0]!;
      expect(b.length).toBe(a.length);
      let d = 0;
      for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!));
      expect(d).toBe(0);
    }
  });

  it('builds what the place has: birds by day at a club, no cheering crowd there, the stadium\'s air', () => {
    const club = buildBank({ floor: FL_HARD, arena: 'club-day' });
    expect(club.has('bird')).toBe(true);
    expect(club.get('bird')![0]!.length).toBe(AUDIO.variants.bird);
    expect(club.has('cheer')).toBe(false);
    expect(bank.has('bird')).toBe(false);
    expect(bank.has('hall')).toBe(true);
  });

  it('a small crowd claps far quieter than a full stand, and no crowd render goes near full scale', () => {
    for (const a of ARENAS) {
      const b = a === 'stadium' ? bank : buildBank({ floor: FL_TURF, arena: a });
      let pk = 0;
      for (const k of ['applause', 'ooh', 'aah', 'cheer']) for (const row of b.get(k) ?? []) for (const s of row) for (const c of s.ch) pk = Math.max(pk, peak(c));
      expect(dB(pk), a).toBeLessThan(-8.9);
      if (a !== 'stadium') {
        const r = (bb: Map<string, Sample[][]>): number => Math.max(...bb.get('applause')![APPLAUSE_BIG]!.map((s) => activeRms(s.ch[0]!)));
        expect(dB(r(b)) - dB(r(bank)), a).toBeLessThan(-12);
      }
    }
  });

  it('floors keep their loudness: a resin court bounces louder than sand, carpet quietest', () => {
    const lvl = (fl: number): number => dB(meanPeak(buildBank({ floor: fl, arena: 'stadium' }).get('bounce')![2]!));
    const hard = lvl(FL_HARD), turf = dB(meanPeak(bank.get('bounce')![2]!)), carpet = lvl(FL_CARPET);
    expect(hard - turf).toBeGreaterThan(2);
    expect(carpet).toBeLessThan(hard - 2);
  });

  it('impact levels follow their law: each bin at x / x_top below the top, so binFor\'s level is continuous', () => {
    const check = (fam: string, values: readonly number[], binOf: (i: number) => number): void => {
      const rows = bank.get(fam)!;
      const L = values.map((_, i) => meanPeak(rows[binOf(i)]!));
      const top = L[L.length - 1]!;
      for (let i = 0; i < values.length; i++) expect(dB(L[i]! / top), `${fam} bin ${i}`).toBeCloseTo(dB(values[i]! / values[values.length - 1]!), 1);
      // Between two bins either pick gives the same level.
      for (let i = 0; i < values.length - 1; i++) {
        const x = (values[i]! + values[i + 1]!) / 2;
        const lo = binFor(values, x, 0.999), loL = L[lo.bin]! * lo.gain;
        const hi = binFor(values, x, 0.0), hiL = L[hi.bin]! * hi.gain;
        expect(Math.abs(dB(loL / hiL)), `${fam} at ${x}`).toBeLessThan(0.2);
      }
    };
    check('glass', GLASS_V, (i) => i);
    check('bounce', BOUNCE_V, (i) => i);
    check('racket', RACKET_POWER, (i) => racketBin(0, i, RQ_CLEAN));
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
  // The engine's chain for one play at its worst: the bin's gain cap, +1.5 dB of random level, the master gain, an
  // equal-power panner at the centre (-3 dB an ear), no distance loss (the near baseline is the reference); the
  // crowd plays flat (stereo as rendered). Judged against the limiter's threshold: in play it never works.
  const master = lin(AUDIO.master), rnd = lin(1.5), pan = Math.SQRT1_2, limit = lin(AUDIO.limiter.threshold);
  const capFor = (k: string): number => (LOOPS.has(k) ? 1 : k === 'applause' || k === 'cheer' ? 1.3 : k === 'racket' ? 1.06 : 1.6);
  const flat = (k: string): boolean => LOOPS.has(k) || ['applause', 'ooh', 'aah', 'cheer'].includes(k);

  /** Sum renders into a 48 kHz bus (left ear) at times (s) and gains, as the chain plays them. */
  function scene(b: Map<string, Sample[][]>, parts: Array<[string, number, number, number]>, secs: number): Float32Array {
    const out = new Float32Array(Math.round(secs * SR));
    for (const [k, bin, at, g] of parts) {
      const s = b.get(k)?.[bin]?.[0];
      if (!s) continue;
      const c = resample(s.ch[0]!, s.sr, SR);
      const o = Math.round(at * SR);
      const gg = g * master * (flat(k) ? 1 : pan);
      for (let i = 0; i < c.length && o + i < out.length; i++) out[o + i] = out[o + i]! + c[i]! * gg;
    }
    return out;
  }

  for (const a of ARENAS) {
    for (const fl of FLOORS) {
      it(`${a}, floor ${fl}: no single sound reaches the limiter; the busiest moment stays under it`, () => {
        const b = a === 'stadium' && fl === FL_TURF ? bank : buildBank({ floor: fl, arena: a });
        for (const [k, fam] of b) {
          let top = 0;
          for (const row of fam) for (const s of row) for (const c of s.ch) top = Math.max(top, peak(c));
          expect(top * capFor(k) * (flat(k) ? 1 : rnd * pan) * master, `${k}`).toBeLessThan(limit);
        }
        // A smash off the glass, a grunt, the bounce, feet, the crowd erupting over the murmur.
        const mix = scene(b, [
          ['whoosh', 2, 0, rnd], ['racket', racketBin(2, 2, RQ_CLEAN), 0.05, 1.06 * rnd], ['grunt', 2, 0.065, rnd],
          ['bounce', 3, 0.17, 1.4 * rnd], ['glass', GLASS_V.length - 1, 0.26, 1.4 * rnd],
          ['step', 1, 0.1, rnd], ['step', 1, 0.35, rnd], ['scuff', 0, 0.4, rnd],
          ['cheer', 0, 0.4, 1.3], ['applause', APPLAUSE_BIG, 0.6, 1.3], ['murmur', 0, 0, 1],
        ], 3);
        expect(dB(peak(mix))).toBeLessThan(AUDIO.limiter.threshold);
      });
    }
  }

  it('is balanced: the racket leads, the shoes sit 15-32 dB under it, the bounce under it, the crowd under the play', () => {
    for (const fl of [FL_TURF, FL_HARD]) {
      const b = fl === FL_TURF ? bank : buildBank({ floor: fl, arena: 'stadium' });
      const lvl = (k: string, bin = 0): number => {
        let m = 0;
        for (const s of b.get(k)![bin]!) m = Math.max(m, rms(s.ch[0]!, 0, Math.round(0.05 * s.sr)));
        return dB(m);
      };
      const racket = lvl('racket', racketBin(0, 1, RQ_CLEAN));
      expect(racket - lvl('step', 1), `floor ${fl}`).toBeGreaterThan(15);
      expect(racket - lvl('step', 1), `floor ${fl}`).toBeLessThan(32);
      expect(racket - lvl('bounce', 2), `floor ${fl}`).toBeGreaterThan(4);
      expect(racket).toBeGreaterThan(lvl('grunt', 1));
      expect(racket - dB(rms(b.get('murmur')![0]![0]!.ch[0]!))).toBeGreaterThan(9);
    }
  });
});
