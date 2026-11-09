// Match statistics for the results screen (Phase 8), read from the sim's event ring like the HUD reads it. Points
// are filed the way match-analysis studies file them: a winner is a ball the opponents never return (two bounces,
// out of the court after a good bounce, or onto an opponent); an error is a ball the loser put into their own
// side, the net, a wall before the bounce or out.
// The breakdown (M7 phase D, the brief's "a deep shot-stats breakdown after each match"): every shot by its kind and
// what became of it (the point won on it, lost on it, or the ball came back), overheads together, first serves in,
// time at the net and distance run in the rallies, points by the rally's length, and where each pair's shots first
// came down. All counted as the match goes, into numbers and arrays made once.
import type { MatchSim } from '../sim/match.ts';
import { E_HIT, E_POINT, E_FAULT, E_FLOOR, PH_RALLY } from '../sim/match.ts';
import { SHOT_KEYS, SHOT_SERVE, SHOT_SMASH, SHOT_BANDEJA, SHOT_VIBORA } from '../sim/contact/shots.ts';
import { eventsOf } from '../net/feed.ts';
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
  /** Each kind of shot (by SHOT_KEYS): played, the point won on it, the point lost on it (the rest came back). */
  shots: ShotLine[];
  /** First serves struck, and in. */
  firsts: number;
  firstsIn: number;
  /** Seconds of rally, summed over the pair's players, and the share of it they spent within NET_ZONE m of the net. */
  rallySecs: number;
  netSecs: number;
  /** Metres run in the rallies, the pair together. */
  run: number;
  /** Points won by the rally's length (RALLY_BANDS: 1-3, 4-6, 7-9, 10 or more shots). */
  bands: number[];
  /** Where the pair's shots first came down (x, then z with the opponents' half always z < 0), and how many. */
  landX: Float32Array;
  landZ: Float32Array;
  landed: number;
}

/** A kind of shot's line. */
export interface ShotLine { played: number; won: number; lost: number }
/** Within this far of the net (m) a player is "at the net" (the volleying zone: the service line is 6.95 m back). */
export const NET_ZONE = 4;
/** The rally-length bands' lower ends (shots). */
export const RALLY_BANDS = [1, 4, 7, 10] as const;
/** Landing spots kept for each pair (the first this many). */
export const MAX_LANDED = 600;
/** The overheads: smash, bandeja, víbora. */
export const OVERHEADS = [SHOT_SMASH, SHOT_BANDEJA, SHOT_VIBORA] as const;

/** One player's own, for the cosmetics' unlocks (app/unlocks.ts): in doubles a partner's ace isn't yours. */
export interface PlayerFeats {
  aces: number;
  outOfCourt: number;
  /** km/h */
  fastest: number;
}

function blank(): TeamStats {
  return {
    points: 0, winners: 0, errors: 0, aces: 0, doubleFaults: 0, outOfCourt: 0, fastest: 0, serves: 0, servesWon: 0,
    shots: SHOT_KEYS.map(() => ({ played: 0, won: 0, lost: 0 })), firsts: 0, firstsIn: 0, rallySecs: 0, netSecs: 0, run: 0,
    bands: RALLY_BANDS.map(() => 0), landX: new Float32Array(MAX_LANDED), landZ: new Float32Array(MAX_LANDED), landed: 0,
  };
}

/** A pair's overheads together: played, won on, lost on. */
export function overheads(t: TeamStats): ShotLine {
  const o = { played: 0, won: 0, lost: 0 };
  for (const k of OVERHEADS) { const l = t.shots[k]!; o.played += l.played; o.won += l.won; o.lost += l.lost; }
  return o;
}

export class MatchStats {
  readonly team: [TeamStats, TeamStats] = [blank(), blank()];
  /** By player number. */
  readonly player: PlayerFeats[] = [0, 1, 2, 3].map(() => ({ aces: 0, outOfCourt: 0, fastest: 0 }));
  longestRally = 0;
  /** Sim seconds played. */
  duration = 0;
  private seen = 0;
  /** The player who struck the ball last: an ace's server, a por tres's hitter. */
  private lastHitter = -1;
  /** The last shot struck, still to be filed (its team and kind; -1: none), and whether its first bounce is in. */
  private openTeam = -1;
  private openShot = -1;
  private openLanded = true;
  /** A first serve struck and not yet called a fault (it is in once anything else happens). */
  private firstOpen = -1;
  /** For the rallies' time and running: the last frame's sim time and where each player stood. */
  private lastT = -1;
  private readonly lastX = new Float64Array(4);
  private readonly lastZ = new Float64Array(4);

  update(sim: MatchSim): void {
    if (eventsOf(sim).eventSeq - this.seen > eventsOf(sim).events.length) this.seen = eventsOf(sim).eventSeq - eventsOf(sim).events.length;
    while (this.seen < eventsOf(sim).eventSeq) {
      const e = eventsOf(sim).events[this.seen % eventsOf(sim).events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      if (e.kind === E_HIT && e.team >= 0) {
        // The shot before came back.
        this.closeFirst(true);
        const line = this.team[e.team]!.shots[e.a];
        if (line) line.played++;
        this.openTeam = e.team;
        this.openShot = e.a;
        this.openLanded = false;
        if (e.a === SHOT_SERVE && sim.serveNo === 1) { this.team[e.team]!.firsts++; this.firstOpen = e.team; }
        const kmh = e.c * 3.6;
        const t = this.team[e.team]!;
        if (kmh > t.fastest) t.fastest = kmh;
        const own = this.player[e.player];
        if (own) {
          this.lastHitter = e.player;
          if (kmh > own.fastest) own.fastest = kmh;
        }
      } else if (e.kind === E_FLOOR && !this.openLanded && this.openTeam >= 0) {
        // The shot's first bounce: kept as seen from the hitter's end (their opponents' half towards -z).
        this.openLanded = true;
        const t = this.team[this.openTeam]!;
        if (t.landed < MAX_LANDED) {
          const s = sim.side(this.openTeam);
          t.landX[t.landed] = e.x * s;
          t.landZ[t.landed] = e.z * s;
          t.landed++;
        }
      } else if (e.kind === E_POINT) {
        const won = this.team[e.team]!;
        const lost = this.team[1 - e.team]!;
        won.points++;
        const shots = sim.rally.shots;
        if (shots > this.longestRally) this.longestRally = shots;
        // The last shot: the point won or lost on it; the rally's length band.
        this.closeFirst(true);
        if (this.openTeam >= 0) {
          const line = this.team[this.openTeam]!.shots[this.openShot];
          if (line) { if (this.openTeam === e.team) line.won++; else line.lost++; }
        }
        this.openTeam = -1;
        let band = 0;
        while (band + 1 < RALLY_BANDS.length && shots >= RALLY_BANDS[band + 1]!) band++;
        won.bands[band]!++;
        const server = sim.score.serverTeam();
        this.team[server]!.serves++;
        if (e.team === server) this.team[server]!.servesWon++;
        const why = e.a;
        if (why === WHY_DOUBLE_BOUNCE || why === WHY_EXIT_AFTER_BOUNCE || why === WHY_HIT_BODY_OPP || why === WHY_ROOF_AFTER_BOUNCE) {
          won.winners++;
          const by = sim.players[this.lastHitter]?.team === e.team ? this.player[this.lastHitter] : undefined;
          if (why === WHY_EXIT_AFTER_BOUNCE) {
            won.outOfCourt++;
            if (by) by.outOfCourt++;
          }
          // An ace: the serve itself was never returned.
          if (shots <= 1 && e.team === server) {
            won.aces++;
            if (by) by.aces++;
          }
        } else if (why === WHY_OWN_SIDE || why === WHY_WALL_BEFORE_BOUNCE || why === WHY_OWN_MESH || why === WHY_OUT
          || why === WHY_HIT_BODY_OWN || why === WHY_WHIFF || why === WHY_ROOF) {
          lost.errors++;
        }
      } else if (e.kind === E_FAULT) {
        // A serve called a fault: lost on (and a first serve not in).
        this.closeFirst(false);
        if (this.openTeam >= 0) { const line = this.team[this.openTeam]!.shots[this.openShot]; if (line) line.lost++; }
        this.openTeam = -1;
      }
      if (e.kind === E_FAULT && e.b === 2) {
        // A double fault ends the point here (the E_POINT path above doesn't see it).
        const srv = this.team[e.team]!;
        const rcv = this.team[1 - e.team]!;
        srv.doubleFaults++;
        srv.serves++;
        rcv.points++;
      }
    }
    this.duration = sim.time;
    // Time in the rallies (at the net or not) and running, from where the players stand frame to frame.
    const dt = this.lastT < 0 ? 0 : sim.time - this.lastT;
    const rally = sim.phase === PH_RALLY && dt > 0 && dt < 0.25;
    for (let i = 0; i < sim.players.length && i < 4; i++) {
      const p = sim.players[i]!, t = this.team[p.team]!;
      if (rally) {
        t.rallySecs += dt;
        if (Math.abs(p.pos.z) < NET_ZONE) t.netSecs += dt;
        t.run += Math.hypot(p.pos.x - this.lastX[i]!, p.pos.z - this.lastZ[i]!);
      }
      this.lastX[i] = p.pos.x;
      this.lastZ[i] = p.pos.z;
    }
    this.lastT = sim.time;
  }

  /** A first serve still open is settled: `inPlay` (something else happened first) or a fault. */
  private closeFirst(inPlay: boolean): void {
    if (this.firstOpen < 0) return;
    if (inPlay) this.team[this.firstOpen]!.firstsIn++;
    this.firstOpen = -1;
  }
}
