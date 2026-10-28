// Phase 8: tearing a game down frees what the renderer holds for it (tools/lifecycle.mjs measures it in Chrome).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { disposeTree } from '../../src/render/dispose.ts';

describe('disposeTree', () => {
  it("sends every object the dispose event the renderer's render objects listen for", () => {
    // A shadow pass draws a mesh with the light's shadow material, which nothing disposes: the render object for that
    // pass only goes when the mesh itself says it is disposed (Object3D.dispose() sends the event in three r186).
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
    const b = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardNodeMaterial());
    const light = new THREE.DirectionalLight();
    inner.add(b);
    root.add(a, inner, light);
    const told = new Set<THREE.Object3D>();
    for (const o of [a, b, inner, light]) o.addEventListener('dispose' as never, () => told.add(o));
    let geo = 0, mat = 0;
    for (const m of [a, b]) {
      m.geometry.addEventListener('dispose', () => geo++);
      (m.material as THREE.Material).addEventListener('dispose', () => mat++);
    }
    disposeTree(root);
    expect([...told]).toHaveLength(4);
    expect(geo).toBe(2);
    expect(mat).toBe(2);
  });
});
