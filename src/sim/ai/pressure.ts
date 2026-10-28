// How hard a ball was to play, as a match analyst judges a forced error: the opponent's shot put the player under
// pressure (a fast ball, no time, a stretch, on the run, a ball at the shoe tops, off the glass), not a ball they
// had time and balance for. Observation studies code this by eye (Mellado-Arbelo et al. 2019; Conde-Ripoll et al.
// 2025); this is our fixed, written-down version of that judgement. It was set before any AI tuning
// (DECISIONS.md, Phase 4) and the tuning never changes it: changing it would move errors between forced and
// unforced without the play changing.
import { clamp } from '../core/smath.ts';

/** At or above this, an error is forced. */
export const PRESSURE_FORCED = 1;

/**
 * Pressure of a contact: each term is 1 where that alone clearly puts a player under pressure, and the terms add.
 * - pace: incoming speed 14 m/s none, 26 m/s (a hard drive or a blocked smash) 1;
 * - time since the opponent struck: 0.9 s none, 0.45 s (a fast exchange at the net) 1;
 * - stretch: the ball 1.0 m from the body's centre none, 1.4 m (full reach) 1;
 * - running at contact: 2 m/s none, 4.5 m/s 1;
 * - height: 0.4 m none, 0.15 m (scraped off the floor) 1;
 * - off the glass 0.25, off two walls 0.5.
 */
export function pressureOf(speedIn: number, avail: number, reach: number, run: number, height: number, wall: boolean, twoWalls: boolean): number {
  return clamp((speedIn - 14) / 12, 0, 3)
    + clamp((0.9 - avail) / 0.45, 0, 2)
    + clamp((reach - 1.0) / 0.4, 0, 2)
    + clamp((run - 2) / 2.5, 0, 2)
    + clamp((0.4 - height) / 0.25, 0, 1)
    + (twoWalls ? 0.5 : wall ? 0.25 : 0);
}
