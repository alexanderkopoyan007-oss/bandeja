// The body as capsules fitted to the player mesh (radius = the median distance of a segment's vertices from it), and
// points on the racket. The animation QA measures clipping with them; the avatar keeps its racket out of its own
// torso and head with the same capsules. They are the body: the skin and what the person was modelled in that lies on it
// (modelledVertices; the other cuts in a wardrobe lie over the same body), never a skirt. A skirt hangs well off the thighs
// and the hips, so the women modelled in one (p7, p9, p10) had thighs a centimetre and a half too fat, which read as their
// legs overlapping in a narrow walk; and once every body carried both skirts (M5 phase C step 5), so did everyone. Nor
// the shoe (bodyB.x): its heel is weighted largely to the shin, so it counted in the shin's capsule, 5.7 cm on p1 where the
// leg alone is 4.4, and 8 cm once the shoe made to the foot (shoe.ts) brought more of it.
import * as THREE from 'three/webgpu';
import { modelledVertices, type PlayerAsset } from './asset.ts';

/** Wardrobe pieces that hang off the body (person_wear.py PIECES). */
const HANGING = ['pleated', 'aline'];

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
  const rest = asset.restPos, on = modelledVertices(asset), w = asset.look?.wardrobe;
  const hanging = new Set(w ? HANGING.map((n) => w.pieces.indexOf(n)).filter((k) => k >= 0) : []);
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const shoe = g.getAttribute('bodyB') as THREE.BufferAttribute | undefined;
  const at = (n: string): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(asset.restWorld[asset.bone(n)]!);
  const v = new THREE.Vector3();
  const out: CapsuleDef[] = [];
  for (const [name, a, b, bones] of defs) {
    const ids = new Set(bones.map((n) => asset.bone(n)));
    const A = at(a), B = at(b);
    const d: number[] = [];
    for (let k = 0; k < rest.length / 3; k++) {
      if (!on[k] || (w && hanging.has(w.piece[k]!)) || (shoe && shoe.getX(k) > 0.5)) continue;
      let best = -1, bw = -1;
      for (let j = 0; j < 4; j++) {
        const w = (sw as THREE.BufferAttribute).getComponent(k, j);
        if (w > bw) { bw = w; best = (si as THREE.BufferAttribute).getComponent(k, j); }
      }
      if (!ids.has(best)) continue;
      v.fromArray(rest, k * 3);
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

