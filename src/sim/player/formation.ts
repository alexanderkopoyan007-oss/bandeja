// Doubles positioning, shared by the AI players and the human's positioning assist.
import type { MatchSim } from '../match.ts';
import { abs, clamp } from '../core/smath.ts';

/** Depth of a pair at the net and at the back (m from the net). */
export const UP_Z = 3.1;
export const BACK_Z = 7.5;

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
  const c = m.world.court;
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
    up = m.rally.shots === 1 || deepLob(m, s) || (intent >= 0 ? intent === 1 : abs(striker.lastContact.z) < 6.6);
  } else {
    up = abs(p.pos.z) < 5.2;
  }
  out.x = clamp(lane * s * c.halfW * 0.45 + 0.3 * m.ball.pos.x, p.minX + 0.3, p.maxX - 0.3);
  out.z = s * (up ? UP_Z : BACK_Z);
}

/** The pair's ball is a lob that will get over the opponents and land deep: follow it in. */
function deepLob(m: MatchSim, s: number): boolean {
  const pr = m.pred;
  let top = 0;
  for (let i = 0; i < pr.n; i++) {
    if (pr.bounces[i]! > 0) return top > 4.5 && abs(pr.z[i]!) > 7.5 && pr.z[i]! * s < 0;
    if (pr.y[i]! > top) top = pr.y[i]!;
  }
  return false;
}
