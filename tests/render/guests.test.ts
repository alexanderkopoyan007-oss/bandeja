// The generated people (tools/assets/meshy/): one fused surface each on the game skeleton, their joints fitted to their own bodies.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { GUESTS, guestAsset, mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const guests = GUESTS.map((n) => guestAsset(n, base));
const J = (a: (typeof guests)[number], n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);

describe('the generated people', () => {
  it.each(GUESTS)('%s stands on the game skeleton with a human build', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const h = a.look!.height;
    expect(a.look!.kit.baked).toBe(true);
    expect(a.bones.length).toBe(base.bones.length);
    // Standing proportions, as shares of the height: hips, shoulders, arm and leg lengths, both sides alike.
    expect(J(a, 'Hips').y / h).toBeGreaterThan(0.5);
    expect(J(a, 'Hips').y / h).toBeLessThan(0.6);
    expect(J(a, 'LeftArm').y / h).toBeGreaterThan(0.74);
    expect(J(a, 'LeftArm').y / h).toBeLessThan(0.84);
    for (const [from, to, lo, hi] of [['LeftArm', 'LeftForeArm', 0.11, 0.19], ['LeftForeArm', 'LeftHand', 0.13, 0.19], ['LeftUpLeg', 'LeftLeg', 0.22, 0.29], ['LeftLeg', 'LeftFoot', 0.18, 0.25]] as const) {
      const d = J(a, from).distanceTo(J(a, to)) / h;
      expect(d).toBeGreaterThan(lo);
      expect(d).toBeLessThan(hi);
      expect(J(a, from.replace('Left', 'Right')).distanceTo(J(a, to.replace('Left', 'Right'))) / h).toBeCloseTo(d, 2);
    }
  });

  // A flattened waist laps over its own other end with no triangle flipped: two parts of the body share texels and the second shows as shards
  // of the first (decimate-bake.py `overlaps`). Every texel's centre lies in one triangle only.
  it.each(GUESTS)('no two parts of %s share the texture', (name) => {
    const a = guests[GUESTS.indexOf(name)]!;
    const geo = a.geometry;
    const uv = geo.getAttribute('uv'), idx = geo.index!;
    const N = 1024, seen = new Int32Array(N * N).fill(-1);
    let shared = 0, covered = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const p = [0, 1, 2].map((k) => { const i = idx.getX(t + k); return [uv.getX(i) * N, uv.getY(i) * N] as const; });
      const x0 = Math.max(0, Math.floor(Math.min(p[0]![0], p[1]![0], p[2]![0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(p[0]![0], p[1]![0], p[2]![0])));
      const y0 = Math.max(0, Math.floor(Math.min(p[0]![1], p[1]![1], p[2]![1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(p[0]![1], p[1]![1], p[2]![1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const s = [0, 1, 2].map((i) => { const a_ = p[i]!, b = p[(i + 1) % 3]!; return (b[0] - a_[0]) * (y + 0.5 - a_[1]) - (b[1] - a_[1]) * (x + 0.5 - a_[0]); });
        if ((s[0]! >= 0 && s[1]! >= 0 && s[2]! >= 0) || (s[0]! <= 0 && s[1]! <= 0 && s[2]! <= 0)) {
          if (seen[y * N + x]! >= 0 && seen[y * N + x] !== t) shared++;
          else covered++;
          seen[y * N + x] = t;
        }
      }
    }
    expect(shared / covered).toBeLessThan(0.0005);
  });

  it.each(GUESTS)('%s moves as cleanly as the regular cast', (name) => {
    const r = runAnimQa(guests[GUESTS.indexOf(name)]!, { seed: 14601, seconds: 30, repeatEvery: 7 } as never);
    expect(r.pops.perMinute).toBeLessThan(32);
  }, 300000);
});
