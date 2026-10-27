// Per-tick input for one player. Recorded frames + the seed reproduce a match exactly.

export const BTN_DRIVE = 1 << 0;
export const BTN_TOPSPIN = 1 << 1;
export const BTN_SLICE = 1 << 2;
export const BTN_LOB = 1 << 3;
export const BTN_DROP = 1 << 4;
export const BTN_POWER = 1 << 5;
export const BTN_PRECISION = 1 << 6;
/** Overhead: bandeja, or smash with power held. Holding it for a lob plans to take the ball in the air. */
export const BTN_OVERHEAD = 1 << 7;
/** Volley: take the ball in the air (a punch volley; with power flat and hard). Planned before the bounce. */
export const BTN_VOLLEY = 1 << 8;

/** Shot buttons in SHOT_* order (drive, topspin, slice, lob, drop). */
export const SHOT_BUTTONS = [BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP] as const;

export interface InputEvent {
  press: boolean;
  button: number;
  /** Exact sim time of the event (seconds), from the device timestamp. */
  t: number;
}

const MAX_EVENTS = 8;

export class InputFrame {
  /** Movement relative to the player: x = to their right, y = towards the net. -1..1. */
  moveX = 0;
  moveY = 0;
  /** Absolute aim target (mouse aim). When false, aim comes from the movement keys at release. */
  aimAbs = false;
  aimTX = 0;
  aimTZ = 0;
  /** Buttons held at the end of the tick. */
  held = 0;
  readonly ev: InputEvent[] = [];
  evCount = 0;

  constructor() {
    for (let i = 0; i < MAX_EVENTS; i++) this.ev.push({ press: false, button: 0, t: 0 });
  }

  clear(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.aimAbs = false;
    this.evCount = 0;
  }

  push(press: boolean, button: number, t: number): void {
    if (this.evCount >= MAX_EVENTS) return;
    const e = this.ev[this.evCount++]!;
    e.press = press;
    e.button = button;
    e.t = t;
  }

  copyFrom(o: InputFrame): void {
    this.moveX = o.moveX; this.moveY = o.moveY;
    this.aimAbs = o.aimAbs; this.aimTX = o.aimTX; this.aimTZ = o.aimTZ;
    this.held = o.held;
    this.evCount = o.evCount;
    for (let i = 0; i < o.evCount; i++) {
      const a = this.ev[i]!;
      const b = o.ev[i]!;
      a.press = b.press; a.button = b.button; a.t = b.t;
    }
  }
}
