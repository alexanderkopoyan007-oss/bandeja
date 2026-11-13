// A pro event's arena (arena-wide, arena-wide-2, arena-glass in reference/photos.json): boards round the
// surround, tiered stands on four sides with a seated crowd, and the hall: walls with a band of high windows, a
// white roof with rows of lights and the trusses that hold it. Generic graphics only: no real event's branding.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { Court } from '../../sim/court/court.ts';
import type { ArenaDef, ArenaPart, CrowdState } from './arena.ts';
import { arenaDetail, surfaceMaterial } from './surface.ts';
import { buildCrowd, type Spectator } from './crowd.ts';

/** A merged mesh of axis-aligned boxes (one draw call), with per-box colours. */
/** The courtside benches' places along the side (m from the net, either side) and the seats' height. */
export const BENCH_Z = [-3, 3];
export const BENCH_TOP = 0.46;

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

/** The surround's lettering: how wide it lies (m) and its texture's shape. */
const MARK_W = 11, MARK_ASPECT = 6.5;

/** Lettering for the floor: white, widely spaced, a rule over and under it. */
function floorMark(text: string): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 2304; c.height = Math.round(c.width / MARK_ASPECT);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  // (spaced by hand: canvas letter-spacing is not in every browser; sized to fill the width, whatever the font measures)
  const gap = 40;
  const wide = (px: number): number => {
    g.font = `900 ${px}px ui-sans-serif, system-ui, sans-serif`;
    let w = -gap;
    for (const ch of text) w += g.measureText(ch).width + gap;
    return w;
  };
  const px = Math.min(320, Math.floor(300 * (c.width * 0.95) / wide(300)));
  const w = wide(px);
  let x = (c.width - w) / 2;
  for (const ch of text) { g.fillText(ch, x, c.height / 2 + px * 0.04); x += g.measureText(ch).width + gap; }
  const rule = Math.max(8, Math.round(px * 0.055)), off = c.height / 2 - px * 0.5 - rule * 1.6;
  g.fillRect((c.width - w) / 2, off, w, rule);
  g.fillRect((c.width - w) / 2, c.height - off - rule, w, rule);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.86, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** The detail pass: the stands' rails (stainless, dimmed as the stands are) and the stairs' nosing lights. */
const RAIL_STEEL = '#565b63', NOSING = '#9fc0ff';

/** The umpire sits in the court's light, not the stands'. */
const UMPIRE_LIGHT = 1;
export function buildStadium(root: THREE.Group, def: ArenaDef, court: Court): ArenaPart {
  const b = def.boards!, st = def.stands!, h = def.hall!;
  // The stands are lit far less than the court; their albedo is scaled down to stand in for that rather than lighting
  // them separately. The crowd's sprites have their light baked in.
  const STAND_LIGHT = st.light, CROWD_LIGHT = st.crowdLight;
  // Boards round the surround (with gaps at the corners for the players' way in).
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTexture(b.color), roughness: 0.55 });
  // (the detail pass: the boards are LED screens, lit from inside, not painted panels under the hall's light)
  if (arenaDetail.on) { boardMat.emissiveMap = boardMat.map; boardMat.emissive = new THREE.Color(1, 1, 1); boardMat.emissiveIntensity = 0.85; boardMat.roughness = 0.3; }
  const boards = new THREE.Group();
  const board = (x: number, z: number, len: number, rot: number): void => {
    const mat = boardMat.clone();
    mat.map = boardMat.map!.clone();
    mat.map.repeat.set(len / 30, 1);
    mat.map.needsUpdate = true;
    if (mat.emissiveMap) mat.emissiveMap = mat.map;
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
  if (arenaDetail.on) {
    // The surround's lettering: an event's name tufted into the carpet behind each end, set for the main camera (the one
    // behind the near end) as a broadcast court's is. The carpet's own mottle shows through it.
    const mark = floorMark('BANDEJA OPEN');
    const deep = def.surround.z - court.halfL;
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(MARK_W, MARK_W / MARK_ASPECT), mark);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.001, s * (court.halfL + deep * 0.55));
      m.receiveShadow = true;
      m.renderOrder = 1;
      root.add(m);
    }
  }

  // Stands: a block on each side, rows rising away from the court; seats and a seated crowd, instanced.
  const tiers = new BoxBatch();
  const seats: THREE.Matrix4[] = [];
  // People by stand (blocks below), so the stand behind the camera need not be drawn.
  const people: Spectator[][] = [[], [], [], []];
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
  const standDepth = st.rows * st.depth;
  // The detail pass (surface.ts arenaDetail): what a stand has besides its steps and seats. Aisles every AISLE m, AISLE_W wide,
  // each with a half step between rows and a lit nosing on every step's edge (the line of lights down an arena's stairs);
  // the front wall an upstand with a steel rail on posts over it, in place of one dark slab.
  const detail = arenaDetail.on;
  const AISLE = 9, AISLE_W = 1.2;
  const inAisle = (t: number): boolean => detail && ((((t + AISLE_W / 2) % AISLE) + AISLE) % AISLE) < AISLE_W;
  const steel = new BoxBatch(), nosing = new BoxBatch();
  for (let bi = 0; bi < blocks.length; bi++) {
    const bl = blocks[bi]!;
    const along = new THREE.Vector3(bl.n.z, 0, -bl.n.x); // perpendicular in the floor plane
    for (let r = 0; r < st.rows; r++) {
      const out = bl.at + r * st.depth;
      const top = 0.55 + r * st.rise;
      const c = new THREE.Vector3().copy(bl.n).multiplyScalar(out + st.depth / 2);
      const len = bl.half * 2;
      if (Math.abs(bl.n.x) > 0) tiers.box(c.x, top / 2, c.z, st.depth, top, len, r % 2 ? st.riser : '#4c5057');
      else tiers.box(c.x, top / 2, c.z, len, top, st.depth, r % 2 ? st.riser : '#4c5057');
      // (a box lying along the stand: `d` deep across it, `l` long, its middle `t` along it)
      const lay = (batch: BoxBatch, o: number, y: number, t: number, d: number, hgt: number, l: number, colour: string): void => {
        const at = new THREE.Vector3().copy(bl.n).multiplyScalar(o).addScaledVector(along, t);
        if (Math.abs(bl.n.x) > 0) batch.box(at.x, y, at.z, d, hgt, l, colour);
        else batch.box(at.x, y, at.z, l, hgt, d, colour);
      };
      if (r === 0 && !detail) {
        // The stand's front: a dark wall below the first row, a rail on top.
        const f = new THREE.Vector3().copy(bl.n).multiplyScalar(out - 0.05);
        if (Math.abs(bl.n.x) > 0) tiers.box(f.x, top / 2 + 0.5, f.z, 0.1, top + 1, len, '#141a33');
        else tiers.box(f.x, top / 2 + 0.5, f.z, len, top + 1, 0.1, '#141a33');
      }
      if (r === 0 && detail) {
        // The stand's front: a concrete upstand to knee height over the first row, a steel rail on posts over it.
        lay(tiers, out - 0.06, (top + 0.45) / 2, 0, 0.12, top + 0.45, len, '#2a2f45');
        for (const y of [top + 0.75, top + 1.05]) lay(steel, out - 0.06, y, 0, 0.045, 0.045, len, RAIL_STEEL);
        for (let t = -bl.half + 0.4; t < bl.half; t += 1.6) lay(steel, out - 0.06, top + 0.76, t, 0.04, 0.62, 0.04, RAIL_STEEL);
      }
      if (detail) {
        // The aisles: a half step up to the next row, a rail post every other row, and the nosings' lights.
        for (let t = Math.ceil((-bl.half + 1) / AISLE) * AISLE; t < bl.half - 1; t += AISLE) {
          lay(tiers, out + st.depth * 0.75, top + st.rise / 4, t, st.depth / 2, st.rise / 2, AISLE_W - 0.06, '#5d626b');
          lay(nosing, out + 0.012, top + 0.004, t, 0.024, 0.012, AISLE_W - 0.1, NOSING);
          lay(nosing, out + st.depth * 0.5 + 0.012, top + st.rise / 2 + 0.004, t, 0.024, 0.012, AISLE_W - 0.1, NOSING);
          if (r % 4 === 1) lay(steel, out + st.depth * 0.5, top + 0.5, t + AISLE_W / 2 - 0.03, 0.04, 1.0, 0.04, RAIL_STEEL);
        }
      }
      const n = Math.floor(len / 0.52);
      for (let k = 0; k < n; k++) {
        const t = -bl.half + (k + 0.5) * (len / n);
        if (inAisle(t)) continue;
        pos.copy(bl.n).multiplyScalar(out + st.depth * 0.55).addScaledVector(along, t);
        pos.y = top;
        q.setFromAxisAngle(up, bl.yaw);
        m4.compose(pos, q, sc);
        seats.push(m4.clone());
        if (rnd() < st.fill) {
          const p = pos.clone().addScaledVector(bl.n, -0.05 + rnd() * 0.08).addScaledVector(along, (rnd() - 0.5) * 0.08);
          people[bi]!.push({ x: p.x, y: p.y, z: p.z, yaw: bl.yaw + (rnd() - 0.5) * 0.5 });
        }
      }
    }
  }
  // (the detail pass: the steps are cast concrete, surface.ts)
  const tierMesh = tiers.mesh(arenaDetail.on ? surfaceMaterial({ set: 'concrete', vertexColors: true, tile: 2.4 }) : undefined);
  tierMesh.receiveShadow = true;
  root.add(tierMesh);

  let seatGeo: THREE.BufferGeometry = new THREE.BoxGeometry(0.44, 0.42, 0.42);
  seatGeo.translate(0, 0.21, 0.1);
  if (detail) {
    // A tip-up seat: the pan on its bracket and a back, in place of one block.
    const pan = new THREE.BoxGeometry(0.44, 0.07, 0.4), back = new THREE.BoxGeometry(0.44, 0.34, 0.06), leg = new THREE.BoxGeometry(0.07, 0.36, 0.26);
    pan.translate(0, 0.4, 0.06);
    back.translate(0, 0.56, 0.29);
    back.rotateX(0.1);
    leg.translate(0, 0.18, 0.12);
    seatGeo.dispose();
    // (the bracket under the pan only on the full pass: a third of the seats' 168 thousand triangles, seen from nowhere a match's
    // cameras stand)
    seatGeo = mergeGeometries(arenaDetail.full ? [pan, back, leg] : [pan, back]);
    for (const g of [pan, back, leg]) g.dispose();
  }
  const seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(st.seat).multiplyScalar(STAND_LIGHT * 1.3), roughness: 0.6 }), seats.length);
  seats.forEach((m, i) => seatMesh.setMatrixAt(i, m));
  root.add(seatMesh);
  if (detail) {
    root.add(steel.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.85 })));
    // (the nosings are lamps: unlit, a little over white so the glow picks them out)
    root.add(nosing.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(1.6) })));
  }

  // The crowd: MakeHuman spectators as sprites (crowd.ts), one instanced mesh a stand. They sway a little, clap and
  // stand up after a point by the crowd's mood (game/crowdMood.ts).
  const mood = uniform(new THREE.Vector3());
  const groups = buildCrowd(people, mood, rnd, { light: CROWD_LIGHT });
  for (const g of groups) root.add(g);

  // The hall: walls with a band of windows, a white roof with rows of lights and trusses.
  const hall = new BoxBatch();
  // (the detail pass: the walls are profiled steel cladding, their own mesh; the trusses stay plain steel)
  const walls = arenaDetail.on ? new BoxBatch() : hall;
  const wallC = h.wall;
  for (const s of [1, -1]) {
    walls.box(s * h.x, h.height / 2, 0, 0.4, h.height, h.z * 2, wallC);
    walls.box(0, h.height / 2, s * h.z, h.x * 2, h.height, 0.4, wallC);
  }
  if (walls !== hall) root.add(walls.mesh(surfaceMaterial({ set: 'corrugated', vertexColors: true, tile: 3.6, variation: 0.7 })));
  for (let x = -h.x; x <= h.x + 0.01; x += 6) hall.box(x, h.height - 0.5, 0, 0.18, 0.9, h.z * 2, h.steel!);
  for (let z = -h.z; z <= h.z + 0.01; z += 8) hall.box(0, h.height - 1.2, z, h.x * 2, 0.15, 0.15, h.steel!);
  const hallMesh = hall.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  root.add(hallMesh);
  // The roof: a white membrane under the skylights, lit from above (arena-wide-2's bright ceiling): mostly emissive.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(h.x * 2, h.z * 2), new THREE.MeshStandardMaterial({ color: h.roof, roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(h.roof), emissiveIntensity: h.roofGlow! }));
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
  root.add(panels.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(h.lamps!) })));
  for (const s of [1, -1]) {
    glow.box(s * (h.x - 0.25), h.height - 3.2, 0, 0.05, 2.2, h.z * 1.8, h.windows!);
    glow.box(0, h.height - 3.2, s * (h.z - 0.25), h.x * 1.8, 2.2, 0.05, h.windows!);
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
  side.box(cx - 0.35, 1.02, 0, 0.3, 0.05, 0.6, '#c9ccd1');
  // (the benches are the arena's, render/props.ts, with the players' bags on them: game.ts placeBags)
  side.box(-(court.halfW + 4), 0.6, court.halfL + 4, 1.4, 1.2, 1.4, '#1c2030');
  side.box(-(court.halfW + 4), 1.55, court.halfL + 4, 0.35, 0.3, 0.6, '#0f1115');
  const sideMesh = side.mesh();
  sideMesh.castShadow = true;
  root.add(sideMesh);
  // The umpire: one of the crowd's people in a dark jacket on the chair, looking at the court. A mood of their own, or
  // they'd clap the winners.
  const umpire = buildCrowd([[{ x: cx, y: 1.54 - 0.42, z: 0, yaw: -Math.PI / 2 }]], uniform(new THREE.Vector3()), rnd, { light: UMPIRE_LIGHT, shirt: 0x1a2340 });
  root.add(umpire[0]!);

  return {
    update(_t: number, m: CrowdState, cam?: THREE.Vector3): void {
      // (a vector uniform's fields: writing a scalar uniform's value boxes a double every frame)
      mood.value.set(m.excite, m.applause, m.ovation);
      // A stand whose back row the camera is behind (along its normal) is behind the camera: out of shot, except
      // in passing during the change-of-ends swing. (Its front row was the test: the player camera stands above
      // the end stand, 6.5 m back, and the rows in front of it went missing from the foot of the picture.)
      if (cam) for (let bi = 0; bi < blocks.length; bi++) {
        const bl = blocks[bi]!;
        groups[bi]!.visible = cam.x * bl.n.x + cam.z * bl.n.z < bl.at + standDepth;
      }
    },
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
