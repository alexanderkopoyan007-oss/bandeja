// MatchSim: the whole deterministic match. step(inputs) advances one 120 Hz tick.
// Rendering, audio and UI read its state and its event ring; nothing outside the sim writes to it.
import { Ball, HIT_FLOOR, HIT_WALL, HIT_NET, HIT_NETCORD, HIT_POST, LEFT_COURT, type BallWorld } from './ball/ball.ts';
import { Prediction, PF_FLOOR, PF_WALL } from './ball/predict.ts';
import { Rng } from './core/rng.ts';
import { DT, TEAM_NEAR } from './core/constants.ts';
import { Hasher } from './core/hash.ts';
import { abs, clamp, max, min, sqrt } from './core/smath.ts';
import { SURF_GLASS, WALL_SIDE_LEFT, WALL_SIDE_RIGHT } from './court/court.ts';
import { Score, SIDE_RIGHT, SIDE_LEFT, DEFAULT_FORMAT, EV_GAME, EV_SET, EV_MATCH, EV_CHANGE_ENDS, type MatchFormat } from './rules/score.ts';
import { Rally, R_POINT, R_FAULT, R_LET, R_NONE } from './rules/rally.ts';
import { Player, SW_IDLE, SW_CHARGE, SW_COMMITTED, SW_RECOVER, DEFAULT_TUNING } from './player/player.ts';
import {
  ShotSolver, strike, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH,
  SHOT_BANDEJA, SHOT_VOLLEY, SHOT_VIBORA, SHOT_CHIQUITA, MOD_NONE, MOD_POWER, MOD_PRECISION, type ShotRequest, type ShotResult,
} from './contact/shots.ts';
import { gradeTiming, gradeQuality, G_TOO_EARLY, G_TOO_LATE, type TimingWindows } from './contact/timing.ts';
import { findWindows, makeWindows, type ContactWindow } from './contact/windows.ts';
import { InputFrame, SHOT_BUTTONS, BTN_POWER, BTN_PRECISION, BTN_OVERHEAD } from './input.ts';
import { makeStandPlan, planStand, type StandPlan } from './player/positioning.ts';
import { formationSpot, type Spot } from './player/formation.ts';
import { styleOf } from './ai/styles.ts';
import { SimpleAi } from './ai/simpleAi.ts';
import { makeWorld, makeNetCloth, type WorldOptions } from './setup.ts';
import type { NetCloth } from './court/netCloth.ts';
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
  /** Player number for player events (swing, hit, whiff, split, toss), else -1. */
  player: number;
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
  /** Two players a side. Players are numbered team + 2 * slot: 0 and 1 face each other, 2 and 3 are partners. */
  doubles?: boolean;
  /** Which players are controlled by a human (input frames supplied), one entry per player. */
  human: boolean[];
  /** AI skill 0..1 per team. */
  aiLevel?: [number, number];
  /** AI playing style per player (keys of data/ai.json); missing entries play the neutral default. */
  aiStyle?: string[];
  /** Left-handed players, by player number. */
  lefty?: boolean[];
  /** Widens timing windows (accessibility). */
  timingScale?: number;
  /** Positioning assist strength 0..1 for human players. */
  assist?: number;
  /** Assisted timing: a swing still held at the right moment goes off by itself (graded Good). */
  autoTiming?: boolean;
  firstServer?: number;
}

const TIMING: TimingWindows = tuning.timing;
const SERVE_HAND_HEIGHT = 0.95;
/** How fast the keys move the aim target (m/s across, m/s in depth). */
const AIM_SPEED_X = 11;
const AIM_SPEED_Z = 9;
/** Default aim depth (fraction of the half) for the overhead key: deep for a bandeja, mid-court for a smash. */
const OVERHEAD_AIM_DEPTH = 0.8;
/** Untouched víbora target: cross-court, this deep (fraction of the half), into the side glass. */
const VIBORA_AIM_DEPTH = 0.68;
/** Untouched smash target: clear the tape by this much on a straight line, but land no shorter than this. */
const SMASH_NET_MARGIN = 0.45;
const SMASH_MIN_DEPTH = 3.2;
/** Windows are searched from this far back, so a release just after the ideal is still judged against it. */
const RELEASE_LOOKBACK = 0.3;
/** Doubles ball-taking: runs within this (m) count as a tie (forehand in the middle takes it); a decision
 * changes only for a run this much shorter; a contact out of time costs this much. */
const MIDDLE_MARGIN = 0.8;
const SWITCH_MARGIN = 1.0;
const CLAIM_OUT = 20;

export class MatchSim {
  readonly cfg: MatchConfig;
  readonly world: BallWorld;
  readonly solver: ShotSolver;
  readonly score: Score;
  readonly rally = new Rally();
  readonly ball = new Ball();
  /** The net as cloth: solved with the ball near it, on its own while it still moves. */
  readonly net: NetCloth;
  private ballCoupled = false;
  /** 2 (singles) or 4 (doubles) players; team = index & 1, partner = index ^ 2. */
  readonly players: Player[];
  readonly doubles: boolean;
  readonly pred = new Prediction();
  readonly rng: Rng;
  readonly aiRng: Rng;
  readonly ai: Array<SimpleAi | null>;
  readonly aiFrames: InputFrame[];

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
  lastStrikePlayer = -1;
  lastStrikeTime = -10;
  /** Doubles: which player of each team is going for the incoming ball (-1: none / not decided). */
  readonly taker = [-1, -1];
  /** Doubles: what an AI striker decided its pair does after its shot: 1 go up to the net, 0 stay back, -1 none. */
  readonly intentUp = [-1, -1];
  private readonly takerVersion = [-1, -1];

  // Previous-tick state for render interpolation.
  readonly prevBall = { x: 0, y: 0, z: 0 };
  readonly prevPlayers: Array<{ x: number; z: number }>;

  readonly events: MatchEvent[] = [];
  eventSeq = 0;

  private readonly windows = makeWindows();
  /** Where each player should stand for the incoming ball (assist, HUD spot, timing ring). */
  readonly stand: StandPlan[];
  /** Scratch plans for deciding which partner takes the ball. */
  private readonly claim: StandPlan[];
  private readonly req: ShotRequest = {
    shot: 0, mod: 0, targetX: 0, targetZ: 0, quality: 1, timingDelta: 0, handSide: 1, moving: 0, stretch: 0, power: 1, control: 1, spinScale: 1, bodyX: 0, bodyZ: 0,
  };
  private readonly res: ShotResult = { reachable: true, speed: 0, idealX: 0, idealZ: 0 };
  /** Aim captured at release, per player: relative (-1..1) or absolute. */
  private readonly aim: Array<{ abs: boolean; x: number; y: number; tx: number; tz: number }>;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.doubles = cfg.doubles === true;
    const n = this.doubles ? 4 : 2;
    this.world = makeWorld(cfg.world);
    this.net = makeNetCloth(this.world);
    this.ball.cloth = this.net;
    this.solver = new ShotSolver(this.world);
    this.score = new Score(cfg.format ?? DEFAULT_FORMAT, cfg.firstServer ?? 0, this.doubles);
    this.rng = new Rng(cfg.seed);
    this.aiRng = new Rng(cfg.seed ^ 0x5bd1e995);
    const lv = cfg.aiLevel ?? [0.55, 0.55];
    this.players = [];
    this.ai = [];
    this.aiFrames = [];
    this.stand = [];
    this.claim = [];
    this.aim = [];
    this.prevPlayers = [];
    for (let i = 0; i < n; i++) {
      this.players.push(new Player(i, DEFAULT_TUNING));
      if (cfg.lefty?.[i]) this.players[i]!.handed = -1;
      this.ai.push(cfg.human[i] ? null : new SimpleAi(i, lv[i & 1]!, styleOf(cfg.aiStyle?.[i])));
      this.aiFrames.push(new InputFrame());
      this.stand.push(makeStandPlan());
      this.claim.push(makeStandPlan());
      this.aim.push({ abs: false, x: 0, y: 0, tx: 0, tz: 0 });
      this.prevPlayers.push({ x: 0, z: 0 });
    }
    this.rally.outOfCourtPlay = false;
    for (let i = 0; i < EVENT_RING; i++) {
      this.events.push({ seq: -1, kind: 0, time: 0, team: -1, player: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0 });
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
    this.emitFor(kind, team, -1, a, b, c, x, y, z);
  }

  /** A player's event (team is the player's). */
  private emitP(kind: number, player: number, a = 0, b = 0, c = 0, x = 0, y = 0, z = 0): void {
    this.emitFor(kind, player & 1, player, a, b, c, x, y, z);
  }

  private emitFor(kind: number, team: number, player: number, a: number, b: number, c: number, x: number, y: number, z: number): void {
    const e = this.events[this.eventSeq % EVENT_RING]!;
    e.seq = this.eventSeq++;
    e.kind = kind;
    e.time = this.time;
    e.team = team;
    e.player = player;
    e.a = a; e.b = b; e.c = c;
    e.x = x; e.y = y; e.z = z;
  }

  // ---- point setup ---------------------------------------------------------------------------

  private startPoint(): void {
    const c = this.world.court;
    const sc = this.score;
    const sTeam = sc.serverTeam();
    const rTeam = 1 - sTeam;
    for (const p of this.players) p.setHalf(this.side(p.team), c.halfW, c.halfL);
    if (sc.isDecidingPoint() && sc.decidingSide < 0) {
      // Receivers choose the side for the golden/star point. In doubles that picks who receives: a pair with a
      // human puts the human on it. A human alone (singles) takes the right for now; AI pairs choose at random.
      let side = this.aiRng.next() < 0.5 ? SIDE_RIGHT : SIDE_LEFT;
      if (this.teamHasHuman(rTeam)) {
        side = SIDE_RIGHT;
        if (this.doubles) {
          const human = this.ai[rTeam] ? rTeam + 2 : rTeam;
          side = (human >> 1) === sc.firstReceiverSlot[rTeam] ? SIDE_RIGHT : SIDE_LEFT;
        }
      }
      sc.decidingSide = side;
    }
    const ss = this.side(sTeam);
    const sideSign = (sc.serveSide() === SIDE_RIGHT ? 1 : -1) * ss; // server's right is +x for the near half
    const sl = c.def.serviceLineFromNet;
    const server = this.players[sc.serverPlayer()]!;
    const recv = this.players[sc.receiverPlayer()]!;
    server.pos.set(sideSign * c.halfW * 0.42, 0, ss * (sl + 0.75));
    server.facing = ss > 0 ? 0 : Math.PI;
    recv.pos.set(-sideSign * c.halfW * 0.5, 0, -ss * (c.halfL - 1.4));
    recv.facing = ss > 0 ? Math.PI : 0;
    if (this.doubles) {
      // Server's partner at the net on the other side; receiver's partner back on the other side, a step in.
      const sp = this.players[server.index ^ 2]!;
      sp.pos.set(-sideSign * c.halfW * 0.5, 0, ss * 2.6);
      sp.facing = server.facing;
      const rp = this.players[recv.index ^ 2]!;
      rp.pos.set(sideSign * c.halfW * 0.5, 0, -ss * (c.halfL - 2.4));
      rp.facing = recv.facing;
    }
    for (const p of this.players) {
      p.vel.set(0, 0, 0);
      p.swing = SW_IDLE;
      p.grade = -1;
      p.aiming = false;
    }
    this.taker[0] = -1;
    this.taker[1] = -1;
    this.intentUp[0] = -1;
    this.intentUp[1] = -1;
    this.takerVersion[0] = -1;
    this.takerVersion[1] = -1;
    // Diagonal service box on the receivers' half.
    this.box.x0 = sideSign > 0 ? -c.halfW : 0;
    this.box.x1 = sideSign > 0 ? 0 : c.halfW;
    this.box.z0 = min(0, -ss * sl);
    this.box.z1 = max(0, -ss * sl);
    // The server's aim starts in the middle of the box, three quarters deep.
    server.aimX = (this.box.x0 + this.box.x1) * 0.5;
    server.aimZ = -ss * sl * 0.75;
    this.rally.reset();
    const rb = this.rally.box;
    rb.x0 = this.box.x0; rb.x1 = this.box.x1; rb.z0 = this.box.z0; rb.z1 = this.box.z1;
    this.rally.lineTolerance = c.def.lineWidth / 2;
    this.placeBallInHand();
    this.phase = PH_SETUP;
    this.phaseUntil = this.time + 0.5;
    for (const a of this.ai) a?.reset();
  }

  /** Some player of the team is human. */
  teamHasHuman(team: number): boolean {
    for (let i = team; i < this.players.length; i += 2) if (!this.ai[i]) return true;
    return false;
  }

  /** Half of the court a player plays this game: +1 = z > 0. */
  sideOf(player: number): number {
    return this.side(player & 1);
  }

  private placeBallInHand(): void {
    const p = this.players[this.score.serverPlayer()]!;
    const ss = this.side(p.team);
    this.ball.pos.set(p.pos.x + ss * 0.45 * p.handed, SERVE_HAND_HEIGHT, p.pos.z - ss * 0.3);
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.ball.outside = false;
    this.ball.rolling = false;
    this.ball.clearNet();
  }

  // ---- main step -----------------------------------------------------------------------------

  /** Advance one tick. `inputs[player]` is a human player's frame (ignored for AI players). */
  step(inputs: ReadonlyArray<InputFrame | null>): void {
    const t0 = this.time;
    const t1 = t0 + DT;
    const n = this.players.length;
    this.prevBall.x = this.ball.pos.x;
    this.prevBall.y = this.ball.pos.y;
    this.prevBall.z = this.ball.pos.z;
    this.net.beginTick();
    this.ballCoupled = false;
    for (let i = 0; i < n; i++) {
      this.prevPlayers[i]!.x = this.players[i]!.pos.x;
      this.prevPlayers[i]!.z = this.players[i]!.pos.z;
    }

    if (this.phase === PH_OVER) {
      this.time = t1;
      this.tick++;
      return;
    }

    // Doubles: settle which partner goes for an incoming ball before anyone moves.
    if (this.doubles && this.phase === PH_RALLY) this.updateTakers();

    // Inputs (AI writes its own frames).
    for (let i = 0; i < n; i++) {
      const ai = this.ai[i];
      let f: InputFrame | null;
      if (ai) {
        f = this.aiFrames[i]!;
        f.clear();
        ai.think(this, f);
      } else {
        f = inputs[i] ?? null;
      }
      if (f) this.applyInput(i, f);
    }
    if (this.doubles) this.separatePartners();

    // Phase logic.
    if (this.phase === PH_SETUP) {
      this.placeBallInHand();
    } else {
      // Strikes inside this tick split the ball step at the exact contact time.
      let tc = t1;
      let who = -1;
      for (let i = 0; i < n; i++) {
        const p = this.players[i]!;
        if (p.swing === SW_COMMITTED && p.contactTime < tc) { tc = p.contactTime; who = i; }
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

    // The net keeps moving after the ball has gone (or while it is dead in hand).
    if (!this.ballCoupled && this.net.awake) this.net.freeTick();

    this.time = t1;
    this.tick++;

    // Swing housekeeping.
    for (let i = 0; i < n; i++) {
      const p = this.players[i]!;
      if (p.swing === SW_RECOVER && this.time >= p.recoverUntil) p.swing = SW_IDLE;
    }

    if (this.rally.result !== R_NONE && (this.phase === PH_RALLY || this.phase === PH_TOSS)) this.endRally();
    if (this.phase === PH_DEAD && this.time >= this.phaseUntil) this.afterDead();
  }

  private tossBounces = 0;

  private stepBall(dt: number, tStart: number): void {
    const b = this.ball;
    b.step(this.world, dt, this.rng);
    if (b.coupled) this.ballCoupled = true;
    let recompute = false;
    let flags = 0;
    for (let i = 0; i < b.eventCount; i++) {
      const e = b.events[i]!;
      const t = tStart + e.t;
      switch (e.kind) {
        case HIT_FLOOR:
          if (this.phase === PH_TOSS && this.rally.hitter < 0) this.tossBounces++;
          else this.rally.onFloor(e.x, e.z);
          this.emitAt(E_FLOOR, t, e.surface, 0, e.speed, e.x, e.y, e.z);
          this.wallsSinceBounce = 0;
          flags |= PF_FLOOR;
          recompute = true;
          break;
        case HIT_WALL: {
          const wallSide = e.wall === WALL_SIDE_LEFT || e.wall === WALL_SIDE_RIGHT ? (e.z >= 0 ? 1 : -1) : e.z > 0 ? 1 : -1;
          this.rally.onWall(e.surface, wallSide);
          this.emitAt(E_WALL, t, e.surface, e.wall, e.speed, e.x, e.y, e.z);
          this.wallsSinceBounce++;
          flags |= PF_WALL;
          recompute = true;
          break;
        }
        case HIT_NET:
        case HIT_NETCORD:
        case HIT_POST:
          // The posts are part of the net: where the ball lands decides it.
          this.rally.onNet();
          this.emitAt(E_NET, t, e.kind === HIT_NETCORD ? 1 : e.kind === HIT_POST ? 2 : 0, 0, e.speed, e.x, e.y, e.z);
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
    // Caught in the net, or under a pocket of it, the ball can be past the net line without having crossed.
    if (!b.inNet) this.rally.onBallZ(b.sideZ);
    if (recompute && (this.phase === PH_RALLY || this.phase === PH_TOSS)) {
      this.pred.compute(this.world, b, tStart + dt, this.phase === PH_RALLY ? this.rally.bounces : this.tossBounces, 2,
        this.wallsSinceBounce, flags);
    }
  }

  private emitAt(kind: number, t: number, a: number, b: number, c: number, x: number, y: number, z: number): void {
    const save = this.time;
    this.time = t;
    this.emit(kind, -1, a, b, c, x, y, z);
    this.time = save;
  }

  // ---- input and swings ----------------------------------------------------------------------

  private applyInput(i: number, f: InputFrame): void {
    const t0 = this.time;
    const p = this.players[i]!;
    const team = p.team;
    const s = this.side(team);
    const human = !this.ai[i];
    const isServerSetup = (this.phase === PH_SETUP || this.phase === PH_TOSS) && i === this.score.serverPlayer();
    // In doubles a human plans (spot, ring, assist) only for balls that are theirs: assigned, or claimed by
    // holding a shot key.
    const incoming = human && this.phase === PH_RALLY && this.rally.hitter !== team && this.rally.hitter >= 0
      && (!this.doubles || this.taker[team] === i);
    const st = this.stand[i]!;
    if (incoming) {
      // Re-plan when the predicted path changes (bounce, wall), every few ticks while the contact is well ahead
      // (the player may be heading somewhere else), and once the planned moment has gone by. The planned contact
      // is preferred so the plan doesn't flip between options; close to contact it is the only one considered,
      // so the ring and the spot never jump to another bounce at the last moment.
      // Holding the overhead key plans the ball high (in the air for a lob); switching modes plans afresh.
      const overhead = this.goingOverhead(p);
      const live = st.valid && t0 < st.t + 0.1 && st.overhead === overhead;
      const close = live && st.t - t0 < 0.35;
      if (this.pred.version !== st.version || !live || (!close && (this.tick & 7) === 0)) {
        const keep = live ? st.t : -1;
        if (!(close && planStand(this.pred, p, s, t0, this.rally.isServe, st, keep, true, overhead))) {
          planStand(this.pred, p, s, t0, this.rally.isServe, st, keep, false, overhead);
        }
      }
    } else {
      st.valid = false;
    }

    // While a shot is charged for an incoming ball (and while setting up a serve) the movement keys steer the
    // aim target and the player runs to the planned spot by themselves. Otherwise the keys move the player.
    // With the assist off (?assist=0) the keys always move and aim comes from the keys held at release.
    const assistOn = (this.cfg.assist ?? p.tune.positioningAssist) > 0;
    p.aiming = human && assistOn && (isServerSetup || (p.swing === SW_CHARGE && st.valid));
    const keysAim = p.aiming && !f.aimAbs;
    let dx = keysAim || isServerSetup ? 0 : f.moveX * s;
    let dz = keysAim || isServerSetup ? 0 : -f.moveY * s;
    if (p.aiming) this.steerAim(p, f, s, isServerSetup);
    if (incoming) {
      this.assist(p, f, keysAim);
      dx += this.assistX;
      dz += this.assistZ;
    } else if (human && this.doubles && assistOn && this.phase === PH_RALLY && p.swing !== SW_CHARGE
      && abs(f.moveX) + abs(f.moveY) < 0.1) {
      // Doubles, not our ball and no keys held: take up the pair's formation as the AI partner does (keys
      // always win; ?assist=0 turns this off).
      formationSpot(this, i, this.rally.hitter !== team && this.rally.hitter >= 0, this.form);
      this.arriveK = this.cfg.assist ?? p.tune.positioningAssist;
      this.arrive(p);
      dx += this.assistX;
      dz += this.assistZ;
    }

    // Button events in time order.
    for (let k = 0; k < f.evCount; k++) {
      const e = f.ev[k]!;
      // The overhead key is held as a bandeja; it becomes a smash at contact if power is held.
      const shot = e.button === BTN_OVERHEAD ? SHOT_BANDEJA : SHOT_BUTTONS.indexOf(e.button as never);
      if (shot < 0) continue;
      // Presses act from this tick; releases keep their exact time so a late-delivered event is still graded fairly.
      if (e.press) this.press(i, shot, max(e.t, t0));
      else if (p.swing === SW_CHARGE && p.shot === shot) this.releaseSwing(i, e.t, f);
    }
    // Assisted timing: still holding when the ideal moment arrives, the swing goes off by itself.
    if (this.cfg.autoTiming && human && p.swing === SW_CHARGE && this.phase !== PH_SETUP) {
      const ideal = this.autoIdeal(i);
      // Released just before Perfect, so it grades Good whatever the timing scale. Early rather than late: an
      // early swing still meets the ball at the ideal moment (an overhead stays high, a ball at the body is
      // met in front), a late one meets it late.
      const early = (TIMING.perfect + 0.35 * (TIMING.good - TIMING.perfect)) * (this.cfg.timingScale ?? 1);
      if (ideal >= 0 && ideal - early < t0 + DT) this.releaseSwing(i, max(t0, ideal - early), f);
    }
    // Safety: a swing held far too long releases itself.
    if (p.swing === SW_CHARGE && t0 - p.chargeStart > 3) this.releaseSwing(i, t0, f);

    p.clock = t0;
    if (!isServerSetup && this.phase !== PH_DEAD) { p.driveX = dx; p.driveZ = dz; p.move(); }
    else if (this.phase === PH_DEAD) { p.driveX = 0; p.driveZ = 0; p.move(); }

    // Face the ball while preparing, otherwise the direction of travel / the net.
    const b = this.ball.pos;
    p.faceTowards(b);
  }

  private readonly focusWins = makeWindows();
  /** Walls the ball has touched since its last bounce or strike (carried into re-predictions). */
  private wallsSinceBounce = 0;
  private assistX = 0;
  private assistZ = 0;

  // ---- doubles: who takes the ball --------------------------------------------------------------

  /**
   * Doubles: which partner goes for the incoming ball. The serve is the receiver's (8.1). A human holding a
   * shot key takes it. Otherwise each partner's best contact is planned and the shorter run wins; when it is
   * close, the player with the forehand in the middle takes it (what pairs agree on). A decision only changes
   * when the other player is clearly better placed, so the two don't swap back and forth.
   */
  private updateTakers(): void {
    const t0 = this.time;
    const hitter = this.rally.hitter;
    for (let team = 0; team < 2; team++) {
      if (hitter < 0 || hitter === team) {
        this.taker[team] = -1;
        continue;
      }
      if (this.rally.isServe) {
        this.setTaker(team, this.score.receiverPlayer());
        continue;
      }
      const a = team;
      const b = team + 2;
      const cur = this.taker[team]!;
      if (cur >= 0 && this.players[cur]!.swing === SW_COMMITTED) continue;
      const ha = !this.ai[a] && this.players[a]!.swing === SW_CHARGE;
      const hb = !this.ai[b] && this.players[b]!.swing === SW_CHARGE;
      if (ha || hb) {
        this.setTaker(team, ha ? a : b);
        continue;
      }
      if (cur >= 0 && this.pred.version === this.takerVersion[team]) continue;
      this.takerVersion[team] = this.pred.version;
      const s = this.side(team);
      const ca = this.claimCost(a, s, t0);
      const cb = this.claimCost(b, s, t0);
      let pick: number;
      if (abs(ca - cb) < MIDDLE_MARGIN && ca < CLAIM_OUT && cb < CLAIM_OUT) {
        pick = this.forehandInMiddle(a, s) ? a : this.forehandInMiddle(b, s) ? b : ca <= cb ? a : b;
      } else pick = ca <= cb ? a : b;
      if (cur >= 0 && pick !== cur) {
        const cCur = cur === a ? ca : cb;
        const cPick = pick === a ? ca : cb;
        if (cCur < CLAIM_OUT && cPick > cCur - SWITCH_MARGIN) pick = cur;
      }
      // A partner standing in the ball's line, who it would hit before the other plays it, has to play it.
      const other = pick ^ 2;
      const kHit = this.bodyHitIdx(other, s);
      const tHit = kHit >= 0 ? this.pred.t[kHit]! : -1;
      if (tHit >= 0 && (!this.claim[pick]!.valid || this.claim[pick]!.t > tHit - 0.05)) pick = other;
      this.setTaker(team, pick);
    }
  }

  private setTaker(team: number, i: number): void {
    const prev = this.taker[team]!;
    // An AI that was getting ready for a ball its partner now takes stands down.
    if (prev >= 0 && prev !== i && this.ai[prev] && this.players[prev]!.swing === SW_CHARGE) this.players[prev]!.swing = SW_IDLE;
    this.taker[team] = i;
  }

  /** Run to the best contact (m), plus a large penalty if it can't be reached in time. */
  private claimCost(i: number, s: number, t0: number): number {
    const p = this.players[i]!;
    const plan = this.claim[i]!;
    if (!planStand(this.pred, p, s, t0, this.rally.isServe, plan, -1, false, false)) return CLAIM_OUT * 2;
    const dx = plan.x - p.pos.x;
    const dz = plan.z - p.pos.z;
    return sqrt(dx * dx + dz * dz) + (plan.inTime ? 0 : CLAIM_OUT);
  }

  /**
   * The prediction sample where the ball reaches the player's body where they stand (-1: it doesn't). An index,
   * not a time: a double returned from a call that isn't inlined is boxed (garbage every frame).
   */
  bodyHitIdx(i: number, s: number): number {
    const t0 = this.time;
    const p = this.players[i]!;
    const pr = this.pred;
    const r = p.tune.bodyRadius + this.world.spec.radius + 0.05;
    for (let k = 0; k < pr.n; k++) {
      if (pr.t[k]! < t0 || pr.z[k]! * s <= 0) continue;
      if (pr.bounces[k]! > 1) break;
      if (pr.y[k]! > p.tune.height) continue;
      const dx = pr.x[k]! - p.pos.x;
      const dz = pr.z[k]! - p.pos.z;
      if (dx * dx + dz * dz < r * r) return k;
    }
    return -1;
  }

  /** The player's forehand faces the middle of the court (left-side right-hander, right-side left-hander). */
  private forehandInMiddle(i: number, s: number): boolean {
    const p = this.players[i]!;
    const q = this.players[i ^ 2]!;
    const lane = (p.pos.x - q.pos.x) * s > 0 ? 1 : -1; // +1: on the right of the pair, as they face the net
    return lane * p.handed < 0;
  }

  /** Partners can't stand in each other: push apart when closer than two bodies. */
  private separatePartners(): void {
    for (let team = 0; team < 2; team++) {
      const p = this.players[team]!;
      const q = this.players[team + 2]!;
      const minD = p.tune.bodyRadius + q.tune.bodyRadius + 0.15;
      let dx = q.pos.x - p.pos.x;
      let dz = q.pos.z - p.pos.z;
      let d = sqrt(dx * dx + dz * dz);
      if (d >= minD) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const push = (minD - d) * 0.5;
      const ux = dx / d;
      const uz = dz / d;
      p.pos.x = clamp(p.pos.x - ux * push, p.minX, p.maxX);
      p.pos.z = clamp(p.pos.z - uz * push, p.minZ, p.maxZ);
      q.pos.x = clamp(q.pos.x + ux * push, q.minX, q.maxX);
      q.pos.z = clamp(q.pos.z + uz * push, q.minZ, q.maxZ);
    }
  }

  /** The player is holding (or has just released) the overhead key. */
  private goingOverhead(p: Player): boolean {
    return p.shot === SHOT_BANDEJA && (p.swing === SW_CHARGE || p.swing === SW_COMMITTED);
  }

  /** Pull towards the planned hitting spot: light while the player steers, full while the keys are aiming. */
  private assist(p: Player, f: InputFrame, full: boolean): void {
    this.assistX = 0;
    this.assistZ = 0;
    const k = full ? 1 : (this.cfg.assist ?? p.tune.positioningAssist);
    const st = this.stand[p.index]!;
    if (k <= 0 || !st.valid) return;
    const pushing = !full && abs(f.moveX) + abs(f.moveY) > 0.1 ? 0.55 : 1;
    this.form.x = st.x;
    this.form.z = st.z;
    this.arriveK = k * pushing;
    this.arrive(p);
  }

  /** Where arrive() steers to, and how hard (fields, not arguments: V8 boxes doubles passed to calls). */
  private readonly form: Spot = { x: 0, z: 0 };
  private arriveK = 0;

  /**
   * Steer towards `form` at strength `arriveK` into assistX/assistZ. Arrive, don't overshoot: ask only for the
   * speed the player can still brake from within the distance left (running past the spot puts the body in the
   * ball's line).
   */
  private arrive(p: Player): void {
    this.assistX = 0;
    this.assistZ = 0;
    const k = this.arriveK;
    const dx = this.form.x - p.pos.x;
    const dz = this.form.z - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    if (d < 0.05 || k <= 0) return;
    const t = p.tune;
    const g = k * min(1, sqrt(2 * t.brake * 0.7 * d) / t.maxSpeed);
    this.assistX = (dx / d) * g;
    this.assistZ = (dz / d) * g;
  }

  /** Move the aim target with the keys (or put it under the mouse), kept inside a sensible landing area. */
  private steerAim(p: Player, f: InputFrame, s: number, serve: boolean): void {
    const c = this.world.court;
    if (f.aimAbs || abs(f.moveX) + abs(f.moveY) > 0.1) p.aimTouched = true;
    else if (!p.aimTouched && !serve && p.shot === SHOT_BANDEJA) {
      // An overhead target nobody has steered follows the shot: deep for a bandeja; for a smash (Space) the
      // shortest landing that a full-pace straight line from the planned contact clears the net with margin.
      // Near the net that is mid-court, and the steep bounce can leave the court; from deep it lands deeper.
      if ((f.held & BTN_POWER) !== 0) {
        const st = this.stand[p.index]!;
        const back = abs(st.valid ? st.bz : p.pos.z);
        const h = st.valid ? st.by : p.tune.overheadIdealHeight;
        const over = c.netHeightAt(0) + SMASH_NET_MARGIN;
        const far = c.halfL - 2.0;
        p.aimZ = -s * (h > over + 0.2 ? clamp((over * back) / (h - over), SMASH_MIN_DEPTH, far) : far);
      } else if ((f.held & BTN_PRECISION) !== 0) {
        // Víbora: cross-court into the side glass.
        p.aimX = (p.pos.x > 0 ? -1 : 1) * (c.halfW - 0.9);
        p.aimZ = -s * VIBORA_AIM_DEPTH * c.halfL;
      } else {
        p.aimZ = -s * OVERHEAD_AIM_DEPTH * c.halfL;
      }
    }
    if (f.aimAbs) {
      p.aimX = f.aimTX;
      p.aimZ = f.aimTZ;
    } else {
      p.aimX += s * f.moveX * AIM_SPEED_X * DT;
      p.aimZ += -s * f.moveY * AIM_SPEED_Z * DT;
    }
    if (serve) {
      const bx = this.box;
      p.aimX = clamp(p.aimX, min(bx.x0, bx.x1) + 0.3, max(bx.x0, bx.x1) - 0.3);
      p.aimZ = -s * clamp(-s * p.aimZ, 1.4, c.def.serviceLineFromNet - 0.3);
    } else {
      p.aimX = clamp(p.aimX, -c.halfW + 0.45, c.halfW - 0.45);
      p.aimZ = -s * clamp(-s * p.aimZ, 0.9, c.halfL - 0.45);
    }
  }

  private press(i: number, shot: number, t: number): void {
    const p = this.players[i]!;
    const team = p.team;
    if (p.swing !== SW_IDLE) return;
    if (this.phase === PH_SETUP) {
      if (i !== this.score.serverPlayer() || t < this.phaseUntil) return;
      // Drop the ball for the serve.
      this.phase = PH_TOSS;
      this.tossBounces = 0;
      this.placeBallInHand();
      this.ball.vel.set(0, -0.3, 0);
      this.pred.compute(this.world, this.ball, t, 0, 2);
      this.computeTossIdeal();
      this.emitP(E_TOSS, i);
    } else if (this.phase === PH_DEAD || this.phase === PH_OVER) {
      return;
    }
    p.swing = SW_CHARGE;
    p.shot = shot;
    p.chargeStart = t;
    p.grade = -1;
    if (this.phase === PH_RALLY && !this.ai[i]) {
      // Each rally shot starts aimed down the middle at the shot's natural depth; the keys move it from there.
      const depth = shot === SHOT_BANDEJA ? OVERHEAD_AIM_DEPTH : this.solverDepth(shot);
      p.aimX = 0;
      p.aimZ = -this.side(team) * depth * this.world.court.halfL;
      p.aimTouched = false;
    }
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

  private releaseSwing(i: number, t: number, f: InputFrame): void {
    const p = this.players[i]!;
    const team = p.team;
    p.release = t;
    p.mod = (f.held & BTN_POWER) !== 0 ? MOD_POWER : (f.held & BTN_PRECISION) !== 0 ? MOD_PRECISION : MOD_NONE;
    const a = this.aim[i]!;
    if (!this.ai[i] && (this.cfg.assist ?? p.tune.positioningAssist) > 0) {
      // Human with the aim target: it was steered while charging (or put under the mouse).
      a.abs = true;
      a.tx = p.aimX;
      a.tz = p.aimZ;
    } else {
      a.abs = f.aimAbs;
      a.tx = f.aimTX;
      a.tz = f.aimTZ;
    }
    a.x = f.moveX;
    a.y = f.moveY;
    // The timing-window setting is a human accessibility aid; AI players are always judged on the real windows.
    const scale = this.ai[i] ? 1 : this.cfg.timingScale ?? 1;

    if (this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0) {
      const delta = t - this.tossIdeal;
      p.timingDelta = delta;
      p.grade = gradeTiming(delta, TIMING, scale);
      if (abs(delta) > TIMING.miss * scale) {
        this.whiff(i, t);
        return;
      }
      p.contactTime = clamp(max(t, this.tossIdeal), t, this.tossEnd - 0.02);
      p.swing = SW_COMMITTED;
      this.emitP(E_SWING, i, p.shot, p.grade, delta);
      return;
    }

    // Rally: judge against the window whose ideal moment is nearest the release.
    const s = this.side(team);
    const mustBounce = this.rally.isServe;
    const n = findWindows(this.pred, p.pos.x, p.pos.z, s, mustBounce, 1, p.tune, this.windows, this.time - RELEASE_LOOKBACK,
      p.shot === SHOT_BANDEJA);
    let w: ContactWindow | null = null;
    for (let k = 0; k < n; k++) {
      const c = this.windows[k]!;
      if (t > c.end + TIMING.miss * scale) continue;
      if (!w || abs(t - c.ideal) < abs(t - w.ideal)) w = c;
    }
    if (!w || this.rally.hitter === team) {
      this.whiff(i, t);
      return;
    }
    const delta = t - w.ideal;
    p.timingDelta = delta;
    p.grade = gradeTiming(delta, TIMING, scale);
    if (abs(delta) > TIMING.miss * scale) {
      this.whiff(i, t);
      return;
    }
    p.contactTime = delta < 0 ? w.ideal : max(t, w.ideal);
    if (p.contactTime < this.time) p.contactTime = this.time;
    p.swing = SW_COMMITTED;
    this.emitP(E_SWING, i, p.shot, p.grade, delta);
  }

  /** Ideal moment of the contact the player is going for, or -1 (assisted timing). */
  private autoIdeal(i: number): number {
    return this.focusIdeal(i);
  }

  /**
   * The contact moment a player is going for: the planned contact's window (so a ball that passes on its way
   * into the glass doesn't steal the cue from the rebound you are set up for), else the earliest window.
   * The timing ring, the meter and assisted timing all read this. -1 if there is none.
   */
  focusIdeal(i: number): number {
    this.focusInReach = true;
    if (this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0) return this.tossIdeal;
    // Doubles: no cue for a ball the partner is taking (holding a shot key claims it, and then it is ours).
    if (this.doubles && this.taker[this.players[i]!.team] !== i) return -1;
    const n = this.windowsFor(i, this.focusWins);
    const st = this.stand[i]!;
    let best = -1;
    let bestGap = 1e9;
    for (let k = 0; k < n; k++) {
      const w = this.focusWins[k]!;
      if (st.valid) {
        const gap = st.t < w.start ? w.start - st.t : st.t > w.end ? st.t - w.end : 0;
        if (gap < bestGap) { bestGap = gap; best = w.ideal; }
      } else if (w.ideal >= this.time - 0.05 && (best < 0 || w.ideal < best)) {
        best = w.ideal;
      }
    }
    // Not in reach of the planned contact yet (still running there): cue the planned moment itself.
    this.focusInReach = !st.valid || (best >= 0 && bestGap <= 0.12);
    if (!this.focusInReach) return st.t;
    return best;
  }

  /** Set by focusIdeal: false while the planned contact is still out of reach from where the player is. */
  focusInReach = true;

  /** `reach` > 0: the swing was on time but the ball was this far away (out of reach). */
  private whiff(i: number, t: number, reach = 0): void {
    const p = this.players[i]!;
    p.swing = SW_RECOVER;
    p.recoverUntil = t + p.tune.recoverTime;
    p.lastContactTime = t;
    if (p.grade < 0) p.grade = p.timingDelta < 0 ? G_TOO_EARLY : G_TOO_LATE;
    this.emitP(E_WHIFF, i, p.shot, p.grade, p.timingDelta, reach);
  }

  /** The committed swing reaches its contact time: connect if the ball is really there. */
  private contact(i: number): void {
    const p = this.players[i]!;
    const team = p.team;
    const b = this.ball;
    const s = this.side(team);
    const serving = this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0;
    const dx = b.pos.x - p.pos.x;
    const dz = b.pos.z - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    const t = p.tune;
    const legal = serving
      ? this.tossBounces === 1
      : b.sideZ * s > 0 && !b.inNet && this.rally.hitter !== team && this.rally.bounces <= 1 && !(this.rally.isServe && this.rally.bounces === 0)
        // The serve is returned by the receiver, not the partner (8.1).
        && !(this.rally.isServe && i !== this.score.receiverPlayer());
    if (!legal || d > t.reachMax + 0.25 || b.pos.y < t.contactMinHeight * 0.5 || b.pos.y > t.contactMaxHeight + 0.15 || this.rally.over) {
      if (serving && this.tossBounces !== 1) this.rally.onServeMissed();
      this.whiff(i, this.time, legal && d > t.reachMax + 0.25 ? d : 0);
      return;
    }

    // Which shot actually comes out: overheads and volleys are picked from the situation.
    let shot = p.shot;
    if (serving) shot = SHOT_SERVE;
    else if (p.shot === SHOT_BANDEJA) {
      // Overhead key: a bandeja, a smash with power held, a víbora with precision held. A ball that has dropped
      // too low is sliced instead.
      if (b.pos.y >= t.overheadHeight - 0.3) shot = p.mod === MOD_POWER ? SHOT_SMASH : p.mod === MOD_PRECISION ? SHOT_VIBORA : SHOT_BANDEJA;
      else shot = this.rally.bounces === 0 ? SHOT_VOLLEY : SHOT_SLICE;
    } else if (b.pos.y >= t.overheadHeight && shot !== SHOT_LOB && shot !== SHOT_DROP) shot = shot === SHOT_SLICE ? SHOT_BANDEJA : SHOT_SMASH;
    else if (this.rally.bounces === 0 && (shot === SHOT_DRIVE || shot === SHOT_SLICE)) shot = SHOT_VOLLEY;
    // Topspin key with precision: a chiquita, soft and dipping to the feet of the players at the net.
    else if (shot === SHOT_TOPSPIN && p.mod === MOD_PRECISION) shot = SHOT_CHIQUITA;

    // Target.
    const c = this.world.court;
    const a = this.aim[i]!;
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

    r.shot = shot;
    // Precision picked the víbora or the chiquita; it does not also scale them.
    r.mod = shot === SHOT_VIBORA || shot === SHOT_CHIQUITA ? MOD_NONE : p.mod;
    r.quality = gradeQuality(p.grade);
    r.timingDelta = p.timingDelta;
    r.handSide = dx * s * p.handed >= 0 ? 1 : -1;
    r.moving = clamp(p.speed() / t.maxSpeed, 0, 1);
    r.stretch = clamp((d - t.reachComfort) / (t.reachMax - t.reachComfort), 0, 1);
    r.power = 1;
    r.control = 1;
    // Serve spin follows the key (slice, kick, flat); it is solved with, so the serve still lands on its target.
    r.spinScale = serving ? (p.shot === SHOT_TOPSPIN ? -0.9 : p.shot === SHOT_DRIVE ? 0.15 : 1) : 1;
    r.bodyX = p.pos.x;
    r.bodyZ = p.pos.z;
    const contactY = b.pos.y;
    strike(this.solver, b, r, this.rng, this.res);

    p.swing = SW_RECOVER;
    p.recoverUntil = this.time + t.recoverTime;
    p.lastContact.copy(b.pos);
    p.lastContactTime = this.time;
    this.lastStrikeTeam = team;
    this.lastStrikePlayer = i;
    if (!this.ai[i]) this.intentUp[team] = -1;
    this.lastStrikeTime = this.time;

    if (serving) {
      this.rally.onStrike(team, s, true, contactY, t.waistHeight);
      this.phase = PH_RALLY;
    } else {
      this.rally.onStrike(team, s, false);
    }
    this.emitP(E_HIT, i, shot, p.grade, this.res.speed, b.pos.x, b.pos.y, b.pos.z);
    this.wallsSinceBounce = 0;
    this.pred.compute(this.world, b, this.time, 0);
    // The opponents split-step as the ball is struck.
    for (let o = 1 - team; o < this.players.length; o += 2) {
      if (this.players[o]!.trySplitStep(this.time)) this.emitP(E_SPLIT, o);
    }
    this.taker[1 - team] = -1;
    this.takerVersion[1 - team] = -1;
    for (let k = 0; k < this.ai.length; k++) this.ai[k]?.onStrike(this, team);
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
      case SHOT_VIBORA: return 0.78;
      case SHOT_VOLLEY: return 0.7;
      case SHOT_CHIQUITA: return 0.33;
      default: return 0.75;
    }
  }

  /** Ball touching a player's body ends the point. */
  private checkBodies(): void {
    const b = this.ball;
    if (this.rally.hitter < 0 || this.rally.over || b.outside) return;
    for (let i = 0; i < this.players.length; i++) {
      // The striker's own racket follow-through is not a body hit (a partner standing there is).
      if (i === this.lastStrikePlayer && this.time - this.lastStrikeTime < 0.3) continue;
      const p = this.players[i]!;
      if (b.pos.y > p.tune.height) continue;
      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const rr = p.tune.bodyRadius + this.world.spec.radius;
      if (dx * dx + dz * dz < rr * rr) {
        // A committed swing about to connect wins over the body.
        if (p.swing === SW_COMMITTED && p.contactTime - this.time < 0.05) continue;
        this.rally.onBody(p.team);
        return;
      }
    }
  }

  // ---- end of rally --------------------------------------------------------------------------

  private pendingPointWinner = -1;

  /** While the ball is dead after a point: the team that won it, else -1 (read by the renderer). */
  get pointWinner(): number {
    return this.phase === PH_DEAD ? this.pendingPointWinner : -1;
  }

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
  windowsFor(i: number, out: ContactWindow[]): number {
    const p = this.players[i]!;
    const team = p.team;
    if (this.phase === PH_TOSS && i === this.score.serverPlayer()) {
      const w = out[0]!;
      w.start = this.tossIdeal - 0.2;
      w.end = this.tossEnd;
      w.ideal = this.tossIdeal;
      return 1;
    }
    if (this.phase !== PH_RALLY || this.rally.hitter === team) return 0;
    // Same look-back as the release is judged with: windows must include the moments just gone, or the ideal
    // of a window you are already in slides forward with the clock and the cue never closes.
    return findWindows(this.pred, p.pos.x, p.pos.z, this.side(team), this.rally.isServe, 1, p.tune, out, this.time - RELEASE_LOOKBACK,
      this.goingOverhead(p));
  }

  /** Fingerprint of the full sim state (determinism checks). */
  hash(): number {
    const h = new Hasher();
    const b = this.ball;
    h.num(this.tick).num(this.time).num(this.phase).num(this.serveNo).num(this.wallsSinceBounce);
    h.num(b.pos.x).num(b.pos.y).num(b.pos.z).num(b.vel.x).num(b.vel.y).num(b.vel.z).num(b.spin.x).num(b.spin.y).num(b.spin.z);
    h.num(b.inNet ? 1 : 0).num(b.netSide).num(b.sideZ).num(b.netW).num(b.netZeta).num(b.rolling ? 1 : 0).num(b.outside ? 1 : 0);
    this.net.hashInto(h);
    for (const p of this.players) {
      h.num(p.pos.x).num(p.pos.z).num(p.vel.x).num(p.vel.z).num(p.swing).num(p.contactTime).num(p.aimX).num(p.aimZ)
        .num(p.aimTouched ? 1 : 0);
    }
    h.num(this.taker[0]!).num(this.taker[1]!).num(this.intentUp[0]!).num(this.intentUp[1]!);
    for (let i = 0; i < 4; i++) h.num(this.rng.s[i]!).num(this.aiRng.s[i]!);
    const st: number[] = [];
    this.score.writeState(st);
    for (const v of st) h.num(v);
    return h.h;
  }
}

export { SURF_GLASS, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH, SHOT_BANDEJA, SHOT_VOLLEY };
export { R_FAULT, R_LET, R_POINT };
