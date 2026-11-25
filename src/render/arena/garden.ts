// The golden club's garden (round 5): what the reel's club has round its court beyond the palms. A low wall of rough
// stone laid in lime mortar, capped with flat stones, inside the timber fence (the shrubs' bed along its foot is the
// wood's own cards, grove.ts `shrubs`), and past the wood a few houses of a village: whitewashed walls, terracotta roofs,
// dark windows, seen through the trees and the haze. One mesh each (wall, houses), lit by the scenery's envMap.
import * as THREE from 'three/webgpu';
import { BoxBatch } from './stadium.ts';

export interface GardenDef {
  /** The wall: `height` (m), `thick` (m), `inset` (m inside the fence line). */
  wall?: { height: number; thick: number; inset: number };
  /** `count` houses on a ring from `ring[0]` to `ring[1]` m from the court's centre, never inside the near end's wedge
   * (the broadcast camera looks over it, so nothing stands in its way). */
  houses?: { count: number; ring: number[] };
  /** `count` flowers in clumps in the bed along the wall's foot, up to `depth` m out from it (the reel's bed has them). */
  flowers?: { count: number; depth: number };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/**
 * Rubble stone in lime mortar: rounded stones of a warm limestone, a little lighter or redder one to the next, in rough
 * courses, the mortar between them sunk and pale. The texture is 2 m square (UVs in metres / 2).
 */
function stoneTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // the mortar: pale lime, in shadow between the stones
  g.fillStyle = 'rgb(112,104,92)';
  g.fillRect(0, 0, S, S);
  const r = rng(911);
  const px = S / 2; // pixels a metre
  let y = 0;
  while (y < S) {
    const h = (0.07 + r() * 0.06) * px;
    let x = -r() * 0.15 * px;
    while (x < S) {
      const w = (0.1 + r() * 0.2) * px;
      // a muted limestone, one a little greyer, warmer or darker than the next
      const k = 0.8 + r() * 0.28, warm = r() * 14;
      const cr = Math.round((150 + warm) * k), cg = Math.round((140 + warm * 0.5) * k), cb = Math.round((122 - warm * 0.3) * k);
      // an irregular four- to six-sided stone, its corners pulled in, a gap of mortar round it (and wrapped round the tile)
      const n = 4 + Math.floor(r() * 3), jitter: number[] = [];
      for (let q = 0; q < n * 2; q++) jitter.push((r() - 0.5) * 0.18);
      for (const ox of [0, -S, S]) for (const oy of [0, -S]) {
        const gx = x + ox + w / 2, gy = y + oy + h / 2;
        g.beginPath();
        for (let q = 0; q < n; q++) {
          const a = (q / n) * Math.PI * 2 + Math.PI / n;
          const px2 = gx + Math.cos(a) * (w / 2 - 2) * (Math.SQRT2 * 0.78 + jitter[q * 2]!);
          const py2 = gy + Math.sin(a) * (h / 2 - 2) * (Math.SQRT2 * 0.78 + jitter[q * 2 + 1]!);
          if (q === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
        }
        g.closePath();
        const gr = g.createLinearGradient(gx, gy - h / 2, gx, gy + h / 2);
        gr.addColorStop(0, `rgb(${Math.min(255, cr + 10)},${Math.min(255, cg + 10)},${Math.min(255, cb + 8)})`);
        gr.addColorStop(1, `rgb(${cr - 14},${cg - 14},${cb - 12})`);
        g.fillStyle = gr;
        g.fill();
      }
      x += w;
    }
    y += h;
  }
  // grit, pits and lichen
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < 0.06 ? 'rgba(118,122,84,0.3)' : v < 0.55 ? 'rgba(70,62,52,0.22)' : 'rgba(220,210,190,0.16)';
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A box with UVs in metres / 2 along its faces (so the stone is one size everywhere). */
function stoneBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const b = new THREE.BoxGeometry(sx, sy, sz);
  b.translate(cx, cy, cz);
  const p = b.attributes.position!, n = b.attributes.normal!, uv = b.attributes.uv!;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u / 2, v / 2);
  }
  return b;
}

/** The wall inside the fence, the houses past the wood; `fx`, `fz` the fence's half sizes. */
export function buildGarden(root: THREE.Group, def: GardenDef, fx: number, fz: number, env: THREE.Texture | null): void {
  if (def.wall) {
    const w = def.wall, x = fx - w.inset, z = fz - w.inset, cap = 0.07;
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) {
      parts.push(stoneBox(s * x, w.height / 2, 0, w.thick, w.height, 2 * z + w.thick));
      parts.push(stoneBox(0, w.height / 2, s * z, 2 * x - w.thick, w.height, w.thick));
      // the coping: flat stones a little wider than the wall
      parts.push(stoneBox(s * x, w.height + cap / 2, 0, w.thick + 0.08, cap, 2 * z + w.thick + 0.08));
      parts.push(stoneBox(0, w.height + cap / 2, s * z, 2 * x - w.thick - 0.08, cap, w.thick + 0.08));
    }
    const geo = mergeAll(parts);
    const mat = new THREE.MeshStandardMaterial({ map: stoneTexture(), bumpMap: null, roughness: 0.92, envMap: env });
    if (mat.map) { mat.bumpMap = mat.map; mat.bumpScale = 3; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'garden-wall';
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (def.flowers && def.wall) {
    const f = def.flowers, w = def.wall, r = rng(6061);
    // the wall's inner face
    const ix = fx - w.inset - w.thick / 2, iz = fz - w.inset - w.thick / 2;
    const mesh = new THREE.InstancedMesh(flowerGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, envMap: env }), f.count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    let i = 0, cx = 0, cz = 0, kind = 0, left = 0;
    while (i < f.count) {
      if (left <= 0) {
        // a new clump somewhere along the bed: one colour, 8-20 flowers
        const lx = 2 * ix, lz = 2 * iz, u = r() * 2 * (lx + lz), d = 0.12 + r() * f.depth;
        cx = u < lx ? u - ix : u < lx + lz ? ix - d : u < 2 * lx + lz ? ix - (u - lx - lz) : -ix + d;
        cz = u < lx ? iz - d : u < lx + lz ? u - lx - iz : u < 2 * lx + lz ? -iz + d : iz - (u - 2 * lx - lz);
        kind = Math.floor(r() * FLOWER_COLOURS.length);
        left = 8 + Math.floor(r() * 13);
      }
      const x = cx + (r() - 0.5) * 0.5, z = cz + (r() - 0.5) * 0.5;
      // (kept between the wall and the bed's front)
      if (Math.abs(x) > ix - 0.08 && Math.abs(z) < iz || Math.abs(z) > iz - 0.08 && Math.abs(x) < ix) { left--; continue; }
      e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
      q.setFromEuler(e);
      const h = 0.14 + r() * 0.22, hs = 0.85 + r() * 0.4; // (the head keeps its size: only the stalk is as tall as the flower)
      m4.compose(p.set(x, 0, z), q, sc.set(hs, h, hs));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c.set(FLOWER_COLOURS[kind]!).multiplyScalar(0.85 + r() * 0.15));
      i++; left--;
    }
    mesh.computeBoundingSphere();
    mesh.name = 'garden-flowers';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (def.houses) {
    const h = def.houses, r = rng(5150), b = new BoxBatch();
    let made = 0, tries = 0;
    while (made < h.count && tries++ < h.count * 40) {
      const a = r() * Math.PI * 2, d = h.ring[0]! + (h.ring[1]! - h.ring[0]!) * r();
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      // (the near end, +z, is the broadcast camera's: nothing within 35 degrees of its line)
      if (cz > 0 && Math.abs(cx) < cz * 0.7) continue;
      const wide = 6 + r() * 7, deep = 5 + r() * 4, tall = 3.2 + Math.floor(r() * 2) * 3, yaw = -a + (r() - 0.5) * 0.4;
      const lime = r() < 0.75 ? '#e9e2d2' : r() < 0.5 ? '#e4cfa6' : '#d9b68d';
      b.box(cx, tall / 2, cz, wide, tall, deep, lime, yaw);
      // the roof: a low terracotta slab with eaves, and a darker ridge
      b.box(cx, tall + 0.25, cz, wide + 0.6, 0.5, deep + 0.6, r() < 0.5 ? '#a4543a' : '#b0613f', yaw);
      b.box(cx, tall + 0.55, cz, wide * 0.92, 0.2, deep * 0.35, '#8d4631', yaw);
      // windows: dark recesses on the face towards the court
      const fx2 = Math.cos(yaw), fz2 = -Math.sin(yaw), nx = -Math.sin(yaw), nz = -Math.cos(yaw);
      const toward = nx * -cx + nz * -cz > 0 ? 1 : -1;
      for (let fl = 0; fl < Math.round(tall / 3); fl++) for (let k = 0; k < Math.floor(wide / 2.4); k++) {
        const along = (k + 0.5) * (wide / Math.floor(wide / 2.4)) - wide / 2, up = 1.6 + fl * 3;
        b.box(cx + fx2 * along + nx * toward * (deep / 2 + 0.01), up, cz + fz2 * along + nz * toward * (deep / 2 + 0.01), 0.9, 1.2, 0.04, '#2e2a26', yaw);
      }
      made++;
    }
    const mesh = b.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMap: env }));
    mesh.name = 'garden-houses';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** A flower: a stalk and a head of five petals round a centre, about 0.4 m tall (scaled per flower); colour by instance. */
function flowerGeometry(): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.003, 0.004, 1, 4, 1, true);
  stalk.translate(0, 0.5, 0);
  const head = new THREE.CircleGeometry(0.045, 10);
  // petals: the disc's rim pulled in between five lobes, cupped a little upwards
  const hp = head.attributes.position!;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x);
    const k = r > 0 ? (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5))) : 0;
    hp.setXYZ(i, x * k, y * k, r * 0.4);
  }
  head.rotateX(-Math.PI / 2 + 0.35);
  head.translate(0, 1, 0);
  // (vertex colour: the stalk green, the head white for the instance's colour; the instance colour multiplies both,
  // and the stalks are thin enough that a tinted green does not show)
  const tint = (g: THREE.BufferGeometry, r: number, gg: number, b: number): void => {
    const c = new Float32Array(g.attributes.position!.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = gg; c[i + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  };
  tint(stalk, 0.1, 0.2, 0.08);
  tint(head, 1, 1, 1);
  const parts = [stalk.toNonIndexed(), head.toNonIndexed()];
  stalk.dispose(); head.dispose();
  let n = 0;
  for (const g of parts) n += g.attributes.position!.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    col.set(g.attributes.color!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const FLOWER_COLOURS = ['#f4f1ea', '#f4f1ea', '#e86f9a', '#d8343a', '#f2c230', '#8c64c8', '#f08a3c'];

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0, ni = 0;
  for (const g of parts) { n += g.attributes.position!.count; ni += g.index!.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of parts) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    uv.set(g.attributes.uv!.array as Float32Array, o * 2);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i]! + o;
    o += g.attributes.position!.count; oi += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
