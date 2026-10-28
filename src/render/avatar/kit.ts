// Dressing the body (Phase 5): the one mannequin mesh becomes a padel player in the shader. Each vertex gets a
// region from the bone that moves it most and where it sits on that bone in the bind pose (a short-sleeved shirt
// to mid upper arm and over the hips, shorts to mid thigh, socks over the ankles, shoes, a hair cap on the crown
// and the back of the head, skin elsewhere). Fabric has folds (a bump pattern fixed to the body, so it moves with
// it), wet patches that grow over a match where players sweat first (chest, the spine, under the arms), and skin
// turns shinier as it sweats. Shirt and shorts hems lag the body when it accelerates.
import * as THREE from 'three/webgpu';
import {
  attribute, positionGeometry, positionLocal, uniform, vec3, float, mix, smoothstep, color,
  mx_noise_float,
} from 'three/tsl';
import { heightBump } from '../bump.ts';
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
export interface KitFrame { chest: THREE.Vector3; hips: THREE.Vector3; hemY: number; shortsHemY: number; armSpan: number; floorY: number }
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
  const pos = g.attributes.position!.array as Float32Array;
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
  const shoeC = mix(mix(color(look.shoes), color(look.shirt), stripe.mul(0.9)), color(0x8a8378), sole);
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
  m.positionNode = positionLocal.add(lag.mul(shirtSway.add(shortsSway)));
  return { material: m, state: { sweat: sweatU, lag } };
}

/** Kits by player number (team + 2 * slot): partners in the same shirt, each team its own; skins and hair vary. */
export function kitFor(idx: number): KitLook {
  const team = idx & 1;
  const kits: KitLook[] = [
    { shirt: 0xd8402e, trim: 0x22252b, shorts: 0x1d2433, socks: 0xf2f2f2, shoes: 0xeeeeee, skin: 0xe2b08c, hair: 0x2a1d14 },
    { shirt: 0x2563c9, trim: 0xf1f3f6, shorts: 0xf1f3f6, socks: 0xf2f2f2, shoes: 0x23262c, skin: 0xc68e66, hair: 0x18120e },
  ];
  const k = { ...kits[team]! };
  if (idx >= 2) {
    // The partner: same kit, their own looks.
    k.skin = team ? 0xf0c9a8 : 0x9c6b4a;
    k.hair = team ? 0x6b4a2e : 0x0f0c0a;
    k.shoes = team ? 0xf0f0f0 : 0x2a2d33;
  }
  return k;
}
