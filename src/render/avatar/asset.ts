// Loads public/assets/player.bnz, built by tools/assets/build-player.mjs from the Mixamo files: the skeleton,
// the mannequin mesh, and the clips. Format: gzip of 'BNDJ', version, header length, JSON header, then 4-byte-
// aligned binary chunks the header points into ([offset, byteLength] after the header).
//
// And the people the players are dressed as (public/assets/people/<name>.bnz, version 2, built by
// tools/assets/build-people.mjs from MPFB characters): the same skeleton with the body's own bone offsets, a
// textured mesh bound in the pose it was modelled in (explicit inverse bind matrices), a second mesh for
// alpha-tested hair, brows and lashes, and two texture atlases. They play the mannequin's clips, the hips' travel
// scaled to their height.
import * as THREE from 'three/webgpu';

export interface BoneDef {
  name: string;
  parent: number;
  pos: number[];
  quat: number[];
}

export interface Clip {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** Length of one cycle (s): the last frame repeats the first in a loop. */
  duration: number;
  /** frames * bones * 4 local quaternions, kept on one hemisphere from frame to frame. */
  quat: Float32Array;
  /** frames * 3: the hips' local position (m). */
  hips: Float32Array;
  /** Locomotion only: the ground speed the clip was animated for (m/s) and its direction (model space,
   * the model facing +z, +x its left), and the phase where the left foot lands. */
  speed: number;
  dirX: number;
  dirZ: number;
  phase0: number;
}

export interface PlayerAsset {
  bones: BoneDef[];
  bone: (name: string) => number;
  geometry: THREE.BufferGeometry;
  boneInverses: THREE.Matrix4[];
  /** Each bone's rest transform in model space (the model facing +z, +x its left). */
  restWorld: THREE.Matrix4[];
  /**
   * Each vertex of `geometry` where the skinned mesh puts it with every bone at rest (model space, xyz). The bind
   * pose itself for the mannequin; for a person, the T-pose skinned from the modelled pose. Fitting (soles, grip,
   * capsules) measures the body here.
   */
  restPos: Float32Array;
  clip: (name: string) => Clip;
  /** A person's textured look; null for the mannequin. */
  look: BodyLook | null;
  /** On the mannequin's asset: the people the players are dressed as (empty: everyone is the mannequin). */
  people: PlayerAsset[];
}

/** Part codes of a person's vertices (tools/assets/mpfb/finish-player.py). */
export const P_SKIN = 0, P_SHIRT = 1, P_SHORTS = 2, P_SHOE = 3, P_EYE = 4, P_SOCK = 5, P_HAIR = 6, P_BROW = 7, P_LASH = 8;

export interface BodyLook {
  name: string;
  /** Standing height, soles to the top of the head (m). */
  height: number;
  /** Hair, brows and lashes: alpha-tested, on the same skeleton. */
  alphaGeometry: THREE.BufferGeometry;
  /** The atlases (null until loaded: node tools and tests never load them). */
  opaqueMap: THREE.Texture | null;
  alphaMap: THREE.Texture | null;
  textures: { opaque: string; alpha: string };
}

/** The people the players are dressed as, by player number (public/assets/people/). */
export const PEOPLE = ['p1', 'p2', 'p3', 'p4'];

/** Which people a page loads: all of them, or none with ?people=0 (every player the mannequin). */
export function peopleFor(params: URLSearchParams): string[] {
  return params.get('people') === '0' ? [] : PEOPLE;
}

interface MeshHeader {
  vertices: number; indices: number; min: number[]; max: number[]; index32: boolean;
  pos: number[]; nrm: number[]; skinIndex: number[]; skinWeight: number[]; index: number[];
  shade?: number[]; uv?: number[]; part?: number[];
}

interface Header {
  bones: BoneDef[];
  mesh: MeshHeader;
  clips: { name: string; frames: number; fps: number; loop: boolean; quat: number[]; hips: number[];
    speed?: number; dir?: number[]; phase0?: number }[];
}

/** Joint colour relative to the body colour (the body is tinted per player). */
const JOINT_SHADE = 0.22;

/**
 * `progress`: the share downloaded so far (0..1), for the loading screen. `people`: the names of the people to
 * load beside the mannequin (public/assets/people/, next to `url`'s folder); a person that fails to load is left
 * out (the players fall back to the mannequin) and said in the console.
 */
export async function loadPlayerAsset(url: string, progress?: (frac: number) => void, people: string[] = []): Promise<PlayerAsset> {
  const n = 1 + people.length;
  const base = parsePlayerAsset(await fetchGz(url, progress && ((f) => progress(f / n))));
  const dir = new URL('people/', url).href;
  const loader = new THREE.TextureLoader();
  const texture = async (file: string): Promise<THREE.Texture> => {
    const t = await loader.loadAsync(dir + file);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  for (let i = 0; i < people.length; i++) {
    try {
      const p = parseBodyAsset(await fetchGz(dir + people[i] + '.bnz', progress && ((f) => progress((1 + i + f) / n))), base);
      const look = p.look!;
      [look.opaqueMap, look.alphaMap] = await Promise.all([texture(look.textures.opaque), texture(look.textures.alpha)]);
      base.people.push(p);
    } catch (err) {
      console.warn(`person ${people[i]} not loaded, that player is the mannequin:`, err);
    }
  }
  progress?.(1);
  return base;
}

async function fetchGz(url: string, progress?: (frac: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`player asset: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let body = res.body as ReadableStream<BufferSource>;
  if (progress && total > 0) {
    let got = 0;
    body = body.pipeThrough(new TransformStream<BufferSource, BufferSource>({
      transform(chunk, ctl) {
        got += chunk.byteLength;
        progress(Math.min(1, got / total));
        ctl.enqueue(chunk);
      },
    }));
  }
  const buf = await new Response(body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  progress?.(1);
  return buf;
}

export function parsePlayerAsset(buf: ArrayBuffer): PlayerAsset {
  const head = new Uint32Array(buf, 0, 3);
  if (head[0] !== 0x4a444e42 || head[1] !== 1) throw new Error('player asset: bad header');
  const jsonLen = head[2]!;
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))) as Header;
  const base = 12 + jsonLen;
  const view = <T>(Ctor: { new(b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, c: number[]): T =>
    new Ctor(buf, base + c[0]!, c[1]! / Ctor.BYTES_PER_ELEMENT);

  // Mesh: dequantised once into plain attributes, shared by every player.
  const geometry = decodeMesh(buf, base, h.mesh);
  const qs = view(Uint8Array, h.mesh.shade!);
  const col = geometry.getAttribute('color').array as Float32Array;
  for (let v = 0; v < h.mesh.vertices; v++) col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = qs[v]! > 127 ? 1 : JOINT_SHADE;

  // Inverse bind matrices from the rest pose (the build checked that it is the bind pose).
  const world = restOf(h.bones);
  const boneInverses = world.map((w) => w.clone().invert());

  const nb = h.bones.length;
  const clips = new Map<string, Clip>();
  for (const c of h.clips) {
    const qq = view(Int16Array, c.quat);
    const quat = new Float32Array(qq.length);
    for (let k = 0; k < qq.length; k += 4) {
      const x = qq[k]! / 32767, y = qq[k + 1]! / 32767, z = qq[k + 2]! / 32767, w = qq[k + 3]! / 32767;
      const l = Math.hypot(x, y, z, w) || 1;
      quat[k] = x / l; quat[k + 1] = y / l; quat[k + 2] = z / l; quat[k + 3] = w / l;
    }
    if (quat.length !== c.frames * nb * 4) throw new Error(`player asset: clip ${c.name} has the wrong size`);
    clips.set(c.name, {
      name: c.name, frames: c.frames, fps: c.fps, loop: c.loop, duration: (c.frames - 1) / c.fps,
      quat, hips: view(Float32Array, c.hips).slice(),
      speed: c.speed ?? 0, dirX: c.dir?.[0] ?? 0, dirZ: c.dir?.[1] ?? 0, phase0: c.phase0 ?? 0,
    });
  }

  return assemble(h.bones, geometry, boneInverses, world, clips, null);
}

function assemble(bones: BoneDef[], geometry: THREE.BufferGeometry, boneInverses: THREE.Matrix4[], restWorld: THREE.Matrix4[],
  clips: Map<string, Clip>, look: BodyLook | null): PlayerAsset {
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const asset: PlayerAsset = {
    bones,
    bone: (name) => {
      const i = byName.get(name);
      if (i === undefined) throw new Error(`player asset: no bone ${name}`);
      return i;
    },
    geometry,
    boneInverses,
    restWorld,
    restPos: skinAtRest(geometry, restWorld, boneInverses),
    clip: (name) => {
      const c = clips.get(name);
      if (!c) throw new Error(`player asset: no clip ${name}`);
      return c;
    },
    look,
    people: [],
  };
  CLIPS.set(asset, clips);
  return asset;
}

const CLIPS = new WeakMap<PlayerAsset, Map<string, Clip>>();

function restOf(bones: BoneDef[]): THREE.Matrix4[] {
  const world: THREE.Matrix4[] = [];
  const local = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  bones.forEach((b, i) => {
    local.compose(new THREE.Vector3().fromArray(b.pos), new THREE.Quaternion().fromArray(b.quat), one);
    world[i] = b.parent < 0 ? local.clone() : world[b.parent]!.clone().multiply(local);
  });
  return world;
}

/** Linear blend skinning of every vertex with the bones at rest. */
function skinAtRest(g: THREE.BufferGeometry, rest: THREE.Matrix4[], inv: THREE.Matrix4[]): Float32Array {
  const pos = g.getAttribute('position').array as Float32Array;
  const si = g.getAttribute('skinIndex').array as Uint16Array;
  const sw = g.getAttribute('skinWeight').array as Float32Array;
  const m = rest.map((r, i) => r.clone().multiply(inv[i]!).elements);
  const out = new Float32Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k]!;
      if (w === 0) continue;
      const e = m[si[v * 4 + k]!]!;
      ox += w * (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!);
      oy += w * (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!);
      oz += w * (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
    }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
  }
  return out;
}

/** One quantised skinned mesh (both versions): position, normal, skin, white vertex colours, and uv when it has one. */
function decodeMesh(buf: ArrayBuffer, base: number, m: MeshHeader): THREE.BufferGeometry {
  const view = <T>(Ctor: { new(b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, c: number[]): T =>
    new Ctor(buf, base + c[0]!, c[1]! / Ctor.BYTES_PER_ELEMENT);
  const n = m.vertices;
  const qp = view(Uint16Array, m.pos);
  const qn = view(Int8Array, m.nrm);
  const qi = view(Uint8Array, m.skinIndex);
  const qw = view(Uint8Array, m.skinWeight);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) pos[v * 3 + k] = m.min[k]! + (qp[v * 3 + k]! / 65535) * (m.max[k]! - m.min[k]!);
    const x = qn[v * 4]!, y = qn[v * 4 + 1]!, z = qn[v * 4 + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l;
    for (let k = 0; k < 4; k++) { si[v * 4 + k] = qi[v * 4 + k]!; sw[v * 4 + k] = qw[v * 4 + k]! / 255; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (m.uv) {
    const qu = view(Uint16Array, m.uv);
    const uv = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++) uv[k] = qu[k]! / 65535;
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const index = m.index32 ? view(Uint32Array, m.index).slice() : view(Uint16Array, m.index).slice();
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

interface BodyHeader {
  name: string;
  height: number;
  /** The body's hips height over the mannequin's: the clips' hips travel is scaled by it. */
  hips: number;
  textures: { opaque: string; alpha: string };
  bones: BoneDef[];
  /** Inverse bind matrices, 16 per bone (column-major). */
  bind: number[];
  meshes: { opaque: MeshHeader; alpha: MeshHeader };
}

/** A person (version 2) on the mannequin's skeleton and clips. Its atlases are loaded separately (loadPlayerAsset). */
export function parseBodyAsset(buf: ArrayBuffer, mannequin: PlayerAsset): PlayerAsset {
  const head = new Uint32Array(buf, 0, 3);
  if (head[0] !== 0x4a444e42 || head[1] !== 2) throw new Error('person asset: bad header');
  const jsonLen = head[2]!;
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))) as BodyHeader;
  const base = 12 + jsonLen;
  if (h.bones.length !== mannequin.bones.length || h.bones.some((b, i) => b.name !== mannequin.bones[i]!.name))
    throw new Error(`person asset ${h.name}: not the game skeleton`);
  const geometry = decodeMesh(buf, base, h.meshes.opaque);
  const alphaGeometry = decodeMesh(buf, base, h.meshes.alpha);
  // One weight per part (as the kit's regions: interpolated weights blend only between the parts a triangle's
  // corners have): A = shirt, shorts, skin; B = socks, shoes, eyes.
  const part = new Uint8Array(buf, base + h.meshes.opaque.part![0]!, h.meshes.opaque.vertices);
  const pa = new Float32Array(part.length * 3), pb = new Float32Array(part.length * 3);
  const slotA = [2, 0, 1, -1, -1, -1], slotB = [-1, -1, -1, 1, 2, 0];
  for (let v = 0; v < part.length; v++) {
    const c = part[v]!;
    if (slotA[c]! >= 0) pa[v * 3 + slotA[c]!] = 1;
    else pb[v * 3 + slotB[c]!] = 1;
  }
  geometry.setAttribute('bodyA', new THREE.BufferAttribute(pa, 3));
  geometry.setAttribute('bodyB', new THREE.BufferAttribute(pb, 3));
  const boneInverses: THREE.Matrix4[] = [];
  for (let i = 0; i < h.bones.length; i++) boneInverses.push(new THREE.Matrix4().fromArray(h.bind, i * 16));
  const clips = new Map<string, Clip>();
  for (const [name, c] of CLIPS.get(mannequin)!) {
    const hips = c.hips.slice();
    for (let k = 0; k < hips.length; k++) hips[k] = hips[k]! * h.hips;
    clips.set(name, { ...c, hips, speed: c.speed * h.hips });
  }
  return assemble(h.bones, geometry, boneInverses, restOf(h.bones), clips, {
    name: h.name, height: h.height, alphaGeometry, opaqueMap: null, alphaMap: null, textures: h.textures,
  });
}
