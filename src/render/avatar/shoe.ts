// The trainers, made for each foot as a person loads (the owner's realism list, point 7: "black blob shoes"). The relief pass
// gave them laces, stitching and a tread, but the shape stayed MakeHuman's one trainer (shoes05): a soft slipper whose sole
// is only painted on, with a bulbous toe and a cup round the ankle. Padel shoes are a midsole and an outsole of their own
// under an upper: the sole flares a little past the upper and wraps up round the heel and over the toe, the toe springs up
// off the floor, the collar is padded and dips under the ankle bones between a heel tab and the top eyelets, and the
// throat is a slot between two eyestays, laced across a padded tongue that stands up above them against the shin.
//
// Measured from the person, never typed: the old trainer (MPFB fitted it to the foot) gives each foot's floor, axis,
// length and footprint, and the sock gives the collar (it closes round every sock cut with room for the padding, and
// never below where the sock reaches down into it), the top of the foot the tongue and the upper lie over, and the shin the
// tongue leans on. The heights are a size 43's (EU), scaled by the foot's length: they are the shoe's design, not the body's.
//
// The mesh is rings round the opening (the collar, then forward along the eyestays to the slot's end): from a line down
// the middle of the outsole out to its edge, up the midsole's wall, across the ledge the upper stands on, up the upper,
// over the collar's roll, then back down inside (the lining, the inside of the upper) to the insole; and the tongue, a
// padded strip of its own under the slot. Each vertex carries (bodyX) its occlusion, where on the shoe it is (0 outsole,
// 0.5 midsole, 1 + its height over the midsole in cm on the upper, 20 + that on the tongue), how far along the foot (0 heel,
// 1 toe) and how far across it (m, the outside +): kit.ts paints and carves the shoe from those, so a pair chosen in the
// locker (paint.ts) colours it as before. Skin weights come from the old trainer's nearest vertices (its collar moves with
// the shin, its toe with the toes).
import * as THREE from 'three/webgpu';
import type { Wardrobe } from './asset.ts';

/** What kit.ts needs to lace the shoe: its length (m, the two feet's mean), the laces from and to (fractions along), the
 * slot's half width at both ends and where the eyelets stand out from its edge (m), and the heights' scale. */
/**
 * The trainer the feet's animation was tuned on, as it stood in the rest pose: its vertices and their skinning. soles.ts finds
 * the feet's contact points on it, not on the shoe: those points were never the real sole (DECISIONS.md, item 7), and every
 * change to the shoe moved them and the legs with them (the jump smash's knees 37 to 42 degrees at the ball).
 */
export interface SoleRef { pos: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array }

export interface ShoeFit {
  length: number;
  laceFrom: number;
  laceTo: number;
  gapFrom: number;
  gapTo: number;
  eyelets: number;
  /** This foot's length over a size 43's. */
  k: number;
}

/** Points round every ring. */
export const SHOE_ROUND = 48;
/** A size 43's outsole (m). */
const REF_LENGTH = 0.285;
/** Slices along the foot for the footprint. */
const SLICES = 40;
// The sole (m, a size 43's): the heel's bottom rounded up over its last 6% (4 mm), toe spring over the front third (13 mm
// at the tip), the outsole 3.5 mm thick, the midsole's top 35 mm at the heel's back (the cup), 31 at the heel, 20 under the
// ball, wrapping 12 mm further up over the toe (the bumper), 5 mm higher under the arch on the inside; the sole 1.5 mm
// wider than the old trainer's footprint (3 more round the heel) and the upper standing 4.5 mm in from its edge.
const HEEL_ROUND_U = 0.06, HEEL_ROUND = 0.004, SPRING_FROM = 0.64, SPRING = 0.013, OUTSOLE = 0.0035;
const CUP = 0.035, HEEL = 0.031, BALL = 0.02, BUMPER = 0.012, ARCH = 0.005;
const FLARE = 0.0015, HEEL_FLARE = 0.003, LEDGE = 0.0045;
/** The footprint's outside no further in than this under the line over its widest (the inside keeps the trainer's waist). */
const WAIST_OUT = 0.004;
// The upper: the toe box's wall 16 mm over the midsole; above it no steeper than 1 in 2 (rise over run) towards the collar;
// corners rounded 12 mm where the wall turns, 10 where it meets the collar.
const TOE_BOX = 0.016, SLOPE = 0.5, CORNER = 0.012, RIM_ROUND = 0.01;
// The collar, round from the heel (0 degrees) by the outside to the top eyelet's side (100): heights (m, a size 43's).
const RIM_AT = [0, 25, 60, 85, 100];
const RIM_H = [0.09, 0.084, 0.068, 0.066, 0.07];
// Room between the sock and the collar's edge (its padding and a finger's play); the collar at least this far over the
// lowest of the sock below it; the collar fits round the sock within RIM_BAND of its own height (lower down the shoe
// covers it, and MakeHuman's sock runs on forward over the top of the foot).
const ROOM = 0.012, OVER_SOCK = 0.012, RIM_BAND = 0.006;
// The upper stays this far over the sock wherever the sock is under it.
const OVER_FOOT = 0.004, FOOT_CELL = 0.004;
/** The old trainer's top less this is the top of the foot where no sock says (how far it stood over the sock on p1's instep). */
const OLD_THICK = 0.017;
// The collar's roll (a padded collar about a centimetre thick, its lining a millimetre or two off the sock); along the
// eyestays a thin folded edge.
const ROLL_UP = 0.004, ROLL_IN = 0.006, LINING_IN = 0.0105, EDGE_UP = 0.0015, EDGE_IN = 0.002, EDGE_LINING = 0.003;
// (the lining at least this far off the sock, the collar at least this far inside the ledge, and never thinner than MIN_PAD)
const LINING_GAP = 0.0015, WELT_IN = 0.002, MIN_PAD = 0.003;
// The throat: the tongue's top this high (a size 43's), leaning on the shin; the slot between the eyestays this wide each
// side of the middle at the top eyelet and at the bottom one, which is LACE_TO along the foot; the eyelets this far out
// from the slot's edge; the tongue tucked this far under each eyestay, this thick and this much higher in its middle.
const TONGUE_TOP = 0.1, GAP_TOP = 0.011, GAP_BOT = 0.006, LACE_TO = 0.74, EYELETS_OUT = 0.006;
const TUCK = 0.02, TONGUE_T = 0.005, CAMBER = 0.003, TONGUE_NEAR = 0.01, TONGUE_DROP = 0.025;
/** The upper's thickness (its inside is drawn: the lining down to the insole, which is this far over the midsole's top). */
const INNER = 0.0035, INSOLE = 0.004;
const COLLAR_HOLD = 0.035, CORNER_HOLD = 0.3, SOCK_REACH = 0.05, SOCK_PIECE = 0.2;
/** Sock-coded vertices this far over the trainer's bottom at most are socks (a knee sock's top is about half a metre up). */
const SOCK_TOP = 0.7;
/** Share of each half of the rim round the collar (the rest runs along the eyestay). */
const COLLAR_SHARE = 0.6, COLLAR_DEG = [100, 130], COLLAR_BEHIND = 0.018, COLLAR_THIN = 0.5;
/** Rings: the outsole's bottom (4), its edge (2), the midsole (4), the ledge (1), the upper (14), the roll (1), the lining (1),
 * the inside (one under each of the upper's but its top and bottom: on every third, the lining's straight runs between them came
 * out through the upper where it curves in, dark ticks on the toe box, as the body's material draws both sides), the insole (3). */
const UPPER_RINGS = 14, INSIDE_FROM = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export const SHOE_RINGS = 11 + UPPER_RINGS + 2 + INSIDE_FROM.length + 3;
/** The tongue: stations up it, points round it. */
const TONGUE_STATIONS = 14, TONGUE_ROUND = 12;

interface Built {
  pos: Float64Array;
  /** bodyX: occlusion, where on the shoe, along, across. */
  x: Float32Array;
  tris: Uint32Array;
  length: number;
  laceFrom: number;
  laceTo: number;
  k: number;
  /** The sock's vertices as given, those round the collar pulled in under it. */
  sock: Float32Array;
  /** Per vertex, how much it moves with the leg in it rather than the foot under it (0 to 1). */
  hold: Float32Array;
  /** Per vertex, the vertex whose skinning it takes (-1: its own): a layer moves with what it lines. */
  twin: Int32Array;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Periodic smoothing of a closed list of 2D points (or one number per point with dim 1), in place. */
function relax(p: Float64Array, dim: number, passes: number): void {
  const n = p.length / dim, t = new Float64Array(p.length);
  for (let s = 0; s < passes; s++) {
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      for (let c = 0; c < dim; c++) t[i * dim + c] = 0.25 * p[a * dim + c]! + 0.5 * p[i * dim + c]! + 0.25 * p[b * dim + c]!;
    }
    p.set(t);
  }
}

/** Resample the open polyline `pts` (x, y pairs) at `count` points evenly by length, ends included. */
function resample(pts: number[], count: number): Float64Array {
  const n = pts.length / 2, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!));
  const total = cum[n - 1]!, out = new Float64Array(count * 2);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (total * k) / (count - 1);
    while (j < n - 2 && cum[j + 1]! < s) j++;
    const f = cum[j + 1]! > cum[j]! ? clamp01((s - cum[j]!) / (cum[j + 1]! - cum[j]!)) : 0;
    out[k * 2] = pts[j * 2]! + (pts[j * 2 + 2]! - pts[j * 2]!) * f;
    out[k * 2 + 1] = pts[j * 2 + 1]! + (pts[j * 2 + 3]! - pts[j * 2 + 1]!) * f;
  }
  return out;
}

/**
 * The upper's profile from the ledge (0, 0) to the rim (run, rise), in the plane through both: a wall up to the toe box's
 * height (or as high as the slope needs), leaning in a little, round its corner, then no steeper than SLOPE, arriving level.
 * Returned as `count` points evenly by length, the start left out and the end included.
 */
function profile(run: number, rise: number, k: number, count: number): Float64Array {
  const wall = Math.min(rise, Math.max(TOE_BOX * k, rise - run * SLOPE));
  const lean = Math.min(run * 0.3, wall * 0.12);
  const r1 = Math.max(0, Math.min(CORNER * k, wall * 0.6, Math.hypot(run - lean, rise - wall) * 0.4));
  const r2 = Math.max(0, Math.min(RIM_ROUND * k, (run - lean) * 0.4));
  const pts: number[] = [];
  const line = (ax: number, ay: number, bx: number, by: number, n: number): void => {
    for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
  };
  const bez = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, n: number): void => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, s = 1 - t;
      pts.push(s * s * ax + 2 * s * t * cx + t * t * bx, s * s * ay + 2 * s * t * cy + t * t * by);
    }
  };
  // The corner B, the end C, and the point Ec it arrives level from.
  const bx = lean, by = wall, ex = run - r2, ey = rise;
  const l1 = Math.hypot(bx, by) || 1, l2 = Math.hypot(ex - bx, ey - by) || 1;
  const b1x = bx - (bx / l1) * r1, b1y = by - (by / l1) * r1;
  const b2x = bx + ((ex - bx) / l2) * r1, b2y = by + ((ey - by) / l2) * r1;
  const sx = ex - ((ex - bx) / l2) * r2, sy = ey - ((ey - by) / l2) * r2;
  line(0, 0, b1x, b1y, 6);
  if (r1 > 0) bez(b1x, b1y, bx, by, b2x, b2y, 8);
  line(b2x, b2y, sx, sy, 16);
  if (r2 > 0) bez(sx, sy, ex, ey, run, rise, 8);
  const all = resample(pts, count + 1);
  return all.subarray(2);
}

/**
 * One foot's shoe. `old`: the trainer's vertices (bind pose, world) and `oldN` their normals, `sock`: every sock cut's on this side, `lateral`: +1 if the
 * outside of this foot is +x. Positions in the bind pose; triangles wind outwards.
 */
function buildShoe(old: Float32Array, oldN: Float32Array, sock: Float32Array, lateral: number): Built {
  const n = old.length / 3;
  let floor = Infinity;
  for (let i = 0; i < n; i++) floor = Math.min(floor, old[i * 3 + 1]!);
  // The axis: the footprint's own (principal axis of the bottom's vertices).
  let cx = 0, cz = 0, m = 0;
  for (let i = 0; i < n; i++) if (old[i * 3 + 1]! < floor + 0.015) { cx += old[i * 3]!; cz += old[i * 3 + 2]!; m++; }
  cx /= m; cz /= m;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < n; i++) {
    if (old[i * 3 + 1]! >= floor + 0.015) continue;
    const x = old[i * 3]! - cx, z = old[i * 3 + 2]! - cz;
    sxx += x * x; szz += z * z; sxz += x * z;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, szz - sxx);
  let dx = Math.sin(ang), dz = Math.cos(ang);
  if (dz < 0) { dx = -dx; dz = -dz; }
  // across: the outside of the foot +
  let ax = dz, az = -dx;
  if (ax * lateral < 0) { ax = -ax; az = -az; }
  const along = (x: number, z: number): number => (x - cx) * dx + (z - cz) * dz;
  const across = (x: number, z: number): number => (x - cx) * ax + (z - cz) * az;
  let heel = Infinity, toe = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = along(old[i * 3]!, old[i * 3 + 2]!);
    heel = Math.min(heel, a); toe = Math.max(toe, a);
  }
  const L = toe - heel, k = L / REF_LENGTH;
  const uOf = (a: number): number => (a - heel) / L;
  // The footprint: per slice along, the trainer's furthest reach either side below its collar (its widest is low down).
  const out = new Float64Array(SLICES).fill(-1), inn = new Float64Array(SLICES).fill(-1);
  for (let i = 0; i < n; i++) {
    if (old[i * 3 + 1]! > floor + 0.05 * k) continue;
    const a = along(old[i * 3]!, old[i * 3 + 2]!), c = across(old[i * 3]!, old[i * 3 + 2]!);
    const s = Math.min(SLICES - 1, Math.floor(uOf(a) * SLICES));
    out[s] = Math.max(out[s]!, c);
    inn[s] = Math.max(inn[s]!, -c);
  }
  for (const w of [out, inn]) for (let s = 0; s < SLICES; s++) if (w[s]! < 0) w[s] = s ? w[s - 1]! : 0.02 * k;
  // (the outside runs out to its widest and back in, dipping by WAIST_OUT at most: a MetaHuman's trainer has no vertices low
  // on its outside at mid-foot, and the 3.4 cm notch that left creased the upper over it in a line from the sole to the collar)
  const env = new Float64Array(SLICES);
  for (let s = 0, m = -Infinity; s < SLICES; s++) env[s] = m = Math.max(m, out[s]!);
  for (let s = SLICES - 1, m = -Infinity; s >= 0; s--) { m = Math.max(m, out[s]!); env[s] = Math.min(env[s]!, m); }
  for (let s = 0; s < SLICES; s++) out[s] = Math.max(out[s]!, env[s]! - WAIST_OUT * k);
  const midAt = (a: number): number => {
    const s = Math.min(SLICES - 1, Math.max(0, Math.floor(uOf(a) * SLICES)));
    return (out[s]! - inn[s]!) / 2;
  };

  // The top of the foot under the shoe (the sock's top per 4 mm cell, below the tongue's top: the tube goes on up through
  // the collar), raw for the upper to clear and smoothed for the tongue to lie on.
  const gx0 = heel - 0.01, gy0 = -0.08, gnx = Math.ceil((L + 0.02) / FOOT_CELL), gny = Math.ceil(0.16 / FOOT_CELL);
  const footTop = new Float64Array(gnx * gny).fill(-Infinity);
  for (let i = 0; i < sock.length / 3; i++) {
    if (sock[i * 3 + 1]! - floor > TONGUE_TOP * k) continue;
    const a = along(sock[i * 3]!, sock[i * 3 + 2]!), c = across(sock[i * 3]!, sock[i * 3 + 2]!);
    const gi = Math.floor((a - gx0) / FOOT_CELL), gj = Math.floor((c - gy0) / FOOT_CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = gi + di, jj = gj + dj;
      if (ii < 0 || jj < 0 || ii >= gnx || jj >= gny) continue;
      footTop[jj * gnx + ii] = Math.max(footTop[jj * gnx + ii]!, sock[i * 3 + 1]! - floor);
    }
  }
  // (and the old trainer's top OLD_THICK down, its upward faces spread over the cells round them: it was fitted round the
  // foot, and a MetaHuman's sock is only the leg's tube; below the tongue's top as the sock is, or its own tongue at the
  // ankle lifted the top eyelet's corners 4 cm over the collar)
  for (let i = 0; i < n; i++) {
    if (oldN[i * 3 + 1]! < 0.3 || old[i * 3 + 1]! - floor - OLD_THICK * k > TONGUE_TOP * k) continue;
    const a = along(old[i * 3]!, old[i * 3 + 2]!), c = across(old[i * 3]!, old[i * 3 + 2]!);
    const gi = Math.floor((a - gx0) / FOOT_CELL), gj = Math.floor((c - gy0) / FOOT_CELL);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const ii = gi + di, jj = gj + dj;
      if (ii < 0 || jj < 0 || ii >= gnx || jj >= gny) continue;
      footTop[jj * gnx + ii] = Math.max(footTop[jj * gnx + ii]!, old[i * 3 + 1]! - floor - OLD_THICK * k);
    }
  }
  const footAt = (a: number, c: number): number => {
    const ii = Math.floor((a - gx0) / FOOT_CELL), jj = Math.floor((c - gy0) / FOOT_CELL);
    return ii < 0 || jj < 0 || ii >= gnx || jj >= gny ? -Infinity : footTop[jj * gnx + ii]!;
  };
  // (along the middle of the foot: per cell along, the top within 1.2 cm of the middle, smoothed; where the sock isn't, the
  // old trainer's top less a centimetre)
  const ridge = new Float64Array(gnx).fill(-Infinity);
  for (let ii = 0; ii < gnx; ii++) {
    const a = gx0 + (ii + 0.5) * FOOT_CELL, mid = midAt(a);
    for (let c = -0.012 * k; c <= 0.012 * k; c += FOOT_CELL / 2) ridge[ii] = Math.max(ridge[ii]!, footAt(a, mid + c));
  }
  const oldTop = new Float64Array(gnx).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const a = along(old[i * 3]!, old[i * 3 + 2]!), ii = Math.floor((a - gx0) / FOOT_CELL);
    if (oldN[i * 3 + 1]! > 0.3 && ii >= 0 && ii < gnx && Math.abs(across(old[i * 3]!, old[i * 3 + 2]!) - midAt(a)) < 0.015 * k) oldTop[ii] = Math.max(oldTop[ii]!, Math.min(TONGUE_TOP * k, old[i * 3 + 1]! - floor - OLD_THICK * k));
  }
  for (let ii = 0; ii < gnx; ii++) if (!Number.isFinite(ridge[ii]!)) ridge[ii] = oldTop[ii]!;
  for (let ii = 0; ii < gnx; ii++) if (!Number.isFinite(ridge[ii]!)) ridge[ii] = ii ? ridge[ii - 1]! : 0.05 * k;
  for (let pass = 0; pass < 4; pass++) {
    const t = ridge.slice();
    for (let ii = 1; ii < gnx - 1; ii++) ridge[ii] = 0.25 * t[ii - 1]! + 0.5 * t[ii]! + 0.25 * t[ii + 1]!;
  }
  const ridgeAt = (a: number): number => {
    const f = (a - gx0) / FOOT_CELL - 0.5, ii = Math.min(gnx - 2, Math.max(0, Math.floor(f))), w = clamp01(f - ii);
    return ridge[ii]! * (1 - w) + ridge[ii + 1]! * w;
  };

  // The outline: out along the outside from the heel to the toe, back along the inside, the sole a little wider.
  const flare = (u: number): number => FLARE + HEEL_FLARE * (1 - smooth(0.05, 0.2, u));
  const outline = (side: number): number[] => {
    const pts: number[] = [heel, (out[0]! - inn[0]!) / 2];
    for (let s = 0; s < SLICES; s++) {
      const u = (s + 0.5) / SLICES;
      pts.push(heel + u * L, side > 0 ? out[s]! + flare(u) : -(inn[s]! + flare(u)));
    }
    pts.push(toe, (out[SLICES - 1]! - inn[SLICES - 1]!) / 2);
    return pts;
  };
  const N = SHOE_ROUND, H = N / 2;
  const lat = resample(outline(1), H + 1), med = resample(outline(-1), H + 1);
  // (round the outside to the toe and back by the inside: point i of N; the heel's end i = 0, the toe's i = N/2)
  const O = new Float64Array(N * 2);
  for (let i = 0; i <= H; i++) { O[i * 2] = lat[i * 2]!; O[i * 2 + 1] = lat[i * 2 + 1]!; }
  for (let i = 1; i < H; i++) { O[(N - i) * 2] = med[i * 2]!; O[(N - i) * 2 + 1] = med[i * 2 + 1]!; }
  relax(O, 2, 3);
  // Outward normals in plan (away from the line down the middle).
  const nrm = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const tx = O[b * 2]! - O[a * 2]!, ty = O[b * 2 + 1]! - O[a * 2 + 1]!, l = Math.hypot(tx, ty) || 1;
    let na = ty / l, nc = -tx / l;
    const ma = Math.min(Math.max(O[i * 2]!, heel + 0.1 * L), toe - 0.1 * L);
    if (na * (O[i * 2]! - ma) + nc * (O[i * 2 + 1]! - midAt(ma)) < 0) { na = -na; nc = -nc; }
    nrm[i * 2] = na; nrm[i * 2 + 1] = nc;
  }
  const bottom = (u: number): number => HEEL_ROUND * k * (1 - smooth(0, HEEL_ROUND_U, u)) ** 2 + SPRING * k * Math.max(0, (u - SPRING_FROM) / (1 - SPRING_FROM)) ** 2;
  const midTop = (u: number, c: number): number => {
    const base = u < 0.12 ? HEEL + (CUP - HEEL) * (1 - smooth(0, 0.12, u)) : HEEL + (BALL - HEEL) * smooth(0.12, 0.62, u);
    const arch = c < 0 ? ARCH * smooth(0.25, 0.35, u) * (1 - smooth(0.5, 0.6, u)) : 0;
    return bottom(u) + (base + arch + BUMPER * smooth(0.84, 1, u)) * k;
  };

  // The sock: the collar's centre, how far the sock reaches each way round at the collar's height, how low it comes.
  const S = sock.length / 3;
  let ocx = 0, ocz = 0, mc = 0;
  for (let i = 0; i < S; i++) {
    const y = sock[i * 3 + 1]! - floor;
    if (y < 0.06 * k || y > 0.1 * k) continue;
    ocx += along(sock[i * 3]!, sock[i * 3 + 2]!); ocz += across(sock[i * 3]!, sock[i * 3 + 2]!); mc++;
  }
  if (mc) { ocx /= mc; ocz /= mc; } else { ocx = heel + 0.24 * L; ocz = 0; }
  // The throat: the top eyelet in front of the shin where the tongue's top leans on it, the bottom one LACE_TO along.
  let shin = -Infinity;
  for (let s = 0; s < S; s++) {
    const y = sock[s * 3 + 1]! - floor, a = along(sock[s * 3]!, sock[s * 3 + 2]!), c = across(sock[s * 3]!, sock[s * 3 + 2]!);
    if (y > TONGUE_TOP * k - RIM_BAND * k && y < TONGUE_TOP * k + 0.01 * k && Math.abs(c - ocz) < 0.02 * k) shin = Math.max(shin, a);
  }
  if (!Number.isFinite(shin)) shin = heel + 0.42 * L;
  const aTop = shin + 0.004 * k, aBot = Math.max(heel + LACE_TO * L, aTop + 0.05 * k);
  const Hc = Math.round(H * COLLAR_SHARE), CN = 2 * Hc + 1;
  // (collar point j of CN: from the top eyelet's side on the inside (-100 degrees) round the heel (0) to the outside's (100))
  // (how far round each side the collar runs: to COLLAR_BEHIND behind the top eyelet, between COLLAR_DEG's bounds; a collar
  // that stopped at 100 degrees left the ankle's widest part outside the eyestay, and one that ran to the top eyelet's line
  // turned square into it and stood up there as a cup)
  const ends = [-1, 1].map((sgn) => {
    let r = 0;
    for (let i = 0; i < S; i++) {
      const y = sock[i * 3 + 1]! - floor, a = along(sock[i * 3]!, sock[i * 3 + 2]!) - ocx, c = across(sock[i * 3]!, sock[i * 3 + 2]!) - ocz;
      const t = Math.atan2(c, -a) * sgn;
      if (y > 0.06 * k && y < 0.08 * k && t > Math.PI / 2 && t < (2 * Math.PI) / 3) r = Math.max(r, Math.hypot(a, c));
    }
    r = (r || 0.045 * k) + (MIN_PAD + LINING_GAP + ROOM) * k / 2;
    const want = (aTop - COLLAR_BEHIND * k - ocx) / r;
    const deg = (Math.acos(Math.max(-1, Math.min(1, -want))) * 180) / Math.PI;
    return Math.max(COLLAR_DEG[0], Math.min(COLLAR_DEG[1], deg));
  });
  const cTheta = new Float64Array(CN);
  for (let j = 0; j < CN; j++) cTheta[j] = (((j - Hc) / Hc) * ends[j < Hc ? 0 : 1]! * Math.PI) / 180;
  const design = (deg: number): number => {
    const a = Math.min(Math.abs(deg), RIM_AT[RIM_AT.length - 1]!);
    for (let j = 1; j < RIM_AT.length; j++) if (a <= RIM_AT[j]!) {
      const f = (a - RIM_AT[j - 1]!) / (RIM_AT[j]! - RIM_AT[j - 1]!);
      return RIM_H[j - 1]! + (RIM_H[j]! - RIM_H[j - 1]!) * smooth(0, 1, f);
    }
    return RIM_H[RIM_H.length - 1]!;
  };
  const angOf = (i: number): [number, number, number] => {
    const a = along(sock[i * 3]!, sock[i * 3 + 2]!) - ocx, c = across(sock[i * 3]!, sock[i * 3 + 2]!) - ocz;
    return [Math.atan2(c, -a), Math.hypot(a, c), sock[i * 3 + 1]! - floor];
  };
  const wrap = (x: number): number => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
  const low = new Float64Array(CN).fill(Infinity), cY = new Float64Array(CN), reach = new Float64Array(CN).fill(-1);
  for (let s = 0; s < S; s++) {
    const [t, , y] = angOf(s);
    for (let j = 0; j < CN; j++) if (wrap(t - cTheta[j]!) < 0.35) low[j] = Math.min(low[j]!, y);
  }
  const over = (j: number): number => (Number.isFinite(low[j]!) ? low[j]! + OVER_SOCK : 0);
  for (let j = 0; j < CN; j++) cY[j] = Math.max(design((cTheta[j]! * 180) / Math.PI) * k, over(j));
  for (let pass = 0; pass < 2; pass++) {
    const t = cY.slice();
    for (let j = 1; j < CN - 1; j++) cY[j] = Math.max(0.25 * t[j - 1]! + 0.5 * t[j]! + 0.25 * t[j + 1]!, over(j));
  }
  for (let s = 0; s < S; s++) {
    const [t, r, y] = angOf(s);
    for (let j = 0; j < CN; j++) {
      if (wrap(t - cTheta[j]!) > 0.25 || y < cY[j]! - RIM_BAND * k || y > cY[j]! + 0.01 * k) continue;
      reach[j] = Math.max(reach[j]!, r);
    }
  }
  for (let j = 0; j < CN; j++) if (reach[j]! < 0) {
    let a = 1, b = 1;
    while (j - a >= 0 && reach[j - a]! < 0) a++;
    while (j + b < CN && reach[j + b]! < 0) b++;
    const ra = j - a >= 0 ? reach[j - a]! : -1, rb = j + b < CN ? reach[j + b]! : -1;
    reach[j] = ra < 0 && rb < 0 ? 0.04 * k : ra < 0 ? rb : rb < 0 ? ra : (ra * b + rb * a) / (a + b);
  }
  for (let pass = 0; pass < 3; pass++) {
    const t = reach.slice();
    for (let j = 1; j < CN - 1; j++) reach[j] = 0.25 * t[j - 1]! + 0.5 * t[j]! + 0.25 * t[j + 1]!;
  }

  // (the slot's half-width, and the tongue's: its back on the top of the foot, its front TONGUE_T over that and cambered)
  const gapAt = (a: number): number => (GAP_TOP + (GAP_BOT - GAP_TOP) * clamp01((a - aTop) / (aBot - aTop))) * k;
  const halfW = (a: number): number => gapAt(Math.max(a, aTop)) + TUCK * k;
  const tongueBack = (a: number): number => ridgeAt(a) + OVER_FOOT * k;
  const tongueFront = (a: number, c: number): number => tongueBack(a) + (TONGUE_T + CAMBER * (1 - Math.min(1, (c / halfW(a)) ** 2))) * k;

  // The rim, round the opening: the collar, then on each side forward along the eyestay to the slot's end (i = H). The
  // collar stays inside the ledge the upper stands on (the padding thinner where the ankle leaves no room: a collar out
  // past the sole bulged like a slipper's), its lining never nearer the sock than LINING_GAP.
  const welt: number[] = [];
  for (let i = 0; i < N; i++) welt.push(O[i * 2]! - nrm[i * 2]! * LEDGE * k, O[i * 2 + 1]! - nrm[i * 2 + 1]! * LEDGE * k);
  const toWelt = (t: number): number => {
    // (how far from the collar's centre the ledge is, in this direction)
    const da = -Math.cos(t), dc = Math.sin(t);
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N, pa = welt[i * 2]! - ocx, pc = welt[i * 2 + 1]! - ocz, qa = welt[b * 2]! - ocx, qc = welt[b * 2 + 1]! - ocz;
      const ea = qa - pa, ec = qc - pc, den = da * ec - dc * ea;
      if (Math.abs(den) < 1e-12) continue;
      const r = (pa * ec - pc * ea) / den, f = (pa * dc - pc * da) / den;
      if (r > 0 && f >= 0 && f <= 1) best = Math.min(best, r);
    }
    return best;
  };
  const rimA = new Float64Array(N), rimC = new Float64Array(N), rimY = new Float64Array(N), edge = new Float64Array(N);
  const pad = new Float64Array(N).fill(1);
  for (let j = 0; j < CN; j++) {
    const i = (j - Hc + N) % N, t = cTheta[j]!;
    const r = Math.max(reach[j]! + (MIN_PAD + LINING_GAP) * k, Math.min(reach[j]! + ROOM * k, toWelt(t) - WELT_IN * k));
    pad[i] = (r - reach[j]! - LINING_GAP * k) / (LINING_IN * k);
    rimA[i] = ocx - Math.cos(t) * r;
    rimC[i] = ocz + Math.sin(t) * r;
    rimY[i] = cY[j]!;
    // (the padding thinning over the collar's last 30 degrees, as it does towards the top eyelet: a full roll there folded
    // its lining over itself in the corner)
    const end = ends[t < 0 ? 0 : 1]!;
    edge[i] = COLLAR_THIN * smooth(end - 30, end, (Math.abs(t) * 180) / Math.PI);
  }
  const E = H - Hc;
  for (const sgn of [1, -1]) {
    const i0 = sgn > 0 ? Hc : N - Hc;
    const e0a = rimA[i0]!, e0c = rimC[i0]!, gT = gapAt(aTop), gB = gapAt(aBot);
    const pts: number[] = [e0a, e0c];
    // (from the collar's end, leaving it the way it runs, round into the top eyelet heading down the slot; then straight
    // down the slot, then round its end)
    const ip = sgn > 0 ? Hc - 1 : N - Hc + 1;
    let ta = e0a - rimA[ip]!, tc = e0c - rimC[ip]!;
    const tl = Math.hypot(ta, tc) || 1, h = Math.hypot(aTop - e0a, sgn * gT - e0c) / 3;
    ta /= tl; tc /= tl;
    const p1a = e0a + ta * h, p1c = e0c + tc * h, p2a = aTop - h, p2c = sgn * gT;
    for (let q = 1; q <= 8; q++) {
      const t = q / 8, s2 = 1 - t, b0 = s2 * s2 * s2, b1 = 3 * s2 * s2 * t, b2 = 3 * s2 * t * t, b3 = t * t * t;
      pts.push(b0 * e0a + b1 * p1a + b2 * p2a + b3 * aTop, b0 * e0c + b1 * p1c + b2 * p2c + b3 * sgn * gT);
    }
    for (let q = 1; q <= 12; q++) { const t = q / 12; pts.push(aTop + (aBot - aTop) * t, sgn * (gT + (gB - gT) * t)); }
    for (let q = 1; q <= 6; q++) { const t = ((q / 6) * Math.PI) / 2; pts.push(aBot + Math.sin(t) * gB, sgn * Math.cos(t) * gB); }
    const ep = resample(pts, E + 1);
    for (let q = 0; q <= E; q++) {
      const i = sgn > 0 ? Hc + q : N - Hc - q;
      const a = ep[q * 2]!, c = ep[q * 2 + 1]!;
      rimA[i] = a; rimC[i] = c;
      const f = smooth(0, 0.35, q / E);
      rimY[i] = rimY[i0]! * (1 - f) + (tongueFront(a, c) + 0.002 * k) * f;
      edge[i] = COLLAR_THIN + (1 - COLLAR_THIN) * f;
    }
  }
  // (each rim point's way into the opening: the same side of the rim all the way round, as the opening winds; choosing it
  // point by point turned the roll over where the collar meets the eyestay)
  let wind2 = 0;
  for (let i = 0; i < N; i++) { const b = (i + 1) % N; wind2 += rimA[i]! * rimC[b]! - rimA[b]! * rimC[i]!; }
  const inA = new Float64Array(N), inC = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const tx = rimA[b]! - rimA[a]!, ty = rimC[b]! - rimC[a]!, l = Math.hypot(tx, ty) || 1;
    inA[i] = wind2 > 0 ? -ty / l : ty / l;
    inC[i] = wind2 > 0 ? tx / l : -tx / l;
  }

  const R = SHOE_RINGS, T0 = R * N, TN = TONGUE_STATIONS * TONGUE_ROUND;
  const pos = new Float64Array((T0 + TN) * 3), x = new Float32Array((T0 + TN) * 4);
  const put = (v: number, a: number, c: number, y: number, where: number, ao: number): void => {
    pos[v * 3] = cx + dx * a + ax * c;
    pos[v * 3 + 1] = floor + y;
    pos[v * 3 + 2] = cz + dz * a + az * c;
    x[v * 4] = ao;
    x[v * 4 + 1] = where < 1 ? where : where + (y - midTop(uOf(a), c)) * 100;
    x[v * 4 + 2] = uOf(a);
    x[v * 4 + 3] = c;
  };
  // The upper's points (along, across, height), then lifted clear of the foot (and of the tongue under the eyestays).
  const U = UPPER_RINGS, ua = new Float64Array(U * N), uc = new Float64Array(U * N), uy = new Float64Array(U * N);
  const faceUp = new Float64Array(U * N);
  const ringW = new Float64Array(N * 2), ringM = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    const oa = O[i * 2]!, oc = O[i * 2 + 1]!, na = nrm[i * 2]!, nc = nrm[i * 2 + 1]!;
    const u = uOf(oa), yb = bottom(u), ym = midTop(u, oc);
    // The outsole: from a line down its middle out to its edge.
    const ma = Math.min(Math.max(oa, heel + 0.05 * L), toe - 0.05 * L), mcen = midAt(ma);
    ringM[i * 2] = ma; ringM[i * 2 + 1] = mcen;
    const at = (r: number, f: number, inset: number, dy: number, ao: number): void => {
      const ea = oa - na * inset, ec = oc - nc * inset, a = ma + (ea - ma) * f, c = mcen + (ec - mcen) * f;
      put(r * N + i, a, c, bottom(uOf(a)) + dy, 0, ao);
    };
    at(0, 0, 0.003 * k, 0, 0.92);
    at(1, 0.5, 0.003 * k, 0, 0.92);
    at(2, 0.85, 0.003 * k, 0, 0.92);
    at(3, 1, 0.003 * k, 0, 0.92);
    put(4 * N + i, oa - na * 0.0008 * k, oc - nc * 0.0008 * k, yb + 0.0012 * k, 0, 0.95);
    put(5 * N + i, oa, oc, yb + OUTSOLE * k, 0, 1);
    put(6 * N + i, oa, oc, yb + (OUTSOLE + 0.0015) * k, 0.5, 1);
    put(7 * N + i, oa + na * 0.0006 * k, oc + nc * 0.0006 * k, (yb + ym) / 2 + 0.001 * k, 0.5, 1);
    put(8 * N + i, oa - na * 0.0006 * k, oc - nc * 0.0006 * k, ym - 0.002 * k, 0.5, 1);
    put(9 * N + i, oa - na * 0.002 * k, oc - nc * 0.002 * k, ym, 0.5, 0.95);
    const wa = oa - na * LEDGE * k, wc = oc - nc * LEDGE * k;
    ringW[i * 2] = wa; ringW[i * 2 + 1] = wc;
    put(10 * N + i, wa, wc, ym, 1, 0.8);
    // The upper, from the ledge to the rim: profiled over the way in from the wall, and carried evenly along the wall for
    // the rest. (The collar's points crowd round the heel more than the ledge's do, so where it meets the eyestay the rim's
    // point is up to 5 cm behind the ledge's: profiled as one run in, the shoulder lay flat along the side there and its
    // top rows folded over, grey holes beside the laces.)
    const ra = rimA[i]!, rc = rimC[i]!;
    const inward = Math.max(0, -((ra - wa) * na + (rc - wc) * nc));
    const ta = ra - wa + na * inward, tc = rc - wc + nc * inward;
    const prof = profile(inward, rimY[i]! - ym, k, U);
    for (let j = 0; j < U; j++) {
      const h = prof[j * 2]!, f = (j + 1) / U;
      ua[j * N + i] = wa - na * h + ta * f; uc[j * N + i] = wc - nc * h + tc * f; uy[j * N + i] = ym + prof[j * 2 + 1]!;
      const ph = j ? prof[j * 2 - 2]! : 0, py = j ? prof[j * 2 - 1]! : 0;
      faceUp[j * N + i] = smooth(0.7, 1.4, (h - ph) / Math.max(1e-6, prof[j * 2 + 1]! - py));
    }
  }
  const inTongue = (a: number, c: number): boolean => a > aTop - 0.01 * k && a < aBot + 0.012 * k && Math.abs(c) < halfW(a);
  const lift = new Float64Array(U * N), spread = new Float64Array(U * N);
  for (let pass = 0; pass < 4; pass++) {
    for (let v = 0; v < U * N; v++) {
      const a = ua[v]!, c = uc[v]!;
      const want = Math.max(footAt(a, c) + OVER_FOOT * k, inTongue(a, c) ? tongueFront(a, c) + 0.0015 * k : -Infinity);
      // (only over the top of the foot, from the top eyelet on: round the collar the sock goes on up through the opening)
      lift[v] = Math.max(0, want - uy[v]!) * faceUp[v]! * smooth(aTop - 0.03 * k, aTop, a);
    }
    for (let s2 = 0; s2 < 3; s2++) {
      for (let j = 0; j < U; j++) for (let i = 0; i < N; i++) {
        const v = j * N + i, l = lift[j * N + ((i + N - 1) % N)]!, r = lift[j * N + ((i + 1) % N)]!;
        const d = j ? lift[v - N]! : 0, u2 = j < U - 1 ? lift[v + N]! : 0;
        spread[v] = Math.max(lift[v]!, 0.4 * lift[v]! + 0.15 * (l + r + d + u2));
      }
      lift.set(spread);
    }
    // (never over the rim: a row under it lifted higher folded the upper over its own edge where the collar meets the
    // eyestay, as the 'top of the foot' there is the leg going on up through the opening)
    for (let j = 0; j < U - 1; j++) for (let i = 0; i < N; i++) {
      const v = j * N + i;
      uy[v] = uy[v]! + Math.min(lift[v]! * smooth(0, 2, j), Math.max(0, rimY[i]! - uy[v]!));
    }
  }
  for (let j = 0; j < U; j++) for (let i = 0; i < N; i++) {
    const v = j * N + i;
    put((11 + j) * N + i, ua[v]!, uc[v]!, uy[v]!, 1, j === 0 ? 0.9 : 1);
  }
  // Over the rim: the collar's padded roll, the eyestays' thin edge; then the lining's top.
  const RT = 11 + U;
  const linA = new Float64Array(N), linC = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const e = edge[i]!, p2 = Math.min(1, pad[i]!), up = (ROLL_UP + (EDGE_UP - ROLL_UP) * e) * k, inw = (ROLL_IN * p2 + (EDGE_IN - ROLL_IN * p2) * e) * k;
    const lin = (LINING_IN * p2 + (EDGE_LINING - LINING_IN * p2) * e) * k;
    linA[i] = rimA[i]! + inA[i]! * lin; linC[i] = rimC[i]! + inC[i]! * lin;
    put(RT * N + i, rimA[i]! + inA[i]! * inw, rimC[i]! + inC[i]! * inw, rimY[i]! + up, 1, 0.95);
    put((RT + 1) * N + i, linA[i]!, linC[i]!, rimY[i]! - 0.002 * k, 1, 0.9);
  }
  // Quads between the rings so far, wound outwards (checked on the outsole: its normal must point down).
  const quads = (r0: number, r1: number, list: number[], other = false): void => {
    for (let r = r0; r < r1; r++) for (let i = 0; i < N; i++) {
      const a = r * N + i, b = r * N + ((i + 1) % N), c = (r + 1) * N + i, d = (r + 1) * N + ((i + 1) % N);
      if (other) list.push(a, c, d, a, d, b); else list.push(a, c, b, b, c, d);
    }
  };
  const outer: number[] = [];
  quads(0, RT + 1, outer);
  const P = (v: number): THREE.Vector3 => new THREE.Vector3(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
  const i0 = Math.round(N * 0.3);
  const flip = P(2 * N + i0).sub(P(N + i0)).cross(P(N + i0 + 1).sub(P(N + i0))).y > 0;
  const wind = (list: number[]): void => { if (flip) for (let q = 0; q < list.length; q += 3) { const s = list[q + 1]!; list[q + 1] = list[q + 2]!; list[q + 2] = s; } };
  wind(outer);
  // The inside: the upper's rings again, moved in by its thickness along its normals, down to the insole.
  const on = normalsOf(pos.subarray(0, (RT + 2) * N * 3), Uint32Array.from(outer));
  INSIDE_FROM.forEach((j, q) => {
    for (let i = 0; i < N; i++) {
      const v = (11 + j) * N + i, w = (RT + 2 + q) * N + i;
      for (let c = 0; c < 3; c++) pos[w * 3 + c] = pos[v * 3 + c]! - on[v * 3 + c]! * INNER * k;
      x.set(x.subarray(v * 4, v * 4 + 4), w * 4);
      // (lit just under the opening, dark deep inside)
      x[w * 4] = 0.35 + 0.5 * (j / (U - 2));
    }
  });
  const IS = RT + 2 + INSIDE_FROM.length;
  for (let i = 0; i < N; i++) {
    const wa = ringW[i * 2]!, wc = ringW[i * 2 + 1]!, ma = ringM[i * 2]!, mcen = ringM[i * 2 + 1]!, na = nrm[i * 2]!, nc = nrm[i * 2 + 1]!;
    const ea = wa - na * INNER * k, ec = wc - nc * INNER * k;
    for (let q = 0; q < 3; q++) {
      const f = 1 - q / 2, a = ma + (ea - ma) * f, c = mcen + (ec - mcen) * f;
      put((IS + q) * N + i, a, c, midTop(uOf(a), c) + INSOLE * k, 1, 0.4);
    }
  }
  // (the lining's rows run down, the upper's up: split on the other diagonal, each lining quad is split as the upper's over it
  // is, or on a curved quad the two bowed apart and the lining came out through the upper)
  const inside: number[] = [];
  quads(RT + 1, RT + 2, inside);
  quads(RT + 2, IS - 1, inside, true);
  quads(IS - 1, R - 1, inside);
  wind(inside);

  // The tongue: up its middle from under the slot's end, along the top of the foot to the top eyelet and on up the shin to
  // TONGUE_TOP; round each station its back (on the foot) and its front (cambered, TONGUE_T thicker), its top end rounded.
  const line: number[] = [];
  const aStart = aBot + 0.012 * k;
  for (let q = 0; q <= 10; q++) { const a = aStart + (aTop - aStart) * (q / 10); line.push(a, tongueBack(a)); }
  const yTop = Math.max(TONGUE_TOP * k, tongueBack(aTop) + 0.012 * k), aEnd = Math.min(aTop, shin) - 0.002 * k;
  for (let q = 1; q <= 5; q++) {
    const t = q / 5, s2 = 1 - t, ca = aTop - 0.002 * k, cy = tongueBack(aTop) + (yTop - tongueBack(aTop)) * 0.5;
    line.push(s2 * s2 * aTop + 2 * s2 * t * ca + t * t * aEnd, s2 * s2 * tongueBack(aTop) + 2 * s2 * t * cy + t * t * yTop);
  }
  const st = resample(line, TONGUE_STATIONS);
  const TR = TONGUE_ROUND, half = TR / 2, tris: number[] = [...outer, ...inside];
  // Each station's frame (its line's way, its front square to that, away from the foot) and width, and how far its back
  // moves out along the front to lie OVER_FOOT on the sock: drawn flat across, its edges stood up to 1.5 cm off the round
  // shin, and its dark back showed beside the ankle. (Where no sock is near, it stays on the foot's ridge.)
  const sA = new Float64Array(TONGUE_STATIONS), sY = new Float64Array(TONGUE_STATIONS), sF = new Float64Array(TONGUE_STATIONS * 2);
  const sW = new Float64Array(TONGUE_STATIONS), sT = new Float64Array(TONGUE_STATIONS * 2);
  for (let s = 0; s < TONGUE_STATIONS; s++) {
    const a = st[s * 2]!, y = st[s * 2 + 1]!;
    const s0 = Math.max(0, s - 1), s1 = Math.min(TONGUE_STATIONS - 1, s + 1);
    const ta = st[s1 * 2]! - st[s0 * 2]!, ty = st[s1 * 2 + 1]! - st[s0 * 2 + 1]!, tl = Math.hypot(ta, ty) || 1;
    let fa = -ty / tl, fy = ta / tl;
    if (fy < 0 || (Math.abs(fy) < 0.2 && fa < 0)) { fa = -fa; fy = -fy; }
    const top = smooth(0.72, 1, s / (TONGUE_STATIONS - 1));
    sA[s] = a; sY[s] = y; sF[s * 2] = fa; sF[s * 2 + 1] = fy; sT[s * 2] = ta / tl; sT[s * 2 + 1] = ty / tl;
    sW[s] = halfW(a) * Math.sqrt(Math.max(0, 1 - top * top)) * (s === TONGUE_STATIONS - 1 ? 0 : 1);
  }
  const FS = half, lie = new Float64Array(TONGUE_STATIONS * FS).fill(NaN);
  for (let s = 0; s < TONGUE_STATIONS; s++) {
    const a = sA[s]!, y = sY[s]!, fa = sF[s * 2]!, fy = sF[s * 2 + 1]!, ta = sT[s * 2]!, ty = sT[s * 2 + 1]!;
    for (let q = 0; q < S; q++) {
      const da = along(sock[q * 3]!, sock[q * 3 + 2]!) - a, dy = sock[q * 3 + 1]! - floor - y;
      if (Math.abs(da * ta + dy * ty) > TONGUE_NEAR * k) continue;
      const c = across(sock[q * 3]!, sock[q * 3 + 2]!), w = da * fa + dy * fy;
      // (only the sock just under or through it: the shin over a flat station is not under it)
      if (w > 0.015 * k || w < -0.03 * k) continue;
      for (let r = 0; r < FS; r++) {
        const cr = (-1 + (2 * r) / (FS - 1)) * sW[s]!;
        if (Math.abs(c - cr) > TONGUE_NEAR * k) continue;
        const o = s * FS + r, want = w + (OVER_FOOT * k - (tongueBack(a) - ridgeAt(a)));
        if (!(lie[o]! >= want)) lie[o] = want;
      }
    }
  }
  // (a sample with no sock near takes its station's nearest one, a station with none keeps 0; then smoothed across and
  // along, never into the sock)
  for (let s = 0; s < TONGUE_STATIONS; s++) {
    for (let r = 0; r < FS; r++) if (Number.isNaN(lie[s * FS + r]!)) {
      let best = NaN, bd = Infinity;
      for (let r2 = 0; r2 < FS; r2++) if (!Number.isNaN(lie[s * FS + r2]!) && Math.abs(r2 - r) < bd) { bd = Math.abs(r2 - r); best = lie[s * FS + r2]!; }
      lie[s * FS + r] = best;
    }
    for (let r = 0; r < FS; r++) lie[s * FS + r] = Number.isNaN(lie[s * FS + r]!) ? 0 : Math.max(-TONGUE_DROP * k, lie[s * FS + r]!);
  }
  const clear = lie.slice();
  for (let pass = 0; pass < 3; pass++) {
    const t = lie.slice();
    for (let s = 0; s < TONGUE_STATIONS; s++) for (let r = 0; r < FS; r++) {
      const l = t[s * FS + Math.max(0, r - 1)]!, rr = t[s * FS + Math.min(FS - 1, r + 1)]!;
      const d = t[Math.max(0, s - 1) * FS + r]!, u2 = t[Math.min(TONGUE_STATIONS - 1, s + 1) * FS + r]!;
      lie[s * FS + r] = Math.max(clear[s * FS + r]!, 0.4 * t[s * FS + r]! + 0.15 * (l + rr + d + u2));
    }
  }
  for (let s = 0; s < TONGUE_STATIONS; s++) {
    const a = sA[s]!, y = sY[s]!, fa = sF[s * 2]!, fy = sF[s * 2 + 1]!, w = sW[s]!;
    for (let r = 0; r < TR; r++) {
      const front = r < half, f = front ? -1 + (2 * r) / (half - 1) : 1 - (2 * (r - half)) / (half - 1);
      // (the top's twelve points meet in one on each face: spread along its one line by the camber, they folded the cap over)
      const end = s === TONGUE_STATIONS - 1, fe = end ? 0 : f;
      const lift2 = (front ? (TONGUE_T + CAMBER * (1 - fe * fe)) * k : 0) + lie[s * FS + (end ? FS >> 1 : front ? r : TR - 1 - r)]!;
      const v = T0 + s * TR + r;
      put(v, a + fa * lift2, f * w, y + fy * lift2, 20, front ? 1 : 0.55);
      x[v * 4 + 1] = 20 + (y + fy * lift2 - midTop(uOf(a), 0)) * 100;
    }
  }
  const tongue: number[] = [];
  for (let s = 0; s < TONGUE_STATIONS - 1; s++) for (let r = 0; r < TR; r++) {
    const a = T0 + s * TR + r, b = T0 + s * TR + ((r + 1) % TR), c = a + TR, d = b + TR;
    tongue.push(a, b, c, b, d, c);
  }
  // (wound so the front faces away from the foot)
  const mid = Math.floor(TONGUE_STATIONS / 2), fv = T0 + mid * TR + 2;
  const fn = P(fv + TR).sub(P(fv)).cross(P(fv + 1).sub(P(fv)));
  const fUp = P(fv).sub(P(T0 + mid * TR + TR - 3));
  if (fn.dot(fUp) < 0) for (let q = 0; q < tongue.length; q += 3) { const s = tongue[q + 1]!; tongue[q + 1] = tongue[q + 2]!; tongue[q + 2] = s; }
  tris.push(...tongue);
  // The sock squeezed in by the opening: from 2.5 cm under the rim to 3.5 cm over it, no further out than the lining
  // (widening a quarter of the way it rises over the rim), all round the collar and the eyestays; under the tongue it is the
  // tongue's. MakeHuman's sock flares out at its foot, and over a thin collar it hung out over the edge, most where the
  // collar meets the eyestay.
  const tucked = sock.slice();
  for (let q = 0; q < S; q++) {
    const sa = along(sock[q * 3]!, sock[q * 3 + 2]!), sc = across(sock[q * 3]!, sock[q * 3 + 2]!), y = sock[q * 3 + 1]! - floor;
    if (sa > aTop - 0.01 * k && Math.abs(sc) < halfW(sa)) continue;
    const ra = sa - ocx, rc = sc - ocz, r = Math.hypot(ra, rc);
    if (r < 1e-6) continue;
    // (where the way out to this vertex crosses the lining's top, and the rim's height there)
    const da = ra / r, dc = rc / r;
    let d = Infinity, edgeY = 0;
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N, pa = linA[i]! - ocx, pc = linC[i]! - ocz, ea = linA[b]! - linA[i]!, ec = linC[b]! - linC[i]!;
      const den = da * ec - dc * ea;
      if (Math.abs(den) < 1e-12) continue;
      const rr = (pa * ec - pc * ea) / den, f = (pa * dc - pc * da) / den;
      if (rr > 0 && f >= 0 && f <= 1 && rr < d) { d = rr; edgeY = rimY[i]! * (1 - f) + rimY[b]! * f; }
    }
    if (!Number.isFinite(d)) continue;
    const band = smooth(edgeY - 0.025 * k, edgeY - 0.02 * k, y) * (1 - smooth(edgeY + 0.005 * k, edgeY + 0.035 * k, y));
    if (band <= 0) continue;
    const limit = d - LINING_GAP * k + Math.max(0, y - edgeY) * 0.25;
    if (r <= limit) continue;
    const to = r + (limit - r) * band, fa = ocx + da * to, fc = ocz + dc * to;
    tucked[q * 3] = cx + dx * fa + ax * fc;
    tucked[q * 3 + 2] = cz + dz * fa + az * fc;
  }
  // How much each vertex moves with the leg in it rather than the foot under it (remakeShoes' weights): the collar's band
  // from COLLAR_HOLD under its rim up, with its roll and lining, fading out along the eyestays' first stretch, and the
  // tongue's part up the shin. The inside's rings take their outside twins' share: two skins 3.5 mm apart with different
  // shares crossed as the ankle bent (and taken by nearness to the sock, which runs on under the trainer to the toes, the
  // whole vamp followed the toes).
  const hold = new Float32Array(T0 + TN);
  // (the hand-over from the leg to the foot spread from the collar's last 45 degrees, at CORNER_HOLD by its end, to nothing
  // a third of the way down the eyestay: over 2-3 cm, a pointed foot drew the collar's front corner up into a fin)
  const colShare = (i: number): number => {
    const q = i > Hc && i <= H ? i - Hc : i >= H && i < N - Hc ? N - Hc - i : -1;
    if (q >= 0) return CORNER_HOLD * (1 - smooth(0, 0.3, q / E));
    const j = (i + Hc) % N, deg = (Math.abs(cTheta[j]!) * 180) / Math.PI, end = ends[cTheta[j]! < 0 ? 0 : 1]!;
    return 1 - (1 - CORNER_HOLD) * smooth(end - 45, end, deg);
  };
  for (let r = 11; r <= RT + 1; r++) for (let i = 0; i < N; i++) {
    const v = r * N + i, y = pos[v * 3 + 1]! - floor;
    hold[v] = colShare(i) * smooth(rimY[i]! - COLLAR_HOLD * k, rimY[i]! - 0.01 * k, y);
  }
  INSIDE_FROM.forEach((j, q) => { for (let i = 0; i < N; i++) hold[(RT + 2 + q) * N + i] = hold[(11 + j) * N + i]!; });
  const yJoin = tongueBack(aTop);
  for (let s = 0; s < TONGUE_STATIONS; s++) {
    const h = smooth(yJoin, yJoin + 0.02 * k, sY[s]!);
    for (let r = 0; r < TR; r++) hold[T0 + s * TR + r] = h;
  }
  // A layer moves with what it lines: the lining with the upper outside it, the collar's roll and the lining's top with the
  // rim, the tongue's back with its front, the insole with the outsole under it. (Each weighted by its own nearest old
  // vertices, the lining drifted up to 6 mm against the upper 3.5 mm outside it as the ankle bent, and showed through it in
  // dark slits.)
  const twin = new Int32Array(T0 + TN).fill(-1);
  for (let i = 0; i < N; i++) {
    INSIDE_FROM.forEach((j, q) => { twin[(RT + 2 + q) * N + i] = (11 + j) * N + i; });
    twin[RT * N + i] = twin[(RT + 1) * N + i] = (RT - 1) * N + i;
    for (let q = 0; q < 3; q++) twin[(IS + q) * N + i] = [10, 1, 0][q]! * N + i;
  }
  for (let st = 0; st < TONGUE_STATIONS; st++) for (let r = half; r < TR; r++) twin[T0 + st * TR + r] = T0 + st * TR + (TR - 1 - r);
  return { pos, x, tris: Uint32Array.from(tris), length: L, laceFrom: uOf(aTop), laceTo: uOf(aBot), k, sock: tucked, hold, twin };
}

/** For each point of `at`, the `count` nearest of the vertices `ids` (in `pos`) within `reach` (m) and their squared
 * distances (id -1, Infinity where there are fewer), found on a 1 cm grid over the vertices' box, shell by shell. */
function nearest(pos: ArrayLike<number>, ids: number[], at: Float64Array, count: number, reach = 0.3): { id: Int32Array; d2: Float64Array } {
  const CELL = 0.01, m = at.length / 3, id = new Int32Array(m * count).fill(-1), d2 = new Float64Array(m * count).fill(Infinity);
  if (!ids.length) return { id, d2 };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of ids) {
    x0 = Math.min(x0, pos[v * 3]!); y0 = Math.min(y0, pos[v * 3 + 1]!); z0 = Math.min(z0, pos[v * 3 + 2]!);
    x1 = Math.max(x1, pos[v * 3]!); y1 = Math.max(y1, pos[v * 3 + 1]!); z1 = Math.max(z1, pos[v * 3 + 2]!);
  }
  const nx = Math.floor((x1 - x0) / CELL) + 1, ny = Math.floor((y1 - y0) / CELL) + 1, nz = Math.floor((z1 - z0) / CELL) + 1;
  const head = new Int32Array(nx * ny * nz).fill(-1), next = new Int32Array(ids.length);
  ids.forEach((v, e) => {
    const c = (Math.floor((pos[v * 3]! - x0) / CELL) * ny + Math.floor((pos[v * 3 + 1]! - y0) / CELL)) * nz + Math.floor((pos[v * 3 + 2]! - z0) / CELL);
    next[e] = head[c]!; head[c] = e;
  });
  const R = Math.ceil(reach / CELL), r2max = reach * reach;
  for (let q = 0; q < m; q++) {
    const qx = at[q * 3]!, qy = at[q * 3 + 1]!, qz = at[q * 3 + 2]!, o = q * count;
    const gx = Math.floor((qx - x0) / CELL), gy = Math.floor((qy - y0) / CELL), gz = Math.floor((qz - z0) / CELL);
    for (let r = 0; r <= R; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = gx + dx;
        if (cx < 0 || cx >= nx) continue;
        for (let dy = -r; dy <= r; dy++) {
          const cy = gy + dy;
          if (cy < 0 || cy >= ny) continue;
          const face = Math.abs(dx) === r || Math.abs(dy) === r;
          for (let dz = -r; dz <= r; dz += face ? 1 : 2 * r || 1) {
            const cz = gz + dz;
            if (cz < 0 || cz >= nz) continue;
            for (let e = head[(cx * ny + cy) * nz + cz]!; e >= 0; e = next[e]!) {
              const v = ids[e]!, d = (pos[v * 3]! - qx) ** 2 + (pos[v * 3 + 1]! - qy) ** 2 + (pos[v * 3 + 2]! - qz) ** 2;
              if (d >= d2[o + count - 1]! || d > r2max) continue;
              let j = count - 1;
              while (j > 0 && d2[o + j - 1]! > d) { d2[o + j] = d2[o + j - 1]!; id[o + j] = id[o + j - 1]!; j--; }
              d2[o + j] = d; id[o + j] = v;
            }
          }
        }
      }
      // (everything within r cells' distance has been seen)
      if (d2[o + count - 1]! <= (r * CELL) ** 2) break;
    }
  }
  return { id, d2 };
}

/** Vertex normals (area-weighted) of a triangle mesh. */
function normalsOf(pos: Float64Array, tris: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t]!, j = tris[t + 1]!, k = tris[t + 2]!;
    a.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    b.set(pos[j * 3]! - a.x, pos[j * 3 + 1]! - a.y, pos[j * 3 + 2]! - a.z);
    c.set(pos[k * 3]! - a.x, pos[k * 3 + 1]! - a.y, pos[k * 3 + 2]! - a.z);
    b.cross(c);
    for (const v of [i, j, k]) { n[v * 3] += b.x; n[v * 3 + 1] += b.y; n[v * 3 + 2] += b.z; }
  }
  for (let v = 0; v < n.length / 3; v++) {
    const l = Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
  return n;
}

/**
 * Swap a person's trainers for shoes made to their feet (see the top of this file), in their parsed mesh: in `g`'s own index,
 * and in `bodyIndex` (the face's FaceData.bodyIndex, if they have one; with a wardrobe, in its 'shoe' range). Vertices of
 * the old trainer are reused, more appended if the new pair needs them (attributes grown), spare ones made copies of a new
 * one and drawn by nothing. The old trainer's part that is joined to the sock (MetaHuman packs label the crew sock's foot by
 * height, so its lower half came in as shoe) goes back to the sock. Returns the new body index (null without one) and the
 * fit, or null (and changes nothing) if there are no shoes.
 */
export function remakeShoes(g: THREE.BufferGeometry, bodyIndex: Uint16Array | Uint32Array | null, wardrobe: Wardrobe | null,
  toRest: THREE.Matrix4[]):
  { bodyIndex: Uint16Array | Uint32Array | null; fit: ShoeFit; soleRef: SoleRef } | null {
  const index = g.index!.array as Uint16Array | Uint32Array;
  const pos = g.getAttribute('position').array as Float32Array;
  const A = g.getAttribute('bodyA').array as Float32Array, B = g.getAttribute('bodyB').array as Float32Array;
  const n = pos.length / 3;
  const isShoe = (v: number): boolean => B[v * 4]! > 0.5, isSock = (v: number): boolean => A[v * 4 + 3]! > 0.5;
  // Pieces joined to the sock are sock, or the sock-coded bits of a trainer are trainer.
  const par = new Int32Array(n);
  for (let v = 0; v < n; v++) par[v] = v;
  const find = (v: number): number => { while (par[v] !== v) { par[v] = par[par[v]!]!; v = par[v]!; } return v; };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]!, b = index[t + 1]!, c = index[t + 2]!;
    if ((isShoe(a) || isSock(a)) && (isShoe(b) || isSock(b)) && (isShoe(c) || isSock(c))) { par[find(a)] = find(b); par[find(b)] = find(c); }
  }
  // (a piece is the sock's when a fifth of it is coded sock, as a MetaHuman pack's crew-sock tube is, its lower half coded
  // shoe; otherwise all of it is the trainer's: two of MakeHuman's trainers carry a few sock-coded vertices on their top edge,
  // and joining by any of them kept the whole old trainer, drawn as sock, through the new one)
  const socks0 = new Map<number, number>(), all = new Map<number, number>();
  for (let v = 0; v < n; v++) if (isShoe(v) || isSock(v)) {
    const r = find(v);
    all.set(r, (all.get(r) ?? 0) + 1);
    if (isSock(v)) socks0.set(r, (socks0.get(r) ?? 0) + 1);
  }
  for (let v = 0; v < n; v++) {
    if (!isShoe(v) && !isSock(v)) continue;
    const r = find(v), share = (socks0.get(r) ?? 0) / all.get(r)!;
    if (share === 0 || share === 1) continue;
    if (share >= SOCK_PIECE) { B[v * 4] = 0; A[v * 4 + 3] = 1; } else { B[v * 4] = 1; A[v * 4 + 3] = 0; }
  }
  const sides: number[][] = [[], []];
  for (let v = 0; v < n; v++) if (isShoe(v)) sides[pos[v * 3]! > 0 ? 0 : 1]!.push(v);
  if (!sides[0]!.length || !sides[1]!.length) return null;
  const oldShoe = new Uint8Array(n);
  for (const s of sides) for (const v of s) oldShoe[v] = 1;
  // The shoe is made in the rest pose, the game's standing (soles.ts takes the floor there), and taken back to the model's
  // pose by each new vertex's own skinning: from MakeHuman's pose the rest turns each foot 2-4 degrees onto its outside edge,
  // and a sole made flat in MakeHuman's pose stood 3-6 mm into the floor on that edge (the old trainer's narrow, rounded
  // bottom hid it).
  const si = g.getAttribute('skinIndex').array as Uint16Array, sw = g.getAttribute('skinWeight').array as Float32Array;
  const E = toRest.map((m) => m.elements), M = new Float64Array(16);
  const blend = (I: ArrayLike<number>, W: ArrayLike<number>, o: number): Float64Array => {
    M.fill(0);
    for (let c = 0; c < 4; c++) {
      const w = W[o + c]!;
      if (w <= 0) continue;
      const e = E[I[o + c]!]!;
      for (let j = 0; j < 16; j++) M[j] = M[j]! + w * e[j]!;
    }
    return M;
  };
  /** out[o..] = M (x, y, z), or its inverse's when `back`. */
  const apply = (m: Float64Array, x: number, y: number, z: number, out: Float32Array | Float64Array, o: number, back: boolean): void => {
    if (!back) {
      out[o] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      out[o + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      out[o + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      return;
    }
    const a = m[0]!, b = m[4]!, c = m[8]!, d = m[1]!, e = m[5]!, f = m[9]!, gg = m[2]!, h = m[6]!, i = m[10]!;
    const px = x - m[12]!, py = y - m[13]!, pz = z - m[14]!;
    const A0 = e * i - f * h, B0 = f * gg - d * i, C0 = d * h - e * gg, det = a * A0 + b * B0 + c * C0;
    out[o] = (A0 * px + (c * h - b * i) * py + (b * f - c * e) * pz) / det;
    out[o + 1] = (B0 * px + (a * i - c * gg) * py + (c * d - a * f) * pz) / det;
    out[o + 2] = (C0 * px + (b * gg - a * h) * py + (a * e - b * d) * pz) / det;
  };
  const rest = new Float32Array(n * 3);
  const toRestOf = (ids: number[]): void => { for (const v of ids) apply(blend(si, sw, v * 4), pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!, rest, v * 3, false); };
  const pick = (ids: number[]): Float32Array => Float32Array.from(ids.flatMap((v) => [rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!]));
  // (the socks: sock-coded and below the knee, as a headband, a visor and a collar are coded sock too)
  let ground = Infinity;
  for (const ids of sides) for (const v of ids) ground = Math.min(ground, pos[v * 3 + 1]!);
  const sockIds = [0, 1].map((s) => {
    const ids: number[] = [];
    for (let v = 0; v < n; v++) if (isSock(v) && (pos[v * 3]! > 0) === (s === 0) && pos[v * 3 + 1]! < ground + SOCK_TOP) ids.push(v);
    return ids;
  });
  for (const ids of [...sides, ...sockIds]) toRestOf(ids);
  const socks = sockIds.map(pick);
  // The sock where the old trainer covered it was baked in its shadow, and the new collar is lower: there it takes the
  // sock's occlusion just over where the old trainer came up to.
  const Xa = g.getAttribute('bodyX').array as Float32Array;
  for (let s = 0; s < 2; s++) {
    let top = -Infinity;
    for (const v of sides[s]!) top = Math.max(top, pos[v * 3 + 1]!);
    const near: number[] = [], under: number[] = [];
    for (let v = 0; v < n; v++) {
      if (!isSock(v) || (pos[v * 3]! > 0) !== (s === 0)) continue;
      const y = pos[v * 3 + 1]!;
      if (y >= top && y < top + 0.03) near.push(Xa[v * 4]!);
      else if (y < top) under.push(v);
    }
    if (!near.length) continue;
    const ref = near.sort((p, q) => p - q)[Math.floor(near.length / 2)]!;
    for (const v of under) Xa[v * 4] = Math.max(Xa[v * 4]!, ref);
  }
  const nrmAll = g.getAttribute('normal').array as Float32Array;
  const pickN = (ids: number[]): Float32Array => {
    const out = new Float32Array(ids.length * 3);
    ids.forEach((v, q) => {
      const m = blend(si, sw, v * 4), x = nrmAll[v * 3]!, y = nrmAll[v * 3 + 1]!, z = nrmAll[v * 3 + 2]!;
      const nx = m[0]! * x + m[4]! * y + m[8]! * z, ny = m[1]! * x + m[5]! * y + m[9]! * z, nz = m[2]! * x + m[6]! * y + m[10]! * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      out[q * 3] = nx / l; out[q * 3 + 1] = ny / l; out[q * 3 + 2] = nz / l;
    });
    return out;
  };
  const built = [0, 1].map((s) => buildShoe(pick(sides[s]!), pickN(sides[s]!), socks[s]!, s === 0 ? 1 : -1));
  // (the sock as the collar squeezes it)
  // (only those it moved: back through a blend of bones the round trip isn't exact)
  built.forEach((b, s) => sockIds[s]!.forEach((v, q) => {
    if (b.sock[q * 3] === rest[v * 3] && b.sock[q * 3 + 2] === rest[v * 3 + 2]) return;
    rest.set(b.sock.subarray(q * 3, q * 3 + 3), v * 3);
    apply(blend(si, sw, v * 4), b.sock[q * 3]!, b.sock[q * 3 + 1]!, b.sock[q * 3 + 2]!, pos, v * 3, true);
  }));
  // Skin weights: the old trainer's nearest vertices' (inverse square distance), and as far as a vertex holds the leg
  // (Built.hold: the collar and the tongue's top) the nearest sock's, so they move with the leg in them; the four heaviest
  // bones kept. (Taken from the old trainer alone, the collar stayed with the foot as the ankle bent and the sock went out
  // through it.) The sole keeps MakeHuman's share on the shin at the heel (up to 73%): on the foot's bones alone, soles.ts
  // finds the shoe's real heel, 12 cm behind the point the feet's animation was tuned on, and every foot test moved
  // (DECISIONS.md, item 7).
  let bones = 0;
  for (let v = 0; v < n * 4; v++) bones = Math.max(bones, si[v]! + 1);
  // (a bone joins the list once, by its own mark: marked by a zero sum instead, a collar held wholly by the leg got the foot's
  // bone in all four slots from the foot's zero shares, and the leg's bone dropped out)
  const acc = new Float64Array(bones), seen = new Uint8Array(bones), touched: number[] = [];
  const add = (v: number, f: number): void => {
    if (f <= 0) return;
    for (let c = 0; c < 4; c++) {
      const w = sw[v * 4 + c]!;
      if (w <= 0) continue;
      const b = si[v * 4 + c]!;
      if (!seen[b]) { seen[b] = 1; touched.push(b); }
      acc[b] = acc[b]! + w * f;
    }
  };
  const weights = built.map((b, s) => {
    const m = b.pos.length / 3, outI = new Uint16Array(m * 4), outW = new Float32Array(m * 4);
    const foot = nearest(rest, sides[s]!, b.pos, 6), leg = nearest(rest, sockIds[s]!, b.pos, 4, SOCK_REACH * b.k);
    const top: number[] = [];
    for (let q = 0; q < m; q++) {
      const hold = b.hold[q]!;
      let fs = 0, ls = 0;
      for (let j = 0; j < 6; j++) fs += 1 / (Math.sqrt(foot.d2[q * 6 + j]!) + 0.003) ** 2;
      for (let j = 0; j < 4; j++) if (leg.id[q * 4 + j]! >= 0) ls += 1 / (Math.sqrt(leg.d2[q * 4 + j]!) + 0.003) ** 2;
      const legShare = ls > 0 ? hold : 0;
      for (let j = 0; j < 6; j++) add(foot.id[q * 6 + j]!, ((1 - legShare) / (Math.sqrt(foot.d2[q * 6 + j]!) + 0.003) ** 2) / fs);
      if (legShare > 0) for (let j = 0; j < 4; j++) if (leg.id[q * 4 + j]! >= 0) add(leg.id[q * 4 + j]!, (legShare / (Math.sqrt(leg.d2[q * 4 + j]!) + 0.003) ** 2) / ls);
      top.length = 0;
      for (const bone of touched) top.push(bone);
      top.sort((x, y) => acc[y]! - acc[x]!);
      let sum = 0;
      for (let c = 0; c < 4 && c < top.length; c++) sum += acc[top[c]!]!;
      for (let c = 0; c < 4 && c < top.length; c++) { outI[q * 4 + c] = top[c]!; outW[q * 4 + c] = acc[top[c]!]! / sum; }
      for (const bone of touched) { acc[bone] = 0; seen[bone] = 0; }
      touched.length = 0;
    }
    for (let q = 0; q < m; q++) {
      const t = b.twin[q]!;
      if (t >= 0) { outI.copyWithin(q * 4, t * 4, t * 4 + 4); outW.copyWithin(q * 4, t * 4, t * 4 + 4); }
    }
    return { outI, outW };
  });
  const old = [...sides[0]!, ...sides[1]!];
  const soleRef: SoleRef = {
    pos: Float32Array.from(old.flatMap((v) => [rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!])),
    skinIndex: Uint16Array.from(old.flatMap((v) => [si[v * 4]!, si[v * 4 + 1]!, si[v * 4 + 2]!, si[v * 4 + 3]!])),
    skinWeight: Float32Array.from(old.flatMap((v) => [sw[v * 4]!, sw[v * 4 + 1]!, sw[v * 4 + 2]!, sw[v * 4 + 3]!])),
  };
  // Slots: the old trainer's own vertices first, then new ones at the end.
  const need = built.reduce((x, b, s) => x + Math.max(0, b.pos.length / 3 - sides[s]!.length), 0);
  if (need) {
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute, src = a.array as Float32Array;
      const grown = new (src.constructor as Float32ArrayConstructor)((n + need) * a.itemSize);
      grown.set(src);
      g.setAttribute(name, new THREE.BufferAttribute(grown, a.itemSize, a.normalized));
    }
    if (wardrobe) {
      const shoePiece = wardrobe.pieces.indexOf('shoe');
      const piece = new Uint8Array(n + need), hide = new Uint16Array(n + need);
      piece.set(wardrobe.piece); hide.set(wardrobe.hide);
      piece.fill(shoePiece, n);
      wardrobe.piece = piece; wardrobe.hide = hide;
    }
  }
  const P = g.getAttribute('position').array as Float32Array, Nn = g.getAttribute('normal').array as Float32Array;
  const SI = g.getAttribute('skinIndex').array as Uint16Array, SW = g.getAttribute('skinWeight').array as Float32Array;
  const PA = g.getAttribute('bodyA').array as Float32Array, PB = g.getAttribute('bodyB').array as Float32Array;
  const X = g.getAttribute('bodyX').array as Float32Array;
  const C = g.getAttribute('color')?.array as Float32Array | undefined, UV = g.getAttribute('uv')?.array as Float32Array | undefined;
  let next = n;
  const newTris: number[] = [];
  built.forEach((b, s) => {
    const m = b.pos.length / 3, ids = sides[s]!, slot = new Uint32Array(m);
    for (let q = 0; q < m; q++) slot[q] = q < ids.length ? ids[q]! : next++;
    // (back to the model's pose, each vertex by its own weights)
    const bind = new Float64Array(m * 3);
    for (let q = 0; q < m; q++) apply(blend(weights[s]!.outI, weights[s]!.outW, q * 4), b.pos[q * 3]!, b.pos[q * 3 + 1]!, b.pos[q * 3 + 2]!, bind, q * 3, true);
    const nrm = normalsOf(bind, b.tris);
    const write = (v: number, q: number): void => {
      for (let c = 0; c < 3; c++) { P[v * 3 + c] = bind[q * 3 + c]!; Nn[v * 3 + c] = nrm[q * 3 + c]!; if (C) C[v * 3 + c] = 1; }
      for (let c = 0; c < 4; c++) {
        SI[v * 4 + c] = weights[s]!.outI[q * 4 + c]!; SW[v * 4 + c] = weights[s]!.outW[q * 4 + c]!;
        PA[v * 4 + c] = 0; PB[v * 4 + c] = c === 0 ? 1 : 0; X[v * 4 + c] = b.x[q * 4 + c]!;
      }
      if (UV) { UV[v * 2] = 0; UV[v * 2 + 1] = 0; }
    };
    for (let q = 0; q < m; q++) write(slot[q]!, q);
    // (spare old vertices: copies of the new shoe's first, drawn by nothing)
    for (let q = m; q < ids.length; q++) write(ids[q]!, 0);
    for (const t of b.tris) newTris.push(slot[t]!);
  });
  for (const name of Object.keys(g.attributes)) g.getAttribute(name).needsUpdate = true;
  // The triangles: the old trainer's out, the new pair's in (in the wardrobe's 'shoe' range, or at the end).
  const Ctor = next > 65535 || index instanceof Uint32Array ? Uint32Array : Uint16Array;
  const swap = (idx: Uint16Array | Uint32Array, w: Wardrobe | null): Uint16Array | Uint32Array => {
    const isOld = (t: number): boolean => oldShoe[idx[t]!] === 1 && oldShoe[idx[t + 1]!] === 1 && oldShoe[idx[t + 2]!] === 1;
    const range = w ? w.ranges[w.pieces.indexOf('shoe')] : undefined;
    const [start, count] = w && range ? range : [idx.length, 0];
    let old = 0;
    for (let t = w && range ? start : 0; t < (w && range ? start + count : idx.length); t += 3) if (isOld(t)) old += 3;
    const out = new Ctor(idx.length - old + newTris.length);
    let o = 0;
    const keep = (t0: number, t1: number): void => { for (let t = t0; t < t1; t += 3) if (!isOld(t)) { out[o++] = idx[t]!; out[o++] = idx[t + 1]!; out[o++] = idx[t + 2]!; } };
    if (w && range) {
      out.set(idx.subarray(0, start), 0); o = start;
      keep(start, start + count);
      for (const v of newTris) out[o++] = v;
      const delta = o - start - count;
      out.set(idx.subarray(start + count), o);
      for (const r of w.ranges) if (r !== range && r[0] >= start + count) r[0] += delta;
      range[1] = count + delta;
    } else {
      keep(0, idx.length);
      for (const v of newTris) out[o++] = v;
    }
    return out;
  };
  g.setIndex(new THREE.BufferAttribute(swap(index, null), 1));
  g.computeBoundingSphere();
  const length = (built[0]!.length + built[1]!.length) / 2;
  return {
    bodyIndex: bodyIndex ? swap(bodyIndex, wardrobe) : null, soleRef,
    fit: {
      length, laceFrom: (built[0]!.laceFrom + built[1]!.laceFrom) / 2, laceTo: (built[0]!.laceTo + built[1]!.laceTo) / 2, k: length / REF_LENGTH,
      gapFrom: GAP_TOP * (length / REF_LENGTH), gapTo: GAP_BOT * (length / REF_LENGTH), eyelets: EYELETS_OUT * (length / REF_LENGTH),
    },
  };
}
