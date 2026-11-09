import { describe, expect, it } from 'vitest';
import { MatchSim, PH_OVER, E_POINT, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_LOB } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Replays, RP_IDLE, RP_PREP, RP_SHOW } from '../../src/game/replay.ts';

// Instant replays (review round 3, critic High #4), driven as game.ts drives them: the live match waits while a
// replay re-runs its point from the copy taken at the point's setup, with the human's recorded inputs. The point
// shown must be the point played: the same winner at the same moment, and the whole match state (its hash) at the
// replay's last tick the live match's at that tick.

/** A scripted human (moves, drives and lobs by the tick), so the recorded inputs matter; `shift` gives another one. */
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

/** `humans`: the players on this machine (M6 local multiplayer: several, each recorded). */
function play(humans: number[], seed: number, seconds: number, twoTakes = true) {
  const cfg: MatchConfig = { seed, doubles: true, human: [0, 1, 2, 3].map((i) => humans.includes(i)) };
  const live = new MatchSim(cfg);
  const rp = new Replays(cfg, humans);
  rp.twoTakes = twoTakes;
  const frames = humans.map(() => new InputFrame());
  const inputs: Array<InputFrame | null> = [null, null, null, null];
  const checks: Array<{ live: number[]; shown: number[]; hash: number; liveHash: number | undefined;
    angle: number; takes: { cuts: number; second: number; compared: number; agree: number; slowed: boolean; fullSpeed: boolean } }> = [];
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
      // (M7 phase B: two takes; the second, cut from a copy taken in the first, must be the first again tick by tick)
      const cuts0 = rp.cuts, take0 = new Map<number, number>(), angle = rp.angle;
      let second = 0, compared = 0, agree = 0, slowed = false, fullSpeed = true;
      while (st() === RP_SHOW) {
        rp.advance(1 / 60);
        if (st() !== RP_SHOW) break;
        if (rp.take === 0) {
          take0.set(rp.sim.tick, rp.sim.hash());
          if (rp.speed !== 1) fullSpeed = false;
        } else {
          second++;
          // (only ticks the first take drew: at speed it draws every second one)
          const h = take0.get(rp.sim.tick);
          if (h !== undefined) { compared++; if (h === rp.sim.hash()) agree++; }
          if (rp.speed < 0.5) slowed = true;
        }
        for (; rs < rp.sim.eventSeq; rs++) {
          const e = rp.sim.events[rs % rp.sim.events.length]!;
          if (e.kind === E_POINT) shownPoint = [e.team, e.time];
        }
      }
      checks.push({ live: pointAt, shown: shownPoint, hash: rp.sim.hash(), liveHash: hashes.get(rp.sim.tick), angle,
        takes: { cuts: rp.cuts - cuts0, second, compared, agree, slowed, fullSpeed } });
      continue;
    }
    // Two ticks a frame (120 Hz sim, 60 Hz frames), each human's frame recorded for each.
    for (let k = 0; k < 2; k++) {
      humans.forEach((p, h) => { inputs[p] = humanFrame(frames[h]!, live, 137 * h); });
      rp.beforeStep(live, inputs);
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
  for (const humans of [[], [0], [2, 3]]) {
    it(`show the point that was played (${humans.length ? `humans ${humans.join(', ')}` : 'AI only'})`, () => {
      // (a big point is a matter of the seed: play on until there has been a replay to check)
      let shown = 0;
      for (let seed = 21; seed < 41 && shown === 0; seed++) {
        const r = play(humans, seed, 420);
        shown += r.shown;
        for (const c of r.checks) {
          expect(c.shown.length).toBe(2);
          expect(c.shown[0]).toBe(c.live[0]);
          expect(c.shown[1]).toBeCloseTo(c.live[1]!, 9);
          expect(c.liveHash).toBeDefined();
          expect(c.hash).toBe(c.liveHash);
          // Two takes: the first at speed, then the cut to the second, slowed, the same match frame for frame.
          expect(c.takes.cuts).toBe(1);
          expect(c.takes.fullSpeed).toBe(true);
          expect(c.takes.slowed).toBe(true);
          expect(c.takes.second).toBeGreaterThan(60);
          expect(c.takes.compared).toBeGreaterThan(20);
          expect(c.takes.agree).toBe(c.takes.compared);
        }
      }
      expect(shown).toBeGreaterThan(0);
    });
  }

  // Without ?creator=1 (the owner hasn't seen the two takes): the one take of before.
  for (const humans of [[], [0]]) {
    it(`keep their one slowed take without the flag (${humans.length ? 'a human' : 'AI only'})`, () => {
      let shown = 0;
      for (let seed = 21; seed < 41 && shown < 2; seed++) {
        const r = play(humans, seed, 420, false);
        shown += r.shown;
        r.checks.forEach((c, i) => {
          expect(c.shown[0]).toBe(c.live[0]);
          expect(c.hash).toBe(c.liveHash);
          expect(c.takes.cuts).toBe(0);
          expect(c.takes.slowed).toBe(true);
          // (one replay from one angle, the next from the other)
          if (i > 0) expect(c.angle).toBe(1 - r.checks[i - 1]!.angle);
        });
      }
      expect(shown).toBeGreaterThan(1);
    });
  }
});
