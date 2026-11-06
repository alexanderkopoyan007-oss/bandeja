// Geometry made in code for props and worn pieces (costume.ts, props.ts): grid surfaces with UVs in metres (so a
// fabric's weave is the same size everywhere), tubes of any cross-section along a path (straps, piping, frames),
// rounded boxes with padded faces (bags, cushions, slats), and merging with one group per material.
import * as THREE from 'three/webgpu';

/**
 * A grid surface: (nu + 1) x (nv + 1) points from f(u, v) with u, v in [0, 1]; `wrap` joins u's ends. Its UVs are
 * arc lengths in metres along each row and column, unless `uvf` gives them; its normals are the grid's, smoothed.
 */
export function surface(nu: number, nv: number, wrap: boolean, f: (u: number, v: number, out: THREE.Vector3) => void, uvf?: (u: number, v: number) => [number, number]): THREE.BufferGeometry {
  const cols = wrap ? nu : nu + 1;
  const n = cols * (nv + 1);
  const p = new Float32Array(n * 3);
  const q = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
    f(i / nu, j / nv, q);
    q.toArray(p, (j * cols + i) * 3);
  }
  const uv = new Float32Array(n * 2);
  const d = (a: number, b: number): number => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
  for (let j = 0; j <= nv; j++) for (let i = 1; i < cols; i++) uv[(j * cols + i) * 2] = uv[(j * cols + i - 1) * 2]! + d(j * cols + i, j * cols + i - 1);
  for (let i = 0; i < cols; i++) for (let j = 1; j <= nv; j++) uv[(j * cols + i) * 2 + 1] = uv[((j - 1) * cols + i) * 2 + 1]! + d(j * cols + i, (j - 1) * cols + i);
  if (uvf) for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const [a, b] = uvf(i / nu, j / nv); uv[(j * cols + i) * 2] = a; uv[(j * cols + i) * 2 + 1] = b; }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = wrap ? (i + 1) % cols : i + 1;
    const a = j * cols + i, b = j * cols + i1, c = (j + 1) * cols + i, e = (j + 1) * cols + i1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A part of a merged geometry: its geometry and which material (by index) draws it. */
export interface Part { g: THREE.BufferGeometry; m: number }

/**
 * Parts as one geometry: position, normal and uv (and colour if every part has one), one group per material index in
 * order. Indexed or not, every part is drawn with its own triangles. The parts are disposed.
 */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const sorted = [...parts].sort((a, b) => a.m - b.m);
  let nv = 0, ni = 0;
  for (const { g } of sorted) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    nv += g.getAttribute('position').count;
    ni += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const colour = sorted.every(({ g }) => g.getAttribute('color'));
  const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), c = colour ? new Float32Array(nv * 3) : null;
  const idx = new Uint32Array(ni);
  const out = new THREE.BufferGeometry();
  let ov = 0, oi = 0, groupStart = 0, groupM = sorted.length ? sorted[0]!.m : 0;
  for (const { g, m } of sorted) {
    if (m !== groupM) { out.addGroup(groupStart, oi - groupStart, groupM); groupStart = oi; groupM = m; }
    const count = g.getAttribute('position').count;
    p.set(g.getAttribute('position').array as Float32Array, ov * 3);
    n.set(g.getAttribute('normal').array as Float32Array, ov * 3);
    const guv = g.getAttribute('uv');
    if (guv) uv.set(guv.array as Float32Array, ov * 2);
    if (c) c.set(g.getAttribute('color').array as Float32Array, ov * 3);
    if (g.index) { const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[oi + k] = gi[k]! + ov; oi += gi.length; }
    else { for (let k = 0; k < count; k++) idx[oi + k] = ov + k; oi += count; }
    ov += count;
    g.dispose();
  }
  if (sorted.length) out.addGroup(groupStart, oi - groupStart, groupM);
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (c) out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * A tube along `path` (t in [0, 1]) with a superellipse cross-section `w` wide (across, in the plane of `up` x the
 * path) and `h` thick (along `up`'s side of it): power 2 is an ellipse, higher is squarer with rounded corners. `size`
 * can taper it along the path. `caps`: close the ends.
 */
export function tube(
  path: (t: number, out: THREE.Vector3) => void, w: number, h: number,
  opts: { n?: number; around?: number; power?: number; up?: THREE.Vector3 | ((t: number, out: THREE.Vector3) => void); size?: (t: number) => number; caps?: boolean } = {},
): THREE.BufferGeometry {
  const n = opts.n ?? 24, around = opts.around ?? 12, pw = opts.power ?? 2;
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), tan = new THREE.Vector3();
  const side = new THREE.Vector3(), nrm = new THREE.Vector3(), up = new THREE.Vector3();
  const e = 2 / pw;
  const sp = (x: number): number => Math.sign(x) * Math.abs(x) ** e;
  const g = surface(around, n, true, (u, v, q) => {
    path(v, p);
    path(Math.max(0, v - 0.002), a);
    path(Math.min(1, v + 0.002), b);
    tan.subVectors(b, a).normalize();
    if (typeof opts.up === 'function') opts.up(v, up);
    else up.copy(opts.up ?? new THREE.Vector3(0, 1, 0));
    side.crossVectors(up, tan);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0).cross(tan);
    side.normalize();
    nrm.crossVectors(tan, side).normalize();
    const k = opts.size ? opts.size(v) : 1;
    const th = u * 2 * Math.PI;
    q.copy(p).addScaledVector(side, (w / 2) * k * sp(Math.cos(th))).addScaledVector(nrm, (h / 2) * k * sp(Math.sin(th)));
  });
  if (!opts.caps) return g;
  const parts: Part[] = [{ g, m: 0 }];
  for (const end of [0, 1]) {
    // A cap: the end ring fanned to its centre.
    const ring = g.getAttribute('position');
    const cols = around, row = end === 0 ? 0 : n;
    const cpos: number[] = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < cols; i++) { cx += ring.getX(row * cols + i); cy += ring.getY(row * cols + i); cz += ring.getZ(row * cols + i); }
    cx /= cols; cy /= cols; cz /= cols;
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % cols;
      const A = [ring.getX(row * cols + i), ring.getY(row * cols + i), ring.getZ(row * cols + i)];
      const B = [ring.getX(row * cols + i1), ring.getY(row * cols + i1), ring.getZ(row * cols + i1)];
      if (end === 0) cpos.push(cx, cy, cz, ...B, ...A);
      else cpos.push(cx, cy, cz, ...A, ...B);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cpos), 3));
    cg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((cpos.length / 3) * 2), 2));
    cg.computeVertexNormals();
    parts.push({ g: cg, m: 0 });
  }
  const out = mergeParts(parts);
  out.clearGroups();
  return out;
}

/**
 * A rounded box sx x sy x sz (centred on x and z, its base on y = 0) with edges of radius r, its faces padded out by
 * `pillow` (m, at a face's middle) and its top sagging by `sag`: a bag, a cushion, a slat. `seg` grid steps a face.
 * Built on the box's own surface, each point moved to the rounded one (the inner box's nearest point plus r along
 * the way out), normals from the surface itself, so faces join without a seam.
 */
export interface BoxOpts { seg?: number; pillow?: number; sag?: number; taper?: number }

/**
 * The rounded box's surface as a map: a point `q` on the plain box (centred, y from -sy/2 to sy/2) to the rounded,
 * padded one (its base on y = 0). roundedBox builds on it; piping and seams follow it.
 */
export function roundedBoxMap(sx: number, sy: number, sz: number, r: number, opts: BoxOpts = {}): (q: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3 {
  const pillow = opts.pillow ?? 0, sag = opts.sag ?? 0, taper = opts.taper ?? 0;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const ix = Math.max(1e-4, hx - r), iy = Math.max(1e-4, hy - r), iz = Math.max(1e-4, hz - r);
  const c = new THREE.Vector3(), d = new THREE.Vector3();
  return (q, out) => {
    c.set(Math.max(-ix, Math.min(ix, q.x)), Math.max(-iy, Math.min(iy, q.y)), Math.max(-iz, Math.min(iz, q.z)));
    d.subVectors(q, c);
    if (d.lengthSq() < 1e-12) d.set(0, 1, 0);
    d.normalize();
    out.copy(c).addScaledVector(d, r);
    // Padding: out along the way out, most at a face's middle, none on the rounded edges.
    const fx = 1 - (c.x / ix) ** 4, fy = 1 - (c.y / iy) ** 4, fz = 1 - (c.z / iz) ** 4;
    out.addScaledVector(d, pillow * (d.x * d.x * fy * fz + d.y * d.y * fx * fz + d.z * d.z * fx * fy));
    // The top sags in its middle; a taper narrows the top (a backpack).
    if (sag) out.y -= sag * fx * fz * Math.max(0, (out.y + hy) / sy) ** 2;
    if (taper) { const k = 1 - taper * ((out.y + hy) / sy); out.x *= k; out.z *= k; }
    out.y += hy;
    return out;
  };
}

/**
 * A rounded box sx x sy x sz (centred on x and z, its base on y = 0) with edges of radius r, its faces padded out by
 * `pillow` (m, at a face's middle) and its top sagging by `sag`: a bag, a cushion, a slat. `seg` grid steps a face.
 * Built on the box's own surface, each point moved to the rounded one (roundedBoxMap), normals from the surface
 * itself, so faces join without a seam.
 */
export function roundedBox(sx: number, sy: number, sz: number, r: number, opts: BoxOpts = {}): THREE.BufferGeometry {
  const seg = opts.seg ?? 14;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const at = roundedBoxMap(sx, sy, sz, r, opts);
  const parts: Part[] = [];
  const faces: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  ];
  const half = new THREE.Vector3(hx, hy, hz);
  const q = new THREE.Vector3(), q1 = new THREE.Vector3(), q2 = new THREE.Vector3(), q3 = new THREE.Vector3(), q4 = new THREE.Vector3();
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3(), pD = new THREE.Vector3();
  // Grid steps bunched towards a face's edges (where it turns).
  const bunch = (t: number): number => 0.5 - 0.5 * Math.cos(t * Math.PI);
  for (const [nf, ua, va] of faces) {
    const g = surface(seg, seg, false, (u, v, out) => {
      const su = bunch(u) * 2 - 1, sv = bunch(v) * 2 - 1;
      q.set(nf.x * half.x + (ua.x * su + va.x * sv) * half.x, nf.y * half.y + (ua.y * su + va.y * sv) * half.y, nf.z * half.z + (ua.z * su + va.z * sv) * half.z);
      at(q, out);
    });
    // Normals from the surface map (continuous across faces).
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
    const cols = seg + 1, e = 1e-3;
    for (let j = 0; j <= seg; j++) for (let i = 0; i < cols; i++) {
      const su = bunch(i / seg) * 2 - 1, sv = bunch(j / seg) * 2 - 1;
      const base = (x: number, y: number, o: THREE.Vector3): THREE.Vector3 =>
        o.set(nf.x * half.x + (ua.x * x + va.x * y) * half.x, nf.y * half.y + (ua.y * x + va.y * y) * half.y, nf.z * half.z + (ua.z * x + va.z * y) * half.z);
      at(base(su + e, sv, q1), pA); at(base(su - e, sv, q2), pB); at(base(su, sv + e, q3), pC); at(base(su, sv - e, q4), pD);
      const t1 = pA.sub(pB), t2 = pC.sub(pD);
      const nn = t1.cross(t2).normalize();
      // Outward: from the box's middle.
      at(base(su, sv, q), q1);
      if (nn.dot(q2.set(q1.x, q1.y - hy, q1.z)) < 0) nn.negate();
      nrm.setXYZ(j * cols + i, nn.x, nn.y, nn.z);
      void pos;
    }
    parts.push({ g, m: 0 });
  }
  const out = mergeParts(parts);
  out.clearGroups();
  return out;
}

/** A surface of revolution about y: profile points (radius, height), `segs` round. */
export function lathe(profile: Array<[number, number]>, segs = 24): THREE.BufferGeometry {
  return surface(segs, profile.length - 1, true, (u, v, q) => {
    const k = v * (profile.length - 1), i = Math.min(profile.length - 2, Math.floor(k)), t = k - i;
    const [r0, y0] = profile[i]!, [r1, y1] = profile[i + 1]!;
    const r = r0 + (r1 - r0) * t, y = y0 + (y1 - y0) * t, a = u * 2 * Math.PI;
    q.set(Math.sin(a) * r, y, Math.cos(a) * r);
  });
}

/** Give a geometry a flat vertex colour. */
export function paint(g: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  const c = new THREE.Color(colour), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
