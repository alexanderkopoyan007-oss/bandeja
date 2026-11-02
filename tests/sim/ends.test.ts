// The change of ends was the shortest break in a match: 3.4 s from the last ball to the next serve against 8 after any other point, the game's
// call gone in the frame it came up, and the card still up over the serve.
import { describe, expect, it } from 'vitest';
import { E_ENDS, E_GAME, E_HIT, E_POINT, E_TOSS, MatchSim, PH_DEAD, PH_SETUP } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { DT, ROUTINE_AFTER, ROUTINE_PERIOD, ROUTINE_SECS } from '../../src/sim/core/constants.ts';

describe('a change of ends', () => {
  it('holds the game\'s call, turns the pairs round at the cut, and takes longer than a fault', () => {
    const m = new MatchSim({ seed: 41, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    let seen = 0, gameAt = -1, lastBall = -1, sideAtGame = 0, ends = 0;
    const gaps: number[] = [], calls: number[] = [];
    let waiting = false;
    for (let k = 0; k < 120 * 1500 && gaps.length < 6; k++) {
      m.step([null, null, null, null]);
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_POINT) lastBall = m.time;
        if (e.kind === E_GAME) { gameAt = m.time; sideAtGame = m.side(0); }
        if (e.kind === E_ENDS && gameAt > 0) {
          calls.push(m.time - gameAt);
          ends++;
          waiting = true;
          gameAt = -1;
        }
        if (e.kind === E_HIT && waiting) { gaps.push(m.time - lastBall); waiting = false; }
      }
      // (nobody changes ends in the hold: the game's call is over the end it was won on)
      if (gameAt > 0 && m.phase === PH_DEAD) expect(m.side(0)).toBe(sideAtGame);
    }
    expect(ends).toBeGreaterThan(3);
    for (const c of calls) expect(c).toBeGreaterThan(2);
    for (const g of gaps) expect(g).toBeGreaterThan(5.5);
  }, 120_000);

  it('has everyone walking, off to the post in the hold and on from it on the other side', () => {
    const m = new MatchSim({ seed: 42, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    let holds = 0, walks = 0, wasWalk = 0;
    const was = [0, 0, 0, 0], d = [0, 0, 0, 0];
    for (let k = 0; k < 120 * 900 && walks < 4; k++) {
      m.step([null, null, null, null]);
      if (m.walking === 3) {
        if (wasWalk !== 3) { holds++; d.fill(0); }
        else for (let i = 0; i < 4; i++) d[i] = d[i]! + Math.abs(m.players[i]!.pos.x - was[i]!);
        for (let i = 0; i < 4; i++) was[i] = m.players[i]!.pos.x;
      } else if (wasWalk === 3) {
        // The cut: nobody crosses a net on screen, and everyone starts by the post on their new side, walking.
        expect(m.walking).toBe(2);
        walks++;
        for (let i = 0; i < 4; i++) {
          const p = m.players[i]!;
          expect(p.pos.z * m.side(p.team)).toBeGreaterThan(1);
          expect(p.pos.z * m.side(p.team)).toBeLessThan(2.5);
          expect(Math.abs(p.pos.x)).toBeGreaterThan(3.5);
        }
        expect(Math.max(...d)).toBeGreaterThan(0.5);
      }
      wasWalk = m.walking;
    }
    expect(holds).toBeGreaterThan(2);
    expect(walks).toBeGreaterThan(2);
  }, 120_000);

  it('is cut short by a human\'s key', () => {
    const m = new MatchSim({ seed: 43, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    const f = new InputFrame();
    let cut = 0;
    for (let k = 0; k < 120 * 2000 && !cut; k++) {
      f.clear();
      if (m.walking === 3 && m.phaseUntil - m.time > 1) {
        // (a match of bots to here: nobody's fingers serve for a human)
        (m as unknown as { ai: unknown[] }).ai[0] = null;
        const t = m.time, left = m.phaseUntil;
        f.push(true, BTN_DRIVE, t);
        m.step([f, null, null, null]);
        expect(m.phaseUntil).toBeLessThan(left - 0.5);
        cut = 1;
      } else m.step([f, null, null, null]);
    }
    expect(cut).toBe(1);
  }, 120_000);
});

describe('the server\'s routine', () => {
  it('is done before an AI tosses', () => {
    const m = new MatchSim({ seed: 44, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
    let seen = 0, placed = -1, n = 0;
    for (let k = 0; k < 120 * 300; k++) {
      m.step([null, null, null, null]);
      if (m.phase === PH_SETUP && m.walking === 0 && placed < 0) placed = m.time;
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_TOSS && placed >= 0) { expect(m.time - placed).toBeGreaterThan(ROUTINE_SECS - DT); placed = -1; n++; }
      }
    }
    expect(n).toBeGreaterThan(10);
  }, 120_000);

  it('makes a person\'s press wait for the ball to come back, a tap or a held key', () => {
    for (const hold of [false, true]) {
      const m = new MatchSim({ seed: 46, doubles: true, human: [true, false, false, false], aiLevel: [1, 1], timingScale: 1.5, assist: 0.45, autoTiming: false } as never);
      const M = m as never as { score: { serverPlayer(): number } };
      const f = new InputFrame();
      let seen = 0, placed = -1, pressed = -1, tossed = -1, down = false;
      for (let k = 0; k < 120 * 900 && tossed < 0; k++) {
        f.clear();
        const mine = m.phase === PH_SETUP && M.score.serverPlayer() === 0;
        if (mine && m.walking === 0 && placed < 0) placed = m.time;
        // (pressed with the first bounce on its way down)
        if (mine && placed >= 0 && pressed < 0 && m.time > placed + 1.2) { f.push(true, BTN_DRIVE, m.time); pressed = m.time; down = true; }
        else if (!hold && down && m.time > pressed + 0.1) { f.push(false, BTN_DRIVE, m.time); down = false; }
        f.held = down ? BTN_DRIVE : 0;
        m.step([f, null, null, null]);
        while (seen < m.eventSeq) {
          const e = m.events[seen % m.events.length]!;
          seen++;
          if (e.kind === E_TOSS && e.player === 0 && pressed >= 0) tossed = m.time;
        }
      }
      expect(pressed).toBeGreaterThan(0);
      // (a toss that doesn't wait turned the ball round in the air; a tap dropped in the wait never tossed at all)
      expect(tossed - placed).toBeGreaterThan(ROUTINE_AFTER + ROUTINE_PERIOD - DT);
      expect(tossed - placed).toBeLessThan(ROUTINE_AFTER + ROUTINE_PERIOD + 0.05);
    }
  }, 120_000);
});
