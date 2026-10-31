// The synthesis against what real padel measures (data/audio-reference.json, docs/research/sound.md). The reference
// numbers are one survey's single hits read off its figures, so the tolerances are as loose as that reading: these
// hold the shape and the balance, not the last dB.
import { describe, expect, it } from 'vitest';
import REF from '../../data/audio-reference.json' with { type: 'json' };
import { AUDIO, arenaAudio, buildBank, racketBin, RQ_CLEAN, APPLAUSE_BIG, type Sample } from '../../src/audio/bank.ts';
import { Biquad, Rng, resample, rt60, SR } from '../../src/audio/dsp.ts';
import { bands, lafmax, mono, peakAndCentroid, powerSpectrum, times } from '../../src/audio/measure.ts';
import { FL_TURF, FL_HARD, impulseResponse, racket, RK_DRIVE, scuff, step } from '../../src/audio/voices.ts';

const bank = buildBank({ floor: FL_TURF, arena: 'stadium' });
const row = (k: string, b: number): Sample[] => bank.get(k)![b]!;
const at48 = (s: Sample): Float32Array => mono(s.ch.map((c) => (s.sr === SR ? c : resample(c, s.sr, SR))));
const laf = (r: Sample[]): number => r.reduce((a, s) => a + lafmax(at48(s)), 0) / r.length;
const TOP = racketBin(0, 2, RQ_CLEAN);

/** RMS distance (dB) from a reference curve after the best level, over its frequencies, power per Hz over a third of an octave. */
function fit(r: Sample[], ref: number[][]): number {
  const fs = ref.map((p) => p[0]!);
  const e = fs.map(() => 0);
  for (const s of r) bands(at48(s), fs, 2 ** (1 / 6)).forEach((d, i) => { e[i] = e[i]! + 10 ** (d / 10); });
  const got = e.map((x, i) => 10 * Math.log10(x / r.length / (fs[i]! * 0.2316)));
  const off = got.reduce((a, d, i) => a + d - ref[i]![1]!, 0) / got.length;
  return Math.sqrt(got.reduce((a, d, i) => a + (d - off - ref[i]![1]!) ** 2, 0) / got.length);
}

describe('against one hit of each on a real court (Wadman et al. 2021)', () => {
  it('the racket: flat to a top near 700 Hz, then falling, no ping and no click', () => {
    expect(fit(row('racket', TOP), REF.psd.racket)).toBeLessThan(5);
    const pc = peakAndCentroid(at48(row('racket', TOP)[0]!));
    expect(pc.peak).toBeGreaterThan(500);
    expect(pc.peak).toBeLessThan(1000);
    // Most of a paddle's power sits low (a pickleball paddle's 80% under 750 Hz, TWU): ours, under 1.5 kHz.
    const { p, df } = powerSpectrum(at48(row('racket', TOP)[0]!), SR, true);
    let lo = 0, tot = 0, top = 0;
    for (let k = 1; k < p.length; k++) { tot += p[k]!; if (k * df < 1500) lo += p[k]!; if (k * df > 12000) top += p[k]!; }
    expect(lo / tot).toBeGreaterThan(0.8);
    // The contact pulse's steps used to leave every render flat to 16 kHz: 45 dB of that is gone at least.
    expect(10 * Math.log10(top / tot)).toBeLessThan(-40);
    // A dry sound: 40 dB down inside the 30 ms Piana et al. give the direct sound.
    expect(times(at48(row('racket', TOP)[0]!)).t40).toBeLessThan(0.035);
  });

  it('the racket is not a tone: no narrow line stands far over its neighbours', () => {
    const x = racket(new Rng(7), RK_DRIVE, 0.6, 0.05, false);
    const { p } = powerSpectrum(x, SR, true);
    let best = 0, sum = 0;
    for (const v of p) { best = Math.max(best, v); sum += v; }
    expect(best / sum).toBeLessThan(0.05);
  });

  it('glass: a thump with a knock in it, about what the racket reads at full pace', () => {
    expect(fit(row('glass', 3), REF.psd.glass)).toBeLessThan(7);
    // 95.4 against 92.5 dBA, for a hit at the glass at stroke pace; ours is its top bin (26 m/s) against the top
    // racket bin (40 m/s against the face), which works out at about +0.5 dB.
    const d = laf(row('glass', 3)) - laf(row('racket', TOP));
    expect(d).toBeGreaterThan(-2);
    expect(d).toBeLessThan(3);
    // A laptop plays nothing under about 200 Hz: most of what the ear gets must be above it.
    expect(peakAndCentroid(at48(row('glass', 3)[0]!)).aCentroid).toBeGreaterThan(400);
  });

  it('mesh: under the racket on a meter, far longer, holding its highs', () => {
    expect(fit(row('mesh', 2), REF.psd.mesh)).toBeLessThan(5);
    const d = laf(row('mesh', 2)) - laf(row('racket', TOP));
    expect(d).toBeGreaterThan(-9.5);
    expect(d).toBeLessThan(-5);
    const t = times(at48(row('mesh', 2)[0]!));
    expect(t.attack).toBeGreaterThan(0.02);
    expect(t.t20).toBeGreaterThan(0.55);
    expect(t.t20).toBeLessThan(1.2);
  });

  it('the cage rings: an outdoor court has the measured T20, and a hit stands clear of the tail', () => {
    const a = arenaAudio('club-day');
    const ir = impulseResponse(new Rng(1), a.room)[0]!;
    const mid = rt60(ir, SR, [Biquad.make('bp', 700, 0.7)]);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.5);
    expect(a.room.rt60[1]).toBeGreaterThan(a.room.rt60[2]);
  });
});

describe('what no survey names stays under what they all do', () => {
  it('feet, swings and shoes are far under the ball; no squeak on sand', () => {
    const racketTop = laf(row('racket', TOP));
    expect(racketTop - laf(row('whoosh', 2))).toBeGreaterThan(15);
    // (bin 1 of the bounce: about 5 m/s, the median bounce in a match)
    expect(laf(row('bounce', 1)) - laf(row('scuff', 0))).toBeGreaterThan(-3);
    expect(racketTop - laf(row('step', 1))).toBeGreaterThan(25);
    // A foot on sand keeps under 3.5 kHz on the meter (grains used to put it at 4.5 kHz, eight times a second).
    expect(peakAndCentroid(step(new Rng(2), FL_TURF, 0.8)).aCentroid).toBeLessThan(3500);
    // The chirp only exists on hard floors: on turf no band is more than a few dB over its neighbours.
    const tone = (b: Float32Array): number => { const { p } = powerSpectrum(b, SR, true); let m = 0, s = 0; for (const v of p) { m = Math.max(m, v); s += v; } return m / s; };
    expect(tone(scuff(new Rng(5), FL_TURF, 0.9))).toBeLessThan(tone(scuff(new Rng(5), FL_HARD, 0.9)));
  });

  it('a stadium\'s big applause reads at most about 10 dB over a hard hit; a bird is under a bounce', () => {
    const pan = -3, near = -1.1; // the near baseline, from the camera
    const hit = laf(row('racket', TOP)) + pan + near;
    expect(laf(row('applause', APPLAUSE_BIG)) - hit).toBeLessThan(10);
    const club = buildBank({ floor: FL_HARD, arena: 'club-day' });
    expect(laf(club.get('bird')![0]!)).toBeLessThan(laf(row('bounce', 2)));
    expect(AUDIO.peak.bird).toBeLessThan(AUDIO.peak.bounce);
  });
});
