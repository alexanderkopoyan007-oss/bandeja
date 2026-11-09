// M5 phase D: the player's own character (src/app/character.ts), checked value by value on every read as the settings and
// the store are, its share code, and the store keeping a list of them.
import { describe, expect, it } from 'vitest';
import {
  checkedCharacter, CODE_MAX, CODE_PREFIX, cleanName, decodeCharacter, defaultCharacter, encodeCharacter, FACES, HAIR_TONES,
  NAME_MAX, RACKET_IDS, setSilly, type Character,
} from '../../src/app/character.ts';
import { COSMETICS, defaultLoadout, SLOT_INFO } from '../../src/app/unlocks.ts';
import { LEG_SPAN, NEUTRAL, PROPORTION_KEYS, RANGES } from '../../src/render/avatar/proportions.ts';
import { CHARACTERS_MAX, memoryBackend, Store } from '../../src/app/store.ts';

const STARTERS = new Set(COSMETICS.filter((c) => c.unlock === 'starter').map((c) => c.id));
const ALL = new Set(COSMETICS.map((c) => c.id));

/** A character using a little of everything: an unlocked outfit item, its own racket colours, a silly body. */
function busy(): Character {
  const c = defaultCharacter(FACES.find((f) => f.woman)!.id);
  c.name = 'Ana-María O’Neil';
  c.hand = 'left';
  setSilly(c, true);
  c.body = { ...NEUTRAL, head: 1.8, arms: 1.4, legs: 0.8, build: 1.2 };
  c.body = checkedCharacter(c, ALL).body;
  c.skin = -0.35;
  c.hair = 'teal';
  c.tattoos = { arm: 'vine', calf: null };
  const earned = COSMETICS.find((x) => x.unlock !== 'starter' && x.slot === 'head')!;
  c.outfit = { ...defaultLoadout(), head: earned.id };
  c.racket = {
    base: RACKET_IDS.find((r) => r !== 'standard')!,
    look: { art: 'tide', face: '#102030', a: '#ff8800', b: '#00aaff', accent: '#ffffff', frame: '#222222', grip: '#ff0066', finish: 'gloss', frameFinish: 'satin' },
  };
  c.voice = 5;
  c.pitch = 0.4;
  return c;
}

describe('a character, checked', () => {
  it('the default is a valid character, unchanged by checking', () => {
    for (const f of FACES) {
      const c = defaultCharacter(f.id);
      expect(checkedCharacter(c, STARTERS)).toEqual(c);
    }
  });

  it('garbage of every kind falls back field by field', () => {
    for (const raw of [undefined, null, 3, 'x', [], { face: 'nobody', name: 42, hand: 'both', silly: 'yes', body: { head: 'big', legs: -3 } }]) {
      const c = checkedCharacter(raw, STARTERS);
      expect(c.face).toBe(FACES[0]!.id);
      expect(c.name).toBe('Player');
      expect(c.hand).toBe('right');
      expect(c.silly).toBe(false);
      for (const k of PROPORTION_KEYS) expect(c.body[k]).toBeGreaterThanOrEqual(RANGES.real[k][0]);
    }
    const c = checkedCharacter({
      skin: 9, hair: 'plaid', tattoos: { arm: 'skull', calf: 7 }, racket: { base: 'excalibur', look: { art: 'flames', face: 'red', finish: 'chrome' } },
      celebrate: 'backflip', voice: 99, pitch: -Infinity,
    }, STARTERS);
    expect(c.skin).toBe(1);
    expect(c.hair).toBeNull();
    expect(c.tattoos).toEqual({ arm: null, calf: null });
    expect(c.racket.base).toBe('standard');
    expect(c.racket.look!.art).toBe('stripe');
    expect(c.racket.look!.face).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.racket.look!.finish).toBe('sand');
    expect(c.celebrate).toBe('fist');
    expect(c.voice).toBeNull();
    expect(c.pitch).toBe(0);
  });

  it('a name keeps letters of any script, spaces, apostrophes, hyphens and dots, up to NAME_MAX', () => {
    expect(cleanName('  Iñaki   López ')).toBe('Iñaki López');
    expect(cleanName('Zoë <script>alert(1)</script>')).toBe('Zoë scriptalerts');
    expect(cleanName('Ana-María O’Neil Jr.')).toBe('Ana-María O’Neil');
    expect(cleanName('😀😀')).toBe('');
    expect(cleanName('x'.repeat(40)).length).toBe(NAME_MAX);
    expect(checkedCharacter({ name: '<>' }, STARTERS).name).toBe('Player');
  });

  it('the body stays within its mode: realistic ranges, or the ridiculous ones with legs the animation is tested on', () => {
    const wild = { height: 1.3, legs: 1.3, arms: 1.6, head: 2, neck: 2.2, torso: 1.4, shoulders: 1.8, hands: 2, feet: 1.8, build: 1.5 };
    const real = checkedCharacter({ silly: false, body: wild }, STARTERS).body;
    for (const k of PROPORTION_KEYS) expect(real[k]).toBeLessThanOrEqual(RANGES.real[k][1]);
    const silly = checkedCharacter({ silly: true, body: wild }, STARTERS).body;
    expect(silly.head).toBe(2);
    expect(silly.height * silly.legs).toBeLessThanOrEqual(LEG_SPAN[1] + 1e-3);
    // Ridiculous off brings a body and a dyed hair back
    const c = checkedCharacter({ silly: true, body: wild, hair: 'lime' }, STARTERS);
    expect(c.hair).toBe('lime');
    setSilly(c, false);
    expect(c.hair).toBeNull();
    for (const k of PROPORTION_KEYS) expect(c.body[k]).toBeLessThanOrEqual(RANGES.real[k][1]);
    expect(checkedCharacter({ silly: false, hair: 'lime' }, STARTERS).hair).toBeNull();
    expect(Object.values(HAIR_TONES).filter((h) => !h.silly).length).toBeGreaterThanOrEqual(8);
  });

  it('an outfit wears only what the player owns', () => {
    const earned = COSMETICS.find((x) => x.unlock !== 'starter' && x.slot === 'head')!;
    const raw = { outfit: { ...defaultLoadout(), head: earned.id } };
    expect(checkedCharacter(raw, ALL).outfit.head).toBe(earned.id);
    expect(checkedCharacter(raw, STARTERS).outfit.head).toBe(SLOT_INFO.head.required ? defaultLoadout().head : null);
  });
});

describe('share codes', () => {
  it('round-trips a character exactly, URL-safe and short', async () => {
    const c = checkedCharacter(busy(), ALL);
    const code = await encodeCharacter(c);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(400);
    expect(await decodeCharacter(code, ALL)).toEqual(c);
    expect(await decodeCharacter(await encodeCharacter(defaultCharacter()), STARTERS)).toEqual(defaultCharacter());
  });

  it('someone else’s code: the items you have not earned are left at their defaults', async () => {
    const c = checkedCharacter(busy(), ALL);
    const mine = await decodeCharacter(await encodeCharacter(c), STARTERS);
    expect(mine).not.toBeNull();
    expect(mine!.outfit).toEqual(checkedCharacter({ outfit: c.outfit }, STARTERS).outfit);
    expect({ ...mine!, outfit: c.outfit }).toEqual(c);
  });

  it('refuses what is not a code: other prefixes, junk, truncation, tampering, oversize', async () => {
    const code = await encodeCharacter(busy());
    for (const bad of ['', 'B2' + code.slice(2), 'hello', code.slice(0, code.length - 9), CODE_PREFIX + '!!!', code + 'A'.repeat(CODE_MAX)]) {
      expect(await decodeCharacter(bad, ALL), bad.slice(0, 20)).toBeNull();
    }
    // A code whose JSON is valid but holds nonsense is read as a checked default, never thrown on
    const junk = CODE_PREFIX + Buffer.from(await new Response(new Blob([new TextEncoder().encode('{"f":7,"b":"x","o":5}')]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url');
    const read = await decodeCharacter(junk, ALL);
    expect(read).toEqual(defaultCharacter());
    // Whitespace round a pasted code is fine
    expect(await decodeCharacter(`  ${code}\n`, ALL)).not.toBeNull();
  });
});

describe('the store keeps characters', () => {
  it('saves, reloads checked, keeps the active one and stops at the most it keeps', async () => {
    const be = memoryBackend();
    const s = await Store.open(be);
    const a = defaultCharacter();
    a.name = 'First';
    expect(s.saveCharacter(-1, a)).toBe(0);
    const b = busy();
    expect(s.saveCharacter(-1, b)).toBe(1);
    s.setActive(1);
    await s.flush();
    const again = await Store.open(be);
    expect(again.characters.length).toBe(2);
    expect(again.characters[0]!.name).toBe('First');
    // Checked against what this store owns: the unlocked head piece isn't owned here
    expect(again.characters[1]!.outfit).toEqual(checkedCharacter({ outfit: b.outfit }, again.owned).outfit);
    expect(again.active).toBe(1);
    again.removeCharacter(0);
    expect(again.active).toBe(0);
    for (let i = again.characters.length; i < CHARACTERS_MAX; i++) expect(again.saveCharacter(-1, a)).toBe(i);
    expect(again.saveCharacter(-1, a)).toBe(-1);
  });

  it('a broken stored list or active number reads as empty or none', async () => {
    const be = memoryBackend();
    await be.put('characters.v1', 'nope');
    await be.put('active.v1', 4);
    const s = await Store.open(be);
    expect(s.characters).toEqual([]);
    expect(s.active).toBe(-1);
    await be.put('characters.v1', [{ name: 7 }, null]);
    await be.put('active.v1', 1);
    const t = await Store.open(be);
    expect(t.characters.map((c) => c.name)).toEqual(['Player', 'Player']);
    expect(t.active).toBe(1);
  });
});
