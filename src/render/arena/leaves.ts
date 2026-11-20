// Fallen leaves round the golden club (data/arenas.json `leaves`): dry olive and broadleaf leaves, our own (drawn on a canvas
// here), lying on the surround and blown against the foot of the glass, a few out on the court. Wind leaves them where
// something stops it: so the surround's leaves crowd towards the cage, and the court's lie within a metre or so of its
// walls, most in the corners. One instanced mesh of a leaf bent along its midrib (12 triangles), cut out by its texture.
import * as THREE from 'three/webgpu';
import { attribute, texture, uv, vec2 } from 'three/tsl';
import { ownedTextures } from '../dispose.ts';

export interface LeavesDef {
  /** Leaves on the surround and on the court. */
  surround: number; court: number;
  /** Their length (m), least and most. */
  size: number[];
}

/** Four leaves side by side: olive (long, narrow, grey-green going brown), a dry broadleaf, a yellow one, a curled brown one. */
function leafTexture(): THREE.CanvasTexture {
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const cols = [['#a39d68', '#7d7350'], ['#c49a5e', '#94703f'], ['#dcb45a', '#a8843a'], ['#9e6a42', '#6e4a2c']];
  const shapes = [0.16, 0.36, 0.42, 0.3]; // half width over length
  for (let k = 0; k < 4; k++) {
    const x0 = k * 128 + 64, hw = shapes[k]! * 110;
    const gr = g.createLinearGradient(x0 - hw, 0, x0 + hw, 0);
    gr.addColorStop(0, cols[k]![1]!); gr.addColorStop(0.5, cols[k]![0]!); gr.addColorStop(1, cols[k]![1]!);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x0, 8);
    g.bezierCurveTo(x0 + hw * 1.3, 30, x0 + hw * 1.1, 90, x0, 122);
    g.bezierCurveTo(x0 - hw * 1.1, 90, x0 - hw * 1.3, 30, x0, 8);
    g.fill();
    g.strokeStyle = 'rgba(40,30,15,0.5)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x0, 10); g.lineTo(x0, 120); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A leaf: 1 long (z), its width by the texture's cell, bent up along the midrib and curled at the ends. */
function leafGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 2, 4);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.abs(x) * 0.35 + z * z * 0.25);
  }
  g.computeVertexNormals();
  return g;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/**
 * The leaves, one mesh. `halfW`, `halfL`: the court's inside; `sx`, `sz`: the surround's half sizes. Each instance's
 * texture cell (0..3) is an instanced attribute, `aCell`.
 */
export function buildLeaves(def: LeavesDef, halfW: number, halfL: number, sx: number, sz: number, env: THREE.Texture | null): THREE.InstancedMesh {
  const n = def.surround + def.court;
  const tex = leafTexture();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, envMap: env });
  mat.alphaTest = 0.5;
  ownedTextures(mat).push(tex); // (read through a node: freed with the material)
  const mesh = new THREE.InstancedMesh(leafGeometry(), mat, n);
  const cells = new Float32Array(n);
  const r = rng(909);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (i: number, x: number, z: number): void => {
    const len = def.size[0]! + (def.size[1]! - def.size[0]!) * r();
    const k = Math.floor(r() * 4);
    const w = [0.32, 0.72, 0.84, 0.6][k]!;
    e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
    q.setFromEuler(e);
    m4.compose(p.set(x, 0.004, z), q, s.set(len * w, len * (0.6 + r() * 0.8), len));
    mesh.setMatrixAt(i, m4);
    cells[i] = k;
  };
  let i = 0;
  // The surround: between the cage and its edge, nearer the cage the more (an exponential falling off from the glass).
  while (i < def.surround) {
    const side = r();
    let x: number, z: number;
    const d = -Math.log(1 - r() * 0.98) * 1.6 + 0.08; // metres out from the cage
    if (side < 0.55) { x = (r() < 0.5 ? -1 : 1) * (halfW + d); z = (r() * 2 - 1) * (halfL + 2); }
    else { z = (r() < 0.5 ? -1 : 1) * (halfL + d); x = (r() * 2 - 1) * (halfW + 2); }
    if (Math.abs(x) > sx || Math.abs(z) > sz) continue;
    place(i++, x, z);
  }
  // The court: within a metre or so of a wall, more in the corners.
  while (i < n) {
    const d = -Math.log(1 - r() * 0.95) * 0.45 + 0.04;
    let x: number, z: number;
    if (r() < 0.5) { x = (r() < 0.5 ? -1 : 1) * (halfW - d); z = (r() * 2 - 1) * halfL * (0.6 + 0.4 * r()); z = Math.sign(z) * Math.min(halfL - 0.05, Math.abs(z) * 1.1); }
    else { z = (r() < 0.5 ? -1 : 1) * (halfL - d); x = (r() * 2 - 1) * halfW; }
    place(i++, x, z);
  }
  mesh.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
  mat.colorNode = texture(tex, vec2(uv().x.add(attribute<'float'>('aCell', 'float')).div(4), uv().y));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'leaves';
  return mesh;
}
