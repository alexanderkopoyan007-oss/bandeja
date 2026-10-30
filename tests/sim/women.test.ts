import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { SimpleAi } from '../../src/sim/ai/simpleAi.ts';
import { DEFAULT_TUNING } from '../../src/sim/player/player.ts';

const make = (women: boolean) => new MatchSim({ seed: 11, doubles: true, human: [false, false, false, false], aiLevel: [1, 1], women });

describe("a women's match", () => {
  it('moves and hits as women do, and is the same match for a seed', () => {
    const m = make(true);
    expect(m.players[0]!.tune.maxSpeed).toBeLessThan(DEFAULT_TUNING.maxSpeed);
    const w = m.ai[0] as SimpleAi, men = make(false).ai[0] as SimpleAi;
    expect(w.smashEffort()).toBeLessThan(men.smashEffort());
    expect(w.serveEffort()).toBeLessThan(men.serveEffort());
    expect(w.style.smash).toBeLessThan(men.style.smash);
    const a = make(true), b = make(true), inp = [null, null, null, null];
    for (let i = 0; i < 6000; i++) { a.step(inp); b.step(inp); }
    expect(a.hash()).toBe(b.hash());
  });

  it("leaves a men's match as it was: top speed and effort from the same tables", () => {
    expect(make(false).players[0]!.tune).toBe(DEFAULT_TUNING);
  });
});
