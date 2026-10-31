// What the people wear (tools/assets/mpfb/person_kit.py, data/players/*.json `kit`): the women's own cut, skirts that hang
// outside the legs, shorts that end at mid-thigh, head pieces on the head, and ten builds that stay different.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople } from './people.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { kitFor, hemPush, personCut, personMaterial, personSway } from '../../src/render/avatar/kit.ts';
import { PEOPLE, type PlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';

const cast = JSON.parse(readFileSync(new URL('../../data/people.json', import.meta.url), 'utf8')) as { men: { name: string }[]; women: { name: string }[] };

/** Directions a camera looks from: round the player, a little under them to well over. */
function ring(elevations: number[]): number[][] {
  const out: number[][] = [];
  for (const el of elevations) for (let az = 0; az < 360; az += 45) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    out.push([-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e)]);
  }
  return out;
}

const GRID = 0.003;

/**
 * What the renderer would leave of a body, in software, along parallel rays 3 mm apart looking along `dir`: the mesh in `pos`, the
 * shader's cuts (`personCut`) by the modelled pose, with back faces (`both`) or without. A hole is a run of rays that meet nothing
 * drawn yet belong to the body: they meet something undrawn, or they pass inside the shirt's outline, through the hollow under it
 * (the gaps between limbs aren't in that outline). `at`: where a hole's rays first meet the body (modelled pose), null if they
 * meet nothing at all. `waist`: the hole is shut in by the shirt and the shorts or skirt together, touching both, so a line runs clean
 * through the body between them (a gap between limbs isn't shut in by cloth: below a sleeve it's open past bare arm). `core`: how near
 * the hole's rays pass to the line `axis` (m): a hem hung forward off a bent body and a raised thigh shut in some air in front of the
 * belly, which is no way through the body.
 */
function holes(p: PlayerAsset, pos: ArrayLike<number>, dir: number[], both: boolean, axis?: THREE.Vector3[]): { size: number; at: number[] | null; waist: boolean; core: number }[] {
  const g = p.geometry, rest = g.getAttribute('position').array as Float32Array, A = g.getAttribute('bodyA').array as Float32Array;
  const cut = personCut(p);
  const up = [0, 1, 0];
  const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const unit = (a: number[]): number[] => { const l = Math.hypot(a[0]!, a[1]!, a[2]!); return a.map((x) => x / l); };
  const w = unit(dir), u = unit(cross(up, w)), v = cross(w, u);
  const n = pos.length / 3;
  const U = new Float32Array(n), V = new Float32Array(n), D = new Float32Array(n);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    U[i] = x * u[0]! + y * u[1]! + z * u[2]!; V[i] = x * v[0]! + y * v[1]! + z * v[2]!; D[i] = x * w[0]! + y * w[1]! + z * w[2]!;
    u0 = Math.min(u0, U[i]!); u1 = Math.max(u1, U[i]!); v0 = Math.min(v0, V[i]!); v1 = Math.max(v1, V[i]!);
  }
  u0 -= 3 * GRID; v0 -= 3 * GRID;
  const nu = Math.ceil((u1 + 3 * GRID - u0) / GRID) + 1, nv = Math.ceil((v1 + 3 * GRID - v0) / GRID) + 1;
  const undrawn = new Uint8Array(nu * nv), drawn = new Uint8Array(nu * nv), shirt = new Uint8Array(nu * nv), bottom = new Uint8Array(nu * nv), near = new Float32Array(nu * nv).fill(Infinity), first = new Float32Array(nu * nv * 3);
  const f = p.look!.face!;
  const tris = [...f.bodyIndex, ...Array.from(f.index, (i) => f.verts[i]!)];
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t]!, i1 = tris[t + 1]!, i2 = tris[t + 2]!;
    const x0 = U[i0]!, y0 = V[i0]!, x1 = U[i1]!, y1 = V[i1]!, x2 = U[i2]!, y2 = V[i2]!;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) continue;
    const front = area < 0; // (u is the camera's left: a counter-clockwise face comes out negative)
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1, x2) - u0) / GRID)), c1 = Math.min(nu - 1, Math.ceil((Math.max(x0, x1, x2) - u0) / GRID));
    const r0 = Math.max(0, Math.floor((Math.min(y0, y1, y2) - v0) / GRID)), r1 = Math.min(nv - 1, Math.ceil((Math.max(y0, y1, y2) - v0) / GRID));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const px = u0 + c * GRID, py = v0 + r * GRID;
      const l1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / area, l2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area, l0 = 1 - l1 - l2;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const mix = (a: Float32Array, s: number, k: number): number => l0 * a[i0 * s + k]! + l1 * a[i1 * s + k]! + l2 * a[i2 * s + k]!;
      const x = mix(rest, 3, 0), y = mix(rest, 3, 1), z = mix(rest, 3, 2), id = r * nu + c;
      const depth = l0 * D[i0]! + l1 * D[i1]! + l2 * D[i2]!;
      if (depth < near[id]!) { near[id] = depth; first[id * 3] = x; first[id * 3 + 1] = y; first[id * 3 + 2] = z; }
      if (mix(A, 4, 0) > 0.5) shirt[id] = 1;
      if (mix(A, 4, 1) > 0.5) bottom[id] = 1;
      if (cut(x, y, z, mix(A, 4, 0), mix(A, 4, 2))) continue; // (a part that is cut away is no part of the outline)
      if (front || both) drawn[id] = 1;
      else undrawn[id] = 1;
    }
  }
  // Outside the shirt's outline: every ray the image's edge can reach without crossing the shirt.
  const out = new Uint8Array(nu * nv);
  const open = [0];
  out[0] = 1;
  while (open.length) {
    const k = open.pop()!, c = k % nu;
    for (const o of [c > 0 ? k - 1 : -1, c < nu - 1 ? k + 1 : -1, k - nu, k + nu]) if (o >= 0 && o < out.length && !shirt[o] && !out[o]) { out[o] = 1; open.push(o); }
  }
  // The same outline with the shorts or skirt in it.
  const outCloth = new Uint8Array(nu * nv);
  open.push(0);
  outCloth[0] = 1;
  while (open.length) {
    const k = open.pop()!, c = k % nu;
    for (const o of [c > 0 ? k - 1 : -1, c < nu - 1 ? k + 1 : -1, k - nu, k + nu]) if (o >= 0 && o < out.length && !shirt[o] && !bottom[o] && !outCloth[o]) { outCloth[o] = 1; open.push(o); }
  }
  const seen = new Uint8Array(nu * nv);
  const found: { size: number; at: number[] | null; waist: boolean; core: number }[] = [];
  // The axis on the image, for how near a ray at (c, r) passes it.
  const ends = (axis ?? []).map((e) => [e.x * u[0]! + e.y * u[1]! + e.z * u[2]!, e.x * v[0]! + e.y * v[1]! + e.z * v[2]!] as [number, number]);
  const toAxis = (c: number, r: number): number => {
    if (ends.length < 2) return Infinity;
    const [a, b] = ends as [[number, number], [number, number]], x = u0 + c * GRID - a[0], y = v0 + r * GRID - a[1], ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (x * ex + y * ey) / (ex * ex + ey * ey || 1)));
    return Math.hypot(x - t * ex, y - t * ey);
  };
  const hole = (k: number): boolean => !drawn[k] && (!!undrawn[k] || !shirt[k] && !out[k] || !shirt[k] && !bottom[k] && !outCloth[k]);
  for (let s = 0; s < seen.length; s++) {
    if (seen[s] || !hole(s)) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0, hit = 0, mx = 0, my = 0, mz = 0, byShirt = false, byBottom = false, core = Infinity;
    while (stack.length) {
      const k = stack.pop()!, c = k % nu;
      size++;
      core = Math.min(core, toAxis(c, Math.floor(k / nu)));
      if (near[k]! < Infinity) { hit++; mx += first[k * 3]!; my += first[k * 3 + 1]!; mz += first[k * 3 + 2]!; }
      for (const o of [c > 0 ? k - 1 : -1, c < nu - 1 ? k + 1 : -1, k - nu, k + nu]) {
        if (o < 0 || o >= seen.length) continue;
        if (hole(o)) { if (!seen[o]) { seen[o] = 1; stack.push(o); } } else { byShirt ||= !!shirt[o]; byBottom ||= !!bottom[o]; }
      }
    }
    found.push({ size, at: hit ? [mx / hit, my / hit, mz / hit] : null, waist: byShirt && byBottom && hit === 0, core });
  }
  return found;
}

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
          // (a collar's leaf rides on the shirt: the neck's weight and the shirt's own, on the chest and the shoulders)
          for (let k = 0; k < 2; k++) if (sw[v * 4 + k]! > 0) expect([neck, chest, p.bone('LeftShoulder'), p.bone('RightShoulder')]).toContain(si[v * 4 + k]);
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

  // Round 8: p10's tank had saw-toothed gaps through both shoulders, and the court showed through her. The skin came back only
  // from 2 cm inside the cut, a whole triangle at a time, and the shirt's edge stood up to 2 cm off the shoulder, over a hollow
  // torso. Both ways of looking are held here: from outside, the armhole's edge closes on the skin with nothing behind it to see;
  // and with every face drawn, as the game draws them, nobody has a way through them. (Measured on the old build: 150-280 px a
  // view along each armhole, about 3 cm across at 3 mm a ray, and rays clean through from armhole to armhole.)
  it('closes a tank\'s armholes on the skin', () => {
    for (const p of base.people.filter((x) => x.look!.kit.top === 'tank')) {
      const arm = at(p, 'LeftArm');
      for (const pos of [p.geometry.getAttribute('position').array as Float32Array, p.restPos]) for (const dir of ring([0, 20, 45])) {
        const seen = holes(p, pos, dir, false).filter((h) => h.at && Math.abs(h.at[0]!) > Math.abs(arm.x) - 0.06 && h.at[1]! > arm.y - 0.2 && h.at[1]! < arm.y + 0.09);
        // (in the T-pose, with the arm drawn up and looking along the edge, 6 rays: half a square centimetre)
        expect(seen.filter((h) => h.size >= 8).map((h) => [h.size, ...h.at!])).toEqual([]);
      }
    }
  });

  it('has no way through anyone, standing or in play, from anywhere a camera goes', () => {
    for (const p of base.people) {
      expect(personMaterial(p, kitFor(0)).material.side).toBe(THREE.DoubleSide);
      const n = p.geometry.getAttribute('position').count;
      const poses = [p.geometry.getAttribute('position').array as Float32Array];
      const v = new THREE.Vector3();
      let next = 2.5;
      runAnimQa(p, { seed: 14601, seconds: 6, lefty: [], onFrame: (m, av) => {
        if (m.time < next) return;
        next += 3;
        const a = av[poses.length]! as unknown as { mesh: THREE.SkinnedMesh; refreshSkin(): void };
        a.refreshSkin();
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) (a.mesh.getVertexPosition(i, v).applyMatrix4(a.mesh.matrixWorld)).toArray(pos, i * 3);
        poses.push(pos);
      } });
      expect(poses.length).toBe(3);
      // (in play a sleeve and the body can close round a gap between them: there only rays that meet something and aren't drawn)
      poses.forEach((pos, k) => {
        for (const dir of ring([-15, 0, 20, 45])) expect(holes(p, pos, dir, true).filter((h) => h.size >= 3 && (k === 0 || h.at)).map((h) => [h.size, h.at])).toEqual([]);
      });
    }
  }, 120_000);

  it('opens no way through the waist as a hem swings', () => {
    const CLOTH_MAX = 0.05; // (avatar.ts)
    const CORE = 0.08; // (inside the hips: the way p8's waist opened on a hem that slid ran within 3 cm of the axis, the air in front of a belly 9 cm or more off it)
    const bad: string[] = [];
    for (const p of base.people) {
      const g = p.geometry, rest = g.getAttribute('position').array as Float32Array, A = g.getAttribute('bodyA').array as Float32Array;
      const n = rest.length / 3, tris = p.look!.face!.bodyIndex, sway = personSway(p);
      const weldAt = new Map<string, number>(), weld = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const key = `${Math.round(rest[i * 3]! * 2e4)},${Math.round(rest[i * 3 + 1]! * 2e4)},${Math.round(rest[i * 3 + 2]! * 2e4)}`;
        weld[i] = weldAt.get(key) ?? (weldAt.set(key, i), i);
      }
      // The most bent moments of a rally: a lean is what turned a lag up the body.
      const bent: { lean: number; pos: Float32Array; axis: THREE.Vector3[] }[] = [];
      const v = new THREE.Vector3(), hips = new THREE.Vector3(), neck = new THREE.Vector3();
      let next = 0.5;
      runAnimQa(p, { seed: 14601, seconds: 6, lefty: [], onFrame: (m, av) => {
        if (m.time < next) return;
        next += 0.25;
        for (const raw of av) {
          const a = raw as unknown as { mesh: THREE.SkinnedMesh; refreshSkin(): void };
          a.refreshSkin();
          a.mesh.worldToLocal(a.mesh.skeleton.getBoneByName('Hips')!.getWorldPosition(hips));
          a.mesh.worldToLocal(a.mesh.skeleton.getBoneByName('Neck')!.getWorldPosition(neck));
          const lean = Math.acos(neck.clone().sub(hips).normalize().y);
          if (bent.length === 2 && lean <= bent[1]!.lean) continue;
          const pos = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) a.mesh.getVertexPosition(i, v).toArray(pos, i * 3);
          bent.push({ lean, pos, axis: [hips.clone(), neck.clone()] });
          bent.sort((x, y) => y.lean - x.lean);
          bent.length = Math.min(2, bent.length);
        }
      } });
      expect(bent[0]!.lean).toBeGreaterThan(0.25);
      for (const { pos, axis } of bent) {
        const normal = new Float32Array(n * 3);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < tris.length; t += 3) {
          const i0 = tris[t]!, i1 = tris[t + 1]!, i2 = tris[t + 2]!;
          a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
          b.sub(a); c.sub(a); b.cross(c);
          for (const i of [i0, i1, i2]) for (let k = 0; k < 3; k++) normal[weld[i]! * 3 + k] = normal[weld[i]! * 3 + k]! + b.getComponent(k);
        }
        for (const lag of [[CLOTH_MAX, 0, 0], [-CLOTH_MAX, 0, 0], [0, 0, CLOTH_MAX], [0, 0, -CLOTH_MAX]]) {
          const d = new THREE.Vector3(...(lag as [number, number, number]));
          const moved = pos.slice();
          for (let i = 0; i < n; i++) {
            const k = sway(i);
            if (k <= 0 || A[i * 4]! + A[i * 4 + 1]! < 0.5) continue;
            const no = a.fromArray(normal, weld[i]! * 3).normalize();
            const push = hemPush(d, k, no);
            moved[i * 3] = moved[i * 3]! + push.x; moved[i * 3 + 1] = moved[i * 3 + 1]! + push.y; moved[i * 3 + 2] = moved[i * 3 + 2]! + push.z;
          }
          for (const dir of ring([-12, 8])) {
            const through = holes(p, moved, dir, true, axis).filter((h) => h.waist && h.size >= 3 && h.core < CORE);
            if (through.length) bad.push(`${p.look!.kit.top} ${p.look!.kit.bottom} ${n} lag ${lag} from ${dir.map((x) => x.toFixed(1))}: ${through.map((h) => `${h.size} rays ${h.core.toFixed(3)} m off the axis`)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('gives each person their own head of hair and their own shoes', () => {
    const specs = PEOPLE.map((n) => JSON.parse(readFileSync(new URL(`../../data/players/${n}.json`, import.meta.url), 'utf8')) as { hair: string; hair_fit?: number; hair_trim?: number; kit: { shoes: string; sole: string } });
    expect(new Set(specs.map((s) => `${s.hair} ${s.hair_fit ?? 1} ${s.hair_trim ?? ''}`)).size).toBe(10);
    expect(new Set(specs.map((s) => s.kit.shoes)).size).toBe(10);
    for (const p of base.people) expect(p.look!.kit.shoes).toMatch(/^#[0-9a-f]{6}$/);
  });
});
