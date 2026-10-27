// The net: knotted black cord with a white tape over the cable, moving with the ball.
// - A ball caught in the net (the sim's `Ball.inNet`) pushes a pocket into it: the net surface at the ball is the
//   ball's far face, spread by a bell that widens with depth, pinned at the posts, held up by the cable.
// - When the ball comes out, the net keeps going and rings down with the same spring the sim used for the catch
//   (`Ball.netW`, `Ball.netZeta`).
// - A ball off the tape (E_NET a=1), a post (a=2) or, weaker, the body (a=0) sets the tape shaking.
// One vertex displacement drives both meshes, from uniforms set once a frame. Rendering only reads the sim.
import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, uniform, exp, abs, float, vec3, mix, smoothstep, saturate, max, select, uv } from 'three/tsl';
import type { Court } from '../sim/court/court.ts';
import { E_NET, type MatchSim } from '../sim/match.ts';
import { wireMaterial } from './courtView.ts';

type Node<T extends string> = THREE.Node<T>;

const NX = 125; // 8 cm columns: the pocket is at least 16 cm across
const NY = 14;
const TAPE_R = 0.028; // tape: 5.6 cm tall over the cable
const TAPE_FLAT = 0.22; // and about 1.2 cm thick
const PIN = 0.35; // the net is free to move this far from the posts
const WOBBLE_FOR = 1.5; // seconds a released net rings before it is left at rest

export class NetView {
  readonly group = new THREE.Group();
  /** x, y of the pocket's centre, z offset of the net there (amplitude), width (sigma). */
  private readonly bulge = uniform(new THREE.Vector4(0, 0.4, 0, 0.3));
  /** x of the tape shake, z and y offsets, width. */
  private readonly tape = uniform(new THREE.Vector4(0, 0, 0, 1.4));
  private readonly halfW: number;
  private readonly radius: number;
  private seen = 0;
  // The catch in progress, and the ring-down after it.
  private wasIn = false;
  private side = 1;
  private bx = 0;
  private by = 0.4;
  private depth = 0;
  private peak = 0;
  private relT = -1;
  private relD = 0;
  private relV = 0;
  private w = 39;
  private zeta = 0.55;
  // The tape shake.
  private tapeT = -1;
  private tapeA = 0;
  private tapeX = 0;
  private tapeDir = 1;

  private readonly court: Court;

  constructor(court: Court, radius: number) {
    this.court = court;
    this.halfW = court.halfW;
    this.radius = radius;
    const W = court.def.width;

    // Net body: a grid fine enough to bend. UVs in metres for the wire pattern; `netRel` is the height as a
    // fraction of the net there (0 at the floor, 1 at the cable).
    const pos = new Float32Array((NX + 1) * (NY + 1) * 3);
    const uvs = new Float32Array((NX + 1) * (NY + 1) * 2);
    const rel = new Float32Array((NX + 1) * (NY + 1));
    let k = 0;
    for (let i = 0; i <= NX; i++) {
      const x = -this.halfW + (i / NX) * W;
      const h = court.netHeightAt(x);
      for (let j = 0; j <= NY; j++) {
        const v = j / NY;
        pos[k * 3] = x; pos[k * 3 + 1] = v * h; pos[k * 3 + 2] = 0;
        uvs[k * 2] = x + this.halfW; uvs[k * 2 + 1] = v * h;
        rel[k] = v;
        k++;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const a = i * (NY + 1) + j;
        const b = a + NY + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('netRel', new THREE.BufferAttribute(rel, 1));
    geo.setIndex(idx);

    // Knotted cord in 4.5 cm squares, with a black binding down the ends and along the bottom.
    const mat = wireMaterial(0.045, 0.0032, false, 0x0d0e10, 1, 0.009);
    const u = uv();
    const bind = max(
      smoothstep(0.03, 0.02, u.y),
      max(smoothstep(0.035, 0.025, u.x), smoothstep(W - 0.035, W - 0.025, u.x)),
    );
    mat.opacityNode = max(mat.opacityNode as Node<'float'>, bind);
    mat.positionNode = positionLocal.add(this.displace(attribute('netRel', 'float')));
    const net = new THREE.Mesh(geo, mat);
    net.renderOrder = 4;
    net.frustumCulled = false; // the pocket moves it out of its bounds
    this.group.add(net);

    // Tape: a flattened tube along the cable, moved by the same displacement as the top of the net.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -this.halfW + (i / 40) * W;
      pts.push(new THREE.Vector3(x, court.netHeightAt(x) - TAPE_R, 0));
    }
    const tapeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, TAPE_R, 8, false);
    tapeGeo.scale(1, 1, TAPE_FLAT);
    // Height fractions like the net's, so the cord under the tape moves exactly with it.
    const tp = tapeGeo.getAttribute('position');
    const tapeRel = new Float32Array(tp.count);
    for (let i = 0; i < tp.count; i++) tapeRel[i] = Math.min(1, tp.getY(i) / court.netHeightAt(tp.getX(i)));
    tapeGeo.setAttribute('netRel', new THREE.BufferAttribute(tapeRel, 1));
    const tapeMat = new THREE.MeshStandardNodeMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    tapeMat.positionNode = positionLocal.add(this.displace(attribute('netRel', 'float')));
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.castShadow = true;
    tape.frustumCulled = false;
    this.group.add(tape);
  }

  /** Offset of a point of the net (local position, height fraction `rel`). */
  private displace(rel: Node<'float'>) {
    const B = this.bulge;
    const T = this.tape;
    const hw = this.halfW;
    return Fn(() => {
      const p = positionLocal;
      const edge = saturate(float(hw).sub(abs(p.x)).div(PIN));
      // The pocket: a bell around the ball, longer below it (the bottom of the net is loose) than above it (the
      // cable holds the top); the cable moves about a third as much as the cord.
      const dx = p.x.sub(B.x);
      const dy = p.y.sub(B.y);
      const sy = select(dy.lessThan(0), B.w.mul(1.4), B.w.mul(0.75));
      const g = exp(dx.mul(dx).div(B.w.mul(B.w)).add(dy.mul(dy).div(sy.mul(sy))).negate());
      const held = mix(float(1), float(0.35), smoothstep(0.7, 1, rel));
      const pocket = B.z.mul(g).mul(edge).mul(held);
      // The tape shake, carried down into the top half of the net.
      const tx = p.x.sub(T.x);
      const tg = exp(tx.mul(tx).div(T.w.mul(T.w)).negate()).mul(edge).mul(smoothstep(0.45, 1, rel));
      return vec3(0, T.z.mul(tg), pocket.add(T.y.mul(tg)));
    })();
  }

  /** Once a frame, after the ball view: `ball` is the rendered ball position, `t` the render's sim time. */
  update(sim: MatchSim, ball: THREE.Vector3, t: number): void {
    const b = sim.ball;
    const r = this.radius;
    let z = 0;
    if (b.inNet) {
      // The net's surface at the ball is the ball's far face, while that is past the net's line.
      if (!this.wasIn) { this.peak = 0; this.relT = -1; }
      this.side = b.netSide;
      this.w = b.netW;
      this.zeta = b.netZeta;
      this.bx = ball.x;
      this.by = ball.y;
      const face = ball.z - this.side * r;
      z = this.side * face < 0 ? face : 0;
      this.depth = z;
      this.peak = Math.max(this.peak, Math.abs(z));
    } else if (this.wasIn) {
      // Out of the net: it carries on with the ball's speed (or, if the ball rolled over the top, springs back
      // from where it was) and rings down.
      this.relT = sim.time - 1 / 120;
      this.relD = this.depth;
      this.relV = this.side * b.pos.z > 0 ? b.vel.z : 0;
    }
    this.wasIn = b.inNet;
    if (!b.inNet && this.relT >= 0) {
      const s = t - this.relT;
      if (s > WOBBLE_FOR) this.relT = -1;
      else if (s > 0) {
        const w = this.w;
        const wd = w * Math.sqrt(1 - this.zeta * this.zeta);
        const e = Math.exp(-this.zeta * w * s);
        z = e * (this.relD * Math.cos(wd * s) + ((this.relV + this.zeta * w * this.relD) / wd) * Math.sin(wd * s));
        // The first moments after release: never draw the net through a ball that is still against it.
        const face = ball.z - this.side * r;
        if (Math.abs(ball.x - this.bx) < 0.3 && this.side * face < this.side * z) z = face;
      } else z = this.relD;
    }
    // The pocket's amplitude is the offset at the ball divided by what the pins and the cable take off there.
    const c = this.court;
    const edge = Math.min(1, Math.max(0.25, (this.halfW - Math.abs(this.bx)) / PIN));
    const rel = Math.min(1, Math.max(0, this.by / c.netHeightAt(this.bx)));
    const q = Math.min(1, Math.max(0, (rel - 0.7) / 0.3));
    const held = 1 - 0.65 * q * q * (3 - 2 * q);
    this.bulge.value.set(this.bx, this.by, z / (edge * held), 0.16 + 1.0 * this.peak);

    // Tape: a decaying shake from the latest net contact.
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq < 0 || e.kind !== E_NET) continue;
      const k = e.a === 1 ? 0.0032 : e.a === 2 ? 0.0012 : 0.0008;
      this.tapeA = Math.min(0.05, k * e.c);
      this.tapeX = e.x;
      this.tapeT = e.time;
      this.tapeDir = e.z > 0 ? -1 : 1; // pushed the way the ball was going
    }
    let tz = 0;
    let ty = 0;
    if (this.tapeT >= 0) {
      const s = t - this.tapeT;
      if (s > 1.2) this.tapeT = -1;
      else if (s > 0) {
        tz = this.tapeDir * this.tapeA * Math.exp(-s / 0.3) * Math.sin(2 * Math.PI * 7 * s);
        ty = 0.4 * this.tapeA * Math.exp(-s / 0.2) * Math.sin(2 * Math.PI * 11 * s);
      }
    }
    this.tape.value.set(this.tapeX, tz, ty, 1.4);
  }
}
