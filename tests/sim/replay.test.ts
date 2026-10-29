import { describe, expect, it } from 'vitest';
import { MatchSim, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';

// Replays (review round 3, critic High #4) re-run a point from a copy of the match taken at its start
// (MatchSim.copyFrom), with the human's recorded inputs: the copy must play the same ticks.

/** A scripted human: moves about and presses and lets go of the drive key, from the tick alone. */
function humanFrame(f: InputFrame, tick: number, time: number): InputFrame {
  f.clear();
  f.moveX = Math.sin(tick * 0.013);
  f.moveY = Math.cos(tick * 0.007) * 0.6;
  const k = tick % 260;
  if (k === 0) f.push(true, BTN_DRIVE, time + DT * 0.3);
  if (k === 40) f.push(false, BTN_DRIVE, time + DT * 0.6);
  f.held = k < 40 ? BTN_DRIVE : 0;
  return f;
}

describe('a match copied (replays)', () => {
  for (const human of [false, true]) {
    it(`plays on tick for tick like the original (${human ? 'a human' : 'AI only'})`, () => {
      const cfg: MatchConfig = { seed: 3, doubles: true, human: [human, false, false, false] };
      const live = new MatchSim(cfg);
      const f = new InputFrame();
      const inputs: Array<InputFrame | null> = [null, null, null, null];
      const step = (m: MatchSim): void => {
        inputs[0] = human ? humanFrame(f, m.tick, m.time) : null;
        m.step(inputs);
      };
      for (let i = 0; i < 3000; i++) step(live);
      const snap = new MatchSim(cfg);
      snap.copyFrom(live);
      expect(snap.hash()).toBe(live.hash());
      const at = snap.hash();
      const hashes: number[] = [];
      for (let i = 0; i < 6000; i++) { step(live); if (i % 500 === 0) hashes.push(live.hash()); }
      // The copy is its own: the original going on leaves it as it was.
      expect(snap.hash()).toBe(at);
      // Copied again into a match that has played (a replay's sim is reused), and run with the same inputs.
      const replay = new MatchSim(cfg);
      for (let i = 0; i < 1234; i++) step(replay);
      replay.copyFrom(snap);
      const again: number[] = [];
      for (let i = 0; i < 6000; i++) { step(replay); if (i % 500 === 0) again.push(replay.hash()); }
      expect(again).toEqual(hashes);
      expect(replay.hash()).toBe(live.hash());
      expect(replay.events[0]).not.toBe(live.events[0]);
      expect(replay.ball).not.toBe(live.ball);
    });
  }
});
