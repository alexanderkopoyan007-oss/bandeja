// Cue and grade colours (Phase 8). The default is the look the owner approved (green Good, cyan Perfect, amber off
// time, red bad). The colour-safe set (Accessibility) keeps cyan and amber and moves Good to blue and bad to a dark
// vermilion, so a red-green colour-blind player can tell every grade apart by hue and brightness: under
// protanopia the default's green Good and amber Early/Late are ΔE 10.4 apart (the same yellow at a glance), and
// under deuteranopia its closest pair is Good and the red miss (ΔE 16.2; tests/app/palette.test.ts). The words
// (Perfect, Early...) are always shown with the colours.

export interface Palette {
  good: number;
  perfect: number;
  off: number;
  bad: number;
  /** The HUD's words have always been a shade apart from the rings' (amber #ffb13b, red #ff5a4f): kept. */
  textOff: number;
  textBad: number;
}

const DEFAULT: Palette = { good: 0x8fe36b, perfect: 0x5ff2ff, off: 0xffc04a, bad: 0xff5a4a, textOff: 0xffb13b, textBad: 0xff5a4f };
const SAFE: Palette = { good: 0x4fa3ff, perfect: 0x5ff2ff, off: 0xffd23f, bad: 0xe8590c, textOff: 0xffd23f, textBad: 0xe8590c };

/** Both sets, for the tests. */
export const PALETTES = { DEFAULT, SAFE } as const;

/** The colours in use (read every frame by the cues; changed only from the settings). */
export const PAL: Palette = { ...DEFAULT };

export function setSafeColours(on: boolean): void {
  Object.assign(PAL, on ? SAFE : DEFAULT);
}

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** A grade's colour (timing.ts grades: too early, early, good, perfect, late, too late); `text`: the HUD's shades. */
export function gradeColour(g: number, text = false): number {
  return g === 0 || g === 5 ? (text ? PAL.textBad : PAL.bad) : g === 1 || g === 4 ? (text ? PAL.textOff : PAL.off) : g === 2 ? PAL.good : PAL.perfect;
}
