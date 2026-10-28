// Phase 8: the settings store, key bindings and the options a menu setup turns into (no DOM needed).
import { describe, expect, it } from 'vitest';
import { settingsFrom, defaultSettings } from '../../src/app/settings.ts';
import { ACTIONS, DEFAULT_KEYS, RESERVED, bindKey, keyTables, resolveKeys } from '../../src/game/input/bindings.ts';
import { directLaunch, optionsFromSetup } from '../../src/app/options.ts';

describe('settings store', () => {
  it('keeps known values and ignores anything else', () => {
    const s = settingsFrom({
      timing: 'strict', assist: 'bogus', volume: 7, crowd: 0.3, quality: 'ultra', swing: 'tap', textSize: 2,
      safeColours: 'yes', setup: { mode: 'singles', level: 'pro', court: 'narrow', partner: 'muro' }, keys: { drive: ['KeyZ'], lob: ['<script>'] },
    });
    expect(s.timing).toBe('strict');
    expect(s.assist).toBe(defaultSettings().assist);
    expect(s.volume).toBe(1);
    expect(s.crowd).toBe(0.3);
    expect(s.quality).toBe('ultra');
    expect(s.swing).toBe('tap');
    expect(s.textSize).toBe(1);
    expect(s.safeColours).toBe(false);
    expect(s.setup.mode).toBe('singles');
    expect(s.setup.level).toBe('pro');
    expect(s.setup.court).toBe('standard');
    expect(s.setup.partner).toBe('muro');
    expect(s.keys).toEqual({ drive: ['KeyZ'] });
  });
  it('survives garbage', () => {
    for (const g of [null, 3, 'x', [], { setup: 5 }, { keys: 'KeyJ' }]) expect(() => settingsFrom(g)).not.toThrow();
  });
});

describe('key bindings', () => {
  const owners = (keys: Record<string, string[]>): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const [a, codes] of Object.entries(keys)) for (const c of codes) m.set(c, [...(m.get(c) ?? []), a]);
    return m;
  };
  it('one key, one action, even when an action gives up its only key', () => {
    const k = resolveKeys({});
    bindKey(k, 'topspin', 'KeyJ');
    const again = resolveKeys(settingsFrom({ keys: k }).keys);
    expect(again.topspin![0]).toBe('KeyJ');
    expect(again.drive).toEqual([]);
    for (const [code, acts] of owners(again)) expect(acts, code).toHaveLength(1);
    expect(keyTables(again).buttons.KeyJ).toBe(ACTIONS.find((a) => a.id === 'topspin')!.button);
  });
  it('an unchanged action loses a default key another action was given', () => {
    // Stored by an older version: only the changed action.
    const k = resolveKeys({ lob: ['KeyW'] });
    expect(k.lob).toEqual(['KeyW']);
    expect(k.up).toEqual(['ArrowUp']);
    for (const [code, acts] of owners(k)) expect(acts, code).toHaveLength(1);
  });
  it('defaults are unique, two keys at most, and never reserved', () => {
    const k = resolveKeys(undefined);
    expect(k).toEqual(DEFAULT_KEYS);
    for (const [code, acts] of owners(k)) { expect(acts, code).toHaveLength(1); expect(RESERVED.has(code)).toBe(false); }
    expect(resolveKeys({ drive: ['Escape', 'KeyZ', 'KeyX', 'KeyC'] }).drive).toEqual(['KeyZ', 'KeyX']);
  });
});

describe('a menu setup as game options', () => {
  const params = new URLSearchParams('');
  it('numbers the players: you 0, partner 2, opponents 1 and 3', () => {
    const s = defaultSettings();
    s.setup = { ...s.setup, mode: 'doubles', partner: 'muro', opponents: 'martillo', length: 'three', hand: 'left', level: 'pro' };
    const o = optionsFromSetup(s.setup, s, 42, null, false, params);
    expect(o.match.human).toEqual([true, false, false, false]);
    expect(o.match.aiStyle![2]).toBe('muro');
    expect(o.match.aiStyle![1]).toBe('martillo');
    expect(o.match.aiStyle![3]).toBe('martillo');
    expect(o.match.lefty).toEqual([true, false, false, false]);
    expect(o.match.aiLevel).toEqual([1, 1]);
    expect(o.match.format).toMatchObject({ setsToWin: 2, gamesPerSet: 6 });
    expect(o.autoplay).toBe(false);
  });
  it('the title screen plays AI against AI, best of three', () => {
    const s = defaultSettings();
    const o = optionsFromSetup(s.setup, s, 1, null, true, params);
    expect(o.match.human!.every((h) => !h)).toBe(true);
    expect(o.autoplay).toBe(true);
    expect(o.attract).toBe(true);
    expect(o.match.format).toMatchObject({ setsToWin: 2 });
  });
  it('quality auto adapts from high; one-tap swings turn auto timing on', () => {
    const s = defaultSettings();
    s.swing = 'tap';
    const o = optionsFromSetup(s.setup, s, 1, null, false, params);
    expect(o.prefs!.adapt).toBe(true);
    expect(o.prefs!.quality!.name).toBe('High');
    expect(o.match.autoTiming).toBe(true);
    expect(o.match.tapSwing).toBe(true);
    s.quality = 'low';
    expect(optionsFromSetup(s.setup, s, 1, null, false, params).prefs!.adapt).toBe(false);
  });
  it('narrow singles turns into the standard court in doubles', () => {
    const s = defaultSettings();
    s.setup = { ...s.setup, mode: 'doubles', court: 'singles-narrow' };
    expect(optionsFromSetup(s.setup, s, 1, null, false, params).match.world!.court).toBe('standard');
  });
  it('page-only URL options keep the menus; any game option skips them', () => {
    expect(directLaunch(new URLSearchParams('backend=webgl&dpr=1&quality=low'))).toBe(false);
    expect(directLaunch(new URLSearchParams('autoplay=1'))).toBe(true);
    expect(directLaunch(new URLSearchParams('mode=singles'))).toBe(true);
  });
});
