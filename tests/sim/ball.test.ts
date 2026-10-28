import { describe, expect, it } from 'vitest';
import { Ball, HIT_FLOOR, HIT_WALL, HIT_NET, HIT_NETCORD, LEFT_COURT, type BallWorld } from '../../src/sim/ball/ball.ts';
import { makeWorld } from '../../src/sim/setup.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { SURF_GLASS, SURF_MESH } from '../../src/sim/court/court.ts';

interface Run { maxYAfterFirstBounce: number; events: Array<{ kind: number; surface: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }>; ball: Ball }

/** Step a ball until `until` returns true or maxT elapses; record contacts with the velocity just after. */
function run(world: BallWorld, ball: Ball, maxT: number, rng: Rng | null = null, until?: (b: Ball, n: number) => boolean): Run {
  const out: Run = { maxYAfterFirstBounce: 0, events: [], ball };
  let bounced = false;
  for (let t = 0; t < maxT; t += DT) {
    ball.step(world, DT, rng);
    for (let i = 0; i < ball.eventCount; i++) {
      const e = ball.events[i]!;
      out.events.push({ kind: e.kind, surface: e.surface, x: e.x, y: e.y, z: e.z, vx: ball.vel.x, vy: ball.vel.y, vz: ball.vel.z });
      if (e.kind === HIT_FLOOR) bounced = true;
    }
    if (bounced) out.maxYAfterFirstBounce = Math.max(out.maxYAfterFirstBounce, ball.pos.y);
    if (until?.(ball, out.events.length)) break;
  }
  return out;
}

function dropTest(world: BallWorld, wear = 0, rng: Rng | null = null): number {
  const b = new Ball();
  if (wear > 0) {
    // Wear it as a match would: impacts of 15 m/s (each counts 1).
    b.wears = true;
    b.wearV = 15;
    for (let i = 0; i < wear; i++) b.wearImpact(world);
    b.wears = false;
  }
  b.pos.set(0, 2.54 + world.spec.radius, 3); // bottom of the ball at 2.54 m
  const r = run(world, b, 3, rng, (_b, n) => n >= 2);
  // FIP measures the bounce to the bottom of the ball.
  return r.maxYAfterFirstBounce - world.spec.radius;
}

describe('FIP drop test (2.54 m onto a hard surface)', () => {
  it('standard ball bounces 135-145 cm', () => {
    const h = dropTest(makeWorld({ floor: 'hard' }));
    expect(h).toBeGreaterThan(1.35);
    expect(h).toBeLessThan(1.45);
  });
  it('altitude ball bounces 122-135 cm (tested at sea level, as the rule specifies)', () => {
    const h = dropTest(makeWorld({ floor: 'hard', ball: 'altitude' }));
    expect(h).toBeGreaterThan(1.22);
    expect(h).toBeLessThan(1.35);
  });
  it('sand-filled turf bounces almost like a hard floor: 80-101% of its drop rebound (UNE 41958 IN; Hamilton 2000)', () => {
    const hard = dropTest(makeWorld({ floor: 'hard' }));
    const turf = makeWorld({ floor: 'turf' });
    const rng = new Rng(7);
    let sum = 0;
    for (let k = 0; k < 60; k++) sum += dropTest(turf, 0, rng);
    const ratio = sum / 60 / hard;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.01);
    // and a little lower on average than hard: the sand takes some of it.
    expect(ratio).toBeLessThan(0.995);
    expect(dropTest(makeWorld({ floor: 'clay' }))).toBeLessThan(hard);
  });
});

describe('ball wear over a match', () => {
  it('the nap fluffs up: about 4% more drag by the end of the first set (Hawk-Eye: used 0.603 vs new 0.579)', () => {
    const w = makeWorld();
    const b = new Ball();
    b.wears = true;
    b.wearV = 15;
    for (let i = 0; i < 60 * 15; i++) b.wearImpact(w);
    expect(b.dragScale).toBeGreaterThan(1.035);
    expect(b.dragScale).toBeLessThan(1.045);
  });

  it('after 666 strokes a ball grips 2-11% more and bounces 0.7-4.9% higher (IBV for Testfakta 2023, 10 balls)', () => {
    const w = makeWorld({ floor: 'hard' });
    const fresh = dropTest(w);
    const used = dropTest(w, 666);
    expect(used / fresh - 1).toBeGreaterThan(0.007);
    expect(used / fresh - 1).toBeLessThan(0.049);
    const b = new Ball();
    b.wears = true;
    b.wearV = 15;
    for (let i = 0; i < 666; i++) b.wearImpact(w);
    expect(b.muScale - 1).toBeGreaterThan(0.02);
    expect(b.muScale - 1).toBeLessThan(0.11);
    // and stays a ball within FIP's durability limit (drop test within 4 cm after 9 simulated games) all match.
    expect(dropTest(w, 150 * 15) - fresh).toBeLessThan(0.04);
  });

  it('only the match ball wears; predictions copy its state', () => {
    const w = makeWorld();
    const b = new Ball();
    b.wearV = 20;
    b.wearImpact(w);
    expect(b.wear).toBe(0);
    b.wears = true;
    b.wearImpact(w);
    const g = new Ball().copyFrom(b);
    expect(g.wear).toBe(b.wear);
    expect(g.dragScale).toBe(b.dragScale);
    expect(g.muScale).toBe(b.muScale);
    expect(g.wears).toBe(false);
  });
});

describe('flight', () => {
  it('drag of a new ball is the free-flight value, C_D 0.507 (Cross & Lindsey)', () => {
    const w = makeWorld();
    const b = new Ball();
    b.pos.set(0, 5, 9);
    b.vel.set(0, 0, -25);
    b.step(w, DT, null, true);
    // Deceleration along the path (gravity is across it at the start): a = rho C_D A v^2 / 2m.
    const v = (25 + -b.vel.z) / 2;
    const a = (25 - -b.vel.z) / DT;
    const cd = (2 * w.spec.mass * a) / (w.rho * Math.PI * w.spec.radius ** 2 * v * v);
    expect(cd).toBeGreaterThan(0.5);
    expect(cd).toBeLessThan(0.515);
  });

  it('spin decays with distance flown, about 0.5% a metre, so a slow ball keeps it longer per second', () => {
    const w = makeWorld();
    const loss = (speed: number, secs: number) => {
      const b = new Ball();
      b.pos.set(0, 30, 0);
      b.vel.set(0, 0, -speed);
      b.spin.set(-300, 0, 0);
      let dist = 0;
      for (let t = 0; t < secs; t += DT) {
        const z0 = b.pos.z;
        const y0 = b.pos.y;
        b.step(w, DT, null, true);
        dist += Math.hypot(b.pos.z - z0, b.pos.y - y0);
      }
      return { perM: (1 - Math.abs(b.spin.x) / 300) / dist, perS: 1 - Math.abs(b.spin.x) / 300 };
    };
    const fast = loss(25, 0.6);
    const slow = loss(6, 0.6);
    expect(fast.perM).toBeGreaterThan(0.004);
    expect(fast.perM).toBeLessThan(0.0055);
    expect(slow.perS).toBeLessThan(fast.perS * 0.6);
  });


  it('a ball flies further in thin air at altitude', () => {
    const range = (alt: number): number => {
      const w = makeWorld({ env: { altitudeM: alt } });
      const b = new Ball();
      b.pos.set(0, 1, 9);
      b.vel.set(0, 3, -20);
      const r = run(w, b, 3, null, (_b, n) => n >= 1);
      return 9 - r.events[0]!.z;
    };
    expect(range(2500)).toBeGreaterThan(range(0) * 1.03);
  });
  it('topspin dips and backspin floats (Magnus)', () => {
    const land = (wx: number): number => {
      const w = makeWorld();
      const b = new Ball();
      b.pos.set(0, 1, 9);
      b.vel.set(0, 4, -18);
      b.spin.set(wx, 0, 0);
      return run(w, b, 3, null, (_b, n) => n >= 1).events[0]!.z;
    };
    // Travelling -z, topspin is rotation about -x... top of ball moves -z: w = (-w, 0, 0).
    const flat = land(0);
    expect(land(-200)).toBeGreaterThan(flat); // topspin lands shorter (less negative z)
    expect(land(200)).toBeLessThan(flat); // backspin carries further
  });
});

describe('bounces', () => {
  const afterFloor = (wx: number): { vz: number; vy: number } => {
    const w = makeWorld({ floor: 'turf' });
    const b = new Ball();
    b.pos.set(0, 0.6, 2);
    b.vel.set(0, -5, -15);
    b.spin.set(wx, 0, 0);
    const e = run(w, b, 1, null, (_b, n) => n >= 1).events[0]!;
    return { vz: -e.vz, vy: e.vy };
  };

  it('oblique bounces follow the grip-slip regimes of a felt ball (Cross, Physics Today 2008)', () => {
    // Below about 20 degrees the ball slides all through the bounce (tangential COR negative); above it the
    // ball grips, keeps a fixed fraction of its horizontal speed, and leaves with e_x +0.1 to +0.3 (sand-filled
    // turf a little below). The spin it picks up peaks at the change and falls at steeper angles.
    for (const floor of ['hard', 'turf'] as const) {
      const w = makeWorld({ floor });
      const r = w.spec.radius;
      const res: Array<{ ex: number; fx: number; rpm: number }> = [];
      for (const deg of [10, 25, 40, 60]) {
        const a = (deg * Math.PI) / 180;
        const b = new Ball();
        b.pos.set(0, r + 0.0005, 3);
        b.vel.set(0, -20 * Math.sin(a), -20 * Math.cos(a));
        const e = run(w, b, 0.05, null, (_b, n) => n >= 1).events[0]!;
        const vx0 = 20 * Math.cos(a);
        const vx = -e.vz;
        res.push({ ex: -(vx - -b.spin.x * r) / vx0, fx: vx / vx0, rpm: (-b.spin.x * 60) / (2 * Math.PI) });
      }
      expect(res[0]!.ex).toBeLessThan(0);
      for (const k of [1, 2, 3]) {
        expect(res[k]!.ex).toBeGreaterThan(0.05);
        expect(res[k]!.ex).toBeLessThan(0.3);
        expect(Math.abs(res[k]!.fx - res[1]!.fx)).toBeLessThan(0.02);
      }
      expect(res[1]!.rpm).toBeGreaterThan(res[2]!.rpm);
      expect(res[2]!.rpm).toBeGreaterThan(res[3]!.rpm);
    }
  });

  it('topspin kicks forward, slice skids and stays low', () => {
    const top = afterFloor(-250);
    const flat = afterFloor(0);
    const slice = afterFloor(250);
    expect(top.vz).toBeGreaterThan(flat.vz);
    expect(flat.vz).toBeGreaterThan(slice.vz);
    expect(slice.vy).toBeLessThan(top.vy);
  });

  it('never gains energy on any surface', () => {
    const rng = new Rng(7);
    for (const floor of ['hard', 'turf', 'carpet', 'clay'] as const) {
      const w = makeWorld({ floor });
      for (let i = 0; i < 200; i++) {
        const b = new Ball();
        b.pos.set(rng.range(-4, 4), rng.range(0.3, 2.5), rng.range(-8, 8));
        b.vel.set(rng.range(-15, 15), rng.range(-12, 6), rng.range(-25, 25));
        b.spin.set(rng.range(-300, 300), rng.range(-150, 150), rng.range(-300, 300));
        const m = w.spec.mass;
        const I = w.inertia;
        for (let t = 0; t < 2; t += DT) {
          const ke0 = 0.5 * m * b.vel.lengthSq() + 0.5 * I * b.spin.lengthSq() + m * 9.81 * b.pos.y;
          const caught = b.inNet;
          b.step(w, DT, rng);
          const ke1 = 0.5 * m * b.vel.lengthSq() + 0.5 * I * b.spin.lengthSq() + m * 9.81 * b.pos.y;
          // (In the net the ball gets back what the netting stored; that is not the bounce's doing.)
          if (b.eventCount > 0 && b.events[0]!.kind !== LEFT_COURT && !caught && !b.inNet) {
            expect(ke1).toBeLessThanOrEqual(ke0 * 1.001 + 1e-4);
          }
        }
      }
    }
  });

  it('slice dies off the back glass; topspin jumps off it', () => {
    const offGlass = (wx: number): number => {
      const w = makeWorld();
      const b = new Ball();
      b.pos.set(0, 1.2, -7);
      b.vel.set(0, 0, -16);
      b.spin.set(wx, 0, 0);
      const r = run(w, b, 1, null, (_b, n) => n >= 1);
      const e = r.events[0]!;
      expect(e.kind).toBe(HIT_WALL);
      expect(e.surface).toBe(SURF_GLASS);
      return e.vy;
    };
    expect(offGlass(250)).toBeLessThan(offGlass(0)); // slice: pushed down
    expect(offGlass(-250)).toBeGreaterThan(offGlass(0)); // topspin: kicks up
  });

  it('side spin kicks along the side glass', () => {
    const kick = (wy: number): number => {
      const w = makeWorld();
      const b = new Ball();
      b.pos.set(3.5, 1.2, -8.5);
      b.vel.set(12, 0, 0);
      b.spin.set(0, wy, 0);
      const e = run(w, b, 1, null, (_b, n) => n >= 1).events[0]!;
      expect(e.kind).toBe(HIT_WALL);
      return e.vz;
    };
    expect(kick(200)).not.toBeCloseTo(kick(-200), 1);
    expect(Math.abs(kick(200) - kick(0))).toBeGreaterThan(0.5);
  });

  it('mesh rebounds lower than glass and scatters', () => {
    const rng = new Rng(3);
    const w = makeWorld();
    const speeds: number[] = [];
    const angles: number[] = [];
    for (let i = 0; i < 300; i++) {
      const b = new Ball();
      b.pos.set(3, 1.0, 0.0 + 3.5);
      b.vel.set(15, 0, 0);
      const e = run(w, b, 1, rng, (_b, n) => n >= 1).events[0]!;
      expect(e.surface).toBe(SURF_MESH);
      speeds.push(Math.hypot(e.vx, e.vy, e.vz));
      angles.push(Math.atan2(e.vz, -e.vx));
    }
    const mean = speeds.reduce((a, b) => a + b) / speeds.length;
    const b = new Ball();
    b.pos.set(3, 1.0, 9.0);
    b.vel.set(15, 0, 0);
    const glass = run(w, b, 1, null, (_b, n) => n >= 1).events[0]!;
    expect(glass.surface).toBe(SURF_GLASS);
    expect(mean).toBeLessThan(Math.hypot(glass.vx, glass.vy, glass.vz) * 0.75);
    const sd = Math.sqrt(angles.reduce((a, v) => a + v * v, 0) / angles.length);
    expect(sd).toBeGreaterThan(0.05);
  });
});

describe('no tunnelling', () => {
  it('a 45 m/s ball never passes through glass, mesh or the net', () => {
    const w = makeWorld();
    const rng = new Rng(11);
    for (let i = 0; i < 500; i++) {
      const b = new Ball();
      b.pos.set(rng.range(-4, 4), rng.range(0.2, 2.5), rng.range(-9, 9));
      const ang = rng.range(0, Math.PI * 2);
      b.vel.set(Math.cos(ang) * 45, rng.range(-3, 3), Math.sin(ang) * 45);
      for (let t = 0; t < 0.5; t += DT) {
        const zBefore = b.pos.z;
        const yBefore = b.pos.y;
        const caught = b.inNet;
        b.step(w, DT, rng);
        let netHit = false;
        for (let k = 0; k < b.eventCount; k++) {
          const kind = b.events[k]!.kind;
          if (kind === HIT_NET || kind === HIT_NETCORD) netHit = true;
        }
        // A ball caught in the net bulges it past the line, but never far, and always comes back out.
        if (caught || b.inNet) expect(Math.abs(b.pos.z)).toBeLessThan(0.7);
        // Crossing the net plane below the tape without a net contact would be tunnelling.
        if (!b.outside && Math.sign(zBefore) !== Math.sign(b.pos.z) && !netHit && !caught && !b.inNet && Math.abs(b.pos.x) < 5) {
          const h = w.court.netHeightAt(b.pos.x);
          expect(Math.min(yBefore, b.pos.y)).toBeGreaterThan(h - 0.2);
        }
        if (!b.outside) {
          // Inside the enclosure the ball centre never goes past a wall it should have hit.
          expect(Math.abs(b.pos.z)).toBeLessThan(10.2);
        }
      }
    }
  });
});

describe('rolling', () => {
  it('a rolling ball slows at its floor\'s rollDecel (data/surfaces.json), the same 0.8 m/s per second on each until measured', () => {
    for (const floor of ['hard', 'turf', 'carpet', 'clay'] as const) {
      const w = makeWorld({ floor });
      expect(w.rollDecel).toBe(0.8);
      const b = new Ball();
      b.pos.set(0, w.spec.radius, 3);
      b.vel.set(0, 0, -3);
      b.rolling = true;
      for (let t = 0; t < 1 - 1e-9; t += DT) b.step(w, DT, null);
      expect(Math.hypot(b.vel.x, b.vel.z)).toBeCloseTo(3 - 0.8, 2);
    }
  });
});
