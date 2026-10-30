// Practice (data/practice.json): the coach feeds each drill's balls where the drill says, no score is kept.
import { describe, it, expect } from 'vitest';
import { MatchSim, E_HIT, E_FLOOR, E_FAULT } from '../../src/sim/match.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import drills from '../../data/practice.json';

describe('practice', () => {
  drills.drills.forEach((d, i) => {
    it(`${d.name}: fed to the drill's places, no serves, no score`, () => {
      const m = new MatchSim({ seed: 30 + i, human: [true, false], aiLevel: [0.5, 0.5], practice: i, firstServer: 1, walkBack: false });
      let seen = 0, feeds = 0, landed = 0, inPlace = 0, faults = 0, last = -1;
      const none = [null, null];
      for (let t = 0; t < 120 * 90; t++) {
        m.step(none);
        while (seen < m.eventSeq) {
          const e = m.events[seen % m.events.length]!;
          seen++;
          if (e.kind === E_HIT) { feeds++; last = e.a; expect(SHOT_KEYS[e.a]).not.toBe('serve'); expect(e.team).toBe(1); }
          else if (e.kind === E_FAULT) faults++;
          else if (e.kind === E_FLOOR && last >= 0) {
            landed++;
            const f = d.feeds.find((x) => x.shot === SHOT_KEYS[last]);
            if (f && Math.abs(e.z) > f.depth[0]! - 1.6 && Math.abs(e.z) < f.depth[1]! + 1.6) inPlace++;
            last = -1;
          }
        }
      }
      expect(feeds).toBeGreaterThan(10);
      expect(faults).toBe(0);
      expect(m.score.games[0]! + m.score.games[1]!).toBe(0);
      expect(inPlace / landed).toBeGreaterThan(0.6);
    }, 60000);
  });
});
