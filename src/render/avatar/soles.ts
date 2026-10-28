// The soles of the player mesh's feet: a few points on each (heel, ball, toe tip, both edges) in their bone's frame,
// from the mesh's lowest foot vertices at the rest pose. The avatar keeps its feet on the floor with them; the animation QA measures
// skating and soles through the floor with the same points.
import * as THREE from 'three/webgpu';
import type { PlayerAsset } from './asset.ts';

export interface SolePoint { bone: number; local: THREE.Vector3 }

/** Points on each sole (heel, ball, toe tip, both edges), in their bone's frame, from the mesh's lowest vertices. */
export function fitSoles(asset: PlayerAsset): SolePoint[][] {
  const g = asset.geometry;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const out: SolePoint[][] = [];
  for (const side of ['Left', 'Right']) {
    const ids = new Set([asset.bone(side + 'Foot'), asset.bone(side + 'ToeBase'), asset.bone(side + 'Toe_End')]);
    const verts: Array<{ v: THREE.Vector3; bone: number }> = [];
    let minY = Infinity;
    for (let k = 0; k < asset.restPos.length / 3; k++) {
      let best = -1, bw = -1;
      for (let j = 0; j < 4; j++) { const w = sw.getComponent(k, j); if (w > bw) { bw = w; best = si.getComponent(k, j); } }
      if (!ids.has(best)) continue;
      const v = new THREE.Vector3().fromArray(asset.restPos, k * 3);
      verts.push({ v, bone: best });
      if (v.y < minY) minY = v.y;
    }
    const sole = verts.filter((x) => x.v.y < minY + 0.012);
    const pick = (f: (x: { v: THREE.Vector3 }) => number): { v: THREE.Vector3; bone: number } =>
      sole.reduce((m, x) => (f(x) > f(m) ? x : m), sole[0]!);
    const pts = [pick((x) => -x.v.z), pick((x) => x.v.z), pick((x) => x.v.x), pick((x) => -x.v.x)];
    out.push(pts.map((p) => {
      const inv = asset.restWorld[p.bone]!.clone().invert();
      // Measured from the floor the model stands on (its lowest sole vertex is the ground).
      const w = p.v.clone();
      w.y -= minY;
      return { bone: p.bone, local: w.applyMatrix4(inv) };
    }));
  }
  return out;
}

