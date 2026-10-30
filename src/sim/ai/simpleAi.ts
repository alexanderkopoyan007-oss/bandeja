// AI player: reads the predicted ball path after a human-like reaction delay, runs to a hitting spot,
// presses and releases the swing with timing noise, and picks shots and targets with simple tactics.
// It plays through the same InputFrame path as a human, so it obeys the same physics and timing rules.
// In doubles it only goes for balls the match assigns to it (MatchSim.taker); otherwise it plays in
// formation with its partner: both at the net or both back, each covering a lane, shifted to the ball.
import type { MatchSim } from '../match.ts';
import { InputFrame, SHOT_BUTTONS, BTN_OVERHEAD, BTN_POWER, BTN_PRECISION } from '../input.ts';
import { abs, clamp, floor, max, min, sqrt } from '../core/smath.ts';
import { DT } from '../core/constants.ts';
import { PF_FLOOR, type Prediction } from '../ball/predict.ts';
import { findWindows, makeWindows, OH_ANY, OH_BANDEJA, OH_SMASH, OH_VIBORA } from '../contact/windows.ts';
import { makeStandPlan, offGlassHigh, planStand, BAJADA_ABOVE, BAJADA_DEPTH, type StandPlan } from '../player/positioning.ts';
import { smashLanding } from '../contact/smashAim.ts';
import { formationSpot, type Spot } from '../player/formation.ts';
import { styleOf, type AiStyle } from './styles.ts';
import skillData from '../../../data/ai-skill.json' with { type: 'json' };

/** Share of a style's balls hit with power or played safe per unit of its pace (data/ai.json). */
const PACE_SHARE = 0.5;
/** How far (m) a ball event must move the planned contact to need a correction (AI.correctAt). */
const SURPRISE = 0.15;
/**
 * Extra timing spread (per unit of the SD) for a ball off the glass: a wall shot is read and met on a ball that
 * changed direction, and is the least accurate stroke (Delgado García et al. 2017's target test). At 0.3 the top
 * AI erred on 3.1-3.5% of its back-wall shots against the pros' 5.4-6.3% (and rallies ran 11.7 shots); with the
 * AI judged on each shot's own windows, 1.8 gives 6.4% (and 11.3).
 */
const AFTER_WALL = 1.8;
/**
 * The bajada (an overhead off our own back glass, positioning.ts BAJADA_*): BAJADA_HARD of them are struck flat and
 * hard (the smash shape), the rest placed like a bandeja; after BAJADA_NET of them (per unit of the style's net) the
 * pair moves up.
 */
const BAJADA_HARD = 0.45;
const BAJADA_NET = 0.4;
/** Chance a pair follows its chiquita in to the net, per unit of the style's net. */
const CHIQ_NET = 0.35;
/** Chance a net-shy style stays back behind its lob, per unit of its net trait under 1 (Muro, 0.6: 80%). */
const LOB_STAY = 2.0;
/** Singles: comes in behind a ball met within APPROACH_DEPTH (m) of the net with chance APPROACH_SHORT, behind any low
 * ball with the opponent deep APPROACH_DEEP, behind a serve SERVE_VOLLEY (each by the style's net and the level). */
const APPROACH_DEPTH = 6.8;
const APPROACH_SHORT = 0.8;
const APPROACH_DEEP = 0.4;
const SERVE_VOLLEY = 0.7;
/** A drop volley: the ball over DROP_HEIGHT (m, the tape and a bit), met within DROP_DEPTH (m) of the net, played by
 * DROP_RATE of the volleys that qualify (scaled by the style's drop). */
const DROP_HEIGHT = 0.98;
const DROP_DEPTH = 3.8;
const DROP_RATE = 0.12;
/** Chance a net-shy style drops back again after a ball taken near the net, per unit of its net trait under 1. */
const NET_BACK = 0.5;
/** Chance a net-loving style comes in behind a low ball from the back, per unit of its net trait over 1 (Martillo, 1.6:
 * 36%). A style that lobs little has no other way forward: Martillo sat back at 32.6% net time against Muro's 40.6%. */
const NET_PRESS = 0.6;
const SKILL = skillData as unknown as { timing: number[]; motor: number[]; pressure: number; smashEffort: number[]; chaseEffort: number; formationEffort: number; glassWait: number; ohArrive: number; bajada: number[]; women: { speed: number; smashEffort: number; smash: number; lob: number; serveGlass: number; serveT: number; serveEdge: number; serveEffort: number } };
export const WOMENS_SPEED = SKILL.women.speed;
/** A value by level: v holds it at evenly spaced levels from 0 to 1 (two or more), interpolated linearly between. */
function byLevel(v: number[], level: number): number {
  const n = v.length - 1;
  const x = level * n;
  const k = x >= n ? n - 1 : x <= 0 ? 0 : floor(x);
  return v[k]! + (v[k + 1]! - v[k]!) * (x - k);
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
  /** Player.glassWait for this AI (data/ai-skill.json glassWait). */
  readonly glassWait = SKILL.glassWait;
  /** The shot being chosen is a volley (chooseShot; read by the targets). */
  private volleying = false;
  /** Player.ohArrive for this AI (data/ai-skill.json ohArrive). */
  readonly ohArrive = SKILL.ohArrive;
  planVersion = -1;
  reactAt = 0;
  /**
   * A bounce or a wall moved the ball off the path the plan was made for (mesh, a glass join, the net cord): the plan
   * and the release are corrected only from this time (-1: none pending). Players correct a stroke under way after
   * 110-170 ms (docs/research/shots-movement-feel.md §3); the AI used to see the new path the tick it happened.
   */
  private correctAt = -1;
  standX = 0;
  standZ = 0;
  idealT = 0;
  releaseAt = 0;
  /** The ideal moment of the window the release is timed off: an early release meets the ball then (the sim's
   * contact is the later of the two), which the animation times the swing to. */
  releaseIdeal = 0;
  shot = SHOT_DRIVE;
  targetX = 0;
  targetZ = 0;
  planned = false;
  pressed = false;
  released = false;
  // -0.5, not -1 (only ever tested < 0): a field that holds a small integer until its first fractional value (the
  // AI's first serve, minutes in) changes the AI's map then, and every optimised function using it deoptimises.
  servePressAt = -0.5;
  /** Timing error for the current plan (drawn once, like a human's misjudgement). */
  noise = 0;
  /** The current plan takes a lob in the air (overhead key), and hits it as a smash (power held). */
  overhead = false;
  smash = false;
  /** The overhead is a víbora (precision held at release). */
  vibora = false;
  /** This lob isn't followed in, whatever comes of it (a net-shy style: LOB_STAY). */
  lobStay = false;
  /** The topspin is a chiquita (precision held at release). */
  chiquita = false;
  /** A volley played safe (precision held: more net clearance, less pace) or put away (power held). */
  safe = false;
  punch = false;
  /** The current plan is a contrapared (positioning.ts): met facing our own back glass and hit up into it. */
  contra = false;
  /** Singles: our last shot was one to follow in (the net-intent decision doubles keeps in MatchSim.intentUp). */
  approach = false;
  /** Waiting at (holdX, holdZ) for the ball to cross the way to the plan's spot, until holdT (holdShort). */
  private holdT = -0;
  private holdX = -0;
  private holdZ = -0;
  private readonly wins = makeWindows();
  private readonly st = makeStandPlan();
  /** The contact this AI is set up for (the renderer times the swing to it). */
  get standPlan(): Readonly<StandPlan> {
    return this.st;
  }
  private readonly spot: Spot = { x: 0, z: 0 };

  readonly style: AiStyle;
  readonly women: boolean;

  constructor(index: number, level: number, style: AiStyle = styleOf(undefined), women = false) {
    this.index = index;
    this.team = index & 1;
    this.women = women;
    // A women's match smashes less and lobs more whatever the player's style (data/ai-skill.json).
    this.style = women ? { ...style, smash: style.smash * SKILL.women.smash, lob: style.lob * SKILL.women.lob } : style;
    this.level = clamp(level + style.level, 0, 1);
  }

  reset(): void {
    // (a ball out of reach at the end of the last rally is not the serve's: the avatar held the serve's backswing
    // as beaten, and swung 0.1 s late)
    this.reach = true;
    this.planVersion = -1;
    this.ohKind = OH_ANY;
    this.bajada = false;
    this.bajadaOk = false;
    this.contra = false;
    this.planned = false;
    this.pressed = false;
    this.released = false;
    this.servePressAt = -0.5;
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

  /** How hard this AI swings a smash (ShotRequest.power): weaker players smash slower (data/ai-skill.json). */
  smashEffort(): number {
    return byLevel(SKILL.smashEffort, this.level) * (this.women ? SKILL.women.smashEffort : 1);
  }

  /** How hard this AI serves (ShotRequest.power). */
  serveEffort(): number {
    return this.women ? SKILL.women.serveEffort : 1;
  }

  /** Swing-to-swing spread at contact (ShotRequest.motor), growing with the ball's pressure. */
  motor(pressure: number): number {
    return byLevel(SKILL.motor, this.level) * (1 + SKILL.pressure * pressure);
  }

  /**
   * How steady the swing is for this contact height (ShotRequest.control). At the net the clock is always short, so
   * pressure alone can't tell a sitter from a shoe-top ball: the height can. A ball above the tape is the one a net
   * player kills, the one at the shoes is the one that hurts them (sitters were lost 11.8% of the time, shoe-tops 1.6%:
   * review round 5, the pro's #2).
   */
  control(height: number): number {
    if (!this.volleying || this.conDepth >= 5) return 1;
    return height >= SITTER_H ? SITTER_CONTROL : height < SHOE_H ? SHOE_CONTROL : 1;
  }

  onStrike(m: MatchSim, striker: number): void {
    if (striker === this.team) {
      this.planned = false;
      this.pressed = false;
      this.released = false;
      this.serveIn = m.rally.isServe && m.score.serverPlayer() === this.index;
      return;
    }
    this.reactAt = m.time + this.reaction() * (0.8 + 0.4 * m.aiRng.next());
    this.correctAt = -1;
    this.planVersion = -1;
    // The plan was for the last ball: until this one is planned (after the reaction) nobody may read it as this
    // ball's (the partner's lane switch did, and ran across and back on 13% of the balls its mate took).
    this.st.valid = false;
    this.reach = true;
    this.ohKind = OH_ANY;
    this.bajada = false;
    // Will this ball, if it comes off our glass high, be taken as a bajada? (decided once a ball, by level)
    this.bajadaOk = m.aiRng.next() < byLevel(SKILL.bajada, this.level);
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
      // (the serve's moment is drawn once everyone is in place after the walk back: MatchSim.walking)
      if (!serving || m.walking !== 0) return;
      if (this.servePressAt < 0) {
        this.servePressAt = t0 + 0.7 + 0.7 * rng.next();
        const r = rng.next();
        // A first serve goes for the lines and pace; a second serve is a safe slice with room to spare (pros fault
        // about 10% of first serves and 2% of second serves: Mellado-Arbelo et al. 2019).
        const second = m.serveNo === 2;
        this.shot = second ? (r < 0.85 ? SHOT_SLICE : SHOT_TOPSPIN) : r < 0.6 ? SHOT_SLICE : r < 0.85 ? SHOT_DRIVE : SHOT_TOPSPIN;
        const b = m.box;
        const wide = rng.next();
        // Where pros serve (WPT men, Sánchez-Alcaraz et al. 2020, docs/research/shots-movement-feel.md §6): 64.6% into
        // the side glass, 24.3% to the T, 11.1% to the middle; from the left court 12% more to the side glass, from
        // the right 14% more to the T. The box's outer side is the side wall: a wide serve that bounces short runs on
        // into the side mesh (a fault after the bounce), so wide serves go deep, onto the side glass. A second serve
        // keeps more room, and goes wide less often.
        const inner = abs(b.x0) < abs(b.x1) ? b.x0 : b.x1; // the centre line
        const outer = inner === b.x0 ? b.x1 : b.x0;
        const toOut = outer > inner ? 1 : -1;
        const fromLeft = p.pos.x * s < 0; // (the server's left, facing the net)
        const w = this.women;
        const toGlass = second ? (fromLeft ? 0.5 : 0.4) : w ? SKILL.women.serveGlass : fromLeft ? 0.7 : 0.58;
        const toT = toGlass + (second ? 0.38 : w ? SKILL.women.serveT : fromLeft ? 0.19 : 0.31);
        let tx: number;
        let depth: number;
        // (weaker servers aim well inside the lines: the same targets faulted 30% of first serves at level 0)
        const room = 1 - this.level;
        if (wide < toGlass) {
          tx = outer - toOut * ((second ? 1.1 : w ? SKILL.women.serveEdge : 0.85) + 0.65 * room);
          depth = (second ? 5.5 + 0.5 * rng.next() : 5.8 + 0.6 * rng.next()) - 0.9 * room;
        } else if (wide < toT) {
          tx = inner + toOut * ((second ? 0.8 : w ? SKILL.women.serveEdge - 0.25 : 0.6) + 0.4 * room);
          depth = (second ? 4.9 + 0.8 * rng.next() : 5.4 + 0.8 * rng.next()) - 0.75 * room;
        } else {
          tx = (inner + outer) * 0.5;
          depth = (second ? 4.9 + 0.8 * rng.next() : 5.4 + 0.8 * rng.next()) - 0.75 * room;
        }
        this.targetX = tx;
        this.targetZ = -s * depth;
        if (!m.doubles && m.cfg.practice === undefined) this.approach = rng.next() < SERVE_VOLLEY * (second ? 0.4 : 1) * (0.4 + 0.6 * this.level) * this.style.net;
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
      this.serveIn = false;
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
      const baseZ = s * (nearNet || this.approach ? 3.2 : 7.6);
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
    if (this.planned && this.planVersion >= 0 && m.pred.version !== this.planVersion && this.correctAt < 0
      && t0 >= this.reactAt && this.surprised(m)) {
      this.correctAt = t0 + (0.17 - 0.06 * this.level) * (0.8 + 0.4 * m.aiRng.next());
    }
    const correcting = this.correctAt >= 0 && t0 < this.correctAt;
    if (!correcting) this.correctAt = -1;
    if (t0 >= this.reactAt && !correcting && m.pred.version !== this.planVersion) this.plan(m);
    if (this.planned) {
      this.goX = this.standX;
      this.goZ = this.standZ;
      // Be there, feet set, a little before the contact.
      this.goBy = this.idealT - 0.15;
      if (t0 < this.holdT) {
        this.goX = this.holdX;
        this.goZ = this.holdZ;
        this.goBy = this.holdT;
      }
      this.chasing = true;
      this.drift(f, p, s);
      if (!this.pressed && p.swing === SW_IDLE && t0 >= this.idealT - (this.overhead ? OH_PRESS : 0.45)) {
        f.push(true, button(this.shot), t0);
        this.pressed = true;
      }
      if (this.pressed && !this.released && p.swing === SW_CHARGE && !correcting) this.trackRelease(m, s);
      if (this.pressed && !this.released && p.swing === SW_CHARGE && t1 > this.releaseAt && !this.reach) {
        // Beaten: the ball no longer passes within reach of where we are. A player stretches for it or lets it go;
        // they don't take a full swing at the air (40% of points at the top level ended on such a swing: the
        // opponents' winners).
        m.standDown(this.index);
        this.released = true;
      }
      if (this.pressed && !this.released && p.swing === SW_CHARGE && t1 > this.releaseAt) {
        this.aimAbs(f);
        if (p.shot === SHOT_BANDEJA && this.smash) f.held |= BTN_POWER;
        else if (p.shot === SHOT_BANDEJA && this.vibora) f.held |= BTN_PRECISION;
        else if (p.shot === SHOT_TOPSPIN && this.chiquita) f.held |= BTN_PRECISION;
        else if ((p.shot === SHOT_SLICE || p.shot === SHOT_DRIVE) && this.safe) f.held |= BTN_PRECISION;
        else if ((p.shot === SHOT_SLICE || p.shot === SHOT_DRIVE) && this.punch) f.held |= BTN_POWER;
        else if (p.shot === SHOT_LOB && this.safe) f.held |= BTN_PRECISION;
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
    // The partner's ball: keep to our own side of its line where it passes us, never across it (half the body
    // winners hit the player who wasn't taking the ball, mostly on their way across it to the formation spot, too
    // late to stop once they saw it: REVIEW.md round 2 #3).
    if (coming) {
      const now = m.time;
      const pr = m.pred;
      const h = p.tune.height;
      const pz = p.pos.z;
      for (let k = 0; k < pr.n; k++) {
        if (pr.t[k]! < now || pr.z[k]! * s <= 0 || pr.y[k]! > h) continue;
        if (pr.bounces[k]! > 1) break;
        const dz = pr.z[k]! - pz;
        if (dz > 0.15 || dz < -0.15) continue;
        const bx = pr.x[k]!;
        const sd = p.pos.x > bx ? 1 : p.pos.x < bx ? -1 : (m.players[this.index ^ 2]!.pos.x > bx ? -1 : 1);
        if ((this.goX - bx) * sd < DODGE) {
          this.goX = clamp(bx + sd * DODGE, p.minX, p.maxX);
          this.goBy = pr.t[k]!;
          this.chasing = true;
          this.drift(f, p, s);
          return;
        }
        break;
      }
    }
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
    const n = findWindows(m.pred, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, m.time - 0.3, p.shot === SHOT_BANDEJA, false, this.ohKind,
      this.contra ? m.world.court.halfL : 0);
    this.reach = n > 0;
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (best < 0 || abs(this.wins[i]!.ideal - this.idealT) < abs(this.wins[best]!.ideal - this.idealT)) best = i;
    }
    if (best < 0) return;
    const ideal = this.wins[best]!.ideal;
    this.releaseAt = ideal + this.noise;
    this.releaseIdeal = ideal;
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
  /** Following their serve in, until their first shot after it. */
  private serveIn = false;
  private conHeight = 0;
  private conDepth = 0;
  /**
   * The overhead picked for this ball (windows.ts OH_*; OH_ANY: not yet), planned, timed and judged at its own
   * contact height (MatchSim reads it for the windows).
   */
  ohKind = OH_ANY;
  /**
   * The overhead planned is a bajada: off our own back glass, met as it drops through head height (bajadaOk: this
   * ball may be taken that way; data/ai-skill.json bajada by level).
   */
  bajada = false;
  private bajadaOk = false;
  /** From where we stand, the ball still passes within reach (trackRelease): else the swing is not made. */
  private reach = true;

  /** Charging, and from where we stand the ball doesn't pass within reach: the avatar holds the backswing (it would
   * otherwise swing all the way into nothing before the stand-down). */
  get beaten(): boolean {
    return this.pressed && !this.released && !this.reach;
  }

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
   * Steer towards (goX, goZ) and arrive without overshooting: hard for the ball (flat out only when the time left
   * asks), brisk into the formation, and no shuffling for a few centimetres (real players then stand: most of a
   * match is spent below 6 km/h).
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
    // Going for the ball: hard (chaseEffort of the top speed that way), flat out if the time left asks. Taking up
    // a position: brisk (being in place before the next strike is what reaches balls; a relaxed 2.6 m/s left a
    // tenth more of them unreached), faster if the time left asks.
    const need = left < 1e8 ? (d / (left > 0.08 ? left : 0.08)) * 1.35 : 0;
    const brisk = 4.5;
    const hard = top * SKILL.chaseEffort;
    let v = chase ? (need > hard ? need : hard) : need > brisk ? need : brisk;
    // Into the formation never flat out: the deadline (the next bounce) is a guess at the next strike, and a player
    // a step short of their spot is still in the point (flat out, every AI hit its top speed every few minutes).
    const easy = top * SKILL.formationEffort;
    if (!chase && v > easy) v = easy;
    if (v > top) v = top;
    // Following the serve in: a run, not a sprint, still moving as the return is struck and through the third shot
    // (peak 2.93 +- 0.43 m/s, 5.08 m from the net at the return, the third from 3.84 m at about 2 m/s: Ramon-Llin 2021;
    // here 4.5 m/s to a stop at 4.09 m: review round 5, the pro's #4).
    const cap = this.serveIn;
    if (cap && v > SERVE_RUN) v = SERVE_RUN;
    const stop = sqrt(2 * t.brake * 0.8 * d);
    if (v > stop) {
      // Short of time for an overhead: arrive still moving (Player.ohArrive; planStand counted on it).
      const va = cap && chase ? SERVE_ARRIVE : p.ohArrive;
      const late = (chase && this.overhead && need > stop) || (cap && chase) ? sqrt(va * va + 2 * t.brake * 0.8 * d) : stop;
      v = v > late ? late : v;
    }
    const want = v / top;
    f.moveX = (dx / d) * want * s;
    f.moveY = -(dz / d) * want * s;
  }

  /**
   * Pick the contact with the same planner the human's assist uses (positioning.planStand): reachable in time,
   * a comfortable height, deep balls played off the glass, and never a spot the ball flies through on its
   * way (it would hit us first). The planned contact is kept unless a clearly better one appears.
   */
  /** The new prediction no longer brings the ball to the planned contact (within SURPRISE m at its moment). */
  private surprised(m: MatchSim): boolean {
    const pr = m.pred;
    const t = this.idealT;
    if (!this.st.valid || t <= m.time) return false;
    for (let i = 0; i < pr.n; i++) {
      if (pr.t[i]! < t) continue;
      const dx = pr.x[i]! - this.refX, dy = pr.y[i]! - this.refY, dz = pr.z[i]! - this.refZ;
      return dx * dx + dy * dy + dz * dz > SURPRISE * SURPRISE;
    }
    return true;
  }

  /** Where the plan's prediction put the ball at the planned moment (idealT): what a later bounce is judged against
   * (a block's moment is not the stand plan's contact, so st.b* would call every block surprised). */
  private refX = 0;
  private refY = 0;
  private refZ = 0;

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
    // A high ball coming off our own back glass: smash it back down off the glass (a bajada), if this ball is one
    // to take that way.
    const offGlass = this.bajadaOk && offGlassHigh(pr, s, now, p.tune.overheadHeight + BAJADA_ABOVE, BAJADA_DEPTH, m.world.court.halfL) >= 0;
    let overhead = p.swing === SW_CHARGE ? p.shot === SHOT_BANDEJA : (abs(p.pos.z) < 6.5 && this.lobComing(m, s)) || offGlass;
    if (overhead) {
      const oh = this.ohKind;
      const ok = (close && this.overhead && planStand(pr, p, s, now, m.rally.isServe, st, keep, true, true, false, oh))
        || planStand(pr, p, s, now, m.rally.isServe, st, this.overhead ? keep : -1, false, true, false, oh);
      // Deep overheads only off the glass (a bajada); in the air from back there it is a lob to let bounce. Off the
      // glass, only where a bajada is met (a ball still high well out of the glass is let drop and played).
      overhead = ok && (st.inTime || p.swing === SW_CHARGE)
        && (st.afterWall ? abs(st.bz) >= BAJADA_DEPTH - 0.5 : abs(st.z) < 8.2);
    }
    this.bajada = overhead && st.afterWall;
    if (!overhead) {
      this.ohKind = OH_ANY;
      const k = this.overhead ? -1 : keep;
      if (!(close && k >= 0 && planStand(pr, p, s, now, m.rally.isServe, st, k, true, false))) {
        if (!planStand(pr, p, s, now, m.rally.isServe, st, k, false, false)) { this.planned = false; this.contra = false; return; }
      }
    }
    // A hard ball on its way to the glass with no time to set up for it: wait for it off the wall, out of its line. The
    // plan's least-late contact was on the rise (first plan 0.18 s after a smash, in time for it 6.8%, while a contact
    // off the glass existed in 65.8% of cases: review round 5, the pro's #1).
    if (!overhead && !st.volley && !st.afterWall && m.bodyHitIdx(this.index, s) < 0 && this.tooHot(m, st.t)) {
      const k = offGlassLow(pr, s, m.world.court.halfL);
      if (k >= 0) planStand(pr, p, s, now, m.rally.isServe, st, k, true, false);
      // Climbing off the glass out of reach: nothing to play. It was struck on the rise from a standstill (or it comes
      // back over the net by itself, as a real kick smash does).
      else if (k === CLIMBS && !st.inTime) { this.planned = false; this.contra = false; return; }
    }
    this.overhead = overhead;
    // (a held swing follows the plan too: the sim judges its release against the windows of the kind planned now)
    this.contra = !overhead && st.contra;
    let sx = st.x;
    let sz = st.z;
    let t = st.t;
    let height = st.by;
    let volley = st.volley;
    const kHit = overhead ? -1 : m.bodyHitIdx(this.index, s);
    let hit = kHit >= 0 ? pr.t[kHit]! : -1;
    // The ball comes at us before the planned contact, but the plan's spot is clear of it: when running there takes
    // us out of its line before it arrives, go (a deep bandeja dropping at a defender is let past to the glass).
    // Blocked from where they stood, defenders volleyed 58% of bandejas at their shins from 7 m (REVIEW.md round 3
    // #1), having planned to play them off the glass.
    if (hit >= 0 && st.inTime && hit < st.t + 0.09 && !overhead && this.hitOnTheWay(m, s, st.x, st.z) < 0) hit = -1;
    this.holdT = -0;
    if (!overhead && !st.volley) {
      this.holdShort(m, s, st.x, st.z, st.t);
      if (this.holdT > 0) hit = -1;
    }
    if ((!st.inTime || (hit >= 0 && hit < st.t + 0.09)) && !overhead) {
      // No comfortable contact in time, or the ball comes at us before the planned one (a fast ball at the
      // body, typically at the net): block it from where we stand, at the first moment it is in reach, rather
      // than be hit while running to a spot we can't make.
      // (not a hard ball on its way to the glass, unless it is coming at us: a defender gets out of its line and takes it
      // off the wall, or it beats them. Blocked on the rise, smashes drew 19.1 forced errors in 100 to WPT's 0.8: review
      // round 5, the pro's #1)
      const n = findWindows(pr, p.pos.x, p.pos.z, s, m.rally.isServe, 1, p.tune, this.wins, now, false);
      if (n > 0 && this.wins[0]!.ideal < st.t + 0.09 && (hit >= 0 || !this.tooHot(m, this.wins[0]!.ideal))) {
        const w = this.wins[0]!;
        this.contra = false;
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
    for (let i = 0; i < pr.n; i++) {
      if (pr.t[i]! < t) continue;
      this.refX = pr.x[i]!; this.refY = pr.y[i]!; this.refZ = pr.z[i]!;
      break;
    }
    if (changed) this.noise = rng.normal() * this.timingSigma() * this.difficulty(m, height, st.afterWall);
    this.releaseAt = this.idealT + this.noise;
    this.releaseIdeal = this.idealT;
    this.planned = true;
    this.pressed = p.swing !== SW_IDLE;
    this.released = false;
    if (this.pressed) this.retarget(m);
    else if (overhead) this.chooseOverhead(m, height, abs(sz));
    else this.chooseShot(m, height, volley, abs(sz));
  }

  /**
   * Running from where we stand to (tx, tz), does the ball reach the body on the way? The prediction sample where
   * it does, or -1 (an index, as MatchSim.bodyHitIdx: a double returned from a call that isn't inlined is boxed).
   * The run is a cautious one: from rest, ESCAPE_LAG late, at ESCAPE_ACCEL of the push, no faster than ESCAPE_TOP.
   */
  private hitOnTheWay(m: MatchSim, s: number, tx: number, tz: number): number {
    const p = m.players[this.index]!;
    const pr = m.pred;
    const t = p.tune;
    const dx = tx - p.pos.x;
    const dz = tz - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    const ux = d > 1e-6 ? dx / d : 0;
    const uz = d > 1e-6 ? dz / d : 0;
    const a = t.accel * ESCAPE_ACCEL;
    // Already on the way there: from that speed, and no start-up lag (re-planned every few ticks from rest, a
    // player half way out of the line was judged to be hit, blocked from where they were and stopped).
    const v0 = clamp(p.vel.x * ux + p.vel.z * uz, 0, ESCAPE_TOP);
    const lag = v0 > 0.5 ? 0 : ESCAPE_LAG;
    const tv = (ESCAPE_TOP - v0) / a;
    const r = t.bodyRadius + m.world.spec.radius + 0.05;
    const t0 = m.time;
    for (let k = 0; k < pr.n; k++) {
      if (pr.t[k]! < t0 || pr.z[k]! * s <= 0) continue;
      if (pr.bounces[k]! > 1) break;
      if (pr.y[k]! > t.height) continue;
      const tau = max(0, pr.t[k]! - t0 - lag);
      let go = tau < tv ? v0 * tau + 0.5 * a * tau * tau : v0 * tv + 0.5 * a * tv * tv + ESCAPE_TOP * (tau - tv);
      if (go > d) go = d;
      const ex = pr.x[k]! - (p.pos.x + ux * go);
      const ez = pr.z[k]! - (p.pos.z + uz * go);
      if (ex * ex + ez * ez < r * r) return k;
    }
    return -1;
  }

  /**
   * The contact is after the ball has gone by us (off the glass, usually) and the ball's line runs through us or
   * between us and the spot: step DODGE off the line, on the spot's side if there is time and our own if not, and
   * wait for it to pass. A player doesn't run through a ball they mean to play later: run straight at the spot,
   * defenders crossed the line of a bandeja as it arrived, stopped to block it and half-volleyed it at their shins
   * (89 of 94 such volleys were planned off the glass: review round 4, the pro's #4). Time enough to cross first, or
   * too little left after the wait, leaves the plan as it is.
   */
  private holdShort(m: MatchSim, s: number, tx: number, tz: number, contact: number): void {
    const p = m.players[this.index]!;
    const pr = m.pred;
    const px = p.pos.x;
    const pz = p.pos.z;
    const h = p.tune.height;
    const now = m.time;
    // Where the ball passes nearest, below the top of the body.
    let near = HOLD_NEAR * HOLD_NEAR;
    let k = -1;
    for (let j = 0; j < pr.n; j++) {
      const ti = pr.t[j]!;
      if (ti < now || pr.z[j]! * s <= 0) continue;
      if (pr.bounces[j]! > 1 || ti > contact - HOLD_GAP) break;
      if (pr.y[j]! > h) continue;
      const ex = px - pr.x[j]!;
      const ez = pz - pr.z[j]!;
      const d2 = ex * ex + ez * ez;
      if (d2 < near) { near = d2; k = j; }
    }
    if (k < 0) return;
    const vx = pr.vx[k]!;
    const vz = pr.vz[k]!;
    const v = sqrt(vx * vx + vz * vz);
    if (v < 1) return;
    const nx = -vz / v;
    const nz = vx / v;
    const bx = pr.x[k]!;
    const bz = pr.z[k]!;
    const dp = (px - bx) * nx + (pz - bz) * nz; // the player and the spot, off the ball's line
    const ds = (tx - bx) * nx + (tz - bz) * nz;
    const left = pr.t[k]! - now;
    if (abs(dp) >= DODGE && abs(ds) >= DODGE && dp * ds > 0) return;
    if (dp * ds < 0 && (abs(dp) + DODGE) / HOLD_RUN + HOLD_START < left - HOLD_GAP) return;
    const toSpot = ds >= 0 ? 1 : -1;
    const own = dp >= 0 ? 1 : -1;
    const side = abs(dp) < DODGE && (DODGE + abs(dp)) / HOLD_RUN + HOLD_START < left ? toSpot : own;
    const go = side * DODGE - dp;
    if (abs(go) / HOLD_RUN + HOLD_START * 0.5 > left) return;
    const hx = clamp(px + nx * go, p.minX, p.maxX);
    const hz = clamp(pz + nz * go, p.minZ, p.maxZ);
    const rest = sqrt((tx - hx) * (tx - hx) + (tz - hz) * (tz - hz));
    if (rest / HOLD_RUN + HOLD_START > contact - pr.t[k]!) return;
    this.holdX = hx;
    this.holdZ = hz;
    this.holdT = pr.t[k]! + HOLD_AFTER;
  }

  /**
   * How much harder than a routine ball this one is to time (multiplies the timing spread): pace, a ball
   * coming off the glass, a low ball. Hitting hard is how you force errors.
   */
  private difficulty(m: MatchSim, height: number, afterWall: boolean): number {
    const v = m.ball.vel;
    const speed = sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return 1 + 0.55 * clamp((speed - 12) / 14, 0, 1.6) + (afterWall ? AFTER_WALL : 0) + (height < 0.5 ? 0.3 : 0);
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
    this.volleying = false;
    this.conHeight = height;
    this.conDepth = depth;
    this.shot = SHOT_BANDEJA;
    if (this.bajada) {
      this.chooseBajada(m);
      return;
    }
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
    // A smash-loving style counts a little more of the court as smash range and smashes more of the rest anyway;
    // a defensive one less (the neutral style's smash 1 leaves both as measured).
    const kd = KILL_DEPTH * (0.92 + 0.08 * st.smash);
    const sd = smashDepth(m, depth, height);
    const kill = sd <= kd;
    // Inside the kill depth the shorter the landing the surer the kill: a lob that sits up close in is smashed, one
    // only just short enough is mostly played as a bandeja to keep the net (pros smash 26-36% of their overheads;
    // smashing 95% of everything inside the kill depth made it 49%).
    this.smash = kill ? r < min(0.95, (0.6 + 0.35 * this.level) * st.smash) * clamp((kd - sd) / KILL_SURE, 0, 1)
      : depth < 6.5 && height > 2.2 && r < max(0, 0.35 - 0.3 * this.level + 0.1 * (st.smash - 1));
    // Not a smash: the better players turn some into víboras (into the side glass, more pace than a bandeja).
    this.vibora = !this.smash && depth < 7 && m.aiRng.next() < (0.15 + 0.35 * this.level) * st.vibora;
    // Planned again at that overhead's own height (a bandeja is let drop to head height, a smash is met at full
    // reach): from the next tick.
    this.ohKind = this.smash ? OH_SMASH : this.vibora ? OH_VIBORA : OH_BANDEJA;
    if (this.overhead) this.planVersion = -1;
    if (m.doubles) m.intentUp[this.team] = 1; // keep the net
    this.chooseTarget(m);
  }

  /**
   * A bajada: struck down hard and flat off the glass (the smash shape, deep down the line or through the middle),
   * or placed deep into a corner like a bandeja; met at a bandeja's height as it drops (BAJADA_HARD). After a good
   * one the pair can take the net.
   */
  private chooseBajada(m: MatchSim): void {
    if (this.ohKind === OH_ANY) {
      this.smash = m.aiRng.next() < clamp(BAJADA_HARD * this.style.smash, 0, 0.95);
      this.vibora = false;
      this.ohKind = OH_BANDEJA;
      if (this.overhead) this.planVersion = -1;
      if (m.doubles) m.intentUp[this.team] = m.aiRng.next() < BAJADA_NET * this.style.net ? 1 : 0;
    }
    this.chooseTarget(m);
  }

  /** Already swinging: keep the shot, refresh the target only. */
  private retarget(m: MatchSim): void {
    this.shot = m.players[this.index]!.shot;
    if (this.contra) this.contraTarget(m, m.aiRng.next());
    else this.chooseTarget(m);
  }

  /** A contrapared's target: deep, with margin from the side glass (a defensive shot: get it back). */
  private contraTarget(m: MatchSim, r: number): void {
    const c = m.world.court;
    const spread = c.halfW - 1.4;
    this.targetX = clamp((r - 0.5) * 2 * spread * 0.7, -spread, spread);
    this.targetZ = -m.side(this.team) * (6.2 + 1.4 * m.aiRng.next());
  }

  private chooseShot(m: MatchSim, height: number, volley: boolean, depth: number): void {
    this.volleying = volley;
    this.conHeight = height;
    this.conDepth = depth;
    const opp = this.nearestOpponent(m);
    const r = m.aiRng.next();
    this.smash = false;
    this.vibora = false;
    this.chiquita = false;
    this.safe = false;
    this.punch = false;
    if (this.contra) {
      // Off our own back glass: a ground-stroke key (the sim makes it a contrapared).
      this.shot = SHOT_LOB;
      this.contraTarget(m, r);
      return;
    }
    if (!volley && this.tooHot(m, this.idealT)) {
      // No time for a stroke: reaction 140-190 ms, preparation 0.11 s at the very fastest, and the swing (review round
      // 5, the pro's #1: 29.6% of smashes were answered with a full stroke, lobs among them, within 0.5 s).
      this.shot = SHOT_SLICE;
      this.safe = true;
      this.chooseTarget(m);
      return;
    }
    // A ball at overhead height in front: an overhead, chosen as one (the sim turned a drive key's high ball into a
    // smash aimed like a drive: most of the AI's smashes, from 6.5 m, which the defenders blocked back).
    if (height >= m.players[this.index]!.tune.overheadHeight && depth < 7) {
      this.chooseOverhead(m, height, depth);
      return;
    }
    if (volley) this.volleyPlay(m, height, depth);
    else this.paceOf(m.aiRng.next());
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
    // Singles has the same fight for the net: in behind a short ball, or a low ball with the opponent deep; a volley
    // stays in. Nobody came in without this: the server was 7.6 m back at every return, volleys 3.7% of shots (28% in
    // doubles; review round 4, the pro's #6).
    const go = (0.4 + 0.6 * this.level) * st.net;
    const r2 = m.aiRng.next();
    this.approach = this.shot !== SHOT_LOB && (volley ? depth < 5 : r2 < (depth < APPROACH_DEPTH ? APPROACH_SHORT : abs(opp.pos.z) > 7 ? APPROACH_DEEP : 0) * go);
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
    } else if (height > 1.05 && depth < 5) {
      this.punch = r < right;
    } else this.paceOf(m.aiRng.next());
  }

  /** A contact at t would be a hard ball, this soon after the opponent's strike: it can only be blocked. */
  private tooHot(m: MatchSim, t: number): boolean {
    if (t - m.lastStrikeTime >= RUSH_T) return false;
    const pr = m.pred;
    for (let i = 0; i < pr.n; i++) {
      if (pr.t[i]! < t) continue;
      const vx = pr.vx[i]!, vy = pr.vy[i]!, vz = pr.vz[i]!;
      return vx * vx + vy * vy + vz * vz > RUSH_V * RUSH_V;
    }
    return false;
  }

  /** A slice's share of the slice-or-drive choices, tilted by the style's pace: a hitter drives flat, a defender
   * slices (the neutral style keeps `base`). */
  private sliceOf(base: number): number {
    return clamp(base * (1 - 0.6 * this.style.pace), 0.1, 0.9);
  }

  /** The style's pace on a ball with no call of its own: hit hard (power) or played safe (precision), from draw r. */
  private paceOf(r: number): void {
    const pace = this.style.pace;
    if (pace > 0) this.punch = r < PACE_SHARE * pace;
    else if (pace < 0) this.safe = r < -PACE_SHARE * pace;
  }

  /**
   * Doubles: against a pair at the net, lob them or keep it low at their feet; against a pair at the back,
   * drive and slice through the middle (a lob there only hands them a smash). At the net ourselves, volley.
   */
  private chooseDoublesShot(m: MatchSim, r: number, height: number, volley: boolean, depth: number): void {
    const up = this.opponentsUp(m);
    const st = this.style;
    // Weaker players choose worse: against a pair at the net they lob less and drive into the volleyers more, and
    // they take the net less (novices volley 15.5% of their shots, trained players 25.1%: Sánchez-Alcaraz et al.
    // 2021). At the top level both factors are 1.
    const lobSense = 0.5 + 0.5 * this.level;
    const netSense = 0.4 + 0.6 * this.level;
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
        // A drop volley is played down from above the tape, from close in. Off any ball it was the AI's finisher: struck
        // from 0.69 m, 0.26 a point, won 32% against the plain volley's 1% (review round 4, the pro's #2).
        const drop = up === 0 && height > DROP_HEIGHT && depth < DROP_DEPTH ? DROP_RATE * st.drop : 0;
        this.shot = r < drop ? SHOT_DROP : r < this.sliceOf(0.65) ? SHOT_SLICE : SHOT_DRIVE;
        // Pulled in by a short ball against a pair at the net: back out again unless already close in.
        go = (near || up < 2) && r2 >= NET_BACK * max(0, 1 - st.net) ? 1 : 0;
      }
    } else if (up === 2) {
      // Lob them (and take the net if it gets past), dip a chiquita at their feet, or keep it low; from the
      // back that is a defensive shot.
      const lob = min(0.9, 0.5 * st.lob * lobSense);
      const chiq = height > 0.4 && height < 1.4 ? min(0.6, 0.35 * st.drop) * (1 - lob) : 0;
      this.shot = r < lob ? SHOT_LOB : r < lob + chiq ? SHOT_TOPSPIN : r < lob + chiq + this.sliceOf(0.6) * (1 - lob - chiq) ? SHOT_SLICE : SHOT_DRIVE;
      this.chiquita = this.shot === SHOT_TOPSPIN;
      // A chiquita at their feet is the other way to the net (lobs are 60.6% of net takes, the rest mostly low balls
      // at the feet: Muñoz et al. 2017), taken as readily as the style likes the net.
      go = this.chiquita ? (r2 < CHIQ_NET * st.net * netSense ? 1 : 0) : this.shot !== SHOT_LOB && r2 < this.netPress(netSense) ? 1 : 0;
    } else if (up === 1) {
      const lob = min(0.9, 0.3 * st.lob * lobSense);
      const chiq = height > 0.4 && height < 1.4 ? min(0.4, 0.15 * st.drop) * (1 - lob) : 0;
      this.shot = r < lob ? SHOT_LOB : r < lob + chiq ? SHOT_TOPSPIN : r < lob + chiq + (1 - this.sliceOf(0.5)) * (1 - lob - chiq) ? SHOT_DRIVE : SHOT_SLICE;
      this.chiquita = this.shot === SHOT_TOPSPIN;
      go = this.shot !== SHOT_LOB && r2 < this.netPress(netSense) ? 1 : 0;
    } else {
      // Both back: work the ball through the middle; a short ball is the chance to come in.
      const lob = min(0.5, 0.05 * st.lob);
      this.shot = r < lob ? SHOT_LOB : r < 0.75 - this.sliceOf(0.25) ? SHOT_DRIVE : r < 0.75 ? SHOT_SLICE : SHOT_TOPSPIN;
      go = depth < 7.4 && r2 < 0.45 * st.net * netSense ? 1 : r2 < 0.12 * st.net * netSense ? 1 : 0;
    }
    m.intentUp[this.team] = go;
    this.lobStay = this.shot === SHOT_LOB && r2 < LOB_STAY * max(0, 1 - st.net);
  }

  /** How readily a net-loving style comes in behind a low ball from the back, with the opponents at the net (a neutral
   * or net-shy style leaves that to the lob and the chiquita). */
  private netPress(netSense: number): number {
    return NET_PRESS * max(0, this.style.net - 1) * netSense;
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
    // More room than the shot's scatter: 0.8 m inside the side glass at the top level against a sideways miss of p90
    // 1.3-1.4 m, and a fifth of singles points ended on the full into the side glass (review round 4, the pro's #5).
    const margin = (2.0 - 0.6 * this.level) * this.style.margin;
    const side = opp.pos.x > 0 ? -1 : 1;
    const spread = c.halfW - margin;
    this.targetX = clamp(side * spread * (0.35 + 0.65 * rng.next()) + rng.normal() * 0.6, -spread, spread);
    // Short of the far glass by room for an error: aimed 6.6-7.8 m out from the back of the court (8.6 m for a lob), a
    // ball reached that glass on the full on a small error, and a third of singles points ended so (review round 3,
    // the pro's #10: 35.6%).
    let depthT = this.shot === SHOT_LOB ? 7.0 + 0.8 * rng.next() : this.shot === SHOT_DROP ? 1.8 : 5.2 + 1.3 * rng.next();
    if (this.shot === SHOT_LOB) {
      depthT = min(depthT, c.halfL - 1.0 - 0.6 * (1 - this.level));
      this.targetX = clamp(lobX(m.players[this.index]!.pos.x, this.targetX), -spread, spread);
    }
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
    if (this.shot === SHOT_BANDEJA && this.bajada) {
      // A bajada from the back: deep with a margin from the glass (a full-pace ball from 9 m back runs long on a
      // small error), down the line or through the middle; placed ones deeper, into a corner.
      x = rng.next() < 0.6 ? (m.players[this.index]!.pos.x >= 0 ? 1 : -1) * spread * (0.4 + 0.4 * rng.next()) : (a.pos.x + b.pos.x) * 0.5;
      depth = this.smash ? 6.2 + 1.2 * rng.next() : 7.0 + 1.0 * rng.next();
    } else if (this.shot === SHOT_BANDEJA && this.vibora) {
      // Into the side glass, deep enough that it comes off low towards the back.
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.8 + 0.2 * rng.next());
      depth = 6.4 + 1.2 * rng.next();
    } else if (this.shot === SHOT_BANDEJA && this.smash) {
      // Flat and hard, mostly down the line (men 77.7%: Sánchez-Alcaraz et al. 2020), landing as short as a straight
      // line from the contact clears the tape with margin, so the bounce kicks up into the glass and can leave the
      // court (por tres) or come back over the net: the shortest landing the untouched human smash aims at.
      // Close in and high, a put-away for the side glass by the opponents' service line: steep enough that the
      // kick off the back glass carries it out over the side (por tres; the probe's out-of-court winners all came
      // from contacts inside 3.5 m landing 3.3-3.7 m out from the middle).
      const me = m.players[this.index]!;
      const putAway = this.conDepth < SMASH_X3_DEPTH && this.conHeight >= SMASH_X3_HEIGHT;
      x = putAway ? (me.pos.x >= 0 ? 1 : -1) * spread * (0.82 + 0.13 * rng.next())
        : rng.next() < 0.75 ? (me.pos.x >= 0 ? 1 : -1) * spread * (0.55 + 0.35 * rng.next()) : (a.pos.x + b.pos.x) * 0.5;
      depth = smashDepth(m, this.conDepth, this.conHeight) + (putAway ? 0.3 : 0.6) * rng.next();
    } else if (this.shot === SHOT_BANDEJA) {
      // Deep into a corner, so the ball sits down off the back glass.
      x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.5 + 0.4 * rng.next());
      depth = 8.0 + 0.8 * rng.next();
    } else if (this.shot === SHOT_LOB) {
      // Deep enough to get over and behind the net player, short of the back glass on the full: real lobs land
      // anywhere from about 5.5 m (good) to 8.6 m (excellent) from the net (Ramón-Llin et al. 2019).
      x = lobX(m.players[this.index]!.pos.x, (rng.next() < 0.5 ? -1 : 1) * spread * (0.3 + 0.5 * rng.next()));
      depth = min(8.2, c.halfL - 1.8 - 0.6 * (1 - this.level)) - 1.2 * rng.next();
    } else if (this.shot === SHOT_DROP) {
      x = (a.pos.x + b.pos.x) * 0.5 + rng.normal() * 1.2;
      depth = 1.8;
    } else if (this.chiquita) {
      // Dipping at the feet of a net player, or between the two.
      const net = abs(a.pos.z) < abs(b.pos.z) ? a : b;
      x = rng.next() < 0.5 ? (a.pos.x + b.pos.x) * 0.5 : net.pos.x;
      depth = 2.8 + 0.8 * rng.next();
    } else if (m.rally.isServe && m.doubles) {
      // The return: at the incoming server's feet, low and cross-court, as they run in to join the net player;
      // through the middle sometimes; down the line at the net player's feet rarely. Pros' flat returns go at the
      // server 71.9% of the time (Ramón-Llin et al. 2019); the old split put 60% of them on the net player's racket
      // (REVIEW.md round 3 #2).
      const srv = m.players[m.score.serverPlayer()]!;
      const mate = srv === a ? b : a;
      const r = rng.next();
      if (r < 0.72) { x = feetX(srv.pos.x, mate.pos.x); depth = 5.4 + 1.0 * rng.next(); }
      else if (r < 0.88) { x = (a.pos.x + b.pos.x) * 0.5; depth = 6.0 + 1.0 * rng.next(); }
      else { x = feetX(mate.pos.x, srv.pos.x); depth = abs(mate.pos.z) + 0.3 + 0.5 * rng.next(); }
    } else if (up === 2) {
      // Both at the net: low through the middle, at a player's feet, or (a volley) short and angled off the side
      // glass. "At the feet" lands beside the feet, inside the player towards the middle, so it is met low (a ball
      // aimed at the player's own x landing behind them went through them: 18% of winners hit a body, which the
      // pros' figures have no room for).
      const r = rng.next();
      const at = rng.next() < 0.5 ? a : b;
      if (r < 0.45) { x = (a.pos.x + b.pos.x) * 0.5; depth = 4.2 + 1.0 * rng.next(); }
      else if (r < 0.8 || !this.volleying) { x = feetX(at.pos.x, a.pos.x + b.pos.x - at.pos.x); depth = abs(at.pos.z) + 0.3 + 0.5 * rng.next(); }
      else { x = (rng.next() < 0.5 ? -1 : 1) * spread * (0.9 + 0.1 * rng.next()); depth = 4.4 + 1.2 * rng.next(); }
    } else if (up === 1) {
      const net = abs(a.pos.z) < 5 ? a : b;
      const back = net === a ? b : a;
      // At the net player's feet (beside them, as above), or behind them into the back player's corner.
      if (rng.next() < 0.5) { x = feetX(net.pos.x, back.pos.x); depth = abs(net.pos.z) + 0.3 + 0.5 * rng.next(); }
      else { x = back.pos.x > 0 ? -spread * 0.7 : spread * 0.7; depth = 7.2 + 1.0 * rng.next(); }
    } else if (this.volleying && this.conDepth < 5) {
      // A volley against two back works them: a high ball is put away short and angled, onto the side glass in
      // front of them; a low one is kept deep into a corner, with the middle as the safe way.
      const cross = this.standX > 0.5 ? -1 : this.standX < -0.5 ? 1 : rng.next() < 0.5 ? -1 : 1;
      const r = rng.next();
      // (shorter off a sitter, which is hit hard and flat: 63% of those lost went on the full into the glass, at 73 km/h;
      // short off the shoe tops, which can only be lifted and floats: they cleared the net by 1.20 m and landed 6.9 m
      // deep, as safe as a ball can be: review round 5, the pro's #2)
      const short = this.conHeight >= SITTER_H ? SITTER_SHORT : this.conHeight < SHOE_H ? SHOE_SHORT : 0;
      if (this.conHeight > VOLLEY_ANGLE_H && r < VOLLEY_ANGLE) { x = cross * spread * (0.55 + 0.2 * rng.next()); depth = 4.6 + 1.0 * rng.next(); }
      else if (r < 0.75) { x = (rng.next() < 0.68 ? cross : -cross) * spread * (0.35 + 0.4 * rng.next()); depth = 6.4 + 1.2 * rng.next() - short; }
      else { x = (a.pos.x + b.pos.x) * 0.5 + rng.normal() * 0.7; depth = 6.6 + 1.3 * rng.next() - short; }
    } else {
      // Both back: move them. Cross-court into the corner to open the line, down the line, or short into the side
      // glass; "por el medio" is one option among them. Aimed between them every time, the outer metre of the court
      // saw 1.6% of flat balls, and cross against line read 42 / 58 where WPT reads 57.5 / 42.5 (Mellado-Arbelo et al.
      // 2019; review round 4, the pro's #1).
      const cross = this.standX > 0.5 ? -1 : this.standX < -0.5 ? 1 : rng.next() < 0.5 ? -1 : 1;
      const r = rng.next();
      if (r < BACK_CROSS) { x = cross * spread * (0.4 + 0.42 * rng.next()); depth = 6.3 + 1.5 * rng.next(); }
      else if (r < BACK_CROSS + BACK_LINE) { x = -cross * spread * (0.4 + 0.42 * rng.next()); depth = 6.3 + 1.5 * rng.next(); }
      else { x = (a.pos.x + b.pos.x) * 0.5 + rng.normal() * 0.7; depth = 6.6 + 1.3 * rng.next(); }
    }
    this.targetX = clamp(x + rng.normal() * (0.5 - 0.3 * this.level), -spread, spread);
    this.targetZ = -s * depth;
  }
}

/** A ball against two back: shares going cross-court and down the line; the rest is through the middle. */
const BACK_CROSS = 0.6;
const BACK_LINE = 0.22;
/** A net volley against two back over VOLLEY_ANGLE_H (m) is put away on the angle VOLLEY_ANGLE of the time. */
const VOLLEY_ANGLE_H = 1.0;
const VOLLEY_ANGLE = 0.5;
/** Net volleys at or over SITTER_H (m) and under SHOE_H: the swing's spread (SimpleAi.motor), m taken off the depth. */
const SITTER_H = 0.95;
const SITTER_CONTROL = 2.2;
const SITTER_SHORT = 1.0;
const SHOE_H = 0.55;
const SHOE_CONTROL = 0.5;
const SHOE_SHORT = 1.6;
/** No full stroke at a ball this soon after the strike (s) and this fast at contact (m/s). */
const RUSH_T = 0.6;
const RUSH_V = 15;
/** Below this height (m) a ball off the glass can be taken at waist height, not over the shoulder. */
const OFF_GLASS_Y = 1.45;
const OFF_GLASS_OUT = 0.5;
/** The server's run in, and their speed through the third shot (m/s). */
const SERVE_RUN = 3.0;
const SERVE_ARRIVE = 2.0;
/** The line of a lob reaches the net at most this far from the middle: its height there clears the 3 m side fence. */
const LOB_NET_X = 2.2;

/** When the ball, off a wall on our half and out of the corner of it, is first at a height to take; CLIMBS if it reaches
 * a wall and stays above that, -1 if it reaches no wall. (A time, as planStand's `keep`.) */
function offGlassLow(pr: Prediction, side: number, halfL: number): number {
  let wall = false;
  for (let i = 0; i < pr.n; i++) {
    const b = pr.bounces[i]!;
    if (b > 1) break;
    if (b !== 1 || pr.walls[i]! === 0 || pr.z[i]! * side <= 0) continue;
    wall = true;
    if (pr.y[i]! < OFF_GLASS_Y && halfL - abs(pr.z[i]!) > OFF_GLASS_OUT) return pr.t[i]!;
  }
  return wall ? CLIMBS : -1;
}
const CLIMBS = -2;

/** A lob's landing x, kept so that its line crosses the net near the middle (the hitter at `from`). */
function lobX(from: number, x: number): number {
  return clamp(x, -2 * LOB_NET_X - from, 2 * LOB_NET_X - from);
}

/** "At the feet" of a player at x: FEET_SIDE m inside them, towards their partner at `mate` (a ball at the body is
 * a ball through it). */
function feetX(x: number, mate: number): number {
  return x + (mate > x ? FEET_SIDE : -FEET_SIDE);
}
const FEET_SIDE = 0.6;
/** hitOnTheWay's cautious run: the start late by ESCAPE_LAG (s), ESCAPE_ACCEL of the push, at most ESCAPE_TOP (m/s,
 * the backwards top speed). */
const ESCAPE_LAG = 0.1;
const ESCAPE_ACCEL = 0.8;
const ESCAPE_TOP = 4.3;
/** How far (m) from the ball's line a player not taking it keeps (body 0.22 + ball 0.033 + a margin). */
const DODGE = 0.55;
/** holdShort: how near the player's the ball must pass (m), the run it reckons with (m/s), the start-up (s), how far
 * ahead of the ball a crossing must be (s), how long after the ball's passing the wait ends (s). */
const HOLD_NEAR = 2.5;
const HOLD_RUN = 4.5;
const HOLD_START = 0.2;
const HOLD_GAP = 0.2;
const HOLD_AFTER = 0.05;

/**
 * A smash's landing depth (m from the net): the shortest at which a full-pace smash from the contact (`back` m from
 * the net, `h` high) clears the tape by SMASH_MARGIN, as the human's untouched smash aims (match.ts steerAim).
 */
function smashDepth(m: MatchSim, back: number, h: number): number {
  const c = m.world.court;
  return smashLanding(c.netHeightAt(0), back, h, SMASH_MARGIN, SMASH_MIN, c.halfL - 2.0);
}
const SMASH_MARGIN = 0.45;
/** A smash met this close (m from the net) and this high (m) is a put-away aimed for the side glass (por tres). */
const SMASH_X3_DEPTH = 4.5;
const SMASH_X3_HEIGHT = 2.2;
const SMASH_MIN = 3.2;
/** How long before an overhead's contact the racket starts up (s): real preparation takes about 0.52-0.54 s of footwork
 * (docs/research/serve-and-strokes-motion.md), and it was up only 0.36 s before the ball. */
const OH_PRESS = 0.75;
/** A smash landing this short (m from the net) kicks off the glass hard enough to be a winner. */
const KILL_DEPTH = 6.0;
/** How far (m) inside KILL_DEPTH the landing must be for the AI's full smash rate (less: a share of it). */
const KILL_SURE = 0.8;

/** The key that holds a shot: the overhead key for a bandeja/smash, else the shot's own key. */
function button(shot: number): number {
  return shot === SHOT_BANDEJA ? BTN_OVERHEAD : SHOT_BUTTONS[shot]!;
}
