// What the QA oracles see of a match (Phase 7): plain facts in the words of the FIP Rules of Padel, with no game
// types in them. tools/qa/army.ts turns the sim's events into these; the referee and score oracles judge them from
// the rules alone (they are written without reading src/sim/rules), so a disagreement with the game is a bug in one
// of the two, never an agreement by construction.
//
// Axes: x across the court (left -, right + as seen from the z > 0 end), y up, z along it; the net is z = 0.

/** A half of the court: +1 is z > 0, -1 is z < 0. */
export type Half = 1 | -1;

export type Wall = 'backNear' | 'backFar' | 'sideLeft' | 'sideRight';

/** The box a serve must land in, seen from the server facing the net: 'right' is the first point of a game. */
export type ServeSide = 'right' | 'left';

export interface CourtFacts {
  /** Inside dimensions (m): x spans [-width/2, width/2], z spans [-length/2, length/2]. */
  width: number;
  length: number;
  /** Distance of each service line from the net (m). */
  serviceLineFromNet: number;
  /** Line width (m): lines are good (7.1.c), so a bounce touching a line counts as in. */
  lineWidth: number;
  /** Door openings in the side walls: z ranges and height (m), the same on both side walls. */
  doors: Array<{ z0: number; z1: number; height: number }>;
  /** Out-of-court play authorised on this court (rule 16, the court's safety area). */
  outOfCourtPlay: boolean;
}

export interface MatchFacts {
  doubles: boolean;
  court: CourtFacts;
}

/**
 * One thing that happened, in order. Players are numbered 0..3: team = player % 2, the partner of p is p ^ 2
 * (singles: 0 and 1). The facts of one serve attempt start with `serve` and end where the rules decide it.
 */
export type Fact =
  /** A serve attempt begins: the server has the ball. `half` is the half the serving team defends now. */
  | { k: 'serve'; server: number; receiver: number; half: Half; side: ServeSide }
  /** The server drops the ball to bounce it before the serve (6.2). */
  | { k: 'toss'; player: number }
  /**
   * A racket strike. `serve` is the serve's strike. `half` is the half the striker's team defends; (x, y, z) is
   * the ball at contact; `waist` the striker's waist height (6.4); `outside` the striker is outside the
   * enclosure (13.1.p, 14.1.j); `feetOk` the server's feet were legal for 6.1-6.3 (only meaningful on a serve).
   */
  | { k: 'strike'; player: number; serve: boolean; half: Half; x: number; y: number; z: number; waist: number; outside: boolean; feetOk: boolean }
  /** A swing that missed the ball. Only a serve's miss has a rule (7.1.b). */
  | { k: 'whiff'; player: number; serve: boolean }
  /** The ball bounced on the court's floor (inside the enclosure). */
  | { k: 'floor'; x: number; z: number }
  /** The ball touched the inside of a wall: glass (or any wall) or the metallic mesh fence (12.4: mesh and frame). */
  | { k: 'wall'; surface: 'glass' | 'mesh'; wall: Wall; x: number; y: number; z: number }
  /** The ball touched the net, its tape/cable, or a net post. */
  | { k: 'net'; part: 'net' | 'tape' | 'post'; x: number; y: number; z: number }
  /** The ball passed over or round the net into this half. */
  | { k: 'cross'; to: Half }
  /** The ball left the enclosure: through a door opening, or over a wall. */
  | { k: 'exit'; door: boolean; wall: Wall; x: number; y: number; z: number }
  /** The ball came back into the enclosure from outside (out-of-court play). */
  | { k: 'enter'; door: boolean; wall: Wall }
  /** Outside the enclosure: the ball bounced on the ground. */
  | { k: 'floorOutside'; x: number; z: number }
  /** Outside the enclosure: the ball touched the outside of the court's walls or mesh. */
  | { k: 'outerWall'; wall: Wall }
  /** The ball touched anything not related to the court (stands, lights, ceiling, another court). */
  | { k: 'object' }
  /** The ball touched a player's body or clothing (not the racket). */
  | { k: 'body'; player: number }
  /** A player touched the net or posts, or the opponents' court (13.1.a). */
  | { k: 'playerTouch'; player: number; what: 'net' | 'opponentCourt' }
  /** The ball got stuck in a hole in the mesh, or came to rest on the flat top of a wall (15.1). */
  | { k: 'stuck'; where: 'meshHole' | 'wallTop'; wall: Wall };

/** What the rules decide about a serve attempt. */
export interface Call {
  /** 'point': the point is over (a double fault is a point); 'fault': a first-serve fault; 'let': replay the serve. */
  result: 'point' | 'fault' | 'let';
  /** For 'point': the team (0 or 1) that won it. */
  winner: number;
  /** The rule that decided it, as numbered in the FIP text (e.g. '13.1.c', '7.1.e', '9.1.a'). */
  rule: string;
}

/** Scoring choices the rules leave to the players. */
export interface Choices {
  /** At the start of every set (doubles): which slot (0 = the player numbered team, 1 = team + 2) of each team serves its first game. */
  firstServerSlot?: [number, number];
  /** At the start of every set (doubles): which slot of each team receives the first point of each game (8.2). */
  firstReceiverSlot?: [number, number];
  /** At a deciding point (Golden / Star Point): the box the receiving pair chose. */
  decidingSide?: ServeSide;
}

export type ScoringMode = 'advantage' | 'star' | 'golden';
/** How the deciding set is played: like the others; without a tie-break (two clear games); or replaced by a tie-break to 7 or a super tie-break to 10. */
export type FinalSet = 'normal' | 'advantage' | 'tiebreak7' | 'supertb10';

export interface Format {
  mode: ScoringMode;
  /** Sets needed to win the match (2: best of three). */
  setsToWin: number;
  /** Games to win a set: 6, or 4 for mini sets. */
  gamesPerSet: number;
  finalSet: FinalSet;
  doubles: boolean;
  /** Team serving the match's first game; and which halves the teams start on. */
  firstServerTeam: number;
  team0Half: Half;
}

/** The score as the rules see it, after any number of points. */
export interface ScoreState {
  /** Points in the current game (or tie-break), per team, as counts. */
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  /** Completed sets' game counts, per team. */
  history: Array<[number, number]>;
  tiebreak: boolean;
  over: boolean;
  /** Winning team once over, else -1. */
  winner: number;
  /** Next point: serving team and player, receiving player, and the box the serve goes to. */
  serverTeam: number;
  server: number;
  receiver: number;
  side: ServeSide;
  /** Next point is a Golden / Star deciding point (receivers chose `side`). */
  deciding: boolean;
  /** The half each team defends for the next point. */
  halves: [Half, Half];
}
