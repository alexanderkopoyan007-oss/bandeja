// The creator's studio (M5 phase D): the player's own character alone under three-point light on a dark backdrop,
// drawn with the game's renderer while the creator is open (the title's match gives up the renderer for it). The
// camera goes round them as a turntable would (on its own, or dragged, the pad's right stick, the wheel to come
// closer), the lights going round with it, so they are always lit as a portrait is.
//
// They stand in a practice drill's sim (MatchSim, data/practice.json), held before the coach's first feed. "Watch them
// play" lets that sim run: the coach, unseen, feeds and the AI plays the ball as the character, so a body built here,
// ridiculous ones too, is seen to reach the ball with the very animation a match uses.
import * as THREE from 'three/webgpu';
import { MatchSim } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import type { InputFrame } from '../sim/input.ts';
import { BallView, PlayerView } from '../render/views.ts';
import { pooledLight } from '../render/arena/lights.ts';
import { disposeTree } from '../render/dispose.ts';
import { loadPeople, type PlayerAsset } from '../render/avatar/asset.ts';
import { bodyFor } from '../render/avatar/costumes.ts';
import { hasTattoo } from '../render/avatar/kit.ts';
import { dealCast } from './cast.ts';
import type { GameOptions } from './game.ts';

/** The backdrop (and the fog the floor fades into) and the floor. */
const BACKDROP = 0x14181e;
const FLOOR = 0x2b3038;
/** The camera's vertical field (deg); the frame holds the body's height times FIT; the wheel comes in to CLOSEST of
 * that distance, aimed then at the head (HEAD_AT of the height) rather than the middle. */
const FOV = 24;
const FIT = 1.5;
/** Playing, the frame widens to hold the racket overhead and the ball coming (FIT_PLAY, aimed PLAY_AT of the height up),
 * easing there over WIDEN s. */
const FIT_PLAY = 2.3;
const PLAY_AT = 0.68;
const WIDEN = 0.5;
const CLOSEST = 0.32;
const HEAD_AT = 0.9;
/** The camera's height over its aim, a share of its distance (looking a little down, as a portrait does). */
const RISE = 0.06;
/** The turntable (rad/s), and how long after a drag or a push of the stick it waits to turn again (s). */
const SPIN = 0.3;
const SPIN_WAIT = 2.5;
/** Dragging: rad per pixel; the stick: rad/s at full tilt, and its dead zone. */
const DRAG = 0.008;
const STICK = 2.2;
const DEAD = 0.2;
/** The subject sits this share of the width right of centre: the creator's list is on the left (none on a narrow
 * screen, where the list covers the picture anyway). */
const SHIFT = 0.19;
const NARROW = 1000;
/** The camera follows the player round the drill with this lag (s). */
const FOLLOW = 0.3;
/** A change waits this long (ms) before the player is built again: a slider being dragged builds once it rests. */
// (300, from 110: a build is one 130-190 ms task, and the pad's API reports only what is held, so a tap that starts
// and ends inside one is lost; tapping down the Roster every 200-300 ms, each build fell on the next tap (M8's menu
// walk). Taps at that pace now build nothing until they stop.)
const SETTLE_MS = 300;
/** The held moment: this far (s) into the drill, the player ready on their spot, the coach not yet feeding. */
const HOLD_AT = 1.0;
/** The drill the player stands in when held, and the drills "watch them play" offers (data/practice.json). */
export const STUDIO_DRILLS = [{ drill: 3, label: 'Volleys' }, { drill: 2, label: 'Overheads' }] as const;
const HOLD_DRILL = STUDIO_DRILLS[0].drill;
/** The lights, in the camera's frame (x right, y up, z toward the camera): key high on the camera's left, a cool fill
 * low on its right, a rim from behind; colour, intensity. */
const RIG = [
  { key: 'studio-key', dir: [-0.62, 0.95, 0.75], color: '#fff3e2', intensity: 2.7, shadow: true },
  { key: 'studio-fill', dir: [0.95, 0.3, 0.55], color: '#cddcff', intensity: 0.75, shadow: false },
  { key: 'studio-rim', dir: [0.35, 0.8, -1], color: '#ffffff', intensity: 2.4, shadow: false },
] as const;
const ENV_INTENSITY = 0.55;

const v = new THREE.Vector3();

/** What building the player depends on (the face, body, outfit, racket and hand): a change of anything else is applied in place. */
function buildKey(o: GameOptions): string {
  // (a tattoo's code is in the shader only when there is one: hasTattoo)
  return JSON.stringify([o.me?.face, o.bodies?.[0], o.wear?.[0], o.match.rackets?.[0], o.match.lefty?.[0], hasTattoo(o.looks?.[0])]);
}

export class Studio {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  private readonly lights: THREE.DirectionalLight[] = [];
  private readonly hemi: THREE.HemisphereLight;
  private readonly env: THREE.RenderTarget;
  /** Made with the first sim (its ball's size). */
  private ball: BallView | null = null;
  private readonly inputs: Array<InputFrame | null> = [null, null];
  private sim: MatchSim | null = null;
  private view: PlayerView | null = null;
  private opts: GameOptions | null = null;
  private pending: GameOptions | null = null;
  /** What the player on the turntable was built from (buildKey). */
  private key = '';
  private building: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The drill being played (-1: held). */
  private drill = -1;
  private runs = 0;
  private acc = 0;
  private last = 0;
  /** The camera's angle round the player (rad, as the avatar's facing is), its distance's share, when it turns again. */
  private angle = 0;
  private zoom = 1;
  private spinAt = 0;
  /** 0 framed for the body, 1 for play (FIT_PLAY). */
  private wide = 0;
  /** The player's height (m, from their head's top) and the point the camera follows. */
  private top = 1.8;
  private readonly at = new THREE.Vector3();
  private snap = true;
  /** The camera has its first angle (a three-quarter view of their front) for this visit. */
  private aimed = false;
  private readonly size = new THREE.Vector2();
  private drag: { id: number; x: number } | null = null;
  private listening: AbortController | null = null;
  private disposed = false;
  /** Called after each build (the creator shows what is on the turntable). */
  onBuilt: (() => void) | null = null;

  private readonly renderer: THREE.WebGPURenderer;
  private readonly asset: PlayerAsset;

  constructor(renderer: THREE.WebGPURenderer, asset: PlayerAsset) {
    this.renderer = renderer;
    this.asset = asset;
    const s = this.scene;
    s.background = new THREE.Color(BACKDROP);
    s.fog = new THREE.Fog(BACKDROP, 9, 24);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.82 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // Pooled, as the arenas' are (lights.ts: new lights each visit would be kept by three's bind-group cache).
    for (const r of RIG) {
      const l = pooledLight(r.key, () => new THREE.DirectionalLight());
      l.color.set(r.color);
      l.intensity = r.intensity;
      l.castShadow = r.shadow && renderer.shadowMap.enabled;
      if (r.shadow) {
        l.shadow.mapSize.set(2048, 2048);
        l.shadow.bias = -0.0004;
        l.shadow.normalBias = 0.02;
        l.shadow.radius = 3;
        Object.assign(l.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 24 });
        l.shadow.camera.updateProjectionMatrix();
      }
      s.add(l, l.target);
      this.lights.push(l);
    }
    this.hemi = pooledLight('studio-hemi', () => new THREE.HemisphereLight());
    this.hemi.color.set('#dfe6f0');
    this.hemi.groundColor.set('#262a31');
    this.hemi.intensity = 0.3;
    s.add(this.hemi);
    this.env = this.bakeEnvironment();
    s.environment = this.env.texture;
    s.environmentIntensity = ENV_INTENSITY;
  }

  /** A soft room for the skin's and the racket's reflections: light from above, dark below, as the backdrop is. */
  private bakeEnvironment(): THREE.RenderTarget {
    const room = new THREE.Scene();
    const g = new THREE.SphereGeometry(20, 32, 16);
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color('#aab3bf'), mid = new THREE.Color('#3c434d'), low = new THREE.Color(BACKDROP), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 20;
      if (y > 0) c.copy(mid).lerp(top, y ** 0.7);
      else c.copy(mid).lerp(low, Math.min(1, -y * 3));
      c.toArray(col, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    room.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(room, 0.04, 0.1, 50, { size: 128, position: new THREE.Vector3(0, 1.6, 0) });
    pmrem.dispose();
    disposeTree(room);
    return rt;
  }

  /** Dress the turntable as `opts` say (GameOptions as a match would have them, the character applied): built once
   * the changes rest, and only the newest of several. */
  show(opts: GameOptions): void {
    // Only the skin's or the hair's tone or the racket's colours changed: in place, at once (uniforms, the racket's
    // own print), no build.
    const key = buildKey(opts);
    if (this.view && !this.pending && !this.building && !this.timer && key === this.key) {
      this.opts = opts;
      this.view.avatar?.setSelf(opts.looks?.[0]);
      this.view.paintRacket(opts.designs?.[0] ?? null);
      return;
    }
    this.pending = opts;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.build(); }, this.view ? SETTLE_MS : 0);
  }

  /** Waits for the build under way (tests, stills). */
  async ready(): Promise<void> {
    while (this.timer || this.building) await (this.building ?? new Promise((r) => setTimeout(r, SETTLE_MS)));
  }

  private build(): Promise<void> {
    if (this.building) return this.building;
    this.building = (async () => {
      try {
        while (this.pending && !this.disposed) {
          const opts = this.pending;
          this.pending = null;
          if (opts.me) await loadPeople(this.asset, [bodyFor(opts.me.face, opts.wear?.[0])]);
          if (this.disposed || this.pending) continue;
          this.place(opts);
        }
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  private place(opts: GameOptions): void {
    this.opts = opts;
    this.key = buildKey(opts);
    const cast = dealCast(opts.castSeed ?? 0, opts.people, undefined, opts.me?.face);
    if (opts.bodies) cast.bodies = opts.bodies;
    if (opts.looks) cast.looks = opts.looks;
    if (opts.designs) cast.designs = opts.designs;
    opts.match.women = cast.women;
    const old = this.view;
    this.view = new PlayerView(this.scene, 0, this.asset, cast, opts.match.rackets?.[0], opts.wear?.[0]);
    if (old) {
      old.root.removeFromParent();
      disposeTree(old.root);
    }
    // Played on from where it was (the same drill's sim, the new body in it), or held afresh.
    if (this.drill < 0 || !this.sim) this.restart();
    else this.view.cutNext();
    this.view.update(this.sim!, this.sim!.players[0]!, 0, 1, this.sim!.time);
    this.top = this.measure();
    this.onBuilt?.();
  }

  /** The head's top over the floor (m), as the body stands built. */
  private measure(): number {
    const a = this.view?.avatar;
    if (!a) return 1.8;
    a.root.updateMatrixWorld(true);
    const b = a.mesh.skeleton.bones.find((x) => x.name === 'HeadTop_End') ?? a.mesh.skeleton.bones.find((x) => x.name === 'Head');
    return b ? Math.max(0.8, b.getWorldPosition(v).y + (b.name === 'Head' ? 0.18 : 0.02)) : 1.8;
  }

  /** A fresh sim of the drill (held: the held drill, at HOLD_AT). */
  private restart(): void {
    const opts = this.opts;
    if (!opts) return;
    const m = structuredClone(opts.match);
    m.practice = this.drill >= 0 ? this.drill : HOLD_DRILL;
    m.human = m.human.map(() => false);
    m.firstServer = 1;
    m.walkBack = false;
    m.seed = (m.seed ?? 0) + ++this.runs;
    const sim = (this.sim = new MatchSim(m));
    while (sim.time < HOLD_AT) sim.step(this.inputs);
    this.acc = 0;
    this.view?.cutNext();
    if (!this.ball) {
      this.ball = new BallView(this.scene, sim.world.spec.radius);
      this.ball.showMarker = false;
    }
    this.ball.cutNext();
    this.showBall(false);
    // (the camera goes to where they stand now, still at its angle)
    this.snap = true;
  }

  /** Play a drill of STUDIO_DRILLS (by its data/practice.json number), or -1 to hold them still again. */
  play(drill: number): void {
    if (drill === this.drill) return;
    const was = this.drill;
    this.drill = drill;
    // From held into the held drill: on from the held moment, no cut.
    if (!(was < 0 && drill === HOLD_DRILL)) this.restart();
  }

  get playing(): number {
    return this.drill;
  }

  private showBall(on: boolean): void {
    const b = this.ball;
    if (b) for (const o of [b.mesh, b.shadow, b.trail, b.marker]) o.visible = on;
  }

  /** Take the renderer (the title's match has let it go) and the pointer over the picture. */
  start(): void {
    if (this.listening || this.disposed) return;
    this.last = 0;
    this.snap = true;
    this.aimed = false;
    this.zoom = 1;
    this.listening = new AbortController();
    const sig = { signal: this.listening.signal };
    const free = (e: Event): boolean => !(e.target as Element | null)?.closest?.('.panel, .side, .foot, .brand');
    addEventListener('pointerdown', (e) => {
      if (!free(e) || e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX };
    }, sig);
    addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.angle -= (e.clientX - this.drag.x) * DRAG;
      this.drag.x = e.clientX;
      this.spinAt = performance.now() / 1000 + SPIN_WAIT;
    }, sig);
    const up = (e: PointerEvent): void => { if (this.drag?.id === e.pointerId) this.drag = null; };
    addEventListener('pointerup', up, sig);
    addEventListener('pointercancel', up, sig);
    addEventListener('wheel', (e) => {
      if (!free(e)) return;
      this.zoom = Math.min(1, Math.max(CLOSEST, this.zoom * Math.exp(e.deltaY * 0.0015)));
    }, { ...sig, passive: true });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Give the renderer back. */
  stop(): void {
    this.listening?.abort();
    this.listening = null;
    this.drag = null;
    this.renderer.setAnimationLoop(null);
  }

  /** One frame (the animation loop's; tools call it with their own clock, ms, to step it evenly). */
  frame(now = performance.now()): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const sim = this.sim, view = this.view;
    if (!sim || !view) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    let alpha = 1;
    if (this.drill >= 0) {
      this.acc += dt;
      let n = 0;
      for (; this.acc >= DT && n < 12; n++) {
        sim.step(this.inputs);
        this.acc -= DT;
      }
      if (n === 12) this.acc = 0;
      alpha = this.acc / DT;
      this.showBall(true);
      this.ball?.update(sim, alpha, 0);
    }
    const t = sim.time - DT + alpha * DT;
    view.update(sim, sim.players[0]!, 0, alpha, t);
    this.aim(dt, now / 1000, sim);
    this.renderer.render(this.scene, this.camera);
  }

  /** The camera round the player, the lights round with it. */
  private aim(dt: number, now: number, sim: MatchSim): void {
    const root = this.view!.root.position;
    if (!this.aimed) {
      this.aimed = true;
      // A three-quarter view of their front to start (the drawn body's turn: its front is +z turned by it).
      this.angle = this.view!.root.rotation.y + 0.55;
    }
    void sim;
    this.wide += ((this.drill >= 0 ? 1 : 0) - this.wide) * (1 - Math.exp(-dt / WIDEN));
    if (this.snap) {
      this.snap = false;
      this.at.set(root.x, 0, root.z);
    } else {
      const k = 1 - Math.exp(-dt / FOLLOW);
      this.at.x += (root.x - this.at.x) * k;
      this.at.z += (root.z - this.at.z) * k;
    }
    // The pad's right stick turns it; left alone, it turns by itself.
    let stick = 0;
    for (const p of navigator.getGamepads?.() ?? []) if (p && Math.abs(p.axes[2] ?? 0) > DEAD) stick = p.axes[2]!;
    if (stick) {
      this.angle += stick * STICK * dt;
      this.spinAt = now + SPIN_WAIT;
    } else if (!this.drag && now >= this.spinAt) this.angle += SPIN * dt;

    this.renderer.getSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    const near = (1 - this.zoom) / (1 - CLOSEST);
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const full = (this.top * THREE.MathUtils.lerp(FIT, FIT_PLAY, this.wide)) / 2 / tan;
    const d = full * this.zoom;
    const y = THREE.MathUtils.lerp(this.top * THREE.MathUtils.lerp(0.5, PLAY_AT, this.wide), this.top * HEAD_AT, near);
    const sa = Math.sin(this.angle), ca = Math.cos(this.angle);
    const c = this.camera;
    c.position.set(this.at.x + sa * d, y + d * RISE, this.at.z + ca * d);
    c.lookAt(this.at.x, y, this.at.z);
    c.aspect = w / h;
    if (w > NARROW) c.setViewOffset(w, h, -SHIFT * w, 0, w, h);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
    // The rig in the camera's frame: right (ca, 0, -sa), up, toward the camera (sa, 0, ca).
    for (let i = 0; i < RIG.length; i++) {
      const [x, yy, z] = RIG[i]!.dir;
      const l = this.lights[i]!;
      v.set(x * ca + z * sa, yy, -x * sa + z * ca).normalize().multiplyScalar(10);
      l.position.set(this.at.x + v.x, v.y, this.at.z + v.z);
      l.target.position.set(this.at.x, this.top * 0.45, this.at.z);
    }
    this.scene.environmentRotation.y = this.angle;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.timer) clearTimeout(this.timer);
    disposeTree(this.scene);
    this.scene.clear();
    this.scene.environment = null;
    this.env.dispose();
  }
}
