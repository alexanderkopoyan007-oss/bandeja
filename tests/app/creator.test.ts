// M5 phase D: the Players screens and the creator (src/app/creator.ts) driven as the menu would drive them, with the
// store in memory and no studio (the turntable is checked in the browser: tools/creator-shots.mjs).
import { describe, expect, it } from 'vitest';
import { Creator, faceLabel, fromScale, toScale, type CreatorHost } from '../../src/app/creator.ts';
import { decodeCharacter, defaultCharacter, encodeCharacter, FACES } from '../../src/app/character.ts';
import { memoryBackend, Store } from '../../src/app/store.ts';
import { COSMETICS } from '../../src/app/unlocks.ts';
import { PROPORTION_KEYS, RANGES } from '../../src/render/avatar/proportions.ts';
import type { Item, Menu, Screen } from '../../src/ui/menu/menu.ts';
import type { GameOptions } from '../../src/game/game.ts';
import type { Studio } from '../../src/game/studio.ts';

/** The menu's stack, as far as the creator uses it. */
class FakeMenu {
  stack: Screen[] = [];
  get current(): Screen | null { return this.stack[this.stack.length - 1] ?? null; }
  open(s: Screen): void { this.stack.push(s); }
  replace(s: Screen): void { this.stack.pop(); this.stack.push(s); }
  pop(): void { this.stack.pop(); }
  back(): void { const s = this.current; if (s?.back) s.back(); else this.pop(); }
  refresh(): void {}
}

async function setup(owned = false): Promise<{ menu: FakeMenu; store: Store; creator: Creator; dressed: number[] }> {
  const store = await Store.open(memoryBackend());
  if (owned) for (const c of COSMETICS) store.owned.add(c.id);
  const menu = new FakeMenu();
  const dressed: number[] = [];
  // (the turntable as the creator sees it: dressed, and its drill)
  const turntable = { playing: -1, show: (o: GameOptions): void => { void o; dressed.push(1); }, play(d: number): void { this.playing = d; } };
  const host: CreatorHost = {
    menu: menu as unknown as Menu,
    store: () => store,
    studio: () => turntable as unknown as Studio,
    leaveStudio: () => undefined,
    options: (c) => ({ me: c }) as unknown as GameOptions,
    confirm: (title, sub, _d, yes) => ({ id: 'confirm', title, sub, items: [{ kind: 'button', label: 'Yes', action: yes }] }),
  };
  const creator = new Creator(host);
  menu.open(creator.playersScreen());
  return { menu, store, creator, dressed };
}

const item = (s: Screen | null, label: string): Item => {
  const it = s!.items.find((x) => x.label === label);
  if (!it) throw new Error(`no item ${label} on ${s?.id}`);
  return it;
};
const press = (s: Screen | null, label: string): void => item(s, label).action!();

describe('the creator', () => {
  it('a slider’s middle is the preset’s own size in either mode, its ends the mode’s range', () => {
    for (const mode of ['real', 'silly'] as const) {
      for (const k of PROPORTION_KEYS) {
        const r = RANGES[mode][k];
        expect(toScale(0.5, r)).toBeCloseTo(1, 12);
        expect(toScale(0, r)).toBeCloseTo(r[0], 12);
        expect(toScale(1, r)).toBeCloseTo(r[1], 12);
        for (const v of [0, 0.2, 0.5, 0.75, 1]) expect(fromScale(toScale(v, r), r)).toBeCloseTo(v, 12);
      }
    }
    // (the presets are numbered by sex)
    expect(faceLabel(FACES[0]!.id)).toBe('Man 1');
    expect(faceLabel(FACES.find((f) => f.woman)!.id)).toBe('Woman 1');
    expect(new Set(FACES.map((f) => faceLabel(f.id))).size).toBe(FACES.length);
  });

  it('makes a player: a name typed as a keyboard types it, a body, saved, and the first one plays', async () => {
    const { menu, store, dressed } = await setup();
    expect(menu.current!.id).toBe('players');
    expect(item(menu.current, 'Play as the dealt players').hidden!()).toBe(true);
    press(menu.current, 'Create a player');
    expect(menu.current!.id).toBe('creator');
    const name = item(menu.current, 'Name');
    for (let i = 0; i < 6; i++) name.type!(null);
    for (const ch of [...'Zoë  3 O’Neil-Ríos!']) name.type!(ch);
    expect(name.get!()).toBe('Zoë O’Neil-Ríos');
    item(menu.current, 'Racket hand').set!('left');
    item(menu.current, 'Ridiculous').set!(true);
    item(menu.current, 'Head size').set!(1);
    item(menu.current, 'Legs').set!(0);
    expect(item(menu.current, 'Head size').readout!()).toBe('200%');
    // every change dresses the turntable
    expect(dressed.length).toBeGreaterThanOrEqual(5);
    press(menu.current, 'Save them');
    expect(menu.current!.id).toBe('players');
    expect(store.characters.length).toBe(1);
    const c = store.characters[0]!;
    expect([c.name, c.hand, c.silly, c.body.head]).toEqual(['Zoë O’Neil-Ríos', 'left', true, 2]);
    // (little legs within what the animation is tested on)
    expect(c.body.legs * c.body.height).toBeGreaterThanOrEqual(0.65 - 1e-9);
    expect(store.active).toBe(0);
    expect(menu.current!.sub).toBe('You play as Zoë O’Neil-Ríos');
  });

  it('skin and hair: the slider says how much, and dyed colours are offered only in ridiculous mode', async () => {
    const { menu, store } = await setup();
    press(menu.current, 'Create a player');
    const skin = item(menu.current, 'Skin'), hair = item(menu.current, 'Hair colour');
    expect(skin.readout!()).toBe('Their own');
    skin.set!(0.2);
    expect(skin.readout!()).toBe('Darker 60%');
    skin.set!(0.85);
    expect(skin.readout!()).toBe('Lighter 70%');
    const values = (): unknown[] => hair.options!.map((o) => o.value);
    expect(values()).toContain('blonde');
    expect(values()).not.toContain('lime');
    item(menu.current, 'Ridiculous').set!(true);
    expect(values()).toContain('lime');
    hair.set!('lime');
    item(menu.current, 'Ridiculous').set!(false);
    expect(values()).not.toContain('lime');
    expect(hair.get!()).toBeNull();
    hair.set!('copper');
    press(menu.current, 'Save them');
    expect([store.characters[0]!.skin, store.characters[0]!.hair]).toEqual([0.7, 'copper']);
  });

  it('leaving asks first only when something changed; ridiculous off brings the body back in range', async () => {
    const { menu, store } = await setup();
    press(menu.current, 'Create a player');
    press(menu.current, 'Leave without saving');
    expect(menu.current!.id).toBe('players');
    press(menu.current, 'Create a player');
    item(menu.current, 'Ridiculous').set!(true);
    item(menu.current, 'Arms').set!(1);
    item(menu.current, 'Ridiculous').set!(false);
    expect(Number(item(menu.current, 'Arms').readout!().replace('%', '')) / 100).toBeLessThanOrEqual(RANGES.real.arms[1] + 1e-9);
    menu.back();
    expect(menu.current!.id).toBe('confirm');
    press(menu.current, 'Yes');
    expect(menu.current!.id).toBe('players');
    expect(store.characters).toEqual([]);
  });

  it('offers only owned outfit pieces, hides what a costume covers, and the racket says how it plays', async () => {
    const { menu } = await setup(true);
    press(menu.current, 'Create a player');
    const costume = item(menu.current, 'Costume');
    expect(costume.options!.map((o) => o.value)).toContain('costume-banana');
    expect(item(menu.current, 'Shirt').hidden!()).toBe(false);
    costume.set!('costume-banana');
    expect(item(menu.current, 'Shirt').hidden!()).toBe(true);
    const racket = item(menu.current, 'Racket');
    racket.set!('qarro-yunque');
    expect(String((racket.desc as () => string)())).toMatch(/^QARRO Yunque \(diamond, 375 g\)\. Power \d+, control \d+, spin \d+/);
    const starters = await setup(false);
    press(starters.menu.current, 'Create a player');
    expect(item(starters.menu.current, 'Costume').hidden!()).toBe(true);
    expect(item(starters.menu.current, 'Shirt').options!.every((o) => COSMETICS.find((x) => x.id === o.value)?.unlock === 'starter')).toBe(true);
  });

  it('a friend’s link opens their player on the turntable; saved, they join the list; deleted, they go', async () => {
    const { menu, store, creator } = await setup();
    const theirs = { ...defaultCharacter(FACES.find((f) => f.woman)!.id), name: 'Friend' };
    const code = await encodeCharacter(theirs);
    expect(await creator.addCode('not a code')).toBe(false);
    expect(await creator.addCode(`https://x.example/bandeja/?creator=1#p=${code}`)).toBe(true);
    expect(menu.current!.id).toBe('creator');
    expect(item(menu.current, 'Name').get!()).toBe('Friend');
    press(menu.current, 'Save them');
    expect(store.characters.map((c) => c.name)).toEqual(['Friend']);
    expect(await decodeCharacter(await encodeCharacter(store.characters[0]!), store.owned)).toEqual(store.characters[0]);
    press(menu.current, 'Friend  ·  playing');
    expect(menu.current!.id).toBe('player');
    press(menu.current, 'Delete');
    press(menu.current, 'Yes');
    expect(menu.current!.id).toBe('players');
    expect(store.characters).toEqual([]);
    expect(store.active).toBe(-1);
  });
});
