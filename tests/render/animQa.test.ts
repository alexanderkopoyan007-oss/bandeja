// The animation QA (src/render/avatar/animQa.ts, `node tools/anim-check.ts`) as a guard: a minute each of AI doubles
// (seed 1 right-handed; seeds 3 and 5 with two left-handers: seed 5's feet flipped 165° before the step fix) must stay
// inside what Phase 3 reached, with some room for match-to-match spread. Measured 2026-10-28 over 60 s each on seeds
// 1, 3 L, 5 L, 6 L: skate 15.6-20.0 cm/s, contact p50 0.9-7.5 mm (p90 2.5-9.2 cm), pops 20-33.5 per player-minute
// (the worst 37-83 degrees; the fastest any joint turned in a frame 62-83 degrees), racket in body 0.10-0.17%, hand
// in torso 0.7-2.2%, thighs through each other 2.2-2.9%; serves: hand in torso 0-0.1%, racket in body 0-0.3%, pops
// 0-19 per minute. Pops: < 40 (35 until the low-ball lunge, which put seed 1 at 34.75; now 33.5).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

describe('animation QA thresholds', () => {
  const a = asset();
  const L = [false, true, true, false];
  for (const [seed, lefty] of [[1, []], [3, L], [5, L]] as Array<[number, boolean[]]>) {
    it(`seed ${seed}${lefty.length ? ' (left-handers)' : ''}`, () => {
      const r = runAnimQa(a, { seed, seconds: 60, lefty, repeatEvery: 7 });
      // Feet: skating (Zhang et al.), planted soles still, never under the floor.
      expect(r.feet.skate).toBeLessThan(25);
      expect(r.feet.belowShare).toBeLessThan(0.001);
      expect(r.feet.planted.p50).toBeLessThan(0.01);
      // The racket meets the ball where and when the sim struck it.
      expect(r.contact.dist.p50).toBeLessThan(0.015);
      expect(r.contact.dist.p90).toBeLessThan(0.12);
      expect(r.contact.lag.p50).toBeLessThan(0.009);
      // Pops (one-frame spikes) and clipping.
      expect(r.pops.perMinute).toBeLessThan(40);
      expect(r.clip.racketBody).toBeLessThan(0.01);
      expect(r.clip.handTorso).toBeLessThan(0.035);
      expect(r.clip.legs).toBeLessThan(0.05);
      // The serve.
      expect(r.serve.handTorso).toBeLessThan(0.005);
      expect(r.serve.racketBody).toBeLessThan(0.015);
      expect(r.serve.popsPerMinute).toBeLessThan(25);
      // Flips: no joint turning 120 degrees or more in a one-frame spike (arms, hands, knees and feet all did,
      // up to 177 degrees, before the hinge solves and the hips' floor).
      const flips = r.pops.worst.filter((e) => e.value >= 120);
      expect(flips).toEqual([]);
      // Nor any joint at all, spike or not (a turn beside a large neighbour is no pop: the step flip was one).
      const fast = Object.entries(r.pops.peaks).filter(([, p]) => p.max / 120 >= 120).map(([g]) => g);
      expect(fast).toEqual([]);
      // The same moment drawn twice (a 165-240 Hz display): nothing moves (it snapped up to 137° when dt 0 was a cut).
      expect(r.repeat.frames).toBeGreaterThan(1000);
      expect(r.repeat.maxDeg).toBeLessThan(0.01);
    }, 120_000);
  }
});
