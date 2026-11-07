// M5 phase C step 3b: every cut a player can choose is a garment built for each body (tools/assets/mpfb/person_wear.py), the skin each
// covers hidden and the skin it leaves bare drawn (asset.ts Wardrobe, dressedIndex; paint.ts piecesFor). On every person: every cut is
// there, what they were modelled in is drawn as before, each cut covers and bares the places it should, and every choice builds.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople } from './people.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { kitFor } from '../../src/render/avatar/kit.ts';
import { dressedIndex, modelledVertices, type PlayerAsset } from '../../src/render/avatar/asset.ts';
import { cutFor, piecesFor, PAINT_SOCKS, PAINT_TOPS, type Paint } from '../../src/render/avatar/paint.ts';
import { dress } from '../../src/render/avatar/costume.ts';

const base = mannequinWithPeople();
const people = base.people;
const CUTS = ['tee', 'tank', 'sleeveless', 'vneck', 'long', 'shorts', 'tights', 'crew', 'ankle', 'knee'];

const at = (p: PlayerAsset, n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone(n)]!);

/** The skin vertex (rest pose) nearest a point; `ok` narrows the search. */
function skinNear(p: PlayerAsset, q: THREE.Vector3, ok: (x: number, y: number, z: number) => boolean = () => true): number {
  const r = p.restPos, A = p.geometry.getAttribute('bodyA').array as Float32Array, mine = modelledVertices(p);
  let best = -1, d = Infinity;
  for (let v = 0; v < r.length / 3; v++) {
    if (A[v * 4 + 2]! < 0.5 || !mine[v] || !ok(r[v * 3]!, r[v * 3 + 1]!, r[v * 3 + 2]!)) continue;
    const e = (r[v * 3]! - q.x) ** 2 + (r[v * 3 + 1]! - q.y) ** 2 + (r[v * 3 + 2]! - q.z) ** 2;
    if (e < d) { d = e; best = v; }
  }
  return best;
}

/** Does skin vertex `v` show when `paint` is worn (no garment worn hides it)? */
function drawn(p: PlayerAsset, paint: Paint): (v: number) => boolean {
  const w = p.look!.wardrobe!;
  let bits = 0;
  for (const n of ['shoe', ...(piecesFor(w, paint) ?? w.worn)]) bits |= 1 << w.pieces.indexOf(n);
  return (v) => (w.hide[v]! & bits) === 0;
}

describe('wardrobe', () => {
  it('has every cut built for every person, and draws what they were modelled in as modelled', () => {
    for (const p of people) {
      const w = p.look!.wardrobe!, name = p.look!.name;
      expect(w, name).toBeTruthy();
      for (const c of CUTS) expect(w.ranges[w.pieces.indexOf(c)]![1], `${name} ${c}`).toBeGreaterThan(300);
      const kit = p.look!.kit;
      expect(w.worn, name).toContain(kit.top === 'tank' ? 'tank' : 'tee');
      expect(w.worn.includes('collar'), name).toBe(kit.top === 'polo');
      expect(w.worn.includes('skirt'), name).toBe(kit.bottom === 'pleated' || kit.bottom === 'aline');
      expect(piecesFor(w, {}), name).toBeNull();
      // Choosing what they were modelled in changes nothing.
      expect(piecesFor(w, { top: kit.top === 'tank' ? 'tank' : 'tee', socks: 'crew' }) === null || kit.top === 'polo', name).toBe(true);
      // Some skin is hidden as modelled, and only skin is ever hidden.
      const all = p.look!.face!.bodyIndex.length, modelled = dressedIndex(p, w.worn).length;
      expect(modelled, name).toBeLessThan(all);
      const part = p.geometry.getAttribute('bodyA').array as Float32Array;
      for (let v = 0; v < w.hide.length; v++) if (w.hide[v]) expect(part[v * 4 + 2], name).toBe(1);
      // Drawn as modelled, at most what was drawn before every cut was in the file.
      expect(new Set(dressedIndex(p, w.worn)).size, name).toBeLessThan(22000);
    }
  });

  it('covers and bares the skin each cut should', () => {
    for (const p of people) {
      const name = p.look!.name;
      const L = { arm: at(p, 'LeftArm'), fore: at(p, 'LeftForeArm'), hand: at(p, 'LeftHand'), neck: at(p, 'Neck'), knee: at(p, 'LeftLeg'), foot: at(p, 'LeftFoot') };
      const tee = drawn(p, { top: 'tee' }), tank = drawn(p, { top: 'tank' }), sleeveless = drawn(p, { top: 'sleeveless' }), vneck = drawn(p, { top: 'vneck' });
      const long = drawn(p, { top: 'long' }), shorts = drawn(p, { bottom: 'shorts' }), tights = drawn(p, { bottom: 'tights' });
      const crew = drawn(p, { socks: 'crew' }), knee = drawn(p, { socks: 'knee' }), noshow = drawn(p, { socks: 'noshow' }), ankle = drawn(p, { socks: 'ankle' });
      // The top of the upper arm (the T-pose's), a quarter of the way to the elbow: under a tee's sleeve (a women's tee's is short), bare in
      // a tank or a sleeveless shirt.
      const upper = skinNear(p, L.arm.clone().lerp(L.fore, 0.25).add(new THREE.Vector3(0, 0.06, 0)));
      expect([tee(upper), tank(upper), sleeveless(upper)], `${name} upper arm`).toEqual([false, true, true]);
      // The side of the waist, 4 cm over the hem: a sleeveless shirt has its sides there as a tank has, cloth out as far and the
      // same skin hidden (its armhole's plane leans in under the arm, and cut there too it opened a slit each side, with a way
      // through four of the men, 7 Nov).
      const w = p.look!.wardrobe!, r = p.restPos;
      const widest = (k: string): number => {
        const id = w.pieces.indexOf(k);
        let hem = Infinity, best = -1;
        for (let v = 0; v < w.piece.length; v++) if (w.piece[v] === id) hem = Math.min(hem, r[v * 3 + 1]!);
        for (let v = 0; v < w.piece.length; v++) {
          if (w.piece[v] !== id || Math.abs(r[v * 3 + 1]! - (hem + 0.04)) > 0.01) continue;
          if (best < 0 || r[v * 3]! > r[best * 3]!) best = v;
        }
        return best;
      };
      const sideT = widest('tank'), sideS = widest('sleeveless');
      expect(r[sideS * 3]!, `${name} sleeveless shirt's side`).toBeGreaterThan(r[sideT * 3]! - 0.005);
      const side = skinNear(p, new THREE.Vector3(r[sideT * 3]!, r[sideT * 3 + 1]!, r[sideT * 3 + 2]!));
      expect(sleeveless(side), `${name} side of the waist`).toBe(tank(side));
      // The forearm: bare in a tee, under a long sleeve.
      const fore = skinNear(p, L.fore.clone().lerp(L.hand, 0.5));
      expect([tee(fore), long(fore)], `${name} forearm`).toEqual([true, false]);
      // The breastbone 12 cm under the Neck joint (the front-most skin within a centimetre): under a tee, bare in a V-neck's V.
      const chestY = L.neck.y - 0.12;
      const chest = skinNear(p, new THREE.Vector3(L.neck.x, chestY, L.neck.z + 0.3), (x, y, z) => Math.abs(x - L.neck.x) < 0.01 && Math.abs(y - chestY) < 0.01 && z > L.neck.z);
      expect([tee(chest), vneck(chest)], `${name} chest`).toEqual([false, true]);
      // The shin: bare under shorts, under tights.
      const shin = skinNear(p, L.knee.clone().lerp(L.foot, 0.45));
      expect([shorts(shin), tights(shin)], `${name} shin`).toEqual([true, false]);
      // The calf near the knee: bare over a crew sock, under a knee sock.
      const calf = skinNear(p, L.foot.clone().lerp(L.knee, 0.62));
      expect([crew(calf), knee(calf)], `${name} calf`).toEqual([true, false]);
      // Just over the ankle: under a crew sock, bare over no-shows and over an ankle sock's rib.
      const low = skinNear(p, L.foot.clone().lerp(L.knee, 0.2));
      expect([crew(low), noshow(low)], `${name} ankle`).toEqual([false, true]);
      const above = skinNear(p, L.foot.clone().lerp(L.knee, 0.32));
      expect(ankle(above), `${name} over an ankle sock`).toBe(true);
    }
  });

  it('maps the choices to garments and to the cut the shader draws', () => {
    const p = people.find((x) => x.look!.kit.top === 'polo')!, w = p.look!.wardrobe!;
    expect(piecesFor(w, { top: 'tee' })).not.toContain('collar');
    expect(piecesFor(w, { top: 'raglan' })).toEqual(piecesFor(w, { top: 'tee' }));
    expect(cutFor(p, { top: 'raglan' })).toMatchObject({ top: 'tee', seam: 'raglan' });
    expect(cutFor(p, { top: 'tee' }).top).toBe('tee');
    expect(piecesFor(w, { bottom: 'tights', socks: 'knee' })).toEqual(expect.arrayContaining(['shorts', 'tights', 'knee']));
    expect(piecesFor(w, { socks: 'noshow' })).not.toContain('crew');
    expect(piecesFor(w, { socks: 'stripe' })).toBeNull();
    const s = people.find((x) => x.look!.kit.bottom === 'pleated')!;
    expect(piecesFor(s.look!.wardrobe!, { bottom: 'shorts' })).not.toContain('skirt');
    expect(cutFor(s, { bottom: 'shorts' }).bottom).toBe('shorts');
    expect(piecesFor(null, { top: 'tank' })).toBeNull();
  });

  it('builds every cut on everyone', () => {
    const all: Paint[] = [...PAINT_TOPS.map((top) => ({ top })), { bottom: 'shorts' }, { bottom: 'tights' }, ...PAINT_SOCKS.map((socks) => ({ socks }))];
    for (const p of people) for (const paint of all) {
      const a = new Avatar(p, kitFor(1), paint);
      const idx = a.mesh.geometry.index!;
      expect(idx.count, `${p.look!.name} ${JSON.stringify(paint)}`).toBeGreaterThan(30000);
      // (never a skin triangle all of whose corners the worn garments hide)
      const w = p.look!.wardrobe!, on = piecesFor(w, paint) ?? w.worn;
      let bits = 0;
      for (const n of ['shoe', ...on]) bits |= 1 << w.pieces.indexOf(n);
      const part = p.geometry.getAttribute('bodyA').array as Float32Array;
      for (let t = 0; t < idx.count; t += 3) {
        const c = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        if (c.every((v) => part[v * 4 + 2] === 1 && (w.hide[v]! & bits) !== 0)) throw new Error(`${p.look!.name} ${JSON.stringify(paint)}: hidden skin drawn`);
      }
    }
  });

  it('puts a wristband over a long sleeve, not inside it', () => {
    for (const p of people) {
      // Each band's mean distance from the forearm's axis (bind pose), bare and over a long sleeve.
      const reach = (paint?: Paint): number => {
        const band = dress(p, { wrist: 'wrist-single', paint }, kitFor(1)).find((x) => x.side === 'R')!;
        const g = (band.mesh as THREE.Mesh).geometry, pos = g.getAttribute('position');
        const A = new THREE.Vector3().setFromMatrixPosition(p.boneInverses[p.bone('RightForeArm')]!.clone().invert());
        const B = new THREE.Vector3().setFromMatrixPosition(p.boneInverses[p.bone('RightHand')]!.clone().invert());
        const ax = A.clone().sub(B).normalize(), v = new THREE.Vector3();
        let sum = 0;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).sub(B);
          sum += v.sub(ax.clone().multiplyScalar(v.dot(ax))).length();
        }
        return sum / pos.count;
      };
      expect(reach({ top: 'long' }) - reach(), p.look!.name).toBeGreaterThan(0.002);
    }
  });
});
