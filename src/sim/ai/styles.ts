// AI playing styles: multipliers on the AI's choices, from data/ai.json.
import styleData from '../../../data/ai.json' with { type: 'json' };

export interface AiStyle {
  key: string;
  name: string;
  /** Scoreboard name when two share a row (doubles). */
  short: string;
  level: number;
  net: number;
  lob: number;
  drop: number;
  smash: number;
  vibora: number;
  margin: number;
  pace: number;
}

const data = styleData as unknown as Record<string, Omit<AiStyle, 'key'>>;
export const STYLE_KEYS: string[] = Object.keys(data).filter((k) => !k.startsWith('/'));
/**
 * One shape for every style, its numbers held as doubles from the start: El Relojero's are all whole numbers, the
 * others' fractions, and built from the JSON as they were the first style's map was deprecated when the next was
 * made, so the AI's hot functions met a changed map mid-match and deoptimised.
 */
class Style implements AiStyle {
  key = '';
  name = '';
  short = '';
  level = -0;
  net = -0;
  lob = -0;
  drop = -0;
  smash = -0;
  vibora = -0;
  margin = -0;
  pace = -0;
}
function makeStyle(key: string, d: Omit<AiStyle, 'key'>): AiStyle {
  const s = new Style();
  s.key = key;
  s.name = d.name; s.short = d.short;
  s.level = d.level; s.net = d.net; s.lob = d.lob; s.drop = d.drop; s.smash = d.smash; s.vibora = d.vibora;
  s.margin = d.margin; s.pace = d.pace;
  return s;
}
export const STYLES: Record<string, AiStyle> = Object.fromEntries(STYLE_KEYS.map((k) => [k, makeStyle(k, data[k]!)]));
export const DEFAULT_STYLE = 'reloj';

export function styleOf(key: string | undefined): AiStyle {
  return STYLES[key ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE]!;
}

/**
 * A player's own take on a style (a roster pro's: app/roster.ts): their level against the style's, added; their pace,
 * added; the other choices multiplied. Missing fields leave the style's.
 */
export interface StyleTweak {
  level?: number; net?: number; lob?: number; drop?: number; smash?: number; vibora?: number; margin?: number; pace?: number;
}

/** `s` as a player with tweak `t` plays it (no tweak: `s` itself), built in the one shape every style has. */
export function tweaked(s: AiStyle, t: StyleTweak | null | undefined): AiStyle {
  if (!t) return s;
  return makeStyle(s.key, {
    name: s.name, short: s.short, level: s.level + (t.level ?? 0),
    net: s.net * (t.net ?? 1), lob: s.lob * (t.lob ?? 1), drop: s.drop * (t.drop ?? 1), smash: s.smash * (t.smash ?? 1),
    vibora: s.vibora * (t.vibora ?? 1), margin: s.margin * (t.margin ?? 1), pace: s.pace + (t.pace ?? 0),
  });
}
