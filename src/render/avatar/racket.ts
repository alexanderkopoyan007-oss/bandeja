// The padel racket as drawn (render only; the sim's racket is data/rackets.json). Racket frame: the origin is the
// face centre, +y runs to the tip, +z is the face normal, x across the face.
//
// Built to the FIP limits (Rules of Padel, Annex: 45.5 cm long at most, 26 cm wide, 38 mm thick, holes 9-13 mm) and to
// how a current racket is made: two thin carbon or glass skins over an EVA core inside a tubular frame. The tip is
// 14.5 cm above the face centre and the butt 31 cm below it (as rackets.json has them) for every shape. Each player
// has their own racket (data/racket-looks/p*.json): shape (round, teardrop, diamond), throat, holes and graphics.
//
// One racket is one mesh (one draw call) plus the wrist cord, with a level of detail for the broadcast camera:
// - the frame's tube: a rounded profile swept round the outline and round the throat's opening, glossy and
//   clear-coated, its sides printed from a strip of the racket's texture;
// - the faces: flat, a hair below the frame's band (a crisp edge), matte with a gritty finish (racketMaterial.ts),
//   printed with the racket's graphic (racketArt.ts; mirrored on the back so it reads the same from either side);
// - the holes: a designed layout (rows following the outline, a grid inside, blank zones for graphics), each with a
//   chamfer and a wall that shows the core: light foam between two thin dark skins;
// - the protector over the top of the frame, a little raised, solid or translucent, with tapered ends;
// - the handle: overgrip wound in an overlapping spiral (a real step at each turn), a finishing tape at the top, the
//   butt cap with a logo plate on its end, and the wrist cord through it.
// The near level is about 13k triangles; the far one (about 1.4k, no through-holes: sub-pixel holes shimmer) is used
// when the racket is small on screen (`RacketLod`).
import * as THREE from 'three/webgpu';
import p1 from '../../../data/racket-looks/p1.json' with { type: 'json' };
import p2 from '../../../data/racket-looks/p2.json' with { type: 'json' };
import p3 from '../../../data/racket-looks/p3.json' with { type: 'json' };
import p4 from '../../../data/racket-looks/p4.json' with { type: 'json' };
import { racketArt, ART, type ArtShape } from './racketArt.ts';
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
/** Half the frame's thickness: faces at +-T2 (36 mm; FIP allows 38 and the protector adds under 1 mm a side). */
export const FACE_T2 = 0.018;
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
/** Finishing tape over the top of the grip and the neck. */
const TAPE_Y0 = -0.19;
const TAPE_Y1 = -0.1635;
/** Overgrip: axial advance per turn, the step at each turn (m). */
export const GRIP_PITCH = 0.0165;
const GRIP_STEP = 0.0007;
export const GRIP_Y0 = CAP_TOP - 0.003;
/** Protector: how far it stands off the frame, and how far it reaches onto the band past the rounded edge (m). */
const BUMPER_T = 0.0009;
const BUMPER_LIP = 0.0025;
/** The frame's outline tops out under the protector, so the racket with it is RACKET_TIP long above the centre. */
const OUTLINE_TIP = RACKET_TIP - BUMPER_T;

/** Region codes the material reads (rkInfo.x). Every triangle is one region. */
export const RK_FACE = 0, RK_FRAME = 1, RK_WALL = 2, RK_BUMPER = 3, RK_GRIP = 4, RK_TAPE = 5, RK_CAP = 6, RK_LOGO = 7, RK_FACE_FAR = 8;

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
 * round racket (26 x 28 cm, widest at the face centre). Teardrop: widest 3 cm above the face centre, the top a little
 * flatter, tapering longer into the throat. Diamond: widest 5.5 cm up, broad flat shoulders, near-straight sides
 * down to the throat (the head-heavy attacking shape).
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
    const c: V2[] = [[0, T], [0.052, T - 0.0045], [0.093, 0.122], [0.119, 0.088], [0.1295, 0.044], [0.129, 0.008],
      [0.121, -0.03], [0.106, -0.062], [0.09, -0.086]];
    return widest(catmull(c, 14, [-0.052, T - 0.0045], [0.074, -0.105]));
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
  // top under the bridge; a teardrop has a rounder top and a sharper point, a triangle the other way round.
  const arms = offsetBy(outer, nIn, ARM_W);
  const topY = (x: number): number => bridgeY(shape, x) - BRIDGE_W;
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
  const tri = look.throat === 'triangle';
  const heart = joinRounded([side, top, leftSide], tri ? [0.007, 0.007, 0.009] : [0.013, 0.013, 0.005]);

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
function profile(steps: number, rc: number): Array<{ n: number; z: number; gn: number; gz: number; back: boolean }> {
  const out: Array<{ n: number; z: number; gn: number; gz: number; back: boolean }> = [];
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
    out.push({ n, z, gn: -gx, gz, back: z < 0 || (z === 0 && k > steps / 2) });
  }
  return out;
}

/** Strip UV for a point `s` (m) along a perimeter of length `L`, across the profile at `v` (0 back .. 1 front). */
function stripUv(s: number, L: number, v: number, half: number): [number, number] {
  return ART.sideUv(half, (s - half * L * 0.5) / (L * 0.5), v);
}

/**
 * The frame's tube along a closed loop `pl`, `into` the unit normals into the material: the profile from the
 * band's edge (rc in) round the outside to the back's. `strip`: side printing along the loop (the outline), else the
 * band's colour. The loop is split at its start and halfway (each half its own strip of the texture).
 */
function sweep(b: Builder, pl: V2[], into: V2[], rc: number, steps: number, strip: boolean): void {
  const prof = profile(steps, rc);
  const L = polyLength(pl, true);
  const m = pl.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1]! + Math.hypot(pl[i % m]![0] - pl[i - 1]![0], pl[i % m]![1] - pl[i - 1]![1]));
  const mid = Math.round(m / 2);
  // Stations: 0..mid on the first half, mid..m on the second (mid and m duplicated with their own strip UVs).
  for (const [i0, i1, half] of [[0, mid, 0], [mid, m, 1]] as const) {
    let prev: number[] | null = null;
    for (let i = i0; i <= i1; i++) {
      const p = pl[i % m]!, N = into[i % m]!;
      const row: number[] = [];
      for (let k = 0; k < prof.length; k++) {
        const q = prof[k]!;
        const x = p[0] + N[0] * q.n, y = p[1] + N[1] * q.n;
        const nx = N[0] * q.gn, ny = N[1] * q.gn;
        const vv = 1 - k / (prof.length - 1);
        const [us, vs] = strip ? stripUv(cum[i]!, L, vv, half) : [0, 0];
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

/** A hole through the core: the chamfer on each face and the wall between (region RK_WALL; the shader bands it). */
function hole(b: Builder, cx: number, cy: number, r: number, n: number): void {
  const zf = T2 - FACE_STEP;
  const rings: Array<{ r: number; z: number; nr: number; nz: number }[]> = [
    // Front chamfer, the wall, back chamfer: each its own normals (crisp edges between).
    [{ r: r + CHAMFER, z: zf, nr: -1, nz: 1 }, { r, z: zf - CHAMFER, nr: -1, nz: 1 }],
    [{ r, z: zf - CHAMFER, nr: -1, nz: 0 }, { r, z: -zf + CHAMFER, nr: -1, nz: 0 }],
    [{ r, z: -zf + CHAMFER, nr: -1, nz: -1 }, { r: r + CHAMFER, z: -zf, nr: -1, nz: -1 }],
  ];
  for (const pair of rings) {
    const ids: number[][] = [[], []];
    for (let j = 0; j < 2; j++) {
      const q = pair[j]!;
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n, ca = Math.cos(a), sa = Math.sin(a);
        ids[j]!.push(b.v(cx + q.r * ca, cy + q.r * sa, q.z, q.nr * ca, q.nr * sa, q.nz, RK_WALL, q.z < 0));
      }
    }
    for (let k = 0; k < n; k++) b.quad(ids[0]![k]!, ids[0]![(k + 1) % n]!, ids[1]![(k + 1) % n]!, ids[1]![k]!);
  }
}

/** The bridge's logo plate: a rounded rectangle standing PLATE_T proud of the band on each face (its print is the art's). */
const PLATE_W = 0.026, PLATE_H = 0.0072, PLATE_T = 0.0005;
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
 * The protector over the top of the frame: the frame's profile stood off by BUMPER_T, reaching BUMPER_LIP onto the
 * band each side, `span` metres long centred on the tip, thinning over its last 12 mm to a squared-off end.
 */
function bumper(b: Builder, outer: V2[], into: V2[], span: number, stations: number, steps: number): void {
  const L = polyLength(outer, true);
  const m = outer.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1]! + Math.hypot(outer[i % m]![0] - outer[i - 1]![0], outer[i % m]![1] - outer[i - 1]![1]));
  const at = (s: number): { p: V2; N: V2; s: number } => {
    let j = 0;
    while (j < m - 1 && cum[j + 1]! < s) j++;
    const u = (s - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
    const N = lerp2(into[j]!, into[(j + 1) % m]!, u);
    const l = Math.hypot(N[0], N[1]);
    return { p: lerp2(outer[j]!, outer[(j + 1) % m]!, u), N: [N[0] / l, N[1] / l], s };
  };
  const prof = profile(steps, RC);
  const s0 = L / 2 - span / 2, s1 = L / 2 + span / 2;
  const half = (s: number): number => (s < L / 2 ? 0 : 1);
  let prev: number[] | null = null;
  for (let i = 0; i <= stations; i++) {
    const s = s0 + ((s1 - s0) * i) / stations;
    const { p, N } = at(s);
    const fromEnd = Math.min(s - s0, s1 - s);
    const taper = 0.45 + 0.55 * Math.min(1, fromEnd / 0.012) ** 0.6;
    const t = BUMPER_T * taper, lip = BUMPER_LIP * taper;
    const pts: Array<{ n: number; z: number; gn: number; gz: number }> = [];
    // Front lip on the band, up onto the bumper's face, round the profile, down onto the back's band.
    pts.push({ n: RC + lip, z: T2 + 0.00005, gn: 0.3, gz: 1 });
    pts.push({ n: RC + lip - t * 0.9, z: T2 + t, gn: 0, gz: 1 });
    for (const q of prof) {
      const gl = Math.hypot(q.gn, q.gz);
      pts.push({ n: q.n + (q.gn / gl) * t, z: q.z + (q.gz / gl) * t, gn: q.gn, gz: q.gz });
    }
    pts.push({ n: RC + lip - t * 0.9, z: -T2 - t, gn: 0, gz: -1 });
    pts.push({ n: RC + lip, z: -T2 - 0.00005, gn: 0.3, gz: -1 });
    const row: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const q = pts[k]!;
      const x = p[0] + N[0] * q.n, y = p[1] + N[1] * q.n;
      const vv = 1 - k / (pts.length - 1);
      const [us, vs] = stripUv(s, L, Math.min(1, Math.max(0, vv)), half(s));
      row.push(b.v(x, y, q.z, N[0] * q.gn, N[1] * q.gn, q.gz, RK_BUMPER, q.z < 0, us, vs, 1));
    }
    if (prev) for (let k = 0; k < row.length - 1; k++) b.quad(prev[k]!, prev[k + 1]!, row[k + 1]!, row[k]!);
    prev = row;
    if (i === 0 || i === stations) {
      // The end: the bumper's profile closed down onto the frame's, facing along the frame away from the bumper.
      const sg = i === 0 ? -1 : 1;
      const tx = N[1] * sg, ty = -N[0] * sg;
      const endIds: number[] = [];
      for (let k = 0; k < pts.length; k++) {
        const q = pts[k]!;
        endIds.push(b.v(p[0] + N[0] * q.n, p[1] + N[1] * q.n, q.z, tx, ty, 0, RK_BUMPER, q.z < 0, 0, 0, 1));
      }
      const inner: number[] = [];
      for (let k = 0; k < prof.length; k++) {
        const q = prof[k]!;
        inner.push(b.v(p[0] + N[0] * q.n, p[1] + N[1] * q.n, q.z, tx, ty, 0, RK_BUMPER, q.z < 0, 0, 0, 1));
      }
      // Bumper points 2..2+prof stand over the frame's profile points.
      for (let k = 0; k < prof.length - 1; k++) b.quad(endIds[k + 2]!, endIds[k + 3]!, inner[k + 1]!, inner[k]!);
      const e = pts.length - 1;
      b.quad(endIds[0]!, endIds[1]!, endIds[2]!, inner[0]!);
      b.quad(endIds[e]!, endIds[e - 1]!, endIds[e - 2]!, inner[prof.length - 1]!);
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

function handle(b: Builder, cols: number, far: boolean): void {
  if (far) {
    lathe(b, [[HANDLE_R_BUTT, CAP_TOP], [HANDLE_R, TAPE_Y0]], cols, RK_GRIP);
  } else grip(b, cols);
  // Finishing tape: over the overgrip's end, flaring over the neck.
  const tr = HANDLE_R + GRIP_STEP * 0.5 + 0.0004;
  const tape: V2[] = far
    ? [[tr, TAPE_Y0], [tr, -0.181], [0.0204, -0.1715], [0.0204, TAPE_Y1], [0.0197, TAPE_Y1 + 0.0004], [0.0148, TAPE_Y1 + 0.0008]]
    : [[tr - 0.0006, TAPE_Y0 - 0.0002], [tr, TAPE_Y0 + 0.0006], [tr, -0.182], [tr + 0.0005, -0.1785], [0.0198, -0.1745], [0.0203, -0.1715],
      [0.0204, TAPE_Y1 - 0.0006], [0.0202, TAPE_Y1 + 0.0001], [0.0196, TAPE_Y1 + 0.0004],
      // Wrapped over onto the neck (narrower than the tape across the face): closes the collar's top.
      [0.0175, TAPE_Y1 + 0.0007], [0.0148, TAPE_Y1 + 0.0008]];
  lathe(b, tape, cols, RK_TAPE, (u, k) => ART.tapeUv(u, (tape[k]![1] - TAPE_Y0) / (TAPE_Y1 - TAPE_Y0)));
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

/** One level of a racket: the head (frame, faces, holes, throat, protector) and the handle, as one geometry. */
function buildLevel(look: RacketLook, far: boolean): THREE.BufferGeometry {
  const s = racketShape(look);
  const b = new Builder();
  const nOut = far ? 56 : 116;
  const outer = resample(s.outer, nOut, true, 4);
  const into = leftNormals(outer, true);
  const bandEdge = offsetBy(outer, into, RC);
  const face = resample(s.face, far ? 44 : 120, true, 3);
  const heart = resample(s.heart, far ? 18 : 44, true, 4);
  // The heart's loop is counter-clockwise round the opening: into the material is to its right.
  const hIn = leftNormals(heart, true).map((p) => [-p[0], -p[1]] as V2);
  const heartEdge = offsetBy(heart, hIn, RC_H);

  sweep(b, outer, into, RC, far ? 6 : 10, true);
  sweep(b, heart, hIn, RC_H, far ? 4 : 8, false);
  bumper(b, outer, into, look.bumper.span, far ? 16 : 40, far ? 6 : 10);
  // The band (frame, flush with the profile) round the face and the throat; the face a hair below it.
  for (const z of [T2, -T2]) flat(b, bandEdge, [face, heartEdge], z, RK_FRAME);
  if (!far) plate(b, plateCentre(s), 4);
  if (far) {
    for (const z of [T2 - FACE_STEP, -(T2 - FACE_STEP)]) flat(b, face, [], z, RK_FACE_FAR);
  } else {
    step(b, face);
    const hn = 12;
    const rings = s.holes.map(([x, y]) => circle(x, y, s.holeR + CHAMFER, hn));
    for (const z of [T2 - FACE_STEP, -(T2 - FACE_STEP)]) flat(b, face, rings, z, RK_FACE);
    for (const [x, y] of s.holes) hole(b, x, y, s.holeR, hn);
  }
  handle(b, far ? 12 : 22, far);
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
    holes: s.holes, holeEdge: s.holeR + CHAMFER, plateY: plateCentre(s),
  };
  const art = racketArt(look, shape);
  const dims = { t2: T2, step: FACE_STEP, skin: SKIN_T, pitch: GRIP_PITCH, gripY0: GRIP_Y0 };
  p = { near: buildLevel(look, false), far: buildLevel(look, true), material: racketMaterial(art, look, dims) };
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

/**
 * The wrist cord (FIP: rackets carry one, and players wear it): a loop round the wrist, `wristR` out from its axis,
 * and the cord from it to the butt cap, which it leaves through the end plate. `wrist` and `forearm` (towards the
 * elbow) are in the racket's frame.
 */
export function makeWristCord(wrist: THREE.Vector3, forearm: THREE.Vector3, wristR: number): THREE.Mesh {
  cordMat ??= cordMaterial();
  const up = forearm.clone().normalize();
  // The loop sits just up the forearm from the joint (it rides on the hand: further up, the bent wrist cut it).
  const c = wrist.clone().addScaledVector(up, 0.012);
  const a = new THREE.Vector3(0, -1, 0).addScaledVector(up, up.y).normalize();
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
  const b = new THREE.Vector3().crossVectors(up, a).normalize();
  const r = wristR + 0.004;
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
  const geo = new THREE.TubeGeometry(curve, 48, 0.0026, 5, false);
  const m = new THREE.Mesh(geo, cordMat);
  m.name = 'cord';
  m.castShadow = true;
  return m;
}
