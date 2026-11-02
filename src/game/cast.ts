// Who plays a match, dealt from its seed (review round 4, the critic's #3: the same four men in the same kit under new
// names): men or women throughout, four people from the roster (data/people.json, data/players/), the kits. The names
// (game/names.ts) come from the nations a person's face fits. The generated people look the best of the roster, so
// they are dealt first, the player's own place and then the far side's; repeating one on a court would bring back the
// same men under new names, so the rest of the court is the others. Nothing here touches the sim: looks and voices.
import roster from '../../data/people.json';
import { KIT_COUNT } from '../render/avatar/kit.ts';

export interface Cast {
  /** People by player number. */
  people: string[];
  women: boolean;
  /** Nations each player's name may come from. */
  nations: string[][];
  /** The two teams' kits (kit.ts kitFor). */
  kits: [number, number];
  /** Each player's grunt (voices.ts PLAYER_VOICES): a person's own, on the women's half of the table in a women's match. */
  voices: number[];
  /** Each player's pitch on that voice: thirteen people share four, and two on one court were the same recording. */
  tones: number[];
}

interface Person { name: string; nations: string[]; voice: number; tone: number; woman?: boolean; dealt?: boolean }

/** A seeded generator of its own, so the looks never share the match's. */
export function seeded(seed: number, salt: number): () => number {
  let a = (seed ^ salt) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cast for `seed`; `only` (?people=a,b,c,d) names the people instead. `rivals`: the same pairing's team 0 against
 * two others of the roster, shuffled from that seed (a knock-out's later rounds). */
export function dealCast(seed: number, only?: string[], rivals?: number): Cast {
  const rnd = seeded(seed, 0x2f0b4a87);
  const women = rnd() < roster.womensMatches;
  const guests: Person[] = roster.guests;
  const pool: Person[] = [...(women ? roster.women : roster.men), ...guests.filter((p) => p.dealt && (p.woman === true) === women)];
  // Fisher-Yates: everyone in a different order, the first four play.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t;
  }
  const kits: [number, number] = [Math.floor(rnd() * KIT_COUNT), Math.floor(rnd() * KIT_COUNT)];
  // Seats 0 and 1 are one from each team, the player's and the one facing the camera.
  const made = pool.filter((p) => p.dealt), others = pool.filter((p) => !p.dealt);
  const seats = [made[0] ?? others.shift()!, made[1] ?? others.shift()!];
  pool.splice(0, pool.length, ...seats, ...others, ...made.slice(2));
  if (rivals !== undefined) {
    const r = seeded(rivals, 0x7c1e93d5);
    const rest = pool.filter((_, i) => i !== 0 && i !== 2);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = rest[i]!; rest[i] = rest[j]!; rest[j] = t;
    }
    pool[1] = rest[0]!;
    pool[3] = rest[1]!;
  }
  const all = [...roster.men, ...roster.women, ...guests];
  const picked = only?.length ? only.map((n) => all.find((p) => p.name === n) ?? pool[0]!) : pool.slice(0, 4);
  const firstWoman = roster.women.some((p) => p.name === only?.[0]) || guests.some((p) => p.woman && p.name === only?.[0]);
  const womens = only?.length ? firstWoman : women;
  return { people: picked.map((p) => p.name), women: womens, nations: picked.map((p) => p.nations), kits, voices: picked.map((p) => p.voice + (womens ? 4 : 0)), tones: picked.map((p) => p.tone) };
}

/** ?people=a,b,c,d, or nothing (0 is the mannequin: asset.ts peopleWanted). */
export function castParam(params: URLSearchParams): string[] | undefined {
  const v = params.get('people');
  return v && v !== '0' ? v.split(',') : undefined;
}
