// MatchSim: the whole deterministic match. step(inputs) advances one 120 Hz tick.
// Rendering, audio and UI read its state and its event ring; nothing outside the sim writes to it.
import { Ball, HIT_FLOOR, HIT_WALL, HIT_NET, HIT_NETCORD, LEFT_COURT, type BallWorld } from './ball/ball.ts';
import { Prediction } from './ball/predict.ts';
import { Rng } from './core/rng.ts';
import { DT, TEAM_NEAR } from './core/constants.ts';
import { Hasher } from './core/hash.ts';
import { abs, clamp, max, min, sqrt } from './core/smath.ts';
import { SURF_GLASS, WALL_SIDE_LEFT, WALL_SIDE_RIGHT } from './court/court.ts';
import { Score, SIDE_RIGHT, DEFAULT_FORMAT, EV_GAME, EV_SET, EV_MATCH, EV_CHANGE_ENDS, type MatchFormat } from './rules/score.ts';
import { Rally, R_POINT, R_FAULT, R_LET, R_NONE } from './rules/rally.ts';
import { Player, SW_IDLE, SW_CHARGE, SW_COMMITTED, SW_RECOVER, DEFAULT_TUNING } from './player/player.ts';
import {
  ShotSolver, strike, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH,
  SHOT_BANDEJA, SHOT_VOLLEY, MOD_NONE, MOD_POWER, MOD_PRECISION, type ShotRequest, type ShotResult,
} from './contact/shots.ts';
import { gradeTiming, gradeQuality, G_TOO_EARLY, G_TOO_LATE, type TimingWindows } from './contact/timing.ts';
import { findWindows, makeWindows, type ContactWindow } from './contact/windows.ts';
import { InputFrame, SHOT_BUTTONS, BTN_POWER, BTN_PRECISION } from './input.ts';
import { SimpleAi } from './ai/simpleAi.ts';
import { makeWorld, type WorldOptions } from './setup.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };

// Phases
export const PH_SETUP = 0;
export const PH_TOSS = 1;
export const PH_RALLY = 2;
export const PH_DEAD = 3;
export const PH_OVER = 4;

// Presentation events
export const E_HIT = 1;
export const E_FLOOR = 2;
export const E_WALL = 3;
export const E_NET = 4;
export const E_POINT = 5;
export const E_FAULT = 6;
export const E_LET = 7;
export const E_GAME = 8;
export const E_SET = 9;
export const E_MATCH = 10;
export const E_WHIFF = 11;
export const E_SPLIT = 12;
export const E_TOSS = 13;
export const E_EXIT = 14;
export const E_ENDS = 15;
export const E_SWING = 16;

export interface MatchEvent {
  seq: number;
  kind: number;
  time: number;
  team: number;
  /** Kind-specific: shot type / surface / reason. */
  a: number;
  /** Kind-specific: timing grade / wall id / serve number. */
  b: number;
  /** Kind-specific: speed / timing delta. */
  c: number;
  x: number;
  y: number;
  z: number;
}

const EVENT_RING = 64;

export interface MatchConfig {
  seed: number;
  world?: WorldOptions;
  format?: MatchFormat;
  /** Which teams are controlled by a human (input frames supplied). */
  human: [boolean, boolean];
  /** AI skill 0..1 per team. */
  aiLevel?: [number, number];
  /** Widens timing windows (accessibility). */
  timingScale?: number;
  /** Positioning assist strength 0..1 for human players. */
  assist?: number;
  firstServer?: number;
}

const TIMING: TimingWindows = tuning.timing;
const SERVE_HAND_HEIGHT = 0.95;

export class MatchSim {
  readonly cfg: MatchConfig;
  readonly world: BallWorld;
  readonly solver: ShotSolver;
  readonly score: Score;
  readonly rally = new Rally();
  readonly ball = new Ball();
  readonly players: [Player, Player];
  readonly pred = new Prediction();
  readonly rng: Rng;
  readonly aiRng: Rng;
  readonly ai: [SimpleAi | null, SimpleAi | null];
  readonly aiFrames: [InputFrame, InputFrame] = [new InputFrame(), new InputFrame()];

  tick = 0;
  time = 0;
  phase = PH_SETUP;
  phaseUntil = 0;
  serveNo = 1;
  tossIdeal = 0;
  tossEnd = 0;
  /** Serve target box for the current point. */
  readonly box = { x0: 0, x1: 0, z0: 0, z1: 0 };
  /** Last strike: for body-hit grace and presentation. */
  lastStrikeTeam = -1;
  lastStrikeTime = -10;

  // Previous-tick state for render interpolation.
  readonly prevBall = { x: 0, y: 0, z: 0 };
  readonly prevPlayers = [{ x: 0, z: 0 }, { x: 0, z: 0 }];

  readonly events: MatchEvent[] = [];
  eventSeq = 0;

  private readonly windows = makeWindows();
  private readonly req: ShotRequest = {
    shot: 0, mod: 0, targetX: 0, targetZ: 0, quality: 1, timingDelta: 0, handSide: 1, moving: 0, stretch: 0, power: 1, control: 1,
  };
  private readonly res: ShotResult = { reachable: true, speed: 0, idealX: 0, idealZ: 0 };
  /** Aim captured at release, per team: relative (-1..1) or absolute. */
  private readonly aim = [
    { abs: false, x: 0, y: 0, tx: 0, tz: 0 },
    { abs: false, x: 0, y: 0, tx: 0, tz: 0 },
  ];

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.world = makeWorld(cfg.world);
    this.solver = new ShotSolver(this.world);
    this.score = new Score(cfg.format ?? DEFAULT_FORMAT, cfg.firstServer ?? 0);
    this.rng = new Rng(cfg.seed);
    this.aiRng = new Rng(cfg.seed ^ 0x5bd1e995);
    this.players = [new Player(0, DEFAULT_TUNING), new Player(1, DEFAULT_TUNING)];
    const lv = cfg.aiLevel ?? [0.55, 0.55];
    this.ai = [cfg.human[0] ? null : new SimpleAi(0, lv[0]), cfg.human[1] ? null : new SimpleAi(1, lv[1])];
    this.rally.outOfCourtPlay = false;
    for (let i = 0; i < EVENT_RING; i++) {
      this.events.push({ seq: -1, kind: 0, time: 0, team: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0 });
    }
    this.startPoint();
  }

  /** Half of the court team plays this game: +1 = z > 0. */
  side(team: number): number {
    const base = team === TEAM_NEAR ? 1 : -1;
    return this.score.ends === 0 ? base : -base;
  }

  // ---- events --------------------------------------------------------------------------------

  emit(kind: number, team: number, a = 0, b = 0, c = 0, x = 0, y = 0, z = 0): void {
    const e = this.events[this.eventSeq % EVENT_RING]!;
    e.seq = this.eventSeq++;
    e.kind = kind;
    e.time = this.time;
    e.team = team;
    e.a = a; e.b = b; e.c = c;
    e.x = x; e.y = y; e.z = z;
  }

  // ---- point setup ---------------------------------------------------------------------------

  private startPoint(): void {
    const c = this.world.court;
    const sc = this.score;
    const sTeam = sc.serverTeam();
    const rTeam = 1 - sTeam;
    for (let t = 0; t < 2; t++) this.players[t]!.setHalf(this.side(t), c.halfW, c.halfL);
    if (sc.isDecidingPoint() && sc.decidingSide < 0) {
      // Receivers choose the side for the golden/star point. Human receivers default to the right for now.
      sc.decidingSide = this.ai[rTeam] ? (this.aiRng.next() < 0.5 ? 0 : 1) : SIDE_RIGHT;
    }
    const ss = this.side(sTeam);
    const sideSign = (sc.serveSide() === SIDE_RIGHT ? 1 : -1) * ss; // server's right is +x for the near half
    const sl = c.def.serviceLineFromNet;
    const server = this.players[sTeam]!;
    const recv = this.players[rTeam]!;
    server.pos.set(sideSign * c.halfW * 0.42, 0, ss * (sl + 0.75));
    server.vel.set(0, 0, 0);
    server.facing = ss > 0 ? 0 : Math.PI;
    recv.pos.set(-sideSign * c.halfW * 0.5, 0, -ss * (c.halfL - 1.4));
    recv.vel.set(0, 0, 0);
    recv.facing = ss > 0 ? Math.PI : 0;
    for (const p of this.players) {
      p.swing = SW_IDLE;
      p.grade = -1;
    }
    // Diagonal service box on the receivers' half.
    this.box.x0 = sideSign > 0 ? -c.halfW : 0;
    this.box.x1 = sideSign > 0 ? 0 : c.halfW;
    this.box.z0 = min(0, -ss * sl);
    this.box.z1 = max(0, -ss * sl);
    this.rally.reset();
    const rb = this.rally.box;
    rb.x0 = this.box.x0; rb.x1 = this.box.x1; rb.z0 = this.box.z0; rb.z1 = this.box.z1;
    this.rally.lineTolerance = c.def.lineWidth / 2;
    this.placeBallInHand();
    this.phase = PH_SETUP;
    this.phaseUntil = this.time + 0.5;
    for (const a of this.ai) a?.reset();
  }

  private placeBallInHand(): void {
    const s = this.score.serverTeam();
    const p = this.players[s]!;
    const ss = this.side(s);
    this.ball.pos.set(p.pos.x + ss * 0.45 * p.handed, SERVE_HAND_HEIGHT, p.pos.z - ss * 0.3);
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.ball.outside = false;
    this.ball.rolling = false;
  }

  // ---- main step -----------------------------------------------------------------------------

  /** Advance one tick. `inputs[team]` is the human's frame (ignored for AI teams). */
  step(inputs: ReadonlyArray<InputFrame | null>): void {
    const t0 = this.time;
    const t1 = t0 + DT;
    this.prevBall.x = this.ball.pos.x;
    this.prevBall.y = this.ball.pos.y;
    this.prevBall.z = this.ball.pos.z;
    for (let i = 0; i < 2; i++) {
      this.prevPlayers[i]!.x = this.players[i]!.pos.x;
      this.prevPlayers[i]!.z = this.players[i]!.pos.z;
    }

    if (this.phase === PH_OVER) {
      this.time = t1;
      this.tick++;
      return;
    }

    // Inputs (AI writes its own frames).
    for (let team = 0; team < 2; team++) {
      const ai = this.ai[team];
      let f: InputFrame | null;
      if (ai) {
        f = this.aiFrames[team]!;
        f.clear();
        ai.think(this, f, t0, t1);
      } else {
        f = inputs[team] ?? null;
      }
      if (f) this.applyInput(team, f, t0);
    }

    // Phase logic.
    if (this.phase === PH_SETUP) {
      this.placeBallInHand();
    } else {
      // Strikes inside this tick split the ball step at the exact contact time.
      let tc = t1;
      let who = -1;
      for (let team = 0; team < 2; team++) {
        const p = this.players[team]!;
        if (p.swing === SW_COMMITTED && p.contactTime < tc) { tc = p.contactTime; who = team; }
      }
      if (who >= 0) {
        const dt1 = max(0, tc - t0);
        if (dt1 > 1e-9) this.stepBall(dt1, t0);
        this.time = t0 + dt1;
        this.contact(who);
        const dt2 = t1 - this.time;
        if (dt2 > 1e-9) this.stepBall(dt2, this.time);
      } else {
        this.stepBall(DT, t0);
      }
      if (this.phase === PH_TOSS && this.ball.pos.y < 0.12 && this.tossBounces >= 2 && !this.rally.over) {
        this.rally.onServeMissed();
      }
      if (this.phase === PH_RALLY || this.phase === PH_TOSS) this.checkBodies();
    }

    this.time = t1;
    this.tick++;

    // Swing housekeeping.
    for (const p of this.players) {
      if (p.swing === SW_RECOVER && this.time >= p.recoverUntil) p.swing = SW_IDLE;
    }

    if (this.rally.result !== R_NONE && (this.phase === PH_RALLY || this.phase === PH_TOSS)) this.endRally();
    if (this.phase === PH_DEAD && this.time >= this.phaseUntil) this.afterDead();
  }

  private tossBounces = 0;

  private stepBall(dt: number, tStart: number): void {
    const b = this.ball;
    b.step(this.world, dt, this.rng);
    let recompute = false;
    for (let i = 0; i < b.eventCount; i++) {
      const e = b.events[i]!;
      const t = tStart + e.t;
      switch (e.kind) {
        case HIT_FLOOR:
          if (this.phase === PH_TOSS && this.rally.hitter < 0) this.tossBounces++;
          else this.rally.onFloor(e.x, e.z);
          this.emitAt(E_FLOOR, t, e.surface, 0, e.speed, e.x, e.y, e.z);
          recompute = true;
          break;
        case HIT_WALL: {
          const wallSide = e.wall === WALL_SIDE_LEFT || e.wall === WALL_SIDE_RIGHT ? (e.z >= 0 ? 1 : -1) : e.z > 0 ? 1 : -1;
          this.rally.onWall(e.surface, wallSide);
          this.emitAt(E_WALL, t, e.surface, e.wall, e.speed, e.x, e.y, e.z);
          recompute = true;
          break;
        }
        case HIT_NET:
        case HIT_NETCORD:
          this.rally.onNet();
          this.emitAt(E_NET, t, e.kind === HIT_NETCORD ? 1 : 0, 0, e.speed, e.x, e.y, e.z);
          recompute = true;
          break;
        case LEFT_COURT: {
          const c = this.world.court;
          const throughOpening = abs(e.z) < c.halfL && e.y < c.def.openings.height;
          this.rally.onExit(throughOpening);
          this.emitAt(E_EXIT, t, throughOpening ? 1 : 0, e.wall, 0, e.x, e.y, e.z);
          break;
        }
      }
    }
    this.rally.onBallZ(b.pos.z);
    if (recompute && (this.phase === PH_RALLY || this.phase === PH_TOSS)) {
      this.pred.compute(this.world, b, tStart + dt, this.phase === PH_RALLY ? this.rally.bounces : this.tossBounces);
    }
  }

  private emitAt(kind: number, t: number, a: number, b: number, c: number, x: number, y: number, z: number): void {
    const save = this.time;
    this.time = t;
    this.emit(kind, -1, a, b, c, x, y, z);
    this.time = save;
  }

  // ---- input and swings ----------------------------------------------------------------------

  private applyInput(team: number, f: InputFrame, t0: number): void {
    const p = this.players[team]!;
    const s = this.side(team);
    // Movement: player-relative to world. Forward is towards the net.
    let dx = f.moveX * s;
    let dz = -f.moveY * s;
    const isServerSetup = (this.phase === PH_SETUP || this.phase === PH_TOSS) && team === this.score.serverTeam();
    if (isServerSetup) { dx = 0; dz = 0; } // the server stays put; the keys aim the serve
    if (!this.ai[team] && (p.swing === SW_CHARGE || p.swing === SW_COMMITTED) && this.phase === PH_RALLY) {
      this.assist(p, f, s);
      dx += this.assistX;
      dz += this.assistZ;
    }

    // Button events in time order.
    for (let i = 0; i < f.evCount; i++) {
      const e = f.ev[i]!;
      const shot = SHOT_BUTTONS.indexOf(e.button as never);
      if (shot < 0) continue;
      if (e.press) this.press(team, shot, max(e.t, t0));
      else if (p.swing === SW_CHARGE && p.shot === shot) this.releaseSwing(team, max(e.t, t0), f);
    }
    // Safety: a swing held far too long releases itself.
    if (p.swing === SW_CHARGE && t0 - p.chargeStart > 3) this.releaseSwing(team, t0, f);

    if (!isServerSetup && this.phase !== PH_DEAD) p.move(dx, dz, DT, t0);
    else if (this.phase === PH_DEAD) p.move(0, 0, DT, t0);

    // Face the ball while preparing, otherwise the direction of travel / the net.
    const b = this.ball.pos;
    p.faceTowards(b.x, b.z, 7, DT);
  }

  private assistX = 0;
  private assistZ = 0;

  /** Light pull towards a good hitting position for the best upcoming window. */
  private assist(p: Player, f: InputFrame, s: number): void {
    this.assistX = 0;
    this.assistZ = 0;
    const k = this.cfg.assist ?? p.tune.positioningAssist;
    if (k <= 0 || this.pred.n === 0) return;
    let best = -1;
    let bestD = 1e9;
    const pr = this.pred;
    for (let i = 0; i < pr.n; i++) {
      if (pr.t[i]! < this.time || pr.t[i]! > this.time + 1.6) continue;
      if (pr.z[i]! * s <= 0.05 || pr.bounces[i]! > 1 || pr.y[i]! < 0.4 || pr.y[i]! > 2.4) continue;
      const dx = pr.x[i]! - p.pos.x;
      const dz = pr.z[i]! - p.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    const hand = (pr.x[best]! - p.pos.x) * s >= 0 ? 1 : -1;
    const sx = pr.x[best]! - s * hand * p.tune.reachComfort;
    const sz = pr.z[best]! + s * 0.1;
    const dx = sx - p.pos.x;
    const dz = sz - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    if (d < 0.05) return;
    const pushing = abs(f.moveX) + abs(f.moveY) > 0.1 ? 0.5 : 1;
    const g = k * pushing * min(1, d / 0.6);
    this.assistX = (dx / d) * g;
    this.assistZ = (dz / d) * g;
  }

  private press(team: number, shot: number, t: number): void {
    const p = this.players[team]!;
    if (p.swing !== SW_IDLE) return;
    if (this.phase === PH_SETUP) {
      if (team !== this.score.serverTeam() || t < this.phaseUntil) return;
      // Drop the ball for the serve.
      this.phase = PH_TOSS;
      this.tossBounces = 0;
      this.placeBallInHand();
      this.ball.vel.set(0, -0.3, 0);
      this.pred.compute(this.world, this.ball, t, 0, 2);
      this.computeTossIdeal();
      this.emit(E_TOSS, team);
    } else if (this.phase === PH_DEAD || this.phase === PH_OVER) {
      return;
    }
    p.swing = SW_CHARGE;
    p.shot = shot;
    p.chargeStart = t;
    p.grade = -1;
  }

  private computeTossIdeal(): void {
    const pr = this.pred;
    let first = -1;
    let apex = -1;
    for (let i = 0; i < pr.n; i++) {
      if (first < 0) {
        if (pr.bounces[i]! >= 1) first = i;
        continue;
      }
      if (pr.bounces[i]! >= 2) { this.tossEnd = pr.t[i]!; break; }
      if (apex < 0 || pr.y[i]! > pr.y[apex]!) apex = i;
      this.tossEnd = pr.t[i]!;
    }
    this.tossIdeal = apex >= 0 ? pr.t[apex]! + 0.04 : this.time + 0.5;
  }

  private releaseSwing(team: number, t: number, f: InputFrame): void {
    const p = this.players[team]!;
    p.release = t;
    p.mod = (f.held & BTN_POWER) !== 0 ? MOD_POWER : (f.held & BTN_PRECISION) !== 0 ? MOD_PRECISION : MOD_NONE;
    const a = this.aim[team]!;
    a.abs = f.aimAbs;
    a.x = f.moveX;
    a.y = f.moveY;
    a.tx = f.aimTX;
    a.tz = f.aimTZ;
    const scale = this.cfg.timingScale ?? 1;

    if (this.phase === PH_TOSS && team === this.score.serverTeam() && this.rally.hitter < 0) {
      const delta = t - this.tossIdeal;
      p.timingDelta = delta;
      p.grade = gradeTiming(delta, TIMING, scale);
      if (abs(delta) > TIMING.miss * scale) {
        this.whiff(team, t);
        return;
      }
      p.contactTime = clamp(max(t, this.tossIdeal), t, this.tossEnd - 0.02);
      p.swing = SW_COMMITTED;
      this.emit(E_SWING, team, p.shot, p.grade, delta);
      return;
    }

    // Rally: judge against the window whose ideal moment is nearest the release.
    const s = this.side(team);
    const mustBounce = this.rally.isServe;
    const n = findWindows(this.pred, p.pos.x, p.pos.z, s, mustBounce, 1, p.tune, this.windows, this.time - 0.3);
    let w: ContactWindow | null = null;
    for (let i = 0; i < n; i++) {
      const c = this.windows[i]!;
      if (t > c.end + TIMING.miss * scale) continue;
      if (!w || abs(t - c.ideal) < abs(t - w.ideal)) w = c;
    }
    if (!w || this.rally.hitter === team) {
      this.whiff(team, t);
      return;
    }
    const delta = t - w.ideal;
    p.timingDelta = delta;
    p.grade = gradeTiming(delta, TIMING, scale);
    if (abs(delta) > TIMING.miss * scale) {
      this.whiff(team, t);
      return;
    }
    p.contactTime = delta < 0 ? w.ideal : max(t, w.ideal);
    if (p.contactTime < this.time) p.contactTime = this.time;
    p.swing = SW_COMMITTED;
    this.emit(E_SWING, team, p.shot, p.grade, delta);
  }

  private whiff(team: number, t: number): void {
    const p = this.players[team]!;
    p.swing = SW_RECOVER;
    p.recoverUntil = t + p.tune.recoverTime;
    p.lastContactTime = t;
    if (p.grade < 0) p.grade = p.timingDelta < 0 ? G_TOO_EARLY : G_TOO_LATE;
    this.emit(E_WHIFF, team, p.shot, p.grade, p.timingDelta);
  }

  /** The committed swing reaches its contact time: connect if the ball is really there. */
  private contact(team: number): void {
    const p = this.players[team]!;
    const b = this.ball;
    const s = this.side(team);
    const serving = this.phase === PH_TOSS && team === this.score.serverTeam() && this.rally.hitter < 0;
    const dx = b.pos.x - p.pos.x;
    const dz = b.pos.z - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    const t = p.tune;
    const legal = serving
      ? this.tossBounces === 1
      : b.pos.z * s > 0 && this.rally.hitter !== team && this.rally.bounces <= 1 && !(this.rally.isServe && this.rally.bounces === 0);
    if (!legal || d > t.reachMax + 0.25 || b.pos.y < t.contactMinHeight * 0.5 || b.pos.y > t.contactMaxHeight + 0.15 || this.rally.over) {
      if (serving && this.tossBounces !== 1) this.rally.onServeMissed();
      this.whiff(team, this.time);
      return;
    }

    // Which shot actually comes out: overheads and volleys are picked from the situation.
    let shot = p.shot;
    if (serving) shot = SHOT_SERVE;
    else if (b.pos.y >= t.overheadHeight && shot !== SHOT_LOB && shot !== SHOT_DROP) shot = shot === SHOT_SLICE ? SHOT_BANDEJA : SHOT_SMASH;
    else if (this.rally.bounces === 0 && (shot === SHOT_DRIVE || shot === SHOT_SLICE)) shot = SHOT_VOLLEY;

    // Target.
    const c = this.world.court;
    const a = this.aim[team]!;
    const r = this.req;
    if (serving) {
      const bx = this.box;
      const cx = (bx.x0 + bx.x1) * 0.5;
      const half = (bx.x1 - bx.x0) * 0.5;
      const depthFrac = clamp(0.8 + 0.12 * a.y, 0.45, 0.94);
      r.targetX = a.abs ? clamp(a.tx, bx.x0 + 0.15, bx.x1 - 0.15) : cx + s * a.x * half * 0.7;
      r.targetZ = a.abs ? clamp(a.tz, bx.z0 + 0.3, bx.z1 - 0.15) : -s * c.def.serviceLineFromNet * depthFrac;
    } else if (a.abs) {
      r.targetX = clamp(a.tx, -c.halfW + 0.2, c.halfW - 0.2);
      r.targetZ = -s * clamp(abs(a.tz), 0.6, c.halfL - 0.3);
    } else {
      const shape = this.solverDepth(shot);
      r.targetX = clamp(s * a.x * (c.halfW - 0.9), -c.halfW + 0.5, c.halfW - 0.5);
      r.targetZ = -s * clamp(shape + 0.16 * a.y, 0.1, 0.96) * c.halfL;
    }

    // Serve spin follows the key: slice key = slice serve, topspin key = kick, drive = flat.
    r.shot = shot;
    r.mod = p.mod;
    r.quality = gradeQuality(p.grade);
    r.timingDelta = p.timingDelta;
    r.handSide = dx * s * p.handed >= 0 ? 1 : -1;
    r.moving = clamp(p.speed() / t.maxSpeed, 0, 1);
    r.stretch = clamp((d - t.reachComfort) / (t.reachMax - t.reachComfort), 0, 1);
    r.power = 1;
    r.control = 1;
    const contactY = b.pos.y;
    strike(this.solver, b, r, this.rng, this.res);
    if (serving) {
      const keySpin = p.shot === SHOT_SLICE ? 1 : p.shot === SHOT_TOPSPIN ? -0.9 : p.shot === SHOT_DRIVE ? 0.15 : 1;
      b.spin.scale(keySpin);
    }

    p.swing = SW_RECOVER;
    p.recoverUntil = this.time + t.recoverTime;
    p.lastContact.copy(b.pos);
    p.lastContactTime = this.time;
    this.lastStrikeTeam = team;
    this.lastStrikeTime = this.time;

    if (serving) {
      this.rally.onStrike(team, s, true, contactY, t.waistHeight);
      this.phase = PH_RALLY;
    } else {
      this.rally.onStrike(team, s, false);
    }
    this.emit(E_HIT, team, shot, p.grade, this.res.speed, b.pos.x, b.pos.y, b.pos.z);
    this.pred.compute(this.world, b, this.time, 0);
    // The opponent split-steps as the ball is struck.
    const opp = this.players[1 - team]!;
    if (opp.trySplitStep(this.time)) this.emit(E_SPLIT, 1 - team);
    for (const ai of this.ai) ai?.onStrike(this, team);
  }

  private solverDepth(shot: number): number {
    switch (shot) {
      case SHOT_DRIVE: return 0.72;
      case SHOT_TOPSPIN: return 0.78;
      case SHOT_SLICE: return 0.7;
      case SHOT_LOB: return 0.9;
      case SHOT_DROP: return 0.2;
      case SHOT_SMASH: return 0.75;
      case SHOT_BANDEJA: return 0.86;
      case SHOT_VOLLEY: return 0.7;
      default: return 0.75;
    }
  }

  /** Ball touching a player's body ends the point. */
  private checkBodies(): void {
    const b = this.ball;
    if (this.rally.hitter < 0 || this.rally.over || b.outside) return;
    for (let team = 0; team < 2; team++) {
      if (team === this.lastStrikeTeam && this.time - this.lastStrikeTime < 0.3) continue;
      const p = this.players[team]!;
      if (b.pos.y > p.tune.height) continue;
      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const rr = p.tune.bodyRadius + this.world.spec.radius;
      if (dx * dx + dz * dz < rr * rr) {
        // A committed swing about to connect wins over the body.
        if (p.swing === SW_COMMITTED && p.contactTime - this.time < 0.05) continue;
        this.rally.onBody(team);
        return;
      }
    }
  }

  // ---- end of rally --------------------------------------------------------------------------

  private pendingPointWinner = -1;

  private endRally(): void {
    const r = this.rally;
    this.phase = PH_DEAD;
    this.pendingPointWinner = -1;
    if (r.result === R_POINT) {
      this.pendingPointWinner = r.winner;
      this.emit(E_POINT, r.winner, r.why, this.serveNo);
      this.phaseUntil = this.time + 1.7;
    } else if (r.result === R_FAULT) {
      if (this.serveNo === 2) {
        this.pendingPointWinner = 1 - this.score.serverTeam();
        this.emit(E_FAULT, this.score.serverTeam(), r.why, 2);
        this.phaseUntil = this.time + 1.7;
      } else {
        this.emit(E_FAULT, this.score.serverTeam(), r.why, 1);
        this.phaseUntil = this.time + 1.1;
      }
    } else if (r.result === R_LET) {
      this.emit(E_LET, this.score.serverTeam(), r.why, this.serveNo);
      this.phaseUntil = this.time + 1.1;
    }
    for (const p of this.players) if (p.swing === SW_CHARGE || p.swing === SW_COMMITTED) p.swing = SW_IDLE;
  }

  private afterDead(): void {
    const r = this.rally;
    if (this.pendingPointWinner >= 0) {
      const ev = this.score.pointWon(this.pendingPointWinner);
      this.serveNo = 1;
      if (ev & EV_GAME) this.emit(E_GAME, this.pendingPointWinner);
      if (ev & EV_SET) this.emit(E_SET, this.pendingPointWinner);
      if (ev & EV_CHANGE_ENDS) this.emit(E_ENDS, -1);
      if (ev & EV_MATCH) {
        this.emit(E_MATCH, this.pendingPointWinner);
        this.phase = PH_OVER;
        return;
      }
    } else if (r.result === R_FAULT) {
      this.serveNo = 2;
    }
    // A let replays the same serve number.
    this.startPoint();
  }

  // ---- queries for presentation --------------------------------------------------------------

  /** Contact windows for a team's player right now (timing meter, assists). */
  windowsFor(team: number, out: ContactWindow[]): number {
    const p = this.players[team]!;
    if (this.phase === PH_TOSS && team === this.score.serverTeam()) {
      const w = out[0]!;
      w.start = this.tossIdeal - 0.2;
      w.end = this.tossEnd;
      w.ideal = this.tossIdeal;
      return 1;
    }
    if (this.phase !== PH_RALLY || this.rally.hitter === team) return 0;
    return findWindows(this.pred, p.pos.x, p.pos.z, this.side(team), this.rally.isServe, 1, p.tune, out, this.time);
  }

  /** Fingerprint of the full sim state (determinism checks). */
  hash(): number {
    const h = new Hasher();
    const b = this.ball;
    h.num(this.tick).num(this.time).num(this.phase).num(this.serveNo);
    h.num(b.pos.x).num(b.pos.y).num(b.pos.z).num(b.vel.x).num(b.vel.y).num(b.vel.z).num(b.spin.x).num(b.spin.y).num(b.spin.z);
    for (const p of this.players) h.num(p.pos.x).num(p.pos.z).num(p.vel.x).num(p.vel.z).num(p.swing).num(p.contactTime);
    for (let i = 0; i < 4; i++) h.num(this.rng.s[i]!).num(this.aiRng.s[i]!);
    const st: number[] = [];
    this.score.writeState(st);
    for (const v of st) h.num(v);
    return h.h;
  }
}

export { SURF_GLASS, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH, SHOT_BANDEJA, SHOT_VOLLEY };
export { R_FAULT, R_LET, R_POINT };
