// What a player wears beyond the suit, made in code (M5 phase C): caps, a visor, a headband, a bandana, a bucket hat,
// sunglasses and wristbands, each fitted to the person who wears it (their head, hair, eyes and forearms as modelled)
// and hung on a bone, so it moves as the skin under it does. All of it ours, drawn from the body it goes on (the
// cosmetics' ids: data/cosmetics.json).
//
// Fitting: the head is measured as a table of radii from the cranium's centre by direction (azimuth round from the
// front, elevation up), the skin first and then the hair that lies within HAIR_MAX of it (a bun or a ponytail stands
// clear of a cap, as through a real one's back). A piece is built in the bind pose's model space and its mesh's matrix
// is the bone's inverse bind matrix: the bone's world matrix times that is exactly the transform the skin bound to the
// bone gets.
import * as THREE from 'three/webgpu';
import { modelledVertices, wornVertices, type PlayerAsset } from './asset.ts';
import type { KitLook } from './kit.ts';
import { lathe, mergeParts, roundedBox, surface, tube, type Part } from '../geom.ts';
import { fabric, lens, metal, plastic, printed, stitched } from './clothTex.ts';
import { piecesFor, type Paint } from './paint.ts';

/** A worn piece: the mesh, the bone it hangs on, and for a one-sided piece which arm it follows. */
export interface Piece {
  /** The bone it rides on rigidly (its matrix that bone's inverse bind matrix); a skinned piece is on the skeleton. */
  bone: string;
  mesh: THREE.Mesh;
  /** Skinned like the body under it (its own skinIndex/skinWeight, bind pose): it bends where the body bends. */
  skinned?: boolean;
  /** On the racket arm or the free arm (the avatar shows the one on the side the player plays). */
  arm?: 'racket' | 'free';
  /** Which side's arm this copy is on. */
  side?: 'R' | 'L';
}

// ---- the head, measured ------------------------------------------------------------------------------------

const NA = 64;
const NE = 36;
export const E0 = (-55 * Math.PI) / 180;
export const E1 = Math.PI / 2;
/** Hair further than this out from the skin is left outside a cap (m). */
const HAIR_MAX = 0.028;

export interface HeadFit {
  /** The cranium's centre (bind pose, model space). */
  c: THREE.Vector3;
  /** Radii by (azimuth, elevation) bin: the skin's, and the skin's with the hair that lies on it. */
  skin: Float32Array;
  hair: Float32Array;
  /** The hair's table smoothed from above (never under it): what cloth over the head follows. A cap doesn't dip
   * into every parting. */
  shell: Float32Array;
  /** The head's own vertices (xyz), and the hair's, brows' and lashes' on it: what the sunglasses clear. */
  pts: Float32Array;
  hairPts: Float32Array;
  eyeL: THREE.Vector3;
  eyeR: THREE.Vector3;
}

/** Bone weights of a vertex for one bone (0 when the bone isn't among its four). */
export function weightOf(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, v: number, bone: number): number {
  let w = 0;
  for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === bone) w += sw.getComponent(v, k);
  return w;
}

/** Measure a person's head; null for the mannequin. */
export function fitHead(asset: PlayerAsset): HeadFit | null {
  const look = asset.look;
  if (!look) return null;
  const g = asset.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const partB = g.getAttribute('bodyB') as THREE.BufferAttribute | undefined;
  const head = asset.bone('Head');
  // (a modelled headband or visor is not the head: a cap fitted over a visor's brim stood 9 cm off the forehead)
  const baked = bakedHead(asset);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const eyeL = new THREE.Vector3(), eyeR = new THREE.Vector3();
  let nl = 0, nr = 0;
  const pts: number[] = [];
  const v = new THREE.Vector3();
  // (and only what they were modelled in: their wardrobe's other cuts lie over the same body, asset.ts modelledVertices)
  const mine = modelledVertices(asset);
  for (let i = 0; i < pos.count; i++) {
    if (weightOf(si, sw, i, head) < 0.5 || baked?.(i) || !mine[i]) continue;
    v.fromBufferAttribute(pos, i);
    pts.push(v.x, v.y, v.z);
    lo.min(v);
    hi.max(v);
    if (partB && partB.getY(i) > 0.5) {
      if (v.x > 0) { eyeL.add(v); nl++; } else { eyeR.add(v); nr++; }
    }
  }
  if (!pts.length) return null;
  if (nl && nr) {
    eyeL.divideScalar(nl);
    eyeR.divideScalar(nr);
  } else {
    // A fused (Meshy) person: its painted eye, or a typical one from the head's box.
    const e = look.kit.eye ?? [0.032, lo.y + 0.56 * (hi.y - lo.y), hi.z - 0.03];
    eyeL.set(Math.abs(e[0]), e[1], e[2]);
    eyeR.set(-Math.abs(e[0]), e[1], e[2]);
  }
  const eyeY = (eyeL.y + eyeR.y) / 2;
  // The cranium's centre: midway across, a little above the eyes, a little behind the box's middle (the nose is in it).
  const c = new THREE.Vector3((lo.x + hi.x) / 2, eyeY + 0.012, (lo.z + hi.z) / 2 - 0.008);
  const skin = new Float32Array(NA * NE);
  binInto(skin, c, pts, null);
  dilate(skin);
  fill(skin);
  // The hair (and brows and lashes) on the head bone that lie on the skin.
  const hair = skin.slice();
  const hp: number[] = [];
  const ag = look.alphaGeometry;
  const ap = ag.getAttribute('position') as THREE.BufferAttribute | undefined;
  const ai = ag.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const aw = ag.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  if (ap && ai && aw) {
    for (let i = 0; i < ap.count; i++) if (weightOf(ai, aw, i, head) >= 0.3) hp.push(ap.getX(i), ap.getY(i), ap.getZ(i));
    binInto(hair, c, hp, skin);
    dilate(hair);
  }
  return { c, skin, hair, shell: envelope(hair), pts: new Float32Array(pts), hairPts: new Float32Array(hp), eyeL, eyeR };
}

/** A smooth table over `t`: blurred and lifted back to `t` wherever it dips under, a few times over. */
function envelope(t: Float32Array): Float32Array {
  let s = t.slice();
  for (let pass = 0; pass < 8; pass++) {
    const b = new Float32Array(s.length);
    for (let e = 0; e < NE; e++) for (let a = 0; a < NA; a++) {
      let sum = 0, n = 0;
      for (let de = -1; de <= 1; de++) {
        const ee = e + de;
        if (ee < 0 || ee >= NE) continue;
        for (let da = -1; da <= 1; da++) { sum += s[ee * NA + ((a + da + NA) % NA)]!; n++; }
      }
      b[e * NA + a] = Math.max(sum / n, t[e * NA + a]!);
    }
    s = b;
  }
  return s;
}

function binInto(t: Float32Array, c: THREE.Vector3, pts: number[], under: Float32Array | null): void {
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i]! - c.x, dy = pts[i + 1]! - c.y, dz = pts[i + 2]! - c.z;
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-6) continue;
    const el = Math.asin(Math.max(-1, Math.min(1, dy / r)));
    if (el < E0) continue;
    const a = Math.round(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * NA) % NA;
    const e = Math.round(((el - E0) / (E1 - E0)) * (NE - 1));
    const k = e * NA + a;
    if (under && r > under[k]! + HAIR_MAX) continue;
    if (r > t[k]!) t[k] = r;
  }
}

/** Each bin the largest of itself and its eight neighbours (so a point between bins is covered). */
function dilate(t: Float32Array): void {
  const s = t.slice();
  for (let e = 0; e < NE; e++) for (let a = 0; a < NA; a++) {
    let m = 0;
    for (let de = -1; de <= 1; de++) {
      const ee = e + de;
      if (ee < 0 || ee >= NE) continue;
      for (let da = -1; da <= 1; da++) m = Math.max(m, s[ee * NA + ((a + da + NA) % NA)]!);
    }
    t[e * NA + a] = m;
  }
}

/** Empty bins from their filled neighbours. */
function fill(t: Float32Array): void {
  for (let pass = 0; pass < 40; pass++) {
    let empty = 0;
    const s = t.slice();
    for (let e = 0; e < NE; e++) for (let a = 0; a < NA; a++) {
      if (s[e * NA + a]! > 0) continue;
      let sum = 0, n = 0;
      for (let de = -1; de <= 1; de++) {
        const ee = e + de;
        if (ee < 0 || ee >= NE) continue;
        for (let da = -1; da <= 1; da++) {
          const x = s[ee * NA + ((a + da + NA) % NA)]!;
          if (x > 0) { sum += x; n++; }
        }
      }
      if (n) t[e * NA + a] = sum / n;
      else empty++;
    }
    if (!empty) return;
  }
}

/** The table's radius in a direction (bilinear; azimuth wraps, elevation clamps). */
export function radius(t: Float32Array, az: number, el: number): number {
  let fa = ((az + Math.PI) / (2 * Math.PI)) * NA;
  fa = ((fa % NA) + NA) % NA;
  const fe = Math.max(0, Math.min(NE - 1, ((el - E0) / (E1 - E0)) * (NE - 1)));
  const a0 = Math.floor(fa), e0 = Math.min(NE - 2, Math.floor(fe));
  const ta = fa - a0, te = fe - e0, a1 = (a0 + 1) % NA;
  const r = (e: number, a: number): number => t[e * NA + a]!;
  return (r(e0, a0) * (1 - ta) + r(e0, a1) * ta) * (1 - te) + (r(e0 + 1, a0) * (1 - ta) + r(e0 + 1, a1) * ta) * te;
}

export const dirOf = (az: number, el: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

/** The point `off` out from the table's surface in a direction. */
export function onHead(f: HeadFit, t: Float32Array, az: number, el: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
  return dirOf(az, el, out).multiplyScalar(radius(t, az, el) + off).add(f.c);
}

/** The elevation at which the surface (plus `off`) is at height y, at this azimuth. */
export function elAt(f: HeadFit, t: Float32Array, az: number, y: number, off: number): number {
  let el = 0;
  for (let k = 0; k < 6; k++) el = Math.asin(Math.max(-1, Math.min(1, (y - f.c.y) / (radius(t, az, el) + off))));
  return el;
}


// ---- head pieces -------------------------------------------------------------------------------------------

const D = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The signed angle from b to a, in (-pi, pi]. */
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Superellipse coordinate: cos or sin raised to 2 / power, keeping its sign. */
const sp = (x: number, power: number): number => Math.sign(x) * Math.abs(x) ** (2 / power);

/** Where a head piece's lower edge runs: `front` m above the eyes at the front, `back` at the back (cosine between). */
export function edgeY(f: HeadFit, front: number, back: number, az: number): number {
  const eyeY = (f.eyeL.y + f.eyeR.y) / 2;
  return eyeY + lerp(front, back, (1 - Math.cos(az)) / 2);
}

/** Material slots of a head piece's mesh (dress() gives each its material). */
export const SLOT = { crown: 0, top: 1, under: 2, trim: 3, metal: 4, hole: 5 } as const;

/** Azimuths round the head: `per` evenly, plus extra close either side of each seam so its groove has the points. */
function azimuths(seams: number[], per: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < per; k++) out.push(-Math.PI + (k / per) * 2 * Math.PI);
  for (const s of seams) for (const o of [-0.075, -0.045, -0.03, -0.018, -0.008, 0, 0.008, 0.018, 0.03, 0.045, 0.075]) out.push(angDiff(s + o, 0));
  out.sort((a, b) => a - b);
  const kept: number[] = [];
  for (const a of out) if (!kept.length || a - kept[kept.length - 1]! > 0.004) kept.push(a);
  if (kept.length > 1 && kept[0]! + 2 * Math.PI - kept[kept.length - 1]! < 0.004) kept.pop();
  return kept;
}

/** A seam's profile across it (d m from its line): a stitched groove with a welt either side. */
const seamAt = (d: number): number => -0.0011 * Math.exp(-((d / 0.0015) ** 2)) + 0.00045 * Math.exp(-(((Math.abs(d) - 0.0034) / 0.0013) ** 2));

interface CrownOpts {
  front: number; back: number;
  /** Off the cloth table at the edge (m); how far the crown stands over the head's top; how much the panels bulge
   * (the front ones most, a structured cap). */
  off: number; rise: number; bulge: number;
  /** Where the cap faces (0 forwards, pi backwards). */
  facing: number;
  seams: number[];
  /** The back's arch opening over the strap (a baseball cap's), round facing + pi. */
  arch: boolean;
}

/** The back opening: half its width (radians round the head), the strap band's height and the arch's (fractions of
 * the crown from the edge to the top). */
const ARCH_W = 0.27, ARCH_BAND = 0.075, ARCH_H = 0.21;

/** A cap's crown: its own shape over the head (never under the cloth table), panels with sewn seams. */
function crown(f: HeadFit, t: Float32Array, o: CrownOpts): { g: THREE.BufferGeometry; at: (az: number, s: number, out: THREE.Vector3) => THREE.Vector3; apex: THREE.Vector3 } {
  const azs = azimuths(o.seams, 96);
  const NV = 26;
  const apexR = radius(t, 0, E1 - 0.01) + o.off + o.rise;
  const el0 = (az: number): number => elAt(f, t, az, edgeY(f, o.front, o.back, az), o.off);
  const shape = (az: number, s: number): [number, number] => {
    const e0 = el0(az);
    const el = lerp(e0, E1 - 1e-4, s);
    const r0 = radius(t, az, e0) + o.off;
    const fr = Math.max(0, Math.cos(az - o.facing));
    let r = lerp(r0, apexR, s * s * (3 - 2 * s)) + o.bulge * (0.35 + 0.65 * fr) * Math.sin(Math.PI * Math.min(1, s * 1.05)) ** 0.8;
    r = Math.max(r, radius(t, az, el) + 0.004);
    const fade = 1 - s ** 8;
    for (const sz of o.seams) r += seamAt(angDiff(az, sz) * r * Math.cos(el)) * fade;
    return [el, r];
  };
  const at = (az: number, s: number, out: THREE.Vector3): THREE.Vector3 => {
    const [el, r] = shape(az, s);
    return dirOf(az, el, out).multiplyScalar(r).add(f.c);
  };
  const g = surface(azs.length, NV, true, (u, v, q) => { at(azs[Math.round(u * azs.length) % azs.length]!, v, q); });
  if (o.arch) {
    // The opening: over the strap band, an arch either side of the back.
    const back = o.facing + Math.PI, W = ARCH_W, BAND = ARCH_BAND;
    const pos = g.getAttribute('position'), idx = g.index!.array, keep: number[] = [];
    const cols = azs.length;
    for (let k = 0; k < idx.length; k += 3) {
      let da = 0, s = 0;
      for (let m = 0; m < 3; m++) {
        const vtx = idx[k + m]!;
        da += Math.abs(angDiff(azs[vtx % cols]!, back));
        s += Math.floor(vtx / cols) / NV;
      }
      da /= 3; s /= 3;
      const top = BAND + ARCH_H * Math.sqrt(Math.max(0, 1 - (da / W) ** 2));
      if (!(da < W && s > BAND && s < top)) keep.push(idx[k]!, idx[k + 1]!, idx[k + 2]!);
    }
    g.setIndex(keep);
    void pos;
  }
  return { g, at, apex: at(0, 1, new THREE.Vector3()) };
}

/** The tape round a cap's back opening (and along the strap's top). */
function archTape(c: ReturnType<typeof crown>, f: HeadFit, facing: number): THREE.BufferGeometry {
  const back = facing + Math.PI, W = ARCH_W, BAND = ARCH_BAND;
  const out = new THREE.Vector3();
  const path = (t: number, q: THREE.Vector3): void => {
    // Round the arch from one foot to the other, then back along the strap's top.
    if (t < 0.7) {
      const a = (t / 0.7) * 2 - 1;
      const da = a * W * 0.999;
      c.at(back + da, BAND + ARCH_H * Math.sqrt(Math.max(0, 1 - a * a)), q);
    } else {
      const a = ((t - 0.7) / 0.3) * 2 - 1;
      c.at(back - a * W * 0.999, BAND, q);
    }
  };
  return tube(path, 0.007, 0.0028, {
    n: 64, around: 8, power: 3,
    up: (t, u) => { path(t, out); u.subVectors(out, f.c).normalize(); },
  });
}

/** A cap's button on top and its six embroidered eyelets. */
function capDetails(c: ReturnType<typeof crown>, f: HeadFit, facing: number): Part[] {
  const parts: Part[] = [];
  const up = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
  const button = lathe([[0, 0.0055], [0.0042, 0.0051], [0.0068, 0.0034], [0.0077, 0.0012], [0.0072, -0.001], [0.004, -0.0016]], 20);
  button.translate(c.apex.x, c.apex.y - 0.0015, c.apex.z);
  parts.push({ g: button, m: SLOT.crown });
  for (let k = 0; k < 6; k++) {
    const az = facing + (30 + 60 * k) * D;
    c.at(az, 0.7, p);
    up.subVectors(p, f.c).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const ring = lathe([[0.0011, 0.0002], [0.0019, 0.0007], [0.0027, 0.0006], [0.0031, 0.0001]], 14);
    ring.applyQuaternion(q);
    ring.translate(p.x, p.y, p.z);
    parts.push({ g: ring, m: SLOT.trim });
    const hole = lathe([[0, 0.0002], [0.0012, 0.0002]], 10);
    hole.applyQuaternion(q);
    hole.translate(p.x, p.y, p.z);
    parts.push({ g: hole, m: SLOT.hole });
  }
  return parts;
}

/**
 * A bill out of the edge line round `facing`, `span` each way: `length` at its middle (a D in plan), sloping down by
 * `slope`, pre-curved (its sides `curve` m lower at the tip), `thick` m thick with a rounded rim; the top stitched in
 * rows that follow the edge, the underside plain.
 */
function bill(f: HeadFit, t: Float32Array, front: number, back: number, off: number, facing: number, span: number, length: number, slope: number, curve: number, thick: number): Part[] {
  const root = new THREE.Vector3(), radial = new THREE.Vector3();
  const L = (s: number): number => length * Math.max(0.02, 1 - Math.abs(s) ** 2.4) ** 0.62;
  /** The bill's middle sheet at (s across in [-1, 1], w out in [0, 1]). */
  const mid = (s: number, w: number, out: THREE.Vector3): THREE.Vector3 => {
    const az = facing + s * span;
    const y = edgeY(f, front, back, az);
    onHead(f, t, az, elAt(f, t, az, y, off - 0.002), off - 0.002, root);
    radial.set(Math.sin(az), 0, Math.cos(az));
    const l = w * L(s);
    out.copy(root).addScaledVector(radial, l * Math.cos(slope));
    out.y -= l * Math.sin(slope) + curve * s * s * (l / length) ** 1.2;
    return out;
  };
  const NU = 40, NW = 14;
  const across = (u: number): number => u * 2 - 1;
  const topUV = (u: number, v: number): [number, number] => [across(u) * span * 0.1, (1 - v) * L(across(u))];
  const top = surface(NU, NW, false, (u, v, q) => { mid(across(u), v, q).y += thick / 2; }, topUV);
  const under = surface(NU, NW, false, (u, v, q) => { mid(across(u), 1 - v, q).y -= thick / 2; });
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const rim = surface(NU, 6, false, (u, v, q) => {
    const s = across(u);
    mid(s, 1, a);
    mid(s, 0.97, b);
    const out = a.clone().sub(b).setY(0).normalize();
    const ph = v * Math.PI;
    q.copy(a).addScaledVector(out, Math.sin(ph) * thick / 2);
    q.y += Math.cos(ph) * thick / 2;
  });
  return [{ g: top, m: SLOT.top }, { g: rim, m: SLOT.top }, { g: under, m: SLOT.under }];
}

/**
 * A band round the head (a headband, a visor's crown band): lower edge on the edge line, `height(az)` tall, `thick`
 * m thick, with rounded rolled edges (a superellipse cross-section), lying on the cloth table.
 */
function band(f: HeadFit, t: Float32Array, front: number, back: number, height: (az: number) => number, thick: number): THREE.BufferGeometry {
  return surface(NA * 2, 20, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    const th = v * 2 * Math.PI;
    const h = height(az);
    const y = edgeY(f, front, back, az) + h / 2 + (h / 2) * sp(Math.cos(th), 5);
    const off = 0.0012 + thick / 2 + (thick / 2) * sp(Math.sin(th), 3);
    onHead(f, t, az, elAt(f, t, az, y, off), off, q);
  });
}

function capPieces(f: HeadFit, t: Float32Array, backwards: boolean): Part[] {
  const { front, back } = HEADWEAR['head-cap']!;
  const facing = backwards ? Math.PI : 0;
  const off = 0.005;
  const c = crown(f, t, { front, back, off, rise: 0.014, bulge: 0.011, facing, seams: [0, 60, 120, 180, 240, 300].map((a) => facing + a * D), arch: true });
  const parts: Part[] = [{ g: c.g, m: SLOT.crown }, { g: archTape(c, f, facing), m: SLOT.crown }, ...capDetails(c, f, facing)];
  // Worn backwards the bill's root is the cap's band at the back of the head.
  parts.push(...bill(f, t, front, back, off, facing, 64 * D, 0.074, (backwards ? -4 : 9) * D, 0.016, 0.0036));
  // The strap's buckle at the back of the band.
  const buckle = roundedBox(0.018, 0.011, 0.004, 0.0015, { seg: 4 });
  const p = c.at(facing + Math.PI, 0.03, new THREE.Vector3());
  buckle.translate(0, -0.0055, 0);
  buckle.rotateY(facing + Math.PI);
  buckle.translate(p.x, p.y, p.z);
  parts.push({ g: buckle, m: SLOT.metal });
  return parts;
}

function visorPieces(f: HeadFit, t: Float32Array): Part[] {
  const hw = HEADWEAR['head-visor']!;
  const parts: Part[] = [{ g: band(f, t, hw.front, hw.back, (az) => upAt(hw, az), 0.0045), m: SLOT.crown }];
  parts.push(...bill(f, t, hw.front, hw.back, 0.0045, 0, 74 * D, 0.07, 12 * D, 0.012, 0.0034));
  return parts;
}

function bucketPieces(f: HeadFit, t: Float32Array): Part[] {
  const { front, back } = HEADWEAR['head-bucket']!;
  const off = 0.009;
  const top = f.c.y + radius(t, 0, E1 - 0.01) + 0.014;
  const E = new THREE.Vector3(), probe = new THREE.Vector3();
  const edge = (az: number, out: THREE.Vector3): THREE.Vector3 => onHead(f, t, az, elAt(f, t, az, edgeY(f, front, back, az), off), off, out);
  /** The crown's profile: (k, y) = horizontal scale of the edge's offset from the axis, and height. */
  const profile = (az: number, s: number, out: THREE.Vector3): THREE.Vector3 => {
    edge(az, E);
    const ex = E.x - f.c.x, ez = E.z - f.c.z;
    let k: number, y: number;
    if (s < 0.62) { const a = s / 0.62; k = lerp(1.0, 0.9, a); y = lerp(E.y, top - 0.012, a); }
    else if (s < 0.78) { const a = ((s - 0.62) / 0.16) * Math.PI / 2; k = 0.9 - 0.035 * (1 - Math.cos(a)); y = top - 0.012 + 0.012 * Math.sin(a); }
    else { const a = (s - 0.78) / 0.22; k = 0.865 * (1 - a); y = top + 0.003 * (1 - a * a); }
    out.set(f.c.x + ex * k, y, f.c.z + ez * k);
    // Never into the head or its hair.
    for (let it = 0; it < 6; it++) {
      probe.subVectors(out, f.c);
      const r = probe.length(), az2 = Math.atan2(probe.x, probe.z), el2 = Math.asin(probe.y / r);
      const need = radius(t, az2, el2) + 0.005;
      if (r >= need) break;
      out.addScaledVector(probe.normalize(), need - r);
    }
    return out;
  };
  const crownG = surface(NA * 2, 28, true, (u, v, q) => { profile(u * 2 * Math.PI - Math.PI, v, q); });
  // The top's seam ring: a welt round where the side meets the top.
  const ring = tube((tt, q) => { profile(tt * 2 * Math.PI - Math.PI, 0.7, q); }, 0.003, 0.003, { n: 96, around: 8 });
  // The brim: out and down from the crown's foot, stitched in rows round it, a little wavy as soft cotton is.
  const thick = 0.003, W = 0.054, drop = 28 * D;
  const brimAt = (az: number, w: number, side: number, out: THREE.Vector3): THREE.Vector3 => {
    edge(az, out);
    const hx = out.x - f.c.x, hz = out.z - f.c.z, hl = Math.hypot(hx, hz);
    const wave = 0.004 * Math.sin(3 * az + 1.1) * w;
    out.x += (hx / hl) * w * W * Math.cos(drop);
    out.z += (hz / hl) * w * W * Math.cos(drop);
    out.y += -w * W * Math.sin(drop) + wave + side * thick / 2;
    return out;
  };
  const brimTop = surface(NA * 2, 10, true, (u, v, q) => { brimAt(u * 2 * Math.PI - Math.PI, v, 1, q); }, (u, v) => [u * 0.6, (1 - v) * W]);
  const brimUnder = surface(NA * 2, 10, true, (u, v, q) => { brimAt(u * 2 * Math.PI - Math.PI, 1 - v, -1, q); });
  const a = new THREE.Vector3();
  const rim = surface(NA * 2, 6, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    brimAt(az, 1, 0, a);
    const ph = v * Math.PI;
    q.copy(a);
    q.x += Math.sin(az) * Math.sin(ph) * thick / 2;
    q.z += Math.cos(az) * Math.sin(ph) * thick / 2;
    q.y += Math.cos(ph) * thick / 2;
  });
  return [{ g: crownG, m: SLOT.crown }, { g: ring, m: SLOT.crown }, { g: brimTop, m: SLOT.top }, { g: rim, m: SLOT.top }, { g: brimUnder, m: SLOT.under }];
}

function bandanaPieces(f: HeadFit, t: Float32Array): Part[] {
  const { front, back } = HEADWEAR['head-bandana']!;
  const off = 0.0032;
  const g = surface(NA * 2, 22, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    const el = lerp(elAt(f, t, az, edgeY(f, front, back, az), off), E1 - 1e-4, v);
    // A few soft creases where the cloth gathers towards the knot.
    const crease = 0.0012 * Math.max(0, -Math.cos(az)) * Math.sin(az * 9) * (1 - v);
    onHead(f, t, az, el, off + crease, q);
  });
  // The rolled hem.
  const hem = tube((tt, q) => { const az = tt * 2 * Math.PI - Math.PI; onHead(f, t, az, elAt(f, t, az, edgeY(f, front, back, az), off + 0.0012), off + 0.0012, q); }, 0.0045, 0.003, { n: 128, around: 8 });
  // The knot at the back, and its two tails hanging and fluttering a little.
  const k = onHead(f, t, Math.PI, elAt(f, t, Math.PI, edgeY(f, front, back, Math.PI) + 0.006, off), off + 0.008);
  const knot = roundedBox(0.03, 0.022, 0.018, 0.008, { seg: 6, pillow: 0.002 });
  knot.translate(k.x, k.y - 0.011, k.z);
  const tails = [-1, 1].map((s) => surface(8, 14, false, (u, v, q) => {
    const w = lerp(0.03, 0.016, v);
    const len = 0.085;
    q.set(k.x + s * (0.008 + v * 0.022) + (u - 0.5) * w * Math.cos(v * 0.6),
      k.y - 0.01 - v * len,
      k.z - 0.008 - v * 0.016 - Math.sin(u * Math.PI) * 0.003 + 0.004 * Math.sin(v * 7 + s) * v);
  }));
  return [{ g, m: SLOT.crown }, { g: hem, m: SLOT.crown }, { g: knot, m: SLOT.crown }, ...tails.map((tg) => ({ g: tg, m: SLOT.crown }))];
}

function headbandPieces(f: HeadFit, t: Float32Array): Part[] {
  const hw = HEADWEAR['head-band']!;
  return [{ g: band(f, t, hw.front, hw.back, (az) => upAt(hw, az), 0.0065), m: SLOT.crown }];
}

// ---- sunglasses --------------------------------------------------------------------------------------------

/**
 * Sunglasses. The lenses are on an upright cylinder of their own (a sport lens's tight curve, a shield's looser one),
 * its axis behind the eyes, its radius whatever clears the eyes, lashes and brows by CLEAR: measured from the head's
 * vertices in front of the eyes, the nose left out (the pads rest on it). Frames are rounded sections (tubes), the
 * temples taper from the hinge and end in a rubber tip curving down behind the ear.
 */
const CLEAR = 0.007;
/** The frame mesh's material slots. */
export const GLASS = { frame: 0, rubber: 1, metal: 2, pad: 3 } as const;
function glasses(f: HeadFit, style: 'wrap' | 'round' | 'shield'): { lens: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  const eyeY = (f.eyeL.y + f.eyeR.y) / 2, eyeZ = (f.eyeL.z + f.eyeR.z) / 2, eyeX = (f.eyeL.x - f.eyeR.x) / 2;
  const shield = style === 'shield';
  const CURVE = shield ? 0.095 : style === 'wrap' ? 0.07 : 0.11;
  const ax = 0, az0 = eyeZ - CURVE;
  const NOSE_X = 0.3 * eyeX + 0.004;
  let r = 0;
  const clearOf = (src: Float32Array): void => {
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
      if (Math.abs(y - eyeY) > 0.02 || z < eyeZ - 0.03 || Math.abs(x) < NOSE_X || Math.abs(x) > eyeX + 0.04) continue;
      r = Math.max(r, Math.hypot(x - ax, z - az0) + CLEAR);
    }
  };
  clearOf(f.pts);
  clearOf(f.hairPts);
  const azOf = (x: number, z: number): number => Math.atan2(x - ax, z - az0);
  const eAz = azOf(eyeX, eyeZ);
  const noseAz = Math.asin(Math.min(0.9, NOSE_X / r));
  /** The nose's front at a height near its middle; and its side's x at a height and depth. */
  const noseZ = (y: number): number => {
    let z = -Infinity;
    for (let i = 0; i < f.pts.length; i += 3) if (Math.abs(f.pts[i]!) < NOSE_X && Math.abs(f.pts[i + 1]! - y) < 0.004) z = Math.max(z, f.pts[i + 2]!);
    return z;
  };
  const at = (a: number, y: number, rr: number, q: THREE.Vector3): THREE.Vector3 => q.set(ax + Math.sin(a) * rr, y, az0 + Math.cos(a) * rr);
  const lensParts: Part[] = [];
  const frame: Part[] = [];
  const UP = new THREE.Vector3(0, 1, 0);
  // The temples: from the hinge back along the side of the head just above the eyes' line, over the ear, and down
  // behind it in a rubber tip.
  const temple = (s: number, start: THREE.Vector3, y0: number): void => {
    const c0 = Math.atan2(start.x - f.c.x, start.z - f.c.z);
    const side = new THREE.Vector3();
    const arm = (tt: number, q: THREE.Vector3): void => {
      const ca = lerp(c0, s * 112 * D, tt);
      const y = lerp(y0, eyeY + 0.009, Math.min(1, tt * 2));
      onHead(f, f.hair, ca, elAt(f, f.hair, ca, y, 0.0045), 0.0045, side);
      q.lerpVectors(start, side, Math.min(1, tt * 3));
      q.y = y;
    };
    const end = new THREE.Vector3();
    arm(1, end);
    const tip = (tt: number, q: THREE.Vector3): void => {
      // Over the ear's top, then down and in behind it.
      const ca = s * (112 + 16 * tt) * D;
      onHead(f, f.hair, ca, elAt(f, f.hair, ca, end.y - 0.028 * tt ** 1.6, 0.0035), 0.0035, q);
      q.y = end.y - 0.028 * tt ** 1.6;
    };
    frame.push({ g: tube(arm, 0.0026, 0.0062, { n: 28, around: 10, power: 3, up: UP, size: (tt) => lerp(1, 0.72, tt) }), m: GLASS.frame });
    frame.push({ g: tube(tip, 0.0034, 0.0048, { n: 14, around: 10, power: 2.4, up: UP, caps: true }), m: GLASS.rubber });
    // The hinge.
    const h = roundedBox(0.006, 0.0075, 0.009, 0.0015, { seg: 4 });
    h.translate(start.x - s * 0.001, start.y - 0.0037, start.z - 0.003);
    frame.push({ g: h, m: GLASS.metal });
  };
  /** Nose pads: small clear soft pads either side of the nose, under the bridge. */
  const pads = (y: number): void => {
    const nz = noseZ(y);
    if (!Number.isFinite(nz)) return;
    for (const s of [1, -1]) {
      const g = lathe([[0, 0.0016], [0.0035, 0.0012], [0.0045, 0], [0.0035, -0.0012], [0, -0.0016]], 12);
      g.scale(1, 1.6, 1);
      g.rotateZ(s * 0.5);
      g.translate(s * (NOSE_X * 0.85), y, nz - 0.006);
      frame.push({ g, m: GLASS.pad });
    }
  };
  if (style === 'round') {
    const R = 0.0205;
    for (const s of [1, -1]) {
      const c = s * Math.max(eAz, noseAz + R / r);
      const circle = (tt: number, q: THREE.Vector3): void => { const th = tt * 2 * Math.PI; at(c + (Math.cos(th) * R) / r, eyeY + 0.002 + Math.sin(th) * R, r, q); };
      lensParts.push({ g: surface(32, 6, true, (u, v, q) => { const th = u * 2 * Math.PI; at(c + (Math.cos(th) * R * v) / r, eyeY + 0.002 + Math.sin(th) * R * v, r - 0.0004 * (1 - v * v), q); }), m: 0 });
      // The rim: a round wire, set round the lens.
      const cen = new THREE.Vector3();
      at(c, eyeY + 0.002, r, cen);
      frame.push({ g: tube(circle, 0.0026, 0.0026, { n: 48, around: 8, up: (_tt, u) => u.subVectors(cen, new THREE.Vector3(ax, cen.y, az0)).normalize() }), m: GLASS.frame });
      const start = new THREE.Vector3();
      circle(s > 0 ? 0 : 0.5, start);
      temple(s, start, eyeY + 0.006);
    }
    // The bridge: a keyhole arc over the nose.
    frame.push({ g: tube((tt, q) => { const a = lerp(-noseAz - 0.5 * D, noseAz + 0.5 * D, tt); at(a, eyeY + 0.009 + Math.sin(tt * Math.PI) * 0.004, r + 0.0005, q); }, 0.0022, 0.0022, { n: 16, around: 8 }), m: GLASS.frame });
    pads(eyeY - 0.004);
  } else {
    const aOut = eAz + (shield ? 28 : 26) * D;
    const runs: Array<[number, number]> = shield ? [[-aOut, aOut]] : [[noseAz, aOut], [-aOut, -noseAz]];
    let rs = r;
    if (shield) { const nz = noseZ(eyeY + 0.008); if (Number.isFinite(nz)) rs = Math.max(r, nz + 0.004 - az0); }
    const top = (a: number): number => eyeY + (shield ? 0.019 : 0.016) - 0.005 * Math.max(0, (Math.abs(a) - eAz) / (aOut - eAz)) ** 2;
    const bottom = (a: number): number => {
      if (shield) return eyeY - 0.021 + 0.018 * Math.max(0, 1 - Math.abs(a) / (noseAz * 1.6)) ** 0.7 + 0.01 * (Math.abs(a) / aOut) ** 4;
      const k = (Math.abs(a) - noseAz) / (aOut - noseAz);
      return eyeY - 0.005 - 0.014 * Math.sqrt(Math.max(0, 4 * k * (1 - k))) * (k < 0.5 ? 1 : 1 - 0.4 * (2 * k - 1));
    };
    for (const [a0, a1] of runs) {
      lensParts.push({ g: surface(64, 10, false, (u, v, q) => { const a = lerp(a0, a1, u); at(a, lerp(bottom(a), top(a), v), rs, q); }), m: 0 });
      // The lens's own edge along the bottom (it has a thickness), and the frame's brow bar along the top.
      lensParts.push({ g: tube((tt, q) => { const a = lerp(a0, a1, tt); at(a, bottom(a), rs - 0.0006, q); }, 0.0018, 0.0016, { n: 32, around: 6 }), m: 0 });
      frame.push({ g: tube((tt, q) => { const a = lerp(a0, a1, tt); at(a, top(a) + 0.0008, rs + 0.0012, q); }, 0.0034, 0.0056, { n: 40, around: 12, power: 3.2, up: UP, caps: true }), m: GLASS.frame });
    }
    if (!shield) frame.push({ g: tube((tt, q) => { const a = lerp(-noseAz - 2 * D, noseAz + 2 * D, tt); at(a, top(noseAz) + 0.0008 - Math.sin(tt * Math.PI) * 0.002, rs + 0.0012, q); }, 0.0034, 0.0056, { n: 16, around: 12, power: 3.2, up: UP }), m: GLASS.frame });
    for (const s of [1, -1]) {
      const start = new THREE.Vector3();
      at(s * aOut, top(aOut) - 0.002, rs + 0.0012, start);
      temple(s, start, top(aOut) - 0.002);
    }
    pads(eyeY - 0.006);
  }
  const lensG = mergeParts(lensParts);
  lensG.clearGroups();
  return { lens: lensG, frame: mergeParts(frame) };
}

// ---- wristbands --------------------------------------------------------------------------------------------

/**
 * A terry band round a forearm, from `from` to `to` m up it from the wrist joint, its edges rolled. Elastic: it hugs
 * the arm ring by ring as the forearm widens towards the elbow (one size for its whole length stood a centimetre off
 * the wrist), bridging only what an arm's hollows are between its bones.
 */
function wristband(asset: PlayerAsset, side: 'R' | 'L', from: number, to: number, mine = modelledVertices(asset)): THREE.BufferGeometry | null {
  const fore = asset.bone(side === 'R' ? 'RightForeArm' : 'LeftForeArm');
  const hand = asset.bone(side === 'R' ? 'RightHand' : 'LeftHand');
  if (fore < 0 || hand < 0) return null;
  const A = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[fore]!.clone().invert());
  const B = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[hand]!.clone().invert());
  const axis = A.clone().sub(B);
  const len = axis.length();
  axis.normalize();
  const u = new THREE.Vector3(0, 1, 0).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(axis);
  u.normalize();
  const w = axis.clone().cross(u).normalize();
  // The arm's radius by angle (N) in rings along the band (NR), each ring the furthest-out vertex in it.
  const N = 32, NR = 8, end = Math.min(to, len), step = (end - from) / NR;
  const R = new Float32Array(NR * N);
  const g = asset.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const near: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (weightOf(si, sw, i, fore) + weightOf(si, sw, i, hand) < 0.5 || !mine[i]) continue;
    p.fromBufferAttribute(pos, i).sub(B);
    const along = p.dot(axis);
    if (along < from - 0.02 || along > end + 0.02) continue;
    const x = p.dot(u), y = p.dot(w), r = Math.hypot(x, y);
    if (r > 0.08) continue;
    near.push(i);
    if (along < from - 0.01 || along > end + 0.01) continue;
    const j = Math.max(0, Math.min(NR - 1, Math.floor((along - from) / step)));
    const k = Math.round(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * N) % N;
    R[j * N + k] = Math.max(R[j * N + k]!, r);
  }
  let mean = 0, n = 0;
  for (let k = 0; k < R.length; k++) if (R[k]! > 0) { mean += R[k]!; n++; }
  if (!n) return null;
  mean /= n;
  // Each ring's empty angles from its own mean; then the furthest out within a bin either side and a ring either side
  // (the cloth is stretched straight over a hollow, and a ring holds its neighbours' bumps).
  for (let j = 0; j < NR; j++) {
    let m = 0, c = 0;
    for (let k = 0; k < N; k++) if (R[j * N + k]! > 0) { m += R[j * N + k]!; c++; }
    for (let k = 0; k < N; k++) if (!(R[j * N + k]! > 0)) R[j * N + k] = c ? m / c : mean;
  }
  const S = new Float32Array(NR * N);
  for (let j = 0; j < NR; j++) for (let k = 0; k < N; k++) {
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= NR) continue;
      for (let d = -1; d <= 1; d++) m = Math.max(m, R[jj * N + ((k + d + N) % N)]!);
    }
    S[j * N + k] = m;
  }
  const thick = 0.0055, mid = (from + end) / 2, half = (end - from) / 2;
  const radAt = (t: number, al: number): number => {
    const fk = ((t + Math.PI) / (2 * Math.PI)) * N, k0 = Math.floor(fk) % N, k1 = (k0 + 1) % N, tk = fk - Math.floor(fk);
    const fj = Math.max(0, Math.min(NR - 1, (al - from) / step - 0.5)), j0 = Math.floor(fj), j1 = Math.min(NR - 1, j0 + 1), tj = fj - j0;
    const ring = (j: number): number => S[j * N + k0]! * (1 - tk) + S[j * N + k1]! * tk;
    return ring(j0) * (1 - tj) + ring(j1) * tj;
  };
  const band = surface(64, 2 * 16 + 2 * 8, true, (uu, vv, q) => {
    const t = uu * 2 * Math.PI - Math.PI;
    const [a, d] = rolledSection(vv, half, thick / 2, 16, 8);
    const al = mid + a;
    const rr = radAt(t, al) + 0.001 + thick / 2 + d;
    q.copy(B).addScaledVector(axis, al).addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr);
  });
  skinLike(band, asset, near);
  return band;
}

/**
 * Skin a piece like the body under it: each vertex the weights of the four nearest of `near` (body vertices, bind
 * pose), blended by inverse square distance, its four strongest bones kept. A wristband rigid on the forearm let the
 * wrist's skin, which turns with the hand, show a gap on one side and come through on the other.
 */
export function skinLike(g: THREE.BufferGeometry, asset: PlayerAsset, near: number[]): void {
  const src = asset.geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const si = src.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = src.getAttribute('skinWeight') as THREE.BufferAttribute;
  const gp = g.getAttribute('position') as THREE.BufferAttribute;
  const n = gp.count, idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  const bd = [0, 0, 0, 0], bi = [0, 0, 0, 0];
  const acc = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const x = gp.getX(v), y = gp.getY(v), z = gp.getZ(v);
    bd.fill(Infinity);
    bi.fill(-1);
    for (const i of near) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d >= bd[3]!) continue;
      let k = 3;
      while (k > 0 && bd[k - 1]! > d) { bd[k] = bd[k - 1]!; bi[k] = bi[k - 1]!; k--; }
      bd[k] = d;
      bi[k] = i;
    }
    acc.clear();
    for (let k = 0; k < 4; k++) {
      const i = bi[k]!;
      if (i < 0) continue;
      const f = 1 / (bd[k]! + 1e-8);
      for (let c = 0; c < 4; c++) {
        const wc = sw.getComponent(i, c);
        if (wc > 0) acc.set(si.getComponent(i, c), (acc.get(si.getComponent(i, c)) ?? 0) + f * wc);
      }
    }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((t, [, x]) => t + x, 0) || 1;
    top.forEach(([b, x], c) => { idx[v * 4 + c] = b; wt[v * 4 + c] = x / sum; });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
}

/**
 * A band's cross-section with rolled edges, as [along, out] from its middle (out < 0 is its inside) at row v of the
 * 2S + 2C rows round it: S rows evenly along each flat side (the inside follows the arm the whole way), C round each
 * edge.
 */
function rolledSection(v: number, half: number, r: number, S: number, C: number): [number, number] {
  const NV = 2 * S + 2 * C, j = Math.round(v * NV) % NV, h = half - r;
  if (j < S) return [lerp(-h, h, j / S), -r];
  if (j < S + C) { const a = -Math.PI / 2 + (Math.PI * (j - S)) / C; return [h + r * Math.cos(a), r * Math.sin(a)]; }
  if (j < 2 * S + C) return [lerp(h, -h, (j - S - C) / S), r];
  const a = Math.PI / 2 + (Math.PI * (j - 2 * S - C)) / C;
  return [-h + r * Math.cos(a), r * Math.sin(a)];
}

// ---- dressing ----------------------------------------------------------------------------------------------


/** What a player wears that is drawn here, by cosmetic id (data/cosmetics.json): head, sunglasses, wristbands. A slot
 * left out keeps what the person was modelled with (a headband or a visor); null takes it off. */
export interface Wear {
  head?: string | null;
  eyes?: string | null;
  wrist?: string | null;
  /** On the courtside bench, not on the player (game.ts placeBags). */
  bag?: string;
  /** A novelty costume (costumes.ts): its suit, colours and pieces over everything it covers. */
  costume?: string;
  /** What the suit is painted as (paint.ts; the Avatar's material is built with it) and the overgrip's colour (CSS hex). */
  paint?: Paint;
  grip?: string;
}

/**
 * Each head piece: where its cloth meets the head (its lower edge's height over the eyes at the front and at the back),
 * how far up it reaches (null: over the crown; `upBack` at the back, if it narrows), and how much hair it leaves under it (m): the cloth is that far off the
 * scalp at most, and the hair under it is pressed in to fit (pressHair).
 */
export interface Headwear {
  front: number; back: number; up: number | null; upBack?: number; under: number;
  /** The lower edge's height by azimuth, when it isn't front to back by a cosine (a hood's, round the face: costumes.ts). */
  edge?: (f: HeadFit, az: number) => number;
}
export const HEADWEAR: Record<string, Headwear> = {
  'head-band': { front: 0.026, back: -0.006, up: 0.036, under: 0.004 },
  'head-visor': { front: 0.024, back: -0.008, up: 0.046, upBack: 0.024, under: 0.004 },
  'head-cap': { front: 0.03, back: -0.008, up: null, under: 0.007 },
  'head-capback': { front: 0.03, back: -0.008, up: null, under: 0.007 },
  'head-bandana': { front: 0.034, back: -0.04, up: null, under: 0.003 },
  'head-bucket': { front: 0.038, back: 0.004, up: null, under: 0.009 },
};

/** The head piece ids drawn here (the cosmetics' `head` slot). */
export const HEAD_PIECES = Object.keys(HEADWEAR);

/** How far up a band reaches at this azimuth. */
function upAt(hw: Headwear, az: number): number {
  return hw.up === null ? 0 : lerp(hw.up, hw.upBack ?? hw.up, (1 - Math.cos(az)) / 2);
}

/** The table cloth follows: the scalp plus at most `under` of hair, smoothed from above. */
export function clothTable(f: HeadFit, under: number): Float32Array {
  const t = new Float32Array(f.hair.length);
  for (let k = 0; k < t.length; k++) t[k] = Math.min(f.hair[k]!, f.skin[k]! + under);
  return envelope(t);
}


/** Hair under a head piece (pressHair): its positions, and its triangles when some are no longer drawn (null: as they are). */
export interface PressedHair { position: Float32Array; index: THREE.BufferAttribute | null }

/** A corner of hair this far off where the cloth would hold it (m) stands free: its card comes out from under the cloth. */
const HAIR_STANDS = 0.003;
/** A slid root's place past the cloth's edge (m), and how far into the cloth hair may be before it is through it (m). */
const SLID_PAST = 0.002, THROUGH = 0.0035;
/** A corner on the scalp the far side of the cloth is slid across it from no further than this past its edge (m). */
const SLIDE_FROM = 0.025;
/** Pressed hair is never nearer the scalp than this (m). It was 4 mm, as far out as a visor's strap is thick where the
 * table is the scalp itself. */
const HAIR_OFF = 0.003;

/**
 * The hair (its alpha mesh's, bind pose) under a head piece: what the cloth covers pressed in under it (2 mm inside it),
 * easing out over a centimetre past the cloth's edges so the hair that shows bulges as hair does; null when nothing moves.
 * Brows and lashes lie on the skin and never move.
 *
 * And no triangle of it passes out through the cloth. Pressed corner by corner, a card rooted under a band with its tip
 * free rose through the band (an afro's cards are 8-13 cm long: p8's band showed across her forehead and nowhere else,
 * 13 Nov 2026). So a corner under the cloth whose triangle has a corner standing free past an edge is slid, on the scalp,
 * to just past that edge: the card comes out from under the band there, as hair held by a band does. What still passes
 * through after that (a card with a free corner either side of a band, lying across it) is not drawn.
 */
export function pressHair(asset: PlayerAsset, id: string | Headwear): PressedHair | null {
  const hw = typeof id === 'string' ? HEADWEAR[id] : id;
  const f = fitHead(asset);
  const ag = asset.look?.alphaGeometry;
  if (!hw || !f || !ag) return null;
  const t = clothTable(f, hw.under);
  const pos = ag.getAttribute('position') as THREE.BufferAttribute | undefined;
  const si = ag.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const sw = ag.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  if (!pos || !si || !sw) return null;
  const head = asset.bone('Head');
  const n = pos.count;
  const out = new Float32Array(n * 3);
  // Per vertex: where it is by the cloth (under it 0, below its lower edge -1, above its upper one 1), whether it stands
  // free there once pressed, and which edge it is slid to (0: none).
  const side = new Int8Array(n), free = new Uint8Array(n), slide = new Int8Array(n), mine = new Uint8Array(n), past = new Float32Array(n);
  const edges = clothEdges(f, hw);
  // (never closer to the scalp than HAIR_OFF: what lies on it, the brows and lashes among it, stays)
  const held = (az: number, el: number): number => Math.max(radius(t, az, el) - 0.002, radius(f.skin, az, el) + HAIR_OFF);
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    const dx = x - f.c.x, dy = y - f.c.y, dz = z - f.c.z, r = Math.hypot(dx, dy, dz);
    if (r < 1e-6) continue;
    const az = Math.atan2(dx, dz), el = Math.asin(Math.max(-1, Math.min(1, dy / r)));
    const [lo, hi] = edges(az);
    // (by where on the head it is, the height of the cloth's table under it: by its own height, hair below the head's
    // middle rose into the cloth's span as it was pressed in, half pressed, and stood through the cloth's lower edge)
    const on = tableY(f, t, az, el);
    side[i] = on < lo ? -1 : on > hi ? 1 : 0;
    past[i] = on < lo ? lo - on : on > hi ? on - hi : 0;
    // (hair on another bone, a ponytail's length, is never pressed: it stands free wherever it is)
    if (weightOf(si, sw, i, head) < 0.3) { free[i] = side[i] !== 0 ? 1 : 0; continue; }
    mine[i] = 1;
    const R = held(az, el);
    if (r <= R) continue;
    let k = smooth(lo - 0.012, lo, on);
    if (hw.up !== null) k *= 1 - smooth(hi, hi + 0.012, on);
    free[i] = side[i] !== 0 && (1 - k) * (r - R) > HAIR_STANDS ? 1 : 0;
    if (k <= 0) continue;
    const s = (r - k * (r - R)) / r;
    out[i * 3] = f.c.x + dx * s; out[i * 3 + 1] = f.c.y + dy * s; out[i * 3 + 2] = f.c.z + dz * s;
    moved++;
  }
  const index = ag.index;
  if (!index) return moved ? { position: out, index: null } : null;
  // A card that comes out past one edge has its other corners, the ones held under the cloth or on the scalp the other
  // side of it (within SLIDE_FROM of that edge), slid to that edge: the first card that asks, when two share a corner.
  // One with free corners past both edges lies across the cloth whatever is done, and is not drawn (below).
  for (let q = 0; q < index.count; q += 3) {
    const a = index.getX(q), b = index.getX(q + 1), c = index.getX(q + 2);
    const below = (free[a]! && side[a]! < 0) || (free[b]! && side[b]! < 0) || (free[c]! && side[c]! < 0);
    const above = (free[a]! && side[a]! > 0) || (free[b]! && side[b]! > 0) || (free[c]! && side[c]! > 0);
    if (below === above) continue;
    const to = below ? -1 : 1;
    for (const i of [a, b, c]) if (mine[i] && !free[i] && !slide[i] && side[i] !== to && past[i]! <= SLIDE_FROM) slide[i] = to;
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!slide[i]) continue;
    const az = Math.atan2(out[i * 3]! - f.c.x, out[i * 3 + 2]! - f.c.z);
    const [lo, hi] = edges(az);
    const y = slide[i]! < 0 ? lo - SLID_PAST : hi + SLID_PAST;
    const el = elAt(f, t, az, y, -0.002);
    dirOf(az, el, v).multiplyScalar(held(az, el)).add(f.c);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    side[i] = slide[i]!;
    moved++;
  }
  // What still passes through the cloth is not drawn: its three corners made one (the count of triangles, and any
  // groups over them, stay as they are).
  let cut: Uint16Array | Uint32Array | null = null;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let q = 0; q < index.count; q += 3) {
    const a = index.getX(q), b = index.getX(q + 1), c = index.getX(q + 2);
    // (one wholly past an edge can't; one wholly under the cloth only if it is long, a chord over a hollow, or not the head's)
    if (side[a] === side[b] && side[b] === side[c]) {
      if (side[a] !== 0) continue;
      if (mine[a] && mine[b] && mine[c] && A.fromArray(out, a * 3).distanceToSquared(B.fromArray(out, b * 3)) < 4e-4
        && B.distanceToSquared(C.fromArray(out, c * 3)) < 4e-4 && C.distanceToSquared(A) < 4e-4) continue;
    }
    if (!throughCloth(f, t, edges, A.fromArray(out, a * 3), B.fromArray(out, b * 3), C.fromArray(out, c * 3), v)) continue;
    cut ??= (index.array as Uint16Array | Uint32Array).slice();
    cut[q + 1] = a; cut[q + 2] = a;
  }
  return moved || cut ? { position: out, index: cut ? new THREE.BufferAttribute(cut, 1) : null } : null;
}

/** Whether a triangle of hair passes through a head piece's cloth: some point of it under the cloth's span stands more than `over` off the table the cloth lies on. */
export function throughCloth(f: HeadFit, t: Float32Array, edges: (az: number) => [number, number], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, v = new THREE.Vector3(), over = THROUGH): boolean {
  const N = 8;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
    v.set(0, 0, 0).addScaledVector(a, i / N).addScaledVector(b, j / N).addScaledVector(c, (N - i - j) / N).sub(f.c);
    const r = v.length();
    if (r < 1e-6) continue;
    const az = Math.atan2(v.x, v.z), el = Math.asin(Math.max(-1, Math.min(1, v.y / r)));
    // (not at the very top: the table's bins meet there, 4 mm apart on an afro, and it is no one surface to be through)
    if (el > E1 - 0.12) continue;
    const [lo, hi] = edges(az), R = radius(t, az, el), y = f.c.y + Math.sin(el) * R;
    if (y < lo + 0.001 || y > hi - 0.001) continue;
    if (r > R + over) return true;
  }
  return false;
}

/** The height of the cloth's table in a direction from the head's middle: where on the head a point that way is, by a head piece's edges. */
export function tableY(f: HeadFit, t: Float32Array, az: number, el: number): number {
  return f.c.y + Math.sin(el) * radius(t, az, el);
}

/** A head piece's edges by azimuth: its lower one's height and its upper one's (Infinity over the crown). */
export function clothEdges(f: HeadFit, hw: Headwear): (az: number) => [number, number] {
  return (az) => {
    const lo = hw.edge ? hw.edge(f, az) : edgeY(f, hw.front, hw.back, az);
    return [lo, hw.up === null ? Infinity : lo + upAt(hw, az)];
  };
}

/** A shade of a colour (k < 1 darker). */
const shade = (c: number, k: number): number => new THREE.Color(c).multiplyScalar(k).getHex();

/**
 * The pieces for what a person wears, by cosmetic id: head (HEAD_PIECES), eyes ('eyes-wrap' | 'eyes-round' |
 * 'eyes-shield'), wrist ('wrist-single' | 'wrist-pair' | 'wrist-long'). Coloured from their kit. Empty for the
 * mannequin. A head piece is one mesh with a material per slot (SLOT); sunglasses are the lenses and the frame.
 */
export function dress(asset: PlayerAsset, wear: Wear, look: KitLook): Piece[] {
  const f = fitHead(asset);
  if (!f) return [];
  const out: Piece[] = [];
  const onHead = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]): void => {
    out.push({ bone: 'Head', mesh: new THREE.Mesh(g, m) });
  };
  const hw = wear.head ? HEADWEAR[wear.head] : undefined;
  if (hw) {
    // Cloth over the head follows the scalp and the hair it leaves under it (worn() presses the rest in).
    const t = clothTable(f, hw.under);
    const c = wear.head === 'head-capback' ? look.shorts : wear.head === 'head-bucket' ? look.shorts : wear.head === 'head-visor' || wear.head === 'head-band' ? look.trim : look.shirt;
    let parts: Part[];
    switch (wear.head) {
      case 'head-band': parts = headbandPieces(f, t); break;
      case 'head-visor': parts = visorPieces(f, t); break;
      case 'head-cap': parts = capPieces(f, t, false); break;
      case 'head-capback': parts = capPieces(f, t, true); break;
      case 'head-bandana': parts = bandanaPieces(f, t); break;
      default: parts = bucketPieces(f, t); break;
    }
    const cloth = wear.head === 'head-band' ? fabric('terry', c, THREE.DoubleSide) : wear.head === 'head-bandana' ? printed(c, 0xf3ead8) : fabric('twill', c, THREE.DoubleSide);
    const mats: THREE.Material[] = [];
    mats[SLOT.crown] = cloth;
    mats[SLOT.top] = stitched(c);
    mats[SLOT.under] = fabric('twill', shade(c, 0.72), THREE.DoubleSide);
    mats[SLOT.trim] = fabric('twill', shade(c, 0.8));
    mats[SLOT.metal] = metal(0xb9bdc4, 0.35);
    mats[SLOT.hole] = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1 });
    onHead(mergeParts(parts), mats);
  }
  if (wear.eyes === 'eyes-wrap' || wear.eyes === 'eyes-round' || wear.eyes === 'eyes-shield') {
    const style = wear.eyes === 'eyes-wrap' ? 'wrap' : wear.eyes === 'eyes-round' ? 'round' : 'shield';
    const g = glasses(f, style);
    // A sport pair: mirrored lenses, a frame in the kit's second colour; the round ones a dark green tint in a thin
    // dark frame; the shield an amber mirror in black.
    const [tint, mirror, frameC] = style === 'wrap' ? [0x2c3b63, true, look.trim] : style === 'shield' ? [0x6b3a12, true, 0x161719] : [0x26301f, false, 0x2a1c12];
    onHead(g.lens, lens(tint, mirror));
    const fm: THREE.Material[] = [];
    fm[GLASS.frame] = plastic(frameC);
    fm[GLASS.rubber] = plastic(0x1b1c1e, 0.8);
    fm[GLASS.metal] = metal(0xb4b8c0, 0.3);
    // (clear silicone pads: black ones showed through the lens as two dots by the eyes)
    const pad = plastic(0xc4c8cc, 0.35);
    pad.transparent = true;
    pad.opacity = 0.45;
    fm[GLASS.pad] = pad;
    onHead(g.frame, fm);
  }
  if (wear.wrist === 'wrist-single' || wear.wrist === 'wrist-pair' || wear.wrist === 'wrist-long') {
    const [from, to] = wear.wrist === 'wrist-long' ? [0.02, 0.14] : [0.025, 0.09];
    // (fitted to what is worn there: over a long sleeve's cuff, not inside it)
    const mine = wornVertices(asset, piecesFor(asset.look?.wardrobe ?? null, wear.paint));
    for (const side of ['R', 'L'] as const) {
      const g = wristband(asset, side, from, to, mine);
      if (!g) continue;
      out.push({ bone: side === 'R' ? 'RightForeArm' : 'LeftForeArm', mesh: new THREE.SkinnedMesh(g, fabric('terry', look.trim)), skinned: true, side, arm: wear.wrist === 'wrist-pair' ? undefined : 'racket' });
    }
  }
  for (const p of out) {
    p.mesh.castShadow = true;
    p.mesh.name = 'worn';
    if (p.skinned) continue;
    p.mesh.matrixAutoUpdate = false;
    p.mesh.matrix.copy(asset.boneInverses[asset.bone(p.bone)]!);
  }
  return out;
}

/**
 * Whether a vertex of the opaque mesh is the person's own headband or visor (modelled into the suit, in the socks'
 * part, above the hips); null when they have none.
 */
function bakedHead(asset: PlayerAsset): ((v: number) => boolean) | null {
  if (!asset.look?.kit.head) return null;
  const g = asset.geometry;
  const partA = g.getAttribute('bodyA') as THREE.BufferAttribute | undefined;
  if (!partA) return null;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const top = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[asset.bone('Hips')]!.clone().invert()).y + 0.6;
  return (v) => partA.getW(v) > 0.5 && pos.getY(v) > top;
}

/**
 * The opaque mesh's triangles without the person's own headband or visor (modelled into the suit, in the socks'
 * part, above the hips): for a player wearing something else on their head. Null when they have none.
 */
export function withoutBakedHead(asset: PlayerAsset, index: THREE.BufferAttribute): THREE.BufferAttribute | null {
  const baked = bakedHead(asset);
  if (!baked) return null;
  const pos = asset.geometry.getAttribute('position') as THREE.BufferAttribute;
  const src = index.array;
  const keep: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    if (!baked(src[t]!) && !baked(src[t + 1]!) && !baked(src[t + 2]!)) keep.push(src[t]!, src[t + 1]!, src[t + 2]!);
  }
  return new THREE.BufferAttribute(src instanceof Uint32Array || pos.count > 65535 ? new Uint32Array(keep) : new Uint16Array(keep), 1);
}

/**
 * Dress a person: the pieces for `wear`, and the opaque mesh's triangles to draw instead when the headband or visor
 * they were modelled in comes off (null: draw them as they are). The modelled one is kept when it is what they wear.
 */
export function worn(asset: PlayerAsset, wear: Wear, look: KitLook, index: THREE.BufferAttribute | null): Dressing {
  const own = ownHead(asset);
  const w: Wear = { ...wear };
  let bodyIndex: THREE.BufferAttribute | null = null;
  if (own && !hasBakedHead(asset)) {
    // (theirs in name only, a MetaHuman build's: put on as anyone's is, unless they wear something else or nothing)
    if (w.head === undefined) w.head = own;
  } else if (w.head !== undefined && own) {
    if (w.head === own) delete w.head;
    else if (index) bodyIndex = withoutBakedHead(asset, index);
  }
  return { pieces: dress(asset, w, look), bodyIndex, hair: w.head ? pressHair(asset, w.head) : null, paintedWrists: wear.wrist === undefined };
}

/** The head piece a person is modelled with, as the cosmetic it is ('head-band' | 'head-visor'); null without one. */
export function ownHead(asset: PlayerAsset): string | null {
  return asset.look?.kit.head ? `head-${asset.look.kit.head}` : null;
}

const BAKED = new WeakMap<THREE.BufferGeometry, boolean>();
/**
 * Whether the person's own headband or visor is in their mesh. The MakeHuman builds' is; a MetaHuman build's is not
 * (mh-player.py makes none since 13 Nov 2026: baked, it was a paper loop that an afro's cards stood through), and theirs
 * is the piece made here, the hair pressed under it.
 */
export function hasBakedHead(asset: PlayerAsset): boolean {
  const g = asset.geometry;
  let has = BAKED.get(g);
  if (has === undefined) {
    const baked = bakedHead(asset);
    has = false;
    if (baked) for (let v = 0, n = g.getAttribute('position').count; v < n && !has; v++) has = baked(v);
    BAKED.set(g, has);
  }
  return has;
}

/** What dressing a person changes on their avatar (Avatar.wear). */
export interface Dressing {
  pieces: Piece[];
  /** The opaque mesh's triangles without a modelled headband (null: as they are). */
  bodyIndex: THREE.BufferAttribute | null;
  /** The hair pressed under a head piece (null: as it is). */
  hair: PressedHair | null;
  /** Whether the towelling bands painted on the wrists stay: not when a wristband, or bare wrists, is chosen. */
  paintedWrists: boolean;
}

