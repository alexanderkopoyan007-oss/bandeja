// The Local match screen (M6 phase A, behind ?creator=1 until the owner has seen it): a seat chart. Each seat on
// the court is played by the computer, the keyboard or a pad; up to four people on one screen, in any mix of
// partners and opponents. The first seat played (in the chart's order) is P1: the camera's end and their own
// player and hand. The rest of the match (venue, scoring, the AI's level and styles) is the usual setup.
import type { Choice, Item, Screen } from '../ui/menu/menu.ts';
import { LOCAL_COLOURS, MAX_LOCALS, seatsProblem, type LocalDevice, type LocalSeat } from '../game/locals.ts';
import type { MatchSetup } from './settings.ts';

/** A seat's pick: the computer, the keyboard, or a pad (its Gamepad.index). */
export type SeatPick = 'ai' | 'keys' | number;

/** The chart's order, by player number: pair 1's drive and revés seats, then pair 2's (singles: one each). */
export function chartOrder(doubles: boolean): number[] {
  return doubles ? [0, 2, 1, 3] : [0, 1];
}

/** A seat as the chart names it. The drive player receives on the right (seat t), the revés player on the left (t + 2). */
export function seatLabel(player: number, doubles: boolean): string {
  if (!doubles) return `Side ${player + 1}`;
  return `Pair ${(player & 1) + 1}, ${player < 2 ? 'drive' : 'revés'}`;
}

/** The picks as a match takes them: the seats played, in the chart's order (P1 first). */
export function seatsFromPicks(picks: readonly SeatPick[], doubles: boolean): LocalSeat[] {
  return chartOrder(doubles)
    .filter((i) => picks[i] !== undefined && picks[i] !== 'ai')
    .map((i) => ({ player: i, device: picks[i] as LocalDevice }));
}

/**
 * The first picks: the keyboard in pair 1's drive seat, the first pad across the net from it, the next beside the
 * keyboard, the last beside the first pad (the order people usually pair up: one against one, then two against two).
 */
export function defaultPicks(pads: readonly number[], doubles: boolean): SeatPick[] {
  const picks: SeatPick[] = ['ai', 'ai', 'ai', 'ai'];
  const order = doubles ? [0, 1, 2, 3] : [0, 1];
  picks[0] = 'keys';
  for (let k = 0; k < pads.length && k + 1 < order.length; k++) picks[order[k + 1]!] = pads[k]!;
  return picks;
}

export interface PadInfo { index: number; name: string }

export interface LocalHost {
  readonly setup: MatchSetup;
  /** Each seat's pick, by player number (four kept, whatever the mode). */
  readonly picks: SeatPick[];
  /** The pads connected now. */
  pads(): PadInfo[];
  /** Mode changed: the chart is made again. */
  remake(): void;
  /** The rest of the setup (venue, scoring, opponents). */
  openSetup(): void;
  start(seats: LocalSeat[]): void;
  back(): void;
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function deviceName(d: SeatPick): string {
  return d === 'ai' ? 'Computer' : d === 'keys' ? 'Keyboard' : `Pad ${d + 1}`;
}

/** The seat chart. */
export function localScreen(h: LocalHost): Screen {
  const st = h.setup;
  const doubles = st.mode === 'doubles';
  const n = doubles ? 4 : 2;
  const pads = h.pads();
  const seats = (): LocalSeat[] => seatsFromPicks(h.picks, doubles);
  const problem = (): string | null => seatsProblem(seats(), n);
  const options = (i: number): Choice[] => {
    const list: SeatPick[] = ['ai', 'keys', ...pads.map((p) => p.index)];
    // (a pad picked and then unplugged stays on the list, marked)
    const mine = h.picks[i];
    if (mine !== undefined && !list.includes(mine)) list.push(mine);
    return list.map((d) => ({
      value: d,
      label: typeof d === 'number' && !pads.some((p) => p.index === d) ? `${deviceName(d)} (not connected)` : deviceName(d),
    }));
  };
  const seatItem = (i: number): Item => ({
    kind: 'choice', label: seatLabel(i, doubles), options: options(i),
    get: () => h.picks[i], set: (v) => { h.picks[i] = v as SeatPick; },
    desc: doubles
      ? `Who plays ${i & 1 ? 'pair 2' : 'pair 1'}’s ${i < 2 ? 'drive side: they receive on the right' : 'revés side: they receive on the left'}. The computer plays any seat nobody takes.`
      : 'Who plays this side. The computer plays it if nobody does.',
  });
  const items: Item[] = [
    {
      kind: 'choice', label: 'Mode', options: [{ value: 'doubles', label: 'Doubles' }, { value: 'singles', label: 'Singles' }],
      get: () => st.mode,
      set: (v) => {
        st.mode = v as MatchSetup['mode'];
        if (st.mode === 'doubles' && st.court === 'singles-narrow') st.court = 'standard';
        h.remake();
      },
      desc: 'Doubles: up to four players, partners or opponents. Singles: one against one.',
    },
    { kind: 'group', label: 'Seats' },
    ...chartOrder(doubles).map(seatItem),
    { kind: 'button', label: 'Match setup', desc: 'Venue, court, scoring, length, and how well the computer plays.', action: () => h.openSetup() },
    {
      kind: 'button', label: 'Start match', primary: true,
      desc: () => problem() ?? 'Onto court. Start on any pad (Esc on the keyboard) pauses for everyone.',
      disabled: () => problem() !== null,
      action: () => { if (problem() === null) h.start(seats()); },
    },
  ];
  return {
    id: 'local', title: 'Local match', sub: `Up to ${MAX_LOCALS} players on one screen`,
    items, focus: 2, back: () => h.back(),
    side: () => card(seats(), doubles, pads),
  };
}

/** Who is who (their colour is the ring under them on court), and the pads there are. */
function card(seats: LocalSeat[], doubles: boolean, pads: PadInfo[]): string {
  const dot = (k: number): string => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:${hex(LOCAL_COLOURS[k] ?? 0xffffff)}"></span>`;
  const rows = seats.map((s, k) => `<tr><td class="l">${dot(k)}P${k + 1}</td><td>${deviceName(s.device as SeatPick)}</td><td>${seatLabel(s.player, doubles)}</td></tr>`).join('');
  const padRows = pads.length
    ? pads.map((p) => `<tr><td class="l">Pad ${p.index + 1}</td><td colspan="2">${esc(p.name)}</td></tr>`).join('')
    : '<tr><td class="l" colspan="3">No pad yet: press a button on one to connect it</td></tr>';
  return `<div class="card"><h2>Players</h2><table>${rows || '<tr><td class="l" colspan="3">Nobody yet</td></tr>'}</table></div>`
    + `<div class="card" style="margin-top:12px"><h2>Pads</h2><table>${padRows}</table></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The pads connected now, named as the browser names them (up to the bracket with its vendor and product numbers). */
export function connectedPads(): PadInfo[] {
  const out: PadInfo[] = [];
  try {
    for (const p of navigator.getGamepads?.() ?? []) {
      if (p && p.connected) out.push({ index: p.index, name: p.id.replace(/\s*\(.*$/, '').slice(0, 40) || 'Pad' });
    }
  } catch {
    // Blocked by a permissions policy: none.
  }
  return out;
}
