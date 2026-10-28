// Phase 7: every bug the QA army found, held as a test (docs/qa/REPORT.md lists them with how they were found).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_FAULT, E_HIT, PH_SETUP, PH_TOSS, PH_DEAD } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Rally, R_LET, R_POINT, WHY_SERVE_MISSED, WHY_SERVE_LET, WHY_HIT_BODY_OPP } from '../../src/sim/rules/rally.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { makeWorld, makeNetCloth } from '../../src/sim/setup.ts';
import type { NetCloth } from '../../src/sim/court/netCloth.ts';

/** A singles match with the human (player 0) serving, stepped to the moment they may drop the ball. */
function serving(): { m: MatchSim; f: InputFrame } {
  const m = new MatchSim({ seed: 3, human: [true, false], firstServer: 0 });
  const f = new InputFrame();
  while (m.time < m.phaseUntil + DT) { f.clear(); m.step([f, null]); }
  return { m, f };
}

function drop(m: MatchSim, f: InputFrame): void {
  f.clear();
  f.push(true, BTN_DRIVE, m.time);
  f.held = BTN_DRIVE;
  m.step([f, null]);
}

/** Events of these kinds from `from` on. */
function events(m: MatchSim, from: number, kind: number) {
  const out = [];
  for (let s = from; s < m.eventSeq; s++) {
    const e = m.events[s % m.events.length]!;
    if (e.kind === kind) out.push(e);
  }
  return out;
}

describe('serve rules (QA army, FIP 6.6 and 7.1.b)', () => {
  it('a swing at the serve that misses the ball is a fault, even a tap before the ball has bounced', () => {
    for (const early of [0.6, 0.3]) {
      const { m, f } = serving();
      const seq = m.eventSeq;
      drop(m, f);
      expect(m.phase).toBe(PH_TOSS);
      const at = m.tossIdeal - early;
      while (m.time + DT <= at) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
      f.clear();
      f.push(false, BTN_DRIVE, Math.max(at, m.time));
      m.step([f, null]);
      for (let k = 0; k < 10 && m.phase !== PH_DEAD; k++) { f.clear(); m.step([f, null]); }
      const faults = events(m, seq, E_FAULT);
      expect(faults.length, `released ${early} s early`).toBe(1);
      expect(faults[0]!.a).toBe(WHY_SERVE_MISSED);
      expect(faults[0]!.b).toBe(1);
      expect(events(m, seq, E_HIT).length).toBe(0);
    }
  });

  it('a dropped ball nobody swings at is not a serve: it bounces twice, the server picks it up and serves again', () => {
    const { m, f } = serving();
    const seq = m.eventSeq;
    drop(m, f);
    // Hold the key and never let go: the ball bounces twice.
    let back = false;
    for (let k = 0; k < 3 * 120 && !back; k++) {
      f.clear(); f.held = BTN_DRIVE; m.step([f, null]);
      back = m.phase === PH_SETUP;
    }
    expect(back).toBe(true);
    expect(events(m, seq, E_FAULT).length).toBe(0);
    expect(m.serveNo).toBe(1);
    // Letting go now swings at nothing and changes nothing.
    f.clear(); f.push(false, BTN_DRIVE, m.time); m.step([f, null]);
    expect(m.phase).toBe(PH_SETUP);
    expect(events(m, seq, E_FAULT).length).toBe(0);
    // A fresh drop and a release on the cue serves.
    while (m.time < m.phaseUntil + DT) { f.clear(); m.step([f, null]); }
    drop(m, f);
    expect(m.phase).toBe(PH_TOSS);
    const at = m.tossIdeal;
    while (m.time + DT <= at) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
    f.clear(); f.push(false, BTN_DRIVE, at); m.step([f, null]);
    for (let k = 0; k < 30; k++) { f.clear(); m.step([f, null]); }
    expect(events(m, seq, E_HIT).length).toBe(1);
    expect(events(m, seq, E_FAULT).length).toBe(0);
  });
});

describe('9.1: a serve off the net that touches a player (QA army)', () => {
  // Near team (0) serves into the far box x in [-5, 0], z in [-6.95, 0].
  function netServe(): Rally {
    const r = new Rally();
    r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0;
    r.onStrike(0, 1, true, 0.6, 1.0);
    r.onNet();
    return r;
  }

  it('9.1.b: off the net onto the receiver before the bounce is a let, not the server\'s point', () => {
    const r = netServe();
    r.onBallZ(-0.5); r.onBody(1);
    expect([r.result, r.why]).toEqual([R_LET, WHY_SERVE_LET]);
  });
  it('9.1.b: off the net onto the server\'s partner is a let, not a fault', () => {
    const r = netServe();
    r.onBody(0);
    expect([r.result, r.why]).toEqual([R_LET, WHY_SERVE_LET]);
  });
  it('9.1.a: off the net, into the box, then onto a player is still the net serve', () => {
    const r = netServe();
    r.onBallZ(-0.5); r.onFloor(-2, -4); r.onBody(1);
    expect([r.result, r.why]).toEqual([R_LET, WHY_SERVE_LET]);
  });
  it('without the net, the serve into the box then onto the receiver is the server\'s point (13.k)', () => {
    const r = new Rally();
    r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0;
    r.onStrike(0, 1, true, 0.6, 1.0);
    r.onBallZ(-0.5); r.onFloor(-2, -4); r.onBody(1);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 0, WHY_HIT_BODY_OPP]);
  });
});

describe('net cord (QA army: the ball\'s side after it rolls over the tape)', () => {
  const w = makeWorld();

  /** Fire a ball at the tape from the near side and fly it, the way MatchSim steps the ball and the cloth. */
  function cord(x: number, dy: number, speed: number, vy: number, topspin: boolean) {
    const net: NetCloth = makeNetCloth(w);
    const b = new Ball();
    b.cloth = net;
    b.pos.set(x, net.cableY(x) + dy, 0.6);
    b.vel.set(0, vy, -speed);
    if (topspin) b.spin.set(-150, 0, 0);
    let wrong = 0, over = false;
    for (let t = 0; t < 2; t += DT) {
      net.beginTick();
      b.step(w, DT, null);
      if (!b.coupled && net.awake) net.freeTick();
      // Beyond any pocket the netting can make (35 cm), a ball past the net is on the far side.
      if (b.pos.z < -0.45) { over = true; if (b.netSide !== -1) wrong++; }
    }
    return { wrong, over };
  }

  it('a ball that rolls over the tape and drops on the far side is on the far side once it is past the net', () => {
    // (Before the fix the side changed only once the ball's bottom cleared the cable's top, which a ball rolling
    // over the tape never does: 7 of these stayed on the hitter's side for up to 20 ticks past the net.)
    let overs = 0;
    for (const x of [-2, 0, 1.3]) {
      for (const dy of [0.005, 0.045, 0.06]) {
        for (const speed of [4, 6, 10]) {
          for (const vy of [0, 1]) {
            for (const topspin of [false, true]) {
              const r = cord(x, dy, speed, vy, topspin);
              if (r.over) overs++;
              expect(r.wrong, `x ${x} dy ${dy} v ${speed} vy ${vy} topspin ${topspin}`).toBe(0);
            }
          }
        }
      }
    }
    expect(overs).toBeGreaterThan(30);
  });
});
