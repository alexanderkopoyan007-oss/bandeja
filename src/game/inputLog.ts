// A player's inputs over a whole run (M6 phase C: a challenge's best run, kept and watched again). The sim is
// deterministic, so the run is its configuration and these frames: re-run, it is the same run to the bit. Recording
// fills arrays made once (nothing is allocated per tick); saving keeps only the ticks whose frame changed, as the
// float64 bits themselves (base64), since a value that came back even a bit different (a stick's -0 as 0) can send a
// run another way.
import { InputFrame } from '../sim/input.ts';

/** Values per tick: moveX, moveY, aimAbs, aimTX, aimTZ, held. */
const ROW = 6;
/** Values per button event: tick, press, button, sim time. */
const EV = 4;

/** A saved log: the changed rows ([tick, ...ROW values]) and the events, as base64 of float64s, and the run's length. */
export interface SavedLog {
  ticks: number;
  rows: string;
  events: string;
}

export class InputLog {
  private readonly rows: Float64Array;
  private readonly ev: Float64Array;
  private evN = 0;
  /** Ticks recorded. */
  ticks = 0;
  readonly capacity: number;

  /** Room for `capacity` ticks and `events` button events. */
  constructor(capacity: number, events = capacity >> 2) {
    this.capacity = capacity;
    this.rows = new Float64Array(capacity * ROW);
    this.ev = new Float64Array(events * EV);
  }

  /** Empty again, for the next run (the arrays kept). */
  reset(): void {
    this.ticks = 0;
    this.evN = 0;
  }

  /** The next tick's frame (past the capacity: not kept, and `full` says so). */
  record(f: InputFrame | null): void {
    if (this.ticks >= this.capacity) { this.ticks++; return; }
    const k = this.ticks * ROW, r = this.rows;
    if (f) {
      r[k] = f.moveX; r[k + 1] = f.moveY; r[k + 2] = f.aimAbs ? 1 : 0; r[k + 3] = f.aimTX; r[k + 4] = f.aimTZ; r[k + 5] = f.held;
      for (let i = 0; i < f.evCount && (this.evN + 1) * EV <= this.ev.length; i++) {
        const e = f.ev[i]!, j = this.evN * EV;
        this.ev[j] = this.ticks; this.ev[j + 1] = e.press ? 1 : 0; this.ev[j + 2] = e.button; this.ev[j + 3] = e.t;
        this.evN++;
      }
    } else {
      r[k] = 0; r[k + 1] = 0; r[k + 2] = 0; r[k + 3] = 0; r[k + 4] = 0; r[k + 5] = 0;
    }
    this.ticks++;
  }

  /** More ticks were played than it could keep. */
  get full(): boolean {
    return this.ticks > this.capacity;
  }

  /** The log as it is saved: only the ticks whose frame changed. */
  save(): SavedLog {
    const out: number[] = [];
    const r = this.rows, n = Math.min(this.ticks, this.capacity);
    for (let t = 0; t < n; t++) {
      const k = t * ROW;
      let same = t > 0;
      for (let i = 0; same && i < ROW; i++) if (!Object.is(r[k + i], r[k - ROW + i])) same = false;
      if (same) continue;
      out.push(t);
      for (let i = 0; i < ROW; i++) out.push(r[k + i]!);
    }
    return { ticks: n, rows: b64(Float64Array.from(out)), events: b64(this.ev.slice(0, this.evN * EV)) };
  }
}

/** A saved log played back: the frame for each tick, in order. */
export class LogPlayer {
  readonly ticks: number;
  private readonly rows: Float64Array;
  private readonly ev: Float64Array;
  private row = 0;
  private evAt = 0;
  private tick = 0;
  private readonly frame = new InputFrame();

  constructor(saved: SavedLog) {
    this.ticks = saved.ticks;
    this.rows = unb64(saved.rows);
    this.ev = unb64(saved.events);
  }

  /** The next tick's frame (null once the log is over). */
  next(): InputFrame | null {
    if (this.tick >= this.ticks) return null;
    const t = this.tick++;
    const r = this.rows, f = this.frame;
    // The row in force: the last change at or before this tick.
    while (this.row + 1 + ROW < r.length && r[this.row + 1 + ROW]! <= t) this.row += 1 + ROW;
    f.clear();
    if (r.length && r[this.row]! <= t) {
      const k = this.row + 1;
      f.moveX = r[k]!; f.moveY = r[k + 1]!; f.aimAbs = r[k + 2] === 1; f.aimTX = r[k + 3]!; f.aimTZ = r[k + 4]!; f.held = r[k + 5]!;
    } else f.held = 0;
    while (this.evAt + EV <= this.ev.length && this.ev[this.evAt]! === t) {
      f.push(this.ev[this.evAt + 1] === 1, this.ev[this.evAt + 2]!, this.ev[this.evAt + 3]!);
      this.evAt += EV;
    }
    return f;
  }

  get over(): boolean {
    return this.tick >= this.ticks;
  }
}

/** A saved log read back from the store, checked: base64 of whole float64s, at most `maxTicks`. */
export function savedLogFrom(raw: unknown, maxTicks: number): SavedLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.ticks !== 'number' || !Number.isInteger(o.ticks) || o.ticks < 1 || o.ticks > maxTicks) return null;
  if (typeof o.rows !== 'string' || typeof o.events !== 'string') return null;
  try {
    const rows = unb64(o.rows), ev = unb64(o.events);
    if (rows.length % (1 + ROW) !== 0 || ev.length % EV !== 0) return null;
  } catch {
    return null;
  }
  return { ticks: o.ticks, rows: o.rows, events: o.events };
}

function b64(a: Float64Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Float64Array {
  const bin = atob(s);
  if (bin.length % 8 !== 0) throw new Error('not float64s');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float64Array(bytes.buffer);
}
