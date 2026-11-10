// Loads public/assets/player.bnz, built by tools/assets/build-player.mjs from the Mixamo files: the skeleton,
// the mannequin mesh, and the clips. Format: gzip of 'BNDJ', version, header length, JSON header, then 4-byte-
// aligned binary chunks the header points into ([offset, byteLength] after the header).
//
// And the people the players are dressed as (public/assets/people/<name>.bnz, version 3, built by
// tools/assets/build-people.mjs from MPFB characters): the same skeleton with the body's own bone offsets, a
// textured mesh bound in the pose it was modelled in (explicit inverse bind matrices), a second mesh for
// alpha-tested hair, brows and lashes, and two texture atlases. They play the mannequin's clips, the hips' travel
// scaled to their height. Version 3 adds per-vertex occlusion and skin regions, and the face's expression and gaze
// keys: the opaque mesh's moving part is drawn as its own mesh with morph targets (`personMeshes`).
import * as THREE from 'three/webgpu';
import { remakeShoes, type ShoeFit, type SoleRef } from './shoe.ts';

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
  /** Where it was loaded from (people load from beside it, match by match). */
  url: string;
  /** A reshaped body's legs over the modelled person's, measured hip joint to ankle (proportions.ts); absent means 1. */
  legScale?: number;
  /** A reshaped body's height (look.height) over the modelled person's; absent means 1. */
  heightScale?: number;
}

/** Part codes of a person's vertices (tools/assets/mpfb/finish-player.py). */
export const P_SKIN = 0, P_SHIRT = 1, P_SHORTS = 2, P_SHOE = 3, P_EYE = 4, P_SOCK = 5, P_HAIR = 6, P_BROW = 7, P_LASH = 8;
export const P_TEETH = 9, P_TONGUE = 10;

/** The opaque mesh's part that the face keys move, drawn apart with morph targets. */
export interface FaceData {
  /** Its vertices, as ids into the person's `geometry`. */
  verts: Uint32Array;
  /** Its triangles over those (face-local ids). */
  index: Uint16Array;
  /** The rest of the opaque mesh's triangles (ids into `geometry`). */
  bodyIndex: Uint16Array | Uint32Array;
  /** One per morph (BodyLook.morphs): position and normal deltas over `verts`, xyz. */
  pos: Float32Array[];
  nrm: Float32Array[];
}

/**
 * Every cut built for a person (tools/assets/mpfb/person_wear.py): the opaque mesh's triangles by garment, and the skin each hides.
 * The game draws the garments worn (`dressedIndex`); a person without one (a MetaHuman, an older build) is drawn as modelled.
 */
export interface Wardrobe {
  /** Garment names; a garment's id is its place here ('body', always drawn, is 0). */
  pieces: string[];
  /** What they were modelled in. */
  worn: string[];
  /** Per garment, its triangles in FaceData.bodyIndex: [first index, count]. */
  ranges: Array<[number, number]>;
  /** Per vertex of the person's geometry: its garment's id; for skin, the garments that hide it (bit = id). */
  piece: Uint8Array;
  hide: Uint16Array;
  /** The V-neck's point under the Neck joint and its rise to the sides (m, m per m): kit.ts cuts it. */
  vneck?: [number, number];
}

/** What a person wears beyond the suit (data/players/*.json `kit`, tools/assets/mpfb/person_kit.py). */
export interface KitCut {
  /** (sleeveless, vneck and long: chosen cuts, paint.ts cutFor) */
  top?: 'tee' | 'polo' | 'tank' | 'sleeveless' | 'vneck' | 'long';
  bottom?: 'shorts' | 'pleated' | 'aline';
  /** A dress (paint.ts cutFor): a tank over the A-line skirt, the skirt in the shirt's colour. */
  dress?: boolean;
  head?: 'band' | 'visor';
  /** Which of the kit's small marks (kit.ts). */
  mark?: number;
  seam?: 'raglan';
  /** 'own': the shirt has a neck hole of its own (a MetaHuman garment, tools/assets/metahuman/), and the neckline follows it
   * just inside its edge instead of opening the lower scoop the MakeHuman suit is cut to (kit.ts personFrame). */
  collar?: 'own';
  /** Their own shoes' upper and sole (CSS hex): MakeHuman has one trainer, so a colour per person. */
  shoes?: string;
  sole?: string;
  /** One fused surface with its look baked into a texture (tools/assets/meshy/): no parts for the shader to colour, `bakedMaterial`. */
  baked?: boolean;
  /** Their shirt's and shorts' middle brightness (kit-mask.py). */
  shirtLum?: number;
  shortsLum?: number;
  /** Where its painted left eye and mouth are in the bind pose, and the lid's colour (rig.py, kit-mask.py). */
  eye?: [number, number, number];
  mouth?: [number, number, number];
  lid?: [number, number, number];
}

export interface BodyLook {
  name: string;
  kit: KitCut;
  /** Standing height, soles to the top of the head (m). */
  height: number;
  /** Hair, brows and lashes: alpha-tested, on the same skeleton. */
  alphaGeometry: THREE.BufferGeometry;
  /** The atlases (null until loaded: node tools and tests never load them). */
  opaqueMap: THREE.Texture | null;
  alphaMap: THREE.Texture | null;
  /** The suit's sculpted folds, a tangent-space normal map over the suit's own UVs (everyone's suit is the same one). */
  clothNormal: THREE.Texture | null;
  /** The skin's detail normals (pores, creases), tangent space on the opaque atlas's UVs: a MetaHuman's only. */
  skinNormal: THREE.Texture | null;
  /** A MetaHuman's hands at the sources' resolution: colour (occlusion in alpha) and detail normals over `handsBox` (atlas UVs
   * u0, v0, u1, v1), which the shader samples in place of the atlas there (mh-player.py). */
  handsMap: THREE.Texture | null;
  handsNormal: THREE.Texture | null;
  handsBox: [number, number, number, number] | null;
  textures: { opaque: string; alpha: string; cloth?: string; skin?: string; hands?: string; handsN?: string };
  /** The face's keys by name, in the order of every morphed mesh's influences (empty for a version-2 person). */
  morphs: string[];
  face: FaceData | null;
  /** Every cut built for them (null: drawn as modelled whatever is chosen). */
  wardrobe: Wardrobe | null;
  /** Their shoes as made to their feet when parsed (shoe.ts): what kit.ts places the laces by (none: no shoes). */
  shoe?: ShoeFit | null;
  /** The trainer the feet's animation was tuned on (shoe.ts SoleRef), for soles.ts. */
  soleRef?: SoleRef | null;
  /** The atlases at half size (Low quality: lowPerson), whose mips are each one level down from the full ones'. kit.ts
   * subtracts this from the levels it samples by hand. */
  mipShift?: number;
}

/** The roster (public/assets/people/, data/players/); a match loads the four it deals (game/cast.ts). */
export const PEOPLE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];

/** Are people wanted at all? ?people=0 keeps every player the mannequin. */
export function peopleWanted(params: URLSearchParams): boolean {
  return params.get('people') !== '0';
}

interface MeshHeader {
  vertices: number; indices: number; min: number[]; max: number[]; index32: boolean;
  pos: number[]; nrm: number[]; skinIndex: number[]; skinWeight: number[]; index: number[];
  shade?: number[]; uv?: number[]; part?: number[];
  ao?: number[]; mask?: number[];
  face?: { vertices: number; indices: number; verts: number[]; index: number[]; bodyIndices: number; bodyIndex: number[] };
  morphs?: { name: string; pos: number; nrm: number; data: number[] }[];
  wardrobe?: { pieces: string[]; worn: string[]; ranges: Array<[number, number]>; piece: number[]; hide: number[]; vneck?: [number, number] };
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
 * load beside the mannequin (see loadPeople).
 */
export async function loadPlayerAsset(url: string, progress?: (frac: number) => void, people: string[] = []): Promise<PlayerAsset> {
  const n = 1 + people.length;
  const base = parsePlayerAsset(await fetchGz(url, progress && ((f) => progress(f / n))));
  base.url = url;
  await loadPeople(base, people, progress && ((f) => progress((1 + f * people.length) / n)));
  // (fetched together, they land as they finish: put them back in the order asked, which a view without a cast reads)
  base.people.sort((a, b) => people.indexOf(a.look!.name) - people.indexOf(b.look!.name));
  progress?.(1);
  return base;
}

/** A person on the way: `body` once their file is in and parsed (their textures asked for), `done` once they are in
 * `base.people` with their textures (or failed). */
interface PersonJob { body: Promise<void>; done: Promise<void> }

/** People being fetched, by name: a match and the title's fetch ahead (app.ts) share one download. */
const fetching = new Map<string, PersonJob>();

/**
 * Loads the people a match needs into `base.people` (public/assets/people/, next to the asset's folder), those not
 * already there. A person that fails to load is left out (that player is the mannequin) and said in the console.
 */
export async function loadPeople(base: PlayerAsset, people: string[], progress?: (frac: number) => void): Promise<void> {
  await startPeople(base, people, progress).done;
}

/**
 * loadPeople in two stages: `bodies` once every body file is in and parsed, with its textures asked for; `done` once
 * the people are in `base.people`. The app builds the rest of a match between the two: built before the bodies were
 * in, it held the main thread while they arrived, and the textures, asked for only once a body was parsed, waited too.
 */
export function startPeople(base: PlayerAsset, people: string[], progress?: (frac: number) => void): { bodies: Promise<void>; done: Promise<void> } {
  const wanted = [...new Set(people)].filter((n) => !base.people.some((p) => p.look!.name === n));
  const n = wanted.length;
  // All at once: one after another, four people waited about 6 s on a slow line before the shaders could start.
  const got = new Float64Array(n);
  const report = progress && ((): void => {
    let s = 0;
    for (let i = 0; i < n; i++) s += got[i]!;
    progress(s / n);
  });
  const bodies: Promise<void>[] = [], done: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const name = wanted[i]!;
    let job = fetching.get(name);
    if (!job) {
      job = loadPerson(base, name, report && ((f) => { got[i] = f; report(); }));
      void job.done.finally(() => fetching.delete(name));
      fetching.set(name, job);
    }
    bodies.push(job.body);
    done.push(job.done.then(() => { got[i] = 1; report?.(); }));
  }
  return { bodies: Promise.all(bodies).then(() => undefined), done: Promise.all(done).then(() => undefined) };
}

function loadPerson(base: PlayerAsset, name: string, progress?: (frac: number) => void): PersonJob {
  const dir = new URL('people/', base.url).href;
  // Decoded off the main thread, flipped there too (WebGL can't flip an ImageBitmap when it uploads one), straight alpha
  // (the alpha is the skin's occlusion). An <img> decodes on the main thread inside the first upload, in the warm-up.
  const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  const texture = async (file: string): Promise<THREE.Texture> => {
    const t = new THREE.Texture(await loader.loadAsync(dir + file));
    t.flipY = false;
    t.needsUpdate = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  let bodyIn = (): void => undefined;
  const body = new Promise<void>((r) => { bodyIn = r; });
  const done = (async (): Promise<void> => {
    try {
      const buf = await fetchGz(dir + name + '.bnz', progress);
      // The textures first (their names are in the header): the parse below is a slow laptop's half second.
      const h = bodyHeader(buf);
      const tx = h.textures, hands = !!h.handsBox;
      const maps = Promise.all([
        texture(tx.opaque), texture(tx.alpha), suitNormal(texture, tx.cloth ?? 'suit-normal.webp'), tx.skin ? texture(tx.skin).then(linear) : null,
        tx.hands && hands ? texture(tx.hands) : null, tx.handsN && hands ? texture(tx.handsN).then(linear) : null]);
      // (a body that won't parse leaves its textures unwanted: no unhandled rejection for them)
      maps.catch(() => undefined);
      const p = parseBodyAsset(buf, base);
      bodyIn();
      const look = p.look!;
      [look.opaqueMap, look.alphaMap, look.clothNormal, look.skinNormal, look.handsMap, look.handsNormal] = await maps;
      base.people.push(p);
    } catch (err) {
      console.warn(`person ${name} not loaded, that player is the mannequin:`, err);
    } finally {
      bodyIn();
    }
  })();
  return { body, done };
}

/**
 * Low quality's copy of a person: the same body with its two atlases at half size (a quarter of the memory). Four
 * people's full atlases were 203 MB of the Low preset's 316 MB of textures, against a budget of 256 (perf.mjs memory);
 * at Low's render scale a player on the broadcast camera is about 150 px tall, a quarter of a half-size atlas's height.
 * Made off the main thread from the full atlases (prepareLow), kept per person; the person itself is not changed, so
 * every other game, and the creator, draws the full ones.
 */
const LOW = new WeakMap<PlayerAsset, PlayerAsset>();

export async function prepareLow(base: PlayerAsset, names: string[]): Promise<void> {
  await Promise.all(base.people.filter((p) => names.includes(p.look!.name) && !LOW.has(p)).map(async (p) => {
    const look = p.look!;
    const half = async (t: THREE.Texture | null): Promise<THREE.Texture | null> => {
      const img = t?.image as ImageBitmap | undefined;
      if (!t || !img || typeof createImageBitmap !== 'function' || !(img instanceof ImageBitmap)) return t;
      // (already flipped when loaded, straight alpha: the alpha is the skin's occlusion and the hair's coverage)
      const small = await createImageBitmap(img, { resizeWidth: Math.max(1, img.width >> 1), resizeHeight: Math.max(1, img.height >> 1),
        resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const c = new THREE.Texture(small);
      c.flipY = false;
      c.colorSpace = t.colorSpace;
      c.anisotropy = t.anisotropy;
      c.needsUpdate = true;
      return c;
    };
    try {
      const [opaqueMap, alphaMap] = await Promise.all([half(look.opaqueMap), half(look.alphaMap)]);
      LOW.set(p, { ...p, look: { ...look, opaqueMap, alphaMap, mipShift: 1 } });
    } catch (err) {
      console.warn(`person ${look.name}: no half-size atlases, drawn with the full ones:`, err);
    }
  }));
}

/** A person as Low quality draws them: the half-size copy if prepareLow made one, else the person. */
export function lowPerson(p: PlayerAsset): PlayerAsset {
  return LOW.get(p) ?? p;
}

/** A normal map's texels are directions, not colours. */
function linear(t: THREE.Texture): THREE.Texture {
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** One copy per suit for everybody in it; a player without it keeps the shader's noise folds. */
const suitNormalMaps = new Map<string, Promise<THREE.Texture | null>>();
function suitNormal(texture: (name: string) => Promise<THREE.Texture>, file: string): Promise<THREE.Texture | null> {
  let map = suitNormalMaps.get(file);
  if (!map) {
    map = texture(file).then(linear, () => null);
    suitNormalMaps.set(file, map);
  }
  return map;
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

  const asset = assemble(h.bones, geometry, boneInverses, world, clips, null);
  SOURCES.set(asset, { buf, mannequin: null });
  return asset;
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
    url: '',
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
  // Version 3: baked occlusion (eyes, shoes, hair; 1 where the atlas holds it) and skin regions (lips, T-zone,
  // eyelids, ears).
  if (m.ao) {
    const q = view(Uint8Array, m.ao);
    geometry.setAttribute('bodyAO', new THREE.BufferAttribute(Float32Array.from(q, (x) => x / 255), 1));
  }
  if (m.mask) {
    const q = view(Uint8Array, m.mask);
    geometry.setAttribute('skinMask', new THREE.BufferAttribute(Float32Array.from(q, (x) => x / 255), 4));
  }
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
  textures: { opaque: string; alpha: string; cloth?: string; skin?: string; hands?: string; handsN?: string };
  handsBox?: [number, number, number, number];
  kit?: KitCut;
  bones: BoneDef[];
  /** Inverse bind matrices, 16 per bone (column-major). */
  bind: number[];
  meshes: { opaque: MeshHeader; alpha: MeshHeader };
}

/** A person's header alone (what loadPerson needs before the parse: the textures' names). */
function bodyHeader(buf: ArrayBuffer): BodyHeader {
  const head = new Uint32Array(buf, 0, 3);
  if (head[0] !== 0x4a444e42 || (head[1] !== 2 && head[1] !== 3)) throw new Error('person asset: bad header');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, head[2]!))) as BodyHeader;
}

/** A person (version 2) on the mannequin's skeleton and clips. Its atlases are loaded separately (loadPlayerAsset). */
export function parseBodyAsset(buf: ArrayBuffer, mannequin: PlayerAsset): PlayerAsset {
  const h = bodyHeader(buf);
  const base = 12 + new Uint32Array(buf, 0, 3)[2]!;
  if (h.bones.length !== mannequin.bones.length || h.bones.some((b, i) => b.name !== mannequin.bones[i]!.name))
    throw new Error(`person asset ${h.name}: not the game skeleton`);
  const geometry = decodeMesh(buf, base, h.meshes.opaque);
  const alphaGeometry = decodeMesh(buf, base, h.meshes.alpha);
  const keys = (m: MeshHeader, n: number): { pos: Float32Array[]; nrm: Float32Array[] } => {
    const pos: Float32Array[] = [], nrm: Float32Array[] = [];
    for (const k of m.morphs ?? []) {
      const q = new Int16Array(buf, base + k.data[0]!, k.data[1]! / 2);
      const p = new Float32Array(n * 3), d = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) for (let c = 0; c < 3; c++) {
        p[j * 3 + c] = (q[j * 6 + c]! / 32767) * k.pos;
        d[j * 3 + c] = (q[j * 6 + 3 + c]! / 32767) * k.nrm;
      }
      pos.push(p);
      nrm.push(d);
    }
    return { pos, nrm };
  };
  const morphs = (h.meshes.opaque.morphs ?? []).map((k) => k.name);
  let face: FaceData | null = null;
  const fh = h.meshes.opaque.face;
  if (fh) {
    const op = h.meshes.opaque;
    const k = keys(op, fh.vertices);
    face = {
      verts: new Uint32Array(buf, base + fh.verts[0]!, fh.vertices).slice(),
      index: new Uint16Array(buf, base + fh.index[0]!, fh.indices).slice(),
      bodyIndex: op.vertices < 65536 ? new Uint16Array(buf, base + fh.bodyIndex[0]!, fh.bodyIndices).slice()
        : new Uint32Array(buf, base + fh.bodyIndex[0]!, fh.bodyIndices).slice(),
      pos: k.pos, nrm: k.nrm,
    };
  }
  if (h.meshes.alpha.morphs?.length) {
    const k = keys(h.meshes.alpha, h.meshes.alpha.vertices);
    setMorphs(alphaGeometry, morphs, k.pos, k.nrm);
  }
  // One weight per part (as the kit's regions: interpolated weights blend only between the parts a triangle's
  // corners have): A = shirt, shorts, skin, socks; B = shoes, eyes, teeth, tongue.
  const part = new Uint8Array(buf, base + h.meshes.opaque.part![0]!, h.meshes.opaque.vertices);
  const n = part.length;
  const pa = new Float32Array(n * 4), pb = new Float32Array(n * 4);
  // By part code: skin, shirt, shorts, shoe, eye, sock, (hair, brow, lash: the alpha mesh), teeth, tongue.
  const slot: Array<[Float32Array, number] | null> = [[pa, 2], [pa, 0], [pa, 1], [pb, 0], [pb, 1], [pa, 3], null, null, null, [pb, 2], [pb, 3]];
  for (let v = 0; v < n; v++) {
    const s = slot[part[v]!];
    if (s) s[0][v * 4 + s[1]] = 1;
  }
  geometry.setAttribute('bodyA', new THREE.BufferAttribute(pa, 4));
  geometry.setAttribute('bodyB', new THREE.BufferAttribute(pb, 4));
  // Per part, packed into one attribute (WebGPU allows 8 vertex buffers, skinning takes 5 of them): skin (lips,
  // T-zone, eyelids, ears); eyes, shoes and socks: x = their baked occlusion; the skirt: x = how far down it, 0 at the waist
  // to 1 at the hem (`mask` in the file, 0 on shorts); the shirt: x = where it gets wet first, z = out from the chest and
  // w = height in the T-pose (kit.ts fills them in).
  const X = new Float32Array(n * 4);
  const ao = geometry.getAttribute('bodyAO') as THREE.BufferAttribute | undefined;
  const mk = geometry.getAttribute('skinMask') as THREE.BufferAttribute | undefined;
  for (let v = 0; v < n; v++) {
    const c = part[v]!;
    if (c === P_SKIN && mk) for (let k = 0; k < 4; k++) X[v * 4 + k] = mk.array[v * 4 + k]!;
    else if (c === P_SHORTS && mk) X[v * 4] = mk.array[v * 4]!;
    else if (c === P_EYE || c === P_SHOE || c === P_SOCK) X[v * 4] = ao ? ao.array[v]! : 1;
  }
  geometry.deleteAttribute('bodyAO');
  geometry.deleteAttribute('skinMask');
  geometry.setAttribute('bodyX', new THREE.BufferAttribute(X, 4));
  const boneInverses: THREE.Matrix4[] = [];
  for (let i = 0; i < h.bones.length; i++) boneInverses.push(new THREE.Matrix4().fromArray(h.bind, i * 16));
  const clips = new Map<string, Clip>();
  for (const [name, c] of CLIPS.get(mannequin)!) {
    const hips = c.hips.slice();
    for (let k = 0; k < hips.length; k++) hips[k] = hips[k]! * h.hips;
    clips.set(name, { ...c, hips, speed: c.speed * h.hips });
  }
  const wh = h.meshes.opaque.wardrobe;
  const wardrobe: Wardrobe | null = wh && face ? {
    pieces: wh.pieces, worn: wh.worn, ranges: wh.ranges, vneck: wh.vneck,
    piece: new Uint8Array(buf, base + wh.piece[0]!, h.meshes.opaque.vertices).slice(),
    hide: new Uint16Array(buf, base + wh.hide[0]!, h.meshes.opaque.vertices).slice(),
  } : null;
  // Their trainers, swapped for shoes made to their feet (shoe.ts).
  const restWorld = restOf(h.bones);
  const shoes = remakeShoes(geometry, face?.bodyIndex ?? null, wardrobe, restWorld.map((r, i) => r.clone().multiply(boneInverses[i]!)));
  if (face && shoes?.bodyIndex) face.bodyIndex = shoes.bodyIndex;
  const asset = assemble(h.bones, geometry, boneInverses, restWorld, clips, {
    name: h.name, kit: h.kit ?? {}, height: h.height, alphaGeometry, opaqueMap: null, alphaMap: null, clothNormal: null, skinNormal: null,
    handsMap: null, handsNormal: null, handsBox: h.handsBox ?? null, textures: h.textures, morphs, face,
    wardrobe, shoe: shoes?.fit ?? null, soleRef: shoes?.soleRef ?? null,
  });
  SOURCES.set(asset, { buf, mannequin });
  return asset;
}

/**
 * Each parsed asset's decoded file: an asset a match has used isn't as parsed any more (cupPalms moves the palms, the kit's
 * personFrame cuts the neckline out of the index and fills bodyX from the rest pose), so a body built from it
 * (proportions.ts) starts from a fresh parse of the same bytes.
 */
const SOURCES = new WeakMap<PlayerAsset, { buf: ArrayBuffer; mannequin: PlayerAsset | null }>();

/** `asset` as it was parsed, with the textures it has loaded since. */
export function pristineCopy(asset: PlayerAsset): PlayerAsset {
  const src = SOURCES.get(asset);
  if (!src) throw new Error('player asset: not parsed from a file');
  const a = src.mannequin ? parseBodyAsset(src.buf, src.mannequin) : parsePlayerAsset(src.buf);
  a.url = asset.url;
  if (a.look && asset.look) {
    a.look.opaqueMap = asset.look.opaqueMap;
    a.look.alphaMap = asset.look.alphaMap;
    a.look.clothNormal = asset.look.clothNormal;
    a.look.skinNormal = asset.look.skinNormal;
    a.look.handsMap = asset.look.handsMap;
    a.look.handsNormal = asset.look.handsNormal;
  }
  return a;
}

/** The leg from hip joint to ankle at rest (m), as the avatar measures it. */
export function legLength(a: PlayerAsset): number {
  const p = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);
  return p('LeftUpLeg').distanceTo(p('LeftLeg')) + p('LeftLeg').distanceTo(p('LeftFoot'));
}

/**
 * `src` on a new skeleton (proportions.ts): its bones, mesh (in the bind pose of `boneInverses`) and look, with every clip's
 * hips and ground speed scaled by `hipScale` (the new hips' height over the old).
 */
export function rebodied(src: PlayerAsset, bones: BoneDef[], geometry: THREE.BufferGeometry, boneInverses: THREE.Matrix4[], look: BodyLook | null,
  hipScale: number): PlayerAsset {
  const clips = new Map<string, Clip>();
  for (const [name, c] of CLIPS.get(src)!) {
    const hips = c.hips.slice();
    for (let k = 0; k < hips.length; k++) hips[k] = hips[k]! * hipScale;
    clips.set(name, { ...c, hips, speed: c.speed * hipScale });
  }
  const a = assemble(bones, geometry, boneInverses, restOf(bones), clips, look);
  a.url = src.url;
  return a;
}

function setMorphs(g: THREE.BufferGeometry, names: string[], pos: Float32Array[], nrm: Float32Array[]): void {
  g.morphAttributes.position = pos.map((p, i) => { const a = new THREE.BufferAttribute(p, 3); a.name = names[i]!; return a; });
  g.morphAttributes.normal = nrm.map((p, i) => { const a = new THREE.BufferAttribute(p, 3); a.name = names[i]!; return a; });
  g.morphTargetsRelative = true;
}

const MESHES = new WeakMap<PlayerAsset, { body: THREE.BufferGeometry; face: THREE.BufferGeometry | null }>();

/**
 * What a person is drawn with: the opaque mesh without its face (sharing `geometry`'s attributes) and the face as its
 * own small mesh with the expression and gaze morph targets (only it pays for them). Built once per asset, after the
 * material has added its attributes to `geometry` (personMaterial), since both take every attribute it has then.
 * A version-2 person (no face) is drawn whole.
 */
export function personMeshes(asset: PlayerAsset): { body: THREE.BufferGeometry; face: THREE.BufferGeometry | null } {
  let m = MESHES.get(asset);
  if (m) return m;
  const f = asset.look?.face;
  if (!f) {
    m = { body: asset.geometry, face: null };
  } else {
    const g = asset.geometry;
    const body = new THREE.BufferGeometry();
    const face = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      body.setAttribute(name, a);
      const s = a.itemSize, src = a.array as Float32Array;
      const out = new (src.constructor as Float32ArrayConstructor)(f.verts.length * s);
      for (let j = 0; j < f.verts.length; j++) for (let c = 0; c < s; c++) out[j * s + c] = src[f.verts[j]! * s + c]!;
      face.setAttribute(name, new THREE.BufferAttribute(out, s, a.normalized));
    }
    body.setIndex(new THREE.BufferAttribute(asset.look!.wardrobe ? dressedIndex(asset, asset.look!.wardrobe.worn) : f.bodyIndex, 1));
    face.setIndex(new THREE.BufferAttribute(f.index, 1));
    setMorphs(face, asset.look!.morphs, f.pos, f.nrm);
    body.computeBoundingSphere();
    face.computeBoundingSphere();
    m = { body, face };
  }
  MESHES.set(asset, m);
  return m;
}

/**
 * The opaque mesh's triangles (but the face's) for a person wearing `pieces` (Wardrobe.pieces names): those garments' own, the
 * shoes', and every skin triangle but those all of whose corners a worn garment hides.
 */
export function dressedIndex(asset: PlayerAsset, pieces: readonly string[]): Uint16Array | Uint32Array {
  const w = asset.look!.wardrobe!, src = asset.look!.face!.bodyIndex;
  const on = new Set(['body', 'shoe', ...pieces].map((p) => w.pieces.indexOf(p)).filter((i) => i >= 0));
  let bits = 0;
  for (const i of on) bits |= 1 << i;
  const hidden = (v: number): boolean => (w.hide[v]! & bits) !== 0;
  const out: number[] = [];
  for (const i of [...on].sort((a, b) => a - b)) {
    const [start, count] = w.ranges[i]!;
    for (let t = start; t < start + count; t += 3) {
      const a = src[t]!, b = src[t + 1]!, c = src[t + 2]!;
      if (i === 0 && hidden(a) && hidden(b) && hidden(c)) continue;
      out.push(a, b, c);
    }
  }
  return src instanceof Uint32Array ? Uint32Array.from(out) : Uint16Array.from(out);
}

const MODELLED = new WeakMap<PlayerAsset, Uint8Array>();

/**
 * Per vertex of `asset.geometry`, 1 if it belongs to what they were modelled in (Wardrobe.worn, and all skin): the other cuts in a
 * wardrobe lie over the same body, so whatever measures the body by its parts (the kit's landmarks, a head piece's or a
 * wristband's fit) looks at these alone. All 1 without a wardrobe.
 */
export function modelledVertices(asset: PlayerAsset): Uint8Array {
  let m = MODELLED.get(asset);
  if (m) return m;
  const n = asset.geometry.getAttribute('position').count;
  m = new Uint8Array(n).fill(1);
  const w = asset.look?.wardrobe;
  if (w) {
    const worn = new Set(['body', ...w.worn].map((p) => w.pieces.indexOf(p)));
    for (let i = 0; i < n; i++) m[i] = worn.has(w.piece[i]!) ? 1 : 0;
  }
  MODELLED.set(asset, m);
  return m;
}

/** As modelledVertices, for a person wearing `pieces` (Wardrobe.pieces names; null: as modelled). */
export function wornVertices(asset: PlayerAsset, pieces: readonly string[] | null): Uint8Array {
  const w = asset.look?.wardrobe;
  if (!pieces || !w) return modelledVertices(asset);
  const on = new Set(['body', 'shoe', ...pieces].map((p) => w.pieces.indexOf(p)));
  return Uint8Array.from(w.piece, (k) => (on.has(k) ? 1 : 0));
}
