// The face driver (src/render/avatar/face.ts): the mouth a MetaHuman build holds at rest.
import { describe, expect, it } from 'vitest';
import { FaceDriver, REST_SMILE, type FaceInput } from '../../src/render/avatar/face.ts';

const NAMES = ['blinkL', 'blinkR', 'squint', 'browDown', 'browInnerUp', 'browUp', 'jawOpen', 'mouthPress', 'smile', 'grimace', 'sneer', 'neckTense', 'lookLeft', 'lookRight', 'lookUp', 'lookDown'];
const SMILE = NAMES.indexOf('smile'), PRESS = NAMES.indexOf('mouthPress');
const idle: FaceInput = { toContact: Infinity, sinceContact: -1, strain: 0, grunt: false, puff: 0, mood: 0, moodT: 0, gazeYaw: 0, gazePitch: 0 };
const after = (rest: number, f: Partial<FaceInput>): Float32Array => {
  const d = new FaceDriver(NAMES, 3, rest);
  d.update(1 / 60, { ...idle, ...f });
  return d.influences;
};

describe('face: the mouth at rest', () => {
  it('a MetaHuman build holds a little of its smile when nothing else has the mouth, and no one else does', () => {
    expect(REST_SMILE).toBeGreaterThan(0.2);
    expect(REST_SMILE).toBeLessThan(0.4);
    expect(after(REST_SMILE, {})[SMILE]).toBeCloseTo(REST_SMILE, 6);
    expect(after(0, {})[SMILE]).toBe(0);
    // (the default is none: a MakeHuman build's mouth is level as modelled)
    const d = new FaceDriver(NAMES, 3);
    d.update(1 / 60, idle);
    expect(d.influences[SMILE]).toBe(0);
  });

  it('gives way to effort at a contact, to a grunt and to a lost point; a won point smiles more', () => {
    // At the contact of a hard stroke the lips are pressed, with none of the smile.
    const hit = after(REST_SMILE, { toContact: 0, strain: 1 });
    expect(hit[SMILE]).toBeCloseTo(0, 6);
    expect(hit[PRESS]).toBeGreaterThan(0.5);
    // Half way into the effort, half way out of the smile (it eases, never jumps).
    const half = after(REST_SMILE, { toContact: 0.125, strain: 1 })[SMILE]!;
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(REST_SMILE - 0.05);
    expect(after(REST_SMILE, { sinceContact: 0.1, grunt: true, strain: 0 })[SMILE]).toBeCloseTo(0, 6);
    expect(after(REST_SMILE, { mood: -1, moodT: 1 })[SMILE]).toBeCloseTo(0, 6);
    expect(after(REST_SMILE, { mood: 1, moodT: 1 })[SMILE]).toBeCloseTo(0.75, 6);
    // (and the same won smile for a build with no resting one)
    expect(after(0, { mood: 1, moodT: 1 })[SMILE]).toBeCloseTo(0.75, 6);
  });
});
