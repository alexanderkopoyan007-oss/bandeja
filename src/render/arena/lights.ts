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

/** The key light (the sun, or the roof's main lights; it casts the shadows) and the hemisphere fill, added to `group`. */
export function addArenaLights(group: THREE.Group, L: LightDef): THREE.DirectionalLight {
  const hemi = pooledLight('hemi', () => new THREE.HemisphereLight());
  hemi.color.set(L.hemi.sky);
  hemi.groundColor.set(L.hemi.ground);
  hemi.intensity = L.hemi.intensity;
  group.add(hemi);
  const key = pooledLight('key', () => new THREE.DirectionalLight());
  key.color.set(L.key.color);
  key.intensity = L.key.intensity;
  const kd = new THREE.Vector3().fromArray(L.key.dir).normalize();
  key.position.copy(kd).multiplyScalar(30);
  key.castShadow = L.key.shadow && L.key.intensity > 0;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = L.key.radius;
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 2, far: 70 });
  group.add(key);
  group.add(key.target);
  return key;
}
