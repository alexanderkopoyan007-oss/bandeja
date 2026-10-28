// The court built from the sim's Court geometry: floor and lines, glass, the welded wire mesh, the steel
// frame (posts, rails, door frames, clamps) and the net. Rendering only reads the sim.
// Draw calls stay low: glass and mesh are each one merged mesh, the whole frame is one instanced mesh.
import * as THREE from 'three/webgpu';
import {
  uv, vec2, vec3, float, fract, min, max, fwidth, smoothstep, mix, saturate, color, length, positionWorld, cameraPosition,
  normalWorld, normalize, dot, abs, pow, texture, pmremTexture, reflectVector,
} from 'three/tsl';
import {
  Court, SURF_GLASS, SURF_MESH,
  WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, type Panel,
} from '../sim/court/court.ts';

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

export interface CourtLook {
  /** Posts, rails and door frames (sRGB hex). */
  frame: string;
  /** The steel the glass stands on (panoramic courts show it as a pale line round the court). */
  base: string;
}

/** The arena's baked environment and where it was captured, for parallax-corrected reflections. */
export interface EnvProbe {
  texture: THREE.Texture;
  /** Where the cube map was rendered from. */
  at: THREE.Vector3;
  /** The box the reflections are projected onto (the hall's walls, or a box round an outdoor club). */
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Scales the reflection (the arena's environment intensity: low at night). */
  intensity: number;
}

export interface CourtView {
  group: THREE.Group;
  /** Hand the glass the arena's baked environment (Arena.bakeEnvironment) for its reflections. */
  setEnvironment(env: EnvProbe): void;
}

export function buildCourtView(court: Court, look: CourtLook = { frame: '#1b1e21', base: '#1b1e21' }): CourtView {
  const g = new THREE.Group();
  g.name = 'court';

  // Glass and mesh: one merged mesh each.
  const glass = new QuadBatch();
  const mesh = new QuadBatch();
  for (const p of court.panels) {
    if (p.kind === SURF_GLASS) glass.wall(court, p);
    else if (p.kind === SURF_MESH) mesh.wall(court, p);
  }
  const glassMat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  glassLook(glassMat, null);
  const glassMesh = glass.mesh(glassMat);
  glassMesh.renderOrder = 3;
  g.add(glassMesh);

  // Welded mesh: rhomboid holes about 6 cm across the diagonal (FIP: 5-7.08 cm), 2.8 mm wire.
  const fence = mesh.mesh(wireMaterial(0.045, 0.0028, true, 0x202326, 1));
  fence.renderOrder = 2;
  g.add(fence);

  // Steel frame: posts, rails, door frames and glass clamps, all one instanced mesh.
  const frame = new FrameBuilder();
  buildFrame(court, frame);
  g.add(frame.mesh(look.frame));
  // The base the glass stands on: a flat steel channel along the foot of every glass panel.
  const base = new FrameBuilder();
  for (const p of court.panels) {
    if (p.kind !== SURF_GLASS || p.y0 > 0.01) continue;
    const back = p.wall === WALL_BACK_NEAR || p.wall === WALL_BACK_FAR;
    const out = back ? (p.wall === WALL_BACK_NEAR ? 1 : -1) * (court.halfL + 0.02) : (p.wall === WALL_SIDE_RIGHT ? 1 : -1) * (court.halfW + 0.02);
    const mid = (p.u0 + p.u1) / 2, len = p.u1 - p.u0;
    if (back) base.box(mid, 0.035, out, len, 0.07, 0.1);
    else base.box(out, 0.035, mid, 0.1, 0.07, len);
  }
  g.add(base.mesh(look.base, 0.5, 0.35));

  // The net itself is render/netView.ts (it moves with the ball).
  return { group: g, setEnvironment: (env) => glassLook(glassMat, env) };
}

let smudgeTex: THREE.CanvasTexture | null = null;

/**
 * Ball marks, smears and dust on the glass, one tile per 4 m x 3 m of wall (uv in metres): felt marks where balls
 * hit (round, 6-7 cm, most between knee and head height), wipe streaks, and the dirty band along the foot.
 */
function smudges(): THREE.CanvasTexture {
  if (smudgeTex) return smudgeTex;
  const W = 1024, H = 768;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let s = 77;
  const r = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pxm = W / 4; // pixels per metre
  // Ball prints: felt leaves a faint ring-shaped print, smeared a little along the way the ball skidded (mostly
  // sideways and down), at the heights balls meet the glass. Faint: they show against light, not everywhere.
  for (let i = 0; i < 46; i++) {
    const x = r() * W;
    const hgt = 0.35 + Math.pow(r(), 1.3) * 2.3;
    const y = H - hgt * pxm;
    const rad = (0.03 + r() * 0.006) * pxm;
    const a = 0.03 + r() * 0.07;
    const smear = 1 + r() * 1.4;
    g.save();
    g.translate(x, y);
    g.rotate((r() - 0.5) * 1.2);
    g.scale(smear, 1);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rad * 1.3);
    grd.addColorStop(0, `rgba(255,255,255,${a * 0.45})`);
    grd.addColorStop(0.6, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.8, `rgba(255,255,255,${a * 0.5})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, rad * 1.3, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // Wipe streaks: long soft arcs.
  g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
    g.lineWidth = 10 + r() * 30;
    const x = r() * W, y = H * (0.3 + r() * 0.6);
    g.beginPath(); g.arc(x, y + 200, 200 + r() * 200, -2.2, -0.9); g.stroke();
  }
  // Dust along the foot.
  const dust = g.createLinearGradient(0, H, 0, H - 0.35 * pxm);
  dust.addColorStop(0, 'rgba(255,255,255,0.22)');
  dust.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = dust;
  g.fillRect(0, H - 0.35 * pxm, W, 0.35 * pxm);
  smudgeTex = new THREE.CanvasTexture(c);
  smudgeTex.wrapS = smudgeTex.wrapT = THREE.RepeatWrapping;
  smudgeTex.anisotropy = 8;
  return smudgeTex;
}

/**
 * Glass: 10-12 mm tempered panels. What you see is mostly what is behind them; the rest is the arena reflected
 * by Fresnel (about 8% straight on for two faces, rising towards grazing angles), a faint green in the
 * reflection from the glass's iron, and the marks on it. Unlit and blended: reflection + smudges over the scene.
 */
function glassLook(m: THREE.MeshBasicNodeMaterial, env: EnvProbe | null): void {
  const view = normalize(cameraPosition.sub(positionWorld));
  const cosT = abs(dot(normalWorld, view));
  const fres = float(0.08).add(float(0.92).mul(pow(float(1).sub(cosT), 5)));
  const marks = texture(smudges(), uv().div(vec2(4, 3)).add(vec2(0, 0))).a;
  const tint = vec3(0.9, 1.0, 0.95);
  let refl: THREE.Node<'vec3'> = vec3(0.6, 0.65, 0.68).mul(tint);
  if (env) {
    // Box-projected: follow the reflected ray to the arena's box and look the hit point up from where the probe
    // was rendered. A plain lookup sees everything from the court's centre, so the near back glass "reflected" the
    // floodlit court at night instead of the dark park behind the camera.
    const r = reflectVector;
    const lo = vec3(env.min.x, env.min.y, env.min.z), hi = vec3(env.max.x, env.max.y, env.max.z);
    const t1 = hi.sub(positionWorld).div(r), t2 = lo.sub(positionWorld).div(r);
    const tf = max(t1, t2);
    const t = min(min(tf.x, tf.y), tf.z);
    const dir = positionWorld.add(r.mul(t)).sub(vec3(env.at.x, env.at.y, env.at.z));
    refl = pmremTexture(env.texture, dir, float(0.04)).rgb.mul(tint).mul(env.intensity);
  }
  // Marks fade with distance (seen from the stands the glass is all but invisible; the marks show close to it).
  const near = float(1).sub(smoothstep(4, 14, cameraPosition.sub(positionWorld).length()));
  const haze = marks.mul(0.5).mul(near.mul(0.85).add(0.15));
  m.colorNode = mix(refl, color(0xc9cfd3), saturate(haze.div(fres.add(haze).add(1e-4))));
  m.opacityNode = saturate(fres.add(haze).add(0.02));
  m.needsUpdate = true;
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

  mesh(colour: string, roughness = 0.42, metalness = 0.55): THREE.InstancedMesh {
    const n = this.items.length / 6;
    const m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: colour, roughness, metalness }),
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
