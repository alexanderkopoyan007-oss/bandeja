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
  /** Shrubs in a bed along the garden wall (round 5): `count` of the wood's own cards, small (`scale`) and sunk by `sink` of
   * their height so the trunk is under the ground and only the crown shows, in a band `depth` m deep inside the lines
   * |x| = `x` and |z| = `z`. They join the wood's meshes: no draw of their own. */
  shrubs?: { count: number; x: number; z: number; depth: number; scale: number[]; sink: number };
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
export function treeSpots(t: GroveDef['trees'], sh?: GroveDef['shrubs']): Array<Array<{ x: number; z: number; s: number; yaw: number; tint: number; y?: number }>> {
  const r = rng(77);
  const per: Array<Array<{ x: number; z: number; s: number; yaw: number; tint: number; y?: number }>> = t.kinds.map(() => []);
  let placed = 0, tries = 0;
  while (placed < t.count && tries++ < t.count * 50) {
    const x = (r() * 2 - 1) * t.x[1]!, z = (r() * 2 - 1) * t.z[1]!;
    if (Math.abs(x) < t.keepOut[0]! && z > -t.keepOut[1]! && z < t.keepOut[2]!) continue;
    const k = Math.floor(r() * t.kinds.length);
    per[k]!.push({ x, z, s: t.scale[0]! + (t.scale[1]! - t.scale[0]!) * r(), yaw: r() * Math.PI * 2, tint: 0.85 + r() * 0.25 });
    placed++;
  }
  if (sh) {
    // (their own stream: the wood's trees stay where they were)
    const q = rng(4243), lx = 2 * sh.x, lz = 2 * sh.z;
    for (let i = 0; i < sh.count; i++) {
      // round the bed's line by length, so each side gets its share
      const u = q() * 2 * (lx + lz), d = q() * sh.depth;
      const x = u < lx ? u - sh.x : u < lx + lz ? sh.x - d : u < 2 * lx + lz ? sh.x - (u - lx - lz) : -sh.x + d;
      const z = u < lx ? sh.z - d : u < lx + lz ? u - lx - sh.z : u < 2 * lx + lz ? -sh.z + d : sh.z - (u - 2 * lx - lz);
      const k = Math.floor(q() * t.kinds.length);
      const s = sh.scale[0]! + (sh.scale[1]! - sh.scale[0]!) * q();
      per[k]!.push({ x, z, s, yaw: q() * Math.PI * 2, tint: 0.8 + q() * 0.3, y: -s * t.kinds[k]!.frame * sh.sink });
    }
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
  // (moved away from the sun, more the higher up the card: along the orthographic sun's light a shadow falls where it did,
  // but the view card, through the crown's middle, is now in front of its own shadow card and not darkened by it; neighbours
  // still shade it. In proportion to the height, never by one amount: a point moved along the light by more than its own
  // ray to the ground ends up under the ground and casts nothing, and the same 0.4 x size all the way down lifted every
  // tree's shadow 2.5-4.3 m off its trunk. At SHADOW_PUSH x height a point drops 0.26 of its height at the golden sun.)
  m.castShadowPositionNode = card(sunDir).sub(sunDir.mul(size.mul(positionGeometry.y).mul(SHADOW_PUSH)));
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
  const spots = palmSpots(g.palms);
  const palms = buildPalms(spots, env);
  root.add(palms.trunks, palms.fronds);
  const feet: Foot[] = spots.map((s) => ({ x: s.x, z: s.z, r: FOOT_PALM }));

  const base = typeof document !== 'undefined' ? new URL('assets/arena/golden/', document.baseURI).href : 'assets/arena/golden/';
  const t = g.trees;
  const per = treeSpots(t, g.shrubs);
  t.kinds.forEach((k, ki) => {
    const list = per[ki]!;
    if (!list.length) return;
    const n = list.length;
    const pos = new Float32Array(n * 4 * 3), uvs = new Float32Array(n * 4 * 2), cen = new Float32Array(n * 4 * 3);
    const size = new Float32Array(n * 4), yaw = new Float32Array(n * 4), tint = new Float32Array(n * 4);
    const idx: number[] = [];
    const corners = [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [-0.5, 1, 0, 1], [0.5, 1, 1, 1]] as const;
    list.forEach((tr, i) => {
      feet.push({ x: tr.x, z: tr.z, r: FOOT_TREE * tr.s });
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c, cc = corners[c]!;
        pos[v * 3] = cc[0]; pos[v * 3 + 1] = cc[1]; pos[v * 3 + 2] = 0;
        uvs[v * 2] = cc[2]; uvs[v * 2 + 1] = cc[3];
        cen[v * 3] = tr.x; cen[v * 3 + 1] = tr.y ?? 0; cen[v * 3 + 2] = tr.z;
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
  root.add(footShade(feet));
}

// Where a trunk stands the ground under it sees less of the sky (the trunk and, for a tree, the crown over it) and the
// turf is trodden and darker: without it every trunk stood on the turf as if pasted there. A soft dark disc at each foot,
// strongest at the trunk (`FOOT_DARK`) and gone at its edge, all of them one mesh; drawn over whatever lies there (turf,
// leaves). A palm's disc is a metre across (its trunk 0.5-0.7 m), a tree's grows with the tree.
interface Foot { x: number; z: number; r: number }
const SHADOW_PUSH = 0.55;
const FOOT_PALM = 0.95, FOOT_TREE = 1.1, FOOT_DARK = 0.55;

function footShade(feet: Foot[]): THREE.Mesh {
  const n = feet.length;
  const pos = new Float32Array(n * 12), uvs = new Float32Array(n * 8);
  const idx: number[] = [];
  feet.forEach((f, i) => {
    for (let c = 0; c < 4; c++) {
      const u = c & 1, v = c >> 1, k = i * 4 + c;
      pos[k * 3] = f.x + (u * 2 - 1) * f.r; pos[k * 3 + 1] = 0.003; pos[k * 3 + 2] = f.z + (v * 2 - 1) * f.r;
      uvs[k * 2] = u; uvs[k * 2 + 1] = v;
    }
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.colorNode = vec3(0, 0, 0);
  const d = uv().sub(0.5).length().mul(2);
  const a = float(1).sub(d).max(0);
  m.opacityNode = a.mul(a).mul(FOOT_DARK);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'grove-feet';
  mesh.renderOrder = 1;
  return mesh;
}
