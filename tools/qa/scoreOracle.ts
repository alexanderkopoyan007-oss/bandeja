// Score oracle (Phase 7 QA). Keeps the score, the order of service and receive, the service box and the ends
// from the FIP Rules of Padel alone (application 01.01.2026, scratch/qa/fip-rules.txt): rule 1 (game, tie-break,
// alternative formats), rule 5 (changes of ends), 6.5 / 6.8 (box and service order), 8.2-8.3 (receive order).
// It was written without reading the game's scorer. Readings of ambiguous or silent rules: ORACLE-NOTES.md.
//
// Players are numbered team + 2 * slot; in singles there are no slots and players are the team numbers.
// Points in a game are plain counts per team (advantage at deuce is 4-3, back to deuce is 4-4, and so on).

import type { Choices, Format, Half, ScoreState, ServeSide } from './facts.ts';

const flip = (h: Half): Half => (h === 1 ? -1 : 1);
const slot01 = (v: number): number => (v === 1 ? 1 : 0);

export class ScoreOracle {
  private readonly f: Format;
  private points: [number, number] = [0, 0];
  private games: [number, number] = [0, 0];
  private sets: [number, number] = [0, 0];
  private history: Array<[number, number]> = [];
  private tiebreak = false;
  /** The tie-break is the match tie-break that replaces the deciding set (1, alternative score methods b/c). */
  private matchTiebreak = false;
  private over = false;
  private winner = -1;
  private halves: [Half, Half];
  /** The team serving the first game of the current set. */
  private setFirstServer: number;
  /** 6.8: the slot of each team serving its first service game of the set. */
  private serverSlot: [number, number] = [0, 0];
  /** 8.2: the slot of each team receiving the first point of every game of the set. */
  private receiverSlot: [number, number] = [0, 0];
  /** The set's choices were given (or its first point was played with the defaults). */
  private setChosen = false;
  private pointsInSet = 0;
  /** Golden / Star point: the box the receiving pair chose for the coming deciding point. */
  private decidingSide: ServeSide | null = null;

  constructor(f: Format) {
    this.f = f;
    this.halves = [f.team0Half, flip(f.team0Half)];
    this.setFirstServer = f.firstServerTeam;
  }

  state(): ScoreState {
    const next = this.nextPoint();
    return {
      points: [this.points[0], this.points[1]],
      games: [this.games[0], this.games[1]],
      sets: [this.sets[0], this.sets[1]],
      history: this.history.map((h): [number, number] => [h[0], h[1]]),
      tiebreak: this.tiebreak,
      over: this.over,
      winner: this.winner,
      serverTeam: next.serverTeam,
      server: next.server,
      receiver: next.receiver,
      side: next.side,
      deciding: this.isDecidingPoint(),
      halves: [this.halves[0], this.halves[1]],
    };
  }

  /** The choice the rules leave to the players that is due before the next point. */
  needs(): 'setStart' | 'deciding' | null {
    if (this.over) return null;
    if (this.f.doubles && this.pointsInSet === 0 && !this.setChosen) return 'setStart';
    if (this.isDecidingPoint() && this.decidingSide === null) return 'deciding';
    return null;
  }

  choose(c: Choices): void {
    if (this.over) return;
    // 6.8 / 8.3: chosen before the set starts and not changed until the next set.
    if (this.f.doubles && this.pointsInSet === 0) {
      if (c.firstServerSlot) {
        this.serverSlot = [slot01(c.firstServerSlot[0]), slot01(c.firstServerSlot[1])];
        this.setChosen = true;
      }
      if (c.firstReceiverSlot) {
        this.receiverSlot = [slot01(c.firstReceiverSlot[0]), slot01(c.firstReceiverSlot[1])];
        this.setChosen = true;
      }
    }
    if (c.decidingSide && this.isDecidingPoint()) this.decidingSide = c.decidingSide;
  }

  pointWon(team: number): void {
    if (this.over) return;
    const t = team === 1 ? 1 : 0;
    this.pointsInSet++;
    this.setChosen = true; // a choice not given before the set's first point stays at its default
    this.decidingSide = null;
    this.points[t]++;
    if (this.tiebreak) {
      const target = this.matchTiebreak && this.f.finalSet === 'supertb10' ? 10 : 7;
      if (this.points[t] >= target && this.points[t] - this.points[1 - t] >= 2) this.wonTiebreak(t);
      else if ((this.points[0] + this.points[1]) % 6 === 0) this.changeEnds(); // 5.2
      return;
    }
    if (this.gameWon(t)) this.wonGame(t);
  }

  // ---------------------------------------------------------------------------------------------------------------

  private changeEnds(): void {
    this.halves = [flip(this.halves[0]), flip(this.halves[1])];
  }

  /** The deciding set: both pairs one set short of the match ("one set all" in a best of three). */
  private isDecidingSet(): boolean {
    const need = this.f.setsToWin - 1;
    return this.f.setsToWin >= 2 && this.sets[0] === need && this.sets[1] === need;
  }

  /** Golden point at 3-3 (deuce); Star Point at deuce 3, i.e. 5-5 (deuce 1 at 3-3, deuce 2 at 4-4). */
  private isDecidingPoint(): boolean {
    if (this.over || this.tiebreak) return false;
    const [a, b] = this.points;
    if (this.f.mode === 'golden') return a === 3 && b === 3;
    if (this.f.mode === 'star') return a === 5 && b === 5;
    return false;
  }

  private gameWon(t: number): boolean {
    const a = this.points[t];
    const b = this.points[1 - t];
    if (this.f.mode === 'golden') return a >= 4; // the golden point (from 3-3) wins it outright
    if (this.f.mode === 'star' && a === 6 && b === 5) return true; // the Star Point
    return a >= 4 && a - b >= 2; // "game", or the point after "advantage" (1, and 2 in Star Point)
  }

  private wonGame(t: number): void {
    this.games[t]++;
    this.points = [0, 0];
    const played = this.games[0] + this.games[1];
    // 5.1: change ends after the 1st, 3rd and every subsequent odd game of the set (also when it ends the set).
    if (played % 2 === 1) this.changeEnds();
    const n = this.f.gamesPerSet;
    const a = this.games[t];
    const b = this.games[1 - t];
    // 1.score.2 / mini sets (1, alternative a): n games with a margin of two.
    if (a >= n && a - b >= 2) {
      this.wonSet(t);
      return;
    }
    // A tie-break at n all, except in a final set played without one (1.score.4).
    const noTiebreak = this.isDecidingSet() && this.f.finalSet === 'advantage';
    if (!noTiebreak && this.games[0] === n && this.games[1] === n) this.tiebreak = true;
  }

  private wonTiebreak(t: number): void {
    this.points = [0, 0];
    if (this.matchTiebreak) {
      // It "replaces the last set": recorded as a set won 1-0.
      this.sets[t]++;
      this.history.push(t === 0 ? [1, 0] : [0, 1]);
      this.endMatch(t);
      return;
    }
    // 1.tie-break.4: the set is won 7-6 (n+1 to n). The tie-break is the set's 2n+1-th game, an odd one (5.1).
    this.games[t]++;
    this.changeEnds();
    this.wonSet(t);
  }

  private wonSet(t: number): void {
    const played = this.games[0] + this.games[1]; // a tie-break counts as one game
    this.history.push([this.games[0], this.games[1]]);
    this.sets[t]++;
    this.games = [0, 0];
    this.points = [0, 0];
    this.tiebreak = false;
    if (this.sets[t] >= this.f.setsToWin) {
      this.endMatch(t);
      return;
    }
    // The order of service runs on across sets (one game each, alternately). After a tie-break that gives the
    // pair that did not begin serving in it, as 1.tie-break.5 asks.
    this.setFirstServer = this.setFirstServer ^ (played % 2);
    this.pointsInSet = 0;
    this.setChosen = false;
    this.serverSlot = [0, 0];
    this.receiverSlot = [0, 0];
    if (this.isDecidingSet() && (this.f.finalSet === 'tiebreak7' || this.f.finalSet === 'supertb10')) {
      this.tiebreak = true;
      this.matchTiebreak = true;
    }
  }

  private endMatch(t: number): void {
    this.over = true;
    this.winner = t;
    this.tiebreak = false;
    this.games = [0, 0];
    this.points = [0, 0];
  }

  /**
   * Position k in the set's order of service: game k of the set, or the k-th service turn counting the tie-break's
   * turns on from its game. Pairs alternate (team = first ^ k); within a pair the partners alternate their turns
   * (6.8), so the doubles order is A first, B first, A other, B other, A first...
   */
  private serverAt(k: number): { team: number; player: number } {
    const team = this.setFirstServer ^ (k % 2);
    if (!this.f.doubles) return { team, player: team };
    const turn = Math.floor(k / 2); // this pair's service turn number in the set
    const slot = turn % 2 === 0 ? this.serverSlot[team] : 1 - this.serverSlot[team];
    return { team, player: team + 2 * slot };
  }

  private nextPoint(): { serverTeam: number; server: number; receiver: number; side: ServeSide } {
    const k = this.games[0] + this.games[1];
    const n = this.points[0] + this.points[1];
    let s: { team: number; player: number };
    let side: ServeSide;
    if (this.tiebreak) {
      // 1.tie-break.3: the player whose turn it is serves one point (from the right), then each next server in
      // the order serves two. Boxes alternate every point (6.5): right, left, right, left...
      const turn = n === 0 ? 0 : Math.floor((n + 1) / 2);
      s = this.serverAt(k + turn);
      side = n % 2 === 0 ? 'right' : 'left';
    } else {
      s = this.serverAt(k);
      // 6.5: the first point of a game from the right, then alternately; at a deciding point the receivers choose.
      if (this.isDecidingPoint()) side = this.decidingSide ?? 'right';
      else side = n % 2 === 0 ? 'right' : 'left';
    }
    const rt = 1 - s.team;
    let receiver = rt;
    if (this.f.doubles) {
      // 8.2-8.3: the pair's first receiver takes the first point of every game (the right box), the partner the
      // left; at a deciding point the receiver is whoever stands on the chosen side (they cannot change places).
      const slot = side === 'right' ? this.receiverSlot[rt] : 1 - this.receiverSlot[rt];
      receiver = rt + 2 * slot;
    }
    return { serverTeam: s.team, server: s.player, receiver, side };
  }
}
