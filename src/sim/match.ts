// MatchSim: the whole deterministic match. step(inputs) advances one 120 Hz tick.
// Rendering, audio and UI read its state and its event ring; nothing outside the sim writes to it.
import { Ball, HIT_FLOOR, HIT_WALL, HIT_NET, HIT_NETCORD, HIT_POST, HIT_ROOF, LEFT_COURT, type BallWorld } from './ball/ball.ts';
import { Prediction, PF_FLOOR, PF_WALL } from './ball/predict.ts';
import { Rng } from './core/rng.ts';
import { DT, TEAM_NEAR } from './core/constants.ts';
import { Hasher } from './core/hash.ts';
import { abs, clamp, floor, max, min, sqrt } from './core/smath.ts';
import { V3 } from './core/v3.ts';
import { copyState } from './core/copyState.ts';
import { SURF_GLASS, WALL_SIDE_LEFT, WALL_SIDE_RIGHT } from './court/court.ts';
import { Score, SIDE_RIGHT, SIDE_LEFT, DEFAULT_FORMAT, EV_GAME, EV_SET, EV_MATCH, EV_CHANGE_ENDS, type MatchFormat } from './rules/score.ts';
import { Rally, R_POINT, R_FAULT, R_LET, R_NONE } from './rules/rally.ts';
import { Player, SW_IDLE, SW_CHARGE, SW_COMMITTED, SW_RECOVER, DEFAULT_TUNING } from './player/player.ts';
import {
  ShotSolver, strike, SHAPES, SHOT_KEYS, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH,
  SHOT_BANDEJA, SHOT_VOLLEY, SHOT_VIBORA, SHOT_CHIQUITA, SHOT_CONTRAPARED, MOD_NONE, MOD_POWER, MOD_PRECISION, type ShotRequest, type ShotResult,
} from './contact/shots.ts';
import { gradeTiming, gradeQuality, G_TOO_EARLY, G_TOO_LATE, type TimingWindows } from './contact/timing.ts';
import { findWindows, BEHIND_MAX, makeWindows, OH_ANY, reachAt, type ContactWindow } from './contact/windows.ts';
import { InputFrame, SHOT_BUTTONS, BTN_POWER, BTN_PRECISION, BTN_OVERHEAD, BTN_VOLLEY } from './input.ts';
import { makeStandPlan, planStand, type StandPlan } from './player/positioning.ts';
import { formationSpot, bounceIsFar, SWITCH_X, type Spot } from './player/formation.ts';
import { styleOf } from './ai/styles.ts';
import { pressureOf } from './ai/pressure.ts';
import { smashLanding } from './contact/smashAim.ts';
import { SimpleAi, WOMENS_SPEED } from './ai/simpleAi.ts';
import { makeWorld, makeNetCloth, type WorldOptions } from './setup.ts';
import type { NetCloth } from './court/netCloth.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };
import practiceData from '../../data/practice.json' with { type: 'json' };

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
/** The ball touched an indoor roof (x, y, z where). */
export const E_ROOF = 19;
export const E_ENDS = 15;
export const E_SWING = 16;
/** Doubles: a player calls the ball (a: CALL_*). */
export const E_CALL = 17;
/** E_CALL's a: the taker's "mine", the partner's "yours", "switch" (the partner takes a lob over us: we cross). */
export const CALL_MINE = 0;
export const CALL_YOURS = 1;
export const CALL_SWITCH = 2;
/** The ball touched a player's body (not the racket): the point ends on it (player = who was hit). */
export const E_BODY = 18;
/** E_WHIFF's y: the swing missed a ball in reach (timing) / there was no ball to hit (none in reach at the release,
 * or not legal to play) / the ball was out of reach (too far or too high or low) at the contact. */
export const WHIFF_TIMING = 0;
export const WHIFF_NOTHING = 1;
export const WHIFF_REACH = 2;

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
  /** E_HIT: relative normal speed of ball and racket face at the impact (m/s). */
  d: number;
  /** E_HIT: where on the face, from its centre (0) to its edge (1); 2 on the frame. */
  q: number;
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
  /** A women's match: they move and hit as women do, and play it differently (data/ai-skill.json `women`). */
  women?: boolean;
  /** Widens timing windows (accessibility). */
  timingScale?: number;
  /** Positioning assist strength 0..1 for human players. */
  assist?: number;
  /** Assisted timing: a swing still held at the right moment goes off by itself (graded Good). */
  autoTiming?: boolean;
  /** One-tap swings (accessibility, with autoTiming): a human's release of the charged shot key is ignored, so a tap
   * charges the swing and assisted timing lets it go. */
  tapSwing?: boolean;
  firstServer?: number;
  /** Between points the players walk back to their places (default); false puts them there at once. */
  walkBack?: boolean;
  /** Practice (data/practice.json, by index; singles, the human player 0): no serves and no score. The coach, player 1,
   * bounces a ball and feeds the drill's next ball with the serve's own motion, then the ball is played out. */
  practice?: number;
}

const TIMING: TimingWindows = tuning.timing;
/** Players in a women's match: the same but for top speed (data/ai-skill.json). */
const WOMENS_TUNING = { ...DEFAULT_TUNING, maxSpeed: DEFAULT_TUNING.maxSpeed * WOMENS_SPEED, sideSpeed: DEFAULT_TUNING.sideSpeed * WOMENS_SPEED, backSpeed: DEFAULT_TUNING.backSpeed * WOMENS_SPEED, fvSpeed: DEFAULT_TUNING.fvSpeed * WOMENS_SPEED };
/** The drills (MatchConfig.practice) with their shots as ids. */
const DRILLS = practiceData.drills.map((d) => ({ ...d, feeds: d.feeds.map((f) => ({ ...f, shotId: (SHOT_KEYS as readonly string[]).indexOf(f.shot) })) }));
/**
 * The serve's ball (docs/research/serve-and-strokes-motion.md §1.3-1.4, 4.1): held at the free hand's release point,
 * ahead of the body and out to the racket side, where it will bounce (pushed straight down, the bounce spot is the
 * contact spot in plan: 0.50 m ahead of the body's centre, the measured 0.52 m for trained players, and 0.55 m out),
 * then pushed into the turf at SERVE_PUSH m/s, as most professionals do: it comes back up to about 0.88 m, just under
 * the waist, about 0.64 s after the release. A plain drop from the hand peaks near the knee (the beginner's serve).
 */
const SERVE_HAND_HEIGHT = 0.95;
const SERVE_HAND_AHEAD = 0.5;
const SERVE_HAND_OUT = 0.55;
const SERVE_PUSH = 3.2;
/** Ideal contact this long before the bounce's apex (within 80 ms of it the height changes by 3 cm or less). */
const SERVE_BEFORE_APEX = 0.02;
/** After a drop nobody swung at, the server picks the ball up: this long before they can drop it again. */
const RETOSS_PAUSE = 0.6;
/**
 * Between points (MatchSim.walking): partners meet first (MEET_GAP m apart, at most MEET_MAX s; they touch rackets),
 * then everyone walks to their places at WALK_SPEED m/s (a walk: review round 6, the critic's #2: at 2.2 it was a
 * trot; FIP allows 20 s between points, a game has
 * a few), within WALK_MAX s in all. Within WALK_DONE m of the spot is there.
 */
const MEET_GAP = 0.8;
const MEET_MAX = 1.2;
const WALK_SPEED = 1.5;
const WALK_MAX = 7;
const WALK_DONE = 0.06;
/**
 * After match point (PH_OVER, MatchSim.overStage): the ball is left to fall and everyone reacts where they stand for
 * OVER_REACT s (1); then both pairs walk to the net (2) at WALK_SPEED, each to their lane (OVER_LANE m off the middle
 * in doubles, the middle in singles) OVER_NET m back from it, within OVER_WALK_MAX s; across it each touches rackets
 * with the opponent in their lane for OVER_TAP s (3), the padel custom at the end of a match; then they step back
 * from the net to OVER_BACK m and stand (4; rackets hanging at their sides would otherwise touch the net).
 */
const OVER_REACT = 3.6;
/**
 * The winners of a doubles match run to each other as the ball drops (after OVER_RUN_AFTER s, at OVER_RUN_SPEED m/s)
 * and embrace, each OVER_HUG m from the middle between them; the avatars do the rest. A win was the same small gesture as
 * a point, with the partners 5 m apart (review round 4, the critic's #2).
 */
const OVER_RUN_AFTER = 0.35;
const OVER_RUN_SPEED = 4.6;
const OVER_HUG = 0.2;
const OVER_LANE = 1.25;
const OVER_NET = 0.4;
const OVER_WALK_MAX = 9;
const OVER_TAP = 1.3;
const OVER_BACK = 0.9;
/** copyFrom's source-to-copy map (module-level: a field would be part of the state it copies). */
const COPY_SEEN = new Map<object, object>();
/** The ball dead after a point before the walk back starts (1.7 s with walkBack off). */
const POINT_DEAD_WALK = 1.2;
/** After a change of ends, the extra dead time for the picture to dip before the cut (s). */
const ENDS_CUT = 0.35;
/** How fast the keys move the aim target (m/s across, m/s in depth). */
const AIM_SPEED_X = 11;
const AIM_SPEED_Z = 9;
/** Default aim depth (fraction of the half) for the overhead key: deep for a bandeja, mid-court for a smash. */
const OVERHEAD_AIM_DEPTH = 0.8;
/** Untouched víbora target: cross-court, this deep (fraction of the half), into the side glass. */
const VIBORA_AIM_DEPTH = 0.68;
/** Untouched smash target: clear the tape by this much at full pace (smashAim.ts), but land no shorter than this. */
const SMASH_NET_MARGIN = 0.45;
const SMASH_MIN_DEPTH = 3.2;
/** Windows are searched from this far back, so a release just after the ideal is still judged against it. */
const RELEASE_LOOKBACK = 0.3;
/** Doubles ball-taking: runs within this (m) count as a tie (forehand in the middle takes it); a decision
 * changes only for a run this much shorter; a contact out of time costs this much. */
const MIDDLE_MARGIN = 0.8;
const SWITCH_MARGIN = 1.0;
const CLAIM_OUT = 20;
/**
 * Calls: a ball is called once its taker has held CALL_AFTER (s) past the strike (about when a player has read it:
 * the 0.14-0.20 s reaction, ai/simpleAi.ts), when the runs are within CALL_MARGIN (m) of each other (a ball either
 * could play) or the taker crosses to the partner's side (a switch: player.formation.ts SWITCH_X). Clear balls
 * aren't called, as in a real pair.
 */
const CALL_AFTER = 0.25;
const CALL_MARGIN = 1.5;

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
  /**
   * Walking back between points, in PH_SETUP: 0 no (the serve can come), 1 partners meeting, 2 to the places
   * (walkHome*). A human's key press ends it (everyone at their place).
   */
  walking = 0;
  readonly walkHomeX: Float64Array;
  readonly walkHomeZ: Float64Array;
  readonly walkHomeF: Float64Array;
  /** When the meeting (stage 1) and the whole walk give up and everyone is put in place. */
  private walkStage = -0.5;
  private walkUntil = -0.5;
  /** The next startPoint begins with the partners meeting (a point was played, not a fault or let). */
  private walkMeet = 0;
  /** The dead time is held ENDS_CUT longer after a change of ends, then everyone is put on the other side. */
  private endsCut = 0;
  /**
   * This dead time ends with everyone put in their places at once, not walking there (a change of ends, or walkBack
   * off): presentation cuts away over it (ui/transitions.ts).
   */
  get cutComing(): boolean {
    return this.phase === PH_DEAD && (this.cfg.walkBack === false || this.endsCut !== 0);
  }
  /** Distance left from walkDrive (a field: a returned double would be boxed). */
  private walkD = -0;
  /** walkDrive's target (fields, as walkD). */
  private walkSpeed = WALK_SPEED;
  private overHugAt = -0.5;
  private walkTX = -0;
  private walkTZ = -0;
  /**
   * After match point (see OVER_*): 0 not over yet, 1 reacting, 2 walking to the net, 3 touching rackets across it,
   * 4 done. Each player's spot at the net (overX/Z) and the opponent across from them (overMate).
   */
  overStage = 0;
  private overUntil = -0.5;
  readonly overX: Float64Array;
  readonly overZ: Float64Array;
  readonly overMate: Int32Array;
  private readonly overAt = new V3();
  serveNo = 1;
  tossIdeal = 0;
  tossEnd = 0;
  /** Serve target box for the current point (-0s: doubles from the start, like Rally.box; z0/z1 swap 0 and a fraction). */
  readonly box = { x0: -0, x1: -0, z0: -0, z1: -0 };
  /** Last strike: for body-hit grace and presentation. */
  lastStrikeTeam = -1;
  lastStrikePlayer = -1;
  lastStrikeTime = -10;
  /** Doubles: which player of each team is going for the incoming ball (-1: none / not decided). */
  readonly taker = [-1, -1];
  /** A human pushing the movement keys this tick (not aiming with them): they are going, so they don't hop. */
  private readonly keysMove = new Uint8Array(4);
  /** Doubles: what an AI striker decided its pair does after its shot: 1 go up to the net, 0 stay back, -1 none. */
  readonly intentUp = [-1, -1];
  private readonly takerVersion = [-1, -1];
  /** Doubles: each player's side of the pair when the point started (+1 right of the partner as they face the net,
   * -1 left; 0 none): a pair that switched on a lob crosses back when there is time (formation.ts). */
  readonly homeLane = [0, 0, 0, 0];
  /** Doubles calls: whether this ball has been called (per team), and the last claim decision's run gap and switch. */
  private readonly called = [0, 0];
  private readonly claimGap = new Float64Array(2);
  /**
   * Doubles, per team: 1 once this ball has been judged far enough from bouncing (before its bounce) for a
   * switched pair of AIs to cross back to their own sides; held until the team's next strike, so the crossing
   * isn't re-judged (and abandoned half-way) once the ball has bounced or come off the glass.
   */
  readonly crossBack = [0, 0];

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
  // Every field is written at each contact before the solve; the -0s make the fractions doubles from the start (a
  // first Perfect's quality 1 then a Good's 0.85 changed the request's map mid-match; see Ball's fields).
  private readonly req: ShotRequest = {
    shot: 0, mod: 0, targetX: -0, targetZ: -0, quality: -0, timingDelta: -0, handSide: 1, moving: -0, stretch: -0, power: -0, control: -0, spinScale: -0, motor: -0, bodyX: -0, bodyZ: -0,
  };
  private readonly res: ShotResult = { reachable: true, speed: 0, idealX: 0, idealZ: 0 };
  /** Aim captured at release, per player: relative (-1..1) or absolute. */
  private readonly aim: Array<{ abs: boolean; x: number; y: number; tx: number; tz: number }>;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.doubles = cfg.doubles === true;
    const n = this.doubles ? 4 : 2;
    this.walkHomeX = new Float64Array(n);
    this.walkHomeZ = new Float64Array(n);
    this.walkHomeF = new Float64Array(n);
    this.overX = new Float64Array(n);
    this.overZ = new Float64Array(n);
    this.overMate = new Int32Array(n);
    this.world = makeWorld(cfg.world);
    this.net = makeNetCloth(this.world);
    this.ball.cloth = this.net;
    this.ball.wears = true;
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
    const tune = cfg.women ? WOMENS_TUNING : DEFAULT_TUNING;
    for (let i = 0; i < n; i++) {
      this.players.push(new Player(i, tune));
      if (cfg.lefty?.[i]) this.players[i]!.handed = -1;
      this.ai.push(cfg.human[i] ? null : new SimpleAi(i, lv[i & 1]!, styleOf(cfg.aiStyle?.[i]), cfg.women === true));
      if (!cfg.human[i]) { this.players[i]!.glassWait = this.ai[i]!.glassWait; this.players[i]!.ohArrive = this.ai[i]!.ohArrive; }
      this.aiFrames.push(new InputFrame());
      this.stand.push(makeStandPlan());
      this.claim.push(makeStandPlan());
      this.aim.push({ abs: false, x: 0, y: 0, tx: 0, tz: 0 });
      this.prevPlayers.push({ x: 0, z: 0 });
    }
    this.rally.outOfCourtPlay = false;
    for (let i = 0; i < EVENT_RING; i++) {
      this.events.push({ seq: -1, kind: 0, time: 0, team: -1, player: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0, d: 0, q: 0 });
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
    e.d = 0; e.q = 0;
  }

  // ---- point setup ---------------------------------------------------------------------------

  private startPoint(): void {
    const c = this.world.court;
    const sc = this.score;
    const sTeam = sc.serverTeam();
    const rTeam = 1 - sTeam;
    // Walk back from where everyone stands (not at the start, and not across the net at a change of ends: the
    // presentation cuts there).
    let walk = this.cfg.walkBack !== false && this.tick > 0;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      this.walkHomeX[i] = p.pos.x;
      this.walkHomeZ[i] = p.pos.z;
      if (p.pos.z * this.side(p.team) <= 0) walk = false;
    }
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
      // Server's partner at the net on the other side; receiver's partner back on the other side, a step in. Both
      // vary from point to point, as pros' do (review round 3, the pro's Low #12: always 2.60 m and 7.60 m): the net
      // player 2.2-3.2 m from the net and 2.0-2.9 m off the middle, the receiver's partner from just inside the
      // service line to 7.8 m.
      const rr = this.aiRng;
      const sp = this.players[server.index ^ 2]!;
      sp.pos.set(-sideSign * c.halfW * (0.4 + 0.18 * rr.next()), 0, ss * (2.2 + rr.next()));
      sp.facing = server.facing;
      const rp = this.players[recv.index ^ 2]!;
      rp.pos.set(sideSign * c.halfW * 0.5, 0, -ss * (c.halfL - 3.4 + 1.2 * rr.next()));
      rp.facing = recv.facing;
    }
    if (this.cfg.practice !== undefined) recv.pos.z = -ss * DRILLS[this.cfg.practice]!.spot;
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
    this.called[0] = 0;
    this.called[1] = 0;
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
    this.phase = PH_SETUP;
    this.phaseUntil = this.time + 0.5;
    this.walking = 0;
    if (walk) {
      // The places are the walk's ends: back to where everyone was.
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i]!;
        const x = this.walkHomeX[i]!, z = this.walkHomeZ[i]!;
        this.walkHomeX[i] = p.pos.x;
        this.walkHomeZ[i] = p.pos.z;
        this.walkHomeF[i] = p.facing;
        p.pos.x = clamp(x, p.minX, p.maxX);
        p.pos.z = clamp(z, p.minZ, p.maxZ);
      }
      this.walking = this.doubles && this.walkMeet !== 0 ? 1 : 2;
      this.walkStage = this.time + MEET_MAX;
      this.walkUntil = this.time + WALK_MAX;
      this.phaseUntil = this.time + WALK_MAX + 1;
    }
    this.walkMeet = 0;
    this.endsCut = 0;
    this.placeBallInHand();
    for (const a of this.ai) a?.reset();
  }

  /** Everyone at their place for the serve (the walk done, given up, or skipped). */
  private endWalk(): void {
    if (this.walking === 0) return;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      p.pos.x = this.walkHomeX[i]!;
      p.pos.z = this.walkHomeZ[i]!;
      p.facing = this.walkHomeF[i]!;
      p.vel.set(0, 0, 0);
    }
    this.walking = 0;
    this.phaseUntil = this.time + 0.5;
    this.placeBallInHand();
  }

  /** One tick of the walk back for every player (instead of their inputs' movement). */
  private walkStep(): void {
    let far = 0;
    const meet = this.walking === 1;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      this.walkDrive(i, meet);
      p.clock = this.time;
      p.move();
      if (this.walkD > (meet ? 0.25 : WALK_DONE)) far++;
    }
    if (meet && (far === 0 || this.time >= this.walkStage)) this.walking = 2;
    else if (!meet && (far === 0 || this.time >= this.walkUntil)) this.endWalk();
  }

  /** Steer player i to their place, or (meeting) to MEET_GAP from their partner; the distance left in walkD. */
  private walkDrive(i: number, meet: boolean): void {
    const p = this.players[i]!;
    let tx = this.walkHomeX[i]!;
    let tz = this.walkHomeZ[i]!;
    if (meet) {
      const q = this.players[i ^ 2]!;
      let ex = p.pos.x - q.pos.x;
      let ez = p.pos.z - q.pos.z;
      const el = sqrt(ex * ex + ez * ez);
      if (el > 1e-6) { ex /= el; ez /= el; } else { ex = 1; ez = 0; }
      tx = (p.pos.x + q.pos.x) * 0.5 + ex * MEET_GAP * 0.5;
      tz = (p.pos.z + q.pos.z) * 0.5 + ez * MEET_GAP * 0.5;
    }
    this.walkTX = tx;
    this.walkTZ = tz;
    this.steerWalk(p);
  }

  /** Walk player p towards (walkTX, walkTZ), braking to a stop on it; the distance left in walkD. */
  private steerWalk(p: Player): void {
    const dx = this.walkTX - p.pos.x;
    const dz = this.walkTZ - p.pos.z;
    const d = sqrt(dx * dx + dz * dz);
    this.walkD = d;
    if (d < 0.04) { p.driveX = 0; p.driveZ = 0; return; }
    p.look();
    const lx = p.qx;
    const lz = p.qz;
    p.qx = dx / d;
    p.qz = dz / d;
    p.topToward(lx, lz);
    let v = sqrt(2 * 0.8 * p.tune.brake * d);
    if (v > this.walkSpeed) v = this.walkSpeed;
    const want = v / p.qTop;
    p.driveX = (dx / d) * want;
    p.driveZ = (dz / d) * want;
  }

  /** One tick after match point (see OVER_*), for every player (instead of their inputs). */
  private overStep(): void {
    const n = this.players.length;
    if (this.overStage === 1 && this.time >= this.overUntil) this.overTargets();
    const stage = this.overStage;
    let far = 0;
    for (let i = 0; i < n; i++) {
      const p = this.players[i]!;
      p.clock = this.time;
      let d = 0;
      const hug = stage === 1 && this.doubles && p.team === this.score.winner;
      if (hug && this.time >= this.overHugAt) {
        // Half way to the partner, less the room two bodies take.
        const q = this.players[i ^ 2]!;
        const ax = q.pos.x - p.pos.x, az = q.pos.z - p.pos.z;
        const gap = sqrt(ax * ax + az * az);
        const stop = gap > 1e-6 ? max(0, 0.5 - OVER_HUG / gap) : 0;
        this.walkTX = p.pos.x + ax * stop;
        this.walkTZ = p.pos.z + az * stop;
        this.walkSpeed = OVER_RUN_SPEED;
        this.steerWalk(p);
        this.walkSpeed = WALK_SPEED;
      } else if (stage === 2 || stage === 4) {
        this.walkTX = this.overX[i]!;
        this.walkTZ = stage === 2 ? this.overZ[i]! : this.overZ[i]! * (OVER_BACK / OVER_NET);
        this.steerWalk(p);
        d = this.walkD;
        if (d > WALK_DONE) far++;
      } else {
        p.driveX = 0;
        p.driveZ = 0;
      }
      p.move();
      // Watching the ball fall, then looking where they walk, then at the opponent across the net.
      const at = this.overAt;
      if (hug && this.time >= this.overHugAt) at.copy(this.players[i ^ 2]!.pos);
      else if (stage === 1) at.copy(this.ball.pos);
      else if (stage === 2 && d > 0.6) at.set(this.overX[i]!, 0, this.overZ[i]!);
      else at.copy(this.players[this.overMate[i]!]!.pos);
      p.faceTowards(at);
    }
    if (stage === 2 && (far === 0 || this.time >= this.overUntil)) {
      this.overStage = 3;
      this.overUntil = this.time + OVER_TAP;
    } else if (stage === 3 && this.time >= this.overUntil) this.overStage = 4;
  }

  /** Each player's spot at the net and the opponent across from them (stage 2 starts). */
  private overTargets(): void {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const p = this.players[i]!;
      // Where they are, not side(): nobody changes ends after the last game.
      const s = p.pos.z >= 0 ? 1 : -1;
      let x = 0;
      if (this.doubles) {
        const q = this.players[i ^ 2]!;
        x = p.pos.x > q.pos.x || (p.pos.x === q.pos.x && i < 2) ? OVER_LANE : -OVER_LANE;
      }
      this.overX[i] = x;
      this.overZ[i] = s * OVER_NET;
    }
    for (let i = 0; i < n; i++) {
      let m = i ^ 1;
      for (let j = 1 - (i & 1); j < n; j += 2) if (this.overX[j] === this.overX[i]) m = j;
      this.overMate[i] = m;
    }
    this.overStage = 2;
    this.overUntil = this.time + OVER_WALK_MAX;
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
    this.ball.pos.set(p.pos.x + ss * SERVE_HAND_OUT * p.handed, SERVE_HAND_HEIGHT, p.pos.z - ss * SERVE_HAND_AHEAD);
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.ball.outside = false;
    this.ball.rolling = false;
    this.ball.ahead = 0;
    this.ball.clearNet();
  }

  // ---- main step -----------------------------------------------------------------------------

  /** Advance one tick. `inputs[player]` is a human player's frame (ignored for AI players). */
  step(inputs: ReadonlyArray<InputFrame | null>): void {
    const t0 = this.time;
    // Every player's clock is this tick's before anything plans with it (startLag reads it).
    for (let k = 0; k < this.players.length; k++) this.players[k]!.clock = t0;
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
      // After match point: nobody plays on. The ball falls and the net settles; the players play the end of the
      // match out (overStep).
      this.overStep();
      this.stepBall(DT, t0);
      if (!this.ballCoupled && this.net.awake) this.net.freeTick();
      this.time = t1;
      this.tick++;
      for (let i = 0; i < n; i++) {
        const p = this.players[i]!;
        if (p.swing === SW_RECOVER && this.time >= p.recoverUntil) p.swing = SW_IDLE;
      }
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
    if (this.walking > 0) this.walkStep();
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
        // The dropped ball bounced twice and nobody swung at it: no serve yet (6.6: a serve is the contact or an
        // intentional attempt to hit), so the server picks it up and drops it again. A swing that missed was a
        // fault already (7.1.b).
        this.retoss();
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
  /** Where the dropped ball bounced (6.2: in the server's own area). */
  private tossBX = 0;
  private tossBZ = 0;

  private stepBall(dt: number, tStart: number): void {
    const b = this.ball;
    b.step(this.world, dt, this.rng);
    if (b.wearDirty) b.applyWear(this.world);
    if (b.coupled) this.ballCoupled = true;
    let recompute = false;
    let flags = 0;
    for (let i = 0; i < b.eventCount; i++) {
      const e = b.events[i]!;
      const t = tStart + e.t;
      switch (e.kind) {
        case HIT_FLOOR:
          if (this.phase === PH_TOSS && this.rally.hitter < 0) {
            if (this.tossBounces === 0) { this.tossBX = e.x; this.tossBZ = e.z; }
            this.tossBounces++;
          }
          else this.rally.onFloor(e.x, e.z);
          this.emitAt(E_FLOOR, t, e.surface, 0, e.speed, e.x, e.y, e.z);
          this.wallsSinceBounce = 0;
          flags |= PF_FLOOR;
          recompute = true;
          break;
        case HIT_WALL: {
          const wallSide = e.wall === WALL_SIDE_LEFT || e.wall === WALL_SIDE_RIGHT ? (e.z >= 0 ? 1 : -1) : e.z > 0 ? 1 : -1;
          this.rally.onWall(e.surface, wallSide, e.x, e.y, e.z);
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
        case HIT_ROOF:
          this.rally.onRoof();
          this.emitAt(E_ROOF, t, 0, 0, 0, e.x, e.y, e.z);
          break;
      }
    }
    // Caught in the net, or under a pocket of it, the ball can be past the net line without having crossed.
    if (!b.inNet) this.rally.onBallZ(b.sideZ);
    if (recompute && (this.phase === PH_RALLY || this.phase === PH_TOSS)) {
      this.pred.strikeT = this.lastStrikeTime;
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
    p.heldMod = (f.held & BTN_POWER) !== 0 ? MOD_POWER : (f.held & BTN_PRECISION) !== 0 ? MOD_PRECISION : MOD_NONE;
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
      // Holding the volley key plans the ball in the air; with no volley in reach it plans as usual (and the
      // contact turns into a block off the bounce).
      const volleyKey = this.goingVolley(p);
      const live = st.valid && t0 < st.t + 0.1 && st.overhead === overhead && st.volleyKey === volleyKey;
      const close = live && st.t - t0 < 0.35;
      if (this.pred.version !== st.version || !live || (!close && (this.tick & 7) === 0)) {
        const keep = live ? st.t : -1;
        if (!(close && planStand(this.pred, p, s, t0, this.rally.isServe, st, keep, true, overhead, volleyKey))) {
          planStand(this.pred, p, s, t0, this.rally.isServe, st, keep, false, overhead, volleyKey);
          if (volleyKey && !(st.valid && st.inTime && st.volley)) {
            planStand(this.pred, p, s, t0, this.rally.isServe, st, -1, false, overhead, false);
            st.volleyKey = true;
          }
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
    this.keysMove[i] = human && !keysAim && abs(f.moveX) + abs(f.moveY) > 0.1 ? 1 : 0;
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
      const shot = e.button === BTN_OVERHEAD ? SHOT_BANDEJA : e.button === BTN_VOLLEY ? SHOT_VOLLEY
        : SHOT_BUTTONS.indexOf(e.button as never);
      if (shot < 0) continue;
      // Presses act from this tick; releases keep their exact time so a late-delivered event is still graded fairly.
      if (e.press) this.press(i, shot, max(e.t, t0));
      else if (p.swing === SW_CHARGE && p.shot === shot && !(human && this.cfg.tapSwing && this.cfg.autoTiming)) {
        // The modifiers as they were at this release: f.held is the tick's end; undo this tick's later changes.
        let h = f.held;
        for (let j = f.evCount - 1; j > k; j--) {
          const l = f.ev[j]!;
          if (l.button === BTN_POWER || l.button === BTN_PRECISION) h = l.press ? h & ~l.button : h | l.button;
        }
        this.relHeld = h;
        this.releaseSwing(i, e.t, f);
      }
    }
    // Assisted timing: still holding when the ideal moment arrives, the swing goes off by itself.
    if (this.cfg.autoTiming && human && p.swing === SW_CHARGE && this.phase !== PH_SETUP) {
      // Not while the planned contact is still out of reach (still running there): a swing then meets nothing.
      const focus = this.autoIdeal(i);
      const ideal = this.focusInReach ? focus : -1;
      // Released just before Perfect, so it grades Good whatever the timing scale. Early rather than late: an
      // early swing still meets the ball at the ideal moment (an overhead stays high, a ball at the body is
      // met in front), a late one meets it late.
      const early = (TIMING.perfect + 0.35 * (TIMING.good - TIMING.perfect)) * this.windowScale(i);
      // Not at a ball already gone past the body (the player got there too late): that swing meets nothing, and
      // the ball may still be played after its bounce. (Servers running in were passed by the return at their feet
      // and swung at it 60 ms late.)
      const k = this.pred.indexAt(t0);
      const gone = !this.focusContra && k >= 0 && s * (this.pred.z[k]! - p.pos.z) > BEHIND_MAX;
      if (ideal >= 0 && ideal - early < t0 + DT && !gone) this.releaseSwing(i, max(t0, ideal - early), f);
    }
    // Safety: a swing held far too long releases itself, unless the ball it waits for is still on its way (a
    // lob pressed for at the opponent's strike can hang over 3 s before the overhead: those used to go off by
    // themselves, graded against nothing). Past the contact by a margin, or held 8 s, it goes.
    if (p.swing === SW_CHARGE && t0 - p.chargeStart > 3) {
      const ideal = t0 - p.chargeStart > 8 ? -1 : this.focusIdeal(i);
      if (ideal < 0 || t0 > ideal + 0.25) this.releaseSwing(i, t0, f);
    }

    p.clock = t0;
    if (this.walking > 0) { /* walkStep moves everyone */ }
    else if (!isServerSetup && this.phase !== PH_DEAD) { p.driveX = dx; p.driveZ = dz; p.move(); }
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
        if (hitter === team && this.crossBack[team] === 0 && this.rally.bounces === 0 && this.ai[team] && this.ai[team + 2]
          && bounceIsFar(this)) this.crossBack[team] = 1;
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
      this.claimGap[team] = ca < CLAIM_OUT && cb < CLAIM_OUT ? abs(ca - cb) : CLAIM_OUT;
    }
    for (let team = 0; team < 2; team++) this.callBall(team);
  }

  /** Doubles: a contested ball or a switch is called once, by an AI: the taker ("mine") or the partner ("yours",
   * "switch"); a human's partner speaks for the pair. */
  private callBall(team: number): void {
    const k = this.taker[team]!;
    if (k < 0 || this.called[team] !== 0 || this.rally.isServe || this.time - this.lastStrikeTime < CALL_AFTER) return;
    // A switch is the formation's own rule (formation.ts) on the taker's real plan, so the call matches what the
    // pair does; an AI taker still reading the ball hasn't planned it yet: wait.
    const plan = this.ai[k] ? this.ai[k]!.standPlan : this.stand[k]!;
    if (this.ai[k] && !plan.valid) return;
    const s = this.side(team);
    const lane = (this.players[k ^ 2]!.pos.x - this.players[k]!.pos.x) * s > 0 ? 1 : -1;
    const sw = plan.valid && plan.bx * s * lane > SWITCH_X;
    if (!sw && this.claimGap[team]! >= CALL_MARGIN) return;
    this.called[team] = 1;
    const mate = k ^ 2;
    // The switch is called by the player the ball went over (they cross); "mine" by the taker. A human doesn't
    // speak: then the AI partner calls "yours" (or the switch).
    if (sw) this.emitP(E_CALL, this.ai[mate] ? mate : k, CALL_SWITCH);
    else if (this.ai[k]) this.emitP(E_CALL, k, CALL_MINE);
    else if (this.ai[mate]) this.emitP(E_CALL, mate, CALL_YOURS);
  }

  /** An AI beaten by the ball it is charged for lets the swing go unmade (ai/simpleAi.ts: no swing at the air). */
  standDown(i: number): void {
    const p = this.players[i]!;
    if (this.ai[i] && p.swing === SW_CHARGE) p.swing = SW_IDLE;
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

  /**
   * The server's own area (6.1-6.2): behind the service line, between the centre line's prolongation and the side
   * wall; a ball on a line has not crossed it. The server's side is across from the box served into.
   */
  private inServerArea(x: number, z: number, team: number): boolean {
    const w = this.rally.lineTolerance;
    const bx = this.box;
    const across = (bx.x0 + bx.x1 > 0 ? -x : x);
    return z * this.side(team) >= this.world.court.def.serviceLineFromNet - w && across >= -w;
  }

  /**
   * Partners can't stand in each other: push apart when closer than two bodies. Before the serve the server stands
   * where they are and the partner gives way (a push moved the server and the ball in hand over the line).
   */
  private separatePartners(): void {
    const setup = this.phase === PH_SETUP || this.phase === PH_TOSS;
    const server = this.score.serverPlayer();
    for (let team = 0; team < 2; team++) {
      const p = this.players[team]!;
      const q = this.players[team + 2]!;
      const minD = p.tune.bodyRadius + q.tune.bodyRadius + 0.15;
      let dx = q.pos.x - p.pos.x;
      let dz = q.pos.z - p.pos.z;
      let d = sqrt(dx * dx + dz * dz);
      if (d >= minD) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const ux = dx / d;
      const uz = dz / d;
      const pk = setup && server === team ? 0 : setup && server === team + 2 ? 1 : 0.5;
      const pp = (minD - d) * pk, pq = (minD - d) * (1 - pk);
      p.pos.x = clamp(p.pos.x - ux * pp, p.minX, p.maxX);
      p.pos.z = clamp(p.pos.z - uz * pp, p.minZ, p.maxZ);
      q.pos.x = clamp(q.pos.x + ux * pq, q.minX, q.maxX);
      q.pos.z = clamp(q.pos.z + uz * pq, q.minZ, q.maxZ);
    }
  }

  /** The player is holding (or has just released) the overhead key. */
  private goingOverhead(p: Player): boolean {
    return p.shot === SHOT_BANDEJA && (p.swing === SW_CHARGE || p.swing === SW_COMMITTED);
  }

  /**
   * The back glass's |z| if player i is going for a contrapared (an AI's plan, or a human's stand plan while a ground
   * stroke is held), else 0: findWindows' `contraGlass`.
   */
  contraGlass(i: number): number {
    const p = this.players[i]!;
    const ai = this.ai[i];
    if (ai) return ai.contra ? this.world.court.halfL : 0;
    const st = this.stand[i]!;
    return st.valid && st.contra && p.swing === SW_CHARGE && !this.goingOverhead(p) && !this.goingVolley(p) ? this.world.court.halfL : 0;
  }

  /** Height and modifier of the contact shotFor() decides on (fields: doubles passed as arguments get boxed), and
   * whether it is a contrapared window. */
  private shotHeight = 0;
  private shotMod = 0;
  private shotContra = false;

  /**
   * The shot a player's key and modifier make of a contact at shotHeight, in the air or not. One place for
   * contact() and for judging the release (each shot has its own timing windows).
   */
  private shotFor(p: Player, inAir: boolean): number {
    if (this.shotContra) return SHOT_CONTRAPARED;
    const t = p.tune;
    const y = this.shotHeight;
    const k = p.shot;
    if (k === SHOT_BANDEJA) {
      // Overhead key: a bandeja, a smash with power held, a víbora with precision held. A ball that has dropped
      // too low is sliced instead.
      if (y >= t.overheadHeight - 0.3) return this.shotMod === MOD_POWER ? SHOT_SMASH : this.shotMod === MOD_PRECISION ? SHOT_VIBORA : SHOT_BANDEJA;
      return inAir ? SHOT_VOLLEY : SHOT_SLICE;
    }
    if (k === SHOT_VOLLEY) {
      // Volley key: a punch volley in the air (Space: flat and hard, by the power modifier); a ball above the
      // head is met as an overhead, and a ball that has bounced after all is blocked back as a short slice.
      if (y >= t.overheadHeight) return this.shotMod === MOD_POWER ? SHOT_SMASH : SHOT_BANDEJA;
      return inAir ? SHOT_VOLLEY : SHOT_SLICE;
    }
    if (y >= t.overheadHeight && k !== SHOT_LOB && k !== SHOT_DROP) return k === SHOT_SLICE ? SHOT_BANDEJA : SHOT_SMASH;
    if (inAir && (k === SHOT_DRIVE || k === SHOT_SLICE)) return SHOT_VOLLEY;
    // Topspin key with precision: a chiquita, soft and dipping to the feet of the players at the net.
    if (k === SHOT_TOPSPIN && this.shotMod === MOD_PRECISION) return SHOT_CHIQUITA;
    return k;
  }

  /** The player is holding (or has just released) the volley key. */
  private goingVolley(p: Player): boolean {
    return p.shot === SHOT_VOLLEY && (p.swing === SW_CHARGE || p.swing === SW_COMMITTED);
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
    // A speed, as a fraction of the top speed that way (the drive is scaled by it in Player.move).
    p.look();
    const lx = p.qx;
    const lz = p.qz;
    p.qx = dx / d;
    p.qz = dz / d;
    p.topToward(lx, lz);
    const g = k * min(1, sqrt(2 * t.brake * 0.8 * d) / p.qTop);
    this.assistX = (dx / d) * g;
    this.assistZ = (dz / d) * g;
  }

  /** Move the aim target with the keys (or put it under the mouse), kept inside a sensible landing area. */
  private steerAim(p: Player, f: InputFrame, s: number, serve: boolean): void {
    const c = this.world.court;
    if (f.aimAbs || abs(f.moveX) + abs(f.moveY) > 0.1) p.aimTouched = true;
    else if (!p.aimTouched && !serve && p.shot === SHOT_BANDEJA) {
      // An overhead target nobody has steered follows the shot: deep for a bandeja; for a smash (Space) the
      // shortest landing at which a full-pace smash from the planned contact clears the net with margin.
      // Near the net that is mid-court, and the steep bounce can leave the court; from deep it lands deeper.
      if ((f.held & BTN_POWER) !== 0) {
        const st = this.stand[p.index]!;
        const back = abs(st.valid ? st.bz : p.pos.z);
        const h = st.valid ? st.by : p.tune.overheadIdealHeight;
        p.aimZ = -s * smashLanding(c.netHeightAt(0), back, h, SMASH_NET_MARGIN, SMASH_MIN_DEPTH, c.halfL - 2.0);
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
      // A human's key skips the walk back.
      if (this.walking > 0) { if (!this.ai[i]) this.endWalk(); return; }
      if (i !== this.score.serverPlayer() || t < this.phaseUntil) return;
      // Drop the ball for the serve.
      this.phase = PH_TOSS;
      this.tossBounces = 0;
      this.placeBallInHand();
      this.ball.vel.set(0, -SERVE_PUSH, 0);
      this.pred.strikeT = t;
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

  /** Back to the server's set-up with the ball in hand, the same serve to come (no swing was made at the drop). */
  private retoss(): void {
    this.phase = PH_SETUP;
    this.phaseUntil = this.time + RETOSS_PAUSE;
    this.tossBounces = 0;
    const p = this.players[this.score.serverPlayer()]!;
    if (p.swing === SW_CHARGE) p.swing = SW_IDLE;
    // An AI server plans its drop again (its press is spent: it would otherwise wait for a release forever).
    this.ai[p.index]?.reset();
    this.placeBallInHand();
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
    this.tossIdeal = apex >= 0 ? pr.t[apex]! - SERVE_BEFORE_APEX : this.time + 0.5;
  }

  /** The buttons held at the release being handled (-1: f.held). */
  private relHeld = -1;

  private releaseSwing(i: number, t: number, f: InputFrame): void {
    const p = this.players[i]!;
    const team = p.team;
    p.release = t;
    const held = this.relHeld >= 0 ? this.relHeld : f.held;
    this.relHeld = -1;
    p.mod = (held & BTN_POWER) !== 0 ? MOD_POWER : (held & BTN_PRECISION) !== 0 ? MOD_PRECISION : MOD_NONE;
    p.heldMod = p.mod;
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
    let scale = this.ai[i] ? 1 : this.cfg.timingScale ?? 1;

    if (this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0) {
      scale *= SHAPES[SHOT_SERVE]!.timing ?? 1;
      const delta = t - this.tossIdeal;
      p.timingDelta = delta;
      p.grade = gradeTiming(delta, TIMING, scale);
      if (abs(delta) > TIMING.miss * scale) {
        // 6.6: the swing is the serve; missing the ball is a fault (7.1.b).
        this.rally.onServeMissed();
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
      p.shot === SHOT_BANDEJA, p.shot === SHOT_VOLLEY, this.ai[i] ? this.ai[i].ohKind : OH_ANY, this.contraGlass(i));
    let w: ContactWindow | null = null;
    for (let k = 0; k < n; k++) {
      const c = this.windows[k]!;
      if (t > c.end + TIMING.miss * scale) continue;
      if (!w || abs(t - c.ideal) < abs(t - w.ideal)) w = c;
    }
    if (!w || this.rally.hitter === team) {
      this.whiff(i, t, 0, WHIFF_NOTHING);
      return;
    }
    // Each shot has its own windows: a punch volley barely turns the face, a víbora brushes across the ball at speed.
    // The AI is judged on them too (Phase 4; its timing spread was refit with them).
    this.shotHeight = w.height;
    this.shotMod = p.mod;
    this.shotContra = w.contra;
    scale *= SHAPES[this.shotFor(p, w.volley)]!.timing ?? 1;
    this.shotContra = false;
    const delta = t - w.ideal;
    p.timingDelta = delta;
    p.grade = gradeTiming(delta, TIMING, scale);
    // A late release whose ball is already past the body (as contact() judges it) is too late whatever the timing
    // setting: the accessibility scale widens the grades, not the court (a "Good" volley 70 ms late was then cut at
    // contact as out of reach).
    if (delta > 0 && !w.contra) {
      const k = this.pred.indexAt(t);
      if (k >= 0 && s * (this.pred.z[k]! - p.pos.z) > BEHIND_MAX + 0.25) p.grade = G_TOO_LATE;
    }
    if (abs(delta) > TIMING.miss * scale) {
      this.whiff(i, t);
      return;
    }
    p.contactTime = delta < 0 ? w.ideal : max(t, w.ideal);
    if (p.contactTime < this.time) p.contactTime = this.time;
    p.contra = w.contra;
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
    // Every field this sets is set on every path: the HUD and the cue call this between steps, and the sim reads
    // focusHeight / focusVolley (assisted timing), so nothing a render-side call leaves behind may differ.
    const st = this.stand[i]!;
    this.focusInReach = true;
    this.focusHeight = st.valid ? st.by : 1;
    this.focusVolley = st.valid && st.volley;
    this.focusContra = st.valid && st.contra;
    if (this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0) return this.tossIdeal;
    // Doubles: no cue for a ball the partner is taking (holding a shot key claims it, and then it is ours).
    if (this.doubles && this.taker[this.players[i]!.team] !== i) return -1;
    const n = this.windowsFor(i, this.focusWins);
    let best = -1;
    let bestGap = 1e9;
    for (let k = 0; k < n; k++) {
      const w = this.focusWins[k]!;
      if (st.valid) {
        const gap = st.t < w.start ? w.start - st.t : st.t > w.end ? st.t - w.end : 0;
        if (gap < bestGap) { bestGap = gap; best = w.ideal; this.focusHeight = w.height; this.focusVolley = w.volley; this.focusContra = w.contra; }
      } else if (w.ideal >= this.time - 0.05 && (best < 0 || w.ideal < best)) {
        best = w.ideal;
        this.focusHeight = w.height;
        this.focusVolley = w.volley;
        this.focusContra = w.contra;
      }
    }
    // Not in reach of the planned contact yet (still running there): cue the planned moment itself.
    this.focusInReach = !st.valid || (best >= 0 && bestGap <= 0.12);
    if (!this.focusInReach) return st.t;
    return best;
  }

  /** Set by focusIdeal: false while the planned contact is still out of reach from where the player is. */
  focusInReach = true;
  /** Set by focusIdeal: the height of the focused contact and whether it is in the air. */
  private focusHeight = 1;
  private focusVolley = false;
  /** Set by focusIdeal: the focused contact is a contrapared (the HUD names it). */
  focusContra = false;

  /**
   * The timing-window scale for the swing player i is holding: the timing setting (humans) times the shot's own
   * windows (`timing` in data/shots.json), for the contact the cue is showing. Call after focusIdeal(i).
   */
  windowScale(i: number): number {
    const p = this.players[i]!;
    const base = this.ai[i] ? 1 : this.cfg.timingScale ?? 1;
    if (this.phase === PH_TOSS && i === this.score.serverPlayer() && this.rally.hitter < 0) return base * (SHAPES[SHOT_SERVE]!.timing ?? 1);
    if (p.swing !== SW_CHARGE) return base;
    this.shotHeight = this.focusHeight;
    this.shotMod = p.heldMod;
    this.shotContra = this.focusContra;
    const k = SHAPES[this.shotFor(p, this.focusVolley)]!.timing ?? 1;
    this.shotContra = false;
    return base * k;
  }

  /** `reach` > 0: the swing was on time but the ball was this far away (out of reach). `kind`: WHIFF_*. */
  private whiff(i: number, t: number, reach = 0, kind = WHIFF_TIMING): void {
    const p = this.players[i]!;
    p.swing = SW_RECOVER;
    p.contra = false;
    p.recoverUntil = t + p.tune.recoverTime;
    p.lastContactTime = t;
    if (p.grade < 0) p.grade = p.timingDelta < 0 ? G_TOO_EARLY : G_TOO_LATE;
    this.emitP(E_WHIFF, i, p.shot, p.grade, p.timingDelta, reach, kind);
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
        && !(this.rally.isServe && i !== this.score.receiverPlayer())
        // Before the serve only the server plays the ball: the partner's swing at the dropped ball misses (QA army:
        // it was played on as a rally shot, a point with no serve).
        && !(this.phase === PH_TOSS && this.rally.hitter < 0);
    // (a ball gone more than BEHIND_MAX past the hips, away from the net, is past the stroke: the same margin as reach)
    // (a contrapared is met behind the hips by design, facing the glass)
    const past = !serving && !p.contra && s * (b.pos.z - p.pos.z) > BEHIND_MAX + 0.25;
    // (a high ball reaches less far out: reachAt, the same envelope the windows use)
    const reach = reachAt(b.pos.y, t) + 0.25;
    if (past && legal && d <= reach) p.grade = G_TOO_LATE;
    if (!legal || d > reach || past || b.pos.y < t.contactMinHeight * 0.5 || b.pos.y > t.contactMaxHeight + 0.15
      || this.rally.over) {
      // The server swung and missed (out of reach, or before or after the one bounce): a fault (6.6, 7.1.b).
      if (serving) this.rally.onServeMissed();
      this.whiff(i, this.time, legal && d > reach ? d : 0, legal ? WHIFF_REACH : WHIFF_NOTHING);
      return;
    }

    // Which shot actually comes out: overheads and volleys are picked from the situation.
    this.shotHeight = b.pos.y;
    this.shotMod = p.mod;
    this.shotContra = !serving && p.contra;
    const drill = serving && this.cfg.practice !== undefined ? DRILLS[this.cfg.practice]! : null;
    const feed = drill ? drill.feeds[floor(this.aiRng.next() * drill.feeds.length)]! : null;
    const shot = feed ? feed.shotId : serving ? SHOT_SERVE : this.shotFor(p, this.rally.bounces === 0);
    this.shotContra = false;

    // Target.
    const c = this.world.court;
    const a = this.aim[i]!;
    const r = this.req;
    if (feed) {
      const rr = this.aiRng;
      r.targetX = (rr.next() < 0.5 ? -1 : 1) * (feed.x[0]! + (feed.x[1]! - feed.x[0]!) * rr.next());
      r.targetZ = -s * (feed.depth[0]! + (feed.depth[1]! - feed.depth[0]!) * rr.next());
    } else if (serving) {
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
    // (facing the glass for a contrapared, the forehand is on the other side)
    r.handSide = (dx * s * p.handed >= 0) !== (shot === SHOT_CONTRAPARED) ? 1 : -1;
    r.moving = clamp(p.speed() / t.maxSpeed, 0, 1);
    r.stretch = clamp((d - t.reachComfort) / (t.reachMax - t.reachComfort), 0, 1);
    const ai0 = this.ai[i];
    r.power = !ai0 ? 1 : shot === SHOT_SMASH ? ai0.smashEffort() : shot === SHOT_SERVE ? ai0.serveEffort() : 1;
    r.control = 1;
    // Serve spin follows the key (slice, kick, flat); it is solved with, so the serve still lands on its target.
    r.spinScale = serving && !feed ? (p.shot === SHOT_TOPSPIN ? -0.9 : p.shot === SHOT_DRIVE ? 0.15 : 1) : 1;
    r.bodyX = p.pos.x;
    r.bodyZ = p.pos.z;
    // How hard this ball is to play (ai/pressure.ts): an AI's swing is less steady under pressure.
    const v = b.vel;
    const walls = !serving && this.rally.bounces > 0 ? this.wallsSinceBounce : 0;
    this.lastPressure = serving ? 0 : pressureOf(sqrt(v.x * v.x + v.y * v.y + v.z * v.z), this.time - this.lastStrikeTime, d, p.speed(), b.pos.y, walls > 0, walls > 1);
    const ai = this.ai[i];
    r.motor = ai ? ai.motor(this.lastPressure) : 0;
    r.control = ai ? ai.control(b.pos.y) : 1;
    const contactY = b.pos.y;
    strike(this.solver, b, r, this.rng, this.res);

    p.swing = SW_RECOVER;
    p.contra = false;
    p.recoverUntil = this.time + t.recoverTime;
    p.lastContact.copy(b.pos);
    p.lastContactTime = this.time;
    this.lastStrikeTeam = team;
    this.lastStrikePlayer = i;
    if (!this.ai[i]) this.intentUp[team] = -1;
    this.lastStrikeTime = this.time;

    if (feed) {
      this.rally.onStrike(team, s, false);
      this.phase = PH_RALLY;
    } else if (serving) {
      this.rally.onStrike(team, s, true, contactY, t.waistHeight);
      // 6.2: dropped behind the service line on the server's own side of the centre line, and struck before the
      // ball crossed either (a ball on a line has not crossed it). (QA army: a partner walking into the server
      // pushed them 45 cm forward, the ball in hand with them, and the serve dropped inside the line was played.)
      if (!this.inServerArea(this.tossBX, this.tossBZ, team) || !this.inServerArea(b.pos.x, b.pos.z, team)) this.rally.onServeArea();
      this.phase = PH_RALLY;
    } else {
      this.rally.onStrike(team, s, false);
    }
    this.emitP(E_HIT, i, shot, p.grade, this.res.speed, b.pos.x, b.pos.y, b.pos.z);
    {
      // How the ball met the face (the sound reads it): impact speed, and where from the face's centre.
      const e = this.events[(this.eventSeq - 1) % EVENT_RING]!;
      const rs = this.solver.racket.spec;
      const hl = rs.headLength / 2;
      e.d = this.res.impactSpeed ?? 0;
      const al = ((this.res.fromTip ?? hl) - hl) / hl, ac = (this.res.across ?? 0) / (rs.headWidth / 2);
      e.q = this.res.frame ? 2 : min(1, sqrt(al * al + ac * ac));
    }
    this.wallsSinceBounce = 0;
    this.pred.strikeT = this.lastStrikeTime;
    this.pred.compute(this.world, b, this.time, 0);
    // The opponents split-step as the ball is struck (a human already pushing a direction goes instead: a forced hop
    // would hold their keys for its airtime).
    for (let o = 1 - team; o < this.players.length; o += 2) {
      if (this.keysMove[o] === 0 && this.players[o]!.trySplitStep(this.time)) this.emitP(E_SPLIT, o);
    }
    this.taker[1 - team] = -1;
    this.takerVersion[1 - team] = -1;
    this.called[1 - team] = 0;
    this.claimGap[1 - team] = CLAIM_OUT;
    this.crossBack[team] = 0;
    if (serving && this.doubles) {
      for (let k = 0; k < 4; k++) {
        const dx = this.players[k]!.pos.x - this.players[k ^ 2]!.pos.x;
        this.homeLane[k] = dx * this.side(this.players[k]!.team) > 0 ? 1 : -1;
      }
    }
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
      case SHOT_CONTRAPARED: return 0.72;
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
        this.emitP(E_BODY, i, 0, 0, 0, b.pos.x, b.pos.y, b.pos.z);
        return;
      }
    }
  }

  // ---- end of rally --------------------------------------------------------------------------

  private pendingPointWinner = -1;
  /** Pressure of the last contact (ai/pressure.ts; read by tools/match-stats.ts). */
  lastPressure = 0;

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
      // (the walk back follows: the point's reactions carry on while they walk)
      this.phaseUntil = this.time + (this.cfg.walkBack !== false ? POINT_DEAD_WALK : 1.7);
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
      const ev = this.cfg.practice !== undefined ? 0 : this.score.pointWon(this.pendingPointWinner);
      this.serveNo = 1;
      if (ev & EV_GAME) this.emit(E_GAME, this.pendingPointWinner);
      if (ev & EV_SET) this.emit(E_SET, this.pendingPointWinner);
      if (ev & EV_CHANGE_ENDS) this.emit(E_ENDS, -1);
      if (ev & EV_MATCH) {
        this.emit(E_MATCH, this.pendingPointWinner);
        this.phase = PH_OVER;
        this.overStage = 1;
        this.overUntil = this.time + OVER_REACT;
        this.overHugAt = this.time + OVER_RUN_AFTER;
        return;
      }
      if ((ev & EV_CHANGE_ENDS) !== 0 && this.cfg.walkBack !== false) {
        // Changing ends: nobody walks round the net; the picture cuts (cutComing) a moment later, when everyone is
        // put on the other side.
        this.pendingPointWinner = -1;
        this.endsCut = 1;
        this.phaseUntil = this.time + ENDS_CUT;
        return;
      }
    } else if (this.endsCut !== 0) {
      // (the cut after a change of ends: the point is scored already)
    } else if (r.result === R_FAULT) {
      this.serveNo = 2;
    }
    this.walkMeet = this.pendingPointWinner >= 0 ? 1 : 0;
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
      this.goingOverhead(p), this.goingVolley(p), this.ai[i] ? this.ai[i].ohKind : OH_ANY, this.contraGlass(i));
  }

  /** Fingerprint of the full sim state (determinism checks). */
  /**
   * Become a copy of `src`, a match built with the same config: every field, the players, AIs, ball, net and random
   * streams. Stepped on with the same human inputs it plays the same ticks (replays re-run a point from its start).
   */
  copyFrom(src: MatchSim): void {
    COPY_SEEN.clear();
    copyState(this, src, COPY_SEEN);
    COPY_SEEN.clear();
  }

  hash(): number {
    const h = new Hasher();
    const b = this.ball;
    h.num(this.tick).num(this.time).num(this.phase).num(this.serveNo).num(this.wallsSinceBounce);
    h.num(b.pos.x).num(b.pos.y).num(b.pos.z).num(b.vel.x).num(b.vel.y).num(b.vel.z).num(b.spin.x).num(b.spin.y).num(b.spin.z);
    h.num(b.inNet ? 1 : 0).num(b.netSide).num(b.sideZ).num(b.netW).num(b.netZeta).num(b.rolling ? 1 : 0).num(b.outside ? 1 : 0).num(b.ahead)
      .num(b.wear);
    this.net.hashInto(h);
    for (const p of this.players) {
      h.num(p.pos.x).num(p.pos.z).num(p.vel.x).num(p.vel.z).num(p.swing).num(p.contactTime).num(p.aimX).num(p.aimZ)
        .num(p.aimTouched ? 1 : 0).num(p.heldMod).num(p.splitAt).num(p.pushFrom).num(p.contra ? 1 : 0);
    }
    h.num(this.taker[0]!).num(this.taker[1]!).num(this.intentUp[0]!).num(this.intentUp[1]!);
    h.num(this.homeLane[0]!).num(this.homeLane[1]!).num(this.homeLane[2]!).num(this.homeLane[3]!).num(this.called[0]!).num(this.called[1]!);
    h.num(this.crossBack[0]!).num(this.crossBack[1]!).num(this.claimGap[0]!).num(this.claimGap[1]!);
    for (let i = 0; i < 4; i++) h.num(this.rng.s[i]!).num(this.aiRng.s[i]!);
    h.num(this.tossBounces).num(this.tossBX).num(this.tossBZ);
    h.num(this.walking).num(this.walkStage).num(this.walkUntil).num(this.walkMeet).num(this.endsCut);
    for (let i = 0; i < this.players.length; i++) h.num(this.walkHomeX[i]!).num(this.walkHomeZ[i]!).num(this.walkHomeF[i]!);
    h.num(this.overStage).num(this.overUntil);
    for (let i = 0; i < this.players.length; i++) h.num(this.overX[i]!).num(this.overZ[i]!).num(this.overMate[i]!);
    const st: number[] = [];
    this.score.writeState(st);
    this.rally.writeState(st);
    for (const v of st) h.num(v);
    return h.h;
  }
}

export { SURF_GLASS, SHOT_DRIVE, SHOT_TOPSPIN, SHOT_SLICE, SHOT_LOB, SHOT_DROP, SHOT_SERVE, SHOT_SMASH, SHOT_BANDEJA, SHOT_VOLLEY };
export { R_FAULT, R_LET, R_POINT };
