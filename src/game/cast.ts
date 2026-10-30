// Who plays a match, dealt from its seed (review round 4, the critic's #3: the same four men in the same kit under new
// names): men or women throughout, four people from the roster (data/people.json, data/players/), the kits. The names
// (game/names.ts) come from the nations a person's face fits. Nothing here touches the sim: looks only.
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
}

interface Person { name: string; nations: string[] }

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

/** The cast for `seed`; `only` (?people=a,b,c,d) names the people instead. */
export function dealCast(seed: number, only?: string[]): Cast {
  const rnd = seeded(seed, 0x2f0b4a87);
  const women = rnd() < roster.womensMatches;
  const pool: Person[] = [...(women ? roster.women : roster.men)];
  // Fisher-Yates: everyone in a different order, the first four play.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t;
  }
  const kits: [number, number] = [Math.floor(rnd() * KIT_COUNT), Math.floor(rnd() * KIT_COUNT)];
  const all = [...roster.men, ...roster.women];
  const picked = only?.length ? only.map((n) => all.find((p) => p.name === n) ?? pool[0]!) : pool.slice(0, 4);
  return { people: picked.map((p) => p.name), women: only?.length ? roster.women.some((p) => p.name === only[0]) : women, nations: picked.map((p) => p.nations), kits };
}

/** ?people=a,b,c,d, or nothing (0 is the mannequin: asset.ts peopleWanted). */
export function castParam(params: URLSearchParams): string[] | undefined {
  const v = params.get('people');
  return v && v !== '0' ? v.split(',') : undefined;
}
