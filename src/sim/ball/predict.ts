// Noise-free look-ahead of the ball's path (walls and net included). Players and the AI read it to find
// contact windows. Mesh and seam bounces are random in the real sim, so the path is re-predicted after
// every contact: reading a mesh rebound is as hard here as it is on a real court.
import { Ball, HIT_FLOOR, HIT_WALL, LEFT_COURT, type BallWorld } from './ball.ts';
import { DT } from '../core/constants.ts';

export const PRED_MAX = 480; // 4 s at 120 Hz

export const PF_WALL = 1;
export const PF_EXIT = 2;
export const PF_FLOOR = 4;
/** The ball is caught in the net (nobody can play it there, even where it bulges past the line). */
export const PF_NET = 8;

export class Prediction {
  readonly t = new Float64Array(PRED_MAX);
  readonly x = new Float64Array(PRED_MAX);
  readonly y = new Float64Array(PRED_MAX);
  readonly z = new Float64Array(PRED_MAX);
  readonly vx = new Float64Array(PRED_MAX);
  readonly vy = new Float64Array(PRED_MAX);
  readonly vz = new Float64Array(PRED_MAX);
  /** Floor bounces since the last strike, at this sample (includes bounces before the prediction started). */
  readonly bounces = new Int8Array(PRED_MAX);
  /** Walls touched since the last bounce/strike up to this sample. */
  readonly walls = new Int8Array(PRED_MAX);
  readonly flags = new Int8Array(PRED_MAX);
  n = 0;
  /** Sim time the prediction was made. */
  start = 0;
  /** Sim time of the strike this path comes from (set by the match before computing; how long a player has had). */
  strikeT = -10;
  /** Incremented on every recompute so consumers can cache by version. */
  version = 0;

  private readonly ghost = new Ball();

  /**
   * `wallsSoFar`: walls touched since the last bounce (a path re-predicted after the glass is still "off the
   * glass"). `startFlags`: contacts in the tick that ended at `now`, so sample 0 is marked as an impact.
   */
  compute(world: BallWorld, ball: Ball, now: number, bouncesSoFar: number, maxBounces = 2, wallsSoFar = 0, startFlags = 0): void {
    const g = this.ghost.copyFrom(ball);
    this.start = now;
    this.version++;
    let bounces = bouncesSoFar;
    let walls = wallsSoFar;
    let i = 0;
    // Sample 0 is the current state.
    this.write(0, now, g, bounces, walls, startFlags);
    for (i = 1; i < PRED_MAX; i++) {
      g.step(world, DT, null);
      let flags = 0;
      for (let k = 0; k < g.eventCount; k++) {
        const e = g.events[k]!;
        if (e.kind === HIT_FLOOR) { bounces++; walls = 0; flags |= PF_FLOOR; }
        else if (e.kind === HIT_WALL) { walls++; flags |= PF_WALL; }
        else if (e.kind === LEFT_COURT) flags |= PF_EXIT;
      }
      if (g.inNet) flags |= PF_NET;
      this.write(i, now + i * DT, g, bounces, walls, flags);
      if (bounces >= maxBounces || (flags & PF_EXIT) !== 0 || g.rolling) { i++; break; }
    }
    this.n = i;
  }

  private write(i: number, t: number, b: Ball, bounces: number, walls: number, flags: number): void {
    this.t[i] = t;
    this.x[i] = b.pos.x;
    this.y[i] = b.pos.y;
    this.z[i] = b.pos.z;
    this.vx[i] = b.vel.x;
    this.vy[i] = b.vel.y;
    this.vz[i] = b.vel.z;
    this.bounces[i] = bounces;
    this.walls[i] = walls;
    this.flags[i] = flags;
  }

  /** Index of the last sample at or before time t (clamped). */
  indexAt(t: number): number {
    const i = Math.floor((t - this.start) / DT + 1e-9);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
}
