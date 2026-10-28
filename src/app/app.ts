// The app (Phase 8): the loading screen, the menus over an AI match, and the player's matches, all in one page.
// A game is built for each match and torn down after it (Game.dispose), so the title screen, a match, the results
// and back again never reload the page. Settings live in localStorage (settings.ts).
import * as THREE from 'three/webgpu';
import { Game } from '../game/game.ts';
import type { MatchStats } from '../game/stats.ts';
import { loadPlayerAsset, peopleFor, type PlayerAsset } from '../render/avatar/asset.ts';
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
  private seedBase = (Math.random() * 2 ** 31) | 0;
  private busy = false;

  constructor(renderer: THREE.WebGPURenderer, hud: HTMLElement, params: URLSearchParams, loading: LoadingScreen) {
    this.renderer = renderer;
    this.hud = hud;
    this.params = params;
    this.loading = loading;
    this.settings = loadSettings();
    this.applyLook();
    this.menu = new Menu(document.body);
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
        this.asset = await loadPlayerAsset(url, (f) => L.stage('Fetching the players', 0.12 + 0.4 * f), peopleFor(this.params));
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
    const seed = (this.seedBase = (Math.imul(this.seedBase, 1103515245) + 12345) >>> 1);
    const opts = optionsFromSetup(this.settings.setup, this.settings, seed, this.asset, attract, this.params);
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
      else void this.rebuildAttract();
    };
    g.start();
    this.playing = !attract;
    if (this.settings.showFps && !attract) g.debug.toggle();
  }

  private async rebuildAttract(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.build(true, () => undefined); } finally { this.busy = false; }
  }

  private async startMatch(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    saveSettings(this.settings);
    this.menu.hide();
    this.loading.show('Setting up the court');
    try {
      await this.build(false, (n, f) => this.loading.stage(n, f));
      await this.loading.done();
    } catch (err) {
      this.loading.fail(String(err));
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
      await this.build(true, (n, f) => this.loading.stage(n, f));
      await this.loading.done();
    } finally {
      this.busy = false;
    }
    this.menu.open(this.titleScreen(), true);
  }

  private results(st: MatchStats): void {
    this.game?.setMenuPaused(true);
    this.menu.open(this.resultsScreen(st), true);
  }

  // ---- settings applied outside a game --------------------------------------------------------------------

  private applyLook(): void {
    const s = this.settings;
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(s.textSize));
    const calm = reducedMotion(s);
    root.classList.toggle('calm', calm);
    if (this.menu) this.menu.calm = calm;
    setSafeColours(s.safeColours);
    root.classList.toggle('hc', s.contrast);
    if (this.game && this.game.debug.visible !== s.showFps) this.game.debug.toggle();
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
        { kind: 'button', label: 'Quick match', desc: `Straight onto court with your last setup: ${this.setupLine()}.`, action: () => void this.startMatch() },
        { kind: 'button', label: 'Settings', desc: 'Timing, assists, picture quality, sound and accessibility.', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', desc: 'Every shot on the keyboard and the gamepad; change any key.', action: () => this.menu.open(this.controlsScreen()) },
        { kind: 'button', label: 'Credits', desc: 'Who and what made the game.', action: () => this.menu.open(this.creditsScreen()) },
      ],
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
      if (k === 'mode' && st.mode === 'doubles' && st.court === 'singles-narrow') st.court = 'standard';
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
        { kind: 'button', label: 'Start match', primary: true, desc: 'Onto court.', action: () => void this.startMatch() },
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
    return {
      id: 'settings', title: 'Settings', sub: 'Saved on this device',
      items: [
        { kind: 'group', label: 'Gameplay' },
        ch('Timing window', 'timing', [{ value: 'forgiving', label: 'Forgiving' }, { value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict' }],
          'How far from the perfect moment a release still counts as Good. Strict is the real window; forgiving is half as wide again.'),
        ch('Positioning assist', 'assist', [{ value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'strong', label: 'Strong' }],
          'How much the game moves you towards the ball when you leave the keys alone. Off: you move yourself, always.'),
        ch('Auto timing', 'autoTiming', onOff, 'A held swing fires itself at the right moment (graded Good): you choose the shot and the aim, the game times it.'),
        ch('Swing', 'swing', [{ value: 'hold', label: 'Hold and release' }, { value: 'tap', label: 'One tap' }],
          'One tap: press a shot key once and the swing goes off at the right moment by itself (auto timing on); the movement keys still aim. For when holding and releasing a key on time is hard.'),
        ch('Timing cues', 'pro', [{ value: false, label: 'Shown' }, { value: true, label: 'Hidden (pro)' }], 'The closing ring, the meter, the trail and the bounce marker. Pro mode plays without them.'),
        ch('Aim with', 'mouseAim', [{ value: false, label: 'Keys' }, { value: true, label: 'Mouse' }], 'Keys: the movement keys steer the target while a shot key is held. Mouse: point at the far court.'),
        { kind: 'group', label: 'Picture' },
        ch('Quality', 'quality', [{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
          'Auto lowers the resolution when frames run long, to hold 60 frames a second. Low draws fewer pixels with softer shadows and no glow. Applies from the next match.'),
        ch('Frame rate meter', 'showFps', onOff, 'Frames per second and frame times, top right (also F3).'),
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
        { kind: 'button', label: 'Back', action: () => this.menu.back() },
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
        desc: a.move ? 'Movement. While a shot key is held it steers the aim instead.' : `Hold as the ball comes, release to hit. Keys kept by the game: Esc (pause), F3, H, P, M, Tab, Enter.`,
      });
    }
    items.push(
      { kind: 'button', label: 'Reset keys', desc: 'Back to J K L I U O N, Space and Shift, with WASD and the arrows.', action: () => { s.keys = { ...DEFAULT_KEYS }; saveSettings(s); this.menu.refresh(); this.game?.applyPrefs(this.prefs()); } },
      { kind: 'button', label: 'Back', action: () => this.menu.back() },
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
      side: () => '<div class="card"><h2>Made with</h2><table>'
        + '<tr><td class="l">Rendering</td><td>three.js (MIT)</td></tr>'
        + '<tr><td class="l">Players</td><td>Y Bot and clips, Mixamo (Adobe)</td></tr>'
        + '<tr><td class="l">Strokes</td><td>Authored in code</td></tr>'
        + '<tr><td class="l">Sound</td><td>Synthesised in code</td></tr>'
        + '<tr><td class="l">Courts</td><td>Generated in code</td></tr>'
        + '<tr><td class="l">Rules</td><td>FIP Rules of Padel, 2026</td></tr>'
        + '<tr><td class="l">Maths</td><td>fdlibm via musl</td></tr>'
        + '</table></div>',
      items: [
        { kind: 'button', label: 'Back', desc: 'Players and clubs are made up; the playing styles are nicknames, never real players. Full list: CREDITS.md in the source.', action: () => this.menu.back() },
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
        { kind: 'button', label: 'Resume', primary: true, action: () => this.resume() },
        { kind: 'button', label: 'Settings', action: () => this.menu.open(this.settingsScreen()) },
        { kind: 'button', label: 'Controls', action: () => this.menu.open(this.controlsScreen()) },
        { kind: 'button', label: 'Restart match', desc: 'A new match with the same setup.', action: () => this.menu.open(this.confirm('Restart?', 'This match is lost.', () => void this.startMatch())) },
        { kind: 'button', label: 'Quit to title', action: () => this.menu.open(this.confirm('Leave the match?', 'This match is lost.', () => void this.toTitle())) },
      ],
    };
  }

  private confirm(title: string, sub: string, yes: () => void): Screen {
    return {
      id: 'confirm', title, sub,
      items: [
        { kind: 'button', label: 'No, go back', action: () => this.menu.back() },
        { kind: 'button', label: 'Yes', action: yes },
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
    const side = `<div class="card"><h2>${mins} min · longest rally ${st.longestRally} shots</h2><table>`
      + `<tr><td class="l"></td><td class="w">${sim.doubles ? 'Your pair' : 'You'}</td><td class="w">${sim.doubles ? 'Opponents' : 'Opponent'}</td></tr>`
      + rows.map((r) => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</table></div>';
    return {
      id: 'results', title: won ? 'You win' : sim.doubles ? 'They win' : 'You lose', sub: `Game, set and match · ${sets}`, back: null, side: () => side,
      items: [
        { kind: 'button', label: 'Rematch', primary: true, desc: 'The same setup again.', action: () => void this.startMatch() },
        { kind: 'button', label: 'Change setup', action: () => this.menu.open(this.setupScreen()) },
        { kind: 'button', label: 'Title screen', action: () => void this.toTitle() },
      ],
    };
  }
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
