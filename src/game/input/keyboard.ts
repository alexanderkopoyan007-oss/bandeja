// Keyboard + mouse input with exact timestamps. Key events carry event.timeStamp (performance.now() time base),
// so a release is judged at the moment it happened, not when the next frame polls it.
import { BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP, BTN_OVERHEAD, BTN_VOLLEY, BTN_POWER, BTN_PRECISION } from '../../sim/input.ts';

export interface TimedButton { press: boolean; button: number; ts: number }

const BUTTON_KEYS: Record<string, number> = {
  KeyJ: BTN_DRIVE,
  KeyK: BTN_TOPSPIN,
  KeyL: BTN_SLICE,
  KeyI: BTN_LOB,
  KeyU: BTN_DROP,
  KeyO: BTN_OVERHEAD,
  KeyN: BTN_VOLLEY,
  Space: BTN_POWER,
  ShiftLeft: BTN_PRECISION,
  ShiftRight: BTN_PRECISION,
};

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0],
  ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

const MOVE_CODES = Object.keys(MOVE_KEYS);
const QUEUE = 32;

export class KeyboardInput {
  held = 0;
  private readonly moveHeld: Record<string, boolean> = {};
  /** Ring of timestamped button events not yet consumed by the sim. */
  readonly queue: TimedButton[] = [];
  head = 0;
  tail = 0;
  /** Mouse position in normalised device coordinates (-1..1), for mouse aim. */
  mouseX = 0;
  mouseY = 0;
  mouseActive = false;
  onKey: ((code: string, ev: KeyboardEvent) => void) | null = null;

  constructor(target: Window) {
    for (let i = 0; i < QUEUE; i++) this.queue.push({ press: false, button: 0, ts: 0 });
    target.addEventListener('keydown', (e) => this.key(e, true));
    target.addEventListener('keyup', (e) => this.key(e, false));
    target.addEventListener('blur', () => this.releaseAll(performance.now()));
    target.addEventListener('pointermove', (e) => {
      this.mouseX = (e.clientX / innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / innerHeight) * 2 + 1;
      this.mouseActive = true;
    });
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const btn = BUTTON_KEYS[e.code];
    if (btn !== undefined || MOVE_KEYS[e.code]) e.preventDefault();
    if (e.repeat) return;
    if (btn !== undefined) {
      const was = (this.held & btn) !== 0;
      if (down === was) return;
      this.held = down ? this.held | btn : this.held & ~btn;
      this.push(down, btn, e.timeStamp);
    } else if (MOVE_KEYS[e.code]) {
      this.moveHeld[e.code] = down;
    }
    if (down) this.onKey?.(e.code, e);
  }

  /**
   * A button event from another device (the gamepad), into the same timestamped queue, in time order: a pad's
   * stamp can be earlier than a key event already queued, and the sim takes events up to the first one past a tick.
   */
  inject(press: boolean, button: number, ts: number): void {
    this.push(press, button, ts);
    for (let k = this.tail - 1; k > this.head; k--) {
      const a = this.queue[(k - 1) % QUEUE]!, b = this.queue[k % QUEUE]!;
      if (a.ts <= b.ts) break;
      const p = a.press, bt = a.button, t = a.ts;
      a.press = b.press; a.button = b.button; a.ts = b.ts;
      b.press = p; b.button = bt; b.ts = t;
    }
  }

  private push(press: boolean, button: number, ts: number): void {
    const q = this.queue[this.tail % QUEUE]!;
    q.press = press;
    q.button = button;
    q.ts = ts;
    this.tail++;
    if (this.tail - this.head > QUEUE) this.head = this.tail - QUEUE;
  }

  private releaseAll(ts: number): void {
    for (const code of Object.keys(BUTTON_KEYS)) {
      const b = BUTTON_KEYS[code]!;
      if (this.held & b) {
        this.held &= ~b;
        this.push(false, b, ts);
      }
    }
    for (const c of MOVE_CODES) this.moveHeld[c] = false;
  }

  /** Movement axes from the keys: x right, y forward. */
  axes(out: { x: number; y: number }): void {
    let x = 0;
    let y = 0;
    // Plain indexed loop: no iterator garbage every frame.
    for (let i = 0; i < MOVE_CODES.length; i++) {
      const code = MOVE_CODES[i]!;
      if (!this.moveHeld[code]) continue;
      const m = MOVE_KEYS[code]!;
      x += m[0];
      y += m[1];
    }
    const l = Math.hypot(x, y);
    out.x = l > 1 ? x / l : x;
    out.y = l > 1 ? y / l : y;
  }
}
