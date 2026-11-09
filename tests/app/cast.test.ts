import { describe, expect, it } from 'vitest';
import { dealCast } from '../../src/game/cast.ts';
import { dealNames } from '../../src/game/names.ts';

describe('who plays', () => {
  it('the generated people are dealt first and each only once, one to a team, in matches of their own sex', () => {
    for (let seed = 1; seed < 400; seed++) {
      const c = dealCast(seed);
      expect(new Set(c.people).size).toBe(4);
      if (c.women) {
        expect(c.people[0]).toBe('meshy2');
        expect(c.people.includes('meshy') || c.people.includes('meshy3')).toBe(false);
      } else {
        expect([c.people[0], c.people[1]].sort()).toEqual(['meshy', 'meshy3']);
        expect(c.people.includes('meshy2')).toBe(false);
      }
    }
  });

  it('nobody on a court sounds like anybody else: thirteen people share four voices, and two played one recording in three matches of four', () => {
    for (let seed = 0; seed < 400; seed++) {
      const c = dealCast(seed);
      expect(new Set(c.voices.map((v, i) => `${v} ${c.tones[i]}`)).size).toBe(4);
    }
  });
  it('a person keeps one voice from match to match, and each style is on court in a men\'s match', () => {
    const voice = new Map<string, number>();
    for (let seed = 1; seed < 200; seed++) {
      const c = dealCast(seed);
      c.people.forEach((n, i) => {
        expect(c.voices[i]!).toBeGreaterThanOrEqual(c.women ? 4 : 0);
        expect(c.voices[i]!).toBeLessThan(c.women ? 8 : 4);
        expect(voice.get(n) ?? c.voices[i]).toBe(c.voices[i]);
        voice.set(n, c.voices[i]!);
      });
      if (!c.women) expect(new Set([c.voices[0]! % 2, c.voices[1]! % 2]).size).toBe(2);
    }
  });

  it('naming a woman first makes it a match of women, a guest too', () => {
    expect(dealCast(1, ['meshy2', 'p7', 'p8', 'p9']).women).toBe(true);
    expect(dealCast(1, ['p7', 'p8', 'p9', 'p10']).women).toBe(true);
    expect(dealCast(1, ['meshy3', 'p2', 'p3', 'p4']).women).toBe(false);
  });

  it('a seed deals the same cast, names and kits, so a rematch that keeps the seed keeps everyone', () => {
    const a = dealCast(4242), b = dealCast(4242);
    expect(b).toEqual(a);
    expect(dealNames(4242, 4, b)).toEqual(dealNames(4242, 4, a));
  });

  it("a knock-out's next round keeps the player and partner and changes the opponents, men's and women's alike", () => {
    let changed = 0;
    for (let seed = 1; seed < 200; seed++) {
      const a = dealCast(seed), r = dealCast(seed, undefined, seed * 31 + 7);
      expect(r.people[0]).toBe(a.people[0]);
      expect(r.people[2]).toBe(a.people[2]);
      expect(r.women).toBe(a.women);
      expect(r.kits).toEqual(a.kits);
      expect(new Set(r.people).size).toBe(4);
      if (r.people[1] !== a.people[1] || r.people[3] !== a.people[3]) changed++;
    }
    expect(changed).toBeGreaterThan(100);
  });
});

describe('the player’s own character on court (M5 phase D)', () => {
  it('without a character every seed deals exactly as before', () => {
    for (let seed = 0; seed < 300; seed++) expect(dealCast(seed, undefined, undefined, undefined)).toEqual(dealCast(seed));
  });

  it('their face preset is player 0, in a match of their sex, and nobody else on court has it, knock-out rounds too', async () => {
    const { FACES } = await import('../../src/app/character.ts');
    for (const f of FACES) {
      for (let seed = 0; seed < 60; seed++) {
        for (const rivals of [undefined, seed * 7 + 3]) {
          const c = dealCast(seed, undefined, rivals, f.id);
          expect(c.people[0]).toBe(f.id);
          expect(c.women).toBe(f.woman);
          expect(c.people.filter((p) => p === f.id).length).toBe(1);
          expect(new Set(c.people).size).toBe(4);
          expect(dealCast(seed, undefined, rivals, f.id)).toEqual(c);
        }
      }
    }
  });

  it('applyCharacter puts the body, outfit, racket and hand on the human only', async () => {
    const { applyCharacter, optionsFromSetup } = await import('../../src/app/options.ts');
    const { defaultSettings, DEFAULT_SETUP } = await import('../../src/app/settings.ts');
    const { defaultCharacter, RACKET_IDS } = await import('../../src/app/character.ts');
    const { COSMETICS } = await import('../../src/app/unlocks.ts');
    const c = defaultCharacter();
    c.hand = 'left';
    c.body = { ...c.body, height: 1.08, arms: 1.05 };
    const cap = COSMETICS.find((x) => x.slot === 'head')!;
    c.outfit = { ...c.outfit, head: cap.id };
    c.racket = { base: RACKET_IDS[3]!, look: null };
    for (const mode of ['doubles', 'singles'] as const) {
      const opts = optionsFromSetup({ ...DEFAULT_SETUP, mode }, defaultSettings(), 5, null, false, new URLSearchParams());
      applyCharacter(opts, c);
      const n = mode === 'doubles' ? 4 : 2;
      expect(opts.me).toBe(c);
      expect(opts.bodies![0]).toEqual(c.body);
      expect(opts.bodies!.slice(1)).toEqual(Array(n - 1).fill(null));
      expect(opts.wear![0]!.head).toBe(cap.id);
      expect(opts.wear!.slice(1)).toEqual(Array(n - 1).fill(undefined));
      expect(opts.match.rackets).toEqual([RACKET_IDS[3], ...Array(n - 1).fill('standard')]);
      expect(opts.match.lefty).toEqual([true, ...Array(n - 1).fill(false)]);
      // The sim plays the body only when bodies count, and then only theirs
      expect(opts.match.bodyScale).toBeUndefined();
      const counted = optionsFromSetup({ ...DEFAULT_SETUP, mode }, defaultSettings(), 5, null, false, new URLSearchParams());
      applyCharacter(counted, c, true);
      expect(counted.match.bodyScale).toEqual([{ height: 1.08, legs: 1, arms: 1.05, torso: 1 }, ...Array(n - 1).fill(null)]);
    }
    // A neutral body adds no proportions at all (nothing to reproportion), and the face's own skin and hair no looks
    const plain = optionsFromSetup(DEFAULT_SETUP, defaultSettings(), 5, null, false, new URLSearchParams());
    applyCharacter(plain, defaultCharacter());
    expect(plain.bodies).toBeUndefined();
    expect(plain.looks).toBeUndefined();
    expect(plain.designs).toBeUndefined();
    // Their own racket colours go to their player only; the racket under them plays as itself
    const { checkedRacket } = await import('../../src/app/character.ts');
    const painted = optionsFromSetup({ ...DEFAULT_SETUP, mode: 'doubles' }, defaultSettings(), 5, null, false, new URLSearchParams());
    const racket = checkedRacket({ base: RACKET_IDS[2], look: { art: 'tide', face: '#f04f9a' } });
    applyCharacter(painted, { ...defaultCharacter(), racket });
    expect(painted.designs).toEqual([racket.look, null, null, null]);
    expect(painted.match.rackets![0]).toBe(RACKET_IDS[2]);
    // Skin and hair go to the human's player only, the hair as its tone's colour
    const { HAIR_TONES } = await import('../../src/app/character.ts');
    const toned = optionsFromSetup({ ...DEFAULT_SETUP, mode: 'doubles' }, defaultSettings(), 5, null, false, new URLSearchParams());
    applyCharacter(toned, { ...defaultCharacter(), skin: -0.4, hair: 'copper' });
    expect(toned.looks).toEqual([{ skin: -0.4, hair: HAIR_TONES.copper!.rgb, tattoos: null }, null, null, null]);
  });
});
