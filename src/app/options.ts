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
import type { CameraPreset } from '../render/views.ts';
import { type MatchSetup, type Settings, LEVEL_AI, PARTNER_AI, TIMING_SCALE, ASSIST_LEVEL, reducedMotion } from './settings.ts';
import type { Wear } from '../render/avatar/costume.ts';
import { COSMETIC_BY_ID, paintOf } from './unlocks.ts';
import { HAIR_TONES, type Character } from './character.ts';
import type { SelfLook } from '../render/avatar/kit.ts';
import { TATTOO_DESIGNS } from '../render/avatar/tattoo.ts';
import { isNeutral } from '../render/avatar/proportions.ts';

/**
 * URL parameters that name a game (what optionsFromUrl and main.ts read to set one up): any of them launches it
 * straight away, as every tool and test page does. The page-only ones (backend, dpr, quality, tone, bloom,
 * gputime) tune the renderer and keep the menus, and anything else (a share link's fbclid, utm_source, gclid,
 * ref) is ignored by the game.
 */
const GAME_PARAMS = new Set([
  'autoplay', 'mode', 'seed', 'styles', 'scoring', 'court', 'floor', 'temp', 'alt', 'windx', 'windz', 'sets', 'games',
  'ai', 'lefty', 'timing', 'assist', 'autotime', 'tap', 'server', 'pro', 'gfx', 'aim', 'runahead', 'sound', 'arena',
  'gpuload', 'fpscap', 'cam', 'camp', 'avatar', 'people', 'ball', 'photo', 'still', 'lines', 'overlay', 'wipe', 'lab', 'shot', 'rackets', 'wear',
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
      // Rackets by player number (data/rackets.json ids): ?rackets=qarro-yunque,lumbra-sosiego (missing: standard)
      rackets: params.get('rackets')?.split(','),
      // Defaults are forgiving; ?timing=1 is the strict "pro" window, ?autotime=1 fires a held swing for you.
      timingScale: num('timing', 1.5),
      assist: num('assist', 0.45),
      autoTiming: params.get('autotime') === '1' || params.get('tap') === '1',
      tapSwing: params.get('tap') === '1',
      firstServer: num('server', 0),
    },
    human: 0,
    autoplay,
    wear: wearParam(params),
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
    camera: cameraOf(params.get('camera')),
    replays: params.get('replays') !== '0',
    avatar,
    // ?quality=auto: High with the dynamic resolution on, as the menus' Auto (perf runs measure it this way).
    prefs: { quality: qualityPreset(params.get('quality') === 'auto' ? 'high' : params.get('quality')), adapt: params.get('quality') === 'auto' },
  };
}

/** `?camera=` (render/views.ts CAMERA_PRESETS), else the broadcast camera. */
function cameraOf(v: string | null): CameraPreset {
  return v === 'near' || v === 'player' ? v : 'tv';
}

/** Sets and games for the menu's match lengths. */
const LENGTH: Record<MatchSetup['length'], { setsToWin: number; gamesPerSet: number }> = {
  short: { setsToWin: 1, gamesPerSet: 4 },
  set: { setsToWin: 1, gamesPerSet: 6 },
  three: { setsToWin: 2, gamesPerSet: 6 },
};

/**
 * The same people play the same way: dealt from each match's seed, a partner changed style under the same name between
 * a knock-out's rounds (review round 17, the critic's #5). A choice in the menu stands. `all`: the opponents too (a rematch).
 */
export function keepStyles(styles: string[], setup: MatchSetup, castSeed: number, all: boolean): void {
  const dealt = dealStyles(castSeed, styles.length);
  if (styles.length === 4 && setup.partner === 'random') styles[2] = dealt[2]!;
  if (all && setup.opponents === 'random') {
    styles[1] = dealt[1]!;
    if (styles.length === 4) styles[3] = dealt[3]!;
  }
}

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
      aiLevel: [attract ? level : PARTNER_AI[setup.level], level],
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
    camera: s.camera,
    replays: s.replays,
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
      pro: s.pro, mouseAim: s.mouseAim, camera: s.camera, replays: s.replays,
    },
  };
}

/**
 * What each player wears beyond the suit, by player number: `?wear=head-cap+eyes-wrap,head-visor,,wrist-pair`
 * (data/cosmetics.json ids, + between one player's; `nohead` takes a modelled headband or visor off). Undefined when
 * the URL doesn't say.
 */
export function wearParam(params: URLSearchParams): Array<Wear | undefined> | undefined {
  const s = params.get('wear');
  if (!s) return undefined;
  // (a + in a query reads as a space)
  return s.split(',').map((one) => wearFromIds(one.split(/[+ ]/)));
}

/** What a list of cosmetic ids puts on a player (`nohead` takes a modelled headband or visor off). */
export function wearFromIds(ids: readonly string[]): Wear | undefined {
  const w: Wear = {};
  for (const id of ids) {
    if (id === 'nohead') w.head = null;
    const slot = COSMETIC_BY_ID.get(id)?.slot;
    if (slot === 'head' || slot === 'eyes' || slot === 'wrist' || slot === 'bag' || slot === 'costume') w[slot] = id;
  }
  // (the suit's paint and the overgrip: shirt cuts, patterns, tights, sock lengths, shoes)
  const { paint, grip } = paintOf(ids);
  if (Object.keys(paint).length) w.paint = paint;
  if (grip) w.grip = grip;
  return Object.keys(w).length ? w : undefined;
}

/**
 * The player's own character (app/character.ts) as the human's player: their face (dealt at seat 0, cast.ts), body,
 * outfit, racket and hand; their voice and pitch go to the sound (game.ts). The racket is the one thing the sim sees: a
 * racket played as anyone who chose it plays it, with the character's colours only drawn.
 */
export function applyCharacter(opts: GameOptions, c: Character): void {
  const n = opts.match.doubles ? 4 : 2;
  const at = opts.human;
  opts.me = c;
  if (!isNeutral(c.body)) {
    opts.bodies = Array.from({ length: n }, (_, i) => opts.bodies?.[i] ?? null);
    opts.bodies[at] = c.body;
  }
  const worn = Object.values(c.outfit).filter((v): v is string => typeof v === 'string');
  opts.wear = Array.from({ length: n }, (_, i) => opts.wear?.[i]);
  opts.wear[at] = wearFromIds(worn);
  opts.match.rackets = Array.from({ length: n }, (_, i) => opts.match.rackets?.[i] ?? 'standard');
  opts.match.rackets[at] = c.racket.base;
  opts.match.lefty = Array.from({ length: n }, (_, i) => opts.match.lefty?.[i] ?? false);
  opts.match.lefty[at] = c.hand === 'left';
  if (c.racket.look) {
    opts.designs = Array.from({ length: n }, (_, i) => opts.designs?.[i] ?? null);
    opts.designs[at] = c.racket.look;
  }
  const look = selfLookOf(c);
  if (look) {
    opts.looks = Array.from({ length: n }, (_, i) => opts.looks?.[i] ?? null);
    opts.looks[at] = look;
  }
}

/** A character's skin, hair and tattoos as the shader takes them (null: the face preset's own, none). */
export function selfLookOf(c: Character): SelfLook | null {
  const hair = c.hair ? HAIR_TONES[c.hair]?.rgb ?? null : null;
  const design = (t: string | null): number => (t ? TATTOO_DESIGNS.indexOf(t as (typeof TATTOO_DESIGNS)[number]) + 1 : 0);
  const tattoos = { arm: design(c.tattoos.arm), calf: design(c.tattoos.calf), left: c.hand === 'left' };
  const inked = tattoos.arm > 0 || tattoos.calf > 0;
  return c.skin === 0 && !hair && !inked ? null : { skin: c.skin, hair, tattoos: inked ? tattoos : null };
}
