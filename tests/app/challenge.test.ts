// M6 phase C: challenges. A run scored from the sim's events (balls counted to the end, points where the first bounces
// came down), the daily challenge the same all day, and a run's inputs saved and played back to the same match bit for
// bit (a best run watched again).
import { describe, expect, it } from 'vitest';
import { CHALLENGES, ChallengeRun, daily, dayKey, medal } from '../../src/game/challenge.ts';
import { InputLog, LogPlayer, savedLogFrom } from '../../src/game/inputLog.ts';
import { MatchSim, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_OVERHEAD, BTN_POWER } from '../../src/sim/input.ts';
import { DRILL_NAMES } from '../../src/app/unlocks.ts';
import practice from '../../data/practice.json';

const cfgFor = (drill: number, seed: number, human: boolean): MatchConfig =>
  ({ seed, human: [human, false], aiLevel: [0.8, 0.8], practice: drill, firstServer: 1, walkBack: false, timingScale: 1.5, autoTiming: true });

/** A scripted player (moves about, holds a key now and then; auto timing swings for them), with a stick's -0 in it. */
function scripted(f: InputFrame, m: MatchSim, shotKey: number): InputFrame {
  f.clear();
  const k = m.tick;
  f.moveX = k % 97 === 0 ? -0 : Math.sin(k * 0.013) * 0.6;
  f.moveY = Math.cos(k * 0.007) * 0.3;
  const c = k % 240;
  if (c === 0) f.push(true, shotKey, m.time + 0.001);
  if (c === 200) f.push(false, shotKey, m.time + 0.002);
  f.held = c < 200 ? shotKey : 0;
  return f;
}

describe('challenges', () => {
  it('feed from drills that exist, kept out of Practice and its unlocks', () => {
    for (const c of CHALLENGES) {
      expect(practice.drills[c.drill]).toBeDefined();
      expect(c.medals[0]).toBeLessThan(c.medals[1]);
      expect(c.medals[1]).toBeLessThan(c.medals[2]);
    }
    expect(DRILL_NAMES).toEqual(['Back glass', 'Side glass', 'Lobs and overheads', 'Volleys']);
  });

  for (const def of CHALLENGES) {
    it(`${def.name}: counts its balls to the end and scores where they came down`, () => {
      // The AI as the player: the scoring only reads events.
      const m = new MatchSim(cfgFor(def.drill, 41, false));
      const run = new ChallengeRun(def);
      const none = [null, null];
      for (let t = 0; t < 120 * 400 && !run.done; t++) {
        m.step(none);
        run.update(m);
      }
      expect(run.done).toBe(true);
      expect(run.balls).toBe(def.balls);
      if (def.kind === 'targets' || def.kind === 'zone') {
        // The score is what the marks say, and every mark is on the coach's side of the net.
        expect(run.score).toBe(run.marks.reduce((a, b) => a + b.points, 0));
        expect(run.marks.length).toBeGreaterThan(0);
        for (const mk of run.marks) expect(mk.z).toBeGreaterThan(0);
      }
      expect(run.score).toBeGreaterThanOrEqual(0);
      expect(medal(def, def.medals[2])).toBe(3);
      expect(medal(def, def.medals[0] - 1)).toBe(0);
    }, 60000);
  }

  it('makes one daily challenge a day, its rings in the court', () => {
    const a = daily(dayKey(new Date(2026, 10, 9))), b = daily(20261109), c = daily(20261110);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    for (let d = 20261101; d < 20261131; d++) {
      const x = daily(d);
      for (const t of x.def.targets) {
        expect(Math.abs(t.x) + t.r * 0.5).toBeLessThanOrEqual(4.4 + 1e-9);
        expect(t.depth).toBeLessThanOrEqual(9.6);
      }
    }
  });
});

describe('a run kept and watched again', () => {
  it('replays to the same match, bit for bit', () => {
    const def = CHALLENGES.find((c) => c.kind === 'exits')!;
    const cfg = cfgFor(def.drill, 77, true);
    const live = new MatchSim(cfg);
    const log = new InputLog(120 * 200);
    const f = new InputFrame();
    const key = BTN_OVERHEAD | BTN_POWER;
    for (let t = 0; t < 120 * 90; t++) {
      const fr = scripted(f, live, t % 2 ? key : BTN_DRIVE);
      log.record(fr);
      live.step([fr, null]);
    }
    const saved = savedLogFrom(JSON.parse(JSON.stringify(log.save())), 120 * 600)!;
    expect(saved).not.toBeNull();
    const again = new MatchSim(structuredClone(cfg));
    const player = new LogPlayer(saved);
    while (!player.over) again.step([player.next(), null]);
    expect(again.tick).toBe(live.tick);
    expect(again.hash()).toBe(live.hash());
    // Changed rows only: far fewer than the ticks.
    expect(saved.rows.length).toBeLessThan(120 * 90 * 7 * 8 * 1.4);
  });

  it('reads back only a log', () => {
    expect(savedLogFrom({ ticks: 5, rows: 'AAAA', events: '' }, 100)).toBeNull();
    expect(savedLogFrom({ ticks: 0, rows: '', events: '' }, 100)).toBeNull();
    expect(savedLogFrom(null, 100)).toBeNull();
  });
});

describe('best runs kept', () => {
  it('reads back only what checks out', async () => {
    const { bestsFrom } = await import('../../src/app/challengeScreen.ts');
    const log = new InputLog(10);
    for (let k = 0; k < 5; k++) log.record(null);
    const good = { score: 7, at: 1, build: 'abc', cfg: { seed: 3, practice: 4, human: [true, false] }, log: log.save(), castSeed: 1744249808 };
    const b = bestsFrom({ best: { targets: good, 'BAD ID': good, smash: { ...good, score: -1 }, glass: { ...good, cfg: { seed: 'x' } }, wall: { ...good, castSeed: 0.5 } } });
    expect(Object.keys(b).sort()).toEqual(['glass', 'targets', 'wall']);
    expect(b.targets!.log).toBeDefined();
    // Who played it comes back with it (a watched run deals the same people: a women's cast is another match).
    expect(b.targets!.castSeed).toBe(1744249808);
    expect(b.wall!.castSeed).toBeUndefined();
    // A run whose match doesn't check out keeps its score, not its inputs.
    expect(b.glass!.score).toBe(7);
    expect(b.glass!.log).toBeUndefined();
    expect(bestsFrom(null)).toEqual({});
  });
});
