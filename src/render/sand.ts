// Sand off the turf (the look pass, `?look=2`, until the owner has seen it): a padel court is sand-filled, and it
// shows: a puff where the ball lands, under a shoe that lands at a run, a bigger one where a player brakes or cuts.
//
// A pool of soft sprites, one instanced draw. A puff is written once (where, when, which way, how big) and the shader
// moves it from the clock: drifts out and slows, lifts a little, spreads and thins. Nothing is allocated per frame.
// Reads the sim's events and the avatars' soles as the sound does (audio/soundscape.ts); never writes to the sim.
import * as THREE from 'three/webgpu';
import { cameraPosition, clamp, cos, float, fract, instancedDynamicBufferAttribute, positionLocal, sin, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { E_FLOOR, type MatchSim } from '../sim/match.ts';
import { eventsOf } from '../net/feed.ts';

const POOL = 96;
/** Dry sand in the light. */
const PALE = '#e6dcc6';
/** A puff's life (s) and its sprite's size at birth (m) for a ball's bounce at 10 m/s, a step, a brake. */
const LIFE = 0.85;
const SIZE_BALL = 0.16, SIZE_STEP = 0.2, SIZE_BRAKE = 0.3;
/** The soles' heights that count as down and up again (m), as the sound's. */
const FOOT_UP = 0.03, FOOT_DOWN = 0.012;
/** A step raises sand from this speed (m/s); a brake of this much (m/s lost in a frame's 60ths, summed over 0.2 s). */
const STEP_SPEED = 2.2;
const BRAKE = 1.1, BRAKE_WINDOW = 0.2, BRAKE_AGAIN = 0.6;

/** A player's soles as the sand reads them (the avatar's `feet`: x, height, z, left then right), or null. */
export interface SandFeet { feet: Float64Array | null }

export class SandPuffs {
  readonly mesh: THREE.InstancedMesh;
  /** Per puff: where (x, y, z) and when (the clock at its birth); its drift (x, z), its size and its strength. */
  private readonly at: THREE.InstancedBufferAttribute;
  private readonly go: THREE.InstancedBufferAttribute;
  private readonly clock = uniform(new THREE.Vector2(-1e6, 0));
  private next = 0;
  private sim: MatchSim | null = null;
  private seen = 0;
  private seed = 13579;
  private readonly footDown = new Uint8Array(8);
  private readonly speedWas = new Float64Array(4);
  private readonly lost = new Float64Array(4);
  private readonly brakeT = new Float64Array(4).fill(-1);
  private lastT = 0;

  constructor(scene: THREE.Scene, sand: THREE.ColorRepresentation) {
    this.at = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4).fill(-1e6), 4);
    this.go = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    this.at.setUsage(THREE.DynamicDrawUsage);
    this.go.setUsage(THREE.DynamicDrawUsage);
    const at = instancedDynamicBufferAttribute(this.at, 'vec4') as unknown as THREE.Node<'vec4'>;
    const go = instancedDynamicBufferAttribute(this.go, 'vec4') as unknown as THREE.Node<'vec4'>;
    const age = this.clock.x.sub(at.w);
    const live = age.greaterThan(0).and(age.lessThan(LIFE)).select(float(1), float(0));
    const k = clamp(age.div(LIFE), 0, 1);
    // Out along its drift, slowing (the air stops sand in a hand's width), and up a little as it spreads.
    const out = float(1).sub(age.mul(-5).exp()).div(5);
    const size = go.z.mul(float(1).add(k.mul(2.2))).mul(live);
    const centre = vec3(at.x.add(go.x.mul(out)), at.y.add(size.mul(0.28)).add(k.mul(go.z).mul(0.5)), at.z.add(go.y.mul(out)));
    const toCam = cameraPosition.xz.sub(centre.xz).normalize();
    const right = vec3(toCam.y, 0, toCam.x.negate());
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.positionNode = centre.add(right.mul(positionLocal.x.mul(size))).add(vec3(0, positionLocal.y.mul(size).mul(0.7), 0));
    // A soft, uneven blob: round, thinner where a cheap noise says so, thinning as it spreads.
    const p = uv().sub(0.5).mul(2);
    const ang = p.x.mul(3.1).add(at.w.mul(7.3));
    const lump = float(0.75).add(sin(ang.add(p.y.mul(4.3))).mul(cos(p.y.mul(3.7).sub(at.x.mul(5.1)))).mul(0.25));
    const round = clamp(float(1).sub(p.dot(p)), 0, 1).pow(1.6);
    const grainy = float(0.85).add(fract(sin(p.dot(vec2(41.3, 289.1)).add(at.w)).mul(43758.5)).mul(0.3));
    // (in the air it is pale: the turf's own tint of it, `sand`, is what shows between the fibres)
    const c = new THREE.Color(sand).lerp(new THREE.Color(PALE), 0.75);
    mat.colorNode = vec3(c.r, c.g, c.b);
    mat.opacityNode = round.mul(lump).mul(grainy).mul(go.w).mul(smoothstep(0, 0.06, k)).mul(float(1).sub(k).pow(1.7));
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'sand';
    scene.add(this.mesh);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private puff(x: number, z: number, t: number, dx: number, dz: number, size: number, strength: number): void {
    const i = this.next * 4;
    this.next = (this.next + 1) % POOL;
    const A = this.at.array as Float32Array, G = this.go.array as Float32Array;
    A[i] = x; A[i + 1] = 0.01; A[i + 2] = z; A[i + 3] = t;
    G[i] = dx; G[i + 1] = dz; G[i + 2] = size; G[i + 3] = strength;
    this.at.needsUpdate = true;
    this.go.needsUpdate = true;
  }

  private burst(x: number, z: number, t: number, n: number, size: number, strength: number, push: number, vx: number, vz: number): void {
    for (let j = 0; j < n; j++) {
      const a = this.rand() * Math.PI * 2, s = push * (0.4 + 0.6 * this.rand());
      this.puff(x + Math.cos(a) * size * 0.25, z + Math.sin(a) * size * 0.25, t + j * 0.012, Math.cos(a) * s + vx, Math.sin(a) * s + vz,
        size * (0.75 + 0.5 * this.rand()), strength * (0.7 + 0.3 * this.rand()));
    }
  }

  /** After the frame's poses: `sim` the match shown (the match, or a replay's), `t` its clock as drawn. */
  update(sim: MatchSim, t: number, feet: readonly SandFeet[]): void {
    const ev = eventsOf(sim);
    if (sim !== this.sim || t < this.lastT - 0.5) {
      // Another match or moment: its sand is not this one's.
      this.sim = sim;
      this.seen = ev.eventSeq;
      (this.at.array as Float32Array).fill(-1e6);
      this.at.needsUpdate = true;
      this.footDown.fill(1);
      this.lost.fill(0);
    }
    this.lastT = t;
    this.clock.value.x = t;
    if (ev.eventSeq - this.seen > ev.events.length) this.seen = ev.eventSeq - ev.events.length;
    while (this.seen < ev.eventSeq) {
      const e = ev.events[this.seen % ev.events.length]!;
      this.seen++;
      if (e.kind !== E_FLOOR || e.y > 0.2) continue;
      // The ball: a harder landing lifts more.
      const hard = Math.min(1, e.c / 16);
      this.burst(e.x, e.z, e.time, 3, SIZE_BALL * (0.7 + 0.6 * hard), 0.2 + 0.3 * hard, 0.5 + hard, 0, 0);
    }
    const n = Math.min(4, sim.players.length, feet.length);
    for (let i = 0; i < n; i++) {
      const p = sim.players[i]!;
      const vx = p.vel.x, vz = p.vel.z;
      const speed = Math.sqrt(vx * vx + vz * vz);
      const F = feet[i]!.feet;
      if (F) for (let f = 0; f < 2; f++) {
        const k = i * 2 + f, y = F[f * 3 + 1]!;
        if (this.footDown[k] === 0 && y < FOOT_DOWN) {
          this.footDown[k] = 1;
          if (speed > STEP_SPEED) {
            const run = Math.min(1, (speed - STEP_SPEED) / 3.5);
            this.burst(F[f * 3]!, F[f * 3 + 2]!, t, 1, SIZE_STEP * (0.8 + 0.4 * run), 0.1 + 0.16 * run, 0.3, -vx * 0.12, -vz * 0.12);
          }
        } else if (y > FOOT_UP) this.footDown[k] = 0;
      }
      // Braking: the speed lost lately (it leaks away over the window).
      const was = this.speedWas[i]!;
      this.lost[i] = Math.max(0, this.lost[i]! * (1 - Math.min(1, (1 / 60) / BRAKE_WINDOW)) + Math.max(0, was - speed));
      this.speedWas[i] = speed;
      if (this.lost[i]! > BRAKE && was > 1.5 && (this.brakeT[i]! < 0 || t - this.brakeT[i]! > BRAKE_AGAIN || t < this.brakeT[i]!)) {
        this.brakeT[i] = t;
        this.lost[i] = 0;
        const k = was > 1e-3 ? 1 / was : 0;
        // (thrown the way the player was going: the shoe ploughs it forward)
        this.burst(p.pos.x, p.pos.z, t, 4, SIZE_BRAKE, 0.34, 0.5, vx * k * 0.9 + (vx - 0) * 0.1, vz * k * 0.9 + vz * 0.1);
      }
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
