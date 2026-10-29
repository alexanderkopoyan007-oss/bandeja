// Scoring per FIP Rules of Padel, rule 1 (Advantage, Star Point, Golden Point), tie-breaks,
// sets, alternative set formats, serve order (rules 1, 6, 8) and changes of ends (rule 5).
// Doubles (rules 6.9, 8.2-8.3): each pair fixes, per set, which player serves its first service game (then
// they alternate) and which player receives the first point of every game (the other receives the second).
// Players are numbered team + 2 * slot: 0 and 1 are the first player of each team, 2 and 3 their partners.

export const MODE_ADVANTAGE = 0;
export const MODE_STAR = 1;
export const MODE_GOLDEN = 2;

export const FINAL_NORMAL = 0; // tie-break at 6-6 like other sets
export const FINAL_ADVANTAGE = 1; // no tie-break: win by two games
export const FINAL_TIEBREAK7 = 2; // match tie-break to 7 replaces the third set
export const FINAL_SUPERTB10 = 3; // super tie-break to 10 replaces the third set

export interface MatchFormat {
  mode: number;
  /** Sets needed to win (2 = best of three). */
  setsToWin: number;
  /** Games to win a set (6, or 4 for a mini set). */
  gamesPerSet: number;
  finalSet: number;
}

export const DEFAULT_FORMAT: MatchFormat = { mode: MODE_STAR, setsToWin: 2, gamesPerSet: 6, finalSet: FINAL_NORMAL };

// Flags returned by pointWon()
export const EV_GAME = 1;
export const EV_SET = 2;
export const EV_MATCH = 4;
export const EV_CHANGE_ENDS = 8;
export const EV_TIEBREAK_START = 16;

export const SIDE_RIGHT = 0; // deuce side
export const SIDE_LEFT = 1; // advantage side

export class Score {
  format: MatchFormat;
  readonly points = [0, 0];
  readonly games = [0, 0];
  readonly sets = [0, 0];
  /** Completed sets as [near, far] game counts (tie-break sets record 7-6). */
  readonly history: Array<[number, number]> = [];
  /** Team serving the current game (outside tie-breaks). */
  server = 0;
  /** Team that served the first game of the current set. */
  setFirstServer = 0;
  tiebreak = false;
  /** Points to win the current tie-break (7 or 10). */
  tbTarget = 7;
  tbFirstServer = 0;
  /** Ends parity: toggles at every change of ends. */
  ends = 0;
  winner = -1;
  /** Side chosen by the receivers for a golden/star deciding point (-1 = not chosen). */
  decidingSide = -1;

  /** Two players a side. */
  readonly doubles: boolean;
  /** Per team: slot (0/1) of the player serving the team's first service game of this set. */
  readonly firstServerSlot = [0, 0];
  /** Per team: service games the team has served in this set. */
  readonly serviceGames = [0, 0];
  /** Per team: slot of the player who receives the first point of every game this set (the deuce side). */
  readonly firstReceiverSlot = [0, 0];
  /** Per team, set when a tie-break starts: slot of the player whose turn it is to serve. */
  readonly tbSlot = [0, 0];

  constructor(format: MatchFormat = DEFAULT_FORMAT, firstServer = 0, doubles = false) {
    this.format = format;
    this.server = firstServer;
    this.setFirstServer = firstServer;
    this.doubles = doubles;
  }

  /** Team serving the next point. */
  serverTeam(): number {
    if (!this.tiebreak) return this.server;
    const k = this.points[0]! + this.points[1]!;
    return Math.floor((k + 1) / 2) % 2 === 0 ? this.tbFirstServer : 1 - this.tbFirstServer;
  }

  receiverTeam(): number {
    return 1 - this.serverTeam();
  }

  /** Slot (0/1) within the serving team of the player serving the next point. */
  serverSlot(): number {
    if (!this.doubles) return 0;
    if (!this.tiebreak) {
      const t = this.server;
      return (this.firstServerSlot[t]! + this.serviceGames[t]!) % 2;
    }
    // Tie-break: the turns go round the set's order: one point, then two each (rule 1).
    const k = this.points[0]! + this.points[1]!;
    const turn = Math.floor((k + 1) / 2);
    const t = turn % 2 === 0 ? this.tbFirstServer : 1 - this.tbFirstServer;
    return (this.tbSlot[t]! + Math.floor(turn / 2)) % 2;
  }

  /** Player number (team + 2 * slot) serving the next point. */
  serverPlayer(): number {
    return this.serverTeam() + 2 * this.serverSlot();
  }

  /** Player number receiving the next point: the set's first receiver takes the right (deuce) box. */
  receiverPlayer(): number {
    const r = this.receiverTeam();
    if (!this.doubles) return r;
    const first = this.firstReceiverSlot[r]!;
    return r + 2 * (this.serveSide() === SIDE_RIGHT ? first : 1 - first);
  }

  /** Is the next point a golden/star deciding point (receivers choose the side)? */
  isDecidingPoint(): boolean {
    if (this.tiebreak) return false;
    const a = this.points[0]!;
    const b = this.points[1]!;
    if (this.format.mode === MODE_GOLDEN) return a === 3 && b === 3;
    if (this.format.mode === MODE_STAR) return a === 5 && b === 5;
    return false;
  }

  /** Side of the court the server serves from (and the diagonal box served to) for the next point. */
  serveSide(): number {
    if (this.isDecidingPoint() && this.decidingSide >= 0) return this.decidingSide;
    return (this.points[0]! + this.points[1]!) % 2 === 0 ? SIDE_RIGHT : SIDE_LEFT;
  }

  /** Number of deuces reached in the current game (Star Point counts deuce 1, 2, 3). */
  deuceCount(): number {
    const a = this.points[0]!;
    const b = this.points[1]!;
    if (a < 3 || b < 3) return 0;
    return Math.min(a, b) - 2;
  }

  private gameWonBy(): number {
    const a = this.points[0]!;
    const b = this.points[1]!;
    if (this.tiebreak) {
      const t = this.tbTarget;
      if (a >= t && a - b >= 2) return 0;
      if (b >= t && b - a >= 2) return 1;
      return -1;
    }
    if (a >= 4 && a - b >= 2) return 0;
    if (b >= 4 && b - a >= 2) return 1;
    const total = a + b;
    if (this.format.mode === MODE_GOLDEN && total === 7) return a > b ? 0 : 1;
    if (this.format.mode === MODE_STAR && total === 11) return a > b ? 0 : 1;
    return -1;
  }

  /**
   * One set all (generalised: both pairs a set short). Never in a one-set match: there is no deciding set, so the
   * final-set rule does not apply (QA army: "no tie-break" did, a match tie-break did not; the score oracle reads
   * 1.score.4 the same way).
   */
  private isFinalSet(): boolean {
    return this.format.setsToWin >= 2 && this.sets[0] === this.format.setsToWin - 1 && this.sets[1] === this.format.setsToWin - 1;
  }

  /** Record a point for `team`. Returns EV_* flags. */
  pointWon(team: number): number {
    if (this.winner >= 0) return 0;
    let ev = 0;
    this.points[team]!++;
    this.decidingSide = -1;
    if (this.tiebreak) {
      const played = this.points[0]! + this.points[1]!;
      if (played % 6 === 0 && this.gameWonBy() < 0) {
        this.ends ^= 1;
        ev |= EV_CHANGE_ENDS;
      }
    }
    const g = this.gameWonBy();
    if (g < 0) return ev;

    ev |= EV_GAME;
    const wasTiebreak = this.tiebreak;
    this.points[0] = 0;
    this.points[1] = 0;
    this.games[g]!++;
    if (wasTiebreak) this.tiebreak = false;

    const setWinner = wasTiebreak ? g : this.setWonBy();
    const gamesInSet = this.games[0]! + this.games[1]!;

    if (setWinner >= 0) {
      ev |= EV_SET;
      this.history.push([this.games[0]!, this.games[1]!]);
      this.sets[setWinner]!++;
      const over = this.sets[setWinner] === this.format.setsToWin;
      // Ends change after an odd total of games in the set (a tie-break counts as one game); not after the last
      // set, when nobody plays on (the players stay where they are: presentation reads the ends).
      if (gamesInSet % 2 === 1 && !over) {
        this.ends ^= 1;
        ev |= EV_CHANGE_ENDS;
      }
      this.games[0] = 0;
      this.games[1] = 0;
      this.serviceGames[0] = 0;
      this.serviceGames[1] = 0;
      if (over) {
        this.winner = setWinner;
        return ev | EV_MATCH;
      }
      // Next server: after a tie-break, the team that did not serve first in it; otherwise alternate.
      this.server = wasTiebreak ? 1 - this.tbFirstServer : 1 - this.server;
      this.setFirstServer = this.server;
      // A match tie-break replaces the final set.
      if (this.isFinalSet() && (this.format.finalSet === FINAL_TIEBREAK7 || this.format.finalSet === FINAL_SUPERTB10)) {
        this.startTiebreak(this.format.finalSet === FINAL_SUPERTB10 ? 10 : 7);
        ev |= EV_TIEBREAK_START;
      }
      return ev;
    }

    if (gamesInSet % 2 === 1) {
      this.ends ^= 1;
      ev |= EV_CHANGE_ENDS;
    }
    if (!wasTiebreak) this.serviceGames[this.server]!++;
    this.server = 1 - this.server;
    const gp = this.format.gamesPerSet;
    if (this.games[0] === gp && this.games[1] === gp && !(this.isFinalSet() && this.format.finalSet === FINAL_ADVANTAGE)) {
      this.startTiebreak(7);
      ev |= EV_TIEBREAK_START;
    }
    return ev;
  }

  private startTiebreak(target: number): void {
    this.tiebreak = true;
    this.tbTarget = target;
    this.tbFirstServer = this.server;
    for (let t = 0; t < 2; t++) this.tbSlot[t] = (this.firstServerSlot[t]! + this.serviceGames[t]!) % 2;
  }

  private setWonBy(): number {
    const a = this.games[0]!;
    const b = this.games[1]!;
    const gp = this.format.gamesPerSet;
    if (a >= gp && a - b >= 2) return 0;
    if (b >= gp && b - a >= 2) return 1;
    return -1;
  }

  /** Point score as broadcast text for each team, e.g. ["40", "AD"], ["Deuce 2", ""], ["5", "3"]. */
  display(): [string, string] {
    const a = this.points[0]!;
    const b = this.points[1]!;
    if (this.tiebreak) return [String(a), String(b)];
    const names = ['0', '15', '30', '40'];
    if (a < 3 || b < 3) {
      return [names[Math.min(a, 3)]!, names[Math.min(b, 3)]!];
    }
    if (a === b) {
      if (this.isDecidingPoint()) return this.format.mode === MODE_STAR ? ['Star point', ''] : ['Golden point', ''];
      return this.format.mode === MODE_STAR ? [`Deuce ${this.deuceCount()}`, ''] : ['Deuce', ''];
    }
    const adv = this.format.mode === MODE_STAR ? `AD ${Math.max(a, b) - 3}` : 'AD';
    return a > b ? [adv, ''] : ['', adv];
  }

  /** Flat numeric state for hashing and snapshots. */
  writeState(out: number[]): void {
    out.length = 0;
    out.push(this.points[0]!, this.points[1]!, this.games[0]!, this.games[1]!, this.sets[0]!, this.sets[1]!,
      this.server, this.setFirstServer, this.tiebreak ? 1 : 0, this.tbTarget, this.tbFirstServer, this.ends,
      this.winner, this.decidingSide, this.firstServerSlot[0]!, this.firstServerSlot[1]!, this.serviceGames[0]!,
      this.serviceGames[1]!, this.firstReceiverSlot[0]!, this.firstReceiverSlot[1]!, this.tbSlot[0]!, this.tbSlot[1]!,
      this.history.length);
    for (const [x, y] of this.history) out.push(x, y);
  }

  readState(s: number[]): void {
    this.points[0] = s[0]!; this.points[1] = s[1]!;
    this.games[0] = s[2]!; this.games[1] = s[3]!;
    this.sets[0] = s[4]!; this.sets[1] = s[5]!;
    this.server = s[6]!; this.setFirstServer = s[7]!;
    this.tiebreak = s[8] === 1; this.tbTarget = s[9]!; this.tbFirstServer = s[10]!;
    this.ends = s[11]!; this.winner = s[12]!; this.decidingSide = s[13]!;
    this.firstServerSlot[0] = s[14]!; this.firstServerSlot[1] = s[15]!;
    this.serviceGames[0] = s[16]!; this.serviceGames[1] = s[17]!;
    this.firstReceiverSlot[0] = s[18]!; this.firstReceiverSlot[1] = s[19]!;
    this.tbSlot[0] = s[20]!; this.tbSlot[1] = s[21]!;
    this.history.length = 0;
    const n = s[22]!;
    for (let i = 0; i < n; i++) this.history.push([s[23 + i * 2]!, s[24 + i * 2]!]);
  }
}
