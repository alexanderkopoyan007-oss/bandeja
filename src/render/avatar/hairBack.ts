// Long hair on the back as the body is posed. The capsules (kit.ts hairBody/hairPush) keep hair out of the upper back and the
// shoulders, and they bring hair thrown deep in back out the way it came; but a capsule is a radius per station at three
// angles round the back, a centimetre off the shirt in places, and hair resting on the back went in and out of the shirt
// there: in close views, black islands with hard edges where alpha to coverage cut the cards. This is the back itself: each
// frame the body's triangles over it are skinned on the CPU and drawn into a small height map seen from behind (`BackMap`),
// and the hair shader sets every strand that lies on the back at least BACK_CLEAR behind it.
//
// The map's frame is Spine2's joint with the model's axes (x across to the left, y up, z forward), carried by Spine2's
// skinning: the back is its smallest z. Only hair modelled over the back is set against it (a strand modelled over the top of
// a shoulder, dipping into it, belongs on top, not behind), and only within BACK_DEPTH of the surface (anything deeper is the
// capsules'). Hair as modelled never moves: no strand is set further behind the back than it was modelled.

import * as THREE from 'three/webgpu';
import { attribute, exp, float, max, min, smoothstep, step, texture, uniform, vec2, vec4 } from 'three/tsl';
import { modelledVertices, type PlayerAsset } from './asset.ts';

/** How far behind the back hair rests (m), and the depth over which it eases onto that (as kit.ts HAIR_CLEAR/SOFT): hair
 * inside goes to between CLEAR and CLEAR + SOFT behind it, the deepest least far, so the layers keep their order. */
const BACK_CLEAR = 0.003;
const BACK_SOFT = 0.01;
const BACK_SOFT_MIN = 0.002;
/** How deep inside the back (m) a strand is still set behind it, fading out from half of it: deeper is the capsules'. */
const BACK_DEPTH = 0.02;
/** The map's cell (m), how far past the body's outline (cells) the surface goes on, rounding away forward BACK_ROUND a cell
 * (so hair beside the body meets a rounded edge, not a cliff), and the height of the map above the neck's joint (m). */
const BACK_CELL = 0.01;
const BACK_GROW = 2;
const BACK_ROUND = 0.01;
const BACK_TOP = 0.12;
/** How far past the hair's own reach across (m) the map goes, for its swing. */
const BACK_SWING = 0.08;
/** A strand not modelled over the back; and a cell with no body (m, far in front: nothing is ever behind it). */
export const BACK_NONE = 1;
/** How far inside the back hair may have been modelled and still be set against it (m): deeper, it was modelled in the body. */
const BACK_MODELLED_IN = 0.02;

/** A number as a half float's bits (setup only). */
function halfOf(v: number): number {
  return THREE.DataUtils.toHalfFloat(v);
}

/** What a person's back is made of, from their asset (the same for every avatar of them). */
export interface BackBody {
  /** Spine2's bone, and its joint at rest (the map's origin). */
  bone: number; origin: THREE.Vector3;
  /** The map: its lower left cell's centre (m, in its frame), the cell, and how many across and up. */
  x0: number; y0: number; cell: number; nx: number; ny: number;
  /** The body's vertices over the back (ids into the asset's geometry), at rest in model space (xyz), their bones (slots into
   * `bones`, 4 each) and weights, and the triangles between them (indices into these). */
  verts: Uint32Array; rest: Float32Array; skin: Uint8Array; weight: Float32Array; tris: Uint32Array;
  /** The bones that skin them (the skeleton's indices). */
  bones: number[];
  /** The map at rest. */
  restDepth: Float32Array;
  /** Per hair vertex, how far behind the back at rest it was modelled (m), or BACK_NONE if not over the back. */
  hairClear: Float32Array;
}

const BODIES = new WeakMap<PlayerAsset, BackBody | null>();

/**
 * A person's back for their long hair (`hang`: kit.ts hairHang, null for hair that ends above the neck's base): the body over
 * it, from the lowest strand to above the neck's joint and either side, without the head (the hair is skinned to it and never
 * goes in) or the arms (they swing behind the back, and hair between is not behind them), and only what faces back at rest.
 */
export function backBody(asset: PlayerAsset, hang: { tip: THREE.Vector3 } | null): BackBody | null {
  const known = BODIES.get(asset);
  if (known !== undefined) return known;
  const g = asset.geometry, hairG = asset.look?.alphaGeometry;
  const bone = asset.bone('Spine2'), neckB = asset.bone('Neck'), head = asset.bone('Head');
  if (!hang || !hairG || bone < 0 || neckB < 0 || head < 0) { BODIES.set(asset, null); return null; }
  const origin = new THREE.Vector3().setFromMatrixPosition(asset.restWorld[bone]!);
  const neckY = new THREE.Vector3().setFromMatrixPosition(asset.restWorld[neckB]!).y;
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const on = modelledVertices(asset), arm = new Set(asset.bones.map((b, i) => (/Arm|Hand/.test(b.name) ? i : -1)).filter((i) => i >= 0));
  // (as far across as the hair below the neck reaches, and BACK_SWING more either side for its swing)
  const hp0 = hairG.getAttribute('position');
  let reach = 0;
  for (let v = 0; v < hp0.count; v++) if (hp0.getY(v) < neckY) reach = Math.max(reach, Math.abs(hp0.getX(v) - origin.x));
  const yLo = Math.min(hang.tip.y - 0.05, origin.y - 0.2), yHi = neckY + BACK_TOP, xHalf = Math.min(0.3, reach + BACK_SWING);
  const share = (i: number, of: (b: number) => boolean): number => {
    let w = 0;
    for (let c = 0; c < 4; c++) if (of(si.getComponent(i, c))) w += sw.getComponent(i, c);
    return w;
  };
  const keep = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - origin.x, y = pos.getY(i);
    if (!on[i] || y < yLo || y > yHi || Math.abs(x) > xHalf + BACK_CELL) continue;
    if (share(i, (b) => b === head) > 0.5 || share(i, (b) => arm.has(b)) > 0.5) continue;
    keep[i] = 1;
  }
  // (the triangles between them that don't face the front at rest, which is never the back; and only their vertices)
  const idx = g.index!, slot = new Int32Array(pos.count).fill(-1), verts: number[] = [], tris: number[] = [];
  for (let f = 0; f + 2 < idx.count; f += 3) {
    const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
    if (!keep[a] || !keep[b] || !keep[c] || nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c) > 0.9) continue;
    for (const v of [a, b, c]) if (slot[v]! < 0) { slot[v] = verts.length; verts.push(v); }
    tris.push(slot[a]!, slot[b]!, slot[c]!);
  }
  const bones: number[] = [], skin = new Uint8Array(verts.length * 4), weight = new Float32Array(verts.length * 4), rest = new Float32Array(verts.length * 3);
  verts.forEach((v, k) => {
    rest[k * 3] = pos.getX(v); rest[k * 3 + 1] = pos.getY(v); rest[k * 3 + 2] = pos.getZ(v);
    for (let c = 0; c < 4; c++) {
      const b = si.getComponent(v, c);
      let s = bones.indexOf(b);
      if (s < 0) { s = bones.length; bones.push(b); }
      skin[k * 4 + c] = s;
      weight[k * 4 + c] = sw.getComponent(v, c);
    }
  });
  const cell = BACK_CELL, x0 = -xHalf - cell, y0 = yLo - origin.y;
  const nx = Math.round((2 * xHalf) / cell) + 3, ny = Math.round((yHi - yLo) / cell) + 1;
  const body: BackBody = {
    bone, origin, x0, y0, cell, nx, ny, verts: Uint32Array.from(verts), rest, skin, weight, tris: Uint32Array.from(tris), bones,
    restDepth: new Float32Array(nx * ny), hairClear: new Float32Array(0),
  };
  // the map at rest: the vertices where they were modelled, into the map's frame (its origin)
  const at = new Float32Array(verts.length * 3);
  for (let k = 0; k < verts.length; k++) {
    at[k * 3] = rest[k * 3]! - origin.x; at[k * 3 + 1] = rest[k * 3 + 1]! - origin.y; at[k * 3 + 2] = rest[k * 3 + 2]! - origin.z;
  }
  drawBack(body, at, body.restDepth, new Float32Array(nx * ny));
  // how far behind it each strand was modelled
  const hp = hairG.getAttribute('position'), clear = new Float32Array(hp.count);
  for (let v = 0; v < hp.count; v++) {
    const x = hp.getX(v) - origin.x, y = hp.getY(v) - origin.y, z = hp.getZ(v) - origin.z;
    const zb = sampleBack(body, body.restDepth, x, y);
    clear[v] = zb >= BACK_NONE * 0.5 || zb - z < -BACK_MODELLED_IN ? BACK_NONE : zb - z;
  }
  body.hairClear = clear;
  BODIES.set(asset, body);
  return body;
}

/**
 * Draws the back into `depth` (nx * ny, row by row from the bottom): each cell the smallest z of the triangles over its centre,
 * with `at` the vertices in the map's frame (xyz per `verts`). Cells the body doesn't cover take the nearest covered one's,
 * BACK_ROUND further forward a cell, out to BACK_GROW cells; past that, BACK_NONE. `spare` is scratch of the same size.
 * Allocates nothing.
 */
export function drawBack(body: BackBody, at: Float32Array, depth: Float32Array, spare: Float32Array): void {
  const { x0, y0, cell, nx, ny, tris } = body;
  depth.fill(BACK_NONE);
  for (let f = 0; f < tris.length; f += 3) {
    const a = tris[f]! * 3, b = tris[f + 1]! * 3, c = tris[f + 2]! * 3;
    const ax = at[a]!, ay = at[a + 1]!, az = at[a + 2]!, bx = at[b]!, by = at[b + 1]!, bz = at[b + 2]!, cx = at[c]!, cy = at[c + 1]!, cz = at[c + 2]!;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (den > -1e-12 && den < 1e-12) continue;
    let lo = ax < bx ? ax : bx, hi = ax < bx ? bx : ax;
    if (cx < lo) lo = cx; else if (cx > hi) hi = cx;
    const i0 = Math.max(0, Math.ceil((lo - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((hi - x0) / cell));
    lo = ay < by ? ay : by; hi = ay < by ? by : ay;
    if (cy < lo) lo = cy; else if (cy > hi) hi = cy;
    const j0 = Math.max(0, Math.ceil((lo - y0) / cell)), j1 = Math.min(ny - 1, Math.floor((hi - y0) / cell));
    if (i0 > i1 || j0 > j1) continue;
    // (the barycentrics are linear in the cell: stepped across a row, not recomputed)
    const u1x = (by - cy) / den, u1y = (cx - bx) / den, u2x = (cy - ay) / den, u2y = (ax - cx) / den;
    const dz = (u1x * (az - cz) + u2x * (bz - cz)) * cell;
    for (let j = j0; j <= j1; j++) {
      const X = x0 + i0 * cell, Y = y0 + j * cell;
      let l1 = u1x * (X - cx) + u1y * (Y - cy), l2 = u2x * (X - cx) + u2y * (Y - cy);
      let z = l1 * az + l2 * bz + (1 - l1 - l2) * cz;
      const s1 = u1x * cell, s2 = u2x * cell;
      for (let i = i0, k = j * nx + i0; i <= i1; i++, k++) {
        if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6 && z < depth[k]!) depth[k] = z;
        l1 += s1; l2 += s2; z += dz;
      }
    }
  }
  for (let it = 0; it < BACK_GROW; it++) {
    spare.set(depth);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (spare[k]! < BACK_NONE) continue;
        let near = BACK_NONE;
        if (i > 0 && spare[k - 1]! < near) near = spare[k - 1]!;
        if (i < nx - 1 && spare[k + 1]! < near) near = spare[k + 1]!;
        if (j > 0 && spare[k - nx]! < near) near = spare[k - nx]!;
        if (j < ny - 1 && spare[k + nx]! < near) near = spare[k + nx]!;
        if (near < BACK_NONE) depth[k] = near + BACK_ROUND;
      }
    }
  }
  // (the edge is no body: a strand off the map, above it on the head or past the shoulders, is never set against its edge)
  for (let i = 0; i < nx; i++) { depth[i] = BACK_NONE; depth[(ny - 1) * nx + i] = BACK_NONE; }
  for (let j = 0; j < ny; j++) { depth[j * nx] = BACK_NONE; depth[j * nx + nx - 1] = BACK_NONE; }
}

/** The back's z under (x, y) in the map's frame, a straight line between cell centres either way (as the texture's filter). */
export function sampleBack(body: BackBody, depth: Float32Array, x: number, y: number): number {
  const u = THREE.MathUtils.clamp((x - body.x0) / body.cell, 0, body.nx - 1), v = THREE.MathUtils.clamp((y - body.y0) / body.cell, 0, body.ny - 1);
  const i = Math.min(body.nx - 2, Math.floor(u)), j = Math.min(body.ny - 2, Math.floor(v)), fu = u - i, fv = v - j, n = body.nx;
  const a = depth[j * n + i]!, b = depth[j * n + i + 1]!, c = depth[(j + 1) * n + i]!, d = depth[(j + 1) * n + i + 1]!;
  return (1 - fv) * ((1 - fu) * a + fu * b) + fv * ((1 - fu) * c + fu * d);
}

/**
 * How far (m) a strand modelled `clear` behind the back (`BackBody.hairClear`), now `out` behind it (negative: inside), is set
 * further back: onto BACK_CLEAR behind it, or where it was modelled if that was nearer, easing in so the layers keep their
 * order; nothing for a strand not over the back, or deeper than BACK_DEPTH (the capsules').
 */
export function backPush(clear: number, out: number): number {
  if (clear >= BACK_NONE * 0.5) return 0;
  const target = Math.min(BACK_CLEAR, clear - BACK_SOFT_MIN);
  const soft = THREE.MathUtils.clamp(clear - target, BACK_SOFT_MIN, BACK_SOFT);
  const to = Math.max(out, target + Math.exp(Math.min(out - target - soft, 0) / soft) * soft);
  const u = THREE.MathUtils.clamp((out + BACK_DEPTH) / (BACK_DEPTH / 2), 0, 1);
  return (to - out) * u * u * (3 - 2 * u);
}

/**
 * The hair shader's part (kit.ts, after hairPush): `p` (a strand, skinned, in the mesh's frame) set behind the back as it is
 * posed this frame. The map is drawn once a frame, before the first draw that needs it (the shadow pass or the view's), from
 * the bones as three has them then.
 */
export function hairOnBack(body: BackBody, p: THREE.Node<'vec3'>, hairGeometry: THREE.BufferGeometry, owns?: THREE.Texture[]): THREE.Node<'vec3'> {
  if (!hairGeometry.hasAttribute('hairBack')) hairGeometry.setAttribute('hairBack', new THREE.BufferAttribute(body.hairClear, 1));
  const { nx, ny, cell, x0, y0 } = body;
  const half = new Uint16Array(nx * ny).fill(halfOf(BACK_NONE));
  const map = new THREE.DataTexture(half, nx, ny, THREE.RedFormat, THREE.HalfFloatType);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  // (each avatar's own, used only inside the node: its material frees it, render/dispose.ts)
  owns?.push(map);
  const toMap = uniform(new THREE.Matrix4()), backDir = uniform(new THREE.Vector3(0, 0, -1));
  const depth = new Float32Array(nx * ny), spare = new Float32Array(nx * ny), at = new Float32Array(body.verts.length * 3);
  const S = new Float32Array(body.bones.length * 16);
  const m = new THREE.Matrix4(), frameM = new THREE.Matrix4(), skinM = new THREE.Matrix4();
  const originM = new THREE.Matrix4().makeTranslation(body.origin.x, body.origin.y, body.origin.z);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  let drawn = -1;
  toMap.onObjectUpdate((frame) => {
    const mesh = frame.object as THREE.SkinnedMesh, sk = mesh.skeleton;
    if (frame.frameId === drawn) return;
    drawn = frame.frameId;
    // each bone's skinning in the mesh's frame, and the map's frame (Spine2's joint, carried by Spine2's skinning)
    for (let s = 0; s < body.bones.length; s++) {
      const b = body.bones[s]!;
      m.multiplyMatrices(sk.bones[b]!.matrixWorld, sk.boneInverses[b]!);
      skinM.multiplyMatrices(mesh.bindMatrixInverse, m).multiply(mesh.bindMatrix);
      S.set(skinM.elements, s * 16);
    }
    m.multiplyMatrices(sk.bones[body.bone]!.matrixWorld, sk.boneInverses[body.bone]!);
    frameM.multiplyMatrices(mesh.bindMatrixInverse, m).multiply(mesh.bindMatrix);
    frameM.multiply(originM);
    const tm = (toMap.value as THREE.Matrix4).copy(frameM).invert(), t = tm.elements;
    const e = frameM.elements, dir = backDir.value as THREE.Vector3;
    dir.x = -e[8]!; dir.y = -e[9]!; dir.z = -e[10]!;
    // the body over the back where the skeleton has it now, into the map's frame
    const { rest, skin, weight } = body;
    for (let k = 0; k < body.verts.length; k++) {
      const rx = rest[k * 3]!, ry = rest[k * 3 + 1]!, rz = rest[k * 3 + 2]!;
      let x = 0, y = 0, z = 0;
      for (let c = 0; c < 4; c++) {
        const w = weight[k * 4 + c]!;
        if (w === 0) continue;
        const o = skin[k * 4 + c]! * 16;
        x += w * (S[o]! * rx + S[o + 4]! * ry + S[o + 8]! * rz + S[o + 12]!);
        y += w * (S[o + 1]! * rx + S[o + 5]! * ry + S[o + 9]! * rz + S[o + 13]!);
        z += w * (S[o + 2]! * rx + S[o + 6]! * ry + S[o + 10]! * rz + S[o + 14]!);
      }
      at[k * 3] = t[0]! * x + t[4]! * y + t[8]! * z + t[12]!;
      at[k * 3 + 1] = t[1]! * x + t[5]! * y + t[9]! * z + t[13]!;
      at[k * 3 + 2] = t[2]! * x + t[6]! * y + t[10]! * z + t[14]!;
    }
    drawBack(body, at, depth, spare);
    // (to half floats in place: three's DataUtils.toHalfFloat, called per cell, could box each double)
    for (let k = 0; k < depth.length; k++) {
      f32[0] = depth[k]!;
      const x = u32[0]!, e2 = ((x >>> 23) & 0xff) - 112;
      half[k] = ((x >>> 16) & 0x8000) | (e2 <= 0 ? 0 : e2 >= 31 ? 0x7c00 : (e2 << 10) | ((x >>> 13) & 0x3ff));
    }
    map.needsUpdate = true;
  });
  const clear = attribute<'float'>('hairBack', 'float');
  const q = toMap.mul(vec4(p, 1)).xyz;
  const zb = texture(map, vec2(q.x.sub(x0).div(cell).add(0.5).div(nx), q.y.sub(y0).div(cell).add(0.5).div(ny))).level(float(0)).r;
  const out = zb.sub(q.z);
  const target = min(float(BACK_CLEAR), clear.sub(BACK_SOFT_MIN));
  const soft = clear.sub(target).clamp(BACK_SOFT_MIN, BACK_SOFT);
  const to = max(out, target.add(exp(min(out.sub(target).sub(soft), 0).div(soft)).mul(soft)));
  const on = step(clear, float(BACK_NONE * 0.5)).mul(smoothstep(-BACK_DEPTH, -BACK_DEPTH / 2, out));
  return p.add(backDir.mul(to.sub(out).mul(on)));
}
