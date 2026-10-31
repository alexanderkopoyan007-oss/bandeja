// Reads a shipped person (public/assets/people/<name>.bnz) back into plain files Blender's numpy can open: the opaque
// and alpha meshes in the pose they were bound in, the weights and parts, and each bone's matrix in that pose (the
// inverse of its inverse bind matrix), all in game axes. Usage: node tools/assets/meshy/read-person.mjs <name> <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';

const [name, out] = process.argv.slice(2);
const ROOT = new URL('../../../', import.meta.url).pathname;
const raw = gunzipSync(readFileSync(`${ROOT}public/assets/people/${name}.bnz`));
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const head = new Uint32Array(buf, 0, 3);
const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, head[2])));
const base = 12 + head[2];
mkdirSync(out, { recursive: true });
const parts = {};
for (const kind of ['opaque', 'alpha']) {
  const m = h.meshes[kind], n = m.vertices;
  const qp = new Uint16Array(buf, base + m.pos[0], n * 3), P = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = m.min[i % 3] + (qp[i] / 65535) * (m.max[i % 3] - m.min[i % 3]);
  const SI = new Uint8Array(buf, base + m.skinIndex[0], n * 4).slice();
  const qw = new Uint8Array(buf, base + m.skinWeight[0], n * 4), SW = Float32Array.from(qw, (x) => x / 255);
  const PART = new Uint8Array(buf, base + m.part[0], n).slice();
  const I = m.index32 ? new Uint32Array(buf, base + m.index[0], m.indices).slice() : Uint32Array.from(new Uint16Array(buf, base + m.index[0], m.indices));
  writeFileSync(`${out}/${name}-${kind}-pos.f32`, Buffer.from(P.buffer));
  writeFileSync(`${out}/${name}-${kind}-si.u8`, Buffer.from(SI.buffer));
  writeFileSync(`${out}/${name}-${kind}-sw.f32`, Buffer.from(SW.buffer));
  writeFileSync(`${out}/${name}-${kind}-part.u8`, Buffer.from(PART.buffer));
  writeFileSync(`${out}/${name}-${kind}-index.u32`, Buffer.from(I.buffer));
  parts[kind] = { vertices: n, indices: m.indices };
}
const bindPose = [], rest = [];
const nb = h.bones.length;
h.bones.forEach((b, i) => {
  const inv = new THREE.Matrix4().fromArray(h.bind, i * 16);
  bindPose.push(inv.clone().invert().elements.slice());
  const l = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
  rest[i] = b.parent < 0 ? l : rest[b.parent].clone().multiply(l);
});
writeFileSync(`${out}/${name}.json`, JSON.stringify({
  name: h.name, height: h.height, hips: h.hips, kit: h.kit, parts, partCodes: h.parts,
  bones: h.bones, bindPose, restWorld: rest.map((m) => m.elements.slice()),
}));
console.log(name, nb, 'bones', JSON.stringify(parts), 'height', h.height, 'hips', h.hips);
