// "Bodies count" (M5 phase D, a fun toggle, off by default and never online): a player's own body changes how they play.
// Their height, legs, arms and trunk (the character's proportions, render/avatar/proportions.ts) move where they can
// meet the ball and how fast they run. Off, every player is the tuned 1.80 m body (data/tuning.json player), whatever
// they look like, and the avatar bends to reach what that body reaches.
//
// The tuned body, put together as Drillis & Contini (1966) put a 1.80 m adult (fractions of stature): the hip joint at
// 0.53 (0.954 m), the shoulder at 0.818 (reachShoulder, 1.47 m), so 0.516 m of trunk between them; the straight arm from
// the shoulder to the grip about 0.73 m (fingertips at 1.33 of stature less the hand's 0.108 and the shoulder's height),
// and the racket's 0.32 m to its face's centre (reachArm 1.05 m with both). What a body changes:
//   - the shoulder's height (legs and trunk): the reach's sphere sits on it, and a ball off the glass is met below it;
//   - the arm (the racket stays the racket): the reach's radius, across the floor and overhead;
//   - the highest contact and the overheads' planned heights, with the top of the reach;
//   - top speed, by the leg's length as running animals' speeds scale (Froude: v ~ sqrt(leg)), held within +-15%: the
//     legs' length is one thing a sprint hangs on among many.
// The jump, the body's girth, timing and everything else stay the tuned body's.
import type { PlayerTuning } from './player.ts';

/** A body against the tuned one (1: as built): the whole height, and the legs', arms' and trunk's lengths on top of it. */
export interface BodyScale {
  height: number;
  legs: number;
  arms: number;
  torso: number;
}

/** The tuned body's hip-joint height and trunk (hip to shoulder), m; the arm's share of reachArm (the rest is racket). */
const HIP = 0.954, TRUNK = 0.516, ARM = 0.73;
/** How far the leg's length moves top speed, at most (either way). */
const SPEED_SPAN = 0.15;

/** A neutral body (no change at all): null bodies and these play as the tuned player, to the bit. */
export function isNeutralBody(b: BodyScale | null | undefined): boolean {
  return !b || (b.height === 1 && b.legs === 1 && b.arms === 1 && b.torso === 1);
}

/** The tuning of `base` (the match's player: a man's or a woman's) for a body `b`. */
export function tuneForBody(base: PlayerTuning, b: BodyScale): PlayerTuning {
  const leg = b.height * b.legs, trunk = b.height * b.torso, arm = b.height * b.arms;
  // (the base's own shoulder and arm, so a women's tuning scales from its own)
  const sScale = (HIP * leg + TRUNK * trunk) / (HIP + TRUNK);
  const shoulder = base.reachShoulder * sScale;
  const reachArm = base.reachArm + ARM * (arm - 1);
  const dArm = reachArm - base.reachArm;
  const topWas = base.reachShoulder + base.reachArm, top = shoulder + reachArm;
  const k = top / topWas, dTop = top - topWas;
  const v = Math.min(1 + SPEED_SPAN, Math.max(1 - SPEED_SPAN, Math.sqrt(leg)));
  const stature = base.height * (0.53 * leg + 0.287 * trunk + 0.183 * b.height);
  return {
    ...base,
    height: stature,
    waistHeight: base.waistHeight * leg,
    maxSpeed: base.maxSpeed * v, sideSpeed: base.sideSpeed * v, backSpeed: base.backSpeed * v, fvSpeed: base.fvSpeed * v,
    reachShoulder: shoulder,
    riseMaxOffWall: base.riseMaxOffWall * sScale,
    reachArm,
    // Across the floor the arm reaches as much further as it is longer.
    reachComfort: base.reachComfort + dArm, reachMax: base.reachMax + dArm, volleyReach: base.volleyReach + dArm,
    overheadReach: base.overheadReach * (reachArm / base.reachArm),
    contactMaxHeight: base.contactMaxHeight + dTop,
    overheadHeight: base.overheadHeight * k,
    overheadIdealHeight: base.overheadIdealHeight * k,
    overheadIdealBandeja: base.overheadIdealBandeja * k,
    overheadIdealVibora: base.overheadIdealVibora * k,
    overheadIdealSmash: base.overheadIdealSmash * k,
  };
}
