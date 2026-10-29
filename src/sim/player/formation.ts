// Doubles positioning, shared by the AI players and the human's positioning assist.
import type { MatchSim } from '../match.ts';
import { abs, clamp, max } from '../core/smath.ts';
import { PF_FLOOR } from '../ball/predict.ts';

/** Depth of a pair at the net and at the back (m from the net). */
export const UP_Z = 3.1;
export const BACK_Z = 8.0;
/** Half the gap between partners (m) and how far the pair follows the ball across (share of its x), up and back.
 * No published distance between partners exists (OPEN_QUESTIONS.md); these are coaching geometry, checked against
 * the volley winners and middle balls in tools/match-stats.ts. */
const UP_HALF_GAP = 1.7;
const BACK_HALF_GAP = 2.3;
const UP_FOLLOW = 0.4;
const BACK_FOLLOW = 0.3;

/**
 * Switching sides ("¡cambio!"): when the partner goes for a ball more than SWITCH_X (m) across the centre line on
 * our side (a lob over us that they take on the diagonal, a poach at the net), we cross over and cover theirs, and
 * the pair plays on from the switched sides. Players have their side (the right-side "drive" and the left-side
 * "revés" player), so a switched pair of AIs crosses back once its own ball gives them SWITCH_BACK_T (s) before it
 * bounces over there (a lob of theirs, usually). Without it the lobbed player dropped back on their own side,
 * outside the partner, and the pair defended with 1.2 m between them and the other side open.
 */
export const SWITCH_X = 0.8;
/**
 * Weaker AI players attack from further back (club players about 4.5 m from the net against the pros' 3.8 m:
 * docs/research/shots-movement-feel.md §5): UP_Z_WEAK more at level 0, 0.7 m at level 0.5. And they move with the
 * ball less as a pair (the follow shares scaled down to 0.4 at level 0): a gap down the middle, not a frozen player.
 */
const UP_Z_WEAK = 1.4;
/** A style that likes the net stands closer in at the net (and a defensive one further out): NET_CLOSE (m) per unit
 * of its net trait away from 1 (data/ai.json). */
const NET_CLOSE = 0.5;
const SWITCH_BACK_T = 1.0;

export interface Spot {
  x: number;
  z: number;
}

/**
 * Where player i stands while the ball isn't theirs to play: parallel with the partner. Up at the net after an
 * attacking shot from the front half or a deep lob, back by the glass otherwise; while the partner plays the
 * ball (`coming`), mirror their depth. Each player keeps their lane (left or right of the pair) and the pair
 * slides towards the ball. Written to `out` (no doubles returned: see CLAUDE.md, V8 boxing).
 */
export function formationSpot(m: MatchSim, i: number, coming: boolean, out: Spot): void {
  const p = m.players[i]!;
  const team = p.team;
  const s = m.side(team);
  const mate = m.players[i ^ 2]!;
  let lane = (p.pos.x - mate.pos.x) * s > 0 ? 1 : (p.pos.x - mate.pos.x) * s < 0 ? -1 : i < 2 ? 1 : -1;
  let up: boolean;
  // Following our lob in: half way while the opponents read it (lobFollow).
  let mid = false;
  if (coming) {
    // Partner is on it: match their depth (where they will play it from), and if they are taking it on our side,
    // switch.
    up = abs(mate.pos.z) < 5.2;
    const mateAi = m.ai[i ^ 2];
    const plan = mateAi ? mateAi.standPlan : m.stand[i ^ 2]!;
    if (m.taker[team] === (i ^ 2) && plan.valid && plan.bx * s * lane > SWITCH_X) lane = -lane;
  } else if (m.lastStrikeTeam === team && m.lastStrikePlayer >= 0) {
    // A switched pair of AIs crosses back when its ball was a long way from bouncing over there (judged once,
    // before the bounce: MatchSim.crossBack).
    const home = m.homeLane[i]!;
    if (home !== 0 && home !== lane && m.ai[i] && m.ai[i ^ 2] && m.crossBack[team] === 1) lane = home;
    // Our ball is going over. The serving pair takes the net; otherwise the striker's decision (an AI decides
    // as it picks its shot), or for a human striker: up after a shot from the front part of the court or a
    // lob that gets past the opponents.
    const striker = m.players[m.lastStrikePlayer]!;
    const intent = m.intentUp[team]!;
    const lob = lobFollow(m, s, team);
    // A lob read as beaten stays followed until the pair's next strike (its intent is reset there), past the lob's
    // bounce, when the read can't be made any more: followed only while the lob was in the air, the lobbers came in
    // and went back as it landed.
    if (lob === LOB_BEATEN) m.intentUp[team] = 1;
    up = m.rally.shots === 1 || lob === LOB_BEATEN || (intent >= 0 ? intent === 1 : abs(striker.lastContact.z) < 6.6);
    mid = !up && lob === LOB_WATCH;
  } else {
    up = abs(p.pos.z) < 5.2;
  }
  // Partners close up at the net and cover the middle (a ball through the middle there passed 1.8 m from each of
  // them at 4.5 m apart: most volley winners went that way); back by the glass they cover the width. Both slide
  // towards the ball (Ramón-Llin et al. 2021: the pair shifts to the side the ball is on), more at the net.
  const half = up ? UP_HALF_GAP : mid ? (UP_HALF_GAP + BACK_HALF_GAP) * 0.5 : BACK_HALF_GAP;
  const ai = m.ai[i];
  const weak = ai ? 1 - ai.level : 0;
  const close = ai ? NET_CLOSE * (ai.style.net - 1) : 0;
  out.x = clamp(lane * s * half + (up ? UP_FOLLOW : BACK_FOLLOW) * (1 - 0.6 * weak) * m.ball.pos.x, p.minX + 0.3, p.maxX - 0.3);
  out.z = s * (up ? UP_Z + UP_Z_WEAK * weak - close : mid ? LOB_MID_Z : BACK_Z);
}

/** The ball's next bounce on the floor is more than SWITCH_BACK_T away. (A boolean: a double returned from a call
 * V8 doesn't inline is boxed.) */
export function bounceIsFar(m: MatchSim): boolean {
  const pr = m.pred;
  for (let k = 0; k < pr.n; k++) if ((pr.flags[k]! & PF_FLOOR) !== 0) return pr.t[k]! - m.time > SWITCH_BACK_T;
  return false;
}

/**
 * Our ball is a lob: do we follow it in? The lob is how a pair takes the net (60.6% of net takes: Muñoz et al. 2017):
 * once it gets past the net players, the lobbers run in while the others turn for the glass. A lobbing player reads
 * it off the opponent taking it: set to take it in the air (a bandeja or smash, a volley) means stay back; running
 * back to play it after the bounce or off the glass means the lob has beaten them (LOB_BEATEN: all the way in);
 * not read yet (no plan, the reaction still coming), a step in to the transition zone (LOB_WATCH, LOB_MID_Z).
 * Followed only on a lob landing within LOB_BEATS of the back glass, the lob made 19% of the AI's net takes and the
 * lobbers were both up at the reply to a lob that got past 28% of the time (REVIEW.md round 3 #3). Followed on the
 * landing alone, without the read, the pair came in to 3 m and had the overhead smashed or volleyed at their feet.
 * A defensive style (data/ai.json net under 1) follows only a lob landing deep: LOB_LAND (m from the net) plus
 * LOB_LAND_SHY per unit of its net trait under 1.
 */
function lobFollow(m: MatchSim, s: number, team: number): number {
  const pr = m.pred;
  const lobber = m.ai[m.lastStrikePlayer];
  const shy = lobber ? max(0, 1 - lobber.style.net) : 0;
  let top = 0;
  let land = 0;
  for (let i = 0; i < pr.n; i++) {
    if (pr.bounces[i]! > 0) { land = pr.z[i]! * s < 0 ? abs(pr.z[i]!) : 0; break; }
    if (pr.y[i]! > top) top = pr.y[i]!;
  }
  if (top < LOB_TOP || land < LOB_LAND + LOB_LAND_SHY * shy) return LOB_NO;
  const k = m.taker[1 - team]!;
  if (k < 0) return LOB_WATCH;
  const ai = m.ai[k];
  const plan = ai ? ai.standPlan : m.stand[k]!;
  if (!plan.valid || plan.version !== pr.version) return LOB_WATCH;
  return plan.volley && plan.inTime ? LOB_NO : LOB_BEATEN;
}
const LOB_NO = 0;
const LOB_WATCH = 1;
const LOB_BEATEN = 2;
/** A lob: over LOB_TOP (m) at its top, landing at least LOB_LAND (m) from the net on their side. */
const LOB_TOP = 4.5;
const LOB_LAND = 5.0;
const LOB_LAND_SHY = 8.0;
/** The transition zone the lobbers step to while the lob is read (m from the net). */
const LOB_MID_Z = 6.0;
