// The browser game: fixed-step sim driven by requestAnimationFrame, timestamped input, render interpolation.
import * as THREE from 'three/webgpu';
import { MatchSim, PH_RALLY, PH_OVER, type MatchConfig } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import { InputFrame } from '../sim/input.ts';
import { SW_CHARGE, SW_COMMITTED } from '../sim/player/player.ts';
import { buildCourtView, type CourtView } from '../render/courtView.ts';
import { Arena, arenaDef } from '../render/arena/arena.ts';
import { NetView } from '../render/netView.ts';
import { BallView, PlayerView, BroadcastCamera, AssistView, ReplayCamera, type CameraPreset } from '../render/views.ts';
import { Replays, RP_IDLE, RP_PREP, RP_SHOW } from './replay.ts';
import { dealNames, nameOf, type PlayerName } from './names.ts';
import { KeyboardInput } from './input/keyboard.ts';
import { GamepadInput } from './input/gamepad.ts';
import { DEFAULT_KEYS } from './input/bindings.ts';
import { AudioEngine } from '../audio/engine.ts';
import { Soundscape, type FeetSource } from '../audio/soundscape.ts';
import { FLOOR_NAMES } from '../audio/voices.ts';
import { Feedback } from './feedback.ts';
import type { PlayerAsset } from '../render/avatar/asset.ts';
import { Hud } from '../ui/hud.ts';
import { TvGraphics } from '../ui/tv.ts';
import { Post } from '../render/post.ts';
import { kitFor } from '../render/avatar/kit.ts';
import { DebugOverlay } from '../ui/debug.ts';
import { applyPhotoCam, type PhotoOverlay } from './photoMatch.ts';
import { MatchStats } from './stats.ts';
import { CrowdMood } from './crowdMood.ts';
import { disposeTree } from '../render/dispose.ts';
import { Transitions } from '../ui/transitions.ts';
import { Announcer } from '../ui/announce.ts';
import { QUALITY, type QualityPreset } from '../render/quality.ts';
import { displayPeriod, stopDisplaySample } from '../render/display.ts';

const MAX_TICKS_PER_FRAME = 12;
/** After match point: the results come OVER_HOLD_MS after the players have played the end out (MatchSim.overStage 4),
 * at the latest OVER_MAX_MS after it; Enter or Space skips to them from OVER_SKIP_AFTER_MS. */
const OVER_HOLD_MS = 1500;
const OVER_MAX_MS = 14000;
const OVER_SKIP_AFTER_MS = 800;

export interface GameOptions {
  match: MatchConfig;
  /** Perf runs only: draw this many times the pixels (a slower GPU's stand-in; tools/perf.mjs igpu). */
  gpuLoad?: number;
  /** Perf runs only: at most this many frames a second (a display's refresh, with the browser's limit off). */
  fpsCap?: number;
  /** Review only (`?cam=hand|body|ball|face`, `&camp=N` the player): a close camera on a player's racket hand, the whole
   * player, or the ball, instead of the broadcast camera. */
  closeCam?: string;
  closeCamPlayer?: number;
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
  /** Sound (`?sound=0` turns it off). */
  sound?: boolean;
  /** Arena (data/arenas.json): stadium, hall, club-day, club-night. */
  arena?: string;
  /** `tv`: the broadcast graphics package (ui/tv.ts) instead of the plain score bug. */
  gfx?: string;
  /** Lens bloom (render/post.ts); `?bloom=0` renders straight to the screen. */
  bloom?: boolean;
  /** The close camera while the players walk back between points (render/views.ts); `?cutaway=0` keeps the
   * broadcast angle. */
  cutaway?: boolean;
  /** Instant replays of big points (game/replay.ts); `?replays=0` turns them off. */
  replays?: boolean;
  /** Settings > Camera (render/views.ts CAMERA_PRESETS); `?camera=`. */
  camera?: CameraPreset;
  /** `?dpr=`: the most pixels per CSS pixel to draw, whatever the preset (tools). */
  dprCap?: number;
  /** The AI match behind the title screen: no HUD, no banners. */
  attract?: boolean;
  /** Phase 8: what the settings change in a game (all optional; tools leave them out). */
  prefs?: GamePrefs;
}

export interface GamePrefs {
  /** Master volume and the crowd's level, 0..1. */
  volume?: number;
  crowd?: number;
  /** Camera kick on smashes (off with reduced motion). */
  shake?: boolean;
  rumble?: boolean;
  /** Speak points and the score through an ARIA live region. */
  announce?: boolean;
  /** Keyboard bindings (input/bindings.ts). */
  keys?: Record<string, string[]>;
  /** Quality preset (render/quality.ts); the pixel ratio also adapts (render scale) when `adapt` is on. */
  quality?: QualityPreset;
  adapt?: boolean;
  /** The dip between points and the score card between games (ui/transitions.ts). */
  transitions?: boolean;
  /** Pro mode (no timing cues) and mouse aim, as the Gameplay settings set them (P and M still toggle in play). */
  pro?: boolean;
  mouseAim?: boolean;
  /** Settings > Camera and Replays. */
  camera?: CameraPreset;
  replays?: boolean;
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
  /** GPU time of each frame's render passes, ms (only with ?gputime=1, where the GPU supports timestamp queries). */
  gpus: number[];
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
  /** Sound (Phase 6): the engine, and what decides what is heard. */
  readonly audio: AudioEngine;
  private audioFailed = false;
  readonly soundscape: Soundscape;
  private readonly feetSrc: FeetSource[];
  readonly feedback: Feedback;
  readonly hud: Hud;
  readonly debug: DebugOverlay;
  readonly frame = new InputFrame();
  readonly aimMarker: THREE.Mesh;
  private mouseOnCourt = false;
  readonly probe: PerfProbe = { frames: [], sims: [], works: [], gpus: [], drawCalls: 0, triangles: 0, backend: '', points: 0 };
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
  /** Paused by a menu (Esc, Start): the sim, the sound and the input all wait. */
  private menuPaused = false;
  /** Every listener this game adds goes when it is torn down. */
  private readonly ac = new AbortController();
  /** This game's own layer of the HUD (removed with it). */
  private readonly hudLayer: HTMLElement;
  /** Results-screen numbers. */
  readonly stats = new MatchStats();
  private readonly crowdMood = new CrowdMood();
  private readonly transitions: Transitions | null;
  private announcer: Announcer | null;
  /** Esc or the pad's Start: the app opens the pause menu. */
  onMenu: (() => void) | null = null;
  /** The match is over and its last call has been shown. */
  onMatchOver: ((stats: MatchStats) => void) | null = null;
  /** Instant replays (game/replay.ts) and their cameras; whether the last frame drew one. */
  readonly replays: Replays;
  private readonly replayCam = new ReplayCamera();
  private replayShown = false;
  private replayPad = 0;
  /** The players' names, dealt from the match's seed (game/names.ts). */
  names: PlayerName[] = [];
  private overAt = -1;
  private overDoneAt = -1;
  private overSkip = false;
  private overSent = false;
  /** Render scale under the preset's pixel ratio (1 = full); adapted when frames run long (prefs.adapt). */
  renderScale = 1;
  private readonly preset: QualityPreset;
  private slowFrames = 0;
  private fastFrames = 0;
  private disposed = false;

  constructor(opts: GameOptions, renderer: THREE.WebGPURenderer, hudRoot: HTMLElement) {
    this.opts = opts;
    this.renderer = renderer;
    this.mouseAim = opts.mouseAim;
    this.prefPro = opts.pro;
    this.prefMouse = opts.mouseAim;
    const prefs = opts.prefs ?? {};
    this.preset = prefs.quality ?? QUALITY.high;
    // The display's period as measured while the page loaded (frames get expensive from here on).
    stopDisplaySample();
    this.period = displayPeriod();
    this.hudLayer = hudRoot.appendChild(document.createElement('div'));
    this.hudLayer.className = 'layer';
    this.hudLayer.style.cssText = opts.attract ? 'display:none' : 'position:absolute;inset:0';
    hudRoot = this.hudLayer;
    this.sim = new MatchSim(opts.match);
    const court = this.sim.world.court;

    // The arena: floor, lights, surroundings; the court's glass, mesh and frame in its colours.
    this.arena = new Arena(arenaDef(opts.arena ?? 'stadium', opts.match.world?.floor), court, this.scene, renderer);
    // The preset's shadow map (before anything is drawn: the map is made at the first shadow pass).
    if (this.preset.shadow > 0) this.arena.key.shadow.mapSize.set(this.preset.shadow, this.preset.shadow);
    else this.arena.key.castShadow = false;
    this.court = buildCourtView(court, { frame: this.arena.def.frame, base: this.arena.def.base });
    this.scene.add(this.court.group);
    this.arena.addNeighbours(this.court.group, court);
    this.net = new NetView(this.sim.net);
    this.scene.add(this.net.group);

    this.cam = new BroadcastCamera(innerWidth && innerHeight ? innerWidth / innerHeight : 16 / 9, this.arena.def.camera?.swingRise ?? 0);
    const bl = this.arena.def.post?.bloom;
    if (bl && opts.bloom !== false && this.preset.bloom) this.post = new Post(renderer, this.scene, this.cam.camera, bl);
    BroadcastCamera.cutaways = opts.cutaway !== false;
    this.cam.setPreset(opts.camera ?? 'tv');
    this.cam.followPlayer = opts.autoplay ? 0 : opts.human;
    // Replays re-run a point from a copy of the match (two more matches: about 2 MB, nothing per frame).
    this.replays = new Replays(opts.match, opts.autoplay ? -1 : opts.human);
    this.replays.enabled = opts.replays !== false && !opts.closeCam;
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

    const sig = this.ac.signal;
    this.kb = new KeyboardInput(window, sig, prefs.keys);
    this.pad = new GamepadInput(window, sig);
    this.pad.rumbleOn = prefs.rumble !== false;
    // Start while a menu is up is the menu's (it resumes from the pause screen).
    this.pad.onStart = () => { if (!this.menuPaused) this.onMenu?.(); };
    // Sound: the bank renders in a worker from now; audio starts at the first key, click or pad press (browsers
    // allow it only from a gesture). Autoplay too: a click and the AI match has sound.
    const floor = Math.max(0, FLOOR_NAMES.indexOf(opts.match.world?.floor ?? 'turf'));
    this.audio = new AudioEngine({ floor, arena: opts.arena ?? 'stadium' });
    this.audio.enabled = opts.sound !== false;
    this.audio.setLevels(prefs.volume ?? 1, prefs.crowd ?? 1);
    this.audio.load();
    this.soundscape = new Soundscape(this.audio, opts.arena ?? 'stadium', this.arena.def.neighbours ?? []);
    this.feetSrc = this.players.map((pv) => ({ feet: pv.avatar ? pv.avatar.feet : null }));
    const unlock = (): void => this.audio.unlock();
    addEventListener('keydown', unlock, { signal: sig });
    addEventListener('pointerdown', unlock, { signal: sig });
    this.feedback = new Feedback(this.pad, this.cam);
    this.feedback.shake = prefs.shake !== false;
    const sets = (opts.match.format?.setsToWin ?? 2) * 2 - 1;
    // Score rows name the players: YOU, and each AI by the name dealt from the seed (game/names.ts).
    this.names = dealNames(opts.match.seed ?? 0, this.sim.players.length);
    const who = (i: number, short: boolean): string => (!opts.autoplay && i === opts.human ? 'YOU' : nameOf(this.names[i]!, short));
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
    // The help panel and the hints name the keys in use (remapped keys included) and the swing mode.
    this.hud.setKeys(prefs.keys ?? DEFAULT_KEYS, !!(opts.match.tapSwing && opts.match.autoTiming));
    this.kb.onKey = (code) => this.onKey(code);
    this.transitions = prefs.transitions === false || opts.autoplay ? null : new Transitions(hudRoot, names);
    this.announcer = prefs.announce && !opts.autoplay ? new Announcer(hudRoot) : null;

    addEventListener('resize', () => this.resize(), { signal: sig });
    // Leaving the game (another window, a hidden tab, the controller gone) opens the pause menu, so a point
    // isn't played on without you; outside a match onMenu does nothing.
    addEventListener('blur', () => this.onMenu?.(), { signal: sig });
    this.pad.onLost = () => this.onMenu?.();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onMenu?.();
      // Freeze the sim while the tab is hidden instead of fast-forwarding on return.
      this.audio.pause(document.hidden || this.menuPaused);
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt >= 0) {
        this.epoch += performance.now() - this.hiddenAt;
        this.hiddenAt = -1;
      }
    }, { signal: sig });
    this.probe.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.gpuTimed = (renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true;
    this.applyPixelRatio();
  }

  private onKey(code: string): void {
    if (this.menuPaused) return;
    if (code === 'Escape') this.onMenu?.();
    else if (code === 'F3') this.debug.toggle();
    else if (code === 'KeyH') this.hud.toggleHelp();
    else if (code === 'KeyP') this.setPro(!this.hud.pro);
    else if (code === 'KeyM') this.mouseAim = !this.mouseAim;
    // (not at once: a key pressed for the last shot is not a skip)
    else if ((code === 'Enter' || code === 'Space') && this.replays.state !== RP_IDLE) this.replays.stop();
    else if ((code === 'Enter' || code === 'Space') && this.overAt >= 0 && performance.now() - this.overAt > OVER_SKIP_AFTER_MS) this.overSkip = true;
  }

  /** Pro mode: no closing ring, meter, trail or bounce marker. */
  private setPro(on: boolean): void {
    this.hud.pro = on;
    this.ball.showTrail = !on;
    this.ball.showMarker = !on;
    this.assists.enabled = !on;
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

  /** The preset's pixel ratio times the render scale (`?dpr=` caps it for tools). */
  applyPixelRatio(): void {
    const cap = Math.min(devicePixelRatio || 1, this.preset.maxDpr, this.opts.dprCap ?? 4);
    // ?gpuload=N (perf runs): N times the pixels, a stand-in for a GPU N times slower at fill-rate-bound work.
    const r = Math.max(0.5, cap * this.preset.scale * this.renderScale) * Math.sqrt(this.opts.gpuLoad ?? 1);
    if (Math.abs(r - this.renderer.getPixelRatio()) > 1e-3) {
      this.renderer.setPixelRatio(r);
      this.resize();
    }
  }

  /** Stop the sim, the sound and the input for a menu; resume where it was. */
  setMenuPaused(on: boolean): void {
    if (on === this.menuPaused) return;
    this.menuPaused = on;
    // Pausing drops what was queued (the menu has the keys now); resuming lets go, at this moment, of any swing
    // the sim still holds that no key or button holds any more (KeyboardInput.resume).
    if (on) this.kb.flush();
    else {
      this.kb.resume(this.simHeld, this.pad.held, performance.now());
      this.pad.consumeStart();
    }
    this.audio.pause(on || document.hidden);
    this.hudLayer.classList.toggle('paused', on);
  }

  get isMenuPaused(): boolean {
    return this.menuPaused;
  }

  /**
   * Settings changed in a menu while this game runs: everything that doesn't change the sim's own configuration
   * applies at once. The timing window, the assist, auto timing and the swing mode are the sim's (MatchConfig): a
   * replay is the seed and the input frames under one configuration, so those wait for the next match (their
   * descriptions say so), as the quality preset does.
   */
  applyPrefs(p: GamePrefs): void {
    if (p.volume !== undefined || p.crowd !== undefined) this.audio.setLevels(p.volume ?? 1, p.crowd ?? 1);
    if (p.shake !== undefined) this.feedback.shake = p.shake;
    if (p.rumble !== undefined) this.pad.rumbleOn = p.rumble;
    if (p.keys) {
      this.kb.setKeys(p.keys);
      this.hud.setKeys(p.keys, !!(this.opts.match.tapSwing && this.opts.match.autoTiming));
    }
    if (p.pro !== undefined && p.pro !== this.prefPro) { this.prefPro = p.pro; this.setPro(p.pro); }
    if (p.mouseAim !== undefined && p.mouseAim !== this.prefMouse) { this.prefMouse = p.mouseAim; this.mouseAim = p.mouseAim; }
    if (p.camera !== undefined) this.cam.setPreset(p.camera);
    if (p.replays !== undefined) { this.replays.enabled = p.replays && !this.opts.closeCam; if (!p.replays) this.replays.stop(); }
    if (p.announce !== undefined && !this.opts.autoplay && p.announce !== !!this.announcer) {
      if (p.announce) this.announcer = new Announcer(this.hudLayer, this.sim);
      else { this.announcer?.dispose(); this.announcer = null; }
    }
    this.hud.applyPalette();
  }

  /** The pro and mouse-aim settings last applied (P and M toggle in play; only a change of the setting overrides). */
  private prefPro: boolean | undefined = undefined;
  private prefMouse: boolean | undefined = undefined;

  /** Tear the game down: the loop, listeners, sound, the HUD layer and every GPU resource. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.ac.abort();
    this.audio.close();
    this.announcer?.dispose();
    this.hudLayer.remove();
    this.post?.dispose();
    this.net.dispose();
    this.arena.dispose();
    disposeTree(this.scene);
    this.scene.clear();
    this.scene.environment = null;
    this.scene.background = null;
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
      // Who you are playing (and with): the names dealt, their nations, and their playing styles as nicknames.
      const name = (i: number): string => `${nameOf(this.names[i]!, false)} (${this.names[i]!.nation})`;
      const style = (i: number): string => this.sim.ai[i]?.style.name ?? '';
      const them = 1 - this.team;
      const mate = this.opts.human ^ 2;
      const title = this.sim.doubles ? `vs ${name(them)} & ${name(them + 2)}` : `vs ${name(them)}`;
      const sub = this.sim.doubles
        ? `${style(them)} & ${style(them + 2)} · Your partner: ${name(mate)}, ${style(mate)}`
        : style(them);
      this.hud.announce(title, sub, performance.now() / 1000, 3);
    }
    this.epoch = performance.now() - this.sim.time * 1000;
    this.renderer.setAnimationLoop(() => this.tick());
    this.running = true;
  }

  /** start() has run (tools wait for this; the page exposes the game before its warm-up). */
  running = false;
  /** GPU timestamps are on (?gputime=1 and the GPU has them); one read-back at a time. */
  private gpuTimed = false;
  private gpuBusy = false;

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
    this.simHeld = this.kb.feed(f, this.epoch, endMs, this.simHeld, this.onFed);
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
  /** The latency probe's record of each event handed to the sim (allocates only on key events). */
  private readonly onFed = (ts: number, press: boolean): void => {
    if (this.latency.length < 4000) this.latency.push({ ts, used: this.frameNow, shown: 0, gpu: 0, press });
  };

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

  private readonly closeAt = new THREE.Vector3();
  private readonly closeEye = new THREE.Vector3();
  /** `?cam=`: a close look for reviews (not a game camera: it allocates nothing but isn't smoothed). */
  private aimCloseCam(kind: string): void {
    const pv = this.players[Math.min(this.players.length - 1, this.opts.closeCamPlayer ?? 0)]!;
    const cam = this.cam.camera;
    const at = this.closeAt;
    const root = pv.root.position;
    const side = root.z >= 0 ? 1 : -1;
    if (kind === 'ball') {
      at.copy(this.ball.mesh.position);
      this.closeEye.set(at.x + 0.35, at.y + 0.12, at.z + 0.9 * side);
    } else if (kind === 'hand' && pv.avatar) {
      pv.avatar.racket.getWorldPosition(at);
      this.closeEye.set(at.x + 0.9, at.y + 0.25, at.z + 1.1 * side);
    } else if (kind === 'face' && pv.avatar) {
      // Into the face, a little off to the side (the body faces its root's +z).
      pv.avatar.root.getObjectByName('Head')!.getWorldPosition(at);
      at.y += 0.08;
      this.closeEye.set(0.25, 0.02, 0.85).applyQuaternion(pv.root.quaternion).add(at);
    } else {
      at.set(root.x, 0.95, root.z);
      this.closeEye.set(at.x + 1.6, 1.35, at.z + 3.2 * side);
    }
    cam.position.copy(this.closeEye);
    cam.lookAt(at);
    cam.updateMatrixWorld();
  }

  /** Draw the current moment once, outside the animation loop (captures). */
  renderOnce(): void {
    for (const p of this.players) p.avatar?.refreshSkin();
    // A frame of three's own: its animation loop advances the node frame, and passes that update once a frame (the
    // post-processing's scene pass) kept showing their first render in a hidden tab, where no animation frame runs.
    const r = this.renderer as unknown as { _nodes?: { nodeFrame: { update(): void; frameId: number } }; info: { frame: number } };
    if (r._nodes) { r._nodes.nodeFrame.update(); r.info.frame = r._nodes.nodeFrame.frameId; }
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
    // A game torn down inside its own frame (a callback below rebuilt the app's game) draws nothing more.
    if (this.disposed) return;
    let now = performance.now();
    // ?fpscap=N (perf runs with the browser's frame limit off): draw at most N frames a second, as a display's
    // refresh would pace them, so the GPU queue never fills the way an unpaced run fills it. The main thread waits
    // (as it would for vsync) rather than skipping the frame: headless Chrome holds back the next animation frame
    // after one that drew nothing, which paced a 120 Hz cap at 52 Hz.
    const cap = this.opts.fpsCap ?? 0;
    if (cap > 0 && this.lastFrame > 0) {
      const until = this.lastFrame + 1000 / cap - 0.05;
      while (now < until) now = performance.now();
    }
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
      if (this.pad.held !== 0) this.audio.unlock();
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
    // A replay due: the live match waits (as for a menu) while the point is shown again.
    const rp = this.replays;
    if (rp.state === RP_IDLE && rp.due >= 0 && this.sim.time >= rp.due && !this.menuPaused) {
      if (this.photo || !rp.enabled) rp.stop();
      else { rp.begin(); this.kb.flush(); this.replayPad = this.pad.held; }
    }
    if (this.paused || this.menuPaused || rp.state !== RP_IDLE) {
      this.epoch = now - this.sim.time * 1000;
      drawn = this.sim.time;
    }
    while (this.sim.time < drawn && n < MAX_TICKS_PER_FRAME) {
      if (holding && hp.swing === SW_CHARGE && this.sim.time + DT > simNow) break;
      this.inputs[human] = this.buildInput(this.sim.time, this.sim.time + DT);
      rp.beforeStep(this.sim, this.inputs[human] ?? null);
      this.sim.step(this.inputs);
      rp.afterStep(this.sim);
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
    // The replay: re-run up to its start over a few frames, then drawn in place of the live match, on its own
    // clock (slowed round the winning shot) and cameras. A pad button pressed since it began skips it.
    if (rp.state === RP_PREP && !this.menuPaused) rp.prepare();
    if (rp.state === RP_SHOW && !this.menuPaused) {
      if ((this.pad.held & ~this.replayPad) !== 0) rp.stop();
      else rp.advance(frameDt);
    }
    const showing = rp.state === RP_SHOW;
    if (showing !== this.replayShown) {
      this.replayShown = showing;
      for (const pv of this.players) pv.cutNext();
      this.ball.cutNext();
      this.hud.setReplay(showing);
      if (showing) this.replayCam.reset();
      else {
        this.cam.retake();
        this.kb.resume(this.simHeld, this.pad.held, now);
        this.epoch = now - this.sim.time * 1000;
      }
    }
    const view = showing ? rp.sim : this.sim;
    const vAlpha = showing ? rp.alpha : alpha;
    const vTime = showing ? rp.clock : renderTime;
    const marker = this.ball.showMarker;
    if (showing) this.ball.showMarker = false;
    this.ball.update(view, vAlpha, team);
    this.ball.showMarker = marker;
    this.net.update(view, vAlpha);
    for (let i = 0; i < this.players.length; i++) this.players[i]!.update(view, view.players[i]!, i, vAlpha, vTime);
    const who = this.opts.autoplay || showing ? -1 : human;
    // Feedback before the camera, so a smash's kick starts in the frame that shows the hit (pan reads last
    // frame's camera, which is close enough).
    this.feedback.update(this.sim, who, now);
    if (showing) this.replayCam.aim(this.cam.camera, view, rp.hitter, rp.angle, this.ball.mesh.position, frameDt * rp.speed);
    else this.cam.update(this.sim, team, this.ball.mesh.position, now / 1000);
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    if (this.opts.closeCam) this.aimCloseCam(this.opts.closeCam);
    // Sound never takes a frame down: a browser's WebAudio quirk (Firefox has no listener.positionX) once threw on
    // every play and the frame's assists, HUD and draw were skipped.
    try {
      this.audio.setListener(this.cam.camera);
      this.soundscape.update(this.sim, renderTime, this.feetSrc, frameDt);
      if (this.ball.routineBounce) this.soundscape.routineBounce(this.ball.mesh.position.x, this.ball.mesh.position.z);
    } catch (e) {
      if (!this.audioFailed) { this.audioFailed = true; console.warn('audio', e); }
    }
    this.assists.update(this.sim, who, this.ball.mesh.position, this.cam.camera, renderTime, this.opts.match.timingScale ?? 1,
      now / 1000, frameDt, cueNow);
    this.hud.update(this.sim, who, now / 1000);
    this.tv?.update(this.sim);
    this.stats.update(this.sim);
    this.transitions?.update(this.sim, team, now / 1000);
    this.announcer?.update(this.sim, team);
    // The match is over: the players play it out (MatchSim.overStage: reactions, the walk to the net, rackets
    // touched across it), then the app shows the results. Enter or Space skips to them (overSkip).
    if (this.sim.phase === PH_OVER && !this.overSent) {
      if (this.overAt < 0) this.overAt = now;
      if (this.sim.overStage >= 4 && this.overDoneAt < 0) this.overDoneAt = now;
      const done = this.overDoneAt >= 0 && now - this.overDoneAt > OVER_HOLD_MS;
      if ((done || this.overSkip || now - this.overAt > OVER_MAX_MS) && this.onMatchOver) {
        this.overSent = true;
        this.onMatchOver(this.stats);
        if (this.disposed) return;
      }
    }
    // The crowd follows the rally: tense with a long one, applauding after a point, on its feet at the big moments.
    const mood = this.arena.mood;
    mood.excite = this.sim.phase === PH_RALLY ? Math.min(1, this.sim.rally.shots / 14) : mood.excite * Math.exp(-frameDt / 0.8);
    this.crowdMood.update(this.sim, frameDt);
    mood.applause = this.crowdMood.applause;
    mood.ovation = this.crowdMood.ovation;
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
    if (this.gpuTimed && !this.gpuBusy) {
      // One read-back in flight at a time; each gives the latest frame's passes (three keeps one query pair per pass).
      this.gpuBusy = true;
      void this.renderer.resolveTimestampsAsync('render').then((ms) => {
        this.gpuBusy = false;
        if (typeof ms === 'number' && ms > 0 && this.probe.gpus.length < 100000) this.probe.gpus.push(ms);
      }, () => { this.gpuBusy = false; });
    }
    this.debug.frame(now, simMs, n, info.drawCalls, info.triangles, this.probe.backend, this.renderer.getPixelRatio());
    if (this.opts.prefs?.adapt) this.adapt(dt);
  }

  /**
   * Dynamic resolution (quality "auto"): frames that miss 60 Hz for about half a second bring the render scale down a
   * step; a long run with none tries a step up again, waiting twice as long each time a step up had to come back
   * down (on a 60 Hz screen every frame takes 16.7 ms, so headroom can only be found by trying). Only the pixel
   * ratio changes: no shader compiles mid-point.
   *
   * A frame is slow against the display's own period (`period`), not against 60 Hz alone: on a 50 Hz screen or
   * under a browser's 30 Hz cap every frame is 20 or 33 ms, and counting those as slow took the scale to its floor
   * for good. Slow is over max(18.5 ms, 1.25 periods): a missed refresh on a screen of 60 Hz or less, a miss of
   * 60 Hz on a faster one. The period comes from the load (render/display.ts) and is lowered when frames run faster
   * than it (the 10th percentile of the last 256). If nothing was measured, the 10th percentile is the period.
   * And a check for what can't be told apart by intervals alone (a GPU too slow for 60 Hz on a 60 Hz screen
   * gives 33 ms frames as a 30 Hz cap does): if the scale reaches its floor and the median frame is no faster than
   * it was at full scale, pixels were never the limit (a cap, or the CPU), so the scale goes back to full and that
   * frame time is the period from then on.
   */
  private adapt(dt: number): void {
    if (dt <= 0 || dt > 100 || this.menuPaused) return;
    this.gaps[this.gapN & 255] = dt;
    this.gapN++;
    if ((this.gapN & 31) === 0) {
      const p10 = this.gapStats();
      if (this.period === 0 || p10 < 0.8 * this.period) this.period = p10;
      // At the floor for a whole window: did the smaller picture make the frames faster?
      if (this.medAtFull > 0 && this.renderScale <= 0.6 + 1e-6 && this.atFloor >= 256) {
        if (this.gapMedian >= 0.95 * this.medAtFull) {
          this.period = Math.max(this.period, this.medAtFull);
          this.renderScale = 1;
          this.slowFrames = 0;
          this.fastFrames = 0;
          this.applyPixelRatio();
        }
        this.medAtFull = 0;
      }
    }
    if (this.renderScale <= 0.6 + 1e-6) this.atFloor++;
    else this.atFloor = 0;
    const limit = Math.max(18.5, 1.25 * this.period);
    if (dt > limit) { this.slowFrames++; this.fastFrames = 0; }
    else { this.fastFrames++; this.slowFrames = Math.max(0, this.slowFrames - 0.25); }
    if (this.slowFrames > 30 && this.renderScale > 0.6) {
      if (this.renderScale >= 1 - 1e-6) { this.gapStats(); this.medAtFull = this.gapMedian; }
      this.renderScale = Math.max(0.6, this.renderScale - 0.1);
      this.slowFrames = 0;
      this.fastFrames = 0;
      if (this.raisedAt > 0 && performance.now() - this.raisedAt < 10000) this.upWait = Math.min(7200, this.upWait * 2);
      this.applyPixelRatio();
    } else if (this.fastFrames > this.upWait && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.1);
      this.fastFrames = 0;
      this.raisedAt = performance.now();
      this.applyPixelRatio();
    }
  }

  /** The 10th percentile of the frames held (up to the last 256), and their median into `gapMedian`. */
  private gapStats(): number {
    const n = Math.min(this.gapN, 256);
    const s = this.gapSort;
    s.set(this.gaps);
    if (n < 256) s.fill(Infinity, n);
    s.sort();
    this.gapMedian = s[n >> 1]!;
    return s[(n * 0.1) | 0]!;
  }

  /** Auto quality's record: the last 256 frame intervals (ms), a sorting copy, the display period (0 = unknown). */
  private readonly gaps = new Float64Array(256);
  private readonly gapSort = new Float64Array(256);
  private gapN = 0;
  private gapMedian = 0;
  private period = 0;
  /** The median frame when the scale first stepped down from full (0: not being checked), frames at the floor. */
  private medAtFull = 0;
  private atFloor = 0;

  private upWait = 900;
  private raisedAt = 0;
}
