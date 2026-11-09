// The roster (M5 phase E): the pros the AI players are (data/roster.json), behind ?creator=1 with the rest of M5 until
// the owner has seen it. Each pro is a character (character.ts: face, hand, skin and hair, tattoos, outfit, racket, voice
// and pitch; never reshaped) with a name, a side, a style (data/ai.json), a signature shot and a level. A match deals its
// court from them: never two on one court with one face, the player's own face kept for the player, and each pair's
// drive player on the right (the slot that receives in the deuce box, rules/score.ts receiverPlayer).
import data from '../../data/roster.json' with { type: 'json' };
import people from '../../data/people.json' with { type: 'json' };
import { checkedCharacter, FACES, type Character } from './character.ts';
import { COSMETICS } from './unlocks.ts';
import { applyCharacterAt } from './options.ts';
import type { MatchSetup } from './settings.ts';
import { STYLE_KEYS, type StyleTweak } from '../sim/ai/styles.ts';
import { seeded } from '../game/cast.ts';
import type { PlayerName } from '../game/names.ts';
import type { GameOptions } from '../game/game.ts';

export type Side = 'drive' | 'reves';
export const SIDES: readonly Side[] = ['drive', 'reves'];

export interface Pro {
  id: string;
  name: PlayerName;
  woman: boolean;
  /** How they look and what they play with (their face is `character.face`). */
  character: Character;
  side: Side;
  /** A key of data/ai.json. */
  style: string;
  /** A key of the roster's signatures: the shot their style leans on more (it is in `tweak`). */
  signature: string;
  /** Against the match's AI level (added to the style's own). */
  level: number;
  /** Their style as they play it: the level and the signature's change (ai/styles.ts StyleTweak). */
  tweak: StyleTweak;
}

type RawPro = (typeof data.men)[number] & { tattoos?: { arm?: string; calf?: string } };

/** What each signature shot does to a style. */
export const SIGNATURES: Readonly<Record<string, StyleTweak>> = Object.fromEntries(
  Object.entries(data.signatures).filter(([k]) => !k.startsWith('/')),
) as Record<string, StyleTweak>;

/** The faces a match can deal, by sex: the made people and the dealt guests (data/people.json). */
export const DEALT_FACES = {
  men: [...people.men.map((p) => p.name), ...people.guests.filter((g) => g.dealt && !g.woman).map((g) => g.name)],
  women: [...people.women.map((p) => p.name), ...people.guests.filter((g) => g.dealt && g.woman).map((g) => g.name)],
};
/** Faces that are one baked surface (the Meshy people): no skin, hair, tattoo, cut or pattern of their own shows. */
export const BAKED_FACES: ReadonlySet<string> = new Set(people.guests.map((g) => g.name));

/** Pros wear what they like: every piece is theirs. */
const EVERY_PIECE: ReadonlySet<string> = new Set(COSMETICS.map((c) => c.id));

function proOf(r: RawPro, woman: boolean): Pro {
  // Checked as any character is. A guest face isn't one of the creator's presets, so it is checked as a preset of its
  // sex and put back after; its grunt is the face's own.
  const preset = FACES.some((f) => f.id === r.face) ? r.face : FACES.find((f) => f.woman === woman)!.id;
  const c = checkedCharacter({ ...r, name: `${r.first} ${r.last}`.trim(), face: preset }, EVERY_PIECE);
  c.face = r.face;
  if (preset !== r.face) c.voice = null;
  return {
    id: r.id,
    name: { first: r.first, last: r.last, nation: r.nation },
    woman,
    character: c,
    side: r.side === 'reves' ? 'reves' : 'drive',
    style: STYLE_KEYS.includes(r.style) ? r.style : 'reloj',
    signature: r.signature,
    level: r.level,
    tweak: { level: r.level, ...(SIGNATURES[r.signature] ?? {}) },
  };
}

export const ROSTER: { readonly men: readonly Pro[]; readonly women: readonly Pro[] } = {
  men: (data.men as RawPro[]).map((r) => proOf(r, false)),
  women: (data.women as RawPro[]).map((r) => proOf(r, true)),
};

/** A pro's name as the lists show it. */
export function proName(p: Pro): string {
  return [p.name.first, p.name.last].filter(Boolean).join(' ');
}

/** How likely a match without the player's own character is a women's (as cast.ts deals it). */
const WOMENS = people.womensMatches;

/**
 * The court a match deals from the roster, by player number: `n` seats (2 or 4). The human's seat (`human`, -1 for
 * none: the title's match) is left empty (null): the pros are AI players, and the human plays their own character
 * (`me`: its face; the pros are then of its sex and never have it) or, without one, a face no pro on court has
 * (`humanFace`), as the cast deals it today. Without `me`, a women's match as often as cast.ts makes one. `rivals`: a
 * knock-out's later round, the same pair (seats 0 and 2) against two others dealt from that seed. The same seed deals
 * the same court.
 */
export function dealRoster(seed: number, n: number, o: { human?: number; humans?: readonly number[]; me?: { face: string; woman: boolean }; rivals?: number } = {}):
  { women: boolean; seats: Array<Pro | null>; humanFace: string | null; otherFaces: Array<string | null> } {
  const { me, rivals } = o;
  const human = o.human ?? -1;
  // (a local match's other players, M6: their seats are theirs too)
  const others = (o.humans ?? []).filter((i) => i !== human && i >= 0 && i < n);
  const rnd = seeded(seed, 0x51ab2c3d);
  const women = me ? me.woman : rnd() < WOMENS;
  const shuffled = (r: () => number, list: readonly Pro[]): Pro[] => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]!; a[i] = a[j]!; a[j] = t;
    }
    return a;
  };
  const pool = women ? ROSTER.women : ROSTER.men;
  const faces = new Set<string>(me ? [me.face] : []);
  /** The first of `list` whose face is free (and taken now). */
  const take = (list: Pro[]): Pro => {
    const p = list.find((x) => !faces.has(x.character.face))!;
    faces.add(p.character.face);
    list.splice(list.indexOf(p), 1);
    return p;
  };
  const order = shuffled(rnd, pool);
  const seats: Array<Pro | null> = Array.from({ length: n }, (_, i) => (i === human || others.includes(i) ? null : take(order)));
  if (rivals !== undefined && n > 1) {
    // The same pair (seats 0 and 2); the faces on the other side dealt again.
    for (let i = 1; i < n; i += 2) if (seats[i]) faces.delete(seats[i]!.character.face);
    const again = shuffled(seeded(rivals, 0x2e9d6b17), pool.filter((p) => !seats.includes(p)));
    for (let i = 1; i < n; i += 2) if (seats[i]) seats[i] = take(again);
  }
  // Each pair's drive player in the slot that receives on the right (rules/score.ts): seat t, the revés at t + 2. The
  // player's own seat stays where it is.
  if (n === 4) {
    for (let t = 0; t < 2; t++) {
      const a = seats[t], b = seats[t + 2];
      if (a && b && a.side === 'reves' && b.side === 'drive') { seats[t] = b; seats[t + 2] = a; }
    }
  }
  // The human's face, when they aren't their own character: one of the match's sex no pro on court has, from the seed.
  let humanFace: string | null = null;
  const free = (): string[] => (women ? DEALT_FACES.women : DEALT_FACES.men).filter((f) => !faces.has(f));
  if (human >= 0 && !me) {
    const f = free();
    humanFace = f[Math.floor(rnd() * f.length)] ?? null;
    if (humanFace) faces.add(humanFace);
  }
  // The other local players' faces, after the first's (so a one-player deal is as it was): any free one.
  const otherFaces: Array<string | null> = Array.from({ length: n }, () => null);
  for (const i of others) {
    const f = free();
    const face = f[Math.floor(rnd() * f.length)] ?? null;
    if (face) faces.add(face);
    otherFaces[i] = face;
  }
  return { women, seats, humanFace, otherFaces };
}

/**
 * Put a dealt court in a match's options: each pro's face (GameOptions.people, the player's own face at their seat),
 * name, look, outfit, racket, hand, grunt, style and their take on it. A style chosen in the setup (partner,
 * opponents) is played instead of the pro's own; their level and signature stay theirs.
 */
export function applyRoster(opts: GameOptions, dealt: { seats: Array<Pro | null>; humanFace: string | null; otherFaces?: Array<string | null> }, setup?: MatchSetup): void {
  const seats = dealt.seats, n = seats.length;
  const human = opts.me?.face ?? dealt.humanFace ?? '';
  opts.people = seats.map((p, i) => p?.character.face ?? (i === opts.human ? human : dealt.otherFaces?.[i] ?? human));
  opts.names = seats.map((p) => p?.name ?? null);
  opts.match.aiStyle = Array.from({ length: n }, (_, i) => opts.match.aiStyle?.[i] ?? 'reloj');
  opts.match.aiTweak = seats.map((p) => p?.tweak ?? null);
  for (let i = 0; i < n; i++) {
    const p = seats[i];
    if (!p) continue;
    applyCharacterAt(opts, p.character, i);
    const chosen = i === 2 ? setup?.partner : i % 2 === 1 ? setup?.opponents : undefined;
    opts.match.aiStyle[i] = chosen && chosen !== 'random' && STYLE_KEYS.includes(chosen) ? chosen : p.style;
  }
}
