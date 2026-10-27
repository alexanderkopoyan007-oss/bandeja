// Fixed simulation step. Everything in the sim advances in whole ticks of DT.
export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
export const GRAVITY = 9.81;
export const TEAM_NEAR = 0; // plays the z > 0 half
export const TEAM_FAR = 1; // plays the z < 0 half

/** +1 for the near team's half (z > 0), -1 for the far team's half. */
export function teamSide(team: number): number {
  return team === TEAM_NEAR ? 1 : -1;
}
