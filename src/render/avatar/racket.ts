// The padel racket as drawn (render only; the sim's racket is data/rackets.json). Racket frame: the origin is the
// face centre, +y runs to the tip, +z is the face normal (the strings' side), x across the face.
//
// Built to the FIP limits and a typical round-head racket (FIP Rules of Padel, Annex: 45.5 cm long at most, 26 cm wide,
// 38 mm thick): the tip 14.5 cm above the face centre and the butt 31 cm below it (as rackets.json has them), a solid
// head 26 x 28 cm with the frame's tube as its rim, about 60 holes of 13 mm through the face in a hex pattern clear of
// the rim, the open throat (the "heart") where two arms join the handle, a 12.5 cm grip in white overgrip wound in a
// spiral, and a flared butt cap. The cosmetics are generic (carbon weave, one accent stripe): no real brand.
import * as THREE from 'three/webgpu';

/** Distances along the racket (m, from the face centre). */
export const RACKET_TIP = 0.145;
export const RACKET_BUTT = -0.31;
/** Where the handle (the round grip) starts and the butt cap begins. */
const HANDLE_TOP = -0.168;
const CAP_TOP = -0.295;
/** Handle radius under the overgrip at the top and at the butt (an 11 cm grip, slightly thicker towards the cap). */
export const HANDLE_R = 0.0172;
const HANDLE_R_BUTT = 0.0178;
/** Total thickness (FIP: 38 mm at most): extruded depth plus the rounded edge each side. */
const DEPTH = 0.034;
const BEVEL_T = 0.002;
const BEVEL_S = 0.0016;
/** The head: an ellipse (semi-axes, centre), the outline drawn BEVEL_S inside it (the bevel adds it back). */
const HEAD_A = 0.13 - BEVEL_S;
const HEAD_B = 0.14 - BEVEL_S;
const HEAD_C = RACKET_TIP - 0.14;
/** The frame's tube seen from the face (m). */
const RIM = 0.019;
/** Butt to tip: the face texture's length. */
const SPAN = RACKET_TIP - RACKET_BUTT;

function headPoint(phi: number, out: THREE.Vector2): THREE.Vector2 {
  return out.set(HEAD_A * Math.sin(phi), HEAD_C + HEAD_B * Math.cos(phi));
}

/** The silhouette: the head's ellipse, the two arms of the throat and the neck that runs into the handle. */
function outline(): THREE.Shape {
  const s = new THREE.Shape();
  const p = new THREE.Vector2();
  // Where the arms leave the head (angle from the tip).
  const arm = (140 * Math.PI) / 180;
  const n = 40;
  const neckW = 0.0185;
  const neckY = HANDLE_TOP - 0.006;
  headPoint(0, p);
  s.moveTo(p.x, p.y);
  for (let k = 1; k <= n; k++) {
    headPoint((arm * k) / n, p);
    s.lineTo(p.x, p.y);
  }
  // Right arm: a concave sweep down to the neck.
  headPoint(arm, p);
  s.quadraticCurveTo(p.x * 0.42, HANDLE_TOP + 0.03, neckW, neckY + 0.012);
  s.lineTo(neckW, neckY);
  s.lineTo(-neckW, neckY);
  s.lineTo(-neckW, neckY + 0.012);
  headPoint(-arm, p);
  s.quadraticCurveTo(p.x * 0.42, HANDLE_TOP + 0.03, p.x, p.y);
  for (let k = n - 1; k >= 0; k--) {
    headPoint((-arm * k) / n, p);
    s.lineTo(p.x, p.y);
  }
  return s;
}

/** The heart: a rounded triangle between the bottom of the face and the arms. */
function heart(): THREE.Path {
  const h = new THREE.Path();
  const top = -0.088, w = 0.04, tip = HANDLE_TOP + 0.016;
  h.moveTo(w, top);
  h.quadraticCurveTo(w * 0.62, (top + tip) * 0.5 - 0.006, 0.006, tip + 0.004);
  h.quadraticCurveTo(0, tip - 0.001, -0.006, tip + 0.004);
  h.quadraticCurveTo(-w * 0.62, (top + tip) * 0.5 - 0.006, -w, top);
  // The top edge follows the head's curve down in the middle.
  h.quadraticCurveTo(0, top - 0.014, w, top);
  return h;
}

/** Hole centres: a hex grid inside the face, clear of the rim and of the heart. */
export function racketHoles(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const sp = 0.0262;
  const ea = 0.1, eb = 0.104, ec = HEAD_C + 0.012;
  for (let row = -6; row <= 6; row++) {
    const y = ec + row * sp * 0.866;
    const off = (row & 1) === 0 ? 0 : sp * 0.5;
    for (let col = -6; col <= 6; col++) {
      const x = col * sp + off;
      const e = (x / ea) ** 2 + ((y - ec) / eb) ** 2;
      if (e <= 1 && y > -0.072) out.push([x, y]);
    }
  }
  return out;
}
const HOLE_R = 0.0066;

let faceTex: THREE.DataTexture | null = null;
let gripTex: THREE.DataTexture | null = null;

/**
 * The face's cosmetic (both sides): black carbon twill, the frame's tube a little glossier and darker round the
 * rim, one accent stripe across the head. The head's UVs are its x, y mapped onto this (parts()).
 */
function faceTexture(): THREE.DataTexture {
  if (faceTex) return faceTex;
  const W = 256, H = 448;
  const d = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W - 0.5) * 0.26;
      const y = RACKET_BUTT + ((j + 0.5) / H) * SPAN;
      // Twill: 2-over-2 diagonal weave, cells of 4 texels.
      const tw = ((Math.floor(i / 4) + Math.floor(j / 4)) & 3) < 2 ? 1 : 0;
      let r = 24 + tw * 9, g = 26 + tw * 9, b = 30 + tw * 10;
      const e = Math.sqrt((x / 0.13) ** 2 + ((y - HEAD_C) / 0.14) ** 2);
      // The accent stripe: a band across the upper head, broken where the rim is.
      const band = y > 0.052 && y < 0.07 && e < 1 - RIM / 0.13;
      const band2 = y > 0.074 && y < 0.079 && e < 1 - RIM / 0.13;
      if (band || band2) { r = 214; g = 182; b = 38; }
      // The rim: the frame's tube, glossy black.
      if (e > 1 - RIM / 0.135) { r = 14; g = 15; b = 17; }
      const k = (j * W + i) * 4;
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  faceTex = t;
  return t;
}

/** Overgrip: white tape wound in a spiral, each turn overlapping the last (a thin shadowed groove at the overlap). */
function gripTexture(): THREE.DataTexture {
  if (gripTex) return gripTex;
  const W = 64, H = 128;
  const d = new Uint8Array(W * H * 4);
  const turns = 9;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, v = (j + 0.5) / H;
      const f = (u + v * turns) % 1;
      // Groove at the overlap, then the tape's edge a little brighter where it lifts.
      const c = f < 0.06 ? 168 : f < 0.12 ? 246 : 232 - 10 * Math.sin(f * Math.PI);
      const k = (j * W + i) * 4;
      d[k] = c; d[k + 1] = c; d[k + 2] = c - 4; d[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  gripTex = t;
  return t;
}

let shared: { head: THREE.BufferGeometry; handle: THREE.BufferGeometry; cap: THREE.BufferGeometry; mats: THREE.Material[] } | null = null;

function parts() {
  if (shared) return shared;
  const shape = outline();
  shape.holes.push(heart());
  for (const [x, y] of racketHoles()) {
    const h = new THREE.Path();
    h.absarc(x, y, HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const head = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL_S, bevelSegments: 1, curveSegments: 5,
  });
  head.translate(0, 0, -DEPTH / 2);
  head.computeVertexNormals();
  // UVs from x, y over the texture's span (x -0.13..0.13, y butt to tip), set here rather
  // than through the texture's repeat and offset.
  {
    const pa = head.getAttribute('position'), uv = head.getAttribute('uv');
    for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) + 0.13) / 0.26, (pa.getY(i) - RACKET_BUTT) / SPAN);
    uv.needsUpdate = true;
  }
  const handle = new THREE.CylinderGeometry(HANDLE_R, HANDLE_R_BUTT, HANDLE_TOP - CAP_TOP, 18, 1, true);
  handle.translate(0, (HANDLE_TOP + CAP_TOP) / 2, 0);
  // Butt cap: flares out, then rounds off at the end.
  const pts: THREE.Vector2[] = [];
  const capH = CAP_TOP - RACKET_BUTT;
  for (const [r, y] of [[HANDLE_R_BUTT, 0], [0.0195, -0.25], [0.0212, -0.55], [0.0212, -0.8], [0.0185, -0.95], [0.012, -1], [0, -1]] as const) {
    pts.push(new THREE.Vector2(r, CAP_TOP + y * capH));
  }
  const cap = new THREE.LatheGeometry(pts, 18);
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.42, metalness: 0.05 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.3, metalness: 0.1 });
  const gripMat = new THREE.MeshStandardMaterial({ map: gripTexture(), roughness: 0.85 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.5 });
  shared = { head, handle, cap, mats: [faceMat, edgeMat, gripMat, capMat] };
  return shared;
}

/** A new racket (geometry and materials are shared by every racket). */
export function makeRacketModel(): THREE.Group {
  const p = parts();
  const g = new THREE.Group();
  g.name = 'racket';
  const head = new THREE.Mesh(p.head, [p.mats[0]!, p.mats[1]!]);
  const handle = new THREE.Mesh(p.handle, p.mats[2]!);
  const cap = new THREE.Mesh(p.cap, p.mats[3]!);
  for (const m of [head, handle, cap]) { m.castShadow = true; g.add(m); }
  return g;
}

let cordMat: THREE.Material | null = null;

/**
 * The wrist cord (FIP: rackets carry one, and players wear it): a loop round the wrist, `wristR` out from its axis,
 * and the cord from it to the butt cap. `wrist` and `forearm` (towards the elbow) are in the racket's frame.
 */
export function makeWristCord(wrist: THREE.Vector3, forearm: THREE.Vector3, wristR: number): THREE.Mesh {
  cordMat ??= new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.8 });
  const up = forearm.clone().normalize();
  // The loop sits just up the forearm from the joint (it rides on the hand: further up, the bent wrist cut it).
  const c = wrist.clone().addScaledVector(up, 0.012);
  const a = new THREE.Vector3(0, -1, 0).addScaledVector(up, up.y).normalize();
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
  const b = new THREE.Vector3().crossVectors(up, a).normalize();
  const r = wristR + 0.004;
  const pts: THREE.Vector3[] = [];
  const butt = new THREE.Vector3(0, RACKET_BUTT + 0.004, 0);
  // From the butt cap down and round to the loop's nearest side, then once round the wrist.
  const start = c.clone().addScaledVector(a, r);
  pts.push(butt, butt.clone().lerp(start, 0.5).add(new THREE.Vector3(0, -0.012, 0)), start);
  for (let k = 1; k <= 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    pts.push(c.clone().addScaledVector(a, r * Math.cos(t)).addScaledVector(b, r * Math.sin(t)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 48, 0.0028, 5, false);
  const m = new THREE.Mesh(geo, cordMat);
  m.name = 'cord';
  m.castShadow = true;
  return m;
}
