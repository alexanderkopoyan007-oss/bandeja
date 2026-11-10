// The court cameras look through a back glass from just behind it without its seam posts (courtView.ts hideBackPosts):
// only that end's seam posts go, and they come back exactly as built.
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { buildCourtView } from '../../src/render/courtView.ts';

// (the glass's smudge texture is drawn on a canvas: a stand-in that takes any drawing)
const anyCall: unknown = new Proxy(() => anyCall, { get: (_t, k) => (k === 'canvas' ? {} : anyCall), apply: () => anyCall, set: () => true });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => anyCall }) });

function frameOf(g: THREE.Group): THREE.InstancedMesh {
  let m: THREE.InstancedMesh | null = null;
  g.traverse((o) => { if (!m && (o as THREE.InstancedMesh).isInstancedMesh && o.parent === g) m = o as THREE.InstancedMesh; });
  return m!;
}

describe('the back glass seen from behind', () => {
  it('leaves out one end\'s seam posts, and only those, and puts them back as built', () => {
    const court = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] }).world.court;
    const view = buildCourtView(court);
    const m = frameOf(view.group);
    const before = Float32Array.from(m.instanceMatrix.array as Float32Array);
    const at = (i: number): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(before, i * 16));
    const scaleOf = (i: number): number => new THREE.Matrix4().fromArray(m.instanceMatrix.array as Float32Array, i * 16).getMaxScaleOnAxis();
    for (const end of [1, -1]) {
      view.hideBackPosts(end);
      let gone = 0;
      for (let i = 0; i < m.count; i++) {
        const p = at(i);
        const seam = Math.abs(Math.abs(p.z) - court.halfL) < 0.1 && Math.sign(p.z) === end && Math.abs(p.x) < court.halfW && p.y > 1;
        if (scaleOf(i) === 0) {
          gone++;
          // (a post at a seam of that end's back glass: tall, thin, at the glass line)
          expect(seam, `instance ${i} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
        }
      }
      // a framed court's back wall: a post at each seam between its glass panels
      expect(court.seams[0]!.length).toBeGreaterThan(0);
      expect(gone).toBe(court.seams[0]!.length);
      view.hideBackPosts(0);
      expect(Array.from(m.instanceMatrix.array as Float32Array)).toEqual(Array.from(before));
    }
  });
});
