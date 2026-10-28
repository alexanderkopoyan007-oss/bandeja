// The net, drawn from the sim's cloth (src/sim/court/netCloth.ts): every knot the physics moves, the picture
// moves. The knots (about 100 x 10, one every 10 cm) go into a small float texture each frame, blended between
// the last two ticks; a finer grid samples it in the vertex shader with Catmull-Rom interpolation, so the
// netting bends smoothly between knots. The tape is a ribbon on the cable row, tilting with the netting under
// it. Knotted black cord in 4.5 cm squares with a black binding (the wire pattern sits in rest-space metres,
// so the squares stretch and fold with the cloth). Rendering only reads the sim.
import * as THREE from 'three/webgpu';
import { attribute, textureLoad, ivec2, int, floor, clamp, vec3, normalize, max, smoothstep, uv } from 'three/tsl';
import type { MatchSim } from '../sim/match.ts';
import type { NetCloth } from '../sim/court/netCloth.ts';
import { wireMaterial } from './courtView.ts';

type Node<T extends string> = THREE.Node<T>;

const SUB_X = 3; // render vertices per knot gap along the net
const SUB_Y = 3; // and down it
const TAPE_ABOVE = 0.012; // tape top above the cable centre (the top of the net)
const TAPE_THICK = 0.006; // half thickness of the tape

export class NetView {
  readonly group = new THREE.Group();
  private readonly cloth: NetCloth;
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private synced = false;

  /** The knot texture lives in the vertex shader's nodes, out of reach of render/dispose.ts. */
  dispose(): void {
    this.tex.dispose();
  }

  constructor(cloth: NetCloth) {
    this.cloth = cloth;
    const nx = cloth.nx;
    const ny = cloth.rows + 1;
    this.data = new Float32Array(nx * ny * 4);
    this.tex = new THREE.DataTexture(this.data, nx, ny, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.fill(1);

    // Netting: a fine grid in knot coordinates (gu along, gv down); uv in rest-space metres for the pattern.
    const cols = cloth.cols;
    const rows = cloth.rows;
    const RX = cols * SUB_X;
    const RY = rows * SUB_Y;
    const n = (RX + 1) * (RY + 1);
    const gu = new Float32Array(n);
    const gv = new Float32Array(n);
    const pos = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const rest = cloth.rest;
    let k = 0;
    for (let i = 0; i <= RX; i++) {
      for (let j = 0; j <= RY; j++) {
        const u = i / SUB_X;
        const v = j / SUB_Y;
        gu[k] = u;
        gv[k] = v;
        // Rest position (for the bounds and the pattern): bilinear in the rest knots.
        const i0 = Math.min(cols - 1, Math.floor(u));
        const j0 = Math.min(rows - 1, Math.floor(v));
        const fu = u - i0;
        const fv = v - j0;
        for (let c = 0; c < 3; c++) {
          const a = rest[(j0 * nx + i0) * 3 + c]!;
          const b = rest[(j0 * nx + i0 + 1) * 3 + c]!;
          const d = rest[((j0 + 1) * nx + i0) * 3 + c]!;
          const e = rest[((j0 + 1) * nx + i0 + 1) * 3 + c]!;
          pos[k * 3 + c] = (a * (1 - fu) + b * fu) * (1 - fv) + (d * (1 - fu) + e * fu) * fv;
        }
        uvs[k * 2] = pos[k * 3]! + cloth.halfW;
        uvs[k * 2 + 1] = pos[k * 3 + 1]!;
        k++;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < RX; i++) {
      for (let j = 0; j < RY; j++) {
        const a = i * (RY + 1) + j;
        const b = a + RY + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('gu', new THREE.BufferAttribute(gu, 1));
    geo.setAttribute('gv', new THREE.BufferAttribute(gv, 1));
    geo.setIndex(idx);
    const mat = wireMaterial(0.045, 0.0032, false, 0x0d0e10, 1, 0.009);
    // Binding: black tape down both ends and along the bottom edge.
    const W = cloth.halfW * 2;
    const t = uv();
    const bind = max(smoothstep(0.03, 0.02, t.y), max(smoothstep(0.035, 0.025, t.x), smoothstep(W - 0.035, W - 0.025, t.x)));
    mat.opacityNode = max(mat.opacityNode as Node<'float'>, bind);
    mat.positionNode = this.sample(attribute('gu', 'float'), attribute('gv', 'float'));
    const net = new THREE.Mesh(geo, mat);
    net.renderOrder = 4;
    net.frustumCulled = false;
    this.group.add(net);

    // Tape: per sample along the cable, a front and a back face and a top, from TAPE_ABOVE over the cable down
    // the tape's height along the netting.
    const TS = cols * SUB_X;
    const tu: number[] = [];
    const side: number[] = [];
    const down: number[] = [];
    const tpos: number[] = [];
    const tnrm: number[] = [];
    const tidx: number[] = [];
    const corners: Array<[number, number, number, number, number]> = [
      // side, down, normal x y z
      [1, 0, 0, 0, 1], [1, 1, 0, 0, 1], [-1, 0, 0, 0, -1], [-1, 1, 0, 0, -1], [1, 0, 0, 1, 0], [-1, 0, 0, 1, 0],
    ];
    for (let i = 0; i <= TS; i++) {
      const u = i / SUB_X;
      const i0 = Math.min(cols - 1, Math.floor(u));
      const f = u - i0;
      const y = rest[i0 * 3 + 1]! * (1 - f) + rest[(i0 + 1) * 3 + 1]! * f;
      const x = rest[i0 * 3]! * (1 - f) + rest[(i0 + 1) * 3]! * f;
      for (const [s, d, nx_, ny_, nz_] of corners) {
        tu.push(u);
        side.push(s);
        down.push(d);
        tpos.push(x, y + TAPE_ABOVE - d * cloth.spec.tapeHeight, s * TAPE_THICK);
        tnrm.push(nx_, ny_, nz_);
      }
    }
    for (let i = 0; i < TS; i++) {
      const a = i * 6;
      const b = a + 6;
      tidx.push(a, a + 1, b, b, a + 1, b + 1); // front
      tidx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // back
      tidx.push(a + 4, b + 4, a + 5, a + 5, b + 4, b + 5); // top
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
    tgeo.setAttribute('normal', new THREE.Float32BufferAttribute(tnrm, 3));
    tgeo.setAttribute('gu', new THREE.Float32BufferAttribute(tu, 1));
    tgeo.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
    tgeo.setAttribute('down', new THREE.Float32BufferAttribute(down, 1));
    tgeo.setIndex(tidx);
    const tmat = new THREE.MeshStandardNodeMaterial({ color: 0xf5f5f5, roughness: 0.7, side: THREE.DoubleSide });
    const g = attribute('gu', 'float');
    const cable = this.sample(g, 0);
    const below = this.sample(g, 1);
    const dir = normalize(below.sub(cable));
    const top = cable.sub(dir.mul(TAPE_ABOVE));
    const tapeLen = cloth.spec.tapeHeight;
    tmat.positionNode = top
      .add(dir.mul(attribute('down', 'float').mul(tapeLen)))
      .add(vec3(0, 0, attribute('side', 'float').mul(TAPE_THICK)));
    const tape = new THREE.Mesh(tgeo, tmat);
    tape.castShadow = true;
    tape.frustumCulled = false;
    this.group.add(tape);
  }

  /** Smooth position on the cloth at knot coordinates (gu along, gv down): Catmull-Rom over 4 x 4 knots. */
  private sample(gu: Node<'float'>, gv: Node<'float'> | number) {
    const cols = this.cloth.cols;
    const rows = this.cloth.rows;
    const v = typeof gv === 'number' ? null : gv;
    const iu = floor(gu);
    const tu = gu.sub(iu);
    const wu = catmullRom(tu);
    let ivn: Node<'float'> | null = null;
    let wv: Array<Node<'float'>> | null = null;
    if (v) {
      ivn = floor(v);
      wv = catmullRom(v.sub(ivn));
    }
    let acc: Node<'vec3'> = vec3(0, 0, 0);
    for (let b = 0; b < (v ? 4 : 1); b++) {
      const y = v ? int(clamp(ivn!.add(b - 1), 0, rows)) : int(gv as number);
      let row: Node<'vec3'> = vec3(0, 0, 0);
      for (let a = 0; a < 4; a++) {
        const x = int(clamp(iu.add(a - 1), 0, cols));
        row = row.add(textureLoad(this.tex, ivec2(x, y)).xyz.mul(wu[a]!));
      }
      acc = v ? acc.add(row.mul(wv![b]!)) : row;
    }
    return acc;
  }

  /** Write knot positions blended `alpha` of the way from the last tick to this one. */
  private fill(alpha: number): void {
    const c = this.cloth;
    const p = c.pos;
    const q = c.prev;
    const d = this.data;
    const n = c.n;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const o = i * 4;
      d[o] = q[k]! + (p[k]! - q[k]!) * alpha;
      d[o + 1] = q[k + 1]! + (p[k + 1]! - q[k + 1]!) * alpha;
      d[o + 2] = q[k + 2]! + (p[k + 2]! - q[k + 2]!) * alpha;
      d[o + 3] = 1;
    }
    this.tex.needsUpdate = true;
  }

  /** Once a frame: the knots as they are at the render time (alpha between the last two ticks). */
  update(_sim: MatchSim, alpha: number): void {
    const c = this.cloth;
    if (c.awake) {
      this.fill(alpha);
      this.synced = false;
    } else if (!this.synced) {
      this.fill(1);
      this.synced = true;
    }
  }
}

/** Catmull-Rom weights for the four taps around a fraction t. */
function catmullRom(t: Node<'float'>): Array<Node<'float'>> {
  const t2 = t.mul(t);
  const t3 = t2.mul(t);
  return [
    t3.negate().add(t2.mul(2)).sub(t).mul(0.5),
    t3.mul(3).sub(t2.mul(5)).add(2).mul(0.5),
    t3.mul(-3).add(t2.mul(4)).add(t).mul(0.5),
    t3.sub(t2).mul(0.5),
  ];
}
