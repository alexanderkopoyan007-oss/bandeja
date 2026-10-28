// Phase 8: the arenas' lights are kept between matches (src/render/arena/lights.ts: three caches their uniforms'
// bind groups forever, so new lights each match leaked the old arena). A kept light must come out exactly as a new one.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ARENA_KEYS, arenaDef } from '../../src/render/arena/arena.ts';
import { addArenaLights, lightPool, pooledLight } from '../../src/render/arena/lights.ts';

type Snap = Record<string, unknown>;
const r5 = (v: THREE.Vector3): number[] => v.toArray().map((x) => +x.toFixed(5));
function snap(group: THREE.Group): Snap[] {
  const out: Snap[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const l = o as THREE.DirectionalLight & { groundColor?: THREE.Color };
    if (!l.isLight) return;
    const sh = l.castShadow ? l.shadow : null;
    out.push({
      type: l.type, color: l.color.getHex(), ground: l.groundColor?.getHex(), intensity: l.intensity, cast: l.castShadow,
      pos: r5(l.getWorldPosition(new THREE.Vector3())),
      target: l.target ? [r5(l.target.getWorldPosition(new THREE.Vector3())), l.target.parent === group] : null,
      shadow: sh ? { size: sh.mapSize.toArray(), bias: sh.bias, normalBias: sh.normalBias, radius: sh.radius,
        cam: [sh.camera.left, sh.camera.right, sh.camera.top, sh.camera.bottom, sh.camera.near, sh.camera.far] } : null,
    });
  });
  return out;
}

describe('arena lights kept between matches', () => {
  it('come out as new ones, whatever arena came before', () => {
    const fresh: Record<string, Snap[]> = {};
    lightPool.on = false;
    for (const k of ARENA_KEYS) { const g = new THREE.Group(); addArenaLights(g, arenaDef(k).light); fresh[k] = snap(g); }
    lightPool.on = true;
    const order = ['club-night', 'stadium', 'hall', 'club-day', 'club-night', 'hall', 'stadium', 'club-day'];
    let key: THREE.DirectionalLight | null = null;
    for (const k of order) {
      const g = new THREE.Group();
      const l = addArenaLights(g, arenaDef(k).light);
      expect(snap(g)).toEqual(fresh[k]);
      if (key) expect(l).toBe(key);
      key = l;
      // What a match does to its key light (the preset's shadow map or no shadow; anything else): the next match
      // starts afresh.
      l.castShadow = !l.castShadow;
      l.shadow.mapSize.set(512, 512);
      l.intensity = 99;
      l.position.set(1, 2, 3);
      l.target.position.set(4, 5, 6);
    }
  });
  it('a kept light leaves its last group', () => {
    const a = new THREE.Group(), b = new THREE.Group();
    const s1 = pooledLight('test-spot', () => new THREE.SpotLight());
    a.add(s1, s1.target);
    const s2 = pooledLight('test-spot', () => new THREE.SpotLight());
    expect(s2).toBe(s1);
    expect(s2.parent).toBeNull();
    expect(s2.target.parent).toBeNull();
    b.add(s2);
    expect(a.children).toHaveLength(0);
  });
});
