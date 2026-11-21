// The cage's wire mesh in the sun, drawn on the floor exactly (owner, 21 Nov: "do the mesh shadow"). The shadow map can't
// carry it: a 4.5 cm diamond of 2.8 mm wire is a few texels of even a 2048 map fitted to the court, so the cut-out shadow
// (courtView.ts, before this) only ever showed as the mesh's average shade. Here each floor point looks along its own ray
// to the sun, finds where that ray crosses each of the four walls, asks whether there is mesh there (a strip per wall of
// each place's mesh from y0 to y1, `panelStrip`) and how much of the sun the wires in front of it hide.
// - The wires are the fence's own (courtView.ts wireMaterial: the diamond of `cell` laid on the wall's (u, y), the same
//   phase), so a wire's shadow meets the wire where the mesh comes down to the floor.
// - The sun is a disc 0.53 degrees across: what the floor sees through the mesh is the wires blurred by that disc at the
//   ray's distance to the wall. Next to a panel that reaches the floor the grid is sharp; a metre or two out it softens,
//   and the 3-4 m strips over the glass, 6 m and more from the floor they fall on in this sun, give only their average
//   (17% of the light: the wire at the width the fence draws it, which the shadow has to meet), as on a real court.
//   Each wire family is the exact box average of its lines over the blur and the pixel's own footprint together
//   (`lineCover`), so there is no moire and no grey fallback to fade to.
// - It goes into the floor's received shadow (`receivedShadowNode`), so it darkens the sun's light only, and only where
//   the shadow map has not already put the floor in shade; Arena.shade puts it on the arena's other receivers (leaves,
//   benches, trees, the bags).
import * as THREE from 'three/webgpu';
import { float, floor, fract, fwidth, max, min, positionWorld, saturate, sqrt, texture, vec2, vec3 } from 'three/tsl';
import { SURF_MESH, WALL_BACK_FAR, WALL_BACK_NEAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, type Court } from '../sim/court/court.ts';

type F = THREE.Node<'float'>;

/** The sun's angular radius (0.53 degrees across). */
const SUN_R = 0.00463;
/** Texels along each wall in `panelStrip` (about 1 cm on a side wall). */
const STRIP = 2048;
/** Heights are stored in bytes at 2 cm (y x 50: 0-4 m in 0-200; 255 = no mesh). */
const Y_SCALE = 50;

/**
 * Each wall's mesh along its length: R = bottom, G = top of the mesh at that place (bytes, y x Y_SCALE), a row per wall
 * (WALL_* order). Nowhere is there more than one band of mesh above a place (the courts' panels: glass under mesh, or a
 * door under mesh).
 */
export function panelStrip(court: Court): THREE.DataTexture {
  const data = new Uint8Array(STRIP * 4 * 4);
  for (let w = 0; w < 4; w++) {
    const range = w === WALL_BACK_NEAR || w === WALL_BACK_FAR ? court.halfW : court.halfL;
    for (let i = 0; i < STRIP; i++) {
      const u = -range + ((i + 0.5) / STRIP) * 2 * range;
      const o = (w * STRIP + i) * 4;
      data[o] = 255; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
      for (const p of court.panels) {
        if (p.wall !== w || p.kind !== SURF_MESH || u < p.u0 || u >= p.u1) continue;
        data[o] = Math.round(p.y0 * Y_SCALE); data[o + 1] = Math.round(p.y1 * Y_SCALE);
      }
    }
  }
  const t = new THREE.DataTexture(data, STRIP, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Lines of half-width `a` at every integer: the share of [x - b, x + b] they cover (exact, any b). */
function lineCover(x: F, b: F, a: number): F {
  const cum = (s: F): F => {
    const f = fract(s);
    return floor(s).mul(2 * a).add(min(f, float(a))).add(max(f.sub(1 - a), float(0)));
  };
  return cum(x.add(b)).sub(cum(x.sub(b))).div(b.mul(2));
}

export interface MeshShade {
  /** For the floor's material: `receivedShadowNode`. */
  received: (shadow: THREE.Node) => THREE.Node;
  /** The strip texture (the floor materials read it through a node: free it with the arena). */
  strip: THREE.DataTexture;
}

/**
 * The light the cage's mesh lets through to a floor point from the sun at `sunDir` (towards the sun), as a factor on the
 * floor's received shadow. `cell` and `wire` are the fence's (courtView.ts).
 */
export function meshShade(court: Court, sunDir: readonly number[], cell: number, wire: number): MeshShade {
  const strip = panelStrip(court);
  const L = new THREE.Vector3().fromArray(sunDir).normalize();
  const a = (wire / cell) * 1.41421356 * 0.5;
  const P = positionWorld;
  let lit: F = float(1);
  const walls = [
    { w: WALL_BACK_NEAR, axis: 'z', at: court.halfL, range: court.halfW },
    { w: WALL_BACK_FAR, axis: 'z', at: -court.halfL, range: court.halfW },
    { w: WALL_SIDE_LEFT, axis: 'x', at: -court.halfW, range: court.halfL },
    { w: WALL_SIDE_RIGHT, axis: 'x', at: court.halfW, range: court.halfL },
  ] as const;
  for (const wall of walls) {
    const ln = wall.axis === 'z' ? L.z : L.x;
    if (Math.abs(ln) < 1e-3) continue;
    // Along the ray to the sun to the wall's plane; where it crosses (u along the wall, y up).
    const t = float(wall.at).sub(wall.axis === 'z' ? P.z : P.x).div(ln);
    const hit = P.add(vec3(L.x, L.y, L.z).mul(t));
    const u = wall.axis === 'z' ? hit.x : hit.z;
    const y = hit.y;
    const band = texture(strip, vec2(u.div(2 * wall.range).add(0.5), (wall.w + 0.5) / 4));
    const y0 = band.r.mul(255 / Y_SCALE), y1 = band.g.mul(255 / Y_SCALE);
    // The fence's diamond (wireMaterial: uv = (u, y) / cell turned 45 degrees).
    const p = vec2(u, y).div(cell);
    const q = vec2(p.x.add(p.y), p.x.sub(p.y)).mul(0.70710678);
    // The sun's disc where the ray meets the wall, stretched by the slant (in cells), with the pixel's footprint.
    const sun = t.mul(SUN_R / Math.sqrt(Math.abs(ln)) / cell);
    const fw = fwidth(q).mul(0.5);
    const bx = sqrt(fw.x.mul(fw.x).add(sun.mul(sun))).max(1e-4);
    const by = sqrt(fw.y.mul(fw.y).add(sun.mul(sun))).max(1e-4);
    const through = float(1).sub(lineCover(q.x, bx, a)).mul(float(1).sub(lineCover(q.y, by, a)));
    // Only where the ray meets the wall ahead, within its length and inside the band (its edges softened as the wires').
    const soft = sun.mul(cell).add(0.004);
    const inBand = saturate(y.sub(y0).div(soft).add(0.5)).mul(saturate(y1.sub(y).div(soft).add(0.5)));
    const onWall = t.greaterThan(0).and(u.abs().lessThan(wall.range));
    const stop = onWall.select(inBand.mul(float(1).sub(through)), float(0));
    lit = lit.mul(float(1).sub(stop));
  }
  const litNode = lit;
  return { received: (shadow) => (shadow as F).mul(litNode), strip };
}

/** The fence's welded mesh (courtView.ts): rhomboid holes about 6 cm across the diagonal (FIP: 5-7.08 cm), 2.8 mm wire. */
export const FENCE_CELL = 0.045, FENCE_WIRE = 0.0028;
