// Palms round the golden club (data/arenas.json `grove`): our own, generated here, no model. A date palm's shape, the
// feather palm parks plant in rows: a straight or leaning trunk 0.5-0.7 m thick, ringed with the old leaf bases, and a
// crown of 24-32 feather fronds 3-4.5 m long, the upper ones standing up, the lower ones bowed down by their weight. A
// frond is its rachis and two rows of leaflets set in a V (the keel up), drawn as two strips cut out by a leaflet texture
// drawn on a canvas below; the cut-out (`alphaTest`) is in the shadow pass too, so the sun throws the leaflets' shadows
// across the court. Every palm is merged into two meshes (trunks, fronds): two draws, about 2,500 triangles a palm.
import * as THREE from 'three/webgpu';
import { FoliageMaterial } from './foliage.ts';

export interface PalmSpot {
  x: number; z: number;
  /** Trunk height to the crown (m). */
  height: number;
  /** Lean from upright (rad) and its direction (rad about y). */
  lean: number; leanDir: number;
  seed: number;
}

/** A seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEX_W = 256, TEX_H = 1024;

/**
 * Half a frond's leaflets: the rachis along u = 0, leaflets reaching to u = 1, the frond's base at v = 0. Leaflets leave the
 * rachis forward at 30-45 degrees, long and narrow, longest a little past the middle of the frond, in pairs that are not
 * quite even; the lowest third has short spiny ones. Colour in the texture's RGB (a little light and dark between
 * leaflets, the tips yellower), the cut-out in its alpha.
 */
function frondTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, TEX_W, TEX_H);
  const r = rng(77);
  const N = 70;
  for (let i = 0; i < N; i++) {
    const s = (i + 0.3 + r() * 0.4) / N; // along the frond, 0 base .. 1 tip
    const reach = Math.sin(Math.PI * Math.pow(s, 0.75)) * (s < 0.2 ? 0.55 : 1); // of the strip's width
    if (reach < 0.06) continue;
    const y0 = s * TEX_H;
    const ang = (0.55 + r() * 0.25) ; // forward lean of the leaflet (rad from the rachis' normal)
    const len = reach * TEX_W;
    const x1 = len, y1 = y0 + Math.tan(ang) * len * 0.9;
    const w = (s < 0.2 ? 2.2 : 5.5) * (0.8 + r() * 0.4) * (TEX_H / 1024);
    const shade = 0.82 + r() * 0.3;
    const gr = g.createLinearGradient(0, y0, x1, y1);
    const base = [70, 98, 50], tip = [138, 134, 72]; // (date palms' leaflets are a grey, waxy green, yellower out to the tips)
    const col = (k: number, t: number[]): string => `rgb(${Math.round(t[0]! * k)},${Math.round(t[1]! * k)},${Math.round(t[2]! * k)})`;
    gr.addColorStop(0, col(shade, base));
    gr.addColorStop(1, col(shade, tip));
    g.fillStyle = gr;
    // a lance: widest a third of the way out, pointed at the tip
    g.beginPath();
    g.moveTo(0, y0 - w * 0.5);
    g.quadraticCurveTo(x1 * 0.35, y0 + (y1 - y0) * 0.35 - w, x1, y1);
    g.quadraticCurveTo(x1 * 0.35, y0 + (y1 - y0) * 0.35 + w, 0, y0 + w * 0.5);
    g.closePath();
    g.fill();
  }
  // the rachis
  g.fillStyle = 'rgb(118,112,70)';
  g.fillRect(0, 0, 7, TEX_H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // (the canvas's top row, the frond's base, at v = 0 where the strips start)
  t.anisotropy = 8;
  return t;
}

/**
 * The trunk's bark: a date palm's old leaf bases, cut off flat and weathered grey (photographs of Canary Island date
 * palms in parks: grey-brown, the diamonds low relief and only a little paler than the trunk between them, never the
 * orange of a fresh cut, which is only under the crown: the trunk's vertex colours). Each scar is a wide diamond with a
 * shadowed upper lip (the cut stands out from the trunk below it), a paler lower lip, and grain in it; fine speckle
 * (lichen, dust) over everything. The same picture is the relief (`bumpMap`): the cuts stand out, the lips sink.
 */
function barkTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(84,78,70)';
  g.fillRect(0, 0, S, S);
  const r = rng(5);
  const rows = 8, cols = 6;
  const rgb = (v: number, w: number, k: number): string => `rgb(${Math.round(v * k)},${Math.round(w * k)},${Math.round(v * 0.86 * k)})`;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const cx = ((i + (j % 2) * 0.5 + (r() - 0.5) * 0.08) / cols) * S, cy = ((j + (r() - 0.5) * 0.1) / rows) * S;
    const w = (S / cols) * (0.5 + r() * 0.08), h = (S / rows) * (0.55 + r() * 0.1);
    const k = 0.9 + r() * 0.22;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const x = cx + dx, y = cy + dy;
      if (x < -w * 2 || x > S + w * 2 || y < -h * 2 || y > S + h * 2) continue;
      const diamond = (sx: number, sy: number): void => {
        g.beginPath();
        g.moveTo(x - w * sx, y);
        g.lineTo(x, y - h * 0.42 * sy);
        g.lineTo(x + w * sx, y);
        g.lineTo(x, y + h * 0.58 * sy);
        g.closePath();
      };
      // the shadow under the cut's upper edge, then the scar, then its pale lower lip
      g.fillStyle = rgb(52, 48, k * 0.9); diamond(1.04, 1.12); g.fill();
      g.fillStyle = rgb(116, 108, k); diamond(0.96, 0.98); g.fill();
      g.save(); diamond(0.96, 0.98); g.clip();
      g.fillStyle = rgb(124, 116, k * (0.94 + r() * 0.08));
      g.beginPath(); g.ellipse(x, y + h * 0.42, w * 0.7, h * 0.2, 0, 0, Math.PI * 2); g.fill();
      // the cut's fibres, running across
      g.strokeStyle = 'rgba(60,54,46,0.35)';
      g.lineWidth = 1;
      for (let q = 0; q < 7; q++) {
        const yy = y - h * 0.3 + q * h * 0.12 + (r() - 0.5) * 3;
        g.beginPath(); g.moveTo(x - w, yy); g.lineTo(x + w, yy + (r() - 0.5) * 4); g.stroke();
      }
      g.restore();
    }
  }
  // speckle: dust, lichen (a little green-grey), dark pits
  for (let q = 0; q < 9000; q++) {
    const t = r();
    g.fillStyle = t < 0.45 ? `rgba(150,146,132,${0.15 + r() * 0.2})` : t < 0.6 ? `rgba(120,128,104,${0.2 + r() * 0.2})` : `rgba(40,36,30,${0.15 + r() * 0.25})`;
    const z = 1 + r() * 2.5;
    g.fillRect(r() * S, r() * S, z, z);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Pushes a tube's rings: centre line `pts`, radii `rad`, around `seg`; UVs u around, v in metres up (for the bark). */
function tube(pts: THREE.Vector3[], rad: number[], seg: number, P: number[], N: number[], U: number[], I: number[]): void {
  const base = P.length / 3;
  let along = 0;
  const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) along += pts[k]!.distanceTo(pts[k - 1]!);
    t.subVectors(pts[Math.min(k + 1, pts.length - 1)]!, pts[Math.max(k - 1, 0)]!).normalize();
    a.set(1, 0, 0).addScaledVector(t, -t.x).normalize();
    b.crossVectors(t, a);
    for (let s = 0; s <= seg; s++) {
      const ang = (s / seg) * Math.PI * 2;
      const nx = a.x * Math.cos(ang) + b.x * Math.sin(ang), ny = a.y * Math.cos(ang) + b.y * Math.sin(ang), nz = a.z * Math.cos(ang) + b.z * Math.sin(ang);
      P.push(pts[k]!.x + nx * rad[k]!, pts[k]!.y + ny * rad[k]!, pts[k]!.z + nz * rad[k]!);
      N.push(nx, ny, nz);
      U.push(s / seg * 2, along / 1.1);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < seg; s++) {
    const i0 = base + k * (seg + 1) + s, i1 = i0 + seg + 1;
    I.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1);
  }
}

export interface Palms { trunks: THREE.Mesh; fronds: THREE.Mesh }

/**
 * The palms, merged. `env`: the scenery's envMap (the sky; the court's probe sees nothing of them that matters).
 */
export function buildPalms(spots: PalmSpot[], env: THREE.Texture | null): Palms {
  const TP: number[] = [], TN: number[] = [], TU: number[] = [], TC: number[] = [], TI: number[] = [];
  const FP: number[] = [], FN: number[] = [], FU: number[] = [], FC: number[] = [], FI: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const sp of spots) {
    const r = rng(sp.seed);
    // The trunk: a lean that grows up the trunk (palms straighten towards the light), thicker at the foot and under the crown.
    const lean = new THREE.Vector3(Math.cos(sp.leanDir), 0, Math.sin(sp.leanDir));
    const pts: THREE.Vector3[] = [], rad: number[] = [];
    const R = 0.26 + r() * 0.08, rings = 22;
    for (let k = 0; k <= rings; k++) {
      const s = k / rings, y = s * sp.height;
      const off = Math.sin(sp.lean) * sp.height * (s * s * 0.6 + s * 0.4);
      pts.push(new THREE.Vector3(sp.x + lean.x * off, y, sp.z + lean.z * off));
      const foot = 1 + 0.35 * Math.exp(-s * 18), head = 1 + 0.45 * Math.exp(-(1 - s) * 14);
      rad.push(R * foot * head * (1 + 0.03 * Math.sin(s * sp.height * 11)));
    }
    tube(pts, rad, 10, TP, TN, TU, TI);
    // The trunk's colour up its height, on the bark's grey: earth splashed up the foot, the leaf bases cut most recently
    // (the top metre under the crown) still the warm brown of fresh fibre, a palm a little lighter or browner than the next.
    // (its own stream: the crown's draws stay as they were)
    const rc = rng(sp.seed ^ 0x5bd1e995), k0 = 0.9 + rc() * 0.2, warm = rc() * 0.08;
    for (let k = 0; k <= rings; k++) {
      const s = k / rings, y = s * sp.height;
      const foot = 1 - 0.24 * Math.exp(-y / 0.35);
      const fresh = THREE.MathUtils.smoothstep(y, sp.height - 1.4, sp.height - 0.2);
      const cr = k0 * foot * (1 + warm + fresh * 0.5), cg = k0 * foot * (1 + fresh * 0.14), cb = k0 * foot * (1 - warm - fresh * 0.2);
      for (let q = 0; q <= 10; q++) TC.push(cr, cg, cb);
    }
    // The crown: fronds from the top in a spiral (the phyllotaxis' 137.5 degrees), the higher ones younger and upright.
    const top = pts[rings]!;
    // (a crown carries 30-40 green fronds, and under them a skirt of dead ones hanging against the trunk until they are
    // cut or fall: `dead` more, age past 1, coloured straw to brown and hung almost straight down)
    const n = 30 + Math.floor(r() * 11), dead = 5 + Math.floor(r() * 6);
    for (let f = 0; f < n + dead; f++) {
      const age = f < n ? f / (n - 1) : 1 + (f - n + 1) / dead; // 0 the youngest (upright) .. 1 the oldest green .. 2 dead
      const az = f * 2.39996 + r() * 0.3;
      const elev = age <= 1 ? THREE.MathUtils.lerp(1.15, -0.25, age) + (r() - 0.5) * 0.25 : -1.05 - r() * 0.35;
      const len = (3.0 + r() * 1.5) * (age > 1 ? 0.6 : age > 0.85 ? 0.8 : 1);
      const droop = age <= 1 ? THREE.MathUtils.lerp(0.35, 1.5, age) : 0.15; // how much the frond bows over its length (rad)
      const W = (0.75 + r() * 0.2) * (age > 1 ? 0.55 : 1); // leaflet reach either side (m; a dead frond's fold in)
      const keel = 0.45; // the V: leaflets rise this much (rad) from the frond's flat
      const segs = 12;
      const dir = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), p = top.clone().addScaledVector(up, 0.2);
      const hz = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      // The frond's colour over the leaflet texture: green while young, then yellower towards straw-orange as it ages (the
      // reel's backlit crowns glow orange in their lower half), a dead one dry tan to brown.
      const tint = 0.85 + r() * 0.3;
      const yel = THREE.MathUtils.smoothstep(age, 0.3, 1) * (0.6 + r() * 0.4);
      const tr = age > 1 ? (2.1 + r() * 0.5) * 0.8 : tint * (1 + yel * 1.15), tg = age > 1 ? (1.25 + r() * 0.2) * 0.8 : tint * (1 + yel * 0.2), tb = age > 1 ? (0.85 + r() * 0.2) * 0.8 : tint * (1 - yel * 0.45);
      const rowsBase = FP.length / 3;
      for (let k = 0; k <= segs; k++) {
        const s = k / segs;
        const e = elev - droop * s * s;
        dir.copy(hz).multiplyScalar(Math.cos(e)).addScaledVector(up, Math.sin(e)).normalize();
        side.crossVectors(dir, up).normalize();
        nrm.crossVectors(side, dir).normalize();
        if (k > 0) p.addScaledVector(dir, len / segs);
        // rachis, then the two leaflet rows' outer edges, up by the keel
        const wl = W;
        for (const sgn of [-1, 1]) {
          const ex = side.clone().multiplyScalar(sgn * Math.cos(keel) * wl).addScaledVector(nrm, Math.sin(keel) * wl * 0.6);
          // inner (rachis) vertex, outer vertex
          FP.push(p.x, p.y, p.z, p.x + ex.x, p.y + ex.y, p.z + ex.z);
          const n2 = nrm.clone().addScaledVector(side, -sgn * 0.35).normalize();
          FN.push(n2.x, n2.y, n2.z, n2.x, n2.y, n2.z);
          FU.push(0, s, 1, s);
          FC.push(tr, tg, tb, tr, tg, tb);
        }
      }
      for (let k = 0; k < segs; k++) for (let h = 0; h < 2; h++) {
        const a0 = rowsBase + k * 4 + h * 2, b0 = a0 + 4;
        // (the rows reach out on opposite sides: wound opposite ways, so both face up, as their normals do)
        if (h === 0) FI.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        else FI.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(TP, 3));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(TN, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(TU, 2));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(TC, 3));
  tg.setIndex(TI);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(FP, 3));
  fg.setAttribute('normal', new THREE.Float32BufferAttribute(FN, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(FU, 2));
  fg.setAttribute('color', new THREE.Float32BufferAttribute(FC, 3));
  fg.setIndex(FI);
  // (the bark's own picture as its relief: the leaf bases stand out, the cracks between sink)
  const bark = barkTexture();
  const trunks = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 4, roughness: 0.95, vertexColors: true, envMap: env }));
  const fronds = new THREE.Mesh(fg, new FoliageMaterial({
    map: frondTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, envMap: env,
  }));
  for (const m of [trunks, fronds]) { m.castShadow = true; m.receiveShadow = true; m.name = 'palms'; }
  return { trunks, fronds };
}
