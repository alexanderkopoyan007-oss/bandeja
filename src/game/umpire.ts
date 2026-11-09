// The umpire's calls (M7 phase E, the brief's "umpire calls" and "captions for calls"): what a padel umpire says, in
// English or Spanish, from the sim's events. Fault, let and out are called as they happen. The score is called when it
// is counted, as the scoreboard changes (after the point's dead time, as ui/announce.ts says it): the server's points
// first, deuce and advantage by name, golden and star points, then games, sets and the match. Pure text: the voice and
// the captions are ui/umpireVoice.ts, and tests/app/umpire.test.ts reads the calls without either.
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import { PH_DEAD, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH } from '../sim/match.ts';
import { MODE_STAR, MODE_GOLDEN, type Score } from '../sim/rules/score.ts';
import { WHY_OUT } from '../sim/rules/rally.ts';
import { eventsOf } from '../net/feed.ts';

export type UmpireLang = 'en' | 'es';

const WORDS: Record<UmpireLang, readonly string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
    'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'],
};
/** A game's points: love, fifteen, thirty, forty. */
const POINTS: Record<UmpireLang, readonly string[]> = { en: ['love', 'fifteen', 'thirty', 'forty'], es: ['cero', 'quince', 'treinta', 'cuarenta'] };

const num = (lang: UmpireLang, n: number): string => WORDS[lang][n] ?? String(n);
/** A number before its noun: Spanish "un juego", "un set" (both masculine). */
const numN = (lang: UmpireLang, n: number): string => (lang === 'es' && n === 1 ? 'un' : num(lang, n));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A pair's name as the umpire says it: "Ruiz and Vega", "Ruiz y Vega", or one surname in singles. */
export function pairName(lang: UmpireLang, last: readonly string[]): string {
  return last.length > 1 ? `${last[0]} ${lang === 'es' ? 'y' : 'and'} ${last[1]}` : last[0] ?? '';
}

/**
 * The point score after a point, from the score as counted. `names`: each team's name as said. Games and sets are
 * called by `gameCall` and `setCall`; this is only the points within a game or a tie-break.
 */
export function pointCall(lang: UmpireLang, s: Score, names: readonly [string, string]): string {
  const p = s.points, srv = s.serverTeam(), rcv = 1 - srv;
  const a = p[srv]!, b = p[rcv]!;
  const es = lang === 'es';
  if (s.tiebreak) {
    // The leader's points first and their name; level, "all".
    if (a === b) return es ? `${cap(num(lang, a))} iguales.` : `${cap(num(lang, a))} all.`;
    const lead = p[0]! > p[1]! ? 0 : 1;
    return `${cap(num(lang, p[lead]!))}–${num(lang, p[1 - lead]!)}, ${names[lead]}.`;
  }
  if (a < 3 || b < 3) {
    const x = POINTS[lang][Math.min(a, 3)]!, y = POINTS[lang][Math.min(b, 3)]!;
    if (a === b) return es ? `${cap(x)} iguales.` : `${cap(x)} all.`;
    return `${cap(x)}–${y}.`;
  }
  if (a === b) {
    const deciding = s.isDecidingPoint();
    const deuce = es ? 'Iguales.' : 'Deuce.';
    if (deciding && s.format.mode === MODE_GOLDEN) return `${deuce} ${es ? 'Punto de oro.' : 'Golden point.'}`;
    if (deciding && s.format.mode === MODE_STAR) return `${deuce} Star point.`;
    return deuce;
  }
  const ahead = p[0]! > p[1]! ? 0 : 1;
  return `${es ? 'Ventaja' : 'Advantage'} ${names[ahead]}.`;
}

/** "Four games to two" with the leader's name, or "four games all" ("empate a cuatro juegos"). */
function games(lang: UmpireLang, g: readonly number[], names: readonly [string, string], plural: boolean): string {
  const es = lang === 'es';
  const noun = (n: number): string => (es ? (n === 1 ? 'juego' : 'juegos') : (n === 1 ? 'game' : 'games'));
  if (g[0] === g[1]) return es ? `Empate a ${numN(lang, g[0]!)} ${noun(g[0]!)}.` : `${cap(num(lang, g[0]!))} ${noun(g[0]!)} all.`;
  const lead = g[0]! > g[1]! ? 0 : 1, x = g[lead]!, y = g[1 - lead]!;
  if (es) return `${names[lead]}, ${numN(lang, x)} ${noun(x)} a ${num(lang, y)}.`;
  return `${names[lead]} ${plural ? 'lead' : 'leads'} ${num(lang, x)} ${noun(x)} to ${y === 0 ? 'love' : num(lang, y)}.`;
}

/** A game won (the set goes on): "Game, Ruiz and Vega. Ruiz and Vega lead four games to two." */
export function gameCall(lang: UmpireLang, s: Score, winner: number, names: readonly [string, string], plural: boolean, tiebreakNext: boolean): string {
  const es = lang === 'es';
  const head = `${es ? 'Juego' : 'Game'}, ${names[winner]}.`;
  if (tiebreakNext) return `${head} ${es ? `Empate a ${numN(lang, s.games[0]!)} juegos. Tie-break.` : `${cap(num(lang, s.games[0]!))} games all. Tie-break.`}`;
  return `${head} ${games(lang, s.games, names, plural)}`;
}

/** A set won (the match goes on): "Game and set, Ruiz and Vega, six games to four. One set all." */
export function setCall(lang: UmpireLang, s: Score, winner: number, names: readonly [string, string], plural: boolean): string {
  const es = lang === 'es';
  const last = s.history[s.history.length - 1];
  const w = last ? last[winner]! : 0, l = last ? last[1 - winner]! : 0;
  const head = es
    ? `Juego y set, ${names[winner]}, ${num(lang, w)} juegos a ${num(lang, l)}.`
    : `Game and set, ${names[winner]}, ${num(lang, w)} games to ${l === 0 ? 'love' : num(lang, l)}.`;
  const st = s.sets;
  if (st[0] === st[1]) return `${head} ${es ? `Empate a ${numN(lang, st[0]!)} ${st[0] === 1 ? 'set' : 'sets'}.` : `${cap(num(lang, st[0]!))} ${st[0] === 1 ? 'set' : 'sets'} all.`}`;
  const lead = st[0]! > st[1]! ? 0 : 1, x = st[lead]!, y = st[1 - lead]!;
  const xs = numN(lang, x);
  return `${head} ${es ? `${names[lead]}, ${xs} ${x === 1 ? 'set' : 'sets'} a ${num(lang, y)}.` : `${names[lead]} ${plural ? 'lead' : 'leads'} ${xs} ${x === 1 ? 'set' : 'sets'} to ${y === 0 ? 'love' : num(lang, y)}.`}`;
}

/** The match won: "Game, set and match, Ruiz and Vega." */
export function matchCall(lang: UmpireLang, winner: number, names: readonly [string, string]): string {
  return lang === 'es' ? `Juego, set y partido, ${names[winner]}.` : `Game, set and match, ${names[winner]}.`;
}

/** What is called at once, as it happens. */
export function faultCall(lang: UmpireLang, second: boolean): string {
  return lang === 'es' ? (second ? 'Doble falta.' : 'Falta.') : (second ? 'Double fault.' : 'Fault.');
}
export function letCall(lang: UmpireLang, serveNo: number): string {
  return lang === 'es' ? (serveNo === 2 ? 'Let. Segundo saque.' : 'Let. Primer saque.') : (serveNo === 2 ? 'Let. Second serve.' : 'Let. First serve.');
}
export function outCall(lang: UmpireLang): string {
  return lang === 'es' ? 'Fuera.' : 'Out.';
}

export interface CallSink {
  /** A call to say (and caption). */
  call(text: string): void;
}

/**
 * Follows a match's events (through `eventsOf`, so an online match's are confirmed first) and makes the calls.
 * `names`: each team's name as said (`pairName`); `plural`: pairs (doubles) or one player each.
 */
export class Umpire {
  lang: UmpireLang;
  private seen = 0;
  private wasDead = false;
  /** Something counted at the end of the dead time is to be called: the point's score, a game, set or the match. */
  private pointDue = false;
  private gameWon = -1;
  private setWon = -1;
  private matchWon = -1;
  private readonly names: readonly [string, string];
  private readonly plural: boolean;
  private readonly sink: CallSink;

  /** `sim`: start from its current events (turned on mid-match, nothing already called is called again). */
  constructor(lang: UmpireLang, names: readonly [string, string], plural: boolean, sink: CallSink, sim?: MatchSim) {
    this.lang = lang;
    this.names = names;
    this.plural = plural;
    this.sink = sink;
    if (sim) this.seen = eventsOf(sim).eventSeq;
  }

  update(sim: MatchSim): void {
    const feed = eventsOf(sim);
    if (feed.eventSeq - this.seen > feed.events.length) this.seen = feed.eventSeq - feed.events.length;
    while (this.seen < feed.eventSeq) {
      const e = feed.events[this.seen % feed.events.length]!;
      this.seen++;
      if (e.seq >= 0) this.onEvent(e);
    }
    const dead = sim.phase === PH_DEAD;
    if (this.wasDead && !dead) this.callCounted(sim.score);
    this.wasDead = dead;
  }

  private onEvent(e: MatchEvent): void {
    const L = this.lang;
    switch (e.kind) {
      case E_POINT:
        if (e.a === WHY_OUT) this.sink.call(outCall(L));
        this.pointDue = true;
        break;
      case E_FAULT:
        this.sink.call(faultCall(L, e.b === 2));
        if (e.b === 2) this.pointDue = true;
        break;
      case E_LET:
        this.sink.call(letCall(L, e.b));
        break;
      // (emitted as the score is counted, before the phase leaves the dead time: called with it)
      case E_GAME: this.gameWon = e.team; break;
      case E_SET: this.setWon = e.team; break;
      case E_MATCH: this.matchWon = e.team; break;
    }
  }

  private callCounted(s: Score): void {
    const L = this.lang, n = this.names;
    if (this.matchWon >= 0) this.sink.call(matchCall(L, this.matchWon, n));
    else if (this.setWon >= 0) this.sink.call(setCall(L, s, this.setWon, n, this.plural));
    else if (this.gameWon >= 0) this.sink.call(gameCall(L, s, this.gameWon, n, this.plural, s.tiebreak && s.points[0] === 0 && s.points[1] === 0));
    else if (this.pointDue) this.sink.call(pointCall(L, s, n));
    this.pointDue = false;
    this.gameWon = this.setWon = this.matchWon = -1;
  }
}
