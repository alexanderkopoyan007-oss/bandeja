// The soundscape (Phase 6): what is heard, decided from what happens. Reads the sim's events (hits, bounces, walls,
// the net, swings, points), the players' feet (avatar soles, or a stride clock for the capsules) and the match's
// shape (the rally's length, the score), and asks an AudioSink for sounds. Never writes to the sim. Pure logic: the
// tests drive it with a recording sink.
import { E_HIT, E_FLOOR, E_WALL, E_NET, E_POINT, E_FAULT, E_GAME, E_SET, E_MATCH, E_SWING, PH_RALLY, PH_TOSS, type MatchSim } from '../sim/match.ts';
import {
  SHOT_SMASH, SHOT_VIBORA, SHOT_BANDEJA, SHOT_VOLLEY, SHOT_SLICE, SHOT_DROP, SHOT_LOB, SHOT_CHIQUITA, SHOT_SERVE,
} from '../sim/contact/shots.ts';
import { gradeQuality } from '../sim/contact/timing.ts';
import { SURF_GLASS, SURF_MESH, WALL_BACK_NEAR, WALL_BACK_FAR, type ZoneHit } from '../sim/court/court.ts';
import { WHY_DOUBLE_BOUNCE, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP } from '../sim/rules/rally.ts';
import { RK_DRIVE, RK_VOLLEY, RK_OVER, RK_SLICE, RK_TOUCH } from './voices.ts';
import {
  AUDIO, arenaAudio, binFor, racketBin, RQ_CLEAN, RQ_OFF, RQ_FRAME, RACKET_POWER, BOUNCE_V, GLASS_V, MESH_V, METAL_V,
  NET_V, WHOOSH_S, STEP_F, GRUNT_E, APPLAUSE_SMALL, APPLAUSE_BIG,
} from './bank.ts';
import { BUS_BALL, BUS_PLAYERS, BUS_CROWD, type AudioSink } from './engine.ts';

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
  private readonly strideD = new Float64Array(4);
  private readonly lastSpeed = new Float64Array(4);
  private readonly lastVx = new Float64Array(4);
  private readonly lastVz = new Float64Array(4);
  private readonly scuffT = new Float64Array(4).fill(-1);
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
      this.event(sim, e.kind, e.team, e.player, e.a, e.b, e.c, e.x, e.y, e.z, delay);
    }
    this.crowdBed(sim, dt);
    if (dt > 0) {
      for (let i = 0; i < sim.players.length; i++) this.feetOf(sim, i, feet[i]?.feet ?? null, renderTime, dt);
    }
    this.neighbourCourts(renderTime);
  }

  private event(sim: MatchSim, kind: number, team: number, player: number, a: number, b: number, c: number,
    x: number, y: number, z: number, delay: number): void {
    const out = this.out;
    switch (kind) {
      case E_SWING: {
        const p = sim.players[player];
        if (!p) break;
        const s = binFor(WHOOSH_S, swingSpeed(a), this.rand());
        out.play('whoosh', s.bin, p.pos.x, 1.3, p.pos.z, s.gain, 1, delay, BUS_PLAYERS);
        break;
      }
      case E_HIT: {
        const q = gradeQuality(b);
        const rk = racketKind(a);
        const power = clamp01((c - 5) / 35);
        const pb = binFor(RACKET_POWER, Math.max(0.12, power), this.rand());
        const rq = q < 0.2 ? RQ_FRAME : q < 0.6 ? RQ_OFF : RQ_CLEAN;
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
        // The crowd gasps at a great get: a smash or a ball off two walls sent back.
        if (this.big && sim.phase === PH_RALLY && this.lastHitTeam >= 0 && team !== this.lastHitTeam) {
          const smashBack = (this.lastHitShot === SHOT_SMASH || this.lastHitShot === SHOT_VIBORA) && this.lastHitSpeed > 25;
          const p = smashBack ? 0.6 : this.wallsSinceHit >= 2 ? 0.4 : 0;
          if (p > 0 && sim.time - this.lastOoh > 3 && this.rand() < p * (0.5 + 0.5 * this.tension)) {
            this.lastOoh = sim.time;
            out.playFlat('ooh', 0, 0.7 + 0.3 * this.tension, 0.15, BUS_CROWD);
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
        this.wallsSinceHit++;
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
        this.pointEnds(sim, team, a);
        break;
      case E_FAULT:
        // A double fault: the crowd groans, no applause.
        if (b === 2 && this.big) out.playFlat('aah', 0, 0.6, 0.2, BUS_CROWD);
        break;
      case E_GAME:
      case E_SET:
      case E_MATCH: {
        const k = kind === E_MATCH ? 2 : kind === E_SET ? 1 : 0;
        if (k > 0) {
          this.out.playFlat('applause', APPLAUSE_BIG, k === 2 ? 1.3 : 1.1, 0.3, BUS_CROWD);
          if (this.big) this.out.playFlat('cheer', 0, k === 2 ? 1.2 : 0.9, 0.1, BUS_CROWD);
        }
        break;
      }
    }
  }

  /** The crowd's answer to a point: bigger for long rallies, winners, a ball played out of the court. */
  private pointEnds(sim: MatchSim, winner: number, why: number): void {
    const shots = sim.rally.shots;
    const hitter = sim.rally.hitter >= 0 ? sim.rally.hitter & 1 : -1;
    const out = this.out;
    const clap = 0.25 + this.rand() * 0.3;
    if (why === WHY_EXIT_AFTER_BOUNCE) {
      if (this.big) out.playFlat('cheer', 0, 1.1, 0.12, BUS_CROWD);
      out.playFlat('applause', APPLAUSE_BIG, 1.2, clap, BUS_CROWD);
    } else if ((why === WHY_DOUBLE_BOUNCE || why === WHY_HIT_BODY_OPP) && hitter === winner && (this.lastHitShot === SHOT_SMASH || this.lastHitShot === SHOT_VIBORA)) {
      if (this.big) out.playFlat('cheer', 0, 0.9, 0.12, BUS_CROWD);
      out.playFlat('applause', APPLAUSE_BIG, 1, clap, BUS_CROWD);
    } else if (shots >= 12) {
      if (this.big && shots >= 20) out.playFlat('cheer', 0, 0.8, 0.15, BUS_CROWD);
      if (this.big && hitter >= 0 && hitter !== winner) out.playFlat('aah', 0, 0.7, 0.1, BUS_CROWD);
      out.playFlat('applause', APPLAUSE_BIG, 0.8 + 0.3 * clamp01((shots - 12) / 15), clap + 0.2, BUS_CROWD);
    } else if (this.rand() < (this.big ? 0.75 : 0.5)) {
      out.playFlat('applause', APPLAUSE_SMALL, 0.6 + 0.4 * clamp01(shots / 12), clap, BUS_CROWD);
    }
  }

  /** The murmur: chatter between points, hushed in a point, rising with a long rally. */
  private crowdBed(sim: MatchSim, dt: number): void {
    const inPoint = sim.phase === PH_RALLY || sim.phase === PH_TOSS;
    const t = inPoint ? clamp01((sim.rally.shots - 6) / 16) : 0;
    this.tension += (t - this.tension) * (dt > 0 ? 1 - Math.exp(-dt / 1.5) : 0);
    if (sim.phase !== this.lastPhase) {
      const level = inPoint ? AUDIO.crowd.hush : AUDIO.crowd.chatter;
      // Hush quickly as the server gets ready; pick up slowly after the applause.
      this.out.loop('murmur', db(level), inPoint ? 0.6 : 1.8);
      this.lastPhase = sim.phase;
    } else if (inPoint && this.tension > 0.05) {
      this.out.loop('murmur', db(AUDIO.crowd.hush + AUDIO.crowd.tensionGain * this.tension), 1);
    }
  }

  /**
   * Footsteps where a sole comes down onto the floor (avatars), or one per 0.85 m run (capsules); scuffs where a
   * player brakes or turns hard.
   */
  private feetOf(sim: MatchSim, i: number, feet: Float64Array | null, t: number, dt: number): void {
    const p = sim.players[i]!;
    const vx = p.vel.x, vz = p.vel.z;
    const speed = Math.sqrt(vx * vx + vz * vz);
    if (feet) {
      for (let f = 0; f < 2; f++) {
        const k = i * 2 + f;
        const y = feet[f * 3 + 1]!;
        if (this.footDown[k] === 0 && y < FOOT_DOWN && this.footT[k]! >= 0 && t - this.footT[k]! > 0.12) {
          const vy = Math.max(0, (this.footY[k]! - y) / dt);
          const force = clamp01(0.15 + vy / 1.2 + speed / 9);
          const s = binFor(STEP_F, force, this.rand());
          this.out.play('step', s.bin, feet[f * 3]!, 0, feet[f * 3 + 2]!, s.gain, 1, 0, BUS_PLAYERS);
          this.footDown[k] = 1;
          this.footT[k] = t;
        } else if (this.footDown[k] === 0 && y < FOOT_DOWN) {
          this.footDown[k] = 1;
          this.footT[k] = t;
        } else if (y > FOOT_UP) this.footDown[k] = 0;
        this.footY[k] = y;
      }
    } else if (speed > 0.8) {
      this.strideD[i] = this.strideD[i]! + speed * dt;
      if (this.strideD[i]! > 0.85) {
        this.strideD[i] = 0;
        const s = binFor(STEP_F, clamp01(0.2 + speed / 7), this.rand());
        this.out.play('step', s.bin, p.pos.x, 0, p.pos.z, s.gain, 1, 0, BUS_PLAYERS);
      }
    }
    // Braking or cutting hard: the shoe slides through the sand (or squeaks on a hard court).
    const prev = this.lastSpeed[i]!;
    const decel = (prev - speed) / dt;
    const dot = prev > 0.1 && speed > 0.1 ? (vx * this.lastVx[i]! + vz * this.lastVz[i]!) / (speed * prev) : 1;
    const cut = prev > 2.5 && dot < 0.65;
    if ((prev > 2.5 && decel > 7) || cut) {
      if (t - this.scuffT[i]! > 0.4 || this.scuffT[i]! < 0) {
        this.scuffT[i] = t;
        this.out.play('scuff', 0, p.pos.x, 0, p.pos.z, 0.4 + 0.6 * clamp01(cut ? 0.6 : (decel - 7) / 8), 1, 0, BUS_PLAYERS);
      }
    }
    this.lastSpeed[i] = speed;
    this.lastVx[i] = vx;
    this.lastVz[i] = vz;
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
