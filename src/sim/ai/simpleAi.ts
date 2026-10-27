// AI player: reads the predicted ball path after a human-like reaction delay, runs to a hitting spot,
// presses and releases the swing with timing noise, and picks shots and targets with simple tactics.
// It plays through the same InputFrame path as a human, so it obeys the same physics and timing rules.
// In doubles it only goes for balls the match assigns to it (MatchSim.taker); otherwise it plays in
// formation with its partner: both at the net or both back, each covering a lane, shifted to the ball.
import type { MatchSim } from '../match.ts';
import { InputFrame, SHOT_BUTTONS, BTN_OVERHEAD, BTN_POWER, BTN_PRECISION } from '../input.ts';
import { abs, clamp, max, min, sqrt } from '../core/smath.ts';
import { DT } from '../core/constants.ts';
import { PF_FLOOR } from '../ball/predict.ts';
import { findWindows, makeWindows } from '../contact/windows.ts';
import { makeStandPlan, planStand, type StandPlan } from '../player/positioning.ts';
import { formationSpot, type Spot } from '../player/formation.ts';
import { styleOf, type AiStyle } from './styles.ts';
import { SW_IDLE, SW_CHARGE, type Player } from '../player/player.ts';
import { SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_BANDEJA } from '../contact/shots.ts';

const PH_SETUP = 0;
const PH_TOSS = 1;
const PH_RALLY = 2;

/** Formation depths (m from the net): at the net, and back by the glass. */

export class SimpleAi {
  /** Player number (team + 2 * slot). */
  readonly index: number;
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
  /** The current plan takes a lob in the air (overhead key), and hits it as a smash (power held). */
  overhead = false;
  smash = false;
  /** The overhead is a víbora (precision held at release). */
  vibora = false;
  /** The topspin is a chiquita (precision held at release). */
  chiquita = false;
  private readonly wins = makeWindows();
  private readonly st = makeStandPlan();
  /** The contact this AI is set up for (the renderer times the swing to it). */
  get standPlan(): Readonly<StandPlan> {
    return this.st;
  }
  private readonly spot: Spot = { x: 0, z: 0 };

  readonly style: AiStyle;

  constructor(index: number, level: number, style: AiStyle = styleOf(undefined)) {
    this.index = index;
    this.team = index & 1;
    this.style = style;
    this.level = clamp(level + style.level, 0, 1);
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

  /** One tick's input. Times are read here, not passed in: doubles passed to a call V8 doesn't inline are boxed. */
  think(m: MatchSim, f: InputFrame): void {
    const t0 = m.time;
    const t1 = t0 + DT;
    this.nowT = t0;
    const p = m.players[this.index]!;
    const s = m.side(this.team);
    const rng = m.aiRng;
    const serving = m.score.serverPlayer() === this.index;

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
      this.goX = p.pos.x;
      this.goZ = p.pos.z;
      this.drift(f, p, s);
      return;
    }

    const coming = m.rally.hitter !== this.team && m.rally.hitter >= 0;
    if (m.doubles) {
      if (!coming || m.taker[this.team] !== this.index) {
        // Not our ball (or it is going away): stand down and take up the formation.
        this.planned = false;
        this.pressed = false;
        this.released = false;
        this.planVersion = -1;
        this.formation(m, f, p, s, coming);
        return;
      }
    } else if (!coming) {
      // Recover to a base position: deep and covering the angle.
      const bx = m.ball.pos.x;
      const nearNet = abs(p.lastContact.z) < 5 && m.time - p.lastContactTime < 3 && abs(p.pos.z) < 6;
      const baseZ = s * (nearNet ? 3.2 : 7.6);
      this.goX = clamp(bx * 0.35, -2.5, 2.5);
      this.goZ = baseZ;
      this.drift(f, p, s);
      return;
    }

    if (t0 >= this.reactAt && m.pred.version !== this.planVersion) this.plan(m);
    if (this.planned) {
      this.goX = this.standX;
      this.goZ = this.standZ;
      // Be there, feet set, a little before the contact.
      this.goBy = this.idealT - 0.15;
      this.chasing = true;
      this.drift(f, p, s);
      if (!this.pressed && p.swing === SW_IDLE && t0 >= this.idealT - 0.45) {
        f.push(true, button(this.shot), t0);
        this.pressed = true;
      }
      if (this.pressed && !this.released && p.swing === SW_CHARGE) this.trackRelease(m, s);
      if (this.pressed && !this.released && p.swing === SW_CHARGE && t1 > this.releaseAt) {
        this.aimAbs(f);
        if (p.shot === SHOT_BANDEJA && this.smash) f.held |= BTN_POWER;
        else if (p.shot === SHOT_BANDEJA && this.vibora) f.held |= BTN_PRECISION;
        else if (p.shot === SHOT_TOPSPIN && this.chiquita) f.held |= BTN_PRECISION;
        // Release the button that is actually held (the plan may have been revised since the press).
        f.push(false, button(p.shot), max(t0, this.releaseAt));
        this.released = true;
      }
    } else {
      this.goX = p.pos.x;
      this.goZ = p.pos.z;
      this.drift(f, p, s);
    }
  }

  /** Doubles: take up the pair's formation (shared with the human's positioning assist). */
  private formation(m: MatchSim, f: InputFrame, p: Player, s: number, coming: boolean): void {
    formationSpot(m, this.index, coming, this.spot);
    this.goX = this.spot.x;
    this.goZ = this.spot.z;
    // In place by the next strike (about when the ball has bounced on its way to whoever plays it).
    const pr = m.pred;
    let by = m.time + 1;
    for (let i = 0; i < pr.n; i++) {
      if ((pr.flags[i]! & PF_FLOOR) !== 0) { by = pr.t[i]! + 0.25; break; }
    }
    this.goBy = by > m.time + 0.4 ? by : m.time + 0.4;
    this.drift(f, p, s);
  }

  /** Watch the ball come in from where we actually are, and time the release off that window. */
  private trackRelease(m: MatchSim, s: number): void {
    const p = m.players[this.index]!;
    const n = findWindows(m.pred, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, m.time - 0.3, p.shot === SHOT_BANDEJA);
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (best < 0 || abs(this.wins[i]!.ideal - this.idealT) < abs(this.wins[best]!.ideal - this.idealT)) best = i;
    }
    if (best < 0) return;
    const ideal = this.wins[best]!.ideal;
    this.releaseAt = ideal + this.noise;
    // Nobody waits for a ball to reach their chest: a late swing at a ball coming at the body still goes in time.
    const k = m.bodyHitIdx(this.index, s);
    const hit = k >= 0 ? m.pred.t[k]! : -1;
    if (hit >= 0) this.releaseAt = min(this.releaseAt, min(ideal + 0.04, hit - 0.03));
  }

  private aimAbs(f: InputFrame): void {
    f.aimAbs = true;
    f.aimTX = this.targetX;
    f.aimTZ = this.targetZ;
  }

  /** Where drift steers to, and by when (goBy 0: no hurry). Fields, not arguments: see think. */
  private goX = 0;
  private goZ = 0;
  private goBy = 0;
  /** Going for the ball (not just taking up a position). */
  private chasing = false;
  /** The tick's start time (a field: a double argument would be boxed). */
  private nowT = 0;

  /**
   * Steer towards (goX, goZ) and arrive without overshooting: flat out for the ball, brisk into the formation,
   * and no shuffling for a few centimetres (real players then stand: most of a match is spent below 6 km/h).
   */
  private drift(f: InputFrame, p: Player, s: number): void {
    const now = this.nowT;
    const dx = this.goX - p.pos.x;
    const dz = this.goZ - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    const by = this.goBy;
    const chase = this.chasing;
    this.goBy = 0;
    this.chasing = false;
    const left = by > 0 ? by - now : 1e9;
    if (d < (left < 0.6 ? 0.04 : 0.12)) return;
    const t = p.tune;
    p.qx = dx / d;
    p.qz = dz / d;
    p.look();
    const lx = p.qx;
    const lz = p.qz;
    p.qx = dx / d;
    p.qz = dz / d;
    p.topToward(lx, lz);
    const top = p.qTop;
    // Going for the ball: flat out. Taking up a position: brisk (being in place before the next strike is what
    // reaches balls; a relaxed 2.6 m/s left a tenth more of them unreached), faster if the time left asks.
    const need = left < 1e8 ? (d / (left > 0.08 ? left : 0.08)) * 1.35 : 0;
    const brisk = 4.5;
    let v = chase ? top : need > brisk ? need : brisk;
    if (v > top) v = top;
    const stop = sqrt(2 * t.brake * 0.8 * d);
    if (v > stop) v = stop;
    const want = v / top;
    f.moveX = (dx / d) * want * s;
    f.moveY = -(dz / d) * want * s;
  }

  /**
   * Pick the contact with the same planner the human's assist uses (positioning.planStand): reachable in time,
   * a comfortable height, deep balls played off the glass, and never a spot the ball flies through on its
   * way (it would hit us first). The planned contact is kept unless a clearly better one appears.
   */
  private plan(m: MatchSim): void {
    const pr = m.pred;
    const p = m.players[this.index]!;
    const s = m.side(this.team);
    const rng = m.aiRng;
    this.planVersion = pr.version;
    const now = m.time;
    const keep = this.planned && this.idealT > now ? this.idealT : -1;
    const close = keep >= 0 && keep - now < 0.35;
    const st = this.st;
    // A lob while we are up: take it in the air (bandeja or smash) and keep the net, unless it is too deep.
    // Already holding the overhead key, stay with it.
    let overhead = p.swing === SW_CHARGE ? p.shot === SHOT_BANDEJA : abs(p.pos.z) < 6.5 && this.lobComing(m, s);
    if (overhead) {
      const ok = (close && this.overhead && planStand(pr, p, s, now, m.rally.isServe, st, keep, true, true))
        || planStand(pr, p, s, now, m.rally.isServe, st, this.overhead ? keep : -1, false, true);
      overhead = ok && (st.inTime || p.swing === SW_CHARGE) && abs(st.z) < 8.2;
    }
    if (!overhead) {
      const k = this.overhead ? -1 : keep;
      if (!(close && k >= 0 && planStand(pr, p, s, now, m.rally.isServe, st, k, true, false))) {
        if (!planStand(pr, p, s, now, m.rally.isServe, st, k, false, false)) { this.planned = false; return; }
      }
    }
    this.overhead = overhead;
    let sx = st.x;
    let sz = st.z;
    let t = st.t;
    let height = st.by;
    let volley = st.volley;
    const kHit = overhead ? -1 : m.bodyHitIdx(this.index, s);
    const hit = kHit >= 0 ? pr.t[kHit]! : -1;
    if ((!st.inTime || (hit >= 0 && hit < st.t + 0.09)) && !overhead) {
      // No comfortable contact in time, or the ball comes at us before the planned one (a fast ball at the
      // body, typically at the net): block it from where we stand, at the first moment it is in reach, rather
      // than be hit while running to a spot we can't make.
      const n = findWindows(pr, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, now, false);
      if (n > 0 && this.wins[0]!.ideal < st.t + 0.09) {
        const w = this.wins[0]!;
        sx = p.pos.x;
        sz = p.pos.z;
        // The window's ideal can sit a hair before the ball reaches us; aim the block early enough that a late
        // release is still a (bad) block, not a ball in the chest.
        t = hit >= 0 ? max(w.start, min(w.ideal, hit - 0.09)) : w.ideal;
        height = w.height;
        volley = w.volley;
      }
    }
    const changed = !this.planned || abs(t - this.idealT) > 0.15;
    this.standX = sx;
    this.standZ = sz;
    this.idealT = t;
    if (changed) this.noise = rng.normal() * this.timingSigma() * this.difficulty(m, height, st.afterWall);
    this.releaseAt = this.idealT + this.noise;
    this.planned = true;
    this.pressed = p.swing !== SW_IDLE;
    this.released = false;
    if (this.pressed) this.retarget(m);
    else if (overhead) this.chooseOverhead(m, height, abs(sz));
    else this.chooseShot(m, height, volley, abs(sz));
  }

  /**
   * How much harder than a routine ball this one is to time (multiplies the timing spread): pace, a ball
   * coming off the glass, a low ball. Hitting hard is how you force errors.
   */
  private difficulty(m: MatchSim, height: number, afterWall: boolean): number {
    const v = m.ball.vel;
    const speed = sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return 1 + 0.55 * clamp((speed - 12) / 14, 0, 1.6) + (afterWall ? 0.3 : 0) + (height < 0.5 ? 0.3 : 0);
  }

  /** The predicted path climbs well above head height over our half before it bounces: a lob. */
  private lobComing(m: MatchSim, s: number): boolean {
    const pr = m.pred;
    for (let i = 0; i < pr.n && pr.bounces[i]! === m.rally.bounces && pr.bounces[i]! === 0; i++) {
      if (pr.z[i]! * s > 1.5 && pr.y[i]! > 2.3) return true;
    }
    return false;
  }

  /**
   * Overhead: a bandeja deep into a corner to keep the net, or, from close in with the ball high (a short lob),
   * a smash; better players take the smash more often.
   */
  private chooseOverhead(m: MatchSim, height: number, depth: number): void {
    const r = m.aiRng.next();
    this.shot = SHOT_BANDEJA;
    const st = this.style;
    this.smash = (depth < 6 && height > 2.2 && r < (0.3 + 0.45 * this.level) * st.smash) || (depth < 4.5 && r < min(0.95, 0.8 * st.smash));
    // Not a smash: the better players turn some into víboras (into the side glass, more pace than a bandeja).
    this.vibora = !this.smash && depth < 7 && m.aiRng.next() < (0.15 + 0.35 * this.level) * st.vibora;
    if (m.doubles) m.intentUp[this.team] = 1; // keep the net
    this.chooseTarget(m);
  }

  /** Already swinging: keep the shot, refresh the target only. */
  private retarget(m: MatchSim): void {
    this.shot = m.players[this.index]!.shot;
    this.chooseTarget(m);
  }

  private chooseShot(m: MatchSim, height: number, volley: boolean, depth: number): void {
    const opp = this.nearestOpponent(m);
    const r = m.aiRng.next();
    this.smash = false;
    this.vibora = false;
    this.chiquita = false;
    if (m.doubles) {
      this.chooseDoublesShot(m, r, height, volley, depth);
      this.chooseTarget(m);
      return;
    }
    const st = this.style;
    const lob = min(0.9, 0.25 * st.lob);
    if (height >= 1.85 && depth < 7) {
      this.shot = r < 0.65 ? SHOT_DRIVE : SHOT_SLICE; // becomes smash / bandeja
    } else if (volley) {
      this.shot = abs(opp.pos.z) > 8 && r < 0.15 * st.drop ? SHOT_DROP : r < 0.6 ? SHOT_SLICE : SHOT_DRIVE;
    } else if (depth > 8) {
      this.shot = r < lob ? SHOT_LOB : r < lob + 0.35 ? SHOT_DRIVE : r < lob + 0.6 ? SHOT_SLICE : SHOT_TOPSPIN;
    } else {
      this.shot = r < 0.4 ? SHOT_DRIVE : r < 0.7 ? SHOT_TOPSPIN : r < 1 - 0.08 * st.lob ? SHOT_SLICE : SHOT_LOB;
    }
    // Opponent at the net: lob them, or from the back dip it at their feet.
    if (abs(opp.pos.z) < 4 && r < min(0.9, 0.35 * st.lob)) this.shot = SHOT_LOB;
    else if (abs(opp.pos.z) < 4 && depth > 6 && !volley && height > 0.4 && height < 1.4 && m.aiRng.next() < 0.3 * st.drop) {
      this.shot = SHOT_TOPSPIN;
      this.chiquita = true;
    }
    this.chooseTarget(m);
  }

  /**
   * Doubles: against a pair at the net, lob them or keep it low at their feet; against a pair at the back,
   * drive and slice through the middle (a lob there only hands them a smash). At the net ourselves, volley.
   */
  private chooseDoublesShot(m: MatchSim, r: number, height: number, volley: boolean, depth: number): void {
    const up = this.opponentsUp(m);
    const st = this.style;
    // Second draw for the pair's move after the shot.
    const r2 = m.aiRng.next();
    let go = 0;
    if (height >= 1.85 && depth < 7) {
      this.shot = r < 0.6 ? SHOT_DRIVE : SHOT_SLICE; // a high ball in front: becomes a smash / bandeja
      go = 1;
    } else if (volley || depth < 5) {
      this.shot = up === 0 && r < 0.12 * st.drop ? SHOT_DROP : r < 0.65 ? SHOT_SLICE : SHOT_DRIVE;
      go = 1;
    } else if (up === 2) {
      // Lob them (and take the net if it gets past), dip a chiquita at their feet, or keep it low; from the
      // back that is a defensive shot.
      const lob = min(0.9, 0.5 * st.lob);
      const chiq = height > 0.4 && height < 1.4 ? min(0.6, 0.35 * st.drop) * (1 - lob) : 0;
      this.shot = r < lob ? SHOT_LOB : r < lob + chiq ? SHOT_TOPSPIN : r < lob + chiq + 0.6 * (1 - lob - chiq) ? SHOT_SLICE : SHOT_DRIVE;
      this.chiquita = this.shot === SHOT_TOPSPIN;
    } else if (up === 1) {
      const lob = min(0.9, 0.3 * st.lob);
      const chiq = height > 0.4 && height < 1.4 ? min(0.4, 0.15 * st.drop) * (1 - lob) : 0;
      this.shot = r < lob ? SHOT_LOB : r < lob + chiq ? SHOT_TOPSPIN : r < lob + chiq + 0.5 * (1 - lob - chiq) ? SHOT_DRIVE : SHOT_SLICE;
      this.chiquita = this.shot === SHOT_TOPSPIN;
    } else {
      // Both back: work the ball through the middle; a short ball is the chance to come in.
      const lob = min(0.5, 0.05 * st.lob);
      this.shot = r < lob ? SHOT_LOB : r < 0.5 ? SHOT_DRIVE : r < 0.75 ? SHOT_SLICE : SHOT_TOPSPIN;
      go = depth < 7.4 && r2 < 0.45 * st.net ? 1 : r2 < 0.12 * st.net ? 1 : 0;
    }
    m.intentUp[this.team] = go;
  }

  private nearestOpponent(m: MatchSim): Player {
    const o = 1 - this.team;
    if (!m.doubles) return m.players[o]!;
    const me = m.players[this.index]!;
    const a = m.players[o]!;
    const b = m.players[o + 2]!;
    const da = (a.pos.x - me.pos.x) ** 2 + (a.pos.z - me.pos.z) ** 2;
    const db = (b.pos.x - me.pos.x) ** 2 + (b.pos.z - me.pos.z) ** 2;
    return da <= db ? a : b;
  }

  /** How many opponents are at the net. */
  private opponentsUp(m: MatchSim): number {
    const o = 1 - this.team;
    let n = 0;
    for (let i = o; i < m.players.length; i += 2) if (abs(m.players[i]!.pos.z) < 5) n++;
    return n;
  }

  /** Target: away from the opponent, with margins that shrink as the AI gets better. */
  private chooseTarget(m: MatchSim): void {
    if (m.doubles) {
      this.chooseDoublesTarget(m);
      return;
    }
    const rng = m.aiRng;
    const c = m.world.court;
    const s = m.side(this.team);
    const opp = m.players[1 - this.team]!;
    const margin = (1.3 - 0.5 * this.level) * this.style.margin;
    const side = opp.pos.x > 0 ? -1 : 1;
    const spread = c.halfW - margin;
    this.targetX = clamp(side * spread * (0.35 + 0.65 * rng.next()) + rng.normal() * 0.6, -spread, spread);
    let depthT = this.shot === SHOT_LOB ? 8.6 : this.shot === SHOT_DROP ? 1.8 : 6.6 + 1.2 * rng.next();
    if (this.shot === SHOT_LOB) depthT = min(depthT, c.halfL - 1.0 - 0.6 * (1 - this.level));
    this.targetZ = -s * depthT;
  }

  /**
   * Doubles targets: a lob over a pair at the net to the side it is weaker on; down the middle between a pair
   * at the back (the classic "por el medio"); at the feet of the net player when one is up and one back.
   */
  private chooseDoublesTarget(m: MatchSim): void {
    const rng = m.aiRng;
    const c = m.world.court;
    const s = m.side(this.team);
    const o = 1 - this.team;
    const a = m.players[o]!;
    const b = m.players[o + 2]!;
    const margin = (1.2 - 0.5 * this.level) * this.style.margin;
    const spread = c.halfW - margin;
    const up = this.opponentsUp(m);
    let x: number;
    let depth: number;
    if (this.shot === SHOT_BANDEJA && this.vibora) {
      // Into the side glass, deep enough that it comes off low towards the back.
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.8 + 0.2 * rng.next());
      depth = 6.4 + 1.2 * rng.next();
    } else if (this.shot === SHOT_BANDEJA && this.smash) {
      // Flat and hard towards a side (it can kick off the side glass and out: por tres) or through the middle.
      x = rng.next() < 0.65 ? (rng.next() < 0.5 ? -1 : 1) * spread * (0.6 + 0.3 * rng.next()) : (a.pos.x + b.pos.x) * 0.5;
      depth = 4.6 + 1.6 * rng.next();
    } else if (this.shot === SHOT_BANDEJA) {
      // Deep into a corner, so the ball sits down off the back glass.
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.5 + 0.4 * rng.next());
      depth = 8.0 + 0.8 * rng.next();
    } else if (this.shot === SHOT_LOB) {
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.3 + 0.5 * rng.next());
      depth = min(8.6, c.halfL - 1.0 - 0.6 * (1 - this.level));
    } else if (this.shot === SHOT_DROP) {
      x = (a.pos.x + b.pos.x) * 0.5 + rng.normal() * 1.2;
      depth = 1.8;
    } else if (this.chiquita) {
      // Dipping at the feet of a net player, or between the two.
      const net = abs(a.pos.z) < abs(b.pos.z) ? a : b;
      x = rng.next() < 0.5 ? (a.pos.x + b.pos.x) * 0.5 : net.pos.x;
      depth = 2.8 + 0.8 * rng.next();
    } else if (up === 2) {
      // Both at the net: low through the middle or at a player's feet.
      const at = rng.next() < 0.5 ? a : b;
      x = rng.next() < 0.5 ? (a.pos.x + b.pos.x) * 0.5 : at.pos.x;
      depth = 4.2 + 1.0 * rng.next();
    } else if (up === 1) {
      const net = abs(a.pos.z) < 5 ? a : b;
      const back = net === a ? b : a;
      // At the net player's feet, or behind them into the back player's corner.
      if (rng.next() < 0.5) { x = net.pos.x; depth = 4.3 + 0.8 * rng.next(); }
      else { x = back.pos.x > 0 ? -spread * 0.7 : spread * 0.7; depth = 7.2 + 1.0 * rng.next(); }
    } else {
      x = (a.pos.x + b.pos.x) * 0.5 + rng.normal() * 0.7;
      depth = 6.6 + 1.3 * rng.next();
    }
    this.targetX = clamp(x + rng.normal() * (0.5 - 0.3 * this.level), -spread, spread);
    this.targetZ = -s * depth;
  }
}

/** The key that holds a shot: the overhead key for a bandeja/smash, else the shot's own key. */
function button(shot: number): number {
  return shot === SHOT_BANDEJA ? BTN_OVERHEAD : SHOT_BUTTONS[shot]!;
}
