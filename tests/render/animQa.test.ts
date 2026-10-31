// The animation QA (src/render/avatar/animQa.ts, `node tools/anim-check.ts`) as a guard: a minute each of AI doubles
// (seed 1 right-handed; seeds 3 and 5 with two left-handers: seed 5's feet flipped 165° before the step fix) must stay
// inside what Phase 3 reached, with some room for match-to-match spread. Measured 2026-10-28 (after the second
// review's fixes) over 60 s each on seeds 1, 3 L, 5 L, 6 L: skate 15.3-19.5 cm/s, contact p50 0.9-7.5 mm (p90
// 2.5-9.2 cm), pops 15.3-21.8 per player-minute (were 20-33.5; the fastest any joint turned in a frame 54-81
// degrees), racket in body 0.09-0.17%, hand in torso 0.7-2.1%, thighs through each other 2.3-3.0%; serves: hand in
// torso 0%, racket in body 0-0.4%, pops 0-6.4 per minute. Over 24 seeds both ways x 120 s (final review fixes)
// no joint turned more than 96 degrees in a frame (165-173 before the knee and lunge fixes), pops averaged 13.6 per
// player-minute (at most 18.4), thighs through each other 2.8% (at most 3.4%) and no knee spun round.
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
      // The racket meets the ball where and when the sim struck it. (2 cm, under the ball's radius: a minute holds
      // 21-29 contacts, so the median follows the shot mix; drives sit at 1.9-3.3 cm, volleys and lobs under 1 cm.
      // Review round 3 moved seed 3's minute to more drives: 1.56 cm, over the old 1.5.)
      expect(r.contact.dist.p50).toBeLessThan(0.02);
      expect(r.contact.dist.p90).toBeLessThan(0.12);
      expect(r.contact.lag.p50).toBeLessThan(0.009);
      // Backhands side-on at the hit, the racket-side shoulder to the net (review round 3, the pro's #4: the chest
      // was 13 degrees off square, a push; 59-81 over six seeds after the side-on keys). Forehands stay open.
      const bh = r.contact.chest['backhand'], fh = r.contact.chest['forehand'];
      if (bh && bh.n >= 3) expect(bh.p50).toBeGreaterThan(45);
      if (fh && fh.n >= 3) expect(fh.p50).toBeLessThan(55);
      // Pops (one-frame spikes) and clipping.
      expect(r.pops.perMinute).toBeLessThan(30);
      expect(r.clip.racketBody).toBeLessThan(0.01);
      expect(r.clip.handTorso).toBeLessThan(0.035);
      expect(r.clip.legs).toBeLessThan(0.07);
      // The serve.
      expect(r.serve.handTorso).toBeLessThan(0.005);
      expect(r.serve.racketBody).toBeLessThan(0.015);
      // (a 60 s sample holds a few serves: 7 a minute over eight seeds of 120 s, 0-18 by seed, one pop moves it by 7)
      expect(r.serve.popsPerMinute).toBeLessThan(40);
      // Flips: no joint turning 105 degrees or more in a one-frame spike (arms, hands, knees and feet all did,
      // up to 177 degrees, before the hinge solves, the hips' floor, the knee's side and the lunge's fade).
      const flips = r.pops.worst.filter((e) => e.value >= 105);
      expect(flips).toEqual([]);
      // Nor any joint at all, spike or not (a turn beside a large neighbour is no pop: the step flip was one).
      const fast = Object.entries(r.pops.peaks).filter(([, p]) => p.max / 120 >= 105).map(([g]) => g);
      expect(fast).toEqual([]);
      // No knee turning round more than 150 degrees within a tenth of a second (smeared over frames, so neither rule
      // above sees it: 14 in 24 seeds both ways x 120 s before the knee's pole came off the hip-to-ankle line).
      expect(r.pops.kneeSpins).toEqual([]);
      // The same moment drawn twice (a 165-240 Hz display): nothing moves (it snapped up to 137° when dt 0 was a cut).
      expect(r.repeat.frames).toBeGreaterThan(1000);
      expect(r.repeat.maxDeg).toBeLessThan(0.01);
    }, 120_000);
  }
});
