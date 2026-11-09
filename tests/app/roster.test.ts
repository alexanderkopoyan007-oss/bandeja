// M5 phase E: the roster (data/roster.json, app/roster.ts). Its 28 pros keep the roster's rules: the owner's seven
// names on seven of the men, made-up names otherwise (a nation the face fits, never a professional's surname), every
// style and signature used, valid characters, the baked faces dressed only in what shows on them. The dealing: no two
// on a court with one face, the human's seat left to them, each pair's drive player on the right, the same court from
// the same seed, a knock-out's pair kept. A match without style tweaks is the match from before, to the bit.
import { describe, expect, it } from 'vitest';
import people from '../../data/people.json' with { type: 'json' };
import { applyRoster, BAKED_FACES, dealRoster, DEALT_FACES, proName, ROSTER, SIDES, SIGNATURES, type Pro } from '../../src/app/roster.ts';
import { checkedCharacter, FACES } from '../../src/app/character.ts';
import { COSMETICS } from '../../src/app/unlocks.ts';
import { OWNER_ROSTER, PRO_SURNAMES } from '../../src/game/names.ts';
import { STYLE_KEYS } from '../../src/sim/ai/styles.ts';
import { RACKET_IDS } from '../../src/sim/contact/racket.ts';
import { MatchSim } from '../../src/sim/match.ts';

const ALL = [...ROSTER.men, ...ROSTER.women];
const nationsOf = (face: string): string[] => [...people.men, ...people.women, ...people.guests].find((p) => p.name === face)!.nations;

describe('the roster', () => {
  it('28 pros, 16 men and 12 women, each their own name', () => {
    expect([ROSTER.men.length, ROSTER.women.length]).toEqual([16, 12]);
    expect(new Set(ALL.map((p) => p.id)).size).toBe(28);
    expect(new Set(ALL.map((p) => p.name.last)).size).toBe(28);
    // The owner's seven, on seven men; the rest made up, never a professional's surname, from a nation the face fits.
    const owners = new Set(OWNER_ROSTER.map((n) => `${n.first}|${n.last}|${n.nation}`));
    const theirs = ROSTER.men.filter((p) => owners.has(`${p.name.first}|${p.name.last}|${p.name.nation}`));
    expect(theirs).toHaveLength(7);
    for (const p of ALL.filter((x) => !theirs.includes(x))) {
      expect(PRO_SURNAMES, proName(p)).not.toContain(p.name.last);
      expect(nationsOf(p.character.face), proName(p)).toContain(p.name.nation);
    }
  });

  it('on the faces a match deals, two or three a face, the pros of each sex on their own', () => {
    for (const [list, faces] of [[ROSTER.men, DEALT_FACES.men], [ROSTER.women, DEALT_FACES.women]] as const) {
      const count = new Map<string, number>();
      for (const p of list) count.set(p.character.face, (count.get(p.character.face) ?? 0) + 1);
      expect([...count.keys()].sort()).toEqual([...faces].sort());
      for (const [f, k] of count) { expect(k, f).toBeGreaterThanOrEqual(2); expect(k, f).toBeLessThanOrEqual(3); }
    }
    expect(ROSTER.women.every((p) => p.woman) && ROSTER.men.every((p) => !p.woman)).toBe(true);
  });

  it('every style, signature and side played; real rackets, a few left-handers, levels near the match’s', () => {
    for (const list of [ROSTER.men, ROSTER.women]) {
      expect(new Set(list.map((p) => p.style))).toEqual(new Set(STYLE_KEYS));
      expect(new Set(list.map((p) => p.side))).toEqual(new Set(SIDES));
      expect(list.filter((p) => p.side === 'drive').length * 2).toBe(list.length);
      expect(list.filter((p) => p.character.hand === 'left').length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(ALL.map((p) => p.signature))).toEqual(new Set(Object.keys(SIGNATURES)));
    for (const p of ALL) {
      expect(RACKET_IDS, p.id).toContain(p.character.racket.base);
      expect(p.character.racket.base, p.id).not.toBe('standard');
      expect(Math.abs(p.level), p.id).toBeLessThanOrEqual(0.06);
      expect(p.tweak.level).toBe(p.level);
      // Left-handers play the drive side: their forehand in the middle with a right-hander's on the left.
      if (p.character.hand === 'left') expect(p.side, p.id).toBe('drive');
    }
  });

  it('each is a valid character as written, never reshaped; the baked faces wear only what shows on them', () => {
    const every = new Set(COSMETICS.map((c) => c.id));
    for (const p of ALL) {
      const c = p.character;
      const preset = FACES.some((f) => f.id === c.face) ? c.face : FACES.find((f) => f.woman === p.woman)!.id;
      const again = checkedCharacter({ ...c, face: preset }, every);
      expect({ ...again, face: c.face, voice: c.voice }, p.id).toEqual(c);
      expect(Object.values(c.body).every((v) => v === 1), p.id).toBe(true);
      expect(c.silly, p.id).toBe(false);
      if (BAKED_FACES.has(c.face)) {
        expect([c.skin, c.hair, c.tattoos.arm, c.tattoos.calf], p.id).toEqual([0, null, null, null]);
      }
    }
    // (what each wrote is what they wear: nothing dropped by the check)
    const raw = (id: string) => (ALL.find((p) => p.id === id)!.character.outfit);
    expect(raw('boris').head).toBe('head-band');
    expect(raw('hussein').bottom).toBe('bot-tights');
  });
});

describe('dealing the court', () => {
  const faceOf = (p: Pro | null) => p?.character.face;
  it('no two on a court with one face; the human’s seat theirs; a women’s match about as often as the cast deals one', () => {
    let womens = 0;
    for (let seed = 0; seed < 400; seed++) {
      const d = dealRoster(seed, 4, { human: 0 });
      expect(d.seats[0]).toBeNull();
      const faces = [d.humanFace, ...d.seats.slice(1).map(faceOf)];
      expect(new Set(faces).size, String(seed)).toBe(4);
      expect((d.women ? DEALT_FACES.women : DEALT_FACES.men)).toContain(d.humanFace);
      for (const p of d.seats.slice(1)) expect(p!.woman).toBe(d.women);
      if (d.women) womens++;
      // the same seed, the same court
      expect(dealRoster(seed, 4, { human: 0 }).seats.map((p) => p?.id)).toEqual(d.seats.map((p) => p?.id));
    }
    expect(womens / 400).toBeGreaterThan(people.womensMatches - 0.08);
    expect(womens / 400).toBeLessThan(people.womensMatches + 0.08);
  });

  it('the player’s own character: pros of their sex, never with their face; the title’s match is all pros', () => {
    for (let seed = 0; seed < 100; seed++) {
      const woman = FACES.find((f) => f.woman)!.id, man = FACES[0]!.id;
      for (const [face, w] of [[woman, true], [man, false]] as const) {
        const d = dealRoster(seed, 4, { human: 0, me: { face, woman: w } });
        expect(d.women).toBe(w);
        expect(d.humanFace).toBeNull();
        expect(d.seats.slice(1).map(faceOf)).not.toContain(face);
      }
      const t = dealRoster(seed, 4);
      expect(t.seats.every((p) => p !== null)).toBe(true);
      expect(new Set(t.seats.map(faceOf)).size).toBe(4);
    }
  });

  it('each pair’s drive player receives on the right (seat t), the revés player at t + 2, where both have one', () => {
    let pairs = 0;
    for (let seed = 0; seed < 200; seed++) {
      const s = dealRoster(seed, 4).seats;
      for (let t = 0; t < 2; t++) {
        const a = s[t]!, b = s[t + 2]!;
        if (a.side !== b.side) { pairs++; expect(a.side, String(seed)).toBe('drive'); }
      }
    }
    expect(pairs).toBeGreaterThan(150);
  });

  it('a knock-out’s later round keeps the pair and deals the other side again', () => {
    for (let seed = 0; seed < 50; seed++) {
      const a = dealRoster(seed, 4, { human: 0 }), b = dealRoster(seed, 4, { human: 0, rivals: seed + 999 });
      expect(b.seats[2]!.id).toBe(a.seats[2]!.id);
      expect(new Set([b.humanFace, ...b.seats.slice(1).map(faceOf)]).size).toBe(4);
    }
  });

  it('puts the pros in the match: faces, names, looks, rackets, hands, styles (a chosen one played instead) and their take on it', async () => {
    const { optionsFromSetup } = await import('../../src/app/options.ts');
    const { defaultSettings, DEFAULT_SETUP } = await import('../../src/app/settings.ts');
    const opts = optionsFromSetup({ ...DEFAULT_SETUP, mode: 'doubles' }, defaultSettings(), 5, null, false, new URLSearchParams());
    const d = dealRoster(5, 4, { human: 0 });
    applyRoster(opts, d, { ...DEFAULT_SETUP, opponents: 'muro' });
    expect(opts.people).toEqual([d.humanFace, ...d.seats.slice(1).map(faceOf)]);
    expect(opts.names![0]).toBeNull();
    for (let i = 1; i < 4; i++) {
      const p = d.seats[i]!;
      expect(opts.names![i]).toEqual(p.name);
      expect(opts.match.rackets![i]).toBe(p.character.racket.base);
      expect(opts.match.lefty![i]).toBe(p.character.hand === 'left');
      expect(opts.match.aiTweak![i]).toEqual(p.tweak);
      expect(opts.match.aiStyle![i]).toBe(i % 2 === 1 ? 'muro' : p.style);
    }
    // The human plays as they set up: the standard racket, their own hand.
    expect(opts.match.rackets![0]).toBe('standard');
    expect(opts.match.aiTweak![0]).toBeNull();
  });
});

describe('style tweaks in the sim', () => {
  it('none, or nulls: the match from before, to the bit', () => {
    const run = (aiTweak?: Array<null>) => {
      const m = new MatchSim({ seed: 42, doubles: false, human: [false, false], aiTweak });
      for (let k = 0; k < 10000; k++) m.step([null, null]);
      return m.hash().toString(16);
    };
    expect(run()).toBe('ef6e47b6');
    expect(run([null, null])).toBe('ef6e47b6');
  });

  it('a pro’s court of tweaks plays whole points', () => {
    const d = dealRoster(9, 4);
    const m = new MatchSim({
      seed: 9, doubles: true, human: [false, false, false, false], aiStyle: d.seats.map((p) => p!.style), aiTweak: d.seats.map((p) => p!.tweak),
      rackets: d.seats.map((p) => p!.character.racket.base), lefty: d.seats.map((p) => p!.character.hand === 'left'),
    });
    const st: number[] = [];
    for (let k = 0; k < 120 * 200; k++) m.step([null, null, null, null]);
    m.score.writeState(st);
    expect(st.slice(0, 4).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
