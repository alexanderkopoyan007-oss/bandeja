// A MetaHuman build's face keys (blinks, the jaw, the mouth and brows, the gaze), carried over from the same person's
// MakeHuman build: mh-player.py writes a body with none (the MetaHuman's own face rig is 874 joints and 859 shapes, none of
// it on the game's skeleton), so its face never moved. The two faces are the same face (the MetaHuman was conformed to the
// MakeHuman one, cast-batch.sh), so each key is laid over by place:
//   - skin takes its move from the nearest skin of the other face (a few vertices, by distance), the lips never from across
//     their parting (the MetaHuman's own, found on its lips; the open lids are 8-9 mm apart, the faces 1-2 mm off each other:
//     they need no such line), each lip's moves smoothed along it;
//   - the mouth's inside (the lips' insides and the lining behind them) is shared between the lips by how far round it is to
//     each, and darkened by depth behind the lips (the shade an open mouth has);
//   - the lower teeth, lower gum and tongue go with the jaw as one piece each (the move fitted over the other face's, as a
//     linear map of place), the tongue and gum dropping as the front teeth do, the upper teeth stay;
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
  // (a copy of its own, at offset 0: the mouth's parts and shade are written into it, and the last run's taken off again here)
  { const own = new Uint8Array(bin.length); own.set(bin); bin = Buffer.from(own.buffer); }
  if (h.mouthWas) {
    const PT = new Uint8Array(bin.buffer, h.meshes.opaque.part[0], h.meshes.opaque.vertices), AO = new Float32Array(bin.buffer, h.meshes.opaque.ao[0], h.meshes.opaque.vertices);
    for (const [v, pt, a] of h.mouthWas) { PT[v] = pt; AO[v] = a; }
    delete h.mouthWas;
  }
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

  // The MetaHuman's own parting, by the lips' rims across the mouth: the lower lip's top (facing up) and the upper's underside
  // (facing down), front skin only. (The MakeHuman's line laid by the eyes falls on the lower lip's front.)
  const PART_BIN = 0.003, partAt = new Map();
  {
    const fr = new Map(), cand = [];
    tgt.opaque.forEach((t, v) => { if (t.part !== PART_.skin) return; const q = lay(t.p); if (Math.abs(q[0]) > LIPS_WIDE || Math.abs(q[1] - mouth) > 0.01) return; const b = Math.round(q[0] / PART_BIN); fr.set(b, Math.max(fr.get(b) ?? -1, q[2])); cand.push([b, q, t.n]); });
    const bins = new Map();
    for (const [b, q, n] of cand) { if (q[2] < fr.get(b) - 0.006) continue; const e = bins.get(b) ?? { top: -1, under: [] }; if (n[1] > 0.5) e.top = Math.max(e.top, q[1]); if (n[1] < -0.5) e.under.push(q[1]); bins.set(b, e); }
    for (const [b, e] of bins) { if (e.top < 0) continue; const u = e.under.filter((y) => y >= e.top - 0.0005); if (u.length) partAt.set(b, (e.top + Math.min(...u)) / 2); }
    if (partAt.size < 6) throw new Error(`${name}: the lips' parting found in ${partAt.size} places across the mouth`);
    const ys = [...partAt.values()].map((y) => (y - mouth) * 1000);
    if (process.env.DEBUG) console.log('DEBUG parting', [...partAt].sort((a, c) => a[0] - c[0]).map(([b, y]) => `${(b * PART_BIN * 1000).toFixed(0)}:${((y - mouth) * 1000).toFixed(1)}`).join(' '));
    console.log(name, 'lips part', Math.min(...ys).toFixed(1), 'to', Math.max(...ys).toFixed(1), 'mm above the MakeHuman\'s mouth line, in', partAt.size, 'places');
  }
  // (the mouth's corners: past the last place the lips are found parting, either side, the cheek isn't split. Split there
  // too, by the parting's height carried on, the open jaw tore p9's cheeks along a line from each corner)
  const cornerL = Math.min(...partAt.keys()) * PART_BIN - PART_BIN / 2, cornerR = Math.max(...partAt.keys()) * PART_BIN + PART_BIN / 2;
  const parting = (x) => {
    let b = Math.round(x / PART_BIN);
    if (partAt.has(b)) return partAt.get(b);
    for (let d = 1; d < 30; d++) { if (partAt.has(b - d * Math.sign(x || 1))) return partAt.get(b - d * Math.sign(x || 1)); }
    return mouth;
  };
  /** 1 for the lower lip's side of the parting, 0 the upper's: in the groove (where the lips lie on each other, 0.3 mm apart,
   * so height can't tell them) by which way the skin faces, up (the lower lip's top) or down (the upper's underside);
   * elsewhere by height. (The lips are joined at the groove's back, a seam of small triangles the whole width of the mouth:
   * split by the MakeHuman's line instead, which fell 1-4 mm low, on the lower lip's front, the jaw pulled the lower lip in
   * two and stretched a pink sheet over the mouth, and every key that parted the lips had to be eased to 6 mm.) */
  const GROOVE = 0.0025;
  const sideOf = (v) => {
    const t = tgt.opaque[v], q = lay(t.p), p = parting(q[0]);
    if (Math.abs(q[1] - p) < GROOVE && Math.abs(t.n[1]) > 0.02) return t.n[1] > 0 ? 1 : 0;
    return q[1] < p ? 1 : 0;
  };

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
    const byLips = q[0] > cornerL && q[0] < cornerR && Math.abs(q[1] - mouth) < LIPS_TALL;
    const best = [];
    for (const s of sSkin) {
      let d2 = (s.p[0] - q[0]) ** 2 + (s.p[1] - q[1]) ** 2 + ((s.p[2] - q[2]) * DEPTH) ** 2;
      if (byLips && !sideOf(v) !== (s.p[1] > mouth)) d2 += 1e3;
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

  // ---------- the mouth's inside ----------
  // Skin behind the lips (the lips' insides, and the mouth's lining back to the throat) is hidden from the front by the face
  // itself: reached from skin by the lips facing back, through skin that doesn't face forward (INSIDE_NZ) and has skin in
  // front of it. Each of it goes with the lower lip by how far round the inside it is to it against to the upper (Dijkstra
  // from the skin on either side): deep in (past FAR_IN from either lip) as the lower teeth do by that share, nearer the
  // lips smoothed between what the lips do and that (harmonic), so the corners, which move a quarter of the jaw's move,
  // don't tear from an inside that moves all of it; the groove's skin as its own lip's rim. Each lip's moves are smoothed
  // along that lip first: its rim copies its moves from a few MakeHuman vertices each, and neighbouring rim vertices took a
  // millimetre or more apart, so the lower lip's top came up in points as the jaw opened.
  const INSIDE_NZ = 0.4, FAR_IN = 0.012, LIP_SMOOTH = 40;
  // (deep in, a vertex clearly above or below the parting goes wholly with its row of teeth; within BACK_BLEND across it, shared)
  const BACK_BLEND = 0.0005, BACK_WALL = 0.02;
  // (skin deeper in than this round the inside from either lip is the mouth's lining, drawn as the mouth is: see below)
  const MOUTH_LINING = 0.0025;
  // (an open mouth's tongue lies lower than the lower teeth have gone, and in their shade: at the jaw's own move and lit as
  // the teeth it filled the opening like an orange plate)
  const TONGUE_DROP = 2.2, TONGUE_SHADE = 0.55;
  const I = arr(Uint32Array, h.meshes.opaque.index);
  const nb = new Map();
  for (let i = 0; i < I.length; i += 3) for (let a = 0; a < 3; a++) {
    const x = I[i + a], y = I[i + (a + 1) % 3];
    if (!nb.has(x)) nb.set(x, new Set()); if (!nb.has(y)) nb.set(y, new Set());
    nb.get(x).add(y); nb.get(y).add(x);
  }
  const inSkin = new Set(skinT);
  const boxOf = (v) => { const q = lay(tgt.opaque[v].p); return Math.abs(q[0]) < 0.045 && q[1] - mouth < 0.024 && mouth - q[1] < 0.045 && q[2] - mS[2] < 0.03; };
  /** The lips' front (laid z) across the mouth, in 4 mm bins. */
  const front = new Map();
  for (const v of skinT) { const q = lay(tgt.opaque[v].p); if (Math.abs(q[0]) < LIPS_WIDE + 0.01 && Math.abs(q[1] - mouth) < 0.006) { const b = Math.round(q[0] / 0.004); front.set(b, Math.max(front.get(b) ?? -1, q[2])); } }
  const lipFront = (q) => { let f; for (let d = 0; d < 20 && f === undefined; d++) f = front.get(Math.round(q[0] / 0.004) - d * Math.sign(q[0] || 1)); return f ?? mS[2]; };
  // (hidden: skin in front of it more than a millimetre, straight out of the face, +z)
  const near = [];
  for (let i = 0; i < I.length; i += 3) if (tgt.opaque[I[i]].part === PART_.skin && boxOf(I[i])) near.push(I[i], I[i + 1], I[i + 2]);
  const hid = new Map();
  const hidden = (v) => {
    if (hid.has(v)) return hid.get(v);
    const o = tgt.opaque[v].p;
    let hit = false;
    for (let i = 0; i < near.length && !hit; i += 3) {
      if (near[i] === v || near[i + 1] === v || near[i + 2] === v) continue;
      const a = tgt.opaque[near[i]].p, b = tgt.opaque[near[i + 1]].p, c = tgt.opaque[near[i + 2]].p;
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (o[0] - c[0]) + (c[0] - b[0]) * (o[1] - c[1])) / d, l2 = ((c[1] - a[1]) * (o[0] - c[0]) + (a[0] - c[0]) * (o[1] - c[1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= 0 && l2 >= 0 && l3 >= 0 && l1 * a[2] + l2 * b[2] + l3 * c[2] > o[2] + 0.001) hit = true;
    }
    hid.set(v, hit);
    return hit;
  };
  // (or facing out, where it is the mouth's back wall: well behind the lips. Left out, its skin kept the MakeHuman's nearest
  // skin's moves, or none, and was stretched into a pale sheet lit as skin across every open mouth, 15 Nov)
  const deepIn = (v) => { const q = lay(tgt.opaque[v].p); return lipFront(q) - q[2] > BACK_WALL; };
  const inside = new Set(skinT.filter((v) => { const q = lay(tgt.opaque[v].p); return Math.abs(q[0]) < LIPS_WIDE && Math.abs(q[1] - mouth) < 0.015 && tgt.opaque[v].n[2] < -0.3 && hidden(v); }));
  for (const queue = [...inside]; queue.length;) {
    const v = queue.pop();
    for (const u of nb.get(v) ?? []) if (!inside.has(u) && boxOf(u) && (tgt.opaque[u].part === PART_.tongue || (tgt.opaque[u].part === PART_.skin && (tgt.opaque[u].n[2] < INSIDE_NZ || deepIn(u)) && hidden(u)))) { inside.add(u); queue.push(u); }
  }
  const D = [...inside];
  if (D.length < 200) throw new Error(`${name}: ${D.length} vertices inside the mouth is not a mouth`);
  const seedL = [], seedU = [];
  for (const v of inside) {
    const q = lay(tgt.opaque[v].p);
    if (Math.abs(q[1] - parting(q[0])) < GROOVE && Math.abs(tgt.opaque[v].n[1]) > 0.3) (sideOf(v) ? seedL : seedU).push(v);
    for (const u of nb.get(v)) if (!inside.has(u) && inSkin.has(u)) (sideOf(u) ? seedL : seedU).push(u);
  }
  const len = (x, y) => { const p = tgt.opaque[x].p, q = tgt.opaque[y].p; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const round = (seeds) => {
    const d = new Map(seeds.map((v) => [v, 0])), todo = [...new Set(seeds)];
    while (todo.length) {
      let bi = 0; for (let i = 1; i < todo.length; i++) if (d.get(todo[i]) < d.get(todo[bi])) bi = i;
      const v = todo[bi]; todo[bi] = todo[todo.length - 1]; todo.pop();
      for (const u of nb.get(v)) { if (!inside.has(u)) continue; const nd = d.get(v) + len(v, u); if (nd < (d.get(u) ?? Infinity)) { if (!d.has(u)) todo.push(u); d.set(u, nd); } }
    }
    return d;
  };
  const dU = round(seedU), dL = round(seedL), inFrom = (v) => Math.min(dU.get(v) ?? Infinity, dL.get(v) ?? Infinity);
  const groove = new Set(D.filter((v) => { const q = lay(tgt.opaque[v].p); return inSkin.has(v) && Math.abs(q[1] - parting(q[0])) < GROOVE && Math.abs(tgt.opaque[v].n[1]) > 0.3; }));
  // each lip smoothed along itself
  const lipV = skinT.filter((v) => { const q = lay(tgt.opaque[v].p); return Math.abs(q[0]) < LIPS_WIDE && Math.abs(q[1] - mouth) < LIPS_TALL; });
  const sideV = new Map(lipV.map((v) => [v, inside.has(v) ? -1 : sideOf(v)]));
  const acc = new Float64Array(6);
  for (let k = 0; k < NK; k++) for (let it = 0; it < LIP_SMOOTH; it++) for (const v of lipV) {
    const sv = sideV.get(v); if (sv < 0) continue;
    let n = 0; acc.fill(0);
    for (const u of nb.get(v)) { if (sideV.get(u) !== sv) continue; const ou = (u * NK + k) * 6; for (let c = 0; c < 6; c++) acc[c] += out.opaque[ou + c]; n++; }
    if (!n) continue;
    const o = (v * NK + k) * 6; for (let c = 0; c < 6; c++) out.opaque[o + c] = 0.5 * out.opaque[o + c] + 0.5 * acc[c] / n;
  }
  // and the cheek past each corner smoothed across, both sides together: the MakeHuman's own mouth is wider on some faces, and
  // its slit, copied on past the MetaHuman's corner, tore p9's cheek from the corner out as the jaw opened
  const CHEEK_SMOOTH = 30, CHEEK_OUT = 0.018, CHEEK_TALL = 0.015;
  const cheekV = skinT.filter((v) => { const q = lay(tgt.opaque[v].p); return !inside.has(v) && Math.abs(q[1] - mouth) < CHEEK_TALL && ((q[0] < cornerL + 0.003 && q[0] > cornerL - CHEEK_OUT) || (q[0] > cornerR - 0.003 && q[0] < cornerR + CHEEK_OUT)); });
  for (let k = 0; k < NK; k++) for (let it = 0; it < CHEEK_SMOOTH; it++) for (const v of cheekV) {
    let n = 0; acc.fill(0);
    for (const u of nb.get(v)) { if (!inSkin.has(u) || inside.has(u)) continue; const ou = (u * NK + k) * 6; for (let c = 0; c < 6; c++) acc[c] += out.opaque[ou + c]; n++; }
    if (!n) continue;
    const o = (v * NK + k) * 6; for (let c = 0; c < 6; c++) out.opaque[o + c] = 0.5 * out.opaque[o + c] + 0.5 * acc[c] / n;
  }
  // the groove as its lip's rim (the nearest skin outside on its side)
  const outside = lipV.filter((u) => !inside.has(u));
  for (const v of groove) {
    const sv = sideOf(v), p = tgt.opaque[v].p; let best = -1, bd = Infinity;
    for (const u of outside) { if (sideV.get(u) !== sv) continue; const q = tgt.opaque[u].p, d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; best = u; } }
    if (best >= 0) for (let k = 0; k < NK; k++) { const o = (v * NK + k) * 6, ou = (best * NK + k) * 6; for (let c = 0; c < 6; c++) out.opaque[o + c] = out.opaque[ou + c]; }
  }
  // Near the lips (within FAR_IN round the inside) each vertex goes wholly with the nearer lip, smoothed only among its own
  // side, and the triangles between the two sides are cut (below): the inside opens where the lips' insides meet. Shared out
  // between the lips there instead, it was a sheet of skin across the open mouth, lit pale pink. Deep in, it goes with the
  // lower teeth by its share (the back of the mouth stretches, in the dark).
  const sTe = src.verts.filter((v) => !v.alpha && v.part === PART_.teeth && Math.hypot(...v.d[jaw].slice(0, 3)) > 0.002);
  const free = D.filter((v) => !groove.has(v) && inFrom(v) <= FAR_IN);
  /** Which lip a vertex goes with: 1 the lower, 0 the upper, -1 deep in (both), -2 not skin by the mouth. */
  const sideIn = new Map();
  // (by height against the lips' own parting, not by which lip is nearer round the surface: the lips are joined at the back, and
  // the shortest way from the lower lip ran round the join into the upper lip's inside, which the jaw then pulled down across
  // the open mouth as a pale sheet, 15 Nov)
  // (but on the rim itself, within NEAR_RIM round the inside of a lip, by that lip: there the way round can't have gone round
  // the back, and the parting's fitted height runs a little into either lip, so by height a few of the upper lip's rim went
  // with the jaw and notched its edge, open or breathing, 15 Nov)
  const NEAR_RIM = 0.003;
  const below = (v) => { const q = lay(tgt.opaque[v].p); return +(q[1] < parting(q[0])); };
  const byLip = (v) => { const u = dU.get(v) ?? Infinity, l = dL.get(v) ?? Infinity; return Math.min(u, l) <= NEAR_RIM ? +(l < u) : below(v); };
  for (const v of D) sideIn.set(v, groove.has(v) ? sideOf(v) : inFrom(v) <= FAR_IN ? byLip(v) : -1);
  const sideAt = (v) => sideIn.get(v) ?? (inSkin.has(v) ? sideOf(v) : -2);
  for (let k = 0; k < NK; k++) {
    const A = affine(sTe.map((v) => v.p), sTe.map((v) => v.d[k])), An = affine(sTe.map((v) => v.p), sTe.map((v) => v.d[k].slice(3)));
    for (const v of D) {
      if (groove.has(v)) continue;
      const q = lay(tgt.opaque[v].p), u = dU.get(v) ?? Infinity, l = dL.get(v) ?? Infinity;
      const w = sideIn.get(v) >= 0 ? sideIn.get(v) : u === Infinity && l === Infinity ? +(q[1] < parting(q[0])) : Math.min(1, Math.max(0, 0.5 + (parting(q[0]) - q[1]) / BACK_BLEND));
      put('opaque', v, k, [...applyAffine(A, q), ...applyAffine(An, q)].map((y) => y * w));
    }
    for (let it = 0; it < 400; it++) for (const v of free) {
      const o = (v * NK + k) * 6, sv = sideIn.get(v); let n = 0; acc.fill(0);
      for (const u of nb.get(v)) { const su = sideAt(u); if (su !== sv && su !== -1) continue; const ou = (u * NK + k) * 6; for (let c = 0; c < 6; c++) acc[c] += out.opaque[ou + c]; n++; }
      if (n) for (let c = 0; c < 6; c++) out.opaque[o + c] = acc[c] / n;
    }
  }
  // the triangles between the lips' two sides, inside: cut (folded to a point; the count and anything kept per triangle stay)
  // (and any triangle by the inside whose corners go with the jaw by shares further apart than OPEN_CUT: a lip's inside next to
  // the lining deeper in on the other side of the parting, which drew a long pale band from the lower lip up to the upper teeth)
  const OPEN_CUT = 0.6;
  const shareOf = (v) => { const sv = sideAt(v); if (sv >= 0) return sv; if (sv === -2) return null; const q = lay(tgt.opaque[v].p); return Math.min(1, Math.max(0, 0.5 + (parting(q[0]) - q[1]) / BACK_BLEND)); };
  const cutAt = [];
  for (let i = 0; i < I.length; i += 3) {
    let lo = false, up = false, ins = false, smin = 1, smax = 0;
    for (let a = 0; a < 3; a++) {
      const v = I[i + a], sv = sideAt(v); if (sv === 1) lo = true; else if (sv === 0) up = true; if (sideIn.has(v) && sideIn.get(v) >= 0) ins = true;
      const sh = shareOf(v); if (sh !== null) { smin = Math.min(smin, sh); smax = Math.max(smax, sh); }
    }
    if ((lo && up && ins) || ([0, 1, 2].some((a) => inside.has(I[i + a])) && smax - smin > OPEN_CUT)) cutAt.push(i);
  }
  const lining = D.filter((v) => !groove.has(v) && inFrom(v) > MOUTH_LINING);
  console.log(name, 'mouth: inside', D.length, 'skin vertices (', groove.size, 'in the groove,', free.length, 'by its lip,', D.length - groove.size - free.length, 'with the teeth;', lining.length, 'its lining);', cutAt.length, 'triangles cut where the lips\' insides meet');
  let tongueV = new Set();

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
    // (the MetaHuman's part tongue is a strip joining the lips' insides at the back, moved with the inside above)
    const t = tgt.opaque.map((x, v) => [x, v]).filter(([x, v]) => x.part === part && !inside.has(v));
    if (!s.length || !t.length) continue;
    // (the lower teeth: the ones the jaw moves; on the MetaHuman, the ones under its teeth's own gap)
    const moving = part === PART_.teeth ? s.filter((v) => Math.hypot(...v.d[jaw].slice(0, 3)) > 0.002) : s;
    // (how much of the jaw's move each vertex takes)
    let lower = t.map(([x, v]) => [x, v, 1]);
    // (where on the jaw a piece's move is taken from: its own place, or, for the MetaHuman's tongue and lower gums when the mouth
    // opens, no further back than the lower teeth's front, so the whole tongue drops as the lower teeth do. Turned about the
    // jaw's hinge its back hardly moved, and it filled an open mouth to the upper teeth like a red ball.)
    let frontZ = -Infinity;
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
      lower = list.filter((pc) => Math.abs(pc.y - yL) < Math.abs(pc.y - yU)).flatMap((pc) => pc.ids.map(([x, v]) => [x, v, 1, pc !== rows[0]]));
      frontZ = Math.max(...rows[0].ids.map(([x]) => lay(x.p)[2]));
      // (the tongue: of the pieces that go with the jaw, not a row, the one reaching furthest down the throat)
      const tg = list.filter((pc) => pc !== rows[0] && Math.abs(pc.y - yL) < Math.abs(pc.y - yU)).sort((a, c) => a.lo - c.lo)[0];
      if (tg) tongueV = new Set(tg.ids.map(([, v]) => v));
      console.log(name, 'teeth', t.length, 'vertices in', list.length, 'pieces (', list.map((pc) => pc.n).sort((a, c) => c - a).join(' '), '), the rows\' middles', ((yU - yL) * 1000).toFixed(1), 'mm apart;', lower.length, 'go with the jaw');
    }
    for (let k = 0; k < NK; k++) {
      const A = affine(moving.map((v) => v.p), moving.map((v) => v.d[k]));
      const An = affine(moving.map((v) => v.p), moving.map((v) => v.d[k].slice(3)));
      for (const [x, v, w, rest] of lower) { const q = lay(x.p), qm = rest ? [q[0], q[1], Math.max(q[2], frontZ)] : q, f = tongueV.has(v) ? TONGUE_DROP : 1; put('opaque', v, k, [...applyAffine(A, qm).map((y) => y * f), ...applyAffine(An, q)].map((y) => y * w)); }
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

  // ---------- a check: nothing torn ----------
  // (small skin triangles the jaw's whole key pulls TORN apart. Until 15 Nov the lips were split by the MakeHuman's line, which
  // fell on the lower lip, 46-131 such triangles ran the mouth's width, and every key that parted the lips was eased to 6 mm,
  // the jaw to 0.17 of itself: open mouths stayed shut. Now a few at the corners, where the MakeHuman's own skin stretches.)
  const TORN = 0.018, TORN_EDGE = 0.012, TORN_MOST = 24;
  const kd = (v, k) => { const o = (v * NK + k) * 6; return [out.opaque[o], out.opaque[o + 1], out.opaque[o + 2]]; };
  let torn = 0;
  const cutSet = new Set(cutAt);
  for (let i = 0; i < I.length; i += 3) {
    if (cutSet.has(i)) continue;
    const tri = [I[i], I[i + 1], I[i + 2]];
    if (!tri.every((v) => tgt.opaque[v].part === PART_.skin || inside.has(v))) continue;
    let edge = 0, pull = 0;
    for (let a = 0; a < 3; a++) {
      const p = tgt.opaque[tri[a]].p, q = tgt.opaque[tri[(a + 1) % 3]].p, dp = kd(tri[a], jaw), dq = kd(tri[(a + 1) % 3], jaw);
      edge = Math.max(edge, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); pull = Math.max(pull, Math.hypot(dp[0] - dq[0], dp[1] - dq[1], dp[2] - dq[2]));
    }
    if (edge < TORN_EDGE && pull > TORN) { torn++; if (process.env.DEBUG) console.log('DEBUG torn', tri.map((v) => { const q = lay(tgt.opaque[v].p); return `${inside.has(v) ? '*' : ''}${(q[0] * 1000).toFixed(0)},${((q[1] - mouth) * 1000).toFixed(1)},${((q[2] - mS[2]) * 1000).toFixed(1)} n${tgt.opaque[v].n.map((x) => x.toFixed(1)).join('/')} s${sideOf(v)} j${(kd(v, jaw)[1] * 1000).toFixed(0)}`; }).join(' | ')); }
  }
  if (torn > TORN_MOST) throw new Error(`${name}: the open jaw pulls ${torn} small triangles apart (the lips' parting is wrong)`);
  console.log(name, 'open jaw pulls', torn, 'small triangles apart');

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
  if (cutAt.length) {
    const I1 = I.slice();
    for (const i of cutAt) { I1[i + 1] = I1[i]; I1[i + 2] = I1[i]; }
    const b = Buffer.from(I1.buffer);
    h.meshes.opaque.index0 = h.meshes.opaque.index; h.meshes.opaque.indices0 = h.meshes.opaque.indices;
    h.meshes.opaque.index = [at, b.length];
    chunks.push(b); at += b.length;
  }
  {
    // The mouth's inside darkens with depth behind the lips (its own occlusion, as an open mouth's is): the lining is drawn as
    // the mouth is (part teeth), and the teeth, gums, tongue and lining take an occlusion by how far behind the lips' front
    // they are, DARK_FROM to DARK_FROM + DARK_OVER, down to DARK_MIN (kit.ts `mouthShaded` uses it in place of the atlas's,
    // which was baked shut). Lit as skin, the open mouth's back was a bright pink wall; the tongue a glass ball.
    const DARK_FROM = 0.009, DARK_OVER = 0.014, DARK_MIN = 0.02, LINING_SHADE = 0.6, LINING_OVER = 0.012;
    const PT = new Uint8Array(bin.buffer, h.meshes.opaque.part[0], h.meshes.opaque.vertices), AO = new Float32Array(bin.buffer, h.meshes.opaque.ao[0], h.meshes.opaque.vertices);
    const was = [], lined = new Set(lining);
    for (const v of lining) { was.push([v, PT[v], AO[v]]); PT[v] = PART_.teeth; }
    // (the tongue is a piece of the teeth's mesh: labelled a tongue, it is drawn as one, matte, kit.ts)
    for (const v of tongueV) { was.push([v, PT[v], AO[v]]); PT[v] = PART_.tongue; }
    let n = 0;
    tgt.opaque.forEach((t, v) => {
      if (PT[v] !== PART_.teeth && PT[v] !== PART_.tongue) return;
      const q = lay(t.p);
      let a = Math.max(DARK_MIN, Math.min(1, 1 - (lipFront(q) - q[2] - DARK_FROM) / DARK_OVER));
      // (the lining by how far round inside it is too: an open jaw stretches the lower lip's inside over the lower teeth, near
      // the front in depth at rest, and it was a pale sheet in the mouth)
      if (lined.has(v)) a = Math.min(a, Math.max(DARK_MIN, LINING_SHADE * (1 - (inFrom(v) - MOUTH_LINING) / LINING_OVER)));
      if (!lined.has(v) && !tongueV.has(v)) was.push([v, PT[v], AO[v]]);
      AO[v] = Math.min(AO[v], 0.99, a * (tongueV.has(v) ? TONGUE_SHADE : 1)); n++;
    });
    h.mouthWas = was;
    console.log(name, 'mouth shaded by depth on', n, 'vertices');
  }
  writeFileSync(dir + 'body.bin', Buffer.concat(chunks));
  writeFileSync(dir + 'body.json', JSON.stringify(h));
}
