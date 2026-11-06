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
import type { PlayerAsset } from './asset.ts';
import type { KitLook } from './kit.ts';

/** A worn piece: the mesh, the bone it hangs on, and for a one-sided piece which arm it follows. */
export interface Piece {
  bone: string;
  mesh: THREE.Mesh;
  /** On the racket arm or the free arm (the avatar shows the one on the side the player plays). */
  arm?: 'racket' | 'free';
  /** Which side's arm this copy is on. */
  side?: 'R' | 'L';
}

// ---- the head, measured ------------------------------------------------------------------------------------

const NA = 64;
const NE = 36;
const E0 = (-55 * Math.PI) / 180;
const E1 = Math.PI / 2;
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
function weightOf(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, v: number, bone: number): number {
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
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const eyeL = new THREE.Vector3(), eyeR = new THREE.Vector3();
  let nl = 0, nr = 0;
  const pts: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (weightOf(si, sw, i, head) < 0.5) continue;
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

const dirOf = (az: number, el: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

/** The point `off` out from the table's surface in a direction. */
function onHead(f: HeadFit, t: Float32Array, az: number, el: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
  return dirOf(az, el, out).multiplyScalar(radius(t, az, el) + off).add(f.c);
}

/** The elevation at which the surface (plus `off`) is at height y, at this azimuth. */
function elAt(f: HeadFit, t: Float32Array, az: number, y: number, off: number): number {
  let el = 0;
  for (let k = 0; k < 6; k++) el = Math.asin(Math.max(-1, Math.min(1, (y - f.c.y) / (radius(t, az, el) + off))));
  return el;
}

// ---- building surfaces -------------------------------------------------------------------------------------

/** A grid surface: nu x nv points from f(u, v) with u, v in [0, 1]; `wrap` joins u's ends. */
function surface(nu: number, nv: number, wrap: boolean, f: (u: number, v: number, out: THREE.Vector3) => void): THREE.BufferGeometry {
  const cols = wrap ? nu : nu + 1;
  const p = new Float32Array(cols * (nv + 1) * 3);
  const q = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
    f(i / nu, j / nv, q);
    q.toArray(p, (j * cols + i) * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = wrap ? (i + 1) % cols : i + 1;
    const a = j * cols + i, b = j * cols + i1, c = (j + 1) * cols + i, d = (j + 1) * cols + i1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Several geometries as one (positions and normals; indices kept). */
function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of gs) { nv += g.getAttribute('position').count; ni += g.index!.count; }
  const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of gs) {
    p.set(g.getAttribute('position').array as Float32Array, ov * 3);
    n.set(g.getAttribute('normal').array as Float32Array, ov * 3);
    const gi = g.index!.array;
    for (let k = 0; k < gi.length; k++) idx[oi + k] = gi[k]! + ov;
    ov += g.getAttribute('position').count;
    oi += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const D = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---- head pieces -------------------------------------------------------------------------------------------

/** Where a head piece's lower edge runs: `front` m above the eyes at the front, `back` at the back (cosine between). */
function edgeY(f: HeadFit, front: number, back: number, az: number): number {
  const eyeY = (f.eyeL.y + f.eyeR.y) / 2;
  return eyeY + lerp(front, back, (1 - Math.cos(az)) / 2);
}

/** A band round the head: lower edge on the edge line, `width` up, `thick` m proud of the hair, rolled edges. */
function band(f: HeadFit, front: number, back: number, width: number, thick: number): THREE.BufferGeometry {
  const rows = [[0, 0.0015], [0, thick], [width, thick], [width, 0.0015]] as const;
  const out = new THREE.Vector3();
  return surface(NA, 3, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    const [dy, off] = rows[Math.round(v * 3)]!;
    const y = edgeY(f, front, back, az) + dy;
    q.copy(onHead(f, f.shell, az, elAt(f, f.shell, az, y, off), off, out));
  });
}

/** A dome over the head from the edge line to the crown, `off` m proud of the hair. */
function dome(f: HeadFit, front: number, back: number, off: number, t = f.shell): THREE.BufferGeometry {
  return surface(NA, 16, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    const el0 = elAt(f, t, az, edgeY(f, front, back, az), off);
    // (more rows near the edge, where the head turns)
    const el = lerp(el0, E1 - 0.01, Math.sin((v * Math.PI) / 2) ** 1.4);
    onHead(f, t, az, el, off, q);
  });
}

/**
 * A peak out of the edge line round `centre` (azimuth), `span` each way: `length` at the middle, sloping down by
 * `slope` (radians), its sides curling down by `curl` m; `thick` m thick.
 */
function bill(f: HeadFit, front: number, back: number, off: number, centre: number, span: number, length: number, slope: number, curl: number, thick: number): THREE.BufferGeometry {
  // Rows: root under, tip under, tip over, root over.
  const root = new THREE.Vector3(), outw = new THREE.Vector3();
  return surface(24, 3, false, (u, v, q) => {
    const s = u * 2 - 1;
    const az = centre + s * span;
    const y = edgeY(f, front, back, az);
    // (its root a little inside the crown, so the peak comes out of it cleanly)
    onHead(f, f.shell, az, elAt(f, f.shell, az, y, off - 0.003), off - 0.003, root);
    outw.set(Math.sin(az), 0, Math.cos(az));
    const row = Math.round(v * 3);
    const tip = row === 1 || row === 2;
    const L = tip ? length * Math.sqrt(Math.max(0.02, 1 - s * s)) : 0;
    const under = row === 0 || row === 1 ? -thick / 2 : thick / 2;
    q.copy(root).addScaledVector(outw, L * Math.cos(slope));
    q.y += under - L * Math.sin(slope) - (tip ? curl * s * s : 0);
  });
}

function capPieces(f: HeadFit, backwards: boolean): THREE.BufferGeometry {
  const { front, back } = HEADWEAR['head-cap']!, off = 0.006;
  const parts = [
    dome(f, front, back, off),
    bill(f, front, back, off, backwards ? Math.PI : 0, 68 * D, 0.072, (backwards ? -6 : 12) * D, 0.014, 0.004),
  ];
  // The button on the crown.
  const top = onHead(f, f.shell, 0, E1 - 0.01, off);
  const b = new THREE.SphereGeometry(0.0065, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  b.translate(top.x, top.y - 0.001, top.z);
  parts.push(b);
  return merge(parts);
}

function bucket(f: HeadFit): THREE.BufferGeometry {
  const { front, back } = HEADWEAR['head-bucket']!, off = 0.01;
  const brim = new THREE.Vector3();
  const rim = surface(NA, 3, true, (u, v, q) => {
    const az = u * 2 * Math.PI - Math.PI;
    onHead(f, f.shell, az, elAt(f, f.shell, az, edgeY(f, front, back, az), off), off, brim);
    const row = Math.round(v * 3);
    const L = row === 1 || row === 2 ? 0.048 : 0;
    const t = row === 0 || row === 1 ? -0.0018 : 0.0018;
    q.set(brim.x + Math.sin(az) * L * Math.cos(26 * D), brim.y + t - L * Math.sin(26 * D), brim.z + Math.cos(az) * L * Math.cos(26 * D));
  });
  return merge([dome(f, front, back, off), rim]);
}

function bandana(f: HeadFit): THREE.BufferGeometry {
  const { front, back } = HEADWEAR['head-bandana']!, off = 0.0035;
  // The knot's two tails at the back, hanging from the edge.
  const knot = onHead(f, f.shell, Math.PI, elAt(f, f.shell, Math.PI, edgeY(f, front, back, Math.PI), off), off);
  const tails = [-1, 1].map((s) => surface(4, 6, false, (u, v, q) => {
    const w = lerp(0.028, 0.014, v);
    q.set(knot.x + s * (0.006 + v * 0.018) + (u - 0.5) * w, knot.y - v * 0.075, knot.z - 0.006 - v * 0.012 + Math.sin(u * Math.PI) * 0.002);
  }));
  return merge([dome(f, front, back, off), ...tails]);
}

// ---- sunglasses --------------------------------------------------------------------------------------------

/**
 * Sunglasses. The lenses are on an upright cylinder of their own (a sport lens's tight curve, a shield's looser one),
 * its axis behind the eyes, its radius whatever clears the eyes, lashes and brows by CLEAR: measured from the head's
 * vertices in front of the eyes, the nose left out (the bridge rests on it). The temples run back along the side of the
 * head to the ears.
 */
const CLEAR = 0.007;
function glasses(f: HeadFit, style: 'wrap' | 'round' | 'shield'): { lens: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  const eyeY = (f.eyeL.y + f.eyeR.y) / 2, eyeZ = (f.eyeL.z + f.eyeR.z) / 2, eyeX = (f.eyeL.x - f.eyeR.x) / 2;
  const shield = style === 'shield';
  // The cylinder's axis: CURVE behind the eyes (a looser curve for the shield, which spans both).
  const CURVE = shield ? 0.095 : style === 'wrap' ? 0.07 : 0.11;
  const ax = 0, az0 = eyeZ - CURVE;
  const NOSE_X = 0.3 * eyeX + 0.004;
  // Clear of what is in front of the eyes, the nose's ridge left out.
  let r = 0;
  const window = (src: Float32Array): void => {
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
      if (Math.abs(y - eyeY) > 0.02 || z < eyeZ - 0.03 || Math.abs(x) < NOSE_X || Math.abs(x) > eyeX + 0.04) continue;
      r = Math.max(r, Math.hypot(x - ax, z - az0) + CLEAR);
    }
  };
  window(f.pts);
  window(f.hairPts);
  const azOf = (x: number, z: number): number => Math.atan2(x - ax, z - az0);
  const eAz = azOf(eyeX, eyeZ);
  const noseAz = Math.asin(Math.min(0.9, NOSE_X / r));
  /** The nose's front at a height, near the middle (for the bridge). */
  const noseZ = (y: number): number => {
    let z = -Infinity;
    for (let i = 0; i < f.pts.length; i += 3) if (Math.abs(f.pts[i]!) < NOSE_X && Math.abs(f.pts[i + 1]! - y) < 0.004) z = Math.max(z, f.pts[i + 2]!);
    return z;
  };
  const at = (a: number, y: number, rr: number, q: THREE.Vector3): THREE.Vector3 => q.set(ax + Math.sin(a) * rr, y, az0 + Math.cos(a) * rr);
  const lens: THREE.BufferGeometry[] = [];
  const frame: THREE.BufferGeometry[] = [];
  /** A bar along a path of points (the front face's lower edge), `h` tall and `d` deep, set back along `back`. */
  const bar = (n: number, path: (u: number, q: THREE.Vector3) => void, back: (u: number, q: THREE.Vector3) => void, h: number, d: number): THREE.BufferGeometry => {
    const prof = [[0, 0], [h, 0], [h, d], [0, d]] as const;
    const b = new THREE.Vector3();
    return surface(n, 3, false, (u, v, q) => {
      path(u, q);
      back(u, b);
      const [dy, dd] = prof[Math.round(v * 3)]!;
      q.y += dy;
      q.addScaledVector(b, dd);
    });
  };
  const along = (path: (u: number) => number) => (u: number, q: THREE.Vector3): void => { const a = path(u); q.set(-Math.sin(a), 0, -Math.cos(a)); };
  // The temples: from the lens's outer top corner back along the side of the head (the cloth table round the cranium's
  // centre), just above the eyes' line, to the ears.
  const temple = (s: number, a0: number, y0: number): THREE.BufferGeometry => {
    const start = at(s * a0, y0, r + 0.0025, new THREE.Vector3());
    const c0 = Math.atan2(start.x - f.c.x, start.z - f.c.z);
    const side = new THREE.Vector3();
    return bar(16, (u, q) => {
      const ca = lerp(c0, s * 110 * D, u);
      const y = lerp(y0, eyeY + 0.008, Math.min(1, u * 2));
      onHead(f, f.hair, ca, elAt(f, f.hair, ca, y, 0.004), 0.004, side);
      side.y = y;
      q.lerpVectors(start, side, Math.min(1, u * 3));
      q.y = y;
    }, (u, q) => {
      const ca = lerp(c0, s * 110 * D, u);
      q.set(-Math.sin(ca), 0, -Math.cos(ca));
    }, 0.005, 0.0025);
  };
  // The bridge, resting on the nose between the lenses.
  const bridge = (y: number, h: number): THREE.BufferGeometry => {
    const nz = noseZ(y + h / 2);
    return bar(10, (u, q) => {
      const a = lerp(-noseAz - 2 * D, noseAz + 2 * D, u);
      at(a, y, r, q);
      // (in the middle down onto the nose's ridge, if the lens line stands off it)
      const mid = Math.cos(((u - 0.5) * Math.PI)) ** 2;
      if (Number.isFinite(nz)) q.z = lerp(q.z, Math.min(q.z, nz + 0.003), mid);
    }, along((u) => lerp(-noseAz, noseAz, u)), h, 0.003);
  };
  if (style === 'round') {
    const R = 0.02;
    for (const s of [1, -1]) {
      const c = s * Math.max(eAz, noseAz + R / r);
      const ring = (rIn: number, rOut: number, depth: number): THREE.BufferGeometry => surface(32, 1, true, (u, v, q) => {
        const t = u * 2 * Math.PI, rr = lerp(rIn, rOut, v);
        at(c + (Math.cos(t) * rr) / r, eyeY + 0.002 + Math.sin(t) * rr, r + depth, q);
      });
      lens.push(ring(0, R, 0));
      frame.push(ring(R - 0.0005, R + 0.003, 0.0012), ring(R + 0.003, R - 0.0005, -0.0012), ring(R + 0.003, R + 0.003 + 1e-4, 0.0012));
      frame.push(temple(s, Math.abs(c) + (R + 0.002) / r, eyeY + 0.006));
    }
    frame.push(bridge(eyeY + 0.008, 0.003));
  } else {
    // wrap: a lens each side, deepest under the eye, tapering to the temple; shield: one across both, cut up over the nose.
    const aOut = eAz + (shield ? 28 : 26) * D;
    const runs: Array<[number, number]> = shield ? [[-aOut, aOut]] : [[noseAz, aOut], [-aOut, -noseAz]];
    // A shield passes in front of the bridge of the nose.
    let rs = r;
    if (shield) { const nz = noseZ(eyeY + 0.008); if (Number.isFinite(nz)) rs = Math.max(r, nz + 0.004 - az0); }
    const top = (a: number): number => eyeY + (shield ? 0.019 : 0.016) - 0.005 * Math.max(0, (Math.abs(a) - eAz) / (aOut - eAz)) ** 2;
    const bottom = (a: number): number => {
      if (shield) return eyeY - 0.021 + 0.018 * Math.max(0, 1 - Math.abs(a) / (noseAz * 1.6)) ** 0.7 + 0.01 * (Math.abs(a) / aOut) ** 4;
      const k = (Math.abs(a) - noseAz) / (aOut - noseAz);
      return eyeY - 0.005 - 0.014 * Math.sqrt(Math.max(0, 4 * k * (1 - k))) * (k < 0.5 ? 1 : 1 - 0.4 * (2 * k - 1));
    };
    for (const [a0, a1] of runs) {
      lens.push(surface(32, 6, false, (u, v, q) => { const a = lerp(a0, a1, u); at(a, lerp(bottom(a), top(a), v), rs, q); }));
      frame.push(bar(32, (u, q) => { const a = lerp(a0, a1, u); at(a, top(a) - 0.001, rs + 0.003, q); }, along((u) => lerp(a0, a1, u)), 0.0045, 0.003));
    }
    if (!shield) frame.push(bridge(top(noseAz) - 0.001, 0.0045));
    for (const s of [1, -1]) frame.push(temple(s, aOut, top(aOut) - 0.001));
  }
  return { lens: merge(lens), frame: merge(frame) };
}

// ---- wristbands --------------------------------------------------------------------------------------------

/** A terry band round a forearm: from `from` to `to` m up the forearm from the wrist joint. */
function wristband(asset: PlayerAsset, side: 'R' | 'L', from: number, to: number): THREE.BufferGeometry | null {
  const fore = asset.bone(side === 'R' ? 'RightForeArm' : 'LeftForeArm');
  const hand = asset.bone(side === 'R' ? 'RightHand' : 'LeftHand');
  if (fore < 0 || hand < 0) return null;
  const A = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[fore]!.clone().invert());
  const B = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[hand]!.clone().invert());
  const axis = A.clone().sub(B);
  const len = axis.length();
  axis.normalize();
  // A frame across the forearm.
  const u = new THREE.Vector3(0, 1, 0).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(axis);
  u.normalize();
  const w = axis.clone().cross(u).normalize();
  const N = 24, R = new Float32Array(N);
  const g = asset.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (weightOf(si, sw, i, fore) + weightOf(si, sw, i, hand) < 0.5) continue;
    p.fromBufferAttribute(pos, i).sub(B);
    const along = p.dot(axis);
    if (along < from - 0.01 || along > Math.min(to, len) + 0.01) continue;
    const x = p.dot(u), y = p.dot(w), r = Math.hypot(x, y);
    if (r > 0.08) continue;
    const k = Math.round(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * N) % N;
    R[k] = Math.max(R[k]!, r);
  }
  // Smooth round (the band stretches over the bumps), never below a bin's own skin.
  const S = new Float32Array(N);
  let mean = 0, n = 0;
  for (let k = 0; k < N; k++) if (R[k]! > 0) { mean += R[k]!; n++; }
  if (!n) return null;
  mean /= n;
  for (let k = 0; k < N; k++) {
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, R[(k + d + N) % N]! || mean);
    S[k] = m;
  }
  const rows = [[from, 0.001], [from, 0.0055], [to, 0.0055], [to, 0.001]] as const;
  return surface(N, 3, true, (uu, vv, q) => {
    const t = uu * 2 * Math.PI - Math.PI;
    const k = Math.round(uu * N) % N;
    const [al, off] = rows[Math.round(vv * 3)]!;
    const rr = S[k]! + off;
    q.copy(B).addScaledVector(axis, al).addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr);
  });
}

// ---- dressing ----------------------------------------------------------------------------------------------

const fabric = (c: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });

/** What a player wears that is drawn here, by cosmetic id (data/cosmetics.json): head, sunglasses, wristbands. A slot
 * left out keeps what the person was modelled with (a headband or a visor); null takes it off. */
export interface Wear {
  head?: string | null;
  eyes?: string | null;
  wrist?: string | null;
  /** On the courtside bench, not on the player (game.ts placeBags). */
  bag?: string;
}

/**
 * Each head piece: where its cloth meets the head (its lower edge's height over the eyes at the front and at the back),
 * how far up it reaches (null: over the crown), and how much hair it leaves under it (m): the cloth is that far off the
 * scalp at most, and the hair under it is pressed in to fit (pressHair).
 */
export const HEADWEAR: Record<string, { front: number; back: number; up: number | null; under: number }> = {
  'head-band': { front: 0.026, back: -0.006, up: 0.034, under: 0.004 },
  'head-visor': { front: 0.024, back: -0.008, up: 0.03, under: 0.004 },
  'head-cap': { front: 0.03, back: -0.008, up: null, under: 0.007 },
  'head-capback': { front: 0.03, back: -0.008, up: null, under: 0.007 },
  'head-bandana': { front: 0.034, back: -0.04, up: null, under: 0.003 },
  'head-bucket': { front: 0.038, back: 0.004, up: null, under: 0.009 },
};

/** The head piece ids drawn here (the cosmetics' `head` slot). */
export const HEAD_PIECES = Object.keys(HEADWEAR);

/** The table cloth follows: the scalp plus at most `under` of hair, smoothed from above. */
export function clothTable(f: HeadFit, under: number): Float32Array {
  const t = new Float32Array(f.hair.length);
  for (let k = 0; k < t.length; k++) t[k] = Math.min(f.hair[k]!, f.skin[k]! + under);
  return envelope(t);
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The hair's positions (its alpha mesh's, bind pose) with what a head piece covers pressed in under the cloth (2 mm
 * inside it), easing out over a centimetre past the cloth's edges so the hair that shows under it bulges as hair does;
 * null when nothing moves. Brows and lashes lie on the skin and never move.
 */
export function pressHair(asset: PlayerAsset, id: string): Float32Array | null {
  const hw = HEADWEAR[id];
  const f = fitHead(asset);
  const ag = asset.look?.alphaGeometry;
  if (!hw || !f || !ag) return null;
  const t = clothTable(f, hw.under);
  const pos = ag.getAttribute('position') as THREE.BufferAttribute | undefined;
  const si = ag.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const sw = ag.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  if (!pos || !si || !sw) return null;
  const head = asset.bone('Head');
  const out = new Float32Array(pos.count * 3);
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    if (weightOf(si, sw, i, head) < 0.3) continue;
    const dx = x - f.c.x, dy = y - f.c.y, dz = z - f.c.z, r = Math.hypot(dx, dy, dz);
    if (r < 1e-6) continue;
    const az = Math.atan2(dx, dz), el = Math.asin(Math.max(-1, Math.min(1, dy / r)));
    const lo = edgeY(f, hw.front, hw.back, az);
    let k = smooth(lo - 0.012, lo, y);
    if (hw.up !== null) k *= 1 - smooth(lo + hw.up, lo + hw.up + 0.012, y);
    // (never closer to the scalp than 4 mm: what lies on it, the brows and lashes among it, stays)
    const R = Math.max(radius(t, az, el) - 0.002, radius(f.skin, az, el) + 0.004);
    if (k <= 0 || r <= R) continue;
    const s = (r - k * (r - R)) / r;
    out[i * 3] = f.c.x + dx * s; out[i * 3 + 1] = f.c.y + dy * s; out[i * 3 + 2] = f.c.z + dz * s;
    moved++;
  }
  return moved ? out : null;
}

/**
 * The pieces for what a person wears, by cosmetic id: head (HEAD_PIECES), eyes ('eyes-wrap' | 'eyes-round' |
 * 'eyes-shield'), wrist ('wrist-single' | 'wrist-pair' | 'wrist-long'). Coloured from their kit. Empty for the
 * mannequin.
 */
export function dress(asset: PlayerAsset, wear: Wear, look: KitLook): Piece[] {
  const f = fitHead(asset);
  if (!f) return [];
  const out: Piece[] = [];
  const onHead = (g: THREE.BufferGeometry, m: THREE.Material): void => {
    const mesh = new THREE.Mesh(g, m);
    out.push({ bone: 'Head', mesh });
  };
  const hw = wear.head ? HEADWEAR[wear.head] : undefined;
  if (hw) {
    // Cloth over the head follows the scalp and the hair it leaves under it (worn() presses the rest in).
    const c: HeadFit = { ...f, shell: clothTable(f, hw.under) };
    const { front, back } = hw;
    switch (wear.head) {
      case 'head-band': onHead(band(c, front, back, hw.up!, 0.0065), fabric(look.trim)); break;
      case 'head-visor': onHead(merge([band(c, front, back, hw.up!, 0.004), bill(c, front, back, 0.004, 0, 80 * D, 0.068, 14 * D, 0.01, 0.0035)]), fabric(look.trim)); break;
      case 'head-cap': onHead(capPieces(c, false), fabric(look.shirt)); break;
      case 'head-capback': onHead(capPieces(c, true), fabric(look.shorts)); break;
      case 'head-bandana': onHead(bandana(c), fabric(look.shirt)); break;
      default: onHead(bucket(c), fabric(look.shorts)); break;
    }
  }
  if (wear.eyes === 'eyes-wrap' || wear.eyes === 'eyes-round' || wear.eyes === 'eyes-shield') {
    const style = wear.eyes === 'eyes-wrap' ? 'wrap' : wear.eyes === 'eyes-round' ? 'round' : 'shield';
    const g = glasses(f, style);
    // Tinted lenses (no environment to mirror, so a glossy dielectric: the lights' highlights carry it); a sport frame
    // in the kit's second colour, the others dark.
    const [lensC, frameC] = style === 'wrap' ? [0x34456e, look.trim] : style === 'shield' ? [0x6a3a16, 0x16171a] : [0x2b3324, 0x3b2617];
    onHead(g.lens, new THREE.MeshStandardMaterial({ color: lensC, roughness: 0.12, metalness: 0, side: THREE.DoubleSide }));
    onHead(g.frame, new THREE.MeshStandardMaterial({ color: frameC, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide }));
  }
  if (wear.wrist === 'wrist-single' || wear.wrist === 'wrist-pair' || wear.wrist === 'wrist-long') {
    const [from, to] = wear.wrist === 'wrist-long' ? [0.02, 0.14] : [0.025, 0.09];
    for (const side of ['R', 'L'] as const) {
      const g = wristband(asset, side, from, to);
      if (!g) continue;
      out.push({ bone: side === 'R' ? 'RightForeArm' : 'LeftForeArm', mesh: new THREE.Mesh(g, fabric(look.trim)), side, arm: wear.wrist === 'wrist-pair' ? undefined : 'racket' });
    }
  }
  for (const p of out) {
    p.mesh.castShadow = true;
    p.mesh.matrixAutoUpdate = false;
    p.mesh.matrix.copy(asset.boneInverses[asset.bone(p.bone)]!);
    p.mesh.name = 'worn';
  }
  return out;
}

/**
 * The opaque mesh's triangles without the person's own headband or visor (modelled into the suit, in the socks'
 * part, above the hips): for a player wearing something else on their head. Null when they have none.
 */
export function withoutBakedHead(asset: PlayerAsset, index: THREE.BufferAttribute): THREE.BufferAttribute | null {
  if (!asset.look?.kit.head) return null;
  const g = asset.geometry;
  const partA = g.getAttribute('bodyA') as THREE.BufferAttribute | undefined;
  if (!partA) return null;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const hips = new THREE.Vector3().setFromMatrixPosition(asset.boneInverses[asset.bone('Hips')]!.clone().invert());
  const src = index.array;
  const keep: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    let cut = false;
    for (let k = 0; k < 3; k++) {
      const v = src[t + k]!;
      if (partA.getW(v) > 0.5 && pos.getY(v) > hips.y + 0.6) cut = true;
    }
    if (!cut) keep.push(src[t]!, src[t + 1]!, src[t + 2]!);
  }
  return new THREE.BufferAttribute(src instanceof Uint32Array || pos.count > 65535 ? new Uint32Array(keep) : new Uint16Array(keep), 1);
}

/**
 * Dress a person: the pieces for `wear`, and the opaque mesh's triangles to draw instead when the headband or visor
 * they were modelled in comes off (null: draw them as they are). The modelled one is kept when it is what they wear.
 */
export function worn(asset: PlayerAsset, wear: Wear, look: KitLook, index: THREE.BufferAttribute | null): Dressing {
  const own = asset.look?.kit.head ? `head-${asset.look.kit.head}` : null;
  const w: Wear = { ...wear };
  let bodyIndex: THREE.BufferAttribute | null = null;
  if (w.head !== undefined && own) {
    if (w.head === own) delete w.head;
    else if (index) bodyIndex = withoutBakedHead(asset, index);
  }
  return { pieces: dress(asset, w, look), bodyIndex, hair: w.head ? pressHair(asset, w.head) : null };
}

/** What dressing a person changes on their avatar (Avatar.wear). */
export interface Dressing {
  pieces: Piece[];
  /** The opaque mesh's triangles without a modelled headband (null: as they are). */
  bodyIndex: THREE.BufferAttribute | null;
  /** The hair's positions pressed under a head piece (null: as they are). */
  hair: Float32Array | null;
}

// ---- bags on the courtside bench -------------------------------------------------------------------------

/** A rounded box (a superellipsoid: `e` 1 is an ellipsoid, towards 0 a box), sx x sy x sz, its base on y = 0. */
function softBox(sx: number, sy: number, sz: number, e: number): THREE.BufferGeometry {
  const sp = (c: number, k: number): number => Math.sign(c) * Math.abs(c) ** k;
  return surface(32, 16, true, (u, v, q) => {
    const a = u * 2 * Math.PI, b = (v - 0.5) * Math.PI;
    q.set((sx / 2) * sp(Math.cos(b), e) * sp(Math.cos(a), e), (sy / 2) * sp(Math.sin(b), e) + sy / 2, (sz / 2) * sp(Math.cos(b), e) * sp(Math.sin(a), e));
  });
}

/** A tube of radius `r` along a path (t in [0, 1]). */
function tube(path: (t: number, out: THREE.Vector3) => void, r: number): THREE.BufferGeometry {
  const p = new THREE.Vector3(), p2 = new THREE.Vector3(), tan = new THREE.Vector3(), n = new THREE.Vector3(), bn = new THREE.Vector3();
  return surface(8, 16, true, (u, v, q) => {
    path(v, p);
    path(Math.min(1, v + 0.01), p2);
    if (v >= 0.99) { path(v - 0.01, p2); tan.subVectors(p, p2); } else tan.subVectors(p2, p);
    tan.normalize();
    n.set(0, 1, 0).cross(tan);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize();
    bn.crossVectors(tan, n);
    const a = u * 2 * Math.PI;
    q.copy(p).addScaledVector(n, Math.cos(a) * r).addScaledVector(bn, Math.sin(a) * r);
  });
}

/** Colour a geometry's vertices: `f(x, y, z)` picks main (false) or accent (true). */
function tint(g: THREE.BufferGeometry, main: number, accent: number, f: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(main), b = new THREE.Color(accent);
  for (let i = 0; i < pos.count; i++) (f(pos.getX(i), pos.getY(i), pos.getZ(i)) ? b : a).toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Several geometries with colours as one. */
function mergeColoured(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const cols = gs.map((g) => g.getAttribute('color').array as Float32Array);
  const out = merge(gs);
  const all = new Float32Array(out.getAttribute('position').count * 3);
  let o = 0;
  for (const c of cols) { all.set(c, o); o += c.length; }
  out.setAttribute('color', new THREE.BufferAttribute(all, 3));
  return out;
}

/** The bag ids drawn here (the cosmetics' `bag` slot); a player wearing none brings the holdall. */
export const BAGS = ['bag-holdall', 'bag-thermo', 'bag-backpack', 'bag-tour'] as const;

/**
 * A bag, lying along x on the bench (its base at y = 0, centred), in the player's colours: `main` the body, `accent` the
 * ends, panels and handles.
 */
export function makeBag(id: string, main: number, accent: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const arc = (x0: number, x1: number, y: number, h: number, z: number) => (t: number, out: THREE.Vector3): void => {
    out.set(lerp(x0, x1, t), y + Math.sin(t * Math.PI) * h, z);
  };
  if (id === 'bag-thermo') {
    // A racket bag: long, ends in the accent colour, a band of it round the middle, a handle over the top.
    parts.push(tint(softBox(0.74, 0.3, 0.22, 0.3), main, accent, (x) => Math.abs(x) > 0.27 || Math.abs(x) < 0.04));
    parts.push(tint(tube(arc(-0.12, 0.12, 0.29, 0.08, 0), 0.008), accent, accent, () => true));
  } else if (id === 'bag-backpack') {
    // Upright, back to the court: a front pocket and a grab loop.
    parts.push(tint(softBox(0.3, 0.44, 0.17, 0.35), main, accent, (_x, y) => y > 0.4));
    const pocket = tint(softBox(0.24, 0.19, 0.07, 0.4), accent, accent, () => true);
    pocket.translate(0, 0.05, 0.075);
    parts.push(pocket);
    parts.push(tint(tube((t, out) => out.set(lerp(-0.04, 0.04, t), 0.44 + Math.sin(t * Math.PI) * 0.035, -0.02), 0.007), accent, accent, () => true));
  } else if (id === 'bag-tour') {
    // A big tour bag, two-tone lengthwise, two handles.
    parts.push(tint(softBox(0.8, 0.36, 0.3, 0.25), main, accent, (_x, y, z) => z > 0.02 || y > 0.33));
    for (const z of [-0.07, 0.07]) parts.push(tint(tube(arc(-0.16, 0.16, 0.355, 0.09, z), 0.009), accent, accent, () => true));
  } else {
    // A holdall: soft, two handles.
    parts.push(tint(softBox(0.52, 0.26, 0.26, 0.4), main, accent, (x) => Math.abs(x) > 0.23));
    for (const z of [-0.05, 0.05]) parts.push(tint(tube(arc(-0.1, 0.1, 0.25, 0.075, z), 0.008), accent, accent, () => true));
  }
  const m = new THREE.Mesh(mergeColoured(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = 'bag';
  return m;
}
