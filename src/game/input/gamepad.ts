// Gamepad input (standard mapping), polled once a frame. Button changes carry Gamepad.timestamp (the same
// performance.now() time base as key events), so a release is judged at the moment the pad reported it. Rumble
// goes through the pad's vibrationActuator where the browser has one (Chrome, Edge).
import { BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP, BTN_OVERHEAD, BTN_VOLLEY, BTN_POWER, BTN_PRECISION } from '../../sim/input.ts';
import type { KeyboardInput } from './keyboard.ts';

/**
 * Standard-mapping button index -> sim button. Face buttons are the four ground strokes and the lob, the bumpers
 * the two shots taken in the air (volley, overhead), the triggers the modifiers (power, precision) and the d-pad
 * the touch shot (drop).
 */
const MAP: Array<[number, number]> = [
  [0, BTN_DRIVE], // A / cross
  [2, BTN_TOPSPIN], // X / square
  [1, BTN_SLICE], // B / circle
  [3, BTN_LOB], // Y / triangle
  [4, BTN_VOLLEY], // left bumper
  [5, BTN_OVERHEAD], // right bumper
  [7, BTN_POWER], // right trigger
  [6, BTN_PRECISION], // left trigger
  [13, BTN_DROP], // d-pad down
  [12, BTN_DROP], // d-pad up
];

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

  constructor(target: Window) {
    target.addEventListener('gamepadconnected', (e) => {
      if (this.index < 0) this.index = (e as GamepadEvent).gamepad.index;
    });
    target.addEventListener('gamepaddisconnected', (e) => {
      if ((e as GamepadEvent).gamepad.index === this.index) {
        this.index = -1;
        this.held = 0;
        this.x = 0;
        this.y = 0;
      }
    });
    for (let i = 0; i < 17; i++) this.down.push(false);
  }

  get connected(): boolean {
    return this.index >= 0;
  }

  /** Read the pad; button changes go into the keyboard's timestamped queue (one queue, one order). */
  poll(kb: KeyboardInput, now: number): void {
    if (this.index < 0) return;
    const pad = navigator.getGamepads()[this.index];
    if (!pad || !pad.connected) return;
    // A pad's timestamp is when it last reported anything (a moving stick included, so a button change can be
    // stamped up to a report late); kept between the last poll and now, so a stale or odd value can't land an
    // event far in the past.
    const raw = pad.timestamp || now;
    const ts = raw > now ? now : raw < this.lastPoll ? this.lastPoll : raw;
    this.lastPoll = now;
    for (let k = 0; k < MAP.length; k++) {
      const m = MAP[k]!;
      const b = pad.buttons[m[0]];
      if (!b) continue;
      // Triggers are analogue (Chromium flips `pressed` early in their travel): held past half-way, let go below
      // 40%, so a trigger resting near the line doesn't chatter.
      const trigger = m[0] === 6 || m[0] === 7;
      const on = trigger ? (this.down[m[0]] ? b.value > 0.4 : b.value > 0.5) : b.pressed;
      if (on === this.down[m[0]]) continue;
      this.down[m[0]] = on;
      const was = (this.held & m[1]) !== 0;
      // Two pad buttons share the drop: it is held while either is.
      const any = on || (m[1] === BTN_DROP && (this.down[12] || this.down[13]));
      if (any === was) continue;
      this.held = any ? this.held | m[1] : this.held & ~m[1];
      kb.inject(any, m[1], ts);
    }
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
    if (this.index < 0) return;
    const pad = navigator.getGamepads()[this.index];
    const act = (pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
    if (!act || now < this.rumbleUntil - 20) return;
    this.rumbleUntil = now + ms;
    void act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
