// The display's frame period (Phase 8, Auto quality). While the page loads, the main thread mostly waits (the
// renderer starting, the players' download), so requestAnimationFrame's intervals then are the display's refresh, or
// the browser's own cap (a battery saver's 30 Hz). Game.adapt judges a frame slow against this period, so a steady
// 50 Hz screen or a 30 Hz cap isn't taken for a GPU that can't keep up. A hidden tab gets no frames: unknown (0).

const MAX = 90;
const gaps: number[] = [];
let last = 0;
let raf = 0;

/** Start sampling (main.ts, at the first line that runs). */
export function sampleDisplay(): void {
  if (raf || typeof requestAnimationFrame !== 'function') return;
  const loop = (t: number): void => {
    raf = 0;
    if (last > 0) gaps.push(t - last);
    last = t;
    if (gaps.length < MAX) raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

/** Stop sampling (a game is being built: its frames are no longer cheap). */
export function stopDisplaySample(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/**
 * The period in ms, or 0 when too few frames were seen. The lower quartile: frames that waited on a long task (the
 * script loading, the body's inflate) are whole multiples of the period and sit above it.
 */
export function displayPeriod(): number {
  if (gaps.length < 4) return 0;
  const s = gaps.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 4)]!;
}
