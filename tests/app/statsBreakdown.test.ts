// The match stats' breakdown (M7 phase D): counted from an AI match frame by frame as the game counts them, and held
// to what the events themselves say, counted here independently: every shot filed under its kind, every point and
// every fault ending on exactly one shot, first serves in no more than struck, the rally bands every point, the net
// time inside the rally time, and the landing spots mostly in the opponents' half.
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_OVER, E_HIT, E_POINT, E_FAULT, E_FLOOR } from '../../src/sim/match.ts';
import { MatchStats, overheads, MAX_LANDED } from '../../src/game/stats.ts';
import { SHOT_SERVE, SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { statsHtml, courtSvg, STATS_VIEWS } from '../../src/app/statsScreen.ts';

function play(seed: number) {
  const sim = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [0.8, 0.8],
    format: { mode: 1, setsToWin: 1, gamesPerSet: 4, finalSet: 0 } } as never);
  const st = new MatchStats();
  const hits = [0, 0], firsts = [0, 0];
  let points = 0, faults = 0, seen = 0, floors = 0, lastTeam = -1, wonOnLast = 0;
  for (let k = 0; k < 120 * 1500 && sim.phase !== PH_OVER; k++) {
    sim.step([null, null, null, null]);
    for (; seen < sim.eventSeq; seen++) {
      const e = sim.events[seen % sim.events.length]!;
      if (e.kind === E_HIT && e.team >= 0) { hits[e.team]!++; lastTeam = e.team; if (e.a === SHOT_SERVE && sim.serveNo === 1) firsts[e.team]!++; }
      else if (e.kind === E_POINT) { points++; if (e.team === lastTeam) wonOnLast++; }
      else if (e.kind === E_FAULT) faults++;
      else if (e.kind === E_FLOOR) floors++;
    }
    // (frames at 60 Hz: the stats read the ring every second tick, as the game does)
    if (k % 2) st.update(sim);
  }
  st.update(sim);
  return { sim, st, hits, firsts, points, faults, floors, wonOnLast };
}

describe('the stats breakdown', () => {
  const r = play(17);
  const T = r.st.team;

  it('files every shot under its kind, and every point and fault on one shot', () => {
    expect(r.sim.phase).toBe(PH_OVER);
    for (const t of [0, 1]) {
      const played = T[t]!.shots.reduce((n, l) => n + l.played, 0);
      expect(played).toBe(r.hits[t]);
      for (const l of T[t]!.shots) expect(l.won + l.lost).toBeLessThanOrEqual(l.played);
    }
    const ended = [0, 1].reduce((n, t) => n + T[t]!.shots.reduce((m, l) => m + l.won + l.lost, 0), 0);
    expect(ended).toBe(r.points + r.faults);
    // Won: the point went to the side that struck last.
    expect(T[0]!.shots.reduce((n, l) => n + l.won, 0) + T[1]!.shots.reduce((n, l) => n + l.won, 0)).toBe(r.wonOnLast);
    // Serves: first serves struck, and in no more than that.
    for (const t of [0, 1]) {
      expect(T[t]!.firsts).toBe(r.firsts[t]);
      expect(T[t]!.firstsIn).toBeLessThanOrEqual(T[t]!.firsts);
      expect(T[t]!.firstsIn).toBeGreaterThan(0);
    }
  });

  it('bands every point by its length, and keeps the net inside the rallies', () => {
    for (const t of [0, 1]) {
      // (a double fault is a point with no E_POINT: the bands hold the rest)
      expect(T[t]!.bands.reduce((a, b) => a + b, 0)).toBe(T[t]!.points - T[1 - t]!.doubleFaults);
      expect(T[t]!.netSecs).toBeGreaterThan(0);
      expect(T[t]!.netSecs).toBeLessThan(T[t]!.rallySecs);
      expect(T[t]!.run).toBeGreaterThan(50);
    }
  });

  it('keeps where shots came down, mostly in the opponents\' half', () => {
    for (const t of [0, 1]) {
      const n = T[t]!.landed;
      expect(n).toBeGreaterThan(20);
      expect(n).toBeLessThanOrEqual(MAX_LANDED);
      let theirs = 0;
      for (let i = 0; i < n; i++) if (T[t]!.landZ[i]! < 0) theirs++;
      expect(theirs / n).toBeGreaterThan(0.8);
    }
  });

  it('draws every view, and a dot for every landing', () => {
    for (const v of STATS_VIEWS) {
      const html = statsHtml(r.st, v.value, 0, ['Your pair', 'Them']);
      expect(html).toContain('Your pair');
      expect(html.length).toBeGreaterThan(200);
    }
    expect(statsHtml(r.st, 'shots', 0, ['A', 'B'])).toContain('Serve');
    const o = overheads(T[0]!);
    expect(o.played).toBeGreaterThanOrEqual(o.won + o.lost);
    const svg = courtSvg(T[0]!, T[1]!);
    expect((svg.match(/<circle/g) ?? []).length).toBe(T[0]!.landed + T[1]!.landed);
    expect(SHOT_KEYS.length).toBe(T[0]!.shots.length);
  });
});
