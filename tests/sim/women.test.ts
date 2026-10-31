import { describe, expect, it } from 'vitest';
import { E_FLOOR, E_HIT, E_POINT, E_WALL, MatchSim, PH_OVER } from '../../src/sim/match.ts';
import { SimpleAi } from '../../src/sim/ai/simpleAi.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { WALL_BACK_FAR, WALL_BACK_NEAR } from '../../src/sim/court/court.ts';
import { DEFAULT_TUNING } from '../../src/sim/player/player.ts';

const make = (women: boolean) => new MatchSim({ seed: 11, doubles: true, human: [false, false, false, false], aiLevel: [1, 1], women });

/** Smashes in AI women's matches, bajadas apart: their speeds (km/h) and how many were the point's last shot and won it. */
function smashes(points: number) {
  const speeds: number[] = [];
  let wins = 0, done = 0;
  for (let seed = 1; done < points; seed++) {
    const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [1, 1], women: true });
    const frames = [null, null, null, null];
    let seq = 0, floors = 0, glass = false, last = -1, lastSmash = false;
    while (m.phase !== PH_OVER && done < points) {
      m.step(frames);
      for (; seq < m.eventSeq; seq++) {
        const e = m.events[seq % m.events.length]!;
        if (e.kind === E_HIT) {
          lastSmash = SHOT_KEYS[e.a] === 'smash' && !glass;
          last = e.team;
          if (lastSmash) speeds.push(e.c * 3.6);
          floors = 0;
          glass = false;
        } else if (e.kind === E_FLOOR) floors++;
        else if (e.kind === E_WALL && floors > 0 && (e.b === WALL_BACK_NEAR || e.b === WALL_BACK_FAR)) glass = true;
        else if (e.kind === E_POINT) {
          done++;
          if (lastSmash && e.team === last) wins++;
          lastSmash = false;
        }
      }
    }
  }
  return { speeds, wins };
}

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

  // Flat smashes win 33.3%, topspin ones 29.2% (Sánchez-Alcaraz et al. 2020). Nothing held this before: the first fit of
  // smashEffort went stale as the rest of the game moved, and overheads stopped finishing. Twelve runs of 400 points
  // like this one (seeds 1+ and 201+) gave medians of 115-119 km/h and W 22-39 (n 88-142); with 0.73 eight runs from a
  // dump gave 103-105 km/h and W 6-12.
  it('a smash is hit hard enough to finish the point about a third of the time', () => {
    const { speeds, wins } = smashes(400);
    const median = [...speeds].sort((a, b) => a - b)[speeds.length >> 1]!;
    expect(median).toBeGreaterThan(112);
    expect(median).toBeLessThan(122);
    expect(wins / speeds.length).toBeGreaterThan(0.18);
    expect(wins / speeds.length).toBeLessThan(0.44);
  }, 300_000);

  it("leaves a men's match as it was: top speed and effort from the same tables", () => {
    expect(make(false).players[0]!.tune).toBe(DEFAULT_TUNING);
  });
});
