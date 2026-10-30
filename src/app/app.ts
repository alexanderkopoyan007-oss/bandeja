// The app (Phase 8): the loading screen, the menus over an AI match, and the player's matches, all in one page.
// A game is built for each match and torn down after it (Game.dispose), so the title screen, a match, the results
// and back again never reload the page. Settings live in localStorage (settings.ts).
import * as THREE from 'three/webgpu';
import { Game } from '../game/game.ts';
import type { MatchStats } from '../game/stats.ts';
import { loadPeople, loadPlayerAsset, peopleWanted, type PlayerAsset } from '../render/avatar/asset.ts';
import { castParam, dealCast } from '../game/cast.ts';
import practiceData from '../../data/practice.json';
import { LoadingScreen } from '../ui/loading.ts';
import { Menu, type Item, type Screen, type Choice } from '../ui/menu/menu.ts';
import { setSafeColours } from '../ui/palette.ts';
import { ACTIONS, DEFAULT_KEYS, RESERVED, bindKey, keyName, resolveKeys } from '../game/input/bindings.ts';
import { STYLES, STYLE_KEYS } from '../sim/ai/styles.ts';
import { loadSettings, saveSettings, reducedMotion, type Settings, type MatchSetup } from './settings.ts';
import { optionsFromSetup } from './options.ts';

const ARENAS: Choice[] = [
  { value: 'stadium', label: 'Arena' }, { value: 'hall', label: 'Club hall' },
  { value: 'club-day', label: 'Club, day' }, { value: 'club-night', label: 'Club, night' },
];

const nextSeed = (s: number): number => (Math.imul(s, 1103515245) + 12345) >>> 1;
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
  private cupRound = -1;
  /** A match start or a return to the title is under way (repeat presses are ignored). */
  private busy = false;
  /** The title's AI match being built again after it ended (a match start waits for it). */
  private rebuilding: Promise<void> | null = null;
  /** The frame-rate setting as last applied (F3 toggles the meter in a game; only a change of the setting overrides it). */
  private fpsApplied: boolean | null = null;

  constructor(renderer: THREE.WebGPURenderer, hud: HTMLElement, params: URLSearchParams, loading: LoadingScreen) {
    this.renderer = renderer;
    this.hud = hud;
    this.params = params;
    this.loading = loading;
    this.settings = loadSettings();
    // The menu first: the look (reduced motion among it) is applied to it too.
    this.menu = new Menu(document.body);
    this.applyLook();
    this.menu.onChange = () => { saveSettings(this.settings); this.applyLook(); this.game?.applyPrefs(this.prefs()); };
    this.menu.onSound = (k) => this.uiSound(k);
    addEventListener('resize', () => this.game?.resize());
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
  }

  // ---- games ---------------------------------------------------------------------------------------------

  private prefs() {
    return optionsFromSetup(this.settings.setup, this.settings, 0, null, false, this.params).prefs!;
  }

  /** Build a game (the title screen's AI match, or the player's) and start it. */
  private async build(attract: boolean, stage: (name: string, f: number) => void): Promise<void> {
    this.game?.dispose();
    this.game = null;
    await frame();
    stage(attract ? 'Building the arena' : 'Setting up the court', 0.1);
    await frame();
    const seed = (this.seedBase = nextSeed(this.seedBase));
    const opts = optionsFromSetup(attract ? this.settings.setup : this.gameSetup(), this.settings, seed, this.asset, attract, this.params);
    opts.people = castParam(this.params);
    // A rematch is the same four; a knock-out's next round the same pair against new opponents.
    if (attract || this.keep === KEEP_NONE) this.castSeed = seed;
    opts.castSeed = this.castSeed;
    if (!attract && this.keep === KEEP_PAIR) opts.rivals = seed;
    this.keep = KEEP_NONE;
    if (!attract && this.drill >= 0) {
      opts.match.practice = this.drill;
      opts.match.firstServer = 1;
      opts.match.walkBack = false;
    }
    if (this.asset && peopleWanted(this.params)) {
      await loadPeople(this.asset, dealCast(this.castSeed, opts.people, opts.rivals).people, (f) => stage('Fetching the players', 0.1 + 0.4 * f));
    }
    const g = new Game(opts, this.renderer, this.hud);
    (window as unknown as { __bandeja: Game }).__bandeja = g;
    this.game = g;
    stage('Compiling shaders', 0.55);
    await frame();
    await g.warmUp();
    stage('Ready', 1);
    g.onMenu = () => { if (this.playing && !this.menu.isOpen) this.pause(); };
    g.onMatchOver = (st) => {
      if (this.playing) this.results(st);
      // Not inside the game's own frame (the rebuild tears that game down): in a task of its own.
      else setTimeout(() => this.rebuildAttract(), 0);
    };
    g.start();
    if (attract) this.fetchAhead();
    this.playing = !attract;
    if (this.settings.showFps && !attract) g.debug.toggle();
    // The window was left while the match was loading (the blur came before there was a match to pause).
    if (!attract && (document.hidden || !document.hasFocus())) g.onMenu();
  }

  /** The next match's people, fetched while nothing is at stake, so starting it doesn't wait for the network. */
  private fetchAhead(): void {
    if (this.asset && peopleWanted(this.params)) void loadPeople(this.asset, dealCast(nextSeed(this.seedBase), castParam(this.params)).people);
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
    if (this.drill >= 0) return { ...st, mode: 'singles', court: 'standard', level: 'club' };
    if (this.cupRound >= 0) return { ...st, level: CUP[this.cupRound]!.level, length: 'short' };
    return st;
  }

  private play(drill: number, cupRound: number): void {
    this.drill = drill;
    this.cupRound = cupRound;
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
    this.game?.setMenuPaused(true);
    this.menu.open(this.resultsScreen(st), true);
    this.fetchAhead();
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

  private titleScreen(): Screen {
    return {
      id: 'title', title: 'Padel', sub: 'A match is on court one', back: null,
      items: [
        { kind: 'button', label: 'Play', primary: true, desc: 'Set up a match: doubles or singles, your partner and opponents, the venue, the scoring.', action: () => this.menu.open(this.setupScreen()) },
        { kind: 'button', label: 'Quick match', desc: () => `Straight onto court with your last setup: ${this.setupLine()}.`, action: () => this.play(-1, -1) },
        { kind: 'button', label: 'Knock-out', desc: 'Three rounds, a short set each, against stronger players every round. Lose and you are out.', action: () => this.play(-1, 0) },
        { kind: 'button', label: 'Practice', desc: 'A coach feeds you the shots padel is made of: off the glass, overheads, volleys.', action: () => this.menu.open(this.practiceScreen()) },
        { kind: 'button', label: 'Settings', desc: 'Timing, assists, picture quality, sound and accessibility.', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
        { kind: 'button', label: 'Credits', desc: 'The libraries, assets and references the game is built from.', action: () => this.menu.open(this.creditsScreen()) },
      ],
    };
  }

  private practiceScreen(): Screen {
    return {
      id: 'practice', title: 'Practice', sub: 'The coach feeds, you play it out. Pause to leave.',
      items: practiceData.drills.map((d, i) => ({ kind: 'button' as const, label: d.name, desc: d.desc, action: () => this.play(i, -1) })),
    };
  }

  private setupLine(): string {
    const s = this.settings.setup;
    const arena = ARENAS.find((a) => a.value === s.arena)?.label ?? '';
    const lvl = { novice: 'novice', club: 'club', advanced: 'advanced', pro: 'pro' }[s.level];
    return `${s.mode}, ${lvl} opponents, ${arena.toLowerCase()}`;
  }

  private styleChoices(): Choice[] {
    return [{ value: 'random', label: 'Random' }, ...STYLE_KEYS.map((k) => ({ value: k, label: STYLES[k]!.name }))];
  }

  private setupScreen(): Screen {
    const st = this.settings.setup;
    const set = <K extends keyof MatchSetup>(k: K) => (v: unknown): void => {
      st[k] = v as MatchSetup[K];
      if (k === 'mode') {
        if (st.mode === 'doubles' && st.court === 'singles-narrow') st.court = 'standard';
        // The court's options and the opponents' label depend on the mode: the screen is made again.
        this.menu.replace(this.setupScreen());
      }
    };
    const ch = (k: keyof MatchSetup, label: string, options: Choice[], desc: string, hidden?: () => boolean): Item =>
      ({ kind: 'choice', label, options, get: () => st[k], set: set(k), desc, hidden });
    return {
      id: 'setup', title: 'Match', sub: 'Set up the match', side: () => this.setupCard(),
      items: [
        ch('mode', 'Mode', [{ value: 'doubles', label: 'Doubles' }, { value: 'singles', label: 'Singles' }],
          'Padel is played in pairs. Singles is one against one on the same court, or on a narrow one.'),
        ch('level', 'Opponents', [{ value: 'novice', label: 'Novice' }, { value: 'club', label: 'Club' }, { value: 'advanced', label: 'Advanced' }, { value: 'pro', label: 'Pro' }],
          'How well the AI plays: reaction, reading the ball, timing and shot choice (your partner plays at the same level).'),
        ch('partner', 'Partner', this.styleChoices(), 'Your partner’s game. El Relojero is even; El Muro lobs and stays back; Martillo takes the net and smashes; La Serpiente plays víboras and drops.', () => st.mode !== 'doubles'),
        ch('opponents', st.mode === 'doubles' ? 'Opponents’ style' : 'Opponent’s style', this.styleChoices(), 'How the other side plays (random deals each player a style).'),
        ch('arena', 'Venue', ARENAS, 'An indoor arena with a crowd, a covered club hall, or an outdoor club by day or under floodlights.'),
        ch('court', 'Court', [{ value: 'standard', label: 'Standard' }, { value: 'panoramic', label: 'Panoramic' }, ...(st.mode === 'singles' ? [{ value: 'singles-narrow', label: 'Narrow singles' }] : [])],
          'Standard: stepped side glass with mesh. Panoramic: a single run of glass along the sides. Narrow singles: a 6 m wide court for one against one.'),
        ch('scoring', 'Scoring', [{ value: 'star', label: 'Star point' }, { value: 'golden', label: 'Golden point' }, { value: 'advantage', label: 'Advantage' }],
          'Star point: two advantages, then a deciding point at the third deuce (the FIP’s newest method). Golden point: the first deuce is decided by one point. Advantage: win by two.'),
        ch('length', 'Length', [{ value: 'short', label: 'Short set (to 4)' }, { value: 'set', label: 'One set' }, { value: 'three', label: 'Best of three' }],
          'A tie-break at 6-6 (4-4 in a short set).'),
        ch('hand', 'You play', [{ value: 'right', label: 'Right-handed' }, { value: 'left', label: 'Left-handed' }], 'Your racket hand.'),
        { kind: 'button', label: 'Start match', primary: true, desc: 'Onto court with this setup (it is kept for Quick match).', action: () => this.play(-1, -1) },
      ],
      focus: 0,
    };
  }

  private setupCard(): string {
    const st = this.settings.setup;
    const lines = [
      ['Format', st.mode === 'doubles' ? 'Doubles' : 'Singles'],
      ['Venue', ARENAS.find((a) => a.value === st.arena)?.label ?? ''],
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
        ch('Aim with', 'mouseAim', [{ value: false, label: 'Keys' }, { value: true, label: 'Mouse' }], 'Keys: the movement keys steer the target while a shot key is held. Mouse: point at the far court.'),
        { kind: 'group', label: 'Picture' },
        ch('Quality', 'quality', [{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
          'Auto lowers the resolution when frames run long, to hold 60 frames a second. Low draws fewer pixels with softer shadows and no glow. Applies from the next match.'),
        ch('Frame rate meter', 'showFps', onOff, 'Frames per second and frame times, top right (also F3).'),
        ch('Camera', 'camera', [{ value: 'tv', label: 'TV' }, { value: 'near', label: 'TV close' }, { value: 'player', label: 'Player' }],
          'TV: the broadcast camera high behind the glass. TV close: nearer and wider, the players bigger. Player: low behind your end, sliding with you.'),
        ch('Replays', 'replays', [{ value: true, label: 'Big points' }, { value: false, label: 'Off' }],
          'After a winner off the court, a hard overhead or a long rally, the point again from another angle, the winning shot slowed. Enter or Space skips one.'),
        { kind: 'group', label: 'Sound' },
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
        desc: (a.move ? 'Movement. While a shot key is held it steers the aim instead.'
          : a.id === 'power' ? 'Held with a shot key as it is let go: a harder ball (with Overhead a smash, with Volley a punch volley).'
          : a.id === 'precision' ? 'Held with a shot key as it is let go: a placed ball (with Overhead a víbora, with Topspin a chiquita).'
          : 'Hold as the ball comes, release to hit.') + ' Keys kept by the game: Esc (pause), F3, H, P, M, Tab, Enter.',
      });
    }
    items.push(
      { kind: 'button', label: 'Reset keys', desc: 'Back to J K L I U O N, Space and Shift, with WASD and the arrows.', action: () => { s.keys = { ...DEFAULT_KEYS }; saveSettings(s); this.menu.refresh(); this.game?.applyPrefs(this.prefs()); } },
      { kind: 'button', label: 'Back', desc: 'Keys are saved as they change.', action: () => this.menu.back() },
    );
    return { id: 'controls', title: 'Controls', sub: 'Keyboard and gamepad', items, side: () => this.padCard() };
  }

  private padCard(): string {
    const rows = [
      ['Left stick', 'Move (aim while a shot is held)'], ['A', 'Drive'], ['X', 'Topspin'], ['B', 'Slice'], ['Y', 'Lob'],
      ['D-pad', 'Drop shot'], ['LB', 'Volley'], ['RB', 'Overhead'], ['RT', 'Power'], ['LT', 'Precision'], ['Start', 'Pause'],
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
    return {
      id: 'pause', title: 'Paused', sub, back: () => this.resume(),
      items: [
        { kind: 'button', label: 'Resume', primary: true, desc: 'Back to the point, where it stopped.', action: () => this.resume() },
        { kind: 'button', label: 'Settings', desc: 'Sound, picture and accessibility change at once; timing and assists from the next match.', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
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
    const g = this.game!;
    const sim = g.sim;
    const won = sim.score.winner === 0;
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
    const side = `<div class="card"><h2>${mins} min · longest rally ${st.longestRally} shots</h2><table>`
      + `<tr><td class="l"></td><td class="w">${sim.doubles ? 'Your pair' : 'You'}</td><td class="w">${them}</td></tr>`
      + rows.map((r) => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</table></div>';
    const round = this.cupRound;
    if (round >= 0) {
      const last = round === CUP.length - 1;
      const title = !won ? `Out in the ${CUP[round]!.name.toLowerCase()}` : last ? 'Champions' : `Through the ${CUP[round]!.name.toLowerCase()}`;
      return {
        id: 'results', title, sub: `${CUP[round]!.name} · ${sets}`, back: null, side: () => side,
        items: [
          won && !last
            ? { kind: 'button', label: `On to the ${CUP[round + 1]!.name.toLowerCase()}`, primary: true, desc: `Stronger opponents: ${CUP[round + 1]!.level}.`, action: () => this.play(-1, round + 1) }
            : { kind: 'button', label: 'Start again', primary: true, desc: 'A new draw, from the first round.', action: () => this.play(-1, 0) },
          { kind: 'button', label: 'Title screen', desc: 'Back to the club.', action: () => void this.toTitle() },
        ],
      };
    }
    return {
      id: 'results', title: won ? 'You win' : sim.doubles ? 'They win' : 'You lose', sub: `Game, set and match · ${sets}`, back: null, side: () => side,
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
