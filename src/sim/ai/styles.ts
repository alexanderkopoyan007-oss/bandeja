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
}

const data = styleData as unknown as Record<string, Omit<AiStyle, 'key'>>;
export const STYLE_KEYS: string[] = Object.keys(data).filter((k) => !k.startsWith('/'));
export const STYLES: Record<string, AiStyle> = Object.fromEntries(STYLE_KEYS.map((k) => [k, { key: k, ...data[k]! }]));
export const DEFAULT_STYLE = 'reloj';

export function styleOf(key: string | undefined): AiStyle {
  return STYLES[key ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE]!;
}
