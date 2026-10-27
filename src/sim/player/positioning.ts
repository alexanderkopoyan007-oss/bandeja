// Where should a player stand to hit the incoming ball comfortably, and when? One plan drives the positioning
// assist, the on-court "stand here" spot, the timing ring and assisted timing, so they never disagree about
// which contact you are going for. Pure sim code, allocation-free.
import type { Prediction } from '../ball/predict.ts';
import type { Player } from './player.ts';
import { heightCost, nearImpact, overheadCost } from '../contact/windows.ts';
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
  /** The planned contact is after the ball has come off a wall (played off the glass). */
  afterWall: boolean;
  /** The planned contact is before the bounce. */
  volley: boolean;
  /** Planned as an overhead (the player is holding the overhead key). */
  overhead: boolean;
  /** The player can get there in time (false: the best try, out of time). */
  inTime: boolean;
  /** Prediction version the plan was made from. */
  version: number;
}

export function makeStandPlan(): StandPlan {
  return { valid: false, x: 0, z: 0, t: 0, bx: 0, by: 0, bz: 0, hand: 1, afterWall: false, volley: false, overhead: false, inTime: false, version: -1 };
}

/** Margin kept between the ball's path and the body (on top of the body radius). */
const BODY_CLEAR = 0.2;
/** Depth band in front of the back glass where hitting the ball before it reaches the glass is cramped. */
const GLASS_BAND = 1.7;

/**
 * Pick the contact the player can reach in time with the best height. Deep balls that will come off the back
 * glass are planned off the glass (as real players play them), and spots the ball flies through on its way
 * there are rejected (the ball would hit the player). `side` is the player's half (+1 / -1).
 * `keep` >= 0 is the contact moment already planned: it is preferred (a plan that keeps changing its mind has
 * the player running back and forth), and with `only` set nothing else is considered (close to contact).
 * `overhead`: the player is holding the overhead key: plan to take the ball high, in the air if need be,
 * standing under it with the ball just in front and to the racket side.
 */
export function planStand(
  pr: Prediction, p: Player, side: number, now: number, mustBounce: boolean, out: StandPlan, keep: number, only: boolean,
  overhead: boolean,
): boolean {
  const t = p.tune;
  const backZ = side > 0 ? p.maxZ : -p.minZ; // depth of the back limit (just in front of the glass)
  // Does the ball reach a wall after its bounce on our half (before bouncing again)?
  let wallIdx = -1;
  for (let i = 0; i < pr.n; i++) {
    if (pr.bounces[i]! === 1 && pr.walls[i]! > 0 && pr.z[i]! * side > 0) { wallIdx = i; break; }
    if (pr.bounces[i]! > 1) break;
  }
  let bestCost = 1e9;
  let found = false;
  let fbSlack = -1e9;
  out.valid = false;
  out.version = pr.version;
  out.overhead = overhead;
  const lateral = overhead ? t.overheadReach : t.reachComfort;
  const behind = overhead ? 0.3 : 0.12;
  const yMax = overhead ? t.contactMaxHeight - 0.05 : 2.6;
  for (let i = 0; i < pr.n; i++) {
    const ti = pr.t[i]!;
    const kept = keep >= 0 && abs(ti - keep) <= 0.15;
    if (only ? !kept || ti < now : ti < now + 0.05) continue;
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const z = pr.z[i]!;
    const b = pr.bounces[i]!;
    if (z * side < 0.3 || b > 1 || (mustBounce && b === 0) || y < 0.3 || y > yMax) continue;
    if (nearImpact(pr, i)) continue;
    const fhX = x - side * p.handed * lateral;
    const bhX = x + side * p.handed * lateral;
    // Overheads are hit on the racket side (a backhand overhead is a last resort).
    const useFh = overhead || abs(fhX - p.pos.x) <= abs(bhX - p.pos.x) + 0.6;
    const sx = clamp(useFh ? fhX : bhX, p.minX, p.maxX);
    const sz = clamp(z + side * behind, p.minZ, p.maxZ);
    const dx = sx - p.pos.x;
    const dz = sz - p.pos.z;
    const dist = sqrt(dx * dx + dz * dz);
    // Time to get there: running at top speed plus starting and setting the feet (less if already on the way).
    const slack = ti - now - (dist / t.maxSpeed + (dist > 0.4 ? (kept ? 0.15 : 0.3) : 0.05));
    const afterWall = pr.walls[i]! > 0 && b === 1;
    if (slack >= 0) {
      let cost = (overhead ? overheadCost(y, t) : heightCost(y, t.overheadHeight)) + 0.03 * (ti - now);
      if (kept) cost -= 0.35;
      if (!overhead) {
        // Heading into the back glass and already deep: let it come off the glass instead.
        if (wallIdx >= 0 && i < wallIdx && b === 1 && abs(z) > backZ - GLASS_BAND) cost += 0.6;
        if (afterWall) cost -= 0.1;
        // Volleying from the back of the court is rarely the right read.
        if (b === 0 && abs(p.pos.z) > 6.5) cost += 0.4;
      }
      if (cost < bestCost && clearOfBall(pr, now, i, sx, sz, t.height, t.bodyRadius)) {
        bestCost = cost;
        found = true;
        write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1, afterWall, b === 0);
        out.inTime = true;
      }
    } else if (!found && slack > fbSlack) {
      fbSlack = slack;
      write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1, afterWall, b === 0);
      out.inTime = false;
    }
  }
  return out.valid;
}

/** True if the ball, before sample `upto`, never passes through a body standing at (sx, sz). */
function clearOfBall(pr: Prediction, now: number, upto: number, sx: number, sz: number, height: number, bodyR: number): boolean {
  const r = bodyR + BODY_CLEAR;
  const lim = r * r;
  // In the last 0.12 s before contact the ball is meant to be next to the body: it is being hit.
  const stop = upto - 14;
  for (let j = 0; j < stop; j += 2) {
    if (pr.t[j]! < now) continue;
    if (pr.y[j]! > height) continue;
    const dx = pr.x[j]! - sx;
    const dz = pr.z[j]! - sz;
    if (dx * dx + dz * dz < lim) return false;
  }
  return true;
}

function write(
  o: StandPlan, x: number, z: number, t: number, bx: number, by: number, bz: number, hand: number,
  afterWall: boolean, volley: boolean,
): void {
  o.valid = true;
  o.x = x; o.z = z; o.t = t;
  o.bx = bx; o.by = by; o.bz = bz;
  o.hand = hand;
  o.afterWall = afterWall;
  o.volley = volley;
}
