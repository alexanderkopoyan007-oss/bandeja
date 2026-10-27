// Padel ball physics: flight (gravity, drag, Magnus, spin decay, wind), swept collisions with the
// court (floor, glass, mesh, openings, net and net cord), and spin-aware bounces.
import { V3 } from '../core/v3.ts';
import { Rng } from '../core/rng.ts';
import { GRAVITY } from '../core/constants.ts';
import { abs, clamp, cos, exp, max, pow, sin, sqrt, PI } from '../core/smath.ts';
import {
  Court, SURF_GLASS, SURF_MESH, SURF_OPEN, SURF_FLOOR, SURF_NET,
  WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, type ZoneHit,
} from '../court/court.ts';

export interface BallSpec {
  mass: number;
  radius: number;
  dragCoefficient: number;
  inertiaFactor: number;
  spinDecayTime: number;
  restitutionScale: number;
}

export interface SurfaceSpec {
  e0: number;
  eSlope: number;
  eMin: number;
  mu: number;
  grip: number;
  jitterDeg: number;
  speedJitter: number;
}

export interface SurfaceTable {
  glass: SurfaceSpec;
  mesh: SurfaceSpec;
  seam: SurfaceSpec;
  net: SurfaceSpec;
  seamWidth: number;
}

export interface Environment {
  temperatureC: number;
  altitudeM: number;
  windX: number;
  windZ: number;
}

export const SEA_LEVEL_AIR = 1.204;

/** Air density from altitude (barometric formula) and temperature (ideal gas). */
export function airDensity(env: Environment): number {
  const p = 101325 * pow(1 - 2.25577e-5 * env.altitudeM, 5.25588);
  return p / (287.05 * (env.temperatureC + 273.15));
}

// Contact event kinds
export const HIT_FLOOR = 1;
export const HIT_WALL = 2;
export const HIT_NET = 3;
export const HIT_NETCORD = 4;
export const LEFT_COURT = 5;

export interface ContactEvent {
  kind: number;
  /** Surface kind (SURF_*) for walls; SURF_FLOOR / SURF_NET otherwise. */
  surface: number;
  wall: number;
  /** Time of the contact within the step, seconds from the start of the step. */
  t: number;
  x: number;
  y: number;
  z: number;
  /** Normal impact speed (m/s). */
  speed: number;
}

const MAX_EVENTS = 8;
const MAX_CONTACTS_PER_STEP = 4;
const NET_TAPE_RADIUS = 0.012;

/** Fixed configuration for one match: ball, court, floor, environment. */
export class BallWorld {
  readonly spec: BallSpec;
  readonly court: Court;
  readonly floor: SurfaceSpec;
  readonly surfaces: SurfaceTable;
  readonly env: Environment;
  readonly rho: number;
  readonly kDrag: number;
  readonly kLift: number;
  readonly inertia: number;

  constructor(spec: BallSpec, court: Court, floor: SurfaceSpec, surfaces: SurfaceTable, env: Environment) {
    this.spec = spec;
    this.court = court;
    this.floor = floor;
    this.surfaces = surfaces;
    this.env = env;
    this.rho = airDensity(env);
    const area = PI * spec.radius * spec.radius;
    this.kDrag = (0.5 * this.rho * spec.dragCoefficient * area) / spec.mass;
    this.kLift = (0.5 * this.rho * area) / spec.mass;
    this.inertia = spec.inertiaFactor * spec.mass * spec.radius * spec.radius;
  }
}

// Scratch vectors (module-level so steps never allocate).
const a0 = new V3();
const a1 = new V3();
const vMid = new V3();
const p1 = new V3();
const v1 = new V3();
const w1 = new V3();
const tmp = new V3();
const n = new V3();
const u = new V3();
const jt = new V3();
const rc = new V3();
const zone: ZoneHit = { kind: 0, seamDist: 0 };

export class Ball {
  readonly pos = new V3();
  readonly vel = new V3();
  readonly spin = new V3();
  /** True once the ball has left the enclosure (over a wall or through an opening). */
  outside = false;
  /** Resting/rolling on the floor (no more bounces). */
  rolling = false;

  readonly events: ContactEvent[] = [];
  eventCount = 0;

  constructor() {
    for (let i = 0; i < MAX_EVENTS; i++) {
      this.events.push({ kind: 0, surface: 0, wall: -1, t: 0, x: 0, y: 0, z: 0, speed: 0 });
    }
  }

  copyFrom(b: Ball): this {
    this.pos.copy(b.pos);
    this.vel.copy(b.vel);
    this.spin.copy(b.spin);
    this.outside = b.outside;
    this.rolling = b.rolling;
    return this;
  }

  /**
   * Advance by dt seconds. Contacts found during the step are written to `events` (eventCount).
   * `rng` adds the random part of mesh/seam/turf bounces; pass null for a noise-free prediction.
   * `flightOnly` ignores walls and the net (used when solving shot trajectories).
   */
  step(world: BallWorld, dt: number, rng: Rng | null, flightOnly = false): void {
    this.eventCount = 0;
    if (this.rolling) {
      this.roll(world, dt);
      return;
    }
    let remaining = dt;
    let elapsed = 0;
    for (let iter = 0; iter < MAX_CONTACTS_PER_STEP && remaining > 1e-9; iter++) {
      this.integrate(world, remaining, p1, v1, w1);
      const f = this.findContact(world, p1, flightOnly);
      if (f < 0) {
        this.pos.copy(p1);
        this.vel.copy(v1);
        this.spin.copy(w1);
        break;
      }
      // Move to the contact point (linear within the step), resolve the bounce, continue.
      this.pos.lerpOf(this.pos, p1, f);
      this.vel.lerpOf(this.vel, v1, f);
      this.spin.lerpOf(this.spin, w1, f);
      elapsed += f * remaining;
      this.resolve(world, rng, elapsed);
      remaining *= 1 - f;
    }
    if (!flightOnly) this.checkExit(world, elapsed);
  }

  // ---- flight -------------------------------------------------------------------------------

  private accel(world: BallWorld, v: V3, w: V3, out: V3): void {
    const env = world.env;
    const rx = v.x - env.windX;
    const ry = v.y;
    const rz = v.z - env.windZ;
    const s = sqrt(rx * rx + ry * ry + rz * rz);
    const kd = world.kDrag * s;
    out.set(-kd * rx, -GRAVITY - kd * ry, -kd * rz);
    const wl = w.length();
    if (wl > 1e-6 && s > 1e-6) {
      // Lift coefficient from spin ratio S = r|w|/|v|: Cl = 1 / (2 + 1/S)  (tennis-ball fit)
      const cl = 1 / (2 + s / (world.spec.radius * wl));
      const k = (world.kLift * cl * s) / wl;
      out.x += k * (w.y * rz - w.z * ry);
      out.y += k * (w.z * rx - w.x * rz);
      out.z += k * (w.x * ry - w.y * rx);
    }
  }

  /** Midpoint (RK2) integration of position/velocity; exponential spin decay. */
  private integrate(world: BallWorld, dt: number, pOut: V3, vOut: V3, wOut: V3): void {
    this.accel(world, this.vel, this.spin, a0);
    vMid.copy(this.vel).addScaled(a0, dt * 0.5);
    this.accel(world, vMid, this.spin, a1);
    vOut.copy(this.vel).addScaled(a1, dt);
    pOut.copy(this.pos).addScaled(vMid, dt);
    const decay = exp((-dt * world.rho) / (world.spec.spinDecayTime * SEA_LEVEL_AIR));
    wOut.copy(this.spin).scale(decay);
  }

  private roll(world: BallWorld, dt: number): void {
    const v = this.vel;
    const s = sqrt(v.x * v.x + v.z * v.z);
    const decel = 0.8 * dt;
    const k = s > decel ? (s - decel) / s : 0;
    v.set(v.x * k, 0, v.z * k);
    this.pos.addScaled(v, dt);
    this.pos.y = world.spec.radius;
    // Rolling without slipping.
    const r = world.spec.radius;
    this.spin.set(v.z / r, 0, -v.x / r);
    this.checkExit(world, 0);
  }

  // ---- collisions ---------------------------------------------------------------------------

  private hitKind = 0;
  private hitWall = -1;
  private hitSurface = 0;

  /** Candidate contact fraction being tested, and the best so far (fields, not arguments: passing doubles
   *  through non-inlined calls boxes them, which would allocate every tick). */
  private cand = 0;
  private best = 2;

  /** Earliest contact fraction along pos -> p (0..1), or -1. Records what was hit. */
  private findContact(world: BallWorld, p: V3, flightOnly: boolean): number {
    const r = world.spec.radius;
    const c = world.court;
    const q = this.pos;
    this.best = 2;

    // Floor (everywhere, inside or outside the court).
    if (p.y < r && q.y >= r - 1e-9) {
      const f = (q.y - r) / (q.y - p.y);
      if (f < this.best) { this.best = f; this.hitKind = HIT_FLOOR; this.hitSurface = SURF_FLOOR; this.hitWall = -1; }
    }

    if (!this.outside && !flightOnly) {
      // Side walls.
      const xl = c.halfW - r;
      if (p.x > xl && q.x <= xl) { this.cand = (xl - q.x) / (p.x - q.x); this.tryWall(c, p, WALL_SIDE_RIGHT); }
      if (p.x < -xl && q.x >= -xl) { this.cand = (-xl - q.x) / (p.x - q.x); this.tryWall(c, p, WALL_SIDE_LEFT); }
      // Back walls.
      const zl = c.halfL - r;
      if (p.z > zl && q.z <= zl) { this.cand = (zl - q.z) / (p.z - q.z); this.tryWall(c, p, WALL_BACK_NEAR); }
      if (p.z < -zl && q.z >= -zl) { this.cand = (-zl - q.z) / (p.z - q.z); this.tryWall(c, p, WALL_BACK_FAR); }
      // Net body and tape.
      this.tryNet(c, p, r);
    }
    return this.best <= 1 ? this.best : -1;
  }

  private tryWall(c: Court, p: V3, wall: number): void {
    const f = this.cand;
    if (f >= this.best) return;
    const q = this.pos;
    const x = q.x + (p.x - q.x) * f;
    const y = q.y + (p.y - q.y) * f;
    const z = q.z + (p.z - q.z) * f;
    if (wall === WALL_BACK_NEAR || wall === WALL_BACK_FAR) c.backZone(x, y, zone);
    else c.sideZone(z, y, zone);
    if (zone.kind === SURF_OPEN) return;
    this.hitKind = HIT_WALL;
    this.hitWall = wall;
    this.hitSurface = zone.kind;
    this.hitSeam = zone.seamDist;
    this.best = f;
  }

  private hitSeam = 0.5;

  private tryNet(c: Court, p: V3, r: number): void {
    const q = this.pos;
    // Net body: centre crosses z = +-r while below the tape.
    for (let s = -1; s <= 1; s += 2) {
      const plane = s * r; // approaching from the side where sign(z) = s
      if ((s > 0 && q.z >= plane && p.z < plane) || (s < 0 && q.z <= plane && p.z > plane)) {
        const f = (q.z - plane) / (q.z - p.z);
        if (f < this.best) {
          const x = q.x + (p.x - q.x) * f;
          const y = q.y + (p.y - q.y) * f;
          if (abs(x) <= c.halfW && y < c.netHeightAt(x) - NET_TAPE_RADIUS) {
            this.best = f;
            this.hitKind = HIT_NET;
            this.hitSurface = SURF_NET;
            this.hitWall = -1;
            n.set(0, 0, s);
          }
        }
      }
    }
    // Net tape: horizontal cylinder along x at the top of the net. Sphere-vs-line test, quadratic in f.
    const xm = (q.x + p.x) * 0.5;
    if (abs(xm) <= c.halfW) {
      const h = c.netHeightAt(xm) - NET_TAPE_RADIUS;
      const R = r + NET_TAPE_RADIUS;
      const dy0 = q.y - h;
      const dz0 = q.z;
      const ddy = p.y - q.y;
      const ddz = p.z - q.z;
      const A = ddy * ddy + ddz * ddz;
      const B = 2 * (dy0 * ddy + dz0 * ddz);
      const C = dy0 * dy0 + dz0 * dz0 - R * R;
      if (C > 0 && A > 1e-12) {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const f = (-B - sqrt(disc)) / (2 * A);
          if (f >= 0 && f < this.best) {
            this.best = f;
            this.hitKind = HIT_NETCORD;
            this.hitSurface = SURF_NET;
            this.hitWall = -1;
            const yy = dy0 + ddy * f;
            const zz = dz0 + ddz * f;
            const l = sqrt(yy * yy + zz * zz);
            n.set(0, yy / l, zz / l);
          }
        }
      }
    }
  }

  private resolve(world: BallWorld, rng: Rng | null, t: number): void {
    const c = world.court;
    let surf: SurfaceSpec = world.floor;
    switch (this.hitKind) {
      case HIT_FLOOR:
        n.set(0, 1, 0);
        break;
      case HIT_WALL: {
        if (this.hitWall === WALL_SIDE_RIGHT) n.set(-1, 0, 0);
        else if (this.hitWall === WALL_SIDE_LEFT) n.set(1, 0, 0);
        else if (this.hitWall === WALL_BACK_NEAR) n.set(0, 0, -1);
        else n.set(0, 0, 1);
        const base = this.hitSurface === SURF_GLASS ? world.surfaces.glass : world.surfaces.mesh;
        surf = this.hitSeam < world.surfaces.seamWidth && c.def.frame === 'posts' ? world.surfaces.seam : base;
        if (this.hitSeam < world.surfaces.seamWidth * 0.5 && this.hitSurface === SURF_GLASS) surf = world.surfaces.seam;
        break;
      }
      case HIT_NET:
      case HIT_NETCORD:
        surf = world.surfaces.net;
        break;
    }
    const vnBefore = this.vel.dot(n);
    this.bounce(world, surf, rng, this.hitKind === HIT_NETCORD);
    // Keep the ball just off the surface.
    this.pos.addScaled(n, 1e-6);

    if (this.eventCount < MAX_EVENTS) {
      const e = this.events[this.eventCount++]!;
      e.kind = this.hitKind;
      e.surface = this.hitSurface;
      e.wall = this.hitWall;
      e.t = t;
      e.x = this.pos.x;
      e.y = this.pos.y;
      e.z = this.pos.z;
      e.speed = -vnBefore;
    }
    if (this.hitKind === HIT_FLOOR && this.vel.y < 0.25) {
      this.rolling = true;
      this.vel.y = 0;
      this.pos.y = world.spec.radius;
    }
  }

  /** Spin-aware impulse bounce against the surface whose outward normal is `n`. */
  private bounce(world: BallWorld, s: SurfaceSpec, rng: Rng | null, cord: boolean): void {
    const spec = world.spec;
    const r = spec.radius;
    const m = spec.mass;
    const alpha = spec.inertiaFactor;

    // Random deflection of the normal (mesh, seams, turf).
    if (rng && s.jitterDeg > 0) {
      const ang = (s.jitterDeg * PI) / 180;
      const a = rng.normal() * ang * 0.5;
      const b = rng.next() * 2 * PI;
      // Two tangents of n.
      if (abs(n.y) < 0.9) tmp.set(0, 1, 0); else tmp.set(1, 0, 0);
      u.crossOf(n, tmp);
      const ul = u.length();
      u.scale(1 / ul);
      jt.crossOf(n, u);
      const sa = sin(a);
      n.scale(cos(a)).addScaled(u, sa * cos(b)).addScaled(jt, sa * sin(b));
    }

    const vn = this.vel.dot(n);
    if (vn >= 0) return; // moving away already
    let e = clamp(s.e0 - s.eSlope * -vn, s.eMin, s.e0) * spec.restitutionScale;
    if (cord) e = max(e, 0.3);
    if (rng && s.speedJitter > 0) e *= 1 - s.speedJitter * rng.next();

    // Tangential velocity of the contact point: u = v_t + w x (-r n).
    u.copy(this.vel).addScaled(n, -vn);
    rc.copy(n).scale(-r);
    tmp.crossOf(this.spin, rc);
    u.add(tmp);

    const jn = m * (1 + e) * -vn;
    // Impulse that brings the contact point to -grip * u (grip with a little elastic reversal).
    const kGrip = ((1 + s.grip) * m * alpha) / (1 + alpha);
    jt.copy(u).scale(-kGrip);
    const jtl = jt.length();
    const jmax = s.mu * jn;
    if (jtl > jmax && jtl > 0) jt.scale(jmax / jtl);

    // Apply.
    this.vel.addScaled(n, -(1 + e) * vn).addScaled(jt, 1 / m);
    tmp.crossOf(rc, jt);
    this.spin.addScaled(tmp, 1 / world.inertia);

    // Never leave travelling into the surface (possible after jitter on a grazing hit).
    const vn2 = this.vel.dot(n);
    if (vn2 < 0.05) this.vel.addScaled(n, 0.05 - vn2);
  }

  private checkExit(world: BallWorld, t: number): void {
    if (this.outside) return;
    const c = world.court;
    const p = this.pos;
    if (abs(p.x) > c.halfW + 0.05 || abs(p.z) > c.halfL + 0.05 || p.y > 12) {
      this.outside = true;
      if (this.eventCount < MAX_EVENTS) {
        const e = this.events[this.eventCount++]!;
        e.kind = LEFT_COURT;
        e.surface = SURF_OPEN;
        e.wall = abs(p.z) > c.halfL ? (p.z > 0 ? WALL_BACK_NEAR : WALL_BACK_FAR) : p.x > 0 ? WALL_SIDE_RIGHT : WALL_SIDE_LEFT;
        e.t = t;
        e.x = p.x; e.y = p.y; e.z = p.z;
        e.speed = 0;
      }
    }
  }
}

export { SURF_GLASS, SURF_MESH, SURF_FLOOR, SURF_NET, SURF_OPEN };
