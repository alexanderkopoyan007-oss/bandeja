// The stadium's recorded applause (data/audio.json takes, CREDITS.md): the shipped file parses into the manifest's
// takes, and the bank plays them levelled like the synthesis, in the stadium only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { peak, rms } from '../../src/audio/dsp.ts';
import { AUDIO, APPLAUSE_BIG, APPLAUSE_SMALL, activeRms, buildBank, clapBed, parseTakes, wantsTakes } from '../../src/audio/bank.ts';
import { FL_TURF, LO_SR } from '../../src/audio/voices.ts';

const file = readFileSync(new URL('../../public/' + AUDIO.takes.file, import.meta.url));
const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const takes = parseTakes(buf)!;

describe('recorded applause', () => {
  it('the shipped file holds the manifest\'s takes: stereo, each as long as listed, sounding, fading out', () => {
    expect(takes).not.toBeNull();
    expect(takes.sr).toBe(LO_SR);
    for (const [bin, list] of [[APPLAUSE_SMALL, AUDIO.takes.small], [APPLAUSE_BIG, AUDIO.takes.big]] as const) {
      expect(takes.takes[bin]!.length).toBe(list.length);
      takes.takes[bin]!.forEach((ch, k) => {
        expect(ch.length).toBe(2);
        expect(ch[0]!.length).toBe(Math.round(list[k]![1]! * LO_SR));
        expect(rms(ch[0]!)).toBeGreaterThan(0.01);
        // (no click in: the first sample is near silence; out: the last 10 ms are 30 dB under the take)
        expect(Math.abs(ch[0]![0]!)).toBeLessThan(0.02);
        const n = ch[0]!.length, tail = ch[0]!.subarray(n - Math.round(0.01 * LO_SR));
        expect(rms(tail)).toBeLessThan(rms(ch[0]!) * 0.03);
      });
    }
  });

  it('is only the stadium\'s, and a file that is not what the manifest says is refused', () => {
    expect(wantsTakes('stadium')).toBe(true);
    for (const a of ['hall', 'club-day', 'club-night']) expect(wantsTakes(a)).toBe(false);
    const wrong = new Uint8Array(buf.slice(0));
    new DataView(wrong.buffer).setUint32(24, 44100, true);
    expect(parseTakes(wrong.buffer)).toBeNull();
    expect(parseTakes(new ArrayBuffer(10))).toBeNull();
  });

  it('the stadium plays the takes at the applause level, under the peak cap; a club keeps its clappers', () => {
    const stadium = buildBank({ floor: FL_TURF, arena: 'stadium', takes }).get('applause')!;
    let top = 0;
    for (let b = 0; b < 2; b++) stadium[b]!.forEach((s, v) => {
      const t = takes.takes[b]![v]!;
      // the recording itself, scaled: the same shape
      const k = s.ch[0]![LO_SR]! / t[0]![LO_SR]!;
      expect(Math.abs(s.ch[1]![LO_SR + 7]! - t[1]![LO_SR + 7]! * k)).toBeLessThan(1e-6);
      top = Math.max(top, activeRms(s.ch[0]!), activeRms(s.ch[1]!));
      expect(20 * Math.log10(peak(s.ch[0]!))).toBeLessThanOrEqual(-9 + 1e-6);
    });
    expect(20 * Math.log10(top)).toBeLessThanOrEqual(AUDIO.rms.applause + 1e-6);
    expect(20 * Math.log10(top)).toBeGreaterThan(AUDIO.rms.applause - 6);
    const club = buildBank({ floor: FL_TURF, arena: 'club-day', takes }).get('applause')!;
    expect(club[APPLAUSE_BIG]![0]!.ch[0]!.length).not.toBe(takes.takes[APPLAUSE_BIG]![0]![0]!.length);
  });

  it('nobody talks between points: the stadium\'s bed is clapping from the takes that loops without a seam, a club\'s is quiet', () => {
    const bed = clapBed(takes);
    expect(bed.length).toBe(2);
    expect(bed[0]!.length / LO_SR).toBeGreaterThan(8);
    // steady (no 250 ms window 10 dB under the bed), and the wrap no bigger a step than the bed's own
    const w = Math.round(0.25 * LO_SR), all = rms(bed[0]!);
    for (let i = 0; i + w <= bed[0]!.length; i += w) expect(rms(bed[0]!.subarray(i, i + w))).toBeGreaterThan(all * 0.316);
    let step = 0;
    for (let i = 1; i < bed[0]!.length; i++) step = Math.max(step, Math.abs(bed[0]![i]! - bed[0]![i - 1]!));
    expect(Math.abs(bed[0]![0]! - bed[0]![bed[0]!.length - 1]!)).toBeLessThanOrEqual(step);
    const stadium = buildBank({ floor: FL_TURF, arena: 'stadium', takes }).get('murmur')![0]![0]!;
    expect(20 * Math.log10(rms(stadium.ch[0]!))).toBeGreaterThan(AUDIO.rms.murmur - 3);
    const club = buildBank({ floor: FL_TURF, arena: 'club-day', takes }).get('murmur')![0]![0]!;
    expect(peak(club.ch[0]!)).toBe(0);
  });
});
