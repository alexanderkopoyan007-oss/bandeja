// What the people wear (tools/assets/mpfb/person_kit.py, data/players/*.json `kit`): the women's own cut, skirts that hang
// outside the legs, shorts that end at mid-thigh, head pieces on the head, and ten builds that stay different.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople } from './people.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { kitFor } from '../../src/render/avatar/kit.ts';

const cast = JSON.parse(readFileSync(new URL('../../data/people.json', import.meta.url), 'utf8')) as { men: { name: string }[]; women: { name: string }[] };

describe('kit', () => {
  const base = mannequinWithPeople();
  const person = (n: string): (typeof base.people)[number] => base.people.find((p) => p.look!.name === n)!;
  const at = (a: typeof base, n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(a.restWorld[a.bone(n)]!);
  const women = cast.women.map((w) => person(w.name)), men = cast.men.map((m) => person(m.name));
  const skirted = (p: (typeof base.people)[number]): boolean => p.look!.kit.bottom === 'pleated' || p.look!.kit.bottom === 'aline';

  it('dresses the women in their own cut, at least two of the four in skirts, and a real tour has both', () => {
    for (const p of women) {
      expect(p.look!.textures.cloth).toBe('suit-normal-f.webp');
      expect(existsSync(new URL('../../public/assets/people/suit-normal-f.webp', import.meta.url))).toBe(true);
    }
    expect(women.filter(skirted).length).toBeGreaterThanOrEqual(2);
    expect(women.filter((p) => !skirted(p)).length).toBeGreaterThanOrEqual(1);
    for (const p of men) expect(skirted(p)).toBe(false);
    // Polos and crews both, on the men and across everybody.
    const tops = base.people.map((p) => p.look!.kit.top);
    expect(new Set(tops).size).toBeGreaterThanOrEqual(3);
  });

  it('has skirts that hang outside the legs: every part of the leg in the skirt\'s heights is inside the cloth at rest', () => {
    for (const p of women.filter(skirted)) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array, X = p.geometry.getAttribute('bodyX').array as Float32Array;
      const n = r.length / 3;
      const isSkirt = (v: number): boolean => A[v * 4 + 1]! > 0.5 && X[v * 4]! > 0.001;
      let hem = Infinity, top = -Infinity, cx = 0, cz = 0, c = 0;
      for (let v = 0; v < n; v++) if (isSkirt(v) && X[v * 4]! > 0.99) { hem = Math.min(hem, r[v * 3 + 1]!); cx += r[v * 3]!; cz += r[v * 3 + 2]!; c++; }
      for (let v = 0; v < n; v++) if (isSkirt(v)) top = Math.max(top, r[v * 3 + 1]!);
      expect(c).toBeGreaterThan(20);
      cx /= c; cz /= c;
      // The cloth's radius by bearing, over the hem's height.
      const bins = 16, cloth = new Array(bins).fill(0) as number[];
      const bearing = (x: number, z: number): number => Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / (2 * Math.PI)) * bins) % bins;
      for (let v = 0; v < n; v++) if (isSkirt(v) && X[v * 4]! > 0.85) {
        const b = bearing(r[v * 3]!, r[v * 3 + 2]!);
        cloth[b] = Math.max(cloth[b]!, Math.hypot(r[v * 3]! - cx, r[v * 3 + 2]! - cz));
      }
      for (let v = 0; v < n; v++) {
        const y = r[v * 3 + 1]!;
        if (A[v * 4 + 2]! < 0.5 || y < hem - 0.01 || y > hem + 0.05) continue;
        expect(Math.hypot(r[v * 3]! - cx, r[v * 3 + 2]! - cz)).toBeLessThan(cloth[bearing(r[v * 3]!, r[v * 3 + 2]!)]!);
      }
      // A skirt ends at the upper or middle thigh: over the knee by a good way, under the crotch.
      const knee = at(p, 'LeftLeg').y, hip = at(p, 'LeftUpLeg').y;
      expect(hem).toBeGreaterThan(knee + (hip - knee) * 0.35);
      expect(hem).toBeLessThan(hip - 0.12);
      expect(top).toBeGreaterThan(hip + 0.05);
    }
  });

  it('ends shorts at mid-thigh', () => {
    for (const p of base.people.filter((x) => !skirted(x))) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array;
      let hem = Infinity;
      for (let v = 0; v < r.length / 3; v++) if (A[v * 4 + 1]! > 0.5) hem = Math.min(hem, r[v * 3 + 1]!);
      const knee = at(p, 'LeftLeg').y, hip = at(p, 'LeftUpLeg').y;
      const u = (hip - hem) / (hip - knee);
      expect(u).toBeGreaterThan(0.45);
      expect(u).toBeLessThan(0.82);
    }
  });

  it('keeps a head piece on the head, over the eyes\' line, and a collar on the neck', () => {
    for (const p of base.people) {
      const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array, B = p.geometry.getAttribute('bodyB').array as Float32Array;
      const si = p.geometry.getAttribute('skinIndex').array as Uint16Array, sw = p.geometry.getAttribute('skinWeight').array as Float32Array;
      const head = p.bone('Head'), neck = p.bone('Neck'), chest = p.bone('Spine2');
      const hips = at(p, 'Hips').y;
      let eyeY = 0, ne = 0, band = 0;
      for (let v = 0; v < r.length / 3; v++) if (B[v * 4 + 1]! > 0.5) { eyeY += r[v * 3 + 1]!; ne++; }
      eyeY /= ne;
      for (let v = 0; v < r.length / 3; v++) {
        if (A[v * 4 + 3]! < 0.5 || r[v * 3 + 1]! < hips) continue;
        const y = r[v * 3 + 1]!;
        if (y > eyeY - 0.03) {
          // (a visor's bill sits a little lower than its band, still above the eyes)
          expect(y).toBeGreaterThan(eyeY);
          expect(si[v * 4]).toBe(head);
          expect(sw[v * 4]).toBeCloseTo(1, 2);
          band++;
        } else {
          for (let k = 0; k < 2; k++) if (sw[v * 4 + k]! > 0) expect([neck, chest]).toContain(si[v * 4 + k]);
        }
      }
      if (p.look!.kit.head) expect(band).toBeGreaterThan(60);
      else expect(band).toBe(0);
    }
  });

  it('keeps ten builds apart, by shoulders over height', () => {
    const shoulders = (p: (typeof base.people)[number]): number => at(p, 'LeftArm').distanceTo(at(p, 'RightArm')) / p.look!.height;
    const spread = (l: (typeof base.people)): number => Math.max(...l.map(shoulders)) - Math.min(...l.map(shoulders));
    expect(spread(men)).toBeGreaterThan(0.01);
    expect(spread(women)).toBeGreaterThan(0.005);
  });

  it('builds the dressed material for every cut', () => {
    for (const p of base.people) expect(() => new Avatar(p, kitFor(0))).not.toThrow();
  });
});
