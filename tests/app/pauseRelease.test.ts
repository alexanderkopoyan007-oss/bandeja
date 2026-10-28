// Phase 8 review: pausing while a swing is held (Esc with J down, the window lost, the pad unplugged) dropped the
// release, and after the resume the sim's swing stayed charged: the movement keys kept steering the aim, other shot
// keys did nothing and the swing went off by itself late. The keyboard's queue, as the game drives it (no browser).
import { describe, expect, it } from 'vitest';
import { KeyboardInput } from '../../src/game/input/keyboard.ts';
import { MatchSim, PH_OVER } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SW_CHARGE } from '../../src/sim/player/player.ts';

/** A window stand-in: the keyboard's listeners, called with plain key events. */
function fakeWindow(): { target: Window; key(type: 'keydown' | 'keyup', code: string, ms: number): void } {
  const on: Record<string, ((e: unknown) => void)[]> = {};
  const target = { addEventListener: (t: string, fn: (e: unknown) => void) => { (on[t] ??= []).push(fn); } } as unknown as Window;
  return { target, key: (type, code, ms) => { for (const fn of on[type] ?? []) fn({ code, timeStamp: ms, repeat: false, preventDefault() {} }); } };
}

/**
 * The game's loop with sim time = performance-clock time (epoch 0): the serve's toss is charged with J, the game
 * pauses (the menu takes the key-up), and resumes. `resume` = the fix (KeyboardInput.resume); without it the
 * resume only flushed. Returns the swing state a while after the resume and whether the release was judged then.
 */
function pauseWhileHolding(resume: boolean, padHeld = 0): { charged: boolean; releasedAt: number } {
  const m = new MatchSim({ seed: 3, human: [true, false], firstServer: 0 });
  const w = fakeWindow();
  const kb = new KeyboardInput(w.target);
  const f = new InputFrame();
  let held = 0;
  const step = (): void => {
    f.clear();
    held = kb.feed(f, 0, (m.time + DT) * 1000, held, null);
    if (kb.head === kb.tail) held = kb.held | padHeld;
    f.held = held;
    m.step([f, null]);
  };
  while (m.time < m.phaseUntil + DT) step();
  // J down: the ball is dropped and the serve's swing charges.
  w.key('keydown', 'KeyJ', m.time * 1000 + 1);
  for (let k = 0; k < 6; k++) step();
  expect(m.players[0]!.swing).toBe(SW_CHARGE);
  // Esc: the game pauses (Game.setMenuPaused(true) flushes); J is let go while the menu has the keys.
  kb.flush();
  // ...and resumes (the sim stood still meanwhile: the resume is at the sim's present).
  const at = m.time * 1000 + 0.5;
  if (resume) kb.resume(held, padHeld, at);
  else kb.flush();
  let releasedAt = -1;
  for (let k = 0; k < 24 && m.phase !== PH_OVER; k++) {
    step();
    if (releasedAt < 0 && m.players[0]!.swing !== SW_CHARGE) releasedAt = m.time;
  }
  return { charged: m.players[0]!.swing === SW_CHARGE, releasedAt };
}

describe('a swing held through a pause', () => {
  it('is let go at the resume moment, as a release the sim judges', () => {
    const r = pauseWhileHolding(true);
    expect(r.charged).toBe(false);
    expect(r.releasedAt).toBeGreaterThan(0);
  });

  it('was left charged before the fix (the test sees the bug)', () => {
    expect(pauseWhileHolding(false).charged).toBe(true);
  });

  it('stays charged while the pad still holds the button (nothing was let go)', () => {
    expect(pauseWhileHolding(true, BTN_DRIVE).charged).toBe(true);
  });

  it('queues one release per stale button, at the resume time, and nothing for buttons still held', () => {
    const w = fakeWindow();
    const kb = new KeyboardInput(w.target);
    kb.flush();
    kb.resume(BTN_DRIVE | 4 | 64, 64, 1234.5);
    const ev = [];
    for (let k = kb.head; k < kb.tail; k++) ev.push({ ...kb.queue[k % kb.queue.length]! });
    expect(ev).toEqual([{ press: false, button: BTN_DRIVE, ts: 1234.5 }, { press: false, button: 4, ts: 1234.5 }]);
  });
});
