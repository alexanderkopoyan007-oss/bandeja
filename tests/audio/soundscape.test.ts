// Phase 6: what the soundscape asks for over an AI match, recorded instead of played.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, E_FLOOR, E_WALL, E_POINT, E_WHIFF, PH_TOSS } from '../../src/sim/match.ts';
import { SHOT_SERVE } from '../../src/sim/contact/shots.ts';
import { SURF_GLASS } from '../../src/sim/court/court.ts';
import { Soundscape, type FeetSource } from '../../src/audio/soundscape.ts';
import type { AudioSink } from '../../src/audio/sink.ts';
import { AUDIO } from '../../src/audio/bank.ts';
import { WHOOSH_PEAK } from '../../src/audio/voices.ts';

interface Play { fam: string; bin: number; gain: number; t: number; x: number; z: number; delay: number; offset: number }

class Recorder implements AudioSink {
  live = true;
  plays: Play[] = [];
  flats: Array<{ fam: string; bin: number; gain: number; t: number }> = [];
  loops: Array<{ name: string; gain: number; tc: number; t: number }> = [];
  t = 0;
  play(fam: string, bin: number, x: number, _y: number, z: number, gain: number, rate: number, delay: number, _bus: number, offset = 0): void {
    if (!Number.isFinite(gain) || !Number.isFinite(x) || !Number.isFinite(rate) || !Number.isFinite(delay) || !Number.isFinite(offset)) throw new Error(`${fam}: not finite`);
    this.plays.push({ fam, bin, gain, t: this.t, x, z, delay, offset });
  }
  playFlat(fam: string, bin: number, gain: number): void { this.flats.push({ fam, bin, gain, t: this.t }); }
  loop(name: string, gain: number, tc: number): void { this.loops.push({ name, gain, tc, t: this.t }); }

  /** The murmur's gain at time t, as WebAudio's setTargetAtTime would have it from the requests so far. */
  murmurAt(t: number): number {
    let g = 0, at = 0, target = 0, tc = 1;
    for (const l of this.loops) {
      if (l.name !== 'murmur' || l.t > t) continue;
      g = target + (g - target) * Math.exp(-(l.t - at) / tc);
      at = l.t; target = l.gain; tc = Math.max(0.01, l.tc);
    }
    return target + (g - target) * Math.exp(-(t - at) / tc);
  }
}

const NONE = [null, null, null, null];

interface Run { rec: Recorder; hits: number; floors: number; glass: number; points: number; tosses: number; whiffs: number; serveAt: number[]; pointAt: number[]; hitAt: Array<{ t: number; p: number }> }

/**
 * An AI doubles match heard frame by frame at `fps`. With `soles`, each player's feet are drawn as an avatar's
 * would be: soles lifting and landing at a runner's cadence while moving, a re-plant now and then while standing.
 */
function run(secs: number, arena: string, fps = 60, soles = false): Run {
  const m = new MatchSim({ seed: 4242, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
  const rec = new Recorder();
  const ss = new Soundscape(rec, arena, [-12.5, 12.5]);
  const feet: FeetSource[] = [0, 1, 2, 3].map(() => ({ feet: soles ? new Float64Array(6) : null }));
  const phase = [0, 0.3, 0.6, 0.9];
  let seen = m.eventSeq, hits = 0, floors = 0, glass = 0, points = 0, tosses = 0, whiffs = 0, last = -1;
  const serveAt: number[] = [], pointAt: number[] = [], hitAt: Array<{ t: number; p: number }> = [];
  const dt = 1 / fps;
  let simT = 0;
  for (let f = 0; f < secs * fps; f++) {
    simT += dt;
    while (m.time < simT) m.step(NONE);
    while (seen < m.eventSeq) {
      const e = m.events[seen++ % m.events.length]!;
      if (e.kind === E_HIT) { hits++; hitAt.push({ t: e.time, p: e.player }); if (e.a === SHOT_SERVE) serveAt.push(e.time); }
      // (within the same 10 m as count(): a ball out over the side wall bounces at 11.7 m in this match)
      if (e.kind === E_FLOOR && e.c > 0.3 && Math.abs(e.x) < 10) floors++;
      if (e.kind === E_WALL && e.a === SURF_GLASS) glass++;
      if (e.kind === E_POINT) { points++; pointAt.push(e.time); }
      if (e.kind === E_WHIFF) whiffs++;
    }
    if (m.phase === PH_TOSS && last !== PH_TOSS) tosses++;
    last = m.phase;
    if (soles) {
      for (let i = 0; i < 4; i++) {
        const p = m.players[i]!;
        const v = Math.hypot(p.vel.x, p.vel.z);
        // Running: a full stride (two landings) per two steps; standing: a slow shuffle of re-plants.
        phase[i] = phase[i]! + (v > 0.5 ? (1.6 + 0.48 * v) / 2 : 0.6) * dt;
        const f3 = feet[i]!.feet!;
        for (let k = 0; k < 2; k++) {
          f3[k * 3] = p.pos.x + (k ? 0.15 : -0.15);
          f3[k * 3 + 1] = Math.max(0, 0.08 * Math.sin(2 * Math.PI * (phase[i]! + 0.5 * k)));
          f3[k * 3 + 2] = p.pos.z;
        }
      }
    }
    rec.t = m.time;
    ss.update(m, m.time, feet, dt);
  }
  return { rec, hits, floors, glass, points, tosses, whiffs, serveAt, pointAt, hitAt };
}

describe('soundscape', () => {
  // 300 s: at level 1 points run long (review round 3's AI: 7 points in 240 s, one short of the clapping check).
  const r = run(300, 'stadium');
  const count = (fam: string, rr: Run = r): number => rr.rec.plays.filter((p) => p.fam === fam && Math.abs(p.x) < 10).length;

  it('every hit, bounce and glass impact is heard', () => {
    expect(r.hits).toBeGreaterThan(50);
    expect(count('racket')).toBe(r.hits);
    expect(count('bounce')).toBe(r.floors);
    expect(count('glass')).toBeGreaterThanOrEqual(Math.floor(r.glass * 0.9));
    for (const p of r.rec.plays) {
      expect(p.gain).toBeGreaterThan(0);
      expect(p.gain).toBeLessThanOrEqual(2.7);
    }
  });

  it('players grunt on some shots, not all; every swing swishes, misses too, peaking just before the contact', () => {
    const g = count('grunt');
    expect(g).toBeGreaterThan(0.05 * r.hits);
    expect(g).toBeLessThan(0.6 * r.hits);
    expect(count('whoosh')).toBeGreaterThanOrEqual((r.hits + r.whiffs) * 0.9);
    // Each hit's swish: its peak against the contact (sim time), within 45 ms before to 20 ms after (a contact is
    // seen the frame after it happens: an AI's release is its contact, so its swish can't start earlier).
    let near = 0, n = 0;
    for (const h of r.hitAt) {
      const w = r.rec.plays.filter((p) => p.fam === 'whoosh' && p.t <= h.t + 0.02 && p.t >= h.t - 0.5);
      if (!w.length) continue;
      const p = w[w.length - 1]!;
      const peakAt = p.t + p.delay - p.offset + WHOOSH_PEAK;
      n++;
      if (peakAt - h.t > -0.045 && peakAt - h.t < 0.02) near++;
    }
    expect(n).toBeGreaterThan(0.8 * r.hits);
    expect(near / n).toBeGreaterThan(0.8);
  });

  it('the crowd claps most points, is hushed by the serve, never gasps at one, and picks up again after the point', () => {
    const claps = r.rec.flats.filter((f) => f.fam === 'applause').length;
    expect(r.points).toBeGreaterThan(8);
    expect(claps).toBeGreaterThan(0.5 * r.points);
    // The level reached at each serve's contact, from the requests as WebAudio follows them.
    const hush = AUDIO.crowd.hush;
    const atServe = r.serveAt.map((t) => 20 * Math.log10(r.rec.murmurAt(t))).sort((a, b) => a - b);
    expect(atServe[Math.floor(atServe.length / 2)]!).toBeLessThan(hush + 3.5);
    // No gasp within half a second of a serve.
    const oohs = r.rec.flats.filter((f) => f.fam === 'ooh');
    expect(oohs.filter((o) => r.serveAt.some((s) => Math.abs(o.t - s) < 0.5)).length).toBe(0);
    // Between points it rises back towards chatter: a request for the chatter level after most points.
    const chatter = Math.pow(10, AUDIO.crowd.chatter / 20);
    const up = r.pointAt.filter((t) => r.rec.loops.some((l) => l.name === 'murmur' && l.t >= t - 1e-9 && l.t < t + 2 && Math.abs(l.gain - chatter) < 1e-6));
    expect(up.length).toBeGreaterThan(0.8 * r.pointAt.length);
  });

  it('feet from the soles: steps land, louder running than standing; scuffs the same at 60 and 144 fps', () => {
    const a = run(120, 'stadium', 60, true), b = run(120, 'stadium', 144, true);
    const steps = a.rec.plays.filter((p) => p.fam === 'step');
    expect(steps.length).toBeGreaterThan(200);
    // (gains by the step's bin and gain: the heard level is bin level x gain; bin 1 is the louder)
    const level = (p: Play): number => (p.bin === 1 ? 0.8 : 0.3) * p.gain;
    const sorted = steps.map(level).sort((x, y) => x - y);
    expect(sorted[Math.floor(sorted.length * 0.9)]! / sorted[Math.floor(sorted.length * 0.1)]!).toBeGreaterThan(2.5);
    const sa = a.rec.plays.filter((p) => p.fam === 'scuff').length, sb = b.rec.plays.filter((p) => p.fam === 'scuff').length;
    expect(sa).toBeGreaterThan(3);
    expect(Math.abs(sa - sb)).toBeLessThanOrEqual(Math.max(3, 0.35 * sa));
  });

  it('the courts next door are heard at a club, about a hit a second in their rallies; birds call now and then', () => {
    const c = run(300, 'club-day');
    const far = c.rec.plays.filter((p) => p.fam === 'racket' && Math.abs(p.x) > 6);
    // Two neighbours at 7.3 hits a rally, 1.25 s apart, 14.5 s between points: about 195 in 300 s. (Rally lengths are
    // geometric: over 120 s, where about 78 were expected, a change to the match gave 48, by the sound engine's
    // random stream alone.)
    expect(far.length).toBeGreaterThan(125);
    expect(far.length).toBeLessThan(300);
    expect(c.rec.flats.some((f) => f.fam === 'cheer')).toBe(false);
    const birds = c.rec.plays.filter((p) => p.fam === 'bird');
    expect(birds.length).toBeGreaterThan(30);
    expect(birds.length).toBeLessThan(200);
    expect(r.rec.plays.some((p) => p.fam === 'bird')).toBe(false);
  });
});
