// Tests of the QA rule oracles (tools/qa/refereeOracle.ts, tools/qa/scoreOracle.ts), each from a reading of the
// FIP Rules of Padel (application 01.01.2026). Test names carry the rule number. Readings: tools/qa/ORACLE-NOTES.md.
//
// Default scene: doubles, team 0 (players 0 and 2) defends z > 0, team 1 (players 1 and 3) z < 0. Player 0 serves
// from the right of their half (x > 0, as they face the net) to the box diagonally opposite: x < 0, z in
// (-6.975, 0) (service line 6.95 m from the net, 5 cm lines centred on it). Player 1 receives, 3 is their partner.

import { describe, expect, it } from 'vitest';
import type { Call, CourtFacts, Fact, Format, Half, ServeSide, Wall } from '../../tools/qa/facts.ts';
import { RefereeOracle } from '../../tools/qa/refereeOracle.ts';
import { ScoreOracle } from '../../tools/qa/scoreOracle.ts';

const COURT: CourtFacts = {
  width: 10,
  length: 20,
  serviceLineFromNet: 6.95,
  lineWidth: 0.05,
  doors: [
    { z0: -3.4, z1: -2.3, height: 2.1 },
    { z0: 2.3, z1: 3.4, height: 2.1 },
  ],
  outOfCourtPlay: false,
};
const OOC: CourtFacts = { ...COURT, outOfCourtPlay: true };

// --- fact builders -------------------------------------------------------------------------------------------------

type StrikeOpts = Partial<{ x: number; y: number; z: number; waist: number; outside: boolean; feetOk: boolean; half: Half }>;

const serve = (o: Partial<{ server: number; receiver: number; half: Half; side: ServeSide }> = {}): Fact => ({
  k: 'serve',
  server: 0,
  receiver: 1,
  half: 1,
  side: 'right',
  ...o,
});
const toss = (player = 0): Fact => ({ k: 'toss', player });
const serveStrike = (o: StrikeOpts = {}, player = 0): Fact => ({
  k: 'strike',
  player,
  serve: true,
  half: 1,
  x: 2.5,
  y: 0.8,
  z: 8.5,
  waist: 1.0,
  outside: false,
  feetOk: true,
  ...o,
});
const hit = (player: number, x: number, z: number, o: StrikeOpts = {}): Fact => ({
  k: 'strike',
  player,
  serve: false,
  half: player % 2 === 0 ? 1 : -1,
  x,
  y: 1,
  z,
  waist: 1,
  outside: false,
  feetOk: true,
  ...o,
});
const whiff = (player = 0, isServe = true): Fact => ({ k: 'whiff', player, serve: isServe });
const floor = (x: number, z: number): Fact => ({ k: 'floor', x, z });
const glass = (wall: Wall, x: number, y: number, z: number): Fact => ({ k: 'wall', surface: 'glass', wall, x, y, z });
const mesh = (wall: Wall, x: number, y: number, z: number): Fact => ({ k: 'wall', surface: 'mesh', wall, x, y, z });
const net = (part: 'net' | 'tape' | 'post' = 'tape'): Fact => ({ k: 'net', part, x: 0, y: 0.9, z: 0 });
const cross = (to: Half): Fact => ({ k: 'cross', to });
const exit = (wall: Wall, door: boolean, x: number, y: number, z: number): Fact => ({ k: 'exit', door, wall, x, y, z });
const enter = (wall: Wall, door = false): Fact => ({ k: 'enter', door, wall });
const floorOut = (x: number, z: number): Fact => ({ k: 'floorOutside', x, z });
const outerWall = (wall: Wall): Fact => ({ k: 'outerWall', wall });
const object: Fact = { k: 'object' };
const body = (player: number): Fact => ({ k: 'body', player });
const touch = (player: number, what: 'net' | 'opponentCourt' = 'net'): Fact => ({ k: 'playerTouch', player, what });
const stuck = (where: 'meshHole' | 'wallTop', wall: Wall): Fact => ({ k: 'stuck', where, wall });

/** Player 0's legal serve, bouncing in the box. */
const SERVE_IN: Fact[] = [serve(), toss(), serveStrike(), cross(-1), floor(-2, -4)];
/** The serve returned by player 1 from deep in their court; still in the air over their half. */
const RETURN_HIT: Fact[] = [...SERVE_IN, hit(1, -2.5, -8.5)];
/** ...and bounced correctly in team 0's court: team 0 must now return it. */
const RETURNED: Fact[] = [...RETURN_HIT, cross(1), floor(1.5, 6)];

// --- expected calls --------------------------------------------------------------------------------------------

const point = (winner: number, rule: string): Call => ({ result: 'point', winner, rule });
const faultCall = (rule: string): Call => ({ result: 'fault', winner: -1, rule });
const letCall = (rule: string): Call => ({ result: 'let', winner: -1, rule });

/** Feeds one attempt's facts; returns its single call and the index of the fact that decided it. */
function judge(facts: Fact[], court: CourtFacts = COURT, ref = new RefereeOracle({ doubles: true, court })) {
  let call: Call | null = null;
  let at = -1;
  facts.forEach((f, i) => {
    const c = ref.feed(f);
    if (c) {
      if (call) throw new Error(`second call at fact ${i}: ${JSON.stringify(c)}`);
      call = c;
      at = i;
    }
  });
  return { call: call as Call | null, at, ref };
}

/** All calls of a sequence of attempts. */
function calls(facts: Fact[], court: CourtFacts = COURT, ref = new RefereeOracle({ doubles: true, court })): Call[] {
  const out: Call[] = [];
  for (const f of facts) {
    const c = ref.feed(f);
    if (c) out.push(c);
  }
  return out;
}

const expectCall = (facts: Fact[], want: Call, court: CourtFacts = COURT) => {
  const r = judge(facts, court);
  expect(r.call).toEqual(want);
  expect(r.at).toBe(facts.length - 1); // decided at the last fact given, not earlier
};
const expectOpen = (facts: Fact[], court: CourtFacts = COURT) => {
  expect(judge(facts, court).call).toBeNull();
};

// =================================================================================================================

describe('RefereeOracle: the serve (rules 6 and 7)', () => {
  it('7.1.a / 6.1-6.3: feet infringing the serve stance is a fault', () => {
    expectCall([serve(), toss(), serveStrike({ feetOk: false })], faultCall('7.1.a'));
  });

  it('7.1.a / 6.4: a ball struck above the waist is a fault', () => {
    expectCall([serve(), toss(), serveStrike({ y: 1.05, waist: 1.0 })], faultCall('7.1.a'));
  });

  it('6.4: a ball struck exactly at the waist is legal', () => {
    expectCall(
      [serve(), toss(), serveStrike({ y: 1.0, waist: 1.0 }), cross(-1), floor(-2, -4), floor(-2, -8)],
      point(0, '13.1.c'),
    );
  });

  it('7.1.a / 6.2: serving without bouncing the ball first is a fault', () => {
    expectCall([serve(), serveStrike()], faultCall('7.1.a'));
  });

  it('6.2: a preliminary bounce on the floor counts as bouncing the ball', () => {
    expectOpen([serve(), floor(2.5, 8.2), serveStrike(), cross(-1), floor(-2, -4)]);
  });

  it('7.1.a / 6.2: the preliminary bounce in front of the service line is a fault', () => {
    expectCall([serve(), toss(), floor(2.5, 6.5), serveStrike()], faultCall('7.1.a'));
  });

  it('7.1.a / 6.2: the preliminary bounce in the other box (over the central line) is a fault', () => {
    expectCall([serve(), toss(), floor(-0.3, 8.5), serveStrike()], faultCall('7.1.a'));
  });

  it('6.2: a preliminary bounce touching the service line has not crossed it', () => {
    expectOpen([serve(), toss(), floor(2.5, 6.94), serveStrike({ z: 7.2 }), cross(-1), floor(-2, -4)]);
  });

  it('7.1.a / 6.2: a ball struck after it has crossed the service line is a fault', () => {
    expectCall([serve(), toss(), serveStrike({ z: 6.8 })], faultCall('7.1.a'));
  });

  it('7.1.a / 6.2: a ball struck over the imaginary central line is a fault', () => {
    expectCall([serve(), toss(), serveStrike({ x: -0.2 })], faultCall('7.1.a'));
  });

  it('6.6 / 7.1.b: an attempt that misses the ball is a serve, and a fault', () => {
    expectCall([serve(), toss(), whiff()], faultCall('7.1.b'));
  });

  it('7.1.c: a serve bouncing past the service line is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), floor(-2, -7.2)], faultCall('7.1.c'));
  });

  it('7.1.c: lines are good, a bounce on the service line is in', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), floor(-2, -6.97), floor(-2, -9)], point(0, '13.1.c'));
  });

  it('7.1.c: a bounce just clear of the service line is out', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), floor(-2, -6.98)], faultCall('7.1.c'));
  });

  it('7.1.c / 6.5: a serve into the wrong box (not diagonal) is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), floor(2, -4)], faultCall('7.1.c'));
  });

  it('7.1.c: a bounce on the central service line is in', () => {
    expectOpen([serve(), toss(), serveStrike(), cross(-1), floor(0.02, -4)]);
  });

  it('7.1.c: a serve that drops on the server\'s own side is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), net('net'), floor(0.8, 0.6)], faultCall('7.1.c'));
  });

  it('7.1.c / 6.5: a serve hitting the glass before bouncing is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), glass('backFar', -2, 1.4, -10)], faultCall('7.1.c'));
  });

  it('7.1.c: a serve leaving the court before bouncing is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), exit('sideLeft', false, -5, 3.2, -3)], faultCall('7.1.c'));
  });

  it('7.1.d: a serve hitting the server\'s partner is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), body(2)], faultCall('7.1.d'));
  });

  it('7.1.d: a serve hitting the server\'s partner\'s racket is a fault', () => {
    expectCall([serve(), toss(), serveStrike(), hit(2, 1, 1)], faultCall('7.1.d'));
  });

  it('7.1.e: a serve that bounces in the box and touches the mesh is a fault', () => {
    expectCall([...SERVE_IN, mesh('sideLeft', -5, 1, -2.5)], faultCall('7.1.e'));
  });

  it('7.1.e: box, back glass, then the mesh before the second bounce is still a fault', () => {
    expectCall([...SERVE_IN, glass('backFar', -3, 1, -10), mesh('sideLeft', -5, 1.2, -5.5)], faultCall('7.1.e'));
  });

  it('12.3: box then glass keeps the serve in play; the second bounce wins it for the server (13.1.c)', () => {
    expectCall([...SERVE_IN, glass('backFar', -3, 1, -10), floor(-3, -8.5)], point(0, '13.1.c'));
  });

  it('12.3 / 8.1: the receiver may return the serve off the back glass', () => {
    expectOpen([...SERVE_IN, glass('backFar', -3, 1, -10), hit(1, -3, -8.6)]);
  });

  it('7.1.e: a served ball stuck in a mesh hole after the bounce touched the fence: fault', () => {
    expectCall([...SERVE_IN, stuck('meshHole', 'sideLeft')], faultCall('7.1.e'));
  });

  it('7.1.f: bounced in the box and straight out through the door, no out-of-court play: fault', () => {
    expectCall([...SERVE_IN, exit('sideLeft', true, -5, 1, -2.8)], faultCall('7.1.f'));
  });

  it('13.1.d: a served ball out through the door after the glass (not directly) wins the point', () => {
    expectCall([...SERVE_IN, glass('sideLeft', -5, 1, -7), exit('sideLeft', true, -5, 1, -2.8)], point(0, '13.1.d'));
  });

  it('13.1.d: a served ball going out over the wall after the bounce, no out-of-court play, wins the point', () => {
    expectCall([...SERVE_IN, glass('backFar', -3, 2, -10), exit('sideLeft', false, -5, 3.1, -4)], point(0, '13.1.d'));
  });

  it('7.1.f / 13.1.e: with out-of-court play the serve out through the door stays in play', () => {
    expectOpen([...SERVE_IN, exit('sideLeft', true, -5, 1, -2.8)], OOC);
    expectCall([...SERVE_IN, exit('sideLeft', true, -5, 1, -2.8), floorOut(-7, -2)], point(0, '13.1.e'), OOC);
  });

  it('13.1.e: with out-of-court play a served ball out over the end wall wins the point at once', () => {
    expectCall([...SERVE_IN, exit('backFar', false, -3, 4.1, -10)], point(0, '13.1.e'), OOC);
  });

  it('6.5: from the left the serve goes to the other diagonal box', () => {
    const s = serve({ side: 'left' });
    expectOpen([s, toss(), serveStrike({ x: -2.5 }), cross(-1), floor(2, -4)]);
    expectCall([s, toss(), serveStrike({ x: -2.5 }), cross(-1), floor(-2, -4)], faultCall('7.1.c'));
  });

  it('6.5: serving from the z < 0 half, the right box is at x > 0 on the far side', () => {
    const s = serve({ server: 1, receiver: 0, half: -1, side: 'right' });
    const st = serveStrike({ x: -2.5, z: -8.5, half: -1 }, 1);
    expectOpen([s, toss(1), st, cross(1), floor(2, 4)]);
    expectCall([s, toss(1), st, cross(1), floor(-2, 4)], faultCall('7.1.c'));
  });

  it('6.5: serving from the z < 0 half from the left, the box is at x < 0', () => {
    const s = serve({ server: 3, receiver: 2, half: -1, side: 'left' });
    const st = serveStrike({ x: 2.5, z: -8.5, half: -1 }, 3);
    expectOpen([s, toss(3), st, cross(1), floor(-2, 4)]);
    expectCall([s, toss(3), st, cross(1), floor(2, 4)], faultCall('7.1.c'));
  });

  it('6.2: serving from the z < 0 half, the server\'s own area is behind z = -6.95', () => {
    const s = serve({ server: 1, receiver: 0, half: -1, side: 'right' });
    expectCall([s, toss(1), serveStrike({ x: -2.5, z: -6.5, half: -1 }, 1)], faultCall('7.1.a'));
  });
});

describe('RefereeOracle: return of serve (rule 8)', () => {
  it('8.5: the serve hitting the receiver before it bounces is a point to the server', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), body(1)], point(0, '8.5'));
  });

  it('8.5: the serve hitting the receiver\'s partner before it bounces is a point to the server', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), body(3)], point(0, '8.5'));
  });

  it('8.1 / 8.5: the receiver volleying the serve (racket before the bounce) loses the point', () => {
    expectCall([serve(), toss(), serveStrike(), cross(-1), hit(1, -2, -5)], point(0, '8.5'));
  });

  it('8.1: the receiver\'s partner returning the serve loses the point', () => {
    expectCall([...SERVE_IN, hit(3, -2, -8)], point(0, '8.1'));
  });

  it('8.1: the receiver returning after the bounce keeps the point going', () => {
    expectOpen(RETURN_HIT);
  });
});

describe('RefereeOracle: net serves and lets (rule 9)', () => {
  it('9.1.a: net, then in the box, then the second bounce: let', () => {
    expectCall([serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), floor(-1, -6)], letCall('9.1.a'));
  });

  it('9.1.a: net, in the box, returned by the receiver: still a let', () => {
    expectCall([serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), hit(1, -1, -5)], letCall('9.1.a'));
  });

  it('9.1.a: net, in the box, off the glass and bounced: let (glass is not the fence)', () => {
    expectCall(
      [serve(), toss(), serveStrike(), net('post'), cross(-1), floor(-1, -2), glass('backFar', -1, 1, -10), floor(-1, -9)],
      letCall('9.1.a'),
    );
  });

  it('9.1.a / 7.1.e: net, in the box, then the mesh: fault, not a let', () => {
    expectCall(
      [serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), mesh('sideLeft', -5, 0.8, -2.5)],
      faultCall('7.1.e'),
    );
  });

  it('9.1.a / 7.1.c: net, then outside the box: fault', () => {
    expectCall([serve(), toss(), serveStrike(), net(), cross(-1), floor(1, -2)], faultCall('7.1.c'));
  });

  it('9.1.b: net, then the receiver hit before the bounce: let, not a point (8.5)', () => {
    expectCall([serve(), toss(), serveStrike(), net(), cross(-1), body(1)], letCall('9.1.b'));
  });

  it('9.1.b: net, then the server\'s partner hit: let, not a fault (7.1.d)', () => {
    expectCall([serve(), toss(), serveStrike(), net(), body(2)], letCall('9.1.b'));
  });

  it('9.1.a / 7.1.f: net, in the box, straight out through the door (no out-of-court play): fault', () => {
    expectCall(
      [serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), exit('sideLeft', true, -5, 0.8, -2.8)],
      faultCall('7.1.f'),
    );
  });

  it('9.2.b: a let on the first serve keeps serve 1', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    const r = judge([serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), floor(-1, -6)], COURT, ref);
    expect(r.call?.result).toBe('let');
    expect(ref.serveNo).toBe(1);
  });

  it('9.2.c: a let on the second serve repeats only the second serve; a fault then is a double fault (13.1.q)', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    const got = calls(
      [
        serve(), toss(), serveStrike(), cross(-1), floor(-2, -7.5), // fault
        serve(), toss(), serveStrike(), net(), cross(-1), floor(-1, -2), floor(-1, -6), // let on serve 2
        serve(), toss(), serveStrike(), cross(-1), floor(2, -4), // fault again
      ],
      COURT,
      ref,
    );
    expect(got).toEqual([faultCall('7.1.c'), letCall('9.1.a'), point(1, '13.1.q')]);
    expect(ref.serveNo).toBe(1);
  });

  it('9.2.c: after a fault and a let the serve number is still 2', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    calls([serve(), toss(), whiff(), serve(), toss(), serveStrike(), net(), cross(-1), body(1)], COURT, ref);
    expect(ref.serveNo).toBe(2);
  });
});

describe('RefereeOracle: serve numbering (rule 6, 13.1.q)', () => {
  it('rule 6: a first-serve fault gives a second serve', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    expect(ref.serveNo).toBe(1);
    expect(judge([serve(), toss(), whiff()], COURT, ref).call).toEqual(faultCall('7.1.b'));
    expect(ref.serveNo).toBe(2);
  });

  it('13.1.q: two consecutive faults lose the point', () => {
    const got = calls([serve(), toss(), whiff(), serve(), toss(), serveStrike({ feetOk: false })]);
    expect(got).toEqual([faultCall('7.1.b'), point(1, '13.1.q')]);
  });

  it('13.1.q: a point played on the second serve resets to serve 1', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    const got = calls([serve(), toss(), whiff(), ...SERVE_IN, floor(-2, -8)], COURT, ref);
    expect(got).toEqual([faultCall('7.1.b'), point(0, '13.1.c')]);
    expect(ref.serveNo).toBe(1);
  });

  it('feed: facts after a decision are ignored until the next serve', () => {
    const r = judge([serve(), toss(), whiff(), cross(-1), floor(-2, -4), floor(-2, -7), body(1)]);
    expect(r.call).toEqual(faultCall('7.1.b'));
    expect(r.at).toBe(2);
  });

  it('feed: nothing is decided before the attempt\'s facts decide it', () => {
    const ref = new RefereeOracle({ doubles: true, court: COURT });
    for (const f of RETURNED) expect(ref.feed(f)).toBeNull();
  });
});

describe('RefereeOracle: ball in play and points lost (rules 12, 13)', () => {
  it('13.1.a: a player touching the net while the ball is in play loses the point', () => {
    expectCall([...RETURN_HIT, touch(2, 'net')], point(1, '13.1.a'));
  });

  it('13.1.a: a player touching the opponents\' court loses the point', () => {
    expectCall([...RETURNED, touch(1, 'opponentCourt')], point(0, '13.1.a'));
  });

  it('12.2 / 13.1.a: a net touch during a serve that is a fault does not count (ball never in play)', () => {
    expectCall([serve(), toss(), serveStrike(), touch(2), cross(-1), floor(-2, -7.5)], faultCall('7.1.c'));
  });

  it('12.2 / 13.1.a: a net touch during a serve that proves valid loses the point when it is returned', () => {
    expectCall([serve(), toss(), serveStrike(), touch(2), cross(-1), floor(-2, -4), hit(1, -2, -8.5)], point(1, '13.1.a'));
  });

  it('12.2 / 13.1.a: the receiver touching the net during the serve, serve unreturned: server wins on 13.1.a', () => {
    expectCall([serve(), toss(), serveStrike(), touch(3), cross(-1), floor(-2, -4), floor(-2, -8)], point(0, '13.1.a'));
  });

  it('13.1.c: the ball bouncing a second time before being returned loses the point', () => {
    expectCall([...RETURNED, floor(1, 8)], point(1, '13.1.c'));
  });

  it('13.1.f: volleying the ball before it has come over the net loses the point', () => {
    expectCall([...RETURN_HIT, hit(0, -1, -0.4)], point(1, '13.1.f'));
  });

  it('14.1.a: volleying once the ball is over your half is a correct return', () => {
    expectOpen([...RETURN_HIT, cross(1), hit(0, -1, 1.5)]);
    expectCall([...RETURN_HIT, cross(1), hit(0, -1, 1.5), cross(-1), floor(-2, -5), floor(-2, -8)], point(0, '13.1.c'));
  });

  it('13.1.g: hitting the opponents\' glass before the bounce loses', () => {
    expectCall([...RETURN_HIT, cross(1), glass('backNear', 1, 1.5, 10)], point(0, '13.1.g'));
  });

  it('13.1.g: hitting the opponents\' mesh before the bounce loses', () => {
    expectCall([...RETURN_HIT, cross(1), mesh('sideRight', 5, 1.2, 4)], point(0, '13.1.g'));
  });

  it('13.1.g: off your own glass, then their glass without a bounce, loses', () => {
    expectCall(
      [...SERVE_IN, hit(1, -2, -9), glass('backFar', -2, 2, -10), cross(1), glass('backNear', 1, 2, 10)],
      point(0, '13.1.g'),
    );
  });

  it('13.1.g: out over the opponents\' wall without bouncing loses', () => {
    expectCall([...RETURN_HIT, cross(1), exit('backNear', false, 1, 4.3, 10)], point(0, '13.1.g'));
  });

  it('13.1.g: an element not related to the court (ceiling, lights) over the opponents\' half before the bounce loses', () => {
    expectCall([...RETURN_HIT, cross(1), object], point(0, '13.1.g'));
  });

  it('13.1.h: net, then straight onto the opponents\' wall, loses', () => {
    expectCall([...RETURN_HIT, net(), cross(1), glass('sideRight', 5, 0.9, 1)], point(0, '13.1.h'));
  });

  it('13.1.i: the same player hitting twice loses', () => {
    expectCall([...RETURN_HIT, hit(1, -2.4, -8.2)], point(0, '13.1.i'));
  });

  it('13.1.o: both partners hitting the ball consecutively loses', () => {
    expectCall([...RETURN_HIT, hit(3, -1, -6)], point(0, '13.1.o'));
  });

  it('12.1 / 13.1.o: the same pair hitting again after the bounce, with no touch by the others, loses', () => {
    expectCall([...RETURNED, glass('backNear', 1, 1.2, 10), cross(-1), hit(3, 0.5, -0.8)], point(0, '13.1.o'));
  });

  it('13.1.j: the ball touching the hitter\'s partner after the hit loses', () => {
    expectCall([...RETURN_HIT, body(3)], point(0, '13.1.j'));
  });

  it('13.1.j: the ball touching the hitter himself loses', () => {
    expectCall([...RETURN_HIT, body(1)], point(0, '13.1.j'));
  });

  it('13.1.k / 14.1.a: the ball hitting an opponent\'s body before it bounces: the opponents lose', () => {
    expectCall([...RETURN_HIT, cross(1), body(2)], point(1, '13.1.k'));
  });

  it('13.1.k: the ball hitting an opponent after the bounce: the opponents lose', () => {
    expectCall([...RETURNED, body(0)], point(1, '13.1.k'));
  });

  it('13.1.l: the ball touching your own mesh after your hit loses', () => {
    expectCall([...SERVE_IN, hit(1, -4.5, -5), mesh('sideLeft', -5, 1.5, -5)], point(0, '13.1.l'));
  });

  it('13.1.l: the ball dropping on your own side (into the net) loses', () => {
    expectCall([...RETURN_HIT, net('net'), floor(-1, -0.5)], point(0, '13.1.l'));
  });

  it('13.1.l: out over your own wall without crossing loses', () => {
    expectCall([...SERVE_IN, hit(1, -3, -9.5), exit('backFar', false, -3, 4.2, -10)], point(0, '13.1.l'));
  });

  it('13.1.l: an element not related to the court over your own half loses', () => {
    expectCall([...RETURN_HIT, object], point(0, '13.1.l'));
  });

  it('13.1.p: striking from outside the court without authorisation loses', () => {
    expectCall([...RETURNED, hit(0, 4.9, 3, { outside: true })], point(1, '13.1.p'));
  });

  it('13.1.p / 16: striking from outside with out-of-court play authorised is allowed', () => {
    expectOpen([...RETURNED, hit(0, 4.9, 3, { outside: true })], OOC);
  });
});

describe('RefereeOracle: out of the court (13.1.d, 13.1.e, 14.1.j, rule 16)', () => {
  it('13.1.d: no out-of-court play: out over the side wall after a good bounce ends the point at once', () => {
    expectCall([...RETURNED, exit('sideRight', false, 5, 3.2, 1)], point(1, '13.1.d'));
  });

  it('13.1.d: no out-of-court play: out through the door after a good bounce ends the point at once', () => {
    expectCall([...RETURNED, exit('sideRight', true, 5, 1, 2.8)], point(1, '13.1.d'));
  });

  it('13.1.e: out-of-court play: over the end wall after bouncing correctly, decided at once for the hitter', () => {
    expectCall([...RETURNED, exit('backNear', false, 1, 4.1, 10)], point(1, '13.1.e'), OOC);
  });

  it('13.1.e: out-of-court play: over the side wall it stays in play until it bounces outside', () => {
    expectOpen([...RETURNED, exit('sideRight', false, 5, 3.3, 1.5)], OOC);
    expectCall([...RETURNED, exit('sideRight', false, 5, 3.3, 1.5), floorOut(7, 1)], point(1, '13.1.e'), OOC);
  });

  it('13.1.e: out-of-court play: through the door, then an element not related to the court, loses', () => {
    expectCall([...RETURNED, exit('sideRight', true, 5, 1, 2.8), object], point(1, '13.1.e'), OOC);
  });

  it('13.1.e: out-of-court play: the outside of the court\'s own wall is part of the court, still in play', () => {
    expectOpen([...RETURNED, exit('sideRight', true, 5, 1, 2.8), outerWall('sideRight')], OOC);
  });

  it('14.1.j: a return from outside that comes back in and bounces in the opponents\' court is correct', () => {
    const facts = [
      ...RETURNED,
      exit('sideRight', true, 5, 1, 2.8),
      hit(0, 6.5, 2, { outside: true }),
      enter('sideRight', true),
      cross(-1),
      floor(-1, -5),
    ];
    expectOpen(facts, OOC);
    expectCall([...facts, floor(-1, -8)], point(0, '13.1.c'), OOC);
  });

  it('14.1.j: a return from outside that bounces outside before coming back in loses', () => {
    expectCall(
      [...RETURNED, exit('sideRight', true, 5, 1, 2.8), hit(0, 6.5, 2, { outside: true }), floorOut(6, -1)],
      point(1, '14.1.j'),
      OOC,
    );
  });

  it('14.1.j: a return from outside must still not hit the opponents\' wall before the bounce (13.1.g)', () => {
    expectCall(
      [
        ...RETURNED,
        exit('sideRight', false, 5, 3.4, 1),
        hit(0, 6.5, 1, { outside: true }),
        enter('sideRight'),
        cross(-1),
        glass('backFar', -2, 1.5, -10),
      ],
      point(1, '13.1.g'),
      OOC,
    );
  });
});

describe('RefereeOracle: correct returns and points won (rules 14, 15)', () => {
  it('14.1.b: off your own glass and then into the opponents\' court is correct', () => {
    const facts = [...SERVE_IN, hit(1, -2, -9), glass('backFar', -2, 2, -10), cross(1), floor(1, 5)];
    expectOpen(facts);
    expectCall([...facts, floor(1, 8)], point(1, '13.1.c'));
  });

  it('14.1.c: bouncing in the opponents\' court and then the mesh keeps the ball in play', () => {
    expectOpen([...RETURNED, mesh('sideRight', 5, 1, 4)]);
    expectCall([...RETURNED, mesh('sideRight', 5, 1, 4), floor(3, 4)], point(1, '13.1.c'));
  });

  it('14.1.d: bounced in the opponents\' court then the lights or ceiling: the hitter wins', () => {
    expectCall([...RETURNED, glass('backNear', 1, 2, 10), object], point(1, '14.1.d'));
  });

  it('14.1.e: touching the net and then landing in the opponents\' court is correct', () => {
    const facts = [...RETURN_HIT, net('tape'), cross(1), floor(0.5, 1)];
    expectOpen(facts);
    expectCall([...facts, floor(0.5, 2)], point(1, '13.1.c'));
  });

  it('14.1.g: a ball that bounces back over the net may be hit by the opponents over the other side', () => {
    const facts = [...RETURNED, cross(-1), hit(0, -0.5, -0.6)];
    expectOpen(facts);
    expectCall([...facts, floor(-1, -3), floor(-1, -6)], point(0, '13.1.c'));
  });

  it('14.1.g / 13.1.c: a ball that bounces back over the net and bounces there was not returned', () => {
    expectCall([...RETURNED, cross(-1), floor(-0.5, -1.5)], point(1, '13.1.c'));
  });

  it('14.1.i: a bounce in the angle of the opponents\' wall and floor (corner nick) is correct', () => {
    const facts = [...RETURN_HIT, cross(1), glass('backNear', 2, 0.034, 9.97), floor(2, 9.96)];
    expectOpen(facts);
    expectCall([...facts, floor(2, 7.5)], point(1, '13.1.c'));
  });

  it('14.1.i / 13.1.g: a touch of the opponents\' wall clear of the floor is not a corner', () => {
    expectCall([...RETURN_HIT, cross(1), glass('backNear', 2, 0.3, 9.97)], point(0, '13.1.g'));
  });

  it('15.1.a: after bouncing in the opponents\' court, stuck in a mesh hole: point won', () => {
    expectCall([...RETURNED, stuck('meshHole', 'sideRight')], point(1, '15.1.a'));
  });

  it('15.1.b: after bouncing in the opponents\' court, at rest on top of the wall: point won', () => {
    expectCall([...RETURNED, glass('backNear', 1, 2.9, 10), stuck('wallTop', 'backNear')], point(1, '15.1.b'));
  });

  it('15.1 / 13.1.g: stuck in the opponents\' mesh without bouncing first is lost by the hitter', () => {
    expectCall([...RETURN_HIT, cross(1), stuck('meshHole', 'sideRight')], point(0, '13.1.g'));
  });

  it('singles: the same rules with players 0 and 1', () => {
    const ref = new RefereeOracle({ doubles: false, court: COURT });
    const r = judge([...SERVE_IN, hit(1, -2, -8.5), cross(1), floor(2, 5), floor(2, 8)], COURT, ref);
    expect(r.call).toEqual(point(1, '13.1.c'));
  });
});

// =================================================================================================================

const fmt = (o: Partial<Format> = {}): Format => ({
  mode: 'advantage',
  setsToWin: 2,
  gamesPerSet: 6,
  finalSet: 'normal',
  doubles: false,
  firstServerTeam: 0,
  team0Half: 1,
  ...o,
});

const pts = (s: ScoreOracle, ...winners: number[]) => {
  for (const w of winners) s.pointWon(w);
};
/** Games won 4-0 by the given teams. */
const gamesTo = (s: ScoreOracle, ...winners: number[]) => {
  for (const w of winners) pts(s, w, w, w, w);
};
/** Each game won by its server. */
const holds = (s: ScoreOracle, n: number) => {
  for (let i = 0; i < n; i++) gamesTo(s, s.state().serverTeam);
};

describe('ScoreOracle: a game (rule 1)', () => {
  it('1.score.1: 15, 30, 40, game', () => {
    const s = new ScoreOracle(fmt());
    pts(s, 0, 0, 0);
    expect(s.state().points).toEqual([3, 0]);
    pts(s, 0);
    expect(s.state().games).toEqual([1, 0]);
    expect(s.state().points).toEqual([0, 0]);
  });

  it('1.score.1 (Advantage): deuce, advantage, back to deuce; two consecutive points win', () => {
    const s = new ScoreOracle(fmt());
    pts(s, 0, 1, 0, 1, 0, 1); // deuce
    pts(s, 0); // advantage
    expect(s.state().games).toEqual([0, 0]);
    pts(s, 1); // deuce
    pts(s, 1); // advantage team 1
    pts(s, 0, 0, 1, 1, 1); // deuce, adv 0, deuce, adv 1, game
    expect(s.state().games).toEqual([0, 1]);
    expect(s.state().deciding).toBe(false);
  });

  it('1.score.1 (Advantage): there is never a deciding point', () => {
    const s = new ScoreOracle(fmt());
    pts(s, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1);
    expect(s.state().deciding).toBe(false);
    expect(s.needs()).toBeNull();
  });

  it('Star Point: deuce 1 -> adv 1 -> deuce 2 -> adv 2 -> deuce 3 -> star point', () => {
    const s = new ScoreOracle(fmt({ mode: 'star' }));
    pts(s, 0, 1, 0, 1, 0, 1); // deuce 1
    expect(s.state().deciding).toBe(false);
    pts(s, 0); // advantage 1
    pts(s, 1); // deuce 2
    expect(s.state().games).toEqual([0, 0]);
    expect(s.state().deciding).toBe(false);
    pts(s, 1); // advantage 2 (team 1)
    pts(s, 0); // deuce 3
    expect(s.state().games).toEqual([0, 0]);
    expect(s.state().points).toEqual([5, 5]);
    expect(s.state().deciding).toBe(true);
    expect(s.needs()).toBe('deciding');
    s.choose({ decidingSide: 'left' });
    expect(s.needs()).toBeNull();
    expect(s.state().side).toBe('left');
    expect(s.state().receiver).toBe(1);
    pts(s, 1); // the Star Point
    expect(s.state().games).toEqual([0, 1]);
    expect(s.state().deciding).toBe(false);
  });

  it('Star Point: winning the point after advantage 1 wins the game', () => {
    const s = new ScoreOracle(fmt({ mode: 'star' }));
    pts(s, 0, 1, 0, 1, 0, 1, 0, 0);
    expect(s.state().games).toEqual([1, 0]);
  });

  it('Star Point: winning the point after advantage 2 wins the game', () => {
    const s = new ScoreOracle(fmt({ mode: 'star' }));
    pts(s, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1);
    expect(s.state().games).toEqual([0, 1]);
  });

  it('Golden Point 2: at deuce the next point is the deciding point and wins the game', () => {
    const s = new ScoreOracle(fmt({ mode: 'golden' }));
    pts(s, 0, 1, 0, 1, 0, 1);
    expect(s.state().deciding).toBe(true);
    expect(s.needs()).toBe('deciding');
    pts(s, 0);
    expect(s.state().games).toEqual([1, 0]);
  });

  it('Golden Point 2: with no choice given the deciding point goes to the right box', () => {
    const s = new ScoreOracle(fmt({ mode: 'golden' }));
    pts(s, 0, 1, 0, 1, 0, 1);
    expect(s.state().side).toBe('right');
  });

  it('Golden Point 2 (doubles): the receiver is the player standing on the chosen side', () => {
    const s = new ScoreOracle(fmt({ mode: 'golden', doubles: true }));
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [1, 0] }); // team 1's slot 0 (player 1) receives right
    pts(s, 0, 1, 0, 1, 0, 1);
    expect(s.state().server).toBe(0);
    s.choose({ decidingSide: 'right' });
    expect(s.state().receiver).toBe(1);
    s.choose({ decidingSide: 'left' });
    expect(s.state().side).toBe('left');
    expect(s.state().receiver).toBe(3);
  });

  it('Golden Point: a deciding-side choice outside a deciding point is ignored', () => {
    const s = new ScoreOracle(fmt({ mode: 'golden' }));
    s.choose({ decidingSide: 'left' });
    expect(s.state().side).toBe('right');
  });

  it('6.5: the first point of a game is served to the right box, then alternately', () => {
    const s = new ScoreOracle(fmt());
    const sides: ServeSide[] = [];
    for (let i = 0; i < 4; i++) {
      sides.push(s.state().side);
      pts(s, 1);
    }
    expect(sides).toEqual(['right', 'left', 'right', 'left']);
    expect(s.state().side).toBe('right'); // the next game
    pts(s, 0, 1, 0, 1, 0, 1); // deuce: right again (Advantage)
    expect(s.state().side).toBe('right');
    pts(s, 0);
    expect(s.state().side).toBe('left');
  });
});

describe('ScoreOracle: a set and the match (rule 1)', () => {
  it('1.score.2: six games with a two-game margin win the set', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 1, 0, 1, 0, 1, 0, 0, 0);
    expect(s.state().history).toEqual([[6, 3]]);
    expect(s.state().sets).toEqual([1, 0]);
    expect(s.state().games).toEqual([0, 0]);
  });

  it('1.score.2: at 5-5 two more games are needed: 7-5', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0);
    expect(s.state().games).toEqual([6, 5]);
    expect(s.state().tiebreak).toBe(false);
    gamesTo(s, 0);
    expect(s.state().history).toEqual([[7, 5]]);
  });

  it('1.score.2: at 6-6 a tie-break is played', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    expect(s.state().games).toEqual([6, 6]);
    expect(s.state().tiebreak).toBe(true);
  });

  it('1.tie-break.2: first to 7 points with a margin of 2; 1.tie-break.4: the set is won 7-6', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    pts(s, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1); // 6-6
    pts(s, 0); // 7-6: not enough
    expect(s.state().tiebreak).toBe(true);
    expect(s.state().points).toEqual([7, 6]);
    pts(s, 1, 1); // 7-8
    expect(s.state().tiebreak).toBe(true);
    pts(s, 1); // 7-9
    expect(s.state().tiebreak).toBe(false);
    expect(s.state().history).toEqual([[6, 7]]);
    expect(s.state().sets).toEqual([0, 1]);
  });

  it('1.score.3: the match is the best of three sets; points after the end are ignored', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    expect(s.state().over).toBe(false);
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    const st = s.state();
    expect(st.over).toBe(true);
    expect(st.winner).toBe(0);
    expect(st.sets).toEqual([2, 0]);
    expect(st.history).toEqual([[6, 0], [6, 0]]);
    expect(s.needs()).toBeNull();
    pts(s, 1, 1, 1, 1);
    expect(s.state()).toEqual(st);
  });

  it('1.score.4: a final set without tie-break needs two clear games at 6-6', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'advantage' }));
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    holds(s, 12);
    expect(s.state().games).toEqual([6, 6]);
    expect(s.state().tiebreak).toBe(false);
    holds(s, 2); // 7-7
    expect(s.state().games).toEqual([7, 7]);
    gamesTo(s, 1, 1);
    expect(s.state().over).toBe(true);
    expect(s.state().winner).toBe(1);
    expect(s.state().history[2]).toEqual([7, 9]);
  });

  it('1.score.4: the first two sets still have their tie-break when the final set has none', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'advantage' }));
    holds(s, 12);
    expect(s.state().tiebreak).toBe(true);
  });

  it('1.score.2: a normal final set has a tie-break at 6-6', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    holds(s, 12);
    expect(s.state().tiebreak).toBe(true);
  });
});

describe('ScoreOracle: alternative formats (rule 1, alternative score methods)', () => {
  it('1.alt.a mini sets: four games with a margin of two win the set', () => {
    const s = new ScoreOracle(fmt({ gamesPerSet: 4 }));
    gamesTo(s, 0, 1, 0, 0, 0);
    expect(s.state().history).toEqual([[4, 1]]);
  });

  it('1.alt.a mini sets: 4-3 is not enough; 5-3 wins', () => {
    const s = new ScoreOracle(fmt({ gamesPerSet: 4 }));
    gamesTo(s, 0, 1, 0, 1, 0, 1, 0);
    expect(s.state().games).toEqual([4, 3]);
    gamesTo(s, 0);
    expect(s.state().history).toEqual([[5, 3]]);
  });

  it('1.alt.a mini sets: a tie-break at 4-4, set won 5-4', () => {
    const s = new ScoreOracle(fmt({ gamesPerSet: 4 }));
    holds(s, 8);
    expect(s.state().games).toEqual([4, 4]);
    expect(s.state().tiebreak).toBe(true);
    pts(s, 1, 1, 1, 1, 1, 1, 1);
    expect(s.state().history).toEqual([[4, 5]]);
  });

  it('1.alt.b: at one set all a tie-break to 7 replaces the final set', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'tiebreak7' }));
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    expect(s.state().tiebreak).toBe(true);
    expect(s.state().games).toEqual([0, 0]);
    pts(s, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1); // 6-6
    pts(s, 0); // 7-6: needs two clear
    expect(s.state().over).toBe(false);
    pts(s, 0);
    const st = s.state();
    expect(st.over).toBe(true);
    expect(st.winner).toBe(0);
    expect(st.sets).toEqual([2, 1]);
    expect(st.history).toEqual([[6, 0], [0, 6], [1, 0]]);
  });

  it('1.alt.c: the super tie-break to 10 replaces the final set, margin of 2', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'supertb10' }));
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    expect(s.state().tiebreak).toBe(true);
    for (let i = 0; i < 9; i++) pts(s, 0, 1); // 9-9
    pts(s, 1); // 9-10
    expect(s.state().over).toBe(false);
    pts(s, 1); // 9-11
    expect(s.state().over).toBe(true);
    expect(s.state().winner).toBe(1);
    expect(s.state().history[2]).toEqual([0, 1]);
  });

  it('1.alt.c: the super tie-break is not won at 7 points', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'supertb10' }));
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    pts(s, 0, 0, 0, 0, 0, 0, 0);
    expect(s.state().over).toBe(false);
    expect(s.state().points).toEqual([7, 0]);
    pts(s, 0, 0, 0);
    expect(s.state().over).toBe(true);
  });

  it('1.alt.c / 6.8: the super tie-break is a new set: each pair chooses its order (doubles)', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'supertb10', doubles: true }));
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [0, 0] });
    gamesTo(s, 0, 0, 0, 0, 0, 0);
    expect(s.needs()).toBe('setStart');
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [0, 0] });
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    expect(s.needs()).toBe('setStart');
    s.choose({ firstServerSlot: [1, 1], firstReceiverSlot: [1, 1] });
    // Sets of 6 games each (even): team 0 began set 1, set 2 and so the super tie-break.
    const st = s.state();
    expect(st.serverTeam).toBe(0);
    expect(st.server).toBe(2);
    expect(st.receiver).toBe(3);
    pts(s, 0);
    expect(s.state().server).toBe(3); // then team 1's first server, from the left
    expect(s.state().side).toBe('left');
    expect(s.state().receiver).toBe(0);
  });

  it('5.2: the super tie-break changes ends every 6 points', () => {
    const s = new ScoreOracle(fmt({ finalSet: 'supertb10' }));
    gamesTo(s, 0, 0, 0, 0, 0, 0); // 6 games: no change at the end
    gamesTo(s, 1, 1, 1, 1, 1, 1);
    const h0 = s.state().halves;
    pts(s, 0, 1, 0, 1, 0);
    expect(s.state().halves).toEqual(h0);
    pts(s, 1);
    expect(s.state().halves).toEqual([-h0[0], -h0[1]]);
  });
});

describe('ScoreOracle: changes of ends (rule 5)', () => {
  it('5.1: change after the 1st, 3rd and every odd game, not after the even ones', () => {
    const s = new ScoreOracle(fmt({ team0Half: 1 }));
    const seen: number[] = [s.state().halves[0]];
    for (let g = 0; g < 5; g++) {
      gamesTo(s, 0);
      seen.push(s.state().halves[0]);
    }
    expect(seen).toEqual([1, -1, -1, 1, 1, -1]);
    expect(s.state().halves[1]).toBe(1);
  });

  it('5.1: team0Half sets the starting ends', () => {
    const s = new ScoreOracle(fmt({ team0Half: -1 }));
    expect(s.state().halves).toEqual([-1, 1]);
  });

  it('5.1 between sets: a set of 9 games (odd) ends with a change', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 0, 1, 1, 1); // 5-3: 4 changes
    expect(s.state().halves).toEqual([1, -1]);
    gamesTo(s, 0); // 6-3, the 9th game
    expect(s.state().history).toEqual([[6, 3]]);
    expect(s.state().halves).toEqual([-1, 1]);
    gamesTo(s, 0);
    expect(s.state().halves).toEqual([1, -1]); // after the first game of the next set
  });

  it('5.1 between sets: a set of 10 games (even) ends without one; the next set changes after its first game', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 1, 1, 1, 1, 0); // 5-4: 5 changes
    expect(s.state().halves).toEqual([-1, 1]);
    gamesTo(s, 0); // 6-4, the 10th game
    expect(s.state().history).toEqual([[6, 4]]);
    expect(s.state().halves).toEqual([-1, 1]);
    gamesTo(s, 1);
    expect(s.state().halves).toEqual([1, -1]);
  });

  it('5.2: in the tie-break ends change after every 6 points', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    expect(s.state().halves).toEqual([1, -1]); // 6 changes in 12 games
    pts(s, 0, 1, 0, 1, 0);
    expect(s.state().halves).toEqual([1, -1]);
    pts(s, 1); // 6 points
    expect(s.state().halves).toEqual([-1, 1]);
    pts(s, 0, 1, 0, 1, 0, 1); // 12 points (6-6)
    expect(s.state().halves).toEqual([1, -1]);
  });

  it('5.1 / 5.2: the tie-break is the set\'s 13th game: ends change after it, but not twice at 12 points', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    pts(s, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1); // 5-5 (changed after 6)
    expect(s.state().halves).toEqual([-1, 1]);
    pts(s, 0, 0); // 7-5 on the 12th point: the set is over, one change for the 13th game
    expect(s.state().history).toEqual([[7, 6]]);
    expect(s.state().halves).toEqual([1, -1]);
  });
});

describe('ScoreOracle: order of service and receive (6.5, 6.8, 8.2-8.4, 1.tie-break)', () => {
  it('4 / 6: the pairs serve alternate games (singles)', () => {
    const s = new ScoreOracle(fmt({ firstServerTeam: 1 }));
    const servers: number[] = [];
    for (let g = 0; g < 4; g++) {
      servers.push(s.state().server);
      expect(s.state().receiver).toBe(1 - s.state().server);
      gamesTo(s, 0);
    }
    expect(servers).toEqual([1, 0, 1, 0]);
  });

  it('6.8: each pair picks its first server for the set; partners alternate their service games', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    expect(s.needs()).toBe('setStart');
    s.choose({ firstServerSlot: [1, 0], firstReceiverSlot: [0, 0] });
    expect(s.needs()).toBeNull();
    const servers: number[] = [];
    for (let g = 0; g < 6; g++) {
      servers.push(s.state().server);
      gamesTo(s, 0);
    }
    expect(servers).toEqual([2, 1, 0, 3, 2, 1]);
  });

  it('8.2-8.3: the first receiver takes the first point of every game; the pair alternates within the game', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [0, 1] });
    const r0: number[] = [];
    for (let p = 0; p < 4; p++) {
      r0.push(s.state().receiver);
      pts(s, 0);
    }
    expect(r0).toEqual([3, 1, 3, 1]); // team 1 receives, slot 1 (player 3) first
    const r1: number[] = [];
    for (let p = 0; p < 3; p++) {
      r1.push(s.state().receiver);
      pts(s, 1);
    }
    expect(r1).toEqual([0, 2, 0]); // team 0 receives, slot 0 first
    pts(s, 1);
    expect(s.state().receiver).toBe(3); // game 3: team 1's first receiver again
  });

  it('8.3: the order cannot be changed during the set (choose ignored once the set has started)', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [0, 0] });
    pts(s, 0);
    s.choose({ firstServerSlot: [1, 1], firstReceiverSlot: [1, 1] });
    expect(s.state().server).toBe(0);
    expect(s.state().receiver).toBe(3); // second point: slot 1 of team 1
  });

  it('6.8 / 8.2: the choices may be given one at a time before the set\'s first point', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    s.choose({ firstServerSlot: [1, 0] });
    s.choose({ firstReceiverSlot: [0, 1] });
    expect(s.state().server).toBe(2);
    expect(s.state().receiver).toBe(3);
  });

  it('6.8: with no choice given, slot 0 serves and receives first', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    expect(s.state().server).toBe(0);
    expect(s.state().receiver).toBe(1);
    pts(s, 0);
    expect(s.needs()).toBeNull(); // the set has started on the defaults
    expect(s.state().receiver).toBe(3);
  });

  it('6.8: singles has no slots, so no set-start choice', () => {
    const s = new ScoreOracle(fmt());
    expect(s.needs()).toBeNull();
  });

  it('4 / 6: the order of service runs on into the next set (6-4: the first server serves again)', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0);
    expect(s.state().server).toBe(0);
  });

  it('4 / 6: the order of service runs on into the next set (6-3: the other pair serves first)', () => {
    const s = new ScoreOracle(fmt());
    gamesTo(s, 0, 0, 0, 0, 0, 1, 1, 1, 0);
    expect(s.state().server).toBe(1);
  });

  it('1.tie-break.3 (singles): one point from the right, then two each, boxes alternating', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    const seq: string[] = [];
    for (let p = 0; p < 7; p++) {
      const st = s.state();
      seq.push(`${st.server}${st.side[0]}`);
      pts(s, p % 2);
    }
    expect(seq).toEqual(['0r', '1l', '1r', '0l', '0r', '1l', '1r']);
  });

  it('1.tie-break.3 (doubles): the order of the set carries on, two points each after the first', () => {
    const s = new ScoreOracle(fmt({ doubles: true }));
    s.choose({ firstServerSlot: [0, 0], firstReceiverSlot: [0, 0] });
    holds(s, 12);
    expect(s.state().tiebreak).toBe(true);
    const servers: number[] = [];
    const receivers: number[] = [];
    for (let p = 0; p < 9; p++) {
      servers.push(s.state().server);
      receivers.push(s.state().receiver);
      pts(s, p % 2);
    }
    expect(servers).toEqual([0, 1, 1, 2, 2, 3, 3, 0, 0]);
    // Receivers keep their boxes: right = the pair's first receiver (slot 0), left = the partner.
    expect(receivers).toEqual([1, 2, 0, 3, 1, 2, 0, 3, 1]);
  });

  it('1.tie-break.5: the next set is started by the pair that did not begin serving in the tie-break', () => {
    const s = new ScoreOracle(fmt());
    holds(s, 12);
    expect(s.state().server).toBe(0); // team 0 begins the tie-break
    pts(s, 1, 1, 1, 1, 1, 1, 1);
    expect(s.state().history).toEqual([[6, 7]]);
    expect(s.state().server).toBe(1);
  });

  it('doubles rotation over two sets incl. a tie-break set (6.8, 8.2, 1.tie-break.3/5, 5.1/5.2)', () => {
    const s = new ScoreOracle(fmt({ doubles: true, firstServerTeam: 1 }));
    expect(s.needs()).toBe('setStart');
    s.choose({ firstServerSlot: [1, 0], firstReceiverSlot: [0, 1] });
    const servers: number[] = [];
    const firstReceivers: number[] = [];
    for (let g = 0; g < 12; g++) {
      servers.push(s.state().server);
      firstReceivers.push(s.state().receiver);
      gamesTo(s, s.state().serverTeam);
    }
    expect(servers).toEqual([1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0]);
    expect(firstReceivers).toEqual([0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3]);
    expect(s.state().halves).toEqual([1, -1]);
    expect(s.state().tiebreak).toBe(true);
    const tb: string[] = [];
    for (let p = 0; p < 7; p++) {
      const st = s.state();
      tb.push(`${st.server}>${st.receiver}${st.side[0]}`);
      pts(s, 0);
      if (p === 5) expect(s.state().halves).toEqual([-1, 1]); // 6 points
    }
    expect(tb).toEqual(['1>0r', '2>1l', '2>3r', '3>2l', '3>0r', '0>1l', '0>3r']);
    expect(s.state().history).toEqual([[7, 6]]);
    expect(s.state().halves).toEqual([1, -1]); // the 13th game is odd
    // Set 2: team 1 began the tie-break, so team 0 begins; new choices.
    expect(s.needs()).toBe('setStart');
    s.choose({ firstServerSlot: [0, 1], firstReceiverSlot: [1, 0] });
    expect(s.state().serverTeam).toBe(0);
    expect(s.state().server).toBe(0);
    expect(s.state().receiver).toBe(1);
    gamesTo(s, 1);
    expect(s.state().halves).toEqual([-1, 1]);
    expect(s.state().server).toBe(3);
    expect(s.state().receiver).toBe(2);
    gamesTo(s, 1);
    expect(s.state().server).toBe(2);
    expect(s.state().games).toEqual([0, 2]);
    expect(s.state().sets).toEqual([1, 0]);
  });
});
