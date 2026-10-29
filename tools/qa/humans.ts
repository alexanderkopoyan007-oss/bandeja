// Human players for the QA army: inputs written into the frame a human's keyboard would produce, so the human code
// paths (charging, aim steering, assisted positioning and timing, the serve toss) are played thousands of times.
//
// BotHuman plays the way a decent player uses the controls: presses a shot key some time before the cue's moment,
// sometimes steers the aim or holds power/precision, releases on the cue (sim.focusIdeal) with a human spread.
// MonkeyHuman presses, holds and releases anything at random, several events in a tick, with timestamps up to
// two frames old (the game hands a tick every key event stamped before its end, so late frames deliver old stamps).
import type { MatchSim } from '../../src/sim/match.ts';
import {
  InputFrame, BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP, BTN_POWER, BTN_PRECISION, BTN_OVERHEAD, BTN_VOLLEY,
} from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { offGlassHigh, BAJADA_ABOVE, BAJADA_DEPTH } from '../../src/sim/player/positioning.ts';
import { mulberry } from './config.ts';

export interface Driver {
  act(sim: MatchSim, f: InputFrame): void;
}

const PH_SETUP = 0;
const PH_TOSS = 1;
const PH_RALLY = 2;

function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export class BotHuman implements Driver {
  private readonly r: () => number;
  /** Shot button being held (0: none), the modifier held with it, and when to let go (-1: follow the cue). */
  private key = 0;
  private mod = 0;
  private noise = 0;
  private pressedAt = 0;
  private steerX = 0;
  private steerY = 0;
  readonly i: number;
  /** Follow the HUD's hints that change the key (the bajada); off for the QA army, whose bots predate them. */
  readonly hints: boolean;
  constructor(i: number, seed: number, hints = false) {
    this.i = i;
    this.r = mulberry(seed);
    this.hints = hints;
  }

  act(sim: MatchSim, f: InputFrame): void {
    f.clear();
    const i = this.i;
    const t = sim.time;
    const p = sim.players[i]!;
    const r = this.r;
    let held = this.key | this.mod;
    const serving = sim.score.serverPlayer() === i && sim.rally.hitter < 0;
    if (this.key === 0) {
      if (sim.phase === PH_SETUP && serving && t >= sim.phaseUntil + 0.2 * r()) {
        this.press(f, [BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE][Math.floor(3 * r())]!, t + r() * DT);
        this.noise = gauss(r) * 0.035;
      } else if (sim.phase === PH_RALLY && sim.rally.hitter >= 0 && sim.rally.hitter !== p.team) {
        const ideal = sim.focusIdeal(i);
        const lead = 0.35 + 0.45 * r();
        if (ideal >= 0 && ideal - t < lead && ideal - t > 0.05) {
          const st = sim.stand[i]!;
          let key: number;
          // (hints: a player reading the HUD takes a ball coming off the glass high as a bajada)
          if (st.valid && (st.by > 1.9 || (this.hints && offGlassHigh(sim.pred, sim.side(p.team), t, p.tune.overheadHeight + BAJADA_ABOVE, BAJADA_DEPTH, sim.world.court.halfL) >= 0))) key = BTN_OVERHEAD;
          else if (st.valid && st.volley && r() < 0.5) key = BTN_VOLLEY;
          else key = [BTN_DRIVE, BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_SLICE, BTN_LOB, BTN_DROP][Math.floor(7 * r())]!;
          this.press(f, key, t + r() * DT);
          this.noise = gauss(r) * 0.045;
          const m = r();
          if (m < 0.15) this.modPress(f, BTN_POWER, t + r() * DT);
          else if (m < 0.25) this.modPress(f, BTN_PRECISION, t + r() * DT);
          this.steerX = r() < 0.5 ? 0 : (r() - 0.5) * 2;
          this.steerY = r() < 0.6 ? 0 : (r() - 0.5) * 2;
        }
      }
      held = this.key | this.mod;
    } else {
      // Holding: steer the aim, then let go on the cue's moment (plus a human spread).
      f.moveX = this.steerX;
      f.moveY = this.steerY;
      const toss = sim.phase === PH_TOSS && serving;
      const ideal = toss ? sim.tossIdeal : sim.phase === PH_RALLY ? sim.focusIdeal(i) : -1;
      const giveUp = ideal < 0 && t - this.pressedAt > 1.2;
      const at = ideal + this.noise;
      if (giveUp || sim.phase > PH_RALLY || (ideal >= 0 && at < t + DT)) {
        const rt = Math.max(t, Math.min(t + DT * 0.999, at));
        f.push(false, this.key, rt);
        if (this.mod) f.push(false, this.mod, rt);
        this.key = 0;
        this.mod = 0;
        held = 0;
      }
    }
    f.held = held;
  }

  private press(f: InputFrame, key: number, t: number): void {
    f.push(true, key, t);
    this.key = key;
    this.pressedAt = t;
  }

  private modPress(f: InputFrame, key: number, t: number): void {
    f.push(true, key, t);
    this.mod = key;
  }
}

const ALL = [BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP, BTN_POWER, BTN_PRECISION, BTN_OVERHEAD, BTN_VOLLEY];

export class MonkeyHuman implements Driver {
  private readonly r: () => number;
  private held = 0;
  private mx = 0;
  private my = 0;
  private aim = false;
  private ax = 0;
  private az = 0;
  /** How busy this monkey is (presses a second): some mash, some barely touch the keys. */
  private readonly rate: number;
  readonly i: number;
  constructor(i: number, seed: number) {
    this.i = i;
    this.r = mulberry(seed);
    this.rate = 0.3 + 12 * this.r() * this.r();
  }

  act(sim: MatchSim, f: InputFrame): void {
    f.clear();
    const r = this.r;
    const t = sim.time;
    // Movement: a random walk with jumps to full deflection.
    if (r() < 0.05) { this.mx = Math.round((r() - 0.5) * 2); this.my = Math.round((r() - 0.5) * 2); }
    this.mx = Math.max(-1, Math.min(1, this.mx + (r() - 0.5) * 0.2));
    this.my = Math.max(-1, Math.min(1, this.my + (r() - 0.5) * 0.2));
    f.moveX = this.mx;
    f.moveY = this.my;
    if (r() < 0.01) { this.aim = !this.aim; this.ax = (r() - 0.5) * 30; this.az = (r() - 0.5) * 40; }
    if (this.aim) { f.aimAbs = true; f.aimTX = this.ax; f.aimTZ = this.az; }
    // Events: presses and releases, sometimes several in one tick, sometimes stamped up to two frames ago.
    const events = r() < this.rate * DT ? 1 + Math.floor(r() * r() * 4) : 0;
    let ts = r() < 0.15 ? t - r() * 0.033 : t + r() * DT * 0.5;
    for (let k = 0; k < events; k++) {
      const b = ALL[Math.floor(r() * ALL.length)]!;
      const press = (this.held & b) === 0 ? r() < 0.8 : r() < 0.2;
      if (press) this.held |= b;
      else this.held &= ~b;
      f.push(press, b, Math.max(0, ts));
      ts += r() * DT * 0.25;
    }
    // Long holds end some time.
    if (this.held && r() < 0.5 * DT) {
      for (const b of ALL) if (this.held & b) { f.push(false, b, Math.max(0, t + r() * DT * 0.9)); this.held &= ~b; }
    }
    f.held = this.held;
  }
}
