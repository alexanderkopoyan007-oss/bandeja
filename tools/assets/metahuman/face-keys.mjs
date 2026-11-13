// A MetaHuman build's face keys (blinks, the jaw, the mouth and brows, the gaze), carried over from the same person's
// MakeHuman build: mh-player.py writes a body with none (the MetaHuman's own face rig is 874 joints and 859 shapes, none of
// it on the game's skeleton), so its face never moved. The two faces are the same face (the MetaHuman was conformed to the
// MakeHuman one, cast-batch.sh), so each key is laid over by place:
//   - skin takes its move from the nearest skin of the other face (a few vertices, by distance), the lips never from across
//     the mouth's line (the open lids are 8-9 mm apart, the faces 1-2 mm off each other: they need no such line);
//   - the lower teeth, lower gum and tongue go with the jaw as one piece each (the move fitted over the other face's, as a
//     linear map of place), the upper teeth stay; a key that parts the lips is eased until it parts them 6 mm (they are joined: PART);
//   - each eyeball turns about its OWN centre by the turn the other face's eyeball makes;
//   - lashes and brows (the alpha mesh) go with the skin of their own face under them; hair stays.
// Run after mh-player.py and before build-people.mjs (cast-batch.sh does):
//   node tools/assets/metahuman/face-keys.mjs p1 [p2 ...]     (the person; reads public/assets/people/<p>.bnz,
//                                                               rewrites assets-src/people/<p>mh/body.json + body.bin)
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';

const ROOT = new URL('../../../', import.meta.url).pathname;
const NEAREST = 6;
const REGION = 0.3; // below the eyes: how far down the keys reach (the neck's tension)
const LIPS_WIDE = 0.034, LIPS_TALL = 0.03;
// Skin further than this from any of the other face's moving skin takes nothing, fading in from FAR to NEAR (m): the keys
// are a face's, and the MakeHuman's face mesh is only what they move.
const NEAR = 0.005, FAR = 0.012;
// How much a surface's depth counts against its place on the face (as tools/assets/meshy/rig.py KEY_DEPTH: profiles differ most).
const DEPTH = 0.5;
const PART_ = { skin: 0, eye: 4, hair: 6, brow: 7, lash: 8, teeth: 9, tongue: 10 };

/** Least squares sphere through points (|p|^2 = 2 p.c + d): its centre and radius. */
function sphere(pts) {
  const N = Array.from({ length: 4 }, () => [0, 0, 0, 0]), rhs = [0, 0, 0, 0];
  for (const p of pts) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
    for (let r = 0; r < 4; r++) { rhs[r] += row[r] * y; for (let c = 0; c < 4; c++) N[r][c] += row[r] * row[c]; }
  }
  const x = solve(N, rhs);
  return { c: [x[0], x[1], x[2]], r: Math.sqrt(Math.max(0, x[3] + x[0] ** 2 + x[1] ** 2 + x[2] ** 2)) };
}

/** Gaussian elimination with pivoting, n x n. */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    if (Math.abs(M[i][i]) < 1e-14) continue;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[n] / r[i]));
}

/** The linear map (3 x 4, rows) that best gives `delta` from place over the points: delta = A p + t. */
function affine(pts, deltas) {
  const N = Array.from({ length: 4 }, () => [0, 0, 0, 0]), R = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  pts.forEach((p, i) => {
    const row = [p[0], p[1], p[2], 1];
    for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) N[r][c] += row[r] * row[c]; for (let k = 0; k < 3; k++) R[k][r] += row[r] * deltas[i][k]; }
  });
  // (a little weight on zero, so a piece that doesn't move in a key gets exactly nothing from noise)
  for (let r = 0; r < 4; r++) N[r][r] += 1e-9;
  return R.map((rhs) => solve(N, rhs));
}
const applyAffine = (A, p) => A.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);

/** The MakeHuman build as shipped: its face's and alpha mesh's vertices in the T-pose, their parts, and each key's moves. */
function readClassic(name) {
  const raw = gunzipSync(readFileSync(`${ROOT}public/assets/people/${name}.bnz`));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const head = new Uint32Array(buf, 0, 3), h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, head[2]))), base = 12 + head[2];
  const rest = [];
  h.bones.forEach((b, i) => {
    const l = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    rest[i] = b.parent < 0 ? l : rest[b.parent].clone().multiply(l);
  });
  const hi = h.bones.findIndex((b) => b.name === 'Head');
  const toT = rest[hi].clone().multiply(new THREE.Matrix4().fromArray(h.bind, hi * 16));
  const rotT = new THREE.Matrix3().setFromMatrix4(toT);
  const keys = h.meshes.opaque.morphs.map((k) => k.name);
  const out = { keys, verts: [] };
  const v3 = new THREE.Vector3();
  for (const kind of ['opaque', 'alpha']) {
    const m = h.meshes[kind], n = m.vertices;
    const qp = new Uint16Array(buf, base + m.pos[0], n * 3), part = new Uint8Array(buf, base + m.part[0], n);
    const ids = kind === 'opaque' ? new Uint32Array(buf.slice(base + m.face.verts[0], base + m.face.verts[0] + m.face.vertices * 4)) : Uint32Array.from({ length: n }, (_, i) => i);
    const data = m.morphs.map((k) => ({ q: new Int16Array(buf.slice(base + k.data[0], base + k.data[0] + k.data[1])), pos: k.pos, nrm: k.nrm }));
    ids.forEach((v, j) => {
      v3.set(...[0, 1, 2].map((a) => m.min[a] + (qp[v * 3 + a] / 65535) * (m.max[a] - m.min[a]))).applyMatrix4(toT);
      const d = data.map((k) => {
        const p = v3.clone().set(k.q[j * 6], k.q[j * 6 + 1], k.q[j * 6 + 2]).multiplyScalar(k.pos / 32767).applyMatrix3(rotT);
        const nn = v3.clone().set(k.q[j * 6 + 3], k.q[j * 6 + 4], k.q[j * 6 + 5]).multiplyScalar(k.nrm / 32767).applyMatrix3(rotT);
        return [p.x, p.y, p.z, nn.x, nn.y, nn.z];
      });
      out.verts.push({ p: [v3.x, v3.y, v3.z], part: part[v], alpha: kind === 'alpha', d });
    });
  }
  return out;
}

/** The eyeballs of a set of vertices (those of the eye part), a side at a time: centre and radius. */
function eyes(verts) {
  return [1, -1].map((side) => sphere(verts.filter((v) => v.part === PART_.eye && v.p[0] * side > 0).map((v) => v.p)));
}

for (const person of process.argv.slice(2)) {
  const name = person + 'mh', dir = `${ROOT}assets-src/people/${name}/`;
  const h = JSON.parse(readFileSync(dir + 'body.json', 'utf8'));
  let bin = readFileSync(dir + 'body.bin');
  // (run again: the keys written last time come off first)
  if (h.keysAt !== undefined) bin = bin.subarray(0, h.keysAt);
  if (h.meshes.opaque.index0) { h.meshes.opaque.index = h.meshes.opaque.index0; h.meshes.opaque.indices = h.meshes.opaque.indices0; delete h.meshes.opaque.index0; delete h.meshes.opaque.indices0; }
  const src = readClassic(person);
  const NK = src.keys.length;
  const hi = h.bones.indexOf('Head');
  const toT = new THREE.Matrix4().fromArray(h.move[hi]), rotT = new THREE.Matrix3().setFromMatrix4(toT), rotBack = rotT.clone().invert();
  const arr = (Ctor, c) => new Ctor(bin.buffer.slice(bin.byteOffset + c[0], bin.byteOffset + c[0] + c[1]));
  const v3 = new THREE.Vector3();
  const tgt = {};
  for (const kind of ['opaque', 'alpha']) {
    const m = h.meshes[kind], P = arr(Float32Array, m.pos), N = arr(Float32Array, m.nrm), part = arr(Uint8Array, m.part);
    tgt[kind] = Array.from({ length: m.vertices }, (_, v) => {
      v3.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).applyMatrix4(toT);
      const p = [v3.x, v3.y, v3.z];
      v3.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]).applyMatrix3(rotT).normalize();
      return { p, n: [v3.x, v3.y, v3.z], part: part[v] };
    });
  }

  // ---------- the two faces laid over each other: by the eyes (their middle, and how far apart they are) ----------
  const eS = eyes(src.verts), eT = eyes(tgt.opaque);
  // (in depth by the eyeballs' fronts, where the lids lie: the two builds' eyeballs are not one size, 15.6 mm and 13, and laid
  // centre on centre the MetaHuman's lids were 3-4 mm behind the MakeHuman's, nearer its brow's skin than its lids')
  const mid = (e) => [(e[0].c[0] + e[1].c[0]) / 2, (e[0].c[1] + e[1].c[1]) / 2, (e[0].c[2] + e[0].r + e[1].c[2] + e[1].r) / 2];
  const mS = mid(eS), mT = mid(eT);
  const scale = (eS[0].c[0] - eS[1].c[0]) / (eT[0].c[0] - eT[1].c[0]);
  /** A place on the MetaHuman's face, on the MakeHuman's. */
  const lay = (p) => [0, 1, 2].map((a) => mS[a] + (p[a] - mT[a]) * scale);
  console.log(name, 'eyes: MakeHuman', eS.map((e) => e.c.map((x) => +x.toFixed(4)) + ' r ' + e.r.toFixed(4)).join(' | '), '; MetaHuman', eT.map((e) => e.c.map((x) => +x.toFixed(4)) + ' r ' + e.r.toFixed(4)).join(' | '), '; scale', scale.toFixed(3));
  if (!(scale > 0.85 && scale < 1.18) || eT.some((e) => !(e.r > 0.008 && e.r < 0.02))) throw new Error(`${name}: the eyes don't look like eyes`);

  // The MakeHuman's mouth line: where the jaw's move jumps, going up the face's middle (as tools/assets/meshy/rig.py).
  const jaw = src.keys.indexOf('jawOpen');
  const midline = src.verts.filter((v) => !v.alpha && v.part === PART_.skin && Math.abs(v.p[0]) < 0.012 && v.p[1] < mS[1] - 0.035 && v.p[1] > mS[1] - 0.13 && v.p[2] > mS[2] - 0.04)
    .sort((a, b) => a.p[1] - b.p[1]);
  let mouth = mS[1] - 0.07, jump = 0;
  for (let i = 0; i + 1 < midline.length; i++) {
    const j = Math.abs(Math.abs(midline[i + 1].d[jaw][1]) - Math.abs(midline[i].d[jaw][1]));
    if (j > jump) { jump = j; mouth = (midline[i].p[1] + midline[i + 1].p[1]) / 2; }
  }

  // ---------- skin from skin ----------
  if (process.env.DEBUG) {
    const bl = src.keys.indexOf('blinkL');
    const mv = src.verts.filter((v) => Math.hypot(...v.d[bl].slice(0, 3)) > 0.003);
    const rng = (a) => [Math.min(...a), Math.max(...a)].map((x) => (x * 1000).toFixed(1));
    console.log('DEBUG blinkL movers', mv.length, 'rel eye0: x', rng(mv.map((v) => v.p[0] - eS[0].c[0])), 'y', rng(mv.map((v) => v.p[1] - eS[0].c[1])), 'z', rng(mv.map((v) => v.p[2] - eS[0].c[2])), 'dy', rng(mv.map((v) => v.d[bl][1])));
    const lid = tgt.opaque.filter((t) => t.part === 0).map((t) => lay(t.p)).filter((q) => Math.abs(q[0] - eS[0].c[0]) < 0.02 && Math.abs(q[1] - eS[0].c[1]) < 0.012 && q[2] - eS[0].c[2] > 0.004);
    console.log('DEBUG MH skin by left eye (laid)', lid.length, 'y', rng(lid.map((q) => q[1] - eS[0].c[1])), 'z', rng(lid.map((q) => q[2] - eS[0].c[2])));
    const ys = lid.map((q) => Math.round((q[1] - eS[0].c[1]) * 1000)); const hh = {}; ys.forEach((y) => { hh[y] = (hh[y] || 0) + 1; }); console.log('DEBUG MH lid y hist (mm)', JSON.stringify(hh));
    const cl = src.verts.filter((v) => !v.alpha && v.part === 0 && Math.abs(v.p[0] - eS[0].c[0]) < 0.02 && Math.abs(v.p[1] - eS[0].c[1]) < 0.012);
    const h2 = {}; cl.forEach((v) => { const y = Math.round((v.p[1] - eS[0].c[1]) * 1000); h2[y] = (h2[y] || 0) + 1; }); console.log('DEBUG classic lid y hist (mm)', JSON.stringify(h2));
    const h3 = {}; mv.forEach((v) => { const y = Math.round((v.p[1] - eS[0].c[1]) * 1000); h3[y] = (h3[y] || 0) + 1; }); console.log('DEBUG classic movers y hist (mm)', JSON.stringify(h3));
  }
  const sSkin = src.verts.filter((v) => !v.alpha && v.part === PART_.skin);
  const out = { opaque: new Float32Array(tgt.opaque.length * NK * 6), alpha: new Float32Array(tgt.alpha.length * NK * 6) };
  const put = (kind, v, k, d, back = true) => {
    const o = (v * NK + k) * 6;
    // (to the MetaHuman's size, and its modelled pose's axes)
    const p = v3.set(d[0], d[1], d[2]).divideScalar(scale); if (back) p.applyMatrix3(rotBack);
    out[kind][o] = p.x; out[kind][o + 1] = p.y; out[kind][o + 2] = p.z;
    const n = v3.set(d[3], d[4], d[5]); if (back) n.applyMatrix3(rotBack);
    out[kind][o + 3] = n.x; out[kind][o + 4] = n.y; out[kind][o + 5] = n.z;
  };
  const skinT = [];
  let far = 0, sum = 0, close = 0;
  tgt.opaque.forEach((t, v) => {
    if (t.part !== PART_.skin || t.p[1] < mT[1] - REGION / scale) return;
    const q = lay(t.p);
    if (Math.abs(q[0]) > 0.16) return;
    const byLips = Math.abs(q[0]) < LIPS_WIDE && Math.abs(q[1] - mouth) < LIPS_TALL;
    const best = [];
    for (const s of sSkin) {
      let d2 = (s.p[0] - q[0]) ** 2 + (s.p[1] - q[1]) ** 2 + ((s.p[2] - q[2]) * DEPTH) ** 2;
      if (byLips && (q[1] > mouth) !== (s.p[1] > mouth)) d2 += 1e3;
      if (best.length < NEAREST || d2 < best[best.length - 1][0]) {
        best.push([d2, s]); best.sort((a, b) => a[0] - b[0]); if (best.length > NEAREST) best.pop();
      }
    }
    const d0 = Math.sqrt(best[0][0]);
    if (d0 > FAR) return;
    const keep = 1 - Math.min(1, Math.max(0, (d0 - NEAR) / (FAR - NEAR))) ** 2;
    if (d0 < NEAR) { far = Math.max(far, d0); sum += d0; close++; }
    let wsum = 0;
    const w = best.map(([d2]) => { const x = 1 / (d2 + 2e-6) ** 1.5; wsum += x; return x; });
    const d = new Float64Array(6);
    for (let k = 0; k < NK; k++) {
      d.fill(0);
      best.forEach(([, s], i) => { for (let c = 0; c < 6; c++) d[c] += s.d[k][c] * keep * w[i] / wsum; });
      put('opaque', v, k, d);
    }
    skinT.push(v);
  });
  console.log(name, 'skin', skinT.length, 'vertices take keys,', close, 'of them within', NEAR * 1000, 'mm of the MakeHuman\'s moving skin (on average', (sum / close * 1000).toFixed(1), 'mm); mouth line', (mS[1] - mouth).toFixed(3), 'm under the eyes');

  if (process.env.DEBUG) {
    const bl = src.keys.indexOf('blinkL');
    const strong = sSkin.filter((v) => Math.hypot(...v.d[bl].slice(0, 3)) > 0.006);
    for (const sv of strong.slice(0, 14)) {
      let bd = Infinity, bv = -1;
      for (const v of skinT) { const q = lay(tgt.opaque[v].p); const d = Math.hypot(q[0] - sv.p[0], q[1] - sv.p[1], q[2] - sv.p[2]); if (d < bd) { bd = d; bv = v; } }
      const o = (bv * NK + bl) * 6;
      const q = lay(tgt.opaque[bv].p);
      console.log('DEBUG mover', sv.p.map((x, a) => ((x - eS[0].c[a]) * 1000).toFixed(1)).join(','), 'dy', (sv.d[bl][1] * 1000).toFixed(1), '-> nearest MH', (bd * 1000).toFixed(1), 'mm at', q.map((x, a) => ((x - eS[0].c[a]) * 1000).toFixed(1)).join(','), 'got', (Math.hypot(out.opaque[o], out.opaque[o + 1], out.opaque[o + 2]) * 1000).toFixed(1));
    }
    console.log('DEBUG strong movers', strong.length, 'of skin', sSkin.length);
  }
  // ---------- teeth and tongue: with the jaw as one piece each ----------
  for (const part of [PART_.teeth, PART_.tongue]) {
    const s = src.verts.filter((v) => !v.alpha && v.part === part);
    const t = tgt.opaque.map((x, v) => [x, v]).filter(([x]) => x.part === part);
    if (!s.length || !t.length) continue;
    // (the lower teeth: the ones the jaw moves; on the MetaHuman, the ones under its teeth's own gap)
    const moving = part === PART_.teeth ? s.filter((v) => Math.hypot(...v.d[jaw].slice(0, 3)) > 0.002) : s;
    // (how much of the jaw's move each vertex takes)
    let lower = t.map(([x, v]) => [x, v, 1]);
    if (part === PART_.teeth) {
      // The two rows bite over each other (no gap in height to tell them by), but each row is its own piece of mesh, and so are
      // the gums, the tongue and the palate: a piece goes with the row its middle vertex (by height) is nearer. (The tongue
      // and the palate reach far down the throat, so by their middle vertex, not their box. First the tongue was shared
      // between the rows by height: its top stayed, its underside went, and an open mouth was a pink wall.)
      const I = arr(Uint32Array, h.meshes.opaque.index), root = new Map(t.map(([, v]) => [v, v]));
      const find = (v) => { let r = v; while (root.get(r) !== r) r = root.get(r); while (root.get(v) !== r) { const nx = root.get(v); root.set(v, r); v = nx; } return r; };
      for (let i = 0; i < I.length; i += 3) if (root.has(I[i]) && root.has(I[i + 1]) && root.has(I[i + 2])) for (const o of [I[i + 1], I[i + 2]]) { const ra = find(I[i]), ro = find(o); if (ra !== ro) root.set(ra, ro); }
      const pieces = new Map();
      for (const [x, v] of t) { const r = find(v); const pc = pieces.get(r) ?? { n: 0, ys: [], lo: Infinity, hi: -Infinity, ids: [] }; pc.n++; pc.ys.push(x.p[1]); pc.lo = Math.min(pc.lo, x.p[1]); pc.hi = Math.max(pc.hi, x.p[1]); pc.ids.push([x, v]); pieces.set(r, pc); }
      const list = [...pieces.values()].map((pc) => ({ ...pc, y: pc.ys.sort((a, c) => a - c)[pc.ys.length >> 1] }));
      // (the rows themselves: the two largest pieces no taller than a row of teeth and its gum line)
      const rows = list.filter((pc) => pc.hi - pc.lo < 0.03).sort((a, c) => c.n - a.n).slice(0, 2).sort((a, c) => a.y - c.y);
      if (rows.length < 2 || rows[1].y - rows[0].y < 0.004) throw new Error(`${name}: can't tell the upper teeth from the lower`);
      const yL = rows[0].y, yU = rows[1].y;
      lower = list.filter((pc) => Math.abs(pc.y - yL) < Math.abs(pc.y - yU)).flatMap((pc) => pc.ids.map(([x, v]) => [x, v, 1]));
      console.log(name, 'teeth', t.length, 'vertices in', list.length, 'pieces (', list.map((pc) => pc.n).sort((a, c) => c - a).join(' '), '), the rows\' middles', ((yU - yL) * 1000).toFixed(1), 'mm apart;', lower.length, 'go with the jaw');
    }
    for (let k = 0; k < NK; k++) {
      const A = affine(moving.map((v) => v.p), moving.map((v) => v.d[k]));
      const An = affine(moving.map((v) => v.p), moving.map((v) => v.d[k].slice(3)));
      for (const [x, v, w] of lower) { const q = lay(x.p); put('opaque', v, k, [...applyAffine(A, q), ...applyAffine(An, q)].map((y) => y * w)); }
    }
  }

  // ---------- the eyeballs: each about its own centre, by the turn the MakeHuman's makes ----------
  [1, -1].forEach((side, e) => {
    const s = src.verts.filter((v) => !v.alpha && v.part === PART_.eye && v.p[0] * side > 0);
    for (let k = 0; k < NK; k++) {
      // (delta = (R - I)(p - c): the linear part of the fit is R - I, whatever the centre)
      const A = affine(s.map((v) => v.p), s.map((v) => v.d[k]));
      const lin = (p) => A.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
      tgt.opaque.forEach((x, v) => {
        if (x.part !== PART_.eye || x.p[0] * side <= 0) return;
        const rel = [0, 1, 2].map((a) => x.p[a] - eT[e].c[a]);
        // (already at the MetaHuman's size: no scale, so `put` gets it multiplied back)
        const d = lin(rel).map((y) => y * scale);
        put('opaque', v, k, [...d, ...lin(x.n)]);
      });
    }
  });

  // ---------- lashes and brows: with their own face's skin under them ----------
  const skinPos = skinT.map((v) => tgt.opaque[v].p);
  let hung = 0;
  tgt.alpha.forEach((t, v) => {
    if (t.part !== PART_.lash && t.part !== PART_.brow) return;
    const best = [];
    for (let i = 0; i < skinT.length; i++) {
      const s = skinPos[i], d2 = (s[0] - t.p[0]) ** 2 + (s[1] - t.p[1]) ** 2 + (s[2] - t.p[2]) ** 2;
      if (best.length < 3 || d2 < best[best.length - 1][0]) { best.push([d2, skinT[i]]); best.sort((a, b) => a[0] - b[0]); if (best.length > 3) best.pop(); }
    }
    let wsum = 0;
    const w = best.map(([d2]) => { const x = 1 / (d2 + 1e-7); wsum += x; return x; });
    for (let k = 0; k < NK; k++) {
      const o = (v * NK + k) * 6;
      best.forEach(([, sv], i) => { const so = (sv * NK + k) * 6; for (let c = 0; c < 6; c++) out.alpha[o + c] += out.opaque[so + c] * w[i] / wsum; });
    }
    hung++;
  });

  if (process.env.DEBUG) {
    // The lids' opening before and after a blink (the MetaHuman's own frame, T-pose): at three places across the left eye, the
    // lowest skin above the eye's middle and the highest below it, of the skin in front of the eyeball.
    const bl = src.keys.indexOf('blinkL'), jw = src.keys.indexOf('jawOpen'), e = eT[0];
    const moved = (v, k) => { const o = (v * NK + k) * 6; const d = v3.set(out.opaque[o], out.opaque[o + 1], out.opaque[o + 2]).applyMatrix3(rotT); return [d.x, d.y, d.z]; };
    for (const dx of [-0.007, 0, 0.007]) {
      const col = skinT.filter((v) => { const p = tgt.opaque[v].p; return Math.abs(p[0] - e.c[0] - dx) < 0.003 && Math.abs(p[1] - e.c[1]) < 0.014 && p[2] > e.c[2] + e.r * 0.5; });
      const up = col.filter((v) => moved(v, bl)[1] < -0.0008), lo = col.filter((v) => !up.includes(v) && tgt.opaque[v].p[1] < e.c[1]);
      const y0 = (v) => tgt.opaque[v].p[1] - e.c[1], y1 = (v) => y0(v) + moved(v, bl)[1];
      console.log('DEBUG lids at x', dx * 1000, 'column', col.length, 'upper', up.length, 'edge before', (Math.min(...up.map(y0)) * 1000).toFixed(1), 'after', (Math.min(...up.map(y1)) * 1000).toFixed(1), '| lower lid top before', (Math.max(...lo.map(y0)) * 1000).toFixed(1), 'after', (Math.max(...lo.map(y1)) * 1000).toFixed(1), '| eyeball r', (e.r * 1000).toFixed(1));
    }
    // The jaw: skin down the middle of the chin against the jaw's own move there (the lower teeth's fit).
    const sT = src.verts.filter((v) => !v.alpha && v.part === PART_.teeth);
    const A = affine(sT.map((v) => v.p), sT.map((v) => v.d[jw]));
    const mid2 = skinT.filter((v) => { const q = lay(tgt.opaque[v].p); return Math.abs(q[0]) < 0.006 && q[1] < mouth + 0.012 && q[1] > mouth - 0.06 && q[2] > mS[2] - 0.05; }).sort((a, c) => tgt.opaque[c].p[1] - tgt.opaque[a].p[1]);
    for (const v of mid2.filter((_, i) => i % Math.ceil(mid2.length / 14) === 0)) { const q = lay(tgt.opaque[v].p); console.log('DEBUG chin y', ((q[1] - mouth) * 1000).toFixed(1), 'z', ((q[2] - mS[2]) * 1000).toFixed(1), 'skin', moved(v, jw).map((x) => (x * scale * 1000).toFixed(1)).join(','), 'jaw', applyAffine(A, q).map((x) => (x * 1000).toFixed(1)).join(',')); }
  }
  const largest = src.keys.map((n, k) => {
    let m = 0;
    for (let v = 0; v < tgt.opaque.length; v++) { const o = (v * NK + k) * 6; m = Math.max(m, Math.hypot(out.opaque[o], out.opaque[o + 1], out.opaque[o + 2])); }
    return `${n} ${(m * 1000).toFixed(1)}`;
  });
  console.log(name, 'lashes and brows', hung, 'vertices; largest moves (mm):', largest.join(', '));

  // ---------- every key, as far as joined lips let it go ----------
  // At the face's level of detail the MetaHuman's lips are joined: a strip of small triangles runs from the upper lip's rim to
  // the lower's, the whole width of the mouth (46-131 of them). With the jaw's whole key (the lower lip 3 cm down) the strip
  // stretched into a pink sheet over the mouth, like a tongue hung out over the chin, and a grimace (1 cm) did the same; with
  // the strip taken out the lips stood apart at rest and the mouth showed the teeth as the face's detail level has them (few
  // triangles, dark), which was worse. So a key that parts the lips is scaled down, all of it, until it parts them PART at
  // most: the strip then reads as the lips' insides. (Found as the strip: skin triangles no bigger than a lip's rim, SEAL_EDGE,
  // that the jaw pulls SEAL_PULL apart.) A mouth that opens wants its inside built in mh-player.py: rims apart, a dark lining.
  const PART = 0.006, SEAL_EDGE = 0.012, SEAL_PULL = 0.018;
  const I0 = arr(Uint32Array, h.meshes.opaque.index), strip = [];
  const kd = (v, k) => { const o = (v * NK + k) * 6; return [out.opaque[o], out.opaque[o + 1], out.opaque[o + 2]]; };
  const pulled = (tri, k) => Math.max(...[0, 1, 2].map((a) => { const p = kd(tri[a], k), q = kd(tri[(a + 1) % 3], k); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
  for (let i = 0; i < I0.length; i += 3) {
    const tri = [I0[i], I0[i + 1], I0[i + 2]];
    if (!tri.every((v) => tgt.opaque[v].part === PART_.skin)) continue;
    const edge = Math.max(...[0, 1, 2].map((a) => { const p = tgt.opaque[tri[a]].p, q = tgt.opaque[tri[(a + 1) % 3]].p; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
    if (edge < SEAL_EDGE && pulled(tri, jaw) > SEAL_PULL) strip.push(tri);
  }
  if (strip.length < 20 || strip.length > 400) throw new Error(`${name}: ${strip.length} triangles between the lips is not a mouth's seam`);
  const eased = [];
  for (let k = 0; k < NK; k++) {
    const part = Math.max(...strip.map((tri) => pulled(tri, k)));
    if (part <= PART) continue;
    const f = PART / part;
    for (const kind of ['opaque', 'alpha']) for (let v = 0, n = tgt[kind].length; v < n; v++) { const o = (v * NK + k) * 6; for (let c = 0; c < 6; c++) out[kind][o + c] *= f; }
    eased.push(`${src.keys[k]} x${f.toFixed(2)} (parted the lips ${(part * 1000).toFixed(1)} mm)`);
  }
  console.log(name, 'lips joined by', strip.length, 'triangles; keys eased:', eased.join(', ') || 'none');

  // ---------- written: the keys after everything else in body.bin ----------
  h.keysAt = bin.length;
  const chunks = [bin];
  let at = bin.length;
  for (const kind of ['opaque', 'alpha']) {
    const b = Buffer.from(out[kind].buffer);
    h.meshes[kind].morph = [at, b.length];
    chunks.push(b); at += b.length;
  }
  h.morphs = src.keys;
  writeFileSync(dir + 'body.bin', Buffer.concat(chunks));
  writeFileSync(dir + 'body.json', JSON.stringify(h));
}
