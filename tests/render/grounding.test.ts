// Contact shadows (render/grounding.ts): dark under a foot pressed flat, gone from a foot in the air, shrinking to the
// end of the foot still down, and the body's patch gone in a jump.
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Grounding, type Grounded } from '../../src/render/grounding.ts';
import type { Avatar } from '../../src/render/avatar/avatar.ts';

/** A body with soles at (x, z), feet 0.3 m apart along x, pointing +z, 26 cm long and 9 cm wide. */
function body(lift: (f: number, k: number) => number): { b: Grounded; W: Float64Array } {
  const W = new Float64Array(24);
  for (let f = 0; f < 2; f++) {
    const x = f === 0 ? -0.15 : 0.15;
    const pts = [[x, -0.08], [x, 0.18], [x + 0.045, 0.05], [x - 0.045, 0.05]];
    for (let k = 0; k < 4; k++) {
      W[f * 12 + k * 3] = pts[k]![0]!;
      W[f * 12 + k * 3 + 1] = lift(f, k);
      W[f * 12 + k * 3 + 2] = pts[k]![1]!;
    }
  }
  const root = new THREE.Group();
  const avatar = { soleWorld: W, root } as unknown as Avatar;
  return { b: { avatar, root }, W };
}

/** Patch i's darkness, centre (x, z) and its size along its local z. */
function patch(g: Grounding, i: number): { dark: number; x: number; z: number; along: number } {
  const S = (g as unknown as { shade: THREE.InstancedBufferAttribute }).shade.array as Float32Array;
  const M = g.mesh.instanceMatrix.array as Float32Array;
  const o = i * 16;
  return { dark: S[i * 2]!, x: M[o + 12]!, z: M[o + 14]!, along: Math.hypot(M[o + 8]!, M[o + 10]!) };
}

describe('contact shadows', () => {
  it('darkens under feet on the floor and not under feet in the air', () => {
    const flat = body(() => 0);
    const g = new Grounding(new THREE.Scene(), [flat.b]);
    g.update();
    const body0 = patch(g, 0), left = patch(g, 1), right = patch(g, 2);
    expect(body0.dark).toBeGreaterThan(0.3);
    expect(left.dark).toBeGreaterThan(0.6);
    expect(right.dark).toBeCloseTo(left.dark, 6);
    expect(left.x).toBeCloseTo(-0.15, 6);
    // Centred on the sole, as long as it plus the spread.
    expect(left.z).toBeCloseTo(0.05, 3);
    expect(left.along).toBeGreaterThan(0.26);

    const oneUp = body((f) => (f === 1 ? 0.2 : 0));
    const h = new Grounding(new THREE.Scene(), [oneUp.b]);
    h.update();
    expect(patch(h, 2).dark).toBe(0);
    expect(patch(h, 1).dark).toBeGreaterThan(0.6);
  });

  it('moves to the toes as the heel lifts', () => {
    const heelUp = body((_f, k) => (k === 0 ? 0.08 : k === 1 ? 0 : 0.03));
    const g = new Grounding(new THREE.Scene(), [heelUp.b]);
    g.update();
    const p = patch(g, 1);
    expect(p.z).toBeGreaterThan(0.08);
    expect(p.along).toBeLessThan(0.3);
    expect(p.dark).toBeGreaterThan(0.6);
  });

  it('fades the body patch in a jump and hides a body that is not shown', () => {
    const jump = body(() => 0.6);
    const g = new Grounding(new THREE.Scene(), [jump.b]);
    g.update();
    expect(patch(g, 0).dark).toBe(0);
    expect(patch(g, 1).dark).toBe(0);
    const low = body(() => 0);
    low.b.root.visible = false;
    const h = new Grounding(new THREE.Scene(), [low.b]);
    h.update();
    expect(patch(h, 0).dark + patch(h, 1).dark + patch(h, 2).dark).toBe(0);
  });
});
