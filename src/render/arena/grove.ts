// The golden club's trees (data/arenas.json `grove`): palms in rows along the court's sides (palms.ts, generated), and behind
// them a wood of olive and broadleaf trees as impostors: CC0 trees (Poly Haven island_tree_01/02, tree_small_02) rendered from
// eight sides by tools/assets/golden/impostor.py into an albedo and a normal atlas. Each tree here is one card that turns
// about its trunk to face the camera, shows the view nearest the way it is seen, and is lit through that view's normals (half
// of them bent to the crown's round, so a crown reads as a mass in the sun, not as glitter), so the sun models it like the
// palms. In the shadow pass the card faces the sun instead (`castShadowPositionNode`), so its shadow is the crown as the sun
// sees it. All the impostors of one kind are one mesh: three draws for the wood.
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, cross, float, floor, mix, mod, normalize, positionGeometry, sin, texture,
  uniform, uv, vec2, vec3, vec4, atan, PI2, round, varying,
} from 'three/tsl';
import { buildPalms, type PalmSpot } from './palms.ts';
import { ownedTextures } from '../dispose.ts';
import { FoliageMaterial } from './foliage.ts';

export interface ImpostorKind {
  /** Atlas name under assets/arena/golden/ (`<name>-albedo.webp`, `<name>-normal.webp`). */
  name: string;
  /** From the bake: the card's side (m) and how far its foot is under the ground (m). */
  frame: number; foot: number;
  views: number;
}

export interface GroveDef {
  /** Rows along both sides `x` out from z[0] to z[1] every `step`; `ends` more behind the far end (the near end is the
   * broadcast camera's, kept open). */
  palms: { x: number; z: number[]; step: number; height: number[]; lean: number; ends: number };
  /** `count` trees in the box x, z (half sizes) outside `keepOut` (half width, far end, near end): the court, its surround
   * and, at the near end, the broadcast camera's way to the court. */
  trees: { kinds: ImpostorKind[]; count: number; x: number[]; z: number[]; scale: number[]; keepOut: number[] };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/** Where the palms stand: rows along both sides `x` out, every `step` from z[0] to z[1], and `ends` behind the far end. */
export function palmSpots(p: GroveDef['palms']): PalmSpot[] {
  const r = rng(31);
  const out: PalmSpot[] = [];
  let seed = 1;
  const h = (): number => p.height[0]! + (p.height[1]! - p.height[0]!) * r();
  for (const sx of [-1, 1]) for (let z = p.z[0]!; z <= p.z[1]! + 1e-6; z += p.step) {
    out.push({ x: sx * (p.x + (r() - 0.5) * 1.2), z: z + (r() - 0.5) * 1.5, height: h(), lean: p.lean * (0.3 + r()), leanDir: r() * Math.PI * 2, seed: seed++ });
  }
  for (let i = 0; i < p.ends; i++) {
    const x = ((i + 0.5) / p.ends - 0.5) * p.x * 2.2;
    out.push({ x: x + (r() - 0.5), z: p.z[0]! - 3 - r() * 2, height: h(), lean: p.lean * (0.3 + r()), leanDir: r() * Math.PI * 2, seed: seed++ });
  }
  return out;
}

/** Where the wood's trees stand, by kind: in the box `x`, `z` outside `keepOut`. */
export function treeSpots(t: GroveDef['trees']): Array<Array<{ x: number; z: number; s: number; yaw: number; tint: number }>> {
  const r = rng(77);
  const per: Array<Array<{ x: number; z: number; s: number; yaw: number; tint: number }>> = t.kinds.map(() => []);
  let placed = 0, tries = 0;
  while (placed < t.count && tries++ < t.count * 50) {
    const x = (r() * 2 - 1) * t.x[1]!, z = (r() * 2 - 1) * t.z[1]!;
    if (Math.abs(x) < t.keepOut[0]! && z > -t.keepOut[1]! && z < t.keepOut[2]!) continue;
    const k = Math.floor(r() * t.kinds.length);
    per[k]!.push({ x, z, s: t.scale[0]! + (t.scale[1]! - t.scale[0]!) * r(), yaw: r() * Math.PI * 2, tint: 0.85 + r() * 0.25 });
    placed++;
  }
  return per;
}

/** The sun's direction, for the cards in the shadow pass (set by buildGrove from the key light). */
const sunDir = uniform(new THREE.Vector3(0, 1, 0));

function impostorMaterial(k: ImpostorKind, base: string, waits: Array<Promise<void>>): FoliageMaterial {
  // (the bake waits for them: a card without its atlas reads alpha 0 and the cube would show open sky where the wood is)
  const load = (kind: string, srgb: boolean): THREE.Texture => {
    let done!: () => void;
    waits.push(new Promise<void>((res) => { done = res; }));
    const t = new THREE.TextureLoader().load(`${base}${k.name}-${kind}.webp`, () => done(), undefined, () => done());
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const albedo = load('albedo', true), normals = load('normal', false);
  const m = new FoliageMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  // (read only through nodes: disposeTree frees them through the material's list)
  ownedTextures(m).push(albedo, normals);
  m.alphaTest = 0.45;
  const centre = attribute<'vec3'>('aCentre', 'vec3');
  const size = attribute<'float'>('aSize', 'float');
  const yaw = attribute<'float'>('aYaw', 'float');
  const tint = attribute<'float'>('aTint', 'float');
  // The card about its trunk, turned to `toward` (horizontal), a unit square scaled by the frame.
  const card = (toward: THREE.Node<'vec3'>): THREE.Node<'vec3'> => {
    const f = normalize(vec3(toward.x, 0, toward.z).add(vec3(1e-5, 0, 0)));
    const right = normalize(cross(vec3(0, 1, 0), f));
    const c = positionGeometry; // x -0.5..0.5, y 0..1
    return centre.add(right.mul(c.x.mul(size))).add(vec3(0, c.y.mul(size).sub(size.mul(k.foot / k.frame)), 0));
  };
  m.positionNode = card(cameraPosition.sub(centre));
  // (moved away from the sun by the crown's half width: along the light a shadow falls where it did, but the view card, through
  // the crown's middle, is now in front of its own shadow card and not darkened by it; neighbours still shade it)
  m.castShadowPositionNode = card(sunDir).sub(sunDir.mul(size.mul(0.4)));
  // The view: the way the tree is seen, in the bake's azimuths (Blender's +X first, counter-clockwise from above: in three
  // that is atan2(-z, x)), less the tree's own turn.
  // In the shadow pass the card faces the sun (castShadowPositionNode), and so must the view it cuts its shadow from: that
  // pass draws through the light's orthographic camera (projection [3][3] = 1; a perspective camera's is 0), whose position
  // is not the sun's direction from the tree.
  const ortho = cameraProjectionMatrix.mul(vec4(0, 0, 0, 1)).w;
  const to = varying(mix(cameraPosition.sub(centre), sunDir.mul(100), ortho), 'vToCam');
  const az = atan(to.z.negate(), to.x).sub(yaw);
  const view = mod(round(az.div(float(PI2).div(k.views))).add(k.views * 4), float(k.views)); // (az runs -3 pi..pi)
  const cols = k.views / 2;
  const col = mod(view, float(cols)), row = floor(view.div(cols));
  const st = uv();
  const at = vec2(col.add(st.x).div(cols), float(1).sub(row.add(float(1).sub(st.y)).div(2)));
  const a = texture(albedo, at);
  m.colorNode = vec4(a.rgb.mul(tint), a.a);
  // The normal: the view's (x right, y up, z to the camera) on the card's own axes, half bent to the crown's round.
  const f = normalize(vec3(to.x, 0, to.z).add(vec3(1e-5, 0, 0)));
  const right = normalize(cross(vec3(0, 1, 0), f));
  const nv = texture(normals, at).rgb.mul(2).sub(1);
  const leaf = right.mul(nv.x).add(vec3(0, 1, 0).mul(nv.y)).add(f.mul(nv.z));
  const round_ = right.mul(st.x.sub(0.5).mul(2)).add(vec3(0, st.y.sub(0.55).mul(2), 0)).add(f.mul(0.8));
  const nWorld = normalize(mix(normalize(leaf), normalize(round_), 0.5));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nWorld, 0)).xyz);
  void cos; void sin;
  return m;
}

/**
 * The grove: palms (two meshes) and the impostor wood (one mesh a kind), added to `root`. `env`: the scenery's envMap.
 * `keyDir`: towards the sun.
 */
export function buildGrove(root: THREE.Group, g: GroveDef, env: THREE.Texture | null, keyDir: THREE.Vector3, waits: Array<Promise<void>>): void {
  sunDir.value.copy(keyDir).normalize();
  const palms = buildPalms(palmSpots(g.palms), env);
  root.add(palms.trunks, palms.fronds);

  const base = typeof document !== 'undefined' ? new URL('assets/arena/golden/', document.baseURI).href : 'assets/arena/golden/';
  const t = g.trees;
  const per = treeSpots(t);
  t.kinds.forEach((k, ki) => {
    const list = per[ki]!;
    if (!list.length) return;
    const n = list.length;
    const pos = new Float32Array(n * 4 * 3), uvs = new Float32Array(n * 4 * 2), cen = new Float32Array(n * 4 * 3);
    const size = new Float32Array(n * 4), yaw = new Float32Array(n * 4), tint = new Float32Array(n * 4);
    const idx: number[] = [];
    const corners = [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [-0.5, 1, 0, 1], [0.5, 1, 1, 1]] as const;
    list.forEach((tr, i) => {
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c, cc = corners[c]!;
        pos[v * 3] = cc[0]; pos[v * 3 + 1] = cc[1]; pos[v * 3 + 2] = 0;
        uvs[v * 2] = cc[2]; uvs[v * 2 + 1] = cc[3];
        cen[v * 3] = tr.x; cen[v * 3 + 1] = 0; cen[v * 3 + 2] = tr.z;
        size[v] = k.frame * tr.s; yaw[v] = tr.yaw; tint[v] = tr.tint;
      }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aCentre', new THREE.BufferAttribute(cen, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aYaw', new THREE.BufferAttribute(yaw, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    geo.setIndex(idx);
    // (the cards move in the vertex shader: bounds from the centres and the largest card, or culling drops them)
    const half = Math.max(t.x[1]!, t.z[1]!) + k.frame * t.scale[1]!;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(half, half, k.frame * t.scale[1]!));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-half, -1, -half), new THREE.Vector3(half, k.frame * t.scale[1]!, half));
    const mat = impostorMaterial(k, base, waits);
    if (env) (mat as unknown as { envMap: THREE.Texture | null }).envMap = env;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `grove-${k.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  });
}
