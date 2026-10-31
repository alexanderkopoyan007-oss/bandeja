// A simulated match through a model of the whole chain (src/audio/offline.ts): what comes out, not what goes in.
import { describe, expect, it } from 'vitest';
import { AUDIO } from '../../src/audio/bank.ts';
import { aWeight, fastMax } from '../../src/audio/measure.ts';
import { OfflineEngine, offlineBank } from '../../src/audio/offline.ts';
import { Soundscape, type FeetSource } from '../../src/audio/soundscape.ts';
import { FL_TURF } from '../../src/audio/voices.ts';
import { MatchSim } from '../../src/sim/match.ts';

const SECS = 30;
const env = { floor: FL_TURF, arena: 'club-day' };
const bank = offlineBank(env);
const eng = new OfflineEngine({ env, secs: SECS, bank, listener: { x: 0, y: 7.6, z: 25.5, fx: 0, fy: -0.25, fz: -1 } });
{
  const m = new MatchSim({ seed: 77, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
  const ss = new Soundscape(eng, env.arena, [-12.5, 12.5]);
  const feet: FeetSource[] = [null, null, null, null].map(() => ({ feet: null }));
  const none = [null, null, null, null];
  for (let f = 0; f < SECS * 60; f++) {
    const t = (f + 1) / 60;
    eng.now = t;
    while (m.time < t) m.step(none as never);
    ss.update(m, t, feet, 1 / 60);
  }
}
const laf = (k: string): number => fastMax(aWeight(eng.render(new Set([k])).L));

describe('through the whole chain', () => {
  it('leaves the limiter idle in play and stays in range', () => {
    const r = eng.render();
    let gr = 0, pk = 0;
    for (let i = 0; i < r.gr.length; i++) { gr = Math.min(gr, r.gr[i]!); pk = Math.max(pk, Math.abs(r.L[i]!), Math.abs(r.R[i]!)); }
    expect(gr).toBeGreaterThan(-2);
    expect(pk).toBeLessThan(1);
    expect(AUDIO.limiter.threshold).toBeLessThan(0);
  });

  it('the racket leads what it should, on a meter at the camera', () => {
    const racket = laf('racket');
    expect(racket - laf('bounce')).toBeGreaterThan(6);
    expect(racket - laf('scuff')).toBeGreaterThan(14);
    expect(racket - laf('step')).toBeGreaterThan(14);
    expect(racket - laf('whoosh')).toBeGreaterThan(14);
    expect(racket - laf('bird')).toBeGreaterThan(6);
  });
});
