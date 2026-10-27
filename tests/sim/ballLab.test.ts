// The ball lab's tuned numbers (Phase 1 of the realism brief): every bounce checked against published data where
// there is some, and the qualitative behaviour players know where there isn't. Sources: data/surfaces.json and
// data/ball.json `//`, docs/realism.md, DECISIONS.md (Phase 1). Changing a surface means changing these on purpose.
import { describe, expect, it } from 'vitest';
import { labShots, runLab, runShot, keyContact, type LabShot, type ShotSummary } from '../../src/sim/lab/ballLab.ts';
import { makeWorld } from '../../src/sim/setup.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { Ball, HIT_FLOOR, HIT_WALL, LEFT_COURT } from '../../src/sim/ball/ball.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SURF_MESH } from '../../src/sim/court/court.ts';
import { MatchSim } from '../../src/sim/match.ts';

const lab = new Map<string, ShotSummary>();
for (const s of runLab()) lab.set(s.shot.id, s);
const get = (id: string): ShotSummary => {
  const s = lab.get(id);
  if (!s) throw new Error(`no lab shot ${id}`);
  return s;
};

describe('ball lab: floor', () => {
  it('FIP drop test on hard: 135-145 cm (we sit mid-range)', () => {
    const h = (get('drop-hard').run.apexAfter - 0.0328) * 100;
    expect(h).toBeGreaterThan(138);
    expect(h).toBeLessThan(143);
  });

  it('court pace on turf at 70 km/h: friction 0.56-0.62 and CPR 36-50, as padel balls on padel turf (IBV/Testfakta 2023, 10 balls; 16° assumed)', () => {
    // At 16° the ball slides through the whole contact, so friction comes out as put in: only the restitution
    // half of CPR is an independent check.
    const itf = get('cpr-turf').itf!;
    expect(itf.mu).toBeGreaterThan(0.56);
    expect(itf.mu).toBeLessThan(0.62);
    expect(itf.cpr).toBeGreaterThan(36);
    expect(itf.cpr).toBeLessThan(50);
  });

  it('below ~20° a flat ball slides through the bounce and keeps a fixed share of its pace; steeper it grips (Cross 2008)', () => {
    const k10 = keyContact(get('floor-10').shot, get('floor-10').run)!;
    const k35 = keyContact(get('floor-35').shot, get('floor-35').run)!;
    expect(k10.tKept).toBeGreaterThan(k35.tKept);
    expect(k35.ex).toBeGreaterThan(0);
    expect(k10.ex).toBeLessThan(0);
  });

  it('the sand scatters a flat drive by a degree or two, never wildly', () => {
    const st = get('land-turf-random').stats!;
    expect(st.deflect[0]).toBeGreaterThan(0.5);
    expect(st.deflect[0]).toBeLessThan(3);
  });

  it('...sideways: the height a drive bounces to stays within a few per cent (the line wanders, the height is true)', () => {
    const w = makeWorld({ floor: 'turf' });
    const rng = new Rng(77);
    const deg = Math.PI / 180;
    const shot: LabShot = { id: 'h', group: 'floor', label: '', pos: [0, 0.0328 + 0.1, 4 - 0.1 / Math.tan(12 * deg)], vel: [0, -20 * Math.sin(12 * deg), 20 * Math.cos(12 * deg)], spin: [0, 0, 0], contacts: 2, secs: 1 };
    const h: number[] = [];
    for (let i = 0; i < 600; i++) h.push(runShot(shot, w, rng).apexAfter);
    const m = h.reduce((a, b) => a + b, 0) / h.length;
    const sd = Math.sqrt(h.reduce((a, b) => a + (b - m) ** 2, 0) / h.length);
    expect(sd / m).toBeLessThan(0.08);
  });
});

describe('ball lab: glass', () => {
  it('restitution falls with impact speed like a pressurised ball on a rigid wall (0.80 at 3 m/s to 0.60 at 20 m/s, Dignall 2004)', () => {
    const e = (v: number): number => get(`glass-cor-${v}`).run.contacts[0]!.en;
    expect(e(3)).toBeGreaterThan(0.77);
    expect(e(3)).toBeLessThan(0.83);
    expect(e(20)).toBeGreaterThan(0.57);
    expect(e(20)).toBeLessThan(0.65);
    expect(e(30)).toBeLessThan(e(20));
  });

  it('is nearly as lively as a rigid floor: 98-99% of its restitution (12 mm panel impedance)', () => {
    const glass = get('glass-cor-7').run.contacts[0]!.en;
    const hard = makeWorld({ floor: 'hard' });
    const run = runShot({ id: 'x', group: 'floor', label: '', pos: [0, 0.2, 3], vel: [0, -7, 0], spin: [0, 0, 0], contacts: 1, secs: 0.3 }, hard, null);
    const ratio = glass / run.contacts[0]!.en;
    expect(ratio).toBeGreaterThan(0.975);
    expect(ratio).toBeLessThan(0.995);
  });

  it('court pace against the glass: SPR about 65, felt on smooth glazed tile (ITF test, Dignall 2004)', () => {
    const itf = get('spr-glass').itf!;
    expect(itf.spr).toBeGreaterThan(62);
    expect(itf.spr).toBeLessThan(68);
  });

  it('topspin climbs the glass, a slice dies off it, flat in between', () => {
    const top = get('glass-top').glass!;
    const flat = get('glass-flat').glass!;
    const slice = get('glass-slice').glass!;
    expect(top.apexAfterGlass).toBeGreaterThan(flat.apexAfterGlass);
    expect(flat.apexAfterGlass).toBeGreaterThan(slice.apexAfterGlass);
    expect(slice.apexAfterGlass).toBeLessThan(0.5);
    expect(slice.comesBack).toBeLessThan(3);
    // A topspin drive comes off at chest height a metre out: the defender's ball.
    expect(top.heightAt1m).toBeGreaterThan(1.1);
    expect(top.heightAt1m).toBeLessThan(1.7);
  });

  it('a big smash bounced near the glass climbs out of reach (por tres territory)', () => {
    const sm = get('glass-smash').glass!;
    expect(sm.apexAfterGlass).toBeGreaterThan(4);
    expect(sm.apexAfterGlass).toBeLessThan(9);
  });

  it('how far and how high balls come back off the back glass stays where it is tuned (model values, not data)', () => {
    // [comes back (m), apex after the glass (m), height 1 m out (m)], each within a band around today's numbers:
    // a change to the bounce that moves these is a change to how wall play feels, and must be meant.
    const want: Record<string, [number, number, number, number, number, number]> = {
      'glass-flat': [6.5, 9.5, 0.9, 1.5, 0.6, 1.0],
      'glass-top': [9.5, 13.5, 2.3, 3.3, 1.1, 1.7],
      'glass-slice': [1.5, 3.2, 0.2, 0.5, 0.15, 0.45],
      'glass-lob': [3.5, 5.8, 2.4, 3.4, 2.1, 3.1],
      'corner-back-side': [4.0, 6.2, 0.6, 1.0, 0.45, 0.8],
    };
    for (const [id, [b0, b1, a0, a1, h0, h1]] of Object.entries(want)) {
      const g = get(id).glass!;
      expect(g.comesBack, id).toBeGreaterThan(b0);
      expect(g.comesBack, id).toBeLessThan(b1);
      expect(g.apexAfterGlass, id).toBeGreaterThan(a0);
      expect(g.apexAfterGlass, id).toBeLessThan(a1);
      expect(g.heightAt1m, id).toBeGreaterThan(h0);
      expect(g.heightAt1m, id).toBeLessThan(h1);
    }
  });

  it('sidespin kicks along the side glass one way and checks up the other', () => {
    const into = get('side-vibora-in').run.contacts[1]!;
    const out = get('side-vibora-out').run.contacts[1]!;
    const none = get('side-cross').run.contacts[1]!;
    expect(into.tKept).toBeGreaterThan(none.tKept);
    expect(out.tKept).toBeLessThan(none.tKept);
  });
});

describe('ball lab: joins, frames and mesh', () => {
  it('a flush join between glass panels bounces almost like plain glass (FIP: joins flush, rebound uniform)', () => {
    for (const id of ['join-back-seam', 'join-side-step']) {
      const st = get(id).stats!;
      expect(st.deflect[0]).toBeLessThan(5);
      expect(st.en[0]).toBeGreaterThan(0.5);
    }
  });

  it('frames (the glass top under the mesh frame, the glass end against the mesh) are irregular', () => {
    for (const id of ['join-glass-mesh', 'join-side-edge']) {
      const st = get(id).stats!;
      expect(st.deflect[0]).toBeGreaterThan(10);
      expect(st.deflect[1]).toBeGreaterThan(5);
    }
  });

  it('mesh is dead and irregular next to glass (FIP and NIDE: irregular rebound; no measured numbers exist)', () => {
    const glass = get('glass-cor-20').run.contacts[0]!.en;
    for (const id of ['mesh-side', 'mesh-back']) {
      const st = get(id).stats!;
      expect(st.en[0]).toBeLessThan(glass * 0.65);
      expect(st.deflect[0]).toBeGreaterThan(8);
    }
  });
});

describe('ball lab: energy', () => {
  it('no contact in any lab shot, random runs included, gains energy (translation plus spin)', () => {
    const worlds = new Map<string, ReturnType<typeof makeWorld>>();
    const rng = new Rng(500);
    let n = 0;
    for (const shot of labShots()) {
      const key = shot.floor ?? 'turf';
      let w = worlds.get(key);
      if (!w) { w = makeWorld({ floor: key }); worlds.set(key, w); }
      const runs = Math.min(40, shot.runs ?? 1);
      for (let k = 0; k < runs; k++) {
        for (const c of runShot(shot, w, runs > 1 ? rng : null).contacts) {
          // Gravity over the 1/1200 s either side of the contact is the only allowed gain.
          expect(c.energyOut).toBeLessThanOrEqual(c.energyIn + 0.02);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(300);
  });
});

describe('ball lab: junctions, edges and rolling', () => {
  const deg = Math.PI / 180;
  const r = 0.0328;
  const turf = makeWorld({ floor: 'turf' });

  /** 20 m/s at 30° into the foot of the back glass, `mm` later than landing exactly in the junction. */
  const rincon = (mm: number) => {
    const a = 30 * deg;
    const run = runShot({ id: 'j', group: 'corner', label: '', pos: [0.5, r + 0.1, 10 - r - 0.1 / Math.tan(a) + mm / 1000], vel: [0, -20 * Math.sin(a), 20 * Math.cos(a)], spin: [0, 0, 0], contacts: 4, secs: 3 }, turf, null);
    return run;
  };

  it('the foot of the glass is one squeeze, not two bounces in an order a millimetre decides', () => {
    // Before: 4 mm either side flipped the ball between 4.1 m high landing past the net and 1.1 m landing 8 m out.
    let prev = rincon(-8).apexAfter;
    for (let mm = -7.5; mm <= 8; mm += 0.5) {
      const ap = rincon(mm).apexAfter;
      expect(Math.abs(ap - prev)).toBeLessThan(0.05);
      prev = ap;
    }
    // And on into plain floor-then-glass and glass-then-floor, without a jump at the edge of the contact time.
    prev = rincon(-140).apexAfter;
    for (let mm = -130; mm <= 140; mm += 10) {
      const ap = rincon(mm).apexAfter;
      expect(Math.abs(ap - prev)).toBeLessThan(0.45);
      prev = ap;
    }
    // In the nick it comes out low (squash's nick is dead; a padel ball in the rincón comes out low).
    expect(rincon(0).apexAfter).toBeLessThan(2);
  });

  it('...and its path, not just its height, is continuous where the junction gives way to two bounces', () => {
    // Where the ball is 0.25 s after it lands: the second bounce lands when the ball really reaches the glass.
    const at = (mm: number): number[] => {
      const a = 30 * deg;
      const b = new Ball();
      b.pos.set(0.5, r + 0.1, 10 - r - 0.1 / Math.tan(a) + mm / 1000);
      b.vel.set(0, -20 * Math.sin(a), 20 * Math.cos(a));
      let t0 = -1;
      for (let k = 0; k < 240; k++) {
        b.step(turf, DT, null);
        if (t0 < 0 && b.eventCount > 0) t0 = k;
        if (t0 >= 0 && k - t0 >= 30) break;
      }
      return [b.pos.x, b.pos.y, b.pos.z];
    };
    // Before: 11.5 cm between two offsets 0.1 mm apart at the window's far edge (about 70 mm).
    let prev = at(40);
    for (let mm = 40.1; mm <= 110; mm += 0.1) {
      const p = at(mm);
      expect(Math.hypot(p[0]! - prev[0]!, p[1]! - prev[1]!, p[2]! - prev[2]!)).toBeLessThan(0.04);
      prev = p;
    }
  });

  it('a ball drifting into the glass as it lands barely feels it (the nick takes energy by the share of the squeeze)', () => {
    const hard = makeWorld({ floor: 'hard' });
    const apex = (vz: number): number => {
      const b = new Ball();
      const tFall = Math.sqrt((2 * 1.5) / 9.81);
      b.pos.set(0.5, r + 1.5, 10 - r - 0.002 - vz * tFall);
      b.vel.set(0, 0, vz);
      let top = 0, after = false;
      for (let k = 0; k < 240; k++) {
        b.step(hard, DT, null);
        if (b.eventCount > 0) after = true;
        if (after) top = Math.max(top, b.pos.y);
        if (after && b.vel.y < 0 && top > 0.2) break;
      }
      return top;
    };
    // Before: 0.926 m with no drift, 0.474 m with 0.1 mm/s.
    const still = apex(0);
    expect(Math.abs(apex(1e-4) - still)).toBeLessThan(0.01);
    expect(Math.abs(apex(0.05) - still)).toBeLessThan(0.03);
    // Driven in harder, the squeeze takes more.
    expect(apex(1)).toBeLessThan(apex(0.3));
  });

  it('the second surface of a junction is what is there at the foot of the wall (mesh, not the glass above it)', () => {
    // Beside the side mesh (|z| 1.1-6 m on the standard court) a ball coming down meets mesh.
    const b = new Ball();
    b.pos.set(4.9622, 0.1, 2.9);
    b.vel.set(0.3, -6, 3);
    let wall = -1;
    for (let k = 0; k < 10 && wall < 0; k++) {
      b.step(turf, DT, null);
      for (let e = 0; e < b.eventCount; e++) if (b.events[e]!.kind === HIT_WALL) wall = b.events[e]!.surface;
    }
    expect(wall).toBe(SURF_MESH);
  });

  it('starting to roll trades speed for spin (no energy appears from nowhere)', () => {
    const b = new Ball();
    b.pos.set(3.2478, 0.0361, -9.5198);
    b.vel.set(1.643, -0.041, -14.029);
    b.spin.set(47.6, 33.2, 85.1);
    const I = turf.inertia / turf.spec.mass;
    const E = (): number => 0.5 * b.vel.lengthSq() + 0.5 * I * b.spin.lengthSq() + 9.81 * b.pos.y;
    const e0 = E();
    for (let k = 0; k < 3; k++) b.step(turf, DT, null);
    expect(b.rolling).toBe(true);
    expect(E()).toBeLessThan(e0);
  });

  it('a ball caught in the rigid net (predictions) stops at the post, it never slides through it out of the court', () => {
    const b = new Ball();
    b.pos.set(4.2815, 0.0446, -0.3);
    b.vel.set(15.201, 1.159, 6.599);
    for (let k = 0; k < 240; k++) {
      b.step(turf, DT, null);
      expect(Math.abs(b.pos.x)).toBeLessThan(5);
    }
  });

  it('a ball in the nick lands first for the rules (FIP: good in the corner where wall meets floor)', () => {
    const c = rincon(2).contacts;
    expect(c[0]!.kind).toBe(HIT_FLOOR);
    expect(c[1]!.kind).toBe(HIT_WALL);
    expect(c[1]!.t - c[0]!.t).toBeLessThan(1e-6);
  });

  it('a corner taken square comes out square, and a fraction of a millimetre does not swing it', () => {
    const exitDir = (d: number): number => {
      const v = 14 / Math.SQRT2;
      const b = new Ball();
      b.pos.set(5 - r - 0.3 + d / 1000, 1.0, 10 - r - 0.3);
      b.vel.set(v, 0, v);
      for (let i = 0; i < 12; i++) b.step(turf, DT, null);
      return (Math.atan2(b.vel.x, b.vel.z) * 180) / Math.PI;
    };
    expect(Math.abs(exitDir(0) - -135)).toBeLessThan(2);
    expect(Math.abs(exitDir(0.4) - exitDir(-0.4))).toBeLessThan(2);
  });

  it('a glancing hit on the mesh is one contact, never a second one at once (the tilt is limited)', () => {
    const rng = new Rng(9);
    for (const a of [2, 5, 10, 20]) {
      for (let k = 0; k < 60; k++) {
        const v = 18;
        const b = new Ball();
        b.pos.set(5 - r - 0.05, 1.5, 2.0);
        b.vel.set(v * Math.sin(a * deg), 0, v * Math.cos(a * deg));
        // (Spin from the mesh can curve the ball back into it a few metres on: a real second contact. What must
        // not happen is a second one straight after the first, at the same spot.)
        const times: number[] = [];
        for (let i = 0; i < 30; i++) {
          b.step(turf, DT, rng);
          for (let e = 0; e < b.eventCount; e++) if (b.events[e]!.kind === HIT_WALL) times.push(i * DT + b.events[e]!.t);
        }
        expect(times.length, `${a}°`).toBeGreaterThan(0);
        if (times.length > 1) expect(times[1]! - times[0]!, `${a}°`).toBeGreaterThan(0.05);
      }
    }
  });

  it('a ball clipping the top of the back wall is deflected; one 4 cm over it is gone', () => {
    const over = (dy: number) => {
      const b = new Ball();
      b.pos.set(0.5, 4 + dy, 9.5);
      b.vel.set(0, 0, 15);
      const kinds: number[] = [];
      for (let i = 0; i < 20; i++) {
        b.step(turf, DT, null);
        for (let e = 0; e < b.eventCount; e++) kinds.push(b.events[e]!.kind);
      }
      return { kinds, b };
    };
    const clip = over(0.01);
    expect(clip.kinds[0]).toBe(HIT_WALL);
    expect(clip.b.vel.y).toBeGreaterThan(1);
    const clear = over(0.04);
    expect(clear.kinds).toEqual([LEFT_COURT]);
  });

  it('a ball through a door within a radius of its frame clips the post', () => {
    const c = turf.court;
    const o = c.openings[0]!;
    const b = new Ball();
    b.pos.set(4.5, 1.0, o.z1 - 0.01);
    b.vel.set(12, 0, 0);
    const kinds: number[] = [];
    for (let i = 0; i < 20; i++) {
      b.step(turf, DT, null);
      for (let e = 0; e < b.eventCount; e++) kinds.push(b.events[e]!.kind);
    }
    expect(kinds[0]).toBe(HIT_WALL);
  });

  it('a rolling ball comes back off the glass (one contact), and rolls out through a door', () => {
    const b = new Ball();
    b.pos.set(0.5, r, 8);
    b.vel.set(0, 0, 2);
    b.rolling = true;
    let walls = 0;
    for (let i = 0; i < 240; i++) {
      b.step(turf, DT, null);
      for (let e = 0; e < b.eventCount; e++) if (b.events[e]!.kind === HIT_WALL) walls++;
    }
    expect(walls).toBe(1);
    expect(b.outside).toBe(false);
    expect(b.vel.z).toBeLessThan(0);
    const o = turf.court.openings[0]!;
    const d = new Ball();
    d.pos.set(4, r, (o.z0 + o.z1) / 2);
    d.vel.set(2, 0, 0);
    d.rolling = true;
    for (let i = 0; i < 240; i++) d.step(turf, DT, null);
    expect(d.outside).toBe(true);
  });

  it('a ball that dies on the floor bounces once more at once (its second bounce), then rolls: no burst of contacts', () => {
    const b = new Ball();
    b.pos.set(0, r + 0.002, 3);
    b.vel.set(0, -0.2, 3);
    let floors = 0;
    for (let i = 0; i < 60; i++) {
      b.step(turf, DT, null);
      for (let e = 0; e < b.eventCount; e++) if (b.events[e]!.kind === HIT_FLOOR) floors++;
    }
    expect(b.rolling).toBe(true);
    expect(floors).toBe(2);
  });

  it('a ball found below the floor and going down is bounced back up', () => {
    const b = new Ball();
    b.pos.set(0, 0.03, 3);
    b.vel.set(0, -2, 0);
    for (let i = 0; i < 6; i++) b.step(turf, DT, null);
    expect(b.pos.y).toBeGreaterThanOrEqual(r - 1e-9);
    expect(b.vel.y).toBeGreaterThan(0);
  });
});

describe('ball wear in play', () => {
  it('bounces in a match wear the ball, and the match turns that wear into drag, friction and liveliness', () => {
    const m = new MatchSim({ seed: 3, human: [false, false] });
    for (let i = 0; i < 120 * 60; i++) m.step([null, null]);
    const b = m.ball;
    const w = m.world.spec.wear;
    expect(b.wear).toBeGreaterThan(20);
    const f = 1 - Math.exp(-b.wear / w.fluffImpacts);
    expect(b.wearDirty).toBe(false);
    expect(b.muScale).toBeCloseTo(1 + w.muGain * f, 9);
    expect(b.dragScale).toBeCloseTo(1 + w.dragFluff * f, 9);
  });
});
