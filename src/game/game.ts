// The browser game: fixed-step sim driven by requestAnimationFrame, timestamped input, render interpolation.
import * as THREE from 'three/webgpu';
import { MatchSim, PH_RALLY, PH_OVER, PH_SETUP, type MatchConfig } from '../sim/match.ts';
import { DT } from '../sim/core/constants.ts';
import { InputFrame } from '../sim/input.ts';
import { SW_CHARGE, SW_COMMITTED } from '../sim/player/player.ts';
import { buildCourtView, type CourtView } from '../render/courtView.ts';
import { Arena, arenaDef } from '../render/arena/arena.ts';
import { NetView } from '../render/netView.ts';
import { Grounding } from '../render/grounding.ts';
import { BallView, PlayerView, BroadcastCamera, AssistView, ReplayCamera, type CameraPreset } from '../render/views.ts';
import { Replays, RP_IDLE, RP_PREP, RP_SHOW } from './replay.ts';
import { Highlights, Reel, RL_IDLE, RL_PREP, RL_SHOW } from './highlights.ts';
import { PhotoCamera, PhotoControls, noPush } from './photoMode.ts';
import { ClipRecorder, clipType, saveFile, fileStem } from './clipRecorder.ts';
import { dealNames, nameOf, type PlayerName } from './names.ts';
import { dealCast, type Cast } from './cast.ts';
import { KeyboardInput } from './input/keyboard.ts';
import { GamepadInput } from './input/gamepad.ts';
import { Local, LOCAL_COLOURS, axisFlip, turnStick, type LocalSeat } from './locals.ts';
import { ChallengeRun, type ChallengeDef } from './challenge.ts';
import { GlassVision } from '../render/glassVision.ts';
import { InputLog, LogPlayer, type SavedLog } from './inputLog.ts';
import { DEFAULT_KEYS } from './input/bindings.ts';
import { AudioEngine } from '../audio/engine.ts';
import { GRUNT_WOMEN, GRUNT_WOMEN_GAIN, Soundscape, type FeetSource } from '../audio/soundscape.ts';
import { GRUNT_E } from '../audio/bank.ts';
import { BUS_PLAYERS } from '../audio/sink.ts';
import { FLOOR_NAMES } from '../audio/voices.ts';
import { Feedback } from './feedback.ts';
import type { PlayerAsset } from '../render/avatar/asset.ts';
import type { Wear } from '../render/avatar/costume.ts';
import { makeBag, makeBottle } from '../render/props.ts';
import { lowerStatic } from '../render/lod.ts';
import { PROP_LOD, pxPerMetreAt1 } from '../render/lodCore.ts';
import { Hud } from '../ui/hud.ts';
import { TvGraphics } from '../ui/tv.ts';
import { Post } from '../render/post.ts';
import { compileRounds } from '../render/compileUnits.ts';
import { kitFor } from '../render/avatar/kit.ts';
import { DebugOverlay } from '../ui/debug.ts';
import { applyPhotoCam, type PhotoOverlay } from './photoMatch.ts';
import { MatchStats } from './stats.ts';
import { CrowdMood } from './crowdMood.ts';
import { disposeTree } from '../render/dispose.ts';
import { Transitions } from '../ui/transitions.ts';
import { Announcer } from '../ui/announce.ts';
import { Umpire, pairName } from './umpire.ts';
import { UmpireVoice } from '../ui/umpireVoice.ts';
import { QUALITY, type QualityPreset } from '../render/quality.ts';
import { displayPeriod, stopDisplaySample } from '../render/display.ts';
import type { NetHooks } from '../net/netMatch.ts';

const MAX_TICKS_PER_FRAME = 12;
/** After match point: the results come OVER_HOLD_MS after the players have played the end out (MatchSim.overStage 4),
 * at the latest OVER_MAX_MS after it; Enter or Space skips to them from OVER_SKIP_AFTER_MS. */
/** A challenge's last ball is seen down before its results (ms). */
const RUN_OVER_HOLD_MS = 1400;
const OVER_HOLD_MS = 1500;
const OVER_MAX_MS = 16000;
const OVER_SKIP_AFTER_MS = 800;
/** How long the match's sound takes to go under a menu (s): the crowd dies away under the results, it doesn't cut. */
const HUSH_PAUSE = 0.15;
const HUSH_OVER = 4;

/** The longest the warm-up holds the loading screen (ms). */
const WARM_MAX_MS = 20000;

export interface GameOptions {
  /** The players are built by `addPlayers()`, called once their people have loaded, not by the constructor (the app
   * builds the rest of a match while they download). */
  deferPlayers?: boolean;
  /** The environment bake waits for `bake()` (the app runs it, its shaders built in pieces, while the players download);
   * without it the constructor bakes. warmUp bakes first if nothing has. */
  deferBake?: boolean;
  match: MatchConfig;
  /** Perf runs only: draw this many times the pixels (a slower GPU's stand-in; tools/perf.mjs igpu). */
  gpuLoad?: number;
  /** Perf runs only: at most this many frames a second (a display's refresh, with the browser's limit off). */
  fpsCap?: number;
  /** Review only (`?cam=hand|body|ball|face`, `&camp=N` the player): a close camera on a player's racket hand, the whole
   * player, or the ball, instead of the broadcast camera. */
  closeCam?: string;
  /** ?people=a,b,c,d: these people instead of the cast dealt from the seed. */
  people?: string[];
  /** The seed the cast and their names are dealt from (default the match's): a rematch keeps it. */
  castSeed?: number;
  /** A knock-out's later round: team 0 kept, opponents shuffled from this seed (cast.ts). */
  rivals?: number;
  /** The player's own character (app/character.ts; app/options.ts applyCharacter): their face is dealt to the human. */
  me?: import('../app/character.ts').Character;
  /** Each player's proportions by player number (cast.ts bodiesParam, the creator). */
  bodies?: Array<import('../render/avatar/proportions.ts').Proportions | null>;
  /** Each player's own skin and hair by player number (the creator's character; kit.ts SelfLook). */
  looks?: Array<import('../render/avatar/kit.ts').SelfLook | null>;
  /** Each player's own grunt (a character's: a voice of PLAYER_VOICES or null for the face's own, and a pitch -1..1
   * of about three semitones either way), by player number; null: the face's as dealt. */
  voices?: Array<{ voice: number | null; pitch: number } | null>;
  /** Each player's name, by player number (a roster pro's); null: dealt from the seed (game/names.ts). */
  names?: Array<import('./names.ts').PlayerName | null>;
  /** Each player's own racket colours (a character's, racketDesign.ts), by player number; null: the maker's. */
  designs?: Array<import('../render/avatar/racketDesign.ts').RacketColours | null>;
  closeCamPlayer?: number;
  /** The human's player number (team + 2 * slot); ignored with autoplay. With `locals`, the first of them. */
  human: number;
  /** Local multiplayer (M6, locals.ts): every player on this machine and their device; absent, `human` alone on the
   * keyboard and the first pad. The first is the camera's end. */
  locals?: LocalSeat[];
  /** A challenge (M6, challenge.ts): the run is scored as it is played, its rings drawn on court, its inputs recorded. */
  challenge?: ChallengeDef;
  /** A saved run's inputs (inputLog.ts) played back for player 0, nobody's devices: watching a best run. */
  playback?: SavedLog;
  autoplay: boolean;
  forceWebGL: boolean;
  pro: boolean;
  mouseAim: boolean;
  /** The animated player body (M2); null: the M1 capsules. */
  avatar: PlayerAsset | null;
  /** What each player wears beyond the suit, by player number (costume.ts; `?wear=`): looks only, never the sim. */
  wear?: Array<Wear | undefined>;
  /**
   * Render the present instead of one tick behind it (the sim runs up to one tick ahead of the clock and the
   * render interpolates back to now). Saves one tick (8.3 ms) of input-to-screen latency; `?runahead=0` is the
   * old way.
   */
  runAhead?: boolean;
  /** Sound (`?sound=0` turns it off). */
  sound?: boolean;
  /** Arena (data/arenas.json): stadium, hall, club-day, club-night, and the career's secret club-dusk and final. */
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
  /** Establishing shots between points (render/views.ts EST_*): the title's match, behind ?creator=1 (M7 phase F). */
  establish?: boolean;
  /** Instant replays in two takes (game/replay.ts `twoTakes`), behind ?creator=1 (M7 phase B). */
  replayTakes?: boolean;
  /** Phase 8: what the settings change in a game (all optional; tools leave them out). */
  prefs?: GamePrefs;
}

export interface GamePrefs {
  /** Master volume and the crowd's level, 0..1. */
  volume?: number;
  crowd?: number;
  /** The players' grunts, 0..1 (M8). */
  voices?: number;
  /** Degrees added to the match camera's lens (M8; views.ts BroadcastCamera.setFovAdd). */
  fov?: number;
  /** Camera kick on smashes (off with reduced motion). */
  shake?: boolean;
  rumble?: boolean;
  /** Speak points and the score through an ARIA live region. */
  announce?: boolean;
  /** Keyboard bindings (input/bindings.ts). */
  keys?: Record<string, string[]>;
  /** Gamepad bindings (input/bindings.ts resolvePad, M8): every pad of the game. */
  pad?: Record<string, number[]>;
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
  /** The umpire's calls (M7 phase E): spoken in a language, or not, and written on screen, or not. */
  umpire?: 'off' | 'en' | 'es';
  captions?: boolean;
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

/** Where the server's free hand is, for the ball on the walk back. */
const palmAt = new THREE.Vector3();

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
  readonly players: PlayerView[] = [];
  /** Contact shadows under the players (`?ground=1`, render/grounding.ts). */
  private grounding: Grounding | null = null;
  /** What the deferred bake leaves out (GameOptions.deferBake), until `bake` runs it. */
  private bakeHide: THREE.Object3D[] | null = null;
  /** Low quality: the players' simpler triangles are picked each frame by their size on screen (Avatar.pickLod). */
  private lodPick = false;
  private readonly lodEye = new THREE.Vector3();
  private readonly lodSize = new THREE.Vector2();
  /** Each local player's cues (their rings, spot and aim), by `locals`; one, showing nothing, with autoplay. */
  private readonly cues: AssistView[];
  readonly kb: KeyboardInput;
  /** The keyboard player at the camera's end, who can aim with the mouse (null: nobody can). */
  private readonly mouseLocal: Local | null;
  /** The local player whose timing the meter shows: the last of them to charge a swing. */
  private meterWho = -1;
  /** Sound (Phase 6): the engine, and what decides what is heard. */
  readonly audio: AudioEngine;
  private audioFailed = false;
  readonly soundscape: Soundscape;
  private feetSrc: FeetSource[] = [];
  /** The people dealt to the players (built last: addPlayers). */
  private readonly cast: Cast;
  readonly feedback: Feedback;
  readonly hud: Hud;
  readonly debug: DebugOverlay;
  /** The challenge being played (null: none), its inputs recorded for a best run to keep, and a saved run played back. */
  readonly run: ChallengeRun | null;
  readonly log: InputLog | null;
  private readonly playback: LogPlayer | null;
  /** The run is over (its last ball played out, or the saved run's inputs run out): the app shows how it went. */
  onChallengeOver: ((run: ChallengeRun) => void) | null = null;
  private runOverAt = -1;
  private runSent = false;
  private runLine: HTMLElement | null = null;
  private runShown = -1;
  private readonly runDots: THREE.Mesh[] = [];
  /** An academy lesson's glass vision (the coach's ball's path off the glass), or null. */
  private vision: GlassVision | null = null;
  private runDotsShown = -1;
  /** The players on this machine (locals.ts); none with autoplay. */
  private readonly locals: Local[] = [];
  /** Every pad in use (a local's, or the first pad with autoplay: Start opens the menu). */
  private readonly pads: GamepadInput[] = [];
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
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private mouseAim: boolean;
  /** Photo-match mode (`?photo=`): the camera and the canvas's shape come from the photo. */
  photo: PhotoOverlay | null = null;
  /** The sim stands still (the scene is still drawn): photo-match comparisons. */
  paused = false;
  /** An online match (net/netMatch.ts): its client steps the sim, and the match doesn't stop for anyone's menu. */
  online: NetHooks | null = null;
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
  /** The match's best points (M7 phase B), and the reel that shows them after it (made when first watched). */
  readonly highlights: Highlights;
  private readonly reelHumans: number[];
  private reel: Reel | null = null;
  private reelDone: (() => void) | null = null;
  private reelCut = 0;
  /** Photo mode (M7 phase C): the free camera, its controls, the exposure to give back, a photo asked for. */
  private shotCam: PhotoCamera | null = null;
  private shotCtl: PhotoControls | null = null;
  private shotDone: (() => void) | null = null;
  private shotExposure = 1;
  private shotWanted = false;
  private readonly shotPush = noPush();
  /** A clip being recorded (the highlights as a video), and who gets the file. */
  private recorder: ClipRecorder | null = null;
  private clipSaved: ((file: Blob | null, type: string) => void) | null = null;
  private readonly replayCam = new ReplayCamera();
  private replayShown = false;
  /** The replay's take last drawn (Replays.cuts). */
  private replayCut = 0;
  /** The score rows' names, team 0's and team 1's. */
  private rows: [string, string] = ['', ''];
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
    const castSeed = opts.castSeed ?? opts.match.seed ?? 0;
    const cast = dealCast(castSeed, opts.people, opts.rivals, opts.me?.face);
    if (opts.bodies) cast.bodies = opts.bodies;
    if (opts.looks) cast.looks = opts.looks;
    if (opts.designs) cast.designs = opts.designs;
    // A character's own grunt (the player's, a pro's): a voice of PLAYER_VOICES, and a pitch about three semitones either way.
    for (let i = 0; i < cast.voices.length; i++) {
      const v = opts.voices?.[i];
      if (!v) continue;
      if (v.voice !== null) cast.voices[i] = v.voice;
      cast.tones[i] = cast.tones[i]! * 2 ** ((v.pitch * 3) / 12);
    }
    // (a run played back is its kept match to the letter: the cast decides nothing in it. A women's match is another
    // match: a watched run dealt a women's cast from a fresh seed went another way from its fourth ball)
    if (!opts.playback) opts.match.women = cast.women;
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

    // (the side camera stands away from a neighbouring court, else away from the umpire's chair on +x)
    const sideX = (this.arena.def.neighbours ?? []).some((ox) => ox < 0) ? 1 : -1;
    this.cam = new BroadcastCamera(innerWidth && innerHeight ? innerWidth / innerHeight : 16 / 9, this.arena.def.camera?.swingRise ?? 0, sideX);
    const bl = this.arena.def.post?.bloom;
    if (bl && opts.bloom !== false && this.preset.bloom) this.post = new Post(renderer, this.scene, this.cam.camera, bl);
    BroadcastCamera.cutaways = opts.cutaway !== false;
    this.cam.establish = !!opts.establish;
    this.cam.setPreset(opts.camera ?? 'tv');
    if (prefs.fov) this.cam.setFovAdd(prefs.fov);
    this.cam.followPlayer = opts.autoplay ? 0 : opts.human;
    // Replays re-run a point from a copy of the match (two more matches: about 2 MB, nothing per frame).
    this.replays = new Replays(opts.match, opts.autoplay ? [] : opts.locals?.map((l) => l.player) ?? [opts.human]);
    this.replays.twoTakes = !!opts.replayTakes;
    this.replays.enabled = opts.replays !== false && !opts.closeCam;
    // The match's best points for the reel (M7 phase B): matches only, not the title's, drills, challenges or watched
    // runs (online: never, game.ts steps them only without a net).
    this.reelHumans = opts.autoplay ? [] : opts.locals?.map((l) => l.player) ?? [opts.human];
    this.highlights = new Highlights(opts.match, this.reelHumans);
    this.highlights.enabled = !opts.autoplay && !opts.playback && !opts.challenge && opts.match.practice === undefined && !opts.closeCam;
    this.ball = new BallView(this.scene, this.sim.world.spec.radius);
    this.cast = cast;
    this.placeBags(cast);
    this.inputs = new Array<InputFrame | null>(this.sim.players.length).fill(null);
    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xf4d03f, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.aimMarker.rotation.x = -Math.PI / 2;
    this.aimMarker.position.y = 0.005;
    this.aimMarker.visible = false;
    this.scene.add(this.aimMarker);
    // Reflections and ambient light from the arena itself (without the ball and cues; the players come after it).
    const moving: THREE.Object3D[] = [this.ball.mesh, this.ball.shadow, this.ball.trail, this.ball.marker, this.aimMarker, this.net.group];
    if (opts.deferBake) this.bakeHide = moving;
    else this.court.setEnvironment(this.arena.bakeEnvironment(renderer, this.scene, moving));
    // A challenge: its run, its marks on court and its line on screen; the inputs kept (six minutes) or played back.
    this.run = opts.challenge ? new ChallengeRun(opts.challenge) : null;
    this.playback = opts.playback ? new LogPlayer(opts.playback) : null;
    this.log = this.run && !this.playback ? new InputLog(120 * 60 * 6) : null;
    if (this.run) this.buildRunMarks(this.run.def);
    if (this.run && this.run.def.vision > 0) {
      this.vision = new GlassVision(this.scene, 1);
      this.vision.level = this.run.def.vision;
    }

    const sig = this.ac.signal;
    this.kb = new KeyboardInput(window, sig, prefs.keys);
    // The players on this machine: one on the keyboard and the first pad, or each on their own device (locals.ts).
    const seats: LocalSeat[] = opts.autoplay || opts.playback ? [] : opts.locals ?? [{ player: opts.human, device: 'any' }];
    for (const st of seats) {
      const l = new Local(st, this.kb, window, sig);
      this.locals.push(l);
      if (l.pad) this.pads.push(l.pad);
    }
    if (!seats.length) this.pads.push(new GamepadInput(window, sig));
    const camTeam = this.team;
    for (const l of this.locals) l.flip = axisFlip(this.sim.players[l.player]!.team, camTeam);
    this.mouseLocal = this.locals.find((l) => l.keys && l.flip === 1) ?? null;
    this.meterWho = this.locals[0]?.player ?? -1;
    for (const p of this.pads) {
      p.rumbleOn = prefs.rumble !== false;
      if (prefs.pad) p.setMap(prefs.pad);
      // Start while a menu is up is the menu's (it resumes from the pause screen).
      p.onStart = () => { if (this.reelOn) this.endReel(false); else if (!this.menuPaused) this.onMenu?.(); };
      p.onLost = () => this.onMenu?.();
    }
    this.cues = Array.from({ length: Math.max(1, this.locals.length) }, () => new AssistView(this.scene));
    for (const c of this.cues) c.enabled = !opts.pro;
    // Sound: the bank renders in a worker from now; audio starts at the first key, click or pad press (browsers
    // allow it only from a gesture). Autoplay too: a click and the AI match has sound.
    const floor = Math.max(0, FLOOR_NAMES.indexOf(opts.match.world?.floor ?? 'turf'));
    this.audio = new AudioEngine({ floor, arena: opts.arena ?? 'stadium' });
    this.audio.enabled = opts.sound !== false;
    this.audio.setLevels(prefs.volume ?? 1, prefs.crowd ?? 1);
    this.audio.load();
    this.soundscape = new Soundscape(this.audio, opts.arena ?? 'stadium', this.arena.def.neighbours ?? [], cast.voices, cast.tones);
    if (prefs.voices !== undefined) this.soundscape.voiceGain = prefs.voices * prefs.voices;
    const unlock = (): void => this.audio.unlock();
    addEventListener('keydown', unlock, { signal: sig });
    addEventListener('pointerdown', unlock, { signal: sig });
    // The press that started this match came before it, so the match began silent until the next key. (Here, not as the
    // match starts: making the audio graph is a slow laptop's seventh of a second, a hitch in the title's first frames.)
    if (navigator.userActivation?.hasBeenActive) unlock();
    this.feedback = new Feedback(this.cam);
    for (const l of this.locals) this.feedback.pads[l.player] = l.pad;
    this.feedback.shake = prefs.shake !== false;
    const sets = (opts.match.format?.setsToWin ?? 2) * 2 - 1;
    // Score rows name the players: YOU, and each AI by the name dealt from the seed (game/names.ts).
    this.names = dealNames(castSeed, this.sim.players.length, cast);
    if (opts.rivals !== undefined) {
      const r = dealNames(opts.rivals, this.sim.players.length, cast);
      for (let i = 1; i < r.length; i += 2) this.names[i] = r[i]!;
    }
    // (a roster pro's own name)
    for (let i = 0; i < this.names.length; i++) { const own = opts.names?.[i]; if (own) this.names[i] = own; }
    const who = (i: number, short: boolean): string => {
      const k = this.locals.findIndex((l) => l.player === i);
      return k < 0 ? nameOf(this.names[i]!, short) : this.locals.length > 1 ? `P${k + 1}` : 'YOU';
    };
    const row = (t: number): string => (this.sim.doubles ? `${who(t, true)} · ${who(t + 2, true)}` : who(t, false));
    const names: [string, string] = [row(0), row(1)];
    this.rows = names;
    this.hud = new Hud(hudRoot, names, sets);
    if (opts.gfx === 'tv') {
      const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
      this.tv = new TvGraphics(hudRoot, names, [hex(kitFor(0, cast.kits).shirt), hex(kitFor(1, cast.kits).shirt)], sets, this.sim);
    }
    this.hud.pro = opts.pro;
    this.hud.setTiming(opts.match.timingScale ?? 1);
    this.ball.showTrail = !opts.pro;
    this.ball.showMarker = !opts.pro;
    this.debug = new DebugOverlay(hudRoot);
    // The help panel and the hints name the keys in use (remapped keys included) and the swing mode.
    this.hud.setKeys(prefs.keys ?? DEFAULT_KEYS, !!(opts.match.tapSwing && opts.match.autoTiming), prefs.pad);
    this.kb.onKey = (code) => this.onKey(code);
    this.transitions = prefs.transitions === false || opts.autoplay ? null : new Transitions(hudRoot, names);
    this.announcer = prefs.announce && !opts.autoplay ? new Announcer(hudRoot) : null;
    this.setUmpire(prefs.umpire ?? 'off', !!prefs.captions, prefs.volume ?? 1);

    addEventListener('resize', () => this.resize(), { signal: sig });
    // Leaving the game (another window, a hidden tab, the controller gone) opens the pause menu, so a point
    // isn't played on without you; outside a match onMenu does nothing.
    addEventListener('blur', () => { if (!this.online) this.onMenu?.(); }, { signal: sig });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.online) this.onMenu?.();
      // Freeze the sim while the tab is hidden instead of fast-forwarding on return.
      this.audio.pause(document.hidden);
      if (this.online) return;
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt >= 0) {
        this.epoch += performance.now() - this.hiddenAt;
        this.hiddenAt = -1;
      }
    }, { signal: sig });
    this.probe.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.gpuTimed = (renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true;
    this.applyPixelRatio();
    if (!opts.deferPlayers) this.addPlayers();
  }

  /**
   * The players, built last: nothing else in a match needs them, so the app builds all the rest while their people
   * download and calls this once they are in (GameOptions.deferPlayers); without it the constructor calls it. After
   * the environment bake, which left them out of the reflections anyway. Before warmUp.
   */
  addPlayers(): void {
    if (this.players.length) return;
    const opts = this.opts;
    // (Low quality draws the half-size atlases when the app made them: asset.ts prepareLow)
    const low = this.preset.name === QUALITY.low.name;
    for (let i = 0; i < this.sim.players.length; i++) this.players.push(new PlayerView(this.scene, i, opts.avatar, this.cast, opts.match.rackets?.[i], opts.wear?.[i], low));
    this.lodPick = low;
    this.grounding = Grounding.on ? new Grounding(this.scene, this.players) : null;
    // Who is who: a ring under the one player, or under each in their colour (P1-P4).
    for (let k = 0; k < this.locals.length; k++) this.players[this.locals[k]!.player]!.markYou(this.locals.length > 1 ? LOCAL_COLOURS[k] : undefined);
    this.feetSrc = this.players.map((pv) => pv.avatar ?? { feet: null });
  }

  private onKey(code: string): void {
    if (this.menuPaused) return;
    // (the reel: Enter or Space the next point, Escape back to the results)
    if (this.reelOn) {
      if (code === 'Escape') this.endReel(false);
      else if ((code === 'Enter' || code === 'Space') && this.reel && !this.reel.next()) this.endReel(true);
      return;
    }
    if (code === 'Escape') this.onMenu?.();
    else if (code === 'F3') this.debug.toggle();
    else if (code === 'KeyH') this.hud.toggleHelp();
    else if (code === 'KeyP') {
      this.setPro(!this.hud.pro);
      this.hud.announce(this.hud.pro ? 'Pro mode on' : 'Pro mode off', this.hud.pro ? 'no ring, no meter · [P] to bring them back' : 'the ring and the meter are back', performance.now() / 1000, 1.6);
    } else if (code === 'KeyM') {
      // (one slip, next to N: the pointer's resting place became the target of every shot, 34% of points and nothing to say why)
      this.mouseAim = !this.mouseAim;
      this.hud.announce(this.mouseAim ? 'Aiming with the mouse' : 'Aiming with the keys', this.mouseAim ? 'the pointer is your target · [M] for keys' : '', performance.now() / 1000, 1.6);
    }
    // (not at once: a key pressed for the last shot is not a skip)
    else if ((code === 'Enter' || code === 'Space') && this.replays.state !== RP_IDLE) this.replays.stop();
    else if ((code === 'Enter' || code === 'Space') && this.overAt >= 0 && performance.now() - this.overAt > OVER_SKIP_AFTER_MS) this.overSkip = true;
  }

  /** Pro mode: no closing ring, meter, trail or bounce marker. */
  private setPro(on: boolean): void {
    this.hud.pro = on;
    this.ball.showTrail = !on;
    this.ball.showMarker = !on;
    for (const c of this.cues) c.enabled = !on;
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
    if (on) {
      this.kb.flush();
      for (const l of this.locals) l.queue.flush();
    } else {
      this.resumeInput(performance.now());
      for (const p of this.pads) p.consumeStart();
    }
    // (a menu over the match keeps the context running: its ticks, and the volume you are setting, have to sound)
    this.audio.hush(on, on && this.sim.phase === PH_OVER ? HUSH_OVER : HUSH_PAUSE);
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
    if (p.rumble !== undefined) for (const pad of this.pads) pad.rumbleOn = p.rumble;
    if (p.pad) for (const pad of this.pads) pad.setMap(p.pad);
    if (p.voices !== undefined) this.soundscape.voiceGain = p.voices * p.voices;
    if (p.fov !== undefined) this.cam.setFovAdd(p.fov);
    if (p.keys) {
      this.kb.setKeys(p.keys);
      this.hud.setKeys(p.keys, !!(this.opts.match.tapSwing && this.opts.match.autoTiming), p.pad);
    }
    if (p.pro !== undefined && p.pro !== this.prefPro) { this.prefPro = p.pro; this.setPro(p.pro); }
    if (p.mouseAim !== undefined && p.mouseAim !== this.prefMouse) { this.prefMouse = p.mouseAim; this.mouseAim = p.mouseAim; }
    if (p.camera !== undefined) this.cam.setPreset(p.camera);
    if (p.replays !== undefined) { this.replays.enabled = p.replays && !this.opts.closeCam; if (!p.replays) this.replays.stop(); }
    if (p.umpire !== undefined || p.captions !== undefined) this.setUmpire(p.umpire ?? 'off', !!p.captions, p.volume ?? 1);
    if (p.announce !== undefined && !this.opts.autoplay && p.announce !== !!this.announcer) {
      if (p.announce) this.announcer = new Announcer(this.hudLayer, this.sim);
      else { this.announcer?.dispose(); this.announcer = null; }
    }
    this.hud.applyPalette();
  }

  /**
   * The umpire (M7 phase E, game/umpire.ts): calls spoken in `lang` ('off': not spoken) and/or captioned. Matches
   * only: not the title's, drills or challenges, which have no score to call. Made again only for a new language.
   */
  private setUmpire(lang: 'off' | 'en' | 'es', captions: boolean, volume: number): void {
    const wanted = (lang !== 'off' || captions) && !this.opts.autoplay && this.opts.match.practice === undefined && !this.opts.challenge;
    if (!wanted) {
      this.umpireVoice?.dispose();
      this.umpireVoice = null;
      this.umpire = null;
      return;
    }
    const L = lang === 'off' ? 'en' : lang;
    const speak = lang !== 'off' && this.opts.sound !== false;
    if (!this.umpire || this.umpire.lang !== L) {
      this.umpireVoice?.dispose();
      this.umpireVoice = new UmpireVoice(this.hudLayer, L, speak, captions, volume);
      const n = this.names, d = this.sim.doubles;
      const team = (t: number): string => pairName(L, d ? [n[t]!.last, n[t + 2]!.last] : [n[t]!.last]);
      this.umpire = new Umpire(L, [team(0), team(1)], d, this.umpireVoice, this.sim);
    } else {
      this.umpireVoice!.speak = speak;
      this.umpireVoice!.captions = captions;
      this.umpireVoice!.volume = volume;
    }
  }

  private umpire: Umpire | null = null;
  private umpireVoice: UmpireVoice | null = null;

  /** The pro and mouse-aim settings last applied (P and M toggle in play; only a change of the setting overrides). */
  private prefPro: boolean | undefined = undefined;
  private prefMouse: boolean | undefined = undefined;

  /** Tear the game down: the loop, listeners, sound, the HUD layer and every GPU resource. */
  dispose(): void {
    this.pump?.terminate();
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    // (photo mode's keys and panel, and a clip being recorded, go with the match)
    this.shotCtl?.dispose();
    this.shotCtl = null;
    this.shotCam = null;
    this.recorder?.cancel();
    this.recorder = null;
    // (lent, the loop is the studio's)
    if (!this.lent) this.renderer.setAnimationLoop(null);
    this.ac.abort();
    this.audio.close();
    this.announcer?.dispose();
    this.umpireVoice?.dispose();
    this.hudLayer.remove();
    this.post?.dispose();
    this.net.dispose();
    this.arena.dispose();
    for (const p of this.players) p.avatar?.dropLod();
    disposeTree(this.scene);
    this.scene.clear();
    this.scene.environment = null;
    this.scene.background = null;
  }

  /** Compile every pipeline before the first point so nothing compiles mid-rally. */
  async warmUp(): Promise<void> {
    await this.bake();
    this.cam.update(this.sim, this.team, null, 0);
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    await this.compileFor(this.cam.camera, true);
    // The post passes' own shaders compile on their first frame: draw one now.
    if (this.post) this.post.render();
  }

  /**
   * The deferred environment bake (GameOptions.deferBake): its shaders built first, in pieces and asynchronously, into the
   * target it draws into (Arena.bakeEnvironmentAsync), so the page keeps its turns. Once; warmUp calls it too.
   */
  async bake(until = performance.now() + WARM_MAX_MS): Promise<void> {
    const hide = this.bakeHide;
    if (!hide) return;
    this.bakeHide = null;
    this.court.setEnvironment(await this.arena.bakeEnvironmentAsync(this.renderer, this.scene, hide, (cam, whole) => this.compileFor(cam, false, whole, until)));
  }

  /**
   * The match's shaders but its players' (GameOptions.deferPlayers), built while their textures download, after the bake
   * (whose environment every material reads): warmUp then finds these built and builds the players'.
   */
  async warmScene(): Promise<void> {
    // (the bake and this share one WARM_MAX_MS: they run back to back, waiting on nothing but the GPU)
    const until = performance.now() + WARM_MAX_MS;
    await this.bake(until);
    this.cam.update(this.sim, this.team, null, 0);
    await this.compileFor(this.cam.camera, true, false, until);
  }

  /**
   * Build every shader the scene needs drawn through `camera`, into the post passes' target (`post`, when there are post
   * passes: what the frames draw into) or the renderer's own; in pieces side by side, one of each kind first, then the
   * whole scene for anything they left (compileUnits.ts); `whole`: the whole scene alone. Never past `until` (never a
   * loading screen for ever, least of all with others waiting): what isn't done by then compiles as it's first drawn.
   */
  private compileFor(camera: THREE.Camera, post: boolean, whole = false, until = performance.now() + WARM_MAX_MS): Promise<unknown> {
    const compileIn = (units: THREE.Object3D[]): Promise<unknown> => (post && this.post ? this.post.compile(this.renderer, units)
      : Promise.all(units.map((u) => this.renderer.compileAsync(u, camera, this.scene))));
    let compile: Promise<unknown>;
    if (whole) compile = compileIn([this.scene]);
    else {
      const [first, rest] = compileRounds(this.scene);
      compile = compileIn(first).then(() => compileIn(rest)).then(() => compileIn([this.scene]));
    }
    return Promise.race([compile, new Promise((r) => setTimeout(r, Math.max(0, until - performance.now())))]);
  }

  start(): void {
    if (this.locals.length > 1) {
      // A local match: who is on which side.
      this.hud.announce(`${this.rows[0]}  vs  ${this.rows[1]}`, this.locals.length === 2 ? 'Two players' : `${this.locals.length} players`, performance.now() / 1000, 3);
    } else if (!this.opts.autoplay) {
      // Who you are playing (and with): the names dealt, their nations, and their playing styles as nicknames.
      const name = (i: number): string => nameOf(this.names[i]!, false) + (this.names[i]!.nation ? ` (${this.names[i]!.nation})` : '');
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
    if (!this.lent) this.renderer.setAnimationLoop(() => this.tick());
    this.running = true;
  }

  /** The renderer is another scene's for a while (the creator's studio, game/studio.ts): no frames from this game, and
   * none of its time passes, until `reclaim`. Before `start` too (a game built while the studio is up). */
  private lent = false;
  lend(): void {
    if (this.lent) return;
    this.lent = true;
    if (this.running) this.renderer.setAnimationLoop(null);
  }

  /** A grunt of `voice` (voices.ts PLAYER_VOICES) at `rate` (the creator's preview): a hard shot's, from no place, as
   * loud as one on court. Its effort bin is the top one, the grunt people know a player by. */
  previewGrunt(voice: number, rate: number): void {
    this.audio.unlock();
    this.audio.playFlat('grunt', voice * 3 + GRUNT_E.length - 1, voice >= GRUNT_WOMEN ? GRUNT_WOMEN_GAIN : 1, 0, BUS_PLAYERS, rate);
  }

  /** The renderer back: the match goes on from where it was left. */
  reclaim(): void {
    if (!this.lent || this.disposed) return;
    this.lent = false;
    if (!this.running) return;
    this.epoch = performance.now() - this.sim.time * 1000;
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Online: every player's first tick is at this moment (performance.now() time on this machine). */
  startAt(at: number): void {
    this.paused = false;
    this.epoch = at;
  }

  /**
   * A hidden tab draws no frames, but the other players are waiting on its inputs. A worker's timer isn't slowed as the tab's own are,
   * so the match goes on without the picture.
   */
  keepOnline(): void {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16)'], { type: 'text/javascript' })));
    w.onmessage = () => {
      const net = this.online;
      if (!document.hidden || !net || this.paused || this.disposed) return;
      net.frame();
      this.epoch += net.drift();
      const l = this.locals[0], simNow = (performance.now() - this.epoch) / 1000;
      if (!l) return;
      for (let n = 0; this.sim.time < simNow && n < 24 && !net.held; n++) {
        this.inputs[l.player] = this.buildInput(l, this.sim.time + DT);
        net.step(this.inputs[l.player] ?? null);
      }
    };
    this.pump = w;
  }
  private pump: Worker | null = null;

  /** start() has run (tools wait for this; the page exposes the game before its warm-up). */
  running = false;
  /** GPU timestamps are on (?gputime=1 and the GPU has them); one read-back at a time. */
  private gpuTimed = false;
  private gpuBusy = false;

  /** Local player `l`'s frame for the tick ending at sim time `t1`. */
  private buildInput(l: Local, t1: number): InputFrame {
    const f = l.frame;
    f.clear();
    // (online a menu doesn't stop the match, and the keys are the menu's)
    if (this.menuPaused) {
      f.held = l.simHeld;
      return f;
    }
    if (l.keys) this.kb.axes(l.axes);
    else { l.axes.x = 0; l.axes.y = 0; }
    // The pad's stick, when it is pushed, wins over the keys. A player at the far end steers as the screen shows them,
    // and from the side camera the stick is turned a quarter (views.ts steerTurn): its right is the screen's right.
    const pad = l.pad, stick = pad !== null && (pad.x !== 0 || pad.y !== 0);
    const sx = stick ? pad.x : l.axes.x, sy = stick ? pad.y : l.axes.y;
    if (this.cam.rig !== 'side') {
      f.moveX = sx * l.flip;
      f.moveY = sy * l.flip;
    } else {
      const team = this.sim.players[l.player]!.team;
      turnStick(f, sx, sy, this.cam.steerTurn(team, this.team, this.sim.side(team)));
    }
    // Button events that happened before the end of this tick, with their exact sim times; the buttons held are
    // those events' result at the tick's end (the keys as they are now can be a frame later than the tick).
    const endMs = this.epoch + t1 * 1000;
    l.simHeld = l.queue.feed(f, this.epoch, endMs, l.simHeld, this.onFed);
    // Every event handed over: the keys as they are now are the same state (unless the ring dropped one: resync).
    if (l.queue.head === l.queue.tail) l.simHeld = l.heldNow(this.kb);
    f.held = l.simHeld;
    if (l.player !== this.meterWho && this.sim.players[l.player]!.swing === SW_CHARGE) this.meterWho = l.player;
    if (l === this.mouseLocal && this.mouseAim && this.mouseOnCourt) {
      f.aimAbs = true;
      f.aimTX = this.aimMarker.position.x;
      f.aimTZ = this.aimMarker.position.z;
    }
    return f;
  }

  private readonly inputs: Array<InputFrame | null>;

  /** Back from a menu or a replay at `now`: each local player's queue lets go of what nothing holds any more (InputQueue.resume). */
  private resumeInput(now: number): void {
    let keys = false;
    for (let k = 0; k < this.locals.length; k++) {
      const l = this.locals[k]!;
      l.queue.resume(l.simHeld, l.heldNow(this.kb), now);
      if (l.keys) keys = true;
    }
    if (!keys) this.kb.flush();
  }

  /** The highlight reel is on (from the results: playReel). */
  get reelOn(): boolean {
    return this.reel !== null && this.reel.state !== RL_IDLE;
  }

  /** Watch the match's highlights (the results' "Watch highlights"); `done` when the reel is over or left. False with
   * none kept. */
  playReel(done: () => void): boolean {
    if (!this.highlights.clips.length) return false;
    this.reel ??= new Reel(this.opts.match, this.reelHumans);
    if (!this.reel.start(this.highlights.clips)) return false;
    this.reelDone = done;
    this.reelCut = -1;
    this.setMenuPaused(false);
    this.kb.flush();
    for (let k = 0; k < this.locals.length; k++) this.locals[k]!.queue.flush();
    this.skipHeld();
    return true;
  }

  /** The reel over (`finished`: played to its end) or left: back to the live match's camera, and to whoever watched
   * it; a clip being recorded is saved, or thrown away if the reel was left. */
  private endReel(finished = false): void {
    this.reel?.stop();
    const rec = this.recorder;
    if (rec) {
      this.recorder = null;
      this.audio.releaseCapture();
      const cb = this.clipSaved;
      this.clipSaved = null;
      if (finished) void rec.stop().then((b) => cb?.(b, rec.type));
      else { rec.cancel(); cb?.(null, rec.type); }
    }
    this.hud.setReplay(false);
    for (const pv of this.players) pv.cutNext();
    this.ball.cutNext();
    this.cam.retake();
    this.soundscape.retake();
    const d = this.reelDone;
    this.reelDone = null;
    d?.();
  }

  /**
   * The highlights recorded as a video while they play (the results' "Save highlights as video"; clipRecorder.ts):
   * `saved` gets the file once the reel has played to its end, null if it was left. False if the browser records no
   * video or there is nothing to show.
   */
  recordReel(back: () => void, saved: (file: Blob | null, type: string) => void): boolean {
    const type = clipType();
    if (!type || !this.playReel(back)) return false;
    try {
      this.recorder = new ClipRecorder(this.renderer.domElement, this.audio.captureTrack(), type);
      this.clipSaved = saved;
      const c = this.reel!.clip!;
      this.recorder.setCaption(`HIGHLIGHTS ${this.reel!.index + 1}/${this.reel!.count}`, `${c.label} · ${c.why}`);
    } catch (e) {
      console.warn('clip', e);
      this.recorder = null;
      this.audio.releaseCapture();
      saved(null, type);
    }
    return true;
  }

  /** Photo mode (the pause menu's): the match stays as it is, the free camera starts from the match camera's view.
   * `done` when it is left (Escape, a pad's B). */
  enterPhoto(done: () => void): void {
    if (this.shotCam) return;
    const b = this.ball.mesh.position, c = this.sim.world.court;
    const at = new THREE.Vector3(Math.max(-c.halfW, Math.min(c.halfW, b.x)), Math.max(0.6, Math.min(2.2, b.y)), Math.max(-c.halfL, Math.min(c.halfL, b.z)));
    this.shotExposure = this.renderer.toneMappingExposure;
    this.shotCam = new PhotoCamera(this.cam.camera, at, this.shotExposure);
    this.shotCtl = new PhotoControls(window, this.renderer.domElement, this.shotCam);
    this.shotDone = done;
    this.hud.setHidden(true);
  }

  /** Photo mode on (tools). */
  get photoOn(): boolean {
    return this.shotCam !== null;
  }

  private exitPhoto(): void {
    this.renderer.toneMappingExposure = this.shotExposure;
    this.shotCtl?.dispose();
    this.shotCtl = null;
    this.shotCam = null;
    this.hud.setHidden(false);
    this.cam.retake();
    const d = this.shotDone;
    this.shotDone = null;
    d?.();
  }

  /** The frame just drawn as a PNG the browser saves (photo mode's "save"). */
  private savePhoto(): void {
    const name = `${fileStem('photo')}.png`, ctl = this.shotCtl;
    this.renderer.domElement.toBlob((b) => {
      if (b && b.size > 0) { saveFile(b, name); ctl?.say(`Saved ${name}`); this.photosSaved++; }
      else ctl?.say('The photo could not be made.');
    }, 'image/png');
  }
  /** Photos saved (tools). */
  photosSaved = 0;

  /** The pad buttons held now are not a skip (only a press after this). */
  private skipHeld(): void {
    for (let k = 0; k < this.locals.length; k++) { const l = this.locals[k]!; l.replayHeld = l.pad ? l.pad.held : 0; }
  }

  /** A local player pressed a pad button since the replay began (a press skips it). */
  private padSkip(): boolean {
    for (let k = 0; k < this.locals.length; k++) {
      const l = this.locals[k]!;
      if (l.pad && (l.pad.held & ~l.replayHeld) !== 0) return true;
    }
    return false;
  }

  /** Some player on this machine holds a swing: charging (`chargingOnly`), or charging or committed to it. */
  private localSwing(chargingOnly: boolean): boolean {
    for (let k = 0; k < this.locals.length; k++) {
      const s = this.sim.players[this.locals[k]!.player]!.swing;
      if (s === SW_CHARGE || (!chargingOnly && s === SW_COMMITTED)) return true;
    }
    return false;
  }
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
    if (this.lodPick) {
      const cam = this.cam.camera;
      const k = pxPerMetreAt1(cam.fov, this.renderer.getDrawingBufferSize(this.lodSize).y);
      this.lodEye.setFromMatrixPosition(cam.matrixWorld);
      for (let i = 0; i < this.players.length; i++) this.players[i]!.avatar?.pickLod(this.lodEye, k);
    }
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.cam.camera);
  }

  /**
   * Each player's bag (costume.ts; their `wear.bag`, else a holdall) on the courtside bench at their end, in their kit's
   * colours: partners' side by side along it.
   */
  private placeBags(cast: Cast | undefined): void {
    const benches = this.arena.benches;
    if (!benches.length) return;
    const used = new Map<THREE.Vector3, number>();
    for (let i = 0; i < this.sim.players.length; i++) {
      const p = this.sim.players[i]!;
      const bench = benches.reduce((a, b) => (Math.abs(b.z - p.pos.z) < Math.abs(a.z - p.pos.z) ? b : a));
      const k = used.get(bench) ?? 0;
      used.set(bench, k + 1);
      const kit = kitFor(i, cast?.kits);
      const bag = makeBag(this.opts.wear?.[i]?.bag ?? 'bag-holdall', kit.shorts, kit.trim);
      // (Low: a fifth of its triangles, made in a worker; 15k each were for close-ups no camera takes)
      if (this.preset.name === QUALITY.low.name) void lowerStatic(bag, PROP_LOD);
      // The bag lies along the bench; a backpack stands on it.
      bag.rotation.y = Math.PI / 2;
      bag.position.set(bench.x, bench.y, bench.z + (k === 0 ? -0.45 : 0.45) * Math.sign(bench.z || 1));
      this.scene.add(bag);
      // Their bottle on the floor in front of the bench.
      const bottle = makeBottle(kit.shirt);
      bottle.position.set(bench.x + 0.38, 0, bag.position.z + 0.18);
      this.scene.add(bottle);
    }
  }

  /**
   * A challenge's marks: its rings (or its zone) on the coach's side, where the player's shots must come down, and a pool
   * of dots for where they did (made now; drawRun only moves them).
   */
  private buildRunMarks(def: ChallengeDef): void {
    const far = this.sim.side(1);
    const flat = (m: THREE.Mesh, x: number, z: number, y: number): void => {
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.renderOrder = 1;
      this.scene.add(m);
    };
    const mat = (color: number, opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    for (const t of def.targets) {
      const colour = t.points >= 3 ? 0xf0e442 : 0xffffff;
      flat(new THREE.Mesh(new THREE.RingGeometry(t.r - 0.07, t.r, 56), mat(colour, 0.85)), t.x, far * t.depth, 0.007);
      flat(new THREE.Mesh(new THREE.CircleGeometry(t.r - 0.07, 56), mat(colour, 0.12)), t.x, far * t.depth, 0.0065);
    }
    if (def.zone) {
      const z = def.zone, w = z.x[1] - z.x[0], d = z.depth[1] - z.depth[0];
      flat(new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0x56b4e9, 0.16)), (z.x[0] + z.x[1]) / 2, far * (z.depth[0] + z.depth[1]) / 2, 0.0065);
    }
    const hitMat = mat(0x3fcf6e, 0.95), missMat = mat(0xd0d4d8, 0.6), dot = new THREE.CircleGeometry(0.1, 20);
    for (let k = 0; k < 24; k++) {
      const m = new THREE.Mesh(dot, missMat);
      m.userData.hit = hitMat;
      m.userData.miss = missMat;
      m.visible = false;
      flat(m, 0, 0, 0.008);
      this.runDots.push(m);
    }
    this.runLine = this.hudLayer.appendChild(document.createElement('div'));
    this.runLine.style.cssText = 'position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:6px 14px;border-radius:8px;'
      + 'background:rgba(9,12,17,.72);font:800 15px/1.2 var(--display, system-ui);letter-spacing:.06em;text-transform:uppercase;color:#fff;';
  }

  /** The run's line and dots, redrawn only when they change (nothing allocated otherwise). */
  private drawRun(): void {
    const run = this.run!;
    const key = run.balls * 10000 + run.score;
    if (key !== this.runShown && this.runLine) {
      this.runShown = key;
      const ball = Math.min(run.def.balls, run.balls + 1);
      this.runLine.textContent = `${this.playback ? 'Your best · ' : ''}${run.def.name} · ball ${ball} of ${run.def.balls} · ${run.score} ${run.score === 1 ? 'point' : 'points'}`;
    }
    if (run.marks.length !== this.runDotsShown || (run.marks.length === 24 && key !== this.runShown)) {
      this.runDotsShown = run.marks.length;
      const far = this.sim.side(1);
      for (let k = 0; k < this.runDots.length; k++) {
        const m = this.runDots[k]!, mk = run.marks[k];
        m.visible = !!mk;
        if (!mk) continue;
        m.position.set(mk.x, 0.008, far * mk.z);
        m.material = (mk.points > 0 ? m.userData.hit : m.userData.miss) as THREE.MeshBasicMaterial;
      }
    }
  }

  /** The players on this machine, P1 first (none with autoplay). */
  get localPlayers(): number[] {
    return this.locals.map((l) => l.player);
  }

  /** A team as its score row names it (P numbers in a local match, YOU, the dealt names). */
  teamName(t: number): string {
    return this.rows[t] ?? '';
  }

  /** The human's team (the camera's end); team 0 with autoplay. */
  get team(): number {
    const l = this.locals[0];
    return l ? this.sim.players[l.player]!.team : 0;
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
    const net = this.online;
    if (net) {
      net.frame();
      this.epoch += net.drift();
    }
    const simNow = (now - this.epoch) / 1000;
    const s0 = performance.now();
    let n = 0;
    const human = this.opts.autoplay ? 0 : this.opts.human;
    const team = this.team;
    // Run-ahead: step until the sim is at or just past now and draw now, between the last two ticks. Otherwise
    // step up to now and draw one tick behind it. Either way the render blends two real sim states, and a key
    // event inside the newest tick is handed to it with its exact time.
    const ahead = this.opts.runAhead !== false;
    for (let k = 0; k < this.locals.length; k++) {
      const l = this.locals[k]!, p = l.pad;
      if (!p || !p.connected) continue;
      p.poll(l.queue, now);
      if (p.held !== 0) this.audio.unlock();
    }
    // (autoplay: the first pad, for its Start)
    if (!this.locals.length && this.pads[0]!.connected) this.pads[0]!.poll(this.kb, now);
    // ...except while the human holds a swing: the release can come for any moment from now on, and one that
    // arrives for a moment the sim has already run past would meet the ball up to a tick late. Until it goes the
    // sim stays at or behind now, and is drawn a tick behind (the render clock below).
    const holding = ahead && this.locals.length > 0;
    // The render clock: now, less a lag. While a swing is held the sim stays at or behind now, so drawing now would
    // mean drawing the newest tick as it is (no blend: a repeated frame whenever a frame has no new tick, every
    // sixth frame at 144 Hz). Instead the lag eases to one tick while a swing is held (blended, as ?runahead=0
    // draws) and back to none after, the render clock running 25% slow or fast meanwhile. It stays until the
    // contact. The sim is stepped to the drawn moment (now less the lag), not to now: stepped to now while the lag
    // is still a tick, the oldest state it keeps (a tick before its newest) is past the drawn moment and the picture
    // is pulled forward by up to a tick at the release, then drawn unblended, frames repeating, until the contact.
    const swinging = this.localSwing(false);
    const lagTo = !ahead || (holding && swinging) ? DT : 0;
    const ease = this.lastFrame ? 0.25 * Math.min(0.1, (now - this.lastFrame) / 1000) : DT;
    this.renderLag = lagTo > this.renderLag ? Math.min(lagTo, this.renderLag + ease) : Math.max(lagTo, this.renderLag - ease);
    let drawn = simNow - this.renderLag;
    // A replay due: the live match waits (as for a menu) while the point is shown again.
    const rp = this.replays;
    if (rp.state === RP_IDLE && rp.due >= 0 && this.sim.time >= rp.due && !this.menuPaused) {
      if (this.photo || !rp.enabled || net) rp.stop();
      else {
        rp.begin();
        this.kb.flush();
        for (let k = 0; k < this.locals.length; k++) { const l = this.locals[k]!; l.queue.flush(); l.replayHeld = l.pad ? l.pad.held : 0; }
      }
    }
    if (this.paused || (this.menuPaused && !net) || rp.state !== RP_IDLE || this.reelOn) {
      this.epoch = now - this.sim.time * 1000;
      drawn = this.sim.time;
    }
    while (this.sim.time < drawn && n < MAX_TICKS_PER_FRAME) {
      if (holding && this.localSwing(true) && this.sim.time + DT > simNow) break;
      // (held up, the tick can't run: the keys stay in their queue, or a release made now is lost)
      if (net?.held) break;
      for (let k = 0; k < this.locals.length; k++) { const l = this.locals[k]!; this.inputs[l.player] = this.buildInput(l, this.sim.time + DT); }
      if (this.playback) this.inputs[0] = this.playback.next();
      if (this.log) this.log.record(this.inputs[0] ?? null);
      if (net) net.step(this.inputs[human] ?? null);
      else {
        rp.beforeStep(this.sim, this.inputs);
        this.highlights.beforeStep(this.sim, this.inputs);
        this.sim.step(this.inputs);
        rp.afterStep(this.sim);
        this.highlights.afterStep(this.sim);
      }
      n++;
    }
    // (online a press acts `lead` after it is made, so the cue closes that much sooner)
    let cueNow = simNow + (net ? net.lead : 0);
    // (online, time isn't dropped: the others are on this clock, so a backlog is caught up)
    if (n === MAX_TICKS_PER_FRAME && !net) {
      // Drop a backlog rather than spiral; draw from the new clock (the old one would draw the newest tick and step
      // back next frame). Keys still queued keep their wall-clock stamps, which are now in the sim's past: they are
      // moved up to now, or a release made during the hitch is graded up to 0.2 s early and struck late.
      this.epoch = now - this.sim.time * 1000;
      drawn = this.sim.time - this.renderLag;
      cueNow = this.sim.time;
      this.kb.clampQueue(now);
      for (let k = 0; k < this.locals.length; k++) if (this.locals[k]!.queue !== this.kb) this.locals[k]!.queue.clampQueue(now);
    }
    const simMs = performance.now() - s0;
    const renderTime = Math.min(this.sim.time, Math.max(this.sim.time - DT, drawn));
    const alpha = (renderTime - (this.sim.time - DT)) / DT;

    // Mouse aim: project the pointer onto the opponent's half. The faint marker is the pointer; while a shot can
    // be aimed the sim's target (drawn by the assist view) sits under it instead.
    this.aimMarker.visible = false;
    this.mouseOnCourt = false;
    const ml = this.mouseLocal;
    if (this.mouseAim && this.kb.mouseActive && ml) {
      this.ndc.set(this.kb.mouseX, this.kb.mouseY);
      this.ray.setFromCamera(this.ndc, this.cam.camera);
      if (this.ray.ray.intersectPlane(this.ground, this.hit)) {
        const c = this.sim.world.court;
        const s = this.sim.side(team);
        const x = Math.max(-c.halfW + 0.3, Math.min(c.halfW - 0.3, this.hit.x));
        const z = -s * Math.max(0.6, Math.min(c.halfL - 0.3, -s * this.hit.z));
        this.aimMarker.position.set(x, 0.005, z);
        this.aimMarker.visible = !this.sim.players[ml.player]!.aiming;
        this.mouseOnCourt = true;
      }
    }

    const frameDt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    // The replay: re-run up to its start over a few frames, then drawn in place of the live match, on its own
    // clock (slowed round the winning shot) and cameras. A pad button pressed since it began skips it.
    if (rp.state === RP_PREP && !this.menuPaused) rp.prepare();
    if (rp.state === RP_SHOW && !this.menuPaused) {
      if (this.padSkip()) rp.stop();
      else rp.advance(frameDt);
    }
    // The highlight reel (after the match, from the results): each kept point re-run in turn on the broadcast camera.
    // A pad button or Enter skips to the next; Escape or Start goes back to the results.
    const rl = this.reel;
    if (rl && rl.state === RL_PREP && !this.menuPaused) rl.prepare();
    if (rl && rl.state === RL_SHOW && !this.menuPaused) {
      if (this.padSkip()) { this.skipHeld(); if (!rl.next()) this.endReel(true); }
      else if (!rl.advance(frameDt)) this.endReel(true);
    }
    const reeling = rl !== null && rl.state === RL_SHOW;
    if (reeling && rl.cuts !== this.reelCut) {
      this.reelCut = rl.cuts;
      for (const pv of this.players) pv.cutNext();
      this.ball.cutNext();
      this.cam.retake();
      this.soundscape.retake();
      const c = rl.clip!;
      this.hud.setReplay(true, `HIGHLIGHTS ${rl.index + 1}/${rl.count}`, `${c.label} · ${c.why}`);
      this.recorder?.setCaption(`HIGHLIGHTS ${rl.index + 1}/${rl.count}`, `${c.label} · ${c.why}`);
    }
    const showing = rp.state === RP_SHOW;
    // (a replay's second take is a cut too: the camera, the people and the sound start afresh)
    if (showing && this.replayShown && rp.cuts !== this.replayCut) {
      this.replayCut = rp.cuts;
      for (const pv of this.players) pv.cutNext();
      this.ball.cutNext();
      this.replayCam.reset();
      this.soundscape.retake();
    }
    if (showing !== this.replayShown) {
      this.replayShown = showing;
      this.replayCut = rp.cuts;
      for (const pv of this.players) pv.cutNext();
      this.ball.cutNext();
      this.hud.setReplay(showing);
      if (showing) this.replayCam.reset();
      else {
        this.cam.retake();
        this.resumeInput(now);
        this.epoch = now - this.sim.time * 1000;
      }
    }
    const view = reeling ? rl.sim : showing ? rp.sim : this.sim;
    const vAlpha = reeling ? rl.alpha : showing ? rp.alpha : alpha;
    const vTime = reeling ? rl.clock : showing ? rp.clock : renderTime;
    // (anything shown again: no cues, no meter, no rumble)
    const again = showing || reeling;
    const marker = this.ball.showMarker;
    if (again || this.shotCam) this.ball.showMarker = false;
    this.ball.update(view, vAlpha, team);
    this.ball.showMarker = marker;
    if (net) this.ball.ease(net.nudge, frameDt);
    this.net.update(view, vAlpha);
    for (let i = 0; i < this.players.length; i++) this.players[i]!.update(view, view.players[i]!, i, vAlpha, vTime);
    this.grounding?.update();
    const server = view.phase === PH_SETUP ? this.players[view.score.serverPlayer()]!.avatar : null;
    if (server) this.ball.carried(server.palm(palmAt), server.addressing);
    // Feedback before the camera, so a smash's kick starts in the frame that shows the hit (pan reads last
    // frame's camera, which is close enough).
    this.feedback.update(this.sim, !again, now);
    if (showing) this.replayCam.aim(this.cam.camera, view, rp.hitter, rp.angle, this.ball.mesh.position, frameDt * rp.speed);
    else if (reeling) this.cam.update(rl.sim, team, this.ball.mesh.position, now / 1000);
    else this.cam.update(this.sim, team, this.ball.mesh.position, now / 1000);
    if (this.photo?.entry.cam) applyPhotoCam(this.cam.camera, this.photo.entry.cam, this.photo.aspect);
    if (this.opts.closeCam) this.aimCloseCam(this.opts.closeCam);
    // Photo mode: the free camera, over whatever the match's camera did (the match itself stands still: paused).
    const shot = this.shotCam;
    if (shot) {
      const ctl = this.shotCtl!;
      shot.step(ctl.read(this.shotPush), frameDt);
      shot.apply(this.cam.camera);
      this.renderer.toneMappingExposure = shot.exposure;
      if (ctl.saveAsked) { ctl.saveAsked = false; this.shotWanted = true; }
      if (ctl.leaveAsked) { ctl.leaveAsked = false; this.exitPhoto(); }
    }
    // Sound never takes a frame down: a browser's WebAudio quirk (Firefox has no listener.positionX) once threw on
    // every play and the frame's assists, HUD and draw were skipped.
    try {
      this.audio.setListener(this.cam.camera);
      if (showing) this.soundscape.replay(rp.sim, rp.clock, this.feetSrc, frameDt, rp.speed);
      else if (reeling) this.soundscape.replay(rl.sim, rl.clock, this.feetSrc, frameDt, rl.speed);
      else this.soundscape.update(this.sim, renderTime, this.feetSrc, frameDt);
      if (this.ball.routineBounce) this.soundscape.routineBounce(this.ball.mesh.position.x, this.ball.mesh.position.z);
      for (let i = 0; i < this.players.length; i++) { const av = this.players[i]!.avatar; if (av) av.gruntAt = this.soundscape.gruntAt[i]!; }
    } catch (e) {
      if (!this.audioFailed) { this.audioFailed = true; console.warn('audio', e); }
    }
    for (let k = 0; k < this.cues.length; k++) {
      this.cues[k]!.update(this.sim, again || this.shotCam ? -1 : this.locals[k]?.player ?? -1, this.ball.mesh.position, this.cam.camera, renderTime,
        this.opts.match.timingScale ?? 1, now / 1000, frameDt, cueNow);
    }
    this.hud.cueLead = net ? net.lead : 0;
    this.hud.netNote = net ? net.note : '';
    this.hud.update(this.sim, again ? -1 : this.meterWho, now / 1000);
    this.tv?.update(this.sim);
    this.stats.update(this.sim);
    if (this.run && !showing) {
      this.run.update(this.sim);
      this.drawRun();
      this.vision?.update(this.sim);
      const over = this.run.done || (this.playback !== null && this.playback.over);
      if (over && this.runOverAt < 0) this.runOverAt = now;
      // (the last ball seen down first)
      if (over && !this.runSent && now - this.runOverAt > RUN_OVER_HOLD_MS && this.onChallengeOver) {
        this.runSent = true;
        this.onChallengeOver(this.run);
        if (this.disposed) return;
      }
    }
    this.transitions?.update(this.sim, team, now / 1000);
    this.announcer?.update(this.sim, team);
    this.umpire?.update(this.sim);
    // The match is over: the players play it out (MatchSim.overStage: reactions, the walk to the net, rackets
    // touched across it), then the app shows the results. Enter or Space skips to them (overSkip).
    if (this.sim.phase === PH_OVER && !this.overSent && (!net || net.over)) {
      if (this.overAt < 0) this.overAt = now;
      if (this.sim.overStage >= 4 && this.overDoneAt < 0) this.overDoneAt = now;
      const done = this.overDoneAt >= 0 && now - this.overDoneAt > OVER_HOLD_MS;
      if ((done || this.overSkip || now - this.overAt > OVER_MAX_MS) && this.onMatchOver) {
        this.overSent = true;
        this.highlights.flush(this.sim);
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
    this.arena.update(now / 1000, this.cam.swinging || this.photo || this.shotCam ? undefined : this.cam.camera.position);

    this.draw();
    // (in the same task as the draw, while the canvas still holds this frame's picture)
    if (this.recorder) this.recorder.frame(this.renderer.domElement);
    if (this.shotWanted) { this.shotWanted = false; this.savePhoto(); }
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
