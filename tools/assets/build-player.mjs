// Builds public/assets/player.bin from the raw Mixamo files in assets-src/mixamo/ (gitignored; see docs/mixamo.md).
// Usage: node tools/assets/build-player.mjs
//
// What it does:
// - Loads Y Bot and rebuilds one clean skeleton. FBXLoader gives a bone used by both meshes a same-named child
//   copy; the copies are dropped and both meshes are rebound to the originals.
// - Merges the body and joint meshes into one indexed, quantised mesh (one draw call per player). A per-vertex
//   shade byte keeps the joints darker than the body.
// - Converts centimetres to metres and samples every clip at 30 fps into quantised quaternions per bone plus the
//   hips position.
// - Measures the ground speed each locomotion clip was animated for (from the planted foot), so the game can
//   play it at the rate that stops the feet sliding.
//
// The format is ours (read by src/render/avatar/asset.ts): 'BNDJ', version, header length, JSON header, then
// 4-byte-aligned binary chunks the header points into.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = ROOT + 'assets-src/mixamo/';
// Gzipped by us, under an extension no server re-encodes; the game inflates it with DecompressionStream.
const OUT = ROOT + 'public/assets/player.bnz';
const CM = 0.01;
const FPS = 30;

/**
 * name: clip name in the game. loco: measure the ground speed. flat: drop the hips' sideways and fore-aft travel
 * (clips that step or jump away; the game moves the body itself).
 */
const CLIPS = [
  { file: 'idle-ready', name: 'idle', loop: true },
  { file: 'run', name: 'run', loop: true, loco: true },
  { file: 'run-back', name: 'runBack', loop: true, loco: true },
  { file: 'strafe-left', name: 'strafeLeft', loop: true, loco: true },
  { file: 'strafe-right', name: 'strafeRight', loop: true, loco: true },
  { file: 'jog', name: 'jog', loop: true, loco: true },
  { file: 'hop', name: 'hop', loop: false, flat: true },
  { file: 'lunge', name: 'lunge', loop: false, flat: true },
  { file: 'celebrate', name: 'celebrate', loop: false },
  { file: 'dejected', name: 'dejected', loop: false },
];

function load(file) {
  const buf = readFileSync(SRC + file + '.fbx');
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

// ---------- skeleton ----------
const ybot = load('ybot');
ybot.updateMatrixWorld(true);
const top = ybot.children.find((c) => c.isBone);
const bones = []; // { obj, name, parent }
(function walk(b, parent) {
  const idx = bones.length;
  bones.push({ obj: b, name: b.name, parent });
  for (const c of b.children) {
    if (!c.isBone) continue;
    if (c.name === b.name) continue; // FBXLoader's per-skeleton copy
    walk(c, idx);
  }
})(top, -1);
const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
console.log('bones', bones.length);

// ---------- mesh ----------
const meshes = ybot.children.filter((c) => c.isSkinnedMesh);
const parts = [];
for (const m of meshes) {
  const id = m.matrixWorld.equals(new THREE.Matrix4()) && m.bindMatrix.equals(new THREE.Matrix4());
  if (!id) throw new Error(`${m.name}: world or bind matrix is not identity; handle it`);
  const g = m.geometry;
  const map = m.skeleton.bones.map((b) => {
    const i = boneIndex.get(b.name);
    if (i === undefined) throw new Error('unknown bone ' + b.name);
    return i;
  });
  // The FBX inverse bind matrices must agree with the clean skeleton's rest pose (checked after scaling below).
  m.skeleton.bones.forEach((b, j) => {
    const inv = new THREE.Matrix4().copy(bones[map[j]].obj.matrixWorld).invert();
    const fbx = m.skeleton.boneInverses[j];
    let d = 0;
    for (let k = 0; k < 16; k++) d = Math.max(d, Math.abs(inv.elements[k] - fbx.elements[k]));
    if (d > 1e-2) throw new Error(`${m.name}/${b.name}: rest pose differs from bind pose by ${d}`);
  });
  const n = g.attributes.position.count;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const idx = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) idx[v * 4 + k] = sw.getComponent(v, k) > 0 ? map[si.getComponent(v, k)] : 0;
  const shade = m.name === 'Alpha_Joints' ? 0 : 1;
  parts.push({ g, idx, shade, n });
}
let total = 0;
for (const p of parts) total += p.n;
const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
const sidx = new Float32Array(total * 4), sw = new Float32Array(total * 4), shade = new Float32Array(total);
let o = 0;
for (const p of parts) {
  const P = p.g.attributes.position, N = p.g.attributes.normal, W = p.g.attributes.skinWeight;
  for (let v = 0; v < p.n; v++, o++) {
    pos[o * 3] = P.getX(v) * CM; pos[o * 3 + 1] = P.getY(v) * CM; pos[o * 3 + 2] = P.getZ(v) * CM;
    nrm[o * 3] = N.getX(v); nrm[o * 3 + 1] = N.getY(v); nrm[o * 3 + 2] = N.getZ(v);
    for (let k = 0; k < 4; k++) { sidx[o * 4 + k] = p.idx[v * 4 + k]; sw[o * 4 + k] = W.getComponent(v, k); }
    shade[o] = p.shade;
  }
}
let geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
geo.setAttribute('skinIndex', new THREE.BufferAttribute(sidx, 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
geo.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
geo = mergeVertices(geo, 1e-4);
const vCount = geo.attributes.position.count;
const iCount = geo.index.count;
console.log('mesh', total, 'corners ->', vCount, 'vertices,', iCount / 3, 'triangles');

// ---------- rest pose in metres ----------
for (const b of bones) b.obj.position.multiplyScalar(CM);
top.updateMatrixWorld(true);
const rest = bones.map((b) => ({ pos: b.obj.position.toArray(), quat: b.obj.quaternion.toArray() }));

// ---------- clips ----------
const footL = boneIndex.get('mixamorigLeftToeBase'), footR = boneIndex.get('mixamorigRightToeBase');
const hipsIdx = 0;
function applyFrame(q, h, f) {
  for (let b = 0; b < bones.length; b++) bones[b].obj.quaternion.fromArray(q, (f * bones.length + b) * 4);
  bones[hipsIdx].obj.position.fromArray(h, f * 3);
  top.updateMatrixWorld(true);
}
const clipsOut = [];
for (const c of CLIPS) {
  const obj = load(c.file);
  const clip = obj.animations.find((a) => a.tracks.length > 0);
  const frames = Math.round(clip.duration * FPS) + 1;
  const q = new Float32Array(frames * bones.length * 4);
  const h = new Float32Array(frames * 3);
  // Sample through three's own interpolants: same result as playing the FBX, at exact frame times.
  const interps = bones.map((b) => {
    const tq = clip.tracks.find((t) => t.name === b.name + '.quaternion');
    return tq ? tq.createInterpolant(new Float32Array(4)) : null;
  });
  const tp = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
  const ip = tp.createInterpolant(new Float32Array(3));
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / FPS);
    for (let b = 0; b < bones.length; b++) {
      const at = (f * bones.length + b) * 4;
      if (interps[b]) {
        const r = interps[b].evaluate(t);
        const len = Math.hypot(r[0], r[1], r[2], r[3]);
        for (let k = 0; k < 4; k++) q[at + k] = r[k] / len;
      } else {
        for (let k = 0; k < 4; k++) q[at + k] = rest[b].quat[k];
      }
      // Keep each bone on one hemisphere from frame to frame, so the game can lerp between frames.
      if (f > 0) {
        const pv = at - bones.length * 4;
        if (q[at] * q[pv] + q[at + 1] * q[pv + 1] + q[at + 2] * q[pv + 2] + q[at + 3] * q[pv + 3] < 0)
          for (let k = 0; k < 4; k++) q[at + k] = -q[at + k];
      }
    }
    const r = ip.evaluate(t);
    h[f * 3] = r[0] * CM; h[f * 3 + 1] = r[1] * CM; h[f * 3 + 2] = r[2] * CM;
  }
  if (c.flat) for (let f = frames - 1; f >= 0; f--) { h[f * 3] = h[0]; h[f * 3 + 2] = h[2]; }
  const out = { name: c.name, frames, fps: FPS, loop: c.loop, q, h };
  if (c.loco) {
    // Ground velocity: while a foot is planted (within 2.5 cm of its lowest) it moves backwards under the
    // in-place body at the clip's speed. Speed = median over both feet; direction = against their mean motion
    // (model space, the model facing +z). The cycle is re-phased so phase 0 is the left foot landing, which lets
    // the game blend clips at one shared phase without the feet fighting.
    const speeds = [];
    let sx = 0, sz = 0, land = -1;
    for (const fi of [footL, footR]) {
      const p = [];
      for (let f = 0; f < frames; f++) {
        applyFrame(q, h, f);
        p.push(new THREE.Vector3().setFromMatrixPosition(bones[fi].obj.matrixWorld));
      }
      const minY = Math.min(...p.map((v) => v.y));
      const down = (f) => p[f].y < minY + 0.025;
      for (let f = 1; f < frames; f++) {
        if (down(f) && down(f - 1)) {
          const dx = p[f].x - p[f - 1].x, dz = p[f].z - p[f - 1].z;
          speeds.push(Math.hypot(dx, dz) * FPS);
          sx += dx; sz += dz;
        }
        if (fi === footL && land < 0 && down(f) && !down(f - 1)) land = f;
      }
    }
    speeds.sort((a, b) => a - b);
    out.speed = +speeds[speeds.length >> 1].toFixed(3);
    const l = Math.hypot(sx, sz);
    out.dir = [+(-sx / l).toFixed(3), +(-sz / l).toFixed(3)];
    out.phase0 = +(Math.max(0, land) / (frames - 1)).toFixed(4);
  }
  clipsOut.push(out);
  console.log(c.name.padEnd(12), 'frames', String(frames).padStart(3), out.speed ? `speed ${out.speed} m/s dir ${out.dir} left foot lands at ${out.phase0}` : '');
}

// ---------- write ----------
const chunks = [];
let off = 0;
function chunk(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const at = off;
  chunks.push(bytes);
  off += bytes.byteLength;
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
  return [at, bytes.byteLength];
}
const P = geo.attributes.position.array, N = geo.attributes.normal.array;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < vCount; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[v * 3 + k]); max[k] = Math.max(max[k], P[v * 3 + k]); }
const qp = new Uint16Array(vCount * 3), qn = new Int8Array(vCount * 4), qi = new Uint8Array(vCount * 4), qw = new Uint8Array(vCount * 4), qs = new Uint8Array(vCount);
const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array, SH = geo.attributes.shade.array;
for (let v = 0; v < vCount; v++) {
  for (let k = 0; k < 3; k++) qp[v * 3 + k] = Math.round(((P[v * 3 + k] - min[k]) / (max[k] - min[k])) * 65535);
  const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
  for (let k = 0; k < 3; k++) qn[v * 4 + k] = Math.round((N[v * 3 + k] / l) * 127);
  // Weights to bytes that still sum to exactly 255 (the rounding error goes to the largest).
  let sum = 0, big = 0;
  for (let k = 0; k < 4; k++) { qi[v * 4 + k] = SI[v * 4 + k]; qw[v * 4 + k] = Math.round(SW[v * 4 + k] * 255); sum += qw[v * 4 + k]; if (qw[v * 4 + k] > qw[v * 4 + big]) big = k; }
  qw[v * 4 + big] += 255 - sum;
  qs[v] = SH[v] > 0.5 ? 255 : 0;
}
const I = geo.index.array;
const index = vCount < 65536 ? Uint16Array.from(I) : Uint32Array.from(I);
const header = {
  bones: bones.map((b, i) => ({ name: b.name.replace(/^mixamorig/, ''), parent: b.parent, pos: rest[i].pos.map((x) => +x.toFixed(6)), quat: rest[i].quat.map((x) => +x.toFixed(7)) })),
  mesh: {
    vertices: vCount, indices: iCount, min, max, index32: !(index instanceof Uint16Array),
    pos: chunk(qp), nrm: chunk(qn), skinIndex: chunk(qi), skinWeight: chunk(qw), shade: chunk(qs), index: chunk(index),
  },
  clips: clipsOut.map((c) => {
    const qq = new Int16Array(c.q.length);
    for (let k = 0; k < c.q.length; k++) qq[k] = Math.round(c.q[k] * 32767);
    const e = { name: c.name, frames: c.frames, fps: c.fps, loop: c.loop, quat: chunk(qq), hips: chunk(c.h) };
    if (c.speed) Object.assign(e, { speed: c.speed, dir: c.dir, phase0: c.phase0 });
    return e;
  }),
};
const json = new TextEncoder().encode(JSON.stringify(header));
const jsonPad = (4 - (json.byteLength % 4)) % 4;
const head = new Uint32Array([0x4a444e42, 1, json.byteLength + jsonPad]); // 'BNDJ'
const parts2 = [new Uint8Array(head.buffer), json, new Uint8Array(jsonPad).fill(0x20), ...chunks];
const size = parts2.reduce((s, p) => s + p.byteLength, 0);
const outBuf = new Uint8Array(size);
let w = 0;
for (const p of parts2) { outBuf.set(p, w); w += p.byteLength; }
mkdirSync(ROOT + 'public/assets', { recursive: true });
const gz = gzipSync(outBuf, { level: 9 });
writeFileSync(OUT, gz);
console.log('wrote', OUT.replace(ROOT, ''), (size / 1024).toFixed(0), 'KB raw,', (gz.byteLength / 1024).toFixed(0), 'KB gzipped');
