// A body built to other proportions (M5, proportions.ts): the skeleton and the skin go together, the soles stay on the
// floor, each factor does what it says and nothing else, the skin doesn't tear, and it is quick enough to do at load.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import BODIES from '../../data/bodies.json' with { type: 'json' };
import { bodyNamed, fitted, LEG_SPAN, NEUTRAL, RANGES, reproportion, type Proportions } from '../../src/render/avatar/proportions.ts';
import type { PlayerAsset } from '../../src/render/avatar/asset.ts';
import { guestAsset, mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const subjects: Array<[string, PlayerAsset]> = [['p1', base.people[0]!], ['p8', base.people[7]!], ['mannequin', base], ['meshy', guestAsset('meshy', base)]];
const names = Object.keys(BODIES).filter((k) => k !== '//');

const at = (a: PlayerAsset, n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);
const seg = (a: PlayerAsset, ...ns: string[]): number => { let d = 0; for (let i = 1; i < ns.length; i++) d += at(a, ns[i - 1]!).distanceTo(at(a, ns[i]!)); return d; };
const lowest = (p: Float32Array): number => { let m = Infinity; for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i]!); return m; };

/** How far the skin's edges go past what the factors allow: the share off by over 5 mm and the most (m). */
function skinOff(a: PlayerAsset, b: PlayerAsset, p: Proportions): { share: number; worst: number } {
  const f = Object.values(p) as number[], hi = Math.max(1, ...f) * p.height, lo = Math.min(1, ...f) * p.height;
  const idx = a.geometry.getIndex()!.array, A = a.restPos, Bp = b.restPos;
  let over = 0, n = 0, worst = 0;
  for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
    const u = idx[i + e]!, v = idx[i + ((e + 1) % 3)]!;
    const la = Math.hypot(A[u * 3]! - A[v * 3]!, A[u * 3 + 1]! - A[v * 3 + 1]!, A[u * 3 + 2]! - A[v * 3 + 2]!);
    const lb = Math.hypot(Bp[u * 3]! - Bp[v * 3]!, Bp[u * 3 + 1]! - Bp[v * 3 + 1]!, Bp[u * 3 + 2]! - Bp[v * 3 + 2]!);
    const ex = Math.max(lb - hi * la, lo * la - lb, 0);
    n++;
    if (ex > 0.005) over++;
    worst = Math.max(worst, ex);
  }
  return { share: over / n, worst };
}

describe('proportions', () => {
  it('at the realistic sliders\' ends the skin stays within a centimetre', () => {
    for (const [, a] of subjects) for (const end of [0, 1] as const) {
      const p = { ...NEUTRAL };
      for (const k of Object.keys(RANGES.real) as Array<keyof Proportions>) p[k] = RANGES.real[k][end];
      expect(skinOff(a, reproportion(a, p), p).worst).toBeLessThan(0.01);
    }
  });

  it('leaves a body alone at 1', () => {
    expect(reproportion(base.people[0]!, { ...NEUTRAL })).toBe(base.people[0]);
  });

  it('a hair off 1 is the body as built (the bake is exact)', () => {
    const a = base.people[0]!, b = reproportion(a, { ...NEUTRAL, build: 1.000001 });
    let worst = 0;
    for (let i = 0; i < a.restPos.length; i++) worst = Math.max(worst, Math.abs(a.restPos[i]! - b.restPos[i]!));
    expect(worst).toBeLessThan(2e-4);
  });

  for (const [who, a] of subjects) for (const name of names) {
    it(`${who} ${name}: limbs as asked, soles on the floor, no tears`, () => {
      const p: Proportions = bodyNamed(name);
      const t0 = performance.now();
      const b = reproportion(a, p);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(400);
      const h = p.height;
      expect(seg(b, 'LeftUpLeg', 'LeftLeg', 'LeftFoot') / seg(a, 'LeftUpLeg', 'LeftLeg', 'LeftFoot')).toBeCloseTo(p.legs * h, 3);
      expect(seg(b, 'RightArm', 'RightForeArm', 'RightHand') / seg(a, 'RightArm', 'RightForeArm', 'RightHand')).toBeCloseTo(p.arms * h, 3);
      expect(seg(b, 'Head', 'HeadTop_End') / seg(a, 'Head', 'HeadTop_End')).toBeCloseTo(p.head * h, 3);
      expect(seg(b, 'RightHand', 'RightHandMiddle1') / seg(a, 'RightHand', 'RightHandMiddle1')).toBeCloseTo(p.hands * h, 3);
      expect(Math.abs(lowest(b.restPos) - lowest(a.restPos))).toBeLessThan(1e-4);
      // The skin: an edge between vertices skinned to two bones scaled differently stretches or shrinks past both factors (a
      // crease where the thigh meets the hips, the neck under a doubled head), by up to a few centimetres on a few edges in a
      // thousand. A tear would be many edges, or one far apart.
      const off = skinOff(a, b, p);
      expect(off.share).toBeLessThan(0.004);
      expect(off.worst).toBeLessThan(0.04);
      const n = b.geometry.getAttribute('normal');
      for (let v = 0; v < n.count; v += 97) expect(Math.hypot(n.getX(v), n.getY(v), n.getZ(v))).toBeCloseTo(1, 4);
      if (a.look) expect(b.look!.height / a.look.height).toBeGreaterThan(0.5);
      console.log(`${who} ${name}: ${ms.toFixed(0)} ms, height ${a.look ? a.look.height.toFixed(2) + ' -> ' + b.look!.height.toFixed(2) : '-'} m, edges off by over 5 mm ${(100 * off.share).toFixed(2)}%, worst ${(100 * off.worst).toFixed(1)} cm`);
    });
  }

  it("moves the face's keys with the head", () => {
    const a = base.people[0]!, b = reproportion(a, bodyNamed('giant-head'));
    const fa = a.look!.face!, fb = b.look!.face!;
    let na = 0, nb = 0;
    for (let k = 0; k < fa.pos.length; k++) for (let i = 0; i < fa.pos[k]!.length; i++) { na += fa.pos[k]![i]! ** 2; nb += fb.pos[k]![i]! ** 2; }
    expect(Math.sqrt(nb / na)).toBeGreaterThan(1.6);
    expect(Math.sqrt(nb / na)).toBeLessThan(2.05);
  });

  it('a body is fitted to what the animation plays: the ridiculous ranges, the leg within LEG_SPAN', () => {
    const wild = fitted({ ...NEUTRAL, head: 9, arms: 0.1, height: 0.7, legs: 0.65 });
    expect(wild.head).toBe(RANGES.silly.head[1]);
    expect(wild.arms).toBe(RANGES.silly.arms[0]);
    expect(wild.height * wild.legs).toBeCloseTo(LEG_SPAN[0], 9);
    expect(fitted({ ...NEUTRAL, height: 1.3, legs: 1.3 }).legs * 1.3).toBeCloseTo(LEG_SPAN[1], 9);
    expect(fitted(bodyNamed('everything'))).toEqual(bodyNamed('everything'));
    // reproportion builds the fitted body: asking past the span gives the body at its end
    const a = base.people[0]!;
    expect(reproportion(a, { ...NEUTRAL, legs: 0.3 })).toBe(reproportion(a, { ...NEUTRAL, legs: LEG_SPAN[0] }));
    expect(reproportion(a, { ...NEUTRAL, legs: 0.3 }).legScale).toBeCloseTo(LEG_SPAN[0], 3);
    expect(a.legScale).toBeUndefined();
  });
});
