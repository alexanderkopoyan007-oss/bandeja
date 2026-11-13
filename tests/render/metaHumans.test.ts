// The roster's people as their MetaHuman builds (13 Nov 2026: the owner's "publish them", then "build the wardrobe on the
// detailed bodies"): which build a player is drawn as, that a MetaHuman build has the garments its MakeHuman build has, and
// that its face has the keys its MakeHuman build's has (tools/assets/metahuman/face-keys.mjs), moving what they should.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import ROSTER from '../../data/people.json';
import { classicBodies, PEOPLE, personOf } from '../../src/render/avatar/asset.ts';
import { bodyFor } from '../../src/render/avatar/costumes.ts';
import { mannequinWithPeople, metaHumansHere } from './people.ts';

const header = (name: string): { kit: Record<string, unknown>; meshes: { opaque: { wardrobe?: { pieces: string[]; worn: string[]; ranges: Array<[number, number]> } } } } => {
  const raw = gunzipSync(readFileSync(new URL(`../../public/assets/people/${name}.bnz`, import.meta.url)));
  return JSON.parse(raw.subarray(12, 12 + raw.readUInt32LE(8)).toString());
};

describe('the MetaHuman builds', () => {
  const base = mannequinWithPeople();
  const mh = metaHumansHere(base);

  it('are there for everyone on the roster, modelled in the cut their MakeHuman build was', () => {
    const all = [...ROSTER.men, ...ROSTER.women] as Array<{ name: string; body?: string }>;
    expect(all.map((p) => p.name)).toEqual(PEOPLE);
    expect(mh.length).toBe(PEOPLE.length);
    for (const p of all) {
      expect(p.body).toBe(p.name + 'mh');
      expect(personOf(p.body!)).toBe(p.name);
      const a = header(p.name).kit, b = header(p.body!).kit;
      for (const k of ['top', 'bottom', 'head', 'skirt']) expect(b[k], `${p.name} ${k}`).toEqual(a[k]);
    }
    expect(personOf('meshy')).toBe('meshy');
  });

  it('carry the wardrobe their MakeHuman build has: the same cut worn, every garment built but the pair under a skirt', () => {
    // (tools/assets/metahuman/mh-player.py; `under` is the tight shorts a MakeHuman build in loose ones wears under a skirt:
    // a MetaHuman's shorts are worn under both)
    for (const n of PEOPLE) {
      const a = header(n).meshes.opaque.wardrobe!, b = header(n + 'mh').meshes.opaque.wardrobe!;
      expect(b.pieces).toEqual(a.pieces);
      expect(b.worn, n).toEqual(a.worn);
      for (const [i, piece] of b.pieces.entries()) {
        if (piece === 'under') expect(b.ranges[i]![1], `${n}mh under`).toBe(0);
        else expect(b.ranges[i]![1], `${n}mh ${piece}`).toBeGreaterThan(0);
      }
    }
  });

  it('hang every garment on the side of the body it is on: cloth on a left arm moves with the left arm', () => {
    // (13 Nov 2026: the long sleeves' new cloth was bound each arm's as the other's, by a count from the end of the vertex
    // list that a cut had moved. Blender's renders, in the rest pose, showed clean sleeves; in a rally they tore into ribbons.)
    for (const [n, p] of mh.entries()) {
      const r = p.restPos, w = p.look!.wardrobe!;
      const si = p.geometry.getAttribute('skinIndex').array as Uint16Array, sw = p.geometry.getAttribute('skinWeight').array as Float32Array;
      const mid = new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone('Spine2')]!).x;
      const left = Math.sign(new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone('LeftArm')]!).x - mid);
      const side = new Map<number, number>();
      for (const [lr, s] of [['Left', left], ['Right', -left]] as const) for (const part of ['Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot']) side.set(p.bone(lr + part), s);
      let wrong = 0, seen = 0;
      for (let v = 0; v < w.piece.length; v++) {
        if (w.pieces[w.piece[v]!] === 'body') continue;
        let top = 0;
        for (let k = 1; k < 4; k++) if (sw[v * 4 + k]! > sw[v * 4 + top]!) top = k;
        const s = side.get(si[v * 4 + top]!);
        if (s === undefined) continue;
        seen++;
        if ((r[v * 3]! - mid) * s < -0.02) wrong++;
      }
      expect(seen, `build ${n}`).toBeGreaterThan(2000);
      expect(wrong, `build ${n}: garment vertices on one side moved by the other side's limb`).toBe(0);
    }
  });

  it('draw a player whatever they wear, but in a costume or a print', () => {
    expect(bodyFor('p1')).toBe('p1mh');
    expect(bodyFor('p1', { head: 'head-cap', wrist: 'wrist-pair', paint: { pattern: 'hoops' } })).toBe('p1mh');
    // (another top, a skirt on or off, tights, other socks, a dress: garments both builds have since 13 Nov 2026)
    expect(bodyFor('p1', { paint: { top: 'polo' } })).toBe('p1mh');
    expect(bodyFor('p4', { paint: { top: 'tee', socks: 'knee' } })).toBe('p4mh');
    expect(bodyFor('p6', { paint: { top: 'long', bottom: 'tights' } })).toBe('p6mh');
    expect(bodyFor('p7', { paint: { top: 'dress' } })).toBe('p7mh');
    expect(bodyFor('p9', { paint: { top: 'tee', bottom: 'shorts' } })).toBe('p9mh');
    expect(bodyFor('p10', { paint: { top: 'tank', bottom: 'aline' } })).toBe('p10mh');
    // (a costume's suit and a print are made on the MakeHuman build)
    expect(bodyFor('p1', { costume: 'costume-banana' })).toBe('p1');
    // (guests are themselves; ?classic=1 is everyone's MakeHuman build)
    expect(bodyFor('meshy')).toBe('meshy');
    expect(bodyFor('p1mh')).toBe('p1mh');
    classicBodies.on = true;
    try { expect(bodyFor('p1')).toBe('p1'); } finally { classicBodies.on = false; }
  });

  it('have their person\'s face keys: lids that close, a jaw that takes the lower teeth, eyes that turn about their own centres', () => {
    for (const p of mh) {
      const look = p.look!, twin = base.people.find((q) => q.look!.name === personOf(look.name))!;
      expect(look.morphs).toEqual(twin.look!.morphs);
      const f = look.face!;
      expect(f.verts.length).toBeLessThan(p.geometry.getAttribute('position').count * 0.5);
      const B = p.geometry.getAttribute('bodyB').array as Float32Array, A = p.geometry.getAttribute('bodyA').array as Float32Array;
      const move = (k: number, j: number): number => Math.hypot(f.pos[k]![j * 3]!, f.pos[k]![j * 3 + 1]!, f.pos[k]![j * 3 + 2]!);
      const y = (j: number): number => p.restPos[f.verts[j]! * 3 + 1]!;
      // A blink: the lid's edge comes down 4-20 mm, nothing under the nose moves, and the eyeballs stay.
      for (const name of ['blinkL', 'blinkR']) {
        const k = look.morphs.indexOf(name);
        let most = 0, lowest = Infinity, eye = 0;
        for (let j = 0; j < f.verts.length; j++) {
          const d = move(k, j);
          if (B[f.verts[j]! * 4 + 1]! > 0.5) eye = Math.max(eye, d);
          else if (d > 1e-4) lowest = Math.min(lowest, y(j));
          most = Math.max(most, d);
        }
        expect(most, `${look.name} ${name}`).toBeGreaterThan(0.004);
        expect(most).toBeLessThan(0.02);
        expect(lowest).toBeGreaterThan(look.height - 0.2);
        expect(eye).toBeLessThan(1e-4);
      }
      // The jaw (eased until the lips part 6 mm: a MetaHuman's lips are joined, face-keys.mjs PART): some teeth go down with
      // it, some stay (the upper row).
      const J = look.morphs.indexOf('jawOpen');
      let moved = 0, still = 0;
      for (let j = 0; j < f.verts.length; j++) if (B[f.verts[j]! * 4 + 2]! > 0.5 && move(J, j) > 0.002) moved++;
      for (let v = 0, n = B.length / 4; v < n; v++) if (B[v * 4 + 2]! > 0.5) still++;
      expect(moved, `${look.name} lower teeth`).toBeGreaterThan(100);
      expect(still - moved, `${look.name} upper teeth`).toBeGreaterThan(100);
      // The chin's skin goes with it.
      let chin = 0;
      for (let j = 0; j < f.verts.length; j++) if (A[f.verts[j]! * 4 + 2]! > 0.5) chin = Math.max(chin, move(J, j));
      expect(chin).toBeGreaterThan(0.004);
      expect(chin).toBeLessThan(0.012);
      // Looking left: each eyeball turns rigidly (distances within it kept) and about its own centre (every vertex stays
      // as far from the sphere's middle as it was).
      const L = look.morphs.indexOf('lookLeft');
      const at0 = (j: number): [number, number, number] => [p.restPos[f.verts[j]! * 3]!, p.restPos[f.verts[j]! * 3 + 1]!, p.restPos[f.verts[j]! * 3 + 2]!];
      const at1 = (j: number): [number, number, number] => { const a = at0(j); return [a[0] + f.pos[L]![j * 3]!, a[1] + f.pos[L]![j * 3 + 1]!, a[2] + f.pos[L]![j * 3 + 2]!]; };
      const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      for (const side of [1, -1]) {
        const ids: number[] = [];
        for (let j = 0; j < f.verts.length; j++) if (B[f.verts[j]! * 4 + 1]! > 0.5 && at0(j)[0] * side > 0) ids.push(j);
        expect(ids.length).toBeGreaterThan(100);
        const c = [0, 0, 0];
        // (the middle of the eyeball's box: its vertices are not spread evenly, the cornea's are many)
        for (let a = 0; a < 3; a++) { let lo = Infinity, hi = -Infinity; for (const j of ids) { lo = Math.min(lo, at0(j)[a]!); hi = Math.max(hi, at0(j)[a]!); } c[a] = (lo + hi) / 2; }
        let worst = 0, far = 0, most = 0;
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i]!, b = ids[(i * 7 + 3) % ids.length]!;
          worst = Math.max(worst, Math.abs(dist(at1(a), at1(b)) - dist(at0(a), at0(b))));
          far = Math.max(far, Math.abs(dist(at1(a), c) - dist(at0(a), c)));
          most = Math.max(most, move(L, a));
        }
        // (a key is a straight move, so a turn of 30 degrees stretches a little: 0.3 mm within the eyeball, as the MakeHuman's)
        expect(worst, `${look.name} eye ${side}`).toBeLessThan(0.0012);
        expect(far).toBeLessThan(0.0015);
        expect(most).toBeGreaterThan(0.004);
      }
    }
  });
});
