// The Career screens (M6 phase E, behind ?creator=1 until the owner has seen them): start one with a partner from the
// lower half of the roster; then the season: the next event (enter it, or pass), the draw while one is under way,
// your partner and the pair's chemistry, the ranking, and the season's results.
import type { Choice, Item, Screen } from '../ui/menu/menu.ts';
import { STYLES } from '../sim/ai/styles.ts';
import { proName, type Pro } from './roster.ts';
import { current, finished, roundName, stillIn } from './bracket.ts';
import { entryName, nextTieName } from './tournament.ts';
import { bracketCard } from './tournamentScreen.ts';
import {
  SEASON, TIERS, canEnter, careerPoints, changePartner, enterEvent, entryNeed, newCareer, ordinal, partnerName, partnersFor,
  passEvent, rankOf, ranking, type Career,
} from './career.ts';

export interface CareerHost {
  career(): Career | null;
  /** Keep (and save) it; null drops it. */
  save(c: Career | null): void;
  /** The player's own character's sex (it decides the career's); null: none made. */
  womanAsMe(): boolean | null;
  seed(): number;
  open(s: Screen): void;
  replace(s: Screen): void;
  /** Onto court for the tie under way. */
  playTie(): void;
  confirm(title: string, sub: string, yesDesc: string, yes: () => void): Screen;
  back(): void;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const proLine = (p: Pro): string => `${proName(p)} · ${p.side === 'drive' ? 'drive' : 'revés'} · ${STYLES[p.style]?.name ?? p.style}`;

/** From the title: the career under way, or a new one. */
export function careerScreen(h: CareerHost): Screen {
  const c = h.career();
  return c ? seasonScreen(h) : startScreen(h);
}

function startScreen(h: CareerHost): Screen {
  const me = h.womanAsMe();
  const women = me ?? false;
  const pool = partnersFor(null, women);
  let pick = pool[pool.length - 1]!.id;
  const options: Choice[] = pool.map((p) => ({ value: p.id, label: proLine(p) }));
  const items: Item[] = [
    {
      kind: 'choice', label: 'Partner', options, get: () => pick, set: (v) => { pick = v as string; },
      desc: () => {
        const p = pool.find((x) => x.id === pick)!;
        return `${proName(p)} plays the ${p.side === 'drive' ? 'drive side, so you take the revés' : 'revés side, so you take the drive'}. A new pair: you will read each other better with every match you play together.`;
      },
    },
    {
      kind: 'button', label: 'Start the career', primary: true,
      desc: `${women ? 'The women’s' : 'The men’s'} circuit: a season of ${SEASON.length} events from the club to the Masters.${me === null ? ' Make your own player under Players to play as them.' : ''}`,
      action: () => { h.save(newCareer(women, pick)); h.replace(seasonScreen(h)); },
    },
    { kind: 'button', label: 'Back', desc: 'To the title.', action: () => h.back() },
  ];
  return { id: 'career-start', title: 'Career', sub: 'Start at the club, with a partner of your level', items, focus: 1, back: () => h.back() };
}

function seasonScreen(h: CareerHost): Screen {
  const c = h.career()!;
  const ev = SEASON[c.next]!, tier = TIERS[ev.tier]!;
  const d = c.tour?.draw ?? null;
  const next = d ? nextTieName(d) : null;
  const chem = c.chemistry[c.partner] ?? 0;
  const items: Item[] = [
    {
      kind: 'button', label: next ? `Play ${next}` : 'Play', primary: true, hidden: () => !next,
      desc: () => {
        const tie = d ? current(d).tie : null;
        if (!d || !tie) return '';
        const them = tie.a === d.you ? tie.b : tie.a;
        return `${ev.name}: against ${entryName(d, them)}${d.entries[them]!.seed ? ` (seed ${d.entries[them]!.seed})` : ''}.`;
      },
      action: () => h.playTie(),
    },
    {
      kind: 'button', label: `Enter the ${ev.name}`, primary: !d, hidden: () => !!d, disabled: () => !canEnter(c, c.next),
      desc: () => {
        const need = entryNeed(c, c.next);
        const head = `${tier.name} · ${arenaName(ev.arena)} · ${tier.size} pairs`;
        return need ? `${head}. Entry needs ${need}.` : `${head}. ${pointsLine(tier.points)}`;
      },
      action: () => { h.save(enterEvent(c, c.next, h.seed())); h.replace(seasonScreen(h)); },
    },
    {
      kind: 'button', label: 'Pass', hidden: () => !!d,
      desc: () => c.next === SEASON.length - 1 ? 'Skip it: the season ends, and next season counts this one’s points at half.' : `Skip it: ${SEASON[c.next + 1]!.name} is next.`,
      action: () => { h.save(passEvent(c)); h.replace(seasonScreen(h)); },
    },
    {
      kind: 'button', label: `Partner: ${partnerName(c)}`, disabled: () => !!d,
      desc: () => d ? 'Not during an event.' : `Chemistry ${pct(chem)}. Change partner between events: chemistry with each is kept.`,
      action: () => h.open(partnerScreen(h)),
    },
    { kind: 'button', label: 'Ranking', desc: () => `You are ${ordinal(rankOf(c))} with ${careerPoints(c)} points.`, action: () => h.open(rankingScreen(h)) },
    {
      kind: 'button', label: 'Retire', desc: 'Start a new career: this one is gone.',
      action: () => h.open(h.confirm('Retire?', 'This career is gone: its points, its partners.', 'Start a new one.', () => { h.save(null); h.back(); h.replace(startScreen(h)); })),
    },
    { kind: 'button', label: 'Back', desc: 'The career is kept: Career on the title screen comes back to it.', action: () => h.back() },
  ];
  const sub = d ? `${ev.name} · ${!stillIn(d) ? 'out' : finished(d) ? 'champions' : roundName(d.rounds[current(d).round]!.length)}`
    : `Season ${c.season} · ${ordinal(rankOf(c))} · ${careerPoints(c)} points`;
  return {
    id: 'career', title: 'Career', sub, items, focus: 0, back: () => h.back(), wide: !!d,
    side: () => (d && c.tour ? bracketCard(c.tour) : '') + seasonCard(c),
  };
}

function partnerScreen(h: CareerHost): Screen {
  const c = h.career()!;
  const pool = partnersFor(c, c.women);
  const items: Item[] = pool.map((p): Item => ({
    kind: 'button', label: `${p.id === c.partner ? '✓ ' : ''}${proName(p)}`,
    desc: `${proLine(p)}. Chemistry ${pct(c.chemistry[p.id] ?? 0.2)}${c.chemistry[p.id] === undefined ? ' (a new pair)' : ''}.`,
    action: () => { h.save(changePartner(c, p.id)); h.back(); h.replace(seasonScreen(h)); },
  }));
  items.push({ kind: 'button', label: 'Back', desc: 'Keep your partner.', action: () => h.back() });
  const all = pool.length > partnersFor(null, c.women).length;
  return {
    id: 'career-partner', title: 'Partner', sub: all ? 'Anyone will play with you now' : 'The lower half of the roster: play a National event and anyone will',
    items, focus: Math.max(0, pool.findIndex((p) => p.id === c.partner)), back: () => h.back(),
  };
}

function rankingScreen(h: CareerHost): Screen {
  const c = h.career()!;
  const rows = ranking(c);
  return {
    id: 'career-ranking', title: 'Ranking', sub: `Season ${c.season}: this season’s points, last season’s at half`,
    items: [{ kind: 'button', label: 'Back', desc: 'To the season.', action: () => h.back() }], back: () => h.back(),
    side: () => `<div class="card"><table>${rows.map((r, k) => `<tr><td>${k + 1}</td><td class="l" style="text-transform:none">${r.id === 'you' ? '<b style="color:var(--accent)">You</b>' : r.name}</td><td${r.id === 'you' ? ' class="w"' : ''}>${r.points}</td></tr>`).join('')}</table></div>`,
  };
}

/** The season as a card: every event, its tier, and what you did in it. */
function seasonCard(c: Career): string {
  const rows = SEASON.map((e, k) => {
    const r = [...c.results].reverse().find((x) => x.season === c.season && x.event === e.id);
    const what = r ? `${r.short === 0 ? 'Won' : r.short === 1 ? 'Final' : r.short === 2 ? 'Semi-final' : r.short === 3 ? 'Quarter-final' : 'First round'} · ${r.points}`
      : k === c.next ? (c.tour ? 'Playing' : 'Next') : k < c.next ? 'Passed' : '';
    return `<tr><td class="l" style="text-transform:none">${k === c.next ? '<b>' : ''}${e.name}${k === c.next ? '</b>' : ''}</td><td>${TIERS[e.tier]!.name}</td><td${r?.short === 0 ? ' class="w"' : ''}>${what}</td></tr>`;
  }).join('');
  return `<div class="card"><h2>Season ${c.season}</h2><table>${rows}</table></div>`;
}

function pointsLine(points: readonly number[]): string {
  return `The title is worth ${points[points.length - 1]} points, the final ${points[points.length - 2]}.`;
}

function arenaName(a: string): string {
  return a === 'club-day' ? 'the club by day' : a === 'club-night' ? 'the club at night' : a === 'club-dusk' ? 'the club at sunset' : a === 'hall' ? 'the hall' : a === 'final' ? 'the final court' : 'the stadium';
}
