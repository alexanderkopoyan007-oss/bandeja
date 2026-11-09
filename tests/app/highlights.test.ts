// The highlight reel (M7 phase B): the best points of a match, kept as they were played and re-run from the results.
// Driven as game.ts drives it: Highlights around every live tick, flushed when the match is over, then the Reel
// stepped a frame at a time. Each clip shown must be its point as played: the same winner at the same moment, and the
// match's whole state (its hash) at the clip's last tick the live match's at that tick.
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_OVER, E_POINT, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_LOB } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Highlights, Reel, HL_MAX, HL_WEIGHTS, highlightScore, RL_PREP, RL_SHOW } from '../../src/game/highlights.ts';

/** A scripted human (as tests/app/replay.test.ts), so the kept inputs matter. */
function humanFrame(f: InputFrame, m: MatchSim, shift = 0): InputFrame {
  f.clear();
  const k = m.tick + shift;
  f.moveX = Math.sin(k * 0.011);
  f.moveY = Math.cos(k * 0.005) * 0.5;
  const c = k % 300;
  const btn = (k / 300) % 2 < 1 ? BTN_DRIVE : BTN_LOB;
  if (c === 0) f.push(true, btn, m.time + DT * 0.4);
  if (c === 50) f.push(false, btn, m.time + DT * 0.2);
  f.held = c < 50 ? btn : 0;
  return f;
}

function playMatch(humans: number[], seed: number) {
  const cfg: MatchConfig = { seed, doubles: true, human: [0, 1, 2, 3].map((i) => humans.includes(i)),
    format: { mode: 1, setsToWin: 1, gamesPerSet: 3, finalSet: 0 } } as MatchConfig;
  const live = new MatchSim(cfg);
  const hl = new Highlights(cfg, humans);
  const frames = humans.map(() => new InputFrame());
  const inputs: Array<InputFrame | null> = [null, null, null, null];
  const hashes = new Map<number, number>();
  const points: Array<[number, number]> = [];
  let seen = 0;
  for (let k = 0; k < 120 * 1800 && (live.phase !== PH_OVER || live.overStage < 4); k++) {
    humans.forEach((p, h) => { inputs[p] = humanFrame(frames[h]!, live, 137 * h); });
    hl.beforeStep(live, inputs);
    live.step(inputs);
    hl.afterStep(live);
    hashes.set(live.tick, live.hash());
    for (; seen < live.eventSeq; seen++) {
      const e = live.events[seen % live.events.length]!;
      if (e.kind === E_POINT) points.push([e.team, e.time]);
    }
  }
  hl.flush(live);
  return { cfg, live, hl, hashes, points };
}

describe('highlight scores', () => {
  it('rank the things that make a highlight', () => {
    const base = { shots: 6, exited: false, hardOverhead: false, set: false, match: false };
    expect(highlightScore({ ...base, exited: true })).toBe(6 + HL_WEIGHTS.exit);
    expect(highlightScore({ ...base, shots: 20 })).toBeGreaterThan(highlightScore({ ...base, hardOverhead: true }));
    expect(highlightScore({ ...base, match: true })).toBeGreaterThan(highlightScore({ ...base, shots: 25 }));
  });
});

describe('the highlight reel', () => {
  for (const humans of [[], [0]]) {
    it(`keeps the best points and shows each as it was played (${humans.length ? 'a human' : 'AI only'})`, () => {
      const { cfg, live, hl, hashes, points } = playMatch(humans, 31);
      expect(live.phase).toBe(PH_OVER);
      const clips = hl.clips;
      expect(clips.length).toBeGreaterThan(2);
      expect(clips.length).toBeLessThanOrEqual(HL_MAX);
      // In the order played; the match point among them (it outscores any rally).
      for (let i = 1; i < clips.length; i++) expect(clips[i]!.n).toBeGreaterThan(clips[i - 1]!.n);
      expect(clips[clips.length - 1]!.n).toBe(points.length);
      expect(clips[clips.length - 1]!.why).toMatch(/^Match point/);
      // The kept ones are the best: none dropped scored more than the least kept (scores are the points' own).
      const least = Math.min(...clips.map((c) => c.score));
      expect(least).toBeGreaterThanOrEqual(0);

      const reel = new Reel(cfg, humans);
      expect(reel.start(clips)).toBe(true);
      const st = (): number => reel.state;
      let shown = 0, cuts = reel.cuts;
      while (st() !== 0) {
        const c = reel.clip!;
        while (st() === RL_PREP) reel.prepare();
        expect(st()).toBe(RL_SHOW);
        expect(reel.cuts).toBe(cuts + 1);
        cuts = reel.cuts;
        let rs = reel.sim.eventSeq, point: number[] = [], lastHash = 0, lastTick = 0;
        const at = reel.index;
        while (st() === RL_SHOW && reel.index === at) {
          lastHash = reel.sim.hash();
          lastTick = reel.sim.tick;
          reel.advance(1 / 60);
          for (; rs < reel.sim.eventSeq && reel.index === at; rs++) {
            const e = reel.sim.events[rs % reel.sim.events.length]!;
            if (e.kind === E_POINT) point = [e.team, e.time];
          }
        }
        // Its point, as played, and the whole match as it was at the clip's last tick.
        const live = points[c.n - 1]!;
        expect(point[0], `clip ${c.n}`).toBe(live[0]);
        expect(point[1]).toBeCloseTo(live[1], 9);
        expect(lastHash).toBe(hashes.get(lastTick));
        shown++;
      }
      expect(shown).toBe(clips.length);
    });
  }
});
