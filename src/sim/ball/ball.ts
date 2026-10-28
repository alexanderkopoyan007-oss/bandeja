// Padel ball physics: flight (gravity, drag, Magnus, spin decay, wind), swept collisions with the
// court (floor, glass, mesh, openings, net posts and net cord), spin-aware bounces, and a net body that gives
// (the ball is caught by a tensioned mesh, solved in closed form while it is in it).
import { V3 } from '../core/v3.ts';
import { Rng } from '../core/rng.ts';
import { GRAVITY, DT } from '../core/constants.ts';
import { abs, clamp, cos, exp, expF, FIO, max, min, pow, sin, sqrt, PI } from '../core/smath.ts';
import {
  Court, SURF_GLASS, SURF_MESH, SURF_OPEN, SURF_FLOOR, SURF_NET, EDGE_X, EDGE_Y, EDGE_STRIDE,
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
  /** Friction and restitution gained as the nap fluffs up (fractions, reached with the drag). */
  muGain: number;
  eGain: number;
}

export interface SurfaceSpec {
  e0: number;
  eSlope: number;
  eMin: number;
  mu: number;
  grip: number;
  jitterDeg: number;
  speedJitter: number;
  /** Random sideways turn of the rebound about the surface normal (sd, degrees). */
  turnDeg: number;
}

/** Two surfaces met at once: floor and wall, or a corner (data/surfaces.json, junction). */
export interface JunctionSpec {
  contactTime: number;
  gap: number;
  loss: number;
  nickGap: number;
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
  /** A flush join between two glass panels. */
  glassJoin: SurfaceSpec;
  /** The net tape (cord): a rigid bounce. The net body gives (netGive). */
  net: SurfaceSpec;
  post: SurfaceSpec;
  netGive: NetGiveSpec;
  seamWidth: number;
  joinWidth: number;
  junction: JunctionSpec;
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
/** A free edge (a wall top, a door frame): internal, reported as HIT_WALL. */
const HIT_EDGE = 7;

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
const zone: ZoneHit = { kind: 0, seamDist: 0, joinDist: 0 };
// Junctions: the second surface's normal, the first's, and the state before / after one order of the two bounces.
const nB = new V3();
const nA = new V3();
const sv = new V3();
const sw = new V3();
const rv = new V3();
const rw = new V3();
/** A junction's velocity after its first surface alone: the flight to the second. */
const va = new V3();
// The surface normal before bounce() tilts it.
const n0 = new V3();

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
  /** Drag, restitution and friction against a new ball (the nap fluffs up). */
  dragScale = 1;
  eScale = 1;
  muScale = 1;
  /** Normal speed of the impact being added by wearImpact() (a field: a double argument would be boxed). */
  wearV = 0;
  /** A bounce has counted wear that applyWear() hasn't turned into drag/restitution/friction yet. */
  wearDirty = false;

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
  /** Which side of the cable's line the centre was on last substep (stepCoupled; it starts on its netSide). */
  private relSide = 1;
  /** Step length and event-time offset for fly() / roll() (fields: doubles passed as arguments get boxed). */
  private flyDt = 0;
  private flyAt = 0;
  private flyEnd = 0;
  private stepDt = DT;
  private exitAt = 0;
  private intDt = 0;
  private resolveAt = 0;
  /**
   * A junction flies the ball on to its second surface (see junction()); when that flight runs past the end of the
   * step, the ball is this far ahead of the clock and the next step starts this far in (s, at most a few ms).
   */
  ahead = 0;

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
    this.ahead = b.ahead;
    this.copyWear(b);
    return this;
  }

  copyWear(b: Ball): void {
    this.wear = b.wear;
    this.dragScale = b.dragScale;
    this.eScale = b.eScale;
    this.muScale = b.muScale;
  }

  /** A new ball (fresh from the tube). */
  newBall(): void {
    this.wear = 0;
    this.dragScale = 1;
    this.eScale = 1;
    this.muScale = 1;
  }

  /** Wear from an impact at normal speed wearV (racket, floor or wall); only the match ball wears. */
  wearImpact(world: BallWorld): void {
    if (!this.wears) return;
    const q = this.wearV / 15;
    this.wear += q * q < 3 ? q * q : 3;
    this.applyWear(world);
  }

  /**
   * Bring drag, restitution and friction up to the wear counted so far. Bounces only count (the exp() here,
   * inlined into every Ball.step tree, pushed V8 over its inlining budget in about half of all runs and the
   * vector calls left out boxed their doubles); MatchSim.stepBall applies it after each step.
   */
  applyWear(world: BallWorld): void {
    this.wearDirty = false;
    const w = world.spec.wear;
    const f = 1 - exp(-this.wear / w.fluffImpacts);
    this.dragScale = 1 + w.dragFluff * f;
    this.eScale = 1 + w.eGain * f;
    this.muScale = 1 + w.muGain * f;
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
      // A junction's flight to its second surface has already covered this much of the step.
      if (this.ahead > 0) {
        const u = this.ahead < remaining ? this.ahead : remaining;
        this.ahead -= u;
        remaining -= u;
        elapsed += u;
        if (remaining <= 1e-9) break;
      }
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
      // Dead on the floor: roll() takes over next step (the rest of this one, under a tick, is not rolled).
      if (this.rolling) break;
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
    const reach = (cl.awake ? 0.9 : 0.04 + cl.bulge) + r + (v.z < 0 ? -v.z : v.z) * DT + 0.02;
    return (p.z < 0 ? -p.z : p.z) < reach;
  }

  /**
   * One step solved together with the cloth net, in substeps short enough that the ball moves at most a few
   * centimetres in each: the ball flies (floor, walls and posts as usual), then the cloth and the ball's contact
   * with it are solved. Contacts with the netting or the cable are reported once per touch.
   */
  private stepCoupled(world: BallWorld, rng: Rng | null, cl: NetCloth): void {
    this.coupled = true;
    this.relSide = this.netSide;
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
    FIO[0] = -cl.spec.grab * h;
    expF();
    const grab = FIO[0]!;
    const p = this.pos;
    for (let k = 0; k < S; k++) {
      const e0 = this.eventCount;
      this.flyDt = h;
      this.flyAt = k * h;
      if (this.rolling) this.roll(world);
      else this.fly(world, rng, false);
      // Which side of the net the ball is on can only change over the cable or beyond the posts. Over the cable
      // means the centre passes the cable's plane above the cable's centre line: it can't go through the cable,
      // and a ball rolling over the tape is touching it, so its bottom never clears the cable's top (QA army: a
      // net cord that dropped past the net stayed on the hitter's side for a metre).
      // It changes on crossing that line, not on being past it, and never while the netting grips it: smashes
      // driven into the top of the net climbed out of the pocket with the centre past the cable and above it, and
      // were put on the far side, still held or just let go (QA army).
      cl.qx = p.x;
      cl.cableAt();
      const ax = p.x < 0 ? -p.x : p.x;
      const zc = ax < c.halfW ? cl.cz : 0;
      const rel = p.z > zc ? 1 : p.z < zc ? -1 : 0;
      if (rel !== 0 && rel !== this.relSide) {
        if ((ax >= c.halfW || p.y > cl.cy) && !this.inNet) this.netSide = rel;
        this.relSide = rel;
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
    // (expF, not exp: no double crosses a call here, whatever V8 inlines.)
    FIO[0] = -world.kSpin * s * dt;
    expF();
    const k = FIO[0]!;
    wOut.x = this.spin.x * k;
    wOut.y = this.spin.y * k;
    wOut.z = this.spin.z * k;
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
    // Walls: a rolling ball comes back off glass or mesh at its foot (an opening lets it through).
    if (!this.outside) {
      const c = world.court;
      const xl = c.halfW - r0;
      const zl = c.halfL - r0;
      const p = this.pos;
      if (abs(p.x) > xl && p.x * v.x > 0) {
        c.qu = p.z;
        c.qy = r0;
        c.sideZoneAt(zone);
        if (zone.kind !== SURF_OPEN) {
          p.x = p.x > 0 ? xl : -xl;
          this.rollWall(world, p.x > 0 ? WALL_SIDE_RIGHT : WALL_SIDE_LEFT);
          v.x = -v.x * this.rollE;
        }
      }
      if (abs(p.z) > zl && p.z * v.z > 0) {
        c.qu = p.x;
        c.qy = r0;
        c.backZoneAt(zone);
        if (zone.kind !== SURF_OPEN) {
          p.z = p.z > 0 ? zl : -zl;
          this.rollWall(world, p.z > 0 ? WALL_BACK_NEAR : WALL_BACK_FAR);
          v.z = -v.z * this.rollE;
        }
      }
    }
    // Rolling without slipping.
    const r = world.spec.radius;
    this.spin.set(v.z / r, 0, -v.x / r);
    this.exitAt = 0;
    this.checkExit(world);
  }

  /** Restitution for rollWall's bounce (a field: see `best`). */
  private rollE = 0;

  /** A rolling ball meets a wall (zone: what is there): record it and set rollE for the normal speed. */
  private rollWall(world: BallWorld, wall: number): void {
    const s = zone.kind === SURF_GLASS ? world.surfaces.glass : world.surfaces.mesh;
    wallNormal(wall, n);
    const vn = this.vel.dot(n);
    this.rollE = clamp(s.e0 - s.eSlope * -vn, s.eMin, s.e0);
    this.hitKind = HIT_WALL;
    this.hitWall = wall;
    this.hitSurface = zone.kind;
    this.recVn = vn;
    this.recT = this.flyAt + this.flyDt;
    this.recZ = this.pos.z;
    this.record();
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

    // Floor (everywhere, inside or outside the court); a ball already below it and still going down (pushed
    // there by something else) bounces at once.
    if (p.y < r && (q.y >= r - 1e-9 || this.vel.y < 0)) {
      const f = q.y >= r ? (q.y - r) / (q.y - p.y) : 0;
      if (f < this.best) { this.best = f; this.hitKind = HIT_FLOOR; this.hitSurface = SURF_FLOOR; this.hitWall = -1; }
    }

    if (!this.outside && !flightOnly) {
      // Side walls. As with the floor, a ball already past a wall's contact plane (but still overlapping the
      // glass) and going out bounces at once where the wall is solid: crossing the plane is the only other test.
      const xl = c.halfW - r;
      const v = this.vel;
      if (p.x > xl && (q.x <= xl || (q.x < c.halfW && v.x > 0))) { this.cand = q.x <= xl ? (xl - q.x) / (p.x - q.x) : 0; this.tryWall(c, p, WALL_SIDE_RIGHT); }
      if (p.x < -xl && (q.x >= -xl || (q.x > -c.halfW && v.x < 0))) { this.cand = q.x >= -xl ? (-xl - q.x) / (p.x - q.x) : 0; this.tryWall(c, p, WALL_SIDE_LEFT); }
      // Back walls.
      const zl = c.halfL - r;
      if (p.z > zl && (q.z <= zl || (q.z < c.halfL && v.z > 0))) { this.cand = q.z <= zl ? (zl - q.z) / (p.z - q.z) : 0; this.tryWall(c, p, WALL_BACK_NEAR); }
      if (p.z < -zl && (q.z >= -zl || (q.z > -c.halfL && v.z < 0))) { this.cand = q.z >= -zl ? (-zl - q.z) / (p.z - q.z) : 0; this.tryWall(c, p, WALL_BACK_FAR); }
      // Net body and tape (a cloth net is solved apart), and the posts.
      if (this.cloth === null) this.tryNet(c, p);
      this.tryPost(c, p);
      // Wall tops and door frames, near the walls only.
      const m = 0.5;
      if (abs(p.x) > c.halfW - m || abs(p.z) > c.halfL - m || abs(q.x) > c.halfW - m || abs(q.z) > c.halfL - m) this.tryEdges(c, p);
    }
    return this.best <= 1;
  }

  /**
   * Free edges (Court.edges): the ball's centre path against each edge line, a cylinder of the ball's radius
   * (quadratic in f, as the net tape). A wall's face test only covers balls whose centre meets it below its top;
   * one passing just over the top, or through a door within a radius of its frame, clips the edge.
   */
  private tryEdges(c: Court, p: V3): void {
    const q = this.pos;
    const r = this.radius;
    const E = c.edges;
    for (let i = 0; i < E.length; i += EDGE_STRIDE) {
      const axis = E[i]!;
      const a = E[i + 1]!;
      const b = E[i + 2]!;
      // (s, t): the two coordinates across the edge; `al` along it.
      let s0 = 0, t0 = 0, ds = 0, dt = 0, al0 = 0, dal = 0;
      if (axis === EDGE_X) { s0 = q.y - a; t0 = q.z - b; ds = p.y - q.y; dt = p.z - q.z; al0 = q.x; dal = p.x - q.x; }
      else if (axis === EDGE_Y) { s0 = q.x - a; t0 = q.z - b; ds = p.x - q.x; dt = p.z - q.z; al0 = q.y; dal = p.y - q.y; }
      else { s0 = q.x - a; t0 = q.y - b; ds = p.x - q.x; dt = p.y - q.y; al0 = q.z; dal = p.z - q.z; }
      const C = s0 * s0 + t0 * t0 - r * r;
      if (C <= 0) continue;
      const B = 2 * (s0 * ds + t0 * dt);
      if (B >= 0) continue;
      const A = ds * ds + dt * dt;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const f = (-B - sqrt(disc)) / (2 * A);
      if (f < 0 || f >= this.best) continue;
      const al = al0 + dal * f;
      if (al < E[i + 3]! || al > E[i + 4]!) continue;
      this.best = f;
      this.hitKind = HIT_EDGE;
      this.hitSurface = E[i + 5]!;
      this.hitWall = E[i + 6]!;
      const ss = s0 + ds * f;
      const tt = t0 + dt * f;
      const l = sqrt(ss * ss + tt * tt);
      if (axis === EDGE_X) n.set(0, ss / l, tt / l);
      else if (axis === EDGE_Y) n.set(ss / l, 0, tt / l);
      else n.set(ss / l, tt / l, 0);
    }
  }

  private tryWall(c: Court, p: V3, wall: number): void {
    const f = this.cand;
    if (f >= this.best) return;
    const q = this.pos;
    const x = q.x + (p.x - q.x) * f;
    const y = q.y + (p.y - q.y) * f;
    const z = q.z + (p.z - q.z) * f;
    c.qy = y;
    if (wall === WALL_BACK_NEAR || wall === WALL_BACK_FAR) {
      c.qu = x;
      c.backZoneAt(zone);
    } else {
      c.qu = z;
      c.sideZoneAt(zone);
    }
    if (zone.kind === SURF_OPEN) return;
    this.hitKind = HIT_WALL;
    this.hitWall = wall;
    this.hitSurface = zone.kind;
    this.hitSeam = zone.seamDist;
    this.hitJoin = zone.joinDist;
    this.best = f;
  }

  private hitSeam = 0.5;
  private hitJoin = 0.5;

  private tryNet(c: Court, p: V3): void {
    const r = this.radius;
    const q = this.pos;
    // Net body: centre crosses z = +-r while below the tape.
    for (let s = -1; s <= 1; s += 2) {
      const plane = s * r; // approaching from the side where sign(z) = s
      if ((s > 0 && q.z >= plane && p.z < plane) || (s < 0 && q.z <= plane && p.z > plane)) {
        const f = (q.z - plane) / (q.z - p.z);
        // A ball pushed out onto the plane and curved back by its spin is not a new contact unless it is moving in
        // (caught again at f = 0 every substep, it hung in the air: review round 5).
        if (f < this.best && (f > 0 || s * this.vel.z < 0)) {
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
    let surf: SurfaceSpec = world.floor;
    let flat = true;
    switch (this.hitKind) {
      case HIT_FLOOR:
        n.set(0, 1, 0);
        if (this.pos.y < world.spec.radius) this.pos.y = world.spec.radius;
        break;
      case HIT_WALL:
        wallNormal(this.hitWall, n);
        surf = this.wallSurface(world);
        break;
      case HIT_EDGE:
        // n was set by tryEdges. A frameless glass top is polished glass; anything else is a frame.
        surf = this.hitSurface === SURF_GLASS ? world.surfaces.glass : world.surfaces.seam;
        this.hitKind = HIT_WALL;
        flat = false;
        break;
      case HIT_NETCORD:
        surf = world.surfaces.net;
        flat = false;
        break;
      case HIT_POST:
        surf = world.surfaces.post;
        flat = false;
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
    this.jW = 0;
    // A second surface within 20 cm (a contact time at 50 m/s) of a flat contact: is it a junction?
    if (flat) {
      const c = world.court;
      const q = this.pos;
      const m = 0.2 + world.spec.radius;
      const nearSide = abs(q.x) > c.halfW - m;
      const nearBack = abs(q.z) > c.halfL - m;
      const back = this.hitWall === WALL_BACK_NEAR || this.hitWall === WALL_BACK_FAR;
      const near = this.hitKind === HIT_FLOOR ? nearSide || nearBack : q.y < m || (back ? nearSide : nearBack);
      if (near) this.findJunction(world);
    }
    if (this.jW > 0) {
      this.junction(world, rng, surf);
    } else {
      this.bounce(world, surf, rng, this.hitKind === HIT_NETCORD);
      // Keep the ball just off the surface.
      this.pos.addScaled(n, 1e-6);
      this.recT = this.resolveAt;
      this.recZ = this.pos.z;
      this.record();
    }
    if ((this.hitKind === HIT_FLOOR || this.jKind === HIT_FLOOR) && this.vel.y < 0.25) {
      this.rolling = true;
      this.ahead = 0;
      this.vel.y = 0;
      this.pos.y = world.spec.radius;
      // Rolling without slipping from here: the friction impulse that stops the slip trades speed for spin
      // (v' = (v + alpha r w x n) / (1 + alpha)); setting w = v/r alone would add up to alpha of the energy.
      const r = world.spec.radius;
      const al = world.spec.inertiaFactor;
      const w = this.spin;
      this.vel.x = (this.vel.x - al * r * w.z) / (1 + al);
      this.vel.z = (this.vel.z + al * r * w.x) / (1 + al);
      w.set(this.vel.z / r, 0, -this.vel.x / r);
      // A ball that low bounces again at once (under 3 mm, within 50 ms): that is its next bounce for the rules.
      this.hitKind = HIT_FLOOR;
      this.hitSurface = SURF_FLOOR;
      this.hitWall = -1;
      this.recVn = 0;
      this.record();
    }
    this.jKind = 0;
  }

  /** The material under a wall contact (hitSurface, hitSeam, hitJoin): glass, a flush glass join, a frame or mesh. */
  private wallSurface(world: BallWorld): SurfaceSpec {
    const S = world.surfaces;
    const base = this.hitSurface === SURF_GLASS ? S.glass : S.mesh;
    // Frames (mesh posts, the mesh panel's frame on the glass top, door edges) are irregular; a flush join
    // between two glass panels is nearly a plain bounce (FIP wants joins flush and the rebound uniform).
    let surf = this.hitSeam < S.seamWidth && world.court.def.frame === 'posts' ? S.seam : base;
    if (this.hitSeam < S.seamWidth * 0.5 && this.hitSurface === SURF_GLASS) surf = S.seam;
    else if (surf === base && this.hitSurface === SURF_GLASS && this.hitJoin < S.joinWidth) surf = S.glassJoin;
    return surf;
  }

  // ---- junctions: floor and wall, or two walls, at once ---------------------------------------
  //
  // Contacts are instants, so a ball meeting the foot of the glass, or a corner, would bounce off one surface and
  // then the other, and which came first would flip on a millimetre: 12 m back or 8. A real ball is in contact
  // for about 4 ms and squashes about a centimetre, so when the second surface is reached within that, it is
  // squeezed by both: the two bounces are solved in both orders and averaged, weighted by how close to
  // simultaneous they are (jW: 1 together, 0 a contact time or a gap apart), with extra loss in the nick.

  /** The second surface: kind (0 none), wall, material, normal (nB) and closeness (jW). Fields: see `best`. */
  private jKind = 0;
  private jWall = -1;
  private jSurface = 0;
  private jSeam = 0.5;
  private jJoin = 0.5;
  private jW = 0;
  private jGap = 0;
  /** Time to the second surface at the approach speed before the first bounce (s). */
  private jT2 = 0;
  /** Candidate for considerJunction: gap to the surface's contact plane (m) and approach speed (m/s). */
  private cg = 0;
  private ca = 0;
  /** Extra restitution factor for bounce() (1 outside a junction). */
  private eJ = 1;

  private findJunction(world: BallWorld): void {
    const c = world.court;
    const r = world.spec.radius;
    const q = this.pos;
    const v = this.vel;
    this.jW = 0;
    this.jKind = 0;
    const kind = this.hitKind;
    const wall = this.hitWall;
    if (kind !== HIT_FLOOR && v.y < 0) {
      this.cg = q.y - r;
      this.ca = -v.y;
      this.considerJunction(world, HIT_FLOOR, -1);
    }
    if (this.outside) return;
    if (kind === HIT_FLOOR || wall === WALL_BACK_NEAR || wall === WALL_BACK_FAR) {
      if (v.x > 0) { this.cg = c.halfW - r - q.x; this.ca = v.x; this.considerJunction(world, HIT_WALL, WALL_SIDE_RIGHT); }
      else if (v.x < 0) { this.cg = q.x + c.halfW - r; this.ca = -v.x; this.considerJunction(world, HIT_WALL, WALL_SIDE_LEFT); }
    }
    if (kind === HIT_FLOOR || wall === WALL_SIDE_LEFT || wall === WALL_SIDE_RIGHT) {
      if (v.z > 0) { this.cg = c.halfL - r - q.z; this.ca = v.z; this.considerJunction(world, HIT_WALL, WALL_BACK_NEAR); }
      else if (v.z < 0) { this.cg = q.z + c.halfL - r; this.ca = -v.z; this.considerJunction(world, HIT_WALL, WALL_BACK_FAR); }
    }
  }

  private considerJunction(world: BallWorld, kind: number, wall: number): void {
    const J = world.surfaces.junction;
    const gap = this.cg > 0 ? this.cg : 0;
    const t2 = gap / this.ca;
    const wt = 1 - t2 / J.contactTime;
    const wg = 1 - gap / J.gap;
    const w = wt > wg ? wt : wg;
    if (w <= this.jW) return;
    if (kind === HIT_WALL) {
      // What is there where the ball meets that wall (an opening lets it through).
      // At most a contact time on, and never below the floor (a ball coming down meets the wall at its foot).
      const c = world.court;
      const q = this.pos;
      const v = this.vel;
      const t = t2 < J.contactTime ? t2 : J.contactTime;
      const y = q.y + v.y * t;
      const r = world.spec.radius;
      c.qy = y > r ? y : r;
      if (wall === WALL_BACK_NEAR || wall === WALL_BACK_FAR) { c.qu = q.x + v.x * t; c.backZoneAt(zone); }
      else { c.qu = q.z + v.z * t; c.sideZoneAt(zone); }
      if (zone.kind === SURF_OPEN) return;
      this.jSurface = zone.kind;
      this.jSeam = zone.seamDist;
      this.jJoin = zone.joinDist;
    } else {
      this.jSurface = SURF_FLOOR;
    }
    this.jW = w;
    this.jKind = kind;
    this.jWall = wall;
    this.jGap = gap;
    this.jT2 = t2;
  }

  /** Both bounces of a junction, the first surface's material given (n: its normal). */
  private junction(world: BallWorld, rng: Rng | null, sA: SurfaceSpec): void {
    nA.copy(n);
    const J = world.surfaces.junction;
    // The second surface's material, through the same fields the first used.
    const kA = this.hitKind, wA = this.hitWall, sfA = this.hitSurface, seamA = this.hitSeam, joinA = this.hitJoin;
    let sB: SurfaceSpec = world.floor;
    if (this.jKind === HIT_FLOOR) nB.set(0, 1, 0);
    else {
      wallNormal(this.jWall, nB);
      this.hitSurface = this.jSurface;
      this.hitSeam = this.jSeam;
      this.hitJoin = this.jJoin;
      sB = this.wallSurface(world);
      this.hitSurface = sfA;
      this.hitSeam = seamA;
      this.hitJoin = joinA;
    }
    const w = this.jW;
    const vnA = this.recVn;
    const vnB = this.vel.dot(nB);
    sv.copy(this.vel);
    sw.copy(this.spin);
    // The nick's extra loss goes with how much of the squeeze the second surface takes: a ball drifting into the
    // glass as it lands barely feels it, one driven into the corner is squeezed by both.
    const aA = -vnA, aB = -vnB;
    const share = aA > aB ? (aA > 1e-9 ? aB / aA : 0) : aB > 1e-9 ? aA / aB : 0;
    this.eJ = 1 - J.loss * w * (share > 0 ? share : 0);
    // First surface, then the second.
    n.copy(nA);
    this.bounce(world, sA, rng, false);
    va.copy(this.vel);
    n.copy(nB);
    this.bounce(world, sB, rng, false);
    rv.copy(this.vel);
    rw.copy(this.spin);
    const wear = this.wear;
    // The other way round (wear counted once: from the first order).
    this.vel.copy(sv);
    this.spin.copy(sw);
    n.copy(nB);
    this.bounce(world, sB, rng, false);
    n.copy(nA);
    this.bounce(world, sA, rng, false);
    this.wear = wear;
    this.eJ = 1;
    // Averaged: all the first order when the second surface is a contact time away, half and half together.
    const a = 1 - 0.5 * w;
    this.vel.lerpOf(this.vel, rv, a);
    this.spin.lerpOf(this.spin, rw, a);
    // Leaving both. The second surface's friction can turn the ball back into the first: it bounces off it again.
    let d = this.vel.dot(nA);
    if (d < 0) {
      n.copy(nA);
      this.bounce(world, sA, rng, false);
      this.wear = wear;
      d = this.vel.dot(nA);
    }
    if (d < 0.05) this.vel.addScaled(nA, 0.05 - d);
    d = this.vel.dot(nB);
    if (d < 0) this.vel.addScaled(nB, -d);
    n.copy(nA);
    // The flight on to the second, as the first surface alone sends it: B is met gap / approach later (capped: a
    // ball barely closing on B is barely changed by it, and is not logged as touching it: it never gets there).
    // Without this the second bounce would land early by that time, and the path would jump by up to v * contact
    // time where the junction gives way to two separate bounces. Under gravity (energy stays put); drag over a few
    // ms is left out.
    const appr = -va.dot(nB);
    let tau = appr > 1e-6 ? this.jGap / appr : 0;
    const cap = 3 * J.contactTime;
    const tauB = tau;
    if (tau > cap) tau = cap;
    // Never past a third wall's contact plane (in a corner): a wall is only met by crossing its plane.
    {
      const c = world.court;
      const xl = c.halfW - world.spec.radius, zl = c.halfL - world.spec.radius;
      const q = this.pos;
      const jw = this.jWall;
      if (va.x > 1e-9 && jw !== WALL_SIDE_RIGHT) { const t = (xl - q.x) / va.x; if (t < tau) tau = t > 0 ? t : 0; }
      if (va.x < -1e-9 && jw !== WALL_SIDE_LEFT) { const t = (-xl - q.x) / va.x; if (t < tau) tau = t > 0 ? t : 0; }
      if (va.z > 1e-9 && jw !== WALL_BACK_NEAR) { const t = (zl - q.z) / va.z; if (t < tau) tau = t > 0 ? t : 0; }
      if (va.z < -1e-9 && jw !== WALL_BACK_FAR) { const t = (-zl - q.z) / va.z; if (t < tau) tau = t > 0 ? t : 0; }
    }
    // Reached by the flight, or already during the squeeze: the ball keeps closing on B at its incoming speed while
    // it compresses against A (about half the contact), whatever A's friction then does to it (topspin into the
    // glass kicks the ball up off a floor it is already touching).
    const flown = appr > 1e-6 && tauB <= tau + 1e-12;
    const reached = flown || this.jT2 <= 0.5 * J.contactTime || (this.jKind === HIT_FLOOR && this.jGap < J.nickGap);
    // The first contact, here (a wall-then-floor nick logs both at once, floor first: below).
    const floorFirst = reached && this.jKind === HIT_FLOOR && this.jGap < J.nickGap;
    this.recT = this.resolveAt;
    this.recZ = this.pos.z;
    this.vnB = vnB;
    this.hitKind = kA;
    this.hitWall = wA;
    this.hitSurface = sfA;
    this.recVn = vnA;
    if (!floorFirst) this.record();
    this.pos.addScaled(va, tau);
    this.pos.y -= 0.5 * GRAVITY * tau * tau;
    this.vel.y -= GRAVITY * tau;
    this.pos.addScaled(nA, 1e-6);
    this.pos.addScaled(nB, 1e-6);
    const r = world.spec.radius;
    if (this.pos.y < r) this.pos.y = r;
    this.ahead = tau;
    // A wall-then-floor nick counts as landing first (FIP: good in the corner), both at the first contact.
    if (reached) {
      if (!floorFirst) this.recT = this.resolveAt + (flown ? tauB : 0);
      this.recZ = this.pos.z;
      this.recordJ();
    }
    if (floorFirst) {
      this.hitKind = kA;
      this.hitWall = wA;
      this.hitSurface = sfA;
      this.recVn = vnA;
      this.record();
    }
    this.hitKind = kA;
    this.hitWall = wA;
    this.hitSurface = sfA;
  }

  /** Record the junction's second contact (normal speed before it: vnB, a field: see `best`). */
  private vnB = 0;
  private recordJ(): void {
    this.hitKind = this.jKind;
    this.hitWall = this.jWall;
    this.hitSurface = this.jSurface;
    this.recVn = this.vnB;
    this.record();
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
    FIO[0] = -z * w * t;
    expF();
    const e = FIO[0]!;
    const cs = cos(wd * t);
    const sn = sin(wd * t);
    const A = this.d0;
    const B = (this.dv0 + z * w * A) / wd;
    this.rd = e * (A * cs + B * sn);
    this.rdv = e * ((B * wd - z * w * A) * cs - (A * wd + z * w * B) * sn);
    const b = world.surfaces.netGive.grab;
    FIO[0] = -b * t;
    expF();
    const eb = FIO[0]!;
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
    // The netting ends at the posts: a caught ball sliding along it stops against one.
    const xm = world.court.halfW - world.court.def.net.postSize * 0.5 - r;
    if (this.pos.x > xm || this.pos.x < -xm) {
      this.pos.x = this.pos.x > 0 ? xm : -xm;
      if (this.pos.x * this.vel.x > 0) this.vel.x = -0.3 * this.vel.x;
    }
    FIO[0] = -world.surfaces.netGive.grab * t;
    expF();
    this.spin.scale(FIO[0]!);
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

    n0.copy(n);
    // Random tilt of the normal (mesh, seams, a little on floors), never more than half the angle the ball comes
    // in at: past that a glancing ball would be leaving through the tilted surface (no impulse) and meet the real
    // one again at once.
    if (rng && s.jitterDeg > 0) {
      const ang = (s.jitterDeg * PI) / 180;
      const vl = this.vel.length();
      const lim = vl > 1e-6 ? (0.5 * -this.vel.dot(n)) / vl : 0;
      const a = clamp(rng.normal() * ang * 0.5, -lim, lim);
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
    if (vn >= 0) { n.copy(n0); return; } // moving away already
    let e = clamp(s.e0 - s.eSlope * -vn, s.eMin, s.e0) * spec.restitutionScale * this.eScale * this.eJ;
    if (this.wears) {
      const q = -vn / 15;
      this.wear += q * q < 3 ? q * q : 3;
      this.wearDirty = true;
    }
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
    const jmax = s.mu * this.muScale * jn;
    if (jtl > jmax && jtl > 0) jt.scale(jmax / jtl);

    // Apply.
    this.vel.addScaled(n, -(1 + e) * vn).addScaled(jt, 1 / m);
    tmp.crossOf(rc, jt);
    this.spin.addScaled(tmp, 1 / world.inertia);

    // The sand's scatter: the whole rebound (velocity and spin) turned about the real normal, so the ball's line
    // is skewed and its height kept.
    if (rng && s.turnDeg > 0) {
      const phi = (clamp(rng.normal(), -3, 3) * s.turnDeg * PI) / 180;
      this.rotC = cos(phi);
      this.rotS = sin(phi);
      this.rotateAbout(this.vel, n0);
      this.rotateAbout(this.spin, n0);
    }
    n.copy(n0);
    // Never leave travelling into the surface.
    const vn2 = this.vel.dot(n);
    if (vn2 < 0.05) this.vel.addScaled(n, 0.05 - vn2);
  }

  /** Cosine and sine for rotateAbout (fields: see `best`). */
  private rotC = 1;
  private rotS = 0;

  /** Rotate v about the unit axis k by the angle in rotC / rotS (Rodrigues). */
  private rotateAbout(v: V3, k: V3): void {
    const c = this.rotC;
    const s = this.rotS;
    const d = (v.x * k.x + v.y * k.y + v.z * k.z) * (1 - c);
    const x = v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d;
    const y = v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d;
    const z = v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d;
    v.set(x, y, z);
  }

  /** Mark the ball outside the court once it leaves it (event at time exitAt in the step). */
  private checkExit(world: BallWorld): void {
    if (this.outside) return;
    const c = world.court;
    const p = this.pos;
    if (abs(p.x) > c.halfW || abs(p.z) > c.halfL || p.y > 12) {
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

/** A wall's normal into the court. */
function wallNormal(wall: number, out: V3): void {
  if (wall === WALL_SIDE_RIGHT) out.set(-1, 0, 0);
  else if (wall === WALL_SIDE_LEFT) out.set(1, 0, 0);
  else if (wall === WALL_BACK_NEAR) out.set(0, 0, -1);
  else out.set(0, 0, 1);
}

export { SURF_GLASS, SURF_MESH, SURF_FLOOR, SURF_NET, SURF_OPEN };
