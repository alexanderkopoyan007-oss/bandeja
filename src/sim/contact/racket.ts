// The racket as a rigid body meeting the ball (docs/realism.md, data/rackets.json).
//
// Normal direction: a free racket at rest returns the ball at the apparent COR
//   ea = (e - r) / (1 + r),   r = (m / M) (1 + M b^2 / I_cm + M x^2 / I_polar)
// (m ball, M racket, b the impact's distance from the centre of mass along the face, x across it; e the true
// ball-racket COR, falling with impact speed). The hand barely matters in a 4-5 ms contact (4% measured), so a
// moving racket is a racket at rest in its own frame: the ball leaves the face at V.n + ea u, where u is the
// approach speed. Ball out = ea v_in + (1 + ea) V along the normal, so a hard incoming ball comes back faster off
// the same swing.
//
// Along the face: friction. The contact point's slip is reversed by tangentialE when the ball grips; the impulse
// is at most friction x the normal impulse (it slides). The friction impulse turns the ball's spin.
//
// Off-centre: the impulse twists the racket about its long axis (x) and rocks it about the cross axis (b); by the
// time the ball leaves, the face has turned (a fraction `twist` of its end-of-contact angle), which turns the ball
// towards the side it was hit on.
//
// The inverse (swing) finds the face normal and the face velocity that send a ball out with a wanted velocity and
// spin: the impulse is fixed by the change of velocity, and the spin it can give fixes how the face is tilted
// against that impulse (spin change = -(1 / (alpha r)) n x dv), within the friction cone.
import { V3 } from '../core/v3.ts';
import { clamp, max, sqrt } from '../core/smath.ts';
import racketData from '../../../data/rackets.json' with { type: 'json' };

export interface RacketSpec {
  name: string;
  mass: number;
  length: number;
  balance: number;
  iCm: number;
  iPolar: number;
  e17: number;
  eSlope: number;
  eMin: number;
  eMax: number;
  friction: number;
  tangentialE: number;
  dwell: number;
  twist: number;
  headLength: number;
  headWidth: number;
}

export const RACKETS = racketData as unknown as Record<string, RacketSpec>;

const xh = new V3();
const ax = new V3();
const ne = new V3();
const rel = new V3();
const c = new V3();
const rc = new V3();
const jt = new V3();
const tmp = new V3();
const dv = new V3();
const k = new V3();
const want = new V3();
const wantW = new V3();
const gotV = new V3();
const gotW = new V3();

export class Racket {
  readonly spec: RacketSpec;
  /** Centre of mass, measured from the tip (m). */
  readonly comFromTip: number;
  private readonly m: number;
  private readonly R: number;
  private readonly alpha: number;
  private readonly iBall: number;
  /** Sine of the friction cone's half angle (a little inside it). */
  private readonly cone: number;

  // Results of the last impact() / swing().
  /** Apparent COR and approach speed of the last impact. */
  ea = 0;
  u = 0;
  /** Normal impulse of the last impact (N s). */
  jn = 0;
  /** The ball slid on the face (friction-limited) rather than gripping. */
  slid = false;
  /** swing(): the spin wanted was more than the face can give within friction (it gives the most it can). */
  spinLimited = false;
  /**
   * swing(): the spread of the hitter's contact point (m, along and across the face). The swing is made for the
   * apparent COR they get on average, not at the planned point: a player swings for the contact they usually
   * make, so off-centre hits scatter both ways round the target instead of all falling short.
   */
  spreadAlong = 0;
  spreadAcross = 0;

  constructor(spec: RacketSpec, ballMass: number, ballRadius: number, alpha: number) {
    this.spec = spec;
    this.comFromTip = spec.length - spec.balance;
    this.m = ballMass;
    this.R = ballRadius;
    this.alpha = alpha;
    this.iBall = alpha * ballMass * ballRadius * ballRadius;
    this.cone = (spec.friction / sqrt(1 + spec.friction * spec.friction)) * 0.98;
  }

  /** True COR of ball on face at approach speed u (m/s). */
  cor(u: number): number {
    const s = this.spec;
    return clamp(s.e17 - s.eSlope * (u - 17), s.eMin, s.eMax);
  }

  /** Apparent COR of a free racket at rest, ball arriving at u, at fromTip along the face and x across it. */
  acor(u: number, fromTip: number, x: number): number {
    this.qU = u;
    this.qTip = fromTip;
    this.qX = x;
    this.acorQ();
    return this.qEa;
  }

  // acorQ()'s arguments and result (fields: this runs dozens of times a strike, and doubles passed to or
  // returned from a method that is not inlined are boxed).
  private qU = 0;
  private qTip = 0;
  private qX = 0;
  private qEa = 0;

  private acorQ(): void {
    const s = this.spec;
    const b = this.comFromTip - this.qTip;
    const x = this.qX;
    const r = (this.m / s.mass) * (1 + (s.mass * b * b) / s.iCm + (s.mass * x * x) / s.iPolar);
    const e = clamp(s.e17 - s.eSlope * (this.qU - 17), s.eMin, s.eMax);
    this.qEa = (e - r) / (1 + r);
  }

  /**
   * Average apparent COR over the contact spread (spreadAlong, spreadAcross) round qTip on the axis, at qU:
   * into qEa. The surface is quadratic, so its mean over a spread sigma is the value at sigma across (it is
   * symmetric) and the mean of the two sides at sigma along.
   */
  private meanAcorQ(): void {
    const a = this.spreadAlong;
    const tip = this.qTip;
    this.qX = 0;
    this.acorQ();
    const e0 = this.qEa;
    if (a === 0 && this.spreadAcross === 0) return;
    this.qX = this.spreadAcross;
    this.acorQ();
    const ec = this.qEa;
    this.qX = 0;
    this.qTip = tip + a;
    this.acorQ();
    const e1 = this.qEa;
    this.qTip = tip - a;
    this.acorQ();
    const e2 = this.qEa;
    this.qTip = tip;
    this.qEa = ec + 0.5 * (e1 + e2) - e0;
  }

  /** Is (fromTip, x) on the hitting face (an ellipse headLength x headWidth from the tip)? */
  onFace(fromTip: number, x: number): boolean {
    const s = this.spec;
    const hl = s.headLength * 0.5;
    const dy = (fromTip - hl) / hl;
    const dx = x / (s.headWidth * 0.5);
    return dy * dy + dx * dx <= 1;
  }

  /**
   * The ball (v, w) meets the face: normal n (unit, out of the face towards where the ball goes), the face's
   * velocity V at the impact point, long axis a (handle to tip), impact at fromTip along the face and x across
   * it (x > 0 on the side a x n points to). Writes the ball's velocity and spin after the impact.
   */
  impact(v: V3, w: V3, n: V3, V: V3, a: V3, fromTip: number, x: number, vOut: V3, wOut: V3): void {
    const s = this.spec;
    const m = this.m;
    // Long axis square to the face, and the cross axis.
    ax.copy(a).addScaled(n, -a.dot(n));
    ax.scale(1 / max(1e-9, ax.length()));
    xh.crossOf(ax, n);
    rel.copy(V).addScaled(v, -1);
    let u = rel.dot(n);
    this.u = u;
    if (u <= 0) {
      // The face never catches it.
      vOut.copy(v);
      wOut.copy(w);
      this.jn = 0;
      this.ea = 0;
      return;
    }
    this.qU = u;
    this.qTip = fromTip;
    this.qX = x;
    this.acorQ();
    let ea = this.qEa;
    let jn = m * (1 + ea) * u;
    // The face turns under the impulse while the ball is on it: twist about the long axis (x), rock about the
    // cross axis (b). Turning by t about a tilts n by t (a x n) = t xh; by t about xh tilts it by -t a.
    const b = this.comFromTip - fromTip;
    const k1 = s.twist * s.dwell;
    const ta = ((x * jn) / s.iPolar) * k1;
    const tx = ((-b * jn) / s.iCm) * k1;
    ne.copy(n).addScaled(xh, ta).addScaled(ax, -tx);
    ne.scale(1 / ne.length());
    u = rel.dot(ne);
    if (u <= 0) u = 1e-3;
    this.qU = u;
    this.acorQ();
    ea = this.qEa;
    jn = m * (1 + ea) * u;
    this.u = u;
    this.ea = ea;
    this.jn = jn;

    // Normal: the ball leaves at V.n + ea u.
    vOut.copy(v).addScaled(ne, jn / m);

    // Along the face: slip of the contact point, c = (v - V)_t + w x (-R n).
    c.copy(rel).scale(-1);
    c.addScaled(ne, -c.dot(ne));
    rc.copy(ne).scale(-this.R);
    tmp.crossOf(w, rc);
    c.add(tmp);
    const kg = ((1 + s.tangentialE) * m * this.alpha) / (1 + this.alpha);
    jt.copy(c).scale(-kg);
    const jl = jt.length();
    const lim = s.friction * jn;
    this.slid = jl > lim;
    if (this.slid) jt.scale(lim / jl);
    vOut.addScaled(jt, 1 / m);
    tmp.crossOf(rc, jt);
    wOut.copy(w).addScaled(tmp, 1 / this.iBall);
  }

  /**
   * The swing that sends a ball arriving with (v, w) out with (vWant, wWant), hitting at fromTip on the long axis
   * a: writes the face normal and the face velocity at the impact point. The spin it can give is limited by the
   * friction cone (spinLimited). Refined against impact() so the face's turn on the ball is allowed for.
   */
  swing(v: V3, w: V3, vWant: V3, wWant: V3, a: V3, fromTip: number, outN: V3, outV: V3): void {
    want.copy(vWant);
    wantW.copy(wWant);
    this.spinLimited = false;
    let limited = false;
    for (let it = 0; it < 4; it++) {
      this.solveSwing(v, w, want, wantW, a, fromTip, outN, outV);
      limited = limited || this.spinLimited;
      // Check through the forward impact and aim off the miss (velocity only: the spin follows the face).
      this.impact(v, w, outN, outV, a, fromTip, 0, gotV, gotW);
      want.add(tmp.copy(vWant).addScaled(gotV, -1));
    }
    this.spinLimited = limited;
  }

  private solveSwing(v: V3, w: V3, vWant: V3, wWant: V3, a: V3, fromTip: number, outN: V3, outV: V3): void {
    const s = this.spec;
    const m = this.m;
    const R = this.R;
    dv.copy(vWant).addScaled(v, -1);
    const dl = dv.length();
    if (dl < 1e-6) {
      outN.copy(v).scale(-1 / max(1e-9, v.length()));
      outV.set(0, 0, 0);
      return;
    }
    // n x dv = K = -alpha R (w' - w), K square to dv, |K| within the friction cone: tan of the face's tilt
    // against the impulse <= friction.
    k.copy(wWant).addScaled(w, -1).scale(-this.alpha * R);
    k.addScaled(dv, -k.dot(dv) / (dl * dl));
    const kl = k.length();
    const kmax = dl * this.cone;
    this.spinLimited = kl > kmax;
    if (this.spinLimited) k.scale(kmax / kl);
    // n = (dv x K) / |dv|^2 + lambda dv / |dv|.
    outN.crossOf(dv, k).scale(1 / (dl * dl));
    const lam = sqrt(max(0, 1 - outN.lengthSq()));
    outN.addScaled(dv, lam / dl);
    outN.scale(1 / outN.length());
    // Normal impulse and the approach speed that gives it: m (1 + ea(u)) u = jn.
    const jn = m * dv.dot(outN);
    let u = jn / (m * 1.4);
    this.qTip = fromTip;
    for (let i = 0; i < 6; i++) {
      this.qU = u;
      this.meanAcorQ();
      u = jn / (m * (1 + this.qEa));
    }
    // Face velocity: along n from the approach speed; along the face from the slip the impulse needs when the
    // ball grips: jt = -kg c.
    jt.copy(dv).addScaled(outN, -dv.dot(outN)).scale(m);
    const kg = ((1 + s.tangentialE) * m * this.alpha) / (1 + this.alpha);
    // c = (v - V)_t + w x (-R n)  =>  V_t = v_t + (w x (-R n)) - c, with c = -jt / kg.
    rc.copy(outN).scale(-R);
    tmp.crossOf(w, rc);
    outV.copy(v).addScaled(outN, -v.dot(outN));
    outV.add(tmp).addScaled(jt, 1 / kg);
    outV.addScaled(outN, v.dot(outN) + u);
    // The face rocks back on the impulse (impact point off the centre of mass along the face): tilt it the other
    // way beforehand so it is square to outN while the ball leaves.
    ax.copy(a).addScaled(outN, -a.dot(outN));
    ax.scale(1 / max(1e-9, ax.length()));
    const b = this.comFromTip - fromTip;
    this.qU = u;
    this.qX = 0;
    this.acorQ();
    const jn2 = m * (1 + this.qEa) * u;
    outN.addScaled(ax, (-b * jn2 * s.twist * s.dwell) / s.iCm);
    outN.scale(1 / outN.length());
  }
}

/** Face half-width (m) at fromTip on an elliptic head: where an impact still hits the face. */
export function faceHalfWidth(spec: RacketSpec, fromTip: number): number {
  const hl = spec.headLength * 0.5;
  const dy = (fromTip - hl) / hl;
  const f = 1 - dy * dy;
  return f > 0 ? spec.headWidth * 0.5 * sqrt(f) : 0;
}
