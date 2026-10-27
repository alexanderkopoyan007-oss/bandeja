import { describe, expect, it } from 'vitest';
import {
  Score, MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_ADVANTAGE, FINAL_SUPERTB10, FINAL_NORMAL,
  EV_GAME, EV_SET, EV_MATCH, EV_CHANGE_ENDS, SIDE_LEFT, SIDE_RIGHT, type MatchFormat,
} from '../../src/sim/rules/score.ts';

const fmt = (mode: number, finalSet = FINAL_NORMAL, gamesPerSet = 6): MatchFormat => ({ mode, setsToWin: 2, gamesPerSet, finalSet });
const play = (s: Score, seq: string): number => {
  let ev = 0;
  for (const c of seq) ev = s.pointWon(c === 'a' ? 0 : 1);
  return ev;
};
const winGame = (s: Score, team: number): number => {
  let ev = 0;
  for (let i = 0; i < 4; i++) ev = s.pointWon(team);
  return ev;
};

describe('Advantage scoring (rule 1, option 1)', () => {
  it('counts 15/30/40/game', () => {
    const s = new Score(fmt(MODE_ADVANTAGE));
    play(s, 'ab');
    expect(s.display()).toEqual(['15', '15']);
    expect(play(s, 'aa') & EV_GAME).toBe(0);
    expect(s.display()).toEqual(['40', '15']);
    expect(play(s, 'a') & EV_GAME).toBe(EV_GAME);
    expect(s.games).toEqual([1, 0]);
  });
  it('needs two clear points from deuce, any number of times', () => {
    const s = new Score(fmt(MODE_ADVANTAGE));
    play(s, 'aaabbb');
    expect(s.display()).toEqual(['Deuce', '']);
    play(s, 'ababab');
    expect(s.games).toEqual([0, 0]);
    play(s, 'b');
    expect(s.display()).toEqual(['', 'AD']);
    expect(play(s, 'b') & EV_GAME).toBe(EV_GAME);
    expect(s.games).toEqual([0, 1]);
  });
});

describe('Golden Point (rule 1, option 3)', () => {
  it('3-3 is a single deciding point', () => {
    const s = new Score(fmt(MODE_GOLDEN));
    play(s, 'aaabbb');
    expect(s.isDecidingPoint()).toBe(true);
    expect(s.display()).toEqual(['Golden point', '']);
    expect(play(s, 'b') & EV_GAME).toBe(EV_GAME);
    expect(s.games).toEqual([0, 1]);
  });
  it('receivers choose the side for the deciding point', () => {
    const s = new Score(fmt(MODE_GOLDEN));
    play(s, 'aaabbb');
    expect(s.serveSide()).toBe(SIDE_RIGHT);
    s.decidingSide = SIDE_LEFT;
    expect(s.serveSide()).toBe(SIDE_LEFT);
  });
});

describe('Star Point (rule 1, option 2)', () => {
  it('advantage is played at most twice, then one deciding point', () => {
    const s = new Score(fmt(MODE_STAR));
    play(s, 'aaabbb');
    expect(s.display()).toEqual(['Deuce 1', '']);
    play(s, 'a');
    expect(s.display()).toEqual(['AD 1', '']);
    play(s, 'b');
    expect(s.display()).toEqual(['Deuce 2', '']);
    play(s, 'b');
    expect(s.display()).toEqual(['', 'AD 2']);
    play(s, 'a');
    expect(s.isDecidingPoint()).toBe(true);
    expect(s.display()).toEqual(['Star point', '']);
    expect(play(s, 'a') & EV_GAME).toBe(EV_GAME);
    expect(s.games).toEqual([1, 0]);
  });
  it('converting the first or second advantage wins the game', () => {
    const s = new Score(fmt(MODE_STAR));
    expect(play(s, 'aaabbbaa') & EV_GAME).toBe(EV_GAME);
    const t = new Score(fmt(MODE_STAR));
    expect(play(t, 'aaabbbabbb') & EV_GAME).toBe(EV_GAME);
    expect(t.games).toEqual([0, 1]);
  });
});

describe('sets, ends and serve order', () => {
  it('serve alternates by game and side alternates by point', () => {
    const s = new Score(fmt(MODE_STAR), 0);
    expect(s.serverTeam()).toBe(0);
    expect(s.serveSide()).toBe(SIDE_RIGHT);
    s.pointWon(0);
    expect(s.serveSide()).toBe(SIDE_LEFT);
    play(s, 'aaa');
    expect(s.serverTeam()).toBe(1);
    expect(s.serveSide()).toBe(SIDE_RIGHT);
  });
  it('ends change after the 1st, 3rd and every odd game (rule 5)', () => {
    const s = new Score(fmt(MODE_STAR));
    expect(winGame(s, 0) & EV_CHANGE_ENDS).toBe(EV_CHANGE_ENDS);
    expect(winGame(s, 0) & EV_CHANGE_ENDS).toBe(0);
    expect(winGame(s, 1) & EV_CHANGE_ENDS).toBe(EV_CHANGE_ENDS);
    expect(s.ends).toBe(0);
  });
  it('6-4 wins a set, 6-5 does not, 7-5 does', () => {
    const s = new Score(fmt(MODE_ADVANTAGE));
    for (let i = 0; i < 5; i++) { winGame(s, 0); winGame(s, 1); }
    expect(s.games).toEqual([5, 5]);
    winGame(s, 0);
    expect(s.sets).toEqual([0, 0]);
    expect(winGame(s, 0) & EV_SET).toBe(EV_SET);
    expect(s.history[0]).toEqual([7, 5]);
  });
});

describe('tie-break (rule 1)', () => {
  const toTiebreak = (s: Score): void => {
    for (let i = 0; i < 6; i++) { winGame(s, 0); winGame(s, 1); }
  };
  it('starts at 6-6, first to 7 by two, set recorded 7-6', () => {
    const s = new Score(fmt(MODE_STAR));
    toTiebreak(s);
    expect(s.tiebreak).toBe(true);
    for (let i = 0; i < 6; i++) { s.pointWon(0); s.pointWon(1); }
    expect(s.points).toEqual([6, 6]);
    s.pointWon(0);
    expect(s.tiebreak).toBe(true);
    expect(s.pointWon(0) & EV_SET).toBe(EV_SET);
    expect(s.history[0]).toEqual([7, 6]);
  });
  it('serve order: one point, then two each; side alternates', () => {
    const s = new Score(fmt(MODE_STAR), 0);
    toTiebreak(s);
    const first = s.serverTeam();
    const order: number[] = [];
    const sides: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.serverTeam() === first ? 0 : 1);
      sides.push(s.serveSide());
      s.pointWon(i % 2);
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
    expect(sides).toEqual([SIDE_RIGHT, SIDE_LEFT, SIDE_RIGHT, SIDE_LEFT, SIDE_RIGHT, SIDE_LEFT]);
  });
  it('ends change every 6 points', () => {
    const s = new Score(fmt(MODE_STAR));
    toTiebreak(s);
    const e0 = s.ends;
    play(s, 'ababa');
    expect(s.ends).toBe(e0);
    expect(s.pointWon(1) & EV_CHANGE_ENDS).toBe(EV_CHANGE_ENDS);
  });
  it('next set is served by the team that did not serve first in the tie-break', () => {
    const s = new Score(fmt(MODE_STAR), 0);
    toTiebreak(s);
    const first = s.tbFirstServer;
    for (let i = 0; i < 7; i++) s.pointWon(0);
    expect(s.serverTeam()).toBe(1 - first);
  });
});

describe('match formats', () => {
  it('best of three ends the match at two sets', () => {
    const s = new Score(fmt(MODE_GOLDEN));
    for (let set = 0; set < 2; set++) for (let g = 0; g < 6; g++) winGame(s, 1);
    expect(s.winner).toBe(1);
    expect(s.pointWon(0)).toBe(0);
  });
  it('final set without tie-break goes on until two clear games', () => {
    const s = new Score(fmt(MODE_ADVANTAGE, FINAL_ADVANTAGE));
    for (let g = 0; g < 6; g++) winGame(s, 0);
    for (let g = 0; g < 6; g++) winGame(s, 1);
    for (let i = 0; i < 6; i++) { winGame(s, 0); winGame(s, 1); }
    expect(s.tiebreak).toBe(false);
    expect(s.games).toEqual([6, 6]);
    winGame(s, 0);
    const ev = winGame(s, 0);
    expect(ev & EV_MATCH).toBe(EV_MATCH);
    expect(s.history[2]).toEqual([8, 6]);
  });
  it('super tie-break to 10 replaces the third set', () => {
    const s = new Score(fmt(MODE_STAR, FINAL_SUPERTB10));
    for (let g = 0; g < 6; g++) winGame(s, 0);
    for (let g = 0; g < 6; g++) winGame(s, 1);
    expect(s.tiebreak).toBe(true);
    expect(s.tbTarget).toBe(10);
    for (let i = 0; i < 9; i++) s.pointWon(1);
    expect(s.winner).toBe(-1);
    expect(s.pointWon(1) & EV_MATCH).toBe(EV_MATCH);
  });
  it('mini sets go to four games', () => {
    const s = new Score(fmt(MODE_STAR, FINAL_NORMAL, 4));
    for (let g = 0; g < 4; g++) winGame(s, 0);
    expect(s.sets).toEqual([1, 0]);
  });
  it('state round-trips', () => {
    const s = new Score(fmt(MODE_STAR));
    play(s, 'aabbbaabab');
    winGame(s, 1);
    const st: number[] = [];
    s.writeState(st);
    const t = new Score(fmt(MODE_STAR));
    t.readState(st);
    expect(t.display()).toEqual(s.display());
    expect(t.games).toEqual(s.games);
  });
});
