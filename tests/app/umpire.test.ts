// The umpire's calls (M7 phase E): the words for each score, played point by point on the real Score, in English and
// Spanish; then the umpire following an AI match, its calls checked against the events and the scoreboard.
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_DEAD, PH_OVER, E_POINT, E_FAULT, E_GAME } from '../../src/sim/match.ts';
import { Score, MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_NORMAL } from '../../src/sim/rules/score.ts';
import { Umpire, pointCall, gameCall, setCall, pairName, type UmpireLang } from '../../src/game/umpire.ts';
import { pickVoice } from '../../src/ui/umpireVoice.ts';

const N: [string, string] = ['Ruiz and Vega', 'Soto and Mena'];
const NES: [string, string] = [pairName('es', ['Ruiz', 'Vega']), pairName('es', ['Soto', 'Mena'])];
const score = (mode: number, server = 0): Score => new Score({ mode, setsToWin: 2, gamesPerSet: 6, finalSet: FINAL_NORMAL }, server, true);
/** The calls after each point of a sequence of winners. */
function calls(s: Score, seq: number[], lang: UmpireLang = 'en'): string[] {
  return seq.map((t) => { s.pointWon(t); return pointCall(lang, s, N); });
}

describe('the umpire\'s words', () => {
  it('calls the server\'s points first, love to forty, and level as all', () => {
    expect(calls(score(MODE_ADVANTAGE), [0, 1, 1, 0, 0])).toEqual(['Fifteen–love.', 'Fifteen all.', 'Fifteen–thirty.', 'Thirty all.', 'Forty–thirty.']);
    // Team 1 serving: their points first.
    expect(calls(score(MODE_ADVANTAGE, 1), [1, 0, 0])).toEqual(['Fifteen–love.', 'Fifteen all.', 'Fifteen–thirty.']);
    expect(calls(score(MODE_ADVANTAGE), [0, 1, 1, 0, 0], 'es')).toEqual(['Quince–cero.', 'Quince iguales.', 'Quince–treinta.', 'Treinta iguales.', 'Cuarenta–treinta.']);
  });

  it('calls deuce, advantage by name, and the deciding points', () => {
    const adv = calls(score(MODE_ADVANTAGE), [0, 0, 0, 1, 1, 1, 1, 0]);
    expect(adv.slice(5)).toEqual(['Deuce.', 'Advantage Soto and Mena.', 'Deuce.']);
    expect(calls(score(MODE_GOLDEN), [0, 0, 0, 1, 1, 1]).at(-1)).toBe('Deuce. Golden point.');
    expect(calls(score(MODE_GOLDEN), [0, 0, 0, 1, 1, 1], 'es').at(-1)).toBe('Iguales. Punto de oro.');
    // Star point: advantage twice, then the third deuce decides.
    const star = calls(score(MODE_STAR), [0, 0, 0, 1, 1, 1, 0, 1, 1, 0]);
    expect(star.slice(5)).toEqual(['Deuce.', 'Advantage Ruiz and Vega.', 'Deuce.', 'Advantage Soto and Mena.', 'Deuce. Star point.']);
  });

  it('calls a tie-break by the leader, and games and sets with the score', () => {
    const s = score(MODE_STAR);
    s.tiebreak = true;
    s.points[0] = 3; s.points[1] = 5;
    expect(pointCall('en', s, N)).toBe('Five–three, Soto and Mena.');
    s.points[0] = 4; s.points[1] = 4;
    expect(pointCall('es', s, N)).toBe('Cuatro iguales.');
    const g = score(MODE_STAR);
    for (let k = 0; k < 4 * 3; k++) g.pointWon(k < 8 ? 0 : 1);
    expect(gameCall('en', g, 1, N, true, false)).toBe('Game, Soto and Mena. Ruiz and Vega lead two games to one.');
    expect(gameCall('es', g, 1, NES, true, false)).toBe('Juego, Soto y Mena. Ruiz y Vega, dos juegos a uno.');
    // A set, six games to four (games won alternately, then two more).
    const t = score(MODE_STAR);
    for (const w of [0, 1, 0, 1, 0, 1, 0, 1, 0, 0]) for (let p = 0; p < 4; p++) t.pointWon(w);
    expect(t.sets).toEqual([1, 0]);
    expect(setCall('en', t, 0, N, true)).toBe('Game and set, Ruiz and Vega, six games to four. Ruiz and Vega lead one set to love.');
    expect(setCall('es', t, 0, NES, true)).toBe('Juego y set, Ruiz y Vega, seis juegos a cuatro. Ruiz y Vega, un set a cero.');
    // Level, and one game: singular, and Spanish "un".
    const h = score(MODE_STAR);
    for (const w of [0, 1]) for (let p = 0; p < 4; p++) h.pointWon(w);
    expect(gameCall('en', h, 1, N, true, false)).toBe('Game, Soto and Mena. One game all.');
    expect(gameCall('es', h, 1, NES, true, false)).toBe('Juego, Soto y Mena. Empate a un juego.');
    const o = score(MODE_STAR);
    for (let p = 0; p < 4; p++) o.pointWon(0);
    expect(gameCall('es', o, 0, NES, true, false)).toBe('Juego, Ruiz y Vega. Ruiz y Vega, un juego a cero.');
    expect(pairName('es', ['Ruiz', 'Vega'])).toBe('Ruiz y Vega');
    expect(pairName('en', ['Ruiz'])).toBe('Ruiz');
  });

  it('speaks only with a voice on this machine', () => {
    const v = (lang: string, localService: boolean, name = lang): SpeechSynthesisVoice => ({ lang, localService, name } as SpeechSynthesisVoice);
    expect(pickVoice([v('en-US', true), v('en-GB', false), v('en-GB', true, 'Daniel')], 'en')?.name).toBe('Daniel');
    expect(pickVoice([v('en-US', true, 'Samantha')], 'en')?.name).toBe('Samantha');
    expect(pickVoice([v('es-ES', false), v('en-GB', true)], 'es')).toBeNull();
  });
});

describe('the umpire in a match', () => {
  it('calls every fault, every point as counted, every game, and the match', () => {
    const sim = new MatchSim({ seed: 23, doubles: true, human: [false, false, false, false], aiLevel: [0.8, 0.8],
      format: { mode: MODE_STAR, setsToWin: 1, gamesPerSet: 4, finalSet: 0 } } as never);
    // Each call with the scoreboard as it is when called (the server's points first).
    const said: Array<{ text: string; dead: boolean; board: string[] }> = [];
    const ump = new Umpire('en', N, true, { call: (text) => {
      const d = sim.score.display(), srv = sim.score.serverTeam();
      said.push({ text, dead: sim.phase === PH_DEAD, board: [d[srv], d[1 - srv]] });
    } });
    let seen = 0, points = 0, faults1 = 0, doubles = 0;
    const gameWinners: number[] = [];
    for (let k = 0; k < 120 * 1500 && sim.phase !== PH_OVER; k++) {
      sim.step([null, null, null, null]);
      for (; seen < sim.eventSeq; seen++) {
        const e = sim.events[seen % sim.events.length]!;
        if (e.kind === E_POINT) points++;
        else if (e.kind === E_FAULT) { if (e.b === 2) doubles++; else faults1++; }
        else if (e.kind === E_GAME) gameWinners.push(e.team);
      }
      if (k % 2) ump.update(sim);
    }
    ump.update(sim);
    expect(sim.phase).toBe(PH_OVER);
    const texts = said.map((c) => c.text);
    expect(texts.filter((t) => t === 'Fault.').length).toBe(faults1);
    expect(texts.filter((t) => t === 'Double fault.').length).toBe(doubles);
    // One call when each point is counted: points, games, the match.
    const counted = said.filter((c) => !c.dead && !/^(Fault|Double fault|Out|Let)\./.test(c.text));
    expect(counted.length).toBe(points + doubles);
    const games = counted.filter((c) => /^Game, /.test(c.text) && !/^Game, set and match/.test(c.text));
    expect(games.length).toBe(gameWinners.length - 1);
    games.forEach((c, i) => expect(c.text.startsWith(`Game, ${N[gameWinners[i]!]}.`)).toBe(true));
    expect(texts.at(-1)).toBe(`Game, set and match, ${N[sim.score.winner]}.`);
    // The point calls say what the scoreboard shows, the server's first.
    const words: Record<string, string> = { 0: 'love', 15: 'fifteen', 30: 'thirty', 40: 'forty' };
    const cap = (w: string): string => w[0]!.toUpperCase() + w.slice(1);
    let checked = 0;
    for (const c of counted) {
      const [x, y] = c.board as [string, string];
      if (/^Game/.test(c.text) || !(x in words) || !(y in words)) continue;
      expect(c.text).toBe(x === y ? `${cap(words[x]!)} all.` : `${cap(words[x]!)}–${words[y]}.`);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
