// M5 phase C step 3: what a player chooses for their suit. Colours, patterns, shoes and the overgrip are paint (the person's
// shader, kit.ts personMaterial). Cuts (a tank, a V-neck, long sleeves, a polo's collar, the skirts and a dress, tights, sock
// lengths) are garments built per body (tools/assets/mpfb/person_wear.py, person_kit.py), the ones worn drawn (`piecesFor`,
// asset.ts dressedIndex): repainting the modelled suit
// instead (skin on a sleeve, cloth on an arm) read as body paint, and the owner turned that down (6 Nov). A person without a
// wardrobe (a MetaHuman) is drawn in their modelled cut whatever is chosen.
import * as THREE from 'three/webgpu';
import { abs, atan, attribute, float, fract, max, min, mix, mx_noise_float, select, smoothstep, step, varying, vec2, vec3, vec4 } from 'three/tsl';
import { footprintKeep } from '../bump.ts';
import type { KitCut, PlayerAsset, Wardrobe } from './asset.ts';

export type PaintTop = 'tee' | 'tank' | 'vneck' | 'raglan' | 'long' | 'sleeveless' | 'polo' | 'dress';
export type PaintBottom = 'shorts' | 'tights' | 'pleated' | 'aline';
export type PaintPattern = 'plain' | 'panels' | 'band' | 'hoops' | 'pinstripe' | 'split' | 'dots' | 'fade' | 'chevron' | 'check';
export type PaintSocks = 'ankle' | 'crew' | 'noshow' | 'knee' | 'stripe';
/** A costume's print over its suit (costumes.ts). */
export type Print = 'banana' | 'tux' | 'astro' | 'dino' | 'chef';

/** A player's choice for their suit (data/cosmetics.json `paint` items); a key left out draws it as modelled. */
export interface Paint {
  /** Cuts: garments built per body (raglan is a tee with its seam drawn, a polo a tee with its collar, a dress a tank over the
   * A-line skirt in the shirt's colour; stripe a crew sock with bands). Tights go under whatever is worn below. */
  top?: PaintTop;
  bottom?: PaintBottom;
  socks?: PaintSocks;
  /** Paint: the shirt's pattern, and the shoes' upper, sole and accent (laces, heel tab, stripe; CSS hex). */
  pattern?: PaintPattern;
  shoes?: { upper: string; sole: string; accent: string };
  /** A costume (costumes.ts): its print over the whole suit instead of a pattern, the kit's panels and marks; and a suit
   * in one piece, so a skirt comes off. */
  print?: Print;
}

export const PAINT_TOPS: readonly PaintTop[] = ['tee', 'tank', 'vneck', 'raglan', 'long', 'sleeveless', 'polo', 'dress'];
export const PAINT_BOTTOMS: readonly PaintBottom[] = ['shorts', 'tights', 'pleated', 'aline'];
export const PAINT_PATTERNS: readonly PaintPattern[] = ['plain', 'panels', 'band', 'hoops', 'pinstripe', 'split', 'dots', 'fade', 'chevron', 'check'];
export const PAINT_SOCKS: readonly PaintSocks[] = ['ankle', 'crew', 'noshow', 'knee', 'stripe'];

type F = THREE.Node<'float'>;

/** Bone index ranges [first, last] of the arms (shoulder joint to fingertips), per asset. */
const ARMS = new WeakMap<PlayerAsset, Array<[number, number]>>();

function armBones(asset: PlayerAsset): Array<[number, number]> {
  let r = ARMS.get(asset);
  if (r) return r;
  r = [];
  asset.bones.forEach((b, i) => {
    if (!/^(Left|Right)(Arm|ForeArm|Hand)/.test(b.name)) return;
    const last = r![r!.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else r!.push([i, i]);
  });
  ARMS.set(asset, r);
  return r;
}

/** The arm's skinning weight of each vertex, worked out where the vertex is and handed on (WebGPU allows no more vertex
 * buffers): a chest band and a chevron stay off the sleeves. */
export function armWeight(asset: PlayerAsset): F {
  const idx = vec4(attribute('skinIndex', 'uvec4')), w = attribute<'vec4'>('skinWeight', 'vec4');
  let total: F = float(0);
  for (const [b, wb] of [[idx.x, w.x], [idx.y, w.y], [idx.z, w.z], [idx.w, w.w]] as Array<[F, F]>) {
    let inside: F = float(0);
    for (const [lo, hi] of armBones(asset)) inside = inside.add(smoothstep(lo - 0.6, lo - 0.4, b).mul(smoothstep(hi + 0.6, hi + 0.4, b)));
    total = total.add(wb.mul(min(inside, 1)));
  }
  return varying(total);
}

/**
 * A pattern's share of the shirt in the kit's second colour at a point (modelled pose `p`, its normal `n`): 0 all shirt,
 * 1 all trim. Null for the kit's own side panels ('panels', and no choice). Stripes and checks run round the body (across
 * by x on the front and back, by z on the sides); anything finer than a pixel can hold fades to its average, or it would
 * shimmer at the TV camera's distance. `arm`: the arm's skinning weight (a chest band and a chevron stay off the sleeves).
 */
export function patternAt(kind: PaintPattern | undefined, p: THREE.Node<'vec3'>, n: THREE.Node<'vec3'>, chestX: number, chestY: number, hemY: number, arm: F): F | null {
  if (!kind || kind === 'panels') return null;
  if (kind === 'plain') return float(0);
  const u = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);
  const tri = (x: F, period: number): F => abs(fract(x.div(period)).sub(0.5));
  const fine = (cell: number, avg: number, x: F): F => mix(float(avg), x, footprintKeep(cell));
  switch (kind) {
    case 'band': return smoothstep(0.034, 0.031, abs(p.y.sub(chestY + 0.05))).mul(float(1).sub(arm));
    case 'hoops': return fine(0.03, 0.5, smoothstep(0.24, 0.26, tri(p.y, 0.06)));
    case 'pinstripe': return fine(0.006, 0.1, smoothstep(0.43, 0.46, tri(u, 0.012)));
    case 'split': return smoothstep(-0.0012, 0.0012, p.x.sub(chestX));
    case 'dots': {
      const c = vec2(fract(u.div(0.035)).sub(0.5), fract(p.y.div(0.035)).sub(0.5)).mul(0.035);
      return fine(0.016, 0.164, smoothstep(0.0085, 0.0075, c.length()));
    }
    case 'fade': return smoothstep(chestY + 0.1, hemY + 0.02, p.y);
    case 'chevron': {
      const yc = abs(p.x.sub(chestX)).mul(0.55).add(chestY + 0.02);
      return smoothstep(0.03, 0.027, abs(p.y.sub(yc))).mul(float(1).sub(arm));
    }
    case 'check': {
      const a = smoothstep(0.24, 0.26, tri(u, 0.024)), b = smoothstep(0.24, 0.26, tri(p.y, 0.024));
      return fine(0.012, 0.5, a.add(b).mul(0.5));
    }
  }
}


/** The garments a top is drawn with (a raglan is a tee, a polo a tee and its collar, a dress a tank and the A-line skirt). */
const TOP_PIECES: Record<PaintTop, string[]> = {
  tee: ['tee'], raglan: ['tee'], tank: ['tank'], vneck: ['vneck'], long: ['long'], sleeveless: ['sleeveless'], polo: ['tee', 'collar'], dress: ['tank'],
};
const SOCK_PIECES: Record<PaintSocks, string | null> = { crew: 'crew', stripe: 'crew', ankle: 'ankle', knee: 'knee', noshow: null };
const TOPS = new Set(['tee', 'tank', 'vneck', 'long', 'sleeveless', 'collar']), SOCKS = new Set(['crew', 'ankle', 'knee']);
const SKIRTS = new Set(['pleated', 'aline']);

/** The skirt `paint` puts on (null: none, the shorts alone), or undefined to leave the modelled one: a dress is over the A-line;
 * a costume's suit is in one piece. */
function skirtOf(paint: Paint): string | null | undefined {
  if (paint.top === 'dress') return 'aline';
  if (paint.print) return null;
  if (paint.bottom === 'pleated' || paint.bottom === 'aline') return paint.bottom;
  return paint.bottom === 'shorts' ? null : undefined;
}

/** Does the wardrobe have the garment built (every piece is named for everyone; some are only built where they are needed)? */
const built = (w: Wardrobe, p: string): boolean => (w.ranges[w.pieces.indexOf(p)]?.[1] ?? 0) > 0;

/**
 * The garments `paint` puts a person in (Wardrobe.pieces names), or null to draw them as modelled: no cut chosen, the ones
 * chosen what they were modelled in, or no wardrobe. A chosen top replaces the modelled one and its collar; a skirt replaces the
 * modelled one, over shorts (they stay on under it, as under the modelled skirts): the tight pair, 'under', where the modelled
 * shorts stand off the leg; 'shorts' takes a modelled skirt off; tights go under whatever is below; a sock length replaces the crew.
 */
export function piecesFor(w: Wardrobe | null, paint?: Paint): string[] | null {
  if (!w || !paint || (!paint.top && !paint.bottom && !paint.socks)) return null;
  let out = [...w.worn];
  if (paint.top) out = [...out.filter((p) => !TOPS.has(p)), ...TOP_PIECES[paint.top]];
  const skirt = skirtOf(paint);
  if (skirt !== undefined) out = [...out.filter((p) => !SKIRTS.has(p)), ...(skirt ? [skirt] : [])];
  if (skirt && built(w, 'under')) out = out.map((p) => (p === 'shorts' ? 'under' : p));
  if (paint.bottom === 'tights') out.push('tights');
  if (paint.socks) {
    out = out.filter((p) => !SOCKS.has(p));
    const s = SOCK_PIECES[paint.socks];
    if (s) out.push(s);
  }
  if (out.some((p) => !w.pieces.includes(p))) return null;
  const same = out.length === w.worn.length && out.every((p) => w.worn.includes(p));
  return same ? null : out;
}

/** The cut the shader draws for (`KitCut`): the modelled one with the chosen top, seam and bottom in it (a dress: a tank, the
 * A-line skirt and `dress`, which colours the skirt as the shirt). */
export function cutFor(asset: PlayerAsset, paint?: Paint): KitCut {
  const kit = asset.look!.kit;
  const w = asset.look!.wardrobe;
  // (a dress on a body modelled in a tank and an A-line is those pieces, but in the shirt's colour)
  if (!w || (!piecesFor(w, paint) && paint?.top !== 'dress')) return kit;
  const out: KitCut = { ...kit };
  if (paint!.top) {
    out.top = paint!.top === 'raglan' ? 'tee' : paint!.top === 'dress' ? 'tank' : paint!.top;
    if (paint!.top === 'raglan') out.seam = 'raglan';
    else delete out.seam;
    if (paint!.top === 'dress') out.dress = true;
  }
  const skirt = skirtOf(paint!);
  if (skirt !== undefined) out.bottom = (skirt ?? 'shorts') as KitCut['bottom'];
  return out;
}

// ---- costumes' prints ----------------------------------------------------------------------------------------

type V3 = THREE.Node<'vec3'>;
const hex = (c: number): V3 => { const k = new THREE.Color(c); return vec3(k.r, k.g, k.b); };

/** Where a print is laid out: the chest's joint (Spine2), the neck's, the shirt's hem. */
export interface PrintFrame { chest: THREE.Vector3; neck: THREE.Vector3; hemY: number }

/**
 * A costume's shirt (the top's part) at a point (modelled pose `p`): from the costume's two colours and
 * its own details, all in metres from the chest's joint. `arm`: the arm's skinning weight (what is laid out round the
 * trunk stays off the sleeves). Anything finer than a pixel can hold fades to its average.
 *   banana: five ridges down the trunk, a few sugar spots in the second colour.
 *   tux: a dress shirt's front in a V down to the jacket's button (the second colour), three studs, a pocket square.
 *   astro: panel seams, a mission patch of our own (a planet in an orbit) and a name tape.
 *   dino: the belly in the second colour with plates across it, darker blotches over the rest.
 *   chef: the double-breasted front's edge (its buttons are pieces, costumes.ts).
 */
export function printShirt(print: Print, shirt: V3, trim: V3, p: THREE.Node<'vec3'>, L: PrintFrame, arm: F): V3 {
  const cx = p.x.sub(L.chest.x), front = step(L.chest.z, p.z), trunk = float(1).sub(arm);
  const disc = (x: number, y: number, r: number): F => smoothstep(r + 0.0008, r - 0.0008, vec2(cx.sub(x), p.y.sub(y)).length());
  const box = (x: number, y: number, hx: number, hy: number): F => smoothstep(0.0008, 0, max(cx.sub(x).abs().sub(hx), p.y.sub(y).abs().sub(hy)));
  const line = (d: F, w = 0.0016): F => smoothstep(w, w * 0.3, d.abs()).mul(footprintKeep(0.008));
  switch (print) {
    case 'banana': {
      const ang = atan(cx, p.z.sub(L.chest.z));
      const ridge = smoothstep(0.43, 0.5, fract(ang.mul(5 / (2 * Math.PI))).sub(0.5).abs()).mul(trunk);
      // (sparse and small, a ripe banana's: denser read as dirt)
      const spot = smoothstep(0.7, 0.76, mx_noise_float(p.mul(34))).mul(footprintKeep(0.01)).mul(0.6);
      return mix(shirt.mul(float(1).sub(ridge.mul(0.16))), trim, spot);
    }
    case 'tux': {
      // The V: from the button up to the collar's points either side of the neck.
      const yB = L.hemY + 0.14, yC = L.neck.y - 0.05;
      const w = mix(float(0.01), float(0.068), smoothstep(yB, yC, p.y)).add(smoothstep(yC, L.neck.y, p.y).mul(0.04));
      const bib = smoothstep(w.add(0.0015), w, cx.abs()).mul(step(yB, p.y)).mul(front).mul(trunk);
      const studs = disc(0, yB + 0.055, 0.0042).add(disc(0, yB + 0.115, 0.0042)).add(disc(0, yB + 0.175, 0.0042)).mul(footprintKeep(0.006));
      const square = box(0.095, L.chest.y + 0.045, 0.016, 0.006).mul(front).mul(trunk);
      const welt = line(p.y.sub(L.chest.y + 0.039)).mul(step(cx.sub(0.095).abs(), 0.03)).mul(front).mul(trunk);
      return mix(mix(shirt, trim, bib.mul(float(1).sub(studs)).add(square).min(1)), shirt.mul(0.55), welt.mul(0.6));
    }
    case 'astro': {
      const yoke = L.chest.y + 0.09;
      const seams = line(p.y.sub(yoke)).add(line(cx.abs().sub(0.065)).mul(step(p.y, yoke))).min(1).mul(trunk);
      let c = shirt.mul(float(1).sub(seams.mul(0.22)));
      // The patch on the left breast: a dark blue disc, a pale planet, a white orbit round it.
      const px = cx.sub(0.088), py = p.y.sub(L.chest.y + 0.03);
      const patch = disc(0.088, L.chest.y + 0.03, 0.034).mul(front).mul(trunk);
      const ox = px.mul(0.94).add(py.mul(0.34)), oy = py.mul(0.94).sub(px.mul(0.34));
      const orbit = smoothstep(0.1, 0.04, vec2(ox.div(0.026), oy.div(0.01)).length().sub(1).abs()).mul(footprintKeep(0.004));
      const planet = smoothstep(0.0112, 0.0098, vec2(px, py).length());
      const rim = smoothstep(0.0315, 0.0335, vec2(px, py).length());
      c = mix(c, mix(mix(mix(hex(0x1d3577), hex(0x8fb4e3), planet), hex(0xf3f1ea), orbit), hex(0xc9a43a), rim), patch);
      const tape = box(-0.088, L.chest.y + 0.032, 0.036, 0.0095).mul(front).mul(trunk);
      return mix(c, mix(hex(0x9da3ab), hex(0xd8d9d6), box(-0.088, L.chest.y + 0.032, 0.033, 0.0068)), tape);
    }
    case 'dino': {
      const top = L.chest.y + 0.05, yc = (top + L.hemY) / 2, hh = (top - L.hemY) / 2 + 0.03;
      const belly = smoothstep(1.02, 0.98, vec2(cx.div(0.105), p.y.sub(yc).div(hh)).length()).mul(front).mul(trunk);
      const plates = line(fract(p.y.div(0.034)).sub(0.5).mul(0.034), 0.0018);
      const blotch = smoothstep(0.5, 0.6, mx_noise_float(p.mul(9))).mul(0.3);
      return mix(shirt.mul(float(1).sub(blotch)), trim.mul(float(1).sub(plates.mul(0.18))), belly);
    }
    case 'chef': {
      // The front's edge, over to the wearer's right, from the collar to the hem.
      const edge = line(cx.add(0.072)).mul(front).mul(trunk).mul(step(p.y, L.neck.y - 0.02));
      return shirt.mul(float(1).sub(edge.mul(0.2)));
    }
  }
}

/**
 * A costume's shorts and tights at a point: a chef's black-and-white check, the dinosaur's blotches, the banana's spots; a
 * tuxedo's satin stripe down the outside of the leg (`stripe`, where the kit's own stripe runs) a little lighter.
 */
export function printBottom(print: Print, shorts: V3, trim: V3, p: THREE.Node<'vec3'>, n: THREE.Node<'vec3'>, stripe: F): V3 {
  switch (print) {
    case 'chef': {
      const u = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);
      const tri = (x: F): F => abs(fract(x.div(0.016)).sub(0.5));
      const c = smoothstep(0.24, 0.26, tri(u)).add(smoothstep(0.24, 0.26, tri(p.y))).mul(0.5);
      return mix(shorts, hex(0xeeece6), mix(float(0.5), c, footprintKeep(0.008)).mul(0.92));
    }
    case 'dino': return shorts.mul(float(1).sub(smoothstep(0.5, 0.6, mx_noise_float(p.mul(9))).mul(0.3)));
    case 'banana': return mix(shorts, trim, smoothstep(0.7, 0.76, mx_noise_float(p.mul(34))).mul(footprintKeep(0.01)).mul(0.6));
    case 'tux': return mix(shorts, hex(0x34343a), stripe);
    default: return shorts;
  }
}
