// Writes the game skeleton's rest pose (public/assets/player.bnz) as world joint positions in Blender's axes
// (z up, the body facing -y), for finish-player.py to pose an MPFB rig to: node tools/assets/mpfb/ybot-rest.mjs <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
const raw = gunzipSync(readFileSync(new URL('../../../public/assets/player.bnz', import.meta.url)));
const len = new DataView(raw.buffer, raw.byteOffset).getUint32(8, true);
const h = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + len)));
const world = [];
for (let i = 0; i < h.bones.length; i++) {
  const b = h.bones[i];
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
  world.push(b.parent >= 0 ? world[b.parent].clone().multiply(m) : m);
}
const out = {};
h.bones.forEach((b, i) => {
  const p = new THREE.Vector3().setFromMatrixPosition(world[i]);
  // three (x, y, z), facing +z  ->  Blender (x, -z, y), facing -y
  out[b.name] = { parent: b.parent >= 0 ? h.bones[b.parent].name : null, head: [p.x, -p.z, p.y] };
});
const ys = Object.values(out).map((b) => b.head[2]);
console.log('bones', h.bones.length, 'mesh height', (h.mesh.max[1] - h.mesh.min[1]).toFixed(3), 'head top', Math.max(...ys).toFixed(3));
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
