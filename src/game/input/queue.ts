// A device's button events with their exact times, waiting for the sim (M6 phase A: one queue per player on this
// machine). The keyboard is one (KeyboardInput extends it); a pad held by one player feeds a queue of its own
// (GamepadInput.poll), and the one-player game's pad feeds the keyboard's, as before.
import type { InputFrame } from '../../sim/input.ts';

export interface TimedButton { press: boolean; button: number; ts: number }

const QUEUE = 32;

export class InputQueue {
  /** Ring of timestamped button events not yet consumed by the sim. */
  readonly queue: TimedButton[] = [];
  head = 0;
  tail = 0;

  constructor() {
    for (let i = 0; i < QUEUE; i++) this.queue.push({ press: false, button: 0, ts: 0 });
  }

  /** While input goes to a menu (paused): drop queued events, so nothing reaches the sim. */
  flush(): void {
    this.head = this.tail;
  }

  /**
   * Back from a menu at `ts`: drop what was queued while it was up, then let go, at `ts`, of every button the sim
   * still holds (`simHeld`) that nothing holds now (`heldNow`). See KeyboardInput.resume.
   */
  resume(simHeld: number, heldNow: number, ts: number): void {
    this.flush();
    this.releaseStale(simHeld & ~heldNow, ts);
  }

  protected releaseStale(stale: number, ts: number): void {
    for (let b = 1; b <= stale; b <<= 1) if (stale & b) this.push(false, b, ts);
  }

  /**
   * Hand the sim's frame `f` every queued event stamped before `endMs`, at its exact sim time (`epoch`: the sim's
   * zero, performance.now() ms), and return the buttons held as of the last event handed over (`simHeld` before).
   * `onEvent` sees each one (the latency probe; allocation-free when null).
   */
  feed(f: InputFrame, epoch: number, endMs: number, simHeld: number, onEvent: ((ts: number, press: boolean) => void) | null): number {
    let held = simHeld;
    const q = this.queue;
    while (this.head < this.tail) {
      const e = q[this.head % QUEUE]!;
      if (e.ts >= endMs) break;
      f.push(e.press, e.button, Math.max(0, (e.ts - epoch) / 1000));
      held = e.press ? held | e.button : held & ~e.button;
      this.head++;
      onEvent?.(e.ts, e.press);
    }
    return held;
  }

  /**
   * A button event from another device (the gamepad), into the queue in time order: a pad's stamp can be earlier
   * than a key event already queued, and the sim takes events up to the first one past a tick.
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

  protected push(press: boolean, button: number, ts: number): void {
    const q = this.queue[this.tail % QUEUE]!;
    q.press = press;
    q.button = button;
    q.ts = ts;
    this.tail++;
    if (this.tail - this.head > QUEUE) this.head = this.tail - QUEUE;
  }
}
