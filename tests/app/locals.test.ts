// M6 phase A, local multiplayer: the seat rules, the far end's turned-round axes, and a pad held to one player
// (its own queue, never another pad's buttons).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seatsProblem, axisFlip, MAX_LOCALS, type LocalSeat } from '../../src/game/locals.ts';
import { GamepadInput } from '../../src/game/input/gamepad.ts';
import { InputQueue } from '../../src/game/input/queue.ts';
import { InputFrame, BTN_DRIVE, BTN_LOB } from '../../src/sim/input.ts';

describe('local seats', () => {
  it('take one player per seat and one seat per device', () => {
    expect(seatsProblem([{ player: 0, device: 'any' }], 4)).toBeNull();
    expect(seatsProblem([{ player: 0, device: 'keys' }, { player: 1, device: 0 }, { player: 2, device: 1 }, { player: 3, device: 2 }], 4)).toBeNull();
    expect(seatsProblem([], 4)).toMatch(/Nobody/);
    expect(seatsProblem([{ player: 0, device: 0 }, { player: 0, device: 1 }], 4)).toMatch(/one seat/);
    expect(seatsProblem([{ player: 0, device: 0 }, { player: 1, device: 0 }], 4)).toMatch(/One pad/);
    expect(seatsProblem([{ player: 0, device: 'keys' }, { player: 1, device: 'keys' }], 4)).toMatch(/keyboard/);
    // ('any' is the keyboard and the first pad: a lone player's)
    expect(seatsProblem([{ player: 0, device: 'any' }, { player: 1, device: 1 }], 4)).toMatch(/one device/);
    expect(seatsProblem([{ player: 2, device: 0 }], 2)).toMatch(/not on this court/);
    expect(seatsProblem([{ player: 0, device: 0 }, { player: 1, device: 1 }, { player: 2, device: 2 }], 2)).toMatch(/At most 2/);
    const five: LocalSeat[] = [0, 1, 2, 3, 4].map((i) => ({ player: i, device: i }));
    expect(seatsProblem(five, 6)).toMatch(`At most ${MAX_LOCALS}`);
  });

  it('turn the far end round', () => {
    expect(axisFlip(0, 0)).toBe(1);
    expect(axisFlip(1, 1)).toBe(1);
    expect(axisFlip(1, 0)).toBe(-1);
    expect(axisFlip(0, 1)).toBe(-1);
  });
});

/** Two pads as navigator.getGamepads reports them; `press` sets a standard button. */
function fakePads(): { pads: Array<{ index: number; connected: boolean; timestamp: number; buttons: Array<{ pressed: boolean; value: number }>; axes: number[] }>; press(pad: number, b: number, on: boolean): void } {
  const mk = (index: number) => ({ index, connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
  const pads = [mk(0), mk(1)];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  return { pads, press: (p, b, on) => { pads[p]!.buttons[b]!.pressed = on; pads[p]!.buttons[b]!.value = on ? 1 : 0; pads[p]!.timestamp += 5; } };
}

function fakeWindow(): Window {
  return { addEventListener: () => {} } as unknown as Window;
}

describe('a pad held to one player', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads only its pad, into its own queue', () => {
    const fp = fakePads();
    const a = new GamepadInput(fakeWindow(), undefined, 0), b = new GamepadInput(fakeWindow(), undefined, 1);
    const qa = new InputQueue(), qb = new InputQueue();
    // A on pad 1 is a drive for b; Y on pad 0 a lob for a.
    fp.press(1, 0, true);
    fp.press(0, 3, true);
    a.poll(qa, 100);
    b.poll(qb, 100);
    expect(a.held).toBe(BTN_LOB);
    expect(b.held).toBe(BTN_DRIVE);
    const fa = new InputFrame(), fb = new InputFrame();
    expect(qa.feed(fa, 0, 1000, 0, null)).toBe(BTN_LOB);
    expect(qb.feed(fb, 0, 1000, 0, null)).toBe(BTN_DRIVE);
    // A stick on pad 1 moves b only.
    fp.pads[1]!.axes[0] = 1;
    a.poll(qa, 120);
    b.poll(qb, 120);
    expect(a.x).toBe(0);
    expect(b.x).toBeCloseTo(1, 6);
  });

  it('never takes another pad when its own is missing', () => {
    fakePads();
    const c = new GamepadInput(fakeWindow(), undefined, 3);
    expect(c.connected).toBe(false);
    // (the one-player game's pad still takes the first there is)
    expect(new GamepadInput(fakeWindow()).connected).toBe(true);
  });

  it('lets go, back from a menu, of what its pad no longer holds', () => {
    const q = new InputQueue(), f = new InputFrame();
    q.resume(BTN_DRIVE | BTN_LOB, BTN_LOB, 500);
    expect(q.feed(f, 0, 1000, BTN_DRIVE | BTN_LOB, null)).toBe(BTN_LOB);
  });
});

describe('the seat chart', () => {
  it('lists pair 1 then pair 2, P1 first', async () => {
    const { chartOrder, seatsFromPicks, defaultPicks, seatLabel } = await import('../../src/app/localScreen.ts');
    expect(chartOrder(true)).toEqual([0, 2, 1, 3]);
    expect(chartOrder(false)).toEqual([0, 1]);
    expect(seatLabel(0, true)).toBe('Pair 1, drive');
    expect(seatLabel(3, true)).toBe('Pair 2, revés');
    // Two pads: the keyboard against the first pad, the second pad the keyboard's partner.
    const picks = defaultPicks([0, 1], true);
    expect(picks).toEqual(['keys', 0, 1, 'ai']);
    expect(seatsFromPicks(picks, true)).toEqual([{ player: 0, device: 'keys' }, { player: 2, device: 1 }, { player: 1, device: 0 }]);
    // Singles keeps the first two seats only.
    expect(seatsFromPicks(['ai', 'keys', 2, 3], false)).toEqual([{ player: 1, device: 'keys' }]);
  });

  it('makes a match of them: humans, P1 the camera end, even AI partners', async () => {
    const { optionsFromSetup, applyLocals } = await import('../../src/app/options.ts');
    const { DEFAULT_SETUP, defaultSettings, PARTNER_AI, LEVEL_AI } = await import('../../src/app/settings.ts');
    const setup = { ...DEFAULT_SETUP, mode: 'doubles' as const, level: 'club' as const, hand: 'left' as const };
    const o = optionsFromSetup(setup, defaultSettings(), 7, null, false, new URLSearchParams());
    applyLocals(o, [{ player: 1, device: 'keys' }, { player: 0, device: 0 }], setup);
    expect(o.human).toBe(1);
    expect(o.match.human).toEqual([true, true, false, false]);
    expect(o.match.lefty).toEqual([false, true, false, false]);
    // A player on each side: both AI partners at the partner's level.
    expect(o.match.aiLevel).toEqual([PARTNER_AI.club, PARTNER_AI.club]);
    const co = optionsFromSetup(setup, defaultSettings(), 7, null, false, new URLSearchParams());
    applyLocals(co, [{ player: 0, device: 0 }, { player: 2, device: 1 }], setup);
    expect(co.match.aiLevel).toEqual([PARTNER_AI.club, LEVEL_AI.club]);
  });

  it('deals pros only to the seats nobody here plays, every face once', async () => {
    const { dealRoster } = await import('../../src/app/roster.ts');
    for (let seed = 1; seed < 30; seed++) {
      const d = dealRoster(seed, 4, { human: 0, humans: [0, 1, 3] });
      expect(d.seats[0]).toBeNull();
      expect(d.seats[1]).toBeNull();
      expect(d.seats[3]).toBeNull();
      expect(d.seats[2]).not.toBeNull();
      const faces = [d.humanFace, d.otherFaces[1], d.otherFaces[3], d.seats[2]!.character.face];
      expect(faces.every((f) => typeof f === 'string')).toBe(true);
      expect(new Set(faces).size).toBe(4);
      // One player alone: the deal is the one-player deal it always was.
      expect(dealRoster(seed, 4, { human: 0, humans: [0] }).seats.map((p) => p?.id ?? null))
        .toEqual(dealRoster(seed, 4, { human: 0 }).seats.map((p) => p?.id ?? null));
    }
  });
});
