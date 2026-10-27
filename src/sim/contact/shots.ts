// Racket–ball contact. A shot is chosen as a target + shape (net clearance, spin, depth); the solver finds
// the launch that flies there under the real flight model, the contact physics caps the speed that is
// possible, and the error model perturbs the launch from timing, footwork, stretch and modifiers.
import { Ball, HIT_FLOOR, type BallWorld } from '../ball/ball.ts';
import { V3 } from '../core/v3.ts';
import { Rng } from '../core/rng.ts';
import { DT } from '../core/constants.ts';
import { abs, atan, atan2, clamp, cos, max, min, sin, sqrt, PI } from '../core/smath.ts';
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

export const SHOT_KEYS = ['drive', 'topspin', 'slice', 'lob', 'drop', 'serve', 'smash', 'bandeja', 'volley'] as const;

export const MOD_NONE = 0;
export const MOD_POWER = 1;
export const MOD_PRECISION = 2;

export interface ShotShape {
  name: string;
  netClear: number;
  spinRpm: number;
  depth: number;
  speedMax: number;
  errorScale: number;
  /** Full pace: hit at the contact's top speed, elevation chosen for the distance (kill smash). */
  pace?: boolean;
}

interface ModSpec { netClear: number; speed: number; error: number }

const data = shotData as unknown as Record<string, ShotShape> & { modifiers: { power: ModSpec; precision: ModSpec } };
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
}

export interface ShotResult {
  /** Did the clean solve reach the target within the speed the contact allowed? */
  reachable: boolean;
  speed: number;
  /** Ideal (pre-error) landing point, for debug/assists. */
  idealX: number;
  idealZ: number;
}

const ghost = new Ball();
const dir = new V3();
const tmpV = new V3();

export class ShotSolver {
  readonly world: BallWorld;
  // Results of the last fly().
  landX = 0;
  landZ = 0;
  landT = 0;
  netY = NaN;

  constructor(world: BallWorld) {
    this.world = world;
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
    // Not enough contact speed: up to 6 degrees of extra lift to carry the distance, else it falls short.
    const thMax = th + (6 * PI) / 180;
    let lo = th;
    let hi = thMax;
    this.eval(p, cap, hi, outW, dist, want, crosses);
    if (this.eR < 0) {
      this.launch(cap, hi, outV);
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

/**
 * Contact model: pick the speed cap from shape, modifier, quality and body position, solve the clean shot,
 * then apply the error model. Writes the ball's new velocity and spin.
 */
export function strike(solver: ShotSolver, ball: Ball, req: ShotRequest, rng: Rng, out: ShotResult): void {
  const shape = SHAPES[req.shot]!;
  const mod = MODS[req.mod]!;
  const q = req.quality;

  // Sweet spot: poorer timing and stretching move contact towards the edge of the face.
  const off = clamp(abs(rng.normal()) * (0.04 + 0.32 * (1 - q) + 0.2 * req.stretch), 0, 1);
  const sweet = 1 - 0.45 * off * off;
  const lowBall = ball.pos.y < 0.45 ? 0.75 + 0.55 * ball.pos.y : 1;
  const cap = shape.speedMax * mod.speed * req.power * (0.55 + 0.45 * q) * sweet * lowBall
    * (1 - 0.18 * req.moving) * (1 - 0.25 * req.stretch);

  const clear = shape.netClear * mod.netClear;
  const rpm = shape.spinRpm * req.spinScale * (0.7 + 0.3 * q);
  // Pace shots keep a safer margin over the tape: full pace when that clears it, else as fast as clears it.
  const paceClear = clear + 0.25;
  out.reachable = (shape.pace === true && solver.solvePace(ball.pos, req.targetX, req.targetZ, rpm, cap, paceClear, ball.vel, ball.spin))
    || solver.solve(ball.pos, req.targetX, req.targetZ, rpm, shape.pace === true ? paceClear : clear, cap, ball.vel, ball.spin);
  out.idealX = req.targetX;
  out.idealZ = req.targetZ;

  // Error model (angles in radians).
  const err = shape.errorScale * mod.error / req.control;
  const bad = 1 - q;
  const deg = PI / 180;
  const sYaw = (0.5 + 4.0 * bad + 1.5 * req.moving + 2.5 * req.stretch) * err * deg;
  const sPitch = (0.3 + 2.4 * bad + 0.9 * req.moving + 1.5 * req.stretch) * err * deg;
  const sSpeed = (0.015 + 0.07 * bad) * err;
  // Early pulls the ball across the hitter's body, late pushes it the other way.
  const bias = clamp(req.timingDelta / 0.11, -2, 2) * 2.2 * deg * req.handSide;

  rotateYaw(ball.vel, bias + rng.normal() * sYaw);
  rotatePitch(ball.vel, rng.normal() * sPitch);
  ball.vel.scale(max(0.3, 1 + rng.normal() * sSpeed));
  ball.spin.scale(clamp(1 + rng.normal() * (0.08 + 0.2 * bad), 0.2, 1.6));
  if (q < 0.2) {
    // Frame shot: the ball comes off the edge.
    ball.vel.scale(0.55 + 0.25 * rng.next());
    rotateYaw(ball.vel, rng.normal() * 9 * deg);
    rotatePitch(ball.vel, rng.normal() * 6 * deg);
    ball.spin.scale(0.3);
  }
  out.speed = ball.vel.length();
  ball.rolling = false;
}

function rotateYaw(v: V3, a: number): void {
  const c = cos(a);
  const s = sin(a);
  const x = v.x * c - v.z * s;
  const z = v.x * s + v.z * c;
  v.x = x;
  v.z = z;
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

