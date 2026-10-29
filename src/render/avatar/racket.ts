// The padel racket as drawn (render only; the sim's racket is data/rackets.json). Racket frame: the origin is the
// face centre, +y runs to the tip, +z is the face normal, x across the face.
//
// Built to the FIP limits (Rules of Padel, Annex: 45.5 cm long at most, 26 cm wide, 38 mm thick, holes 9-13 mm) and to
// how a current racket is made: two thin carbon or glass skins over an EVA core inside a tubular frame. The tip is
// 14.5 cm above the face centre and the butt 31 cm below it (as rackets.json has them) for every shape. Each player
// has their own racket (data/racket-looks/p*.json): shape (round, teardrop, diamond), throat, holes and graphics.
//
// One racket is one mesh (one draw call) plus the wrist cord, with a level of detail for the broadcast camera:
// - the frame's tube: a rounded profile swept round the outline (cut open where the neck goes into the finishing
//   tape) and round the throat's opening, lacquered by the look's frame finish (gloss, satin or matte), its sides
//   printed from their own texture (racketArt.ts: the type along each side and the protector's print);
// - the faces: flat, a hair below the frame's band (a crisp edge), matte with a gritty finish (racketMaterial.ts),
//   printed with the racket's graphic (racketArt.ts; mirrored on the back so it reads the same from either side);
// - the holes: a designed layout (rows following the outline, a grid inside, blank zones under the type), each with a
//   chamfer showing the print and a wall that shows the core: light foam between two thin skins;
// - the protector over the top of the frame, a little raised, solid or translucent, printed, its ends bevelled;
// - the handle: overgrip wound in an overlapping spiral (a real step at each turn), a finishing tape that flares from
//   the grip into the neck's own section and closes round it, the butt cap with a logo plate on its end, and the
//   wrist cord (a flat braided strap with its slider) through it.
// The near level is 13-14.4k triangles (with the cord under 15k); the far one (about 1.7k, no through-holes: sub-pixel
// holes shimmer; the mask paints them in a hole's tone instead) is used when the racket is small on screen
// (`RacketLod`).
import * as THREE from 'three/webgpu';
import p1 from '../../../data/racket-looks/p1.json' with { type: 'json' };
import p2 from '../../../data/racket-looks/p2.json' with { type: 'json' };
import p3 from '../../../data/racket-looks/p3.json' with { type: 'json' };
import p4 from '../../../data/racket-looks/p4.json' with { type: 'json' };
import { racketArt, sideLayout, ART, type ArtShape } from './racketArt.ts';
import { racketMaterial, cordMaterial } from './racketMaterial.ts';

/** Distances along the racket (m, from the face centre). */
export const RACKET_TIP = 0.145;
export const RACKET_BUTT = -0.31;
/** Where the handle (the round grip) starts and the butt cap begins. */
export const HANDLE_TOP = -0.168;
export const CAP_TOP = -0.295;
/** Handle radius over the overgrip at the top and at the butt (an 11 cm grip, slightly thicker towards the cap). */
export const HANDLE_R = 0.0172;
const HANDLE_R_BUTT = 0.0178;
/**
 * Half the frame's thickness: faces at +-T2. 37 mm, and the protector lies 0.45 mm thick on each face's band, so the
 * racket is 37.9 mm at its thickest: the 38 mm every racket is sold as (FIP allows 38).
 */
export const FACE_T2 = 0.0185;
const T2 = FACE_T2;
/** The faces sit this far below the frame's band (the crisp edge where the face meets the frame). */
export const FACE_STEP = 0.0004;
/** The core's skins: carbon or glass layers each side of the foam (m). */
export const SKIN_T = 0.0016;
/** Hole chamfer (m, 45 degrees). */
const CHAMFER = 0.0007;
/** The frame seen from the face: the band from the outline to the face (m), and the rounded edge's share of it. */
const RIM_W = 0.0135;
const RC = 0.009;
/** The arms either side of the throat's opening (m) and the opening's rounded edge. */
const ARM_W = 0.0175;
const RC_H = 0.006;
/** The bridge (the frame across the bottom of the face, over the throat's opening). */
const BRIDGE_W = 0.015;
/** Superellipse exponent of the frame's profile (2 = an ellipse; higher is squarer). */
const PROFILE_E = 2.4;
/** The neck where the arms meet the handle (half width, the bottom of the neck inside the finishing tape). */
const NECK_W = 0.015;
const NECK_Y = HANDLE_TOP - 0.004;
/**
 * Finishing tape over the top of the grip and the neck: round on the overgrip, flaring into the neck's own section
 * (a rounded rectangle, narrower across than the grip and thicker through it) and ending on the neck at TAPE_Y1. The
 * frame stops NECK_CUT inside it, so the neck never comes through the tape.
 */
export const TAPE_Y0 = -0.19;
export const TAPE_Y1 = -0.1635;
const NECK_CUT = TAPE_Y1 - 0.002;
/** How thick the tape lies on the neck (m). */
const TAPE_T = 0.0004;
/** Overgrip: axial advance per turn, the step at each turn (m). */
export const GRIP_PITCH = 0.0165;
const GRIP_STEP = 0.0007;
export const GRIP_Y0 = CAP_TOP - 0.003;
/**
 * Protector: how far it stands off the frame round the outside and on the faces' band, how far it reaches onto the
 * band past the rounded edge, its lip's height over the band and the ramp at each end (m).
 */
const BUMPER_T = 0.0009;
const BUMPER_TF = 0.00045;
const BUMPER_LIP = 0.0025;
const BUMPER_EDGE = 0.0002;
const BUMPER_RAMP = 0.016;
/** The frame's outline tops out under the protector, so the racket with it is RACKET_TIP long above the centre. */
const OUTLINE_TIP = RACKET_TIP - BUMPER_T;

/** Region codes the material reads (rkInfo.x). Every triangle is one region. */
export const RK_FACE = 0, RK_FRAME = 1, RK_WALL = 2, RK_BUMPER = 3, RK_GRIP = 4, RK_TAPE = 5, RK_CAP = 6, RK_LOGO = 7, RK_FACE_FAR = 8, RK_CHAMFER = 9;
/** Sides of each hole (its chamfers and wall). */
export const HOLE_SIDES = 14;

export interface RacketLook {
  name: string;
  model: string;
  line: string;
  shape: string;
  throat: string;
  balance: number;
  weight: number;
  art: string;
  colours: { base: string; a: string; b: string; c: string; text: string; frame: string; accent: string };
  finish: string;
  /** The frame's lacquer: gloss, satin or matte. */
  frameFinish: string;
  foam: string;
  skin: string;
  bumper: { colour: string; clear: number; span: number };
  grip: string;
  tape: string;
  cap: string;
  cord: string;
  holes: { d: number; pitch: number; rings: number; margin: number; blank: Array<{ x: number; y: number; a: number; b: number; rot: number }> };
}

/** The players' rackets, by player number (as the people are: data/players/p*.json). */
export const RACKET_LOOKS: RacketLook[] = [p1, p2, p3, p4] as RacketLook[];

export function racketLookFor(idx: number): RacketLook {
  return RACKET_LOOKS[((idx % RACKET_LOOKS.length) + RACKET_LOOKS.length) % RACKET_LOOKS.length]!;
}

// ---------------------------------------------------------------------------------------------------------------
// Outlines (2D, metres in the face plane).

type V2 = [number, number];

/** Centripetal Catmull-Rom through `pts`, `per` samples per span (the ends repeat their neighbours' mirror). */
function catmull(pts: V2[], per: number, first: V2, last: V2): V2[] {
  const P = [first, ...pts, last];
  const out: V2[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1]!, q1 = P[i]!, q2 = P[i + 1]!, p3 = P[i + 2]!;
    const d = (a: V2, b: V2): number => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + d(p0, q1), t2 = t1 + d(q1, q2), t3 = t2 + d(q2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const L = (a: V2, b: V2, ta: number, tb: number): V2 => {
        const u = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      };
      const A1 = L(p0, q1, t0, t1), A2 = L(q1, q2, t1, t2), A3 = L(q2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * The head's right half from the tip down to where the arm leaves it, by shape. Round: the ellipse of a classic
 * round racket (26 x 28 cm, widest at the face centre). Teardrop: widest 4 cm above the face centre, a broad flat
 * crown, then a long straight taper into the throat (narrower low down than a round head by 2-3 cm a side).
 * Diamond: widest 5.5 cm up, broad flat shoulders, near-straight sides down to the throat (the head-heavy attacking
 * shape).
 */
/** Scale a half outline across so its widest point is 12.99 cm out (26 cm wide at most: FIP). */
function widest(half: V2[]): V2[] {
  let mx = 0;
  for (const p of half) mx = Math.max(mx, p[0]);
  const k = 0.1299 / mx;
  return half.map((p) => [p[0] * k, p[1]] as V2);
}

function headHalf(shape: string): V2[] {
  const T = OUTLINE_TIP;
  if (shape === 'teardrop') {
    const c: V2[] = [[0, T], [0.058, T - 0.0042], [0.099, 0.12], [0.1215, 0.088], [0.1298, 0.048], [0.1265, 0.014],
      [0.1155, -0.022], [0.099, -0.056], [0.081, -0.085]];
    return widest(catmull(c, 14, [-0.058, T - 0.0042], [0.064, -0.106]));
  }
  if (shape === 'diamond') {
    const c: V2[] = [[0, T], [0.05, T - 0.003], [0.09, 0.131], [0.116, 0.111], [0.1285, 0.084], [0.13, 0.055],
      [0.124, 0.02], [0.111, -0.02], [0.097, -0.054], [0.084, -0.084]];
    return widest(catmull(c, 14, [-0.05, T - 0.003], [0.072, -0.105]));
  }
  const out: V2[] = [];
  const a = 0.13, b = 0.14, c = T - 0.14;
  const end = Math.acos((-0.086 - c) / b);
  for (let k = 0; k <= 110; k++) {
    const phi = end * (k / 110);
    out.push([a * Math.sin(phi), c + b * Math.cos(phi)]);
  }
  return out;
}

function lerp2(a: V2, b: V2, t: number): V2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Open pieces end to start, each joint rounded with a quadratic of radius about r (radii[i]: after piece i). */
function chainRounded(pieces: V2[][], radii: number[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pieces.length; i++) {
    let p = pieces[i]!;
    if (i > 0) p = trimStart(p, radii[i - 1]!);
    if (i < pieces.length - 1) p = trimEnd(p, radii[i]!);
    for (const q of p) out.push(q);
    if (i < pieces.length - 1) {
      const a = p[p.length - 1]!, c = pieces[i]![pieces[i]!.length - 1]!, b = trimStart(pieces[i + 1]!, radii[i]!)[0]!;
      for (let k = 1; k < 10; k++) {
        const t = k / 10, u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
      }
    }
  }
  return out;
}

function line(a: V2, b: V2, n: number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k <= n; k++) out.push(lerp2(a, b, k / n));
  return out;
}

/**
 * The silhouette, closed and counter-clockwise from the bottom of the neck: neck, right arm, head, left arm. The arms
 * are straight tubes from where they leave the head (a tight concave turn) to the neck (turning down into it), as
 * real throats are: a V whose opening is the heart.
 */
function outerDense(shape: string): V2[] {
  const head = headHalf(shape);
  const J = head[head.length - 1]!;
  // The neck runs straight up from inside the finishing tape and only turns out into the arms above the tape.
  const Bn: V2 = [NECK_W + 0.0005, NECK_Y + 0.021];
  const half = chainRounded([head, line(J, Bn, 40), line(Bn, [NECK_W, NECK_Y], 8)], [0.022, 0.0095]);
  const right: V2[] = [];
  for (let x = 0; x < NECK_W - 1e-4; x += 0.003) right.push([x, NECK_Y]);
  for (let k = half.length - 1; k >= 1; k--) right.push(half[k]!);
  // Right half from the bottom centre to just before the tip; the left half mirrors it back down.
  const out: V2[] = [...right, [0, OUTLINE_TIP]];
  for (let k = right.length - 1; k >= 1; k--) out.push([-right[k]![0], right[k]![1]]);
  return out;
}

function polyLength(pl: V2[], closed: boolean): number {
  let L = 0;
  for (let i = 1; i < pl.length; i++) L += Math.hypot(pl[i]![0] - pl[i - 1]![0], pl[i]![1] - pl[i - 1]![1]);
  if (closed) L += Math.hypot(pl[0]![0] - pl[pl.length - 1]![0], pl[0]![1] - pl[pl.length - 1]![1]);
  return L;
}

/**
 * `n` points along a polyline, spaced by arc length weighted by curvature (bends get more points): weight
 * 1 + `bend` x |turn per metre|. Closed loops keep their start point first.
 */
function resample(pl: V2[], n: number, closed: boolean, bend = 0.02): V2[] {
  const m = pl.length;
  const seg = closed ? m : m - 1;
  const w = new Float64Array(seg + 1);
  for (let i = 0; i < seg; i++) {
    const a = pl[i]!, b = pl[(i + 1) % m]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ia = closed ? (i - 1 + m) % m : Math.max(0, i - 1), ic = closed ? (i + 2) % m : Math.min(m - 1, i + 2);
    const pa = pl[ia]!, pc = pl[ic]!;
    const t1 = Math.atan2(b[1] - pa[1], b[0] - pa[0]), t2 = Math.atan2(pc[1] - a[1], pc[0] - a[0]);
    let dt = Math.abs(t2 - t1);
    if (dt > Math.PI) dt = 2 * Math.PI - dt;
    // Each radian of turn counts as `bend` cm of length.
    w[i + 1] = w[i]! + len + bend * dt * 0.01;
  }
  const total = w[seg]!;
  const out: V2[] = [];
  const count = closed ? n : n - 1;
  let j = 0;
  for (let k = 0; k <= count; k++) {
    if (closed && k === count) break;
    const target = (total * k) / count;
    while (j < seg - 1 && w[j + 1]! < target) j++;
    const u = (target - w[j]!) / Math.max(1e-12, w[j + 1]! - w[j]!);
    out.push(lerp2(pl[j]!, pl[(j + 1) % m]!, Math.min(1, Math.max(0, u))));
  }
  return out;
}

/** Unit normals to the left of the direction of travel (inward for a counter-clockwise loop). */
function leftNormals(pl: V2[], closed: boolean): V2[] {
  const m = pl.length;
  const out: V2[] = [];
  for (let i = 0; i < m; i++) {
    const a = pl[closed ? (i - 1 + m) % m : Math.max(0, i - 1)]!, b = pl[closed ? (i + 1) % m : Math.min(m - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    out.push([-dy / l, dx / l]);
  }
  return out;
}

function offsetBy(pl: V2[], nrm: V2[], d: number): V2[] {
  return pl.map((p, i) => [p[0] + nrm[i]![0] * d, p[1] + nrm[i]![1] * d] as V2);
}

/** Trim `d` of arc length off the start (or end) of an open polyline. */
function trimStart(pl: V2[], d: number): V2[] {
  let acc = 0;
  for (let i = 1; i < pl.length; i++) {
    const l = Math.hypot(pl[i]![0] - pl[i - 1]![0], pl[i]![1] - pl[i - 1]![1]);
    if (acc + l >= d) return [lerp2(pl[i - 1]!, pl[i]!, (d - acc) / l), ...pl.slice(i)];
    acc += l;
  }
  return [pl[pl.length - 1]!];
}
function trimEnd(pl: V2[], d: number): V2[] {
  return trimStart([...pl].reverse(), d).reverse();
}

/** Join open pieces end to start into a closed loop, each corner rounded with a quadratic of radius about r. */
function joinRounded(pieces: V2[][], radii: number[]): V2[] {
  const n = pieces.length;
  const trimmed = pieces.map((p, i) => trimEnd(trimStart(p, radii[(i - 1 + n) % n]!), radii[i]!));
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const piece = trimmed[i]!, next = trimmed[(i + 1) % n]!;
    for (const p of piece) out.push(p);
    const a = piece[piece.length - 1]!, c = pieces[i]![pieces[i]!.length - 1]!, b = next[0]!;
    for (let k = 1; k < 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return out;
}

/** Distance from a point to a closed polyline. */
function distToLoop(pl: V2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i]!, b = pl[(i + 1) % pl.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y));
  }
  return best;
}

function inside(pl: V2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const a = pl[i]!, b = pl[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The bridge: the bottom edge of the face (y at x), a gentle smile under the head. */
function bridgeY(shape: string, x: number): number {
  const y0 = shape === 'diamond' ? -0.084 : shape === 'teardrop' ? -0.088 : -0.093;
  return y0 + 0.012 * (x / 0.08) ** 2;
}

export interface RacketShape {
  /** The silhouette (counter-clockwise from the bottom of the neck), dense. */
  outer: V2[];
  /** The face's edge (inside the frame's band), counter-clockwise, dense. */
  face: V2[];
  /** The throat's opening (counter-clockwise), dense. */
  heart: V2[];
  /** Hole centres and their radius (m). */
  holes: V2[];
  holeR: number;
  /** The bridge's middle (y of the face's bottom edge and of the opening's top at x = 0). */
  bridgeTop: number;
  bridgeBottom: number;
}

const SHAPES = new Map<string, RacketShape>();

/** A racket's outline, face, throat and holes (cached per look). */
export function racketShape(look: RacketLook): RacketShape {
  const key = look.name;
  const cached = SHAPES.get(key);
  if (cached) return cached;
  const shape = look.shape;
  const outer = resample(outerDense(shape), 1400, true, 0);
  const nIn = leftNormals(outer, true);

  // The face: the outline in by the frame's band, above the bridge, the two lower corners rounded.
  const rim = offsetBy(outer, nIn, RIM_W);
  const above = (p: V2): boolean => p[1] > bridgeY(shape, p[0]) && p[1] > -0.14;
  let iR = -1, iL = -1;
  for (let i = 0; i < rim.length; i++) if (above(rim[i]!) && rim[i]![0] > 0) { iR = i; break; }
  for (let i = rim.length - 1; i >= 0; i--) if (above(rim[i]!) && rim[i]![0] < 0) { iL = i; break; }
  const cross = (i0: number, i1: number): V2 => {
    // Where the band's inner edge crosses the bridge between points i0 (below) and i1 (above).
    const a = rim[i0]!, b = rim[i1]!;
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (above(lerp2(a, b, m))) hi = m; else lo = m;
    }
    return lerp2(a, b, hi);
  };
  const cR = cross(iR - 1, iR), cL = cross(iL + 1, iL);
  const arc: V2[] = [cR, ...rim.slice(iR, iL + 1), cL];
  const bridge: V2[] = [];
  for (let k = 0; k <= 40; k++) {
    const x = cL[0] + ((cR[0] - cL[0]) * k) / 40;
    bridge.push([x, bridgeY(shape, x)]);
  }
  const face = joinRounded([arc, bridge], [0.011, 0.011]);

  // The throat's opening: the arms' inner edges (the outline in by the arm's width) below the bridge, closed at the
  // top under the bridge. A teardrop: the top arched (it follows the bridge's curve, a little more) and its corners
  // rounded wide, so it reads as a drop hanging from the bridge, sharp at the bottom. A triangle: a straight top
  // with tight corners and a rounded point.
  const arms = offsetBy(outer, nIn, ARM_W);
  const tri = look.throat === 'triangle';
  const topY = tri
    ? (_x: number): number => bridgeY(shape, 0) - BRIDGE_W
    : (x: number): number => bridgeY(shape, 0) - BRIDGE_W + (bridgeY(shape, x) - bridgeY(shape, 0)) * 1.6;
  let it = -1;
  for (let i = 0; i < arms.length / 2; i++) if (arms[i]![0] > 0 && arms[i]![1] > topY(arms[i]![0])) { it = i; break; }
  let ib = it - 1;
  while (ib > 0 && arms[ib - 1]![0] > 0) ib--;
  const side: V2[] = [];
  // The point on the axis below the first point with x > 0.
  const a0 = arms[ib - 1]!, a1 = arms[ib]!;
  side.push([0, a0[1] + ((a1[1] - a0[1]) * (0 - a0[0])) / (a1[0] - a0[0])]);
  for (let i = ib; i < it; i++) side.push(arms[i]!);
  const b0 = arms[it - 1]!, b1 = arms[it]!;
  let lo = 0, hi = 1;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2, p = lerp2(b0, b1, m);
    if (p[1] > topY(p[0])) hi = m; else lo = m;
  }
  const topR = lerp2(b0, b1, lo);
  side.push(topR);
  const top: V2[] = [];
  for (let k = 0; k <= 30; k++) {
    const x = topR[0] - (2 * topR[0] * k) / 30;
    top.push([x, topY(x)]);
  }
  const leftSide = side.map((p) => [-p[0], p[1]] as V2).reverse();
  const heart = joinRounded([side, top, leftSide], tri ? [0.0045, 0.0045, 0.012] : [0.02, 0.02, 0.0035]);

  const s: RacketShape = {
    outer, face, heart, holes: [], holeR: look.holes.d / 2,
    bridgeTop: bridgeY(shape, 0), bridgeBottom: topY(0),
  };
  s.holes = layoutHoles(s, look);
  SHAPES.set(key, s);
  return s;
}

/**
 * The holes: `rings` rows following the face's edge (the first `margin` in from it), then a hex grid filling the
 * middle, none in the blank zones, every hole at least `pitch` x 0.86 from the next (a wall of 8 mm or more between
 * 13 mm holes). Symmetric about the axis (the same holes go through both faces, and the back's print is mirrored).
 */
function layoutHoles(s: RacketShape, look: RacketLook): V2[] {
  const H = look.holes;
  const r = H.d / 2 + CHAMFER;
  const edge0 = H.margin + r;
  const minGap = H.pitch * 0.86;
  const out: V2[] = [];
  const blank = (x: number, y: number): boolean => {
    for (const b of H.blank) {
      const c = Math.cos(b.rot), sn = Math.sin(b.rot);
      for (const sx of [1, -1]) {
        const dx = sx * x - b.x, dy = y - b.y;
        const u = (dx * c + dy * sn) / (b.a + r), v = (-dx * sn + dy * c) / (b.b + r);
        if (u * u + v * v < 1) return true;
      }
    }
    return false;
  };
  const ok = (x: number, y: number, minEdge: number): boolean => {
    if (!inside(s.face, x, y) || distToLoop(s.face, x, y) < minEdge - 1e-6 || blank(x, y)) return false;
    for (const q of out) if (Math.hypot(q[0] - x, q[1] - y) < minGap) return false;
    if (Math.abs(x) > 1e-4 && minGap > 2 * Math.abs(x) && Math.abs(x) > 0) return false;
    return true;
  };
  const add = (x: number, y: number, minEdge: number): void => {
    if (x < -1e-4) return;
    if (Math.abs(x) < 1e-4) { if (ok(0, y, minEdge)) out.push([0, y]); return; }
    if (ok(x, y, minEdge)) { out.push([x, y], [-x, y]); }
  };
  const faceN = leftNormals(s.face, true);
  const rowGap = H.pitch * 0.87;
  /** Try adding holes; keep them (and return how many) only if `commit`. */
  const trial = (pts: V2[], minEdge: number, commit: boolean): number => {
    const n0 = out.length;
    for (const p of pts) add(Math.abs(p[0]) < 2e-4 ? 0 : p[0], p[1], minEdge);
    const got = out.length - n0;
    if (!commit) out.length = n0;
    return got;
  };
  // Rows in from the edge until there is no room for another (rings 0: a grid only). Each row's count and phase
  // (a hole on the axis at the top, or two either side of it: both symmetric) are the ones that fit the most holes
  // against the row outside it.
  let rows = 0;
  for (let k = 0; k < Math.max(H.rings, 0); k++) {
    const d = edge0 + k * rowGap;
    // The face's edge in by d; drop the points a tight corner folds back (closer to the edge than d).
    const ring = offsetBy(s.face, faceN, d).filter((p) => distToLoop(s.face, p[0], p[1]) > d - 5e-4);
    if (ring.length < 8 || polyLength(ring, true) < H.pitch * 2.5) break;
    rows++;
    // Start at the top of the ring (on the axis), so a whole or half spacing there keeps it symmetric.
    let top = 0;
    for (let i = 1; i < ring.length; i++) if (ring[i]![1] > ring[top]![1]) top = i;
    const loop = [...ring.slice(top), ...ring.slice(0, top)];
    const L = polyLength(loop, true);
    const cum = [0];
    for (let i = 1; i <= loop.length; i++) cum.push(cum[i - 1]! + Math.hypot(loop[i % loop.length]![0] - loop[i - 1]![0], loop[i % loop.length]![1] - loop[i - 1]![1]));
    const along = (n: number, phase: number): V2[] => {
      const pts: V2[] = [];
      let j = 0;
      for (let h = 0; h < n; h++) {
        const target = ((h + phase) * L) / n;
        while (j < loop.length - 1 && cum[j + 1]! < target) j++;
        pts.push(lerp2(loop[j]!, loop[(j + 1) % loop.length]!, (target - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!)));
      }
      return pts;
    };
    const n0 = Math.max(3, Math.round(L / H.pitch));
    let best: V2[] = [], bestN = -1;
    for (const n of [n0, n0 - 1, n0 + 1, n0 - 2]) {
      if (n < 3 || L / n < H.pitch * 0.86) continue;
      for (const phase of [0, 0.5]) {
        const pts = along(n, phase);
        const got = trial(pts, edge0 - 1e-4, false);
        if (got > bestN) { bestN = got; best = pts; }
      }
    }
    trial(best, edge0 - 1e-4, true);
  }
  // The middle: a hex grid inside the rows (or what is left in the very middle), shifted to fit the most holes.
  const dy = H.pitch * 0.866;
  const inner = rows > 0 ? edge0 + rows * rowGap - rowGap * 0.35 : edge0;
  const grid = (y0: number, odd: number): V2[] => {
    const pts: V2[] = [];
    for (let row = -9; row <= 9; row++) {
      const y = y0 + row * dy;
      const off = ((row + odd) & 1) === 0 ? 0 : H.pitch / 2;
      for (let col = 0; col <= 6; col++) pts.push([col * H.pitch + off, y]);
    }
    return pts;
  };
  let bestG: V2[] = [], bestGN = -1;
  for (let k = 0; k < 8; k++) {
    for (const odd of [0, 1]) {
      const pts = grid((k / 8) * dy, odd);
      const got = trial(pts, inner, false);
      if (got > bestGN) { bestGN = got; bestG = pts; }
    }
  }
  trial(bestG, inner, true);
  return out;
}

/** Hole centres of player 1's racket (tests: the layout keeps clear of the rim and of each other). */
export function racketHoles(look: RacketLook = RACKET_LOOKS[0]!): Array<[number, number]> {
  return racketShape(look).holes;
}

// ---------------------------------------------------------------------------------------------------------------
// Mesh building.

/** Accumulates one racket level's vertices: position, normal, the head-space UV, the strip UV, region and side blend. */
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  uvS: number[] = [];
  info: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, code: number, back: boolean, us = 0, vs = 0, side = 0): number {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.uv.push(ART.headU(back ? -x : x), ART.headV(y));
    this.uvS.push(us, vs);
    this.info.push(code, side);
    return this.pos.length / 3 - 1;
  }
  /** A triangle, wound so its face normal agrees with its vertices' normals. */
  tri(a: number, b: number, c: number): void {
    const P = this.pos, N = this.nrm;
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const nx = N[a * 3]! + N[b * 3]! + N[c * 3]!, ny = N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]!, nz = N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]!;
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('rkUvS', new THREE.Float32BufferAttribute(this.uvS, 2));
    g.setAttribute('rkInfo', new THREE.Float32BufferAttribute(this.info, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * The frame's profile from the face's edge round to the back: n (in from the outline, 0..rc), z, and the outward
 * normal in (out-of-the-material, z) terms. A superellipse quarter each side, so it meets the faces tangentially.
 */
interface ProfilePt { n: number; z: number; gn: number; gz: number; back: boolean; v: number }

function profile(steps: number, rc: number): ProfilePt[] {
  const out: ProfilePt[] = [];
  const e = PROFILE_E;
  for (let k = 0; k <= steps; k++) {
    // From +pi/2 (front face edge) to -pi/2 (back), denser near the faces where it turns fastest.
    const u = k / steps;
    const phi = (Math.PI / 2) * Math.cos(Math.PI * u);
    const c = Math.cos(phi), s = Math.sin(phi);
    const pc = Math.pow(Math.abs(c), 2 / e), ps = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    const n = rc * (1 - pc), z = T2 * ps;
    // Gradient of |x/a|^e + |z/b|^e (x = rc - n): out of the material is -n.
    const gx = Math.pow(pc, e - 1) / rc, gz = Math.sign(ps) * Math.pow(Math.abs(ps), e - 1) / T2;
    out.push({ n, z, gn: -gx, gz, back: z < 0 || (z === 0 && k > steps / 2), v: 0 });
  }
  arcV(out);
  return out;
}

/** v across a profile by arc length: 1 at its first point (the front), 0 at its last. */
function arcV(pts: Array<{ n: number; z: number; v: number }>): void {
  let L = 0;
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push((L += Math.hypot(pts[k]!.n - pts[k - 1]!.n, pts[k]!.z - pts[k - 1]!.z)));
  for (let k = 0; k < pts.length; k++) pts[k]!.v = 1 - cum[k]! / L;
}

/** Arc length across the frame's profile from face to face (m): the side print's height (racketArt.ts). */
export const PROFILE_LEN = ((): number => {
  const p = profile(64, RC);
  let L = 0;
  for (let k = 1; k < p.length; k++) L += Math.hypot(p[k]!.n - p[k - 1]!.n, p[k]!.z - p[k - 1]!.z);
  return L;
})();

/**
 * The frame's tube along the outline cut open at the neck (`pl` from the right side's cut up round the tip and down
 * to the left side's; `s` each station's arc length round the whole outline, which the side print is laid out by),
 * or round a closed loop (the throat's opening, `s` null: the band's colour, no side print). `into`: unit normals into
 * the material. The profile runs from the band's edge (rc in) round the outside to the back's. The outline is split
 * at the tip (each half its own strip of the side texture).
 */
function sweep(b: Builder, pl: V2[], into: V2[], rc: number, steps: number, s: number[] | null, side: SideMap | null): void {
  const prof = profile(steps, rc);
  const m = pl.length;
  const strip = s !== null && side !== null;
  // Open: the halves meet at the tip (the middle station, duplicated with each half's own strip UV). Closed: one run
  // all the way round back to the start.
  const runs: Array<[number, number, number]> = strip ? [[0, (m - 1) / 2, 0], [(m - 1) / 2, m - 1, 1]] : [[0, m, 0]];
  for (const [i0, i1, half] of runs) {
    let prev: number[] | null = null;
    for (let i = i0; i <= i1; i++) {
      const p = pl[i % m]!, N = into[i % m]!;
      const row: number[] = [];
      for (let k = 0; k < prof.length; k++) {
        const q = prof[k]!;
        const x = p[0] + N[0] * q.n, y = p[1] + N[1] * q.n;
        const nx = N[0] * q.gn, ny = N[1] * q.gn;
        const [us, vs] = strip ? side(s[i]!, q.v, half) : [0, 0];
        // Side blend: the band's print near the faces, the strip's on the outside.
        const sd = strip ? Math.min(1, Math.max(0, (1 - Math.abs(q.z) / T2) * 2.2 - 0.15)) : 0;
        row.push(b.v(x, y, q.z, nx, ny, q.gz, RK_FRAME, q.back, us, vs, sd));
        // The middle station is shared by the two halves of the profile: duplicate it so the back's mirrored print
        // doesn't interpolate across from the front's.
        if (k === (prof.length - 1) / 2) row.push(b.v(x, y, q.z, nx, ny, q.gz, RK_FRAME, true, us, vs, sd));
      }
      if (prev) {
        for (let k = 0; k < row.length - 1; k++) {
          if (k === (prof.length - 1) / 2) continue; // between the duplicated middle pair
          b.quad(prev[k]!, prev[k + 1]!, row[k + 1]!, row[k]!);
        }
      }
      prev = row;
    }
  }
}

/** A flat polygon with holes at height z (normal +z or -z), as one region. */
function flat(b: Builder, contour: V2[], holes: V2[][], z: number, code: number): void {
  const back = z < 0;
  const c = contour.map((p) => new THREE.Vector2(p[0], p[1]));
  const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const tris = THREE.ShapeUtils.triangulateShape(c, hs);
  const all = [...c, ...hs.flat()];
  const base = all.map((p) => b.v(p.x, p.y, z, 0, 0, back ? -1 : 1, code, back));
  for (const t of tris) b.tri(base[t[0]!]!, base[t[1]!]!, base[t[2]!]!);
}

/** A circle (counter-clockwise), `n` points. */
function circle(cx: number, cy: number, r: number, n: number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * A hole through the core: the chamfer on each face (RK_CHAMFER: the face's print, darker, where the drill eased the
 * edge) and the wall between (RK_WALL: the shader bands it skin | foam | skin).
 */
function hole(b: Builder, cx: number, cy: number, r: number, n: number): void {
  const zf = T2 - FACE_STEP;
  const rings: Array<{ r: number; z: number; nr: number; nz: number; code: number }[]> = [
    // Front chamfer, the wall, back chamfer: each its own normals (crisp edges between).
    [{ r: r + CHAMFER, z: zf, nr: -1, nz: 1, code: RK_CHAMFER }, { r, z: zf - CHAMFER, nr: -1, nz: 1, code: RK_CHAMFER }],
    [{ r, z: zf - CHAMFER, nr: -1, nz: 0, code: RK_WALL }, { r, z: -zf + CHAMFER, nr: -1, nz: 0, code: RK_WALL }],
    [{ r, z: -zf + CHAMFER, nr: -1, nz: -1, code: RK_CHAMFER }, { r: r + CHAMFER, z: -zf, nr: -1, nz: -1, code: RK_CHAMFER }],
  ];
  for (const pair of rings) {
    const ids: number[][] = [[], []];
    for (let j = 0; j < 2; j++) {
      const q = pair[j]!;
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n, ca = Math.cos(a), sa = Math.sin(a);
        ids[j]!.push(b.v(cx + q.r * ca, cy + q.r * sa, q.z, q.nr * ca, q.nr * sa, q.nz, q.code, q.z < 0));
      }
    }
    for (let k = 0; k < n; k++) b.quad(ids[0]![k]!, ids[0]![(k + 1) % n]!, ids[1]![(k + 1) % n]!, ids[1]![k]!);
  }
}

/** The bridge's logo plate: a rounded rectangle standing PLATE_T proud of the band on each face (its print is the art's). */
const PLATE_W = 0.026, PLATE_H = 0.0072, PLATE_T = 0.0004;
export function plateCentre(s: { bridgeTop: number; bridgeBottom: number }): number {
  return (s.bridgeTop + s.bridgeBottom + RC_H) / 2;
}
function plate(b: Builder, yc: number, n: number): void {
  const out: V2[] = [];
  const r = PLATE_H * 0.45, hw = PLATE_W / 2 - r, hh = PLATE_H / 2 - r;
  for (const [cx, cy, a0] of [[hw, hh, 0], [-hw, hh, Math.PI / 2], [-hw, -hh, Math.PI], [hw, -hh, Math.PI * 1.5]] as const) {
    for (let k = 0; k <= n; k++) {
      const a = a0 + (Math.PI / 2) * (k / n);
      out.push([cx + r * Math.cos(a), yc + cy + r * Math.sin(a)]);
    }
  }
  for (const sgn of [1, -1]) {
    flat(b, out, [], sgn * (T2 + PLATE_T), RK_FRAME);
    const ids: number[] = [];
    const nrm = leftNormals(out, true);
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!, N = nrm[i]!;
      ids.push(b.v(p[0], p[1], sgn * (T2 + PLATE_T), -N[0], -N[1], sgn * 0.6, RK_FRAME, sgn < 0), b.v(p[0], p[1], sgn * T2, -N[0], -N[1], 0, RK_FRAME, sgn < 0));
    }
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      b.quad(ids[i * 2]!, ids[j * 2]!, ids[j * 2 + 1]!, ids[i * 2 + 1]!);
    }
  }
}

/** The step between the frame's band and the recessed face, along the face's edge (front and back). */
function step(b: Builder, face: V2[]): void {
  const n = leftNormals(face, true);
  for (const sgn of [1, -1]) {
    const ids: number[] = [];
    for (let i = 0; i < face.length; i++) {
      const p = face[i]!, N = n[i]!;
      ids.push(b.v(p[0], p[1], sgn * T2, N[0], N[1], 0, RK_FRAME, sgn < 0), b.v(p[0], p[1], sgn * (T2 - FACE_STEP), N[0], N[1], 0, RK_FRAME, sgn < 0));
    }
    for (let i = 0; i < face.length; i++) {
      const j = (i + 1) % face.length;
      b.quad(ids[i * 2]!, ids[j * 2]!, ids[j * 2 + 1]!, ids[i * 2 + 1]!);
    }
  }
}

/**
 * The protector over the top of the frame, `span` metres long centred on the tip: the frame's profile stood off by
 * BUMPER_T round the outside and BUMPER_TF on the faces, reaching BUMPER_LIP onto the band each side, where it ends
 * in a small square edge BUMPER_EDGE high. Over its last BUMPER_RAMP at each end it thins to a bevelled end, as a
 * moulded protector does. Its print is the side texture's (racketArt.ts lays the protector out over the tip).
 */
function bumper(b: Builder, outer: V2[], into: V2[], sOf: number[], span: number, stations: number, steps: number, side: SideMap): void {
  const m = outer.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1]! + Math.hypot(outer[i % m]![0] - outer[i - 1]![0], outer[i % m]![1] - outer[i - 1]![1]));
  const L = cum[m]!;
  // Arc length on this loop to the outline's own (the side print's) arc length.
  const sScale = sOf[m]! / L;
  const at = (s: number): { p: V2; N: V2 } => {
    let j = 0;
    while (j < m - 1 && cum[j + 1]! < s) j++;
    const u = (s - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
    const N = lerp2(into[j]!, into[(j + 1) % m]!, u);
    const l = Math.hypot(N[0], N[1]);
    return { p: lerp2(outer[j]!, outer[(j + 1) % m]!, u), N: [N[0] / l, N[1] / l] };
  };
  const prof = profile(steps, RC);
  const s0 = L / 2 - span / 2, s1 = L / 2 + span / 2;
  let prev: number[] | null = null;
  for (let i = 0; i <= stations; i++) {
    const s = s0 + ((s1 - s0) * i) / stations;
    const { p, N } = at(s);
    const fromEnd = Math.min(s - s0, s1 - s);
    const r = Math.min(1, fromEnd / BUMPER_RAMP);
    const taper = 0.25 + 0.75 * r * r * (3 - 2 * r);
    const tf = BUMPER_TF * taper, lip = BUMPER_LIP * (0.4 + 0.6 * taper), edge = Math.min(BUMPER_EDGE, tf);
    const pts: Array<{ n: number; z: number; gn: number; gz: number; v: number }> = [];
    // Front: the square edge on the band, up onto the protector's face, round the profile (thicker round the
    // outside), then the same down onto the back's band.
    for (const sg of [1, -1]) {
      const face = [
        { n: RC + lip, z: sg * (T2 + 0.00002), gn: 1, gz: 0, v: 0 },
        { n: RC + lip - 0.00015, z: sg * (T2 + edge), gn: 0.5, gz: sg, v: 0 },
        { n: RC + lip - 0.0006 - tf, z: sg * (T2 + tf), gn: 0, gz: sg, v: 0 },
      ];
      if (sg > 0) pts.push(...face);
      else {
        for (const q of prof) {
          const gl = Math.hypot(q.gn, q.gz);
          // Full thickness round the outside, BUMPER_TF where the profile meets the faces.
          const w = 1 - Math.pow(Math.abs(q.z) / T2, 3);
          const t = tf + (BUMPER_T - BUMPER_TF) * taper * w;
          pts.push({ n: q.n + (q.gn / gl) * t, z: q.z + (q.gz / gl) * t, gn: q.gn, gz: q.gz, v: 0 });
        }
        pts.push(...face.reverse());
      }
    }
    arcV(pts);
    // The tip (the middle station) belongs to both halves of the side print: its row is made once for each.
    const tip = 2 * i === stations;
    const half = s < L / 2 || tip ? 0 : 1;
    const so = s * sScale;
    const rowFor = (h: number): number[] => {
      const row: number[] = [];
      for (let k = 0; k < pts.length; k++) {
        const q = pts[k]!;
        const [us, vs] = side(so, q.v, h);
        row.push(b.v(p[0] + N[0] * q.n, p[1] + N[1] * q.n, q.z, N[0] * q.gn, N[1] * q.gn, q.gz, RK_BUMPER, q.z < 0, us, vs, 1));
      }
      return row;
    };
    const row = rowFor(half);
    if (prev) for (let k = 0; k < row.length - 1; k++) b.quad(prev[k]!, prev[k + 1]!, row[k + 1]!, row[k]!);
    prev = tip ? rowFor(1) : row;
    if (i === 0 || i === stations) {
      // The bevel's end: the protector's section closed down onto the frame's, facing along the frame.
      const sg = i === 0 ? -1 : 1;
      const tx = N[1] * sg, ty = -N[0] * sg;
      const [us, vs] = side(so, 0.5, half);
      const endIds: number[] = [];
      for (let k = 0; k < pts.length; k++) {
        const q = pts[k]!;
        endIds.push(b.v(p[0] + N[0] * q.n, p[1] + N[1] * q.n, q.z, tx, ty, 0, RK_BUMPER, q.z < 0, us, vs, 1));
      }
      const inner: number[] = [];
      for (let k = 0; k < prof.length; k++) {
        const q = prof[k]!;
        inner.push(b.v(p[0] + N[0] * q.n, p[1] + N[1] * q.n, q.z, tx, ty, 0, RK_BUMPER, q.z < 0, us, vs, 1));
      }
      // Protector points 3..3+prof stand over the frame's profile points; the edges close onto the band.
      for (let k = 0; k < prof.length - 1; k++) b.quad(endIds[k + 3]!, endIds[k + 4]!, inner[k + 1]!, inner[k]!);
      const e = pts.length - 1;
      b.quad(endIds[0]!, endIds[1]!, endIds[2]!, endIds[3]!);
      b.tri(endIds[0]!, endIds[3]!, inner[0]!);
      b.quad(endIds[e]!, endIds[e - 1]!, endIds[e - 2]!, endIds[e - 3]!);
      b.tri(endIds[e]!, endIds[e - 3]!, inner[prof.length - 1]!);
    }
  }
}

/** A surface of revolution about y: `rows` of (radius, y), `cols` around, the strip UV from `uvAt` (u 0..1 round). */
function lathe(b: Builder, rows: V2[], cols: number, code: number, uvAt?: (u: number, k: number) => [number, number]): void {
  const ids: number[][] = [];
  // Rows going up the axis: the profile's normal is (dy, -dr); going down, the other way.
  const dir = rows[rows.length - 1]![1] >= rows[0]![1] ? 1 : -1;
  for (let k = 0; k < rows.length; k++) {
    const [r, y] = rows[k]!;
    const a0 = rows[Math.max(0, k - 1)]!, a1 = rows[Math.min(rows.length - 1, k + 1)]!;
    const dr = a1[0] - a0[0], dy = a1[1] - a0[1];
    const nr = dy * dir, ny = -dr * dir;
    const row: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const th = (2 * Math.PI * j) / cols, s = Math.sin(th), c = Math.cos(th);
      const [us, vs] = uvAt ? uvAt(j / cols, k) : [0, 0];
      row.push(b.v(r * s, y, r * c, nr * s, ny, nr * c, code, false, us, vs, 0));
    }
    ids.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < cols; j++) b.quad(ids[k]![j]!, ids[k]![j + 1]!, ids[k + 1]![j + 1]!, ids[k + 1]![j]!);
  }
}

/** Mean handle radius at height y (over the overgrip). */
function handleR(y: number): number {
  const t = (HANDLE_TOP - y) / (HANDLE_TOP - CAP_TOP);
  return HANDLE_R + (HANDLE_R_BUTT - HANDLE_R) * Math.min(1, Math.max(0, t));
}

/** The overgrip's radius offset across one turn (f 0..1 up the handle): a groove, the step, then the turn lying down. */
const GRIP_F = [0, 0.08, 0.45, 0.85];
const GRIP_P = [0, 1, 0.62, 0.3];

/**
 * The overgrip: a helical grid whose rows follow the tape's edge, so each turn's step is a real edge in the mesh.
 * The tape winds up from the butt (each turn overlapping the one below); the mean radius is the handle's.
 */
function grip(b: Builder, cols: number): void {
  const y0 = GRIP_Y0, y1 = TAPE_Y0 + 0.003;
  const rpt = GRIP_F.length;
  const turns = Math.ceil((y1 - y0) / GRIP_PITCH) + 2;
  const R = turns * rpt;
  const V: number[][] = [];
  const posAt = (i: number, j: number): [number, number, number] => {
    const turn = Math.floor(i / rpt) - 1, f = GRIP_F[i % rpt]!;
    const th = (2 * Math.PI * j) / cols;
    let y = y0 + GRIP_PITCH * (turn + f + j / cols);
    y = Math.min(y1, Math.max(y0, y));
    const r = handleR(y) - GRIP_STEP * 0.5 + GRIP_STEP * GRIP_P[i % rpt]!;
    return [r * Math.sin(th), y, r * Math.cos(th)];
  };
  for (let i = 0; i <= R + rpt; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const p = posAt(i, j);
      // Normal from the neighbours along the turn (j) and across it (i).
      const pa = posAt(Math.max(0, i - 1), j), pb = posAt(Math.min(R + rpt, i + 1), j);
      const pc = posAt(i, j - 1), pd = posAt(i, j + 1);
      const ax = pb[0] - pa[0], ay = pb[1] - pa[1], az = pb[2] - pa[2];
      const bx = pd[0] - pc[0], by = pd[1] - pc[1], bz = pd[2] - pc[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (nx * p[0] + nz * p[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (!(Math.abs(ax) + Math.abs(ay) + Math.abs(az) > 1e-9)) { nx = p[0]; ny = 0; nz = p[2]; }
      row.push(b.v(p[0], p[1], p[2], nx, ny, nz, RK_GRIP, false));
    }
    V.push(row);
  }
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < cols; j++) {
      const a = V[i]![j]!, d = V[i + 1]![j]!;
      const bb = j + 1 < cols ? V[i]![j + 1]! : V[i + rpt]![0]!;
      const c = j + 1 < cols ? V[i + 1]![j + 1]! : V[i + 1 + rpt]![0]!;
      b.quad(a, bb, c, d);
    }
  }
}

/** The neck's half width at y, on its straight run from inside the tape up to where it turns out into the arms. */
function neckHalfW(y: number): number {
  return NECK_W + (0.0005 * (y - NECK_Y)) / 0.021;
}

/**
 * The neck's section as the frame's sweep builds it (half width `w`, the sweep's profile `prof`): how far from the axis
 * a ray at angle `th` (x = r sin th, z = r cos th, as `lathe`) leaves it. The section is convex round the axis: the
 * profile each side, the faces' band across.
 */
function neckRay(th: number, w: number, prof: ProfilePt[]): number {
  const dx = Math.sin(th), dz = Math.cos(th);
  const K = prof.length;
  // Right side down the profile, then the left side back up it; the last edge closes across the front band.
  const at = (k: number): [number, number] => (k < K ? [w - prof[k]!.n, prof[k]!.z] : [-(w - prof[2 * K - 1 - k]!.n), prof[2 * K - 1 - k]!.z]);
  let best = Infinity;
  for (let k = 0; k < 2 * K; k++) {
    const [ax, az] = at(k), [bx, bz] = at((k + 1) % (2 * K));
    // origin + t d = a + u (b - a)
    const ex = bx - ax, ez = bz - az;
    const den = dz * ex - dx * ez;
    if (Math.abs(den) < 1e-14) continue;
    const t = (az * ex - ax * ez) / den;
    const u = (dx * az - dz * ax) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/**
 * A closed surface round the y axis through rows of (y, radius at angle th), at the angles `ths` round (ascending,
 * x = r sin th, z = r cos th, as `lathe`): normals from the grid, the strip UV from `uvAt(u, k)` with u by arc length
 * round each row.
 */
function loft(b: Builder, rows: Array<{ y: number; r: (th: number) => number }>, ths: number[], code: number, uvAt: (u: number, k: number) => [number, number]): void {
  const cols = ths.length;
  const P = rows.map((row) => {
    const out: Array<[number, number, number]> = [];
    for (let j = 0; j < cols; j++) {
      const th = ths[j]!, r = row.r(th);
      out.push([r * Math.sin(th), row.y, r * Math.cos(th)]);
    }
    return out;
  });
  const ids: number[][] = [];
  for (let k = 0; k < rows.length; k++) {
    const R = P[k]!;
    const cum = [0];
    for (let j = 1; j <= cols; j++) cum.push(cum[j - 1]! + Math.hypot(R[j % cols]![0] - R[j - 1]![0], R[j % cols]![2] - R[j - 1]![2]));
    const row: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const p = R[j % cols]!, pa = R[(j - 1 + cols) % cols]!, pb = R[(j + 1) % cols]!;
      const qa = P[Math.max(0, k - 1)]![j % cols]!, qb = P[Math.min(rows.length - 1, k + 1)]![j % cols]!;
      // Round (t) cross up (w): away from the axis.
      const tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
      const wx = qb[0] - qa[0], wy = qb[1] - qa[1], wz = qb[2] - qa[2];
      let nx = ty * wz - tz * wy, ny = tz * wx - tx * wz, nz = tx * wy - ty * wx;
      if (nx * p[0] + nz * p[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const [us, vs] = uvAt(cum[j]! / cum[cols]!, k);
      row.push(b.v(p[0], p[1], p[2], nx, ny, nz, code, false, us, vs, 0));
    }
    ids.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < cols; j++) b.quad(ids[k]![j]!, ids[k]![j + 1]!, ids[k + 1]![j + 1]!, ids[k + 1]![j]!);
  }
}

/**
 * The handle: the overgrip (or a plain tube far away), the finishing tape, the butt cap and its logo plate. The tape
 * starts round on the overgrip's end and flares into the neck's own section (`prof`: the frame's profile as swept),
 * lying TAPE_T over it from below where the frame stops (NECK_CUT) to its edge at TAPE_Y1, so it closes round the
 * neck as real tape does instead of standing proud of it as a cuff.
 */
function handle(b: Builder, cols: number, tapeGap: number, far: boolean, prof: ProfilePt[]): void {
  if (far) {
    lathe(b, [[HANDLE_R_BUTT, CAP_TOP], [HANDLE_R, TAPE_Y0]], cols, RK_GRIP);
  } else grip(b, cols);
  const tr = HANDLE_R + GRIP_STEP * 0.5 + 0.0004;
  // The far level's tape has fewer sides: stood further off the neck so its flat sides still cover the neck's corners.
  const off = far ? 0.0011 : TAPE_T;
  const onNeck = (y: number, d: number) => (th: number): number => neckRay(th, neckHalfW(y), prof) + d;
  const flare = (y: number, s: number) => {
    const f = onNeck(y, off);
    return (th: number): number => tr + (f(th) - tr) * s;
  };
  const round = (r: number) => (): number => r;
  const yA = -0.1825, yB = NECK_CUT - 0.0012;
  const rows: Array<{ y: number; r: (th: number) => number }> = far
    ? [{ y: TAPE_Y0, r: round(tr) }, { y: yA, r: round(tr) }, { y: (yA + yB) / 2, r: flare((yA + yB) / 2, 0.5) },
      { y: yB, r: flare(yB, 1) }, { y: TAPE_Y1 - 0.0003, r: onNeck(TAPE_Y1, off) }, { y: TAPE_Y1 + 0.0002, r: onNeck(TAPE_Y1, 0.0001) }]
    : [{ y: TAPE_Y0 - 0.0002, r: round(tr - 0.0006) }, { y: TAPE_Y0 + 0.0006, r: round(tr) }, { y: yA, r: round(tr) }];
  if (!far) {
    for (let i = 1; i <= 3; i++) {
      const t = i / 3, y = yA + (yB - yA) * t;
      rows.push({ y, r: flare(y, t * t * (3 - 2 * t)) });
    }
    rows.push({ y: TAPE_Y1 - 0.0003, r: onNeck(TAPE_Y1, off) }, { y: TAPE_Y1, r: onNeck(TAPE_Y1, off * 0.55) },
      { y: TAPE_Y1 + 0.00018, r: onNeck(TAPE_Y1, 0.00003) });
  }
  // The tape's sides stand at the neck section's own corners (so the tape's flats lie over the neck's, never across
  // a corner of it), with more between where they are far apart (the band across each face; round on the grip).
  const w1 = neckHalfW(TAPE_Y1);
  const corners: number[] = [];
  for (const q of prof) {
    const a = Math.atan2(w1 - q.n, q.z);
    corners.push(a, 2 * Math.PI - a);
  }
  corners.sort((x, y) => x - y);
  const ths: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!, c = i + 1 < corners.length ? corners[i + 1]! : corners[0]! + 2 * Math.PI;
    // Corners closer than 2.5 degrees (the profile's first steps off the band) are one.
    if (c - a < 0.044) continue;
    const n = Math.max(1, Math.ceil((c - a) / tapeGap - 0.05));
    for (let k = 0; k < n; k++) ths.push(a + ((c - a) * k) / n);
  }
  // The print's seam at the back of the handle (the side away from the face a player shows).
  let back = 0;
  for (let j = 1; j < ths.length; j++) if (Math.abs(ths[j]! - Math.PI) < Math.abs(ths[back]! - Math.PI)) back = j;
  ths.push(...ths.splice(0, back));
  loft(b, rows, ths, RK_TAPE, (u, k) => ART.tapeUv(u, Math.min(1, Math.max(0, (rows[k]!.y - TAPE_Y0) / (TAPE_Y1 - TAPE_Y0)))));
  // Butt cap: from under the grip's end, flaring out round the heel of the hand, rounding to the end plate.
  const cap: V2[] = far
    ? [[HANDLE_R_BUTT, CAP_TOP + 0.001], [0.0214, -0.303], [0.0185, -0.3098]]
    : [[HANDLE_R_BUTT - 0.0002, CAP_TOP + 0.002], [HANDLE_R_BUTT + 0.0005, CAP_TOP], [0.0198, -0.2985], [0.0211, -0.3012],
      [0.0217, -0.3045], [0.0213, -0.3072], [0.02, -0.309], [0.0186, -0.30985], [0.0176, -0.30995]];
  lathe(b, cap, cols, RK_CAP);
  // The end plate: a logo disc, a hair inside the cap's rim.
  const plate = far ? 0.0185 : 0.0176;
  const c = b.v(0, RACKET_BUTT + 0.0001, 0, 0, -1, 0, RK_LOGO, false, ...ART.logoUv(0.5, 0.5), 0);
  const ring: number[] = [];
  for (let j = 0; j <= cols; j++) {
    const th = (2 * Math.PI * j) / cols;
    const x = plate * Math.sin(th), z = plate * Math.cos(th);
    // The logo reads from below with the racket's +z up the picture.
    ring.push(b.v(x, RACKET_BUTT + 0.0001, z, 0, -1, 0, RK_LOGO, false, ...ART.logoUv(0.5 + (0.5 * x) / plate, 0.5 + (0.5 * z) / plate), 0));
  }
  for (let j = 0; j < cols; j++) b.tri(c, ring[j + 1]!, ring[j]!);
}

/**
 * The outline (closed, from the bottom of the neck) opened where the neck goes into the tape: from the right side's
 * crossing of NECK_CUT up round the tip and down to the left side's, the tip its middle point. `s`: arc length round
 * the closed loop at each of its points (and its total last); returns the open path and its points' arc lengths.
 */
function openAtNeck(loop: V2[], s: number[]): { path: V2[]; sPath: number[] } {
  const m = loop.length;
  let iR = 1;
  while (iR < m / 2 && loop[iR]![1] <= NECK_CUT) iR++;
  const iL = m - iR;
  const cut = (i0: number, i1: number): { p: V2; s: number } => {
    const a = loop[i0 % m]!, c = loop[i1 % m]!;
    const t = (NECK_CUT - a[1]) / (c[1] - a[1]);
    return { p: [a[0] + (c[0] - a[0]) * t, NECK_CUT], s: s[i0]! + (s[i1]! - s[i0]!) * t };
  };
  const r = cut(iR - 1, iR), l = cut(iL + 1, iL);
  return { path: [r.p, ...loop.slice(iR, iL + 1), l.p], sPath: [r.s, ...s.slice(iR, iL + 1), l.s] };
}

type SideMap = (s: number, v: number, half: number) => [number, number];

/** One level of a racket: the head (frame, faces, holes, throat, protector) and the handle, as one geometry. */
function buildLevel(look: RacketLook, far: boolean, side: SideMap, sideL: number): THREE.BufferGeometry {
  const s = racketShape(look);
  const b = new Builder();
  const steps = far ? 6 : 10;
  const loop = resample(s.outer, far ? 56 : 108, true, 4);
  const loopIn = leftNormals(loop, true);
  // Arc length round the loop, scaled to the outline's own (the side print is laid out on that).
  const sLoop = [0];
  for (let i = 1; i <= loop.length; i++) sLoop.push(sLoop[i - 1]! + Math.hypot(loop[i % loop.length]![0] - loop[i - 1]![0], loop[i % loop.length]![1] - loop[i - 1]![1]));
  const k = sideL / sLoop[loop.length]!;
  for (let i = 0; i < sLoop.length; i++) sLoop[i]! *= k;
  const { path, sPath } = openAtNeck(loop, sLoop);
  const into = leftNormals(path, false);
  // The band's inner edge; the open ends join straight across the neck (inside the tape).
  const bandEdge = offsetBy(path, into, RC);
  const face = resample(s.face, far ? 44 : 120, true, 3);
  const heart = resample(s.heart, far ? 18 : 36, true, 4);
  // The heart's loop is counter-clockwise round the opening: into the material is to its right.
  const hIn = leftNormals(heart, true).map((p) => [-p[0], -p[1]] as V2);
  const heartEdge = offsetBy(heart, hIn, RC_H);

  sweep(b, path, into, RC, steps, sPath, side);
  sweep(b, heart, hIn, RC_H, far ? 4 : 12, null, null);
  // An even count of stations: the middle one is the tip.
  bumper(b, loop, loopIn, sLoop, look.bumper.span, far ? 14 : 22, steps, side);
  // The band (frame, flush with the profile) round the face and the throat; the face a hair below it.
  for (const z of [T2, -T2]) flat(b, bandEdge, [face, heartEdge], z, RK_FRAME);
  if (!far) plate(b, plateCentre(s), 4);
  if (far) {
    for (const z of [T2 - FACE_STEP, -(T2 - FACE_STEP)]) flat(b, face, [], z, RK_FACE_FAR);
  } else {
    step(b, face);
    const rings = s.holes.map(([x, y]) => circle(x, y, s.holeR + CHAMFER, HOLE_SIDES));
    for (const z of [T2 - FACE_STEP, -(T2 - FACE_STEP)]) flat(b, face, rings, z, RK_FACE);
    for (const [x, y] of s.holes) hole(b, x, y, s.holeR, HOLE_SIDES);
  }
  handle(b, far ? 12 : 20, far ? 0.5 : 0.27, far, profile(steps, RC));
  return b.geometry();
}

// ---------------------------------------------------------------------------------------------------------------
// The model.

/** Switch to the far level when the racket is this far from the camera, scaled to a 45-degree lens (m). */
const LOD_NEAR = 6;
const TAN_REF = Math.tan((22.5 * Math.PI) / 180);
const VA = new THREE.Vector3();
const VB = new THREE.Vector3();

/**
 * Near and far levels by how large the racket is on screen: three's LOD measures plain distance; this scales it by
 * the lens (the broadcast camera's long lens sees a racket at 20 m as a 45-degree lens would at 11 m). Each camera
 * keeps its own choice (and hysteresis), so a spotlight's shadow pass can't flip the view's; orthographic (shadow)
 * cameras leave the levels as the view set them.
 */
export class RacketLod extends THREE.LOD {
  private readonly farFor = new WeakMap<THREE.Camera, boolean>();
  override update(camera: THREE.Camera): void {
    const levels = this.levels;
    const pc = camera as THREE.PerspectiveCamera;
    if (levels.length < 2 || !pc.isPerspectiveCamera) return;
    VA.setFromMatrixPosition(camera.matrixWorld);
    VB.setFromMatrixPosition(this.matrixWorld);
    const d = (VA.distanceTo(VB) * Math.tan((pc.fov * Math.PI) / 360)) / (TAN_REF * pc.zoom);
    const was = this.farFor.get(camera) === true;
    const far = was ? d > LOD_NEAR * 0.9 : d > LOD_NEAR;
    if (far !== was) this.farFor.set(camera, far);
    levels[0]!.object.visible = !far;
    levels[1]!.object.visible = far;
    (this as unknown as { _currentLevel: number })._currentLevel = far ? 1 : 0;
  }
}

interface Parts { near: THREE.BufferGeometry; far: THREE.BufferGeometry; material: THREE.Material }
const PARTS = new Map<string, Parts>();

/** Geometry and material of a look, shared by every racket of that look. */
function parts(look: RacketLook): Parts {
  let p = PARTS.get(look.name);
  if (p) return p;
  const s = racketShape(look);
  const shape: ArtShape = {
    outer: s.outer, face: s.face, heart: s.heart, bridgeTop: s.bridgeTop, bridgeBottom: s.bridgeBottom, perimeter: polyLength(s.outer, true),
    holes: s.holes, holeEdge: s.holeR + CHAMFER, plateY: plateCentre(s), profile: PROFILE_LEN,
  };
  const lay = sideLayout(shape, look.bumper.span);
  const side: SideMap = (sv, v, half) => ART.sideUv(lay, sv, v, half);
  const art = racketArt(look, shape, lay);
  const dims = { t2: T2, step: FACE_STEP, skin: SKIN_T, pitch: GRIP_PITCH, gripY0: GRIP_Y0 };
  p = { near: buildLevel(look, false, side, shape.perimeter), far: buildLevel(look, true, side, shape.perimeter), material: racketMaterial(art, look, dims) };
  PARTS.set(look.name, p);
  return p;
}

/** The racket's body (both levels), to put in a racket group. */
function racketBody(look: RacketLook): THREE.LOD {
  const p = parts(look);
  const lod = new RacketLod();
  lod.name = 'racketBody';
  lod.userData.racketBody = true;
  const near = new THREE.Mesh(p.near, p.material);
  const far = new THREE.Mesh(p.far, p.material);
  near.name = 'racketNear';
  far.name = 'racketFar';
  for (const m of [near, far]) m.castShadow = true;
  lod.addLevel(near, 0);
  lod.addLevel(far, LOD_NEAR);
  return lod;
}

/** A new racket (geometry and materials are shared by every racket of a look). Player 1's look by default. */
export function makeRacketModel(look: RacketLook = RACKET_LOOKS[0]!): THREE.Group {
  const g = new THREE.Group();
  g.name = 'racket';
  g.add(racketBody(look));
  return g;
}

const CORDS = new Map<string, THREE.Material>();

function cordFor(look: RacketLook): THREE.Material {
  let m = CORDS.get(look.cord);
  if (!m) { m = cordMaterial(look.cord); CORDS.set(look.cord, m); }
  return m;
}

/**
 * Give an existing racket group (an avatar's) another look. Anything else on it stays; the wrist cord takes the
 * racket's colour, now and whenever the avatar swaps it for the other hand's.
 */
export function dressRacket(g: THREE.Group, look: RacketLook): void {
  for (const c of [...g.children]) if (c.userData.racketBody) g.remove(c);
  g.add(racketBody(look));
  g.userData.racketLook = look;
  const paint = (o: THREE.Object3D): void => {
    if (o.name === 'cord') (o as THREE.Mesh).material = cordFor(g.userData.racketLook as RacketLook);
  };
  for (const c of g.children) paint(c);
  if (!g.userData.cordHook) {
    g.userData.cordHook = true;
    g.addEventListener('childadded' as never, (e: { child: THREE.Object3D }) => paint(e.child));
  }
}

/** Triangles and draw calls of one racket as drawn up close (tests, budgets). */
export function racketCost(g: THREE.Object3D): { triangles: number; drawCalls: number; farTriangles: number } {
  let triangles = 0, drawCalls = 0, farTriangles = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    if (m.name === 'racketFar') { farTriangles += n; return; }
    triangles += n;
    drawCalls += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
  });
  return { triangles, drawCalls, farTriangles };
}

let cordMat: THREE.Material | null = null;

/** The wrist cord's strap: half its width and half its thickness (m), and the slider that closes the loop. */
const STRAP_A = 0.0042, STRAP_C = 0.0011;
const STRAP_SEG = 48, STRAP_SIDES = 6;

/**
 * The wrist cord (FIP: rackets carry one, and players wear it): a flat braided strap, about 8 mm wide, from the butt
 * cap (it leaves through the end plate) down and round once about the wrist, `wristR` out from its axis, with a
 * slider where the loop closes. The strap lies flat on the wrist (its width along the forearm). `wrist` and `forearm`
 * (towards the elbow) are in the racket's frame. One mesh: the slider is marked by v = 2 for the cord's material.
 */
export function makeWristCord(wrist: THREE.Vector3, forearm: THREE.Vector3, wristR: number): THREE.Mesh {
  cordMat ??= cordMaterial();
  const up = forearm.clone().normalize();
  // The loop sits just up the forearm from the joint (it rides on the hand: further up, the bent wrist cut it).
  const c = wrist.clone().addScaledVector(up, 0.012);
  const a = new THREE.Vector3(0, -1, 0).addScaledVector(up, up.y).normalize();
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
  const b = new THREE.Vector3().crossVectors(up, a).normalize();
  const r = wristR + 0.0025 + STRAP_C;
  const pts: THREE.Vector3[] = [];
  const butt = new THREE.Vector3(0, RACKET_BUTT + 0.004, 0);
  // From the butt cap down and round to the loop's nearest side, then once round the wrist.
  const start = c.clone().addScaledVector(a, r);
  pts.push(butt, butt.clone().lerp(start, 0.5).add(new THREE.Vector3(0, -0.012, 0)), start);
  for (let k = 1; k <= 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    pts.push(c.clone().addScaledVector(a, r * Math.cos(t)).addScaledVector(b, r * Math.sin(t)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), W = new THREE.Vector3(), N = new THREE.Vector3(), Wp = new THREE.Vector3();
  let slider = 0, sliderD = Infinity;
  const frames: Array<{ P: THREE.Vector3; T: THREE.Vector3; W: THREE.Vector3; N: THREE.Vector3 }> = [];
  for (let i = 0; i <= STRAP_SEG; i++) {
    curve.getPointAt(i / STRAP_SEG, P);
    curve.getTangentAt(i / STRAP_SEG, T);
    // Width along the forearm (flat on the wrist), carried on from the last section where the strap runs along it.
    W.copy(up).addScaledVector(T, -up.dot(T));
    if (W.lengthSq() < 0.09 && i > 0) W.copy(Wp).addScaledVector(T, -Wp.dot(T));
    W.normalize();
    if (i > 0 && W.dot(Wp) < 0) W.negate();
    Wp.copy(W);
    N.crossVectors(T, W).normalize();
    frames.push({ P: P.clone(), T: T.clone(), W: W.clone(), N: N.clone() });
    const d = P.distanceTo(start);
    if (d < sliderD) { sliderD = d; slider = i; }
    for (let k = 0; k <= STRAP_SIDES; k++) {
      const ph = (2 * Math.PI * k) / STRAP_SIDES, cp = Math.cos(ph), sp = Math.sin(ph);
      pos.push(P.x + W.x * STRAP_A * cp + N.x * STRAP_C * sp, P.y + W.y * STRAP_A * cp + N.y * STRAP_C * sp, P.z + W.z * STRAP_A * cp + N.z * STRAP_C * sp);
      const nx = W.x * (cp / STRAP_A) + N.x * (sp / STRAP_C), ny = W.y * (cp / STRAP_A) + N.y * (sp / STRAP_C), nz = W.z * (cp / STRAP_A) + N.z * (sp / STRAP_C);
      const l = Math.hypot(nx, ny, nz);
      nrm.push(nx / l, ny / l, nz / l);
      uvs.push(i / STRAP_SEG, k / STRAP_SIDES);
    }
  }
  const row = STRAP_SIDES + 1;
  for (let i = 0; i < STRAP_SEG; i++) {
    for (let k = 0; k < STRAP_SIDES; k++) {
      const a0 = i * row + k, a1 = a0 + 1, b0 = a0 + row, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  // The slider: an eight-sided sleeve round the strap where the loop closes, with flat ends.
  const f = frames[slider]!;
  const base = pos.length / 3;
  const SA = STRAP_A + 0.0014, SC = STRAP_C + 0.0022, SL = 0.0055;
  for (const e of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      const ph = (2 * Math.PI * (k + 0.5)) / 8, cp = Math.cos(ph), sp = Math.sin(ph);
      const x = f.P.x + f.W.x * SA * cp + f.N.x * SC * sp + f.T.x * SL * e;
      const y = f.P.y + f.W.y * SA * cp + f.N.y * SC * sp + f.T.y * SL * e;
      const z = f.P.z + f.W.z * SA * cp + f.N.z * SC * sp + f.T.z * SL * e;
      // Side vertices and end vertices (each with its own normal).
      pos.push(x, y, z, x, y, z);
      const nx = f.W.x * cp + f.N.x * sp, ny = f.W.y * cp + f.N.y * sp, nz = f.W.z * cp + f.N.z * sp;
      nrm.push(nx, ny, nz, f.T.x * e, f.T.y * e, f.T.z * e);
      uvs.push(0, 2, 0, 2);
    }
  }
  const sv = (e: number, k: number, end: number): number => base + ((e * 8 + (k % 8)) * 2) + end;
  for (let k = 0; k < 8; k++) idx.push(sv(0, k, 0), sv(1, k, 0), sv(0, k + 1, 0), sv(0, k + 1, 0), sv(1, k, 0), sv(1, k + 1, 0));
  for (const e of [0, 1]) for (let k = 1; k < 7; k++) idx.push(sv(e, 0, 1), sv(e, k, 1), sv(e, k + 1, 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  fixWinding(geo);
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, cordMat);
  m.name = 'cord';
  m.castShadow = true;
  return m;
}

/** Wind every triangle so its face normal agrees with its vertices' normals (front faces out). */
function fixWinding(g: THREE.BufferGeometry): void {
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), I = g.index!;
  for (let t = 0; t < I.count; t += 3) {
    const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
    const ux = P.getX(b) - P.getX(a), uy = P.getY(b) - P.getY(a), uz = P.getZ(b) - P.getZ(a);
    const vx = P.getX(c) - P.getX(a), vy = P.getY(c) - P.getY(a), vz = P.getZ(c) - P.getZ(a);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const nx = N.getX(a) + N.getX(b) + N.getX(c), ny = N.getY(a) + N.getY(b) + N.getY(c), nz = N.getZ(a) + N.getZ(b) + N.getZ(c);
    if (cx * nx + cy * ny + cz * nz < 0) { I.setX(t + 1, c); I.setX(t + 2, b); }
  }
}
