// A tournament's draw (M6 phase B; the career's events in phase E): entries seeded by strength, a single-elimination
// bracket with byes, the player's own ties played and every other tie settled from the two entries' strengths by a
// seeded result (no hidden matches are simulated: a draw is the same draw on any machine, and costs nothing). Pure:
// the store keeps a draw as plain JSON, and `drawFrom` checks one read back value by value.

/** An entry: a pair (doubles) or one player, by roster id; `you` is the player's own seat in it. */
export interface Entry {
  /** Roster ids, or 'you' (the player); the drive player first in doubles. */
  players: string[];
  /** How strong they are (the pros' mean level, data/roster.json): the seeding and the other ties' odds. */
  rating: number;
  /** 1 for the top seed...; 0 unseeded. */
  seed: number;
}

/** A tie: two entries by index (-1: a bye), its winner (-1 to be played) and the score as it reads. */
export interface Tie {
  a: number;
  b: number;
  winner: number;
  score: string;
}

export interface Draw {
  /** The seed the draw and its results come from. */
  seed: number;
  /** Doubles (pairs) or singles. */
  doubles: boolean;
  /** Women's or men's. */
  women: boolean;
  /** Games in a set (4: short sets, 6: full), and sets to win: how the other ties' scores read. */
  games: number;
  sets: number;
  entries: Entry[];
  /** Rounds, first round first; a round is made when the one before it is over. */
  rounds: Tie[][];
  /** The player's entry (-1: none: a draw watched). */
  you: number;
}

/** The draw sizes there are (entries; a pair is one). */
export const DRAW_SIZES = [4, 8, 16] as const;

/** How a strength gap plays out (logistic scale, in roster levels): a 0.04 gap wins about four ties in five. */
export const RESULT_SCALE = 0.03;

/** A seeded stream (mulberry32): the same draw from the same seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed lines for a bracket of `size` (a power of two): which seed sits on each line. 1 and 2 in different halves,
 * 1 to 4 in different quarters, and every first-round tie k against size + 1 - k (1, 8, 4, 5, 2, 7, 3, 6 for eight). */
export function seedLines(size: number): number[] {
  let lines = [1];
  while (lines.length < size) {
    const n = lines.length * 2;
    lines = lines.flatMap((s) => [s, n + 1 - s]);
  }
  return lines;
}

/** The chance entry a beats entry b in a tie not played by the player. */
export function winChance(a: Entry, b: Entry): number {
  return 1 / (1 + Math.exp(-(a.rating - b.rating) / RESULT_SCALE));
}

/**
 * A draw of these entries: seeded by rating (the strongest quarter of the field, at least two, get seeds; the
 * player's entry is seeded by its rating like any other), the bracket the next power of two up with byes for the top
 * seeds, the unseeded placed at random from `seed`.
 */
export function makeDraw(seed: number, entries: Entry[], o: { doubles: boolean; women: boolean; games: number; sets: number; you: number }): Draw {
  const n = entries.length;
  if (n < 2) throw new Error('a draw needs two entries');
  let size = 2;
  while (size < n) size *= 2;
  const rnd = rng(seed);
  const byRating = entries.map((_, i) => i).sort((x, y) => entries[y]!.rating - entries[x]!.rating || x - y);
  const seeds = Math.max(2, Math.min(n, size / 4));
  for (const e of entries) e.seed = 0;
  byRating.slice(0, seeds).forEach((i, k) => { entries[i]!.seed = k + 1; });
  // The lines: seeds where the layout puts them, byes against the top seeds, the rest shuffled into what is left.
  const layout = seedLines(size);
  const line: number[] = new Array<number>(size).fill(-2);
  for (let k = 0; k < seeds; k++) line[layout.indexOf(k + 1)] = byRating[k]!;
  const byes = size - n;
  // A bye is the line facing a top seed (seed k's opponent line, in seed order).
  for (let k = 0; k < byes; k++) {
    const at = layout.indexOf(k + 1), facing = at ^ 1;
    line[facing] = -1;
  }
  const rest = byRating.slice(seeds);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = rest[i]!; rest[i] = rest[j]!; rest[j] = t;
  }
  for (let k = 0; k < size; k++) if (line[k] === -2) line[k] = rest.shift() ?? -1;
  const first: Tie[] = [];
  for (let k = 0; k < size; k += 2) first.push({ a: line[k]!, b: line[k + 1]!, winner: -1, score: '' });
  const d: Draw = { seed, doubles: o.doubles, women: o.women, games: o.games, sets: o.sets, entries, rounds: [first], you: o.you };
  settleByes(d.rounds[0]!);
  return d;
}

function settleByes(round: Tie[]): void {
  for (const t of round) {
    if (t.winner >= 0) continue;
    if (t.a < 0 && t.b >= 0) { t.winner = t.b; t.score = 'bye'; }
    else if (t.b < 0 && t.a >= 0) { t.winner = t.a; t.score = 'bye'; }
  }
}

/** The round being played (the last one made), and the player's tie in it (null: out, or not in this round). */
export function current(d: Draw): { round: number; tie: Tie | null } {
  const round = d.rounds.length - 1;
  const tie = d.rounds[round]!.find((t) => t.winner < 0 && (t.a === d.you || t.b === d.you)) ?? null;
  return { round, tie };
}

/** The player's tie this round as it was played: they won it or not, with the score as it reads. */
export function recordYours(d: Draw, won: boolean, score: string): void {
  const { tie } = current(d);
  if (!tie) return;
  tie.winner = won ? d.you : tie.a === d.you ? tie.b : tie.a;
  tie.score = score;
}

/**
 * Every other tie of the round settled (seeded by the draw, the round and the line: the same on every machine), then
 * the next round made from the winners. Call once the player's tie of the round is played (or they are out).
 */
export function playRound(d: Draw): void {
  const r = d.rounds.length - 1;
  const round = d.rounds[r]!;
  if (round.some((t) => t.winner < 0 && (t.a === d.you || t.b === d.you))) return;
  round.forEach((t, k) => {
    if (t.winner >= 0) return;
    const rnd = rng(d.seed ^ Math.imul(r + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b));
    const ea = d.entries[t.a]!, eb = d.entries[t.b]!;
    const aWins = rnd() < winChance(ea, eb);
    t.winner = aWins ? t.a : t.b;
    t.score = scoreLine(rnd, Math.abs(winChance(ea, eb) - 0.5), d.games, d.sets);
  });
  if (round.length > 1) {
    const next: Tie[] = [];
    for (let k = 0; k < round.length; k += 2) next.push({ a: round[k]!.winner, b: round[k + 1]!.winner, winner: -1, score: '' });
    d.rounds.push(next);
  }
}

/** The draw is over: its final is decided. */
export function finished(d: Draw): boolean {
  const last = d.rounds[d.rounds.length - 1]!;
  return last.length === 1 && last[0]!.winner >= 0;
}

/** The player is still in (or won it). */
export function stillIn(d: Draw): boolean {
  if (d.you < 0) return false;
  for (const r of d.rounds) for (const t of r) if (t.winner >= 0 && (t.a === d.you || t.b === d.you) && t.winner !== d.you) return false;
  return true;
}

/** How far the player got: the number of rounds won (the champion: all of them). */
export function roundsWon(d: Draw): number {
  let n = 0;
  for (const r of d.rounds) for (const t of r) if (t.winner === d.you && t.score !== 'bye') n++;
  return n;
}

/** A round's name by how many ties it has. */
export function roundName(ties: number): string {
  return ties === 1 ? 'Final' : ties === 2 ? 'Semi-finals' : ties === 4 ? 'Quarter-finals' : `Round of ${ties * 2}`;
}

/**
 * A score for a tie not played, from the winner's side: closer ties (a small strength edge) go to tight sets and
 * deciders more often. `games` per set (a tie-break at games-games reads 7-6 or 5-4), `sets` to win.
 */
export function scoreLine(rnd: () => number, edge: number, games: number, sets: number): string {
  const out: string[] = [];
  let won = 0, lost = 0;
  // (how often the weaker side takes a set: the closer, the likelier)
  const upset = 0.42 * (1 - Math.min(1, edge * 2));
  while (won < sets) {
    const theirs = sets > 1 && lost < sets - 1 && rnd() < upset;
    // Games for the side that loses this set: tight more often when it is close.
    const tight = rnd() < 0.25 + 0.35 * (1 - Math.min(1, edge * 2));
    const g = tight ? (rnd() < 0.5 ? games - 1 : games) : Math.floor(rnd() * (games - 1));
    const set = g === games ? `${games + 1}-${games}` : g === games - 1 ? `${games + 1}-${games - 1}` : `${games}-${g}`;
    const [w, l] = set.split('-');
    out.push(theirs ? `${l}-${w}` : set);
    if (theirs) lost++; else won++;
  }
  return out.join(' ');
}

/** A draw read back from the store, checked value by value; null if it isn't one. */
export function drawFrom(raw: unknown): Draw | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const seed = int(o.seed, -(2 ** 31), 2 ** 32), games = int(o.games, 1, 6), sets = int(o.sets, 1, 3);
  if (seed === null || games === null || sets === null || typeof o.doubles !== 'boolean' || typeof o.women !== 'boolean') return null;
  if (!Array.isArray(o.entries) || o.entries.length < 2 || o.entries.length > 32) return null;
  const entries: Entry[] = [];
  for (const e of o.entries as unknown[]) {
    const x = e as Record<string, unknown>;
    if (!x || !Array.isArray(x.players) || !x.players.every((p) => typeof p === 'string' && p.length < 40) || typeof x.rating !== 'number' || !Number.isFinite(x.rating)) return null;
    const s = int(x.seed, 0, 32);
    if (s === null) return null;
    entries.push({ players: [...(x.players as string[])], rating: x.rating, seed: s });
  }
  const n = entries.length;
  const you = int(o.you, -1, n - 1);
  if (you === null || !Array.isArray(o.rounds) || o.rounds.length < 1 || o.rounds.length > 6) return null;
  const rounds: Tie[][] = [];
  for (const r of o.rounds as unknown[]) {
    if (!Array.isArray(r) || r.length < 1) return null;
    const ties: Tie[] = [];
    for (const t of r as unknown[]) {
      const x = t as Record<string, unknown>;
      const a = int(x?.a, -1, n - 1), b = int(x?.b, -1, n - 1), w = int(x?.winner, -1, n - 1);
      if (a === null || b === null || w === null || typeof x.score !== 'string' || x.score.length > 40) return null;
      if (w >= 0 && w !== a && w !== b) return null;
      ties.push({ a, b, winner: w, score: x.score });
    }
    rounds.push(ties);
  }
  // Each round half the one before.
  for (let k = 1; k < rounds.length; k++) if (rounds[k]!.length * 2 !== rounds[k - 1]!.length) return null;
  return { seed, doubles: o.doubles, women: o.women, games, sets, entries, rounds, you };
}
