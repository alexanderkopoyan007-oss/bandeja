// A covered club (hall, hall-2 in reference/photos.json): a steel portal-frame shed over the court, open at the
// sides, a pitched roof of light panels on purlins, a neighbour court beside ours, and daylight from outside.
import * as THREE from 'three/webgpu';
import type { Court } from '../../sim/court/court.ts';
import type { ArenaDef, ArenaPart } from './arena.ts';
import { BoxBatch } from './stadium.ts';
import { buildScenery } from './outdoor.ts';

export function buildHall(root: THREE.Group, def: ArenaDef, court: Court): ArenaPart {
  void court;
  const h = def.hall!;
  const steel = '#2a2e33';
  const frame = new BoxBatch();
  // Portal frames every 5 m along the court: two columns and a pitched rafter.
  const rise = 1.6;
  for (let z = -h.z; z <= h.z + 0.01; z += 5) {
    for (const s of [1, -1]) frame.box(s * h.x, h.height / 2, z, 0.3, h.height, 0.3, steel);
  }
  // Eaves beams and purlins.
  for (const s of [1, -1]) frame.box(s * h.x, h.height, 0, 0.25, 0.3, h.z * 2, steel);
  const frameMesh = frame.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }));
  frameMesh.castShadow = true;
  root.add(frameMesh);
  // Rafters are pitched (BoxBatch only turns boxes about y): instanced.
  const rafterMat = new THREE.MeshStandardMaterial({ color: steel, roughness: 0.5, metalness: 0.4 });
  const len = Math.hypot(h.x, rise);
  const rafterGeo = new THREE.BoxGeometry(len, 0.45, 0.2);
  const rafters = new THREE.InstancedMesh(rafterGeo, rafterMat, Math.floor((h.z * 2) / 5 + 1) * 2);
  let i = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let z = -h.z; z <= h.z + 0.01; z += 5) {
    for (const s of [1, -1]) {
      e.set(0, 0, s * Math.atan2(rise, h.x));
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3((s * h.x) / 2, h.height + rise / 2, z), q, new THREE.Vector3(1, 1, 1));
      rafters.setMatrixAt(i++, m4);
    }
  }
  rafters.count = i;
  root.add(rafters);
  // Roof panels: translucent sheeting, lit from outside (the daylight comes through): two pitched planes.
  const roofMat = new THREE.MeshStandardMaterial({ color: h.roof, roughness: 0.9, emissive: new THREE.Color(h.roof), emissiveIntensity: 0.55, side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(len, h.z * 2 + 1), roofMat);
    r.position.set((s * h.x) / 2, h.height + rise / 2 + 0.25, 0);
    r.rotation.set(-Math.PI / 2, s * Math.atan2(rise, h.x), 0, 'XZY');
    root.add(r);
  }
  // Rows of LED high-bays under the roof.
  const glow = new BoxBatch();
  for (let z = -h.z + 2.5; z < h.z; z += 5) for (const x of [-4, 4]) glow.box(x, h.height + 0.3, z, 1.2, 0.06, 0.35, '#ffffff');
  // LEDs far brighter than white (HDR): they bloom (render/post.ts).
  root.add(glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(5) })));
  // The shed's ends clad from GABLE_FROM up to the roof (review round 3, critic Medium #12: from the game camera the
  // far end showed only grass, trees and sky, and the hall read as an outdoor club). The end the camera looks in
  // from is left out: it would cut across the top of the picture (the camera stands outside the shed, and on the
  // change of ends it swings round to the other end, so the far one shows and the near one hides).
  const gableMat = new THREE.MeshStandardMaterial({ color: h.wall, roughness: 0.85, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(-h.x, GABLE_FROM);
  shape.lineTo(h.x, GABLE_FROM);
  shape.lineTo(h.x, h.height);
  shape.lineTo(0, h.height + rise);
  shape.lineTo(-h.x, h.height);
  shape.closePath();
  const gableGeo = new THREE.ShapeGeometry(shape);
  // Each with steel cladding rails every 1.2 m and a strip of dark clerestory glazing along its foot, so it reads
  // as a wall and not as a flat grey sky.
  const railMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const gables = [1, -1].map((s) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(gableGeo, gableMat));
    const b = new BoxBatch();
    b.box(0, GABLE_FROM + 0.4, -s * 0.05, h.x * 2, 0.8, 0.06, '#3a4450');
    for (let y = GABLE_FROM + 1.4; y < h.height; y += 1.2) b.box(0, y, -s * 0.05, h.x * 2, 0.07, 0.08, '#9aa1a8');
    for (let x = -h.x + 5; x < h.x; x += 5) b.box(x, (GABLE_FROM + h.height) / 2, -s * 0.08, 0.22, h.height - GABLE_FROM, 0.12, steel);
    g.add(b.mesh(railMat));
    g.position.z = s * h.z;
    root.add(g);
    return g;
  });
  // Daylight past the open sides: the club's grass, trees and sky.
  return {
    sky: buildScenery(root, def),
    update(_t: number, _m: unknown, cam?: THREE.Vector3): void {
      // (no camera: the change-of-ends swing, where both show)
      for (let k = 0; k < 2; k++) gables[k]!.visible = !cam || cam.z * (k === 0 ? 1 : -1) < h.z;
    },
  };
}

/** How high the shed's end cladding comes down to (m): under the camera's eye line at the far end (6 m there). */
const GABLE_FROM = 4.2;
