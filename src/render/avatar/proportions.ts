// A body's proportions (M5, the character creator): a person, or the mannequin, built again on a skeleton with longer or
// shorter limbs, a bigger head, wider shoulders, more girth. Done once, when a player is dressed, by moving the bones'
// rest and bind positions and skinning the mesh again in its bind pose with a scale per bone: along the bone (its
// length) and across it (girth). Nothing changes per frame: the avatar measures its legs, arms and hips from the asset it
// is given (avatar.ts, soles.ts, grip.ts, capsules.ts, kit.ts all read restWorld and restPos), so the walk, the IK and the
// fitting follow the new body by themselves.
//
// Per bone i, with B its bind matrix (world) and S its scale (in its own frame, about its own origin):
//   a vertex moves by B' S B^-1, weighted as it is skinned;
//   a child's offset c (in i's frame) becomes S c, so the child's new origin is exactly where i's scaled mesh puts it:
//   both bones carry a vertex at a joint to the same place, and the skin can't tear there.
// Then the whole body is lowered or raised so its soles are where they were (the floor).
import * as THREE from 'three/webgpu';
import BODIES from '../../../data/bodies.json' with { type: 'json' };
import { legLength, pristineCopy, rebodied, type BoneDef, type BodyLook, type PlayerAsset } from './asset.ts';

/** Each a factor on the body as built (1 = unchanged). */
export interface Proportions {
  /** Everything (the body's height). */
  height: number;
  /** Thigh and shin. */
  legs: number;
  /** Upper arm and forearm. */
  arms: number;
  /** Hips to the base of the neck. */
  torso: number;
  neck: number;
  /** The collarbones: how far out the arms hang. */
  shoulders: number;
  /** The head, hair and face, all ways. */
  head: number;
  hands: number;
  feet: number;
  /** Girth: trunk, neck and limbs, across their bones (and the hips' and chest's width with them). */
  build: number;
}

export const PROPORTION_KEYS = ['height', 'legs', 'arms', 'torso', 'neck', 'shoulders', 'head', 'hands', 'feet', 'build'] as const;

export const NEUTRAL: Readonly<Proportions> = Object.freeze({
  height: 1, legs: 1, arms: 1, torso: 1, neck: 1, shoulders: 1, head: 1, hands: 1, feet: 1, build: 1,
});

/** The sliders' ranges: realistic, and ridiculous (the brief's giant heads and tiny legs). */
export const RANGES: Readonly<Record<'real' | 'silly', Readonly<Record<keyof Proportions, readonly [number, number]>>>> = {
  real: {
    height: [0.9, 1.1], legs: [0.9, 1.1], arms: [0.9, 1.1], torso: [0.9, 1.1], neck: [0.88, 1.12], shoulders: [0.88, 1.12],
    head: [0.92, 1.08], hands: [0.9, 1.1], feet: [0.9, 1.1], build: [0.88, 1.15],
  },
  silly: {
    height: [0.7, 1.3], legs: [0.65, 1.3], arms: [0.65, 1.6], torso: [0.7, 1.4], neck: [0.5, 2.2], shoulders: [0.6, 1.8],
    head: [0.7, 2.0], hands: [0.7, 2.0], feet: [0.7, 1.8], build: [0.7, 1.5],
  },
};

/**
 * The leg as the avatar measures it, hip joint to ankle (height x legs), against the person's: what the animation plays
 * within (bodiesQa*.test.ts). Shorter, the knees run near straight and every centimetre a full-size foot moves (its roll,
 * its sole's pin) is twice the share of the leg: at 0.55 the legs popped 23-31 times a minute (the limit is 30), at 0.6
 * 19-23, at 0.65 17-18, the same with everything else at its ridiculous end. Longer, the shoulders sit over the ball: at
 * 1.4 the racket missed it by 11 cm at p90 (the limit is 12), at 1.95 by 20-34 cm with the arms popping 60-77 times a minute.
 */
export const LEG_SPAN: readonly [number, number] = [0.65, 1.3];

/** `p` within the ridiculous ranges, its legs within LEG_SPAN for its height: every body built is one the tests play. */
export function fitted(p: Proportions): Proportions {
  const out = { ...p };
  for (const k of PROPORTION_KEYS) {
    const [lo, hi] = RANGES.silly[k];
    out[k] = Math.min(hi, Math.max(lo, Number.isFinite(p[k]) ? p[k] : 1));
  }
  const leg = out.height * out.legs;
  if (leg < LEG_SPAN[0]) out.legs = LEG_SPAN[0] / out.height;
  else if (leg > LEG_SPAN[1]) out.legs = LEG_SPAN[1] / out.height;
  return out;
}

/** A named body (data/bodies.json), or proportions written out (`head:2+legs:0.7`); unknown names and keys are ignored. */
export function bodyNamed(spec: string): Proportions {
  const named = (BODIES as Record<string, Partial<Proportions> | string>)[spec];
  const p: Proportions = { ...NEUTRAL };
  const set = (k: string, v: number): void => {
    if ((PROPORTION_KEYS as readonly string[]).includes(k) && Number.isFinite(v) && v > 0.2 && v < 5) p[k as keyof Proportions] = v;
  };
  if (named && typeof named === 'object') for (const [k, v] of Object.entries(named)) set(k, v as number);
  else for (const part of spec.split('+')) { const [k, v] = part.split(':'); if (k && v) set(k, Number(v)); }
  return p;
}

export function isNeutral(p: Proportions): boolean {
  return PROPORTION_KEYS.every((k) => p[k] === 1);
}

/** A key for the cache (and share codes): each factor to 3 places. */
export function proportionKey(p: Proportions): string {
  return PROPORTION_KEYS.map((k) => p[k].toFixed(3)).join(',');
}

/** What scales each bone: its length along it, its girth across it (a bone scaled 'all' ways takes `len` for both). */
interface BoneScale { len: number; girth: number }

function scaleOf(name: string, p: Proportions): BoneScale {
  const n = name.replace(/^(Left|Right)/, '');
  if (name === 'Hips' || /^Spine\d?$/.test(name)) return { len: p.torso, girth: p.build };
  if (name === 'Neck') return { len: p.neck, girth: p.build };
  if (name === 'Head' || name === 'HeadTop_End') return { len: p.head, girth: p.head };
  if (n === 'Shoulder') return { len: p.shoulders, girth: p.build };
  if (n === 'Arm' || n === 'ForeArm') return { len: p.arms, girth: p.build };
  if (n === 'Hand' || n.startsWith('Hand')) return { len: p.hands, girth: p.hands };
  if (n === 'UpLeg' || n === 'Leg') return { len: p.legs, girth: p.build };
  if (n === 'Foot' || n === 'ToeBase' || n === 'Toe_End') return { len: p.feet, girth: p.feet };
  return { len: 1, girth: 1 };
}

/** The child a bone runs to (its length's way): the spine's, the neck's, the middle finger's; else its only or first child. */
function mainChild(bones: readonly BoneDef[], i: number): number {
  let first = -1;
  for (let j = 0; j < bones.length; j++) {
    if (bones[j]!.parent !== i) continue;
    if (first < 0) first = j;
    if (/Spine|Neck|HandMiddle1$/.test(bones[j]!.name)) return j;
  }
  return first;
}

/** Per bone, S as a 3x3 (row-major) in the bone's own frame: len along `axis`, girth across it, times `h`. */
function scaleMatrix(axis: THREE.Vector3, s: BoneScale, h: number): number[] {
  const a = [axis.x, axis.y, axis.z], m: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const aa = a[r]! * a[c]!, id = r === c ? 1 : 0;
    m.push(h * (id + (s.len - 1) * aa + (s.girth - 1) * (id - aa)));
  }
  return m;
}

const mul3 = (m: number[], v: readonly number[]): number[] => [
  m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!,
  m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!,
  m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!,
];

/** S as a Matrix4 (no translation). */
function toM4(m: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().set(m[0]!, m[1]!, m[2]!, 0, m[3]!, m[4]!, m[5]!, 0, m[6]!, m[7]!, m[8]!, 0, 0, 0, 0, 1);
}

const CACHE = new WeakMap<PlayerAsset, Map<string, PlayerAsset>>();
/** Bodies kept per person (the creator makes a new one at every slider step). */
const CACHE_MAX = 8;

/**
 * `person` with proportions `p` (fitted first): the same asset when they're all 1, else a new asset (cached per person by
 * the proportions) built from a fresh parse of its file, with its textures.
 */
export function reproportion(person: PlayerAsset, given: Proportions): PlayerAsset {
  const p = fitted(given);
  if (isNeutral(p)) return person;
  const key = proportionKey(p);
  let cache = CACHE.get(person);
  if (!cache) { cache = new Map(); CACHE.set(person, cache); }
  const hit = cache.get(key);
  if (hit) return hit;
  const out = build(pristineCopy(person), p);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

function build(src: PlayerAsset, p: Proportions): PlayerAsset {
  const bones = src.bones, nb = bones.length, h = p.height;
  // The bind pose (world) and each bone's place in its parent's frame there (its translation is the rest's `pos`).
  const B = src.boneInverses.map((m) => m.clone().invert());
  const bindT: THREE.Vector3[] = [], bindQ: THREE.Quaternion[] = [];
  for (let i = 0; i < nb; i++) {
    const local = bones[i]!.parent < 0 ? B[i]!.clone() : B[bones[i]!.parent]!.clone().invert().multiply(B[i]!);
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(t, q, s);
    bindT.push(t);
    bindQ.push(q);
  }
  // Each bone's scale in its own frame, about its origin, along the way to its main child.
  const S: number[][] = [];
  for (let i = 0; i < nb; i++) {
    const c = mainChild(bones, i);
    const axis = c >= 0 ? new THREE.Vector3().fromArray(bones[c]!.pos).normalize() : new THREE.Vector3(0, 1, 0);
    if (!(axis.lengthSq() > 0.5)) axis.set(0, 1, 0);
    S.push(scaleMatrix(axis, scaleOf(bones[i]!.name, p), h));
  }
  // New offsets: a child's, scaled by its parent's S; the root's by the height alone.
  const off = (i: number, v: readonly number[]): number[] => (bones[i]!.parent < 0 ? [v[0]! * h, v[1]! * h, v[2]! * h] : mul3(S[bones[i]!.parent]!, v));
  const newBones: BoneDef[] = bones.map((b, i) => ({ name: b.name, parent: b.parent, pos: off(i, b.pos), quat: b.quat.slice() }));
  const one = new THREE.Vector3(1, 1, 1);
  const B2: THREE.Matrix4[] = [];
  for (let i = 0; i < nb; i++) {
    const t = off(i, bindT[i]!.toArray());
    const local = new THREE.Matrix4().compose(new THREE.Vector3(t[0], t[1], t[2]), bindQ[i]!, one);
    B2.push(bones[i]!.parent < 0 ? local : B2[bones[i]!.parent]!.clone().multiply(local));
  }
  // Per bone, what it does to a vertex in the bind pose (M = B' S B^-1), and to a normal (the inverse transpose of M's 3x3).
  const M = B2.map((b2, i) => b2.clone().multiply(toM4(S[i]!)).multiply(src.boneInverses[i]!));
  const N = M.map((m) => new THREE.Matrix3().setFromMatrix4(m).invert().transpose());

  const geometry = src.geometry.clone();
  skin(geometry, M, N);
  let look: BodyLook | null = null;
  if (src.look) {
    const alpha = src.look.alphaGeometry.clone();
    skin(alpha, M, N);
    const face = src.look.face;
    look = { ...src.look, alphaGeometry: alpha, kit: { ...src.look.kit } };
    if (face) {
      // The face's keys: deltas in the bind pose, moved by the same weighted 3x3s as the points they move.
      const g = src.geometry, si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
      const pos = face.pos.map((d) => deltas(d, face.verts, si, sw, M, false));
      const nrm = face.nrm.map((d) => deltas(d, face.verts, si, sw, N, true));
      look.face = { ...face, pos, nrm };
    }
    // The painted eye and mouth of a baked person (bind pose), with the head.
    const head = src.bone('Head'), kit = look.kit;
    for (const k of ['eye', 'mouth'] as const) {
      const v = kit[k];
      if (v) kit[k] = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(M[head]!).toArray() as [number, number, number];
    }
  }
  const inv = B2.map((b) => b.clone().invert());
  let out = rebodied(src, newBones, geometry, inv, look, 1);
  // Back onto the floor: the soles as low as they were (the root moves; every bone and vertex with it).
  const lowOld = lowest(src.restPos), lowNew = lowest(out.restPos), dy = lowOld - lowNew;
  const hipScale = (bones[0]!.pos[1]! * h + dy) / bones[0]!.pos[1]!;
  if (dy !== 0 || hipScale !== 1) {
    newBones[0]!.pos[1] = newBones[0]!.pos[1]! + dy;
    for (let i = 0; i < nb; i++) inv[i] = inv[i]!.clone().multiply(new THREE.Matrix4().makeTranslation(0, -dy, 0));
    shift(geometry, dy);
    if (look) {
      shift(look.alphaGeometry, dy);
      for (const k of ['eye', 'mouth'] as const) {
        const v = look.kit[k];
        if (v) look.kit[k] = [v[0], v[1] + dy, v[2]];
      }
    }
    out = rebodied(src, newBones, geometry, inv, look, hipScale);
  }
  if (look) {
    const was = look.height;
    look.height = highest(out.restPos) - lowest(out.restPos);
    if (was > 0) out.heightScale = look.height / was;
  }
  out.legScale = legLength(out) / legLength(src);
  return out;
}

/** Linear blend skinning of a geometry's positions and normals by the per-bone M and N, in place (it is a clone). */
function skin(g: THREE.BufferGeometry, M: THREE.Matrix4[], N: THREE.Matrix3[]): void {
  const P = g.getAttribute('position') as THREE.BufferAttribute, Nr = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
  const pos = P.array as Float32Array, nrm = Nr?.array as Float32Array | undefined;
  for (let v = 0; v < P.count; v++) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0;
    const ax = nrm ? nrm[v * 3]! : 0, ay = nrm ? nrm[v * 3 + 1]! : 0, az = nrm ? nrm[v * 3 + 2]! : 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k]!;
      if (w === 0) continue;
      const b = si[v * 4 + k]!, e = M[b]!.elements;
      ox += w * (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!);
      oy += w * (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!);
      oz += w * (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
      if (nrm) {
        const n = N[b]!.elements;
        nx += w * (n[0]! * ax + n[3]! * ay + n[6]! * az);
        ny += w * (n[1]! * ax + n[4]! * ay + n[7]! * az);
        nz += w * (n[2]! * ax + n[5]! * ay + n[8]! * az);
      }
    }
    pos[v * 3] = ox; pos[v * 3 + 1] = oy; pos[v * 3 + 2] = oz;
    if (nrm) {
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[v * 3] = nx / l; nrm[v * 3 + 1] = ny / l; nrm[v * 3 + 2] = nz / l;
    }
  }
  P.needsUpdate = true;
  if (Nr) Nr.needsUpdate = true;
  // The alpha mesh's keys (hair and brows move with the face): position and normal deltas, by the same weights.
  const mp = g.morphAttributes.position, mn = g.morphAttributes.normal;
  const ids = new Uint32Array(P.count).map((_, i) => i);
  if (mp) g.morphAttributes.position = mp.map((a) => new THREE.BufferAttribute(deltas(a.array as Float32Array, ids, si, sw, M, false), 3));
  if (mn) g.morphAttributes.normal = mn.map((a) => new THREE.BufferAttribute(deltas(a.array as Float32Array, ids, si, sw, N, true), 3));
  g.computeBoundingSphere();
}

/** Morph deltas over `verts` (ids into a skinned geometry), through each vertex's weighted 3x3s. */
function deltas(d: Float32Array, verts: ArrayLike<number>, si: ArrayLike<number>, sw: ArrayLike<number>, T: Array<THREE.Matrix4 | THREE.Matrix3>, normal: boolean): Float32Array {
  const out = new Float32Array(d.length);
  for (let j = 0; j < verts.length; j++) {
    const v = verts[j]!, x = d[j * 3]!, y = d[j * 3 + 1]!, z = d[j * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k]!;
      if (w === 0) continue;
      const e = T[si[v * 4 + k]!]!.elements;
      if (normal) {
        ox += w * (e[0]! * x + e[3]! * y + e[6]! * z);
        oy += w * (e[1]! * x + e[4]! * y + e[7]! * z);
        oz += w * (e[2]! * x + e[5]! * y + e[8]! * z);
      } else {
        ox += w * (e[0]! * x + e[4]! * y + e[8]! * z);
        oy += w * (e[1]! * x + e[5]! * y + e[9]! * z);
        oz += w * (e[2]! * x + e[6]! * y + e[10]! * z);
      }
    }
    out[j * 3] = ox; out[j * 3 + 1] = oy; out[j * 3 + 2] = oz;
  }
  return out;
}

function shift(g: THREE.BufferGeometry, dy: number): void {
  const P = g.getAttribute('position') as THREE.BufferAttribute, a = P.array as Float32Array;
  for (let v = 0; v < P.count; v++) a[v * 3 + 1] = a[v * 3 + 1]! + dy;
  P.needsUpdate = true;
  g.computeBoundingSphere();
}

function lowest(pos: Float32Array): number {
  let m = Infinity;
  for (let i = 1; i < pos.length; i += 3) if (pos[i]! < m) m = pos[i]!;
  return m;
}

function highest(pos: Float32Array): number {
  let m = -Infinity;
  for (let i = 1; i < pos.length; i += 3) if (pos[i]! > m) m = pos[i]!;
  return m;
}
