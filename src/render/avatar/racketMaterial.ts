// The racket's material (render/avatar/racket.ts): one physical node material per racket for every part, each
// triangle tagged with its region (`rkInfo.x`), so a racket is one draw call.
// - Face: the print, matte, with a gritty sand finish (two scales of grain as a screen-space bump, fading out as a
//   pixel grows past each grain so nothing shimmers; the grain also catches a little light), gloss prints and foil
//   from the art's mask. The far level's face (no holes drilled) shows its holes where the mask's blue marks them, in
//   the tone a hole has at that size (lit foam and what shows through, about 55% of the foam's light).
// - Hole chamfers: the face's print where the drill eased the edge, darker (it faces away from the light).
// - Frame: the print (band, then the side strip round the profile), lacquered by the look's frame finish: gloss is a
//   clear coat at roughness 0.17 over 0.4 (a lacquered carbon tube, not a mirror), satin less of it, matte none.
// - Hole walls: the EVA core (off-white foam with pores) between the two dark skins, banded by depth, darker inside.
// - Protector: matte rubber with a fine moulded grain, its print (solid, or the frame's print through translucent
//   rubber) from the side texture.
// - Overgrip: its colour, shaded by the spiral (a dark foot under each turn's edge, and the edge's sheen, which is
//   what shows the spiral on a black grip), a fine tacky texture.
// - Finishing tape and the cap's logo from the art; the cap a semi-gloss plastic.
// Every roughness is raised where the normal turns fast across a pixel (specular anti-aliasing at TV distance).
import * as THREE from 'three/webgpu';
import {
  attribute, uniform, float, mix, smoothstep, step, texture, uv, positionGeometry, positionView, normalView, dFdx, dFdy,
  max, mx_noise_float, atan, fract, vec3,
} from 'three/tsl';
import { heightBump } from '../bump.ts';
import type { RacketLook } from './racket.ts';
import type { RacketArt } from './racketArt.ts';

/** The racket's dimensions the shader needs (from racket.ts, passed in to keep the modules' load order simple). */
export interface RacketDims {
  /** Half the frame's thickness, the face's step below the band, one skin's thickness (m). */
  t2: number;
  step: number;
  skin: number;
  /** The overgrip's pitch and where its spiral starts (m). */
  pitch: number;
  gripY0: number;
}

/** The frame's lacquer by finish: base roughness, clear coat and the clear coat's roughness. */
export const FRAME_FINISH: Record<string, { rough: number; coat: number; coatRough: number }> = {
  gloss: { rough: 0.4, coat: 0.7, coatRough: 0.17 },
  satin: { rough: 0.48, coat: 0.4, coatRough: 0.3 },
  matte: { rough: 0.66, coat: 0, coatRough: 0.5 },
};

const col = (hex: string): THREE.Node<'vec3'> => uniform(new THREE.Color(hex)) as unknown as THREE.Node<'vec3'>;

/** Perceived lightness of a colour (0..1). */
function lum(hex: string): number {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
}

export function racketMaterial(art: RacketArt, look: RacketLook, d: RacketDims): THREE.MeshPhysicalNodeMaterial {
  const info = attribute<'vec2'>('rkInfo', 'vec2');
  const code = info.x, side = info.y;
  const uvS = attribute<'vec2'>('rkUvS', 'vec2');
  const is = (k: number): THREE.Node<'float'> => step(code.sub(k).abs(), float(0.5));
  const wFace = is(0), wFar = is(8), wFrame = is(1), wWall = is(2), wBump = is(3), wGrip = is(4), wTape = is(5), wCap = is(6), wLogo = is(7);
  const wCham = is(9);
  const faceW = wFace.add(wFar);
  const finish = FRAME_FINISH[look.frameFinish] ?? FRAME_FINISH.gloss!;

  const Hc = texture(art.head, uv()), Sc = texture(art.head, uvS), Fc = texture(art.side, uvS);
  const Mc = texture(art.mask, uv()), MSc = texture(art.mask, uvS);
  // The frame: the band's print near the faces, the side strip's round the outside (lacquered all over: gloss 1).
  const printed = mix(Hc.rgb, Fc.rgb, side);
  const gloss = mix(Mc.r, float(1), side), metal = mix(Mc.g, float(0), side);

  const p = positionGeometry;
  // How much of the racket one pixel covers (m), and a feature's fade as the pixel outgrows it.
  const foot = max(dFdx(positionView).length(), dFdy(positionView).length());
  const fade = (cell: number): THREE.Node<'float'> => float(1).sub(smoothstep(cell * 0.25, cell * 0.5, foot));
  const nvar = max(dFdx(normalView).length(), dFdy(normalView).length());

  // Face: sand grains (0.4 mm and 1.1 mm), the finish's amount (sand 1, matte 0.35, gloss 0), none on gloss prints.
  const sandAmt = look.finish === 'sand' ? 1 : look.finish === 'matte' ? 0.35 : 0;
  const faceRough = look.finish === 'sand' ? 0.86 : look.finish === 'matte' ? 0.66 : 0.3;
  const g1 = mx_noise_float(p.mul(2600)), g2 = mx_noise_float(p.mul(900));
  const f1 = fade(0.0004), f2 = fade(0.0011);
  const notGloss = float(1).sub(gloss);
  const grit = g1.mul(f1).mul(0.00004).add(g2.mul(f2).mul(0.000025)).mul(sandAmt).mul(notGloss);
  // The far level's holes: the mask's coverage, in a hole's tone at that size.
  const holes = Mc.b.mul(wFar);
  const holeTone = col(look.foam).mul(0.28);
  const faceCol = mix(Hc.rgb.mul(float(1).add(g1.mul(f1).mul(0.08 * sandAmt).mul(notGloss))), holeTone, holes);

  // Hole walls: skin | foam | skin by depth (the edges widened by the pixel's size), pores, darker deep inside.
  const z = p.z.abs();
  const skinEdge = d.t2 - d.step - d.skin;
  const aa = foot.add(0.00012);
  const inSkin = smoothstep(float(skinEdge).sub(aa), float(skinEdge).add(aa), z);
  const pores = mx_noise_float(p.mul(3400));
  const foam = col(look.foam).mul(float(0.92).add(pores.mul(fade(0.0005)).mul(0.08)));
  // Inside a 13 mm hole through 37 mm the wall sees little of the sky: dark at mid depth, lit only near the faces.
  const open = smoothstep(0, d.t2, z);
  const wallCol = mix(foam, col(look.skin), inSkin).mul(float(0.22).add(open.mul(open).mul(0.78)));

  // Protector: its print (solid colour or the frame through translucent rubber) with a fine moulded grain.
  const clear = look.bumper.clear;
  const mould = mx_noise_float(p.mul(1900));
  const bumpCol = Fc.rgb.mul(float(0.97).add(mould.mul(fade(0.0008)).mul(0.03)));

  // Overgrip: where the spiral is (f 0..1 up one turn from the foot of a step), its shading and fine texture.
  const th = atan(p.x, p.z);
  const f = fract(p.y.sub(d.gripY0).div(d.pitch).sub(th.div(Math.PI * 2)));
  const gfade = fade(0.006);
  // The foot of each step in the shadow of the turn above it, the step's lifted edge catching the light. On a dark
  // grip a darker foot shows nothing: the edge's sheen (added light, and a smoother edge) is what shows the spiral.
  const edge = smoothstep(0.02, 0.07, f).mul(float(1).sub(smoothstep(0.07, 0.22, f))).mul(gfade);
  const gripShade = float(1).sub(smoothstep(0.72, 0.985, f).mul(0.55).mul(gfade)).add(edge.mul(0.16));
  const tack = mx_noise_float(p.mul(4200));
  const dark = Math.max(0, 1 - lum(look.grip) * 2.2);
  const gripCol = col(look.grip).mul(gripShade).mul(float(0.96).add(tack.mul(fade(0.0004)).mul(0.04))).add(vec3(edge.mul(0.045 * dark)));

  const color = faceCol.mul(faceW)
    .add(Hc.rgb.mul(0.62).mul(wCham))
    .add(printed.mul(wFrame))
    .add(wallCol.mul(wWall))
    .add(bumpCol.mul(wBump))
    .add(gripCol.mul(wGrip))
    .add(Sc.rgb.mul(wTape))
    .add(col(look.cap).mul(wCap))
    .add(Sc.rgb.mul(wLogo));

  const rough = faceW.mul(mix(mix(float(faceRough), float(0.24), gloss), float(0.9), holes))
    .add(wCham.mul(0.7))
    .add(wFrame.mul(finish.rough))
    .add(wWall.mul(0.95))
    .add(wBump.mul(clear > 0.5 ? 0.42 : 0.66))
    .add(wGrip.mul(float(0.6).sub(edge.mul(0.18 * dark))))
    .add(wTape.mul(0.5))
    .add(wCap.mul(0.42))
    .add(wLogo.mul(0.34));

  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = color;
  m.roughnessNode = max(rough, nvar.mul(0.9).min(0.75));
  m.metalnessNode = faceW.add(wFrame).mul(metal).mul(float(1).sub(holes)).add(wLogo.mul(MSc.g));
  // Lacquer: the frame (by its finish), the cap, gloss prints on the face.
  m.clearcoatNode = wFrame.mul(finish.coat).add(wCap.add(wLogo).mul(0.3)).add(faceW.mul(gloss).mul(0.7).mul(float(1).sub(holes)));
  m.clearcoatRoughnessNode = max(float(finish.coatRough).mul(wFrame).add(float(0.2).mul(float(1).sub(wFrame))), nvar.mul(0.9).min(0.6));
  // Bumps (m): the grit, the foam's pores, the overgrip's tack, the protector's grain.
  const h = grit.mul(faceW)
    .add(pores.mul(fade(0.0006)).mul(0.00004).mul(wWall))
    .add(tack.mul(fade(0.0005)).mul(0.000025).mul(wGrip))
    .add(mould.mul(fade(0.0008)).mul(0.00002).mul(wBump));
  m.normalNode = heightBump(h, 1);
  // The textures live in nodes; as properties too so disposeTree frees them with the material.
  Object.assign(m, { rkHeadMap: art.head, rkMaskMap: art.mask, rkSideMap: art.side });
  return m;
}

/**
 * The wrist cord: a flat braided strap (two helices of strands crossing, about 1.5 mm a cell along it) in the
 * racket's colour, matte, and its slider. u runs along the strap and v round it (2 on the slider).
 */
export function cordMaterial(hex = '#1a1b1e'): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const t = uv();
  // The slider (v = 2): a moulded plastic sleeve, darker and smoother, no braid.
  const slider = step(1.5, t.y);
  const along = t.x.mul(170);
  const s1 = fract(along.add(t.y.mul(3))), s2 = fract(along.sub(t.y.mul(3)));
  const ridge = max(s1.sub(0.5).abs(), s2.sub(0.5).abs()).mul(float(1).sub(slider));
  const foot = max(dFdx(positionView).length(), dFdy(positionView).length());
  const keep = float(1).sub(smoothstep(0.0006, 0.0014, foot));
  m.colorNode = mix(col(hex).mul(float(1).sub(ridge.mul(0.35).mul(keep))).add(vec3(0.012)), col(hex).mul(0.55).add(vec3(0.008)), slider);
  m.roughnessNode = mix(float(0.72), float(0.4), slider);
  m.metalnessNode = float(0);
  m.normalNode = heightBump(ridge.mul(0.00025).mul(keep), 1);
  return m;
}
