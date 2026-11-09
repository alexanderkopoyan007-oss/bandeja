// The app (Phase 8): the loading screen, the menus over an AI match, and the player's matches, all in one page.
// A game is built for each match and torn down after it (Game.dispose), so the title screen, a match, the results
// and back again never reload the page. Settings live in localStorage (settings.ts).
import { statsScreen } from './statsScreen.ts';
import { clipType, clipExt, saveFile, fileStem } from '../game/clipRecorder.ts';
import * as THREE from 'three/webgpu';
import { Game, type GameOptions, type GamePrefs } from '../game/game.ts';
import type { MatchStats } from '../game/stats.ts';
import { loadPeople, loadPlayerAsset, peopleWanted, type PlayerAsset } from '../render/avatar/asset.ts';
import { bodiesParam, castParam, dealCast } from '../game/cast.ts';
import practiceData from '../../data/practice.json';
import { LoadingScreen } from '../ui/loading.ts';
import type { BackendGuard } from '../render/backend.ts';
import { Menu, type Item, type Screen, type Choice } from '../ui/menu/menu.ts';
import { setSafeColours } from '../ui/palette.ts';
import { resetHints } from '../ui/hud.ts';
import { ACTIONS, DEFAULT_KEYS, RESERVED, bindKey, keyName, resolveKeys } from '../game/input/bindings.ts';
import { STYLES, STYLE_KEYS } from '../sim/ai/styles.ts';
import { DEFAULT_SETUP, defaultSettings, loadSettings, saveSettings, reducedMotion, type Settings, type MatchSetup } from './settings.ts';
import { rosterScreen } from './rosterScreen.ts';
import { connectedPads, defaultPicks, localScreen, type SeatPick } from './localScreen.ts';
import type { LocalSeat } from '../game/locals.ts';
import { bracketScreen, tourScreen, type TourHost } from './tournamentScreen.ts';
import { bestsFrom, challengesScreen, type BestRun, type ChallengeHost } from './challengeScreen.ts';
import { LESSONS, MEDAL_NAMES, medal, type ChallengeDef, type ChallengeRun } from '../game/challenge.ts';
import { academyScreen, lessonOpen, type AcademyHost } from './academyScreen.ts';
import { BUILD } from '../net/config.ts';
import { DEFAULT_TOUR, nextTieName, tieCourt, tourFrom, type Tour, type TourSetup } from './tournament.ts';
import { current as tieNow, finished as drawOver, playRound, recordYours, roundName, stillIn } from './bracket.ts';
import { applyRoster, dealRoster } from './roster.ts';
import { applyCharacter, applyLocals, keepStyles, optionsFromSetup, wearParam } from './options.ts';
import { FACES, type Character } from './character.ts';
import { Creator, racketName, type CreatorHost } from './creator.ts';
import { Studio } from '../game/studio.ts';
import { Store } from './store.ts';
import { PRIZE_RACKETS, racketOpen, ruleMet, type Cosmetic } from './unlocks.ts';
import { OnlineSession, ROOM_LOST, SEATS, type OnlineStart } from '../net/session.ts';
import { NetMatch } from '../net/netMatch.ts';
import { validCode } from '../net/room.ts';
import { TEST_SHORT } from '../net/config.ts';
import { QueueSocket, type Found } from '../net/queue.ts';
import type { MatchConfig } from '../sim/match.ts';
import { SECRET_ARENAS, SEASON, careerFrom, careerReach, finishEvent, ordinal, rankOf, recordTie, shortOf, type Career } from './career.ts';
import { careerScreen, type CareerHost } from './careerScreen.ts';

const ARENAS: Choice[] = [
  { value: 'stadium', label: 'Arena' }, { value: 'hall', label: 'Club hall' },
  { value: 'club-day', label: 'Club, day' }, { value: 'club-night', label: 'Club, night' },
];
/** A venue's name, the career's secret ones too. */
function arenaLabel(id: string): string {
  return ARENAS.find((a) => a.value === id)?.label ?? SECRET_ARENAS.find((a) => a.id === id)?.name ?? '';
}

const nextSeed = (s: number): number => (Math.imul(s, 1103515245) + 12345) >>> 1;
const PAGE_TITLE = document.title;
/** Seconds a serve can wait before the AI takes the seat: strangers have nobody to ask, friends can shout. */
const PUBLIC_SERVE_CLOCK = 20;
const FRIENDS_SERVE_CLOCK = 60;
/** The queue gives up after this (s): it mustn't stay open on nobody for a day. */
const QUEUE_MAX_S = 600;
/** Public matches: how long a room's first player may be behind the rest, how long the group gets to arrive before starting
 *  with whoever came, and when the room is given up for the queue again (ms). */
const ROOM_PATIENCE_MS = 6000;
const ROOM_FILL_MS = 7000;
const ROOM_GIVE_UP_MS = 15000;
/** How long the match can stay unstarted once this client is ready (ms): past the host's own wait for anyone loading. */
const GO_WAIT_MS = 45000;
/** After this long alone in the queue, say so (s). */
const LONELY_S = 60;
/** The same match for everyone: nobody's own setup or settings decide it. */
const publicSetup = (seed: number): MatchSetup => ({
  ...DEFAULT_SETUP, mode: 'doubles', hand: 'right', level: 'club', partner: 'random', opponents: 'random', court: 'standard', scoring: 'golden', length: 'short',
  arena: ARENAS[seed % ARENAS.length]!.value as MatchSetup['arena'],
});
/** The seats, on a match made for one human. */
function seatMatch(m: MatchConfig, seats: number[], clock: number): void {
  m.human = seats.map((id) => id >= 0);
  m.lefty = new Array(SEATS).fill(false);
  m.aiLevel = [m.aiLevel![1]!, m.aiLevel![1]!];
  m.serveClock = clock;
  if (TEST_SHORT) m.format = { ...m.format!, setsToWin: 1, gamesPerSet: 1 };
}
/** A public match from its seed alone, the same on every machine: nothing a stranger sends can shape it. */
function publicStart(seed: number, seats: number[]): Omit<OnlineStart, 'seats' | 'delay'> {
  const setup = publicSetup(seed), m = optionsFromSetup(setup, defaultSettings(), seed, null, false, new URLSearchParams()).match;
  seatMatch(m, seats, PUBLIC_SERVE_CLOCK);
  return { match: m, castSeed: seed, arena: setup.arena };
}
/** Who the next game keeps of the last one's cast (build). */
const KEEP_NONE = 0;
const KEEP_ALL = 1;
const KEEP_PAIR = 2;

export class App {
  private readonly renderer: THREE.WebGPURenderer;
  private readonly hud: HTMLElement;
  private readonly params: URLSearchParams;
  private readonly settings: Settings;
  private readonly loading: LoadingScreen;
  /** WebGPU's failures: restarts on WebGL 2 while a build is under way (render/backend.ts). */
  private readonly guard: BackendGuard | null;
  private readonly menu: Menu;
  private asset: PlayerAsset | null = null;
  private game: Game | null = null;
  /** The game is the player's match (not the title screen's AI match). */
  private playing = false;
  /** The seed of the cast on court, and what the next game keeps of it. */
  private castSeed = 0;
  private keep = KEEP_NONE;
  private seedBase = (Math.random() * 2 ** 31) | 0;
  /** What the next game is: a drill of data/practice.json, or a round of the knock-out; -1 for neither. */
  private drill = -1;
  /** A local match's seats (M6, localScreen.ts): played until the title screen; null for one player. */
  private localMatch: LocalSeat[] | null = null;
  /** The seat chart's picks, by player number (kept while the page is open). */
  private localPicks: SeatPick[] | null = null;
  /** The game on court is the player's tie in the tournament (M6, tournament.ts). */
  private tourTie = false;
  /** The tie on court is the career's (its event's draw, in the career's doc), and the draw as the last tie left it
   * (the results read it after the event is over and the career has moved on), and what that event earned. */
  private careerTie = false;
  private careerDraw: Tour | null = null;
  private careerNote: { event: string; short: number; points: number; rank: number; prizes: string[] } | null = null;
  /** The game on court is a challenge (M6, challenge.ts): its feeds' seed (the daily's; null: the run's own), or a best run watched. */
  private challenge: { def: ChallengeDef; seed: number | null; watch: BestRun | null } | null = null;
  /** The tournament setup being made (kept while the page is open). */
  private readonly tourSetup: TourSetup = { ...DEFAULT_TOUR };
  private cupRound = -1;
  /** Progress and cosmetics (app/store.ts), opened in the background at start: null until it is. */
  private store: Store | null = null;
  private readonly storeOpen: Promise<Store>;
  /** The Players screens and the creator (app/creator.ts), and its turntable while it is up (game/studio.ts). */
  private readonly creator: Creator;
  /** What the creator and the roster's turntable need of the app. */
  private readonly creatorHost: CreatorHost;
  private studio: Studio | null = null;
  private studioOn = false;
  /** The game on court's drill (-1: not a drill), and its points already in the progress. */
  private gameDrill = -1;
  private drillLogged = 0;
  /** What the last finished match earned (the results screen lists it). */
  private earnedNow: Cosmetic[] = [];
  /** A match start or a return to the title is under way (repeat presses are ignored). */
  private busy = false;
  /** A build is under way (from its start until its game starts; a failed build leaves it set: nothing is at stake). */
  private inBuild = false;
  /** The title's AI match being built again after it ended (a match start waits for it). */
  private rebuilding: Promise<void> | null = null;
  /** The frame-rate setting as last applied (F3 toggles the meter in a game; only a change of the setting overrides it). */
  private fpsApplied: boolean | null = null;
  /** The online room this page is in, the match on in it, the one about to be built, and a code being typed. */
  private online: OnlineSession | null = null;
  private net: NetMatch | null = null;
  private onlineStart: OnlineStart | null = null;
  /** The room a match is being built for: by the time it's built the player may have gone from it. */
  private buildingFor: OnlineSession | null = null;
  private joinCode = '';
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  private goTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: QueueSocket | null = null;
  /** A match with whoever the queue found, not a room of friends. */
  private publicMatch = false;
  private searchFrom = 0;
  private searching = 1;

  constructor(renderer: THREE.WebGPURenderer, hud: HTMLElement, params: URLSearchParams, loading: LoadingScreen, guard: BackendGuard | null = null) {
    this.renderer = renderer;
    this.hud = hud;
    this.params = params;
    this.loading = loading;
    this.guard = guard;
    if (guard) guard.canRestart = () => this.inBuild || !this.playing;
    this.settings = loadSettings();
    // The menu first: the look (reduced motion among it) is applied to it too.
    this.menu = new Menu(document.body);
    this.applyLook();
    this.menu.onChange = () => { saveSettings(this.settings); this.applyLook(); this.game?.applyPrefs(this.prefs()); };
    this.menu.onSound = (k) => this.uiSound(k);
    addEventListener('resize', () => this.game?.resize());
    // The seat chart lists the pads there are: one plugged in or out while it shows makes it again.
    const padsChanged = (): void => { if (this.menu.current?.id === 'local') this.menu.replace(this.localScreen()); };
    addEventListener('gamepadconnected', padsChanged);
    addEventListener('gamepaddisconnected', padsChanged);
    this.storeOpen = Store.open().then((s) => (this.store = s));
    this.creator = new Creator((this.creatorHost = {
      menu: this.menu,
      store: () => this.store,
      studio: () => this.takeStudio(),
      leaveStudio: () => this.leaveStudio(),
      options: (c) => this.studioOptions(c),
      confirm: (t, sub, yd, yes) => this.confirm(t, sub, yd, yes),
      grunt: (v, r) => this.game?.previewGrunt(v, r),
    }));
    // A drill's points are logged as it's left, the page being closed among the ways out.
    addEventListener('pagehide', () => this.logDrill());
    (window as unknown as { __app: App }).__app = this;
  }

  /** The current game (tools read it as window.__bandeja too). */
  get current(): Game | null {
    return this.game;
  }

  async boot(): Promise<void> {
    const L = this.loading;
    L.stage('Fetching the players', 0.12);
    // The players' bodies: a dropped connection is tried again twice before the load gives up and says so (the
    // capsule stand-ins are for ?avatar=0 and test pages only, never the game).
    const url = new URL('assets/player.bnz', document.baseURI).href;
    for (let attempt = 0; !this.asset; attempt++) {
      try {
        this.asset = await loadPlayerAsset(url, (f) => L.stage('Fetching the players', 0.12 + 0.1 * f));
      } catch (err) {
        if (attempt >= 2) throw new Error(`the players could not be downloaded (${String(err)}). Check the connection`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    await this.build(true, (name, f) => L.stage(name, 0.52 + 0.46 * f));
    await L.done();
    this.menu.open(this.titleScreen(), true);
    // An invite link opens straight into its room.
    const room = this.params.get('room')?.toUpperCase();
    if (room && validCode(room)) this.connect(room);
    else if (this.params.get('online') === 'new') this.connect(null);
    else if (this.params.get('online') === 'find') this.findMatch();
    else if (this.creatorOn && /[#&]p=/.test(location.hash)) {
      // A friend's player (a link from Copy their code): onto the turntable, saved if they say so. The hash goes, so a
      // reload doesn't bring them again.
      const hash = location.hash;
      history.replaceState(null, '', location.pathname + location.search);
      void this.storeOpen.then(() => {
        this.menu.open(this.creator.playersScreen());
        return this.creator.addCode(hash);
      });
    }
  }

  /** The Players screens and the creator: behind ?creator=1 until the owner has seen them. */
  private get creatorOn(): boolean {
    return this.params.get('creator') === '1';
  }

  /** The renderer lent to the creator's turntable (the title's match waits, its time stopped). */
  private takeStudio(): Studio | null {
    if (!this.asset) return null;
    this.studio ??= new Studio(this.renderer, this.asset);
    if (!this.studioOn) {
      this.studioOn = true;
      this.game?.lend();
      this.studio.start();
    }
    return this.studio;
  }

  private leaveStudio(): void {
    if (!this.studioOn) return;
    this.studioOn = false;
    this.studio!.stop();
    this.studio!.play(-1);
    this.game?.reclaim();
  }

  /** What the turntable dresses a character from: a drill's options (singles, practice) with the character applied. */
  private studioOptions(c: Character): GameOptions {
    const setup: MatchSetup = { ...this.settings.setup, mode: 'singles', court: 'standard', level: 'club', arena: 'club-day' };
    const opts = optionsFromSetup(setup, this.settings, 1, this.asset, false, this.params);
    applyCharacter(opts, c);
    return opts;
  }

  // ---- games ---------------------------------------------------------------------------------------------

  private prefs() {
    return this.gatePrefs(optionsFromSetup(this.settings.setup, this.settings, 0, null, false, this.params).prefs!);
  }

  /**
   * M7's umpire and the side and dynamic cameras are behind ?creator=1 until the owner has seen them: a choice stored
   * with the flag stays off without it.
   */
  private gatePrefs(p: GamePrefs): GamePrefs {
    if (!this.creatorOn) {
      p.umpire = 'off';
      p.captions = false;
      if (p.camera === 'side' || p.camera === 'dynamic') p.camera = 'tv';
    }
    return p;
  }

  /** Build a game (the title screen's AI match, or the player's) and start it. */
  private async build(attract: boolean, stage: (name: string, f: number) => void): Promise<void> {
    this.inBuild = true;
    this.logDrill();
    this.game?.dispose();
    this.game = null;
    await frame();
    stage(attract ? 'Building the arena' : 'Setting up the court', 0.1);
    await frame();
    const seed = (this.seedBase = nextSeed(this.seedBase));
    const opts = optionsFromSetup(attract ? this.settings.setup : this.gameSetup(), this.settings, seed, this.asset, attract, this.params);
    this.gatePrefs(opts.prefs!);
    opts.camera = opts.prefs!.camera ?? opts.camera;
    // The TV graphics package (M7 phase D: a setting behind ?creator=1; ?gfx=tv still asks for it).
    opts.gfx = this.params.get('gfx') ?? (!attract && this.creatorOn && this.settings.graphics === 'tv' ? 'tv' : undefined);
    // The title's establishing shots between points (M7 phase F), and replays in two takes (phase B).
    opts.establish = attract && this.creatorOn;
    opts.replayTakes = this.creatorOn;
    opts.people = castParam(this.params);
    opts.bodies = bodiesParam(this.params);
    opts.wear = wearParam(this.params);
    // A rematch is the same four; a knock-out's next round the same pair against new opponents.
    if (attract || this.keep === KEEP_NONE) this.castSeed = seed;
    opts.castSeed = this.castSeed;
    if (!attract && this.keep === KEEP_PAIR) opts.rivals = seed;
    if (!attract && this.keep !== KEEP_NONE && opts.match.aiStyle) keepStyles(opts.match.aiStyle, this.gameSetup(), this.castSeed, this.keep === KEEP_ALL);
    this.keep = KEEP_NONE;
    const on = attract ? null : this.onlineStart;
    if (this.params.has('cap')) opts.fpsCap = Number(this.params.get('cap'));
    if (on && this.online) {
      // The host's match, to the bit: the sims must be one match. Only the seat and what is drawn are this player's.
      opts.match = structuredClone(on.match);
      opts.human = this.online.seat;
      opts.arena = on.arena;
      opts.replays = false;
      opts.prefs!.replays = false;
      this.castSeed = opts.castSeed = on.castSeed;
    }
    // A local match: several people on this machine, each on their own device (P1 the camera's end).
    if (!attract && !on && this.localMatch && this.drill < 0 && this.cupRound < 0 && !this.tourTie) applyLocals(opts, this.localMatch, this.gameSetup());
    // A tournament tie: the player beside their partner (their seat by the side they play), the other entry across.
    const tour = !attract && !on && this.tourTie ? this.tieTour : null;
    const court = tour ? tieCourt(tour, this.character()?.face ?? null) : null;
    if (court) applyLocals(opts, [{ player: court.you, device: 'any' }], this.gameSetup());
    // A career tie: the pair's chemistry, which the sim reads (the AI partner reads the ball sooner as it grows).
    const car = court && this.careerTie ? this.career : null;
    if (court && car) {
      const chem: Array<number | null> = [null, null];
      chem[court.you & 1] = car.chemistry[car.partner] ?? null;
      opts.match.chemistry = chem;
    }
    // The player's own character plays as them (behind ?creator=1 until the owner has seen the creator; never online,
    // where everyone plays the dealt cast and the standard racket).
    const me = this.character();
    if (!attract && !on && me) applyCharacter(opts, me, this.settings.setup.bodies);
    if (!attract && this.drill >= 0) {
      opts.match.practice = this.drill;
      opts.match.firstServer = 1;
      opts.match.walkBack = false;
    }
    // A challenge: scored, no replays; the daily's feeds from the date, or a best run's own match and inputs, watched.
    const ch = !attract && !on ? this.challenge : null;
    if (ch) {
      opts.challenge = ch.def;
      opts.replays = false;
      opts.prefs!.replays = false;
      if (ch.watch?.cfg && ch.watch.log) {
        opts.match = structuredClone(ch.watch.cfg);
        opts.playback = ch.watch.log;
        // (the same people: a cast dealt afresh can be a women's one, and that is another match)
        if (ch.watch.castSeed !== undefined) this.castSeed = opts.castSeed = ch.watch.castSeed;
      } else if (ch.seed !== null) opts.match.seed = ch.seed;
      // (the timing lesson is played with the player's own timing, whatever the setting)
      if (ch.def.ownTiming && !ch.watch) { opts.match.autoTiming = false; opts.match.tapSwing = false; }
    }
    // The AI players are the roster's pros (behind ?creator=1 until the owner has seen it; never online, not a drill's
    // coach, not when ?people= names the cast).
    if (court) {
      // (each pro their own; one given a free face for the tie if two on court share one)
      applyRoster(opts, court, this.gameSetup());
      opts.people = court.faces.map((f) => f ?? '');
    } else if (this.creatorOn && !on && (attract || this.drill < 0) && !opts.people) {
      const n = opts.match.doubles ? 4 : 2;
      const face = opts.me?.face;
      const dealt = dealRoster(this.castSeed, n, {
        human: attract || opts.autoplay ? -1 : opts.human,
        humans: attract || opts.autoplay ? [] : opts.locals?.map((l) => l.player),
        me: face ? { face, woman: FACES.find((f) => f.id === face)?.woman === true } : undefined,
        rivals: opts.rivals,
      });
      applyRoster(opts, dealt, attract ? undefined : this.gameSetup());
    }
    if (this.asset && peopleWanted(this.params)) {
      await loadPeople(this.asset, dealCast(this.castSeed, opts.people, opts.rivals, opts.me?.face).people, (f) => stage('Fetching the players', 0.1 + 0.4 * f));
    }
    const g = new Game(opts, this.renderer, this.hud);
    (window as unknown as { __bandeja: Game }).__bandeja = g;
    this.game = g;
    this.gameDrill = attract ? -1 : this.drill;
    this.drillLogged = 0;
    if (on && this.online && this.online === this.buildingFor) {
      const net = new NetMatch(g.sim, this.online, on);
      net.onDesync = () => this.onlineBroke('The players’ games stopped matching, so the match had to end.', true);
      g.online = this.net = net;
      g.paused = true;
      g.keepOnline();
    }
    stage('Compiling shaders', 0.55);
    await frame();
    try {
      await g.warmUp();
    } catch (err) {
      // WebGPU gave up under the warm-up (Safari's lost device shows as a RangeError out of three's buffer upload):
      // the page is starting again on WebGL 2, so this build stops here.
      if (this.guard?.failed(`the warm-up failed on WebGPU: ${readable(err)}`)) await new Promise<never>(() => undefined);
      throw err;
    }
    stage('Ready', 1);
    g.onMenu = () => { if (this.playing && !this.menu.isOpen) this.pause(); };
    g.onChallengeOver = (run) => this.challengeOver(run);
    g.onMatchOver = (st) => {
      if (this.playing) this.results(st);
      // Not inside the game's own frame (the rebuild tears that game down): in a task of its own.
      else setTimeout(() => this.rebuildAttract(), 0);
    };
    // (built while the creator's studio has the renderer: it waits for it)
    if (this.studioOn) g.lend();
    g.start();
    if (attract) this.fetchAhead();
    this.playing = !attract;
    this.inBuild = false;
    if (this.settings.showFps && !attract) g.debug.toggle();
    // The window was left while the match was loading (the blur came before there was a match to pause).
    if (!attract && !on && (document.hidden || !document.hasFocus())) g.onMenu();
  }

  /** The next match's people, fetched while nothing is at stake, so starting it doesn't wait for the network. */
  private fetchAhead(): void {
    if (this.asset && peopleWanted(this.params)) void loadPeople(this.asset, dealCast(nextSeed(this.seedBase), castParam(this.params)).people);
  }

  /** The character that plays as the player: the store's active one, behind ?creator=1 (null: the dealt cast's). */
  private character(): Character | null {
    if (!this.creatorOn || !this.store || this.store.active < 0) return null;
    return this.store.characters[this.store.active] ?? null;
  }

  private rebuildAttract(): void {
    if (this.busy || this.rebuilding) return;
    this.rebuilding = this.build(true, () => undefined)
      .catch((err: unknown) => console.error('title match', err))
      .finally(() => { this.rebuilding = null; });
  }

  /** The setup a game runs on: the player's, or a knock-out round's or a drill's version of it. */
  private gameSetup(): MatchSetup {
    const st = this.settings.setup;
    if (this.drill >= 0) return { ...st, mode: 'singles', court: 'standard', level: 'club', arena: 'club-day' };
    if (this.cupRound >= 0) return { ...st, level: CUP[this.cupRound]!.level, length: 'short' };
    const tour = this.tourTie ? this.tieTour : null;
    if (tour) {
      const t = tour.setup;
      return {
        ...st, mode: t.doubles ? 'doubles' : 'singles', court: t.doubles ? 'standard' : 'singles-narrow', level: t.level, arena: t.arena,
        scoring: t.scoring, length: t.length, partner: 'random', opponents: 'random',
      };
    }
    return st;
  }

  private play(drill: number, cupRound: number, tourTie = false, challenge: { def: ChallengeDef; seed: number | null; watch: BestRun | null } | null = null, careerTie = false): void {
    this.drill = drill;
    this.cupRound = cupRound;
    this.tourTie = tourTie;
    this.careerTie = tourTie && careerTie;
    this.careerDraw = null;
    this.careerNote = null;
    this.challenge = challenge;
    void this.startMatch();
  }

  private async startMatch(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Narrow singles is a singles court (an old store or a stale screen could hold it with doubles).
    const st = this.settings.setup;
    if (st.mode === 'doubles' && st.court === 'singles-narrow') st.court = 'standard';
    saveSettings(this.settings);
    this.menu.hide();
    this.loading.show('Setting up the court');
    try {
      // Quick match while the title's match is being rebuilt: wait for it, then build ours.
      if (this.rebuilding) await this.rebuilding;
      await this.build(false, (n, f) => this.loading.stage(n, f));
      await this.loading.done();
    } catch (err) {
      this.loading.fail(`The match could not start: ${readable(err)}.`);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  private pause(): void {
    this.game?.setMenuPaused(true);
    this.menu.open(this.pauseScreen(), true);
  }

  private resume(): void {
    this.menu.hide();
    this.game?.setMenuPaused(false);
  }

  private async toTitle(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.localMatch = null;
    this.closeRoom();
    this.menu.hide();
    this.loading.show('Back to the club');
    try {
      if (this.rebuilding) await this.rebuilding;
      await this.build(true, (n, f) => this.loading.stage(n, f));
      await this.loading.done();
    } catch (err) {
      this.loading.fail(`The title screen could not be built: ${readable(err)}.`);
      throw err;
    } finally {
      this.busy = false;
    }
    this.menu.open(this.titleScreen(), true);
  }

  private results(st: MatchStats): void {
    this.earnedNow = this.logMatch(st);
    this.logTie();
    this.game?.setMenuPaused(true);
    this.menu.open(this.resultsScreen(st), true);
    this.fetchAhead();
  }

  /** A finished match into the progress (drills are logged as they're left); what it earned. */
  private logMatch(st: MatchStats): Cosmetic[] {
    const g = this.game;
    if (!g || !this.store || this.gameDrill >= 0 || g.opts.autoplay) return [];
    const me = st.player[g.opts.human];
    return this.store.recordMatch({
      level: this.online ? null : this.gameSetup().level,
      won: g.sim.score.winner === g.team,
      cupRound: this.online ? -1 : this.cupRound,
      aces: me?.aces ?? 0, porTres: me?.outOfCourt ?? 0, fastest: me?.fastest ?? 0,
      longestRally: st.longestRally,
    });
  }

  /** The player's tournament tie into the draw (won or not, the score from their side), and the round's other ties. */
  private logTie(): void {
    const g = this.game, tour = this.tourTie ? this.tieTour : null;
    if (!g || !tour || !tieNow(tour.draw).tie) return;
    const mine = g.team, won = g.sim.score.winner === mine;
    const score = g.sim.score.history.map((h) => `${h[mine]}-${h[1 - mine]}`).join(' ');
    recordYours(tour.draw, won, score);
    playRound(tour.draw);
    if (!this.careerTie) { this.saveTour(tour); return; }
    // The career: the pair's chemistry grows; out (or champions), the rest of the draw is played and the event's points kept.
    let c = this.career;
    if (!c) return;
    c = recordTie({ ...c, tour }, won);
    if (shortOf(tour.draw) >= 0) {
      while (!drawOver(tour.draw)) playRound(tour.draw);
      const k = c.playing;
      c = finishEvent(c);
      const r = c.results[c.results.length - 1]!;
      // (the career's own cosmetics, data/cosmetics.json careerTier / careerTitle, and its prize rackets)
      const reach = careerReach(c), before = this.store?.progress;
      if (this.store) this.earnedNow = [...this.earnedNow, ...this.store.recordCareer(reach.tier, reach.title)];
      const after = this.store?.progress;
      const prizes = before && after ? [...PRIZE_RACKETS.keys()].filter((id) => !racketOpen(id, before) && racketOpen(id, after)).map(racketName) : [];
      this.careerNote = { event: SEASON[k]!.name, short: r.short, points: r.points, rank: rankOf(c), prizes };
    }
    this.careerDraw = tour;
    this.saveCareer(c);
  }

  /** Every challenge's best run, as saved (checked on every read). */
  private bests(): Record<string, BestRun> {
    return bestsFrom(this.store?.doc('challenges.v1'));
  }

  private challengeHost(): ChallengeHost {
    return {
      best: (id) => this.bests()[id] ?? null,
      build: BUILD,
      start: (def, seed) => this.play(def.drill, -1, false, { def, seed, watch: null }),
      watch: (def, best) => this.play(def.drill, -1, false, { def, seed: null, watch: best }),
      open: (sc) => this.menu.open(sc),
      // (the list opened after a run has nothing under it: back is the title)
      back: () => { if (this.menu.depth > 1) this.menu.pop(); else void this.toTitle(); },
    };
  }

  private academyHost(): AcademyHost {
    return {
      best: (id) => this.bests()[id]?.score ?? null,
      keys: () => resolveKeys(this.settings.keys),
      start: (def) => this.play(def.drill, -1, false, { def, seed: null, watch: null }),
      open: (sc) => this.menu.open(sc),
      back: () => { if (this.menu.depth > 1) this.menu.pop(); else void this.toTitle(); },
    };
  }

  /** A challenge's run is over: a better score than the best is kept (with its match and inputs, to watch again). */
  private challengeOver(run: ChallengeRun): void {
    const g = this.game, ch = this.challenge;
    if (!g || !ch || !this.playing) return;
    g.setMenuPaused(true);
    const all = this.bests(), prev = all[ch.def.id] ?? null;
    let fresh = false;
    if (!ch.watch && (!prev || run.score > prev.score)) {
      const rec: BestRun = { score: run.score, at: Date.now(), build: BUILD };
      if (g.log && !g.log.full) { rec.cfg = structuredClone(g.opts.match); rec.log = g.log.save(); rec.castSeed = g.opts.castSeed; }
      all[ch.def.id] = rec;
      this.store?.saveDoc('challenges.v1', { best: all });
      fresh = true;
    }
    const m = medal(ch.def, run.score);
    const sub = ch.watch ? `${run.score} points, as you played it`
      : `${run.score} ${run.score === 1 ? 'point' : 'points'}${fresh && prev ? ` · a new best (was ${prev.score})` : fresh ? ' · your first' : prev ? ` · best ${prev.score}` : ''}`;
    const again = { def: ch.def, seed: ch.seed, watch: null };
    // A lesson: the next one, once this one has its bronze; back to the academy rather than the challenges.
    const k = ch.def.lesson ? LESSONS.findIndex((l) => l.id === ch.def.id) : -1;
    const next = k >= 0 && k + 1 < LESSONS.length && lessonOpen(k + 1, (id) => this.bests()[id]?.score ?? null) ? LESSONS[k + 1]! : null;
    this.menu.open({
      id: 'results', title: ch.watch ? 'Your best run' : MEDAL_NAMES[m]!, sub, back: null,
      side: () => `<div class="card"><h2>${ch.def.name}</h2><table>${[1, 2, 3].map((k) => `<tr><td class="l">${MEDAL_NAMES[k]}</td><td${m >= k ? ' class="w"' : ''}>${ch.def.medals[k - 1]} points</td></tr>`).join('')}</table></div>`,
      items: [
        {
          kind: 'button', label: 'Next lesson', primary: true, hidden: () => !next || !!ch.watch, desc: next ? `${next.name}: ${next.balls} balls.` : '',
          action: () => { if (next) this.play(next.drill, -1, false, { def: next, seed: null, watch: null }); },
        },
        { kind: 'button', label: 'Again', primary: !next || !!ch.watch, desc: `${ch.def.balls} more balls.`, action: () => this.play(ch.def.drill, -1, false, again) },
        {
          kind: 'button', label: 'Watch your best', hidden: () => { const b = this.bests()[ch.def.id]; return !b?.log || b.build !== BUILD; },
          desc: 'Your best run, played again as you played it.', action: () => { const b = this.bests()[ch.def.id]; if (b) this.play(ch.def.drill, -1, false, { def: ch.def, seed: null, watch: b }); },
        },
        k >= 0
          ? { kind: 'button', label: 'Academy', desc: 'The lessons.', action: () => this.menu.open(academyScreen(this.academyHost()), true) }
          : { kind: 'button', label: 'Challenges', desc: 'The list.', action: () => this.menu.open(challengesScreen(this.challengeHost()), true) },
        { kind: 'button', label: 'Title screen', desc: 'Back to the club.', action: () => void this.toTitle() },
      ],
    }, true);
  }

  /** The tournament under way, as saved (checked on every read; null: none). */
  private get tour(): Tour | null {
    return this.store ? tourFrom(this.store.doc('tournament.v1')) : null;
  }

  /** The venues the menus offer: the four, and the career's secret ones it has opened (data/career.json `arenas`). */
  private arenaChoices(): Choice[] {
    const p = this.store?.progress;
    return [...ARENAS, ...SECRET_ARENAS.filter((a) => p && ruleMet(a.unlock, p)).map((a) => ({ value: a.id, label: a.name }))];
  }

  /** The career under way, as saved (checked on every read; null: none). */
  private get career(): Career | null {
    return this.store ? careerFrom(this.store.doc('career.v1')) : null;
  }

  private saveCareer(c: Career | null): void {
    this.store?.saveDoc('career.v1', c ? JSON.parse(JSON.stringify(c)) : null);
  }

  /** The draw the tie on court belongs to: the career event's, or the tournament's. */
  private get tieTour(): Tour | null {
    return this.careerTie ? this.career?.tour ?? null : this.tour;
  }

  private careerHost(): CareerHost {
    return {
      career: () => this.career,
      save: (c) => this.saveCareer(c),
      womanAsMe: () => { const me = this.character(); return me ? FACES.find((f) => f.id === me.face)?.woman === true : null; },
      seed: () => Math.floor(Math.random() * 2 ** 31),
      open: (sc) => this.menu.open(sc),
      replace: (sc) => this.menu.replace(sc),
      playTie: () => this.play(-1, -1, true, null, true),
      confirm: (t, sub, yd, yes) => this.confirm(t, sub, yd, yes),
      // (opened after a tie it has nothing under it: back is the title)
      back: () => { if (this.menu.depth > 1) this.menu.pop(); else void this.toTitle(); },
    };
  }

  private saveTour(t: Tour | null): void {
    this.store?.saveDoc('tournament.v1', t ? JSON.parse(JSON.stringify(t)) : null);
  }

  private tourHost(): TourHost {
    return {
      tour: () => this.tour,
      setTour: (t) => this.saveTour(t),
      setup: this.tourSetup,
      womanAsMe: () => { const me = this.character(); return me ? FACES.find((f) => f.id === me.face)?.woman === true : null; },
      seed: () => Math.floor(Math.random() * 2 ** 31),
      arenas: this.arenaChoices(),
      open: (sc) => this.menu.open(sc),
      replace: (sc) => this.menu.replace(sc),
      playTie: () => this.play(-1, -1, true),
      confirm: (t, sub, yd, yes) => this.confirm(t, sub, yd, yes),
      // (the draw opened after a tie has nothing under it: back is the title)
      back: () => { if (this.menu.depth > 1) this.menu.pop(); else void this.toTitle(); },
    };
  }

  /** Points won off the coach in the drill on court since they were last logged. */
  private logDrill(): void {
    const g = this.game;
    if (!g || !this.store || this.gameDrill < 0) return;
    const won = g.stats.team[g.team]!.points;
    if (won > this.drillLogged) this.store.recordDrill(practiceData.drills[this.gameDrill]!.name, won - this.drillLogged);
    this.drillLogged = won;
  }

  // ---- online ----------------------------------------------------------------------------------------------

  /** Into a room: a new one (null), or the one with this code. */
  private connect(code: string | null): void {
    this.closeRoom();
    this.publicMatch = false;
    this.enterRoom(new OnlineSession(code));
    this.menu.open(this.lobbyScreen());
    if (this.params.has('online')) this.autoStart();
  }

  private enterRoom(s: OnlineSession): void {
    this.localMatch = null;
    this.drill = -1;
    this.cupRound = -1;
    this.online = s;
    s.onChange = () => this.refreshOnline();
    s.onStart = (st) => void this.startOnline(st);
    // (still building, startOnline picks it up from the session when it's done)
    s.onGo = (at) => { if (!this.busy) this.goAt(at); };
    // (a public room that never came together: back in the queue)
    s.onClosed = (m) => { if (this.publicMatch && !this.net) this.findMatch(); else this.onlineBroke(m, false); };
    s.onLeft = (seat) => {
      this.net?.seatLeft(seat);
      this.refreshOnline();
    };
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = setInterval(() => this.refreshOnline(), 1000);
  }

  private goAt(at: number): void {
    document.title = PAGE_TITLE;
    if (this.goTimer) clearTimeout(this.goTimer);
    this.goTimer = null;
    this.game?.startAt(at);
    this.net?.begin(at);
  }

  private refreshOnline(): void {
    if (this.menu.showing === 'lobby' || this.menu.showing === 'search') this.menu.refresh();
  }

  /** Public play: the queue finds the others, and the match starts by itself. */
  private findMatch(): void {
    this.closeRoom();
    this.publicMatch = true;
    this.searchFrom = performance.now();
    this.searching = 1;
    this.queue = new QueueSocket({
      waiting: (n) => { this.searching = n; this.refreshOnline(); },
      found: (f) => this.matchFound(f),
      failed: (m) => this.onlineBroke(m, false),
    });
    this.lobbyTimer = setInterval(() => {
      if (performance.now() - this.searchFrom > QUEUE_MAX_S * 1000) this.onlineBroke('Nobody else came along. Try again later, or send a friend an invite.', false);
      else this.refreshOnline();
    }, 1000);
    this.menu.open(this.searchScreen(), true);
  }

  private matchFound(f: Found): void {
    this.queue = null;
    // (people wait in another tab: the tab's title is what they'll see)
    document.title = 'Match found · BANDEJA';
    const s = new OnlineSession(f.code, { create: f.host, max: f.n, patience: ROOM_PATIENCE_MS });
    this.enterRoom(s);
    this.refreshOnline();
    const from = performance.now();
    this.roomTimer = setInterval(() => {
      const waited = performance.now() - from, linked = s.links?.ids().every((id) => s.links!.rtt(id) > 0) ?? false;
      if (s.isHost && s.players >= 2 && linked && (s.players >= f.n || waited > ROOM_FILL_MS)) this.hostStart();
      else if (waited > ROOM_GIVE_UP_MS) this.findMatch();
    }, 200);
  }

  /** Tools: `&players=N` starts once N are in. */
  private autoStart(): void {
    const want = Number(this.params.get('players') ?? 0);
    if (want < 2) return;
    const t = setInterval(() => {
      if (this.online?.isHost && this.online.players >= want && this.online.links?.ids().every((id) => this.online!.links!.rtt(id) > 0)) {
        clearInterval(t);
        this.hostStart();
      }
    }, 200);
  }

  private closeRoom(): void {
    document.title = PAGE_TITLE;
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    if (this.roomTimer) clearInterval(this.roomTimer);
    this.roomTimer = null;
    if (this.goTimer) clearTimeout(this.goTimer);
    this.goTimer = null;
    this.queue?.close();
    this.queue = null;
    this.net?.end();
    this.net = null;
    if (this.game) this.game.online = null;
    this.online?.leave();
    this.online = null;
    this.onlineStart = null;
  }

  /** The host's Start: the match is decided here, once, and sent to everyone. */
  private hostStart(): void {
    const s = this.online;
    if (!s?.isHost || s.players < 2 || this.busy) return;
    const seed = (this.seedBase = nextSeed(this.seedBase));
    if (this.publicMatch) {
      void this.startOnline(s.start(publicStart(seed, s.seats)));
      return;
    }
    const base = this.gameSetup();
    const setup: MatchSetup = { ...base, mode: 'doubles', hand: 'right', court: base.court === 'singles-narrow' ? 'standard' : base.court };
    const m = optionsFromSetup(setup, this.settings, seed, null, false, this.params).match;
    seatMatch(m, s.seats, FRIENDS_SERVE_CLOCK);
    void this.startOnline(s.start({ match: m, castSeed: seed, arena: setup.arena }));
  }

  private async startOnline(st: OnlineStart): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (this.roomTimer) clearInterval(this.roomTimer);
    this.roomTimer = null;
    this.net?.end();
    this.net = null;
    const s = this.online;
    this.buildingFor = s;
    // (only the seed, the seats and the delay count in a public match: nobody decides one for anyone else)
    this.onlineStart = this.publicMatch ? { ...publicStart(st.castSeed, st.seats), delay: st.delay, seats: st.seats } : st;
    this.menu.hide();
    this.loading.show('Setting up the court');
    try {
      if (this.rebuilding) await this.rebuilding;
      await this.build(false, (n, f) => this.loading.stage(n, f));
      await this.loading.done();
    } catch (err) {
      this.loading.fail(`The match could not start: ${readable(err)}.`);
      throw err;
    } finally {
      this.busy = false;
      this.onlineStart = null;
    }
    // (they left while it built: what was built is nothing to them)
    if (!s || this.online !== s) {
      this.game?.setMenuPaused(true);
      return;
    }
    s.ready();
    if (s.goTime !== null) this.goAt(s.goTime);
    // (nobody here to say go)
    else this.goTimer = setTimeout(() => this.onlineBroke('The match could not start.', false), GO_WAIT_MS);
  }

  /** Something ended the match or the room. `room`: the room itself is still there. */
  private onlineBroke(message: string, room: boolean): void {
    this.net?.end();
    this.net = null;
    if (this.game) {
      this.game.online = null;
      // (not the title screen's match, if this is a code that didn't work)
      if (this.playing) this.game.setMenuPaused(true);
    }
    room &&= !this.online?.roomLost;
    if (room) this.online?.backToLobby();
    else this.closeRoom();
    const pub = this.publicMatch;
    this.menu.open({
      id: 'netdown', title: 'Online', sub: message, back: null,
      items: [
        { kind: 'button', label: 'Find another match', primary: true, desc: 'Back in the queue.', hidden: () => !pub, action: () => this.findMatch() },
        { kind: 'button', label: 'Back to the room', primary: true, desc: 'Stay with the same players.', hidden: () => pub || !room || !this.online, action: () => this.backToRoom() },
        { kind: 'button', label: 'Title screen', primary: !room && !pub, desc: 'Back to the club.', action: () => this.leaveRoom() },
      ],
    }, true);
  }

  private backToRoom(): void {
    if (this.online?.roomLost) { this.onlineBroke(ROOM_LOST, false); return; }
    this.net?.end();
    this.net = null;
    if (this.game) this.game.online = null;
    this.online?.backToLobby();
    this.menu.open(this.lobbyScreen(), true);
  }

  private leaveRoom(): void {
    this.closeRoom();
    if (this.playing) void this.toTitle();
    else this.menu.open(this.titleScreen(), true);
  }

  private onlineScreen(): Screen {
    return {
      id: 'online', title: 'Online', sub: 'Doubles against real people',
      items: [
        { kind: 'button', label: 'Find a match', primary: true, desc: 'Plays you with whoever else is looking: one short set, with the AI in any empty seat. Players connect directly, so they can see each other’s IP address.', action: () => this.findMatch() },
        { kind: 'button', label: 'Create a match', desc: 'You get a code and an invite link to send. Up to four people; the AI plays any seat left empty.', action: () => this.connect(null) },
        { kind: 'button', label: 'Join with a code', desc: 'Type the code a friend sent you, or open their link.', action: () => { this.joinCode = ''; this.menu.open(this.joinScreen()); } },
      ],
    };
  }

  private joinScreen(): Screen {
    const clean = (t: string): string => t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    return {
      id: 'join', title: 'Join', sub: 'Five letters',
      items: [
        {
          kind: 'text', label: 'Code', desc: 'Type the code, or paste the link.', get: () => this.joinCode,
          type: (l) => { this.joinCode = l === null ? this.joinCode.slice(0, -1) : clean(this.joinCode + l); },
          paste: (t) => { this.joinCode = clean(t.match(/[?&]room=([A-Za-z]{5})/)?.[1] ?? t); },
        },
        { kind: 'button', label: 'Join', primary: true, desc: 'Into the room.', disabled: () => !validCode(this.joinCode), action: () => { if (validCode(this.joinCode)) this.connect(this.joinCode); } },
      ],
    };
  }

  private searchScreen(): Screen {
    return {
      id: 'search', title: 'Find a match', sub: 'Doubles, one short set', back: () => this.leaveRoom(), side: () => this.searchCard(),
      items: [{ kind: 'button', label: 'Stop looking', desc: 'Back to the title.', action: () => this.leaveRoom() }],
    };
  }

  private searchCard(): string {
    const secs = Math.floor((performance.now() - this.searchFrom) / 1000), clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (this.online) return '<div class="card"><h2>Players found</h2><table><tr><td class="l">Connecting</td><td></td></tr></table></div>';
    const who = this.searching > 1 ? `${this.searching} looking now` : 'Nobody else yet';
    const tip = secs >= LONELY_S ? '<p style="margin-top:12px">Nobody else is looking right now. Keep waiting, or send a friend an invite with Create a match.</p>' : '';
    return `<div class="card"><h2>Looking for players</h2><table><tr><td class="l">${who}</td><td>${clock}</td></tr></table>${tip}</div>`;
  }

  private inviteLink(): string {
    return `${location.origin}${location.pathname}?room=${this.online?.code ?? ''}`;
  }

  private lobbyScreen(): Screen {
    const s = this.online!;
    return {
      id: 'lobby', title: 'Online', sub: `Match code ${s.code}`, back: () => this.leaveRoom(), side: () => this.lobbyCard(),
      items: [
        { kind: 'button', label: 'Copy invite link', desc: () => this.inviteLink(), action: () => void navigator.clipboard?.writeText(this.inviteLink()) },
        { kind: 'button', label: 'Change sides', desc: 'Move to the other pair.', disabled: () => s.seat < 0, action: () => s.changeSide() },
        { kind: 'button', label: 'Match setup', desc: () => this.setupLine(), hidden: () => !s.isHost, action: () => this.menu.open(this.setupScreen()) },
        { kind: 'button', label: 'Start match', primary: true, desc: 'Everyone goes onto court. The AI plays any empty seat.', hidden: () => !s.isHost, disabled: () => s.players < 2, action: () => this.hostStart() },
        { kind: 'button', label: 'Leave', desc: 'Back to the title.', action: () => this.leaveRoom() },
      ],
    };
  }

  private lobbyCard(): string {
    const s = this.online;
    if (!s) return '';
    const row = (seat: number): string => {
      const id = s.seats[seat]!, me = id === s.you, name = id < 0 ? 'AI' : me ? 'You' : id === s.host ? 'Host' : `Player ${id + 1}`;
      const line = id < 0 || me || !s.links ? '' : s.links.direct(id) ? `${Math.round(s.links.rtt(id))} ms` : 'Through the server';
      return `<tr><td class="l">${name}</td><td>${line}</td></tr>`;
    };
    const wait = s.you < 0 ? 'Connecting' : s.players < 2 ? 'Waiting for a friend' : s.isHost ? 'Ready' : 'The host starts the match';
    return `<div class="card"><h2>${wait}</h2><table>${row(0)}${row(2)}</table><h2 style="margin-top:14px">Against</h2><table>${row(1)}${row(3)}</table></div>`;
  }

  // ---- settings applied outside a game --------------------------------------------------------------------

  private applyLook(): void {
    const s = this.settings;
    applyRootLook(s);
    this.menu.calm = reducedMotion(s);
    setSafeColours(s.safeColours);
    if (this.game && s.showFps !== this.fpsApplied && this.game.debug.visible !== s.showFps) this.game.debug.toggle();
    this.fpsApplied = s.showFps;
  }

  /** A soft tick for menu moves, a click for a choice (through the game's audio, once a key has unlocked it). */
  private uiSound(kind: 'move' | 'ok' | 'back'): void {
    const a = this.game?.audio;
    if (!a) return;
    a.unlock();
    a.uiBlip(kind);
  }

  // ---- screens ---------------------------------------------------------------------------------------------

  /** The seat chart (localScreen.ts). */
  private localScreen(): Screen {
    const st = this.settings.setup;
    this.localPicks ??= defaultPicks(connectedPads().map((p) => p.index), st.mode === 'doubles');
    return localScreen({
      setup: st,
      picks: this.localPicks,
      pads: connectedPads,
      remake: () => { saveSettings(this.settings); this.menu.replace(this.localScreen()); },
      openSetup: () => this.menu.open(this.setupScreen(true)),
      start: (seats) => { this.localMatch = seats; this.play(-1, -1); },
      back: () => this.menu.pop(),
    });
  }

  private titleScreen(): Screen {
    return {
      id: 'title', title: 'Padel', sub: 'A match is on court one', back: null,
      items: [
        { kind: 'button', label: 'Play', primary: true, desc: 'Set up a match: doubles or singles, your partner and opponents, the venue, the scoring.', action: () => this.menu.open(this.setupScreen()) },
        { kind: 'button', label: 'Quick match', desc: () => `Straight onto court with your last setup: ${this.setupLine()}.`, action: () => this.play(-1, -1) },
        { kind: 'button', label: 'Online', desc: 'Find a match with anyone looking, or send a friend a link. Up to four people.', action: () => this.menu.open(this.onlineScreen()) },
        {
          kind: 'button', label: 'Tournament', hidden: () => !this.creatorOn,
          desc: () => { const t = this.tour; const n = t && !drawOver(t.draw) ? nextTieName(t.draw) : null; return n ? `Your draw goes on: ${n} next.` : 'A draw of the roster’s pros, seeded, at the venue and rules you choose. Lose and you are out.'; },
          action: () => this.menu.open(tourScreen(this.tourHost())),
        },
        {
          kind: 'button', label: 'Career', hidden: () => !this.creatorOn,
          desc: () => {
            const c = this.career;
            if (!c) return 'Your player from the club to the Masters: a season of tournaments, a partner of your level, ranking points.';
            return c.tour ? `${SEASON[c.playing]!.name} goes on: ${nextTieName(c.tour.draw) ?? ''} next.` : `Season ${c.season}, ${ordinal(rankOf(c))} in the ranking: ${SEASON[c.next]!.name} next.`;
          },
          action: () => this.menu.open(careerScreen(this.careerHost())),
        },
        {
          kind: 'button', label: 'Academy', hidden: () => !this.creatorOn,
          desc: 'Lessons from the timing to every shot and reading the glass, each a run of the coach’s balls. Bronze opens the next.',
          action: () => this.menu.open(academyScreen(this.academyHost())),
        },
        {
          kind: 'button', label: 'Challenges', hidden: () => !this.creatorOn,
          desc: 'Rings to land in, the glass to read, smashes out of the court: a run of balls each, medals, and a new one every day.',
          action: () => this.menu.open(challengesScreen(this.challengeHost())),
        },
        {
          kind: 'button', label: 'Local match', hidden: () => !this.creatorOn, desc: 'Up to four people on one screen: the keyboard and pads, as partners or opponents.',
          action: () => this.menu.open(this.localScreen()),
        },
        { kind: 'button', label: 'Knock-out', desc: 'Three rounds, a short set each, against stronger players every round. Lose and you are out.', action: () => this.play(-1, 0) },
        { kind: 'button', label: 'Practice', desc: 'A coach feeds you the shots padel is made of: off the glass, overheads, volleys.', action: () => this.menu.open(this.practiceScreen()) },
        {
          kind: 'button', label: 'Players', hidden: () => !this.creatorOn, desc: 'Make your own player: their face, their body, what they wear, their racket. They play as you.',
          action: () => this.menu.open(this.creator.playersScreen()),
        },
        {
          kind: 'button', label: 'Roster', hidden: () => !this.creatorOn, desc: 'The pros you play with and against: their game, their racket, on the turntable.',
          action: () => this.menu.open(rosterScreen(this.creatorHost)),
        },
        { kind: 'button', label: 'Settings', desc: 'Timing, assists, picture quality, sound and accessibility.', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
        { kind: 'button', label: 'Credits', desc: 'The libraries, assets and references the game is built from.', action: () => this.menu.open(this.creditsScreen()) },
      ],
    };
  }

  private practiceScreen(): Screen {
    return {
      id: 'practice', title: 'Practice', sub: 'The coach feeds, you play it out. Pause to leave.',
      items: practiceData.drills.flatMap((d, i) => ((d as { challenge?: boolean }).challenge ? [] : [{ kind: 'button' as const, label: d.name, desc: d.desc, action: () => this.play(i, -1) }])),
    };
  }

  private setupLine(): string {
    const s = this.settings.setup;
    const arena = arenaLabel(s.arena);
    const lvl = { novice: 'novice', club: 'club', advanced: 'advanced', pro: 'pro' }[s.level];
    return `${s.mode}, ${lvl} opponents, ${arena.toLowerCase()}`;
  }

  private styleChoices(): Choice[] {
    return [{ value: 'random', label: 'Random' }, ...STYLE_KEYS.map((k) => ({ value: k, label: STYLES[k]!.name }))];
  }

  /** `forLocal`: opened from the seat chart, which starts the match (Done goes back to it). */
  private setupScreen(forLocal = false): Screen {
    const st = this.settings.setup;
    const set = <K extends keyof MatchSetup>(k: K) => (v: unknown): void => {
      st[k] = v as MatchSetup[K];
      if (k === 'mode') {
        if (st.mode === 'doubles' && st.court === 'singles-narrow') st.court = 'standard';
        // One player can't cover 10 m (5.5 shots a point, 37% of points lost on a double bounce): singles starts narrow, and
        // the standard court is still one row away.
        else if (st.mode === 'singles' && st.court === 'standard') st.court = 'singles-narrow';
        // The court's options and the opponents' label depend on the mode: the screen is made again.
        this.menu.replace(this.setupScreen(forLocal));
      }
    };
    const ch = (k: keyof MatchSetup, label: string, options: Choice[], desc: string, hidden?: () => boolean): Item =>
      ({ kind: 'choice', label, options, get: () => st[k], set: set(k), desc, hidden });
    return {
      id: 'setup', title: 'Match', sub: 'Set up the match', side: () => this.setupCard(),
      items: [
        ch('mode', 'Mode', [{ value: 'doubles', label: 'Doubles' }, { value: 'singles', label: 'Singles' }],
          'Padel is played in pairs. Singles is one against one on the same court, or on a narrow one.', () => !!this.online),
        ch('level', 'Opponents', [{ value: 'novice', label: 'Novice' }, { value: 'club', label: 'Club' }, { value: 'advanced', label: 'Advanced' }, { value: 'pro', label: 'Pro' }],
          'How well the AI plays: reaction, reading the ball, timing and shot choice (your partner plays a level above it).'),
        ch('partner', 'Partner', this.styleChoices(), 'Your partner’s game. El Relojero is even; El Muro lobs and stays back; Martillo takes the net and smashes; La Serpiente plays víboras and drops; El Contragolpe defends from the glass and answers with drives.', () => st.mode !== 'doubles'),
        ch('opponents', st.mode === 'doubles' ? 'Opponents’ style' : 'Opponent’s style', this.styleChoices(), 'How the other side plays (random deals each player a style).'),
        ch('arena', 'Venue', this.arenaChoices(), 'An indoor arena with a crowd, a covered club hall, or an outdoor club by day or under floodlights.'),
        ch('court', 'Court', [{ value: 'standard', label: 'Standard' }, { value: 'panoramic', label: 'Panoramic' }, ...(st.mode === 'singles' ? [{ value: 'singles-narrow', label: 'Narrow singles' }] : [])],
          'Standard: stepped side glass with mesh. Panoramic: a single run of glass along the sides. Narrow singles: a 6 m wide court for one against one.'),
        ch('scoring', 'Scoring', [{ value: 'star', label: 'Star point' }, { value: 'golden', label: 'Golden point' }, { value: 'advantage', label: 'Advantage' }],
          'Star point: two advantages, then a deciding point at the third deuce (the FIP’s newest method). Golden point: the first deuce is decided by one point. Advantage: win by two.'),
        ch('length', 'Length', [{ value: 'short', label: 'Short set (to 4)' }, { value: 'set', label: 'One set' }, { value: 'three', label: 'Best of three' }],
          'A tie-break at 6-6 (4-4 in a short set).'),
        ch('hand', 'You play', [{ value: 'right', label: 'Right-handed' }, { value: 'left', label: 'Left-handed' }], 'Your racket hand.', () => !!this.online || !!this.character()),
        ch('bodies', 'Bodies count', [{ value: false, label: 'Off' }, { value: true, label: 'On' }],
          'On: your player’s height, arms and legs change how high and far they reach and how fast they run. Off: every body plays the same.',
          () => !!this.online || !this.character()),
        { kind: 'button', label: 'Start match', primary: true, desc: 'Onto court with this setup (it is kept for Quick match).', hidden: () => !!this.online || forLocal, action: () => this.play(-1, -1) },
        { kind: 'button', label: 'Done', primary: true, desc: forLocal ? 'Back to the seats.' : 'Back to the room.', hidden: () => !this.online && !forLocal, action: () => this.menu.pop() },
      ],
      focus: 0,
    };
  }

  private setupCard(): string {
    const st = this.settings.setup;
    const lines = [
      ['Format', st.mode === 'doubles' ? 'Doubles' : 'Singles'],
      ['Venue', arenaLabel(st.arena)],
      ['Scoring', { star: 'Star point', golden: 'Golden point', advantage: 'Advantage' }[st.scoring]],
      ['Length', { short: 'Short set', set: 'One set', three: 'Best of three' }[st.length]],
    ];
    return `<div class="card"><h2>Your match</h2><table>${lines.map(([a, b]) => `<tr><td class="l">${a}</td><td>${b}</td></tr>`).join('')}</table></div>`;
  }

  private settingsScreen(): Screen {
    const s = this.settings;
    const ch = (label: string, k: keyof Settings, options: Choice[], desc: string): Item =>
      ({ kind: 'choice', label, options, get: () => s[k], set: (v) => { (s as unknown as Record<string, unknown>)[k] = v; }, desc });
    const onOff: Choice[] = [{ value: true, label: 'On' }, { value: false, label: 'Off' }];
    // The sim's own settings: a match is one configuration from its first tick (replays are the seed and the inputs).
    const next = ' Applies from the next match.';
    return {
      id: 'settings', title: 'Settings', sub: 'Saved on this device',
      items: [
        { kind: 'group', label: 'Gameplay' },
        ch('Timing window', 'timing', [{ value: 'forgiving', label: 'Forgiving' }, { value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict' }],
          'How far from the perfect moment a release still counts as Good. Strict is the real window; forgiving is half as wide again.' + next),
        ch('Positioning assist', 'assist', [{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'strong', label: 'Strong' }],
          'How much the game moves you towards the ball when you leave the keys alone. Off: you move yourself, always.' + next),
        {
          kind: 'choice', label: 'Auto timing', options: onOff,
          // One-tap swings always time themselves: shown as on, and not changeable while Swing is One tap.
          get: () => s.autoTiming || s.swing === 'tap', set: (v) => { s.autoTiming = v as boolean; }, disabled: () => s.swing === 'tap',
          desc: () => s.swing === 'tap'
            ? 'On with one-tap swings (they always time themselves). Set Swing to Hold and release to choose.'
            : 'A held swing fires itself at the right moment (graded Good): you choose the shot and the aim, the game times it.' + next,
        },
        ch('Swing', 'swing', [{ value: 'hold', label: 'Hold and release' }, { value: 'tap', label: 'One tap' }],
          'One tap: press a shot key once and the swing goes off at the right moment by itself (auto timing on); the movement keys still aim. For when holding and releasing a key on time is hard.' + next),
        ch('Timing cues', 'pro', [{ value: false, label: 'Shown' }, { value: true, label: 'Hidden (pro)' }], 'The closing ring, the meter, the trail and the bounce marker. Pro mode plays without them.'),
        ch('Aim with', 'mouseAim', [{ value: false, label: 'Keys' }, { value: true, label: 'Mouse' }], 'Keys: a movement key pressed while a shot key is held steers the target (one already down keeps its run until you let it go). Mouse: point at the far court.'),
        { kind: 'group', label: 'Picture' },
        ch('Quality', 'quality', [{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
          'Auto lowers the resolution when frames run long, to hold 60 frames a second. Low draws fewer pixels with softer shadows and no glow. Applies from the next match.'),
        ch('Frame rate meter', 'showFps', onOff, 'Frames per second and frame times, top right (also F3).'),
        ch('Camera', 'camera', [{ value: 'tv', label: 'TV' }, { value: 'near', label: 'TV close' }, { value: 'player', label: 'Player' },
          // (M7's cameras, behind ?creator=1 until the owner has seen them)
          ...(this.creatorOn ? [{ value: 'side', label: 'Side' }, { value: 'dynamic', label: 'Dynamic' }] : [])],
          this.creatorOn
            ? 'TV: the broadcast camera high behind the glass. TV close: nearer and wider. Player: low behind your end, sliding with you. Side: high beside the court, your pair on the left or right. Dynamic: behind you, moving in and out with you.'
            : 'TV: the broadcast camera high behind the glass. TV close: nearer and wider. Player: low behind your end, sliding with you.'),
        ch('Replays', 'replays', [{ value: true, label: 'Big points' }, { value: false, label: 'Off' }],
          'After a winner off the court, a hard overhead or a long rally, the point again from another angle, the winning shot slowed. Enter or Space skips one.'),
        // (M7's graphics, umpire and captions: behind ?creator=1 until the owner has seen them)
        { ...ch('Score graphics', 'graphics', [{ value: 'simple', label: 'Simple' }, { value: 'tv', label: 'TV' }],
          'Simple: the score in the corner. TV: a broadcast package: the score bug in the pairs\' colours with the server, tags for break, set and match points, the speed of serves and smashes, how each point was won, the scoreboard after each game and the stats at the change of ends.' + next), hidden: () => !this.creatorOn },
        { kind: 'group', label: 'Sound' },
        { ...ch('Umpire', 'umpire', [{ value: 'off', label: 'Off' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }],
          'The umpire calls faults, lets and the score as it is counted, in the browser\'s own voice (one on this computer; with none, the calls are written only).'), hidden: () => !this.creatorOn },
        { ...ch('Captions', 'captions', onOff, 'The umpire\'s calls written at the foot of the screen, in the umpire\'s language (English when the umpire is off).'), hidden: () => !this.creatorOn },
        { kind: 'slider', label: 'Volume', get: () => s.volume, set: (v) => { s.volume = Number(v); }, step: 0.1, desc: 'Everything you hear.' },
        { kind: 'slider', label: 'Crowd', get: () => s.crowd, set: (v) => { s.crowd = Number(v); }, step: 0.1, desc: 'The crowd and the neighbouring courts, against the ball and the players.' },
        { kind: 'group', label: 'Accessibility' },
        ch('Motion', 'motion', [{ value: 'system', label: 'As the system' }, { value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }],
          'Reduced: no camera kick on smashes, no slam on the big calls, menus fade instead of sliding, no bouncing ball on the loading screen.'),
        ch('Colours', 'safeColours', [{ value: false, label: 'Standard' }, { value: true, label: 'Colour-blind safe' }],
          'Timing colours a red-green colour-blind player can tell apart: blue for Good, cyan for Perfect, yellow for early or late, dark orange for a miss.'),
        ch('Panels', 'contrast', [{ value: false, label: 'Standard' }, { value: true, label: 'High contrast' }],
          'Darker, nearly solid panels behind the score, calls, hints and menus, and a backing behind the timing words, so text reads over a bright court.'),
        ch('Text size', 'textSize', [{ value: 1, label: '100%' }, { value: 1.25, label: '125%' }, { value: 1.5, label: '150%' }], 'The score, calls, hints and menus.'),
        ch('Announce the score', 'announce', onOff, 'A screen reader says each point, the score, games and sets.'),
        ch('Controller rumble', 'rumble', onOff, 'The pad buzzes on your hits.'),
        { kind: 'button', label: 'Back', desc: 'Settings are saved as they change.', action: () => this.menu.back() },
      ],
    };
  }

  private controlsScreen(): Screen {
    const s = this.settings;
    const keys = (): Record<string, string[]> => resolveKeys(s.keys);
    const items: Item[] = [{ kind: 'group', label: 'Keyboard (Enter to change a key)' }];
    for (const a of ACTIONS) {
      items.push({
        kind: 'key', label: a.label,
        keys: () => keys()[a.id]!.map(keyName).join(' / ') || 'None',
        listen: (code) => {
          if (!code) return;
          if (RESERVED.has(code)) return;
          const k = keys();
          bindKey(k, a.id, code);
          s.keys = k;
        },
        desc: (a.move ? 'Movement. Pressed while a shot key is held, it steers the aim instead, and the game does the running. One already down when the shot key goes down stays the run until you let it go.'
          : a.id === 'power' ? 'Held with a shot key as it is let go: a harder ball (with Volley a punch volley). With Overhead a smash: hold it before the ball drops, the jump is taken by then.'
          : a.id === 'precision' ? 'Held with a shot key as it is let go: a placed ball, and the aim goes right to the lines (with Topspin a chiquita). With Overhead a víbora: hold it before the ball drops.'
          : 'Hold as the ball comes, release to hit.') + ' Keys kept by the game: Esc (pause), F3, H, P, M, Tab, Enter.',
      });
    }
    const hintsBack: Item = { kind: 'button', label: 'Show hints again', desc: 'Each hint retires after six points. This brings them all back.', action: () => {
      resetHints();
      hintsBack.label = 'Hints are back';
      this.menu.refresh();
    } };
    items.push(
      hintsBack,
      { kind: 'button', label: 'Reset keys', desc: 'Back to J K L I U O N, Space and Shift, with WASD and the arrows.', action: () => { s.keys = { ...DEFAULT_KEYS }; saveSettings(s); this.menu.refresh(); this.game?.applyPrefs(this.prefs()); } },
      { kind: 'button', label: 'Back', desc: 'Keys are saved as they change.', action: () => this.menu.back() },
    );
    return { id: 'controls', title: 'Controls', sub: 'Keyboard and gamepad', items, side: () => this.padCard() };
  }

  private padCard(): string {
    const rows = [
      ['Left stick', 'Move (aim while a shot is held)'], ['A', 'Drive'], ['X', 'Topspin'], ['B', 'Slice'], ['Y', 'Lob'],
      ['Right stick click', 'Drop shot'], ['LB', 'Volley'], ['RB', 'Overhead'], ['RT', 'Power'], ['LT', 'Precision'], ['Start', 'Pause'],
    ];
    const more = [
      ['Overhead + power', 'Smash'], ['Overhead + precision', 'Víbora'], ['Topspin + precision', 'Chiquita'], ['Volley + power', 'Punch volley'],
    ];
    const tr = (r: string[]): string => `<tr><td class="l">${r[0]}</td><td class="k">${r[1]}</td></tr>`;
    return `<div class="card keys"><h2>Gamepad</h2><table>${rows.map(tr).join('')}</table></div>`
      + `<div class="card keys" style="margin-top:12px"><h2>Combinations</h2><table>${more.map(tr).join('')}</table></div>`;
  }

  private creditsScreen(): Screen {
    return {
      id: 'credits', title: 'Credits', sub: 'BANDEJA',
      // What CREDITS.md lists.
      side: () => '<div class="card"><h2>Made with</h2><table>'
        + '<tr><td class="l">Rendering</td><td>three.js 0.186 (MIT)</td></tr>'
        + '<tr><td class="l">Build, tests</td><td>Vite, Vitest (MIT), TypeScript, Puppeteer (Apache-2.0)</td></tr>'
        + '<tr><td class="l">Players</td><td>MakeHuman base mesh, skins, hair and clothes (CC0), made in MPFB 2 and Blender</td></tr>'
        + '<tr><td class="l">Movement</td><td>Y Bot skeleton and 10 clips, Mixamo (Adobe)</td></tr>'
        + '<tr><td class="l">Strokes</td><td>Authored in code</td></tr>'
        + '<tr><td class="l">Sound</td><td>Synthesised in code (claps: the ClaPD model\u2019s figures)</td></tr>'
        + '<tr><td class="l">Courts</td><td>Generated in code</td></tr>'
        + '<tr><td class="l">Rules</td><td>FIP Rules of Padel, 2026 (referenced)</td></tr>'
        + '<tr><td class="l">Maths</td><td>fdlibm (Sun, 1993) via musl</td></tr>'
        + '</table></div>',
      items: [
        { kind: 'button', label: 'Back', desc: 'Players and clubs are made up; the playing styles are nicknames, never real players. Sources and licences: CREDITS.md in the source.', action: () => this.menu.back() },
      ],
    };
  }

  private pauseScreen(): Screen {
    const g = this.game;
    const sc = g?.sim.score;
    const sub = sc ? `${[...sc.history.map((h) => `${h[0]}-${h[1]}`), `${sc.games[0]}-${sc.games[1]}`].join('  ')}` : '';
    if (this.online) {
      return {
        id: 'pause', title: 'Menu', sub: 'The match goes on without you', back: () => this.resume(),
        items: [
          { kind: 'button', label: 'Resume', primary: true, desc: 'Back to the point.', action: () => this.resume() },
          { kind: 'button', label: 'Settings', desc: 'Sound, picture and accessibility change at once.', action: () => this.menu.open(this.settingsScreen()) },
          { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
          { kind: 'button', label: 'Leave the match', desc: 'Ends the match for everyone.', action: () => this.menu.open(this.confirm('Leave?', 'This ends the match for everyone.', 'Back to the title.', () => this.leaveRoom())) },
        ],
      };
    }
    return {
      id: 'pause', title: 'Paused', sub, back: () => this.resume(),
      items: [
        { kind: 'button', label: 'Resume', primary: true, desc: 'Back to the point, where it stopped.', action: () => this.resume() },
        { kind: 'button', label: 'Settings', desc: 'Sound, picture and accessibility change at once; timing and assists from the next match.', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
        // (M7 phase C, behind ?creator=1 until the owner has seen it)
        { kind: 'button', label: 'Photo mode', desc: 'The match stands still; take the camera anywhere and save the picture.', hidden: () => !this.creatorOn,
          action: () => { this.menu.hide(); this.game?.enterPhoto(() => this.menu.open(this.pauseScreen(), true)); } },
        { kind: 'button', label: 'Restart match', desc: 'A new match with the same setup.', action: () => this.menu.open(this.confirm('Restart?', 'This match is lost.', 'Start the match again.', () => void this.startMatch())) },
        { kind: 'button', label: 'Quit to title', desc: 'Leave the match for the title screen.', action: () => this.menu.open(this.confirm('Leave the match?', 'This match is lost.', 'To the title screen.', () => void this.toTitle())) },
      ],
    };
  }

  private confirm(title: string, sub: string, yesDesc: string, yes: () => void): Screen {
    return {
      id: 'confirm', title, sub,
      items: [
        { kind: 'button', label: 'No, go back', desc: 'Back to the pause menu.', action: () => this.menu.back() },
        { kind: 'button', label: 'Yes', desc: yesDesc, action: yes },
      ],
    };
  }

  private resultsScreen(st: MatchStats): Screen {
    const screen = this.resultsOf(st);
    // The match's highlights (M7 phase B; behind ?creator=1 until the owner has seen them; never online, where the
    // others' inputs aren't kept): watched on court, then back here.
    const g = this.game;
    // The breakdown (M7 phase D; behind ?creator=1 until the owner has seen it): shots, overheads and the serve, the
    // net and the running, where the ball came down.
    if (this.creatorOn && g) {
      const you = g.team;
      const mine = g.localPlayers.length > 1 ? g.teamName(you) : g.sim.doubles ? 'Your pair' : 'You';
      const them = g.localPlayers.length > 1 ? g.teamName(1 - you) : g.sim.doubles ? 'Them' : 'Opponent';
      screen.items.splice(1, 0, {
        kind: 'button', label: 'Match stats', desc: 'Every shot by kind, overheads and the serve, the net and the running, where the ball came down.',
        action: () => this.menu.open(statsScreen({ stats: st, you, names: [mine, them], back: () => this.menu.pop() })),
      });
    }
    if (this.creatorOn && !this.online && g && g.highlights.clips.length) {
      const n = g.highlights.clips.length;
      screen.items.splice(1, 0, {
        kind: 'button', label: 'Watch highlights', desc: `The match's best ${n === 1 ? 'point' : `${n} points`} again. Enter skips one, Escape comes back here.`,
        action: () => {
          this.menu.hide();
          const back = (): void => { g.setMenuPaused(true); this.menu.open(this.resultsScreen(st), true); };
          if (!g.playReel(back)) back();
        },
      });
      // ... and as a video file (M7 phase C: recorded in the browser while it plays, then saved by it).
      if (clipType()) {
        screen.items.splice(2, 0, {
          kind: 'button', label: 'Save highlights as video', desc: 'They play, recorded with their sound and captions, then your browser saves the file. Escape stops without saving.',
          action: () => {
            this.menu.hide();
            const back = (): void => { g.setMenuPaused(true); this.menu.open(this.resultsScreen(st), true); };
            const ok = g.recordReel(back, (file, type) => {
              if (file && file.size > 0) saveFile(file, `${fileStem('highlights')}.${clipExt(type)}`);
            });
            if (!ok) back();
          },
        });
      }
    }
    return screen;
  }

  private resultsOf(st: MatchStats): Screen {
    const g = this.game!;
    const sim = g.sim;
    const won = sim.score.winner === g.team;
    const sets = sim.score.history.map((h) => `${h[0]}-${h[1]}`).join('  ');
    const T = st.team;
    const mins = Math.round(st.duration / 60);
    const rows: Array<[string, string, string]> = [
      ['Points won', String(T[0].points), String(T[1].points)],
      ['Winners', String(T[0].winners), String(T[1].winners)],
      ['Errors', String(T[0].errors), String(T[1].errors)],
      ['Out of the court', String(T[0].outOfCourt), String(T[1].outOfCourt)],
      ['Aces', String(T[0].aces), String(T[1].aces)],
      ['Double faults', String(T[0].doubleFaults), String(T[1].doubleFaults)],
      ['Serve points won', pct(T[0].servesWon, T[0].serves), pct(T[1].servesWon, T[1].serves)],
      ['Fastest ball', `${Math.round(T[0].fastest)} km/h`, `${Math.round(T[1].fastest)} km/h`],
    ];
    // The opponents by the surnames dealt them (game/names.ts).
    const them = sim.doubles ? `${g.names[1]?.last ?? ''} · ${g.names[3]?.last ?? ''}` : (g.names[1]?.last ?? 'Opponent');
    // What the match earned (the locker comes with the creator: behind ?creator=1 until the owner has seen it).
    const earnedNow = this.params.get('creator') === '1' && this.earnedNow.length
      ? `<div class="card"><h2>New in your locker</h2><p>${this.earnedNow.map((c) => c.name).join(' · ')}</p></div>` : '';
    const side = earnedNow + `<div class="card"><h2>${mins} min · longest rally ${st.longestRally} shots</h2><table>`
      + `<tr><td class="l"></td><td class="w">${g.localPlayers.length > 1 ? g.teamName(0) : sim.doubles ? 'Your pair' : 'You'}</td><td class="w">${g.localPlayers.length > 1 ? g.teamName(1) : them}</td></tr>`
      + rows.map((r) => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</table></div>';
    const tour = this.tourTie ? (this.careerTie ? this.careerDraw : this.tour) : null;
    if (tour) {
      const d = tour.draw, inIt = stillIn(d), over = drawOver(d);
      const last = d.rounds[d.rounds.length - 1]!;
      // (the round just played: the last with a tie of theirs decided on court)
      let at = 0;
      d.rounds.forEach((r, k) => { if (r.some((t) => (t.a === d.you || t.b === d.you) && t.winner >= 0 && t.score !== 'bye')) at = k; });
      const played = roundName(d.rounds[at]!.length);
      const title = over && inIt ? 'Champions' : inIt ? `Through to the ${roundName(last.length).toLowerCase()}` : `Out in the ${played.toLowerCase()}`;
      if (this.careerTie) {
        const note = this.careerNote, c = this.career;
        const chem = c ? Math.round((c.chemistry[c.partner] ?? 0) * 100) : 0;
        const card = note
          ? `<div class="card"><h2>${note.event}</h2><p>${note.short === 0 ? 'Won it' : `Out ${note.short === 1 ? 'in the final' : `${note.short} rounds short of the title`}`}: ${note.points} ranking points. You are ${ordinal(note.rank)} now.</p><p>Chemistry with your partner ${chem}%.</p>${note.prizes.length ? `<p>A prize racket: ${note.prizes.join(', ')}. Yours to play under Players.</p>` : ''}</div>`
          : `<div class="card"><p>Chemistry with your partner ${chem}%.</p></div>`;
        return {
          id: 'results', title, sub: `${played} · ${sets}`, back: null, side: () => card + side,
          items: [
            { kind: 'button', label: 'Career', primary: true, desc: note ? 'The season goes on.' : `Next: ${nextTieName(d) ?? ''}.`, action: () => this.menu.open(careerScreen(this.careerHost()), true) },
            { kind: 'button', label: 'Title screen', desc: 'The career is kept.', action: () => void this.toTitle() },
          ],
        };
      }
      return {
        id: 'results', title, sub: `${played} · ${sets}`, back: null, side: () => side,
        items: [
          { kind: 'button', label: 'To the draw', primary: true, desc: inIt && !over ? `Next: ${nextTieName(d) ?? ''}.` : 'How the rest of it went.', action: () => this.menu.open(bracketScreen(this.tourHost()), true) },
          { kind: 'button', label: 'Title screen', desc: 'The draw is kept.', action: () => void this.toTitle() },
        ],
      };
    }
    const round = this.cupRound;
    if (round >= 0) {
      const last = round === CUP.length - 1;
      const title = !won ? `Out in the ${CUP[round]!.name.toLowerCase()}` : last ? 'Champions' : `Through the ${CUP[round]!.name.toLowerCase()}`;
      return {
        id: 'results', title, sub: `${CUP[round]!.name} · ${sets}`, back: null, side: () => side,
        items: [
          won && !last
            ? { kind: 'button', label: `On to the ${CUP[round + 1]!.name.toLowerCase()}`, primary: true, desc: `Stronger opponents: ${CUP[round + 1]!.level}.`, action: () => { this.keep = KEEP_PAIR; this.play(-1, round + 1); } }
            : { kind: 'button', label: 'Start again', primary: true, desc: 'A new draw, from the first round.', action: () => this.play(-1, 0) },
          { kind: 'button', label: 'Title screen', desc: 'Back to the club.', action: () => void this.toTitle() },
        ],
      };
    }
    if (this.online) {
      return {
        id: 'results', title: won ? 'You win' : 'They win', sub: `Game, set and match · ${sets}`, back: null, side: () => side,
        items: [
          { kind: 'button', label: 'Find another match', primary: true, desc: 'Back in the queue.', hidden: () => !this.publicMatch, action: () => this.findMatch() },
          { kind: 'button', label: 'Back to the room', primary: true, desc: 'Stay with the same players for another match.', hidden: () => this.publicMatch, action: () => this.backToRoom() },
          { kind: 'button', label: 'Title screen', desc: 'Leave the room.', action: () => this.leaveRoom() },
        ],
      };
    }
    // A local match: the winners by their P numbers (the computer's pair as they).
    const locals = g.localPlayers;
    const pName = (i: number): string => `P${locals.indexOf(i) + 1}`;
    const winners = locals.filter((i) => (i & 1) === sim.score.winner);
    const localTitle = locals.length < 2 ? null
      : winners.length === 0 ? 'They win' : winners.length === 1 ? `${pName(winners[0]!)} wins` : `${winners.map(pName).join(' and ')} win`;
    return {
      id: 'results', title: localTitle ?? (won ? 'You win' : sim.doubles ? 'They win' : 'You lose'), sub: `Game, set and match · ${sets}`, back: null, side: () => side,
      items: [
        { kind: 'button', label: 'Rematch', primary: true, desc: 'The same setup again.', action: () => { this.keep = KEEP_ALL; this.play(-1, -1); } },
        { kind: 'button', label: 'Change setup', desc: 'Mode, opponents, venue, court and scoring, then onto court.', action: () => this.menu.open(this.setupScreen()) },
        { kind: 'button', label: 'Title screen', desc: 'Back to the club.', action: () => void this.toTitle() },
      ],
    };
  }
}

/** The knock-out's rounds. */
const CUP: Array<{ name: string; level: MatchSetup['level'] }> = [
  { name: 'Quarter-final', level: 'club' },
  { name: 'Semi-final', level: 'advanced' },
  { name: 'Final', level: 'pro' },
];

/** The document-wide look from the settings (text size, reduced motion, high contrast): also used by main.ts before
 * the app exists, so the first loading screen follows them. */
export function applyRootLook(s: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s.textSize));
  root.classList.toggle('calm', reducedMotion(s));
  // Motion set to Full: the CSS fallbacks for the system's reduced motion stand aside.
  root.classList.toggle('full-motion', s.motion === 'full');
  root.classList.toggle('hc', s.contrast);
}

/** An error as a sentence part (no "Error: " prefix). */
function readable(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/^(Type|Range)?Error:\s*/, '').replace(/\.$/, '');
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((100 * a) / b)}%` : '-';
}

/** The next frame (so the loading screen paints before a long build), or 60 ms in a hidden tab (no frames there). */
function frame(): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, 60);
    requestAnimationFrame(() => { clearTimeout(t); r(); });
  });
}
