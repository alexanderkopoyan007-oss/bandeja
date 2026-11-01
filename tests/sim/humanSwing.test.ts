import { describe, expect, it } from 'vitest';
import { humanMotor } from '../../src/sim/ai/simpleAi.ts';
import { G_EARLY, G_GOOD, G_LATE, G_PERFECT, G_TOO_EARLY, G_TOO_LATE } from '../../src/sim/contact/timing.ts';

describe("a human's swing", () => {
  it('is steadier the better it is timed', () => {
    expect(humanMotor(G_PERFECT, 0)).toBeLessThan(humanMotor(G_GOOD, 0));
    expect(humanMotor(G_GOOD, 0)).toBeLessThan(humanMotor(G_EARLY, 0));
    expect(humanMotor(G_EARLY, 0)).toBe(humanMotor(G_LATE, 0));
    expect(humanMotor(G_LATE, 0)).toBeLessThan(humanMotor(G_TOO_LATE, 0));
    expect(humanMotor(G_TOO_EARLY, 0)).toBe(humanMotor(G_TOO_LATE, 0));
  });

  it('is never free of error, and worse under pressure', () => {
    expect(humanMotor(G_PERFECT, 0)).toBeGreaterThan(0);
    expect(humanMotor(G_PERFECT, 1)).toBeGreaterThan(3 * humanMotor(G_PERFECT, 0));
  });
});
