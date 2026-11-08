// Dressing the body (Phase 5): the one mannequin mesh becomes a padel player in the shader. Each vertex gets a
// region from the bone that moves it most and where it sits on that bone in the bind pose (a short-sleeved shirt
// to mid upper arm and over the hips, shorts to mid thigh, socks over the ankles, shoes, a hair cap on the crown
// and the back of the head, skin elsewhere). Fabric has folds (a bump pattern fixed to the body, so it moves with
// it), wet patches that grow over a match where players sweat first (chest, the spine, under the arms), and skin
// turns shinier as it sweats. Shirt and shorts hems lag the body when it accelerates.
import * as THREE from 'three/webgpu';
import {
  vec2, step, sin, cos, asin, cross, select,
  attribute, positionGeometry, positionLocal, uniform, vec3, vec4, float, mix, smoothstep, color,
  mx_noise_float, texture, uv, max, min, dot, exp, normalView, normalWorld, normalLocal, normalGeometry, diffuseColor, frontFacing, faceDirection, positionViewDirection,
} from 'three/tsl';
import { heightBump, footprintKeep, uvNormal } from '../bump.ts';
import { modelledVertices, type KitCut, type PlayerAsset } from './asset.ts';
import { backBody, hairOnBack } from './hairBack.ts';
import { armWeight, cutFor, patternAt, printBottom, printShirt, type Paint } from './paint.ts';
import { FACE_T2, HANDLE_R, HANDLE_TOP, PROFILE_E, RACKET_BUTT, RACKET_TIP, RC, RC_H } from './racket.ts';

export const R_SHIRT = 0, R_SHORTS = 1, R_SKIN = 2, R_HAIR = 3, R_SOCK = 4, R_SHOE = 5;

export interface KitLook {
  shirt: number;
  /** A second shirt colour across the shoulders and down the sides (most kits have panels). */
  trim: number;
  shorts: number;
  socks: number;
  shoes: number;
  skin: number;
  hair: number;
}

const REGIONS = new WeakMap<PlayerAsset, Float32Array>();

/** Bind-pose landmarks the shader's masks are placed by (metres, model space; the model faces +z). */
/**
 * The hems' lag as a displacement: the part of it that carries the cloth off the body, along the cloth's own normal, and no more. The
 * part into the body would put the hem behind the shorts (REVIEW.md round 3). The part along the surface slid a hem off the end of what
 * is under it: on a back leaning over, a lag into it runs 5 cm x sin(lean) up the spine, past the 0-2 cm of shorts p8 has under her
 * shirt, and the court showed through the waist (round 8). The hem still swings: a ring pushed out by a cos(angle) is near enough the
 * ring moved by a, and its outline goes 4.2-4.8 cm on a 5 cm lag. `normalLocal` is the skinned normal here (three skins positionLocal
 * and normalLocal before positionNode runs).
 */
function hemLag(lag: THREE.Node<'vec3'>, sway: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const n = normalLocal.normalize();
  return positionLocal.add(n.mul(max(dot(lag.mul(sway), n), 0)));
}

/** `hemLag` in plain numbers, for a test: how far a vertex with normal `n` moves at a lag of `lag` times `sway`. */
export function hemPush(lag: THREE.Vector3, sway: number, n: THREE.Vector3): THREE.Vector3 {
  return n.clone().multiplyScalar(Math.max(lag.dot(n) * sway, 0));
}

export interface KitFrame {
  chest: THREE.Vector3; hips: THREE.Vector3; hemY: number; shortsHemY: number; armSpan: number; sleeveX?: number; neck?: THREE.Vector3; collarDrop?: number; collarCurve?: number; neckUv?: THREE.Vector2;
  /** A person with a wardrobe: each top's sleeve end, as sleeveX (the modelled one's is sleeveX). */
  sleeveXOf?: Record<string, number>;
  floorY: number; footX?: number; footZ?: number;
  /** The wrist and the forearm's direction in the modelled pose, the arm on its +x side (the arms are lower there than in the rest pose). */
  wrist?: THREE.Vector3; foreDir?: THREE.Vector3;
  /** The shoulder joint out from the chest's middle and its height; the leg's joint out and its depth; the top of the shirt's back. */
  armX?: number; armY?: number; armZ?: number; legX?: number; legZ?: number; backTop?: number;
  /** Radius of the thigh at the hip and at the knee (m). */
  thighR?: [number, number];
  /** The side of the shirt's depth (m) at the hem and under the arm. */
  sideZ?: [number, number];
}
const FRAMES = new WeakMap<PlayerAsset, KitFrame>();

function at(asset: PlayerAsset, name: string): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(asset.restWorld[asset.bone(name)]!);
}

/** Per-vertex region (R_*), computed once per asset; the shader reads it as one weight per region (`kitRegA/B`). */
export function kitRegions(asset: PlayerAsset): { region: Float32Array; frame: KitFrame } {
  let region = REGIONS.get(asset);
  let frame = FRAMES.get(asset);
  if (region && frame) return { region, frame };
  const g = asset.geometry;
  const pos = asset.restPos;
  const si = g.attributes.skinIndex!.array as Uint16Array;
  const sw = g.attributes.skinWeight!.array as Float32Array;
  const n = pos.length / 3;
  region = new Float32Array(n);
  const name = asset.bones.map((b) => b.name);
  const head = at(asset, 'Head'), hips = at(asset, 'Hips'), chest = at(asset, 'Spine2');
  const side = (s: 'Left' | 'Right') => ({
    arm: at(asset, `${s}Arm`), fore: at(asset, `${s}ForeArm`),
    up: at(asset, `${s}UpLeg`), knee: at(asset, `${s}Leg`), foot: at(asset, `${s}Foot`),
  });
  const L = side('Left'), Rr = side('Right');
  const aux = new Float32Array(n * 2);
  const neckY = at(asset, 'Neck').y;
  const halfSpan = Math.abs(L.arm.x - Rr.arm.x) / 2;
  const g3 = (dx: number, dy: number, dz: number, rx: number, ry: number, rz: number): number =>
    Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2));
  const v = new THREE.Vector3();
  const along = (a: THREE.Vector3, b: THREE.Vector3): number => {
    const d = b.clone().sub(a);
    return v.clone().sub(a).dot(d) / d.lengthSq();
  };
  for (let i = 0; i < n; i++) {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) if (sw[i * 4 + k]! > w) { w = sw[i * 4 + k]!; best = si[i * 4 + k]!; }
    const b = name[best]!;
    v.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    const s = b.startsWith('Left') ? L : Rr;
    let r = R_SKIN;
    if (b.startsWith('Head') || b === 'Neck') {
      // A short hair cap: the crown, and the back of the head down to the nape.
      const c = head.y + 0.09;
      r = b === 'Neck' ? R_SKIN : v.y > c + 0.015 || (v.y > c - 0.075 && v.z < head.z - 0.01) ? R_HAIR : R_SKIN;
    } else if (b.startsWith('Spine') || b.endsWith('Shoulder')) r = R_SHIRT;
    else if (b === 'Hips') r = v.y > hips.y + 0.05 ? R_SHIRT : R_SHORTS;
    else if (b.endsWith('ForeArm') || b.includes('Hand')) r = R_SKIN;
    else if (b.endsWith('Arm')) r = along(s.arm, s.fore) < 0.5 ? R_SHIRT : R_SKIN;
    else if (b.endsWith('UpLeg')) r = along(s.up, s.knee) < 0.58 ? R_SHORTS : R_SKIN;
    else if (b.endsWith('Leg')) r = along(s.knee, s.foot) > 0.8 ? R_SOCK : R_SKIN;
    else if (b.includes('Foot') || b.includes('Toe')) r = R_SHOE;
    region[i] = r;
    // Trim: a collar band and a band round each sleeve's hem.
    let trim = 0, wet = 0;
    if (r === R_SHIRT) {
      const dx = v.x - chest.x;
      if (v.y > neckY - 0.022 && Math.abs(dx) < 0.09) trim = 1;
      else if (b.endsWith('Arm')) { const u = along(s.arm, s.fore); if (u > 0.42) trim = 1; }
      // Sweat shows first down the middle of the chest, the length of the spine, under the arms and the small of the
      // back (the shirt's wet "V" and spine line).
      wet = Math.max(
        g3(dx, v.y - (chest.y + 0.02), v.z - (chest.z + 0.1), 0.06, 0.13, 0.09),
        g3(dx, v.y - (chest.y - 0.12), v.z - (chest.z - 0.1), 0.055, 0.26, 0.09),
        g3(Math.abs(dx) - halfSpan * 0.68, v.y - (chest.y + 0.02), v.z - chest.z, 0.05, 0.08, 0.09),
        0.7 * g3(dx, v.y - (hips.y + 0.12), v.z - (chest.z - 0.1), 0.1, 0.08, 0.1),
      );
    }
    aux[i * 2] = trim;
    aux[i * 2 + 1] = wet;
  }
  g.setAttribute('kitAux', new THREE.BufferAttribute(aux, 2));
  frame = {
    chest: chest.clone(), hips: hips.clone(), hemY: hips.y - 0.02,
    shortsHemY: L.up.y + (L.knee.y - L.up.y) * 0.58, armSpan: Math.abs(L.arm.x - Rr.arm.x), floorY: Infinity,
  };
  for (let i = 1; i < pos.length; i += 3) frame.floorY = Math.min(frame.floorY, pos[i]!);
  // One weight per region (shirt, shorts, skin | hair, socks, shoes), not one region code: interpolated across a
  // triangle, a code blends through the codes between (skin to sock passed through hair: a dark ring at the sock
  // tops), while weights blend only between the regions the triangle's corners have.
  const ra = new Float32Array(n * 3), rb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = region[i]!;
    if (r < 3) ra[i * 3 + r] = 1;
    else rb[i * 3 + r - 3] = 1;
  }
  g.setAttribute('kitRegA', new THREE.BufferAttribute(ra, 3));
  g.setAttribute('kitRegB', new THREE.BufferAttribute(rb, 3));
  REGIONS.set(asset, region);
  FRAMES.set(asset, frame);
  return { region, frame };
}

/** Uniforms one player's material reads each frame. */
export interface KitState {
  /** x: 0 dry .. 1 soaked (the match's length and the player's effort). A vector, so writing it doesn't box a double. */
  sweat: { value: THREE.Vector2 };
  /** A person with a painted face: x the blink, y the jaw (`bakedMaterial`). */
  face?: { value: THREE.Vector2 };
  /** How far the hems lag the body (m, model space). */
  lag: { value: THREE.Vector3 };
  /** How far a stride throws long hair (m, model space): the mannequin has none. */
  sway?: { value: THREE.Vector3 };
  /** x: 1 the towelling bands painted on a person's wrists show, 0 they don't (a worn one, or bare wrists, chosen). */
  wrist?: { value: THREE.Vector2 };
  /** Long hair hung as a pendulum (`hairHang`): where it hangs from and its tip at rest, and how far the tip is from where the
   * head alone would carry it (m, model space), which the Avatar steps every frame. Null: short hair, which moves with the head. */
  hang?: HairHang | null;
  /** That pendulum's swing for the shader, in the body's frame: its pivot as the head carries it (m), and the turn that takes
   * the head-carried tip to the swung one (unit axis, angle in w). */
  ponyAt?: { value: THREE.Vector3 };
  pony?: { value: THREE.Vector4 };
}

/** Long hair, measured once from the hair's modelled pose (model space): the point it hangs from, behind the head at the back
 * hairline, and its lowest strands' centre. */
export interface HairHang { pivot: THREE.Vector3; tip: THREE.Vector3 }

/**
 * Hair that reaches past the neck's base (a ponytail, long hair) hangs from the back hairline (HANG_BELOW_HEAD under the head
 * joint): its pivot the centre of the strands within HANG_BAND of that height behind the neck, its tip the centre of the strands
 * within HANG_BAND of the lowest. Anything shorter has none.
 */
export function hairHang(asset: PlayerAsset): HairHang | null {
  const g = asset.look?.alphaGeometry;
  const hi = asset.bones.findIndex((b) => b.name === 'Head'), ni = asset.bones.findIndex((b) => b.name === 'Neck');
  if (!g || hi < 0 || ni < 0) return null;
  const head = new THREE.Vector3().setFromMatrixPosition(asset.restWorld[hi]!);
  const neck = new THREE.Vector3().setFromMatrixPosition(asset.restWorld[ni]!);
  const pos = g.getAttribute('position');
  let low = Infinity;
  for (let v = 0; v < pos.count; v++) low = Math.min(low, pos.getY(v));
  if (low >= neck.y) return null;
  const top = head.y - HANG_BELOW_HEAD;
  const pivot = new THREE.Vector3(), tip = new THREE.Vector3();
  let np = 0, nt = 0;
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v), z = pos.getZ(v);
    if (Math.abs(y - top) < HANG_BAND && z < neck.z) { pivot.x += pos.getX(v); pivot.z += z; np++; }
    if (y < low + HANG_BAND) { tip.x += pos.getX(v); tip.y += y; tip.z += z; nt++; }
  }
  if (!np || !nt) return null;
  pivot.set(pivot.x / np, top, pivot.z / np);
  tip.divideScalar(nt);
  return { pivot, tip };
}
/** The back hairline under the head joint, and the band either side of a height that a strand counts in (m). */
const HANG_BELOW_HEAD = 0.02;
const HANG_BAND = 0.015;

/**
 * Long hair's body: the upper back (Spine1 to Spine2 to the neck's base) and each shoulder (its joint to the arm's), capsules in
 * the modelled pose (model space, `a` to `b`), their radius `r` measured from the body's own surface (the 80th percentile, the
 * shirt over the skin) at HAIR_STATIONS points along them. A shoulder is round, measured above and behind it. The back is
 * measured at HAIR_ANGLES out from straight behind the spine, either side, for its shape: much flatter than round, it is
 * 9 cm behind the spine and 15 cm out at 60 degrees (round, a strand lying off the middle came to rest 1-2 cm inside the
 * shirt); past the last angle it keeps that radius (the arms are next). `r[k][station][angle]`. `hairPush` keeps the hair
 * out of them: weights alone can't, and a head thrown back for a lob swung long hair through the upper back, a shrug or an
 * overhead lifted the shoulders through what lay on them (p9mh). Null for hair that ends above the neck's base, which never
 * reaches them.
 * (Measured only at the ends, the depth ran 13 mm inside the upper back halfway up, which bulges: the hair came through
 * the shirt there in black patches.)
 */
export interface HairBody {
  bones: [number, number][]; a: THREE.Vector3[]; b: THREE.Vector3[]; r: number[][][];
  /** Across the back (unit, square to the capsule), which the angles are measured from straight behind towards; null for a round one. */
  across: (THREE.Vector3 | null)[];
  /** The bones that skin the body under the capsules (HAIR_SKIN_BONES this skeleton has, and every capsule's first bone). */
  slots: number[];
  /**
   * Per capsule, how its surface is skinned: the mean share of each slot's bone in the skin measured there,
   * `skin[k][angle][station][slot]`, at HAIR_SKIN_ANGLES round the back (signed, towards +x) and at one angle round a shoulder.
   */
  skin: number[][][][];
}
export function hairBody(asset: PlayerAsset): HairBody | null {
  if (!hairHang(asset)) return null;
  const pos = asset.geometry.getAttribute('position');
  const UP = new THREE.Vector3(0, 0.8, -0.6);
  const segs: [string, string, boolean][] = [['Spine1', 'Spine2', true], ['Spine2', 'Neck', true], ['LeftShoulder', 'LeftArm', false], ['RightShoulder', 'RightArm', false]];
  const out: HairBody = { bones: [], a: [], b: [], r: [], across: [], slots: [], skin: [] };
  const v = new THREE.Vector3(), d = new THREE.Vector3(), half = 0.5 / (HAIR_STATIONS - 1), neckY = at(asset, 'Neck').y;
  const slots = [...new Set([...HAIR_SKIN_BONES.filter((n) => asset.bone(n) >= 0), ...segs.map((sg) => sg[0])].map((n) => asset.bone(n)))];
  const si = asset.geometry.getAttribute('skinIndex'), sw = asset.geometry.getAttribute('skinWeight'), on = modelledVertices(asset);
  const p80 = (ls: number[]): number => (ls.length < 3 ? NaN : ls.sort((x, y) => x - y)[Math.floor(0.8 * ls.length)]!);
  // (a station with too few points takes its nearest measured neighbour's)
  const fill = (r: number[]): number[] => {
    for (let k = 0; k < r.length; k++) for (let j = 1; Number.isNaN(r[k]!); j++) r[k] = Number.isNaN(r[k - j] ?? NaN) ? r[k + j] ?? NaN : r[k - j]!;
    return r;
  };
  for (const [n0, n1, back] of segs) {
    const a = at(asset, n0), b = at(asset, n1), ab = b.clone().sub(a);
    const angles = back ? HAIR_ANGLES : [0], skinAngles = back ? HAIR_SKIN_ANGLES : [0];
    const near: number[][][] = angles.map(() => Array.from({ length: HAIR_STATIONS }, () => []));
    // (the skin's weights over the slots, summed, and how many points; a bin whose spine, neck and shoulders hold under
    // HAIR_SKIN_MIN of its weight is the arm's, and is filled from its neighbours)
    const skinSum = skinAngles.map(() => Array.from({ length: HAIR_STATIONS }, () => new Array<number>(slots.length + 1).fill(0)));
    const addSkin = (j: number, k: number, i: number): void => {
      const acc = skinSum[j]![k]!;
      for (let c = 0; c < 4; c++) {
        const s = slots.indexOf(si.getComponent(i, c));
        if (s >= 0) acc[s]! += sw.getComponent(i, c);
      }
      acc[slots.length]!++;
    };
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(a);
      const t = v.dot(ab) / ab.lengthSq();
      const k = Math.round(t * (HAIR_STATIONS - 1));
      if (k < 0 || k >= HAIR_STATIONS || Math.abs(t - k / (HAIR_STATIONS - 1)) > half) continue;
      d.copy(v).addScaledVector(ab, -t);
      const l = d.length();
      if (back) {
        const g = Math.atan2(Math.abs(d.x), -d.z);
        angles.forEach((ang, j) => { if (l < HAIR_BODY_FAR && Math.abs(g - ang) < HAIR_BODY_ANGLE) near[j]![k]!.push(l); });
        const gs = Math.atan2(d.x, -d.z);
        if (on[i]) skinAngles.forEach((ang, j) => { if (l < HAIR_BODY_FAR && Math.abs(gs - ang) < HAIR_BODY_ANGLE) addSkin(j, k, i); });
      // (a shoulder's own: the neck and the head stand above its inner end, and made it 19 cm round there)
      } else if (l < HAIR_BODY_REACH && d.dot(UP) > HAIR_BODY_SIDE * l && v.y + a.y < neckY) {
        near[0]![k]!.push(l);
        if (on[i]) addSkin(0, k, i);
      }
    }
    const byAngle = near.map((st) => st.map(p80));
    if (byAngle[0]!.every((x) => Number.isNaN(x))) continue;
    byAngle.forEach((rs, j) => { if (rs.every((x) => Number.isNaN(x))) byAngle[j] = byAngle[j - 1]!.slice(); else fill(rs); });
    out.bones.push([asset.bone(n0), asset.bone(n1)]);
    out.a.push(a);
    out.b.push(b);
    out.r.push(Array.from({ length: HAIR_STATIONS }, (_, k) => byAngle.map((rs) => rs[k]!)));
    const axis = ab.clone().normalize();
    out.across.push(back ? new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize() : null);
    out.skin.push(skinField(skinSum, slots.indexOf(asset.bone(n0))));
  }
  out.slots = slots;
  return out.bones.length ? out : null;
}
/**
 * A capsule's skin weights (`HairBody.skin`) from their sums per bin (the last entry: how many points): each bin's mean share
 * of the slots, out of what the slots hold of it; a bin with no points, or whose slots hold under HAIR_SKIN_MIN of its weight
 * (the arm's), takes its nearest filled neighbour's along the capsule, then round it; with none at all, the capsule's own bone.
 */
function skinField(sums: number[][][], own: number): number[][][] {
  const n = sums[0]![0]!.length - 1;
  const mean = sums.map((row) => row.map((acc): number[] | null => {
    const held = acc.slice(0, n).reduce((x, y) => x + y, 0), pts = acc[n]!;
    return pts > 0 && held >= HAIR_SKIN_MIN * pts ? acc.slice(0, n).map((x) => x / held) : null;
  }));
  const ownOnly = Array.from({ length: n }, (_, s) => (s === own ? 1 : 0));
  return mean.map((row, j) => row.map((w, k) => {
    for (let dk = 0; !w && dk < row.length; dk++) w = row[k - dk] ?? row[k + dk] ?? null;
    for (let dj = 1; !w && dj < mean.length; dj++) w = mean[j - dj]?.[k] ?? mean[j + dj]?.[k] ?? null;
    return w ?? ownOnly;
  }));
}
/** Radii along each capsule: how many points they are measured at; the back's angles out from straight behind (radians), and
 * how near one (radians) and how far out (m) a point must be to count; how far out (m) and how squarely above and behind a
 * shoulder (the cosine) a point must be to count. */
const HAIR_STATIONS = 5;
const HAIR_ANGLES = [0, Math.PI / 6, Math.PI / 3];
const HAIR_BODY_ANGLE = 0.17;
const HAIR_BODY_FAR = 0.3;
const HAIR_BODY_REACH = 0.12;
const HAIR_BODY_SIDE = 0.85;
/** The bones a capsule's skin weights are taken over: the spine's, the neck's and the shoulders' (collarbones'). An arm's is
 * left out: blended with the spine's, an arm raised for an overhead turned the frame inside out and threw hair 10 cm. The
 * angles (radians, signed towards +x) the back's skin is measured at, and the least share of a bin's weight these bones must
 * hold for it to count. */
const HAIR_SKIN_BONES = ['Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'];
const HAIR_SKIN_ANGLES = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
const HAIR_SKIN_MIN = 0.2;
/** How far off the body hair stops (m), and the depth (m) over which it eases onto that: hair inside goes to between CLEAR
 * and CLEAR + SOFT off it, the deepest least far, so the layers keep their order (all put on one surface, the deepest helmet
 * and the cards would fight there). Hair as modelled never moves: the easing narrows (to SOFT_MIN) for a strand modelled
 * nearer the body than SOFT, and one modelled inside it stops where it was modelled (a capsule is round and a shoulder isn't:
 * over the shoulders' fronts and tops a plain push lifted hair 2 cm off where it lay; held SOFT inside where it was
 * modelled instead, hair modelled near the shirt was left under it in an overhead). */
const HAIR_CLEAR = 0.003;
const HAIR_SOFT = 0.01;
const HAIR_SOFT_MIN = 0.002;
/** How far (a share of the radius) a strand may have moved sideways off its own line out from the capsule before the push
 * lets it go, from all of it to none. */
const HAIR_SIDE: [number, number] = [0.8, 1.2];

/**
 * `hairPush` for one capsule in plain numbers, for a test: in the capsule's bone's modelled frame, where the point `q` of a
 * strand modelled at `rest` is put.
 */
export function hairOut(body: HairBody, k: number, q: THREE.Vector3, rest: THREE.Vector3): THREE.Vector3 {
  const a = body.a[k]!, ab = body.b[k]!.clone().sub(a), rs = body.r[k]!, len2 = ab.lengthSq(), across = body.across[k];
  const t = THREE.MathUtils.clamp(q.clone().sub(a).dot(ab) / len2, 0, 1);
  const t0 = THREE.MathUtils.clamp(rest.clone().sub(a).dot(ab) / len2, 0, 1);
  const home = rest.clone().sub(a).addScaledVector(ab, -t0);
  const modelled = home.length(), way = home.divideScalar(Math.max(modelled, 1e-4));
  const d = q.clone().sub(a).addScaledVector(ab, -t), out = d.dot(way), side = d.clone().addScaledVector(way, -out).length();
  const lerp = (xs: number[], u: number, at: (i: number) => number): number => {
    let x = xs[0]!;
    for (let i = 1; i < xs.length; i++) x += THREE.MathUtils.clamp((u - at(i - 1)) / (at(i) - at(i - 1)), 0, 1) * (xs[i]! - xs[i - 1]!);
    return x;
  };
  const byAngle = rs[0]!.map((_, j) => lerp(rs.map((st) => st[j]!), t, (i) => i / (rs.length - 1)));
  const ang = across ? Math.asin(Math.min(1, Math.abs(way.dot(across)))) : 0;
  const r = lerp(byAngle, ang, (i) => HAIR_ANGLES[i]!);
  const target = Math.min(r + HAIR_CLEAR, modelled - HAIR_SOFT_MIN);
  const soft = THREE.MathUtils.clamp(modelled - target, HAIR_SOFT_MIN, HAIR_SOFT);
  const to = Math.max(out, target + Math.exp(Math.min(out - target - soft, 0) / soft) * soft);
  const ss = (e0: number, e1: number, x: number): number => { const u = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u); };
  const keep = ss(target * HAIR_SIDE[1], target * HAIR_SIDE[0], side);
  return q.clone().addScaledVector(way, (to - out) * keep);
}

/** A capsule's skin weights, one per slot (`HairBody.skin`), at `t` along it and `ang` round it (radians, signed), each a
 * straight line from one station or angle to the next. */
export function hairSkinAt(body: HairBody, k: number, t: number, ang: number): number[] {
  const f = body.skin[k]!, angs = f.length > 1 ? HAIR_SKIN_ANGLES : [0];
  const along = (row: number[][]): number[] => row[0]!.map((_, s) => lerpAt(row.map((w) => w[s]!), t, (i) => i / (row.length - 1)));
  const rows = f.map(along);
  return rows[0]!.map((_, s) => lerpAt(rows.map((w) => w[s]!), ang, (i) => angs[i]!));
}
function lerpAt(xs: number[], u: number, at: (i: number) => number): number {
  let x = xs[0]!;
  for (let i = 1; i < xs.length; i++) x += THREE.MathUtils.clamp((u - at(i - 1)) / (at(i) - at(i - 1)), 0, 1) * (xs[i]! - xs[i - 1]!);
  return x;
}

/**
 * `hairPush` in plain numbers, for a test: where the strand modelled at `rest` and now at `p` (model space) is put, with
 * `from[s]` taking the modelled pose to this one for slot s's bone (`HairBody.slots`).
 */
export function hairPushed(body: HairBody, from: THREE.Matrix4[], p: THREE.Vector3, rest: THREE.Vector3): THREE.Vector3 {
  const q = p.clone(), to = from.map((m) => m.clone().invert()), rot = from.map((m) => new THREE.Matrix3().setFromMatrix4(m));
  for (let k = 0; k < body.bones.length; k++) {
    const f = body.slots.indexOf(body.bones[k]![0]);
    const qa = q.clone().applyMatrix4(to[f]!);
    const own = hairOut(body, k, qa, rest).sub(qa).applyMatrix3(rot[f]!);
    const w = hairSkinAt(body, k, ...skinWhere(body, k, qa, rest));
    const qs = new THREE.Vector3();
    w.forEach((x, s) => qs.addScaledVector(q.clone().applyMatrix4(to[s]!), x));
    const step = hairOut(body, k, qs, rest).sub(qs), skin = new THREE.Vector3();
    w.forEach((x, s) => skin.addScaledVector(step.clone().applyMatrix3(rot[s]!), x));
    q.add(own.lengthSq() > skin.lengthSq() ? own : skin);
  }
  return q;
}
/** Where a strand is on capsule k for its skin weights: along it, as `q` (its first bone's frame) is, and round it, as the strand
 * was modelled. */
function skinWhere(body: HairBody, k: number, q: THREE.Vector3, rest: THREE.Vector3): [number, number] {
  const a = body.a[k]!, ab = body.b[k]!.clone().sub(a), len2 = ab.lengthSq(), across = body.across[k];
  const home = rest.clone().sub(a).addScaledVector(ab, -THREE.MathUtils.clamp(rest.clone().sub(a).dot(ab) / len2, 0, 1));
  const way = home.divideScalar(Math.max(home.length(), 1e-4));
  return [q.clone().sub(a).dot(ab) / len2, across ? Math.asin(THREE.MathUtils.clamp(way.dot(across), -1, 1)) : 0];
}

/**
 * Hair out of the back and the shoulders (`hairBody`). Each capsule pushes in two frames. One is its first bone's modelled pose: the
 * skinned point taken back by that bone's skinning is set against the capsule there, and pushed out along its own way out of
 * it in the modelled pose (from the capsule's axis to where the strand was modelled), never the nearest way: hair thrown more
 * than the back's depth in (a head back for a lob swings long hair 10 cm and more) passed the axis and a radial push sent it
 * on out of the chest. Also as the skin under the capsule is skinned there (`HairBody.skin`, by where the strand is along it
 * and round it): the point taken back by each of those bones, blended by their shares, and the push brought forward the same
 * way; the larger of the two pushes is the one made. The skin at the neck's base follows Spine1, the collarbones and the neck,
 * not the bone the capsule hangs on, and in an overhead it went 9 mm back from the capsule: the strands lying there went
 * under the shirt. A strand that has moved sideways
 * off its line (HAIR_SIDE) is beside the body, not in it, and is let go. Hair as modelled is never moved (HAIR_CLEAR), so the
 * round end of the upper back's capsule at the neck's base leaves the nape's hair, which lies closer in, where it lies.
 */
function hairPush(body: HairBody, at: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
  const n = body.slots.length;
  const toRest = body.slots.map(() => uniform(new THREE.Matrix4()));
  const fromRest = body.slots.map(() => uniform(new THREE.Matrix4()));
  const s = new THREE.Matrix4();
  toRest[0]!.onObjectUpdate((f) => {
    const mesh = f.object as THREE.SkinnedMesh, sk = mesh.skeleton;
    for (let k = 0; k < n; k++) {
      const i = body.slots[k]!;
      s.multiplyMatrices(sk.bones[i]!.matrixWorld, sk.boneInverses[i]!);
      const m = (fromRest[k]!.value as THREE.Matrix4).multiplyMatrices(mesh.bindMatrixInverse, s).multiply(mesh.bindMatrix);
      (toRest[k]!.value as THREE.Matrix4).copy(m).invert();
    }
  });
  // (a straight line from one station or angle to the next)
  const lerp = (xs: THREE.Node<'float'>[], u: THREE.Node<'float'>, at: (i: number) => number): THREE.Node<'float'> => {
    let x = xs[0]!;
    for (let i = 1; i < xs.length; i++) x = x.add(u.sub(at(i - 1)).div(at(i) - at(i - 1)).clamp().mul(xs[i]!.sub(xs[i - 1]!)));
    return x;
  };
  let p = at;
  for (let k = 0; k < body.bones.length; k++) {
    const a = body.a[k]!, ab = body.b[k]!.clone().sub(a), rs = body.r[k]!, across = body.across[k], f = body.slots.indexOf(body.bones[k]![0]);
    const A = vec3(a.x, a.y, a.z), AB = vec3(ab.x, ab.y, ab.z), len2 = ab.lengthSq();
    const home = positionGeometry.sub(A.add(AB.mul(positionGeometry.sub(A).dot(AB).div(len2).clamp())));
    const way = home.div(home.length().max(1e-4));
    const sided = across ? way.dot(vec3(across.x, across.y, across.z)).clamp(-1, 1) : float(0);
    const ang = across ? asin(sided.abs()) : float(0);
    const byAngle = (t: THREE.Node<'float'>): THREE.Node<'float'>[] => rs[0]!.map((_, j) => lerp(rs.map((st) => float(st[j]!)), t, (i) => i / (rs.length - 1)));
    const modelled = home.length();
    // (how far along `way` the point `q`, in the modelled pose, is pushed)
    const push = (q: THREE.Node<'vec3'>): THREE.Node<'vec3'> => {
      const t = q.sub(A).dot(AB).div(len2).clamp();
      const d = q.sub(A.add(AB.mul(t))), out = d.dot(way), side = d.sub(way.mul(out)).length();
      const r = lerp(byAngle(t), ang, (i) => HAIR_ANGLES[i]!);
      const target = min(r.add(HAIR_CLEAR), modelled.sub(HAIR_SOFT_MIN));
      const soft = modelled.sub(target).clamp(HAIR_SOFT_MIN, HAIR_SOFT);
      const to = max(out, target.add(exp(min(out.sub(target).sub(soft), 0).div(soft)).mul(soft)));
      const keep = smoothstep(target.mul(HAIR_SIDE[1]), target.mul(HAIR_SIDE[0]), side);
      return way.mul(to.sub(out).mul(keep));
    };
    // in its first bone's frame
    const qa = toRest[f]!.mul(vec4(p, 1)).xyz;
    const own = fromRest[f]!.mul(vec4(push(qa), 0)).xyz;
    // and as the skin under it is skinned, where the strand now is along it (the slots that skin none of it left out)
    const field = body.skin[k]!, angs = field.length > 1 ? HAIR_SKIN_ANGLES : [0];
    const tNow = qa.sub(A).dot(AB).div(len2);
    const used = body.slots.map((_, sl) => sl).filter((sl) => field.some((row) => row.some((w) => w[sl]! > 1e-3)));
    const w = used.map((sl) => (angs.length > 1
      ? lerp(field.map((row) => lerp(row.map((x) => float(x[sl]!)), tNow, (i) => i / (row.length - 1))), asin(sided), (i) => angs[i]!)
      : lerp(field[0]!.map((x) => float(x[sl]!)), tNow, (i) => i / (field[0]!.length - 1))));
    let qs: THREE.Node<'vec3'> = vec3(0, 0, 0);
    used.forEach((sl, j) => { qs = qs.add(toRest[sl]!.mul(vec4(p, 1)).xyz.mul(w[j]!)); });
    const step = vec4(push(qs), 0);
    let skin: THREE.Node<'vec3'> = vec3(0, 0, 0);
    used.forEach((sl, j) => { skin = skin.add(fromRest[sl]!.mul(step).xyz.mul(w[j]!)); });
    // (the larger of the two: pushed twice, hair the first had eased out was eased further, 3 mm on, even where they agree)
    p = p.add(select(dot(own, own).greaterThan(dot(skin, skin)), own, skin));
  }
  return p;
}

export function kitMaterial(asset: PlayerAsset, look: KitLook): { material: THREE.MeshStandardNodeMaterial; state: KitState } {
  const { frame } = kitRegions(asset);
  const ra = attribute<'vec3'>('kitRegA', 'vec3'), rb = attribute<'vec3'>('kitRegB', 'vec3');
  const p = positionGeometry; // bind pose: patterns stay on the body as it moves
  const sweatU = uniform(new THREE.Vector2());
  const sweat = sweatU.x;
  const lag = uniform(new THREE.Vector3());
  const shirtW = ra.x, shortsW = ra.y, skinW = ra.z, hairW = rb.x, sockW = rb.y, shoeW = rb.z;
  const fabric = shirtW.add(shortsW).add(sockW);

  const aux = attribute<'vec2'>('kitAux', 'vec2');
  // Trim (collar, sleeve hems).
  const trimW = smoothstep(0.3, 0.7, aux.x);
  const shirtC = mix(color(look.shirt), color(look.trim), trimW);

  // Wet patches spread out from where sweat shows first as the level rises; ragged edges from noise on the body.
  // Dry shirt at sweat 0 (the patch centre, 1, plus the noise's most, 0.22, stays under the threshold).
  const blotch = mx_noise_float(p.mul(14)).mul(0.22);
  const wet = smoothstep(0.02, 0.12, aux.y.add(blotch).sub(float(1.22).sub(sweat.mul(0.92)))).mul(shirtW);

  const skinC = color(look.skin);
  // Shoes: a gum sole round the bottom, a stripe in the shirt's colour along the side, the upper.
  const sole = float(1).sub(smoothstep(frame.floorY + 0.022, frame.floorY + 0.03, p.y));
  const stripe = smoothstep(0.012, 0.004, p.y.sub(frame.floorY + 0.055).abs());
  // The upper: a knit that fades out with distance, laces up the instep, a heel counter in the stripe's colour.
  const footX = float(frame.footX ?? 0).sub(p.x.abs()), toe = p.z.sub(frame.footZ ?? 0), top = smoothstep(frame.floorY + 0.05, frame.floorY + 0.07, p.y);
  const knit = p.x.mul(1100).add(p.y.mul(700)).sin().mul(p.z.mul(1100).sub(p.y.mul(700)).sin()).mul(0.1).mul(footprintKeep(0.0016));
  const lace = smoothstep(0.024, 0.02, footX.abs()).mul(smoothstep(0.02, 0.03, toe)).mul(smoothstep(0.125, 0.115, toe)).mul(top)
    .mul(smoothstep(0.34, 0.2, toe.mul(1 / 0.0135).fract().sub(0.5).abs()));
  const heel = smoothstep(-0.03, -0.045, toe).mul(0.8);
  const upper = mix(mix(color(look.shoes).mul(float(1).add(knit)), color(look.shirt), stripe.mul(0.9).add(heel).min(1)), color(new THREE.Color(look.shoes).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? 0x8b9098 : 0xe8e8e8), lace);
  const shoeC = mix(upper, color(0x8a8378), sole);
  let col: THREE.Node<'vec3'> = shirtC.mul(shirtW)
    .add(color(look.shorts).mul(shortsW))
    .add(skinC.mul(skinW))
    .add(color(look.hair).mul(hairW))
    .add(color(look.socks).mul(sockW))
    .add(shoeC.mul(shoeW));
  col = col.mul(float(1).sub(wet.mul(0.3)));
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = col;
  // Fabric matte, skin a little sheen that grows with sweat, hair soft, shoes semi-gloss.
  m.roughnessNode = fabric.mul(float(0.88).sub(wet.mul(0.25)))
    .add(skinW.mul(mix(float(0.62), float(0.34), sweat)))
    .add(hairW.mul(0.7)).add(shoeW.mul(0.45));
  m.metalnessNode = float(0);
  // Folds: soft horizontal creases on the shirt and shorts, fixed to the body, about 2 mm deep.
  const folds = mx_noise_float(vec3(p.x.mul(16), p.y.mul(44), p.z.mul(16))).mul(0.6)
    .add(mx_noise_float(p.mul(60)).mul(0.15));
  m.normalNode = heightBump(folds.mul(fabric).mul(0.0025), 0.023);
  // Hems lag the body: the shirt from the chest down to its hem, the shorts' legs, by `lag`.
  const shirtSway = smoothstep(frame.chest.y, frame.hemY, p.y).mul(shirtW);
  const shortsSway = smoothstep(frame.hips.y - 0.05, frame.shortsHemY, p.y).mul(shortsW).mul(0.6);
  m.positionNode = hemLag(lag, shirtSway.add(shortsSway));
  return { material: m, state: { sweat: sweatU, lag } };
}

/**
 * The kits a match can be dealt, by team: warm against cool, so the two sides stay apart at the far end of the court and
 * under simulated colour blindness (tests/app/palette.test.ts). The first of each is the game's default pair.
 */
const KITS: Pick<KitLook, 'shirt' | 'trim' | 'shorts'>[][] = [
  [
    { shirt: 0xd8402e, trim: 0x22252b, shorts: 0x1d2433 },
    { shirt: 0xe8841c, trim: 0x22252b, shorts: 0x20242c },
    { shirt: 0xc4256c, trim: 0xf1f3f6, shorts: 0x22252b },
    { shirt: 0xf0c52e, trim: 0x22252b, shorts: 0x1d2433 },
  ],
  [
    { shirt: 0x2563c9, trim: 0xf1f3f6, shorts: 0xf1f3f6 },
    { shirt: 0x0f8a7e, trim: 0xf1f3f6, shorts: 0xf1f3f6 },
    { shirt: 0x5a3fb8, trim: 0xf1f3f6, shorts: 0xe9ebf0 },
    { shirt: 0xf1f3f6, trim: 0x2563c9, shorts: 0x1f3f8a },
  ],
];
export const KIT_COUNT = 4;

/** Kits by player number (team + 2 * slot): partners in the same shirt, each team its own (`kits`: which of the team's
 * kits, cast.ts); skins and hair vary. */
export function kitFor(idx: number, kits: readonly [number, number] = [0, 0]): KitLook {
  const team = idx & 1;
  const shoes: KitLook[] = [
    { shirt: 0, trim: 0, shorts: 0, socks: 0xf2f2f2, shoes: 0xeeeeee, skin: 0xe2b08c, hair: 0x2a1d14 },
    { shirt: 0, trim: 0, shorts: 0, socks: 0xf2f2f2, shoes: 0x23262c, skin: 0xc68e66, hair: 0x18120e },
  ];
  const k = { ...shoes[team]!, ...KITS[team]![kits[team]!]! };
  if (idx >= 2) {
    // The partner: same kit, their own looks.
    k.skin = team ? 0xf0c9a8 : 0x9c6b4a;
    k.hair = team ? 0x6b4a2e : 0x0f0c0a;
    k.shoes = team ? 0xf0f0f0 : 0x2a2d33;
  }
  return k;
}

/**
 * Skin lit as skin: light reaching round the terminator through it, reddened (Penner and Borshukov's pre-integrated
 * skin, approximated by wrap lighting: the extra over Lambert, wrapped by `SKIN_WRAP`, tinted by the blood under
 * the skin and the skin's own colour). `scatter` is the fragment's share of it (skin, more in the ears).
 */
class SkinLighting extends THREE.PhysicalLightingModel {
  scatter: THREE.Node<'float'>;
  ambientFix: THREE.Node<'float'>;
  constructor(scatter: THREE.Node<'float'>, ambientFix: THREE.Node<'float'>, clearcoat: boolean, sheen: boolean) {
    super(clearcoat, sheen, false, false, false, false);
    this.scatter = scatter;
    this.ambientFix = ambientFix;
  }

  /** Skin and eyes take the ambient's brightness, not its colour: the court's probe is lit by a blue and a red floor,
   * which pooled violet in the eye sockets and turned the whites lavender (review round 4, the critic's #1). No more than
   * its brightness: this was 1.55/1.34/1.2 times it from when the environment was 1.0, and under the lit court's key the
   * extra filled every leg's shadow side with orange. */
  override indirectDiffuse(builder: THREE.NodeBuilder): void {
    const c = builder.context as unknown as { irradiance: THREE.Node<'vec3'> };
    const irradiance = c.irradiance;
    c.irradiance = this.ambient(irradiance);
    super.indirectDiffuse(builder);
    c.irradiance = irradiance;
  }

  /** (the environment's diffuse comes through here) */
  override indirectSpecular(builder: THREE.NodeBuilder): void {
    const c = builder.context as unknown as { iblIrradiance: THREE.Node<'vec3'>; radiance: THREE.Node<'vec3'> };
    const ibl = c.iblIrradiance;
    const radiance = c.radiance;
    c.iblIrradiance = this.ambient(ibl);
    // (skin facing down has the body under it, not the bright floor the probe saw: at a grazing view the bare reflection
    // drew a pale band under every jaw)
    c.radiance = this.ambient(radiance).mul(mix(float(1), smoothstep(-0.75, 0.05, normalWorld.y), this.ambientFix));
    // (and the clearcoat's, the cornea's and wet skin's: it kept the probe's colour, and an eye in the brow's shadow, where
    // little else lights it, came out a navy and violet slot, 7 Nov)
    const self = this as unknown as { clearcoatRadiance: THREE.Node<'vec3'> | null };
    const cc = self.clearcoatRadiance;
    if (cc) self.clearcoatRadiance = this.ambient(cc).mul(mix(float(1), smoothstep(-0.75, 0.05, normalWorld.y), this.ambientFix));
    super.indirectSpecular(builder);
    self.clearcoatRadiance = cc;
    c.iblIrradiance = ibl;
    c.radiance = radiance;
  }

  private ambient(light: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const luma = light.dot(vec3(0.2126, 0.7152, 0.0722));
    return mix(light, vec3(luma, luma, luma), this.ambientFix);
  }

  override direct(input: THREE.LightingModelDirectInput, builder: THREE.NodeBuilder): void {
    const ndl = normalView.dot(input.lightDirection as THREE.Node<'vec3'>);
    const wrapped = ndl.add(SKIN_WRAP).div(1 + SKIN_WRAP).clamp().sub(ndl.clamp());
    const bleed = diffuseColor.rgb.mul(vec3(1.0, 0.36, 0.22)).mul(wrapped).mul(this.scatter);
    (input.reflectedLight.directDiffuse as THREE.Node<'vec3'>).addAssign(bleed.mul(input.lightColor as THREE.Node<'vec3'>).mul(1 / Math.PI));
    super.direct(input, builder);
  }
}
const SKIN_WRAP = 0.55;
/** How much of that bleed skin takes. It goes with the key's strength: 0.42 was set under a key of 1.6, and at 3.0 the red alone was a lit tube's shadow side. */
const SKIN_SCATTER = 0.22;
/** How much of the tone map's offset skin gets back (`PersonNodeMaterial.setupOutput`): all of it turned dark skin ashen, and a little of the toe's depth is what keeps skin rich in shadow. */
const SKIN_TONE_BACK = 0.65;
/** How dark the inside of the cloth is: it sits in the body's shadow, and no bake covers it. */
const BODY_INSIDE = 0.3;
/** The same for a skirt, a fold's own shade: a thigh pushes a skirt through itself, its back comes out in front, and at 0.3 that was a dark slash on white cloth. */
const SKIRT_INSIDE = 0.75;
const LUMA = vec3(0.2126, 0.7152, 0.0722);
const FOLD_DEPTH = 1;
/** The skin's detail normals at their own strength (a MetaHuman's map). */
const SKIN_DETAIL = 0.6;
/** The hands' at their full strength: at the sources' resolution (hands-n.webp) the knuckles' creases and the nails' edges are
 * texels wide, not smeared, and at the face's 0.6 they read as smooth. */
const HANDS_DETAIL = 1;
const BIB_PLAIN = 0.9;
/** The collar's bins across (count, m each), and how far inside the shirt's top its edge stays (m). */
const COLLAR_BINS = 6;
const COLLAR_MAX = 0.11;
const COLLAR_BIN = 0.01;
const COLLAR_EDGE = 0.006;
/**
 * How far the skin goes on under the neckline and under a tank's armhole before the shader cuts it (m). At 1 cm under the armhole,
 * a free arm brought across in a quick prep (spine 11 degrees more, the hips held over a late fall) showed the cut skin through
 * the armhole from above (kit.test, 6 Nov). The second centimetre comes out through the shirt in play no more than the first
 * (fixlab pokearm.ts, 240 poses: p7 1.5 mm at the median against 4.8, p10 3.1 against 3.3).
 */
const UNDER_NECKLINE = 0.005;
const UNDER_ARMHOLE = 0.02;
/** Hem stitching this far in from the edge (m); the wristband's centre in from the wrist and half width (m); hair's swing
 * as a multiple of the hems' lag. */
const HEM_STITCH = 0.018;
const WRIST_IN = 0.06;
const WRIST_W = 0.034;
const HAIR_SWING = 3;
const HAIR_CLUMP = 0.5;
/** How far a strand's normal leans across its card. */
const HAIR_TILT = 0.5;
/** Hair: the size (m) under which a pixel can't show strands; where the atlas's hair ends (u, finish-player.py RECT: brows and lashes keep their own tone); the darkest a
 * head of hair is (linear albedo); from afar, how big its lumps are (per m), how edge-on a card has to be to start thinning, the roughness, the highlight's strength and the rim's. */
const HAIR_STRAND = 0.008;
const HAIR_U = 0.8;
const HAIR_FLOOR = 0.018;
const HAIR_WARM = vec3(1.3, 0.95, 0.72);
const HAIR_LUMP = 42;
const HAIR_FRINGE = 0.55;
const HAIR_FAR_ROUGH = 0.46;
const HAIR_FAR_SPEC = 1.6;
const HAIR_SHEEN = 0.012;
/**
 * Near hair's shine as a fibre's (the owner's realism list, 7 Nov: "helmet hair"): a strand is rough across itself (round)
 * and smooth along it, so its highlight is a band running across the strands, round the head, not a blob on a dome.
 * three's anisotropy, across the cards' u (their strands run along v, tangents from the UVs' derivatives); and the
 * roughness along a strand.
 */
/**
 * A shoe's relief (m): the laces' pitch along the instep, how far they stand up and half their width; the eyelets' depth;
 * the welt's stitching's height over the midsole and its rise; the outsole's herringbone (spacing, groove depth).
 */
const SHOE_LACE_PITCH = 0.0135, SHOE_LACE_H = 0.0016, SHOE_LACE_W = 0.0016, SHOE_EYELET_D = 0.0008;
const SHOE_STITCH_Y = 0.004, SHOE_STITCH_H = 0.0003, SHOE_TREAD = 0.008, SHOE_TREAD_D = 0.0012;
/**
 * A shoe's colours' shapes: the heel counter's front edge (fraction along at the midsole) and how far back it leans per metre
 * up; the side stripe's height over the midsole (a size 43's, m) at 30% along and its rise per metre along; the outsole's
 * rubber, mixed two parts to the midsole's colour's one.
 */
const SHOE_COUNTER = 0.17, SHOE_COUNTER_SLANT = 1.2, SHOE_STRIPE_H = 0.016, SHOE_STRIPE_RISE = 0.12, SHOE_OUTSOLE = 0x34312e;
const HAIR_ANISO = 0.85;
const HAIR_ROUGH = 0.4;
/**
 * A strand's shine (a MetaHuman's cards): what the cuticle reflects (Marschner's R) is the surface's own, white, at keratin's
 * index (1.55, 4.6% head on); only light that went into the strand and back out (TRT) takes the hair's colour, which dark hair
 * absorbs and light hair adds: HAIR_TRT times the albedo on top of the white. Tinted by the hair and at 60% (about 1% head on),
 * black hair had no highlight left and read as one black mass from behind (p9mh, 7 Nov).
 */
const HAIR_IOR = 1.55;
const HAIR_TRT = 2.2;
/** Near, the helmet's (and brows' and lashes') roughness and its highlight's share. */
const HAIR_HELMET_ROUGH = 0.6;
const HAIR_HELMET_SPEC = 0.35;
/** Where the helmet's rectangle starts (v; u past HAIR_U), and how edge on (|n.v|) it has fully faded near. */
const HAIR_HELMET_V = 0.75;
const HAIR_HELMET_EDGE = 0.45;
/** How wide (mip) and how much the lids' hue comes from the skin round them. */
const LID_MIP = 6;
const LID_PLAIN = 1;
/** The catchlight's place in view space (the normal it shines on) and how tight it is (the cosine's power). */
const CATCHLIGHT = vec3(-0.170, 0.170, 0.971);
const CATCHLIGHT_SHARP = 500;
/** The cornea's share of three's clearcoat: it reflects 2.5% head on (index 1.376), the clearcoat's 1.5 index 4%. At the full
 * clearcoat, an eye looking up at the lit roof had its iris under a silver sheet once the reflection lost its colour. */
const CORNEA = 0.625;

/** A person's body: MeshPhysicalNodeMaterial with the skin's lighting model (clearcoat for oil, sweat and the wet
 * eyes, mouth; sheen for the fabric). */
export class PersonNodeMaterial extends THREE.MeshPhysicalNodeMaterial {
  static override get type(): string { return 'PersonNodeMaterial'; }
  scatterNode: THREE.Node<'float'> = float(0);
  ambientFixNode: THREE.Node<'float'> = float(0);
  toneBackNode: THREE.Node<'float'> = float(0);
  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new SkinLighting(this.scatterNode, this.ambientFixNode, this.useClearcoat, this.useSheen);
  }

  /**
   * Skin keeps its hue through the tone map. Khronos Neutral takes up to 0.04 off every channel, the 4% a dielectric's specular adds
   * under a white furnace; in a dark hall that specular isn't there, so the offset came out of the skin's own colour, nearly all of its
   * blue in shadow: an atlas at R/G 1.35 rendered 1.6 lit and 1.85 in shadow, and that orange is what read as glowing tubes. This is the
   * offset's exact inverse on the lowest channel (three's neutralToneMapping), weighted by `toneBackNode`.
   */
  override setupOutput(builder: THREE.NodeBuilder, outputNode: THREE.Node<'vec4'>): THREE.Node<'vec4'> {
    const rgb = outputNode.xyz;
    const x = min(rgb.x, min(rgb.y, rgb.z));
    const y = select(x.lessThan(0.04), x.max(0).div(6.25).sqrt(), x.add(0.04));
    return super.setupOutput(builder, vec4(rgb.add(y.sub(x).mul(this.toneBackNode)), outputNode.w)) as THREE.Node<'vec4'>;
  }
}

/**
 * A person's material (asset.look: an MPFB body, tools/assets/mpfb/):
 * - Skin, eyes, teeth and tongue from the atlas at its source's resolution; the skin's baked occlusion (atlas alpha)
 *   shades the ambient light fully and the colour a little (creases the shadow map can't resolve); per-region
 *   roughness and an oily second lobe (lips and eyelids wetter, the T-zone oilier, all of it shinier with sweat);
 *   pores as a fine bump that fades out with distance; light bleeding round the terminator, more through the ears.
 * - Eyes: a wet cornea (clearcoat, nearly mirror) over the iris; the lids' occlusion baked per vertex.
 * - Teeth and tongue: wet, in the mouth's own occlusion (baked open).
 * - The shirt and shorts in the kit's colours shaded by the clothes' own ambient occlusion (their printed textures are
 *   not used), with a fabric sheen and the kit's detail (`kitDetail`); socks and shoes coloured as the mannequin's kit.
 *   Sweat, fabric folds and the hems' lag work as on the mannequin. A skirt is the shorts' part with bodyX.x from 0 at its
 *   top to 1 at its hem: it swings further, and the thighs push it out of their way (`thighsPush`).
 * The second material is the hair, brows and lashes: alpha to coverage over the MSAA samples (soft strands instead
 * of a hard alpha-tested edge), darker where cards lie near the scalp (baked per vertex), a soft sheen.
 */
export function personMaterial(asset: PlayerAsset, look: KitLook, paint?: Paint): { material: PersonNodeMaterial; hair: THREE.MeshPhysicalNodeMaterial; state: KitState } {
  const body = asset.look!;
  if (body.kit.baked) return bakedMaterial(asset, look);
  const frame0 = personFrame(asset);
  // The cut drawn: the modelled one, or the one chosen (paint.ts cutFor), its sleeve's end its own garment's.
  const cut = cutFor(asset, paint);
  const frame: KitFrame = { ...frame0, sleeveX: frame0.sleeveXOf?.[cut.top === 'polo' || !cut.top ? 'tee' : cut.top] ?? frame0.sleeveX };
  const armhole = cut.top === 'tank' || cut.top === 'sleeveless';
  // Parts (asset.ts): A = shirt, shorts, skin, socks; B = shoes, eyes, teeth, tongue. bodyX by part: skin (lips,
  // T-zone, lids, ears); eyes, shoes, socks: x = their baked occlusion; the shirt: x = where it gets wet first.
  const A = attribute<'vec4'>('bodyA', 'vec4'), B = attribute<'vec4'>('bodyB', 'vec4'), X = attribute<'vec4'>('bodyX', 'vec4');
  const shirtW = A.x, shortsW = A.y, skinW = A.z, sockW = A.w, shoeW = B.x, eyeW = B.y, teethW = B.z, tongueW = B.w;
  const mouthW = teethW.add(tongueW);
  const fabric = shirtW.add(shortsW).add(sockW);
  const vAO = mix(float(1), X.x, eyeW.add(shoeW).add(sockW));
  const lips = X.x.mul(skinW), tzone = X.y.mul(skinW), lids = X.z.mul(skinW), ears = X.w.mul(skinW);
  const p = positionGeometry; // the modelled pose: patterns stay on the body as it moves
  const sweatU = uniform(new THREE.Vector2());
  const sweat = sweatU.x;
  const lag = uniform(new THREE.Vector3());
  // A MetaHuman's hands at the sources' resolution (mh-player.py hands.webp, its skin's occlusion in the alpha as the atlas has
  // it), in place of the atlas inside their rectangle of it: the same picture, sharper (the owner's realism list, 7 Nov: "add
  // knuckles, nails and skin detail on the hands").
  const hb = body.handsBox;
  const inHands = hb && body.handsMap ? step(hb[0], uv().x).mul(step(uv().x, hb[2])).mul(step(hb[1], uv().y)).mul(step(uv().y, hb[3])) : null;
  const handsUv = hb ? uv().sub(vec2(hb[0], hb[1])).div(vec2(hb[2] - hb[0], hb[3] - hb[1])) : uv();
  const atlas = body.opaqueMap ? texture(body.opaqueMap, uv()) : vec4(0.8, 0.62, 0.5, 1);
  const tex = inHands ? mix(atlas, texture(body.handsMap!, handsUv), inHands) : atlas;
  // The clothes' ambient occlusion is the grey in their rectangle; the skin's, teeth's and tongue's is the alpha.
  const ao = float(0.32).add(tex.x.mul(0.68));
  // The skin under the shirt's collar was baked in the shirt's shadow, and the collar is cut lower than that shirt's:
  // lifted to the neck's level, or it read as a dark bib under the chin.
  const nk0 = frame.neck ?? frame.chest;
  const bib = smoothstep(0.17, 0.1, p.x.sub(nk0.x).abs()).mul(smoothstep(nk0.y + 0.1, nk0.y - 0.03, p.y)).mul(skinW);
  const skinAO = mix(tex.w, max(tex.w, float(0.76)), bib);
  const bakedAO = mix(float(1), mix(float(0.3).add(skinAO.mul(0.7)), float(0.15).add(tex.w.mul(0.85)), mouthW), skinW.add(mouthW)).mul(vAO);
  // The waistband under the shirt was in the shirt's shadow when the occlusion was baked (MakeHuman's outfit); a shirt
  // riding up as the player bends showed it as a grey band. Above the shirt's hem the shorts are lit as they show.
  // (the women's suit's bottom half is jeans: its occlusion draws a fly and pockets, which read through white shorts)
  const aoBottom = body.textures.cloth === 'suit-normal-f.webp' ? max(ao, float(0.78)) : ao;
  const aoShorts = mix(aoBottom, max(aoBottom, float(0.82)), smoothstep(frame.hemY - 0.05, frame.hemY, p.y));

  const blotch = mx_noise_float(p.mul(14)).mul(0.22);
  const wet = smoothstep(0.02, 0.12, X.x.mul(shirtW).add(blotch).sub(float(1.22).sub(sweat.mul(0.92)))).mul(shirtW);

  const { shirtC, shortsC, sockC, skinCut } = kitDetail(look, cut, frame, p, X, paint, asset);
  const hang = X.x.mul(shortsW);

  // Shoes (made to their feet by shoe.ts; bodyX: occlusion, where on the shoe (0 outsole, 0.5 midsole, 1 + cm over the
  // midsole on the upper, 20 + that on the tongue), how far along it (0 heel, 1 toe), how far across (m, the outside +)).
  const fit = body.shoe ?? null, shoeLen = fit?.length ?? 0.27, shoeK = fit?.k ?? 1;
  const where = X.y, along = X.z, side = X.w.abs();
  const onUpper = smoothstep(0.7, 0.8, where), outsole = float(1).sub(smoothstep(0.2, 0.3, where));
  const midsole = float(1).sub(onUpper).sub(outsole).max(0), tongue = step(15, where);
  const hUp = where.sub(mix(float(1), float(20), tongue)).mul(0.01).mul(onUpper), alongM = along.mul(shoeLen);
  // The upper: a knit that fades out with distance; a heel counter and a stripe down each side in the accent; a toe cap a
  // shade darker.
  const knit = p.x.mul(1100).add(p.y.mul(700)).sin().mul(p.z.mul(1100).sub(p.y.mul(700)).sin()).mul(0.1).mul(footprintKeep(0.0016));
  const onSide = float(1).sub(tongue).mul(onUpper);
  const counterEdge = float(SHOE_COUNTER).sub(hUp.mul(SHOE_COUNTER_SLANT / shoeLen));
  const counter = smoothstep(counterEdge.add(0.012), counterEdge.sub(0.012), along).mul(smoothstep(0.003, 0.006, hUp)).mul(onSide);
  const stripeAt = float(SHOE_STRIPE_H * shoeK).add(along.sub(0.3).mul(SHOE_STRIPE_RISE * shoeLen));
  const stripe = smoothstep(0.006 * shoeK, 0.0035 * shoeK, hUp.sub(stripeAt).abs()).mul(smoothstep(0.2, 0.26, along)).mul(smoothstep(0.66, 0.6, along))
    .mul(smoothstep(0.02 * shoeK, 0.028 * shoeK, side)).mul(onSide);
  const toeCap = smoothstep(0.84, 0.86, along).mul(smoothstep(0.024 * shoeK, 0.02 * shoeK, hUp)).mul(onSide);
  // The laces: criss-crossed over the tongue between the eyestays, from eyelet to eyelet, each eyelet `eyelets` out from the
  // slot's edge (shoe.ts measures where the slot runs).
  const laceFrom = fit?.laceFrom ?? 0.45, laceTo = fit?.laceTo ?? 0.74;
  const reachE = float(fit?.gapFrom ?? 0.011).add(float((fit?.gapTo ?? 0.006) - (fit?.gapFrom ?? 0.011)).mul(along.sub(laceFrom).div(laceTo - laceFrom).clamp(0, 1)))
    .add(fit?.eyelets ?? 0.006);
  const inLaces = smoothstep(laceFrom - 0.005, laceFrom + 0.005, along).mul(smoothstep(laceTo + 0.005, laceTo - 0.005, along)).mul(onUpper);
  const laceT = alongM.sub(laceFrom * shoeLen).mul(1 / SHOE_LACE_PITCH), laceF = laceT.fract();
  const crossX = laceF.mul(2).sub(1).mul(reachE), xs = X.w;
  const laceD = min(xs.sub(crossX).abs(), xs.add(crossX).abs()).mul(SHOE_LACE_PITCH).div(reachE.mul(2).mul(reachE.mul(2)).add(SHOE_LACE_PITCH * SHOE_LACE_PITCH).sqrt());
  const lace = smoothstep(SHOE_LACE_W, SHOE_LACE_W * 0.6, laceD).mul(smoothstep(reachE.add(0.001), reachE.sub(0.001), side)).mul(inLaces);
  // (a pair chosen in the locker: its upper, sole, and an accent on the laces, the heel and the stripe)
  const shoe = new THREE.Color(paint?.shoes?.upper ?? body.kit.shoes ?? look.shoes);
  const accent = paint?.shoes ? new THREE.Color(paint.shoes.accent) : null;
  const tab = accent ?? new THREE.Color(look.shirt), laces = accent ?? new THREE.Color(shoe.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? 0x8b9098 : 0xe8e8e8);
  const upper = mix(mix(color(shoe).mul(float(1).add(knit)).mul(float(1).sub(toeCap.mul(0.12))), color(tab), max(stripe.mul(0.9), counter.mul(0.85))), color(laces), lace);
  // Relief (the owner's realism list, 7 Nov: "shoes are black blobs"): the laces standing off the tongue, an eyelet at each
  // end of a lace, stitching round the upper over the midsole and round the toe cap, and a herringbone outsole underneath
  // (seen as the heel lifts); all of it gone where a pixel covers more than a few millimetres.
  const eyeR = vec2(side.sub(reachE), min(laceF, float(1).sub(laceF)).mul(SHOE_LACE_PITCH)).length();
  const eyelet = smoothstep(0.0032, 0.0022, eyeR).mul(inLaces).mul(onSide);
  const dash = step(0.2, alongM.add(side).mul(2 * Math.PI / 0.0045).sin());
  const stitch = smoothstep(0.0009, 0.0004, hUp.sub(SHOE_STITCH_Y).abs()).mul(onSide)
    .add(smoothstep(0.0009, 0.0004, along.sub(0.855).mul(shoeLen).abs()).mul(smoothstep(0.024 * shoeK, 0.02 * shoeK, hUp)).mul(onSide)).mul(dash);
  const chevron = alongM.add(side).mul(1 / SHOE_TREAD).fract();
  const shoeRelief = lace.mul(SHOE_LACE_H)
    .sub(eyelet.mul(SHOE_EYELET_D))
    .add(stitch.mul(SHOE_STITCH_H))
    .sub(outsole.mul(smoothstep(0.3, 0.2, chevron)).mul(SHOE_TREAD_D))
    .mul(shoeW).mul(footprintKeep(0.003));
  const soleCol = new THREE.Color(paint?.shoes?.sole ?? body.kit.sole ?? 0x8a8378);
  const shoeC = mix(mix(upper, color(soleCol), midsole.add(outsole).min(1)), color(soleCol.clone().lerp(new THREE.Color(SHOE_OUTSOLE), 0.65)), outsole)
    .mul(float(1).sub(eyelet.mul(0.45)));
  // Albedo: the skin a little darker in its deepest creases, the eyeball under the lids, the mouth's inside.
  // (dark skin lifted a little: under the same floodlights its faces read as masks beside the others', mean luminance
  // 23 of 255 against 68 and 99)
  // (MakeHuman's women wear eye shadow in the source: the lids take the hue of the skin round them and keep their shading)
  const round = body.opaqueMap ? texture(body.opaqueMap, uv()).level(float(LID_MIP)).xyz : tex.xyz;
  const shade = tex.xyz.dot(LUMA).div(round.dot(LUMA).max(0.02));
  // (and the chest in the collar takes the neck's: on some skins the source's torso is another colour, and read orange)
  const neckTone = body.opaqueMap && frame.neckUv ? texture(body.opaqueMap, vec2(frame.neckUv.x, frame.neckUv.y)).level(float(4)).xyz : round;
  const skinBase = mix(mix(tex.xyz, round.mul(shade), lids.mul(LID_PLAIN)), neckTone.mul(shade), bib.mul(BIB_PLAIN));
  // Skin isn't one even colour, and the source's millimetre texels are soft up close: blotches a few cm across, smaller
  // ones with a little red in them, and the pores' own shade (round 7, the critic: "waxy, even skin").
  const mottle = mx_noise_float(p.mul(42)).mul(0.6).add(mx_noise_float(p.mul(150)).mul(0.4));
  const poreFine = mx_noise_float(p.mul(620));
  const skinTone = vec3(1, 1, 1).add(vec3(0.13, 0.065, 0.055).mul(mottle)).mul(float(1).add(poreFine.mul(0.06).mul(footprintKeep(0.0012))));
  const skinCol = skinBase.mul(skinTone).mul(mix(float(1), skinAO, 0.3)).mul(float(1).add(smoothstep(0.4, 0.12, tex.y).mul(0.3)));
  // (the source draws a brown iris dark red: its green and blue are lifted to the red's; whites and blue or green irises
  // keep theirs)
  // (a little darker than the source, and well under the lid's shadow: at 0.74 the eyes shone out of the sockets)
  const eyeCol = vec3(tex.x, max(tex.y, tex.x.mul(0.58)), max(tex.z, tex.x.mul(0.34))).mul(0.8).mul(float(0.5).add(vAO.mul(0.5)));
  // (teeth sit at occlusion about 0.27: multiplied straight they rendered blue-grey, 100 of 239: review round 5, the
  // critic's #4. The throat, below 0.1, stays dark.)
  const mouthCol = tex.xyz.mul(float(0.2).add(smoothstep(0.1, 0.4, tex.w).mul(0.8)));
  let col: THREE.Node<'vec3'> = shirtC.mul(ao).mul(shirtW)
    .add(shortsC.mul(aoShorts).mul(shortsW))
    .add(skinCol.mul(skinW))
    .add(eyeCol.mul(eyeW))
    .add(mouthCol.mul(mouthW))
    .add(sockC.mul(sockW))
    .add(shoeC.mul(shoeW).mul(vAO));
  col = col.mul(float(1).sub(wet.mul(0.3)));
  // The neckline, worked out per pixel from the body's rest position (from a per-vertex value it ran in straight pieces
  // across the shirt's big triangles), and a ribbed band 8 mm wide along it.
  const nk = frame.neck ?? frame.chest;
  const collarX = p.x.sub(nk.x);
  let collarY = p.y.sub(nk.y - (frame.collarDrop ?? COLLAR_DROP)).sub(collarX.mul(collarX).mul(frame.collarCurve ?? COLLAR_CURVE));
  // A V-neck: the V joins the scoop (its chest was laid on the skin round it, person_wear.py make_vneck).
  const vneck = cut.top === 'vneck' ? body.wardrobe?.vneck : undefined;
  if (vneck) collarY = max(collarY, p.y.sub(nk.y - vneck[0]).sub(collarX.abs().mul(vneck[1])));
  const neckline = float(COLLAR_MID).add(min(collarY, p.z.sub(nk.z - 0.01)).mul(COLLAR_SCALE)).mul(shirtW);
  // The skin the build keeps for the neckline stops at it: below, on a close-fitting shirt, it came through in jagged pieces.
  // (down to the chest only: left open below, it took a slice out of the inside of every leg)
  const underShirt = smoothstep(-UNDER_NECKLINE, -UNDER_NECKLINE - 0.0005, collarY).mul(smoothstep(nk.z - 0.01, nk.z - 0.005, p.z))
    .mul(smoothstep(0.1, 0.09, collarX.abs())).mul(smoothstep(nk.y - 0.3, nk.y - 0.28, p.y)).mul(skinW);
  // The collar's ribbed band in the kit's second colour, right round: the back of the neck is the shirt's own edge.
  // (round the neck only: past the neck the shirt's top is the shoulder, and a level band ran out along it in dark wings)
  const backBand = smoothstep(float(frame.backTop ?? 9).sub(COLLAR_RIB + 0.002), float(frame.backTop ?? 9).sub(COLLAR_RIB), p.y).mul(step(p.z, nk.z - 0.02)).mul(shirtW)
    .mul(smoothstep(COLLAR_BACK + 0.002, COLLAR_BACK, collarX.abs()));
  const rib = float(0.9).add(p.x.mul(900).sin().mul(0.08));
  col = mix(col, color(look.trim).mul(ao).mul(rib), smoothstep(0.465, 0.475, neckline).add(backBand).min(1));
  // Twin-needle hems on the shirt's waist and sleeves, a slim stitched line a little in from each edge; a towelling band
  // on the wrists.
  const stitched = (d: THREE.Node<'float'>): THREE.Node<'float'> => smoothstep(0.004, 0.0015, d.sub(HEM_STITCH).abs());
  const hems = stitched(p.y.sub(frame.hemY)).add(stitched(float(frame.sleeveX ?? 0).sub(X.z)).mul(armhole ? 0 : 1)).mul(shirtW)
    .add(stitched(p.y.sub(frame.shortsHemY)).mul(shortsW));
  col = col.mul(float(1).sub(hems.mul(0.14)));
  const wristAt = frame.wrist!, fore = frame.foreDir!;
  const wristD = vec3(p.x.abs(), p.y, p.z).sub(vec3(wristAt.x, wristAt.y, wristAt.z)).dot(vec3(fore.x, fore.y, fore.z));
  const wristU = uniform(new THREE.Vector2(1, 0));
  const band = smoothstep(0.003, 0, wristD.add(WRIST_IN).abs().sub(WRIST_W)).mul(skinW)
    .mul(smoothstep(0.17, 0.15, vec3(p.x.abs(), p.y, p.z).sub(vec3(wristAt.x, wristAt.y, wristAt.z)).length())).mul(wristU.x);
  col = mix(col, color(look.shirt).mul(float(0.92).add(p.x.mul(2400).sin().mul(0.08))), band);
  const m = new PersonNodeMaterial();
  m.maskNode = neckline.lessThan(COLLAR_MID).and(underShirt.lessThan(0.5)).and(skinCut.mul(skinW).lessThan(0.5));
  // Both sides are drawn. A body here is a shell, hollow under the clothes: wherever a camera saw past an edge, into a collar
  // or up a sleeve or a skirt, it met the far side's back, and culled that showed the court through the player (round 8).
  // Closed surfaces hide their own backs, so this only shows at those edges, as the cloth's inside in its own shadow. The
  // shadow map is drawn from the same faces as ever.
  m.side = THREE.DoubleSide;
  m.shadowSide = THREE.BackSide;
  col = col.mul(mix(mix(float(BODY_INSIDE), float(SKIRT_INSIDE), smoothstep(0, 0.1, hang)), float(1), faceDirection.mul(0.5).add(0.5)));
  m.colorNode = col;
  m.aoNode = bakedAO;
  const darkSkin = smoothstep(0.4, 0.12, tex.y).mul(skinW);
  const skinRough = mix(float(0.5), float(0.33), sweat).sub(darkSkin.mul(0.06)).sub(lips.mul(0.14)).sub(lids.mul(0.12)).sub(tzone.mul(0.07))
    .add(mottle.mul(0.07)).add(poreFine.mul(0.05));
  m.roughnessNode = fabric.mul(float(0.88).sub(wet.mul(0.25)))
    .add(skinW.mul(mix(skinRough, float(0.9), band)))
    .add(eyeW.mul(0.2)).add(teethW.mul(0.3)).add(tongueW.mul(0.38)).add(shoeW.mul(0.45));
  m.metalnessNode = float(0);
  // Specular occlusion for the direct light as well: deep creases (nostrils, the ears' hollows, the corners of the
  // mouth) and the scalp under the hair don't shine (the baked occlusion is low there).
  // (dark skin shows more of its specular: the same lobe over a darker base, a little stronger)
  m.specularIntensityNode = mix(float(1), smoothstep(0.05, 0.55, tex.w).mul(float(1).add(darkSkin.mul(0.5))), skinW.add(mouthW));
  // The second lobe: skin's oil and sweat, the cornea, the wet mouth.
  m.clearcoatNode = skinW.mul(float(0.05).add(sweat.mul(0.35)).add(tzone.mul(0.12)).add(lips.mul(0.25)).add(lids.mul(0.3)))
    .mul(smoothstep(0.05, 0.55, tex.w)).add(eyeW.mul(CORNEA)).add(teethW.mul(0.55)).add(tongueW.mul(0.8));
  m.clearcoatRoughnessNode = skinW.mul(float(0.32).sub(sweat.mul(0.1))).add(eyeW.mul(0.03)).add(mouthW.mul(0.12));
  // Cotton and polyester's soft rim.
  // (less on the shorts and skirts, which are often near black: at a grazing view the white in it turned them grey; and none
  // in the cloth's own creases, or a pleat's inside lit up in a lunge)
  m.sheenNode = mix(col, vec3(1, 1, 1), mix(float(0.35), float(0.12), shortsW)).mul(fabric.mul(0.6)).mul(ao);
  m.sheenRoughnessNode = float(0.55);
  // (little on the lids: the red at their terminator drew an orange band over each eye)
  m.scatterNode = skinW.mul(float(SKIN_SCATTER).add(ears.mul(0.9))).mul(float(1).sub(lids.mul(0.85)));
  // (the mouth too: the sky's blue on teeth turned them blue-black with the head bowed)
  m.ambientFixNode = skinW.add(eyeW).add(mouthW);
  m.toneBackNode = skinW.mul(SKIN_TONE_BACK);
  // The catchlight: a floodlit cornea always holds a bright point, and a face without one reads as dead. The light it
  // would mirror isn't in the probe, so it is drawn: fixed in view space, where the eyeball's normal meets it.
  // (10 degrees up and over from the view, on the iris: at 24 up it fell under the upper lid and no eye showed one, 7 Nov; a
  // little wider, so it holds a pixel at the face camera)
  m.emissiveNode = vec3(1, 0.98, 0.94).mul(normalView.dot(CATCHLIGHT).clamp().pow(CATCHLIGHT_SHARP)).mul(eyeW).mul(1.5);
  const folds = mx_noise_float(vec3(p.x.mul(16), p.y.mul(44), p.z.mul(16))).mul(0.6)
    .add(mx_noise_float(p.mul(60)).mul(0.15));
  // Pores: about 0.5 mm features, 30 µm deep, faded out wherever a pixel covers more than a few of them (bump.ts),
  // less on the lips and lids.
  const pores = mx_noise_float(p.mul(1900)).mul(0.6).add(poreFine.mul(0.4))
    .mul(0.00003).mul(skinW).mul(float(1).sub(lips.mul(0.7)).sub(lids.mul(0.5))).mul(footprintKeep(0.0012));
  // The suit's sculpted folds, MakeHuman's own normal map, over the suit's rectangle of the atlas (finish-player.py RECT).
  let bumped = heightBump(folds.mul(body.clothNormal ? sockW : fabric).mul(0.0025).add(pores).add(shoeRelief), 0.023);
  // The skin's own detail normals over that (a MetaHuman's, mh-player.py: pores, the creases round the eyes and mouth, the
  // lips' lines; the owner's realism list, 7 Nov: "flat face"), added as a tilt of the bumped normal. Every rectangle of the
  // atlas is square in texels and the atlas is 3:2, so u is stretched by 3/2 for the frame: `uvNormal` scales both its axes by
  // the longer, which would have halved the creases running across the face.
  if (body.skinNormal) {
    const own = texture(body.skinNormal, uv()).xy;
    const detail = inHands && body.handsNormal
      ? mix(own.mul(2).sub(1).mul(SKIN_DETAIL), texture(body.handsNormal, handsUv).xy.mul(2).sub(1).mul(HANDS_DETAIL), inHands)
      : own.mul(2).sub(1).mul(SKIN_DETAIL);
    bumped = bumped.add(uvNormal(detail, uv().mul(vec2(1.5, 1))).sub(normalView).mul(skinW)).normalize();
  }
  if (body.clothNormal) {
    const suitUv = vec2(uv().x.sub(2 / 3).mul(3), uv().y.sub(0.5).mul(2));
    // (the suit's rectangle only: a skirt has pleats of its own)
    const fold = texture(body.clothNormal, suitUv).xy.mul(2).sub(1).mul(step(0.5, uv().y));
    m.normalNode = mix(bumped, uvNormal(fold.mul(FOLD_DEPTH), uv()), shirtW.add(shortsW));
  } else m.normalNode = bumped;
  // (a long sleeve past where a tee's would end hangs in the modelled pose's arm, below the chest: it doesn't swing with the shirt)
  const teeX = frame0.sleeveXOf?.tee;
  const shirtSway = smoothstep(frame.chest.y, frame.hemY, p.y).mul(shirtW).mul(cut.top === 'long' && teeX ? smoothstep(teeX + 0.01, teeX - 0.01, X.z) : float(1));
  // (tights, the shorts' part on the ramp's UVs, finish-player.py RECT: on the skin, no hem's swing)
  const shortsSway = smoothstep(frame.hips.y - 0.05, frame.shortsHemY, p.y).mul(shortsW).mul(0.6).mul(float(1).sub(step(0.001, hang))).mul(float(1).sub(onRamp()));
  // (a skirt's swing is plain: `hemLag` goes by the vertex's normal, and a pleat's two faces share corners but not normals, so
  // it tore them apart into a fringe)
  const hung = hemLag(lag, shirtSway.add(shortsSway)).add(lag.mul(hang.mul(SKIRT_SWING)));
  // (the thighs push all of the skirt that shows: it comes out under the shirt's hem about 0.15 down (person_kit.py SKIRT_TUCK
  // over its length), and pushed only from 0.4 down, in a ready stance the thighs carried the shorts out through its top half)
  const lining = step(SKIRT_OUT_V, uv().y).mul(SKIRT_LINING_IN);
  m.positionNode = cut.bottom === 'pleated' || cut.bottom === 'aline' ? hung.add(thighsPush(asset, frame, hung, lining).mul(smoothstep(SKIRT_PUSH[0], SKIRT_PUSH[1], hang))) : hung;
  // (and the arms off the racket: racketPush)
  m.positionNode = (m.positionNode as THREE.Node<'vec3'>).add(racketPush(asset, m.positionNode as THREE.Node<'vec3'>));

  const hair = new PersonNodeMaterial();
  // A MetaHuman's grooms: cards whose strands run along v, over a helmet (`hasHelmet`). They take the fibre's shine and the
  // helmet's fading below; MPFB hair, whose cards run every way, is drawn as it was.
  const shell = hasHelmet(body.alphaGeometry);
  if (shell) {
    cardTangents(body.alphaGeometry);
    // (anisotropy in its lighting: PersonNodeMaterial's model leaves it off, for the skin)
    const hairLighting = hair.setupLightingModel.bind(hair);
    hair.setupLightingModel = (): THREE.PhysicalLightingModel => {
      const l = hairLighting();
      (l as unknown as { anisotropy: boolean }).anisotropy = true;
      return l;
    };
  }
  // Long hair swings. Hair that reaches past the neck's base hangs from the back hairline as a pendulum the Avatar steps (it
  // lags the head's own moves, turns and nods included, and gravity takes it back down): every strand below the pivot turns
  // about the pivot by a share of the pendulum's swing, none at the tie to all of it at the tip, so a ponytail bends from
  // where it is tied and keeps its length (carried by the tip's offset instead, a swing with any lift in it pushed the tail
  // up into the head). The owner's realism list, 7 Nov: the ponytail moved with the head as one piece; the hems' spring below
  // the nape only reached a few centimetres of it. Shorter hair keeps that spring below the nape.
  const neckY = frame.neck?.y ?? frame.chest.y + 0.2;
  const longHair = hairHang(asset);
  const ponyAt = uniform(new THREE.Vector3()), pony = uniform(new THREE.Vector4(0, 1, 0, 0));
  // Clumps go their own way a little, and every stride throws it from side to side and up, more towards the tips.
  const sway = uniform(new THREE.Vector3());
  const below = longHair ? smoothstep(longHair.pivot.y, longHair.tip.y, p.y) : smoothstep(neckY + 0.04, neckY - 0.22, p.y);
  const clump = mx_noise_float(vec3(uv().x.mul(22), uv().y.mul(3), float(0))).mul(HAIR_CLUMP).add(1);
  let held: THREE.Node<'vec3'>;
  if (longHair) {
    // (Rodrigues: rel turned by `turn` about the unit axis)
    const turn = pony.w.mul(below).mul(mix(float(1), clump, 0.5)), axis = pony.xyz, rel = positionLocal.sub(ponyAt);
    const c = cos(turn);
    held = ponyAt.add(rel.mul(c)).add(cross(axis, rel).mul(sin(turn))).add(axis.mul(dot(axis, rel).mul(float(1).sub(c))));
  } else held = positionLocal.add(lag.mul(below.mul(HAIR_SWING).mul(clump)));
  const swung = held.add(sway.mul(below.mul(below).mul(clump)));
  // (and out of the back and the shoulders it lies on: hairPush; then onto the back as it is posed: hairBack.ts)
  const onBody = hairBody(asset);
  const pushed = onBody ? hairPush(onBody, swung) : swung;
  const back = onBody ? backBody(asset, longHair) : null;
  hair.positionNode = back ? hairOnBack(back, pushed, body.alphaGeometry) : pushed;
  const ht = body.alphaMap ? texture(body.alphaMap, uv()) : vec4(0.16, 0.11, 0.08, 1);
  const hAO = body.alphaGeometry.hasAttribute('bodyAO') ? attribute<'float'>('bodyAO', 'float') : float(1);
  // Strands, not a cap: brightness varies across the cards (fine) and along them (slowly); pale texels at the edge of a
  // strand, where the atlas fades out over its white, go dark (they drew a light fringe under the lower lashes).
  const strandUv = uv();
  const strands = mx_noise_float(vec3(strandUv.x.mul(1400), strandUv.y.mul(260), float(0))).mul(0.55)
    .add(mx_noise_float(vec3(strandUv.x.mul(420), strandUv.y.mul(90), float(3))).mul(0.45));
  // At the broadcast camera a strand is far under a pixel and the head is about 30 of them, and what made a black ball of it was not the
  // cards: most of the sources' hair is near black (linear 0.005-0.02), the tone map's toe takes that to nothing, a strand's edge darkening
  // works on the alpha's average there and halves it, and the strands' noise only speckles. So hair keeps its tone (`toneBackNode`), no
  // head of hair is darker than HAIR_FLOOR, and from about 3 mm a pixel (`far`) the look goes from strands to a mass with soft edges: the
  // noise and the tilt fade to a few big lumps, a broad sheen from above, and cards seen edge on thin out into the background.
  const far = float(1).sub(footprintKeep(HAIR_STRAND));
  const onHead = step(uv().x, HAIR_U);
  const base = ht.xyz.add(HAIR_WARM.mul(max(float(HAIR_FLOOR).sub(ht.xyz.dot(LUMA)), 0)).mul(onHead));
  const lump = mx_noise_float(p.mul(HAIR_LUMP));
  const strandLit = mix(float(0.8).add(strands.mul(0.75)), float(1).add(lump.mul(0.4)), far);
  hair.colorNode = base.mul(mix(smoothstep(0.1, 0.62, ht.w), float(1), far)).mul(mix(hAO, hAO.sqrt(), far)).mul(strandLit);
  hair.aoNode = hAO;
  hair.toneBackNode = float(1);
  // Coverage from the cards' alpha over the MSAA samples: strands fade out instead of being cut at a threshold. The
  // nearly clear texels are dropped outright, and the shadow keeps a hard cut (the shadow map has no samples).
  const edgeOn = normalView.dot(positionViewDirection).abs().add(lump.mul(0.14));
  // Near, the helmet (a MetaHuman's shell under its cards, tools/assets/metahuman/ RECT; MPFB atlases have nothing there) fades
  // where it is seen edge on: its outline was a shell's hard edge round the head, and now the cards' strands make it.
  const helmet = step(HAIR_U, uv().x).mul(step(HAIR_HELMET_V, uv().y));
  const nearOpacity = smoothstep(0.06, 0.7, ht.w).mul(mix(float(1), smoothstep(0.04, HAIR_HELMET_EDGE, edgeOn), helmet));
  hair.opacityNode = mix(nearOpacity, smoothstep(0.03, 0.72, ht.w).mul(smoothstep(0, HAIR_FRINGE, edgeOn)), far);
  hair.alphaToCoverage = true;
  hair.maskNode = ht.w.greaterThan(0.05);
  hair.maskShadowNode = ht.w.greaterThan(0.5);
  hair.side = THREE.DoubleSide;
  // Hair's highlight is dimmer and tinted by the hair (the light that enters a strand comes out coloured), and
  // weaker deep in the hair.
  // (the cards only: the helmet's UVs don't run along strands, and its sheen drew a plastic shell; it is the deepest layer,
  // rough and dim. Cards seen edge on lose the fibre's shine: a grazing card's highlight came out as one white spark.)
  // (a MetaHuman's brows and lashes too, everything past HAIR_U: a lash is a fine dark fibre against the lid, and with the
  // cards' gloss and strand tilt the lashes' tips caught the sky as a row of blue-white dots along each lid, 7 Nov)
  const fine = shell ? float(1).sub(onHead) : helmet;
  const nearRough = shell ? mix(float(HAIR_ROUGH).sub(strands.mul(0.12)), float(HAIR_HELMET_ROUGH), fine) : float(0.52).sub(strands.mul(0.18));
  hair.roughnessNode = mix(nearRough, float(HAIR_FAR_ROUGH), far);
  if (shell) hair.anisotropyNode = vec2(float(HAIR_ANISO).mul(float(1).sub(far)).mul(onHead).mul(smoothstep(0.08, 0.35, edgeOn)), 0);
  // Each strand tilts its own way across the card, so the shine comes in fine broken lines and not one band over a helmet.
  hair.normalNode = uvNormal(vec2(strands.sub(0.1).mul(HAIR_TILT).mul(float(1).sub(far)).mul(float(1).sub(fine)), float(0)), strandUv);
  hair.metalnessNode = float(0);
  const tinted = mix(vec3(1, 1, 1), base.mul(2.2), mix(float(0.6), float(0.85), far)).mul(mix(float(1), float(HAIR_FAR_SPEC), far));
  const dimmed = hAO.mul(mix(float(0.6), float(1), far)).mul(mix(float(1), float(HAIR_HELMET_SPEC), fine.mul(float(1).sub(far))));
  if (shell) {
    // (the cards: the fibre's white shine, gone where a card is seen edge on as the anisotropy is, or its Fresnel lit the
    // card's edge white; the helmet, brows and lashes as before)
    const card = onHead.mul(mix(smoothstep(0.08, 0.35, edgeOn), float(1), far));
    hair.iorNode = mix(float(1.5), float(HAIR_IOR), onHead);
    hair.specularColorNode = mix(tinted, vec3(1, 1, 1).add(base.mul(HAIR_TRT)), onHead);
    hair.specularIntensityNode = mix(dimmed, hAO.mul(card), onHead);
  } else {
    hair.specularIntensityNode = dimmed;
    hair.specularColorNode = tinted;
  }
  hair.sheenNode = base.mul(0.5).add(vec3(1, 0.93, 0.85).mul(far.mul(HAIR_SHEEN))).mul(hAO);
  hair.sheenRoughnessNode = float(0.45);
  return { material: m, hair, state: { sweat: sweatU, lag, sway, wrist: wristU, hang: longHair, ponyAt, pony } };
}

/** Whether a person's hair mesh has a helmet (a MetaHuman groom's shell, at u past HAIR_U and v past HAIR_HELMET_V of the atlas). */
/**
 * Tangents for a MetaHuman's cards, along +u as three's own frame from screen derivatives has them, so the anisotropic
 * highlight runs the same way. That frame comes out zero on a card pressed nearly flat (`hairPush` lays hair thrown into the
 * back onto it), and the anisotropic lighting's bent normal then normalised a zero: a NaN the bloom spread into a white glare
 * over the shoulder. The mesh's own tangents are skinned with it and never vanish; where a triangle's UVs give none (a
 * degenerate one), any direction across the normal stands in. Once per geometry.
 */
function cardTangents(g: THREE.BufferGeometry): void {
  if (g.hasAttribute('tangent') || !g.index || !g.hasAttribute('normal') || !g.hasAttribute('uv')) return;
  g.computeTangents();
  const t = g.getAttribute('tangent') as THREE.BufferAttribute, nr = g.getAttribute('normal');
  const a = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < t.count; i++) {
    a.fromBufferAttribute(t, i);
    if (Number.isFinite(a.x + a.y + a.z + t.getW(i)) && a.lengthSq() > 1e-8) continue;
    n.fromBufferAttribute(nr, i);
    a.set(1, 0, 0).addScaledVector(n, -n.x);
    if (a.lengthSq() < 1e-4) a.set(0, 1, 0).addScaledVector(n, -n.y);
    a.normalize();
    t.setXYZW(i, a.x, a.y, a.z, 1);
  }
}

function hasHelmet(g: THREE.BufferGeometry): boolean {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return false;
  for (let i = 0; i < uv.count; i++) if (uv.getX(i) > HAIR_U && uv.getY(i) > HAIR_HELMET_V) return true;
  return false;
}

const BAKED_CLOTH_AMBIENT = 0.8;
/** How far a generated person's painted folds darken and lighten the team's colour (of the garment's middle brightness). */
const FOLD_MIN = 0.5, FOLD_MAX = 1.3;
/** A generated person's drawn lid and lips (half sizes, m). */
const EYE_WIDE = 0.0165, EYE_TALL = 0.0085, MOUTH_WIDE = 0.026, MOUTH_TALL = 0.0065;

/**
 * A person who is one fused surface with the look in its texture (the Meshy pilot, tools/assets/meshy/): the atlas's colour, its alpha
 * the skin (warm, lit by `PersonNodeMaterial` as the rest of the cast's skin), the rest matte cloth with a sheen; the tangent-space
 * normals baked from the full mesh over `clothNormal`, the team's shirt and shorts where kit-mask.py found them. Stubs: no hems (there is no separate cloth to lag), no sweat
 * patches, no hair cards (the second mesh is a speck inside the head).
 */
function bakedMaterial(asset: PlayerAsset, look: KitLook): { material: PersonNodeMaterial; hair: THREE.MeshPhysicalNodeMaterial; state: KitState } {
  const body = asset.look!;
  const sweatU = uniform(new THREE.Vector2());
  const sweat = sweatU.x;
  const tex = body.opaqueMap ? texture(body.opaqueMap, uv()) : vec4(0.8, 0.62, 0.5, 1);
  // (0.25 at no skin: decimate-bake.py)
  const skin = tex.w.sub(0.25).div(0.75).clamp();
  // Occlusion per vertex (rig.py, kept as the sock part's in bodyX.x): all of the ambient light, a little of the colour.
  const ao = attribute<'vec4'>('bodyX', 'vec4').x;
  // The team's shirt and shorts (kit-mask.py, the normal map's alpha): their colour by how much lighter or darker this texel is than
  // the garment's middle, which keeps the folds Meshy painted. (A 0.25 alpha is nothing, 0.62 the shirt, 1 the shorts.)
  const normalTex = body.clothNormal ? texture(body.clothNormal, uv()) : null;
  const band = normalTex ? normalTex.w : float(0.25);
  const shortsW = smoothstep(0.72, 0.9, band);
  const shirtW = smoothstep(0.32, 0.5, band).sub(shortsW);
  const lum = tex.xyz.dot(vec3(0.2126, 0.7152, 0.0722));
  const folds = (middle: number | undefined): THREE.Node<'float'> => lum.div(middle ?? 1).clamp(FOLD_MIN, FOLD_MAX);
  const kitC = (c: number): THREE.Node<'vec3'> => { const k = new THREE.Color(c); return vec3(k.r, k.g, k.b); };
  const cloth = tex.xyz
    .mul(float(1).sub(shirtW).sub(shortsW))
    .add(kitC(look.shirt).mul(folds(body.kit.shirtLum)).mul(shirtW))
    .add(kitC(look.shorts).mul(folds(body.kit.shortsLum)).mul(shortsW));
  // The eyes and mouth are paint on one surface, so what a lid and a parted lip do is drawn here, in the skin's own place on the body
  // (the rest pose, so a mouth's dark stretches with the lips as the jaw drops). x = blink, y = the jaw.
  const faceU = uniform(new THREE.Vector2());
  const { eye = [0, -9, 0], mouth = [0, -9, 0], lid = [0.5, 0.35, 0.3] } = body.kit;
  const rest = positionGeometry;
  const ring = (a: THREE.Node<'float'>, b: THREE.Node<'float'>): THREE.Node<'float'> => a.mul(a).add(b.mul(b));
  const onFace = smoothstep(eye[2] - 0.03, eye[2] - 0.02, rest.z);
  const eyeX = rest.x.abs().sub(eye[0]).div(EYE_WIDE), eyeY = rest.y.sub(eye[1]).div(EYE_TALL);
  const lidW = float(1).sub(smoothstep(0.6, 1.1, ring(eyeX, eyeY))).mul(onFace).mul(faceU.x);
  // (the lashes meet along the lid's lower edge)
  const lash = smoothstep(-0.95, -0.55, eyeY).mul(float(1).sub(smoothstep(-0.55, -0.15, eyeY))).mul(0.65);
  const lipsW = float(1).sub(smoothstep(0.45, 1, ring(rest.x.div(MOUTH_WIDE), rest.y.sub(mouth[1]).div(MOUTH_TALL)))).mul(onFace).mul(smoothstep(0.05, 0.2, faceU.y));
  const drawn = mix(mix(cloth, vec3(lid[0], lid[1], lid[2]).mul(float(1).sub(lash)), lidW), vec3(0.03, 0.012, 0.012), lipsW);
  const m = new PersonNodeMaterial();
  m.colorNode = drawn.mul(float(0.6).add(ao.mul(0.4)));
  m.aoNode = ao;
  m.side = THREE.DoubleSide;
  m.shadowSide = THREE.BackSide;
  m.roughnessNode = mix(float(0.86), mix(float(0.5), float(0.33), sweat), skin);
  m.metalnessNode = float(0);
  m.clearcoatNode = skin.mul(float(0.05).add(sweat.mul(0.35)));
  m.clearcoatRoughnessNode = float(0.32);
  m.sheenNode = mix(cloth, vec3(1, 1, 1), 0.3).mul(float(1).sub(skin).mul(0.6));
  m.sheenRoughnessNode = float(0.55);
  // (flat in the creases: the bake's normals on the walls of a fold are wild, and the fold opens when the arm lifts)
  if (normalTex) m.normalNode = uvNormal(normalTex.xy.mul(2).sub(1).mul(smoothstep(0.08, 0.4, ao)), uv());
  m.scatterNode = skin.mul(SKIN_SCATTER);
  // (the white shirt too, most of the way: under a lifted arm it showed the court's blue as a gash)
  m.ambientFixNode = mix(float(BAKED_CLOTH_AMBIENT), float(1), skin);
  m.toneBackNode = skin.mul(SKIN_TONE_BACK);
  return { material: m, hair: new PersonNodeMaterial(), state: { sweat: sweatU, lag: uniform(new THREE.Vector3()), sway: uniform(new THREE.Vector3()), face: faceU } };
}

/**
 * A skirt stays off the legs: each thigh, a tapered capsule from the hip to the knee where the skeleton has it this frame,
 * pushes the cloth out of itself (the weights alone leave a raised knee through the hem). The result is an offset for the
 * skinned position `at`. The bones are read where the mesh is drawn, so the capsules are the skeleton's own pose. `inset`: how far
 * inside that the cloth stops (the lining, which pushed onto the same surface as the skirt came through it in dark slivers).
 */
function thighsPush(asset: PlayerAsset, frame: KitFrame, at: THREE.Node<'vec3'>, inset: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const ids = [asset.bone('LeftUpLeg'), asset.bone('LeftLeg'), asset.bone('RightUpLeg'), asset.bone('RightLeg')];
  const ends = ids.map(() => uniform(new THREE.Vector3()));
  ends[0]!.onObjectUpdate((f) => {
    const mesh = f.object as THREE.SkinnedMesh;
    for (let i = 0; i < 4; i++) {
      const v = ends[i]!.value as THREE.Vector3;
      v.setFromMatrixPosition(mesh.skeleton.bones[ids[i]!]!.matrixWorld).applyMatrix4(mesh.bindMatrixInverse);
    }
  });
  const [r0, r1] = frame.thighR ?? [0.09, 0.06];
  const push = (a: THREE.Node<'vec3'>, b: THREE.Node<'vec3'>): THREE.Node<'vec3'> => {
    const ab = b.sub(a);
    const t = at.sub(a).dot(ab).div(ab.dot(ab)).clamp();
    const d = at.sub(a.add(ab.mul(t)));
    const l = d.length().max(1e-4);
    return d.mul(max(mix(float(r0), float(r1), t).add(SKIRT_CLEAR).sub(inset).sub(l), 0).div(l));
  };
  return push(ends[0]!, ends[1]!).add(push(ends[2]!, ends[3]!));
}

/**
 * The arms and hands out of the racket (the owner's realism list, 7 Nov, point 6: "the off-hand and forearm near the racket look
 * disconnected or clipping; fix the mesh and skinning WITHOUT changing the pose or animation"). In the ready position the free
 * hand is put on the throat by its wrist, and the throat ran through its palm. Nothing moves the bones: the skin of either
 * forearm and hand that lies inside the racket is moved to its surface, in the racket's own frame (racket.ts: y along it,
 * z through it): radially off the handle, and off the neck, the throat's arms and the head to the surface on the side its own
 * hand is on, so a palm comes to rest on the racket rather than split round it. Bones, the pose and the racket don't move.
 */
function racketPush(asset: PlayerAsset, at: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
  const range = (side: string): [number, number] | null => {
    const ids = asset.bones.map((b, i) => (b.name === side + 'ForeArm' || b.name.startsWith(side + 'Hand') ? i : -1)).filter((i) => i >= 0);
    if (!ids.length) return null;
    const lo = Math.min(...ids), hi = Math.max(...ids);
    return hi - lo + 1 === ids.length ? [lo, hi] : null;
  };
  const L = range('Left'), R = range('Right');
  if (!L || !R) return vec3(0, 0, 0);
  const idx = vec4(attribute('skinIndex', 'uvec4')), w = attribute<'vec4'>('skinWeight', 'vec4');
  const inRange = (b: THREE.Node<'float'>, [lo, hi]: [number, number]): THREE.Node<'float'> => step(lo - 0.5, b).mul(step(b, hi + 0.5));
  const weightOf = (r: [number, number]): THREE.Node<'float'> =>
    inRange(idx.x, r).mul(w.x).add(inRange(idx.y, r).mul(w.y)).add(inRange(idx.z, r).mul(w.z)).add(inRange(idx.w, r).mul(w.w));
  const wl = weightOf(L), wr = weightOf(R);
  // Mesh space to the racket's and back, and the side of the racket each hand is on (+-1 along its z), every frame.
  const toRacket = uniform(new THREE.Matrix4()), fromRacket = uniform(new THREE.Matrix4()), sides = uniform(new THREE.Vector2(1, 1));
  const hands = [asset.bone('LeftHand'), asset.bone('RightHand')];
  toRacket.onObjectUpdate((f) => {
    const mesh = f.object as THREE.SkinnedMesh;
    const bones = mesh.skeleton.bones;
    let racket: THREE.Object3D | null = null;
    for (let h = 0; h < 2 && !racket; h++) {
      const kids = bones[hands[h]!]!.children;
      for (let k = 0; k < kids.length; k++) if (kids[k]!.name === 'racket') { racket = kids[k]!; break; }
    }
    const m = toRacket.value as THREE.Matrix4, back = fromRacket.value as THREE.Matrix4, sv = sides.value as THREE.Vector2;
    if (!racket) { m.makeTranslation(0, 100, 0); return; }  // (no racket: everything far from it)
    m.copy(racket.matrixWorld).invert().multiply(mesh.matrixWorld);
    back.copy(m).invert();
    for (let h = 0; h < 2; h++) {
      RP_V.setFromMatrixPosition(bones[hands[h]!]!.matrixWorld);
      RP_M.copy(racket.matrixWorld).invert();
      RP_V.applyMatrix4(RP_M);
      if (h === 0) sv.x = RP_V.z < 0 ? -1 : 1; else sv.y = RP_V.z < 0 ? -1 : 1;
    }
  });
  const q = toRacket.mul(vec4(at, 1)).xyz;
  const C = RACKET_CLEAR;
  // The handle: off its axis to its radius.
  const r = vec2(q.x, q.z).length().max(1e-4);
  const radial = vec3(q.x, 0, q.z).mul(max(float(HANDLE_R + C).sub(r), 0).div(r))
    .mul(step(RACKET_BUTT - C, q.y)).mul(float(1).sub(smoothstep(HANDLE_TOP - RACKET_JOIN, HANDLE_TOP + RACKET_JOIN, q.y)));
  // The neck, the throat and the head, slice by slice across y, as the frame's own section (racket.ts): flat faces at +-FACE_T2,
  // a superellipse edge RC deep round the outline and RC_H round the throat's opening, which is empty. Skin inside goes to the
  // nearest point of the section on its own hand's side (a palm through the racket rests on its own face): flat on the face, out
  // from the edge's centre in an edge. Only skin within about a finger's thickness of that surface: deeper skin is a finger
  // wrapped round behind the frame, and pressed onto the near side it showed as flat slivers on the frame (and skin sent to the
  // far side left a gap in the near side's skin, through which the racket showed as a dark crease).
  const throatW = float(RACKET_NECK_W).add(q.y.sub(RACKET_NECK_TOP).max(0).mul(RACKET_ARM_SLOPE));
  const e = q.y.sub(RACKET_HEAD_C).div(RACKET_HEAD_B);
  const headW = float(RACKET_HEAD_A).mul(float(1).sub(e.mul(e)).max(0).sqrt());
  const halfW = select(q.y.lessThan(RACKET_HEAD_Y), throatW, max(headW, throatW.mul(step(q.y, RACKET_HEAD_Y + 0.02))));
  const xo = halfW.sub(RACKET_ARM_ACROSS).max(0).mul(step(q.y, RACKET_OPEN_TOP));
  const rin = step(1e-5, xo).mul(RC_H), ci = xo.add(rin);
  const edgeR = halfW.sub(ci).clamp(0, RC), co = halfW.sub(edgeR), ax = q.x.abs(), T = float(FACE_T2 + C);
  const inY = smoothstep(HANDLE_TOP - RACKET_JOIN, HANDLE_TOP + RACKET_JOIN, q.y).mul(step(q.y, RACKET_TIP + C));
  const s = wl.mul(sides.x).add(wr.mul(sides.y)).div(wl.add(wr).max(1e-4)).sign();
  // flat: to the face; the edges: along the ray from the edge's centre (mirrored to the hand's side) to the superellipse with
  // half axes (edge + C, T)
  const outer = ax.greaterThan(co), inner = ax.lessThan(ci);
  const capR = select(outer, edgeR, rin).add(C), capC = select(outer, co, ci);
  const u = ax.sub(capC).abs().div(capR), vh = q.z.abs().div(T);
  const f = u.pow(PROFILE_E).add(vh.pow(PROFILE_E)).max(1e-6), g = f.pow(-1 / PROFILE_E);
  const capIn = step(f, 1);
  const capDx = select(outer, co.add(u.mul(g).mul(capR)), ci.sub(u.mul(g).mul(capR))).sub(ax);
  const capDz = s.mul(vh).mul(g).mul(T).sub(q.z);
  const flatIn = step(q.z.abs(), T);
  const isCap = outer.or(inner);
  const dx = select(isCap, capDx.mul(capIn), float(0)), dz = select(isCap, capDz.mul(capIn), s.mul(T).sub(q.z).mul(flatIn));
  const reach = float(1).sub(smoothstep(RACKET_PUSH_FULL, RACKET_PUSH_MAX, vec2(dx, dz).length()));
  const plate = vec3(q.x.sign().mul(dx), 0, dz).mul(reach).mul(inY);
  const push = fromRacket.mul(vec4(radial.add(plate), 0)).xyz;
  return push.mul(wl.add(wr).min(1));
}
const RP_V = new THREE.Vector3();
const RP_M = new THREE.Matrix4();
/** How far outside the racket the skin is kept (m). */
const RACKET_CLEAR = 0.002;
/** Half the span over y where the handle's round hands over to the neck's section (m). */
const RACKET_JOIN = 0.004;
/** The throat (racket.ts outerDense, measured on the four looks): the neck's half width straight up to RACKET_NECK_TOP, then the
 * arms widening this much per metre up; the arms' width across (25-29 mm), and the top of the opening under the bridge (y, m). */
const RACKET_NECK_W = 0.0155;
const RACKET_NECK_TOP = -0.151;
const RACKET_ARM_SLOPE = 1.29;
const RACKET_ARM_ACROSS = 0.027;
const RACKET_OPEN_TOP = -0.105;
/** Skin pushed out by up to RACKET_PUSH_FULL goes all the way; by RACKET_PUSH_MAX or more it stays (m). */
const RACKET_PUSH_FULL = 0.008;
const RACKET_PUSH_MAX = 0.014;
/** Where the arms leave the head (y, racket.ts headHalf's last points), and the round head's ellipse (racket.ts: a, b and its
 * centre; the teardrop and the diamond are within a centimetre of it). */
const RACKET_HEAD_Y = -0.095;
const RACKET_HEAD_A = 0.13, RACKET_HEAD_B = 0.14, RACKET_HEAD_C = RACKET_TIP - 0.0009 - 0.14;

/**
 * The kit's detail, all in the kit's own colours: side panels and seams, a cuff, small invented marks on the chest, sleeve,
 * back and leg (never a real brand), a stripe down the shorts, a band round a skirt's hem, a polo's placket, a dress's skirt in
 * the shirt's colour. Patterns are fixed
 * to the body's modelled pose (`p`); on the arm, where that is lower than the rest pose, X.zw (the rest pose) hold them.
 * Anything finer than a pixel can show fades to its average, or it would shimmer at the TV camera's distance.
 */
function kitDetail(look: KitLook, cut: KitCut, frame: KitFrame, p: THREE.Node<'vec3'>, X: THREE.Node<'vec4'>, paint?: Paint, asset?: PlayerAsset):
{ shirtC: THREE.Node<'vec3'>; shortsC: THREE.Node<'vec3'>; sockC: THREE.Node<'vec3'>; skinCut: THREE.Node<'float'> } {
  const rgb = (c: number): THREE.Node<'vec3'> => { const k = new THREE.Color(c); return vec3(k.r, k.g, k.b); };
  const trim = rgb(look.trim), shirt = rgb(look.shirt);
  const ax = p.x.sub(frame.chest.x).abs(), tx = X.z, ty = X.w;
  const armX = frame.armX ?? 0.2, armY = frame.armY ?? frame.chest.y, armZ = frame.armZ ?? 0, nk = frame.neck ?? frame.chest;
  const front = step(frame.chest.z, p.z);
  const fine = footprintKeep(0.011);
  const line = (d: THREE.Node<'float'>, w = 0.0028): THREE.Node<'float'> => smoothstep(w, w * 0.4, d.abs()).mul(fine);
  // The side panel, under the arm to the hem, a little narrower at the waist.
  const panelUp = smoothstep(frame.hemY, armY - 0.12, p.y);
  const panelW = mix(float(PANEL_HEM), float(PANEL_ARM), panelUp);
  const dz = p.z.sub(mix(float(frame.sideZ?.[0] ?? 0), float(frame.sideZ?.[1] ?? 0), panelUp)).abs();
  const below = smoothstep(armY - 0.075, armY - 0.095, p.y).mul(smoothstep(armX + 0.015, armX - 0.01, tx)).mul(smoothstep(0.05, 0.07, ax));
  const panel = smoothstep(panelW.add(0.0025), panelW, dz).mul(below);
  const panelEdge = line(dz.sub(panelW).sub(0.006)).mul(below);
  // A chosen pattern instead of the side panels (paint.ts patternAt; a chest band and a chevron stay off the sleeves), or
  // a costume's print instead of both, and of the marks (paint.ts printShirt).
  const pattern = paint?.pattern, print = paint?.print;
  const pat = print ? null : patternAt(pattern, p, normalGeometry, frame.chest.x, frame.chest.y, frame.hemY,
    asset && (pattern === 'band' || pattern === 'chevron') ? armWeight(asset) : float(0));
  let s = print ? printShirt(print, shirt, trim, p, { chest: frame.chest, neck: nk, hemY: frame.hemY }, asset ? armWeight(asset) : float(0))
    : pat ? mix(shirt, trim, pat) : mix(shirt, trim, panel);
  if (!pat && !print) s = s.mul(float(1).sub(panelEdge.mul(0.18)));
  // Seams: over the shoulder, and round the sleeve's root or, on a raglan, from the neck to the armpit.
  const shoulder = line(p.z.sub(nk.z - 0.016)).mul(step(armY - 0.01, p.y)).mul(step(0.05, ax));
  let seams: THREE.Node<'float'> = float(0);
  let skinCut: THREE.Node<'float'> = float(0);
  const hole = cut.top === 'tank' ? tankCut(frame) : cut.top === 'sleeveless' ? sleevelessCut(frame) : null;
  if (!hole) {
    const nx = 0.72, ny = 0.694; // the raglan's line (normal) in the rest pose's (out, up)
    seams = cut.seam === 'raglan' ? line(tx.sub(0.07).mul(nx).add(ty.sub(nk.y - 0.015).mul(ny))).mul(step(armY - 0.11, ty))
      : shoulder.add(line(tx.sub(armX + 0.02)));
    // The cuff, in the kit's second colour (a costume's in its suit's, but for a tuxedo's shirt cuff and an astronaut's ring).
    s = mix(s, print && print !== 'tux' && print !== 'astro' ? shirt : trim, smoothstep(float(frame.sleeveX ?? 9).sub(CUFF + 0.0015), float(frame.sleeveX ?? 9).sub(CUFF), tx));
  } else {
    // A tank's or a sleeveless shirt's armhole has a binding, along the cut (person_kit.py cut_tank, person_wear.py SLEEVELESS).
    const { a, no, floor } = hole;
    const d = ax.sub(a.x).mul(no.x).add(p.y.sub(a.y).mul(no.y));
    s = mix(s, trim, smoothstep(float(-CUFF - 0.0015), float(-CUFF), d).mul(floor === undefined ? 1 : step(floor, p.y)));
    // The skin under that edge: the shirt's triangles are coarser than the shoulder's, and it came through in teeth. Down
    // to the shirt's hem: above it, in the armpit, it came through in patches; below, this slab would cut the legs.
    skinCut = smoothstep(-UNDER_ARMHOLE + 0.001, -UNDER_ARMHOLE - 0.001, d).mul(step(armX - 0.09, ax)).mul(smoothstep(a.y + 0.01, a.y, p.y)).mul(step(floor ?? frame.hemY + 0.05, p.y));
  }
  s = s.mul(float(1).sub(seams.mul(0.16)));
  // Marks, drawn in metres from their centre.
  const e = 0.0007;
  const box = (q: THREE.Node<'vec2'>, cx: number, cy: number, hx: number, hy: number): THREE.Node<'float'> =>
    smoothstep(e, 0, max(q.x.sub(cx).abs().sub(hx), q.y.sub(cy).abs().sub(hy)));
  const dist = (q: THREE.Node<'vec2'>, cx: number, cy: number): THREE.Node<'float'> => q.sub(vec2(cx, cy)).length();
  const maker = (q: THREE.Node<'vec2'>): THREE.Node<'float'> => {
    const k = (cut.mark ?? 0) % 4;
    const bar = box(q, 0.008, 0, 0.0155, 0.003);
    const head = k === 0 ? smoothstep(0.0082 + e, 0.0082, dist(q, -0.0165, 0))
      : k === 1 ? smoothstep(0.0028 + e, 0.0028, dist(q, -0.0165, 0).sub(0.0075).abs())
        : k === 2 ? smoothstep(0.0115 + e, 0.0115, q.x.add(0.0165).abs().add(q.y.abs()))
          : max(smoothstep(0.0046 + e, 0.0046, dist(q, -0.0205, 0.002)), smoothstep(0.0046 + e, 0.0046, dist(q, -0.0115, -0.002)));
    return max(head, bar);
  };
  /** A word: uneven blocks on a line, read as letters from a few metres. */
  const word = (q: THREE.Node<'vec2'>, hx: number, hy: number, seed: number): THREE.Node<'float'> =>
    box(q, 0, 0, hx, hy).mul(smoothstep(-0.3, 0.05, sin(q.x.div(hy).mul(1.9).add(seed)).add(sin(q.x.div(hy).mul(1.17).add(seed * 2.3)))));
  const chest = (x: number, y: number): THREE.Node<'vec2'> => vec2(p.x.sub(x), p.y.sub(frame.chest.y + y));
  const onTank = cut.top === 'tank' ? -0.012 : 0;
  const chestL = maker(chest(MARK_X, MARK_Y + onTank));
  const chestR = word(chest(-MARK_X, MARK_Y + onTank), 0.03, 0.006, 1.3 + (cut.mark ?? 0));
  const back = word(vec2(p.x, p.y.sub(frame.chest.y + 0.125)), 0.075, 0.012, 2.2 + (cut.mark ?? 0)).mul(step(p.z, frame.chest.z));
  const sleeve = hole ? float(0) : word(vec2(tx.sub(armX + 0.085), p.z.sub(armZ)), 0.028, 0.0055, 0.7 + (cut.mark ?? 0))
    .mul(step(armY, ty)).mul(step(0, p.x));
  const marks = chestL.add(chestR).mul(front).add(back).add(sleeve).min(1).mul(fine).mul(smoothstep(armX + 0.2, armX + 0.15, tx));
  if (!print) s = mix(s, trim, marks);
  // A polo's placket: a strip down from the neck with two buttons.
  if (cut.top === 'polo') {
    const nkLow = nk.y - (frame.collarDrop ?? COLLAR_DROP);
    const cx = p.x.sub(nk.x);
    const placket = smoothstep(0.0135, 0.012, cx.abs()).mul(smoothstep(nkLow - PLACKET - 0.0015, nkLow - PLACKET, p.y)).mul(front);
    s = mix(s, mix(shirt, trim, 0.82), placket);
    const button = (y: number): THREE.Node<'float'> => smoothstep(0.0048, 0.0036, vec2(cx, p.y.sub(nkLow - y)).length());
    s = mix(s, shirt, button(0.03).add(button(0.062)).mul(front).mul(fine));
  }
  // Shorts: the shirt's colour down the outside of the leg, a small mark over the hem; a skirt: the same colour round its hem.
  const legX = frame.legX ?? 0.09, legZ = frame.legZ ?? 0, hang = X.x;
  let b = rgb(look.shorts);
  if (print) {
    // (a costume's tights are its suit's, whatever their colour: paint.ts printBottom)
    const stripe = smoothstep(0.0145, 0.0125, p.z.sub(legZ).abs()).mul(smoothstep(legX + 0.015, legX + 0.03, p.x.abs()));
    b = printBottom(print, b, trim, p, normalGeometry, stripe);
  } else if (new THREE.Color(look.shorts).getHSL({ h: 0, s: 0, l: 0 }).l > 0.45) {
    // Tights (on the ramp's UVs) in the shorts' colour, or near black under light shorts: white tights read as bare legs at a distance.
    b = mix(b, rgb(0x1c1d22), onRamp());
  }
  if (print) {
    // (no skirt, stripe or mark on a costume)
  } else if (cut.bottom === 'pleated' || cut.bottom === 'aline') {
    // (the outside only: on the lining or the cloth's inside, under a lifted hem, it read as a torn flap)
    const band = smoothstep(float(SKIRT_BAND - 0.003), float(SKIRT_BAND), hang).mul(step(uv().y, SKIRT_OUT_V)).mul(float(frontFacing));
    if (cut.dress) {
      // A dress: the skirt is the shirt's cloth and pattern (the shorts under it keep theirs; only a skirt has a hang), its hem's
      // band in the trim. (Its top is up under the shirt's hem by then.)
      b = mix(b, pat ? mix(shirt, trim, pat) : shirt, smoothstep(0, 0.02, hang));
      b = mix(b, trim, band);
    } else b = mix(b, shirt, band);
  } else {
    const stripe = smoothstep(0.0145, 0.0125, p.z.sub(legZ).abs()).mul(smoothstep(legX + 0.015, legX + 0.03, p.x.abs())).mul(float(1).sub(onRamp()));
    b = mix(b, shirt, stripe);
    const leg = maker(vec2(p.x.sub(legX + 0.015), p.y.sub(frame.shortsHemY + 0.07)).mul(1.1)).mul(step(legZ + 0.02, p.z)).mul(fine);
    b = mix(b, shirt, leg);
  }
  // (a band or a visor is on the sock part's colours, up on the head)
  const sockC = mix(rgb(look.socks), trim, step(frame.hips.y, p.y));
  return { shirtC: s, shortsC: b, sockC, skinCut };
}

/**
 * A sleeveless shirt's armhole, out at the shoulder's end: person_wear.py SLEEVELESS. Its binding and the skin cut under it end
 * at `floor`, the armhole's bottom: the plane leans on in under the arm, and the shirt's sides at the waist lie past it
 * (person_wear.cut_sleeves keeps them).
 */
function sleevelessCut(frame: KitFrame): { a: THREE.Vector2; no: THREE.Vector2; floor: number } {
  const armX = frame.armX ?? 0.2, armY = frame.armY ?? frame.chest.y;
  const a = new THREE.Vector2(armX + 0.018, armY + 0.05), b = new THREE.Vector2(armX - 0.004, armY - 0.16);
  return { a, no: new THREE.Vector2(a.y - b.y, b.x - a.x).normalize(), floor: b.y - 0.02 };
}

/** Generated cloth (long sleeves past a tee's hem, tights): its UVs are on the atlas's ramp (finish-player.py RECT 'ramp', below v 0.25
 * and left of the skirt's rectangle), where its baked occlusion is looked up. 1 there. */
function onRamp(): THREE.Node<'float'> {
  return step(uv().y, 0.25).mul(step(uv().x, 0.833));
}

/** A tank's armhole in (out from the chest, height), a plane from the shoulder's top to under the arm: person_kit.py cut_tank. */
function tankCut(frame: KitFrame): { a: THREE.Vector2; no: THREE.Vector2; floor?: number } {
  const armX = frame.armX ?? 0.2, armY = frame.armY ?? frame.chest.y;
  const a = new THREE.Vector2(armX - 0.035, armY + 0.07), b = new THREE.Vector2(armX - 0.01, armY - 0.15);
  return { a, no: new THREE.Vector2(a.y - b.y, b.x - a.x).normalize() };
}

const edge = (lo: number, hi: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

/**
 * `personMaterial`'s mask in plain numbers, for the tests' software rendering (tests/render/kit.test.ts): is this point of a body
 * (modelled pose, with its shirt's and skin's weights) cut away?
 */
export function personCut(asset: PlayerAsset, paint?: Paint): (x: number, y: number, z: number, shirtW: number, skinW: number) => boolean {
  const frame = personFrame(asset);
  const nk = frame.neck ?? frame.chest, drop = frame.collarDrop ?? COLLAR_DROP, curve = frame.collarCurve ?? COLLAR_CURVE;
  // (the cut drawn, paint.ts cutFor: a chosen tank's or sleeveless shirt's armhole, a V-neck's V)
  const top = cutFor(asset, paint).top;
  const tank = top === 'tank' ? tankCut(frame) : top === 'sleeveless' ? sleevelessCut(frame) : null;
  const vneck = top === 'vneck' ? asset.look!.wardrobe?.vneck : undefined;
  const armX = frame.armX ?? 0.2;
  return (x, y, z, shirtW, skinW) => {
    const cx = x - nk.x;
    let cy = y - (nk.y - drop) - cx * cx * curve;
    if (vneck) cy = Math.max(cy, y - (nk.y - vneck[0]) - Math.abs(cx) * vneck[1]);
    if ((COLLAR_MID + Math.min(cy, z - (nk.z - 0.01)) * COLLAR_SCALE) * shirtW >= COLLAR_MID) return true;
    const under = edge(-UNDER_NECKLINE, -UNDER_NECKLINE - 0.0005, cy) * edge(nk.z - 0.01, nk.z - 0.005, z) * edge(0.1, 0.09, Math.abs(cx)) * edge(nk.y - 0.3, nk.y - 0.28, y) * skinW;
    if (under >= 0.5) return true;
    if (!tank) return false;
    const ax = Math.abs(x - frame.chest.x), d = (ax - tank.a.x) * tank.no.x + (y - tank.a.y) * tank.no.y;
    const cut = edge(-UNDER_ARMHOLE + 0.001, -UNDER_ARMHOLE - 0.001, d) * (ax < armX - 0.09 ? 0 : 1) * edge(tank.a.y + 0.01, tank.a.y, y) * (y < (tank.floor ?? frame.hemY + 0.05) ? 0 : 1);
    return cut * skinW >= 0.5;
  };
}

/** `personMaterial`'s sway in plain numbers, for a test: how much of the lag moves vertex `i`, by its modelled height. */
export function personSway(asset: PlayerAsset): (i: number) => number {
  const frame = personFrame(asset), g = asset.geometry;
  const pos = g.getAttribute('position').array as Float32Array, A = g.getAttribute('bodyA').array as Float32Array, X = g.getAttribute('bodyX').array as Float32Array;
  return (i) => {
    const y = pos[i * 3 + 1]!, shirtW = A[i * 4]!, shortsW = A[i * 4 + 1]!;
    return edge(frame.chest.y, frame.hemY, y) * shirtW + edge(frame.hips.y - 0.05, frame.shortsHemY, y) * shortsW * 0.6 * (X[i * 4]! * shortsW < 0.001 ? 1 : 0);
  };
}

const PERSON_FRAMES = new WeakMap<PlayerAsset, KitFrame>();
/** How far below the Neck joint (m, rest pose) the shirt's front is cut. */
const COLLAR_DROP = 0.065;
/** The neckline's rise to the sides of the neck (m per m squared): level with the neck joint 7.5 cm out. */
const COLLAR_CURVE = 11.5;
/** The field's value at the neckline and its slope (per m), stored in bodyX.y for the cut and the ribbed band. */
const COLLAR_MID = 0.5;
const COLLAR_SCALE = 2.5;
/** The ribbed band's width round the back of the neck; the cuff's, the armhole's binding; the placket's length (m). */
const COLLAR_RIB = 0.016;
/** How far out from the spine that band goes (m): where the neck hole turns forward, as the neckline's sides rise level with the neck. */
const COLLAR_BACK = 0.08;
const CUFF = 0.016;
const PLACKET = 0.085;
/** The side panel's half width over the ribs at the arm and at the hem; the chest's marks in from the middle and up from the Spine2 joint (m). */
const PANEL_ARM = 0.02;
const PANEL_HEM = 0.026;
const MARK_X = 0.082;
const MARK_Y = 0.07;
/** How far a skirt's hem trails as a multiple of the hems' lag; how far it stands off a thigh (m); where its hem's band starts (0-1 down the skirt). */
const SKIRT_SWING = 1.6;
const SKIRT_CLEAR = 0.012;
/** Down a skirt (its hang), where the thighs' push starts and where it is whole; how far inside the skirt its lining stops (m). */
const SKIRT_PUSH: [number, number] = [0.1, 0.2];
const SKIRT_LINING_IN = 0.006;
const SKIRT_BAND = 0.94;
/** Atlas v above which a skirt's texels are its lining (person_kit.py SKIRT_BANDS and LINING_V, in finish-player.py's RECT: both
 * skirts' outsides end by SKIRT_V, 0.23 in the atlas; the linings are at 0.2425). */
const SKIRT_OUT_V = 0.236;

/**
 * A person's landmarks (rest pose) and per-vertex sweat weights (bodyX.x on the shirt: where a shirt gets wet first,
 * as the mannequin's kit), computed once per asset.
 */
export function personFrame(asset: PlayerAsset): KitFrame {
  let frame = PERSON_FRAMES.get(asset);
  if (frame) return frame;
  const g = asset.geometry;
  const rest = asset.restPos;
  const A = g.getAttribute('bodyA').array as Float32Array;
  const n = rest.length / 3;
  const chest = at(asset, 'Spine2'), hips = at(asset, 'Hips');
  const halfSpan = Math.abs(at(asset, 'LeftArm').x - at(asset, 'RightArm').x) / 2;
  const g3 = (dx: number, dy: number, dz: number, rx: number, ry: number, rz: number): number =>
    Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2));
  const X = g.getAttribute('bodyX').array as Float32Array;
  // Landmarks come from what they were modelled in: the other cuts in their wardrobe (asset.ts Wardrobe) lie over the same body, and a
  // long sleeve or tights would move the sleeve's end and the shorts' hem.
  const W = asset.look?.wardrobe ?? null;
  const modelled = modelledVertices(asset);
  // The shirt's front collar: skinned to the chest, it comes out through the neck under the chin as the head bows (a
  // pale band under every jaw: review round 4, the critic's #1). It goes, and the neckline opens over the neck's skin.
  const neck = at(asset, 'Neck');
  const index = g.getIndex()!;
  const tri = index.array;
  const kept: number[] = [];
  // How far inside the neckline a shirt vertex is (m): a scoop, low in front and rising to the sides of the neck. The
  // shader cuts along its zero (bodyX.y), so the edge runs smoothly across the triangles: dropped whole, they left a
  // torn edge (review round 6, the critic's #7). Only triangles well inside go.
  // The cut has to fall inside the shirt everywhere, or the shirt's own neck hole is the edge, in straight pieces (a shirt
  // fitted to a narrower neck has a lower hole). Per bin of distance from the middle, the top of the shirt's front.
  const n0 = rest.length / 3;
  const top = new Float64Array(COLLAR_BINS).fill(-Infinity);
  let neckV = -1, neckD = Infinity;
  for (let i = 0; i < n0; i++) {
    const x = rest[i * 3]! - neck.x, y = rest[i * 3 + 1]!, z = rest[i * 3 + 2]! - neck.z;
    if (A[i * 4 + 2]! > 0.5) {
      // (the throat's base, low and off the middle: 5 cm over the joint was under the chin, and on half the cast the blur took
      // in the lip, which turned the chest in the collar salmon)
      const d = Math.hypot(Math.abs(x) - 0.02, y - neck.y + 0.02, z - 0.06);
      if (d < neckD) { neckD = d; neckV = i; }
    }
    if (A[i * 4]! < 0.5 || !modelled[i] || z < 0.01 || Math.abs(x) >= COLLAR_BINS * COLLAR_BIN) continue;
    const b = Math.floor(Math.abs(x) / COLLAR_BIN);
    if (y > top[b]!) top[b] = y;
  }
  // A shirt with a neck hole of its own (`KitCut.collar`): the neckline is that hole's shape, a parabola fitted to the bins'
  // tops (least squares in dx squared), and no deeper than it needs to be to stay inside it.
  let collarDrop = COLLAR_DROP, collarCurve = COLLAR_CURVE;
  if (asset.look?.kit.collar === 'own') {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let b = 0; b < COLLAR_BINS; b++) {
      if (top[b] === -Infinity) continue;
      const x = ((b + 0.5) * COLLAR_BIN) ** 2, y = neck.y - top[b]!;
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const den = n * sxx - sx * sx;
    if (n >= 2 && den > 0) collarCurve = Math.max(0, -(n * sxy - sx * sy) / den);
    collarDrop = 0;
  }
  for (let b = 0; b < COLLAR_BINS; b++) {
    if (top[b] === -Infinity) continue;
    const dx = (b + 0.5) * COLLAR_BIN;
    collarDrop = Math.max(collarDrop, neck.y + collarCurve * dx * dx - top[b]! + COLLAR_EDGE);
  }
  collarDrop = Math.min(collarDrop, COLLAR_MAX);
  const uvA = g.getAttribute('uv');
  const neckUv = neckV >= 0 ? new THREE.Vector2(uvA.getX(neckV), uvA.getY(neckV)) : new THREE.Vector2(0.25, 0.5);
  const inCollar = (v: number): number => {
    const dx = rest[v * 3]! - neck.x;
    return Math.min(rest[v * 3 + 1]! - (neck.y - collarDrop + collarCurve * dx * dx), rest[v * 3 + 2]! - (neck.z - 0.01));
  };
  for (let i = 0; i < n; i++) if (A[i * 4]! > 0.5) X[i * 4 + 1] = Math.min(1, Math.max(0, COLLAR_MID + inCollar(i) * COLLAR_SCALE));
  const gone = (v: number): boolean => A[v * 4]! > 0.5 && inCollar(v) > 0.04;
  for (let i = 0; i < tri.length; i += 3) {
    if (gone(tri[i]!) && gone(tri[i + 1]!) && gone(tri[i + 2]!)) continue;
    kept.push(tri[i]!, tri[i + 1]!, tri[i + 2]!);
  }
  g.setIndex(kept);
  let floorY = Infinity, shortsHemY = Infinity, hemY = Infinity, sleeveX = 0, backTop = -Infinity;
  const sleeveXOf: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3]!, y = rest[i * 3 + 1]!, z = rest[i * 3 + 2]!;
    const on = modelled[i] === 1;
    if (on) floorY = Math.min(floorY, y);
    if (on && A[i * 4 + 1]! > 0.5) shortsHemY = Math.min(shortsHemY, y);
    if (A[i * 4]! < 0.5) continue;
    const dx = x - chest.x;
    if (W) { const k = W.pieces[W.piece[i]!]!; sleeveXOf[k] = Math.max(sleeveXOf[k] ?? 0, Math.abs(dx)); }
    if (on) {
      hemY = Math.min(hemY, y);
      sleeveX = Math.max(sleeveX, Math.abs(dx));
      if (z < neck.z - 0.02 && Math.abs(x - neck.x) < 0.05) backTop = Math.max(backTop, y);
    }
    X[i * 4 + 2] = Math.abs(dx);
    X[i * 4 + 3] = y;
    X[i * 4] = Math.max(
      g3(dx, y - (chest.y + 0.02), z - (chest.z + 0.1), 0.06, 0.13, 0.09),
      g3(dx, y - (chest.y - 0.12), z - (chest.z - 0.1), 0.055, 0.26, 0.09),
      g3(Math.abs(dx) - halfSpan * 0.68, y - (chest.y + 0.02), z - chest.z, 0.05, 0.08, 0.09),
      0.7 * g3(dx, y - (hips.y + 0.12), z - (chest.z - 0.1), 0.1, 0.08, 0.1),
    );
  }
  (g.getAttribute('bodyX') as THREE.BufferAttribute).needsUpdate = true;
  // The wrist and elbow in the modelled pose: where the skin's weight passes from one bone to the next.
  const si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array as Float32Array, bind = g.getAttribute('position').array as Float32Array;
  const between = (b0: number, b1: number): THREE.Vector3 => {
    const c = new THREE.Vector3();
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (A[i * 4 + 2]! < 0.5) continue;
      let w0 = 0, w1 = 0;
      for (let k = 0; k < 4; k++) { if (si[i * 4 + k] === b0) w0 = sw[i * 4 + k]!; else if (si[i * 4 + k] === b1) w1 = sw[i * 4 + k]!; }
      if (w0 > 0.25 && w1 > 0.25) { c.x += Math.abs(bind[i * 3]!); c.y += bind[i * 3 + 1]!; c.z += bind[i * 3 + 2]!; m++; }
    }
    return c.multiplyScalar(1 / Math.max(1, m));
  };
  const wrist = between(asset.bone('LeftForeArm'), asset.bone('LeftHand')), elbow = between(asset.bone('LeftArm'), asset.bone('LeftForeArm'));
  const armJ = at(asset, 'LeftArm'), legJ = at(asset, 'LeftUpLeg'), kneeJ = at(asset, 'LeftLeg');
  // The thigh as a skirt must clear it (thighsPush), `t` along it from the hip joint (0) to the knee's (1): the outermost point
  // of a ring on the shorts worn under a skirt (the tight pair, 'under', where the modelled ones stand off the leg: paint.ts
  // piecesFor) down to their hem, then the skin's 90th percentile (the rest of a ring is the muscle's belly). Both counted, the
  // skin under the shorts (hidden, but there, and far denser) set a percentile: the capsule was the bare thigh's, and shorts
  // off it came out through a skirt's front in a ready stance.
  const legD = kneeJ.clone().sub(legJ), legL2 = legD.lengthSq();
  const wd = asset.look?.wardrobe;
  const shortsId = wd ? wd.pieces.indexOf((wd.ranges[wd.pieces.indexOf('under')]?.[1] ?? 0) > 0 ? 'under' : 'shorts') : -1;
  const onThigh: Array<{ u: number; r: number; shorts: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const shorts = wd ? wd.piece[i] === shortsId : A[i * 4 + 1]! > 0.5 && X[i * 4]! <= 0.01;
    if (!(shorts || (modelled[i] && A[i * 4 + 2]! > 0.5)) || rest[i * 3]! * legJ.x <= 0) continue;
    const x = rest[i * 3]! - legJ.x, y = rest[i * 3 + 1]! - legJ.y, z = rest[i * 3 + 2]! - legJ.z;
    const u = (x * legD.x + y * legD.y + z * legD.z) / legL2;
    const r = Math.hypot(x - u * legD.x, y - u * legD.y, z - u * legD.z);
    if (r < 0.16) onThigh.push({ u, r, shorts });
  }
  const shortsEnd = onThigh.reduce((m, v) => (v.shorts ? Math.max(m, v.u) : m), -Infinity);
  const thighAt = (t: number): number => {
    const ring = (shorts: boolean): number[] => onThigh.filter((v) => v.shorts === shorts && Math.abs(v.u - t) <= 0.06).map((v) => v.r).sort((a, b) => a - b);
    // (the shorts' outermost: their sculpted folds stand in ridges, and past a percentile they came through in slivers)
    const sh = ring(true);
    if (sh.length >= 6) return sh[sh.length - 1]!;
    const sk = ring(false);
    return sk[Math.floor(sk.length * 0.9)] ?? 0.08;
  };
  // (a line through the ring at 0.2 and the shorts' near their hem, so the capsule doesn't narrow inside them; never under the
  // skin's at the knee)
  const thighR = ((): [number, number] => {
    const rA = thighAt(0.2), tH = Math.min(0.92, shortsEnd - 0.05);
    if (!(tH > 0.4)) return [rA, thighAt(0.92)];
    const k = (thighAt(tH) - rA) / (tH - 0.2);
    return [rA - 0.2 * k, Math.max(rA + 0.8 * k, thighAt(0.92))];
  })();
  // The shirt's outline at a height: the middle of the front's and back's extents.
  const midZ = (y0: number): number => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (A[i * 4]! < 0.5 || !modelled[i] || Math.abs(rest[i * 3 + 1]! - y0) > 0.03 || Math.abs(rest[i * 3]! - chest.x) > armJ.x * Math.sign(armJ.x)) continue;
      lo = Math.min(lo, rest[i * 3 + 2]!); hi = Math.max(hi, rest[i * 3 + 2]!);
    }
    return Number.isFinite(lo) ? (lo + hi) / 2 : chest.z;
  };
  frame = {
    chest: chest.clone(), hips: hips.clone(), hemY: Number.isFinite(hemY) ? hemY : hips.y - 0.02,
    shortsHemY: Number.isFinite(shortsHemY) ? shortsHemY : hips.y - 0.3,
    sideZ: [midZ(hemY + 0.04), midZ(armJ.y - 0.12)],
    armSpan: halfSpan * 2, sleeveX, sleeveXOf: W ? sleeveXOf : undefined, neck: neck.clone(), collarDrop, collarCurve, neckUv,
    floorY, footX: Math.abs(at(asset, 'LeftFoot').x), footZ: at(asset, 'LeftFoot').z,
    wrist, foreDir: wrist.clone().sub(elbow).normalize(),
    armX: Math.abs(armJ.x - chest.x), armY: armJ.y, armZ: armJ.z, legX: Math.abs(legJ.x), legZ: legJ.z,
    backTop: Number.isFinite(backTop) ? backTop : undefined, thighR,
  };
  PERSON_FRAMES.set(asset, frame);
  return frame;
}
