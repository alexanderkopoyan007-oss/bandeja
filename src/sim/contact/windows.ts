// Contact windows: stretches of the predicted ball path a player standing at (px, pz) can reach.
// The ideal moment in each window is the best-placed sample (comfortable reach, good height).
// When the swing is released, the window whose ideal moment is nearest is the one being judged.
import { PF_NET, type Prediction } from '../ball/predict.ts';
import type { PlayerTuning } from '../player/player.ts';
import { abs, sqrt } from '../core/smath.ts';

export interface ContactWindow {
  start: number;
  end: number;
  ideal: number;
  idealIdx: number;
  /** Ball has not bounced yet in this window (volley). */
  volley: boolean;
  /** Ball has come off a wall since its bounce (or since the strike). */
  afterWall: boolean;
  height: number;
}

export const MAX_WINDOWS = 4;

export function makeWindows(): ContactWindow[] {
  const w: ContactWindow[] = [];
  for (let i = 0; i < MAX_WINDOWS; i++) {
    w.push({ start: 0, end: 0, ideal: 0, idealIdx: 0, volley: false, afterWall: false, height: 0 });
  }
  return w;
}

/** Cost of hitting at height y: 0 in the comfortable band, rising outside it. */
export function heightCost(y: number, overhead: number): number {
  if (y < 0.7) return (0.7 - y) * 1.6;
  if (y <= 1.3) return 0;
  if (y < overhead) return (y - 1.3) * 0.8;
  return 0.35 + (y - overhead) * 0.3;
}

/**
 * Cost of a volley at height y: a punch between the waist and the shoulders is the comfortable one; below the
 * tape it has to be lifted (a low volley), above the shoulders it turns into a high volley.
 */
export function volleyCost(y: number): number {
  if (y < 0.8) return (0.8 - y) * 1.4;
  if (y <= 1.45) return 0;
  return (y - 1.45) * 0.7;
}

/** Cost of taking the ball overhead at height y: best around the ideal overhead height, poor below it. */
export function overheadCost(y: number, t: PlayerTuning): number {
  if (y >= t.overheadHeight) return abs(y - t.overheadIdealHeight) * 0.8;
  return 0.4 + (t.overheadHeight - y) * 2;
}

/**
 * Fill `out` with up to MAX_WINDOWS windows for a player at (px, pz) on half `side`.
 * `mustBounce`: the ball may not be volleyed (receiving a serve). `overhead`: the player is going for an
 * overhead, so each window's ideal moment is the best overhead contact, not the most comfortable groundstroke.
 * `volley`: the player is holding the volley key, so a window before the bounce has its ideal at the best volley
 * height (windows after the bounce stay legal: a volley planned too late is blocked off the bounce instead).
 * Returns the window count.
 */
export function findWindows(
  pred: Prediction, px: number, pz: number, side: number, mustBounce: boolean, bouncesAllowed: number,
  t: PlayerTuning, out: ContactWindow[], fromTime: number, overhead = false, volley = false,
): number {
  let count = 0;
  let open = false;
  let bestCost = 1e9;
  for (let i = 0; i < pred.n; i++) {
    if (pred.t[i]! < fromTime) continue;
    const x = pred.x[i]!;
    const y = pred.y[i]!;
    const z = pred.z[i]!;
    const b = pred.bounces[i]!;
    const dx = x - px;
    const dz = z - pz;
    const d = sqrt(dx * dx + dz * dz);
    const legal = z * side > 0.05 && b <= bouncesAllowed && !(mustBounce && b === 0) && (pred.flags[i]! & PF_NET) === 0;
    // The ball reaches the body here: it hits the player, so nothing after this can be played from here.
    if (legal && d < t.bodyRadius + 0.035 && y < t.height) break;
    const ok = legal && d <= t.reachMax && y >= t.contactMinHeight && y <= t.contactMaxHeight;
    if (ok) {
      // A ball touching the floor or glass right now is not where anyone means to hit it.
      const cost = (overhead ? abs(d - t.overheadReach) + overheadCost(y, t)
        : abs(d - (b === 0 ? t.volleyReach : t.reachComfort)) + (volley && b === 0 ? volleyCost(y) : heightCost(y, t.overheadHeight))
          // Met in front of the body, not beside or behind it (a ball off the back glass passes the comfortable
          // distance once behind the player and once in front).
          + (side * (pz - z) < 0 ? -side * (pz - z) : 0))
        + (nearImpact(pred, i) ? 0.5 : 0);
      if (!open) {
        if (count >= MAX_WINDOWS) break;
        const w = out[count++]!;
        w.start = pred.t[i]!;
        w.end = pred.t[i]!;
        w.ideal = pred.t[i]!;
        w.idealIdx = i;
        w.volley = b === 0;
        w.afterWall = pred.walls[i]! > 0;
        w.height = y;
        open = true;
        bestCost = cost;
      } else {
        const w = out[count - 1]!;
        w.end = pred.t[i]!;
        if (cost < bestCost) {
          bestCost = cost;
          w.ideal = pred.t[i]!;
          w.idealIdx = i;
          w.afterWall = pred.walls[i]! > 0;
          w.height = y;
        }
      }
      // A bounce or wall contact inside a run starts a new window (a different ball to read).
      if (open && (pred.flags[i]! & 5) !== 0 && i > 0) open = false;
    } else {
      open = false;
    }
  }
  return count;
}

/** The ball touches the floor or a wall within 50 ms of sample i. */
export function nearImpact(pred: Prediction, i: number): boolean {
  const a = i < 6 ? 0 : i - 6;
  const b = i + 6 < pred.n ? i + 6 : pred.n - 1;
  for (let j = a; j <= b; j++) if ((pred.flags[j]! & 5) !== 0) return true;
  return false;
}
