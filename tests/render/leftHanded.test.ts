// A left-hander's families are named `${name}-left`, so a test on `fam.name` is false for them: Rounds 21-23's plant,
// scissor and serve hold never reached a left-hander's arm (review round 30). Name tests go through rightFamily.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stroke family names', () => {
  it('are read through rightFamily', () => {
    const src = readFileSync(new URL('../../src/render/avatar/avatar.ts', import.meta.url), 'utf8');
    expect(src.match(/(?<!rightFamily\()this\.fam\.name/g) ?? []).toEqual([]);
  });
});
