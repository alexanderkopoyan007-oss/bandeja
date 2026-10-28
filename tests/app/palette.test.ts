// Accessibility checks that can be measured without a player (Phase 8): the colour-safe grade palette under
// simulated colour blindness, and WCAG contrast of the menu's and HUD's panel text over any scene.
import { describe, expect, it } from 'vitest';
import { PALETTES, type Palette } from '../../src/ui/palette.ts';

// Machado, Oliveira & Fernandes 2009, "A physiologically-based model for simulation of color vision deficiency",
// severity 1.0 (dichromacy), applied to linear RGB.
const CVD: Record<string, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linRgb = (h: number): number[] => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => toLin(c / 255));
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function simulate(h: number, m: number[]): number[] {
  const [r, g, b] = linRgb(h) as [number, number, number];
  return [m[0]! * r + m[1]! * g + m[2]! * b, m[3]! * r + m[4]! * g + m[5]! * b, m[6]! * r + m[7]! * g + m[8]! * b].map(clamp01);
}

/** CIELAB (D65) from linear sRGB. */
function lab(c: number[]): number[] {
  const [r, g, b] = c as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const dE = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const GRADES = ['good', 'perfect', 'off', 'bad'] as const;

/** The closest two grades' colours (CIE76 ΔE) as seen with vision `m`. */
function closest(p: Palette, m: number[]): { pair: string; de: number } {
  let best = { pair: '', de: Infinity };
  for (let i = 0; i < GRADES.length; i++) {
    for (let j = i + 1; j < GRADES.length; j++) {
      const de = dE(lab(simulate(p[GRADES[i]!], m)), lab(simulate(p[GRADES[j]!], m)));
      if (de < best.de) best = { pair: `${GRADES[i]}/${GRADES[j]}`, de };
    }
  }
  return best;
}

// Two colours a glance tells apart as different categories, not merely "not identical" (a just-noticeable
// difference is about 2.3): the safe set keeps every pair at 25 or more for all three dichromacies.
const DISTINCT = 25;

describe('colour-safe grades', () => {
  for (const [name, m] of Object.entries(CVD)) {
    it(`tells every grade apart with ${name}`, () => {
      const c = closest(PALETTES.SAFE, m);
      expect(c.de, `${c.pair} ΔE ${c.de.toFixed(1)}`).toBeGreaterThanOrEqual(DISTINCT);
    });
  }

  it('is needed: the default set merges grades for red-green colour blindness', () => {
    // Measured: protanopia Good/Early-Late ΔE 10.4, deuteranopia Good/bad 16.2 (the reason the option exists).
    expect(closest(PALETTES.DEFAULT, CVD.protanopia!).de).toBeLessThan(DISTINCT);
    expect(closest(PALETTES.DEFAULT, CVD.deuteranopia!).de).toBeLessThan(DISTINCT);
  });
});

// WCAG 2.2 contrast. Panel text sits on a translucent panel over the 3D scene, so its contrast depends on what is
// behind: every grey from black to white and the arenas' saturated colours, through the panel's (and the menu's
// shade's) alpha. 1.4.3 asks 4.5:1 for normal text.
type Rgba = [number, number, number, number];
const rel = (c: number[]): number => {
  const [r, g, b] = c.map((v) => toLin(v / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const over = (top: Rgba, under: number[]): number[] => under.map((u, k) => top[k]! * top[3] + u * (1 - top[3]));
const ratio = (a: number[], b: number[]): number => {
  const la = rel(a), lb = rel(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const SCENES: number[][] = [];
for (let g = 0; g <= 255; g += 5) SCENES.push([g, g, g]);
// The arenas' floors, surrounds and boards (data/arenas.json), a bright sky and white lines.
for (const h of [0x2546c8, 0xc23a2c, 0x1b2a63, 0x2c56c0, 0x3f7d3d, 0x4a7c36, 0x2c5232, 0x9fc6ea, 0xf4f6f8]) SCENES.push([(h >> 16) & 255, (h >> 8) & 255, h & 255]);

/** The lowest contrast of `text` on `layers` (top first) over any scene. */
function worst(text: Rgba, layers: Rgba[]): number {
  let lo = Infinity;
  for (const s of SCENES) {
    let bg = s;
    for (let k = layers.length - 1; k >= 0; k--) bg = over(layers[k]!, bg);
    lo = Math.min(lo, ratio(over(text, bg), bg));
  }
  return lo;
}

const rgb = (h: number, a = 1): Rgba => [(h >> 16) & 255, (h >> 8) & 255, h & 255, a];
// The menu column sits over the left of the shade (rgba(5,7,10,.8) at the edge, .7 at 34%; .7 all over on a narrow
// screen): the lighter end.
const SHADE = rgb(0x05070a, 0.7);
const MENU_GLASS = rgb(0x090c11, 0.74);
const HUD_GLASS = rgb(0x090c11, 0.66);
// High-contrast panels (settings.contrast; the :root.hc rules in hud.ts and menu.ts).
const HC_GLASS = rgb(0x090c11, 0.94);
const HC_SHADE = rgb(0x05070a, 0.9);
const HC_BACKING = rgb(0x090c11, 0.9);

const hexOf = (h: number): string => `#${h.toString(16).padStart(6, '0')}`;
// A call's subtitle takes the call's accent (hud.ts showCall): white, gold, cyan and the grade text colours.
const ACCENTS = [0xffffff, 0xffd84a, 0x5ff2ff, PALETTES.DEFAULT.good, PALETTES.DEFAULT.textBad, PALETTES.DEFAULT.textOff,
  PALETTES.SAFE.good, PALETTES.SAFE.textBad, PALETTES.SAFE.textOff];
// The loose words over the court: the grade word takes the grade colours (26 px bold: large text, 3:1); the shot and
// partner lines are light grey (13 px).
const GRADE_WORD = [PALETTES.DEFAULT.good, PALETTES.DEFAULT.perfect, PALETTES.DEFAULT.textOff, PALETTES.DEFAULT.textBad,
  PALETTES.SAFE.good, PALETTES.SAFE.textOff, PALETTES.SAFE.textBad];
const LINES = [0xe6ebef, 0xcfd6dc];

const CASES: { what: string; text: Rgba; on: Rgba[]; min?: number }[] = [
  { what: 'menu item', text: rgb(0xdfe5ea), on: [MENU_GLASS, SHADE] },
  { what: 'menu item, focused', text: rgb(0xffffff), on: [rgb(0xffffff, 0.14), SHADE] },
  { what: 'menu group label', text: rgb(0xffffff, 0.72), on: [SHADE] },
  { what: 'menu description', text: rgb(0xd3d9de), on: [SHADE] },
  { what: 'menu sub-title (accent)', text: rgb(0xffd84a), on: [SHADE] },
  { what: 'primary button', text: rgb(0x111111), on: [rgb(0xffb13b, 0.9)] },
  { what: 'side card cell', text: rgb(0xcfd6dc), on: [MENU_GLASS, rgb(0x05070a, 0.08)] },
  { what: 'side card hint', text: rgb(0xffffff, 0.72), on: [MENU_GLASS, rgb(0x05070a, 0.08)] },
  { what: 'score bug', text: rgb(0xcfd6dc), on: [rgb(0x0a0c10, 0.82)] },
  { what: 'score bug points', text: rgb(0x111111), on: [rgb(0xf4d03f)] },
  { what: 'hint pill', text: rgb(0xe9f6ff), on: [HUD_GLASS] },
  { what: 'help panel', text: rgb(0xdfe5ea), on: [HUD_GLASS] },
  { what: 'between-points card', text: rgb(0xdfe5ea), on: [HUD_GLASS] },
  { what: 'call title', text: rgb(0xffffff), on: [HUD_GLASS] },
  // High-contrast panels: everything, the coloured call subtitles and the loose words included.
  { what: 'high contrast: menu group label', text: rgb(0xffffff, 0.72), on: [HC_SHADE] },
  ...ACCENTS.map((h) => ({ what: `high contrast: call subtitle ${hexOf(h)}`, text: rgb(h), on: [HC_GLASS] })),
  ...GRADE_WORD.map((h) => ({ what: `high contrast: grade word ${hexOf(h)}`, text: rgb(h), on: [HC_BACKING], min: 3 })),
  ...LINES.map((h) => ({ what: `high contrast: shot line ${hexOf(h)}`, text: rgb(h), on: [HC_BACKING] })),
];

describe('panel text contrast (WCAG 1.4.3: 4.5:1, large text 3:1)', () => {
  for (const c of CASES) {
    it(c.what, () => {
      const r = worst(c.text, c.on);
      expect(r, `${c.what} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(c.min ?? 4.5);
    });
  }

  it('standard panels: the coloured call subtitles are why the high-contrast setting exists', () => {
    // The approved look keeps the accents on 66% glass; over a white backdrop (sky, a lit wall) the worst drop to
    // about 1.8:1 (safe dark orange) and 2.1:1 (red). Over the arenas' own colours they hold more.
    const lows = ACCENTS.map((h) => worst(rgb(h), [HUD_GLASS]));
    expect(Math.min(...lows)).toBeLessThan(4.5);
  });
});
