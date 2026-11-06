// The animation QA (animQa.test.ts's thresholds) on bodies the creator reshapes past anything real (data/bodies.json,
// src/render/avatar/proportions.ts), the leg at both ends of LEG_SPAN: the racket must still meet the ball and the legs
// must still walk. Two minutes each (one held four serves, and four pops of 6-8 degrees read as 49 a minute), men and
// women, left-handers on the seeds marked; two files run side by side. Not p7 or the guest meshy: as modelled their thighs
// already overlap past the threshold (9.2% and 8.0% of frames on seed 1; REVIEW.md).
import { describe, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { bodyNamed, reproportion } from '../../src/render/avatar/proportions.ts';
import { mannequinWithPeople } from './people.ts';
import { expectAnimQa } from './qaThresholds.ts';

describe('animation QA on reshaped bodies', () => {
  const base = mannequinWithPeople();
  const L = [false, true, true, false];
  const cases: Array<[string, string, number, boolean]> = [['giant-head', 'p1', 5, true], ['tiny-legs', 'p8', 3, true], ['long-arms', 'p4', 1, false], ['long-legs', 'p2', 3, true]];
  for (const [body, who, seed, lefty] of cases) {
    it(`${body} (${who}, seed ${seed}${lefty ? ', left-handers' : ''})`, () => {
      const person = base.people.find((p) => p.look!.name === who)!;
      const r = runAnimQa(reproportion(person, bodyNamed(body)), { seed, seconds: 120, lefty: lefty ? L : [], repeatEvery: 7 });
      expectAnimQa(r);
    }, 180_000);
  }
});
