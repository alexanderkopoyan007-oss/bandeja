import { describe, expect, it } from 'vitest';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { mannequinWithPeople } from './people.ts';

// Partners tap rackets after a point in the walk back, and the soundscape hears each touch once.
describe('the racket tap', () => {
  const p = mannequinWithPeople().people[0]!;
  const seen = [0, 0, 0, 0], by = { walk: 0, ends: 0 };
  let near = 0, far = 0;
  runAnimQa(p, { seed: 5, seconds: 420, lefty: [], onFrame: (m, av) => {
    av.forEach((raw, i) => {
      const a = raw as unknown as { tapSeq: number; tapAt: Float64Array };
      if (a.tapSeq === seen[i]) return;
      seen[i] = a.tapSeq;
      if (m.walking === 3) by.ends++; else by.walk++;
      if (i === 0 || i === 1) near++; else far++;
      expect(a.tapAt[1]).toBeGreaterThan(1);
    });
  } });

  it('touches in the walk back', () => {
    expect(by.walk).toBeGreaterThan(5);
  });

  // At a change of ends partners meet before walking to their post (they never came within reach on the straight walk).
  it('touches at the change of ends', () => {
    expect(by.ends).toBeGreaterThan(1);
  });

  it('one of each pair counts the touch, so it sounds once', () => {
    expect(far).toBe(0);
    expect(near).toBe(by.walk + by.ends);
  });
});
