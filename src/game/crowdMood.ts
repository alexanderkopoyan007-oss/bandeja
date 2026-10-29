// What the stadium's crowd is doing, read from the match's events (render only): quiet through a point, applause
// after it (more for a long rally, a winning smash or víbora, a ball played out of the court), on its feet for the
// biggest moments and a set or the match. The same judgement as the crowd's sound (audio/soundscape.ts pointEnds).
import { E_HIT, E_POINT, E_SET, E_MATCH, type MatchSim } from '../sim/match.ts';
import { SHOT_SMASH, SHOT_VIBORA } from '../sim/contact/shots.ts';
import { WHY_DOUBLE_BOUNCE, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP } from '../sim/rules/rally.ts';

/** How long the applause and the standing last (seconds, to 1/e): the applause sound runs about 4.5 s. */
const CLAP_TIME = 2.6;
const STAND_TIME = 1.8;

export class CrowdMood {
  /** Share of the crowd clapping (0..1). */
  applause = 0;
  /** Share of the crowd on its feet, as a fraction of those who would stand (0..1). */
  ovation = 0;
  private seen = 0;
  private lastShot = -1;
  private lastHitter = -1;

  update(sim: MatchSim, dt: number): void {
    this.applause *= Math.exp(-dt / CLAP_TIME);
    this.ovation *= Math.exp(-dt / STAND_TIME);
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      if (e.kind === E_HIT) {
        this.lastShot = e.a;
        this.lastHitter = e.team;
      } else if (e.kind === E_POINT) {
        const shots = sim.rally.shots;
        const why = e.a;
        const winnerHit = this.lastHitter === e.team;
        if (why === WHY_EXIT_AFTER_BOUNCE) this.react(1, 0.9);
        else if ((why === WHY_DOUBLE_BOUNCE || why === WHY_HIT_BODY_OPP) && winnerHit && (this.lastShot === SHOT_SMASH || this.lastShot === SHOT_VIBORA)) this.react(0.9, 0.35);
        else if (shots >= 12) this.react(0.75 + 0.25 * Math.min(1, (shots - 12) / 15), winnerHit && shots >= 20 ? 0.6 : 0);
        else this.react(0.25 + 0.35 * Math.min(1, shots / 12), 0);
      } else if (e.kind === E_SET || e.kind === E_MATCH) {
        this.react(1, 1);
      }
    }
  }

  private react(clap: number, stand: number): void {
    this.applause = Math.max(this.applause, clap);
    this.ovation = Math.max(this.ovation, stand);
  }
}
