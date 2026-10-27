// The court built from the sim's Court geometry: floor and lines, glass, the welded wire mesh, the steel
// frame (posts, rails, door frames, clamps) and the net. Rendering only reads the sim.
// Draw calls stay low: glass and mesh are each one merged mesh, the whole frame is one instanced mesh.
import * as THREE from 'three/webgpu';
import { uv, vec2, float, fract, min, max, fwidth, smoothstep, mix, saturate, color, length } from 'three/tsl';
import {
  Court, SURF_GLASS, SURF_MESH,
  WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, type Panel,
} from '../sim/court/court.ts';

const LINE_Y = 0.002;
const POST = 0.08; // square steel tube
const RAIL = 0.05;

/**
 * Anti-aliased procedural wire grid. UVs are in metres. Each pixel computes how much of it the wires cover,
 * and when a cell shrinks below a couple of pixels it fades to the average coverage, so the fence never
 * shimmers or forms moire patterns at a distance.
 */
export function wireMaterial(cell: number, wire: number, diamond: boolean, tint: number, strength: number, knot = 0): THREE.MeshBasicNodeMaterial {
  const p = uv().div(cell);
  const q = diamond ? vec2(p.x.add(p.y), p.x.sub(p.y)).mul(0.70710678) : p;
  const f = fract(q);
  const d = min(f, f.oneMinus());
  const wn = (wire / cell) * (diamond ? 1.41421356 : 1); // wire width in cell units
  const w = float(wn * 0.5);
  const fw = fwidth(q);
  const cov = vec2(1, 1).sub(smoothstep(w.sub(fw), w.add(fw), d));
  let line = max(cov.x, cov.y);
  let avg = 1 - (1 - wn) * (1 - wn);
  if (knot > 0) {
    // Knots: a round blob where the cords cross, `knot` metres across.
    const k = float((knot / cell) * 0.5);
    const kf = max(fw.x, fw.y);
    line = max(line, float(1).sub(smoothstep(k.sub(kf), k.add(kf), length(d))));
    avg += Math.PI * (knot / cell) * (knot / cell) * 0.25;
  }
  const far = saturate(max(fw.x, fw.y).mul(2.5).sub(0.6));
  // Unlit: the wires are thin and dark, so lighting them changes nothing visible, and the fence covers a lot
  // of screen; a lit transparent material here cost more than half the frame at 4K.
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  m.colorNode = color(tint);
  m.opacityNode = mix(line, float(Math.min(1, avg * 2.2)), far).mul(strength);
  return m;
}

export function buildCourtView(court: Court): THREE.Group {
  const g = new THREE.Group();
  g.name = 'court';
  const { halfW, def } = court;

  // Surroundings and playing surface.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(def.width + 16, def.length + 16),
    new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.95 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.005;
  apron.receiveShadow = true;
  g.add(apron);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(def.width, def.length),
    new THREE.MeshStandardMaterial({ color: 0x2a5d9c, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Lines: service lines and the centre service line (extends 20 cm past each service line). One mesh.
  const lw = def.lineWidth;
  const sl = def.serviceLineFromNet;
  const lines = new QuadBatch();
  for (const s of [1, -1]) {
    lines.flat(-halfW, halfW, s * sl - lw / 2, s * sl + lw / 2, LINE_Y);
    const len = sl + def.centreLineExtension;
    lines.flat(-lw / 2, lw / 2, Math.min(0, s * len), Math.max(0, s * len), LINE_Y);
  }
  g.add(lines.mesh(new THREE.MeshBasicMaterial({ color: 0xf2f2f2 })));

  // Glass and mesh: one merged mesh each.
  const glass = new QuadBatch();
  const mesh = new QuadBatch();
  for (const p of court.panels) {
    if (p.kind === SURF_GLASS) glass.wall(court, p);
    else if (p.kind === SURF_MESH) mesh.wall(court, p);
  }
  const glassMesh = glass.mesh(new THREE.MeshStandardMaterial({
    color: 0xcfe9e2, transparent: true, opacity: 0.13, roughness: 0.04, metalness: 0.1,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  glassMesh.renderOrder = 3;
  g.add(glassMesh);

  // Welded mesh: rhomboid holes about 6 cm across the diagonal (FIP: 5-7.08 cm), 2.8 mm wire.
  const fence = mesh.mesh(wireMaterial(0.045, 0.0028, true, 0x202326, 1));
  fence.renderOrder = 2;
  g.add(fence);

  // Steel frame: posts, rails, door frames and glass clamps, all one instanced mesh.
  const frame = new FrameBuilder();
  buildFrame(court, frame);
  g.add(frame.mesh());

  // The net itself is render/netView.ts (it moves with the ball).
  return g;
}

/** Posts, rails, door frames and clamps for a framed (posts) or frameless (panoramic) court. */
function buildFrame(court: Court, f: FrameBuilder): void {
  const { halfW, halfL, def } = court;
  const framed = def.frame === 'posts';
  const bw = def.backWall;
  const segs = def.sideWall.segments;
  const o = POST / 2;

  for (const s of [1, -1]) {
    const zb = s * (halfL + o); // posts sit just outside the glass line
    // Back wall: corner posts and (framed) a post at every glass seam; rails at the glass top and the enclosure top.
    for (const x of [-halfW - o, ...court.seams[WALL_BACK_NEAR]!, halfW + o]) {
      if (framed || Math.abs(x) > halfW) f.box(x, bw.top / 2, zb, POST, bw.top, POST);
    }
    f.box(0, bw.top, zb, def.width + POST * 2, RAIL, RAIL);
    f.box(0, bw.glassHeight, zb, def.width, RAIL, RAIL * 0.8);
    if (!framed) {
      clamps(f, -halfW, halfW, bw.glassPanelWidth, bw.glassHeight, (u, y) => f.box(u, y, s * (halfL + 0.015), 0.07, 0.1, 0.03));
    }

    for (const side of [-1, 1]) {
      const xp = side * (halfW + o);
      // Posts at segment boundaries and every 2 m along the mesh, as tall as the enclosure there.
      for (const zSeam of court.seams[WALL_SIDE_LEFT]!) {
        if (Math.sign(zSeam) !== s) continue;
        const fromBack = halfL - Math.abs(zSeam);
        if (!framed && fromBack < 4.01) continue;
        const h = sideTop(court, fromBack);
        f.box(xp, h / 2, zSeam, POST, h, POST);
      }
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]!;
        const zA = s * (halfL - seg.from);
        const zB = s * (halfL - seg.to);
        const zc = (zA + zB) / 2;
        const len = Math.abs(zA - zB);
        f.box(xp, seg.top, zc, RAIL, RAIL, len); // top rail
        if (seg.glassHeight > 0 && seg.glassHeight < seg.top) f.box(xp, seg.glassHeight, zc, RAIL * 0.8, RAIL, len);
        if (seg.glassHeight === 0) f.box(xp, 0.03, zc, RAIL * 0.8, 0.06, len); // mesh panel bottom frame
        if (!framed && seg.glassHeight > 0) {
          clamps(f, Math.min(zA, zB), Math.max(zA, zB), 2, seg.glassHeight, (u, y) => f.box(side * (halfW + 0.015), y, u, 0.03, 0.1, 0.07));
        }
        // Step between enclosure heights.
        const prev = segs[i - 1];
        if (prev && prev.top !== seg.top) f.box(xp, (prev.top + seg.top) / 2, zA, POST, Math.abs(prev.top - seg.top), POST);
      }
      // Door openings: jambs and a lintel at the opening height.
      for (const op of court.openings) {
        const top = sideTop(court, halfL - op.z1);
        if (op.z0 > 0) f.box(xp, top / 2, s * op.z0, POST, top, POST);
        f.box(xp, top / 2, s * op.z1, POST, top, POST);
        f.box(xp, op.height, s * (op.z0 + op.z1) / 2, RAIL, RAIL, op.z1 - op.z0);
      }
    }
  }
  // Net posts: square tube on a base plate, a cap with the cable eye, and the winder on the right-hand post
  // (a housing outside the court with a crank handle).
  const ps = def.net.postSize;
  const ph = def.net.postHeight;
  for (const x of [-halfW, halfW]) {
    f.box(x, ph / 2, 0, ps, ph, ps);
    f.box(x, ph + 0.008, 0, ps + 0.012, 0.016, ps + 0.012);
    f.box(x, 0.005, 0, ps + 0.1, 0.01, ps + 0.1);
  }
  const wx = halfW + ps / 2;
  f.box(wx + 0.03, 0.62, 0, 0.06, 0.13, 0.07);
  f.box(wx + 0.068, 0.62, 0, 0.016, 0.016, 0.016);
  f.box(wx + 0.076, 0.62, 0.035, 0.012, 0.012, 0.07);
  f.box(wx + 0.09, 0.62, 0.07, 0.03, 0.014, 0.014);
}

/** Two clamps per glass joint (frameless courts hold the panels with clamps, not posts). */
function clamps(f: FrameBuilder, u0: number, u1: number, panel: number, height: number, put: (u: number, y: number) => void): void {
  const n = Math.max(1, Math.round((u1 - u0) / panel));
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    put(u, 0.3);
    put(u, height - 0.3);
  }
  void f;
}

function sideTop(court: Court, fromBack: number): number {
  let top = 0;
  for (const s of court.def.sideWall.segments) {
    if (fromBack >= s.from - 1e-6 && fromBack <= s.to + 1e-6) top = Math.max(top, s.top);
  }
  return top;
}

/** Collects axis-aligned boxes and emits them as one instanced mesh. */
class FrameBuilder {
  private readonly items: number[] = [];

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.items.push(x, y, z, sx, sy, sz);
  }

  mesh(): THREE.InstancedMesh {
    const n = this.items.length / 6;
    const m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.42, metalness: 0.55 }),
      n,
    );
    const mat = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      mat.makeScale(this.items[k + 3]!, this.items[k + 4]!, this.items[k + 5]!);
      mat.setPosition(this.items[k]!, this.items[k + 1]!, this.items[k + 2]!);
      m.setMatrixAt(i, mat);
    }
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** Builds one merged mesh out of many quads, with UVs in metres (for the wire shader). */
class QuadBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uvs: number[] = [];

  private quad(a: number[], b: number[], c: number[], d: number[], n: number[], t: number[]): void {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) this.nor.push(...n);
    this.uvs.push(t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!, t[0]!, t[1]!, t[4]!, t[5]!, t[6]!, t[7]!);
  }

  flat(x0: number, x1: number, z0: number, z1: number, y: number): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0, z1, x1, z1, x1, z0, x0, z0]);
  }

  wall(court: Court, p: Panel): void {
    const { halfW, halfL } = court;
    const t = [p.u0, p.y0, p.u1, p.y0, p.u1, p.y1, p.u0, p.y1];
    if (p.wall === WALL_BACK_NEAR || p.wall === WALL_BACK_FAR) {
      const z = p.wall === WALL_BACK_NEAR ? halfL : -halfL;
      this.quad([p.u0, p.y0, z], [p.u1, p.y0, z], [p.u1, p.y1, z], [p.u0, p.y1, z], [0, 0, 1], t);
    } else {
      const x = p.wall === WALL_SIDE_RIGHT ? halfW : -halfW;
      this.quad([x, p.y0, p.u0], [x, p.y0, p.u1], [x, p.y1, p.u1], [x, p.y1, p.u0], [1, 0, 0], t);
    }
  }

  mesh(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    return new THREE.Mesh(geo, material);
  }
}
