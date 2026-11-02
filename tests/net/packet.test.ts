// The wire keeps the bits: a frame that comes back different would split the sims.
import { describe, expect, it } from 'vitest';
import { InputFrame, BTN_DRIVE, BTN_POWER } from '../../src/sim/input.ts';
import { decodeInput, encodeInput } from '../../src/net/packet.ts';
import { EMPTY, takeFrame } from '../../src/net/rollback.ts';
import { DT } from '../../src/sim/core/constants.ts';

function frameAt(tick: number, i: number) {
  const f = new InputFrame();
  f.moveX = Math.sin(i) * 0.73;
  f.moveY = i % 3 === 0 ? 1 : -0.31;
  f.held = i % 5 === 0 ? BTN_DRIVE | BTN_POWER : 0;
  if (i % 4 === 0) { f.aimAbs = true; f.aimTX = 1.2345678 + i; f.aimTZ = -7.654321; }
  if (i % 7 === 0) { f.push(true, BTN_DRIVE, tick * DT + 0.0031 * (i % 3)); f.push(false, BTN_POWER, tick * DT + 1e-7); }
  return takeFrame(f, tick, 0.05);
}

describe('input packets', () => {
  it('a frame comes back with exactly the same bits', () => {
    for (const first of [0, 7, 431_999, 3_000_000]) {
      const frames = Array.from({ length: 64 }, (_, i) => frameAt(first + i, i));
      const back = decodeInput(encodeInput({ seat: 3, first, frames, ack: 41, tick: first + 9, hashTick: 120, hash: 0xfedcba98 }));
      expect(back.seat).toBe(3);
      expect(back.first).toBe(first);
      expect(back.ack).toBe(41);
      expect(back.hash).toBe(0xfedcba98);
      expect(back.frames).toEqual(frames);
    }
  });

  it('nothing acknowledged yet is -1, and runs of still frames stay small', () => {
    const still = frameAt(10, 1);
    still.ev.length = 0;
    const frames = new Array(32).fill(still);
    const b = encodeInput({ seat: 0, first: 10, frames, ack: -1, tick: 12, hashTick: 0, hash: 0 });
    expect(b.byteLength).toBeLessThan(40);
    expect(decodeInput(b).ack).toBe(-1);
    expect(decodeInput(b).frames.length).toBe(32);
  });

  it('a stick a hair off centre is the same bits at both ends', () => {
    const f = new InputFrame();
    f.moveX = -0.001;
    const t = takeFrame(f, 10, 0), back = decodeInput(encodeInput({ seat: 0, first: 10, frames: [t], ack: 0, tick: 10, hashTick: 0, hash: 0 })).frames[0]!;
    expect(Object.is(t.x, back.x)).toBe(true);
    expect(Object.is(t.x, 0)).toBe(true);
  });

  it('refuses a short packet that claims thousands of frames', () => {
    const b = new Uint8Array(encodeInput({ seat: 0, first: 0, frames: [EMPTY], ack: 0, tick: 0, hashTick: 0, hash: 0 }));
    new DataView(b.buffer).setUint16(2, 60000, true);
    expect(() => decodeInput(b.buffer)).toThrow();
  });
});
