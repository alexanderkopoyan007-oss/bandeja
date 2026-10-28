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
import { findWindows, makeWindows, OH_ANY, OH_BANDEJA, OH_SMASH, OH_VIBORA } from '../contact/windows.ts';
import { makeStandPlan, planStand, type StandPlan } from '../player/positioning.ts';
import { smashLanding } from '../contact/smashAim.ts';
import { formationSpot, type Spot } from '../player/formation.ts';
import { styleOf, type AiStyle } from './styles.ts';
import skillData from '../../../data/ai-skill.json' with { type: 'json' };

const SKILL = skillData as unknown as { timing: number[]; motor: number[]; pressure: number };
/** Linear between the level-0 and level-1 values. */
function byLevel(v: number[], level: number): number {
  return v[0]! + (v[1]! - v[0]!) * level;
}
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
  /** A volley played safe (precision held: more net clearance, less pace) or put away (power held). */
  safe = false;
  punch = false;
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
    this.ohKind = OH_ANY;
    this.planned = false;
    this.pressed = false;
    this.released = false;
    this.servePressAt = -1;
  }

  /**
   * Reaction time after the opponent strikes, by level (seconds), drawn 0.8-1.2x round it: 0.17 s at the top
   * (0.14-0.20 s: tennis pros commit to a direction 140-160 ms after the opponent's contact and start the racket
   * 187 +- 22 ms after it; Triolet et al. 2013, Mecheri et al. 2019), 0.3 s for a beginner. It was 0.13 s, faster
   * than any measured player: defenders blocked 150 km/h smashes on the rise from 8 m.
   */
  private reaction(): number {
    return 0.3 - 0.13 * this.level;
  }

  /** Standard deviation of the release timing error (seconds). */
  private timingSigma(): number {
    return byLevel(SKILL.timing, this.level);
  }

  /** Swing-to-swing spread at contact (ShotRequest.motor), growing with the ball's pressure. */
  motor(pressure: number): number {
    return byLevel(SKILL.motor, this.level) * (1 + SKILL.pressure * pressure);
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
    this.ohKind = OH_ANY;
    this.planned = false;
    this.pressed = false;
    this.released = false;
  }

  /** One tick's input. Times are read here, not passed in: doubles passed to a call V8 doesn't inline are boxed. */
  think(m: MatchSim, f: InputFrame): void {
    // Modifiers are held only on the tick they are released with (InputFrame.clear() leaves `held` alone: a
    // keyboard sets it each frame). Before this, a smash's power stayed held for every later shot of the match.
    f.held = 0;
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
        // A first serve goes for the lines and pace; a second serve is a safe slice with room to spare (pros fault
        // about 10% of first serves and 2% of second serves: Mellado-Arbelo et al. 2019).
        const second = m.serveNo === 2;
        this.shot = second ? (r < 0.85 ? SHOT_SLICE : SHOT_TOPSPIN) : r < 0.6 ? SHOT_SLICE : r < 0.85 ? SHOT_DRIVE : SHOT_TOPSPIN;
        const b = m.box;
        const wide = rng.next();
        // The box's outer side is the side wall: a wide serve that bounces short runs on into the side mesh (a fault
        // after the bounce), so wide serves go deep, onto the side glass. A second serve goes to the T or the body.
        const inner = abs(b.x0) < abs(b.x1) ? b.x0 : b.x1; // the centre line
        const outer = inner === b.x0 ? b.x1 : b.x0;
        const toOut = outer > inner ? 1 : -1;
        let tx: number;
        let depth: number;
        if (!second && wide < 0.35) {
          tx = outer - toOut * 0.85;
          depth = 5.8 + 0.6 * rng.next();
        } else if (wide < (second ? 0.5 : 0.7)) {
          tx = inner + toOut * (second ? 0.8 : 0.6);
          depth = second ? 4.9 + 0.8 * rng.next() : 5.4 + 0.8 * rng.next();
        } else {
          tx = (inner + outer) * 0.5;
          depth = second ? 4.9 + 0.8 * rng.next() : 5.4 + 0.8 * rng.next();
        }
        this.targetX = tx;
        this.targetZ = -s * depth;
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

    // On the way to the planned contact, a ball that will hit us first (walking into its line, or a contact planned
    // after it passes): plan again, which blocks it from where we stand. Checked as we move, not only when the plan
    // was made (net players walked into the ball on their way to a contact behind them: a tenth of all points).
    if (this.planned && !this.pressed && !this.overhead && t0 >= this.reactAt && (this.tick++ & 3) === 0) {
      const k = m.bodyHitIdx(this.index, s);
      if (k >= 0 && m.pred.t[k]! < this.idealT - 0.05) this.planVersion = -1;
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
        else if ((p.shot === SHOT_SLICE || p.shot === SHOT_DRIVE) && this.safe) f.held |= BTN_PRECISION;
        else if ((p.shot === SHOT_SLICE || p.shot === SHOT_DRIVE) && this.punch) f.held |= BTN_POWER;
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
    const n = findWindows(m.pred, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, m.time - 0.3, p.shot === SHOT_BANDEJA, false, this.ohKind);
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

  /** The planned contact's height and distance from the net (overhead targets read them). */
  private conHeight = 0;
  private conDepth = 0;
  /**
   * The overhead picked for this ball (windows.ts OH_*; OH_ANY: not yet), planned, timed and judged at its own
   * contact height (MatchSim reads it for the windows).
   */
  ohKind = OH_ANY;

  /** Where drift steers to, and by when (goBy 0: no hurry). Fields, not arguments: see think. */
  private goX = 0;
  private goZ = 0;
  private goBy = 0;
  /** Going for the ball (not just taking up a position). */
  private chasing = false;
  /** Standing set at the spot (moves again only once the spot is well away). */
  private set = false;
  /** The tick's start time (a field: a double argument would be boxed). */
  private nowT = 0;
  /** Ticks counted for checks that run every few ticks. */
  private tick = 0;

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
    // Set: stay put until the spot has moved well away (the formation spot follows the ball; chasing every
    // few centimetres of it is a stop-start shuffle real players don't do). Going for the ball, close in, the
    // feet still adjust.
    if (chase && left < 0.6) {
      if (d < 0.04) return;
    } else if (d < (this.set ? 0.35 : 0.12)) {
      this.set = true;
      return;
    }
    this.set = false;
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
      const oh = this.ohKind;
      const ok = (close && this.overhead && planStand(pr, p, s, now, m.rally.isServe, st, keep, true, true, false, oh))
        || planStand(pr, p, s, now, m.rally.isServe, st, this.overhead ? keep : -1, false, true, false, oh);
      overhead = ok && (st.inTime || p.swing === SW_CHARGE) && abs(st.z) < 8.2;
    }
    if (!overhead) {
      this.ohKind = OH_ANY;
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
    this.conHeight = height;
    this.conDepth = depth;
    this.shot = SHOT_BANDEJA;
    if (this.ohKind !== OH_ANY) {
      // Picked when the lob was first read (and planned at that overhead's height since): keep it.
      this.smash = this.ohKind === OH_SMASH;
      this.vibora = this.ohKind === OH_VIBORA;
      if (m.doubles) m.intentUp[this.team] = 1;
      this.chooseTarget(m);
      return;
    }
    const r = m.aiRng.next();
    const st = this.style;
    // A smash can finish the point only from where its bounce kicks up into the glass hard enough to come back over
    // the net or leave the court: a straight line from the contact that clears the tape lands within KILL_DEPTH.
    // From there players smash; from deeper they play the bandeja to keep the net (pros smash 26-36% of overheads,
    // and a flat smash wins half the time: Sánchez-Alcaraz et al. 2020). Lower levels go for the smash from too far
    // anyway (amateurs' power smashes are their error: Fernández-de-Osso et al. 2025).
    const kill = smashDepth(m, depth, height) <= KILL_DEPTH;
    this.smash = kill ? r < min(0.95, (0.6 + 0.35 * this.level) * st.smash) : depth < 6.5 && height > 2.2 && r < (0.35 - 0.3 * this.level) * st.smash;
    // Not a smash: the better players turn some into víboras (into the side glass, more pace than a bandeja).
    this.vibora = !this.smash && depth < 7 && m.aiRng.next() < (0.15 + 0.35 * this.level) * st.vibora;
    // Planned again at that overhead's own height (a bandeja is let drop to head height, a smash is met at full
    // reach): from the next tick.
    this.ohKind = this.smash ? OH_SMASH : this.vibora ? OH_VIBORA : OH_BANDEJA;
    if (this.overhead) this.planVersion = -1;
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
    this.safe = false;
    this.punch = false;
    // A ball at overhead height in front: an overhead, chosen as one (the sim turned a drive key's high ball into a
    // smash aimed like a drive: most of the AI's smashes, from 6.5 m, which the defenders blocked back).
    if (height >= m.players[this.index]!.tune.overheadHeight && depth < 7) {
      this.chooseOverhead(m, height, depth);
      return;
    }
    if (volley) this.volleyPlay(m, height, depth);
    if (m.doubles) {
      this.chooseDoublesShot(m, r, height, volley, depth);
      this.chooseTarget(m);
      return;
    }
    const st = this.style;
    const lob = min(0.9, 0.25 * st.lob);
    if (volley) {
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
   * How a volley is played, from its height: a ball below the tape has to be lifted, so it is played soft with
   * margin (precision: 1.25x the clearance, 0.86x the pace, 0.6x the spread); a high ball near the net is put away
   * (power). Weaker players misjudge it more often, the wrong way round included: a mistake of choice, not a miss.
   */
  private volleyPlay(m: MatchSim, height: number, depth: number): void {
    const r = m.aiRng.next();
    const right = 0.4 + 0.5 * this.level;
    if (height < 0.9) {
      this.safe = r < right;
      this.punch = r > 1 - 0.25 * (1 - this.level);
    } else if (height > 1.25 && depth < 4.5) {
      this.punch = r < right;
    }
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
    if (volley || depth < 5) {
      const near = depth < 4.2;
      if (up === 2 && r < min(0.6, 0.3 * st.lob)) {
        // Both pairs at the net: a lob volley sends them back (net duels are short in real play; they had become
        // 60% of the AI's volleys, ending on bodies and through the middle).
        this.shot = SHOT_LOB;
        go = 1;
      } else {
        this.shot = up === 0 && r < 0.12 * st.drop ? SHOT_DROP : r < 0.65 ? SHOT_SLICE : SHOT_DRIVE;
        // Pulled in by a short ball against a pair at the net: back out again unless already close in.
        go = near || up < 2 ? 1 : 0;
      }
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
      // Flat and hard, mostly down the line (men 77.7%: Sánchez-Alcaraz et al. 2020), landing as short as a straight
      // line from the contact clears the tape with margin, so the bounce kicks up into the glass and can leave the
      // court (por tres) or come back over the net: the shortest landing the untouched human smash aims at.
      const me = m.players[this.index]!;
      x = rng.next() < 0.75 ? (me.pos.x >= 0 ? 1 : -1) * spread * (0.55 + 0.35 * rng.next()) : (a.pos.x + b.pos.x) * 0.5;
      depth = smashDepth(m, this.conDepth, this.conHeight) + 0.6 * rng.next();
    } else if (this.shot === SHOT_BANDEJA) {
      // Deep into a corner, so the ball sits down off the back glass.
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.5 + 0.4 * rng.next());
      depth = 8.0 + 0.8 * rng.next();
    } else if (this.shot === SHOT_LOB) {
      // Deep enough to get over and behind the net player, short of the back glass on the full: real lobs land
      // anywhere from about 5.5 m (good) to 8.6 m (excellent) from the net (Ramón-Llin et al. 2019).
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.3 + 0.5 * rng.next());
      depth = min(8.2, c.halfL - 1.8 - 0.6 * (1 - this.level)) - 1.2 * rng.next();
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

/**
 * A smash's landing depth (m from the net): the shortest at which a full-pace smash from the contact (`back` m from
 * the net, `h` high) clears the tape by SMASH_MARGIN, as the human's untouched smash aims (match.ts steerAim).
 */
function smashDepth(m: MatchSim, back: number, h: number): number {
  const c = m.world.court;
  return smashLanding(c.netHeightAt(0), back, h, SMASH_MARGIN, SMASH_MIN, c.halfL - 2.0);
}
const SMASH_MARGIN = 0.45;
const SMASH_MIN = 3.2;
/** A smash landing this short (m from the net) kicks off the glass hard enough to be a winner. */
const KILL_DEPTH = 6.0;

/** The key that holds a shot: the overhead key for a bandeja/smash, else the shot's own key. */
function button(shot: number): number {
  return shot === SHOT_BANDEJA ? BTN_OVERHEAD : SHOT_BUTTONS[shot]!;
}
