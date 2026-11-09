// Keyboard + mouse input with exact timestamps. Key events carry event.timeStamp (performance.now() time base),
// so a release is judged at the moment it happened, not when the next frame polls it.
// Which key is which button comes from the bindings (input/bindings.ts; remappable since Phase 8).
import { DEFAULT_KEYS, keyTables } from './bindings.ts';
import { InputQueue } from './queue.ts';

export type { TimedButton } from './queue.ts';

export class KeyboardInput extends InputQueue {
  held = 0;
  private buttonKeys: Record<string, number> = {};
  private moveKeys: Record<string, [number, number]> = {};
  private moveCodes: string[] = [];
  private readonly moveHeld: Record<string, boolean> = {};
  /** Button keys down by code: two keys can make one button (both Shifts), held while either is. */
  private readonly codeDown: Record<string, boolean> = {};
  /** Mouse position in normalised device coordinates (-1..1), for mouse aim. */
  mouseX = 0;
  mouseY = 0;
  mouseActive = false;
  onKey: ((code: string, ev: KeyboardEvent) => void) | null = null;

  /** `signal` removes the listeners (a game being torn down); `keys`: action -> key codes (bindings.ts). */
  constructor(target: Window, signal?: AbortSignal, keys: Record<string, string[]> = DEFAULT_KEYS) {
    super();
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
  override flush(): void {
    this.releaseAll(performance.now());
    this.head = this.tail;
  }

  /**
   * Back from a menu at `ts`: drop what was queued while it was up, then let go, at `ts`, of every button the sim
   * still holds (`simHeld`) that nothing holds now (`heldNow`: the pad's buttons, which stay true through a pause;
   * the keys were all let go at the pause and the menu took their key-ups). A swing charged when the game paused
   * (Esc or a lost window while holding J, the pad unplugged) is then released at the resume moment and judged
   * like any release, instead of waiting for a release the pause had dropped. Every change the sim sees is an
   * input event, so a replay of the frames is the same match.
   */
  override resume(simHeld: number, heldNow: number, ts: number): void {
    this.flush();
    this.releaseStale(simHeld & ~(this.held | heldNow), ts);
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
