// Bump from a procedural height (Phase 5 review): three's bumpMap() only works on textures (it offsets their UVs
// to difference the height), so on noise it did nothing. This differentiates the height in screen space instead
// (Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU", 2010), with the height in metres and the surface's
// own screen derivatives unnormalised, so a fold is the same depth near and far.
import type * as THREE from 'three/webgpu';
import { dFdx, dFdy, positionView, normalView, faceDirection, max, float, smoothstep } from 'three/tsl';

/**
 * A view-space normal for `material.normalNode`: the surface bumped by `height` (m), whose features are about `cell`
 * metres across. Where a pixel covers more than a quarter of a feature the bump fades out (gone at half): sampled
 * coarser than that, screen-space differences are noise that shimmers as the surface moves.
 */
export function heightBump(height: THREE.Node<'float'>, cell: number): THREE.Node<'vec3'> {
  const dpx = dFdx(positionView), dpy = dFdy(positionView);
  const n = normalView;
  const r1 = dpy.cross(n), r2 = n.cross(dpx);
  const det = dpx.dot(r1).mul(faceDirection);
  const foot = max(dpx.length(), dpy.length());
  const keep = float(1).sub(smoothstep(0.25 * cell, 0.5 * cell, foot));
  const grad = det.sign().mul(dFdx(height).mul(r1).add(dFdy(height).mul(r2))).mul(keep);
  return det.abs().mul(n).sub(grad).normalize();
}
