// M6 phase B: tournaments from the roster. The field (each pro once, pairs of a drive and a revés player where the
// field allows), the player's side by their partner's, each tie's court with every face once, and a tournament read
// back from the store checked.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOUR, field, makePairs, maxEntries, newTour, partnerFor, sizesFor, tieCourt, tourFrom, entryName, nextTieName } from '../../src/app/tournament.ts';
import { finished, playRound, recordYours, current } from '../../src/app/bracket.ts';

describe('a tournament', () => {
  it('fills the draws the roster can', () => {
    expect(maxEntries(true, false)).toBe(8);
    expect(maxEntries(true, true)).toBe(6);
    expect(maxEntries(false, false)).toBe(17);
    expect(sizesFor(true, false)).toEqual([4, 8]);
    expect(sizesFor(true, true)).toEqual([4, 8]);
    expect(sizesFor(false, true)).toEqual([4, 8, 16]);
  });

  it('pairs drive with revés, strongest together', () => {
    const pairs = makePairs(field(false));
    expect(pairs).toHaveLength(8);
    for (const [a, b] of pairs) expect([a!.side, b!.side]).toEqual(['drive', 'reves']);
    expect(pairs[0]![0]!.level).toBeGreaterThanOrEqual(pairs[7]![0]!.level);
  });

  for (const doubles of [true, false]) {
    for (const women of [false, true]) {
      it(`draws a ${women ? 'women’s' : 'men’s'} ${doubles ? 'doubles' : 'singles'} field, each pro once`, () => {
        for (let seed = 1; seed < 25; seed++) {
          const sizes = sizesFor(doubles, women);
          const t = newTour(seed, { ...DEFAULT_TOUR, doubles, women, size: sizes[sizes.length - 1]! });
          const ids = t.draw.entries.flatMap((e) => e.players);
          expect(ids.filter((p) => p === 'you')).toHaveLength(1);
          expect(new Set(ids).size).toBe(ids.length);
          const pool = new Set(field(women).map((p) => p.id));
          for (const id of ids) if (id !== 'you') expect(pool.has(id)).toBe(true);
          expect(t.draw.entries).toHaveLength(Math.min(t.setup.size, maxEntries(doubles, women)));
          expect(t.draw.you).toBe(0);
        }
      });
    }
  }

  it('puts the player on the side their partner doesn’t play', () => {
    const drive = field(false).find((p) => p.side === 'drive')!, reves = field(false).find((p) => p.side === 'reves')!;
    const a = newTour(3, { ...DEFAULT_TOUR, partner: drive.id });
    expect(a.draw.entries[0]!.players).toEqual([drive.id, 'you']);
    expect(tieCourt(a, null)!.you).toBe(2);
    const b = newTour(3, { ...DEFAULT_TOUR, partner: reves.id });
    expect(b.draw.entries[0]!.players).toEqual(['you', reves.id]);
    expect(tieCourt(b, null)!.you).toBe(0);
    // Dealt: the same partner from the same seed.
    expect(partnerFor(DEFAULT_TOUR, 9).id).toBe(partnerFor(DEFAULT_TOUR, 9).id);
  });

  it('builds every tie’s court with each face once, through to the end', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const doubles of [true, false]) {
        const t = newTour(seed, { ...DEFAULT_TOUR, doubles, women: seed % 2 === 0, size: 8 });
        let ties = 0;
        while (current(t.draw).tie) {
          const c = tieCourt(t, seed % 3 === 0 ? 'p2' : null)!;
          expect(c.seats[c.you]).toBeNull();
          expect(c.seats.filter((p) => p === null)).toHaveLength(1);
          expect(c.faces.every((f) => typeof f === 'string')).toBe(true);
          expect(new Set(c.faces).size).toBe(c.faces.length);
          recordYours(t.draw, true, '4-2');
          playRound(t.draw);
          ties++;
        }
        expect(finished(t.draw)).toBe(true);
        expect(ties).toBeGreaterThan(1);
        expect(nextTieName(t.draw)).toBeNull();
      }
    }
  });

  it('names entries by surname, the player as You', () => {
    const t = newTour(4, { ...DEFAULT_TOUR, doubles: false });
    expect(entryName(t.draw, 0)).toBe('You');
    expect(entryName(t.draw, -1)).toBe('Bye');
  });

  it('reads back only a tournament of the roster', () => {
    const t = newTour(12, DEFAULT_TOUR);
    recordYours(t.draw, true, '4-1');
    playRound(t.draw);
    const back = tourFrom(JSON.parse(JSON.stringify(t)));
    expect(back).toEqual(t);
    expect(tourFrom({ ...t, draw: { ...t.draw, entries: t.draw.entries.map((e, i) => (i === 1 ? { ...e, players: ['nobody', 'x'] } : e)) } })).toBeNull();
    // A pro in two entries.
    const twice = JSON.parse(JSON.stringify(t));
    twice.draw.entries[2].players[0] = twice.draw.entries[1].players[0];
    expect(tourFrom(twice)).toBeNull();
    expect(tourFrom('nope')).toBeNull();
  });
});
