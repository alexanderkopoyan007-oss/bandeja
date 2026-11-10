// The player's settings and last match setup (Phase 8): what the menus change, kept in localStorage between visits.
// Every value has a default, and anything stored that isn't a known value is ignored, so an old or hand-edited store
// can't break the game. Browser storage can be missing or throw (private windows, blocked site data): the game then
// runs on the defaults.
import { STYLE_KEYS } from '../sim/ai/styles.ts';

/** How a match is set up (the Play screen). */
export interface MatchSetup {
  mode: 'doubles' | 'singles';
  /** Opponents' level (data/ai-skill.json levels). */
  level: 'novice' | 'club' | 'advanced' | 'pro';
  /** The AI partner's playing style ('random' or a key of data/ai.json). */
  partner: string;
  /** The opponents' playing style ('random', or one style for both). */
  opponents: string;
  arena: 'stadium' | 'hall' | 'club-day' | 'club-night' | 'club-dusk' | 'final';
  court: 'standard' | 'panoramic' | 'singles-narrow';
  scoring: 'star' | 'golden' | 'advantage';
  /** short: one set to 4 games; set: one set to 6; three: best of three sets to 6. */
  length: 'short' | 'set' | 'three';
  hand: 'right' | 'left';
  /** "Bodies count" (behind ?creator=1, with your own player; never online): your player's height, arms and legs change
   * their reach and speed (sim/player/bodyTune.ts). Off, every body plays as the game's tuned one. */
  bodies: boolean;
}

export interface Settings {
  setup: MatchSetup;
  // Gameplay
  /** Timing window scale: forgiving 1.5 (the game's default since M1), standard 1.25, strict 1. */
  timing: 'forgiving' | 'standard' | 'strict';
  /** Positioning assist: none, light, normal (0.45, the default since M1), strong. */
  assist: 'off' | 'light' | 'normal' | 'strong';
  autoTiming: boolean;
  /** hold: hold a shot key and release it to swing; tap: one press charges it and the swing times itself (turns on
   * auto timing). For players who can't hold and release a key on time. */
  swing: 'hold' | 'tap';
  /** Pro mode: no timing cues, meter, trail or bounce marker. */
  pro: boolean;
  mouseAim: boolean;
  // Video
  /** auto: High with the render scale adapted to hold 60 Hz (Game.adapt); the others are fixed presets; custom (M8,
   * behind ?creator=1) is the three below. */
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
  /** Custom quality (render/quality.ts customPreset): pixels drawn, the key light's shadows, the lens glow. */
  resolution: 'half' | 'three' | 'full' | 'sharp';
  shadows: 'off' | 'low' | 'high' | 'ultra';
  glow: boolean;
  /** Field of view (M8, behind ?creator=1): degrees added to the match camera's own lens (views.ts). */
  fov: -10 | -5 | 0 | 5 | 10 | 15;
  showFps: boolean;
  /** The match camera (render/views.ts CAMERA_PRESETS): TV, TV close, the player camera, and (M7, listed behind
   * ?creator=1 until the owner has seen them) the side and dynamic cameras. */
  camera: 'tv' | 'near' | 'player' | 'side' | 'dynamic' | 'court' | 'close' | 'glass';
  /** Instant replays of big points (game/replay.ts). */
  replays: boolean;
  /** The score graphics: simple (the HUD's) or a TV package (ui/tv.ts). Listed behind ?creator=1 (M7) until the owner has seen it. */
  graphics: 'simple' | 'tv';
  /** The umpire's calls spoken (game/umpire.ts, ui/umpireVoice.ts): off, English or Spanish. Behind ?creator=1 (M7). */
  umpire: 'off' | 'en' | 'es';
  /** The umpire's calls written on screen. Behind ?creator=1 (M7). */
  captions: boolean;
  // Sound (0..1)
  volume: number;
  crowd: number;
  /** The players' grunts and calls (M8, behind ?creator=1). */
  voices: number;
  // Accessibility
  /** Camera kick on smashes, the score banner's slam, sliding menus: 'system' follows prefers-reduced-motion. */
  motion: 'system' | 'full' | 'reduced';
  /** The camera's kick on smashes (M8, behind ?creator=1): off by itself, or with reduced motion. The game draws no
   * motion blur, so there is none to turn off. */
  shake: boolean;
  /** Cue and grade colours a red-green colour-blind player can tell apart. */
  safeColours: boolean;
  /** High-contrast panels: the HUD's and menus' glass nearly opaque, a backing behind the HUD's loose words. */
  contrast: boolean;
  /** HUD and menu text size. */
  textSize: 1 | 1.25 | 1.5;
  /** Speak points, games and the score through a screen reader (an ARIA live region). */
  announce: boolean;
  /** Controller rumble. */
  rumble: boolean;
  /** Keyboard bindings: action id (input/bindings.ts ACTIONS: drive, lob, up...) -> key codes. */
  keys: Record<string, string[]>;
  /** Gamepad bindings (M8, behind ?creator=1): shot id -> standard-mapping button indices (bindings.ts resolvePad). */
  padKeys: Record<string, number[]>;
  /** Which change of a default this save has been through (loadSettings). */
  defaultsV: number;
}

export const DEFAULT_SETUP: MatchSetup = {
  mode: 'doubles', level: 'advanced', partner: 'random', opponents: 'random', arena: 'stadium', court: 'standard',
  scoring: 'star', length: 'set', hand: 'right', bodies: false,
};

export function defaultSettings(): Settings {
  return {
    setup: { ...DEFAULT_SETUP },
    timing: 'forgiving', assist: 'normal', autoTiming: false, swing: 'hold', pro: false, mouseAim: false,
    quality: 'auto', resolution: 'sharp', shadows: 'high', glow: true, fov: 0, showFps: false, camera: 'tv', replays: true, graphics: 'simple', umpire: 'off', captions: false,
    volume: 1, crowd: 1, voices: 1,
    motion: 'system', shake: true, safeColours: false, contrast: false, textSize: 1, announce: true, rumble: true,
    keys: {}, padKeys: {},
    defaultsV: 1,
  };
}

/** The allowed values of each choice field (numbers and key bindings are checked by range and shape). */
const CHOICES: Record<string, readonly unknown[]> = {
  mode: ['doubles', 'singles'], level: ['novice', 'club', 'advanced', 'pro'],
  arena: ['stadium', 'hall', 'club-day', 'club-night', 'club-dusk', 'final'], court: ['standard', 'panoramic', 'singles-narrow'],
  scoring: ['star', 'golden', 'advantage'], length: ['short', 'set', 'three'], hand: ['right', 'left'],
  timing: ['forgiving', 'standard', 'strict'], assist: ['off', 'light', 'normal', 'strong'], swing: ['hold', 'tap'],
  quality: ['auto', 'low', 'medium', 'high', 'ultra', 'custom'], resolution: ['half', 'three', 'full', 'sharp'],
  shadows: ['off', 'low', 'high', 'ultra'], fov: [-10, -5, 0, 5, 10, 15], camera: ['tv', 'near', 'player', 'side', 'dynamic', 'court', 'close', 'glass'], graphics: ['simple', 'tv'], umpire: ['off', 'en', 'es'], motion: ['system', 'full', 'reduced'], textSize: [1, 1.25, 1.5],
  // A partner's or the opponents' style: 'random' or a style that exists (data/ai.json).
  partner: ['random', ...STYLE_KEYS], opponents: ['random', ...STYLE_KEYS],
};

const KEY = 'bandeja.settings.v1';

/** Copy the fields of `src` that `dst` has and that hold an allowed value of the same kind. */
function merge(dst: Record<string, unknown>, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  const s = src as Record<string, unknown>;
  for (const k of Object.keys(dst)) {
    const v = s[k];
    const d = dst[k];
    if (v === undefined) continue;
    if (CHOICES[k]) { if (CHOICES[k]!.includes(v)) dst[k] = v; }
    else if (typeof d === 'boolean') { if (typeof v === 'boolean') dst[k] = v; }
    else if (typeof d === 'number') { if (typeof v === 'number' && Number.isFinite(v)) dst[k] = k === 'defaultsV' ? v : Math.max(0, Math.min(1, v)); }
    else if (typeof d === 'string') { if (typeof v === 'string' && /^[a-z-]{1,24}$/.test(v)) dst[k] = v; }
    else if (k === 'keys') {
      if (v && typeof v === 'object') {
        const out: Record<string, string[]> = {};
        for (const [b, codes] of Object.entries(v as Record<string, unknown>)) {
          if (Array.isArray(codes) && codes.every((c) => typeof c === 'string' && /^[A-Za-z0-9]{1,20}$/.test(c))) out[b] = codes.slice(0, 3) as string[];
        }
        dst[k] = out;
      }
    } else if (k === 'padKeys') {
      if (v && typeof v === 'object') {
        const out: Record<string, number[]> = {};
        for (const [b, idx] of Object.entries(v as Record<string, unknown>)) {
          if (Array.isArray(idx) && idx.every((i) => Number.isInteger(i) && i >= 0 && i <= 15)) out[b] = idx.slice(0, 3) as number[];
        }
        dst[k] = out;
      }
    } else if (d && typeof d === 'object') merge(d as Record<string, unknown>, v);
  }
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(s as unknown as Record<string, unknown>, JSON.parse(raw));
  } catch {
    // No storage (or unreadable): the defaults.
  }
  // The default opponents went from Club to Advanced: a save from before that moves once, and Club chosen since stays.
  if (s.defaultsV < 2) {
    if (s.setup.level === 'club') s.setup.level = 'advanced';
    s.defaultsV = 2;
  }
  // So did the volume, from 0.8: that took a further 3.9 dB off a match already 10 LU under a TV programme.
  if (s.defaultsV < 3) {
    if (s.volume === 0.8) s.volume = 1;
    s.defaultsV = 3;
  }
  // Narrow singles only exists for singles.
  if (s.setup.court === 'singles-narrow' && s.setup.mode === 'doubles') s.setup.court = 'standard';
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not kept (private window, quota): the game goes on with them for this visit.
  }
}

/** The settings' merge rules, for the tests. */
export function settingsFrom(stored: unknown): Settings {
  const s = defaultSettings();
  merge(s as unknown as Record<string, unknown>, stored);
  return s;
}

export const LEVEL_AI: Record<MatchSetup['level'], number> = { novice: 0.2, club: 0.55, advanced: 0.8, pro: 1 };
/** A human's partner, a level above the opponents: at the same level they gave away a fifth of the pair's points, and
 * the human, who has no motor error, carried them. */
export const PARTNER_AI: Record<MatchSetup['level'], number> = { novice: 0.55, club: 0.8, advanced: 1, pro: 1 };
export const TIMING_SCALE: Record<Settings['timing'], number> = { forgiving: 1.5, standard: 1.25, strict: 1 };
export const ASSIST_LEVEL: Record<Settings['assist'], number> = { off: 0, light: 0.25, normal: 0.45, strong: 0.7 };

/** Reduced motion, from the setting or (by default) the system's preference. */
export function reducedMotion(s: Settings): boolean {
  if (s.motion !== 'system') return s.motion === 'reduced';
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
