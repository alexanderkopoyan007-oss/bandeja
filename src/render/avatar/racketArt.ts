// A racket's printed graphics (render/avatar/racket.ts): one canvas per racket, at 5 px/mm over the face (a close-up
// filling a 1080p frame is about 4 px/mm), holding the face's print (both faces: the back mirrors it, so it reads
// the same from either side), the frame's side strips, the finishing tape's print and the butt cap's logo; and a
// quarter-size mask beside it (red: gloss print, green: metallic foil) for the material.
//
// Generic, original designs only: the maker's mark is the game's own (BANDEJA, a ball over a tilted tray), the model
// names are made up, and the four graphics (ember chevrons, a tide wave, a split panel, orbit rings) copy no real
// racket. Type is the system's sans-serif (nothing downloaded).
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
}

/** Pixels per metre on the face, the canvas's half width (m) and the face's top row (y, m). */
const PXM = 5000;
const HW = 0.1352;
const TOP = 0.145;
const W = 1352;
const SIDE_A = { x: 0, y: 1633, w: W, h: 112 };
const SIDE_B = { x: 0, y: 1753, w: W, h: 112 };
const TAPE = { x: 0, y: 1873, w: 1200, h: 128 };
const LOGO = { x: 1212, y: 1873, w: 128, h: 128 };
const H = 2008;
/** The mask is drawn at this share of the colour canvas's size. */
const MASK = 0.25;

/** Where things are on the canvas, as texture coordinates (v up: canvases are uploaded flipped). */
export const ART = {
  W, H,
  headU: (x: number): number => (x + HW) / (2 * HW),
  headV: (y: number): number => 1 - ((TOP - y) * PXM) / H,
  /** The frame's side: `half` 0 the first half of the outline (bottom of the neck to the tip), 1 the rest. */
  sideUv: (half: number, u: number, v: number): [number, number] => {
    const r = half ? SIDE_B : SIDE_A;
    return [(r.x + u * r.w) / W, 1 - (r.y + (1 - v) * r.h) / H];
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

const SANS = '"Avenir Next", "Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';

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

/** Text with even letter spacing (`track`, px), centred on (x, y) px, rotated by `rot`. */
function spaced(ctx: Ctx, text: string, x: number, y: number, track: number, rot = 0, stroke = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
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

/** BRASA: black carbon, a glowing chevron pointing to the throat, gold pinlines. */
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
    // The chevron: a broad band, an orange to red gradient, and a thin second band under it.
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
      // Gold foil pinlines along the chevron's top edge and between the bands.
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      poly(ctx, band(0.1 + 0.0062, -0.022 + 0.0062, 0.0011));
      poly(ctx, band(0.1 - 0.05 - 0.0035, -0.022 - 0.05 - 0.0035, 0.0007));
      // Facets: darker triangles on the chevron's arms (a folded-paper look).
      if (!m) {
        ctx.fillStyle = 'rgba(80,0,0,0.28)';
        poly(ctx, [[0.15, 0.1], [0.06, 0.05], [0.15, 0.05]]);
        poly(ctx, [[-0.15, 0.1], [-0.06, 0.05], [-0.15, 0.05]]);
        ctx.fillStyle = 'rgba(255,220,150,0.16)';
        poly(ctx, [[0, -0.022], [0.035, 0.0], [0, -0.072]]);
      }
    });
    // Type: the model large in the open carbon above the chevron, the maker above it, the spec line under the point.
    p.both((ctx, m) => {
      ctx.fillStyle = m ? maskCol(1, 0) : c.text;
      ctx.font = `italic 900 ${Math.round(mm(0.033))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(0.057), mm(0.0016), -0.0);
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
      ctx.font = `italic 900 ${Math.round(mm(0.03))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(-0.05), mm(0.0018));
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
      ctx.font = `italic 900 ${Math.round(mm(0.027))}px ${SANS}`;
      spaced(ctx, look.model, px(0), py(-0.048), mm(0.0016), 0, !m);
      wordmark(ctx, 0.047, 0.0915, 0.0062, m ? maskCol(1, 0) : c.a);
      ctx.fillStyle = m ? maskCol(1, 1) : '#8a93a3';
      ctx.font = `600 ${Math.round(mm(0.0026))}px ${SANS}`;
      spaced(ctx, look.line, px(0.047), py(0.0835), mm(0.0004));
      emblem(ctx, px(-0.047), py(0.092), mm(0.018), m ? maskCol(1, 1) : '#ffffff');
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
      ctx.font = `italic 900 ${Math.round(mm(0.029))}px ${SANS}`;
      spaced(ctx, look.model, px(-0.004), py(-0.03), mm(0.0017));
      wordmark(ctx, 0, -0.0605, 0.0062, m ? maskCol(1, 0) : c.text);
      ctx.fillStyle = m ? maskCol(1, 1) : c.c;
      ctx.font = `600 ${Math.round(mm(0.003))}px ${SANS}`;
      spaced(ctx, look.line, px(0), py(-0.072), mm(0.0006));
      emblem(ctx, px(-0.075), py(0.06), mm(0.016), m ? maskCol(1, 0) : c.b);
    });
  },
};

const STYLES: Record<string, Style> = { ember, tide, split, orbit };

/** The frame's side, the tape and the cap's logo. */
function trims(p: Painter, look: RacketLook, s: ArtShape): void {
  const c = C(look);
  const L = s.perimeter;
  for (const [rect, half] of [[SIDE_A, 0], [SIDE_B, 1]] as const) {
    p.both((ctx, m) => {
      ctx.fillStyle = m ? maskCol(1, 0) : c.frame;
      ctx.fillRect(rect.x, rect.y - 4, rect.w, rect.h + 8);
      // A pinstripe each side of the middle, all round; the throat's arms in the accent colour.
      ctx.fillStyle = m ? maskCol(1, 0) : c.accent;
      ctx.fillRect(rect.x, rect.y + rect.h * 0.27, rect.w, 3);
      ctx.fillRect(rect.x, rect.y + rect.h * 0.73 - 3, rect.w, 3);
      const armEnd = 0.11 / (L / 2);
      if (half === 0) ctx.fillRect(rect.x, rect.y + rect.h * 0.34, rect.w * armEnd, rect.h * 0.32);
      else ctx.fillRect(rect.x + rect.w * (1 - armEnd), rect.y + rect.h * 0.34, rect.w * armEnd, rect.h * 0.32);
      // Type along each side of the head: the model on the right, the maker on the left (both read with the face up).
      const fl = new THREE.Color(c.frame);
      ctx.fillStyle = m ? maskCol(1, 0) : fl.r * 0.3 + fl.g * 0.59 + fl.b * 0.11 < 0.4 ? '#ffffff' : c.accent;
      ctx.font = `italic 900 ${Math.round(rect.h * 0.36)}px ${SANS}`;
      const sMid = half === 0 ? 0.31 * L : 0.69 * L;
      const u = (sMid - half * L * 0.5) / (L * 0.5);
      // The side is foreshortened along the outline (u runs 0.48 m over the canvas width): stretch the type to read.
      ctx.save();
      ctx.translate(rect.x + u * rect.w, rect.y + rect.h * 0.5);
      ctx.scale(0.62, 1);
      if (half === 0) spaced(ctx, look.model, 0, 0, rect.h * 0.08);
      else {
        ctx.font = `800 ${Math.round(rect.h * 0.3)}px ${SANS}`;
        spaced(ctx, 'BANDEJA', 0, 0, rect.h * 0.12);
      }
      ctx.restore();
    });
  }
  // Finishing tape: its colour, a thin band at each edge, the maker's name round it.
  p.both((ctx, m) => {
    const r = TAPE;
    ctx.fillStyle = m ? maskCol(0.6, 0) : look.tape;
    ctx.fillRect(r.x, r.y - 4, r.w, r.h + 8);
    ctx.fillStyle = m ? maskCol(0.6, 0) : 'rgba(255,255,255,0.85)';
    ctx.fillRect(r.x, r.y + 10, r.w, 4);
    ctx.fillRect(r.x, r.y + r.h - 14, r.w, 4);
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

export interface RacketArt { head: THREE.Texture; mask: THREE.Texture }

/** A racket's print. Without a canvas (node tests) a plain texture stands in. */
export function racketArt(look: RacketLook, s: ArtShape): RacketArt {
  const cc = makeCanvas(W, H), mc = makeCanvas(Math.round(W * MASK), Math.round(H * MASK));
  if (!cc || !mc) {
    const col = new THREE.Color(look.colours.base);
    const head = new THREE.DataTexture(new Uint8Array([col.r * 255, col.g * 255, col.b * 255, 255]), 1, 1);
    const mask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    head.needsUpdate = mask.needsUpdate = true;
    return { head, mask };
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
  style.face(p, look, s, faceGloss);
  // Each hole's rim: the skin's edge where the drill went through the print (a ring a little wider than the hole).
  p.both((ctx, mk) => {
    ctx.fillStyle = mk ? maskCol(0, 0) : look.skin;
    for (const h of s.holes) {
      ctx.beginPath();
      ctx.arc(px(h[0]), py(h[1]), mm(s.holeEdge + 0.00045), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  c.restore();
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
    // The bridge's plate: the mark in foil.
    emblem(ctx, px(0), py((s.bridgeTop + s.bridgeBottom) / 2 + 0.0015), mm(0.013), mk ? maskCol(1, 1) : '#d8d8dc');
  });
  trims(p, look, s);
  const head = new THREE.CanvasTexture(cc as unknown as HTMLCanvasElement);
  head.colorSpace = THREE.SRGBColorSpace;
  const mask = new THREE.CanvasTexture(mc as unknown as HTMLCanvasElement);
  for (const t of [head, mask]) {
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
  }
  return { head, mask };
}
