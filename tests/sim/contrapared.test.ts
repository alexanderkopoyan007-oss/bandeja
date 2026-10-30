// The contrapared: a ball that has bounced and got behind the player, near their own back glass, is played up into
// that glass so it rebounds over the net (legal, FIP 13.l: only the own mesh is not). Solver, swing errors, who
// plays it and when, and what comes of it, for the AI and for a human (the QA bot on the keys with the assist).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_HIT, E_POINT, E_WHIFF } from '../../src/sim/match.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { V3 } from '../../src/sim/core/v3.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { WALL_BACK_NEAR } from '../../src/sim/court/court.ts';
import { WHY_OWN_MESH } from '../../src/sim/rules/rally.ts';
import {
  ShotSolver, strike, SHOT_CONTRAPARED, MOD_NONE, type ShotRequest, type ShotResult,
} from '../../src/sim/contact/shots.ts';
import { BotHuman } from '../../tools/qa/humans.ts';

const m0 = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] });
const solver = new ShotSolver(m0.world);
const glassTop = m0.world.court.def.backWall.glassHeight;
const netH = m0.world.court.netHeightAt(0);

/** Did the ghost go into the near back glass first, below its top, over the net clean and down on the far half? */
function clean(s: ShotSolver): boolean {
  return s.wallHit === WALL_BACK_NEAR && s.wallGlass && s.wallY < glassTop && !s.netTouched && !s.exited
    && s.netY > netH + 0.05 && s.landZ < 0;
}

describe('contrapared', () => {
  it('solver: up into the own back glass, over the net, down near the target', () => {
    const p = new V3(), v = new V3(), w = new V3();
    // (x, y, z) on the near half 1.0-2.5 m from the glass (z = 10), target on the far half.
    for (const [x, y, z, tx, tz] of [[0, 0.8, 8.6, 0, -6.5], [-3, 0.6, 9.0, 2, -7], [3.5, 1.2, 8.3, -3, -5], [-2, 1.0, 7.5, 0, -6]]) {
      p.set(x!, y!, z!);
      expect(solver.solveContra(p, tx!, tz!, -400, 30, 1.9, v, w)).toBe(true);
      solver.flyWalls(p, v, w);
      expect(clean(solver)).toBe(true);
      expect(Math.hypot(solver.landX - tx!, solver.landZ - tz!)).toBeLessThan(0.5);
      // Struck upwards, at a pace a lifted shot gives (not a smash: 2.5 m from the glass to 6 m past the net is the
      // hardest of these, 25 m/s).
      expect(v.y).toBeGreaterThan(0);
      expect(v.length()).toBeLessThan(28);
    }
  });

  it('a contrapared with no clean launch is searched for once, not again on every pass of the strike', () => {
    // (a failed search flies about 80 balls, and the strike's passes repeated it: 13 ms in one tick of seed 1505)
    const p = new V3(), v = new V3(), w = new V3();
    p.set(4.4, 0.4, 9.4);
    expect(solver.solveContra(p, -4, -8, -400, 14, 1.9, v, w)).toBe(false);
    expect(solver.lastEvals).toBeGreaterThan(50);
    expect(solver.solveContra(p, -4, -8, -300, 14, 1.9, v, w, true)).toBe(false);
    expect(solver.lastEvals).toBeLessThanOrEqual(10);
    expect(v.length()).toBeLessThanOrEqual(14 + 1e-9);
  });

  it('with the swing errors most still go glass, net, far court', () => {
    const res: ShotResult = { reachable: false, speed: 0, idealX: 0, idealZ: 0 };
    let n = 0, ok = 0;
    for (const [x, y, z] of [[0.5, 0.8, 8.6], [-2.5, 0.6, 8.9], [2.5, 1.1, 8.2]]) {
      for (let k = 0; k < 20; k++) {
        const b = new Ball();
        b.pos.set(x!, y!, z!);
        b.vel.set(0.4, -1.2, 7);
        b.spin.set(0, 0, 0);
        const req: ShotRequest = {
          shot: SHOT_CONTRAPARED, mod: MOD_NONE, targetX: 0, targetZ: -6.8, quality: 0.82, timingDelta: 0, handSide: 1,
          moving: 0, stretch: 0, power: 1, control: 1, spinScale: 1, motor: 0, bodyX: x!, bodyZ: z! - 0.6,
        };
        strike(solver, b, req, new Rng(100 + k), res);
        solver.flyWalls(b.pos, b.vel, b.spin);
        n++;
        if (clean(solver)) ok++;
      }
    }
    // (FIP-level players miss it too: it is a defensive shot, errorScale 1.35 in data/shots.json)
    expect(ok / n).toBeGreaterThan(0.8);
  });

  it('AI: a rare save off a ball behind the player, legal and mostly returned', () => {
    let hits = 0, contra = 0, lost = 0, mesh = 0, behind = 0, deep = 0;
    // 14 matches: over 6 a save or two either way moved the rates past the bounds (review round 3's AI changes: a
    // third of the saves lost in one build, 0.25% of hits in the next; over 14, 21 saves in 1807 hits, 2 lost; over
    // 20, 26 in 2597, 2 lost).
    for (let seed = 1; seed <= 14; seed++) {
      const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
      const frames = [null, null, null, null];
      let seq = 0, open = -1;
      for (let k = 0; k < 300 * 120; k++) {
        m.step(frames);
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_HIT) {
            hits++;
            open = -1;
            if (e.a === SHOT_CONTRAPARED) {
              contra++;
              open = e.team;
              const p = m.players[e.player]!, c = p.lastContact, s = m.side(p.team);
              // (the window wants it 0.1 m behind; the body moves on through the swing, and a too-early release meets
              // it a little in front: 0.32 m in seed 2)
              if (s * (c.z - p.pos.z) > -0.4) behind++;
              // (planned with the glass 0.75-2.8 m behind; an early release meets it sooner, 6.4 m out in seed 4)
              if (Math.abs(c.z) > 6.0) deep++;
            }
          } else if (e.kind === E_POINT && open >= 0) {
            if (e.team !== open) { lost++; if (e.a === WHY_OWN_MESH) mesh++; }
            open = -1;
          }
        }
      }
    }
    expect(contra / hits).toBeGreaterThan(0.004);
    expect(contra / hits).toBeLessThan(0.03);
    expect(behind).toBeGreaterThanOrEqual(contra * 0.85);
    expect(deep).toBeGreaterThanOrEqual(contra * 0.85);
    // Rarely into our own mesh above the glass, a real error (2 of 63 over 20 seeds before review round 2's error mix)
    expect(mesh / contra).toBeLessThanOrEqual(0.1);
    // A desperate save, often lost (60 seeds: 18 of 88 before the pros' serve mix, 33 of 105 after; one 30-seed range
    // gave 5 of 43, the next 13 of 45, so a tighter bound over 14 seeds only measures the seed).
    expect(lost / contra).toBeLessThan(0.45);
  });

  it('human (QA bot with the assist): plays it when the plan says so, and it comes back', () => {
    let plans = 0, contra = 0, back = 0;
    // 16 matches (review round 3's AI: 12 played over 10 matches, one short of the bound; 20 of 32 plans over 16,
    // 19 came back; before round 3, 42 of 68 plans over 24; now 87 of 161 over 48 seeds, 0.48-0.60 by group of 16).
    for (let seed = 1; seed <= 16; seed++) {
      const m = new MatchSim({ seed, doubles: true, human: [true, false, false, false] });
      const bot = new BotHuman(0, seed * 7);
      const f = new InputFrame();
      const frames = [f, null, null, null];
      let seq = 0, planned = false, open = false;
      for (let k = 0; k < 240 * 120; k++) {
        bot.act(m, f);
        m.step(frames);
        const st = m.stand[0]!;
        if (st.valid && st.contra) { if (!planned) plans++; planned = true; } else planned = false;
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_HIT && e.player === 0 && e.a === SHOT_CONTRAPARED) { contra++; open = true; }
          else if (e.kind === E_HIT) { if (open && e.team !== 0) back++; open = false; }
          else if ((e.kind === E_POINT || e.kind === E_WHIFF) && open) { if (e.kind === E_POINT && e.team === 0) back++; open = false; }
        }
      }
    }
    // Before the fix (turn charged on every re-plan, contrapared left out of the out-of-time fallback): 4 of 21.
    expect(contra).toBeGreaterThan(6);
    expect(contra / plans).toBeGreaterThan(0.4);
    expect(back / contra).toBeGreaterThanOrEqual(0.7);
  });
});
