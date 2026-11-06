// M5 phase C step 3: what a player chooses for their suit beyond its cut. Colours, patterns, shoes and the overgrip are
// paint (the person's shader, kit.ts personMaterial). Cuts (a tank, a V-neck, long sleeves, tights, sock lengths) are
// garment meshes built per body; drawn by repainting the modelled suit (skin on a sleeve, cloth on an arm) they read as body
// paint, and the owner turned that down (6 Nov). Until those meshes exist a chosen cut draws the body as modelled.
import * as THREE from 'three/webgpu';
import { abs, attribute, float, fract, min, mix, select, smoothstep, varying, vec2, vec4 } from 'three/tsl';
import { footprintKeep } from '../bump.ts';
import type { PlayerAsset } from './asset.ts';

export type PaintTop = 'tee' | 'tank' | 'vneck' | 'raglan' | 'long' | 'sleeveless';
export type PaintPattern = 'plain' | 'panels' | 'band' | 'hoops' | 'pinstripe' | 'split' | 'dots' | 'fade' | 'chevron' | 'check';
export type PaintSocks = 'ankle' | 'crew' | 'noshow' | 'knee' | 'stripe';

/** A player's choice for their suit (data/cosmetics.json `paint` items); a key left out draws it as modelled. */
export interface Paint {
  /** Cuts: garment meshes (not yet built: drawn as modelled). */
  top?: PaintTop;
  bottom?: 'shorts' | 'tights';
  socks?: PaintSocks;
  /** Paint: the shirt's pattern, and the shoes' upper, sole and accent (laces, heel tab, stripe; CSS hex). */
  pattern?: PaintPattern;
  shoes?: { upper: string; sole: string; accent: string };
}

export const PAINT_TOPS: readonly PaintTop[] = ['tee', 'tank', 'vneck', 'raglan', 'long', 'sleeveless'];
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

