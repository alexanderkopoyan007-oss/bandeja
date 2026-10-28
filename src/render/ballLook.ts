// The ball's look (Phase 5, felt reworked in Phase 9): optic-yellow felt, uneven over each panel and matte with a
// soft sheen, its nap standing off the outline, the sunk whitish seam of the two dog-bone panels, the spin turning it (seam blurring out when the spin outruns the frame rate, as a camera sees it), and a short
// stretch along its path for the camera's shutter.
import * as THREE from 'three/webgpu';
import { attribute, float, mix, smoothstep, color, uniform, positionGeometry, positionView, normalView, mx_noise_float } from 'three/tsl';
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
  const seamD = attribute<'float'>('seam', 'float');
  // The seam: the rubber line between the two felt panels, about 3.5 mm wide and a little sunk, whitish grey; blurred
  // towards the felt as the ball spins.
  const seam = float(1).sub(smoothstep(0.0013, 0.0021, seamD)).mul(float(1).sub(blur.mul(0.8)));
  // The felt pressed into the seam's glue each side of it reads a touch darker.
  const pressed = float(1).sub(smoothstep(0.0021, 0.0042, seamD));
  const p = positionGeometry.div(radius);
  // Felt: soft unevenness over each panel, the nap's fibres, and a fine fuzz (three scales of noise, -1..1).
  const patch = mx_noise_float(p.mul(7));
  const fibre = mx_noise_float(p.mul(46));
  const fine = mx_noise_float(p.mul(140));
  const tone = patch.mul(0.35).add(fibre.mul(0.45)).add(fine.mul(0.2)).mul(0.5).add(0.5);
  const felt = mix(color(0xb9ca33), color(0xe5f15c), tone).mul(float(1).sub(pressed.mul(0.12)));
  m.colorNode = mix(felt, color(0xeeede2), seam.mul(0.9));
  m.roughnessNode = mix(float(0.95), float(0.5), seam);
  m.metalness = 0;
  // Fibres scatter light at grazing angles (sheen): softer and less bright than a satin, felt is matte.
  m.sheen = 0.75;
  m.sheenColor = new THREE.Color(0xeef8b8);
  m.sheenRoughness = 0.8;
  // Fuzz about 0.15 mm high on ~1 mm features off the seam, the seam sunk about 0.3 mm.
  m.normalNode = heightBump(fibre.mul(0.00012).add(fine.mul(0.00005)).mul(float(1).sub(seam)).sub(seam.mul(0.0003)), 0.0009);
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  // The nap standing off the surface: a thin shell of fibres, seen only towards the edge (where a felt ball's outline
  // is soft, not a hard sphere's).
  const shellM = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const sp = positionGeometry.div(radius * 1.045);
  const strands = smoothstep(0.05, 0.6, mx_noise_float(sp.mul(95)));
  const edge = float(1).sub(normalView.dot(positionView.normalize().negate()).abs());
  shellM.colorNode = color(0xd9e85a);
  shellM.roughnessNode = float(1);
  shellM.opacityNode = strands.mul(edge.pow(1.6)).mul(0.55);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.045, 32, 20), shellM);
  shell.renderOrder = 2;
  mesh.add(shell);
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
