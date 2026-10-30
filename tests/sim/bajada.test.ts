// The bajada: a lob that bounces deep and comes off the back glass high is smashed back down off the glass (WPT men
// play one in 14-17% of points: Courel-Ibáñez et al. 2024). When it is on, who plays it, and what comes of it, for
// the AI and for a human following the HUD's hint (the QA bot on the keys with the assist).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, E_POINT, E_WALL, E_FLOOR, PH_RALLY } from '../../src/sim/match.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { Prediction } from '../../src/sim/ball/predict.ts';
import { WALL_BACK_NEAR, WALL_BACK_FAR } from '../../src/sim/court/court.ts';
import { offGlassHigh, BAJADA_ABOVE, BAJADA_DEPTH } from '../../src/sim/player/positioning.ts';
import { SHOT_BANDEJA, SHOT_SMASH, SHOT_VIBORA } from '../../src/sim/contact/shots.ts';
import { BotHuman } from '../../tools/qa/humans.ts';

const m0 = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] });
const world = m0.world;
const halfL = world.court.halfL;
const minY = m0.players[0]!.tune.overheadHeight + BAJADA_ABOVE;

/** The prediction of a ball thrown from (x, y, z) with velocity v, towards the near half (team 0's, side +1). */
function predict(x: number, y: number, z: number, vx: number, vy: number, vz: number, spin = 0): Prediction {
  const b = new Ball();
  b.pos.set(x, y, z);
  b.vel.set(vx, vy, vz);
  b.spin.set(spin, 0, 0);
  const pr = new Prediction();
  pr.compute(world, b, 0, 0, 2);
  return pr;
}

const OVERHEADS = new Set([SHOT_BANDEJA, SHOT_SMASH, SHOT_VIBORA]);

describe('bajada', () => {
  it('is on for a lob that bounces deep and comes off the back glass high, not for a drive or a ball off the side', () => {
    // A lob from the far back over the net players, bouncing about 1.7 m from the near glass and coming off it
    // 2.4 m up.
    const lob = predict(0.5, 1.0, -8, 0, 9, 10.5);
    const i = offGlassHigh(lob, 1, 0, minY, BAJADA_DEPTH, halfL);
    expect(i).toBeGreaterThan(0);
    expect(lob.walls[i]!).toBeGreaterThan(0);
    expect(lob.y[i]!).toBeGreaterThanOrEqual(minY);
    expect(lob.vy[i]!).toBeLessThan(0);
    // A flat drive: comes off the glass low.
    expect(offGlassHigh(predict(0, 1.0, -8, 0, 2.2, 19), 1, 0, minY, BAJADA_DEPTH, halfL)).toBe(-1);
    // Into the side glass first after the bounce: not a bajada (a ball off two walls is played as it comes).
    // (bounces 3.2 m from the back, 0.4 m from the side; into the side glass 7.8 m out, then the back glass)
    expect(offGlassHigh(predict(-1, 1.0, -8, 3.6, 9, 9.5), 1, 0, minY, BAJADA_DEPTH, halfL)).toBe(-1);
    // Seen from the other half: not ours.
    expect(offGlassHigh(lob, -1, 0, minY, BAJADA_DEPTH, halfL)).toBe(-1);
  });

  it('AI: in about as many points as pros, by level, mostly kept in play', { timeout: 120000 }, () => {
    const run = (level: number, seeds: number[]) => {
      let points = 0, withBajada = 0, bajadas = 0, deep = 0, planned = 0, plannedDeep = 0, lost = 0, inPoint = false;
      for (const seed of seeds) {
        const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [level, level] });
        const frames = [null, null, null, null];
        let seq = 0, bounced = 0, back = 0, open = -1;
        for (let k = 0; k < 300 * 120; k++) {
          m.step(frames);
          for (; seq < m.eventSeq; seq++) {
            const e = m.events[seq % m.events.length]!;
            if (e.kind === E_HIT) {
              open = -1;
              if (OVERHEADS.has(e.a) && bounced > 0 && back > 0) {
                bajadas++;
                inPoint = true;
                open = e.team;
                // From deep, off the glass (a net player run back by a lob may meet one that came well out of it).
                if (Math.abs(e.z) > BAJADA_DEPTH) deep++;
                // (the rest: a high ball off the glass met above the head on a groundstroke plan becomes an overhead)
                // (planned from BAJADA_DEPTH - 0.5; a late release meets it nearer the net: 0.08 s late, 5.59 m, seed 11)
                if (m.ai[e.player]!.bajada) { planned++; if (Math.abs(e.z) > BAJADA_DEPTH - 1.0) plannedDeep++; }
              }
              bounced = 0; back = 0;
            } else if (e.kind === E_FLOOR) bounced++;
            else if (e.kind === E_WALL && bounced > 0 && (e.b === WALL_BACK_NEAR || e.b === WALL_BACK_FAR)) back++;
            else if (e.kind === E_POINT) {
              points++;
              if (inPoint) withBajada++;
              if (open >= 0 && e.team !== open) lost++;
              inPoint = false; open = -1;
            }
          }
        }
      }
      return { inPoints: withBajada / points, bajadas, deep: deep / Math.max(1, bajadas), planned, plannedDeep, lostShare: lost / Math.max(1, bajadas) };
    };
    const top = run(1, Array.from({ length: 20 }, (_, k) => k + 1));
    const low = run(0, [1, 2, 3, 4, 5, 6]);
    // WPT men 14-17% of points. Here about 28%: a smash now comes off the glass at 2.5 m, where it is taken overhead
    // (review round 6), and it is open in REVIEW.md.
    expect(top.inPoints).toBeGreaterThan(0.08);
    expect(top.inPoints).toBeLessThan(0.34);
    expect(low.inPoints).toBeLessThan(top.inPoints * 0.6);
    expect(top.deep).toBeGreaterThan(0.65);
    expect(top.planned).toBeGreaterThan(15);
    expect(top.plannedDeep).toBe(top.planned);
    expect(top.bajadas).toBeGreaterThan(25);
    // An attacking shot from the back, so a risky one: 15.5% end in its hitter's error over 2,000 points (match-stats);
    // a third would be a shot not worth playing.
    expect(top.lostShare).toBeLessThan(0.3);
  });

  it('human (QA bot following the hint): holds the overhead key and plays it off the glass, mostly in play', { timeout: 120000 }, () => {
    let offered = 0, played = 0, lost = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false] });
      const bot = new BotHuman(0, seed * 7, true);
      const f = new InputFrame();
      const frames = [f, null, null, null];
      let seq = 0, armed = false, bounced = 0, back = 0, open = false;
      for (let k = 0; k < 240 * 120; k++) {
        bot.act(m, f);
        m.step(frames);
        const p = m.players[0]!;
        // Each ball of ours that the hint would offer as a bajada, counted once.
        if (armed && m.phase === PH_RALLY && m.taker[0] === 0 && offGlassHigh(m.pred, m.side(0), m.time, minY, BAJADA_DEPTH, halfL) >= 0) {
          offered++;
          armed = false;
        }
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_HIT) {
            if (e.player === 0 && OVERHEADS.has(e.a) && bounced > 0 && back > 0) { played++; open = true; }
            else open = false;
            armed = e.team === 1;
            bounced = 0; back = 0;
          } else if (e.kind === E_FLOOR) bounced++;
          else if (e.kind === E_WALL && bounced > 0 && e.b === (m.side(0) > 0 ? WALL_BACK_NEAR : WALL_BACK_FAR)) back++;
          else if (e.kind === E_POINT) { if (open && e.team !== p.team) lost++; open = false; }
        }
      }
    }
    expect(played).toBeGreaterThan(5);
    expect(played / Math.max(1, offered)).toBeGreaterThan(0.3);
    expect(lost / played).toBeLessThan(0.3);
  });
});
