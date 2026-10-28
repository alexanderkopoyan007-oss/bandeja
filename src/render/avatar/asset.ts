// Loads public/assets/player.bnz, built by tools/assets/build-player.mjs from the Mixamo files: the skeleton,
// one skinned mesh shared by every player, and the clips. Format: gzip of 'BNDJ', version, header length,
// JSON header, then 4-byte-aligned binary chunks the header points into ([offset, byteLength] after the header).
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
  clip: (name: string) => Clip;
}

interface Header {
  bones: BoneDef[];
  mesh: {
    vertices: number; indices: number; min: number[]; max: number[]; index32: boolean;
    pos: number[]; nrm: number[]; skinIndex: number[]; skinWeight: number[]; shade: number[]; index: number[];
  };
  clips: { name: string; frames: number; fps: number; loop: boolean; quat: number[]; hips: number[];
    speed?: number; dir?: number[]; phase0?: number }[];
}

/** Joint colour relative to the body colour (the body is tinted per player). */
const JOINT_SHADE = 0.22;

/** `progress`: the share of the file downloaded so far (0..1), for the loading screen. */
export async function loadPlayerAsset(url: string, progress?: (frac: number) => void): Promise<PlayerAsset> {
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
  return parsePlayerAsset(buf);
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
  const m = h.mesh;
  const n = m.vertices;
  const qp = view(Uint16Array, m.pos);
  const qn = view(Int8Array, m.nrm);
  const qi = view(Uint8Array, m.skinIndex);
  const qw = view(Uint8Array, m.skinWeight);
  const qs = view(Uint8Array, m.shade);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) pos[v * 3 + k] = m.min[k]! + (qp[v * 3 + k]! / 65535) * (m.max[k]! - m.min[k]!);
    const x = qn[v * 4]!, y = qn[v * 4 + 1]!, z = qn[v * 4 + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l;
    const c = qs[v]! > 127 ? 1 : JOINT_SHADE;
    col[v * 3] = c; col[v * 3 + 1] = c; col[v * 3 + 2] = c;
    for (let k = 0; k < 4; k++) { si[v * 4 + k] = qi[v * 4 + k]!; sw[v * 4 + k] = qw[v * 4 + k]! / 255; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const index = m.index32 ? view(Uint32Array, m.index).slice() : view(Uint16Array, m.index).slice();
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  // Inverse bind matrices from the rest pose (the build checked that it is the bind pose).
  const world: THREE.Matrix4[] = [];
  const local = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const boneInverses = h.bones.map((b, i) => {
    local.compose(new THREE.Vector3().fromArray(b.pos), new THREE.Quaternion().fromArray(b.quat), one);
    world[i] = b.parent < 0 ? local.clone() : world[b.parent]!.clone().multiply(local);
    return world[i]!.clone().invert();
  });

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

  const byName = new Map(h.bones.map((b, i) => [b.name, i]));
  return {
    bones: h.bones,
    bone: (name) => {
      const i = byName.get(name);
      if (i === undefined) throw new Error(`player asset: no bone ${name}`);
      return i;
    },
    geometry,
    boneInverses,
    restWorld: world,
    clip: (name) => {
      const c = clips.get(name);
      if (!c) throw new Error(`player asset: no clip ${name}`);
      return c;
    },
  };
}
