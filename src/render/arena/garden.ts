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
  g.fillStyle = 'rgb(168,156,134)';
  g.fillRect(0, 0, S, S);
  const r = rng(911);
  const px = S / 2; // pixels a metre
  let y = 0;
  while (y < S) {
    const h = (0.13 + r() * 0.09) * px;
    let x = -r() * 0.2 * px;
    while (x < S) {
      const w = (0.16 + r() * 0.24) * px;
      const k = 0.78 + r() * 0.32, warm = r() * 18;
      const cr = Math.round((176 + warm) * k), cg = Math.round((158 + warm * 0.4) * k), cb = Math.round(128 * k);
      // the stone and its wrap round the tile's edge (it repeats)
      for (const ox of [0, -S, S]) for (const oy of [0, -S]) {
        const gx = x + ox + w / 2, gy = y + oy + h / 2;
        const gr = g.createRadialGradient(gx - w * 0.15, gy - h * 0.2, 1, gx, gy, Math.max(w, h) * 0.6);
        gr.addColorStop(0, `rgb(${Math.min(255, cr + 16)},${Math.min(255, cg + 14)},${Math.min(255, cb + 10)})`);
        gr.addColorStop(1, `rgb(${cr - 22},${cg - 22},${cb - 20})`);
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(gx, gy, w / 2 - 3, h / 2 - 3, (r() - 0.5) * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      x += w;
    }
    y += h;
  }
  // grit and lichen
  for (let i = 0; i < 6000; i++) {
    const v = r();
    g.fillStyle = v < 0.08 ? 'rgba(120,124,80,0.35)' : v < 0.5 ? 'rgba(80,70,58,0.25)' : 'rgba(225,215,195,0.2)';
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
