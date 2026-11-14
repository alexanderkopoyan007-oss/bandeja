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
import { personFrame, skirtFallen, thighPushed } from '../../src/render/avatar/kit.ts';
import { piecesFor } from '../../src/render/avatar/paint.ts';
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

  it('carry the wardrobe their MakeHuman build has: the same cut worn, every garment built, a tight pair under a skirt', () => {
    // (tools/assets/metahuman/mh-player.py. `under` is the tight shorts worn under a skirt: Epic's shorts stand 2-4 cm off the
    // leg, and a skirt over them stood out from the hips like a lampshade, the owner's "this looks awful", 13 Nov. A build
    // modelled in a skirt wears them as modelled; one who then chooses shorts gets Epic's.)
    for (const [k, n] of PEOPLE.entries()) {
      const a = header(n).meshes.opaque.wardrobe!, b = header(n + 'mh').meshes.opaque.wardrobe!;
      expect(b.pieces).toEqual(a.pieces);
      const skirted = a.worn.some((x) => x === 'pleated' || x === 'aline');
      expect(b.worn, n).toEqual(a.worn.map((x) => (skirted && x === 'shorts' ? 'under' : x)));
      for (const [i, piece] of b.pieces.entries()) expect(b.ranges[i]![1], `${n}mh ${piece}`).toBeGreaterThan(0);
      const w = mh[k]!.look!.wardrobe!;
      for (const style of ['pleated', 'aline'] as const) {
        const on = piecesFor(w, { bottom: style }) ?? w.worn;
        expect(on, `${n}mh ${style}`).toContain('under');
        expect(on, `${n}mh ${style}`).not.toContain('shorts');
      }
      const inShorts = piecesFor(w, { bottom: 'shorts' }) ?? w.worn;
      expect(inShorts, `${n}mh shorts`).toContain('shorts');
      expect(inShorts, `${n}mh shorts`).not.toContain('under');
    }
  });

  it('push a skirt off a thigh, not off the seat: the capsule at the hip is a leg\'s', () => {
    // (13 Nov 2026: measured through the ring at the seat, the capsule was a ball 15-18 cm in radius at each hip joint, and
    // every skirt stood off the waist on it. A thigh under the seat is 10-12 cm.)
    // (the MakeHuman men aside: the pair they'd wear under a skirt is their suit's trousers cut off, 14 cm round the thigh)
    for (const [n, p] of [...base.people.filter((x) => x.look!.kit.bottom !== 'shorts'), ...mh].entries()) {
      const [r0, r1] = personFrame(p).thighR!;
      expect(r0, `person ${n} at the hip`).toBeLessThan(0.128);
      expect(r0, `person ${n} at the hip`).toBeGreaterThan(0.085);
      expect(r1, `person ${n} at the knee`).toBeLessThanOrEqual(r0);
    }
    for (const [n, p] of mh.entries()) expect(personFrame(p).thighR![0], `build ${n}`).toBeLessThan(0.11);
  });

  it('let a skirt hang plumb from a pelvis that leans, its cloth its own length and never inside the hips', () => {
    const c = new THREE.Vector3(0, 0.95, 0.02), span: [number, number] = [0.98, 0.68];
    const hem = (a: number): THREE.Vector3 => new THREE.Vector3(Math.sin(a) * 0.2, 0.68, 0.02 + Math.cos(a) * 0.2);
    // Upright nothing moves.
    for (const a of [0, 1, 2, 3, 4, 5]) expect(skirtFallen(hem(a), c, span, new THREE.Vector3(0, -1, 0)).distanceTo(hem(a))).toBeLessThan(1e-9);
    // The pelvis tipped 30 degrees forward: plumb, in its frame, points down and to the front.
    const g = new THREE.Vector3(0, -Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));
    const drop = 0.98 - 0.2 * 0.3 - 0.68;
    const front = skirtFallen(hem(0), c, span, g), back = skirtFallen(hem(Math.PI), c, span, g);
    // (the front swings out with plumb, a column of cloth as long as it was)
    expect(front.z - hem(0).z).toBeCloseTo(drop * 0.5, 3);
    expect(front.distanceTo(new THREE.Vector3(0, 0.68 + drop, 0.22))).toBeCloseTo(drop, 3);
    // (the back falls in towards the seat no further than its flare lets it)
    const rBack = Math.hypot(back.x - c.x, back.z - c.z);
    expect(rBack).toBeGreaterThan(0.2 - drop * 0.15 - 0.004 - 1e-6);
    expect(rBack).toBeLessThan(0.2);
    // (above where the cloth leaves the waist nothing moves)
    const waist = new THREE.Vector3(0, 0.97, 0.15);
    expect(skirtFallen(waist, c, span, g).distanceTo(waist)).toBeLessThan(1e-9);
  });

  it('move a skirt out of a thigh the way cloth goes: to its far side from the pelvis, over its top when it is raised', () => {
    // (14 Nov 2026: pushed the nearest way out, cloth a leg had stepped past came out under the thigh while the cloth beside
    // it lay over it, and the leg stood through the skirt in a torn pocket. kit.ts thighsPush, in plain numbers: thighPushed.)
    const hips = new THREE.Vector3(0, 0.95, 0), hip = new THREE.Vector3(0.09, 0.9, 0), r0 = 0.1, r1 = 0.07, clear = 0.012, L = 0.42;
    const knee = (out: number, fwd: number): THREE.Vector3 => {
      const d = new THREE.Vector3(Math.sin(out), -Math.cos(out) * Math.cos(fwd), Math.cos(out) * Math.sin(fwd));
      return hip.clone().addScaledVector(d, L);
    };
    /** Where `p` is from the thigh's axis: along it (0-1), how far off it, and that as a vector. */
    const off = (p: THREE.Vector3, k: THREE.Vector3): { t: number; d: THREE.Vector3 } => {
      const ab = k.clone().sub(hip), t = Math.min(1, Math.max(0, p.clone().sub(hip).dot(ab) / ab.dot(ab)));
      return { t, d: p.clone().sub(hip.clone().addScaledVector(ab, t)) };
    };
    // Standing: cloth clear of the leg isn't moved, and cloth just inside it comes straight out to its surface.
    const down = knee(0, 0);
    expect(thighPushed(new THREE.Vector3(0.25, 0.75, 0), hips, hip, down, r0, r1).length()).toBe(0);
    const side = new THREE.Vector3(0.16, 0.75, 0), s = thighPushed(side, hips, hip, down, r0, r1);
    const rAt = (t: number): number => r0 + (r1 - r0) * t + clear;
    expect(s.x).toBeCloseTo(rAt(off(side, down).t) - 0.07, 4);
    expect(Math.hypot(s.y, s.z)).toBeLessThan(1e-9);
    // A step out to the side, 40 degrees: the leg has gone past cloth that hung by the hip, which is now inside it and on
    // the pelvis's side of its axis. It comes out on the far side, not under the leg.
    const wide = knee((40 * Math.PI) / 180, 0);
    const past = new THREE.Vector3(0.19, 0.72, -0.03);
    const before = off(past, wide);
    expect(before.d.length()).toBeLessThan(rAt(before.t));
    expect(before.d.x).toBeLessThan(0);
    const moved = past.clone().add(thighPushed(past, hips, hip, wide, r0, r1)), after = off(moved, wide);
    expect(after.d.x, 'on the far side of the leg').toBeGreaterThan(0);
    expect(after.d.length(), 'out of the leg').toBeGreaterThan(rAt(after.t) - 0.012);
    expect(moved.y, 'not dropped under it').toBeGreaterThan(past.y - 0.005);
    // A thigh raised to the front, 80 degrees: cloth that hung in front of the hip is inside it, under its axis. It goes
    // up over the top.
    const raised = knee(0, (80 * Math.PI) / 180);
    const front = new THREE.Vector3(0.09, 0.8, 0.2);
    expect(off(front, raised).d.y).toBeLessThan(0);
    const lifted = front.clone().add(thighPushed(front, hips, hip, raised, r0, r1)), on = off(lifted, raised);
    expect(on.d.y, 'over the thigh').toBeGreaterThan(0.05);
    expect(on.d.length(), 'on its surface').toBeGreaterThan(rAt(on.t) - 0.012);
    // The other leg's cloth, on the far side of the pelvis, is left alone by all three.
    for (const k of [down, wide, raised]) expect(thighPushed(new THREE.Vector3(-0.2, 0.75, 0.02), hips, hip, k, r0, r1).length()).toBe(0);
  });

  it('have their shirts and shorts sewn: vertices in one place along a seam share a normal', () => {
    // (14 Nov 2026: Epic's garments are sewing panels, their seams two rows of vertices in the one place with a normal each,
    // up to 90 degrees apart. The hem's swing moves a vertex along its normal (kit.ts hemLag), and a shirt's side seam opened
    // into dark slits a hand long. mh-player.py `sewn`. Cloth turned back on itself, a hem's inside, keeps its own.)
    for (const p of mh) {
      const w = p.look!.wardrobe!, pos = p.geometry.getAttribute('position'), nrm = p.geometry.getAttribute('normal');
      for (const piece of ['tee', 'sleeveless', 'vneck', 'long', 'tank', 'shorts']) {
        const k = w.pieces.indexOf(piece);
        if (k < 0) continue;
        const at = new Map<string, number[]>();
        for (let v = 0; v < w.piece.length; v++) if (w.piece[v] === k) {
          const key = `${Math.round(pos.getX(v) * 2e4)},${Math.round(pos.getY(v) * 2e4)},${Math.round(pos.getZ(v) * 2e4)}`;
          const vs = at.get(key);
          if (vs) vs.push(v); else at.set(key, [v]);
        }
        let open = 0, shared = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        for (const vs of at.values()) for (let i = 1; i < vs.length; i++) {
          const d = a.fromBufferAttribute(nrm, vs[0]!).angleTo(b.fromBufferAttribute(nrm, vs[i]!));
          shared++;
          if (d > 0.1 && d < 1.5) open++;
        }
        expect(shared, `${p.look!.name} ${piece}: it has seams`).toBeGreaterThan(50);
        expect(open, `${p.look!.name} ${piece}: seam vertices with normals of their own`).toBeLessThan(8);
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

  // Epic's eye texture is one brown iris for all ten (119, 84, 36 of 255 in every build): each player's own colour is
  // cast.json's iris, which mh-player.py puts on the texture's fibres (white_of_eye). A colour an eye can be: brown has more
  // red than blue, a light eye more blue than a brown, none brighter than a pale grey-blue.
  it('look out of eyes of their own colour', () => {
    const cast = JSON.parse(readFileSync(new URL('../../tools/assets/metahuman/cast.json', import.meta.url), 'utf8')) as Record<string, { iris?: number[][] }>;
    const irises = Object.entries(cast).filter(([k]) => k !== '//').map(([k, c]) => {
      expect(c.iris, k).toBeTruthy();
      // (the build reads the stored spec, not cast-spec.mjs's: with the colour only in cast.json all ten came out brown)
      const spec = JSON.parse(readFileSync(new URL(`../../tools/assets/metahuman/people/${k}mh.json`, import.meta.url), 'utf8')) as { iris?: number[][] };
      expect(spec.iris, k).toEqual(c.iris);
      for (const ring of c.iris!) {
        expect(ring.length).toBe(3);
        expect(Math.max(...ring), k).toBeLessThan(0.7);
        expect(Math.max(...ring), k).toBeGreaterThan(0.2);
      }
      return c.iris![0]!;
    });
    expect(irises.length).toBe(10);
    expect(new Set(irises.map((c) => c.join())).size).toBeGreaterThanOrEqual(8);
    const light = irises.filter(([r, , b]) => b! > r!), brown = irises.filter(([r, , b]) => r! > b! * 2);
    expect(light.length).toBeGreaterThanOrEqual(2);
    expect(brown.length).toBeGreaterThanOrEqual(4);
  });
});
