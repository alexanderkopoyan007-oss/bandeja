// The animation QA (src/render/avatar/animQa.ts, `node tools/anim-check.ts`) as a guard: a minute each of AI doubles
// (seed 1 right-handed; seeds 3 and 5 with two left-handers: seed 5's feet flipped 165° before the step fix) must stay
// inside what Phase 3 reached, with some room for match-to-match spread. Measured 2026-10-28 (after the second
// review's fixes) over 60 s each on seeds 1, 3 L, 5 L, 6 L: skate 15.3-19.5 cm/s, contact p50 0.9-7.5 mm (p90
// 2.5-9.2 cm), pops 15.3-21.8 per player-minute (were 20-33.5; the fastest any joint turned in a frame 54-81
// degrees), racket in body 0.09-0.17%, hand in torso 0.7-2.1%, thighs through each other 2.3-3.0%; serves: hand in
// torso 0%, racket in body 0-0.4%, pops 0-6.4 per minute. Over 24 seeds both ways x 120 s (final review fixes)
// no joint turned more than 96 degrees in a frame (165-173 before the knee and lunge fixes), pops averaged 13.6 per
// player-minute (at most 18.4), thighs through each other 2.8% (at most 3.4%) and no knee spun round.
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { expectAnimQa } from './qaThresholds.ts';

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
      expectAnimQa(r);
    }, 120_000);
  }
});
