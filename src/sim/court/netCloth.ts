// The net as cloth: a grid of knots joined by twine, hung from the steel cable inside the tape, laced to the
// posts at both ends and loose along the bottom. Solved with XPBD (positions, small substeps) so the twine is
// as near inextensible as real polypropylene and only pulls, never pushes: the netting folds, swings, ripples
// and settles by itself. The ball is a particle in the same solve: it pushes the knots and they push back
// (two-way contact against the deformed surface), the netting grips it, the tape kicks it.
//
// Everything is preallocated typed arrays; doubles reach the solver through fields, not arguments (V8 boxes
// doubles passed to non-inlined methods, which would allocate every substep). Deterministic: only + - * / and
// sqrt (IEEE-exact) in a fixed order.
import { GRAVITY, DT } from '../core/constants.ts';
import { sqrt, abs, min, max } from '../core/smath.ts';
import type { Hasher } from '../core/hash.ts';
import type { Court } from './court.ts';

export interface NetClothSpec {
  /** Grid cells along the net and down it. */
  cols: number;
  rows: number;
  /** Mass of the netting (kg) and of the cable with its tape (kg per metre). */
  bodyMass: number;
  cableMassPerM: number;
  /** XPBD compliance (m/N) of a twine link; tension of the cable (N), set by the winder. */
  cordCompliance: number;
  cableTension: number;
  /** Pre-tension of each row of netting from the lacing at the posts (N), and how far a row can stretch. */
  rowTension: number;
  /** The bottom edge: a cord in the binding, laced to the posts at the floor (N), and its mass with the binding. */
  bottomTension: number;
  bottomMassPerM: number;
  rowStretch: number;
  /** Strain-rate damping (N s) of a row of netting (twine rubbing, knots slipping) and of the cable. */
  rowDamping: number;
  cableDamping: number;
  /** Drag of the twine: drag coefficient of a cord and the fraction of the net's area that is twine. */
  cordCd: number;
  solidity: number;
  /** Extra damping of the knots (1/s): friction where the twine crosses. */
  damping: number;
  /** Cable centre below the top of the tape (m), tape height (m), bottom edge above the floor at rest (m). */
  cableBelowTop: number;
  tapeHeight: number;
  bottomGap: number;
  /** Substeps per tick with the ball near (more if it is fast: under maxTravel per substep), and without. */
  substeps: number;
  freeSubsteps: number;
  maxSubsteps: number;
  maxTravel: number;
  /** Ball on the netting: restitution, friction, spin lost per second; on the tape band; on the cable. */
  restitution: number;
  friction: number;
  grab: number;
  tapeRestitution: number;
  cableRadius: number;
  cableRestitution: number;
  cableFriction: number;
  /** Asleep once every knot is slower than sleepSpeed (m/s) for sleepTime (s). */
  sleepSpeed: number;
  sleepTime: number;
}

const FLOOR_Y = 0.004; // twine radius: knots rest on the floor here

/** The settled rest shape per court and spec (deterministic, so computed once and shared). */
const restCache = new Map<string, Float64Array>();
const REST_CACHE_MAX = 16;

export class NetCloth {
  readonly spec: NetClothSpec;
  readonly cols: number;
  readonly rows: number;
  /** Knots per row (cols + 1) and in all. Knot (i, j) is j * nx + i; row 0 is the cable, row `rows` the bottom. */
  readonly nx: number;
  readonly n: number;
  readonly halfW: number;
  readonly dx: number;
  /** Current, start-of-tick (for render interpolation), rest and substep-start positions; velocities. */
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  readonly rest: Float64Array;
  private readonly x0: Float64Array;
  readonly vel: Float64Array;
  /** Inverse masses (0 = laced to a post) and drag factors 0.5 rho Cd A / m. */
  private readonly w: Float64Array;
  private readonly kd: Float64Array;
  /** Longest each row link of the netting may stretch to (rows 1..rows, row j link i at (j - 1) * cols + i). */
  private readonly ll: Float64Array;
  /**
   * Every column of twine is a chain, solved exactly per substep (a tridiagonal system,
   * Thomas algorithm): a hanging column of 13 links stretches visibly under Gauss-Seidel. Rest lengths: column
   * i link k at i * rows + k. (The cable is a string at constant tension, cableSolve.)
   */
  private readonly colL: Float64Array;
  // Chain scratch: per link direction, diagonal, off-diagonal (to the next link), right-hand side, solution.
  private readonly cnx0: Float64Array;
  private readonly cny0: Float64Array;
  private readonly cnz0: Float64Array;
  private readonly cdg: Float64Array;
  private readonly cof: Float64Array;
  private readonly crh: Float64Array;
  private chainAlpha = 0;

  awake = false;
  /**
   * How far the netting stands off the cable's line while asleep (largest |z| of a knot, m): the ball is coupled
   * to a sleeping net within this of it. (QA army: a 4.6 m/s wind billowed the bottom 12 cm out towards a low
   * drive, which was already past the netting when it came within the 4 cm allowed, and went through it.)
   */
  bulge = 0;
  private quiet = 0;
  windX = 0;
  windZ = 0;

  // ---- the ball, while it is coupled (written and read by Ball) ----
  /** Ball position (end of its own substep), velocity, inverse mass, radius, the side of the net it is on. */
  bx = 0;
  by = 0;
  bz = 0;
  bvx = 0;
  bvy = 0;
  bvz = 0;
  bw = 1 / 0.0577;
  br = 0.0328;
  /** Ball spin (rad/s) and its inertia factor (I = alpha m r^2): friction at a contact turns it. */
  bsx = 0;
  bsy = 0;
  bsz = 0;
  balpha = 0.55;
  side = 1;
  /** Substep length (s), set before substep(). */
  h = DT / 8;
  /** Contacts found in the last substep: netting, cable; the approach speed of a new one (m/s, >= 0). */
  touchBody = false;
  touchCable = false;
  touchSpeed = 0;
  /** Where on the net the ball touched (knot row of the cell; 0 = the tape band). */
  touchRow = 0;

  // Contact scratch (fields so nothing is boxed).
  private ballOn = false;
  private ta = 0;
  private tb = 0;
  private tc = 0;
  private wa = 0;
  private wb = 0;
  private wc = 0;
  private nx_ = 0;
  private ny_ = 0;
  private nz_ = 0;
  private lamBody = 0;
  private vnPreBody = 0;
  private ca = 0;
  private cb = 0;
  private ct = 0;
  private cnx = 0;
  private cny = 0;
  private cnz = 0;
  private lamCable = 0;
  private vnPreCable = 0;
  private ci = 0;
  private cj = 0;
  /** Deepest contact found so far by triContact(). */
  private tC = 0;

  constructor(court: Court, spec: NetClothSpec, rho: number) {
    this.spec = spec;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.nx = spec.cols + 1;
    this.n = this.nx * (spec.rows + 1);
    this.halfW = court.halfW;
    this.dx = (2 * court.halfW) / spec.cols;
    const n = this.n;
    this.pos = new Float64Array(n * 3);
    this.prev = new Float64Array(n * 3);
    this.rest = new Float64Array(n * 3);
    this.x0 = new Float64Array(n * 3);
    this.vel = new Float64Array(n * 3);
    this.w = new Float64Array(n);
    this.kd = new Float64Array(n);

    // Hang it: the cable on the FIP sag (0.92 m at the posts, 0.88 m in the middle, to the top of the tape),
    // the netting straight down from it to just above the floor.
    const nx = this.nx;
    const R = spec.rows;
    const bodyKnot = spec.bodyMass / (this.n - nx);
    const cellArea = this.dx * ((court.def.net.heightCentre - spec.cableBelowTop) / R);
    for (let i = 0; i < nx; i++) {
      const x = -this.halfW + i * this.dx;
      const yc = court.netHeightAt(x) - spec.cableBelowTop;
      for (let j = 0; j <= R; j++) {
        const k = j * nx + i;
        const y = yc + (spec.bottomGap - yc) * (j / R);
        this.pos[k * 3] = x;
        this.pos[k * 3 + 1] = y;
        this.pos[k * 3 + 2] = 0;
        const pinned = i === 0 || i === spec.cols;
        let m: number;
        let area: number;
        if (j === 0) {
          m = spec.cableMassPerM * this.dx + bodyKnot * 0.5;
          area = this.dx * spec.tapeHeight; // the tape is solid
        } else if (j === R) {
          m = spec.bottomMassPerM * this.dx + bodyKnot * 0.5;
          area = cellArea * spec.solidity * 0.5 + this.dx * 0.03; // and a 3 cm binding
        } else {
          m = bodyKnot;
          area = cellArea * spec.solidity;
        }
        this.w[k] = pinned ? 0 : 1 / m;
        this.kd[k] = (0.5 * rho * spec.cordCd * area) / m;
      }
    }

    // Row links' stretch limits; the columns' lengths.
    this.ll = new Float64Array(R * spec.cols);
    let c = 0;
    for (let j = 1; j <= R; j++) {
      for (let i = 0; i < spec.cols; i++) this.ll[c++] = this.dist(j * nx + i, j * nx + i + 1) * spec.rowStretch;
    }
    this.colL = new Float64Array(nx * R);
    for (let i = 0; i < nx; i++) for (let k = 0; k < R; k++) this.colL[i * R + k] = this.dist(k * nx + i, (k + 1) * nx + i);
    const m = max(spec.cols, R) + 1;
    this.cnx0 = new Float64Array(m);
    this.cny0 = new Float64Array(m);
    this.cnz0 = new Float64Array(m);
    this.cdg = new Float64Array(m);
    this.cof = new Float64Array(m);
    this.crh = new Float64Array(m);

    // Settle under gravity once per court, then start asleep at rest.
    const key = `${court.def.width}|${court.def.net.heightCentre}|${court.def.net.heightPost}|${JSON.stringify(spec)}|${rho}`;
    let settled = restCache.get(key);
    if (!settled) {
      this.awake = true;
      for (let t = 0; t < 240; t++) {
        this.prev.set(this.pos);
        this.freeTick();
      }
      for (let i = 0; i < n * 3; i++) this.vel[i] = 0;
      settled = new Float64Array(this.pos);
      // (bounded: the key has the air's density, which every climate changes; the QA army's 2000 climates grew
      // the heap 9 KB a match)
      if (restCache.size >= REST_CACHE_MAX) restCache.delete(restCache.keys().next().value!);
      restCache.set(key, settled);
    }
    this.pos.set(settled);
    this.prev.set(settled);
    this.rest.set(settled);
    this.vel.fill(0);
    this.awake = false;
    this.measureBulge();
  }

  /** Asleep where it is (settled; tests). */
  sleep(): void {
    this.awake = false;
    this.vel.fill(0);
    this.quiet = 0;
    this.measureBulge();
  }

  private measureBulge(): void {
    const p = this.pos;
    let m = 0;
    for (let i = 2; i < p.length; i += 3) {
      const z = p[i]! < 0 ? -p[i]! : p[i]!;
      if (z > m) m = z;
    }
    this.bulge = m;
  }

  private dist(a: number, b: number): number {
    const dx = this.pos[b * 3]! - this.pos[a * 3]!;
    const dy = this.pos[b * 3 + 1]! - this.pos[a * 3 + 1]!;
    const dz = this.pos[b * 3 + 2]! - this.pos[a * 3 + 2]!;
    return sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * One row of knots as a string at constant tension T (rowT) with strain-rate damping c (rowC: twine rubbing
   * and knots slipping as the shape changes): one implicit step from where the knots are now,
   *   (m/h^2)(x' - x) = (T/dx) L x' + (c/(dx h)) L (x' - x0),   (L x)_i = x[i-1] - 2 x[i] + x[i+1]
   * with x0 the knots at the start of the substep and the ends laced to the posts. Tridiagonal per axis (Thomas).
   * Row 0 is the cable at the winder's tension (its sag comes from the weight it carries, w L^2 / 8T, about 4 cm
   * for the FIP net at 1 kN); the netting rows carry the lacing's light pre-tension.
   */
  private rowSolve(row: number): void {
    const p = this.pos;
    const x0 = this.x0;
    const cols = this.cols;
    const nI = cols - 1;
    const base = row * this.nx;
    const cd = this.rowC / (this.dx * this.h);
    const k = this.rowT / this.dx + cd;
    const ih2 = 1 / (this.h * this.h);
    const dg = this.cdg;
    const rh = this.crh;
    const w = this.w;
    for (let c = 0; c < 3; c++) {
      for (let i = 1; i <= nI; i++) {
        const q = (base + i) * 3 + c;
        const a = ih2 / w[base + i]!;
        dg[i - 1] = a + 2 * k;
        rh[i - 1] = a * p[q]! - cd * (x0[q - 3]! - 2 * x0[q]! + x0[q + 3]!);
      }
      rh[0] = rh[0]! + k * p[base * 3 + c]!;
      rh[nI - 1] = rh[nI - 1]! + k * p[(base + cols) * 3 + c]!;
      for (let i = 1; i < nI; i++) {
        const f = -k / dg[i - 1]!;
        dg[i] = dg[i]! + f * k;
        rh[i] = rh[i]! - f * rh[i - 1]!;
      }
      rh[nI - 1] = rh[nI - 1]! / dg[nI - 1]!;
      for (let i = nI - 2; i >= 0; i--) rh[i] = (rh[i]! + k * rh[i + 1]!) / dg[i]!;
      for (let i = 1; i <= nI; i++) p[(base + i) * 3 + c] = rh[i - 1]!;
    }
  }

  private rowT = 0;
  private rowC = 0;

  /**
   * Solve one chain exactly (linearised once): knots first, first + stride, ... (`count` links), rest lengths
   * rest[off + k], compliance chainAlpha (already divided by h^2). With `slack`, links shorter than their rest
   * length carry nothing (twine); without, the chain holds its length both ways (the tensioned cable).
   */
  private chain(first: number, stride: number, count: number, rest: Float64Array, off: number, slack: boolean): void {
    const p = this.pos;
    const w = this.w;
    const nX = this.cnx0;
    const nY = this.cny0;
    const nZ = this.cnz0;
    const dg = this.cdg;
    const of = this.cof;
    const rh = this.crh;
    const al = this.chainAlpha;
    const s3 = stride * 3;
    let active = false;
    for (let k = 0; k < count; k++) {
      const a = (first + k * stride) * 3;
      const b = a + s3;
      const dx = p[b]! - p[a]!;
      const dy = p[b + 1]! - p[a + 1]!;
      const dz = p[b + 2]! - p[a + 2]!;
      const d = sqrt(dx * dx + dy * dy + dz * dz);
      const C = d - rest[off + k]!;
      if ((slack && C <= 0) || d < 1e-12) {
        // Inactive: an identity row, nothing to solve.
        nX[k] = 0; nY[k] = 0; nZ[k] = 0;
        dg[k] = 1;
        rh[k] = 0;
        continue;
      }
      active = true;
      nX[k] = dx / d;
      nY[k] = dy / d;
      nZ[k] = dz / d;
      dg[k] = w[first + k * stride]! + w[first + (k + 1) * stride]! + al;
      rh[k] = -C;
    }
    if (!active) return; // all slack: a hanging column at rest costs one pass
    // Thomas algorithm (symmetric tridiagonal; links k and k+1 share knot k+1): forward sweep with the
    // off-diagonal formed on the fly, back substitution; solution in rh.
    for (let k = 1; k < count; k++) {
      const o = -w[first + k * stride]! * (nX[k - 1]! * nX[k]! + nY[k - 1]! * nY[k]! + nZ[k - 1]! * nZ[k]!);
      of[k - 1] = o;
      const f = o / dg[k - 1]!;
      dg[k] = dg[k]! - f * o;
      rh[k] = rh[k]! - f * rh[k - 1]!;
    }
    rh[count - 1] = rh[count - 1]! / dg[count - 1]!;
    for (let k = count - 2; k >= 0; k--) rh[k] = (rh[k]! - of[k]! * rh[k + 1]!) / dg[k]!;
    // Move the knots: dx_i = w_i (n_{i-1} lam_{i-1} - n_i lam_i).
    for (let k = 0; k <= count; k++) {
      const node = first + k * stride;
      const wi = w[node]!;
      if (wi === 0) continue;
      let mx = 0;
      let my = 0;
      let mz = 0;
      if (k < count) { const l = rh[k]!; mx -= nX[k]! * l; my -= nY[k]! * l; mz -= nZ[k]! * l; }
      if (k > 0) { const l = rh[k - 1]!; mx += nX[k - 1]! * l; my += nY[k - 1]! * l; mz += nZ[k - 1]! * l; }
      const q = node * 3;
      p[q] = p[q]! + wi * mx;
      p[q + 1] = p[q + 1]! + wi * my;
      p[q + 2] = p[q + 2]! + wi * mz;
    }
  }

  private prevSynced = false;

  /** Start of a sim tick: remember where the knots were, for the renderer's interpolation. */
  beginTick(): void {
    if (this.awake) {
      this.prev.set(this.pos);
      this.prevSynced = false;
    } else if (!this.prevSynced) {
      this.prev.set(this.pos); // asleep: one copy, then nothing moves until it is woken
      this.prevSynced = true;
    }
  }

  /** Height of the cable (centre) at x, from the cable knots as they are now. */
  cableY(x: number): number {
    const f = (x + this.halfW) / this.dx;
    const i = clampI(f | 0, 0, this.cols - 1);
    const t = f - i;
    return this.pos[i * 3 + 1]! * (1 - t) + this.pos[(i + 1) * 3 + 1]! * t;
  }

  /** z of the cable at x. */
  cableZ(x: number): number {
    const f = (x + this.halfW) / this.dx;
    const i = clampI(f | 0, 0, this.cols - 1);
    const t = f - i;
    return this.pos[i * 3 + 2]! * (1 - t) + this.pos[(i + 1) * 3 + 2]! * t;
  }

  /** In the hot paths: the cable at x = qx into cy, cz (fields: doubles in and out of a call get boxed). */
  qx = 0;
  cy = 0;
  cz = 0;
  cableAt(): void {
    const f = (this.qx + this.halfW) / this.dx;
    const i = clampI(f | 0, 0, this.cols - 1);
    const t = f - i;
    const p = this.pos;
    this.cy = p[i * 3 + 1]! * (1 - t) + p[(i + 1) * 3 + 1]! * t;
    this.cz = p[i * 3 + 2]! * (1 - t) + p[(i + 1) * 3 + 2]! * t;
  }

  /**
   * Substeps for the coming tick with the ball at speed `ballSpeed` (read from bvx..): enough that the ball
   * moves at most maxTravel per substep.
   */
  substepsFor(): number {
    const s = sqrt(this.bvx * this.bvx + this.bvy * this.bvy + this.bvz * this.bvz);
    const k = (s * DT) / this.spec.maxTravel;
    const n = k > this.spec.substeps ? (k | 0) + 1 : this.spec.substeps;
    return n < this.spec.maxSubsteps ? n : this.spec.maxSubsteps;
  }

  /** A tick with no ball near: let the net move (only called while awake). */
  freeTick(): void {
    const S = this.spec.freeSubsteps;
    this.h = DT / S;
    this.ballOn = false;
    for (let s = 0; s < S; s++) this.substep();
    this.settle(DT);
  }

  /**
   * One substep with the ball coupled (bx.. bv.. side set by the caller; the ball has already flown this
   * substep on its own). Wakes the net on contact. Afterwards bx.. bv.. hold the ball corrected by the net.
   */
  coupledSubstep(): void {
    this.ballOn = true;
    this.touchBody = false;
    this.touchCable = false;
    if (!this.awake) {
      // Asleep: the net is at rest, so only a contact can change anything.
      if (!this.probe()) return;
      this.awake = true;
      this.quiet = 0;
    }
    this.substep();
  }

  /** End of a coupled tick: count quiet time towards sleep. */
  endCoupledTick(): void {
    if (this.awake) this.settle(DT);
  }

  /**
   * Count quiet time towards sleep. Judged on how far each knot moved over the whole tick (from `prev`), not on
   * substep velocities: a twine link at its exact length flickers between slack and taut from one substep to the
   * next, which shows as speed but moves nothing.
   */
  private settle(dt: number): void {
    const p = this.pos;
    const q = this.prev;
    let m2 = 0;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i]! - q[i]!;
      const dy = p[i + 1]! - q[i + 1]!;
      const dz = p[i + 2]! - q[i + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > m2) m2 = d2;
    }
    const s = this.spec.sleepSpeed * dt;
    if (m2 < s * s && !this.touchBody && !this.touchCable) {
      this.quiet += dt;
      if (this.quiet >= this.spec.sleepTime) this.sleep();
    } else this.quiet = 0;
  }

  private substep(): void {
    const h = this.h;
    const n = this.n;
    const p = this.pos;
    const v = this.vel;
    const x0 = this.x0;
    const w = this.w;
    const kd = this.kd;
    const wx = this.windX;
    const wz = this.windZ;
    const damp = 1 / (1 + this.spec.damping * h);
    const gh = GRAVITY * h;

    // Predict: gravity, drag against the air (and the wind), damping.
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      x0[k] = p[k]!;
      x0[k + 1] = p[k + 1]!;
      x0[k + 2] = p[k + 2]!;
      if (w[i] === 0) continue;
      const rx = v[k]! - wx;
      const ry = v[k + 1]! - gh;
      const rz = v[k + 2]! - wz;
      const s = sqrt(rx * rx + ry * ry + rz * rz);
      const f = 1 / (1 + kd[i]! * s * h);
      const vx = (wx + rx * f) * damp;
      const vy = ry * f * damp;
      const vz = (wz + rz * f) * damp;
      v[k] = vx;
      v[k + 1] = vy;
      v[k + 2] = vz;
      p[k] = p[k]! + vx * h;
      let y = p[k + 1]! + vy * h;
      if (y < FLOOR_Y) y = FLOOR_Y;
      p[k + 1] = y;
      p[k + 2] = p[k + 2]! + vz * h;
    }

    // The ball pushes the knots; then the cable, the columns and the rows pull them back into a net; then the
    // ball once more against where the netting ended up.
    let bdx = 0;
    let bdy = 0;
    let bdz = 0;
    const x = this.bx;
    const y = this.by;
    const z = this.bz;
    if (this.ballOn) {
      this.lamBody = 0;
      this.lamCable = 0;
      if (this.contactBody(true)) {
        this.touchBody = true;
        this.hold();
      }
      if (this.contactCable(true)) this.touchCable = true;
    }
    const h2 = h * h;
    const R = this.rows;
    const nx = this.nx;
    this.chainAlpha = this.spec.cordCompliance / h2;
    for (let i = 1; i < this.cols; i++) this.chain(i, nx, R, this.colL, i * R, true);
    // Rows of netting: the lacing's pre-tension, then the twine's own length as a limit (pull only).
    this.rowT = this.spec.rowTension;
    this.rowC = this.spec.rowDamping;
    for (let j = 1; j < R; j++) this.rowSolve(j);
    this.rowT = this.spec.bottomTension;
    this.rowSolve(R);
    // The rows can stretch only so far (knots slip, the twine gives a few percent): exact chains, pull only.
    for (let j = 1; j <= R; j++) this.chain(j * nx, 1, this.cols, this.ll, (j - 1) * this.cols, true);
    // The cable last, as a string held at the winder's tension (an inextensible chain this taut is singular:
    // 4 mm of length on 10 m is 9 cm of sag).
    this.rowT = this.spec.cableTension;
    this.rowC = this.spec.cableDamping;
    this.rowSolve(0);
    if (this.held) this.release();
    for (let i = 0; i < n; i++) if (p[i * 3 + 1]! < FLOOR_Y) p[i * 3 + 1] = FLOOR_Y;
    if (this.ballOn) {
      if (this.contactBody(true)) this.touchBody = true;
      if (this.contactCable(true)) this.touchCable = true;
      // The netting can press the ball down but not into the floor.
      if (this.by < this.br) this.by = this.br;
      bdx = this.bx - x;
      bdy = this.by - y;
      bdz = this.bz - z;
    }

    // Velocities from the moves; floor friction; how fast anything still goes.
    const ih = 1 / h;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      const k = i * 3;
      let vx = (p[k]! - x0[k]!) * ih;
      const vy = (p[k + 1]! - x0[k + 1]!) * ih;
      let vz = (p[k + 2]! - x0[k + 2]!) * ih;
      if (p[k + 1]! <= FLOOR_Y + 1e-9) {
        vx *= 0.6;
        vz *= 0.6;
      }
      v[k] = vx;
      v[k + 1] = vy;
      v[k + 2] = vz;
    }

    if (this.ballOn) {
      this.bvx += bdx * ih;
      this.bvy += bdy * ih;
      this.bvz += bdz * ih;
      if (this.touchBody) this.bodyVelocity();
      if (this.touchCable) this.cableVelocity();
    }
  }

  // The knots under the ball while it presses on them (hold/release).
  private held = false;
  private readonly hk = new Int32Array(3);
  private readonly hb = new Float64Array(3);
  private readonly hw = new Float64Array(3);
  private readonly hp = new Float64Array(9);

  /**
   * While the ball presses on the netting, the three knots under it carry its mass (shared by the barycentric
   * weights) through the cable, column and row solves: the netting then has to stop the ball, not just the
   * knots, and a ball near a post meets the short rows' full stiffness instead of pushing 3 g knots through
   * them (the ball is 20 times a knot, which a Gauss-Seidel contact never settles). release() hands the knots'
   * net move along the normal back to the ball.
   */
  private hold(): void {
    const w = this.w;
    const M = 1 / this.bw;
    this.hk[0] = this.ta; this.hk[1] = this.tb; this.hk[2] = this.tc;
    this.hb[0] = this.wa; this.hb[1] = this.wb; this.hb[2] = this.wc;
    for (let k = 0; k < 3; k++) {
      const i = this.hk[k]!;
      const wi = w[i]!;
      this.hw[k] = wi;
      if (wi > 0) w[i] = 1 / (1 / wi + this.hb[k]! * M);
      this.hp[k * 3] = this.pos[i * 3]!;
      this.hp[k * 3 + 1] = this.pos[i * 3 + 1]!;
      this.hp[k * 3 + 2] = this.pos[i * 3 + 2]!;
    }
    this.hnx = this.nx_;
    this.hny = this.ny_;
    this.hnz = this.nz_;
    this.held = true;
  }

  private hnx = 0;
  private hny = 0;
  private hnz = 0;

  private release(): void {
    const w = this.w;
    const p = this.pos;
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const i = this.hk[k]!;
      w[i] = this.hw[k]!;
      const b = this.hb[k]!;
      d += b * (this.hnx * (p[i * 3]! - this.hp[k * 3]!) + this.hny * (p[i * 3 + 1]! - this.hp[k * 3 + 1]!) + this.hnz * (p[i * 3 + 2]! - this.hp[k * 3 + 2]!));
    }
    // Only a push: netting falling away from the ball does not pull it along.
    if (d > 0) {
      this.bx += this.hnx * d;
      this.by += this.hny * d;
      this.bz += this.hnz * d;
    }
    this.held = false;
  }

  /** Is the ball touching the net at rest? (No changes.) */
  private probe(): boolean {
    const x = this.bx;
    const y = this.by;
    const z = this.bz;
    const hit = this.contactBody(false) || this.contactCable(false);
    this.bx = x;
    this.by = y;
    this.bz = z;
    return hit;
  }

  /**
   * Find the cell of the netting the ball is over, the triangle under it and its depth into it; if `apply`,
   * push ball and knots apart (by their inverse masses) and remember the contact for the velocity pass.
   */
  private contactBody(apply: boolean): boolean {
    // The cell under the ball's x-y, then every triangle round it in 3D: a hard ball low into the net folds
    // the netting into a bag whose floor is nearly level, which a height lookup alone cannot see (the ball
    // dropped through it and out under the bag).
    if (!this.findCell(true)) return false;
    const R = this.rows;
    const nx = this.nx;
    const i0 = this.ci > 0 ? this.ci - 1 : 0;
    const i1 = this.ci < this.cols - 1 ? this.ci + 1 : this.cols - 1;
    const j0 = this.cj > 1 ? this.cj - 2 : 0;
    const j1 = this.cj < R - 2 ? this.cj + 2 : R - 1;
    this.tC = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const a = j * nx + i;
        this.triContact(a, a + 1, a + nx, j);
        this.triContact(a + 1, a + nx + 1, a + nx, j);
      }
    }
    if (this.tC <= 0) return false;
    const p = this.pos;
    const bx = this.bx;
    const by = this.by;
    const ka = this.ta * 3;
    const kb = this.tb * 3;
    const kc = this.tc * 3;
    const Nx = this.nx_;
    const Ny = this.ny_;
    const Nz = this.nz_;
    const Px = this.wa * p[ka]! + this.wb * p[kb]! + this.wc * p[kc]!;
    const Py = this.wa * p[ka + 1]! + this.wb * p[kb + 1]! + this.wc * p[kc + 1]!;
    const Pz = this.wa * p[ka + 2]! + this.wb * p[kb + 2]! + this.wc * p[kc + 2]!;
    const dist = Nx * (bx - Px) + Ny * (by - Py) + Nz * (this.bz - Pz);
    const C = this.br + 0.0015 - dist; // ball radius + twine radius
    if (C <= 0) return false;
    if (!apply) return true;
    const w = this.w;
    const W = this.bw + this.wa * this.wa * w[this.ta]! + this.wb * this.wb * w[this.tb]! + this.wc * this.wc * w[this.tc]!;
    const lam = C / W;
    // Approach speed before this correction (ball against the knots' predicted motion).
    const v = this.vel;
    const vrx = this.bvx - (this.wa * v[ka]! + this.wb * v[kb]! + this.wc * v[kc]!);
    const vry = this.bvy - (this.wa * v[ka + 1]! + this.wb * v[kb + 1]! + this.wc * v[kc + 1]!);
    const vrz = this.bvz - (this.wa * v[ka + 2]! + this.wb * v[kb + 2]! + this.wc * v[kc + 2]!);
    this.vnPreBody = Nx * vrx + Ny * vry + Nz * vrz;
    this.bx += Nx * lam * this.bw;
    this.by += Ny * lam * this.bw;
    this.bz += Nz * lam * this.bw;
    const fa = lam * this.wa * w[this.ta]!;
    const fb = lam * this.wb * w[this.tb]!;
    const fc = lam * this.wc * w[this.tc]!;
    p[ka] = p[ka]! - Nx * fa; p[ka + 1] = p[ka + 1]! - Ny * fa; p[ka + 2] = p[ka + 2]! - Nz * fa;
    p[kb] = p[kb]! - Nx * fb; p[kb + 1] = p[kb + 1]! - Ny * fb; p[kb + 2] = p[kb + 2]! - Nz * fb;
    p[kc] = p[kc]! - Nx * fc; p[kc + 1] = p[kc + 1]! - Ny * fc; p[kc + 2] = p[kc + 2]! - Nz * fc;
    this.lamBody += lam;
    this.touchRow = this.cj;
    if (!this.touchBody && !this.touchCable) this.touchSpeed = max(0, -this.vnPreBody);
    return true;
  }

  /**
   * The triangle of netting under the ball's x-y: knots ta tb tc, barycentric weights wa wb wc, unit normal
   * nx_ ny_ nz_ facing the ball's side. False above the cable or beyond the posts.
   */
  private locate(): boolean {
    if (!this.findCell(false)) return false;
    const p = this.pos;
    const nx = this.nx;
    const i = this.ci;
    const j = this.cj;
    // Two triangles per cell: (i,j) (i+1,j) (i,j+1) and (i+1,j) (i+1,j+1) (i,j+1). Barycentric in x-y.
    const a = j * nx + i;
    const b = a + 1;
    const c = a + nx;
    const d = c + 1;
    this.tri(a, b, c);
    if (this.wa < 0 || this.wb < 0 || this.wc < 0) {
      this.tri(b, d, c);
      // Outside both (a sheared cell): clamp onto the second.
      let wa = max(0, this.wa);
      let wb = max(0, this.wb);
      let wc = max(0, this.wc);
      const sum = wa + wb + wc;
      if (sum < 1e-9) return false;
      wa /= sum; wb /= sum; wc /= sum;
      this.wa = wa; this.wb = wb; this.wc = wc;
    }
    const ka = this.ta * 3;
    const kb = this.tb * 3;
    const kc = this.tc * 3;
    // Plane of the triangle, normal towards the ball's side.
    const e1x = p[kb]! - p[ka]!;
    const e1y = p[kb + 1]! - p[ka + 1]!;
    const e1z = p[kb + 2]! - p[ka + 2]!;
    const e2x = p[kc]! - p[ka]!;
    const e2y = p[kc + 1]! - p[ka + 1]!;
    const e2z = p[kc + 2]! - p[ka + 2]!;
    const Nx = e1y * e2z - e1z * e2y;
    const Ny = e1z * e2x - e1x * e2z;
    const Nz = e1x * e2y - e1y * e2x;
    const nl = sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
    if (nl < 1e-12) return false;
    const sg = Nz * this.side < 0 ? -1 / nl : 1 / nl;
    this.nx_ = Nx * sg;
    this.ny_ = Ny * sg;
    this.nz_ = Nz * sg;
    return true;
  }

  /**
   * The ball against triangle (a, b, c) of cell row `row`, in 3D: its depth past the plane (normal from the
   * winding, -z at rest for both triangles of a cell, turned to the ball's side, so a fold keeps its front
   * and back) where the ball's centre projects inside the triangle. Keeps the deepest contact that one
   * substep's travel can explain (deeper is the ball beyond that patch, not in it): ta tb tc, wa wb wc,
   * nx_ ny_ nz_, cj, tC.
   */
  private triContact(a: number, b: number, c: number, row: number): void {
    const p = this.pos;
    const ka = a * 3;
    const kb = b * 3;
    const kc = c * 3;
    const ax = p[ka]!;
    const ay = p[ka + 1]!;
    const az = p[ka + 2]!;
    const e1x = p[kb]! - ax;
    const e1y = p[kb + 1]! - ay;
    const e1z = p[kb + 2]! - az;
    const e2x = p[kc]! - ax;
    const e2y = p[kc + 1]! - ay;
    const e2z = p[kc + 2]! - az;
    let Nx = e1y * e2z - e1z * e2y;
    let Ny = e1z * e2x - e1x * e2z;
    let Nz = e1x * e2y - e1y * e2x;
    const nl = sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
    if (nl < 1e-12) return;
    const sg = -this.side / nl;
    Nx *= sg;
    Ny *= sg;
    Nz *= sg;
    const qx = this.bx - ax;
    const qy = this.by - ay;
    const qz = this.bz - az;
    const C = this.br + 0.0015 - (Nx * qx + Ny * qy + Nz * qz);
    if (C <= this.tC || C > this.br + this.spec.maxTravel) return;
    // Barycentric coordinates of the centre's projection onto the plane (a little slack round the edges so
    // neighbouring triangles overlap).
    const d00 = e1x * e1x + e1y * e1y + e1z * e1z;
    const d01 = e1x * e2x + e1y * e2y + e1z * e2z;
    const d11 = e2x * e2x + e2y * e2y + e2z * e2z;
    const d20 = qx * e1x + qy * e1y + qz * e1z;
    const d21 = qx * e2x + qy * e2y + qz * e2z;
    const den = d00 * d11 - d01 * d01;
    if (den < 1e-18) return;
    let u = (d11 * d20 - d01 * d21) / den;
    let t = (d00 * d21 - d01 * d20) / den;
    if (u < -0.1 || t < -0.1 || u + t > 1.1) return;
    if (u < 0) u = 0;
    if (t < 0) t = 0;
    const st = u + t;
    if (st > 1) { u /= st; t /= st; }
    this.tC = C;
    this.ta = a;
    this.tb = b;
    this.tc = c;
    this.wa = 1 - u - t;
    this.wb = u;
    this.wc = t;
    this.nx_ = Nx;
    this.ny_ = Ny;
    this.nz_ = Nz;
    this.cj = row;
  }

  /**
   * The cell under the ball's x-y (into ci, cj): column from x at rest, row from the knots' heights now, then
   * the column nudged to where the knots are. False above the cable or beyond the posts.
   */
  private findCell(loose: boolean): boolean {
    const p = this.pos;
    const nx = this.nx;
    const R = this.rows;
    const bx = this.bx;
    const by = this.by;
    if (bx <= -this.halfW || bx >= this.halfW) return false;
    this.qx = bx;
    this.cableAt();
    if (by >= this.cy) return false; // above the cable: only the cable can touch it
    let i = clampI(((bx + this.halfW) / this.dx) | 0, 0, this.cols - 1);
    let j = -1;
    for (let pass = 0; pass < 3; pass++) {
      j = -1;
      for (let r = 0; r < R; r++) {
        const yt = 0.5 * (p[(r * nx + i) * 3 + 1]! + p[(r * nx + i + 1) * 3 + 1]!);
        const yb = 0.5 * (p[((r + 1) * nx + i) * 3 + 1]! + p[((r + 1) * nx + i + 1) * 3 + 1]!);
        if (by <= yt && by > yb) { j = r; break; }
      }
      // Not between two rows: above the top row's chord (under the cable) or under the bottom edge, which is
      // bound and swings but does not let a ball under it: the end cell's plane carries on. `loose` takes any
      // height below as the bottom cell (the 3D search round it decides whether anything touches).
      if (j < 0) {
        if (by > p[i * 3 + 1]! - 0.05) j = 0;
        else if (loose || by > p[(R * nx + i) * 3 + 1]! - this.br - 0.05) j = R - 1;
        else return false;
      }
      const xl = 0.5 * (p[(j * nx + i) * 3]! + p[((j + 1) * nx + i) * 3]!);
      const xr = 0.5 * (p[(j * nx + i + 1) * 3]! + p[((j + 1) * nx + i + 1) * 3]!);
      if (bx < xl && i > 0) i--;
      else if (bx > xr && i < this.cols - 1) i++;
      else break;
    }
    this.ci = i;
    this.cj = j;
    return true;
  }

  /** Barycentric weights of the ball's x-y in triangle (a, b, c), into wa wb wc and ta tb tc. */
  private tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3]!;
    const ay = p[a * 3 + 1]!;
    const v0x = p[b * 3]! - ax;
    const v0y = p[b * 3 + 1]! - ay;
    const v1x = p[c * 3]! - ax;
    const v1y = p[c * 3 + 1]! - ay;
    const v2x = this.bx - ax;
    const v2y = this.by - ay;
    const den = v0x * v1y - v1x * v0y;
    this.ta = a;
    this.tb = b;
    this.tc = c;
    if (abs(den) < 1e-14) { this.wa = -1; this.wb = 0; this.wc = 0; return; }
    const u = (v2x * v1y - v1x * v2y) / den;
    const t = (v0x * v2y - v2x * v0y) / den;
    this.wa = 1 - u - t;
    this.wb = u;
    this.wc = t;
  }

  /** The ball against the cable (a capsule along the top knots); pushes both apart if `apply`. */
  private contactCable(apply: boolean): boolean {
    const p = this.pos;
    const bx = this.bx;
    if (bx < -this.halfW - this.br || bx > this.halfW + this.br) return false;
    const R = this.br + this.spec.cableRadius;
    const i0 = clampI(((bx + this.halfW) / this.dx) | 0, 0, this.cols - 1);
    let best = 0;
    let found = false;
    for (let i = max(0, i0 - 1); i <= min(this.cols - 1, i0 + 1); i++) {
      const ka = i * 3;
      const kb = ka + 3;
      const sx = p[kb]! - p[ka]!;
      const sy = p[kb + 1]! - p[ka + 1]!;
      const sz = p[kb + 2]! - p[ka + 2]!;
      const qx = bx - p[ka]!;
      const qy = this.by - p[ka + 1]!;
      const qz = this.bz - p[ka + 2]!;
      const ss = sx * sx + sy * sy + sz * sz;
      let t = ss > 1e-12 ? (qx * sx + qy * sy + qz * sz) / ss : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = qx - sx * t;
      const dy = qy - sy * t;
      const dz = qz - sz * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R * R && (!found || d2 < best)) {
        found = true;
        best = d2;
        this.ca = i;
        this.cb = i + 1;
        this.ct = t;
      }
    }
    if (!found) return false;
    if (!apply) return true;
    const ka = this.ca * 3;
    const kb = this.cb * 3;
    const t = this.ct;
    const qx = p[ka]! + (p[kb]! - p[ka]!) * t;
    const qy = p[ka + 1]! + (p[kb + 1]! - p[ka + 1]!) * t;
    const qz = p[ka + 2]! + (p[kb + 2]! - p[ka + 2]!) * t;
    let dx = this.bx - qx;
    let dy = this.by - qy;
    let dz = this.bz - qz;
    let d = sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) { dx = 0; dy = 1; dz = 0; d = 1; }
    const Nx = dx / d;
    const Ny = dy / d;
    const Nz = dz / d;
    const C = R - (d === 1 && dy === 1 ? 0 : d);
    const w = this.w;
    const wa = w[this.ca]!;
    const wb = w[this.cb]!;
    const W = this.bw + (1 - t) * (1 - t) * wa + t * t * wb;
    const lam = C / W;
    const v = this.vel;
    const vrx = this.bvx - ((1 - t) * v[ka]! + t * v[kb]!);
    const vry = this.bvy - ((1 - t) * v[ka + 1]! + t * v[kb + 1]!);
    const vrz = this.bvz - ((1 - t) * v[ka + 2]! + t * v[kb + 2]!);
    this.vnPreCable = Nx * vrx + Ny * vry + Nz * vrz;
    this.bx += Nx * lam * this.bw;
    this.by += Ny * lam * this.bw;
    this.bz += Nz * lam * this.bw;
    const fa = lam * (1 - t) * wa;
    const fb = lam * t * wb;
    p[ka] = p[ka]! - Nx * fa; p[ka + 1] = p[ka + 1]! - Ny * fa; p[ka + 2] = p[ka + 2]! - Nz * fa;
    p[kb] = p[kb]! - Nx * fb; p[kb + 1] = p[kb + 1]! - Ny * fb; p[kb + 2] = p[kb + 2]! - Nz * fb;
    this.cnx = Nx;
    this.cny = Ny;
    this.cnz = Nz;
    this.lamCable += lam;
    if (!this.touchBody && !this.touchCable) this.touchSpeed = max(0, -this.vnPreCable);
    return true;
  }

  /** After the netting stopped the ball: a little bounce (more off the tape band) and the twine's grip. */
  private bodyVelocity(): void {
    const v = this.vel;
    const w = this.w;
    const ka = this.ta * 3;
    const kb = this.tb * 3;
    const kc = this.tc * 3;
    const wa = this.wa;
    const wb = this.wb;
    const wc = this.wc;
    const Nx = this.nx_;
    const Ny = this.ny_;
    const Nz = this.nz_;
    const W = this.bw + wa * wa * w[this.ta]! + wb * wb * w[this.tb]! + wc * wc * w[this.tc]!;
    const rx = this.bvx - (wa * v[ka]! + wb * v[kb]! + wc * v[kc]!);
    const ry = this.bvy - (wa * v[ka + 1]! + wb * v[kb + 1]! + wc * v[kc + 1]!);
    const rz = this.bvz - (wa * v[ka + 2]! + wb * v[kb + 2]! + wc * v[kc + 2]!);
    const vn = Nx * rx + Ny * ry + Nz * rz;
    const e = this.touchRow === 0 ? this.spec.tapeRestitution : this.spec.restitution;
    let jn = 0;
    if (this.vnPreBody < -0.3) {
      const target = -e * this.vnPreBody;
      if (vn < target) jn = (target - vn) / W;
    }
    this.applyBody(Nx * jn, Ny * jn, Nz * jn);
    // Friction: the twine grips the felt, up to mu times the push, at the contact point (spin included).
    this.nx_ = Nx; this.ny_ = Ny; this.nz_ = Nz;
    this.cW = W;
    this.cMu = this.spec.friction * (this.lamBody / this.h + jn);
    this.srx = rx;
    this.sry = ry;
    this.srz = rz;
    this.slip();
    this.applyBody(this.fx, this.fy, this.fz);
  }

  // Friction scratch: contact normal in nx_.., effective inverse mass cW, impulse limit cMu; result fx fy fz.
  private cW = 0;
  private cMu = 0;
  private fx = 0;
  private fy = 0;
  private fz = 0;

  /**
   * The friction impulse on the ball at its contact point (relative centre velocity rx ry rz plus the spin's
   * w x (-r N)), opposing the slip, at most cMu: into fx fy fz. Turns the ball's spin by the same impulse
   * (dw = (-r N) x J / I).
   */
  private srx = 0;
  private sry = 0;
  private srz = 0;

  private slip(): void {
    const rx = this.srx;
    const ry = this.sry;
    const rz = this.srz;
    const Nx = this.nx_;
    const Ny = this.ny_;
    const Nz = this.nz_;
    const r = this.br;
    // Contact point velocity: v + w x (-r N).
    const cx = rx - r * (this.bsy * Nz - this.bsz * Ny);
    const cy = ry - r * (this.bsz * Nx - this.bsx * Nz);
    const cz = rz - r * (this.bsx * Ny - this.bsy * Nx);
    const vn = Nx * cx + Ny * cy + Nz * cz;
    const tx = cx - vn * Nx;
    const ty = cy - vn * Ny;
    const tz = cz - vn * Nz;
    const vt = sqrt(tx * tx + ty * ty + tz * tz);
    this.fx = 0;
    this.fy = 0;
    this.fz = 0;
    if (vt < 1e-6 || this.cMu <= 0) return;
    // A tangential impulse moves the contact point by (1/m + r^2/I) on the ball, plus the net's share.
    const Wt = this.cW + this.bw / this.balpha;
    const jw = vt / Wt;
    const j = (jw < this.cMu ? jw : this.cMu) / vt;
    this.fx = -tx * j;
    this.fy = -ty * j;
    this.fz = -tz * j;
    // Spin: dw = (-r N) x J / (alpha m r^2) = -(N x J) bw / (alpha r).
    const k = -this.bw / (this.balpha * r);
    this.bsx += k * (Ny * this.fz - Nz * this.fy);
    this.bsy += k * (Nz * this.fx - Nx * this.fz);
    this.bsz += k * (Nx * this.fy - Ny * this.fx);
  }

  private applyBody(jx: number, jy: number, jz: number): void {
    const v = this.vel;
    const w = this.w;
    this.bvx += jx * this.bw;
    this.bvy += jy * this.bw;
    this.bvz += jz * this.bw;
    const ka = this.ta * 3;
    const kb = this.tb * 3;
    const kc = this.tc * 3;
    const fa = this.wa * w[this.ta]!;
    const fb = this.wb * w[this.tb]!;
    const fc = this.wc * w[this.tc]!;
    v[ka] = v[ka]! - jx * fa; v[ka + 1] = v[ka + 1]! - jy * fa; v[ka + 2] = v[ka + 2]! - jz * fa;
    v[kb] = v[kb]! - jx * fb; v[kb + 1] = v[kb + 1]! - jy * fb; v[kb + 2] = v[kb + 2]! - jz * fb;
    v[kc] = v[kc]! - jx * fc; v[kc + 1] = v[kc + 1]! - jy * fc; v[kc + 2] = v[kc + 2]! - jz * fc;
  }

  /** Off the cable: the tape over steel kicks the ball back a little and slips on it. */
  private cableVelocity(): void {
    const v = this.vel;
    const w = this.w;
    const ka = this.ca * 3;
    const kb = this.cb * 3;
    const t = this.ct;
    const wa = w[this.ca]!;
    const wb = w[this.cb]!;
    const W = this.bw + (1 - t) * (1 - t) * wa + t * t * wb;
    const Nx = this.cnx;
    const Ny = this.cny;
    const Nz = this.cnz;
    const rx = this.bvx - ((1 - t) * v[ka]! + t * v[kb]!);
    const ry = this.bvy - ((1 - t) * v[ka + 1]! + t * v[kb + 1]!);
    const rz = this.bvz - ((1 - t) * v[ka + 2]! + t * v[kb + 2]!);
    const vn = Nx * rx + Ny * ry + Nz * rz;
    let jn = 0;
    if (this.vnPreCable < -0.3) {
      const target = -this.spec.cableRestitution * this.vnPreCable;
      if (vn < target) jn = (target - vn) / W;
    }
    this.nx_ = Nx; this.ny_ = Ny; this.nz_ = Nz;
    this.cW = W;
    this.cMu = this.spec.cableFriction * (this.lamCable / this.h + jn);
    this.srx = rx + Nx * jn * W;
    this.sry = ry + Ny * jn * W;
    this.srz = rz + Nz * jn * W;
    this.slip();
    const jx = Nx * jn + this.fx;
    const jy = Ny * jn + this.fy;
    const jz = Nz * jn + this.fz;
    this.bvx += jx * this.bw;
    this.bvy += jy * this.bw;
    this.bvz += jz * this.bw;
    const fa = (1 - t) * wa;
    const fb = t * wb;
    v[ka] = v[ka]! - jx * fa; v[ka + 1] = v[ka + 1]! - jy * fa; v[ka + 2] = v[ka + 2]! - jz * fa;
    v[kb] = v[kb]! - jx * fb; v[kb + 1] = v[kb + 1]! - jy * fb; v[kb + 2] = v[kb + 2]! - jz * fb;
  }

  /** z of the netting at the ball's x-y (bx, by), or of the cable above it; 0 beyond the posts. */
  surfaceZ(): number {
    if (!this.awake) return 0;
    if (!this.locate()) {
      if (this.bx <= -this.halfW || this.bx >= this.halfW) return 0;
      this.qx = this.bx;
      this.cableAt();
      return this.cz;
    }
    const p = this.pos;
    return this.wa * p[this.ta * 3 + 2]! + this.wb * p[this.tb * 3 + 2]! + this.wc * p[this.tc * 3 + 2]!;
  }

  hashInto(h: Hasher): void {
    h.num(this.awake ? 1 : 0).num(this.quiet);
    if (!this.awake) return;
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < p.length; i++) h.num(p[i]!).num(v[i]!);
  }

  /** Put the net back at rest (new match / tests). */
  reset(): void {
    this.pos.set(this.rest);
    this.prev.set(this.rest);
    this.vel.fill(0);
    this.awake = false;
    this.quiet = 0;
    this.measureBulge();
  }
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
