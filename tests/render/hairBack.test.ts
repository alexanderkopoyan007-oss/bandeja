// Long hair on the back as the body is posed (hairBack.ts): the map of the back seen from behind, and the push that sets hair
// lying on the back behind it. The realism list's point 5: hair resting on the back went in and out of the shirt, black
// islands with hard edges in close views, because the capsules (kit.ts) are a centimetre off the shirt in places.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople, metaHumansHere } from './people.ts';
import { hairHang } from '../../src/render/avatar/kit.ts';
import { BACK_NONE, backBody, backPush, drawBack, sampleBack, type BackBody } from '../../src/render/avatar/hairBack.ts';
import type { PlayerAsset } from '../../src/render/avatar/asset.ts';

function longHaired(): { p: PlayerAsset; body: BackBody }[] {
  const base = mannequinWithPeople();
  const out: { p: PlayerAsset; body: BackBody }[] = [];
  for (const p of [...base.people, ...metaHumansHere(base)]) {
    const body = backBody(p, hairHang(p));
    expect(body !== null, p.look!.name).toBe(hairHang(p) !== null);
    if (body) out.push({ p, body });
  }
  expect(out.length).toBeGreaterThan(1);
  return out;
}

/** The body over the back skinned by `from` (per skeleton bone, the modelled pose to this one; identity if absent), into the
 * map's frame (Spine2's joint carried by Spine2's), drawn. */
function posedMap(body: BackBody, from: Map<number, THREE.Matrix4>): { depth: Float32Array; frame: THREE.Matrix4 } {
  const I = new THREE.Matrix4(), M = (b: number): THREE.Matrix4 => from.get(b) ?? I;
  const frame = M(body.bone).clone().multiply(new THREE.Matrix4().makeTranslation(body.origin.x, body.origin.y, body.origin.z));
  const to = frame.clone().invert(), at = new Float32Array(body.verts.length * 3), v = new THREE.Vector3(), r = new THREE.Vector3();
  for (let k = 0; k < body.verts.length; k++) {
    r.fromArray(body.rest, k * 3);
    v.set(0, 0, 0);
    for (let c = 0; c < 4; c++) v.addScaledVector(r.clone().applyMatrix4(M(body.bones[body.skin[k * 4 + c]!]!)), body.weight[k * 4 + c]!);
    v.applyMatrix4(to).toArray(at, k * 3);
  }
  const depth = new Float32Array(body.nx * body.ny);
  drawBack(body, at, depth, new Float32Array(depth.length));
  return { depth, frame };
}

describe('long hair on the back as posed', () => {
  it('maps the back seen from behind: the shirt, smooth, and nothing past its edge', () => {
    for (const { p, body } of longHaired()) {
      const name = p.look!.name, d = body.restDepth;
      // the middle of the upper back, 10 cm under Spine2's joint: behind the joint, as the body's most-back point there is
      const zb = sampleBack(body, d, 0, -0.1);
      let back = Infinity;
      for (const k of body.verts.keys()) {
        const x = body.rest[k * 3]! - body.origin.x, y = body.rest[k * 3 + 1]! - body.origin.y;
        if (Math.abs(x) < 0.01 && Math.abs(y + 0.1) < 0.01) back = Math.min(back, body.rest[k * 3 + 2]! - body.origin.z);
      }
      expect(zb, name).toBeLessThan(-0.04);
      expect(Math.abs(zb - back), name).toBeLessThan(0.004);
      // across the upper back, no step between neighbouring cells over 3 cm (no holes, no stray faces; a hole is a metre)
      for (let j = 1; j < body.ny - 1; j++) for (let i = 1; i < body.nx - 2; i++) {
        const k = j * body.nx + i, x = body.x0 + i * body.cell, y = body.y0 + j * body.cell;
        if (Math.abs(x) > 0.1 || y > -0.02 || y < -0.2) continue;
        expect(Math.abs(d[k + 1]! - d[k]!), `${name} at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBeLessThan(0.03);
      }
      // off the map, no body
      expect(sampleBack(body, d, 0, body.y0 + body.cell * (body.ny + 5))).toBe(BACK_NONE);
      expect(sampleBack(body, d, 1, -0.1)).toBe(BACK_NONE);
    }
  });

  it('leaves hair as modelled where it is', () => {
    for (const { p, body } of longHaired()) {
      const hp = p.look!.alphaGeometry.getAttribute('position');
      let on = 0;
      for (let v = 0; v < hp.count; v++) {
        const x = hp.getX(v) - body.origin.x, y = hp.getY(v) - body.origin.y, z = hp.getZ(v) - body.origin.z;
        const push = backPush(body.hairClear[v]!, sampleBack(body, body.restDepth, x, y) - z);
        expect(Math.abs(push), `${p.look!.name} strand ${v}`).toBeLessThan(1e-9);
        if (body.hairClear[v]! < BACK_NONE) on++;
      }
      // (and some of it lies over the back)
      expect(on, p.look!.name).toBeGreaterThan(100);
    }
  });

  it('sets hair just inside the back behind it, in order, and leaves deeper hair to the capsules', () => {
    for (const clear of [0.0035, 0.005, 0.02, 0.1]) {
      const floor = Math.min(0.003, clear - 0.002);
      let last = -Infinity;
      for (let out = -0.03; out <= 0.03; out += 0.0005) {
        const push = backPush(clear, out), end = out + push;
        expect(push).toBeGreaterThanOrEqual(0);
        // just inside (or just behind): set behind the back, no nearer than where it was modelled allows
        if (out >= -0.01) expect(end).toBeGreaterThanOrEqual(floor - 1e-9);
        // deeper than BACK_DEPTH: the capsules'
        if (out <= -0.02) expect(push).toBe(0);
        // the layers keep their order over the full push
        if (out >= -0.01) { expect(end).toBeGreaterThanOrEqual(last - 1e-12); last = end; }
        // never past where it was modelled from the back, unless it was already
        expect(end).toBeLessThanOrEqual(Math.max(out, clear) + 1e-9);
      }
    }
    // not over the back as modelled: never
    expect(backPush(BACK_NONE, -0.005)).toBe(0);
  });

  it('follows the back as the pose bends it: a strand 1 cm inside the posed back ends behind it', () => {
    for (const { p, body } of longHaired()) {
      const name = p.look!.name, b = p.bone('Spine1'), j = new THREE.Vector3().setFromMatrixPosition(p.restWorld[b]!);
      // a hunch: Spine1 forward 20 degrees, the shoulders up and forward 15 (an overhead's reach goes the other way: both)
      for (const sign of [1, -1]) {
        const turn = (at: THREE.Vector3, m: THREE.Matrix4): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
        const from = new Map<number, THREE.Matrix4>([[b, turn(j, new THREE.Matrix4().makeRotationX(sign * 20 * Math.PI / 180))]]);
        for (const side of ['LeftShoulder', 'RightShoulder']) {
          const s = p.bone(side), sj = new THREE.Vector3().setFromMatrixPosition(p.restWorld[s]!);
          from.set(s, turn(sj, new THREE.Matrix4().makeRotationX(sign * 15 * Math.PI / 180)));
        }
        const { depth, frame } = posedMap(body, from);
        const to = frame.clone().invert(), back = new THREE.Vector3(0, 0, -1).transformDirection(frame);
        // the posed body's own vertices over the back, each with a strand 1 cm inside it along the map's z
        let n = 0, behind = 0;
        const v = new THREE.Vector3(), r = new THREE.Vector3(), q = new THREE.Vector3();
        for (let k = 0; k < body.verts.length; k++) {
          r.fromArray(body.rest, k * 3);
          v.set(0, 0, 0);
          for (let c = 0; c < 4; c++) v.addScaledVector(r.clone().applyMatrix4(from.get(body.bones[body.skin[k * 4 + c]!]!) ?? new THREE.Matrix4()), body.weight[k * 4 + c]!);
          const m = v.clone().applyMatrix4(to), zb = sampleBack(body, depth, m.x, m.y);
          // only where this vertex is the back (not under the shirt or the far side)
          if (zb >= BACK_NONE * 0.5 || Math.abs(zb - m.z) > 0.002) continue;
          q.copy(v).addScaledVector(back, -0.01);
          const qm = q.clone().applyMatrix4(to);
          q.addScaledVector(back, backPush(0.01, sampleBack(body, depth, qm.x, qm.y) - qm.z));
          const after = q.applyMatrix4(to);
          if (sampleBack(body, depth, after.x, after.y) - after.z > 0.002) behind++;
          n++;
        }
        expect(n, `${name} ${sign}`).toBeGreaterThan(60);
        expect(behind / n, `${name} ${sign}`).toBeGreaterThan(0.97);
      }
    }
  });
});
