// Where should a player stand to hit the incoming ball comfortably, and when? One plan drives the positioning
// assist, the on-court "stand here" spot, the timing ring and assisted timing, so they never disagree about
// which contact you are going for. Pure sim code, allocation-free.
import type { Prediction } from '../ball/predict.ts';
import type { Player } from './player.ts';
import { heightCost, nearImpact, overheadCost, volleyCost, OH_ANY, OH_BANDEJA, OH_SMASH, OH_VIBORA } from '../contact/windows.ts';
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
  /** Met on the run: the player arrives still moving. */
  onRun: boolean;
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
  /** A contrapared: the player faces their own back glass and plays the ball up into it (see CONTRA_*). */
  contra: boolean;
  /**
   * The last plan that found anything was a contrapared: the player has turned to the glass. Kept through a re-plan
   * that finds nothing (the close-in `only` pass), so a kept contact isn't charged the turn again.
   */
  turned: boolean;
  /** Prediction version the plan was made from. */
  version: number;
}

export function makeStandPlan(): StandPlan {
  return { valid: false, x: 0, z: 0, t: 0, bx: 0, by: 0, onRun: false, bz: 0, hand: 1, afterWall: false, volley: false, overhead: false, volleyKey: false, inTime: false, contra: false, turned: false, version: -1 };
}

/** Margin kept between the ball's path and the body (on top of the body radius). */
const BODY_CLEAR = 0.2;
/** Depth band in front of the back glass where hitting the ball before it reaches the glass is cramped. */
const GLASS_BAND = 1.7;
/**
 * The cost of a contact inside GLASS_BAND before a ball that goes on into the glass, and the bonus for any contact
 * after it, both times the player's glassWait: deep balls are planned off the glass.
 */
const GLASS_WAIT = 0.6;
const GLASS_BONUS = 0.1;
/**
 * A ground stroke's plan cost per unit of the ball's pace and time pressure there (ai/pressure.ts's first two terms,
 * worked out for each candidate contact): players take the easier ball, so a hard ball is let through to the glass
 * when its rebound can be played. Without it the AI half-volleyed 150 km/h smashes 0.06-0.2 s after their bounce from
 * 8 m (the plan cost only height and lateness), where players get back and let them come off the glass.
 */
const PRESSURE_COST = 0.3;
const RISE_PACE = 0.1;
const RISE_LATE = 0;
const RISE_COST = 1.2;
/** A volley planned more than BACK_VOLLEY_Z (m) from the net costs BACK_VOLLEY, plus BACK_VOLLEY_LOW per metre the
 * contact is below BACK_VOLLEY_WAIST (m). */
const BACK_VOLLEY_Z = 5.8;
/** Within NET_ZONE (m) of the net, what each metre given up to play a ball after its bounce costs. */
const NET_ZONE = 4.6;
const NET_HOLD = 0.1;
/** A stroke on the run: what it costs against a set one, and the least time it leaves for the racket (s). */
const STRETCH_COST = 0.5;
const STRETCH_FEET = 0.03;
const STRETCH_BACK = 0.5;
/** A contact under DIE_MARGIN (s) before the ball's second bounce costs DIE_COST per second inside that margin. */
const DIE_MARGIN = 0.4;
const DIE_COST = 3;
const BACK_VOLLEY = 0.4;
const BACK_VOLLEY_LOW = 2.0;
const BACK_VOLLEY_WAIST = 1.1;
/** A spot up to OVERSHOOT_OK (m) short of where the player can stop is still reached (the reach band covers it). */
const OVERSHOOT_OK = 0.15;
/**
 * Volleys are met with a reach or a step, not from set feet: the ball anywhere from VOLLEY_REACH_MIN to
 * VOLLEY_REACH_MAX to the side of the body is in reach (the arm and racket reach about 1.35 m; the comfortable punch
 * is nearer), met the tuning's volleyFront in front of the body.
 */
const VOLLEY_REACH_MIN = 0.35;
const VOLLEY_REACH_MAX = 1.15;

/**
 * Contrapared (shots.ts SHOT_CONTRAPARED): a ball that has bounced on our half and is between the player and their
 * own back glass (dying near it, in the corner, or past the player) is met facing the glass, from the net side of
 * it, and hit up into the glass. Only when nothing better is on: it costs CONTRA_COST over a comfortable stroke, so
 * a ball that comes off the glass to be played facing the net is played that way. The ball's centre must be
 * CONTRA_GLASS_MIN-CONTRA_GLASS_MAX from the glass (room to swing; further out it is a plain ball past the player,
 * which a quick turn and a hit into the glass still saves) and CONTRA_LOW-CONTRA_HIGH up; turning round takes
 * CONTRA_TURN on top of the run.
 */
export const CONTRA_COST = 1.1;
export const CONTRA_GLASS_MIN = 0.75;
export const CONTRA_GLASS_MAX = 2.8;
export const CONTRA_LOW = 0.3;
export const CONTRA_HIGH = 1.55;
const CONTRA_TURN = 0.15;
const BACK_GAP = 0.22;

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
  let secondT = -1;
  for (let i = 0; i < pr.n; i++) {
    if (wallIdx < 0 && pr.bounces[i]! === 1 && pr.walls[i]! > 0 && pr.z[i]! * side > 0) wallIdx = i;
    if (pr.bounces[i]! > 1) { secondT = pr.t[i]!; break; }
  }
  // Holding the net: a ball passed by here is given up, and with it the net (see NET_HOLD).
  const atNet = abs(p.pos.z) < NET_ZONE;
  let bestCost = 1e9;
  let found = false;
  let fbSlack = -1e9;
  // Already set up facing the glass for this contact: the turn is done (charging it again every re-plan made a
  // contrapared impossible in its last 0.2 s, and the plan fell back to a stroke facing the net that whiffed).
  const wasContra = out.turned;
  out.valid = false;
  out.contra = false;
  out.onRun = false;
  out.version = pr.version;
  out.overhead = overhead;
  out.volleyKey = volleyKey;
  // Ground strokes are met contactFront in front of the body and reachComfort from it, volleys volleyFront in front
  // and volleyReach from it (see data/tuning.json; the timing windows use the same distances).
  // (max: a front distance in the data longer than the reach would make the plan NaN; the data keeps it shorter.)
  const lateral = overhead ? t.overheadReach : sqrt(max(0, t.reachComfort * t.reachComfort - t.contactFront * t.contactFront));
  // (an overhead stands where its kind is met: data/tuning.json overheadFront*)
  const behind = !overhead ? t.contactFront : ohKind === OH_BANDEJA ? t.overheadFrontBandeja
    : ohKind === OH_SMASH ? t.overheadFrontSmash : ohKind === OH_VIBORA ? t.overheadFrontVibora : t.overheadFrontAny;
  // An overhead may be met still moving (Player.ohArrive, an AI's): only the braking down to that speed counts.
  const va = overhead ? p.ohArrive : 0;
  // (read here, not in the rare volley-key branch: a value read only there deoptimised the function when it came)
  const vFront = t.volleyFront;
  const latV = overhead ? lateral : sqrt(max(0, t.volleyReach * t.volleyReach - vFront * vFront));
  const behindV = overhead ? behind : vFront;
  const yMax = overhead ? t.contactMaxHeight - 0.05 : volleyKey ? t.overheadHeight + 0.15 : 2.6;
  const riseOff = t.riseMaxOffWall;
  const strikeT = pr.strikeT;
  const wait = p.glassWait;
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
    // (a net player meets a ball in the air the same way, whatever the key: a spot at a set distance from the ball had
    // them walking to it, and a ball passing 0.8 m off the body was out of time from 3 m: the pro's #1)
    const netVolley = atNet && !overhead && b === 0;
    if (volleyKey || netVolley) {
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
      // Arriving at va instead: (v - va)^2 / 2av.
      const rv = p.runV;
      const brk = rv > va ? (rv - va) * (rv - va) / (1.6 * t.brake * rv) : 0;
      need = volleyKey ? p.runT + 0.03 : p.runT + brk + (dist > 0.4 ? (kept ? 0.05 : 0.1) : 0.05);
      // Running in faster than they can stop short of the spot (braking at 0.8 of the limit), a player is there at
      // ti only by passing through it then (a volley on the move) or by stopping beyond it and coming back. (A
      // server running in at 4.7 m/s planned a volley 1 m ahead, needed 1.4 m to stop and was passed by the ball.)
      const v0 = p.vel.x * p.runX + p.vel.z * p.runZ;
      const sd = v0 > 0 ? v0 * v0 / (1.6 * t.brake) : 0;
      if (sd > dist + OVERSHOOT_OK) {
        const through = (v0 - sqrt(max(0, v0 * v0 - 1.6 * t.brake * dist))) / (0.8 * t.brake);
        if (!(volleyKey && ti - now <= through + 0.05)) {
          need = max(need, v0 / (0.8 * t.brake) + sqrt(2 * (sd - dist) / t.accel) + 0.1);
        }
      }
    }
    let slack = ti - now - need;
    // Out of time to set the feet, in time to get there: a stroke on the run, for a ball that is otherwise lost (the
    // pro's #3 and #24: 76% of shots were struck from a standstill and 15% of points ended on a ball nobody ran for).
    // (across or forward: nobody strikes one running at their own glass, that is the contrapared's ball)
    const onRun = slack < 0 && b === 1 && !overhead && !volleyKey && dist > 1e-3 && dz * side < STRETCH_BACK * dist
      && ti - now - p.runT - STRETCH_FEET >= 0;
    if (onRun) slack = 0;
    const afterWall = pr.walls[i]! > 0 && b === 1;
    // The easier ball: pace 14 m/s none, 26 m/s one unit; time since the strike 0.9 s none, 0.45 s one unit.
    let press = 0;
    if (b === 1) {
      const vx = pr.vx[i]!, vy = pr.vy[i]!, vz = pr.vz[i]!;
      const pace = (sqrt(vx * vx + vy * vy + vz * vz) - 14) / 12;
      const late = (0.9 - (ti - strikeT)) / 0.45;
      press = PRESSURE_COST * (clamp(pace, 0, 3) + clamp(late, 0, 2));
      // Hard, soon, and on its way to a wall: a defender steps off its line and plays it off the glass (review round 5,
      // the pro's #1: 83% of the replies to smashes against two back were struck on the rise).
      if (pace > RISE_PACE && late > RISE_LATE && wallIdx >= 0 && i < wallIdx) press += RISE_COST;
    }
    if (slack >= 0) {
      let cost = overhead ? overheadCost(y, t, ohKind) + 0.03 * (ti - now)
        : volleyKey ? volleyCost(y) + 0.25 * (ti - now)
        : heightCost(y, t.overheadHeight) + 0.03 * (ti - now);
      if (kept) cost -= 0.35;
      if (!overhead && !volleyKey) {
        // Heading into the back glass and already deep: let it come off the glass instead.
        if (wallIdx >= 0 && i < wallIdx && b === 1 && abs(z) > backZ - GLASS_BAND) cost += GLASS_WAIT * wait;
        if (afterWall) cost -= GLASS_BONUS * wait;
        // Volleying from the back of the court is rarely the right read, and a low one never is: a ball below the
        // waist back there is let bounce (or come off the glass) and played up from below. Judged at the spot the
        // volley would be played from: judged where the player was, defenders still on their way back volleyed 58%
        // of bandejas from 7 m at 0.6 m high (REVIEW.md round 3 #1).
        if (b === 0 && abs(sz) > BACK_VOLLEY_Z) cost += BACK_VOLLEY + BACK_VOLLEY_LOW * max(0, BACK_VOLLEY_WAIST - y);
        // A net player's ball is the one in the air: backing off to wait for the rebound gives up the net (review
        // round 6, the pro's #1: 31 reachable flat balls per 100 points were let past, 70% to be played off the glass).
        if (atNet && b === 1) cost += NET_HOLD * (abs(sz) - abs(p.pos.z) > 0 ? abs(sz) - abs(p.pos.z) : 0);
        // A ball about to die: the last moments before its second bounce are no plan to walk to (the pro's #3: 15% of
        // points ended on a soft ball the defender was waiting for at the glass).
        if (b === 1 && secondT >= 0 && secondT - ti < DIE_MARGIN) cost += DIE_COST * (DIE_MARGIN - (secondT - ti));
        cost += press;
        if (onRun) cost += STRETCH_COST;
      }
      if (cost < bestCost && clearOfBall(pr, now, i, sx, sz, t.height, t.bodyRadius)) {
        bestCost = cost;
        found = true;
        write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1, afterWall, b === 0);
        out.inTime = true;
        out.contra = false;
        out.onRun = onRun;
      }
    } else if (!found && slack > fbSlack) {
      fbSlack = slack;
      write(out, sx, sz, ti, x, y, z, useFh ? 1 : -1, afterWall, b === 0);
      out.inTime = false;
      out.contra = false;
    }
    // The contrapared from this sample: facing the glass, from the net side of the ball.
    if (overhead || volleyKey || b !== 1 || y < CONTRA_LOW || y > CONTRA_HIGH) continue;
    // (the glass is BACK_GAP behind the players' back limit, Player.setHalf)
    const gap = backZ + BACK_GAP - abs(z);
    if (gap < CONTRA_GLASS_MIN || gap > CONTRA_GLASS_MAX) continue;
    // Facing the glass the forehand is on the other side of the ball from facing the net.
    const cfX = x + side * p.handed * lateral;
    const cbX = x - side * p.handed * lateral;
    const cFh = abs(cfX - p.pos.x) <= abs(cbX - p.pos.x) + 0.6;
    const cx = clamp(cFh ? cfX : cbX, p.minX, p.maxX);
    const cz = clamp(z - side * behind, p.minZ, p.maxZ);
    const cdx = cx - p.pos.x;
    const cdz = cz - p.pos.z;
    const cd = sqrt(cdx * cdx + cdz * cdz);
    const turn = kept && wasContra ? 0 : CONTRA_TURN;
    let cNeed = 0.05 + turn;
    if (cd > 1e-3) {
      p.runD = cd;
      p.runX = cdx / cd;
      p.runZ = cdz / cd;
      p.runTime();
      cNeed = p.runT + p.runV / (1.6 * t.brake) + (cd > 0.4 ? (kept ? 0.05 : 0.1) : 0.05) + turn;
    }
    const cSlack = ti - now - cNeed;
    if (cSlack < 0) {
      // Out of time: still the least-late plan if it is (a ball behind the player dying on the glass has no other).
      if (!found && cSlack > fbSlack) {
        fbSlack = cSlack;
        write(out, cx, cz, ti, x, y, z, cFh ? 1 : -1, pr.walls[i]! > 0, false);
        out.inTime = false;
        out.contra = true;
      }
      continue;
    }
    // (a hard ball is as hard to meet facing the glass: it is better waited for off the glass)
    let cCost = CONTRA_COST + heightCost(y, t.overheadHeight) + 0.03 * (ti - now) + press;
    if (kept) cCost -= 0.35;
    if (cCost < bestCost && clearOfBall(pr, now, i, cx, cz, t.height, t.bodyRadius)) {
      bestCost = cCost;
      found = true;
      write(out, cx, cz, ti, x, y, z, cFh ? 1 : -1, pr.walls[i]! > 0, false);
      out.inTime = true;
      out.contra = true;
    }
  }
  if (out.valid) out.turned = out.contra;
  return out.valid;
}

/** A bajada (ai/simpleAi.ts) is a ball off our own back glass falling through overheadHeight + BAJADA_ABOVE m or
 * higher, BAJADA_DEPTH m or more from the net. */
export const BAJADA_ABOVE = 0.1;
export const BAJADA_DEPTH = 6.5;

/**
 * A bajada is on: after its bounce on our half (`side`) the ball comes off our own back glass (the first wall it
 * touches after the bounce, `halfL` - 1.2 m or deeper) and drops through `minY` or higher, falling, at least
 * `minDepth` from the net, at or after `from`. Returns that sample's index, or -1. The AI and the HUD read it; the
 * plan itself is planStand's with the overhead key.
 */
export function offGlassHigh(pr: Prediction, side: number, from: number, minY: number, minDepth: number, halfL: number): number {
  let back = false;
  for (let i = 0; i < pr.n; i++) {
    const b = pr.bounces[i]!;
    if (b > 1) break;
    if (b === 0) continue;
    const z = pr.z[i]! * side;
    if (z < 0) return -1;
    if (!back && pr.walls[i]! > 0) {
      if (z < halfL - 1.2) return -1;
      back = true;
    }
    if (back && pr.t[i]! >= from && pr.vy[i]! < 0 && pr.y[i]! >= minY && z >= minDepth) return i;
  }
  return -1;
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
