// The body as capsules fitted to the player mesh (radius = the median distance of a segment's vertices from it), and
// points on the racket. The animation QA measures clipping with them; the avatar keeps its racket out of its own
// torso and head with the same capsules.
import * as THREE from 'three/webgpu';
import type { PlayerAsset } from './asset.ts';

export function pointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const l = ab.lengthSq();
  const t = l > 1e-12 ? Math.min(1, Math.max(0, new THREE.Vector3().subVectors(p, a).dot(ab) / l)) : 0;
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

export interface CapsuleDef { name: string; a: string; b: string; bones: string[]; r: number; ia: number; ib: number }

/** Body capsules, fitted to the mesh: radius = the median distance of the segment's vertices from it. */
export function fitCapsules(asset: PlayerAsset): CapsuleDef[] {
  const defs: Array<[string, string, string, string[]]> = [
    ['pelvis', 'Hips', 'Spine1', ['Hips', 'Spine']],
    ['chest', 'Spine1', 'Neck', ['Spine1', 'Spine2']],
    ['head', 'Head', 'HeadTop_End', ['Head', 'Neck']],
    ['upperArmL', 'LeftArm', 'LeftForeArm', ['LeftArm']],
    ['foreArmL', 'LeftForeArm', 'LeftHand', ['LeftForeArm']],
    ['upperArmR', 'RightArm', 'RightForeArm', ['RightArm']],
    ['foreArmR', 'RightForeArm', 'RightHand', ['RightForeArm']],
    ['thighL', 'LeftUpLeg', 'LeftLeg', ['LeftUpLeg']],
    ['shinL', 'LeftLeg', 'LeftFoot', ['LeftLeg']],
    ['thighR', 'RightUpLeg', 'RightLeg', ['RightUpLeg']],
    ['shinR', 'RightLeg', 'RightFoot', ['RightLeg']],
  ];
  const g = asset.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const at = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(asset.restWorld[asset.bone(n)]!);
  const v = new THREE.Vector3();
  const out: CapsuleDef[] = [];
  for (const [name, a, b, bones] of defs) {
    const ids = new Set(bones.map((n) => asset.bone(n)));
    const A = at(a), B = at(b);
    const d: number[] = [];
    for (let k = 0; k < pos.count; k++) {
      let best = -1, bw = -1;
      for (let j = 0; j < 4; j++) {
        const w = (sw as THREE.BufferAttribute).getComponent(k, j);
        if (w > bw) { bw = w; best = (si as THREE.BufferAttribute).getComponent(k, j); }
      }
      if (!ids.has(best)) continue;
      v.fromBufferAttribute(pos as THREE.BufferAttribute, k);
      d.push(pointSeg(v, A, B));
    }
    d.sort((x, y) => x - y);
    out.push({ name, a, b, bones, r: d.length ? d[d.length >> 1]! : 0.04, ia: asset.bone(a), ib: asset.bone(b) });
  }
  return out;
}

/** Racket points in its frame (face centre at the origin, face normal z, handle down -y). */
export const RACKET_PTS = [
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.146, 0), new THREE.Vector3(0, -0.146, 0),
  new THREE.Vector3(0.13, 0, 0), new THREE.Vector3(-0.13, 0, 0), new THREE.Vector3(0, -0.24, 0),
];

