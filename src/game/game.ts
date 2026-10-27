// The browser game: fixed-step sim driven by requestAnimationFrame, timestamped input, render interpolation.
import * as THREE from 'three/webgpu';
import { MatchSim, type MatchConfig } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import { InputFrame } from '../sim/input.ts';
import { buildCourtView } from '../render/courtView.ts';
import { NetView } from '../render/netView.ts';
import { BallView, PlayerView, BroadcastCamera, AssistView } from '../render/views.ts';
import { KeyboardInput } from './input/keyboard.ts';
import type { PlayerAsset } from '../render/avatar/asset.ts';
import { Hud } from '../ui/hud.ts';
import { DebugOverlay } from '../ui/debug.ts';

const MAX_TICKS_PER_FRAME = 12;

export interface GameOptions {
  match: MatchConfig;
  /** The human's player number (team + 2 * slot); ignored with autoplay. */
  human: number;
  autoplay: boolean;
  forceWebGL: boolean;
  pro: boolean;
  mouseAim: boolean;
  /** The animated player body (M2); null: the M1 capsules. */
  avatar: PlayerAsset | null;
  /**
   * Render the present instead of one tick behind it (the sim runs up to one tick ahead of the clock and the
   * render interpolates back to now). Saves one tick (8.3 ms) of input-to-screen latency; `?runahead=0` is the
   * old way.
   */
  runAhead?: boolean;
}

/** One button event's trip to the screen, performance.now() ms (tools/latency.mjs reads these). */
export interface LatencySample {
  /** The key event's timestamp. */
  ts: number;
  /** The frame that handed it to the sim. */
  used: number;
  /** Render submitted for the first frame whose render time is at or past the event. */
  shown: number;
  /** The GPU finished that frame (WebGPU only; 0 otherwise). */
  gpu: number;
}

/** Numbers the perf tool reads from the page. */
export interface PerfProbe {
  frames: number[];
  sims: number[];
  /** CPU time of each frame's work (sim + scene update + render submit), ms. */
  works: number[];
  drawCalls: number;
  triangles: number;
  backend: string;
  points: number;
}

export class Game {
  readonly opts: GameOptions;
  sim: MatchSim;
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly cam: BroadcastCamera;
  readonly ball: BallView;
  readonly net: NetView;
  readonly players: PlayerView[];
  readonly assists: AssistView;
  readonly kb: KeyboardInput;
  readonly hud: Hud;
  readonly debug: DebugOverlay;
  readonly frame = new InputFrame();
  readonly aimMarker: THREE.Mesh;
  private mouseOnCourt = false;
  readonly probe: PerfProbe = { frames: [], sims: [], works: [], drawCalls: 0, triangles: 0, backend: '', points: 0 };
  /** Input latency samples (one per button event; allocates only on key events). */
  readonly latency: LatencySample[] = [];
  private latFirst = 0;
  private frameNow = 0;

  private epoch = 0;
  private hiddenAt = -1;
  private lastFrame = 0;
  private readonly axes = { x: 0, y: 0 };
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private mouseAim: boolean;

  constructor(opts: GameOptions, renderer: THREE.WebGPURenderer, hudRoot: HTMLElement) {
    this.opts = opts;
    this.renderer = renderer;
    this.mouseAim = opts.mouseAim;
    this.sim = new MatchSim(opts.match);
    const court = this.sim.world.court;

    this.scene.background = new THREE.Color(0x0d0f12);
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x30343a, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(5, 15, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 2, far: 40 });
    this.scene.add(sun);
    this.scene.add(buildCourtView(court));
    this.net = new NetView(this.sim.net);
    this.scene.add(this.net.group);

    this.cam = new BroadcastCamera(innerWidth && innerHeight ? innerWidth / innerHeight : 16 / 9);
    this.ball = new BallView(this.scene, this.sim.world.spec.radius);
    this.players = [];
    for (let i = 0; i < this.sim.players.length; i++) this.players.push(new PlayerView(this.scene, i, opts.avatar));
    if (!opts.autoplay) this.players[opts.human]!.markYou();
    this.inputs = new Array<InputFrame | null>(this.sim.players.length).fill(null);
    this.assists = new AssistView(this.scene);
    this.assists.enabled = !opts.pro;
    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xf4d03f, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.aimMarker.rotation.x = -Math.PI / 2;
    this.aimMarker.position.y = 0.005;
    this.aimMarker.visible = false;
    this.scene.add(this.aimMarker);

    this.kb = new KeyboardInput(window);
    const sets = (opts.match.format?.setsToWin ?? 2) * 2 - 1;
    // Score rows name the players: YOU, and each AI by its playing style.
    const who = (i: number, short: boolean): string => {
      const st = this.sim.ai[i]?.style;
      return !opts.autoplay && i === opts.human ? 'YOU' : st ? (short ? st.short : st.name) : 'AI';
    };
    const row = (t: number): string => (this.sim.doubles ? `${who(t, true)} · ${who(t + 2, true)}` : who(t, false));
    const names: [string, string] = [row(0), row(1)];
    this.hud = new Hud(hudRoot, names, sets);
    this.hud.pro = opts.pro;
    this.hud.setTiming(opts.match.timingScale ?? 1);
    this.ball.showTrail = !opts.pro;
    this.ball.showMarker = !opts.pro;
    this.debug = new DebugOverlay(hudRoot);
    this.kb.onKey = (code) => this.onKey(code);

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // Freeze the sim while the tab is hidden instead of fast-forwarding on return.
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt >= 0) {
        this.epoch += performance.now() - this.hiddenAt;
        this.hiddenAt = -1;
      }
    });
    this.probe.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  }

  private onKey(code: string): void {
    if (code === 'F3') this.debug.toggle();
    else if (code === 'KeyH') this.hud.toggleHelp();
    else if (code === 'KeyP') {
      this.hud.pro = !this.hud.pro;
      this.ball.showTrail = !this.hud.pro;
      this.ball.showMarker = !this.hud.pro;
      this.assists.enabled = !this.hud.pro;
    } else if (code === 'KeyM') this.mouseAim = !this.mouseAim;
  }

  resize(): void {
    // A collapsed or hidden embed can report a 0 x 0 window: keep the last size rather than a NaN camera.
    if (!innerWidth || !innerHeight) return;
    this.renderer.setSize(innerWidth, innerHeight);
    this.cam.camera.aspect = innerWidth / innerHeight;
    this.cam.camera.updateProjectionMatrix();
  }

  /** Compile every pipeline before the first point so nothing compiles mid-rally. */
  async warmUp(): Promise<void> {
    this.cam.update(this.sim, this.team, 0, 0);
    await this.renderer.compileAsync(this.scene, this.cam.camera);
  }

  start(): void {
    if (!this.opts.autoplay) {
      // Who you are playing (and with).
      const name = (i: number): string => this.sim.ai[i]?.style.name ?? 'AI';
      const sub = this.sim.doubles ? `Your partner: ${name(this.opts.human ^ 2)}` : '';
      const them = 1 - this.team;
      const title = this.sim.doubles ? `vs ${name(them)} & ${name(them + 2)}` : `vs ${name(them)}`;
      this.hud.announce(title, sub, performance.now() / 1000, 3);
    }
    this.epoch = performance.now() - this.sim.time * 1000;
    this.renderer.setAnimationLoop(() => this.tick());
    this.running = true;
  }

  /** start() has run (tools wait for this; the page exposes the game before its warm-up). */
  running = false;

  private buildInput(t0: number, t1: number): InputFrame | null {
    if (this.opts.autoplay) return null;
    const f = this.frame;
    f.clear();
    this.kb.axes(this.axes);
    f.moveX = this.axes.x;
    f.moveY = this.axes.y;
    f.held = this.kb.held;
    // Button events that happened before the end of this tick, with their exact sim times.
    const endMs = this.epoch + t1 * 1000;
    const q = this.kb.queue;
    while (this.kb.head < this.kb.tail) {
      const e = q[this.kb.head % q.length]!;
      if (e.ts >= endMs) break;
      f.push(e.press, e.button, Math.max(0, (e.ts - this.epoch) / 1000));
      this.kb.head++;
      if (this.latency.length < 4000) this.latency.push({ ts: e.ts, used: this.frameNow, shown: 0, gpu: 0 });
    }
    void t0;
    if (this.mouseAim && this.mouseOnCourt) {
      f.aimAbs = true;
      f.aimTX = this.aimMarker.position.x;
      f.aimTZ = this.aimMarker.position.z;
    }
    return f;
  }

  private readonly inputs: Array<InputFrame | null>;

  /** Latency probe: events whose moment this frame's render time has reached are on screen from this frame. */
  private markShown(renderMs: number): void {
    const t = performance.now();
    let any = false;
    for (let k = this.latFirst; k < this.latency.length; k++) {
      const l = this.latency[k]!;
      if (l.shown === 0 && l.ts <= renderMs) { l.shown = t; any = true; }
    }
    while (this.latFirst < this.latency.length && this.latency[this.latFirst]!.shown > 0) this.latFirst++;
    const dev = (this.renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
    if (any && dev) {
      void dev.queue.onSubmittedWorkDone().then(() => {
        const g = performance.now();
        for (let k = this.latency.length - 1; k >= 0 && k >= this.latFirst - 64; k--) {
          const l = this.latency[k]!;
          if (l.shown === t) l.gpu = g;
        }
      });
    }
  }

  /** The human's team (the camera's end); team 0 with autoplay. */
  get team(): number {
    return this.opts.autoplay ? 0 : this.sim.players[this.opts.human]!.team;
  }

  private tick(): void {
    const now = performance.now();
    this.frameNow = now;
    const simNow = (now - this.epoch) / 1000;
    const s0 = performance.now();
    let n = 0;
    const human = this.opts.autoplay ? 0 : this.opts.human;
    const team = this.team;
    // Run-ahead: step until the sim is at or just past now and draw now, between the last two ticks. Otherwise
    // step up to now and draw one tick behind it. Either way the render blends two real sim states, and a key
    // event inside the newest tick is handed to it with its exact time.
    const ahead = this.opts.runAhead !== false;
    while ((ahead ? this.sim.time < simNow : this.sim.time + DT <= simNow) && n < MAX_TICKS_PER_FRAME) {
      this.inputs[human] = this.buildInput(this.sim.time, this.sim.time + DT);
      this.sim.step(this.inputs);
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) this.epoch = now - this.sim.time * 1000; // drop a backlog rather than spiral
    const simMs = performance.now() - s0;
    const alpha = ahead
      ? Math.min(1, Math.max(0, 1 - (this.sim.time - simNow) / DT))
      : Math.min(1, Math.max(0, (simNow - this.sim.time) / DT));
    const renderTime = this.sim.time - DT + alpha * DT;

    // Mouse aim: project the pointer onto the opponent's half. The faint marker is the pointer; while a shot can
    // be aimed the sim's target (drawn by the assist view) sits under it instead.
    this.aimMarker.visible = false;
    this.mouseOnCourt = false;
    if (this.mouseAim && this.kb.mouseActive && !this.opts.autoplay) {
      this.ndc.set(this.kb.mouseX, this.kb.mouseY);
      this.ray.setFromCamera(this.ndc, this.cam.camera);
      if (this.ray.ray.intersectPlane(this.ground, this.hit)) {
        const c = this.sim.world.court;
        const s = this.sim.side(team);
        const x = Math.max(-c.halfW + 0.3, Math.min(c.halfW - 0.3, this.hit.x));
        const z = -s * Math.max(0.6, Math.min(c.halfL - 0.3, -s * this.hit.z));
        this.aimMarker.position.set(x, 0.005, z);
        this.aimMarker.visible = !this.sim.players[human]!.aiming;
        this.mouseOnCourt = true;
      }
    }

    const frameDt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.ball.update(this.sim, alpha, team);
    this.net.update(this.sim, alpha);
    for (let i = 0; i < this.players.length; i++) this.players[i]!.update(this.sim, this.sim.players[i]!, i, alpha, renderTime);
    this.cam.update(this.sim, team, this.ball.mesh.position.x, now / 1000);
    const who = this.opts.autoplay ? -1 : human;
    this.assists.update(this.sim, who, this.ball.mesh.position, this.cam.camera, renderTime, this.opts.match.timingScale ?? 1,
      now / 1000, frameDt);
    this.hud.update(this.sim, who, now / 1000);

    this.renderer.render(this.scene, this.cam.camera);
    if (this.latFirst < this.latency.length) this.markShown(this.epoch + renderTime * 1000);
    const info = this.renderer.info.render;
    this.probe.drawCalls = info.drawCalls;
    this.probe.triangles = info.triangles;
    const dt = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (this.probe.frames.length < 100000) {
      this.probe.frames.push(dt);
      this.probe.sims.push(simMs);
      this.probe.works.push(performance.now() - now);
    }
    this.debug.frame(now, simMs, n, info.drawCalls, info.triangles, this.probe.backend, this.renderer.getPixelRatio());
  }
}
