// Cosmetics and how they are earned (M5 phase C): the catalogue (data/cosmetics.json), the player's progress, and the
// rules that turn one into the other. Pure: the store (app/store.ts) keeps the progress, the app records into it at a
// match's end and when a drill is left. Earned by playing only.
import data from '../../data/cosmetics.json';
import practiceData from '../../data/practice.json';
import type { MatchSetup } from './settings.ts';

export type Level = MatchSetup['level'];
export const LEVELS: readonly Level[] = ['novice', 'club', 'advanced', 'pro'];

export type Slot = 'top' | 'pattern' | 'bottom' | 'socks' | 'shoes' | 'head' | 'eyes' | 'wrist' | 'grip' | 'bag' | 'costume';
export const SLOTS = Object.keys(data.slots) as Slot[];

/** How an item is earned: see data/cosmetics.json's "//". */
export type Rule =
  | 'starter'
  | { played: number; level?: Level }
  | { won: number; level?: Level }
  | { cupReached: number }
  | { cupWins: number }
  | { drill: string; points: number }
  | { drills: number }
  | { aces: number }
  | { porTres: number }
  | { rally: number }
  | { speed: number };

export interface Cosmetic {
  id: string;
  slot: Slot;
  name: string;
  kind: 'paint' | 'garment' | 'attachment' | 'costume';
  covers?: Slot[];
  look?: Record<string, string>;
  unlock: Rule;
}

export const COSMETICS = data.items as Cosmetic[];
export const COSMETIC_BY_ID: ReadonlyMap<string, Cosmetic> = new Map(COSMETICS.map((c) => [c.id, c]));
export const SLOT_INFO = data.slots as Record<Slot, { name: string; required: boolean }>;
export const DRILL_NAMES: readonly string[] = practiceData.drills.map((d) => d.name);

/** What the player has done, as the rules read it. */
export interface Progress {
  /** Finished matches against the AI, by the opponents' level. */
  played: Record<Level, number>;
  won: Record<Level, number>;
  /** Finished online matches (never by level: the room sets no level). */
  online: { played: number; won: number };
  /** The knock-out's furthest round reached (-1 none yet) and the knock-outs won. */
  cupReached: number;
  cupWins: number;
  /** Points won off the coach, by drill name, every visit together. */
  drills: Record<string, number>;
  /** The player's own, every finished match together. */
  aces: number;
  porTres: number;
  /** Bests: the longest rally of a finished match (shots), the player's fastest ball (km/h). */
  rally: number;
  speed: number;
}

export function blankProgress(): Progress {
  const byLevel = (): Record<Level, number> => ({ novice: 0, club: 0, advanced: 0, pro: 0 });
  return {
    played: byLevel(), won: byLevel(), online: { played: 0, won: 0 }, cupReached: -1, cupWins: 0,
    drills: {}, aces: 0, porTres: 0, rally: 0, speed: 0,
  };
}

/** A finished match, from the player's side. */
export interface MatchRecord {
  /** The opponents' level; null online. */
  level: Level | null;
  won: boolean;
  /** The knock-out round this was (0 quarter-final .. 2 final), or -1. */
  cupRound: number;
  /** The player's own. */
  aces: number;
  porTres: number;
  fastest: number;
  longestRally: number;
}

/** The progress after a finished match (a new object; `p` is left as it was). */
export function recordMatch(p: Progress, m: MatchRecord, cupRounds = 3): Progress {
  const q = copyProgress(p);
  if (m.level === null) {
    q.online.played++;
    if (m.won) q.online.won++;
  } else {
    q.played[m.level]++;
    if (m.won) q.won[m.level]++;
  }
  if (m.cupRound >= 0) {
    // Reaching a round is playing it; winning the last is the cup.
    q.cupReached = Math.max(q.cupReached, m.won ? Math.min(m.cupRound + 1, cupRounds - 1) : m.cupRound);
    if (m.won && m.cupRound === cupRounds - 1) q.cupWins++;
  }
  q.aces += m.aces;
  q.porTres += m.porTres;
  q.rally = Math.max(q.rally, m.longestRally);
  q.speed = Math.max(q.speed, Math.round(m.fastest));
  return q;
}

/** The progress after `points` more points won in a drill. */
export function recordDrill(p: Progress, drill: string, points: number): Progress {
  const q = copyProgress(p);
  if (points > 0 && DRILL_NAMES.includes(drill)) q.drills[drill] = (q.drills[drill] ?? 0) + points;
  return q;
}

function copyProgress(p: Progress): Progress {
  return { ...p, played: { ...p.played }, won: { ...p.won }, online: { ...p.online }, drills: { ...p.drills } };
}

/** Matches at `level` or harder (any level when left out). */
function atLeast(by: Record<Level, number>, level: Level | undefined): number {
  const from = level ? LEVELS.indexOf(level) : 0;
  let n = 0;
  for (let i = from; i < LEVELS.length; i++) n += by[LEVELS[i]!];
  return n;
}

/** How far along a rule is: [have, need]; met when have >= need. */
export function ruleProgress(rule: Rule, p: Progress): [number, number] {
  if (rule === 'starter') return [1, 1];
  if ('played' in rule) return [atLeast(p.played, rule.level), rule.played];
  if ('won' in rule) return [atLeast(p.won, rule.level), rule.won];
  // Rounds count from 0, so the round's number plus one is the need.
  if ('cupReached' in rule) return [p.cupReached + 1, rule.cupReached + 1];
  if ('cupWins' in rule) return [p.cupWins, rule.cupWins];
  if ('drill' in rule) return [p.drills[rule.drill] ?? 0, rule.points];
  if ('drills' in rule) return [Math.min(...DRILL_NAMES.map((d) => p.drills[d] ?? 0)), rule.drills];
  if ('aces' in rule) return [p.aces, rule.aces];
  if ('porTres' in rule) return [p.porTres, rule.porTres];
  if ('rally' in rule) return [p.rally, rule.rally];
  return [p.speed, rule.speed];
}

export function ruleMet(rule: Rule, p: Progress): boolean {
  const [have, need] = ruleProgress(rule, p);
  return have >= need;
}

const LEVEL_NAME: Record<Level, string> = { novice: 'Novice', club: 'Club', advanced: 'Advanced', pro: 'Pro' };
const CUP_ROUND = ['quarter-final', 'semi-final', 'final'];
const times = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`);

/** The rule as the locker says it. */
export function describeRule(rule: Rule): string {
  if (rule === 'starter') return 'Yours from the start.';
  const at = (l?: Level): string => (l ? ` against ${LEVEL_NAME[l]} opponents or harder` : '');
  if ('played' in rule) return `Play ${times(rule.played, 'a match', 'matches')}${at(rule.level)}.`;
  if ('won' in rule) return `Win ${times(rule.won, 'a match', 'matches')}${at(rule.level)}.`;
  if ('cupReached' in rule) return `Reach the knock-out's ${CUP_ROUND[rule.cupReached] ?? 'final'}.`;
  if ('cupWins' in rule) return `Win the knock-out${rule.cupWins === 1 ? '' : ` ${rule.cupWins} times`}.`;
  if ('drill' in rule) return `Win ${rule.points} points off the coach in the ${rule.drill.toLowerCase()} drill.`;
  if ('drills' in rule) return `Win ${rule.drills} points off the coach in every drill.`;
  if ('aces' in rule) return `Serve ${times(rule.aces, 'an ace', 'aces')}.`;
  if ('porTres' in rule) return `Put ${times(rule.porTres, 'a ball', 'balls')} out of the court (por tres or por cuatro).`;
  if ('rally' in rule) return `Play a rally of ${rule.rally} shots.`;
  return `Hit a ball at ${rule.speed} km/h.`;
}

/** Every item the progress has earned (the starters included). */
export function earned(p: Progress): string[] {
  return COSMETICS.filter((c) => ruleMet(c.unlock, p)).map((c) => c.id);
}

/** The items earned that aren't in `owned` yet, in catalogue order. */
export function newlyEarned(p: Progress, owned: ReadonlySet<string>): Cosmetic[] {
  return COSMETICS.filter((c) => !owned.has(c.id) && ruleMet(c.unlock, p));
}

/** What a player wears: an item id per slot, or null for an empty optional slot. */
export type Loadout = Record<Slot, string | null>;

/** The first starter in every required slot, nothing in the optional ones. */
export function defaultLoadout(): Loadout {
  const out = {} as Loadout;
  for (const s of SLOTS) out[s] = SLOT_INFO[s].required ? (COSMETICS.find((c) => c.slot === s && c.unlock === 'starter')?.id ?? null) : null;
  return out;
}

/** A loadout with every slot holding an owned item of that slot (or the default where it doesn't). */
export function checkedLoadout(raw: unknown, owned: ReadonlySet<string>): Loadout {
  const out = defaultLoadout();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const s of SLOTS) {
    const v = r[s];
    if (v === null && !SLOT_INFO[s].required) out[s] = null;
    else if (typeof v === 'string' && owned.has(v) && COSMETIC_BY_ID.get(v)?.slot === s) out[s] = v;
  }
  return out;
}

/** The slots a loadout's worn items hide (a dress hides the bottom; a costume the shirt, pattern and more). */
export function covered(l: Loadout): Set<Slot> {
  const out = new Set<Slot>();
  for (const s of SLOTS) {
    const id = l[s];
    for (const c of (id && COSMETIC_BY_ID.get(id)?.covers) || []) out.add(c);
  }
  return out;
}
