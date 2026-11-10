/**
 * The poses Low quality's simpler players are checked in (lodCore.ts shapeAttributes): a triangle that joins two parts the
 * rest pose holds together but play pulls apart (the thighs at the crotch, the arm and the side) is fine in the T-pose and a
 * web in a lunge. Each pose is the skin matrices for the asset's skeleton, made here (main thread, three's maths) and
 * skinned in the worker.
 */
import * as THREE from 'three/webgpu';
import type { PlayerAsset } from './avatar/asset.ts';

/** [bone, its child (the joint the segment ends at), the segment's direction in the pose: x the body's left, y up, z its front]. */
type Aim = [string, string, [number, number, number]];
/** [bone, a turn about the world's up (rad)]: twists a direction leaves alone. */
type Twist = [string, number];

const POSES: Array<{ aims: Aim[]; twists: Twist[] }> = [
  // A running lunge: the left thigh forward and the knee bent, the right leg back; arms down by the sides, elbows bent forward; the chest turned.
  {
    aims: [
      ['LeftUpLeg', 'LeftLeg', [0, -0.5, 0.87]], ['LeftLeg', 'LeftFoot', [0, -0.95, -0.3]],
      ['RightUpLeg', 'RightLeg', [0, -0.9, -0.42]], ['RightLeg', 'RightFoot', [0, -0.5, -0.87]],
      ['LeftArm', 'LeftForeArm', [0.25, -0.95, 0.15]], ['LeftForeArm', 'LeftHand', [0, -0.1, 1]],
      ['RightArm', 'RightForeArm', [-0.25, -0.95, 0.15]], ['RightForeArm', 'RightHand', [0, -0.1, 1]],
    ],
    twists: [['Spine2', 0.5]],
  },
  // Wide, arms overhead and the elbows bent behind the head, the head turned.
  {
    aims: [
      ['LeftUpLeg', 'LeftLeg', [0.64, -0.77, 0]], ['LeftLeg', 'LeftFoot', [0.64, -0.77, 0]],
      ['RightUpLeg', 'RightLeg', [-0.64, -0.77, 0]], ['RightLeg', 'RightFoot', [-0.64, -0.77, 0]],
      ['LeftArm', 'LeftForeArm', [0.3, 0.95, 0]], ['LeftForeArm', 'LeftHand', [-0.6, 0.5, -0.6]],
      ['RightArm', 'RightForeArm', [-0.3, 0.95, 0]], ['RightForeArm', 'RightHand', [0.6, 0.5, -0.6]],
    ],
    twists: [['Head', 0.8]],
  },
  // A deep crouch, bent forward, the racket arm across the body and the other back, legs together.
  {
    aims: [
      ['Spine', 'Spine1', [0, 0.8, 0.6]],
      ['LeftUpLeg', 'LeftLeg', [-0.05, -0.3, 0.95]], ['LeftLeg', 'LeftFoot', [0, -0.98, -0.2]],
      ['RightUpLeg', 'RightLeg', [0.05, -0.3, 0.95]], ['RightLeg', 'RightFoot', [0, -0.98, -0.2]],
      ['RightArm', 'RightForeArm', [0.7, -0.2, 0.7]], ['RightForeArm', 'RightHand', [0.95, 0.2, 0.2]],
      ['LeftArm', 'LeftForeArm', [0.3, -0.3, -0.9]], ['LeftForeArm', 'LeftHand', [0.2, 0.5, -0.85]],
    ],
    twists: [['Spine1', -0.4]],
  },
];

const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4();

/** The skin matrices (16 floats a bone, column-major) of `asset`'s skeleton in each check pose. Bones it lacks are left at rest. */
export function lodSkins(asset: PlayerAsset): Float32Array[] {
  const n = asset.bones.length;
  const local = asset.restWorld.map((m, b) => {
    const p = asset.bones[b]!.parent;
    return p < 0 ? m.clone() : asset.restWorld[p]!.clone().invert().multiply(m);
  });
  const id = (name: string): number => { try { return asset.bone(name); } catch { return -1; } };
  return POSES.map((pose) => {
    const aims = new Map<number, [number, THREE.Vector3]>(), twists = new Map<number, number>();
    for (const [b, c, d] of pose.aims) { const i = id(b), j = id(c); if (i >= 0 && j >= 0) aims.set(i, [j, new THREE.Vector3(...d).normalize()]); }
    for (const [b, a] of pose.twists) { const i = id(b); if (i >= 0) twists.set(i, a); }
    const world: THREE.Matrix4[] = [];
    for (let b = 0; b < n; b++) {
      const p = asset.bones[b]!.parent;
      const m = p < 0 ? local[b]!.clone() : world[p]!.clone().multiply(local[b]!);
      _p.setFromMatrixPosition(m);
      const aim = aims.get(b), tw = twists.get(b);
      if (aim) {
        // (the child's place as this bone now holds it)
        _c.setFromMatrixPosition(_t.copy(m).multiply(local[aim[0]]!)).sub(_p).normalize();
        _q.setFromUnitVectors(_c, aim[1]);
        m.premultiply(_r.makeTranslation(-_p.x, -_p.y, -_p.z)).premultiply(_t.makeRotationFromQuaternion(_q)).premultiply(_r.makeTranslation(_p.x, _p.y, _p.z));
      }
      if (tw) {
        _q.setFromAxisAngle(_c.set(0, 1, 0), tw);
        m.premultiply(_r.makeTranslation(-_p.x, -_p.y, -_p.z)).premultiply(_t.makeRotationFromQuaternion(_q)).premultiply(_r.makeTranslation(_p.x, _p.y, _p.z));
      }
      world.push(m);
    }
    const out = new Float32Array(n * 16);
    for (let b = 0; b < n; b++) _t.multiplyMatrices(world[b]!, asset.boneInverses[b]!).toArray(out, b * 16);
    return out;
  });
}

/** The face's morphs the simpler face is checked with, each set applied in full: the mouth open, the eyes shut and a smile. */
export const LOD_MORPHS = [['jawOpen'], ['blinkL', 'blinkR', 'smile']];
