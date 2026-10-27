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

describe('doubles serve and receive order (rules 6.9, 8.2, 8.3)', () => {
  const dbl = (mode = MODE_ADVANTAGE): Score => new Score(fmt(mode), 0, true);

  it('the four players serve in turn, one game each: A1, B1, A2, B2, A1 ...', () => {
    const s = dbl();
    const servers: number[] = [];
    for (let g = 0; g < 5; g++) {
      servers.push(s.serverPlayer());
      winGame(s, s.serverTeam()); // holds of serve keep the set going
    }
    expect(servers).toEqual([0, 1, 2, 3, 0]);
  });

  it('each pair picks its own first server for the set', () => {
    const s = dbl();
    s.firstServerSlot[0] = 1;
    s.firstServerSlot[1] = 1;
    const servers: number[] = [];
    for (let g = 0; g < 4; g++) {
      servers.push(s.serverPlayer());
      winGame(s, s.serverTeam());
    }
    expect(servers).toEqual([2, 3, 0, 1]);
  });

  it('the set\'s first receiver takes the first point of every game; the partner the second', () => {
    const s = dbl();
    s.firstReceiverSlot[1] = 1; // team 1's player 3 receives on the right
    expect(s.serveSide()).toBe(SIDE_RIGHT);
    expect(s.receiverPlayer()).toBe(3);
    play(s, 'a');
    expect(s.serveSide()).toBe(SIDE_LEFT);
    expect(s.receiverPlayer()).toBe(1);
    play(s, 'aaa'); // game to team 0; team 1 serves, team 0 receives with its own order
    expect(s.serverTeam()).toBe(1);
    expect(s.receiverPlayer()).toBe(0);
    play(s, 'b');
    expect(s.receiverPlayer()).toBe(2);
    play(s, 'bbb'); // team 0 serves again: player 3 receives the first point again
    expect(s.receiverPlayer()).toBe(3);
  });

  it('a deciding point is received by the player on the side the receivers chose', () => {
    const s = dbl(MODE_GOLDEN);
    play(s, 'aaabbb');
    expect(s.isDecidingPoint()).toBe(true);
    s.decidingSide = SIDE_LEFT;
    expect(s.receiverPlayer()).toBe(3);
    s.decidingSide = SIDE_RIGHT;
    expect(s.receiverPlayer()).toBe(1);
  });

  it('a tie-break carries on the rotation: next in turn serves one point, then two each', () => {
    const s = dbl();
    // Twelve holds to 6-6: the rotation has gone round three times, so A1 is next in turn.
    for (let g = 0; g < 12; g++) winGame(s, s.serverTeam());
    expect(s.tiebreak).toBe(true);
    const servers: number[] = [];
    for (let k = 0; k < 9; k++) {
      servers.push(s.serverPlayer());
      s.pointWon(k % 2); // keep it level so it doesn't end
    }
    expect(servers).toEqual([0, 1, 1, 2, 2, 3, 3, 0, 0]);
  });

  it('a new set resets the rotation to each pair\'s first server', () => {
    const s = dbl();
    for (let g = 0; g < 6; g++) winGame(s, 0); // 6-0: team 0 served games 1, 3, 5 (players 0, 2, 0)
    expect(s.sets).toEqual([1, 0]);
    // Games keep alternating across sets (team 1 served the 6th), and team 0 starts again from its first
    // server (player 0), not from where its rotation stopped (player 2).
    expect(s.serverTeam()).toBe(0);
    expect(s.serverPlayer()).toBe(0);
  });

  it('singles numbering is unchanged', () => {
    const s = new Score(fmt(MODE_ADVANTAGE));
    expect(s.serverPlayer()).toBe(0);
    expect(s.receiverPlayer()).toBe(1);
    winGame(s, 0);
    expect(s.serverPlayer()).toBe(1);
    expect(s.receiverPlayer()).toBe(0);
  });
});
