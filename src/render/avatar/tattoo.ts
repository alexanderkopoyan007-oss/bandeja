// A player's own tattoos (M5 phase D: a character's, app/character.ts TATTOOS): original line art drawn in the skin's
// shader on the racket arm's forearm and on the other leg's calf. No texture: the person's shader already holds most of
// the samplers a shader can use before Metal slows it down, so the five designs are distances worked out per pixel, in
// the limb's own coordinates (around it and along it, metres), and they go with the skin as it moves (the modelled pose's
// positions). A shader has the tattoo code only when its person has a tattoo (the player's own, never the dealt cast's),
// and which design shows where is uniforms, so changing it on the creator's turntable is live.
import * as THREE from 'three/webgpu';
import { abs, atan, clamp, cross, dot, float, fract, length, max, min, mix, round, sign, sin, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import type { PlayerAsset } from './asset.ts';

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

/** The designs, in the order the shader numbers them from 1 (0: none). Names as character.ts TATTOOS. */
export const TATTOO_DESIGNS = ['band', 'wave', 'vine', 'star', 'dots'] as const;

/** Which designs a player has: numbers into TATTOO_DESIGNS + 1 (0 none), and whether the racket arm is the left. */
export interface TattooChoice { arm: number; calf: number; left: boolean }

/** The ink: blue-black (linear), and how much of the skin it covers at its densest (healed ink lets a little through). */
const INK = new THREE.Color(0.03, 0.035, 0.045);
const INK_ALPHA = 0.85;
/** Lines (half width, m) and the soft edge of every mark (m: healed ink spreads a little). */
const LINE = 0.0007, SOFT = 0.0005;
/** A limb's tattooed stretch: the middle of the bone's own vertices, this share of its length either side of the middle. */
const REACH = 0.32;
/** A vertex counts as the limb's when this much of its skinning is that bone. */
const OWN_BONE = 0.8;
/** The skin a design can be on: no further from the limb's axis than this times its mean radius (a forearm's far side is
 * about 1.3 of the mean; the other leg is 7 or more away). */
const NEAR = 1.6;

/** A limb as the modelled pose has it: a point on its axis, the axis, the side a design is centred on (`out`, across the
 * axis), its mean radius and half its tattooed length (m). */
export interface Limb { o: THREE.Vector3; a: THREE.Vector3; out: THREE.Vector3; radius: number; half: number }

/**
 * The limb of bone `name` from its own vertices (those skinned OWN_BONE or more to it) in the modelled pose: their mean, the
 * principal direction of their spread (power iteration on the covariance), the radius as their mean distance off it.
 * `outward`: the side to face a design to, flattened across the axis.
 */
export function limbOf(asset: PlayerAsset, name: string, outward: THREE.Vector3): Limb | null {
  const g = asset.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  // (the skin's vertices only: bodyA's z is the skin, asset.ts)
  const skinPart = g.getAttribute('bodyA') as THREE.BufferAttribute | undefined;
  const bone = asset.bone(name);
  if (!pos || !si || !sw || bone < 0) return null;
  const pts: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (skinPart && skinPart.getZ(i) < 0.5) continue;
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) w += sw.getComponent(i, k);
    if (w >= OWN_BONE) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const n = pts.length / 3;
  if (n < 12) return null;
  const o = new THREE.Vector3();
  for (let i = 0; i < n; i++) o.x += pts[i * 3]!, o.y += pts[i * 3 + 1]!, o.z += pts[i * 3 + 2]!;
  o.multiplyScalar(1 / n);
  const c = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3]! - o.x, pts[i * 3 + 1]! - o.y, pts[i * 3 + 2]! - o.z];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) c[r * 3 + q]! += d[r]! * d[q]!;
  }
  const a = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3();
  for (let it = 0; it < 40; it++) {
    t.set(c[0]! * a.x + c[1]! * a.y + c[2]! * a.z, c[3]! * a.x + c[4]! * a.y + c[5]! * a.z, c[6]! * a.x + c[7]! * a.y + c[8]! * a.z);
    if (t.lengthSq() < 1e-20) return null;
    a.copy(t).normalize();
  }
  let lo = Infinity, hi = -Infinity, rad = 0;
  const d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.set(pts[i * 3]! - o.x, pts[i * 3 + 1]! - o.y, pts[i * 3 + 2]! - o.z);
    const s = d.dot(a);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
    rad += d.addScaledVector(a, -s).length();
  }
  // (centred on the middle of the bone's own stretch, not the vertices' mean: the wider end has more of them)
  o.addScaledVector(a, (lo + hi) / 2);
  const out = outward.clone().addScaledVector(a, -outward.dot(a));
  if (out.lengthSq() < 1e-8) return null;
  return { o, a, out: out.normalize(), radius: rad / n, half: ((hi - lo) / 2) * REACH * 2 };
}

/** The four limbs a tattoo can be on (model space: the model faces +z, +x is its left): a forearm's outside, a calf's back. */
export function tattooLimbs(asset: PlayerAsset): { armL: Limb | null; armR: Limb | null; calfL: Limb | null; calfR: Limb | null } {
  return {
    armL: limbOf(asset, 'LeftForeArm', new THREE.Vector3(1, 0, 0)),
    armR: limbOf(asset, 'RightForeArm', new THREE.Vector3(-1, 0, 0)),
    calfL: limbOf(asset, 'LeftLeg', new THREE.Vector3(0, 0, -1)),
    calfR: limbOf(asset, 'RightLeg', new THREE.Vector3(0, 0, -1)),
  };
}

const u4 = () => uniform(new THREE.Vector4());
type U4 = ReturnType<typeof u4>;

/** The uniforms of one tattooed stretch: its point, axis and side (xyz), and radius, half length, design (w of `o`, `a`, `out`). */
interface Region { o: U4; a: U4; out: U4 }

export interface TattooState {
  arm: Region;
  calf: Region;
  limbs: ReturnType<typeof tattooLimbs>;
}

function region(): Region {
  return { o: u4(), a: u4(), out: u4() };
}

function place(r: Region, limb: Limb | null, design: number): void {
  if (!limb || design <= 0) { r.out.value.w = 0; return; }
  r.o.value.set(limb.o.x, limb.o.y, limb.o.z, limb.radius);
  r.a.value.set(limb.a.x, limb.a.y, limb.a.z, limb.half);
  r.out.value.set(limb.out.x, limb.out.y, limb.out.z, design);
}

/** Show `choice` (null: none): the arm on the racket hand's side, the calf on the other. */
export function setTattoos(state: TattooState, choice: TattooChoice | null | undefined): void {
  const l = state.limbs;
  place(state.arm, choice?.left ? l.armL : l.armR, choice?.arm ?? 0);
  place(state.calf, choice?.left ? l.calfR : l.calfL, choice?.calf ?? 0);
}

/** Distance (m) from `q` to the segment a-b (2D). */
function segment(q: V2, a: THREE.Vector2, b: THREE.Vector2): F {
  const ba = vec2(b.x - a.x, b.y - a.y), pa = q.sub(vec2(a.x, a.y));
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
  return length(pa.sub(ba.mul(h)));
}

/** A vine's leaf: two circles of LEAF_R, LEAF_OFF either side of its midline (m); LEAF_ROUND converts its share of a turn to
 * metres on a typical forearm (the leaves are drawn the same size on any limb). */
const LEAF_R = 0.0068, LEAF_OFF = 0.0052, LEAF_ROUND = 0.033;
/** The five-pointed star's lines (a pentagram, 16 mm to its points). */
const STAR_R = 0.016;
// (its points round the circle in order; each line joins a point to the one two on, which draws the star, not a pentagon)
const STAR = Array.from({ length: 5 }, (_, k) => new THREE.Vector2(STAR_R * Math.sin((k * 2 * Math.PI) / 5), STAR_R * Math.cos((k * 2 * Math.PI) / 5)));

/**
 * The ink (0..1) of one design at `q` (x round the limb from its outside, y along it, m; `theta` the angle round it) for its
 * number `design` (1-5): every design is worked out and the one chosen kept (they are a few dozen operations).
 */
function designInk(q: V2, theta: F, design: F): F {
  const x = q.x, y = q.y;
  const ink = (d: F): F => smoothstep(SOFT, -SOFT, d);
  // 1 band: a solid ring 12 mm wide between two fine ones
  const band = max(ink(abs(y).sub(0.006)), ink(abs(abs(y).sub(0.0115)).sub(LINE)));
  // 2 wave: a ring that rises and falls seven times round
  const wave = ink(abs(y.sub(sin(theta.mul(7)).mul(0.007))).mul(0.8).sub(LINE));
  // 3 vine: a stem waving five times round, a leaf over each crest and under each trough
  const stem = ink(abs(y.sub(sin(theta.mul(5)).mul(0.006))).mul(0.85).sub(LINE * 0.8));
  const cell = fract(theta.mul(5 / (2 * Math.PI)).add(1));
  const up = sign(float(0.5).sub(cell));
  // (a leaf: the lens where two circles overlap, pointed at both ends, lying along the stem, 9 mm long)
  const lx = cell.sub(select2(up, 0.25, 0.75)).mul(((2 * Math.PI) / 5) * LEAF_ROUND), ly = y.sub(up.mul(0.0095));
  const leaf = ink(max(length(vec2(lx, ly.sub(LEAF_OFF))), length(vec2(lx, ly.add(LEAF_OFF)))).sub(LEAF_R));
  const vine = max(stem, leaf);
  // 4 star: a pentagram's outline on the limb's outside
  let d = segment(q, STAR[0]!, STAR[2]!);
  for (let k = 1; k < 5; k++) d = min(d, segment(q, STAR[k]!, STAR[(k + 2) % 5]!));
  const star = ink(d.sub(LINE));
  // 5 dots: five down the outside, 12 mm apart
  const yy = y.sub(clamp(round(y.div(0.012)), -2, 2).mul(0.012));
  const dots = ink(length(vec2(x, yy)).sub(0.0022));
  const pick = (k: number, v: F): F => v.mul(smoothstep(0.5, 0, abs(design.sub(k))));
  return pick(1, band).add(pick(2, wave)).add(pick(3, vine)).add(pick(4, star)).add(pick(5, dots));
}

/** a where s > 0, b where s < 0 (s is +1 or -1). */
function select2(s: F, a: number, b: number): F {
  return s.mul((a - b) / 2).add((a + b) / 2);
}

function regionInk(p: V3, r: Region): F {
  const { o: O, a: A, out: Out } = r;
  const d = p.sub(O.xyz);
  const s = dot(d, A.xyz);
  const across = d.sub(A.xyz.mul(s));
  const side = cross(A.xyz, Out.xyz);
  const theta = atan(dot(across, side), dot(across, Out.xyz));
  const q = vec2(theta.mul(O.w), s);
  // (only along the tattooed stretch, faded in over its last centimetre, and only on the limb itself: within NEAR of its
  // mean radius of the axis, or the other leg, the body or a hand crossing that stretch took the design too; none where no
  // design is set)
  const within = smoothstep(A.w.add(0.01), A.w, abs(s)).mul(smoothstep(O.w.mul(NEAR + 0.3), O.w.mul(NEAR), length(across)))
    .mul(smoothstep(0, 0.5, Out.w));
  return designInk(q, theta, Out.w).mul(within);
}

/**
 * The tattoos on a person's skin colour `col` at the modelled-pose position `p`: the ink over it where the skin is
 * (`skin`, 0..1). Returns the colour and the state that moves them (`setTattoos`).
 */
export function tattooed(asset: PlayerAsset, col: V3, p: V3, skin: F): { col: V3; state: TattooState } {
  const state: TattooState = { arm: region(), calf: region(), limbs: tattooLimbs(asset) };
  const inked = max(regionInk(p, state.arm), regionInk(p, state.calf)).clamp(0, 1).mul(INK_ALPHA).mul(skin);
  return { col: mix(col, vec3(INK.r, INK.g, INK.b), inked), state };
}
