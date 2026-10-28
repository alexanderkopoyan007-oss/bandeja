// AI difficulty and personalities (Phase 4, docs/ai.md): the levels play like players of that level (rally length
// and errors from the published amateur-to-pro ladder, human mistakes rather than robotic ones), and each style can
// be told from how it plays.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, E_POINT, E_FAULT, E_WHIFF } from '../../src/sim/match.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { STYLE_KEYS } from '../../src/sim/ai/styles.ts';

const NONE = [null, null, null, null];

/** AI doubles at one level until `points` points: shots per point, first-serve faults, whiffs per shot. */
function ladder(level: number, points: number) {
  // First serves per toss: a struck fault sends both E_HIT and E_FAULT; count it once.
  let shots = 0, pts = 0, firsts = 0, faults1 = 0, whiffs = 0, struck = false;
  for (let sd = 1; pts < points; sd++) {
    const m = new MatchSim({ seed: sd * 104729, doubles: true, human: [false, false, false, false], aiLevel: [level, level] });
    let seen = 0;
    for (let k = 0; k < 120 * 600 && pts < points; k++) {
      m.step(NONE);
      while (seen < m.eventSeq) {
        const e = m.events[seen++ % m.events.length]!;
        if (e.kind === E_HIT) {
          shots++;
          if (SHOT_KEYS[e.a] === 'serve' && m.serveNo === 1) { firsts++; struck = true; }
        } else if (e.kind === E_FAULT && e.b === 1) {
          faults1++;
          if (!struck) firsts++;
          struck = false;
        } else if (e.kind === E_WHIFF) whiffs++;
        else if (e.kind === E_POINT) { pts++; struck = false; }
      }
    }
  }
  return { perPoint: shots / pts, firstFaults: faults1 / firsts, whiffs: whiffs / shots };
}

describe('AI difficulty', () => {
  it('rallies lengthen with level, on the amateur-to-pro ladder, and beginners still rally', () => {
    const lo = ladder(0, 150), mid = ladder(0.5, 150), top = ladder(1, 150);
    // Measured at the end of Phase 4 (300-1,000 matches): 5.2 / 7.1 / 10.9 shots a point. Novices about 5.6 and
    // trained recreational players about 7.3 (derived from the serve's share of their shots; docs/ai.md), pros
    // 10-11 (docs/research §1, §5).
    expect(lo.perPoint).toBeGreaterThan(3.5);
    expect(lo.perPoint).toBeLessThan(7);
    expect(mid.perPoint).toBeGreaterThan(5.5);
    expect(mid.perPoint).toBeLessThan(9);
    expect(top.perPoint).toBeGreaterThan(9);
    expect(top.perPoint).toBeLessThan(13.5);
    expect(lo.perPoint).toBeLessThan(mid.perPoint);
    expect(mid.perPoint).toBeLessThan(top.perPoint);
    // Human mistakes, not robotic ones: a beginner's serve goes in most of the time (16.8% first-serve faults
    // measured; the beginner AI used to fault 55%), and swings that miss the ball altogether stay rare.
    expect(lo.firstFaults).toBeLessThan(0.35);
    expect(top.firstFaults).toBeLessThan(0.16);
    expect(lo.whiffs).toBeLessThan(0.03);
  }, 300_000);
});

describe('AI personalities', () => {
  /** Mixed doubles, the four styles rotated over the seats: each style's shot shares, pace and errors. */
  function signatures(seeds: number, secs: number) {
    type S = { shots: number; kinds: Record<string, number>; pace: number; paceN: number; errors: number; oh: number };
    const by: Record<string, S> = {};
    for (const k of STYLE_KEYS) by[k] = { shots: 0, kinds: {}, pace: 0, paceN: 0, errors: 0, oh: 0 };
    for (let sd = 0; sd < seeds; sd++) {
      const order = STYLE_KEYS.map((_, i) => STYLE_KEYS[(i + sd) % STYLE_KEYS.length]!);
      const m = new MatchSim({ seed: 1000 + sd * 7919, doubles: true, human: [false, false, false, false], aiLevel: [1, 1], aiStyle: order });
      let seen = 0, last = -1;
      for (let k = 0; k < 120 * secs; k++) {
        m.step(NONE);
        while (seen < m.eventSeq) {
          const e = m.events[seen++ % m.events.length]!;
          if (e.kind === E_HIT) {
            last = e.player;
            const key = SHOT_KEYS[e.a]!;
            if (key === 'serve') continue;
            const st = by[order[e.player]!]!;
            st.shots++;
            st.kinds[key] = (st.kinds[key] ?? 0) + 1;
            if (key === 'drive' || key === 'topspin' || key === 'slice' || key === 'volley') { st.pace += e.c; st.paceN++; }
            if (key === 'smash' || key === 'bandeja' || key === 'vibora') st.oh++;
          } else if (e.kind === E_POINT && last >= 0) {
            if (m.players[last]!.team !== e.team) by[order[last]!]!.errors++;
            last = -1;
          }
        }
      }
    }
    const share = (k: string, x: string) => (by[k]!.kinds[x] ?? 0) / by[k]!.shots;
    const ofOh = (k: string, x: string) => (by[k]!.kinds[x] ?? 0) / by[k]!.oh;
    return { by, share, ofOh, pace: (k: string) => by[k]!.pace / by[k]!.paceN, errors: (k: string) => by[k]!.errors / by[k]!.shots };
  }

  it('Martillo drives and smashes and errs, El Muro lobs and plays safe, La Serpiente plays víboras and touch', () => {
    // Measured over 60 seeds at the end of Phase 4 (about 2,400 shots each): lobs Muro 28% / Martillo 11%; drives
    // Martillo 27% / Muro 6%; smashes of overheads Martillo 71% / Muro 16%; víboras of overheads Serpiente 68% /
    // Relojero 14%; errors per shot Martillo 8.3% / Muro 5.3% / Relojero 4.7%; pace Martillo 60.8 / Muro 57.9 km/h.
    const r = signatures(24, 300);
    expect(r.share('muro', 'lob')).toBeGreaterThan(1.6 * r.share('martillo', 'lob'));
    expect(r.share('martillo', 'drive')).toBeGreaterThan(2.5 * r.share('muro', 'drive'));
    expect(r.ofOh('martillo', 'smash')).toBeGreaterThan(2.5 * r.ofOh('muro', 'smash'));
    expect(r.ofOh('serpiente', 'vibora')).toBeGreaterThan(2 * r.ofOh('reloj', 'vibora'));
    expect(r.share('serpiente', 'drop') + r.share('serpiente', 'chiquita')).toBeGreaterThan(r.share('muro', 'drop') + r.share('muro', 'chiquita'));
    expect(r.errors('martillo')).toBeGreaterThan(1.3 * r.errors('muro'));
    expect(r.pace('martillo')).toBeGreaterThan(r.pace('muro'));
  }, 300_000);
});
