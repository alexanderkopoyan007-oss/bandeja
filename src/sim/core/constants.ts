// Fixed simulation step. Everything in the sim advances in whole ticks of DT.
export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
export const GRAVITY = 9.81;
export const TEAM_NEAR = 0; // plays the z > 0 half
export const TEAM_FAR = 1; // plays the z < 0 half

/**
 * The server's routine before a serve, drawn only (the sim holds the ball at the address spot): after ROUTINE_AFTER s in place, ROUTINE_BOUNCES
 * bounces from the hand, each ROUTINE_PERIOD s. The AI serves after them; a human who goes sooner than ROUTINE_AFTER never sees them start.
 */
export const ROUTINE_AFTER = 0.8;
export const ROUTINE_BOUNCES = 2;
export const ROUTINE_PERIOD = 0.5;
export const ROUTINE_SECS = ROUTINE_AFTER + ROUTINE_BOUNCES * ROUTINE_PERIOD;

/** +1 for the near team's half (z > 0), -1 for the far team's half. */
export function teamSide(team: number): number {
  return team === TEAM_NEAR ? 1 : -1;
}
