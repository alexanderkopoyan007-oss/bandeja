// Real surfaces on the arena's shapes (the detail pass, 13 Nov 2026: the owner asked why the game looks blocky and low in
// detail, and the arena was the plainest part of the picture: boxes in one flat colour each). A shape keeps its colour from
// data/arenas.json and takes a photographed material's variation over it: its colour's mottle and stains about their mean,
// its roughness, its occlusion and its relief (a normal map). The maps are CC0 sets (CREDITS.md; tools/assets/arena/textures.py
// writes public/assets/arena/<set>-{diff,nor,arm}.webp).
//
// Laid on by place, not by UVs (the arena's boxes have none): each of the three world planes carries the map, and a face
// takes the one it lies in (blended where it lies between, by its normal). The relief is the map's own normals turned into
// each plane's frame ("whiteout" blending; Golus, "Normal Mapping for a Triplanar Shader", 2017).
//
// Behind `arenaDetail.on` (?detail=1) until the owner has seen it: off, nothing here runs and no map is fetched.
import * as THREE from 'three/webgpu';
import { abs, cameraViewMatrix, float, mix, normalWorldGeometry, positionWorld, texture, vec3, vec4, vertexColor } from 'three/tsl';

/** The switch: `want` is what was asked for (main.ts, from the URL), `on` what the match being built has (Game: not on Low quality). */
export const arenaDetail = { want: false, on: false };

/** The sets there are, with the mean of each colour map (linear luminance: what a tint is divided by) and its tile (m). */
const SETS = {
  concrete: { mean: 0.094, tile: 3.0 },
  corrugated: { mean: 0.098, tile: 2.7 },
} as const;
export type SurfaceSet = keyof typeof SETS;

interface Maps { diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture }
const loaded = new Map<SurfaceSet, Maps>();

function maps(set: SurfaceSet): Maps {
  let m = loaded.get(set);
  if (!m) {
    const base = typeof document !== 'undefined' ? new URL('assets/arena/', document.baseURI).href : 'assets/arena/';
    const loader = new THREE.TextureLoader();
    const one = (kind: string, srgb: boolean): THREE.Texture => {
      const t = loader.load(`${base}${set}-${kind}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    };
    m = { diff: one('diff', true), nor: one('nor', false), arm: one('arm', false) };
    loaded.set(set, m);
  }
  return m;
}

export interface SurfaceOptions {
  set: SurfaceSet;
  /** The colour it is tinted to (sRGB), or the mesh's own vertex colours. */
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  /** Metres a tile of the map covers (default: the set's own). */
  tile?: number;
  /** How much of the map's colour variation shows (1: all of it about its mean; default 0.8). */
  variation?: number;
  /** The relief's strength (1: the map's own; default 1). */
  relief?: number;
  /** The map's roughness times this (default 1), and the metalness (default 0). */
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
}

/** A lit material with a photographed surface over the shape's own colour. */
export function surfaceMaterial(o: SurfaceOptions): THREE.MeshStandardNodeMaterial {
  const s = SETS[o.set], m = maps(o.set);
  const p = positionWorld.div(o.tile ?? s.tile), n = normalWorldGeometry;
  // (which plane a face lies in: sharpened, so a slope takes mostly one)
  const a = abs(n), w0 = a.mul(a).mul(a).mul(a), w = w0.div(w0.x.add(w0.y).add(w0.z));
  const uvX = p.zy, uvY = p.xz, uvZ = p.xy;
  const tri = (t: THREE.Texture): THREE.Node<'vec3'> =>
    texture(t, uvX).xyz.mul(w.x).add(texture(t, uvY).xyz.mul(w.y)).add(texture(t, uvZ).xyz.mul(w.z));
  const mat = new THREE.MeshStandardNodeMaterial({ side: o.side ?? THREE.FrontSide });
  const tint = new THREE.Color(o.color ?? 0xffffff);
  const base = o.vertexColors ? vertexColor().xyz : vec3(tint.r, tint.g, tint.b);
  const arm = tri(m.arm);
  // The colour: the shape's own, times the map about its mean, and darker in the map's hollows.
  mat.colorNode = base.mul(mix(vec3(1), tri(m.diff).div(s.mean), o.variation ?? 0.8)).mul(mix(float(1), arm.x, 0.6));
  mat.roughnessNode = arm.y.mul(o.roughness ?? 1).clamp(0.05, 1);
  mat.metalnessNode = float(o.metalness ?? 0);
  // The relief: each plane's tangent normal, swung onto the face's own normal and into that plane's axes.
  const k = o.relief ?? 1;
  const tn = (uv: THREE.Node<'vec2'>): THREE.Node<'vec3'> => texture(m.nor, uv).xyz.mul(2).sub(1);
  const tx = tn(uvX), ty = tn(uvY), tz = tn(uvZ);
  const nx = vec3(abs(tx.z).mul(n.x), tx.y.mul(k).add(n.y), tx.x.mul(k).add(n.z));
  const ny = vec3(ty.x.mul(k).add(n.x), abs(ty.z).mul(n.y), ty.y.mul(k).add(n.z));
  const nz = vec3(tz.x.mul(k).add(n.x), tz.y.mul(k).add(n.y), abs(tz.z).mul(n.z));
  const world = nx.mul(w.x).add(ny.mul(w.y)).add(nz.mul(w.z)).normalize();
  mat.normalNode = cameraViewMatrix.mul(vec4(world, 0)).xyz.normalize();
  return mat;
}
