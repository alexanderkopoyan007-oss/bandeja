// The Academy (M6 phase D, behind ?creator=1 until the owner has seen it): lessons in order (data/academy.json) on the
// timing, each shot and reading the glass, each a graded run of the coach's balls (game/challenge.ts runs them as it
// runs the challenges). Bronze in one opens the next. A lesson's text names the keys in use.
import type { Item, Screen } from '../ui/menu/menu.ts';
import { LESSONS, MEDAL_NAMES, medal, type ChallengeDef } from '../game/challenge.ts';
import { keyName } from '../game/input/bindings.ts';

export interface AcademyHost {
  /** A lesson's best score (null: not played). */
  best(id: string): number | null;
  /** The keys in use, by action (bindings.ts resolveKeys). */
  keys(): Record<string, string[]>;
  start(def: ChallengeDef): void;
  open(s: Screen): void;
  back(): void;
}

/** A lesson's text with its {action} names turned into the keys in use ("{drive}" -> "J"). */
export function withKeys(text: string, keys: Record<string, string[]>): string {
  return text.replace(/\{(\w+)\}/g, (all, a: string) => {
    const k = keys[a]?.[0];
    return k ? keyName(k) : all;
  });
}

/** A lesson is open: it is the first, or the one before it has a medal. */
export function lessonOpen(k: number, best: (id: string) => number | null): boolean {
  if (k <= 0) return true;
  const prev = LESSONS[k - 1]!, b = best(prev.id);
  return b !== null && medal(prev, b) >= 1;
}

export function academyScreen(h: AcademyHost): Screen {
  const keys = h.keys();
  const items: Item[] = LESSONS.map((def, k): Item => ({
    kind: 'button', label: `${k + 1}. ${def.name}`,
    disabled: () => !lessonOpen(k, (id) => h.best(id)),
    desc: () => {
      if (!lessonOpen(k, (id) => h.best(id))) return `Bronze in ${LESSONS[k - 1]!.name.toLowerCase()} opens this one.`;
      const b = h.best(def.id);
      return `${withKeys(def.desc, keys)} ${b === null ? `Bronze at ${def.medals[0]} of ${def.balls}.` : `Best ${b} · ${MEDAL_NAMES[medal(def, b)]}.`}`;
    },
    action: () => h.start(def),
  }));
  // The first lesson without a medal has the focus.
  const next = LESSONS.findIndex((d) => { const b = h.best(d.id); return b === null || medal(d, b) === 0; });
  items.push({ kind: 'button', label: 'Back', desc: 'To the title.', action: () => h.back() });
  return {
    id: 'academy', title: 'Academy', sub: 'Timing, every shot, the glass', items, focus: next < 0 ? 0 : next, back: () => h.back(),
    side: () => {
      const rows = LESSONS.map((d) => {
        const b = h.best(d.id), m = b === null ? -1 : medal(d, b);
        return `<tr><td class="l" style="text-transform:none">${d.name}</td><td${m > 0 ? ' class="w"' : ''}>${m < 0 ? '–' : MEDAL_NAMES[m]}</td></tr>`;
      }).join('');
      return `<div class="card"><h2>Your lessons</h2><table>${rows}</table></div>`;
    },
  };
}
