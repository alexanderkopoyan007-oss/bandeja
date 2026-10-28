// Player body for the sim: movement (a sprint's force-velocity profile, top speed by the direction run
// relative to where the player looks, braking and turning held by the shoe's grip), split-step, and the swing
// state machine (charge -> committed -> recover).
import { V3 } from '../core/v3.ts';
import { clamp, sqrt, atan2, sin, cos, expF, FIO } from '../core/smath.ts';
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
  /** Player number: team + 2 * slot (0 and 1 face each other; 2 and 3 are their partners in doubles). */
  readonly index: number;
  readonly team: number;
  readonly tune: PlayerTuning;
  readonly pos = new V3();
  readonly vel = new V3();
  /** Yaw: direction the body faces, radians about +y (0 = facing -z). */
  facing = 0;

  swing = SW_IDLE;
  shot = 0;
  mod = 0;
  /** The modifier held right now (power, precision or none), for the shot a held swing is heading for. */
  heldMod = 0;
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
  /** The player has steered the aim since pressing (until then an overhead's target follows Space). */
  aimTouched = false;

  /** Split-step: take-off time, and the end of it (hop and landing; the avatar draws it). */
  splitAt = -10;
  splitUntil = 0;
  /**
   * When the current push from a standstill began (-1: not pushing; -1e9: no build-up, already moving or loaded by
   * a split-step landing). Force takes time to build from a static stance; the split-step's landing pre-loads it.
   */
  pushFrom = -1;
  /** Right-handed = 1, left-handed = -1. */
  handed = 1;

  /** Bounds of the half this player may move in (set each point from the current ends). */
  minX = -4.7;
  maxX = 4.7;
  minZ = 0.25;
  maxZ = 9.8;

  constructor(index: number, tune: PlayerTuning = DEFAULT_TUNING) {
    this.index = index;
    this.team = index & 1;
    this.tune = tune;
  }

  /** Point the half the player plays in: side = +1 for z > 0. */
  setHalf(side: number, halfW: number, halfL: number): void {
    this.minX = -halfW + 0.28;
    this.maxX = halfW - 0.28;
    if (side > 0) { this.minZ = 0.3; this.maxZ = halfL - 0.22; }
    else { this.minZ = -halfL + 0.22; this.maxZ = -0.3; }
  }

  /** Movement wish for this tick (world axes, length <= 1: the fraction of the top speed for that direction)
   *  and the tick's start time; set before move(). */
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
    const slow = this.swing === SW_COMMITTED ? t.chargingSpeedScale : 1;
    // Where the player looks (facing 0 = -z).
    const lx = -sin(this.facing);
    const lz = -cos(this.facing);
    let top = t.maxSpeed;
    if (len > 1e-6) {
      this.qx = dx / len;
      this.qz = dz / len;
      this.topToward(lx, lz);
      top = this.qTop;
    }
    const wantX = dx * top * slow;
    const wantZ = dz * top * slow;
    let ax = (wantX - this.vel.x) / dt;
    let az = (wantZ - this.vel.z) / dt;
    const sp = sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    // Read every tick: a tuning field first read on a rare branch has no type feedback there, and reaching it
    // deoptimises move() mid-rally (a burst of garbage while it re-optimises).
    const air = t.splitStepAir;
    const preload = t.splitPreload;
    const rampT = t.startRamp;
    const from0 = t.startFrom;
    // In the air during the split-step's hop: no grip, so no push, braking or turning; the feet land loaded.
    const land = this.splitAt + air;
    const flying = now >= this.splitAt && now < land;
    // Force builds over startRamp from a standstill (startFrom of it at once); not when already on the move or
    // within splitPreload of a split-step landing (the hop lands loaded).
    if (flying) this.pushFrom = -1e9;
    else if (len < 0.05) this.pushFrom = -1;
    else if (this.pushFrom === -1) this.pushFrom = sp > 0.6 || now - land < preload ? -1e9 : now;
    const ramp = now - this.pushFrom >= rampT ? 1 : from0 + ((1 - from0) * (now - this.pushFrom)) / rampT;
    if (flying) {
      // Ballistic: the velocity is kept.
      ax = 0;
      az = 0;
    } else if (sp > 0.05) {
      const ux = this.vel.x / sp;
      const uz = this.vel.z / sp;
      // Propulsion falls with speed towards the top speed for the way the player is running (a sprint's
      // force-velocity profile); braking is limited apart; braking, turning and pushing all share the grip.
      this.qx = ux;
      this.qz = uz;
      this.topToward(lx, lz);
      const push = t.accel * ramp * (1 - sp / (this.qTop * slow));
      let along = ax * ux + az * uz;
      let cross = -ax * uz + az * ux;
      along = clamp(along, -t.brake, push > 0 ? push : 0);
      const g2 = t.grip * t.grip - along * along;
      const cmax = g2 > 0 ? sqrt(g2) : 0;
      cross = clamp(cross, -cmax, cmax);
      ax = along * ux - cross * uz;
      az = along * uz + cross * ux;
    } else {
      const a = sqrt(ax * ax + az * az);
      const lim = t.accel * ramp;
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

  /** Unit direction (qx, qz) in; topToward() leaves the top speed that way in qTop (fields: see move). */
  qx = 0;
  qz = 0;
  qTop = 0;

  /**
   * Top speed running along (qx, qz) for a player looking along (lx, lz): forward, sideways (crossover steps
   * with the head turned) or backpedalling, blended by the angle.
   */
  topToward(lx: number, lz: number): void {
    const t = this.tune;
    const c = this.qx * lx + this.qz * lz;
    this.qTop = c >= 0 ? t.sideSpeed + (t.maxSpeed - t.sideSpeed) * c : t.sideSpeed + (t.backSpeed - t.sideSpeed) * -c;
  }

  /** The direction the player looks, from `facing`, into (qx, qz). */
  look(): void {
    this.qx = -sin(this.facing);
    this.qz = -cos(this.facing);
  }

  /**
   * Seconds to run `runD` metres to a stop-free arrival along (runX, runZ) (unit), from the current velocity,
   * with the force-velocity profile: v(t) = vT - (vT - v0) e^(-t/tau), tau = vT / accel. Into runT, and the
   * speed on arrival into runV.
   */
  runD = 0;
  runX = 0;
  runZ = 0;
  runT = 0;
  runV = 0;

  runTime(): void {
    const t = this.tune;
    const lx = -sin(this.facing);
    const lz = -cos(this.facing);
    this.qx = this.runX;
    this.qz = this.runZ;
    this.topToward(lx, lz);
    const vT = this.qTop;
    let d = this.runD;
    let v0 = this.vel.x * this.runX + this.vel.z * this.runZ;
    let extra = 0;
    if (v0 < 0) {
      // Going the other way: stop first.
      extra = -v0 / t.brake;
      d += (v0 * v0) / (2 * t.brake);
      v0 = 0;
    }
    if (v0 > vT) v0 = vT;
    const tau = vT / t.accel;
    const dn = d / (vT * tau);
    const k = 1 - v0 / vT;
    // Solve dn = s - k (1 - e^-s) for s = time / tau (Newton from the from-rest closed form's neighbourhood).
    let s = sqrt(dn * (dn + 2));
    for (let i = 0; i < 3; i++) {
      // (expF, not exp: no double crosses a call here, whatever V8 inlines; the planner runs this a lot.)
      FIO[0] = -s;
      expF();
      const e = FIO[0]!;
      const f = s - k * (1 - e) - dn;
      const fp = 1 - k * e;
      s -= f / (fp > 0.05 ? fp : 0.05);
      if (s < 0) s = 0;
    }
    this.startLag();
    this.runT = extra + s * tau + this.lagT;
    FIO[0] = -s;
    expF();
    this.runV = vT - (vT - v0) * FIO[0]!;
  }

  /**
   * Time lost to getting going, on top of the run: the rest of a split-step hop, and the build-up of force from a
   * standstill (a linear ramp from startFrom loses (1 - startFrom) * startRamp / 2 of full push). Into lagT (a
   * field: a double returned from a call V8 doesn't inline is boxed).
   */
  lagT = 0;
  private startLag(): void {
    const t = this.tune;
    const now = this.clock;
    // All tuning read up front (see move()).
    const preload = t.splitPreload;
    const rampT = t.startRamp;
    const from0 = t.startFrom;
    const land = this.splitAt + t.splitStepAir;
    let lag = now >= this.splitAt && now < land ? land - now : 0;
    const from = this.pushFrom;
    if (from === -1) {
      const moving = this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.36;
      const loaded = lag > 0 || (now >= land && now - land < preload);
      if (!moving && !loaded) lag += 0.5 * (1 - from0) * rampT;
    } else if (from > -1e8 && now - from < rampT) {
      const r = from0 + ((1 - from0) * (now - from)) / rampT;
      lag += 0.5 * (1 - r) * (rampT - (now - from));
    }
    this.lagT = lag;
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

  /**
   * Split-step: a small hop as the opponent strikes (take-off about at their contact, landing 140-150 ms later,
   * Mecheri et al. 2019); landing loads the legs, so the first step after it needs no build-up.
   */
  trySplitStep(now: number): boolean {
    if (this.speed() > this.tune.splitStepMaxSpeed) return false;
    this.splitAt = now;
    this.splitUntil = now + this.tune.splitStepTime;
    return true;
  }

  writeState(out: number[]): void {
    out.push(this.pos.x, this.pos.z, this.vel.x, this.vel.z, this.facing, this.swing, this.shot, this.mod,
      this.chargeStart, this.release, this.contactTime, this.timingDelta, this.grade, this.recoverUntil,
      this.handSide, this.splitUntil, this.lastContactTime, this.lastContact.x, this.lastContact.y, this.lastContact.z,
      this.aimX, this.aimZ, this.aiming ? 1 : 0, this.aimTouched ? 1 : 0, this.heldMod, this.splitAt, this.pushFrom);
  }

  readState(s: number[], i: number): number {
    this.pos.x = s[i++]!; this.pos.z = s[i++]!; this.vel.x = s[i++]!; this.vel.z = s[i++]!;
    this.facing = s[i++]!; this.swing = s[i++]!; this.shot = s[i++]!; this.mod = s[i++]!;
    this.chargeStart = s[i++]!; this.release = s[i++]!; this.contactTime = s[i++]!; this.timingDelta = s[i++]!;
    this.grade = s[i++]!; this.recoverUntil = s[i++]!; this.handSide = s[i++]!; this.splitUntil = s[i++]!;
    this.lastContactTime = s[i++]!; this.lastContact.x = s[i++]!; this.lastContact.y = s[i++]!; this.lastContact.z = s[i++]!;
    this.aimX = s[i++]!; this.aimZ = s[i++]!; this.aiming = s[i++]! === 1; this.aimTouched = s[i++]! === 1;
    this.heldMod = s[i++]!;
    this.splitAt = s[i++]!;
    this.pushFrom = s[i++]!;
    return i;
  }
}
