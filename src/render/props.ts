// What lies courtside, made in code (M5 phase C): the players' bags (data/cosmetics.json `bag` slot), their water
// bottles and the benches they sit on. Shaped as the real things are (padded panels, piping, zips, webbing handles, a
// shoulder strap lying on the bench; slatted or padded seats on tube frames) and dressed in the woven materials of
// avatar/clothTex.ts. Nothing per frame: built once with the arena and the cast.
import * as THREE from 'three/webgpu';
import { lathe, mergeParts, roundedBox, roundedBoxMap, tube, type BoxOpts, type Part } from './geom.ts';
import { fabric, metal, plastic, woodMaterial } from './avatar/clothTex.ts';

/** The bag ids drawn here; a player wearing none brings the holdall. */
export const BAGS = ['bag-holdall', 'bag-thermo', 'bag-backpack', 'bag-tour'] as const;

/** A bag's material slots. */
const B = { body: 0, accent: 1, trim: 2, metal: 3, base: 4 } as const;

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** A path through points (a smooth curve). */
function through(points: THREE.Vector3[]): (t: number, out: THREE.Vector3) => void {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return (t, out) => { c.getPoint(Math.min(1, Math.max(0, t)), out); };
}

/** The up for a strap's tube so its flat lies across the arch's plane (z): perpendicular to the path in x-y. */
function archUp(path: (t: number, out: THREE.Vector3) => void): (t: number, out: THREE.Vector3) => void {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  return (t, out) => {
    path(Math.max(0, t - 0.01), a);
    path(Math.min(1, t + 0.01), b);
    b.sub(a);
    out.set(-b.y, b.x, 0).normalize();
    if (out.lengthSq() < 0.5) out.set(0, 1, 0);
  };
}

/**
 * A padded bag body (rounded box), coloured by region: `region(x, y, z)` picks a slot (body, accent or base) for each
 * vertex, and the slots come out as their own parts.
 */
function body(sx: number, sy: number, sz: number, r: number, o: BoxOpts, region: (x: number, y: number, z: number) => number): Part[] {
  const g = roundedBox(sx, sy, sz, r, { seg: 20, ...o });
  const pos = g.getAttribute('position'), idx = g.index!.array;
  const by = new Map<number, number[]>();
  for (let k = 0; k < idx.length; k += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let m = 0; m < 3; m++) { cx += pos.getX(idx[k + m]!); cy += pos.getY(idx[k + m]!); cz += pos.getZ(idx[k + m]!); }
    const slot = region(cx / 3, cy / 3, cz / 3);
    if (!by.has(slot)) by.set(slot, []);
    by.get(slot)!.push(idx[k]!, idx[k + 1]!, idx[k + 2]!);
  }
  const parts: Part[] = [];
  for (const [slot, tris] of by) {
    const c = g.clone();
    c.setIndex(tris);
    parts.push({ g: c, m: slot });
  }
  g.dispose();
  return parts;
}

/** Piping round a bag at x (the seam of an end panel or a colour line), standing 1.5 mm proud. */
function pipingRing(sx: number, sy: number, sz: number, r: number, o: BoxOpts, x: number, y0 = -Infinity): THREE.BufferGeometry {
  const map = roundedBoxMap(sx, sy, sz, r, o);
  const q = new THREE.Vector3(), mid = new THREE.Vector3();
  const per = 2 * (sy + sz);
  const path = (t: number, out: THREE.Vector3): void => {
    // Round the box's y-z rectangle at x, from the bottom middle.
    let d = t * per;
    const hy = sy / 2, hz = sz / 2;
    if (d < hz) q.set(x, -hy, d);
    else if ((d -= hz) < sy) q.set(x, -hy + d, hz);
    else if ((d -= sy) < sz) q.set(x, hy, hz - d);
    else if ((d -= sz) < sy) q.set(x, hy - d, -hz);
    else { d -= sy; q.set(x, -hy, -hz + d); }
    map(q, out);
    mid.set(x, sy / 2, 0);
    out.addScaledVector(mid.subVectors(out, mid).setX(0).normalize(), 0.0015);
    if (out.y < y0) out.y = y0;
  };
  return tube(path, 0.006, 0.006, { n: 120, around: 8, up: v3(1, 0, 0) });
}

/** A zip track along the top from x0 to x1 (z = 0), and its puller at `pull`. */
function zip(sx: number, sy: number, sz: number, r: number, o: BoxOpts, x0: number, x1: number, pull: number): Part[] {
  const map = roundedBoxMap(sx, sy, sz, r, o);
  const q = new THREE.Vector3();
  const path = (t: number, out: THREE.Vector3): void => { map(q.set(x0 + (x1 - x0) * t, sy / 2, 0), out); out.y += 0.0012; };
  const track = tube(path, 0.011, 0.0026, { n: 60, around: 8, power: 4, up: v3(0, 1, 0) });
  const at = new THREE.Vector3();
  path(pull, at);
  const tab = roundedBox(0.012, 0.003, 0.022, 0.0012, { seg: 4 });
  tab.translate(at.x, at.y + 0.0005, at.z + 0.006);
  const cord = tube(through([v3(at.x, at.y + 0.002, at.z + 0.016), v3(at.x + 0.004, at.y + 0.004, at.z + 0.035), v3(at.x + 0.002, at.y - 0.01, at.z + 0.05)]), 0.004, 0.004, { n: 10, around: 6, caps: true });
  return [{ g: track, m: B.trim }, { g: tab, m: B.metal }, { g: cord, m: B.trim }];
}

/** Two webbing carry handles, one arching up from each long side to meet over the top in a padded wrap. */
function handles(sy: number, sz: number, span: number, rise: number): Part[] {
  const parts: Part[] = [];
  for (const s of [-1, 1]) {
    const z = s * (sz / 2 + 0.002);
    const path = through([v3(-span, sy - 0.08, z), v3(-span * 0.95, sy - 0.01, z * 0.9), v3(-span * 0.5, sy + rise, s * 0.02), v3(span * 0.5, sy + rise, s * 0.02), v3(span * 0.95, sy - 0.01, z * 0.9), v3(span, sy - 0.08, z)]);
    parts.push({ g: tube(path, 0.03, 0.0032, { n: 48, around: 8, power: 5, up: archUp(path) }), m: B.trim });
    // The stitched patches where it's sewn on.
    for (const x of [-span, span]) {
      const p = roundedBox(0.04, 0.05, 0.003, 0.001, { seg: 3 });
      p.translate(x, sy - 0.105, z + s * 0.0005);
      parts.push({ g: p, m: B.trim });
    }
  }
  const wrap = roundedBox(0.13, 0.03, 0.05, 0.013, { seg: 8, pillow: 0.002 });
  wrap.translate(0, sy + rise - 0.014, 0);
  parts.push({ g: wrap, m: B.accent });
  return parts;
}

/**
 * The shoulder strap: clipped to both ends, fallen over the top of the bag and a little way down its front, as it lies
 * when the bag is put down. `top(x, z)`: the bag's top surface height there.
 */
function shoulderStrap(sx: number, sy: number, sz: number, top: (x: number, z: number) => number): Part[] {
  const hx = sx / 2;
  const pts: THREE.Vector3[] = [v3(-hx - 0.006, sy - 0.075, 0), v3(-hx + 0.005, sy - 0.02, 0.02)];
  for (let k = 0; k <= 8; k++) {
    const x = -hx + 0.06 + (k / 8) * (sx - 0.12);
    // Over the top towards the front, its middle slipping onto the front's shoulder.
    const z = sz * (0.12 + 0.3 * Math.sin((k / 8) * Math.PI));
    pts.push(v3(x, top(x, z) + 0.003, z));
  }
  pts.push(v3(hx - 0.005, sy - 0.02, 0.02), v3(hx + 0.006, sy - 0.075, 0));
  const path = through(pts);
  const parts: Part[] = [{ g: tube(path, 0.036, 0.0035, { n: 90, around: 8, power: 5, up: v3(0, 1, 0) }), m: B.trim }];
  const mid = new THREE.Vector3();
  path(0.5, mid);
  const pad = roundedBox(0.2, 0.012, 0.06, 0.006, { seg: 6, pillow: 0.002 });
  pad.translate(mid.x, mid.y - 0.004, mid.z);
  parts.push({ g: pad, m: B.accent });
  for (const s of [-1, 1]) {
    const clip = roundedBox(0.012, 0.03, 0.026, 0.004, { seg: 4 });
    clip.translate(s * (hx + 0.008), sy - 0.085, 0);
    parts.push({ g: clip, m: B.metal });
  }
  return parts;
}

/**
 * A bag lying along x (its base on y = 0, centred) in the player's colours: `main` the body, `accent` the panels and
 * handle wrap; webbing, piping and zips dark, a rubberised base.
 */
/** Each kind of bag's shape, made once: four players carry one each, mostly the same kind (a quarter of a second of a
 * slow laptop's build per bag). Freed with a game like any geometry; three uploads it again for the next. */
const BAG_SHAPES = new Map<string, THREE.BufferGeometry>();

export function makeBag(id: string, main: number, accent: number): THREE.Mesh {
  let shape = BAG_SHAPES.get(id);
  if (!shape) BAG_SHAPES.set(id, (shape = bagShape(id)));
  const mats: THREE.Material[] = [];
  mats[B.body] = fabric('ripstop', main);
  mats[B.accent] = fabric('ripstop', accent);
  mats[B.trim] = fabric('webbing', 0x1d1e21);
  mats[B.metal] = metal(0xa9adb4, 0.38);
  mats[B.base] = fabric('grain', 0x151618);
  const m = new THREE.Mesh(shape, mats);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = 'bag';
  return m;
}

function bagShape(id: string): THREE.BufferGeometry {
  const parts: Part[] = [];
  let sx: number, sy: number, sz: number, r: number, o: BoxOpts;
  if (id === 'bag-backpack') {
    // Upright: tapered, a padded back panel (-z), a front pocket, two shoulder straps on the back, a grab loop.
    sx = 0.3; sy = 0.46; sz = 0.17; r = 0.06; o = { pillow: 0.012, taper: 0.14 };
    parts.push(...body(sx, sy, sz, r, o, (_x, y, z) => (z < -sz / 2 + 0.035 || y < 0.03 ? B.base : B.body)));
    const pocket = roundedBox(0.23, 0.2, 0.07, 0.035, { seg: 12, pillow: 0.006 });
    pocket.translate(0, 0.05, sz / 2 - 0.025);
    parts.push({ g: pocket, m: B.accent });
    parts.push({ g: tube(through([v3(-0.1, 0.235, sz / 2 + 0.012), v3(0, 0.255, sz / 2 + 0.014), v3(0.1, 0.235, sz / 2 + 0.012)]), 0.009, 0.0025, { n: 24, around: 6, power: 4, up: v3(0, 0, 1) }), m: B.trim });
    for (const s of [-1, 1]) {
      const strap = through([v3(s * 0.05, 0.42, -sz / 2 - 0.004), v3(s * 0.08, 0.36, -sz / 2 - 0.03), v3(s * 0.1, 0.22, -sz / 2 - 0.035), v3(s * 0.11, 0.1, -sz / 2 - 0.02), v3(s * 0.12, 0.04, -sz / 2 - 0.004)]);
      parts.push({ g: tube(strap, 0.058, 0.013, { n: 30, around: 10, power: 4, up: v3(0, 0, -1), caps: true }), m: B.base });
    }
    const loop = through([v3(-0.035, sy * 0.985, -0.03), v3(0, sy + 0.04, -0.035), v3(0.035, sy * 0.985, -0.03)]);
    parts.push({ g: tube(loop, 0.022, 0.003, { n: 20, around: 6, power: 5, up: archUp(loop) }), m: B.trim });
  } else {
    const tour = id === 'bag-tour', thermo = id === 'bag-thermo';
    if (tour) { sx = 0.8; sy = 0.36; sz = 0.33; r = 0.065; o = { pillow: 0.014, sag: 0.012 }; }
    else if (thermo) { sx = 0.72; sy = 0.33; sz = 0.29; r = 0.07; o = { pillow: 0.012, sag: 0.01 }; }
    else { sx = 0.54; sy = 0.29; sz = 0.27; r = 0.11; o = { pillow: 0.016, sag: 0.016 }; }
    const ends = thermo ? sx / 2 - 0.13 : sx / 2 - 0.035;
    const split = tour ? sy * 0.42 : -1;
    parts.push(...body(sx, sy, sz, r, o, (x, y) => (y < 0.028 ? B.base : Math.abs(x) > ends ? B.accent : y < split ? B.accent : B.body)));
    // Piping round the end panels (and a racket bag's thermal compartments), and along a tour bag's colour line.
    for (const s of [-1, 1]) parts.push({ g: pipingRing(sx, sy, sz, r, o, s * ends), m: B.trim });
    if (thermo) for (const s of [-1, 1]) parts.push({ g: pipingRing(sx, sy, sz, r, o, s * (sx / 2 - 0.035)), m: B.trim });
    parts.push(...zip(sx, sy, sz, r, o, -ends + 0.02, ends - 0.02, 0.62));
    if (thermo) for (const s of [-1, 1]) parts.push(...zip(sx, sy, sz, r, o, s * (ends + 0.02), s * (sx / 2 - 0.05), 0.5));
    parts.push(...handles(sy - (o.sag ?? 0) * 0.6, sz, tour ? 0.17 : 0.13, tour ? 0.1 : 0.085));
    // The top's height at (x, z), off the body's own surface (the top face's point there, padded and sagging).
    const map = roundedBoxMap(sx, sy, sz, r, o), q = new THREE.Vector3(), out = new THREE.Vector3();
    const topAt = (x: number, z: number): number => map(q.set(x, sy / 2, z), out).y;
    parts.push(...shoulderStrap(sx, sy, sz, topAt));
  }
  return mergeParts(parts);
}

/** A squeeze bottle with a push-pull cap, standing on the floor by the bench. */
export function makeBottle(colour: number): THREE.Mesh {
  const bodyG = lathe([[0, 0], [0.034, 0.002], [0.037, 0.012], [0.036, 0.09], [0.033, 0.11], [0.036, 0.13], [0.036, 0.19], [0.031, 0.21], [0.022, 0.222], [0.02, 0.228]], 28);
  const cap = lathe([[0.02, 0.226], [0.022, 0.229], [0.022, 0.25], [0.012, 0.254], [0.008, 0.268], [0.006, 0.272], [0, 0.272]], 20);
  const g = mergeParts([{ g: bodyG, m: 0 }, { g: cap, m: 1 }]);
  const m = new THREE.Mesh(g, [plastic(colour, 0.35), plastic(0x1c1d20, 0.5)]);
  m.castShadow = true;
  m.name = 'bottle';
  return m;
}

/**
 * A courtside bench, its seat's top at `top` m, `length` long along z, centred on x = 0: a club's or a hall's slatted
 * wooden seat on powder-coated tube frames, or the stadium's padded vinyl seat and backrest on a chrome frame (its
 * back to -x, away from the court).
 */
export function makeBench(kind: 'stadium' | 'club', top: number, length: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bench';
  const frameParts: Part[] = [];
  const legsAt = kind === 'stadium' ? [-length / 2 + 0.15, 0, length / 2 - 0.15] : [-length / 2 + 0.2, length / 2 - 0.2];
  const seatD = kind === 'stadium' ? 0.46 : 0.4;
  const seatT = kind === 'stadium' ? 0.075 : 0.03;
  const rail = top - seatT;
  for (const z of legsAt) {
    // An upturned U of round tube under the seat, its feet on the floor, a cross-rail low down.
    const leg = through([v3(-seatD / 2 + 0.03, 0.01, z), v3(-seatD / 2 + 0.035, rail - 0.04, z), v3(-seatD / 2 + 0.07, rail - 0.006, z), v3(seatD / 2 - 0.07, rail - 0.006, z), v3(seatD / 2 - 0.035, rail - 0.04, z), v3(seatD / 2 - 0.03, 0.01, z)]);
    frameParts.push({ g: tube(leg, 0.03, 0.03, { n: 48, around: 12 }), m: 0 });
    frameParts.push({ g: tube((t, q) => q.set(-seatD / 2 + 0.035 + t * (seatD - 0.07), 0.12, z), 0.02, 0.02, { n: 4, around: 10 }), m: 0 });
    for (const s of [-1, 1]) {
      const foot = lathe([[0, 0], [0.019, 0], [0.019, 0.014], [0, 0.016]], 14);
      foot.translate(s * (seatD / 2 - 0.03), 0, z);
      frameParts.push({ g: foot, m: 1 });
    }
  }
  // A stretcher along the bench between the legs.
  frameParts.push({ g: tube((t, q) => q.set(0, 0.12, legsAt[0]! + t * (legsAt[legsAt.length - 1]! - legsAt[0]!)), 0.02, 0.02, { n: 4, around: 10 }), m: 0 });
  if (kind === 'stadium') {
    // Uprights for the backrest at its back.
    for (const z of legsAt) frameParts.push({ g: tube(through([v3(-seatD / 2 + 0.035, rail - 0.04, z), v3(-seatD / 2 - 0.0, top + 0.12, z), v3(-seatD / 2 - 0.04, top + 0.42, z)]), 0.026, 0.026, { n: 20, around: 10 }), m: 0 });
  }
  const frame = new THREE.Mesh(mergeParts(frameParts), [kind === 'stadium' ? metal(0xd5d8dd, 0.22) : metal(0x3d4047, 0.55), plastic(0x18191b, 0.8)]);
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);
  if (kind === 'stadium') {
    const vinyl = fabric('grain', 0x1e2128);
    const seat = new THREE.Mesh(roundedBox(seatD, seatT, length, 0.028, { seg: 12, pillow: 0.01 }), vinyl);
    seat.position.y = top - seatT;
    const back = new THREE.Mesh(roundedBox(0.07, 0.34, length, 0.03, { seg: 12, pillow: 0.012 }), vinyl);
    back.position.set(-seatD / 2 - 0.03, top + 0.1, 0);
    back.rotation.z = 0.12;
    for (const m of [seat, back]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  } else {
    // Four slats, rounded, with gaps.
    const wood = woodMaterial();
    const n = 4, w = (seatD - 0.03) / n;
    const slats: Part[] = [];
    for (let k = 0; k < n; k++) {
      const s = roundedBox(w - 0.012, seatT, length, 0.008, { seg: 6 });
      s.translate(-seatD / 2 + 0.015 + w * (k + 0.5), top - seatT, 0);
      slats.push({ g: s, m: 0 });
    }
    const slatG = mergeParts(slats);
    slatG.clearGroups();
    const sm = new THREE.Mesh(slatG, wood);
    sm.castShadow = true;
    sm.receiveShadow = true;
    g.add(sm);
  }
  return g;
}
