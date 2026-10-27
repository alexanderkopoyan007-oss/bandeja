// Timing grades: a swing release is judged against the ideal contact moment.

export const G_TOO_EARLY = 0;
export const G_EARLY = 1;
export const G_GOOD = 2;
export const G_PERFECT = 3;
export const G_LATE = 4;
export const G_TOO_LATE = 5;

export const GRADE_TEXT: readonly string[] = ['Too early', 'Early', 'Good', 'Perfect', 'Late', 'Too late'];

export interface TimingWindows {
  perfect: number;
  good: number;
  ok: number;
  /** Beyond this the swing cannot connect at all. */
  miss: number;
}

/** Grade a release `delta` seconds after the ideal moment (negative = early). `scale` widens windows (accessibility). */
export function gradeTiming(delta: number, w: TimingWindows, scale = 1): number {
  const a = Math.abs(delta) / scale;
  if (a <= w.perfect) return G_PERFECT;
  if (a <= w.good) return G_GOOD;
  if (a <= w.ok) return delta < 0 ? G_EARLY : G_LATE;
  return delta < 0 ? G_TOO_EARLY : G_TOO_LATE;
}

/** Contact quality 0..1 for a grade. */
export function gradeQuality(g: number): number {
  switch (g) {
    case G_PERFECT: return 1;
    case G_GOOD: return 0.82;
    case G_EARLY:
    case G_LATE: return 0.55;
    default: return 0.15;
  }
}
