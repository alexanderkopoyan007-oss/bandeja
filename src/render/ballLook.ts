// The ball's look (Phase 5): optic-yellow felt with a fuzzy sheen, the pale seam of the two dog-bone panels, the
// spin turning it (seam blurring out when the spin outruns the frame rate, as a camera sees it), and a short
// stretch along its path for the camera's shutter.
import * as THREE from 'three/webgpu';
import { attribute, float, mix, smoothstep, color, uniform, positionGeometry, mx_noise_float } from 'three/tsl';
import { heightBump } from './bump.ts';

/**
 * The seam: the classic two-lobed curve on the unit sphere, x = a cos t + b cos 3t, y = a sin t - b sin 3t,
 * z = 2 sqrt(ab) sin 2t (a + b = 1), which is exactly unit length for every t.
 */
const SEAM_B = 0.3;

function seamDistance(g: THREE.BufferGeometry, radius: number): Float32Array {
  const a = 1 - SEAM_B, b = SEAM_B, c = 2 * Math.sqrt(a * b);
  const N = 720;
  const curve = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    curve[i * 3] = a * Math.cos(t) + b * Math.cos(3 * t);
    curve[i * 3 + 1] = a * Math.sin(t) - b * Math.sin(3 * t);
    curve[i * 3 + 2] = c * Math.sin(2 * t);
  }
  const pos = g.attributes.position!.array as Float32Array;
  const n = pos.length / 3;
  const d = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const x = pos[k * 3]! / radius, y = pos[k * 3 + 1]! / radius, z = pos[k * 3 + 2]! / radius;
    let best = -1;
    for (let i = 0; i < N; i++) best = Math.max(best, x * curve[i * 3]! + y * curve[i * 3 + 1]! + z * curve[i * 3 + 2]!);
    d[k] = Math.acos(Math.min(1, best)) * radius; // along the surface (m)
  }
  return d;
}

export interface BallLook {
  mesh: THREE.Mesh;
  /** x: 0 the seam reads sharp .. 1 blurred into the felt by spin (a vector: writing it doesn't box a double). */
  blur: { value: THREE.Vector2 };
}

export function makeBall(radius: number): BallLook {
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  geo.setAttribute('seam', new THREE.BufferAttribute(seamDistance(geo, radius), 1));
  const m = new THREE.MeshPhysicalNodeMaterial();
  const blurU = uniform(new THREE.Vector2());
  const blur = blurU.x;
  // A seam about 4 mm wide (the rubber showing between the panels), blurred towards the felt as the ball spins.
  const seam = float(1).sub(smoothstep(0.0016, 0.0026, attribute<'float'>('seam', 'float'))).mul(float(1).sub(blur.mul(0.8)));
  const p = positionGeometry.div(radius);
  const fuzz = mx_noise_float(p.mul(38));
  const felt = mix(color(0xcfe23a), color(0xe2f05a), fuzz.mul(0.5).add(0.5));
  m.colorNode = mix(felt, color(0xf3f1df), seam.mul(0.85));
  m.roughnessNode = mix(float(0.92), float(0.55), seam);
  m.metalness = 0;
  // Felt: fibres scatter light at grazing angles (sheen), with a fine fuzz on the surface.
  m.sheen = 1;
  m.sheenColor = new THREE.Color(0xf4ffb0);
  m.sheenRoughness = 0.6;
  // Fuzz about 0.15 mm high on ~1 mm features; none on the seam.
  m.normalNode = heightBump(fuzz.mul(float(1).sub(seam)).mul(0.00015));
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  return { mesh, blur: blurU };
}

const QT = new THREE.Quaternion();
const ZF = new THREE.Vector3(0, 0, 1);
const VT = new THREE.Vector3();

/**
 * Turn the ball by the sim's spin over `dt` (rad/s), and stretch its holder along the velocity for a shutter of
 * `shutter` s (the holder turns its z to the path; the ball spins inside it, so the stretch stays on the path).
 * Returns the seam blur: how far a frame's turn is past what a camera can follow.
 */
export function spinBall(holder: THREE.Object3D, ball: THREE.Object3D, sx: number, sy: number, sz: number, dt: number,
  vx: number, vy: number, vz: number, radius: number, shutter: number): number {
  // The ball's world rotation is holder * ball: make it world, spin it in world axes, then put the new holder's turn
  // to the path back in.
  ball.quaternion.premultiply(holder.quaternion);
  const w = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (w > 1e-6 && dt > 0) {
    const h = (w * dt) / 2, s = Math.sin(h) / w;
    QT.x = sx * s; QT.y = sy * s; QT.z = sz * s; QT.w = Math.cos(h);
    ball.quaternion.premultiply(QT);
  }
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const len = v * shutter;
  if (len > radius * 0.1) {
    VT.x = vx / v; VT.y = vy / v; VT.z = vz / v;
    holder.quaternion.setFromUnitVectors(ZF, VT);
    holder.scale.z = 1 + len / (2 * radius);
  } else {
    holder.quaternion.identity();
    holder.scale.z = 1;
  }
  ball.quaternion.premultiply(QT.copy(holder.quaternion).invert());
  ball.quaternion.normalize();
  const perFrame = w / 60;
  return Math.min(1, Math.max(0, (perFrame - 0.6) / 1.2));
}
