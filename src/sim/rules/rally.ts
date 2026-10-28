// Rally referee: turns ball contacts and racket/body hits into faults, lets and points.
// Rule numbers refer to the FIP Rules of Padel (application 01.01.2026).
import { SURF_GLASS, SURF_MESH } from '../court/court.ts';

export const R_NONE = 0;
export const R_POINT = 1;
export const R_FAULT = 2;
export const R_LET = 3;

// Reasons (index into REASON_TEXT).
export const WHY_DOUBLE_BOUNCE = 1; // 13.c
export const WHY_OWN_SIDE = 2; // 13.l: bounced on own side / into the net
export const WHY_WALL_BEFORE_BOUNCE = 3; // 13.g
export const WHY_OWN_MESH = 4; // 13.l
export const WHY_OUT = 5; // left the court without bouncing in
export const WHY_EXIT_AFTER_BOUNCE = 6; // 14.d: good bounce, then out of court
export const WHY_HIT_BODY_OPP = 7; // 13.k
export const WHY_HIT_BODY_OWN = 8; // 13.j
export const WHY_SERVE_OUT_OF_BOX = 9; // 7.1.c
export const WHY_SERVE_MESH = 10; // 7.1.e
export const WHY_SERVE_NET = 11; // serve into the net / own side
export const WHY_SERVE_MISSED = 12; // 7.1.b
export const WHY_SERVE_ABOVE_WAIST = 13; // 6.4
export const WHY_SERVE_LET = 14; // 9.2.a
export const WHY_RECEIVER_VOLLEYED_SERVE = 15; // 8.5
export const WHY_SERVE_DOOR = 16; // 7.1.f
export const WHY_SERVE_WALL_FIRST = 17; // serve must bounce in the box first
export const WHY_WHIFF = 18; // swung and missed: ball goes on to bounce twice

export const REASON_TEXT: readonly string[] = [
  '', 'Double bounce', 'Into the net', 'Hit the wall before bouncing', 'Hit own fence', 'Out',
  'Winner', 'Ball hit the player', 'Hit own partner', 'Fault: out of the box', 'Fault: touched the fence',
  'Fault: into the net', 'Fault: missed', 'Fault: above the waist', 'Let', 'Receiver volleyed the serve',
  'Fault: out through the door', 'Fault: hit the wall first', 'Missed',
];

export interface ServeBox {
  /** x range and z range of the target box (absolute court coordinates). */
  x0: number; x1: number; z0: number; z1: number;
}

export class Rally {
  /** Team that hit the ball last (-1 before the serve is struck). */
  hitter = -1;
  /** Half (+1 near, -1 far) of the team that hit last. */
  hitterSide = 0;
  isServe = false;
  crossed = false;
  bounces = 0;
  netTouched = false;
  pendingLet = false;
  /** Shots in this rally, including the serve. */
  shots = 0;

  result = R_NONE;
  /** Team that won the point (for R_POINT). */
  winner = -1;
  why = 0;

  readonly box: ServeBox = { x0: 0, x1: 0, z0: 0, z1: 0 };
  lineTolerance = 0.025;
  outOfCourtPlay = false;

  reset(): void {
    this.hitter = -1;
    this.hitterSide = 0;
    this.isServe = false;
    this.crossed = false;
    this.bounces = 0;
    this.netTouched = false;
    this.pendingLet = false;
    this.shots = 0;
    this.result = R_NONE;
    this.winner = -1;
    this.why = 0;
  }

  get over(): boolean {
    return this.result !== R_NONE;
  }

  private point(winner: number, why: number): void {
    if (this.over) return;
    this.result = R_POINT;
    this.winner = winner;
    this.why = why;
  }

  private fault(why: number): void {
    if (this.over) return;
    this.result = R_FAULT;
    this.why = why;
  }

  private letServe(): void {
    if (this.over) return;
    this.result = R_LET;
    this.why = WHY_SERVE_LET;
  }

  /** Lose the point for the team that hit last (or fault if it was the serve). */
  private hitterLoses(why: number, serveWhy: number): void {
    if (this.isServe) this.fault(serveWhy);
    else this.point(1 - this.hitter, why);
  }

  /** The receiving team failed to return a good ball. */
  private receiverLoses(why: number): void {
    if (this.isServe && this.pendingLet) this.letServe();
    else this.point(this.hitter, why);
  }

  // ---- inputs from the match ---------------------------------------------------------------

  /** A racket strike by `team` standing on half `side`. `contactHeight`/`waist` only matter for the serve. */
  onStrike(team: number, side: number, serve: boolean, contactHeight = 0, waist = 2): void {
    if (this.over) return;
    if (serve) {
      this.reset();
      this.isServe = true;
      this.hitter = team;
      this.hitterSide = side;
      this.shots = 1;
      if (contactHeight > waist) this.fault(WHY_SERVE_ABOVE_WAIST);
      return;
    }
    if (this.isServe && this.bounces === 0) {
      // 8.5: receiver touches the serve before it bounces: point to the server.
      this.point(this.hitter, WHY_RECEIVER_VOLLEYED_SERVE);
      return;
    }
    if (this.isServe && this.pendingLet) {
      this.letServe();
      return;
    }
    this.isServe = false;
    this.hitter = team;
    this.hitterSide = side;
    this.crossed = false;
    this.bounces = 0;
    this.netTouched = false;
    this.shots++;
  }

  /** The server swung at the dropped ball and missed it. */
  onServeMissed(): void {
    this.isServe = true;
    this.fault(WHY_SERVE_MISSED);
  }

  /** Called every tick with the ball's z so the referee knows when it crosses the net. */
  onBallZ(z: number): void {
    if (this.hitter < 0 || this.over) return;
    if (!this.crossed && z * this.hitterSide < 0) this.crossed = true;
  }

  onFloor(x: number, z: number): void {
    if (this.hitter < 0 || this.over) return;
    const ballSide = z >= 0 ? 1 : -1;
    if (!this.crossed || ballSide === this.hitterSide && this.bounces === 0) {
      // Never got over the net (13.l) / serve into the net.
      this.hitterLoses(WHY_OWN_SIDE, WHY_SERVE_NET);
      return;
    }
    this.bounces++;
    if (this.bounces === 1) {
      if (this.isServe) {
        const b = this.box;
        const t = this.lineTolerance;
        const inBox = x >= b.x0 - t && x <= b.x1 + t && z >= b.z0 - t && z <= b.z1 + t;
        if (!inBox) {
          this.fault(WHY_SERVE_OUT_OF_BOX);
          return;
        }
        if (this.netTouched) this.pendingLet = true;
      }
      return;
    }
    this.receiverLoses(WHY_DOUBLE_BOUNCE);
  }

  /** A wall contact. `wallSide` is the half of the court the touched wall section belongs to. */
  onWall(surface: number, wallSide: number): void {
    if (this.hitter < 0 || this.over) return;
    if (!this.crossed) {
      // Still on the hitter's side: own glass is legal (contrapared), own mesh is not (13.l).
      if (this.isServe) this.fault(WHY_SERVE_WALL_FIRST);
      else if (surface === SURF_MESH) this.point(1 - this.hitter, WHY_OWN_MESH);
      return;
    }
    if (this.bounces === 0) {
      // Crossed but touched a wall before bouncing in the opponent's court (13.g).
      if (wallSide === this.hitterSide && surface === SURF_GLASS && !this.isServe) return; // came back to own glass mid-air: still in flight
      this.hitterLoses(WHY_WALL_BEFORE_BOUNCE, WHY_SERVE_WALL_FIRST);
      return;
    }
    // After a good bounce, walls keep the ball in play (12.3), except the serve touching the mesh (7.1.e).
    if (this.isServe && surface === SURF_MESH) this.fault(WHY_SERVE_MESH);
  }

  onNet(): void {
    if (this.hitter < 0 || this.over) return;
    if (!this.crossed) this.netTouched = true;
  }

  /** The ball left the enclosure. */
  onExit(throughOpening: boolean): void {
    if (this.hitter < 0 || this.over) return;
    if (!this.crossed || this.bounces === 0) {
      this.hitterLoses(WHY_OUT, WHY_SERVE_OUT_OF_BOX);
      return;
    }
    if (this.isServe && throughOpening && !this.outOfCourtPlay) {
      this.fault(WHY_SERVE_DOOR);
      return;
    }
    // Good bounce then out of court: receivers could not (or may not) play it (14.d).
    this.receiverLoses(WHY_EXIT_AFTER_BOUNCE);
  }

  /** The ball touched a player's body (not the racket). */
  onBody(team: number): void {
    if (this.hitter < 0 || this.over) return;
    // 9.1: a serve that touched the net (or a post) is a "net" if it then lands in the box (9.1.a) or touches any
    // player (9.1.b), whoever it is: the serve is played again.
    if (this.isServe && this.netTouched && (this.pendingLet || this.bounces === 0)) {
      this.letServe();
      return;
    }
    if (team === this.hitter) {
      if (this.isServe) this.fault(WHY_HIT_BODY_OWN);
      else this.point(1 - team, WHY_HIT_BODY_OWN);
      return;
    }
    if (this.isServe && this.bounces === 0) {
      this.point(this.hitter, WHY_RECEIVER_VOLLEYED_SERVE);
      return;
    }
    this.point(this.hitter, WHY_HIT_BODY_OPP);
  }

  writeState(out: number[]): void {
    out.push(this.hitter, this.hitterSide, this.isServe ? 1 : 0, this.crossed ? 1 : 0, this.bounces,
      this.netTouched ? 1 : 0, this.pendingLet ? 1 : 0, this.shots, this.result, this.winner, this.why);
  }

  readState(s: number[], i: number): number {
    this.hitter = s[i++]!; this.hitterSide = s[i++]!; this.isServe = s[i++] === 1; this.crossed = s[i++] === 1;
    this.bounces = s[i++]!; this.netTouched = s[i++] === 1; this.pendingLet = s[i++] === 1; this.shots = s[i++]!;
    this.result = s[i++]!; this.winner = s[i++]!; this.why = s[i++]!;
    return i;
  }
}
