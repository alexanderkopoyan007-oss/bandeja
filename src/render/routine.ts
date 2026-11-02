// The server's bounces before a serve, as the picture has them (ROUTINE_* in the sim's constants): the ball's height, the hand's push and catch.
import type { MatchSim } from '../sim/match.ts';
import { PH_SETUP, SETUP_HOLD } from '../sim/match.ts';
import { GRAVITY, ROUTINE_AFTER, ROUTINE_BOUNCES, ROUTINE_DOWN, ROUTINE_PERIOD, ROUTINE_UP, ROUTINE_V0 } from '../sim/core/constants.ts';

/** How far the hand goes down with the ball, and how long it takes over the push (m, s); it is back up for the catch. */
const HAND_DIP = 0.14, HAND_PUSH = 0.1, HAND_BACK = 0.14;

/** Seconds into the routine at `t`, or -1 outside it. */
export function routineTime(sim: MatchSim, t: number): number {
  if (sim.phase !== PH_SETUP || sim.walking !== 0) return -1;
  const u = t - (sim.phaseUntil - SETUP_HOLD) - ROUTINE_AFTER;
  return u < 0 || u >= ROUTINE_BOUNCES * ROUTINE_PERIOD ? -1 : u;
}

/** Which bounce `u` is in. */
export function routineBounceOf(u: number): number {
  return Math.floor(u / ROUTINE_PERIOD);
}

/** The ball has left the floor in this bounce. */
export function routineUp(u: number): boolean {
  return u - routineBounceOf(u) * ROUTINE_PERIOD >= ROUTINE_DOWN;
}

/** The ball's height at `u`: thrown down from the hand at `top`, off the floor at `floor`, and up to the hand with nothing left. */
export function routineHeight(u: number, top: number, floor: number): number {
  const x = u - routineBounceOf(u) * ROUTINE_PERIOD;
  if (x < ROUTINE_DOWN) return Math.max(floor, top - ROUTINE_V0 * x - 0.5 * GRAVITY * x * x);
  const a = x - ROUTINE_DOWN;
  return Math.min(top, floor + ROUTINE_UP * a - 0.5 * GRAVITY * a * a);
}

/** How far below the ball's place the free hand is at `u` (m): down with the push, back up to take it. */
export function routineHand(u: number): number {
  const x = u - routineBounceOf(u) * ROUTINE_PERIOD;
  const a = x / HAND_PUSH, b = (x - ROUTINE_DOWN) / (ROUTINE_PERIOD - ROUTINE_DOWN - HAND_BACK);
  const down = a >= 1 ? 1 : a * a * (3 - 2 * a), up = b <= 0 ? 0 : b >= 1 ? 1 : b * b * (3 - 2 * b);
  return HAND_DIP * down * (1 - up);
}
