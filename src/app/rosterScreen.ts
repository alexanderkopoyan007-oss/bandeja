// The Roster screen (M5 phase E, behind ?creator=1 with the rest of M5): every pro of data/roster.json, men and women,
// the focused one on the creator's turntable (game/studio.ts) and their card under the list: style, hand, side,
// signature shot, how they stand against the field, their racket and its measured stats.
import type { Item, Screen } from '../ui/menu/menu.ts';
import { ROSTER, proName, type Pro } from './roster.ts';
import { racketName, racketStatsLine, type CreatorHost } from './creator.ts';
import { STYLES } from '../sim/ai/styles.ts';

/** A signature shot in the card's words. */
const SHOT_WORDS: Readonly<Record<string, string>> = {
  smash: 'the smash', vibora: 'the víbora', bandeja: 'the bandeja', lob: 'the lob', chiquita: 'the chiquita', drive: 'the drive', volley: 'the volley',
};

/** How a pro's level stands against the rest of a court (data/roster.json `level`, added to the match's). */
function standing(level: number): string {
  if (level >= 0.035) return 'One of the strongest';
  if (level >= 0.015) return 'Stronger than most';
  if (level <= -0.015) return 'Still coming up';
  return 'As strong as the field';
}

/** A pro's card, as the list says it under their name. */
export function proCard(p: Pro): string {
  const c = p.character, style = STYLES[p.style]!;
  const nation = p.name.nation ? ` (${p.name.nation})` : '';
  const side = p.side === 'drive' ? 'the drive side (right)' : 'the revés side (left)';
  const stats = racketStatsLine(c.racket.base);
  return `${proName(p)}${nation}. ${style.name}: ${c.hand}-handed, plays ${side}, signature ${SHOT_WORDS[p.signature] ?? p.signature}. `
    + `${standing(p.level)}. ${racketName(c.racket.base)}${c.racket.look ? ' in their own colours' : ''}: ${stats}.`;
}

/** The roster: the pros by sex, the focused one on the turntable. */
export function rosterScreen(host: CreatorHost): Screen {
  const show = (p: Pro): void => {
    const o = host.options(p.character);
    // (their face as it is: a dealt guest's isn't one of the creator's presets)
    o.people = [p.character.face];
    host.studio()?.show(o);
  };
  const entry = (p: Pro): Item => ({ kind: 'button', label: proName(p), desc: () => proCard(p), onFocus: () => show(p) });
  const items: Item[] = [
    { kind: 'group', label: `Men (${ROSTER.men.length})` },
    ...ROSTER.men.map(entry),
    { kind: 'group', label: `Women (${ROSTER.women.length})` },
    ...ROSTER.women.map(entry),
  ];
  return {
    id: 'roster', title: 'Roster', sub: 'The pros you play with and against',
    items, focus: 1,
    back: () => { host.leaveStudio(); host.menu.pop(); },
  };
}
