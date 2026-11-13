// The arenas' lights, kept between matches (Phase 8).
import * as THREE from 'three/webgpu';
import type { LightDef } from './arena.ts';

/**
 * The lights are the same objects match after match. three r186 caches the bind groups of shared uniform groups (the
 * lights' uniforms among them) per render context and never frees them (NodeBuilder's `_bindingGroupsCache`); the
 * contexts live as long as the renderer. New lights each match were new uniform nodes, so new entries, and each
 * entry's uniform -> light -> parent kept that match's whole arena alive: 0.8 MB of heap and 3.3 MB of buffers a
 * match (`tools/lifecycle.mjs`; `LEAK=1` prints the path). With the same lights the entries repeat and the old arena
 * goes. Whoever takes a light sets every property it uses.
 */
const LIGHTS = new Map<string, THREE.Light>();
/** Tests: `on = false` makes every light new (what a kept light is compared with). */
export const lightPool = { on: true };
/** A pooled light or a pooled light's target (render/dispose.ts leaves them alone). */
export function isPooled(o: THREE.Object3D): boolean {
  for (const l of LIGHTS.values()) if (l === o || (l as unknown as { target?: THREE.Object3D }).target === o) return true;
  return false;
}

export function pooledLight<T extends THREE.Light>(key: string, make: () => T): T {
  let l = lightPool.on ? LIGHTS.get(key) as T | undefined : undefined;
  if (!l) {
    l = make();
    if (lightPool.on) LIGHTS.set(key, l);
  }
  l.removeFromParent();
  const t = (l as unknown as { target?: THREE.Object3D }).target;
  if (t) { t.removeFromParent(); t.position.set(0, 0, 0); }
  return l;
}

/** The detail pass's rig (arena/surface.ts): where the second half of an indoor arena's key comes from, across the court from the first. */
const CROSS = { first: [0.5, 1, 0.55], second: [-0.45, 1, -0.3], share: 0.6 };

/**
 * The key light (the sun, or the roof's main lights; it casts the shadows) and the hemisphere fill, added to `group`.
 * `crossed` (the detail pass, indoors): the key comes from two sides of the roof, as a hall's rows of floods do, so a
 * player throws two soft shadows that cross under them and neither side of a body is unlit. The same light in all.
 */
export function addArenaLights(group: THREE.Group, L: LightDef, crossed = false): THREE.DirectionalLight[] {
  const hemi = pooledLight('hemi', () => new THREE.HemisphereLight());
  hemi.color.set(L.hemi.sky);
  hemi.groundColor.set(L.hemi.ground);
  hemi.intensity = L.hemi.intensity;
  group.add(hemi);
  const one = (name: string, dir: number[], intensity: number): THREE.DirectionalLight => {
    const key = pooledLight(name, () => new THREE.DirectionalLight());
    key.color.set(L.key.color);
    key.intensity = intensity;
    const kd = new THREE.Vector3().fromArray(dir).normalize();
    key.position.copy(kd).multiplyScalar(30);
    key.castShadow = L.key.shadow && intensity > 0;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = crossed ? L.key.radius * 1.5 : L.key.radius;
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 2, far: 70 });
    group.add(key);
    group.add(key.target);
    return key;
  };
  if (!crossed) return [one('key', L.key.dir, L.key.intensity)];
  return [one('key', CROSS.first, L.key.intensity * CROSS.share), one('key2', CROSS.second, L.key.intensity * (1 - CROSS.share) * 1.1)];
}
