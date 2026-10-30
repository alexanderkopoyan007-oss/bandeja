// Builds public/assets/people/<name>.bnz (+ <name>-opaque.webp, <name>-alpha.webp) from the bodies
// tools/assets/mpfb/make-player.py wrote to assets-src/people/<name>/ (body.json, body.bin and the two atlases).
// Usage: node tools/assets/build-people.mjs [name ...]   (default: every folder there)
//
// A body goes on the game skeleton (public/assets/player.bnz): the same bones in the same order with the same
// local rest rotations, so every clip, stroke and IK target drives it unchanged; only the bone offsets are the
// body's own (its T-pose joints). The mesh is bound in the pose it was modelled in, so each bone's inverse bind
// matrix is (its T-pose world matrix)^-1 x (its move from the modelled pose to the T-pose): at the rest pose the
// skinned mesh is the body in the T-pose, posed straight from its modelled shape.
//
// Format (read by src/render/avatar/asset.ts): gzip of 'BNDJ', version 3, header length, JSON header, then
// 4-byte-aligned binary chunks, as player.bnz; no clips (the game skeleton's are used, the hips' travel scaled).
// Version 3 adds per-vertex ambient occlusion and skin regions, and the face: the opaque mesh's triangles that any
// expression or gaze key moves, listed apart (`face`) with their keys as int16 deltas, so only the face carries
// morph targets; the alpha mesh (hair, brows, lashes) carries them whole.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as THREE from 'three';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = ROOT + 'assets-src/people/';
const OUT = ROOT + 'public/assets/people/';

const raw = gunzipSync(readFileSync(ROOT + 'public/assets/player.bnz'));
const len = new DataView(raw.buffer, raw.byteOffset).getUint32(8, true);
const game = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + len)));
const gameWorld = [];
for (const b of game.bones) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
  gameWorld.push(b.parent >= 0 ? gameWorld[b.parent].clone().multiply(m) : m);
}
const gameRot = gameWorld.map((m) => new THREE.Quaternion().setFromRotationMatrix(m));
const gameHips = new THREE.Vector3().setFromMatrixPosition(gameWorld[0]);

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(SRC).filter((d) => existsSync(SRC + d + '/body.json'));
mkdirSync(OUT, { recursive: true });
for (const name of names) {
  const dir = SRC + name + '/';
  const h = JSON.parse(readFileSync(dir + 'body.json', 'utf8'));
  const bin = readFileSync(dir + 'body.bin');
  const arr = (Ctor, c) => new Ctor(bin.buffer.slice(bin.byteOffset + c[0], bin.byteOffset + c[0] + c[1]));
  if (h.bones.length !== game.bones.length || h.bones.some((n, i) => n !== game.bones[i].name))
    throw new Error(`${name}: bones differ from the game skeleton's`);

  // ---------- skeleton ----------
  // Straightening the legs into the T-pose lowers the soles a few mm: the whole skeleton goes up by that much
  // (moving every joint together leaves the bind matrices as they are and lifts the skinned mesh with it).
  const move0 = h.move.map((m) => new THREE.Matrix4().fromArray(m));
  let sole = Infinity;
  {
    const m = h.meshes.opaque;
    const P = arr(Float32Array, m.pos), SI = arr(Uint8Array, m.si), SW = arr(Float32Array, m.sw);
    const v = new THREE.Vector3();
    for (let i = 0; i < m.vertices; i++) {
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const w = SW[i * 4 + k];
        if (w > 0) y += w * v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(move0[SI[i * 4 + k]]).y;
      }
      sole = Math.min(sole, y);
    }
  }
  const joint = h.joints.map((p) => new THREE.Vector3(p[0], p[1] - sole, p[2]));
  const bones = game.bones.map((b, i) => {
    const pos = b.parent < 0 ? joint[i].clone()
      : joint[i].clone().sub(joint[b.parent]).applyQuaternion(gameRot[b.parent].clone().invert());
    return { name: b.name, parent: b.parent, pos: pos.toArray().map((x) => +x.toFixed(6)), quat: b.quat };
  });
  const bind = [];
  const world = [];
  let worst = 0;
  for (let i = 0; i < bones.length; i++) {
    // The bind from the joints before the lift: the skinned mesh then rises with the skeleton.
    const w = new THREE.Matrix4().compose(new THREE.Vector3(...h.joints[i]), gameRot[i], new THREE.Vector3(1, 1, 1));
    bind.push(...w.clone().invert().multiply(move0[i]).elements.map((x) => +x.toFixed(7)));
    // The rebuilt chain (parents come first) must land on the body's joints.
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...bones[i].pos), new THREE.Quaternion(...bones[i].quat), new THREE.Vector3(1, 1, 1));
    world[i] = bones[i].parent < 0 ? local : world[bones[i].parent].clone().multiply(local);
    worst = Math.max(worst, new THREE.Vector3().setFromMatrixPosition(world[i]).distanceTo(joint[i]));
  }
  if (worst > 1e-4) throw new Error(`${name}: skeleton rebuild is off by ${worst} m`);
  const hips = joint[0].y / gameHips.y;

  // ---------- meshes ----------
  const chunks = [];
  let off = 0;
  const chunk = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const at = off;
    chunks.push(bytes);
    off += bytes.byteLength;
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
    return [at, bytes.byteLength];
  };
  const meshes = {};
  let tris = 0;
  for (const [kind, m] of Object.entries(h.meshes)) {
    const n = m.vertices;
    const P = arr(Float32Array, m.pos), N = arr(Float32Array, m.nrm), UV = arr(Float32Array, m.uv);
    const SI = arr(Uint8Array, m.si), SW = arr(Float32Array, m.sw), PART = arr(Uint8Array, m.part), I = arr(Uint32Array, m.index);
    const AO = m.ao ? arr(Float32Array, m.ao) : null, MASK = m.mask ? arr(Float32Array, m.mask) : null;
    const MORPH = m.morph ? arr(Float32Array, m.morph) : null;
    const NM = h.morphs ? h.morphs.length : 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[v * 3 + k]); max[k] = Math.max(max[k], P[v * 3 + k]); }
    const qp = new Uint16Array(n * 3), qn = new Int8Array(n * 4), qu = new Uint16Array(n * 2), qw = new Uint8Array(n * 4);
    for (let v = 0; v < n; v++) {
      for (let k = 0; k < 3; k++) qp[v * 3 + k] = Math.round(((P[v * 3 + k] - min[k]) / (max[k] - min[k])) * 65535);
      const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) qn[v * 4 + k] = Math.round((N[v * 3 + k] / l) * 127);
      for (let k = 0; k < 2; k++) qu[v * 2 + k] = Math.round(Math.min(1, Math.max(0, UV[v * 2 + k])) * 65535);
      let sum = 0, big = 0;
      for (let k = 0; k < 4; k++) { qw[v * 4 + k] = Math.round(SW[v * 4 + k] * 255); sum += qw[v * 4 + k]; if (qw[v * 4 + k] > qw[v * 4 + big]) big = k; }
      qw[v * 4 + big] += 255 - sum;
    }
    const index = n < 65536 ? Uint16Array.from(I) : I;
    tris += I.length / 3;
    meshes[kind] = {
      vertices: n, indices: I.length, min, max, index32: !(index instanceof Uint16Array),
      pos: chunk(qp), nrm: chunk(qn), uv: chunk(qu), skinIndex: chunk(SI), skinWeight: chunk(qw), part: chunk(PART), index: chunk(index),
    };
    const me = meshes[kind];
    if (AO) me.ao = chunk(Uint8Array.from(AO, (a) => Math.round(Math.min(1, Math.max(0, a)) * 255)));
    if (MASK) me.mask = chunk(Uint8Array.from(MASK, (a) => Math.round(Math.min(1, Math.max(0, a)) * 255)));
    if (MORPH && NM) {
      // Which vertices any key moves (> 0.01 mm), and for the opaque mesh the triangles touching them: the face.
      const moving = new Uint8Array(n);
      for (let v = 0; v < n; v++) for (let k = 0; k < NM; k++) {
        const o = (v * NM + k) * 6;
        if (Math.hypot(MORPH[o], MORPH[o + 1], MORPH[o + 2]) > 1e-5) { moving[v] = 1; break; }
      }
      let verts = null, faceIdx = null;
      if (kind === 'opaque') {
        const faceTri = [], bodyTri = [];
        for (let t = 0; t < I.length; t += 3) (moving[I[t]] || moving[I[t + 1]] || moving[I[t + 2]] ? faceTri : bodyTri).push(t);
        const local = new Int32Array(n).fill(-1);
        const list = [];
        for (const t of faceTri) for (let c = 0; c < 3; c++) if (local[I[t + c]] < 0) { local[I[t + c]] = list.length; list.push(I[t + c]); }
        verts = Uint32Array.from(list);
        faceIdx = Uint16Array.from(faceTri.flatMap((t) => [local[I[t]], local[I[t + 1]], local[I[t + 2]]]));
        const bodyIdx = Uint32Array.from(bodyTri.flatMap((t) => [I[t], I[t + 1], I[t + 2]]));
        me.face = { vertices: verts.length, indices: faceIdx.length, verts: chunk(verts), index: chunk(faceIdx),
          bodyIndices: bodyIdx.length, bodyIndex: chunk(n < 65536 ? Uint16Array.from(bodyIdx) : bodyIdx) };
        console.log(name, 'face', verts.length, 'vertices', faceIdx.length / 3, 'triangles; body', bodyIdx.length / 3);
      }
      // The keys over the morphing vertices (the face's for the opaque mesh, every vertex for the alpha mesh), int16
      // against each key's largest move.
      const ids = verts ?? Uint32Array.from({ length: n }, (_, i) => i);
      me.morphs = h.morphs.map((mname, k) => {
        let sp = 1e-9, sn = 1e-9;
        for (const v of ids) {
          const o = (v * NM + k) * 6;
          for (let c = 0; c < 3; c++) { sp = Math.max(sp, Math.abs(MORPH[o + c])); sn = Math.max(sn, Math.abs(MORPH[o + 3 + c])); }
        }
        const q = new Int16Array(ids.length * 6);
        ids.forEach((v, j) => {
          const o = (v * NM + k) * 6;
          for (let c = 0; c < 3; c++) { q[j * 6 + c] = Math.round((MORPH[o + c] / sp) * 32767); q[j * 6 + 3 + c] = Math.round((MORPH[o + 3 + c] / sn) * 32767); }
        });
        return { name: mname, pos: +sp.toExponential(6), nrm: +sn.toExponential(6), data: chunk(q) };
      });
    }
  }

  const header = {
    name, height: h.height, hips: +hips.toFixed(5), parts: h.parts, kit: h.kit ?? {},
    textures: { opaque: `${name}-opaque.webp`, alpha: `${name}-alpha.webp`, cloth: h.textures.cloth ?? 'suit-normal.webp' },
    bones, bind, meshes,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  const head = new Uint32Array([0x4a444e42, 3, json.byteLength + jsonPad]);
  const parts = [new Uint8Array(head.buffer), json, new Uint8Array(jsonPad).fill(0x20), ...chunks];
  const size = parts.reduce((s, p) => s + p.byteLength, 0);
  const buf = new Uint8Array(size);
  let w = 0;
  for (const p of parts) { buf.set(p, w); w += p.byteLength; }
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(OUT + name + '.bnz', gz);
  copyFileSync(dir + 'opaque.webp', OUT + header.textures.opaque);
  copyFileSync(dir + 'alpha.webp', OUT + header.textures.alpha);
  for (const f of ['suit-normal.webp', 'suit-normal-f.webp']) if (existsSync(SRC + f)) copyFileSync(SRC + f, OUT + f);
  const kb = (f) => (readFileSync(OUT + f).byteLength / 1024).toFixed(0);
  console.log(name, 'triangles', tris, 'soles lifted', (-sole * 1000).toFixed(1), 'mm, hips x', hips.toFixed(3), 'skeleton fit', (worst * 1000).toFixed(3), 'mm;',
    (gz.byteLength / 1024).toFixed(0), 'KB +', kb(header.textures.opaque), '+', kb(header.textures.alpha), 'KB textures');
}
