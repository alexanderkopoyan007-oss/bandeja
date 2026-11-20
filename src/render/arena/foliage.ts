// Leaves let the sun through (the golden club's palms and wood). A leaf is a sheet a fraction of a millimetre thick: lit from
// behind it glows yellow-green, and looking into the sun through a crown is the brightest it gets. Without this every
// backlit frond and crown was a black cut-out against the sky: the broadcast camera looks towards a sun behind the far end.
// In the lighting model's direct term (as the skin's scatter), so `lightColor` is the sun already through the shadow map:
// a leaf in another's shadow stays dark.
// - diffuse through the leaf: the light on its back face, max(0, -n·l), times TRANSMIT of its own colour made yellower
//   (light through a leaf has lost more blue and red to the chlorophyll than light off it: `THROUGH`);
// - forward: the light near the line to the sun, pow(max(0, -v·l), FORWARD_POWER), times FORWARD of the same.
// Measured leaves transmit 10-40% of the light, most of it forward (broadleaf and palm leaflets alike).
import * as THREE from 'three/webgpu';
import { diffuseColor, normalView, positionViewDirection, pow, vec3, float } from 'three/tsl';

const TRANSMIT = 0.35, FORWARD = 0.6, FORWARD_POWER = 6;
const THROUGH = [1.0, 1.15, 0.45] as const;

class FoliageLighting extends THREE.PhysicalLightingModel {
  override direct(input: THREE.LightingModelDirectInput, builder: THREE.NodeBuilder): void {
    super.direct(input, builder);
    const l = input.lightDirection as THREE.Node<'vec3'>;
    const back = normalView.dot(l).negate().max(0);
    const fwd = pow(positionViewDirection.dot(l).negate().max(0), float(FORWARD_POWER));
    const through = diffuseColor.rgb.mul(vec3(THROUGH[0], THROUGH[1], THROUGH[2]));
    const t = through.mul(back.mul(TRANSMIT).add(fwd.mul(FORWARD).mul(back.add(0.25).min(1))));
    (input.reflectedLight.directDiffuse as THREE.Node<'vec3'>).addAssign(t.mul(input.lightColor as THREE.Node<'vec3'>).mul(1 / Math.PI));
  }
}

/** A standard material whose direct light also comes through the leaf (above). */
export class FoliageMaterial extends THREE.MeshStandardNodeMaterial {
  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new FoliageLighting();
  }
}
