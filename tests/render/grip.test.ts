// The racket as drawn and the hand on it (render/avatar/racket.ts, grip.ts): FIP's size limits, a continental grip whose fingers go
// round the handle, the same for either hand. The owner, 2026-11-01: "fix the grip, its not real at all". A test here had held the
// skin out of the handle, and the grip that passed it was a stick lying on an open hand: every joint but the fingertips 2-3 cm off it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { solveGrip } from '../../src/render/avatar/grip.ts';
import { HANDLE_R, HANDLE_TOP, makeRacketModel, racketHoles } from '../../src/render/avatar/racket.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

describe('racket and grip', () => {
  const a = asset();

  it('the racket is within the FIP limits and carries a perforated face', () => {
    const g = makeRacketModel();
    const box = new THREE.Box3().setFromObject(g);
    const s = box.getSize(new THREE.Vector3());
    expect(s.y).toBeLessThanOrEqual(0.455 + 1e-4);
    expect(s.y).toBeGreaterThan(0.45);
    expect(s.x).toBeLessThanOrEqual(0.26 + 1e-4);
    // The head (the handle's tape and cap are rounder than the face is thick).
    const P = (g.getObjectByName('racketNear') as THREE.Mesh).geometry.getAttribute('position');
    let z0 = 0, z1 = 0;
    for (let i = 0; i < P.count; i++) if (P.getY(i) > HANDLE_TOP + 0.006) { z0 = Math.min(z0, P.getZ(i)); z1 = Math.max(z1, P.getZ(i)); }
    expect(z1 - z0).toBeLessThanOrEqual(0.038 + 1e-4);
    expect(racketHoles().length).toBeGreaterThan(40);
  });

  it('the fingers close onto the handle and the hands mirror each other', () => {
    const r = solveGrip(a, 'Right'), l = solveGrip(a, 'Left');
    expect(r.gaps.length).toBe(15);
    for (let k = 0; k < r.gaps.length; k++) {
      // A joint centre is never inside the handle.
      expect(r.gaps[k]!).toBeGreaterThan(0);
      expect(Math.abs(r.gaps[k]! - l.gaps[k]!)).toBeLessThan(0.002);
    }
    // Closed on it from the middle joint out, not only at the tip (the index stays a little more open).
    for (const k of [0, 1, 2]) expect(r.gaps[k]!).toBeLessThan(0.034);
    for (const k of [3, 4, 5, 6, 7, 8, 9, 10, 11]) expect(r.gaps[k]!).toBeLessThan(0.024);
    // The racket in the hand: mirrored across the hand's frame.
    expect(r.wrist.x).toBeCloseTo(-l.wrist.x, 2);
    expect(r.wrist.y).toBeCloseTo(l.wrist.y, 2);
    // The heel of the hand on the butt, as a photo of the hold shows, not a third of the way up the handle.
    expect(r.wrist.y).toBeLessThan(-0.29);
  });

  it('the fingers go round the handle, and the thumb crosses the front to meet them', () => {
    const r = solveGrip(a, 'Right') as ReturnType<typeof solveGrip>;
    // Round the handle from the knuckle to the fingertip: over half a turn each (the stick on an open hand: 123 degrees).
    for (const w of r.wrap.slice(1, 3)) expect(w).toBeGreaterThan(Math.PI * 0.95);
    // The thumb's tip is across the front, past the fingers' tips.
    expect(r.thumbPast).toBeGreaterThan(0);
  });

  it('the posed hand presses on the handle and no deeper than a palm gives', () => {
    interface GV { hand: THREE.Bone; pos: THREE.Vector3; q: THREE.Quaternion; bones: number[]; quats: Float32Array }
    const av = new Avatar(a, 0xffffff) as unknown as { root: THREE.Object3D; bones: THREE.Bone[]; grips: GV[]; mesh: THREE.SkinnedMesh };
    for (const g of av.grips) {
      for (let k = 0; k < g.bones.length; k++) av.bones[g.bones[k]!]!.quaternion.fromArray(g.quats, k * 4);
    }
    av.root.updateMatrixWorld(true);
    av.mesh.skeleton.update();
    for (const g of av.grips) {
      const inv = g.hand.matrixWorld.clone().multiply(new THREE.Matrix4().compose(g.pos, g.q, new THREE.Vector3(1, 1, 1))).invert();
      const P = av.mesh.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      let inside = 0, deepest = 0;
      for (let i = 0; i < P.count; i++) {
        av.mesh.getVertexPosition(i, v);
        v.applyMatrix4(av.mesh.matrixWorld).applyMatrix4(inv);
        if (v.y > -0.17 || v.y < -0.31) continue;
        const d = HANDLE_R - Math.hypot(v.x, v.z);
        if (d > 0) { inside++; deepest = Math.max(deepest, d); }
      }
      // (The palm has no bones to cup with, so the handle goes down into it: 7-14 mm by design, under the handle where it doesn't show.)
      expect(inside).toBeLessThan(140);
      expect(deepest).toBeLessThan(0.0135);
    }
  });
});
