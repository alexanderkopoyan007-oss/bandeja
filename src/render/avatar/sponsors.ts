// The sponsors on a kit (16 Nov 2026, the owner on the shirts: "cloth looks plastic/fake", "the whole player looks bad"; beside
// Premier Padel players photographed that day, ours had a blank front where every pro's shirt carries a sponsor across the
// chest, a maker's mark, a sleeve sponsor and one over the shoulder blades). Every name here is made up: none is a real brand.
// The words are drawn once per team into a small texture, white on clear, one row a place; kit.ts `kitDetail` projects each
// row onto its place on the body and inks it in the kit's colours. Without a document (Node tests) there is no texture and the
// old block marks stand in.
import * as THREE from 'three/webgpu';

/** Invented sponsors: a coinage each, no company's name. */
export const SPONSORS = ['VELARIA', 'TRAMONTA', 'ORVALIA', 'SOLANDO', 'MAREDA', 'BRISEO', 'ZENTARA', 'CALDORA', 'NUVEXA', 'ALBERIO'];
/** The kit makers: the game's own racket makers (data/rackets.json), who dress their players too. */
export const MAKERS = ['QARRO', 'LUMBRA', 'VILANO', 'GRANZA', 'PALIQUE', 'ORZA'];

/** The texture's rows, bottom up (texture v): the chest's main sponsor, the second on the right breast, the back's, the sleeve's. */
export const SPONSOR_ROW = { chest: 0, breast: 1, back: 2, sleeve: 3 } as const;
export const SPONSOR_ROWS = 4;
/** Each row is this many times as wide as it is tall; every place on the body is given the same shape. */
export const SPONSOR_ASPECT = 4;

const SANS = '"Avenir Next Condensed", "Helvetica Neue", "Arial Narrow", "Segoe UI", Helvetica, Arial, sans-serif';
const W = 512, ROW_H = W / SPONSOR_ASPECT;
const cache = new Map<string, THREE.Texture>();

/** Which names a team wears, from its shirt's colour (partners share a shirt, so they share sponsors). */
export function sponsorsFor(shirt: number): { chest: string; breast: string; back: string; sleeve: string; maker: string } {
  let h = (shirt * 2654435761) >>> 0;
  const pick = (n: number): number => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h % n; };
  const a = pick(SPONSORS.length);
  let b = pick(SPONSORS.length - 1); if (b >= a) b++;
  let c = pick(SPONSORS.length - 2); for (const x of [a, b].sort((p, q) => p - q)) if (c >= x) c++;
  return { chest: SPONSORS[a]!, breast: SPONSORS[b]!, back: SPONSORS[c]!, sleeve: SPONSORS[b]!, maker: MAKERS[pick(MAKERS.length)]! };
}

/** The team's words, white on clear, one row a place (null without a document). */
export function sponsorTexture(shirt: number): THREE.Texture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const key = shirt.toString(16);
  const had = cache.get(key);
  if (had) return had;
  const s = sponsorsFor(shirt);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = ROW_H * SPONSOR_ROWS;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const row = (r: number, text: string, weight: number, fill: number): void => {
    // (canvas rows run down, texture v up: row r of the texture is the r-th from the canvas's bottom)
    const y = (SPONSOR_ROWS - 1 - r) * ROW_H + ROW_H / 2;
    let px = ROW_H * fill;
    ctx.font = `${weight} ${px}px ${SANS}`;
    const w = ctx.measureText(text).width;
    if (w > W * 0.92) { px *= (W * 0.92) / w; ctx.font = `${weight} ${px}px ${SANS}`; }
    ctx.fillText(text, W / 2, y + px * 0.04);
  };
  row(SPONSOR_ROW.chest, s.chest, 800, 0.9);
  row(SPONSOR_ROW.breast, s.breast, 700, 0.6);
  row(SPONSOR_ROW.back, s.back, 800, 0.85);
  row(SPONSOR_ROW.sleeve, s.sleeve, 700, 0.75);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}
