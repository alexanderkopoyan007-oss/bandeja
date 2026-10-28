// Phase 6: what the soundscape asks for over an AI match, recorded instead of played.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, E_FLOOR, E_WALL, E_POINT, PH_TOSS } from '../../src/sim/match.ts';
import { SURF_GLASS } from '../../src/sim/court/court.ts';
import { Soundscape } from '../../src/audio/soundscape.ts';
import type { AudioSink } from '../../src/audio/engine.ts';
import { AUDIO } from '../../src/audio/bank.ts';

class Recorder implements AudioSink {
  live = true;
  plays: Array<{ fam: string; bin: number; gain: number; t: number; x: number; z: number }> = [];
  flats: Array<{ fam: string; bin: number; gain: number; t: number }> = [];
  loops: Array<{ name: string; gain: number; t: number }> = [];
  t = 0;
  play(fam: string, bin: number, x: number, _y: number, z: number, gain: number, rate: number, delay: number): void {
    if (!Number.isFinite(gain) || !Number.isFinite(x) || !Number.isFinite(rate) || !Number.isFinite(delay)) throw new Error(`${fam}: not finite`);
    this.plays.push({ fam, bin, gain, t: this.t, x, z });
  }
  playFlat(fam: string, bin: number, gain: number): void { this.flats.push({ fam, bin, gain, t: this.t }); }
  loop(name: string, gain: number): void { this.loops.push({ name, gain, t: this.t }); }
}

const NONE = [null, null, null, null];

function run(secs: number, arena: string): { rec: Recorder; hits: number; floors: number; glass: number; points: number; tosses: number } {
  const m = new MatchSim({ seed: 4242, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
  const rec = new Recorder();
  const ss = new Soundscape(rec, arena, [-12.5, 12.5]);
  const feet = [{ feet: null }, { feet: null }, { feet: null }, { feet: null }];
  let seen = m.eventSeq, hits = 0, floors = 0, glass = 0, points = 0, tosses = 0, last = -1;
  const dt = 1 / 60;
  for (let f = 0; f < secs * 60; f++) {
    m.step(NONE);
    m.step(NONE);
    while (seen < m.eventSeq) {
      const e = m.events[seen++ % m.events.length]!;
      if (e.kind === E_HIT) hits++;
      if (e.kind === E_FLOOR && e.c > 0.3) floors++;
      if (e.kind === E_WALL && e.a === SURF_GLASS) glass++;
      if (e.kind === E_POINT) points++;
    }
    if (m.phase === PH_TOSS && last !== PH_TOSS) tosses++;
    last = m.phase;
    rec.t = m.time;
    ss.update(m, m.time, feet, dt);
  }
  return { rec, hits, floors, glass, points, tosses };
}

describe('soundscape', () => {
  const r = run(240, 'stadium');
  const count = (fam: string): number => r.rec.plays.filter((p) => p.fam === fam && Math.abs(p.x) < 10).length;

  it('every hit, bounce and glass impact is heard', () => {
    expect(r.hits).toBeGreaterThan(50);
    expect(count('racket')).toBe(r.hits);
    expect(count('bounce')).toBe(r.floors);
    expect(count('glass')).toBeGreaterThanOrEqual(Math.floor(r.glass * 0.9));
    for (const p of r.rec.plays) {
      expect(p.gain).toBeGreaterThan(0);
      expect(p.gain).toBeLessThanOrEqual(1.6);
    }
  });

  it('players grunt on some shots, not all; feet are heard while they move', () => {
    const g = count('grunt');
    expect(g).toBeGreaterThan(0.05 * r.hits);
    expect(g).toBeLessThan(0.6 * r.hits);
    expect(count('step')).toBeGreaterThan(r.hits);
    expect(count('whoosh')).toBeGreaterThanOrEqual(r.hits * 0.9);
  });

  it('the crowd claps most points, hushes for each serve, picks up again between points', () => {
    const claps = r.rec.flats.filter((f) => f.fam === 'applause').length;
    expect(r.points).toBeGreaterThan(8);
    expect(claps).toBeGreaterThan(0.5 * r.points);
    const hush = Math.pow(10, AUDIO.crowd.hush / 20);
    const murmur = r.rec.loops.filter((l) => l.name === 'murmur');
    expect(murmur.filter((l) => Math.abs(l.gain - hush) < 1e-6).length).toBeGreaterThan(0.8 * r.tosses);
    expect(murmur.some((l) => l.gain === 1)).toBe(true);
  });

  it('the courts next door are heard at a club, about a hit a second in their rallies', () => {
    const c = run(120, 'club-day');
    const far = c.rec.plays.filter((p) => p.fam === 'racket' && Math.abs(p.x) > 6);
    // Two neighbours, rallies with pauses: club padel is about 88 impacts in 5 minutes per court.
    expect(far.length).toBeGreaterThan(30);
    expect(far.length).toBeLessThan(250);
    expect(c.rec.flats.some((f) => f.fam === 'cheer')).toBe(false);
  });
});
