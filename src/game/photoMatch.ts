// Photo-match mode (Phase 5): `?photo=<id>` puts the camera where a real photo of a court was taken (solved from
// marked court points by tools/photo-solve.ts, reference/photos.json) and lays the photo over the game: a wipe
// (drag with the mouse), a blend, the photo alone or the game alone (O cycles; [ and ] move the wipe). `&lines=1`
// draws the court's lines through the solved camera, lens term included, to check the solve. The photos are not
// in the repo or the build: `node tools/fetch-reference.mjs` downloads them for `npm run dev`.
import * as THREE from 'three/webgpu';
import photos from '../../reference/photos.json' with { type: 'json' };

export interface PhotoCam { pos: number[]; yaw: number; pitch: number; roll: number; vfov: number; k1: number }
export interface PhotoEntry {
  id: string; file: string; what: string; aspect?: number; cam?: PhotoCam;
  arena?: string; court?: string; floor?: string;
  points?: Array<{ u: number; v: number; x: number; y: number; z: number; what?: string }>;
}

export function findPhoto(id: string): PhotoEntry | null {
  return (photos.photos as PhotoEntry[]).find((p) => p.id === id) ?? null;
}

/** The solver's camera (tools/photo-solve.ts conventions) as a three.js camera pose. */
export function applyPhotoCam(cam: THREE.PerspectiveCamera, c: PhotoCam, aspect: number): void {
  // World -> camera: yaw about y, then pitch about x, then roll about z (the solver's `project`). The camera's axes
  // in world space are the rows of that matrix.
  const m = new THREE.Matrix3();
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
  const ry = new THREE.Matrix3().set(cy, 0, -sy, 0, 1, 0, sy, 0, cy);
  const rx = new THREE.Matrix3().set(1, 0, 0, 0, cp, -sp, 0, sp, cp);
  const rz = new THREE.Matrix3().set(cr, sr, 0, -sr, cr, 0, 0, 0, 1);
  m.multiplyMatrices(rz, rx).multiply(ry);
  const e = m.elements; // column-major: row r, col k at e[k * 3 + r]
  const right = new THREE.Vector3(e[0], e[3], e[6]);
  const up = new THREE.Vector3(e[1], e[4], e[7]);
  const back = new THREE.Vector3(e[2], e[5], e[8]);
  const basis = new THREE.Matrix4().makeBasis(right, up, back);
  cam.quaternion.setFromRotationMatrix(basis);
  cam.position.set(c.pos[0]!, c.pos[1]!, c.pos[2]!);
  cam.fov = c.vfov;
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

const MODES = ['wipe', 'blend', 'photo', 'game'] as const;

export class PhotoOverlay {
  readonly aspect: number;
  private readonly img: HTMLImageElement;
  private readonly lines: HTMLCanvasElement;
  private readonly handle: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private mode = 0;
  private wipe: number;
  private rect = { x: 0, y: 0, w: 1, h: 1 };

  readonly entry: PhotoEntry;
  private readonly canvas: HTMLCanvasElement;

  constructor(entry: PhotoEntry, canvas: HTMLCanvasElement, params: URLSearchParams) {
    this.entry = entry;
    this.canvas = canvas;
    this.aspect = entry.aspect ?? 1.5;
    this.wipe = Number(params.get('wipe') ?? 0.5);
    const m = params.get('overlay');
    if (m) this.mode = Math.max(0, MODES.indexOf(m as (typeof MODES)[number]));
    const box = (el: HTMLElement): void => { el.style.position = 'fixed'; el.style.pointerEvents = 'none'; };
    this.img = document.createElement('img');
    box(this.img);
    this.img.src = `reference/photos/${entry.id}.jpg`;
    this.img.onerror = () => { this.label.textContent = `${entry.id}: photo not found (node tools/fetch-reference.mjs, then npm run dev)`; };
    this.lines = document.createElement('canvas');
    box(this.lines);
    this.handle = document.createElement('div');
    box(this.handle);
    this.handle.style.width = '2px';
    this.handle.style.background = 'rgba(255,255,255,0.85)';
    this.label = document.createElement('div');
    box(this.label);
    Object.assign(this.label.style, { left: '12px', bottom: '10px', font: '12px ui-sans-serif, system-ui', color: '#fff', textShadow: '0 1px 2px #000' });
    document.body.append(this.img, this.lines, this.handle, this.label);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyO') this.mode = (this.mode + 1) % MODES.length;
      else if (e.code === 'BracketLeft') this.wipe = Math.max(0, this.wipe - 0.05);
      else if (e.code === 'BracketRight') this.wipe = Math.min(1, this.wipe + 0.05);
      else return;
      this.layout();
    });
    const drag = (e: PointerEvent): void => {
      if (e.buttons !== 1) return;
      this.wipe = Math.min(1, Math.max(0, (e.clientX - this.rect.x) / this.rect.w));
      this.layout();
    };
    addEventListener('pointerdown', drag);
    addEventListener('pointermove', drag);
    this.showLines = params.get('lines') === '1';
    this.layout();
  }

  private readonly showLines: boolean;

  /** The largest box of the photo's aspect that fits the window, centred; the canvas and the photo both fill it. */
  fit(): { w: number; h: number } {
    const w = Math.min(innerWidth, innerHeight * this.aspect);
    const h = w / this.aspect;
    this.rect = { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2, w, h };
    const s = this.canvas.style;
    s.position = 'fixed'; s.left = `${this.rect.x}px`; s.top = `${this.rect.y}px`; s.width = `${w}px`; s.height = `${h}px`;
    this.layout();
    return { w: Math.round(w), h: Math.round(h) };
  }

  private layout(): void {
    const { x, y, w, h } = this.rect;
    for (const el of [this.img, this.lines]) Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const mode = MODES[this.mode]!;
    this.img.style.display = mode === 'game' ? 'none' : '';
    this.img.style.opacity = mode === 'blend' ? '0.5' : '1';
    this.img.style.clipPath = mode === 'wipe' ? `inset(0 0 0 ${(this.wipe * 100).toFixed(2)}%)` : 'none';
    Object.assign(this.handle.style, { display: mode === 'wipe' ? '' : 'none', left: `${x + this.wipe * w - 1}px`, top: `${y}px`, height: `${h}px` });
    this.lines.style.display = this.showLines ? '' : 'none';
    this.label.textContent = `${this.entry.id}: ${this.entry.what} · ${mode} (O: mode, drag or [ ]: wipe) · left game, right photo`;
    if (this.showLines) this.drawLines();
  }

  /**
   * One comparison image, drawn right after a render of the game's canvas: 'game' alone, 'wipe' (game left of
   * `at`, photo right), 'blend' or 'lines' (the photo with the solve's lines). Tools post these to a receiver.
   */
  composite(game: HTMLCanvasElement, kind: 'game' | 'wipe' | 'blend' | 'lines', at = 0.5): HTMLCanvasElement {
    const w = game.width, h = game.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d')!;
    if (kind !== 'lines') g.drawImage(game, 0, 0, w, h);
    if (kind === 'wipe') {
      g.save(); g.beginPath(); g.rect(w * at, 0, w * (1 - at), h); g.clip();
      g.drawImage(this.img, 0, 0, w, h); g.restore();
      g.fillStyle = '#fff'; g.fillRect(Math.round(w * at) - 1, 0, 2, h);
    } else if (kind === 'blend') {
      g.globalAlpha = 0.5; g.drawImage(this.img, 0, 0, w, h); g.globalAlpha = 1;
    } else if (kind === 'lines') {
      g.drawImage(this.img, 0, 0, w, h);
      this.drawLines(out, false);
    }
    return out;
  }

  /** The photo has loaded (comparison captures wait for it). */
  get ready(): boolean {
    return this.img.complete && this.img.naturalWidth > 0;
  }

  /** The court's lines and walls through the solved camera with its lens term (the game draws without one). */
  private drawLines(cv = this.lines, size = true): void {
    const c = this.entry.cam;
    if (!c) return;
    if (size) {
      cv.width = Math.round(this.rect.w * devicePixelRatio);
      cv.height = Math.round(this.rect.h * devicePixelRatio);
    }
    const g = cv.getContext('2d')!;
    if (size) g.clearRect(0, 0, cv.width, cv.height);
    const px = cv.width / 1000;
    const proj = (x: number, y: number, z: number): [number, number] | null => {
      let dx = x - c.pos[0]!, dy = y - c.pos[1]!, dz = z - c.pos[2]!;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      [dx, dz] = [cy * dx - sy * dz, sy * dx + cy * dz];
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      [dy, dz] = [cp * dy - sp * dz, sp * dy + cp * dz];
      const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
      [dx, dy] = [cr * dx + sr * dy, -sr * dx + cr * dy];
      if (dz > -0.1) return null;
      const f = 1 / Math.tan((c.vfov * Math.PI) / 360);
      let nx = ((dx / -dz) * f) / this.aspect, ny = (dy / -dz) * f;
      const d = 1 + c.k1 * (nx * nx * this.aspect * this.aspect + ny * ny);
      nx *= d; ny *= d;
      return [(0.5 + nx * 0.5) * cv.width, (0.5 - ny * 0.5) * cv.height];
    };
    const seg = (a: number[], b: number[]): void => {
      for (let i = 0; i < 24; i++) {
        const t0 = i / 24, t1 = (i + 1) / 24;
        const p = proj(a[0]! + (b[0]! - a[0]!) * t0, a[1]! + (b[1]! - a[1]!) * t0, a[2]! + (b[2]! - a[2]!) * t0);
        const q = proj(a[0]! + (b[0]! - a[0]!) * t1, a[1]! + (b[1]! - a[1]!) * t1, a[2]! + (b[2]! - a[2]!) * t1);
        if (!p || !q) continue;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    };
    g.lineWidth = 2 * px;
    g.strokeStyle = '#ff2bd6';
    for (const s of [1, -1]) {
      seg([-5, 0, 10 * s], [5, 0, 10 * s]);
      seg([5 * s, 0, -10], [5 * s, 0, 10]);
      seg([-5, 0, 6.95 * s], [5, 0, 6.95 * s]);
      seg([-5, 3, 10 * s], [5, 3, 10 * s]);
      seg([-5, 4, 10 * s], [5, 4, 10 * s]);
      for (const x of [-5, 5]) seg([x, 0, 10 * s], [x, 4, 10 * s]);
    }
    seg([0, 0, -6.95], [0, 0, 6.95]);
    seg([-5, 0.92, 0], [5, 0.92, 0]);
    g.fillStyle = '#00ff88';
    for (const p of this.entry.points ?? []) {
      g.beginPath(); g.arc(p.u * cv.width, p.v * cv.height, 3 * px, 0, Math.PI * 2); g.fill();
    }
  }
}
