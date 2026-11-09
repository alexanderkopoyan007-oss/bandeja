// M5 phase D: a player's own skin and hair (kit.ts SelfLook) as the shader takes them: uniforms every person has, so no
// new shader program and live changes on the creator's turntable.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { applySelf, skinTint, type KitState } from '../../src/render/avatar/kit.ts';

describe('a player’s own skin and hair', () => {
  it('the tint is none at 0, darker with blue taken most, lighter with blue given most, and even along the way', () => {
    expect(skinTint(0).toArray()).toEqual([1, 1, 1]);
    const dark = skinTint(-1), light = skinTint(1);
    expect(dark.x).toBeLessThan(1);
    expect(dark.z).toBeLessThan(dark.y);
    expect(dark.y).toBeLessThan(dark.x);
    // darkest: a fair skin to a mid brown (red and green kept at 0.35-0.45 of theirs)
    expect(dark.x).toBeGreaterThan(0.35);
    expect(dark.y).toBeLessThan(0.45);
    expect(light.x).toBeGreaterThan(1);
    expect(light.z).toBeGreaterThan(light.y);
    let was = skinTint(-1).y;
    for (let t = -0.9; t <= 1.0001; t += 0.1) {
      const now = skinTint(t).y;
      expect(now).toBeGreaterThan(was);
      was = now;
    }
  });

  it('applySelf sets the uniforms: tint and dye, and both back to none', () => {
    const state = { self: { skin: { value: new THREE.Vector3(1, 1, 1) }, hair: { value: new THREE.Vector4() } } } as unknown as KitState;
    applySelf(state, { skin: -0.5, hair: [0.4, 0.2, 0.1] });
    expect(state.self!.skin.value.toArray()).toEqual(skinTint(-0.5).toArray());
    expect(state.self!.hair.value.toArray()).toEqual([0.4, 0.2, 0.1, 1]);
    applySelf(state, null);
    expect(state.self!.skin.value.toArray()).toEqual([1, 1, 1]);
    expect(state.self!.hair.value.w).toBe(0);
    // (a material without them, the mannequin's, is left alone)
    expect(() => applySelf({} as KitState, { skin: 1, hair: null })).not.toThrow();
  });
});
