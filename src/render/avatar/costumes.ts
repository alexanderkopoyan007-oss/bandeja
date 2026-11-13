// Novelty costumes (M5 phase C step 4; data/cosmetics.json's `costume` slot): a banana, a tuxedo, an astronaut, a dinosaur
// onesie and chef's whites. Each is a suit and what is made for it:
//   - The suit is the long sleeves and tights built for every body (person_wear.py), in the costume's colours and print
//     (paint.ts printShirt, printBottom), a skirt taken off: cuts are garments, never paint (the owner, 6 Nov).
//   - What it adds is made here in code and fitted to the body it goes on, as the head pieces are (costume.ts):
//       banana     four peel petals turned down from the neck, their pale insides out, a brown tip on each
//       tuxedo     satin shawl lapels either side of the shirt's front, the jacket's button, a wing collar and a bow tie
//       astronaut  a neck ring on the shoulders, a backpack on straps, a control box on the chest
//       dinosaur   a hood with eyes, teeth and spikes; spikes down the back; a tail
//       chef       a toque, a mandarin collar, two rows of buttons
// What lies on the trunk is laid on the body as drawn in the costume, seen along an axis (`Relief`), and skinned like the
// body under it (costume.ts skinLike); what stands off it (the pack, the box, the ring, the tail) and what is on the head
// rides one bone. All of it is ours.
import * as THREE from 'three/webgpu';
import { dressedIndex, metaHumanOf, type PlayerAsset } from './asset.ts';
import { personFrame, type KitFrame, type KitLook } from './kit.ts';
import { lathe, mergeParts, roundedBox, surface, tube, type Part } from '../geom.ts';
import { fabric, metal, plastic } from './clothTex.ts';
import { piecesFor, type Paint, type PaintSocks, type Print } from './paint.ts';
import { E0, E1, clothTable, dirOf, edgeY, elAt, fitHead, pressHair, radius, skinLike, weightOf, withoutBakedHead, worn, type Dressing, type HeadFit, type Headwear, type Piece, type Wear } from './costume.ts';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Superellipse coordinate: cos or sin raised to 2 / power, keeping its sign. */
const sp = (x: number, power: number): number => Math.sign(x) * Math.abs(x) ** (2 / power);
const TAU = 2 * Math.PI;

export interface Costume {
  /** The suit's colours: the shirt and its second colour, the shorts and tights, the socks. */
  look: Pick<KitLook, 'shirt' | 'trim' | 'shorts' | 'socks'>;
  /** Its cuts, print and shoes. */
  paint: Paint;
  /** What it covers beyond the suit (the catalogue's `covers`): nothing of the player's own is worn there. */
  covers: { head: boolean; eyes: boolean };
  /** Its cloth over the head, if any: where the hair under it is pressed in (costume.ts pressHair). */
  head?: Headwear;
}

/** A hood's opening: over the brow in front (m above the eyes), down past the cheeks from HOOD_FACE (rad either side of the
 * front) to under the jaw at the sides and the back. */
const HOOD_BROW = 0.045, HOOD_LOW = -0.1, HOOD_FACE = 0.62;
const hoodEdge = (f: HeadFit, az: number): number =>
  (f.eyeL.y + f.eyeR.y) / 2 + lerp(HOOD_BROW, HOOD_LOW, smooth(HOOD_FACE, HOOD_FACE + 0.45, Math.abs(az)));
const HOOD: Headwear = { front: HOOD_BROW, back: HOOD_LOW, up: null, under: 0.012, edge: hoodEdge };
const TOQUE: Headwear = { front: 0.03, back: -0.004, up: null, under: 0.006 };

const suit = (print: Print, socks: PaintSocks, shoes?: [string, string, string]): Paint =>
  ({ top: 'long', bottom: 'tights', socks, print, ...(shoes ? { shoes: { upper: shoes[0], sole: shoes[1], accent: shoes[2] } } : {}) });

export const COSTUMES: Record<string, Costume> = {
  'costume-banana': { look: { shirt: 0xf0cb3a, trim: 0x5a4214, shorts: 0xf0cb3a, socks: 0xf0cb3a }, paint: suit('banana', 'crew'), covers: { head: false, eyes: false } },
  'costume-tuxedo': {
    look: { shirt: 0x141519, trim: 0xf3f1ec, shorts: 0x141519, socks: 0x141519 },
    paint: suit('tux', 'crew', ['#0e0e10', '#0e0e10', '#26262b']), covers: { head: false, eyes: false },
  },
  'costume-astronaut': {
    look: { shirt: 0xe8e6e0, trim: 0x9ea4ac, shorts: 0xe8e6e0, socks: 0xe8e6e0 },
    paint: suit('astro', 'knee', ['#e2e0da', '#5d6066', '#a7abb2']), covers: { head: true, eyes: true },
  },
  'costume-dino': { look: { shirt: 0x4e8a3a, trim: 0xdcca86, shorts: 0x4e8a3a, socks: 0x4e8a3a }, paint: suit('dino', 'crew'), covers: { head: true, eyes: false }, head: HOOD },
  'costume-chef': {
    look: { shirt: 0xf3f2ee, trim: 0x1b1b1d, shorts: 0x1e1e21, socks: 0x1b1b1d },
    paint: suit('chef', 'crew', ['#1b1b1d', '#1b1b1d', '#1b1b1d']), covers: { head: true, eyes: false }, head: TOQUE,
  },
};

/**
 * A player's kit colours and what they wear with their costume, if any, put on: its colours and its suit, and nothing of
 * their own where it covers them (a modelled band or visor comes off under a hood or a toque). Their overgrip and bag stay.
 */
export function costumed(look: KitLook, wear?: Wear): { look: KitLook; wear?: Wear } {
  const c = wear?.costume ? COSTUMES[wear.costume] : undefined;
  if (!c || !wear) return { look, wear };
  const w: Wear = { ...wear, paint: { ...c.paint } };
  if (c.covers.head) w.head = null;
  if (c.covers.eyes) w.eyes = null;
  return { look: { ...look, ...c.look }, wear: w };
}

/**
 * The build of a person a player is drawn as (its file's name, and its `look.name`): their MetaHuman build (asset.ts
 * metaHumanOf) whatever they wear, since 13 Nov 2026 it has the wardrobe their MakeHuman build has (every top, both skirts,
 * tights, each sock length, a collar: tools/assets/metahuman/mh-player.py); a costume or a print is still made on the
 * MakeHuman build alone. Otherwise the person as named: the MakeHuman build, or a guest.
 */
export function bodyFor(person: string, wear?: Wear): string {
  const mh = metaHumanOf(person);
  if (!mh || wear?.costume || wear?.paint?.print) return person;
  return mh;
}

/** Dress a person (costume.ts worn) with their costume's pieces too, and the hair under its hood or toque pressed in. */
export function dressFor(asset: PlayerAsset, wear: Wear, look: KitLook, index: THREE.BufferAttribute | null): Dressing {
  const d = worn(asset, wear, look, index);
  const c = wear.costume ? COSTUMES[wear.costume] : undefined;
  if (!c || !asset.look) return d;
  d.pieces.push(...costumePieces(asset, wear.costume!, wear.paint ?? c.paint));
  if (c.head) d.hair = pressHair(asset, c.head);
  return d;
}

// ---- the body, as drawn in the costume -----------------------------------------------------------------------

/** Which coordinates (u, v) a relief along x, y or z is laid out by. */
const UV: ReadonlyArray<readonly [number, number]> = [[2, 1], [0, 2], [0, 1]];

/**
 * The body as drawn, seen along one axis from one side: per `cell` square of the other two coordinates (u, v), the
 * coordinate along the axis of the surface nearest that side; cloth laid over it bridges a hollow (each cell the outermost
 * within a cell of it), and cells off the body are filled from round them.
 */
export class Relief {
  readonly axis: number; readonly side: number; readonly u0: number; readonly v0: number;
  readonly nu: number; readonly nv: number; readonly cell: number; readonly d: Float32Array;
  constructor(axis: number, side: number, u0: number, v0: number, nu: number, nv: number, cell: number, d: Float32Array) {
    this.axis = axis; this.side = side; this.u0 = u0; this.v0 = v0; this.nu = nu; this.nv = nv; this.cell = cell; this.d = d;
  }

  /** The surface's coordinate along the axis at (u, v). */
  at(u: number, v: number): number {
    const fu = Math.max(0, Math.min(this.nu - 1.001, (u - this.u0) / this.cell - 0.5));
    const fv = Math.max(0, Math.min(this.nv - 1.001, (v - this.v0) / this.cell - 0.5));
    const i = Math.floor(fu), j = Math.floor(fv), tu = fu - i, tv = fv - j, n = this.nu, d = this.d;
    return (d[j * n + i]! * (1 - tu) + d[j * n + i + 1]! * tu) * (1 - tv) + (d[(j + 1) * n + i]! * (1 - tu) + d[(j + 1) * n + i + 1]! * tu) * tv;
  }

  /** The point on it at (u, v), `off` out from it. */
  point(u: number, v: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [iu, iv] = UV[this.axis]!;
    return out.setComponent(iu, u).setComponent(iv, v).setComponent(this.axis, this.at(u, v) + this.side * off);
  }

  /** Its outward normal at (u, v). */
  normal(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [iu, iv] = UV[this.axis]!, e = this.cell * 1.5;
    const du = (this.at(u + e, v) - this.at(u - e, v)) / (2 * e), dv = (this.at(u, v + e) - this.at(u, v - e)) / (2 * e);
    return out.setComponent(iu, -this.side * du).setComponent(iv, -this.side * dv).setComponent(this.axis, this.side).normalize();
  }
}

/** A body as drawn in a costume: its landmarks, triangles, and reliefs from the front, the back and above. */
interface Fit {
  asset: PlayerAsset;
  frame: KitFrame;
  pos: Float32Array;
  tris: ArrayLike<number>;
  drawn: Uint8Array;
  chest: THREE.Vector3; neck: THREE.Vector3; head: THREE.Vector3; hips: THREE.Vector3;
  front: Relief; back: Relief;
  /** Round the neck: the body seen from above without the neck's column and the head (the shoulders' slope, the clavicles,
   * the top of the back), and which vertices are that column or the head. */
  above: Relief;
  column: (v: number) => boolean;
  /** Drawn vertices round the neck's base that aren't its column, in 1 cm cells (outsideOf). */
  base?: Map<number, number[]>;
}

const joint = (asset: PlayerAsset, bone: string): THREE.Vector3 =>
  new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[asset.bone(bone)]!.clone().invert());

/**
 * The body's surface seen along `axis` from `side` (+1 the largest coordinate), over u in [u0, u1], v in [v0, v1]:
 * every triangle drawn (or those `keep` keeps), rasterised at each cell's centre.
 */
export function relief(pos: Float32Array, tris: ArrayLike<number>, axis: number, side: number, u0: number, u1: number, v0: number, v1: number, keep?: (a: number, b: number, c: number) => boolean, cell = 0.005): Relief {
  const [iu, iv] = UV[axis]!;
  const nu = Math.ceil((u1 - u0) / cell), nv = Math.ceil((v1 - v0) / cell);
  const d = new Float32Array(nu * nv).fill(NaN);
  const c = (k: number, i: number): number => pos[k * 3 + i]!;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!, b = tris[t + 1]!, e = tris[t + 2]!;
    if (keep && !keep(a, b, e)) continue;
    const ua = c(a, iu), va = c(a, iv), ub = c(b, iu), vb = c(b, iv), ue = c(e, iu), ve = c(e, iv);
    const i0 = Math.max(0, Math.ceil((Math.min(ua, ub, ue) - u0) / cell - 0.5)), i1 = Math.min(nu - 1, Math.floor((Math.max(ua, ub, ue) - u0) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(va, vb, ve) - v0) / cell - 0.5)), j1 = Math.min(nv - 1, Math.floor((Math.max(va, vb, ve) - v0) / cell - 0.5));
    if (i0 > i1 || j0 > j1) continue;
    const den = (vb - ve) * (ua - ue) + (ue - ub) * (va - ve);
    if (Math.abs(den) < 1e-14) continue;
    const wa = c(a, axis), wb = c(b, axis), we = c(e, axis);
    for (let j = j0; j <= j1; j++) {
      const cv = v0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const cu = u0 + (i + 0.5) * cell;
        const l0 = ((vb - ve) * (cu - ue) + (ue - ub) * (cv - ve)) / den, l1 = ((ve - va) * (cu - ue) + (ua - ue) * (cv - ve)) / den, l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const w = l0 * wa + l1 * wb + l2 * we, k = j * nu + i;
        if (!(d[k]! * side >= w * side)) d[k] = w;
      }
    }
  }
  // Over hollows: the outermost within a cell.
  const o = new Float32Array(d.length);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    let m = NaN;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = i + di;
      if (jj < 0 || jj >= nv || ii < 0 || ii >= nu) continue;
      const x = d[jj * nu + ii]!;
      if (!Number.isNaN(x) && !(m * side >= x * side)) m = x;
    }
    o[j * nu + i] = m;
  }
  // Off the body: from round it.
  for (let pass = 0, left = 1; left && pass < 400; pass++) {
    left = 0;
    const prev = o.slice();
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      if (!Number.isNaN(prev[k]!)) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || ii >= nu || jj < 0 || jj >= nv) continue;
        const x = prev[jj * nu + ii]!;
        if (!Number.isNaN(x)) { s += x; n++; }
      }
      if (n) o[k] = s / n;
      else left++;
    }
  }
  return new Relief(axis, side, u0, v0, nu, nv, cell, o);
}

const FITS = new WeakMap<PlayerAsset, Map<string, Fit>>();

/**
 * Every triangle of a body as drawn in `paint` (ids into its geometry): the garments worn (asset.ts dressedIndex) and
 * the face's, which is drawn apart and has the front of the neck. `bare`: without a headband or visor they were modelled
 * in (it comes off under a hood or a toque).
 */
export function drawnTriangles(asset: PlayerAsset, paint?: Paint, bare = false): Uint32Array {
  const w = asset.look?.wardrobe ?? null, face = asset.look?.face;
  let body: ArrayLike<number> = w ? dressedIndex(asset, piecesFor(w, paint) ?? w.worn) : face?.bodyIndex ?? asset.geometry.index!.array;
  if (bare) body = withoutBakedHead(asset, new THREE.BufferAttribute(body instanceof Uint16Array ? body : Uint32Array.from(body), 1))?.array ?? body;
  const out = new Uint32Array(body.length + (face ? face.index.length : 0));
  out.set(body);
  if (face) for (let k = 0; k < face.index.length; k++) out[body.length + k] = face.verts[face.index[k]!]!;
  return out;
}

/** A body as drawn in `paint` (its garments: asset.ts dressedIndex), measured once per body and cut. */
function fitOf(asset: PlayerAsset, paint: Paint): Fit {
  const w = asset.look?.wardrobe ?? null;
  const pieces = w ? (piecesFor(w, paint) ?? w.worn) : null;
  const key = pieces ? pieces.join('+') : '';
  let byCut = FITS.get(asset);
  if (!byCut) FITS.set(asset, (byCut = new Map()));
  const had = byCut.get(key);
  if (had) return had;
  const pos = asset.geometry.getAttribute('position').array as Float32Array;
  const tris = drawnTriangles(asset, paint);
  const drawn = new Uint8Array(pos.length / 3);
  for (let t = 0; t < tris.length; t++) drawn[tris[t]!] = 1;
  const chest = joint(asset, 'Spine2'), neck = joint(asset, 'Neck'), head = joint(asset, 'Head'), hips = joint(asset, 'Hips');
  const x0 = chest.x - 0.3, x1 = chest.x + 0.3, y0 = hips.y - 0.3, y1 = head.y + 0.05;
  // (by its bones: a height leaves out the big triangles across the top of the back, and the buttocks showed instead)
  const si = asset.geometry.getAttribute('skinIndex') as THREE.BufferAttribute, sw = asset.geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
  const bn = asset.bone('Neck'), bh = asset.bone('Head');
  const column = (v: number): boolean => weightOf(si, sw, v, bn) >= 0.6 || weightOf(si, sw, v, bh) >= 0.5;
  const fit: Fit = {
    asset, frame: personFrame(asset), pos, tris, drawn, chest, neck, head, hips,
    front: relief(pos, tris, 2, 1, x0, x1, y0, y1),
    back: relief(pos, tris, 2, -1, x0, x1, y0, y1),
    above: relief(pos, tris, 1, 1, neck.x - 0.2, neck.x + 0.2, neck.z - 0.2, neck.z + 0.25,
      (a, b, c) => !(column(a) && column(b) && column(c)) && weightOf(si, sw, a, bh) + weightOf(si, sw, b, bh) + weightOf(si, sw, c, bh) < 1),
    column,
  };
  byCut.set(key, fit);
  return fit;
}

const cellKey = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

/**
 * Whether a point is outside what is round the neck's base by `margin` (m): along the normal of the nearest of its drawn
 * vertices within 2 cm that aren't the neck's column or the head (none near: outside).
 */
function outsideOf(fit: Fit): (q: THREE.Vector3, margin: number) => boolean {
  const { pos, drawn, neck } = fit, nrm = fit.asset.geometry.getAttribute('normal') as THREE.BufferAttribute;
  if (!fit.base) {
    fit.base = new Map();
    for (let v = 0; v < drawn.length; v++) {
      if (!drawn[v] || fit.column(v)) continue;
      const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
      if (Math.abs(y - neck.y) > 0.15 || Math.hypot(x - neck.x, z - neck.z) > 0.2) continue;
      const k = cellKey(Math.floor(x / 0.01), Math.floor(y / 0.01), Math.floor(z / 0.01));
      let c = fit.base.get(k);
      if (!c) fit.base.set(k, (c = []));
      c.push(v);
    }
  }
  const cells = fit.base;
  return (q, margin) => {
    const cx = Math.floor(q.x / 0.01), cy = Math.floor(q.y / 0.01), cz = Math.floor(q.z / 0.01);
    let best = -1, bd = 0.02 * 0.02;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      for (const v of cells.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
        const d = (pos[v * 3]! - q.x) ** 2 + (pos[v * 3 + 1]! - q.y) ** 2 + (pos[v * 3 + 2]! - q.z) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
    }
    if (best < 0) return true;
    return (q.x - pos[best * 3]!) * nrm.getX(best) + (q.y - pos[best * 3 + 1]!) * nrm.getY(best) + (q.z - pos[best * 3 + 2]!) * nrm.getZ(best) >= margin;
  };
}

/** The drawn body vertices within `reach` of a geometry's bounds: what a piece on the body is skinned from. */
function nearOf(fit: Fit, g: THREE.BufferGeometry, reach = 0.04): number[] {
  g.computeBoundingBox();
  const b = g.boundingBox!.clone().expandByScalar(reach), p = new THREE.Vector3(), out: number[] = [];
  for (let v = 0; v < fit.drawn.length; v++) {
    if (!fit.drawn[v]) continue;
    p.fromArray(fit.pos, v * 3);
    if (b.containsPoint(p)) out.push(v);
  }
  return out;
}

/** Turn a geometry's triangles round if the normal at `vertex` points against `dir` (a closed shell built inside out). */
function faceOut(g: THREE.BufferGeometry, vertex: number, dir: THREE.Vector3): THREE.BufferGeometry {
  const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal') as THREE.BufferAttribute, vertex);
  if (n.dot(dir) >= 0) return g;
  const idx = g.index!.array as Uint32Array | Uint16Array | number[];
  const flipped: number[] = [];
  for (let t = 0; t < idx.length; t += 3) flipped.push(idx[t]!, idx[t + 2]!, idx[t + 1]!);
  g.setIndex(flipped);
  g.computeVertexNormals();
  return g;
}

/** Give a geometry its colours per vertex. */
function colourBy(g: THREE.BufferGeometry, f: (i: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { f(i, c); c.toArray(a, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** A small round thing standing on a surface (a button, an eye, a knob): `profile` (radius, height) about its axis, turned
 * to `n`, its base at `p`. */
function stud(profile: Array<[number, number]>, p: THREE.Vector3, n: THREE.Vector3, segs = 20): THREE.BufferGeometry {
  const g = lathe(profile, segs);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()));
  g.translate(p.x, p.y, p.z);
  return g;
}
const DOME = (r: number, h: number): Array<[number, number]> => [[0, h], [r * 0.5, h * 0.94], [r * 0.82, h * 0.72], [r, h * 0.3], [r, 0]];

/**
 * A soft fin (a dinosaur's spike): `h` high off its base at `p`, `len` long along `t` at the base and 2 x `half` thick
 * across, leaning `lean` x h along t towards the tip, round in section, its tip rounded.
 */
function fin(p: THREE.Vector3, n: THREE.Vector3, t: THREE.Vector3, h: number, len: number, half: number, lean: number): THREE.BufferGeometry {
  const x = new THREE.Vector3().crossVectors(n, t).normalize(), tt = new THREE.Vector3().crossVectors(x, n).normalize();
  const g = surface(18, 12, true, (u, v, q) => {
    const th = u * TAU, k = Math.sqrt(Math.max(0, 1 - v ** 1.6));
    q.copy(p).addScaledVector(n, h * v - 0.0004).addScaledVector(tt, (len / 2) * k * Math.cos(th) + lean * h * v).addScaledVector(x, (half * (0.35 + 0.65 * k) + 0.0008) * Math.sin(th));
  });
  return faceOut(g, Math.round(0.25 * 18) + 6 * 18, x);
}

/** A rigid piece on a bone (its matrix that bone's inverse bind matrix). */
function onBone(asset: PlayerAsset, bone: string, g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]): Piece {
  const mesh = new THREE.Mesh(g, m);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(asset.boneInverses[asset.bone(bone)]!);
  return { bone, mesh };
}

/** A piece skinned like the body under it. */
function onBody(fit: Fit, g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], near = nearOf(fit, g)): Piece {
  skinLike(g, fit.asset, near);
  return { bone: 'Spine2', mesh: new THREE.SkinnedMesh(g, m), skinned: true };
}

/** Satin (a bow tie, lapels): smooth, with a sheen along the light. */
function satin(colour: number): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(colour);
  return new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0, sheen: 1, sheenRoughness: 0.28, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.3), side: THREE.FrontSide });
}

/**
 * A band round the neck (a collar): `from` to `to` m up the neck from its joint (towards the head's), `thick` thick, open at
 * the front by `gap` (rad). Its radius by angle and height is the neck's (the furthest-out drawn vertex in each bin of 4
 * rings up the band, what is over it left out: what faces down, and the head's own, the chin), so it sits on the neck's base
 * and closes round the throat; its bottom edge then steps up out of whatever is still round it (outsideOf), and its top
 * stays under what is over it, at least 12 mm apart. Skinned like the neck.
 */
function collar(fit: Fit, from: number, to: number, thick: number, gap: number, m: THREE.Material): Piece | null {
  const { asset, neck, head } = fit;
  const axis = head.clone().sub(neck).normalize();
  const fwd = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize(), side = new THREE.Vector3().crossVectors(axis, fwd);
  const nrm = asset.geometry.getAttribute('normal') as THREE.BufferAttribute;
  const si = asset.geometry.getAttribute('skinIndex') as THREE.BufferAttribute, sw = asset.geometry.getAttribute('skinWeight') as THREE.BufferAttribute, bh = asset.bone('Head');
  const N = 48, NR = 4, p = new THREE.Vector3(), n = new THREE.Vector3(), near: number[] = [];
  const a0 = from - 0.005, ring = (to + 0.005 - a0) / NR;
  const bin = (x: number, z: number): number => Math.round(((Math.atan2(x, z) + TAU) % TAU) / TAU * N) % N;
  const local: Array<[number, number, number, number, boolean]> = []; // along, x, z, r, over it (faces down, or the head's)
  for (let v = 0; v < fit.drawn.length; v++) {
    if (!fit.drawn[v]) continue;
    p.fromArray(fit.pos, v * 3).sub(neck);
    const along = p.dot(axis), x = p.dot(side), z = p.dot(fwd), r = Math.hypot(x, z);
    if (along < from - 0.04 || along > to + 0.06 || r > 0.14) continue;
    near.push(v);
    local.push([along, x, z, r, n.fromBufferAttribute(nrm, v).dot(axis) < -0.25 || weightOf(si, sw, v, bh) >= 0.9]);
  }
  const rs = local.filter(([a, , , , down]) => !down && a >= a0 && a <= to + 0.005).map(([, , , r]) => r).sort((a, b) => a - b);
  if (!rs.length) return null;
  const mid = rs[Math.floor(rs.length / 2)]!, cap = mid + 0.03;
  const R = new Float32Array(NR * N);
  for (const [a, x, z, r, down] of local) {
    if (down || a < a0 || a > to + 0.005 || r > cap) continue;
    const j = Math.min(NR - 1, Math.floor((a - a0) / ring)), k = bin(x, z);
    R[j * N + k] = Math.max(R[j * N + k]!, r);
  }
  for (let j = 0; j < NR; j++) {
    let m0 = 0, c = 0;
    for (let k = 0; k < N; k++) if (R[j * N + k]! > 0) { m0 += R[j * N + k]!; c++; }
    for (let k = 0; k < N; k++) if (!(R[j * N + k]! > 0)) R[j * N + k] = c ? m0 / c : mid;
  }
  // (cloth over a hollow: the furthest out within a bin and a ring either side)
  const S = new Float32Array(NR * N);
  for (let j = 0; j < NR; j++) for (let k = 0; k < N; k++) {
    let m0 = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= NR) continue;
      for (let d = -1; d <= 1; d++) m0 = Math.max(m0, R[jj * N + ((k + d + N) % N)]!);
    }
    S[j * N + k] = m0;
  }
  const radAt = (az: number, along: number): number => {
    const fk = (((az % TAU) + TAU) % TAU) / TAU * N, k0 = Math.floor(fk) % N, k1 = (k0 + 1) % N, tk = fk - Math.floor(fk);
    const fj = Math.max(0, Math.min(NR - 1, (along - a0) / ring - 0.5)), j0 = Math.floor(fj), j1 = Math.min(NR - 1, j0 + 1), tj = fj - j0;
    const at = (j: number): number => S[j * N + k0]! * (1 - tk) + S[j * N + k1]! * tk;
    return at(j0) * (1 - tj) + at(j1) * tj;
  };
  const lo = new Float32Array(N), hi = new Float32Array(N).fill(to), q = new THREE.Vector3(), out = outsideOf(fit);
  // (none in the opening, more than a bin from the band's ends: what is in front of the throat there would lift them)
  const open = (k: number): boolean => Math.min(k, N - k) * (TAU / N) < gap / 2 - 0.5 * (TAU / N);
  for (let k = 0; k < N; k++) {
    const az = (k / N) * TAU;
    let a = from;
    for (let step = 0; step < 20 && !open(k); step++) {
      let clear = true;
      for (const dr of [0.002, 0.004 + thick / 2, 0.006 + thick]) {
        const r = radAt(az, a) + dr;
        q.copy(neck).addScaledVector(axis, a).addScaledVector(fwd, Math.cos(az) * r).addScaledVector(side, Math.sin(az) * r);
        if (!out(q, 0.003)) clear = false;
      }
      if (clear) break;
      a += 0.002;
    }
    lo[k] = a;
  }
  for (const [a, x, z, r, down] of local) {
    if (!down) continue;
    const k = bin(x, z), az = (k / N) * TAU;
    if (open(k)) continue;
    if (a > lo[k]! && r > radAt(az, a) - 0.01 && r < radAt(az, a) + thick + 0.03) hi[k] = Math.min(hi[k]!, a - 0.004);
  }
  const LO = lo.map((_, k) => Math.max(lo[(k + N - 1) % N]!, lo[k]!, lo[(k + 1) % N]!));
  const HI = hi.map((_, k) => Math.max(LO[k]! + 0.012, Math.min(hi[(k + N - 1) % N]!, hi[k]!, hi[(k + 1) % N]!)));
  const at = (t: Float32Array, az: number): number => {
    const f = (((az % TAU) + TAU) % TAU) / TAU * N, k0 = Math.floor(f) % N, k1 = (k0 + 1) % N, u = f - Math.floor(f);
    return t[k0]! * (1 - u) + t[k1]! * u;
  };
  const band = surface(20, 64, true, (u, v, o) => {
    const th = u * TAU, az = gap / 2 + v * (TAU - gap), a = at(LO, az), b = at(HI, az), h = b - a;
    const along = a + h / 2 + (h / 2) * sp(Math.cos(th), 5);
    // (standing a little off the neck, and further at its top: a collar stands up, it doesn't follow the neck in)
    const r = radAt(az, along) + 0.002 + 0.003 * (along - a) / h + thick / 2 + (thick / 2) * sp(Math.sin(th), 3);
    o.copy(neck).addScaledVector(axis, along).addScaledVector(fwd, Math.cos(az) * r).addScaledVector(side, Math.sin(az) * r);
  });
  return onBody(fit, faceOut(band, Math.round(0.25 * 20) + 32 * 20, new THREE.Vector3().copy(fwd).multiplyScalar(-1)), m, near);
}

// ---- the costumes' pieces --------------------------------------------------------------------------------------

/** The pieces a costume adds to the suit, fitted to this person in it. */
export function costumePieces(asset: PlayerAsset, id: string, paint: Paint): Piece[] {
  const fit = fitOf(asset, paint);
  let out: Piece[];
  switch (id) {
    case 'costume-banana': out = banana(fit); break;
    case 'costume-tuxedo': out = tuxedo(fit); break;
    case 'costume-astronaut': out = astronaut(fit); break;
    case 'costume-dino': out = dino(fit); break;
    case 'costume-chef': out = chef(fit); break;
    default: out = [];
  }
  for (const p of out) {
    p.mesh.castShadow = true;
    p.mesh.name = 'worn';
  }
  return out;
}

/**
 * Four petals of peel turned down from the neck, two over the chest and two over the back, yellow outside and pale on the
 * inside (it shows where they curl off the body): about 4 mm thick, widest a third of the way down, a brown tip. (Pale side
 * out they read as a paper collar.)
 */
function banana(fit: Fit): Piece[] {
  const { chest, neck } = fit;
  const parts: Part[] = [];
  const NU = 20, NV = 22;
  const cream = new THREE.Color(0xf0e6bd), yellow = new THREE.Color(0xeac53b), brown = new THREE.Color(0x4b3414);
  for (const [rel, len] of [[fit.front, 0.25], [fit.back, 0.27]] as const) {
    for (const sx of [-1, 1]) {
      const cx = chest.x + sx * 0.05, y0 = neck.y + 0.012, W = 0.052;
      const g = surface(NU, NV, true, (u, v, q) => {
        const th = u * TAU, a = Math.cos(th), b = Math.sin(th);
        const hw = W * Math.sqrt(Math.max(0, 1 - v ** 2.6)) * (1 + 0.18 * Math.sin(Math.PI * v));
        const thick = 0.0042 * (1 - 0.5 * v);
        const off = 0.003 + 0.06 * v ** 2.4 + 0.007 * a * a * (1 - 0.5 * v) + (thick / 2) * (1 + b);
        rel.point(cx + sx * 0.025 * v + a * hw, y0 - v * len, off, q);
      });
      // (its outer face, b = 1, faces off the body)
      faceOut(g, Math.round(0.25 * NU) + 7 * NU, rel.normal(cx, y0 - 0.3 * len));
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      colourBy(g, (i, c) => {
        const u = (i % NU) / NU, v = Math.floor(i / NU) / NV, b = Math.sin(u * TAU);
        c.copy(cream).lerp(yellow, smooth(-0.3, 0.3, b)).lerp(brown, smooth(0.86, 0.96, v));
        void pos;
      });
      parts.push({ g, m: 0 });
    }
  }
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5 });
  const g = mergeParts(parts);
  g.clearGroups();
  return [onBody(fit, g, m)];
}

/**
 * A dinner jacket over the suit's print (paint.ts printShirt 'tux': the shirt's front in a V to the button): satin shawl
 * lapels along the V either side, rolled at their inner edge; the jacket's satin button; a wing collar; a bow tie.
 */
function tuxedo(fit: Fit): Piece[] {
  const { chest, neck, frame, asset } = fit;
  // The V, as the print draws it.
  const yB = frame.hemY + 0.14, yC = neck.y - 0.05;
  const bibW = (y: number): number => lerp(0.01, 0.068, smooth(yB, yC, y)) + smooth(yC, neck.y, y) * 0.04;
  const lapelW = (y: number): number => lerp(0.012, 0.062, smooth(yB, yB + 0.12, y)) * lerp(1, 0.45, smooth(yC - 0.04, neck.y, y));
  const parts: Part[] = [];
  for (const sx of [-1, 1]) {
    const g = surface(18, 30, true, (u, v, q) => {
      const th = u * TAU, a = Math.cos(th), b = Math.sin(th);
      const y = lerp(yB - 0.004, neck.y, v), across = (a + 1) / 2;
      const off = 0.0012 + 0.0024 * (1 - across) ** 2 + 0.0016 * (1 + b);
      fit.front.point(chest.x + sx * (bibW(y) - 0.002 + across * lapelW(y)), y, off, q);
    });
    parts.push({ g: faceOut(g, Math.round(0.25 * 18) + 15 * 18, fit.front.normal(chest.x + sx * 0.06, (yB + yC) / 2)), m: 0 });
  }
  const bp = fit.front.point(chest.x, yB - 0.009, 0.001), bn = fit.front.normal(chest.x, yB - 0.009);
  parts.push({ g: stud(DOME(0.009, 0.0045), bp, bn), m: 0 });
  const silk = satin(0x121215);
  const out: Piece[] = [onBody(fit, mergeParts(parts), [silk])];
  // (open wide at the front, under the bow)
  const wing = collar(fit, 0.004, 0.036, 0.0018, 0.5, fabric('twill', 0xf3f1ec, THREE.DoubleSide));
  if (wing) out.push(wing);
  // The bow, at the collar's front, on the neck, facing forward square to the neck (the surface there slopes into the chest,
  // and turned to it the bow faced the sky).
  const axis = fit.head.clone().sub(neck).normalize();
  const at = fit.front.point(neck.x, neck.y + 0.026, 0.011), n = new THREE.Vector3(0, -axis.z, axis.y).normalize();
  const bow: Part[] = [];
  for (const sx of [-1, 1]) {
    const w = tube((t, o) => o.set(sx * (0.004 + t * 0.052), 0, 0), 0.044, 0.013, {
      n: 22, around: 18, power: 2.6, up: new THREE.Vector3(0, 0, 1), caps: true,
      size: (t) => (0.3 + 0.7 * smooth(0, 0.7, t)) * Math.sqrt(Math.max(0, 1 - (Math.max(0, t - 0.8) / 0.2) ** 2)) + 0.02,
    });
    w.rotateZ(sx * -0.09);
    bow.push({ g: w, m: 0 });
  }
  const knot = roundedBox(0.017, 0.024, 0.013, 0.005, { seg: 6 });
  knot.translate(0, -0.012, 0.003);
  bow.push({ g: knot, m: 0 });
  const bg = mergeParts(bow);
  bg.clearGroups();
  bg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
  bg.translate(at.x, at.y, at.z);
  out.push(onBone(asset, 'Neck', bg, silk));
  return out;
}

/** A body's outline in the plane x = `x` (its drawn vertices within 3 cm of it below the neck's base, the arms', neck's and
 * head's left out), in
 * polar bins round `c` (z, y): the furthest out at each angle, smoothed over a bin either side. */
function outline(fit: Fit, x: number, c: THREE.Vector2, bins = 180): (phi: number) => number {
  const g = fit.asset.geometry, si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const skip = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'Head'].map((b) => fit.asset.bone(b));
  const R = new Float32Array(bins);
  for (let v = 0; v < fit.drawn.length; v++) {
    if (!fit.drawn[v] || Math.abs(fit.pos[v * 3]! - x) > 0.03) continue;
    let w = 0;
    for (const b of skip) w += weightOf(si, sw, v, b);
    // (nor the neck's column: the strap goes over the shoulder's slope, not up the neck)
    if (w > 0.4 || fit.column(v) || fit.pos[v * 3 + 1]! > fit.neck.y + 0.02) continue;
    const dz = fit.pos[v * 3 + 2]! - c.x, dy = fit.pos[v * 3 + 1]! - c.y;
    const k = Math.round(((Math.atan2(dy, dz) + TAU) % TAU) / TAU * bins) % bins;
    R[k] = Math.max(R[k]!, Math.hypot(dz, dy));
  }
  // (an empty bin from the nearest full ones either side)
  const full = [...R.keys()].filter((k) => R[k]! > 0);
  if (full.length) for (let k = 0; k < bins; k++) {
    if (R[k]! > 0) continue;
    let a = k, b = k;
    while (!(R[a]! > 0)) a = (a + bins - 1) % bins;
    while (!(R[b]! > 0)) b = (b + 1) % bins;
    const da = (k - a + bins) % bins, db = (b - k + bins) % bins;
    R[k] = (R[a]! * db + R[b]! * da) / (da + db);
  }
  const S = R.map((_, k) => Math.max(R[(k + bins - 1) % bins]!, R[k]!, R[(k + 1) % bins]!));
  return (phi) => {
    const f = (((phi % TAU) + TAU) % TAU) / TAU * bins, k0 = Math.floor(f) % bins, k1 = (k0 + 1) % bins, t = f - Math.floor(f);
    return S[k0]! * (1 - t) + S[k1]! * t;
  };
}

/**
 * A spacesuit's hardware over the suit (paint.ts printShirt 'astro'): a neck ring resting on the shoulders (round, on a
 * plane through where they are highest in front and behind), a backpack on the shoulder blades, its straps over the
 * shoulders to a control box on the chest.
 */
function astronaut(fit: Fit): Piece[] {
  const { asset, chest, neck, pos, drawn } = fit;
  const out: Piece[] = [];
  // The neck's axis and radius over its lowest 4 cm.
  const g = asset.geometry, si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const bn = asset.bone('Neck');
  let ax = 0, az = 0, n = 0;
  for (let v = 0; v < drawn.length; v++) {
    const y = pos[v * 3 + 1]!;
    if (!drawn[v] || y < neck.y || y > neck.y + 0.04 || weightOf(si, sw, v, bn) < 0.5) continue;
    ax += pos[v * 3]!; az += pos[v * 3 + 2]!; n++;
  }
  ax = n ? ax / n : neck.x; az = n ? az / n : neck.z;
  // (a suit's ring is wide: 4 cm clear of the neck's column where it is widest, most of it)
  const rs: number[] = [];
  for (let v = 0; v < drawn.length; v++) {
    const y = pos[v * 3 + 1]!;
    if (drawn[v] && y >= neck.y - 0.01 && y <= neck.y + 0.04 && fit.column(v)) rs.push(Math.hypot(pos[v * 3]! - ax, pos[v * 3 + 2]! - az));
  }
  rs.sort((a, b) => a - b);
  const R = Math.min(0.125, Math.max(0.105, (rs[Math.floor(rs.length * 0.8)] ?? 0.065) + 0.04)), RW = 0.016;
  // (seen from above, below the neck's joint: the shoulders, not the chin over them)
  const HR = 0.031;
  const under = (a: number): number => Math.max(...[R - RW / 2, R, R + RW / 2].map((r) => fit.above.at(ax + Math.sin(a) * r, az + Math.cos(a) * r)));
  // (the head's vertices over the ring's footprint: the chin and jaw)
  const bh = asset.bone('Head'), chin: Array<[number, number]> = [];
  for (let v = 0; v < drawn.length; v++) {
    if (!drawn[v] || weightOf(si, sw, v, bh) < 0.5) continue;
    const r = Math.hypot(pos[v * 3]! - ax, pos[v * 3 + 2]! - az);
    if (r > R - RW / 2 - 0.006 && r < R + RW / 2 + 0.006) chin.push([Math.atan2(pos[v * 3]! - ax, pos[v * 3 + 2]! - az), pos[v * 3 + 1]!]);
  }
  // Resting where the shoulders are highest in front and behind, tipped further forward until its front is 4 cm under the chin
  // (the head nods and turns over it: with 3 mm the jaw went through it as the player looked round).
  let tilt = (under(0) - under(Math.PI)) / 2, base = 0;
  for (let k = 0; k < 16; k++, tilt -= 0.004) {
    base = -Infinity;
    for (let j = 0; j < 72; j++) { const a = (j / 72) * TAU; base = Math.max(base, under(a) - tilt * Math.cos(a)); }
    base += 0.003;
    if (chin.every(([a, y]) => base + tilt * Math.cos(a) + HR < y - 0.04)) break;
  }
  const ring = (y0: number, h: number, r: number, w: number): THREE.BufferGeometry =>
    tube((t, o) => { const a = t * TAU; o.set(ax + Math.sin(a) * r, y0 + h / 2 + tilt * Math.cos(a), az + Math.cos(a) * r); }, w, h,
      { n: 72, around: 16, power: 5, up: new THREE.Vector3(0, 1, 0) });
  const rings: Part[] = [{ g: ring(base, 0.019, R, RW), m: 0 }, { g: ring(base + 0.019, HR - 0.019, R - 0.002, RW - 0.004), m: 1 }];
  out.push(onBone(asset, 'Spine2', mergeParts(rings), [metal(0x3d63ad, 0.38), metal(0xc3c7cd, 0.28)]));

  // The pack: its front on the back's furthest-back point over its footprint, a centimetre off.
  const W = 0.34, H = 0.43, D = 0.13, pTop = neck.y - 0.015, pBot = pTop - H;
  let zf = Infinity;
  for (let y = pBot + 0.04; y <= pTop - 0.02; y += 0.01) for (let x = chest.x - W * 0.42; x <= chest.x + W * 0.42; x += 0.01) zf = Math.min(zf, fit.back.at(x, y));
  zf -= 0.01;
  const pack: Part[] = [];
  const body = roundedBox(W, H, D, 0.035, { seg: 10, pillow: 0.008 });
  body.translate(chest.x, pBot, zf - D / 2);
  pack.push({ g: body, m: 0 });
  const panel = roundedBox(W * 0.68, H * 0.6, 0.008, 0.004, { seg: 4 });
  panel.translate(chest.x, pBot + H * 0.24, zf - D - 0.002);
  pack.push({ g: panel, m: 1 });
  for (const sx of [-1, 1]) {
    const cap = lathe([[0, 0.017], [0.016, 0.017], [0.021, 0.013], [0.022, 0]], 18);
    cap.translate(chest.x + sx * 0.085, pTop - 0.002, zf - D * 0.55);
    pack.push({ g: cap, m: 2 });
  }
  const seam = tube((t, o) => {
    const a = t * TAU, hx = W / 2 + 0.002, hz = D / 2 + 0.002;
    o.set(chest.x + hx * sp(Math.cos(a), 6), pBot + H * 0.78, zf - D / 2 + hz * sp(Math.sin(a), 6));
  }, 0.006, 0.006, { n: 96, around: 8 });
  pack.push({ g: seam, m: 1 });
  out.push(onBone(asset, 'Spine2', mergeParts(pack), [fabric('ripstop', 0xe6e4de), plastic(0xb5b9bf, 0.5), metal(0x8e949c, 0.35)]));

  // The chest box: its back on the chest's furthest-forward point over its footprint.
  const bW = 0.19, bH = 0.095, bD = 0.045, bY = chest.y - 0.075;
  let zb = -Infinity;
  for (let y = bY - bH / 2; y <= bY + bH / 2; y += 0.008) for (let x = chest.x - bW / 2; x <= chest.x + bW / 2; x += 0.008) zb = Math.max(zb, fit.front.at(x, y));
  zb += 0.003;
  const box: Part[] = [];
  const shell = roundedBox(bW, bH, bD, 0.012, { seg: 8, pillow: 0.002 });
  shell.translate(chest.x, bY - bH / 2, zb + bD / 2);
  box.push({ g: shell, m: 0 });
  const screen = roundedBox(0.07, 0.034, 0.004, 0.0015, { seg: 3 });
  screen.rotateX(Math.PI / 2);
  screen.translate(chest.x - 0.035, bY, zb + bD + 0.0005);
  box.push({ g: screen, m: 1 });
  for (const [dx, r] of [[0.035, 0.011], [0.068, 0.009]] as const) box.push({ g: stud([[0, 0.007], [r * 0.8, 0.0068], [r, 0.004], [r, 0]], new THREE.Vector3(chest.x + dx, bY, zb + bD), new THREE.Vector3(0, 0, 1)), m: 2 });
  for (const dx of [-0.07, -0.03, 0.01, 0.05]) box.push({ g: stud([[0, 0.012], [0.006, 0.0115], [0.0065, 0.004], [0.0065, 0]], new THREE.Vector3(chest.x + dx, bY + bH / 2 - 0.004, zb + bD / 2), new THREE.Vector3(0, 1, 0), 14), m: 2 });
  out.push(onBone(asset, 'Spine2', mergeParts(box), [plastic(0xe4e2dc, 0.55), plastic(0x16202b, 0.12), metal(0x8e949c, 0.35)]));

  // The straps: from behind the pack's top over each shoulder to the box's upper corners, on the body's outline there.
  const straps: Part[] = [];
  for (const sx of [-1, 1]) {
    const x = chest.x + sx * 0.1, c = new THREE.Vector2(chest.z, bY + bH / 2 + 0.015);
    const r = outline(fit, x, c);
    // (from where it comes out over the pack's top: below that it is between the pack and the back)
    let p0 = 3.0;
    while (p0 > 1.8 && c.y + Math.sin(p0) * r(p0) < pTop - 0.03) p0 -= 0.02;
    const phi = (t: number): number => lerp(p0, 0.03, t);
    // (out along its ray until it is off the chest or the back, seen from in front or behind, across its width)
    const off = 0.0085, clear = (y: number, rel: Relief): number => Math.max(...[-0.02, 0, 0.02].map((d) => rel.side * rel.at(x + d, y))) * rel.side;
    const strap = tube((t, o) => {
      const p = phi(t), cz = Math.cos(p), sy = Math.sin(p);
      let rr = r(p) + off;
      for (let it = 0; it < 3; it++) {
        const y = c.y + sy * rr, z = c.x + cz * rr;
        if (cz > 0.3) rr = Math.max(rr, (clear(y, fit.front) + off - c.x) / cz);
        else if (cz < -0.3) rr = Math.max(rr, (clear(y, fit.back) - off - c.x) / cz);
        void z;
      }
      o.set(x, c.y + sy * rr, c.x + cz * rr);
    }, 0.036, 0.0045, { n: 48, around: 12, power: 6, up: (t, o) => { const p = phi(t); o.set(0, Math.sin(p), Math.cos(p)); } });
    straps.push({ g: strap, m: 0 });
  }
  const sg = mergeParts(straps);
  sg.clearGroups();
  out.push(onBody(fit, sg, fabric('webbing', 0xd9d7d1)));
  return out;
}

/**
 * A dinosaur onesie's hood, spikes and tail over the suit (paint.ts printShirt 'dino': the belly). The hood is fleece
 * over the head and its hair (pressed in under it), open round the face, with a rolled edge, two eyes, a row of teeth
 * over the brow and spikes along its top; spikes go on down the back and along the tail, which rides the hips.
 */
function dino(fit: Fit): Piece[] {
  const { asset, chest, neck, hips, frame } = fit;
  const f = fitHead(asset);
  const out: Piece[] = [];
  const fleece = fabric('terry', COSTUMES['costume-dino']!.look.shirt, THREE.DoubleSide);
  const spikeM = fabric('terry', 0xe2862c);
  const white = fabric('terry', 0xf3efe2), black = plastic(0x0d0d0f, 0.25);
  if (f) {
    const t = clothTable(f, HOOD.under), OFF = 0.013;
    const e0 = (az: number): number => Math.max(E0 + 0.04, elAt(f, t, az, hoodEdge(f, az), OFF));
    /** The hood's surface at (az, el), `extra` out from it. */
    const hood = (az: number, el: number, extra: number, o = new THREE.Vector3()): THREE.Vector3 => {
      const lo = e0(az), v = Math.min(1, Math.max(0, (el - lo) / (E1 - lo)));
      const r = radius(t, az, el) + OFF + 0.012 * Math.sin(Math.PI * v) ** 0.8 * (0.5 - 0.5 * Math.cos(az)) + extra;
      return dirOf(az, el, o).multiplyScalar(r).add(f.c);
    };
    const parts: Part[] = [];
    parts.push({ g: surface(128, 30, true, (u, v, q) => { const az = u * TAU - Math.PI, lo = e0(az); hood(az, lerp(lo, E1 - 1e-4, v), 0, q); }), m: 0 });
    // The rolled edge.
    parts.push({ g: tube((s, o) => { const az = s * TAU - Math.PI; hood(az, e0(az), 0.002, o); }, 0.011, 0.011, { n: 160, around: 10, up: (s, o) => { const az = s * TAU - Math.PI; dirOf(az, e0(az), o); } }), m: 0 });
    // Eyes high on the front, teeth along the brow, spikes over the top and down the back of the head.
    for (const sx of [-1, 1]) {
      const a = sx * 0.4, el = 0.62, p = hood(a, el, -0.002), nn = dirOf(a, el, new THREE.Vector3());
      parts.push({ g: stud(DOME(0.017, 0.011), p, nn), m: 2 });
      const fwd = nn.clone().add(new THREE.Vector3(0, -0.15, 0.35)).normalize();
      parts.push({ g: stud(DOME(0.0075, 0.005), hood(a, el, 0.0085), fwd), m: 3 });
    }
    for (let k = 0; k < 7; k++) {
      const a = lerp(-0.5, 0.5, k / 6), p = hood(a, e0(a), -0.001);
      const tooth = lathe([[0.0058, 0], [0.004, -0.006], [0, -0.0145]], 10);
      tooth.scale(1, 1, 0.5);
      tooth.rotateY(a);
      tooth.translate(p.x, p.y, p.z);
      parts.push({ g: tooth, m: 2 });
    }
    const along = (phi: number): [number, number] => (phi < Math.PI / 2 ? [0, phi] : [Math.PI, Math.PI - phi]);
    for (const [phi, h] of [[0.9, 0.034], [1.22, 0.044], [1.55, 0.05], [1.88, 0.045], [2.2, 0.036]] as const) {
      const [a, el] = along(phi), p = hood(a, el, 0), nn = dirOf(a, el, new THREE.Vector3());
      const [a2, el2] = along(phi + 0.02), tt = hood(a2, el2, 0).sub(p).normalize();
      parts.push({ g: fin(p, nn, tt, h, 0.05, 0.007, 0.28), m: 1 });
    }
    out.push(onBone(asset, 'Head', mergeParts(parts), [fleece, spikeM, white, black]));
  }
  // Spikes down the back to the hem, on the body.
  const back: Part[] = [];
  for (const [k, h] of [[0, 0.046], [1, 0.05], [2, 0.044], [3, 0.036]] as const) {
    const y = lerp(neck.y - 0.08, frame.hemY + 0.08, k / 3);
    const p = fit.back.point(chest.x, y, 0), nn = fit.back.normal(chest.x, y);
    const tt = new THREE.Vector3(0, -1, 0).addScaledVector(nn, nn.y).normalize();
    back.push({ g: fin(p, nn, tt, h, 0.055, 0.0075, 0.3), m: 0 });
  }
  const bg = mergeParts(back);
  bg.clearGroups();
  out.push(onBody(fit, bg, spikeM));
  // The tail, from the small of the back, out and down and up again at its tip.
  const root = fit.back.point(hips.x, hips.y + 0.04, -0.018);
  const P = [root, root.clone().add(new THREE.Vector3(0, -0.05, -0.2)), root.clone().add(new THREE.Vector3(0, -0.25, -0.38)), root.clone().add(new THREE.Vector3(0, -0.2, -0.62))];
  const curve = new THREE.CubicBezierCurve3(P[0]!, P[1]!, P[2]!, P[3]!);
  const size = (s: number): number => 1 - 0.84 * s ** 0.9;
  const tail: Part[] = [{ g: tube((s, o) => { curve.getPoint(s, o); }, 0.15, 0.14, { n: 40, around: 24, caps: true, size }), m: 0 }];
  for (const [s, h] of [[0.16, 0.042], [0.34, 0.036], [0.52, 0.03], [0.7, 0.024], [0.86, 0.017]] as const) {
    const c = curve.getPoint(s), tt = curve.getTangent(s).normalize();
    const nn = new THREE.Vector3(0, 1, 0).addScaledVector(tt, -tt.y).normalize();
    tail.push({ g: fin(c.clone().addScaledVector(nn, 0.07 * size(s) - 0.002), nn, tt, h, 0.05 * (0.6 + 0.4 * size(s)), 0.0065, 0.25), m: 1 });
  }
  out.push(onBone(asset, 'Hips', mergeParts(tail), [fabric('terry', COSTUMES['costume-dino']!.look.shirt), spikeM]));
  return out;
}

/**
 * Chef's whites over the suit (paint.ts printShirt 'chef': the front's edge; the check trousers, printBottom): a pleated
 * toque on a band round the head, a mandarin collar, and the double-breasted front's two rows of buttons.
 */
function chef(fit: Fit): Piece[] {
  const { asset, chest } = fit;
  const out: Piece[] = [];
  const cotton = fabric('twill', 0xf6f5f1, THREE.DoubleSide);
  const f = fitHead(asset);
  if (f) {
    const t = clothTable(f, TOQUE.under), OFF = 0.005, BAND = 0.055, H = 0.2;
    const edge = (az: number): number => edgeY(f, TOQUE.front, TOQUE.back, az);
    const onBand = (az: number, y: number, off: number, o = new THREE.Vector3()): THREE.Vector3 =>
      dirOf(az, elAt(f, t, az, y, off), o).multiplyScalar(radius(t, az, elAt(f, t, az, y, off)) + off).add(f.c);
    const parts: Part[] = [];
    // The band: stiff, round the head over the brow.
    parts.push({ g: surface(96, 16, true, (u, v, q) => {
      const az = u * TAU - Math.PI, th = v * TAU, y = edge(az) + BAND / 2 + (BAND / 2) * sp(Math.cos(th), 6);
      onBand(az, y, OFF + 0.0022 + 0.0022 * sp(Math.sin(th), 3), q);
    }), m: 0 });
    // The crown: up from the band's top, ballooning out in fine pleats, a domed top.
    const b0 = new THREE.Vector3();
    parts.push({ g: surface(144, 26, true, (u, v, q) => {
      const az = u * TAU - Math.PI;
      onBand(az, edge(az) + BAND - 0.004, OFF + 0.004, b0);
      const dx = b0.x - f.c.x, dz = b0.z - f.c.z, rb = Math.hypot(dx, dz);
      const k = v < 0.8 ? 1 + 0.3 * Math.sin((Math.PI / 2) * (v / 0.8)) : (1 + 0.3) * Math.cos(((v - 0.8) / 0.2) * (Math.PI / 2));
      const pleat = 0.006 * Math.abs(Math.sin(az * 14)) ** 0.6 * smooth(0.04, 0.25, v) * (1 - smooth(0.78, 0.95, v));
      const r = rb * k + pleat, y = b0.y + H * (v < 0.8 ? 0.88 * (v / 0.8) ** 0.9 : 0.88 + 0.12 * Math.sin(((v - 0.8) / 0.2) * (Math.PI / 2)));
      q.set(f.c.x + (dx / rb) * r, y, f.c.z + (dz / rb) * r);
    }), m: 0 });
    const g = mergeParts(parts);
    g.clearGroups();
    out.push(onBone(asset, 'Head', g, cotton));
  }
  const band = collar(fit, 0.0, 0.034, 0.0022, 0.22, fabric('twill', 0xf6f5f1, THREE.DoubleSide));
  if (band) out.push(band);
  const buttons: Part[] = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    const x = chest.x + sx * 0.056, y = chest.y + 0.07 - k * 0.065;
    buttons.push({ g: stud(DOME(0.0078, 0.0042), fit.front.point(x, y, 0.0006), fit.front.normal(x, y)), m: 0 });
  }
  const bg = mergeParts(buttons);
  bg.clearGroups();
  out.push(onBody(fit, bg, plastic(0x1b1b1d, 0.4)));
  return out;
}
