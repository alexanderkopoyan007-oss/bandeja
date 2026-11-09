// The match's stats, broken down (M7 phase D, the brief's "match stats: winners, unforced errors, smash success, net
// time" and its "deep shot-stats breakdown after each match"), from the results: a choice of four views beside the
// list. Shots by kind; overheads and the serve; the net and the running; where each pair's shots came down, on a
// court drawn from above with your end at the foot. All from game/stats.ts, read as it is.
import type { Screen } from '../ui/menu/menu.ts';
import { MatchStats, overheads, NET_ZONE, RALLY_BANDS, type ShotLine, type TeamStats } from '../game/stats.ts';
import { SHOT_KEYS, SHOT_SERVE, SHOT_SMASH, SHOT_BANDEJA, SHOT_VIBORA } from '../sim/contact/shots.ts';

export const SHOT_LABELS: Record<(typeof SHOT_KEYS)[number], string> = {
  drive: 'Drive', topspin: 'Topspin', slice: 'Slice', lob: 'Lob', drop: 'Drop shot', serve: 'Serve', smash: 'Smash',
  bandeja: 'Bandeja', volley: 'Volley', vibora: 'Víbora', chiquita: 'Chiquita', contrapared: 'Contrapared',
};

export type StatsView = 'shots' | 'overheads' | 'movement' | 'landing';
export const STATS_VIEWS: Array<{ value: StatsView; label: string }> = [
  { value: 'shots', label: 'Shots' }, { value: 'overheads', label: 'Overheads and serve' },
  { value: 'movement', label: 'Net and running' }, { value: 'landing', label: 'Where it landed' },
];

/** Okabe-Ito: your pair blue, theirs orange (told apart without colour too: filled and ringed). */
const YOU = '#0072B2';
const THEM = '#E69F00';

const pct = (n: number, of: number): string => (of > 0 ? `${Math.round((100 * n) / of)}%` : '–');
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function table(head: string[], rows: string[][]): string {
  return `<table><tr>${head.map((h, i) => `<td class="${i ? 'w' : 'l'}">${h}</td>`).join('')}</tr>`
    + rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? '' : ' class="l"'}>${c}</td>`).join('')}</tr>`).join('') + '</table>';
}

/** "12 · 3 won · 2 lost" for a shot line. */
function line(l: ShotLine): string {
  return l.played ? `${l.played} <small>· ${l.won} won · ${l.lost} lost</small>` : '–';
}

/** The side card for one view. `you`: the player's team (its stats first), `names`: your side's and theirs. */
export function statsHtml(st: MatchStats, view: StatsView, you: number, names: [string, string]): string {
  const A = st.team[you]!, B = st.team[1 - you]!;
  const head = ['', esc(names[0]), esc(names[1])];
  if (view === 'shots') {
    const rows = SHOT_KEYS.map((k, i) => [SHOT_LABELS[k], line(A.shots[i]!), line(B.shots[i]!)])
      .filter((_, i) => A.shots[i]!.played + B.shots[i]!.played > 0);
    return `<div class="card"><h2>Every shot, and the point won or lost on it</h2>${table(head, rows)}`
      + '<p><small>Won: the point ended on it, theirs not coming back. Lost: it went into the net, out, or onto a wall before the bounce. The rest came back.</small></p></div>';
  }
  if (view === 'overheads') {
    const oa = overheads(A), ob = overheads(B);
    const kept = (o: ShotLine): string => (o.played ? `${pct(o.played - o.lost, o.played)} <small>(${o.played - o.lost} of ${o.played})</small>` : '–');
    const rows = [
      ['Overheads', line(oa), line(ob)],
      ['Kept in play or won', kept(oa), kept(ob)],
      ['Won on', pct(oa.won, oa.played), pct(ob.won, ob.played)],
      ...[SHOT_SMASH, SHOT_BANDEJA, SHOT_VIBORA].map((s) => [SHOT_LABELS[SHOT_KEYS[s]!], line(A.shots[s]!), line(B.shots[s]!)]),
      ['First serves in', pct(A.firstsIn, A.firsts), pct(B.firstsIn, B.firsts)],
      ['Aces', String(A.aces), String(B.aces)],
      ['Double faults', String(A.doubleFaults), String(B.doubleFaults)],
      ['Serve points won', pct(A.servesWon, A.serves), pct(B.servesWon, B.serves)],
      ['Serves', line(A.shots[SHOT_SERVE]!), line(B.shots[SHOT_SERVE]!)],
    ];
    return `<div class="card"><h2>Overheads and the serve</h2>${table(head, rows)}</div>`;
  }
  if (view === 'movement') {
    const bandName = (i: number): string => (i + 1 < RALLY_BANDS.length ? `${RALLY_BANDS[i]}-${RALLY_BANDS[i + 1]! - 1} shots` : `${RALLY_BANDS[i]} or more`);
    const rows = [
      [`At the net <small>(within ${NET_ZONE} m)</small>`, pct(A.netSecs, A.rallySecs), pct(B.netSecs, B.rallySecs)],
      ['Run in the rallies', `${Math.round(A.run)} m`, `${Math.round(B.run)} m`],
      ...RALLY_BANDS.map((_, i) => [`Points won, ${bandName(i)}`, String(A.bands[i]), String(B.bands[i])]),
      ['Longest rally', `${st.longestRally} shots`, ''],
    ];
    return `<div class="card"><h2>The net and the running</h2>${table(head, rows)}`
      + '<p><small>At the net: the share of the rallies each pair spent near it, both players counted.</small></p></div>';
  }
  return `<div class="card"><h2>Where the shots came down</h2>${courtSvg(A, B)}`
    + `<p><small><span style="color:${YOU}">●</span> ${esc(names[0])}'s shots, in their half (top) · <span style="color:${THEM}">○</span> ${esc(names[1])}'s, in yours (foot). The first bounce of each, from above.</small></p></div>`;
}

/** The court from above (10 by 20 m, your end at the foot), every shot's first bounce a dot. */
export function courtSvg(A: TeamStats, B: TeamStats): string {
  const W = 10, L = 20, pad = 0.6, sx = (x: number): number => x + W / 2 + pad, sz = (z: number): number => z + L / 2 + pad;
  let dots = '';
  // Yours: kept from your end (their half towards -z: the top). Theirs: kept from theirs, so turned round to yours.
  for (let i = 0; i < A.landed; i++) dots += `<circle cx="${sx(A.landX[i]!).toFixed(2)}" cy="${sz(A.landZ[i]!).toFixed(2)}" r="0.16" fill="${YOU}" fill-opacity="0.8"/>`;
  for (let i = 0; i < B.landed; i++) dots += `<circle cx="${sx(-B.landX[i]!).toFixed(2)}" cy="${sz(-B.landZ[i]!).toFixed(2)}" r="0.16" fill="none" stroke="${THEM}" stroke-width="0.07"/>`;
  const line = (x1: number, z1: number, x2: number, z2: number): string => `<line x1="${sx(x1)}" y1="${sz(z1)}" x2="${sx(x2)}" y2="${sz(z2)}"/>`;
  const lines = line(-W / 2, 0, W / 2, 0) + line(-W / 2, -6.95, W / 2, -6.95) + line(-W / 2, 6.95, W / 2, 6.95) + line(0, -6.95, 0, 6.95);
  return `<svg viewBox="0 0 ${W + 2 * pad} ${L + 2 * pad}" style="width:100%;max-width:260px;display:block;margin:6px auto" role="img" aria-label="Where each pair's shots first bounced">`
    + `<rect x="${pad}" y="${pad}" width="${W}" height="${L}" fill="#1d4f8c" stroke="#e8edf2" stroke-width="0.08"/>`
    + `<g stroke="#e8edf2" stroke-width="0.06">${lines}</g>${dots}</svg>`;
}

export interface StatsHost {
  readonly stats: MatchStats;
  readonly you: number;
  readonly names: [string, string];
  back(): void;
}

/** The screen: a view picked, its card beside the list. */
export function statsScreen(h: StatsHost): Screen {
  let view: StatsView = 'shots';
  return {
    id: 'stats', title: 'Match stats', sub: `${Math.round(h.stats.duration / 60)} min · longest rally ${h.stats.longestRally} shots`, back: () => h.back(),
    wide: true,
    side: () => statsHtml(h.stats, view, h.you, h.names),
    items: [
      { kind: 'choice', label: 'Show', options: STATS_VIEWS, get: () => view, set: (v) => { view = v as StatsView; }, desc: 'Shots by kind, overheads and the serve, the net and the running, or where the ball came down.' },
      { kind: 'button', label: 'Back to the results', primary: true, action: () => h.back() },
    ],
  };
}
