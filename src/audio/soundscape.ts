// The soundscape (Phase 6): what is heard, decided from what happens. Reads the sim's events (hits, bounces, walls,
// the net, swings, points), the players' feet (avatar soles, or a stride clock for the capsules) and the match's
// shape (the rally's length, the score), and asks an AudioSink for sounds. Never writes to the sim. Pure logic: the
// tests drive it with a recording sink.
import {
  E_HIT, E_FLOOR, E_WALL, E_NET, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH, E_SWING, E_WHIFF, PH_RALLY, PH_TOSS, PH_SETUP,
  type MatchSim,
} from '../sim/match.ts';
import {
  SHOT_SMASH, SHOT_VIBORA, SHOT_BANDEJA, SHOT_VOLLEY, SHOT_SLICE, SHOT_DROP, SHOT_LOB, SHOT_CHIQUITA, SHOT_SERVE,
} from '../sim/contact/shots.ts';
import { SURF_GLASS, SURF_MESH, WALL_BACK_NEAR, WALL_BACK_FAR, type ZoneHit } from '../sim/court/court.ts';
import { WHY_DOUBLE_BOUNCE, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP } from '../sim/rules/rally.ts';
import { RK_DRIVE, RK_VOLLEY, RK_OVER, RK_SLICE, RK_TOUCH, WHOOSH_PEAK } from './voices.ts';
import {
  AUDIO, arenaAudio, binFor, racketBin, RQ_CLEAN, RQ_OFF, RQ_FRAME, RACKET_POWER, BOUNCE_V, GLASS_V, MESH_V, METAL_V,
  NET_V, WHOOSH_S, STEP_F, GRUNT_E, APPLAUSE_SMALL, APPLAUSE_BIG,
} from './bank.ts';
import { BUS_BALL, BUS_PLAYERS, BUS_CROWD, BUS_AMB, type AudioSink } from './sink.ts';

/** A contact this far from the face's centre (0 centre, 1 edge) sounds off-centre. */
/** A routine bounce before the serve hits the floor at about this speed (m/s: pushed down from 0.95 m). */
const ROUTINE_SPEED = 5;
const OFF_CENTRE = 0.55;
/** The whoosh peaks this long before the contact (the racket's fastest just before it meets the ball). */
const WHOOSH_LEAD = 0.02;
/** Scuffs are judged over this much sim time (a frame's difference is frame-rate dependent). */
const SCUFF_WINDOW = 0.1;
const RING = 32;
/** How likely each player (by number) is to grunt on a hard shot: some players do, some barely. */
const GRUNTER = [0.85, 0.5, 0.7, 0.35];
/** A sole this high (m) is off the floor; this low, on it. */
const FOOT_UP = 0.03, FOOT_DOWN = 0.012;
const db = (x: number): number => Math.pow(10, x / 20);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Swing speed (0..1) by shot: a smash whips the racket through, a block volley barely moves it. */
function swingSpeed(shot: number): number {
  switch (shot) {
    case SHOT_SMASH: return 1;
    case SHOT_VIBORA: return 0.85;
    case SHOT_BANDEJA: return 0.7;
    case SHOT_VOLLEY: return 0.3;
    case SHOT_DROP: case SHOT_CHIQUITA: return 0.35;
    case SHOT_LOB: return 0.45;
    case SHOT_SERVE: return 0.5;
    case SHOT_SLICE: return 0.55;
    default: return 0.65;
  }
}

function racketKind(shot: number): number {
  if (shot === SHOT_SMASH || shot === SHOT_VIBORA || shot === SHOT_BANDEJA) return RK_OVER;
  if (shot === SHOT_VOLLEY) return RK_VOLLEY;
  if (shot === SHOT_SLICE) return RK_SLICE;
  if (shot === SHOT_DROP || shot === SHOT_LOB || shot === SHOT_CHIQUITA) return RK_TOUCH;
  return RK_DRIVE;
}

/** A player's feet as the soundscape reads them: soles (x, height, z for left and right), or null (capsules). */
export interface FeetSource { feet: Float64Array | null }

export class Soundscape {
  private readonly out: AudioSink;
  private readonly crowdSize: number;
  private readonly big: boolean;
  private readonly neighbours: number[];
  private sim: MatchSim | null = null;
  private seen = 0;
  private seed = 987654;
  private readonly zone: ZoneHit = { kind: 0, seamDist: 0, joinDist: 0 };
  // Feet: per foot, on the floor or not, last height, last step time; per player, the stride clock (capsules), the
  // last speed and heading and the last scuff.
  private readonly footDown = new Uint8Array(8);
  private readonly footY = new Float64Array(8);
  private readonly footT = new Float64Array(8).fill(-1);
  private readonly stride = new Float64Array(4);
  /** Per player, the last RING samples of (time, vx, vz) for the scuff's window, and where the ring is. */
  private readonly vRing = new Float64Array(4 * RING * 3).fill(-1e9);
  private readonly vHead = new Int32Array(4);
  private readonly scuffT = new Float64Array(4).fill(-1);
  private lastMurmurDb = 1e9;
  private lastBigAt = -10;
  /** This update's set/match celebration (0 none, 1 set, 2 match): played once after the events. */
  private celebrate = 0;
  private readonly birds: boolean;
  private nextBird = 3;
  // The crowd.
  private lastPhase = -1;
  private tension = 0;
  private lastOoh = -10;
  private lastHitShot = -1;
  private lastHitTeam = -1;
  private lastHitSpeed = 0;
  private wallsSinceHit = 0;
  // Neighbour courts: when each next makes a sound, shots left in its rally, which end.
  private readonly nNext: number[];
  private readonly nShots: number[];
  private readonly nEnd: number[];
  private lastTime = -1;

  constructor(out: AudioSink, arena: string, neighbours: number[]) {
    this.out = out;
    const a = arenaAudio(arena);
    this.crowdSize = a.crowd;
    this.big = a.crowd >= AUDIO.crowd.big;
    this.neighbours = a.neighbours > 0 ? neighbours.slice(0, a.neighbours) : [];
    this.birds = (a as { birds?: boolean }).birds === true;
    this.nNext = this.neighbours.map((_, i) => 2 + 3 * i);
    this.nShots = this.neighbours.map(() => 0);
    this.nEnd = this.neighbours.map(() => 1);
    // Beds: the crowd's murmur and the place's own sounds.
    out.loop('murmur', db(AUDIO.crowd.chatter), 1);
    for (const k of a.ambience) out.loop(k, 1, 2);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * After the frame's sim steps. `renderTime`: the moment being drawn (events can be up to a tick ahead of it).
   * `feet`: each player's view (avatar soles or null). `dt`: the frame's length (s).
   */
  /** The server's routine bounce before the serve (drawn by render/views.ts BallView, not a sim event). */
  routineBounce(x: number, z: number): void {
    const s = binFor(BOUNCE_V, ROUTINE_SPEED, this.rand());
    this.out.play('bounce', s.bin, x, 0.03, z, s.gain, 1, 0, BUS_BALL);
  }

  update(sim: MatchSim, renderTime: number, feet: readonly FeetSource[], dt: number): void {
    if (sim !== this.sim) {
      this.sim = sim;
      this.seen = sim.eventSeq;
    }
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      const delay = Math.min(0.05, Math.max(0, e.time - renderTime));
      this.event(sim, e.kind, e.team, e.player, e.a, e.b, e.c, e.x, e.y, e.z, e.d, e.q, delay, renderTime);
    }
    if (this.celebrate > 0) this.celebration(renderTime);
    this.crowdBed(sim, dt);
    if (this.birds) this.birdsSing(renderTime);
    if (dt > 0) {
      for (let i = 0; i < sim.players.length; i++) this.feetOf(sim, i, feet[i]?.feet ?? null, renderTime, dt);
    }
    this.neighbourCourts(renderTime);
  }

  private event(sim: MatchSim, kind: number, team: number, player: number, a: number, b: number, c: number,
    x: number, y: number, z: number, d: number, q: number, delay: number, now: number): void {
    const out = this.out;
    switch (kind) {
      case E_SWING:
      case E_WHIFF: {
        const p = sim.players[player];
        if (!p) break;
        const s = binFor(WHOOSH_S, swingSpeed(a), this.rand());
        // Peak just before the contact the swing is going for (a whiff: as it swings); started late, from inside.
        let at = delay - WHOOSH_PEAK;
        if (kind === E_SWING && p.contactTime > now) at = p.contactTime - WHOOSH_LEAD - WHOOSH_PEAK - now;
        out.play('whoosh', s.bin, p.pos.x, 1.3, p.pos.z, s.gain, 1, Math.max(0, at), BUS_PLAYERS, Math.max(0, -at));
        break;
      }
      case E_HIT: {
        // How the ball met the face (the impact model): speed into the face, and where on it.
        const rk = racketKind(a);
        const power = d > 0 ? clamp01((d - 4) / 36) : clamp01((c - 5) / 35);
        const pb = binFor(RACKET_POWER, Math.max(0.12, power), this.rand());
        const rq = q >= 2 ? RQ_FRAME : q > OFF_CENTRE ? RQ_OFF : RQ_CLEAN;
        out.play('racket', racketBin(rk, pb.bin, rq), x, y, z, pb.gain, 1, delay, BUS_BALL);
        // A grunt with the effort: overheads and hard drives; the odd breath on a lighter shot.
        const effort = a === SHOT_SMASH ? 0.6 + 0.4 * clamp01((c - 25) / 15)
          : a === SHOT_VIBORA || a === SHOT_BANDEJA ? 0.55
            : a === SHOT_VOLLEY || a === SHOT_DROP || a === SHOT_CHIQUITA || a === SHOT_LOB ? 0.15
              : 0.25 + 0.6 * clamp01((c - 18) / 16);
        if (player >= 0 && this.rand() < (GRUNTER[player] ?? 0.5) * effort) {
          const p = sim.players[player]!;
          const eb = binFor(GRUNT_E, effort, this.rand());
          out.play('grunt', player * 3 + eb.bin, p.pos.x, 1.6, p.pos.z, 1, 1, delay + 0.015, BUS_PLAYERS);
        }
        // The crowd gasps at a great get: a smash or a ball off two walls sent back (never at a serve).
        if (this.big && a !== SHOT_SERVE && sim.phase === PH_RALLY && this.lastHitTeam >= 0 && team !== this.lastHitTeam) {
          const smashBack = (this.lastHitShot === SHOT_SMASH || this.lastHitShot === SHOT_VIBORA) && this.lastHitSpeed > 25;
          const pr = smashBack ? 0.6 : this.wallsSinceHit >= 2 ? 0.4 : 0;
          if (pr > 0 && sim.time - this.lastOoh > 3 && this.rand() < pr * (0.5 + 0.5 * this.tension)) {
            this.lastOoh = sim.time;
            out.playFlat('ooh', 0, 0.7 + 0.3 * this.tension, 0.25, BUS_CROWD);
          }
        }
        this.lastHitShot = a;
        this.lastHitTeam = team;
        this.lastHitSpeed = c;
        this.wallsSinceHit = 0;
        break;
      }
      case E_FLOOR:
        if (c > 0.3) {
          const s = binFor(BOUNCE_V, c, this.rand());
          out.play('bounce', s.bin, x, y, z, s.gain, 1, delay, BUS_BALL);
        }
        break;
      case E_WALL: {
        if (sim.phase === PH_RALLY) this.wallsSinceHit++;
        const court = sim.world.court;
        const zn = b === WALL_BACK_NEAR || b === WALL_BACK_FAR ? court.backZone(x, y, this.zone) : court.sideZone(z, y, this.zone);
        // On a frame or post: the steel rings; the panel beside it still sounds, less.
        let panel = 1;
        if (zn.seamDist < 0.04) {
          const s = binFor(METAL_V, c, this.rand());
          out.play('metal', s.bin, x, y, z, s.gain, 1, delay, BUS_BALL);
          panel = 0.5;
        }
        if (a === SURF_GLASS) {
          const s = binFor(GLASS_V, c, this.rand());
          out.play('glass', s.bin, x, y, z, s.gain * panel, 1, delay, BUS_BALL);
        } else if (a === SURF_MESH) {
          const s = binFor(MESH_V, c, this.rand());
          out.play('mesh', s.bin, x, y, z, s.gain * panel, 1, delay, BUS_BALL);
        }
        break;
      }
      case E_NET: {
        if (a === 2) {
          const s = binFor(METAL_V, c, this.rand());
          out.play('metal', 2 + s.bin, x, y, z, s.gain, 1, delay, BUS_BALL);
        } else {
          const s = binFor(NET_V, c, this.rand());
          out.play('net', (a === 1 ? 2 : 0) + s.bin, x, y, z, s.gain, 1, delay, BUS_BALL);
        }
        break;
      }
      case E_POINT:
        this.pointEnds(sim, team, a, now);
        this.rallyOver();
        break;
      case E_FAULT:
        // A double fault: the crowd groans, no applause.
        if (b === 2 && this.big) out.playFlat('aah', 0, 0.6, 0.3, BUS_CROWD);
        this.rallyOver();
        break;
      case E_LET:
        this.rallyOver();
        break;
      case E_SET:
        this.celebrate = Math.max(this.celebrate, 1);
        break;
      case E_MATCH:
        this.celebrate = 2;
        break;
      case E_GAME:
        break;
    }
  }

  /** What the crowd watched of a rally is forgotten when it ends (the next serve is not a great get). */
  private rallyOver(): void {
    this.lastHitShot = -1;
    this.lastHitTeam = -1;
    this.lastHitSpeed = 0;
    this.wallsSinceHit = 0;
  }

  /** A set or the match: one celebration (the set and the match arrive together), on top of the point's applause. */
  private celebration(now: number): void {
    const k = this.celebrate;
    this.celebrate = 0;
    if (this.big) this.out.playFlat('cheer', 0, k === 2 ? 1.2 : 0.9, 0.3, BUS_CROWD);
    // The point's big applause is still going (4.5 s): swell it only if it has died down.
    if (now - this.lastBigAt > 3) {
      this.out.playFlat('applause', APPLAUSE_BIG, k === 2 ? 1.3 : 1.1, 0.35, BUS_CROWD);
      this.lastBigAt = now;
    }
  }

  /** The crowd's answer to a point: bigger for long rallies, winners, a ball played out of the court. */
  private pointEnds(sim: MatchSim, winner: number, why: number, now: number): void {
    const shots = sim.rally.shots;
    const hitter = sim.rally.hitter >= 0 ? sim.rally.hitter & 1 : -1;
    const out = this.out;
    const clap = 0.25 + this.rand() * 0.3;
    const big = (gain: number, at: number): void => { out.playFlat('applause', APPLAUSE_BIG, gain, at, BUS_CROWD); this.lastBigAt = now; };
    if (why === WHY_EXIT_AFTER_BOUNCE) {
      if (this.big) out.playFlat('cheer', 0, 1.1, 0.3, BUS_CROWD);
      big(1.2, clap);
    } else if ((why === WHY_DOUBLE_BOUNCE || why === WHY_HIT_BODY_OPP) && hitter === winner && (this.lastHitShot === SHOT_SMASH || this.lastHitShot === SHOT_VIBORA)) {
      if (this.big) out.playFlat('cheer', 0, 0.9, 0.3, BUS_CROWD);
      big(1, clap);
    } else if (shots >= 12) {
      // A long rally: a cheer if it ended on a winner, a groan if on an error; applause either way.
      if (this.big && hitter === winner && shots >= 20) out.playFlat('cheer', 0, 0.8, 0.3, BUS_CROWD);
      else if (this.big && hitter >= 0 && hitter !== winner) out.playFlat('aah', 0, 0.7, 0.25, BUS_CROWD);
      big(0.8 + 0.3 * clamp01((shots - 12) / 15), clap + 0.2);
    } else if (this.rand() < (this.big ? 0.75 : 0.5)) {
      out.playFlat('applause', APPLAUSE_SMALL, 0.6 + 0.4 * clamp01(shots / 12), clap, BUS_CROWD);
    }
  }

  /**
   * The murmur: chatter between points, hushed from the server's set-up through the point, rising with a long
   * rally (the crowd on the edge of its seats). Levels are sent only when they change.
   */
  private crowdBed(sim: MatchSim, dt: number): void {
    const inPoint = sim.phase === PH_SETUP || sim.phase === PH_RALLY || sim.phase === PH_TOSS;
    const t = sim.phase === PH_RALLY ? clamp01((sim.rally.shots - 6) / 16) : 0;
    this.tension += (t - this.tension) * (dt > 0 ? 1 - Math.exp(-dt / 1.5) : 0);
    const want = inPoint ? AUDIO.crowd.hush + AUDIO.crowd.tensionGain * this.tension : AUDIO.crowd.chatter;
    const phaseChanged = sim.phase !== this.lastPhase;
    this.lastPhase = sim.phase;
    if (phaseChanged || Math.abs(want - this.lastMurmurDb) > 0.5) {
      // Hush quickly as the server gets ready; pick up after the point; follow a rally's build slowly.
      const tc = phaseChanged ? (inPoint ? 0.35 : 0.8) : 1;
      this.out.loop('murmur', db(want), tc);
      this.lastMurmurDb = want;
    }
  }

  /** Day clubs: birds call from the trees now and then, from anywhere round the court, sometimes answered. */
  private birdsSing(t: number): void {
    if (t < this.nextBird) return;
    const side = this.rand() < 0.5 ? -1 : 1;
    const x = side * (14 + this.rand() * 18), z = (this.rand() - 0.5) * 60, y = 4 + this.rand() * 6;
    this.out.play('bird', 0, x, y, z, 0.5 + 0.5 * this.rand(), 0.94 + 0.12 * this.rand(), 0, BUS_AMB);
    // An answer from across the court, or a pause of a few seconds.
    this.nextBird = t + (this.rand() < 0.3 ? 0.5 + this.rand() : 2 + this.rand() * 7);
  }

  /**
   * Footsteps where a sole comes down onto the floor (avatars), or at a runner's cadence (capsules), as loud as
   * the body's speed and braking make them (a re-plant while standing is a whisper, a sprint's landing is not);
   * scuffs where a player brakes or turns hard, judged over SCUFF_WINDOW of sim time.
   */
  private feetOf(sim: MatchSim, i: number, feet: Float64Array | null, t: number, dt: number): void {
    const p = sim.players[i]!;
    const vx = p.vel.x, vz = p.vel.z;
    const speed = Math.sqrt(vx * vx + vz * vz);
    // The window: the oldest sample in the ring no more than SCUFF_WINDOW back.
    const base = i * RING * 3;
    let h = this.vHead[i]!;
    this.vRing[base + h * 3] = t;
    this.vRing[base + h * 3 + 1] = vx;
    this.vRing[base + h * 3 + 2] = vz;
    h = (h + 1) % RING;
    this.vHead[i] = h;
    let o = -1;
    for (let k = 0; k < RING; k++) {
      const j = (h + k) % RING;
      const tj = this.vRing[base + j * 3]!;
      if (tj >= t - SCUFF_WINDOW - 1e-9 && tj < t) { o = j; break; }
    }
    let brake = 0, cos = 1, prev = 0;
    if (o >= 0) {
      const span = t - this.vRing[base + o * 3]!;
      const px = this.vRing[base + o * 3 + 1]!, pz = this.vRing[base + o * 3 + 2]!;
      prev = Math.sqrt(px * px + pz * pz);
      if (span > SCUFF_WINDOW * 0.5) brake = (prev - speed) / span;
      if (prev > 0.1 && speed > 0.1) cos = (px * vx + pz * vz) / (prev * speed);
    }
    const force = clamp01(0.06 + speed / 6.5 + Math.max(0, brake) / 18);
    if (feet) {
      for (let f = 0; f < 2; f++) {
        const k = i * 2 + f;
        const y = feet[f * 3 + 1]!;
        if (this.footDown[k] === 0 && y < FOOT_DOWN) {
          // (marked down before playing: a play that throws must not replay this landing every frame)
          const heard = this.footT[k]! >= 0 && t - this.footT[k]! > 0.12;
          this.footDown[k] = 1;
          this.footT[k] = t;
          if (heard) {
            const s = binFor(STEP_F, force, this.rand());
            this.out.play('step', s.bin, feet[f * 3]!, 0, feet[f * 3 + 2]!, s.gain, 1, 0, BUS_PLAYERS);
          }
        } else if (y > FOOT_UP) this.footDown[k] = 0;
        this.footY[k] = y;
      }
    } else if (speed > 0.8) {
      // Runners' cadence: about 2.8 steps a second at a jog (3 m/s), 4.5 at a sprint (6 m/s).
      this.stride[i] = this.stride[i]! + (1.6 + 0.48 * speed) * dt;
      if (this.stride[i]! >= 1) {
        this.stride[i] = 0;
        const s = binFor(STEP_F, force, this.rand());
        this.out.play('step', s.bin, p.pos.x, 0, p.pos.z, s.gain, 1, 0, BUS_PLAYERS);
      }
    }
    // Braking or cutting hard: the shoe slides through the sand (or squeaks on a hard court). The sim brakes at up
    // to 8 m/s^2; over the window a hard stop reads 5 or more, a cut turns the way run by more than 60 degrees.
    const cut = prev > 2.5 && speed > 1.5 && cos < 0.5;
    if ((prev > 3 && brake > 5) || cut) {
      if (t - this.scuffT[i]! > 0.8 || this.scuffT[i]! < 0) {
        this.scuffT[i] = t;
        this.out.play('scuff', 0, p.pos.x, 0, p.pos.z, 0.4 + 0.6 * clamp01(cut ? 0.6 : (brake - 5) / 3), 1, 0, BUS_PLAYERS);
      }
    }
  }

  /**
   * The courts next door (clubs build in rows): their rallies at a club player's pace, a hit about every 1.2 s with
   * the bounce between, then a pause between points. Club padel is about 88 impacts in 5 minutes (Higgins, via The
   * Padel Paper), counting the pauses.
   */
  private neighbourCourts(t: number): void {
    if (this.neighbours.length === 0) return;
    if (this.lastTime >= 0 && t < this.lastTime - 1) for (let i = 0; i < this.nNext.length; i++) this.nNext[i] = t + 2 + i;
    this.lastTime = t;
    for (let i = 0; i < this.neighbours.length; i++) {
      if (t < this.nNext[i]!) continue;
      const nx = this.neighbours[i]!;
      if (this.nShots[i]! <= 0) {
        // A new point after a pause.
        this.nShots[i] = 2 + Math.floor(-Math.log(1 - this.rand() * 0.98) * 6);
        this.nNext[i] = t + 8 + this.rand() * 10;
        continue;
      }
      const end = this.nEnd[i]!;
      const x = nx + (this.rand() - 0.5) * 6, z = end * (5 + this.rand() * 4);
      const pb = binFor(RACKET_POWER, 0.3 + 0.5 * this.rand(), this.rand());
      this.out.play('racket', racketBin(RK_DRIVE, pb.bin, this.rand() < 0.85 ? RQ_CLEAN : RQ_OFF), x, 1, z, 0.8, 1, 0, BUS_BALL);
      const bv = binFor(BOUNCE_V, 4 + 6 * this.rand(), this.rand());
      this.out.play('bounce', bv.bin, nx + (this.rand() - 0.5) * 6, 0, -end * (3 + this.rand() * 5), bv.gain * 0.8, 1, 0.55, BUS_BALL);
      if (this.rand() < 0.3) {
        const gv = binFor(GLASS_V, 5 + 8 * this.rand(), this.rand());
        this.out.play('glass', gv.bin, nx + (this.rand() - 0.5) * 8, 1, -end * 10, gv.gain * 0.7, 1, 0.85, BUS_BALL);
      }
      this.nEnd[i] = -end;
      this.nShots[i] = this.nShots[i]! - 1;
      this.nNext[i] = t + 1.0 + this.rand() * 0.5;
    }
  }

  /** Crowd size (for the debug overlay). */
  get crowd(): number { return this.crowdSize; }
}
