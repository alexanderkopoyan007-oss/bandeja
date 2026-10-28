// Phase 7: every bug the QA army found, held as a test (docs/qa/REPORT.md lists them with how they were found).
import { describe, expect, it } from 'vitest';
import { MatchSim, E_FAULT, E_FLOOR, E_HIT, E_WHIFF, PH_SETUP, PH_TOSS, PH_DEAD } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Rally, R_LET, R_NONE, R_POINT, WHY_SERVE_MISSED, WHY_SERVE_LET, WHY_HIT_BODY_OPP, WHY_DOUBLE_BOUNCE, WHY_WALL_BEFORE_BOUNCE, WHY_SERVE_AREA } from '../../src/sim/rules/rally.ts';
import { SURF_GLASS, SURF_MESH } from '../../src/sim/court/court.ts';
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

describe('the corner where the glass meets the floor (QA army, FIP 14.1.i)', () => {
  /** Near team (0) hits towards the far half. */
  function fromNear(): Rally {
    const r = new Rally();
    r.onStrike(0, 1, false);
    r.onBallZ(-1);
    return r;
  }

  it('a touch of the opponents\' back glass 6 cm up, then the floor 8 ms later, is the bounce: the ball is in play', () => {
    // (match 7 of the army: the game called it "hit the wall before bouncing"; 86 such calls in 200 matches)
    const r = fromNear();
    r.onWall(SURF_GLASS, -1, -0.28, 0.06, -9.97);
    r.onFloor(-0.27, -9.92);
    expect(r.result).toBe(R_NONE);
    expect(r.bounces).toBe(1);
    // The next bounce is the second: the receivers lose it.
    r.onFloor(-0.35, -5.94);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 0, WHY_DOUBLE_BOUNCE]);
  });

  it('higher up the glass, or low on the mesh, it is still the wall before the bounce (13.1.g)', () => {
    const a = fromNear();
    a.onWall(SURF_GLASS, -1, -0.28, 0.12, -9.97);
    expect([a.result, a.winner, a.why]).toEqual([R_POINT, 1, WHY_WALL_BEFORE_BOUNCE]);
    const b = fromNear();
    b.onWall(SURF_MESH, -1, -4.97, 0.05, -3);
    expect([b.result, b.winner, b.why]).toEqual([R_POINT, 1, WHY_WALL_BEFORE_BOUNCE]);
  });

  it('a serve into the box\'s corner with the side glass is in; a floor touch further on is a new bounce', () => {
    // (match 37: the game called it "Fault: hit the wall first")
    const box = (r: Rally) => { r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0; };
    const r = new Rally(); box(r);
    r.onStrike(0, 1, true, 0.86, 1.02); r.onBallZ(-0.5);
    r.onWall(SURF_GLASS, -1, -4.97, 0.06, -6.06);
    r.onFloor(-4.93, -6.11);
    expect(r.result).toBe(R_NONE);
    expect(r.bounces).toBe(1);
    const s = new Rally(); box(s);
    s.onStrike(0, 1, true, 0.86, 1.02); s.onBallZ(-0.5);
    s.onWall(SURF_GLASS, -1, -4.97, 0.06, -6.06);
    s.onFloor(-4.0, -7.5);
    expect([s.result, s.winner, s.why]).toEqual([R_POINT, 0, WHY_DOUBLE_BOUNCE]);
  });
});

describe('a serve that touches the tape from beyond the net\'s plane (QA army, FIP 9.1.a)', () => {
  it('is a net serve: into the box and not returned, it is played again', () => {
    // (matches 31 and 60: the centre was 3-5 cm past the plane when the ball met the tape, and the touch was dropped)
    const r = new Rally();
    r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0;
    r.onStrike(0, 1, true, 0.76, 1.02);
    r.onBallZ(-0.03);
    r.onNet();
    r.onFloor(-0.48, -0.99);
    r.onFloor(-1.11, -3.53);
    expect([r.result, r.why]).toEqual([R_LET, WHY_SERVE_LET]);
  });
});

describe('before the serve only the server plays the ball (QA army)', () => {
  it('the partner\'s swing at the dropped ball misses it: no hit, no point without a serve', () => {
    // (match 44: a monkey partner hit the ball the server had dropped, and the point was played on from there)
    const m = new MatchSim({ seed: 3, doubles: true, human: [true, false, true, false], firstServer: 0 });
    const f0 = new InputFrame(), f2 = new InputFrame();
    const frames = [f0, null, f2, null];
    while (m.time < m.phaseUntil + DT) { f0.clear(); f2.clear(); m.step(frames); }
    const seq = m.eventSeq;
    f0.clear(); f0.push(true, BTN_DRIVE, m.time); f0.held = BTN_DRIVE; f2.clear(); m.step(frames);
    expect(m.phase).toBe(PH_TOSS);
    const p2 = m.players[2]!, b = m.ball;
    let pressed = false, released = false;
    for (let k = 0; k < 120 && m.phase === PH_TOSS; k++) {
      // The partner stands beside the ball, racket side on, winds up and lets go as it comes up off the bounce.
      p2.pos.set(b.pos.x + 0.55 * p2.handed, 0, b.pos.z);
      f0.clear(); f0.held = BTN_DRIVE; f2.clear();
      if (!pressed) { f2.push(true, BTN_DRIVE, m.time); f2.held = BTN_DRIVE; pressed = true; }
      else if (!released && events(m, seq, E_FLOOR).length === 1 && b.vel.y > 0 && b.pos.y > 0.5) { f2.push(false, BTN_DRIVE, m.time); released = true; }
      else if (!released) f2.held = BTN_DRIVE;
      m.step(frames);
    }
    expect(released).toBe(true);
    const hits = events(m, seq, E_HIT).filter((e) => e.player === 2);
    expect(hits.length).toBe(0);
    expect(events(m, seq, E_WHIFF).some((e) => e.player === 2)).toBe(true);
  });
});

describe('a low drive into a net billowed by the wind (QA army)', () => {
  it('meets the netting where the wind has blown it, and does not go through', () => {
    // (match 276: a 4.6 m/s wind stood the bottom of the sleeping net 12 cm off the cable's line; a drive at 0.32 m
    // and 14.5 m/s was already past the netting when it came within the 4 cm a sleeping net was coupled at)
    const w = makeWorld({ env: { windX: -4.7, windZ: 4.6 } });
    const net: NetCloth = makeNetCloth(w);
    // Blown out by the wind, then asleep there (in the match it settles after a point; alone it flutters on).
    net.awake = true;
    for (let t = 0; t < 600; t++) { net.beginTick(); net.freeTick(); }
    const blown = new Float64Array(net.pos);
    let through = 0, n = 0;
    for (const x of [-1.8, 0]) {
      for (const speed of [14.5, 20]) {
        // Every phase of the ball's ticks against the netting: the miss needed the tick before coupling to end
        // just outside its reach.
        for (let k = 0; k < 16; k++) {
          net.pos.set(blown); net.prev.set(blown); net.sleep();
          const b = new Ball();
          b.cloth = net;
          b.pos.set(x, 0.32, 1.2 + (k / 16) * speed * DT);
          b.vel.set(0, 0, -speed);
          let far = false;
          for (let t = 0; t < 0.5; t += DT) {
            net.beginTick();
            b.step(w, DT, null);
            if (!b.coupled && net.awake) net.freeTick();
            if (b.pos.z < -0.45 && b.pos.y < 0.85) far = true;
          }
          n++;
          if (far) through++;
        }
      }
    }
    expect(net.bulge).toBeGreaterThan(0.08);
    expect(through, `${through} of ${n} through the net`).toBe(0);
  });
});

describe('the serve\'s drop behind the line (QA army, FIP 6.2 / 7.1.a)', () => {
  it('a ball dropped inside the service line and served is a fault', () => {
    // (match 698: the serve was played; the oracle called 7.1.a)
    const { m, f } = serving();
    // The server and the ball in hand 45 cm nearer the net, as the push left them.
    const p0 = m.players[0]!, s = p0.pos.z > 0 ? 1 : -1;
    p0.pos.z -= s * 0.45;
    m.ball.pos.z -= s * 0.45;
    expect(Math.abs(m.ball.pos.z)).toBeLessThan(m.world.court.def.serviceLineFromNet - 0.1);
    const seq = m.eventSeq;
    drop(m, f);
    const at = m.tossIdeal;
    while (m.time + DT <= at) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
    f.clear(); f.push(false, BTN_DRIVE, at); m.step([f, null]);
    for (let k = 0; k < 10; k++) { f.clear(); m.step([f, null]); }
    expect(events(m, seq, E_HIT).length).toBe(1);
    const faults = events(m, seq, E_FAULT);
    expect(faults.length).toBe(1);
    expect(faults[0]!.a).toBe(WHY_SERVE_AREA);
  });

  it('a partner walking into the server before the serve gives way: the server and the ball stay put', () => {
    // (the same match: a monkey partner pushed the server 45 cm forward, the ball in hand with them)
    // (a human server who has not dropped the ball yet: the setup lasts)
    const m = new MatchSim({ seed: 3, doubles: true, human: [true, false, true, false], firstServer: 0 });
    const f0 = new InputFrame(), f2 = new InputFrame();
    const frames = [f0, null, f2, null];
    m.step(frames);
    const sv = m.players[0]!, pt = m.players[2]!;
    const sx = sv.pos.x, sz = sv.pos.z, bz = m.ball.pos.z;
    const s = sz > 0 ? 1 : -1;
    for (let k = 0; k < 480 && m.phase === PH_SETUP; k++) {
      f0.clear();
      // Keys towards the server (moveX/moveY are screen axes for the near end: x along, y towards the net).
      f2.clear();
      const dx = sv.pos.x - pt.pos.x, dz = sv.pos.z - pt.pos.z, d = Math.hypot(dx, dz) || 1;
      f2.moveX = (dx / d) * s; f2.moveY = (-dz / d) * s;
      m.step(frames);
    }
    expect(Math.hypot(pt.pos.x - sv.pos.x, pt.pos.z - sv.pos.z)).toBeLessThan(1);
    expect(sv.pos.x).toBe(sx);
    expect(sv.pos.z).toBe(sz);
    expect(m.ball.pos.z).toBe(bz);
  });
});
