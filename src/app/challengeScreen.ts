// The Challenges screens (M6 phase C, behind ?creator=1 until the owner has seen them): today's challenge and the
// fixed ones, each with its best score and medal, played from here; the best run of each kept (its configuration and
// inputs: game/inputLog.ts) and watched again, while it was set on this build of the game (an older build's run may
// play out differently, so it is offered only on the build it was set on).
import type { Item, Screen } from '../ui/menu/menu.ts';
import type { MatchConfig } from '../sim/match.ts';
import { CHALLENGES, MEDAL_NAMES, daily, dayKey, medal, type ChallengeDef } from '../game/challenge.ts';
import { savedLogFrom, type SavedLog } from '../game/inputLog.ts';

/** A challenge's best run as kept. */
export interface BestRun {
  score: number;
  /** When it was set (ms since 1970). */
  at: number;
  /** The build it was set on (import.meta.env.VITE_BUILD). */
  build: string;
  /** The match it was (re-run with `log` it is the same run), and its inputs; absent when it was too long to keep. */
  cfg?: MatchConfig;
  log?: SavedLog;
  /** Who played it (the cast's seed, game/cast.ts): watched, the same people play it again. */
  castSeed?: number;
}

/** The longest run kept (ticks): six minutes. */
export const RUN_MAX_TICKS = 120 * 60 * 6;

/** Every best run read back from the store, each checked (anything else dropped). */
export function bestsFrom(raw: unknown): Record<string, BestRun> {
  const out: Record<string, BestRun> = {};
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).best : null;
  if (!o || typeof o !== 'object') return out;
  for (const [id, v] of Object.entries(o as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.score !== 'number' || !Number.isInteger(r.score) || r.score < 0 || r.score > 9999) continue;
    if (typeof r.at !== 'number' || !Number.isFinite(r.at) || typeof r.build !== 'string' || r.build.length > 40) continue;
    const best: BestRun = { score: r.score, at: r.at, build: r.build };
    const log = savedLogFrom(r.log, RUN_MAX_TICKS);
    if (log && cfgLooksRight(r.cfg)) {
      best.cfg = r.cfg as MatchConfig;
      best.log = log;
      if (typeof r.castSeed === 'number' && Number.isInteger(r.castSeed) && Math.abs(r.castSeed) <= 2 ** 32) best.castSeed = r.castSeed;
    }
    out[id] = best;
  }
  return out;
}

/** A kept match's configuration as far as it can be checked here: a practice run's seed, drill and players. */
function cfgLooksRight(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return Number.isInteger(o.seed) && Number.isInteger(o.practice) && (o.practice as number) >= 0
    && Array.isArray(o.human) && o.human.length === 2 && o.human.every((h) => typeof h === 'boolean');
}

export interface ChallengeHost {
  best(id: string): BestRun | null;
  build: string;
  start(def: ChallengeDef, seed: number | null): void;
  watch(def: ChallengeDef, best: BestRun): void;
  open(s: Screen): void;
  back(): void;
}

/** The list: today's first. */
export function challengesScreen(h: ChallengeHost): Screen {
  const today = daily(dayKey(new Date()));
  const line = (def: ChallengeDef): string => {
    const b = h.best(def.id);
    return b ? `Best ${b.score} · ${MEDAL_NAMES[medal(def, b.score)]}` : 'Not played yet';
  };
  const items: Item[] = [
    { kind: 'group', label: 'Today' },
    { kind: 'button', label: today.def.name, primary: true, desc: () => `${today.def.desc} ${line(today.def)}. A new one tomorrow.`, action: () => h.open(challengeScreen(h, today.def, today.seed)) },
    { kind: 'group', label: 'Challenges' },
    ...CHALLENGES.map((def): Item => ({ kind: 'button', label: def.name, desc: () => `${def.desc} ${line(def)}.`, action: () => h.open(challengeScreen(h, def, null)) })),
    { kind: 'button', label: 'Back', desc: 'To the title.', action: () => h.back() },
  ];
  return { id: 'challenges', title: 'Challenges', sub: 'The coach feeds; you score', items, focus: 1, back: () => h.back() };
}

/** One challenge: play it, or watch the best run. `seed`: the daily's feeds (null: the run's own). */
export function challengeScreen(h: ChallengeHost, def: ChallengeDef, seed: number | null): Screen {
  const best = (): BestRun | null => h.best(def.id);
  const canWatch = (): boolean => { const b = best(); return !!b?.log && b.build === h.build; };
  return {
    id: 'challenge', title: def.name, sub: `${def.balls} balls`,
    items: [
      { kind: 'button', label: 'Play', primary: true, desc: def.desc, action: () => h.start(def, seed) },
      {
        kind: 'button', label: 'Watch your best', hidden: () => !canWatch(),
        desc: () => `Your best run, ${best()?.score ?? 0} points, played again as you played it.`,
        action: () => { const b = best(); if (b) h.watch(def, b); },
      },
      { kind: 'button', label: 'Back', desc: 'The list.', action: () => h.back() },
    ],
    focus: 0, back: () => h.back(),
    side: () => {
      const b = best();
      const rows = [1, 2, 3].map((m) => `<tr><td class="l">${MEDAL_NAMES[m]}</td><td>${def.medals[m - 1]} points</td></tr>`).join('');
      const mine = b ? `<tr><td class="l">Your best</td><td class="w">${b.score} · ${MEDAL_NAMES[medal(def, b.score)]}</td></tr>` : '';
      return `<div class="card"><h2>Medals</h2><table>${rows}${mine}</table></div>`;
    },
  };
}
