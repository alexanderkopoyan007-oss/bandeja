// The racket-ball impact against the published padel numbers (docs/realism.md): apparent COR across the face and
// against impact speed (Viollaz & Viollaz 2008), grip vs slide on the face (TWU padel spin), off-centre twist, the
// ball-out formula, and the inverse swing.
import { describe, expect, it } from 'vitest';
import { Racket, RACKETS } from '../../src/sim/contact/racket.ts';
import { V3 } from '../../src/sim/core/v3.ts';
import { Rng } from '../../src/sim/core/rng.ts';

const BALL_M = 0.0577;
const BALL_R = 0.0328;
const ALPHA = 0.55;
const rk = new Racket(RACKETS.standard!, BALL_M, BALL_R, ALPHA);
const com = rk.comFromTip;

describe('racket impact', () => {
  it('apparent COR at its best point: 0.50 at 17 m/s, 0.39 at 29 m/s (conventional rackets)', () => {
    expect(rk.acor(17, com, 0)).toBeCloseTo(0.5, 1);
    expect(rk.acor(29, com, 0)).toBeGreaterThan(0.37);
    expect(rk.acor(29, com, 0)).toBeLessThan(0.41);
  });

  it('falls off as the measured paraboloid: about -1e-5 per mm^2 along the face, -4e-5 across it', () => {
    const c0 = rk.acor(17, com, 0);
    const along = (rk.acor(17, com - 0.05, 0) - c0) / (50 * 50);
    const across = (rk.acor(17, com, 0.05) - c0) / (50 * 50);
    expect(along).toBeLessThan(-0.6e-5);
    expect(along).toBeGreaterThan(-1.6e-5);
    expect(across).toBeLessThan(-2.5e-5);
    expect(across).toBeGreaterThan(-6e-5);
  });

  it('smash point (83 mm from the tip) < drive (128) < volley (146), as measured', () => {
    const smash = rk.acor(29, 0.083, 0);
    const drive = rk.acor(29, 0.128, 0);
    const volley = rk.acor(29, 0.146, 0);
    expect(smash).toBeLessThan(drive);
    expect(drive).toBeLessThan(volley);
    expect(drive).toBeGreaterThan(0.3);
  });

  it('ball out = ea v_in + (1 + ea) V head on, so a harder ball comes back faster off the same swing', () => {
    const out = (vin: number, V: number) => {
      const v = new V3(0, 0, -vin);
      const n = new V3(0, 0, 1);
      const Vr = new V3(0, 0, V);
      const a = new V3(0, 1, 0);
      const vo = new V3();
      const wo = new V3();
      rk.impact(v, new V3(), n, Vr, a, com, 0, vo, wo);
      return { v: vo.z, ea: rk.ea };
    };
    const r = out(10, 20);
    expect(r.v).toBeCloseTo(r.ea * 10 + (1 + r.ea) * 20, 6);
    expect(out(25, 20).v).toBeGreaterThan(out(5, 20).v);
  });

  it('grips above about 40 degrees from the face and slides below (face friction 0.35)', () => {
    const at = (deg: number) => {
      const t = (deg * Math.PI) / 180;
      const v = new V3(Math.cos(t) * 15, 0, -Math.sin(t) * 15);
      const vo = new V3();
      const wo = new V3();
      rk.impact(v, new V3(), new V3(0, 0, 1), new V3(), new V3(0, 1, 0), com, 0, vo, wo);
      return rk.slid;
    };
    expect(at(25)).toBe(true);
    expect(at(55)).toBe(false);
  });

  it('an off-centre hit loses pace and turns the ball towards the side it was hit on', () => {
    const go = (x: number) => {
      const vo = new V3();
      const wo = new V3();
      rk.impact(new V3(0, 0, -15), new V3(), new V3(0, 0, 1), new V3(0, 0, 18), new V3(0, 1, 0), 0.13, x, vo, wo);
      return { speed: vo.length(), deg: (Math.atan2(vo.x, vo.z) * 180) / Math.PI };
    };
    const mid = go(0);
    const off = go(0.05); // a x n = y x z = +x: the +x side
    expect(off.speed).toBeLessThan(mid.speed * 0.95);
    expect(off.deg).toBeGreaterThan(1.5);
    expect(off.deg).toBeLessThan(12);
    expect(Math.abs(mid.deg)).toBeLessThan(0.01);
  });

  it('the swing found for a wanted ball gives that ball back, with the spin when friction allows it', () => {
    const rng = new Rng(5);
    let limited = 0;
    for (let i = 0; i < 300; i++) {
      const v = new V3(rng.range(-4, 4), rng.range(-6, 4), rng.range(8, 30));
      const w = new V3(rng.range(-150, 150), rng.range(-40, 40), rng.range(-40, 40));
      const sp = rng.range(10, 32);
      const vWant = new V3(rng.range(-5, 5), rng.range(-2, 8), -sp);
      // Topspin / backspin about the axis square to the flight, horizontal.
      const rpm = rng.range(-2500, 2500);
      const wWant = new V3(vWant.z, 0, -vWant.x).scale(((rpm * 2 * Math.PI) / 60) / Math.hypot(vWant.x, vWant.z));
      const a = new V3(1, 0, 0);
      const n = new V3();
      const V = new V3();
      rk.swing(v, w, vWant, wWant, a, 0.13, n, V);
      const vo = new V3();
      const wo = new V3();
      rk.impact(v, w, n, V, a, 0.13, 0, vo, wo);
      expect(vo.x).toBeCloseTo(vWant.x, 1);
      expect(vo.y).toBeCloseTo(vWant.y, 1);
      expect(vo.z).toBeCloseTo(vWant.z, 1);
      if (rk.spinLimited) limited++;
      else {
        // Spin square to the change of velocity is what a face can give; compare that part.
        const dv = new V3().copy(vWant).addScaled(v, -1);
        const dwW = new V3().copy(wWant).addScaled(w, -1);
        const dwG = new V3().copy(wo).addScaled(w, -1);
        dwW.addScaled(dv, -dwW.dot(dv) / dv.lengthSq());
        if (dwW.length() > 30) expect(dwG.dot(dwW) / (dwG.length() * dwW.length())).toBeGreaterThan(0.97);
      }
    }
    expect(limited).toBeLessThan(150);
  });
});
