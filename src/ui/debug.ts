// F3 debug overlay: FPS, frame-time graph, draw calls, triangles, sim time per frame.
const N = 240;

export class DebugOverlay {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frames = new Float32Array(N);
  private readonly sims = new Float32Array(N);
  private i = 0;
  private last = 0;
  visible = false;
  private textAt = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;right:16px;top:16px;background:rgba(10,12,16,.82);border-radius:6px;padding:8px 10px;' +
      'font:12px/1.5 ui-monospace,Menlo,monospace;color:#cfd6dc;display:none;pointer-events:none';
    this.text = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.width = N;
    this.canvas.height = 64;
    this.canvas.style.cssText = 'display:block;margin-top:6px;width:240px;height:64px';
    this.ctx = this.canvas.getContext('2d')!;
    this.el.append(this.text, this.canvas);
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  /** Record one frame. `frameMs` = time since last frame, `simMs` = time spent in sim steps. */
  frame(now: number, simMs: number, ticks: number, drawCalls: number, triangles: number, backend: string, scale: number): void {
    const dt = this.last ? now - this.last : 16.7;
    this.last = now;
    this.frames[this.i % N] = dt;
    this.sims[this.i % N] = simMs;
    this.i++;
    if (!this.visible || now < this.textAt) return;
    this.textAt = now + 250;
    let sum = 0;
    let max = 0;
    let simMax = 0;
    const n = Math.min(this.i, N);
    for (let k = 0; k < n; k++) {
      sum += this.frames[k]!;
      if (this.frames[k]! > max) max = this.frames[k]!;
      if (this.sims[k]! > simMax) simMax = this.sims[k]!;
    }
    const avg = sum / n;
    this.text.textContent =
      `${(1000 / avg).toFixed(0)} fps  avg ${avg.toFixed(2)} ms  max ${max.toFixed(1)} ms\n` +
      `sim ${simMs.toFixed(2)} ms (${ticks} ticks)  max ${simMax.toFixed(2)} ms\n` +
      `draws ${drawCalls}  tris ${(triangles / 1000).toFixed(0)}k  ${backend}  res ${(scale * 100).toFixed(0)}%`;
    this.text.style.whiteSpace = 'pre';
    const c = this.ctx;
    c.clearRect(0, 0, N, 64);
    c.fillStyle = 'rgba(255,255,255,.08)';
    c.fillRect(0, 64 - 16.7 * 2, N, 1);
    c.fillRect(0, 64 - 8.33 * 2, N, 1);
    for (let k = 0; k < n; k++) {
      const idx = (this.i - n + k + N) % N;
      const f = this.frames[idx]!;
      c.fillStyle = f > 20 ? '#ff5a4f' : f > 9 ? '#f4d03f' : '#8fe36b';
      c.fillRect(k, 64 - Math.min(64, f * 2), 1, Math.min(64, f * 2));
      c.fillStyle = '#5ff2ff';
      c.fillRect(k, 64 - Math.min(64, this.sims[idx]! * 2), 1, 1);
    }
  }
}
