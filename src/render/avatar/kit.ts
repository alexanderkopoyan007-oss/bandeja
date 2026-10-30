// Dressing the body (Phase 5): the one mannequin mesh becomes a padel player in the shader. Each vertex gets a
// region from the bone that moves it most and where it sits on that bone in the bind pose (a short-sleeved shirt
// to mid upper arm and over the hips, shorts to mid thigh, socks over the ankles, shoes, a hair cap on the crown
// and the back of the head, skin elsewhere). Fabric has folds (a bump pattern fixed to the body, so it moves with
// it), wet patches that grow over a match where players sweat first (chest, the spine, under the arms), and skin
// turns shinier as it sweats. Shirt and shorts hems lag the body when it accelerates.
import * as THREE from 'three/webgpu';
import {
  attribute, positionGeometry, positionLocal, uniform, vec3, vec4, float, mix, smoothstep, color,
  mx_noise_float, texture, uv, max, min, dot, normalView, normalWorld, normalLocal, diffuseColor,
} from 'three/tsl';
import { heightBump, footprintKeep } from '../bump.ts';
import type { PlayerAsset } from './asset.ts';

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
 * The hems' lag as a displacement, less any part of it into the body (REVIEW.md round 3: a lag pointing into the
 * back, as the player pulled up or turned, put the shirt's hem behind the shorts in face-sized steps, and where the
 * skin under it is removed the court showed through). `normalLocal` is the skinned normal here (three skins
 * positionLocal and normalLocal before positionNode runs).
 */
function hemLag(lag: THREE.Node<'vec3'>, sway: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const d = lag.mul(sway);
  const n = normalLocal.normalize();
  return positionLocal.add(d.sub(n.mul(min(dot(d, n), 0))));
}

export interface KitFrame { chest: THREE.Vector3; hips: THREE.Vector3; hemY: number; shortsHemY: number; armSpan: number; floorY: number; footX?: number; footZ?: number }
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
  /** How far the hems lag the body (m, model space). */
  lag: { value: THREE.Vector3 };
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
   * which pooled violet in the eye sockets and turned the whites lavender (review round 4, the critic's #1). */
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
    super.indirectSpecular(builder);
    c.iblIrradiance = ibl;
    c.radiance = radiance;
  }

  private ambient(light: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const luma = light.dot(vec3(0.2126, 0.7152, 0.0722));
    return mix(light, vec3(luma, luma, luma).mul(SKIN_AMBIENT), this.ambientFix);
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
const LUMA = vec3(0.2126, 0.7152, 0.0722);
/** How wide (mip) and how much the lids' hue comes from the skin round them. */
const LID_MIP = 6;
const LID_PLAIN = 1;
const CATCHLIGHT = vec3(-0.29, 0.41, 0.864);
/** The ambient on skin: warmer than neutral (light that has been through skin and bounced off a body) and stronger (the
 * sockets' baked occlusion is a shadow of the whole sky, which a floodlit court isn't). */
const SKIN_AMBIENT = vec3(1.55, 1.34, 1.2);

/** A person's body: MeshPhysicalNodeMaterial with the skin's lighting model (clearcoat for oil, sweat and the wet
 * eyes, mouth; sheen for the fabric). */
export class PersonNodeMaterial extends THREE.MeshPhysicalNodeMaterial {
  static override get type(): string { return 'PersonNodeMaterial'; }
  scatterNode: THREE.Node<'float'> = float(0);
  ambientFixNode: THREE.Node<'float'> = float(0);
  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new SkinLighting(this.scatterNode, this.ambientFixNode, this.useClearcoat, this.useSheen);
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
 *   not used), with a fabric sheen; socks and shoes coloured as the mannequin's kit. Sweat, fabric folds and the hems'
 *   lag work as on the mannequin.
 * The second material is the hair, brows and lashes: alpha to coverage over the MSAA samples (soft strands instead
 * of a hard alpha-tested edge), darker where cards lie near the scalp (baked per vertex), a soft sheen.
 */
export function personMaterial(asset: PlayerAsset, look: KitLook): { material: PersonNodeMaterial; hair: THREE.MeshPhysicalNodeMaterial; state: KitState } {
  const body = asset.look!;
  const frame = personFrame(asset);
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
  const tex = body.opaqueMap ? texture(body.opaqueMap, uv()) : vec4(0.8, 0.62, 0.5, 1);
  // The clothes' ambient occlusion is the grey in their rectangle; the skin's, teeth's and tongue's is the alpha.
  const ao = float(0.32).add(tex.x.mul(0.68));
  const bakedAO = mix(float(1), mix(float(0.3).add(tex.w.mul(0.7)), float(0.15).add(tex.w.mul(0.85)), mouthW), skinW.add(mouthW)).mul(vAO);
  // The waistband under the shirt was in the shirt's shadow when the occlusion was baked (MakeHuman's outfit); a shirt
  // riding up as the player bends showed it as a grey band. Above the shirt's hem the shorts are lit as they show.
  const aoShorts = mix(ao, max(ao, float(0.82)), smoothstep(frame.hemY - 0.05, frame.hemY, p.y));

  const blotch = mx_noise_float(p.mul(14)).mul(0.22);
  const wet = smoothstep(0.02, 0.12, X.x.mul(shirtW).add(blotch).sub(float(1.22).sub(sweat.mul(0.92)))).mul(shirtW);

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
  // Albedo: the skin a little darker in its deepest creases, the eyeball under the lids, the mouth's inside.
  // (dark skin lifted a little: under the same floodlights its faces read as masks beside the others', mean luminance
  // 23 of 255 against 68 and 99)
  // (MakeHuman's women wear eye shadow in the source: the lids take the hue of the skin round them and keep their shading)
  const round = body.opaqueMap ? texture(body.opaqueMap, uv()).level(float(LID_MIP)).xyz : tex.xyz;
  const shade = tex.xyz.dot(LUMA).div(round.dot(LUMA).max(0.02));
  const skinBase = mix(tex.xyz, round.mul(shade), lids.mul(LID_PLAIN));
  const skinCol = skinBase.mul(mix(float(1), tex.w, 0.3)).mul(float(1).add(smoothstep(0.4, 0.12, tex.y).mul(0.3)));
  // (the source draws a brown iris dark red: its green and blue are lifted to the red's; whites and blue or green irises
  // keep theirs)
  const eyeCol = vec3(tex.x, max(tex.y, tex.x.mul(0.58)), max(tex.z, tex.x.mul(0.34))).mul(float(0.74).add(vAO.mul(0.26)));
  // (teeth sit at occlusion about 0.27: multiplied straight they rendered blue-grey, 100 of 239: review round 5, the
  // critic's #4. The throat, below 0.1, stays dark.)
  const mouthCol = tex.xyz.mul(float(0.2).add(smoothstep(0.1, 0.4, tex.w).mul(0.8)));
  let col: THREE.Node<'vec3'> = color(look.shirt).mul(ao).mul(shirtW)
    .add(color(look.shorts).mul(aoShorts).mul(shortsW))
    .add(skinCol.mul(skinW))
    .add(eyeCol.mul(eyeW))
    .add(mouthCol.mul(mouthW))
    .add(color(look.socks).mul(sockW))
    .add(shoeC.mul(shoeW).mul(vAO));
  col = col.mul(float(1).sub(wet.mul(0.3)));
  // A ribbed band 8 mm wide along the neckline.
  const neckline = X.y.mul(shirtW);
  col = col.mul(float(1).sub(smoothstep(0.465, 0.475, neckline).mul(0.16).mul(float(1).add(p.x.mul(900).sin().mul(0.35)))));
  const m = new PersonNodeMaterial();
  m.maskNode = neckline.lessThan(COLLAR_MID);
  m.colorNode = col;
  m.aoNode = bakedAO;
  const darkSkin = smoothstep(0.4, 0.12, tex.y).mul(skinW);
  const skinRough = mix(float(0.5), float(0.33), sweat).sub(darkSkin.mul(0.06)).sub(lips.mul(0.14)).sub(lids.mul(0.12)).sub(tzone.mul(0.07));
  m.roughnessNode = fabric.mul(float(0.88).sub(wet.mul(0.25)))
    .add(skinW.mul(skinRough))
    .add(eyeW.mul(0.2)).add(teethW.mul(0.3)).add(tongueW.mul(0.38)).add(shoeW.mul(0.45));
  m.metalnessNode = float(0);
  // Specular occlusion for the direct light as well: deep creases (nostrils, the ears' hollows, the corners of the
  // mouth) and the scalp under the hair don't shine (the baked occlusion is low there).
  // (dark skin shows more of its specular: the same lobe over a darker base, a little stronger)
  m.specularIntensityNode = mix(float(1), smoothstep(0.05, 0.55, tex.w).mul(float(1).add(darkSkin.mul(0.5))), skinW.add(mouthW));
  // The second lobe: skin's oil and sweat, the cornea, the wet mouth.
  m.clearcoatNode = skinW.mul(float(0.05).add(sweat.mul(0.35)).add(tzone.mul(0.12)).add(lips.mul(0.25)).add(lids.mul(0.3)))
    .mul(smoothstep(0.05, 0.55, tex.w)).add(eyeW).add(teethW.mul(0.55)).add(tongueW.mul(0.8));
  m.clearcoatRoughnessNode = skinW.mul(float(0.32).sub(sweat.mul(0.1))).add(eyeW.mul(0.03)).add(mouthW.mul(0.12));
  // Cotton and polyester's soft rim.
  m.sheenNode = mix(col, vec3(1, 1, 1), 0.35).mul(fabric.mul(0.6));
  m.sheenRoughnessNode = float(0.55);
  // (little on the lids: the red at their terminator drew an orange band over each eye)
  m.scatterNode = skinW.mul(float(0.42).add(ears.mul(0.9))).mul(float(1).sub(lids.mul(0.85)));
  // (the mouth too: the sky's blue on teeth turned them blue-black with the head bowed)
  m.ambientFixNode = skinW.add(eyeW).add(mouthW);
  // The catchlight: a floodlit cornea always holds a bright point, and a face without one reads as dead. The light it
  // would mirror isn't in the probe, so it is drawn: fixed in view space, where the eyeball's normal meets it.
  m.emissiveNode = vec3(1, 0.98, 0.94).mul(normalView.dot(CATCHLIGHT).clamp().pow(1100)).mul(eyeW).mul(1.5);
  const folds = mx_noise_float(vec3(p.x.mul(16), p.y.mul(44), p.z.mul(16))).mul(0.6)
    .add(mx_noise_float(p.mul(60)).mul(0.15));
  // Pores: about 0.5 mm features, 12 µm deep, faded out wherever a pixel covers more than a few of them (bump.ts),
  // less on the lips and lids.
  const pores = mx_noise_float(p.mul(1900)).mul(0.6).add(mx_noise_float(p.mul(620)).mul(0.4))
    .mul(0.000012).mul(skinW).mul(float(1).sub(lips.mul(0.7)).sub(lids.mul(0.5))).mul(footprintKeep(0.0012));
  m.normalNode = heightBump(folds.mul(fabric).mul(0.0025).add(pores), 0.023);
  const shirtSway = smoothstep(frame.chest.y, frame.hemY, p.y).mul(shirtW);
  const shortsSway = smoothstep(frame.hips.y - 0.05, frame.shortsHemY, p.y).mul(shortsW).mul(0.6);
  m.positionNode = hemLag(lag, shirtSway.add(shortsSway));

  const hair = new THREE.MeshPhysicalNodeMaterial();
  const ht = body.alphaMap ? texture(body.alphaMap, uv()) : vec4(0.16, 0.11, 0.08, 1);
  const hAO = body.alphaGeometry.hasAttribute('bodyAO') ? attribute<'float'>('bodyAO', 'float') : float(1);
  // Strands, not a cap: brightness varies across the cards (fine) and along them (slowly); pale texels at the edge of a
  // strand, where the atlas fades out over its white, go dark (they drew a light fringe under the lower lashes).
  const strandUv = uv();
  const strands = mx_noise_float(vec3(strandUv.x.mul(1400), strandUv.y.mul(260), float(0))).mul(0.55)
    .add(mx_noise_float(vec3(strandUv.x.mul(420), strandUv.y.mul(90), float(3))).mul(0.45));
  const strandLit = float(0.8).add(strands.mul(0.75));
  hair.colorNode = ht.xyz.mul(smoothstep(0.1, 0.62, ht.w)).mul(hAO).mul(strandLit);
  hair.aoNode = hAO;
  // Coverage from the cards' alpha over the MSAA samples: strands fade out instead of being cut at a threshold. The
  // nearly clear texels are dropped outright, and the shadow keeps a hard cut (the shadow map has no samples).
  hair.opacityNode = smoothstep(0.06, 0.7, ht.w);
  hair.alphaToCoverage = true;
  hair.maskNode = ht.w.greaterThan(0.05);
  hair.maskShadowNode = ht.w.greaterThan(0.5);
  hair.side = THREE.DoubleSide;
  // Hair's highlight is dimmer and tinted by the hair (the light that enters a strand comes out coloured), and
  // weaker deep in the hair.
  hair.roughnessNode = float(0.52).sub(strands.mul(0.18));
  hair.metalnessNode = float(0);
  hair.specularIntensityNode = hAO.mul(0.6);
  hair.specularColorNode = mix(vec3(1, 1, 1), ht.xyz.mul(2.2), 0.6);
  hair.sheenNode = ht.xyz.mul(0.5).mul(hAO);
  hair.sheenRoughnessNode = float(0.45);
  return { material: m, hair, state: { sweat: sweatU, lag } };
}

const PERSON_FRAMES = new WeakMap<PlayerAsset, KitFrame>();
/** How far below the Neck joint (m, rest pose) the shirt's front is cut. */
const COLLAR_DROP = 0.065;
/** The neckline's rise to the sides of the neck (m per m squared): level with the neck joint 7.5 cm out. */
const COLLAR_CURVE = 11.5;
/** The field's value at the neckline and its slope (per m), stored in bodyX.y for the cut and the ribbed band. */
const COLLAR_MID = 0.5;
const COLLAR_SCALE = 2.5;

/**
 * A person's landmarks (rest pose) and per-vertex sweat weights (bodyX.x on the shirt: where a shirt gets wet first,
 * as the mannequin's kit), computed once per asset.
 */
function personFrame(asset: PlayerAsset): KitFrame {
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
  // The shirt's front collar: skinned to the chest, it comes out through the neck under the chin as the head bows (a
  // pale band under every jaw: review round 4, the critic's #1). It goes, and the neckline opens over the neck's skin.
  const neck = at(asset, 'Neck');
  const index = g.getIndex()!;
  const tri = index.array;
  const kept: number[] = [];
  // How far inside the neckline a shirt vertex is (m): a scoop, low in front and rising to the sides of the neck. The
  // shader cuts along its zero (bodyX.y), so the edge runs smoothly across the triangles: dropped whole, they left a
  // torn edge (review round 6, the critic's #7). Only triangles well inside go.
  const inCollar = (v: number): number => {
    const dx = rest[v * 3]! - neck.x;
    return Math.min(rest[v * 3 + 1]! - (neck.y - COLLAR_DROP + COLLAR_CURVE * dx * dx), rest[v * 3 + 2]! - (neck.z - 0.01));
  };
  for (let i = 0; i < n; i++) if (A[i * 4]! > 0.5) X[i * 4 + 1] = Math.min(1, Math.max(0, COLLAR_MID + inCollar(i) * COLLAR_SCALE));
  const gone = (v: number): boolean => A[v * 4]! > 0.5 && inCollar(v) > 0.04;
  for (let i = 0; i < tri.length; i += 3) {
    if (gone(tri[i]!) && gone(tri[i + 1]!) && gone(tri[i + 2]!)) continue;
    kept.push(tri[i]!, tri[i + 1]!, tri[i + 2]!);
  }
  g.setIndex(kept);
  let floorY = Infinity, shortsHemY = Infinity, hemY = Infinity;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3]!, y = rest[i * 3 + 1]!, z = rest[i * 3 + 2]!;
    floorY = Math.min(floorY, y);
    if (A[i * 4 + 1]! > 0.5) shortsHemY = Math.min(shortsHemY, y);
    if (A[i * 4]! < 0.5) continue;
    hemY = Math.min(hemY, y);
    const dx = x - chest.x;
    X[i * 4] = Math.max(
      g3(dx, y - (chest.y + 0.02), z - (chest.z + 0.1), 0.06, 0.13, 0.09),
      g3(dx, y - (chest.y - 0.12), z - (chest.z - 0.1), 0.055, 0.26, 0.09),
      g3(Math.abs(dx) - halfSpan * 0.68, y - (chest.y + 0.02), z - chest.z, 0.05, 0.08, 0.09),
      0.7 * g3(dx, y - (hips.y + 0.12), z - (chest.z - 0.1), 0.1, 0.08, 0.1),
    );
  }
  (g.getAttribute('bodyX') as THREE.BufferAttribute).needsUpdate = true;
  frame = {
    chest: chest.clone(), hips: hips.clone(), hemY: Number.isFinite(hemY) ? hemY : hips.y - 0.02,
    shortsHemY: Number.isFinite(shortsHemY) ? shortsHemY : hips.y - 0.3,
    armSpan: halfSpan * 2, floorY, footX: Math.abs(at(asset, 'LeftFoot').x), footZ: at(asset, 'LeftFoot').z,
  };
  PERSON_FRAMES.set(asset, frame);
  return frame;
}
