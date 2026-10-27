// Where should a player stand to hit the incoming ball comfortably, and when? Used by the positioning
// assist, the on-court "stand here" spot and the timing ring. Pure sim code, allocation-free.
import type { Prediction } from '../ball/predict.ts';
import type { Player } from './player.ts';
import { heightCost } from '../contact/windows.ts';
import { abs, clamp, sqrt } from '../core/smath.ts';

export interface StandPlan {
  valid: boolean;
  /** Where to stand. */
  x: number;
  z: number;
  /** When the ball reaches the contact point, and where it is then. */
  t: number;
  bx: number;
  by: number;
  bz: number;
  /** +1 forehand, -1 backhand. */
  hand: number;
}

export function makeStandPlan(): StandPlan {
  return { valid: false, x: 0, z: 0, t: 0, bx: 0, by: 0, bz: 0, hand: 1 };
}

/**
 * Pick the contact the player can reach in time with the best height, preferring forehands.
 * `side` is the player's half (+1 / -1). Returns false if the ball will not come to this half.
 */
export function planStand(pr: Prediction, p: Player, side: number, now: number, mustBounce: boolean, out: StandPlan): boolean {
  const t = p.tune;
  let bestCost = 1e9;
  let found = false;
  let fbSlack = -1e9;
  out.valid = false;
  for (let i = 0; i < pr.n; i++) {
    const ti = pr.t[i]!;
    if (ti < now + 0.05) continue;
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const z = pr.z[i]!;
    const b = pr.bounces[i]!;
    if (z * side < 0.3 || b > 1 || (mustBounce && b === 0) || y < 0.3 || y > 2.6) continue;
    const fhX = x - side * p.handed * t.reachComfort;
    const bhX = x + side * p.handed * t.reachComfort;
    const useFh = abs(fhX - p.pos.x) <= abs(bhX - p.pos.x) + 0.6;
    const sx = clamp(useFh ? fhX : bhX, p.minX, p.maxX);
    const sz = clamp(z + side * 0.12, p.minZ, p.maxZ);
    const dx = sx - p.pos.x;
    const dz = sz - p.pos.z;
    const dist = sqrt(dx * dx + dz * dz);
    const slack = ti - now - (dist / t.maxSpeed + (dist > 0.4 ? 0.3 : 0.05));
    if (slack >= 0) {
      const cost = heightCost(y, t.overheadHeight) + 0.03 * (ti - now);
      if (cost < bestCost) {
        bestCost = cost;
        found = true;
        write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1);
      }
    } else if (!found && slack > fbSlack) {
      fbSlack = slack;
      write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1);
    }
  }
  return out.valid;
}

function write(o: StandPlan, x: number, z: number, t: number, bx: number, by: number, bz: number, hand: number): void {
  o.valid = true;
  o.x = x; o.z = z; o.t = t;
  o.bx = bx; o.by = by; o.bz = bz;
  o.hand = hand;
}
