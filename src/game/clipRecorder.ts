// Clips as video files (M7 phase C, the brief's "export clips as video files using canvas capture (MediaRecorder),
// which is free and client-side"). The game's canvas is drawn each frame onto a 2D canvas of the same size with the
// point's caption burned in at the foot (the HUD is HTML, and a capture of the game's canvas alone would lose it), and
// that canvas is recorded with the game's own sound (a stream off the end of the audio chain: engine.ts
// captureTrack). The file is made in the browser and saved by it: nothing leaves the machine.
//
// Formats: MP4 (H.264 and AAC) where the browser records it, else WebM (VP9 or VP8, and Opus).

/** The formats tried, best first (MediaRecorder.isTypeSupported). */
export const CLIP_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

/** The first format this browser records (null: no recording at all). */
export function clipType(supported: (t: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string | null {
  for (const t of CLIP_TYPES) if (supported(t)) return t;
  return null;
}

/** The file's extension for a recorded type. */
export function clipExt(type: string): string {
  return type.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Bits a second for the picture: about 0.12 a pixel a frame at 60 frames, 8 to 24 Mb/s. */
export function clipBitrate(w: number, h: number): number {
  return Math.round(Math.min(24e6, Math.max(8e6, w * h * 60 * 0.12)));
}

export class ClipRecorder {
  readonly type: string;
  private readonly comp: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rec: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly done: Promise<Blob>;
  private caption = '';
  private sub = '';
  private stopped = false;

  /** Recording `source` (the game's canvas) at its size, with `audio` (a track of the game's sound, or none). */
  constructor(source: HTMLCanvasElement, audio: MediaStreamTrack | null, type: string) {
    this.type = type;
    this.comp = document.createElement('canvas');
    this.comp.width = source.width;
    this.comp.height = source.height;
    this.ctx = this.comp.getContext('2d', { alpha: false })!;
    const stream = this.comp.captureStream(60);
    if (audio) stream.addTrack(audio);
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: clipBitrate(source.width, source.height), audioBitsPerSecond: 160000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.done = new Promise((resolve) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.type.split(';')[0] }));
    });
    this.rec.start(1000);
  }

  /** The caption burned in from the next frame (the point's: "HIGHLIGHTS 2/8", "Set 1 · 2-1 · 30-15 · 14-shot rally"). */
  setCaption(title: string, sub: string): void {
    this.caption = title;
    this.sub = sub;
  }

  /** A frame: called right after the game's canvas is drawn (in the same task, while its picture is still there). */
  frame(source: HTMLCanvasElement): void {
    if (this.stopped) return;
    const c = this.ctx, w = this.comp.width, h = this.comp.height;
    if (source.width !== w || source.height !== h) c.drawImage(source, 0, 0, w, h);
    else c.drawImage(source, 0, 0);
    if (!this.caption) return;
    // A lower third: the title in bold over the line under it, on a dark band.
    const s = h / 1080, x = 56 * s, y = h - 150 * s;
    const big = `800 ${Math.round(30 * s)}px system-ui, sans-serif`, small = `600 ${Math.round(24 * s)}px system-ui, sans-serif`;
    c.save();
    c.font = big;
    let wide = c.measureText(this.caption).width;
    c.font = small;
    wide = Math.max(wide, c.measureText(this.sub).width);
    c.fillStyle = 'rgba(11,17,38,0.82)';
    c.fillRect(x - 18 * s, y - 44 * s, wide + 36 * s, 96 * s);
    c.fillStyle = '#f2c14e';
    c.font = big;
    c.fillText(this.caption, x, y);
    c.fillStyle = '#f4f6fa';
    c.font = small;
    c.fillText(this.sub, x, y + 36 * s);
    c.restore();
  }

  /** The clip so far as a file. */
  stop(): Promise<Blob> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.rec.state !== 'inactive') this.rec.stop();
    }
    return this.done;
  }

  /** Thrown away. */
  cancel(): void {
    this.stopped = true;
    if (this.rec.state !== 'inactive') this.rec.stop();
    this.chunks.length = 0;
  }
}

/** A file saved by the browser (a download the player asked for). */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** "bandeja-2026-11-09-1712" for a file made now. */
export function fileStem(kind: string, d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `bandeja-${kind}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
