// Post-processing (Phase 5): the scene rendered to an HDR target, then bloom on what is brighter than white (the
// floodlight lenses at night, the roof's light panels, the sun's sparkle), the way a broadcast camera's lens
// blooms them, then tone mapping. `?bloom=0` renders straight to the screen as before.
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface PostLook {
  /** Bloom strength, the blur's radius (0..1), and the linear brightness it starts from. */
  strength: number;
  radius: number;
  threshold: number;
}

export class Post {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly canvas: HTMLCanvasElement;
  private readonly nodes: Array<{ dispose(): void }>;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, look: PostLook) {
    this.canvas = renderer.domElement;
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, look.strength, look.radius, look.threshold);
    this.pipeline = new THREE.RenderPipeline(renderer, color.add(glow));
    this.nodes = [scenePass, glow];
  }

  /** Free the HDR target and the bloom's targets. */
  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.pipeline.dispose();
  }

  render(): void {
    // A 0 x 0 window (a hidden tab) would make the targets at zero size, and in WebGL they stay broken after a
    // resize (every later frame black): draw nothing until there is a size.
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    this.pipeline.render();
  }
}
