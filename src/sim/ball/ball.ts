// Padel ball physics: flight (gravity, drag, Magnus, spin decay, wind), swept collisions with the
// court (floor, glass, mesh, openings, net posts and net cord), spin-aware bounces, and a net body that gives
// (the ball is caught by a tensioned mesh, solved in closed form while it is in it).
import { V3 } from '../core/v3.ts';
import { Rng } from '../core/rng.ts';
import { GRAVITY, DT } from '../core/constants.ts';
import { abs, clamp, cos, exp, max, min, pow, sin, sqrt, PI } from '../core/smath.ts';
import {
  Court, SURF_GLASS, SURF_MESH, SURF_OPEN, SURF_FLOOR, SURF_NET,
  WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, type ZoneHit,
} from '../court/court.ts';
import type { NetCloth } from '../court/netCloth.ts';

export interface BallSpec {
  mass: number;
  radius: number;
  dragCoefficient: number;
  inertiaFactor: number;
  /** k in dw/dt = -k w v (per metre flown, at sea-level air). */
  spinDecayPerM: number;
  restitutionScale: number;
  wear: BallWearSpec;
}

/** How the match ball wears (data/ball.json). */
export interface BallWearSpec {
  dragFluff: number;
  fluffImpacts: number;
  pressureLoss: number;
  pressureImpacts: number;
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

/** How the net body gives (data/surfaces.json, netGive). */
export interface NetGiveSpec {
  omega: number;
  zeta: number;
  grab: number;
  minGive: number;
  spread: number;
}

export interface SurfaceTable {
  glass: SurfaceSpec;
  mesh: SurfaceSpec;
  seam: SurfaceSpec;
  /** The net tape (cord): a rigid bounce. The net body gives (netGive). */
  net: SurfaceSpec;
  post: SurfaceSpec;
  netGive: NetGiveSpec;
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
export const HIT_POST = 6;

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
  /** Spin decay per metre of air flown through (spinDecayPerM scaled by air density). */
  readonly kSpin: number;
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
    this.kSpin = (spec.spinDecayPerM * this.rho) / SEA_LEVEL_AIR;
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
  /**
   * Caught in the net: the mesh is pushed back where the ball is and acts on it as a damped spring along z.
   * While caught the ball's centre can be past the net line (the net bulges), but it is still on its own side.
   */
  inNet = false;
  /** The side the ball came into the net from (+1 / -1), and the net's frequency (rad/s) and damping there. */
  netSide = 1;
  /**
   * z for the rules: the ball's z, except near the net, where it says which side of the netting the ball is
   * really on (netSide; a pocket in the cloth carries the ball past the line without it crossing).
   */
  sideZ = 0;
  netW = 0;
  netZeta = 0;

  /** Only the match ball wears; predictions and solver ghosts copy its state. */
  wears = false;
  /** Impacts so far, each weighted by (normal speed / 15 m/s)^2 (at most 3). */
  wear = 0;
  /** Drag and restitution against a new ball (the nap fluffs up, the pressure leaks). */
  dragScale = 1;
  eScale = 1;
  /** Normal speed of the impact being added by wearImpact() (a field: a double argument would be boxed). */
  wearV = 0;

  readonly events: ContactEvent[] = [];
  eventCount = 0;

  /**
   * The match's net as cloth (only the live match ball has one; predictions and solver ghosts keep the rigid
   * net with its closed-form catch). Near the net the ball and the cloth are solved together in substeps.
   */
  cloth: NetCloth | null = null;
  /** True when the last step was solved with the cloth. */
  coupled = false;
  /** Seconds since the ball last touched the netting or the cable. */
  private sinceTouch = 1;
  /** Step length and event-time offset for fly() / roll() (fields: doubles passed as arguments get boxed). */
  private flyDt = 0;
  private flyAt = 0;
  private flyEnd = 0;
  private stepDt = DT;
  private exitAt = 0;
  private intDt = 0;
  private resolveAt = 0;

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
    this.inNet = b.inNet;
    this.netSide = b.netSide;
    this.sideZ = b.sideZ;
    this.netW = b.netW;
    this.netZeta = b.netZeta;
    this.copyWear(b);
    return this;
  }

  copyWear(b: Ball): void {
    this.wear = b.wear;
    this.dragScale = b.dragScale;
    this.eScale = b.eScale;
  }

  /** A new ball (fresh from the tube). */
  newBall(): void {
    this.wear = 0;
    this.dragScale = 1;
    this.eScale = 1;
  }

  /** Wear from an impact at normal speed wearV (racket, floor or wall); only the match ball wears. */
  wearImpact(world: BallWorld): void {
    if (!this.wears) return;
    const q = this.wearV / 15;
    this.wear += q * q < 3 ? q * q : 3;
    const w = world.spec.wear;
    this.dragScale = 1 + w.dragFluff * (1 - exp(-this.wear / w.fluffImpacts));
    this.eScale = 1 - w.pressureLoss * (1 - exp(-this.wear / w.pressureImpacts));
  }

  /** Let go of any net catch (the ball is being put somewhere or struck). */
  clearNet(): void {
    this.inNet = false;
    this.sinceTouch = 1;
  }

  /**
   * Advance by dt seconds. Contacts found during the step are written to `events` (eventCount).
   * `rng` adds the random part of mesh/seam/turf bounces; pass null for a noise-free prediction.
   * `flightOnly` ignores walls and the net (used when solving shot trajectories).
   */
  step(world: BallWorld, dt: number, rng: Rng | null, flightOnly = false): void {
    this.eventCount = 0;
    // Away from the net its side is just the sign of z (near it, stepCoupled tracks it: only over the cable or
    // round the posts can it change).
    if (!this.coupled && !this.inNet && this.pos.z !== 0) this.netSide = this.pos.z > 0 ? 1 : -1;
    this.coupled = false;
    const cl = this.cloth;
    if (cl !== null && !flightOnly && this.nearNet(world, cl)) {
      this.stepDt = dt;
      this.stepCoupled(world, rng, cl);
      return;
    }
    this.flyDt = dt;
    this.flyAt = 0;
    if (this.rolling) this.roll(world);
    else {
      this.fly(world, rng, flightOnly);
      if (!flightOnly) {
        this.exitAt = this.flyEnd;
        this.checkExit(world);
      }
    }
    this.sideZ = this.pos.z;
  }

  /** Free flight for flyDt from event time flyAt, with every contact except a cloth net's. */
  private fly(world: BallWorld, rng: Rng | null, flightOnly: boolean): void {
    let remaining = this.flyDt;
    let elapsed = this.flyAt;
    for (let iter = 0; iter < MAX_CONTACTS_PER_STEP && remaining > 1e-9; iter++) {
      if (this.inNet && this.cloth === null) {
        this.span = remaining;
        this.at = elapsed;
        this.netStep(world, rng);
        elapsed += this.used;
        remaining -= this.used;
        continue;
      }
      this.intDt = remaining;
      this.integrate(world, p1, v1, w1);
      if (!this.findContact(world, p1, flightOnly)) {
        this.pos.copy(p1);
        this.vel.copy(v1);
        this.spin.copy(w1);
        break;
      }
      // Move to the contact point (linear within the step), resolve the bounce, continue.
      const f = this.best;
      this.pos.lerpOf(this.pos, p1, f);
      this.vel.lerpOf(this.vel, v1, f);
      this.spin.lerpOf(this.spin, w1, f);
      elapsed += f * remaining;
      this.resolveAt = elapsed;
      this.resolve(world, rng);
      remaining *= 1 - f;
    }
    this.flyEnd = elapsed;
  }

  /** Close enough to the net (or still in it) that the cloth must be solved with the ball this step. */
  private nearNet(world: BallWorld, cl: NetCloth): boolean {
    if (this.inNet || this.sinceTouch < 0.1) return true;
    if (this.outside) return false;
    const p = this.pos;
    const v = this.vel;
    const c = world.court;
    const r = world.spec.radius;
    if ((p.x < 0 ? -p.x : p.x) > c.halfW + 0.15) return false;
    if (p.y - r > c.def.net.heightPost + 0.06 - min(0, v.y) * this.stepDt) return false;
    const reach = (cl.awake ? 0.9 : 0.04) + r + (v.z < 0 ? -v.z : v.z) * DT + 0.02;
    return (p.z < 0 ? -p.z : p.z) < reach;
  }

  /**
   * One step solved together with the cloth net, in substeps short enough that the ball moves at most a few
   * centimetres in each: the ball flies (floor, walls and posts as usual), then the cloth and the ball's contact
   * with it are solved. Contacts with the netting or the cable are reported once per touch.
   */
  private stepCoupled(world: BallWorld, rng: Rng | null, cl: NetCloth): void {
    this.coupled = true;
    const r = world.spec.radius;
    const c = world.court;
    cl.bw = 1 / world.spec.mass;
    cl.br = r;
    cl.balpha = world.spec.inertiaFactor;
    cl.bvx = this.vel.x;
    cl.bvy = this.vel.y;
    cl.bvz = this.vel.z;
    const S = cl.substepsFor();
    const h = this.stepDt / S;
    cl.h = h;
    const grab = exp(-cl.spec.grab * h);
    const p = this.pos;
    for (let k = 0; k < S; k++) {
      const e0 = this.eventCount;
      this.flyDt = h;
      this.flyAt = k * h;
      if (this.rolling) this.roll(world);
      else this.fly(world, rng, false);
      // Which side of the net the ball is on can only change over the cable or beyond the posts.
      cl.qx = p.x;
      cl.cableAt();
      const ax = p.x < 0 ? -p.x : p.x;
      if (ax >= c.halfW || p.y - r > cl.cy + cl.spec.cableRadius) {
        const zc = ax < c.halfW ? cl.cz : 0;
        if (p.z !== zc) this.netSide = p.z > zc ? 1 : -1;
      }
      cl.side = this.netSide;
      cl.bx = p.x;
      cl.by = p.y;
      cl.bz = p.z;
      cl.bvx = this.vel.x;
      cl.bvy = this.vel.y;
      cl.bvz = this.vel.z;
      cl.bsx = this.spin.x;
      cl.bsy = this.spin.y;
      cl.bsz = this.spin.z;
      cl.coupledSubstep();
      p.set(cl.bx, cl.by, cl.bz);
      this.vel.set(cl.bvx, cl.bvy, cl.bvz);
      this.spin.set(cl.bsx, cl.bsy, cl.bsz);
      const touched = cl.touchBody || cl.touchCable;
      if (touched) {
        if (this.sinceTouch > 0.08) {
          this.hitKind = cl.touchBody ? HIT_NET : HIT_NETCORD;
          this.hitSurface = SURF_NET;
          this.hitWall = -1;
          this.recT = this.flyAt + h;
          this.recVn = -cl.touchSpeed;
          this.recZ = p.z;
          this.record();
        }
        this.sinceTouch = 0;
      } else this.sinceTouch += h;
      if (cl.touchBody) {
        // In the netting: it grips the ball, and the ball is on its side of the net whatever its z says.
        this.spin.scale(grab);
        if (!this.inNet) {
          this.inNet = true;
          this.netW = world.surfaces.netGive.omega; // for predictions, which use the rigid net
          this.netZeta = world.surfaces.netGive.zeta;
        }
      }
      // A bounce on the floor in or under a pocket of the net is on the side the ball is on.
      for (let i = e0; i < this.eventCount; i++) {
        const e = this.events[i]!;
        if (e.kind === HIT_FLOOR && this.netSide * e.z < 1e-3) e.z = this.netSide * 1e-3;
      }
      if (this.inNet) {
        if (this.sinceTouch > 0.06) {
          // Clear of the netting for a moment and back on its own side of it (or up over the cable): out.
          cl.qx = p.x;
          cl.cableAt();
          if (p.y - r > cl.cy || (p.x < 0 ? -p.x : p.x) >= c.halfW) this.inNet = false;
          else if (this.netSide * (p.z - cl.surfaceZ()) > r + 0.02) this.inNet = false;
        }
      }
    }
    cl.endCoupledTick();
    this.exitAt = this.stepDt;
    this.checkExit(world);
    const az = abs(p.z);
    this.sideZ = this.netSide * (az > 1e-3 ? az : 1e-3);
  }

  // ---- flight -------------------------------------------------------------------------------

  private accel(world: BallWorld, v: V3, w: V3, out: V3): void {
    const env = world.env;
    const rx = v.x - env.windX;
    const ry = v.y;
    const rz = v.z - env.windZ;
    const s = sqrt(rx * rx + ry * ry + rz * rz);
    const kd = world.kDrag * this.dragScale * s;
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

  /** Midpoint (RK2) integration of position/velocity; spin decays with the air flown through (dw/dt = -k w v). */
  private integrate(world: BallWorld, pOut: V3, vOut: V3, wOut: V3): void {
    const dt = this.intDt;
    this.accel(world, this.vel, this.spin, a0);
    vMid.copy(this.vel).addScaled(a0, dt * 0.5);
    this.accel(world, vMid, this.spin, a1);
    vOut.copy(this.vel).addScaled(a1, dt);
    pOut.copy(this.pos).addScaled(vMid, dt);
    const env = world.env;
    const rx = vMid.x - env.windX;
    const rz = vMid.z - env.windZ;
    const s = sqrt(rx * rx + vMid.y * vMid.y + rz * rz);
    wOut.copy(this.spin).scale(exp(-world.kSpin * s * dt));
  }

  private roll(world: BallWorld): void {
    const dt = this.flyDt;
    const v = this.vel;
    const s = sqrt(v.x * v.x + v.z * v.z);
    const decel = 0.8 * dt;
    const k = s > decel ? (s - decel) / s : 0;
    v.set(v.x * k, 0, v.z * k);
    this.pos.addScaled(v, dt);
    this.pos.y = world.spec.radius;
    // A rolling ball stops against the net and rolls back off it a little.
    const r0 = world.spec.radius;
    if (this.cloth === null && !this.outside && abs(this.pos.x) < world.court.halfW && abs(this.pos.z) < r0 && this.pos.z * v.z < 0) {
      const side = this.pos.z - v.z * dt >= 0 ? 1 : -1;
      this.pos.z = side * r0;
      v.z = -0.2 * v.z;
    }
    // Rolling without slipping.
    const r = world.spec.radius;
    this.spin.set(v.z / r, 0, -v.x / r);
    this.exitAt = 0;
    this.checkExit(world);
  }

  // ---- collisions ---------------------------------------------------------------------------

  private hitKind = 0;
  private hitWall = -1;
  private hitSurface = 0;

  /** Candidate contact fraction being tested, and the best so far (fields, not arguments: passing doubles
   *  through non-inlined calls boxes them, which would allocate every tick). */
  private cand = 0;
  private best = 2;

  /** Is there a contact along pos -> p? The earliest one's fraction (0..1) is left in `best`, with what was hit. */
  /** Ball radius for the contact helpers (read through a field: a double argument would be boxed). */
  private radius = 0.0328;

  private findContact(world: BallWorld, p: V3, flightOnly: boolean): boolean {
    const r = world.spec.radius;
    this.radius = r;
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
      // Net body and tape (a cloth net is solved apart), and the posts.
      if (this.cloth === null) this.tryNet(c, p);
      this.tryPost(c, p);
    }
    return this.best <= 1;
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

  private tryNet(c: Court, p: V3): void {
    const r = this.radius;
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

  /** Net posts: vertical steel tubes at the ends of the net, centred on the side wall lines. */
  private tryPost(c: Court, p: V3): void {
    const q = this.pos;
    const net = c.def.net;
    const R = net.postSize * 0.5 + this.radius;
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    const A = dx * dx + dz * dz;
    if (A < 1e-12) return;
    for (let k = -1; k <= 1; k += 2) {
      const fx = q.x - k * c.halfW;
      const fz = q.z;
      const C = fx * fx + fz * fz - R * R;
      if (C <= 0) continue;
      const B = 2 * (fx * dx + fz * dz);
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const f = (-B - sqrt(disc)) / (2 * A);
      if (f < 0 || f >= this.best) continue;
      if (q.y + (p.y - q.y) * f > net.postHeight + this.radius) continue;
      this.best = f;
      this.hitKind = HIT_POST;
      this.hitSurface = SURF_NET;
      this.hitWall = -1;
      n.set((fx + dx * f) / R, 0, (fz + dz * f) / R);
    }
  }

  /** Bounce off what findContact hit, at time resolveAt in the step. */
  private resolve(world: BallWorld, rng: Rng | null): void {
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
      case HIT_NETCORD:
        surf = world.surfaces.net;
        break;
      case HIT_POST:
        surf = world.surfaces.post;
        break;
      case HIT_NET: {
        // Into the net body: caught by the mesh, no bounce here (netStep takes over).
        this.recVn = this.vel.dot(n);
        this.enterNet(world, rng);
        this.recT = this.resolveAt;
        this.recZ = this.pos.z;
        this.record();
        return;
      }
    }
    this.recVn = this.vel.dot(n);
    this.bounce(world, surf, rng, this.hitKind === HIT_NETCORD);
    // Keep the ball just off the surface.
    this.pos.addScaled(n, 1e-6);
    this.recT = this.resolveAt;
    this.recZ = this.pos.z;
    this.record();
    if (this.hitKind === HIT_FLOOR && this.vel.y < 0.25) {
      this.rolling = true;
      this.vel.y = 0;
      this.pos.y = world.spec.radius;
    }
  }

  // record()'s time, normal speed before the contact and z (fields: doubles passed as arguments get boxed).
  private recT = 0;
  private recVn = 0;
  private recZ = 0;

  /**
   * Write the contact just resolved to `events`: at recT, normal speed recVn before it, at z recZ (given apart:
   * a bounce inside the net is on its own side).
   */
  private record(): void {
    if (this.eventCount >= MAX_EVENTS) return;
    const e = this.events[this.eventCount++]!;
    e.kind = this.hitKind;
    e.surface = this.hitSurface;
    e.wall = this.hitWall;
    e.t = this.recT;
    e.x = this.pos.x;
    e.y = this.pos.y;
    e.z = this.recZ;
    e.speed = -this.recVn;
  }

  // ---- the net body gives -------------------------------------------------------------------
  //
  // Along z the mesh is a damped spring whose stiffness depends on where it was hit (soft in the middle, stiff
  // near the posts, the tape and the floor), so the ball's penetration d = r - side * z follows
  // d'' = -w^2 d - 2 zeta w d', solved exactly per tick. Along the net the mesh grabs the ball: its sliding
  // velocity and spin die away at the rate `grab`, under gravity. The catch ends when the mesh has pushed the
  // ball back out (d back to 0), or it rises over the top; a bounce on the floor inside the net stays inside.
  // Exact event times are found by bisection on the closed form. All values pass through fields: doubles
  // passed to non-inlined methods would be boxed, and this runs every tick a ball is in the net.

  /** Time left in the step (in), time used (out), time into the step at the start (for events). */
  private span = 0;
  private used = 0;
  private at = 0;
  private tau = 0;
  // Catch state at the start of netStep, and the closed form at tau.
  private d0 = 0;
  private dv0 = 0;
  private x0 = 0;
  private y0 = 0;
  private vx0 = 0;
  private vy0 = 0;
  private rd = 0;
  private rdv = 0;
  private rx = 0;
  private ry = 0;
  private rvx = 0;
  private rvy = 0;

  private enterNet(world: BallWorld, rng: Rng | null): void {
    const c = world.court;
    const g = world.surfaces.netGive;
    const x = this.pos.x;
    const u = clamp(this.pos.y / c.netHeightAt(x), 0, 1);
    const fx = max(0, 1 - (x * x) / (c.halfW * c.halfW));
    const give = max(g.minGive, fx * 4 * u * (1 - u));
    let w = g.omega / sqrt(give);
    let z = g.zeta;
    if (rng && g.spread > 0) {
      w *= 1 + g.spread * clamp(rng.normal(), -2, 2);
      z *= 1 + g.spread * clamp(rng.normal(), -2, 2);
    }
    this.netW = w;
    this.netZeta = clamp(z, 0.1, 0.95);
    this.netSide = n.z > 0 ? 1 : -1;
    this.inNet = true;
  }

  /** The catch `tau` seconds after the start of netStep (reads d0.. and the spring, writes rd..). */
  private netAt(world: BallWorld): void {
    const t = this.tau;
    const w = this.netW;
    const z = this.netZeta;
    const wd = w * sqrt(1 - z * z);
    const e = exp(-z * w * t);
    const cs = cos(wd * t);
    const sn = sin(wd * t);
    const A = this.d0;
    const B = (this.dv0 + z * w * A) / wd;
    this.rd = e * (A * cs + B * sn);
    this.rdv = e * ((B * wd - z * w * A) * cs - (A * wd + z * w * B) * sn);
    const b = world.surfaces.netGive.grab;
    const eb = exp(-b * t);
    const gb = GRAVITY / b;
    this.rvx = this.vx0 * eb;
    this.rx = this.x0 + (this.vx0 * (1 - eb)) / b;
    const k = this.vy0 + gb;
    this.rvy = k * eb - gb;
    this.ry = this.y0 + (k * (1 - eb)) / b - gb * t;
  }

  /** What ends or interrupts the catch at the current closed form: 0 none, 1 out, 2 floor, 3 over the top. */
  private netEvent(world: BallWorld): number {
    if (this.rd <= 0 && this.rdv < 0) return 1;
    if (this.ry < this.radius) return 2;
    if (this.ry > world.court.netHeightAt(this.rx) - NET_TAPE_RADIUS && this.rvy > 0) return 3;
    return 0;
  }

  /** Advance inside the net for up to `span` seconds; sets `used`. */
  private netStep(world: BallWorld, rng: Rng | null): void {
    const r = world.spec.radius;
    this.radius = r;
    const s = this.netSide;
    this.d0 = r - s * this.pos.z;
    this.dv0 = -s * this.vel.z;
    this.x0 = this.pos.x;
    this.y0 = this.pos.y;
    this.vx0 = this.vel.x;
    this.vy0 = this.vel.y;
    this.tau = this.span;
    this.netAt(world);
    let ev = this.netEvent(world);
    if (ev !== 0) {
      // The first moment something happens, to well under a microsecond.
      let lo = 0;
      let hi = this.span;
      for (let k = 0; k < 16; k++) {
        this.tau = (lo + hi) * 0.5;
        this.netAt(world);
        if (this.netEvent(world) !== 0) hi = this.tau;
        else lo = this.tau;
      }
      this.tau = hi;
      this.netAt(world);
      ev = this.netEvent(world);
    }
    const t = this.tau;
    this.used = t;
    this.pos.set(this.rx, this.ry, s * (r - this.rd));
    this.vel.set(this.rvx, this.rvy, -s * this.rdv);
    this.spin.scale(exp(-world.surfaces.netGive.grab * t));
    if (ev === 1) {
      // Pushed back out of the net.
      this.pos.z = s * r;
      this.inNet = false;
    } else if (ev === 2) {
      // On the floor inside the net: a bounce, still caught. For the rules it is on the side it came from.
      this.pos.y = r;
      n.set(0, 1, 0);
      this.hitKind = HIT_FLOOR;
      this.hitSurface = SURF_FLOOR;
      this.hitWall = -1;
      this.recVn = this.vel.y;
      this.bounce(world, world.floor, rng, false);
      this.recT = this.at + t;
      this.recZ = s * max(s * this.pos.z, 1e-3);
      this.record();
      if (this.vel.y < 0.25) {
        // Dead in the net: it drops out and rolls off it.
        this.inNet = false;
        this.rolling = true;
        this.pos.set(this.pos.x, r, s * r);
        this.vel.set(this.vel.x * 0.3, 0, s * 0.15);
      }
    } else if (ev === 3) {
      // Up over the top of the net.
      this.inNet = false;
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
    let e = clamp(s.e0 - s.eSlope * -vn, s.eMin, s.e0) * spec.restitutionScale * this.eScale;
    this.wearV = -vn;
    this.wearImpact(world);
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

  /** Mark the ball outside the court once it leaves it (event at time exitAt in the step). */
  private checkExit(world: BallWorld): void {
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
        e.t = this.exitAt;
        e.x = p.x; e.y = p.y; e.z = p.z;
        e.speed = 0;
      }
    }
  }
}

export { SURF_GLASS, SURF_MESH, SURF_FLOOR, SURF_NET, SURF_OPEN };
