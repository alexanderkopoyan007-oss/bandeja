// A racket's printed graphics (render/avatar/racket.ts): two canvases per racket.
// - The head: the face's print at 4.2 px/mm (a close-up filling a 1080p frame is about 4 px/mm; both faces: the back
//   mirrors it, so it reads the same from either side), the band round it, the finishing tape's print and the butt
//   cap's logo; and a quarter-size mask beside it (red: gloss print, green: metallic foil, blue: where the holes are,
//   which the far level of detail shows as holes instead of drilling them).
// - The frame's sides: one strip for each half of the outline (bottom of the neck to the tip, tip back down), laid out
//   piecewise along it (`sideLayout`) so the type along each side and the protector's print over the tip get about
//   8 and 4 px/mm and the plain runs between them less.
//
// Generic, original designs only: the maker's mark is the game's own (BANDEJA, a ball over a tilted tray), the model
// names are made up, and the four graphics (teal chevrons, a tide wave, a split panel, orbit rings) copy no real
// racket. Type is the system's sans-serif (nothing downloaded), drawn upright and slanted by a skew of our own, so it
// is the same slant on every system (a synthesised italic would differ).
import * as THREE from 'three/webgpu';
import type { RacketLook } from './racket.ts';

type V2 = [number, number];

export interface ArtShape {
  outer: V2[];
  face: V2[];
  heart: V2[];
  bridgeTop: number;
  bridgeBottom: number;
  perimeter: number;
  /** Hole centres and the radius of each hole's edge on the face (with its chamfer). */
  holes: V2[];
  holeEdge: number;
  /** The middle of the bridge's raised plate (y). */
  plateY: number;
  /** Arc length across the frame's profile from face to face (m). */
  profile: number;
}

/** Pixels per metre on the face, the canvas's half width (m) and the face's top row (y, m). */
const PXM = 4200;
const HW = 0.1352;
const TOP = 0.145;
const W = Math.round(2 * HW * PXM);
/** The head's print reaches down the neck into the finishing tape (y -0.1665: row 1308); the tape and the cap's logo below. */
const TAPE = { x: 8, y: 1316, w: 970, h: 128 };
const LOGO = { x: 1000, y: 1316, w: 128, h: 128 };
const H = 1448;
/** The mask is drawn at this share of the colour canvas's size. */
const MASK = 0.25;
/** The frame's sides: two strips (the outline's halves), each SIDE_SH rows across the profile. */
const SIDE_W = 2048;
const SIDE_SH = 224;
const SIDE_A = { y: 0, h: SIDE_SH };
const SIDE_B = { y: SIDE_SH + 8, h: SIDE_SH };
const SIDE_H = 2 * SIDE_SH + 8;

/**
 * How the frame's side print is laid out along the outline: each half (from the bottom of the neck to the tip, and
 * from the tip back down) maps arc length to the strip piecewise linearly (`knots`: [arc length along the half (m), u]),
 * with the type's window (`text` centres along each half, `win` long) and the protector's span (`span`, centred on the
 * tip) given more of the strip than the runs between.
 */
export interface SideLayout {
  L: number;
  span: number;
  text: [number, number];
  win: number;
  knots: [Array<[number, number]>, Array<[number, number]>];
}

export function sideLayout(s: ArtShape, span: number): SideLayout {
  const L = s.perimeter, Lh = L / 2;
  // The side free for type: from where the right side reaches y = -0.06 going up (the arm has become the head) to
  // where the protector starts.
  let acc = 0, sLow = 0.13;
  for (let i = 1; i < s.outer.length; i++) {
    const a = s.outer[i - 1]!, b = s.outer[i]!;
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (b[0] > 0 && a[1] < -0.06 && b[1] >= -0.06) { sLow = acc; break; }
  }
  const sTop = Lh - span / 2;
  const win = Math.max(0.05, Math.min(0.11, sTop - sLow - 0.01));
  const tA = (sLow + sTop) / 2;
  // Shares of the strip: the type 0.4, the protector 0.3, the plain runs 0.3 by their lengths.
  const r0 = tA - win / 2, r1 = sTop - (tA + win / 2), rest = r0 + r1;
  const u0 = (0.3 * r0) / rest, u1 = u0 + 0.4, u2 = u1 + (0.3 * r1) / rest;
  const kA: Array<[number, number]> = [[0, 0], [r0, u0], [r0 + win, u1], [sTop, u2], [Lh, 1]];
  // The other half mirrors it (it runs from the tip back down the left side).
  const kB = kA.map(([sv, u]) => [Lh - sv, 1 - u] as [number, number]).reverse();
  return { L, span, text: [tA, Lh - tA], win, knots: [kA, kB] };
}

/** u (0..1 along the strip) at `sh` metres along half `half`. */
function warp(lay: SideLayout, half: number, sh: number): number {
  const k = lay.knots[half]!;
  if (sh <= 0) return 0;
  for (let i = 1; i < k.length; i++) {
    if (sh <= k[i]![0]) {
      const a = k[i - 1]!, b = k[i]!;
      return a[1] + ((b[1] - a[1]) * (sh - a[0])) / Math.max(1e-9, b[0] - a[0]);
    }
  }
  return 1;
}

/** Where things are on the canvases, as texture coordinates (v up: canvases are uploaded flipped). */
export const ART = {
  W, H, SIDE_W, SIDE_H,
  headU: (x: number): number => (x + HW) / (2 * HW),
  headV: (y: number): number => 1 - ((TOP - y) * PXM) / H,
  /**
   * The frame's side at arc length `s` round the outline (from the bottom of the neck, counter-clockwise) and `v`
   * across the profile (0 back .. 1 front); `half` 0 up to the tip, 1 after it (the tip belongs to both).
   */
  sideUv: (lay: SideLayout, s: number, v: number, half: number): [number, number] => {
    const r = half ? SIDE_B : SIDE_A;
    const u = warp(lay, half, s - half * lay.L * 0.5);
    return [u, 1 - (r.y + (1 - v) * r.h) / SIDE_H];
  },
  tapeUv: (u: number, v: number): [number, number] => [(TAPE.x + u * TAPE.w) / W, 1 - (TAPE.y + (1 - v) * TAPE.h) / H],
  logoUv: (u: number, v: number): [number, number] => [(LOGO.x + u * LOGO.w) / W, 1 - (LOGO.y + (1 - v) * LOGO.h) / H],
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Cnv = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): Cnv | null {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

const px = (x: number): number => (x + HW) * PXM;
const py = (y: number): number => (TOP - y) * PXM;
const mm = (v: number): number => v * PXM;

/** Mask colour: gloss print (0 matte .. 1 gloss) and metallic foil. */
function maskCol(gloss: number, metal: number): string {
  return `rgb(${Math.round(gloss * 255)},${Math.round(metal * 255)},0)`;
}

const SANS = '"Avenir Next", "Helvetica Neue", "Segoe UI", Helvetica, Arial, Roboto, "Noto Sans", sans-serif';
/** The slant of the model names (a skew, about 11 degrees). */
const SLANT = 0.2;

/** Draws every element on the colour canvas and, in mask colours, on the mask. */
class Painter {
  readonly c: Ctx;
  readonly m: Ctx;
  constructor(c: Ctx, m: Ctx) {
    this.c = c;
    this.m = m;
  }
  /** `draw(ctx, mask)`: draw once with real colours, once into the mask (the caller picks its colours by `mask`). */
  both(draw: (ctx: Ctx, mask: boolean) => void): void {
    this.c.save();
    draw(this.c, false);
    this.c.restore();
    this.m.save();
    draw(this.m, true);
    this.m.restore();
  }
}

function path(ctx: Ctx, pts: V2[]): void {
  ctx.beginPath();
  ctx.moveTo(px(pts[0]![0]), py(pts[0]![1]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i]![0]), py(pts[i]![1]));
  ctx.closePath();
}

function poly(ctx: Ctx, pts: V2[]): void {
  path(ctx, pts);
  ctx.fill();
}

function leftNormals(pl: V2[]): V2[] {
  const m = pl.length;
  return pl.map((_, i) => {
    const a = pl[(i - 1 + m) % m]!, b = pl[(i + 1) % m]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as V2;
  });
}

function offsetLoop(pl: V2[], d: number): V2[] {
  const n = leftNormals(pl);
  return pl.map((p, i) => [p[0] + n[i]![0] * d, p[1] + n[i]![1] * d] as V2);
}

/** Text with even letter spacing (`track`, px), centred on (x, y) px, rotated by `rot`, slanted by `skew`. */
function spaced(ctx: Ctx, text: string, x: number, y: number, track: number, rot = 0, stroke = false, skew = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (skew) ctx.transform(1, 0, -skew, 1, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cx = -total / 2;
  for (let i = 0; i < chars.length; i++) {
    if (stroke) ctx.strokeText(chars[i]!, cx, 0);
    ctx.fillText(chars[i]!, cx, 0);
    cx += widths[i]! + track;
  }
  ctx.restore();
}

/** The maker's mark: a ball over a tilted tray (BANDEJA is the tray shot). `s`: its width (px). */
function emblem(ctx: Ctx, x: number, y: number, s: number, fill: string, cut?: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  // The tray: a slanted bar with rounded ends, rising to the right.
  ctx.rotate(-0.38);
  const bw = s, bh = s * 0.2;
  ctx.beginPath();
  ctx.moveTo(-bw / 2 + bh / 2, bh * 0.1);
  ctx.lineTo(bw / 2 - bh / 2, bh * 0.1);
  ctx.arc(bw / 2 - bh / 2, bh * 0.6, bh / 2, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-bw / 2 + bh / 2, bh * 1.1);
  ctx.arc(-bw / 2 + bh / 2, bh * 0.6, bh / 2, Math.PI / 2, -Math.PI / 2);
  ctx.fill();
  // The ball, over the tray's high end, with its seam as a cut.
  ctx.beginPath();
  ctx.arc(bw * 0.22, -s * 0.24, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  if (cut) {
    ctx.strokeStyle = cut;
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(bw * 0.22 - s * 0.24, -s * 0.24, s * 0.2, -0.75, 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bw * 0.22 + s * 0.24, -s * 0.24, s * 0.2, Math.PI - 0.75, Math.PI + 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/** The wordmark: BANDEJA, wide and heavy, tracked out; `h`: cap height (m). */
function wordmark(ctx: Ctx, x: number, y: number, h: number, fill: string, rot = 0): void {
  ctx.fillStyle = fill;
  ctx.font = `800 ${Math.round(mm(h) * 1.38)}px ${SANS}`;
  spaced(ctx, 'BANDEJA', px(x), py(y), mm(h) * 0.42, rot);
}

/** A carbon twill (2/2, tows about 2 mm) as a pattern of shaded tows. */
function twill(ctx: Ctx, dark: string, light: string): CanvasPattern | string {
  const t = 10, n = 4;
  const c = makeCanvas(t * n, t * n);
  if (!c) return dark;
  const g = c.getContext('2d') as Ctx;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const horizontal = ((i + j) & 3) < 2;
      const x = i * t, y = j * t;
      const gr = horizontal ? g.createLinearGradient(x, y, x, y + t) : g.createLinearGradient(x, y, x + t, y);
      gr.addColorStop(0, dark);
      gr.addColorStop(0.5, light);
      gr.addColorStop(1, dark);
      g.fillStyle = gr;
      g.fillRect(x, y, t, t);
      // Each tow's own fibres: fine lines along it.
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 0.6;
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        if (horizontal) { g.moveTo(x, y + (k * t) / 4); g.lineTo(x + t, y + (k * t) / 4); } else { g.moveTo(x + (k * t) / 4, y); g.lineTo(x + (k * t) / 4, y + t); }
        g.stroke();
      }
    }
  }
  return ctx.createPattern(c as unknown as CanvasImageSource, 'repeat') ?? dark;
}

interface Style {
  /** The face's print, clipped to the face (the base is already filled). */
  face(p: Painter, look: RacketLook, s: ArtShape, faceGloss: number): void;
}

const C = (look: RacketLook): RacketLook['colours'] => look.colours;

/** BRASA: black carbon, a chevron pointing to the throat in the look's two colours, foil pinlines. */
const ember: Style = {
  face(p, look, s, fg) {
    const c = C(look);
    p.both((ctx, m) => {
      ctx.fillStyle = m ? maskCol(fg, 0) : twill(ctx, '#121315', '#2b2d31');
      path(ctx, s.face);
      ctx.fill();
      if (!m) {
        // Smoke over the carbon towards the top.
        const g = ctx.createLinearGradient(0, py(0.14), 0, py(0.0));
        g.addColorStop(0, 'rgba(0,0,0,0.55)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, py(0));
      }
    });
    // The chevron: a broad band in a gradient of the look's two colours, and a thin second band under it.
    const band = (yTop: number, yApex: number, w: number): V2[] => [[-0.15, yTop], [0, yApex], [0.15, yTop], [0.15, yTop - w], [0, yApex - w], [-0.15, yTop - w]];
    p.both((ctx, m) => {
      if (m) ctx.fillStyle = maskCol(fg, 0);
      else {
        const g = ctx.createLinearGradient(0, py(0.1), 0, py(-0.08));
        g.addColorStop(0, c.a);
        g.addColorStop(1, c.b);
        ctx.fillStyle = g;
      }
      poly(ctx, band(0.1, -0.022, 0.05));
      if (!m) ctx.fillStyle = c.b;
      poly(ctx, band(0.034, -0.084, 0.008));
      // Foil pinlines along the chevron's top edge and between the bands.
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      poly(ctx, band(0.1 + 0.0062, -0.022 + 0.0062, 0.0011));
      poly(ctx, band(0.1 - 0.05 - 0.0035, -0.022 - 0.05 - 0.0035, 0.0007));
      // Facets: darker triangles on the chevron's arms (a folded-paper look).
      if (!m) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        poly(ctx, [[0.15, 0.1], [0.06, 0.05], [0.15, 0.05]]);
        poly(ctx, [[-0.15, 0.1], [-0.06, 0.05], [-0.15, 0.05]]);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        poly(ctx, [[0, -0.022], [0.035, 0.0], [0, -0.072]]);
      }
    });
    // Type: the model large in the open carbon above the chevron, the maker above it, the spec line under the point.
    p.both((ctx, m) => {
      ctx.fillStyle = m ? maskCol(1, 0) : c.text;
      ctx.font = `900 ${Math.round(mm(0.033))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(0.057), mm(0.0016), 0, false, SLANT);
      wordmark(ctx, 0, -0.043, 0.0072, m ? maskCol(1, 0) : c.text);
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      ctx.font = `600 ${Math.round(mm(0.0034))}px ${SANS}`;
      spaced(ctx, look.line, px(0), py(-0.0585), mm(0.0006));
    });
  },
};

/** MAREA: white, a deep tide rising across the lower face with white swell lines. */
const tide: Style = {
  face(p, look, s, fg) {
    const c = C(look);
    const wave = (x: number, d = 0): number => -0.012 + d + 0.024 * Math.sin((x / 0.26) * Math.PI * 2 + 0.9) + 0.008 * Math.sin((x / 0.26) * Math.PI * 5);
    const waveFill = (d: number): V2[] => {
      const out: V2[] = [];
      for (let k = 0; k <= 60; k++) { const x = -0.15 + (0.3 * k) / 60; out.push([x, wave(x, d)]); }
      out.push([0.15, -0.2], [-0.15, -0.2]);
      return out;
    };
    const waveLine = (d: number, w: number): V2[] => {
      const out: V2[] = [];
      for (let k = 0; k <= 60; k++) { const x = -0.15 + (0.3 * k) / 60; out.push([x, wave(x, d)]); }
      for (let k = 60; k >= 0; k--) { const x = -0.15 + (0.3 * k) / 60; out.push([x, wave(x, d) - w]); }
      return out;
    };
    p.both((ctx, m) => {
      if (m) ctx.fillStyle = maskCol(fg, 0);
      else {
        const g = ctx.createRadialGradient(px(0), py(0.04), mm(0.02), px(0), py(0.04), mm(0.16));
        g.addColorStop(0, c.base);
        g.addColorStop(1, '#d9dee4');
        ctx.fillStyle = g;
      }
      path(ctx, s.face);
      ctx.fill();
      if (!m) {
        const g = ctx.createLinearGradient(px(-0.12), py(0.02), px(0.1), py(-0.1));
        g.addColorStop(0, c.b);
        g.addColorStop(0.55, c.a);
        g.addColorStop(1, '#06162e');
        ctx.fillStyle = g;
      }
      poly(ctx, waveFill(0));
      // Swell lines inside the tide, thinning with depth; a teal line riding above it.
      ctx.fillStyle = m ? maskCol(1, 0) : 'rgba(255,255,255,0.92)';
      poly(ctx, waveLine(-0.007, 0.0016));
      if (!m) ctx.fillStyle = 'rgba(255,255,255,0.6)';
      poly(ctx, waveLine(-0.016, 0.0009));
      if (!m) ctx.fillStyle = 'rgba(255,255,255,0.35)';
      poly(ctx, waveLine(-0.024, 0.0006));
      ctx.fillStyle = m ? maskCol(1, 0) : c.b;
      poly(ctx, waveLine(0.009, 0.0022));
      if (!m) ctx.fillStyle = c.c;
      poly(ctx, waveLine(0.0145, 0.0008));
    });
    p.both((ctx, m) => {
      wordmark(ctx, 0, 0.0905, 0.0078, m ? maskCol(1, 0) : c.a);
      ctx.fillStyle = m ? maskCol(1, 0) : c.b;
      ctx.font = `600 ${Math.round(mm(0.0032))}px ${SANS}`;
      spaced(ctx, look.line, px(0), py(0.0795), mm(0.0006));
      ctx.fillStyle = m ? maskCol(1, 0) : '#ffffff';
      ctx.font = `900 ${Math.round(mm(0.03))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(-0.05), mm(0.0018), 0, false, SLANT);
    });
  },
};

/** CIERZO: pearl, a cobalt panel split on a slant, lime cuts and shards. */
const split: Style = {
  face(p, look, s, fg) {
    const c = C(look);
    const edge: V2[] = [[0.045, 0.16], [-0.06, -0.2]];
    const along = (t: number, d: number): V2 => {
      const dx = edge[1]![0] - edge[0]![0], dy = edge[1]![1] - edge[0]![1], l = Math.hypot(dx, dy);
      return [edge[0]![0] + dx * t + (dy / l) * d, edge[0]![1] + dy * t - (dx / l) * d];
    };
    p.both((ctx, m) => {
      if (m) ctx.fillStyle = maskCol(fg, 0);
      else {
        const g = ctx.createLinearGradient(px(0.13), py(0.13), px(-0.05), py(-0.1));
        g.addColorStop(0, '#f6f7f9');
        g.addColorStop(1, '#cfd4dc');
        ctx.fillStyle = g;
      }
      path(ctx, s.face);
      ctx.fill();
      if (!m) {
        const g = ctx.createLinearGradient(px(-0.13), py(0.1), px(0.02), py(-0.1));
        g.addColorStop(0, c.a);
        g.addColorStop(1, c.b);
        ctx.fillStyle = g;
      }
      poly(ctx, [[-0.16, 0.16], edge[0]!, edge[1]!, [-0.16, -0.2]]);
      // Lime: a cut along the split, a hairline beside it, and three shards breaking off it.
      ctx.fillStyle = m ? maskCol(1, 0) : c.c;
      poly(ctx, [along(0, 0), along(1, 0), along(1, 0.0028), along(0, 0.0028)]);
      poly(ctx, [along(0, 0.0062), along(1, 0.0062), along(1, 0.0071), along(0, 0.0071)]);
      const shard = (t: number, d: number, sz: number): void => {
        const a = along(t, d);
        poly(ctx, [a, [a[0] + sz, a[1] + sz * 0.35], [a[0] + sz * 0.25, a[1] - sz * 0.8]]);
      };
      shard(0.38, 0.012, 0.012);
      shard(0.45, 0.026, 0.008);
      shard(0.51, 0.036, 0.005);
      // Fine white grid lines on the cobalt.
      if (!m) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = mm(0.0004);
        for (let k = 0; k < 9; k++) {
          ctx.beginPath();
          ctx.moveTo(px(-0.14), py(0.11 - k * 0.012));
          ctx.lineTo(px(0.06), py(0.11 - k * 0.012 - 0.075));
          ctx.stroke();
        }
      }
    });
    p.both((ctx, m) => {
      // The model across the split in lime, edged in navy so it reads on the cobalt and on the pearl.
      ctx.fillStyle = m ? maskCol(1, 0) : c.c;
      ctx.strokeStyle = m ? maskCol(1, 0) : c.b;
      ctx.lineWidth = mm(0.0012);
      ctx.lineJoin = 'round';
      ctx.font = `900 ${Math.round(mm(0.027))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(-0.0445), mm(0.0016), 0, !m, SLANT);
      wordmark(ctx, 0, -0.0605, 0.0058, m ? maskCol(1, 0) : '#ffffff');
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      ctx.font = `600 ${Math.round(mm(0.0026))}px ${SANS}`;
      spaced(ctx, look.line, px(0), py(-0.0685), mm(0.0004));
    });
  },
};

/** ORBITA: gloss black, concentric violet-to-magenta rings off the upper right, a halftone fading out lower left. */
const orbit: Style = {
  face(p, look, s, fg) {
    const c = C(look);
    const cx = 0.07, cy = 0.075;
    p.both((ctx, m) => {
      if (m) ctx.fillStyle = maskCol(fg, 0);
      else {
        const g = ctx.createRadialGradient(px(cx), py(cy), mm(0.01), px(cx), py(cy), mm(0.3));
        g.addColorStop(0, '#24202e');
        g.addColorStop(1, c.base);
        ctx.fillStyle = g;
      }
      path(ctx, s.face);
      ctx.fill();
      for (let k = 0; k < 12; k++) {
        const r = 0.022 + k * 0.0155;
        const t = k / 11;
        ctx.lineWidth = mm(k % 3 === 0 ? 0.0042 : k % 3 === 1 ? 0.0022 : 0.0011);
        if (m) ctx.strokeStyle = maskCol(fg, k === 4 ? 1 : 0);
        else {
          const ha = parseInt(c.a.slice(1), 16), hb = parseInt(c.b.slice(1), 16);
          const ch = (sh: number): number => Math.round(((ha >> sh) & 255) * (1 - t) + ((hb >> sh) & 255) * t);
          ctx.strokeStyle = k === 4 ? c.c : `rgba(${ch(16)},${ch(8)},${ch(0)},${(1 - 0.55 * t).toFixed(3)})`;
        }
        ctx.beginPath();
        ctx.arc(px(cx), py(cy), mm(r), 0, Math.PI * 2);
        ctx.stroke();
      }
      // Halftone: dots on a 4 mm grid, growing towards the lower left.
      ctx.fillStyle = m ? maskCol(fg, 0) : c.b;
      for (let j = 0; j < 40; j++) {
        for (let i = 0; i < 40; i++) {
          const x = -0.14 + i * 0.004 + (j & 1) * 0.002, y = -0.1 + j * 0.004;
          const f = 1 - Math.hypot(x + 0.13, y + 0.1) / 0.13;
          if (f <= 0.05) continue;
          ctx.beginPath();
          ctx.arc(px(x), py(y), mm(0.0016 * Math.min(1, f)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    p.both((ctx, m) => {
      ctx.fillStyle = m ? maskCol(1, 0) : c.text;
      ctx.font = `900 ${Math.round(mm(0.029))}px ${SANS}`;
      spaced(ctx, look.model, px(-0.004), py(-0.03), mm(0.0017), 0, false, SLANT);
      wordmark(ctx, 0, -0.0605, 0.0062, m ? maskCol(1, 0) : c.text);
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      ctx.font = `600 ${Math.round(mm(0.003))}px ${SANS}`;
      spaced(ctx, look.line, px(0), py(-0.072), mm(0.0006));
      emblem(ctx, px(-0.075), py(0.06), mm(0.016), m ? maskCol(1, 0) : c.b);
    });
  },
};

const STYLES: Record<string, Style> = { ember, tide, split, orbit };

/** Perceived lightness of a colour (0..1). */
function lum(hex: string): number {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
}

/**
 * The frame's sides (their own canvas, `sideLayout`): the frame's colour with a pinstripe each side of the outside
 * edge all round, the throat's arms in the accent colour, the model's name along the right side and the maker's
 * along the left (both reading with the face up), and over the tip the protector: its colour (or, translucent, the
 * frame's print under a tint) with the maker's name moulded along it each side.
 */
function sides(ctx: Ctx, look: RacketLook, s: ArtShape, lay: SideLayout): void {
  const c = C(look);
  const Lh = lay.L / 2;
  // Pixels per metre across the profile (v by arc length).
  const across = SIDE_SH / s.profile;
  for (const half of [0, 1]) {
    const r = half ? SIDE_B : SIDE_A;
    const X = (sh: number): number => warp(lay, half, sh) * SIDE_W;
    /** Canvas row `d` metres from the outside edge's middle towards the front face. */
    const Y = (d: number): number => r.y + r.h / 2 - d * across;
    ctx.fillStyle = c.frame;
    ctx.fillRect(0, r.y - 4, SIDE_W, r.h + 8);
    // Pinstripes 8 mm either side of the outside edge, 0.8 mm wide.
    ctx.fillStyle = c.accent;
    for (const d of [0.0084, -0.0076]) ctx.fillRect(0, Y(d), SIDE_W, 0.0008 * across);
    // The throat's arms: a band of the accent colour 11 cm up each arm from the neck.
    const arm = 0.11;
    ctx.fillRect(half ? X(Lh - arm) : 0, Y(0.0058), half ? SIDE_W - X(Lh - arm) : X(arm), 0.0116 * across);
    // Type along the side, 8.5 mm caps: the model on the right side (half 0), the maker on the left.
    const t = lay.text[half]!;
    const along = (X(t + lay.win / 2) - X(t - lay.win / 2)) / lay.win;
    ctx.save();
    ctx.translate(X(t), Y(0));
    ctx.scale(along / across, 1);
    ctx.fillStyle = lum(c.frame) < 0.4 ? '#ffffff' : c.accent;
    const cap = 0.0085 * across;
    if (half === 0) {
      ctx.font = `900 ${Math.round(cap / 0.72)}px ${SANS}`;
      spaced(ctx, look.model, 0, cap * 0.04, cap * 0.1, 0, false, SLANT);
    } else {
      ctx.font = `800 ${Math.round(cap / 0.72)}px ${SANS}`;
      spaced(ctx, 'BANDEJA', 0, cap * 0.04, cap * 0.32);
    }
    ctx.restore();
    // The protector over the tip (the frame under it is never seen, so its print is the protector's).
    const span = lay.span;
    const x0 = half ? 0 : X(Lh - span / 2), x1 = half ? X(span / 2) : SIDE_W;
    const b = look.bumper;
    const solid = b.clear < 0.5;
    ctx.fillStyle = solid ? b.colour : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x0, r.y - 4, x1 - x0, r.h + 8);
    if (!solid) {
      // Translucent: the frame's print seen through a milky tint of its colour.
      const tc = new THREE.Color(b.colour);
      ctx.fillStyle = `rgba(${Math.round(tc.r * 255)},${Math.round(tc.g * 255)},${Math.round(tc.b * 255)},${(0.5 * b.clear).toFixed(3)})`;
      ctx.fillRect(x0, r.y - 4, x1 - x0, r.h + 8);
    }
    // A fine moulded line along each edge of its outside face.
    ctx.fillStyle = solid ? (lum(b.colour) < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)') : c.frame;
    for (const d of [0.0105, -0.0105]) ctx.fillRect(x0, Y(d) - 0.00025 * across, x1 - x0, 0.0005 * across);
    // The maker's name along it, 4.5 mm caps, a quarter of its span in from the tip each side.
    const tb = half ? span / 4 : Lh - span / 4;
    const alongB = (X(Math.min(Lh, tb + 0.03)) - X(Math.max(0, tb - 0.03))) / 0.06;
    ctx.save();
    ctx.translate(X(tb), Y(0));
    ctx.scale(alongB / across, 1);
    ctx.fillStyle = solid ? (lum(b.colour) < 0.55 ? '#ffffff' : c.frame) : c.a;
    const capB = 0.0045 * across;
    ctx.font = `800 ${Math.round(capB / 0.72)}px ${SANS}`;
    spaced(ctx, 'BANDEJA', 0, capB * 0.04, capB * 0.35);
    ctx.restore();
  }
}

/** The finishing tape and the cap's logo (on the head's canvas, with the mask). */
function trims(p: Painter, look: RacketLook): void {
  const c = C(look);
  // Finishing tape: its colour, a thin band at each edge, the maker's name round it.
  p.both((ctx, m) => {
    const r = TAPE;
    // Filled 8 px past each end, so the seam's texels (u 0 and 1) are the tape's own.
    ctx.fillStyle = m ? maskCol(0.6, 0) : look.tape;
    ctx.fillRect(r.x - 8, r.y - 4, r.w + 16, r.h + 8);
    ctx.fillStyle = m ? maskCol(0.6, 0) : 'rgba(255,255,255,0.85)';
    ctx.fillRect(r.x - 8, r.y + 10, r.w + 16, 4);
    ctx.fillRect(r.x - 8, r.y + r.h - 14, r.w + 16, 4);
    ctx.font = `800 ${Math.round(r.h * 0.32)}px ${SANS}`;
    for (let k = 0; k < 3; k++) spaced(ctx, 'BANDEJA', r.x + ((k + 0.5) * r.w) / 3, r.y + r.h * 0.52, r.h * 0.07);
  });
  // Cap logo: a ring in the accent colour round the mark, the cord's eyelet in the middle.
  p.both((ctx, m) => {
    const r = LOGO;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillStyle = m ? maskCol(1, 0) : look.cap;
    ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.strokeStyle = m ? maskCol(1, 1) : c.accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r.w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    emblem(ctx, cx, cy + r.h * 0.06, r.w * 0.5, m ? maskCol(1, 1) : '#e8e8ea');
    ctx.fillStyle = m ? maskCol(0, 0) : '#050506';
    ctx.beginPath();
    ctx.arc(cx, cy, r.w * 0.07, 0, Math.PI * 2);
    ctx.fill();
  });
}

export interface RacketArt { head: THREE.Texture; mask: THREE.Texture; side: THREE.Texture }

function canvasTexture(c: Cnv, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c as unknown as HTMLCanvasElement);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** A racket's print. Without a canvas (node tests) plain textures stand in. */
export function racketArt(look: RacketLook, s: ArtShape, lay: SideLayout): RacketArt {
  const cc = makeCanvas(W, H), mc = makeCanvas(Math.round(W * MASK), Math.round(H * MASK)), sc = makeCanvas(SIDE_W, SIDE_H);
  if (!cc || !mc || !sc) {
    const col = new THREE.Color(look.colours.base), fr = new THREE.Color(look.colours.frame);
    const head = new THREE.DataTexture(new Uint8Array([col.r * 255, col.g * 255, col.b * 255, 255]), 1, 1);
    const mask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    const side = new THREE.DataTexture(new Uint8Array([fr.r * 255, fr.g * 255, fr.b * 255, 255]), 1, 1);
    head.needsUpdate = mask.needsUpdate = side.needsUpdate = true;
    return { head, mask, side };
  }
  const c = cc.getContext('2d') as Ctx, m = mc.getContext('2d') as Ctx;
  m.setTransform(MASK, 0, 0, MASK, 0, 0);
  const p = new Painter(c, m);
  const col = C(look);
  const faceGloss = look.finish === 'gloss' ? 1 : look.finish === 'matte' ? 0.25 : 0;
  // Everything off the face is the frame's lacquer (so the mips at the edges stay the frame's colour).
  p.both((ctx, mk) => {
    ctx.fillStyle = mk ? maskCol(1, 0) : col.frame;
    ctx.fillRect(0, 0, W, H);
  });
  const style = STYLES[look.art] ?? ember;
  c.save();
  m.save();
  for (const ctx of [c, m]) { path(ctx, s.face); ctx.clip(); }
  // The print runs on under the holes (their chamfers show it); the mask's blue marks the holes for the far level.
  style.face(p, look, s, faceGloss);
  c.restore();
  m.restore();
  m.save();
  m.globalCompositeOperation = 'lighter';
  m.fillStyle = 'rgb(0,0,255)';
  for (const h of s.holes) {
    m.beginPath();
    m.arc(px(h[0]), py(h[1]), mm(s.holeEdge), 0, Math.PI * 2);
    m.fill();
  }
  m.restore();
  // The frame's band: a pinstripe 2.2 mm out from the face's edge and a hairline round the throat's opening.
  p.both((ctx, mk) => {
    ctx.strokeStyle = mk ? maskCol(1, 0) : col.accent;
    ctx.lineWidth = mm(0.0011);
    path(ctx, offsetLoop(s.face, -0.0024));
    ctx.stroke();
    ctx.lineWidth = mm(0.0007);
    path(ctx, offsetLoop(s.heart, -0.0045));
    ctx.stroke();
    // The bridge's plate (raised in the mesh): an edge in the accent, the mark in foil.
    const yc = s.plateY;
    ctx.lineWidth = mm(0.0006);
    ctx.beginPath();
    ctx.roundRect(px(-0.0128), py(yc + 0.0035), mm(0.0256), mm(0.007), mm(0.0032));
    ctx.stroke();
    emblem(ctx, px(-0.0062), py(yc - 0.0002), mm(0.0085), mk ? maskCol(1, 1) : '#d8d8dc');
    ctx.fillStyle = mk ? maskCol(1, 1) : '#d8d8dc';
    ctx.font = `800 ${Math.round(mm(0.0028))}px ${SANS}`;
    spaced(ctx, 'PRO', px(0.0055), py(yc), mm(0.0005));
  });
  trims(p, look);
  sides(sc.getContext('2d') as Ctx, look, s, lay);
  return { head: canvasTexture(cc, true), mask: canvasTexture(mc, false), side: canvasTexture(sc, true) };
}
