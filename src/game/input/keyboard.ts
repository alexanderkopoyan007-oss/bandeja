// Keyboard + mouse input with exact timestamps. Key events carry event.timeStamp (performance.now() time base),
// so a release is judged at the moment it happened, not when the next frame polls it.
// Which key is which button comes from the bindings (input/bindings.ts; remappable since Phase 8).
import { DEFAULT_KEYS, keyTables } from './bindings.ts';

export interface TimedButton { press: boolean; button: number; ts: number }

const QUEUE = 32;

export class KeyboardInput {
  held = 0;
  private buttonKeys: Record<string, number> = {};
  private moveKeys: Record<string, [number, number]> = {};
  private moveCodes: string[] = [];
  private readonly moveHeld: Record<string, boolean> = {};
  /** Button keys down by code: two keys can make one button (both Shifts), held while either is. */
  private readonly codeDown: Record<string, boolean> = {};
  /** Ring of timestamped button events not yet consumed by the sim. */
  readonly queue: TimedButton[] = [];
  head = 0;
  tail = 0;
  /** Mouse position in normalised device coordinates (-1..1), for mouse aim. */
  mouseX = 0;
  mouseY = 0;
  mouseActive = false;
  onKey: ((code: string, ev: KeyboardEvent) => void) | null = null;

  /** `signal` removes the listeners (a game being torn down); `keys`: action -> key codes (bindings.ts). */
  constructor(target: Window, signal?: AbortSignal, keys: Record<string, string[]> = DEFAULT_KEYS) {
    for (let i = 0; i < QUEUE; i++) this.queue.push({ press: false, button: 0, ts: 0 });
    this.setKeys(keys);
    const o = { signal };
    target.addEventListener('keydown', (e) => this.key(e, true), o);
    target.addEventListener('keyup', (e) => this.key(e, false), o);
    target.addEventListener('blur', () => this.releaseAll(performance.now()), o);
    target.addEventListener('pointermove', (e) => {
      this.mouseX = (e.clientX / innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / innerHeight) * 2 + 1;
      this.mouseActive = true;
    }, o);
  }

  /** New bindings: everything held is let go first (a held key may no longer be that button). */
  setKeys(keys: Record<string, string[]>): void {
    this.releaseAll(performance.now());
    const t = keyTables(keys);
    this.buttonKeys = t.buttons;
    this.moveKeys = t.moves;
    this.moveCodes = Object.keys(t.moves);
    for (const c of this.moveCodes) this.moveHeld[c] = false;
  }

  /** While input goes to a menu (paused): drop queued events and let go of everything, so nothing reaches the sim. */
  flush(): void {
    this.releaseAll(performance.now());
    this.head = this.tail;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const btn = this.buttonKeys[e.code];
    if (btn !== undefined || this.moveKeys[e.code]) e.preventDefault();
    if (e.repeat) return;
    if (btn !== undefined) {
      this.codeDown[e.code] = down;
      let any = false;
      for (const c in this.buttonKeys) if (this.buttonKeys[c] === btn && this.codeDown[c]) any = true;
      const was = (this.held & btn) !== 0;
      if (any === was) return;
      this.held = any ? this.held | btn : this.held & ~btn;
      this.push(any, btn, e.timeStamp);
    } else if (this.moveKeys[e.code]) {
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

  /** Move every queued event stamped before `t` up to `t` (the game dropped a backlog: those moments are gone). */
  clampQueue(t: number): void {
    for (let k = this.head; k < this.tail; k++) {
      const q = this.queue[k % QUEUE]!;
      if (q.ts < t) q.ts = t;
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
    for (const code of Object.keys(this.buttonKeys)) {
      const b = this.buttonKeys[code]!;
      this.codeDown[code] = false;
      if (this.held & b) {
        this.held &= ~b;
        this.push(false, b, ts);
      }
    }
    for (const c of this.moveCodes) this.moveHeld[c] = false;
  }

  /** Movement axes from the keys: x right, y forward. */
  axes(out: { x: number; y: number }): void {
    let x = 0;
    let y = 0;
    // Plain indexed loop: no iterator garbage every frame.
    const codes = this.moveCodes;
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      if (!this.moveHeld[code]) continue;
      const m = this.moveKeys[code]!;
      x += m[0];
      y += m[1];
    }
    const l = Math.hypot(x, y);
    out.x = l > 1 ? x / l : x;
    out.y = l > 1 ? y / l : y;
  }
}
