// M6 phase E: the career. Tiers and the season load; a career starts with a partner from the lower half of the
// roster; entry by ranking points (the Masters by a place in the ranking); each event a draw of the tier's field with
// you and your partner in it; points counted back from the title; chemistry growing with every match together; the
// season rolling over with last season's points halved; a career read back from the store checked value by value.
import { describe, expect, it } from 'vitest';
import {
  CHEMISTRY, SEASON, TIERS, canEnter, careerFrom, careerPoints, careerReach, changePartner, enterEvent, eventField, finishEvent,
  newCareer, partnersFor, passEvent, pointsFor, proPoints, rankOf, ranking, recordTie, shortOf, type Career,
} from '../../src/app/career.ts';
import { field } from '../../src/app/tournament.ts';
import { current, recordYours, playRound, finished, stillIn } from '../../src/app/bracket.ts';

const lowest = (women: boolean): string => partnersFor(null, women)[0]!.id;

/** Play the event under way: win every tie while `wins` lasts, then lose; the other ties settled as the draw does. */
function playOut(c: Career, wins: number): Career {
  let k = 0;
  while (c.tour && stillIn(c.tour.draw) && !finished(c.tour.draw)) {
    const won = k++ < wins;
    recordYours(c.tour.draw, won, won ? '6-3' : '3-6');
    playRound(c.tour.draw);
    c = recordTie(c, won);
  }
  // (out, the rest of the draw is seen through)
  while (c.tour && !finished(c.tour.draw)) playRound(c.tour.draw);
  return finishEvent(c);
}

describe('career', () => {
  it('loads five tiers in order and a season over all of them', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['club', 'regional', 'national', 'tour', 'masters']);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i]!.points[TIERS[i]!.points.length - 1]!).toBeGreaterThan(TIERS[i - 1]!.points[TIERS[i - 1]!.points.length - 1]!);
      if (TIERS[i]!.entry !== null && TIERS[i - 1]!.entry !== null) expect(TIERS[i]!.entry!).toBeGreaterThan(TIERS[i - 1]!.entry!);
    }
    for (const t of TIERS) for (let i = 1; i < t.points.length; i++) expect(t.points[i]!).toBeGreaterThan(t.points[i - 1]!);
    expect(new Set(SEASON.map((e) => e.tier))).toEqual(new Set([0, 1, 2, 3, 4]));
    for (let i = 1; i < SEASON.length; i++) expect(SEASON[i]!.tier).toBeGreaterThanOrEqual(SEASON[i - 1]!.tier);
  });

  it('starts you with a partner from the lower half, at the starting chemistry', () => {
    for (const women of [false, true]) {
      const lower = partnersFor(null, women), all = field(women);
      expect(lower.length).toBe(Math.ceil(all.length / 2));
      const max = Math.max(...lower.map((p) => p.level));
      expect(all.filter((p) => !lower.includes(p)).every((p) => p.level >= max)).toBe(true);
      const c = newCareer(women, lower[0]!.id);
      expect(c.chemistry[c.partner]).toBe(CHEMISTRY.start);
      expect(careerPoints(c)).toBe(0);
      // Last in the ranking, so only the open events are open.
      expect(rankOf(c)).toBe(all.length + 1);
      expect(canEnter(c, 0)).toBe(true);
      expect(SEASON.map((_, k) => canEnter(c, k)).filter(Boolean).length).toBe(SEASON.filter((e) => TIERS[e.tier]!.entry === 0).length);
    }
  });

  it('fills each event from its tier’s field, you and your partner in it', () => {
    for (const women of [false, true]) {
      const c = newCareer(women, lowest(women));
      for (let k = 0; k < SEASON.length; k++) {
        const t = TIERS[SEASON[k]!.tier]!;
        const pool = eventField(c, k);
        expect(pool.some((p) => p.id === c.partner)).toBe(false);
        if (t.pick !== 'any') {
          const levels = field(women).filter((p) => p.id !== c.partner).map((p) => p.level).sort((a, b) => a - b);
          const cut = t.pick === 'weakest' ? levels[pool.length - 1]! : levels[levels.length - pool.length]!;
          for (const p of pool) expect(t.pick === 'weakest' ? p.level <= cut : p.level >= cut).toBe(true);
        }
        // (entered as if it were next and open)
        const e = enterEvent({ ...c, next: k, results: [] }, k, 1000 + k);
        if (TIERS[SEASON[k]!.tier]!.top !== null || (TIERS[SEASON[k]!.tier]!.entry ?? 0) > 0) { expect(e.tour).toBeNull(); continue; }
        expect(e.tour).not.toBeNull();
        const d = e.tour!.draw;
        expect(d.entries[d.you]!.players).toContain(c.partner);
        expect(d.entries.length).toBeLessThanOrEqual(t.size);
        expect(e.tour!.setup.level).toBe(t.level);
        for (const en of d.entries) for (const p of en.players) if (p !== 'you' && p !== c.partner) expect(pool.some((q) => q.id === p)).toBe(true);
      }
    }
  });

  it('counts points back from the title, and the season moves on', () => {
    let c = newCareer(false, lowest(false));
    c = enterEvent(c, 0, 7);
    expect(current(c.tour!.draw)).not.toBeNull();
    c = playOut(c, 99);
    // A club draw of four: two wins and the title.
    expect(c.results).toHaveLength(1);
    expect(c.results[0]!.short).toBe(0);
    expect(c.results[0]!.points).toBe(pointsFor(0, 0));
    expect(careerPoints(c)).toBe(TIERS[0]!.points[TIERS[0]!.points.length - 1]);
    expect(c.next).toBe(1);
    expect(c.tour).toBeNull();
    // Lost the first match of the next: the semi-final's points in a draw of four.
    c = playOut(enterEvent(c, 1, 8), 0);
    expect(c.results[1]!.short).toBe(2);
    expect(c.results[1]!.points).toBe(pointsFor(0, 2));
    // Chemistry grew with each match together.
    expect(c.chemistry[c.partner]).toBeCloseTo(Math.min(1, CHEMISTRY.start + 3 * CHEMISTRY.perMatch + 2 * CHEMISTRY.perWin), 9);
    expect(c.played).toBe(3);
    expect(c.won).toBe(2);
    expect(careerReach(c)).toEqual({ tier: 0, title: 0 });
  });

  it('rolls the season over with last season’s points halved', () => {
    let c = newCareer(true, lowest(true));
    c = playOut(enterEvent(c, 0, 3), 99);
    const before = careerPoints(c);
    while (c.season === 1) c = passEvent(c);
    expect(c.next).toBe(0);
    expect(careerPoints(c)).toBe(Math.floor(before / 2));
    while (c.season === 2) c = passEvent(c);
    expect(careerPoints(c)).toBe(0);
  });

  it('lets the Masters in by a place in the ranking', () => {
    const c = newCareer(false, lowest(false));
    const masters = SEASON.findIndex((e) => TIERS[e.tier]!.top !== null);
    expect(canEnter(c, masters)).toBe(false);
    // Enough points to pass the eighth pro.
    const eighth = ranking(c).filter((r) => r.id !== 'you')[TIERS[SEASON[masters]!.tier]!.top! - 1]!.points;
    const strong = { ...c, results: [{ event: SEASON[6]!.id, season: 1, tier: 3, short: 0, points: eighth + 1, partner: c.partner }] };
    expect(rankOf(strong)).toBeLessThanOrEqual(8);
    expect(canEnter(strong, masters)).toBe(true);
    expect(proPoints(field(false).find((p) => p.level === Math.max(...field(false).map((q) => q.level)))!)).toBe(ranking(c)[0]!.points);
  });

  it('opens every partner once you have played the national tier', () => {
    const c = newCareer(false, lowest(false));
    const top = field(false).reduce((a, b) => (b.level > a.level ? b : a));
    expect(changePartner(c, top.id).partner).toBe(c.partner);
    const later = { ...c, results: [{ event: SEASON[4]!.id, season: 1, tier: 2, short: 3, points: 40, partner: c.partner }] };
    const d = changePartner(later, top.id);
    expect(d.partner).toBe(top.id);
    expect(d.chemistry[top.id]).toBe(CHEMISTRY.start);
    // Back with the old partner: chemistry where it was.
    const old = changePartner({ ...d, chemistry: { ...d.chemistry, [c.partner]: 0.7 } }, c.partner);
    expect(old.chemistry[c.partner]).toBe(0.7);
  });

  it('reads a career back from the store, checking every value', () => {
    let c = newCareer(false, lowest(false));
    c = playOut(enterEvent(c, 0, 11), 1);
    c = enterEvent(c, 1, 12);
    const back = careerFrom(JSON.parse(JSON.stringify(c)));
    expect(back).toEqual(c);
    expect(shortOf(back!.tour!.draw)).toBe(-1);
    // Points are the tier's, never as stored; foreign pros, bad numbers and a draw that isn't the next event go.
    const bad = JSON.parse(JSON.stringify(c));
    bad.results[0].points = 99999;
    bad.chemistry.nobody = 0.5;
    bad.chemistry[c.partner] = 7;
    expect(careerFrom(bad)!.results[0]!.points).toBe(c.results[0]!.points);
    expect(careerFrom(bad)!.chemistry.nobody).toBeUndefined();
    expect(careerFrom(bad)!.chemistry[c.partner]).toBe(CHEMISTRY.start);
    expect(careerFrom({ ...JSON.parse(JSON.stringify(c)), playing: 0 })!.tour).toBeNull();
    expect(careerFrom({ ...JSON.parse(JSON.stringify(c)), partner: 'nobody' })).toBeNull();
    expect(careerFrom({ ...JSON.parse(JSON.stringify(c)), won: 50, played: 3 })).toBeNull();
    expect(careerFrom(null)).toBeNull();
  });
});
