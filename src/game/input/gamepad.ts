// Gamepad input (standard mapping), polled once a frame. Button changes carry Gamepad.timestamp (the same
// performance.now() time base as key events), so a release is judged at the moment the pad reported it. Rumble
// goes through the pad's vibrationActuator where the browser has one (Chrome, Edge).
import { DEFAULT_PAD, padTable } from './bindings.ts';
import type { InputQueue } from './queue.ts';

const DEADZONE = 0.22;

interface Actuator { playEffect(type: string, params: Record<string, number>): Promise<unknown> }

export class GamepadInput {
  held = 0;
  /** Left stick: x right, y forward (0 inside the dead zone). */
  x = 0;
  y = 0;
  private index = -1;
  private readonly down: boolean[] = [];
  private rumbleUntil = 0;
  private lastPoll = 0;
  /** The queue button changes go into (set by poll). */
  private kb: InputQueue | null = null;
  /** The pad this one is held to (a player of a local match, M6): -1 takes the first there is. */
  readonly fixed: number;
  /** The Start button (standard 9) went down: the pause menu. */
  onStart: (() => void) | null = null;
  /** The pad in use was disconnected. */
  onLost: (() => void) | null = null;
  private startDown = true;
  /** Rumble allowed (the Accessibility setting). */
  rumbleOn = true;
  /** [pad button, sim button] pairs (input/bindings.ts; Controls > Gamepad, M8). Several pad buttons may share a shot
   * (the drop: the right stick's click and the d-pad's up and down): it is held while any of them is. */
  private map = padTable(DEFAULT_PAD);

  /** The pad's bindings (resolvePad's). What is held carries over: a shot held under the old map is let go by the
   * next poll if no button of the new one holds it. */
  setMap(pad: Record<string, number[]>): void {
    this.map = padTable(pad);
  }

  /**
   * A menu used the Start press now down (Start on the pause screen resumes): the game must not take the same press
   * as a new one and pause again. The menu and the game poll the pad in the same frame, in either order.
   */
  consumeStart(): void {
    this.startDown = true;
  }

  /** `signal` removes the listeners (a game being torn down); `fixed`: only that pad (Gamepad.index), never another. */
  constructor(target: Window, signal?: AbortSignal, fixed = -1) {
    this.fixed = fixed;
    const o = { signal };
    // A pad connected before this game was built sends no new event: take the first one there is.
    try {
      for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected && this.index < 0 && this.mine(p.index)) this.index = p.index;
    } catch {
      // getGamepads can throw where a permissions policy blocks it: no pad.
    }
    target.addEventListener('gamepadconnected', (e) => {
      const i = (e as GamepadEvent).gamepad.index;
      if (this.index < 0 && this.mine(i)) this.index = i;
    }, o);
    target.addEventListener('gamepaddisconnected', (e) => {
      if ((e as GamepadEvent).gamepad.index === this.index) {
        this.index = -1;
        // Let go of whatever was held (else the sim's swing waits for a release that never comes), and forget
        // the buttons' states (else the next press of one after reconnecting reads as no change).
        for (let b = 1; b <= this.held; b <<= 1) if (this.held & b) this.kb?.inject(false, b, e.timeStamp);
        for (let k = 0; k < this.down.length; k++) this.down[k] = false;
        this.held = 0;
        this.x = 0;
        this.y = 0;
        this.onLost?.();
      }
    }, o);
    for (let i = 0; i < 17; i++) this.down.push(false);
  }

  get connected(): boolean {
    return this.index >= 0;
  }

  private mine(index: number): boolean {
    return this.fixed < 0 || index === this.fixed;
  }

  /** Read the pad; button changes go into `kb`, a timestamped queue (the keyboard's in a one-player game: one queue, one order). */
  poll(kb: InputQueue, now: number): void {
    this.kb = kb;
    if (this.index < 0) return;
    const pad = navigator.getGamepads()[this.index];
    if (!pad || !pad.connected) return;
    // A pad's timestamp is when it last reported anything (a moving stick included, so a button change can be
    // stamped up to a report late); kept between the last poll and now, so a stale or odd value can't land an
    // event far in the past.
    const raw = pad.timestamp || now;
    const ts = raw > now ? now : raw < this.lastPoll ? this.lastPoll : raw;
    this.lastPoll = now;
    const map = this.map;
    let want = 0;
    for (let k = 0; k < map.length; k += 2) {
      const i = map[k]!;
      const b = pad.buttons[i];
      if (!b) continue;
      // Triggers are analogue (Chromium flips `pressed` early in their travel): held past half-way, let go below
      // 40%, so a trigger resting near the line doesn't chatter.
      const on = i === 6 || i === 7 ? (this.down[i] ? b.value > 0.4 : b.value > 0.5) : b.pressed;
      this.down[i] = on;
      if (on) want |= map[k + 1]!;
    }
    // Each shot's change, in the order of its bit (a shot held by two buttons changes once).
    const changed = want ^ this.held;
    for (let bit = 1; bit <= changed; bit <<= 1) {
      if (!(changed & bit)) continue;
      kb.inject((want & bit) !== 0, bit, ts);
    }
    this.held = want;
    // Start opens the pause menu (on the press; held from before, e.g. the press that closed a menu, it waits).
    const st = pad.buttons[9]?.pressed ?? false;
    if (st && !this.startDown) this.onStart?.();
    this.startDown = st;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const l = Math.hypot(ax, ay);
    if (l < DEADZONE) { this.x = 0; this.y = 0; }
    else {
      // Rescale past the dead zone so the stick reaches full speed at the rim.
      const k = Math.min(1, (l - DEADZONE) / (1 - DEADZONE)) / l;
      this.x = ax * k;
      this.y = -ay * k;
    }
  }

  /**
   * Rumble: `strong` (low-frequency motor, a heavy hit) and `weak` (high-frequency, a crisp one), 0..1, for `ms`.
   * A new effect is dropped while another is still playing (the actuator would cut the first one off).
   */
  rumble(strong: number, weak: number, ms: number, now: number): void {
    if (this.index < 0 || !this.rumbleOn) return;
    const pad = navigator.getGamepads()[this.index];
    const act = (pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
    if (!act || now < this.rumbleUntil - 20) return;
    this.rumbleUntil = now + ms;
    void act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
