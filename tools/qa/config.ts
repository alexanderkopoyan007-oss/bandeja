// QA army configurations (Phase 7): one seeded draw of mode, court, floor, ball, climate, scoring format, AI levels
// and styles, handedness and who is human, per match number.
import type { MatchConfig } from '../../src/sim/match.ts';
import { MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_ADVANTAGE, FINAL_NORMAL, FINAL_SUPERTB10, FINAL_TIEBREAK7, type MatchFormat } from '../../src/sim/rules/score.ts';

// ---- configurations --------------------------------------------------------------------------------------------

export interface ArmyConfig {
  index: number;
  seed: number;
  doubles: boolean;
  court: string;
  floor: 'turf' | 'hard' | 'carpet' | 'clay';
  ball: 'standard' | 'altitude';
  env: { temperatureC: number; altitudeM: number; windX: number; windZ: number };
  format: MatchFormat;
  aiLevel: [number, number];
  styles: string[];
  lefty: boolean[];
  /** Per player: 'ai', 'bot' (a human played well) or 'monkey' (random input). */
  humans: Array<'ai' | 'bot' | 'monkey'>;
  timingScale: number;
  assist: number;
  autoTiming: boolean;
  firstServer: number;
}

/** A small seeded generator for the tool's own choices (never the sim's RNG). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES = ['reloj', 'muro', 'martillo', 'serpiente'];

export function makeConfig(seed0: number, index: number): ArmyConfig {
  const r = mulberry(seed0 * 7919 + index * 104729 + 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const doubles = r() < 0.7;
  const n = doubles ? 4 : 2;
  const court = doubles ? pick(['standard', 'standard', 'panoramic']) : pick(['standard', 'panoramic', 'singles-narrow']);
  const floor = pick(['turf', 'turf', 'turf', 'hard', 'carpet', 'clay'] as const);
  const altitude = r() < 0.1;
  const outdoor = r() < 0.3;
  const mode = pick([MODE_STAR, MODE_STAR, MODE_GOLDEN, MODE_ADVANTAGE]);
  const mini = r() < 0.3;
  const format: MatchFormat = {
    mode,
    setsToWin: r() < 0.2 ? 1 : 2,
    gamesPerSet: mini ? 4 : 6,
    finalSet: pick([FINAL_NORMAL, FINAL_NORMAL, FINAL_ADVANTAGE, FINAL_TIEBREAK7, FINAL_SUPERTB10]),
  };
  const humans: Array<'ai' | 'bot' | 'monkey'> = [];
  const kind = r();
  for (let i = 0; i < n; i++) humans.push('ai');
  if (kind < 0.2) humans[0] = 'bot';
  else if (kind < 0.35) humans[0] = 'monkey';
  else if (kind < 0.45) { humans[0] = 'bot'; humans[1] = 'monkey'; }
  else if (kind < 0.52 && doubles) { humans[0] = 'bot'; humans[2] = 'bot'; }
  else if (kind < 0.58) { for (let i = 0; i < n; i++) humans[i] = 'monkey'; }
  const styles: string[] = [];
  const lefty: boolean[] = [];
  for (let i = 0; i < n; i++) { styles.push(pick(STYLES)); lefty.push(r() < 0.15); }
  return {
    index,
    seed: (seed0 * 1000003 + index * 7919) >>> 0,
    doubles,
    court,
    floor,
    ball: altitude ? 'altitude' : 'standard',
    env: {
      temperatureC: 5 + 30 * r(),
      altitudeM: altitude ? 1000 + 1500 * r() : 200 * r(),
      windX: outdoor ? (r() - 0.5) * 10 : 0,
      windZ: outdoor ? (r() - 0.5) * 10 : 0,
    },
    format,
    aiLevel: [r(), r()],
    styles,
    lefty,
    humans,
    timingScale: 1 + r(),
    assist: r() < 0.15 ? 0 : r(),
    autoTiming: r() < 0.3,
    firstServer: r() < 0.5 ? 0 : 1,
  };
}

export function matchConfig(c: ArmyConfig): MatchConfig {
  return {
    seed: c.seed,
    world: { court: c.court, floor: c.floor, ball: c.ball, env: c.env },
    format: c.format,
    doubles: c.doubles,
    human: c.humans.map((h) => h !== 'ai'),
    aiLevel: c.aiLevel,
    aiStyle: c.styles,
    lefty: c.lefty,
    timingScale: c.timingScale,
    assist: c.assist,
    autoTiming: c.autoTiming,
    firstServer: c.firstServer,
  };
}

/** One line naming a configuration (for the log). */
export function describe(c: ArmyConfig): string {
  const f = c.format;
  const mode = ['adv', 'star', 'golden'][f.mode];
  const fin = ['normal', 'no-tb', 'tb7', 'stb10'][f.finalSet];
  return `#${c.index} ${c.doubles ? 'doubles' : 'singles'} ${c.court} ${c.floor} ${c.ball}${c.env.windX || c.env.windZ ? ' wind' : ''} `
    + `${mode} bo${2 * f.setsToWin - 1} ${f.gamesPerSet}g ${fin} humans=${c.humans.join(',')} ai=${c.aiLevel.map((v) => v.toFixed(2)).join('/')}`;
}

