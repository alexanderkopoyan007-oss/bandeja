// The skin a garment covers but the build keeps under its edges (asset.ts tuckOf), sunk under the cloth by kit.ts (TUCK_SINK).
import { describe, expect, it } from 'vitest';
import { SKIN_BAND, SKIN_ISLAND, skinIslands, tuckInto, tuckOf } from '../../src/render/avatar/asset.ts';
import { mannequinWithPeople, metaHumansHere } from './people.ts';

const base = mannequinWithPeople();
const people = metaHumansHere(base);

describe('tuck: the skin kept under a garment edge goes in under the cloth', () => {
  it('is found on every MetaHuman build, under the sleeves, and never on the hands, the head or the feet', () => {
    expect(people.length).toBe(10);
    for (const p of people) {
      const w = p.look!.wardrobe!, t = tuckOf(p, w.worn), n = t.length;
      const si = p.geometry.getAttribute('skinIndex').array, sw = p.geometry.getAttribute('skinWeight').array;
      const top = (v: number): string => { let b = 0; for (let k = 1; k < 4; k++) if (sw[v * 4 + k]! > sw[v * 4 + b]!) b = k; return p.bones[si[v * 4 + b]!]!.name; };
      let band = 0, arm = 0;
      for (let v = 0; v < n; v++) {
        expect(t[v]).toBeGreaterThanOrEqual(0);
        expect(t[v]).toBeLessThanOrEqual(1);
        if (w.piece[v] !== 0) { expect(t[v]).toBe(0); continue; }
        const b = top(v);
        if (/Hand|Head|Foot|Toe|Index|Middle|Ring|Pinky|Thumb/.test(b)) expect(t[v], `${p.look!.name} ${b}`).toBe(0);
        if (t[v]! > 0 && t[v]! < 1) band++;
        if (t[v]! > 0 && /Arm/.test(b) && !/Fore/.test(b)) arm++;
      }
      expect(band, p.look!.name).toBeGreaterThan(10);
      // (a tank or a sleeveless top has no sleeve to keep skin under)
      if (w.worn.some((q) => q === 'tee' || q === 'vneck' || q === 'long' || q === 'collar')) expect(arm, p.look!.name).toBeGreaterThan(20);
    }
  });

  it('hides the islands a sleeve stood too far off to hide, small and only under a sleeve', () => {
    let found = 0;
    for (const p of [...people, ...base.people]) {
      const w = p.look!.wardrobe!, t = tuckOf(p, w.worn);
      const hid = Float32Array.from(t, (x) => (x === 1 ? 1 : 0));
      const isl = skinIslands(p, w.worn, hid);
      // (tuckOf already took them in: none is left)
      expect(isl.length, p.look!.name).toBe(0);
      const bare = new Float32Array(t.length);
      for (let v = 0; v < t.length; v++) if (w.piece[v] === 0 && t[v] === 1) bare[v] = 1;
      const sleeved = w.worn.some((q) => q === 'tee' || q === 'vneck' || q === 'long' || q === 'collar');
      if (!sleeved) expect(t.every((x, v) => x < 1 || (w.hide[v]! & ~0) !== 0)).toBe(true);
      for (let v = 0; v < t.length; v++) if (t[v] === 1 && w.hide[v] === 0) found++;
    }
    // (p1mh's shoulder among them, 118 vertices; the islands are 3 to 192 vertices, what shows round a sleeve 1,777 at least)
    expect(found).toBeGreaterThan(500);
    expect(SKIN_ISLAND).toBeLessThan(1777);
    expect(SKIN_ISLAND).toBeGreaterThan(192);
  });

  it('leaves the skin behind the collar, which the neckline shows, where it is', () => {
    for (const p of people) {
      const t = tuckOf(p, p.look!.wardrobe!.worn), pos = p.geometry.getAttribute('position').array as Float32Array, nk = p.restWorld[p.bone('Neck')]!.elements;
      for (let v = 0; v < t.length; v++) {
        if (Math.abs(pos[v * 3]! - nk[12]!) < 0.17 && pos[v * 3 + 1]! > nk[13]! - 0.17 && pos[v * 3 + 1]! < nk[13]! + 0.04 && p.look!.wardrobe!.hide[v] === 0)
          expect(t[v]).toBe(0);
      }
    }
  });

  it('goes into bodyX.w as a negative and never touches the ears, and follows a change of clothes', () => {
    const p = people[0]!, w = p.look!.wardrobe!;
    const X0 = (p.geometry.getAttribute('bodyX').array as Float32Array).slice();
    const X = tuckInto(p, X0.slice(), w.worn);
    let ears = 0;
    for (let v = 0; v < X.length / 4; v++) {
      if (X0[v * 4 + 3]! > 0) { ears++; expect(X[v * 4 + 3]).toBe(X0[v * 4 + 3]); }
      for (let k = 0; k < 3; k++) expect(X[v * 4 + k]).toBe(X0[v * 4 + k]);
    }
    expect(ears).toBeGreaterThan(0);
    // (a top with long sleeves hides the forearm the tee's band leaves: the band moves to the wrist; nothing worn, nothing tucked)
    const long = w.pieces.includes('long') ? tuckInto(p, X.slice(), w.worn.map((q) => (q === 'tee' ? 'long' : q))) : null;
    if (long) expect(long.some((x, i) => i % 4 === 3 && x !== X[i])).toBe(true);
    const bare = tuckInto(p, X.slice(), []);
    for (let v = 0; v < bare.length / 4; v++) expect(bare[v * 4 + 3]).toBeGreaterThanOrEqual(0);
    expect(SKIN_BAND).toBe(0.025);
  });
});
