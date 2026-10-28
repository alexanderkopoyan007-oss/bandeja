// Where a smash can land: the shortest landing (m from the net) of a full-pace smash from a contact `back` m from
// the net and `h` high that clears the tape by `margin`. Shared by the AI's kill decision and the human's untouched
// smash aim, so both read the court the same way.
import { GRAVITY } from '../core/constants.ts';
import { clamp, sqrt } from '../core/smath.ts';

/**
 * A pro smash's speed for the aim (m/s): 121 km/h under opposition (semi-professionals, radar; Rivilla-García et al.
 * 2019, 133 km/h unopposed). Gravity bends the path down after the tape: a straight line, as the aim was first
 * worked out, put the landing about 1 m too deep from 4-6 m and allowed a kill smash on 4% of overheads (pros
 * smash 26-36% of them).
 */
export const SMASH_AIM_SPEED = 33.6;

/**
 * Vacuum parabola through the tape (+ margin) and the floor, at SMASH_AIM_SPEED (drag only makes it land shorter,
 * so this stays on the safe side); clamped to [min, far]. `netH` is the tape's height.
 */
export function smashLanding(netH: number, back: number, h: number, margin: number, min: number, far: number): number {
  const over = netH + margin;
  if (h <= over + 0.05 || back < 0.1) return far;
  const k = GRAVITY / (2 * SMASH_AIM_SPEED * SMASH_AIM_SPEED);
  const s = (over - h + k * back * back) / back;
  const total = (s + sqrt(s * s + 4 * k * h)) / (2 * k);
  return clamp(total - back, min, far);
}
