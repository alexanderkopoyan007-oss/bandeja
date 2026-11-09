// A player's own racket colours (M5 phase D, the racket designer; app/character.ts RacketDesign): the racket they play keeps
// its maker's shape, holes and print layout, painted in their colours, graphic and finishes. How it plays is the racket's
// (data/rackets.json), whatever its colours.
import type { RacketLook } from './racket.ts';

/** A design as the character holds it: the graphic (racketArt.ts), the face's ground, the graphic's two colours, its
 * accent, the frame, the overgrip under any worn one, the face's and the frame's finish. CSS hex colours. */
export interface RacketColours {
  art: string; face: string; a: string; b: string; accent: string; frame: string; grip: string; finish: string; frameFinish: string;
}

/** The colours the designer offers (named, as a pad or keyboard steps through them). */
export const RACKET_PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Black', hex: '#111214' }, { name: 'Graphite', hex: '#3a3d42' }, { name: 'Silver', hex: '#b8bcc2' }, { name: 'White', hex: '#f2f2ef' },
  { name: 'Navy', hex: '#1d2738' }, { name: 'Royal', hex: '#2547c8' }, { name: 'Sky', hex: '#58a8e8' }, { name: 'Teal', hex: '#148f8a' },
  { name: 'Green', hex: '#2e9a48' }, { name: 'Lime', hex: '#a8d42c' }, { name: 'Yellow', hex: '#f2d02c' }, { name: 'Gold', hex: '#f2b84b' },
  { name: 'Orange', hex: '#f07a1f' }, { name: 'Red', hex: '#d42a2a' }, { name: 'Crimson', hex: '#9a1830' }, { name: 'Pink', hex: '#f04f9a' },
  { name: 'Violet', hex: '#6a3fc0' }, { name: 'Brown', hex: '#6b4426' }, { name: 'Sand', hex: '#d8c4a0' },
];

/** sRGB luminance (0..1) of a hex colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** sRGB 0..255 channels of a hex colour. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The palette's colour nearest `hex` (redmean distance, close to how far apart people see them). */
export function nearestPalette(hex: string): string {
  const [r, g, b] = rgb(hex);
  let best = RACKET_PALETTE[0]!.hex, bestD = Infinity;
  for (const p of RACKET_PALETTE) {
    const [r2, g2, b2] = rgb(p.hex);
    const rm = (r + r2) / 2, dr = r - r2, dg = g - g2, db = b - b2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = p.hex; }
  }
  return best;
}

/** A design to start from: the racket's own look in the palette's nearest colours (its graphic and finishes kept), so
 * choosing their own colours changes little until they change one. */
export function designFrom(look: RacketLook): RacketColours {
  const c = look.colours, n = nearestPalette;
  return {
    art: look.art, face: n(c.base), a: n(c.a), b: n(c.b), accent: n(c.accent), frame: n(c.frame), grip: n(look.grip),
    finish: look.finish, frameFinish: look.frameFinish,
  };
}

/** A short key for a design (FNV-1a of its values): what tells racket.ts's caches one painted racket from another. */
export function designKey(d: RacketColours): string {
  let h = 0x811c9dc5;
  for (const ch of [d.art, d.face, d.a, d.b, d.accent, d.frame, d.grip, d.finish, d.frameFinish].join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * `base` (the racket's own look) painted as `d` (null: as its maker painted it). The print's words take whichever of
 * white or near-black reads on the face; the third graphic colour, the finishing tape and the cap are the accent's; the
 * bumper is the frame's colour (as clear as the maker made it), so no maker's colour is left on someone's own design.
 */
export function designed(base: RacketLook, d: RacketColours | null | undefined): RacketLook {
  if (!d) return base;
  const text = luminance(d.face) > 0.35 ? '#141516' : '#f2f2ef';
  return {
    ...base,
    art: d.art,
    finish: d.finish,
    frameFinish: d.frameFinish,
    grip: d.grip,
    tape: d.accent,
    bumper: { ...base.bumper, colour: d.frame },
    colours: { ...base.colours, base: d.face, a: d.a, b: d.b, c: d.accent, accent: d.accent, frame: d.frame, text },
    design: designKey(d),
  };
}
