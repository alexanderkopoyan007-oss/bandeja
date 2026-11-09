// A player's own character (M5 phase D): who they look like (a face preset: a person of data/people.json), their body's
// proportions (proportions.ts), their racket hand, their skin's and hair's tone and their tattoos, what they wear (a
// loadout of owned cosmetics), their racket (one of data/rackets.json, in colours of their own), their celebration and
// their grunt. Kept in the store (store.ts) and shared as a code (`encodeCharacter`). As with settings.ts and store.ts,
// nothing read is trusted: every value is checked, and anything unknown, out of range or of the wrong kind falls back to
// its default, so an old, hand-edited or someone else's code can't break the game.
//
// What a character looks like changes nothing in play: its racket plays as that racket does for anyone, and its body's
// proportions reach the sim only through the optional "Bodies count" toggle (phase D's last step).
import roster from '../../data/people.json' with { type: 'json' };
import { nearestPalette } from '../render/avatar/racketDesign.ts';
import racketData from '../../data/rackets.json' with { type: 'json' };
import { fitted, NEUTRAL, PROPORTION_KEYS, RANGES, type Proportions } from '../render/avatar/proportions.ts';
import { checkedLoadout, defaultLoadout, type Loadout } from './unlocks.ts';

/** The face presets: the people a character can look like (guests are generated stand-ins, not offered). */
export const FACES: ReadonlyArray<{ id: string; woman: boolean }> = [
  ...roster.men.map((p) => ({ id: p.name, woman: false })),
  ...roster.women.map((p) => ({ id: p.name, woman: true })),
];

/** The rackets a character can play (data/rackets.json; `standard` is the game's own). */
export const RACKET_IDS: readonly string[] = Object.keys(racketData).filter((k) => k !== '//');

/** The eight graphics (racketArt.ts) and the finishes the made-up makers use. */
export const RACKET_ART = ['bloc', 'contour', 'ember', 'facet', 'orbit', 'split', 'stripe', 'tide'] as const;
export const FACE_FINISH = ['sand', 'matte', 'gloss'] as const;
export const FRAME_FINISH = ['gloss', 'matte', 'satin'] as const;

/**
 * The hair's tone: the preset's own, a natural colour, or (ridiculous mode only) a dyed one. Linear, as the hair atlas
 * holds colour: real hair is darker than it looks in sRGB (a blonde's sRGB 180,140,90 is linear 0.46, 0.26, 0.1). Lighter
 * values washed light hair out to a felt cap (9 Nov).
 */
export const HAIR_TONES: Readonly<Record<string, { rgb: readonly [number, number, number]; silly?: true }>> = {
  black: { rgb: [0.03, 0.026, 0.024] },
  espresso: { rgb: [0.07, 0.045, 0.03] },
  brown: { rgb: [0.14, 0.08, 0.045] },
  chestnut: { rgb: [0.22, 0.1, 0.05] },
  auburn: { rgb: [0.3, 0.1, 0.04] },
  copper: { rgb: [0.48, 0.19, 0.07] },
  honey: { rgb: [0.42, 0.22, 0.075] },
  blonde: { rgb: [0.68, 0.44, 0.16] },
  platinum: { rgb: [0.85, 0.74, 0.55] },
  grey: { rgb: [0.34, 0.33, 0.31] },
  rose: { rgb: [0.6, 0.18, 0.3], silly: true },
  violet: { rgb: [0.25, 0.1, 0.5], silly: true },
  teal: { rgb: [0.05, 0.35, 0.35], silly: true },
  lime: { rgb: [0.3, 0.55, 0.08], silly: true },
};

/** Original line tattoos (drawn in the skin's shader, phase D's looks step), on the racket arm's forearm or a calf. */
export const TATTOOS = ['band', 'wave', 'vine', 'star', 'dots'] as const;
export type Tattoo = (typeof TATTOOS)[number];

/** Celebrations after a point won (avatar.ts reactions). The fist pump is the one there is; more join this list. */
export const CELEBRATIONS = ['fist'] as const;

/** The grunt voices (voices.ts PLAYER_VOICES): the men's four, then the women's. */
export const VOICE_COUNT = 8;

/** A colour as the looks store it. */
type Hex = string;

export interface RacketDesign {
  /** The racket played (data/rackets.json): how it plays. Its colours below change nothing of that. */
  base: string;
  /** Null: the maker's own look; else the player's own colours over the base's shape and holes. */
  look: null | {
    art: (typeof RACKET_ART)[number];
    /** The face's ground, the graphic's two colours, its accent, the frame and the overgrip. */
    face: Hex; a: Hex; b: Hex; accent: Hex; frame: Hex; grip: Hex;
    finish: (typeof FACE_FINISH)[number];
    frameFinish: (typeof FRAME_FINISH)[number];
  };
}

export interface Character {
  /** Shown over the scoreboard and in the lists: letters, spaces, apostrophes, hyphens and dots, 1-16 of them. */
  name: string;
  face: string;
  hand: 'right' | 'left';
  /** Ridiculous mode: the sliders' wide ranges and the dyed hair. Off, the body stays within the realistic ranges. */
  silly: boolean;
  body: Proportions;
  /** Darker (-1) to lighter (1) than the preset's own skin, within a natural range (0: as modelled). */
  skin: number;
  /** A HAIR_TONES key, or null for the preset's own. */
  hair: string | null;
  tattoos: { arm: Tattoo | null; calf: Tattoo | null };
  outfit: Loadout;
  racket: RacketDesign;
  celebrate: (typeof CELEBRATIONS)[number];
  /** A voice of PLAYER_VOICES (null: the preset's own) and its pitch, -1..1 (about ±3 semitones). */
  voice: number | null;
  pitch: number;
}

export const NAME_MAX = 16;

export function defaultCharacter(face = FACES[0]!.id): Character {
  return {
    name: 'Player', face, hand: 'right', silly: false, body: { ...NEUTRAL }, skin: 0, hair: null,
    tattoos: { arm: null, calf: null }, outfit: defaultLoadout(), racket: { base: 'standard', look: null },
    celebrate: 'fist', voice: null, pitch: 0,
  };
}

// ---- checking -----------------------------------------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : dflt);
const hex = (v: unknown, dflt: Hex): Hex => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : dflt);

/** A name as typed: spaces collapsed, only letters (any script), marks, spaces, apostrophes, hyphens and dots kept. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[^\p{L}\p{M} '’.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** Proportions within the mode's ranges (and, ridiculous, within what the animation is tested on: proportions.fitted),
 * each to three places as the cache keys them. */
export function checkedBody(raw: unknown, silly: boolean): Proportions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const range = RANGES[silly ? 'silly' : 'real'];
  const p = { ...NEUTRAL };
  for (const k of PROPORTION_KEYS) p[k] = num(r[k], range[k][0], range[k][1], 1);
  const f = fitted(p);
  for (const k of PROPORTION_KEYS) f[k] = Math.round(f[k] * 1000) / 1000;
  return f;
}

const DEFAULT_LOOK: NonNullable<RacketDesign['look']> = {
  art: 'stripe', face: '#1d2738', a: '#f2b84b', b: '#f07a1f', accent: '#d8c4a0', frame: '#1d2738', grip: '#111214',
  finish: 'sand', frameFinish: 'gloss',
};

/** A design's colour: one of the designer's (RACKET_PALETTE), the nearest of them to any other. */
const paint = (v: unknown, dflt: Hex): Hex => nearestPalette(hex(v, dflt));

export function checkedRacket(raw: unknown): RacketDesign {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = oneOf(r.base, RACKET_IDS, 'standard');
  if (!r.look || typeof r.look !== 'object') return { base, look: null };
  const l = r.look as Record<string, unknown>;
  const d = DEFAULT_LOOK;
  return {
    base,
    look: {
      art: oneOf(l.art, RACKET_ART, d.art), face: paint(l.face, d.face), a: paint(l.a, d.a), b: paint(l.b, d.b),
      accent: paint(l.accent, d.accent), frame: paint(l.frame, d.frame), grip: paint(l.grip, d.grip), finish: oneOf(l.finish, FACE_FINISH, d.finish),
      frameFinish: oneOf(l.frameFinish, FRAME_FINISH, d.frameFinish),
    },
  };
}

/**
 * A character from anything: every field checked, anything wrong its default. `owned` is the cosmetics the player owns:
 * an outfit item they don't own (someone else's code) is left at the slot's default, as items come by play only.
 */
export function checkedCharacter(raw: unknown, owned: ReadonlySet<string>): Character {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const face = oneOf(r.face, FACES.map((f) => f.id), FACES[0]!.id);
  const c = defaultCharacter(face);
  c.name = cleanName(r.name) || c.name;
  c.hand = r.hand === 'left' ? 'left' : 'right';
  c.silly = r.silly === true;
  c.body = checkedBody(r.body, c.silly);
  c.skin = Math.round(num(r.skin, -1, 1, 0) * 100) / 100;
  const hair = typeof r.hair === 'string' ? HAIR_TONES[r.hair] : undefined;
  c.hair = hair && (c.silly || !hair.silly) ? (r.hair as string) : null;
  const t = (r.tattoos && typeof r.tattoos === 'object' ? r.tattoos : {}) as Record<string, unknown>;
  c.tattoos = {
    arm: typeof t.arm === 'string' && (TATTOOS as readonly string[]).includes(t.arm) ? (t.arm as Tattoo) : null,
    calf: typeof t.calf === 'string' && (TATTOOS as readonly string[]).includes(t.calf) ? (t.calf as Tattoo) : null,
  };
  c.outfit = checkedLoadout(r.outfit, owned);
  c.racket = checkedRacket(r.racket);
  c.celebrate = oneOf(r.celebrate, CELEBRATIONS, 'fist');
  c.voice = typeof r.voice === 'number' && Number.isInteger(r.voice) && r.voice >= 0 && r.voice < VOICE_COUNT ? r.voice : null;
  c.pitch = Math.round(num(r.pitch, -1, 1, 0) * 100) / 100;
  return c;
}

/** The ridiculous mode's switch: off, the body comes back within the realistic ranges and a dyed hair goes. */
export function setSilly(c: Character, on: boolean): void {
  c.silly = on;
  c.body = checkedBody(c.body, on);
  if (c.hair && HAIR_TONES[c.hair]?.silly && !on) c.hair = null;
}

// ---- share codes ------------------------------------------------------------------------------------------------

/** Every code starts with this (its format's version): a code of a later format is refused, not misread. */
export const CODE_PREFIX = 'B1';
/** No code is longer (a share code read back from a page or pasted is checked before it's inflated). */
export const CODE_MAX = 1200;

const toB64url = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function through(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
  const bytes = new Uint8Array(await out);
  if (bytes.length > limit) throw new Error('too long');
  return bytes;
}

/** The fields a code carries, short-named (the outfit only where it differs from the defaults). */
function compact(c: Character): Record<string, unknown> {
  const dflt = defaultLoadout();
  const o: Record<string, string | null> = {};
  for (const [s, id] of Object.entries(c.outfit)) if (id !== dflt[s as keyof Loadout]) o[s] = id;
  return {
    n: c.name, f: c.face, h: c.hand === 'left' ? 1 : 0, s: c.silly ? 1 : 0,
    b: PROPORTION_KEYS.map((k) => Math.round(c.body[k] * 1000)), k: c.skin, ha: c.hair, t: [c.tattoos.arm, c.tattoos.calf], o,
    r: c.racket, c: c.celebrate, v: c.voice, p: c.pitch,
  };
}

function expand(x: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, number> = {};
  if (Array.isArray(x.b)) PROPORTION_KEYS.forEach((k, i) => { const v = (x.b as unknown[])[i]; if (typeof v === 'number') body[k] = v / 1000; });
  const t = Array.isArray(x.t) ? x.t : [];
  return {
    name: x.n, face: x.f, hand: x.h === 1 ? 'left' : 'right', silly: x.s === 1, body, skin: x.k, hair: x.ha,
    tattoos: { arm: t[0], calf: t[1] }, outfit: { ...defaultLoadout(), ...(x.o && typeof x.o === 'object' ? x.o : {}) },
    racket: x.r, celebrate: x.c, voice: x.v, pitch: x.p,
  };
}

/** A character as a code: compact JSON, deflated, in URL-safe base64 after CODE_PREFIX (fits a link's #p=). */
export async function encodeCharacter(c: Character): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compact(c)));
  return CODE_PREFIX + toB64url(await through(json, new CompressionStream('deflate-raw'), CODE_MAX * 4));
}

/** A code back into a character (checked, against the cosmetics `owned`), or null if it isn't one of ours. */
export async function decodeCharacter(code: string, owned: ReadonlySet<string>): Promise<Character | null> {
  const s = code.trim();
  if (!s.startsWith(CODE_PREFIX) || s.length > CODE_MAX || !/^[A-Za-z0-9_-]+$/.test(s.slice(CODE_PREFIX.length))) return null;
  try {
    const json = await through(fromB64url(s.slice(CODE_PREFIX.length)), new DecompressionStream('deflate-raw'), 16 * 1024);
    const x = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)) as unknown;
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    return checkedCharacter(expand(x as Record<string, unknown>), owned);
  } catch {
    return null;
  }
}
