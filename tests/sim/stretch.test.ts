// Diving and jumping for a ball out of reach (owner, 2026-11-04): taken by itself when a held swing's ball passes
// only within a dive's or a jump's reach (windows.ts STRETCH_*, data/tuning.json //stretch), by humans and AI alike.
import { describe, expect, it } from 'vitest';
import { MatchSim, E_STRETCH, E_HIT } from '../../src/sim/match.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { Prediction } from '../../src/sim/ball/predict.ts';
import { Player, DEFAULT_TUNING } from '../../src/sim/player/player.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { findWindows, makeWindows, STRETCH_DIVE, STRETCH_JUMP, STRETCH_NONE } from '../../src/sim/contact/windows.ts';

const world = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] }).world;
const T = DEFAULT_TUNING;

function predict(x: number, y: number, z: number, vx: number, vy: number, vz: number): Prediction {
  const b = new Ball();
  b.pos.set(x, y, z);
  b.vel.set(vx, vy, vz);
  const pr = new Prediction();
  pr.compute(world, b, 0, 0, 2);
  return pr;
}

/** The first sample on the near half (z > 2) whose height is in [lo, hi], or -1. */
function sampleAt(pr: Prediction, lo: number, hi: number, falling = false): number {
  for (let i = 0; i < pr.n; i++) if (pr.z[i]! > 2 && pr.y[i]! >= lo && pr.y[i]! <= hi && (!falling || pr.vy[i]! < 0)) return i;
  return -1;
}

describe('the reach a dive or a jump adds', () => {
  const wins = makeWindows();
  it('a low ball 1.9 m wide is only a dive; 1 m wide it is a plain stroke; 2.8 m wide it is gone', () => {
    // A low drive from the far back, flat over the net.
    const pr = predict(0, 1.0, -8, 0, 2.4, 17);
    const i = sampleAt(pr, 0.35, 0.8);
    expect(i).toBeGreaterThan(0);
    const at = (off: number, stretch: boolean) => findWindows(pr, pr.x[i]! - off, pr.z[i]!, 1, false, 1, T, wins, 0, false, false, 0, 0, stretch);
    expect(at(1.9, false)).toBe(0);
    expect(at(1.9, true)).toBeGreaterThan(0);
    expect(wins[0]!.stretch).toBe(STRETCH_DIVE);
    expect(at(1.0, true)).toBeGreaterThan(0);
    expect(wins[0]!.stretch).toBe(STRETCH_NONE);
    expect(at(2.8, true)).toBe(0);
  });
  it('a lob going over the head just above the reach is only a jump', () => {
    const pr = predict(0, 1.0, -7, 0, 8.2, 9);
    const i = sampleAt(pr, 2.82, 2.9, true);
    expect(i).toBeGreaterThan(0);
    // Standing just short of where it passes over: once it is down in normal reach it is behind the body, past the stroke.
    const at = (stretch: boolean) => findWindows(pr, pr.x[i]!, pr.z[i]! - 0.32, 1, false, 1, T, wins, 0, true, false, 0, 0, stretch);
    expect(at(false)).toBe(0);
    expect(at(true)).toBeGreaterThan(0);
    expect(wins[0]!.stretch).toBe(STRETCH_JUMP);
  });
});

describe('the body in a stretch', () => {
  it('a dive flies, slides to a stop, and the keys move nothing until the player is up', () => {
    const p = new Player(0);
    p.pos.set(0, 0, 6);
    p.launchStretch(STRETCH_DIVE, 0, 3, 6, 0.25);
    let t = 0;
    for (; t < p.stretchUntil + 0.5; t += DT) {
      p.clock = t;
      p.driveX = -1; // pushing the other way the whole time
      p.driveZ = 0;
      p.move();
      if (t < p.stretchUntil - DT) expect(p.vel.x).toBeGreaterThanOrEqual(-1e-9);
    }
    // Carried towards the ball by the launch and the slide, then away once up.
    expect(p.stretchKind).toBe(0);
    expect(p.vel.x).toBeLessThan(0);
    expect(p.stretchUntil - p.stretchAt).toBeCloseTo(T.diveAir + T.diveUp, 6);
  });
  it('a jump is ballistic for twice its rise and peaks at the contact', () => {
    const p = new Player(0);
    p.vel.set(1.5, 0, 0);
    p.launchStretch(STRETCH_JUMP, 0, 0, 0, 0.5);
    const rise = Math.sqrt((2 * T.jumpHeight) / 9.81);
    expect(p.stretchAt).toBeCloseTo(0.5 - rise, 9);
    expect(p.stretchLand - p.stretchAt).toBeCloseTo(2 * rise, 9);
    for (let t = p.stretchAt; t < p.stretchLand - DT; t += DT) {
      p.clock = t;
      p.driveX = 0;
      p.driveZ = -1;
      p.move();
      expect(p.vel.x).toBeCloseTo(1.5, 9);
      expect(p.vel.z).toBe(0);
    }
  });
});

describe('in AI play', () => {
  it('players dive and jump now and then and get the ball back, and a match with them replays to the bit', { timeout: 600000 }, () => {
    // (pooled over six matches: a single seed's rare events move whenever the RNG stream does; 4 in 67 points when written)
    let stretches = 0, returned = 0, replayed = false;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
      const frames = [null, null, null, null];
      let seq = 0, mine = 0;
      const pending = new Map<number, number>();
      for (let k = 0; k < 300 * 120; k++) {
        m.step(frames);
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind === E_STRETCH) { stretches++; mine++; pending.set(e.player, m.time); }
          else if (e.kind === E_HIT && pending.has(e.player)) {
            if (m.time - pending.get(e.player)! < 0.6) returned++;
            pending.delete(e.player);
          }
        }
      }
      if (mine > 0 && !replayed) {
        const again = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
        for (let k = 0; k < 300 * 120; k++) again.step(frames);
        expect(again.hash()).toBe(m.hash());
        replayed = true;
      }
    }
    expect(stretches).toBeGreaterThan(0);
    expect(returned).toBeGreaterThan(0);
    expect(replayed).toBe(true);
  });
});
