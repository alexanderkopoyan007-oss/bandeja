// The shoes made to each person's feet as they are parsed (src/render/avatar/shoe.ts): the realism list's point 7, "black
// blob shoes → laces, stitching, herringbone soles". MakeHuman's trainer was a soft slipper; each person gets a soled, laced
// trainer measured from their own foot and sock, the old one's triangles out. A MetaHuman build brings its own instead (13 Nov
// 2026: modelled round each foot in Blender, tools/assets/metahuman/mh_shoe.py, `ShoeFit.modelled`), held to the same things;
// where its mesh is laid out differently (a filled bottom with fewer vertices, laces that are cords, a lining) the count or
// the place measured differs, and says so.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { drawnTriangles, mannequinWithPeople, metaHumansHere, surfaceNear } from './people.ts';
import type { PlayerAsset } from '../../src/render/avatar/asset.ts';
import { SHOE_RINGS, SHOE_ROUND } from '../../src/render/avatar/shoe.ts';

const base = mannequinWithPeople();
const everyone = [...base.people, ...metaHumansHere(base)];

/** Positions in the rest pose, the game's standing, where the shoes are made (shoe.ts). */
function rested(p: PlayerAsset): THREE.BufferAttribute {
  return new THREE.BufferAttribute(p.restPos, 3);
}

/** What a person draws, and on each side (+x first) their shoe's vertices and their sock's. */
function feet(p: PlayerAsset): { tris: number[]; sides: { shoe: number[]; sock: number[] }[] } {
  const g = p.geometry, pos = g.getAttribute('position'), A = g.getAttribute('bodyA'), B = g.getAttribute('bodyB');
  const tris = p.look!.face ? drawnTriangles(p) : Array.from(g.index!.array);
  const drawn = new Uint8Array(pos.count);
  for (const v of tris) drawn[v] = 1;
  const sides = [1, -1].map((side) => {
    const shoe: number[] = [], sock: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      if (!drawn[v] || Math.sign(pos.getX(v)) !== side) continue;
      if (B.getX(v) > 0.5) shoe.push(v);
      else if (A.getW(v) > 0.5 && pos.getY(v) < 0.6) sock.push(v);  // (a band or a visor is the sock's part too, kit.ts)
    }
    return { shoe, sock };
  });
  return { tris, sides };
}

describe('shoes made to the feet', () => {
  it('makes everyone a pair to their own feet, the old trainer gone', () => {
    for (const p of everyone) {
      const name = p.look!.name, fit = p.look!.shoe!, B = p.geometry.getAttribute('bodyB');
      expect(fit, name).toBeTruthy();
      expect(fit.length, name).toBeGreaterThan(0.2);
      expect(fit.length, name).toBeLessThan(0.32);
      expect(fit.k, name).toBeCloseTo(fit.length / 0.285, 2);
      expect(fit.laceFrom, name).toBeGreaterThan(0.3);
      expect(fit.laceTo, name).toBeGreaterThan(fit.laceFrom + 0.15);
      expect(fit.eyelets, name).toBeGreaterThan(0);
      const { tris, sides } = feet(p);
      for (const s of sides) expect(s.shoe.length, name).toBeGreaterThanOrEqual(SHOE_RINGS * SHOE_ROUND);
      // (no drawn triangle half shoe: the old trainer's slots are the new shoe's, and one left joined to the body would
      // stretch across the foot)
      for (let t = 0; t < tris.length; t += 3) {
        const n = [0, 1, 2].filter((c) => B.getX(tris[t + c]!) > 0.5).length;
        expect(n === 0 || n === 3, `${name} triangle ${t / 3}`).toBe(true);
      }
    }
  });

  it('stands level under the foot as the game stands it, the outsole facing down', () => {
    for (const p of everyone) {
      const name = p.look!.name, g = p.geometry, pos = rested(p), X = g.getAttribute('bodyX'), N = g.getAttribute('normal');
      const floors = feet(p).sides.map((s) => Math.min(...s.shoe.map((v) => pos.getY(v))));
      expect(Math.abs(floors[0]! - floors[1]!), name).toBeLessThan(0.002);
      // (level across: the outsole's bottom under the middle of the foot no higher on one edge than the other; made flat in
      // MakeHuman's pose, the rest turned it onto its outside edge, 3-6 mm into the floor)
      for (const s of feet(p).sides) {
        const edge = (side: number): number => Math.min(...s.shoe.filter((v) => X.getY(v) < 0.01 && X.getZ(v) > 0.3 && X.getZ(v) < 0.6 && X.getW(v) * side > 0.02).map((v) => pos.getY(v)));
        expect(Math.abs(edge(1) - edge(-1)), name).toBeLessThan(0.0015);
      }
      for (const [i, bone] of ['LeftToeBase', 'RightToeBase'].entries()) {
        const toe = new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone(bone)]!).y;
        expect(toe - Math.min(...floors), `${name} ${bone} ${i}`).toBeGreaterThan(0.02);
        expect(toe - Math.min(...floors), `${name} ${bone} ${i}`).toBeLessThan(0.08);
      }
      // (under the middle of the foot, the outsole's bottom: bodyX.y 0 is the outsole, z along the foot, w across it)
      let down = 0, up = 0;
      for (const s of feet(p).sides) for (const v of s.shoe) {
        if (X.getY(v) > 0.25 || X.getZ(v) < 0.3 || X.getZ(v) > 0.6 || Math.abs(X.getW(v)) > 0.02) continue;
        if (N.getY(v) < -0.5) down++; else if (N.getY(v) > 0.3) up++;
      }
      expect(down, name).toBeGreaterThan(p.look!.shoe!.modelled ? 8 : 20);
      expect(up, name).toBe(0);
    }
  });

  it('keeps the sock inside it up to the rim, all the way round', () => {
    // Round each foot in 10 degree sectors and 5 mm heights, no sock vertex further out than the shoe there, from the floor
    // to 3 mm under the shoe's top in that sector. (The collar used to stop 100 degrees round from the heel and the eyestay cut
    // across the ankle's widest part: the sock stood 2.5 cm out of it there.)
    for (const p of everyone) {
      const name = p.look!.name, pos = rested(p), k = p.look!.shoe!.k;
      if (p.look!.shoe!.modelled) {
        // A modelled trainer's rings are up to 17 mm apart up the quarter, wider than a bin, and from the ankle's middle the
        // midfoot runs obliquely through a sector: there the sock is judged against the shoe's own surface. Out from each sock
        // vertex well under the collar (its lowest dip is 6 cm over the insole; from 3 cm up: under that is the sock's own
        // sole, on the insole), along the sock's normal, there is shoe within 3 cm: none shows through.
        const g = p.geometry, X = g.getAttribute('bodyX'), B = g.getAttribute('bodyB'), N = g.getAttribute('normal');
        const { tris, sides } = feet(p);
        const ray = new THREE.Ray(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
        for (const [si, s] of sides.entries()) {
          const floor = Math.min(...s.shoe.map((v) => pos.getY(v)));
          const mine = new Set(s.shoe), shoeTris: number[] = [];
          for (let t = 0; t < tris.length; t += 3) {
            if ([0, 1, 2].every((k2) => mine.has(tris[t + k2]!) && B.getX(tris[t + k2]!) > 0.5 && X.getY(tris[t + k2]!) < 35)) shoeTris.push(t);
          }
          let checked = 0;
          for (const v of s.sock) {
            const y = pos.getY(v) - floor;
            // (nor the sock under the arch, which faces the insole)
            if (y > 0.06 * k || y < 0.03 || N.getY(v) < -0.3) continue;
            ray.origin.fromBufferAttribute(pos, v);
            ray.direction.fromBufferAttribute(N, v).normalize();
            let covered = false;
            for (const t of shoeTris) {
              a.fromBufferAttribute(pos, tris[t]!); b.fromBufferAttribute(pos, tris[t + 1]!); c.fromBufferAttribute(pos, tris[t + 2]!);
              if (ray.intersectTriangle(a, b, c, false, hit) && hit.distanceTo(ray.origin) < 0.03) { covered = true; break; }
            }
            expect(covered, `${name} side ${si} sock ${v}, ${(y * 100).toFixed(1)} cm up`).toBe(true);
            checked++;
          }
          expect(checked, name).toBeGreaterThan(15);
        }
        continue;
      }
      for (const [si, s] of feet(p).sides.entries()) {
        const floor = Math.min(...s.shoe.map((v) => pos.getY(v)));
        let cx = 0, cz = 0, n = 0;
        for (const v of s.sock) if (pos.getY(v) - floor > 0.06 * k && pos.getY(v) - floor < 0.1 * k) { cx += pos.getX(v); cz += pos.getZ(v); n++; }
        expect(n, name).toBeGreaterThan(10);
        cx /= n; cz /= n;
        const SECT = 36, BIN = 0.005, at = (v: number): [number, number, number] => {
          const dx = pos.getX(v) - cx, dz = pos.getZ(v) - cz;
          return [((Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * SECT) % SECT) + SECT) % SECT, Math.floor((pos.getY(v) - floor) / BIN), Math.hypot(dx, dz)];
        };
        const reach = new Map<number, number>(), top = new Float64Array(SECT).fill(-Infinity);
        for (const v of s.shoe) {
          const [a, h, r] = at(v);
          reach.set(a * 1000 + h, Math.max(reach.get(a * 1000 + h) ?? 0, r));
          top[a] = Math.max(top[a]!, pos.getY(v) - floor);
        }
        let checked = 0;
        for (const v of s.sock) {
          const [a, h, r] = at(v), y = pos.getY(v) - floor;
          if (y > Math.min(top[a]!, top[(a + 1) % SECT]!, top[(a + SECT - 1) % SECT]!) - 0.003) continue;
          let out = 0;
          for (const da of [-1, 0, 1]) for (const dh of [-1, 0, 1]) out = Math.max(out, reach.get(((a + da + SECT) % SECT) * 1000 + h + dh) ?? 0);
          expect(r, `${name} side ${si} sock ${v} at ${((a * 360) / SECT).toFixed(0)} degrees, ${(y * 100).toFixed(1)} cm`).toBeLessThan(out + 0.002);
          checked++;
        }
        // (MakeHuman's sock is coarse: 20 to 30 of its vertices are under a collar, round all of it)
        expect(checked, name).toBeGreaterThan(15);
      }
    }
  });

  it('keeps the collar on the sock as the ankle bends', () => {
    for (const p of everyone) {
      const name = p.look!.name, g = p.geometry, pos = g.getAttribute('position'), X = g.getAttribute('bodyX');
      const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const { sides } = feet(p);
      for (const [i, L] of ['Left', 'Right'].entries()) {
        const footBones = new Set([p.bone(L + 'Foot'), p.bone(L + 'ToeBase')]);
        const ankle = new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone(L + 'Foot')]!);
        const s = sides[ankle.x > 0 ? 0 : 1]!;
        expect(s.shoe.length, `${name} ${L}`).toBeGreaterThan(0);
        for (const v of s.shoe) {
          let sum = 0;
          for (let c = 0; c < 4; c++) sum += sw.getComponent(v, c);
          expect(Math.abs(sum - 1), `${name} ${v}`).toBeLessThan(1e-5);
        }
        // The collar's top at the heel and the sock beside it, with the foot turned 20 degrees up and down about the ankle
        // (the leg held): the gap between them changes by under 8 mm. A collar moving with the foot alone: up to 11.5.
        const topY = Math.max(...s.shoe.filter((v) => X.getY(v) >= 1 && X.getY(v) < 15 && X.getZ(v) < 0.2).map((v) => pos.getY(v)));
        const collar = s.shoe.filter((v) => X.getY(v) >= 1 && X.getY(v) < 15 && X.getZ(v) < 0.2 && pos.getY(v) > topY - (p.look!.shoe!.modelled ? 0.01 : 0.005));
        expect(collar.length, `${name} ${L}`).toBeGreaterThan(5);
        for (const deg of [-20, 20]) {
          const M = new THREE.Matrix4().makeTranslation(ankle.x, ankle.y, ankle.z).multiply(new THREE.Matrix4().makeRotationX((deg * Math.PI) / 180))
            .multiply(new THREE.Matrix4().makeTranslation(-ankle.x, -ankle.y, -ankle.z));
          const posed = (v: number): THREE.Vector3 => {
            let f = 0;
            for (let c = 0; c < 4; c++) if (footBones.has(si.getComponent(v, c))) f += sw.getComponent(v, c);
            const r = new THREE.Vector3().fromBufferAttribute(pos, v);
            return r.clone().multiplyScalar(1 - f).add(r.applyMatrix4(M).multiplyScalar(f));
          };
          for (const v of collar) {
            let near = -1, bd = Infinity;
            for (const q of s.sock) {
              const d = (pos.getX(q) - pos.getX(v)) ** 2 + (pos.getY(q) - pos.getY(v)) ** 2 + (pos.getZ(q) - pos.getZ(v)) ** 2;
              if (d < bd) { bd = d; near = q; }
            }
            const rest = new THREE.Vector3().fromBufferAttribute(pos, v).sub(new THREE.Vector3().fromBufferAttribute(pos, near));
            expect(posed(v).sub(posed(near)).sub(rest).length(), `${name} ${L} ${deg} collar ${v} (${i})`).toBeLessThan(0.008);
          }
        }
      }
    }
  });

  it('lays the tongue on the sock, not flat across the shin', () => {
    // The tongue's back (bodyX.x 0.55) over its top centimetre, the part that shows over the throat: within 8 mm (at a size
    // 43) of the sock's surface under it, never more than 2 mm into it. Drawn flat across, its edges stood 1.5 cm off the
    // round shin.
    for (const p of everyone) {
      const name = p.look!.name, g = p.geometry, pos = rested(p), X = g.getAttribute('bodyX'), A = g.getAttribute('bodyA'), k = p.look!.shoe!.k;
      const { tris, sides } = feet(p), sockTris: number[] = [];
      for (let t = 0; t < tris.length; t += 3) if ([0, 1, 2].every((c) => A.getW(tris[t + c]!) > 0.5 && pos.getY(tris[t + c]!) < 0.6)) sockTris.push(tris[t]!, tris[t + 1]!, tris[t + 2]!);
      const near = surfaceNear(p, sockTris, pos, p.look!.shoe!.modelled ? 5 : 2), q = new THREE.Vector3();
      for (const s of sides) {
        // (a modelled tongue is a padded piece with a rolled top: the roll, code 32 (mh_shoe.py), against the shin. Below it
        // the tongue bridges the ankle's crease from the instep to the shin, as a tongue does, 2-3 cm off the sock there)
        const own = !!p.look!.shoe!.modelled;
        const tongue = s.shoe.filter((v) => (own ? Math.abs(X.getY(v) - 32) < 0.01 : X.getY(v) >= 15 && Math.abs(X.getX(v) - 0.55) < 0.01));
        const top = Math.max(...tongue.map((v) => pos.getY(v)));
        let n = 0;
        for (const v of tongue) {
          if (pos.getY(v) < top - 0.01) continue;
          const { d, along } = near(q.fromBufferAttribute(pos, v));
          expect(d, `${name} tongue ${v}`).toBeLessThan(0.008 * k);
          expect(along, `${name} tongue ${v}`).toBeGreaterThan(-0.002);
          n++;
        }
        expect(n, name).toBeGreaterThan(5);
      }
    }
  });
});
