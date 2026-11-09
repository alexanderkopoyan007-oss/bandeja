// The players on this machine (M6 phase A, local multiplayer): who plays which player, with what, and each one's
// input on its way to the sim. A one-player game has one, on the keyboard and the first pad together, as before.
// The broadcast camera stands behind the first one's team; a player at the other end steers as the screen shows
// them (left on the stick goes left on the screen), so their axes are turned round.
import { InputFrame } from '../sim/input.ts';
import { GamepadInput } from './input/gamepad.ts';
import { InputQueue } from './input/queue.ts';
import type { KeyboardInput } from './input/keyboard.ts';

/** What a local player plays with: the keyboard (and mouse), one pad (its Gamepad.index), or both (one player alone). */
export type LocalDevice = 'any' | 'keys' | number;

export interface LocalSeat {
  /** Player number (team + 2 * slot). */
  player: number;
  device: LocalDevice;
}

/** Each local player's colour, P1 to P4 (Okabe-Ito: told apart with any colour vision): the ring under them and the seat chart. */
export const LOCAL_COLOURS = [0x56b4e9, 0xe69f00, 0x009e73, 0xf0e442];

/** The most players on one machine (the brief: up to four pads). */
export const MAX_LOCALS = 4;

/**
 * The seats as a match can take them, or why not: every player number on the court at most once, every device at
 * most once (the keyboard counts once, 'any' being the keyboard and a pad), at least one player.
 */
export function seatsProblem(seats: readonly LocalSeat[], players: number): string | null {
  if (!seats.length) return 'Nobody is playing.';
  if (seats.length > Math.min(MAX_LOCALS, players)) return `At most ${Math.min(MAX_LOCALS, players)} players.`;
  const used = new Set<number>(), devices = new Set<string>();
  for (const s of seats) {
    if (!Number.isInteger(s.player) || s.player < 0 || s.player >= players) return 'A seat that is not on this court.';
    if (used.has(s.player)) return 'Two players in one seat.';
    used.add(s.player);
    const keys = s.device === 'any' || s.device === 'keys';
    if (keys && devices.has('keys')) return 'The keyboard can play one seat.';
    if (keys) devices.add('keys');
    if (s.device === 'any' && seats.length > 1) return 'With two or more players each plays with one device.';
    if (typeof s.device === 'number') {
      if (!Number.isInteger(s.device) || s.device < 0) return 'Not a pad.';
      if (devices.has(`pad${s.device}`)) return 'One pad plays one seat.';
      devices.add(`pad${s.device}`);
    }
  }
  return null;
}

/** 1 for a player at the camera's end, -1 at the other (their stick and keys turned round to the screen). */
export function axisFlip(team: number, cameraTeam: number): number {
  return team === cameraTeam ? 1 : -1;
}

/** A player on this machine and their input on its way to the sim (nothing here allocates per tick). */
export class Local {
  readonly player: number;
  /** Reads the keyboard (whose queue is theirs). */
  readonly keys: boolean;
  readonly pad: GamepadInput | null;
  readonly queue: InputQueue;
  readonly frame = new InputFrame();
  readonly axes = { x: 0, y: 0 };
  /** Buttons held as of the last event handed to the sim. */
  simHeld = 0;
  /** axisFlip: 1 at the camera's end, -1 at the other. */
  flip = 1;
  /** The pad's buttons as a replay began (a new press skips it). */
  replayHeld = 0;

  constructor(seat: LocalSeat, kb: KeyboardInput, target: Window, signal: AbortSignal) {
    this.player = seat.player;
    this.keys = seat.device === 'any' || seat.device === 'keys';
    this.pad = seat.device === 'keys' ? null : new GamepadInput(target, signal, seat.device === 'any' ? -1 : seat.device);
    this.queue = this.keys ? kb : new InputQueue();
  }

  /** Buttons held now on this player's devices. */
  heldNow(kb: KeyboardInput): number {
    return (this.keys ? kb.held : 0) | (this.pad ? this.pad.held : 0);
  }
}
