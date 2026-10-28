// Where should a player stand to hit the incoming ball comfortably, and when? One plan drives the positioning
// assist, the on-court "stand here" spot, the timing ring and assisted timing, so they never disagree about
// which contact you are going for. Pure sim code, allocation-free.
import type { Prediction } from '../ball/predict.ts';
import type { Player } from './player.ts';
import { heightCost, nearImpact, overheadCost, volleyCost, OH_ANY } from '../contact/windows.ts';
import { abs, clamp, max, sqrt } from '../core/smath.ts';

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
  /** Planned for the volley key (the plan is a volley if one can be reached in time; see `volley`). */
  volleyKey: boolean;
  /** The player can get there in time (false: the best try, out of time). */
  inTime: boolean;
  /** Prediction version the plan was made from. */
  version: number;
}

export function makeStandPlan(): StandPlan {
  return { valid: false, x: 0, z: 0, t: 0, bx: 0, by: 0, bz: 0, hand: 1, afterWall: false, volley: false, overhead: false, volleyKey: false, inTime: false, version: -1 };
}

/** Margin kept between the ball's path and the body (on top of the body radius). */
const BODY_CLEAR = 0.2;
/** Depth band in front of the back glass where hitting the ball before it reaches the glass is cramped. */
const GLASS_BAND = 1.7;
/**
 * A ground stroke's plan cost per unit of the ball's pace and time pressure there (ai/pressure.ts's first two terms,
 * worked out for each candidate contact): players take the easier ball, so a hard ball is let through to the glass
 * when its rebound can be played. Without it the AI half-volleyed 150 km/h smashes 0.06-0.2 s after their bounce from
 * 8 m (the plan cost only height and lateness), where players get back and let them come off the glass.
 */
const PRESSURE_COST = 0.3;
/**
 * Volleys are met with a reach or a step, not from set feet: the ball anywhere from VOLLEY_REACH_MIN to
 * VOLLEY_REACH_MAX to the side of the body is in reach (the arm and racket reach about 1.35 m; the comfortable punch
 * is nearer), met the tuning's volleyFront in front of the body.
 */
const VOLLEY_REACH_MIN = 0.35;
const VOLLEY_REACH_MAX = 1.15;

/**
 * Pick the contact the player can reach in time with the best height. Deep balls that will come off the back
 * glass are planned off the glass (as real players play them), and spots the ball flies through on its way
 * there are rejected (the ball would hit the player). `side` is the player's half (+1 / -1).
 * `keep` >= 0 is the contact moment already planned: it is preferred (a plan that keeps changing its mind has
 * the player running back and forth), and with `only` set nothing else is considered (close to contact).
 * `overhead`: the player is holding the overhead key: plan to take the ball high, in the air if need be,
 * standing under it with the ball just in front and to the racket side.
 * `volleyKey`: the player is holding the volley key: only contacts before the bounce, at volley height, met as
 * early as the run allows (cutting the ball off closes the angles). If none can be reached in time the caller
 * plans again without it. `ohKind` (windows.ts OH_*): the overhead already picked, met at its own height.
 */
export function planStand(
  pr: Prediction, p: Player, side: number, now: number, mustBounce: boolean, out: StandPlan, keep: number, only: boolean,
  overhead: boolean, volleyKey = false, ohKind = OH_ANY,
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
  out.volleyKey = volleyKey;
  // Ground strokes are met contactFront in front of the body and reachComfort from it, volleys volleyFront in front
  // and volleyReach from it (see data/tuning.json; the timing windows use the same distances).
  // (max: a front distance in the data longer than the reach would make the plan NaN; the data keeps it shorter.)
  const lateral = overhead ? t.overheadReach : sqrt(max(0, t.reachComfort * t.reachComfort - t.contactFront * t.contactFront));
  const behind = overhead ? 0.3 : t.contactFront;
  // (read here, not in the rare volley-key branch: a value read only there deoptimised the function when it came)
  const vFront = t.volleyFront;
  const latV = overhead ? lateral : sqrt(max(0, t.volleyReach * t.volleyReach - vFront * vFront));
  const behindV = overhead ? behind : vFront;
  const yMax = overhead ? t.contactMaxHeight - 0.05 : volleyKey ? t.overheadHeight + 0.15 : 2.6;
  const riseOff = t.riseMaxOffWall;
  const strikeT = pr.strikeT;
  for (let i = 0; i < pr.n; i++) {
    const ti = pr.t[i]!;
    const kept = keep >= 0 && abs(ti - keep) <= 0.15;
    if (only ? !kept || ti < now : ti < now + 0.05) continue;
    const x = pr.x[i]!;
    const y = pr.y[i]!;
    const z = pr.z[i]!;
    const b = pr.bounces[i]!;
    if (z * side < 0.3 || b > 1 || (mustBounce && b === 0) || y < 0.3 || y > yMax) continue;
    if (volleyKey && b !== 0) continue;
    if (nearImpact(pr, i)) continue;
    // Off a wall, a ball still climbing past the shoulders is out of reach until it comes down.
    if (y > riseOff && pr.walls[i]! > 0 && pr.vy[i]! > 0) continue;
    const lat = b === 0 ? latV : lateral;
    const fhX = x - side * p.handed * lat;
    const bhX = x + side * p.handed * lat;
    // Overheads are hit on the racket side (a backhand overhead is a last resort).
    let useFh = overhead || abs(fhX - p.pos.x) <= abs(bhX - p.pos.x) + 0.6;
    let sx = clamp(useFh ? fhX : bhX, p.minX, p.maxX);
    let sz = clamp(z + side * (b === 0 ? behindV : behind), p.minZ, p.maxZ);
    if (volleyKey) {
      // Stay put if the ball passes within reach; otherwise the smallest step that brings it there, on the side
      // the player already is (forehand when it comes straight at them).
      const off = p.pos.x - x;
      const fhSign = -side * p.handed;
      const sg = abs(off) < 0.1 ? fhSign : off > 0 ? 1 : -1;
      const a = abs(off);
      sx = clamp(a < VOLLEY_REACH_MIN ? x + sg * VOLLEY_REACH_MIN : a > VOLLEY_REACH_MAX ? x + sg * VOLLEY_REACH_MAX : p.pos.x, p.minX, p.maxX);
      useFh = sg === fhSign;
      const z0 = z + side * vFront;
      sz = clamp(abs(p.pos.z - z0) < 0.4 ? p.pos.z : z0 + (p.pos.z > z0 ? 0.4 : -0.4), p.minZ, p.maxZ);
    }
    const dx = sx - p.pos.x;
    const dz = sz - p.pos.z;
    const dist = sqrt(dx * dx + dz * dz);
    // Time to get there: the run (from the current velocity, at the top speed for that direction relative to
    // the ball), stopping, and setting the feet (less if already on the way).
    let need = 0.05;
    if (dist > 1e-3) {
      p.runD = dist;
      p.runX = dx / dist;
      p.runZ = dz / dist;
      p.runTime();
      // Stopping at the spot takes v / 2a beyond running through it (braking at 0.8 of the limit, as the AI and
      // the assist do).
      // A volley is met on the move if need be (a stretch volley): no stop, no setting the feet.
      need = volleyKey ? p.runT + 0.03 : p.runT + p.runV / (1.6 * t.brake) + (dist > 0.4 ? (kept ? 0.05 : 0.1) : 0.05);
    }
    const slack = ti - now - need;
    const afterWall = pr.walls[i]! > 0 && b === 1;
    if (slack >= 0) {
      let cost = overhead ? overheadCost(y, t, ohKind) + 0.03 * (ti - now)
        : volleyKey ? volleyCost(y) + 0.25 * (ti - now)
        : heightCost(y, t.overheadHeight) + 0.03 * (ti - now);
      if (kept) cost -= 0.35;
      if (!overhead && !volleyKey) {
        // Heading into the back glass and already deep: let it come off the glass instead.
        if (wallIdx >= 0 && i < wallIdx && b === 1 && abs(z) > backZ - GLASS_BAND) cost += 0.6;
        if (afterWall) cost -= 0.1;
        // Volleying from the back of the court is rarely the right read.
        if (b === 0 && abs(p.pos.z) > 6.5) cost += 0.4;
        // The easier ball: pace 14 m/s none, 26 m/s one unit; time since the strike 0.9 s none, 0.45 s one unit.
        if (b === 1) {
          const vx = pr.vx[i]!, vy = pr.vy[i]!, vz = pr.vz[i]!;
          const pace = (sqrt(vx * vx + vy * vy + vz * vz) - 14) / 12;
          const late = (0.9 - (ti - strikeT)) / 0.45;
          cost += PRESSURE_COST * (clamp(pace, 0, 3) + clamp(late, 0, 2));
        }
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
