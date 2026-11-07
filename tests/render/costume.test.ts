// M5 phase C: what is worn beyond the suit, made in code and fitted to each person (src/render/avatar/costume.ts): caps
// and bands over the head and its hair, sunglasses clear of the face, wristbands round the forearm, and a modelled
// headband taken off when something else is worn.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople, guestAsset, GUESTS } from './people.ts';
import { clothTable, dress, fitHead, pressHair, radius, worn, HEAD_PIECES, HEADWEAR, type HeadFit } from '../../src/render/avatar/costume.ts';
import { kitFor } from '../../src/render/avatar/kit.ts';
import { modelledVertices, type PlayerAsset } from '../../src/render/avatar/asset.ts';

const base = mannequinWithPeople();
const guests = new Set(GUESTS.map((g) => guestAsset(g, base)));
const everyone: PlayerAsset[] = [...base.people, ...guests];
const nameOf = (p: PlayerAsset): string => p.look!.name;
const look = kitFor(0);

/**
 * A body's vertices weighted at least `min` to these bones (bind pose), without a modelled headband or visor (in the
 * socks' part, high on the head: hidden whenever something else is worn on the head).
 */
function verts(p: PlayerAsset, bones: string[], min = 0.5): THREE.Vector3[] {
  const g = p.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const partA = g.getAttribute('bodyA');
  const ids = bones.map((b) => p.bone(b));
  const out: THREE.Vector3[] = [];
  const mine = modelledVertices(p);
  for (let i = 0; i < pos.count; i++) {
    if (!mine[i] || (p.look?.kit.head && partA && partA.getW(i) > 0.5 && pos.getY(i) > 1.4)) continue;
    let w = 0;
    for (let k = 0; k < 4; k++) if (ids.includes(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if (w >= min) out.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  }
  return out;
}

const polar = (f: HeadFit, v: THREE.Vector3): [number, number, number] => {
  const d = v.clone().sub(f.c), r = d.length();
  return [Math.atan2(d.x, d.z), Math.asin(d.y / r), r];
};

/** A piece's vertices in the bind pose (its matrix is the bone's inverse bind matrix: undo it). */
function bindVerts(m: THREE.Mesh, p: PlayerAsset, bone: string): THREE.Vector3[] {
  // (a skinned piece is in the bind pose as it is)
  const back = (m as THREE.SkinnedMesh).isSkinnedMesh ? new THREE.Matrix4() : p.boneInverses[p.bone(bone)]!.clone().invert().multiply(m.matrix);
  const pos = m.geometry.getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(back));
}

describe('costume: fitting', () => {
  it('finds every person\'s head and eyes', () => {
    for (const p of everyone) {
      const f = fitHead(p)!;
      expect(f, nameOf(p)).not.toBeNull();
      expect(f.eyeL.x, nameOf(p)).toBeGreaterThan(0.02);
      expect(f.eyeR.x, nameOf(p)).toBeLessThan(-0.02);
      expect(f.eyeL.x - f.eyeR.x, nameOf(p)).toBeLessThan(0.085);
      expect(Math.abs(f.eyeL.y - f.eyeR.y), nameOf(p)).toBeLessThan(0.01);
      // The eyes are near the top of a standing person, in front of the head's centre.
      expect(f.eyeL.y / p.look!.height, nameOf(p)).toBeGreaterThan(0.86);
      expect(f.eyeL.z, nameOf(p)).toBeGreaterThan(f.c.z + 0.04);
    }
    expect(fitHead(base)).toBeNull();
  });

  it('a cap covers the scalp, and the hair under it is pressed in under the cloth', () => {
    for (const p of everyone) {
      const f = fitHead(p)!;
      const eyeY = (f.eyeL.y + f.eyeR.y) / 2;
      const hw = HEADWEAR['head-cap']!;
      const t = clothTable(f, hw.under);
      const [mesh] = dress(p, { head: 'head-cap' }, look);
      expect(mesh!.bone).toBe('Head');
      const edge = (az: number): number => eyeY + hw.front + (hw.back - hw.front) * (1 - Math.cos(az)) / 2;
      // The cap's dome is 6 mm off the cloth table; every scalp vertex above its edge line is under it.
      let over = 0, n = 0;
      for (const v of verts(p, ['Head'])) {
        const [az, el, r] = polar(f, v);
        if (v.y < edge(az) + 0.004) continue;
        n++;
        if (r > radius(t, az, el) + 0.006 - 0.001) over++;
      }
      expect(n, nameOf(p)).toBeGreaterThan(200);
      expect(over / n, nameOf(p)).toBeLessThan(0.002);
      // The hair above the edge, pressed, is inside the cap too.
      const pressed = pressHair(p, 'head-cap');
      if (!pressed) continue;
      let out = 0, m = 0;
      for (let i = 0; i < pressed.length; i += 3) {
        const v = new THREE.Vector3(pressed[i], pressed[i + 1], pressed[i + 2]);
        const [az, el, r] = polar(f, v);
        if (v.y < edge(az) + 0.002 || r > 0.2) continue;
        m++;
        if (r > radius(t, az, el) + 0.006) out++;
      }
      expect(out / Math.max(1, m), nameOf(p)).toBeLessThan(0.01);
    }
  });

  it('pressing leaves the brows, the lashes and the hair clear of the piece where they were', () => {
    let moved = 0;
    for (const p of base.people) for (const id of ['head-band', 'head-cap']) {
      const pressed = pressHair(p, id);
      if (!pressed) continue;
      const f = fitHead(p)!, hw = HEADWEAR[id]!;
      const eyeY = (f.eyeL.y + f.eyeR.y) / 2;
      const pos = p.look!.alphaGeometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const [az, el, r] = polar(f, v);
        const lo = eyeY + hw.front + (hw.back - hw.front) * (1 - Math.cos(az)) / 2;
        const clear = v.y < lo - 0.0121 || (hw.up !== null && v.y > lo + hw.up + 0.0121) || r < radius(f.skin, az, el) + 0.003;
        const same = pressed[i * 3] === v.x && pressed[i * 3 + 1] === v.y && pressed[i * 3 + 2] === v.z;
        if (clear) expect(same, `${id} ${nameOf(p)}`).toBe(true);
        else if (!same) moved++;
      }
    }
    expect(moved).toBeGreaterThan(1000);
  });

  it('sunglasses sit in front of the eyes, clear of the face', () => {
    for (const style of ['eyes-wrap', 'eyes-round', 'eyes-shield']) for (const p of everyone) {
      const f = fitHead(p)!;
      const [lens] = dress(p, { eyes: style }, look);
      const lv = bindVerts(lens!.mesh, p, 'Head');
      const face = verts(p, ['Head']).filter((v) => v.z > f.c.z && Math.abs(v.y - f.eyeL.y) < 0.04);
      // Nearest face vertex from each lens vertex.
      let close = 0;
      for (const a of lv) {
        let d = Infinity;
        for (const b of face) d = Math.min(d, a.distanceToSquared(b));
        if (Math.sqrt(d) < 0.003) close++;
      }
      expect(close / lv.length, `${style} ${nameOf(p)}`).toBeLessThan(0.02);
      // In front of each eye: lens there, standing off it (the MPFB eye is the eyeball's middle, the Meshy one its
      // painted surface), and not far off.
      for (const e of [f.eyeL, f.eyeR]) {
        const front = lv.filter((v) => Math.abs(v.x - e.x) < 0.008 && Math.abs(v.y - e.y) < 0.008);
        expect(front.length, `${style} ${nameOf(p)}`).toBeGreaterThan(0);
        for (const v of front) {
          expect(v.z - e.z, `${style} ${nameOf(p)}`).toBeGreaterThan(0.008);
          expect(v.z - e.z, `${style} ${nameOf(p)}`).toBeLessThan(0.04);
        }
      }
    }
  });

  it('a wristband goes round the forearm above the wrist, on the racket arm unless they are a pair', () => {
    for (const p of everyone) {
      const pieces = dress(p, { wrist: 'wrist-single' }, look);
      expect(pieces.map((x) => x.side).sort(), nameOf(p)).toEqual(['L', 'R']);
      expect(pieces.every((x) => x.arm === 'racket')).toBe(true);
      expect(dress(p, { wrist: 'wrist-pair' }, look).every((x) => x.arm === undefined)).toBe(true);
      for (const piece of pieces) {
        const side = piece.side === 'R' ? 'Right' : 'Left';
        const A = new THREE.Vector3().setFromMatrixPosition(p.boneInverses[p.bone(`${side}ForeArm`)]!.clone().invert());
        const B = new THREE.Vector3().setFromMatrixPosition(p.boneInverses[p.bone(`${side}Hand`)]!.clone().invert());
        const axis = A.clone().sub(B).normalize();
        const u = new THREE.Vector3(0, 1, 0).cross(axis).normalize(), w = axis.clone().cross(u);
        const radial = (v: THREE.Vector3): number => v.clone().sub(B).projectOnPlane(axis).length();
        const angle = (v: THREE.Vector3): number => { const d = v.clone().sub(B); return Math.atan2(d.dot(w), d.dot(u)); };
        const along = (v: THREE.Vector3): number => v.clone().sub(B).dot(axis);
        const band = bindVerts(piece.mesh, p, `${side}ForeArm`);
        const skin = verts(p, [`${side}ForeArm`, `${side}Hand`]).filter((v) => along(v) > 0.03 && along(v) < 0.085 && radial(v) < 0.08);
        expect(skin.length, nameOf(p)).toBeGreaterThan(20);
        // Round the arm, angle by angle and along it: no forearm vertex in the band's length further out than the band's
        // inside there (give or take a millimetre).
        const near = (v: THREE.Vector3): number[] => band.filter((b) => Math.abs(along(b) - along(v)) < 0.0045 && Math.abs(Math.atan2(Math.sin(angle(b) - angle(v)), Math.cos(angle(b) - angle(v)))) < 0.12).map(radial);
        const gaps: number[] = [];
        for (const v of skin) {
          const inside = Math.min(...near(v));
          expect(radial(v), nameOf(p)).toBeLessThan(inside + 0.001);
          gaps.push(inside - radial(v));
        }
        // Hugging it: half the arm within 3 mm of the band's inside, none past 8 mm (a Meshy guest's lumpier arm 7 mm and
        // 16 mm). One size for its whole length stood 2 cm off the wrist.
        gaps.sort((a, b) => a - b);
        const [half, most] = guests.has(p) ? [0.007, 0.016] : [0.003, 0.008];
        expect(gaps[gaps.length >> 1]!, nameOf(p)).toBeLessThan(half);
        expect(gaps[gaps.length - 1]!, nameOf(p)).toBeLessThan(most);
        // Skinned as the arm is, so it turns with the wrist where the skin does: weights summing to one, on the forearm
        // and the hand, the hand's share growing towards the wrist.
        const m = piece.mesh as THREE.SkinnedMesh;
        expect(m.isSkinnedMesh && piece.skinned).toBe(true);
        const bi = m.geometry.getAttribute('skinIndex'), bw = m.geometry.getAttribute('skinWeight');
        const fore = p.bone(`${side}ForeArm`), hand = p.bone(`${side}Hand`);
        let handNear = 0, handFar = 0, nNear = 0, nFar = 0;
        for (let i = 0; i < bi.count; i++) {
          let sum = 0, h = 0, arm = 0;
          for (let c = 0; c < 4; c++) {
            const b = bi.getComponent(i, c), x = bw.getComponent(i, c);
            sum += x;
            if (b === hand) h += x;
            if (b === hand || b === fore) arm += x;
          }
          expect(sum).toBeCloseTo(1, 4);
          expect(arm, nameOf(p)).toBeGreaterThan(0.5);
          const a = along(band[i]!);
          if (a < 0.035) { handNear += h; nNear++; } else if (a > 0.075) { handFar += h; nFar++; }
        }
        expect(handNear / nNear, nameOf(p)).toBeGreaterThan(handFar / nFar);
      }
    }
  });
});

describe('costume: dressing', () => {
  it('every head piece is built for everyone, on the head bone, at its inverse bind matrix', () => {
    for (const p of everyone) for (const id of HEAD_PIECES) {
      const pieces = dress(p, { head: id }, look);
      expect(pieces.length, `${id} ${nameOf(p)}`).toBe(1);
      const m = pieces[0]!.mesh;
      expect(m.matrixAutoUpdate).toBe(false);
      expect(m.matrix.equals(p.boneInverses[p.bone('Head')]!)).toBe(true);
      const pos = m.geometry.getAttribute('position').array as Float32Array;
      expect(pos.every(Number.isFinite), `${id} ${nameOf(p)}`).toBe(true);
    }
    expect(dress(base, { head: 'head-cap', eyes: 'eyes-wrap' }, look)).toEqual([]);
  });

  it('the wristbands painted on the skin stay unless the wrist slot is chosen (a band to wear, or none)', () => {
    const p = everyone[0]!;
    expect(worn(p, {}, look, null).paintedWrists).toBe(true);
    expect(worn(p, { head: 'head-cap' }, look, null).paintedWrists).toBe(true);
    expect(worn(p, { wrist: 'wrist-single' }, look, null).paintedWrists).toBe(false);
    expect(worn(p, { wrist: null }, look, null).paintedWrists).toBe(false);
  });

  it('a modelled headband or visor stays when it is what is worn, and comes off for anything else', () => {
    const banded = everyone.filter((p) => p.look!.kit.head);
    expect(banded.length).toBeGreaterThan(0);
    for (const p of banded) {
      const own = `head-${p.look!.kit.head}`;
      const index = new THREE.BufferAttribute(p.look!.face ? p.look!.face.bodyIndex : (p.geometry.index!.array as Uint32Array), 1);
      expect(worn(p, { head: own }, look, index)).toEqual({ pieces: [], bodyIndex: null, hair: null, paintedWrists: true });
      const { pieces, bodyIndex: cut } = worn(p, { head: 'head-cap' }, look, index);
      expect(pieces.length).toBe(1);
      expect(cut, nameOf(p)).not.toBeNull();
      const removed = (index.count - cut!.count) / 3;
      expect(removed, nameOf(p)).toBeGreaterThan(50);
      // Only the band: nothing else lost (the triangles cut all touch a sock-part vertex high on the head).
      const partA = p.geometry.getAttribute('bodyA'), pos = p.geometry.getAttribute('position');
      const kept = new Set<string>();
      for (let t = 0; t < cut!.count; t += 3) kept.add([cut!.getX(t), cut!.getX(t + 1), cut!.getX(t + 2)].join());
      for (let t = 0; t < index.count; t += 3) {
        const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        if (kept.has(tri.join())) continue;
        expect(tri.some((v) => partA.getW(v) > 0.5 && pos.getY(v) > 1.4), nameOf(p)).toBe(true);
      }
      // Bare-headed: off, nothing on.
      const { pieces: none, bodyIndex: bare } = worn(p, { head: null }, look, index);
      expect(none).toEqual([]);
      expect(bare!.count).toBe(cut!.count);
    }
    // What goes on instead fits the head, not the one taken off: a headband on someone modelled with a visor once
    // stood 9 cm off her forehead, round the visor's hidden brim.
    for (const p of banded) {
      const front = bindVerts(dress(p, { head: 'head-band' }, look)[0]!.mesh, p, 'Head').filter((v) => Math.abs(v.x) < 0.01);
      const lo = Math.min(...front.map((v) => v.y)), hi = Math.max(...front.map((v) => v.y));
      const skinZ = Math.max(...verts(p, ['Head']).filter((v) => Math.abs(v.x) < 0.01 && v.y > lo && v.y < hi).map((v) => v.z));
      expect(Math.max(...front.map((v) => v.z)) - skinZ, nameOf(p)).toBeLessThan(0.02);
    }
    // Someone modelled bare-headed keeps every triangle.
    const plain = everyone.find((p) => !p.look!.kit.head && p.look!.face)!;
    const idx = new THREE.BufferAttribute(plain.look!.face!.bodyIndex, 1);
    expect(worn(plain, { head: 'head-visor' }, look, idx).bodyIndex).toBeNull();
  });
});
