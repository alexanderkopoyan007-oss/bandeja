// The animation QA (src/render/avatar/animQa.ts, `node tools/anim-check.ts`) as a guard: two minutes of AI doubles
// (one with two left-handers) must stay inside what Phase 3 reached, with some room for match-to-match spread.
// Measured 2026-10-28 over 60 s each on seeds 1, 3, 5, 6: skate 16-21 cm/s, contact p50 0.6-6 mm, pops 34-49 per
// player-minute, racket in body 1.3-2.9%, hand in torso 2.9-4.2%, thighs through each other 2.3-4.0%; serves:
// hand in torso 0, racket in body 0-1.8%, pops 0-13 per minute.
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
  for (const [seed, lefty] of [[1, []], [3, [false, true, true, false]]] as Array<[number, boolean[]]>) {
    it(`seed ${seed}${lefty.length ? ' (left-handers)' : ''}`, () => {
      const r = runAnimQa(a, { seed, seconds: 60, lefty });
      // Feet: skating (Zhang et al.), planted soles still, never under the floor.
      expect(r.feet.skate).toBeLessThan(25);
      expect(r.feet.belowShare).toBeLessThan(0.001);
      expect(r.feet.planted.p50).toBeLessThan(0.01);
      // The racket meets the ball where and when the sim struck it.
      expect(r.contact.dist.p50).toBeLessThan(0.015);
      expect(r.contact.dist.p90).toBeLessThan(0.12);
      expect(r.contact.lag.p50).toBeLessThan(0.009);
      // Pops (one-frame spikes) and clipping.
      expect(r.pops.perMinute).toBeLessThan(60);
      expect(r.clip.racketBody).toBeLessThan(0.035);
      expect(r.clip.handTorso).toBeLessThan(0.055);
      expect(r.clip.legs).toBeLessThan(0.05);
      // The serve.
      expect(r.serve.handTorso).toBeLessThan(0.005);
      expect(r.serve.racketBody).toBeLessThan(0.03);
      expect(r.serve.popsPerMinute).toBeLessThan(25);
      // Worst arm flips: no forearm or hand turning 150 degrees or more in a frame.
      const flips = r.pops.worst.filter((e) => /Arm|Hand/.test(e.what) && e.value >= 150);
      expect(flips).toEqual([]);
    }, 120_000);
  }
});
