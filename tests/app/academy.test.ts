// M6 phase D: the academy. Lessons load from data/academy.json onto drills that exist, each counts its balls to the
// end and scores only what it asks for (the timing grade, the shot named, a ball played back in off the player's own
// glass); a lesson opens with bronze in the one before; a lesson's text names the keys in use.
import { describe, expect, it } from 'vitest';
import { LESSONS, ChallengeRun, medal } from '../../src/game/challenge.ts';
import { lessonOpen, withKeys } from '../../src/app/academyScreen.ts';
import { resolveKeys } from '../../src/game/input/bindings.ts';
import { MatchSim, E_HIT, E_FLOOR, E_POINT, E_WALL, type MatchConfig } from '../../src/sim/match.ts';
import { eventsOf } from '../../src/net/feed.ts';
import { G_GOOD, G_PERFECT } from '../../src/sim/contact/timing.ts';
import practice from '../../data/practice.json';

const cfgFor = (drill: number, seed: number): MatchConfig =>
  ({ seed, human: [false, false], aiLevel: [0.8, 0.8], practice: drill, firstServer: 1, walkBack: false, timingScale: 1.5, autoTiming: true });

describe('academy lessons', () => {
  it('load in order onto drills that exist, each with its shot and rising medals', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(13);
    expect(LESSONS[0]!.kind).toBe('timing');
    expect(LESSONS[0]!.ownTiming).toBe(true);
    for (const l of LESSONS) {
      expect(l.lesson).toBe(true);
      expect(l.id.startsWith('lesson-')).toBe(true);
      expect(practice.drills[l.drill]).toBeDefined();
      expect(l.medals[0]).toBeLessThan(l.medals[1]);
      expect(l.medals[1]).toBeLessThan(l.medals[2]);
      expect(l.medals[2]).toBeLessThanOrEqual(l.balls);
      if (l.kind === 'shot') expect(l.shot).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    // Glass vision fades out over the wall lessons.
    const glass = LESSONS.filter((l) => l.kind === 'glass').map((l) => l.vision);
    expect(glass).toEqual([2, 1, 0]);
  });

  it('opens each lesson with bronze in the one before', () => {
    const bests: Record<string, number> = {};
    const best = (id: string) => bests[id] ?? null;
    expect(lessonOpen(0, best)).toBe(true);
    expect(lessonOpen(1, best)).toBe(false);
    bests[LESSONS[0]!.id] = LESSONS[0]!.medals[0] - 1;
    expect(lessonOpen(1, best)).toBe(false);
    bests[LESSONS[0]!.id] = LESSONS[0]!.medals[0];
    expect(lessonOpen(1, best)).toBe(true);
    expect(lessonOpen(2, best)).toBe(false);
  });

  it('names the keys in use', () => {
    const keys = resolveKeys({ drive: ['KeyF'] });
    expect(withKeys('Hold {drive}, then {overhead} with {power}.', keys)).toBe('Hold F, then O with Space.');
    expect(withKeys('{nothing}', keys)).toBe('{nothing}');
    for (const l of LESSONS) expect(withKeys(l.desc, resolveKeys(undefined))).not.toMatch(/\{\w+\}/);
  });

  for (const def of LESSONS) {
    it(`${def.name}: counts its balls and scores only what it asks for`, () => {
      // The AI as the player; an independent count from the events is the check.
      const m = new MatchSim(cfgFor(def.drill, 23));
      const run = new ChallengeRun(def);
      const ring = eventsOf(m);
      let seen = 0, balls = 0, expectScore = 0, flying = false, right = false, offGlass = false, ownGlass = false, timed = false;
      for (let t = 0; t < 120 * 400 && !run.done; t++) {
        m.step([null, null]);
        // Read the same events before the run does, ball by ball.
        for (; seen < ring.eventSeq && balls < def.balls; seen++) {
          const e = ring.events[seen % ring.events.length]!;
          if (e.seq < 0) continue;
          if (e.kind === E_HIT) {
            flying = e.player === 0;
            if (e.player === 0) {
              right = def.shot < 0 || e.a === def.shot;
              offGlass = ownGlass;
              if (def.kind === 'timing' && !timed && (e.b === G_GOOD || e.b === G_PERFECT)) { expectScore++; timed = true; }
            } else ownGlass = false;
          } else if (e.kind === E_WALL && !flying && Math.sign(e.z) === m.side(0)) ownGlass = true;
          else if (e.kind === E_WALL && flying) flying = false;
          else if (e.kind === E_FLOOR && flying) {
            flying = false;
            if (Math.sign(e.z) === m.side(1) && !timed) {
              if (def.kind === 'shot' && right) expectScore++;
              if (def.kind === 'glass' && offGlass) expectScore++;
              timed = true;
            }
          } else if (e.kind === E_POINT) { flying = false; timed = false; ownGlass = false; balls++; }
        }
        run.update(m);
      }
      expect(run.done).toBe(true);
      expect(run.balls).toBe(def.balls);
      expect(run.score).toBe(expectScore);
      expect(run.score).toBeLessThanOrEqual(def.balls);
      if (def.kind === 'shot' || def.kind === 'glass') {
        expect(run.score).toBe(run.marks.reduce((a, b) => a + b.points, 0));
        for (const mk of run.marks) expect(mk.z).toBeGreaterThan(0);
      }
      expect(medal(def, def.medals[2])).toBe(3);
    }, 60000);
  }
});
