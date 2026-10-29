// Racket geometry stats per look (node): triangles near/far, draw calls, size, holes.
import * as THREE from 'three/webgpu';
import { RACKET_LOOKS, makeRacketModel, racketCost, racketShape } from '../src/render/avatar/racket.ts';

for (const look of RACKET_LOOKS) {
  const g = makeRacketModel(look);
  const c = racketCost(g);
  const box = new THREE.Box3().setFromObject(g);
  const s = box.getSize(new THREE.Vector3());
  const sh = racketShape(look);
  console.log(look.name, look.shape, 'tris', c.triangles, 'far', c.farTriangles, 'calls', c.drawCalls,
    'size', s.toArray().map((v) => (v * 1000).toFixed(1)).join(' x '), 'mm; y', box.min.y.toFixed(4), box.max.y.toFixed(4), 'holes', sh.holes.length);
}
// Triangles by region (near level).
for (const look of RACKET_LOOKS) {
  const g = makeRacketModel(look);
  const near = g.getObjectByName('racketNear') as THREE.Mesh;
  const info = near.geometry.getAttribute('rkInfo');
  const idx = near.geometry.index!;
  const by: Record<number, number> = {};
  for (let i = 0; i < idx.count; i += 3) { const c = Math.round(info.getX(idx.getX(i))); by[c] = (by[c] ?? 0) + 1; }
  console.log(look.name, JSON.stringify(by));
}
