// Game options from the two ways a game starts: the menus (a match setup and the settings) and the URL (every tool,
// test page and old link: `?autoplay=1`, `?mode=singles&seed=...`, which skip the menus as before Phase 8).
import { MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_NORMAL } from '../sim/rules/score.ts';
import type { BallName, FloorName } from '../sim/setup.ts';
import arenaData from '../../data/arenas.json' with { type: 'json' };
import { Rng } from '../sim/core/rng.ts';
import { STYLE_KEYS } from '../sim/ai/styles.ts';
import type { PlayerAsset } from '../render/avatar/asset.ts';
import type { GameOptions } from '../game/game.ts';
import { resolveKeys } from '../game/input/bindings.ts';
import { qualityPreset } from '../render/quality.ts';
import { type MatchSetup, type Settings, LEVEL_AI, TIMING_SCALE, ASSIST_LEVEL, reducedMotion } from './settings.ts';

/**
 * URL parameters that name a game (what optionsFromUrl and main.ts read to set one up): any of them launches it
 * straight away, as every tool and test page does. The page-only ones (backend, dpr, quality, tone, bloom,
 * gputime) tune the renderer and keep the menus, and anything else (a share link's fbclid, utm_source, gclid,
 * ref) is ignored by the game.
 */
const GAME_PARAMS = new Set([
  'autoplay', 'mode', 'seed', 'styles', 'scoring', 'court', 'floor', 'temp', 'alt', 'windx', 'windz', 'sets', 'games',
  'ai', 'lefty', 'timing', 'assist', 'autotime', 'tap', 'server', 'pro', 'gfx', 'aim', 'runahead', 'sound', 'arena',
  'gpuload', 'fpscap', 'cam', 'camp', 'avatar', 'people', 'ball', 'photo', 'still', 'lines', 'overlay', 'wipe', 'lab', 'shot',
]);

/** Does the URL ask for a game straight away (tools and links from before the menus)? */
export function directLaunch(params: URLSearchParams): boolean {
  for (const k of params.keys()) if (GAME_PARAMS.has(k)) return true;
  return false;
}

/** The roof over an arena's court (m), Infinity in the open air: the sim's ceiling (FIP 13.1.g, 14.1.d). */
export function roofOf(arena: string): number {
  const a = (arenaData as unknown as Record<string, { kind?: string; hall?: { height?: number } }>)[arena];
  if (!a || a.kind === 'outdoor') return Infinity;
  return a.hall?.height ?? Infinity;
}

function ballFor(asked: string | null, altitudeM: number): BallName {
  if (asked === 'standard' || asked === 'altitude') return asked;
  return altitudeM > 1000 ? 'altitude' : 'standard';
}

const QUALITY_KEYS = ['auto', 'low', 'medium', 'high', 'ultra'];

/** Styles by player number, `?styles=` or dealt from the seed (the same deal the game has always made). */
function dealStyles(seed: number, n: number): string[] {
  const deal = new Rng(seed ^ 0x2545f491);
  return Array.from({ length: n }, () => STYLE_KEYS[Math.floor(deal.next() * STYLE_KEYS.length)]!);
}

export function optionsFromUrl(params: URLSearchParams, avatar: PlayerAsset | null): GameOptions {
  const num = (k: string, d: number): number => {
    const v = params.get(k);
    return v === null || Number.isNaN(Number(v)) ? d : Number(v);
  };
  const autoplay = params.get('autoplay') === '1';
  // Doubles is padel; ?mode=singles plays one against one (not a FIP format).
  const doubles = params.get('mode') !== 'singles';
  const n = doubles ? 4 : 2;
  const seed = num('seed', (Math.random() * 2 ** 31) | 0);
  const styles = params.get('styles')?.split(',') ?? dealStyles(seed, n);
  const mode = params.get('scoring');
  return {
    match: {
      seed,
      world: {
        court: params.get('court') ?? 'standard',
        floor: (params.get('floor') as FloorName | null) ?? 'turf',
        // ?ball=standard|altitude; above 1000 m the altitude ball is taken unless asked otherwise (FIP allows it there).
        ball: ballFor(params.get('ball'), num('alt', 0)),
        env: {
          temperatureC: num('temp', 20), altitudeM: num('alt', 0), windX: num('windx', 0), windZ: num('windz', 0),
          ceiling: roofOf(params.get('arena') ?? 'stadium'),
        },
      },
      format: {
        mode: mode === 'golden' ? MODE_GOLDEN : mode === 'advantage' ? MODE_ADVANTAGE : MODE_STAR,
        setsToWin: num('sets', 2),
        gamesPerSet: num('games', 6),
        finalSet: FINAL_NORMAL,
      },
      doubles,
      human: Array.from({ length: n }, (_, i) => !autoplay && i === 0),
      aiLevel: [num('ai', 0.55), num('ai', 0.55)],
      aiStyle: styles,
      // Left-handers by player number: ?lefty=0,3
      lefty: Array.from({ length: n }, (_, i) => (params.get('lefty') ?? '').split(',').includes(String(i))),
      // Defaults are forgiving; ?timing=1 is the strict "pro" window, ?autotime=1 fires a held swing for you.
      timingScale: num('timing', 1.5),
      assist: num('assist', 0.45),
      autoTiming: params.get('autotime') === '1' || params.get('tap') === '1',
      tapSwing: params.get('tap') === '1',
      firstServer: num('server', 0),
    },
    human: 0,
    autoplay,
    forceWebGL: params.get('backend') === 'webgl',
    pro: params.get('pro') === '1',
    gfx: params.get('gfx') ?? undefined,
    bloom: params.get('bloom') !== '0',
    cutaway: params.get('cutaway') !== '0',
    mouseAim: params.get('aim') === 'mouse',
    runAhead: params.get('runahead') !== '0',
    sound: params.get('sound') !== '0',
    arena: params.get('arena') ?? 'stadium',
    dprCap: num('dpr', 2),
    gpuLoad: num('gpuload', 1),
    fpsCap: num('fpscap', 0),
    closeCam: params.get('cam') ?? undefined,
    closeCamPlayer: num('camp', 0),
    avatar,
    // ?quality=auto: High with the dynamic resolution on, as the menus' Auto (perf runs measure it this way).
    prefs: { quality: qualityPreset(params.get('quality') === 'auto' ? 'high' : params.get('quality')), adapt: params.get('quality') === 'auto' },
  };
}

/** Sets and games for the menu's match lengths. */
const LENGTH: Record<MatchSetup['length'], { setsToWin: number; gamesPerSet: number }> = {
  short: { setsToWin: 1, gamesPerSet: 4 },
  set: { setsToWin: 1, gamesPerSet: 6 },
  three: { setsToWin: 2, gamesPerSet: 6 },
};

/** A game from the menus: the player's match (`attract` false) or the AI match behind the title screen. */
export function optionsFromSetup(setup: MatchSetup, s: Settings, seed: number, avatar: PlayerAsset | null, attract: boolean,
  params: URLSearchParams): GameOptions {
  const doubles = setup.mode === 'doubles';
  const n = doubles ? 4 : 2;
  const styles = dealStyles(seed, n);
  // Player numbers: the player 0, partner 2 (team 0); opponents 1 and 3.
  if (!attract) {
    if (doubles && setup.partner !== 'random' && STYLE_KEYS.includes(setup.partner)) styles[2] = setup.partner;
    if (setup.opponents !== 'random' && STYLE_KEYS.includes(setup.opponents)) {
      styles[1] = setup.opponents;
      if (doubles) styles[3] = setup.opponents;
    }
  }
  const court = !doubles ? setup.court : setup.court === 'singles-narrow' ? 'standard' : setup.court;
  const level = attract ? 0.85 : LEVEL_AI[setup.level];
  const len = attract ? LENGTH.three : LENGTH[setup.length];
  const calm = reducedMotion(s);
  // ?quality= (page-only: the menus stay) overrides the stored preset for this visit.
  const urlQ = params.get('quality');
  const quality = urlQ && QUALITY_KEYS.includes(urlQ) ? urlQ : s.quality;
  const auto = quality === 'auto';
  return {
    match: {
      seed,
      world: { court, floor: 'turf', env: { temperatureC: 20, altitudeM: 0, windX: 0, windZ: 0, ceiling: roofOf(setup.arena) } },
      format: {
        mode: setup.scoring === 'golden' ? MODE_GOLDEN : setup.scoring === 'advantage' ? MODE_ADVANTAGE : MODE_STAR,
        setsToWin: len.setsToWin, gamesPerSet: len.gamesPerSet, finalSet: FINAL_NORMAL,
      },
      doubles,
      human: Array.from({ length: n }, (_, i) => !attract && i === 0),
      aiLevel: [level, level],
      aiStyle: styles,
      lefty: Array.from({ length: n }, (_, i) => !attract && i === 0 && setup.hand === 'left'),
      timingScale: TIMING_SCALE[s.timing],
      assist: ASSIST_LEVEL[s.assist],
      autoTiming: s.autoTiming || s.swing === 'tap',
      tapSwing: s.swing === 'tap',
      firstServer: 0,
    },
    human: 0,
    autoplay: attract,
    forceWebGL: params.get('backend') === 'webgl',
    pro: s.pro,
    bloom: params.get('bloom') !== '0',
    cutaway: params.get('cutaway') !== '0',
    mouseAim: s.mouseAim,
    runAhead: true,
    sound: true,
    arena: setup.arena,
    dprCap: params.has('dpr') ? Number(params.get('dpr')) || 2 : 4,
    avatar,
    attract,
    prefs: {
      volume: s.volume, crowd: s.crowd, shake: !calm, rumble: s.rumble, announce: s.announce,
      keys: resolveKeys(s.keys), quality: qualityPreset(auto ? 'high' : quality), adapt: auto, transitions: true,
      pro: s.pro, mouseAim: s.mouseAim,
    },
  };
}
