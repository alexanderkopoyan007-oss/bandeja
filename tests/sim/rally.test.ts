// Rally referee against the FIP rules (rule numbers in test names).
import { describe, expect, it } from 'vitest';
import {
  Rally, R_POINT, R_FAULT, R_LET, R_NONE, WHY_DOUBLE_BOUNCE, WHY_OWN_SIDE, WHY_WALL_BEFORE_BOUNCE, WHY_OWN_MESH,
  WHY_OUT, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP, WHY_HIT_BODY_OWN, WHY_SERVE_OUT_OF_BOX, WHY_SERVE_MESH,
  WHY_SERVE_ABOVE_WAIST, WHY_RECEIVER_VOLLEYED_SERVE, WHY_SERVE_DOOR, WHY_SERVE_LET,
} from '../../src/sim/rules/rally.ts';
import { SURF_GLASS, SURF_MESH } from '../../src/sim/court/court.ts';

// Near team (0) plays z > 0; it serves into the far box x in [-5, 0], z in [-6.95, 0].
function serveRally(): Rally {
  const r = new Rally();
  r.box.x0 = -5; r.box.x1 = 0; r.box.z0 = -6.95; r.box.z1 = 0;
  r.onStrike(0, 1, true, 0.6, 1.0);
  return r;
}
function rallyFromNear(): Rally {
  const r = serveRally();
  r.onBallZ(-1); r.onFloor(-2, -5); // good serve
  r.onStrike(1, -1, false); // return
  r.onBallZ(2); r.onFloor(1, 6); // good return
  r.onStrike(0, 1, false); // near team hits: now the ball is near's
  return r;
}

describe('serve (rules 6-9)', () => {
  it('good serve bounces in the diagonal box', () => {
    const r = serveRally();
    r.onBallZ(-1); r.onFloor(-2, -5);
    expect(r.result).toBe(R_NONE);
  });
  it('7.1.c: out of the box is a fault; lines are good', () => {
    const r = serveRally();
    r.onBallZ(-1); r.onFloor(1, -5);
    expect([r.result, r.why]).toEqual([R_FAULT, WHY_SERVE_OUT_OF_BOX]);
    const s = serveRally();
    s.onBallZ(-1); s.onFloor(0.02, -6.97);
    expect(s.result).toBe(R_NONE);
  });
  it('7.1.e: after bouncing in, touching the mesh is a fault but the glass is fine', () => {
    const r = serveRally();
    r.onBallZ(-1); r.onFloor(-2, -5); r.onWall(SURF_GLASS, -1);
    expect(r.result).toBe(R_NONE);
    r.onWall(SURF_MESH, -1);
    expect([r.result, r.why]).toEqual([R_FAULT, WHY_SERVE_MESH]);
  });
  it('9.2.a: net cord into the box is a let, unless it then touches the mesh', () => {
    const r = serveRally();
    r.onNet(); r.onBallZ(-1); r.onFloor(-2, -3); r.onFloor(-2, -6);
    expect([r.result, r.why]).toEqual([R_LET, WHY_SERVE_LET]);
    const s = serveRally();
    s.onNet(); s.onBallZ(-1); s.onFloor(-2, -3); s.onWall(SURF_MESH, -1);
    expect([s.result, s.why]).toEqual([R_FAULT, WHY_SERVE_MESH]);
  });
  it('net then out of the box is a fault, not a let', () => {
    const r = serveRally();
    r.onNet(); r.onBallZ(-1); r.onFloor(2, -3);
    expect(r.result).toBe(R_FAULT);
  });
  it('6.4: struck above the waist is a fault', () => {
    const r = new Rally();
    r.onStrike(0, 1, true, 1.2, 1.0);
    expect([r.result, r.why]).toEqual([R_FAULT, WHY_SERVE_ABOVE_WAIST]);
  });
  it('8.5: receiver volleying the serve gives the point to the server', () => {
    const r = serveRally();
    r.onBallZ(-1); r.onStrike(1, -1, false);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 0, WHY_RECEIVER_VOLLEYED_SERVE]);
  });
  it('7.1.f: serve out through the door is a fault without out-of-court play', () => {
    const r = serveRally();
    r.onBallZ(-1); r.onFloor(-2, -5); r.onExit(true);
    expect([r.result, r.why]).toEqual([R_FAULT, WHY_SERVE_DOOR]);
  });
});

describe('rally (rules 12-15)', () => {
  it('13.c: second bounce loses the point for the receiver', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onFloor(0, -4); r.onFloor(0, -8);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 0, WHY_DOUBLE_BOUNCE]);
  });
  it('12.3: after the bounce the ball may come off the glass and the mesh', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onFloor(0, -8); r.onWall(SURF_GLASS, -1); r.onWall(SURF_MESH, -1);
    expect(r.result).toBe(R_NONE);
  });
  it('13.g: hitting the opponent\'s wall before the bounce loses', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onWall(SURF_GLASS, -1);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 1, WHY_WALL_BEFORE_BOUNCE]);
  });
  it('contrapared: playing off your own glass is legal', () => {
    const r = rallyFromNear();
    r.onWall(SURF_GLASS, 1); r.onBallZ(-1); r.onFloor(0, -6);
    expect(r.result).toBe(R_NONE);
  });
  it('13.l: off your own mesh loses', () => {
    const r = rallyFromNear();
    r.onWall(SURF_MESH, 1);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 1, WHY_OWN_MESH]);
  });
  it('into the net and back on your own side loses', () => {
    const r = rallyFromNear();
    r.onNet(); r.onFloor(0, 1);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 1, WHY_OWN_SIDE]);
  });
  it('out without bouncing loses; out after a good bounce wins (14.d)', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onExit(false);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 1, WHY_OUT]);
    const s = rallyFromNear();
    s.onBallZ(-1); s.onFloor(0, -9); s.onExit(false);
    expect([s.result, s.winner, s.why]).toEqual([R_POINT, 0, WHY_EXIT_AFTER_BOUNCE]);
  });
  it('13.k / 13.j: ball hitting a player', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onBody(1);
    expect([r.result, r.winner, r.why]).toEqual([R_POINT, 0, WHY_HIT_BODY_OPP]);
    const s = rallyFromNear();
    s.onBody(0);
    expect([s.result, s.winner, s.why]).toEqual([R_POINT, 1, WHY_HIT_BODY_OWN]);
  });
  it('14.i: a ball landing in the corner where wall meets floor is good (floor first)', () => {
    const r = rallyFromNear();
    r.onBallZ(-1); r.onFloor(-4.97, -9.97); r.onWall(SURF_GLASS, -1);
    expect(r.result).toBe(R_NONE);
  });
});
