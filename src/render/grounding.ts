// Contact shadows: what the key light's shadow map can't give a body standing on the floor.
//
// The key is high over the court (data/arenas.json light.key), so a standing player's shadow falls under them and the
// map's 1.4 cm texels lose it round the shoes: the feet read as floating. Under a real arena's dozens of floods a shoe
// darkens the floor where it presses, and a body shuts out light from every side round its feet (ambient occlusion).
// So per foot, a soft ellipse under its sole points that shrinks to whichever end is still down and fades as the foot
// lifts; per body, a broad patch round the feet, under the hips, that fades as the body leaves the floor.
// Every player's patches are one instanced draw; nothing is allocated per frame. Off unless `?ground=1` until the
// owner has seen it (main.ts).
import * as THREE from 'three/webgpu';
import { clamp, dot, float, instancedDynamicBufferAttribute, pow, uv, vec3 } from 'three/tsl';
import type { Avatar } from './avatar/avatar.ts';

/** Height the patches are drawn at (m): over the court (0) and under the ball's own shadow (0.003). */
const Y = 0.0025;
/** A foot pressed flat: its shadow's darkness, how far past the sole it spreads (m) and how sharply its edge falls. */
const FOOT_DARK = 0.78;
const FOOT_PAD = 0.045;
const FOOT_EDGE = 1.8;
/** A sole point this high (m) casts nothing; the spread a lifted foot's shadow gains (m) on the way there. */
const FOOT_LIFT = 0.12;
const FOOT_BLUR = 0.05;
/** How much of the foot's length a lifted heel (or toe) takes off its end of the shadow. */
const FOOT_ROLL = 0.6;
/** The body's occlusion standing: darkness, its reach round the feet across and along the stance (m), its edge. */
const BODY_DARK = 0.45;
const BODY_ACROSS = 0.32;
const BODY_ALONG = 0.26;
const BODY_EDGE = 1.3;
/** Lowest sole this high (m): the body's patch has gone (a jump's). How far it follows the hips over the feet. */
const BODY_LIFT = 0.55;
const BODY_HIPS = 0.5;

/** A player as the grounding reads them: their avatar (null: the capsules) and the root shown or hidden. */
export interface Grounded { readonly avatar: Avatar | null; readonly root: THREE.Object3D }

export class Grounding {
  /** `?ground=1` (main.ts). */
  static on = false;
  readonly mesh: THREE.InstancedMesh;
  /** Per patch: darkness and the edge's exponent. */
  private readonly shade: THREE.InstancedBufferAttribute;
  private readonly hips: Array<THREE.Object3D | null>;
  private readonly bodies: readonly Grounded[];

  constructor(scene: THREE.Scene, bodies: readonly Grounded[]) {
    this.bodies = bodies;
    const n = this.bodies.length * 3;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.shade = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.shade.setUsage(THREE.DynamicDrawUsage);
    const s = instancedDynamicBufferAttribute(this.shade, 'vec2') as unknown as THREE.Node<'vec2'>;
    const p = uv().sub(0.5).mul(2);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.colorNode = vec3(0, 0, 0);
    mat.opacityNode = s.x.mul(pow(clamp(float(1).sub(dot(p, p)), 0, 1), s.y));
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'grounding';
    this.hips = this.bodies.map((b) => b.avatar?.root.getObjectByName('Hips') ?? null);
    scene.add(this.mesh);
  }

  /** After the players' poses this frame. */
  update(): void {
    const M = this.mesh.instanceMatrix.array as Float32Array;
    const S = this.shade.array as Float32Array;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      const av = b.avatar;
      const at = i * 3;
      if (!av || !b.root.visible) {
        S[at * 2] = 0; S[at * 2 + 2] = 0; S[at * 2 + 4] = 0;
        continue;
      }
      const W = av.soleWorld;
      // The body first (drawn under the feet), from the feet's centres and the hips.
      let cx0 = 0, cz0 = 0, cx1 = 0, cz1 = 0, low = Infinity;
      for (let k = 0; k < 4; k++) {
        cx0 += W[k * 3]!; cz0 += W[k * 3 + 2]!;
        cx1 += W[12 + k * 3]!; cz1 += W[12 + k * 3 + 2]!;
        const y0 = W[k * 3 + 1]!, y1 = W[12 + k * 3 + 1]!;
        if (y0 < low) low = y0;
        if (y1 < low) low = y1;
      }
      cx0 *= 0.25; cz0 *= 0.25; cx1 *= 0.25; cz1 *= 0.25;
      let mx = (cx0 + cx1) * 0.5, mz = (cz0 + cz1) * 0.5;
      const h = this.hips[i];
      if (h) {
        const e = h.matrixWorld.elements;
        mx += (e[12]! - mx) * BODY_HIPS;
        mz += (e[14]! - mz) * BODY_HIPS;
      }
      let ax = cx1 - cx0, az = cz1 - cz0;
      const span = Math.sqrt(ax * ax + az * az);
      if (span > 1e-4) { ax /= span; az /= span; } else { ax = 1; az = 0; }
      // Long along the stance's line.
      put(M, at, mx, mz, ax, az, 2 * BODY_ACROSS, span + 2 * BODY_ALONG);
      const up = Math.max(0, low);
      S[at * 2] = BODY_DARK * clamp01(1 - up / BODY_LIFT);
      S[at * 2 + 1] = BODY_EDGE;
      for (let f = 0; f < 2; f++) this.foot(M, S, at + 1 + f, W, f * 12);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shade.needsUpdate = true;
  }

  /** One foot's shadow from its sole points at W[o...]: heel, toe tip, the two edges. */
  private foot(M: Float32Array, S: Float32Array, at: number, W: Float64Array, o: number): void {
    const hx = W[o]!, hy = W[o + 1]!, hz = W[o + 2]!;
    const tx = W[o + 3]!, ty = W[o + 4]!, tz = W[o + 5]!;
    let dx = tx - hx, dz = tz - hz;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) { S[at * 2] = 0; return; }
    dx /= len; dz /= len;
    // Width: the edges apart, across the foot's line.
    const wid = Math.abs((W[o + 6]! - W[o + 9]!) * dz - (W[o + 8]! - W[o + 11]!) * dx);
    const eY = Math.min(W[o + 7]!, W[o + 10]!);
    const wh = clamp01(1 - Math.max(0, hy) / FOOT_LIFT);
    const wt = clamp01(1 - Math.max(0, ty) / FOOT_LIFT);
    const we = clamp01(1 - Math.max(0, eY) / FOOT_LIFT);
    const down = Math.max(wh, wt, we);
    if (down <= 0) { S[at * 2] = 0; return; }
    // A lifted heel takes the back of the shadow towards the toes, a lifted toe the front towards the heel.
    const s0 = len * FOOT_ROLL * (1 - wh) * (wt > 0 ? 1 : 0.5);
    const s1 = len - len * FOOT_ROLL * (1 - wt) * (wh > 0 ? 1 : 0.5);
    const mid = (s0 + s1) * 0.5;
    const pad = FOOT_PAD + FOOT_BLUR * (1 - down);
    put(M, at, hx + dx * mid, hz + dz * mid, dx, dz, wid + 2 * pad, Math.max(0.02, s1 - s0) + 2 * pad);
    S[at * 2] = FOOT_DARK * down * (0.6 + 0.4 * down);
    S[at * 2 + 1] = FOOT_EDGE;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Instance `at`: centred on (x, z), its local z along (dx, dz) (unit), `across` wide and `along` long. */
function put(M: Float32Array, at: number, x: number, z: number, dx: number, dz: number, across: number, along: number): void {
  const o = at * 16;
  // Columns: local x = (dz, 0, -dx) * across, y up, local z = (dx, 0, dz) * along.
  M[o] = dz * across; M[o + 1] = 0; M[o + 2] = -dx * across; M[o + 3] = 0;
  M[o + 4] = 0; M[o + 5] = 1; M[o + 6] = 0; M[o + 7] = 0;
  M[o + 8] = dx * along; M[o + 9] = 0; M[o + 10] = dz * along; M[o + 11] = 0;
  M[o + 12] = x; M[o + 13] = Y; M[o + 14] = z; M[o + 15] = 1;
}
