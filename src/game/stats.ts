// Match statistics for the results screen (Phase 8), read from the sim's event ring like the HUD reads it. Points
// are filed the way match-analysis studies file them: a winner is a ball the opponents never return (two bounces,
// out of the court after a good bounce, or onto an opponent); an error is a ball the loser put into their own
// side, the net, a wall before the bounce or out.
import type { MatchSim } from '../sim/match.ts';
import { E_HIT, E_POINT, E_FAULT } from '../sim/match.ts';
import {
  WHY_DOUBLE_BOUNCE, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP, WHY_OWN_SIDE, WHY_WALL_BEFORE_BOUNCE, WHY_OWN_MESH, WHY_OUT, WHY_ROOF, WHY_ROOF_AFTER_BOUNCE,
  WHY_HIT_BODY_OWN, WHY_WHIFF,
} from '../sim/rules/rally.ts';

export interface TeamStats {
  points: number;
  winners: number;
  errors: number;
  aces: number;
  doubleFaults: number;
  /** Out of the court after a good bounce: por tres / por cuatro. */
  outOfCourt: number;
  /** Fastest ball off the racket, km/h. */
  fastest: number;
  serves: number;
  servesWon: number;
}

function blank(): TeamStats {
  return { points: 0, winners: 0, errors: 0, aces: 0, doubleFaults: 0, outOfCourt: 0, fastest: 0, serves: 0, servesWon: 0 };
}

export class MatchStats {
  readonly team: [TeamStats, TeamStats] = [blank(), blank()];
  longestRally = 0;
  /** Sim seconds played. */
  duration = 0;
  private seen = 0;

  update(sim: MatchSim): void {
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      if (e.kind === E_HIT && e.team >= 0) {
        const kmh = e.c * 3.6;
        const t = this.team[e.team]!;
        if (kmh > t.fastest) t.fastest = kmh;
      } else if (e.kind === E_POINT) {
        const won = this.team[e.team]!;
        const lost = this.team[1 - e.team]!;
        won.points++;
        const shots = sim.rally.shots;
        if (shots > this.longestRally) this.longestRally = shots;
        const server = sim.score.serverTeam();
        this.team[server]!.serves++;
        if (e.team === server) this.team[server]!.servesWon++;
        const why = e.a;
        if (why === WHY_DOUBLE_BOUNCE || why === WHY_EXIT_AFTER_BOUNCE || why === WHY_HIT_BODY_OPP || why === WHY_ROOF_AFTER_BOUNCE) {
          won.winners++;
          if (why === WHY_EXIT_AFTER_BOUNCE) won.outOfCourt++;
          // An ace: the serve itself was never returned.
          if (shots <= 1 && e.team === server) won.aces++;
        } else if (why === WHY_OWN_SIDE || why === WHY_WALL_BEFORE_BOUNCE || why === WHY_OWN_MESH || why === WHY_OUT
          || why === WHY_HIT_BODY_OWN || why === WHY_WHIFF || why === WHY_ROOF) {
          lost.errors++;
        }
      } else if (e.kind === E_FAULT && e.b === 2) {
        // A double fault ends the point here (the E_POINT path above doesn't see it).
        const srv = this.team[e.team]!;
        const rcv = this.team[1 - e.team]!;
        srv.doubleFaults++;
        srv.serves++;
        rcv.points++;
      }
    }
    this.duration = sim.time;
  }
}
