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

/** The bindings in use: the defaults with the player's changes over them. */
export function resolveKeys(custom: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of ACTIONS) {
    const c = custom?.[a.id];
    out[a.id] = c && c.length ? c.filter((k) => !RESERVED.has(k)).slice(0, 2) : DEFAULT_KEYS[a.id]!.slice();
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
