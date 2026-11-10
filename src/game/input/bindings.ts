// Keyboard bindings (Phase 8): which keys are which button, remappable from the Controls screen. Each action has up to
// two keys; the defaults are the layout the game has had since M1.
import { BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_DROP, BTN_OVERHEAD, BTN_VOLLEY, BTN_POWER, BTN_PRECISION } from '../../sim/input.ts';

export interface Action {
  id: string;
  label: string;
  /** The sim button (0 for a movement direction). */
  button: number;
  /** A movement direction: x right, y forward. */
  move?: [number, number];
}

export const ACTIONS: Action[] = [
  { id: 'up', label: 'Move forward', button: 0, move: [0, 1] },
  { id: 'down', label: 'Move back', button: 0, move: [0, -1] },
  { id: 'left', label: 'Move left', button: 0, move: [-1, 0] },
  { id: 'right', label: 'Move right', button: 0, move: [1, 0] },
  { id: 'drive', label: 'Drive', button: BTN_DRIVE },
  { id: 'topspin', label: 'Topspin', button: BTN_TOPSPIN },
  { id: 'slice', label: 'Slice', button: BTN_SLICE },
  { id: 'lob', label: 'Lob', button: BTN_LOB },
  { id: 'drop', label: 'Drop shot', button: BTN_DROP },
  { id: 'overhead', label: 'Overhead', button: BTN_OVERHEAD },
  { id: 'volley', label: 'Volley', button: BTN_VOLLEY },
  { id: 'power', label: 'Power', button: BTN_POWER },
  { id: 'precision', label: 'Precision', button: BTN_PRECISION },
];

export const DEFAULT_KEYS: Record<string, string[]> = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  drive: ['KeyJ'], topspin: ['KeyK'], slice: ['KeyL'], lob: ['KeyI'], drop: ['KeyU'], overhead: ['KeyO'], volley: ['KeyN'],
  power: ['Space'], precision: ['ShiftLeft', 'ShiftRight'],
};

/** Keys the game keeps for itself (pause, debug, help, pro mode, mouse aim): never bound to an action. */
export const RESERVED = new Set(['Escape', 'F3', 'KeyH', 'KeyP', 'KeyM', 'Tab', 'Enter']);

/**
 * The bindings in use: the defaults with the player's changes over them. An action stored with no keys has none (its
 * key went to another action); giving it its default back would put one key on two actions.
 */
export function resolveKeys(custom: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const taken = new Set<string>();
  for (const a of ACTIONS) {
    const c = custom?.[a.id];
    if (c) for (const k of c) taken.add(k);
  }
  for (const a of ACTIONS) {
    const c = custom?.[a.id];
    // An action the player never changed keeps its defaults, less any key they have since given to another action.
    out[a.id] = c ? c.filter((k) => !RESERVED.has(k)).slice(0, 2) : DEFAULT_KEYS[a.id]!.filter((k) => !taken.has(k));
  }
  return out;
}

/** Bind `code` to `action` as its first key; any other action that had it loses it (one key, one action). */
export function bindKey(keys: Record<string, string[]>, action: string, code: string): void {
  for (const id of Object.keys(keys)) keys[id] = keys[id]!.filter((k) => k !== code);
  const cur = keys[action] ?? [];
  keys[action] = [code, ...cur.filter((k) => k !== code)].slice(0, 2);
}

/** A key code as the player knows it: KeyJ -> J, ArrowUp -> ↑, ShiftLeft -> Shift. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const named: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt', MetaLeft: 'Cmd', MetaRight: 'Right Cmd',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`', Backspace: 'Backspace',
  };
  return named[code] ?? code;
}

/** Which button each key is, and which direction (the keyboard's lookup tables). */
export function keyTables(keys: Record<string, string[]>): { buttons: Record<string, number>; moves: Record<string, [number, number]> } {
  const buttons: Record<string, number> = {};
  const moves: Record<string, [number, number]> = {};
  for (const a of ACTIONS) {
    for (const code of keys[a.id] ?? []) {
      if (a.move) moves[code] = a.move;
      else buttons[code] = a.button;
    }
  }
  return { buttons, moves };
}

// ---- The gamepad's buttons (M8): which pad button is which shot, remappable from the Controls screen ---------------

/** Standard-mapping button indices the player may bind: everything but Start (9, the pause, kept) and Home (16). */
export const PAD_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
/** The shots a pad button can be (the stick moves, as it always has). */
export const PAD_ACTIONS = ACTIONS.filter((a) => !a.move);

/**
 * The pad's layout since Phase 5: face buttons the four ground strokes and the lob, the bumpers the two shots taken in
 * the air (volley, overhead), the triggers the modifiers (power, precision), the right stick's click the drop (the
 * d-pad's up and down too: under the aiming thumb, so the stick's click is the one to use).
 */
export const DEFAULT_PAD: Record<string, number[]> = {
  drive: [0], slice: [1], topspin: [2], lob: [3], volley: [4], overhead: [5], precision: [6], power: [7], drop: [11, 13, 12],
};

/** The pad's bindings in use: the defaults with the player's changes over them (as resolveKeys: one button, one shot). */
export function resolvePad(custom: Record<string, number[]> | undefined): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const taken = new Set<number>();
  for (const a of PAD_ACTIONS) for (const b of custom?.[a.id] ?? []) taken.add(b);
  for (const a of PAD_ACTIONS) {
    const c = custom?.[a.id];
    out[a.id] = c ? c.filter((b) => PAD_BUTTONS.includes(b)).slice(0, 3) : DEFAULT_PAD[a.id]!.filter((b) => !taken.has(b));
  }
  return out;
}

/** Bind pad button `b` to `action` as its only button; any other shot that had it loses it. */
export function bindPad(pad: Record<string, number[]>, action: string, b: number): void {
  for (const id of Object.keys(pad)) pad[id] = pad[id]!.filter((x) => x !== b);
  pad[action] = [b];
}

/** The pad's (standard mapping) buttons as an Xbox-style pad names them. */
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'Left stick click', 'Right stick click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
export function padName(b: number): string {
  return PAD_NAMES[b] ?? `Button ${b}`;
}
/** The same, short, for a menu row's value (three buttons on the drop must fit beside its label at 125% text). */
const PAD_SHORT = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→'];
export function padShort(b: number): string {
  return PAD_SHORT[b] ?? `B${b}`;
}

/** [pad button, sim button] pairs, flat (the pad's lookup table: read every frame, so no objects). */
export function padTable(pad: Record<string, number[]>): Int32Array {
  const pairs: number[] = [];
  for (const a of PAD_ACTIONS) for (const b of pad[a.id] ?? []) pairs.push(b, a.button);
  return Int32Array.from(pairs);
}
