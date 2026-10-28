// Doubles positioning, shared by the AI players and the human's positioning assist.
import type { MatchSim } from '../match.ts';
import { abs, clamp } from '../core/smath.ts';

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
  const lane = (p.pos.x - mate.pos.x) * s > 0 ? 1 : (p.pos.x - mate.pos.x) * s < 0 ? -1 : i < 2 ? 1 : -1;
  let up: boolean;
  if (coming) {
    // Partner is on it: match their depth (where they will play it from).
    up = abs(mate.pos.z) < 5.2;
  } else if (m.lastStrikeTeam === team && m.lastStrikePlayer >= 0) {
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
  out.x = clamp(lane * s * half + (up ? UP_FOLLOW : BACK_FOLLOW) * m.ball.pos.x, p.minX + 0.3, p.maxX - 0.3);
  out.z = s * (up ? UP_Z : BACK_Z);
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
  let top = 0;
  let deep = false;
  for (let i = 0; i < pr.n; i++) {
    if (pr.bounces[i]! > 0) { deep = top > 4.5 && abs(pr.z[i]!) > m.world.court.halfL - LOB_BEATS && pr.z[i]! * s < 0; break; }
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
