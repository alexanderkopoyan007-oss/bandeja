// Tournaments (M6 phase B, behind ?creator=1 until the owner has seen them): a draw of the roster's pros and the
// player, single elimination (bracket.ts), at a venue and with the rules chosen (the exhibition's: scoring, length,
// how well the AI plays). Doubles is the player with a pro partner against pairs made from the roster, each pair a
// drive player and a revés player of about the same strength where the field allows; singles is the player against
// the pros one by one. The player's own ties are played; the rest are settled from the entries' strengths. Pure: the
// app keeps a tournament in the store (`tourFrom` checks one read back) and builds each tie's court from `tieCourt`.
import { ROSTER, DEALT_FACES, type Pro } from './roster.ts';
import { makeDraw, rng, current, drawFrom, roundName, DRAW_SIZES, type Draw, type Entry } from './bracket.ts';
import type { MatchSetup } from './settings.ts';

export interface TourSetup {
  /** Entries in the draw (pairs in doubles), at most what the roster can fill. */
  size: number;
  doubles: boolean;
  /** A women's draw (the player's own character decides it when there is one). */
  women: boolean;
  /** The player's partner (doubles): a roster id of the draw's sex; '' deals one. */
  partner: string;
  level: MatchSetup['level'];
  arena: MatchSetup['arena'];
  scoring: MatchSetup['scoring'];
  length: MatchSetup['length'];
}

export const DEFAULT_TOUR: TourSetup = { size: 8, doubles: true, women: false, partner: '', level: 'club', arena: 'stadium', scoring: 'star', length: 'short' };

/** A tournament under way: its setup and its draw. */
export interface Tour {
  setup: TourSetup;
  draw: Draw;
}

const LEVELS: ReadonlyArray<MatchSetup['level']> = ['novice', 'club', 'advanced', 'pro'];
const ARENAS: ReadonlyArray<MatchSetup['arena']> = ['stadium', 'hall', 'club-day', 'club-night'];
const SCORINGS: ReadonlyArray<MatchSetup['scoring']> = ['star', 'golden', 'advantage'];
const LENGTHS: ReadonlyArray<MatchSetup['length']> = ['short', 'set', 'three'];

/** The pros of a draw's sex. */
export function field(women: boolean): readonly Pro[] {
  return women ? ROSTER.women : ROSTER.men;
}

export function proById(id: string): Pro | undefined {
  return ROSTER.men.find((p) => p.id === id) ?? ROSTER.women.find((p) => p.id === id);
}

/** The most entries the roster can fill (the player's included; a pro plays in one entry only). */
export function maxEntries(doubles: boolean, women: boolean): number {
  const n = field(women).length;
  return doubles ? Math.floor((n - 1) / 2) + 1 : n + 1;
}

/** The draw sizes offered: those the field fills past half (the rest are byes for the top seeds). */
export function sizesFor(doubles: boolean, women: boolean): number[] {
  const most = maxEntries(doubles, women);
  return DRAW_SIZES.filter((s) => most > s / 2);
}

/** Games in a set and sets to win, from the match length. */
export function formatOf(length: MatchSetup['length']): { games: number; sets: number } {
  return length === 'short' ? { games: 4, sets: 1 } : length === 'set' ? { games: 6, sets: 1 } : { games: 6, sets: 2 };
}

/** The player's partner: the one asked for if they are in this field, else the pro nearest the middle of it (seeded). */
export function partnerFor(setup: TourSetup, seed: number): Pro {
  const pool = field(setup.women);
  const asked = pool.find((p) => p.id === setup.partner);
  if (asked) return asked;
  const mid = [...pool].sort((a, b) => Math.abs(a.level - 0.01) - Math.abs(b.level - 0.01) || a.id.localeCompare(b.id));
  return mid[Math.floor(rng(seed ^ 0x7f4a7c15)() * Math.min(4, mid.length))]!;
}

/**
 * Pairs from these pros: the strongest drive player with the strongest revés player, and so on down; whoever is left
 * over on one side pairs up regardless (the drive side taken by the stronger). Each pair drive first.
 */
export function makePairs(pros: readonly Pro[]): Pro[][] {
  const byLevel = (a: Pro, b: Pro): number => b.level - a.level || a.id.localeCompare(b.id);
  const drive = pros.filter((p) => p.side === 'drive').sort(byLevel);
  const reves = pros.filter((p) => p.side === 'reves').sort(byLevel);
  const pairs: Pro[][] = [];
  while (drive.length && reves.length) pairs.push([drive.shift()!, reves.shift()!]);
  const rest = [...drive, ...reves];
  for (let k = 0; k + 1 < rest.length; k += 2) pairs.push([rest[k]!, rest[k + 1]!]);
  return pairs;
}

/** A new tournament from this setup: the field drawn from the seed, the player's entry first. */
export function newTour(seed: number, setup: TourSetup): Tour {
  const pool = field(setup.women);
  const sizes = sizesFor(setup.doubles, setup.women);
  const size = sizes.includes(setup.size) ? setup.size : sizes[sizes.length - 1]!;
  const n = Math.min(size, maxEntries(setup.doubles, setup.women));
  const rnd = rng(seed);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = shuffled[i]!; shuffled[i] = shuffled[j]!; shuffled[j] = t;
  }
  const entries: Entry[] = [];
  if (setup.doubles) {
    const partner = partnerFor(setup, seed);
    // (the player takes the side their partner doesn't play)
    entries.push({ players: partner.side === 'drive' ? [partner.id, 'you'] : ['you', partner.id], rating: partner.level / 2, seed: 0 });
    const others = shuffled.filter((p) => p !== partner).slice(0, 2 * (n - 1));
    for (const pair of makePairs(others).slice(0, n - 1)) entries.push({ players: pair.map((p) => p.id), rating: (pair[0]!.level + pair[1]!.level) / 2, seed: 0 });
  } else {
    entries.push({ players: ['you'], rating: 0, seed: 0 });
    for (const p of shuffled.slice(0, n - 1)) entries.push({ players: [p.id], rating: p.level, seed: 0 });
  }
  const { games, sets } = formatOf(setup.length);
  const draw = makeDraw(seed, entries, { doubles: setup.doubles, women: setup.women, games, sets, you: 0 });
  return { setup: { ...setup, size }, draw };
}

/** An entry's name as the bracket shows it: surnames, the player as You. */
export function entryName(d: Draw, e: number): string {
  if (e < 0) return 'Bye';
  const names = d.entries[e]!.players.map((id) => (id === 'you' ? 'You' : (proById(id)?.name.last || proById(id)?.name.first) ?? id));
  return names.join(' · ');
}

/**
 * The court for the player's tie this round, by player number: the player's seat (null) with their partner beside
 * them, the other entry across (its drive player at seat 1, revés at 3); the player is at seat 0 on the drive side, or
 * 2 when their partner plays the drive. Two pros on court with one face: the later is given a free face of their sex
 * for the tie (seeded), as is the player without a face of their own (`meFace`).
 */
export function tieCourt(tour: Tour, meFace: string | null): { you: number; seats: Array<Pro | null>; humanFace: string | null; otherFaces: Array<string | null>; faces: Array<string | null> } | null {
  const d = tour.draw;
  const { round, tie } = current(d);
  if (!tie) return null;
  const mine = d.entries[d.you]!, theirs = d.entries[tie.a === d.you ? tie.b : tie.a]!;
  const n = d.doubles ? 4 : 2;
  const seats: Array<Pro | null> = new Array<Pro | null>(n).fill(null);
  let you = 0;
  if (d.doubles) {
    you = mine.players[0] === 'you' ? 0 : 2;
    seats[2 - you] = proById(mine.players.find((p) => p !== 'you')!) ?? null;
    seats[1] = proById(theirs.players[0]!) ?? null;
    seats[3] = proById(theirs.players[1]!) ?? null;
  } else {
    seats[1] = proById(theirs.players[0]!) ?? null;
  }
  // Faces: every one on court once.
  const rnd = rng(d.seed ^ Math.imul(round + 1, 0x632be5ab));
  const free = (taken: Set<string>): string | null => {
    const f = (d.women ? DEALT_FACES.women : DEALT_FACES.men).filter((x) => !taken.has(x));
    return f.length ? f[Math.floor(rnd() * f.length)]! : null;
  };
  const taken = new Set<string>(meFace ? [meFace] : []);
  const faces: Array<string | null> = seats.map(() => null);
  for (let i = 0; i < n; i++) {
    const p = seats[i];
    if (!p) continue;
    const f = taken.has(p.character.face) ? free(taken) : p.character.face;
    if (f) taken.add(f);
    faces[i] = f;
  }
  const humanFace = meFace ? null : free(taken);
  if (humanFace) taken.add(humanFace);
  faces[you] = meFace ?? humanFace;
  return { you, seats, humanFace, otherFaces: seats.map(() => null), faces };
}

/** The round the player plays next, as the menus say it ("the semi-final"), or null. */
export function nextTieName(d: Draw): string | null {
  const { round, tie } = current(d);
  if (!tie) return null;
  const ties = d.rounds[round]!.length;
  return ties === 1 ? 'the final' : ties === 2 ? 'the semi-final' : ties === 4 ? 'the quarter-final' : `the round of ${ties * 2}`;
}

export { roundName };

/** A tournament read back from the store, checked; null if it isn't one. */
export function tourFrom(raw: unknown): Tour | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const setup = tourSetupFrom(o.setup);
  const draw = drawFrom(o.draw);
  if (!draw) return null;
  // Every pro in it is on the roster, of the draw's sex, once; the player in their entry.
  const pool = new Set(field(draw.women).map((p) => p.id));
  const seen = new Set<string>();
  for (const e of draw.entries) {
    if (e.players.length !== (draw.doubles ? 2 : 1)) return null;
    for (const p of e.players) {
      if (p === 'you') continue;
      if (!pool.has(p) || seen.has(p)) return null;
      seen.add(p);
    }
  }
  if (draw.you >= 0 && !draw.entries[draw.you]!.players.includes('you')) return null;
  return { setup: { ...setup, doubles: draw.doubles, women: draw.women }, draw };
}

/** A tournament's setup read back (from the store or a menu), each value checked, the defaults for anything else. */
export function tourSetupFrom(raw: unknown): TourSetup {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
  const doubles = typeof o.doubles === 'boolean' ? o.doubles : DEFAULT_TOUR.doubles;
  const women = typeof o.women === 'boolean' ? o.women : DEFAULT_TOUR.women;
  const sizes = sizesFor(doubles, women);
  return {
    size: pick(o.size, sizes, sizes.includes(DEFAULT_TOUR.size) ? DEFAULT_TOUR.size : sizes[sizes.length - 1]!),
    doubles, women,
    partner: typeof o.partner === 'string' && field(women).some((p) => p.id === o.partner) ? o.partner : '',
    level: pick(o.level, LEVELS, DEFAULT_TOUR.level),
    arena: pick(o.arena, ARENAS, DEFAULT_TOUR.arena),
    scoring: pick(o.scoring, SCORINGS, DEFAULT_TOUR.scoring),
    length: pick(o.length, LENGTHS, DEFAULT_TOUR.length),
  };
}
