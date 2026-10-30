import { describe, expect, it } from 'vitest';
import { MatchSim, PH_OVER, E_POINT, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_LOB } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Replays, RP_IDLE, RP_PREP, RP_SHOW } from '../../src/game/replay.ts';

// Instant replays (review round 3, critic High #4), driven as game.ts drives them: the live match waits while a
// replay re-runs its point from the copy taken at the point's setup, with the human's recorded inputs. The point
// shown must be the point played: the same winner at the same moment, and the whole match state (its hash) at the
// replay's last tick the live match's at that tick.

/** A scripted human (moves, drives and lobs by the tick), so the recorded inputs matter. */
function humanFrame(f: InputFrame, m: MatchSim): InputFrame {
  f.clear();
  const k = m.tick;
  f.moveX = Math.sin(k * 0.011);
  f.moveY = Math.cos(k * 0.005) * 0.5;
  const c = k % 300;
  const btn = (k / 300) % 2 < 1 ? BTN_DRIVE : BTN_LOB;
  if (c === 0) f.push(true, btn, m.time + DT * 0.4);
  if (c === 50) f.push(false, btn, m.time + DT * 0.2);
  f.held = c < 50 ? btn : 0;
  return f;
}

function play(human: boolean, seed: number, seconds: number) {
  const cfg: MatchConfig = { seed, doubles: true, human: [human, false, false, false] };
  const live = new MatchSim(cfg);
  const rp = new Replays(cfg, human ? 0 : -1);
  const f = new InputFrame();
  const inputs: Array<InputFrame | null> = [null, null, null, null];
  const checks: Array<{ live: number[]; shown: number[]; hash: number; liveHash: number | undefined }> = [];
  const hashes = new Map<number, number>();
  let pointAt: number[] = [];
  let seen = 0;
  for (let frame = 0; frame < seconds * 60 && live.phase !== PH_OVER; frame++) {
    if (rp.state === RP_IDLE && rp.due >= 0 && live.time >= rp.due) {
      rp.begin();
      let shownPoint: number[] = [];
      let rs = rp.sim.eventSeq;
      // (read through a call: the checks above narrowed rp.state to RP_IDLE as far as the compiler knows)
      const st = (): number => rp.state;
      while (st() === RP_PREP) rp.prepare();
      expect(st()).toBe(RP_SHOW);
      while (st() === RP_SHOW) {
        rp.advance(1 / 60);
        for (; rs < rp.sim.eventSeq; rs++) {
          const e = rp.sim.events[rs % rp.sim.events.length]!;
          if (e.kind === E_POINT) shownPoint = [e.team, e.time];
        }
      }
      checks.push({ live: pointAt, shown: shownPoint, hash: rp.sim.hash(), liveHash: hashes.get(rp.sim.tick) });
      continue;
    }
    // Two ticks a frame (120 Hz sim, 60 Hz frames), the human's frame recorded for each.
    for (let k = 0; k < 2; k++) {
      inputs[0] = human ? humanFrame(f, live) : null;
      rp.beforeStep(live, inputs[0]);
      live.step(inputs);
      rp.afterStep(live);
      hashes.set(live.tick, live.hash());
      hashes.delete(live.tick - 600);
      for (; seen < live.eventSeq; seen++) {
        const e = live.events[seen % live.events.length]!;
        if (e.kind === E_POINT) pointAt = [e.team, e.time];
      }
    }
  }
  return { checks, shown: rp.shown, live };
}

describe('instant replays', () => {
  for (const human of [false, true]) {
    it(`show the point that was played (${human ? 'with a human' : 'AI only'})`, () => {
      // (a big point is a matter of the seed: play on until there has been a replay to check)
      let shown = 0;
      for (let seed = 21; seed < 29 && shown === 0; seed++) {
        const r = play(human, seed, 420);
        shown += r.shown;
        for (const c of r.checks) {
          expect(c.shown.length).toBe(2);
          expect(c.shown[0]).toBe(c.live[0]);
          expect(c.shown[1]).toBeCloseTo(c.live[1]!, 9);
          expect(c.liveHash).toBeDefined();
          expect(c.hash).toBe(c.liveHash);
        }
      }
      expect(shown).toBeGreaterThan(0);
    });
  }
});
