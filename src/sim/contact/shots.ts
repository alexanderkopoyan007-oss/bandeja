// Racket–ball contact. A shot is chosen as a target + shape (net clearance, spin, depth); the solver finds
// the launch that flies there under the real flight model, within the ball speed the swing can give (the
// racket's speed, the incoming ball and the face's restitution). The racket model (racket.ts) turns that launch
// into the swing that makes it (face angle, face velocity, where on the face); the errors are made in the swing
// (path, face, speed, contact point, from timing, footwork, stretch and modifiers) and the impact physics turns
// them into the ball that really leaves: a late swing pushes it, an open face lifts it and adds backspin, a ball
// off the axis twists the face and loses pace, one off the face hits the frame.
import { Ball, HIT_FLOOR, type BallWorld } from '../ball/ball.ts';
import { V3 } from '../core/v3.ts';
import { Rng } from '../core/rng.ts';
import { DT } from '../core/constants.ts';
import { abs, atan, atan2, clamp, cos, max, min, sin, sqrt, PI } from '../core/smath.ts';
import { Racket, RACKETS, faceHalfWidth } from './racket.ts';
import shotData from '../../../data/shots.json' with { type: 'json' };

export const SHOT_DRIVE = 0;
export const SHOT_TOPSPIN = 1;
export const SHOT_SLICE = 2;
export const SHOT_LOB = 3;
export const SHOT_DROP = 4;
export const SHOT_SERVE = 5;
export const SHOT_SMASH = 6;
export const SHOT_BANDEJA = 7;
export const SHOT_VOLLEY = 8;
/** Overhead with slice and sidespin, aimed into the side glass (overhead key + precision). */
export const SHOT_VIBORA = 9;
/** Soft topspin that dips just over the net to the feet of players at the net (topspin key + precision). */
export const SHOT_CHIQUITA = 10;

export const SHOT_KEYS = ['drive', 'topspin', 'slice', 'lob', 'drop', 'serve', 'smash', 'bandeja', 'volley', 'vibora', 'chiquita'] as const;

export const MOD_NONE = 0;
export const MOD_POWER = 1;
export const MOD_PRECISION = 2;

export interface ShotShape {
  name: string;
  netClear: number;
  spinRpm: number;
  depth: number;
  /** Face speed at the impact point (m/s) on a perfect, full swing. */
  racketMax: number;
  /** Planned impact point, from the tip of the racket (m). */
  impact: number;
  errorScale: number;
  /** Full pace: hit at the contact's top speed, elevation chosen for the distance (kill smash). */
  pace?: boolean;
  /** Sidespin (rpm), curving the ball towards the side it is aimed at (víbora). */
  sideRpm?: number;
  /** Short of face speed, spin is given up down to this fraction of spinRpm before pace (default 0.3). */
  spinFloor?: number;
  /** The shot's timing windows against the drive's (smaller = harder to time). */
  timing?: number;
}

interface ModSpec { netClear: number; speed: number; error: number }

/** Swing error parameters (data/shots.json `swing`): [base, bad, moving, stretch] spreads. */
interface SwingSpec {
  pathYaw: number[];
  pathPitch: number[];
  faceOpen: number[];
  faceYaw: number[];
  speed: number[];
  contactAlong: number[];
  contactAcross: number[];
  timingYaw: number;
  timingAlong: number;
  edgeMin: number;
  edgeRand: number;
  frameSpeed: number;
  frameSpeedRand: number;
  frameYaw: number;
  framePitch: number[];
  /** Extra spread per unit of `ShotRequest.motor` (AI players' swing-to-swing variability). */
  motor: { pathYaw: number; pathPitch: number; faceOpen: number; speed: number };
}

const data = shotData as unknown as Record<string, ShotShape> & { modifiers: { power: ModSpec; precision: ModSpec }; swing: SwingSpec };
const SW = data.swing;
export const SHAPES: ShotShape[] = SHOT_KEYS.map((k) => data[k]!);
const MODS: ModSpec[] = [{ netClear: 1, speed: 1, error: 1 }, data.modifiers.power, data.modifiers.precision];

export interface ShotRequest {
  shot: number;
  mod: number;
  /** Target landing point (court coordinates). */
  targetX: number;
  targetZ: number;
  /** Contact quality from timing, 0..1. */
  quality: number;
  /** Signed timing error in seconds (negative = early): adds a pull/push bias. */
  timingDelta: number;
  /** +1 when the ball is on the hitter's forehand side, -1 backhand. */
  handSide: number;
  /** Player speed at contact (m/s) relative to their top speed, 0..1. */
  moving: number;
  /** How far beyond a comfortable reach the contact is, 0..1. */
  stretch: number;
  /** Racket/player power multiplier (1 = average). */
  power: number;
  /** Racket/player control multiplier (1 = average; higher = smaller errors). */
  control: number;
  /** Multiplies the shot's spin (serves: flat / slice / kick by key). The launch is solved with it. */
  spinScale: number;
  /**
   * Swing-to-swing variability on top of the timing's (AI players; 0 for a human, whose own hands supply it):
   * spreads the swing's path, face and speed by `swing.motor` per unit (data/shots.json).
   */
  motor: number;
  /** Where the hitter's body is (x, z): the racket reaches from it to the ball. */
  bodyX: number;
  bodyZ: number;
}

export interface ShotResult {
  /** Did the clean solve reach the target within the speed the contact allowed? */
  reachable: boolean;
  speed: number;
  /** The swing: face speed at the impact point (m/s), apparent COR, where on the face, and a frame hit. */
  racketSpeed?: number;
  /** Face speed the swing could reach, and what the clean shot needed of it. */
  faceCap?: number;
  faceNeed?: number;
  ea?: number;
  fromTip?: number;
  across?: number;
  frame?: boolean;
  /** Ideal (pre-error) landing point, for debug/assists. */
  idealX: number;
  idealZ: number;
}

const ghost = new Ball();
const dir = new V3();
const tmpV = new V3();

export class ShotSolver {
  readonly world: BallWorld;
  readonly racket: Racket;
  // Results of the last fly().
  landX = 0;
  landZ = 0;
  landT = 0;
  netY = NaN;

  constructor(world: BallWorld) {
    this.world = world;
    this.racket = new Racket(RACKETS.standard!, world.spec.mass, world.spec.radius, world.spec.inertiaFactor);
  }

  /**
   * Free flight (no walls/net) from p with velocity v and spin w until the ball reaches the floor, or until it
   * is `maxRange` metres along `dir` (then landX/landZ is where it was, which is enough for the solver to know
   * it went long).
   */
  fly(p: V3, v: V3, w: V3, maxRange = 1e9): void {
    const g = ghost;
    g.pos.copy(p);
    g.vel.copy(v);
    g.spin.copy(w);
    g.outside = false;
    g.rolling = false;
    g.ahead = 0;
    g.clearNet();
    this.netY = NaN;
    let z0 = p.z;
    let y0 = p.y;
    for (let t = 0; t < 5; t += DT) {
      g.step(this.world, DT, null, true);
      if (Number.isNaN(this.netY) && (z0 > 0) !== (g.pos.z > 0)) {
        const f = z0 / (z0 - g.pos.z);
        this.netY = y0 + (g.pos.y - y0) * f;
      }
      z0 = g.pos.z;
      y0 = g.pos.y;
      for (let k = 0; k < g.eventCount; k++) {
        if (g.events[k]!.kind === HIT_FLOOR) {
          this.landX = g.events[k]!.x;
          this.landZ = g.events[k]!.z;
          this.landT = t;
          return;
        }
      }
      if ((g.pos.x - p.x) * dir.x + (g.pos.z - p.z) * dir.z > maxRange) break;
    }
    this.landX = g.pos.x;
    this.landZ = g.pos.z;
    this.landT = 5;
  }

  /** Spin vector for a shot travelling along horizontal unit direction (dx, dz): + topspin, - backspin. */
  static spinFor(rpm: number, dx: number, dz: number, out: V3): V3 {
    const w = (rpm * 2 * PI) / 60;
    return out.set(w * dz, 0, -w * dx);
  }

  private launch(s: number, th: number, outV: V3): V3 {
    return outV.set(dir.x * s * cos(th), s * sin(th), dir.z * s * cos(th));
  }

  // Residuals of the last eval(): landing distance error and net-crossing height error.
  private eR = 0;
  private eN = 0;
  private evals = 0;

  private eval(p: V3, s: number, th: number, w: V3, dist: number, want: number, crosses: boolean): void {
    this.evals++;
    this.fly(p, this.launch(s, th, tmpV), w, dist + 6);
    this.eR = (this.landX - p.x) * dir.x + (this.landZ - p.z) * dir.z - dist;
    // A ball that lands before reaching the net reads as "far below the net".
    this.eN = crosses ? (Number.isNaN(this.netY) ? -3 : this.netY - want) : 0;
  }


  private ns = 0;
  private nth = 0;

  /** 2D Newton on (speed, elevation) for landing distance and net height. */
  private newton(p: V3, s0: number, th0: number, w: V3, dist: number, want: number): boolean {
    let s = s0;
    let th = th0;
    for (let it = 0; it < 12; it++) {
      this.eval(p, s, th, w, dist, want, true);
      const r0 = this.eR;
      const n0 = this.eN;
      this.ns = s;
      this.nth = th;
      if (abs(r0) < 0.02 && abs(n0) < 0.02) return true;
      const ds = 0.05 + 0.002 * s;
      const dth = 0.002;
      this.eval(p, s + ds, th, w, dist, want, true);
      const rS = (this.eR - r0) / ds;
      const nS = (this.eN - n0) / ds;
      this.eval(p, s, th + dth, w, dist, want, true);
      const rT = (this.eR - r0) / dth;
      const nT = (this.eN - n0) / dth;
      const det = rS * nT - rT * nS;
      if (abs(det) < 1e-9) return false;
      s = clamp(s - clamp((r0 * nT - rT * n0) / det, -8, 8), 1, 70);
      th = clamp(th - clamp((rS * n0 - r0 * nS) / det, -0.12, 0.12), -0.7, 1.35);
    }
    return false;
  }

  /** Fixed speed: bisect the elevation for the landing distance; succeed only if it also clears the net. */
  private distanceAt(p: V3, s: number, w: V3, dist: number, want: number, crosses: boolean): boolean {
    // Steepest useful angle is just above the straight line to the landing point.
    let lo = atan2(-(p.y - 0.033), dist) + 0.01;
    let hi = (40 * PI) / 180;
    this.eval(p, s, hi, w, dist, want, crosses);
    if (this.eR < 0) return false;
    for (let i = 0; i < 16; i++) {
      const m = (lo + hi) * 0.5;
      this.eval(p, s, m, w, dist, want, crosses);
      if (this.eR < 0) lo = m; else hi = m;
    }
    this.ns = s;
    this.nth = (lo + hi) * 0.5;
    this.eval(p, s, this.nth, w, dist, want, crosses);
    return !crosses || this.eN >= -(want - this.world.court.netHeightAt(0)) + 0.06;
  }

  /** Slow but sure: nested bisection (elevation outside, speed inside). */
  private robust(p: V3, w: V3, dist: number, want: number, crosses: boolean): boolean {
    let lo = -0.6;
    let hi = 1.3;
    let found = false;
    for (let i = 0; i < 18; i++) {
      const th = (lo + hi) * 0.5;
      // Speed for distance at this elevation.
      let sLo = 1;
      let sHi = 70;
      this.eval(p, sHi, th, w, dist, want, crosses);
      if (this.eR < 0) { lo = th; continue; }
      for (let j = 0; j < 16; j++) {
        const sm = (sLo + sHi) * 0.5;
        this.eval(p, sm, th, w, dist, want, crosses);
        if (this.eR < 0) sLo = sm; else sHi = sm;
      }
      this.ns = (sLo + sHi) * 0.5;
      this.nth = th;
      found = true;
      this.eval(p, this.ns, th, w, dist, want, crosses);
      if (!crosses || abs(this.eN) < 0.03) return true;
      if (this.eN < 0) lo = th; else hi = th;
    }
    if (!found) { this.ns = 30; this.nth = 0.6; }
    return false;
  }

  /**
   * Full pace: the speed is the contact's cap and only the elevation is solved for the landing distance (the
   * net is a check, not a target). False if that would not clear the tape by `minClear`: from deep in the
   * court a full-pace smash skims the net, so the caller takes pace off instead (as players do).
   */
  solvePace(p: V3, tx: number, tz: number, rpm: number, cap: number, minClear: number, outV: V3, outW: V3): boolean {
    this.evals = 0;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = sqrt(dx * dx + dz * dz);
    dir.set(dx / dist, 0, dz / dist);
    ShotSolver.spinFor(rpm, dir.x, dir.z, outW);
    const crosses = (p.z > 0) !== (tz > 0);
    const f0 = crosses ? p.z / (p.z - tz) : 0.5;
    const want = crosses ? this.world.court.netHeightAt(p.x + dx * f0) : 0;
    if (!this.distanceAt(p, cap, outW, dist, want, crosses)) return false;
    if (crosses && this.eN < minClear) return false;
    this.launch(this.ns, this.nth, outV);
    return true;
  }

  /**
   * Find the clean launch from contact point p to land on (tx, tz), clearing the net by `clear` metres,
   * with topspin `rpm`. Newton's method on (speed, elevation), started from the exact vacuum trajectory
   * through the net point and the landing point. If the contact cannot produce the needed speed (`cap`),
   * the ball goes out at the capped speed with a little extra lift and may fall short. Writes velocity and spin.
   */
  solve(p: V3, tx: number, tz: number, rpm: number, clear: number, cap: number, outV: V3, outW: V3): boolean {
    this.evals = 0;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = sqrt(dx * dx + dz * dz);
    dir.set(dx / dist, 0, dz / dist);
    ShotSolver.spinFor(rpm, dir.x, dir.z, outW);
    const r = this.world.spec.radius;
    const crosses = (p.z > 0) !== (tz > 0);
    const f0 = crosses ? p.z / (p.z - tz) : 0.5;
    const dn = dist * f0;
    const want = crosses ? this.world.court.netHeightAt(p.x + dx * f0) + clear : 0;

    // Vacuum parabola y(x) = h0 + a x - k x^2 through (dn, want) and (dist, r).
    const h0 = p.y;
    let s = 15;
    let th = 0.2;
    let ok = false;
    let k = -1;
    if (crosses) {
      const det = dn * dist * (dn - dist);
      const a = ((want - h0) * -dist * dist + dn * dn * (r - h0)) / det;
      k = (dn * (r - h0) - dist * (want - h0)) / det;
      if (k > 1e-6) {
        th = atan(a);
        const c = cos(th);
        s = clamp(sqrt(9.81 / (2 * k * c * c)) * 1.08, 2, 70); // drag needs a little more than vacuum
        ok = this.newton(p, s, th, outW, dist, want);
        s = this.ns;
        th = this.nth;
      }
    }
    if (!ok) {
      // Overheads (the net is no constraint) or no clean Newton solution: full available pace, elevation for
      // the distance, then make sure it clears the net.
      ok = this.distanceAt(p, min(cap, 60) * 0.97, outW, dist, want, crosses);
      s = this.ns;
      th = this.nth;
      if (!ok) {
        ok = this.robust(p, outW, dist, want, crosses);
        s = this.ns;
        th = this.nth;
      }
    }
    if (s <= cap) {
      this.launch(s, th, outV);
      return ok;
    }
    // Not enough contact speed: up to 6 degrees of extra lift to carry the distance. Failing that, a player with
    // no pace left loops it: the lowest launch that still clears the net (and carries furthest), a short ball.
    const thMax = th + (6 * PI) / 180;
    let lo = th;
    let hi = thMax;
    this.eval(p, cap, hi, outW, dist, want, crosses);
    if (this.eR < 0) {
      let best = hi;
      let bestR = this.eR;
      if (crosses) {
        const tape = want - clear + 0.05;
        let ok = this.eN + clear >= 0.05;
        for (let k = 1; k <= 12 && (!ok || this.eR < 0); k++) {
          const t2 = hi + ((3 * PI) / 180) * k;
          this.eval(p, cap, t2, outW, dist, want, crosses);
          const clears = this.eN >= tape - want;
          if (clears && (!ok || this.eR > bestR)) { best = t2; bestR = this.eR; ok = true; }
          if (ok && this.eR >= 0) break;
        }
      }
      this.launch(cap, best, outV);
      return false;
    }
    for (let i = 0; i < 10; i++) {
      const m = (lo + hi) * 0.5;
      this.eval(p, cap, m, outW, dist, want, crosses);
      if (this.eR < 0) lo = m; else hi = m;
    }
    this.launch(cap, (lo + hi) * 0.5, outV);
    return false;
  }

  /** Flights used by the last solve (performance checks). */
  get lastEvals(): number {
    return this.evals;
  }
}

const vin = new V3();
const win = new V3();
const wantV = new V3();
const wantW = new V3();
const faceN = new V3();
const faceV = new V3();
const gotV = new V3();
const gotW = new V3();
const axis = new V3();
const hor = new V3();

/**
 * Contact model: the face speed the swing can reach (shape, modifier, timing, body position), the ball speed
 * that gives off this incoming ball, the clean shot within it, the swing that makes it, the swing's errors,
 * and the impact. Writes the ball's new velocity and spin.
 */
export function strike(solver: ShotSolver, ball: Ball, req: ShotRequest, rng: Rng, out: ShotResult): void {
  const shape = SHAPES[req.shot]!;
  const mod = MODS[req.mod]!;
  const rk = solver.racket;
  const q = req.quality;
  const bad = 1 - q;
  vin.copy(ball.vel);
  win.copy(ball.spin);
  // Players play the ball they have: the solves fly a ball as worn as this one.
  ghost.copyWear(ball);
  rk.eScale = ball.eScale;

  const tdx = req.targetX - ball.pos.x;
  const tdz = req.targetZ - ball.pos.z;
  const tdl = sqrt(tdx * tdx + tdz * tdz);
  // The racket's long axis: across the shot towards the side of the body the ball is on (the head drops for a
  // low ball), up for overheads.
  const overhead = req.shot === SHOT_SMASH || req.shot === SHOT_BANDEJA || req.shot === SHOT_VIBORA;
  if (overhead || tdl < 1e-6) axis.set(0, 1, 0);
  else {
    let lx = -tdz / tdl;
    let lz = tdx / tdl;
    const side = (ball.pos.x - req.bodyX) * lx + (ball.pos.z - req.bodyZ) * lz;
    if (side < 0 || (side === 0 && req.handSide < 0)) { lx = -lx; lz = -lz; }
    axis.set(lx, -clamp((0.95 - ball.pos.y) * 0.9, 0, 0.8), lz);
  }

  // Face speed the swing can reach, and the ball speed that gives head on off this ball at the planned point.
  const lowBall = ball.pos.y < 0.45 ? 0.75 + 0.55 * ball.pos.y : 1;
  const vCap = shape.racketMax * mod.speed * req.power * (0.7 + 0.3 * q) * lowBall
    * (1 - 0.18 * req.moving) * (1 - 0.25 * req.stretch);
  const along = tdl > 1e-6 ? max(0, -(vin.x * tdx + vin.z * tdz) / tdl) : 0;
  const ea0 = rk.acor(vCap + along, shape.impact, 0);
  let cap = ea0 * along + (1 + ea0) * vCap;

  const clear = shape.netClear * mod.netClear;
  let rpm = shape.spinRpm * req.spinScale * (0.7 + 0.3 * q);
  // Pace shots keep a safer margin over the tape: full pace when that clears it, else as fast as clears it.
  const paceClear = clear + 0.25;
  // Swing errors (spreads here: the swing is made for the contact this hitter usually gets).
  const err = shape.errorScale * mod.error / req.control;
  const mv = req.moving;
  const st = req.stretch;
  const spread = (c: number[]) => c[0]! + c[1]! * bad + (c[2] ?? 0) * mv + (c[3] ?? 0) * st;
  const sAlong = spread(SW.contactAlong) * err;
  const sAcross = spread(SW.contactAcross) * err;
  rk.spreadAlong = sAlong;
  rk.spreadAcross = q < 0.2 ? 0 : sAcross;

  // Solve, find the swing. If it needs more face speed than there is (spin costs speed), take pace off; if the
  // face cannot give the spin the flight was solved with (friction), solve the flight again with what it gives.
  for (let pass = 0; pass < 5; pass++) {
    ball.vel.copy(vin);
    out.reachable = (shape.pace === true && solver.solvePace(ball.pos, req.targetX, req.targetZ, rpm, cap, paceClear, ball.vel, ball.spin))
      || solver.solve(ball.pos, req.targetX, req.targetZ, rpm, shape.pace === true ? paceClear : clear, cap, ball.vel, ball.spin);
    if (shape.sideRpm) addSidespin(solver, ball, req, (shape.sideRpm * 2 * PI) / 60 * (0.7 + 0.3 * q));
    wantV.copy(ball.vel);
    wantW.copy(ball.spin);
    rk.swing(vin, win, wantV, wantW, axis, shape.impact, faceN, faceV);
    const need = faceV.length();
    out.faceNeed = need;
    let again = false;
    if (need > vCap * 1.03) {
      // Not enough face speed: brushing for spin costs face speed whatever the pace, so a player takes spin off
      // first and pace only once there is little spin left to give.
      if (abs(rpm) > (shape.spinFloor ?? 0.3) * abs(shape.spinRpm * req.spinScale) + 50) rpm *= max(0.4, (vCap / need) * 0.9);
      else cap *= (vCap / need) * 0.99;
      again = true;
    }
    if (rk.spinLimited && tdl > 1e-6) {
      // The top/back spin the face really gives (about the axis the solver spins the ball on).
      rk.impact(vin, win, faceN, faceV, axis, shape.impact, 0, gotV, gotW);
      const got = ((gotW.x * tdz - gotW.z * tdx) / tdl) * (60 / (2 * PI));
      if (abs(got - rpm) > 0.05 * abs(rpm) + 30) {
        rpm = got;
        again = true;
      }
    }
    if (!again) break;
  }
  out.idealX = req.targetX;
  out.idealZ = req.targetZ;

  // Swing errors.
  const deg = (PI / 180) * err;
  const mot = req.motor;
  const MO = SW.motor;
  // Early pulls the swing across the hitter's body, late pushes it the other way.
  const tim = clamp(req.timingDelta / 0.11, -2, 2);
  const yaw = tim * SW.timingYaw * (PI / 180) * req.handSide + rng.normal() * (spread(SW.pathYaw) + mot * MO.pathYaw) * deg;
  const pitch = rng.normal() * (spread(SW.pathPitch) + mot * MO.pathPitch) * deg;
  // The whole swing turned: face and path together.
  rotateYaw(faceN, yaw);
  rotateYaw(faceV, yaw);
  hor.set(faceN.z, 0, -faceN.x); // horizontal, square to the face's heading
  const hl = hor.length();
  if (hl > 1e-6) {
    hor.scale(1 / hl);
    rotateAbout(faceN, hor, pitch);
    rotateAbout(faceV, hor, pitch);
    // The face alone against the path: more open or closed, turned a little.
    rotateAbout(faceN, hor, rng.normal() * (spread(SW.faceOpen) + mot * MO.faceOpen) * deg);
  }
  rotateYaw(faceN, rng.normal() * spread(SW.faceYaw) * deg);
  faceV.scale(max(0.3, 1 + rng.normal() * (SW.speed[0]! + SW.speed[1]! * bad + mot * MO.speed) * err));

  // Where on the face: early meets the ball nearer the tip; too early / too late at the edge or the frame.
  let fromTip = shape.impact + tim * SW.timingAlong + rng.normal() * sAlong;
  let across = rng.normal() * sAcross;
  if (q < 0.2) {
    const sg = rng.next() < 0.5 ? -1 : 1;
    across = sg * (SW.edgeMin + SW.edgeRand * abs(rng.normal()));
  }
  const spec = rk.spec;
  const frame = fromTip < 0.005 || fromTip > spec.headLength - 0.005 || abs(across) > faceHalfWidth(spec, fromTip);
  if (frame) {
    // On the frame: the ball meets it at the face's edge, comes off weak, popped up and wild.
    fromTip = clamp(fromTip, 0.01, spec.headLength - 0.01);
    across = clamp(across, -faceHalfWidth(spec, fromTip), faceHalfWidth(spec, fromTip));
  }
  rk.impact(vin, win, faceN, faceV, axis, fromTip, across, ball.vel, ball.spin);
  ball.wearV = rk.u;
  ball.wearImpact(solver.world);
  if (frame) {
    ball.vel.scale(SW.frameSpeed + SW.frameSpeedRand * rng.next());
    rotateYaw(ball.vel, rng.normal() * SW.frameYaw * (PI / 180));
    rotatePitch(ball.vel, (SW.framePitch[0]! + (SW.framePitch[1]! - SW.framePitch[0]!) * rng.next()) * (PI / 180));
    ball.spin.scale(0.3);
  }
  out.speed = ball.vel.length();
  out.racketSpeed = faceV.length();
  out.faceCap = vCap;
  out.ea = rk.ea;
  out.fromTip = fromTip;
  out.across = across;
  out.frame = frame;
  ball.rolling = false;
  ball.ahead = 0;
  ball.clearNet();
}

/**
 * Sidespin about the vertical, curving the ball towards the side wall nearest the target, then the launch is
 * turned (two passes of free flight) so the curve still ends on the target. Per strike, not per tick.
 */
function addSidespin(solver: ShotSolver, ball: Ball, req: ShotRequest, w: number): void {
  const tdx = req.targetX - ball.pos.x;
  const tdz = req.targetZ - ball.pos.z;
  // Magnus pushes along spin x velocity: a spin wy on a ball travelling along z moves it by wy * vz in x.
  ball.spin.y = w * (req.targetX >= 0 ? 1 : -1) * (tdz >= 0 ? 1 : -1);
  const want = atan2(tdx, tdz);
  for (let k = 0; k < 2; k++) {
    solver.fly(ball.pos, ball.vel, ball.spin);
    const got = atan2(solver.landX - ball.pos.x, solver.landZ - ball.pos.z);
    let a = got - want;
    if (a > PI) a -= 2 * PI;
    else if (a < -PI) a += 2 * PI;
    rotateYaw(ball.vel, a);
  }
}

function rotateYaw(v: V3, a: number): void {
  const c = cos(a);
  const s = sin(a);
  const x = v.x * c - v.z * s;
  const z = v.x * s + v.z * c;
  v.x = x;
  v.z = z;
}

/** Rotate v by angle a about the unit axis k (Rodrigues). */
function rotateAbout(v: V3, k: V3, a: number): void {
  const c = cos(a);
  const sn = sin(a);
  const d = (k.x * v.x + k.y * v.y + k.z * v.z) * (1 - c);
  const cx = k.y * v.z - k.z * v.y;
  const cy = k.z * v.x - k.x * v.z;
  const cz = k.x * v.y - k.y * v.x;
  v.set(v.x * c + cx * sn + k.x * d, v.y * c + cy * sn + k.y * d, v.z * c + cz * sn + k.z * d);
}

function rotatePitch(v: V3, a: number): void {
  const h = sqrt(v.x * v.x + v.z * v.z);
  if (h < 1e-9) return;
  const c = cos(a);
  const s = sin(a);
  const h2 = h * c - v.y * s;
  const y2 = h * s + v.y * c;
  const k = h2 / h;
  v.x *= k;
  v.z *= k;
  v.y = y2;
}

export function shotShape(shot: number): ShotShape {
  return SHAPES[shot]!;
}

