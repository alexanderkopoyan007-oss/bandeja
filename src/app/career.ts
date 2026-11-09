// The career (M6 phase E; data/career.json; behind ?creator=1 until the owner has seen it). Pure: the store keeps a
// Career (doc `career.v1`), checked value by value on every read (`careerFrom`). Your player plays doubles with a
// partner from the roster through a season of tournaments in five tiers, each built on the tournament engine
// (tournament.ts `newTour`): ranking points by the round reached, entry by those points (the Masters by a place in
// the ranking), the pair's chemistry growing with every match played together.
import data from '../../data/career.json' with { type: 'json' };
import type { MatchSetup } from './settings.ts';
import { proById, field, newTour, tourFrom, type Tour, type TourSetup } from './tournament.ts';
import { finished, type Draw } from './bracket.ts';
import { proName, type Pro } from './roster.ts';
import type { Rule } from './unlocks.ts';

export type FieldPick = 'weakest' | 'strongest' | 'any';

export interface Tier {
  id: string;
  name: string;
  /** The matches' AI level. */
  level: MatchSetup['level'];
  /** Entries in the draw (pairs, yours among them). */
  size: number;
  pick: FieldPick;
  /** Ranking points to enter (null: by a place in the ranking, `top`). */
  entry: number | null;
  top: number | null;
  /** Ranking points counted back from the title (last): the final lost, the semi-final, ... */
  points: readonly number[];
  length: MatchSetup['length'];
}

export interface CareerEvent {
  id: string;
  name: string;
  /** Index into TIERS. */
  tier: number;
  arena: MatchSetup['arena'];
}

const LEVELS: ReadonlyArray<MatchSetup['level']> = ['novice', 'club', 'advanced', 'pro'];
const LENGTHS: ReadonlyArray<MatchSetup['length']> = ['short', 'set', 'three'];
const ARENAS: ReadonlyArray<MatchSetup['arena']> = ['stadium', 'hall', 'club-day', 'club-night', 'club-dusk', 'final'];

export const TIERS: readonly Tier[] = data.tiers.map((t) => {
  const x = t as typeof t & { entry?: number; top?: number };
  if (!LEVELS.includes(t.level as MatchSetup['level']) || !LENGTHS.includes(t.length as MatchSetup['length'])) throw new Error(`career tier ${t.id}`);
  if (!['weakest', 'strongest', 'any'].includes(t.pick)) throw new Error(`career tier ${t.id}: pick ${t.pick}`);
  return {
    id: t.id, name: t.name, level: t.level as MatchSetup['level'], size: t.size, pick: t.pick as FieldPick,
    entry: x.entry ?? null, top: x.top ?? null, points: t.points, length: t.length as MatchSetup['length'],
  };
});

export const SEASON: readonly CareerEvent[] = data.season.map((e) => {
  const tier = TIERS.findIndex((t) => t.id === e.tier);
  if (tier < 0 || !ARENAS.includes(e.arena as MatchSetup['arena'])) throw new Error(`career event ${e.id}`);
  return { id: e.id, name: e.name, tier, arena: e.arena as MatchSetup['arena'] };
});

export const CHEMISTRY = data.chemistry;
/** The secret arenas and the career rule that opens each (until then the menus don't list them). */
export const SECRET_ARENAS: ReadonlyArray<{ id: MatchSetup['arena']; name: string; unlock: Rule }> = data.arenas.map((a) => {
  if (!ARENAS.includes(a.id as MatchSetup['arena'])) throw new Error(`career arena ${a.id}`);
  return { id: a.id as MatchSetup['arena'], name: a.name, unlock: a.unlock as Rule };
});
/** Seasons whose events count in the ranking (this one in full, the one before halved). */
export const ROLLING = data.rolling;
/** The tier from which any pro will partner you. */
export const PARTNERS_ALL = TIERS.findIndex((t) => t.id === data.partners.all);

/** One event played: which, in which season, how far (rounds from the end: 0 the title, 1 the final lost...), what it earned. */
export interface CareerResult {
  event: string;
  season: number;
  tier: number;
  /** Rounds short of the title: 0 won it, 1 lost the final, 2 the semi-final... */
  short: number;
  points: number;
  partner: string;
}

export interface Career {
  /** A women's career (the player's character decides it when it starts). */
  women: boolean;
  /** The partner now, a roster id of the career's sex. */
  partner: string;
  /** Chemistry with each partner played with (0..1). */
  chemistry: Record<string, number>;
  /** Season 1, 2, ... and the next event in it (an index into SEASON). */
  season: number;
  next: number;
  /** Every event played, oldest first (the last 60 kept). */
  results: CareerResult[];
  /** The event under way (its index in SEASON) and its draw, or none. */
  playing: number;
  tour: Tour | null;
  /** Matches played and won together, all seasons. */
  played: number;
  won: number;
}

const RESULTS_KEPT = 60;

/** A pro's ranking points (from their roster level: they don't play the career's events). */
export function proPoints(p: Pro): number {
  return Math.round(data.pro.base + (p.level - data.pro.from) * data.pro.perLevel);
}

/** The pros who will partner you now: the lower half of the roster by level, or anyone once you have played the
 * tier that opens them all. */
export function partnersFor(c: Pick<Career, 'women' | 'results'> | null, women: boolean): Pro[] {
  const pool = [...field(women)].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  if (c && c.results.some((r) => r.tier >= PARTNERS_ALL)) return pool;
  return pool.slice(0, Math.ceil(pool.length * data.partners.lower));
}

export function newCareer(women: boolean, partner: string): Career {
  return {
    women, partner, chemistry: { [partner]: CHEMISTRY.start }, season: 1, next: 0, results: [], playing: -1, tour: null,
    played: 0, won: 0,
  };
}

/** Your ranking points: this season's events in full and the season before's halved. */
export function careerPoints(c: Pick<Career, 'season' | 'results'>): number {
  let n = 0;
  for (const r of c.results) {
    if (r.season === c.season) n += r.points;
    else if (r.season === c.season - 1 && ROLLING > 1) n += Math.floor(r.points / 2);
  }
  return n;
}

/** The ranking of the career's sex: every pro and you, by points (ties: you below). */
export function ranking(c: Career): Array<{ id: string; name: string; points: number }> {
  const rows = field(c.women).map((p) => ({ id: p.id, name: proName(p), points: proPoints(p) }));
  rows.push({ id: 'you', name: 'You', points: careerPoints(c) });
  return rows.sort((a, b) => b.points - a.points || (a.id === 'you' ? 1 : b.id === 'you' ? -1 : a.name.localeCompare(b.name)));
}

/** Your place in the ranking (1 the top). */
export function rankOf(c: Career): number {
  return ranking(c).findIndex((r) => r.id === 'you') + 1;
}

/** You can enter event k: the points for its tier, or a place in the top for the Masters. */
export function canEnter(c: Career, k: number): boolean {
  const t = TIERS[SEASON[k]!.tier]!;
  if (t.top !== null) return rankOf(c) <= t.top;
  return careerPoints(c) >= (t.entry ?? 0);
}

/** What stands between you and event k ('' nothing). */
export function entryNeed(c: Career, k: number): string {
  if (canEnter(c, k)) return '';
  const t = TIERS[SEASON[k]!.tier]!;
  return t.top !== null ? `the top ${t.top} of the ranking (you are ${ordinal(rankOf(c))})` : `${t.entry} ranking points (you have ${careerPoints(c)})`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Event k's tournament setup. */
export function eventSetup(c: Career, k: number): TourSetup {
  const e = SEASON[k]!, t = TIERS[e.tier]!;
  return { size: t.size, doubles: true, women: c.women, partner: c.partner, level: t.level, arena: e.arena, scoring: 'star', length: t.length };
}

/** The pros who fill event k's draw (the partner left out): the weakest, the strongest or all of them. */
export function eventField(c: Career, k: number): Pro[] {
  const t = TIERS[SEASON[k]!.tier]!;
  const pool = field(c.women).filter((p) => p.id !== c.partner);
  if (t.pick === 'any') return pool;
  const need = 2 * (t.size - 1);
  const sorted = [...pool].sort((a, b) => (t.pick === 'weakest' ? a.level - b.level : b.level - a.level) || a.id.localeCompare(b.id));
  return sorted.slice(0, need);
}

/** Enter event k: its draw made from the seed. */
export function enterEvent(c: Career, k: number, seed: number): Career {
  if (c.tour || k !== c.next || !canEnter(c, k)) return c;
  return { ...c, playing: k, tour: newTour(seed, eventSetup(c, k), eventField(c, k)) };
}

/** Pass the next event: the season moves on. */
export function passEvent(c: Career): Career {
  if (c.tour) return c;
  return advance({ ...c });
}

function advance(c: Career): Career {
  c.next++;
  if (c.next >= SEASON.length) { c.next = 0; c.season++; }
  return c;
}

/** One of your ties played: the pair's chemistry and the counts. */
export function recordTie(c: Career, won: boolean): Career {
  const now = c.chemistry[c.partner] ?? CHEMISTRY.start;
  const chem = Math.min(1, now + CHEMISTRY.perMatch + (won ? CHEMISTRY.perWin : 0));
  return { ...c, chemistry: { ...c.chemistry, [c.partner]: Math.round(chem * 1000) / 1000 }, played: c.played + 1, won: c.won + (won ? 1 : 0) };
}

/** Rounds short of the title in a draw over for you (0 won it), or -1 while you are still in. */
export function shortOf(d: Draw): number {
  for (let r = 0; r < d.rounds.length; r++) {
    for (const t of d.rounds[r]!) {
      if (t.winner >= 0 && t.winner !== d.you && (t.a === d.you || t.b === d.you)) return d.rounds.length - r;
    }
  }
  return finished(d) ? 0 : -1;
}

/** The ranking points for going out `short` rounds before the title in a tier. */
export function pointsFor(tier: number, short: number): number {
  const p = TIERS[tier]!.points;
  return p[Math.max(0, p.length - 1 - short)]!;
}

/** The event under way is over for you: its points kept, the season moves on. */
export function finishEvent(c: Career): Career {
  if (!c.tour || c.playing < 0) return c;
  const short = shortOf(c.tour.draw);
  if (short < 0) return c;
  const e = SEASON[c.playing]!;
  const res: CareerResult = { event: e.id, season: c.season, tier: e.tier, short, points: pointsFor(e.tier, short), partner: c.partner };
  const out: Career = { ...c, results: [...c.results, res].slice(-RESULTS_KEPT), tour: null, playing: -1, next: c.playing };
  return advance(out);
}

/** A new partner: chemistry with them starts where it left off (or at the start). */
export function changePartner(c: Career, id: string): Career {
  if (c.tour || !partnersFor(c, c.women).some((p) => p.id === id)) return c;
  return { ...c, partner: id, chemistry: { ...c.chemistry, [id]: c.chemistry[id] ?? CHEMISTRY.start } };
}

/** The highest tier played (-1 none) and the highest won (-1 none), for the unlock rules. */
export function careerReach(c: Career | null): { tier: number; title: number } {
  let tier = -1, title = -1;
  for (const r of c?.results ?? []) {
    tier = Math.max(tier, r.tier);
    if (r.short === 0) title = Math.max(title, r.tier);
  }
  return { tier, title };
}

/** The partner as the career names them. */
export function partnerName(c: Career): string {
  const p = proById(c.partner);
  return p ? proName(p) : c.partner;
}

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);

/** A career read back from the store, every value checked (null: none, or not one this build can trust). */
export function careerFrom(raw: unknown): Career | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.women !== 'boolean' || typeof o.partner !== 'string') return null;
  const women = o.women;
  const ids = new Set(field(women).map((p) => p.id));
  if (!ids.has(o.partner)) return null;
  if (!int(o.season, 1, 9999) || !int(o.next, 0, SEASON.length - 1) || !int(o.played, 0, 1e6) || !int(o.won, 0, 1e6) || o.won > o.played) return null;
  const chemistry: Record<string, number> = {};
  if (o.chemistry && typeof o.chemistry === 'object') {
    for (const [k, v] of Object.entries(o.chemistry as Record<string, unknown>)) if (ids.has(k) && num(v, 0, 1)) chemistry[k] = v;
  }
  if (chemistry[o.partner] === undefined) chemistry[o.partner] = CHEMISTRY.start;
  const results: CareerResult[] = [];
  if (Array.isArray(o.results)) {
    for (const r of o.results.slice(-RESULTS_KEPT)) {
      if (!r || typeof r !== 'object') continue;
      const x = r as Record<string, unknown>;
      const k = SEASON.findIndex((e) => e.id === x.event);
      if (k < 0 || !int(x.season, 1, o.season) || x.tier !== SEASON[k]!.tier || !int(x.short, 0, 8) || typeof x.partner !== 'string' || !ids.has(x.partner)) continue;
      // (the points are the tier's for that round: never read back as stored)
      results.push({ event: SEASON[k]!.id, season: x.season, tier: SEASON[k]!.tier, short: x.short, points: pointsFor(SEASON[k]!.tier, x.short), partner: x.partner });
    }
  }
  let playing = -1, tour: Tour | null = null;
  if (o.tour !== null && o.tour !== undefined) {
    tour = tourFrom(o.tour);
    // (the event under way must be the next one, a draw of the career's sex with the partner in it)
    if (!tour || !int(o.playing, 0, SEASON.length - 1) || o.playing !== o.next || tour.draw.women !== women || !tour.draw.doubles
      || !tour.draw.entries[tour.draw.you]?.players.includes(o.partner)) tour = null;
    else playing = o.playing;
  }
  return { women, partner: o.partner, chemistry, season: o.season, next: o.next, results, playing, tour, played: o.played, won: o.won };
}
