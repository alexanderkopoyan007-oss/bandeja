// The Tournament screens (M6 phase B, behind ?creator=1 until the owner has seen them): set one up (draw size,
// doubles or singles, the partner, how well the AI plays, the venue and the rules), then the draw between ties:
// every round with its scores, the player's entry lit, and their next tie to play.
import type { Choice, Item, Screen } from '../ui/menu/menu.ts';
import { STYLES } from '../sim/ai/styles.ts';
import { proName } from './roster.ts';
import { current, finished, playRound, roundName, stillIn } from './bracket.ts';
import { entryName, field, nextTieName, newTour, sizesFor, type Tour, type TourSetup } from './tournament.ts';

export interface TourHost {
  /** The tournament under way (null: none). */
  tour(): Tour | null;
  /** Keep (and save) it; null drops it. */
  setTour(t: Tour | null): void;
  /** The setup being made (kept between visits). */
  readonly setup: TourSetup;
  /** The player's own character's sex, when one plays as them (it decides the draw); null: none. */
  womanAsMe(): boolean | null;
  /** A seed for a new draw. */
  seed(): number;
  arenas: Choice[];
  open(s: Screen): void;
  replace(s: Screen): void;
  /** Onto court for the player's tie. */
  playTie(): void;
  confirm(title: string, sub: string, yesDesc: string, yes: () => void): Screen;
  back(): void;
}

/** From the title: the draw under way, or a new one's setup. */
export function tourScreen(h: TourHost): Screen {
  const t = h.tour();
  return t && !finished(t.draw) ? bracketScreen(h) : setupScreen(h);
}

function setupScreen(h: TourHost): Screen {
  const s = h.setup;
  const me = h.womanAsMe();
  if (me !== null) s.women = me;
  const fit = (): void => {
    const sizes = sizesFor(s.doubles, s.women);
    if (!sizes.includes(s.size)) s.size = sizes[sizes.length - 1]!;
    if (s.partner && !field(s.women).some((p) => p.id === s.partner)) s.partner = '';
  };
  fit();
  const remake = (): void => { fit(); h.replace(setupScreen(h)); };
  const ch = <K extends keyof TourSetup>(k: K, label: string, options: Choice[], desc: string, hidden?: () => boolean, again = false): Item => ({
    kind: 'choice', label, options, get: () => s[k], set: (v) => { s[k] = v as TourSetup[K]; if (again) remake(); }, desc, hidden,
  });
  const partners: Choice[] = [
    { value: '', label: 'Dealt' },
    ...[...field(s.women)].sort((a, b) => b.level - a.level).map((p) => ({ value: p.id, label: `${proName(p)} · ${p.side === 'drive' ? 'drive' : 'revés'}` })),
  ];
  const partnerDesc = (): string => {
    const p = field(s.women).find((x) => x.id === s.partner);
    if (!p) return 'Your partner for the whole draw: dealt from the middle of the field, or pick one. You play the side they don’t.';
    return `${proName(p)}: ${STYLES[p.style]?.name ?? p.style}, plays the ${p.side === 'drive' ? 'drive side, so you take the revés' : 'revés side, so you take the drive'}.`;
  };
  return {
    id: 'tour-setup', title: 'Tournament', sub: 'A draw of the roster’s pros: lose and you are out',
    items: [
      ch('doubles', 'Mode', [{ value: true, label: 'Doubles' }, { value: false, label: 'Singles' }], 'Doubles: you and a partner against pairs of pros. Singles: you against the pros one by one.', undefined, true),
      ch('women', 'Draw', [{ value: false, label: 'Men’s' }, { value: true, label: 'Women’s' }], 'Whose tour this is.', () => me !== null, true),
      ch('size', 'Entries', sizesFor(s.doubles, s.women).map((n) => ({ value: n, label: `${n} ${s.doubles ? 'pairs' : 'players'}` })),
        'How big the draw is. The strongest are seeded; a draw the field can’t fill gives its top seeds a bye.'),
      { kind: 'choice', label: 'Partner', options: partners, get: () => s.partner, set: (v) => { s.partner = String(v); }, desc: partnerDesc, hidden: () => !s.doubles },
      ch('level', 'Field', [{ value: 'novice', label: 'Novice' }, { value: 'club', label: 'Club' }, { value: 'advanced', label: 'Advanced' }, { value: 'pro', label: 'Pro' }],
        'How well the pros play (each a little better or worse than this, as they are). Your partner plays a level above it.'),
      ch('arena', 'Venue', h.arenas, 'Every tie is played here.'),
      ch('scoring', 'Scoring', [{ value: 'star', label: 'Star point' }, { value: 'golden', label: 'Golden point' }, { value: 'advantage', label: 'Advantage' }],
        'Star point: two advantages, then a deciding point. Golden point: the first deuce decides. Advantage: win by two.'),
      ch('length', 'Ties', [{ value: 'short', label: 'Short set (to 4)' }, { value: 'set', label: 'One set' }, { value: 'three', label: 'Best of three' }],
        'How long each tie is.'),
      {
        kind: 'button', label: 'Make the draw', primary: true, desc: 'Seeded by strength; you are unseeded.',
        action: () => { h.setTour(newTour(h.seed(), { ...s })); h.replace(bracketScreen(h)); },
      },
    ],
    focus: 0, back: () => h.back(),
  };
}

/** The draw: every round, the player's next tie to play, or how it ended. */
export function bracketScreen(h: TourHost): Screen {
  const t = h.tour()!;
  const d = t.draw;
  const next = nextTieName(d);
  const inIt = stillIn(d);
  const over = finished(d);
  const champion = over && inIt;
  const { round } = current(d);
  const sub = champion ? 'Champions' : over ? 'The draw is over' : !inIt ? `Out: the ${roundName(d.rounds[round]!.length).toLowerCase()} go on without you` : `${roundName(d.rounds[round]!.length)}`;
  const items: Item[] = [
    {
      kind: 'button', label: next ? `Play ${next}` : 'Play', primary: true, hidden: () => !next,
      desc: () => {
        const tie = current(d).tie;
        if (!tie) return '';
        const them = tie.a === d.you ? tie.b : tie.a;
        return `Against ${entryName(d, them)}${d.entries[them]!.seed ? ` (seed ${d.entries[them]!.seed})` : ''}.`;
      },
      action: () => h.playTie(),
    },
    {
      kind: 'button', label: 'See it through', primary: !next && !over, hidden: () => !!next || over,
      desc: 'The rest of the draw is played without you.',
      action: () => { while (!finished(d)) playRound(d); h.setTour(t); h.replace(bracketScreen(h)); },
    },
    {
      kind: 'button', label: 'New tournament', primary: over,
      desc: over ? 'Set up another.' : 'This draw is dropped.',
      action: () => {
        if (over) { h.setTour(null); h.replace(setupScreen(h)); return; }
        h.open(h.confirm('Drop this draw?', 'You leave the tournament.', 'Set up a new one.', () => { h.setTour(null); h.back(); h.replace(setupScreen(h)); }));
      },
    },
    { kind: 'button', label: 'Back', desc: 'The draw is kept: Tournament on the title screen comes back to it.', action: () => h.back() },
  ];
  return { id: 'tour', title: 'Tournament', sub, items, focus: 0, back: () => h.back(), side: () => bracketCard(t), wide: true };
}

/** The draw as a card: each round's ties with their scores, the player's entry lit. */
export function bracketCard(t: Tour): string {
  const d = t.draw;
  const name = (e: number): string => {
    const n = esc(entryName(d, e)) + (e >= 0 && d.entries[e]!.seed ? ` <span style="opacity:.6">(${d.entries[e]!.seed})</span>` : '');
    return e === d.you ? `<b style="color:var(--accent)">${n}</b>` : n;
  };
  const rounds = d.rounds.map((r) => {
    const rows = r.map((tie) => {
      const won = (e: number): string => (tie.winner === e && tie.winner >= 0 ? ' ✓' : '');
      const score = tie.score === 'bye' ? '' : esc(tie.score);
      return `<tr><td class="l" style="text-transform:none">${name(tie.a)}${won(tie.a)}<br>${name(tie.b)}${won(tie.b)}</td><td style="white-space:nowrap">${score}</td></tr>`;
    }).join('');
    return `<h2 style="margin-top:12px">${roundName(r.length)}</h2><table>${rows}</table>`;
  }).join('');
  return `<div class="card">${rounds}</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
