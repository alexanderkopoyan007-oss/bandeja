// M8 phase A: the settings the brief's accessibility list asks for that the game lacked: field of view, its own camera
// shake toggle, the pad's buttons rebound, Custom quality and a voices slider. All behind ?creator=1 until the owner
// has seen them: without the flag a stored choice plays as the game's own.
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, settingsFrom } from '../../src/app/settings.ts';
import { optionsFromSetup } from '../../src/app/options.ts';
import { DEFAULT_PAD, PAD_ACTIONS, PAD_BUTTONS, bindPad, padName, padTable, resolvePad } from '../../src/game/input/bindings.ts';
import { GamepadInput } from '../../src/game/input/gamepad.ts';
import { InputQueue } from '../../src/game/input/queue.ts';
import { InputFrame, BTN_DRIVE, BTN_DROP, BTN_POWER, BTN_SLICE, BTN_TOPSPIN } from '../../src/sim/input.ts';
import { customPreset, QUALITY } from '../../src/render/quality.ts';
import { BroadcastCamera, CAMERA_PRESETS, type CameraPreset } from '../../src/render/views.ts';
import { MatchSim } from '../../src/sim/match.ts';

const flag = new URLSearchParams('creator=1');
const none = new URLSearchParams('creator=0');

describe('the new settings are stored and checked', () => {
  it('keeps known values and ignores anything else', () => {
    const s = settingsFrom({ fov: 10, shake: false, voices: 0.4, quality: 'custom', resolution: 'three', shadows: 'off', glow: false,
      padKeys: { drive: [2], lob: [16], slice: ['x'], topspin: [3, 1] } });
    expect(s).toMatchObject({ fov: 10, shake: false, voices: 0.4, quality: 'custom', resolution: 'three', shadows: 'off', glow: false });
    // (16 is Home, past the standard buttons; a string is no button)
    expect(s.padKeys).toEqual({ drive: [2], topspin: [3, 1] });
    const bad = settingsFrom({ fov: 7, voices: 'loud', resolution: 'huge', shadows: 3, glow: 'yes', padKeys: 'A' });
    const d = defaultSettings();
    expect(bad).toMatchObject({ fov: d.fov, voices: d.voices, resolution: d.resolution, shadows: d.shadows, glow: d.glow, padKeys: {} });
    expect(d).toMatchObject({ fov: 0, shake: true, voices: 1, resolution: 'sharp', shadows: 'high', glow: true });
  });

  it('Custom by default is High', () => {
    const d = defaultSettings();
    expect({ ...customPreset(d.resolution, d.shadows, d.glow), name: 'High' }).toEqual(QUALITY.high);
    expect(customPreset('half', 'off', false)).toMatchObject({ maxDpr: 1, scale: 0.5, shadow: 0, bloom: false });
  });

  it('play as the game\'s own with ?creator=0, as set without it (on for everyone since 12 Nov 2026)', () => {
    const s = defaultSettings();
    Object.assign(s, { quality: 'custom', resolution: 'three', shadows: 'low', glow: false, fov: -5, shake: false, voices: 0.5, padKeys: { drive: [3] } });
    const off = optionsFromSetup(s.setup, s, 1, null, false, none).prefs!;
    // (Custom stored, switched off: Auto)
    expect(off.quality!.name).toBe('High');
    expect(off.adapt).toBe(true);
    expect(off).toMatchObject({ fov: 0, voices: 1, shake: true });
    expect(off.pad).toEqual(DEFAULT_PAD);
    const on = optionsFromSetup(s.setup, s, 1, null, false, new URLSearchParams('')).prefs!;
    expect(on.quality).toMatchObject({ name: 'Custom', maxDpr: 1, scale: 0.75, shadow: 1024, bloom: false });
    expect(on.adapt).toBe(false);
    expect(on).toMatchObject({ fov: -5, voices: 0.5, shake: false });
    expect(on.pad!.drive).toEqual([3]);
    // (Y went to the drive, so the lob has no button)
    expect(on.pad!.lob).toEqual([]);
    // Reduced motion turns the shake off whatever the setting says.
    s.shake = true;
    s.motion = 'reduced';
    expect(optionsFromSetup(s.setup, s, 1, null, false, flag).prefs!.shake).toBe(false);
  });
});

describe('the pad\'s buttons', () => {
  it('default to the layout the pad has had, each button one shot, never Start', () => {
    const seen = new Set<number>();
    for (const a of PAD_ACTIONS) {
      for (const b of DEFAULT_PAD[a.id]!) {
        expect(seen.has(b)).toBe(false);
        expect(PAD_BUTTONS).toContain(b);
        seen.add(b);
      }
    }
    expect(PAD_BUTTONS).not.toContain(9);
    expect(resolvePad(undefined)).toEqual(DEFAULT_PAD);
    expect(padName(0)).toBe('A');
    expect(padName(7)).toBe('RT');
  });

  it('one button, one shot: a button bound elsewhere leaves the shot that had it', () => {
    const p = resolvePad({});
    bindPad(p, 'drive', 2);
    expect(p.drive).toEqual([2]);
    expect(p.topspin).toEqual([]);
    // Stored and read back: the other shots keep their defaults less the taken button.
    const r = resolvePad({ drive: [13] });
    expect(r.drive).toEqual([13]);
    expect(r.drop).toEqual([11, 12]);
    expect(Array.from(padTable({ drive: [0], drop: [11, 13] }))).toEqual([0, BTN_DRIVE, 11, BTN_DROP, 13, BTN_DROP]);
  });
});

/** A pad as navigator.getGamepads reports it; `press` sets a standard button. */
function fakePad(): { press(b: number, value: number): void } {
  const pad = { index: 0, connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  return { press: (b, v) => { pad.buttons[b]!.pressed = v > 0.1; pad.buttons[b]!.value = v; pad.timestamp += 5; } };
}
const win = { addEventListener: () => {} } as unknown as Window;

describe('a pad with its buttons rebound', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('plays the shots it is given', () => {
    const fp = fakePad();
    const g = new GamepadInput(win);
    const q = new InputQueue();
    const p = resolvePad({ drive: [2], slice: [0] });
    g.setMap(p);
    fp.press(2, 1);
    g.poll(q, 100);
    expect(g.held).toBe(BTN_DRIVE);
    fp.press(0, 1);
    g.poll(q, 110);
    expect(g.held).toBe(BTN_DRIVE | BTN_SLICE);
    fp.press(2, 0);
    g.poll(q, 120);
    expect(g.held).toBe(BTN_SLICE);
    // (the topspin lost X to the drive: nothing holds it)
    expect(g.held & BTN_TOPSPIN).toBe(0);
    const f = new InputFrame();
    expect(q.feed(f, 0, 1000, 0, null)).toBe(BTN_SLICE);
  });

  it('a shot two buttons share is held while either is, and a trigger past half-way', () => {
    const fp = fakePad();
    const g = new GamepadInput(win);
    const q = new InputQueue();
    fp.press(11, 1);
    g.poll(q, 100);
    fp.press(13, 1);
    g.poll(q, 110);
    fp.press(11, 0);
    g.poll(q, 120);
    expect(g.held).toBe(BTN_DROP);
    fp.press(13, 0);
    g.poll(q, 130);
    expect(g.held).toBe(0);
    // The power on RT (7) as before: held past 0.5, let go under 0.4.
    fp.press(7, 0.45);
    g.poll(q, 140);
    expect(g.held).toBe(0);
    fp.press(7, 0.6);
    g.poll(q, 150);
    expect(g.held).toBe(BTN_POWER);
    fp.press(7, 0.45);
    g.poll(q, 160);
    expect(g.held).toBe(BTN_POWER);
    fp.press(7, 0.3);
    g.poll(q, 170);
    expect(g.held).toBe(0);
  });
});

describe('field of view', () => {
  it('adds to every rig\'s own lens in play, kept across a change of camera', () => {
    BroadcastCamera.cutaways = false;
    const sim = new MatchSim({ seed: 3, doubles: true, human: [false, false, false, false] });
    for (let k = 0; k < 240; k++) sim.step([null, null, null, null]);
    const ball = new THREE.Vector3(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
    const lens = (cam: BroadcastCamera): number => { cam.update(sim, 0, ball, sim.time); return cam.camera.fov; };
    for (const preset of Object.keys(CAMERA_PRESETS) as CameraPreset[]) {
      const a = new BroadcastCamera(16 / 9, 0, 1), b = new BroadcastCamera(16 / 9, 0, 1);
      a.setPreset(preset);
      b.setFovAdd(10);
      b.setPreset(preset);
      expect(lens(b) - lens(a)).toBeCloseTo(10, 6);
      b.setFovAdd(-5);
      expect(lens(b) - lens(a)).toBeCloseTo(-5, 6);
    }
    // Clamped to the setting's range.
    const c = new BroadcastCamera(16 / 9, 0, 1), d = new BroadcastCamera(16 / 9, 0, 1);
    c.setFovAdd(40);
    expect(lens(c) - lens(d)).toBeCloseTo(15, 6);
    BroadcastCamera.cutaways = true;
  });
});
