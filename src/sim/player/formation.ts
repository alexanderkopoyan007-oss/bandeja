// Doubles positioning, shared by the AI players and the human's positioning assist.
import type { MatchSim } from '../match.ts';
import { abs, clamp } from '../core/smath.ts';
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
  if (coming) {
    // Partner is on it: match their depth (where they will play it from), and if they are taking it on our side,
    // switch.
    up = abs(mate.pos.z) < 5.2;
    const mateAi = m.ai[i ^ 2];
    const plan = mateAi ? mateAi.standPlan : m.stand[i ^ 2]!;
    if (m.taker[team] === (i ^ 2) && plan.valid && plan.bx * s * lane > SWITCH_X) lane = -lane;
  } else if (m.lastStrikeTeam === team && m.lastStrikePlayer >= 0) {
    // A switched pair of AIs crosses back while its ball is a long way from bouncing over there.
    const home = m.homeLane[i]!;
    if (home !== 0 && home !== lane && m.ai[i] && m.ai[i ^ 2] && bounceIsFar(m)) lane = home;
    // Our ball is going over. The serving pair takes the net; otherwise the striker's decision (an AI decides
    // as it picks its shot), or for a human striker: up after a shot from the front part of the court or a
    // lob that gets past the opponents.
    const striker = m.players[m.lastStrikePlayer]!;
    const intent = m.intentUp[team]!;
    up = m.rally.shots === 1 || deepLob(m, s, team) || (intent >= 0 ? intent === 1 : abs(striker.lastContact.z) < 6.6);
  } else {
    up = abs(p.pos.z) < 5.2;
  }
  // Partners close up at the net and cover the middle (a ball through the middle there passed 1.8 m from each of
  // them at 4.5 m apart: most volley winners went that way); back by the glass they cover the width. Both slide
  // towards the ball (Ramón-Llin et al. 2021: the pair shifts to the side the ball is on), more at the net.
  const half = up ? UP_HALF_GAP : BACK_HALF_GAP;
  const ai = m.ai[i];
  const weak = ai ? 1 - ai.level : 0;
  const close = ai ? NET_CLOSE * (ai.style.net - 1) : 0;
  out.x = clamp(lane * s * half + (up ? UP_FOLLOW : BACK_FOLLOW) * (1 - 0.6 * weak) * m.ball.pos.x, p.minX + 0.3, p.maxX - 0.3);
  out.z = s * (up ? UP_Z + UP_Z_WEAK * weak - close : BACK_Z);
}

/** The ball's next bounce on the floor is more than SWITCH_BACK_T away. (A boolean: a double returned from a call
 * V8 doesn't inline is boxed.) */
function bounceIsFar(m: MatchSim): boolean {
  const pr = m.pred;
  for (let k = 0; k < pr.n; k++) if ((pr.flags[k]! & PF_FLOOR) !== 0) return pr.t[k]! - m.time > SWITCH_BACK_T;
  return false;
}

/**
 * The pair's ball is a lob that will beat the opponents and land deep: follow it in. A lob the net player can still
 * take overhead is not followed (the lobbing pair ran in and had the overhead smashed at them from 5 m): only one
 * landing within LOB_BEATS of the back glass, and only while the opponent taking it is not setting up to take it in
 * the air, as a lobbing player watches whether the net player turns and runs or sets for the overhead (followed on
 * the landing alone, the pair came in to 3 m and volleyed the bandeja at their feet: bandejas forced 24% of the
 * returns, the pros' 3.5% winners and few errors forced).
 */
function deepLob(m: MatchSim, s: number, team: number): boolean {
  const pr = m.pred;
  // An AI lobber's style sets how good the lob must be to follow it in (a net-rusher follows a shorter one).
  const lobber = m.ai[m.lastStrikePlayer];
  const beats = lobber ? LOB_BEATS * lobber.style.net : LOB_BEATS;
  let top = 0;
  let deep = false;
  for (let i = 0; i < pr.n; i++) {
    if (pr.bounces[i]! > 0) { deep = top > 4.5 && abs(pr.z[i]!) > m.world.court.halfL - beats && pr.z[i]! * s < 0; break; }
    if (pr.y[i]! > top) top = pr.y[i]!;
  }
  if (!deep) return false;
  const k = m.taker[1 - team]!;
  if (k < 0) return true;
  const ai = m.ai[k];
  const plan = ai ? ai.standPlan : m.stand[k]!;
  return !(plan.valid && plan.inTime && plan.volley);
}
const LOB_BEATS = 2.0;
