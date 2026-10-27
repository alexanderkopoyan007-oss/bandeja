// Player body for the sim: movement with real acceleration, braking and turning limits, split-step,
// and the swing state machine (charge -> committed -> recover).
import { V3 } from '../core/v3.ts';
import { clamp, sqrt, atan2 } from '../core/smath.ts';
import { DT } from '../core/constants.ts';
import tuningData from '../../../data/tuning.json' with { type: 'json' };

export type PlayerTuning = typeof tuningData.player;
export const DEFAULT_TUNING: PlayerTuning = tuningData.player;

/** How fast a player turns to face the ball (rad/s). */
const FACE_RATE = 7;

export const SW_IDLE = 0;
export const SW_CHARGE = 1;
export const SW_COMMITTED = 2;
export const SW_RECOVER = 3;

export class Player {
  readonly team: number;
  readonly tune: PlayerTuning;
  readonly pos = new V3();
  readonly vel = new V3();
  /** Yaw: direction the body faces, radians about +y (0 = facing -z). */
  facing = 0;

  swing = SW_IDLE;
  shot = 0;
  mod = 0;
  chargeStart = 0;
  release = 0;
  /** Planned contact time while committed. */
  contactTime = 0;
  /** Timing delta at release (s) and resulting grade. */
  timingDelta = 0;
  grade = -1;
  recoverUntil = 0;
  /** +1 forehand side, -1 backhand side of the planned contact. */
  handSide = 1;
  /** Last contact point (for rendering the racket meeting the ball). */
  readonly lastContact = new V3();
  lastContactTime = -10;

  /** Shot target on the opponent's half (world x, z), steered while charging and used at release. */
  aimX = 0;
  aimZ = 0;
  /** The aim target is live this tick (charging for an incoming ball, or setting up a serve). */
  aiming = false;

  splitUntil = 0;
  /** Right-handed = 1, left-handed = -1. */
  handed = 1;

  /** Bounds of the half this player may move in (set each point from the current ends). */
  minX = -4.7;
  maxX = 4.7;
  minZ = 0.25;
  maxZ = 9.8;

  constructor(team: number, tune: PlayerTuning = DEFAULT_TUNING) {
    this.team = team;
    this.tune = tune;
  }

  /** Point the half the player plays in: side = +1 for z > 0. */
  setHalf(side: number, halfW: number, halfL: number): void {
    this.minX = -halfW + 0.28;
    this.maxX = halfW - 0.28;
    if (side > 0) { this.minZ = 0.3; this.maxZ = halfL - 0.22; }
    else { this.minZ = -halfL + 0.22; this.maxZ = -0.3; }
  }

  /**
   * Move towards desired world-space velocity direction (dx, dz) in -1..1 (magnitude = intent).
   * Acceleration is split into along-track (accel/brake) and cross-track (turning) limits.
   */
  /** Movement wish for this tick (world axes, length <= 1) and the tick's start time; set before move(). */
  driveX = 0;
  driveZ = 0;
  clock = 0;

  /**
   * Advance one tick towards driveX/driveZ. Inputs come through fields, not arguments: doubles passed to a
   * function V8 doesn't inline are boxed, and this runs for every player every tick.
   */
  move(): void {
    const dt = DT;
    const now = this.clock;
    let dx = this.driveX;
    let dz = this.driveZ;
    const t = this.tune;
    let len = sqrt(dx * dx + dz * dz);
    if (len > 1) { dx /= len; dz /= len; len = 1; }
    // Holding a shot key is preparation, done on the run; only the swing itself slows the feet.
    const top = t.maxSpeed * (this.swing === SW_COMMITTED ? t.chargingSpeedScale : 1);
    const wantX = dx * top;
    const wantZ = dz * top;
    let ax = (wantX - this.vel.x) / dt;
    let az = (wantZ - this.vel.z) / dt;
    const sp = sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    const boost = now < this.splitUntil ? t.splitStepBoost : 1;
    if (sp > 0.05) {
      const ux = this.vel.x / sp;
      const uz = this.vel.z / sp;
      let along = ax * ux + az * uz;
      let cross = -ax * uz + az * ux;
      along = clamp(along, -t.brake * boost, t.accel * boost);
      cross = clamp(cross, -t.turnAccel * boost, t.turnAccel * boost);
      ax = along * ux - cross * uz;
      az = along * uz + cross * ux;
    } else {
      const a = sqrt(ax * ax + az * az);
      const lim = t.accel * boost;
      if (a > lim) { ax *= lim / a; az *= lim / a; }
    }
    this.vel.x += ax * dt;
    this.vel.z += az * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // Walls and the net stop the player.
    if (this.pos.x < this.minX) { this.pos.x = this.minX; if (this.vel.x < 0) this.vel.x = 0; }
    if (this.pos.x > this.maxX) { this.pos.x = this.maxX; if (this.vel.x > 0) this.vel.x = 0; }
    if (this.pos.z < this.minZ) { this.pos.z = this.minZ; if (this.vel.z < 0) this.vel.z = 0; }
    if (this.pos.z > this.maxZ) { this.pos.z = this.maxZ; if (this.vel.z > 0) this.vel.z = 0; }
  }

  speed(): number {
    return sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }

  /** Turn the body to face a point (render reads `facing`). */
  /** Turn towards a point (the ball) at the turning rate, one tick. */
  faceTowards(at: V3): void {
    const want = atan2(-(at.x - this.pos.x), -(at.z - this.pos.z));
    let d = want - this.facing;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.facing += clamp(d, -FACE_RATE * DT, FACE_RATE * DT);
  }

  /** Split-step: a small hop timed with the opponent's strike gives a quicker first step. */
  trySplitStep(now: number): boolean {
    if (this.speed() > this.tune.splitStepMaxSpeed) return false;
    this.splitUntil = now + this.tune.splitStepTime;
    return true;
  }

  writeState(out: number[]): void {
    out.push(this.pos.x, this.pos.z, this.vel.x, this.vel.z, this.facing, this.swing, this.shot, this.mod,
      this.chargeStart, this.release, this.contactTime, this.timingDelta, this.grade, this.recoverUntil,
      this.handSide, this.splitUntil, this.lastContactTime, this.lastContact.x, this.lastContact.y, this.lastContact.z);
  }

  readState(s: number[], i: number): number {
    this.pos.x = s[i++]!; this.pos.z = s[i++]!; this.vel.x = s[i++]!; this.vel.z = s[i++]!;
    this.facing = s[i++]!; this.swing = s[i++]!; this.shot = s[i++]!; this.mod = s[i++]!;
    this.chargeStart = s[i++]!; this.release = s[i++]!; this.contactTime = s[i++]!; this.timingDelta = s[i++]!;
    this.grade = s[i++]!; this.recoverUntil = s[i++]!; this.handSide = s[i++]!; this.splitUntil = s[i++]!;
    this.lastContactTime = s[i++]!; this.lastContact.x = s[i++]!; this.lastContact.y = s[i++]!; this.lastContact.z = s[i++]!;
    return i;
  }
}
