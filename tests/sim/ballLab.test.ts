// The ball lab's tuned numbers (Phase 1 of the realism brief): every bounce checked against published data where
// there is some, and the qualitative behaviour players know where there isn't. Sources: data/surfaces.json and
// data/ball.json `//`, docs/realism.md, DECISIONS.md (Phase 1). Changing a surface means changing these on purpose.
import { describe, expect, it } from 'vitest';
import { labShots, runLab, runShot, keyContact, type ShotSummary } from '../../src/sim/lab/ballLab.ts';
import { makeWorld } from '../../src/sim/setup.ts';
import { Rng } from '../../src/sim/core/rng.ts';

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

  it('court pace on turf at 70 km/h, 16°: friction 0.57-0.62 and CPR 36-50, as padel balls on padel turf (IBV/Testfakta 2023)', () => {
    const itf = get('cpr-turf').itf!;
    expect(itf.mu).toBeGreaterThan(0.57);
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
