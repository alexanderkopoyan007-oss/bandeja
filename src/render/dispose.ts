// Freeing a scene's GPU resources when a game is torn down (Phase 8: back to the menu, a new match). Geometries,
// materials, the textures materials hold as properties, instanced and skinned meshes' buffers and lights' shadow
// maps. Textures used only inside TSL nodes are freed by their owners (NetView, Arena). Anything shared between
// games (the player body's geometry, cached textures) is safe to free: three uploads it again on its next use.
import * as THREE from 'three/webgpu';

export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<object>();
  const tex = (v: unknown): void => {
    if (v && (v as THREE.Texture).isTexture && !seen.has(v as object)) {
      seen.add(v as object);
      (v as THREE.Texture).dispose();
    }
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) tex(v);
      mat.dispose();
    }
    // InstancedMesh (instance buffers), SkinnedMesh (bone texture), lights (shadow maps).
    const d = (o as unknown as { dispose?: () => void }).dispose;
    if (typeof d === 'function' && !(o as THREE.Scene).isScene) d.call(o);
  });
}
