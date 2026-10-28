// The browser game: fixed-step sim driven by requestAnimationFrame, timestamped input, render interpolation.
import * as THREE from 'three/webgpu';
import { MatchSim, PH_RALLY, type MatchConfig } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import { InputFrame } from '../sim/input.ts';
import { SW_CHARGE, SW_COMMITTED } from '../sim/player/player.ts';
import { buildCourtView, type CourtView } from '../render/courtView.ts';
import { Arena, arenaDef } from '../render/arena/arena.ts';
import { NetView } from '../render/netView.ts';
import { BallView, PlayerView, BroadcastCamera, AssistView } from '../render/views.ts';
import { KeyboardInput } from './input/keyboard.ts';
import { GamepadInput } from './input/gamepad.ts';
import { Sound } from '../audio/sound.ts';
import { Feedback } from './feedback.ts';
import type { PlayerAsset } from '../render/avatar/asset.ts';
import { Hud } from '../ui/hud.ts';
import { TvGraphics } from '../ui/tv.ts';
import { Post } from '../render/post.ts';
import { kitFor } from '../render/avatar/kit.ts';
import { DebugOverlay } from '../ui/debug.ts';
import { applyPhotoCam, type PhotoOverlay } from './photoMatch.ts';

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
  /** Hit sounds (`?sound=0` turns them off). */
  sound?: boolean;
  /** Arena (data/arenas.json): stadium, hall, club-day, club-night. */
  arena?: string;
  /** `tv`: the broadcast graphics package (ui/tv.ts) instead of the plain score bug. */
  gfx?: string;
  /** Lens bloom (render/post.ts); `?bloom=0` renders straight to the screen. */
  bloom?: boolean;
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
  /** A press (true) or a release. */
  press: boolean;
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
  private tv: TvGraphics | null = null;
  private post: Post | null = null;
  readonly net: NetView;
  readonly arena: Arena;
  readonly court: CourtView;
  readonly players: PlayerView[];
  readonly assists: AssistView;
  readonly kb: KeyboardInput;
  readonly pad: GamepadInput;
  readonly sound = new Sound();
  readonly feedback: Feedback;
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
  /** How far the drawn moment is behind now (s): 0 with run-ahead, one tick while a swing is held. */
  private renderLag = 0;

  private epoch = 0;
  private hiddenAt = -1;
  private lastFrame = 0;
  private readonly axes = { x: 0, y: 0 };
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private mouseAim: boolean;
  /** Photo-match mode (`?photo=`): the camera and the canvas's shape come from the photo. */
  photo: PhotoOverlay | null = null;
  /** The sim stands still (the scene is still drawn): photo-match comparisons. */
  paused = false;

  constructor(opts: GameOptions, renderer: THREE.WebGPURenderer, hudRoot: HTMLElement) {
    this.opts = opts;
    this.renderer = renderer;
    this.mouseAim = opts.mouseAim;
    this.sim = new MatchSim(opts.match);
    const court = this.sim.world.court;

    // The arena: floor, lights, surroundings; the court's glass, mesh and frame in its colours.
    this.arena = new Arena(arenaDef(opts.arena ?? 'stadium'), court, this.scene, renderer);
    this.court = buildCourtView(court, { frame: this.arena.def.frame, base: this.arena.def.base });
    this.scene.add(this.court.group);
    this.arena.addNeighbours(this.court.group, court);
    this.net = new NetView(this.sim.net);
    this.scene.add(this.net.group);

    this.cam = new BroadcastCamera(innerWidth && innerHeight ? innerWidth / innerHeight : 16 / 9, this.arena.def.camera?.swingRise ?? 0);
    const bl = this.arena.def.post?.bloom;
    if (bl && opts.bloom !== false) this.post = new Post(renderer, this.scene, this.cam.camera, bl);
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
    // Reflections and ambient light from the arena itself (without the players, ball and cues).
    const moving: THREE.Object3D[] = [this.ball.mesh, this.ball.shadow, this.ball.trail, this.ball.marker, this.aimMarker, this.net.group];
    for (const pv of this.players) moving.push(pv.root);
    this.court.setEnvironment(this.arena.bakeEnvironment(renderer, this.scene, moving));

    this.kb = new KeyboardInput(window);
    this.pad = new GamepadInput(window);
    this.sound.enabled = opts.sound !== false && !opts.autoplay;
    // Audio may only start from a gesture.
    const unlock = (): void => this.sound.unlock();
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    this.feedback = new Feedback(this.sound, this.pad, this.cam);
    const sets = (opts.match.format?.setsToWin ?? 2) * 2 - 1;
    // Score rows name the players: YOU, and each AI by its playing style.
    const who = (i: number, short: boolean): string => {
      const st = this.sim.ai[i]?.style;
      return !opts.autoplay && i === opts.human ? 'YOU' : st ? (short ? st.short : st.name) : 'AI';
    };
    const row = (t: number): string => (this.sim.doubles ? `${who(t, true)} · ${who(t + 2, true)}` : who(t, false));
    const names: [string, string] = [row(0), row(1)];
    this.hud = new Hud(hudRoot, names, sets);
    if (opts.gfx === 'tv') {
      const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
      this.tv = new TvGraphics(hudRoot, names, [hex(kitFor(0).shirt), hex(kitFor(1).shirt)], sets, this.sim);
    }
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
    if (this.photo) {
      const { w, h } = this.photo.fit();
      this.renderer.setSize(w, h, false);
      this.photo.fit();
      // A photo with no solved camera keeps the broadcast camera, at the photo's shape.
      if (!this.photo.entry.cam) {
        this.cam.camera.aspect = w / h;
        this.cam.camera.updateProjectionMatrix();
      }
      return;
    }
    this.renderer.setSize(innerWidth, innerHeight);
    this.cam.camera.aspect = innerWidth / innerHeight;
    this.cam.camera.updateProjectionMatrix();
  }

  /** Compile every pipeline before the first point so nothing compiles mid-rally. */
  async warmUp(): Promise<void> {
    this.cam.update(this.sim, this.team, null, 0);
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    await this.renderer.compileAsync(this.scene, this.cam.camera);
    // The post passes' own shaders compile on their first frame: draw one now.
    if (this.post) this.post.render();
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
    // The pad's stick, when it is pushed, wins over the keys.
    const pad = this.pad.x !== 0 || this.pad.y !== 0;
    f.moveX = pad ? this.pad.x : this.axes.x;
    f.moveY = pad ? this.pad.y : this.axes.y;
    // Button events that happened before the end of this tick, with their exact sim times; the buttons held are
    // those events' result at the tick's end (the keys as they are now can be a frame later than the tick).
    const endMs = this.epoch + t1 * 1000;
    const q = this.kb.queue;
    while (this.kb.head < this.kb.tail) {
      const e = q[this.kb.head % q.length]!;
      if (e.ts >= endMs) break;
      f.push(e.press, e.button, Math.max(0, (e.ts - this.epoch) / 1000));
      this.simHeld = e.press ? this.simHeld | e.button : this.simHeld & ~e.button;
      this.kb.head++;
      if (this.latency.length < 4000) this.latency.push({ ts: e.ts, used: this.frameNow, shown: 0, gpu: 0, press: e.press });
    }
    void t0;
    // Every event handed over: the keys as they are now are the same state (unless the ring dropped one: resync).
    if (this.kb.head === this.kb.tail) this.simHeld = this.kb.held | this.pad.held;
    f.held = this.simHeld;
    if (this.mouseAim && this.mouseOnCourt) {
      f.aimAbs = true;
      f.aimTX = this.aimMarker.position.x;
      f.aimTZ = this.aimMarker.position.z;
    }
    return f;
  }

  private readonly inputs: Array<InputFrame | null>;
  /** Buttons held as of the last event handed to the sim. */
  private simHeld = 0;

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

  /** Draw the current moment once, outside the animation loop (captures). */
  renderOnce(): void {
    for (const p of this.players) p.avatar?.refreshSkin();
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    this.draw();
  }

  private draw(): void {
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.cam.camera);
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
    if (this.pad.connected) {
      this.pad.poll(this.kb, now);
      if (this.pad.held !== 0) this.sound.unlock();
    }
    // ...except while the human holds a swing: the release can come for any moment from now on, and one that
    // arrives for a moment the sim has already run past would meet the ball up to a tick late. Until it goes the
    // sim stays at or behind now, and is drawn a tick behind (the render clock below).
    const hp = this.sim.players[human]!;
    const holding = ahead && !this.opts.autoplay;
    // The render clock: now, less a lag. While a swing is held the sim stays at or behind now, so drawing now would
    // mean drawing the newest tick as it is (no blend: a repeated frame whenever a frame has no new tick, every
    // sixth frame at 144 Hz). Instead the lag eases to one tick while a swing is held (blended, as ?runahead=0
    // draws) and back to none after, the render clock running 25% slow or fast meanwhile. It stays until the
    // contact. The sim is stepped to the drawn moment (now less the lag), not to now: stepped to now while the lag
    // is still a tick, the oldest state it keeps (a tick before its newest) is past the drawn moment and the picture
    // is pulled forward by up to a tick at the release, then drawn unblended, frames repeating, until the contact.
    const swinging = hp.swing === SW_CHARGE || hp.swing === SW_COMMITTED;
    const lagTo = !ahead || (holding && swinging) ? DT : 0;
    const ease = this.lastFrame ? 0.25 * Math.min(0.1, (now - this.lastFrame) / 1000) : DT;
    this.renderLag = lagTo > this.renderLag ? Math.min(lagTo, this.renderLag + ease) : Math.max(lagTo, this.renderLag - ease);
    let drawn = simNow - this.renderLag;
    if (this.paused) {
      this.epoch = now - this.sim.time * 1000;
      drawn = this.sim.time;
    }
    while (this.sim.time < drawn && n < MAX_TICKS_PER_FRAME) {
      if (holding && hp.swing === SW_CHARGE && this.sim.time + DT > simNow) break;
      this.inputs[human] = this.buildInput(this.sim.time, this.sim.time + DT);
      this.sim.step(this.inputs);
      n++;
    }
    let cueNow = simNow;
    if (n === MAX_TICKS_PER_FRAME) {
      // Drop a backlog rather than spiral; draw from the new clock (the old one would draw the newest tick and step
      // back next frame). Keys still queued keep their wall-clock stamps, which are now in the sim's past: they are
      // moved up to now, or a release made during the hitch is graded up to 0.2 s early and struck late.
      this.epoch = now - this.sim.time * 1000;
      drawn = this.sim.time - this.renderLag;
      cueNow = this.sim.time;
      this.kb.clampQueue(now);
    }
    const simMs = performance.now() - s0;
    const renderTime = Math.min(this.sim.time, Math.max(this.sim.time - DT, drawn));
    const alpha = (renderTime - (this.sim.time - DT)) / DT;

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
    const who = this.opts.autoplay ? -1 : human;
    // Feedback before the camera, so a smash's kick starts in the frame that shows the hit (pan reads last
    // frame's camera, which is close enough).
    this.feedback.update(this.sim, who, renderTime, now);
    this.cam.update(this.sim, team, this.ball.mesh.position, now / 1000);
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    this.assists.update(this.sim, who, this.ball.mesh.position, this.cam.camera, renderTime, this.opts.match.timingScale ?? 1,
      now / 1000, frameDt, cueNow);
    this.hud.update(this.sim, who, now / 1000);
    this.tv?.update(this.sim);
    // The crowd follows the rally: calm between points, rising with a long one.
    this.arena.excite = this.sim.phase === PH_RALLY ? Math.min(1, this.sim.rally.shots / 14) : this.arena.excite * Math.exp(-frameDt / 0.8);
    // Stands behind the camera are skipped, but not while it swings round (a very wide screen sees them) or in
    // photo-match mode (the photo's camera can stand anywhere).
    this.arena.update(now / 1000, this.cam.swinging || this.photo ? undefined : this.cam.camera.position);

    this.draw();
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
