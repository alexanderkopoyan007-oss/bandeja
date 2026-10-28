// A pro event's arena (arena-wide, arena-wide-2, arena-glass in reference/photos.json): boards round the
// surround, tiered stands on four sides with a seated crowd, and the hall: walls with a band of high windows, a
// white roof with rows of lights and the trusses that hold it. Generic graphics only: no real event's branding.
import * as THREE from 'three/webgpu';
import { positionLocal, vec3, sin, time, hash, instanceIndex, uniform, float } from 'three/tsl';
import type { Court } from '../../sim/court/court.ts';
import type { ArenaDef, ArenaPart } from './arena.ts';

/** A merged mesh of axis-aligned boxes (one draw call), with per-box colours. */
export class BoxBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new THREE.Color();

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, rotY = 0): void {
    this.c.set(color);
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    const ng = g.toNonIndexed();
    const p = ng.attributes.position!.array, n = ng.attributes.normal!.array;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]!); this.nor.push(n[i]!); }
    for (let i = 0; i < p.length / 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
    g.dispose(); ng.dispose();
  }

  mesh(mat?: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return new THREE.Mesh(geo, mat ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  }
}

/** Generic board graphics: the game's name and abstract stripes on the board colour. */
function boardTexture(base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
  const items = ['BANDEJA', '◆', 'PADEL', '◆', 'BANDEJA', '//', 'OPEN', '◆'];
  g.font = 'bold 40px ui-sans-serif, system-ui, sans-serif';
  g.textBaseline = 'middle';
  let x = 40;
  for (let k = 0; x < c.width; k++) {
    const t = items[k % items.length]!;
    g.fillStyle = k % 3 === 2 ? '#f2c94c' : '#f4f6fa';
    g.fillText(t, x, 34);
    x += g.measureText(t).width + 70;
  }
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 56, c.width, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** The stands are lit far less than the court (arena-wide-2: dark stands round a bright court and roof); their
 * albedo is scaled down to stand in for that rather than lighting them separately. */
const STAND_LIGHT = 0.55;

const SKIN = [0xf1c8a6, 0xe0ac87, 0xc68e66, 0x9c6b4a, 0x6e4a33, 0xf6d5bf];
const HAIR = [0x1d1612, 0x3a2a1e, 0x5a4330, 0x8a6a45, 0xc9b48a, 0x2b2b2b, 0x8c8c8c];
// What a crowd wears, by share (arena-wide-2: mostly dark and neutral, a few bright tops; a uniform rainbow read as
// toys): black and charcoal, navy, white, greys, denim, then the colours.
const SHIRT = [
  0x141414, 0x1e1f22, 0x26282c, 0x141414, 0x2a2d33, 0x1a2340, 0x1d2a55, 0x22304f, 0xe9e9e6, 0xd9dad6, 0xf2f2ef,
  0x6d7077, 0x8b8e94, 0x55585e, 0x3f5878, 0x4a6488, 0xb33a32, 0x2f6fd1, 0x3c6b4a, 0xd8c9a8, 0x7a3346, 0xe0b23a,
];

export function buildStadium(root: THREE.Group, def: ArenaDef, court: Court): ArenaPart {
  void court;
  const b = def.boards!, st = def.stands!, h = def.hall!;
  // Boards round the surround (with gaps at the corners for the players' way in).
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTexture(b.color), roughness: 0.55 });
  const boards = new THREE.Group();
  const board = (x: number, z: number, len: number, rot: number): void => {
    const mat = boardMat.clone();
    mat.map = boardMat.map!.clone();
    mat.map.repeat.set(len / 30, 1);
    mat.map.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, b.height, 0.08), mat);
    m.position.set(x, b.height / 2, z);
    m.rotation.y = rot;
    m.castShadow = false;
    m.receiveShadow = true;
    boards.add(m);
  };
  for (const s of [1, -1]) {
    board(s * b.x, 0, b.z * 2 - 3, Math.PI / 2);
    board(0, s * b.z, b.x * 2 - 3, 0);
  }
  root.add(boards);

  // Stands: a block on each side, rows rising away from the court; seats and a seated crowd, instanced.
  const tiers = new BoxBatch();
  const seats: THREE.Matrix4[] = [];
  const people: THREE.Matrix4[] = [];
  const rnd = mulberry(7);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const blocks = [
    // [centre offset along the normal, half length, yaw (faces the court), along axis]
    // The side stands run on past the ends to fill the corners (the arena wraps round; open corners showed the
    // tiers' bare stepped sides).
    { n: new THREE.Vector3(1, 0, 0), at: b.x + st.from, half: b.z + st.from + st.rows * st.depth, yaw: -Math.PI / 2 },
    { n: new THREE.Vector3(-1, 0, 0), at: b.x + st.from, half: b.z + st.from + st.rows * st.depth, yaw: Math.PI / 2 },
    { n: new THREE.Vector3(0, 0, 1), at: b.z + st.from, half: b.x - 0.5, yaw: Math.PI },
    { n: new THREE.Vector3(0, 0, -1), at: b.z + st.from, half: b.x - 0.5, yaw: 0 },
  ];
  for (const bl of blocks) {
    const along = new THREE.Vector3(bl.n.z, 0, -bl.n.x); // perpendicular in the floor plane
    for (let r = 0; r < st.rows; r++) {
      const out = bl.at + r * st.depth;
      const top = 0.55 + r * st.rise;
      const c = new THREE.Vector3().copy(bl.n).multiplyScalar(out + st.depth / 2);
      const len = bl.half * 2;
      if (Math.abs(bl.n.x) > 0) tiers.box(c.x, top / 2, c.z, st.depth, top, len, r % 2 ? st.riser : '#4c5057');
      else tiers.box(c.x, top / 2, c.z, len, top, st.depth, r % 2 ? st.riser : '#4c5057');
      if (r === 0) {
        // The stand's front: a dark wall below the first row, a rail on top.
        const f = new THREE.Vector3().copy(bl.n).multiplyScalar(out - 0.05);
        if (Math.abs(bl.n.x) > 0) tiers.box(f.x, top / 2 + 0.5, f.z, 0.1, top + 1, len, '#141a33');
        else tiers.box(f.x, top / 2 + 0.5, f.z, len, top + 1, 0.1, '#141a33');
      }
      const n = Math.floor(len / 0.52);
      for (let k = 0; k < n; k++) {
        const t = -bl.half + (k + 0.5) * (len / n);
        pos.copy(bl.n).multiplyScalar(out + st.depth * 0.55).addScaledVector(along, t);
        pos.y = top;
        q.setFromAxisAngle(up, bl.yaw);
        m4.compose(pos, q, sc);
        seats.push(m4.clone());
        if (rnd() < st.fill) {
          const s = 0.92 + rnd() * 0.18;
          const p = pos.clone().addScaledVector(bl.n, -0.05 + rnd() * 0.08).addScaledVector(along, (rnd() - 0.5) * 0.08);
          q.setFromAxisAngle(up, bl.yaw + (rnd() - 0.5) * 0.5);
          people.push(new THREE.Matrix4().compose(p, q.clone(), new THREE.Vector3(s, s, s)));
        }
      }
    }
  }
  const tierMesh = tiers.mesh();
  tierMesh.receiveShadow = true;
  root.add(tierMesh);

  const seatGeo = new THREE.BoxGeometry(0.44, 0.42, 0.42);
  seatGeo.translate(0, 0.21, 0.1);
  const seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(st.seat).multiplyScalar(STAND_LIGHT * 1.3), roughness: 0.6 }), seats.length);
  seats.forEach((m, i) => seatMesh.setMatrixAt(i, m));
  root.add(seatMesh);

  // The crowd: torso, head and hair, each one instanced mesh; colours per person. They sway a little, and more
  // as `excite` rises (a long rally, a big point).
  const excite = uniform(0);
  const sway = (amp: number): THREE.Node<'vec3'> => {
    const ph = hash(instanceIndex).mul(6.2831);
    const f = float(1.3).add(hash(instanceIndex.add(7)).mul(0.9));
    return positionLocal.add(vec3(sin(time.mul(f).add(ph)).mul(0.012 * amp), sin(time.mul(f.mul(2)).add(ph)).mul(excite).mul(0.05 * amp), 0));
  };
  const crowd = (geo: THREE.BufferGeometry, colors: number[], rough: number): THREE.InstancedMesh => {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: rough });
    mat.positionNode = sway(1);
    const im = new THREE.InstancedMesh(geo, mat, people.length);
    const c = new THREE.Color();
    people.forEach((m, i) => {
      im.setMatrixAt(i, m);
      // Each a little different, and a little in the shade of the people round them.
      im.setColorAt(i, c.setHex(colors[Math.floor(rnd() * colors.length)]!).offsetHSL(0, -0.05, (rnd() - 0.6) * 0.06).multiplyScalar(STAND_LIGHT));
    });
    root.add(im);
    return im;
  };
  const torso = new THREE.CylinderGeometry(0.16, 0.2, 0.62, 7);
  torso.translate(0, 0.72, 0.12);
  const thighs = new THREE.BoxGeometry(0.34, 0.14, 0.42);
  thighs.translate(0, 0.47, -0.08);
  const body = mergeGeometries([torso, thighs]);
  crowd(body, SHIRT, 0.85);
  const head = new THREE.IcosahedronGeometry(0.105, 1);
  head.scale(0.9, 1.1, 1);
  head.translate(0, 1.15, 0.12);
  crowd(head, SKIN, 0.6);
  const hair = new THREE.SphereGeometry(0.112, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.translate(0, 1.17, 0.13);
  crowd(hair, HAIR, 0.8);

  // The hall: walls with a band of windows, a white roof with rows of lights and trusses.
  const hall = new BoxBatch();
  const wallC = h.wall;
  for (const s of [1, -1]) {
    hall.box(s * h.x, h.height / 2, 0, 0.4, h.height, h.z * 2, wallC);
    hall.box(0, h.height / 2, s * h.z, h.x * 2, h.height, 0.4, wallC);
  }
  for (let x = -h.x; x <= h.x + 0.01; x += 6) hall.box(x, h.height - 0.5, 0, 0.18, 0.9, h.z * 2, '#9aa0a8');
  for (let z = -h.z; z <= h.z + 0.01; z += 8) hall.box(0, h.height - 1.2, z, h.x * 2, 0.15, 0.15, '#8d939b');
  const hallMesh = hall.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  root.add(hallMesh);
  // The roof: a white membrane under the skylights, lit from above (arena-wide-2's bright ceiling): mostly emissive.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(h.x * 2, h.z * 2), new THREE.MeshStandardMaterial({ color: h.roof, roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(h.roof), emissiveIntensity: 0.85 }));
  roof.rotation.x = Math.PI / 2;
  roof.position.y = h.height;
  root.add(roof);
  // Light rows (emissive panels: they light the env map, so the glass and the turf pick them up) and windows.
  const glow = new BoxBatch();
  const panels = new BoxBatch();
  for (let x = -h.x + 3; x < h.x; x += 6) {
    for (let z = -h.z + 4; z < h.z; z += 8) panels.box(x, h.height - 0.05, z, 1.6, 0.06, 2.4, '#ffffff');
  }
  // The light panels are far brighter than white (HDR): they bloom (render/post.ts) and light the env map.
  root.add(panels.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(4) })));
  for (const s of [1, -1]) {
    glow.box(s * (h.x - 0.25), h.height - 3.2, 0, 0.05, 2.2, h.z * 1.8, '#dfe8f2');
    glow.box(0, h.height - 3.2, s * (h.z - 0.25), h.x * 1.8, 2.2, 0.05, '#dfe8f2');
  }
  const glowMesh = glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }));
  root.add(glowMesh);

  // Courtside: an umpire's chair at the net, benches with bags behind the side glass, a TV camera on a riser.
  const side = new BoxBatch();
  const cx = court.halfW + 1.6;
  // Umpire's chair: a raised seat on legs with a footrest, by the net post outside the side glass.
  for (const dx of [-0.25, 0.25]) for (const dz of [-0.25, 0.25]) side.box(cx + dx, 0.75, dz, 0.05, 1.5, 0.05, '#c9ccd1');
  side.box(cx, 1.5, 0, 0.6, 0.08, 0.6, '#c9ccd1');
  side.box(cx + 0.27, 1.85, 0, 0.06, 0.6, 0.6, '#1b2a63');
  side.box(cx - 0.3, 0.7, 0, 0.3, 0.05, 0.6, '#c9ccd1');
  for (const z of [-3, 3]) {
    side.box(-cx, 0.23, z, 0.5, 0.46, 2.2, '#2b2f38');
    side.box(-cx - 0.05, 0.6, z - 0.5, 0.35, 0.3, 0.5, '#c23a2c');
  }
  side.box(-(court.halfW + 4), 0.6, court.halfL + 4, 1.4, 1.2, 1.4, '#1c2030');
  side.box(-(court.halfW + 4), 1.55, court.halfL + 4, 0.35, 0.3, 0.6, '#0f1115');
  const sideMesh = side.mesh();
  sideMesh.castShadow = true;
  root.add(sideMesh);

  return {
    update(_t: number, ex: number): void { excite.value = ex; },
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Position + normal only, non-indexed. */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position!.array as Float32Array));
    nor.push(...(g.attributes.normal!.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
