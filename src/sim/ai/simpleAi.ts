// M1 opponent: reads the predicted ball path after a human-like reaction delay, runs to a hitting spot,
// presses and releases the swing with timing noise, and picks shots and targets with simple tactics.
// It plays through the same InputFrame path as a human, so it obeys the same physics and timing rules.
import type { MatchSim } from '../match.ts';
import { InputFrame, SHOT_BUTTONS } from '../input.ts';
import { abs, clamp, max, min, sqrt } from '../core/smath.ts';
import { heightCost, findWindows, makeWindows } from '../contact/windows.ts';
import { SW_IDLE, SW_CHARGE } from '../player/player.ts';
import { SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP } from '../contact/shots.ts';

const PH_SETUP = 0;
const PH_TOSS = 1;
const PH_RALLY = 2;

export class SimpleAi {
  readonly team: number;
  readonly level: number;
  planVersion = -1;
  reactAt = 0;
  standX = 0;
  standZ = 0;
  idealT = 0;
  releaseAt = 0;
  shot = SHOT_DRIVE;
  targetX = 0;
  targetZ = 0;
  planned = false;
  pressed = false;
  released = false;
  servePressAt = -1;
  /** Timing error for the current plan (drawn once, like a human's misjudgement). */
  noise = 0;
  private readonly wins = makeWindows();

  constructor(team: number, level: number) {
    this.team = team;
    this.level = clamp(level, 0, 1);
  }

  reset(): void {
    this.planVersion = -1;
    this.planned = false;
    this.pressed = false;
    this.released = false;
    this.servePressAt = -1;
  }

  /** Reaction time after the opponent strikes, by level (seconds). */
  private reaction(): number {
    return 0.3 - 0.17 * this.level;
  }

  /** Standard deviation of the release timing error (seconds). */
  private timingSigma(): number {
    return 0.07 - 0.052 * this.level;
  }

  onStrike(m: MatchSim, striker: number): void {
    if (striker === this.team) {
      this.planned = false;
      this.pressed = false;
      this.released = false;
      return;
    }
    this.reactAt = m.time + this.reaction() * (0.8 + 0.4 * m.aiRng.next());
    this.planVersion = -1;
    this.planned = false;
    this.pressed = false;
    this.released = false;
  }

  think(m: MatchSim, f: InputFrame, t0: number, t1: number): void {
    const p = m.players[this.team]!;
    const s = m.side(this.team);
    const rng = m.aiRng;
    const serving = m.score.serverTeam() === this.team;

    if (m.phase === PH_SETUP) {
      if (!serving) return;
      if (this.servePressAt < 0) {
        this.servePressAt = t0 + 0.7 + 0.7 * rng.next();
        const r = rng.next();
        this.shot = r < 0.6 ? SHOT_SLICE : r < 0.85 ? SHOT_DRIVE : SHOT_TOPSPIN;
        const b = m.box;
        const wide = rng.next();
        // Aim at the T, the body or wide, with a safety margin from the lines.
        const tx = wide < 0.4 ? (abs(b.x0) < abs(b.x1) ? b.x0 + 0.5 : b.x1 - 0.5) : wide < 0.7 ? (b.x0 + b.x1) * 0.5 : abs(b.x0) < abs(b.x1) ? b.x1 - 0.6 : b.x0 + 0.6;
        this.targetX = tx;
        this.targetZ = -s * (5.2 + 1.0 * rng.next());
      }
      if (!this.pressed && t1 > this.servePressAt && t0 >= m.phaseUntil) {
        f.push(true, SHOT_BUTTONS[this.shot]!, max(t0, this.servePressAt));
        this.pressed = true;
        this.released = false;
      }
      return;
    }

    if (m.phase === PH_TOSS) {
      if (serving && this.pressed && !this.released) {
        if (this.releaseAt <= 0 || this.releaseAt < m.tossIdeal - 1) {
          this.releaseAt = m.tossIdeal + rng.normal() * this.timingSigma() * 0.7;
        }
        if (t1 > this.releaseAt) {
          this.aimAbs(f);
          f.push(false, SHOT_BUTTONS[this.shot]!, max(t0, this.releaseAt));
          this.released = true;
          this.releaseAt = 0;
        }
      }
      return;
    }

    if (m.phase !== PH_RALLY) {
      this.drift(f, p.pos.x, p.pos.z, p.pos.x, p.pos.z, s);
      return;
    }

    const coming = m.rally.hitter !== this.team && m.rally.hitter >= 0;
    if (!coming) {
      // Recover to a base position: deep and covering the angle.
      const bx = m.ball.pos.x;
      const nearNet = abs(p.lastContact.z) < 5 && m.time - p.lastContactTime < 3 && abs(p.pos.z) < 6;
      const baseZ = s * (nearNet ? 3.2 : 7.6);
      this.drift(f, p.pos.x, p.pos.z, clamp(bx * 0.35, -2.5, 2.5), baseZ, s);
      return;
    }

    if (t0 >= this.reactAt && m.pred.version !== this.planVersion) this.plan(m);
    if (this.planned) {
      this.drift(f, p.pos.x, p.pos.z, this.standX, this.standZ, s);
      if (!this.pressed && p.swing === SW_IDLE && t0 >= this.idealT - 0.45) {
        f.push(true, SHOT_BUTTONS[this.shot]!, t0);
        this.pressed = true;
      }
      if (this.pressed && !this.released && p.swing === SW_CHARGE) this.trackRelease(m, s);
      if (this.pressed && !this.released && p.swing === SW_CHARGE && t1 > this.releaseAt) {
        this.aimAbs(f);
        // Release the button that is actually held (the plan may have been revised since the press).
        f.push(false, SHOT_BUTTONS[p.shot]!, max(t0, this.releaseAt));
        this.released = true;
      }
    } else {
      this.drift(f, p.pos.x, p.pos.z, p.pos.x, p.pos.z, s);
    }
  }

  /** Watch the ball come in from where we actually are, and time the release off that window. */
  private trackRelease(m: MatchSim, s: number): void {
    const p = m.players[this.team]!;
    const n = findWindows(m.pred, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, m.time - 0.3, false);
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (best < 0 || abs(this.wins[i]!.ideal - this.idealT) < abs(this.wins[best]!.ideal - this.idealT)) best = i;
    }
    if (best >= 0) this.releaseAt = this.wins[best]!.ideal + this.noise;
  }

  private aimAbs(f: InputFrame): void {
    f.aimAbs = true;
    f.aimTX = this.targetX;
    f.aimTZ = this.targetZ;
  }

  /** Steer towards (x, z), braking so we arrive without overshooting. */
  private drift(f: InputFrame, px: number, pz: number, x: number, z: number, s: number): void {
    const dx = x - px;
    const dz = z - pz;
    const d = sqrt(dx * dx + dz * dz);
    if (d < 0.06) return;
    const want = min(5.6, sqrt(2 * 11 * d)) / 5.6;
    const wx = (dx / d) * want;
    const wz = (dz / d) * want;
    f.moveX = wx * s;
    f.moveY = -wz * s;
  }

  private plan(m: MatchSim): void {
    const pr = m.pred;
    const p = m.players[this.team]!;
    const s = m.side(this.team);
    const t = p.tune;
    const rng = m.aiRng;
    this.planVersion = pr.version;
    const now = m.time;
    const mustBounce = m.rally.isServe;
    let best = -1;
    let bestCost = 1e9;
    let bestSlack = -1e9;
    let fallback = -1;
    let bx = 0;
    let bz = 0;
    let fbx = 0;
    let fbz = 0;
    for (let i = 0; i < pr.n; i++) {
      const ti = pr.t[i]!;
      if (ti < now + 0.12) continue;
      const x = pr.x[i]!;
      const y = pr.y[i]!;
      const z = pr.z[i]!;
      const b = pr.bounces[i]!;
      if (z * s < 0.3 || b > 1 || (mustBounce && b === 0) || y < 0.3 || y > 2.6) continue;
      // Forehand if it is reachable that way, else backhand.
      const fhX = x - s * t.reachComfort;
      const bhX = x + s * t.reachComfort;
      const sx = clamp(abs(fhX - p.pos.x) <= abs(bhX - p.pos.x) + 0.6 ? fhX : bhX, p.minX, p.maxX);
      const sz = clamp(z + s * 0.12, p.minZ, p.maxZ);
      const dist = sqrt((sx - p.pos.x) ** 2 + (sz - p.pos.z) ** 2);
      const need = dist / t.maxSpeed + (dist > 0.4 ? 0.35 : 0.1);
      const slack = ti - now - need;
      if (slack >= 0) {
        const deep = abs(z) > 8.3;
        const cost = heightCost(y, t.overheadHeight) - (pr.walls[i]! > 0 && deep ? 0.3 : 0) + 0.04 * (ti - now)
          + (b === 0 && abs(p.pos.z) > 6 ? 0.6 : 0);
        if (cost < bestCost) { bestCost = cost; best = i; bx = sx; bz = sz; }
      } else if (slack > bestSlack) {
        bestSlack = slack;
        fallback = i;
        fbx = sx;
        fbz = sz;
      }
    }
    if (best < 0 && fallback < 0) { this.planned = false; return; }
    const i = best >= 0 ? best : fallback;
    this.standX = best >= 0 ? bx : fbx;
    this.standZ = best >= 0 ? bz : fbz;
    this.idealT = pr.t[i]!;
    this.noise = rng.normal() * this.timingSigma();
    this.releaseAt = this.idealT + this.noise;
    this.planned = true;
    this.pressed = p.swing !== SW_IDLE;
    this.released = false;
    if (this.pressed) this.retarget(m);
    else this.chooseShot(m, pr.y[i]!, pr.bounces[i]! === 0, abs(this.standZ));
  }

  /** Already swinging: keep the shot, refresh the target only. */
  private retarget(m: MatchSim): void {
    this.shot = m.players[this.team]!.shot;
    this.chooseTarget(m);
  }

  private chooseShot(m: MatchSim, height: number, volley: boolean, depth: number): void {
    const opp = m.players[1 - this.team]!;
    const r = m.aiRng.next();
    if (height >= 1.85 && depth < 7) {
      this.shot = r < 0.65 ? SHOT_DRIVE : SHOT_SLICE; // becomes smash / bandeja
    } else if (volley) {
      this.shot = abs(opp.pos.z) > 8 && r < 0.15 ? SHOT_DROP : r < 0.6 ? SHOT_SLICE : SHOT_DRIVE;
    } else if (depth > 8) {
      this.shot = r < 0.25 ? SHOT_LOB : r < 0.6 ? SHOT_DRIVE : r < 0.85 ? SHOT_SLICE : SHOT_TOPSPIN;
    } else {
      this.shot = r < 0.4 ? SHOT_DRIVE : r < 0.7 ? SHOT_TOPSPIN : r < 0.92 ? SHOT_SLICE : SHOT_LOB;
    }
    if (abs(opp.pos.z) < 4 && r < 0.35) this.shot = SHOT_LOB; // opponent at the net: lob them
    this.chooseTarget(m);
  }

  /** Target: away from the opponent, with margins that shrink as the AI gets better. */
  private chooseTarget(m: MatchSim): void {
    const rng = m.aiRng;
    const c = m.world.court;
    const s = m.side(this.team);
    const opp = m.players[1 - this.team]!;
    const margin = 1.3 - 0.5 * this.level;
    const side = opp.pos.x > 0 ? -1 : 1;
    const spread = c.halfW - margin;
    this.targetX = clamp(side * spread * (0.35 + 0.65 * rng.next()) + rng.normal() * 0.6, -spread, spread);
    let depthT = this.shot === SHOT_LOB ? 8.6 : this.shot === SHOT_DROP ? 1.8 : 6.6 + 1.2 * rng.next();
    if (this.shot === SHOT_LOB) depthT = min(depthT, c.halfL - 1.0 - 0.6 * (1 - this.level));
    this.targetZ = -s * depthT;
  }
}
